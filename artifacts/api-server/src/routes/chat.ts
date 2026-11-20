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
  ChatAbortError,
  chatProviderForModel,
  type ChatAdapterRegistry,
  type ChatMessage,
} from "../lib/chatAdapters";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  ChatServiceError,
  completeWithRotation,
  streamWithRotation,
  type ChatFailureCode,
} from "../lib/chatService";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_TOTAL_LENGTH = 32_000;

type ChatDependencies = {
  verifyIdToken: typeof verifyFirebaseIdToken;
  listKeys: (uid: string) => Promise<ChatVaultKeyMetadata[]>;
  getKey: (
    uid: string,
    provider: string,
    keyId: string,
    modelName?: string,
  ) => Promise<ChatVaultEntry | null>;
  recordFailure: (uid: string, provider: string, keyId: string, status: number | null) => Promise<void>;
  clearFailure: (uid: string, provider: string, keyId: string) => Promise<void>;
  adapters: ChatAdapterRegistry;
};

type ParsedChatRequest = {
  provider: string;
  keyId: string;
  modelName?: string;
  messages: ChatMessage[];
};

function parseChatRequest(body: unknown): ParsedChatRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const input = body as Record<string, unknown>;
  const provider = typeof input.provider === "string" ? input.provider : "";
  const keyId = typeof input.keyId === "string" ? input.keyId : "";
  const modelName = input.modelName;
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(keyId) ||
    (modelName !== undefined &&
      (typeof modelName !== "string" || !modelName.trim() || modelName.length > 200)) ||
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
  return {
    provider,
    keyId,
    ...(typeof modelName === "string" ? { modelName: modelName.trim() } : {}),
    messages,
  };
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

function statusForFailureCode(code: ChatFailureCode): number {
  if (code === "bad_prompt") return 400;
  if (code === "model_not_found" || code === "missing_key") return 404;
  if (code === "auth_failed") return 401;
  if (code === "rate_limited") return 429;
  return 503;
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
          .map(({ provider, id, providerName, modelName }) => ({
            provider,
            id,
            providerName,
            modelName,
          })),
      });
    } catch {
      res.status(503).json({ code: "timeout" satisfies ChatFailureCode });
    }
  });

  const resolveValidatedChatTarget = async (
    req: Request,
    res: Response,
  ): Promise<{
    uid: string;
    input: ParsedChatRequest;
    key: ChatVaultEntry;
    adapter: NonNullable<ReturnType<typeof chatProviderForModel>>;
  } | null> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return null;
    const input = parseChatRequest(req.body);
    if (!input) {
      res.status(400).json({ code: "bad_prompt" satisfies ChatFailureCode });
      return null;
    }
    if (!allowRequest(uid)) {
      res.status(429).json({ code: "rate_limited" satisfies ChatFailureCode });
      return null;
    }

    let key: ChatVaultEntry | null;
    try {
      key = await dependencies.getKey(
        uid,
        input.provider,
        input.keyId,
        input.modelName,
      );
    } catch {
      res.status(503).json({ code: "timeout" satisfies ChatFailureCode });
      return null;
    }
    if (!key || !key.enabled) {
      res.status(404).json({ code: "missing_key" satisfies ChatFailureCode });
      return null;
    }
    const adapter = chatProviderForModel(key.modelName);
    if (!adapter) {
      res.status(404).json({ code: "model_not_found" satisfies ChatFailureCode });
      return null;
    }
    if (key.failed) {
      res.status(401).json({ code: "auth_failed" satisfies ChatFailureCode });
      return null;
    }
    if (key.cooldownUntil && key.cooldownUntil > Date.now()) {
      res.status(429).json({ code: "rate_limited" satisfies ChatFailureCode });
      return null;
    }
    return { uid, input, key, adapter };
  };

  router.post("/chat/completions", async (req, res): Promise<void> => {
    const target = await resolveValidatedChatTarget(req, res);
    if (!target) return;
    const { uid, input, key, adapter } = target;

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
      res.status(statusForFailureCode(code)).json({ code });
    }
  });

  router.post("/chat/completions/stream", async (req, res): Promise<void> => {
    const target = await resolveValidatedChatTarget(req, res);
    if (!target) return;
    const { uid, input, key, adapter } = target;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abortController = new AbortController();
    const handleClose = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    req.on("close", handleClose);

    const writeEvent = (payload: Record<string, unknown>) => {
      if (res.writableEnded || abortController.signal.aborted) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await streamWithRotation({
        provider: adapter,
        model: key.modelName,
        messages: input.messages,
        keys: [{ id: key.id, value: key.value }],
        adapters: dependencies.adapters,
        signal: abortController.signal,
        onChunk: (delta) => {
          writeEvent({ type: "delta", content: delta });
        },
        onFailure: (keyId, status) =>
          dependencies.recordFailure(uid, key.provider, keyId, status),
        onSuccess: (keyId) =>
          dependencies.clearFailure(uid, key.provider, keyId),
      });
      writeEvent({ type: "done" });
    } catch (error) {
      if (!(error instanceof ChatAbortError) && !abortController.signal.aborted) {
        const code = error instanceof ChatServiceError ? error.code : "timeout";
        writeEvent({ type: "error", code });
      }
    } finally {
      req.off("close", handleClose);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}

export default createChatRouter();
