import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { Router, type IRouter } from "express";
import {
  clearProviderKeyCooldown,
  getGenerationKeys,
  listProviderConfigs,
  recordProviderKeyFailure,
  type ProviderConfig,
  type ProviderKey,
} from "../lib/apiKeyVault";
import { cloudinaryThumbnailUrl, cloudinaryWebpUrl, deleteCloudinaryImage, getCloudinaryUsage, uploadStoryImage } from "../lib/cloudinary";
import { getFirebaseAdmin, verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  generateImageWithFallback,
  ProviderAttemptError,
  type GeneratedImageAsset,
} from "../lib/imageGeneration";
import { createZipArchive } from "../lib/zipArchive";
import sharp from "sharp";

const router: IRouter = Router();
const MAX_STORY_IMAGES = 100;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

class StoryNotFoundError extends Error {}
class StoryLimitReachedError extends Error {}

type StoredImage = {
  id: string;
  url: string;
  thumbnailUrl?: string;
  publicId?: string;
  folder?: string;
  prompt: string;
  createdAt: unknown;
  sizeBytes: number;
  storagePath: string;
  provider: string;
  sequence?: number;
};

function storyFolder(storyName: string, storyId: string): string {
  const slug = storyName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "story";
  return `yfactory/${slug}-${storyId}`;
}

function sequenceId(value: number): string {
  return String(value).padStart(3, "0");
}

async function reserveSequence(
  storyRef: FirebaseFirestore.DocumentReference,
): Promise<{ number: number; storyName: string }> {
  return getFirebaseAdmin().db.runTransaction(async (transaction) => {
    const story = await transaction.get(storyRef);
    if (!story.exists) throw new StoryNotFoundError();
    const count = Math.max(0, Math.floor(Number(story.data()?.imageCount) || 0));
    if (count >= MAX_STORY_IMAGES) throw new StoryLimitReachedError();
    const current = Math.max(count, Math.floor(Number(story.data()?.imageSequence) || 0));
    const number = current + 1;
    transaction.update(storyRef, { imageSequence: number });
    return {
      number,
      storyName: typeof story.data()?.storyName === "string" ? story.data()!.storyName as string : "story",
    };
  });
}

async function saveOneImage(
  uid: string,
  storyId: string,
  prompt: string,
  asset: GeneratedImageAsset,
  persist = true,
): Promise<StoredImage> {
  const db = getFirebaseAdmin().db;
  const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
  const imageRef = storyRef.collection("images").doc(randomUUID());
  const reserved = await reserveSequence(storyRef);
  const folder = storyFolder(reserved.storyName, storyId);
  const proposedPublicId = sequenceId(reserved.number);
  const buffer = Buffer.from(asset.base64, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Generated image was empty or larger than 10 MB.");
  }

  let url = asset.sourceUrl ?? "";
  let thumbnailUrl = url;
  let publicId: string | undefined;
  let sizeBytes = buffer.length;
  try {
    const upload = await uploadStoryImage(uid, folder, proposedPublicId, buffer, asset.mimeType);
    if (upload) {
      url = upload.secureUrl;
      thumbnailUrl = cloudinaryThumbnailUrl(upload.secureUrl);
      publicId = upload.publicId;
      sizeBytes = upload.bytes;
    }
  } catch (error) {
    // Keep generation usable when Cloudinary is unavailable; a provider URL is the fallback.
    if (!asset.sourceUrl) throw error;
  }
  if (!url) {
    throw new Error("Cloudinary is unavailable and this provider returned no fallback image URL.");
  }

  const stored: StoredImage = {
    id: imageRef.id,
    url,
    thumbnailUrl,
    ...(publicId ? { publicId } : {}),
    folder,
    prompt,
    createdAt: new Date(),
    sizeBytes,
    storagePath: folder,
    provider: asset.provider,
    sequence: reserved.number,
  };
  if (!persist) return stored;

  try {
    await db.runTransaction(async (transaction) => {
      const story = await transaction.get(storyRef);
      if (!story.exists) throw new StoryNotFoundError();
      const count = Math.max(0, Math.floor(Number(story.data()?.imageCount) || 0));
      if (count >= MAX_STORY_IMAGES) throw new StoryLimitReachedError();
      transaction.create(imageRef, {
        url: stored.url,
        thumbnailUrl: stored.thumbnailUrl,
        ...(stored.publicId ? { publicId: stored.publicId } : {}),
        folder: stored.folder,
        sequence: stored.sequence,
        prompt: stored.prompt,
        createdAt: FieldValue.serverTimestamp(),
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        provider: stored.provider,
      });
      transaction.update(storyRef, {
        imageCount: FieldValue.increment(1),
        storageBytes: FieldValue.increment(stored.sizeBytes),
      });
    });
  } catch (error) {
    if (publicId) await deleteCloudinaryImage(uid, publicId).catch(() => undefined);
    throw error;
  }
  return stored;
}

