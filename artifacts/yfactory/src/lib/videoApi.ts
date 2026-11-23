export type VideoMode = "text_to_video" | "image_to_video";
export type VideoJobStatus = "queued" | "processing" | "completed" | "failed";

export type VideoModelOption = {
  id: string;
  providerId: string;
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
  providerConnected: boolean;
};

export type VideoJobItem = {
  id: string;
  providerId: string;
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
  videoUrl: string | null;
  hasVideoMedia: boolean;
  requiresMediaProxy: boolean;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export class VideoApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function videoRequest<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new VideoApiError(
      typeof data.error === "string" ? data.error : "Video request failed.",
      typeof data.code === "string" ? data.code : "video_request_failed",
      response.status,
    );
  }
  return data as T;
}

export async function fetchVideoModels(
  idToken: string,
): Promise<VideoModelOption[]> {
  const data = await videoRequest<{ models: VideoModelOption[] }>(
    "/api/video/models",
    idToken,
  );
  return data.models;
}

export async function fetchVideoJobs(idToken: string): Promise<VideoJobItem[]> {
  const data = await videoRequest<{ jobs: VideoJobItem[] }>(
    "/api/video/jobs",
    idToken,
  );
  return data.jobs;
}

export async function startVideoGeneration(
  idToken: string,
  input: {
    specId: string;
    mode: VideoMode;
    prompt: string;
    aspectRatio?: string;
    durationSec?: number;
    resolution?: string;
    imageInput?: string;
  },
): Promise<VideoJobItem> {
  const data = await videoRequest<{ job: VideoJobItem }>(
    "/api/video/generate",
    idToken,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.job;
}

export async function pollVideoJob(
  idToken: string,
  jobId: string,
): Promise<VideoJobItem> {
  const data = await videoRequest<{ job: VideoJobItem }>(
    `/api/video/jobs/${encodeURIComponent(jobId)}`,
    idToken,
  );
  return data.job;
}

export async function deleteVideoHistoryJob(
  idToken: string,
  jobId: string,
): Promise<void> {
  await videoRequest(
    `/api/video/jobs/${encodeURIComponent(jobId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export async function fetchProxiedVideoBlobUrl(
  idToken: string,
  jobId: string,
): Promise<string> {
  const resp = await fetch(`/api/video/jobs/${encodeURIComponent(jobId)}/media`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!resp.ok) {
    throw new VideoApiError("Could not load video file.", "media_failed", resp.status);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export async function prepareVideoImageDataUrl(file: File): Promise<string> {
  if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
    throw new Error("Image must be under 12 MB.");
  }
  const objUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objUrl;
    await img.decode();
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
