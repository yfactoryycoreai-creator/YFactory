import type {
  ProviderConfig,
  ProviderGenerationKeys,
  ProviderKey,
} from "./apiKeyVault";

export type ImageProvider = string;

export type GeneratedImageAsset = {
  base64: string;
  mimeType: string;
  provider: ImageProvider;
  sourceUrl?: string;
};

type JsonRecord = Record<string, unknown>;
type ImageFetch = typeof fetch;
type KeyFailureHandler = (
  provider: ProviderKey,
  keyId: string,
  status: number | null,
) => Promise<void> | void;

const PROVIDER_TIMEOUT_MS = 40_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class ProviderAttemptError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderAttemptError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function imageMimeType(value: string | null | undefined): string {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
  ].includes(mimeType)
    ? mimeType
    : "image/png";
}

function verifiedImageMimeType(bytes: Buffer): string {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))
  ) {
    return "image/avif";
  }
  throw new ProviderAttemptError("Provider returned invalid image data.");
}

function normalizeBase64(
  encoded: string,
  mimeType: string | null | undefined,
  provider: ImageProvider,
): GeneratedImageAsset {
  const dataUri = encoded.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  const base64 = dataUri?.[2] ?? encoded;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new ProviderAttemptError("Provider returned an invalid or oversized image.");
  }
  return {
    base64: bytes.toString("base64"),
    mimeType: verifiedImageMimeType(bytes) || imageMimeType(dataUri?.[1] ?? mimeType),
    provider,
  };
}

function assertPublicHttpsUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderAttemptError("Provider returned an invalid image URL.");
  }
  if (url.protocol !== "https:") {
    throw new ProviderAttemptError("Provider returned an unsafe image URL.");
  }
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("127.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost) {
    throw new ProviderAttemptError("Provider returned an unsafe image URL.");
  }
  return url;
}

async function imageFromUrl(
  rawUrl: string,
  provider: ImageProvider,
  signal: AbortSignal,
  fetchImage: ImageFetch,
): Promise<GeneratedImageAsset> {
  const url = assertPublicHttpsUrl(rawUrl);
  let response: Response;
  try {
    response = await fetchImage(url, { signal });
  } catch (error) {
    throw new ProviderAttemptError(
      error instanceof Error && error.name === "AbortError"
        ? "Provider image download timed out."
        : "Provider image download failed.",
    );
  }
  if (!response.ok) {
    throw new ProviderAttemptError(
      `Provider image download returned HTTP ${response.status}.`,
      response.status,
    );
  }
  const mimeType = response.headers.get("content-type");
  if (!mimeType?.toLowerCase().startsWith("image/")) {
    throw new ProviderAttemptError("Provider returned a non-image response.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new ProviderAttemptError("Provider returned an oversized image.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new ProviderAttemptError("Provider returned an empty or oversized image.");
  }
  return {
    base64: bytes.toString("base64"),
    mimeType: verifiedImageMimeType(bytes),
    provider,
    sourceUrl: rawUrl,
  };
}

async function parseProviderImage(
  response: Response,
  provider: ImageProvider,
  signal: AbortSignal,
  fetchImage: ImageFetch,
): Promise<GeneratedImageAsset> {
  if (!response.ok) {
    throw new ProviderAttemptError(
      `Provider returned HTTP ${response.status}.`,
      response.status,
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderAttemptError("Provider returned an empty or oversized image.");
    }
    return {
      base64: bytes.toString("base64"),
      mimeType: verifiedImageMimeType(bytes),
      provider,
    };
  }

  const payload: unknown = await response.json().catch(() => null);
  const record = asRecord(payload);
  const firstItem =
    Array.isArray(record.data) && isRecord(record.data[0]) ? record.data[0] : {};
  const encoded =
    (typeof firstItem.b64_json === "string" && firstItem.b64_json) ||
    (typeof firstItem.base64 === "string" && firstItem.base64) ||
    (typeof record.b64_json === "string" && record.b64_json) ||
    (typeof record.base64 === "string" && record.base64);
  const mimeType =
    (typeof firstItem.mime_type === "string" && firstItem.mime_type) ||
    (typeof firstItem.mimeType === "string" && firstItem.mimeType) ||
    (typeof record.mime_type === "string" && record.mime_type) ||
    "image/png";
  if (encoded) return normalizeBase64(encoded, mimeType, provider);

  const url =
    (typeof firstItem.url === "string" && firstItem.url) ||
    (typeof record.url === "string" && record.url);
  if (url) return imageFromUrl(url, provider, signal, fetchImage);
  throw new ProviderAttemptError("Provider returned no usable image.");
}

async function requestAgnes(
  apiKey: string,
  prompt: string,
  fetchImage: ImageFetch,
  signal: AbortSignal,
): Promise<GeneratedImageAsset> {
  const response = await fetchImage(
    "https://apihub.agnes-ai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "agnes-image-2.1-flash",
        prompt,
        size: "1K",
        ratio: "1:1",
        extra_body: { response_format: "url" },
      }),
      signal,
    },
  );
  return parseProviderImage(response, "agnes", signal, fetchImage);
}

