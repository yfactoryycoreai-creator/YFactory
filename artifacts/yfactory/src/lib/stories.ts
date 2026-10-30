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
  imageUrl?: string;
  prompt: string;
  scenePrompt?: string;
  createdAt: unknown;
  sizeBytes: number;
  storagePath: string;
  provider?: string;
  thumbnailUrl?: string;
  publicId?: string;
  folder?: string;
  sequence?: number;
  index?: number;
  status: 'pending' | 'generating' | 'done' | 'failed';
  error?: string;
  legacyGrid: boolean;
  batchId?: string;
  batchTotal?: number;
};

export type SceneGenerationResponse = {
  batchId: string;
  sceneCount: number;
  skippedCount: number;
};

export type StoryZipDownloadToken = {
  downloadUrl: string;
  token: string;
  imageCount: number;
};

export type StoryZipProgress = {
  status: 'ready' | 'zipping' | 'done' | 'failed';
  completedCount: number;
  imageCount: number;
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
  const isLegacyGrid =
    typeof data.status !== 'string' &&
    typeof data.scenePrompt !== 'string' &&
    typeof data.index !== 'number';
  const status: StoryImageRecord['status'] =
    data.status === 'pending' || data.status === 'generating' ||
    data.status === 'done' || data.status === 'failed'
      ? data.status
      : 'done';
  const imageUrl =
    typeof data.imageUrl === 'string'
      ? data.imageUrl
      : typeof data.url === 'string'
        ? data.url
        : '';
  const scenePrompt =
    typeof data.scenePrompt === 'string'
      ? data.scenePrompt
      : typeof data.prompt === 'string'
        ? data.prompt
        : '';
  return {
    id,
    url: imageUrl,
    imageUrl,
    prompt: scenePrompt,
    scenePrompt,
    createdAt: data.createdAt ?? null,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    storagePath: typeof data.storagePath === 'string' ? data.storagePath : '',
    provider: typeof data.provider === 'string' ? data.provider : undefined,
    thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
    publicId: typeof data.publicId === 'string' ? data.publicId : undefined,
    folder: typeof data.folder === 'string' ? data.folder : undefined,
    sequence: typeof data.sequence === 'number' ? data.sequence : undefined,
    index: typeof data.index === 'number' ? data.index : undefined,
    status,
    error: typeof data.error === 'string' ? data.error : undefined,
    legacyGrid: isLegacyGrid,
    batchId: typeof data.batchId === 'string' ? data.batchId : undefined,
    batchTotal: typeof data.batchTotal === 'number' ? data.batchTotal : undefined,
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
  const imagesCollection = storyImagesCollection(uid, storyId);
  const indexedQuery = query(
    imagesCollection,
    orderBy('index', 'asc'),
    limit(MAX_STORY_IMAGES),
  );
  const legacyQuery = query(imagesCollection, limit(MAX_STORY_IMAGES));
  let indexedImages: StoryImageRecord[] = [];
  let legacyImages: StoryImageRecord[] = [];
  const publishImages = () => {
    onImages(
      [...indexedImages, ...legacyImages].sort((left, right) => {
        const leftIndex = left.index ?? left.sequence;
        const rightIndex = right.index ?? right.sequence;
        if (left.legacyGrid !== right.legacyGrid) {
          return left.legacyGrid ? 1 : -1;
        }
        if (leftIndex !== undefined && rightIndex !== undefined) {
          return leftIndex - rightIndex;
        }
        if (leftIndex !== undefined) return -1;
        if (rightIndex !== undefined) return 1;
        return 0;
      }),
    );
  };
  const unsubscribeIndexed = onSnapshot(
    indexedQuery,
    (snapshot) => {
      indexedImages = snapshot.docs.map((item) =>
        normalizeImage(item.id, item.data()),
      );
      publishImages();
    },
    onError,
  );
  const unsubscribeLegacy = onSnapshot(
    legacyQuery,
    (snapshot) => {
      legacyImages = snapshot.docs
        .map((item) => normalizeImage(item.id, item.data()))
        .filter((image) => image.legacyGrid);
      publishImages();
    },
    onError,
  );
  return () => {
    unsubscribeIndexed();
    unsubscribeLegacy();
  };
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
  signal?: AbortSignal,
): Promise<StoryImageRecord> {
  const response = await fetch(`/api/images/stories/${encodeURIComponent(storyId)}/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageData, prompt, provider }),
    signal,
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
    url: String(record.imageUrl ?? record.url ?? ''),
    imageUrl: String(record.imageUrl ?? record.url ?? ''),
    prompt: String(record.prompt ?? prompt),
    scenePrompt: String(record.scenePrompt ?? record.prompt ?? prompt),
    createdAt: record.createdAt ?? new Date(),
    sizeBytes: Number(record.sizeBytes) || 0,
    storagePath: String(record.storagePath ?? ''),
    ...(typeof record.provider === 'string' ? { provider: record.provider } : {}),
    ...(typeof record.thumbnailUrl === 'string' ? { thumbnailUrl: record.thumbnailUrl } : {}),
    ...(typeof record.publicId === 'string' ? { publicId: record.publicId } : {}),
    ...(typeof record.folder === 'string' ? { folder: record.folder } : {}),
    ...(typeof record.sequence === 'number' ? { sequence: record.sequence } : {}),
    ...(typeof record.index === 'number' ? { index: record.index } : {}),
    status: 'done',
    legacyGrid: false,
  };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === 'object' &&
      typeof (payload as Record<string, unknown>).error === 'string') {
    return String((payload as Record<string, unknown>).error);
  }
  return fallback;
}

export async function startStorySceneGeneration(
  storyId: string,
  prompt: string,
  count: number,
  idToken: string,
  signal?: AbortSignal,
): Promise<SceneGenerationResponse> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/scenes`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, count }),
      signal,
    },
  );
  if (response.status === 409) throw new StoryLimitReachedError();
  if (!response.ok) throw new Error(await readApiError(response, 'Scenes could not be started.'));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('The scene response was invalid.');
  const record = payload as Record<string, unknown>;
  if (typeof record.batchId !== 'string' || typeof record.sceneCount !== 'number' ||
      typeof record.skippedCount !== 'number') {
    throw new Error('The scene response was invalid.');
  }
  return {
    batchId: record.batchId,
    sceneCount: record.sceneCount,
    skippedCount: record.skippedCount,
  };
}

