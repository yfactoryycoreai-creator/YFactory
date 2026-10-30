import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";
import type { Archiver, ArchiverOptions } from "archiver";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Router, type IRouter, type Request, type Response } from "express";
import sharp from "sharp";
import {
  clearProviderKeyCooldown,
  getGenerationKeys,
  listProviderConfigs,
  recordProviderKeyFailure,
  type ProviderKey,
} from "../lib/apiKeyVault";
import { deleteFirebaseStorageObject, uploadStoryImageToFirebase } from "../lib/firebaseStorage";
import { getFirebaseAdmin, requireEncryptionKey, verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import { generateImageWithFallback, type GeneratedImageAsset } from "../lib/imageGeneration";
import { logger } from "../lib/logger";

const archiver = createRequire(import.meta.url)("archiver") as (
  format: "zip",
  options: ArchiverOptions,
) => Archiver;
const router: IRouter = Router();
const MAX_STORY_IMAGES = 100;
const MAX_SCENE_CONCURRENCY = 3;
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

function sanitizedSceneError(): string {
  return "This scene could not be generated. Try again.";
}

function splitScenarioIntoMoments(scenario: string, count: number): string[] {
  const clauses = scenario
    .split(/(?:\r?\n+|(?<=[.!?؟。])\s+|(?<=[,،;؛])\s+)/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const words = scenario.match(/\S+/gu) ?? [];
  const moments: string[] = [];

  if (clauses.length >= count) {
    for (let index = 0; index < count; index += 1) {
      const clauseIndex = Math.floor((index * clauses.length) / count);
      moments.push(clauses[clauseIndex] ?? clauses.at(-1) ?? scenario.trim());
    }
  } else if (words.length >= count) {
    for (let index = 0; index < count; index += 1) {
      const start = Math.floor((index * words.length) / count);
      const end = Math.max(start + 1, Math.floor(((index + 1) * words.length) / count));
      moments.push(words.slice(start, end).join(" "));
    }
  } else {
    const source = clauses.length ? clauses : [scenario.trim()];
    for (let index = 0; index < count; index += 1) {
      moments.push(source[index % source.length] ?? scenario.trim());
    }
  }

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
    "single image, one scene only, no grid, no collage, no panels, no split frames, no text overlay";

  return moments.map((moment, index) =>
    `${styleAndCharacterBible}\nScene ${index + 1} of ${count}: depict exactly one frozen visual moment based only on this scene detail: ${moment}. ` +
    `Show no other time or event. ${imageRestriction}.`,
  );
}

function rotateGenerationKeys(
  keys: Awaited<ReturnType<typeof getGenerationKeys>>,
  index: number,
) {
  return Object.fromEntries(Object.entries(keys).map(([provider, entry]) => {
    if (!entry.keys.length) return [provider, entry];
    const offset = (index - 1) % entry.keys.length;
    return [provider, { ...entry, keys: [...entry.keys.slice(offset), ...entry.keys.slice(0, offset)] }];
  }));
}

async function markSceneFailed(uid: string, storyId: string, imageId: string): Promise<void> {
  try {
    await storyReference(uid, storyId).collection("images").doc(imageId).update({
      status: "failed",
      error: sanitizedSceneError(),
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
  providers: Awaited<ReturnType<typeof listProviderConfigs>>,
  keys: Awaited<ReturnType<typeof getGenerationKeys>>,
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
  let uploadedPath = "";
  try {
    const rotatedKeys = rotateGenerationKeys(keys, claimed.index);
    const asset: GeneratedImageAsset = await generateImageWithFallback(
      claimed.scenePrompt,
      rotatedKeys,
      providers,
      fetch,
      async (provider: ProviderKey, keyId: string, status: number | null) => {
        try {
          await recordProviderKeyFailure(uid, provider, keyId, status);
        } catch {
          logger.warn({ provider, status }, "Provider key failure state could not be updated.");
        }
      },
      async (provider: ProviderKey, keyId: string) => {
        try {
          await clearProviderKeyCooldown(uid, provider, keyId);
        } catch {
          logger.warn({ provider }, "Provider key cooldown could not be cleared.");
        }
      },
      (provider, status) => logger.warn({ provider, status }, "An image provider attempt failed."),
      controller.signal,
    );
    const bytes = Buffer.from(asset.base64, "base64");
    const uploaded = await uploadStoryImageToFirebase(
      uid,
      storyId,
      imageId,
      bytes,
      asset.mimeType,
    );
    uploadedPath = uploaded.storagePath;

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
          error: "The story has reached its 100-image limit.",
          generationStartedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return false;
      }
      transaction.update(imageRef, {
        imageUrl: uploaded.imageUrl,
        url: uploaded.imageUrl,
        storagePath: uploaded.storagePath,
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
    if (!saved) await deleteFirebaseStorageObject(uploaded.storagePath);
  } catch {
    if (uploadedPath) await deleteFirebaseStorageObject(uploadedPath).catch(() => undefined);
    await markSceneFailed(uid, storyId, imageId);
    logger.warn({ storyId, imageId }, "A story scene job failed.");
  } finally {
    clearTimeout(timeout);
  }
}

async function processSceneQueue(uid: string, storyId: string, imageIds: string[]): Promise<void> {
  const jobs = imageIds.filter((imageId) => !activeSceneJobs.has(imageId));
  if (!jobs.length) return;
  for (const imageId of jobs) activeSceneJobs.add(imageId);
  try {
    const [providers, keys] = await Promise.all([
      listProviderConfigs(uid),
      getGenerationKeys(uid),
    ]);
    let cursor = 0;
    const workerCount = Math.min(MAX_SCENE_CONCURRENCY, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < jobs.length) {
        const imageId = jobs[cursor];
        cursor += 1;
        if (!imageId) continue;
        await processSceneJob(uid, storyId, imageId, providers, keys);
      }
    }));
  } catch {
    await Promise.all(jobs.map((imageId) => markSceneFailed(uid, storyId, imageId)));
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

router.post("/images/stories/:storyId/scenes", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const requestedCount = Number(req.body?.count);
  if (!validStoryId(storyId) || !prompt || prompt.length > 20_000 ||
      !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_STORY_IMAGES) {
    res.status(400).json({ error: "Provide a valid story, script, and scene count from 1 to 100.", code: "invalid_request" });
    return;
  }

  try {
    const storyRef = storyReference(uid, storyId);
    const db = getFirebaseAdmin().db;
    const batchId = randomBytes(16).toString("hex");
    const sceneJobs = await db.runTransaction(async (transaction) => {
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
        if (Number.isInteger(index) && index >= 1 && index <= MAX_STORY_IMAGES) {
          usedIndexes.add(index);
        }
      }
      const availableIndexes = Array.from(
        { length: MAX_STORY_IMAGES },
        (_, index) => index + 1,
      ).filter((index) => !usedIndexes.has(index));
      const available = Math.max(0, Math.min(availableIndexes.length, MAX_STORY_IMAGES - currentCount));
      const count = Math.min(requestedCount, available);
      if (!count) throw new StoryLimitReachedError();

      const prompts = splitScenarioIntoMoments(prompt, count);
      const jobs: SceneJob[] = [];
      for (let index = 0; index < count; index += 1) {
        const sceneIndex = availableIndexes[index];
        if (sceneIndex === undefined) break;
        const imageRef = storyRef.collection("images").doc();
        const scenePrompt = prompts[index] ?? prompts.at(-1) ?? prompt;
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
          batchTotal: count,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        jobs.push({ id: imageRef.id, index: sceneIndex, scenePrompt, batchId, batchTotal: count, status: "pending" });
      }
      transaction.update(storyRef, {
        imageSequence: Math.max(
          Math.floor(Number(storyData.imageSequence) || 0),
          ...availableIndexes.slice(0, count),
        ),
      });
      return jobs;
    });

    launchSceneQueue(uid, storyId, sceneJobs.map((job) => job.id));
    res.status(202).json({
      batchId,
      sceneCount: sceneJobs.length,
      skippedCount: requestedCount - sceneJobs.length,
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
    const snapshot = await storyRef.collection("images").limit(MAX_STORY_IMAGES).get();
    if (snapshot.empty && !(await storyRef.get()).exists) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    const now = Date.now();
    for (const document of snapshot.docs) {
      const data = document.data();
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
    const imageIds = pending.docs.map((document) => document.id);
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
      const imageCount = Math.max(0, Math.floor(Number(storySnapshot.data()?.imageCount) || 0));
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
      if (data.status !== "done" || !Number.isInteger(data.index) ||
          typeof data.storagePath !== "string" ||
          !data.storagePath.startsWith(`users/${uid}/stories/${storyId}/images/`)) {
        return [];
      }
      return [{
        id: document.id,
        index: data.index as number,
        storagePath: data.storagePath,
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

    const archive = archiver("zip", { zlib: { level: 1 } });
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
      logger.warn({ storyId }, "Story ZIP streaming failed.");
      if (!res.headersSent) res.status(502);
      res.destroy(streamError);
    };
    archive.on("error", streamError);
    archive.pipe(res);
    for (const image of images) {
      const source = storage.bucket().file(image.storagePath).createReadStream();
      const jpegStream = source.pipe(sharp({ limitInputPixels: 40_000_000 }).jpeg({ quality: 88 }));
      archive.append(jpegStream as Readable, {
        name: `scene-${String(image.index).padStart(3, "0")}.jpg`,
      });
    }
    await archive.finalize();
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
    await tokenRef.update({
      completedCount: images.length,
      status: "done",
      finishedAt: FieldValue.serverTimestamp(),
    });
  } catch {
    if (uid) {
      const failedRef = storyReference(uid, storyId).collection("downloadTokens").doc(digest);
      await failedRef.update({ status: "failed" }).catch(() => undefined);
    }
    logger.warn({ storyId }, "Could not complete story ZIP download.");
    if (!res.headersSent) {
      res.status(502).json({ error: "The story ZIP could not be downloaded.", code: "zip_failed" });
    } else if (!res.destroyed) {
      res.destroy();
    }
  }
});

export default router;
