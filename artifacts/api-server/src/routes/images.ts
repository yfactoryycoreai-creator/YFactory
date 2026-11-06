import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { Router, type IRouter } from "express";
import { getCloudinaryUsage } from "../lib/cloudinary";
import { getFirebaseAdmin, verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import { storyImageStorage } from "../lib/storyImageStorage";
import {
  generateImageEditWithReference,
  generateImageWithFallback,
  ImageGenerationFailure,
  ProviderAttemptError,
  type GeneratedImageAsset,
} from "../lib/imageGeneration";
import storyScenesRouter from "./storyScenes";

const router: IRouter = Router();
router.use(storyScenesRouter);
const MAX_STORY_IMAGES = 100;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_CONCURRENCY = 2;

class StoryNotFoundError extends Error {}
class StoryLimitReachedError extends Error {}

type StoredImage = {
  id: string;
  url: string;
  imageUrl?: string;
  prompt: string;
  scenePrompt?: string;
  createdAt: unknown;
  sizeBytes: number;
  storagePath: string;
  publicId: string;
  folder: string;
  format: string;
  provider: string;
  index?: number;
  status?: "done";
  error?: string;
  sequence?: number;
};

async function saveOneImage(
  uid: string,
  storyId: string,
  prompt: string,
  asset: GeneratedImageAsset,
): Promise<StoredImage> {
  const db = getFirebaseAdmin().db;
  const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
  const imageRef = storyRef.collection("images").doc(randomUUID());
  const buffer = Buffer.from(asset.base64, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("Generated image was empty or larger than 10 MB.");
  }
  const uploaded = await storyImageStorage.upload(
    uid,
    storyId,
    imageRef.id,
    buffer,
    asset.mimeType,
  );
  let sequence = 0;
  try {
    await db.runTransaction(async (transaction) => {
      const [story, images] = await Promise.all([
        transaction.get(storyRef),
        transaction.get(storyRef.collection("images")),
      ]);
      if (!story.exists) throw new StoryNotFoundError();
      const storyData = story.data() ?? {};
      const count = Math.max(0, Math.floor(Number(storyData.imageCount) || 0));
      if (count >= MAX_STORY_IMAGES) throw new StoryLimitReachedError();
      const usedIndexes = new Set<number>();
      for (const image of images.docs) {
        const data = image.data();
        const index = Number(data.index ?? data.sequence);
        if (Number.isInteger(index) && index >= 1 && index <= MAX_STORY_IMAGES) {
          usedIndexes.add(index);
        }
      }
      sequence = Array.from(
        { length: MAX_STORY_IMAGES },
        (_, index) => index + 1,
      ).find((index) => !usedIndexes.has(index)) ?? 0;
      if (!sequence) throw new StoryLimitReachedError();
      transaction.create(imageRef, {
        index: sequence,
        scenePrompt: prompt,
        prompt,
        imageUrl: uploaded.imageUrl,
        url: uploaded.imageUrl,
        status: "done",
        error: "",
        batchId: `single-${imageRef.id}`,
        batchTotal: 1,
        createdAt: FieldValue.serverTimestamp(),
        sizeBytes: uploaded.sizeBytes,
        storagePath: uploaded.storagePath,
        publicId: uploaded.publicId,
        folder: uploaded.folder,
        format: uploaded.format,
        provider: asset.provider,
      });
      transaction.update(storyRef, {
        imageSequence: Math.max(
          Math.floor(Number(storyData.imageSequence) || 0),
          sequence,
        ),
        imageCount: FieldValue.increment(1),
        storageBytes: FieldValue.increment(uploaded.sizeBytes),
      });
    });
  } catch (error) {
    await storyImageStorage.delete(uid, uploaded).catch(() => undefined);
    throw error;
  }
  return {
    id: imageRef.id,
    url: uploaded.imageUrl,
    imageUrl: uploaded.imageUrl,
    prompt,
    scenePrompt: prompt,
    createdAt: new Date(),
    sizeBytes: uploaded.sizeBytes,
    storagePath: uploaded.storagePath,
    publicId: uploaded.publicId,
    folder: uploaded.folder,
    format: uploaded.format,
    provider: asset.provider,
    index: sequence,
    status: "done",
    error: "",
    sequence,
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

function parseImageEditReference(value: unknown): { bytes: Buffer; mimeType: string } {
  if (typeof value !== "string") throw new Error("Image reference is required.");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match?.[1] || !match[2]) throw new Error("Use a JPG, PNG, or WEBP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
    throw new Error("The resized reference image must be under 5 MB.");
  }
  const mimeType = match[1].toLowerCase();
  const isPng = bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (
    (mimeType === "image/png" && !isPng) ||
    (mimeType === "image/jpeg" && !isJpeg) ||
    (mimeType === "image/webp" && !isWebp)
  ) {
    throw new Error("The reference image data is invalid.");
  }
  return { bytes, mimeType };
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
    req.log.error({ storyId }, "Could not save story image.");
    res.status(502).json({ error: "The image could not be saved. Please try again.", code: "image_save_failed" });
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
    let storagePath: string | undefined;
    await db.runTransaction(async (transaction) => {
      const [story, image] = await Promise.all([transaction.get(storyRef), transaction.get(imageRef)]);
      if (!story.exists || !image.exists) return;
      const data = image.data() ?? {};
      publicId = typeof data.publicId === "string" ? data.publicId : undefined;
      storagePath = typeof data.storagePath === "string" ? data.storagePath : undefined;
      const counted = data.status !== "pending" && data.status !== "generating" && data.status !== "failed";
      const currentCount = Math.max(0, Math.floor(Number(story.data()?.imageCount) || 0));
      const currentBytes = Math.max(0, Number(story.data()?.storageBytes) || 0);
      transaction.delete(imageRef);
      transaction.update(storyRef, {
        imageCount: Math.max(0, currentCount - (counted ? 1 : 0)),
        storageBytes: Math.max(0, currentBytes - (counted ? Math.max(0, Number(data.sizeBytes) || 0) : 0)),
      });
    });
    if (publicId || storagePath) {
      await storyImageStorage.delete(uid, { publicId, storagePath }).catch(() => {
        req.log.warn({ storyId, imageId }, "Story image storage cleanup failed.");
      });
    }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not delete story image.");
    res.status(500).json({ error: "The image could not be deleted.", code: "image_delete_failed" });
  }
});

