import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  BookOpen,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FolderOpen,
  Globe,
  GraduationCap,
  ImagePlus,
  KeyRound,
  Layers,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
} from "lucide-react";
import AppSelect from "@/components/app-select";
import ChatMarkdown from "@/components/chat-markdown";
import InAppCameraModal from "@/components/in-app-camera-modal";
import { WorkspaceSkillsBar } from "@/components/skills-hub-modal";
import type { SkillScope } from "@/lib/skillsStore";
import {
  StudentsExamsPanel,
  StudentsProgressPanel,
  type AdaptiveExamRequest,
} from "@/components/students-exams-panel";
import { loadChatModels, type ChatModelOption } from "@/lib/chatApi";
import { generateImages } from "@/lib/imageApi";
import { isRtlLanguage } from "@/lib/languages";
import {
  analyzeStudentPhoto,
  askStudentAiTeacher,
  deleteStudentLessonApi,
  fetchStudentLessons,
  prepareStudentPhotoAttachment,
  runStudentWebResearch,
  saveStudentAiDiagram,
  saveStudentLessonEdits,
  StudentsApiError,
  type StudentDocumentType,
  type StudentGradeLevel,
  type StudentLessonRecord,
  type StudentModelSelection,
  type StudentTeachingStyle,
} from "@/lib/studentsApi";
import "./students-workspace.css";

type StudentsWorkspaceProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenSkills?: (scope?: SkillScope) => void;
};

type StudentsTab = "tutor" | "scan" | "visuals" | "exams" | "progress" | "library";

const SUBJECT_PRESETS = [
  "Auto / General",
  "Biology",
  "Physics",
  "Chemistry",
  "Mathematics",
  "History",
  "Geography",
  "Computer Science",
  "Literature & Languages",
];

const ST_STORAGE = {
  model: "yfactory.students.selectedModel",
  grade: "yfactory.students.gradeLevel",
  subject: "yfactory.students.subject",
  style: "yfactory.students.teachingStyle",
} as const;

