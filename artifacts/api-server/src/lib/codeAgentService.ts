import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  clearChatVaultKeyFailure,
  getChatVaultEntry,
  listChatVaultKeys,
  recordChatVaultKeyFailure,
  type ChatVaultEntry,
} from "./apiKeyVault";
import { CHAT_ADAPTERS, type ChatMessage } from "./chatAdapters";
import { ChatServiceError, completeWithRotation } from "./chatService";
import { getFirebaseAdmin } from "./firebaseAdmin";
import {
  getActiveSkillInstructionsForScope,
  getUserSkillsSnapshot,
  BUILTIN_SKILL_INSTRUCTIONS,
} from "./skillsService";

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

export type CodeAgentWorkspaceContext = {
  name?: string;
  os?: string;
  shell?: string;
  gitBranch?: string;
  projectTree?: string;
  yfactoryMd?: string;
};

export type CodeAgentModelSelection = {
  provider: string;
  keyId: string;
  modelName: string;
};

export type CodeAgentHistoryItem = {
  role: "user" | "assistant";
  content: string;
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

export type CliSessionSummary = {
  id: string;
  workspaceName: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
};

export class CodeAgentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const VALID_TOOLS: ReadonlySet<CodeAgentToolName> = new Set([
  "list_dir",
  "find_files",
  "grep_search",
  "read_file",
  "edit_file",
  "write_file",
  "delete_file",
  "run_command",
]);

const MUTATING_TOOLS: ReadonlySet<CodeAgentToolName> = new Set([
  "edit_file",
  "write_file",
  "delete_file",
  "run_command",
]);

const PAIRING_TTL_MS = 10 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60_000;
const lastSeenUpdateCache = new Map<string, number>();

function pairingsCollection() {
  return getFirebaseAdmin().db.collection("codeCliPairings");
}

function cliSessionsCollection() {
  return getFirebaseAdmin().db.collection("codeCliSessions");
}

function userCliSessionsCollection(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("codeCliSessions");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

/* ==================== CLI PAIRING & SESSION AUTH ==================== */

export async function createCliPairingCode(uid: string): Promise<{
  code: string;
  expiresAt: number;
}> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[bytes[i]! % alphabet.length];
  }
  const displayCode = `YF-${suffix}`;
  const docId = normalizePairingCode(displayCode);
  const now = Date.now();
  const expiresAt = now + PAIRING_TTL_MS;

  await pairingsCollection().doc(docId).set({
    uid,
    displayCode,
    used: false,
    createdAt: now,
    expiresAt,
    expiresAtTs: Timestamp.fromMillis(expiresAt),
  });

  return { code: displayCode, expiresAt };
}

export async function exchangeCliPairingCode(input: {
  code: string;
  workspaceName?: string;
  platform?: string;
}): Promise<{
  sessionToken: string;
  sessionId: string;
  workspaceName: string;
}> {
  const docId = normalizePairingCode(input.code ?? "");
  if (docId.length < 6) {
    throw new CodeAgentError("Invalid pairing code format.", "invalid_code", 400);
  }

  const ref = pairingsCollection().doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new CodeAgentError(
      "Pairing code not found or expired. Generate a new code in the Code tab.",
      "code_not_found",
      404,
    );
  }
  const d = snap.data() ?? {};
  const now = Date.now();
  if (d.used === true || typeof d.expiresAt !== "number" || d.expiresAt < now) {
    await ref.delete().catch(() => undefined);
    throw new CodeAgentError(
      "Pairing code expired or already used. Generate a fresh code in YFactory Code.",
      "code_expired",
      410,
    );
  }

  const uid = String(d.uid ?? "").trim();
  if (!uid) {
    throw new CodeAgentError("Invalid pairing owner.", "invalid_code", 400);
  }

  await ref.delete().catch(() => undefined);

  const sessionToken = `yfc_${randomBytes(28).toString("base64url")}`;
  const tokenHash = sha256(sessionToken);
  const sessionId = `cli_${now}_${randomBytes(4).toString("hex")}`;
  const workspaceName =
    (input.workspaceName ?? "").trim().slice(0, 100) || "Local Workspace";
  const platform = (input.platform ?? "").trim().slice(0, 60) || "node-cli";

  const record = {
    sessionId,
    uid,
    tokenHash,
    workspaceName,
    platform,
    createdAt: now,
    lastSeenAt: now,
  };

  await Promise.all([
    cliSessionsCollection().doc(tokenHash).set(record),
    userCliSessionsCollection(uid).doc(sessionId).set({
      id: sessionId,
      tokenHash,
      workspaceName,
      platform,
      createdAt: now,
      lastSeenAt: now,
    }),
  ]);

  return { sessionToken, sessionId, workspaceName };
}

