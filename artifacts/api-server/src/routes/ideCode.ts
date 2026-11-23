import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  cancelIdeTask,
  clearIdeTasks,
  createIdePairingCode,
  deleteIdeTask,
  exchangeIdePairingCode,
  heartbeatIdeSession,
  IdeCodeError,
  listIdeCodingModels,
  listIdeSessions,
  listIdeTasks,
  refreshIdeSession,
  reportIdeTaskEvent,
  revokeIdeSession,
  runIdeCodingTurn,
  verifyIdeSessionToken,
  type IdeAttachedFile,
  type IdeSessionRecord,
  type IdeTaskStatus,
} from "../lib/ideCodeService";

const AGENT_RATE_WINDOW_MS = 60_000;
const AGENT_RATE_LIMIT = 24;

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

export function createIdeCodeRouter(): IRouter {
  const router: IRouter = Router();
  const recentAgentTurns = new Map<string, number[]>();

  const allowAgentTurn = (uid: string, now = Date.now()): boolean => {
    const recent = (recentAgentTurns.get(uid) ?? []).filter(
      (ts) => now - ts < AGENT_RATE_WINDOW_MS,
    );
    if (recent.length >= AGENT_RATE_LIMIT) {
      recentAgentTurns.set(uid, recent);
      return false;
    }
    recent.push(now);
    recentAgentTurns.set(uid, recent);
    return true;
  };

  const requireFirebaseUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to manage YFactory Code.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to access YFactory Code.", code: "auth_failed" });
    return null;
  };

  const requireIdeSession = async (
    req: Request,
    res: Response,
  ): Promise<{ uid: string; session: IdeSessionRecord } | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "IDE session token required.", code: "ide_auth_required" });
      return null;
    }
    try {
      const verified = await verifyIdeSessionToken(token);
      if (verified) return verified;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({
      error: "IDE session expired or revoked. Refresh or pair again.",
      code: "ide_session_expired",
    });
    return null;
  };

  /* ==================== Web Dashboard Routes (Firebase Auth) ==================== */

  router.post("/ide/pairing-code", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const pairing = await createIdePairingCode(uid);
      res.status(201).json(pairing);
    } catch {
      res.status(500).json({ error: "Could not create pairing code.", code: "pairing_failed" });
    }
  });

  router.get("/ide/sessions", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const sessions = await listIdeSessions(uid);
      res.json({ sessions });
    } catch {
      res.status(500).json({ error: "Could not load IDE sessions.", code: "sessions_failed" });
    }
  });

  router.delete("/ide/sessions/:sessionId", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!isValidId(sessionId)) {
      res.status(400).json({ error: "Invalid session ID.", code: "invalid_session" });
      return;
    }
    try {
      const ok = await revokeIdeSession(uid, sessionId);
      if (!ok) {
        res.status(404).json({ error: "Session not found.", code: "not_found" });
        return;
      }
      res.json({ revoked: true, id: sessionId });
    } catch {
      res.status(500).json({ error: "Could not revoke session.", code: "revoke_failed" });
    }
  });

  router.get("/ide/models", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const models = await listIdeCodingModels(uid);
      res.json({ models });
    } catch {
      res.status(500).json({ error: "Could not load coding models.", code: "models_failed" });
    }
  });

  router.get("/ide/tasks", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const tasks = await listIdeTasks(uid, 30);
      res.json({ tasks });
    } catch {
      res.status(500).json({ error: "Could not load coding task history.", code: "tasks_failed" });
    }
  });

  router.post("/ide/tasks/:taskId/cancel", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    const taskId = String(req.params.taskId ?? "").trim();
    if (!isValidId(taskId)) {
      res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
      return;
    }
    try {
      const task = await cancelIdeTask(uid, taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found.", code: "not_found" });
        return;
      }
      res.json({ task });
    } catch {
      res.status(500).json({ error: "Could not cancel task.", code: "cancel_failed" });
    }
  });

  router.delete("/ide/tasks/:taskId", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    const taskId = String(req.params.taskId ?? "").trim();
    if (!isValidId(taskId)) {
      res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
      return;
    }
    try {
      const deleted = await deleteIdeTask(uid, taskId);
      if (!deleted) {
        res.status(404).json({ error: "Task not found.", code: "not_found" });
        return;
      }
      res.json({ deleted: true, id: taskId });
    } catch {
      res.status(500).json({ error: "Could not delete task.", code: "delete_failed" });
    }
  });

  router.delete("/ide/tasks", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const cleared = await clearIdeTasks(uid);
      res.json({ cleared });
    } catch {
      res.status(500).json({ error: "Could not clear task history.", code: "clear_failed" });
    }
  });

  /* ==================== IDE Extension Bridge Routes ==================== */

  router.post("/ide/auth/exchange", async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code : "";
    try {
      const result = await exchangeIdePairingCode({
        code,
        ideName: typeof body.ideName === "string" ? body.ideName : undefined,
        ideVersion: typeof body.ideVersion === "string" ? body.ideVersion : undefined,
        workspaceName:
          typeof body.workspaceName === "string" ? body.workspaceName : undefined,
        machineLabel:
          typeof body.machineLabel === "string" ? body.machineLabel : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof IdeCodeError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ error: "Could not pair IDE session.", code: "exchange_failed" });
    }
  });

  router.post("/ide/auth/refresh", async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
    try {
      const result = await refreshIdeSession(refreshToken);
      res.json(result);
    } catch (error) {
      if (error instanceof IdeCodeError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ error: "Could not refresh IDE session.", code: "refresh_failed" });
    }
  });

  router.post("/ide/auth/logout", async (req, res): Promise<void> => {
    const auth = await requireIdeSession(req, res);
    if (!auth) return;
    try {
      await revokeIdeSession(auth.uid, auth.session.id);
      res.json({ disconnected: true });
    } catch {
      res.status(500).json({ error: "Could not disconnect session.", code: "logout_failed" });
    }
  });

  router.get("/ide/extension/status", async (req, res): Promise<void> => {
    const auth = await requireIdeSession(req, res);
    if (!auth) return;
    res.json({ connected: true, session: auth.session });
  });

  router.post("/ide/extension/heartbeat", async (req, res): Promise<void> => {
    const auth = await requireIdeSession(req, res);
    if (!auth) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const workspaceName =
      typeof body.workspaceName === "string" ? body.workspaceName : undefined;
    try {
      const updated = await heartbeatIdeSession(
        auth.uid,
        auth.session.id,
        workspaceName,
      );
      res.json({ session: updated ?? auth.session });
    } catch {
      res.status(500).json({ error: "Heartbeat failed.", code: "heartbeat_failed" });
    }
  });

  router.get("/ide/extension/models", async (req, res): Promise<void> => {
    const auth = await requireIdeSession(req, res);
    if (!auth) return;
    try {
      const models = await listIdeCodingModels(auth.uid);
      res.json({ models });
    } catch {
      res.status(500).json({ error: "Could not load coding models.", code: "models_failed" });
    }
  });

  router.get("/ide/extension/tasks", async (req, res): Promise<void> => {
    const auth = await requireIdeSession(req, res);
    if (!auth) return;
    try {
      const tasks = await listIdeTasks(auth.uid, 20);
      res.json({ tasks });
    } catch {
      res.status(500).json({ error: "Could not load IDE tasks.", code: "tasks_failed" });
    }
  });

  router.post("/ide/extension/agent/turn", async (req, res): Promise<void> => {
    const auth = await requireIdeSession(req, res);
    if (!auth) return;
    if (!allowAgentTurn(auth.uid)) {
      res.status(429).json({
        error: "Rate limit reached for coding agent turns. Wait a moment.",
        code: "rate_limited",
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
    const modelName = typeof body.modelName === "string" ? body.modelName.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const taskId = typeof body.taskId === "string" ? body.taskId.trim() : undefined;
    const workspaceTree = Array.isArray(body.workspaceTree)
      ? body.workspaceTree.filter((p): p is string => typeof p === "string")
      : undefined;
    const attachedFiles: IdeAttachedFile[] | undefined = Array.isArray(body.attachedFiles)
      ? body.attachedFiles
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            path: String(item.path ?? ""),
            content: String(item.content ?? ""),
            ...(typeof item.language === "string" ? { language: item.language } : {}),
          }))
      : undefined;
    const history = Array.isArray(body.history)
      ? body.history
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            role: (item.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
            content: String(item.content ?? ""),
          }))
      : undefined;
    const toolFeedback =
      typeof body.toolFeedback === "string" ? body.toolFeedback : undefined;

    if (!provider || !keyId || !modelName) {
      res.status(400).json({
        error: "Choose a configured coding model before starting a task.",
        code: "missing_model",
      });
      return;
    }

    try {
      const result = await runIdeCodingTurn(auth.uid, auth.session, {
        taskId,
        provider,
        keyId,
        modelName,
        prompt,
        workspaceTree,
        attachedFiles,
        history,
        toolFeedback,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof IdeCodeError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ error: "Coding agent turn failed.", code: "agent_turn_failed" });
    }
  });

  router.post(
    "/ide/extension/tasks/:taskId/report",
    async (req, res): Promise<void> => {
      const auth = await requireIdeSession(req, res);
      if (!auth) return;
      const taskId = String(req.params.taskId ?? "").trim();
      if (!isValidId(taskId)) {
        res.status(400).json({ error: "Invalid task ID.", code: "invalid_task" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const status =
        body.status === "running" ||
        body.status === "awaiting_approval" ||
        body.status === "completed" ||
        body.status === "cancelled" ||
        body.status === "failed"
          ? (body.status as IdeTaskStatus)
          : undefined;
      const filesModified = Array.isArray(body.filesModified)
        ? body.filesModified.filter((x): x is string => typeof x === "string")
        : undefined;
      const cmdRaw =
        body.commandLog && typeof body.commandLog === "object"
          ? (body.commandLog as Record<string, unknown>)
          : null;
      const commandLog =
        cmdRaw && typeof cmdRaw.command === "string"
          ? {
              command: cmdRaw.command,
              approved: cmdRaw.approved === true,
              exitCode: typeof cmdRaw.exitCode === "number" ? cmdRaw.exitCode : null,
              outputPreview:
                typeof cmdRaw.outputPreview === "string" ? cmdRaw.outputPreview : "",
            }
          : undefined;

      try {
        const task = await reportIdeTaskEvent(auth.uid, taskId, {
          status,
          filesModified,
          commandLog,
          ...(typeof body.errorMessage === "string" || body.errorMessage === null
            ? { errorMessage: body.errorMessage }
            : {}),
        });
        if (!task) {
          res.status(404).json({ error: "Task not found.", code: "not_found" });
          return;
        }
        res.json({ task });
      } catch {
        res.status(500).json({ error: "Could not report task update.", code: "report_failed" });
      }
    },
  );

  return router;
}

export default createIdeCodeRouter();
