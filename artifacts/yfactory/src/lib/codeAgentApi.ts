export type CodeAgentMode = "agent" | "plan";

export type CodeAgentToolName =
  | "list_dir"
  | "find_files"
  | "grep_search"
  | "read_file"
  | "edit_file"
  | "write_file"
  | "delete_file"
  | "run_command";

export type CodeAgentToolCall = {
  id: string;
  tool: CodeAgentToolName;
  args: Record<string, unknown>;
  mutating: boolean;
  reason: string;
};

export type CodeAgentModelOption = {
  provider: string;
  providerName: string;
  keyId: string;
  modelName: string;
  recommendedForCode: boolean;
};

export type CliSessionSummary = {
  id: string;
  workspaceName: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
};

export type CodeAgentTurnResult = {
  thought: string;
  assistantMessage: string;
  toolCalls: CodeAgentToolCall[];
  done: boolean;
  modelUsed: {
    provider: string;
    keyId: string;
    modelName: string;
  };
  activeSkillsCount: number;
};

export class CodeAgentApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function codeAgentFetch<T>(
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
    throw new CodeAgentApiError(
      typeof data.error === "string"
        ? data.error
        : `Code Agent API failed (HTTP ${resp.status})`,
      typeof data.code === "string" ? data.code : `http_${resp.status}`,
      resp.status,
    );
  }
  return data as T;
}

export async function startCliPairingApi(
  idToken: string,
): Promise<{ code: string; expiresAt: number }> {
  return codeAgentFetch("/api/code-agent/pair/start", idToken, {
    method: "POST",
  });
}

export async function fetchCliSessionsApi(
  idToken: string,
): Promise<CliSessionSummary[]> {
  const data = await codeAgentFetch<{ sessions: CliSessionSummary[] }>(
    "/api/code-agent/sessions",
    idToken,
  );
  return data.sessions;
}

export async function revokeCliSessionApi(
  idToken: string,
  sessionId: string,
): Promise<void> {
  await codeAgentFetch(
    `/api/code-agent/sessions/${encodeURIComponent(sessionId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export async function fetchCodeAgentModelsApi(
  idToken: string,
): Promise<CodeAgentModelOption[]> {
  const data = await codeAgentFetch<{ models: CodeAgentModelOption[] }>(
    "/api/code-agent/models",
    idToken,
  );
  return data.models;
}

export async function runCodeAgentTurnApi(
  idToken: string,
  input: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    workspace?: {
      name?: string;
      os?: string;
      shell?: string;
      gitBranch?: string;
      projectTree?: string;
      yfactoryMd?: string;
    };
    mode?: CodeAgentMode;
    modelSelection?: {
      provider: string;
      keyId: string;
      modelName: string;
    };
    locale?: string;
  },
): Promise<CodeAgentTurnResult> {
  return codeAgentFetch("/api/code-agent/turn", idToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}