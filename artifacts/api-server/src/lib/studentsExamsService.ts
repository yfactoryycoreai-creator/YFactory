import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  clearChatVaultKeyFailure,
  getChatVaultEntry,
  listChatVaultKeys,
  recordChatVaultKeyFailure,
  type ChatVaultEntry,
} from "./apiKeyVault";
import { CHAT_ADAPTERS, type ChatMessage } from "./chatAdapters";
import { ChatServiceError, completeWithRotation } from "./chatService";
import { getFirebaseAdmin } from "./firebaseAdmin";
import { getActiveSkillInstructionsForScope } from "./skillsService";
import {
  getStudentLesson,
  listStudentLessons,
  StudentsServiceError,
  type StudentGradeLevel,
  type StudentLessonRecord,
} from "./studentsService";

export type ExamQuestionType =
  | "multiple_choice"
  | "true_false"
  | "short_answer"
  | "fill_blank"
  | "image_based"
  | "math_problem";

export type ExamMode = "exam" | "practice";
export type ExamDifficulty = "adaptive" | "easy" | "medium" | "hard";

export type ExamQuestionRecord = {
  id: string;
  index: number;
  type: ExamQuestionType;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: string[];
  imageUrl: string | null;
  imageCaption: string | null;
  hint: string;
  correctAnswer: string;
  explanation: string;
  userAnswer: string | null;
  isCorrect: boolean | null;
  score: number | null;
  feedback: string | null;
  answeredAt: number | null;
};

