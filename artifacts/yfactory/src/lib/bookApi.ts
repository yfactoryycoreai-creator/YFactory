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

export type BookTemplatePreset = {
  id: BookTemplateId;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  accentColor: string;
  paperColor: string;
  textColor: string;
  coverBg: string;
  coverText: string;
  coverStyle: BookCoverStyle;
  fontRtl: string;
  fontLtr: string;
  borderStyle: "ornate" | "noir" | "expedition" | "playful" | "tech" | "academic";
};

export const BOOK_TEMPLATES: ReadonlyArray<BookTemplatePreset> = [
  {
    id: "fantasy",
    nameEn: "Fantasy",
    nameAr: "فانتازيا وخيال",
    descEn: "Warm parchment pages, royal gold frames, classic serif feel.",
    descAr: "ورق دافئ بإطارات ذهبية ملكية ولمسة كلاسيكية.",
    accentColor: "#b8860b",
    paperColor: "#fbf7ee",
    textColor: "#231e18",
    coverBg: "#15111b",
    coverText: "#f6e3b4",
    coverStyle: "ornate_gold",
    fontRtl: "Amiri",
    fontLtr: "Georgia",
    borderStyle: "ornate",
  },
  {
    id: "mystery",
    nameEn: "Mystery",
    nameAr: "غموض وإثارة",
    descEn: "Crisp ivory stock, noir slate accents, dramatic chapter headers.",
    descAr: "تصميم غامض بتباين أنيق وعناوين فصول درامية.",
    accentColor: "#9f1239",
    paperColor: "#f8f7f4",
    textColor: "#18181b",
    coverBg: "#111216",
    coverText: "#f4f4f5",
    coverStyle: "classic_framed",
    fontRtl: "Cairo",
    fontLtr: "Georgia",
    borderStyle: "noir",
  },
  {
    id: "adventure",
    nameEn: "Adventure",
    nameAr: "مغامرة ورحلات",
    descEn: "Expedition terracotta accents and bold storytelling headers.",
    descAr: "طابع رحلات ومغامرات بألوان دافئة وتنسيق حيوي.",
    accentColor: "#b45309",
    paperColor: "#fcf9f2",
    textColor: "#241d15",
    coverBg: "#1c241b",
    coverText: "#fde68a",
    coverStyle: "full_bleed",
    fontRtl: "Cairo",
    fontLtr: "Trebuchet MS",
    borderStyle: "expedition",
  },
  {
    id: "children",
    nameEn: "Children's Stories",
    nameAr: "قصص الأطفال",
    descEn: "Bright cheerful frames, larger readable text, picture-book feel.",
    descAr: "إطارات مبهجة، خط كبير وواضح، وتنسيق مناسب لكتب الأطفال.",
    accentColor: "#0284c7",
    paperColor: "#fffdf7",
    textColor: "#1e293b",
    coverBg: "#0f3d5e",
    coverText: "#fef08a",
    coverStyle: "full_bleed",
    fontRtl: "Tajawal",
    fontLtr: "Verdana",
    borderStyle: "playful",
  },
  {
    id: "scifi",
    nameEn: "Science Fiction",
    nameAr: "خيال علمي",
    descEn: "Geometric cyber lines, clean technical typography, sleek framing.",
    descAr: "خطوط هندسية عصرية وتصميم تقني أنيق للخيال العلمي.",
    accentColor: "#0891b2",
    paperColor: "#f7fafc",
    textColor: "#0f172a",
    coverBg: "#091322",
    coverText: "#bae6fd",
    coverStyle: "minimal_editorial",
    fontRtl: "Cairo",
    fontLtr: "Segoe UI",
    borderStyle: "tech",
  },
  {
    id: "educational",
    nameEn: "Educational Books",
    nameAr: "الكتب التعليمية",
    descEn: "Clean academic typography, structured chapters, print-first clarity.",
    descAr: "تنظيم أكاديمي واضح للفصول والصور والطباعة التعليمية.",
    accentColor: "#1d4ed8",
    paperColor: "#ffffff",
    textColor: "#111827",
    coverBg: "#13294b",
    coverText: "#f8fafc",
    coverStyle: "minimal_editorial",
    fontRtl: "Cairo",
    fontLtr: "Arial",
    borderStyle: "academic",
  },
];

