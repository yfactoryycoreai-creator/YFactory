import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  BookOpenCheck,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileDiff,
  Film,
  FolderGit2,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  LoaderCircle,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  Users,
  Video,
} from 'lucide-react';
import YCodeLogo from '@/components/ycode-logo';
import {
  fetchProviderCatalog,
  type ProviderCapability,
  type ProviderSummaryItem,
} from '@/lib/providerCenterApi';
import { isRtlLanguage } from '@/lib/languages';
import './section-hubs.css';

export type SectionHubProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenChat: () => void;
};

type FeatureTile = {
  icon: ReactNode;
  title: string;
  desc: string;
};

function useSectionProviders(
  capabilities: ReadonlyArray<ProviderCapability>,
  getIdToken?: () => Promise<string>,
) {
  const [providers, setProviders] = useState<ProviderSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!getIdToken) {
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const token = await getIdToken();
        const data = await fetchProviderCatalog(token);
        if (!active) return;
        const matched = data.providers.filter(
          (p) =>
            p.role !== 'no_public_api' &&
            capabilities.some((cap) => p.capabilities.includes(cap)),
        );
        matched.sort((a, b) => {
          const aConn = a.connectionStatus === 'connected' ? 0 : 1;
          const bConn = b.connectionStatus === 'connected' ? 0 : 1;
          if (aConn !== bConn) return aConn - bConn;
          return b.modelCount - a.modelCount;
        });
        setProviders(matched);
      } catch {
        if (active) setProviders([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, capabilities.join(',')]);

  const connected = providers.filter((p) => p.connectionStatus === 'connected');
  return { providers, connected, loading };
}