export type StudentExamRecord = {
  id: string;
  lessonId: string | null;
  title: string;
  subject: string;
  gradeLevel: StudentGradeLevel;
  mode: ExamMode;
  difficulty: ExamDifficulty;
  topics: string[];
  status: "in_progress" | "completed";
  questions: ExamQuestionRecord[];
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  scorePct: number | null;
  weakTopics: string[];
  strongTopics: string[];
  summaryNote: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type TopicMasteryRecord = {
  id: string;
  topic: string;
  subject: string;
  attempts: number;
  correctCount: number;
  accuracyPct: number;
  difficultyTier: "foundation" | "intermediate" | "advanced";
  status: "needs_review" | "learning" | "mastered";
  lastPracticedAt: number;
};

export type StudentProgressSummary = {
  lessonsStudiedCount: number;
  examsCompletedCount: number;
  averageScorePct: number | null;
  masteredTopics: TopicMasteryRecord[];
  reviewTopics: TopicMasteryRecord[];
  learningTopics: TopicMasteryRecord[];
  examHistory: Array<{
    id: string;
    title: string;
    subject: string;
    mode: ExamMode;
    scorePct: number | null;
    correctCount: number;
    totalQuestions: number;
    status: "in_progress" | "completed";
    completedAt: number | null;
    createdAt: number;
  }>;
  levelTrend: Array<{
    examId: string;
    title: string;
    scorePct: number;
    date: number;
  }>;
  nextRecommendations: Array<{
    kind: "reexplain_weak" | "retest_weak" | "advance_mastered" | "start_first_exam";
    topic: string;
    subject: string;
    reason: string;
  }>;
};

const ALL_QUESTION_TYPES: ReadonlyArray<ExamQuestionType> = [
  "multiple_choice",
  "true_false",
  "short_answer",
  "fill_blank",
  "image_based",
  "math_problem",
];

function userExamsCollection(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("studentExams");
}

function userMasteryCollection(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("studentMastery");
}

function topicDocId(subject: string, topic: string): string {
  const clean = `${subject}_${topic}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  if (clean.length >= 3) return clean;
  return `topic_${Buffer.from(`${subject}:${topic}`).toString("hex").slice(0, 24)}`;
}

async function resolveExamModelEntry(
  uid: string,
  preferred?: { provider?: string; keyId?: string; modelName?: string },
): Promise<ChatVaultEntry> {
  if (preferred?.provider && preferred?.keyId && preferred?.modelName) {
    const entry = await getChatVaultEntry(
      uid,
      preferred.provider,
      preferred.keyId,
      preferred.modelName,
    );
    if (!entry || !entry.enabled) {
      throw new StudentsServiceError(
        `Selected model "${preferred.modelName}" is not enabled in Provider Center.`,
        "missing_key",
        404,
      );
    }
    if (entry.failed) {
      throw new StudentsServiceError(
        `API key for "${preferred.modelName}" failed authentication. Check Provider Center or choose another model.`,
        "auth_failed",
        401,
      );
    }
    if (entry.cooldownUntil && entry.cooldownUntil > Date.now()) {
      const sec = Math.ceil((entry.cooldownUntil - Date.now()) / 1000);
      throw new StudentsServiceError(
        `"${preferred.modelName}" is rate-limited (${sec}s cooldown). Wait or switch model.`,
        "rate_limited",
        429,
      );
    }
    return entry;
  }

  const allKeys = await listChatVaultKeys(uid);
  const now = Date.now();
  const ready = allKeys.filter(
    (k) =>
      k.enabled &&
      !k.failed &&
      (!k.cooldownUntil || k.cooldownUntil <= now) &&
      k.provider in CHAT_ADAPTERS,
  );
  for (const cand of ready) {
    const entry = await getChatVaultEntry(uid, cand.provider, cand.id, cand.modelName);
    if (entry && entry.enabled && !entry.failed) return entry;
  }
  throw new StudentsServiceError(
    "Enable an AI model in Provider Center before generating interactive exams.",
    "missing_key",
    404,
  );
}

async function callExamAi(
  uid: string,
  entry: ChatVaultEntry,
  messages: ChatMessage[],
): Promise<string> {
  try {
    return await completeWithRotation({
      provider: entry.provider as never,
      model: entry.modelName,
      messages,
      keys: [{ id: entry.id, value: entry.value }],
      adapters: CHAT_ADAPTERS,
      onFailure: (kId, status) =>
        recordChatVaultKeyFailure(uid, entry.provider, kId, status),
      onSuccess: (kId) =>
        clearChatVaultKeyFailure(uid, entry.provider, kId),
    });
  } catch (err) {
    const code = err instanceof ChatServiceError ? err.code : "timeout";
    const status = code === "auth_failed" ? 401 : code === "rate_limited" ? 429 : 503;
    throw new StudentsServiceError(
      `${entry.modelName}: Exam AI request failed (${code}).`,
      code,
      status,
    );
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1]!.trim() : raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeQuestionType(raw: unknown): ExamQuestionType {
  if (
    raw === "multiple_choice" ||
    raw === "true_false" ||
    raw === "short_answer" ||
    raw === "fill_blank" ||
    raw === "image_based" ||
    raw === "math_problem"
  ) {
    return raw;
  }
  return "multiple_choice";
}

function examFromDoc(id: string, d: Record<string, unknown>): StudentExamRecord {
  const rawQuestions = Array.isArray(d.questions)
    ? (d.questions as Array<Record<string, unknown>>)
    : [];
  const questions: ExamQuestionRecord[] = rawQuestions.map((q, idx) => ({
    id: typeof q.id === "string" && q.id ? q.id : `q_${idx + 1}`,
    index: typeof q.index === "number" ? q.index : idx + 1,
    type: normalizeQuestionType(q.type),
    topic: String(q.topic ?? "General").slice(0, 120),
    difficulty:
      q.difficulty === "easy" || q.difficulty === "hard" ? q.difficulty : "medium",
    prompt: String(q.prompt ?? "").slice(0, 1400),
    options: Array.isArray(q.options)
      ? q.options.filter((x): x is string => typeof x === "string").slice(0, 6)
      : [],
    imageUrl: typeof q.imageUrl === "string" && q.imageUrl ? q.imageUrl : null,
    imageCaption:
      typeof q.imageCaption === "string" && q.imageCaption ? q.imageCaption : null,
    hint: String(q.hint ?? "").slice(0, 400),
    correctAnswer: String(q.correctAnswer ?? "").slice(0, 600),
    explanation: String(q.explanation ?? "").slice(0, 1200),
    userAnswer: typeof q.userAnswer === "string" ? q.userAnswer : null,
    isCorrect: typeof q.isCorrect === "boolean" ? q.isCorrect : null,
    score: typeof q.score === "number" ? q.score : null,
    feedback: typeof q.feedback === "string" ? q.feedback : null,
    answeredAt: typeof q.answeredAt === "number" ? q.answeredAt : null,
  }));

  return {
    id,
    lessonId: typeof d.lessonId === "string" && d.lessonId ? d.lessonId : null,
    title: String(d.title ?? "Interactive Exam").slice(0, 160),
    subject: String(d.subject ?? "General").slice(0, 80),
    gradeLevel:
      d.gradeLevel === "elementary" ||
      d.gradeLevel === "middle" ||
      d.gradeLevel === "university"
        ? d.gradeLevel
        : "high_school",
    mode: d.mode === "exam" ? "exam" : "practice",
    difficulty:
      d.difficulty === "easy" ||
      d.difficulty === "medium" ||
      d.difficulty === "hard"
        ? d.difficulty
        : "adaptive",
    topics: Array.isArray(d.topics)
      ? d.topics.filter((x): x is string => typeof x === "string").slice(0, 12)
      : [],
    status: d.status === "completed" ? "completed" : "in_progress",
    questions,
    totalQuestions: questions.length,
    answeredCount: questions.filter((q) => q.userAnswer !== null).length,
    correctCount: questions.filter((q) => q.isCorrect === true).length,
    scorePct: typeof d.scorePct === "number" ? d.scorePct : null,
    weakTopics: Array.isArray(d.weakTopics)
      ? d.weakTopics.filter((x): x is string => typeof x === "string")
      : [],
    strongTopics: Array.isArray(d.strongTopics)
      ? d.strongTopics.filter((x): x is string => typeof x === "string")
      : [],
    summaryNote: typeof d.summaryNote === "string" ? d.summaryNote : null,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
    completedAt: typeof d.completedAt === "number" ? d.completedAt : null,
  };
}

/**
 * Strictly hides answers & explanations until appropriate:
 * - Never reveals an answer before the student attempts the question.
 * - In "exam" mode, hides answers, hints, grading, and explanations until status === "completed".
 * - In "practice" mode, reveals answer/explanation ONLY for questions already answered.
 */
export function serializeExamForClient(exam: StudentExamRecord): StudentExamRecord {
  const isDone = exam.status === "completed";
  return {
    ...exam,
    questions: exam.questions.map((q) => {
      const answered = q.userAnswer !== null;
      const revealSolution = isDone || (exam.mode === "practice" && answered);
      const revealHint = exam.mode === "practice";
      return {
        ...q,
        hint: revealHint ? q.hint : "",
        correctAnswer: revealSolution ? q.correctAnswer : "",
        explanation: revealSolution ? q.explanation : "",
        isCorrect: revealSolution ? q.isCorrect : null,
        score: revealSolution ? q.score : null,
        feedback: revealSolution ? q.feedback : null,
      };
    }),
  };
}

function masteryFromDoc(id: string, d: Record<string, unknown>): TopicMasteryRecord {
  const attempts = typeof d.attempts === "number" ? d.attempts : 0;
  const correctCount = typeof d.correctCount === "number" ? d.correctCount : 0;
  const accuracyPct =
    attempts > 0 ? Math.round((correctCount / attempts) * 100) : 0;
  const status: TopicMasteryRecord["status"] =
    attempts >= 2 && accuracyPct >= 80
      ? "mastered"
      : accuracyPct < 60
        ? "needs_review"
        : "learning";
  const difficultyTier: TopicMasteryRecord["difficultyTier"] =
    status === "mastered"
      ? "advanced"
      : status === "needs_review"
        ? "foundation"
        : "intermediate";
  return {
    id,
    topic: String(d.topic ?? "General").slice(0, 120),
    subject: String(d.subject ?? "General").slice(0, 80),
    attempts,
    correctCount,
    accuracyPct,
    difficultyTier,
    status,
    lastPracticedAt:
      typeof d.lastPracticedAt === "number" ? d.lastPracticedAt : Date.now(),
  };
}

async function listTopicMastery(uid: string): Promise<TopicMasteryRecord[]> {
  const snap = await userMasteryCollection(uid).limit(100).get();
  return snap.docs
    .map((doc) => masteryFromDoc(doc.id, doc.data()))
    .sort((a, b) => b.lastPracticedAt - a.lastPracticedAt);
}

async function recordMasteryUpdates(
  uid: string,
  subject: string,
  gradedQuestions: ExamQuestionRecord[],
): Promise<void> {
  const perTopic = new Map<string, { attempts: number; correct: number }>();
  for (const q of gradedQuestions) {
    if (q.userAnswer === null) continue;
    const t = q.topic.trim() || "General";
    const prev = perTopic.get(t) ?? { attempts: 0, correct: 0 };
    prev.attempts += 1;
    if (q.isCorrect) prev.correct += 1;
    perTopic.set(t, prev);
  }
  if (perTopic.size === 0) return;

  const now = Date.now();
  for (const [topic, delta] of perTopic.entries()) {
    const id = topicDocId(subject, topic);
    const ref = userMasteryCollection(uid).doc(id);
    const snap = await ref.get();
    const prev = snap.exists ? masteryFromDoc(id, snap.data() ?? {}) : null;
    const attempts = (prev?.attempts ?? 0) + delta.attempts;
    const correctCount = (prev?.correctCount ?? 0) + delta.correct;
    const accuracyPct = Math.round((correctCount / Math.max(1, attempts)) * 100);
    const status: TopicMasteryRecord["status"] =
      attempts >= 2 && accuracyPct >= 80
        ? "mastered"
        : accuracyPct < 60
          ? "needs_review"
          : "learning";
    const difficultyTier: TopicMasteryRecord["difficultyTier"] =
      status === "mastered"
        ? "advanced"
        : status === "needs_review"
          ? "foundation"
          : "intermediate";
    await ref.set(
      {
        topic,
        subject,
        attempts,
        correctCount,
        accuracyPct,
        difficultyTier,
        status,
        lastPracticedAt: now,
      },
      { merge: true },
    );
  }
}

export async function createInteractiveExam(
  uid: string,
  input: {
    lessonId?: string;
    customTopic?: string;
    focusTopics?: string[];
    subject?: string;
    gradeLevel?: StudentGradeLevel;
    mode?: ExamMode;
    difficulty?: ExamDifficulty;
    questionCount?: number;
    questionTypes?: ExamQuestionType[];
    locale?: string;
    modelSelection?: { provider?: string; keyId?: string; modelName?: string };
  },
): Promise<StudentExamRecord> {
  const lesson: StudentLessonRecord | null = input.lessonId
    ? await getStudentLesson(uid, input.lessonId)
    : null;

  const subject = input.subject?.trim() || lesson?.subject || "General";
  const gradeLevel: StudentGradeLevel =
    input.gradeLevel ?? lesson?.gradeLevel ?? "high_school";
  const mode: ExamMode = input.mode === "exam" ? "exam" : "practice";
  const difficulty: ExamDifficulty =
    input.difficulty === "easy" ||
    input.difficulty === "medium" ||
    input.difficulty === "hard"
      ? input.difficulty
      : "adaptive";
  const count = Math.max(3, Math.min(12, Math.round(input.questionCount ?? 6)));
  const requestedTypes =
    Array.isArray(input.questionTypes) && input.questionTypes.length > 0
      ? input.questionTypes.filter((t) => ALL_QUESTION_TYPES.includes(t))
      : [...ALL_QUESTION_TYPES];

  const topics =
    Array.isArray(input.focusTopics) && input.focusTopics.length > 0
      ? input.focusTopics.map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : input.customTopic?.trim()
        ? [input.customTopic.trim().slice(0, 140)]
        : lesson && lesson.topics.length > 0
          ? lesson.topics.slice(0, 6)
          : lesson
            ? [lesson.title]
            : [];

  if (topics.length === 0) {
    throw new StudentsServiceError(
      "Choose a studied lesson or enter a topic to generate an interactive exam.",
      "missing_topic",
      400,
    );
  }

  const mastery = await listTopicMastery(uid);
  const adaptiveHints = topics.map((t) => {
    const m = mastery.find(
      (item) => item.topic.toLowerCase() === t.toLowerCase(),
    );
    if (!m) return `${t}: medium (first assessment)`;
    if (m.status === "needs_review") {
      return `${t}: EASY-TO-MEDIUM remedial focus (student previously scored ${m.accuracyPct}%)`;
    }
    if (m.status === "mastered") {
      return `${t}: HARD application/synthesis level (student mastered at ${m.accuracyPct}%)`;
    }
    return `${t}: medium progressive (${m.accuracyPct}%)`;
  });

  const visualResources = (lesson?.resources ?? []).filter((r) => Boolean(r.imageUrl));
  const allowedTypes =
    visualResources.length > 0
      ? requestedTypes
      : requestedTypes.filter((t) => t !== "image_based");
  const finalTypes =
    allowedTypes.length > 0 ? allowedTypes : ["multiple_choice", "true_false", "short_answer"];

  const entry = await resolveExamModelEntry(uid, input.modelSelection);
  const isAr =
    (input.locale ?? "en").toLowerCase().startsWith("ar") ||
    /[\u0600-\u06FF]/.test(topics.join(" "));

  const activeSkillsBlock = await getActiveSkillInstructionsForScope(
    uid,
    "students",
  ).catch(() => "");

  const sysPrompt = [
    `You are an Expert Assessment Designer inside YFactory Students.`,
    activeSkillsBlock,
    `Generate a rigorous, scientifically accurate interactive exam of EXACTLY ${count} questions.`,
    `Subject: ${subject}. Grade Level: ${gradeLevel}. Requested Difficulty: ${difficulty}.`,
    `Language: ${isAr ? "Clear Academic Arabic" : "Clear Academic English"}.`,
    `Allowed question types (mix across them): ${finalTypes.join(", ")}.`,
    `Adaptive Mastery Context:\n- ${adaptiveHints.join("\n- ")}`,
    lesson?.extractedText
      ? `Studied Lesson Excerpt:\n${lesson.extractedText.slice(0, 2600)}`
      : "",
    visualResources.length > 0
      ? `Available Verified Lesson Images (if you include an "image_based" question, set "imageIndex" to one of these 0-based indices):\n` +
        visualResources
          .slice(0, 4)
          .map((r, i) => `[${i}] ${r.title} (${r.topic}): ${r.relationNote}`)
          .join("\n")
      : "",
    `STRICT RULES FOR QUESTION TYPES:`,
    `- "multiple_choice": MUST include "options" array of 4 distinct choices, and "correctAnswer" must match one option verbatim.`,
    `- "true_false": MUST include "options": [${isAr ? '"صح", "خطأ"' : '"True", "False"'}], and "correctAnswer" matching one of them.`,
    `- "fill_blank": include "___" in prompt, concise expected word/phrase in "correctAnswer".`,
    `- "short_answer": concise conceptual question with clear expected key answer in "correctAnswer".`,
    `- "math_problem": concrete numerical/algebraic problem with clear final answer in "correctAnswer" and step-by-step solution in "explanation".`,
    `- "image_based": question asking the student to interpret the referenced lesson diagram (set "imageIndex").`,
    `Return ONLY ONE valid JSON object:`,
    `{`,
    `  "title": "Exam title",`,
    `  "questions": [`,
    `    {`,
    `      "type": "multiple_choice",`,
    `      "topic": "Specific topic from list",`,
    `      "difficulty": "easy" | "medium" | "hard",`,
    `      "prompt": "Question text",`,
    `      "options": ["A", "B", "C", "D"],`,
    `      "imageIndex": null,`,
    `      "hint": "Helpful non-spoiler hint for practice mode",`,
    `      "correctAnswer": "Exact correct answer",`,
    `      "explanation": "Clear explanation of why the answer is right and common pitfalls"`,
    `    }`,
    `  ]`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");

  const rawReply = await callExamAi(uid, entry, [
    { role: "system", content: sysPrompt },
    {
      role: "user",
      content: `Create the ${count}-question interactive assessment for: ${topics.join(", ")}.`,
    },
  ]);

  const parsed = extractJson(rawReply);
  const rawList = Array.isArray(parsed?.questions)
    ? (parsed!.questions as Array<Record<string, unknown>>)
    : [];

  if (rawList.length === 0) {
    throw new StudentsServiceError(
      "The AI model did not return structured exam questions. Please retry or switch models.",
      "exam_generation_parse_failed",
      502,
    );
  }

  const questions: ExamQuestionRecord[] = rawList.slice(0, 12).map((q, idx) => {
    let qType = normalizeQuestionType(q.type);
    const imgIdx =
      typeof q.imageIndex === "number" && Number.isInteger(q.imageIndex)
        ? q.imageIndex
        : -1;
    const matchedRes =
      imgIdx >= 0 && imgIdx < visualResources.length
        ? visualResources[imgIdx]
        : qType === "image_based"
          ? visualResources[0] ?? null
          : null;
    if (qType === "image_based" && !matchedRes) {
      qType = "short_answer";
    }
    const rawOpts = Array.isArray(q.options)
      ? q.options.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    const options =
      qType === "true_false" && rawOpts.length < 2
        ? isAr
          ? ["صح", "خطأ"]
          : ["True", "False"]
        : rawOpts.slice(0, 6);

    return {
      id: `q_${idx + 1}_${randomBytes(2).toString("hex")}`,
      index: idx + 1,
      type: qType,
      topic:
        typeof q.topic === "string" && q.topic.trim()
          ? q.topic.trim().slice(0, 120)
          : topics[idx % topics.length] ?? subject,
      difficulty:
        q.difficulty === "easy" || q.difficulty === "hard" ? q.difficulty : "medium",
      prompt: String(q.prompt ?? "").trim().slice(0, 1400),
      options,
      imageUrl: matchedRes?.imageUrl ?? null,
      imageCaption: matchedRes?.title ?? null,
      hint: String(q.hint ?? "").trim().slice(0, 400),
      correctAnswer: String(q.correctAnswer ?? "").trim().slice(0, 600),
      explanation: String(q.explanation ?? "").trim().slice(0, 1200),
      userAnswer: null,
      isCorrect: null,
      score: null,
      feedback: null,
      answeredAt: null,
    };
  });

  const now = Date.now();
  const examId = `exam_${now}_${randomBytes(4).toString("hex")}`;
  const title =
    typeof parsed?.title === "string" && parsed.title.trim()
      ? parsed.title.trim().slice(0, 160)
      : `${subject}: ${topics[0]}`;

  const record: StudentExamRecord = {
    id: examId,
    lessonId: lesson?.id ?? null,
    title,
    subject,
    gradeLevel,
    mode,
    difficulty,
    topics,
    status: "in_progress",
    questions,
    totalQuestions: questions.length,
    answeredCount: 0,
    correctCount: 0,
    scorePct: null,
    weakTopics: [],
    strongTopics: [],
    summaryNote: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  await userExamsCollection(uid)
    .doc(examId)
    .set({ ...record, createdAtTs: Timestamp.fromMillis(now) });
  return record;
}

function normalizeAnswerCompare(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[.,!?؟:;()"'`]/g, "")
    .replace(/\s+/g, " ");
}

