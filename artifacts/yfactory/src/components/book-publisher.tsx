import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Layers,
  LoaderCircle,
  Palette,
  Plus,
  Printer,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  BOOK_TEMPLATES,
  BookApiError,
  buildChaptersFromStory,
  createSavedBook,
  defaultRightsNotice,
  deleteSavedBookApi,
  detectTextDirection,
  fetchSavedBooks,
  fetchStoryBookAssets,
  FONT_OPTIONS,
  getTemplatePreset,
  markBookExported,
  PAGE_SIZE_SPECS,
  updateSavedBook,
  type BookChapter,
  type BookCoverStyle,
  type BookDirection,
  type BookFontSize,
  type BookImageLayout,
  type BookMarginPreset,
  type BookPageSize,
  type BookTemplateId,
  type SavedBookProject,
  type StoryAssetImage,
} from "@/lib/bookApi";
import {
  exportDirectBookPdf,
  openPrintFriendlyBookPdf,
  paginateBook,
  type BookDraftInput,
} from "@/lib/bookPdfEngine";
import { isRtlLanguage } from "@/lib/languages";
import { subscribeToStories, type StoryRecord } from "@/lib/stories";
import "./book-publisher.css";

type BookPublisherProps = {
  uid: string;
  locale: string;
  authorDefaultName: string;
  initialStory: StoryRecord | null;
  getIdToken: () => Promise<string>;
};

type EditorTab = "setup" | "chapters" | "design" | "preview" | "saved";

