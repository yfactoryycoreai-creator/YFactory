import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebaseAdmin";

export type BookTemplateId =
  | "fantasy"
  | "mystery"
  | "adventure"
  | "children"
  | "scifi"
  | "educational";

export type BookPageSize = "a4" | "letter" | "trade_6x9" | "a5" | "square_8x8";
export type BookMarginPreset = "narrow" | "standard" | "wide";
export type BookFontSize = "small" | "medium" | "large";
export type BookImageLayout = "top" | "bottom" | "full_page" | "alternating";
export type BookCoverStyle =
  | "classic_framed"
  | "full_bleed"
  | "minimal_editorial"
  | "ornate_gold";
export type BookDirection = "rtl" | "ltr";

export type BookChapterImage = {
  imageId: string;
  storyId: string;
  url: string;
  caption: string;
};

export type BookChapter = {
  id: string;
  title: string;
  body: string;
  images: BookChapterImage[];
};

export type BookDesignSettings = {
  template: BookTemplateId;
  pageSize: BookPageSize;
  fontFamily: string;
  marginPreset: BookMarginPreset;
  fontSize: BookFontSize;
  imageLayout: BookImageLayout;
  coverStyle: BookCoverStyle;
  accentColor: string;
  paperColor: string;
  textColor: string;
  direction: BookDirection;
  showPageNumbers: boolean;
  showRunningHeader: boolean;
  highQualityImages: boolean;
};

export type SavedBookProject = {
  id: string;
  storyId: string | null;
  storyName: string;
  title: string;
  subtitle: string;
  authorName: string;
  coverImageUrl: string | null;
  coverImageId: string | null;
  copyrightText: string;
  rightsNotice: string;
  includeIntro: boolean;
  introTitle: string;
  introText: string;
  includeToc: boolean;
  chapters: BookChapter[];
  design: BookDesignSettings;
  exportCount: number;
  lastExportedAt: number | null;
  lastExportPageCount: number | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryAssetImage = {
  id: string;
  storyId: string;
  url: string;
  sceneNumber: number;
  prompt: string;
  createdAt: number;
};

export type StoryAssetsResponse = {
  storyId: string;
  storyName: string;
  script: string;
  images: StoryAssetImage[];
};

function userBooksCollection(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("bookExports");
}

function userStoryDoc(uid: string, storyId: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("stories")
    .doc(storyId);
}

const VALID_TEMPLATES = new Set<BookTemplateId>([
  "fantasy",
  "mystery",
  "adventure",
  "children",
  "scifi",
  "educational",
]);
const VALID_SIZES = new Set<BookPageSize>([
  "a4",
  "letter",
  "trade_6x9",
  "a5",
  "square_8x8",
]);
const VALID_MARGINS = new Set<BookMarginPreset>(["narrow", "standard", "wide"]);
const VALID_FONT_SIZES = new Set<BookFontSize>(["small", "medium", "large"]);
const VALID_IMAGE_LAYOUTS = new Set<BookImageLayout>([
  "top",
  "bottom",
  "full_page",
  "alternating",
]);
const VALID_COVER_STYLES = new Set<BookCoverStyle>([
  "classic_framed",
  "full_bleed",
  "minimal_editorial",
  "ornate_gold",
]);

function sanitizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
    return raw.trim();
  }
  return fallback;
}

function sanitizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 4000) return null;
  if (/^https:\/\/.+/i.test(trimmed)) return trimmed;
  return null;
}

