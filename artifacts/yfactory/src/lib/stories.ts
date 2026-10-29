import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { firebaseStorage, firestore } from '@/lib/firebase';

export const MAX_STORY_IMAGES = 100;

export type StoryRecord = {
  id: string;
  storyName: string;
  script: string;
  createdAt: unknown;
  imageCount: number;
  storageBytes: number;
};

export type StoryImageRecord = {
  id: string;
  url: string;
  prompt: string;
  createdAt: unknown;
  sizeBytes: number;
  storagePath: string;
  provider?: 'agnes' | 'glm' | 'pollinations';
};

export class StoryLimitReachedError extends Error {
  constructor() {
    super('Story limit reached (100 images). Start a new story.');
    this.name = 'StoryLimitReachedError';
  }
}

function requireFirestore() {
  if (!firestore) throw new Error('Firebase Firestore is not configured.');
  return firestore;
}

function requireStorage() {
  if (!firebaseStorage) {
    throw new Error(
      'Firebase Storage is not configured. Set the Firebase storage bucket and enable Storage for this project.',
    );
  }
  return firebaseStorage;
}

function userStoriesCollection(uid: string) {
  return collection(requireFirestore(), 'users', uid, 'stories');
}

function storyDocument(uid: string, storyId: string) {
  return doc(requireFirestore(), 'users', uid, 'stories', storyId);
}

function storyImagesCollection(uid: string, storyId: string) {
  return collection(
    requireFirestore(),
    'users',
    uid,
    'stories',
    storyId,
    'images',
  );
}

function normalizeStory(id: string, data: DocumentData): StoryRecord {
  return {
    id,
    storyName: typeof data.storyName === 'string' ? data.storyName : '',
    script: typeof data.script === 'string' ? data.script : '',
    createdAt: data.createdAt ?? null,
    imageCount:
      typeof data.imageCount === 'number'
        ? Math.min(MAX_STORY_IMAGES, Math.max(0, data.imageCount))
        : 0,
    storageBytes:
      typeof data.storageBytes === 'number'
        ? Math.max(0, data.storageBytes)
        : 0,
  };
}

function normalizeImage(id: string, data: DocumentData): StoryImageRecord {
  return {
    id,
    url: typeof data.url === 'string' ? data.url : '',
    prompt: typeof data.prompt === 'string' ? data.prompt : '',
    createdAt: data.createdAt ?? null,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    storagePath: typeof data.storagePath === 'string' ? data.storagePath : '',
    provider:
      data.provider === 'agnes' ||
      data.provider === 'glm' ||
      data.provider === 'pollinations'
        ? data.provider
        : undefined,
  };
}

