import { useEffect, useState } from "react";
import { BookOpen, Check, LoaderCircle, Search, X } from "lucide-react";
import { isRtlLanguage } from "@/lib/languages";
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
  imgUnit: string;
  noScript: string;
  detach: string;
  close: string;
};

const PICKER_LABELS: Record<string, PickerLabels> = {
  "ar": {
    "title": "اختر قصة من قصصك",
    "search": "ابحث في قصصك...",
    "loading": "جارٍ تحميل قصصك...",
    "empty": "لا توجد قصص محفوظة بعد. أنشئ قصة في قسم قصصي أولاً.",
    "loadErr": "تعذّر تحميل القصص حالياً.",
    "imgUnit": "صورة",
    "noScript": "بدون سيناريو مكتوب بعد",
    "detach": "إزالة القصة المربوطة",
    "close": "إغلاق"
  },
  "fr": {
    "title": "Choisir une histoire",
    "search": "Rechercher vos histoires...",
    "loading": "Chargement des histoires...",
    "empty": "Aucune histoire enregistrée pour le moment.",
    "loadErr": "Impossible de charger les histoires.",
    "imgUnit": "images",
    "noScript": "Aucun script écrit",
    "detach": "Retirer l'histoire",
    "close": "Fermer"
  },
  "es": {
    "title": "Elegir una historia",
    "search": "Buscar en tus historias...",
    "loading": "Cargando historias...",
    "empty": "Aún no tienes historias guardadas.",
    "loadErr": "No se pudieron cargar las historias.",
    "imgUnit": "imágenes",
    "noScript": "Sin guion escrito aún",
    "detach": "Quitar historia",
    "close": "Cerrar"
  },
  "de": {
    "title": "Geschichte wählen",
    "search": "Geschichten durchsuchen...",
    "loading": "Geschichten werden geladen...",
    "empty": "Noch keine Geschichten gespeichert.",
    "loadErr": "Geschichten konnten nicht geladen werden.",
    "imgUnit": "Bilder",
    "noScript": "Noch kein Skript geschrieben",
    "detach": "Geschichte trennen",
    "close": "Schließen"
  },
  "it": {
    "title": "Scegli una storia",
    "search": "Cerca nelle tue storie...",
    "loading": "Caricamento storie...",
    "empty": "Nessuna storia salvata al momento.",
    "loadErr": "Impossibile caricare le storie.",
    "imgUnit": "immagini",
    "noScript": "Nessuno script scritto",
    "detach": "Rimuovi storia",
    "close": "Chiudi"
  },
  "pt": {
    "title": "Escolher uma história",
    "search": "Pesquisar suas histórias...",
    "loading": "Carregando histórias...",
    "empty": "Nenhuma história salva ainda.",
    "loadErr": "Não foi possível carregar as histórias.",
    "imgUnit": "imagens",
    "noScript": "Sem roteiro escrito",
    "detach": "Remover história",
    "close": "Fechar"
  },
  "tr": {
    "title": "Bir hikaye seçin",
    "search": "Hikayelerde ara...",
    "loading": "Hikayeler yükleniyor...",
    "empty": "Henüz kayıtlı hikaye yok.",
    "loadErr": "Hikayeler yüklenemedi.",
    "imgUnit": "görsel",
    "noScript": "Henüz senaryo yazılmadı",
    "detach": "Hikayeyi ayır",
    "close": "Kapat"
  },
  "ru": {
    "title": "Выберите историю",
    "search": "Поиск по историям...",
    "loading": "Загрузка историй...",
    "empty": "Сохранённых историй пока нет.",
    "loadErr": "Не удалось загрузить истории.",
    "imgUnit": "изобр.",
    "noScript": "Сценарий ещё не написан",
    "detach": "Открепить историю",
    "close": "Закрыть"
  },
  "ur": {
    "title": "اپنی کہانی منتخب کریں",
    "search": "کہانیوں میں تلاش کریں...",
    "loading": "کہانیاں لوڈ ہو رہی ہیں...",
    "empty": "ابھی کوئی کہانی محفوظ نہیں ہے۔",
    "loadErr": "کہانیاں لوڈ نہیں ہو سکیں۔",
    "imgUnit": "تصاویر",
    "noScript": "ابھی کوئی اسکرپٹ نہیں لکھا گیا",
    "detach": "منسلک کہانی ہٹائیں",
    "close": "بند کریں"
  },
  "fa": {
    "title": "انتخاب داستان",
    "search": "جستجو در داستان‌ها...",
    "loading": "در حال بارگذاری داستان‌ها...",
    "empty": "هنوز داستانی ذخیره نشده است.",
    "loadErr": "بارگذاری داستان‌ها ممکن نشد.",
    "imgUnit": "تصویر",
    "noScript": "هنوز فیلمنامه‌ای نوشته نشده",
    "detach": "جدا کردن داستان",
    "close": "بستن"
  },
  "zh-cn": {
    "title": "选择故事",
    "search": "搜索您的故事...",
    "loading": "正在加载故事...",
    "empty": "暂无已保存的故事。",
    "loadErr": "无法加载故事。",
    "imgUnit": "张图像",
    "noScript": "尚未编写脚本",
    "detach": "取消关联故事",
    "close": "关闭"
  },
  "zh-tw": {
    "title": "選擇故事",
    "search": "搜尋您的故事...",
    "loading": "正在載入故事...",
    "empty": "尚無已儲存的故事。",
    "loadErr": "無法載入故事。",
    "imgUnit": "張圖片",
    "noScript": "尚未撰寫腳本",
    "detach": "取消關聯故事",
    "close": "關閉"
  },
  "ja": {
    "title": "ストーリーを選択",
    "search": "ストーリーを検索...",
    "loading": "ストーリーを読み込み中...",
    "empty": "保存されたストーリーはまだありません。",
    "loadErr": "ストーリーを読み込めませんでした。",
    "imgUnit": "枚",
    "noScript": "スクリプト未入力",
    "detach": "ストーリーの連携を解除",
    "close": "閉じる"
  },
  "ko": {
    "title": "스토리 선택",
    "search": "스토리 검색...",
    "loading": "스토리 불러오는 중...",
    "empty": "저장된 스토리가 아직 없습니다.",
    "loadErr": "스토리를 불러올 수 없습니다.",
    "imgUnit": "장",
    "noScript": "작성된 스크립트 없음",
    "detach": "연결된 스토리 해제",
    "close": "닫기"
  },
  "hi": {
    "title": "कहानी चुनें",
    "search": "अपनी कहानियाँ खोजें...",
    "loading": "कहानियाँ लोड हो रही हैं...",
    "empty": "अभी कोई कहानी सहेजी नहीं गई है।",
    "loadErr": "कहानियाँ लोड नहीं हो सकीं।",
    "imgUnit": "छवियाँ",
    "noScript": "अभी कोई स्क्रिप्ट नहीं लिखी गई",
    "detach": "जुड़ी कहानी हटाएं",
    "close": "बंद करें"
  },
  "id": {
    "title": "Pilih cerita",
    "search": "Cari cerita Anda...",
    "loading": "Memuat cerita...",
    "empty": "Belum ada cerita tersimpan.",
    "loadErr": "Tidak dapat memuat cerita.",
    "imgUnit": "gambar",
    "noScript": "Belum ada naskah",
    "detach": "Lepas cerita",
    "close": "Tutup"
  },
  "bn": {
    "title": "গল্প নির্বাচন করুন",
    "search": "আপনার গল্প খুঁজুন...",
    "loading": "গল্প লোড হচ্ছে...",
    "empty": "এখনো কোনো গল্প সংরক্ষিত নেই।",
    "loadErr": "গল্প লোড করা যায়নি।",
    "imgUnit": "ছবি",
    "noScript": "এখনো কোনো স্ক্রিপ্ট লেখা হয়নি",
    "detach": "সংযুক্ত গল্প সরান",
    "close": "বন্ধ করুন"
  },
  "en": {
    "title": "Choose a story",
    "search": "Search your stories...",
    "loading": "Loading your stories...",
    "empty": "No saved stories yet. Create one in My Stories first.",
    "loadErr": "Could not load your stories.",
    "imgUnit": "images",
    "noScript": "No script written yet",
    "detach": "Detach story",
    "close": "Close"
  }
};

function getLabels(lang: string): PickerLabels {
  const lower = lang.trim().toLowerCase();
  const base = lower.split("-")[0] ?? "en";
  return PICKER_LABELS[lower] ?? PICKER_LABELS[base] ?? PICKER_LABELS.en!;
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
  const isRtl = isRtlLanguage(locale);
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
                        {`${story.imageCount} / ${story.targetCount} ${ui.imgUnit}`}
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
