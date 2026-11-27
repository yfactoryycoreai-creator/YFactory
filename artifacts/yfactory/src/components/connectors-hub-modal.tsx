import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  Puzzle,
  ShieldCheck,
  Terminal,
  Triangle,
  Unlink,
  X,
} from "lucide-react";
import { isRtlLanguage } from "@/lib/languages";
import {
  testCloudflareConnection,
  testSupabaseConnection,
  testVercelConnection,
  useDevConnectors,
  verifyGitHubToken,
} from "@/lib/connectorsStore";
import "./connectors-hub.css";

type ConnectorsHubModalProps = {
  open: boolean;
  locale: string;
  onClose: () => void;
  onOpenCodeTab?: () => void;
};

const IDE_BRIDGES = [
  { name: "Replit Shell", mode: "yfactory-code.mjs CLI" },
  { name: "VS Code", mode: "Extension + CLI" },
  { name: "Cursor", mode: ".vsix + CLI" },
  { name: "Windsurf", mode: ".vsix + CLI" },
  { name: "GitHub Codespaces", mode: "CLI + Extension" },
  { name: "JetBrains IDEs", mode: "Terminal CLI" },
  { name: "Termux (Android)", mode: "Zero-Dep Node CLI" },
  { name: "Firebase Studio", mode: ".vsix + CLI" },
];

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "مركز الموصّلات وبيئات التطوير (Connectors Hub)",
      subtitle:
        "اربط GitHub وVercel وCloudflare وSupabase وبيئات البرمجة مباشرةً بحسابك. تُحفظ مفاتيح الربط محلياً على جهازك فقط بدون أي عبء على خوادم YFactory.",
      privacyNote:
        "ملكية ومسؤولية مباشرة: جميع اتصالات GitHub وVercel وCloudflare وSupabase تتم مباشرةً من متصفحك إلى حساباتك ولا تُخزَّن على خوادم YFactory.",
      injectChat: "تضمين حالة الموصّلات المتصلة في سياق الشات تلقائياً",
      connected: "متصل",
      notConnected: "غير متصل",
      connectBtn: "فحص وربط",
      disconnect: "فصل",
      openCodeAgent: "فتح وكيل GitHub وCLI في تبويب البرمجة",
      ghTokenPh: "ألصق GitHub Personal Access Token (ghp_... أو github_pat_...)",
      ghHelp: "إنشاء توكن GitHub (صلاحية repo)",
      vcTokenPh: "ألصق Vercel API Token...",
      vcTeamPh: "Team ID (اختياري)...",
      cfTokenPh: "ألصق Cloudflare API Token...",
      sbUrlPh: "https://your-ref.supabase.co",
      sbKeyPh: "ألصق Supabase Anon / Publishable Key...",
      idesTitle: "بيئات التطوير والطرفيات المدعومة (عبر YFactory Code CLI و.vsix)",
    };
  }
  return {
    title: "Dev Connectors Hub",
    subtitle:
      "Connect GitHub, Vercel, Cloudflare, Supabase, and IDEs directly to your account. Tokens stay locally on your device with zero server load.",
    privacyNote:
      "Direct User Ownership: Connections to GitHub, Vercel, Cloudflare, and Supabase run straight from your browser to your accounts and are never stored on YFactory servers.",
    injectChat: "Include connected environments in Chat AI context automatically",
    connected: "Connected",
    notConnected: "Not Connected",
    connectBtn: "Verify & Connect",
    disconnect: "Disconnect",
    openCodeAgent: "Open GitHub & CLI Agent in Code Tab",
    ghTokenPh: "Paste GitHub Personal Access Token (ghp_... or github_pat_...)",
    ghHelp: "Create GitHub Token (repo scope)",
    vcTokenPh: "Paste Vercel API Token...",
    vcTeamPh: "Team ID (optional)...",
    cfTokenPh: "Paste Cloudflare API Token...",
    sbUrlPh: "https://your-ref.supabase.co",
    sbKeyPh: "Paste Supabase Anon / Publishable Key...",
    idesTitle: "Supported IDEs & Terminals (via YFactory Code CLI & .vsix)",
  };
}

