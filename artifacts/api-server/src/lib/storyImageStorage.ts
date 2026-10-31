import { deleteCloudinaryImage, uploadStoryImage } from "./cloudinary";
import { deleteFirebaseStorageObject } from "./firebaseStorage";

export type StoryImageUpload = {
  imageUrl: string;
  storagePath: string;
  sizeBytes: number;
  publicId: string;
  folder: string;
  format: string;
};

export type StoryImageStorageReference = {
  publicId?: string;
  storagePath?: string;
};

export interface StoryImageStorageAdapter {
  upload(
    uid: string,
    storyId: string,
    imageId: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<StoryImageUpload>;
  delete(uid: string, reference: StoryImageStorageReference): Promise<void>;
}

const cloudinaryStoryImageStorage: StoryImageStorageAdapter = {
  async upload(uid, storyId, imageId, bytes, mimeType) {
    const folder = `users/${uid}/stories/${storyId}/images`;
    const uploaded = await uploadStoryImage(uid, folder, imageId, bytes, mimeType);
    if (!uploaded) {
      throw new Error("Cloudinary storage is not configured.");
    }

    const prefix = `${folder}/`;
    if (!uploaded.publicId.startsWith(prefix)) {
      await deleteCloudinaryImage(uid, uploaded.publicId).catch(() => undefined);
      throw new Error("Cloudinary returned an unexpected image identifier.");
    }

    return {
      imageUrl: uploaded.secureUrl,
      storagePath: uploaded.publicId,
      sizeBytes: uploaded.bytes,
      publicId: uploaded.publicId,
      folder,
      format: uploaded.format,
    };
  },

  async delete(uid, reference) {
    if (reference.publicId) {
      if (!reference.publicId.startsWith(`users/${uid}/stories/`)) {
        throw new Error("Cloudinary image identifier is outside the user's story folder.");
      }
      await deleteCloudinaryImage(uid, reference.publicId);
      return;
    }

    if (reference.storagePath?.startsWith(`users/${uid}/stories/`)) {
      await deleteFirebaseStorageObject(reference.storagePath);
    }
  },
};

export const storyImageStorage: StoryImageStorageAdapter =
  cloudinaryStoryImageStorage;
