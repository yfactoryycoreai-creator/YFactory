export const POLLINATIONS_FREE_IMAGE_INTERVAL_MS = 45_000;

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export function createPollinationsImageUrl(prompt: string): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('Enter a prompt before generating an image.');
  }

  const seed = Math.floor(Math.random() * 2_147_483_647);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(normalizedPrompt)}?width=1024&height=1024&seed=${seed}`;
}

function retryAfterFromResponse(
  response: Response,
  message: string,
): number | null {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  const messageMatch = message.match(/retry after\s+(\d+)\s*s(?:ec(?:onds?)?)?/i);
  return messageMatch ? Number(messageMatch[1]) * 1000 : null;
}

function imageBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The generated image could not be saved.'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The generated image could not be saved.'));
    };
    reader.readAsDataURL(blob);
  });
}

async function compressImageForStorage(imageBlob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(imageBlob);
    const canvas = document.createElement('canvas');
    const maxDimension = 1024;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return imageBlob;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.78),
    );
    return compressed ?? imageBlob;
  } catch {
    return imageBlob;
  }
}

export async function generateImage(prompt: string): Promise<string> {
  const imageUrl = createPollinationsImageUrl(prompt);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 180_000);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: { message?: unknown };
            message?: unknown;
          }
        | null;
      const apiMessage =
        typeof payload?.error?.message === 'string'
          ? payload.error.message
          : typeof payload?.message === 'string'
            ? payload.message
            : '';
      const message =
        apiMessage || `Image generation failed with status ${response.status}.`;
      throw new ImageGenerationError(
        message,
        retryAfterFromResponse(response, message),
      );
    }

    const imageBlob = await response.blob();
    if (!imageBlob.type.startsWith('image/')) {
      throw new ImageGenerationError(
        'The image service returned an unsupported response.',
      );
    }
    const compressedBlob = await compressImageForStorage(imageBlob);
    return await imageBlobToDataUrl(compressedBlob);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ImageGenerationError('Image generation timed out.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
