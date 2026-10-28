import { useEffect, useState, type ReactNode } from 'react';
import {
  AudioLines,
  ChevronDown,
  Clock3,
  Globe2,
  Image as ImageIcon,
  ImagePlus,
  Mic,
  Music2,
  Play,
  Settings,
  Sparkles,
  SquarePlay,
  UserRound,
  Volume2,
  Video,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type Locale = 'en' | 'ar' | 'fr';
type Mode = 'image' | 'video' | 'audio';

const copy = {
  en: {
    tabs: { image: 'Image', video: 'Video', audio: 'Audio' },
    prompt: {
      image: 'Describe the image you want to generate...',
      video: 'Describe the video you want to generate...',
      audio: 'Describe the audio you want to generate...',
    },
    generate: 'Generate',
    duration: 'Duration',
    ratio: 'Aspect Ratio',
    quality: 'Quality',
    voice: 'Voice',
    style: 'Style',
    empty: {
      image: '',
      video: 'Your generated video will appear here',
      audio: 'Your generated audio will appear here',
    },
    options: {
      durationVideo: ['5 seconds', '10 seconds', '15 seconds'],
      durationAudio: ['30 seconds', '60 seconds', '90 seconds'],
      ratio: ['16:9 (Landscape)', '9:16 (Portrait)', '1:1 (Square)'],
      quality: ['Haute définition (720p)', 'Très haute définition (1080p)', '4K (2160p)'],
      voice: ['Default Voice', 'Warm Voice', 'Bright Voice'],
      style: ['Natural', 'Cinematic', 'Energetic'],
    },
    response: {
      image: 'Your image prompt is ready. Generation is a UI preview only.',
      video: 'Your video prompt is ready. Generation is a UI preview only.',
      audio: 'Your audio prompt is ready. Generation is a UI preview only.',
      settings: 'Settings are not available in this preview.',
      profile: 'Profile menu is not available in this preview.',
    },
    labels: {
      locale: 'Language',
      settings: 'Settings',
      profile: 'Profile',
      prompt: 'Generation prompt',
      tabs: 'Media generation type',
      results: 'Generated results',
      chars: (count: number) => `${count}/1000`,
      play: 'Play audio preview',
      volume: 'Audio volume',
    },
  },
  fr: {
    tabs: { image: 'Image', video: 'Vidéo', audio: 'Audio' },
    prompt: {
      image: "Décrivez l’image que vous souhaitez générer...",
      video: 'Décrivez la vidéo que vous souhaitez générer...',
      audio: 'Décrivez le son que vous souhaitez générer...',
    },
    generate: 'Générer',
    duration: 'Durée',
    ratio: 'Format',
    quality: 'Qualité',
    voice: 'Voix',
    style: 'Style',
    empty: {
      image: '',
      video: 'Votre vidéo générée apparaîtra ici',
      audio: 'Votre audio généré apparaîtra ici',
    },
    options: {
      durationVideo: ['5 secondes', '10 secondes', '15 secondes'],
      durationAudio: ['30 secondes', '60 secondes', '90 secondes'],
      ratio: ['16:9 (Paysage)', '9:16 (Portrait)', '1:1 (Carré)'],
      quality: ['دقة عالية (720p)', 'دقة عالية جدًا (1080p)', '4K (2160p)'],
      voice: ['Voix par défaut', 'Voix chaleureuse', 'Voix claire'],
      style: ['Naturel', 'Cinématique', 'Énergique'],
    },
    response: {
      image: 'Votre prompt image est prêt. La génération est une simple prévisualisation.',
      video: 'Votre prompt vidéo est prêt. La génération est une simple prévisualisation.',
      audio: 'Votre prompt audio est prêt. La génération est une simple prévisualisation.',
      settings: 'Les paramètres ne sont pas disponibles dans cet aperçu.',
      profile: 'Le profil n’est pas disponible dans cet aperçu.',
    },
    labels: {
      locale: 'Langue',
      settings: 'Paramètres',
      profile: 'Profil',
      prompt: 'Prompt de génération',
      tabs: 'Type de média à générer',
      results: 'Résultats générés',
      chars: (count: number) => `${count}/1000`,
      play: 'Lire l’aperçu audio',
      volume: 'Volume audio',
    },
  },
  ar: {
    tabs: { image: 'صورة', video: 'فيديو', audio: 'صوت' },
    prompt: {
      image: 'صِف الصورة التي تريد إنشاءها...',
      video: 'صِف الفيديو الذي تريد إنشاءه...',
      audio: 'صِف الصوت الذي تريد إنشاءه...',
    },
    generate: 'إنشاء',
    duration: 'المدة',
    ratio: 'نسبة العرض',
    quality: 'الجودة',
    voice: 'الصوت',
    style: 'النمط',
    empty: {
      image: '',
      video: 'سيظهر الفيديو الذي تم إنشاؤه هنا',
      audio: 'سيظهر الصوت الذي تم إنشاؤه هنا',
    },
    options: {
      durationVideo: ['٥ ثوانٍ', '١٠ ثوانٍ', '١٥ ثانية'],
      durationAudio: ['٣٠ ثانية', '٦٠ ثانية', '٩٠ ثانية'],
      ratio: ['16:9 (أفقي)', '9:16 (عمودي)', '1:1 (مربع)'],
      quality: ['HD (720p)', 'Full HD (1080p)', '4K (2160p)'],
      voice: ['الصوت الافتراضي', 'صوت دافئ', 'صوت مشرق'],
      style: ['طبيعي', 'سينمائي', 'حيوي'],
    },
    response: {
      image: 'وصف الصورة جاهز. الإنشاء هنا للمعاينة فقط.',
      video: 'وصف الفيديو جاهز. الإنشاء هنا للمعاينة فقط.',
      audio: 'وصف الصوت جاهز. الإنشاء هنا للمعاينة فقط.',
      settings: 'الإعدادات غير متاحة في هذه المعاينة.',
      profile: 'الملف الشخصي غير متاح في هذه المعاينة.',
    },
    labels: {
      locale: 'اللغة',
      settings: 'الإعدادات',
      profile: 'الملف الشخصي',
      prompt: 'وصف الإنشاء',
      tabs: 'نوع الوسائط للإنشاء',
      results: 'النتائج المُنشأة',
      chars: (count: number) => `${count}/1000`,
      play: 'تشغيل معاينة الصوت',
      volume: 'مستوى الصوت',
    },
  },
} as const;

function Home() {
  const [locale, setLocale] = useState<Locale>('en');
  const [mode, setMode] = useState<Mode>('image');
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const t = copy[locale];
  const isRtl = locale === 'ar';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [locale, isRtl]);

  const chooseMode = (next: Mode) => {
    setMode(next);
    setNotice('');
  };

  const promptIcon = mode === 'image' ? <Sparkles size={19} /> : mode === 'video' ? <Video size={19} /> : <AudioLines size={19} />;
  const modeIcon = (tab: Mode) => tab === 'image' ? <ImageIcon size={20} /> : tab === 'video' ? <SquarePlay size={20} /> : <AudioLines size={20} />;
  const generateIcon = mode === 'image' ? <Sparkles size={19} /> : mode === 'video' ? <Play size={19} /> : <AudioLines size={20} />;

  const selectField = (label: string, icon: ReactNode, options: readonly string[], id: string, value?: string) => (
    <div className="control-group" key={id}>
      <label className="control-label" htmlFor={id}>{icon}{label}</label>
      <div className="select-wrap">
        <select className="control-select" id={id} data-testid={`select-${id}`} aria-label={label} defaultValue={value ?? options[0]}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
      </div>
    </div>
  );

  const audioPlayer = (index: number) => (
    <div className="audio-player" aria-label={t.labels.play} data-testid={`audio-player-${index}`}>
      <button className="player-button" type="button" aria-label={t.labels.play} data-testid={`button-play-audio-${index}`} onClick={() => setNotice(t.response.audio)}><Play size={10} fill="currentColor" /></button>
      <div className="player-track" aria-hidden="true" />
      <span className="player-time">0:00 / 0:00</span>
      <Volume2 size={15} aria-label={t.labels.volume} />
    </div>
  );

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
            <select className="locale-select" value={locale} onChange={(event) => { setLocale(event.target.value as Locale); setNotice(''); }} aria-label={t.labels.locale} data-testid="select-language">
              <option value="en">English</option>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
            </select>
            <ChevronDown className="locale-chevron" size={13} aria-hidden="true" />
          </div>
          <button className="profile-button" type="button" aria-label={t.labels.profile} data-testid="button-profile" onClick={() => setNotice(t.response.profile)}><UserRound size={18} fill="currentColor" /></button>
        </div>
      </header>
      <div className="settings-row">
        <button className="settings-button" type="button" aria-label={t.labels.settings} data-testid="button-settings" onClick={() => setNotice(t.response.settings)}><Settings size={19} /></button>
      </div>

      <main className="main">
        <nav className="tabs" role="tablist" aria-label={t.labels.tabs} data-testid="media-tabs">
          {(['image', 'video', 'audio'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={mode === tab} className={`tab${mode === tab ? ' active' : ''}`} onClick={() => chooseMode(tab)} data-testid={`tab-${tab}`}>
              {modeIcon(tab)}<span>{t.tabs[tab]}</span>
            </button>
          ))}
        </nav>

        <section className="composer" aria-label={t.labels.prompt}>
          <div className="prompt-icon" aria-hidden="true">{promptIcon}</div>
          <textarea className="prompt-box" value={prompt} maxLength={1000} onChange={(event) => setPrompt(event.target.value)} placeholder={t.prompt[mode]} aria-label={t.labels.prompt} data-testid="input-generation-prompt" />
          <div className="char-count" aria-live="polite" data-testid="text-character-count">{t.labels.chars(prompt.length)}</div>
        </section>

        {mode !== 'image' && (
          <section className="controls" aria-label={mode === 'video' ? `${t.duration}, ${t.ratio}, ${t.quality}` : `${t.voice}, ${t.duration}, ${t.style}`} data-testid={`${mode}-controls`}>
            {mode === 'video' ? (
              <>
                {selectField(t.duration, <Clock3 size={16} />, t.options.durationVideo, 'video-duration')}
                {selectField(t.ratio, <ImageIcon size={16} />, t.options.ratio, 'video-ratio')}
                {selectField(t.quality, <Sparkles size={16} />, t.options.quality, 'video-quality')}
              </>
            ) : (
              <>
                {selectField(t.voice, <Mic size={16} />, t.options.voice, 'audio-voice')}
                {selectField(t.duration, <Clock3 size={16} />, t.options.durationAudio, 'audio-duration')}
                {selectField(t.style, <Music2 size={17} />, t.options.style, 'audio-style')}
              </>
            )}
          </section>
        )}

        <button type="button" className="generate" onClick={() => setNotice(t.response[mode])} data-testid="button-generate">
          {generateIcon}<span>{t.generate}</span>
        </button>
        {notice && <div className="notice" role="status" aria-live="polite" data-testid="status-response">{notice}</div>}

        <section className="results" aria-label={`${t.tabs[mode]} — ${t.labels.results}`} data-testid="results-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div className={`result-tile${mode === 'audio' ? ' audio-tile' : ''}`} key={`${mode}-${index}`} data-testid={`result-tile-${mode}-${index + 1}`}>
              <div className={`result-inner${mode === 'audio' ? ' audio-inner' : ''}`} aria-label={t.empty[mode] || t.tabs.image}>
                {mode === 'image' ? <ImagePlus size={36} strokeWidth={1.5} /> : mode === 'video' ? <><SquarePlay size={34} strokeWidth={1.5} /><span className="result-message">{t.empty.video}</span></> : <><Music2 size={34} strokeWidth={1.7} /><span className="result-message">{t.empty.audio}</span></>}
              </div>
              {mode === 'audio' && audioPlayer(index + 1)}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
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
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
