import { randomUUID } from "node:crypto";
import { GenerateStoryImagesBody, GenerateStoryImagesResponse } from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { Router, type IRouter } from "express";
import {
  clearProviderKeyCooldown,
  getGenerationKeys,
  recordProviderKeyFailure,
  type ProviderKey,
  type ProviderGenerationKeys,
} from "../lib/apiKeyVault";
import { getFirebaseAdmin, verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  generateImageWithFallback,
  type GeneratedImageAsset,
  type ImageProvider,
} from "../lib/imageGeneration";

const router: IRouter = Router();
const MAX_STORY_IMAGES = 100;

class StoryNotFoundError extends Error {}

function rotateKeysForImage(
  keys: ProviderGenerationKeys,
  imageIndex: number,
): ProviderGenerationKeys {
  const rotate = (entry: ProviderGenerationKeys[ProviderKey]) => {
    if (!entry.keys.length) return entry;
    const offset = imageIndex % entry.keys.length;
    return {
      ...entry,
      keys: [...entry.keys.slice(offset), ...entry.keys.slice(0, offset)],
    };
  };
  return {
    agnes: rotate(keys.agnes),
    glm: rotate(keys.glm),
    zsky: rotate(keys.zsky),
  };
}

type UploadedStoryImage = {
  asset: GeneratedImageAsset;
  imageId: string;
  storagePath: string;
  url: string;
  sizeBytes: number;
};

