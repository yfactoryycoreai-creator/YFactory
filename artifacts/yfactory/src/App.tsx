import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { deleteUser } from 'firebase/auth';
import {
  BookOpen,
  Download,
  Film,
  GraduationCap,
  Globe2,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Save,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ErrorBoundary,
  type ErrorFallbackProps,
} from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import LoginPage from '@/pages/login';
import SettingsPage from '@/pages/settings';
import NotFound from '@/pages/not-found';
import ChatScreen from '@/components/chat-screen';
import YCodeLogo from '@/components/ycode-logo';
import {
  CodeSectionHub,
  StudentsSectionHub,
  VideoSectionHub,
} from '@/components/section-hubs';
import LanguagePickerDialog from '@/components/language-picker-dialog';
import { notifyUserIfEnabled } from '@/lib/appPreferences';
import {
  applyDocumentLanguage,
  changeAppLanguage,
  findLanguageOption,
  isRtlLanguage,
} from '@/lib/languages';
import {
  type ChatAgentRunResult,
  type ImageAgentCommand,
  type StoryAgentCommand,
} from '@/lib/chatAgent';
import {
  deleteUserDocument,
  restoreUserDocument,
} from '@/lib/userApiKeys';
import {
  generateImages,
  editImageFromReference,
  prepareImageReference,
  ImageEditError,
  ImageGenerationError,
  MAX_IMAGE_REFERENCE_FILE_BYTES,
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
  createStory,
  MAX_STORY_IMAGES,
  StoryLimitReachedError,
  startStorySceneGeneration,
  updateStoryScript,
  updateStorySettings,
  updateStoryTargetCount,
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

type AppSection = 'image' | 'chat' | 'stories' | 'code' | 'video' | 'students';

const StoryFactory = lazy(() => import('@/components/story-factory'));

function StoryTabFallback({ resetError }: ErrorFallbackProps) {
  const { t } = useTranslation();
  return (
    <div className="factory-error story-tab-error" role="alert">
      <span>{t('stories.tabFailed')}</span>
      <button className="factory-quiet-button" type="button" onClick={resetError}>
        {t('stories.retryTab')}
      </button>
    </div>
  );
}

function MediaTabFallback({ resetError }: ErrorFallbackProps) {
  const { t } = useTranslation();
  return (
    <div className="notice notice-error app-tab-error" role="alert">
      <span>{t('status.tabFailed')}</span>
      <button className="factory-quiet-button" type="button" onClick={resetError}>
        {t('status.retryTab')}
      </button>
    </div>
  );
}

function StoryTabLoading() {
  const { t } = useTranslation();
  return <div className="factory-empty" role="status" aria-busy="true">{t('stories.loading')}</div>;
}

function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [prompt, setPrompt] = useState('');
  const [generatorSettings, setGeneratorSettings] =
    useState<GeneratorSettings>(readGeneratorSettings);
  const [noticeKey, setNoticeKey] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeSection, setActiveSection] = useState<AppSection>('image');
  const lastNonChatSectionRef = useRef<Exclude<AppSection, 'chat'>>('image');
  const tabButtonRefs = useRef<Partial<Record<AppSection, HTMLButtonElement | null>>>({});
  const chatOpen = activeSection === 'chat';
  const storiesOpen = activeSection === 'stories';
  const [activeStory, setActiveStory] = useState<StoryRecord | null>(null);
  const [pendingStorySave, setPendingStorySave] =
    useState<GeneratedImageHistoryItem | null>(null);
  const [generatedImages, setGeneratedImages] =
    useState<GeneratedImageHistoryItem[]>(readGeneratedImageHistory);
  const [isImageGenerating, setIsImageGenerating] = useState(false);
  const [imageEditFile, setImageEditFile] = useState<File | null>(null);
  const [imageEditPreviewUrl, setImageEditPreviewUrl] = useState('');
  const [imageEditPrompt, setImageEditPrompt] = useState('');
  const [imageEditResult, setImageEditResult] =
    useState<GeneratedImageHistoryItem | null>(null);
  const [isImageEditing, setIsImageEditing] = useState(false);
  const [imageEditError, setImageEditError] = useState('');
  const [imageError, setImageError] = useState('');
  const [historyWarning, setHistoryWarning] = useState('');
  const [downloadingImageIndex, setDownloadingImageIndex] = useState<number | null>(null);
  const imageEditInputRef = useRef<HTMLInputElement>(null);
  const imageGenerationAbortRef = useRef<AbortController | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const isRtl = isRtlLanguage(locale);
  const currentLanguage = findLanguageOption(locale);
  const characterLimit = 20_000;
  const isCurrentGenerateLoading = isImageGenerating || isImageEditing;
  const statusMessage = noticeKey ? t(noticeKey) : '';

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
    if (!imageEditFile) {
      setImageEditPreviewUrl('');
      return;
    }
    const previewUrl = URL.createObjectURL(imageEditFile);
    setImageEditPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageEditFile]);

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
    },
    [],
  );

  const selectSection = useCallback((section: AppSection) => {
    if (section !== 'chat') {
      lastNonChatSectionRef.current = section;
    }
    setActiveSection(section);
    setNoticeKey('');
    setImageError('');
    requestAnimationFrame(() => {
      tabButtonRefs.current[section]?.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    });
  }, []);

  const chooseImageTab = () => {
    selectSection('image');
  };

  const openProviderCenterFromHub = useCallback(
    (providerId?: string) => {
      if (providerId) {
        setLocation(
          `/settings?view=api-keys&modelsProvider=${encodeURIComponent(providerId)}`,
        );
      } else {
        setLocation('/settings?view=api-keys');
      }
    },
    [setLocation],
  );

  const handleStorySelected = useCallback((story: StoryRecord | null) => {
    setActiveStory(story);
  }, []);

  const getUserIdToken = useCallback(async () => {
    if (!user) throw new Error(t('status.authRequiredForAction'));
    return user.getIdToken();
  }, [t, user]);

  const handleCancelPendingSave = useCallback(() => {
    setPendingStorySave(null);
  }, []);

  const handleTemporaryImageSaved = useCallback((
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
    selectSection('stories');
    if (imageEditResult?.id === image.id) {
      setImageEditResult(null);
      setImageEditFile(null);
      setImageEditPrompt('');
    }
  }, [imageEditResult]);

  const handleImageEditFile = (file: File | undefined) => {
    setImageEditError('');
    setImageEditResult(null);
    if (!file) {
      setImageEditFile(null);
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    const acceptedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      (!file.type && ['jpg', 'jpeg', 'png', 'webp'].includes(extension ?? ''));
    if (!acceptedType) {
      setImageEditFile(null);
      setImageEditError(t('imageEdit.invalidType'));
      return;
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_REFERENCE_FILE_BYTES) {
      setImageEditFile(null);
      setImageEditError(t('imageEdit.tooLarge'));
      return;
    }
    setImageEditFile(file);
  };

  const imageCountOptions = [
    { value: '1', label: t('options.imageCountOne') },
    { value: '2', label: t('options.imageCountTwo') },
    { value: '4', label: t('options.imageCountFour') },
  ];

  const executeChatImageAgent = useCallback(
    async (
      cmd: ImageAgentCommand,
      autoNavigate: boolean,
    ): Promise<ChatAgentRunResult> => {
      if (!user) {
        return {
          ok: false,
          target: 'image',
          navigated: false,
          errorMessage: t('status.authRequired'),
        };
      }
      const promptToGenerate = cmd.prompt.trim();
      if (!promptToGenerate) {
        return {
          ok: false,
          target: 'image',
          navigated: false,
          errorMessage: t('status.imagePromptRequired'),
        };
      }

      setActiveStory(null);
      setPrompt(promptToGenerate);
      setGeneratorSettings((current) => ({
        ...current,
        imageCount: cmd.count,
      }));
      setNoticeKey('');
      setImageError('');

      if (autoNavigate) {
        selectSection('image');
      }

      const requestedImages = Number(cmd.count);
      setIsImageGenerating(true);
      imageGenerationAbortRef.current?.abort();
      const controller = new AbortController();
      imageGenerationAbortRef.current = controller;

      try {
        const idToken = await user.getIdToken();
        const result = await generateImages(
          idToken,
          null,
          promptToGenerate,
          requestedImages,
          controller.signal,
        );
        const batch: GeneratedImageHistoryItem[] = result.images.map(
          (image) => ({
            id: crypto.randomUUID(),
            prompt: promptToGenerate,
            createdAt: Date.now(),
            imageData: image.imageData,
            provider: image.provider,
            ...(image.savedToFactory ? { savedToFactory: true } : {}),
          }),
        );
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
          notifyUserIfEnabled('YFactory AI', t('status.imageBatchReady'));
        }
        return {
          ok: true,
          target: 'image',
          navigated: autoNavigate,
          generatedImages: result.images.map((item) => ({
            url: item.imageData,
            provider: item.provider,
          })),
        };
      } catch (err) {
        const msg =
          err instanceof ImageGenerationError
            ? err.message
            : t('status.imageGenerateFailed');
        if (!controller.signal.aborted) {
          setImageError(msg);
        }
        return {
          ok: false,
          target: 'image',
          navigated: autoNavigate,
          errorMessage: msg,
        };
      } finally {
        if (imageGenerationAbortRef.current === controller) {
          imageGenerationAbortRef.current = null;
        }
        setIsImageGenerating(false);
      }
    },
    [t, user],
  );

  const executeChatStoryAgent = useCallback(
    async (
      cmd: StoryAgentCommand,
      autoNavigate: boolean,
    ): Promise<ChatAgentRunResult> => {
      if (!user) {
        return {
          ok: false,
          target: 'story',
          navigated: false,
          errorMessage: t('status.authRequired'),
        };
      }
      try {
        const idToken = await user.getIdToken();
        const storyId = cmd.storyId
          ? cmd.storyId
          : await createStory(user.uid, cmd.storyName);

        if (cmd.script.trim()) {
          await updateStoryScript(user.uid, storyId, cmd.script);
        }
        await updateStoryTargetCount(storyId, cmd.targetCount, idToken);
        await updateStorySettings(
          storyId,
          {
            aspectRatio: cmd.aspectRatio,
            characterTraits: cmd.characterTraits,
            keepOneProvider: cmd.keepOneProvider,
          },
          idToken,
        );

        const nextStory: StoryRecord = {
          id: storyId,
          storyName: cmd.storyName,
          script: cmd.script,
          createdAt: new Date(),
          imageCount: 0,
          storageBytes: 0,
          targetCount: cmd.targetCount,
          aspectRatio: cmd.aspectRatio,
          characterTraits: cmd.characterTraits,
          keepOneProvider: cmd.keepOneProvider,
          providerSwitchPending: false,
        };
        setActiveStory(nextStory);

        if (autoNavigate) {
          selectSection('stories');
        }

        if (cmd.startGeneration && cmd.script.trim()) {
          await startStorySceneGeneration(
            storyId,
            cmd.script,
            cmd.targetCount,
            idToken,
          );
        }

        return {
          ok: true,
          target: 'story',
          navigated: autoNavigate,
          storyId,
          storyName: cmd.storyName,
        };
      } catch (err) {
        return {
          ok: false,
          target: 'story',
          navigated: autoNavigate,
          errorMessage:
            err instanceof Error ? err.message : t('stories.saveFailed'),
        };
      }
    },
    [t, user],
  );

  const openImageWorkspaceFromChat = useCallback(() => {
    selectSection('image');
  }, [selectSection]);

  const openStoryWorkspaceFromChat = useCallback((storyId?: string) => {
    if (storyId) {
      setActiveStory((cur) =>
        cur && cur.id === storyId
          ? cur
          : {
              id: storyId,
              storyName: '',
              script: '',
              createdAt: new Date(),
              imageCount: 0,
              storageBytes: 0,
              targetCount: 10,
              aspectRatio: '16:9',
              characterTraits: [],
              keepOneProvider: true,
              providerSwitchPending: false,
            },
      );
    }
    selectSection('stories');
  }, []);

  const handleGenerate = async () => {
    setNoticeKey('');
    setImageError('');
    const promptToGenerate = prompt.trim();
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
        }
        selectSection('stories');
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
  };

  const handleImageEdit = async () => {
    setImageEditError('');
    const promptToEdit = imageEditPrompt.trim();
    if (!imageEditFile) {
      setImageEditError(t('imageEdit.referenceRequired'));
      return;
    }
    if (!promptToEdit) {
      setImageEditError(t('imageEdit.promptRequired'));
      return;
    }
    if (!user) {
      setImageEditError(t('status.authRequired'));
      return;
    }
    setIsImageEditing(true);
    try {
      const referenceImage = await prepareImageReference(imageEditFile);
      const edited = await editImageFromReference(
        await user.getIdToken(),
        promptToEdit,
        referenceImage,
      );
      setImageEditResult({
        id: crypto.randomUUID(),
        prompt: promptToEdit,
        createdAt: Date.now(),
        imageData: edited.imageData,
        provider: edited.provider,
      });
    } catch (error) {
      const code = error instanceof ImageEditError ? error.code : '';
      setImageEditError(
        code === 'image_edit_provider_missing' || code === 'missing_key'
          ? t('imageEdit.providerKeyMissing')
          : code === 'unsupported_image_input'
            ? t('imageEdit.unsupported')
            : code === 'invalid_reference'
              ? t('imageEdit.invalidReference')
              : code === 'reference_too_large'
                ? t('imageEdit.tooLarge')
                : t('imageEdit.failed'),
      );
    } finally {
      setIsImageEditing(false);
    }
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
    } catch {
      setImageError(t('status.imageDownloadFailed'));
    } finally {
      setDownloadingImageIndex(null);
    }
  };

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setPrompt('');
    setActiveStory(null);
    setPendingStorySave(null);
    try {
      await signOutFromFirebase();
      queryClient.clear();
      setProfileOpen(false);
      setLocation('/login');
    } catch {
      setImageError(t('status.signOutError'));
      setIsSigningOut(false);
    }
  };

  const profileName = user?.displayName || user?.email || t('settings.creator');
  const profileInitials = (user?.displayName || user?.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className={`workspace${isRtl ? ' rtl' : ''}${chatOpen ? ' chat-open' : ''}`} dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <div className="brand" data-testid="brand-yfactory" aria-label="YFactory">
          <span className="brand-mark" aria-hidden="true">Y</span><span>YFactory</span>
        </div>
        <div className="header-tools">
          <button
            type="button"
            className="locale-trigger"
            aria-label={t('labels.language')}
            aria-haspopup="dialog"
            data-testid="select-language"
            onClick={() => setLanguagePickerOpen(true)}
          >
            <Globe2 size={16} aria-hidden="true" />
            <span>{currentLanguage.nativeName}</span>
          </button>
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
        <nav
          className="tabs tabs-six"
          role="tablist"
          aria-label={t('labels.tabs')}
          data-testid="media-tabs"
        >
          <button
            ref={(el) => { tabButtonRefs.current.image = el; }}
            type="button"
            role="tab"
            aria-selected={activeSection === 'image'}
            className={`tab${activeSection === 'image' ? ' active' : ''}`}
            onClick={chooseImageTab}
            data-testid="tab-image"
          >
            <ImageIcon size={20} />
            <span>{t('tabs.image')}</span>
          </button>
          <button
            ref={(el) => { tabButtonRefs.current.chat = el; }}
            type="button"
            role="tab"
            aria-selected={activeSection === 'chat'}
            className={`tab${activeSection === 'chat' ? ' active' : ''}`}
            onClick={() => selectSection('chat')}
            data-testid="tab-chat"
          >
            <MessageCircle size={19} />
            <span>{t('tabs.chat')}</span>
          </button>
          <button
            ref={(el) => { tabButtonRefs.current.stories = el; }}
            type="button"
            role="tab"
            aria-selected={activeSection === 'stories'}
            className={`tab${activeSection === 'stories' ? ' active' : ''}`}
            onClick={() => selectSection('stories')}
            data-testid="tab-stories"
          >
            <BookOpen size={19} />
            <span>{t('tabs.stories')}</span>
          </button>
          <button
            ref={(el) => { tabButtonRefs.current.code = el; }}
            type="button"
            role="tab"
            aria-selected={activeSection === 'code'}
            className={`tab tab-code-item${activeSection === 'code' ? ' active' : ''}`}
            onClick={() => selectSection('code')}
            data-testid="tab-code"
          >
            <YCodeLogo size={22} />
            <span>{locale.startsWith('ar') ? 'البرمجة' : 'Code'}</span>
          </button>
          <button
            ref={(el) => { tabButtonRefs.current.video = el; }}
            type="button"
            role="tab"
            aria-selected={activeSection === 'video'}
            className={`tab${activeSection === 'video' ? ' active' : ''}`}
            onClick={() => selectSection('video')}
            data-testid="tab-video"
          >
            <Film size={19} />
            <span>{locale.startsWith('ar') ? 'فيديو' : 'Video'}</span>
          </button>
          <button
            ref={(el) => { tabButtonRefs.current.students = el; }}
            type="button"
            role="tab"
            aria-selected={activeSection === 'students'}
            className={`tab${activeSection === 'students' ? ' active' : ''}`}
            onClick={() => selectSection('students')}
            data-testid="tab-students"
          >
            <GraduationCap size={20} />
            <span>{locale.startsWith('ar') ? 'الطلاب' : 'Students'}</span>
          </button>
        </nav>

        {chatOpen && (
          <ChatScreen
            onBack={() => selectSection(lastNonChatSectionRef.current)}
            getIdToken={getUserIdToken}
            onOpenSecrets={() => {
              selectSection(lastNonChatSectionRef.current);
              setLocation('/settings?view=api-keys');
            }}
            onOpenModels={(key) => {
              selectSection(lastNonChatSectionRef.current);
              setLocation(
                `/settings?view=api-keys&modelsProvider=${encodeURIComponent(key.provider)}&modelsKeyId=${encodeURIComponent(key.id)}`,
              );
            }}
            onExecuteImageAgent={executeChatImageAgent}
            onExecuteStoryAgent={executeChatStoryAgent}
            onOpenImagePage={openImageWorkspaceFromChat}
            onOpenStoryPage={openStoryWorkspaceFromChat}
          />
        )}

        {activeSection === 'stories' && user && (
          <ErrorBoundary FallbackComponent={StoryTabFallback}>
            <Suspense fallback={<StoryTabLoading />}>
              <StoryFactory
                uid={user.uid}
                getIdToken={getUserIdToken}
                visible={storiesOpen}
                selectedStoryId={activeStory?.id ?? null}
                pendingImage={pendingStorySave}
                onStorySelected={handleStorySelected}
                onTemporaryImageSaved={handleTemporaryImageSaved}
                onCancelPendingSave={handleCancelPendingSave}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {activeSection === 'code' && (
          <ErrorBoundary FallbackComponent={MediaTabFallback}>
            <CodeSectionHub
              locale={locale}
              getIdToken={getUserIdToken}
              onOpenProviderCenter={openProviderCenterFromHub}
              onOpenChat={() => selectSection('chat')}
            />
          </ErrorBoundary>
        )}

        {activeSection === 'video' && (
          <ErrorBoundary FallbackComponent={MediaTabFallback}>
            <VideoSectionHub
              locale={locale}
              getIdToken={getUserIdToken}
              onOpenProviderCenter={openProviderCenterFromHub}
              onOpenChat={() => selectSection('chat')}
            />
          </ErrorBoundary>
        )}

        {activeSection === 'students' && (
          <ErrorBoundary FallbackComponent={MediaTabFallback}>
            <StudentsSectionHub
              locale={locale}
              getIdToken={getUserIdToken}
              onOpenProviderCenter={openProviderCenterFromHub}
              onOpenChat={() => selectSection('chat')}
            />
          </ErrorBoundary>
        )}

        {activeSection === 'image' && (
          <ErrorBoundary FallbackComponent={MediaTabFallback}>
          <>
        <section className="composer" aria-label={t('labels.prompt')}>
          <div className="prompt-icon" aria-hidden="true">
            <Sparkles size={19} />
          </div>
          <textarea
            className="prompt-box"
            value={prompt}
            maxLength={characterLimit}
            onChange={(event) => {
              const value = event.currentTarget?.value ?? '';
              setPrompt(value);
              setNoticeKey('');
              setImageError('');
            }}
            placeholder={t('prompt.image')}
            aria-label={t('labels.prompt')}
            data-testid="input-generation-prompt"
          />
          <div className="char-count" aria-live="polite" data-testid="text-character-count">
            {t('labels.characterCount', { count: prompt.length, max: characterLimit })}
          </div>
        </section>

        <section
          className="controls image-controls"
          aria-label={t('labels.imageCount')}
          data-testid="image-controls"
        >
          <div className="control-group">
            <label className="control-label" htmlFor="image-count">
              <ImageIcon size={16} />
              {t('labels.imageCount')}
            </label>
            <Select
              dir={isRtl ? 'rtl' : 'ltr'}
              value={generatorSettings.imageCount}
              onValueChange={(value) => setGeneratorSettings((current) => ({
                ...current,
                imageCount: value as GeneratorSettings['imageCount'],
              }))}
            >
              <SelectTrigger
                className="control-select"
                id="image-count"
                data-testid="select-image-count"
                aria-label={t('labels.imageCount')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="custom-select-content">
                {imageCountOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="custom-select-item">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="image-edit-panel" aria-labelledby="image-edit-title" data-testid="image-edit-panel">
            <div className="image-edit-heading">
              <div>
                <h2 id="image-edit-title">{t('imageEdit.title')}</h2>
                <p>{t('imageEdit.description')}</p>
              </div>
              <input
                ref={imageEditInputRef}
                className="visually-hidden"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                aria-label={t('imageEdit.reference')}
                data-testid="input-image-edit-reference"
                onChange={(event) => {
                  handleImageEditFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                className="image-edit-upload"
                onClick={() => imageEditInputRef.current?.click()}
                disabled={isImageEditing}
                data-testid="button-image-edit-upload"
              >
                <ImagePlus size={17} aria-hidden="true" />
                <span>{imageEditFile ? imageEditFile.name : t('imageEdit.chooseReference')}</span>
              </button>
            </div>
            <label className="image-edit-prompt-label" htmlFor="image-edit-prompt">
              {t('imageEdit.prompt')}
            </label>
            <textarea
              id="image-edit-prompt"
              className="image-edit-prompt"
              value={imageEditPrompt}
              maxLength={20_000}
              onChange={(event) => {
                setImageEditPrompt(event.currentTarget.value);
                setImageEditError('');
              }}
              placeholder={t('imageEdit.promptPlaceholder')}
              data-testid="input-image-edit-prompt"
            />
            <button
              type="button"
              className="generate image-edit-generate"
              onClick={() => void handleImageEdit()}
              disabled={isImageEditing || !imageEditFile || !imageEditPrompt.trim()}
              aria-busy={isImageEditing}
              data-testid="button-image-edit-generate"
            >
              {isImageEditing
                ? <LoaderCircle className="loading-spinner" size={18} />
                : <Sparkles size={18} />}
              <span>{isImageEditing ? t('imageEdit.loading') : t('imageEdit.generate')}</span>
            </button>
            {imageEditError && (
              <div className="notice notice-error" role="alert" data-testid="image-edit-error">
                {imageEditError}
              </div>
            )}
            {imageEditResult && imageEditPreviewUrl && (
              <div className="image-edit-result-grid" data-testid="image-edit-result">
                <figure>
                  <figcaption>{t('imageEdit.original')}</figcaption>
                  <img src={imageEditPreviewUrl} alt={t('imageEdit.original')} />
                </figure>
                <figure>
                  <figcaption>{t('imageEdit.edited')}</figcaption>
                  <img src={imageEditResult.imageData} alt={t('imageEdit.edited')} />
                  <div className="image-edit-result-actions">
                    <button
                      className="factory-save-button"
                      type="button"
                      onClick={() => {
                        setPendingStorySave(imageEditResult);
                        selectSection('stories');
                        setImageEditError('');
                      }}
                      data-testid="button-image-edit-save"
                    >
                      <Save size={14} aria-hidden="true" />
                      <span>{t('imageEdit.save')}</span>
                    </button>
                    <button
                      className="factory-quiet-button"
                      type="button"
                      disabled={downloadingImageIndex === -2}
                      aria-busy={downloadingImageIndex === -2}
                      onClick={() => void handleDownloadImage(imageEditResult.imageData, -2)}
                      data-testid="button-image-edit-download"
                    >
                      <Download size={14} aria-hidden="true" />
                      <span>{downloadingImageIndex === -2 ? t('labels.downloading') : t('labels.download')}</span>
                    </button>
                  </div>
                </figure>
              </div>
            )}
        </section>

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
          ) : (
            <Sparkles size={19} />
          )}
          <span>
            {isImageGenerating
              ? t('generate.imageLoading')
              : isImageEditing
                ? t('imageEdit.loading')
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

        <div className="results-heading">
          <h2>{t('labels.recentGenerations')}</h2>
          <span>{generatedImages.length}</span>
        </div>
        <section
          className="results"
          aria-label={`${t('tabs.image')} — ${t('labels.results')}`}
          data-testid="results-grid"
        >
          {Array.from(
            { length: Math.max(4, generatedImages.length) },
            (_, index) => (
            <div
              className={`result-tile${generatedImages[index] ? ' image-tile' : ''}`}
              key={`image-${index}`}
              data-testid={`result-tile-image-${index + 1}`}
            >
              {generatedImages[index] ? (
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
                          selectSection('stories');
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
                  className="result-inner"
                  aria-label={t('tabs.image')}
                >
                  <ImagePlus size={36} strokeWidth={1.5} />
                </div>
              )}
            </div>
            ),
          )}
        </section>
          </>
          </ErrorBoundary>
        )}
      </main>
      <LanguagePickerDialog
        open={languagePickerOpen}
        currentCode={currentLanguage.code}
        onClose={() => setLanguagePickerOpen(false)}
        onSelect={(lang) => {
          changeAppLanguage(lang.code);
          setNoticeKey('');
        }}
      />
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

function AuthResolutionSkeleton() {
  return (
    <main className="auth-resolution-skeleton" role="status" aria-busy="true">
      <span />
      <div>
        <span />
        <span />
      </div>
      <section>
        <span />
        <span />
        <span />
      </section>
    </main>
  );
}

function ProtectedHome() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation('/login');
  }, [loading, setLocation, user]);

  if (loading) return <AuthResolutionSkeleton />;
  if (!user) return null;
  return <Home />;
}

function ProtectedSettings() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!authLoading && !user) setLocation('/login');
  }, [authLoading, setLocation, user]);

  if (authLoading) return <AuthResolutionSkeleton />;
  if (!user) return null;

  const getIdToken = useCallback(async () => {
    if (!user) throw new Error(t('status.authRequiredForAction'));
    return user.getIdToken();
  }, [t, user]);

  const handleLogout = async () => {
    await signOutFromFirebase();
    queryClient.clear();
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
        uid: user?.uid ?? null,
        displayName: user?.displayName ?? null,
        email: user?.email ?? null,
        photoURL: user?.photoURL ?? null,
      }}
      getIdToken={user ? getIdToken : undefined}
      initialSubview={new URLSearchParams(window.location.search).get('view') === 'api-keys' ? 'api-keys' : null}
      initialModelTarget={(() => {
        const params = new URLSearchParams(window.location.search);
        const provider = params.get('modelsProvider');
        const id = params.get('modelsKeyId');
        return provider && id ? { provider, id } : null;
      })()}
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

  useEffect(() => {
    applyDocumentLanguage(locale);
  }, [locale]);

  return null;
}

export default App;