function makeInitialDraft(
  locale: string,
  authorDefaultName: string,
): BookDraftInput {
  const dir: BookDirection = isRtlLanguage(locale) ? "rtl" : "ltr";
  const preset = getTemplatePreset("fantasy");
  return {
    storyId: null,
    storyName: "",
    title: dir === "rtl" ? "كتابي المصوّر الجديد" : "My New Illustrated Book",
    subtitle: "",
    authorName: authorDefaultName || "",
    coverImageUrl: null,
    coverImageId: null,
    copyrightText:
      dir === "rtl"
        ? `جميع الحقوق محفوظة © ${new Date().getFullYear()} ${authorDefaultName || "المؤلف"}.`
        : `Copyright © ${new Date().getFullYear()} ${authorDefaultName || "Author"}. All rights reserved.`,
    rightsNotice: defaultRightsNotice(dir),
    includeIntro: true,
    introTitle: dir === "rtl" ? "مقدمة" : "Introduction",
    introText: "",
    includeToc: true,
    chapters: [
      {
        id: "ch_1",
        title: dir === "rtl" ? "الفصل الأول" : "Chapter 1",
        body: "",
        images: [],
      },
    ],
    design: {
      template: preset.id,
      pageSize: "a4",
      fontFamily: dir === "rtl" ? preset.fontRtl : preset.fontLtr,
      marginPreset: "standard",
      fontSize: "medium",
      imageLayout: "top",
      coverStyle: preset.coverStyle,
      accentColor: preset.accentColor,
      paperColor: preset.paperColor,
      textColor: preset.textColor,
      direction: dir,
      showPageNumbers: true,
      showRunningHeader: true,
      highQualityImages: true,
    },
  };
}

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "ناشر كتب PDF الاحترافية",
      subtitle:
        "حوّل قصصك وصورك في My Stories إلى كتاب منشور متكامل (غلاف، حقوق، مقدمة، فهرس، فصول، ترقيم صفحات) بدعم كامل للعربية RTL والإنجليزية LTR.",
      tabSetup: "الغلاف والبنية",
      tabChapters: "الفصول والصور",
      tabDesign: "القوالب والتصميم",
      tabPreview: "المعاينة والتصدير",
      tabSaved: "كتبي المحفوظة",
      importStoryLbl: "استيراد قصة من قصصي (My Stories)",
      pickStoryPh: "— اختر قصة لتحويلها إلى كتاب —",
      loadStoryBtn: "استيراد القصة والصور",
      loadingStory: "جارٍ استيراد نص وصور القصة...",
      storyLoaded: (n: number) => `تم استيراد القصة و${n} صورة بنجاح وتوزيعها على الفصول.`,
      bookTitleLbl: "عنوان الكتاب",
      subtitleLbl: "العنوان الفرعي (اختياري)",
      authorLbl: "اسم المؤلف",
      coverImgLbl: "صورة الغلاف الأمامي",
      noCover: "غلاف طباعي بدون صورة",
      copyrightLbl: "نص صفحة حقوق النشر",
      rightsLbl: "ملاحظة التراخيص والحقوق (شفافية قانونية)",
      includeIntro: "تضمين صفحة مقدمة اختيارية",
      introTitleLbl: "عنوان المقدمة",
      introBodyLbl: "نص المقدمة",
      includeToc: "تضمين فهرس المحتويات (TOC) بأرقام صفحات تلقائية",
      addChapter: "إضافة فصل جديد",
      chapterTitleLbl: "عنوان الفصل",
      chapterBodyLbl: "نص الفصل",
      chapterImgsLbl: "صور الفصل (مرتّبة):",
      addStoryImgLbl: "إضافة صورة من القصة لهذا الفصل",
      templatesLbl: "قوالب الكتب الستة",
      pageSizeLbl: "حجم الصفحات",
      fontLbl: "الخط",
      marginLbl: "الهوامش",
      textSizeLbl: "حجم النصوص",
      imgLayoutLbl: "ترتيب الصور",
      coverStyleLbl: "تصميم الغلاف",
      dirLbl: "اتجاه الكتاب واللغة",
      accentLbl: "لون التمييز",
      paperLbl: "لون الورق",
      textColorLbl: "لون النص",
      optPageNums: "إظهار ترقيم الصفحات",
      optHeader: "إظهار الترويسة العلوية",
      optHiRes: "صور عالية الجودة (High Quality Images)",
      saveBtn: "حفظ في حسابي",
      savingBtn: "جارٍ الحفظ...",
      savedOk: "تم حفظ الكتاب في حسابك! يمكنك تعديله وإعادة تصديره في أي وقت.",
      exportPdfBtn: "تنزيل ملف PDF مباشر",
      exportingPdf: (c: number, t: number) => `جارٍ تجهيز صفحة ${c} من ${t}...`,
      printPdfBtn: "طباعة / PDF متجهي عالي الدقة",
      exportedOk: (p: number, mb: string) => `تم تصدير كتاب PDF بنجاح (${p} صفحة · ${mb} MB).`,
      pageOf: (c: number, t: number) => `صفحة ${c} من ${t}`,
      prevPage: "السابقة",
      nextPage: "التالية",
      noSaved: "لا توجد كتب محفوظة بعد. اضغط «حفظ في حسابي» لحفظ كتابك وتعديله وإعادة تصديره لاحقاً.",
      openEdit: "فتح وتعديل",
      delBook: "حذف",
      newBook: "كتاب جديد",
    };
  }
  return {
    title: "Professional PDF Book Publisher",
    subtitle:
      "Transform your My Stories scripts and illustrations into a print-ready book with Cover, Copyright, Intro, Table of Contents, Chapters, and Page Numbers (Arabic RTL & English LTR).",
    tabSetup: "Cover & Structure",
    tabChapters: "Chapters & Images",
    tabDesign: "Templates & Design",
    tabPreview: "Preview & Export",
    tabSaved: "Saved Books",
    importStoryLbl: "Import from My Stories",
    pickStoryPh: "— Select a story to convert into a book —",
    loadStoryBtn: "Load Story & Images",
    loadingStory: "Loading story script & illustrations...",
    storyLoaded: (n: number) => `Imported story and ${n} illustration(s) into editable chapters.`,
    bookTitleLbl: "Book Title",
    subtitleLbl: "Subtitle (optional)",
    authorLbl: "Author Name",
    coverImgLbl: "Front Cover Image",
    noCover: "Typographic cover (no image)",
    copyrightLbl: "Copyright Page Text",
    rightsLbl: "Licensing & Rights Disclaimer",
    includeIntro: "Include optional Introduction page",
    introTitleLbl: "Introduction Heading",
    introBodyLbl: "Introduction Text",
    includeToc: "Include automatic Table of Contents (TOC)",
    addChapter: "Add Chapter",
    chapterTitleLbl: "Chapter Title",
    chapterBodyLbl: "Chapter Text",
    chapterImgsLbl: "Chapter Images (ordered):",
    addStoryImgLbl: "Attach a story image to this chapter",
    templatesLbl: "Six Book Templates",
    pageSizeLbl: "Page Size",
    fontLbl: "Font Family",
    marginLbl: "Margins",
    textSizeLbl: "Text Size",
    imgLayoutLbl: "Image Layout",
    coverStyleLbl: "Cover Design",
    dirLbl: "Book Direction",
    accentLbl: "Accent Color",
    paperLbl: "Paper Color",
    textColorLbl: "Text Color",
    optPageNums: "Show page numbers",
    optHeader: "Show running header",
    optHiRes: "High-quality image embedding",
    saveBtn: "Save to Account",
    savingBtn: "Saving...",
    savedOk: "Book saved to your account. You can edit and re-export it anytime.",
    exportPdfBtn: "Download Direct PDF",
    exportingPdf: (c: number, t: number) => `Rendering page ${c} of ${t}...`,
    printPdfBtn: "Print / Vector PDF",
    exportedOk: (p: number, mb: string) => `PDF book exported (${p} pages · ${mb} MB).`,
    pageOf: (c: number, t: number) => `Page ${c} of ${t}`,
    prevPage: "Previous",
    nextPage: "Next",
    noSaved: "No saved books yet. Click Save to Account to keep editable versions for re-export.",
    openEdit: "Edit & Re-export",
    delBook: "Delete",
    newBook: "New Book",
  };
}

