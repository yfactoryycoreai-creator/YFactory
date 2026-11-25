import type { StudentGradeLevel, StudentModelSelection } from "@/lib/studentsApi";

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

export type CommunityPostType =
  | "summary"
  | "question"
  | "exam_share"
  | "resource_share";

export type CommunityReportReason =
  | "spam"
  | "harassment"
  | "misinformation"
  | "inappropriate"
  | "privacy";

export type StudentPublicProfile = {
  handleId: string;
  displayName: string;
  bio: string;
  gradeLevel: StudentGradeLevel;
  favoriteSubjects: string[];
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowedByMe: boolean;
  isMe: boolean;
  updatedAt: number;
};

export type CommunityCommentItem = {
  id: string;
  authorHandleId: string;
  authorName: string;
  content: string;
  isMine: boolean;
  createdAt: number;
};

export type CommunityPostItem = {
  id: string;
  authorHandleId: string;
  authorName: string;
  authorGradeLevel: StudentGradeLevel;
  postType: CommunityPostType;
  subject: string;
  gradeLevel: StudentGradeLevel;
  title: string;
  content: string;
  resourceUrl: string | null;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  likedByMe: boolean;
  isMine: boolean;
  authorFollowedByMe: boolean;
  createdAt: number;
};

export class StudentsExtendedApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function extRequest<T>(
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
    // Non-JSON response
  }
  if (!resp.ok) {
    const fallback =
      resp.status === 404
        ? "Students Extended API endpoint not found (HTTP 404). Make sure routes/index.ts includes studentsExtendedRouter and restart Replit."
        : `Students request failed (HTTP ${resp.status}).`;
    throw new StudentsExtendedApiError(
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : fallback,
      typeof data.code === "string" ? data.code : `http_${resp.status}`,
      resp.status,
    );
  }
  return data as T;
}

/* ==================== Exams & Adaptive Progress ==================== */

export async function fetchStudentExams(
  idToken: string,
): Promise<StudentExamRecord[]> {
  const data = await extRequest<{ exams: StudentExamRecord[] }>(
    "/api/students/exams",
    idToken,
  );
  return data.exams;
}

