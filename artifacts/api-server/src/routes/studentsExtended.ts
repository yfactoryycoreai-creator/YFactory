import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  addPostComment,
  createCommunityPost,
  deleteOwnCommunityPost,
  getMyCommunityProfile,
  listCommunityPosts,
  listPostComments,
  reportCommunityPost,
  toggleFollowStudent,
  toggleLikeCommunityPost,
  updateMyCommunityProfile,
  type CommunityPostType,
  type CommunityReportReason,
} from "../lib/studentsCommunityService";
import {
  createInteractiveExam,
  deleteStudentExam,
  finalizeInteractiveExam,
  getStudentExam,
  getStudentProgressSummary,
  listStudentExams,
  serializeExamForClient,
  submitExamAnswer,
  type ExamDifficulty,
  type ExamMode,
  type ExamQuestionType,
} from "../lib/studentsExamsService";
import { StudentsServiceError, type StudentGradeLevel } from "../lib/studentsService";

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

function parseModelSelection(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const provider = typeof obj.provider === "string" ? obj.provider.trim() : "";
  const keyId = typeof obj.keyId === "string" ? obj.keyId.trim() : "";
  const modelName = typeof obj.modelName === "string" ? obj.modelName.trim() : "";
  if (!provider || !keyId || !modelName) return undefined;
  return { provider, keyId, modelName };
}

