import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  clearProviderConnectionTests,
  listProviderConnectionTests,
  recommendProvidersForTask,
  runOfficialConnectionTest,
  type RecommendationPriority,
  type RecommendationTask,
} from "../lib/providerDiagnostics";

const TEST_RATE_WINDOW_MS = 60_000;
const TEST_RATE_LIMIT = 20;

function isValidProviderId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function isValidKeyId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function parseTask(value: unknown): RecommendationTask {
  if (
    value === "chat" ||
    value === "code" ||
    value === "image_generation" ||
    value === "video_generation"
  ) {
    return value;
  }
  return "chat";
}

function parsePriority(value: unknown): RecommendationPriority {
  if (value === "balanced" || value === "speed" || value === "cost") {
    return value;
  }
  return "balanced";
}

export function createProviderDiagnosticsRouter(): IRouter {
  const router: IRouter = Router();
  const recentTestsByUser = new Map<string, number[]>();

  const allowTestRequest = (uid: string, now = Date.now()): boolean => {
    const recent = (recentTestsByUser.get(uid) ?? []).filter(
      (ts) => now - ts < TEST_RATE_WINDOW_MS,
    );
    if (recent.length >= TEST_RATE_LIMIT) {
      recentTestsByUser.set(uid, recent);
      return false;
    }
    recent.push(now);
    recentTestsByUser.set(uid, recent);
    return true;
  };

  const authenticatedUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(
      /^Bearer\s+(.+)$/i,
    )?.[1];
    if (!token) {
      res.status(401).json({
        error: "Sign in to run provider diagnostics.",
        code: "auth_failed",
      });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({
      error: "Sign in again to run provider diagnostics.",
      code: "auth_failed",
    });
    return null;
  };

  router.post(
    "/provider-center/providers/:providerId/test-connection",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      if (!allowTestRequest(uid)) {
        res.status(429).json({
          error: "Too many connection tests. Wait a moment and try again.",
          code: "rate_limited",
        });
        return;
      }

      const providerId = String(req.params.providerId ?? "")
        .trim()
        .toLowerCase();
      if (!isValidProviderId(providerId)) {
        res
          .status(400)
          .json({ error: "Invalid provider ID.", code: "invalid_provider" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const keyId =
        typeof body.keyId === "string" && isValidKeyId(body.keyId)
          ? body.keyId
          : undefined;
      const includeGenerationTest = body.includeGenerationTest === true;
      const modelId =
        typeof body.modelId === "string" && body.modelId.trim().length <= 200
          ? body.modelId.trim()
          : undefined;

      try {
        const result = await runOfficialConnectionTest(uid, providerId, {
          keyId,
          includeGenerationTest,
          modelId,
        });
        res.json({ result });
      } catch (error) {
        if (error instanceof Error && error.message === "provider_not_found") {
          res
            .status(404)
            .json({ error: "Provider not found.", code: "provider_not_found" });
          return;
        }
        res.status(500).json({
          error: "Connection test failed unexpectedly.",
          code: "test_failed",
        });
      }
    },
  );

  router.get(
    "/provider-center/diagnostics/history",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const rawLimit = Number(req.query.limit ?? 40);
      const limit = Number.isFinite(rawLimit) ? rawLimit : 40;
      try {
        const data = await listProviderConnectionTests(uid, limit);
        res.json(data);
      } catch {
        res.status(500).json({
          error: "Could not load connection test history.",
          code: "history_load_failed",
        });
      }
    },
  );

  router.delete(
    "/provider-center/diagnostics/history",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      try {
        const cleared = await clearProviderConnectionTests(uid);
        res.json({ cleared });
      } catch {
        res.status(500).json({
          error: "Could not clear test history.",
          code: "history_clear_failed",
        });
      }
    },
  );

  router.get(
    "/provider-center/recommendations",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const task = parseTask(req.query.task);
      const priority = parsePriority(req.query.priority);
      try {
        const recommendations = await recommendProvidersForTask(
          uid,
          task,
          priority,
        );
        res.json({ task, priority, recommendations });
      } catch {
        res.status(500).json({
          error: "Could not generate provider recommendations.",
          code: "recommendation_failed",
        });
      }
    },
  );

  return router;
}

export default createProviderDiagnosticsRouter();
