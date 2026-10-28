import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AudioLines,
  ChevronDown,
  Clock3,
  Globe2,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Mic,
  Music2,
  Play,
  Settings,
  Sparkles,
  SquarePlay,
  UploadCloud,
  UserRound,
  Video,
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
import {
  addUserApiKey,
  deleteUserApiKey,
  loadUserApiKeys,
  type ProviderKey,
  type UserApiKeys,
} from '@/lib/userApiKeys';
import {
  firebaseIsConfigured,
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
  const [noticeKey, setNoticeKey] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [videoImage, setVideoImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isAudioGenerating, setIsAudioGenerating] = useState(false);
  const [audioGenerated, setAudioGenerated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioTimeoutRef = useRef<number | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const isRtl = locale === 'ar';
  const prompt = prompts[mode];
  const characterLimit = mode === 'audio' ? 5000 : 1000;
  const isCurrentAudioGenerating = mode === 'audio' && isAudioGenerating;
  const statusMessage =
    mode === 'audio' && audioGenerated
      ? t('status.audioReady')
      : noticeKey
        ? t(noticeKey)
        : '';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    window.localStorage.setItem('yfactory.locale', locale);
  }, [locale, isRtl]);

  useEffect(() => {
    if (!videoImage) {
      setImagePreviewUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(videoImage);
    setImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [videoImage]);

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
      if (audioTimeoutRef.current !== null) {
        window.clearTimeout(audioTimeoutRef.current);
      }
    },
    [],
  );

  const chooseMode = (next: Mode) => {
    setMode(next);
    setNoticeKey('');
  };

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNoticeKey('status.invalidImage');
      return;
    }
    setVideoImage(file);
    setNoticeKey('');
  };

  const selectField = (
    label: string,
    icon: ReactNode,
    options: readonly { value: string; label: string }[],
    id: string,
  ) => (
    <div className="control-group" key={id}>
      <label className="control-label" htmlFor={id}>
        {icon}
        {label}
      </label>
      <div className="select-wrap">
        <select
          className="control-select"
          id={id}
          data-testid={`select-${id}`}
          aria-label={label}
          defaultValue={options[0]?.value}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="select-chevron"
          aria-hidden="true"
        />
      </div>
    </div>
  );

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

  const handleGenerate = () => {
    setNoticeKey('');
    if (mode !== 'audio') {
      setNoticeKey(`status.${mode}`);
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

  const handleLogout = async () => {
    setProfileOpen(false);
    try {
      await signOutFromFirebase();
      setLocation('/login');
    } catch {
      setNoticeKey('status.signOutError');
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
          <div className="locale-wrap">
            <Globe2 className="locale-globe" size={17} aria-hidden="true" />
            <span className="locale-summary" aria-hidden="true">English / العربية / Français</span>
            <select
              className="locale-select"
              value={locale}
              onChange={(event) => {
                void i18n.changeLanguage(event.currentTarget.value);
                setNoticeKey('');
              }}
              aria-label={t('labels.language')}
              data-testid="select-language"
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
            </select>
            <ChevronDown className="locale-chevron" size={13} aria-hidden="true" />
          </div>
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
                <img className="profile-avatar-image" src={user.photoURL} alt="" />
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
                  data-testid="button-profile-logout"
                >
                  <LogOut size={16} />
                  <span>{t('auth.logout')}</span>
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
              aria-selected={mode === tab}
              className={`tab${mode === tab ? ' active' : ''}`}
              onClick={() => chooseMode(tab)}
              data-testid={`tab-${tab}`}
            >
              {tab === 'image' ? <ImageIcon size={20} /> : tab === 'video' ? <SquarePlay size={20} /> : <AudioLines size={20} />}
              <span>{t(`tabs.${tab}`)}</span>
            </button>
          ))}
        </nav>

        {mode === 'video' && (
          <div className="video-upload">
            <input
              ref={fileInputRef}
              className="visually-hidden"
              id="video-source-image"
              type="file"
              accept="image/*"
              aria-label={t('labels.upload')}
              data-testid="input-video-source-image"
              onChange={(event) => {
                handleImageFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              className={`upload-drop${isDraggingImage ? ' is-dragging' : ''}${imagePreviewUrl ? ' has-preview' : ''}`}
              aria-label={
                videoImage
                  ? `${t('upload.selected')}: ${videoImage.name}`
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
                handleImageFile(event.dataTransfer.files[0]);
              }}
            >
              {imagePreviewUrl ? (
                <>
                  <img className="upload-thumbnail" src={imagePreviewUrl} alt={t('upload.selected')} />
                  <span className="upload-copy">
                    <strong>{videoImage?.name ?? t('upload.selected')}</strong>
                    <span>{t('upload.replace')}</span>
                  </span>
                  <UploadCloud className="upload-action-icon" size={20} />
                </>
              ) : (
                <>
                  <UploadCloud size={22} aria-hidden="true" />
                  <span className="upload-copy">
                    <strong>{t('upload.title')}</strong>
                    <span>{t('upload.helper')}</span>
                  </span>
                </>
              )}
            </button>
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
              setPrompts((current) => ({
                ...current,
                [mode]: event.currentTarget.value,
              }));
              setNoticeKey('');
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
          className={`generate${isCurrentAudioGenerating ? ' is-loading' : ''}`}
          onClick={handleGenerate}
          disabled={isCurrentAudioGenerating}
          aria-busy={isCurrentAudioGenerating}
          data-testid="button-generate"
        >
          {isCurrentAudioGenerating ? (
            <LoaderCircle className="loading-spinner" size={19} />
          ) : mode === 'image' ? (
            <Sparkles size={19} />
          ) : mode === 'video' ? (
            <Play size={19} />
          ) : (
            <AudioLines size={20} />
          )}
          <span>{isCurrentAudioGenerating ? t('generate.loading') : t('generate.button')}</span>
        </button>
        {statusMessage && (
          <div className="notice" role="status" aria-live="polite" data-testid="status-response">
            {statusMessage}
          </div>
        )}

        <section
          className="results"
          aria-label={`${t(`tabs.${mode}`)} — ${t('labels.results')}`}
          data-testid="results-grid"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div
              className={`result-tile${mode === 'audio' ? ' audio-tile' : ''}`}
              key={`${mode}-${index}`}
              data-testid={`result-tile-${mode}-${index + 1}`}
            >
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
          ))}
        </section>
      </main>

    </div>
  );
}