async function gradeSingleQuestion(
  uid: string,
  q: ExamQuestionRecord,
  userAnswer: string,
  locale: string,
  modelSelection?: { provider?: string; keyId?: string; modelName?: string },
): Promise<{ isCorrect: boolean; score: number; feedback: string }> {
  const cleanUser = userAnswer.trim();
  const cleanExpected = q.correctAnswer.trim();

  // Exact deterministic grading for MCQ and True/False
  if (q.type === "multiple_choice" || q.type === "true_false") {
    const match =
      normalizeAnswerCompare(cleanUser) === normalizeAnswerCompare(cleanExpected);
    return {
      isCorrect: match,
      score: match ? 100 : 0,
      feedback: q.explanation,
    };
  }

  // Fast exact match check for Fill-in-the-Blank / Short Answer / Math
  if (
    cleanUser &&
    normalizeAnswerCompare(cleanUser) === normalizeAnswerCompare(cleanExpected)
  ) {
    return {
      isCorrect: true,
      score: 100,
      feedback: q.explanation,
    };
  }

  // Semantic grading via user's configured AI model for open-ended & math answers
  try {
    const entry = await resolveExamModelEntry(uid, modelSelection);
    const isAr =
      locale.toLowerCase().startsWith("ar") ||
      /[\u0600-\u06FF]/.test(q.prompt + cleanUser);
    const prompt = [
      `Grade the student's answer fairly and accurately.`,
      `Question (${q.type}): ${q.prompt}`,
      `Reference Correct Answer: ${q.correctAnswer}`,
      `Reference Explanation: ${q.explanation}`,
      `Student's Answer: ${cleanUser || "(empty)"}`,
      `Evaluate conceptual/mathematical equivalence (ignore minor typos or phrasing differences).`,
      `Write feedback in ${isAr ? "Arabic" : "English"} explaining why the student's answer is right or wrong.`,
      `Return ONLY valid JSON: {"isCorrect": true/false, "score": 0..100, "feedback": "concise explanation"}`,
    ].join("\n");

    const raw = await callExamAi(uid, entry, [{ role: "user", content: prompt }]);
    const parsed = extractJson(raw);
    if (parsed && typeof parsed.isCorrect === "boolean") {
      const score =
        typeof parsed.score === "number" && Number.isFinite(parsed.score)
          ? Math.max(0, Math.min(100, Math.round(parsed.score)))
          : parsed.isCorrect
            ? 100
            : 0;
      return {
        isCorrect: parsed.isCorrect || score >= 75,
        score,
        feedback:
          typeof parsed.feedback === "string" && parsed.feedback.trim()
            ? parsed.feedback.trim().slice(0, 900)
            : q.explanation,
      };
    }
  } catch {
    // Fallback deterministic comparison if AI grader is temporarily unreachable
  }

  const looseMatch =
    cleanUser.length >= 2 &&
    (normalizeAnswerCompare(cleanExpected).includes(normalizeAnswerCompare(cleanUser)) ||
      normalizeAnswerCompare(cleanUser).includes(normalizeAnswerCompare(cleanExpected)));
  return {
    isCorrect: looseMatch,
    score: looseMatch ? 100 : 0,
    feedback: q.explanation,
  };
}