async function requestGlm(
  apiKey: string,
  prompt: string,
  fetchImage: ImageFetch,
  signal: AbortSignal,
): Promise<GeneratedImageAsset> {
  const response = await fetchImage(
    "https://open.bigmodel.cn/api/paas/v4/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-image",
        prompt,
        size: "1280x1280",
      }),
      signal,
    },
  );
  return parseProviderImage(response, "glm", signal, fetchImage);
}

async function requestProvider(
  provider: ProviderConfig,
  apiKey: string,
  prompt: string,
  fetchImage: ImageFetch,
  signal: AbortSignal,
): Promise<GeneratedImageAsset> {
  if (provider.adapter === "agnes") {
    return requestAgnes(apiKey, prompt, fetchImage, signal).then((asset) => ({
      ...asset,
      provider: provider.id,
    }));
  }
  if (provider.adapter === "glm") {
    return requestGlm(apiKey, prompt, fetchImage, signal).then((asset) => ({
      ...asset,
      provider: provider.id,
    }));
  }
  if (provider.adapter === "openai-compatible") {
    const baseUrl = provider.baseUrl?.trim().replace(/\/+$/, "");
    const model = provider.model?.trim();
    if (!baseUrl || !model) {
      throw new ProviderAttemptError("OpenAI-compatible provider needs a base URL and model.");
    }
    const parsedUrl = assertPublicHttpsUrl(baseUrl);
    const endpoint = /\/v\d+(?:\/|$)/i.test(parsedUrl.pathname)
      ? `${baseUrl}/images/generations`
      : `${baseUrl}/v1/images/generations`;
    const response = await fetchImage(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt, n: 1, response_format: "url" }),
      signal,
    });
    return parseProviderImage(response, provider.id, signal, fetchImage);
  }
  if (provider.adapter === "zsky") {
    // Its current API contract is not established; never send user keys to a guessed endpoint.
    throw new ProviderAttemptError("ZSky is skipped until its API format is verified.");
  }
  throw new ProviderAttemptError("This provider is not an image-generation adapter.");
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
    if (!response.ok) {
      throw new ProviderAttemptError(
        `Provider returned HTTP ${response.status}.`,
        response.status,
      );
    }
    const mimeType = response.headers.get("content-type");
    if (!mimeType?.toLowerCase().startsWith("image/")) {
      throw new ProviderAttemptError("Provider returned a non-image response.");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new ProviderAttemptError("Provider returned an oversized image.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderAttemptError("Provider returned an empty or oversized image.");
    }
    return {
      base64: bytes.toString("base64"),
      mimeType: verifiedImageMimeType(bytes),
      provider: "pollinations",
      sourceUrl: url,
    };
  } catch (error) {
    if (error instanceof ProviderAttemptError) throw error;
    throw new ProviderAttemptError(
      error instanceof Error && error.name === "AbortError"
        ? "Pollinations timed out."
        : "Pollinations request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateImageWithFallback(
  prompt: string,
  keys: ProviderGenerationKeys,
  providers: ProviderConfig[],
  fetchImage: ImageFetch = fetch,
  onKeyFailure: KeyFailureHandler = () => undefined,
  onKeySuccess: KeyFailureHandler = () => undefined,
  onProviderFailure: (provider: ImageProvider, status: number | null) => void = () => undefined,
): Promise<GeneratedImageAsset> {
  const providerOrder = providers
    .filter((provider) => provider.category === "image" && provider.enabled && provider.adapter !== "pollinations")
    .sort((left, right) => left.rotationOrder - right.rotationOrder);
  for (const provider of providerOrder) {
    if (provider.adapter === "zsky") continue;
    const providerKeys = keys[provider.id] ?? { hasVaultKeys: false, keys: [] };
    const candidates = [...providerKeys.keys];
    if (
      !providerKeys.hasVaultKeys &&
      provider.id === "agnes" &&
      process.env.AGNES_API_KEY?.trim()
    ) {
      candidates.push({ id: "environment", value: process.env.AGNES_API_KEY.trim() });
    }
    if (
      !providerKeys.hasVaultKeys &&
      provider.id === "glm" &&
      process.env.GLM_API_KEY?.trim()
    ) {
      candidates.push({ id: "environment", value: process.env.GLM_API_KEY.trim() });
    }

    for (const candidate of candidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      try {
        const image = await requestProvider(
          provider,
          candidate.value,
          prompt,
          fetchImage,
          controller.signal,
        );
        await onKeySuccess(provider.id, candidate.id, null);
        return image;
      } catch (error) {
        const status =
          error instanceof ProviderAttemptError ? error.status : null;
        if (controller.signal.aborted) {
          await onKeyFailure(provider.id, candidate.id, null);
          onProviderFailure(provider.id, null);
        } else {
          await onKeyFailure(provider.id, candidate.id, status);
          onProviderFailure(provider.id, status);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  try {
    if (providers.some((provider) => provider.id === "pollinations" && provider.enabled)) {
      return await requestPollinationsImage(prompt, fetchImage);
    }
    throw new ProviderAttemptError("No enabled image providers are configured.");
  } catch (error) {
    onProviderFailure(
      "pollinations",
      error instanceof ProviderAttemptError ? error.status : null,
    );
    throw new Error("All image providers failed.");
  }
}