export async function verifyCliSessionToken(token: string): Promise<{
  uid: string;
  sessionId: string;
  workspaceName: string;
} | null> {
  if (!token || !token.startsWith("yfc_") || token.length < 24) return null;
  const tokenHash = sha256(token);
  const snap = await cliSessionsCollection().doc(tokenHash).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const uid = String(d.uid ?? "");
  const sessionId = String(d.sessionId ?? "");
  const workspaceName = String(d.workspaceName ?? "Workspace");
  if (!uid || !sessionId) return null;

  const now = Date.now();
  const prevTouch = lastSeenUpdateCache.get(sessionId) ?? 0;
  if (now - prevTouch > LAST_SEEN_THROTTLE_MS) {
    lastSeenUpdateCache.set(sessionId, now);
    void Promise.all([
      cliSessionsCollection().doc(tokenHash).update({ lastSeenAt: now }),
      userCliSessionsCollection(uid).doc(sessionId).update({ lastSeenAt: now }),
    ]).catch(() => undefined);
  }

  return { uid, sessionId, workspaceName };
}

export async function listCliSessions(uid: string): Promise<CliSessionSummary[]> {
  const snap = await userCliSessionsCollection(uid)
    .orderBy("lastSeenAt", "desc")
    .limit(20)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data() ?? {};
    return {
      id: doc.id,
      workspaceName: String(d.workspaceName ?? "Workspace"),
      platform: String(d.platform ?? "node-cli"),
      createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
      lastSeenAt: typeof d.lastSeenAt === "number" ? d.lastSeenAt : Date.now(),
    };
  });
}

export async function revokeCliSession(
  uid: string,
  sessionId: string,
): Promise<boolean> {
  const userRef = userCliSessionsCollection(uid).doc(sessionId);
  const snap = await userRef.get();
  if (!snap.exists) return false;
  const tokenHash = String(snap.data()?.tokenHash ?? "");
  await userRef.delete();
  if (tokenHash) {
    await cliSessionsCollection()
      .doc(tokenHash)
      .delete()
      .catch(() => undefined);
  }
  lastSeenUpdateCache.delete(sessionId);
  return true;
}

/* ==================== MODEL & SKILL RESOLUTION ==================== */

export async function listCodeAgentModels(uid: string): Promise<
  Array<{
    provider: string;
    providerName: string;
    keyId: string;
    modelName: string;
    recommendedForCode: boolean;
  }>
> {
  const allKeys = await listChatVaultKeys(uid);
  const now = Date.now();
  const usable = allKeys.filter(
    (k) =>
      k.enabled &&
      !k.failed &&
      (!k.cooldownUntil || k.cooldownUntil <= now) &&
      k.provider in CHAT_ADAPTERS,
  );

  const codeRank = (m: string, p: string): number => {
    const hay = `${p}:${m}`.toLowerCase();
    if (/claude-(?:3\.5|3\.7|4|sonnet|opus)/.test(hay)) return 0;
    if (/gemini-(?:2\.5|2\.0|3|pro|flash)/.test(hay)) return 1;
    if (/gpt-(?:4\.1|4o|5)|o3|o4|codex/.test(hay)) return 2;
    if (/deepseek|qwen.*coder|codestral/.test(hay)) return 3;
    return 4;
  };

  usable.sort(
    (a, b) =>
      codeRank(a.modelName, a.provider) - codeRank(b.modelName, b.provider),
  );

  return usable.map((k) => ({
    provider: k.provider,
    providerName: k.providerName || k.provider,
    keyId: k.id,
    modelName: k.modelName,
    recommendedForCode: codeRank(k.modelName, k.provider) <= 3,
  }));
}

