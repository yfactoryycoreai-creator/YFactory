import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowLeft,
  BookOpen,
  Brain,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  FileCode2,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  History,
  Image,
  Layers,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Mic,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  Send,
  Share2,
  Smartphone,
  Sparkles,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import "./chat-screen.css";
import ChatMarkdown from "@/components/chat-markdown";
import {
  ChatApiError,
  ChatStreamAbortedError,
  createChatConversation,
  deleteChatConversation,
  getChatConversation,
  listChatConversations,
  loadChatModels,
  streamChatCompletion,
  updateChatConversation,
  type ChatConversationSummary,
  type ChatFailureCode,
  type ChatMessageInput,
  type ChatModelOption,
  type StoredChatFeedback,
  type StoredChatMessage,
} from "@/lib/chatApi";
import {
  buildConversationPlainText,
  exportAsDocx,
  exportAsMarkdown,
  exportAsPdf,
} from "@/lib/chatExport";
import { loadVaultKeys, type VaultKey } from "@/lib/apiKeyVault";

type ChatScreenProps = {
  onBack: () => void;
  getIdToken?: () => Promise<string>;
  onOpenSecrets: () => void;
  onOpenModels: (key: Pick<VaultKey, "provider" | "id">) => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  modelName?: string;
  feedback?: StoredChatFeedback;
  stopped?: boolean;
  createdAt: number;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type FloatingMenuState =
  | { kind: "user"; messageId: string; top: number; left: number }
  | { kind: "assistant"; messageId: string; top: number; left: number }
  | { kind: "header"; top: number; left: number }
  | { kind: "conv"; convId: string; top: number; left: number }
  | null;

type ConfirmDeleteState =
  | { kind: "message"; messageId: string }
  | { kind: "conv"; convId: string; title: string }
  | null;

type TextModalState =
  | { kind: "rename"; convId: string; value: string }
  | { kind: "project"; convId: string; value: string }
  | null;

const MODEL_STORE_KEY = "yfactory.chat.selectedModel";
const CONV_STORE_KEY = "yfactory.chat.activeConversationId";
const MAX_CTX = 40;

type UiStrings = {
  newChat: string;
  convsTitle: string;
  searchConvs: string;
  pinned: string;
  recent: string;
  noConvs: string;
  noResults: string;
  loadingConvs: string;
  copy: string;
  copied: string;
  share: string;
  shared: string;
  readAloud: string;
  stopReading: string;
  like: string;
  dislike: string;
  regenerate: string;
  editRequest: string;
  del: string;
  delMsgTitle: string;
  delMsgDesc: string;
  delConvTitle: string;
  delConvDesc: string;
  confirmDel: string;
  stopGen: string;
  generating: string;
  stoppedNote: string;
  retry: string;
  saveSend: string;
  save: string;
  cancel: string;
  modelReady: string;
  modelLoading: string;
  modelOff: string;
  chooseModel: string;
  manageKeys: string;
  pin: string;
  unpin: string;
  rename: string;
  renameTitle: string;
  renameHint: string;
  addProject: string;
  projectTitle: string;
  projectHint: string;
  clearProject: string;
  addHome: string;
  homeTitle: string;
  homeSteps: string;
  homeDone: string;
  expPdf: string;
  expMd: string;
  expDocx: string;
  expDone: string;
  moreOpts: string;
  scrollDown: string;
  justNow: string;
  minsAgo: (n: number) => string;
  hrsAgo: (n: number) => string;
  daysAgo: (n: number) => string;
  untitled: string;
  saveErr: string;
  openingConv: string;
};

function getUiStrings(lang: string): UiStrings {
  if (lang.startsWith("ar")) {
    return {
      newChat: `محادثة جديدة`,
      convsTitle: `المحادثات`,
      searchConvs: `ابحث في المحادثات...`,
      pinned: `مثبّتة`,
      recent: `الأخيرة`,
      noConvs: `لا توجد محادثات محفوظة بعد.`,
      noResults: `لا توجد نتائج مطابقة.`,
      loadingConvs: `جارٍ تحميل المحادثات...`,
      copy: `نسخ`,
      copied: `تم النسخ`,
      share: `مشاركة`,
      shared: `تم نسخ النص للمشاركة`,
      readAloud: `قراءة بصوت عالٍ`,
      stopReading: `إيقاف القراءة`,
      like: `أعجبني`,
      dislike: `لم يعجبني`,
      regenerate: `إعادة التوليد`,
      editRequest: `تعديل الطلب`,
      del: `حذف`,
      delMsgTitle: `حذف الرسالة؟`,
      delMsgDesc: `هل أنت متأكد من حذف هذه الرسالة؟`,
      delConvTitle: `حذف المحادثة؟`,
      delConvDesc: `سيتم حذف المحادثة ورسائلها نهائياً.`,
      confirmDel: `تأكيد الحذف`,
      stopGen: `إيقاف التوليد`,
      generating: `جارٍ التوليد...`,
      stoppedNote: `تم إيقاف التوليد.`,
      retry: `إعادة المحاولة`,
      saveSend: `حفظ وإرسال`,
      save: `حفظ`,
      cancel: `إلغاء`,
      modelReady: `متاح`,
      modelLoading: `جارٍ التحميل...`,
      modelOff: `غير مهيأ`,
      chooseModel: `اختيار النموذج`,
      manageKeys: `إدارة مفاتيح API والنماذج`,
      pin: `تثبيت`,
      unpin: `إلغاء التثبيت`,
      rename: `إعادة تسمية`,
      renameTitle: `إعادة تسمية المحادثة`,
      renameHint: `أدخل عنوان المحادثة...`,
      addProject: `إضافة إلى مشروع`,
      projectTitle: `المشروع`,
      projectHint: `اسم المشروع...`,
      clearProject: `إزالة المشروع`,
      addHome: `إضافة للشاشة الرئيسية`,
      homeTitle: `إضافة للشاشة الرئيسية`,
      homeSteps:
        `افتح قائمة المتصفح واختر الإضافة إلى الشاشة الرئيسية.`,
      homeDone: `حسناً`,
      expPdf: `تصدير PDF`,
      expMd: `تصدير Markdown`,
      expDocx: `تصدير DOCX`,
      expDone: `تم تنزيل الملف بنجاح`,
      moreOpts: `المزيد من الخيارات`,
      scrollDown: `النزول للأسفل`,
      justNow: `الآن`,
      minsAgo: (n) => `منذ ${n} د`,
      hrsAgo: (n) => `منذ ${n} س`,
      daysAgo: (n) => `منذ ${n} ي`,
      untitled: `محادثة جديدة`,
      saveErr: `تعذّر حفظ التغييرات.`,
      openingConv: `جارٍ فتح المحادثة...`,
    };
  }
  if (lang.startsWith("fr")) {
    return {
      newChat: `Nouveau chat`,
      convsTitle: `Conversations`,
      searchConvs: `Rechercher...`,
      pinned: `Épinglées`,
      recent: `Récentes`,
      noConvs: `Aucune conversation.`,
      noResults: `Aucun résultat.`,
      loadingConvs: `Chargement...`,
      copy: `Copier`,
      copied: `Copié`,
      share: `Partager`,
      shared: `Copié pour partager`,
      readAloud: `Lire à haute voix`,
      stopReading: `Arrêter`,
      like: `J'aime`,
      dislike: `Je n'aime pas`,
      regenerate: `Régénérer`,
      editRequest: `Modifier`,
      del: `Supprimer`,
      delMsgTitle: `Supprimer le message ?`,
      delMsgDesc: `Voulez-vous supprimer ce message ?`,
      delConvTitle: `Supprimer la discussion ?`,
      delConvDesc: `Cette discussion sera supprimée.`,
      confirmDel: `Supprimer`,
      stopGen: `Arrêter`,
      generating: `Génération...`,
      stoppedNote: `Génération arrêtée.`,
      retry: `Réessayer`,
      saveSend: `Enregistrer`,
      save: `Enregistrer`,
      cancel: `Annuler`,
      modelReady: `Prêt`,
      modelLoading: `Chargement...`,
      modelOff: `Indisponible`,
      chooseModel: `Choisir un modèle`,
      manageKeys: `Gérer les clés API`,
      pin: `Épingler`,
      unpin: `Désépingler`,
      rename: `Renommer`,
      renameTitle: `Renommer`,
      renameHint: `Titre...`,
      addProject: `Ajouter au projet`,
      projectTitle: `Projet`,
      projectHint: `Nom du projet...`,
      clearProject: `Retirer`,
      addHome: `Ajouter à l'accueil`,
      homeTitle: `Ajouter à l'accueil`,
      homeSteps:
        `Ouvrez le menu du navigateur et choisissez Ajouter.`,
      homeDone: `Compris`,
      expPdf: `Exporter PDF`,
      expMd: `Exporter Markdown`,
      expDocx: `Exporter DOCX`,
      expDone: `Fichier téléchargé`,
      moreOpts: `Plus d'options`,
      scrollDown: `Aller en bas`,
      justNow: `À l'instant`,
      minsAgo: (n) => `il y a ${n} min`,
      hrsAgo: (n) => `il y a ${n} h`,
      daysAgo: (n) => `il y a ${n} j`,
      untitled: `Nouveau chat`,
      saveErr: `Erreur de sauvegarde.`,
      openingConv: `Ouverture...`,
    };
  }
  if (lang.startsWith("es")) {
    return {
      newChat: `Nuevo chat`,
      convsTitle: `Conversaciones`,
      searchConvs: `Buscar...`,
      pinned: `Fijadas`,
      recent: `Recientes`,
      noConvs: `Sin conversaciones.`,
      noResults: `Sin resultados.`,
      loadingConvs: `Cargando...`,
      copy: `Copiar`,
      copied: `Copiado`,
      share: `Compartir`,
      shared: `Copiado para compartir`,
      readAloud: `Leer en voz alta`,
      stopReading: `Detener`,
      like: `Me gusta`,
      dislike: `No me gusta`,
      regenerate: `Regenerar`,
      editRequest: `Editar`,
      del: `Eliminar`,
      delMsgTitle: `¿Eliminar mensaje?`,
      delMsgDesc: `¿Seguro que deseas eliminar este mensaje?`,
      delConvTitle: `¿Eliminar chat?`,
      delConvDesc: `Esta conversación se eliminará.`,
      confirmDel: `Eliminar`,
      stopGen: `Detener`,
      generating: `Generando...`,
      stoppedNote: `Generación detenida.`,
      retry: `Reintentar`,
      saveSend: `Guardar y enviar`,
      save: `Guardar`,
      cancel: `Cancelar`,
      modelReady: `Disponible`,
      modelLoading: `Cargando...`,
      modelOff: `No disponible`,
      chooseModel: `Elegir modelo`,
      manageKeys: `Gestionar claves API`,
      pin: `Fijar`,
      unpin: `Desfijar`,
      rename: `Renombrar`,
      renameTitle: `Renombrar`,
      renameHint: `Título...`,
      addProject: `Añadir a proyecto`,
      projectTitle: `Proyecto`,
      projectHint: `Nombre del proyecto...`,
      clearProject: `Quitar`,
      addHome: `Añadir a inicio`,
      homeTitle: `Añadir a inicio`,
      homeSteps:
        `Abre el menú del navegador y elige Añadir a inicio.`,
      homeDone: `Entendido`,
      expPdf: `Exportar PDF`,
      expMd: `Exportar Markdown`,
      expDocx: `Exportar DOCX`,
      expDone: `Archivo descargado`,
      moreOpts: `Más opciones`,
      scrollDown: `Ir al final`,
      justNow: `Ahora`,
      minsAgo: (n) => `hace ${n} min`,
      hrsAgo: (n) => `hace ${n} h`,
      daysAgo: (n) => `hace ${n} d`,
      untitled: `Nuevo chat`,
      saveErr: `Error al guardar.`,
      openingConv: `Abriendo...`,
    };
  }
  return {
    newChat: `New chat`,
    convsTitle: `Conversations`,
    searchConvs: `Search conversations...`,
    pinned: `Pinned`,
    recent: `Recent`,
    noConvs: `No saved conversations yet.`,
    noResults: `No matching conversations.`,
    loadingConvs: `Loading conversations...`,
    copy: `Copy`,
    copied: `Copied`,
    share: `Share`,
    shared: `Copied to share`,
    readAloud: `Read aloud`,
    stopReading: `Stop reading`,
    like: `Like`,
    dislike: `Dislike`,
    regenerate: `Regenerate`,
    editRequest: `Edit request`,
    del: `Delete`,
    delMsgTitle: `Delete message?`,
    delMsgDesc: `Are you sure you want to delete this message?`,
    delConvTitle: `Delete conversation?`,
    delConvDesc: `This conversation will be permanently deleted.`,
    confirmDel: `Delete`,
    stopGen: `Stop generation`,
    generating: `Generating...`,
    stoppedNote: `Generation stopped.`,
    retry: `Retry`,
    saveSend: `Save & Send`,
    save: `Save`,
    cancel: `Cancel`,
    modelReady: `Ready`,
    modelLoading: `Loading...`,
    modelOff: `Unavailable`,
    chooseModel: `Choose model`,
    manageKeys: `Manage API Keys & Models`,
    pin: `Pin`,
    unpin: `Unpin`,
    rename: `Rename`,
    renameTitle: `Rename conversation`,
    renameHint: `Conversation title...`,
    addProject: `Add to project`,
    projectTitle: `Project`,
    projectHint: `Project name...`,
    clearProject: `Remove project`,
    addHome: `Add to home screen`,
    homeTitle: `Add to Home Screen`,
    homeSteps:
      `Open browser menu and tap Add to Home screen.`,
    homeDone: `Got it`,
    expPdf: `Export PDF`,
    expMd: `Export Markdown`,
    expDocx: `Export DOCX`,
    expDone: `File downloaded`,
    moreOpts: `More options`,
    scrollDown: `Scroll to bottom`,
    justNow: `Just now`,
    minsAgo: (n) => `${n}m ago`,
    hrsAgo: (n) => `${n}h ago`,
    daysAgo: (n) => `${n}d ago`,
    untitled: `New chat`,
    saveErr: `Could not save changes.`,
    openingConv: `Opening conversation...`,
  };
}

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

function modelKey(entry: ChatModelOption): string {
  return `${entry.provider}:${entry.id}:${entry.modelName}`;
}

function makeMsgId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildCtx(list: ChatMessage[]): ChatMessageInput[] {
  return list
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text }))
    .slice(-MAX_CTX);
}

