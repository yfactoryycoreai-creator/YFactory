import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteUser } from 'firebase/auth';
import {
  AudioLines,
  BookOpen,
  Clock3,
  Download,
  Globe2,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Mic,
  Music2,
  Play,
  Save,
  Settings,
  Sparkles,
  SquarePlay,
  Trash2,
  UploadCloud,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import LoginPage from '@/pages/login';
import SettingsPage from '@/pages/settings';
import NotFound from '@/pages/not-found';
import StoryFactory from '@/components/story-factory';
import {
  deleteUserDocument,
  restoreUserDocument,
} from '@/lib/userApiKeys';
import {
  generateImages,
  ImageGenerationError,
} from '@/lib/imageApi';
import {
  MAX_PERSISTED_IMAGES,
  readGeneratedImageHistory,
  readGeneratorSettings,
  writeGeneratedImageHistory,
  writeGeneratorSettings,
  type GeneratedImageHistoryItem,
  type GeneratorSettings,
} from '@/lib/generationStorage';
import {
  MAX_STORY_IMAGES,
  StoryLimitReachedError,
  startStorySceneGeneration,
  type StoryImageRecord,
  type StoryRecord,
} from '@/lib/stories';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  firebaseIsConfigured,
  firebaseConfigurationIssues,
  missingFirebaseFields,
  signInWithGoogle,
  signOutFromFirebase,
} from '@/lib/firebase';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type Mode = 'image' | 'video' | 'audio';
const sampleAudioUrl = 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3';
const maxVideoReferenceImages = 6;
const settingBySelectId = {
  'image-count': 'imageCount',
  'video-duration': 'videoDuration',
  'video-ratio': 'videoRatio',
  'video-quality': 'videoQuality',
  'audio-voice': 'audioVoice',
  'audio-duration': 'audioDuration',
  'audio-style': 'audioStyle',
} as const;
type GeneratorSelectId = keyof typeof settingBySelectId;

