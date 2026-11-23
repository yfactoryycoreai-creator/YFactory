export type IdeClientType = "vscode" | "cursor" | "unknown";

export type IdeSessionItem = {
  id: string;
  ideName: IdeClientType;
  ideVersion: string;
  workspaceName: string;
  machineLabel: string;
  compatibilityTier: "supported" | "experimental_untested";
  status: "active" | "revoked";
  createdAt: number;
  lastSeenAt: number;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

export type IdeCodingModelItem = {
  provider: string;
  providerName: string;
  keyId: string;
  modelName: string;
};

export type IdeTaskCommandLog = {
  command: string;
  approved: boolean;
  exitCode: number | null;
  outputPreview: string;
  ranAt: number;
};

export type IdeTaskItem = {
  id: string;
  sessionId: string;
  workspaceName: string;
  prompt: string;
  provider: string;
  modelName: string;
  status: "running" | "awaiting_approval" | "completed" | "cancelled" | "failed";
  summary: string;
  filesRead: string[];
  filesModified: string[];
  commandsRun: IdeTaskCommandLog[];
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export class IdeCodeApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function ideRequest<T>(
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
    throw new IdeCodeApiError(
      typeof data.error === "string" ? data.error : "IDE request failed.",
      typeof data.code === "string" ? data.code : "ide_request_failed",
      resp.status,
    );
  }
  return data as T;
}

export async function generateIdePairingCode(idToken: string): Promise<{
  code: string;
  expiresAt: number;
  ttlSeconds: number;
}> {
  return ideRequest("/api/ide/pairing-code", idToken, { method: "POST" });
}

export async function fetchIdeSessions(
  idToken: string,
): Promise<IdeSessionItem[]> {
  const data = await ideRequest<{ sessions: IdeSessionItem[] }>(
    "/api/ide/sessions",
    idToken,
  );
  return data.sessions;
}

export async function disconnectIdeSession(
  idToken: string,
  sessionId: string,
): Promise<void> {
  await ideRequest(
    `/api/ide/sessions/${encodeURIComponent(sessionId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export async function fetchIdeCodingModels(
  idToken: string,
): Promise<IdeCodingModelItem[]> {
  const data = await ideRequest<{ models: IdeCodingModelItem[] }>(
    "/api/ide/models",
    idToken,
  );
  return data.models;
}

export async function fetchIdeTasks(idToken: string): Promise<IdeTaskItem[]> {
  const data = await ideRequest<{ tasks: IdeTaskItem[] }>(
    "/api/ide/tasks",
    idToken,
  );
  return data.tasks;
}

export async function cancelIdeCodingTask(
  idToken: string,
  taskId: string,
): Promise<IdeTaskItem> {
  const data = await ideRequest<{ task: IdeTaskItem }>(
    `/api/ide/tasks/${encodeURIComponent(taskId)}/cancel`,
    idToken,
    { method: "POST" },
  );
  return data.task;
}

export async function deleteIdeCodingTask(
  idToken: string,
  taskId: string,
): Promise<void> {
  await ideRequest(
    `/api/ide/tasks/${encodeURIComponent(taskId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export async function clearIdeTaskHistory(idToken: string): Promise<number> {
  const data = await ideRequest<{ cleared: number }>(
    "/api/ide/tasks",
    idToken,
    { method: "DELETE" },
  );
  return data.cleared;
}
