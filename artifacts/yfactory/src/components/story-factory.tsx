import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Save,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfirmActionDialog from '@/components/confirm-action-dialog';
import {
  createStory,
  deleteStoryImage,
  fetchOlderStories,
  MAX_STORY_IMAGES,
  STORY_PAGE_SIZE,
  saveImageToStory,
  subscribeToStories,
  subscribeToStoryImages,
  updateStoryScript,
  type StoryImageRecord,
  type StoryRecord,
} from '@/lib/stories';
import type { GeneratedImageHistoryItem } from '@/lib/generationStorage';
import { generateImages } from '@/lib/imageApi';

type StoryFactoryProps = {
  uid: string;
  getIdToken: () => Promise<string>;
  requestedImageCount: number;
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

function imageSequenceLabel(image: StoryImageRecord, index: number): string {
  const publicIdTail = image.publicId?.split('/').at(-1);
  const sequence = image.sequence ??
    (publicIdTail && /^\d+$/.test(publicIdTail) ? Number(publicIdTail) : index + 1);
  return String(sequence).padStart(3, '0');
}

async function fetchAsWebp(url: string): Promise<Blob> {
  const response = await fetch(url);
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatStoryDate(value: unknown, locale: string): string {
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
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export default function StoryFactory({
  uid,
  getIdToken,
  requestedImageCount,
  visible,
  selectedStoryId,
  pendingImage,
  onStorySelected,
  onTemporaryImageSaved,
  onCancelPendingSave,
}: StoryFactoryProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [hasMoreStories, setHasMoreStories] = useState(false);
  const [storiesLoadingMore, setStoriesLoadingMore] = useState(false);
  const [images, setImages] = useState<StoryImageRecord[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [storyName, setStoryName] = useState('');
  const [creating, setCreating] = useState(false);
  const [script, setScript] = useState('');
  const [scriptSaving, setScriptSaving] = useState(false);
  const scriptSavePromise = useRef<Promise<boolean> | null>(null);
  const [savingImageForStory, setSavingImageForStory] = useState<string | null>(
    null,
  );
  const [imageToDelete, setImageToDelete] = useState<StoryImageRecord | null>(
    null,
  );
  const [deletingImage, setDeletingImage] = useState(false);
  const [generatingStoryImages, setGeneratingStoryImages] = useState(false);
  const [imageAction, setImageAction] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const selectedStory = useMemo(
    () => stories.find((story) => story.id === selectedStoryId) ?? null,
    [stories, selectedStoryId],
  );
  const totalStorageBytes = stories.reduce(
    (total, story) => total + story.storageBytes,
    0,
  );
  const storagePercent = Math.min(
    100,
    (totalStorageBytes / STORAGE_QUOTA_BYTES) * 100,
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
      (loadError) => {
        console.error('Could not load stories:', loadError);
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
    } catch (loadError) {
      console.error('Could not load older stories:', loadError);
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
      (loadError) => {
        console.error('Could not load story images:', loadError);
        setError(t('stories.imagesLoadFailed'));
        setImagesLoading(false);
      },
    );
  }, [uid, selectedStoryId, t, visible]);

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
      });
    } catch (createError) {
      console.error('Could not create story:', createError);
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
      .catch((saveError: unknown) => {
        console.error('Could not save story script:', saveError);
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

  const handleSaveTemporaryImage = async (story: StoryRecord) => {
    if (!pendingImage || savingImageForStory) return;
    if (story.imageCount >= MAX_STORY_IMAGES) {
      setError(t('stories.limitReached'));
      return;
    }
    setSavingImageForStory(story.id);
    setError('');
    try {
      const saved = await saveImageToStory(
        uid,
        story.id,
        pendingImage.imageData,
        pendingImage.prompt,
        await getIdToken(),
        pendingImage.provider,
      );
      onTemporaryImageSaved(pendingImage, story, saved);
    } catch (saveError) {
      console.error('Could not save temporary image:', saveError);
      setError(
        saveError instanceof Error &&
          saveError.message ===
            'Story limit reached (100 images). Start a new story.'
          ? t('stories.limitReached')
          : t('stories.imageSaveFailed'),
      );
    } finally {
      setSavingImageForStory(null);
    }
  };

  const handleDeleteImage = async () => {
    if (!selectedStory || !imageToDelete || deletingImage) return;
    setDeletingImage(true);
    setError('');
    try {
      await deleteStoryImage(
        uid,
        selectedStory.id,
        imageToDelete,
        await getIdToken(),
      );
      setImageToDelete(null);
    } catch (deleteError) {
      console.error('Could not delete story image:', deleteError);
      setError(t('stories.imageDeleteFailed'));
    } finally {
      setDeletingImage(false);
    }
  };

  const handleGenerateStoryImages = async () => {
    if (!selectedStory || generatingStoryImages) return;
    const prompt = script.trim();
    if (!prompt) {
      setError('Add a prompt to this story before generating images.');
      return;
    }
    if (selectedStory.imageCount >= MAX_STORY_IMAGES) {
      setError(t('stories.limitReached'));
      return;
    }
    setGeneratingStoryImages(true);
    setError('');
    try {
      if (!(await handleSaveScript())) return;
      const count = Math.min(
        Math.max(1, requestedImageCount),
        MAX_STORY_IMAGES - selectedStory.imageCount,
      );
      const result = await generateImages(
        await getIdToken(),
        selectedStory.id,
        prompt,
        count,
      );
      if (result.failedCount > 0) {
        setError(`${result.images.length} image(s) saved; ${result.failedCount} could not be saved.`);
      }
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : 'Image generation failed. Check enabled provider keys and try again.',
      );
    } finally {
      setGeneratingStoryImages(false);
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
    const filename = `${selectedStory.storyName.replace(/[\\/:*?"<>|]/g, '_')}_${imageSequenceLabel(image, index)}.webp`;
    try {
      const blob = await fetchAsWebp(image.url);
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
      if (downloadError instanceof DOMException && downloadError.name === 'AbortError') return;
      setError(downloadError instanceof Error ? downloadError.message : 'The image could not be downloaded.');
    } finally {
      setImageAction(null);
    }
  };

  const handleDownloadStoryZip = async () => {
    if (!selectedStory || downloadingZip) return;
    setDownloadingZip(true);
    setError('');
    try {
      const response = await fetch(
        `/api/images/stories/${encodeURIComponent(selectedStory.id)}/download.zip`,
        { headers: { Authorization: `Bearer ${await getIdToken()}` } },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === 'object' &&
          typeof (body as Record<string, unknown>).error === 'string'
          ? String((body as Record<string, unknown>).error)
          : 'The story ZIP could not be downloaded.';
        throw new Error(message);
      }
      downloadBlob(
        await response.blob(),
        `${selectedStory.storyName.replace(/[\\/:*?"<>|]/g, '_')}.zip`,
      );
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The story ZIP could not be downloaded.');
    } finally {
      setDownloadingZip(false);
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
          <div>
            <h1>{selectedStory?.storyName ?? t('stories.title')}</h1>
            <p>{selectedStory ? t('stories.workspaceSubtitle') : t('stories.subtitle')}</p>
          </div>
        </div>
        <div className="factory-storage" data-testid="storage-usage">
          <div className="factory-storage-copy">
            <span>{t('stories.storageUsage')}</span>
            <strong>
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

      {selectedStory ? (
        <div className="story-workspace">
          <div className="story-workspace-toolbar">
            <div className="story-image-meter">
              <span>
                {t('stories.imageCounter', {
                  count: selectedStory.imageCount,
                  max: MAX_STORY_IMAGES,
                })}
              </span>
              <div className="story-image-progress">
                <span
                  style={{
                    width: `${(selectedStory.imageCount / MAX_STORY_IMAGES) * 100}%`,
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
              {generatingStoryImages ? 'Generating…' : t('stories.generateScenes')}
            </button>
            <button
              className="factory-quiet-button"
              type="button"
              onClick={() => void handleDownloadStoryZip()}
              disabled={!images.length || downloadingZip}
              aria-busy={downloadingZip}
            >
              {downloadingZip ? <LoaderCircle className="loading-spinner" size={15} /> : <Download size={15} />}
              {downloadingZip ? 'Preparing ZIP…' : 'Download story as ZIP'}
            </button>
          </div>

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
            <div className="story-images-grid">
              {images.map((image, index) => (
                <article className="story-image-card" key={image.id}>
                  <img src={image.thumbnailUrl || image.url} alt={image.prompt || t('labels.generatedImage')} loading="lazy" />
                  <div className="story-image-caption">
                    <p>{image.prompt}</p>
                    <div className="story-image-actions">
                      <button
                        className="story-icon-button"
                        type="button"
                        aria-label={`Download image ${imageSequenceLabel(image, index)}`}
                        title="Download"
                        disabled={imageAction === image.id}
                        onClick={() => void handleImageDownload(image, index, false)}
                      >
                        {imageAction === image.id ? <LoaderCircle className="loading-spinner" size={15} /> : <Download size={15} />}
                      </button>
                      <button
                        className="story-icon-button"
                        type="button"
                        aria-label={`Share image ${imageSequenceLabel(image, index)}`}
                        title="Share"
                        disabled={imageAction === image.id}
                        onClick={() => void handleImageDownload(image, index, true)}
                      ><Share2 size={15} /></button>
                      <button
                        className="story-icon-button delete-action"
                        type="button"
                        aria-label={t('stories.deleteImage')}
                        onClick={() => setImageToDelete(image)}
                      ><Trash2 size={15} /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
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
              <h2>{t('stories.yourStories')}</h2>
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
                    <span className="story-card-icon"><BookOpen size={20} /></span>
                    <span className="story-card-copy">
                      <strong>{story.storyName}</strong>
                      <small>
                        {t('stories.imageCounter', {
                          count: story.imageCount,
                          max: MAX_STORY_IMAGES,
                        })}
                        {formatStoryDate(story.createdAt, locale) &&
                          ` · ${formatStoryDate(story.createdAt, locale)}`}
                      </small>
                    </span>
                    <span className="story-card-count">{story.imageCount}</span>
                  </button>
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
        open={Boolean(imageToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingImage) setImageToDelete(null);
        }}
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
