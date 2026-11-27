import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  ShieldAlert,
  Sparkles,
  Unlink,
} from "lucide-react";
import AppSelect from "@/components/app-select";
import {
  applySkillsToMotionPrompt,
  useYFactorySkills,
} from "@/lib/skillsStore";
import {
  BookApiError,
  fetchStoryBookAssets,
  type StoryAssetImage,
} from "@/lib/bookApi";
import { isRtlLanguage } from "@/lib/languages";
import { subscribeToStories, type StoryRecord } from "@/lib/stories";
import "./higgsfield-connector.css";

type HiggsfieldConnectorProps = {
  uid: string;
  locale: string;
  initialStory: StoryRecord | null;
  getIdToken: () => Promise<string>;
};

type MotionPreset = {
  id: string;
  labelEn: string;
  labelAr: string;
  directive: string;
};

const MOTION_PRESETS: ReadonlyArray<MotionPreset> = [
  {
    id: "dolly_in",
    labelEn: "Slow Dolly In",
    labelAr: "تقرّب سينمائي بطيء",
    directive:
      "Slow cinematic dolly-in toward the main subject, subtle breathing and cloth motion, natural depth of field, smooth 24fps film motion.",
  },
  {
    id: "orbit_360",
    labelEn: "Cinematic Orbit",
    labelAr: "دوران كاميرا حول المشهد",
    directive:
      "Smooth 180-degree cinematic camera orbit around the subject, parallax background shift, volumetric light rays moving naturally.",
  },
  {
    id: "crane_up",
    labelEn: "Crane Up Reveal",
    labelAr: "ارتفاع كرين كاشف للمشهد",
    directive:
      "Sweeping crane-up camera reveal rising gracefully to expose the wider environment, atmospheric particles drifting softly.",
  },
  {
    id: "handheld_track",
    labelEn: "Handheld Tracking",
    labelAr: "تتبّع سينمائي باليد",
    directive:
      "Dynamic handheld tracking shot following the character forward, realistic micro-camera sway, expressive facial motion.",
  },
  {
    id: "crash_zoom",
    labelEn: "Dramatic Crash Zoom",
    labelAr: "زوم درامي سريع",
    directive:
      "High-impact dramatic push-in zoom locking onto the subject's eyes with heightened tension and crisp cinematic focus.",
  },
  {
    id: "atmospheric",
    labelEn: "Subtle Living Frame",
    labelAr: "حركة هادئة وطبيعية",
    directive:
      "Locked-off poetic tripod shot with gentle wind in hair and foliage, flickering ambient light, ultra-stable character identity.",
  },
];

type MotionIntensity = "subtle" | "cinematic" | "dynamic";

type StoredHiggsfieldLink = {
  connected: boolean;
  accountLabel: string;
  apiKeyLocal: string;
  acceptedResponsibility: boolean;
  connectedAt: number;
};

const HF_STORAGE_PREFIX = "yfactory.connector.higgsfield.v1.";
const HIGGSFIELD_STUDIO_URL = "https://higgsfield.ai/create/video";
const HIGGSFIELD_CLOUD_URL = "https://cloud.higgsfield.ai";

function readLink(uid: string): StoredHiggsfieldLink {
  const empty: StoredHiggsfieldLink = {
    connected: false,
    accountLabel: "",
    apiKeyLocal: "",
    acceptedResponsibility: false,
    connectedAt: 0,
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(`${HF_STORAGE_PREFIX}${uid}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<StoredHiggsfieldLink>;
    return {
      connected: parsed.connected === true,
      accountLabel: typeof parsed.accountLabel === "string" ? parsed.accountLabel : "",
      apiKeyLocal: typeof parsed.apiKeyLocal === "string" ? parsed.apiKeyLocal : "",
      acceptedResponsibility: parsed.acceptedResponsibility === true,
      connectedAt: typeof parsed.connectedAt === "number" ? parsed.connectedAt : 0,
    };
  } catch {
    return empty;
  }
}

function writeLink(uid: string, value: StoredHiggsfieldLink): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${HF_STORAGE_PREFIX}${uid}`,
      JSON.stringify(value),
    );
  } catch {
    // ignore storage errors
  }
}

