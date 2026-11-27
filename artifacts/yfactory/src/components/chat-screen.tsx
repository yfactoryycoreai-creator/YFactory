import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Download,
  FileCode2,
  FileText,
  Video,
  Folder,
  FolderPlus,
  Globe,
  GraduationCap,
  History,
  Image,
  Layers,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  MoreVertical,
  Paperclip,
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
  Wand2,
  X,
} from "lucide-react";
import "./chat-screen.css";
import { useAuth } from "@/auth/AuthProvider";
import ChatAgentCard, {
  type ChatAgentCardState,
} from "@/components/chat-agent-card";
import ChatMarkdown from "@/components/chat-markdown";
import ChatStoryPicker from "@/components/chat-story-picker";
import AgentTaskDrawer from "@/components/agent-task-drawer";
import InAppCameraModal from "@/components/in-app-camera-modal";
import SkillsHubModal from "@/components/skills-hub-modal";
import {
  buildSkillsSystemDirective,
  getLocalizedSkillName,
  useYFactorySkills,
  type SkillScope,
} from "@/lib/skillsStore";
import { sendYFactoryNotification } from "@/lib/yfactoryNotifications";
import {
  cancelAgentTaskApi,
  clearFinishedAgentTasksApi,
  createClientAgentTask,
  deleteAgentTaskApi,
  executeServerAgentToolApi,
  fetchAgentTasks,
  patchClientAgentTask,
  retryAgentTaskApi,
  type AgentSectionTarget,
  type AgentTaskItem,
} from "@/lib/agentTasksApi";
import {
  buildCodeAgentSystemPrompt,
  buildImageAgentSystemPrompt,
  buildStoryAgentSystemPrompt,
  buildStudentsAgentSystemPrompt,
  buildUnifiedAgentSystemPrompt,
  modelSupportsVideoInput,
  buildYFactoryChatSystemPrompt,
  extractAgentCommand,
  readChatAutoNavigate,
  type ChatAgentCommand,
  type ChatAgentMode,
  type ChatAgentRunResult,
  type ImageAgentCommand,
  type StoryAgentCommand,
} from "@/lib/chatAgent";
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
  type ChatImageAttachment,
  type ChatMessageInput,
  type ChatModelOption,
  type StoredChatAttachmentMeta,
  type StoredChatFeedback,
  type StoredChatMessage,
  type StoredGeneratedImageRef,
} from "@/lib/chatApi";
import {
  buildFileContextSuffix,
  buildStorySystemPrompt,
  formatFileSize,
  isImageFile,
  isVoiceInputSupported,
  makeAttachmentId,
  MAX_PENDING_ATTACHMENTS,
  processFileAttachment,
  processImageAttachment,
  resolveSpeechLocale,
  startVoiceRecognition,
  type PendingAttachment,
} from "@/lib/chatAttachments";
import {
  buildConversationPlainText,
  exportAsDocx,
  exportAsMarkdown,
  exportAsPdf,
} from "@/lib/chatExport";

import { getChatUiStrings, type ChatUiStrings } from "@/lib/chatUiStrings";
import { isRtlLanguage } from "@/lib/languages";
import { loadVaultKeys, type VaultKey } from "@/lib/apiKeyVault";
import type { StoryRecord } from "@/lib/stories";

type ChatScreenProps = {
  onBack: () => void;
  getIdToken?: () => Promise<string>;
  onOpenSecrets: () => void;
  onOpenModels: (key: Pick<VaultKey, "provider" | "id">) => void;
  onExecuteImageAgent?: (
    cmd: ImageAgentCommand,
    autoNavigate: boolean,
  ) => Promise<ChatAgentRunResult>;
  onExecuteStoryAgent?: (
    cmd: StoryAgentCommand,
    autoNavigate: boolean,
  ) => Promise<ChatAgentRunResult>;
  onOpenImagePage?: () => void;
  onOpenStoryPage?: (storyId?: string) => void;
  onOpenCodePage?: () => void;
  onOpenStudentsPage?: () => void;
  onOpenProviderCenter?: (providerId?: string) => void;
  onOpenSkills?: (scope?: SkillScope) => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  modelName?: string;
  feedback?: StoredChatFeedback;
  stopped?: boolean;
  attachments?: StoredChatAttachmentMeta[];
  previewImages?: string[];
  generatedImages?: StoredGeneratedImageRef[];
  agentAction?: ChatAgentCardState;
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

const iconForOption = (name: string) => {
  switch (name) {
    case "camera":
      return <Camera aria-hidden="true" />;
    case "recordVideo":
      return <Video aria-hidden="true" />;
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

function buildCtx(
  list: ChatMessage[],
  story: StoryRecord | null,
  mode: ChatAgentMode,
  lastImages?: ChatImageAttachment[],
  lastFileSuffix?: string,
): ChatMessageInput[] {
  const base: ChatMessageInput[] = list
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text }))
    .slice(-MAX_CTX);

  if (base.length > 0) {
    const last = base[base.length - 1]!;
    if (last.role === "user") {
      if (lastFileSuffix) {
        last.content = `${last.content}${lastFileSuffix}`;
      }
      if (lastImages && lastImages.length > 0) {
        last.images = lastImages;
      }
    }
  }

  const withSkills = (
    sys: string,
    primaryScope: SkillScope,
    extra: SkillScope[] = [],
  ): string => {
    const directive = buildSkillsSystemDirective(primaryScope, extra);
    return directive ? `${sys}\n\n${directive}` : sys;
  };

  if (mode === "image") {
    return [
      {
        role: "system",
        content: withSkills(buildImageAgentSystemPrompt(), "image", ["chat"]),
      },
      ...base,
    ];
  }
  if (mode === "story") {
    return [
      {
        role: "system",
        content: withSkills(buildStoryAgentSystemPrompt(story), "stories", ["chat"]),
      },
      ...base,
    ];
  }
  if (mode === "agent") {
    return [
      {
        role: "system",
        content: withSkills(buildUnifiedAgentSystemPrompt(story), "all"),
      },
      ...base,
    ];
  }
  if (mode === "code") {
    return [
      {
        role: "system",
        content: withSkills(buildCodeAgentSystemPrompt(), "code", ["chat"]),
      },
      ...base,
    ];
  }
  if (mode === "students") {
    return [
      {
        role: "system",
        content: withSkills(buildStudentsAgentSystemPrompt(), "students", ["chat"]),
      },
      ...base,
    ];
  }
  const chatSys = story
    ? `${buildYFactoryChatSystemPrompt(story)}\n\n${buildStorySystemPrompt(story)}`
    : buildYFactoryChatSystemPrompt(null);
  return [
    {
      role: "system",
      content: withSkills(chatSys, "chat", story ? ["stories"] : []),
    },
    ...base,
  ];
}

