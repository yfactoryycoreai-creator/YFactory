export type AgentSectionTarget =
  | "image"
  | "stories"
  | "video"
  | "code"
  | "students"
  | "provider_center";

export type AgentToolName =
  | "generate_image"
  | "story_setup"
  | "generate_video"
  | "code_workspace_task"
  | "student_study_assist"
  | "provider_recommend";

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentTaskItem = {
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
    videoJobId?: string;
    providerId?: string;
    ideSessionId?: string;
  } | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export class AgentTasksApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function agentRequest<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new AgentTasksApiError(
      typeof data.error === "string" ? data.error : "Agent request failed.",
      typeof data.code === "string" ? data.code : "agent_request_failed",
      resp.status,
    );
  }
  return data as T;
}

export async function fetchAgentTasks(idToken: string): Promise<AgentTaskItem[]> {
  const data = await agentRequest<{ tasks: AgentTaskItem[] }>(
    "/api/agent/tasks",
    idToken,
  );
  return data.tasks;
}

export async function createClientAgentTask(
  idToken: string,
  input: {
    toolName: AgentToolName;
    section: AgentSectionTarget;
    title: string;
    status?: AgentTaskStatus;
    progress?: number;
    stepLabel?: string;
    payload?: Record<string, unknown>;
  },
): Promise<AgentTaskItem> {
  const data = await agentRequest<{ task: AgentTaskItem }>(
    "/api/agent/tasks",
    idToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.task;
}

export async function patchClientAgentTask(
  idToken: string,
  taskId: string,
  patch: Partial<{
    status: AgentTaskStatus;
    progress: number;
    stepLabel: string;
    resultSummary: string | null;
    targetRef: AgentTaskItem["targetRef"];
    errorMessage: string | null;
  }>,
): Promise<AgentTaskItem> {
  const data = await agentRequest<{ task: AgentTaskItem }>(
    `/api/agent/tasks/${encodeURIComponent(taskId)}`,
    idToken,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.task;
}

export async function executeServerAgentToolApi(
  idToken: string,
  toolName: AgentToolName,
  payload: Record<string, unknown>,
): Promise<{ task: AgentTaskItem; data: Record<string, unknown> }> {
  return agentRequest("/api/agent/execute", idToken, {
    method: "POST",
    body: JSON.stringify({ toolName, payload }),
  });
}

export async function cancelAgentTaskApi(
  idToken: string,
  taskId: string,
): Promise<AgentTaskItem> {
  const data = await agentRequest<{ task: AgentTaskItem }>(
    `/api/agent/tasks/${encodeURIComponent(taskId)}/cancel`,
    idToken,
    { method: "POST" },
  );
  return data.task;
}

export async function retryAgentTaskApi(
  idToken: string,
  taskId: string,
): Promise<{ task: AgentTaskItem; data: Record<string, unknown> }> {
  return agentRequest(`/api/agent/tasks/${encodeURIComponent(taskId)}/retry`, idToken, {
    method: "POST",
  });
}

export async function deleteAgentTaskApi(
  idToken: string,
  taskId: string,
): Promise<void> {
  await agentRequest(`/api/agent/tasks/${encodeURIComponent(taskId)}`, idToken, {
    method: "DELETE",
  });
}

export async function clearFinishedAgentTasksApi(
  idToken: string,
): Promise<number> {
  const data = await agentRequest<{ cleared: number }>("/api/agent/tasks", idToken, {
    method: "DELETE",
  });
  return data.cleared;
}
