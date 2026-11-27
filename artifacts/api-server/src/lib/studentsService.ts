import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  clearChatVaultKeyFailure,
  getChatVaultEntry,
  listChatVaultKeys,
  recordChatVaultKeyFailure,
  type ChatVaultEntry,
} from "./apiKeyVault";
import {
  CHAT_ADAPTERS,
  type ChatImageAttachment,
  type ChatMessage,
} from "./chatAdapters";
import { ChatServiceError, completeWithRotation } from "./chatService";
import { getFirebaseAdmin } from "./firebaseAdmin";
import { getActiveSkillInstructionsForScope } from "./skillsService";

export type StudentDocumentType = "exam" | "lesson" | "book_page" | "notes";
export type StudentGradeLevel =
  | "elementary"
  | "middle"
  | "high_school"
  | "university";
export type StudentTeachingStyle =
  | "visual_step_by_step"
  | "simple_friendly"
  | "exam_focused"
  | "deep_academic";

export type StudentExtractedQuestion = {
  number: number;
  text: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
};

export type StudentVisualResource = {
  id: string;
  topic: string;
  sourceName: string;
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  licenseNote: string;
  relationNote: string;
  summary: string;
  isAiGenerated: boolean;
  scientificCheckNote?: string;
};

export type StudentVisualBreakdown = {
  topic: string;
  subject: string;
  visualType:
    | "anatomy"
    | "timeline"
    | "geography"
    | "math_steps"
    | "physics_diagram"
    | "concept_map";
  summary: string;
  steps: Array<{ label: string; detail: string }>;
  glossary: Array<{ term: string; definition: string }>;
};

export type StudentTutorMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  topic?: string;
  style?: StudentTeachingStyle;
  createdAt: number;
};

export type StudentLessonRecord = {
  id: string;
  title: string;
  documentType: StudentDocumentType;
  subject: string;
  gradeLevel: StudentGradeLevel;
  teachingStyle: StudentTeachingStyle;
  extractedText: string;
  questions: StudentExtractedQuestion[];
  lessons: string[];
  topics: string[];
  keyConcepts: string[];
  resources: StudentVisualResource[];
  breakdowns: StudentVisualBreakdown[];
  tutorMessages: StudentTutorMessage[];
  createdAt: number;
  updatedAt: number;
};

export class StudentsServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function userLessonsCollection(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("studentLessons");
}

function normalizeGradeLevel(raw: unknown): StudentGradeLevel {
  if (
    raw === "elementary" ||
    raw === "middle" ||
    raw === "high_school" ||
    raw === "university"
  ) {
    return raw;
  }
  return "high_school";
}

function normalizeTeachingStyle(raw: unknown): StudentTeachingStyle {
  if (
    raw === "visual_step_by_step" ||
    raw === "simple_friendly" ||
    raw === "exam_focused" ||
    raw === "deep_academic"
  ) {
    return raw;
  }
  return "visual_step_by_step";
}

function normalizeDocType(raw: unknown): StudentDocumentType {
  if (
    raw === "exam" ||
    raw === "lesson" ||
    raw === "book_page" ||
    raw === "notes"
  ) {
    return raw;
  }
  return "exam";
}

function sanitizeStringArray(raw: unknown, maxItems = 25, maxLen = 140): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, maxLen))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

function sanitizeQuestions(raw: unknown): StudentExtractedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: StudentExtractedQuestion[] = [];
  for (let i = 0; i < Math.min(raw.length, 40); i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim().slice(0, 1200) : "";
    if (!text) continue;
    const num =
      typeof obj.number === "number" && Number.isFinite(obj.number)
        ? Math.max(1, Math.round(obj.number))
        : i + 1;
    const diff =
      obj.difficulty === "easy" || obj.difficulty === "hard"
        ? obj.difficulty
        : "medium";
    out.push({
      number: num,
      text,
      topic:
        typeof obj.topic === "string" && obj.topic.trim()
          ? obj.topic.trim().slice(0, 120)
          : "General",
      difficulty: diff,
    });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

function sanitizeResources(raw: unknown): StudentVisualResource[] {
  if (!Array.isArray(raw)) return [];
  const out: StudentVisualResource[] = [];
  for (const item of raw.slice(0, 30)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 180) : "";
    if (!title) continue;
    const sourceUrl =
      typeof obj.sourceUrl === "string" && /^https:\/\/.+/i.test(obj.sourceUrl.trim())
        ? obj.sourceUrl.trim().slice(0, 600)
        : "";
    const imageUrl =
      typeof obj.imageUrl === "string" &&
      (/^https:\/\/.+/i.test(obj.imageUrl.trim()) ||
        /^data:image\/.+;base64,/i.test(obj.imageUrl.trim()))
        ? obj.imageUrl.trim()
        : null;
    out.push({
      id:
        typeof obj.id === "string" && obj.id.trim()
          ? obj.id.trim().slice(0, 80)
          : `res_${randomBytes(4).toString("hex")}`,
      topic:
        typeof obj.topic === "string" ? obj.topic.trim().slice(0, 120) : title,
      sourceName:
        typeof obj.sourceName === "string"
          ? obj.sourceName.trim().slice(0, 80)
          : "Educational Source",
      title,
      sourceUrl,
      imageUrl,
      licenseNote:
        typeof obj.licenseNote === "string"
          ? obj.licenseNote.trim().slice(0, 200)
          : "",
      relationNote:
        typeof obj.relationNote === "string"
          ? obj.relationNote.trim().slice(0, 280)
          : "",
      summary:
        typeof obj.summary === "string" ? obj.summary.trim().slice(0, 600) : "",
      isAiGenerated: obj.isAiGenerated === true,
      ...(typeof obj.scientificCheckNote === "string" && obj.scientificCheckNote.trim()
        ? { scientificCheckNote: obj.scientificCheckNote.trim().slice(0, 260) }
        : {}),
    });
  }
  return out;
}