function RouteLoading() {
  return (
    <main className="route-loading" role="status" aria-live="polite">
      <LoaderCircle className="loading-spinner" size={24} />
      <span>Loading YFactory…</span>
    </main>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [signInLoading, setSignInLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) setLocation('/');
  }, [loading, setLocation, user]);

  const handleGoogleSignIn = async () => {
    setError(null);
    if (!firebaseIsConfigured) {
      setError('firebase-config');
      return;
    }
    setSignInLoading(true);
    try {
      await signInWithGoogle();
      setLocation('/');
    } catch (signInError) {
      const errorDetails =
        typeof signInError === 'object' &&
        signInError !== null &&
        'code' in signInError
          ? (signInError as { code?: unknown; message?: unknown })
          : {};
      const code =
        typeof errorDetails.code === 'string' ? errorDetails.code : 'unknown';
      const message =
        typeof errorDetails.message === 'string'
          ? errorDetails.message
          : String(signInError);
      console.error('Login Error:', code, message);
      setError(code);
    } finally {
      setSignInLoading(false);
    }
  };

  if (loading || user) return <RouteLoading />;
  return (
    <LoginPage
      loading={signInLoading}
      error={error}
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

  if (loading || !user) return <RouteLoading />;
  return <Home />;
}

function ProtectedSettings() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [keys, setKeys] = useState<UserApiKeys>({
    zsky_keys: [],
    agnes_keys: [],
    glm_keys: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) setLocation('/login');
  }, [authLoading, setLocation, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(null);
    void loadUserApiKeys(user.uid)
      .then((savedKeys) => {
        if (active) setKeys(savedKeys);
      })
      .catch(() => {
        if (active) {
          setError('Could not load saved API keys. Check Firestore access and try again.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const saveKey = async (provider: ProviderKey, key: string) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const nextKeys = await addUserApiKey(user.uid, provider, key);
      setKeys(nextKeys);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save this API key. Check Firestore access and try again.',
      );
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (provider: ProviderKey, key: string) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const nextKeys = await deleteUserApiKey(user.uid, provider, key);
      setKeys(nextKeys);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete this API key. Check Firestore access and try again.',
      );
      throw deleteError;
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOutFromFirebase();
      setLocation('/login');
    } catch {
      setError('Could not sign out. Please try again.');
    }
  };

  if (authLoading || !user) return <RouteLoading />;
  return (
    <SettingsPage
      user={{
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      }}
      keys={keys}
      loading={loading}
      saving={saving}
      error={error}
      onAddKey={saveKey}
      onDeleteKey={removeKey}
      onBack={() => setLocation('/')}
      onLogout={() => void handleLogout()}
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
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