export function subscribeToStories(
  uid: string,
  onStories: (stories: StoryRecord[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const storiesQuery = query(userStoriesCollection(uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    storiesQuery,
    (snapshot) => {
      onStories(snapshot.docs.map((item) => normalizeStory(item.id, item.data())));
    },
    onError,
  );
}

export function subscribeToStoryImages(
  uid: string,
  storyId: string,
  onImages: (images: StoryImageRecord[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const imagesQuery = query(
    storyImagesCollection(uid, storyId),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    imagesQuery,
    (snapshot) => {
      onImages(snapshot.docs.map((item) => normalizeImage(item.id, item.data())));
    },
    onError,
  );
}

export async function createStory(uid: string, storyName: string): Promise<string> {
  const storyRef = doc(userStoriesCollection(uid));
  await setDoc(storyRef, {
    storyName: storyName.trim(),
    script: '',
    createdAt: serverTimestamp(),
    imageCount: 0,
    storageBytes: 0,
  });
  return storyRef.id;
}

export async function updateStoryScript(
  uid: string,
  storyId: string,
  script: string,
): Promise<void> {
  await updateDoc(storyDocument(uid, storyId), { script });
}

export async function saveImageToStory(
  uid: string,
  storyId: string,
  imageBlob: Blob,
  prompt: string,
  provider?: 'agnes' | 'glm' | 'pollinations',
): Promise<StoryImageRecord> {
  const db = requireFirestore();
  const storage = requireStorage();
  const imageRef = doc(storyImagesCollection(uid, storyId));
  const storagePath = `users/${uid}/stories/${storyId}/images/${imageRef.id}`;
  const storageRef = ref(storage, storagePath);
  const uploaded = await uploadBytes(storageRef, imageBlob, {
    contentType: imageBlob.type || 'image/webp',
  });
  let uploadedUrl: string;

  try {
    uploadedUrl = await getDownloadURL(uploaded.ref);
    const sizeBytes = uploaded.metadata.size || imageBlob.size;
    const storyRef = storyDocument(uid, storyId);
    await runTransaction(db, async (transaction) => {
      const storySnapshot = await transaction.get(storyRef);
      if (!storySnapshot.exists()) {
        throw new Error('This story no longer exists.');
      }
      const imageCount = Number(storySnapshot.data().imageCount) || 0;
      if (imageCount >= MAX_STORY_IMAGES) throw new StoryLimitReachedError();
      const storageBytes = Number(storySnapshot.data().storageBytes) || 0;
      transaction.set(imageRef, {
        url: uploadedUrl,
        prompt,
        createdAt: serverTimestamp(),
        sizeBytes,
        storagePath,
        ...(provider ? { provider } : {}),
      });
      transaction.update(storyRef, {
        imageCount: imageCount + 1,
        storageBytes: storageBytes + sizeBytes,
      });
    });

    return {
      id: imageRef.id,
      url: uploadedUrl,
      prompt,
      createdAt: new Date(),
      sizeBytes,
      storagePath,
      ...(provider ? { provider } : {}),
    };
  } catch (error) {
    await deleteObject(storageRef).catch((cleanupError) => {
      console.error('Could not remove an incomplete story image upload:', cleanupError);
    });
    throw error;
  }
}

export async function deleteStoryImage(
  uid: string,
  storyId: string,
  image: StoryImageRecord,
): Promise<void> {
  const db = requireFirestore();
  const storyRef = storyDocument(uid, storyId);
  const imageRef = doc(storyImagesCollection(uid, storyId), image.id);
  const imageData = {
    url: image.url,
    prompt: image.prompt,
    createdAt: image.createdAt,
    sizeBytes: image.sizeBytes,
    storagePath: image.storagePath,
    ...(image.provider ? { provider: image.provider } : {}),
  };

  await runTransaction(db, async (transaction) => {
    const [storySnapshot, imageSnapshot] = await Promise.all([
      transaction.get(storyRef),
      transaction.get(imageRef),
    ]);
    if (!storySnapshot.exists() || !imageSnapshot.exists()) return;
    const story = storySnapshot.data();
    transaction.delete(imageRef);
    transaction.update(storyRef, {
      imageCount: Math.max(0, (Number(story.imageCount) || 0) - 1),
      storageBytes: Math.max(
        0,
        (Number(story.storageBytes) || 0) - image.sizeBytes,
      ),
    });
  });

  if (!image.storagePath) return;
  try {
    const storageRef = ref(requireStorage(), image.storagePath);
    await deleteObject(storageRef);
  } catch (error) {
    // Restore metadata and counters if the file could not be removed.
    await runTransaction(db, async (transaction) => {
      const [storySnapshot, imageSnapshot] = await Promise.all([
        transaction.get(storyRef),
        transaction.get(imageRef),
      ]);
      if (!storySnapshot.exists() || imageSnapshot.exists()) return;
      const story = storySnapshot.data();
      transaction.set(imageRef, imageData);
      transaction.update(storyRef, {
        imageCount: Math.min(
          MAX_STORY_IMAGES,
          (Number(story.imageCount) || 0) + 1,
        ),
        storageBytes: (Number(story.storageBytes) || 0) + image.sizeBytes,
      });
    });
    throw error;
  }
}
