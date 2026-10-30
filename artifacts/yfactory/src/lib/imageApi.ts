export type ImageProvider = string;

export type GeneratedImage = {
  imageData: string;
  provider: ImageProvider;
  savedToFactory?: boolean;
  sizeBytes?: number;
  thumbnailUrl?: string;
};

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