function speechLang(text: string, fallback: string): string {
  if (/[؀-ۿ]/.test(text)) return "ar-SA";
  if (fallback.startsWith("fr")) return "fr-FR";
  if (fallback.startsWith("es")) return "es-ES";
  return "en-US";
}

function relTime(ts: number, ui: UiStrings): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return ui.justNow;
  const min = Math.floor(sec / 60);
  if (min < 60) return ui.minsAgo(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return ui.hrsAgo(hr);
  return ui.daysAgo(Math.floor(hr / 24));
}

function calcMenuPos(
  el: HTMLElement,
  w: number,
  h: number,
  rtl: boolean,
): { top: number; left: number } {
  const r = el.getBoundingClientRect();
  const pref = rtl ? r.left : r.right - w;
  const left = Math.max(10, Math.min(pref, window.innerWidth - w - 10));
  const fits = window.innerHeight - r.bottom >= h + 12;
  const top = fits ? r.bottom + 6 : Math.max(10, r.top - h - 6);
  return { top, left };
}

function toStored(list: ChatMessage[]): StoredChatMessage[] {
  return list.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    ...(m.modelName ? { modelName: m.modelName } : {}),
    feedback: m.feedback ?? null,
    ...(m.stopped ? { stopped: true } : {}),
    createdAt: m.createdAt,
  }));
}

function sortConvs(
  items: ChatConversationSummary[],
): ChatConversationSummary[] {
  return [...items].sort((a, b) =>
    a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt - a.updatedAt,
  );
}

