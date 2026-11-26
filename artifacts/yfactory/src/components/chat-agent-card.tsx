import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  Cpu,
  GraduationCap,
  Image,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import type { ChatAgentCommand } from "@/lib/chatAgent";

export type ChatAgentCardState = {
  command: ChatAgentCommand;
  status: "running" | "done" | "error";
  taskId?: string;
  storyId?: string;
  providerId?: string;
  resultSummary?: string;
  errorMessage?: string;
};

type ChatAgentCardProps = {
  state: ChatAgentCardState;
  locale: string;
  onOpenImagePage?: () => void;
  onOpenStoryPage?: (storyId?: string) => void;
  onOpenCodePage?: () => void;
  onOpenStudentsPage?: () => void;
  onOpenProviderCenter?: (providerId?: string) => void;
};

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      imgAgent: "أمر توليد صور",
      storyAgent: "أمر قصصي",
      codeAgent: "وكيل البرمجة (IDE)",
      studentsAgent: "منصة الطلاب",
      providerAgent: "مركز المزودين",
      running: "جارٍ التنفيذ...",
      done: "تم التنفيذ",
      failed: "تعذّر التنفيذ",
      openImg: "فتح الصور",
      openStory: "فتح قصصي",
      openCode: "فتح Code",
      openStudents: "فتح الطلاب",
      openProvider: "فتح مركز المزودين",
      imgUnit: "صور",
      sceneUnit: "مشهد",
      genStarted: "مع بدء توليد المشاهد",
    };
  }
  return {
    imgAgent: "Image Agent",
    storyAgent: "My Stories Agent",
    codeAgent: "YFactory Code (IDE)",
    studentsAgent: "Students Agent",
    providerAgent: "Provider Center",
    running: "Executing...",
    done: "Completed",
    failed: "Action failed",
    openImg: "Open Image",
    openStory: "Open Story",
    openCode: "Open Code",
    openStudents: "Open Students",
    openProvider: "Open Provider Center",
    imgUnit: "img",
    sceneUnit: "scenes",
    genStarted: "Rendering started",
  };
}

export default function ChatAgentCard({
  state,
  locale,
  onOpenImagePage,
  onOpenStoryPage,
  onOpenCodePage,
  onOpenStudentsPage,
  onOpenProviderCenter,
}: ChatAgentCardProps) {
  const copy = getCopy(locale);
  const { command, status } = state;

  const meta = (() => {
    switch (command.type) {
      case "generate_image":
        return {
          icon: <Image size={16} aria-hidden="true" />,
          label: copy.imgAgent,
          openLabel: copy.openImg,
          onOpen: onOpenImagePage,
          body: (
            <>
              <p className="chat-agent-prompt" dir="auto">
                {command.prompt}
              </p>
              <div className="chat-agent-meta">
                <span className="chat-agent-chip">
                  <Sparkles size={11} aria-hidden="true" />
                  {command.count} {copy.imgUnit}
                </span>
              </div>
            </>
          ),
        };
      case "story_setup":
        return {
          icon: <BookOpen size={16} aria-hidden="true" />,
          label: copy.storyAgent,
          openLabel: copy.openStory,
          onOpen: onOpenStoryPage
            ? () => onOpenStoryPage(state.storyId ?? command.storyId ?? undefined)
            : undefined,
          body: (
            <>
              <p className="chat-agent-prompt" dir="auto">
                {command.storyName}
              </p>
              <div className="chat-agent-meta">
                <span className="chat-agent-chip">
                  {command.targetCount} {copy.sceneUnit}
                </span>
                <span className="chat-agent-chip">{command.aspectRatio}</span>
                {command.startGeneration && (
                  <span className="chat-agent-chip is-highlight">
                    <Sparkles size={11} aria-hidden="true" />
                    {copy.genStarted}
                  </span>
                )}
              </div>
              {command.characterTraits.length > 0 && (
                <div className="chat-agent-traits">
                  {command.characterTraits.map((trait, idx) => (
                    <span className="chat-agent-trait" key={idx} dir="auto">
                      {trait}
                    </span>
                  ))}
                </div>
              )}
            </>
          ),
        };
      case "code_workspace_task":
        return {
          icon: <Code2 size={16} aria-hidden="true" />,
          label: copy.codeAgent,
          openLabel: copy.openCode,
          onOpen: onOpenCodePage,
          body: (
            <p className="chat-agent-prompt" dir="auto">
              {command.prompt}
            </p>
          ),
        };
      case "student_study_assist":
        return {
          icon: <GraduationCap size={16} aria-hidden="true" />,
          label: copy.studentsAgent,
          openLabel: copy.openStudents,
          onOpen: onOpenStudentsPage,
          body: (
            <>
              <p className="chat-agent-prompt" dir="auto">
                {command.topic}
              </p>
              <div className="chat-agent-meta">
                <span className="chat-agent-chip">{command.subject}</span>
                <span className="chat-agent-chip">{command.goal}</span>
              </div>
            </>
          ),
        };
      case "provider_recommend":
        return {
          icon: <Cpu size={16} aria-hidden="true" />,
          label: copy.providerAgent,
          openLabel: copy.openProvider,
          onOpen: onOpenProviderCenter
            ? () => onOpenProviderCenter(state.providerId)
            : undefined,
          body: (
            <div className="chat-agent-meta">
              <span className="chat-agent-chip">{command.task}</span>
              <span className="chat-agent-chip">{command.priority}</span>
            </div>
          ),
        };
    }
  })();

  const statusText =
    status === "running"
      ? copy.running
      : status === "done"
        ? copy.done
        : copy.failed;

  return (
    <div
      className={`chat-agent-card is-${status}`}
      data-testid={`chat-agent-card-${command.type}`}
    >
      <div className="chat-agent-card-head">
        <span className="chat-agent-card-icon">{meta.icon}</span>
        <div className="chat-agent-card-titles">
          <strong>{meta.label}</strong>
          <span className={`chat-agent-status is-${status}`}>
            {status === "running" && (
              <LoaderCircle className="loading-spinner" size={12} aria-hidden="true" />
            )}
            {status === "done" && <Check size={12} aria-hidden="true" />}
            {status === "error" && <AlertCircle size={12} aria-hidden="true" />}
            <span>{statusText}</span>
          </span>
        </div>
      </div>

      <div className="chat-agent-card-body">
        {meta.body}
        {state.resultSummary && (
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              lineHeight: 1.45,
              color: "var(--chat-muted, var(--app-secondary))",
            }}
            dir="auto"
          >
            {state.resultSummary}
          </p>
        )}
      </div>

      {status === "error" && state.errorMessage && (
        <p className="chat-agent-error" dir="auto">
          {state.errorMessage}
        </p>
      )}

      {meta.onOpen && (
        <div className="chat-agent-card-footer">
          <button
            type="button"
            className="chat-agent-open-btn"
            onClick={meta.onOpen}
            data-testid={`button-agent-open-${command.type}`}
          >
            <span>{meta.openLabel}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}