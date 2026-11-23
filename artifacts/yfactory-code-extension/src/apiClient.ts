import * as os from "node:os";
import * as vscode from "vscode";

const SECRET_ACCESS_KEY = "yfactoryCode.accessToken";
const SECRET_REFRESH_KEY = "yfactoryCode.refreshToken";
const SECRET_SERVER_KEY = "yfactoryCode.serverUrl";

export type IdeClientType = "vscode" | "cursor" | "unknown";

export type IdeSessionRecord = {
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

export type IdeCodingModelOption = {
  provider: string;
  providerName: string;
  keyId: string;
  modelName: string;
};

export type IdeAttachedFile = {
  path: string;
  content: string;
  language?: string;
};

export type IdeProposedEdit = {
  path: string;
  action: "edit" | "create" | "delete" | "rename";
  reason: string;
  summary: string;
  searchBlock?: string;
  replaceBlock?: string;
  newContent?: string;
  newPath?: string;
};

export type IdeProposedCommand = {
  command: string;
  cwd?: string;
  reason: string;
  riskLevel: "safe" | "caution" | "destructive";
};

export type IdeAgentActions = {
  requestFiles: string[];
  proposedEdits: IdeProposedEdit[];
  proposedCommands: IdeProposedCommand[];
  done: boolean;
};

export type IdeTaskRecord = {
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
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export type IdeAgentTurnResponse = {
  task: IdeTaskRecord;
  explanation: string;
  actions: IdeAgentActions;
  skippedSensitiveFiles: string[];
};

export class YFactoryApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function detectIdeType(): IdeClientType {
  const app = vscode.env.appName.toLowerCase();
  if (app.includes("cursor")) return "cursor";
  if (app.includes("visual studio code") || app.includes("vscode") || app === "code") {
    return "vscode";
  }
  return "unknown";
}

function normalizeServerUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(cleaned)) {
    throw new YFactoryApiError(
      "Enter a valid YFactory server URL (e.g. https://your-app.replit.dev).",
      "invalid_server_url",
      400,
    );
  }
  return cleaned;
}

export class YFactoryApiClient {
  private readonly secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async getServerUrl(): Promise<string> {
    const stored = await this.secrets.get(SECRET_SERVER_KEY);
    if (stored && stored.trim()) return stored.trim();
    const fromCfg = vscode.workspace
      .getConfiguration("yfactoryCode")
      .get<string>("serverUrl", "")
      .trim();
    return fromCfg.replace(/\/+$/, "");
  }

  async hasSession(): Promise<boolean> {
    const [url, token] = await Promise.all([
      this.getServerUrl(),
      this.secrets.get(SECRET_ACCESS_KEY),
    ]);
    return Boolean(url && token);
  }

  async pairWithCode(
    serverUrlInput: string,
    pairingCode: string,
    workspaceName: string,
  ): Promise<IdeSessionRecord> {
    const serverUrl = normalizeServerUrl(serverUrlInput);
    const resp = await this.rawFetch<{
      session: IdeSessionRecord;
      accessToken: string;
      refreshToken: string;
    }>(`${serverUrl}/api/ide/auth/exchange`, {
      method: "POST",
      body: JSON.stringify({
        code: pairingCode.trim().toUpperCase(),
        ideName: detectIdeType(),
        ideVersion: vscode.version,
        workspaceName,
        machineLabel: os.hostname() || "Local IDE",
      }),
    });

    await Promise.all([
      this.secrets.store(SECRET_SERVER_KEY, serverUrl),
      this.secrets.store(SECRET_ACCESS_KEY, resp.accessToken),
      this.secrets.store(SECRET_REFRESH_KEY, resp.refreshToken),
    ]);
    return resp.session;
  }