function sanitizeBreakdowns(raw: unknown): StudentVisualBreakdown[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set([
    "anatomy",
    "timeline",
    "geography",
    "math_steps",
    "physics_diagram",
    "concept_map",
  ]);
  const out: StudentVisualBreakdown[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const topic = typeof obj.topic === "string" ? obj.topic.trim().slice(0, 140) : "";
    if (!topic) continue;
    const steps = Array.isArray(obj.steps)
      ? obj.steps
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
          .map((s) => ({
            label: String(s.label ?? "").trim().slice(0, 100),
            detail: String(s.detail ?? "").trim().slice(0, 320),
          }))
          .filter((s) => s.label && s.detail)
          .slice(0, 10)
      : [];
    const glossary = Array.isArray(obj.glossary)
      ? obj.glossary
          .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === "object")
          .map((g) => ({
            term: String(g.term ?? "").trim().slice(0, 100),
            definition: String(g.definition ?? "").trim().slice(0, 260),
          }))
          .filter((g) => g.term && g.definition)
          .slice(0, 10)
      : [];
    out.push({
      topic,
      subject:
        typeof obj.subject === "string" ? obj.subject.trim().slice(0, 80) : "General",
      visualType: validTypes.has(String(obj.visualType))
        ? (obj.visualType as StudentVisualBreakdown["visualType"])
        : "concept_map",
      summary:
        typeof obj.summary === "string" ? obj.summary.trim().slice(0, 500) : "",
      steps,
      glossary,
    });
  }
  return out;
}