async function saveGeneratedImagesToStory(
  uid: string,
  storyId: string,
  prompt: string,
  images: GeneratedImageAsset[],
): Promise<{ images: StoredImage[]; failedCount: number; skippedCount: number }> {
  const settled = await Promise.allSettled(
    images.map((image) => saveOneImage(uid, storyId, prompt, image, false)),
  );
  const prepared = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
  const preparationFailures = settled.length - prepared.length;
  if (!prepared.length) {
    return { images: [], failedCount: preparationFailures, skippedCount: 0 };
  }
  const db = getFirebaseAdmin().db;
  const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
  let saved: StoredImage[] = [];
  try {
    await db.runTransaction(async (transaction) => {
      const story = await transaction.get(storyRef);
      if (!story.exists) throw new StoryNotFoundError();
      const count = Math.max(0, Math.floor(Number(story.data()?.imageCount) || 0));
      const accepted = prepared.slice(0, Math.max(0, MAX_STORY_IMAGES - count));
      if (!accepted.length) throw new StoryLimitReachedError();
      for (const image of accepted) {
        transaction.create(storyRef.collection("images").doc(image.id), {
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          ...(image.publicId ? { publicId: image.publicId } : {}),
          folder: image.folder,
          sequence: image.sequence,
          prompt: image.prompt,
          createdAt: FieldValue.serverTimestamp(),
          sizeBytes: image.sizeBytes,
          storagePath: image.storagePath,
          provider: image.provider,
        });
      }
      transaction.update(storyRef, {
        imageCount: FieldValue.increment(accepted.length),
        storageBytes: FieldValue.increment(accepted.reduce((sum, image) => sum + image.sizeBytes, 0)),
      });
      saved = accepted;
    });
  } catch {
    await Promise.all(prepared.map((image) =>
      image.publicId ? deleteCloudinaryImage(uid, image.publicId).catch(() => undefined) : Promise.resolve(),
    ));
    return { images: [], failedCount: images.length, skippedCount: 0 };
  }
  const savedIds = new Set(saved.map((image) => image.id));
  await Promise.all(prepared.filter((image) => !savedIds.has(image.id)).map((image) =>
    image.publicId ? deleteCloudinaryImage(uid, image.publicId).catch(() => undefined) : Promise.resolve(),
  ));
  return {
    images: saved,
    failedCount: preparationFailures + prepared.length - saved.length,
    skippedCount: 0,
  };
}

async function parseImageData(value: unknown): Promise<{ asset: GeneratedImageAsset }> {
  if (typeof value !== "string") throw new Error("Image data is required.");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (match?.[1] && match[2]) {
    const data = Buffer.from(match[2], "base64");
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw new Error("Image must be under 10 MB.");
    return { asset: { base64: data.toString("base64"), mimeType: match[1], provider: "pollinations" } };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Image URL is invalid.");
  }
  if (!safeImageUrl(value)) {
    throw new Error("Only public HTTPS image URLs are allowed.");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error("The provider image URL could not be fetched.");
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!mimeType.startsWith("image/")) throw new Error("The provider URL did not return an image.");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error("Image must be under 10 MB.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Image must be under 10 MB.");
  return {
    asset: {
      base64: bytes.toString("base64"),
      mimeType,
      provider: "pollinations",
      sourceUrl: value,
    },
  };
}

async function authenticatedUid(req: Parameters<Parameters<IRouter["get"]>[1]>[0], res: Parameters<Parameters<IRouter["get"]>[1]>[1]): Promise<string | null> {
  const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in before managing story images.", code: "unauthorized" });
    return null;
  }
  try {
    const uid = await verifyFirebaseIdToken(token);
    if (!uid) res.status(401).json({ error: "Sign in again before managing story images.", code: "unauthorized" });
    return uid;
  } catch {
    res.status(503).json({ error: "Firebase authentication is unavailable.", code: "server_configuration" });
    return null;
  }
}

function safeImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname !== "localhost" &&
      !url.hostname.endsWith(".local") &&
      !url.hostname.startsWith("127.") &&
      !url.hostname.startsWith("10.") &&
      !url.hostname.startsWith("192.168.") &&
      !url.hostname.startsWith("169.254.");
  } catch {
    return false;
  }
}

router.get("/images/storage-usage", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  try {
    res.json(await getCloudinaryUsage(uid));
  } catch (error) {
    req.log.warn({ reason: error instanceof Error ? error.message : "unknown" }, "Could not read Cloudinary usage.");
    res.status(502).json({ error: "Cloudinary usage could not be loaded.", code: "cloudinary_usage_failed" });
  }
});

router.post("/images/stories/:storyId/images", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(storyId)) {
    res.status(400).json({ error: "The story ID is invalid.", code: "invalid_story_id" });
    return;
  }
  try {
    const { asset } = await parseImageData(req.body?.imageData);
    asset.provider = typeof req.body?.provider === "string" ? req.body.provider.slice(0, 64) : "pollinations";
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 20_000) : "";
    const saved = await saveOneImage(uid, storyId, prompt, asset);
    res.status(201).json(saved);
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    if (error instanceof StoryLimitReachedError) {
      res.status(409).json({ error: "This story has reached its 100-image limit.", code: "story_limit" });
      return;
    }
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not save story image.");
    res.status(502).json({ error: error instanceof Error ? error.message : "The image could not be saved.", code: "image_save_failed" });
  }
});

router.delete("/images/stories/:storyId/images/:imageId", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  const imageId = String(req.params.imageId ?? "");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(storyId) || !/^[A-Za-z0-9_-]{1,200}$/.test(imageId)) {
    res.status(400).json({ error: "The image reference is invalid.", code: "invalid_request" });
    return;
  }
  try {
    const db = getFirebaseAdmin().db;
    const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
    const imageRef = storyRef.collection("images").doc(imageId);
    let publicId: string | undefined;
    await db.runTransaction(async (transaction) => {
      const [story, image] = await Promise.all([transaction.get(storyRef), transaction.get(imageRef)]);
      if (!story.exists || !image.exists) return;
      const data = image.data() ?? {};
      publicId = typeof data.publicId === "string" ? data.publicId : undefined;
      transaction.delete(imageRef);
      transaction.update(storyRef, {
        imageCount: FieldValue.increment(-1),
        storageBytes: FieldValue.increment(-Math.max(0, Number(data.sizeBytes) || 0)),
      });
    });
    if (publicId) {
      await deleteCloudinaryImage(uid, publicId).catch((error) => {
        req.log.warn({ reason: error instanceof Error ? error.message : "unknown" }, "Cloudinary cleanup failed.");
      });
    }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not delete story image.");
    res.status(500).json({ error: "The image could not be deleted.", code: "image_delete_failed" });
  }
});

router.get("/images/stories/:storyId/download.zip", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const storyId = String(req.params.storyId ?? "");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(storyId)) {
    res.status(400).json({ error: "The story ID is invalid.", code: "invalid_story_id" });
    return;
  }
  try {
    const db = getFirebaseAdmin().db;
    const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
    const story = await storyRef.get();
    if (!story.exists) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    const snapshot = await storyRef.collection("images").orderBy("createdAt", "asc").limit(MAX_STORY_IMAGES).get();
    const files: Array<{ name: string; data: Buffer }> = [];
    for (const [index, document] of snapshot.docs.entries()) {
      const image = document.data();
      const url = typeof image.url === "string" ? image.url : "";
      if (!safeImageUrl(url)) continue;
      const transformed = typeof image.publicId === "string" ? cloudinaryWebpUrl(url) : url;
      const response = await fetch(transformed, { signal: AbortSignal.timeout(40_000) });
      if (!response.ok) continue;
      const sourceBytes = Buffer.from(await response.arrayBuffer());
      if (!sourceBytes.length || sourceBytes.length > MAX_IMAGE_BYTES) continue;
      const bytes = await sharp(sourceBytes, { limitInputPixels: 40_000_000 }).webp().toBuffer();
      const imageNumber = sequenceId(index + 1);
      files.push({ name: `${String(story.data()?.storyName ?? "story").slice(0, 70)}_${imageNumber}.webp`, data: bytes });
    }
    if (!files.length) {
      res.status(404).json({ error: "This story has no downloadable images.", code: "no_images" });
      return;
    }
    const archive = createZipArchive(files);
    const name = String(story.data()?.storyName ?? "story").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 70) || "story";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.zip"`);
    res.setHeader("Content-Length", archive.length);
    res.send(archive);
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not create story ZIP.");
    res.status(502).json({ error: "The story ZIP could not be created.", code: "zip_failed" });
  }
});

