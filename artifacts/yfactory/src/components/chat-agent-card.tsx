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

type CardCopy = {
  imgAgent: string;
  storyAgent: string;
  runningImg: string;
  runningStory: string;
  doneImg: string;
  doneStory: string;
  failed: string;
  openImg: string;
  openStory: string;
  imgUnit: string;
  sceneUnit: string;
  genStarted: string;
};

const CARD_COPY: Record<string, CardCopy> = {
  "ar": {
    "imgAgent": "أمر توليد صور",
    "storyAgent": "أمر قصصي",
    "runningImg": "جارٍ التنفيذ في صفحة الصور...",
    "runningStory": "جارٍ إنشاء وضبط القصة...",
    "doneImg": "تم الإرسال إلى صفحة الصور",
    "doneStory": "تم الحفظ في قصصي",
    "failed": "تعذّر التنفيذ",
    "openImg": "فتح صفحة الصور",
    "openStory": "فتح في قصصي",
    "imgUnit": "صور",
    "sceneUnit": "مشهد",
    "genStarted": "مع بدء توليد المشاهد"
  },
  "fr": {
    "imgAgent": "Agent Images",
    "storyAgent": "Agent Mes histoires",
    "runningImg": "Exécution dans Images...",
    "runningStory": "Préparation de l'histoire...",
    "doneImg": "Envoyé vers Images",
    "doneStory": "Enregistré dans Mes histoires",
    "failed": "Échec",
    "openImg": "Ouvrir Images",
    "openStory": "Ouvrir l'histoire",
    "imgUnit": "img",
    "sceneUnit": "scènes",
    "genStarted": "Génération lancée"
  },
  "es": {
    "imgAgent": "Agente de Imagen",
    "storyAgent": "Agente de Historias",
    "runningImg": "Ejecutando en Imagen...",
    "runningStory": "Configurando historia...",
    "doneImg": "Enviado a Imagen",
    "doneStory": "Guardado en Mis historias",
    "failed": "Error",
    "openImg": "Abrir Imagen",
    "openStory": "Abrir historia",
    "imgUnit": "img",
    "sceneUnit": "escenas",
    "genStarted": "Generación iniciada"
  },
  "de": {
    "imgAgent": "Bild-Agent",
    "storyAgent": "Geschichten-Agent",
    "runningImg": "Wird im Bildbereich ausgeführt...",
    "runningStory": "Geschichte wird eingerichtet...",
    "doneImg": "An Bildbereich gesendet",
    "doneStory": "In Meine Geschichten gespeichert",
    "failed": "Fehlgeschlagen",
    "openImg": "Bildseite öffnen",
    "openStory": "In Geschichten öffnen",
    "imgUnit": "Bilder",
    "sceneUnit": "Szenen",
    "genStarted": "Szenengenerierung gestartet"
  },
  "it": {
    "imgAgent": "Agente Immagini",
    "storyAgent": "Agente Storie",
    "runningImg": "Esecuzione in Immagini...",
    "runningStory": "Configurazione storia...",
    "doneImg": "Inviato a Immagini",
    "doneStory": "Salvato in Le mie storie",
    "failed": "Errore",
    "openImg": "Apri Immagini",
    "openStory": "Apri in Storie",
    "imgUnit": "img",
    "sceneUnit": "scene",
    "genStarted": "Generazione avviata"
  },
  "pt": {
    "imgAgent": "Agente de Imagem",
    "storyAgent": "Agente de Histórias",
    "runningImg": "Executando em Imagem...",
    "runningStory": "Configurando história...",
    "doneImg": "Enviado para Imagem",
    "doneStory": "Salvo em Minhas histórias",
    "failed": "Falha",
    "openImg": "Abrir Imagem",
    "openStory": "Abrir em Histórias",
    "imgUnit": "img",
    "sceneUnit": "cenas",
    "genStarted": "Geração iniciada"
  },
  "tr": {
    "imgAgent": "Görsel Ajanı",
    "storyAgent": "Hikaye Ajanı",
    "runningImg": "Görsel alanında çalışıyor...",
    "runningStory": "Hikaye hazırlanıyor...",
    "doneImg": "Görsel alanına gönderildi",
    "doneStory": "Hikayelerim'e kaydedildi",
    "failed": "Başarısız",
    "openImg": "Görsel sayfasını aç",
    "openStory": "Hikayelerim'de aç",
    "imgUnit": "görsel",
    "sceneUnit": "sahne",
    "genStarted": "Sahne üretimi başladı"
  },
  "ru": {
    "imgAgent": "Агент изображений",
    "storyAgent": "Агент историй",
    "runningImg": "Выполнение в разделе Изображения...",
    "runningStory": "Настройка истории...",
    "doneImg": "Отправлено в Изображения",
    "doneStory": "Сохранено в Мои истории",
    "failed": "Ошибка",
    "openImg": "Открыть Изображения",
    "openStory": "Открыть историю",
    "imgUnit": "изобр.",
    "sceneUnit": "сцен",
    "genStarted": "Генерация запущена"
  },
  "ur": {
    "imgAgent": "تصویری ایجنٹ",
    "storyAgent": "کہانی ایجنٹ",
    "runningImg": "تصویر صفحے پر عمل ہو رہا ہے...",
    "runningStory": "کہانی تیار کی جا رہی ہے...",
    "doneImg": "تصویر صفحے پر بھیج دیا گیا",
    "doneStory": "میری کہانیوں میں محفوظ",
    "failed": "عمل ناکام رہا",
    "openImg": "تصویر صفحہ کھولیں",
    "openStory": "کہانی کھولیں",
    "imgUnit": "تصاویر",
    "sceneUnit": "مناظر",
    "genStarted": "مناظر کی تخلیق شروع"
  },
  "fa": {
    "imgAgent": "عامل تصویر",
    "storyAgent": "عامل داستان",
    "runningImg": "در حال اجرا در صفحه تصویر...",
    "runningStory": "در حال تنظیم داستان...",
    "doneImg": "به صفحه تصویر ارسال شد",
    "doneStory": "در داستان‌های من ذخیره شد",
    "failed": "اجرا ناموفق بود",
    "openImg": "باز کردن صفحه تصویر",
    "openStory": "باز کردن در داستان‌ها",
    "imgUnit": "تصویر",
    "sceneUnit": "صحنه",
    "genStarted": "تولید صحنه‌ها آغاز شد"
  },
  "zh-cn": {
    "imgAgent": "图像代理",
    "storyAgent": "故事代理",
    "runningImg": "正在图像页面执行...",
    "runningStory": "正在创建并配置故事...",
    "doneImg": "已发送至图像页面",
    "doneStory": "已保存到我的故事",
    "failed": "执行失败",
    "openImg": "打开图像页面",
    "openStory": "在我的故事中打开",
    "imgUnit": "张",
    "sceneUnit": "个场景",
    "genStarted": "已开始生成场景"
  },
  "zh-tw": {
    "imgAgent": "圖片代理",
    "storyAgent": "故事代理",
    "runningImg": "正在圖片頁面執行...",
    "runningStory": "正在建立並設定故事...",
    "doneImg": "已傳送至圖片頁面",
    "doneStory": "已儲存到我的故事",
    "failed": "執行失敗",
    "openImg": "開啟圖片頁面",
    "openStory": "在我的故事中開啟",
    "imgUnit": "張",
    "sceneUnit": "個場景",
    "genStarted": "已開始生成場景"
  },
  "ja": {
    "imgAgent": "画像エージェント",
    "storyAgent": "ストーリーエージェント",
    "runningImg": "画像ワークスペースで実行中...",
    "runningStory": "ストーリーを設定中...",
    "doneImg": "画像ページで実行済み",
    "doneStory": "マイストーリーに保存済み",
    "failed": "実行に失敗",
    "openImg": "画像ページを開く",
    "openStory": "マイストーリーで開く",
    "imgUnit": "枚",
    "sceneUnit": "シーン",
    "genStarted": "シーン生成を開始"
  },
  "ko": {
    "imgAgent": "이미지 에이전트",
    "storyAgent": "스토리 에이전트",
    "runningImg": "이미지 공간에서 실행 중...",
    "runningStory": "스토리 설정 중...",
    "doneImg": "이미지 공간에 전달됨",
    "doneStory": "내 스토리에 저장됨",
    "failed": "실행 실패",
    "openImg": "이미지 페이지 열기",
    "openStory": "내 스토리에서 열기",
    "imgUnit": "장",
    "sceneUnit": "장면",
    "genStarted": "장면 생성 시작됨"
  },
  "hi": {
    "imgAgent": "छवि एजेंट",
    "storyAgent": "कहानी एजेंट",
    "runningImg": "छवि कार्यक्षेत्र में चल रहा है...",
    "runningStory": "कहानी सहेजी जा रही है...",
    "doneImg": "छवि कार्यक्षेत्र में भेजा गया",
    "doneStory": "मेरी कहानियों में सहेजा गया",
    "failed": "निष्पादन विफल",
    "openImg": "छवि पेज खोलें",
    "openStory": "कहानी खोलें",
    "imgUnit": "छवियाँ",
    "sceneUnit": "दृश्य",
    "genStarted": "दृश्य निर्माण शुरू"
  },
  "id": {
    "imgAgent": "Agen Gambar",
    "storyAgent": "Agen Cerita",
    "runningImg": "Menjalankan di halaman Gambar...",
    "runningStory": "Menyiapkan cerita...",
    "doneImg": "Dikirim ke halaman Gambar",
    "doneStory": "Tersimpan di Cerita Saya",
    "failed": "Gagal dijalankan",
    "openImg": "Buka halaman Gambar",
    "openStory": "Buka di Cerita Saya",
    "imgUnit": "gambar",
    "sceneUnit": "adegan",
    "genStarted": "Pembuatan adegan dimulai"
  },
  "bn": {
    "imgAgent": "ছবি এজেন্ট",
    "storyAgent": "গল্প এজেন্ট",
    "runningImg": "ছবি পেজে চলছে...",
    "runningStory": "গল্প প্রস্তুত হচ্ছে...",
    "doneImg": "ছবি পেজে পাঠানো হয়েছে",
    "doneStory": "আমার গল্পে সংরক্ষিত",
    "failed": "ব্যর্থ হয়েছে",
    "openImg": "ছবি পেজ খুলুন",
    "openStory": "আমার গল্পে খুলুন",
    "imgUnit": "ছবি",
    "sceneUnit": "দৃশ্য",
    "genStarted": "দৃশ্য তৈরি শুরু হয়েছে"
  },
  "en": {
    "imgAgent": "Image Agent",
    "storyAgent": "My Stories Agent",
    "runningImg": "Running in Image workspace...",
    "runningStory": "Saving story & settings...",
    "doneImg": "Executed in Image workspace",
    "doneStory": "Saved in My Stories",
    "failed": "Execution failed",
    "openImg": "Open Image page",
    "openStory": "Open in My Stories",
    "imgUnit": "img",
    "sceneUnit": "scenes",
    "genStarted": "Scene generation started"
  }
};

function getCardCopy(lang: string): CardCopy {
  const lower = lang.trim().toLowerCase();
  const base = lower.split("-")[0] ?? "en";
  return CARD_COPY[lower] ?? CARD_COPY[base] ?? CARD_COPY.en!;
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
              {`${command.count} ${ui.imgUnit}`}
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
              {`${command.targetCount} ${ui.sceneUnit}`}
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
