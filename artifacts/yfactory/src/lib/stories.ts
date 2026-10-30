import {
  collection,
  documentId,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

export const MAX_STORY_IMAGES = 100;
export const STORY_PAGE_SIZE = 50;

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
  provider?: string;
  thumbnailUrl?: string;
  publicId?: string;
  folder?: string;
  sequence?: number;
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
    provider: typeof data.provider === 'string' ? data.provider : undefined,
    thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
    publicId: typeof data.publicId === 'string' ? data.publicId : undefined,
    folder: typeof data.folder === 'string' ? data.folder : undefined,
    sequence: typeof data.sequence === 'number' ? data.sequence : undefined,
  };
}

export function subscribeToStories(
  uid: string,
  onStories: (stories: StoryRecord[]) => void,
  onHasMore: (hasMore: boolean) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const storiesQuery = query(
    userStoriesCollection(uid),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(STORY_PAGE_SIZE + 1),
  );
  return onSnapshot(
    storiesQuery,
    (snapshot) => {
      onStories(
        snapshot.docs
          .slice(0, STORY_PAGE_SIZE)
          .map((item) => normalizeStory(item.id, item.data())),
      );
      onHasMore(snapshot.docs.length > STORY_PAGE_SIZE);
    },
    onError,
  );
}

export async function fetchOlderStories(
  uid: string,
  cursor: StoryRecord,
): Promise<{ stories: StoryRecord[]; hasMore: boolean }> {
  const nextPageQuery = query(
    userStoriesCollection(uid),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    startAfter(cursor.createdAt, cursor.id),
    limit(STORY_PAGE_SIZE + 1),
  );
  const snapshot = await getDocs(nextPageQuery);
  return {
    stories: snapshot.docs
      .slice(0, STORY_PAGE_SIZE)
      .map((item) => normalizeStory(item.id, item.data())),
    hasMore: snapshot.docs.length > STORY_PAGE_SIZE,
  };
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
    limit(MAX_STORY_IMAGES),
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
  imageData: string,
  prompt: string,
  idToken: string,
  provider?: string,
): Promise<StoryImageRecord> {
  const response = await fetch(`/api/images/stories/${encodeURIComponent(storyId)}/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageData, prompt, provider }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') {
    const message = payload && typeof payload === 'object' &&
      typeof (payload as Record<string, unknown>).error === 'string'
      ? String((payload as Record<string, unknown>).error)
      : 'The image could not be saved.';
    throw new Error(message);
  }
  const record = payload as Record<string, unknown>;
  return {
    id: String(record.id ?? ''),
    url: String(record.url ?? ''),
    prompt: String(record.prompt ?? prompt),
    createdAt: record.createdAt ?? new Date(),
    sizeBytes: Number(record.sizeBytes) || 0,
    storagePath: String(record.storagePath ?? ''),
    ...(typeof record.provider === 'string' ? { provider: record.provider } : {}),
    ...(typeof record.thumbnailUrl === 'string' ? { thumbnailUrl: record.thumbnailUrl } : {}),
    ...(typeof record.publicId === 'string' ? { publicId: record.publicId } : {}),
    ...(typeof record.folder === 'string' ? { folder: record.folder } : {}),
    ...(typeof record.sequence === 'number' ? { sequence: record.sequence } : {}),
  };
}

export async function deleteStoryImage(
  uid: string,
  storyId: string,
  image: StoryImageRecord,
  idToken: string,
): Promise<void> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/images/${encodeURIComponent(image.id)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!response.ok) throw new Error('The image could not be deleted.');
}