function speechLang(text: string, fallback: string): string {
  return resolveSpeechLocale(fallback, text);
}

function relTime(ts: number, ui: ChatUiStrings): string {
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
    ...(m.attachments && m.attachments.length > 0
      ? { attachments: m.attachments }
      : {}),
    ...(m.generatedImages && m.generatedImages.length > 0
      ? {
          generatedImages: m.generatedImages.filter((g) =>
            g.url.startsWith("https://"),
          ),
        }
      : {}),
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

function attachmentErrLabel(code: string | undefined, ui: ChatUiStrings): string {
  if (code === "image_too_large" || code === "file_too_large") {
    return ui.attTooLarge;
  }
  if (code === "unsupported_file_type") return ui.attUnsupported;
  if (code === "empty_file") return ui.attEmpty;
  return ui.attReadErr;
}

export default function ChatScreen({
  onBack,
  getIdToken,
  onOpenSecrets,
  onOpenModels,
  onExecuteImageAgent,
  onExecuteStoryAgent,
  onOpenImagePage,
  onOpenStoryPage,
  onOpenCodePage,
  onOpenStudentsPage,
  onOpenProviderCenter,
  onOpenSkills,
}: ChatScreenProps) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = isRtlLanguage(locale);
  const ui = getChatUiStrings(locale);

  const [draft, setDraft] = useState("");
  const [ideasOpen, setIdeasOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fullListOpen, setFullListOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
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
  const [customErr, setCustomErr] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakId, setSpeakId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showDown, setShowDown] = useState(false);

  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachedStory, setAttachedStory] = useState<StoryRecord | null>(null);
  const [agentMode, setAgentMode] = useState<ChatAgentMode>("chat");
  const imgGenMode = agentMode === "image";
  const storyAgentMode = agentMode === "story";
  const [agentTasks, setAgentTasks] = useState<AgentTaskItem[]>([]);
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);

  const activeAgentTaskCount = agentTasks.filter(
    (t) => t.status === "queued" || t.status === "running",
  ).length;

  const refreshAgentTasks = useCallback(async () => {
    if (!getIdToken) return;
    setTasksLoading(true);
    try {
      const tok = await getIdToken();
      const list = await fetchAgentTasks(tok);
      setAgentTasks(list);
    } catch {
      // Keep last known tasks on transient error.
    } finally {
      setTasksLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void refreshAgentTasks();
  }, [refreshAgentTasks]);

  useEffect(() => {
    if (activeAgentTaskCount === 0 || !getIdToken) return;
    const timer = window.setInterval(() => {
      void refreshAgentTasks();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [activeAgentTaskCount, getIdToken, refreshAgentTasks]);

  const handleCancelAgentTask = async (taskId: string) => {
    if (!getIdToken) return;
    setTaskBusyId(taskId);
    try {
      const tok = await getIdToken();
      const up = await cancelAgentTaskApi(tok, taskId);
      setAgentTasks((prev) => prev.map((t) => (t.id === up.id ? up : t)));
    } finally {
      setTaskBusyId(null);
    }
  };

  const handleRetryAgentTask = async (task: AgentTaskItem) => {
    if (!getIdToken) return;
    setTaskBusyId(task.id);
    try {
      const tok = await getIdToken();
      await retryAgentTaskApi(tok, task.id);
      await refreshAgentTasks();
    } finally {
      setTaskBusyId(null);
    }
  };

  const handleDeleteAgentTask = async (taskId: string) => {
    if (!getIdToken) return;
    setTaskBusyId(taskId);
    try {
      const tok = await getIdToken();
      await deleteAgentTaskApi(tok, taskId);
      setAgentTasks((prev) => prev.filter((t) => t.id !== taskId));
    } finally {
      setTaskBusyId(null);
    }
  };

  const handleClearFinishedTasks = async () => {
    if (!getIdToken) return;
    setTasksLoading(true);
    try {
      const tok = await getIdToken();
      await clearFinishedAgentTasksApi(tok);
      await refreshAgentTasks();
    } finally {
      setTasksLoading(false);
    }
  };

  const handleOpenTaskSection = (
    section: AgentSectionTarget,
    ref?: AgentTaskItem["targetRef"],
  ) => {
    if (section === "image") onOpenImagePage?.();
    else if (section === "stories") onOpenStoryPage?.(ref?.storyId);
    else if (section === "code") onOpenCodePage?.();
    else if (section === "students") onOpenStudentsPage?.();
    else if (section === "provider_center") {
      if (onOpenProviderCenter) onOpenProviderCenter(ref?.providerId);
      else onOpenSecrets();
    }
  };
  const [listening, setListening] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [menu, setMenu] = useState<FloatingMenuState>(null);
  const [delConfirm, setDelConfirm] = useState<ConfirmDeleteState>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [textModal, setTextModal] = useState<TextModalState>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [homeModal, setHomeModal] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const stopVoiceRef = useRef<(() => void) | null>(null);
  const attCtrlRef = useRef(new Map<string, AbortController>());
  const installRef = useRef<BeforeInstallPromptEvent | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cameraMode, setCameraMode] = useState<"photo" | "video" | null>(null);
  const [localSkillsOpen, setLocalSkillsOpen] = useState(false);
  const { getActiveForScope, toggleSkill } = useYFactorySkills(getIdToken);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
    stopVoiceRef.current?.();
    attCtrlRef.current.forEach((ctrl) => ctrl.abort());
    attCtrlRef.current.clear();
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
      setCustomErr("");
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
            attachments: m.attachments,
            generatedImages: m.generatedImages,
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

  const runAttachmentTask = useCallback(
    async (item: PendingAttachment) => {
      const ctrl = new AbortController();
      attCtrlRef.current.set(item.id, ctrl);
      try {
        if (item.kind === "image") {
          const res = await processImageAttachment(item.file, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "ready",
                    image: res.image,
                    previewUrl: res.previewUrl,
                    error: undefined,
                  }
                : a,
            ),
          );
        } else {
          const content = await processFileAttachment(item.file, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "ready",
                    textContent: content,
                    error: undefined,
                  }
                : a,
            ),
          );
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const code = err instanceof Error ? err.message : "read_failed";
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === item.id ? { ...a, status: "error", error: code } : a,
          ),
        );
      } finally {
        attCtrlRef.current.delete(item.id);
      }
    },
    [],
  );

  const enqueueFiles = (
    fileList: FileList | File[] | null,
    forcedKind?: "image" | "file",
  ) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.isArray(fileList) ? fileList : Array.from(fileList);
    const available = MAX_PENDING_ATTACHMENTS - attachments.length;
    if (available <= 0) {
      showToast(ui.attLimit);
      return;
    }
    const picked = files.slice(0, available);
    if (files.length > available) showToast(ui.attLimit);

    const newItems: PendingAttachment[] = picked.map((file) => ({
      id: makeAttachmentId(),
      kind: forcedKind ?? (isImageFile(file) ? "image" : "file"),
      name: file.name || "attachment",
      sizeBytes: file.size,
      status: "processing",
      file,
    }));
    setAttachments((prev) => [...prev, ...newItems]);
    for (const item of newItems) {
      void runAttachmentTask(item);
    }
  };

  const onFileInputChange = (
    e: ChangeEvent<HTMLInputElement>,
    forcedKind?: "image" | "file",
  ) => {
    enqueueFiles(e.currentTarget.files, forcedKind);
    e.currentTarget.value = "";
  };

  const removeAttachment = (id: string) => {
    const ctrl = attCtrlRef.current.get(id);
    if (ctrl) {
      ctrl.abort();
      attCtrlRef.current.delete(id);
    }
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const retryAttachment = (id: string) => {
    const target = attachments.find((a) => a.id === id);
    if (!target) return;
    const reset: PendingAttachment = {
      ...target,
      status: "processing",
      error: undefined,
    };
    setAttachments((prev) => prev.map((a) => (a.id === id ? reset : a)));
    void runAttachmentTask(reset);
  };

  const toggleVoiceInput = () => {
    if (listening) {
      stopVoiceRef.current?.();
      stopVoiceRef.current = null;
      setListening(false);
      return;
    }
    if (!isVoiceInputSupported()) {
      showToast(ui.voiceUnsupported);
      return;
    }
    const baseDraft = draft.trim();
    setListening(true);
    const stopFn = startVoiceRecognition({
      lang: locale,
      onTranscript: (spoken, isFinal) => {
        const merged = baseDraft ? `${baseDraft} ${spoken}` : spoken;
        setDraft(merged);
        if (isFinal) {
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      },
      onError: () => {
        setListening(false);
        stopVoiceRef.current = null;
        showToast(ui.voiceError);
      },
      onEnd: () => {
        setListening(false);
        stopVoiceRef.current = null;
      },
    });
    if (!stopFn) {
      setListening(false);
      showToast(ui.voiceUnsupported);
      return;
    }
    stopVoiceRef.current = stopFn;
  };

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
    stopVoiceRef.current?.();
    setListening(false);
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
    setAttachments([]);
    setAgentMode("chat");
    setFailCode("");
    setCustomErr("");
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

  const triggerSheetOption = (opt: string) => {
    setSheetOpen(false);
    setFullListOpen(false);
    if (opt === "camera") {
      setCameraMode("photo");
    } else if (opt === "recordVideo") {
      if (!videoSupported) {
        showToast(
          locale.startsWith("ar")
            ? "النموذج المختار لا يدعم تحليل الفيديو — اختر Gemini أو نموذج رؤية."
            : "Selected model does not support video — switch to Gemini or a vision model.",
        );
        return;
      }
      setCameraMode("video");
    } else if (opt === "photos") {
      photoRef.current?.click();
    } else if (opt === "files") {
      fileRef.current?.click();
    } else if (opt === "myStories") {
      setStoryPickerOpen(true);
    } else if (opt === "skills") {
      openChatSkillsHub();
    }
  };

  const stopGen = () => {
    abortRef.current?.abort();
  };

  const executeAgentCommand = async (
    msgId: string,
    cmd: ChatAgentCommand,
    baseMsgs: ChatMessage[],
  ) => {
    const autoNav = readChatAutoNavigate();
    const tok = getIdToken ? await getIdToken().catch(() => null) : null;

    if (cmd.type === "generate_image") {
      if (!onExecuteImageAgent) return;
      let persistedId: string | undefined;
      if (tok) {
        const created = await createClientAgentTask(tok, {
          toolName: "generate_image",
          section: "image",
          title: `Image (${cmd.count}): ${cmd.prompt.slice(0, 65)}`,
          status: "running",
          progress: 20,
          stepLabel: `Generating ${cmd.count} image(s)...`,
          payload: { prompt: cmd.prompt, count: cmd.count },
        }).catch(() => null);
        persistedId = created?.id;
        if (created) setAgentTasks((prev) => [created, ...prev]);
      }

      const res = await onExecuteImageAgent(cmd, autoNav);
      if (tok && persistedId) {
        const patched = await patchClientAgentTask(tok, persistedId, {
          status: res.ok ? "completed" : "failed",
          progress: res.ok ? 100 : 0,
          stepLabel: res.ok ? "Images ready" : "Generation failed",
          resultSummary: res.ok
            ? `Generated ${res.generatedImages?.length ?? cmd.count} image(s) in Image workspace.`
            : null,
          errorMessage: res.errorMessage ?? null,
        }).catch(() => null);
        if (patched) {
          setAgentTasks((prev) => prev.map((t) => (t.id === patched.id ? patched : t)));
        }
      }

      const updated = baseMsgs.map((m) =>
        m.id === msgId
          ? {
              ...m,
              ...(res.generatedImages &&
              res.generatedImages.length > 0 &&
              !res.navigated
                ? { generatedImages: res.generatedImages }
                : {}),
              agentAction: {
                command: cmd,
                status: res.ok ? ("done" as const) : ("error" as const),
                ...(persistedId ? { taskId: persistedId } : {}),
                ...(res.errorMessage ? { errorMessage: res.errorMessage } : {}),
              },
            }
          : m,
      );
      setMessages(updated);
      await persistMsgs(updated, selModel);
      return;
    }

    if (cmd.type === "story_setup") {
      if (!onExecuteStoryAgent) return;
      let persistedId: string | undefined;
      if (tok) {
        const created = await createClientAgentTask(tok, {
          toolName: "story_setup",
          section: "stories",
          title: `Story (${cmd.targetCount} scenes): ${cmd.storyName}`,
          status: "running",
          progress: 25,
          stepLabel: cmd.startGeneration
            ? `Preparing & starting ${cmd.targetCount} scene renders...`
            : `Saving story script (${cmd.targetCount} scenes)...`,
          payload: {
            storyName: cmd.storyName,
            targetCount: cmd.targetCount,
            aspectRatio: cmd.aspectRatio,
            startGeneration: cmd.startGeneration,
          },
        }).catch(() => null);
        persistedId = created?.id;
        if (created) setAgentTasks((prev) => [created, ...prev]);
      }

      const res = await onExecuteStoryAgent(cmd, autoNav);
      if (res.ok && res.storyId) {
        setAttachedStory({
          id: res.storyId,
          storyName: cmd.storyName,
          script: cmd.script,
          createdAt: new Date(),
          imageCount: attachedStory?.id === res.storyId ? attachedStory.imageCount : 0,
          storageBytes: attachedStory?.id === res.storyId ? attachedStory.storageBytes : 0,
          targetCount: cmd.targetCount,
          aspectRatio: cmd.aspectRatio,
          characterTraits: cmd.characterTraits,
          keepOneProvider: cmd.keepOneProvider,
          providerSwitchPending: false,
        });
      }
      if (tok && persistedId) {
        const patched = await patchClientAgentTask(tok, persistedId, {
          status: res.ok ? "completed" : "failed",
          progress: res.ok ? 100 : 0,
          stepLabel: res.ok
            ? cmd.startGeneration
              ? `Scene rendering started (${cmd.targetCount} scenes)`
              : "Story saved in My Stories"
            : "Story action failed",
          resultSummary: res.ok
            ? `Story "${cmd.storyName}" (${cmd.targetCount} scenes) is ready in My Stories.`
            : null,
          targetRef: res.storyId ? { storyId: res.storyId } : null,
          errorMessage: res.errorMessage ?? null,
        }).catch(() => null);
        if (patched) {
          setAgentTasks((prev) => prev.map((t) => (t.id === patched.id ? patched : t)));
        }
      }

      const updated = baseMsgs.map((m) =>
        m.id === msgId
          ? {
              ...m,
              agentAction: {
                command: cmd,
                status: res.ok ? ("done" as const) : ("error" as const),
                ...(persistedId ? { taskId: persistedId } : {}),
                ...(res.storyId ? { storyId: res.storyId } : {}),
                ...(res.errorMessage ? { errorMessage: res.errorMessage } : {}),
              },
            }
          : m,
      );
      setMessages(updated);
      await persistMsgs(updated, selModel);
      return;
    }

    // Server-orchestrated tools: code_workspace_task, student_study_assist, provider_recommend
    if (!tok) return;
    try {
      const execRes = await executeServerAgentToolApi(
        tok,
        cmd.type,
        cmd as unknown as Record<string, unknown>,
      );
      const task = execRes.task;
      setAgentTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
      const isOk = execRes.data.ok !== false && task.status !== "failed";

      const updated = baseMsgs.map((m) =>
        m.id === msgId
          ? {
              ...m,
              agentAction: {
                command: cmd,
                status: isOk ? ("done" as const) : ("error" as const),
                taskId: task.id,
                ...(task.targetRef?.providerId ? { providerId: task.targetRef.providerId } : {}),
                ...(task.resultSummary ? { resultSummary: task.resultSummary } : {}),
                ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
              },
            }
          : m,
      );
      setMessages(updated);
      await persistMsgs(updated, selModel);

      if (isOk) {
        void sendYFactoryNotification(
          locale.startsWith("ar") ? "اكتملت مهمة الوكيل" : "Agent Task Complete",
          task.resultSummary || task.title,
          {
            section:
              task.section === "provider_center" ? "chat" : task.section,
            tag: `agent-${task.id}`,
          },
        );
      }
      if (isOk && autoNav) {
        if (cmd.type === "student_study_assist") onOpenStudentsPage?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent action failed.";
      const updated = baseMsgs.map((m) =>
        m.id === msgId
          ? {
              ...m,
              agentAction: {
                command: cmd,
                status: "error" as const,
                errorMessage: msg,
              },
            }
          : m,
      );
      setMessages(updated);
      await persistMsgs(updated, selModel);
    }
  };

  const runDirectImageAgent = async (
    hist: ChatMessage[],
    promptText: string,
  ) => {
    if (sending) return;
    const aid = makeMsgId();
    const ats = Date.now();
    const { command } = extractAgentCommand("", "image", promptText, null);
    if (!command || command.type !== "generate_image") return;

    setFailCode("");
    setCustomErr("");
    setSending(true);
    const initial: ChatMessage[] = [
      ...hist,
      {
        id: aid,
        role: "assistant",
        text: ui.imgGenDone,
        modelName: "Image Agent",
        agentAction: { command, status: "running" },
        feedback: null,
        createdAt: ats,
      },
    ];
    setMessages(initial);
    try {
      await persistMsgs(initial, selModel);
      await executeAgentCommand(aid, command, initial);
    } finally {
      setSending(false);
    }
  };

  const runStream = async (
    hist: ChatMessage[],
    imgs?: ChatImageAttachment[],
    fileSuffix?: string,
  ) => {
    if (sending) return;
    if (models.length === 0 || !selModel) {
      setFailCode("missing_key");
      return;
    }
    if (!getIdToken) {
      setFailCode("auth_failed");
      return;
    }
    const modeAtSend = agentMode;
    const reqMsgs = buildCtx(hist, attachedStory, modeAtSend, imgs, fileSuffix);
    if (
      reqMsgs.length === 0 ||
      reqMsgs[reqMsgs.length - 1]?.role !== "user"
    ) {
      return;
    }

    const lastUserText =
      [...hist].reverse().find((m) => m.role === "user")?.text ?? "";

    const aid = makeMsgId();
    const ats = Date.now();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    autoScrollRef.current = true;
    setFailCode("");
    setCustomErr("");
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
    let parsedCmd: ChatAgentCommand | null = null;
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
      const extracted = extractAgentCommand(
        acc,
        modeAtSend,
        lastUserText,
        attachedStory,
      );
      parsedCmd = extracted.command;
      finalMsgs = [
        ...hist,
        {
          id: aid,
          role: "assistant",
          text: extracted.cleanText,
          modelName: selModel.modelName,
          ...(parsedCmd
            ? {
                agentAction: {
                  command: parsedCmd,
                  status: "running" as const,
                },
              }
            : {}),
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
      if (parsedCmd) {
        await executeAgentCommand(aid, parsedCmd, finalMsgs);
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const hasProcessingAtt = attachments.some((a) => a.status === "processing");
  const readyAttachments = attachments.filter((a) => a.status === "ready");

  const submitDraft = async () => {
    if (sending || hasProcessingAtt) return;
    const rawText = draft.trim();

    if (imgGenMode && (models.length === 0 || !selModel)) {
      if (!rawText) return;
      const uMsg: ChatMessage = {
        id: makeMsgId(),
        role: "user",
        text: rawText,
        createdAt: Date.now(),
      };
      setDraft("");
      setEditId(null);
      setMenu(null);
      await runDirectImageAgent([...messages, uMsg], rawText);
      return;
    }

    if (!rawText && readyAttachments.length === 0) return;
    if (models.length === 0 || !selModel) {
      setFailCode("missing_key");
      return;
    }

    const displayText = rawText || ui.imgOnlyPrompt;
    const readyImgs = readyAttachments
      .filter((a) => a.kind === "image" && a.image)
      .map((a) => a.image!);
    const previewImgs = readyAttachments
      .filter((a) => a.kind === "image" && a.previewUrl)
      .map((a) => a.previewUrl!);
    const fileSuffix = buildFileContextSuffix(readyAttachments);

    const attMeta: StoredChatAttachmentMeta[] = [
      ...readyAttachments.map((a) => ({ kind: a.kind, name: a.name })),
      ...(attachedStory
        ? [
            {
              kind: "story" as const,
              name: attachedStory.storyName || ui.storyAttached,
            },
          ]
        : []),
    ];

    const uMsg: ChatMessage = {
      id: makeMsgId(),
      role: "user",
      text: displayText,
      ...(attMeta.length > 0 ? { attachments: attMeta } : {}),
      ...(previewImgs.length > 0 ? { previewImages: previewImgs } : {}),
      createdAt: Date.now(),
    };
    setDraft("");
    setAttachments([]);
    setEditId(null);
    setMenu(null);
    await runStream([...messages, uMsg], readyImgs, fileSuffix);
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

  const downloadGenImage = (url: string, idx: number) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `yfactory-image-${idx + 1}.png`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
    const target = messages[idx];
    const base = messages.slice(0, idx);
    const prevUser = base[base.length - 1];
    if (!prevUser || prevUser.role !== "user") return;
    if (target?.generatedImages && target.generatedImages.length > 0) {
      await runDirectImageAgent(base, prevUser.text);
      return;
    }
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
    const base = messages.slice(0, idx + 1);
    if (imgGenMode) {
      await runDirectImageAgent(base, messages[idx]!.text);
      return;
    }
    await runStream(base);
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
    if (imgGenMode) {
      await runDirectImageAgent(next, trimmed);
      return;
    }
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
  const quickActionItems = [
    {
      key: "useStories",
      icon: <BookOpen aria-hidden="true" />,
      enabled: true,
      onClick: () => {
        setAgentMode("story");
        requestAnimationFrame(() => inputRef.current?.focus());
      },
    },
    {
      key: "generateImage",
      icon: <Image aria-hidden="true" />,
      enabled: true,
      onClick: () => {
        setAgentMode("image");
        requestAnimationFrame(() => inputRef.current?.focus());
      },
    },
    {
      key: "analyzeImage",
      icon: <Scan aria-hidden="true" />,
      enabled: true,
      onClick: () => {
        setAgentMode("chat");
        photoRef.current?.click();
      },
    },
    {
      key: "browseWeb",
      icon: <Globe aria-hidden="true" />,
      enabled: false,
      onClick: () => undefined,
    },
  ] as const;

  const videoSupported = modelSupportsVideoInput(selModel);

  const optionLabel = (key: string) => {
    if (key === "recordVideo") {
      return locale.startsWith("ar") ? "تسجيل فيديو" : "Record video";
    }
    return t(`chat:options.${key}`);
  };

  const optionDisabledHint = (key: string) => {
    if (key === "recordVideo") {
      return locale.startsWith("ar")
        ? "يتطلب نموذج رؤية/فيديو"
        : "Vision/video model required";
    }
    return t("chat:comingSoon");
  };

  const currentSkillScope: SkillScope =
    agentMode === "image"
      ? "image"
      : agentMode === "story"
        ? "stories"
        : agentMode === "code"
          ? "code"
          : agentMode === "students"
            ? "students"
            : agentMode === "agent"
              ? "all"
              : "chat";

  const activeChatSkills = getActiveForScope(
    currentSkillScope,
    currentSkillScope === "chat"
      ? attachedStory
        ? ["stories"]
        : []
      : currentSkillScope === "all"
        ? []
        : ["chat"],
  );

  const openChatSkillsHub = () => {
    if (onOpenSkills) onOpenSkills(currentSkillScope);
    else setLocalSkillsOpen(true);
  };
  const allOptions = [
    { key: "camera", enabled: true },
    { key: "photos", enabled: true },
    { key: "files", enabled: true },
    { key: "recordVideo", enabled: videoSupported },
    { key: "webSearch", enabled: false },
    { key: "connectors", enabled: false },
    { key: "myStories", enabled: true },
    { key: "skills", enabled: true },
    { key: "more", enabled: true },
  ] as const;

  const canRetry = Boolean(
    (customErr || (failCode && failCode !== "missing_key")) &&
      (imgGenMode || models.length > 0) &&
      messages.some((m) => m.role === "user"),
  );
  const canSendNow =
    !hasProcessingAtt &&
    (imgGenMode
      ? draft.trim().length > 0
      : (draft.trim().length > 0 || readyAttachments.length > 0) &&
        models.length > 0 &&
        Boolean(selModel));

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
      {/* Hidden native inputs for Photos and Text/Code Files (Camera uses InAppCameraModal) */}
      <input
        ref={photoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="chat-hidden-input"
        onChange={(e) => onFileInputChange(e, "image")}
      />
      <input
        ref={fileRef}
        type="file"
        accept={[".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".html", ".css", ".js", ".ts", ".tsx", ".py", ".sql", ".log", "text/*"].join(",")}
        multiple
        className="chat-hidden-input"
        onChange={(e) => onFileInputChange(e, "file")}
      />

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
                style={{ position: "relative" }}
                onClick={() => {
                  setMenu(null);
                  setTasksDrawerOpen(true);
                  void refreshAgentTasks();
                }}
                aria-label={locale.startsWith("ar") ? "مهام الوكيل" : "Agent Tasks"}
                title={locale.startsWith("ar") ? "مهام الوكيل الدائمة" : "Persistent Agent Tasks"}
                data-testid="button-chat-tasks"
              >
                <ListChecks aria-hidden="true" />
                {activeAgentTaskCount > 0 && (
                  <span className="chat-tasks-badge">{activeAgentTaskCount}</span>
                )}
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
              failCode === "missing_key") &&
              !imgGenMode && (
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
                  {quickActionItems.map(({ key, icon, enabled, onClick }) => (
                    <button
                      type="button"
                      className="chat-action"
                      key={key}
                      disabled={!enabled}
                      title={!enabled ? t("chat:comingSoon") : undefined}
                      data-testid={`button-chat-action-${key}`}
                      onClick={onClick}
                    >
                      <span className="chat-action-icon">{icon}</span>
                      <span className="chat-action-label">
                        {t(`chat:actions.${key}`)}
                      </span>
                      {!enabled && <small>{t("chat:comingSoon")}</small>}
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
                          <>
                            {msg.previewImages &&
                              msg.previewImages.length > 0 && (
                                <div className="chat-user-img-grid">
                                  {msg.previewImages.map((src, i) => (
                                    <button
                                      type="button"
                                      key={i}
                                      className="chat-user-img-thumb"
                                      onClick={() => setLightboxUrl(src)}
                                    >
                                      <img src={src} alt="" loading="lazy" />
                                    </button>
                                  ))}
                                </div>
                              )}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="chat-user-att-chips">
                                {msg.attachments.map((att, i) => (
                                  <span
                                    className="chat-msg-att-chip"
                                    key={`${att.name}-${i}`}
                                  >
                                    {att.kind === "story" ? (
                                      <BookOpen size={11} aria-hidden="true" />
                                    ) : att.kind === "image" ? (
                                      <Image size={11} aria-hidden="true" />
                                    ) : (
                                      <Paperclip size={11} aria-hidden="true" />
                                    )}
                                    <span>{att.name}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              className="chat-user-bubble chat-user-bubble-btn"
                              onClick={(e) => openUserMenu(e, msg)}
                              aria-haspopup="menu"
                              aria-label={ui.moreOpts}
                            >
                              <p dir="auto">{msg.text}</p>
                            </button>
                          </>
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
                            <span>
                              {msg.modelName === "Image Generator"
                                ? ui.generatingImg
                                : ui.generating}
                            </span>
                          </div>
                        ) : (
                          <>
                            {msg.generatedImages &&
                              msg.generatedImages.length > 0 && (
                                <div className="chat-gen-images-grid">
                                  {msg.generatedImages.map((img, i) => (
                                    <div
                                      className="chat-gen-image-card"
                                      key={`${img.url.slice(0, 24)}-${i}`}
                                    >
                                      <button
                                        type="button"
                                        className="chat-gen-image-btn"
                                        onClick={() => setLightboxUrl(img.url)}
                                      >
                                        <img
                                          src={img.url}
                                          alt={msg.text}
                                          loading="lazy"
                                        />
                                      </button>
                                      <div className="chat-gen-image-bar">
                                        <span dir="ltr">{img.provider}</span>
                                        <button
                                          type="button"
                                          className="chat-gen-dl-btn"
                                          onClick={() =>
                                            downloadGenImage(img.url, i)
                                          }
                                        >
                                          <Download
                                            size={13}
                                            aria-hidden="true"
                                          />
                                          <span>{ui.downloadImg}</span>
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            {msg.text.trim().length > 0 && (
                              <ChatMarkdown
                                content={msg.text}
                                copyLabel={ui.copy}
                                copiedLabel={ui.copied}
                                streaming={isStr}
                              />
                            )}
                            {msg.agentAction && (
                              <ChatAgentCard
                                state={msg.agentAction}
                                locale={locale}
                                onOpenImagePage={onOpenImagePage}
                                onOpenStoryPage={onOpenStoryPage}
                                onOpenCodePage={onOpenCodePage}
                                onOpenStudentsPage={onOpenStudentsPage}
                                onOpenProviderCenter={(pid) => {
                                  if (onOpenProviderCenter) onOpenProviderCenter(pid);
                                  else onOpenSecrets();
                                }}
                              />
                            )}
                          </>
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
            {listening && (
              <div className="chat-voice-banner" role="status">
                <span className="chat-voice-dot" aria-hidden="true" />
                <span>{ui.voiceListening}</span>
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  aria-label={ui.stopReading}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}

            {(attachments.length > 0 ||
              attachedStory ||
              imgGenMode ||
              storyAgentMode ||
              activeChatSkills.length > 0) && (
              <div className="chat-pending-strip">
                {activeChatSkills.map((sk) => (
                  <span
                    key={sk.id}
                    className="chat-pending-pill is-amber"
                    data-testid={`chat-active-skill-${sk.id}`}
                  >
                    <Sparkles size={12} aria-hidden="true" />
                    <span dir="auto">{getLocalizedSkillName(sk, locale)}</span>
                    <button
                      type="button"
                      onClick={() => void toggleSkill(sk.id)}
                      aria-label={ui.cancel}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {imgGenMode && (
                  <span className="chat-pending-pill is-amber">
                    <Image size={13} aria-hidden="true" />
                    <span>{ui.imgModeBadge}</span>
                    <button
                      type="button"
                      onClick={() => setAgentMode("chat")}
                      aria-label={ui.cancel}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {storyAgentMode && (
                  <span className="chat-pending-pill is-amber">
                    <BookOpen size={13} aria-hidden="true" />
                    <span>{ui.storyModeBadge}</span>
                    <button
                      type="button"
                      onClick={() => setAgentMode("chat")}
                      aria-label={ui.cancel}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {attachedStory && (
                  <span className="chat-pending-pill is-story">
                    <BookOpen size={13} aria-hidden="true" />
                    <span dir="auto">
                      {attachedStory.storyName || ui.storyAttached}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachedStory(null)}
                      aria-label={ui.cancel}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className={`chat-att-card is-${att.status}`}
                  >
                    {att.kind === "image" && att.previewUrl ? (
                      <img
                        className="chat-att-thumb"
                        src={att.previewUrl}
                        alt={att.name}
                      />
                    ) : (
                      <span className="chat-att-icon" aria-hidden="true">
                        {att.status === "processing" ? (
                          <LoaderCircle
                            className="loading-spinner"
                            size={15}
                          />
                        ) : att.status === "error" ? (
                          <AlertCircle size={15} />
                        ) : (
                          <FileText size={15} />
                        )}
                      </span>
                    )}
                    <div className="chat-att-meta">
                      <strong dir="ltr">{att.name}</strong>
                      <small>
                        {att.status === "processing"
                          ? ui.attProcessing
                          : att.status === "error"
                            ? attachmentErrLabel(att.error, ui)
                            : formatFileSize(att.sizeBytes)}
                      </small>
                    </div>
                    {att.status === "error" && (
                      <button
                        type="button"
                        className="chat-att-btn"
                        onClick={() => retryAttachment(att.id)}
                        aria-label={ui.retry}
                        title={ui.retry}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="chat-att-btn"
                      onClick={() => removeAttachment(att.id)}
                      aria-label={ui.cancel}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="chat-mode-pills">
              <button
                type="button"
                className={`chat-mode-pill ${agentMode === "agent" ? "is-active" : ""}`}
                onClick={() => {
                  setAgentMode((cur) => (cur === "agent" ? "chat" : "agent"));
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                disabled={sending}
                data-testid="button-chat-pill-agent"
              >
                <Wand2 size={14} aria-hidden="true" />
                <span>{locale.startsWith("ar") ? "الوكيل الشامل" : "AI Agent"}</span>
              </button>
              <button
                type="button"
                className={`chat-mode-pill ${imgGenMode ? "is-active" : ""}`}
                onClick={() => {
                  setAgentMode((cur) => (cur === "image" ? "chat" : "image"));
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                disabled={sending}
                data-testid="button-chat-pill-image"
              >
                <Image size={14} aria-hidden="true" />
                <span>{t("chat:actions.generateImage")}</span>
              </button>
              <button
                type="button"
                className={`chat-mode-pill ${
                  storyAgentMode ? "is-active" : ""
                }`}
                onClick={() => {
                  setAgentMode((cur) => (cur === "story" ? "chat" : "story"));
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                disabled={sending}
                data-testid="button-chat-pill-stories"
              >
                <BookOpen size={14} aria-hidden="true" />
                <span>{t("chat:options.myStories")}</span>
              </button>
              <button
                type="button"
                className={`chat-mode-pill ${agentMode === "code" ? "is-active" : ""}`}
                onClick={() => {
                  setAgentMode((cur) => (cur === "code" ? "chat" : "code"));
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                disabled={sending}
                data-testid="button-chat-pill-code"
              >
                <Code2 size={14} aria-hidden="true" />
                <span>{locale.startsWith("ar") ? "البرمجة" : "Code"}</span>
              </button>
              <button
                type="button"
                className={`chat-mode-pill ${agentMode === "students" ? "is-active" : ""}`}
                onClick={() => {
                  setAgentMode((cur) => (cur === "students" ? "chat" : "students"));
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                disabled={sending}
                data-testid="button-chat-pill-students"
              >
                <GraduationCap size={14} aria-hidden="true" />
                <span>{locale.startsWith("ar") ? "الطلاب" : "Students"}</span>
              </button>
              <button
                type="button"
                className={`chat-mode-pill ${
                  activeChatSkills.length > 0 ? "is-active" : ""
                }`}
                onClick={openChatSkillsHub}
                disabled={sending}
                data-testid="button-chat-pill-skills"
              >
                <Sparkles size={14} aria-hidden="true" />
                <span>
                  {locale.startsWith("ar") ? "المهارات" : "Skills"}
                  {activeChatSkills.length > 0
                    ? ` (${activeChatSkills.length})`
                    : ""}
                </span>
              </button>
              {storyAgentMode && (
                <button
                  type="button"
                  className={`chat-mode-pill ${
                    attachedStory ? "is-active" : ""
                  }`}
                  onClick={() => setStoryPickerOpen(true)}
                  disabled={sending}
                  data-testid="button-chat-link-story"
                >
                  <Folder size={13} aria-hidden="true" />
                  <span>{ui.linkStoryBtn}</span>
                </button>
              )}
            </div>
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
                  disabled={sending}
                  onClick={() => photoRef.current?.click()}
                  title={t("chat:image")}
                  aria-label={t("chat:image")}
                  data-testid="button-chat-image"
                >
                  <Image aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-composer-tool chat-file-tool"
                  disabled={sending}
                  onClick={() => fileRef.current?.click()}
                  title={t("chat:options.files")}
                  aria-label={t("chat:options.files")}
                  data-testid="button-chat-files"
                >
                  <FileText aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`chat-composer-tool chat-mic-tool ${
                    listening ? "is-recording" : ""
                  }`}
                  disabled={sending}
                  onClick={toggleVoiceInput}
                  title={t("chat:mic")}
                  aria-label={t("chat:mic")}
                  data-testid="button-chat-mic"
                >
                  {listening ? (
                    <MicOff aria-hidden="true" />
                  ) : (
                    <Mic aria-hidden="true" />
                  )}
                </button>
              </div>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                maxLength={8000}
                placeholder={
                  imgGenMode
                    ? ui.imgModePlaceholder
                    : storyAgentMode
                      ? ui.storyModePlaceholder
                      : agentMode === "agent"
                        ? locale.startsWith("ar")
                          ? "اطلب أي مهمة (صور، قصة 50+ مشهد، برمجة IDE، دراسة، أو ترشيح مزود)..."
                          : "Ask the YFactory Agent to run any task (Image, 50+ scene Story, IDE Code, Students, Providers)..."
                        : agentMode === "code"
                            ? locale.startsWith("ar")
                              ? "اطلب فحص جلسة IDE أو توجيه مهمة برمجية لمشروعك المفتوح..."
                              : "Check IDE session or route a coding task to your open VS Code workspace..."
                            : agentMode === "students"
                              ? locale.startsWith("ar")
                                ? "اكتب الدرس أو المادة لإنشاء خطة شرح ومراجعة تفاعلية..."
                                : "Enter a lesson or exam topic to build a study & quiz plan..."
                              : t("chat:composerPlaceholder")
                }
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
                  disabled={!canSendNow}
                  aria-label={t("chat:send")}
                  data-testid="button-chat-send"
                >
                  <Send aria-hidden="true" />
                </button>
              )}
            </form>
            {(customErr ||
              (failCode && failCode !== "missing_key" && models.length > 0)) && (
              <div
                className="chat-failure-row"
                role="alert"
                data-testid="chat-failure-code"
              >
                <p className="chat-failure-message">
                  {customErr || t(`chat:${failCode}`)}
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
              <span>
                {attachedStory
                  ? `${ui.storyAttached}: ${attachedStory.storyName}`
                  : t("chat:footerConnected")}
              </span>
            </p>
          </footer>
        </>
      )}

      <ChatStoryPicker
        open={storyPickerOpen}
        uid={user?.uid ?? null}
        selectedStoryId={attachedStory?.id ?? null}
        locale={locale}
        onClose={() => setStoryPickerOpen(false)}
        onSelect={(story) => {
          setAttachedStory(story);
          setAgentMode("story");
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onClear={() => setAttachedStory(null)}
      />

      {lightboxUrl && (
        <div
          className="chat-modal-backdrop chat-lightbox-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLightboxUrl(null);
          }}
        >
          <div className="chat-lightbox-box">
            <button
              type="button"
              className="chat-icon-button chat-lightbox-close"
              onClick={() => setLightboxUrl(null)}
              aria-label={t("chat:close")}
            >
              <X aria-hidden="true" />
            </button>
            <img src={lightboxUrl} alt="" />
          </div>
        </div>
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
                onClick={() => void togglePin(menuConv.id, menuConv.pinned)}
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
                {allOptions.map(({ key, enabled }) =>
                  key === "more" ? (
                    <button
                      type="button"
                      className="chat-attachment-option"
                      key={key}
                      onClick={() => setFullListOpen(true)}
                      data-testid="button-chat-option-more"
                    >
                      <span className="chat-option-icon">
                        {iconForOption(key)}
                      </span>
                      <span>{t(`chat:options.${key}`)}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="chat-attachment-option"
                      key={key}
                      disabled={!enabled}
                      onClick={() => enabled && triggerSheetOption(key)}
                      title={!enabled ? optionDisabledHint(key) : undefined}
                      data-testid={`button-chat-option-${key}`}
                    >
                      <span className="chat-option-icon">
                        {iconForOption(key)}
                      </span>
                      <span>{optionLabel(key)}</span>
                      {!enabled && <small>{optionDisabledHint(key)}</small>}
                    </button>
                  ),
                )}
              </div>
            ) : (
              <div className="chat-option-list" data-testid="chat-all-options">
                {allOptions
                  .filter((item) => item.key !== "more")
                  .map(({ key, enabled }) => (
                    <button
                      type="button"
                      className="chat-option-row"
                      key={key}
                      disabled={!enabled}
                      onClick={() => enabled && triggerSheetOption(key)}
                      title={!enabled ? optionDisabledHint(key) : undefined}
                      data-testid={`button-chat-full-option-${key}`}
                    >
                      <span className="chat-option-icon">
                        {iconForOption(key)}
                      </span>
                      <span className="chat-option-name">
                        {optionLabel(key)}
                      </span>
                      {!enabled && (
                        <span className="chat-coming-soon">
                          {optionDisabledHint(key)}
                        </span>
                      )}
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}

      <AgentTaskDrawer
        open={tasksDrawerOpen}
        locale={locale}
        tasks={agentTasks}
        loading={tasksLoading}
        busyTaskId={taskBusyId}
        onClose={() => setTasksDrawerOpen(false)}
        onRefresh={() => void refreshAgentTasks()}
        onCancelTask={(id) => void handleCancelAgentTask(id)}
        onRetryTask={(task) => void handleRetryAgentTask(task)}
        onDeleteTask={(id) => void handleDeleteAgentTask(id)}
        onClearFinished={() => void handleClearFinishedTasks()}
        onOpenSection={handleOpenTaskSection}
      />
      <InAppCameraModal
        open={cameraMode !== null}
        locale={locale}
        mode={cameraMode ?? "photo"}
        onClose={() => setCameraMode(null)}
        onCapture={(file) => enqueueFiles([file], "image")}
        onCaptureVideoFrames={(files, durationSec) => {
          enqueueFiles(files, "image");
          setDraft((cur) =>
            cur.trim()
              ? cur
              : locale.startsWith("ar")
                ? `حلّل هذا الفيديو المسجّل (${durationSec} ثانية) عبر هذه اللقطات المتتابعة واشرح ما يظهر فيه:`
                : `Analyze this recorded video (${durationSec}s) across these sequential frames:`,
          );
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      />
      {!onOpenSkills && (
        <SkillsHubModal
          open={localSkillsOpen}
          locale={locale}
          initialScope={currentSkillScope}
          getIdToken={getIdToken}
          onClose={() => setLocalSkillsOpen(false)}
        />
      )}
    </section>
  );
}