export function createStudentsExtendedRouter(): IRouter {
  const router: IRouter = Router();

  const requireUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to access Students.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to access Students.", code: "auth_failed" });
    return null;
  };

  /* ==================== INTERACTIVE EXAMS & ADAPTIVE LEARNING ==================== */

  router.get("/students/exams", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const exams = await listStudentExams(uid, 25);
      res.json({ exams: exams.map(serializeExamForClient) });
    } catch {
      res.status(500).json({ error: "Could not load exams.", code: "exams_failed" });
    }
  });

  router.post("/students/exams/generate", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const exam = await createInteractiveExam(uid, {
        lessonId:
          typeof body.lessonId === "string" && isValidId(body.lessonId)
            ? body.lessonId
            : undefined,
        customTopic:
          typeof body.customTopic === "string" ? body.customTopic : undefined,
        focusTopics: Array.isArray(body.focusTopics)
          ? body.focusTopics.filter((x): x is string => typeof x === "string")
          : undefined,
        subject: typeof body.subject === "string" ? body.subject : undefined,
        gradeLevel: body.gradeLevel as StudentGradeLevel | undefined,
        mode: body.mode as ExamMode | undefined,
        difficulty: body.difficulty as ExamDifficulty | undefined,
        questionCount:
          typeof body.questionCount === "number" ? body.questionCount : undefined,
        questionTypes: Array.isArray(body.questionTypes)
          ? (body.questionTypes as ExamQuestionType[])
          : undefined,
        locale: typeof body.locale === "string" ? body.locale : "en",
        modelSelection: parseModelSelection(body.modelSelection),
      });
      res.status(201).json({ exam: serializeExamForClient(exam) });
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not generate exam.", code: "exam_gen_failed" });
    }
  });

  router.get("/students/exams/:examId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const examId = String(req.params.examId ?? "").trim();
    if (!isValidId(examId)) {
      res.status(400).json({ error: "Invalid exam ID.", code: "invalid_id" });
      return;
    }
    try {
      const exam = await getStudentExam(uid, examId);
      if (!exam) {
        res.status(404).json({ error: "Exam not found.", code: "not_found" });
        return;
      }
      res.json({ exam: serializeExamForClient(exam) });
    } catch {
      res.status(500).json({ error: "Could not load exam.", code: "exam_failed" });
    }
  });

  router.post("/students/exams/:examId/answer", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const examId = String(req.params.examId ?? "").trim();
    if (!isValidId(examId)) {
      res.status(400).json({ error: "Invalid exam ID.", code: "invalid_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await submitExamAnswer(uid, examId, {
        questionId: typeof body.questionId === "string" ? body.questionId : "",
        answer: typeof body.answer === "string" ? body.answer : "",
        locale: typeof body.locale === "string" ? body.locale : "en",
        modelSelection: parseModelSelection(body.modelSelection),
      });
      const safeExam = serializeExamForClient(result.exam);
      const safeQ =
        safeExam.questions.find((q) => q.id === result.gradedQuestion.id) ??
        result.gradedQuestion;
      res.json({ exam: safeExam, question: safeQ });
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not submit answer.", code: "answer_failed" });
    }
  });

  router.post("/students/exams/:examId/finish", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const examId = String(req.params.examId ?? "").trim();
    if (!isValidId(examId)) {
      res.status(400).json({ error: "Invalid exam ID.", code: "invalid_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const completed = await finalizeInteractiveExam(uid, examId, {
        locale: typeof body.locale === "string" ? body.locale : "en",
        modelSelection: parseModelSelection(body.modelSelection),
      });
      res.json({ exam: serializeExamForClient(completed) });
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not finalize exam.", code: "finish_failed" });
    }
  });

  router.delete("/students/exams/:examId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const examId = String(req.params.examId ?? "").trim();
    if (!isValidId(examId)) {
      res.status(400).json({ error: "Invalid exam ID.", code: "invalid_id" });
      return;
    }
    try {
      const ok = await deleteStudentExam(uid, examId);
      if (!ok) {
        res.status(404).json({ error: "Exam not found.", code: "not_found" });
        return;
      }
      res.json({ deleted: true, id: examId });
    } catch {
      res.status(500).json({ error: "Could not delete exam.", code: "delete_failed" });
    }
  });

  /* ==================== STUDENT PROGRESS DASHBOARD ==================== */

  router.get("/students/progress", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const locale = typeof req.query.locale === "string" ? req.query.locale : "en";
    try {
      const progress = await getStudentProgressSummary(uid, locale);
      res.json({ progress });
    } catch {
      res.status(500).json({ error: "Could not load student progress.", code: "progress_failed" });
    }
  });

  /* ==================== MODERATED STUDENT COMMUNITY ==================== */

  router.get("/students/community/profile", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const profile = await getMyCommunityProfile(uid);
      res.json({ profile });
    } catch {
      res.status(500).json({ error: "Could not load student profile.", code: "profile_failed" });
    }
  });

  router.patch("/students/community/profile", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const profile = await updateMyCommunityProfile(uid, {
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
        bio: typeof body.bio === "string" ? body.bio : undefined,
        gradeLevel: body.gradeLevel as StudentGradeLevel | undefined,
        favoriteSubjects: Array.isArray(body.favoriteSubjects)
          ? body.favoriteSubjects.filter((x): x is string => typeof x === "string")
          : undefined,
      });
      res.json({ profile });
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not update profile.", code: "profile_update_failed" });
    }
  });

  router.post(
    "/students/community/follow/:handleId",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const handleId = String(req.params.handleId ?? "").trim();
      if (!isValidId(handleId)) {
        res.status(400).json({ error: "Invalid student handle.", code: "invalid_id" });
        return;
      }
      try {
        const result = await toggleFollowStudent(uid, handleId);
        res.json(result);
      } catch (err) {
        if (err instanceof StudentsServiceError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        res.status(500).json({ error: "Could not update follow status.", code: "follow_failed" });
      }
    },
  );

  router.get("/students/community/posts", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const posts = await listCommunityPosts(uid, {
        subject: typeof req.query.subject === "string" ? req.query.subject : undefined,
        gradeLevel:
          typeof req.query.gradeLevel === "string" ? req.query.gradeLevel : undefined,
        postType:
          typeof req.query.postType === "string" ? req.query.postType : undefined,
        query: typeof req.query.q === "string" ? req.query.q : undefined,
        onlyFollowing: req.query.following === "true",
      });
      res.json({ posts });
    } catch {
      res.status(500).json({ error: "Could not load community feed.", code: "feed_failed" });
    }
  });

  router.post("/students/community/posts", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const post = await createCommunityPost(uid, {
        postType: (body.postType as CommunityPostType) ?? "summary",
        subject: typeof body.subject === "string" ? body.subject : "General",
        gradeLevel: (body.gradeLevel as StudentGradeLevel) ?? "high_school",
        title: typeof body.title === "string" ? body.title : "",
        content: typeof body.content === "string" ? body.content : "",
        resourceUrl:
          typeof body.resourceUrl === "string" ? body.resourceUrl : undefined,
        tags: Array.isArray(body.tags)
          ? body.tags.filter((x): x is string => typeof x === "string")
          : undefined,
      });
      res.status(201).json({ post });
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not create community post.", code: "post_failed" });
    }
  });

  router.post(
    "/students/community/posts/:postId/like",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const postId = String(req.params.postId ?? "").trim();
      if (!isValidId(postId)) {
        res.status(400).json({ error: "Invalid post ID.", code: "invalid_id" });
        return;
      }
      try {
        const result = await toggleLikeCommunityPost(uid, postId);
        res.json(result);
      } catch (err) {
        if (err instanceof StudentsServiceError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        res.status(500).json({ error: "Could not update like.", code: "like_failed" });
      }
    },
  );

  router.get(
    "/students/community/posts/:postId/comments",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const postId = String(req.params.postId ?? "").trim();
      if (!isValidId(postId)) {
        res.status(400).json({ error: "Invalid post ID.", code: "invalid_id" });
        return;
      }
      try {
        const comments = await listPostComments(uid, postId);
        res.json({ comments });
      } catch {
        res.status(500).json({ error: "Could not load comments.", code: "comments_failed" });
      }
    },
  );

  router.post(
    "/students/community/posts/:postId/comments",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const postId = String(req.params.postId ?? "").trim();
      if (!isValidId(postId)) {
        res.status(400).json({ error: "Invalid post ID.", code: "invalid_id" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const comment = await addPostComment(
          uid,
          postId,
          typeof body.content === "string" ? body.content : "",
        );
        res.status(201).json({ comment });
      } catch (err) {
        if (err instanceof StudentsServiceError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        res.status(500).json({ error: "Could not post comment.", code: "comment_failed" });
      }
    },
  );

  router.delete(
    "/students/community/posts/:postId",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const postId = String(req.params.postId ?? "").trim();
      if (!isValidId(postId)) {
        res.status(400).json({ error: "Invalid post ID.", code: "invalid_id" });
        return;
      }
      try {
        const deleted = await deleteOwnCommunityPost(uid, postId);
        if (!deleted) {
          res.status(404).json({ error: "Post not found.", code: "not_found" });
          return;
        }
        res.json({ deleted: true, id: postId });
      } catch (err) {
        if (err instanceof StudentsServiceError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        res.status(500).json({ error: "Could not delete post.", code: "delete_failed" });
      }
    },
  );

  router.post(
    "/students/community/posts/:postId/report",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const postId = String(req.params.postId ?? "").trim();
      if (!isValidId(postId)) {
        res.status(400).json({ error: "Invalid post ID.", code: "invalid_id" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const validReasons: CommunityReportReason[] = [
        "spam",
        "harassment",
        "misinformation",
        "inappropriate",
        "privacy",
      ];
      const reason = validReasons.includes(body.reason as CommunityReportReason)
        ? (body.reason as CommunityReportReason)
        : "inappropriate";
      try {
        const result = await reportCommunityPost(
          uid,
          postId,
          reason,
          typeof body.details === "string" ? body.details : undefined,
        );
        res.json(result);
      } catch (err) {
        if (err instanceof StudentsServiceError) {
          res.status(err.status).json({ error: err.message, code: err.code });
          return;
        }
        res.status(500).json({ error: "Could not submit report.", code: "report_failed" });
      }
    },
  );

  return router;
}

export default createStudentsExtendedRouter();