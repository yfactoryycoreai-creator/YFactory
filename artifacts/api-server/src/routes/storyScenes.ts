import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { Archiver, ArchiverOptions } from "archiver";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Router, type IRouter, type Request, type Response } from "express";
import sharp from "sharp";
import { getFirebaseAdmin, requireEncryptionKey, verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import { storyImageStorage } from "../lib/storyImageStorage";
import {
  generateImageWithFallback,
  ImageGenerationFailure,
  type GeneratedImageAsset,
  type SceneFailureCode,
} from "../lib/imageGeneration";
import { logger } from "../lib/logger";

const { ZipArchive } = createRequire(import.meta.url)("archiver") as {
  ZipArchive: new (options: ArchiverOptions) => Archiver;
};
const router: IRouter = Router();
const MAX_STORY_IMAGES = 100;
const MAX_SCENE_CONCURRENCY = 2;
const JOB_TIMEOUT_MS = 180_000;
const GENERATION_STALE_AFTER_MS = JOB_TIMEOUT_MS + 60_000;
const DOWNLOAD_TOKEN_LIFETIME_MS = 5 * 60_000;
const activeSceneJobs = new Set<string>();

type SceneJob = {
  id: string;
  index: number;
  scenePrompt: string;
  batchId: string;
  batchTotal: number;
  status: "pending" | "generating" | "done" | "failed";
};

class StoryNotFoundError extends Error {}
class StoryLimitReachedError extends Error {}

function storyReference(uid: string, storyId: string) {
  return getFirebaseAdmin().db.collection("users").doc(uid).collection("stories").doc(storyId);
}

async function cloudinaryImageStream(imageUrl: string): Promise<Readable> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("The stored Cloudinary image URL is invalid.");
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") {
    throw new Error("The stored Cloudinary image URL is not allowed.");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Cloudinary image download failed (HTTP ${response.status}).`);
  }
  return Readable.from(response.body as AsyncIterable<Uint8Array>);
}

function storyZipFailureCode(error: unknown, stage: string): string {
  if (!(error instanceof Error)) return "unknown";
  const cloudinaryStatus = error.message.match(/^Cloudinary image download failed \(HTTP (\d{3})\)\.$/);
  if (cloudinaryStatus?.[1] === "404") return "not_found";
  if (cloudinaryStatus?.[1] === "401" || cloudinaryStatus?.[1] === "403") return "forbidden";
  if (cloudinaryStatus) return "network";
  if (error.message === "The stored Cloudinary image URL is invalid." ||
      error.message === "The stored Cloudinary image URL is not allowed.") return "bad_url";
  if (error.message === "ZIP token reference is unavailable.") return "missing_progress_reference";
  if (error.message === "ZIP stream closed early.") return "stream_closed_early";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
  if (error.name === "TypeError" && stage === "fetch_asset") return "network";
  if (/input buffer|unsupported image format/i.test(error.message)) return "image_decode_failed";
  return error.name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "unknown";
}

async function authenticatedUid(req: Request, res: Response): Promise<string | null> {
  const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in before managing story images.", code: "unauthorized" });
    return null;
  }
  try {
    const uid = await verifyFirebaseIdToken(token);
    if (!uid) {
      res.status(401).json({ error: "Sign in again before managing story images.", code: "unauthorized" });
    }
    return uid;
  } catch {
    res.status(503).json({ error: "Firebase authentication is unavailable.", code: "server_configuration" });
    return null;
  }
}

function validStoryId(storyId: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(storyId);
}

function isValidTargetCount(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_STORY_IMAGES;
}

function splitScenarioIntoMoments(scenario: string, count: number): string[] {
  const storyText = scenario.trim();
  const clauses = storyText
    .split(/(?:\r?\n+|(?<=[.!?؟。])\s+)/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const words = scenario.match(/\S+/gu) ?? [];
  const source = clauses.length >= count
    ? clauses
    : words.length >= count
      ? words
      : clauses.length ? clauses : [storyText];
  const moments = Array.from({ length: count }, (_, index) => {
    if (count === 1) return storyText;
    if (source.length < count) return source[index % source.length] ?? storyText;
    const start = Math.floor((index * source.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * source.length) / count));
    return source.slice(start, end).join(clauses.length >= count ? " " : " ");
  });

  const characterDetails = scenario
    .split(/(?:\r?\n+|(?<=[.!?؟。])\s+|(?<=[,،;؛])\s+)/u)
    .map((part) => part.trim())
    .filter((part) =>
      /(?:\b(?:hair|eyes?|skin|clothes|clothing|shirt|jacket|dress|coat|uniform|beard|glasses)\b|(?:شعر|عيون|عين|ملابس|معطف|قميص|فستان|لحية|نظارة|الملابس)|(?:cheveux|yeux|vêtements|veste|robe|manteau|barbe|lunettes))/iu.test(part),
    )
    .slice(0, 8)
    .map((part) => part.slice(0, 240))
    .join("; ")
    .slice(0, 1200);
  const styleAndCharacterBible = [
    "Shared style + character bible: create a cohesive illustrated storybook image with cinematic composition, " +
      "clear subject focus, consistent rendering, lighting, color treatment, and visual language throughout this story.",
    characterDetails
      ? `Recurring character appearance details from the full story: ${characterDetails}.`
      : "Keep every recurring character's face, age, hair, clothing, proportions, and distinguishing features consistent; follow the roles and appearance implied by the full story without inventing conflicting designs.",
  ].join(" ");
  const imageRestriction =
    "single image, one scene only, no grid, no collage, no panels, no text overlay";

  return moments.map((moment, index) => {
    const focus = count === 1
      ? "Choose the single defining moment that best represents the complete story."
      : count === 2
        ? index === 0
          ? "Choose the most important opening moment from the first part of the story."
          : "Choose the most important climax or resolution moment from the final part of the story."
        : "Choose one important moment from this chronological portion of the full story.";
    return `${styleAndCharacterBible}\nScene ${index + 1} of ${count}: ${focus} Depict one frozen visual moment from this story segment: ${moment}. ` +
      `Keep the progression from beginning to end and show no other time or event. ${imageRestriction}.`;
  });
}

async function markSceneFailed(
  uid: string,
  storyId: string,
  imageId: string,
  errorCode: SceneFailureCode,
): Promise<void> {
  try {
    await storyReference(uid, storyId).collection("images").doc(imageId).update({
      status: "failed",
      error: errorCode,
      generationStartedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch {
    // The image may have been deleted while its generation was running.
  }
}

async function processSceneJob(
  uid: string,
  storyId: string,
  imageId: string,
): Promise<void> {
  const { db } = getFirebaseAdmin();
  const storyRef = storyReference(uid, storyId);
  const imageRef = storyRef.collection("images").doc(imageId);
  const claimed = await db.runTransaction(async (transaction) => {
    const imageSnapshot = await transaction.get(imageRef);
    if (!imageSnapshot.exists || imageSnapshot.data()?.status !== "pending") return null;
    const data = imageSnapshot.data() ?? {};
    transaction.update(imageRef, {
      status: "generating",
      error: "",
      generationStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      index: Number(data.index) || 0,
      scenePrompt: typeof data.scenePrompt === "string" ? data.scenePrompt : "",
    } satisfies Pick<SceneJob, "index" | "scenePrompt">;
  });
  if (!claimed?.scenePrompt || claimed.index < 1 || claimed.index > MAX_STORY_IMAGES) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS);
  let uploadedImage: Awaited<ReturnType<typeof storyImageStorage.upload>> | null = null;
  let failureCode: SceneFailureCode = "save_failed";
  try {
    const asset: GeneratedImageAsset = await generateImageWithFallback(
      claimed.scenePrompt,
      fetch,
      controller.signal,
    );
    const bytes = Buffer.from(asset.base64, "base64");
    const uploaded = await storyImageStorage.upload(
      uid,
      storyId,
      imageId,
      bytes,
      asset.mimeType,
    );
    uploadedImage = uploaded;

    const saved = await db.runTransaction(async (transaction) => {
      const [storySnapshot, imageSnapshot] = await Promise.all([
        transaction.get(storyRef),
        transaction.get(imageRef),
      ]);
      if (!storySnapshot.exists || !imageSnapshot.exists) return false;
      const imageData = imageSnapshot.data() ?? {};
      if (imageData.status !== "generating") return false;
      const imageCount = Math.max(0, Math.floor(Number(storySnapshot.data()?.imageCount) || 0));
      if (imageCount >= MAX_STORY_IMAGES) {
        transaction.update(imageRef, {
          status: "failed",
          error: "save_failed",
          generationStartedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return false;
      }
      transaction.update(imageRef, {
        imageUrl: uploaded.imageUrl,
        url: uploaded.imageUrl,
        storagePath: uploaded.storagePath,
        publicId: uploaded.publicId,
        folder: uploaded.folder,
        format: uploaded.format,
        sizeBytes: uploaded.sizeBytes,
        provider: asset.provider,
        status: "done",
        error: "",
        completedAt: FieldValue.serverTimestamp(),
        generationStartedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(storyRef, {
        imageCount: FieldValue.increment(1),
        storageBytes: FieldValue.increment(uploaded.sizeBytes),
      });
      return true;
    });
    if (!saved) await storyImageStorage.delete(uid, uploaded);
  } catch (error) {
    if (uploadedImage) {
      await storyImageStorage.delete(uid, uploadedImage).catch(() => undefined);
    }
    failureCode =
      error instanceof ImageGenerationFailure ? error.code : "save_failed";
    await markSceneFailed(uid, storyId, imageId, failureCode);
    logger.warn({ storyId, imageId, reason: failureCode }, "A story scene job failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function processSceneQueue(uid: string, storyId: string, imageIds: string[]): Promise<void> {
  const jobs = imageIds.filter((imageId) => !activeSceneJobs.has(imageId));
  if (!jobs.length) return;
  for (const imageId of jobs) activeSceneJobs.add(imageId);
  try {
    let cursor = 0;
    const workerCount = Math.min(MAX_SCENE_CONCURRENCY, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < jobs.length) {
        const imageId = jobs[cursor];
        cursor += 1;
        if (!imageId) continue;
        await processSceneJob(uid, storyId, imageId);
      }
    }));
  } catch {
    await Promise.all(
      jobs.map((imageId) =>
        markSceneFailed(uid, storyId, imageId, "timeout"),
      ),
    );
    logger.warn({ storyId }, "A story scene queue could not be started.");
  } finally {
    for (const imageId of jobs) activeSceneJobs.delete(imageId);
  }
}

function launchSceneQueue(uid: string, storyId: string, imageIds: string[]): void {
  void processSceneQueue(uid, storyId, imageIds).catch(() => {
    logger.warn({ storyId }, "A story scene queue stopped unexpectedly.");
  });
}

router.patch("/images/stories/:storyId/target-count", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  const targetCount = req.body?.targetCount;
  if (!validStoryId(storyId) || !isValidTargetCount(targetCount)) {
    res.status(400).json({ error: "Target count must be an integer from 1 to 100.", code: "invalid_target_count" });
    return;
  }

  try {
    const db = getFirebaseAdmin().db;
    const storyRef = storyReference(uid, storyId);
    const removedCount = await db.runTransaction(async (transaction) => {
      const [storySnapshot, imagesSnapshot] = await Promise.all([
        transaction.get(storyRef),
        transaction.get(storyRef.collection("images")),
      ]);
      if (!storySnapshot.exists) throw new StoryNotFoundError();
      const removable = imagesSnapshot.docs.filter((document) => {
        const data = document.data();
        const index = Number(data.index ?? data.sequence);
        return (data.status === "pending" || data.status === "failed") &&
          Number.isInteger(index) &&
          index > targetCount;
      });
      transaction.update(storyRef, {
        targetCount,
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const document of removable) transaction.delete(document.ref);
      return removable.length;
    });
    res.json({ targetCount, removedCount });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    logger.warn({ storyId }, "Could not update story image target.");
    res.status(500).json({ error: "The image target could not be saved.", code: "target_count_save_failed" });
  }
});

router.post("/images/stories/:storyId/scenes", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const requestedCount = req.body?.count;
  if (!validStoryId(storyId) || !prompt || prompt.length > 20_000 ||
      !isValidTargetCount(requestedCount)) {
    res.status(400).json({ error: "Provide a valid story, script, and scene count from 1 to 100.", code: "invalid_request" });
    return;
  }

  try {
    const storyRef = storyReference(uid, storyId);
    const db = getFirebaseAdmin().db;
    const batchId = randomBytes(16).toString("hex");
    const result = await db.runTransaction(async (transaction) => {
      const [storySnapshot, imagesSnapshot] = await Promise.all([
        transaction.get(storyRef),
        transaction.get(storyRef.collection("images")),
      ]);
      if (!storySnapshot.exists) throw new StoryNotFoundError();
      const storyData = storySnapshot.data() ?? {};
      const currentCount = Math.max(0, Math.floor(Number(storyData.imageCount) || 0));
      const usedIndexes = new Set<number>();
      for (const document of imagesSnapshot.docs) {
        const data = document.data();
        const index = Number(data.index ?? data.sequence);
        if ((data.status === "pending" || data.status === "failed") &&
            Number.isInteger(index) && index > requestedCount) {
          transaction.delete(document.ref);
          continue;
        }
        if (Number.isInteger(index) && index >= 1 && index <= MAX_STORY_IMAGES) {
          usedIndexes.add(index);
        }
      }
      const availableIndexes = Array.from(
        { length: requestedCount },
        (_, index) => index + 1,
      ).filter((index) => !usedIndexes.has(index));
      const available = Math.max(
        0,
        Math.min(
          availableIndexes.length,
          requestedCount - currentCount,
          MAX_STORY_IMAGES - currentCount,
        ),
      );
      const sceneIndexes = availableIndexes.slice(0, available);
      const prompts = splitScenarioIntoMoments(prompt, requestedCount);
      const batchTotal = sceneIndexes.length;
      const jobs: SceneJob[] = [];
      for (const sceneIndex of sceneIndexes) {
        const imageRef = storyRef.collection("images").doc();
        const scenePrompt = prompts[sceneIndex - 1] ?? prompts.at(-1) ?? prompt;
        transaction.create(imageRef, {
          index: sceneIndex,
          scenePrompt,
          prompt: scenePrompt,
          imageUrl: "",
          url: "",
          storagePath: "",
          provider: "",
          status: "pending",
          error: "",
          batchId,
          batchTotal,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        jobs.push({ id: imageRef.id, index: sceneIndex, scenePrompt, batchId, batchTotal, status: "pending" });
      }
      transaction.update(storyRef, {
        targetCount: requestedCount,
        imageSequence: Math.max(
          Math.floor(Number(storyData.imageSequence) || 0),
          ...sceneIndexes,
        ),
      });
      return {
        jobs,
        skippedCount: currentCount < requestedCount
          ? Math.max(0, availableIndexes.length - sceneIndexes.length)
          : 0,
      };
    });

    if (result.jobs.length) launchSceneQueue(uid, storyId, result.jobs.map((job) => job.id));
    res.status(202).json({
      batchId,
      sceneCount: result.jobs.length,
      skippedCount: result.skippedCount,
    });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    if (error instanceof StoryLimitReachedError) {
      res.status(409).json({ error: "This story has reached its 100-image limit.", code: "story_limit" });
      return;
    }
    logger.warn({ storyId }, "Could not start story scene generation.");
    res.status(500).json({ error: "Scenes could not be started. Please try again.", code: "scene_start_failed" });
  }
});

router.post("/images/stories/:storyId/scenes/resume", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  if (!validStoryId(storyId)) {
    res.status(400).json({ error: "The story ID is invalid.", code: "invalid_story_id" });
    return;
  }
  try {
    const storyRef = storyReference(uid, storyId);
    const storySnapshot = await storyRef.get();
    if (!storySnapshot.exists) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    const storyData = storySnapshot.data() ?? {};
    const targetCount = isValidTargetCount(storyData.targetCount) ? storyData.targetCount : 10;
    const snapshot = await storyRef.collection("images").limit(MAX_STORY_IMAGES).get();
    const now = Date.now();
    for (const document of snapshot.docs) {
      const data = document.data();
      const index = Number(data.index ?? data.sequence);
      if (!Number.isInteger(index) || index > targetCount) continue;
      if (data.status !== "generating") continue;
      const startedAt = data.generationStartedAt instanceof Timestamp
        ? data.generationStartedAt.toMillis()
        : 0;
      if (!activeSceneJobs.has(document.id) ||
          (startedAt > 0 && now - startedAt > GENERATION_STALE_AFTER_MS)) {
        await document.ref.update({
          status: "pending",
          generationStartedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    const pending = await storyRef.collection("images").where("status", "==", "pending").limit(MAX_STORY_IMAGES).get();
    const imageIds = pending.docs
      .filter((document) => {
        const data = document.data();
        return Number(data.index ?? data.sequence) <= targetCount;
      })
      .map((document) => document.id);
    launchSceneQueue(uid, storyId, imageIds);
    res.json({ resumedCount: imageIds.length });
  } catch {
    logger.warn({ storyId }, "Could not resume pending story scenes.");
    res.status(500).json({ error: "Pending scenes could not be resumed.", code: "scene_resume_failed" });
  }
});

router.post("/images/stories/:storyId/images/:imageId/retry", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  const imageId = String(req.params.imageId ?? "");
  if (!validStoryId(storyId) || !validStoryId(imageId)) {
    res.status(400).json({ error: "The image reference is invalid.", code: "invalid_request" });
    return;
  }
  try {
    const storyRef = storyReference(uid, storyId);
    const imageRef = storyRef.collection("images").doc(imageId);
    await getFirebaseAdmin().db.runTransaction(async (transaction) => {
      const [storySnapshot, imageSnapshot] = await Promise.all([
        transaction.get(storyRef),
        transaction.get(imageRef),
      ]);
      if (!storySnapshot.exists || !imageSnapshot.exists) throw new StoryNotFoundError();
      if (imageSnapshot.data()?.status !== "failed") throw new Error("Scene is not retryable.");
      const storyData = storySnapshot.data() ?? {};
      const targetCount = isValidTargetCount(storyData.targetCount) ? storyData.targetCount : 10;
      const imageIndex = Number(imageSnapshot.data()?.index ?? imageSnapshot.data()?.sequence);
      if (!Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > targetCount) {
        throw new Error("Scene is outside the story target.");
      }
      const imageCount = Math.max(0, Math.floor(Number(storyData.imageCount) || 0));
      if (imageCount >= MAX_STORY_IMAGES) throw new StoryLimitReachedError();
      transaction.update(imageRef, {
        status: "pending",
        error: "",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    launchSceneQueue(uid, storyId, [imageId]);
    res.status(202).json({ queued: true });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({ error: "This scene could not be found.", code: "scene_not_found" });
      return;
    }
    if (error instanceof StoryLimitReachedError) {
      res.status(409).json({ error: "This story has reached its 100-image limit.", code: "story_limit" });
      return;
    }
    res.status(409).json({ error: "Only failed scenes can be retried.", code: "scene_not_retryable" });
  }
});

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createDownloadToken(uid: string, storyId: string): string {
  const payload = Buffer.from(JSON.stringify({
    uid,
    storyId,
    nonce: randomBytes(24).toString("base64url"),
  })).toString("base64url");
  const signature = createHmac("sha256", requireEncryptionKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readDownloadToken(token: string): { uid: string; storyId: string } | null {
  const [payload, providedSignature, ...extra] = token.split(".");
  if (!payload || !providedSignature || extra.length) return null;
  try {
    const expectedSignature = createHmac("sha256", requireEncryptionKey()).update(payload).digest();
    const actualSignature = Buffer.from(providedSignature, "base64url");
    if (actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)) return null;
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null) return null;
    const record = decoded as Record<string, unknown>;
    if (typeof record.uid !== "string" || typeof record.storyId !== "string" ||
        typeof record.nonce !== "string") return null;
    return { uid: record.uid, storyId: record.storyId };
  } catch {
    return null;
  }
}

router.post("/images/stories/:storyId/download-token", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  if (!validStoryId(storyId)) {
    res.status(400).json({ error: "The story ID is invalid.", code: "invalid_story_id" });
    return;
  }
  try {
    const storyRef = storyReference(uid, storyId);
    const [storySnapshot, imagesSnapshot] = await Promise.all([
      storyRef.get(),
      storyRef.collection("images").limit(MAX_STORY_IMAGES).get(),
    ]);
    if (!storySnapshot.exists) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    const downloadable = imagesSnapshot.docs.filter((document) => {
      const data = document.data();
      return data.status === "done" &&
        Number.isInteger(data.index) &&
        typeof data.storagePath === "string" &&
        data.storagePath.startsWith(`users/${uid}/stories/${storyId}/images/`);
    }).sort((left, right) => Number(left.data().index) - Number(right.data().index));
    if (!downloadable.length) {
      res.status(404).json({ error: "This story has no downloadable scene images.", code: "no_images" });
      return;
    }

    const rawToken = createDownloadToken(uid, storyId);
    const digest = tokenDigest(rawToken);
    const expiresAt = Timestamp.fromMillis(Date.now() + DOWNLOAD_TOKEN_LIFETIME_MS);
    await storyRef.collection("downloadTokens").doc(digest).create({
      expiresAt,
      imageCount: downloadable.length,
      completedCount: 0,
      status: "ready",
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({
      downloadUrl: `/api/images/stories/${encodeURIComponent(storyId)}/download.zip?token=${encodeURIComponent(rawToken)}`,
      token: rawToken,
      imageCount: downloadable.length,
    });
  } catch {
    logger.warn({ storyId }, "Could not prepare story ZIP download.");
    res.status(500).json({ error: "The story ZIP could not be prepared.", code: "zip_prepare_failed" });
  }
});

router.get("/images/stories/:storyId/download-status", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!validStoryId(storyId) || token.length > 2_000 || !token.includes(".")) {
    res.status(400).json({ error: "The download reference is invalid.", code: "invalid_request" });
    return;
  }
  const tokenOwner = readDownloadToken(token);
  if (!tokenOwner || tokenOwner.uid !== uid || tokenOwner.storyId !== storyId) {
    res.status(404).json({ error: "The ZIP download has expired.", code: "download_expired" });
    return;
  }
  try {
    const tokenSnapshot = await storyReference(uid, storyId)
      .collection("downloadTokens")
      .doc(tokenDigest(token))
      .get();
    const data = tokenSnapshot.data();
    if (!data || !(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() < Date.now()) {
      res.status(404).json({ error: "The ZIP download has expired.", code: "download_expired" });
      return;
    }
    res.json({
      status: typeof data.status === "string" ? data.status : "ready",
      completedCount: Math.max(0, Number(data.completedCount) || 0),
      imageCount: Math.max(0, Number(data.imageCount) || 0),
    });
  } catch {
    res.status(500).json({ error: "ZIP progress could not be loaded.", code: "download_status_failed" });
  }
});

router.get("/images/stories/:storyId/download.zip", async (req, res): Promise<void> => {
  const storyId = String(req.params.storyId ?? "");
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!validStoryId(storyId) || token.length > 2_000 || !token.includes(".")) {
    res.status(401).json({ error: "This ZIP download link is invalid or expired.", code: "download_unauthorized" });
    return;
  }
  const tokenOwner = readDownloadToken(token);
  if (!tokenOwner || tokenOwner.storyId !== storyId) {
    res.status(401).json({ error: "This ZIP download link is invalid or expired.", code: "download_unauthorized" });
    return;
  }
  const digest = tokenDigest(token);
  const tokenRefPath = digest;
  let tokenRef: FirebaseFirestore.DocumentReference | null = null;
  const uid = tokenOwner.uid;
  let stage = "auth";
  try {
    const db = getFirebaseAdmin().db;
    tokenRef = storyReference(uid, storyId).collection("downloadTokens").doc(tokenRefPath);
    const tokenSnapshot = await tokenRef.get();
    if (!tokenSnapshot.exists) {
      res.status(401).json({ error: "This ZIP download link is invalid or expired.", code: "download_unauthorized" });
      return;
    }
    const validatedTokenRef = tokenRef;
    const claimed = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(validatedTokenRef);
      const data = snapshot.data();
      if (!data || !(data.expiresAt instanceof Timestamp) ||
          data.expiresAt.toMillis() < Date.now() || data.usedAt) return false;
      transaction.update(validatedTokenRef, {
        usedAt: FieldValue.serverTimestamp(),
        status: "zipping",
      });
      return true;
    });
    if (!claimed) {
      res.status(401).json({ error: "This ZIP download link is invalid or expired.", code: "download_unauthorized" });
      return;
    }

    stage = "list_images";
    const storyRef = storyReference(uid, storyId);
    const [storySnapshot, imagesSnapshot] = await Promise.all([
      storyRef.get(),
      storyRef.collection("images").limit(MAX_STORY_IMAGES).get(),
    ]);
    if (!storySnapshot.exists) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    const images = imagesSnapshot.docs.flatMap((document) => {
      const data = document.data();
      const publicId = typeof data.publicId === "string" ? data.publicId : "";
      const imagePrefix = `users/${uid}/stories/${storyId}/images/`;
      if (data.status !== "done" || !Number.isInteger(data.index) ||
          typeof data.storagePath !== "string" ||
          !data.storagePath.startsWith(imagePrefix) ||
          (publicId && !publicId.startsWith(imagePrefix))) {
        return [];
      }
      return [{
        id: document.id,
        index: data.index as number,
        storagePath: data.storagePath,
        publicId,
        imageUrl: typeof data.imageUrl === "string"
          ? data.imageUrl
          : typeof data.url === "string" ? data.url : "",
      }];
    }).sort((left, right) => left.index - right.index).slice(0, MAX_STORY_IMAGES);
    if (!images.length) {
      res.status(404).json({ error: "This story has no downloadable scene images.", code: "no_images" });
      return;
    }

    const storyName = typeof storySnapshot.data()?.storyName === "string"
      ? storySnapshot.data()?.storyName as string
      : "story";
    const filename = storyName.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 70) || "story";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.zip"`);
    res.setHeader("Cache-Control", "private, no-store");

    stage = "init_zip_stream";
    stage = "stream_zip";
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const { storage } = getFirebaseAdmin();
    let completedCount = 0;
    const progressRef = tokenRef;
    if (!progressRef) throw new Error("ZIP token reference is unavailable.");
    let progressUpdates: Promise<void> = Promise.resolve();
    archive.on("entry", () => {
      completedCount += 1;
      const nextCount = completedCount;
      progressUpdates = progressUpdates.then(async () => {
        await progressRef.update({ completedCount: nextCount });
      },
      ).catch(() => undefined);
    });
    const streamError = (streamError: Error) => {
      logger.warn(
        { storyId, stage: "stream_zip", reason: storyZipFailureCode(streamError, "stream_zip") },
        "Story ZIP streaming failed.",
      );
      if (!res.headersSent) res.status(502);
      res.destroy(streamError);
    };
    archive.on("error", streamError);
    archive.pipe(res);
    const sceneNumberWidth = images.length > 99 ? 3 : 2;
    for (const image of images) {
      stage = "fetch_asset";
      const source = image.publicId
        ? await cloudinaryImageStream(image.imageUrl)
        : storage.bucket().file(image.storagePath).createReadStream();
      const jpegStream = source.pipe(sharp({ limitInputPixels: 40_000_000 }).jpeg({ quality: 88 }));
      archive.append(jpegStream as Readable, {
        name: `scene_${String(image.index).padStart(sceneNumberWidth, "0")}.jpg`,
      });
    }
    stage = "stream_zip";
    await archive.finalize();
    stage = "wait_for_response";
    await new Promise<void>((resolve, reject) => {
      if (res.writableEnded) {
        resolve();
        return;
      }
      res.once("finish", resolve);
      res.once("error", reject);
      res.once("close", () => {
        if (!res.writableEnded) reject(new Error("ZIP stream closed early."));
      });
    });
    await progressUpdates;
    stage = "save_download_status";
    await tokenRef.update({
      completedCount: images.length,
      status: "done",
      finishedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (uid) {
      const failedRef = storyReference(uid, storyId).collection("downloadTokens").doc(digest);
      await failedRef.update({ status: "failed" }).catch(() => undefined);
    }
    logger.warn(
      { storyId, stage, reason: storyZipFailureCode(error, stage) },
      "Could not complete story ZIP download.",
    );
    if (!res.headersSent) {
      res.status(502).json({ error: "The story ZIP could not be downloaded.", code: "zip_failed" });
    } else if (!res.destroyed) {
      res.destroy();
    }
  }
});

export default router;
