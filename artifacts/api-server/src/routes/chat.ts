import { Router, type IRouter, type Request, type Response } from "express";
import {
  clearGeminiChatKeyFailure,
  getGeminiChatKeyPool,
  recordGeminiChatKeyFailure,
  type GeminiChatKeyPool,
} from "../lib/apiKeyVault";
import {
  CHAT_ADAPTERS,
  type ChatAdapterRegistry,
  type ChatMessage,
  type ChatProvider,
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
  getKeyPool: (uid: string) => Promise<GeminiChatKeyPool>;
  recordFailure: (uid: string, keyId: string, status: number | null) => Promise<void>;
  clearFailure: (uid: string, keyId: string) => Promise<void>;
  adapters: ChatAdapterRegistry;
};

type ParsedChatRequest = {
  provider: ChatProvider;
  model: string;
  messages: ChatMessage[];
};

function parseChatRequest(body: unknown): ParsedChatRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const input = body as Record<string, unknown>;
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (
    input.provider !== "gemini" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model) ||
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
  return { provider: "gemini", model, messages };
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
    getKeyPool: getGeminiChatKeyPool,
    recordFailure: recordGeminiChatKeyFailure,
    clearFailure: clearGeminiChatKeyFailure,
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

  router.get("/chat/providers", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    try {
      const pool = await dependencies.getKeyPool(uid);
      res.json({
        providers: pool.hasAny ? [{ id: "gemini", name: "Gemini" }] : [],
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

    let pool: GeminiChatKeyPool;
    try {
      pool = await dependencies.getKeyPool(uid);
    } catch {
      res.status(503).json({ code: "timeout" satisfies ChatFailureCode });
      return;
    }
    if (!pool.hasAny) {
      res.status(404).json({ code: "missing_key" satisfies ChatFailureCode });
      return;
    }
    if (pool.keys.length === 0) {
      const code: ChatFailureCode = pool.hasAuthFailed
        ? "auth_failed"
        : pool.hasCooldown
          ? "rate_limited"
          : "timeout";
      res.status(code === "rate_limited" ? 429 : 503).json({ code });
      return;
    }

    try {
      const reply = await completeWithRotation({
        ...input,
        keys: pool.keys,
        adapters: dependencies.adapters,
        onFailure: (keyId, status) => dependencies.recordFailure(uid, keyId, status),
        onSuccess: (keyId) => dependencies.clearFailure(uid, keyId),
      });
      res.json({ reply });
    } catch (error) {
      const code = error instanceof ChatServiceError ? error.code : "timeout";
      const status = code === "bad_prompt" ? 400 : code === "rate_limited" ? 429 : 503;
      res.status(status).json({ code });
    }
  });

  return router;
}

export default createChatRouter();
