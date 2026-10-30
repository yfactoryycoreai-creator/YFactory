import { createHash } from "node:crypto";
import { decryptVaultSecret, listProviderConfigs } from "./apiKeyVault";
import { getFirebaseAdmin } from "./firebaseAdmin";

type CloudinaryCredentials = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  bytes: number;
  format: string;
};

function parseCloudinaryUrl(raw: string | undefined): CloudinaryCredentials | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const cloudName = url.hostname;
    const apiKey = decodeURIComponent(url.username);
    const apiSecret = decodeURIComponent(url.password);
    if (url.protocol !== "cloudinary:" || !cloudName || !apiKey || !apiSecret) {
      return null;
    }
    return { cloudName, apiKey, apiSecret };
  } catch {
    return null;
  }
}

async function credentialsForUser(uid: string): Promise<CloudinaryCredentials | null> {
  const db = getFirebaseAdmin().db;
  const storageProviders = (await listProviderConfigs(uid)).filter(
    (provider) => provider.category === "storage" &&
      provider.adapter === "cloudinary" && provider.enabled,
  );
  const keysByProvider = await Promise.all(storageProviders.map(async (provider) => ({
    provider,
    snapshot: await db.collection("users").doc(uid).collection("providerKeys")
      .doc(provider.id).collection("keys").where("enabled", "==", true).get(),
  })));
  const latest = keysByProvider
    .flatMap(({ provider, snapshot }) => snapshot.docs.map((document) => ({ provider, document })))
    .sort((left, right) => {
      const leftAt = left.document.data().createdAt?.toMillis?.() ?? 0;
      const rightAt = right.document.data().createdAt?.toMillis?.() ?? 0;
      return rightAt - leftAt;
    })[0];
  if (latest) {
    const credentials = parseCloudinaryUrl(decryptVaultSecret(latest.document.data()));
    if (!credentials) throw new Error("The enabled Cloudinary vault key has an invalid format.");
    return credentials;
  }
  const defaultProvider = storageProviders.find((provider) => provider.id === "cloudinary");
  return defaultProvider ? parseCloudinaryUrl(process.env.CLOUDINARY_URL) : null;
}

function signParameters(
  params: Record<string, string | number | boolean>,
  apiSecret: string,
): string {
  const canonical = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  return createHash("sha1").update(`${canonical}${apiSecret}`).digest("hex");
}

export function cloudinaryThumbnailUrl(url: string): string {
  return url.replace("/image/upload/", "/image/upload/w_400,q_auto,f_auto/");
}

export function cloudinaryWebpUrl(url: string): string {
  return url.replace("/image/upload/", "/image/upload/f_webp/");
}

export async function hasCloudinaryCredentials(uid: string): Promise<boolean> {
  return Boolean(await credentialsForUser(uid));
}

export async function uploadStoryImage(
  uid: string,
  folder: string,
  publicId: string,
  bytes: Buffer,
  mimeType: string,
): Promise<CloudinaryUploadResult | null> {
  const credentials = await credentialsForUser(uid);
  if (!credentials) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { folder, overwrite: false, public_id: publicId, timestamp };
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: mimeType }));
  form.set("api_key", credentials.apiKey);
  form.set("folder", folder);
  form.set("public_id", publicId);
  form.set("overwrite", "false");
  form.set("timestamp", String(timestamp));
  form.set("signature", signParameters(signed, credentials.apiSecret));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/upload`,
    { method: "POST", body: form, signal: AbortSignal.timeout(40_000) },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error(`Cloudinary upload failed (HTTP ${response.status}).`);
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.secure_url !== "string" || typeof record.public_id !== "string") {
    throw new Error("Cloudinary returned an incomplete upload result.");
  }
  return {
    secureUrl: record.secure_url,
    publicId: record.public_id,
    bytes: typeof record.bytes === "number" ? record.bytes : bytes.length,
    format: typeof record.format === "string" ? record.format : "image",
  };
}

export async function deleteCloudinaryImage(
  uid: string,
  publicId: string,
): Promise<void> {
  const credentials = await credentialsForUser(uid);
  if (!credentials) return;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  const form = new FormData();
  form.set("public_id", publicId);
  form.set("timestamp", String(timestamp));
  form.set("api_key", credentials.apiKey);
  form.set("signature", signParameters(params, credentials.apiSecret));
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/destroy`,
    { method: "POST", body: form, signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) {
    throw new Error(`Cloudinary delete failed (HTTP ${response.status}).`);
  }
}

export async function getCloudinaryUsage(uid: string): Promise<{
  configured: boolean;
  usedBytes: number | null;
  limitBytes: number | null;
}> {
  const credentials = await credentialsForUser(uid);
  if (!credentials) return { configured: false, usedBytes: null, limitBytes: null };
  const basic = Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString("base64");
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/usage`,
    {
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`Cloudinary usage request failed (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("Cloudinary returned invalid usage information.");
  }
  const root = payload as Record<string, unknown>;
  const storage = typeof root.storage === "object" && root.storage !== null
    ? root.storage as Record<string, unknown>
    : {};
  const used = typeof storage.usage === "number" ? storage.usage
    : typeof root.storage_usage === "number" ? root.storage_usage : null;
  const limit = typeof storage.limit === "number" ? storage.limit
    : typeof root.storage_limit === "number" ? root.storage_limit : null;
  return { configured: true, usedBytes: used, limitBytes: limit };
}