async function saveGeneratedImagesToStory(
  uid: string,
  storyId: string,
  prompt: string,
  images: GeneratedImageAsset[],
): Promise<{
  images: Array<{ url: string; provider: ImageProvider; sizeBytes: number }>;
  failedCount: number;
  skippedCount: number;
}> {
  const { db, bucket } = getFirebaseAdmin();
  const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
  const uploadedResults = await Promise.allSettled(
    images.map(async (asset): Promise<UploadedStoryImage> => {
      const imageRef = storyRef.collection("images").doc();
      const storagePath = `users/${uid}/stories/${storyId}/images/${imageRef.id}`;
      const downloadToken = randomUUID();
      const file = bucket.file(storagePath);
      const buffer = Buffer.from(asset.base64, "base64");
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: asset.mimeType,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const url =
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
        `/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
      return { asset, imageId: imageRef.id, storagePath, url, sizeBytes: buffer.length };
    }),
  );
  const uploaded = uploadedResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedCount = uploadedResults.length - uploaded.length;
  if (!uploaded.length) {
    return { images: [], failedCount, skippedCount: 0 };
  }

  let acceptedCount = 0;
  try {
    acceptedCount = await db.runTransaction(async (transaction) => {
      const storySnapshot = await transaction.get(storyRef);
      if (!storySnapshot.exists) throw new StoryNotFoundError();
      const rawCount = Number(storySnapshot.data()?.imageCount) || 0;
      const currentCount = Math.max(0, Math.floor(rawCount));
      const available = Math.max(0, MAX_STORY_IMAGES - currentCount);
      const accepted = uploaded.slice(0, available);

      for (const item of accepted) {
        const imageRef = storyRef.collection("images").doc(item.imageId);
        transaction.create(imageRef, {
          url: item.url,
          prompt,
          createdAt: FieldValue.serverTimestamp(),
          sizeBytes: item.sizeBytes,
          storagePath: item.storagePath,
          provider: item.asset.provider,
        });
      }

      if (accepted.length) {
        transaction.update(storyRef, {
          imageCount: FieldValue.increment(accepted.length),
          storageBytes: FieldValue.increment(
            accepted.reduce((sum, image) => sum + image.sizeBytes, 0),
          ),
        });
      }
      return accepted.length;
    });
  } catch (error) {
    await Promise.all(
      uploaded.map((item) =>
        bucket.file(item.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined),
      ),
    );
    throw error;
  }

  const accepted = uploaded.slice(0, acceptedCount);
  const overflow = uploaded.slice(acceptedCount);
  await Promise.all(
    overflow.map((item) =>
      bucket.file(item.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined),
    ),
  );

  return {
    images: accepted.map((item) => ({
      url: item.url,
      provider: item.asset.provider,
      sizeBytes: item.sizeBytes,
    })),
    failedCount,
    skippedCount: uploaded.length - acceptedCount,
  };
}

router.post("/images/generate", async (req, res): Promise<void> => {
  const parsed = GenerateStoryImagesBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.prompt.trim()) {
    res.status(400).json({
      error: "Provide a prompt and an image count between 1 and 4.",
      code: "invalid_request",
    });
    return;
  }

  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({
      error: "Sign in before generating images.",
      code: "unauthorized",
    });
    return;
  }

  try {
    const uid = await verifyFirebaseIdToken(token);
    if (!uid) {
      res.status(401).json({
        error: "Sign in again before generating images.",
        code: "unauthorized",
      });
      return;
    }

    const { storyId, prompt, count } = parsed.data;
    if (storyId !== null && !/^[A-Za-z0-9_-]{1,200}$/.test(storyId)) {
      res.status(400).json({
        error: "The story ID is invalid.",
        code: "invalid_story_id",
      });
      return;
    }

    const { db } = getFirebaseAdmin();
    let initialSkippedCount = 0;
    let allowedCount = count;
    if (storyId) {
      const storyRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
      const story = await storyRef.get();
      if (!story.exists) {
        res.status(404).json({
          error: "This story could not be found.",
          code: "story_not_found",
        });
        return;
      }
      const storyCount = Math.max(
        0,
        Math.floor(Number(story.data()?.imageCount) || 0),
      );
      if (storyCount >= MAX_STORY_IMAGES) {
        res.status(409).json({
          error: "This story has reached its 100-image limit.",
          code: "story_limit",
        });
        return;
      }
      allowedCount = Math.min(count, MAX_STORY_IMAGES - storyCount);
      initialSkippedCount = count - allowedCount;
    }

    const providerKeys = await getGenerationKeys(uid);
    const settled = await Promise.allSettled(
      Array.from({ length: allowedCount }, (_, imageIndex) =>
        generateImageWithFallback(
          prompt.trim(),
          rotateKeysForImage(providerKeys, imageIndex),
          fetch,
          async (provider: ProviderKey, keyId: string, status: number | null) => {
            try {
              await recordProviderKeyFailure(uid, provider, keyId, status);
            } catch {
              req.log.warn({ provider, status }, "Could not update provider key failure status.");
            }
          },
          async (provider: ProviderKey, keyId: string) => {
            try {
              await clearProviderKeyCooldown(uid, provider, keyId);
            } catch {
              req.log.warn({ provider }, "Could not clear provider key status.");
            }
          },
          (provider: ImageProvider, status: number | null) => {
            req.log.warn({ provider, status }, "Image provider attempt failed.");
          },
        ),
      ),
    );
    const generated = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    let responseImages: Array<{
      base64?: string;
      url?: string;
      mimeType?: string;
      sizeBytes?: number;
      provider: ImageProvider;
    }>;
    let storageFailedCount = 0;
    let concurrentCapSkippedCount = 0;

    if (storyId && generated.length) {
      const saved = await saveGeneratedImagesToStory(
        uid,
        storyId,
        prompt.trim(),
        generated,
      );
      responseImages = saved.images;
      storageFailedCount = saved.failedCount;
      concurrentCapSkippedCount = saved.skippedCount;
    } else {
      responseImages = generated.map((image) => ({
        base64: image.base64,
        mimeType: image.mimeType,
        provider: image.provider,
      }));
    }

    const failedCount =
      allowedCount - generated.length + storageFailedCount;
    const skippedCount = initialSkippedCount + concurrentCapSkippedCount;

    if (storyId && generated.length && !responseImages.length && skippedCount > 0) {
      res.status(409).json({
        error: "This story has reached its 100-image limit.",
        code: "story_limit",
        failedCount,
        skippedCount,
      });
      return;
    }
    if (!responseImages.length) {
      res.status(502).json({
        error: "Image generation failed. Please try again shortly.",
        code: "all_providers_failed",
        failedCount,
        skippedCount,
      });
      return;
    }

    res.json(
      GenerateStoryImagesResponse.parse({
        images: responseImages,
        failedCount,
        skippedCount,
      }),
    );
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      res.status(404).json({
        error: "This story could not be found.",
        code: "story_not_found",
      });
      return;
    }
    req.log.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Image generation request failed.",
    );
    res.status(500).json({
      error: "Image generation failed. Please try again shortly.",
      code: "image_generation_failed",
    });
  }
});

export default router;