  async disconnect(): Promise<void> {
    const serverUrl = await this.getServerUrl();
    const accessToken = await this.secrets.get(SECRET_ACCESS_KEY);
    if (serverUrl && accessToken) {
      await this.rawFetch(`${serverUrl}/api/ide/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => undefined);
    }
    await Promise.all([
      this.secrets.delete(SECRET_ACCESS_KEY),
      this.secrets.delete(SECRET_REFRESH_KEY),
    ]);
  }

  async getStatus(): Promise<{ connected: boolean; session: IdeSessionRecord }> {
    return this.authFetch("/api/ide/extension/status");
  }

  async sendHeartbeat(workspaceName: string): Promise<void> {
    await this.authFetch("/api/ide/extension/heartbeat", {
      method: "POST",
      body: JSON.stringify({ workspaceName }),
    }).catch(() => undefined);
  }

  async listModels(): Promise<IdeCodingModelOption[]> {
    const data = await this.authFetch<{ models: IdeCodingModelOption[] }>(
      "/api/ide/extension/models",
    );
    return data.models;
  }

  async listTasks(): Promise<IdeTaskRecord[]> {
    const data = await this.authFetch<{ tasks: IdeTaskRecord[] }>(
      "/api/ide/extension/tasks",
    );
    return data.tasks;
  }

  async runAgentTurn(
    payload: {
      taskId?: string;
      provider: string;
      keyId: string;
      modelName: string;
      prompt: string;
      workspaceTree?: string[];
      attachedFiles?: IdeAttachedFile[];
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      toolFeedback?: string;
    },
    signal?: AbortSignal,
  ): Promise<IdeAgentTurnResponse> {
    return this.authFetch("/api/ide/extension/agent/turn", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    });
  }

  async reportTaskEvent(
    taskId: string,
    event: {
      status?: IdeTaskRecord["status"];
      filesModified?: string[];
      commandLog?: {
        command: string;
        approved: boolean;
        exitCode: number | null;
        outputPreview?: string;
      };
      errorMessage?: string | null;
    },
  ): Promise<void> {
    await this.authFetch(
      `/api/ide/extension/tasks/${encodeURIComponent(taskId)}/report`,
      {
        method: "POST",
        body: JSON.stringify(event),
      },
    ).catch(() => undefined);
  }

  private async refreshTokens(): Promise<string | null> {
    const serverUrl = await this.getServerUrl();
    const refreshToken = await this.secrets.get(SECRET_REFRESH_KEY);
    if (!serverUrl || !refreshToken) return null;
    try {
      const refreshed = await this.rawFetch<{
        accessToken: string;
        refreshToken: string;
      }>(`${serverUrl}/api/ide/auth/refresh`, {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      await Promise.all([
        this.secrets.store(SECRET_ACCESS_KEY, refreshed.accessToken),
        this.secrets.store(SECRET_REFRESH_KEY, refreshed.refreshToken),
      ]);
      return refreshed.accessToken;
    } catch {
      await Promise.all([
        this.secrets.delete(SECRET_ACCESS_KEY),
        this.secrets.delete(SECRET_REFRESH_KEY),
      ]);
      return null;
    }
  }

  private async authFetch<T>(
    routePath: string,
    init: RequestInit = {},
  ): Promise<T> {
    const serverUrl = await this.getServerUrl();
    let token = await this.secrets.get(SECRET_ACCESS_KEY);
    if (!serverUrl || !token) {
      throw new YFactoryApiError(
        "Sign in by pairing your IDE with YFactory AI first.",
        "not_connected",
        401,
      );
    }
    try {
      return await this.rawFetch<T>(`${serverUrl}${routePath}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      if (err instanceof YFactoryApiError && err.status === 401) {
        const nextToken = await this.refreshTokens();
        if (nextToken) {
          return this.rawFetch<T>(`${serverUrl}${routePath}`, {
            ...init,
            headers: {
              Authorization: `Bearer ${nextToken}`,
              ...(init.headers ?? {}),
            },
          });
        }
      }
      throw err;
    }
  }

  private async rawFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
    let resp: Response;
    try {
      resp = await fetch(url, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      if (init.signal?.aborted) {
        throw new YFactoryApiError("Task cancelled.", "aborted", 499);
      }
      throw new YFactoryApiError(
        `Could not reach YFactory server: ${err instanceof Error ? err.message : "network error"}`,
        "network_error",
        503,
      );
    }

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      throw new YFactoryApiError(
        typeof data.error === "string" ? data.error : `Server returned HTTP ${resp.status}`,
        typeof data.code === "string" ? data.code : "request_failed",
        resp.status,
      );
    }
    return data as T;
  }
}