export function ConnectorsHubContent({
  locale,
  onOpenCodeTab,
}: {
  locale: string;
  onOpenCodeTab?: () => void;
}) {
  const ui = getCopy(locale);
  const { state, update } = useDevConnectors();

  const [ghToken, setGhToken] = useState("");
  const [vcToken, setVcToken] = useState("");
  const [vcTeam, setVcTeam] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [sbUrl, setSbUrl] = useState("");
  const [sbKey, setSbKey] = useState("");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const connectGitHub = async () => {
    if (!ghToken.trim() || busyId) return;
    setBusyId("github");
    setError("");
    setNotice("");
    try {
      const info = await verifyGitHubToken(ghToken.trim());
      update((cur) => ({
        ...cur,
        github: {
          token: ghToken.trim(),
          username: info.username,
          selectedRepo: cur.github?.selectedRepo || "",
          selectedBranch: cur.github?.selectedBranch || "main",
          connectedAt: Date.now(),
        },
      }));
      setGhToken("");
      setNotice(`GitHub connected as @${info.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "GitHub connection failed.");
    } finally {
      setBusyId(null);
    }
  };

  const connectVercel = async () => {
    if (!vcToken.trim() || busyId) return;
    setBusyId("vercel");
    setError("");
    setNotice("");
    try {
      const info = await testVercelConnection(vcToken.trim(), vcTeam.trim());
      update((cur) => ({
        ...cur,
        vercel: {
          token: vcToken.trim(),
          teamId: vcTeam.trim(),
          accountLabel: info.accountLabel,
          lastSummary: info.summary,
          connectedAt: Date.now(),
        },
      }));
      setVcToken("");
      setNotice(`Vercel: ${info.summary}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vercel connection failed.");
    } finally {
      setBusyId(null);
    }
  };

  const connectCloudflare = async () => {
    if (!cfToken.trim() || busyId) return;
    setBusyId("cloudflare");
    setError("");
    setNotice("");
    try {
      const info = await testCloudflareConnection(cfToken.trim());
      update((cur) => ({
        ...cur,
        cloudflare: {
          token: cfToken.trim(),
          accountId: "",
          accountLabel: info.accountLabel,
          lastSummary: info.summary,
          connectedAt: Date.now(),
        },
      }));
      setCfToken("");
      setNotice(info.summary);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Cloudflare connection failed.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const connectSupabase = async () => {
    if (!sbUrl.trim() || !sbKey.trim() || busyId) return;
    setBusyId("supabase");
    setError("");
    setNotice("");
    try {
      const info = await testSupabaseConnection(sbUrl.trim(), sbKey.trim());
      update((cur) => ({
        ...cur,
        supabase: {
          projectUrl: sbUrl.trim().replace(/\/+$/, ""),
          apiKey: sbKey.trim(),
          projectLabel: info.projectLabel,
          lastSummary: info.summary,
          connectedAt: Date.now(),
        },
      }));
      setSbKey("");
      setNotice(info.summary);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Supabase connection failed.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="ych-banner">
        <div className="ych-row" style={{ alignItems: "flex-start" }}>
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{ui.privacyNote}</span>
        </div>
        <label className="ych-row" style={{ cursor: "pointer", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={state.injectInChat}
            onChange={(e) =>
              update((cur) => ({ ...cur, injectInChat: e.currentTarget.checked }))
            }
            style={{ accentColor: "var(--app-accent, #eab32e)" }}
          />
          <span>{ui.injectChat}</span>
        </label>
      </div>

      {error && (
        <div className="ysh-alert" role="alert">
          <AlertCircle size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
          {error}
        </div>
      )}
      {notice && (
        <div className="ysh-ok" role="status">
          <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
          {notice}
        </div>
      )}

      {/* 1. GitHub */}
      <article className={`ych-card${state.github ? " is-connected" : ""}`}>
        <div className="ych-card-top">
          <span className="ych-card-title">
            <GitBranch size={17} />
            <span>GitHub (Repos, Diff, Commit & PR)</span>
          </span>
          <span className={`ych-pill${state.github ? " is-ok" : ""}`}>
            {state.github
              ? `${ui.connected} · @${state.github.username}`
              : ui.notConnected}
          </span>
        </div>

        {state.github ? (
          <div className="ych-row">
            {onOpenCodeTab && (
              <button
                type="button"
                className="ych-btn is-primary"
                onClick={onOpenCodeTab}
              >
                <Terminal size={14} />
                <span>{ui.openCodeAgent}</span>
              </button>
            )}
            <button
              type="button"
              className="ych-btn is-danger"
              onClick={() => update((c) => ({ ...c, github: null }))}
            >
              <Unlink size={14} />
              <span>{ui.disconnect}</span>
            </button>
          </div>
        ) : (
          <>
            <input
              className="ych-input"
              type="password"
              dir="ltr"
              placeholder={ui.ghTokenPh}
              value={ghToken}
              onChange={(e) => setGhToken(e.currentTarget.value)}
              data-testid="input-connector-github-token"
            />
            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-primary"
                disabled={busyId !== null || !ghToken.trim()}
                onClick={() => void connectGitHub()}
                data-testid="button-connector-github-connect"
              >
                {busyId === "github" && (
                  <LoaderCircle className="loading-spinner" size={14} />
                )}
                <span>{ui.connectBtn}</span>
              </button>
              <a
                className="ych-btn"
                href="https://github.com/settings/tokens/new?scopes=repo&description=YFactory-Code"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{ui.ghHelp}</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </>
        )}
      </article>

      {/* 2. Vercel */}
      <article className={`ych-card${state.vercel ? " is-connected" : ""}`}>
        <div className="ych-card-top">
          <span className="ych-card-title">
            <Triangle size={16} />
            <span>Vercel (Projects & Deployments)</span>
          </span>
          <span className={`ych-pill${state.vercel ? " is-ok" : ""}`}>
            {state.vercel
              ? `${ui.connected} · ${state.vercel.accountLabel}`
              : ui.notConnected}
          </span>
        </div>

        {state.vercel ? (
          <>
            <small style={{ color: "var(--app-secondary)", fontSize: 12 }}>
              {state.vercel.lastSummary}
            </small>
            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-danger"
                onClick={() => update((c) => ({ ...c, vercel: null }))}
              >
                <Unlink size={14} />
                <span>{ui.disconnect}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              className="ych-input"
              type="password"
              dir="ltr"
              placeholder={ui.vcTokenPh}
              value={vcToken}
              onChange={(e) => setVcToken(e.currentTarget.value)}
            />
            <input
              className="ych-input"
              type="text"
              dir="ltr"
              placeholder={ui.vcTeamPh}
              value={vcTeam}
              onChange={(e) => setVcTeam(e.currentTarget.value)}
            />
            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-primary"
                disabled={busyId !== null || !vcToken.trim()}
                onClick={() => void connectVercel()}
              >
                {busyId === "vercel" && (
                  <LoaderCircle className="loading-spinner" size={14} />
                )}
                <span>{ui.connectBtn}</span>
              </button>
            </div>
          </>
        )}
      </article>

      {/* 3. Cloudflare */}
      <article className={`ych-card${state.cloudflare ? " is-connected" : ""}`}>
        <div className="ych-card-top">
          <span className="ych-card-title">
            <Cloud size={17} />
            <span>Cloudflare (Workers & Pages)</span>
          </span>
          <span className={`ych-pill${state.cloudflare ? " is-ok" : ""}`}>
            {state.cloudflare
              ? `${ui.connected} · ${state.cloudflare.accountLabel}`
              : ui.notConnected}
          </span>
        </div>

        {state.cloudflare ? (
          <div className="ych-row">
            <button
              type="button"
              className="ych-btn is-danger"
              onClick={() => update((c) => ({ ...c, cloudflare: null }))}
            >
              <Unlink size={14} />
              <span>{ui.disconnect}</span>
            </button>
          </div>
        ) : (
          <>
            <input
              className="ych-input"
              type="password"
              dir="ltr"
              placeholder={ui.cfTokenPh}
              value={cfToken}
              onChange={(e) => setCfToken(e.currentTarget.value)}
            />
            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-primary"
                disabled={busyId !== null || !cfToken.trim()}
                onClick={() => void connectCloudflare()}
              >
                {busyId === "cloudflare" && (
                  <LoaderCircle className="loading-spinner" size={14} />
                )}
                <span>{ui.connectBtn}</span>
              </button>
            </div>
          </>
        )}
      </article>

      {/* 4. Supabase */}
      <article className={`ych-card${state.supabase ? " is-connected" : ""}`}>
        <div className="ych-card-top">
          <span className="ych-card-title">
            <Database size={17} />
            <span>Supabase (Database & REST)</span>
          </span>
          <span className={`ych-pill${state.supabase ? " is-ok" : ""}`}>
            {state.supabase
              ? `${ui.connected} · ${state.supabase.projectLabel}`
              : ui.notConnected}
          </span>
        </div>

        {state.supabase ? (
          <>
            <small style={{ color: "var(--app-secondary)", fontSize: 12 }} dir="ltr">
              {state.supabase.projectUrl}
            </small>
            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-danger"
                onClick={() => update((c) => ({ ...c, supabase: null }))}
              >
                <Unlink size={14} />
                <span>{ui.disconnect}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              className="ych-input"
              type="url"
              dir="ltr"
              placeholder={ui.sbUrlPh}
              value={sbUrl}
              onChange={(e) => setSbUrl(e.currentTarget.value)}
            />
            <input
              className="ych-input"
              type="password"
              dir="ltr"
              placeholder={ui.sbKeyPh}
              value={sbKey}
              onChange={(e) => setSbKey(e.currentTarget.value)}
            />
            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-primary"
                disabled={busyId !== null || !sbUrl.trim() || !sbKey.trim()}
                onClick={() => void connectSupabase()}
              >
                {busyId === "supabase" && (
                  <LoaderCircle className="loading-spinner" size={14} />
                )}
                <span>{ui.connectBtn}</span>
              </button>
            </div>
          </>
        )}
      </article>

      {/* 5. IDE & CLI Bridges */}
      <article className="ych-card">
        <div className="ych-card-top">
          <span className="ych-card-title">
            <Terminal size={17} />
            <span>{ui.idesTitle}</span>
          </span>
        </div>
        <div className="ych-ide-grid">
          {IDE_BRIDGES.map((ide) => (
            <div key={ide.name} className="ych-ide-chip">
              <strong dir="ltr">{ide.name}</strong>
              <small dir="ltr">{ide.mode}</small>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

export default function ConnectorsHubModal({
  open,
  locale,
  onClose,
  onOpenCodeTab,
}: ConnectorsHubModalProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ych-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ui.title}
      dir={isRtl ? "rtl" : "ltr"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="connectors-hub-modal"
    >
      <section className="ych-sheet">
        <header className="ych-header">
          <div className="ych-head-title">
            <span className="ych-icon-box" aria-hidden="true">
              <Puzzle size={19} />
            </span>
            <div>
              <h2>{ui.title}</h2>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="ych-btn"
            style={{ width: 36, padding: 0 }}
            onClick={onClose}
            aria-label="Close"
            data-testid="button-connectors-close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="ych-body">
          <ConnectorsHubContent
            locale={locale}
            onOpenCodeTab={
              onOpenCodeTab
                ? () => {
                    onClose();
                    onOpenCodeTab();
                  }
                : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}