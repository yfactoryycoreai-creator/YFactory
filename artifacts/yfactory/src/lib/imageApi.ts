export type ImageProvider = string;

export type GeneratedImage = {
  imageData: string;
  provider: ImageProvider;
  savedToFactory?: boolean;
  sizeBytes?: number;
  thumbnailUrl?: string;
};

export type EditedImage = {
  imageData: string;
  provider: string;
};

export const MAX_IMAGE_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RESIZED_REFERENCE_BYTES = 5 * 1024 * 1024;

export class ImageEditError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ImageEditError';
  }
}

export async function prepareImageReference(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const inferredType = file.type || (
    extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : ''
  );
  if (!allowedTypes.has(inferredType)) {
    throw new ImageEditError('Choose a JPG, PNG, or WEBP image.', 'invalid_reference');
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_REFERENCE_FILE_BYTES) {
    throw new ImageEditError('The source image must be 10 MB or smaller.', 'reference_too_large');
  }

  const objectUrl = URL.createObjectURL(file);
  let bitmap: ImageBitmap | null = null;
  try {
    let source: CanvasImageSource;
    let width: number;
    let height: number;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } else {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    if (!width || !height) throw new Error('invalid_image_dimensions');

    let edge = 1536;
    let quality = 0.86;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const scale = Math.min(1, edge / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('image_canvas_unavailable');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob && blob.size > 0 && blob.size <= MAX_RESIZED_REFERENCE_BYTES) {
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error('image_reference_read_failed'));
          reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('image_reference_read_failed'));
          };
          reader.readAsDataURL(blob);
        });
      }
      edge = Math.max(512, Math.floor(edge * 0.82));
      quality = Math.max(0.5, quality - 0.08);
    }
    throw new ImageEditError('The resized image is still too large.', 'reference_too_large');
  } catch (error) {
    if (error instanceof ImageEditError) throw error;
    throw new ImageEditError('The reference image could not be prepared.', 'invalid_reference');
  } finally {
    bitmap?.close();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function editImageFromReference(
  idToken: string,
  prompt: string,
  referenceImage: string,
): Promise<EditedImage> {
  let response: Response;
  try {
    response = await fetch('/api/images/edit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, referenceImage }),
    });
  } catch {
    throw new ImageEditError('Image editing could not be reached.', 'network_error');
  }
  const payload: unknown = await response.json().catch(() => null);
  const result = typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : {};
  if (!response.ok) {
    throw new ImageEditError(
      typeof result.error === 'string' ? result.error : 'The image could not be edited.',
      typeof result.code === 'string' ? result.code : 'image_edit_failed',
    );
  }
  const image = typeof result.image === 'object' && result.image !== null
    ? result.image as Record<string, unknown>
    : {};
  if (
    typeof image.base64 !== 'string' ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(String(image.mimeType)) ||
    typeof image.provider !== 'string'
  ) {
    throw new ImageEditError('The image edit returned an invalid result.', 'invalid_response');
  }
  return {
    imageData: `data:${image.mimeType};base64,${image.base64}`,
    provider: image.provider,
  };
}

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly failedCount = 0,
    public readonly skippedCount = 0,
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

type GenerationResponse = {
  images: GeneratedImage[];
  failedCount: number;
  skippedCount: number;
};

async function imageDataToStorageDataUrl(imageData: string): Promise<string> {
  const response = await fetch(imageData);
  if (!response.ok) throw new Error('Generated image data could not be read.');
  const originalBlob = await response.blob();
  let storageBlob = originalBlob;

  try {
    const bitmap = await createImageBitmap(originalBlob);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      storageBlob =
        (await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', 0.78),
        )) ?? originalBlob;
    }
    bitmap.close();
  } catch {
    storageBlob = originalBlob;
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Generated image could not be prepared.'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Generated image could not be prepared.'));
    };
    reader.readAsDataURL(storageBlob);
  });
}

export async function generateImages(
  idToken: string,
  storyId: string | null,
  prompt: string,
  count: number,
  signal?: AbortSignal,
): Promise<GenerationResponse> {
  let response: Response;
  try {
    response = await fetch('/api/images/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storyId, prompt, count }),
      signal,
    });
  } catch {
    throw new ImageGenerationError('Image generation failed.', 'network_error');
  }

  const payload: unknown = await response.json().catch(() => null);
  const result =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const code = typeof result.code === 'string' ? result.code : 'generation_failed';

  if (!response.ok) {
    throw new ImageGenerationError(
      typeof result.error === 'string'
        ? result.error
        : code === 'story_limit'
          ? 'Story limit reached.'
          : 'Image generation failed. Check enabled provider keys and try again.',
      code,
      typeof result.failedCount === 'number' ? result.failedCount : 0,
      typeof result.skippedCount === 'number' ? result.skippedCount : 0,
    );
  }

  if (
    !Array.isArray(result.images) ||
    typeof result.failedCount !== 'number' ||
    typeof result.skippedCount !== 'number'
  ) {
    throw new ImageGenerationError('Image generation returned an invalid response.', 'invalid_response');
  }

  const images: GeneratedImage[] = [];
  for (const item of result.images) {
    if (typeof item !== 'object' || item === null) continue;
    const image = item as Record<string, unknown>;
    if (typeof image.provider !== 'string' || !image.provider.trim()) continue;
    if (typeof image.url === 'string' && image.url.startsWith('https://')) {
      images.push({
        imageData: image.url,
        provider: image.provider as ImageProvider,
        ...(image.savedToFactory === true ? { savedToFactory: true } : {}),
        ...(typeof image.sizeBytes === 'number' ? { sizeBytes: image.sizeBytes } : {}),
        ...(typeof image.thumbnailUrl === 'string' ? { thumbnailUrl: image.thumbnailUrl } : {}),
      });
      continue;
    }
    if (typeof image.base64 !== 'string' || typeof image.mimeType !== 'string') continue;
    images.push({
      imageData: `data:${image.mimeType};base64,${image.base64}`,
      provider: image.provider as ImageProvider,
    });
  }

  if (!images.length) {
    throw new ImageGenerationError('Image generation failed.', 'all_providers_failed');
  }
  const preparedResults = await Promise.allSettled(
    images.map(async (image) =>
      image.savedToFactory || image.imageData.startsWith('https://')
        ? image
        : {
            ...image,
            imageData: await imageDataToStorageDataUrl(image.imageData),
          },
    ),
  );
  const preparedImages = preparedResults.flatMap((item) =>
    item.status === 'fulfilled' ? [item.value] : [],
  );
  if (!preparedImages.length) {
    throw new ImageGenerationError('Image generation failed.', 'image_preparation_failed');
  }
  return {
    images: preparedImages,
    failedCount:
      result.failedCount +
      preparedResults.filter((item) => item.status === 'rejected').length,
    skippedCount: result.skippedCount,
  };
}
