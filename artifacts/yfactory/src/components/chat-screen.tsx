import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Camera,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Globe,
  History,
  Image,
  Lightbulb,
  Mic,
  MoreHorizontal,
  MoreVertical,
  Plus,
  Puzzle,
  Scan,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import "./chat-screen.css";

type ChatScreenProps = {
  onBack: () => void;
};

type ChatMessage = {
  id: number;
  text: string;
};

const iconForOption = (name: string) => {
  switch (name) {
    case "camera":
      return <Camera aria-hidden="true" />;
    case "photos":
    case "image":
      return <Image aria-hidden="true" />;
    case "files":
      return <Folder aria-hidden="true" />;
    case "webSearch":
      return <Globe aria-hidden="true" />;
    case "connectors":
      return <Puzzle aria-hidden="true" />;
    case "myStories":
      return <BookOpen aria-hidden="true" />;
    case "skills":
      return <Sparkles aria-hidden="true" />;
    case "memory":
      return <Brain aria-hidden="true" />;
    case "more":
      return <MoreHorizontal aria-hidden="true" />;
    default:
      return <Sparkles aria-hidden="true" />;
  }
};

export default function ChatScreen({ onBack }: ChatScreenProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [ideasOpen, setIdeasOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fullListOpen, setFullListOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sheetOpen && !fullListOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (fullListOpen) setFullListOpen(false);
        else setSheetOpen(false);
      }
      if (event.key === "Tab" && sheetRef.current) {
        const focusable = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], textarea, input, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen, fullListOpen]);

  useEffect(() => {
    if (!sheetOpen && !fullListOpen) {
      restoreFocusRef.current?.focus();
      return;
    }
    requestAnimationFrame(() => sheetRef.current?.querySelector("button")?.focus());
  }, [sheetOpen, fullListOpen]);

  const fillDraft = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openSheet = (target: HTMLElement) => {
    restoreFocusRef.current = target;
    setFullListOpen(false);
    setSheetOpen(true);
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: Date.now(), text }]);
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const ideaKeys = ["idea1", "idea2", "idea3"] as const;
  const actionKeys = [
    { key: "useStories", icon: <BookOpen aria-hidden="true" />, fill: true },
    { key: "generateImage", icon: <Image aria-hidden="true" />, fill: true },
    { key: "analyzeImage", icon: <Scan aria-hidden="true" />, fill: false },
    { key: "browseWeb", icon: <Globe aria-hidden="true" />, fill: false },
  ] as const;
  const allOptions = [
    "camera",
    "photos",
    "files",
    "webSearch",
    "connectors",
    "myStories",
    "skills",
    "memory",
    "more",
  ] as const;
  const sheetOptions = allOptions;

  return (
    <section className="chat-screen" aria-label={t("chat:title")} data-testid="chat-screen">
      <header className="chat-header">
        <button
          type="button"
          className="chat-icon-button chat-back"
          onClick={onBack}
          aria-label={t("chat:back")}
          data-testid="button-chat-back"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1 data-testid="text-chat-title">{t("chat:title")}</h1>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-icon-button chat-soon-control"
            disabled
            aria-label={`${t("chat:history")} — ${t("chat:comingSoon")}`}
            title={t("chat:comingSoon")}
            data-testid="button-chat-history"
          >
            <History aria-hidden="true" />
            <span>{t("chat:comingSoon")}</span>
          </button>
          <button
            type="button"
            className="chat-icon-button chat-soon-control chat-overflow"
            disabled
            aria-label={`${t("chat:menu")} — ${t("chat:comingSoon")}`}
            title={t("chat:comingSoon")}
            data-testid="button-chat-menu"
          >
            <MoreVertical aria-hidden="true" />
            <span>{t("chat:comingSoon")}</span>
          </button>
        </div>
      </header>

      <section className="chat-thread" aria-live="polite" data-testid="chat-thread">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-greeting">
              <div className="chat-robot" aria-hidden="true">
                  <svg viewBox="0 0 120 100" fill="none">
                    <path d="m18 11 2.7 6.3L27 20l-6.3 2.7L18 29l-2.7-6.3L9 20l6.3-2.7L18 11Z" fill="currentColor" />
                    <path d="m102 20 2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2 2-4.5Z" fill="currentColor" />
                    <path d="m105 70 2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2 2-4.5Z" fill="currentColor" />
                    <path d="M60 17v10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    <circle cx="60" cy="13" r="4" fill="currentColor" />
                    <rect x="31" y="27" width="58" height="43" rx="17" fill="var(--chat-bg)" stroke="currentColor" strokeWidth="4" />
                    <rect x="24" y="39" width="8" height="19" rx="4" fill="currentColor" />
                    <rect x="88" y="39" width="8" height="19" rx="4" fill="currentColor" />
                    <circle cx="49" cy="46" r="4" fill="currentColor" />
                    <circle cx="71" cy="46" r="4" fill="currentColor" />
                    <rect x="49" y="74" width="22" height="11" rx="5.5" fill="currentColor" />
                    <path d="M43 90h34" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                </svg>
              </div>
                <h2 className="chat-hello">{t("chat:hello")}</h2>
                <p className="chat-greeting-help">{t("chat:help")}</p>
            </div>

            <div className="chat-quick-actions" aria-label={t("chat:title")}>
              {actionKeys.map(({ key, icon, fill }) => (
                <button
                  type="button"
                  className="chat-action"
                  key={key}
                  disabled={!fill}
                  title={!fill ? t("chat:comingSoon") : undefined}
                  aria-label={`${t(`chat:actions.${key}`)}${!fill ? ` — ${t("chat:comingSoon")}` : ""}`}
                  data-testid={`button-chat-action-${key}`}
                  onClick={() => fill && fillDraft(t(`chat:actions.${key}`))}
                >
                  <span className="chat-action-icon">{icon}</span>
                  <span className="chat-action-label">{t(`chat:actions.${key}`)}</span>
                  {!fill && <small>{t("chat:comingSoon")}</small>}
                </button>
              ))}
            </div>

            <section className="chat-ideas" data-testid="chat-suggested-ideas">
              <button
                type="button"
                className="chat-ideas-toggle"
                aria-expanded={ideasOpen}
                onClick={() => setIdeasOpen((open) => !open)}
                data-testid="button-chat-ideas-toggle"
              >
                <span className="chat-ideas-title">
                  <Lightbulb aria-hidden="true" />
                  <span>{t("chat:suggestedTitle")}</span>
                </span>
                <ChevronDown className={ideasOpen ? "chat-chevron-open" : ""} aria-hidden="true" />
              </button>
              {ideasOpen && (
                <div className="chat-idea-list">
                  {ideaKeys.map((key) => (
                    <button
                      type="button"
                      className="chat-idea-chip"
                      key={key}
                      onClick={() => fillDraft(t(`chat:ideas.${key}`))}
                      data-testid={`button-chat-idea-${key}`}
                    >
                      {t(`chat:ideas.${key}`)}
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="chat-messages">
            {messages.map((message) => (
              <div className="chat-message-group" key={message.id} data-testid={`chat-message-${message.id}`}>
                <article className="chat-message chat-user-message">
                  <span className="chat-message-label">{t("chat:userLabel")}</span>
                  <p dir="auto">{message.text}</p>
                </article>
                <article className="chat-message chat-assistant-message">
                  <span className="chat-message-label">{t("chat:assistantLabel")}</span>
                  <p dir="auto" data-testid={`chat-preview-notice-${message.id}`}>{t("chat:previewOnly")}</p>
                </article>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="chat-compose-area">
        <form className="chat-composer" onSubmit={sendMessage} data-testid="form-chat-composer">
          <button
            type="button"
            className="chat-composer-tool chat-plus"
            onClick={(event) => openSheet(event.currentTarget)}
            aria-label={t("chat:addToConversation")}
            aria-haspopup="dialog"
            data-testid="button-chat-add"
          >
            <Plus aria-hidden="true" />
          </button>
          <div className="chat-composer-media-tools">
            <button type="button" className="chat-composer-tool" disabled title={t("chat:comingSoon")} aria-label={`${t("chat:image")} — ${t("chat:comingSoon")}`} data-testid="button-chat-image">
              <Image aria-hidden="true" />
            </button>
            <button type="button" className="chat-composer-tool chat-file-tool" disabled title={t("chat:comingSoon")} aria-label={`${t("chat:options.files")} — ${t("chat:comingSoon")}`} data-testid="button-chat-files">
              <FileText aria-hidden="true" />
            </button>
            <button type="button" className="chat-composer-tool chat-mic-tool" disabled title={t("chat:comingSoon")} aria-label={`${t("chat:mic")} — ${t("chat:comingSoon")}`} data-testid="button-chat-mic">
              <Mic aria-hidden="true" />
            </button>
          </div>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("chat:composerPlaceholder")}
            rows={1}
            aria-label={t("chat:composerPlaceholder")}
            data-testid="input-chat-message"
          />
          <button
            type="submit"
            className="chat-send-button"
            disabled={!draft.trim()}
            aria-label={t("chat:send")}
            data-testid="button-chat-send"
          >
            <Send aria-hidden="true" />
          </button>
        </form>
        <p className="chat-footer-note" data-testid="status-chat-connected">
          <BookOpen aria-hidden="true" />
          <span>{t("chat:footerConnected")}</span>
        </p>
      </footer>

      {sheetOpen && (
        <div
          className={`chat-sheet-backdrop ${fullListOpen ? "chat-sheet-backdrop-expanded" : ""}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSheetOpen(false);
              setFullListOpen(false);
            }
          }}
          data-testid="chat-add-backdrop"
        >
          <section
            className={`chat-sheet ${fullListOpen ? "chat-sheet-expanded" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-sheet-title"
            ref={sheetRef}
            data-testid="chat-add-sheet"
          >
            <div className="chat-sheet-grabber" aria-hidden="true" />
            <div className="chat-sheet-heading">
              <button
                type="button"
                className="chat-icon-button chat-sheet-close"
                onClick={() => {
                  setSheetOpen(false);
                  setFullListOpen(false);
                }}
                aria-label={t("chat:close")}
                data-testid="button-chat-close-sheet"
              >
                <X aria-hidden="true" />
              </button>
              <h2 id="chat-sheet-title">{fullListOpen ? t("chat:attachmentsTitle") : t("chat:addToConversation")}</h2>
            </div>
            {!fullListOpen ? (
              <div className="chat-attachment-grid">
                {sheetOptions.map((option) => (
                  option === "more" ? (
                    <button
                      type="button"
                      className="chat-attachment-option"
                      key={option}
                      onClick={() => setFullListOpen(true)}
                      data-testid="button-chat-option-more"
                    >
                      <span className="chat-option-icon">{iconForOption(option)}</span>
                      <span>{t(`chat:options.${option}`)}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="chat-attachment-option"
                      key={option}
                      disabled
                      title={t("chat:comingSoon")}
                      data-testid={`button-chat-option-${option}`}
                    >
                      <span className="chat-option-icon">{iconForOption(option)}</span>
                      <span>{t(`chat:options.${option}`)}</span>
                      <small>{t("chat:comingSoon")}</small>
                    </button>
                  )
                ))}
              </div>
            ) : (
              <div className="chat-option-list" data-testid="chat-all-options">
                {allOptions.map((option) => (
                  <button
                    type="button"
                    className="chat-option-row"
                    key={option}
                    disabled
                    title={t("chat:comingSoon")}
                    data-testid={`button-chat-full-option-${option}`}
                  >
                    <span className="chat-option-icon">{iconForOption(option)}</span>
                    <span className="chat-option-name">{t(`chat:options.${option}`)}</span>
                    <span className="chat-coming-soon">{t("chat:comingSoon")}</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
