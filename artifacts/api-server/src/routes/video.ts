import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  deleteVideoJob,
  fetchProxiedVideoMedia,
  listAvailableVideoModels,
  listVideoJobs,
  pollVideoJobStatus,
  submitVideoGenerationJob,
  VideoServiceError,
  type VideoJobRecord,
  type VideoMode,
} from "../lib/videoService";

const VIDEO_RATE_WINDOW_MS = 60_000;
const VIDEO_RATE_LIMIT = 8;

function isValidJobId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function serializeJobForClient(job: VideoJobRecord) {
  return {
    id: job.id,
    providerId: job.providerId,
    providerName: job.providerName,
    modelId: job.modelId,
    modelName: job.modelName,
    mode: job.mode,
    prompt: job.prompt,
    aspectRatio: job.aspectRatio,
    durationSec: job.durationSec,
    resolution: job.resolution,
    status: job.status,
    progress: job.progress,
    videoUrl: job.requiresMediaProxy ? null : job.videoUrl,
    hasVideoMedia: Boolean(job.videoUrl),
    requiresMediaProxy: job.requiresMediaProxy,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function createVideoRouter(): IRouter {
  const router: IRouter = Router();
  const recentByUser = new Map<string, number[]>();

  const allowGenerate = (uid: string, now = Date.now()): boolean => {
    const recent = (recentByUser.get(uid) ?? []).filter(
      (ts) => now - ts < VIDEO_RATE_WINDOW_MS,
    );
    if (recent.length >= VIDEO_RATE_LIMIT) {
      recentByUser.set(uid, recent);
      return false;
    }
    recent.push(now);
    recentByUser.set(uid, recent);
    return true;
  };

  const authenticatedUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to use Video Studio.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to use Video Studio.", code: "auth_failed" });
    return null;
  };

  router.get("/video/models", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    try {
      const models = await listAvailableVideoModels(uid);
      res.json({ models });
    } catch {
      res.status(500).json({ error: "Could not load video models.", code: "models_failed" });
    }
  });

  router.get("/video/jobs", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    try {
      const jobs = await listVideoJobs(uid, 30);
      res.json({ jobs: jobs.map(serializeJobForClient) });
    } catch {
      res.status(500).json({ error: "Could not load video history.", code: "jobs_failed" });
    }
  });

  router.post("/video/generate", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    if (!allowGenerate(uid)) {
      res.status(429).json({
        error: "Too many video generation requests. Wait a minute and retry.",
        code: "rate_limited",
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const specId = typeof body.specId === "string" ? body.specId.trim() : "";
    const mode: VideoMode =
      body.mode === "image_to_video" ? "image_to_video" : "text_to_video";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const aspectRatio =
      typeof body.aspectRatio === "string" ? body.aspectRatio.trim() : undefined;
    const durationSec =
      typeof body.durationSec === "number" && Number.isFinite(body.durationSec)
        ? body.durationSec
        : undefined;
    const resolution =
      typeof body.resolution === "string" ? body.resolution.trim() : undefined;
    const imageInput =
      typeof body.imageInput === "string" ? body.imageInput : undefined;

    if (imageInput && imageInput.length > 6_000_000) {
      res.status(400).json({
        error: "Reference image is too large. Choose a smaller image.",
        code: "image_too_large",
      });
      return;
    }

    try {
      const job = await submitVideoGenerationJob(uid, {
        specId,
        mode,
        prompt,
        aspectRatio,
        durationSec,
        resolution,
        imageInput,
      });
      res.status(201).json({ job: serializeJobForClient(job) });
    } catch (error) {
      if (error instanceof VideoServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({
        error: "Video generation request failed.",
        code: "video_generate_failed",
      });
    }
  });

  router.get("/video/jobs/:jobId", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const jobId = String(req.params.jobId ?? "").trim();
    if (!isValidJobId(jobId)) {
      res.status(400).json({ error: "Invalid job ID.", code: "invalid_job_id" });
      return;
    }
    try {
      const job = await pollVideoJobStatus(uid, jobId);
      if (!job) {
        res.status(404).json({ error: "Video job not found.", code: "not_found" });
        return;
      }
      res.json({ job: serializeJobForClient(job) });
    } catch (error) {
      if (error instanceof VideoServiceError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(500).json({ error: "Could not refresh video status.", code: "poll_failed" });
    }
  });

  router.get("/video/jobs/:jobId/media", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const jobId = String(req.params.jobId ?? "").trim();
    if (!isValidJobId(jobId)) {
      res.status(400).json({ error: "Invalid job ID.", code: "invalid_job_id" });
      return;
    }
    try {
      const media = await fetchProxiedVideoMedia(uid, jobId);
      if (!media) {
        res.status(404).json({ error: "Video media unavailable.", code: "media_not_found" });
        return;
      }
      res.setHeader("Content-Type", media.contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(media.buffer);
    } catch {
      res.status(502).json({ error: "Could not download video media.", code: "media_failed" });
    }
  });

  router.delete("/video/jobs/:jobId", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const jobId = String(req.params.jobId ?? "").trim();
    if (!isValidJobId(jobId)) {
      res.status(400).json({ error: "Invalid job ID.", code: "invalid_job_id" });
      return;
    }
    try {
      const ok = await deleteVideoJob(uid, jobId);
      if (!ok) {
        res.status(404).json({ error: "Video job not found.", code: "not_found" });
        return;
      }
      res.json({ deleted: true, id: jobId });
    } catch {
      res.status(500).json({ error: "Could not delete video job.", code: "delete_failed" });
    }
  });

  return router;
}

export default createVideoRouter();
