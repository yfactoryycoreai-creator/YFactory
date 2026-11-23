import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  AGENT_TOOL_REGISTRY,
  AgentTaskError,
  cancelAgentTask,
  clearFinishedAgentTasks,
  createAgentTask,
  deleteAgentTask,
  executeServerAgentTool,
  listAgentTasks,
  retryServerAgentTask,
  updateAgentTask,
  type AgentSectionTarget,
  type AgentTaskStatus,
  type AgentToolName,
} from "../lib/agentTasks";

const AGENT_RATE_WINDOW_MS = 60_000;
const AGENT_RATE_LIMIT = 20;

function isValidTaskId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

function isValidToolName(value: unknown): value is AgentToolName {
  return (
    value === "generate_image" ||
    value === "story_setup" ||
    value === "generate_video" ||
    value === "code_workspace_task" ||
    value === "student_study_assist" ||
    value === "provider_recommend"
  );
}

function isValidSection(value: unknown): value is AgentSectionTarget {
  return (
    value === "image" ||
    value === "stories" ||
    value === "video" ||
    value === "code" ||
    value === "students" ||
    value === "provider_center"
  );
}

function isValidStatus(value: unknown): value is AgentTaskStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

export function createAgentTasksRouter(): IRouter {
  const router: IRouter = Router();
  const recentExecs = new Map<string, number[]>();

  const allowExec = (uid: string, now = Date.now()): boolean => {
    const recent = (recentExecs.get(uid) ?? []).filter(
      (ts) => now - ts < AGENT_RATE_WINDOW_MS,
    );
    if (recent.length >= AGENT_RATE_LIMIT) {
      recentExecs.set(uid, recent);
      return false;
    }
    recent.push(now);
    recentExecs.set(uid, recent);
    return true;
  };

  const requireUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to use YFactory Agent.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to use YFactory Agent.", code: "auth_failed" });
    return null;
  };

  router.get("/agent/tools", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    res.json({ tools: AGENT_TOOL_REGISTRY });
  });

  router.get("/agent/tasks", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const tasks = await listAgentTasks(uid, 30);
      res.json({ tasks });
    } catch {
      res.status(500).json({ error: "Could not load agent tasks.", code: "tasks_failed" });
    }
  });

  router.post("/agent/tasks", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isValidToolName(body.toolName) || !isValidSection(body.section)) {
      res.status(400).json({ error: "Invalid tool or section.", code: "validation_failed" });
      return;
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "Task title is required.", code: "validation_failed" });
      return;
    }
    try {
      const task = await createAgentTask(uid, {
        toolName: body.toolName,
        section: body.section,
        title,
        status: isValidStatus(body.status) ? body.status : "running",
        progress: typeof body.progress === "number" ? body.progress : 15,
        stepLabel: typeof body.stepLabel === "string" ? body.stepLabel : "In progress",
        payload:
          body.payload && typeof body.payload === "object"
            ? (body.payload as Record<string, unknown>)
            : {},
        resultSummary:
          typeof body.resultSummary === "string" ? body.resultSummary : null,
        targetRef:
          body.targetRef && typeof body.targetRef === "object"
            ? (body.targetRef as Record<string, string>)
            : null,
        errorMessage:
          typeof body.errorMessage === "string" ? body.errorMessage : null,
      });
      res.status(201).json({ task });
    } catch {
      res.status(500).json({ error: "Could not create task.", code: "create_failed" });
    }
  });

  router.patch("/agent/tasks/:taskId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const taskId = String(req.params.taskId ?? "").trim();
    if (!isValidTaskId(taskId)) {
      res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const updated = await updateAgentTask(uid, taskId, {
        ...(isValidStatus(body.status) ? { status: body.status } : {}),
        ...(typeof body.progress === "number" ? { progress: body.progress } : {}),
        ...(typeof body.stepLabel === "string" ? { stepLabel: body.stepLabel } : {}),
        ...(typeof body.resultSummary === "string" || body.resultSummary === null
          ? { resultSummary: body.resultSummary }
          : {}),
        ...(body.targetRef && typeof body.targetRef === "object"
          ? { targetRef: body.targetRef as Record<string, string> }
          : {}),
        ...(typeof body.errorMessage === "string" || body.errorMessage === null
          ? { errorMessage: body.errorMessage }
          : {}),
      });
      if (!updated) {
        res.status(404).json({ error: "Task not found.", code: "not_found" });
        return;
      }
      res.json({ task: updated });
    } catch {
      res.status(500).json({ error: "Could not update task.", code: "update_failed" });
    }
  });

  router.post("/agent/tasks/:taskId/cancel", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const taskId = String(req.params.taskId ?? "").trim();
    if (!isValidTaskId(taskId)) {
      res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
      return;
    }
    try {
      const task = await cancelAgentTask(uid, taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found.", code: "not_found" });
        return;
      }
      res.json({ task });
    } catch {
      res.status(500).json({ error: "Could not cancel task.", code: "cancel_failed" });
    }
  });

  router.post("/agent/tasks/:taskId/retry", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    if (!allowExec(uid)) {
      res.status(429).json({ error: "Too many agent executions. Wait a moment.", code: "rate_limited" });
      return;
    }
    const taskId = String(req.params.taskId ?? "").trim();
    if (!isValidTaskId(taskId)) {
      res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
      return;
    }
    try {
      const result = await retryServerAgentTask(uid, taskId);
      res.json(result);
    } catch (err) {
      if (err instanceof AgentTaskError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not retry task.", code: "retry_failed" });
    }
  });

  router.delete("/agent/tasks/:taskId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const taskId = String(req.params.taskId ?? "").trim();
    if (!isValidTaskId(taskId)) {
      res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
      return;
    }
    try {
      const deleted = await deleteAgentTask(uid, taskId);
      if (!deleted) {
        res.status(404).json({ error: "Task not found.", code: "not_found" });
        return;
      }
      res.json({ deleted: true, id: taskId });
    } catch {
      res.status(500).json({ error: "Could not delete task.", code: "delete_failed" });
    }
  });

  router.delete("/agent/tasks", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const cleared = await clearFinishedAgentTasks(uid);
      res.json({ cleared });
    } catch {
      res.status(500).json({ error: "Could not clear finished tasks.", code: "clear_failed" });
    }
  });

  router.post("/agent/execute", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    if (!allowExec(uid)) {
      res.status(429).json({
        error: "Rate limit reached for agent tool calls. Wait a moment.",
        code: "rate_limited",
      });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isValidToolName(body.toolName)) {
      res.status(400).json({ error: "Unsupported tool name.", code: "invalid_tool" });
      return;
    }
    const payload =
      body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : {};
    try {
      const result = await executeServerAgentTool(uid, body.toolName, payload);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AgentTaskError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Agent tool execution failed.", code: "execute_failed" });
    }
  });

  return router;
}

export default createAgentTasksRouter();