export async function generateInteractiveExam(
  idToken: string,
  input: {
    lessonId?: string;
    customTopic?: string;
    focusTopics?: string[];
    subject?: string;
    gradeLevel?: StudentGradeLevel;
    mode: ExamMode;
    difficulty: ExamDifficulty;
    questionCount: number;
    questionTypes: ExamQuestionType[];
    locale: string;
    modelSelection?: StudentModelSelection;
  },
): Promise<StudentExamRecord> {
  const data = await extRequest<{ exam: StudentExamRecord }>(
    "/api/students/exams/generate",
    idToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.exam;
}

export async function fetchStudentExamById(
  idToken: string,
  examId: string,
): Promise<StudentExamRecord> {
  const data = await extRequest<{ exam: StudentExamRecord }>(
    `/api/students/exams/${encodeURIComponent(examId)}`,
    idToken,
  );
  return data.exam;
}

export async function submitExamAnswerApi(
  idToken: string,
  examId: string,
  input: {
    questionId: string;
    answer: string;
    locale: string;
    modelSelection?: StudentModelSelection;
  },
): Promise<{ exam: StudentExamRecord; question: ExamQuestionRecord }> {
  return extRequest(`/api/students/exams/${encodeURIComponent(examId)}/answer`, idToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function finishInteractiveExamApi(
  idToken: string,
  examId: string,
  input: { locale: string; modelSelection?: StudentModelSelection },
): Promise<StudentExamRecord> {
  const data = await extRequest<{ exam: StudentExamRecord }>(
    `/api/students/exams/${encodeURIComponent(examId)}/finish`,
    idToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.exam;
}

export async function deleteStudentExamApi(
  idToken: string,
  examId: string,
): Promise<void> {
  await extRequest(`/api/students/exams/${encodeURIComponent(examId)}`, idToken, {
    method: "DELETE",
  });
}

export async function fetchStudentProgress(
  idToken: string,
  locale: string,
): Promise<StudentProgressSummary> {
  const data = await extRequest<{ progress: StudentProgressSummary }>(
    `/api/students/progress?locale=${encodeURIComponent(locale)}`,
    idToken,
  );
  return data.progress;
}

/* ==================== Moderated Student Community ==================== */

export async function fetchMyCommunityProfile(
  idToken: string,
): Promise<StudentPublicProfile> {
  const data = await extRequest<{ profile: StudentPublicProfile }>(
    "/api/students/community/profile",
    idToken,
  );
  return data.profile;
}

export async function updateMyCommunityProfileApi(
  idToken: string,
  input: {
    displayName?: string;
    bio?: string;
    gradeLevel?: StudentGradeLevel;
    favoriteSubjects?: string[];
  },
): Promise<StudentPublicProfile> {
  const data = await extRequest<{ profile: StudentPublicProfile }>(
    "/api/students/community/profile",
    idToken,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return data.profile;
}

export async function toggleFollowStudentApi(
  idToken: string,
  handleId: string,
): Promise<{ following: boolean; targetFollowersCount: number }> {
  return extRequest(
    `/api/students/community/follow/${encodeURIComponent(handleId)}`,
    idToken,
    { method: "POST" },
  );
}

export async function fetchCommunityPosts(
  idToken: string,
  filters: {
    subject?: string;
    gradeLevel?: string;
    postType?: string;
    q?: string;
    following?: boolean;
  } = {},
): Promise<CommunityPostItem[]> {
  const qs = new URLSearchParams();
  if (filters.subject && filters.subject !== "all") qs.set("subject", filters.subject);
  if (filters.gradeLevel && filters.gradeLevel !== "all") qs.set("gradeLevel", filters.gradeLevel);
  if (filters.postType && filters.postType !== "all") qs.set("postType", filters.postType);
  if (filters.q?.trim()) qs.set("q", filters.q.trim());
  if (filters.following) qs.set("following", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await extRequest<{ posts: CommunityPostItem[] }>(
    `/api/students/community/posts${suffix}`,
    idToken,
  );
  return data.posts;
}

export async function createCommunityPostApi(
  idToken: string,
  input: {
    postType: CommunityPostType;
    subject: string;
    gradeLevel: StudentGradeLevel;
    title: string;
    content: string;
    resourceUrl?: string;
    tags?: string[];
  },
): Promise<CommunityPostItem> {
  const data = await extRequest<{ post: CommunityPostItem }>(
    "/api/students/community/posts",
    idToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.post;
}

export async function toggleLikePostApi(
  idToken: string,
  postId: string,
): Promise<{ liked: boolean; likesCount: number }> {
  return extRequest(
    `/api/students/community/posts/${encodeURIComponent(postId)}/like`,
    idToken,
    { method: "POST" },
  );
}

export async function fetchPostComments(
  idToken: string,
  postId: string,
): Promise<CommunityCommentItem[]> {
  const data = await extRequest<{ comments: CommunityCommentItem[] }>(
    `/api/students/community/posts/${encodeURIComponent(postId)}/comments`,
    idToken,
  );
  return data.comments;
}

export async function addPostCommentApi(
  idToken: string,
  postId: string,
  content: string,
): Promise<CommunityCommentItem> {
  const data = await extRequest<{ comment: CommunityCommentItem }>(
    `/api/students/community/posts/${encodeURIComponent(postId)}/comments`,
    idToken,
    { method: "POST", body: JSON.stringify({ content }) },
  );
  return data.comment;
}

export async function deleteCommunityPostApi(
  idToken: string,
  postId: string,
): Promise<void> {
  await extRequest(
    `/api/students/community/posts/${encodeURIComponent(postId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export async function reportCommunityPostApi(
  idToken: string,
  postId: string,
  reason: CommunityReportReason,
  details?: string,
): Promise<{ reported: true; autoHidden: boolean }> {
  return extRequest(
    `/api/students/community/posts/${encodeURIComponent(postId)}/report`,
    idToken,
    { method: "POST", body: JSON.stringify({ reason, details }) },
  );
}