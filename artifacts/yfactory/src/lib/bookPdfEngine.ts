import {
  fetchStoryImageBlobUrl,
  FONT_OPTIONS,
  getTemplatePreset,
  PAGE_SIZE_SPECS,
  type BookChapterImage,
  type SavedBookProject,
} from "@/lib/bookApi";

export type BookDraftInput = Omit<
  SavedBookProject,
  "id" | "exportCount" | "lastExportedAt" | "lastExportPageCount" | "createdAt" | "updatedAt"
>;

export type LaidOutPage =
  | { kind: "cover"; pageNumber: null }
  | { kind: "copyright"; pageNumber: null }
  | { kind: "intro"; pageNumber: number; title: string; paragraphs: string[] }
  | {
      kind: "toc";
      pageNumber: number;
      entries: Array<{ index: number; title: string; startPage: number }>;
    }
  | {
      kind: "chapter";
      pageNumber: number;
      chapterIndex: number;
      chapterTitle: string;
      isChapterStart: boolean;
      paragraphs: string[];
      image: BookChapterImage | null;
      imagePosition: "top" | "bottom";
    }
  | {
      kind: "full_image";
      pageNumber: number;
      chapterIndex: number;
      chapterTitle: string;
      image: BookChapterImage;
    };

function fontStackFor(fontFamily: string): string {
  return (
    FONT_OPTIONS.find((f) => f.value === fontFamily)?.stack ??
    `'${fontFamily}', Georgia, serif`
  );
}

function charsPerPageBudget(book: BookDraftInput, hasImage: boolean): number {
  const { pageSize, fontSize, marginPreset } = book.design;
  let base =
    pageSize === "a4" || pageSize === "letter"
      ? 1650
      : pageSize === "square_8x8"
        ? 1150
        : 1050;
  if (fontSize === "small") base = Math.round(base * 1.25);
  else if (fontSize === "large") base = Math.round(base * 0.76);
  if (marginPreset === "wide") base = Math.round(base * 0.85);
  else if (marginPreset === "narrow") base = Math.round(base * 1.12);
  if (hasImage) base = Math.round(base * 0.48);
  return Math.max(260, base);
}