export async function submitExamAnswer(
  uid: string,
  examId: string,
  input: {
    questionId: string;
    answer: string;
    locale?: string;
    modelSelection?: { provider?: string; keyId?: string; modelName?: string };
  },
): Promise<{
  exam: StudentExamRecord;
  gradedQuestion: ExamQuestionRecord;
}> {
  const ref = userExamsCollection(uid).doc(examId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new StudentsServiceError("Exam not found.", "not_found", 404);
  }
  const exam = examFromDoc(examId, snap.data() ?? {});
  if (exam.status === "completed") {
    throw new StudentsServiceError("This exam is already completed.", "exam_completed", 400);
  }

  const idx = exam.questions.findIndex((q) => q.id === input.questionId);
  if (idx < 0) {
    throw new StudentsServiceError("Question not found in exam.", "question_not_found", 404);
  }

  const cleanAnswer = input.answer.trim().slice(0, 2000);
  if (!cleanAnswer) {
    throw new StudentsServiceError("Enter or select an answer first.", "empty_answer", 400);
  }

  const target = exam.questions[idx]!;
  const now = Date.now();
  let updatedQuestion: ExamQuestionRecord;

  if (exam.mode === "practice") {
    const graded = await gradeSingleQuestion(
      uid,
      target,
      cleanAnswer,
      input.locale ?? "en",
      input.modelSelection,
    );
    updatedQuestion = {
      ...target,
      userAnswer: cleanAnswer,
      isCorrect: graded.isCorrect,
      score: graded.score,
      feedback: graded.feedback,
      answeredAt: now,
    };
  } else {
    // Real Exam Mode: save attempt WITHOUT grading or revealing solution yet
    updatedQuestion = {
      ...target,
      userAnswer: cleanAnswer,
      answeredAt: now,
    };
  }

  const nextQuestions = exam.questions.map((q, i) =>
    i === idx ? updatedQuestion : q,
  );
  const nextExam: StudentExamRecord = {
    ...exam,
    questions: nextQuestions,
    answeredCount: nextQuestions.filter((q) => q.userAnswer !== null).length,
    correctCount: nextQuestions.filter((q) => q.isCorrect === true).length,
    updatedAt: now,
  };

  await ref.set(nextExam, { merge: true });
  return { exam: nextExam, gradedQuestion: updatedQuestion };
}

