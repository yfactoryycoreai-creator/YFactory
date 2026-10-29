export type ImageProvider = 'agnes' | 'glm' | 'pollinations';

export type ProviderKeys = {
  agnes: string[];
  glm: string[];
};

export type GeneratedImageAsset = {
  base64: string;
  mimeType: string;
  provider: ImageProvider;
};

type JsonRecord = Record<string, unknown>;
type ImageFetch = typeof fetch;

const PROVIDER_TIMEOUT_MS = 35_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const keyIndexes: Record<'agnes' | 'glm', number> = { agnes: 0, glm: 0 };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function nextKey(
  provider: 'agnes' | 'glm',
  keys: ProviderKeys,
  environmentKey: string | undefined,
): string | null {
  const configuredKeys = keys[provider].map((key) => key.trim()).filter(Boolean);
  if (configuredKeys.length) {
    const index = keyIndexes[provider] % configuredKeys.length;
    keyIndexes[provider] += 1;
    return configuredKeys[index] ?? null;
  }
  return environmentKey?.trim() || null;
}

function imageMimeType(value: string | null | undefined): string {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(mimeType)
    ? mimeType
    : 'image/png';
}

function verifiedImageMimeType(bytes: Buffer): string {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 4, 8) === 'ftyp' &&
    ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))
  ) {
    return 'image/avif';
  }
  throw new Error('Provider returned invalid image data.');
}

function normalizeBase64(
  encoded: string,
  mimeType: string | null | undefined,
  provider: ImageProvider,
): GeneratedImageAsset {
  const dataUri = encoded.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  const base64 = dataUri?.[2] ?? encoded;
  const normalizedMimeType = imageMimeType(dataUri?.[1] ?? mimeType);
  if (!base64.trim()) throw new Error('Provider returned an empty image.');

  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Provider returned an invalid or oversized image.');
  }
  const verifiedMimeType = verifiedImageMimeType(bytes);
  return {
    base64: bytes.toString('base64'),
    mimeType: verifiedMimeType || normalizedMimeType,
    provider,
  };
}

function assertPublicHttpsUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Provider returned an unsafe image URL.');
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('127.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost) throw new Error('Provider returned an unsafe image URL.');
  return url;
}

async function imageFromUrl(
  rawUrl: string,
  provider: ImageProvider,
  signal: AbortSignal,
  fetchImage: ImageFetch,
): Promise<GeneratedImageAsset> {
  const url = assertPublicHttpsUrl(rawUrl);
  const response = await fetchImage(url, { signal });
  if (!response.ok) {
    throw new Error(`Provider image download returned HTTP ${response.status}.`);
  }
  const mimeType = response.headers.get('content-type');
  if (!mimeType?.toLowerCase().startsWith('image/')) {
    throw new Error('Provider returned a non-image response.');
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Provider returned an oversized image.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Provider returned an empty or oversized image.');
  }
  return {
    base64: bytes.toString('base64'),
    mimeType: verifiedImageMimeType(bytes),
    provider,
  };
}

async function parseProviderImage(
  response: Response,
  provider: ImageProvider,
  signal: AbortSignal,
  fetchImage: ImageFetch,
): Promise<GeneratedImageAsset> {
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Provider returned an empty or oversized image.');
    }
    return {
      base64: bytes.toString('base64'),
      mimeType: verifiedImageMimeType(bytes),
      provider,
    };
  }

  const payload: unknown = await response.json();
  const record = isRecord(payload) ? payload : {};
  const firstItem = Array.isArray(record.data) && isRecord(record.data[0])
    ? record.data[0]
    : {};
  const encoded =
    (typeof firstItem.b64_json === 'string' && firstItem.b64_json) ||
    (typeof firstItem.base64 === 'string' && firstItem.base64) ||
    (typeof record.b64_json === 'string' && record.b64_json) ||
    (typeof record.base64 === 'string' && record.base64);
  const mimeType =
    (typeof firstItem.mime_type === 'string' && firstItem.mime_type) ||
    (typeof firstItem.mimeType === 'string' && firstItem.mimeType) ||
    (typeof record.mime_type === 'string' && record.mime_type) ||
    'image/png';

  if (encoded) return normalizeBase64(encoded, mimeType, provider);

  const url =
    (typeof firstItem.url === 'string' && firstItem.url) ||
    (typeof record.url === 'string' && record.url);
  if (url) return imageFromUrl(url, provider, signal, fetchImage);
  throw new Error('Provider returned no usable image.');
}

async function requestProviderImage(
  provider: 'agnes' | 'glm',
  apiKey: string,
  prompt: string,
  fetchImage: ImageFetch,
): Promise<GeneratedImageAsset> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const endpoint =
      provider === 'agnes'
        ? 'https://apihub.agnes-ai.com/v1/images/generations'
        : 'https://open.bigmodel.cn/api/paas/v4/images/generations';
    const body =
      provider === 'agnes'
        ? {
            model: 'agnes-image-2.1-flash',
            prompt,
            size: '1K',
            ratio: '1:1',
            extra_body: { response_format: 'url' },
          }
        : { model: 'glm-image', prompt, size: '1280x1280' };
    const response = await fetchImage(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await parseProviderImage(response, provider, controller.signal, fetchImage);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestPollinationsImage(
  prompt: string,
  fetchImage: ImageFetch,
): Promise<GeneratedImageAsset> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=1024&height=1024&seed=${seed}`;
    const response = await fetchImage(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    const mimeType = response.headers.get('content-type');
    if (!mimeType?.toLowerCase().startsWith('image/')) {
      throw new Error('Provider returned a non-image response.');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Provider returned an oversized image.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Provider returned an empty or oversized image.');
    }
    return {
      base64: bytes.toString('base64'),
      mimeType: verifiedImageMimeType(bytes),
      provider: 'pollinations',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateImageWithFallback(
  prompt: string,
  keys: ProviderKeys,
  fetchImage: ImageFetch = fetch,
  onProviderFailure: (provider: ImageProvider, error: unknown) => void = () => undefined,
): Promise<GeneratedImageAsset> {
  for (const provider of ['agnes', 'glm'] as const) {
    const environmentKey =
      provider === 'agnes' ? process.env.AGNES_API_KEY : process.env.GLM_API_KEY;
    const apiKey = nextKey(provider, keys, environmentKey);
    if (!apiKey) continue;
    try {
      return await requestProviderImage(provider, apiKey, prompt, fetchImage);
    } catch (error) {
      onProviderFailure(provider, error);
    }
  }

  try {
    return await requestPollinationsImage(prompt, fetchImage);
  } catch (error) {
    onProviderFailure('pollinations', error);
    throw new Error('All image providers failed.');
  }
}