function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [mode, setMode] = useState<Mode>('image');
  const [prompts, setPrompts] = useState<Record<Mode, string>>({
    image: '',
    video: '',
    audio: '',
  });
  const [generatorSettings, setGeneratorSettings] =
    useState<GeneratorSettings>(readGeneratorSettings);
  const [noticeKey, setNoticeKey] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const [activeStory, setActiveStory] = useState<StoryRecord | null>(null);
  const [pendingStorySave, setPendingStorySave] =
    useState<GeneratedImageHistoryItem | null>(null);
  const [videoImages, setVideoImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [generatedImages, setGeneratedImages] =
    useState<GeneratedImageHistoryItem[]>(readGeneratedImageHistory);
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [historyWarning, setHistoryWarning] = useState('');
  const [downloadingImageIndex, setDownloadingImageIndex] = useState<number | null>(null);
  const [isAudioGenerating, setIsAudioGenerating] = useState(false);
  const [audioGenerated, setAudioGenerated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioTimeoutRef = useRef<number | null>(null);
  const imageGenerationAbortRef = useRef<AbortController | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const isRtl = locale === 'ar';
  const prompt = prompts[mode];
  const characterLimit = mode === 'image' ? 20000 : mode === 'audio' ? 5000 : 1000;
  const isCurrentAudioGenerating = mode === 'audio' && isAudioGenerating;
  const isCurrentImageGenerating = mode === 'image' && isImageGenerating;
  const isCurrentGenerateLoading =
    isCurrentAudioGenerating || isCurrentImageGenerating;
  const statusMessage =
    mode === 'audio' && audioGenerated
      ? t('status.audioReady')
      : noticeKey
        ? t(noticeKey)
        : '';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    try {
      window.localStorage.setItem('yfactory.locale', locale);
    } catch {
      // Keep the current language active even if browser storage is unavailable.
    }
  }, [locale, isRtl]);

  useEffect(() => {
    try {
      writeGeneratorSettings(generatorSettings);
    } catch {
      // Settings remain usable for this session if local storage is unavailable.
    }
  }, [generatorSettings]);

  useEffect(() => {
    try {
      writeGeneratedImageHistory(generatedImages);
      setHistoryWarning('');
    } catch {
      setHistoryWarning(t('status.historySaveFailed'));
    }
  }, [generatedImages, t]);

  useEffect(() => {
    const previewUrls = videoImages.map((file) => URL.createObjectURL(file));
    setImagePreviewUrls(previewUrls);
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [videoImages]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnKeyDown);
    };
  }, [profileOpen]);

  useEffect(
    () => () => {
      imageGenerationAbortRef.current?.abort();
      if (audioTimeoutRef.current !== null) {
        window.clearTimeout(audioTimeoutRef.current);
      }
    },
    [],
  );

  const chooseMode = (next: Mode) => {
    setMode(next);
    setStoriesOpen(false);
    setNoticeKey('');
    setImageError('');
  };

  const handleStorySelected = useCallback((story: StoryRecord | null) => {
    setActiveStory(story);
  }, []);

  const handleTemporaryImageSaved = (
    image: GeneratedImageHistoryItem,
    story: StoryRecord,
    savedImage: StoryImageRecord,
  ) => {
    setGeneratedImages((current) => current.filter((item) => item.id !== image.id));
    setPendingStorySave(null);
    setActiveStory({
      ...story,
      imageCount: Math.min(MAX_STORY_IMAGES, story.imageCount + 1),
      storageBytes: story.storageBytes + savedImage.sizeBytes,
    });
    setStoriesOpen(true);
  };

  const handleImageFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const receivedFiles = Array.from(files);
    const validFiles = receivedFiles.filter((file) =>
      file.type.startsWith('image/'),
    );
    if (validFiles.length === 0) {
      setNoticeKey('status.invalidImage');
      return;
    }
    const nextCount = videoImages.length + validFiles.length;
    setVideoImages((current) =>
      [...current, ...validFiles].slice(0, maxVideoReferenceImages),
    );
    if (nextCount > maxVideoReferenceImages) {
      setNoticeKey('status.maxReferenceImages');
      return;
    }
    setNoticeKey('');
  };

  const updateGeneratorSetting = (
    id: GeneratorSelectId,
    value: string,
  ) => {
    const key = settingBySelectId[id];
    setGeneratorSettings((current) => ({
      ...current,
      [key]: value,
    }) as GeneratorSettings);
  };

  const selectField = (
    label: string,
    icon: ReactNode,
    options: readonly { value: string; label: string }[],
    id: GeneratorSelectId,
  ) => (
    <div className="control-group" key={id}>
      <label className="control-label" htmlFor={id}>
        {icon}
        {label}
      </label>
      <Select
        dir={isRtl ? 'rtl' : 'ltr'}
        value={generatorSettings[settingBySelectId[id]]}
        onValueChange={(value) => updateGeneratorSetting(id, value)}
      >
        <SelectTrigger
          className="control-select"
          id={id}
          data-testid={`select-${id}`}
          aria-label={label}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="custom-select-content">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="custom-select-item"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const imageCountOptions = [
    { value: '1', label: t('options.imageCountOne') },
    { value: '2', label: t('options.imageCountTwo') },
    { value: '4', label: t('options.imageCountFour') },
  ];
  const videoDurationOptions = [
    { value: '5', label: t('options.video5') },
    { value: '10', label: t('options.video10') },
    { value: '15', label: t('options.video15') },
  ];
  const audioDurationOptions = [
    { value: '30', label: t('options.audio30') },
    { value: '60', label: t('options.audio60') },
    { value: '90', label: t('options.audio90') },
  ];
  const aspectRatioOptions = [
    { value: '16:9', label: t('options.landscape') },
    { value: '9:16', label: t('options.portrait') },
    { value: '1:1', label: t('options.square') },
  ];
  const qualityOptions = [
    { value: '720p', label: t('options.hd') },
    { value: '1080p', label: t('options.fullHd') },
    { value: '2160p', label: t('options.uhd') },
  ];
  const voiceOptions = [
    { value: 'default', label: t('options.defaultVoice') },
    { value: 'warm', label: t('options.warmVoice') },
    { value: 'bright', label: t('options.brightVoice') },
  ];
  const styleOptions = [
    { value: 'natural', label: t('options.natural') },
    { value: 'cinematic', label: t('options.cinematic') },
    { value: 'energetic', label: t('options.energetic') },
  ];

  const handleGenerate = async () => {
    setNoticeKey('');
    setImageError('');
    if (mode === 'image') {
      const promptToGenerate = prompts.image.trim();
      if (!promptToGenerate) {
        setImageError(t('status.imagePromptRequired'));
        return;
      }
      if (!user) {
        setImageError(t('status.authRequired'));
        return;
      }

      if (activeStory && activeStory.imageCount >= MAX_STORY_IMAGES) {
        setImageError(t('stories.limitReached'));
        return;
      }
      const requestedImages = Number(generatorSettings.imageCount);
      const totalImages = activeStory
        ? Math.min(
            requestedImages,
            MAX_STORY_IMAGES - activeStory.imageCount,
          )
        : requestedImages;
      setIsImageGenerating(true);
      imageGenerationAbortRef.current?.abort();
      const controller = new AbortController();
      imageGenerationAbortRef.current = controller;
      try {
        const idToken = await user.getIdToken();
        if (activeStory) {
          const started = await startStorySceneGeneration(
            activeStory.id,
            promptToGenerate,
            totalImages,
            idToken,
            controller.signal,
          );
          if (started.skippedCount > 0) {
            setImageError(
              t('status.partialImageFailure', {
                failed: started.skippedCount,
                total: requestedImages,
              }),
            );
          } else {
            setNoticeKey('status.imageBatchReady');
          }
          return;
        }
        const result = await generateImages(
          idToken,
          null,
          promptToGenerate,
          totalImages,
          controller.signal,
        );
        const batch: GeneratedImageHistoryItem[] = result.images.map((image) => ({
          id: crypto.randomUUID(),
          prompt: promptToGenerate,
          createdAt: Date.now(),
          imageData: image.imageData,
          provider: image.provider,
          ...(image.savedToFactory ? { savedToFactory: true } : {}),
        }));

        setGeneratedImages((current) =>
          [...batch, ...current].slice(0, MAX_PERSISTED_IMAGES),
        );
        if (result.failedCount > 0 || result.skippedCount > 0) {
          setImageError(
            t('status.partialImageFailure', {
              failed: result.failedCount + result.skippedCount,
              total: requestedImages,
            }),
          );
        } else {
          setNoticeKey('status.imageBatchReady');
        }
      } catch (generationError) {
        if (!controller.signal.aborted) {
          setImageError(
            generationError instanceof StoryLimitReachedError ||
              (generationError instanceof ImageGenerationError &&
                generationError.code === 'story_limit')
              ? t('stories.limitReached')
              : t('status.imageGenerateFailed'),
          );
        }
      } finally {
        if (imageGenerationAbortRef.current === controller) {
          imageGenerationAbortRef.current = null;
        }
        setIsImageGenerating(false);
      }
      return;
    }
    if (mode !== 'audio') {
      setNoticeKey('status.video');
      return;
    }
    if (audioTimeoutRef.current !== null) {
      window.clearTimeout(audioTimeoutRef.current);
    }
    setAudioGenerated(false);
    setIsAudioGenerating(true);
    audioTimeoutRef.current = window.setTimeout(() => {
      setIsAudioGenerating(false);
      setAudioGenerated(true);
    }, 900);
  };

  const handleDownloadImage = async (imageData: string, index: number) => {
    setDownloadingImageIndex(index);
    setImageError('');
    try {
      const response = await fetch(imageData);
      if (!response.ok) {
        throw new Error(`Image download failed with status ${response.status}.`);
      }
      const imageBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(imageBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      const extension = imageBlob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      link.download = `yfactory-image-${Date.now()}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (downloadError) {
      console.error('Image download failed:', downloadError);
      setImageError(t('status.imageDownloadFailed'));
    } finally {
      setDownloadingImageIndex(null);
    }
  };

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setGeneratedImages([]);
    setPrompts({ image: '', video: '', audio: '' });
    setActiveStory(null);
    setPendingStorySave(null);
    try {
      await signOutFromFirebase();
      setProfileOpen(false);
      setLocation('/login');
    } catch {
      setImageError(t('status.signOutError'));
      setIsSigningOut(false);
    }
  };

  const profileName = user?.displayName || user?.email || 'YFactory creator';
  const profileInitials = (user?.displayName || user?.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className={`workspace${isRtl ? ' rtl' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <div className="brand" data-testid="brand-yfactory" aria-label="YFactory">
          <span className="brand-mark" aria-hidden="true">Y</span><span>YFactory</span>
        </div>
        <div className="header-tools">
          <Select
            dir={isRtl ? 'rtl' : 'ltr'}
            value={locale}
            onValueChange={(language) => {
              document.documentElement.lang = language;
              document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
              void i18n.changeLanguage(language);
              setNoticeKey('');
            }}
          >
            <SelectTrigger
              className="locale-trigger"
              aria-label={t('labels.language')}
              data-testid="select-language"
            >
              <Globe2 size={16} aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="custom-select-content locale-content">
              <SelectItem className="custom-select-item" value="en">English</SelectItem>
              <SelectItem className="custom-select-item" value="ar">العربية</SelectItem>
              <SelectItem className="custom-select-item" value="fr">Français</SelectItem>
            </SelectContent>
          </Select>
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button
              className="profile-button"
              type="button"
              aria-label={t('labels.profile')}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              data-testid="button-profile"
              onClick={() => setProfileOpen((open) => !open)}
            >
              {user?.photoURL ? (
                <img className="profile-avatar-image" src={user.photoURL} alt="" loading="lazy" />
              ) : (
                <span className="profile-avatar-initials" aria-hidden="true">
                  {profileInitials || <UserRound size={17} />}
                </span>
              )}
            </button>
            {profileOpen && (
              <div className="profile-menu" role="menu" aria-label={t('labels.profile')}>
                <div className="profile-menu-user">
                  <span className="profile-menu-name">{profileName}</span>
                  {user?.email && <span className="profile-menu-email">{user.email}</span>}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    setLocation('/settings');
                  }}
                  data-testid="button-profile-settings"
                >
                  <Settings size={16} />
                  <span>{t('labels.settings')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleLogout()}
                  disabled={isSigningOut}
                  data-testid="button-profile-logout"
                >
                  <LogOut size={16} />
                  <span>{isSigningOut ? t('auth.signingOut') : t('auth.logout')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="settings-row">
        <button
          className="settings-button"
          type="button"
          aria-label={t('labels.settings')}
          data-testid="button-settings"
          onClick={() => setLocation('/settings')}
        >
          <Settings size={19} />
        </button>
      </div>

      <main className="main">
        <nav className="tabs" role="tablist" aria-label={t('labels.tabs')} data-testid="media-tabs">
          {(['image', 'video', 'audio'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={!storiesOpen && mode === tab}
              className={`tab${!storiesOpen && mode === tab ? ' active' : ''}`}
              onClick={() => chooseMode(tab)}
              data-testid={`tab-${tab}`}
            >
              {tab === 'image' ? <ImageIcon size={20} /> : tab === 'video' ? <SquarePlay size={20} /> : <AudioLines size={20} />}
              <span>{t(`tabs.${tab}`)}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={storiesOpen}
            className={`tab${storiesOpen ? ' active' : ''}`}
            onClick={() => {
              setStoriesOpen(true);
              setNoticeKey('');
              setImageError('');
            }}
            data-testid="tab-stories"
          >
            <BookOpen size={19} />
            <span>{t('tabs.stories')}</span>
          </button>
        </nav>

        {user && (
          <StoryFactory
            uid={user.uid}
            getIdToken={() => user.getIdToken()}
            requestedImageCount={Number(generatorSettings.imageCount)}
            visible={storiesOpen}
            selectedStoryId={activeStory?.id ?? null}
            pendingImage={pendingStorySave}
            onStorySelected={handleStorySelected}
            onTemporaryImageSaved={handleTemporaryImageSaved}
            onCancelPendingSave={() => setPendingStorySave(null)}
          />
        )}

        {!storiesOpen && (
          <>
        {mode === 'video' && (
          <div className="video-upload">
            <input
              ref={fileInputRef}
              className="visually-hidden"
              id="video-source-image"
              type="file"
              accept="image/*"
              multiple
              aria-label={t('labels.upload')}
              data-testid="input-video-source-image"
              onChange={(event) => {
                handleImageFiles(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              className={`upload-drop${isDraggingImage ? ' is-dragging' : ''}${videoImages.length ? ' has-preview' : ''}`}
              aria-label={
                videoImages.length
                  ? t('upload.selectedCount', { count: videoImages.length })
                  : t('upload.title')
              }
              data-testid="button-upload-video-image"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDraggingImage(true);
              }}
              onDragLeave={() => setIsDraggingImage(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDraggingImage(false);
                handleImageFiles(event.dataTransfer.files);
              }}
            >
              <UploadCloud size={22} aria-hidden="true" />
              <span className="upload-copy">
                <strong>{t('upload.title')}</strong>
                <span>
                  {videoImages.length
                    ? t('upload.selectedCount', { count: videoImages.length })
                    : t('upload.helper')}
                </span>
              </span>
              <span className="upload-limit">
                {videoImages.length}/{maxVideoReferenceImages}
              </span>
            </button>
            {videoImages.length > 0 && (
              <div className="upload-preview-list" aria-label={t('upload.selectedImages')}>
                {videoImages.map((file, index) => (
                  <div className="upload-preview-item" key={`${file.name}-${index}`}>
                    <img
                      className="upload-thumbnail"
                      src={imagePreviewUrls[index]}
                      alt={file.name}
                      loading="lazy"
                      data-testid={`img-video-reference-${index + 1}`}
                    />
                    <button
                      type="button"
                      className="remove-upload"
                      aria-label={t('upload.removeImage', { name: file.name })}
                      onClick={() =>
                        setVideoImages((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        )
                      }
                      data-testid={`button-remove-video-reference-${index + 1}`}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <section className="composer" aria-label={t('labels.prompt')}>
          <div className="prompt-icon" aria-hidden="true">
            {mode === 'image' ? <Sparkles size={19} /> : mode === 'video' ? <Video size={19} /> : <AudioLines size={19} />}
          </div>
          <textarea
            className="prompt-box"
            value={prompt}
            maxLength={characterLimit}
            disabled={isCurrentAudioGenerating}
            onChange={(event) => {
              const value = event.currentTarget?.value ?? '';
              setPrompts((current) => ({
                ...current,
                [mode]: value,
              }));
              setNoticeKey('');
              setImageError('');
              if (mode === 'audio') setAudioGenerated(false);
            }}
            placeholder={t(`prompt.${mode}`)}
            aria-label={t('labels.prompt')}
            data-testid="input-generation-prompt"
          />
          <div className="char-count" aria-live="polite" data-testid="text-character-count">
            {t('labels.characterCount', { count: prompt.length, max: characterLimit })}
          </div>
        </section>

        {mode === 'image' && (
          <section
            className="controls image-controls"
            aria-label={t('labels.imageCount')}
            data-testid="image-controls"
          >
            {selectField(
              t('labels.imageCount'),
              <ImageIcon size={16} />,
              imageCountOptions,
              'image-count',
            )}
          </section>
        )}

        {mode !== 'image' && (
          <section
            className="controls"
            aria-label={
              mode === 'video'
                ? `${t('labels.duration')}, ${t('labels.aspectRatio')}, ${t('labels.quality')}`
                : `${t('labels.voice')}, ${t('labels.duration')}, ${t('labels.style')}`
            }
            data-testid={`${mode}-controls`}
          >
            {mode === 'video' ? (
              <>
                {selectField(t('labels.duration'), <Clock3 size={16} />, videoDurationOptions, 'video-duration')}
                {selectField(t('labels.aspectRatio'), <ImageIcon size={16} />, aspectRatioOptions, 'video-ratio')}
                {selectField(t('labels.quality'), <Sparkles size={16} />, qualityOptions, 'video-quality')}
              </>
            ) : (
              <>
                {selectField(t('labels.voice'), <Mic size={16} />, voiceOptions, 'audio-voice')}
                {selectField(t('labels.duration'), <Clock3 size={16} />, audioDurationOptions, 'audio-duration')}
                {selectField(t('labels.style'), <Music2 size={17} />, styleOptions, 'audio-style')}
              </>
            )}
          </section>
        )}

        <button
          type="button"
          className={`generate${isCurrentGenerateLoading ? ' is-loading' : ''}`}
          onClick={() => void handleGenerate()}
          disabled={isCurrentGenerateLoading}
          aria-busy={isCurrentGenerateLoading}
          data-testid="button-generate"
        >
          {isCurrentGenerateLoading ? (
            <LoaderCircle className="loading-spinner" size={19} />
          ) : mode === 'image' ? (
            <Sparkles size={19} />
          ) : mode === 'video' ? (
            <Play size={19} />
          ) : (
            <AudioLines size={20} />
          )}
          <span>
            {isCurrentImageGenerating
              ? t('generate.imageLoading')
              : isCurrentAudioGenerating
                ? t('generate.loading')
                : t('generate.button')}
          </span>
        </button>
        {imageError && (
          <div className="notice notice-error" role="alert" data-testid="image-generation-error">
            {imageError}
          </div>
        )}
        {historyWarning && (
          <div className="notice notice-error" role="status" data-testid="image-history-warning">
            {historyWarning}
          </div>
        )}
        {statusMessage && (
          <div className="notice" role="status" aria-live="polite" data-testid="status-response">
            {statusMessage}
          </div>
        )}

        {mode === 'image' && (
          <div className="results-heading">
            <h2>{t('labels.recentGenerations')}</h2>
            <span>{generatedImages.length}</span>
          </div>
        )}
        <section
          className="results"
          aria-label={`${t(`tabs.${mode}`)} — ${t('labels.results')}`}
          data-testid="results-grid"
        >
          {Array.from(
            { length: mode === 'image' ? Math.max(4, generatedImages.length) : 4 },
            (_, index) => (
            <div
              className={`result-tile${mode === 'audio' ? ' audio-tile' : ''}${mode === 'image' && generatedImages[index] ? ' image-tile' : ''}`}
              key={`${mode}-${index}`}
              data-testid={`result-tile-${mode}-${index + 1}`}
            >
              {mode === 'image' && generatedImages[index] ? (
                <div className="generated-image-wrap">
                  <img
                    className="generated-image"
                    src={generatedImages[index].imageData}
                    alt={t('labels.generatedImage')}
                    loading="lazy"
                    data-testid={`generated-image-${index + 1}`}
                    onError={() => {
                      setImageError(t('status.imageGenerateFailed'));
                      const failedImage = generatedImages[index];
                      if (failedImage) {
                        setGeneratedImages((current) =>
                          current.filter((image) => image.id !== failedImage.id),
                        );
                      }
                    }}
                  />
                  <button
                    className="image-download"
                    type="button"
                    disabled={downloadingImageIndex === index}
                    aria-busy={downloadingImageIndex === index}
                    onClick={() =>
                      void handleDownloadImage(
                        generatedImages[index].imageData,
                        index,
                      )
                    }
                    data-testid={`button-download-image-${generatedImages[index].id}`}
                  >
                    <Download size={14} aria-hidden="true" />
                    <span>
                      {downloadingImageIndex === index
                        ? t('labels.downloading')
                        : t('labels.download')}
                    </span>
                  </button>
                  {!generatedImages[index].savedToFactory ? (
                    <div className="temporary-image-actions">
                      <button
                        className="factory-save-button"
                        type="button"
                        onClick={() => {
                          setPendingStorySave(generatedImages[index]);
                          setStoriesOpen(true);
                          setImageError('');
                        }}
                        data-testid={`button-save-temporary-${generatedImages[index].id}`}
                      >
                        <Save size={14} aria-hidden="true" />
                        <span>{t('stories.saveToFactory')}</span>
                      </button>
                      <button
                        className="factory-quiet-button"
                        type="button"
                        onClick={() =>
                          setGeneratedImages((current) =>
                            current.filter(
                              (image) => image.id !== generatedImages[index].id,
                            ),
                          )
                        }
                        data-testid={`button-delete-temporary-${generatedImages[index].id}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>{t('stories.deleteTemporary')}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="factory-saved-badge">
                      <BookOpen size={13} />
                      {t('stories.savedToFactory')}
                    </span>
                  )}
                </div>
              ) : (
                <div
                  className={`result-inner${mode === 'audio' ? ' audio-inner' : ''}`}
                  aria-label={
                    mode === 'image'
                      ? t('tabs.image')
                      : mode === 'video'
                        ? t('empty.video')
                        : t('empty.audio')
                  }
                >
                  {mode === 'image' ? (
                    <ImagePlus size={36} strokeWidth={1.5} />
                  ) : mode === 'video' ? (
                    <>
                      <SquarePlay size={34} strokeWidth={1.5} />
                      <span className="result-message">{t('empty.video')}</span>
                    </>
                  ) : (
                    <>
                      <Music2 size={34} strokeWidth={1.7} />
                      <span className="result-message">{t('empty.audio')}</span>
                    </>
                  )}
                </div>
              )}
              {mode === 'audio' && (
                <audio
                  className="native-audio-player"
                  controls
                  preload="none"
                  src={audioGenerated ? sampleAudioUrl : undefined}
                  aria-label={t('audio.samplePlayer')}
                  data-testid={`audio-player-${index + 1}`}
                >
                  {t('audio.unsupported')}
                </audio>
              )}
            </div>
            ),
          )}
        </section>
          </>
        )}
      </main>
    </div>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [signInLoading, setSignInLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) setLocation('/');
  }, [loading, setLocation, user]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setErrorMessage(null);
    if (!firebaseIsConfigured) {
      setError('firebase-config');
      const configProblems = [
        ...missingFirebaseFields.map((field) => `Missing Firebase environment variable: ${field}.`),
        ...firebaseConfigurationIssues,
      ];
      setErrorMessage(configProblems.join(' '));
      return;
    }
    setSignInLoading(true);
    try {
      await signInWithGoogle();
      setLocation('/');
    } catch (signInError) {
      const errorDetails =
        typeof signInError === 'object' &&
        signInError !== null
          ? (signInError as { code?: unknown; message?: unknown })
          : {};
      const code =
        typeof errorDetails.code === 'string' ? errorDetails.code : 'unknown';
      const message =
        typeof errorDetails.message === 'string'
          ? errorDetails.message
          : signInError instanceof Error
            ? signInError.message
            : String(signInError);
      console.error('Login Error:', code, message);
      setError(code);
      setErrorMessage(message);
    } finally {
      setSignInLoading(false);
    }
  };

  return (
    <LoginPage
      loading={signInLoading}
      error={error}
      errorMessage={errorMessage}
      onGoogleSignIn={() => void handleGoogleSignIn()}
    />
  );
}

function ProtectedHome() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation('/login');
  }, [loading, setLocation, user]);

  return <Home />;
}

function ProtectedSettings() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!authLoading && !user) setLocation('/login');
  }, [authLoading, setLocation, user]);

  const getIdToken = useCallback(async () => {
    if (!user) throw new Error('Sign in to manage API keys.');
    return user.getIdToken();
  }, [user]);

  const handleLogout = async () => {
    await signOutFromFirebase();
    setLocation('/login');
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const previousDocument = await deleteUserDocument(user.uid);
    try {
      await deleteUser(user);
    } catch (deleteAuthError) {
      if (previousDocument) {
        try {
          await restoreUserDocument(user.uid, previousDocument);
        } catch {
          throw new Error(
            'Account deletion could not finish and the account data could not be restored.',
          );
        }
      }
      throw deleteAuthError;
    }
    setLocation('/login');
  };

  return (
    <SettingsPage
      user={{
        displayName: user?.displayName ?? null,
        email: user?.email ?? null,
        photoURL: user?.photoURL ?? null,
      }}
      getIdToken={user ? getIdToken : undefined}
      onBack={() => setLocation('/')}
      onLogout={handleLogout}
      onDeleteAccount={handleDeleteAccount}
    />
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={LoginRoute} />
        <Route path="/settings" component={ProtectedSettings} />
        <Route path="/" component={ProtectedHome} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <LocaleDirectionSync />
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function LocaleDirectionSync() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = locale === 'ar';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [locale, isRtl]);

  return null;
}

export default App;