export async function finalizeInteractiveExam(
  uid: string,
  examId: string,
  input: {
    locale?: string;
    modelSelection?: { provider?: string; keyId?: string; modelName?: string };
  } = {},
): Promise<StudentExamRecord> {
  const ref = userExamsCollection(uid).doc(examId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new StudentsServiceError("Exam not found.", "not_found", 404);
  }
  const exam = examFromDoc(examId, snap.data() ?? {});
  if (exam.status === "completed") {
    return exam;
  }

  const gradedQuestions: ExamQuestionRecord[] = [];
  for (const q of exam.questions) {
    if (q.isCorrect !== null && q.score !== null) {
      gradedQuestions.push(q);
      continue;
    }
    if (!q.userAnswer) {
      gradedQuestions.push({
        ...q,
        isCorrect: false,
        score: 0,
        feedback: q.explanation,
      });
      continue;
    }
    const graded = await gradeSingleQuestion(
      uid,
      q,
      q.userAnswer,
      input.locale ?? "en",
      input.modelSelection,
    );
    gradedQuestions.push({
      ...q,
      isCorrect: graded.isCorrect,
      score: graded.score,
      feedback: graded.feedback,
    });
  }

  const totalScore = gradedQuestions.reduce((acc, q) => acc + (q.score ?? 0), 0);
  const scorePct = Math.round(totalScore / Math.max(1, gradedQuestions.length));
  const correctCount = gradedQuestions.filter((q) => q.isCorrect === true).length;

  const topicStats = new Map<string, { total: number; correct: number }>();
  for (const q of gradedQuestions) {
    const t = q.topic.trim() || "General";
    const cur = topicStats.get(t) ?? { total: 0, correct: 0 };
    cur.total += 1;
    if (q.isCorrect) cur.correct += 1;
    topicStats.set(t, cur);
  }

  const weakTopics: string[] = [];
  const strongTopics: string[] = [];
  for (const [topic, st] of topicStats.entries()) {
    const pct = (st.correct / Math.max(1, st.total)) * 100;
    if (pct < 65) weakTopics.push(topic);
    else if (pct >= 80) strongTopics.push(topic);
  }

  const isAr = (input.locale ?? "en").toLowerCase().startsWith("ar");
  const summaryNote =
    weakTopics.length > 0
      ? isAr
        ? `حصلت على ${scorePct}% (${correctCount}/${gradedQuestions.length}). سُجّلت المواضيع التالية للمراجعة التكيّفية: ${weakTopics.join("، ")}.`
        : `You scored ${scorePct}% (${correctCount}/${gradedQuestions.length}). Flagged for adaptive review: ${weakTopics.join(", ")}.`
      : isAr
        ? `أداء ممتاز (${scorePct}% — ${correctCount}/${gradedQuestions.length})! تم ترقية مستوى إتقانك لتحديات أصعب.`
        : `Excellent mastery (${scorePct}% — ${correctCount}/${gradedQuestions.length})! Your adaptive difficulty tier has advanced.`;

  const now = Date.now();
  const completedExam: StudentExamRecord = {
    ...exam,
    status: "completed",
    questions: gradedQuestions,
    answeredCount: gradedQuestions.filter((q) => q.userAnswer !== null).length,
    correctCount,
    scorePct,
    weakTopics,
    strongTopics,
    summaryNote,
    updatedAt: now,
    completedAt: now,
  };

  await ref.set(completedExam, { merge: true });
  await recordMasteryUpdates(uid, exam.subject, gradedQuestions);
  return completedExam;
}

