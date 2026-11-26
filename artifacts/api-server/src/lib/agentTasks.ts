import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebaseAdmin";
import { listIdeSessions, listIdeTasks } from "./ideCodeService";
import {
  recommendProvidersForTask,
  type RecommendationPriority,
  type RecommendationTask,
} from "./providerDiagnostics";

export type AgentSectionTarget =
  | "image"
  | "stories"
  | "code"
  | "students"
  | "provider_center";

export type AgentToolName =
  | "generate_image"
  | "story_setup"
  | "code_workspace_task"
  | "student_study_assist"
  | "provider_recommend";

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentToolDefinition = {
  name: AgentToolName;
  section: AgentSectionTarget;
  executionSide: "client" | "server";
  description: string;
  supportsLongRunning: boolean;
};

export const AGENT_TOOL_REGISTRY: ReadonlyArray<AgentToolDefinition> = [
  {
    name: "generate_image",
    section: "image",
    executionSide: "client",
    description: "Generate 1 to 4 images inside the YFactory Image workspace.",
    supportsLongRunning: false,
  },
  {
    name: "story_setup",
    section: "stories",
    executionSide: "client",
    description:
      "Create or update a story (up to 100 scenes, including 50+ scenes), character traits, and optionally start background scene rendering.",
    supportsLongRunning: true,
  },
  {
    name: "code_workspace_task",
    section: "code",
    executionSide: "server",
    description:
      "Check connected IDE sessions and queue/link a workspace coding task ONLY when an active VS Code / IDE session is connected.",
    supportsLongRunning: true,
  },
  {
    name: "student_study_assist",
    section: "students",
    executionSide: "server",
    description:
      "Create a structured visual study or exam preparation task linked to the Students workspace.",
    supportsLongRunning: false,
  },
  {
    name: "provider_recommend",
    section: "provider_center",
    executionSide: "server",
    description:
      "Query Provider Center smart recommendations based on real connected keys, capabilities, and measured ping latency.",
    supportsLongRunning: false,
  },
];

export type AgentTaskRecord = {
  id: string;
  toolName: AgentToolName;
  section: AgentSectionTarget;
  title: string;
  status: AgentTaskStatus;
  progress: number;
  stepLabel: string;
  payload: Record<string, unknown>;
  resultSummary: string | null;
  targetRef: {
    storyId?: string;
    providerId?: string;
    ideSessionId?: string;
  } | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export class AgentTaskError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function userAgentTasksCollection(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("agentTasks");
}

function sanitizePayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length > 64) continue;
    if (/key|secret|token|password/i.test(key)) continue;
    if (typeof val === "string") {
      out[key] = val.slice(0, 4000);
    } else if (typeof val === "number" || typeof val === "boolean" || val === null) {
      out[key] = val;
    } else if (Array.isArray(val)) {
      out[key] = val.slice(0, 12).map((item) =>
        typeof item === "string" ? item.slice(0, 200) : item,
      );
    }
  }
  return out;
}

