import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  deleteSavedBook,
  fetchOwnedStoryImageBytes,
  getSavedBook,
  listSavedBooks,
  loadStoryAssetsForBook,
  recordBookExportEvent,
  saveBookProject,
} from "../lib/bookPublishingService";

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function createBooksRouter(): IRouter {
  const router: IRouter = Router();

  const requireUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to access Book Publisher.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to access Book Publisher.", code: "auth_failed" });
    return null;
  };

  router.get("/books", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const books = await listSavedBooks(uid);
      res.json({ books });
    } catch {
      res.status(500).json({ error: "Could not load saved books.", code: "books_load_failed" });
    }
  });

  router.post("/books", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const book = await saveBookProject(uid, body);
      res.status(201).json({ book });
    } catch {
      res.status(500).json({ error: "Could not save book project.", code: "book_save_failed" });
    }
  });

  router.get("/books/:bookId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const bookId = String(req.params.bookId ?? "").trim();
    if (!isValidId(bookId)) {
      res.status(400).json({ error: "Invalid book ID.", code: "invalid_id" });
      return;
    }
    try {
      const book = await getSavedBook(uid, bookId);
      if (!book) {
        res.status(404).json({ error: "Saved book not found.", code: "not_found" });
        return;
      }
      res.json({ book });
    } catch {
      res.status(500).json({ error: "Could not load saved book.", code: "book_load_failed" });
    }
  });

  router.put("/books/:bookId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const bookId = String(req.params.bookId ?? "").trim();
    if (!isValidId(bookId)) {
      res.status(400).json({ error: "Invalid book ID.", code: "invalid_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const book = await saveBookProject(uid, body, bookId);
      res.json({ book });
    } catch {
      res.status(500).json({ error: "Could not update book project.", code: "book_update_failed" });
    }
  });

  router.post("/books/:bookId/exported", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const bookId = String(req.params.bookId ?? "").trim();
    if (!isValidId(bookId)) {
      res.status(400).json({ error: "Invalid book ID.", code: "invalid_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pageCount =
      typeof body.pageCount === "number" && Number.isFinite(body.pageCount)
        ? body.pageCount
        : 1;
    try {
      const book = await recordBookExportEvent(uid, bookId, pageCount);
      if (!book) {
        res.status(404).json({ error: "Saved book not found.", code: "not_found" });
        return;
      }
      res.json({ book });
    } catch {
      res.status(500).json({ error: "Could not record export.", code: "export_log_failed" });
    }
  });

  router.delete("/books/:bookId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const bookId = String(req.params.bookId ?? "").trim();
    if (!isValidId(bookId)) {
      res.status(400).json({ error: "Invalid book ID.", code: "invalid_id" });
      return;
    }
    try {
      const deleted = await deleteSavedBook(uid, bookId);
      if (!deleted) {
        res.status(404).json({ error: "Saved book not found.", code: "not_found" });
        return;
      }
      res.json({ deleted: true, id: bookId });
    } catch {
      res.status(500).json({ error: "Could not delete saved book.", code: "book_delete_failed" });
    }
  });

  router.get("/books/stories/:storyId/assets", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const storyId = String(req.params.storyId ?? "").trim();
    if (!isValidId(storyId)) {
      res.status(400).json({ error: "Invalid story ID.", code: "invalid_story" });
      return;
    }
    try {
      const assets = await loadStoryAssetsForBook(uid, storyId);
      if (!assets) {
        res.status(404).json({ error: "Story not found.", code: "not_found" });
        return;
      }
      res.json(assets);
    } catch {
      res.status(500).json({ error: "Could not load story assets.", code: "assets_failed" });
    }
  });

  router.get(
    "/books/stories/:storyId/images/:imageId/raw",
    async (req, res): Promise<void> => {
      const uid = await requireUid(req, res);
      if (!uid) return;
      const storyId = String(req.params.storyId ?? "").trim();
      const imageId = String(req.params.imageId ?? "").trim();
      if (!isValidId(storyId) || !isValidId(imageId)) {
        res.status(400).json({ error: "Invalid image reference.", code: "invalid_ref" });
        return;
      }
      try {
        const media = await fetchOwnedStoryImageBytes(uid, storyId, imageId);
        if (!media) {
          res.status(404).json({ error: "Story image unavailable.", code: "image_not_found" });
          return;
        }
        res.setHeader("Content-Type", media.contentType);
        res.setHeader("Cache-Control", "private, max-age=300");
        res.send(media.buffer);
      } catch {
        res.status(502).json({ error: "Could not fetch story image.", code: "image_proxy_failed" });
      }
    },
  );

  return router;
}

export default createBooksRouter();
