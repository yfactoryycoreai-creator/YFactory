import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  ClipboardCheck,
  HelpCircle,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import AppSelect from "@/components/app-select";
import { sendYFactoryNotification } from "@/lib/yfactoryNotifications";
import type {
  StudentGradeLevel,
  StudentLessonRecord,
  StudentModelSelection,
} from "@/lib/studentsApi";
import {
  deleteStudentExamApi,
  fetchStudentExamById,
  fetchStudentExams,
  fetchStudentProgress,
  finishInteractiveExamApi,
  generateInteractiveExam,
  StudentsExtendedApiError,
  submitExamAnswerApi,
  type ExamDifficulty,
  type ExamMode,
  type ExamQuestionType,
  type StudentExamRecord,
  type StudentProgressSummary,
} from "@/lib/studentsExtendedApi";
import "./students-exams.css";

const ALL_TYPES: ReadonlyArray<ExamQuestionType> = [
  "multiple_choice",
  "true_false",
  "short_answer",
  "fill_blank",
  "image_based",
  "math_problem",
];

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "الامتحانات التفاعلية الحقيقية والتعلم التكيّفي",
      subtitle:
        "توليد امتحانات من دروسك المدروسة (سؤال واحد في كل مرة)، بوضع امتحان حقيقي بدون مساعدة أو وضع تدريب بتلميحات وشرح فوري.",
      lessonLbl: "اختر درساً مدروساً",
      customLessonOpt: "— موضوع مخصص (بدون درس محدد) —",
      customTopicLbl: "أو اكتب موضوع الامتحان",
      customTopicPh: "مثلاً: الجهاز الهضمي، المعادلات التربيعية، قانون نيوتن الثاني...",
      modeLbl: "وضع الاختبار",
      modePractice: "وضع التدريب (تلميحات + تصحيح فوري بعد كل سؤال)",
      modeExam: "وضع امتحان حقيقي (بلا مساعدة — التصحيح بعد الانتهاء)",
      diffLbl: "مستوى الصعوبة",
      diffs: {
        adaptive: "تكيّفي ذكي (حسب مستوى إتقانك)",
        easy: "سهل / تأسيسي",
        medium: "متوسط",
        hard: "متقدم / تحدي",
      } as Record<ExamDifficulty, string>,
      countLbl: "عدد الأسئلة",
      typesLbl: "أنواع الأسئلة الستة:",
      typeNames: {
        multiple_choice: "اختيار من متعدد",
        true_false: "صح أم خطأ",
        short_answer: "إجابة قصيرة",
        fill_blank: "أكمل الفراغ",
        image_based: "سؤال على صورة/مخطط",
        math_problem: "مسألة رياضية",
      } as Record<ExamQuestionType, string>,
      startBtn: "إنشاء وبدء الامتحان التفاعلي",
      generating: "جارٍ إعداد أسئلة الامتحان...",
      examRuleReal:
        "وضع امتحان حقيقي: التلميحات والتصحيح مخفية حتى تنتهي من الامتحان وتضغط «إنهاء وتصحيح الامتحان».",
      examRulePractice:
        "وضع التدريب: أجب أولاً ليريك النظام التصحيح والشرح التفصيلي — ولا تُكشف الإجابة قبل محاولتك.",
      qOf: (c: number, t: number) => `سؤال ${c} من ${t}`,
      showHint: "إظهار تلميح",
      answerPh: "اكتب إجابتك هنا...",
      submitPractice: "تحقق من إجابتي",
      saveExamAns: "حفظ الإجابة والانتقال للتالي",
      grading: "جارٍ تحليل وتصحيح الإجابة...",
      prev: "السابق",
      next: "التالي",
      finishBtn: "إنهاء وتصحيح الامتحان",
      finishing: "جارٍ التصحيح وإعداد التقرير...",
      correctLbl: "إجابة صحيحة!",
      wrongLbl: "تحتاج مراجعة",
      savedAnsLbl: "تم حفظ إجابتك لهذا السؤال (سيُصحَّح عند إنهاء الامتحان).",
      correctAnsLbl: "الإجابة الصحيحة:",
      yourAnsLbl: "إجابتك:",
      reportTitle: "تقرير الأداء والتعلم التكيّفي",
      weakTitle: "مواضيع سُجّلت للمراجعة التكيّفية:",
      strongTitle: "مواضيع أتقنتها:",
      reexplainBtn: "أعد الشرح في المدرس الذكي",
      retestWeakBtn: "إعادة اختبار المواضيع الضعيفة",
      levelUpBtn: "تحدّي مستوى أصعب",
      newExamBtn: "امتحان جديد",
      recentTitle: "سجل امتحاناتك",
      openExam: "فتح / مراجعة",
      noExams: "لم تُجرِ أي امتحان تفاعلي بعد. أنشئ أول امتحان لك أعلاه!",
      progTitle: "لوحة تتبع تقدم الطالب ومستوى الإتقان",
      kpiLessons: "الدروس المدروسة",
      kpiExams: "الاختبارات المكتملة",
      kpiAvg: "متوسط النتائج",
      kpiMastered: "المواضيع المتقَنة",
      trendTitle: "تطور مستوى الطالب عبر الاختبارات",
      masteredSec: "المواضيع المتقَنة (Mastered)",
      reviewSec: "مواضيع تحتاج مراجعة (Needs Review)",
      learningSec: "مواضيع قيد التعلّم",
      recsTitle: "توصيات التعلم القادمة (التعلم التكيّفي)",
      emptyProg: "أكمل أول اختبار تفاعلي ليبدأ تتبع الإتقان وتطور مستواك تلقائياً.",
      refresh: "تحديث",
    };
  }
  return {
    title: "Real Interactive Exams & Adaptive Learning",
    subtitle:
      "Generate exams from your studied lessons (one question at a time) in Real Exam Mode (no hints until finished) or Practice Mode (hints & instant feedback).",
    lessonLbl: "Select Studied Lesson",
    customLessonOpt: "— Custom Topic (no specific lesson) —",
    customTopicLbl: "Or enter Exam Topic",
    customTopicPh: "e.g. Digestive system, Quadratic equations, Newton's 2nd law...",
    modeLbl: "Assessment Mode",
    modePractice: "Practice Mode (hints + immediate grading & explanation)",
    modeExam: "Real Exam Mode (no assistance — graded after completion)",
    diffLbl: "Difficulty",
    diffs: {
      adaptive: "Smart Adaptive (based on your mastery)",
      easy: "Easy / Foundation",
      medium: "Medium",
      hard: "Hard / Challenge",
    } as Record<ExamDifficulty, string>,
    countLbl: "Question Count",
    typesLbl: "Six Question Types:",
    typeNames: {
      multiple_choice: "Multiple Choice",
      true_false: "True / False",
      short_answer: "Short Answer",
      fill_blank: "Fill in the Blanks",
      image_based: "Image-Based",
      math_problem: "Math Problem",
    } as Record<ExamQuestionType, string>,
    startBtn: "Generate & Start Exam",
    generating: "Building interactive exam...",
    examRuleReal:
      "Real Exam Mode: hints and answers stay strictly hidden until you click Finish & Grade Exam.",
    examRulePractice:
      "Practice Mode: attempt the question first to reveal grading & explanation — answers are never shown beforehand.",
    qOf: (c: number, t: number) => `Question ${c} of ${t}`,
    showHint: "Show Hint",
    answerPh: "Type your answer here...",
    submitPractice: "Check My Answer",
    saveExamAns: "Save Answer & Next",
    grading: "Analyzing & grading...",
    prev: "Previous",
    next: "Next",
    finishBtn: "Finish & Grade Exam",
    finishing: "Grading & building report...",
    correctLbl: "Correct!",
    wrongLbl: "Needs Review",
    savedAnsLbl: "Answer saved (will be graded when you finish the exam).",
    correctAnsLbl: "Correct Answer:",
    yourAnsLbl: "Your Answer:",
    reportTitle: "Performance Report & Adaptive Next Steps",
    weakTitle: "Flagged for Adaptive Review:",
    strongTitle: "Mastered Topics:",
    reexplainBtn: "Re-explain in AI Teacher",
    retestWeakBtn: "Retest Weak Topics",
    levelUpBtn: "Advance to Harder Level",
    newExamBtn: "New Exam",
    recentTitle: "Recent Exams",
    openExam: "Open / Review",
    noExams: "No interactive exams yet. Create your first exam above!",
    progTitle: "Student Progress & Mastery Dashboard",
    kpiLessons: "Lessons Studied",
    kpiExams: "Completed Exams",
    kpiAvg: "Average Score",
    kpiMastered: "Mastered Topics",
    trendTitle: "Student Level Progression",
    masteredSec: "Mastered Topics",
    reviewSec: "Needs Review",
    learningSec: "In Progress",
    recsTitle: "Adaptive Next-Step Recommendations",
    emptyProg: "Complete your first interactive exam to unlock mastery analytics and adaptive recommendations.",
    refresh: "Refresh",
  };
}

