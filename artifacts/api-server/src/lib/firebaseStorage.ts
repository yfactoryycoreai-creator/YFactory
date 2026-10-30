import { randomUUID } from "node:crypto";
import { getFirebaseAdmin } from "./firebaseAdmin";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type UploadedStoryImage = {
  imageUrl: string;
  storagePath: string;
  sizeBytes: number;
};

export async function uploadStoryImageToFirebase(
  uid: string,
  storyId: string,
  imageId: string,
  bytes: Buffer,
  mimeType: string,
): Promise<UploadedStoryImage> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Image must be under 10 MB.");
  }
  if (!/^image\/(?:png|jpeg|webp|gif|avif)$/i.test(mimeType)) {
    throw new Error("The generated image format is not supported.");
  }

  const { storage } = getFirebaseAdmin();
  const bucket = storage.bucket();
  if (!bucket.name) throw new Error("Firebase Storage is not configured.");
  const extension = mimeType.toLowerCase() === "image/jpeg"
    ? "jpg"
    : mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const storagePath = `users/${uid}/stories/${storyId}/images/${imageId}.${extension}`;
  const downloadToken = randomUUID();
  const file = bucket.file(storagePath);

  await file.save(bytes, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      cacheControl: "private, max-age=3600",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });

  return {
    imageUrl:
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`,
    storagePath,
    sizeBytes: bytes.length,
  };
}

export async function deleteFirebaseStorageObject(storagePath: string): Promise<void> {
  if (!storagePath.startsWith("users/")) return;
  const { storage } = getFirebaseAdmin();
  await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
}
