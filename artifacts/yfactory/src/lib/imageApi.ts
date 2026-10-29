export function createPollinationsImageUrl(prompt: string): string {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new Error('Enter a prompt before generating an image.');
  }

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(normalizedPrompt)}?width=1024&height=1024&seed=${Math.random()}`;
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
      throw new Error(
        apiMessage || `Image generation failed with status ${response.status}.`,
      );
    }

    const imageBlob = await response.blob();
    if (!imageBlob.type.startsWith('image/')) {
      throw new Error('The image service returned an unsupported response.');
    }
    return URL.createObjectURL(imageBlob);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Image generation timed out.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