export async function listStudentExams(
  uid: string,
  limit = 25,
): Promise<StudentExamRecord[]> {
  const snap = await userExamsCollection(uid)
    .orderBy("updatedAt", "desc")
    .limit(Math.max(1, Math.min(limit, 50)))
    .get();
  return snap.docs.map((doc) => examFromDoc(doc.id, doc.data()));
}

export async function getStudentExam(
  uid: string,
  examId: string,
): Promise<StudentExamRecord | null> {
  const snap = await userExamsCollection(uid).doc(examId).get();
  if (!snap.exists) return null;
  return examFromDoc(snap.id, snap.data() ?? {});
}

export async function deleteStudentExam(
  uid: string,
  examId: string,
): Promise<boolean> {
  const ref = userExamsCollection(uid).doc(examId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

export async function getStudentProgressSummary(
  uid: string,
  locale = "en",
): Promise<StudentProgressSummary> {
  const [lessons, exams, mastery] = await Promise.all([
    listStudentLessons(uid, 50),
    listStudentExams(uid, 40),
    listTopicMastery(uid),
  ]);

  const completed = exams.filter((e) => e.status === "completed");
  const averageScorePct =
    completed.length > 0
      ? Math.round(
          completed.reduce((sum, e) => sum + (e.scorePct ?? 0), 0) /
            completed.length,
        )
      : null;

  const masteredTopics = mastery.filter((m) => m.status === "mastered");
  const reviewTopics = mastery.filter((m) => m.status === "needs_review");
  const learningTopics = mastery.filter((m) => m.status === "learning");

  const levelTrend = [...completed]
    .reverse()
    .slice(-12)
    .map((e) => ({
      examId: e.id,
      title: e.title,
      scorePct: e.scorePct ?? 0,
      date: e.completedAt ?? e.updatedAt,
    }));

  const isAr = locale.toLowerCase().startsWith("ar");
  const nextRecommendations: StudentProgressSummary["nextRecommendations"] = [];

  for (const weak of reviewTopics.slice(0, 3)) {
    nextRecommendations.push({
      kind: "reexplain_weak",
      topic: weak.topic,
      subject: weak.subject,
      reason: isAr
        ? `نسبة الإتقان ${weak.accuracyPct}% — اطلب من المدرس الذكي إعادة الشرح بأمثلة جديدة.`
        : `Accuracy is ${weak.accuracyPct}% — re-explain with fresh examples in AI Teacher.`,
    });
    nextRecommendations.push({
      kind: "retest_weak",
      topic: weak.topic,
      subject: weak.subject,
      reason: isAr
        ? `أعد الاختبار على «${weak.topic}» بأسئلة تدريبية إضافية لتثبيت الفهم.`
        : `Retake a focused practice quiz on "${weak.topic}" to strengthen retention.`,
    });
  }

  for (const strong of masteredTopics.slice(0, 2)) {
    nextRecommendations.push({
      kind: "advance_mastered",
      topic: strong.topic,
      subject: strong.subject,
      reason: isAr
        ? `أتقنت «${strong.topic}» (${strong.accuracyPct}%) — انتقل لمستوى تطبيقات أصعب.`
        : `Mastered "${strong.topic}" (${strong.accuracyPct}%) — challenge yourself at a harder level.`,
    });
  }

  if (nextRecommendations.length === 0 && lessons.length > 0) {
    const latest = lessons[0]!;
    nextRecommendations.push({
      kind: "start_first_exam",
      topic: latest.topics[0] ?? latest.title,
      subject: latest.subject,
      reason: isAr
        ? `اختبر فهمك لدرس «${latest.title}» عبر امتحان تفاعلي.`
        : `Test your mastery of "${latest.title}" with an interactive exam.`,
    });
  }

  return {
    lessonsStudiedCount: lessons.length,
    examsCompletedCount: completed.length,
    averageScorePct,
    masteredTopics,
    reviewTopics,
    learningTopics,
    examHistory: exams.map((e) => ({
      id: e.id,
      title: e.title,
      subject: e.subject,
      mode: e.mode,
      scorePct: e.scorePct,
      correctCount: e.correctCount,
      totalQuestions: e.totalQuestions,
      status: e.status,
      completedAt: e.completedAt,
      createdAt: e.createdAt,
    })),
    levelTrend,
    nextRecommendations: nextRecommendations.slice(0, 6),
  };
}