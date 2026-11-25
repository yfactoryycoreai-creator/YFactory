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

export type StudentModelSelection = {
  provider: string;
  keyId: string;
  modelName: string;
};

export class StudentsApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function studentsRequest<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const rawText = await resp.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON response (e.g. 404/413/502/504 HTML)
  }
  if (!resp.ok) {
    let fallback = `Students request failed (HTTP ${resp.status}).`;
    if (resp.status === 404) {
      fallback =
        "Students API endpoint not found (HTTP 404). Make sure routes/index.ts includes studentsRouter and restart Replit (Stop -> Run).";
    } else if (resp.status === 413) {
      fallback = "Uploaded photo is too large (HTTP 413). Choose a smaller photo.";
    } else if (resp.status === 502 || resp.status === 504) {
      fallback =
        "The AI provider took too long to respond (HTTP " +
        resp.status +
        "). Try again or switch to a faster model (e.g. Gemini Flash or Groq).";
    }
    throw new StudentsApiError(
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : fallback,
      typeof data.code === "string" ? data.code : `http_${resp.status}`,
      resp.status,
    );
  }
  return data as T;
}

export async function fetchStudentLessons(
  idToken: string,
): Promise<StudentLessonRecord[]> {
  const data = await studentsRequest<{ lessons: StudentLessonRecord[] }>(
    "/api/students/lessons",
    idToken,
  );
  return data.lessons;
}

export async function analyzeStudentPhoto(
  idToken: string,
  input: {
    image?: { mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; dataUrl: string };
    pastedText?: string;
    gradeLevel: StudentGradeLevel;
    locale: string;
    modelSelection?: StudentModelSelection;
  },
): Promise<StudentLessonRecord> {
  const data = await studentsRequest<{ lesson: StudentLessonRecord }>(
    "/api/students/analyze-photo",
    idToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.lesson;
}

export async function saveStudentLessonEdits(
  idToken: string,
  lessonId: string,
  patch: Partial<StudentLessonRecord>,
): Promise<StudentLessonRecord> {
  const data = await studentsRequest<{ lesson: StudentLessonRecord }>(
    `/api/students/lessons/${encodeURIComponent(lessonId)}`,
    idToken,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.lesson;
}

export async function deleteStudentLessonApi(
  idToken: string,
  lessonId: string,
): Promise<void> {
  await studentsRequest(
    `/api/students/lessons/${encodeURIComponent(lessonId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export async function runStudentWebResearch(
  idToken: string,
  input: {
    lessonId?: string;
    topics: string[];
    subject: string;
    gradeLevel: StudentGradeLevel;
    locale: string;
    includeVisualBreakdown?: boolean;
    modelSelection?: StudentModelSelection;
  },
): Promise<{
  resources: StudentVisualResource[];
  breakdowns: StudentVisualBreakdown[];
  lesson: StudentLessonRecord | null;
}> {
  return studentsRequest("/api/students/research", idToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function saveStudentAiDiagram(
  idToken: string,
  lessonId: string,
  input: {
    topic: string;
    imageUrl: string;
    providerName: string;
    relationNote: string;
  },
): Promise<StudentLessonRecord> {
  const data = await studentsRequest<{ lesson: StudentLessonRecord }>(
    `/api/students/lessons/${encodeURIComponent(lessonId)}/ai-diagram`,
    idToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.lesson;
}

export async function askStudentAiTeacher(
  idToken: string,
  input: {
    lessonId?: string;
    message: string;
    subject: string;
    gradeLevel: StudentGradeLevel;
    teachingStyle: StudentTeachingStyle;
    focusTopic?: string;
    reexplainDifferently?: boolean;
    locale: string;
    modelSelection?: StudentModelSelection;
  },
): Promise<{
  lesson: StudentLessonRecord;
  reply: StudentTutorMessage;
}> {
  return studentsRequest("/api/students/tutor/message", idToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function prepareStudentPhotoAttachment(
  file: File,
): Promise<{
  mimeType: "image/jpeg";
  dataUrl: string;
}> {
  if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
    throw new Error("Photo must be under 15 MB.");
  }
  const objUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objUrl;
    await img.decode();
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      mimeType: "image/jpeg",
      dataUrl: canvas.toDataURL("image/jpeg", 0.88),
    };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