router.post("/images/edit", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt || prompt.length > 20_000) {
    res.status(400).json({ error: "Add an edit prompt of up to 20,000 characters.", code: "invalid_request" });
    return;
  }
  let reference: { bytes: Buffer; mimeType: string };
  try {
    reference = parseImageEditReference(req.body?.referenceImage);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "The reference image is invalid.",
      code: "invalid_reference",
    });
    return;
  }

  let uploadedReference: Awaited<ReturnType<typeof storyImageStorage.upload>> | null = null;
  let generated: GeneratedImageAsset | null = null;
  try {
    uploadedReference = await storyImageStorage.upload(
      uid,
      "image-edits",
      randomUUID(),
      reference.bytes,
      reference.mimeType,
    );
    generated = await generateImageEditWithReference(prompt, uploadedReference.imageUrl);
  } catch (error) {
    if (error instanceof ImageGenerationFailure) {
      const status = error.code === "missing_key" ? 503 : error.code === "bad_prompt" ? 400 : 502;
      const message = error.code === "missing_key"
        ? "Configure an Agnes image key to edit images."
        : error.code === "bad_prompt"
          ? "Revise the image-edit prompt and try again."
          : "Image editing is temporarily unavailable. Please try again.";
      res.status(status).json({ error: message, code: error.code });
    } else {
      req.log.warn(
        { reason: error instanceof Error ? error.name : "unknown" },
        "Image edit request failed.",
      );
      res.status(502).json({ error: "The reference image could not be processed.", code: "image_edit_failed" });
    }
  } finally {
    if (uploadedReference) {
      await storyImageStorage.delete(uid, uploadedReference).catch(() => {
        req.log.warn("Temporary image-edit reference cleanup failed.");
      });
    }
  }
  if (generated) {
    res.json({
      image: {
        base64: generated.base64,
        mimeType: generated.mimeType,
        provider: generated.provider,
      },
    });
  }
});

router.post("/images/generate", async (req, res): Promise<void> => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
  const count = Number(req.body?.count);
  const storyId = req.body?.storyId;
  if (!prompt.trim() || prompt.length > 20_000 || !Number.isInteger(count) || count < 1 || count > 5 ||
      storyId !== null) {
    res.status(400).json({ error: "Provide a prompt of up to 20,000 characters and an image count between 1 and 5.", code: "invalid_request" });
    return;
  }
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  try {
    const generatedByIndex: (GeneratedImageAsset | undefined)[] = new Array(count);
    let nextImageIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(MAX_IMAGE_CONCURRENCY, count) }, async () => {
        while (nextImageIndex < count) {
          const imageIndex = nextImageIndex;
          nextImageIndex += 1;
          try {
            generatedByIndex[imageIndex] = await generateImageWithFallback(
              prompt.trim(),
              fetch,
            );
          } catch {
            // Preserve successful images in a partially completed batch.
          }
        }
      }),
    );
    const generated = generatedByIndex.filter(
      (image): image is GeneratedImageAsset => Boolean(image),
    );
    const failedCount = count - generated.length;
    const responseImages = generated.map((image) => ({
      base64: image.base64,
      mimeType: image.mimeType,
      provider: image.provider,
    }));
    if (!responseImages.length) {
      res.status(502).json({
        error: "Image generation failed. Check that at least one provider has an enabled key.",
        code: "all_providers_failed",
        failedCount,
        skippedCount: 0,
      });
      return;
    }
    res.json({ images: responseImages, failedCount, skippedCount: 0 });
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({ error: "This story could not be found.", code: "story_not_found" });
      return;
    }
    req.log.error({ storyId }, "Image generation request failed.");
    res.status(500).json({ error: "Image generation failed. Please try again shortly.", code: "image_generation_failed" });
  }
});

export default router;
