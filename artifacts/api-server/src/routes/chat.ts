import { Router, type IRouter, type Request, type Response } from "express";
import {
  clearChatVaultKeyFailure,
  getChatVaultEntry,
  listChatVaultKeys,
  recordChatVaultKeyFailure,
  type ChatVaultEntry,
  type ChatVaultKeyMetadata,
} from "../lib/apiKeyVault";
import {
  CHAT_ADAPTERS,
  chatProviderForModel,
  type ChatAdapterRegistry,
  type ChatMessage,
} from "../lib/chatAdapters";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import { ChatServiceError, completeWithRotation, type ChatFailureCode } from "../lib/chatService";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TOTAL_LENGTH = 12_000;

type ChatDependencies = {
  verifyIdToken: typeof verifyFirebaseIdToken;
  listKeys: (uid: string) => Promise<ChatVaultKeyMetadata[]>;
  getKey: (uid: string, provider: string, keyId: string) => Promise<ChatVaultEntry | null>;
  recordFailure: (uid: string, provider: string, keyId: string, status: number | null) => Promise<void>;
  clearFailure: (uid: string, provider: string, keyId: string) => Promise<void>;
  adapters: ChatAdapterRegistry;
};

type ParsedChatRequest = {
  provider: string;
  keyId: string;
  messages: ChatMessage[];
};

function parseChatRequest(body: unknown): ParsedChatRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const input = body as Record<string, unknown>;
  const provider = typeof input.provider === "string" ? input.provider : "";
  const keyId = typeof input.keyId === "string" ? input.keyId : "";
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(keyId) ||
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > MAX_MESSAGES
  ) return null;

  const messages: ChatMessage[] = [];
  let totalLength = 0;
  for (const item of input.messages) {
    if (typeof item !== "object" || item === null) return null;
    const message = item as Record<string, unknown>;
    if (
      (message.role !== "system" && message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > MAX_MESSAGE_LENGTH
    ) return null;
    totalLength += message.content.length;
    if (totalLength > MAX_TOTAL_LENGTH) return null;
    messages.push({ role: message.role, content: message.content });
  }
  if (!messages.some((message) => message.role === "user") ||
    messages[messages.length - 1]?.role !== "user") return null;
  return { provider, keyId, messages };
}

function createUserRateLimiter() {
  const requestsByUser = new Map<string, number[]>();
  return (uid: string, now = Date.now()): boolean => {
    const recent = (requestsByUser.get(uid) ?? []).filter(
      (timestamp) => now - timestamp < RATE_WINDOW_MS,
    );
    if (recent.length >= RATE_LIMIT) {
      requestsByUser.set(uid, recent);
      return false;
    }
    recent.push(now);
    requestsByUser.set(uid, recent);
    return true;
  };
}

export function createChatRouter(overrides: Partial<ChatDependencies> = {}): IRouter {
  const dependencies: ChatDependencies = {
    verifyIdToken: verifyFirebaseIdToken,
    listKeys: listChatVaultKeys,
    getKey: getChatVaultEntry,
    recordFailure: recordChatVaultKeyFailure,
    clearFailure: clearChatVaultKeyFailure,
    adapters: CHAT_ADAPTERS,
    ...overrides,
  };
  const router: IRouter = Router();
  const allowRequest = createUserRateLimiter();

  const authenticatedUid = async (req: Request, res: Response): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ code: "auth_failed" satisfies ChatFailureCode });
      return null;
    }
    try {
      const uid = await dependencies.verifyIdToken(token);
      if (uid) return uid;
    } catch {
      // Authentication errors do not expose Firebase configuration or token details.
    }
    res.status(401).json({ code: "auth_failed" satisfies ChatFailureCode });
    return null;
  };

  router.get("/chat/models", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    try {
      const keys = await dependencies.listKeys(uid);
      const now = Date.now();
      res.json({
        models: keys
          .filter((key) =>
            key.enabled &&
            !key.failed &&
            (!key.cooldownUntil || key.cooldownUntil <= now) &&
            chatProviderForModel(key.modelName) !== null
          )
          .map(({ provider, id, modelName }) => ({ provider, id, modelName })),
      });
    } catch {
      res.status(503).json({ code: "timeout" satisfies ChatFailureCode });
    }
  });

  router.post("/chat/completions", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const input = parseChatRequest(req.body);
    if (!input) {
      res.status(400).json({ code: "bad_prompt" satisfies ChatFailureCode });
      return;
    }
    if (!allowRequest(uid)) {
      res.status(429).json({ code: "rate_limited" satisfies ChatFailureCode });
      return;
    }

    let key: ChatVaultEntry | null;
    try {
      key = await dependencies.getKey(uid, input.provider, input.keyId);
    } catch {
      res.status(503).json({ code: "timeout" satisfies ChatFailureCode });
      return;
    }
    if (!key || !key.enabled) {
      res.status(404).json({ code: "missing_key" satisfies ChatFailureCode });
      return;
    }
    const adapter = chatProviderForModel(key.modelName);
    if (!adapter) {
      res.status(404).json({ code: "model_not_found" satisfies ChatFailureCode });
      return;
    }
    if (key.failed) {
      res.status(401).json({ code: "auth_failed" satisfies ChatFailureCode });
      return;
    }
    if (key.cooldownUntil && key.cooldownUntil > Date.now()) {
      res.status(429).json({ code: "rate_limited" satisfies ChatFailureCode });
      return;
    }

    try {
      const reply = await completeWithRotation({
        provider: adapter,
        model: key.modelName,
        messages: input.messages,
        keys: [{ id: key.id, value: key.value }],
        adapters: dependencies.adapters,
        onFailure: (keyId, status) =>
          dependencies.recordFailure(uid, key.provider, keyId, status),
        onSuccess: (keyId) =>
          dependencies.clearFailure(uid, key.provider, keyId),
      });
      res.json({ reply });
    } catch (error) {
      const code = error instanceof ChatServiceError ? error.code : "timeout";
      const status = code === "bad_prompt"
        ? 400
        : code === "model_not_found" || code === "missing_key"
          ? 404
          : code === "auth_failed"
            ? 401
            : code === "rate_limited"
              ? 429
              : 503;
      res.status(status).json({ code });
    }
  });

  return router;
}

export default createChatRouter();
