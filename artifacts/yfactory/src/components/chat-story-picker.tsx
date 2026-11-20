import { useEffect, useState } from "react";
import { BookOpen, Check, LoaderCircle, Search, X } from "lucide-react";
import { subscribeToStories, type StoryRecord } from "@/lib/stories";

type ChatStoryPickerProps = {
  open: boolean;
  uid: string | null;
  selectedStoryId: string | null;
  locale: string;
  onClose: () => void;
  onSelect: (story: StoryRecord) => void;
  onClear: () => void;
};

type PickerLabels = {
  title: string;
  search: string;
  loading: string;
  empty: string;
  loadErr: string;
  images: (count: number, target: number) => string;
  noScript: string;
  detach: string;
  close: string;
};

function getLabels(lang: string): PickerLabels {
  if (lang.startsWith("ar")) {
    return {
      title: `اختر قصة من قصصك`,
      search: `ابحث في قصصك...`,
      loading: `جارٍ تحميل قصصك...`,
      empty: `لا توجد قصص محفوظة بعد. أنشئ قصة في قسم قصصي أولاً.`,
      loadErr: `تعذّر تحميل القصص حالياً.`,
      images: (c, t) => `${c} / ${t} صورة`,
      noScript: `بدون سيناريو مكتوب بعد`,
      detach: `إزالة القصة المربوطة`,
      close: `إغلاق`,
    };
  }
  if (lang.startsWith("fr")) {
    return {
      title: `Choisir une histoire`,
      search: `Rechercher vos histoires...`,
      loading: `Chargement des histoires...`,
      empty: `Aucune histoire enregistrée pour le moment.`,
      loadErr: `Impossible de charger les histoires.`,
      images: (c, t) => `${c} / ${t} images`,
      noScript: `Aucun script écrit`,
      detach: `Retirer l'histoire`,
      close: `Fermer`,
    };
  }
  if (lang.startsWith("es")) {
    return {
      title: `Elegir una historia`,
      search: `Buscar en tus historias...`,
      loading: `Cargando historias...`,
      empty: `Aún no tienes historias guardadas.`,
      loadErr: `No se pudieron cargar las historias.`,
      images: (c, t) => `${c} / ${t} imágenes`,
      noScript: `Sin guion escrito aún`,
      detach: `Quitar historia`,
      close: `Cerrar`,
    };
  }
  return {
    title: `Choose a story`,
    search: `Search your stories...`,
    loading: `Loading your stories...`,
    empty: `No saved stories yet. Create one in My Stories first.`,
    loadErr: `Could not load your stories.`,
    images: (c, t) => `${c} / ${t} images`,
    noScript: `No script written yet`,
    detach: `Detach story`,
    close: `Close`,
  };
}

export default function ChatStoryPicker({
  open,
  uid,
  selectedStoryId,
  locale,
  onClose,
  onSelect,
  onClear,
}: ChatStoryPickerProps) {
  const isRtl = locale.startsWith("ar");
  const ui = getLabels(locale);
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !uid) return;
    setLoading(true);
    setError("");
    let unsub: (() => void) | null = null;
    try {
      unsub = subscribeToStories(
        uid,
        (next) => {
          setStories(next);
          setLoading(false);
        },
        () => undefined,
        () => {
          setError(ui.loadErr);
          setLoading(false);
        },
      );
    } catch {
      setError(ui.loadErr);
      setLoading(false);
    }
    return () => {
      unsub?.();
    };
  }, [open, uid, ui.loadErr]);

  if (!open) return null;

  const filtered = stories.filter((s) => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return true;
    return (
      s.storyName.toLocaleLowerCase().includes(q) ||
      s.script.toLocaleLowerCase().includes(q)
    );
  });

  return (
    <div
      className="chat-modal-backdrop"
      dir={isRtl ? "rtl" : "ltr"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="chat-story-picker-dialog"
    >
      <section
        className="chat-model-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ui.title}
      >
        <div className="chat-sheet-grabber" aria-hidden="true" />
        <div className="chat-sheet-heading">
          <h2>{ui.title}</h2>
          <button
            type="button"
            className="chat-icon-button chat-sheet-close"
            onClick={onClose}
            aria-label={ui.close}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <label className="chat-conversations-search chat-story-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={ui.search}
            aria-label={ui.search}
          />
        </label>

        <div className="chat-model-sheet-body">
          {loading ? (
            <div className="chat-conversations-empty">
              <LoaderCircle
                className="loading-spinner"
                size={20}
                aria-hidden="true"
              />
              <span>{ui.loading}</span>
            </div>
          ) : error ? (
            <div className="chat-model-sheet-empty">
              <p>{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="chat-model-sheet-empty">
              <p>{ui.empty}</p>
            </div>
          ) : (
            <div className="chat-model-option-list">
              {filtered.map((story) => {
                const active = story.id === selectedStoryId;
                const preview = story.script.trim()
                  ? story.script.replace(/\s+/g, " ").trim().slice(0, 90)
                  : ui.noScript;
                return (
                  <button
                    type="button"
                    key={story.id}
                    className={`chat-story-picker-row ${
                      active ? "is-selected" : ""
                    }`}
                    onClick={() => {
                      onSelect(story);
                      onClose();
                    }}
                  >
                    <span className="chat-conv-icon" aria-hidden="true">
                      <BookOpen size={16} />
                    </span>
                    <span className="chat-story-picker-copy">
                      <strong dir="auto">
                        {story.storyName || "Untitled"}
                      </strong>
                      <small dir="auto">{preview}</small>
                      <em className="chat-story-picker-meta">
                        {ui.images(story.imageCount, story.targetCount)}
                      </em>
                    </span>
                    {active && (
                      <Check
                        size={17}
                        className="chat-story-picker-check"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedStoryId && (
          <div className="chat-model-sheet-footer">
            <button
              type="button"
              className="chat-model-manage-btn"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              <X size={15} aria-hidden="true" />
              <span>{ui.detach}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