export async function listActiveCodeSkills(uid: string): Promise<
  Array<{ id: string; name: string; scopes: string[]; isBuiltIn: boolean }>
> {
  const snap = await getUserSkillsSnapshot(uid);
  const customById = new Map(snap.customSkills.map((s) => [s.id, s]));
  const out: Array<{
    id: string;
    name: string;
    scopes: string[];
    isBuiltIn: boolean;
  }> = [];

  for (const id of snap.activeIds) {
    const b = BUILTIN_SKILL_INSTRUCTIONS[id];
    if (b && (b.scopes.includes("all") || b.scopes.includes("code"))) {
      out.push({ id, name: b.name, scopes: b.scopes, isBuiltIn: true });
      continue;
    }
    const c = customById.get(id);
    if (c && (c.scopes.includes("all") || c.scopes.includes("code"))) {
      out.push({ id, name: c.name, scopes: c.scopes, isBuiltIn: false });
    }
  }
  return out;
}

async function resolveCodeModelEntry(
  uid: string,
  preferred?: Partial<CodeAgentModelSelection>,
): Promise<ChatVaultEntry> {
  if (preferred?.provider && preferred?.keyId && preferred?.modelName) {
    const entry = await getChatVaultEntry(
      uid,
      preferred.provider,
      preferred.keyId,
      preferred.modelName,
    );
    if (!entry || !entry.enabled) {
      throw new CodeAgentError(
        `Model "${preferred.modelName}" is not enabled in Provider Center.`,
        "missing_key",
        404,
      );
    }
    if (entry.failed) {
      throw new CodeAgentError(
        `API key for "${preferred.modelName}" failed auth. Check Provider Center or switch model with /model.`,
        "auth_failed",
        401,
      );
    }
    if (entry.cooldownUntil && entry.cooldownUntil > Date.now()) {
      const waitSec = Math.ceil((entry.cooldownUntil - Date.now()) / 1000);
      throw new CodeAgentError(
        `"${preferred.modelName}" is rate-limited (${waitSec}s cooldown). Switch model with /model or wait.`,
        "rate_limited",
        429,
      );
    }
    return entry;
  }

  const ranked = await listCodeAgentModels(uid);
  for (const cand of ranked) {
    const entry = await getChatVaultEntry(uid, cand.provider, cand.keyId, cand.modelName);
    if (entry && entry.enabled && !entry.failed) return entry;
  }

  throw new CodeAgentError(
    "No enabled AI model found. Add and enable a model (Claude, Gemini, OpenAI, DeepSeek, Groq, or OpenRouter) in YFactory Provider Center.",
    "missing_key",
    404,
  );
}

/* ==================== AGENTIC SYSTEM PROMPT & PARSING ==================== */