function readStudentPref(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStudentPref(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "منصة الطلاب — المدرس الذكي والتعلم البصري",
      subtitle:
        "مساحة تعليمية مستقلة تماماً بتخصيصاتها: صوّر امتحانك أو درسك، ابحث بصرياً بمصادر موثّقة، وتعلّم في شات المدرس الذكي الخاص بالطلاب.",
      tabTutor: "شات المدرس الذكي",
      tabScan: "تصوير امتحان / درس",
      tabVisuals: "البحث والمخططات البصرية",
      tabExams: "الامتحانات التفاعلية",
      tabProgress: "تطوّري وإتقاني",
      tabLibrary: "مكتبة دروسي",
      startExamBtn: "اختبار تفاعلي",
      modelLbl: "نموذج الذكاء الاصطناعي",
      gradeLbl: "المستوى الدراسي",
      subjectLbl: "المادة الدراسية",
      styleLbl: "أسلوب الشرح",
      noModelWarn: "فعّل نموذجاً (مثل Gemini أو OpenAI أو Groq أو OpenRouter) من مركز المزودين أولاً.",
      openProviders: "مركز المزودين",
      grades: {
        elementary: "ابتدائي",
        middle: "إعدادي / متوسط",
        high_school: "ثانوي",
        university: "جامعي",
      } as Record<StudentGradeLevel, string>,
      styles: {
        visual_step_by_step: "بصري خطوة بخطوة",
        simple_friendly: "مبسط وبأمثلة يومية",
        exam_focused: "مركز على الامتحانات",
        deep_academic: "أكاديمي معمّق",
      } as Record<StudentTeachingStyle, string>,
      docTypes: {
        exam: "امتحان",
        lesson: "درس",
        book_page: "صفحة كتاب",
        notes: "ملخص / ملاحظات",
      } as Record<StudentDocumentType, string>,
      newSession: "جلسة تعلم جديدة",
      tutorEmpty:
        "مرحباً بك في شات المدرس الذكي المستقل! اختر مستواك الدراسي وأسلوب الشرح أعلاه، واسأل عن أي درس — أو صوّر امتحانك أولاً ليربط المدرس كل شرح بأسئلة الامتحان.",
      tutorPh: "اسأل المدرس الذكي عن أي فكرة، أو اطلب شرحاً لأحد أسئلة الامتحان...",
      send: "إرسال",
      sending: "جارٍ الشرح...",
      reexplain: "أعد الشرح بطريقة مختلفة",
      scanTitle: "تحليل صورة امتحان أو درس أو صفحة كتاب",
      scanSub:
        "التقط صورة مباشرة من الهاتف أو ارفعها من المعرض؛ يستخرج النظام الأسئلة مرتّبة ويحدد المادة والدروس والمفاهيم مع إمكانية التعديل الكامل.",
      takePhoto: "تصوير بالكاميرا",
      uploadPhoto: "رفع صورة من الهاتف",
      orPasteText: "أو الصق نص الامتحان / الدرس هنا (اختياري):",
      pastePh: "الصق نص الأسئلة أو الدرس إذا لم ترغب في رفع صورة...",
      analyzeBtn: "تحليل بالرؤية الذكية (Vision / OCR)",
      analyzing: "جارٍ قراءة وتحليل المحتوى...",
      analysisResult: "نتيجة التحليل (قابلة للتعديل)",
      extractedTextLbl: "النص المستخرج (يمكنك تصحيح أي خطأ قراءة):",
      questionsLbl: "الأسئلة المستخرجة بالترتيب",
      topicsLbl: "المواضيع والمفاهيم المستخرجة",
      saveEdits: "حفظ التعديلات",
      savingEdits: "جارٍ الحفظ...",
      goResearch: "بحث بصري ومصادر لهذا الدرس",
      goTutor: "اشرح هذا في شات المدرس الذكي",
      visualTitle: "محرك البحث التعليمي والتعلم البصري",
      visualSub:
        "يبحث فعلياً في Wikipedia وWikimedia Commons لجلب الشروحات والمخططات العلمية والخرائط بروابطها الرسمية وتراخيصها دون أي مصادر مخترعة.",
      searchTopicPh: "ابحث عن موضوع (مثلاً: الجهاز الهضمي، الحرب العالمية الثانية، قانون أوم، نظرية فيثاغورس)...",
      researchBtn: "بحث تعليمي بصري",
      researching: "جارٍ البحث في المصادر التعليمية وبناء المخطط...",
      genDiagramBtn: "توليد رسم تعليمي بالذكاء الاصطناعي (عند عدم توفر صورة)",
      generatingDiag: "جارٍ توليد رسم تعليمي...",
      aiDiagBadge: "رسم مولّد بالذكاء الاصطناعي — يُرجى التحقق من دقته العلمية",
      verifiedBadge: "مصدر موثّق",
      openSource: "فتح المصدر الأصلي",
      breakdownTitle: "المخطط البصري والخطوات والمصطلحات",
      glossaryTitle: "المصطلحات الأساسية",
      noVisuals: "ابحث عن أي موضوع أعلاه أو اضغط على أحد المواضيع المستخرجة من امتحانك لعرض الصور والمخططات والمصادر.",
      libraryEmpty: "لا توجد دروس أو جلسات محفوظة بعد.",
      openLesson: "فتح الدرس",
      copy: "نسخ",
      copied: "تم النسخ",
    };
  }
  return {
    title: "Students — Independent AI Teacher & Visual Learning",
    subtitle:
      "Dedicated educational studio with its own customized tutor chat: scan exams/lessons, research verified visuals & diagrams, and learn step-by-step.",
    tabTutor: "AI Teacher Chat",
    tabScan: "Scan Exam / Lesson",
    tabVisuals: "Visual Research",
    tabLibrary: "My Lessons",
    modelLbl: "AI Model",
    gradeLbl: "Grade Level",
    subjectLbl: "Subject",
    styleLbl: "Teaching Style",
    noModelWarn: "Enable a model (e.g. Gemini, OpenAI, Groq, or OpenRouter) in Provider Center first.",
    openProviders: "Provider Center",
    grades: {
      elementary: "Elementary",
      middle: "Middle School",
      high_school: "High School",
      university: "University",
    } as Record<StudentGradeLevel, string>,
    styles: {
      visual_step_by_step: "Visual Step-by-Step",
      simple_friendly: "Simple & Analogies",
      exam_focused: "Exam-Focused",
      deep_academic: "Deep Academic",
    } as Record<StudentTeachingStyle, string>,
    docTypes: {
      exam: "Exam",
      lesson: "Lesson",
      book_page: "Book Page",
      notes: "Notes",
    } as Record<StudentDocumentType, string>,
    newSession: "New Study Session",
    tutorEmpty:
      "Welcome to your independent AI Teacher Chat! Pick your grade level, subject, and teaching style above — or scan an exam photo so every explanation links directly to your questions.",
    tutorPh: "Ask your AI Teacher to explain a topic, solve step-by-step, or review an exam question...",
    send: "Send",
    sending: "Teaching...",
    reexplain: "Re-explain Differently",
    scanTitle: "Exam, Lesson & Textbook Photo Analyzer",
    scanSub:
      "Snap a photo or upload from your phone. YFactory extracts ordered questions, detects subject, lessons, topics & concepts, and lets you edit any OCR mistakes.",
    takePhoto: "Take Photo",
    uploadPhoto: "Upload Image",
    orPasteText: "Or paste exam / lesson text directly (optional):",
    pastePh: "Paste questions or lesson notes here...",
    analyzeBtn: "Analyze with Vision / OCR",
    analyzing: "Reading & extracting curriculum details...",
    analysisResult: "Analysis Result (Editable)",
    extractedTextLbl: "Extracted Text (edit if needed):",
    questionsLbl: "Extracted Questions (in order)",
    topicsLbl: "Detected Topics & Concepts",
    saveEdits: "Save Edits",
    savingEdits: "Saving...",
    goResearch: "Research Visuals & Diagrams",
    goTutor: "Teach This in AI Teacher Chat",
    visualTitle: "Intelligent Web Research & Visual Learning Engine",
    visualSub:
      "Searches Wikipedia & Wikimedia Commons live for real educational diagrams, maps, and verified references with licenses — never invented URLs.",
    searchTopicPh: "Search a topic (e.g. Digestive system, World War II map, Ohm's law, Pythagorean theorem)...",
    researchBtn: "Research Visuals",
    researching: "Searching educational sources & building breakdown...",
    genDiagramBtn: "Generate AI Educational Diagram (if no verified diagram fits)",
    generatingDiag: "Generating educational illustration...",
    aiDiagBadge: "AI-Generated Illustration — verify scientific accuracy",
    verifiedBadge: "Verified Source",
    openSource: "Open Source",
    breakdownTitle: "Structured Visual Breakdown & Glossary",
    glossaryTitle: "Key Terms",
    noVisuals: "Search a topic above or click an extracted topic from your exam to fetch verified diagrams and explanations.",
    libraryEmpty: "No saved lessons or study sessions yet.",
    openLesson: "Open",
    copy: "Copy",
    copied: "Copied",
  };
}

