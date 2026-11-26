import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { AgentSectionTarget, AgentTaskItem } from "@/lib/agentTasksApi";
import { isRtlLanguage } from "@/lib/languages";
import "./agent-task-drawer.css";

type AgentTaskDrawerProps = {
  open: boolean;
  locale: string;
  tasks: AgentTaskItem[];
  loading: boolean;
  busyTaskId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onCancelTask: (taskId: string) => void;
  onRetryTask: (task: AgentTaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onClearFinished: () => void;
  onOpenSection: (
    section: AgentSectionTarget,
    ref?: AgentTaskItem["targetRef"],
  ) => void;
};

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "مدير مهام الوكيل الدائم",
      clearDone: "مسح المنتهية",
      empty: "لا توجد مهام مسجلة بعد. نفّذ أي أمر من الشات (صور، قصص، برمجة، طلاب، مزودون) لمتابعة التقدم هنا حتى بعد تحديث الصفحة.",
      cancel: "إيقاف",
      retry: "إعادة المحاولة",
      open: "فتح القسم",
      del: "حذف",
      statuses: {
        queued: "بالانتظار",
        running: "قيد التنفيذ",
        completed: "مكتملة",
        failed: "فشلت",
        cancelled: "ملغاة",
      } as Record<AgentTaskItem["status"], string>,
      sections: {
        image: "الصور",
        stories: "قصصي",
        code: "البرمجة",
        students: "الطلاب",
        provider_center: "المزودون",
      } as Record<AgentSectionTarget, string>,
    };
  }
  return {
    title: "Persistent Agent Tasks",
    clearDone: "Clear Finished",
    empty: "No persisted agent tasks yet. Run any Chat Agent action (Image, My Stories, Code, Students, Provider Center) to track progress and recover after reconnects.",
    cancel: "Cancel",
    retry: "Retry",
    open: "Open",
    del: "Delete",
    statuses: {
      queued: "Queued",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    } as Record<AgentTaskItem["status"], string>,
    sections: {
      image: "Image",
      stories: "My Stories",
      video: "Video",
      code: "Code",
      students: "Students",
      provider_center: "Providers",
    } as Record<AgentSectionTarget, string>,
  };
}

export default function AgentTaskDrawer({
  open,
  locale,
  tasks,
  loading,
  busyTaskId,
  onClose,
  onRefresh,
  onCancelTask,
  onRetryTask,
  onDeleteTask,
  onClearFinished,
  onOpenSection,
}: AgentTaskDrawerProps) {
  if (!open) return null;
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);
  const hasFinished = tasks.some(
    (t) =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled",
  );

  const pillTone = (st: AgentTaskItem["status"]) => {
    if (st === "completed") return "is-ok";
    if (st === "failed" || st === "cancelled") return "is-err";
    return "is-gold";
  };

  return (
    <div
      className="atd-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ui.title}
      dir={isRtl ? "rtl" : "ltr"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="agent-task-drawer"
    >
      <div className="atd-sheet">
        <div className="atd-grabber" aria-hidden="true" />
        <div className="atd-head">
          <div className="atd-title-wrap">
            <ListChecks size={18} aria-hidden="true" />
            <h2>
              {ui.title} ({tasks.length})
            </h2>
          </div>
          <div className="atd-head-actions">
            <button
              type="button"
              className="atd-icon-btn"
              disabled={loading}
              onClick={onRefresh}
              aria-label="Refresh"
            >
              <RefreshCw
                size={14}
                className={loading ? "loading-spinner" : ""}
              />
            </button>
            {hasFinished && (
              <button
                type="button"
                className="atd-icon-btn is-danger"
                onClick={onClearFinished}
              >
                <Trash2 size={13} />
                <span>{ui.clearDone}</span>
              </button>
            )}
            <button
              type="button"
              className="atd-icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="atd-list">
          {loading && tasks.length === 0 ? (
            <div className="atd-empty">
              <LoaderCircle className="loading-spinner" size={20} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="atd-empty">{ui.empty}</div>
          ) : (
            tasks.map((task) => {
              const isBusy = busyTaskId === task.id;
              const isActive =
                task.status === "queued" || task.status === "running";
              const canRetry =
                (task.status === "failed" || task.status === "cancelled") &&
                task.toolName !== "generate_image" &&
                task.toolName !== "story_setup";
              return (
                <article key={task.id} className="atd-card">
                  <div className="atd-card-top">
                    <div className="atd-badges">
                      <span className={`atd-pill ${pillTone(task.status)}`}>
                        {isActive && (
                          <LoaderCircle
                            className="loading-spinner"
                            size={11}
                            aria-hidden="true"
                          />
                        )}
                        {task.status === "completed" && (
                          <CheckCircle2 size={11} aria-hidden="true" />
                        )}
                        {(task.status === "failed" ||
                          task.status === "cancelled") && (
                          <AlertCircle size={11} aria-hidden="true" />
                        )}
                        <span>{ui.statuses[task.status]}</span>
                      </span>
                      <span className="atd-pill">
                        {ui.sections[task.section]}
                      </span>
                    </div>
                    <small style={{ color: "var(--app-secondary)", fontSize: 11 }}>
                      {new Date(task.updatedAt).toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>

                  <p className="atd-task-title" dir="auto">
                    {task.title}
                  </p>
                  {task.stepLabel && (
                    <p className="atd-task-sub" dir="auto">
                      {task.stepLabel}
                    </p>
                  )}

                  {isActive && (
                    <div className="atd-progress-track">
                      <div
                        className="atd-progress-fill"
                        style={{ width: `${Math.max(8, task.progress)}%` }}
                      />
                    </div>
                  )}

                  {task.resultSummary && (
                    <p className="atd-task-sub" dir="auto">
                      {task.resultSummary}
                    </p>
                  )}

                  {task.errorMessage && (
                    <p
                      className="atd-task-sub"
                      style={{ color: "var(--app-danger-text)" }}
                      dir="auto"
                    >
                      {task.errorMessage}
                    </p>
                  )}

                  <div className="atd-actions">
                    <button
                      type="button"
                      className="atd-icon-btn"
                      onClick={() => {
                        onClose();
                        onOpenSection(task.section, task.targetRef);
                      }}
                    >
                      <span>{ui.open}</span>
                      <ArrowUpRight size={13} />
                    </button>

                    {isActive && (
                      <button
                        type="button"
                        className="atd-icon-btn is-danger"
                        disabled={isBusy}
                        onClick={() => onCancelTask(task.id)}
                      >
                        <Square size={11} />
                        <span>{ui.cancel}</span>
                      </button>
                    )}

                    {canRetry && (
                      <button
                        type="button"
                        className="atd-icon-btn"
                        disabled={isBusy}
                        onClick={() => onRetryTask(task)}
                      >
                        <RotateCcw size={12} />
                        <span>{ui.retry}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="atd-icon-btn is-danger"
                      disabled={isBusy}
                      onClick={() => onDeleteTask(task.id)}
                    >
                      <Trash2 size={12} />
                      <span>{ui.del}</span>
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}