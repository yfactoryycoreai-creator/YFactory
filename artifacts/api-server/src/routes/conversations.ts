import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  createChatConversation,
  deleteChatConversation,
  getChatConversation,
  listChatConversations,
  sanitizeMessages,
  updateChatConversation,
} from "../lib/chatConversations";

type ConversationDependencies = {
  verifyIdToken: typeof verifyFirebaseIdToken;
  list: typeof listChatConversations;
  get: typeof getChatConversation;
  create: typeof createChatConversation;
  update: typeof updateChatConversation;
  remove: typeof deleteChatConversation;
};

function isValidConversationId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export function createConversationsRouter(
  overrides: Partial<ConversationDependencies> = {},
): IRouter {
  const dependencies: ConversationDependencies = {
    verifyIdToken: verifyFirebaseIdToken,
    list: listChatConversations,
    get: getChatConversation,
    create: createChatConversation,
    update: updateChatConversation,
    remove: deleteChatConversation,
    ...overrides,
  };
  const router: IRouter = Router();

  const authenticatedUid = async (req: Request, res: Response): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to access conversations.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await dependencies.verifyIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose token or Firebase config details.
    }
    res.status(401).json({ error: "Sign in again to access conversations.", code: "auth_failed" });
    return null;
  };

  router.get("/chat/conversations", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    try {
      const conversations = await dependencies.list(uid);
      res.json({ conversations });
    } catch (error) {
      req.log?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "Could not list chat conversations.",
      );
      res.status(503).json({ error: "Could not load conversations.", code: "storage_unavailable" });
    }
  });

  router.post("/chat/conversations", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const body = typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)
      : {};
    try {
      const conversation = await dependencies.create(uid, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
        ...(body.projectName === null || typeof body.projectName === "string"
          ? { projectName: body.projectName }
          : {}),
        ...(body.modelProvider === null || typeof body.modelProvider === "string"
          ? { modelProvider: body.modelProvider }
          : {}),
        ...(body.modelKeyId === null || typeof body.modelKeyId === "string"
          ? { modelKeyId: body.modelKeyId }
          : {}),
        ...(body.modelName === null || typeof body.modelName === "string"
          ? { modelName: body.modelName }
          : {}),
        ...(Array.isArray(body.messages) ? { messages: sanitizeMessages(body.messages) } : {}),
      });
      res.status(201).json({ conversation });
    } catch (error) {
      req.log?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "Could not create chat conversation.",
      );
      res.status(503).json({ error: "Could not create conversation.", code: "storage_unavailable" });
    }
  });

  router.get("/chat/conversations/:conversationId", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const conversationId = String(req.params.conversationId ?? "");
    if (!isValidConversationId(conversationId)) {
      res.status(400).json({ error: "Invalid conversation ID.", code: "invalid_request" });
      return;
    }
    try {
      const conversation = await dependencies.get(uid, conversationId);
      if (!conversation) {
        res.status(404).json({ error: "Conversation not found.", code: "not_found" });
        return;
      }
      res.json({ conversation });
    } catch (error) {
      req.log?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "Could not read chat conversation.",
      );
      res.status(503).json({ error: "Could not load conversation.", code: "storage_unavailable" });
    }
  });

  router.patch("/chat/conversations/:conversationId", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const conversationId = String(req.params.conversationId ?? "");
    if (!isValidConversationId(conversationId)) {
      res.status(400).json({ error: "Invalid conversation ID.", code: "invalid_request" });
      return;
    }
    const body = typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)
      : null;
    if (!body) {
      res.status(400).json({ error: "Provide valid update fields.", code: "invalid_request" });
      return;
    }
    try {
      const updated = await dependencies.update(uid, conversationId, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
        ...(body.projectName === null || typeof body.projectName === "string"
          ? { projectName: body.projectName }
          : {}),
        ...(body.modelProvider === null || typeof body.modelProvider === "string"
          ? { modelProvider: body.modelProvider }
          : {}),
        ...(body.modelKeyId === null || typeof body.modelKeyId === "string"
          ? { modelKeyId: body.modelKeyId }
          : {}),
        ...(body.modelName === null || typeof body.modelName === "string"
          ? { modelName: body.modelName }
          : {}),
        ...(Array.isArray(body.messages) ? { messages: sanitizeMessages(body.messages) } : {}),
      });
      if (!updated) {
        res.status(404).json({ error: "Conversation not found.", code: "not_found" });
        return;
      }
      res.json({ conversation: updated });
    } catch (error) {
      req.log?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "Could not update chat conversation.",
      );
      res.status(503).json({ error: "Could not update conversation.", code: "storage_unavailable" });
    }
  });

  router.delete("/chat/conversations/:conversationId", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const conversationId = String(req.params.conversationId ?? "");
    if (!isValidConversationId(conversationId)) {
      res.status(400).json({ error: "Invalid conversation ID.", code: "invalid_request" });
      return;
    }
    try {
      const deleted = await dependencies.remove(uid, conversationId);
      if (!deleted) {
        res.status(404).json({ error: "Conversation not found.", code: "not_found" });
        return;
      }
      res.sendStatus(204);
    } catch (error) {
      req.log?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "Could not delete chat conversation.",
      );
      res.status(503).json({ error: "Could not delete conversation.", code: "storage_unavailable" });
    }
  });

  return router;
}

export default createConversationsRouter();
