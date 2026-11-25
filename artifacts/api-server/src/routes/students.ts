import { Router, type IRouter, type Request, type Response } from "express";
import type { ChatImageAttachment } from "../lib/chatAdapters";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  analyzeExamOrLessonPhoto,
  attachAiEducationalDiagram,
  deleteStudentLesson,
  getStudentLesson,
  listStudentLessons,
  researchEducationalResources,
  sendStudentTutorMessage,
  StudentsServiceError,
  updateStudentLesson,
  type StudentGradeLevel,
  type StudentTeachingStyle,
} from "../lib/studentsService";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 24;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_DATA_URL_LEN = 5_000_000;

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

function parseImageInput(raw: unknown): ChatImageAttachment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : "";
  const dataUrl = typeof obj.dataUrl === "string" ? obj.dataUrl : "";
  if (
    !ALLOWED_MIME.has(mimeType) ||
    !dataUrl.startsWith(`data:${mimeType};base64,`) ||
    dataUrl.length > MAX_IMAGE_DATA_URL_LEN
  ) {
    return undefined;
  }
  return {
    mimeType: mimeType as ChatImageAttachment["mimeType"],
    dataUrl,
  };
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

export function createStudentsRouter(): IRouter {
  const router: IRouter = Router();
  const hitsByUser = new Map<string, number[]>();

  const allowReq = (uid: string, now = Date.now()): boolean => {
    const recent = (hitsByUser.get(uid) ?? []).filter(
      (ts) => now - ts < RATE_WINDOW_MS,
    );
    if (recent.length >= RATE_LIMIT) {
      hitsByUser.set(uid, recent);
      return false;
    }
    recent.push(now);
    hitsByUser.set(uid, recent);
    return true;
  };

  const requireUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to access Students platform.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to access Students platform.", code: "auth_failed" });
    return null;
  };

  router.get("/students/lessons", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const lessons = await listStudentLessons(uid, 30);
      res.json({ lessons });
    } catch {
      res.status(500).json({ error: "Could not load lessons.", code: "lessons_failed" });
    }
  });

  router.get("/students/lessons/:lessonId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const lessonId = String(req.params.lessonId ?? "").trim();
    if (!isValidId(lessonId)) {
      res.status(400).json({ error: "Invalid lesson ID.", code: "invalid_id" });
      return;
    }
    try {
      const lesson = await getStudentLesson(uid, lessonId);
      if (!lesson) {
        res.status(404).json({ error: "Lesson not found.", code: "not_found" });
        return;
      }
      res.json({ lesson });
    } catch {
      res.status(500).json({ error: "Could not load lesson.", code: "lesson_failed" });
    }
  });

  router.post("/students/analyze-photo", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    if (!allowReq(uid)) {
      res.status(429).json({ error: "Too many analysis requests. Wait a moment.", code: "rate_limited" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const image = parseImageInput(body.image);
    const pastedText = typeof body.pastedText === "string" ? body.pastedText : undefined;
    if (body.image && !image) {
      res.status(400).json({
        error: "Invalid or oversized photo. Use JPEG, PNG, or WebP under 4 MB.",
        code: "invalid_image",
      });
      return;
    }
    try {
      const lesson = await analyzeExamOrLessonPhoto(uid, {
        image,
        pastedText,
        gradeLevel: body.gradeLevel as StudentGradeLevel | undefined,
        locale: typeof body.locale === "string" ? body.locale : "en",
        modelSelection: parseModelSelection(body.modelSelection),
      });
      res.status(201).json({ lesson });
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not analyze document.", code: "analyze_failed" });
    }
  });

  router.patch("/students/lessons/:lessonId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const lessonId = String(req.params.lessonId ?? "").trim();
    if (!isValidId(lessonId)) {
      res.status(400).json({ error: "Invalid lesson ID.", code: "invalid_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const lesson = await updateStudentLesson(uid, lessonId, body);
      if (!lesson) {
        res.status(404).json({ error: "Lesson not found.", code: "not_found" });
        return;
      }
      res.json({ lesson });
    } catch {
      res.status(500).json({ error: "Could not update lesson.", code: "update_failed" });
    }
  });

  router.delete("/students/lessons/:lessonId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const lessonId = String(req.params.lessonId ?? "").trim();
    if (!isValidId(lessonId)) {
      res.status(400).json({ error: "Invalid lesson ID.", code: "invalid_id" });
      return;
    }
    try {
      const ok = await deleteStudentLesson(uid, lessonId);
      if (!ok) {
        res.status(404).json({ error: "Lesson not found.", code: "not_found" });
        return;
      }
      res.json({ deleted: true, id: lessonId });
    } catch {
      res.status(500).json({ error: "Could not delete lesson.", code: "delete_failed" });
    }
  });

  router.post("/students/research", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    if (!allowReq(uid)) {
      res.status(429).json({ error: "Too many research requests. Wait a moment.", code: "rate_limited" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const topics = Array.isArray(body.topics)
      ? body.topics.filter((x): x is string => typeof x === "string")
      : typeof body.topic === "string"
        ? [body.topic]
        : [];
    const lessonId =
      typeof body.lessonId === "string" && isValidId(body.lessonId)
        ? body.lessonId
        : undefined;
    try {
      const result = await researchEducationalResources(uid, {
        lessonId,
        topics,
        subject: typeof body.subject === "string" ? body.subject : "General",
        gradeLevel: body.gradeLevel as StudentGradeLevel | undefined,
        locale: typeof body.locale === "string" ? body.locale : "en",
        includeVisualBreakdown: body.includeVisualBreakdown !== false,
        modelSelection: parseModelSelection(body.modelSelection),
      });
      res.json(result);
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Educational research failed.", code: "research_failed" });
    }
  });

  router.post(
    "/students/lessons/:lessonId/ai-diagram",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const lessonId = String(req.params.lessonId ?? "").trim();
      if (!isValidId(lessonId)) {
        res.status(400).json({ error: "Invalid lesson ID.", code: "invalid_id" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const topic = typeof body.topic === "string" ? body.topic : "";
      const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
      const providerName =
        typeof body.providerName === "string" ? body.providerName : "Image Provider";
      const relationNote =
        typeof body.relationNote === "string"
          ? body.relationNote
          : `AI-generated educational diagram for ${topic}`;

      if (!topic.trim() || !imageUrl.trim()) {
        res.status(400).json({ error: "Topic and image are required.", code: "validation_failed" });
        return;
      }
      try {
        const lesson = await attachAiEducationalDiagram(uid, lessonId, {
          topic,
          imageUrl,
          providerName,
          relationNote,
        });
        if (!lesson) {
          res.status(404).json({ error: "Lesson not found.", code: "not_found" });
          return;
        }
        res.status(201).json({ lesson });
      } catch {
        res.status(500).json({ error: "Could not attach diagram.", code: "diagram_failed" });
      }
    },
  );

  router.post("/students/tutor/message", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    if (!allowReq(uid)) {
      res.status(429).json({ error: "Too many AI Teacher requests. Wait a moment.", code: "rate_limited" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const lessonId =
      typeof body.lessonId === "string" && isValidId(body.lessonId)
        ? body.lessonId
        : undefined;
    const message = typeof body.message === "string" ? body.message : "";
    try {
      const result = await sendStudentTutorMessage(uid, {
        lessonId,
        message,
        subject: typeof body.subject === "string" ? body.subject : undefined,
        gradeLevel: body.gradeLevel as StudentGradeLevel | undefined,
        teachingStyle: body.teachingStyle as StudentTeachingStyle | undefined,
        focusTopic: typeof body.focusTopic === "string" ? body.focusTopic : undefined,
        reexplainDifferently: body.reexplainDifferently === true,
        locale: typeof body.locale === "string" ? body.locale : "en",
        modelSelection: parseModelSelection(body.modelSelection),
      });
      res.json(result);
    } catch (err) {
      if (err instanceof StudentsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "AI Teacher request failed.", code: "tutor_failed" });
    }
  });

  return router;
}

export default createStudentsRouter();