function sanitizeTutorMessages(raw: unknown): StudentTutorMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .slice(-50)
    .map((m, idx) => ({
      id:
        typeof m.id === "string" && m.id.trim()
          ? m.id.trim().slice(0, 80)
          : `tmsg_${idx}_${Date.now()}`,
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content ?? "").slice(0, 12_000),
      ...(typeof m.topic === "string" && m.topic.trim()
        ? { topic: m.topic.trim().slice(0, 120) }
        : {}),
      ...(typeof m.style === "string"
        ? { style: normalizeTeachingStyle(m.style) }
        : {}),
      createdAt: typeof m.createdAt === "number" ? m.createdAt : Date.now(),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function lessonFromDoc(id: string, d: Record<string, unknown>): StudentLessonRecord {
  return {
    id,
    title: String(d.title ?? "Study Session").slice(0, 160),
    documentType: normalizeDocType(d.documentType),
    subject: String(d.subject ?? "General").slice(0, 80),
    gradeLevel: normalizeGradeLevel(d.gradeLevel),
    teachingStyle: normalizeTeachingStyle(d.teachingStyle),
    extractedText: String(d.extractedText ?? "").slice(0, 24_000),
    questions: sanitizeQuestions(d.questions),
    lessons: sanitizeStringArray(d.lessons, 15, 140),
    topics: sanitizeStringArray(d.topics, 20, 120),
    keyConcepts: sanitizeStringArray(d.keyConcepts, 25, 120),
    resources: sanitizeResources(d.resources),
    breakdowns: sanitizeBreakdowns(d.breakdowns),
    tutorMessages: sanitizeTutorMessages(d.tutorMessages),
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

async function resolveStudentModelEntry(
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
        `API key for "${preferred.modelName}" failed authentication. Check it in Provider Center or select another model.`,
        "auth_failed",
        401,
      );
    }
    if (entry.cooldownUntil && entry.cooldownUntil > Date.now()) {
      const waitSec = Math.ceil((entry.cooldownUntil - Date.now()) / 1000);
      throw new StudentsServiceError(
        `"${preferred.modelName}" is temporarily rate-limited (${waitSec}s cooldown). Wait briefly or pick another model.`,
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
  // Prefer vision-capable models first (Gemini, GPT-4o/6, Claude)
  ready.sort((a, b) => {
    const score = (m: string, p: string) =>
      p === "gemini" || /gemini|gpt-4o|gpt-6|claude/i.test(m) ? 0 : 1;
    return score(a.modelName, a.provider) - score(b.modelName, b.provider);
  });

  for (const cand of ready) {
    const entry = await getChatVaultEntry(uid, cand.provider, cand.id, cand.modelName);
    if (entry && entry.enabled && !entry.failed) return entry;
  }

  throw new StudentsServiceError(
    "Add and enable an AI model in Provider Center (e.g. Gemini, OpenAI, Anthropic, Groq, or OpenRouter) to use Students AI.",
    "missing_key",
    404,
  );
}

async function callStudentAi(
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
    const hint =
      code === "auth_failed"
        ? "API key rejected by provider."
        : code === "rate_limited"
          ? "Provider rate limit reached (HTTP 429)."
          : code === "model_not_found"
            ? `Model "${entry.modelName}" was rejected or does not support this input (e.g. image vision).`
            : "Provider timed out or returned an empty reply.";
    throw new StudentsServiceError(
      `${entry.modelName}: ${hint}`,
      code,
      status,
    );
  }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
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

export async function analyzeExamOrLessonPhoto(
  uid: string,
  input: {
    image?: ChatImageAttachment;
    pastedText?: string;
    gradeLevel?: StudentGradeLevel;
    locale?: string;
    modelSelection?: { provider?: string; keyId?: string; modelName?: string };
  },
): Promise<StudentLessonRecord> {
  if (!input.image && !input.pastedText?.trim()) {
    throw new StudentsServiceError(
      "Upload an exam/lesson photo or paste study text to analyze.",
      "missing_input",
      400,
    );
  }

  const entry = await resolveStudentModelEntry(uid, input.modelSelection);
  const gradeLevel = normalizeGradeLevel(input.gradeLevel);
  const isAr = (input.locale ?? "en").toLowerCase().startsWith("ar");

  const sysPrompt = [
    `You are an accurate Academic OCR & Curriculum Analyzer inside YFactory Students.`,
    `Examine the uploaded image (which may be an exam paper, worksheet, lesson summary, textbook page, or student notes) or pasted text.`,
    `Do NOT assume every image is an exam — detect accurately whether documentType is "exam", "lesson", "book_page", or "notes".`,
    `Preserve exact question order and transcribe text faithfully in the original language of the document.`,
    `Return ONLY ONE valid JSON object with this exact schema (no extra commentary):`,
    `{`,
    `  "documentType": "exam" | "lesson" | "book_page" | "notes",`,
    `  "title": "concise descriptive title in document language",`,
    `  "subject": "detected school subject (e.g. Biology, Physics, Mathematics, History, Geography, Chemistry, Languages)",`,
    `  "extractedText": "full faithful transcription of the page/questions",`,
    `  "questions": [`,
    `    { "number": 1, "text": "exact question text in order", "topic": "related topic", "difficulty": "easy" | "medium" | "hard" }`,
    `  ],`,
    `  "lessons": ["Lesson 1 name", "Lesson 2 name"],`,
    `  "topics": ["Specific searchable topic 1", "Specific searchable topic 2"],`,
    `  "keyConcepts": ["Concept or formula 1", "Concept 2"]`,
    `}`,
    `Respond in ${isAr ? "Arabic (or matching the document language)" : "the document's language"}.`,
  ].join("\n");

  const userMsg: ChatMessage = {
    role: "user",
    content: input.pastedText?.trim()
      ? `Analyze this study document (grade level: ${gradeLevel}):\n\n${input.pastedText.trim().slice(0, 12_000)}`
      : `Carefully transcribe and analyze this uploaded exam/lesson/book page photo (grade level: ${gradeLevel}). Return only the JSON object.`,
    ...(input.image ? { images: [input.image] } : {}),
  };

  const rawReply = await callStudentAi(uid, entry, [
    { role: "system", content: sysPrompt },
    userMsg,
  ]);
  const parsed = extractJsonObject(rawReply);

  const now = Date.now();
  const id = `lesson_${now}_${randomBytes(4).toString("hex")}`;
  const fallbackText = input.pastedText?.trim() || rawReply.trim().slice(0, 12_000);
  const extractedText =
    typeof parsed?.extractedText === "string" && parsed.extractedText.trim()
      ? parsed.extractedText.trim().slice(0, 24_000)
      : fallbackText;

  const subject =
    typeof parsed?.subject === "string" && parsed.subject.trim()
      ? parsed.subject.trim().slice(0, 80)
      : "General";
  const title =
    typeof parsed?.title === "string" && parsed.title.trim()
      ? parsed.title.trim().slice(0, 160)
      : `${subject} Study Session`;

  const questions = sanitizeQuestions(parsed?.questions);
  const lessons = sanitizeStringArray(parsed?.lessons, 15, 140);
  let topics = sanitizeStringArray(parsed?.topics, 20, 120);
  if (topics.length === 0) {
    topics = lessons.length > 0 ? lessons.slice(0, 6) : [title];
  }
  const keyConcepts = sanitizeStringArray(parsed?.keyConcepts, 25, 120);

  const record: StudentLessonRecord = {
    id,
    title,
    documentType: normalizeDocType(parsed?.documentType),
    subject,
    gradeLevel,
    teachingStyle: "visual_step_by_step",
    extractedText,
    questions,
    lessons,
    topics,
    keyConcepts,
    resources: [],
    breakdowns: [],
    tutorMessages: [],
    createdAt: now,
    updatedAt: now,
  };

  await userLessonsCollection(uid)
    .doc(id)
    .set({ ...record, createdAtTs: Timestamp.fromMillis(now) });
  return record;
}

async function fetchJsonSafe(url: string, timeoutMs = 8_000): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "YFactoryAI-Students/1.0 (Educational Research Client)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWikipediaForTopic(
  topic: string,
  subject: string,
  langCode: "ar" | "en",
): Promise<StudentVisualResource[]> {
  const query = `${topic}`.trim();
  const searchUrl = `https://${langCode}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&format=json&origin=*`;
  const searchData = await fetchJsonSafe(searchUrl);
  const queryObj = searchData?.query as { search?: Array<{ title?: string }> } | undefined;
  const titles = (queryObj?.search ?? [])
    .map((s) => s.title?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 2);

  const results: StudentVisualResource[] = [];
  for (const title of titles) {
    const sumUrl = `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const sum = await fetchJsonSafe(sumUrl);
    if (!sum || sum.type === "disambiguation") continue;
    const contentUrls = sum.content_urls as { desktop?: { page?: string } } | undefined;
    const pageUrl =
      typeof contentUrls?.desktop?.page === "string"
        ? contentUrls.desktop.page
        : `https://${langCode}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const thumb = sum.thumbnail as { source?: string } | undefined;
    const orig = sum.originalimage as { source?: string } | undefined;
    const imgUrl =
      typeof thumb?.source === "string"
        ? thumb.source
        : typeof orig?.source === "string"
          ? orig.source
          : null;
    const extract = typeof sum.extract === "string" ? sum.extract.trim() : "";

    results.push({
      id: `wiki_${langCode}_${randomBytes(3).toString("hex")}`,
      topic,
      sourceName: langCode === "ar" ? "Wikipedia (العربية)" : "Wikipedia (English)",
      title: typeof sum.title === "string" ? sum.title : title,
      sourceUrl: pageUrl,
      imageUrl: imgUrl,
      licenseNote: "CC BY-SA 4.0 (Wikipedia / Wikimedia)",
      relationNote:
        langCode === "ar"
          ? `مرجع تعليمي موثّق مرتبط بموضوع «${topic}» في مادة ${subject}.`
          : `Verified educational encyclopedia reference for "${topic}" (${subject}).`,
      summary: extract.slice(0, 420),
      isAiGenerated: false,
    });
  }
  return results;
}

async function searchWikimediaDiagrams(
  topic: string,
  subject: string,
): Promise<StudentVisualResource[]> {
  const hint =
    /history|تاريخ/i.test(subject)
      ? "map"
      : /geography|جغرافيا/i.test(subject)
        ? "map"
        : "diagram";
  const q = `${topic} ${hint}`.trim();
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=760&format=json&origin=*`;
  const data = await fetchJsonSafe(url);
  const pages = (data?.query as { pages?: Record<string, Record<string, unknown>> } | undefined)
    ?.pages;
  if (!pages) return [];

  const out: StudentVisualResource[] = [];
  for (const page of Object.values(pages)) {
    const infoArr = Array.isArray(page.imageinfo)
      ? (page.imageinfo as Array<Record<string, unknown>>)
      : [];
    const info = infoArr[0];
    if (!info) continue;
    const thumbUrl =
      typeof info.thumburl === "string"
        ? info.thumburl
        : typeof info.url === "string"
          ? info.url
          : null;
    if (!thumbUrl || !/\.(?:png|jpe?g|webp|svg)/i.test(thumbUrl)) continue;
    const descUrl =
      typeof info.descriptionurl === "string" ? info.descriptionurl : thumbUrl;
    const meta = (info.extmetadata as Record<string, { value?: string }> | undefined) ?? {};
    const license =
      meta.LicenseShortName?.value?.replace(/<[^>]+>/g, "").trim() ||
      "Wikimedia Commons Free Media License";
    const rawDesc =
      meta.ImageDescription?.value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
      "";
    const cleanTitle = String(page.title ?? "Diagram")
      .replace(/^File:/i, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/_/g, " ");

    out.push({
      id: `commons_${randomBytes(3).toString("hex")}`,
      topic,
      sourceName: "Wikimedia Commons",
      title: cleanTitle.slice(0, 140),
      sourceUrl: descUrl,
      imageUrl: thumbUrl,
      licenseNote: license.slice(0, 120),
      relationNote: `Visual diagram / map from Wikimedia Commons illustrating "${topic}" (${subject}).`,
      summary: rawDesc.slice(0, 320),
      isAiGenerated: false,
    });
    if (out.length >= 2) break;
  }
  return out;
}

function visualTypeForSubject(
  subject: string,
): StudentVisualBreakdown["visualType"] {
  const s = subject.toLowerCase();
  if (/bio|anatom|أحياء|احياء|علوم الحياة|الجهاز/.test(s)) return "anatomy";
  if (/hist|تاريخ/.test(s)) return "timeline";
  if (/geo|جغرافيا/.test(s)) return "geography";
  if (/math|رياضيات|هندسة|جبر/.test(s)) return "math_steps";
  if (/phys|فيزياء/.test(s)) return "physics_diagram";
  return "concept_map";
}

async function buildStructuredVisualBreakdown(
  uid: string,
  topic: string,
  subject: string,
  gradeLevel: StudentGradeLevel,
  locale: string,
  modelSelection?: { provider?: string; keyId?: string; modelName?: string },
): Promise<StudentVisualBreakdown | null> {
  let entry: ChatVaultEntry;
  try {
    entry = await resolveStudentModelEntry(uid, modelSelection);
  } catch {
    return null;
  }

  const vType = visualTypeForSubject(subject);
  const isAr = locale.toLowerCase().startsWith("ar");
  const prompt = [
    `Create a concise visual learning breakdown for "${topic}" in subject "${subject}" (level: ${gradeLevel}, visualType: "${vType}").`,
    `Tailor the steps to the subject: e.g., for Biology list organs/stages & functions; for History list chronological timeline & cause-effect; for Geography list landforms/regions/phenomena; for Math list visual geometry/worked solution steps; for Physics list variables/laws/experiment steps.`,
    `Write in ${isAr ? "clear educational Arabic" : "clear educational English"}.`,
    `Return ONLY ONE valid JSON object:`,
    `{"summary":"2-3 sentence visual overview","steps":[{"label":"Stage/Component/Step 1","detail":"clear explanation"}],"glossary":[{"term":"Key term","definition":"concise definition"}]}`,
  ].join("\n");

  try {
    const raw = await callStudentAi(uid, entry, [{ role: "user", content: prompt }]);
    const parsed = extractJsonObject(raw);
    if (!parsed) return null;
    const normalized = sanitizeBreakdowns([
      {
        topic,
        subject,
        visualType: vType,
        summary: parsed.summary,
        steps: parsed.steps,
        glossary: parsed.glossary,
      },
    ]);
    return normalized[0] ?? null;
  } catch {
    return null;
  }
}

export async function researchEducationalResources(
  uid: string,
  input: {
    lessonId?: string;
    topics: string[];
    subject: string;
    gradeLevel?: StudentGradeLevel;
    locale?: string;
    includeVisualBreakdown?: boolean;
    modelSelection?: { provider?: string; keyId?: string; modelName?: string };
  },
): Promise<{
  resources: StudentVisualResource[];
  breakdowns: StudentVisualBreakdown[];
  lesson: StudentLessonRecord | null;
}> {
  const cleanTopics = sanitizeStringArray(input.topics, 4, 120);
  if (cleanTopics.length === 0) {
    throw new StudentsServiceError(
      "Provide at least one topic to research.",
      "missing_topics",
      400,
    );
  }

  const subject = input.subject?.trim().slice(0, 80) || "General";
  const locale = input.locale ?? "en";
  const preferAr =
    locale.toLowerCase().startsWith("ar") ||
    /[\u0600-\u06FF]/.test(cleanTopics.join(" "));

  const collectedResources: StudentVisualResource[] = [];
  const seenUrls = new Set<string>();

  for (const topic of cleanTopics.slice(0, 3)) {
    const [wikiPrimary, wikiSecondary, commons] = await Promise.all([
      searchWikipediaForTopic(topic, subject, preferAr ? "ar" : "en"),
      preferAr
        ? searchWikipediaForTopic(topic, subject, "en")
        : Promise.resolve([] as StudentVisualResource[]),
      searchWikimediaDiagrams(topic, subject),
    ]);

    for (const r of [...wikiPrimary, ...commons, ...wikiSecondary]) {
      const key = r.sourceUrl || r.imageUrl || r.title;
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      collectedResources.push(r);
    }
  }

  const breakdowns: StudentVisualBreakdown[] = [];
  if (input.includeVisualBreakdown !== false) {
    const firstTopic = cleanTopics[0]!;
    const bd = await buildStructuredVisualBreakdown(
      uid,
      firstTopic,
      subject,
      normalizeGradeLevel(input.gradeLevel),
      locale,
      input.modelSelection,
    );
    if (bd) breakdowns.push(bd);
  }

  let updatedLesson: StudentLessonRecord | null = null;
  if (input.lessonId) {
    const ref = userLessonsCollection(uid).doc(input.lessonId);
    const snap = await ref.get();
    if (snap.exists) {
      const prev = lessonFromDoc(snap.id, snap.data() ?? {});
      const existingByUrl = new Set(
        prev.resources.map((r) => r.sourceUrl || r.imageUrl || r.id),
      );
      const mergedResources = [
        ...prev.resources,
        ...collectedResources.filter(
          (r) => !existingByUrl.has(r.sourceUrl || r.imageUrl || r.id),
        ),
      ].slice(0, 30);

      const mergedBreakdowns = [
        ...breakdowns,
        ...prev.breakdowns.filter(
          (old) => !breakdowns.some((b) => b.topic === old.topic),
        ),
      ].slice(0, 12);

      const now = Date.now();
      await ref.update({
        resources: mergedResources,
        breakdowns: mergedBreakdowns,
        updatedAt: now,
      });
      updatedLesson = {
        ...prev,
        resources: mergedResources,
        breakdowns: mergedBreakdowns,
        updatedAt: now,
      };
    }
  }

  return {
    resources: collectedResources,
    breakdowns,
    lesson: updatedLesson,
  };
}

export async function attachAiEducationalDiagram(
  uid: string,
  lessonId: string,
  input: {
    topic: string;
    imageUrl: string;
    providerName: string;
    relationNote: string;
  },
): Promise<StudentLessonRecord | null> {
  const ref = userLessonsCollection(uid).doc(lessonId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const prev = lessonFromDoc(snap.id, snap.data() ?? {});

  const newRes: StudentVisualResource = {
    id: `ai_diag_${Date.now()}_${randomBytes(3).toString("hex")}`,
    topic: input.topic.trim().slice(0, 120),
    sourceName: `AI-Generated (${input.providerName.trim().slice(0, 40) || "Image Provider"})`,
    title: `AI Educational Diagram: ${input.topic.trim().slice(0, 100)}`,
    sourceUrl: "",
    imageUrl: input.imageUrl.trim(),
    licenseNote: "Original AI-generated educational diagram via YFactory Image Provider",
    relationNote: input.relationNote.trim().slice(0, 260),
    summary:
      "AI-generated visual aid created because no exact verified diagram was available. Verify labels and scientific details against your curriculum.",
    isAiGenerated: true,
    scientificCheckNote:
      "Generated by AI — verify anatomical/scientific labels and formulas with your textbook or teacher.",
  };

  const nextResources = [newRes, ...prev.resources].slice(0, 30);
  const now = Date.now();
  await ref.update({ resources: nextResources, updatedAt: now });
  return { ...prev, resources: nextResources, updatedAt: now };
}

export async function sendStudentTutorMessage(
  uid: string,
  input: {
    lessonId?: string;
    message: string;
    subject?: string;
    gradeLevel?: StudentGradeLevel;
    teachingStyle?: StudentTeachingStyle;
    focusTopic?: string;
    reexplainDifferently?: boolean;
    locale?: string;
    modelSelection?: { provider?: string; keyId?: string; modelName?: string };
  },
): Promise<{
  lesson: StudentLessonRecord;
  reply: StudentTutorMessage;
}> {
  const cleanMsg = input.message.trim();
  if (!cleanMsg || cleanMsg.length > 8000) {
    throw new StudentsServiceError("Enter a question or topic for the AI Teacher.", "invalid_message", 400);
  }

  const entry = await resolveStudentModelEntry(uid, input.modelSelection);

  let lesson: StudentLessonRecord | null = null;
  if (input.lessonId) {
    const snap = await userLessonsCollection(uid).doc(input.lessonId).get();
    if (snap.exists) {
      lesson = lessonFromDoc(snap.id, snap.data() ?? {});
    }
  }

  const now = Date.now();
  const subject = input.subject?.trim() || lesson?.subject || "General";
  const gradeLevel = normalizeGradeLevel(input.gradeLevel ?? lesson?.gradeLevel);
  const teachingStyle = normalizeTeachingStyle(
    input.teachingStyle ?? lesson?.teachingStyle,
  );
  const isAr =
    (input.locale ?? "en").toLowerCase().startsWith("ar") ||
    /[\u0600-\u06FF]/.test(cleanMsg);

  const styleGuide: Record<StudentTeachingStyle, string> = {
    visual_step_by_step:
      "Break the lesson into bite-sized numbered visual steps, include an ASCII/text diagram or structured table, define key terms clearly, and give a concrete worked example.",
    simple_friendly:
      "Use simple everyday analogies, warm encouraging tone, short paragraphs, and clear examples suited to the student's grade level.",
    exam_focused:
      "Focus on common exam traps, exact scoring points, worked solutions tied directly to exam questions, and quick memory cues.",
    deep_academic:
      "Provide rigorous formal definitions, underlying principles/derivations, edge cases, and structured conceptual links.",
  };

  const contextLines: string[] = [
    `You are the dedicated YFactory Students AI Teacher in an independent tutoring workspace.`,
    `Student Grade Level: ${gradeLevel}. Subject: ${subject}. Teaching Style: ${teachingStyle}.`,
    `Instructions: ${styleGuide[teachingStyle]}`,
    `ALWAYS avoid long unbroken walls of text. Structure your teaching with clear headings, bullet points, bold key terms, concrete examples, and a quick check-understanding question at the end.`,
    `Respond in ${isAr ? "Arabic (matching the student's language)" : "the student's language"}.`,
  ];

  if (input.reexplainDifferently) {
    contextLines.push(
      `IMPORTANT: The student asked you to RE-EXPLAIN DIFFERENTLY. Use a completely fresh analogy, simpler breakdown, and a different example than before.`,
    );
  }
  if (input.focusTopic?.trim()) {
    contextLines.push(`Focused Topic: "${input.focusTopic.trim()}".`);
  }
  const activeSkillsBlock = await getActiveSkillInstructionsForScope(
    uid,
    "students",
  ).catch(() => "");
  if (activeSkillsBlock) {
    contextLines.push(activeSkillsBlock);
  }
  if (lesson) {
    contextLines.push(`Active Study Document: "${lesson.title}" (${lesson.documentType}).`);
    if (lesson.topics.length > 0) {
      contextLines.push(`Extracted Topics: ${lesson.topics.join(", ")}.`);
    }
    if (lesson.questions.length > 0) {
      contextLines.push(
        `Uploaded Exam/Lesson Questions (connect your explanation directly to these when relevant):\n` +
          lesson.questions
            .slice(0, 10)
            .map((q) => `Q${q.number}. ${q.text}`)
            .join("\n"),
      );
    } else if (lesson.extractedText.trim()) {
      contextLines.push(
        `Extracted Lesson Excerpt:\n${lesson.extractedText.slice(0, 2800)}`,
      );
    }
    if (lesson.resources.length > 0) {
      contextLines.push(
        `Verified Visual Resources available in this lesson (you may reference them by title): ` +
          lesson.resources
            .slice(0, 6)
            .map((r) => `${r.title} (${r.sourceName})`)
            .join("; "),
      );
    }
  }

  const priorHistory: ChatMessage[] = (lesson?.tutorMessages ?? [])
    .slice(-14)
    .map((m) => ({ role: m.role, content: m.content }));

  const replyText = await callStudentAi(uid, entry, [
    { role: "system", content: contextLines.join("\n") },
    ...priorHistory,
    { role: "user", content: cleanMsg },
  ]);

  const userEntry: StudentTutorMessage = {
    id: `tmsg_u_${now}_${randomBytes(3).toString("hex")}`,
    role: "user",
    content: cleanMsg,
    ...(input.focusTopic ? { topic: input.focusTopic } : {}),
    style: teachingStyle,
    createdAt: now,
  };
  const assistantEntry: StudentTutorMessage = {
    id: `tmsg_a_${Date.now()}_${randomBytes(3).toString("hex")}`,
    role: "assistant",
    content: replyText,
    ...(input.focusTopic ? { topic: input.focusTopic } : {}),
    style: teachingStyle,
    createdAt: Date.now(),
  };

  if (lesson) {
    const nextMsgs = [...lesson.tutorMessages, userEntry, assistantEntry].slice(-50);
    const updatedAt = Date.now();
    await userLessonsCollection(uid).doc(lesson.id).update({
      subject,
      gradeLevel,
      teachingStyle,
      tutorMessages: nextMsgs,
      updatedAt,
    });
    const updated: StudentLessonRecord = {
      ...lesson,
      subject,
      gradeLevel,
      teachingStyle,
      tutorMessages: nextMsgs,
      updatedAt,
    };
    return { lesson: updated, reply: assistantEntry };
  }

  // Create a dedicated standalone tutor lesson session automatically
  const newId = `lesson_${now}_${randomBytes(4).toString("hex")}`;
  const created: StudentLessonRecord = {
    id: newId,
    title:
      input.focusTopic?.trim().slice(0, 80) ||
      cleanMsg.replace(/\s+/g, " ").slice(0, 70),
    documentType: "notes",
    subject,
    gradeLevel,
    teachingStyle,
    extractedText: "",
    questions: [],
    lessons: input.focusTopic ? [input.focusTopic] : [],
    topics: input.focusTopic ? [input.focusTopic] : [],
    keyConcepts: [],
    resources: [],
    breakdowns: [],
    tutorMessages: [userEntry, assistantEntry],
    createdAt: now,
    updatedAt: Date.now(),
  };
  await userLessonsCollection(uid)
    .doc(newId)
    .set({ ...created, createdAtTs: Timestamp.fromMillis(now) });
  return { lesson: created, reply: assistantEntry };
}

export async function listStudentLessons(
  uid: string,
  limit = 30,
): Promise<StudentLessonRecord[]> {
  const snap = await userLessonsCollection(uid)
    .orderBy("updatedAt", "desc")
    .limit(Math.max(1, Math.min(limit, 50)))
    .get();
  return snap.docs.map((doc) => lessonFromDoc(doc.id, doc.data()));
}

export async function getStudentLesson(
  uid: string,
  lessonId: string,
): Promise<StudentLessonRecord | null> {
  const snap = await userLessonsCollection(uid).doc(lessonId).get();
  if (!snap.exists) return null;
  return lessonFromDoc(snap.id, snap.data() ?? {});
}

export async function updateStudentLesson(
  uid: string,
  lessonId: string,
  patch: Record<string, unknown>,
): Promise<StudentLessonRecord | null> {
  const ref = userLessonsCollection(uid).doc(lessonId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const prev = lessonFromDoc(lessonId, snap.data() ?? {});

  const next: StudentLessonRecord = {
    ...prev,
    ...(typeof patch.title === "string" && patch.title.trim()
      ? { title: patch.title.trim().slice(0, 160) }
      : {}),
    ...(patch.documentType !== undefined
      ? { documentType: normalizeDocType(patch.documentType) }
      : {}),
    ...(typeof patch.subject === "string" && patch.subject.trim()
      ? { subject: patch.subject.trim().slice(0, 80) }
      : {}),
    ...(patch.gradeLevel !== undefined
      ? { gradeLevel: normalizeGradeLevel(patch.gradeLevel) }
      : {}),
    ...(patch.teachingStyle !== undefined
      ? { teachingStyle: normalizeTeachingStyle(patch.teachingStyle) }
      : {}),
    ...(typeof patch.extractedText === "string"
      ? { extractedText: patch.extractedText.slice(0, 24_000) }
      : {}),
    ...(patch.questions !== undefined
      ? { questions: sanitizeQuestions(patch.questions) }
      : {}),
    ...(patch.lessons !== undefined
      ? { lessons: sanitizeStringArray(patch.lessons, 15, 140) }
      : {}),
    ...(patch.topics !== undefined
      ? { topics: sanitizeStringArray(patch.topics, 20, 120) }
      : {}),
    ...(patch.keyConcepts !== undefined
      ? { keyConcepts: sanitizeStringArray(patch.keyConcepts, 25, 120) }
      : {}),
    updatedAt: Date.now(),
  };

  await ref.set(next, { merge: true });
  return next;
}

export async function deleteStudentLesson(
  uid: string,
  lessonId: string,
): Promise<boolean> {
  const ref = userLessonsCollection(uid).doc(lessonId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}