import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Plus,
  Pencil,
  Save,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import StoryImageLightbox from '@/components/story-image-lightbox';
import StorySceneText from '@/components/story-scene-text';
import StorySettingsPanel from '@/components/story-settings-panel';
import {
  createStory,
  createStoryZipDownloadToken,
  deleteStory,
  deleteStoryImage,
  fetchOlderStories,
  getStoryZipDownloadProgress,
  MAX_STORY_IMAGES,
  resumeStorySceneGeneration,
  retryStoryScene,
  renameStory,
  STORY_PAGE_SIZE,
  saveImageToStory,
  StoryLimitReachedError,
  StorySceneStartError,
  startStorySceneGeneration,
  subscribeToStories,
  subscribeToStoryImages,
  updateStoryTargetCount,
  updateStoryScript,
  type StoryImageRecord,
  type StoryRecord,
} from '@/lib/stories';
import type { GeneratedImageHistoryItem } from '@/lib/generationStorage';
import { useToast } from '@/hooks/use-toast';

type StoryFactoryProps = {
  uid: string;
  getIdToken: () => Promise<string>;
  visible: boolean;
  selectedStoryId: string | null;
  pendingImage: GeneratedImageHistoryItem | null;
  onStorySelected: (story: StoryRecord | null) => void;
  onTemporaryImageSaved: (
    image: GeneratedImageHistoryItem,
    story: StoryRecord,
    savedImage: StoryImageRecord,
  ) => void;
  onCancelPendingSave: () => void;
};

const STORAGE_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;
const STORY_TARGET_PRESETS = [5, 10, 25, 50, 100];

function imageSequenceLabel(image: StoryImageRecord, index: number): string {
  const publicIdTail = image.publicId?.split('/').at(-1);
  const sequence = image.index ?? image.sequence ??
    (publicIdTail && /^\d+$/.test(publicIdTail) ? Number(publicIdTail) : index + 1);
  return String(sequence).padStart(3, '0');
}

