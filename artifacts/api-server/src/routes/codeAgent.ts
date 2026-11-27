import fs from "node:fs";
import path from "node:path";
import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  CodeAgentError,
  createCliPairingCode,
  exchangeCliPairingCode,
  listActiveCodeSkills,
  listCliSessions,
  listCodeAgentModels,
  revokeCliSession,
  runCodeAgentTurn,
  verifyCliSessionToken,
  type CodeAgentHistoryItem,
  type CodeAgentMode,
  type CodeAgentModelSelection,
  type CodeAgentWorkspaceContext,
} from "../lib/codeAgentService";

const TURN_RATE_WINDOW_MS = 60_000;
const TURN_RATE_LIMIT = 45;

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

function findCliScriptPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/yfactory-code-cli/yfactory-code.mjs"),
    path.resolve(process.cwd(), "../yfactory-code-cli/yfactory-code.mjs"),
    path.resolve(process.cwd(), "../../artifacts/yfactory-code-cli/yfactory-code.mjs"),
    path.resolve(process.env.HOME ?? "", "workspace/artifacts/yfactory-code-cli/yfactory-code.mjs"),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export function createCodeAgentRouter(): IRouter {
  const router: IRouter = Router();
  const recentTurns = new Map<string, number[]>();

  const allowTurn = (uid: string, now = Date.now()): boolean => {
    const recent = (recentTurns.get(uid) ?? []).filter(
      (ts) => now - ts < TURN_RATE_WINDOW_MS,
    );
    if (recent.length >= TURN_RATE_LIMIT) {
      recentTurns.set(uid, recent);
      return false;
    }
    recent.push(now);
    recentTurns.set(uid, recent);
    return true;
  };

  const requireFirebaseUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to access YFactory Code.", code: "auth_failed" });
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

  /**
   * Accepts EITHER a Firebase ID token (Web UI) OR a YFactory CLI Session token (`yfc_...`).
   */
  const requireWebOrCliUid = async (
    req: Request,
    res: Response,
  ): Promise<{ uid: string; via: "web" | "cli"; workspaceName?: string } | null> => {
    const cliHeader = (req.get("x-yfactory-code-token") ?? "").trim();
    const bearer = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";

    const maybeCliToken = cliHeader || (bearer.startsWith("yfc_") ? bearer : "");
    if (maybeCliToken) {
      try {
        const session = await verifyCliSessionToken(maybeCliToken);
        if (session) {
          return {
            uid: session.uid,
            via: "cli",
            workspaceName: session.workspaceName,
          };
        }
      } catch {
        // Fall through to 401
      }
      res.status(401).json({
        error: "CLI session expired or revoked. Run `node yfactory-code.mjs --login` to pair again.",
        code: "cli_auth_failed",
      });
      return null;
    }

    if (bearer) {
      try {
        const uid = await verifyFirebaseIdToken(bearer);
        if (uid) return { uid, via: "web" };
      } catch {
        // Fall through to 401
      }
    }

    res.status(401).json({ error: "Authentication required for YFactory Code.", code: "auth_failed" });
    return null;
  };

  /* ==================== CLI INSTALL DOWNLOAD ==================== */

  router.get("/code-agent/cli-script", (_req, res): void => {
    const filePath = findCliScriptPath();
    if (!filePath) {
      res.status(404).type("text/plain").send("// yfactory-code.mjs not found on server.\n");
      return;
    }
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="yfactory-code.mjs"');
    res.sendFile(filePath);
  });

  /* ==================== PAIRING & CLI SESSIONS ==================== */

  router.post("/code-agent/pair/start", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const pairing = await createCliPairingCode(uid);
      res.status(201).json(pairing);
    } catch {
      res.status(500).json({ error: "Could not create CLI pairing code.", code: "pair_failed" });
    }
  });

  router.post("/code-agent/pair/exchange", async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await exchangeCliPairingCode({
        code: typeof body.code === "string" ? body.code : "",
        workspaceName:
          typeof body.workspaceName === "string" ? body.workspaceName : undefined,
        platform: typeof body.platform === "string" ? body.platform : undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof CodeAgentError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not complete CLI pairing.", code: "exchange_failed" });
    }
  });

  router.get("/code-agent/sessions", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    try {
      const sessions = await listCliSessions(uid);
      res.json({ sessions });
    } catch {
      res.status(500).json({ error: "Could not load CLI sessions.", code: "sessions_failed" });
    }
  });

  router.delete("/code-agent/sessions/:sessionId", async (req, res): Promise<void> => {
    const uid = await requireFirebaseUid(req, res);
    if (!uid) return;
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!isValidId(sessionId)) {
      res.status(400).json({ error: "Invalid session ID.", code: "invalid_id" });
      return;
    }
    try {
      const revoked = await revokeCliSession(uid, sessionId);
      if (!revoked) {
        res.status(404).json({ error: "Session not found.", code: "not_found" });
        return;
      }
      res.json({ revoked: true, id: sessionId });
    } catch {
      res.status(500).json({ error: "Could not revoke session.", code: "revoke_failed" });
    }
  });

  /* ==================== MODELS, SKILLS & AGENT TURN ==================== */

  router.get("/code-agent/models", async (req, res): Promise<void> => {
    const auth = await requireWebOrCliUid(req, res);
    if (!auth) return;
    try {
      const models = await listCodeAgentModels(auth.uid);
      res.json({ models });
    } catch {
      res.status(500).json({ error: "Could not load models.", code: "models_failed" });
    }
  });

  router.get("/code-agent/skills", async (req, res): Promise<void> => {
    const auth = await requireWebOrCliUid(req, res);
    if (!auth) return;
    try {
      const skills = await listActiveCodeSkills(auth.uid);
      res.json({ skills });
    } catch {
      res.status(500).json({ error: "Could not load active code skills.", code: "skills_failed" });
    }
  });

  router.post("/code-agent/turn", async (req, res): Promise<void> => {
    const auth = await requireWebOrCliUid(req, res);
    if (!auth) return;
    if (!allowTurn(auth.uid)) {
      res.status(429).json({
        error: "Rate limit reached for YFactory Code turns. Wait a moment.",
        code: "rate_limited",
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawSel =
      body.modelSelection && typeof body.modelSelection === "object"
        ? (body.modelSelection as Record<string, unknown>)
        : undefined;
    const modelSelection: Partial<CodeAgentModelSelection> | undefined = rawSel
      ? {
          provider:
            typeof rawSel.provider === "string" ? rawSel.provider.trim() : undefined,
          keyId: typeof rawSel.keyId === "string" ? rawSel.keyId.trim() : undefined,
          modelName:
            typeof rawSel.modelName === "string" ? rawSel.modelName.trim() : undefined,
        }
      : undefined;

    try {
      const result = await runCodeAgentTurn(auth.uid, {
        messages: Array.isArray(body.messages)
          ? (body.messages as CodeAgentHistoryItem[])
          : [],
        workspace:
          body.workspace && typeof body.workspace === "object"
            ? (body.workspace as CodeAgentWorkspaceContext)
            : undefined,
        mode: body.mode === "plan" ? ("plan" as CodeAgentMode) : "agent",
        modelSelection,
        locale: typeof body.locale === "string" ? body.locale : "en",
      });
      res.json(result);
    } catch (err) {
      if (err instanceof CodeAgentError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({
        error: "YFactory Code turn failed unexpectedly.",
        code: "turn_failed",
      });
    }
  });

  return router;
}

export default createCodeAgentRouter();