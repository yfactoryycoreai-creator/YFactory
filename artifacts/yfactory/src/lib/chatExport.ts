export type ExportMessageItem = {
  role: 'user' | 'assistant';
  text: string;
  modelName?: string;
};

function sanitizeFilename(raw: string, ext: string): string {
  const base = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'yfactory-chat'}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function containsArabicOrRtl(text: string): boolean {
  return /[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function buildConversationPlainText(
  title: string,
  messages: ExportMessageItem[],
  labels: { user: string; assistant: string },
): string {
  const parts: string[] = [title, ''];
  for (const msg of messages) {
    const sender = msg.role === 'user'
      ? labels.user
      : msg.modelName
        ? `${labels.assistant} (${msg.modelName})`
        : labels.assistant;
    parts.push(`${sender}:`);
    parts.push(msg.text.trim());
    parts.push('');
  }
  return parts.join('\n').trim();
}

export function exportAsMarkdown(
  title: string,
  messages: ExportMessageItem[],
  labels: { user: string; assistant: string },
): void {
  const dateStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [`# ${title}`, '', `> Exported from YFactory AI · ${dateStr}`, ''];
  for (const msg of messages) {
    const heading = msg.role === 'user'
      ? `## ${labels.user}`
      : msg.modelName
        ? `## ${labels.assistant} (\`${msg.modelName}\`)`
        : `## ${labels.assistant}`;
    lines.push(heading, '', msg.text.trim(), '', '---', '');
  }
  const content = '\uFEFF' + lines.join('\n');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, sanitizeFilename(title, 'md'));
}

/* ==================== Pure-TS Standards-Compliant DOCX Generator ==================== */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // STORE (no compression)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLength = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function docxParagraph(
  text: string,
  options: {
    bold?: boolean;
    sizeHalfPt?: number;
    colorHex?: string;
    code?: boolean;
    spaceAfter?: number;
    spaceBefore?: number;
    forceLtr?: boolean;
  } = {},
): string {
  const rtl = !options.forceLtr && containsArabicOrRtl(text);
  const pPrParts: string[] = [];
  if (rtl) {
    pPrParts.push('<w:bidi/>');
    pPrParts.push('<w:jc w:val="right"/>');
  }
  if (options.spaceBefore !== undefined || options.spaceAfter !== undefined) {
    pPrParts.push(
      `<w:spacing${options.spaceBefore !== undefined ? ` w:before="${options.spaceBefore}"` : ''}${options.spaceAfter !== undefined ? ` w:after="${options.spaceAfter}"` : ''}/>`,
    );
  }
  if (options.code) {
    pPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>');
    pPrParts.push('<w:ind w:left="240" w:right="240"/>');
  }
  const rPrParts: string[] = [];
  if (options.bold) rPrParts.push('<w:b/><w:bCs/>');
  if (options.sizeHalfPt) {
    rPrParts.push(`<w:sz w:val="${options.sizeHalfPt}"/><w:szCs w:val="${options.sizeHalfPt}"/>`);
  }
  if (options.colorHex) {
    rPrParts.push(`<w:color w:val="${options.colorHex}"/>`);
  }
  if (options.code) {
    rPrParts.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>');
  }
  if (rtl) rPrParts.push('<w:rtl/>');

  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

export function exportAsDocx(
  title: string,
  messages: ExportMessageItem[],
  labels: { user: string; assistant: string },
): void {
  const paragraphs: string[] = [];
  paragraphs.push(
    docxParagraph(title, { bold: true, sizeHalfPt: 34, colorHex: '1F2937', spaceAfter: 140 }),
  );
  paragraphs.push(
    docxParagraph(
      `YFactory AI · ${new Date().toLocaleString()}`,
      { sizeHalfPt: 18, colorHex: '6B7280', spaceAfter: 240 },
    ),
  );

  for (const msg of messages) {
    const sender = msg.role === 'user'
      ? labels.user
      : msg.modelName
        ? `${labels.assistant} (${msg.modelName})`
        : labels.assistant;
    paragraphs.push(
      docxParagraph(sender, {
        bold: true,
        sizeHalfPt: 24,
        colorHex: msg.role === 'user' ? 'B45309' : '111827',
        spaceBefore: 160,
        spaceAfter: 80,
      }),
    );

    const lines = msg.text.replace(/\r\n/g, '\n').split('\n');
    let inCode = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        paragraphs.push(
          docxParagraph(rawLine || ' ', {
            code: true,
            sizeHalfPt: 19,
            colorHex: '111827',
            spaceAfter: 20,
            forceLtr: true,
          }),
        );
        continue;
      }
      const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (headingMatch) {
        paragraphs.push(
          docxParagraph(headingMatch[2] ?? trimmed, {
            bold: true,
            sizeHalfPt: 26,
            colorHex: '111827',
            spaceBefore: 100,
            spaceAfter: 60,
          }),
        );
      } else {
        const cleaned = rawLine.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
        paragraphs.push(
          docxParagraph(cleaned || ' ', {
            sizeHalfPt: 22,
            colorHex: '1F2937',
            spaceAfter: 60,
          }),
        );
      }
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const encoder = new TextEncoder();
  const zipBytes = buildZipArchive([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels', data: encoder.encode(relsXml) },
    { name: 'word/document.xml', data: encoder.encode(documentXml) },
  ]);

  const blob = new Blob([zipBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  triggerDownload(blob, sanitizeFilename(title, 'docx'));
}

/* ==================== Real Binary PDF Generator (Native Arabic Shaping via Canvas) ==================== */

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildPdfFromJpegs(
  pages: Array<{ jpeg: Uint8Array; widthPx: number; heightPx: number }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let byteLength = 0;

  const pushStr = (str: string) => {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const pageCount = pages.length;
  // Object numbering:
  // 1 = Catalog, 2 = Pages
  // For page i (0-based):
  //   imgObj = 3 + i * 3
  //   contentObj = 4 + i * 3
  //   pageObj = 5 + i * 3
  const pageObjIds: number[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    pageObjIds.push(5 + i * 3);
  }

  const addObj = (id: number, body: Uint8Array | string) => {
    offsets[id] = byteLength;
    pushStr(`${id} 0 obj\n`);
    if (typeof body === 'string') pushStr(body);
    else pushBytes(body);
    pushStr('\nendobj\n');
  };

  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );

  // A4 size in PDF points: 595.28 x 841.89
  const a4W = 595.28;
  const a4H = 841.89;

  for (let i = 0; i < pageCount; i += 1) {
    const page = pages[i]!;
    const imgId = 3 + i * 3;
    const contentId = 4 + i * 3;
    const pageId = 5 + i * 3;

    offsets[imgId] = byteLength;
    pushStr(
      `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    pushBytes(page.jpeg);
    pushStr('\nendstream\nendobj\n');

    const streamContent = `q\n${a4W} 0 0 ${a4H} 0 0 cm\n/Im0 Do\nQ\n`;
    addObj(
      contentId,
      `<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream`,
    );

    addObj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${a4W} ${a4H}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  }

  const totalObjs = 2 + pageCount * 3;
  const xrefOffset = byteLength;
  pushStr(`xref\n0 ${totalObjs + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjs; id += 1) {
    const off = String(offsets[id] ?? 0).padStart(10, '0');
    pushStr(`${off} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const output = new Uint8Array(byteLength);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

type PdfRenderLine = {
  text: string;
  font: string;
  color: string;
  lineHeight: number;
  rtl: boolean;
  code?: boolean;
  spaceBefore?: number;
  spaceAfter?: number;
};

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else if (!current) {
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function exportAsPdf(
  title: string,
  messages: ExportMessageItem[],
  labels: { user: string; assistant: string },
): void {
  const pageWidth = 1240;
  const pageHeight = 1754;
  const marginX = 88;
  const marginTop = 96;
  const marginBottom = 96;
  const contentWidth = pageWidth - marginX * 2;

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = pageWidth;
  measureCanvas.height = 100;
  const mctx = measureCanvas.getContext('2d');
  if (!mctx) {
    exportAsMarkdown(title, messages, labels);
    return;
  }

  const lines: PdfRenderLine[] = [];
  const pushWrapped = (
    text: string,
    opts: {
      font: string;
      color: string;
      lineHeight: number;
      rtl: boolean;
      code?: boolean;
      spaceBefore?: number;
      spaceAfter?: number;
    },
  ) => {
    mctx.font = opts.font;
    const maxW = opts.code ? contentWidth - 36 : contentWidth;
    const wrapped = wrapCanvasText(mctx, text, maxW);
    wrapped.forEach((line, idx) => {
      lines.push({
        text: line,
        font: opts.font,
        color: opts.color,
        lineHeight: opts.lineHeight,
        rtl: opts.rtl,
        code: opts.code,
        spaceBefore: idx === 0 ? opts.spaceBefore : 0,
        spaceAfter: idx === wrapped.length - 1 ? opts.spaceAfter : 0,
      });
    });
  };

  const sansFont = 'system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif';
  const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  pushWrapped(title, {
    font: `700 38px ${sansFont}`,
    color: '#111827',
    lineHeight: 50,
    rtl: containsArabicOrRtl(title),
    spaceAfter: 10,
  });
  pushWrapped(`YFactory AI · ${new Date().toLocaleString()}`, {
    font: `400 21px ${sansFont}`,
    color: '#6B7280',
    lineHeight: 30,
    rtl: false,
    spaceAfter: 28,
  });

  for (const msg of messages) {
    const sender = msg.role === 'user'
      ? labels.user
      : msg.modelName
        ? `${labels.assistant} (${msg.modelName})`
        : labels.assistant;
    pushWrapped(sender, {
      font: `700 26px ${sansFont}`,
      color: msg.role === 'user' ? '#B45309' : '#111827',
      lineHeight: 38,
      rtl: containsArabicOrRtl(sender),
      spaceBefore: 20,
      spaceAfter: 8,
    });

    const rawLines = msg.text.replace(/\r\n/g, '\n').split('\n');
    let inCode = false;
    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        pushWrapped(rawLine || ' ', {
          font: `400 20px ${monoFont}`,
          color: '#111827',
          lineHeight: 30,
          rtl: false,
          code: true,
        });
        continue;
      }
      const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (headingMatch) {
        const headingText = headingMatch[2] ?? trimmed;
        pushWrapped(headingText, {
          font: `700 27px ${sansFont}`,
          color: '#111827',
          lineHeight: 38,
          rtl: containsArabicOrRtl(headingText),
          spaceBefore: 10,
          spaceAfter: 4,
        });
      } else {
        const cleaned = rawLine.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
        pushWrapped(cleaned || ' ', {
          font: `400 24px ${sansFont}`,
          color: '#1F2937',
          lineHeight: 36,
          rtl: containsArabicOrRtl(cleaned),
          spaceAfter: 4,
        });
      }
    }
  }

  const pages: Array<{ jpeg: Uint8Array; widthPx: number; heightPx: number }> = [];
  const createPageCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    ctx.fillStyle = '#F0B24A';
    ctx.fillRect(0, 0, pageWidth, 10);
    return { canvas, ctx };
  };

  let { canvas, ctx } = createPageCanvas();
  let y = marginTop;

  const finalizePage = (pageNum: number) => {
    ctx.font = `400 18px ${sansFont}`;
    ctx.fillStyle = '#9CA3AF';
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.fillText(`YFactory AI — Page ${pageNum}`, pageWidth / 2, pageHeight - 40);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1] ?? '';
    pages.push({ jpeg: base64ToUint8Array(base64), widthPx: pageWidth, heightPx: pageHeight });
  };

  for (const item of lines) {
    const needed = (item.spaceBefore ?? 0) + item.lineHeight + (item.spaceAfter ?? 0);
    if (y + needed > pageHeight - marginBottom) {
      finalizePage(pages.length + 1);
      const next = createPageCanvas();
      canvas = next.canvas;
      ctx = next.ctx;
      y = marginTop;
    }
    y += item.spaceBefore ?? 0;

    if (item.code) {
      ctx.fillStyle = '#F3F4F6';
      ctx.fillRect(marginX, y - 22, contentWidth, item.lineHeight);
    }

    ctx.font = item.font;
    ctx.fillStyle = item.color;
    ctx.direction = item.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = item.rtl ? 'right' : 'left';
    const x = item.code
      ? marginX + 18
      : item.rtl
        ? pageWidth - marginX
        : marginX;
    ctx.fillText(item.text, x, y);
    y += item.lineHeight + (item.spaceAfter ?? 0);
  }

  finalizePage(pages.length + 1);
  const pdfBytes = buildPdfFromJpegs(pages);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  triggerDownload(blob, sanitizeFilename(title, 'pdf'));
}