export default function StudentsWorkspace({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenSkills,
}: StudentsWorkspaceProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);

  const [tab, setTab] = useState<StudentsTab>("tutor");
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>(() =>
    readStudentPref(ST_STORAGE.model, ""),
  );
  const selectedModelRef = useRef(selectedModelKey);
  selectedModelRef.current = selectedModelKey;

  const [gradeLevel, setGradeLevel] = useState<StudentGradeLevel>(
    () => readStudentPref(ST_STORAGE.grade, "high_school") as StudentGradeLevel,
  );
  const [subject, setSubject] = useState<string>(() =>
    readStudentPref(ST_STORAGE.subject, "Auto / General"),
  );
  const [teachingStyle, setTeachingStyle] = useState<StudentTeachingStyle>(
    () =>
      readStudentPref(
        ST_STORAGE.style,
        "visual_step_by_step",
      ) as StudentTeachingStyle,
  );

  const chooseModelKey = useCallback((nextKey: string) => {
    setSelectedModelKey(nextKey);
    selectedModelRef.current = nextKey;
    writeStudentPref(ST_STORAGE.model, nextKey);
  }, []);

  const chooseGradeLevel = useCallback((next: StudentGradeLevel) => {
    setGradeLevel(next);
    writeStudentPref(ST_STORAGE.grade, next);
  }, []);

  const chooseSubject = useCallback((next: string) => {
    setSubject(next);
    writeStudentPref(ST_STORAGE.subject, next);
  }, []);

  const chooseTeachingStyle = useCallback((next: StudentTeachingStyle) => {
    setTeachingStyle(next);
    writeStudentPref(ST_STORAGE.style, next);
  }, []);

  const [lessons, setLessons] = useState<StudentLessonRecord[]>([]);
  const [activeLesson, setActiveLesson] = useState<StudentLessonRecord | null>(null);
  const [focusTopic, setFocusTopic] = useState("");
  const [pendingAdaptiveExam, setPendingAdaptiveExam] = useState<AdaptiveExamRequest | null>(null);

  // Scan state
  const [photoAttachment, setPhotoAttachment] = useState<{
    mimeType: "image/jpeg";
    dataUrl: string;
  } | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [savingEdits, setSavingEdits] = useState(false);

  // Visual research state
  const [researchQuery, setResearchQuery] = useState("");
  const [researching, setResearching] = useState(false);
  const [generatingDiagram, setGeneratingDiagram] = useState(false);

  // AI Teacher chat state
  const [tutorInput, setTutorInput] = useState("");
  const [tutorBusy, setTutorBusy] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [cameraOpen, setCameraOpen] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadWorkspaceData = useCallback(async () => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      const [mList, lList] = await Promise.all([
        loadChatModels(tok).catch(() => [] as ChatModelOption[]),
        fetchStudentLessons(tok).catch(() => [] as StudentLessonRecord[]),
      ]);
      setModels(mList);
      if (mList.length > 0) {
        const currentKey =
          selectedModelRef.current || readStudentPref(ST_STORAGE.model, "");
        const stillValid = mList.some(
          (m) => `${m.provider}|${m.id}|${m.modelName}` === currentKey,
        );
        if (stillValid && currentKey) {
          setSelectedModelKey(currentKey);
        } else {
          const pref =
            mList.find((m) => /gemini|gpt-4o|gpt-6|claude/i.test(m.modelName)) ??
            mList[0]!;
          chooseModelKey(`${pref.provider}|${pref.id}|${pref.modelName}`);
        }
      }
      setLessons(lList);
      setActiveLesson((prev) => {
        if (prev || lList.length === 0) return prev;
        const first = lList[0]!;
        setEditText(first.extractedText);
        setEditSubject(first.subject);
        return first;
      });
    } catch {
      // ignore initial hydration error
    }
  }, [getIdToken, chooseModelKey]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeLesson?.tutorMessages.length, tutorBusy]);

  const modelSelection = useMemo<StudentModelSelection | undefined>(() => {
    const [provider, keyId, ...rest] = selectedModelKey.split("|");
    const modelName = rest.join("|");
    if (!provider || !keyId || !modelName) return undefined;
    return { provider, keyId, modelName };
  }, [selectedModelKey]);

  const syncLessonIntoState = (
    updated: StudentLessonRecord,
    applyPrefs = false,
  ) => {
    setActiveLesson(updated);
    setEditText(updated.extractedText);
    setEditSubject(updated.subject);
    if (applyPrefs) {
      chooseGradeLevel(updated.gradeLevel);
      chooseTeachingStyle(updated.teachingStyle);
    }
    setLessons((prev) => [updated, ...prev.filter((l) => l.id !== updated.id)]);
  };

  const processPhotoFile = async (file: File) => {
    setError("");
    try {
      const prepared = await prepareStudentPhotoAttachment(file);
      setPhotoAttachment(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read photo.");
    }
  };

  const handlePhotoChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    await processPhotoFile(file);
  };

  const handleAnalyze = async () => {
    if (!getIdToken || analyzing) return;
    if (!photoAttachment && !pastedText.trim()) return;
    setAnalyzing(true);
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      const created = await analyzeStudentPhoto(tok, {
        ...(photoAttachment ? { image: photoAttachment } : {}),
        ...(pastedText.trim() ? { pastedText: pastedText.trim() } : {}),
        gradeLevel,
        locale,
        modelSelection,
      });
      syncLessonIntoState(created);
      chooseSubject(created.subject || "Auto / General");
      setFocusTopic(created.topics[0] ?? "");
      setResearchQuery(created.topics[0] ?? created.title);
      setPhotoAttachment(null);
      setPastedText("");
      setNotice(
        locale.startsWith("ar")
          ? `تم تحليل «${created.title}» واستخراج ${created.questions.length} سؤال و${created.topics.length} موضوع.`
          : `Analyzed "${created.title}" — extracted ${created.questions.length} question(s) and ${created.topics.length} topic(s).`,
      );
    } catch (err) {
      setError(
        err instanceof StudentsApiError ? err.message : "Could not analyze photo.",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!getIdToken || !activeLesson || savingEdits) return;
    setSavingEdits(true);
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      const updated = await saveStudentLessonEdits(tok, activeLesson.id, {
        extractedText: editText,
        subject: editSubject.trim() || activeLesson.subject,
        gradeLevel,
        teachingStyle,
      });
      syncLessonIntoState(updated);
      setNotice(locale.startsWith("ar") ? "تم حفظ تعديلاتك بنجاح." : "Edits saved.");
    } catch (err) {
      setError(err instanceof StudentsApiError ? err.message : "Could not save edits.");
    } finally {
      setSavingEdits(false);
    }
  };

  const handleRunResearch = async (overrideTopics?: string[]) => {
    if (!getIdToken || researching) return;
    const topicsToSearch =
      overrideTopics && overrideTopics.length > 0
        ? overrideTopics
        : researchQuery.trim()
          ? [researchQuery.trim()]
          : activeLesson?.topics.slice(0, 3) ?? [];
    if (topicsToSearch.length === 0) return;

    setResearching(true);
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      const res = await runStudentWebResearch(tok, {
        lessonId: activeLesson?.id,
        topics: topicsToSearch,
        subject:
          subject !== "Auto / General"
            ? subject
            : activeLesson?.subject || "General",
        gradeLevel,
        locale,
        includeVisualBreakdown: true,
        modelSelection,
      });
      if (res.lesson) {
        syncLessonIntoState(res.lesson);
      } else {
        // Store transient results on a temporary in-view lesson if none active yet
        setActiveLesson({
          id: "",
          title: topicsToSearch[0]!,
          documentType: "lesson",
          subject: subject !== "Auto / General" ? subject : "General",
          gradeLevel,
          teachingStyle,
          extractedText: "",
          questions: [],
          lessons: topicsToSearch,
          topics: topicsToSearch,
          keyConcepts: [],
          resources: res.resources,
          breakdowns: res.breakdowns,
          tutorMessages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      setNotice(
        locale.startsWith("ar")
          ? `تم العثور على ${res.resources.length} مصدر وصورة تعليمية موثّقة.`
          : `Found ${res.resources.length} verified educational source(s) & diagrams.`,
      );
    } catch (err) {
      setError(
        err instanceof StudentsApiError ? err.message : "Web research failed.",
      );
    } finally {
      setResearching(false);
    }
  };

  const handleGenerateAiDiagram = async () => {
    if (!getIdToken || generatingDiagram) return;
    const topic =
      researchQuery.trim() ||
      focusTopic.trim() ||
      activeLesson?.topics[0] ||
      activeLesson?.title;
    if (!topic) return;

    setGeneratingDiagram(true);
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      const subj =
        subject !== "Auto / General" ? subject : activeLesson?.subject || "Science";
      const prompt = `Clean textbook educational scientific diagram illustrating "${topic}" (${subj}), crisp labeled schematic style, high contrast white background, clear visual parts, educational clarity`;
      const imgRes = await generateImages(tok, null, prompt, 1);
      const first = imgRes.images[0];
      if (!first) throw new Error("No illustration returned by image provider.");

      if (activeLesson?.id) {
        const updated = await saveStudentAiDiagram(tok, activeLesson.id, {
          topic,
          imageUrl: first.imageData,
          providerName: first.provider,
          relationNote: `Original AI-generated educational illustration for "${topic}" (${subj}).`,
        });
        syncLessonIntoState(updated);
      } else {
        setActiveLesson((prev) =>
          prev
            ? {
                ...prev,
                resources: [
                  {
                    id: `ai_${Date.now()}`,
                    topic,
                    sourceName: `AI-Generated (${first.provider})`,
                    title: `AI Educational Diagram: ${topic}`,
                    sourceUrl: "",
                    imageUrl: first.imageData,
                    licenseNote: "Original AI-generated illustration",
                    relationNote: `AI-generated diagram for ${topic}`,
                    summary: "Verify scientific accuracy against your textbook.",
                    isAiGenerated: true,
                    scientificCheckNote:
                      "Generated by AI — verify labels and scientific details.",
                  },
                  ...prev.resources,
                ],
              }
            : prev,
        );
      }
      setNotice(ui.aiDiagBadge);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not generate AI diagram.",
      );
    } finally {
      setGeneratingDiagram(false);
    }
  };

  const handleSendTutor = async (
    customPrompt?: string,
    reexplain = false,
  ) => {
    if (!getIdToken || tutorBusy) return;
    const text = (customPrompt ?? tutorInput).trim();
    if (!text) return;

    setTutorBusy(true);
    setError("");
    if (!customPrompt) setTutorInput("");
    try {
      const tok = await getIdToken();
      const res = await askStudentAiTeacher(tok, {
        lessonId: activeLesson?.id || undefined,
        message: text,
        subject:
          subject !== "Auto / General"
            ? subject
            : activeLesson?.subject || "General",
        gradeLevel,
        teachingStyle,
        focusTopic: focusTopic || undefined,
        reexplainDifferently: reexplain,
        locale,
        modelSelection,
      });
      syncLessonIntoState(res.lesson);
    } catch (err) {
      setError(
        err instanceof StudentsApiError ? err.message : "AI Teacher failed to reply.",
      );
    } finally {
      setTutorBusy(false);
    }
  };

  const handleTutorSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleSendTutor();
  };

  const handleDeleteLesson = async (id: string) => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      await deleteStudentLessonApi(tok, id);
      setLessons((prev) => prev.filter((l) => l.id !== id));
      if (activeLesson?.id === id) setActiveLesson(null);
    } catch {
      setError("Could not delete lesson.");
    }
  };

  const handleAdaptiveReexplain = (topic: string, subj: string) => {
    chooseSubject(subj || "Auto / General");
    setFocusTopic(topic);
    setTab("tutor");
    void handleSendTutor(
      locale.startsWith("ar")
        ? `أخطأت في موضوع «${topic}» في الاختبار. أعد شرحه لي بأسلوب مبسّط خطوة بخطوة مع أمثلة جديدة وتطبيقات تدريبية.`
        : `I missed "${topic}" on my exam. Please re-explain it clearly step-by-step with fresh examples and check my understanding.`,
      true,
    );
  };

  const handleStartAdaptiveExam = (req: AdaptiveExamRequest) => {
    setPendingAdaptiveExam(req);
    setTab("exams");
  };

  const startFreshStudySession = () => {
    setActiveLesson(null);
    setFocusTopic("");
    setEditText("");
    setEditSubject("");
    setNotice("");
    setError("");
    setTab("tutor");
  };

  return (
    <section
      className="st-root"
      dir={isRtl ? "rtl" : "ltr"}
      aria-label={ui.title}
      data-testid="students-workspace"
    >
      <header className="st-header">
        <div className="st-head-row">
          <div className="st-title-wrap">
            <span className="st-icon-badge" aria-hidden="true">
              <GraduationCap size={22} />
            </span>
            <div>
              <h1>{ui.title}</h1>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          <div className="st-row">
            <button
              type="button"
              className="st-btn"
              onClick={startFreshStudySession}
            >
              <Plus size={14} />
              <span>{ui.newSession}</span>
            </button>
            <button
              type="button"
              className="st-btn"
              onClick={() => onOpenProviderCenter()}
            >
              <KeyRound size={14} />
              <span>{ui.openProviders}</span>
            </button>
          </div>
        </div>

        {/* Dedicated Students Customization Controls (Custom YFactory Bottom Sheets) */}
        <div className="st-config-grid">
          <div className="st-field">
            <label htmlFor="st-model">{ui.modelLbl}</label>
            <AppSelect
              id="st-model"
              title={ui.modelLbl}
              value={selectedModelKey}
              placeholder={ui.noModelWarn}
              searchable={models.length >= 5}
              dir={isRtl ? "rtl" : "ltr"}
              valueDir="ltr"
              testId="select-students-model"
              disabled={models.length === 0}
              options={models.map((m) => ({
                value: `${m.provider}|${m.id}|${m.modelName}`,
                label: m.modelName,
                subtitle: m.providerName,
                badge: m.providerName,
              }))}
              onChange={chooseModelKey}
            />
          </div>

          <div className="st-field">
            <label htmlFor="st-grade">{ui.gradeLbl}</label>
            <AppSelect
              id="st-grade"
              title={ui.gradeLbl}
              value={gradeLevel}
              dir={isRtl ? "rtl" : "ltr"}
              testId="select-students-grade"
              options={(Object.keys(ui.grades) as StudentGradeLevel[]).map((g) => ({
                value: g,
                label: ui.grades[g],
              }))}
              onChange={(val) => chooseGradeLevel(val as StudentGradeLevel)}
            />
          </div>

          <div className="st-field">
            <label htmlFor="st-subject">{ui.subjectLbl}</label>
            <AppSelect
              id="st-subject"
              title={ui.subjectLbl}
              value={subject}
              searchable
              dir={isRtl ? "rtl" : "ltr"}
              testId="select-students-subject"
              options={[
                ...(SUBJECT_PRESETS.includes(subject) ? [] : [subject]),
                ...SUBJECT_PRESETS,
              ].map((s) => ({
                value: s,
                label: s,
              }))}
              onChange={chooseSubject}
            />
          </div>

          <div className="st-field">
            <label htmlFor="st-style">{ui.styleLbl}</label>
            <AppSelect
              id="st-style"
              title={ui.styleLbl}
              value={teachingStyle}
              dir={isRtl ? "rtl" : "ltr"}
              testId="select-students-style"
              options={(Object.keys(ui.styles) as StudentTeachingStyle[]).map(
                (st) => ({
                  value: st,
                  label: ui.styles[st],
                }),
              )}
              onChange={(val) => chooseTeachingStyle(val as StudentTeachingStyle)}
            />
          </div>
        </div>

        <WorkspaceSkillsBar
          scope="students"
          locale={locale}
          getIdToken={getIdToken}
          onOpenHub={onOpenSkills}
        />

        <nav className="st-tabs" role="tablist">
          {(
            [
              ["tutor", ui.tabTutor, <MessageSquare size={14} key="t" />],
              ["scan", ui.tabScan, <Camera size={14} key="s" />],
              [
                "visuals",
                `${ui.tabVisuals}${activeLesson?.resources.length ? ` (${activeLesson.resources.length})` : ""}`,
                <Globe size={14} key="v" />,
              ],
              ["exams", ui.tabExams, <ClipboardCheck size={14} key="e" />],
              ["progress", ui.tabProgress, <TrendingUp size={14} key="p" />],
              ["library", `${ui.tabLibrary} (${lessons.length})`, <FolderOpen size={14} key="l" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`st-tab${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
              data-testid={`students-tab-${id}`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      {notice && (
        <div className="st-banner-ok" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="st-banner-err" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: INDEPENDENT AI TEACHER CHAT */}
      {tab === "tutor" && (
        <div className="st-panel" data-testid="students-tutor-panel">
          {activeLesson && (
            <div className="st-head-row">
              <div className="st-row">
                <span className="st-pill is-gold">
                  {ui.docTypes[activeLesson.documentType]}
                </span>
                <strong dir="auto" style={{ fontSize: 13.5 }}>
                  {activeLesson.title}
                </strong>
                <span className="st-pill">{activeLesson.subject}</span>
              </div>
              <div className="st-row">
                <button
                  type="button"
                  className="st-btn"
                  onClick={() => setTab("scan")}
                >
                  <Camera size={13} />
                  <span>{ui.tabScan}</span>
                </button>
                <button
                  type="button"
                  className="st-btn"
                  onClick={() => setTab("visuals")}
                >
                  <Globe size={13} />
                  <span>{ui.tabVisuals}</span>
                </button>
              </div>
            </div>
          )}

          {/* Quick Topic Focus & Exam Question Pills */}
          {activeLesson && activeLesson.topics.length > 0 && (
            <div className="st-chip-strip">
              {activeLesson.topics.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`st-chip${focusTopic === t ? " is-active" : ""}`}
                  onClick={() => {
                    setFocusTopic(t);
                    void handleSendTutor(
                      locale.startsWith("ar")
                        ? `اشرح لي موضوع «${t}» بخطوات مرئية بسيطة مع أمثلة وتعريف المصطلحات واربطه بالامتحان.`
                        : `Teach me "${t}" step-by-step visually with examples, glossary terms, and link it to the uploaded exam.`,
                    );
                  }}
                >
                  <BookOpen size={12} />
                  <span>{t}</span>
                </button>
              ))}
            </div>
          )}

          {/* Inline verified visual reference strip right inside AI Teacher Chat */}
          {activeLesson && activeLesson.resources.some((r) => r.imageUrl) && (
            <div className="st-chip-strip">
              {activeLesson.resources
                .filter((r) => r.imageUrl)
                .slice(0, 4)
                .map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="st-chip"
                    onClick={() => setTab("visuals")}
                  >
                    <Layers size={12} />
                    <span>{r.title.slice(0, 32)}</span>
                  </button>
                ))}
            </div>
          )}

          <div className="st-tutor-thread" aria-live="polite">
            {!activeLesson || activeLesson.tutorMessages.length === 0 ? (
              <div className="st-empty">
                <GraduationCap size={26} style={{ marginBottom: 6 }} />
                <p style={{ margin: 0 }}>{ui.tutorEmpty}</p>
              </div>
            ) : (
              activeLesson.tutorMessages.map((m, idx) => {
                const isLastAssistant =
                  m.role === "assistant" &&
                  idx === activeLesson.tutorMessages.length - 1;
                return (
                  <article
                    key={m.id}
                    className={`st-msg ${m.role === "user" ? "is-user" : "is-assistant"}`}
                  >
                    <div className="st-msg-head">
                      <strong>
                        {m.role === "user"
                          ? locale.startsWith("ar")
                            ? "الطالب"
                            : "Student"
                          : locale.startsWith("ar")
                            ? "المدرس الذكي"
                            : "AI Teacher"}
                      </strong>
                      {m.style && (
                        <span className="st-pill">{ui.styles[m.style]}</span>
                      )}
                    </div>
                    {m.role === "assistant" ? (
                      <ChatMarkdown
                        content={m.content}
                        copyLabel={ui.copy}
                        copiedLabel={ui.copied}
                      />
                    ) : (
                      <p style={{ margin: 0, fontSize: 13.5 }} dir="auto">
                        {m.content}
                      </p>
                    )}
                    {isLastAssistant && (
                      <div className="st-row" style={{ marginTop: 4 }}>
                        <button
                          type="button"
                          className="st-btn"
                          disabled={tutorBusy}
                          onClick={() =>
                            void handleSendTutor(
                              locale.startsWith("ar")
                                ? "أعد شرح الفكرة السابقة بطريقة مختلفة وأبسط مع مثال جديد تماماً."
                                : "Re-explain the previous lesson in a completely different, simpler way with a new example.",
                              true,
                            )
                          }
                          data-testid="button-tutor-reexplain"
                        >
                          <RefreshCw size={13} />
                          <span>{ui.reexplain}</span>
                        </button>
                      </div>
                    )}
                  </article>
                );
              })
            )}
            {tutorBusy && (
              <div className="st-banner-ok">
                <LoaderCircle className="loading-spinner" size={15} />
                <span>{ui.sending}</span>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>

          <form className="st-composer" onSubmit={handleTutorSubmit}>
            <textarea
              className="st-textarea"
              dir="auto"
              placeholder={ui.tutorPh}
              value={tutorInput}
              onChange={(e) => setTutorInput(e.currentTarget.value)}
              data-testid="input-students-tutor"
            />
            <button
              type="submit"
              className="st-btn is-primary"
              disabled={tutorBusy || !tutorInput.trim() || models.length === 0}
              style={{ minHeight: 46 }}
              data-testid="button-students-tutor-send"
            >
              {tutorBusy ? (
                <LoaderCircle className="loading-spinner" size={15} />
              ) : (
                <Send size={15} />
              )}
              <span>{ui.send}</span>
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: EXAM / LESSON PHOTO ANALYSIS */}
      {tab === "scan" && (
        <div className="st-panel" data-testid="students-scan-panel">
          <div>
            <strong style={{ fontSize: 15 }}>{ui.scanTitle}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--app-secondary)" }}>
              {ui.scanSub}
            </p>
          </div>

          <input
            ref={galleryRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(e) => void handlePhotoChosen(e)}
          />

          <div className="st-row">
            <button
              type="button"
              className="st-btn is-primary"
              onClick={() => setCameraOpen(true)}
              data-testid="button-students-camera"
            >
              <Camera size={15} />
              <span>{ui.takePhoto}</span>
            </button>
            <button
              type="button"
              className="st-btn"
              onClick={() => galleryRef.current?.click()}
              data-testid="button-students-upload"
            >
              <Upload size={15} />
              <span>{ui.uploadPhoto}</span>
            </button>
          </div>

          {photoAttachment && (
            <img
              className="st-photo-preview"
              src={photoAttachment.dataUrl}
              alt="Exam or lesson preview"
            />
          )}

          <div className="st-field">
            <label>{ui.orPasteText}</label>
            <textarea
              className="st-textarea"
              dir="auto"
              placeholder={ui.pastePh}
              value={pastedText}
              onChange={(e) => setPastedText(e.currentTarget.value)}
            />
          </div>

          <button
            type="button"
            className="st-btn is-primary"
            disabled={
              analyzing ||
              (!photoAttachment && !pastedText.trim()) ||
              models.length === 0
            }
            onClick={() => void handleAnalyze()}
            data-testid="button-students-analyze"
          >
            {analyzing ? (
              <LoaderCircle className="loading-spinner" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            <span>{analyzing ? ui.analyzing : ui.analyzeBtn}</span>
          </button>

          {activeLesson && (
            <>
              <hr style={{ border: 0, borderTop: "1px solid var(--app-separator)", width: "100%" }} />
              <div className="st-head-row">
                <strong style={{ fontSize: 14.5 }}>{ui.analysisResult}</strong>
                <div className="st-row">
                  <span className="st-pill is-gold">
                    {ui.docTypes[activeLesson.documentType]}
                  </span>
                  <span className="st-pill is-ok">{activeLesson.subject}</span>
                </div>
              </div>

              <div className="st-config-grid">
                <div className="st-field">
                  <label>{ui.subjectLbl}</label>
                  <input
                    className="st-input"
                    dir="auto"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.currentTarget.value)}
                  />
                </div>
              </div>

              <div className="st-field">
                <label>{ui.extractedTextLbl}</label>
                <textarea
                  className="st-textarea"
                  style={{ minHeight: 120 }}
                  dir="auto"
                  value={editText}
                  onChange={(e) => setEditText(e.currentTarget.value)}
                  data-testid="textarea-students-extracted"
                />
              </div>

              <div className="st-row">
                {activeLesson.id && (
                  <button
                    type="button"
                    className="st-btn"
                    disabled={savingEdits}
                    onClick={() => void handleSaveEdits()}
                  >
                    <Save size={14} />
                    <span>{savingEdits ? ui.savingEdits : ui.saveEdits}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="st-btn is-primary"
                  onClick={() => {
                    setTab("visuals");
                    void handleRunResearch(activeLesson.topics.slice(0, 3));
                  }}
                >
                  <Globe size={14} />
                  <span>{ui.goResearch}</span>
                </button>
                <button
                  type="button"
                  className="st-btn"
                  onClick={() => setTab("tutor")}
                >
                  <MessageSquare size={14} />
                  <span>{ui.goTutor}</span>
                </button>
              </div>

              {activeLesson.topics.length > 0 && (
                <div className="st-field">
                  <label>{ui.topicsLbl}</label>
                  <div className="st-row">
                    {activeLesson.topics.map((t) => (
                      <span className="st-pill is-gold" key={t}>
                        {t}
                      </span>
                    ))}
                    {activeLesson.keyConcepts.map((c) => (
                      <span className="st-pill" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {activeLesson.questions.length > 0 && (
                <div className="st-field">
                  <label>
                    {ui.questionsLbl} ({activeLesson.questions.length})
                  </label>
                  {activeLesson.questions.map((q) => (
                    <div key={q.number} className="st-question-item">
                      <div className="st-head-row">
                        <span className="st-pill is-gold">Q{q.number}</span>
                        <span className="st-pill">{q.topic}</span>
                        <button
                          type="button"
                          className="st-btn"
                          onClick={() => {
                            setFocusTopic(q.topic);
                            setTab("tutor");
                            void handleSendTutor(
                              locale.startsWith("ar")
                                ? `اشرح لي خطوات حل السؤال رقم ${q.number}: ${q.text}`
                                : `Explain how to solve Question ${q.number} step-by-step: ${q.text}`,
                            );
                          }}
                        >
                          <MessageSquare size={12} />
                          <span>{ui.tabTutor}</span>
                        </button>
                      </div>
                      <p style={{ margin: 0, fontSize: 13 }} dir="auto">
                        {q.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: INTELLIGENT WEB RESEARCH & VISUAL LEARNING ENGINE */}
      {tab === "visuals" && (
        <div className="st-panel" data-testid="students-visuals-panel">
          <div>
            <strong style={{ fontSize: 15 }}>{ui.visualTitle}</strong>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--app-secondary)" }}>
              {ui.visualSub}
            </p>
          </div>

          <div className="st-row">
            <input
              className="st-input"
              style={{ flex: 1 }}
              dir="auto"
              placeholder={ui.searchTopicPh}
              value={researchQuery}
              onChange={(e) => setResearchQuery(e.currentTarget.value)}
              data-testid="input-students-research"
            />
            <button
              type="button"
              className="st-btn is-primary"
              disabled={researching || !researchQuery.trim()}
              onClick={() => void handleRunResearch([researchQuery.trim()])}
              data-testid="button-students-research"
            >
              {researching ? (
                <LoaderCircle className="loading-spinner" size={15} />
              ) : (
                <Search size={15} />
              )}
              <span>{researching ? ui.researching : ui.researchBtn}</span>
            </button>
          </div>

          {activeLesson && activeLesson.topics.length > 0 && (
            <div className="st-chip-strip">
              {activeLesson.topics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  className="st-chip"
                  disabled={researching}
                  onClick={() => {
                    setResearchQuery(topic);
                    void handleRunResearch([topic]);
                  }}
                >
                  <Search size={12} />
                  <span>{topic}</span>
                </button>
              ))}
            </div>
          )}

          <div className="st-row">
            <button
              type="button"
              className="st-btn"
              disabled={
                generatingDiagram ||
                (!researchQuery.trim() && !activeLesson?.topics[0])
              }
              onClick={() => void handleGenerateAiDiagram()}
              data-testid="button-students-ai-diagram"
            >
              {generatingDiagram ? (
                <LoaderCircle className="loading-spinner" size={14} />
              ) : (
                <ImagePlus size={14} />
              )}
              <span>
                {generatingDiagram ? ui.generatingDiag : ui.genDiagramBtn}
              </span>
            </button>
          </div>

          {/* Structured Visual Learning Breakdowns */}
          {activeLesson && activeLesson.breakdowns.length > 0 && (
            <>
              <strong style={{ fontSize: 14 }}>{ui.breakdownTitle}</strong>
              {activeLesson.breakdowns.map((bd) => (
                <article key={bd.topic} className="st-breakdown-card">
                  <div className="st-head-row">
                    <strong dir="auto">{bd.topic}</strong>
                    <span className="st-pill is-gold">
                      {bd.subject} · {bd.visualType}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13 }} dir="auto">
                    {bd.summary}
                  </p>
                  {bd.steps.length > 0 && (
                    <div className="st-steps-grid">
                      {bd.steps.map((step, i) => (
                        <div key={i} className="st-step-box" dir="auto">
                          <strong>
                            {i + 1}. {step.label}
                          </strong>
                          <span>{step.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {bd.glossary.length > 0 && (
                    <div className="st-field">
                      <label>{ui.glossaryTitle}</label>
                      <div className="st-row">
                        {bd.glossary.map((g, i) => (
                          <span key={i} className="st-pill" dir="auto">
                            <strong>{g.term}:</strong> {g.definition}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </>
          )}

          {/* Verified Visual Resources & AI Diagrams */}
          {!activeLesson || activeLesson.resources.length === 0 ? (
            <div className="st-empty">{ui.noVisuals}</div>
          ) : (
            <div className="st-visual-grid">
              {activeLesson.resources.map((res) => (
                <article key={res.id} className="st-visual-card">
                  {res.imageUrl && (
                    <img src={res.imageUrl} alt={res.title} loading="lazy" />
                  )}
                  <div className="st-row">
                    <span
                      className={`st-pill ${res.isAiGenerated ? "is-ai" : "is-ok"}`}
                    >
                      {res.isAiGenerated ? ui.aiDiagBadge : `${ui.verifiedBadge} · ${res.sourceName}`}
                    </span>
                  </div>
                  <h3 dir="auto">{res.title}</h3>
                  {res.relationNote && <p dir="auto">{res.relationNote}</p>}
                  {res.summary && <p dir="auto">{res.summary}</p>}
                  {res.scientificCheckNote && (
                    <p style={{ color: "var(--app-accent-text)", fontSize: 11.5 }}>
                      {res.scientificCheckNote}
                    </p>
                  )}
                  <div className="st-head-row" style={{ marginTop: "auto" }}>
                    <small style={{ fontSize: 10.5, color: "var(--app-tertiary)" }}>
                      {res.licenseNote}
                    </small>
                    {res.sourceUrl && (
                      <a
                        className="st-btn"
                        href={res.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span>{ui.openSource}</span>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: REAL INTERACTIVE EXAMS & ADAPTIVE LEARNING */}
      {tab === "exams" && (
        <StudentsExamsPanel
          locale={locale}
          lessons={lessons}
          activeLesson={activeLesson}
          gradeLevel={gradeLevel}
          subject={subject}
          modelSelection={modelSelection}
          pendingAdaptiveRequest={pendingAdaptiveExam}
          onConsumeAdaptiveRequest={() => setPendingAdaptiveExam(null)}
          getIdToken={getIdToken}
          onReexplainTopic={handleAdaptiveReexplain}
        />
      )}

      {/* TAB 5: STUDENT PROGRESS & MASTERY DASHBOARD */}
      {tab === "progress" && (
        <StudentsProgressPanel
          locale={locale}
          getIdToken={getIdToken}
          onReexplainTopic={handleAdaptiveReexplain}
          onStartAdaptiveExam={handleStartAdaptiveExam}
        />
      )}

      {/* TAB 6: MY SAVED LESSONS LIBRARY */}
      {tab === "library" && (
        <div className="st-panel" data-testid="students-library-panel">

          {lessons.length === 0 ? (
            <div className="st-empty">{ui.libraryEmpty}</div>
          ) : (
            lessons.map((lesson) => (
              <article key={lesson.id} className="st-question-item">
                <div className="st-head-row">
                  <div>
                    <strong dir="auto">{lesson.title}</strong>
                    <div className="st-row" style={{ marginTop: 4 }}>
                      <span className="st-pill is-gold">
                        {ui.docTypes[lesson.documentType]}
                      </span>
                      <span className="st-pill">{lesson.subject}</span>
                      <span className="st-pill">{ui.grades[lesson.gradeLevel]}</span>
                      <span className="st-pill">
                        Q: {lesson.questions.length} · Visuals: {lesson.resources.length} · Chat: {lesson.tutorMessages.length}
                      </span>
                    </div>
                  </div>
                  <div className="st-row">
                    <button
                      type="button"
                      className="st-btn"
                      onClick={() => {
                        syncLessonIntoState(lesson, true);
                        handleStartAdaptiveExam({
                          topics:
                            lesson.topics.length > 0
                              ? lesson.topics.slice(0, 4)
                              : [lesson.title],
                          subject: lesson.subject,
                          difficulty: "adaptive",
                          mode: "practice",
                          lessonId: lesson.id,
                        });
                      }}
                    >
                      <ClipboardCheck size={13} />
                      <span>{ui.startExamBtn}</span>
                    </button>
                    <button
                      type="button"
                      className="st-btn is-primary"
                      onClick={() => {
                        syncLessonIntoState(lesson, true);
                        setTab("tutor");
                      }}
                    >
                      {ui.openLesson}
                    </button>
                    <button
                      type="button"
                      className="st-btn is-danger"
                      onClick={() => void handleDeleteLesson(lesson.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      <InAppCameraModal
        open={cameraOpen}
        locale={locale}
        mode="document"
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => void processPhotoFile(file)}
      />
    </section>
  );
}