router.post("/images/generate", async (req, res): Promise<void> => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
  const count = Number(req.body?.count);
  const storyId = req.body?.storyId;
  if (!prompt.trim() || prompt.length > 20_000 || !Number.isInteger(count) || count < 1 || count > 5 ||
      !(storyId === null || typeof storyId === "string")) {
    res.status(400).json({ error: "Provide a prompt of up to 20,000 characters and an image count between 1 and 5.", code: "invalid_request" });
    return;
  }
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  try {
    const id = storyId as string | null;
    const db = getFirebaseAdmin().db;
    let allowedCount = count;
    let initialSkippedCount = 0;
    let storyName: string | undefined;
    if (id) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
        res.status(400).json({ error: "The story ID is invalid.", code: "invalid_story_id" });
        return;
      }
      const story = await db.collection("users").doc(uid).collection("stories").doc(id).get();
      if (!story.exists) {
        res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
        return;
      }
      storyName = typeof story.data()?.storyName === "string" ? story.data()!.storyName as string : "story";
      const currentCount = Math.max(0, Math.floor(Number(story.data()?.imageCount) || 0));
      allowedCount = Math.min(count, MAX_STORY_IMAGES - currentCount);
      initialSkippedCount = count - allowedCount;
      if (!allowedCount) {
        res.status(409).json({ error: "This story has reached its 100-image limit.", code: "story_limit", failedCount: 0, skippedCount: count });
        return;
      }
    }

    const providers = await listProviderConfigs(uid);
    const keys = await getGenerationKeys(uid, providers);
    const settled = await Promise.allSettled(
      Array.from({ length: allowedCount }, (_, imageIndex) => {
        const rotatedKeys = Object.fromEntries(Object.entries(keys).map(([provider, entry]) => {
          if (!entry.keys.length) return [provider, entry];
          const offset = imageIndex % entry.keys.length;
          return [provider, { ...entry, keys: [...entry.keys.slice(offset), ...entry.keys.slice(0, offset)] }];
        }));
        return generateImageWithFallback(prompt.trim(), rotatedKeys, providers, fetch,
          async (provider: ProviderKey, keyId: string, status: number | null) => {
            try { await recordProviderKeyFailure(uid, provider, keyId, status); }
            catch { req.log.warn({ provider, status }, "Could not update provider key failure status."); }
          },
          async (provider: ProviderKey, keyId: string) => {
            try { await clearProviderKeyCooldown(uid, provider, keyId); }
            catch { req.log.warn({ provider }, "Could not clear provider key status."); }
          },
          (provider, status) => req.log.warn({ provider, status }, "Image provider attempt failed."),
        );
      }),
    );
    const generated = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    let saved: StoredImage[] = [];
    let storageFailed = 0;
    if (id && generated.length) {
      const persisted = await saveGeneratedImagesToStory(uid, id, prompt.trim(), generated);
      saved = persisted.images;
      storageFailed = persisted.failedCount;
    }
    const failedCount = allowedCount - generated.length + storageFailed;
    const skippedCount = initialSkippedCount;
    const responseImages = id
      ? saved.map((image) => ({
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          publicId: image.publicId,
          folder: image.folder,
          sequence: image.sequence,
          provider: image.provider,
          sizeBytes: image.sizeBytes,
          savedToFactory: true,
        }))
      : generated.map((image) => ({
          ...(image.sourceUrl ? { url: image.sourceUrl } : { base64: image.base64 }),
          mimeType: image.mimeType,
          provider: image.provider,
        }));
    if (!responseImages.length) {
      res.status(502).json({
        error: id
          ? `No images could be saved to ${storyName ?? "this story"}. Cloudinary may be unavailable, or the provider returned no URL fallback.`
          : "Image generation failed. Check that at least one provider has an enabled key.",
        code: generated.length ? "image_save_failed" : "all_providers_failed",
        failedCount,
        skippedCount,
      });
      return;
    }
    res.json({ images: responseImages, failedCount, skippedCount });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Image generation request failed.");
    res.status(500).json({ error: "Image generation failed. Please try again shortly.", code: "image_generation_failed" });
  }
});

export default router;