function splitParagraphsIntoChunks(
  text: string,
  firstChunkBudget: number,
  nextChunkBudget: number,
): string[][] {
  const rawParas = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (rawParas.length === 0) return [[]];

  const pages: string[][] = [];
  let current: string[] = [];
  let curLen = 0;
  let budget = firstChunkBudget;

  for (const para of rawParas) {
    if (para.length > budget && current.length === 0) {
      // Split very long paragraph cleanly by words
      const words = para.split(/\s+/);
      let lineBuf = "";
      for (const word of words) {
        if ((lineBuf + " " + word).trim().length > budget && lineBuf) {
          pages.push([lineBuf.trim()]);
          budget = nextChunkBudget;
          lineBuf = word;
        } else {
          lineBuf = lineBuf ? `${lineBuf} ${word}` : word;
        }
      }
      if (lineBuf.trim()) {
        current.push(lineBuf.trim());
        curLen = lineBuf.length;
      }
      continue;
    }

    if (curLen + para.length + 40 > budget && current.length > 0) {
      pages.push(current);
      current = [para];
      curLen = para.length;
      budget = nextChunkBudget;
    } else {
      current.push(para);
      curLen += para.length + 40;
    }
  }

  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

export function paginateBook(book: BookDraftInput): LaidOutPage[] {
  const pages: LaidOutPage[] = [
    { kind: "cover", pageNumber: null },
    { kind: "copyright", pageNumber: null },
  ];

  let nextNum = 1;

  if (book.includeIntro && book.introText.trim()) {
    const introChunks = splitParagraphsIntoChunks(
      book.introText,
      charsPerPageBudget(book, false),
      charsPerPageBudget(book, false),
    );
    introChunks.forEach((paragraphs, idx) => {
      pages.push({
        kind: "intro",
        pageNumber: nextNum++,
        title: idx === 0 ? book.introTitle : `${book.introTitle} (cont.)`,
        paragraphs,
      });
    });
  }

  // Reserve TOC page slot and populate exact chapter start page numbers after laying out chapters
  let tocPageIndex = -1;
  if (book.includeToc && book.chapters.length > 0) {
    tocPageIndex = pages.length;
    pages.push({
      kind: "toc",
      pageNumber: nextNum++,
      entries: [],
    });
  }

  const tocEntries: Array<{ index: number; title: string; startPage: number }> = [];
  const textOnlyBudget = charsPerPageBudget(book, false);
  const withImgBudget = charsPerPageBudget(book, true);

  book.chapters.forEach((chapter, chIdx) => {
    const chapterStartPage = nextNum;
    tocEntries.push({
      index: chIdx + 1,
      title: chapter.title,
      startPage: chapterStartPage,
    });

    const imgs = chapter.images ?? [];
    const layout = book.design.imageLayout;

    if (layout === "full_page") {
      const textChunks = splitParagraphsIntoChunks(
        chapter.body,
        textOnlyBudget,
        textOnlyBudget,
      );
      textChunks.forEach((paragraphs, pIdx) => {
        if (paragraphs.length === 0 && pIdx > 0) return;
        pages.push({
          kind: "chapter",
          pageNumber: nextNum++,
          chapterIndex: chIdx + 1,
          chapterTitle: chapter.title,
          isChapterStart: pIdx === 0,
          paragraphs,
          image: null,
          imagePosition: "top",
        });
      });
      imgs.forEach((img) => {
        pages.push({
          kind: "full_image",
          pageNumber: nextNum++,
          chapterIndex: chIdx + 1,
          chapterTitle: chapter.title,
          image: img,
        });
      });
      return;
    }

    const firstHasImg = imgs.length > 0;
    const textChunks = splitParagraphsIntoChunks(
      chapter.body,
      firstHasImg ? withImgBudget : textOnlyBudget,
      textOnlyBudget,
    );

    const totalPaired = Math.max(textChunks.length, imgs.length);
    for (let i = 0; i < totalPaired; i += 1) {
      const paragraphs = textChunks[i] ?? [];
      const img = imgs[i] ?? null;
      const pos: "top" | "bottom" =
        layout === "bottom"
          ? "bottom"
          : layout === "alternating"
            ? i % 2 === 0
              ? "top"
              : "bottom"
            : "top";

      if (paragraphs.length === 0 && img && i > 0) {
        pages.push({
          kind: "full_image",
          pageNumber: nextNum++,
          chapterIndex: chIdx + 1,
          chapterTitle: chapter.title,
          image: img,
        });
      } else {
        pages.push({
          kind: "chapter",
          pageNumber: nextNum++,
          chapterIndex: chIdx + 1,
          chapterTitle: chapter.title,
          isChapterStart: i === 0,
          paragraphs,
          image: img,
          imagePosition: pos,
        });
      }
    }
  });

  if (tocPageIndex >= 0) {
    const tocPage = pages[tocPageIndex];
    if (tocPage && tocPage.kind === "toc") {
      tocPage.entries = tocEntries;
    }
  }

  return pages;
}

async function resolveImageElement(
  url: string,
  storyId: string | null,
  imageId: string | null,
  idToken: string | null,
  blobCache: Map<string, string>,
): Promise<HTMLImageElement | null> {
  let loadSrc = url;
  if (storyId && imageId && idToken && !url.startsWith("data:")) {
    const cacheKey = `${storyId}:${imageId}`;
    let blobUrl = blobCache.get(cacheKey);
    if (!blobUrl) {
      const fetched = await fetchStoryImageBlobUrl(idToken, storyId, imageId);
      if (fetched) {
        blobUrl = fetched;
        blobCache.set(cacheKey, blobUrl);
      }
    }
    if (blobUrl) loadSrc = blobUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = loadSrc;
  });
}

function drawRoundedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  radius: number,
  coverMode = false,
): { drawW: number; drawH: number; drawX: number; drawY: number } {
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  let drawW = maxW;
  let drawH = maxH;
  let drawX = x;
  let drawY = y;

  ctx.save();
  if (coverMode) {
    ctx.beginPath();
    ctx.roundRect(x, y, maxW, maxH, radius);
    ctx.clip();
    const scale = Math.max(maxW / natW, maxH / natH);
    const sw = natW * scale;
    const sh = natH * scale;
    ctx.drawImage(img, x + (maxW - sw) / 2, y + (maxH - sh) / 2, sw, sh);
  } else {
    const scale = Math.min(maxW / natW, maxH / natH);
    drawW = natW * scale;
    drawH = natH * scale;
    drawX = x + (maxW - drawW) / 2;
    drawY = y + (maxH - drawH) / 2;
    ctx.beginPath();
    ctx.roundRect(drawX, drawY, drawW, drawH, radius);
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }
  ctx.restore();
  return { drawW, drawH, drawX, drawY };
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i += 1) {
    const test = `${current} ${words[i]!}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i]!;
    }
  }
  lines.push(current);
  return lines;
}

function drawTemplatePageDecoration(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  margin: number,
  accent: string,
  borderStyle: ReturnType<typeof getTemplatePreset>["borderStyle"],
) {
  ctx.save();
  ctx.strokeStyle = accent;
  if (borderStyle === "ornate") {
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(margin * 0.45, margin * 0.45, W - margin * 0.9, H - margin * 0.9);
    ctx.globalAlpha = 0.14;
    ctx.strokeRect(margin * 0.56, margin * 0.56, W - margin * 1.12, H - margin * 1.12);
  } else if (borderStyle === "tech") {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    const corner = 24;
    ctx.beginPath();
    ctx.moveTo(margin * 0.5, margin * 0.5 + corner);
    ctx.lineTo(margin * 0.5, margin * 0.5);
    ctx.lineTo(margin * 0.5 + corner, margin * 0.5);
    ctx.moveTo(W - margin * 0.5 - corner, H - margin * 0.5);
    ctx.lineTo(W - margin * 0.5, H - margin * 0.5);
    ctx.lineTo(W - margin * 0.5, H - margin * 0.5 - corner);
    ctx.stroke();
  } else if (borderStyle === "playful") {
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(margin * 0.45, margin * 0.45, W - margin * 0.9, H - margin * 0.9, 22);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(margin, margin * 0.68);
    ctx.lineTo(W - margin, margin * 0.68);
    ctx.stroke();
  }
  ctx.restore();
}

async function renderPageToJpegBytes(
  book: BookDraftInput,
  page: LaidOutPage,
  dpiScale: number,
  jpegQuality: number,
  idToken: string | null,
  blobCache: Map<string, string>,
): Promise<{ jpegBytes: Uint8Array; pixelW: number; pixelH: number }> {
  const sizeSpec = PAGE_SIZE_SPECS[book.design.pageSize];
  const preset = getTemplatePreset(book.design.template);
  const W = sizeSpec.widthPt;
  const H = sizeSpec.heightPt;
  const pixelW = Math.round(W * dpiScale);
  const pixelH = Math.round(H * dpiScale);

  const canvas = document.createElement("canvas");
  canvas.width = pixelW;
  canvas.height = pixelH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  ctx.scale(dpiScale, dpiScale);
  const isRtl = book.design.direction === "rtl";
  ctx.direction = isRtl ? "rtl" : "ltr";

  const margin =
    book.design.marginPreset === "narrow"
      ? 38
      : book.design.marginPreset === "wide"
        ? 66
        : 52;
  const contentW = W - margin * 2;
  const fontStack = fontStackFor(book.design.fontFamily);
  const bodySize =
    book.design.fontSize === "small"
      ? 11
      : book.design.fontSize === "large"
        ? 15
        : 12.8;
  const lineH = Math.round(bodySize * 1.65);

  if (page.kind === "cover") {
    const coverImg = book.coverImageUrl
      ? await resolveImageElement(
          book.coverImageUrl,
          book.storyId,
          book.coverImageId,
          idToken,
          blobCache,
        )
      : null;

    ctx.fillStyle = preset.coverBg;
    ctx.fillRect(0, 0, W, H);

    if (coverImg && book.design.coverStyle === "full_bleed") {
      drawRoundedImage(ctx, coverImg, 0, 0, W, H, 0, true);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgba(10,10,14,0.68)");
      grad.addColorStop(0.5, "rgba(10,10,14,0.34)");
      grad.addColorStop(1, "rgba(10,10,14,0.84)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    } else if (coverImg) {
      const boxH = Math.round(H * 0.42);
      const boxY = Math.round(H * 0.24);
      drawRoundedImage(ctx, coverImg, margin + 12, boxY, contentW - 24, boxH, 14, true);
      ctx.strokeStyle = book.design.accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(margin + 12, boxY, contentW - 24, boxH, 14);
      ctx.stroke();
    }

    // Cover outer gold/accent frame
    ctx.strokeStyle = book.design.accentColor;
    ctx.lineWidth = book.design.coverStyle === "ornate_gold" ? 3 : 1.8;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    if (book.design.coverStyle === "ornate_gold") {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.strokeRect(32, 32, W - 64, H - 64);
      ctx.globalAlpha = 1;
    }

    // Title
    ctx.fillStyle = preset.coverText;
    ctx.textAlign = "center";
    ctx.font = `700 ${Math.round(Math.min(34, W * 0.062))}px ${fontStack}`;
    const titleLines = wrapTextLines(ctx, book.title || "Untitled Book", contentW - 20);
    let ty = coverImg && book.design.coverStyle !== "full_bleed" ? 86 : H * 0.28;
    for (const ln of titleLines.slice(0, 3)) {
      ctx.fillText(ln, W / 2, ty);
      ty += Math.round(Math.min(42, W * 0.075));
    }

    if (book.subtitle.trim()) {
      ctx.font = `400 14px ${fontStack}`;
      ctx.fillStyle = book.design.accentColor;
      const subLines = wrapTextLines(ctx, book.subtitle.trim(), contentW - 30);
      for (const ln of subLines.slice(0, 2)) {
        ctx.fillText(ln, W / 2, ty + 8);
        ty += 20;
      }
    }

    if (book.authorName.trim()) {
      ctx.font = `600 16px ${fontStack}`;
      ctx.fillStyle = preset.coverText;
      ctx.fillText(book.authorName.trim(), W / 2, H - 68);
    }

    ctx.font = `500 10px ${fontStack}`;
    ctx.globalAlpha = 0.65;
    ctx.fillText("YFactory Publishing Studio", W / 2, H - 42);
    ctx.globalAlpha = 1;
  } else {
    // Interior Page Background
    ctx.fillStyle = book.design.paperColor;
    ctx.fillRect(0, 0, W, H);
    drawTemplatePageDecoration(ctx, W, H, margin, book.design.accentColor, preset.borderStyle);

    // Running Header & Page Number
    if (page.pageNumber !== null) {
      if (book.design.showRunningHeader) {
        ctx.save();
        ctx.font = `500 9.5px ${fontStack}`;
        ctx.fillStyle = book.design.textColor;
        ctx.globalAlpha = 0.5;
        ctx.textAlign = "center";
        const headText =
          page.kind === "chapter" || page.kind === "full_image"
            ? `${book.title} — ${page.chapterTitle}`
            : book.title;
        ctx.fillText(headText.slice(0, 70), W / 2, margin * 0.56);
        ctx.restore();
      }
      if (book.design.showPageNumbers) {
        ctx.save();
        ctx.font = `600 10.5px ${fontStack}`;
        ctx.fillStyle = book.design.accentColor;
        ctx.textAlign = "center";
        ctx.fillText(String(page.pageNumber), W / 2, H - margin * 0.42);
        ctx.restore();
      }
    }

    const alignX = isRtl ? W - margin : margin;
    ctx.textAlign = isRtl ? "right" : "left";

    if (page.kind === "copyright") {
      let y = H * 0.44;
      ctx.fillStyle = book.design.textColor;
      ctx.font = `700 16px ${fontStack}`;
      ctx.fillText(book.title, alignX, y);
      y += 24;
      if (book.authorName.trim()) {
        ctx.font = `500 12px ${fontStack}`;
        ctx.fillText(book.authorName.trim(), alignX, y);
        y += 28;
      }
      ctx.font = `400 10.5px ${fontStack}`;
      ctx.globalAlpha = 0.85;
      const copyLines = wrapTextLines(
        ctx,
        book.copyrightText ||
          `© ${new Date().getFullYear()} ${book.authorName || "Author"}. All rights reserved.`,
        contentW,
      );
      for (const ln of copyLines) {
        ctx.fillText(ln, alignX, y);
        y += 17;
      }
      y += 14;
      if (book.rightsNotice.trim()) {
        ctx.fillStyle = book.design.accentColor;
        const rightLines = wrapTextLines(ctx, book.rightsNotice.trim(), contentW);
        for (const ln of rightLines) {
          ctx.fillText(ln, alignX, y);
          y += 16;
        }
      }
      ctx.globalAlpha = 1;
    } else if (page.kind === "intro") {
      let y = margin + 26;
      ctx.fillStyle = book.design.accentColor;
      ctx.font = `700 20px ${fontStack}`;
      ctx.fillText(page.title, alignX, y);
      y += 14;
      ctx.fillRect(isRtl ? W - margin - 60 : margin, y, 60, 2);
      y += 26;

      ctx.fillStyle = book.design.textColor;
      ctx.font = `400 ${bodySize}px ${fontStack}`;
      for (const para of page.paragraphs) {
        for (const ln of wrapTextLines(ctx, para, contentW)) {
          if (y > H - margin - 14) break;
          ctx.fillText(ln, alignX, y);
          y += lineH;
        }
        y += Math.round(bodySize * 0.65);
      }
    } else if (page.kind === "toc") {
      let y = margin + 28;
      ctx.fillStyle = book.design.accentColor;
      ctx.font = `700 22px ${fontStack}`;
      ctx.fillText(isRtl ? "فهرس المحتويات" : "Table of Contents", alignX, y);
      y += 14;
      ctx.fillRect(isRtl ? W - margin - 80 : margin, y, 80, 2);
      y += 30;

      ctx.font = `500 12.5px ${fontStack}`;
      for (const item of page.entries) {
        if (y > H - margin - 18) break;
        ctx.fillStyle = book.design.textColor;
        ctx.textAlign = isRtl ? "right" : "left";
        ctx.fillText(`${item.index}. ${item.title}`.slice(0, 62), alignX, y);
        ctx.fillStyle = book.design.accentColor;
        ctx.textAlign = isRtl ? "left" : "right";
        ctx.fillText(String(item.startPage), isRtl ? margin : W - margin, y);
        ctx.save();
        ctx.strokeStyle = book.design.textColor;
        ctx.globalAlpha = 0.14;
        ctx.beginPath();
        ctx.moveTo(margin, y + 7);
        ctx.lineTo(W - margin, y + 7);
        ctx.stroke();
        ctx.restore();
        y += 26;
      }
    } else if (page.kind === "full_image") {
      const img = await resolveImageElement(
        page.image.url,
        page.image.storyId || book.storyId,
        page.image.imageId || null,
        idToken,
        blobCache,
      );
      const topY = margin + 12;
      const availH = H - margin * 2 - (page.image.caption ? 52 : 20);
      if (img) {
        const drawn = drawRoundedImage(ctx, img, margin, topY, contentW, availH, 12, false);
        if (page.image.caption) {
          ctx.fillStyle = book.design.textColor;
          ctx.globalAlpha = 0.72;
          ctx.textAlign = "center";
          ctx.font = `italic 10.5px ${fontStack}`;
          const capLines = wrapTextLines(ctx, page.image.caption, contentW - 16);
          let cy = drawn.drawY + drawn.drawH + 18;
          for (const ln of capLines.slice(0, 2)) {
            ctx.fillText(ln, W / 2, cy);
            cy += 15;
          }
          ctx.globalAlpha = 1;
        }
      }
    } else if (page.kind === "chapter") {
      let y = margin + 18;
      if (page.isChapterStart) {
        ctx.fillStyle = book.design.accentColor;
        ctx.font = `600 10.5px ${fontStack}`;
        ctx.fillText(
          isRtl ? `الفصل ${page.chapterIndex}` : `CHAPTER ${page.chapterIndex}`,
          alignX,
          y,
        );
        y += 22;
        ctx.fillStyle = book.design.textColor;
        ctx.font = `700 19px ${fontStack}`;
        const hLines = wrapTextLines(ctx, page.chapterTitle, contentW);
        for (const hl of hLines.slice(0, 2)) {
          ctx.fillText(hl, alignX, y);
          y += 25;
        }
        ctx.fillStyle = book.design.accentColor;
        ctx.fillRect(isRtl ? W - margin - 52 : margin, y - 10, 52, 2);
        y += 14;
      }

      const loadedImg = page.image
        ? await resolveImageElement(
            page.image.url,
            page.image.storyId || book.storyId,
            page.image.imageId || null,
            idToken,
            blobCache,
          )
        : null;

      const imgBoxH = Math.round((H - margin * 2) * 0.36);

      if (loadedImg && page.imagePosition === "top") {
        const drawn = drawRoundedImage(ctx, loadedImg, margin, y, contentW, imgBoxH, 10, false);
        y = drawn.drawY + drawn.drawH + 14;
        if (page.image?.caption) {
          ctx.fillStyle = book.design.textColor;
          ctx.globalAlpha = 0.65;
          ctx.font = `italic 9.5px ${fontStack}`;
          ctx.textAlign = "center";
          ctx.fillText(page.image.caption.slice(0, 90), W / 2, y);
          ctx.globalAlpha = 1;
          ctx.textAlign = isRtl ? "right" : "left";
          y += 16;
        }
      }

      const textBottomLimit =
        loadedImg && page.imagePosition === "bottom"
          ? H - margin - imgBoxH - 26
          : H - margin - 14;

      ctx.fillStyle = book.design.textColor;
      ctx.font = `400 ${bodySize}px ${fontStack}`;
      for (const para of page.paragraphs) {
        for (const ln of wrapTextLines(ctx, para, contentW)) {
          if (y > textBottomLimit) break;
          ctx.fillText(ln, alignX, y);
          y += lineH;
        }
        y += Math.round(bodySize * 0.58);
      }

      if (loadedImg && page.imagePosition === "bottom") {
        const imgY = Math.max(y + 4, H - margin - imgBoxH - 18);
        drawRoundedImage(ctx, loadedImg, margin, imgY, contentW, imgBoxH, 10, false);
      }
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", jpegQuality),
  );
  if (!blob) throw new Error("Failed to encode PDF page image.");
  const arr = await blob.arrayBuffer();
  return { jpegBytes: new Uint8Array(arr), pixelW, pixelH };
}

function buildMultiPagePdfBinary(
  pages: Array<{
    jpegBytes: Uint8Array;
    pixelW: number;
    pixelH: number;
    widthPt: number;
    heightPt: number;
  }>,
  title: string,
  author: string,
): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let byteLen = 0;

  const pushStr = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    byteLen += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    byteLen += b.length;
  };
  const pdfEsc = (s: string) =>
    s.replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");

  pushStr("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  const n = pages.length;
  // Object IDs: 1=Catalog, 2=Pages, 3=Info, then for each page i (0..n-1):
  //   imgObj = 4 + i*3, contentObj = 5 + i*3, pageObj = 6 + i*3
  const pageObjIds: number[] = [];
  for (let i = 0; i < n; i += 1) pageObjIds.push(6 + i * 3);

  const startObj = (id: number) => {
    offsets[id] = byteLen;
    pushStr(`${id} 0 obj\n`);
  };

  startObj(1);
  pushStr("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObj(2);
  pushStr(
    `<< /Type /Pages /Count ${n} /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`,
  );

  startObj(3);
  pushStr(
    `<< /Title (${pdfEsc(title || "YFactory Book")}) /Author (${pdfEsc(author || "YFactory Author")}) /Producer (YFactory Book Publishing Engine) >>\nendobj\n`,
  );

  for (let i = 0; i < n; i += 1) {
    const p = pages[i]!;
    const imgId = 4 + i * 3;
    const contentId = 5 + i * 3;
    const pageId = 6 + i * 3;

    startObj(imgId);
    pushStr(
      `<< /Type /XObject /Subtype /Image /Width ${p.pixelW} /Height ${p.pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\nstream\n`,
    );
    pushBytes(p.jpegBytes);
    pushStr("\nendstream\nendobj\n");

    const drawCmd = `q\n${p.widthPt} 0 0 ${p.heightPt} 0 0 cm\n/Im0 Do\nQ\n`;
    const drawBytes = enc.encode(drawCmd);
    startObj(contentId);
    pushStr(`<< /Length ${drawBytes.length} >>\nstream\n`);
    pushBytes(drawBytes);
    pushStr("endstream\nendobj\n");

    startObj(pageId);
    pushStr(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.widthPt} ${p.heightPt}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
  }

  const totalObjs = 3 + n * 3;
  const xrefPos = byteLen;
  pushStr(`xref\n0 ${totalObjs + 1}\n`);
  pushStr("0000000000 65535 f \n");
  for (let id = 1; id <= totalObjs; id += 1) {
    pushStr(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
  );

  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export async function exportDirectBookPdf(
  book: BookDraftInput,
  idToken: string | null,
  onProgress?: (current: number, total: number) => void,
): Promise<{ pageCount: number; sizeBytes: number; fileName: string }> {
  const layoutPages = paginateBook(book);
  const sizeSpec = PAGE_SIZE_SPECS[book.design.pageSize];

  // Smart automatic file-size management for large books (50-100+ pages)
  const dpiScale =
    layoutPages.length > 60
      ? 1.35
      : layoutPages.length > 30
        ? 1.6
        : book.design.highQualityImages
          ? 2.0
          : 1.5;
  const jpegQuality =
    layoutPages.length > 60
      ? 0.76
      : book.design.highQualityImages
        ? 0.88
        : 0.8;

  const blobCache = new Map<string, string>();
  const rendered: Array<{
    jpegBytes: Uint8Array;
    pixelW: number;
    pixelH: number;
    widthPt: number;
    heightPt: number;
  }> = [];

  try {
    for (let i = 0; i < layoutPages.length; i += 1) {
      onProgress?.(i + 1, layoutPages.length);
      const res = await renderPageToJpegBytes(
        book,
        layoutPages[i]!,
        dpiScale,
        jpegQuality,
        idToken,
        blobCache,
      );
      rendered.push({
        ...res,
        widthPt: sizeSpec.widthPt,
        heightPt: sizeSpec.heightPt,
      });
    }
  } finally {
    blobCache.forEach((url) => URL.revokeObjectURL(url));
  }

  const pdfBlob = buildMultiPagePdfBinary(rendered, book.title, book.authorName);
  const safeSlug =
    book.title
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "yfactory-book";
  const fileName = `${safeSlug}.pdf`;

  const dlUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = dlUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(dlUrl), 3000);

  return {
    pageCount: layoutPages.length,
    sizeBytes: pdfBlob.size,
    fileName,
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function openPrintFriendlyBookPdf(book: BookDraftInput): number {
  const pages = paginateBook(book);
  const sizeSpec = PAGE_SIZE_SPECS[book.design.pageSize];
  const preset = getTemplatePreset(book.design.template);
  const isRtl = book.design.direction === "rtl";
  const marginMm =
    book.design.marginPreset === "narrow"
      ? 14
      : book.design.marginPreset === "wide"
        ? 24
        : 18;
  const bodyPx =
    book.design.fontSize === "small"
      ? 13
      : book.design.fontSize === "large"
        ? 18
        : 15;
  const fontStack = fontStackFor(book.design.fontFamily);

  const pageHtml = pages
    .map((p) => {
      if (p.kind === "cover") {
        const bgImg =
          book.coverImageUrl && book.design.coverStyle === "full_bleed"
            ? `background-image:linear-gradient(rgba(10,10,16,.62),rgba(10,10,16,.78)),url('${escapeHtml(book.coverImageUrl)}');background-size:cover;background-position:center;`
            : "";
        return `<section class="sheet cover" style="background-color:${preset.coverBg};color:${preset.coverText};${bgImg}">
          <div class="cover-frame" style="border-color:${book.design.accentColor}">
            <div class="cover-top">
              <h1>${escapeHtml(book.title)}</h1>
              ${book.subtitle ? `<p class="subtitle" style="color:${book.design.accentColor}">${escapeHtml(book.subtitle)}</p>` : ""}
            </div>
            ${
              book.coverImageUrl && book.design.coverStyle !== "full_bleed"
                ? `<img class="cover-art" src="${escapeHtml(book.coverImageUrl)}" alt="" style="border-color:${book.design.accentColor}" />`
                : ""
            }
            <div class="cover-foot">
              ${book.authorName ? `<div class="author">${escapeHtml(book.authorName)}</div>` : ""}
              <div class="imprint">YFactory Publishing Studio</div>
            </div>
          </div>
        </section>`;
      }

      const headerBar =
        p.pageNumber !== null && book.design.showRunningHeader
          ? `<header class="run-head">${escapeHtml(
              p.kind === "chapter" || p.kind === "full_image"
                ? `${book.title} — ${p.chapterTitle}`
                : book.title,
            )}</header>`
          : "";
      const footerBar =
        p.pageNumber !== null && book.design.showPageNumbers
          ? `<footer class="run-foot" style="color:${book.design.accentColor}">${p.pageNumber}</footer>`
          : "";

      let body = "";
      if (p.kind === "copyright") {
        body = `<div class="copyright-box">
          <h2>${escapeHtml(book.title)}</h2>
          ${book.authorName ? `<p><strong>${escapeHtml(book.authorName)}</strong></p>` : ""}
          <p>${escapeHtml(book.copyrightText)}</p>
          ${book.rightsNotice ? `<p class="rights" style="color:${book.design.accentColor}">${escapeHtml(book.rightsNotice)}</p>` : ""}
        </div>`;
      } else if (p.kind === "intro") {
        body = `<h2 class="sec-h" style="color:${book.design.accentColor}">${escapeHtml(p.title)}</h2>
          ${p.paragraphs.map((x) => `<p>${escapeHtml(x)}</p>`).join("")}`;
      } else if (p.kind === "toc") {
        body = `<h2 class="sec-h" style="color:${book.design.accentColor}">${isRtl ? "فهرس المحتويات" : "Table of Contents"}</h2>
          <ul class="toc-list">${p.entries
            .map(
              (e) =>
                `<li><span>${e.index}. ${escapeHtml(e.title)}</span><strong style="color:${book.design.accentColor}">${e.startPage}</strong></li>`,
            )
            .join("")}</ul>`;
      } else if (p.kind === "full_image") {
        body = `<figure class="full-fig">
          <img src="${escapeHtml(p.image.url)}" alt="" />
          ${p.image.caption ? `<figcaption>${escapeHtml(p.image.caption)}</figcaption>` : ""}
        </figure>`;
      } else if (p.kind === "chapter") {
        const imgTag = p.image
          ? `<figure class="ch-fig"><img src="${escapeHtml(p.image.url)}" alt="" />${
              p.image.caption ? `<figcaption>${escapeHtml(p.image.caption)}</figcaption>` : ""
            }</figure>`
          : "";
        const chHead = p.isChapterStart
          ? `<div class="ch-kicker" style="color:${book.design.accentColor}">${
              isRtl ? `الفصل ${p.chapterIndex}` : `CHAPTER ${p.chapterIndex}`
            }</div><h2 class="ch-h">${escapeHtml(p.chapterTitle)}</h2>`
          : "";
        const paras = p.paragraphs.map((x) => `<p>${escapeHtml(x)}</p>`).join("");
        body = `${chHead}${p.imagePosition === "top" ? imgTag + paras : paras + imgTag}`;
      }

      return `<section class="sheet interior" style="background:${book.design.paperColor};color:${book.design.textColor};padding:${marginMm}mm">
        ${headerBar}
        <div class="sheet-body">${body}</div>
        ${footerBar}
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="${isRtl ? "ar" : "en"}" dir="${book.design.direction}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(book.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700&family=Merriweather:wght@400;700&family=Tajawal:wght@400;700&display=swap" />
<style>
  @page { size: ${sizeSpec.cssSize}; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #1e1e22; font-family: ${fontStack}; font-size: ${bodyPx}px; line-height: 1.75; }
  .print-bar { position: sticky; top: 0; z-index: 20; display: flex; justify-content: center; gap: 10px; padding: 10px; background: #111; color: #fff; }
  .print-bar button { padding: 8px 18px; border: 0; border-radius: 10px; background: #eab32e; color: #111; font-weight: 700; cursor: pointer; }
  .sheet { width: ${sizeSpec.widthPt}pt; min-height: ${sizeSpec.heightPt}pt; margin: 16px auto; position: relative; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; break-after: page; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
  .cover { padding: 24pt; }
  .cover-frame { flex: 1; border: 2px solid; padding: 28pt; display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center; }
  .cover h1 { margin: 0; font-size: 28pt; line-height: 1.25; }
  .subtitle { font-size: 13pt; margin-top: 8pt; }
  .cover-art { max-width: 82%; max-height: 44%; object-fit: cover; border-radius: 10pt; border: 2px solid; }
  .author { font-size: 14pt; font-weight: 700; }
  .imprint { font-size: 9pt; opacity: .65; margin-top: 4pt; }
  .run-head { text-align: center; font-size: 9pt; opacity: .55; margin-bottom: 10pt; }
  .run-foot { text-align: center; font-size: 10pt; font-weight: 700; margin-top: 10pt; }
  .sheet-body { flex: 1; }
  .sec-h { font-size: 20pt; margin: 0 0 14pt; }
  .ch-kicker { font-size: 10pt; font-weight: 700; letter-spacing: .06em; }
  .ch-h { font-size: 19pt; margin: 4pt 0 14pt; }
  .ch-fig, .full-fig { margin: 10pt 0 14pt; text-align: center; }
  .ch-fig img { max-width: 100%; max-height: 36vh; border-radius: 8pt; object-fit: contain; }
  .full-fig img { max-width: 100%; max-height: 74%; border-radius: 10pt; object-fit: contain; }
  figcaption { font-size: 9.5pt; opacity: .7; margin-top: 6pt; font-style: italic; }
  .toc-list { list-style: none; padding: 0; margin: 0; }
  .toc-list li { display: flex; justify-content: space-between; padding: 7pt 0; border-bottom: 1px solid rgba(0,0,0,.1); }
  .copyright-box { margin-top: 38%; font-size: 10.5pt; }
  .rights { margin-top: 12pt; font-size: 9.5pt; }
  @media print {
    body { background: none; }
    .print-bar { display: none; }
    .sheet { margin: 0; width: 100%; height: 100vh; box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()">${isRtl ? "طباعة / حفظ كملف PDF" : "Print / Save as PDF"}</button>
  </div>
  ${pageHtml}
</body>
</html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
  return pages.length;
}