function cleanScenePrompt(raw: string): string {
  return raw
    .replace(/^Character traits to keep consistent:[^\n.]*[\n.]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "موصّل Higgsfield للقصص (My Stories → Higgsfield)",
      subtitle:
        "اربط حسابك الشخصي في Higgsfield مباشرةً بمشاهد قصصك: نجهّز لك صورة المشهد وأوامر حركة الكاميرا السينمائية هنا بدون أي عبء على خوادم YFactory، وتكمل التوليد مباشرةً على حسابك في Higgsfield.",
      statusConnected: "حسابك مربوط بـ Higgsfield",
      statusDisconnected: "غير مربوط بعد",
      disclaimerTitle: "إقرار المسؤولية الكاملة للمستخدم (شفافية واضحة)",
      disclaimerBody:
        "جميع تكاليف الفيديو والأرصدة وسياسات الاستخدام والمخرجات تتم مباشرةً بينك وبين حسابك الشخصي في Higgsfield. تطبيق YFactory لا يستهلك خوادمه لتوليد الفيديو ولا يخزّن مفاتيح Higgsfield على خوادمه؛ بل يحفظ رابط حسابك محلياً على جهازك فقط.",
      acceptCheck:
        "أوافق وأتحمل المسؤولية الكاملة عن ربط واستخدام حسابي وأرصدتي مع منصة Higgsfield.",
      accountLbl: "اسم حسابك / بريدك التعريفي في Higgsfield (للتمييز محلياً)",
      accountPh: "مثلاً: @username أو اسم مساحتك في Higgsfield",
      apiOptLbl: "مفتاح Higgsfield API (اختياري — يُحفظ محلياً على جهازك فقط)",
      apiOptPh: "اختياري لمشتركي Higgsfield Cloud API...",
      connectBtn: "ربط حسابي بـ Higgsfield",
      disconnectBtn: "فصل الربط",
      openCloud: "بوابة Higgsfield Cloud",
      pickStoryLbl: "اختر قصة من قصصي (My Stories)",
      pickStoryPh: "— اختر قصة لتحريك مشاهدها في Higgsfield —",
      loadingScenes: "جارٍ جلب مشاهد القصة...",
      noScenes: "هذه القصة لا تحتوي على صور مشاهد بعد. ولّد مشاهدها من تبويب قصصي أولاً.",
      scenesTitle: (n: number) => `مشاهد القصة (${n}) — اختر مشهداً للتحريك`,
      motionPresetLbl: "حركة الكاميرا (Higgsfield Motion Preset)",
      intensityLbl: "قوة الحركة",
      intensities: {
        subtle: "هادئة (Subtle)",
        cinematic: "سينمائية متوازنة (Cinematic)",
        dynamic: "حركية قوية (Dynamic)",
      } as Record<MotionIntensity, string>,
      extraMotionLbl: "تفاصيل حركة إضافية (اختياري)",
      extraMotionPh: "مثلاً: الشخصية تلتفت نحو الكاميرا وتبتسم، تساقط ثلج خفيف...",
      promptOutLbl: "أمر التحريك الجاهز لـ Higgsfield (Image-to-Video Prompt)",
      downloadScene: "1. تنزيل صورة المشهد",
      copyAndOpen: "2. نسخ الأمر وفتح Higgsfield",
      copyPromptOnly: "نسخ الأمر فقط",
      copyAllPack: "نسخ حزمة أوامر القصة كاملة",
      copiedOk: "تم النسخ بنجاح!",
      openedHiggsfield:
        "تم نسخ أمر التحريك وفتح Higgsfield في نافذة جديدة — ارفع صورة المشهد والصق الأمر مباشرةً على حسابك.",
      downloadedOk: "تم تنزيل صورة المشهد بجودتها الأصلية.",
      mustAcceptErr: "يرجى تفعيل مربع إقرار المسؤولية أولاً قبل ربط حسابك بـ Higgsfield.",
      sceneLabel: (i: number) => `مشهد #${i}`,
    };
  }
  return {
    title: "Higgsfield Connector (My Stories → Higgsfield)",
    subtitle:
      "Connect your personal Higgsfield account directly to your My Stories scenes. YFactory prepares your scene frame and cinematic camera prompt locally with zero video load on YFactory servers.",
    statusConnected: "Linked to Higgsfield",
    statusDisconnected: "Not Connected",
    disclaimerTitle: "User Responsibility & Direct Account Ownership",
    disclaimerBody:
      "All video rendering, credits, billing, and content policies are strictly between you and your own Higgsfield account. YFactory runs zero video compute on its servers and keeps your optional link details locally on your device.",
    acceptCheck:
      "I acknowledge and accept full responsibility for connecting and using my own Higgsfield account and credits.",
    accountLbl: "Your Higgsfield Handle / Workspace Label (local reference)",
    accountPh: "e.g. @creator or your Higgsfield workspace name",
    apiOptLbl: "Optional Higgsfield API Key (stored locally on your device only)",
    apiOptPh: "Optional for Higgsfield Cloud API subscribers...",
    connectBtn: "Connect My Higgsfield Account",
    disconnectBtn: "Disconnect",
    openCloud: "Higgsfield Cloud Portal",
    pickStoryLbl: "Select a Story from My Stories",
    pickStoryPh: "— Choose a story to animate in Higgsfield —",
    loadingScenes: "Loading story scenes...",
    noScenes: "This story has no generated scene images yet. Render scenes in My Stories first.",
    scenesTitle: (n: number) => `Story Scenes (${n}) — Pick a scene to animate`,
    motionPresetLbl: "Camera Motion Preset (Higgsfield)",
    intensityLbl: "Motion Intensity",
    intensities: {
      subtle: "Subtle",
      cinematic: "Balanced Cinematic",
      dynamic: "Dynamic Action",
    } as Record<MotionIntensity, string>,
    extraMotionLbl: "Extra Action / Motion Cue (optional)",
    extraMotionPh: "e.g. Character turns toward camera, wind blows cloak, sparks rising...",
    promptOutLbl: "Ready-to-Use Higgsfield Image-to-Video Prompt",
    downloadScene: "1. Download Scene Image",
    copyAndOpen: "2. Copy Prompt & Open Higgsfield",
    copyPromptOnly: "Copy Prompt",
    copyAllPack: "Copy Full Story Prompt Pack",
    copiedOk: "Copied to clipboard!",
    openedHiggsfield:
      "Motion prompt copied & Higgsfield opened — upload your scene image and paste the prompt in your Higgsfield account.",
    downloadedOk: "Scene image downloaded in original quality.",
    mustAcceptErr: "Please confirm the user responsibility checkbox before connecting.",
    sceneLabel: (i: number) => `Scene #${i}`,
  };
}

