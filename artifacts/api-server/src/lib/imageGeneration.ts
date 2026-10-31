import {
  KeyPoolHttpError,
  keyPool,
  type KeyPoolProvider,
} from "./keyPool";

export type ImageProvider = string;
export type SceneFailureCode =
  | "missing_key"
  | "rate_limited"
  | "auth_failed"
  | "timeout"
  | "bad_prompt"
  | "save_failed";

export type GeneratedImageAsset = {
  base64: string;
  mimeType: string;
  provider: ImageProvider;
  sourceUrl?: string;
};

type JsonRecord = Record<string, unknown>;
type ImageFetch = typeof fetch;
type ImageKeyPool = Pick<typeof keyPool, "run">;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_ORDER = ["agnes", "cloudflare", "glm"] as const satisfies readonly KeyPoolProvider[];
const PROVIDER_DEADLINE_MS: Record<KeyPoolProvider, number> = {
  agnes: 35_000,
  cloudflare: 30_000,
  glm: 35_000,
  magic_hour: 30_000,
  pollinations: 35_000,
};
const SINGLE_IMAGE_RESTRICTION =
  "single image, one scene only, no grid, no collage, no panels, no text overlay";

export class ProviderAttemptError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderAttemptError";
  }
}

export class ImageGenerationFailure extends Error {
  constructor(public readonly code: SceneFailureCode) {
    super("Image generation failed.");
    this.name = "ImageGenerationFailure";
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
        model: "agnes-image-2.5-flash",
        prompt,
        n: 1,
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
        n: 1,
        size: "1280x1280",
      }),
      signal,
    },
  );
  return parseProviderImage(response, "glm", signal, fetchImage);
}

async function requestCloudflare(
  apiToken: string,
  accountId: string,
  prompt: string,
  fetchImage: ImageFetch,
  signal: AbortSignal,
): Promise<GeneratedImageAsset> {
  const response = await fetchImage(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
      signal,
    },
  );
  if (!response.ok) throw new KeyPoolHttpError(response.status);
  const payload: unknown = await response.json().catch(() => null);
  const image = asRecord(asRecord(payload).result).image;
  if (typeof image !== "string" || !image) {
    throw new ProviderAttemptError("Provider returned no usable image.");
  }
  return normalizeBase64(image, "image/png", "cloudflare");
}

async function requestPollinationsImage(
  prompt: string,
  fetchImage: ImageFetch,
  signal: AbortSignal,
): Promise<GeneratedImageAsset> {
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=768&height=768&seed=${seed}`;
  const response = await fetchImage(url, { signal });
  if (!response.ok) throw new KeyPoolHttpError(response.status);
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
}

export async function generateImageWithFallback(
  prompt: string,
  fetchImage: ImageFetch = fetch,
  jobSignal?: AbortSignal,
  pool: ImageKeyPool = keyPool,
): Promise<GeneratedImageAsset> {
  const completePrompt = prompt.includes(SINGLE_IMAGE_RESTRICTION)
    ? prompt
    : `${prompt.trim()} ${SINGLE_IMAGE_RESTRICTION}`;
  const reasons: SceneFailureCode[] = [];
  const providerOrder: readonly KeyPoolProvider[] = [
    ...PROVIDER_ORDER,
    "pollinations",
  ];

  for (const provider of providerOrder) {
    if (jobSignal?.aborted) throw new ImageGenerationFailure("timeout");
    const result = await pool.run(
      provider,
      async (credential, poolSignal) => {
        const signal = jobSignal
          ? AbortSignal.any([poolSignal, jobSignal])
          : poolSignal;
        try {
          if (provider === "agnes") {
            if (!credential.apiKey) throw new ProviderAttemptError("Missing provider credential.");
            return await requestAgnes(credential.apiKey, completePrompt, fetchImage, signal);
          }
          if (provider === "cloudflare") {
            if (!credential.apiKey || !credential.accountId) {
              throw new ProviderAttemptError("Missing provider credential.");
            }
            return await requestCloudflare(
              credential.apiKey,
              credential.accountId,
              completePrompt,
              fetchImage,
              signal,
            );
          }
          if (provider === "glm") {
            if (!credential.apiKey) throw new ProviderAttemptError("Missing provider credential.");
            return await requestGlm(credential.apiKey, completePrompt, fetchImage, signal);
          }
          return await requestPollinationsImage(completePrompt, fetchImage, signal);
        } catch (error) {
          if (jobSignal?.aborted) throw new KeyPoolHttpError(400);
          throw error;
        }
      },
      { totalDeadlineMs: PROVIDER_DEADLINE_MS[provider] },
    );
    if (result.ok) {
      return { ...result.value, provider };
    }
    if (jobSignal?.aborted) throw new ImageGenerationFailure("timeout");
    if (result.code === "deadline_exceeded") {
      reasons.push("timeout");
      continue;
    }
    if (result.code === "bad_prompt") {
      throw new ImageGenerationFailure("bad_prompt");
    }
    if (result.code === "no_credentials") {
      reasons.push("missing_key");
      continue;
    }
    const outcomes = new Set(result.attempts.map((attempt) => attempt.outcome));
    if (outcomes.has("auth_failed")) reasons.push("auth_failed");
    else if (outcomes.has("rate_limited")) reasons.push("rate_limited");
    else if (outcomes.has("timeout")) {
      reasons.push("timeout");
    } else if (result.attempts.length === 0) {
      reasons.push("missing_key");
    } else {
      reasons.push("timeout");
    }
  }

  const failureCode: SceneFailureCode = reasons.includes("auth_failed")
    ? "auth_failed"
    : reasons.includes("rate_limited")
      ? "rate_limited"
      : reasons.includes("timeout")
        ? "timeout"
        : "missing_key";
  throw new ImageGenerationFailure(failureCode);
}