function buildCodeAgentSystemPrompt(input: {
  mode: CodeAgentMode;
  workspace: CodeAgentWorkspaceContext;
  skillsBlock: string;
  locale: string;
}): string {
  const isAr = input.locale.toLowerCase().startsWith("ar");
  const isPlan = input.mode === "plan";

  const lines: string[] = [
    `You are **YFactory Code**, an autonomous senior software engineering agent modeled on Claude Code, running directly inside the user's real development workspace.`,
    `Mode: ${isPlan ? "PLAN MODE (READ-ONLY — inspect files and produce a crystal-clear implementation plan; NEVER emit mutating tools)" : "AGENT MODE (AUTONOMOUS — inspect, edit files, run build/test commands, verify fixes until complete)"}.`,
    `Language: Reply in ${isAr ? "Arabic (keeping code, paths, and identifiers in English)" : "the user's language"}.`,
    ``,
    `WORKSPACE ENVIRONMENT:`,
    `- Project: ${input.workspace.name || "Workspace"}`,
    `- OS / Shell: ${input.workspace.os || "linux"} / ${input.workspace.shell || "bash"}`,
    input.workspace.gitBranch ? `- Git Branch: ${input.workspace.gitBranch}` : "",
    input.workspace.projectTree
      ? `\nPROJECT TREE (truncated):\n${input.workspace.projectTree.slice(0, 6000)}`
      : "",
    input.workspace.yfactoryMd
      ? `\nPROJECT MEMORY (YFACTORY.md — follow strictly):\n${input.workspace.yfactoryMd.slice(0, 5000)}`
      : "",
    input.skillsBlock ? `\n${input.skillsBlock}` : "",
    ``,
    `AVAILABLE TOOLS:`,
    `1. list_dir: {"path": ".", "maxDepth": 2} — inspect directory entries`,
    `2. find_files: {"pattern": "*.tsx", "maxResults": 40} — find files matching substring or glob`,
    `3. grep_search: {"query": "symbolName", "path": "src", "isRegex": false} — search code lines across workspace`,
    `4. read_file: {"path": "src/App.tsx", "startLine": 1, "endLine": 160} — read file with line numbers (read before editing!)`,
    isPlan
      ? `NOTE: Mutating tools (edit_file, write_file, delete_file, run_command) are DISABLED in PLAN MODE.`
      : [
          `5. edit_file: {"path": "src/App.tsx", "oldText": "exact snippet to replace", "newText": "replacement snippet", "reason": "why"} — PREFERRED for modifying existing files. oldText MUST match the file verbatim with enough surrounding lines to be unique.`,
          `6. write_file: {"path": "src/newFile.ts", "content": "full file content", "reason": "why"} — create new files or full rewrites.`,
          `7. delete_file: {"path": "src/obsolete.ts", "reason": "why"} — remove a file.`,
          `8. run_command: {"command": "npm run typecheck", "cwd": ".", "timeoutSec": 45, "reason": "verify build"} — run tests, typecheck, lint, or git status.`,
        ].join("\n"),
    ``,
    `CORE ENGINEERING DISCIPLINE:`,
    `- ALWAYS inspect relevant files with read_file / grep_search BEFORE proposing edits. Never guess file contents.`,
    `- Keep edits minimal, clean, and surgical using edit_file whenever possible.`,
    `- After code edits in Agent Mode, run a verification command (e.g. typecheck/build/test) if relevant, and fix any errors automatically.`,
    `- Never invent tool outputs or claim a file was edited unless you received an OK tool result.`,
    ``,
    `STRICT RESPONSE FORMAT:`,
    `You MUST respond with EXACTLY ONE valid JSON object (no markdown outside the JSON, or wrapped in a single \`\`\`json block):`,
    `{`,
    `  "thought": "brief internal reasoning for this step",`,
    `  "assistantMessage": "clear concise message shown to the user (empty string if silently running inspection tools)",`,
    `  "toolCalls": [`,
    `    { "tool": "read_file", "args": { "path": "package.json", "startLine": 1, "endLine": 80 }, "reason": "Inspect scripts and dependencies" }`,
    `  ],`,
    `  "done": false`,
    `}`,
    `Rules:`,
    `- When you need tool execution, set "done": false and include 1 to 4 focused toolCalls.`,
    `- When the task is complete (or you need user clarification), set "toolCalls": [], "done": true, and give a crisp summary in "assistantMessage".`,
  ];

  return lines.filter((l) => l !== "").join("\n");
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1]!.trim() : raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sanitizeToolCalls(
  raw: unknown,
  mode: CodeAgentMode,
): CodeAgentToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: CodeAgentToolCall[] = [];
  for (let i = 0; i < Math.min(raw.length, 5); i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const tool = String(obj.tool ?? "").trim() as CodeAgentToolName;
    if (!VALID_TOOLS.has(tool)) continue;
    const mutating = MUTATING_TOOLS.has(tool);
    if (mode === "plan" && mutating) {
      continue;
    }
    const args =
      obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
        ? (obj.args as Record<string, unknown>)
        : {};
    const reason =
      typeof obj.reason === "string" && obj.reason.trim()
        ? obj.reason.trim().slice(0, 240)
        : typeof args.reason === "string"
          ? args.reason.trim().slice(0, 240)
          : tool;

    out.push({
      id: `tc_${Date.now()}_${i}_${randomBytes(2).toString("hex")}`,
      tool,
      args,
      mutating,
      reason,
    });
  }
  return out;
}

