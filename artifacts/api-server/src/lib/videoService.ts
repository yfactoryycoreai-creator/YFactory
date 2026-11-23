import { Timestamp } from "firebase-admin/firestore";
import {
  clearProviderKeyCooldown,
  getDefaultProviderKeySecret,
  listVaultKeys,
  recordProviderKeyFailure,
} from "./apiKeyVault";
import { getFirebaseAdmin } from "./firebaseAdmin";

export type VideoMode = "text_to_video" | "image_to_video";
export type VideoJobStatus = "queued" | "processing" | "completed" | "failed";

export type VideoModelSpec = {
  id: string;
  providerId: "runway" | "luma-ai" | "fal" | "replicate" | "google";
  providerName: string;
  modelName: string;
  modelId: string;
  modes: VideoMode[];
  aspectRatios?: string[];
  durations?: number[];
  resolutions?: string[];
  acceptsDataUrlImage: boolean;
  docsUrl: string;
  pricingNote: string;
};

export type VideoJobRecord = {
  id: string;
  providerId: VideoModelSpec["providerId"];
  providerName: string;
  modelId: string;
  modelName: string;
  mode: VideoMode;
  prompt: string;
  aspectRatio: string | null;
  durationSec: number | null;
  resolution: string | null;
  status: VideoJobStatus;
  progress: number | null;
  externalTaskId: string | null;
  statusUrl: string | null;
  responseUrl: string | null;
  videoUrl: string | null;
  requiresMediaProxy: boolean;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export class VideoServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const VIDEO_MODEL_SPECS: ReadonlyArray<VideoModelSpec> = [
  {
    id: "runway:gen4_turbo",
    providerId: "runway",
    providerName: "Runway",
    modelName: "Gen-4 Turbo",
    modelId: "gen4_turbo",
    modes: ["image_to_video"],
    aspectRatios: ["1280:720", "720:1280", "1104:832", "832:1104", "960:960"],
    durations: [5, 10],
    acceptsDataUrlImage: true,
    docsUrl: "https://docs.dev.runwayml.com/",
    pricingNote: "Paid Runway API credits",
  },
  {
    id: "runway:gen3a_turbo",
    providerId: "runway",
    providerName: "Runway",
    modelName: "Gen-3 Alpha Turbo",
    modelId: "gen3a_turbo",
    modes: ["image_to_video"],
    aspectRatios: ["1280:768", "768:1280"],
    durations: [5, 10],
    acceptsDataUrlImage: true,
    docsUrl: "https://docs.dev.runwayml.com/",
    pricingNote: "Paid Runway API credits",
  },
  {
    id: "luma-ai:ray-2",
    providerId: "luma-ai",
    providerName: "Luma AI",
    modelName: "Ray 2",
    modelId: "ray-2",
    modes: ["text_to_video", "image_to_video"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [5, 9],
    resolutions: ["540p", "720p", "1080p"],
    acceptsDataUrlImage: false,
    docsUrl: "https://docs.lumalabs.ai/",
    pricingNote: "Paid Luma API credits (HTTPS image URL required for I2V)",
  },
  {
    id: "luma-ai:ray-flash-2",
    providerId: "luma-ai",
    providerName: "Luma AI",
    modelName: "Ray Flash 2",
    modelId: "ray-flash-2",
    modes: ["text_to_video", "image_to_video"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [5, 9],
    resolutions: ["540p", "720p", "1080p"],
    acceptsDataUrlImage: false,
    docsUrl: "https://docs.lumalabs.ai/",
    pricingNote: "Paid Luma API credits (HTTPS image URL required for I2V)",
  },
  {
    id: "fal:kling-t2v",
    providerId: "fal",
    providerName: "fal",
    modelName: "Kling 1.6 Standard (T2V)",
    modelId: "fal-ai/kling-video/v1.6/standard/text-to-video",
    modes: ["text_to_video"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    acceptsDataUrlImage: false,
    docsUrl: "https://fal.ai/models",
    pricingNote: "Paid fal inference",
  },
  {
    id: "fal:kling-i2v",
    providerId: "fal",
    providerName: "fal",
    modelName: "Kling 1.6 Standard (I2V)",
    modelId: "fal-ai/kling-video/v1.6/standard/image-to-video",
    modes: ["image_to_video"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    acceptsDataUrlImage: true,
    docsUrl: "https://fal.ai/models",
    pricingNote: "Paid fal inference",
  },
  {
    id: "fal:minimax-video-01",
    providerId: "fal",
    providerName: "fal",
    modelName: "MiniMax Hailuo Video-01",
    modelId: "fal-ai/minimax/video-01",
    modes: ["text_to_video", "image_to_video"],
    acceptsDataUrlImage: true,
    docsUrl: "https://fal.ai/models",
    pricingNote: "Paid fal inference",
  },
  {
    id: "fal:wan-t2v",
    providerId: "fal",
    providerName: "fal",
    modelName: "Alibaba Wan 2.1 (T2V)",
    modelId: "fal-ai/wan-t2v",
    modes: ["text_to_video"],
    aspectRatios: ["16:9", "9:16"],
    acceptsDataUrlImage: false,
    docsUrl: "https://fal.ai/models",
    pricingNote: "Paid fal hosted open-weight model",
  },
  {
    id: "fal:wan-i2v",
    providerId: "fal",
    providerName: "fal",
    modelName: "Alibaba Wan 2.1 (I2V)",
    modelId: "fal-ai/wan-i2v",
    modes: ["image_to_video"],
    aspectRatios: ["16:9", "9:16"],
    acceptsDataUrlImage: true,
    docsUrl: "https://fal.ai/models",
    pricingNote: "Paid fal hosted open-weight model",
  },
  {
    id: "replicate:minimax-video-01",
    providerId: "replicate",
    providerName: "Replicate",
    modelName: "MiniMax Video-01",
    modelId: "minimax/video-01",
    modes: ["text_to_video", "image_to_video"],
    acceptsDataUrlImage: true,
    docsUrl: "https://replicate.com/minimax/video-01",
    pricingNote: "Paid Replicate prediction billing",
  },
  {
    id: "replicate:luma-ray",
    providerId: "replicate",
    providerName: "Replicate",
    modelName: "Luma Ray (via Replicate)",
    modelId: "luma/ray",
    modes: ["text_to_video", "image_to_video"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    acceptsDataUrlImage: true,
    docsUrl: "https://replicate.com/luma/ray",
    pricingNote: "Paid Replicate prediction billing",
  },
  {
    id: "google:veo-2.0-generate-001",
    providerId: "google",
    providerName: "Google",
    modelName: "Veo 2",
    modelId: "veo-2.0-generate-001",
    modes: ["text_to_video", "image_to_video"],
    aspectRatios: ["16:9", "9:16"],
    durations: [5, 6, 7, 8],
    acceptsDataUrlImage: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/video",
    pricingNote: "Paid Gemini API (uses Google or Gemini key)",
  },
];

function videoJobsCollection(uid: string) {
  const { db } = getFirebaseAdmin();
  return db.collection("users").doc(uid).collection("videoJobs");
}

export function findVideoModelSpec(specId: string): VideoModelSpec | null {
  return VIDEO_MODEL_SPECS.find((m) => m.id === specId) ?? null;
}

async function resolveVideoProviderSecret(
  uid: string,
  providerId: VideoModelSpec["providerId"],
): Promise<{ provider: string; id: string; value: string } | null> {
  const primary = await getDefaultProviderKeySecret(uid, providerId);
  if (primary) return { provider: providerId, ...primary };
  if (providerId === "google") {
    const geminiKey = await getDefaultProviderKeySecret(uid, "gemini");
    if (geminiKey) return { provider: "gemini", ...geminiKey };
  }
  return null;
}

export async function listAvailableVideoModels(uid: string) {
  const keys = await listVaultKeys(uid);
  const readyProviders = new Set<string>();
  for (const k of keys) {
    if (k.enabled && k.status === "ready") {
      readyProviders.add(k.provider);
      if (k.provider === "gemini") readyProviders.add("google");
    }
  }
  return VIDEO_MODEL_SPECS.map((spec) => ({
    ...spec,
    providerConnected: readyProviders.has(spec.providerId),
  }));
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; rawText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const rawText = await resp.text().catch(() => "");
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON response handled via rawText.
    }
    return { ok: resp.ok, status: resp.status, data, rawText };
  } catch {
    throw new VideoServiceError(
      "Could not reach video provider API. Please try again.",
      "provider_unreachable",
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

function parseProviderError(
  status: number,
  data: Record<string, unknown>,
  fallback: string,
): string {
  if (status === 401 || status === 403) {
    return "API key rejected or lacks video generation permission.";
  }
  if (status === 429) {
    return "Provider rate limit or quota reached. Please wait and retry.";
  }
  const detail =
    typeof data.detail === "string"
      ? data.detail
      : typeof data.error === "string"
        ? data.error
        : typeof (data.error as { message?: unknown } | undefined)?.message === "string"
          ? String((data.error as { message: string }).message)
          : typeof data.message === "string"
            ? data.message
            : "";
  return detail ? detail.slice(0, 260) : `${fallback} (HTTP ${status})`;
}

function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1]!, base64: match[2]! };
}

export async function submitVideoGenerationJob(
  uid: string,
  input: {
    specId: string;
    mode: VideoMode;
    prompt: string;
    aspectRatio?: string;
    durationSec?: number;
    resolution?: string;
    imageInput?: string;
  },
): Promise<VideoJobRecord> {
  const spec = findVideoModelSpec(input.specId);
  if (!spec) {
    throw new VideoServiceError("Selected video model is not supported.", "invalid_model", 400);
  }
  if (!spec.modes.includes(input.mode)) {
    throw new VideoServiceError(
      `${spec.modelName} does not support ${input.mode.replace(/_/g, " ")}.`,
      "unsupported_mode",
      400,
    );
  }

  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 4000) {
    throw new VideoServiceError("Enter a valid video prompt.", "invalid_prompt", 400);
  }

  const imageInput = input.imageInput?.trim() || "";
  if (input.mode === "image_to_video") {
    if (!imageInput) {
      throw new VideoServiceError(
        "Provide a reference image for Image-to-Video.",
        "missing_reference_image",
        400,
      );
    }
    const isHttps = /^https:\/\/.+/i.test(imageInput);
    const isData = Boolean(splitDataUrl(imageInput));
    if (!isHttps && !isData) {
      throw new VideoServiceError(
        "Reference image must be a valid JPEG/PNG/WebP upload or HTTPS URL.",
        "invalid_reference_image",
        400,
      );
    }
    if (isData && !spec.acceptsDataUrlImage) {
      throw new VideoServiceError(
        `${spec.modelName} requires a public HTTPS image URL for Image-to-Video.`,
        "https_image_required",
        400,
      );
    }
  }

  const aspectRatio =
    spec.aspectRatios && input.aspectRatio && spec.aspectRatios.includes(input.aspectRatio)
      ? input.aspectRatio
      : spec.aspectRatios?.[0] ?? null;
  const durationSec =
    spec.durations && typeof input.durationSec === "number" && spec.durations.includes(input.durationSec)
      ? input.durationSec
      : spec.durations?.[0] ?? null;
  const resolution =
    spec.resolutions && input.resolution && spec.resolutions.includes(input.resolution)
      ? input.resolution
      : spec.resolutions?.[0] ?? null;

  const secret = await resolveVideoProviderSecret(uid, spec.providerId);
  if (!secret) {
    throw new VideoServiceError(
      `No active API key found for ${spec.providerName}. Add one in Provider Center.`,
      "missing_key",
      404,
    );
  }

  let externalTaskId: string | null = null;
  let statusUrl: string | null = null;
  let responseUrl: string | null = null;
  let requiresMediaProxy = false;

  if (spec.providerId === "runway") {
    const resp = await fetchJsonWithTimeout(
      "https://api.dev.runwayml.com/v1/image_to_video",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.value}`,
          "X-Runway-Version": "2024-11-06",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: spec.modelId,
          promptImage: imageInput,
          promptText: prompt,
          ...(aspectRatio ? { ratio: aspectRatio } : {}),
          ...(durationSec ? { duration: durationSec } : {}),
        }),
      },
    );
    if (!resp.ok) {
      await recordProviderKeyFailure(uid, secret.provider, secret.id, resp.status).catch(() => undefined);
      throw new VideoServiceError(
        parseProviderError(resp.status, resp.data, "Runway request failed"),
        "provider_error",
        resp.status >= 400 && resp.status < 500 ? resp.status : 502,
      );
    }
    externalTaskId = typeof resp.data.id === "string" ? resp.data.id : null;
  } else if (spec.providerId === "luma-ai") {
    const body: Record<string, unknown> = {
      model: spec.modelId,
      prompt,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      ...(durationSec ? { duration: `${durationSec}s` } : {}),
      ...(resolution ? { resolution } : {}),
      ...(input.mode === "image_to_video"
        ? { keyframes: { frame0: { type: "image", url: imageInput } } }
        : {}),
    };
    const resp = await fetchJsonWithTimeout(
      "https://api.lumalabs.ai/dream-machine/v1/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.value}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!resp.ok) {
      await recordProviderKeyFailure(uid, secret.provider, secret.id, resp.status).catch(() => undefined);
      throw new VideoServiceError(
        parseProviderError(resp.status, resp.data, "Luma AI request failed"),
        "provider_error",
        resp.status >= 400 && resp.status < 500 ? resp.status : 502,
      );
    }
    externalTaskId = typeof resp.data.id === "string" ? resp.data.id : null;
  } else if (spec.providerId === "fal") {
    const body: Record<string, unknown> = {
      prompt,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
      ...(durationSec ? { duration: String(durationSec) } : {}),
      ...(input.mode === "image_to_video" ? { image_url: imageInput } : {}),
    };
    const resp = await fetchJsonWithTimeout(
      `https://queue.fal.run/${spec.modelId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${secret.value}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!resp.ok) {
      await recordProviderKeyFailure(uid, secret.provider, secret.id, resp.status).catch(() => undefined);
      throw new VideoServiceError(
        parseProviderError(resp.status, resp.data, "fal video request failed"),
        "provider_error",
        resp.status >= 400 && resp.status < 500 ? resp.status : 502,
      );
    }
    externalTaskId = typeof resp.data.request_id === "string" ? resp.data.request_id : null;
    statusUrl = typeof resp.data.status_url === "string" ? resp.data.status_url : null;
    responseUrl = typeof resp.data.response_url === "string" ? resp.data.response_url : null;
  } else if (spec.providerId === "replicate") {
    const predInput: Record<string, unknown> = {
      prompt,
      ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    };
    if (input.mode === "image_to_video") {
      if (spec.modelId === "minimax/video-01") {
        predInput.first_frame_image = imageInput;
      } else {
        predInput.start_image_url = imageInput;
      }
    }
    const resp = await fetchJsonWithTimeout(
      `https://api.replicate.com/v1/models/${spec.modelId}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.value}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: predInput }),
      },
    );
    if (!resp.ok) {
      await recordProviderKeyFailure(uid, secret.provider, secret.id, resp.status).catch(() => undefined);
      throw new VideoServiceError(
        parseProviderError(resp.status, resp.data, "Replicate request failed"),
        "provider_error",
        resp.status >= 400 && resp.status < 500 ? resp.status : 502,
      );
    }
    externalTaskId = typeof resp.data.id === "string" ? resp.data.id : null;
  } else if (spec.providerId === "google") {
    const instance: Record<string, unknown> = { prompt };
    if (input.mode === "image_to_video") {
      const split = splitDataUrl(imageInput);
      if (!split) {
        throw new VideoServiceError(
          "Upload a JPEG/PNG/WebP image file for Google Veo Image-to-Video.",
          "upload_image_required",
          400,
        );
      }
      instance.image = {
        bytesBase64Encoded: split.base64,
        mimeType: split.mimeType,
      };
    }
    const resp = await fetchJsonWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.modelId)}:predictLongRunning`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": secret.value,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instances: [instance],
          parameters: {
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(durationSec ? { durationSeconds: durationSec } : {}),
          },
        }),
      },
    );
    if (!resp.ok) {
      await recordProviderKeyFailure(uid, secret.provider, secret.id, resp.status).catch(() => undefined);
      throw new VideoServiceError(
        parseProviderError(resp.status, resp.data, "Google Veo request failed"),
        "provider_error",
        resp.status >= 400 && resp.status < 500 ? resp.status : 502,
      );
    }
    externalTaskId = typeof resp.data.name === "string" ? resp.data.name : null;
    requiresMediaProxy = true;
  }

  if (!externalTaskId) {
    throw new VideoServiceError(
      "Provider accepted the request without returning a trackable job ID.",
      "missing_task_id",
      502,
    );
  }

  await clearProviderKeyCooldown(uid, secret.provider, secret.id).catch(() => undefined);

  const now = Date.now();
  const jobId = `vid_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const record: VideoJobRecord = {
    id: jobId,
    providerId: spec.providerId,
    providerName: spec.providerName,
    modelId: spec.modelId,
    modelName: spec.modelName,
    mode: input.mode,
    prompt,
    aspectRatio,
    durationSec,
    resolution,
    status: "queued",
    progress: 5,
    externalTaskId,
    statusUrl,
    responseUrl,
    videoUrl: null,
    requiresMediaProxy,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  await videoJobsCollection(uid)
    .doc(jobId)
    .set({ ...record, createdAtTs: Timestamp.fromMillis(now) });
  return record;
}

function recordFromDoc(id: string, d: Record<string, unknown>): VideoJobRecord {
  return {
    id,
    providerId: (d.providerId as VideoModelSpec["providerId"]) ?? "runway",
    providerName: String(d.providerName ?? ""),
    modelId: String(d.modelId ?? ""),
    modelName: String(d.modelName ?? ""),
    mode: d.mode === "image_to_video" ? "image_to_video" : "text_to_video",
    prompt: String(d.prompt ?? ""),
    aspectRatio: typeof d.aspectRatio === "string" ? d.aspectRatio : null,
    durationSec: typeof d.durationSec === "number" ? d.durationSec : null,
    resolution: typeof d.resolution === "string" ? d.resolution : null,
    status:
      d.status === "completed" || d.status === "failed" || d.status === "processing"
        ? d.status
        : "queued",
    progress: typeof d.progress === "number" ? d.progress : null,
    externalTaskId: typeof d.externalTaskId === "string" ? d.externalTaskId : null,
    statusUrl: typeof d.statusUrl === "string" ? d.statusUrl : null,
    responseUrl: typeof d.responseUrl === "string" ? d.responseUrl : null,
    videoUrl: typeof d.videoUrl === "string" ? d.videoUrl : null,
    requiresMediaProxy: d.requiresMediaProxy === true,
    errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : null,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

export async function listVideoJobs(uid: string, limit = 30): Promise<VideoJobRecord[]> {
  const snap = await videoJobsCollection(uid)
    .orderBy("createdAt", "desc")
    .limit(Math.max(1, Math.min(limit, 60)))
    .get();
  return snap.docs.map((doc) => recordFromDoc(doc.id, doc.data()));
}

export async function getVideoJobById(
  uid: string,
  jobId: string,
): Promise<VideoJobRecord | null> {
  const snap = await videoJobsCollection(uid).doc(jobId).get();
  if (!snap.exists) return null;
  return recordFromDoc(snap.id, snap.data() ?? {});
}

export async function pollVideoJobStatus(
  uid: string,
  jobId: string,
): Promise<VideoJobRecord | null> {
  const job = await getVideoJobById(uid, jobId);
  if (!job) return null;
  if (job.status === "completed" || job.status === "failed" || !job.externalTaskId) {
    return job;
  }

  const secret = await resolveVideoProviderSecret(uid, job.providerId);
  if (!secret) {
    return job;
  }

  let nextStatus: VideoJobStatus = job.status;
  let nextProgress = job.progress;
  let nextVideoUrl = job.videoUrl;
  let nextError = job.errorMessage;

  if (job.providerId === "runway") {
    const resp = await fetchJsonWithTimeout(
      `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(job.externalTaskId)}`,
      {
        headers: {
          Authorization: `Bearer ${secret.value}`,
          "X-Runway-Version": "2024-11-06",
        },
      },
    );
    if (resp.ok) {
      const st = String(resp.data.status ?? "").toUpperCase();
      if (typeof resp.data.progress === "number") {
        nextProgress = Math.round(resp.data.progress <= 1 ? resp.data.progress * 100 : resp.data.progress);
      }
      if (st === "SUCCEEDED") {
        nextStatus = "completed";
        nextProgress = 100;
        const out = resp.data.output;
        if (Array.isArray(out) && typeof out[0] === "string") nextVideoUrl = out[0];
      } else if (st === "FAILED" || st === "CANCELLED") {
        nextStatus = "failed";
        nextError = typeof resp.data.failure === "string" ? resp.data.failure : "Runway generation failed.";
      } else if (st === "RUNNING") {
        nextStatus = "processing";
      }
    }
  } else if (job.providerId === "luma-ai") {
    const resp = await fetchJsonWithTimeout(
      `https://api.lumalabs.ai/dream-machine/v1/generations/${encodeURIComponent(job.externalTaskId)}`,
      { headers: { Authorization: `Bearer ${secret.value}` } },
    );
    if (resp.ok) {
      const st = String(resp.data.state ?? "").toLowerCase();
      if (st === "completed") {
        nextStatus = "completed";
        nextProgress = 100;
        const assets = resp.data.assets as { video?: unknown } | undefined;
        if (typeof assets?.video === "string") nextVideoUrl = assets.video;
      } else if (st === "failed") {
        nextStatus = "failed";
        nextError =
          typeof resp.data.failure_reason === "string"
            ? resp.data.failure_reason
            : "Luma AI generation failed.";
      } else if (st === "dreaming") {
        nextStatus = "processing";
        nextProgress = 55;
      }
    }
  } else if (job.providerId === "fal" && job.statusUrl) {
    const resp = await fetchJsonWithTimeout(job.statusUrl, {
      headers: { Authorization: `Key ${secret.value}` },
    });
    if (resp.ok) {
      const st = String(resp.data.status ?? "").toUpperCase();
      if (st === "COMPLETED" && job.responseUrl) {
        const resResp = await fetchJsonWithTimeout(job.responseUrl, {
          headers: { Authorization: `Key ${secret.value}` },
        });
        const vid = resResp.data.video as { url?: unknown } | undefined;
        if (typeof vid?.url === "string") {
          nextStatus = "completed";
          nextProgress = 100;
          nextVideoUrl = vid.url;
        } else {
          nextStatus = "failed";
          nextError = "Video completed but no video URL was returned by fal.";
        }
      } else if (st === "FAILED") {
        nextStatus = "failed";
        nextError = "fal video generation failed.";
      } else if (st === "IN_PROGRESS") {
        nextStatus = "processing";
        nextProgress = 55;
      }
    }
  } else if (job.providerId === "replicate") {
    const resp = await fetchJsonWithTimeout(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(job.externalTaskId)}`,
      { headers: { Authorization: `Bearer ${secret.value}` } },
    );
    if (resp.ok) {
      const st = String(resp.data.status ?? "").toLowerCase();
      if (st === "succeeded") {
        nextStatus = "completed";
        nextProgress = 100;
        const out = resp.data.output;
        if (typeof out === "string") nextVideoUrl = out;
        else if (Array.isArray(out) && typeof out[0] === "string") nextVideoUrl = out[0];
      } else if (st === "failed" || st === "canceled") {
        nextStatus = "failed";
        nextError = typeof resp.data.error === "string" ? resp.data.error : "Replicate prediction failed.";
      } else if (st === "processing") {
        nextStatus = "processing";
        nextProgress = 50;
      }
    }
  } else if (job.providerId === "google") {
    const opPath = job.externalTaskId.replace(/^\/+/, "");
    const resp = await fetchJsonWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/${opPath}`,
      { headers: { "x-goog-api-key": secret.value } },
    );
    if (resp.ok) {
      if (resp.data.done === true) {
        const errObj = resp.data.error as { message?: unknown } | undefined;
        if (errObj) {
          nextStatus = "failed";
          nextError = typeof errObj.message === "string" ? errObj.message : "Google Veo generation failed.";
        } else {
          const responseObj = resp.data.response as {
            generateVideoResponse?: {
              generatedSamples?: Array<{ video?: { uri?: string } }>;
            };
          } | undefined;
          const uri = responseObj?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
          if (typeof uri === "string" && uri) {
            nextStatus = "completed";
            nextProgress = 100;
            nextVideoUrl = uri;
          } else {
            nextStatus = "failed";
            nextError = "Google Veo finished without returning a video sample.";
          }
        }
      } else {
        nextStatus = "processing";
        nextProgress = 45;
      }
    }
  }

  const updatedAt = Date.now();
  const updated: VideoJobRecord = {
    ...job,
    status: nextStatus,
    progress: nextProgress,
    videoUrl: nextVideoUrl,
    errorMessage: nextError,
    updatedAt,
  };
  await videoJobsCollection(uid).doc(job.id).update({
    status: updated.status,
    progress: updated.progress,
    videoUrl: updated.videoUrl,
    errorMessage: updated.errorMessage,
    updatedAt: updated.updatedAt,
  });
  return updated;
}

export async function fetchProxiedVideoMedia(
  uid: string,
  jobId: string,
): Promise<{ contentType: string; buffer: Buffer } | null> {
  const job = await getVideoJobById(uid, jobId);
  if (!job || !job.videoUrl) return null;
  const headers: Record<string, string> = {};
  if (job.providerId === "google") {
    const secret = await resolveVideoProviderSecret(uid, "google");
    if (!secret) return null;
    headers["x-goog-api-key"] = secret.value;
  }
  const resp = await fetch(job.videoUrl, { headers });
  if (!resp.ok) return null;
  const contentType = resp.headers.get("content-type") || "video/mp4";
  const arr = await resp.arrayBuffer();
  return { contentType, buffer: Buffer.from(arr) };
}

export async function deleteVideoJob(uid: string, jobId: string): Promise<boolean> {
  const ref = videoJobsCollection(uid).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}