function sanitizeDesign(raw: unknown): BookDesignSettings {
  const d =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const template: BookTemplateId = VALID_TEMPLATES.has(
    d.template as BookTemplateId,
  )
    ? (d.template as BookTemplateId)
    : "fantasy";
  const pageSize: BookPageSize = VALID_SIZES.has(d.pageSize as BookPageSize)
    ? (d.pageSize as BookPageSize)
    : "a4";
  const marginPreset: BookMarginPreset = VALID_MARGINS.has(
    d.marginPreset as BookMarginPreset,
  )
    ? (d.marginPreset as BookMarginPreset)
    : "standard";
  const fontSize: BookFontSize = VALID_FONT_SIZES.has(
    d.fontSize as BookFontSize,
  )
    ? (d.fontSize as BookFontSize)
    : "medium";
  const imageLayout: BookImageLayout = VALID_IMAGE_LAYOUTS.has(
    d.imageLayout as BookImageLayout,
  )
    ? (d.imageLayout as BookImageLayout)
    : "top";
  const coverStyle: BookCoverStyle = VALID_COVER_STYLES.has(
    d.coverStyle as BookCoverStyle,
  )
    ? (d.coverStyle as BookCoverStyle)
    : "classic_framed";
  const direction: BookDirection = d.direction === "rtl" ? "rtl" : "ltr";

  return {
    template,
    pageSize,
    fontFamily:
      typeof d.fontFamily === "string" && d.fontFamily.trim()
        ? d.fontFamily.trim().slice(0, 64)
        : direction === "rtl"
          ? "Amiri"
          : "Merriweather",
    marginPreset,
    fontSize,
    imageLayout,
    coverStyle,
    accentColor: sanitizeHexColor(d.accentColor, "#b8860b"),
    paperColor: sanitizeHexColor(d.paperColor, "#fdfbf7"),
    textColor: sanitizeHexColor(d.textColor, "#1f2430"),
    direction,
    showPageNumbers: d.showPageNumbers !== false,
    showRunningHeader: d.showRunningHeader !== false,
    highQualityImages: d.highQualityImages !== false,
  };
}

function sanitizeChapters(raw: unknown): BookChapter[] {
  if (!Array.isArray(raw)) return [];
  const out: BookChapter[] = [];
  for (let i = 0; i < Math.min(raw.length, 60); i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id =
      typeof obj.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(obj.id)
        ? obj.id
        : `ch_${i + 1}`;
    const title =
      typeof obj.title === "string" && obj.title.trim()
        ? obj.title.trim().slice(0, 140)
        : `Chapter ${i + 1}`;
    const body =
      typeof obj.body === "string" ? obj.body.slice(0, 25_000) : "";
    const images: BookChapterImage[] = [];
    if (Array.isArray(obj.images)) {
      for (const rawImg of obj.images.slice(0, 20)) {
        if (!rawImg || typeof rawImg !== "object") continue;
        const imgObj = rawImg as Record<string, unknown>;
        const url = sanitizeImageUrl(imgObj.url);
        if (!url) continue;
        images.push({
          imageId:
            typeof imgObj.imageId === "string"
              ? imgObj.imageId.trim().slice(0, 128)
              : "",
          storyId:
            typeof imgObj.storyId === "string"
              ? imgObj.storyId.trim().slice(0, 128)
              : "",
          url,
          caption:
            typeof imgObj.caption === "string"
              ? imgObj.caption.trim().slice(0, 220)
              : "",
        });
      }
    }
    out.push({ id, title, body, images });
  }
  return out;
}