export async function resumeStorySceneGeneration(
  storyId: string,
  idToken: string,
  signal?: AbortSignal,
): Promise<number> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/scenes/resume`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      signal,
    },
  );
  if (!response.ok) throw new Error(await readApiError(response, 'Pending scenes could not be resumed.'));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' ||
      typeof (payload as Record<string, unknown>).resumedCount !== 'number') {
    throw new Error('The resume response was invalid.');
  }
  return (payload as Record<string, number>).resumedCount;
}

export async function retryStoryScene(
  storyId: string,
  imageId: string,
  idToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/images/${encodeURIComponent(imageId)}/retry`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      signal,
    },
  );
  if (!response.ok) throw new Error(await readApiError(response, 'This scene could not be retried.'));
}

export async function createStoryZipDownloadToken(
  storyId: string,
  idToken: string,
  signal?: AbortSignal,
): Promise<StoryZipDownloadToken> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/download-token`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      signal,
    },
  );
  if (!response.ok) throw new Error(await readApiError(response, 'The story ZIP could not be prepared.'));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('The ZIP response was invalid.');
  const record = payload as Record<string, unknown>;
  if (typeof record.downloadUrl !== 'string' || typeof record.token !== 'string' ||
      typeof record.imageCount !== 'number') {
    throw new Error('The ZIP response was invalid.');
  }
  return {
    downloadUrl: record.downloadUrl,
    token: record.token,
    imageCount: record.imageCount,
  };
}

export async function getStoryZipDownloadProgress(
  storyId: string,
  token: string,
  idToken: string,
  signal?: AbortSignal,
): Promise<StoryZipProgress> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/download-status?token=${encodeURIComponent(token)}`,
    { headers: { Authorization: `Bearer ${idToken}` }, signal },
  );
  if (!response.ok) throw new Error(await readApiError(response, 'ZIP progress could not be loaded.'));
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('The ZIP progress response was invalid.');
  const record = payload as Record<string, unknown>;
  const status = record.status;
  if (
      (status !== 'ready' && status !== 'zipping' &&
        status !== 'done' && status !== 'failed') ||
      typeof record.completedCount !== 'number' ||
      typeof record.imageCount !== 'number') {
    throw new Error('The ZIP progress response was invalid.');
  }
  return {
    status,
    completedCount: record.completedCount,
    imageCount: record.imageCount,
  };
}

export async function deleteStoryImage(
  uid: string,
  storyId: string,
  image: StoryImageRecord,
  idToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/images/stories/${encodeURIComponent(storyId)}/images/${encodeURIComponent(image.id)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` }, signal },
  );
  if (!response.ok) throw new Error('The image could not be deleted.');
}