function taskFromDoc(id: string, d: Record<string, unknown>): AgentTaskRecord {
  const validStatus: AgentTaskStatus =
    d.status === "queued" ||
    d.status === "running" ||
    d.status === "completed" ||
    d.status === "failed" ||
    d.status === "cancelled"
      ? d.status
      : "queued";

  const validSection: AgentSectionTarget =
    d.section === "image" ||
    d.section === "stories" ||
    d.section === "code" ||
    d.section === "students" ||
    d.section === "provider_center"
      ? d.section
      : "image";

  const validTool: AgentToolName =
    d.toolName === "generate_image" ||
    d.toolName === "story_setup" ||
    d.toolName === "code_workspace_task" ||
    d.toolName === "student_study_assist" ||
    d.toolName === "provider_recommend"
      ? d.toolName
      : "generate_image";

  const rawRef =
    d.targetRef && typeof d.targetRef === "object"
      ? (d.targetRef as Record<string, unknown>)
      : null;

  return {
    id,
    toolName: validTool,
    section: validSection,
    title: String(d.title ?? "Agent Task").slice(0, 160),
    status: validStatus,
    progress:
      typeof d.progress === "number" && Number.isFinite(d.progress)
        ? Math.max(0, Math.min(100, Math.round(d.progress)))
        : 0,
    stepLabel: String(d.stepLabel ?? "").slice(0, 200),
    payload:
      d.payload && typeof d.payload === "object"
        ? (d.payload as Record<string, unknown>)
        : {},
    resultSummary:
      typeof d.resultSummary === "string" ? d.resultSummary.slice(0, 800) : null,
    targetRef: rawRef
      ? {
          ...(typeof rawRef.storyId === "string" ? { storyId: rawRef.storyId } : {}),
          ...(typeof rawRef.providerId === "string"
            ? { providerId: rawRef.providerId }
            : {}),
          ...(typeof rawRef.ideSessionId === "string"
            ? { ideSessionId: rawRef.ideSessionId }
            : {}),
        }
      : null,
    errorMessage:
      typeof d.errorMessage === "string" ? d.errorMessage.slice(0, 400) : null,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

export async function createAgentTask(
  uid: string,
  input: {
    toolName: AgentToolName;
    section: AgentSectionTarget;
    title: string;
    status?: AgentTaskStatus;
    progress?: number;
    stepLabel?: string;
    payload?: Record<string, unknown>;
    resultSummary?: string | null;
    targetRef?: AgentTaskRecord["targetRef"];
    errorMessage?: string | null;
  },
): Promise<AgentTaskRecord> {
  const now = Date.now();
  const id = `atask_${now}_${randomBytes(4).toString("hex")}`;
  const record: AgentTaskRecord = {
    id,
    toolName: input.toolName,
    section: input.section,
    title: input.title.trim().slice(0, 160) || "Agent Task",
    status: input.status ?? "running",
    progress: Math.max(0, Math.min(100, Math.round(input.progress ?? 10))),
    stepLabel: (input.stepLabel ?? "Started").slice(0, 200),
    payload: sanitizePayload(input.payload),
    resultSummary: input.resultSummary ?? null,
    targetRef: input.targetRef ?? null,
    errorMessage: input.errorMessage ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await userAgentTasksCollection(uid)
    .doc(id)
    .set({ ...record, createdAtTs: Timestamp.fromMillis(now) });
  return record;
}

export async function updateAgentTask(
  uid: string,
  taskId: string,
  patch: Partial<{
    status: AgentTaskStatus;
    progress: number;
    stepLabel: string;
    resultSummary: string | null;
    targetRef: AgentTaskRecord["targetRef"];
    errorMessage: string | null;
  }>,
): Promise<AgentTaskRecord | null> {
  const ref = userAgentTasksCollection(uid).doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const current = taskFromDoc(taskId, snap.data() ?? {});

  const updated: AgentTaskRecord = {
    ...current,
    ...(patch.status ? { status: patch.status } : {}),
    ...(typeof patch.progress === "number"
      ? { progress: Math.max(0, Math.min(100, Math.round(patch.progress))) }
      : {}),
    ...(typeof patch.stepLabel === "string"
      ? { stepLabel: patch.stepLabel.slice(0, 200) }
      : {}),
    ...(patch.resultSummary !== undefined
      ? {
          resultSummary: patch.resultSummary
            ? patch.resultSummary.slice(0, 800)
            : null,
        }
      : {}),
    ...(patch.targetRef !== undefined
      ? { targetRef: patch.targetRef }
      : {}),
    ...(patch.errorMessage !== undefined
      ? {
          errorMessage: patch.errorMessage
            ? patch.errorMessage.slice(0, 400)
            : null,
        }
      : {}),
    updatedAt: Date.now(),
  };

  await ref.set(updated, { merge: true });
  return updated;
}

export async function listAgentTasks(
  uid: string,
  limit = 30,
): Promise<AgentTaskRecord[]> {
  const snap = await userAgentTasksCollection(uid)
    .orderBy("updatedAt", "desc")
    .limit(Math.max(1, Math.min(limit, 60)))
    .get();
  return snap.docs.map((doc) => taskFromDoc(doc.id, doc.data()));
}

export async function cancelAgentTask(
  uid: string,
  taskId: string,
): Promise<AgentTaskRecord | null> {
  return updateAgentTask(uid, taskId, {
    status: "cancelled",
    stepLabel: "Cancelled by user",
  });
}

export async function deleteAgentTask(
  uid: string,
  taskId: string,
): Promise<boolean> {
  const ref = userAgentTasksCollection(uid).doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

export async function clearFinishedAgentTasks(uid: string): Promise<number> {
  const snap = await userAgentTasksCollection(uid).limit(150).get();
  const removable = snap.docs.filter((doc) => {
    const st = String(doc.data().status ?? "");
    return st === "completed" || st === "failed" || st === "cancelled";
  });
  if (removable.length === 0) return 0;
  const { db } = getFirebaseAdmin();
  const batch = db.batch();
  for (const doc of removable) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return removable.length;
}

export async function executeServerAgentTool(
  uid: string,
  toolName: AgentToolName,
  payload: Record<string, unknown>,
): Promise<{
  task: AgentTaskRecord;
  data: Record<string, unknown>;
}> {
  if (toolName === "code_workspace_task") {
    const prompt =
      typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    const sessions = await listIdeSessions(uid);
    const activeSession = sessions[0] ?? null;

    if (!activeSession) {
      const failed = await createAgentTask(uid, {
        toolName: "code_workspace_task",
        section: "code",
        title: `Code IDE: ${prompt.slice(0, 70) || "Workspace check"}`,
        status: "failed",
        progress: 0,
        stepLabel: "No active IDE session connected",
        payload: { prompt },
        errorMessage:
          "No active VS Code / IDE workspace is connected. Open the Code tab to generate a pairing code and link your IDE first.",
      });
      return {
        task: failed,
        data: {
          ok: false,
          connected: false,
          errorMessage: failed.errorMessage,
        },
      };
    }

    const recentIdeTasks = await listIdeTasks(uid, 5);
    const summary = `Active IDE connected: ${activeSession.workspaceName} (${activeSession.ideName.toUpperCase()}). Open YFactory Code in your IDE sidebar to review diffs and run workspace tasks safely.`;
    const task = await createAgentTask(uid, {
      toolName: "code_workspace_task",
      section: "code",
      title: `Code (${activeSession.workspaceName}): ${prompt.slice(0, 65) || "IDE Session"}`,
      status: "completed",
      progress: 100,
      stepLabel: `Linked to ${activeSession.workspaceName}`,
      payload: { prompt },
      resultSummary: summary,
      targetRef: { ideSessionId: activeSession.id },
    });
    return {
      task,
      data: {
        ok: true,
        connected: true,
        workspaceName: activeSession.workspaceName,
        ideName: activeSession.ideName,
        recentTaskCount: recentIdeTasks.length,
        summary,
      },
    };
  }

  if (toolName === "student_study_assist") {
    const topic =
      typeof payload.topic === "string" ? payload.topic.trim() : "";
    const subject =
      typeof payload.subject === "string" ? payload.subject.trim() : "General";
    const goal =
      typeof payload.goal === "string" ? payload.goal.trim() : "Explain & Quiz";
    if (!topic) {
      throw new AgentTaskError("Specify a study topic or question.", "invalid_topic", 400);
    }

    const summary = `Prepared study focus for "${topic}" (${subject} — ${goal}). Open the Students tab for visual study tools & interactive quizzes.`;
    const task = await createAgentTask(uid, {
      toolName: "student_study_assist",
      section: "students",
      title: `Study: ${topic.slice(0, 70)}`,
      status: "completed",
      progress: 100,
      stepLabel: `${subject} · ${goal}`,
      payload: { topic, subject, goal },
      resultSummary: summary,
    });
    return {
      task,
      data: { ok: true, topic, subject, goal, summary },
    };
  }

  if (toolName === "provider_recommend") {
    const rawTask = typeof payload.task === "string" ? payload.task : "chat";
    const recTask: RecommendationTask =
      rawTask === "code" || rawTask === "image_generation" ? rawTask : "chat";
    const rawPrio = typeof payload.priority === "string" ? payload.priority : "balanced";
    const priority: RecommendationPriority =
      rawPrio === "speed" || rawPrio === "cost" ? rawPrio : "balanced";

    const recommendations = await recommendProvidersForTask(uid, recTask, priority);
    const top = recommendations[0] ?? null;
    const summary = top
      ? `Top recommendation for ${recTask} (${priority}): ${top.providerName} (${top.connectionStatus}${top.measuredApiMs ? `, API ${top.measuredApiMs} ms` : ""}).`
      : `No provider matched ${recTask}.`;

    const task = await createAgentTask(uid, {
      toolName: "provider_recommend",
      section: "provider_center",
      title: `Provider Check (${recTask})`,
      status: "completed",
      progress: 100,
      stepLabel: top ? `Top: ${top.providerName}` : "No match",
      payload: { task: recTask, priority },
      resultSummary: summary,
      targetRef: top ? { providerId: top.providerId } : null,
    });
    return {
      task,
      data: {
        ok: true,
        summary,
        topProviderId: top?.providerId ?? null,
        recommendations: recommendations.slice(0, 4),
      },
    };
  }

  throw new AgentTaskError(
    `Tool "${toolName}" is not executable on the server route.`,
    "unsupported_tool",
    400,
  );
}

export async function retryServerAgentTask(
  uid: string,
  taskId: string,
): Promise<{ task: AgentTaskRecord; data: Record<string, unknown> }> {
  const snap = await userAgentTasksCollection(uid).doc(taskId).get();
  if (!snap.exists) {
    throw new AgentTaskError("Task not found.", "not_found", 404);
  }
  const existing = taskFromDoc(taskId, snap.data() ?? {});
  const def = AGENT_TOOL_REGISTRY.find((t) => t.name === existing.toolName);
  if (!def || def.executionSide !== "server") {
    throw new AgentTaskError(
      "Re-run Image or Story tasks directly from the Chat composer.",
      "client_tool_retry",
      400,
    );
  }
  return executeServerAgentTool(uid, existing.toolName, existing.payload);
}