export const PAGE_SIZE_SPECS: Record<
  BookPageSize,
  { labelEn: string; labelAr: string; widthPt: number; heightPt: number; cssSize: string }
> = {
  a4: { labelEn: "A4 (210 × 297 mm)", labelAr: "A4 (210 × 297 مم)", widthPt: 595, heightPt: 842, cssSize: "210mm 297mm" },
  letter: { labelEn: "US Letter (8.5 × 11 in)", labelAr: "Letter (8.5 × 11 إنش)", widthPt: 612, heightPt: 792, cssSize: "8.5in 11in" },
  trade_6x9: { labelEn: "Trade Book (6 × 9 in)", labelAr: "كتاب مطبوع (6 × 9 إنش)", widthPt: 432, heightPt: 648, cssSize: "6in 9in" },
  a5: { labelEn: "A5 Novel (148 × 210 mm)", labelAr: "رواية A5 (148 × 210 مم)", widthPt: 420, heightPt: 595, cssSize: "148mm 210mm" },
  square_8x8: { labelEn: "Picture Book (8 × 8 in)", labelAr: "كتاب مصور مربع (8 × 8 إنش)", widthPt: 576, heightPt: 576, cssSize: "8in 8in" },
};

export const FONT_OPTIONS: ReadonlyArray<{ value: string; label: string; stack: string }> = [
  { value: "Amiri", label: "Amiri (Arabic Classic Serif)", stack: "'Amiri', 'Traditional Arabic', Georgia, serif" },
  { value: "Cairo", label: "Cairo (Modern Arabic & Latin)", stack: "'Cairo', 'Segoe UI', Tahoma, sans-serif" },
  { value: "Tajawal", label: "Tajawal (Friendly Readable)", stack: "'Tajawal', 'Segoe UI', sans-serif" },
  { value: "Georgia", label: "Georgia (Classic Book Serif)", stack: "Georgia, 'Times New Roman', serif" },
  { value: "Merriweather", label: "Merriweather (Editorial Serif)", stack: "'Merriweather', Georgia, serif" },
  { value: "Segoe UI", label: "Clean Sans (Modern Editorial)", stack: "'Segoe UI', system-ui, -apple-system, sans-serif" },
  { value: "Verdana", label: "Verdana (Children's Clarity)", stack: "Verdana, Geneva, sans-serif" },
];

export function getTemplatePreset(id: BookTemplateId): BookTemplatePreset {
  return BOOK_TEMPLATES.find((t) => t.id === id) ?? BOOK_TEMPLATES[0]!;
}

export function detectTextDirection(text: string): BookDirection {
  const rtlMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? [];
  const ltrMatches = text.match(/[A-Za-z]/g) ?? [];
  return rtlMatches.length >= ltrMatches.length && rtlMatches.length > 0 ? "rtl" : "ltr";
}

export function defaultRightsNotice(dir: BookDirection): string {
  if (dir === "rtl") {
    return "ملاحظة الحقوق والترخيص: يحتوي هذا الكتاب على نصوص و/أو صور مولّدة بالذكاء الاصطناعي. تقع على عاتق المؤلف مسؤولية التحقق من شروط ترخيص مزوّد النماذج والخطوط والصور قبل أي استخدام أو بيع تجاري.";
  }
  return "Licensing & Rights Notice: This book may include AI-generated text and/or illustrations. Commercial distribution rights depend on the licensing terms of the underlying AI providers, fonts, and third-party assets used. Verify all licenses before commercial publication.";
}

