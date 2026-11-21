import type { ChatImageAttachment } from '@/lib/chatApi';
import type { StoryRecord } from '@/lib/stories';

export type PendingAttachmentStatus = 'processing' | 'ready' | 'error';

export type PendingAttachment = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  sizeBytes: number;
  status: PendingAttachmentStatus;
  error?: string;
  file: File;
  image?: ChatImageAttachment;
  previewUrl?: string;
  textContent?: string;
};

export const MAX_PENDING_ATTACHMENTS = 4;
const MAX_RAW_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ENCODED_IMAGE_CHARS = 3_200_000;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 12_000;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'go',
  'rs',
  'php',
  'rb',
  'sh',
  'sql',
  'log',
  'ini',
  'env',
  'srt',
  'vtt',
]);

export function makeAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('read_failed'));
    };
    reader.readAsDataURL(blob);
  });
}

export async function processImageAttachment(
  file: File,
  signal?: AbortSignal,
): Promise<{ image: ChatImageAttachment; previewUrl: string }> {
  if (signal?.aborted) throw new Error('aborted');
  if (file.size <= 0 || file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('image_too_large');
  }

  const objectUrl = URL.createObjectURL(file);
  let bitmap: ImageBitmap | null = null;
  try {
    let source: CanvasImageSource;
    let width = 0;
    let height = 0;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } else {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      source = img;
      width = img.naturalWidth;
      height = img.naturalHeight;
    }
    if (signal?.aborted) throw new Error('aborted');
    if (!width || !height) throw new Error('invalid_image');

    let maxEdge = 1280;
    let quality = 0.84;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (signal?.aborted) throw new Error('aborted');
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas_unavailable');
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob && blob.size > 0) {
        const dataUrl = await readBlobAsDataUrl(blob);
        if (signal?.aborted) throw new Error('aborted');
        if (dataUrl.length <= MAX_ENCODED_IMAGE_CHARS) {
          return {
            image: { mimeType: 'image/jpeg', dataUrl },
            previewUrl: dataUrl,
          };
        }
      }
      maxEdge = Math.max(480, Math.floor(maxEdge * 0.78));
      quality = Math.max(0.45, quality - 0.1);
    }
    throw new Error('image_too_large');
  } finally {
    bitmap?.close();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processFileAttachment(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error('aborted');
  if (file.size <= 0 || file.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('file_too_large');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isTextMime =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    file.type === 'application/javascript';

  if (!isTextMime && !TEXT_EXTENSIONS.has(ext)) {
    throw new Error('unsupported_file_type');
  }

  const rawText = await file.text();
  if (signal?.aborted) throw new Error('aborted');
  const trimmed = rawText.replace(/\u0000/g, '').trim();
  if (!trimmed) throw new Error('empty_file');

  if (trimmed.length > MAX_EXTRACTED_CHARS) {
    return `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n[...truncated]`;
  }
  return trimmed;
}

export function buildStorySystemPrompt(story: StoryRecord): string {
  const lines: string[] = [
    `The user attached one of their saved YFactory stories for context.`,
    `Story Title: ${story.storyName || 'Untitled Story'}`,
    `Aspect Ratio: ${story.aspectRatio}`,
    `Saved Scenes/Images: ${story.imageCount} / ${story.targetCount}`,
  ];
  if (story.characterTraits.length > 0) {
    lines.push(`Character Traits: ${story.characterTraits.join(', ')}`);
  }
  if (story.script.trim()) {
    const scriptText = story.script.trim().slice(0, 10_000);
    lines.push(`Story Script:`, scriptText);
  } else {
    lines.push(`(This story does not have a written script yet.)`);
  }
  lines.push(
    `Use this story context naturally when answering the user's request.`,
  );
  return lines.join('\n');
}

export function buildFileContextSuffix(files: PendingAttachment[]): string {
  const readyFiles = files.filter(
    (a) => a.kind === 'file' && a.status === 'ready' && a.textContent,
  );
  if (readyFiles.length === 0) return '';
  return readyFiles
    .map(
      (f) =>
        `\n\n--- Attached file: ${f.name} ---\n${f.textContent ?? ''}`,
    )
    .join('');
}

/* ==================== Browser Speech-to-Text Helper ==================== */

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isVoiceInputSupported(): boolean {
  return getSpeechCtor() !== null;
}

const SPEECH_LOCALE_MAP: Record<string, string> = {
  ar: 'ar-SA',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  tr: 'tr-TR',
  ru: 'ru-RU',
  ur: 'ur-PK',
  fa: 'fa-IR',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  hi: 'hi-IN',
  id: 'id-ID',
  bn: 'bn-BD',
};

export function resolveSpeechLocale(lang: string, sampleText?: string): string {
  const lower = lang.trim().toLowerCase();
  const base = lower.split('-')[0] ?? 'en';
  if (sampleText) {
    if (/[\u0600-\u06FF]/.test(sampleText)) {
      if (base === 'ur') return 'ur-PK';
      if (base === 'fa') return 'fa-IR';
      return 'ar-SA';
    }
    if (/[\u3040-\u30FF]/.test(sampleText)) return 'ja-JP';
    if (/[\uAC00-\uD7AF]/.test(sampleText)) return 'ko-KR';
    if (/[\u4E00-\u9FFF]/.test(sampleText)) {
      return lower === 'zh-tw' ? 'zh-TW' : 'zh-CN';
    }
    if (/[\u0900-\u097F]/.test(sampleText)) return 'hi-IN';
    if (/[\u0980-\u09FF]/.test(sampleText)) return 'bn-BD';
    if (/[\u0400-\u04FF]/.test(sampleText)) return 'ru-RU';
  }
  return SPEECH_LOCALE_MAP[lower] ?? SPEECH_LOCALE_MAP[base] ?? 'en-US';
}

export function startVoiceRecognition(options: {
  lang: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (code: string) => void;
}): (() => void) | null {
  const Ctor = getSpeechCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = resolveSpeechLocale(options.lang);
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i];
      const part = res?.[0]?.transcript ?? '';
      if (res?.isFinal) finalText += part;
      else interimText += part;
    }
    if (finalText.trim()) {
      options.onTranscript(finalText.trim(), true);
    } else if (interimText.trim()) {
      options.onTranscript(interimText.trim(), false);
    }
  };

  recognition.onerror = (ev) => {
    options.onError(ev.error ?? 'speech_error');
  };

  recognition.onend = () => {
    options.onEnd();
  };

  try {
    recognition.start();
  } catch {
    options.onError('speech_start_failed');
    return null;
  }

  return () => {
    try {
      recognition.stop();
    } catch {
      // ignore
    }
  };
}
