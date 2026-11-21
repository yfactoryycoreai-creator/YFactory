import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  Image,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import type { ChatAgentCommand } from "@/lib/chatAgent";

export type ChatAgentCardState = {
  command: ChatAgentCommand;
  status: "running" | "done" | "error";
  storyId?: string;
  errorMessage?: string;
};

type ChatAgentCardProps = {
  state: ChatAgentCardState;
  locale: string;
  onOpenImagePage?: () => void;
  onOpenStoryPage?: (storyId?: string) => void;
};

function getCardCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      imgAgent: `أمر توليد صور`,
      storyAgent: `أمر قصصي`,
      runningImg: `جارٍ التنفيذ في صفحة الصور...`,
      runningStory: `جارٍ إنشاء وضبط القصة...`,
      doneImg: `تم الإرسال إلى صفحة الصور`,
      doneStory: `تم الحفظ في قصصي`,
      failed: `تعذّر التنفيذ`,
      openImg: `فتح صفحة الصور`,
      openStory: `فتح في قصصي`,
      countLabel: (n: string | number) => `${n} صور`,
      scenesLabel: (n: number) => `${n} مشهد`,
      genStarted: `مع بدء توليد المشاهد`,
    };
  }
  if (lang.startsWith("fr")) {
    return {
      imgAgent: `Agent Images`,
      storyAgent: `Agent Mes histoires`,
      runningImg: `Exécution dans Images...`,
      runningStory: `Préparation de l'histoire...`,
      doneImg: `Envoyé vers Images`,
      doneStory: `Enregistré dans Mes histoires`,
      failed: `Échec`,
      openImg: `Ouvrir Images`,
      openStory: `Ouvrir l'histoire`,
      countLabel: (n: string | number) => `${n} img`,
      scenesLabel: (n: number) => `${n} scènes`,
      genStarted: `Génération lancée`,
    };
  }
  if (lang.startsWith("es")) {
    return {
      imgAgent: `Agente de Imagen`,
      storyAgent: `Agente de Historias`,
      runningImg: `Ejecutando en Imagen...`,
      runningStory: `Configurando historia...`,
      doneImg: `Enviado a Imagen`,
      doneStory: `Guardado en Mis historias`,
      failed: `Error`,
      openImg: `Abrir Imagen`,
      openStory: `Abrir historia`,
      countLabel: (n: string | number) => `${n} img`,
      scenesLabel: (n: number) => `${n} escenas`,
      genStarted: `Generación iniciada`,
    };
  }
  return {
    imgAgent: `Image Agent`,
    storyAgent: `My Stories Agent`,
    runningImg: `Running in Image workspace...`,
    runningStory: `Saving story & settings...`,
    doneImg: `Executed in Image workspace`,
    doneStory: `Saved in My Stories`,
    failed: `Execution failed`,
    openImg: `Open Image page`,
    openStory: `Open in My Stories`,
    countLabel: (n: string | number) => `${n} img`,
    scenesLabel: (n: number) => `${n} scenes`,
    genStarted: `Scene generation started`,
  };
}

export default function ChatAgentCard({
  state,
  locale,
  onOpenImagePage,
  onOpenStoryPage,
}: ChatAgentCardProps) {
  const ui = getCardCopy(locale);
  const { command, status } = state;
  const isImage = command.type === "generate_image";

  const statusText =
    status === "running"
      ? isImage
        ? ui.runningImg
        : ui.runningStory
      : status === "done"
        ? isImage
          ? ui.doneImg
          : ui.doneStory
        : state.errorMessage || ui.failed;

  return (
    <div className={`chat-agent-card is-${status}`}>
      <div className="chat-agent-card-head">
        <span className="chat-agent-card-title">
          {isImage ? (
            <Image size={14} aria-hidden="true" />
          ) : (
            <BookOpen size={14} aria-hidden="true" />
          )}
          <strong>{isImage ? ui.imgAgent : ui.storyAgent}</strong>
        </span>
        <span className={`chat-agent-status is-${status}`}>
          {status === "running" ? (
            <LoaderCircle
              className="loading-spinner"
              size={13}
              aria-hidden="true"
            />
          ) : status === "done" ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <AlertCircle size={13} aria-hidden="true" />
          )}
          <span>{statusText}</span>
        </span>
      </div>

      {isImage ? (
        <div className="chat-agent-card-body">
          <p className="chat-agent-prompt" dir="auto">
            {command.prompt}
          </p>
          <div className="chat-agent-meta-row">
            <span className="chat-agent-chip">
              {ui.countLabel(command.count)}
            </span>
          </div>
        </div>
      ) : (
        <div className="chat-agent-card-body">
          <strong className="chat-agent-story-name" dir="auto">
            {command.storyName}
          </strong>
          <div className="chat-agent-meta-row">
            <span className="chat-agent-chip">
              {ui.scenesLabel(command.targetCount)}
            </span>
            <span className="chat-agent-chip" dir="ltr">
              {command.aspectRatio}
            </span>
            {command.startGeneration && (
              <span className="chat-agent-chip is-gold">
                <Sparkles size={11} aria-hidden="true" />
                {ui.genStarted}
              </span>
            )}
          </div>
          {command.characterTraits.length > 0 && (
            <div className="chat-agent-traits">
              {command.characterTraits.map((trait, i) => (
                <span className="chat-agent-trait" key={i} dir="auto">
                  {trait}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {status === "done" && (
        <div className="chat-agent-card-foot">
          {isImage && onOpenImagePage && (
            <button
              type="button"
              className="chat-agent-open-btn"
              onClick={onOpenImagePage}
            >
              <span>{ui.openImg}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
          {!isImage && onOpenStoryPage && (
            <button
              type="button"
              className="chat-agent-open-btn"
              onClick={() =>
                onOpenStoryPage(state.storyId ?? command.storyId ?? undefined)
              }
            >
              <span>{ui.openStory}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