export default function HiggsfieldConnector({
  uid,
  locale,
  initialStory,
  getIdToken,
}: HiggsfieldConnectorProps) {
  const isRtl = isRtlLanguage(locale);
  const isAr = locale.startsWith("ar");
  const ui = getCopy(locale);
  const { activeIds: activeSkillIds } = useYFactorySkills(getIdToken);

  const [link, setLink] = useState<StoredHiggsfieldLink>(() => readLink(uid));
  const [accountInput, setAccountInput] = useState(link.accountLabel);
  const [apiKeyInput, setApiKeyInput] = useState(link.apiKeyLocal);
  const [accepted, setAccepted] = useState(link.acceptedResponsibility);

  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState(initialStory?.id ?? "");
  const [storyImages, setStoryImages] = useState<StoryAssetImage[]>([]);
  const [loadingScenes, setLoadingScenes] = useState(false);

  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [motionPresetId, setMotionPresetId] = useState<string>(MOTION_PRESETS[0]!.id);
  const [intensity, setIntensity] = useState<MotionIntensity>("cinematic");
  const [extraCue, setExtraCue] = useState("");
  const [downloading, setDownloading] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribeToStories(
      uid,
      (items) => setStories(items),
      () => setStories([]),
    );
    return () => unsub();
  }, [uid]);

  const loadStoryScenes = useCallback(
    async (storyId: string) => {
      if (!storyId) {
        setStoryImages([]);
        setSelectedSceneId("");
        return;
      }
      setLoadingScenes(true);
      setError("");
      try {
        const tok = await getIdToken();
        const assets = await fetchStoryBookAssets(tok, storyId);
        setStoryImages(assets.images);
        setSelectedSceneId(assets.images[0]?.id ?? "");
      } catch (err) {
        setError(
          err instanceof BookApiError
            ? err.message
            : "Could not load story scene images.",
        );
      } finally {
        setLoadingScenes(false);
      }
    },
    [getIdToken],
  );

  useEffect(() => {
    if (selectedStoryId) {
      void loadStoryScenes(selectedStoryId);
    }
  }, [selectedStoryId, loadStoryScenes]);

  useEffect(() => {
    if (!selectedStoryId && initialStory?.id) {
      setSelectedStoryId(initialStory.id);
    }
  }, [initialStory?.id, selectedStoryId]);

  const selectedScene = useMemo(
    () => storyImages.find((img) => img.id === selectedSceneId) ?? storyImages[0] ?? null,
    [storyImages, selectedSceneId],
  );

  const selectedPreset = useMemo(
    () => MOTION_PRESETS.find((p) => p.id === motionPresetId) ?? MOTION_PRESETS[0]!,
    [motionPresetId],
  );

  const buildMotionPrompt = useCallback(
    (scene: StoryAssetImage | null) => {
      const base = scene ? cleanScenePrompt(scene.prompt) : "";
      const intensityPhrase =
        intensity === "subtle"
          ? "Subtle, controlled motion preserving exact character face and composition."
          : intensity === "dynamic"
            ? "Expressive, high-energy cinematic movement with dramatic lighting transitions."
            : "Smooth, balanced film-grade motion with consistent character appearance.";
      const basePrompt = [
        base ? `Scene: ${base}` : "",
        `Camera & Motion: ${selectedPreset.directive}`,
        intensityPhrase,
        extraCue.trim() ? `Action Cue: ${extraCue.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return applySkillsToMotionPrompt(basePrompt);
    },
    // activeSkillIds ensures generated prompt updates live when Skills toggle
    [intensity, selectedPreset, extraCue, activeSkillIds],
  );

  const generatedPrompt = useMemo(
    () => buildMotionPrompt(selectedScene),
    [buildMotionPrompt, selectedScene],
  );

  const handleConnect = () => {
    setError("");
    setNotice("");
    if (!accepted) {
      setError(ui.mustAcceptErr);
      return;
    }
    const next: StoredHiggsfieldLink = {
      connected: true,
      accountLabel: accountInput.trim() || "My Higgsfield Account",
      apiKeyLocal: apiKeyInput.trim(),
      acceptedResponsibility: true,
      connectedAt: Date.now(),
    };
    setLink(next);
    writeLink(uid, next);
    setNotice(ui.statusConnected);
  };

  const handleDisconnect = () => {
    const cleared: StoredHiggsfieldLink = {
      connected: false,
      accountLabel: "",
      apiKeyLocal: "",
      acceptedResponsibility: false,
      connectedAt: 0,
    };
    setLink(cleared);
    setAccountInput("");
    setApiKeyInput("");
    setAccepted(false);
    writeLink(uid, cleared);
    setNotice("");
  };

  const handleDownloadScene = async () => {
    if (!selectedScene || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const resp = await fetch(selectedScene.url);
      if (!resp.ok) throw new Error("download_failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      a.download = `yfactory-higgsfield-scene.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(ui.downloadedOk);
    } catch {
      window.open(selectedScene.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyAndOpenHiggsfield = async () => {
    if (!link.connected) {
      setError(ui.mustAcceptErr);
      return;
    }
    setError("");
    try {
      await navigator.clipboard.writeText(generatedPrompt);
    } catch {
      // Clipboard may be restricted on some mobile contexts; still open Higgsfield.
    }
    window.open(HIGGSFIELD_STUDIO_URL, "_blank", "noopener,noreferrer");
    setNotice(ui.openedHiggsfield);
  };

  const handleCopyPromptOnly = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setNotice(ui.copiedOk);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const handleCopyFullStoryPack = async () => {
    if (storyImages.length === 0) return;
    const pack = storyImages
      .map((img, i) => `=== ${ui.sceneLabel(i + 1)} ===\n${buildMotionPrompt(img)}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(pack);
      setNotice(ui.copiedOk);
    } catch {
      setError("Could not copy story pack.");
    }
  };

  return (
    <section
      className="hf-root"
      dir={isRtl ? "rtl" : "ltr"}
      aria-label={ui.title}
      data-testid="higgsfield-connector"
    >
      {/* Card 1: Connection & User Responsibility Agreement */}
      <div className="hf-card is-accent">
        <div className="hf-head-row">
          <div className="hf-title-block">
            <span className="hf-icon-box" aria-hidden="true">
              <Clapperboard size={21} />
            </span>
            <div>
              <h2>{ui.title}</h2>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          <span className={`hf-pill ${link.connected ? "is-ok" : "is-gold"}`}>
            {link.connected ? <CheckCircle2 size={12} /> : <Link2 size={12} />}
            <span>
              {link.connected
                ? `${ui.statusConnected}${link.accountLabel ? ` · ${link.accountLabel}` : ""}`
                : ui.statusDisconnected}
            </span>
          </span>
        </div>

        <div className="hf-disclaimer">
          <div className="hf-row" style={{ fontWeight: 660 }}>
            <ShieldAlert size={16} aria-hidden="true" />
            <span>{ui.disclaimerTitle}</span>
          </div>
          <span>{ui.disclaimerBody}</span>
          {!link.connected && (
            <label className="hf-check-row">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.currentTarget.checked)}
                data-testid="checkbox-higgsfield-responsibility"
              />
              <span>{ui.acceptCheck}</span>
            </label>
          )}
        </div>

        {!link.connected ? (
          <>
            <div className="hf-grid-2">
              <div className="hf-field">
                <label htmlFor="hf-account">{ui.accountLbl}</label>
                <input
                  id="hf-account"
                  className="hf-input"
                  dir="auto"
                  maxLength={80}
                  placeholder={ui.accountPh}
                  value={accountInput}
                  onChange={(e) => setAccountInput(e.currentTarget.value)}
                />
              </div>
              <div className="hf-field">
                <label htmlFor="hf-api-key">{ui.apiOptLbl}</label>
                <input
                  id="hf-api-key"
                  className="hf-input"
                  type="password"
                  dir="ltr"
                  maxLength={200}
                  placeholder={ui.apiOptPh}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.currentTarget.value)}
                />
              </div>
            </div>
            <div className="hf-row">
              <button
                type="button"
                className="hf-btn is-primary"
                onClick={handleConnect}
                data-testid="button-higgsfield-connect"
              >
                <Link2 size={15} />
                <span>{ui.connectBtn}</span>
              </button>
              <a
                className="hf-btn"
                href={HIGGSFIELD_CLOUD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <KeyRound size={14} />
                <span>{ui.openCloud}</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </>
        ) : (
          <div className="hf-row">
            <a
              className="hf-btn is-primary"
              href={HIGGSFIELD_STUDIO_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              <span>Higgsfield Studio</span>
            </a>
            <a
              className="hf-btn"
              href={HIGGSFIELD_CLOUD_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <KeyRound size={14} />
              <span>{ui.openCloud}</span>
            </a>
            <button
              type="button"
              className="hf-btn is-danger"
              onClick={handleDisconnect}
              data-testid="button-higgsfield-disconnect"
            >
              <Unlink size={14} />
              <span>{ui.disconnectBtn}</span>
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="hf-notice-ok" role="status">
          <Check size={15} />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="hf-notice-err" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Card 2: Story & Scene Motion Handoff */}
      <div className="hf-card">
        <div className="hf-field">
          <label htmlFor="hf-story-select">{ui.pickStoryLbl}</label>
          <AppSelect
            id="hf-story-select"
            title={ui.pickStoryLbl}
            value={selectedStoryId}
            placeholder={ui.pickStoryPh}
            dir={isRtl ? "rtl" : "ltr"}
            options={stories.map((st) => ({
              value: st.id,
              label: st.storyName,
              badge: `${st.imageCount}`,
            }))}
            onChange={setSelectedStoryId}
          />
        </div>

        {loadingScenes ? (
          <div className="hf-row" style={{ padding: "14px 0", justifyContent: "center" }}>
            <LoaderCircle className="loading-spinner" size={18} />
            <span style={{ fontSize: 13, color: "var(--app-secondary)" }}>
              {ui.loadingScenes}
            </span>
          </div>
        ) : selectedStoryId && storyImages.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--app-secondary)" }}>
            {ui.noScenes}
          </p>
        ) : storyImages.length > 0 ? (
          <>
            <div className="hf-head-row">
              <strong style={{ fontSize: 13.5 }}>
                {ui.scenesTitle(storyImages.length)}
              </strong>
              <button
                type="button"
                className="hf-btn"
                onClick={() => void handleCopyFullStoryPack()}
              >
                <Copy size={13} />
                <span>{ui.copyAllPack}</span>
              </button>
            </div>

            <div className="hf-scenes-grid">
              {storyImages.map((img, i) => {
                const isSel = img.id === selectedScene?.id;
                return (
                  <button
                    key={img.id}
                    type="button"
                    className={`hf-scene-tile${isSel ? " is-selected" : ""}`}
                    onClick={() => setSelectedSceneId(img.id)}
                  >
                    <img src={img.url} alt="" loading="lazy" />
                    <strong>{ui.sceneLabel(i + 1)}</strong>
                    <small dir="auto">{cleanScenePrompt(img.prompt) || "—"}</small>
                  </button>
                );
              })}
            </div>

            <div className="hf-field">
              <label>{ui.motionPresetLbl}</label>
              <div className="hf-motion-chips">
                {MOTION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`hf-chip${motionPresetId === preset.id ? " is-active" : ""}`}
                    onClick={() => setMotionPresetId(preset.id)}
                  >
                    <Sparkles size={12} />
                    <span>{isAr ? preset.labelAr : preset.labelEn}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="hf-grid-2">
              <div className="hf-field">
                <label>{ui.intensityLbl}</label>
                <AppSelect
                  title={ui.intensityLbl}
                  value={intensity}
                  dir={isRtl ? "rtl" : "ltr"}
                  options={(Object.keys(ui.intensities) as MotionIntensity[]).map((k) => ({
                    value: k,
                    label: ui.intensities[k],
                  }))}
                  onChange={(v) => setIntensity(v as MotionIntensity)}
                />
              </div>
              <div className="hf-field">
                <label htmlFor="hf-extra-cue">{ui.extraMotionLbl}</label>
                <input
                  id="hf-extra-cue"
                  className="hf-input"
                  dir="auto"
                  maxLength={240}
                  placeholder={ui.extraMotionPh}
                  value={extraCue}
                  onChange={(e) => setExtraCue(e.currentTarget.value)}
                />
              </div>
            </div>

            {selectedScene && (
              <div className="hf-preview-split">
                <img
                  className="hf-preview-img"
                  src={selectedScene.url}
                  alt=""
                />
                <div className="hf-field">
                  <label htmlFor="hf-prompt-out">{ui.promptOutLbl}</label>
                  <textarea
                    id="hf-prompt-out"
                    className="hf-textarea"
                    readOnly
                    dir="auto"
                    value={generatedPrompt}
                  />
                  <div className="hf-row" style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="hf-btn"
                      disabled={downloading}
                      onClick={() => void handleDownloadScene()}
                      data-testid="button-higgsfield-download-scene"
                    >
                      {downloading ? (
                        <LoaderCircle className="loading-spinner" size={14} />
                      ) : (
                        <Download size={14} />
                      )}
                      <span>{ui.downloadScene}</span>
                    </button>
                    <button
                      type="button"
                      className="hf-btn is-primary"
                      onClick={() => void handleCopyAndOpenHiggsfield()}
                      data-testid="button-higgsfield-handoff"
                    >
                      <ExternalLink size={14} />
                      <span>{ui.copyAndOpen}</span>
                    </button>
                    <button
                      type="button"
                      className="hf-btn"
                      onClick={() => void handleCopyPromptOnly()}
                    >
                      <Copy size={14} />
                      <span>{ui.copyPromptOnly}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}