export function buildChaptersFromStory(
  storyName: string,
  script: string,
  images: StoryAssetImage[],
  dir: BookDirection,
): BookChapter[] {
  const cleanScript = script.trim();
  const rawSections = cleanScript
    ? cleanScript
        .split(/\n{2,}|(?=^(?:Chapter|CHAPTER|Scene|SCENE|الفصل|المشهد)\s+[\d٠-٩]+)/m)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const chapterCount = Math.max(
    1,
    Math.min(
      30,
      rawSections.length > 0
        ? rawSections.length
        : images.length > 0
          ? Math.ceil(images.length / 2)
          : 1,
    ),
  );

  const chapters: BookChapter[] = [];
  for (let i = 0; i < chapterCount; i += 1) {
    const raw = rawSections[i] ?? "";
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    let title =
      dir === "rtl" ? `الفصل ${i + 1}` : `Chapter ${i + 1}`;
    let body = raw;
    if (lines.length > 1 && lines[0]!.length <= 85) {
      title = lines[0]!.replace(/^#+\s*/, "");
      body = lines.slice(1).join("\n\n");
    } else if (i === 0 && chapterCount === 1 && storyName) {
      title = storyName;
    }

    chapters.push({
      id: `ch_${i + 1}`,
      title,
      body,
      images: [],
    });
  }

  // Distribute story images evenly across chapters in scene order
  if (images.length > 0) {
    images.forEach((img, idx) => {
      const targetIdx = Math.min(
        chapters.length - 1,
        Math.floor((idx * chapters.length) / images.length),
      );
      chapters[targetIdx]!.images.push({
        imageId: img.id,
        storyId: img.storyId,
        url: img.url,
        caption: img.prompt ? img.prompt.slice(0, 120) : "",
      });
    });
  }

  return chapters;
}

export class BookApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function bookRequest<T>(
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
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new BookApiError(
      typeof data.error === "string" ? data.error : "Book request failed.",
      typeof data.code === "string" ? data.code : "book_request_failed",
      resp.status,
    );
  }
  return data as T;
}

export async function fetchSavedBooks(
  idToken: string,
): Promise<SavedBookProject[]> {
  const data = await bookRequest<{ books: SavedBookProject[] }>(
    "/api/books",
    idToken,
  );
  return data.books;
}

export async function createSavedBook(
  idToken: string,
  payload: Omit<SavedBookProject, "id" | "exportCount" | "lastExportedAt" | "lastExportPageCount" | "createdAt" | "updatedAt">,
): Promise<SavedBookProject> {
  const data = await bookRequest<{ book: SavedBookProject }>(
    "/api/books",
    idToken,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return data.book;
}

export async function updateSavedBook(
  idToken: string,
  bookId: string,
  payload: Partial<SavedBookProject>,
): Promise<SavedBookProject> {
  const data = await bookRequest<{ book: SavedBookProject }>(
    `/api/books/${encodeURIComponent(bookId)}`,
    idToken,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.book;
}

export async function markBookExported(
  idToken: string,
  bookId: string,
  pageCount: number,
): Promise<SavedBookProject> {
  const data = await bookRequest<{ book: SavedBookProject }>(
    `/api/books/${encodeURIComponent(bookId)}/exported`,
    idToken,
    { method: "POST", body: JSON.stringify({ pageCount }) },
  );
  return data.book;
}

export async function deleteSavedBookApi(
  idToken: string,
  bookId: string,
): Promise<void> {
  await bookRequest(`/api/books/${encodeURIComponent(bookId)}`, idToken, {
    method: "DELETE",
  });
}

export async function fetchStoryBookAssets(
  idToken: string,
  storyId: string,
): Promise<StoryAssetsResponse> {
  return bookRequest(
    `/api/books/stories/${encodeURIComponent(storyId)}/assets`,
    idToken,
  );
}

export async function fetchStoryImageBlobUrl(
  idToken: string,
  storyId: string,
  imageId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      `/api/books/stories/${encodeURIComponent(storyId)}/images/${encodeURIComponent(imageId)}/raw`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