function bookFromDoc(id: string, d: Record<string, unknown>): SavedBookProject {
  return {
    id,
    storyId: typeof d.storyId === "string" && d.storyId ? d.storyId : null,
    storyName: String(d.storyName ?? "").slice(0, 140),
    title: String(d.title ?? "Untitled Book").slice(0, 160),
    subtitle: String(d.subtitle ?? "").slice(0, 220),
    authorName: String(d.authorName ?? "").slice(0, 120),
    coverImageUrl: sanitizeImageUrl(d.coverImageUrl),
    coverImageId:
      typeof d.coverImageId === "string" && d.coverImageId
        ? d.coverImageId.slice(0, 128)
        : null,
    copyrightText: String(d.copyrightText ?? "").slice(0, 1200),
    rightsNotice: String(d.rightsNotice ?? "").slice(0, 1200),
    includeIntro: d.includeIntro === true,
    introTitle: String(d.introTitle ?? "Introduction").slice(0, 120),
    introText: String(d.introText ?? "").slice(0, 8000),
    includeToc: d.includeToc !== false,
    chapters: sanitizeChapters(d.chapters),
    design: sanitizeDesign(d.design),
    exportCount:
      typeof d.exportCount === "number" && Number.isFinite(d.exportCount)
        ? Math.max(0, Math.round(d.exportCount))
        : 0,
    lastExportedAt:
      typeof d.lastExportedAt === "number" ? d.lastExportedAt : null,
    lastExportPageCount:
      typeof d.lastExportPageCount === "number" ? d.lastExportPageCount : null,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

export async function listSavedBooks(uid: string): Promise<SavedBookProject[]> {
  const snap = await userBooksCollection(uid)
    .orderBy("updatedAt", "desc")
    .limit(40)
    .get();
  return snap.docs.map((doc) => bookFromDoc(doc.id, doc.data()));
}

export async function getSavedBook(
  uid: string,
  bookId: string,
): Promise<SavedBookProject | null> {
  const snap = await userBooksCollection(uid).doc(bookId).get();
  if (!snap.exists) return null;
  return bookFromDoc(snap.id, snap.data() ?? {});
}

export async function saveBookProject(
  uid: string,
  input: Record<string, unknown>,
  existingBookId?: string,
): Promise<SavedBookProject> {
  const now = Date.now();
  const id = existingBookId || `book_${now}_${randomBytes(4).toString("hex")}`;
  const ref = userBooksCollection(uid).doc(id);
  const existingSnap = existingBookId ? await ref.get() : null;
  const prev = existingSnap?.exists
    ? bookFromDoc(id, existingSnap.data() ?? {})
    : null;

  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 160)
      : prev?.title || "Untitled Book";

  const record: SavedBookProject = {
    id,
    storyId:
      typeof input.storyId === "string" && input.storyId.trim()
        ? input.storyId.trim().slice(0, 128)
        : prev?.storyId ?? null,
    storyName:
      typeof input.storyName === "string"
        ? input.storyName.trim().slice(0, 140)
        : prev?.storyName ?? "",
    title,
    subtitle:
      typeof input.subtitle === "string"
        ? input.subtitle.trim().slice(0, 220)
        : prev?.subtitle ?? "",
    authorName:
      typeof input.authorName === "string"
        ? input.authorName.trim().slice(0, 120)
        : prev?.authorName ?? "",
    coverImageUrl:
      input.coverImageUrl !== undefined
        ? sanitizeImageUrl(input.coverImageUrl)
        : prev?.coverImageUrl ?? null,
    coverImageId:
      input.coverImageId !== undefined
        ? typeof input.coverImageId === "string" && input.coverImageId.trim()
          ? input.coverImageId.trim().slice(0, 128)
          : null
        : prev?.coverImageId ?? null,
    copyrightText:
      typeof input.copyrightText === "string"
        ? input.copyrightText.trim().slice(0, 1200)
        : prev?.copyrightText ?? "",
    rightsNotice:
      typeof input.rightsNotice === "string"
        ? input.rightsNotice.trim().slice(0, 1200)
        : prev?.rightsNotice ?? "",
    includeIntro:
      typeof input.includeIntro === "boolean"
        ? input.includeIntro
        : prev?.includeIntro ?? false,
    introTitle:
      typeof input.introTitle === "string" && input.introTitle.trim()
        ? input.introTitle.trim().slice(0, 120)
        : prev?.introTitle ?? "Introduction",
    introText:
      typeof input.introText === "string"
        ? input.introText.slice(0, 8000)
        : prev?.introText ?? "",
    includeToc:
      typeof input.includeToc === "boolean"
        ? input.includeToc
        : prev?.includeToc ?? true,
    chapters:
      input.chapters !== undefined
        ? sanitizeChapters(input.chapters)
        : prev?.chapters ?? [],
    design:
      input.design !== undefined
        ? sanitizeDesign(input.design)
        : prev?.design ?? sanitizeDesign({}),
    exportCount: prev?.exportCount ?? 0,
    lastExportedAt: prev?.lastExportedAt ?? null,
    lastExportPageCount: prev?.lastExportPageCount ?? null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };

  await ref.set({
    ...record,
    updatedAtTs: Timestamp.fromMillis(now),
  });
  return record;
}

export async function recordBookExportEvent(
  uid: string,
  bookId: string,
  pageCount: number,
): Promise<SavedBookProject | null> {
  const ref = userBooksCollection(uid).doc(bookId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const prev = bookFromDoc(bookId, snap.data() ?? {});
  const now = Date.now();
  const updated: SavedBookProject = {
    ...prev,
    exportCount: prev.exportCount + 1,
    lastExportedAt: now,
    lastExportPageCount: Math.max(1, Math.min(500, Math.round(pageCount))),
    updatedAt: now,
  };
  await ref.update({
    exportCount: updated.exportCount,
    lastExportedAt: updated.lastExportedAt,
    lastExportPageCount: updated.lastExportPageCount,
    updatedAt: updated.updatedAt,
  });
  return updated;
}

export async function deleteSavedBook(
  uid: string,
  bookId: string,
): Promise<boolean> {
  const ref = userBooksCollection(uid).doc(bookId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

function extractStoredImageUrl(d: Record<string, unknown>): string | null {
  for (const key of [
    "imageUrl",
    "url",
    "secureUrl",
    "secure_url",
    "downloadUrl",
    "imageData",
  ]) {
    const val = d[key];
    if (typeof val === "string" && val.trim()) {
      const trimmed = val.trim();
      if (/^https:\/\/.+/i.test(trimmed) || /^data:image\/.+;base64,/i.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return null;
}

function extractCreatedMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number" && Number.isFinite(val)) return val;
  return 0;
}

export async function loadStoryAssetsForBook(
  uid: string,
  storyId: string,
): Promise<StoryAssetsResponse | null> {
  const storyRef = userStoryDoc(uid, storyId);
  const storySnap = await storyRef.get();
  if (!storySnap.exists) return null;
  const sData = storySnap.data() ?? {};

  const imagesSnap = await storyRef.collection("images").get();
  const images: StoryAssetImage[] = [];
  let fallbackIdx = 1;

  for (const doc of imagesSnap.docs) {
    const d = doc.data() ?? {};
    const rawUrl = extractStoredImageUrl(d);
    if (!rawUrl) continue;
    const num =
      typeof d.sceneNumber === "number"
        ? d.sceneNumber
        : typeof d.order === "number"
          ? d.order
          : typeof d.index === "number"
            ? d.index
            : fallbackIdx;
    fallbackIdx += 1;
    images.push({
      id: doc.id,
      storyId,
      url: rawUrl,
      sceneNumber: num,
      prompt:
        typeof d.prompt === "string"
          ? d.prompt.trim().slice(0, 300)
          : typeof d.sceneText === "string"
            ? d.sceneText.trim().slice(0, 300)
            : "",
      createdAt: extractCreatedMillis(d.createdAt),
    });
  }

  images.sort((a, b) => a.sceneNumber - b.sceneNumber || a.createdAt - b.createdAt);

  return {
    storyId,
    storyName:
      typeof sData.storyName === "string" && sData.storyName.trim()
        ? sData.storyName.trim()
        : "Untitled Story",
    script: typeof sData.script === "string" ? sData.script : "",
    images,
  };
}

export async function fetchOwnedStoryImageBytes(
  uid: string,
  storyId: string,
  imageId: string,
): Promise<{ contentType: string; buffer: Buffer } | null> {
  const imgSnap = await userStoryDoc(uid, storyId)
    .collection("images")
    .doc(imageId)
    .get();
  if (!imgSnap.exists) return null;
  const url = extractStoredImageUrl(imgSnap.data() ?? {});
  if (!url) return null;

  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(
    url,
  );
  if (dataMatch) {
    return {
      contentType: dataMatch[1]!,
      buffer: Buffer.from(dataMatch[2]!, "base64"),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const arr = await resp.arrayBuffer();
    if (arr.byteLength > 15_000_000) return null;
    return { contentType, buffer: Buffer.from(arr) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