export default function ChatScreen({
  onBack,
  getIdToken,
  onOpenSecrets,
  onOpenModels,
}: ChatScreenProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = locale.startsWith("ar");
  const ui = getUiStrings(locale);

  const [draft, setDraft] = useState("");
  const [ideasOpen, setIdeasOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fullListOpen, setFullListOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [convsOpen, setConvsOpen] = useState(false);
  const [convSearch, setConvSearch] = useState("");

  const [convs, setConvs] = useState<ChatConversationSummary[]>([]);
  const [convsBusy, setConvsBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [convTitle, setConvTitle] = useState("");
  const [convPinned, setConvPinned] = useState(false);
  const [convProject, setConvProject] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [selModelKey, setSelModelKey] = useState("");
  const [setupKey, setSetupKey] = useState<
    Pick<VaultKey, "provider" | "id"> | null
  >(null);
  const [modelsBusy, setModelsBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [failCode, setFailCode] = useState<ChatFailureCode | "">("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakId, setSpeakId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showDown, setShowDown] = useState(false);

  const [menu, setMenu] = useState<FloatingMenuState>(null);
  const [delConfirm, setDelConfirm] = useState<ConfirmDeleteState>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [textModal, setTextModal] = useState<TextModalState>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [homeModal, setHomeModal] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const installRef = useRef<BeforeInstallPromptEvent | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const autoScrollRef = useRef(true);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeConvId;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => {
      setToast("");
      toastRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    const onInstall = (e: Event) => {
      e.preventDefault();
      installRef.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (toastRef.current) clearTimeout(toastRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const refreshConvs = useCallback(async (tok?: string) => {
    if (!getIdToken && !tok) return [];
    setConvsBusy(true);
    try {
      const auth = tok ?? (await getIdToken!());
      const list = await listChatConversations(auth);
      setConvs(list);
      return list;
    } catch {
      return [];
    } finally {
      setConvsBusy(false);
    }
  }, [getIdToken]);

  const openConv = useCallback(
    async (
      convId: string,
      availModels: ChatModelOption[],
      tokOverride?: string,
    ) => {
      if (!getIdToken && !tokOverride) return;
      abortRef.current?.abort();
      setSwitching(true);
      setMenu(null);
      setEditId(null);
      setFailCode("");
      try {
        const auth = tokOverride ?? (await getIdToken!());
        const d = await getChatConversation(auth, convId);
        setActiveConvId(d.id);
        setConvTitle(d.title);
        setConvPinned(d.pinned);
        setConvProject(d.projectName);
        setMessages(
          d.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            modelName: m.modelName,
            feedback: m.feedback ?? null,
            stopped: m.stopped,
            createdAt: m.createdAt,
          })),
        );
        if (d.modelProvider && d.modelKeyId && d.modelName) {
          const sk = `${d.modelProvider}:${d.modelKeyId}:${d.modelName}`;
          if (availModels.some((x) => modelKey(x) === sk)) {
            setSelModelKey(sk);
          }
        }
        try {
          window.localStorage.setItem(CONV_STORE_KEY, d.id);
        } catch {
          // ignore
        }
        setConvsOpen(false);
        autoScrollRef.current = true;
        requestAnimationFrame(() => {
          if (threadRef.current) {
            threadRef.current.scrollTop = threadRef.current.scrollHeight;
          }
        });
      } catch {
        showToast(ui.saveErr);
      } finally {
        setSwitching(false);
      }
    },
    [getIdToken, showToast, ui.saveErr],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      setModelsBusy(true);
      try {
        if (!getIdToken) throw new ChatApiError("auth_failed");
        const tok = await getIdToken();
        const [nextModels, savedConvs] = await Promise.all([
          loadChatModels(tok),
          listChatConversations(tok).catch(
            () => [] as ChatConversationSummary[],
          ),
        ]);
        const sk =
          nextModels.length === 0
            ? (await loadVaultKeys(tok)).find((k) =>
                Boolean(k.providerName),
              ) ?? null
            : null;
        if (!active) return;

        setModels(nextModels);
        setConvs(savedConvs);

        let savedM = "";
        let lastC = "";
        try {
          savedM = window.localStorage.getItem(MODEL_STORE_KEY) ?? "";
          lastC = window.localStorage.getItem(CONV_STORE_KEY) ?? "";
        } catch {
          savedM = "";
          lastC = "";
        }
        const matched = nextModels.find((x) => modelKey(x) === savedM);
        const chosen = matched ?? nextModels[0];
        setSelModelKey(chosen ? modelKey(chosen) : "");
        setSetupKey(sk ? { provider: sk.provider, id: sk.id } : null);
        setFailCode("");

        if (lastC && savedConvs.some((c) => c.id === lastC)) {
          await openConv(lastC, nextModels, tok);
        }
      } catch (err) {
        if (active) {
          setModels([]);
          setSelModelKey("");
          setSetupKey(null);
          setFailCode(err instanceof ChatApiError ? err.code : "timeout");
        }
      } finally {
        if (active) setModelsBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, openConv]);

  const selModel = models.find((x) => modelKey(x) === selModelKey);
  const byProvider = [
    ...models
      .reduce((map, entry) => {
        const g = map.get(entry.provider) ?? [];
        g.push(entry);
        map.set(entry.provider, g);
        return map;
      }, new Map<string, ChatModelOption[]>())
      .entries(),
  ];

  const persistMsgs = useCallback(
    async (
      nextMsgs: ChatMessage[],
      modelOver?: ChatModelOption | null,
    ): Promise<string | null> => {
      if (!getIdToken) return activeIdRef.current;
      const m = modelOver ?? selModel ?? null;
      try {
        const tok = await getIdToken();
        const cid = activeIdRef.current;
        if (!cid) {
          const firstU = nextMsgs.find((x) => x.role === "user");
          const title = firstU
            ? firstU.text.replace(/\s+/g, " ").trim().slice(0, 60)
            : ui.untitled;
          const created = await createChatConversation(tok, {
            title: title || ui.untitled,
            modelProvider: m?.provider ?? null,
            modelKeyId: m?.id ?? null,
            modelName: m?.modelName ?? null,
            messages: toStored(nextMsgs),
          });
          setActiveConvId(created.id);
          activeIdRef.current = created.id;
          setConvTitle(created.title);
          setConvPinned(created.pinned);
          setConvProject(created.projectName);
          try {
            window.localStorage.setItem(CONV_STORE_KEY, created.id);
          } catch {
            // ignore
          }
          setConvs((prev) =>
            sortConvs([created, ...prev.filter((x) => x.id !== created.id)]),
          );
          return created.id;
        }
        const upd = await updateChatConversation(tok, cid, {
          modelProvider: m?.provider ?? null,
          modelKeyId: m?.id ?? null,
          modelName: m?.modelName ?? null,
          messages: toStored(nextMsgs),
        });
        setConvs((prev) =>
          sortConvs([upd, ...prev.filter((x) => x.id !== upd.id)]),
        );
        return upd.id;
      } catch {
        return activeIdRef.current;
      }
    },
    [getIdToken, selModel, ui.untitled],
  );

  const handleModelSelect = (entry: ChatModelOption) => {
    const k = modelKey(entry);
    setSelModelKey(k);
    setPickerOpen(false);
    try {
      window.localStorage.setItem(MODEL_STORE_KEY, k);
    } catch {
      // ignore
    }
    if (activeIdRef.current && getIdToken) {
      const cid = activeIdRef.current;
      void (async () => {
        try {
          const tok = await getIdToken();
          const upd = await updateChatConversation(tok, cid, {
            modelProvider: entry.provider,
            modelKeyId: entry.id,
            modelName: entry.modelName,
          });
          setConvs((prev) =>
            sortConvs([upd, ...prev.filter((x) => x.id !== upd.id)]),
          );
        } catch {
          // ignore
        }
      })();
    }
  };

  const startNewChat = () => {
    abortRef.current?.abort();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeakId(null);
    }
    setActiveConvId(null);
    activeIdRef.current = null;
    setConvTitle("");
    setConvPinned(false);
    setConvProject(null);
    setMessages([]);
    setDraft("");
    setFailCode("");
    setEditId(null);
    setMenu(null);
    setConvsOpen(false);
    setShowDown(false);
    try {
      window.localStorage.removeItem(CONV_STORE_KEY);
    } catch {
      // ignore
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    const el = threadRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [draft]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) {
        return;
      }
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!sheetOpen && !fullListOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fullListOpen) setFullListOpen(false);
        else setSheetOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen, fullListOpen]);

  useEffect(() => {
    if (!sheetOpen && !fullListOpen) {
      focusRef.current?.focus();
      return;
    }
    requestAnimationFrame(() =>
      sheetRef.current?.querySelector("button")?.focus(),
    );
  }, [sheetOpen, fullListOpen]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = dist < 80;
    setShowDown(dist > 180);
  };

  const scrollBottom = () => {
    const el = threadRef.current;
    if (!el) return;
    autoScrollRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowDown(false);
  };

  const fillDraft = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openSheet = (target: HTMLElement) => {
    focusRef.current = target;
    setMenu(null);
    setFullListOpen(false);
    setSheetOpen(true);
  };

  const stopGen = () => {
    abortRef.current?.abort();
  };

  const runStream = async (hist: ChatMessage[]) => {
    if (sending) return;
    if (models.length === 0 || !selModel) {
      setFailCode("missing_key");
      return;
    }
    if (!getIdToken) {
      setFailCode("auth_failed");
      return;
    }
    const reqMsgs = buildCtx(hist);
    if (
      reqMsgs.length === 0 ||
      reqMsgs[reqMsgs.length - 1]?.role !== "user"
    ) {
      return;
    }

    const aid = makeMsgId();
    const ats = Date.now();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    autoScrollRef.current = true;
    setFailCode("");
    setSending(true);
    setStreamId(aid);

    setMessages([
      ...hist,
      {
        id: aid,
        role: "assistant",
        text: "",
        modelName: selModel.modelName,
        feedback: null,
        createdAt: ats,
      },
    ]);

    let acc = "";
    let finalMsgs: ChatMessage[] = hist;
    try {
      const tok = await getIdToken();
      await streamChatCompletion(
        tok,
        {
          provider: selModel.provider,
          keyId: selModel.id,
          modelName: selModel.modelName,
          messages: reqMsgs,
        },
        {
          signal: ctrl.signal,
          onDelta: (chunk) => {
            acc += chunk;
            const snap = acc;
            setMessages((cur) =>
              cur.map((m) => (m.id === aid ? { ...m, text: snap } : m)),
            );
          },
        },
      );
      finalMsgs = [
        ...hist,
        {
          id: aid,
          role: "assistant",
          text: acc,
          modelName: selModel.modelName,
          feedback: null,
          createdAt: ats,
        },
      ];
      setMessages(finalMsgs);
    } catch (err) {
      const aborted =
        err instanceof ChatStreamAbortedError || ctrl.signal.aborted;
      if (acc.trim()) {
        finalMsgs = [
          ...hist,
          {
            id: aid,
            role: "assistant",
            text: acc,
            modelName: selModel.modelName,
            feedback: null,
            ...(aborted ? { stopped: true } : {}),
            createdAt: ats,
          },
        ];
        setMessages(finalMsgs);
      } else {
        finalMsgs = hist;
        setMessages(hist);
      }
      if (!aborted) {
        setFailCode(err instanceof ChatApiError ? err.code : "timeout");
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setSending(false);
      setStreamId(null);
      await persistMsgs(finalMsgs, selModel);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const submitDraft = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (models.length === 0 || !selModel) {
      setFailCode("missing_key");
      return;
    }
    const uMsg: ChatMessage = {
      id: makeMsgId(),
      role: "user",
      text,
      createdAt: Date.now(),
    };
    setDraft("");
    setEditId(null);
    setMenu(null);
    await runStream([...messages, uMsg]);
  };

  const onSubmitForm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitDraft();
  };

  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submitDraft();
    }
  };

  const copyText = async (text: string, iconId?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (iconId) {
        setCopiedId(iconId);
        window.setTimeout(() => {
          setCopiedId((c) => (c === iconId ? null : c));
        }, 1800);
      } else {
        showToast(ui.copied);
      }
    } catch {
      // ignore
    }
  };

  const shareText = async (text: string, title?: string) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function"
      ) {
        await navigator.share({ ...(title ? { title } : {}), text });
        return;
      }
      await navigator.clipboard.writeText(text);
      showToast(ui.shared);
    } catch {
      // ignore
    }
  };

  const readAloud = (msg: ChatMessage) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    const synth = window.speechSynthesis;
    if (speakId === msg.id) {
      synth.cancel();
      setSpeakId(null);
      return;
    }
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(msg.text);
    utt.lang = speechLang(msg.text, locale);
    utt.onend = () => setSpeakId((c) => (c === msg.id ? null : c));
    utt.onerror = () => setSpeakId((c) => (c === msg.id ? null : c));
    setSpeakId(msg.id);
    synth.speak(utt);
  };

  const setFeedback = (id: string, val: "like" | "dislike") => {
    const next = messages.map((m) =>
      m.id === id ? { ...m, feedback: m.feedback === val ? null : val } : m,
    );
    setMessages(next);
    if (activeIdRef.current) void persistMsgs(next);
  };

  const regenerateMsg = async (aid: string) => {
    if (sending) return;
    setMenu(null);
    const idx = messages.findIndex((m) => m.id === aid);
    if (idx <= 0) return;
    const base = messages.slice(0, idx);
    if (base[base.length - 1]?.role !== "user") return;
    await runStream(base);
  };

  const retryLast = async () => {
    if (sending) return;
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "user") {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    await runStream(messages.slice(0, idx + 1));
  };

  const startEdit = (msg: ChatMessage) => {
    if (sending) return;
    setMenu(null);
    setEditId(msg.id);
    setEditText(msg.text);
  };

  const saveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed || sending) return;
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const next: ChatMessage[] = [
      ...messages.slice(0, idx),
      { ...messages[idx]!, text: trimmed },
    ];
    setEditId(null);
    setEditText("");
    await runStream(next);
  };

  const confirmDeleteAction = async () => {
    if (!delConfirm || delBusy) return;
    setDelBusy(true);
    try {
      if (delConfirm.kind === "message") {
        const mid = delConfirm.messageId;
        if (
          speakId === mid &&
          typeof window !== "undefined" &&
          "speechSynthesis" in window
        ) {
          window.speechSynthesis.cancel();
          setSpeakId(null);
        }
        const next = messages.filter((m) => m.id !== mid);
        setMessages(next);
        if (activeIdRef.current) await persistMsgs(next);
        setDelConfirm(null);
        return;
      }
      const cid = delConfirm.convId;
      if (getIdToken) {
        await deleteChatConversation(await getIdToken(), cid);
      }
      setConvs((prev) => prev.filter((c) => c.id !== cid));
      if (activeIdRef.current === cid) startNewChat();
      setDelConfirm(null);
    } catch {
      showToast(ui.saveErr);
    } finally {
      setDelBusy(false);
    }
  };

  const expLabels = {
    user: t("chat:userLabel"),
    assistant: t("chat:assistantLabel"),
  };

  const runExport = (
    fmt: "pdf" | "markdown" | "docx",
    title: string,
    items: Array<{
      role: "user" | "assistant";
      text: string;
      modelName?: string;
    }>,
  ) => {
    if (items.length === 0) return;
    if (fmt === "markdown") exportAsMarkdown(title, items, expLabels);
    else if (fmt === "docx") exportAsDocx(title, items, expLabels);
    else exportAsPdf(title, items, expLabels);
    showToast(ui.expDone);
  };

  const exportConv = async (
    cid: string,
    fmt: "pdf" | "markdown" | "docx",
  ) => {
    setMenu(null);
    if (cid === activeIdRef.current) {
      runExport(fmt, convTitle || ui.untitled, messages);
      return;
    }
    if (!getIdToken) return;
    try {
      const d = await getChatConversation(await getIdToken(), cid);
      runExport(fmt, d.title, d.messages);
    } catch {
      showToast(ui.saveErr);
    }
  };

  const shareConv = async (cid: string | null) => {
    setMenu(null);
    if (!cid || cid === activeIdRef.current) {
      if (messages.length === 0) return;
      const txt = buildConversationPlainText(
        convTitle || ui.untitled,
        messages,
        expLabels,
      );
      await shareText(txt, convTitle || ui.untitled);
      return;
    }
    if (!getIdToken) return;
    try {
      const d = await getChatConversation(await getIdToken(), cid);
      const txt = buildConversationPlainText(d.title, d.messages, expLabels);
      await shareText(txt, d.title);
    } catch {
      showToast(ui.saveErr);
    }
  };

  const togglePin = async (cid: string, pinned: boolean) => {
    setMenu(null);
    if (!getIdToken) return;
    try {
      const upd = await updateChatConversation(await getIdToken(), cid, {
        pinned: !pinned,
      });
      setConvs((prev) =>
        sortConvs([upd, ...prev.filter((x) => x.id !== upd.id)]),
      );
      if (activeIdRef.current === cid) setConvPinned(upd.pinned);
    } catch {
      showToast(ui.saveErr);
    }
  };

  const submitModal = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!textModal || modalBusy || !getIdToken) return;
    const val = textModal.value.trim();
    if (textModal.kind === "rename" && !val) return;
    setModalBusy(true);
    try {
      const patch =
        textModal.kind === "rename"
          ? { title: val }
          : { projectName: val || null };
      const upd = await updateChatConversation(
        await getIdToken(),
        textModal.convId,
        patch,
      );
      setConvs((prev) =>
        sortConvs([upd, ...prev.filter((x) => x.id !== upd.id)]),
      );
      if (activeIdRef.current === textModal.convId) {
        setConvTitle(upd.title);
        setConvProject(upd.projectName);
      }
      setTextModal(null);
    } catch {
      showToast(ui.saveErr);
    } finally {
      setModalBusy(false);
    }
  };

  const addHomeScreen = async () => {
    setMenu(null);
    const ev = installRef.current;
    if (ev) {
      try {
        await ev.prompt();
        await ev.userChoice;
        installRef.current = null;
        return;
      } catch {
        // fallback
      }
    }
    setHomeModal(true);
  };

  const openUserMenu = (e: ReactMouseEvent<HTMLElement>, m: ChatMessage) => {
    if (sending) return;
    const p = calcMenuPos(e.currentTarget, 196, 152, isRtl);
    setMenu({ kind: "user", messageId: m.id, top: p.top, left: p.left });
  };

  const openAsstMenu = (
    e: ReactMouseEvent<HTMLButtonElement>,
    m: ChatMessage,
  ) => {
    const p = calcMenuPos(e.currentTarget, 212, 276, isRtl);
    setMenu({ kind: "assistant", messageId: m.id, top: p.top, left: p.left });
  };

  const openHeadMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const p = calcMenuPos(e.currentTarget, 224, 396, isRtl);
    setMenu({ kind: "header", top: p.top, left: p.left });
  };

  const openConvMenu = (
    e: ReactMouseEvent<HTMLButtonElement>,
    cid: string,
  ) => {
    e.stopPropagation();
    const p = calcMenuPos(e.currentTarget, 216, 356, isRtl);
    setMenu({ kind: "conv", convId: cid, top: p.top, left: p.left });
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

  const canRetry = Boolean(
    failCode &&
      failCode !== "missing_key" &&
      models.length > 0 &&
      messages.some((m) => m.role === "user"),
  );
  const statusCls = modelsBusy
    ? "is-loading"
    : selModel
      ? "is-ready"
      : "is-unavailable";
  const statusLbl = modelsBusy
    ? ui.modelLoading
    : selModel
      ? ui.modelReady
      : ui.modelOff;

  const filteredConvs = convs.filter((c) => {
    const q = convSearch.trim().toLocaleLowerCase();
    if (!q) return true;
    return (
      c.title.toLocaleLowerCase().includes(q) ||
      c.lastMessagePreview.toLocaleLowerCase().includes(q) ||
      (c.projectName ?? "").toLocaleLowerCase().includes(q)
    );
  });
  const pinnedList = filteredConvs.filter((c) => c.pinned);
  const recentList = filteredConvs.filter((c) => !c.pinned);

  const menuMsg =
    menu && (menu.kind === "user" || menu.kind === "assistant")
      ? messages.find((m) => m.id === menu.messageId) ?? null
      : null;
  const menuConv =
    menu && menu.kind === "conv"
      ? convs.find((c) => c.id === menu.convId) ?? null
      : null;

  const headerTitle = activeConvId
    ? convTitle || ui.untitled
    : t("chat:title");

  const renderConvRow = (conv: ChatConversationSummary) => (
    <div
      key={conv.id}
      role="button"
      tabIndex={0}
      className={
        `chat-conv-row ${conv.id === activeConvId ? "is-active" : ""}`
      }
      onClick={() => void openConv(conv.id, models)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void openConv(conv.id, models);
        }
      }}
    >
      <span className="chat-conv-icon" aria-hidden="true">
        <MessageSquare size={16} />
      </span>
      <div className="chat-conv-info">
        <strong dir="auto">{conv.title}</strong>
        {conv.projectName && (
          <span className="chat-conv-project">{conv.projectName}</span>
        )}
      </div>
      <span className="chat-conv-time">{relTime(conv.updatedAt, ui)}</span>
      <button
        type="button"
        className="chat-conv-more"
        onClick={(e) => openConvMenu(e, conv.id)}
        aria-label={ui.moreOpts}
      >
        <MoreVertical size={17} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <section
      className="chat-screen"
      dir={isRtl ? "rtl" : "ltr"}
      aria-label={t("chat:title")}
      data-testid="chat-screen"
    >
      <header className="chat-header">
        <div className="chat-header-top">
          <button
            type="button"
            className="chat-icon-button chat-back"
            onClick={() => {
              if (convsOpen) setConvsOpen(false);
              else onBack();
            }}
            aria-label={t("chat:back")}
            data-testid="button-chat-back"
          >
            <ArrowLeft aria-hidden="true" />
          </button>

          <div className="chat-header-title-wrap">
            <h1 data-testid="text-chat-title">
              {convsOpen ? ui.convsTitle : headerTitle}
            </h1>
            {!convsOpen && (convPinned || convProject) && (
              <div className="chat-header-badges">
                {convPinned && (
                  <span className="chat-header-badge">
                    <Pin size={10} aria-hidden="true" />
                    {ui.pinned}
                  </span>
                )}
                {convProject && (
                  <span className="chat-header-badge">
                    <Folder size={10} aria-hidden="true" />
                    {convProject}
                  </span>
                )}
              </div>
            )}
          </div>

          {!convsOpen && (
            <div className="chat-header-actions">
              <button
                type="button"
                className="chat-icon-button"
                onClick={startNewChat}
                aria-label={ui.newChat}
                title={ui.newChat}
                data-testid="button-chat-new"
              >
                <SquarePen aria-hidden="true" />
              </button>
              <button
                type="button"
                className="chat-icon-button"
                onClick={() => {
                  setMenu(null);
                  setConvsOpen(true);
                  void refreshConvs();
                }}
                aria-label={t("chat:history")}
                title={ui.convsTitle}
                data-testid="button-chat-history"
              >
                <History aria-hidden="true" />
              </button>
              <button
                type="button"
                className="chat-icon-button chat-overflow"
                onClick={openHeadMenu}
                aria-label={t("chat:menu")}
                aria-haspopup="menu"
                aria-expanded={menu?.kind === "header"}
                data-testid="button-chat-menu"
              >
                <MoreVertical aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {!convsOpen && (
          <div className="chat-model-bar">
            <button
              type="button"
              className="chat-model-picker-trigger"
              onClick={() => {
                setMenu(null);
                setPickerOpen(true);
              }}
              disabled={sending}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              data-testid="button-chat-model-picker"
            >
              <span className="chat-model-trigger-left">
                <Layers
                  size={15}
                  className="chat-model-trigger-icon"
                  aria-hidden="true"
                />
                <span className="chat-model-trigger-name" dir="ltr">
                  {selModel ? selModel.modelName : t("chat:noUsableModel")}
                </span>
              </span>
              <span className="chat-model-trigger-right">
                <span className={`chat-model-status ${statusCls}`}>
                  <i aria-hidden="true" />
                  {statusLbl}
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </span>
            </button>
          </div>
        )}
      </header>

      {convsOpen ? (
        <section
          className="chat-conversations-view"
          data-testid="chat-conversations-view"
        >
          <div className="chat-conversations-toolbar">
            <label className="chat-conversations-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={convSearch}
                onChange={(e) => setConvSearch(e.currentTarget.value)}
                placeholder={ui.searchConvs}
                aria-label={ui.searchConvs}
              />
            </label>
            <button
              type="button"
              className="chat-new-chat-cta"
              onClick={startNewChat}
              data-testid="button-conversations-new-chat"
            >
              <Plus size={16} aria-hidden="true" />
              <span>{ui.newChat}</span>
            </button>
          </div>

          <div className="chat-conversations-scroll">
            {convsBusy && convs.length === 0 ? (
              <div className="chat-conversations-empty">
                <LoaderCircle
                  className="loading-spinner"
                  size={20}
                  aria-hidden="true"
                />
                <span>{ui.loadingConvs}</span>
              </div>
            ) : filteredConvs.length === 0 ? (
              <div className="chat-conversations-empty">
                <MessageSquare size={22} aria-hidden="true" />
                <span>
                  {convSearch.trim() ? ui.noResults : ui.noConvs}
                </span>
              </div>
            ) : (
              <>
                {pinnedList.length > 0 && (
                  <div className="chat-conv-group">
                    <h2 className="chat-conv-group-title">
                      <Pin size={14} aria-hidden="true" />
                      <span>{ui.pinned}</span>
                    </h2>
                    <div className="chat-conv-list">
                      {pinnedList.map(renderConvRow)}
                    </div>
                  </div>
                )}
                {recentList.length > 0 && (
                  <div className="chat-conv-group">
                    <h2 className="chat-conv-group-title">
                      <Clock size={14} aria-hidden="true" />
                      <span>{ui.recent}</span>
                    </h2>
                    <div className="chat-conv-list">
                      {recentList.map(renderConvRow)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      ) : (
        <>
          <section
            ref={threadRef}
            onScroll={onThreadScroll}
            className="chat-thread"
            aria-live="polite"
            data-testid="chat-thread"
          >
            {((!modelsBusy && models.length === 0) ||
              failCode === "missing_key") && (
              <div className="chat-key-setup" role="status">
                {failCode && failCode !== "missing_key" ? (
                  <p>{t(`chat:${failCode}`)}</p>
                ) : (
                  <p>
                    {setupKey
                      ? t("chat:noChatModels")
                      : t("chat:missing_key")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setupKey ? onOpenModels(setupKey) : onOpenSecrets()
                  }
                  data-testid="button-chat-open-api-keys"
                >
                  {setupKey ? t("chat:openModels") : t("chat:openSecrets")}
                </button>
              </div>
            )}

            {switching ? (
              <div className="chat-conversations-empty">
                <LoaderCircle
                  className="loading-spinner"
                  size={22}
                  aria-hidden="true"
                />
                <span>{ui.openingConv}</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-greeting">
                  <div className="chat-robot" aria-hidden="true">
                    <svg viewBox="0 0 120 100" fill="none">
                      <path
                        d={`m18 11 2.7 6.3L27 20l-6.3 2.7L18 29l-2.7-6.3L9 20l6.3-2.7L18 11Z`}
                        fill="currentColor"
                      />
                      <path
                        d={`m102 20 2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2 2-4.5Z`}
                        fill="currentColor"
                      />
                      <path
                        d={`m105 70 2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2 2-4.5Z`}
                        fill="currentColor"
                      />
                      <path
                        d="M60 17v10"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                      />
                      <circle cx="60" cy="13" r="4" fill="currentColor" />
                      <rect
                        x="31"
                        y="27"
                        width="58"
                        height="43"
                        rx="17"
                        fill="var(--chat-bg)"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <rect
                        x="24"
                        y="39"
                        width="8"
                        height="19"
                        rx="4"
                        fill="currentColor"
                      />
                      <rect
                        x="88"
                        y="39"
                        width="8"
                        height="19"
                        rx="4"
                        fill="currentColor"
                      />
                      <circle cx="49" cy="46" r="4" fill="currentColor" />
                      <circle cx="71" cy="46" r="4" fill="currentColor" />
                      <rect
                        x="49"
                        y="74"
                        width="22"
                        height="11"
                        rx="5.5"
                        fill="currentColor"
                      />
                      <path
                        d="M43 90h34"
                        stroke="currentColor"
                        strokeWidth="6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <h2 className="chat-hello">{t("chat:hello")}</h2>
                  <p className="chat-greeting-help">{t("chat:help")}</p>
                </div>

                <div
                  className="chat-quick-actions"
                  aria-label={t("chat:title")}
                >
                  {actionKeys.map(({ key, icon, fill }) => (
                    <button
                      type="button"
                      className="chat-action"
                      key={key}
                      disabled={!fill}
                      title={!fill ? t("chat:comingSoon") : undefined}
                      data-testid={`button-chat-action-${key}`}
                      onClick={() =>
                        fill && fillDraft(t(`chat:actions.${key}`))
                      }
                    >
                      <span className="chat-action-icon">{icon}</span>
                      <span className="chat-action-label">
                        {t(`chat:actions.${key}`)}
                      </span>
                      {!fill && <small>{t("chat:comingSoon")}</small>}
                    </button>
                  ))}
                </div>

                <section
                  className="chat-ideas"
                  data-testid="chat-suggested-ideas"
                >
                  <button
                    type="button"
                    className="chat-ideas-toggle"
                    aria-expanded={ideasOpen}
                    onClick={() => setIdeasOpen((o) => !o)}
                    data-testid="button-chat-ideas-toggle"
                  >
                    <span className="chat-ideas-title">
                      <Lightbulb aria-hidden="true" />
                      <span>{t("chat:suggestedTitle")}</span>
                    </span>
                    <ChevronDown
                      className={ideasOpen ? "chat-chevron-open" : ""}
                      aria-hidden="true"
                    />
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
                {messages.map((msg) => {
                  const isStr = sending && streamId === msg.id;
                  const isEd = editId === msg.id;

                  if (msg.role === "user") {
                    return (
                      <article
                        className="chat-message chat-user-message"
                        key={msg.id}
                        data-testid={`chat-message-${msg.id}`}
                      >
                        {isEd ? (
                          <div className="chat-inline-edit">
                            <textarea
                              value={editText}
                              onChange={(e) =>
                                setEditText(e.currentTarget.value)
                              }
                              rows={3}
                              maxLength={8000}
                              dir="auto"
                              autoFocus
                            />
                            <div className="chat-inline-edit-actions">
                              <button
                                type="button"
                                className="chat-edit-cancel"
                                onClick={() => {
                                  setEditId(null);
                                  setEditText("");
                                }}
                              >
                                {ui.cancel}
                              </button>
                              <button
                                type="button"
                                className="chat-edit-save"
                                disabled={!editText.trim() || sending}
                                onClick={() => void saveEdit(msg.id)}
                              >
                                {ui.saveSend}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="chat-user-bubble chat-user-bubble-btn"
                            onClick={(e) => openUserMenu(e, msg)}
                            aria-haspopup="menu"
                            aria-label={ui.moreOpts}
                          >
                            <p dir="auto">{msg.text}</p>
                          </button>
                        )}
                      </article>
                    );
                  }

                  return (
                    <article
                      className="chat-message chat-assistant-message"
                      key={msg.id}
                      data-testid={`chat-message-${msg.id}`}
                    >
                      <div className="chat-assistant-head">
                        <span
                          className="chat-assistant-avatar"
                          aria-hidden="true"
                        >
                          <Sparkles size={15} />
                        </span>
                        <span className="chat-assistant-meta">
                          <strong>{t("chat:assistantLabel")}</strong>
                          {msg.modelName && (
                            <code dir="ltr">{msg.modelName}</code>
                          )}
                        </span>
                      </div>
                      <div className="chat-assistant-body">
                        {isStr && !msg.text ? (
                          <div
                            className="chat-generating-indicator"
                            role="status"
                          >
                            <LoaderCircle
                              className="loading-spinner"
                              size={16}
                              aria-hidden="true"
                            />
                            <span>{ui.generating}</span>
                          </div>
                        ) : (
                          <ChatMarkdown
                            content={msg.text}
                            copyLabel={ui.copy}
                            copiedLabel={ui.copied}
                            streaming={isStr}
                          />
                        )}
                        {msg.stopped && (
                          <p className="chat-stopped-note">
                            {ui.stoppedNote}
                          </p>
                        )}
                      </div>
                      {!isStr && msg.text.trim().length > 0 && (
                        <div
                          className="chat-assistant-actions"
                          role="toolbar"
                        >
                          <button
                            type="button"
                            className="chat-msg-action-btn"
                            onClick={() => void copyText(msg.text, msg.id)}
                            aria-label={ui.copy}
                            title={ui.copy}
                          >
                            {copiedId === msg.id ? (
                              <Check size={15} />
                            ) : (
                              <Copy size={15} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="chat-msg-action-btn"
                            onClick={() => void shareText(msg.text)}
                            aria-label={ui.share}
                            title={ui.share}
                          >
                            <Share2 size={15} />
                          </button>
                          <button
                            type="button"
                            className={`chat-msg-action-btn ${
                              speakId === msg.id ? "is-active" : ""
                            }`}
                            onClick={() => readAloud(msg)}
                            aria-label={ui.readAloud}
                            title={ui.readAloud}
                          >
                            {speakId === msg.id ? (
                              <VolumeX size={15} />
                            ) : (
                              <Volume2 size={15} />
                            )}
                          </button>
                          <button
                            type="button"
                            className={`chat-msg-action-btn ${
                              msg.feedback === "like" ? "is-active" : ""
                            }`}
                            onClick={() => setFeedback(msg.id, "like")}
                            aria-label={ui.like}
                            title={ui.like}
                          >
                            <ThumbsUp size={15} />
                          </button>
                          <button
                            type="button"
                            className={`chat-msg-action-btn ${
                              msg.feedback === "dislike" ? "is-negative" : ""
                            }`}
                            onClick={() => setFeedback(msg.id, "dislike")}
                            aria-label={ui.dislike}
                            title={ui.dislike}
                          >
                            <ThumbsDown size={15} />
                          </button>
                          <button
                            type="button"
                            className="chat-msg-action-btn"
                            disabled={sending}
                            onClick={() => void regenerateMsg(msg.id)}
                            aria-label={ui.regenerate}
                            title={ui.regenerate}
                          >
                            <RefreshCw size={15} />
                          </button>
                          <button
                            type="button"
                            className="chat-msg-action-btn"
                            disabled={sending}
                            onClick={(e) => openAsstMenu(e, msg)}
                            aria-haspopup="menu"
                            aria-label={ui.moreOpts}
                            title={ui.moreOpts}
                          >
                            <MoreVertical size={15} />
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {showDown && messages.length > 0 && (
            <button
              type="button"
              className="chat-scroll-bottom-btn"
              onClick={scrollBottom}
              aria-label={ui.scrollDown}
              title={ui.scrollDown}
            >
              <ArrowDown size={17} aria-hidden="true" />
            </button>
          )}

          <footer className="chat-compose-area">
            {toast && (
              <div className="chat-status-toast" role="status">
                {toast}
              </div>
            )}
            <form
              className="chat-composer"
              onSubmit={onSubmitForm}
              data-testid="form-chat-composer"
            >
              <button
                type="button"
                className="chat-composer-tool chat-plus"
                onClick={(e) => openSheet(e.currentTarget)}
                aria-label={t("chat:addToConversation")}
                aria-haspopup="dialog"
                data-testid="button-chat-add"
              >
                <Plus aria-hidden="true" />
              </button>
              <div className="chat-composer-media-tools">
                <button
                  type="button"
                  className="chat-composer-tool"
                  disabled
                  title={t("chat:comingSoon")}
                  aria-label={t("chat:image")}
                  data-testid="button-chat-image"
                >
                  <Image aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-composer-tool chat-file-tool"
                  disabled
                  title={t("chat:comingSoon")}
                  aria-label={t("chat:options.files")}
                  data-testid="button-chat-files"
                >
                  <FileText aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-composer-tool chat-mic-tool"
                  disabled
                  title={t("chat:comingSoon")}
                  aria-label={t("chat:mic")}
                  data-testid="button-chat-mic"
                >
                  <Mic aria-hidden="true" />
                </button>
              </div>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                maxLength={8000}
                placeholder={t("chat:composerPlaceholder")}
                rows={1}
                dir="auto"
                aria-label={t("chat:composerPlaceholder")}
                data-testid="input-chat-message"
              />
              {sending ? (
                <button
                  type="button"
                  className="chat-send-button chat-stop-button"
                  onClick={stopGen}
                  aria-label={ui.stopGen}
                  title={ui.stopGen}
                  data-testid="button-chat-stop"
                >
                  <Square size={16} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="chat-send-button"
                  disabled={!draft.trim() || models.length === 0 || !selModel}
                  aria-label={t("chat:send")}
                  data-testid="button-chat-send"
                >
                  <Send aria-hidden="true" />
                </button>
              )}
            </form>
            {failCode && failCode !== "missing_key" && models.length > 0 && (
              <div
                className="chat-failure-row"
                role="alert"
                data-testid="chat-failure-code"
              >
                <p className="chat-failure-message">
                  {t(`chat:${failCode}`)}
                </p>
                {canRetry && (
                  <button
                    type="button"
                    className="chat-retry-button"
                    disabled={sending}
                    onClick={() => void retryLast()}
                    data-testid="button-chat-retry"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    <span>{ui.retry}</span>
                  </button>
                )}
              </div>
            )}
            <p className="chat-footer-note" data-testid="status-chat-connected">
              <BookOpen aria-hidden="true" />
              <span>{t("chat:footerConnected")}</span>
            </p>
          </footer>
        </>
      )}

      {pickerOpen && (
        <div
          className="chat-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
          data-testid="chat-model-picker-dialog"
        >
          <section
            className="chat-model-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={ui.chooseModel}
          >
            <div className="chat-sheet-grabber" aria-hidden="true" />
            <div className="chat-sheet-heading">
              <h2>{ui.chooseModel}</h2>
              <button
                type="button"
                className="chat-icon-button chat-sheet-close"
                onClick={() => setPickerOpen(false)}
                aria-label={t("chat:close")}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="chat-model-sheet-body">
              {byProvider.length === 0 ? (
                <div className="chat-model-sheet-empty">
                  <p>
                    {setupKey
                      ? t("chat:noChatModels")
                      : t("chat:missing_key")}
                  </p>
                </div>
              ) : (
                byProvider.map(([prov, entries]) => (
                  <div className="chat-model-provider-group" key={prov}>
                    <h3 className="chat-model-provider-title" dir="ltr">
                      {entries[0]?.providerName ?? prov}
                    </h3>
                    <div className="chat-model-option-list">
                      {entries.map((entry) => {
                        const k = modelKey(entry);
                        const on = k === selModelKey;
                        return (
                          <button
                            type="button"
                            key={k}
                            className={`chat-model-option-row ${
                              on ? "is-selected" : ""
                            }`}
                            onClick={() => handleModelSelect(entry)}
                            role="radio"
                            aria-checked={on}
                          >
                            <span
                              className="chat-model-option-name"
                              dir="ltr"
                            >
                              {entry.modelName}
                            </span>
                            <span
                              className={`chat-model-radio ${
                                on ? "is-selected" : ""
                              }`}
                              aria-hidden="true"
                            >
                              <span />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="chat-model-sheet-footer">
              <button
                type="button"
                className="chat-model-manage-btn"
                onClick={() => {
                  setPickerOpen(false);
                  if (setupKey) onOpenModels(setupKey);
                  else onOpenSecrets();
                }}
              >
                <Layers size={15} aria-hidden="true" />
                <span>{ui.manageKeys}</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="chat-floating-menu"
          role="menu"
          style={{ top: menu.top, left: menu.left }}
        >
          {menu.kind === "user" && menuMsg && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void copyText(menuMsg.text, menuMsg.id);
                }}
              >
                <Copy size={16} aria-hidden="true" />
                <span>{ui.copy}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => startEdit(menuMsg)}
              >
                <Pencil size={16} aria-hidden="true" />
                <span>{ui.editRequest}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(null);
                  setDelConfirm({ kind: "message", messageId: menuMsg.id });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>{ui.del}</span>
              </button>
            </>
          )}

          {menu.kind === "assistant" && menuMsg && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void copyText(menuMsg.text, menuMsg.id);
                }}
              >
                <Copy size={16} aria-hidden="true" />
                <span>{ui.copy}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void regenerateMsg(menuMsg.id)}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>{ui.regenerate}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  runExport("pdf", convTitle || ui.untitled, [menuMsg]);
                }}
              >
                <FileText size={16} aria-hidden="true" />
                <span>{ui.expPdf}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  runExport("markdown", convTitle || ui.untitled, [menuMsg]);
                }}
              >
                <Code2 size={16} aria-hidden="true" />
                <span>{ui.expMd}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  runExport("docx", convTitle || ui.untitled, [menuMsg]);
                }}
              >
                <FileCode2 size={16} aria-hidden="true" />
                <span>{ui.expDocx}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(null);
                  setDelConfirm({ kind: "message", messageId: menuMsg.id });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>{ui.del}</span>
              </button>
            </>
          )}

          {menu.kind === "header" && (
            <>
              {activeConvId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void togglePin(activeConvId, convPinned)}
                >
                  {convPinned ? (
                    <PinOff size={16} aria-hidden="true" />
                  ) : (
                    <Pin size={16} aria-hidden="true" />
                  )}
                  <span>{convPinned ? ui.unpin : ui.pin}</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={messages.length === 0}
                onClick={() => void shareConv(activeConvId)}
              >
                <Share2 size={16} aria-hidden="true" />
                <span>{ui.share}</span>
              </button>
              {activeConvId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setTextModal({
                      kind: "rename",
                      convId: activeConvId,
                      value: convTitle || ui.untitled,
                    });
                  }}
                >
                  <Pencil size={16} aria-hidden="true" />
                  <span>{ui.rename}</span>
                </button>
              )}
              {activeConvId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setTextModal({
                      kind: "project",
                      convId: activeConvId,
                      value: convProject ?? "",
                    });
                  }}
                >
                  <FolderPlus size={16} aria-hidden="true" />
                  <span>{ui.addProject}</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => void addHomeScreen()}
              >
                <Smartphone size={16} aria-hidden="true" />
                <span>{ui.addHome}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={messages.length === 0}
                onClick={() => {
                  setMenu(null);
                  runExport("pdf", convTitle || ui.untitled, messages);
                }}
              >
                <FileText size={16} aria-hidden="true" />
                <span>{ui.expPdf}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={messages.length === 0}
                onClick={() => {
                  setMenu(null);
                  runExport("markdown", convTitle || ui.untitled, messages);
                }}
              >
                <Code2 size={16} aria-hidden="true" />
                <span>{ui.expMd}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={messages.length === 0}
                onClick={() => {
                  setMenu(null);
                  runExport("docx", convTitle || ui.untitled, messages);
                }}
              >
                <FileCode2 size={16} aria-hidden="true" />
                <span>{ui.expDocx}</span>
              </button>
              {activeConvId && (
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setMenu(null);
                    setDelConfirm({
                      kind: "conv",
                      convId: activeConvId,
                      title: convTitle || ui.untitled,
                    });
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  <span>{ui.del}</span>
                </button>
              )}
            </>
          )}

          {menu.kind === "conv" && menuConv && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void togglePin(menuConv.id, menuConv.pinned)
                }
              >
                {menuConv.pinned ? (
                  <PinOff size={16} aria-hidden="true" />
                ) : (
                  <Pin size={16} aria-hidden="true" />
                )}
                <span>{menuConv.pinned ? ui.unpin : ui.pin}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void shareConv(menuConv.id)}
              >
                <Share2 size={16} aria-hidden="true" />
                <span>{ui.share}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  setTextModal({
                    kind: "rename",
                    convId: menuConv.id,
                    value: menuConv.title,
                  });
                }}
              >
                <Pencil size={16} aria-hidden="true" />
                <span>{ui.rename}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  setTextModal({
                    kind: "project",
                    convId: menuConv.id,
                    value: menuConv.projectName ?? "",
                  });
                }}
              >
                <FolderPlus size={16} aria-hidden="true" />
                <span>{ui.addProject}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void exportConv(menuConv.id, "pdf")}
              >
                <FileText size={16} aria-hidden="true" />
                <span>{ui.expPdf}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void exportConv(menuConv.id, "markdown")}
              >
                <Code2 size={16} aria-hidden="true" />
                <span>{ui.expMd}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void exportConv(menuConv.id, "docx")}
              >
                <FileCode2 size={16} aria-hidden="true" />
                <span>{ui.expDocx}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(null);
                  setDelConfirm({
                    kind: "conv",
                    convId: menuConv.id,
                    title: menuConv.title,
                  });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span>{ui.del}</span>
              </button>
            </>
          )}
        </div>
      )}

      {delConfirm && (
        <div
          className="chat-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !delBusy) {
              setDelConfirm(null);
            }
          }}
        >
          <section
            className="chat-dialog-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h2>
              {delConfirm.kind === "message"
                ? ui.delMsgTitle
                : ui.delConvTitle}
            </h2>
            <p>
              {delConfirm.kind === "message"
                ? ui.delMsgDesc
                : `${ui.delConvDesc} (${delConfirm.title})`}
            </p>
            <div className="chat-dialog-actions">
              <button
                type="button"
                className="chat-edit-cancel"
                disabled={delBusy}
                onClick={() => setDelConfirm(null)}
              >
                {ui.cancel}
              </button>
              <button
                type="button"
                className="chat-dialog-danger-btn"
                disabled={delBusy}
                onClick={() => void confirmDeleteAction()}
              >
                {delBusy && (
                  <LoaderCircle
                    className="loading-spinner"
                    size={14}
                    aria-hidden="true"
                  />
                )}
                <span>{ui.confirmDel}</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {textModal && (
        <div
          className="chat-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !modalBusy) {
              setTextModal(null);
            }
          }}
        >
          <form
            className="chat-dialog-card"
            onSubmit={(e) => void submitModal(e)}
          >
            <h2>
              {textModal.kind === "rename"
                ? ui.renameTitle
                : ui.projectTitle}
            </h2>
            <input
              type="text"
              className="chat-dialog-input"
              value={textModal.value}
              maxLength={textModal.kind === "rename" ? 120 : 80}
              placeholder={
                textModal.kind === "rename" ? ui.renameHint : ui.projectHint
              }
              onChange={(e) =>
                setTextModal({ ...textModal, value: e.currentTarget.value })
              }
              dir="auto"
              autoFocus
            />
            <div className="chat-dialog-actions">
              {textModal.kind === "project" && textModal.value.trim() && (
                <button
                  type="button"
                  className="chat-edit-cancel"
                  disabled={modalBusy}
                  onClick={() => setTextModal({ ...textModal, value: "" })}
                >
                  {ui.clearProject}
                </button>
              )}
              <button
                type="button"
                className="chat-edit-cancel"
                disabled={modalBusy}
                onClick={() => setTextModal(null)}
              >
                {ui.cancel}
              </button>
              <button
                type="submit"
                className="chat-edit-save"
                disabled={
                  modalBusy ||
                  (textModal.kind === "rename" && !textModal.value.trim())
                }
              >
                {ui.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {homeModal && (
        <div
          className="chat-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setHomeModal(false);
          }}
        >
          <section
            className="chat-dialog-card"
            role="dialog"
            aria-modal="true"
          >
            <h2>{ui.homeTitle}</h2>
            <p>{ui.homeSteps}</p>
            <div className="chat-dialog-actions">
              <button
                type="button"
                className="chat-edit-save"
                onClick={() => setHomeModal(false)}
              >
                {ui.homeDone}
              </button>
            </div>
          </section>
        </div>
      )}

      {sheetOpen && (
        <div
          className={`chat-sheet-backdrop ${
            fullListOpen ? "chat-sheet-backdrop-expanded" : ""
          }`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSheetOpen(false);
              setFullListOpen(false);
            }
          }}
          data-testid="chat-add-backdrop"
        >
          <section
            className={`chat-sheet ${
              fullListOpen ? "chat-sheet-expanded" : ""
            }`}
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
              <h2 id="chat-sheet-title">
                {fullListOpen
                  ? t("chat:attachmentsTitle")
                  : t("chat:addToConversation")}
              </h2>
            </div>
            {!fullListOpen ? (
              <div className="chat-attachment-grid">
                {allOptions.map((opt) =>
                  opt === "more" ? (
                    <button
                      type="button"
                      className="chat-attachment-option"
                      key={opt}
                      onClick={() => setFullListOpen(true)}
                      data-testid="button-chat-option-more"
                    >
                      <span className="chat-option-icon">
                        {iconForOption(opt)}
                      </span>
                      <span>{t(`chat:options.${opt}`)}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="chat-attachment-option"
                      key={opt}
                      disabled
                      title={t("chat:comingSoon")}
                      data-testid={`button-chat-option-${opt}`}
                    >
                      <span className="chat-option-icon">
                        {iconForOption(opt)}
                      </span>
                      <span>{t(`chat:options.${opt}`)}</span>
                      <small>{t("chat:comingSoon")}</small>
                    </button>
                  ),
                )}
              </div>
            ) : (
              <div className="chat-option-list" data-testid="chat-all-options">
                {allOptions.map((opt) => (
                  <button
                    type="button"
                    className="chat-option-row"
                    key={opt}
                    disabled
                    title={t("chat:comingSoon")}
                    data-testid={`button-chat-full-option-${opt}`}
                  >
                    <span className="chat-option-icon">
                      {iconForOption(opt)}
                    </span>
                    <span className="chat-option-name">
                      {t(`chat:options.${opt}`)}
                    </span>
                    <span className="chat-coming-soon">
                      {t("chat:comingSoon")}
                    </span>
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