export type AdaptiveExamRequest = {
  topics: string[];
  subject: string;
  difficulty: ExamDifficulty;
  mode: ExamMode;
  lessonId?: string;
};

type StudentsExamsPanelProps = {
  locale: string;
  lessons: StudentLessonRecord[];
  activeLesson: StudentLessonRecord | null;
  gradeLevel: StudentGradeLevel;
  subject: string;
  modelSelection?: StudentModelSelection;
  pendingAdaptiveRequest?: AdaptiveExamRequest | null;
  onConsumeAdaptiveRequest?: () => void;
  getIdToken?: () => Promise<string>;
  onReexplainTopic: (topic: string, subject: string) => void;
};

export function StudentsExamsPanel({
  locale,
  lessons,
  activeLesson,
  gradeLevel,
  subject,
  modelSelection,
  pendingAdaptiveRequest,
  onConsumeAdaptiveRequest,
  getIdToken,
  onReexplainTopic,
}: StudentsExamsPanelProps) {
  const isRtl = locale.startsWith("ar");
  const ui = getCopy(locale);

  const [exams, setExams] = useState<StudentExamRecord[]>([]);
  const [activeExam, setActiveExam] = useState<StudentExamRecord | null>(null);
  const [qIdx, setQIdx] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [hintVisible, setHintVisible] = useState(false);

  // Builder state
  const [selectedLessonId, setSelectedLessonId] = useState(activeLesson?.id ?? "");
  const [customTopic, setCustomTopic] = useState("");
  const [mode, setMode] = useState<ExamMode>("practice");
  const [difficulty, setDifficulty] = useState<ExamDifficulty>("adaptive");
  const [questionCount, setQuestionCount] = useState("6");
  const [selectedTypes, setSelectedTypes] = useState<ExamQuestionType[]>([
    ...ALL_TYPES,
  ]);

  const [generating, setGenerating] = useState(false);
  const [submittingAns, setSubmittingAns] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (activeLesson?.id && !selectedLessonId) {
      setSelectedLessonId(activeLesson.id);
    }
  }, [activeLesson?.id, selectedLessonId]);

  const loadExams = useCallback(async () => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      const list = await fetchStudentExams(tok);
      setExams(list);
    } catch {
      // ignore initial error
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  const launchExam = useCallback(
    async (override?: AdaptiveExamRequest) => {
      if (!getIdToken || generating) return;
      setGenerating(true);
      setError("");
      try {
        const tok = await getIdToken();
        const created = await generateInteractiveExam(tok, {
          lessonId: override?.lessonId ?? (selectedLessonId || undefined),
          customTopic: override ? undefined : customTopic.trim() || undefined,
          focusTopics: override?.topics,
          subject:
            override?.subject ??
            (subject !== "Auto / General" ? subject : undefined),
          gradeLevel,
          mode: override?.mode ?? mode,
          difficulty: override?.difficulty ?? difficulty,
          questionCount: Number(questionCount) || 6,
          questionTypes: selectedTypes,
          locale,
          modelSelection,
        });
        setActiveExam(created);
        setQIdx(0);
        setDraftAnswer("");
        setHintVisible(false);
        setExams((prev) => [created, ...prev.filter((e) => e.id !== created.id)]);
      } catch (err) {
        setError(
          err instanceof StudentsExtendedApiError
            ? err.message
            : "Could not generate interactive exam.",
        );
      } finally {
        setGenerating(false);
      }
    },
    [
      getIdToken,
      generating,
      selectedLessonId,
      customTopic,
      subject,
      gradeLevel,
      mode,
      difficulty,
      questionCount,
      selectedTypes,
      locale,
      modelSelection,
    ],
  );

  useEffect(() => {
    if (!pendingAdaptiveRequest) return;
    const req = pendingAdaptiveRequest;
    onConsumeAdaptiveRequest?.();
    setMode(req.mode);
    setDifficulty(req.difficulty);
    setCustomTopic(req.topics.join(", "));
    void launchExam(req);
  }, [pendingAdaptiveRequest]);

  const currentQ = activeExam?.questions[qIdx] ?? null;

  useEffect(() => {
    setDraftAnswer(currentQ?.userAnswer ?? "");
    setHintVisible(false);
  }, [activeExam?.id, qIdx, currentQ?.id]);

  const toggleType = (t: ExamQuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(t)
        ? prev.length > 1
          ? prev.filter((x) => x !== t)
          : prev
        : [...prev, t],
    );
  };

  const handleSubmitCurrentAnswer = async (overrideAns?: string) => {
    if (!getIdToken || !activeExam || !currentQ || submittingAns) return;
    const ans = (overrideAns ?? draftAnswer).trim();
    if (!ans) return;
    setSubmittingAns(true);
    setError("");
    try {
      const tok = await getIdToken();
      const res = await submitExamAnswerApi(tok, activeExam.id, {
        questionId: currentQ.id,
        answer: ans,
        locale,
        modelSelection,
      });
      setActiveExam(res.exam);
      setExams((prev) => prev.map((e) => (e.id === res.exam.id ? res.exam : e)));
      if (res.exam.mode === "exam" && qIdx < res.exam.questions.length - 1) {
        setQIdx((i) => i + 1);
      }
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError
          ? err.message
          : "Could not submit answer.",
      );
    } finally {
      setSubmittingAns(false);
    }
  };

  const handleFinishExam = async () => {
    if (!getIdToken || !activeExam || finishing) return;
    setFinishing(true);
    setError("");
    try {
      const tok = await getIdToken();
      const done = await finishInteractiveExamApi(tok, activeExam.id, {
        locale,
        modelSelection,
      });
      setActiveExam(done);
      setExams((prev) => prev.map((e) => (e.id === done.id ? done : e)));
      void sendYFactoryNotification(
        locale.startsWith("ar") ? "اكتمل تصحيح الامتحان" : "Exam Graded",
        locale.startsWith("ar")
          ? `${done.title} — النتيجة ${done.scorePct ?? 0}% (${done.correctCount}/${done.totalQuestions})`
          : `${done.title} — Score ${done.scorePct ?? 0}% (${done.correctCount}/${done.totalQuestions})`,
        { section: "students", tag: `exam-${done.id}` },
      );
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError
          ? err.message
          : "Could not grade exam.",
      );
    } finally {
      setFinishing(false);
    }
  };

  const handleOpenExam = async (examId: string) => {
    if (!getIdToken) return;
    setError("");
    try {
      const tok = await getIdToken();
      const loaded = await fetchStudentExamById(tok, examId);
      setActiveExam(loaded);
      setQIdx(0);
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError ? err.message : "Could not open exam.",
      );
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      await deleteStudentExamApi(tok, examId);
      setExams((prev) => prev.filter((e) => e.id !== examId));
      if (activeExam?.id === examId) setActiveExam(null);
    } catch {
      setError("Could not delete exam.");
    }
  };

  return (
    <div className="st-panel" data-testid="students-exams-panel">
      <div className="st-head-row">
        <div>
          <strong style={{ fontSize: 15 }}>{ui.title}</strong>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--app-secondary)" }}>
            {ui.subtitle}
          </p>
        </div>
        {activeExam && (
          <button
            type="button"
            className="st-btn"
            onClick={() => setActiveExam(null)}
          >
            <RotateCcw size={13} />
            <span>{ui.newExamBtn}</span>
          </button>
        )}
      </div>

      {error && (
        <div className="st-banner-err" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* VIEW A: COMPLETED PERFORMANCE REPORT */}
      {activeExam && activeExam.status === "completed" ? (
        <div className="se-stack" data-testid="students-exam-report">
          <div className="se-score-hero">
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="st-row" style={{ marginBottom: 6 }}>
                <span className="st-pill is-gold">{ui.reportTitle}</span>
                <span className="st-pill">{activeExam.subject}</span>
                <span className="st-pill">
                  {activeExam.mode === "exam" ? "Exam Mode" : "Practice Mode"}
                </span>
              </div>
              <strong style={{ fontSize: 16 }} dir="auto">
                {activeExam.title}
              </strong>
              {activeExam.summaryNote && (
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                    color: "var(--app-secondary)",
                  }}
                  dir="auto"
                >
                  {activeExam.summaryNote}
                </p>
              )}
            </div>
            <div className="se-score-circle" dir="ltr">
              {activeExam.scorePct ?? 0}%
            </div>
          </div>

          {/* Adaptive Learning Actions */}
          {activeExam.weakTopics.length > 0 && (
            <div className="se-card">
              <strong style={{ fontSize: 13.5, color: "var(--app-danger-text)" }}>
                {ui.weakTitle}
              </strong>
              <div className="st-row">
                {activeExam.weakTopics.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className="st-btn"
                    onClick={() => onReexplainTopic(topic, activeExam.subject)}
                  >
                    <MessageSquare size={13} />
                    <span>
                      {ui.reexplainBtn}: {topic}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="st-btn is-primary"
                  disabled={generating}
                  onClick={() =>
                    void launchExam({
                      topics: activeExam.weakTopics,
                      subject: activeExam.subject,
                      difficulty: "easy",
                      mode: "practice",
                      lessonId: activeExam.lessonId ?? undefined,
                    })
                  }
                >
                  <RefreshCw size={13} />
                  <span>{ui.retestWeakBtn}</span>
                </button>
              </div>
            </div>
          )}

          {activeExam.strongTopics.length > 0 && (
            <div className="se-card">
              <strong style={{ fontSize: 13.5, color: "var(--app-success-text)" }}>
                {ui.strongTitle}
              </strong>
              <div className="st-row">
                {activeExam.strongTopics.map((t) => (
                  <span key={t} className="st-pill is-ok">
                    <Award size={12} />
                    {t}
                  </span>
                ))}
                <button
                  type="button"
                  className="st-btn is-primary"
                  disabled={generating}
                  onClick={() =>
                    void launchExam({
                      topics: activeExam.strongTopics,
                      subject: activeExam.subject,
                      difficulty: "hard",
                      mode: "exam",
                      lessonId: activeExam.lessonId ?? undefined,
                    })
                  }
                >
                  <TrendingUp size={13} />
                  <span>{ui.levelUpBtn}</span>
                </button>
              </div>
            </div>
          )}

          {/* Per-question graded breakdown */}
          {activeExam.questions.map((q) => (
            <article key={q.id} className="se-card">
              <div className="st-head-row">
                <div className="st-row">
                  <span className="st-pill is-gold">Q{q.index}</span>
                  <span className="st-pill">{ui.typeNames[q.type]}</span>
                  <span className="st-pill">{q.topic}</span>
                </div>
                <span className={`st-pill ${q.isCorrect ? "is-ok" : ""}`}>
                  {q.isCorrect ? ui.correctLbl : ui.wrongLbl} ({q.score ?? 0}%)
                </span>
              </div>
              {q.imageUrl && (
                <img className="se-q-image" src={q.imageUrl} alt={q.imageCaption ?? ""} />
              )}
              <p className="se-q-prompt" dir="auto">
                {q.prompt}
              </p>
              <div className={`se-feedback-box ${q.isCorrect ? "is-ok" : "is-err"}`}>
                <span dir="auto">
                  <strong>{ui.yourAnsLbl}</strong> {q.userAnswer || "—"}
                </span>
                <span dir="auto">
                  <strong>{ui.correctAnsLbl}</strong> {q.correctAnswer}
                </span>
                {q.feedback && <span dir="auto">{q.feedback}</span>}
              </div>
            </article>
          ))}
        </div>
      ) : activeExam && currentQ ? (
        /* VIEW B: ACTIVE EXAM RUNNER (ONE QUESTION AT A TIME) */
        <div className="se-stack" data-testid="students-exam-runner">
          <div className="st-banner-ok">
            <ShieldCheck size={15} />
            <span>
              {activeExam.mode === "exam" ? ui.examRuleReal : ui.examRulePractice}
            </span>
          </div>

          <div className="st-head-row">
            <strong>
              {ui.qOf(qIdx + 1, activeExam.totalQuestions)} · {activeExam.title}
            </strong>
            <span className="st-pill is-gold">
              {activeExam.answeredCount}/{activeExam.totalQuestions}
            </span>
          </div>

          <div className="se-progress-bar">
            <div
              className="se-progress-fill"
              style={{
                width: `${Math.round(((qIdx + 1) / Math.max(1, activeExam.totalQuestions)) * 100)}%`,
              }}
            />
          </div>

          <article className="se-card is-highlight">
            <div className="st-row">
              <span className="st-pill is-gold">{ui.typeNames[currentQ.type]}</span>
              <span className="st-pill">{currentQ.topic}</span>
              <span className="st-pill">{currentQ.difficulty}</span>
            </div>

            {currentQ.imageUrl && (
              <figure style={{ margin: 0 }}>
                <img
                  className="se-q-image"
                  src={currentQ.imageUrl}
                  alt={currentQ.imageCaption ?? ""}
                />
                {currentQ.imageCaption && (
                  <figcaption
                    style={{
                      fontSize: 11.5,
                      color: "var(--app-secondary)",
                      marginTop: 4,
                    }}
                  >
                    {currentQ.imageCaption}
                  </figcaption>
                )}
              </figure>
            )}

            <p className="se-q-prompt" dir="auto">
              {currentQ.prompt}
            </p>

            {/* Hint ONLY in Practice Mode */}
            {activeExam.mode === "practice" && currentQ.hint && (
              <div>
                {hintVisible ? (
                  <div className="se-hint-box" dir="auto">
                    <Lightbulb size={14} style={{ verticalAlign: "middle" }} />{" "}
                    {currentQ.hint}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="st-btn"
                    onClick={() => setHintVisible(true)}
                  >
                    <HelpCircle size={14} />
                    <span>{ui.showHint}</span>
                  </button>
                )}
              </div>
            )}

            {/* Answer Input: MCQ / True-False vs Text/Blank/Math */}
            {currentQ.options.length > 0 ? (
              <div className="se-options-list">
                {currentQ.options.map((opt) => {
                  const isPicked = draftAnswer === opt;
                  const graded =
                    activeExam.mode === "practice" && currentQ.isCorrect !== null;
                  const isRightOpt =
                    graded &&
                    currentQ.correctAnswer.trim().toLowerCase() ===
                      opt.trim().toLowerCase();
                  const isWrongPicked =
                    graded && currentQ.userAnswer === opt && !currentQ.isCorrect;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={submittingAns || graded}
                      className={`se-option-btn${isPicked ? " is-selected" : ""}${
                        isRightOpt ? " is-correct" : ""
                      }${isWrongPicked ? " is-wrong" : ""}`}
                      onClick={() => setDraftAnswer(opt)}
                    >
                      <span dir="auto">{opt}</span>
                      {isRightOpt && <CheckCircle2 size={16} />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                className="st-textarea"
                dir="auto"
                disabled={
                  submittingAns ||
                  (activeExam.mode === "practice" && currentQ.isCorrect !== null)
                }
                placeholder={ui.answerPh}
                value={draftAnswer}
                onChange={(e) => setDraftAnswer(e.currentTarget.value)}
                data-testid="input-exam-answer"
              />
            )}

            {/* Practice mode immediate explanation AFTER attempt */}
            {activeExam.mode === "practice" && currentQ.isCorrect !== null && (
              <div
                className={`se-feedback-box ${
                  currentQ.isCorrect ? "is-ok" : "is-err"
                }`}
              >
                <strong>
                  {currentQ.isCorrect ? ui.correctLbl : ui.wrongLbl} ({currentQ.score ?? 0}%)
                </strong>
                <span dir="auto">
                  <strong>{ui.correctAnsLbl}</strong> {currentQ.correctAnswer}
                </span>
                {currentQ.feedback && <span dir="auto">{currentQ.feedback}</span>}
              </div>
            )}

            {/* Real exam saved confirmation without spoiling answer */}
            {activeExam.mode === "exam" && currentQ.userAnswer !== null && (
              <div className="st-banner-ok">
                <CheckCircle2 size={14} />
                <span>{ui.savedAnsLbl}</span>
              </div>
            )}

            <div className="st-head-row">
              <div className="st-row">
                <button
                  type="button"
                  className="st-btn"
                  disabled={qIdx === 0}
                  onClick={() => setQIdx((i) => Math.max(0, i - 1))}
                >
                  <ArrowLeft size={14} />
                  <span>{ui.prev}</span>
                </button>
                <button
                  type="button"
                  className="st-btn"
                  disabled={qIdx >= activeExam.questions.length - 1}
                  onClick={() =>
                    setQIdx((i) => Math.min(activeExam.questions.length - 1, i + 1))
                  }
                >
                  <span>{ui.next}</span>
                  <ArrowRight size={14} />
                </button>
              </div>

              <div className="st-row">
                {!(activeExam.mode === "practice" && currentQ.isCorrect !== null) && (
                  <button
                    type="button"
                    className="st-btn is-primary"
                    disabled={submittingAns || !draftAnswer.trim()}
                    onClick={() => void handleSubmitCurrentAnswer()}
                    data-testid="button-submit-exam-answer"
                  >
                    {submittingAns ? (
                      <LoaderCircle className="loading-spinner" size={14} />
                    ) : (
                      <ClipboardCheck size={14} />
                    )}
                    <span>
                      {submittingAns
                        ? ui.grading
                        : activeExam.mode === "exam"
                          ? ui.saveExamAns
                          : ui.submitPractice}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  className="st-btn is-primary"
                  disabled={finishing || activeExam.answeredCount === 0}
                  onClick={() => void handleFinishExam()}
                  data-testid="button-finish-exam"
                >
                  {finishing ? (
                    <LoaderCircle className="loading-spinner" size={14} />
                  ) : (
                    <Award size={14} />
                  )}
                  <span>{finishing ? ui.finishing : ui.finishBtn}</span>
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : (
        /* VIEW C: EXAM BUILDER + RECENT HISTORY */
        <div className="se-stack">
          <div className="se-card">
            <div className="st-config-grid">
              <div className="st-field">
                <label>{ui.lessonLbl}</label>
                <AppSelect
                  title={ui.lessonLbl}
                  value={selectedLessonId}
                  dir={isRtl ? "rtl" : "ltr"}
                  options={[
                    { value: "", label: ui.customLessonOpt },
                    ...lessons.map((l) => ({
                      value: l.id,
                      label: l.title,
                      subtitle: `${l.subject} · ${l.topics.slice(0, 2).join(", ")}`,
                    })),
                  ]}
                  onChange={setSelectedLessonId}
                />
              </div>

              <div className="st-field">
                <label>{ui.modeLbl}</label>
                <AppSelect
                  title={ui.modeLbl}
                  value={mode}
                  dir={isRtl ? "rtl" : "ltr"}
                  options={[
                    { value: "practice", label: ui.modePractice },
                    { value: "exam", label: ui.modeExam },
                  ]}
                  onChange={(v) => setMode(v as ExamMode)}
                />
              </div>

              <div className="st-field">
                <label>{ui.diffLbl}</label>
                <AppSelect
                  title={ui.diffLbl}
                  value={difficulty}
                  dir={isRtl ? "rtl" : "ltr"}
                  options={(Object.keys(ui.diffs) as ExamDifficulty[]).map((d) => ({
                    value: d,
                    label: ui.diffs[d],
                  }))}
                  onChange={(v) => setDifficulty(v as ExamDifficulty)}
                />
              </div>

              <div className="st-field">
                <label>{ui.countLbl}</label>
                <AppSelect
                  title={ui.countLbl}
                  value={questionCount}
                  dir={isRtl ? "rtl" : "ltr"}
                  options={["4", "6", "8", "10"].map((n) => ({
                    value: n,
                    label: n,
                  }))}
                  onChange={setQuestionCount}
                />
              </div>
            </div>

            {!selectedLessonId && (
              <div className="st-field">
                <label>{ui.customTopicLbl}</label>
                <input
                  className="st-input"
                  dir="auto"
                  placeholder={ui.customTopicPh}
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.currentTarget.value)}
                  data-testid="input-exam-custom-topic"
                />
              </div>
            )}

            <div className="st-field">
              <label>{ui.typesLbl}</label>
              <div className="se-type-grid">
                {ALL_TYPES.map((t) => {
                  const on = selectedTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`se-type-toggle${on ? " is-on" : ""}`}
                      onClick={() => toggleType(t)}
                    >
                      {on && <CheckCircle2 size={12} />}
                      <span>{ui.typeNames[t]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="st-btn is-primary"
              disabled={generating || (!selectedLessonId && !customTopic.trim())}
              onClick={() => void launchExam()}
              data-testid="button-generate-exam"
            >
              {generating ? (
                <LoaderCircle className="loading-spinner" size={16} />
              ) : (
                <Play size={15} />
              )}
              <span>{generating ? ui.generating : ui.startBtn}</span>
            </button>
          </div>

          <strong style={{ fontSize: 14 }}>
            {ui.recentTitle} ({exams.length})
          </strong>
          {exams.length === 0 ? (
            <div className="st-empty">{ui.noExams}</div>
          ) : (
            exams.map((ex) => (
              <article key={ex.id} className="se-card">
                <div className="st-head-row">
                  <div>
                    <strong dir="auto">{ex.title}</strong>
                    <div className="st-row" style={{ marginTop: 4 }}>
                      <span className="st-pill is-gold">{ex.subject}</span>
                      <span className="st-pill">
                        {ex.mode === "exam" ? "Real Exam" : "Practice"}
                      </span>
                      <span className={`st-pill ${ex.status === "completed" ? "is-ok" : ""}`}>
                        {ex.status === "completed"
                          ? `${ex.scorePct ?? 0}% (${ex.correctCount}/${ex.totalQuestions})`
                          : `${ex.answeredCount}/${ex.totalQuestions}`}
                      </span>
                    </div>
                  </div>
                  <div className="st-row">
                    <button
                      type="button"
                      className="st-btn is-primary"
                      onClick={() => void handleOpenExam(ex.id)}
                    >
                      {ui.openExam}
                    </button>
                    <button
                      type="button"
                      className="st-btn is-danger"
                      onClick={() => void handleDeleteExam(ex.id)}
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
    </div>
  );
}

/* ==================== STUDENT PROGRESS DASHBOARD ==================== */

type StudentsProgressPanelProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onReexplainTopic: (topic: string, subject: string) => void;
  onStartAdaptiveExam: (req: AdaptiveExamRequest) => void;
};

export function StudentsProgressPanel({
  locale,
  getIdToken,
  onReexplainTopic,
  onStartAdaptiveExam,
}: StudentsProgressPanelProps) {
  const ui = getCopy(locale);
  const [progress, setProgress] = useState<StudentProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!getIdToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const tok = await getIdToken();
      const data = await fetchStudentProgress(tok, locale);
      setProgress(data);
    } catch (err) {
      setError(
        err instanceof StudentsExtendedApiError
          ? err.message
          : "Could not load student progress.",
      );
    } finally {
      setLoading(false);
    }
  }, [getIdToken, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="st-panel" data-testid="students-progress-panel">
      <div className="st-head-row">
        <strong style={{ fontSize: 15 }}>{ui.progTitle}</strong>
        <button
          type="button"
          className="st-btn"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={13} className={loading ? "loading-spinner" : ""} />
          <span>{ui.refresh}</span>
        </button>
      </div>

      {error && (
        <div className="st-banner-err" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {loading && !progress ? (
        <div className="st-empty">
          <LoaderCircle className="loading-spinner" size={22} />
        </div>
      ) : !progress ? (
        <div className="st-empty">{ui.emptyProg}</div>
      ) : (
        <div className="se-stack">
          <div className="se-kpi-grid">
            <div className="se-kpi-box">
              <strong>{progress.lessonsStudiedCount}</strong>
              <span>{ui.kpiLessons}</span>
            </div>
            <div className="se-kpi-box">
              <strong>{progress.examsCompletedCount}</strong>
              <span>{ui.kpiExams}</span>
            </div>
            <div className="se-kpi-box">
              <strong dir="ltr">
                {progress.averageScorePct !== null
                  ? `${progress.averageScorePct}%`
                  : "—"}
              </strong>
              <span>{ui.kpiAvg}</span>
            </div>
            <div className="se-kpi-box">
              <strong>{progress.masteredTopics.length}</strong>
              <span>{ui.kpiMastered}</span>
            </div>
          </div>

          {progress.levelTrend.length > 0 && (
            <div className="st-field">
              <label>{ui.trendTitle}</label>
              <div className="se-trend-bars">
                {progress.levelTrend.map((pt) => (
                  <div key={pt.examId} className="se-trend-col" title={pt.title}>
                    <small dir="ltr">{pt.scorePct}%</small>
                    <div
                      className="se-trend-bar"
                      style={{ height: `${Math.max(10, pt.scorePct)}%` }}
                    />
                    <small>{pt.title.slice(0, 8)}</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {progress.nextRecommendations.length > 0 && (
            <div className="st-field">
              <label>{ui.recsTitle}</label>
              <div className="se-stack">
                {progress.nextRecommendations.map((rec, i) => (
                  <div key={`${rec.kind}-${rec.topic}-${i}`} className="se-card">
                    <div className="st-head-row">
                      <div>
                        <strong dir="auto">{rec.topic}</strong>{" "}
                        <span className="st-pill">{rec.subject}</span>
                        <p
                          style={{
                            margin: "4px 0 0",
                            fontSize: 12.5,
                            color: "var(--app-secondary)",
                          }}
                          dir="auto"
                        >
                          {rec.reason}
                        </p>
                      </div>
                      {rec.kind === "reexplain_weak" ? (
                        <button
                          type="button"
                          className="st-btn is-primary"
                          onClick={() => onReexplainTopic(rec.topic, rec.subject)}
                        >
                          <MessageSquare size={13} />
                          <span>{ui.reexplainBtn}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="st-btn is-primary"
                          onClick={() =>
                            onStartAdaptiveExam({
                              topics: [rec.topic],
                              subject: rec.subject,
                              difficulty:
                                rec.kind === "advance_mastered"
                                  ? "hard"
                                  : rec.kind === "retest_weak"
                                    ? "easy"
                                    : "adaptive",
                              mode:
                                rec.kind === "advance_mastered"
                                  ? "exam"
                                  : "practice",
                            })
                          }
                        >
                          <Sparkles size={13} />
                          <span>
                            {rec.kind === "advance_mastered"
                              ? ui.levelUpBtn
                              : ui.retestWeakBtn}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="se-mastery-grid">
            <div className="se-card">
              <strong style={{ fontSize: 13, color: "var(--app-success-text)" }}>
                {ui.masteredSec} ({progress.masteredTopics.length})
              </strong>
              {progress.masteredTopics.length === 0 ? (
                <small style={{ color: "var(--app-secondary)" }}>—</small>
              ) : (
                progress.masteredTopics.map((m) => (
                  <span key={m.id} className="st-pill is-ok">
                    {m.topic} ({m.accuracyPct}%)
                  </span>
                ))
              )}
            </div>

            <div className="se-card">
              <strong style={{ fontSize: 13, color: "var(--app-danger-text)" }}>
                {ui.reviewSec} ({progress.reviewTopics.length})
              </strong>
              {progress.reviewTopics.length === 0 ? (
                <small style={{ color: "var(--app-secondary)" }}>—</small>
              ) : (
                progress.reviewTopics.map((m) => (
                  <span key={m.id} className="st-pill">
                    {m.topic} ({m.accuracyPct}%)
                  </span>
                ))
              )}
            </div>

            <div className="se-card">
              <strong style={{ fontSize: 13 }}>
                {ui.learningSec} ({progress.learningTopics.length})
              </strong>
              {progress.learningTopics.length === 0 ? (
                <small style={{ color: "var(--app-secondary)" }}>—</small>
              ) : (
                progress.learningTopics.map((m) => (
                  <span key={m.id} className="st-pill is-gold">
                    {m.topic} ({m.accuracyPct}%)
                  </span>
                ))
              )}
            </div>
          </div>

          {progress.examsCompletedCount === 0 && (
            <div className="st-empty">{ui.emptyProg}</div>
          )}
        </div>
      )}
    </div>
  );
}