export async function runCodeAgentTurn(
  uid: string,
  input: {
    messages: CodeAgentHistoryItem[];
    workspace?: CodeAgentWorkspaceContext;
    mode?: CodeAgentMode;
    modelSelection?: Partial<CodeAgentModelSelection>;
    locale?: string;
  },
): Promise<CodeAgentTurnResult> {
  const cleanMessages = (Array.isArray(input.messages) ? input.messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-30)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 24_000),
    }));

  if (cleanMessages.length === 0) {
    throw new CodeAgentError("Provide a coding task or message.", "empty_messages", 400);
  }

  const mode: CodeAgentMode = input.mode === "plan" ? "plan" : "agent";
  const locale = input.locale?.trim() || "en";

  const [entry, skillsBlock, activeSkills] = await Promise.all([
    resolveCodeModelEntry(uid, input.modelSelection),
    getActiveSkillInstructionsForScope(uid, "code").catch(() => ""),
    listActiveCodeSkills(uid).catch(() => []),
  ]);

  const sysPrompt = buildCodeAgentSystemPrompt({
    mode,
    workspace: input.workspace ?? {},
    skillsBlock,
    locale,
  });

  const chatMessages: ChatMessage[] = [
    { role: "system", content: sysPrompt },
    ...cleanMessages,
  ];

  let rawReply: string;
  try {
    rawReply = await completeWithRotation({
      provider: entry.provider as never,
      model: entry.modelName,
      messages: chatMessages,
      keys: [{ id: entry.id, value: entry.value }],
      adapters: CHAT_ADAPTERS,
      onFailure: (kId, status) =>
        recordChatVaultKeyFailure(uid, entry.provider, kId, status),
      onSuccess: (kId) =>
        clearChatVaultKeyFailure(uid, entry.provider, kId),
    });
  } catch (err) {
    const code = err instanceof ChatServiceError ? err.code : "timeout";
    const status =
      code === "auth_failed" ? 401 : code === "rate_limited" ? 429 : 503;
    throw new CodeAgentError(
      `${entry.modelName}: Code Agent request failed (${code}).`,
      code,
      status,
    );
  }

  const parsed = tryParseJsonObject(rawReply);
  if (!parsed) {
    return {
      thought: "",
      assistantMessage: rawReply.trim(),
      toolCalls: [],
      done: true,
      modelUsed: {
        provider: entry.provider,
        keyId: entry.id,
        modelName: entry.modelName,
      },
      activeSkillsCount: activeSkills.length,
    };
  }

  const toolCalls = sanitizeToolCalls(parsed.toolCalls, mode);
  const assistantMessage =
    typeof parsed.assistantMessage === "string"
      ? parsed.assistantMessage.trim()
      : "";
  const thought =
    typeof parsed.thought === "string" ? parsed.thought.trim().slice(0, 600) : "";
  const done = toolCalls.length === 0 ? true : parsed.done === true;

  return {
    thought,
    assistantMessage,
    toolCalls,
    done,
    modelUsed: {
      provider: entry.provider,
      keyId: entry.id,
      modelName: entry.modelName,
    },
    activeSkillsCount: activeSkills.length,
  };
}