async function fetchAsWebp(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('This image could not be downloaded.');
  const original = await response.blob();
  try {
    const bitmap = await createImageBitmap(original);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable.');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed.')),
        'image/webp',
        0.9,
      );
    });
  } catch {
    return original;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function supportsZipFileShare(): boolean {
  if (
    typeof File === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function'
  ) return false;
  try {
    return navigator.canShare({
      files: [new File([], 'story.zip', { type: 'application/zip' })],
    });
  } catch {
    return false;
  }
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      resolve();
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatStoryDate(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : value &&
          typeof value === 'object' &&
          'toDate' in value &&
          typeof value.toDate === 'function'
        ? (value.toDate as () => Date)()
        : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

const sceneFailureCodes = new Set([
  'planning_failed',
  'missing_key',
  'rate_limited',
  'auth_failed',
  'timeout',
  'bad_prompt',
  'bad_script',
  'validation_failed',
  'save_failed',
  'provider_switch_pending',
]);

function sceneFailureKey(error: string | undefined): string {
  return error && sceneFailureCodes.has(error) ? error : 'unknown';
}

function StoryFactory({
  uid,
  getIdToken,
  visible,
  selectedStoryId,
  pendingImage,
  onStorySelected,
  onTemporaryImageSaved,
  onCancelPendingSave,
}: StoryFactoryProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [hasMoreStories, setHasMoreStories] = useState(false);
  const [storiesLoadingMore, setStoriesLoadingMore] = useState(false);
  const [images, setImages] = useState<StoryImageRecord[]>([]);
  const [visibleImageCount, setVisibleImageCount] = useState(24);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [storyName, setStoryName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingStoryNameId, setEditingStoryNameId] = useState<string | null>(null);
  const [storyNameDraft, setStoryNameDraft] = useState('');
  const [renamingStoryId, setRenamingStoryId] = useState<string | null>(null);
  const deleteStoryDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const storyToDeleteRef = useRef<StoryRecord | null>(null);
  const [script, setScript] = useState('');
  const [scriptSaving, setScriptSaving] = useState(false);
  const scriptSavePromise = useRef<Promise<boolean> | null>(null);
  const [targetCount, setTargetCount] = useState(10);
  const [targetCountInput, setTargetCountInput] = useState('10');
  const [targetCountSaving, setTargetCountSaving] = useState(false);
  const [targetCountDirty, setTargetCountDirty] = useState(false);
  const targetCountRef = useRef(10);
  const savedTargetCountRef = useRef(10);
  const targetCountStoryIdRef = useRef<string | null>(null);
  const targetCountDirtyRef = useRef(false);
  const targetCountSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const targetCountSavePending = useRef(0);
  const [savingImageForStory, setSavingImageForStory] = useState<string | null>(
    null,
  );
  const deleteImageDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const imageToDeleteRef = useRef<StoryImageRecord | null>(null);
  const [generatingStoryImages, setGeneratingStoryImages] = useState(false);
  const [imageAction, setImageAction] = useState<string | null>(null);
  const [lightboxImageId, setLightboxImageId] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ completed: number; total: number } | null>(null);
  const [resumingScenes, setResumingScenes] = useState(false);
  const [retryingSceneId, setRetryingSceneId] = useState<string | null>(null);
  const activeControllers = useRef(new Set<AbortController>());
  const autoResumedStory = useRef<string | null>(null);
  const selectedStory = useMemo(
    () => stories.find((story) => story.id === selectedStoryId) ?? null,
    [stories, selectedStoryId],
  );
  useEffect(() => {
    if (!selectedStory) return;
    const count = selectedStory.targetCount;
    targetCountStoryIdRef.current = selectedStory.id;
    targetCountRef.current = count;
    savedTargetCountRef.current = count;
    setTargetCount(count);
    setTargetCountInput(String(count));
    setTargetCountDirty(false);
    targetCountDirtyRef.current = false;
  }, [selectedStory?.id]);
  useEffect(() => {
    if (!selectedStory || targetCountDirtyRef.current) return;
    const count = selectedStory.targetCount;
    if (count === savedTargetCountRef.current) return;
    targetCountRef.current = count;
    savedTargetCountRef.current = count;
    setTargetCount(count);
    setTargetCountInput(String(count));
    targetCountDirtyRef.current = false;
    setTargetCountDirty(false);
  }, [selectedStory?.targetCount, selectedStory?.id]);
  useEffect(() => {
    setLightboxImageId(null);
    setVisibleImageCount(24);
  }, [selectedStoryId]);
  const previewImages = images.filter(
    (image) => image.status === 'done' && Boolean(image.url),
  );
  const lightboxIndex = previewImages.findIndex((image) => image.id === lightboxImageId);
  const totalStorageBytes = stories.reduce(
    (total, story) => total + story.storageBytes,
    0,
  );
  const storagePercent = Math.min(
    100,
    (totalStorageBytes / STORAGE_QUOTA_BYTES) * 100,
  );
  const resumableScenes = !selectedStory?.providerSwitchPending && images.some(
    (image) => image.status === 'pending' || image.status === 'generating',
  );
  const latestBatch = images.reduce<StoryImageRecord | null>((latest, image) => {
    if (!image.batchId) return latest;
    if (!latest || (image.index ?? 0) > (latest.index ?? 0)) return image;
    return latest;
  }, null);
  const latestBatchImages = latestBatch
    ? images.filter((image) => image.batchId === latestBatch.batchId)
    : [];
  const latestBatchDone = latestBatchImages.filter((image) => image.status === 'done').length;
  const latestBatchTotal = latestBatch?.batchTotal ?? latestBatchImages.length;
  const downloadableImageCount = images.filter(
    (image) => image.status === 'done' && !image.legacyGrid,
  ).length;
  const visibleImages = images.slice(0, visibleImageCount);

  const makeController = () => {
    const controller = new AbortController();
    activeControllers.current.add(controller);
    return controller;
  };

  const releaseController = (controller: AbortController) => {
    activeControllers.current.delete(controller);
  };

  useEffect(
    () => () => {
      activeControllers.current.forEach((controller) => controller.abort());
      activeControllers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!visible) return;
    setStoriesLoading(true);
    setError('');
    return subscribeToStories(
      uid,
      (nextStories) => {
        const nextIds = new Set(nextStories.map((story) => story.id));
        setStories((current) => [
          ...nextStories,
          ...current.filter((story) => !nextIds.has(story.id)),
        ]);
        setStoriesLoading(false);
      },
      setHasMoreStories,
      () => {
        setError(t('stories.loadFailed'));
        setStoriesLoading(false);
      },
    );
  }, [uid, t, visible]);

  const handleLoadOlderStories = async () => {
    const cursor = stories[stories.length - 1];
    if (!cursor || storiesLoadingMore || !hasMoreStories) return;
    setStoriesLoadingMore(true);
    setError('');
    try {
      const page = await fetchOlderStories(uid, cursor);
      setStories((current) => {
        const currentIds = new Set(current.map((story) => story.id));
        return [
          ...current,
          ...page.stories.filter((story) => !currentIds.has(story.id)),
        ];
      });
      setHasMoreStories(page.hasMore);
    } catch {
      setError(t('stories.loadFailed'));
    } finally {
      setStoriesLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!visible || !selectedStoryId) {
      setImages([]);
      setImagesLoading(false);
      return;
    }
    setImagesLoading(true);
    setError('');
    return subscribeToStoryImages(
      uid,
      selectedStoryId,
      (nextImages) => {
        setImages(nextImages);
        setImagesLoading(false);
      },
      () => {
        setError(t('stories.imagesLoadFailed'));
        setImagesLoading(false);
      },
    );
  }, [uid, selectedStoryId, t, visible]);

  useEffect(() => {
    if (!visible || !selectedStoryId) {
      autoResumedStory.current = null;
      return;
    }
    if (imagesLoading || !resumableScenes ||
        autoResumedStory.current === selectedStoryId) return;
    autoResumedStory.current = selectedStoryId;
    const controller = makeController();
    const resume = async () => {
      try {
        await resumeStorySceneGeneration(
          selectedStoryId,
          await getIdToken(),
          controller.signal,
        );
      } catch {
        if (!controller.signal.aborted) setError(t('stories.resumeFailed'));
      } finally {
        releaseController(controller);
      }
    };
    void resume();
  }, [getIdToken, imagesLoading, images, resumableScenes, selectedStoryId, t, visible]);

  useEffect(() => {
    if (selectedStory) {
      onStorySelected(selectedStory);
    }
  }, [selectedStory, onStorySelected]);

  useEffect(() => {
    if (selectedStory) setScript(selectedStory.script);
  }, [selectedStory?.id, selectedStory?.script]);

  const handleCreateStory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = storyName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError('');
    try {
      const id = await createStory(uid, name);
      setStoryName('');
      setCreateDialogOpen(false);
      onStorySelected({
        id,
        storyName: name,
        script: '',
        createdAt: new Date(),
        imageCount: 0,
        storageBytes: 0,
        targetCount: 10,
        aspectRatio: '1:1',
        characterTraits: [],
        keepOneProvider: false,
        providerSwitchPending: false,
      });
    } catch {
      setError(t('stories.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleSaveScript = (): Promise<boolean> => {
    if (!selectedStory || script === selectedStory.script) {
      return Promise.resolve(true);
    }
    if (scriptSavePromise.current) return scriptSavePromise.current;
    setScriptSaving(true);
    setError('');
    const storyId = selectedStory.id;
    const scriptToSave = script;
    const savePromise = updateStoryScript(uid, storyId, scriptToSave)
      .then(() => true)
      .catch(() => {
        setError(t('stories.scriptSaveFailed'));
        return false;
      })
      .finally(() => {
        setScriptSaving(false);
        scriptSavePromise.current = null;
      });
    scriptSavePromise.current = savePromise;
    return savePromise;
  };

  const beginRenameStory = (story: StoryRecord) => {
    setEditingStoryNameId(story.id);
    setStoryNameDraft(story.storyName);
    setError('');
    setNotice('');
  };

  const handleRenameStory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const storyId = editingStoryNameId;
    const name = storyNameDraft.trim();
    if (!storyId || !name || name.length > 80 || renamingStoryId) return;
    setRenamingStoryId(storyId);
    setError('');
    try {
      const savedName = await renameStory(storyId, name, await getIdToken());
      setStories((current) => current.map((story) =>
        story.id === storyId ? { ...story, storyName: savedName } : story,
      ));
      setEditingStoryNameId(null);
      setStoryNameDraft('');
    } catch {
      setError(t('stories.renameStoryFailed'));
    } finally {
      setRenamingStoryId(null);
    }
  };

  const requestDeleteStory = (story: StoryRecord) => {
    storyToDeleteRef.current = story;
    deleteStoryDialogRef.current?.open(
      t('stories.deleteStoryWarning', {
        name: story.storyName,
        count: story.imageCount,
      }),
    );
  };

  const handleDeleteStory = async () => {
    const story = storyToDeleteRef.current;
    if (!story) return;
    const result = await deleteStory(story.id, await getIdToken());
    setStories((current) => current.filter((item) => item.id !== story.id));
    if (selectedStoryId === story.id) onStorySelected(null);
    if (editingStoryNameId === story.id) setEditingStoryNameId(null);
    storyToDeleteRef.current = null;
    setError('');
    setNotice(result.cleanupPending
      ? t('stories.storyDeleteCleanupWarning', { count: result.cleanupPending })
      : t('stories.storyDeleted'));
  };

  const handleSaveTemporaryImage = async (story: StoryRecord) => {
    if (!pendingImage || savingImageForStory) return;
    if (story.imageCount >= MAX_STORY_IMAGES) {
      setError(t('stories.limitReached'));
      return;
    }
    setSavingImageForStory(story.id);
    setError('');
    const controller = makeController();
    try {
      const saved = await saveImageToStory(
        uid,
        story.id,
        pendingImage.imageData,
        pendingImage.prompt,
        await getIdToken(),
        pendingImage.provider,
        controller.signal,
      );
      onTemporaryImageSaved(pendingImage, story, saved);
    } catch (saveError) {
      setError(
        saveError instanceof Error &&
          saveError.message ===
            'Story limit reached (100 images). Start a new story.'
          ? t('stories.limitReached')
          : t('stories.imageSaveFailed'),
      );
    } finally {
      setSavingImageForStory(null);
      releaseController(controller);
    }
  };

  const handleDeleteImage = async () => {
    const image = imageToDeleteRef.current;
    if (!selectedStory || !image) return;
    const controller = makeController();
    try {
      await deleteStoryImage(
        uid,
        selectedStory.id,
        image,
        await getIdToken(),
        controller.signal,
      );
      imageToDeleteRef.current = null;
    } catch {
      throw new Error(t('stories.imageDeleteFailed'));
    } finally {
      releaseController(controller);
    }
  };

  const requestDeleteImage = (image: StoryImageRecord) => {
    imageToDeleteRef.current = image;
    deleteImageDialogRef.current?.open();
  };

  const handleTargetCountChange = (value: number) => {
    const count = Math.max(1, Math.min(MAX_STORY_IMAGES, Math.round(value)));
    targetCountRef.current = count;
    setTargetCount(count);
    setTargetCountInput(String(count));
    const dirty = count !== savedTargetCountRef.current;
    targetCountDirtyRef.current = dirty;
    setTargetCountDirty(dirty);
    setError('');
  };

  const saveTargetCountValue = async (
    storyId: string,
    count: number,
  ): Promise<boolean> => {
    if (!Number.isInteger(count) || count < 1 || count > MAX_STORY_IMAGES) return false;
    const save = targetCountSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (
          targetCountStoryIdRef.current === storyId &&
          savedTargetCountRef.current === count
        ) return;
        await updateStoryTargetCount(storyId, count, await getIdToken());
        if (targetCountStoryIdRef.current === storyId) {
          savedTargetCountRef.current = count;
        }
      });
    targetCountSaveQueue.current = save;
    targetCountSavePending.current += 1;
    setTargetCountSaving(true);
    try {
      await save;
      if (targetCountStoryIdRef.current === storyId && targetCountRef.current === count) {
        targetCountDirtyRef.current = false;
        setTargetCountDirty(false);
        setError('');
      }
      return true;
    } catch {
      if (targetCountStoryIdRef.current === storyId && targetCountRef.current === count) {
        const saved = savedTargetCountRef.current;
        targetCountRef.current = saved;
        setTargetCount(saved);
        setTargetCountInput(String(saved));
        targetCountDirtyRef.current = false;
        setTargetCountDirty(false);
        setError(t('stories.targetCountSaveFailed'));
      }
      return false;
    } finally {
      targetCountSavePending.current = Math.max(0, targetCountSavePending.current - 1);
      setTargetCountSaving(targetCountSavePending.current > 0);
    }
  };

  const handleGenerateStoryImages = async () => {
    if (!selectedStory || generatingStoryImages) return;
    const prompt = script.trim();
    if (!prompt) {
      setError(t('stories.promptRequired'));
      return;
    }
    if (selectedStory.imageCount >= MAX_STORY_IMAGES) {
      setError(t('stories.limitReached'));
      return;
    }
    setGeneratingStoryImages(true);
    setError('');
    const controller = makeController();
    try {
      if (!(await handleSaveScript())) return;
      const count = targetCountRef.current;
      if (!(await saveTargetCountValue(selectedStory.id, count))) return;
      const result = await startStorySceneGeneration(
        selectedStory.id,
        prompt,
        count,
        await getIdToken(),
        controller.signal,
      );
      if (result.skippedCount > 0) {
        setError(t('stories.sceneLimitPartial', { count: result.sceneCount }));
      }
    } catch (generationError) {
      if (controller.signal.aborted) return;
      if (generationError instanceof StoryLimitReachedError) {
        setError(t('stories.limitReached'));
      } else {
        const code = generationError instanceof StorySceneStartError
          ? generationError.code
          : 'save_failed';
        setError(t(`stories.sceneStartError.${code}`));
      }
    } finally {
      setGeneratingStoryImages(false);
      releaseController(controller);
    }
  };

  const handleResumeScenes = async () => {
    if (!selectedStory || resumingScenes) return;
    setResumingScenes(true);
    setError('');
    const controller = makeController();
    try {
      await resumeStorySceneGeneration(
        selectedStory.id,
        await getIdToken(),
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) setError(t('stories.resumeFailed'));
    } finally {
      setResumingScenes(false);
      releaseController(controller);
    }
  };

  const handleRetryScene = async (image: StoryImageRecord) => {
    if (!selectedStory || image.status !== 'failed' || retryingSceneId) return;
    setRetryingSceneId(image.id);
    setError('');
    const controller = makeController();
    try {
      await retryStoryScene(
        selectedStory.id,
        image.id,
        await getIdToken(),
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) setError(t('stories.retryFailed'));
    } finally {
      setRetryingSceneId(null);
      releaseController(controller);
    }
  };

  const handleImageDownload = async (
    image: StoryImageRecord,
    index: number,
    share: boolean,
  ) => {
    if (!selectedStory || imageAction) return;
    setImageAction(image.id);
    setError('');
    const controller = makeController();
    const filename = `${selectedStory.storyName.replace(/[\\/:*?"<>|]/g, '_')}_${imageSequenceLabel(image, index)}.webp`;
    try {
      const blob = await fetchAsWebp(image.url, controller.signal);
      const file = new File([blob], filename, { type: 'image/webp' });
      if (
        share &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: selectedStory.storyName });
      } else {
        downloadBlob(blob, filename);
      }
    } catch (downloadError) {
      if (!controller.signal.aborted &&
          !(downloadError instanceof DOMException && downloadError.name === 'AbortError')) {
        setError(t('stories.imageDownloadFailed'));
      }
    } finally {
      setImageAction(null);
      releaseController(controller);
    }
  };

  const handleDownloadStoryZip = async () => {
    if (!selectedStory || downloadingZip) return;
    setDownloadingZip(true);
    setError('');
    setZipProgress({ completed: 0, total: 0 });
    const isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const shareFallbackAvailable = supportsZipFileShare() && !isMobileBrowser;
    const downloadWindow = shareFallbackAvailable ? null : window.open('about:blank', '_blank');
    const controller = makeController();
    try {
      const download = await createStoryZipDownloadToken(
        selectedStory.id,
        await getIdToken(),
        controller.signal,
      );
      setZipProgress({ completed: 0, total: download.imageCount });
      const destination = new URL(download.downloadUrl, window.location.href).toString();
      if (downloadWindow) downloadWindow.location.assign(destination);
      else if (shareFallbackAvailable) {
        const response = await fetch(destination, { signal: controller.signal });
        if (!response.ok) throw new Error('zip_failed');
        const blob = await response.blob();
        const filename = `${selectedStory.storyName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 70) || 'story'}.zip`;
        const file = new File([blob], filename, { type: 'application/zip' });
        try {
          await navigator.share({ files: [file], title: selectedStory.storyName });
        } catch (shareError) {
          if (!(shareError instanceof DOMException && shareError.name === 'AbortError')) {
            downloadBlob(blob, filename);
          }
        }
      } else window.location.assign(destination);

      const startedAt = Date.now();
      let isComplete = false;
      while (!controller.signal.aborted && Date.now() - startedAt < 5 * 60_000) {
        await waitForDelay(900, controller.signal);
        if (controller.signal.aborted) break;
        const progress = await getStoryZipDownloadProgress(
          selectedStory.id,
          download.token,
          await getIdToken(),
          controller.signal,
        );
        setZipProgress({
          completed: progress.completedCount,
          total: progress.imageCount || download.imageCount,
        });
        if (progress.status === 'done') {
          isComplete = true;
          break;
        }
        if (progress.status === 'failed') throw new Error('zip_failed');
      }
      if (!isComplete && !controller.signal.aborted) throw new Error('zip_timeout');
    } catch {
      if (!controller.signal.aborted) {
        setError(t('stories.zipFailed'));
        toast({ title: t('stories.zipFailed'), variant: 'destructive' });
        if (downloadWindow && !downloadWindow.closed) downloadWindow.close();
      }
    } finally {
      setDownloadingZip(false);
      releaseController(controller);
    }
  };

  return (
    <section
      className="story-factory"
      hidden={!visible}
      aria-label={t('stories.title')}
      data-testid="story-factory"
    >
      <div className="factory-heading">
        <div className="factory-title">
          {selectedStory ? (
            <button
              className="factory-back"
              type="button"
              aria-label={t('stories.backToStories')}
              onClick={() => onStorySelected(null)}
            >
              <ArrowLeft size={18} />
            </button>
          ) : (
            <span className="factory-icon"><BookOpen size={19} /></span>
          )}
          {selectedStory ? (
            editingStoryNameId === selectedStory.id ? (
              <form className="story-name-edit-form story-name-edit-heading" onSubmit={(event) => void handleRenameStory(event)}>
                <label className="sr-only" htmlFor="story-name-heading-input">{t('stories.storyName')}</label>
                <input
                  id="story-name-heading-input"
                  autoFocus
                  value={storyNameDraft}
                  maxLength={80}
                  onChange={(event) => setStoryNameDraft(event.currentTarget.value)}
                  aria-label={t('stories.storyName')}
                />
                <button className="story-icon-button" type="submit" disabled={!storyNameDraft.trim() || Boolean(renamingStoryId)} aria-label={t('stories.saveStoryName')}>
                  {renamingStoryId === selectedStory.id ? <LoaderCircle className="loading-spinner" size={15} /> : <Check size={15} />}
                </button>
                <button className="story-icon-button" type="button" disabled={Boolean(renamingStoryId)} aria-label={t('stories.cancel')} onClick={() => setEditingStoryNameId(null)}>
                  <X size={15} />
                </button>
              </form>
            ) : (
              <div className="factory-story-title">
                <div>
                  <h1>{selectedStory.storyName}</h1>
                  <p>{t('stories.workspaceSubtitle')}</p>
                </div>
              </div>
            )
          ) : (
            <div>
              <h1>{t('stories.title')}</h1>
              <p>{t('stories.subtitle')}</p>
            </div>
          )}
        </div>
        <div className="factory-storage" data-testid="storage-usage">
          <div className="factory-storage-copy">
            <span>{t('stories.storageUsage')}</span>
            <strong className="storage-estimate-value" dir="ltr">
              {t('stories.storageValue', {
                used: formatBytes(totalStorageBytes),
                quota: '20 GB',
              })}
            </strong>
          </div>
          <div
            className="factory-storage-track"
            role="progressbar"
            aria-label={t('stories.storageUsage')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(storagePercent)}
          >
            <span style={{ width: `${storagePercent}%` }} />
          </div>
          <small>{t('stories.storageEstimate')}</small>
        </div>
      </div>

      {error && (
        <div className="factory-error" role="alert" data-testid="story-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="factory-warning" role="status" data-testid="story-notice">
          {notice}
        </div>
      )}

      {selectedStory ? (
        <div className="story-workspace">
          <div className="story-workspace-toolbar">
            <div className="story-target-control" data-testid="story-target-control">
              <div className="story-target-heading">
                <label htmlFor="story-target-count">{t('stories.imageCountLabel')}</label>
                <span>{t('stories.maximumImages')}</span>
              </div>
              <div className="story-target-inputs">
                <button
                  className="story-step-button"
                  type="button"
                  aria-label={t('stories.decreaseImageCount')}
                  disabled={targetCount <= 1 || targetCountSaving}
                  onClick={() => {
                    const nextCount = Math.max(1, targetCount - 1);
                    handleTargetCountChange(nextCount);
                    void saveTargetCountValue(selectedStory.id, nextCount);
                  }}
                >
                  <Minus size={17} aria-hidden="true" />
                </button>
                <input
                  id="story-target-count"
                  className="story-target-number"
                  type="number"
                  min={1}
                  max={MAX_STORY_IMAGES}
                  step={1}
                  value={targetCountInput}
                  onChange={(event) => {
                    const rawValue = event.currentTarget.value;
                    setTargetCountInput(rawValue);
                    const value = Number(rawValue);
                    if (
                      rawValue !== '' &&
                      Number.isInteger(value) &&
                      value >= 1 &&
                      value <= MAX_STORY_IMAGES
                    ) handleTargetCountChange(value);
                  }}
                  onBlur={() => {
                    if (!selectedStory) return;
                    const value = Number(targetCountInput);
                    const count = Number.isInteger(value) && value >= 1 && value <= MAX_STORY_IMAGES
                      ? value
                      : targetCountRef.current;
                    handleTargetCountChange(count);
                    void saveTargetCountValue(selectedStory.id, count);
                  }}
                  aria-label={t('stories.imageCountLabel')}
                  data-testid="input-story-target-count"
                />
                <button
                  className="story-step-button"
                  type="button"
                  aria-label={t('stories.increaseImageCount')}
                  disabled={targetCount >= MAX_STORY_IMAGES || targetCountSaving}
                  onClick={() => {
                    const nextCount = Math.min(MAX_STORY_IMAGES, targetCount + 1);
                    handleTargetCountChange(nextCount);
                    void saveTargetCountValue(selectedStory.id, nextCount);
                  }}
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
                <input
                  className="story-target-slider"
                  type="range"
                  min={1}
                  max={MAX_STORY_IMAGES}
                  step={1}
                  value={targetCount}
                  onChange={(event) => handleTargetCountChange(Number(event.currentTarget.value))}
                  onPointerUp={() => {
                    if (selectedStory) {
                      void saveTargetCountValue(selectedStory.id, targetCountRef.current);
                    }
                  }}
                  onKeyUp={() => {
                    if (selectedStory) {
                      void saveTargetCountValue(selectedStory.id, targetCountRef.current);
                    }
                  }}
                  aria-label={t('stories.imageCountLabel')}
                  data-testid="input-story-target-slider"
                />
              </div>
              <div className="story-target-presets" aria-label={t('stories.imageCountPresets')}>
                {STORY_TARGET_PRESETS.map((count) => (
                  <button
                    className={targetCount === count ? 'story-target-preset is-active' : 'story-target-preset'}
                    type="button"
                    key={count}
                    onClick={() => {
                      handleTargetCountChange(count);
                      if (selectedStory) void saveTargetCountValue(selectedStory.id, count);
                    }}
                    aria-pressed={targetCount === count}
                    data-testid={`button-target-count-${count}`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <small role="status" aria-live="polite" data-testid="status-story-target-count">
                {targetCountSaving
                  ? t('stories.savingTargetCount')
                  : targetCountDirty
                    ? t('stories.unsavedTargetCount')
                    : t('stories.maximumImages')}
              </small>
            </div>
            <div className="story-image-meter">
              <span>
                {t('stories.imageCounter', {
                  count: selectedStory.imageCount,
                  max: targetCount,
                })}
              </span>
              {latestBatch && (
                <small className="story-generation-progress" role="status" aria-live="polite">
                  {t('stories.generationProgress', {
                    done: latestBatchDone,
                    total: latestBatchTotal,
                  })}
                </small>
              )}
              <div className="story-image-progress">
                <span
                  style={{
                    width: `${Math.min(100, (selectedStory.imageCount / targetCount) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <button
              className="factory-primary-button"
              type="button"
              onClick={() => void handleGenerateStoryImages()}
              disabled={!script.trim() || selectedStory.imageCount >= MAX_STORY_IMAGES || generatingStoryImages}
              aria-busy={generatingStoryImages}
              data-testid="button-generate-story-scenes"
            >
              {generatingStoryImages ? <LoaderCircle className="loading-spinner" size={16} /> : <ImageIcon size={16} />}
              {generatingStoryImages ? t('stories.startingGeneration') : t('stories.generateScenes')}
            </button>
          </div>

          <div className="story-secondary-actions">
            <button
              className="story-secondary-action"
              type="button"
              onClick={() => void handleDownloadStoryZip()}
              disabled={!downloadableImageCount || downloadingZip}
              aria-busy={downloadingZip}
              data-testid="button-download-story-zip"
            >
              {downloadingZip ? <LoaderCircle className="loading-spinner" size={17} /> : <Download size={17} />}
              <span>{downloadingZip
                ? t('stories.zipProgress', {
                    done: zipProgress?.completed ?? 0,
                    total: zipProgress?.total ?? downloadableImageCount,
                  })
                : zipProgress && zipProgress.total > 0 &&
                    zipProgress.completed >= zipProgress.total
                  ? t('stories.zipDone')
                  : t('stories.downloadZip')}</span>
            </button>
            <button
              className="story-secondary-action"
              type="button"
              onClick={() => beginRenameStory(selectedStory)}
            >
              <Pencil size={17} />
              <span>{t('stories.renameStory')}</span>
            </button>
            <button
              className="story-secondary-action story-secondary-delete"
              type="button"
              onClick={() => requestDeleteStory(selectedStory)}
            >
              <Trash2 size={17} />
              <span>{t('stories.deleteStory')}</span>
            </button>
            {resumableScenes && (
              <button
                className="story-secondary-action"
                type="button"
                onClick={() => void handleResumeScenes()}
                disabled={resumingScenes}
                aria-busy={resumingScenes}
                data-testid="button-resume-story-scenes"
              >
                {resumingScenes && <LoaderCircle className="loading-spinner" size={17} />}
                <span>{resumingScenes ? t('stories.resumingScenes') : t('stories.resumeScenes')}</span>
              </button>
            )}
          </div>

          {selectedStory.imageCount > targetCount && (
            <div className="factory-warning" role="status" data-testid="status-story-target-lowered">
              {t('stories.targetBelowFinished', { count: selectedStory.imageCount })}
            </div>
          )}

          {selectedStory.imageCount >= MAX_STORY_IMAGES && (
            <div className="factory-warning" role="status">
              {t('stories.limitReached')}
            </div>
          )}
          {pendingImage && (
            <div className="factory-pending-image" data-testid="pending-image-save">
              <img src={pendingImage.imageData} alt={t('labels.generatedImage')} loading="lazy" />
              <div>
                <strong>{t('stories.saveTemporaryTitle')}</strong>
                <span>{t('stories.saveTemporaryDescription')}</span>
              </div>
              <button
                className="factory-save-button"
                type="button"
                disabled={
                  Boolean(savingImageForStory) ||
                  selectedStory.imageCount >= MAX_STORY_IMAGES
                }
                onClick={() => void handleSaveTemporaryImage(selectedStory)}
              >
                {savingImageForStory === selectedStory.id ? (
                  <LoaderCircle className="loading-spinner" size={15} />
                ) : (
                  <Save size={15} />
                )}
                {t('stories.saveToStory')}
              </button>
              <button
                className="factory-quiet-button"
                type="button"
                onClick={onCancelPendingSave}
              >
                <X size={14} />
                {t('stories.cancelSave')}
              </button>
            </div>
          )}

          <label className="story-script-field">
            <span>{t('stories.scriptLabel')}</span>
            <textarea
              value={script}
              maxLength={20000}
              onChange={(event) => setScript(event.currentTarget.value)}
              onBlur={() => void handleSaveScript()}
              placeholder={t('stories.scriptPlaceholder')}
              aria-label={t('stories.scriptLabel')}
              data-testid="input-story-script"
            />
            <small>
              {scriptSaving ? t('stories.savingScript') : t('stories.scriptAutosave')}
            </small>
          </label>

          <StorySettingsPanel
            story={selectedStory}
            getIdToken={getIdToken}
            hasMixedAspectRatios={
              new Set(images.map((image) => image.aspectRatio).filter(Boolean)).size > 1
            }
          />

          <div className="story-images-heading">
            <div>
              <h2>{t('stories.generatedImages')}</h2>
              <p>{t('stories.imagesSubtitle')}</p>
            </div>
            <span>{selectedStory.imageCount}</span>
          </div>
          {imagesLoading ? (
            <div className="factory-empty" role="status">
              {t('stories.loadingImages')}
            </div>
          ) : images.length ? (
            <>
              <div className="story-images-grid">
              {visibleImages.map((image, index) => (
                <article
                  className={`story-image-card story-image-card-${image.status}`}
                  key={image.id}
                  data-testid={`story-image-${image.id}`}
                >
                  {image.status === 'done' && image.url ? (
                    <button
                      className="story-image-preview"
                      type="button"
                      style={{ aspectRatio: image.aspectRatio?.replace(':', ' / ') ?? '1 / 1' }}
                      aria-label={t('stories.openPreview', {
                        index: imageSequenceLabel(image, index),
                      })}
                      onClick={() => setLightboxImageId(image.id)}
                      data-testid={`button-preview-image-${image.id}`}
                    >
                      <img
                        src={image.thumbnailUrl || image.url}
                        alt={image.prompt || t('labels.generatedImage')}
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <div
                      className={`story-image-state story-image-state-${image.status}`}
                      role="status"
                      aria-label={t(`stories.sceneStatus.${image.status}`)}
                      style={{ aspectRatio: image.aspectRatio?.replace(':', ' / ') ?? '1 / 1' }}
                    >
                      {image.status === 'failed' ? (
                        <span aria-hidden="true">!</span>
                      ) : (
                        <>
                          <span className="story-scene-skeleton" />
                          <span>{t(`stories.sceneStatus.${image.status}`)}</span>
                        </>
                      )}
                    </div>
                  )}
                  {image.status === 'failed' && (
                    <div
                      className="story-image-status story-image-status-failed"
                      role="status"
                    >
                      <span className="story-scene-error-code" dir="ltr">
                        {sceneFailureKey(image.error)}
                      </span>
                      <span>{t(`stories.sceneFailure.${sceneFailureKey(image.error)}`)}</span>
                    </div>
                  )}
                  <div className="story-image-caption">
                    <div className="story-image-copy">
                      <p>{image.index ? t('stories.sceneNumber', { index: image.index }) : image.prompt}</p>
                      {image.legacyGrid && (
                        <span className="story-legacy-grid">{t('stories.legacyGrid')}</span>
                      )}
                    </div>
                    <div className="story-image-actions">
                      <details className="story-action-menu">
                        <summary
                          className="story-icon-button"
                          aria-label={t('stories.moreActions')}
                          title={t('stories.moreActions')}
                        >
                          <MoreHorizontal size={19} aria-hidden="true" />
                        </summary>
                        <button
                          className="story-action-dismiss"
                          type="button"
                          aria-label={t('stories.cancel')}
                          onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
                        />
                        <div
                          className="story-action-sheet"
                          onClick={(event) => {
                            if ((event.target as HTMLElement).closest('button')) {
                              event.currentTarget.closest('details')?.removeAttribute('open');
                            }
                          }}
                        >
                      {image.status === 'failed' && !image.legacyGrid &&
                        image.error !== 'provider_switch_pending' && (
                        <button
                          className="story-sheet-action"
                          type="button"
                          aria-label={t('stories.retryScene')}
                          disabled={Boolean(retryingSceneId)}
                          onClick={() => void handleRetryScene(image)}
                          data-testid={`button-retry-scene-${image.index ?? image.id}`}
                        >
                          {retryingSceneId === image.id
                            ? <LoaderCircle className="loading-spinner" size={15} />
                            : <ImageIcon size={15} />}
                          <span>{t('stories.retryScene')}</span>
                        </button>
                      )}
                      {image.status === 'done' && image.url && (
                        <>
                          <button
                            className="story-sheet-action"
                            type="button"
                            aria-label={t('stories.downloadScene', {
                              index: imageSequenceLabel(image, index),
                            })}
                            disabled={imageAction === image.id}
                            onClick={() => void handleImageDownload(image, index, false)}
                          >
                            {imageAction === image.id ? <LoaderCircle className="loading-spinner" size={15} /> : <Download size={15} />}
                            <span>{t('stories.downloadScene', {
                              index: imageSequenceLabel(image, index),
                            })}</span>
                          </button>
                          <button
                            className="story-sheet-action"
                            type="button"
                            aria-label={t('stories.shareScene', {
                              index: imageSequenceLabel(image, index),
                            })}
                            disabled={imageAction === image.id}
                            onClick={() => void handleImageDownload(image, index, true)}
                          >
                            <Share2 size={15} />
                            <span>{t('stories.shareScene', {
                              index: imageSequenceLabel(image, index),
                            })}</span>
                          </button>
                        </>
                      )}
                      <button
                        className="story-sheet-action delete-action"
                        type="button"
                        aria-label={t('stories.deleteImage')}
                        onClick={() => requestDeleteImage(image)}
                      >
                        <Trash2 size={15} />
                        <span>{t('stories.deleteImage')}</span>
                      </button>
                        </div>
                      </details>
                    </div>
                  </div>
                  {!image.legacyGrid && image.index && (
                    <StorySceneText
                      storyId={selectedStory.id}
                      image={image}
                      getIdToken={getIdToken}
                    />
                  )}
                </article>
              ))}
              </div>
              {visibleImages.length < images.length && (
                <div className="story-images-load-more">
                  <button
                    className="factory-quiet-button"
                    type="button"
                    onClick={() =>
                      setVisibleImageCount((current) =>
                        Math.min(images.length, current + 24),
                      )
                    }
                  >
                    {t('stories.loadMoreImages')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="factory-empty">
              <ImageIcon size={25} />
              <span>{t('stories.noImages')}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="factory-list-toolbar">
            <div>
              <p>{t('stories.storyCount', { count: stories.length })}</p>
            </div>
            <button
              className="factory-primary-button"
              type="button"
              onClick={() => {
                setError('');
                setCreateDialogOpen(true);
              }}
              data-testid="button-create-story"
            >
              <Plus size={17} />
              {t('stories.createStory')}
            </button>
          </div>

          {pendingImage && (
            <div className="factory-pending-image" data-testid="pending-image-save">
              <img src={pendingImage.imageData} alt={t('labels.generatedImage')} loading="lazy" />
              <div>
                <strong>{t('stories.saveTemporaryTitle')}</strong>
                <span>{t('stories.saveTemporaryDescription')}</span>
              </div>
              <button
                className="factory-quiet-button"
                type="button"
                onClick={onCancelPendingSave}
              >
                <X size={14} />
                {t('stories.cancelSave')}
              </button>
            </div>
          )}

          {storiesLoading ? (
            <div className="factory-empty" role="status">
              {t('stories.loading')}
            </div>
          ) : stories.length ? (
            <>
            <div className="story-list">
              {stories.map((story) => (
                <article className="story-card" key={story.id}>
                  <button
                    className="story-card-main"
                    type="button"
                    onClick={() => onStorySelected(story)}
                    data-testid={`button-open-story-${story.id}`}
                  >
                    <span className="story-card-icon" aria-hidden="true">
                      {story.storyName.trim().slice(0, 1).toLocaleUpperCase(locale) || 'Y'}
                    </span>
                    <span className="story-card-copy">
                      <strong dir="auto" title={story.storyName}>{story.storyName}</strong>
                      <small>
                        {t('stories.imageCounter', {
                          count: story.imageCount,
                          max: story.targetCount,
                        })}
                        {formatStoryDate(story.createdAt) && (
                          <> · <bdi dir="ltr">{formatStoryDate(story.createdAt)}</bdi></>
                        )}
                      </small>
                    </span>
                  </button>
                  {editingStoryNameId === story.id ? (
                    <form className="story-name-edit-form story-name-edit-list" onSubmit={(event) => void handleRenameStory(event)}>
                      <label className="sr-only" htmlFor={`story-name-${story.id}`}>{t('stories.storyName')}</label>
                      <input
                        id={`story-name-${story.id}`}
                        autoFocus
                        value={storyNameDraft}
                        maxLength={80}
                        onChange={(event) => setStoryNameDraft(event.currentTarget.value)}
                        aria-label={t('stories.storyName')}
                      />
                      <button className="story-icon-button" type="submit" disabled={!storyNameDraft.trim() || Boolean(renamingStoryId)} aria-label={t('stories.saveStoryName')}>
                        {renamingStoryId === story.id ? <LoaderCircle className="loading-spinner" size={15} /> : <Check size={15} />}
                      </button>
                      <button className="story-icon-button" type="button" disabled={Boolean(renamingStoryId)} aria-label={t('stories.cancel')} onClick={() => setEditingStoryNameId(null)}>
                        <X size={15} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button className="story-icon-button" type="button" aria-label={t('stories.renameStory')} title={t('stories.renameStory')} onClick={() => beginRenameStory(story)}>
                        <Pencil size={15} />
                      </button>
                      <button className="story-icon-button delete-action" type="button" aria-label={t('stories.deleteStory')} title={t('stories.deleteStory')} onClick={() => requestDeleteStory(story)}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                  {pendingImage && (
                    <button
                      className="factory-save-button"
                      type="button"
                      disabled={Boolean(savingImageForStory) || story.imageCount >= MAX_STORY_IMAGES}
                      onClick={() => void handleSaveTemporaryImage(story)}
                      data-testid={`button-save-image-${story.id}`}
                    >
                      {savingImageForStory === story.id ? (
                        <LoaderCircle className="loading-spinner" size={15} />
                      ) : (
                        <Save size={15} />
                      )}
                      {story.imageCount >= MAX_STORY_IMAGES
                        ? t('stories.limitReachedShort')
                        : savingImageForStory === story.id
                          ? t('stories.savingImage')
                          : t('stories.saveToStory')}
                    </button>
                  )}
                </article>
              ))}
            </div>
            {hasMoreStories && stories.length >= STORY_PAGE_SIZE && (
              <div className="story-load-more">
                <button
                  className="factory-quiet-button"
                  type="button"
                  onClick={() => void handleLoadOlderStories()}
                  disabled={storiesLoadingMore}
                  data-testid="button-load-older-stories"
                >
                  {storiesLoadingMore ? t('stories.loadingOlder') : t('stories.loadOlder')}
                </button>
              </div>
            )}
            </>
          ) : (
            <div className="factory-empty factory-empty-card">
              <BookOpen size={28} />
              <strong>{t('stories.emptyTitle')}</strong>
              <span>{t('stories.emptyDescription')}</span>
              <button
                className="factory-primary-button"
                type="button"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus size={17} />
                {t('stories.createStory')}
              </button>
            </div>
          )}
        </>
      )}

      {lightboxIndex >= 0 && (
        <StoryImageLightbox
          images={previewImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxImageId(null)}
          onDownload={(image) => {
            const imageIndex = images.findIndex((item) => item.id === image.id);
            return handleImageDownload(image, Math.max(0, imageIndex), false);
          }}
          downloadingImageId={imageAction}
        />
      )}

      {createDialogOpen && (
        <div
          className="factory-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) {
              setCreateDialogOpen(false);
            }
          }}
        >
          <form
            className="factory-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-story-title"
            onSubmit={(event) => void handleCreateStory(event)}
          >
            <div className="factory-modal-heading">
              <h2 id="create-story-title">{t('stories.createTitle')}</h2>
              <button
                className="story-icon-button"
                type="button"
                aria-label={t('stories.cancel')}
                onClick={() => setCreateDialogOpen(false)}
                disabled={creating}
              >
                <X size={18} />
              </button>
            </div>
            <label className="story-name-field">
              <span>{t('stories.storyName')}</span>
              <input
                autoFocus
                value={storyName}
                maxLength={80}
                onChange={(event) => setStoryName(event.currentTarget.value)}
                placeholder={t('stories.storyNamePlaceholder')}
                required
                data-testid="input-story-name"
              />
            </label>
            <div className="factory-modal-actions">
              <button
                className="factory-quiet-button"
                type="button"
                onClick={() => setCreateDialogOpen(false)}
                disabled={creating}
              >
                {t('stories.cancel')}
              </button>
              <button
                className="factory-primary-button"
                type="submit"
                disabled={!storyName.trim() || creating}
              >
                {creating ? (
                  <LoaderCircle className="loading-spinner" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {creating ? t('stories.creating') : t('stories.createStory')}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmActionDialog
        ref={deleteStoryDialogRef}
        title={t('stories.deleteStoryTitle')}
        description=""
        confirmLabel={t('stories.deleteStory')}
        busyLabel={t('stories.deletingStory')}
        cancelLabel={t('stories.cancel')}
        failureMessage={t('stories.storyDeleteFailed')}
        onConfirm={handleDeleteStory}
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        danger
      />

      <ConfirmActionDialog
        ref={deleteImageDialogRef}
        title={t('stories.deleteImageTitle')}
        description={t('stories.deleteImageWarning')}
        confirmLabel={t('stories.deleteImage')}
        busyLabel={t('stories.deletingImage')}
        cancelLabel={t('stories.cancel')}
        failureMessage={t('stories.imageDeleteFailed')}
        onConfirm={handleDeleteImage}
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
      />
    </section>
  );
}

export default memo(StoryFactory);