export default function BookPublisher({
  uid,
  locale,
  authorDefaultName,
  initialStory,
  getIdToken,
}: BookPublisherProps) {
  const isRtl = isRtlLanguage(locale);
  const isAr = locale.startsWith("ar");
  const ui = getCopy(locale);

  const [tab, setTab] = useState<EditorTab>("setup");
  const [stories, setStories] = useState<StoryRecord[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string>(
    initialStory?.id ?? "",
  );
  const [storyImages, setStoryImages] = useState<StoryAssetImage[]>([]);
  const [loadingStory, setLoadingStory] = useState(false);

  const [savedBooks, setSavedBooks] = useState<SavedBookProject[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookDraftInput>(() =>
    makeInitialDraft(locale, authorDefaultName),
  );

  const [previewIdx, setPreviewIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    cur: number;
    tot: number;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = subscribeToStories(
      uid,
      (items) => setStories(items),
      () => setStories([]),
    );
    return () => unsub();
  }, [uid]);

  const loadSavedBooksList = useCallback(async () => {
    try {
      const tok = await getIdToken();
      const list = await fetchSavedBooks(tok);
      setSavedBooks(list);
    } catch {
      // ignore transient load failure
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadSavedBooksList();
  }, [loadSavedBooksList]);

  const importStoryIntoBook = useCallback(
    async (storyId: string) => {
      if (!storyId) return;
      setLoadingStory(true);
      setError("");
      setNotice("");
      try {
        const tok = await getIdToken();
        const assets = await fetchStoryBookAssets(tok, storyId);
        setStoryImages(assets.images);
        const dir = detectTextDirection(`${assets.storyName} ${assets.script}`);
        const preset = getTemplatePreset(draft.design.template);
        const chapters = buildChaptersFromStory(
          assets.storyName,
          assets.script,
          assets.images,
          dir,
        );
        const firstImg = assets.images[0] ?? null;

        setActiveBookId(null);
        setDraft((prev) => ({
          ...prev,
          storyId: assets.storyId,
          storyName: assets.storyName,
          title: assets.storyName,
          coverImageUrl: firstImg?.url ?? null,
          coverImageId: firstImg?.id ?? null,
          copyrightText:
            dir === "rtl"
              ? `جميع الحقوق محفوظة © ${new Date().getFullYear()} ${prev.authorName || authorDefaultName || "المؤلف"}.`
              : `Copyright © ${new Date().getFullYear()} ${prev.authorName || authorDefaultName || "Author"}. All rights reserved.`,
          rightsNotice: defaultRightsNotice(dir),
          introTitle: dir === "rtl" ? "مقدمة" : "Introduction",
          chapters,
          design: {
            ...prev.design,
            direction: dir,
            fontFamily: dir === "rtl" ? preset.fontRtl : preset.fontLtr,
          },
        }));
        setPreviewIdx(0);
        setNotice(ui.storyLoaded(assets.images.length));
      } catch (err) {
        setError(
          err instanceof BookApiError
            ? err.message
            : "Could not load story assets.",
        );
      } finally {
        setLoadingStory(false);
      }
    },
    [getIdToken, draft.design.template, authorDefaultName, ui],
  );

  // Auto-load currently selected story if user opened Publisher while viewing a story
  useEffect(() => {
    if (initialStory?.id && !draft.storyId && !activeBookId) {
      setSelectedStoryId(initialStory.id);
      void importStoryIntoBook(initialStory.id);
    }
  }, [initialStory?.id]);

  const pages = useMemo(() => paginateBook(draft), [draft]);
  const safePreviewIdx = Math.min(previewIdx, Math.max(0, pages.length - 1));
  const currentPage = pages[safePreviewIdx] ?? pages[0]!;
  const activePreset = getTemplatePreset(draft.design.template);

  const applyTemplate = (tplId: BookTemplateId) => {
    const p = getTemplatePreset(tplId);
    setDraft((prev) => ({
      ...prev,
      design: {
        ...prev.design,
        template: p.id,
        accentColor: p.accentColor,
        paperColor: p.paperColor,
        textColor: p.textColor,
        coverStyle: p.coverStyle,
        fontFamily: prev.design.direction === "rtl" ? p.fontRtl : p.fontLtr,
      },
    }));
  };

  const handleSaveBook = async (): Promise<string | null> => {
    if (saving) return activeBookId;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      const saved = activeBookId
        ? await updateSavedBook(tok, activeBookId, draft)
        : await createSavedBook(tok, draft);
      setActiveBookId(saved.id);
      setSavedBooks((prev) => [
        saved,
        ...prev.filter((b) => b.id !== saved.id),
      ]);
      setNotice(ui.savedOk);
      return saved.id;
    } catch (err) {
      setError(
        err instanceof BookApiError ? err.message : "Could not save book.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleExportDirectPdf = async () => {
    if (exportProgress) return;
    setError("");
    setNotice("");
    try {
      const tok = await getIdToken();
      setExportProgress({ cur: 1, tot: pages.length });
      const res = await exportDirectBookPdf(draft, tok, (cur, tot) =>
        setExportProgress({ cur, tot }),
      );
      const mb = (res.sizeBytes / (1024 * 1024)).toFixed(2);
      setNotice(ui.exportedOk(res.pageCount, mb));
      if (activeBookId) {
        const up = await markBookExported(tok, activeBookId, res.pageCount).catch(
          () => null,
        );
        if (up) {
          setSavedBooks((prev) => prev.map((b) => (b.id === up.id ? up : b)));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setExportProgress(null);
    }
  };

  const handlePrintVectorPdf = async () => {
    setError("");
    const totalPages = openPrintFriendlyBookPdf(draft);
    if (activeBookId) {
      try {
        const tok = await getIdToken();
        const up = await markBookExported(tok, activeBookId, totalPages);
        setSavedBooks((prev) => prev.map((b) => (b.id === up.id ? up : b)));
      } catch {
        // ignore
      }
    }
  };

  const handleOpenSavedBook = async (book: SavedBookProject) => {
    setActiveBookId(book.id);
    setSelectedStoryId(book.storyId ?? "");
    setDraft({
      storyId: book.storyId,
      storyName: book.storyName,
      title: book.title,
      subtitle: book.subtitle,
      authorName: book.authorName,
      coverImageUrl: book.coverImageUrl,
      coverImageId: book.coverImageId,
      copyrightText: book.copyrightText,
      rightsNotice: book.rightsNotice,
      includeIntro: book.includeIntro,
      introTitle: book.introTitle,
      introText: book.introText,
      includeToc: book.includeToc,
      chapters: book.chapters,
      design: book.design,
    });
    setPreviewIdx(0);
    setTab("setup");
    setNotice("");
    if (book.storyId) {
      try {
        const tok = await getIdToken();
        const assets = await fetchStoryBookAssets(tok, book.storyId);
        setStoryImages(assets.images);
      } catch {
        setStoryImages([]);
      }
    }
  };

  const handleDeleteSavedBook = async (bookId: string) => {
    try {
      const tok = await getIdToken();
      await deleteSavedBookApi(tok, bookId);
      setSavedBooks((prev) => prev.filter((b) => b.id !== bookId));
      if (activeBookId === bookId) setActiveBookId(null);
    } catch {
      setError("Could not delete saved book.");
    }
  };

  const updateChapter = (idx: number, patch: Partial<BookChapter>) => {
    setDraft((prev) => ({
      ...prev,
      chapters: prev.chapters.map((ch, i) =>
        i === idx ? { ...ch, ...patch } : ch,
      ),
    }));
  };

  const moveChapter = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= draft.chapters.length) return;
    setDraft((prev) => {
      const next = [...prev.chapters];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item!);
      return { ...prev, chapters: next };
    });
  };

  const moveChapterImage = (chIdx: number, imgIdx: number, delta: -1 | 1) => {
    const ch = draft.chapters[chIdx];
    if (!ch) return;
    const target = imgIdx + delta;
    if (target < 0 || target >= ch.images.length) return;
    const nextImgs = [...ch.images];
    const [item] = nextImgs.splice(imgIdx, 1);
    nextImgs.splice(target, 0, item!);
    updateChapter(chIdx, { images: nextImgs });
  };

  return (
    <section
      className="bp-root"
      dir={isRtl ? "rtl" : "ltr"}
      aria-label={ui.title}
      data-testid="book-publisher"
    >
      <header className="bp-header">
        <div className="bp-head-row">
          <div className="bp-title-block">
            <span className="bp-icon-box" aria-hidden="true">
              <BookMarked size={22} />
            </span>
            <div>
              <h1>{ui.title}</h1>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          <div className="bp-row">
            <button
              type="button"
              className="bp-btn"
              disabled={saving}
              onClick={() => void handleSaveBook()}
              data-testid="button-book-save"
            >
              {saving ? (
                <LoaderCircle className="loading-spinner" size={14} />
              ) : (
                <Save size={14} />
              )}
              <span>{saving ? ui.savingBtn : ui.saveBtn}</span>
            </button>
            <button
              type="button"
              className="bp-btn is-primary"
              disabled={Boolean(exportProgress)}
              onClick={() => void handleExportDirectPdf()}
              data-testid="button-book-export-pdf"
            >
              {exportProgress ? (
                <LoaderCircle className="loading-spinner" size={14} />
              ) : (
                <Download size={14} />
              )}
              <span>
                {exportProgress
                  ? ui.exportingPdf(exportProgress.cur, exportProgress.tot)
                  : ui.exportPdfBtn}
              </span>
            </button>
          </div>
        </div>

        <nav className="bp-tabs" role="tablist">
          {(
            [
              ["setup", ui.tabSetup, <BookOpen size={14} key="s" />],
              ["chapters", `${ui.tabChapters} (${draft.chapters.length})`, <FileText size={14} key="c" />],
              ["design", ui.tabDesign, <Palette size={14} key="d" />],
              ["preview", `${ui.tabPreview} (${pages.length})`, <Eye size={14} key="p" />],
              ["saved", `${ui.tabSaved} (${savedBooks.length})`, <Layers size={14} key="v" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`bp-tab${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
              data-testid={`book-tab-${id}`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      {notice && (
        <div className="bp-notice-ok" role="status">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="bp-notice-err" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: COVER & STRUCTURE */}
      {tab === "setup" && (
        <div className="bp-panel">
          <div className="bp-field">
            <label htmlFor="bp-story-select">{ui.importStoryLbl}</label>
            <div className="bp-row">
              <select
                id="bp-story-select"
                className="bp-select"
                style={{ flex: 1 }}
                value={selectedStoryId}
                onChange={(e) => setSelectedStoryId(e.currentTarget.value)}
              >
                <option value="">{ui.pickStoryPh}</option>
                {stories.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.storyName} ({st.imageCount})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="bp-btn is-primary"
                disabled={!selectedStoryId || loadingStory}
                onClick={() => void importStoryIntoBook(selectedStoryId)}
                data-testid="button-book-import-story"
              >
                {loadingStory && (
                  <LoaderCircle className="loading-spinner" size={14} />
                )}
                <span>{loadingStory ? ui.loadingStory : ui.loadStoryBtn}</span>
              </button>
            </div>
          </div>

          <div className="bp-grid-2">
            <div className="bp-field">
              <label>{ui.bookTitleLbl}</label>
              <input
                className="bp-input"
                dir="auto"
                maxLength={160}
                value={draft.title}
                onChange={(e) =>
                  setDraft({ ...draft, title: e.currentTarget.value })
                }
              />
            </div>
            <div className="bp-field">
              <label>{ui.authorLbl}</label>
              <input
                className="bp-input"
                dir="auto"
                maxLength={120}
                value={draft.authorName}
                onChange={(e) =>
                  setDraft({ ...draft, authorName: e.currentTarget.value })
                }
              />
            </div>
          </div>

          <div className="bp-grid-2">
            <div className="bp-field">
              <label>{ui.subtitleLbl}</label>
              <input
                className="bp-input"
                dir="auto"
                maxLength={220}
                value={draft.subtitle}
                onChange={(e) =>
                  setDraft({ ...draft, subtitle: e.currentTarget.value })
                }
              />
            </div>
            <div className="bp-field">
              <label>{ui.coverImgLbl}</label>
              <select
                className="bp-select"
                value={draft.coverImageId ?? ""}
                onChange={(e) => {
                  const chosen = storyImages.find(
                    (img) => img.id === e.currentTarget.value,
                  );
                  setDraft({
                    ...draft,
                    coverImageId: chosen?.id ?? null,
                    coverImageUrl: chosen?.url ?? null,
                  });
                }}
              >
                <option value="">{ui.noCover}</option>
                {storyImages.map((img, i) => (
                  <option key={img.id} value={img.id}>
                    #{i + 1} — {img.prompt.slice(0, 48) || img.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bp-field">
            <label>{ui.copyrightLbl}</label>
            <textarea
              className="bp-textarea"
              dir="auto"
              value={draft.copyrightText}
              onChange={(e) =>
                setDraft({ ...draft, copyrightText: e.currentTarget.value })
              }
            />
          </div>

          <div className="bp-field">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ShieldAlert size={14} />
              <span>{ui.rightsLbl}</span>
            </label>
            <textarea
              className="bp-textarea"
              dir="auto"
              value={draft.rightsNotice}
              onChange={(e) =>
                setDraft({ ...draft, rightsNotice: e.currentTarget.value })
              }
            />
          </div>

          <div className="bp-row">
            <label className="bp-check-row">
              <input
                type="checkbox"
                checked={draft.includeToc}
                onChange={(e) =>
                  setDraft({ ...draft, includeToc: e.currentTarget.checked })
                }
              />
              <span>{ui.includeToc}</span>
            </label>
            <label className="bp-check-row">
              <input
                type="checkbox"
                checked={draft.includeIntro}
                onChange={(e) =>
                  setDraft({ ...draft, includeIntro: e.currentTarget.checked })
                }
              />
              <span>{ui.includeIntro}</span>
            </label>
          </div>

          {draft.includeIntro && (
            <div className="bp-grid-2">
              <div className="bp-field">
                <label>{ui.introTitleLbl}</label>
                <input
                  className="bp-input"
                  dir="auto"
                  value={draft.introTitle}
                  onChange={(e) =>
                    setDraft({ ...draft, introTitle: e.currentTarget.value })
                  }
                />
              </div>
              <div className="bp-field" style={{ gridColumn: "1 / -1" }}>
                <label>{ui.introBodyLbl}</label>
                <textarea
                  className="bp-textarea"
                  dir="auto"
                  value={draft.introText}
                  onChange={(e) =>
                    setDraft({ ...draft, introText: e.currentTarget.value })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CHAPTERS & IMAGE ORDERING */}
      {tab === "chapters" && (
        <div className="bp-panel">
          <div className="bp-head-row">
            <strong>
              {ui.tabChapters} ({draft.chapters.length})
            </strong>
            <button
              type="button"
              className="bp-btn is-primary"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  chapters: [
                    ...prev.chapters,
                    {
                      id: `ch_${Date.now()}`,
                      title:
                        prev.design.direction === "rtl"
                          ? `الفصل ${prev.chapters.length + 1}`
                          : `Chapter ${prev.chapters.length + 1}`,
                      body: "",
                      images: [],
                    },
                  ],
                }))
              }
            >
              <Plus size={14} />
              <span>{ui.addChapter}</span>
            </button>
          </div>

          {draft.chapters.map((ch, idx) => (
            <article key={ch.id} className="bp-chapter-card">
              <div className="bp-head-row">
                <strong>
                  #{idx + 1} · {ch.title}
                </strong>
                <div className="bp-row">
                  <button
                    type="button"
                    className="bp-btn"
                    disabled={idx === 0}
                    onClick={() => moveChapter(idx, -1)}
                    aria-label="Move up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="bp-btn"
                    disabled={idx === draft.chapters.length - 1}
                    onClick={() => moveChapter(idx, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown size={13} />
                  </button>
                  {draft.chapters.length > 1 && (
                    <button
                      type="button"
                      className="bp-btn is-danger"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          chapters: prev.chapters.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="bp-field">
                <label>{ui.chapterTitleLbl}</label>
                <input
                  className="bp-input"
                  dir="auto"
                  value={ch.title}
                  onChange={(e) =>
                    updateChapter(idx, { title: e.currentTarget.value })
                  }
                />
              </div>

              <div className="bp-field">
                <label>{ui.chapterBodyLbl}</label>
                <textarea
                  className="bp-textarea"
                  dir="auto"
                  value={ch.body}
                  onChange={(e) =>
                    updateChapter(idx, { body: e.currentTarget.value })
                  }
                />
              </div>

              {ch.images.length > 0 && (
                <div className="bp-field">
                  <label>{ui.chapterImgsLbl}</label>
                  <div className="bp-img-strip">
                    {ch.images.map((img, iIdx) => (
                      <div key={`${img.imageId}-${iIdx}`} className="bp-img-thumb">
                        <img src={img.url} alt="" loading="lazy" />
                        <div className="bp-img-thumb-actions">
                          <button
                            type="button"
                            disabled={iIdx === 0}
                            onClick={() => moveChapterImage(idx, iIdx, -1)}
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            disabled={iIdx === ch.images.length - 1}
                            onClick={() => moveChapterImage(idx, iIdx, 1)}
                          >
                            ▶
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateChapter(idx, {
                                images: ch.images.filter((_, k) => k !== iIdx),
                              })
                            }
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {storyImages.length > 0 && (
                <select
                  className="bp-select"
                  value=""
                  onChange={(e) => {
                    const picked = storyImages.find(
                      (s) => s.id === e.currentTarget.value,
                    );
                    if (!picked) return;
                    updateChapter(idx, {
                      images: [
                        ...ch.images,
                        {
                          imageId: picked.id,
                          storyId: picked.storyId,
                          url: picked.url,
                          caption: picked.prompt.slice(0, 120),
                        },
                      ],
                    });
                  }}
                >
                  <option value="">+ {ui.addStoryImgLbl}</option>
                  {storyImages.map((img, sIdx) => (
                    <option key={img.id} value={img.id}>
                      #{sIdx + 1} — {img.prompt.slice(0, 50) || img.id}
                    </option>
                  ))}
                </select>
              )}
            </article>
          ))}
        </div>
      )}

      {/* TAB 3: 6 TEMPLATES & DESIGN SETTINGS */}
      {tab === "design" && (
        <div className="bp-panel">
          <div className="bp-field">
            <label>{ui.templatesLbl}</label>
            <div className="bp-template-grid">
              {BOOK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`bp-template-card${
                    draft.design.template === tpl.id ? " is-selected" : ""
                  }`}
                  onClick={() => applyTemplate(tpl.id)}
                  data-testid={`book-template-${tpl.id}`}
                >
                  <div className="bp-swatch-row">
                    <span
                      className="bp-swatch"
                      style={{ background: tpl.coverBg }}
                    />
                    <span
                      className="bp-swatch"
                      style={{ background: tpl.accentColor }}
                    />
                    <span
                      className="bp-swatch"
                      style={{ background: tpl.paperColor }}
                    />
                  </div>
                  <strong style={{ fontSize: 13.5 }}>
                    {isAr ? tpl.nameAr : tpl.nameEn}
                  </strong>
                  <small style={{ color: "var(--app-secondary)", fontSize: 11.5 }}>
                    {isAr ? tpl.descAr : tpl.descEn}
                  </small>
                </button>
              ))}
            </div>
          </div>

          <div className="bp-grid-2">
            <div className="bp-field">
              <label>{ui.dirLbl}</label>
              <select
                className="bp-select"
                value={draft.design.direction}
                onChange={(e) => {
                  const dir = e.currentTarget.value as BookDirection;
                  setDraft({
                    ...draft,
                    design: { ...draft.design, direction: dir },
                  });
                }}
              >
                <option value="rtl">Arabic / RTL (من اليمين لليسار)</option>
                <option value="ltr">English / LTR (Left-to-Right)</option>
              </select>
            </div>

            <div className="bp-field">
              <label>{ui.pageSizeLbl}</label>
              <select
                className="bp-select"
                value={draft.design.pageSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      pageSize: e.currentTarget.value as BookPageSize,
                    },
                  })
                }
              >
                {(Object.keys(PAGE_SIZE_SPECS) as BookPageSize[]).map((k) => (
                  <option key={k} value={k}>
                    {isAr
                      ? PAGE_SIZE_SPECS[k].labelAr
                      : PAGE_SIZE_SPECS[k].labelEn}
                  </option>
                ))}
              </select>
            </div>

            <div className="bp-field">
              <label>{ui.fontLbl}</label>
              <select
                className="bp-select"
                value={draft.design.fontFamily}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      fontFamily: e.currentTarget.value,
                    },
                  })
                }
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="bp-field">
              <label>{ui.marginLbl}</label>
              <select
                className="bp-select"
                value={draft.design.marginPreset}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      marginPreset: e.currentTarget.value as BookMarginPreset,
                    },
                  })
                }
              >
                <option value="narrow">{isAr ? "ضيق" : "Narrow"}</option>
                <option value="standard">{isAr ? "قياسي للنشر" : "Standard Book"}</option>
                <option value="wide">{isAr ? "واسع فاخر" : "Wide Editorial"}</option>
              </select>
            </div>

            <div className="bp-field">
              <label>{ui.textSizeLbl}</label>
              <select
                className="bp-select"
                value={draft.design.fontSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      fontSize: e.currentTarget.value as BookFontSize,
                    },
                  })
                }
              >
                <option value="small">{isAr ? "صغير" : "Small"}</option>
                <option value="medium">{isAr ? "متوسط" : "Medium"}</option>
                <option value="large">{isAr ? "كبير" : "Large"}</option>
              </select>
            </div>

            <div className="bp-field">
              <label>{ui.imgLayoutLbl}</label>
              <select
                className="bp-select"
                value={draft.design.imageLayout}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      imageLayout: e.currentTarget.value as BookImageLayout,
                    },
                  })
                }
              >
                <option value="top">{isAr ? "الصورة أعلى الصفحة" : "Image Top"}</option>
                <option value="bottom">{isAr ? "الصورة أسفل الصفحة" : "Image Bottom"}</option>
                <option value="alternating">{isAr ? "متناوب" : "Alternating"}</option>
                <option value="full_page">{isAr ? "صفحة مستقلة لكل صورة" : "Dedicated Full-Page Images"}</option>
              </select>
            </div>

            <div className="bp-field">
              <label>{ui.coverStyleLbl}</label>
              <select
                className="bp-select"
                value={draft.design.coverStyle}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      coverStyle: e.currentTarget.value as BookCoverStyle,
                    },
                  })
                }
              >
                <option value="ornate_gold">{isAr ? "إطار ذهبي مزخرف" : "Ornate Gold Frame"}</option>
                <option value="classic_framed">{isAr ? "غلاف كلاسيكي بإطار" : "Classic Framed"}</option>
                <option value="full_bleed">{isAr ? "صورة كاملة على الغلاف" : "Full-Bleed Artwork"}</option>
                <option value="minimal_editorial">{isAr ? "تحريري عصري" : "Minimal Editorial"}</option>
              </select>
            </div>
          </div>

          <div className="bp-grid-2">
            <div className="bp-field">
              <label>{ui.accentLbl}</label>
              <input
                type="color"
                className="bp-input"
                value={draft.design.accentColor}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: { ...draft.design, accentColor: e.currentTarget.value },
                  })
                }
              />
            </div>
            <div className="bp-field">
              <label>{ui.paperLbl}</label>
              <input
                type="color"
                className="bp-input"
                value={draft.design.paperColor}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: { ...draft.design, paperColor: e.currentTarget.value },
                  })
                }
              />
            </div>
            <div className="bp-field">
              <label>{ui.textColorLbl}</label>
              <input
                type="color"
                className="bp-input"
                value={draft.design.textColor}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: { ...draft.design, textColor: e.currentTarget.value },
                  })
                }
              />
            </div>
          </div>

          <div className="bp-row">
            <label className="bp-check-row">
              <input
                type="checkbox"
                checked={draft.design.showPageNumbers}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      showPageNumbers: e.currentTarget.checked,
                    },
                  })
                }
              />
              <span>{ui.optPageNums}</span>
            </label>
            <label className="bp-check-row">
              <input
                type="checkbox"
                checked={draft.design.showRunningHeader}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      showRunningHeader: e.currentTarget.checked,
                    },
                  })
                }
              />
              <span>{ui.optHeader}</span>
            </label>
            <label className="bp-check-row">
              <input
                type="checkbox"
                checked={draft.design.highQualityImages}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    design: {
                      ...draft.design,
                      highQualityImages: e.currentTarget.checked,
                    },
                  })
                }
              />
              <span>{ui.optHiRes}</span>
            </label>
          </div>
        </div>
      )}

      {/* TAB 4: LIVE PREVIEW & PDF EXPORT */}
      {tab === "preview" && (
        <div className="bp-panel">
          <div className="bp-head-row">
            <strong>{ui.pageOf(safePreviewIdx + 1, pages.length)}</strong>
            <div className="bp-row">
              <button
                type="button"
                className="bp-btn"
                onClick={() => void handlePrintVectorPdf()}
                data-testid="button-book-print-pdf"
              >
                <Printer size={14} />
                <span>{ui.printPdfBtn}</span>
              </button>
              <button
                type="button"
                className="bp-btn is-primary"
                disabled={Boolean(exportProgress)}
                onClick={() => void handleExportDirectPdf()}
              >
                <Download size={14} />
                <span>{ui.exportPdfBtn}</span>
              </button>
            </div>
          </div>

          <div className="bp-preview-stage">
            <div
              className={`bp-page-sheet${
                draft.design.pageSize === "square_8x8" ? " is-square" : ""
              }`}
              dir={draft.design.direction}
              style={{
                background:
                  currentPage.kind === "cover"
                    ? activePreset.coverBg
                    : draft.design.paperColor,
                color:
                  currentPage.kind === "cover"
                    ? activePreset.coverText
                    : draft.design.textColor,
                fontFamily:
                  FONT_OPTIONS.find((f) => f.value === draft.design.fontFamily)
                    ?.stack ?? "serif",
              }}
            >
              {currentPage.kind === "cover" && (
                <div
                  className="bp-cover-frame"
                  style={{ borderColor: draft.design.accentColor }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: 21 }}>{draft.title}</h2>
                    {draft.subtitle && (
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 12,
                          color: draft.design.accentColor,
                        }}
                      >
                        {draft.subtitle}
                      </p>
                    )}
                  </div>
                  {draft.coverImageUrl && (
                    <img
                      className="bp-cover-img"
                      src={draft.coverImageUrl}
                      alt=""
                      style={{ borderColor: draft.design.accentColor }}
                    />
                  )}
                  <div>
                    {draft.authorName && (
                      <strong style={{ fontSize: 13 }}>{draft.authorName}</strong>
                    )}
                    <div style={{ fontSize: 9.5, opacity: 0.65 }}>
                      YFactory Publishing Studio
                    </div>
                  </div>
                </div>
              )}

              {currentPage.kind === "copyright" && (
                <div style={{ marginTop: "auto", marginBottom: "auto", fontSize: 11.5 }}>
                  <h3 style={{ margin: "0 0 6px" }}>{draft.title}</h3>
                  {draft.authorName && <p style={{ margin: "0 0 12px" }}>{draft.authorName}</p>}
                  <p style={{ lineHeight: 1.6 }}>{draft.copyrightText}</p>
                  {draft.rightsNotice && (
                    <p
                      style={{
                        fontSize: 10.5,
                        color: draft.design.accentColor,
                        lineHeight: 1.55,
                      }}
                    >
                      {draft.rightsNotice}
                    </p>
                  )}
                </div>
              )}

              {currentPage.kind === "intro" && (
                <>
                  <div style={{ overflow: "hidden" }}>
                    <h3
                      style={{
                        margin: "0 0 10px",
                        color: draft.design.accentColor,
                        fontSize: 17,
                      }}
                    >
                      {currentPage.title}
                    </h3>
                    {currentPage.paragraphs.map((p, i) => (
                      <p key={i} style={{ fontSize: 12, lineHeight: 1.65 }}>
                        {p}
                      </p>
                    ))}
                  </div>
                  {draft.design.showPageNumbers && (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: draft.design.accentColor,
                      }}
                    >
                      {currentPage.pageNumber}
                    </div>
                  )}
                </>
              )}

              {currentPage.kind === "toc" && (
                <>
                  <div>
                    <h3
                      style={{
                        margin: "0 0 12px",
                        color: draft.design.accentColor,
                        fontSize: 17,
                      }}
                    >
                      {draft.design.direction === "rtl"
                        ? "فهرس المحتويات"
                        : "Table of Contents"}
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {currentPage.entries.map((entry) => (
                        <div
                          key={entry.index}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            borderBottom: "1px solid rgba(0,0,0,0.09)",
                            paddingBottom: 4,
                          }}
                        >
                          <span>
                            {entry.index}. {entry.title}
                          </span>
                          <strong style={{ color: draft.design.accentColor }}>
                            {entry.startPage}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  {draft.design.showPageNumbers && (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: draft.design.accentColor,
                      }}
                    >
                      {currentPage.pageNumber}
                    </div>
                  )}
                </>
              )}

              {currentPage.kind === "full_image" && (
                <>
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <img
                      src={currentPage.image.url}
                      alt=""
                      style={{
                        maxWidth: "100%",
                        maxHeight: "82%",
                        borderRadius: 8,
                        objectFit: "contain",
                      }}
                    />
                    {currentPage.image.caption && (
                      <small style={{ opacity: 0.7, textAlign: "center", fontSize: 10 }}>
                        {currentPage.image.caption}
                      </small>
                    )}
                  </div>
                  {draft.design.showPageNumbers && (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: draft.design.accentColor,
                      }}
                    >
                      {currentPage.pageNumber}
                    </div>
                  )}
                </>
              )}

              {currentPage.kind === "chapter" && (
                <>
                  <div style={{ overflow: "hidden", flex: 1 }}>
                    {currentPage.isChapterStart && (
                      <div style={{ marginBottom: 10 }}>
                        <small
                          style={{
                            color: draft.design.accentColor,
                            fontWeight: 700,
                            fontSize: 10,
                          }}
                        >
                          {draft.design.direction === "rtl"
                            ? `الفصل ${currentPage.chapterIndex}`
                            : `CHAPTER ${currentPage.chapterIndex}`}
                        </small>
                        <h3 style={{ margin: "2px 0 0", fontSize: 16 }}>
                          {currentPage.chapterTitle}
                        </h3>
                      </div>
                    )}
                    {currentPage.image && currentPage.imagePosition === "top" && (
                      <img
                        src={currentPage.image.url}
                        alt=""
                        style={{
                          width: "100%",
                          maxHeight: 150,
                          objectFit: "contain",
                          borderRadius: 8,
                          marginBottom: 8,
                        }}
                      />
                    )}
                    {currentPage.paragraphs.map((p, i) => (
                      <p
                        key={i}
                        style={{ margin: "0 0 8px", fontSize: 11.5, lineHeight: 1.6 }}
                      >
                        {p}
                      </p>
                    ))}
                    {currentPage.image && currentPage.imagePosition === "bottom" && (
                      <img
                        src={currentPage.image.url}
                        alt=""
                        style={{
                          width: "100%",
                          maxHeight: 150,
                          objectFit: "contain",
                          borderRadius: 8,
                          marginTop: 8,
                        }}
                      />
                    )}
                  </div>
                  {draft.design.showPageNumbers && (
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: draft.design.accentColor,
                      }}
                    >
                      {currentPage.pageNumber}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="bp-row">
              <button
                type="button"
                className="bp-btn"
                disabled={safePreviewIdx === 0}
                onClick={() => setPreviewIdx((p) => Math.max(0, p - 1))}
              >
                <ArrowLeft size={14} />
                <span>{ui.prevPage}</span>
              </button>
              <button
                type="button"
                className="bp-btn"
                disabled={safePreviewIdx >= pages.length - 1}
                onClick={() =>
                  setPreviewIdx((p) => Math.min(pages.length - 1, p + 1))
                }
              >
                <span>{ui.nextPage}</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SAVED BOOKS IN USER ACCOUNT */}
      {tab === "saved" && (
        <div className="bp-panel">
          <div className="bp-head-row">
            <strong>
              {ui.tabSaved} ({savedBooks.length})
            </strong>
            <button
              type="button"
              className="bp-btn is-primary"
              onClick={() => {
                setActiveBookId(null);
                setDraft(makeInitialDraft(locale, authorDefaultName));
                setTab("setup");
              }}
            >
              <Plus size={14} />
              <span>{ui.newBook}</span>
            </button>
          </div>

          {savedBooks.length === 0 ? (
            <p style={{ color: "var(--app-secondary)", fontSize: 13 }}>
              {ui.noSaved}
            </p>
          ) : (
            <div className="bp-saved-list">
              {savedBooks.map((book) => (
                <article key={book.id} className="bp-saved-row">
                  <div>
                    <strong dir="auto">{book.title}</strong>
                    <div style={{ fontSize: 12, color: "var(--app-secondary)" }}>
                      {book.chapters.length} ch · {book.design.template} ·{" "}
                      {book.design.pageSize.toUpperCase()} ·{" "}
                      {book.design.direction.toUpperCase()}
                      {book.exportCount > 0 ? ` · ${book.exportCount} PDF` : ""}
                    </div>
                  </div>
                  <div className="bp-row">
                    <button
                      type="button"
                      className="bp-btn is-primary"
                      onClick={() => void handleOpenSavedBook(book)}
                    >
                      {ui.openEdit}
                    </button>
                    <button
                      type="button"
                      className="bp-btn is-danger"
                      onClick={() => void handleDeleteSavedBook(book.id)}
                    >
                      <Trash2 size={13} />
                      <span>{ui.delBook}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