function ProviderReadinessPanel({
  isAr,
  title,
  emptyMsg,
  providers,
  connectedCount,
  loading,
  onOpenProviderCenter,
}: {
  isAr: boolean;
  title: string;
  emptyMsg: string;
  providers: ProviderSummaryItem[];
  connectedCount: number;
  loading: boolean;
  onOpenProviderCenter: (providerId?: string) => void;
}) {
  return (
    <section className="hub-panel">
      <div className="hub-panel-head">
        <div>
          <h2>{title}</h2>
          <small>
            {isAr
              ? `${connectedCount} متصل من أصل ${providers.length} مزود داعم في مركز المزودين`
              : `${connectedCount} connected out of ${providers.length} supporting providers in Provider Center`}
          </small>
        </div>
        <button
          type="button"
          className="hub-btn"
          onClick={() => onOpenProviderCenter()}
        >
          <KeyRound size={15} aria-hidden="true" />
          <span>{isAr ? 'فتح مركز المزودين' : 'Open Provider Center'}</span>
        </button>
      </div>

      {loading ? (
        <div className="hub-note-box">
          <LoaderCircle className="loading-spinner" size={16} aria-hidden="true" />
          <span>{isAr ? 'جارٍ فحص المزودين المتصلين...' : 'Checking connected providers...'}</span>
        </div>
      ) : providers.length === 0 ? (
        <div className="hub-note-box">
          <span>{emptyMsg}</span>
        </div>
      ) : (
        <div className="hub-provider-chips">
          {providers.slice(0, 12).map((p) => {
            const isConn = p.connectionStatus === 'connected';
            return (
              <button
                type="button"
                key={p.id}
                className={`hub-provider-chip${isConn ? ' is-connected' : ''}`}
                onClick={() => onOpenProviderCenter(p.id)}
              >
                <span className={`hub-dot${isConn ? ' is-connected' : ''}`} aria-hidden="true" />
                <span>{p.name}</span>
                <small style={{ color: 'var(--app-secondary)' }}>
                  ({p.modelCount})
                </small>
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CodeSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
}: SectionHubProps) {
  const isRtl = isRtlLanguage(locale);
  const isAr = locale.startsWith('ar');
  const { providers, connected, loading } = useSectionProviders(['code'], getIdToken);

  const tiles: FeatureTile[] = [
    {
      icon: <FolderGit2 size={17} aria-hidden="true" />,
      title: isAr ? 'وصول محلي آمن للـ Workspace' : 'Authorized Local Workspace Access',
      desc: isAr
        ? 'يقرأ المشروع المفتوح داخل VS Code (وCursor بعد التحقق) مع استبعاد .env وnode_modules و.git افتراضياً.'
        : 'Reads only the workspace opened in VS Code (and Cursor after compatibility testing), excluding .env, node_modules, and .git by default.',
    },
    {
      icon: <FileDiff size={17} aria-hidden="true" />,
      title: isAr ? 'مراجعة Diff قبل أي تعديل' : 'Diff Review Before Every Edit',
      desc: isAr
        ? 'يعرض الملفات المتأثرة وملخص التغيير والـ Diff الكامل لقبول أو رفض كل تعديل قبل تطبيقه.'
        : 'Displays impacted files, change summaries, and clear diffs so you approve or reject every edit before applying.',
    },
    {
      icon: <Terminal size={17} aria-hidden="true" />,
      title: isAr ? 'أوامر Terminal بموافقتك' : 'Approval-Gated Local Terminal',
      desc: isAr
        ? 'ينفّذ أوامر الاختبار والبناء محلياً داخل IDE بعد موافقتك الصريحة مع عرض المخرجات وإمكانية الإيقاف.'
        : 'Runs test and build commands locally in your IDE terminal only after explicit approval, streaming real output.',
    },
    {
      icon: <ShieldCheck size={17} aria-hidden="true" />,
      title: isAr ? 'مفاتيحك مشفّرة في Provider Center' : 'Zero Keys in Extension or Workspace',
      desc: isAr
        ? 'تستخدم الإضافة جلسات ربط قصيرة العمر وتمر طلبات النماذج عبر خادم YFactory دون كشف مفاتيح API.'
        : 'Uses short-lived session tokens and routes AI calls through YFactory Backend without exposing API keys.',
    },
  ];

  return (
    <section
      className="hub-shell"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label="YFactory Code"
      data-testid="section-code"
    >
      <header className="hub-hero is-code">
        <div className="hub-hero-icon is-logo">
          <YCodeLogo size={72} showWordmark />
        </div>
        <div className="hub-hero-copy">
          <div className="hub-kicker-row">
            <span className="hub-kicker">YFactory Code</span>
            <span className="hub-status-pill">
              {isAr ? 'الدفعة 12–13: جسر IDE وإضافة VS Code' : 'Batches 12–13: IDE Bridge & VS Code Extension'}
            </span>
          </div>
          <h1>
            {isAr
              ? 'وكيل البرمجة المتصل ببيئة التطوير (IDE Agent)'
              : 'IDE-Connected AI Coding Agent'}
          </h1>
          <p>
            {isAr
              ? 'مصمّم للعمل مباشرةً على مشروعك المفتوح في VS Code عبر إضافة YFactory Code — وليس App Builder أو محرر أكواد منفصل داخل المتصفح.'
              : 'Built to work directly inside your open VS Code workspace via the official YFactory Code Extension — not an in-browser App Builder.'}
          </p>
          <div className="hub-actions-row">
            <button
              type="button"
              className="hub-btn is-primary"
              onClick={() => onOpenProviderCenter()}
            >
              <Cpu size={15} aria-hidden="true" />
              <span>{isAr ? 'اختيار نماذج البرمجة' : 'Configure Coding Models'}</span>
            </button>
            <button type="button" className="hub-btn" onClick={onOpenChat}>
              <MessageCircle size={15} aria-hidden="true" />
              <span>{isAr ? 'فتح Chat' : 'Open Chat'}</span>
            </button>
          </div>
        </div>
      </header>

      <ProviderReadinessPanel
        isAr={isAr}
        title={isAr ? 'مزودو البرمجة المتاحون في مركز المزودين' : 'Coding Providers in Provider Center'}
        emptyMsg={
          isAr
            ? 'أضف مفتاح مزود يدعم البرمجة مثل Anthropic أو OpenAI أو Gemini أو OpenRouter.'
            : 'Add a coding-capable provider key such as Anthropic, OpenAI, Gemini, or OpenRouter.'
        }
        providers={providers}
        connectedCount={connected.length}
        loading={loading}
        onOpenProviderCenter={onOpenProviderCenter}
      />

      <div className="hub-grid">
        {tiles.map((tile) => (
          <article className="hub-feature-card" key={tile.title}>
            <div className="hub-feature-head">
              <span className="hub-feature-icon">{tile.icon}</span>
              <strong>{tile.title}</strong>
            </div>
            <p>{tile.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function VideoSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
}: SectionHubProps) {
  const isRtl = isRtlLanguage(locale);
  const isAr = locale.startsWith('ar');
  const { providers, connected, loading } = useSectionProviders(
    ['video_generation', 'image_to_video'],
    getIdToken,
  );

  const tiles: FeatureTile[] = [
    {
      icon: <Film size={17} aria-hidden="true" />,
      title: isAr ? 'تحويل النص إلى فيديو (Text to Video)' : 'Text to Video',
      desc: isAr
        ? 'توليد مشاهد فيديو مباشرة من الوصف النصي باستخدام نماذج الفيديو الحقيقية فقط.'
        : 'Generate video scenes from text prompts using verified video models only.',
    },
    {
      icon: <Video size={17} aria-hidden="true" />,
      title: isAr ? 'تحويل الصورة إلى فيديو (Image to Video)' : 'Image to Video',
      desc: isAr
        ? 'تحريك صورك المولّدة أو المرفوعة إلى مقاطع سينمائية مع عرض الإعدادات المدعومة فقط لكل نموذج.'
        : 'Animate generated or uploaded images into video clips with model-accurate controls.',
    },
    {
      icon: <Layers size={17} aria-hidden="true" />,
      title: isAr ? 'نفس مفاتيح مركز المزودين' : 'Unified Provider Center Keys',
      desc: isAr
        ? 'بدون إعادة إدخال أي مفتاح — يعمل تلقائياً بمفاتيح Runway وLuma AI وfal وReplicate وغيرها.'
        : 'No duplicate API keys — automatically uses your encrypted keys from Provider Center.',
    },
    {
      icon: <CheckCircle2 size={17} aria-hidden="true" />,
      title: isAr ? 'متابعة التقدم وسجل التوليد' : 'Progress Tracking & Video History',
      desc: isAr
        ? 'تتبع حالة عمليات التوليد الطويلة مع معاينة وتنزيل وسجل كامل للنتائج.'
        : 'Track asynchronous video jobs with playback, download, and persistent generation history.',
    },
  ];

  return (
    <section
      className="hub-shell"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label="Video"
      data-testid="section-video"
    >
      <header className="hub-hero">
        <div className="hub-hero-icon">
          <Film size={32} aria-hidden="true" />
        </div>
        <div className="hub-hero-copy">
          <div className="hub-kicker-row">
            <span className="hub-kicker">{isAr ? 'استوديو الفيديو' : 'Video Studio'}</span>
            <span className="hub-status-pill is-ok">
              {isAr ? 'الدفعة القادمة (الدفعة 11)' : 'Next Up: Batch 11'}
            </span>
          </div>
          <h1>
            {isAr
              ? 'توليد الفيديو بالذكاء الاصطناعي'
              : 'AI Video Generation Workspace'}
          </h1>
          <p>
            {isAr
              ? 'مساحة متكاملة لتحويل النص أو الصور إلى فيديو مرتبطة مباشرةً بنماذج الفيديو الحقيقية ومفاتيحك في مركز المزودين.'
              : 'Dedicated Text-to-Video and Image-to-Video studio powered directly by verified video models in Provider Center.'}
          </p>
          <div className="hub-actions-row">
            <button
              type="button"
              className="hub-btn is-primary"
              onClick={() => onOpenProviderCenter()}
            >
              <KeyRound size={15} aria-hidden="true" />
              <span>{isAr ? 'تهيئة مزودي الفيديو' : 'Configure Video Providers'}</span>
            </button>
            <button type="button" className="hub-btn" onClick={onOpenChat}>
              <MessageCircle size={15} aria-hidden="true" />
              <span>{isAr ? 'الانتقال إلى Chat' : 'Go to Chat'}</span>
            </button>
          </div>
        </div>
      </header>

      <ProviderReadinessPanel
        isAr={isAr}
        title={isAr ? 'مزودو الفيديو المسجلون في مركز المزودين' : 'Video Providers in Provider Center'}
        emptyMsg={
          isAr
            ? 'أضف مفتاح مزود فيديو مثل Runway أو Luma AI أو fal أو Google.'
            : 'Add a video provider key such as Runway, Luma AI, fal, or Google.'
        }
        providers={providers}
        connectedCount={connected.length}
        loading={loading}
        onOpenProviderCenter={onOpenProviderCenter}
      />

      <div className="hub-grid">
        {tiles.map((tile) => (
          <article className="hub-feature-card" key={tile.title}>
            <div className="hub-feature-head">
              <span className="hub-feature-icon">{tile.icon}</span>
              <strong>{tile.title}</strong>
            </div>
            <p>{tile.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function StudentsSectionHub({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
}: SectionHubProps) {
  const isRtl = isRtlLanguage(locale);
  const isAr = locale.startsWith('ar');
  const { providers, connected, loading } = useSectionProviders(
    ['chat', 'image_understanding'],
    getIdToken,
  );

  const tiles: FeatureTile[] = [
    {
      icon: <Camera size={17} aria-hidden="true" />,
      title: isAr ? 'تحليل صور الامتحانات والدروس' : 'Exam & Lesson Photo Analysis',
      desc: isAr
        ? 'تصوير امتحان أو صفحة كتاب لاستخراج الأسئلة والمادة والمفاهيم مع إمكانية تعديل النص المستخرج.'
        : 'Snap an exam or textbook page to extract ordered questions, subjects, and key concepts with editable OCR/Vision text.',
    },
    {
      icon: <Globe size={17} aria-hidden="true" />,
      title: isAr ? 'البحث التعليمي والتعلم البصري' : 'Intelligent Web Research & Visual Engine',
      desc: isAr
        ? 'شروحات ومخططات وخرائط ومصادر موثوقة مرتبطة بكل درس، مع توضيح أي رسم مولد بالذكاء الاصطناعي.'
        : 'Curated explanations, diagrams, maps, and verified sources per lesson, clearly labeling any AI-generated diagram.',
    },
    {
      icon: <BookOpenCheck size={17} aria-hidden="true" />,
      title: isAr ? 'المدرس الذكي (AI Teacher)' : 'Interactive AI Teacher',
      desc: isAr
        ? 'تقسيم الدرس إلى خطوات واضحة بمستوى الطالب مع أمثلة ومصطلحات وإعادة شرح تفاعلية.'
        : 'Step-by-step visual lessons tailored to the student level with definitions, examples, and Q&A.',
    },
    {
      icon: <ClipboardCheck size={17} aria-hidden="true" />,
      title: isAr ? 'امتحانات تفاعلية وتعلم تكيّفي' : 'Real Interactive Exams & Adaptive Mastery',
      desc: isAr
        ? '6 أنواع أسئلة، وضع امتحان حقيقي ووضع تدريب، مع إعادة الشرح التلقائي للمواضيع التي أخطأ بها الطالب.'
        : 'Six question types with Exam & Practice modes, automatic weakness tracking, and targeted re-testing.',
    },
    {
      icon: <TrendingUp size={17} aria-hidden="true" />,
      title: isAr ? 'تتبع التقدم والمستوى' : 'Student Progress Dashboard',
      desc: isAr
        ? 'متابعة الدروس المدروسة ومتوسط الدرجات والمواضيع المتقنة والمواضيع التي تحتاج مراجعة.'
        : 'Track lessons completed, quiz averages, mastered topics, and personalized next-step recommendations.',
    },
    {
      icon: <Users size={17} aria-hidden="true" />,
      title: isAr ? 'مجتمع الطلاب الآمن' : 'Moderated Student Community',
      desc: isAr
        ? 'مشاركة الملخصات والامتحانات والأسئلة حسب المادة والمستوى مع حماية الخصوصية وأدوات الإبلاغ.'
        : 'Share summaries, exams, and study questions by subject and level with strict privacy and reporting controls.',
    },
  ];

  return (
    <section
      className="hub-shell"
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label="Students"
      data-testid="section-students"
    >
      <header className="hub-hero">
        <div className="hub-hero-icon">
          <GraduationCap size={32} aria-hidden="true" />
        </div>
        <div className="hub-hero-copy">
          <div className="hub-kicker-row">
            <span className="hub-kicker">
              <Sparkles size={12} aria-hidden="true" />
              {isAr ? 'منصة الطلاب الذكية' : 'Students AI Learning'}
            </span>
            <span className="hub-status-pill">
              {isAr ? 'الدفعة 16–17: التعلم البصري والامتحانات والمجتمع' : 'Batches 16–17: Visual Learning, Exams & Community'}
            </span>
          </div>
          <h1>
            {isAr
              ? 'التعلم البصري والمدرس الذكي والامتحانات التفاعلية'
              : 'Visual Education, AI Teacher & Real Exams'}
          </h1>
          <p>
            {isAr
              ? 'صوّر امتحانك أو درسك ليفهم النظام محتواه، ويبحث عن الشروحات والصور والمخططات المرتبطة به، ويشرحه ويختبرك ويتابع تطورك.'
              : 'Photograph an exam or lesson so YFactory extracts topics, researches verified visuals, teaches interactively, tests mastery, and tracks progress.'}
          </p>
          <div className="hub-actions-row">
            <button
              type="button"
              className="hub-btn is-primary"
              onClick={onOpenChat}
            >
              <MessageCircle size={15} aria-hidden="true" />
              <span>{isAr ? 'اسأل المساعد الآن في Chat' : 'Study in Chat Now'}</span>
            </button>
            <button
              type="button"
              className="hub-btn"
              onClick={() => onOpenProviderCenter()}
            >
              <KeyRound size={15} aria-hidden="true" />
              <span>{isAr ? 'إدارة نماذج الرؤية والشرح' : 'Manage Vision & Chat Models'}</span>
            </button>
          </div>
        </div>
      </header>

      <ProviderReadinessPanel
        isAr={isAr}
        title={isAr ? 'مزودو الرؤية والشرح المتاحون' : 'Vision & Teaching Providers Ready'}
        emptyMsg={
          isAr
            ? 'أضف مفتاح مزود يدعم الرؤية مثل Gemini أو OpenAI أو Anthropic لتحليل صور الامتحانات.'
            : 'Add a vision-capable provider key such as Gemini, OpenAI, or Anthropic for exam photo analysis.'
        }
        providers={providers}
        connectedCount={connected.length}
        loading={loading}
        onOpenProviderCenter={onOpenProviderCenter}
      />

      <div className="hub-grid">
        {tiles.map((tile) => (
          <article className="hub-feature-card" key={tile.title}>
            <div className="hub-feature-head">
              <span className="hub-feature-icon">{tile.icon}</span>
              <strong>{tile.title}</strong>
            </div>
            <p>{tile.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
