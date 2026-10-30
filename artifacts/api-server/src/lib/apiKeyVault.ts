import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getFirebaseAdmin, requireEncryptionKey } from "./firebaseAdmin";

export const BUILT_IN_PROVIDERS = [
  { id: "agnes", name: "Agnes", category: "image", adapter: "agnes", enabled: true, rotationOrder: 0 },
  { id: "glm", name: "GLM", category: "image", adapter: "glm", enabled: true, rotationOrder: 1 },
  { id: "zsky", name: "ZSky", category: "image", adapter: "zsky", enabled: false, rotationOrder: 2 },
  { id: "pollinations", name: "Pollinations", category: "image", adapter: "pollinations", enabled: true, rotationOrder: 3 },
  { id: "cloudinary", name: "Cloudinary", category: "storage", adapter: "cloudinary", enabled: true, rotationOrder: 0 },
] as const;
export type ProviderKey = string;
export type ProviderCategory = "image" | "storage";
export type ProviderAdapter =
  | "agnes"
  | "glm"
  | "zsky"
  | "pollinations"
  | "cloudinary"
  | "openai-compatible";
export type ProviderConfig = {
  id: string;
  name: string;
  category: ProviderCategory;
  adapter: ProviderAdapter;
  enabled: boolean;
  rotationOrder: number;
  baseUrl?: string;
  model?: string;
  builtIn: boolean;
  secretFallback?: string;
};
export type ProviderKeyStatus = "ready" | "failing" | "cooldown";

type EncryptedFields = {
  iv: string;
  tag: string;
  ciphertext: string;
};

type StoredKey = DocumentData & {
  label?: unknown;
  enabled?: unknown;
  createdAt?: unknown;
  failureStatus?: unknown;
  cooldownUntil?: unknown;
  iv?: unknown;
  tag?: unknown;
  ciphertext?: unknown;
};

export type VaultKeyMetadata = {
  id: string;
  provider: ProviderKey;
  label: string;
  maskedValue: string;
  enabled: boolean;
  createdAt: number;
  status: ProviderKeyStatus;
  cooldownUntil?: number;
};

export type GenerationKey = {
  id: string;
  value: string;
};

export type ProviderGenerationKeys = Record<
  string,
  { hasVaultKeys: boolean; keys: GenerationKey[] }
>;

const LEGACY_PROVIDERS = ["zsky", "agnes", "glm"] as const;
const legacyFields: Record<(typeof LEGACY_PROVIDERS)[number], string> = {
  zsky: "zsky_keys",
  agnes: "agnes_keys",
  glm: "glm_keys",
};
const rotationOffsets = new Map<string, number>();

function encryptValue(value: string): EncryptedFields {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptValue(data: StoredKey): string {
  if (
    typeof data.iv !== "string" ||
    typeof data.tag !== "string" ||
    typeof data.ciphertext !== "string"
  ) {
    throw new Error("An encrypted provider key is incomplete.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    requireEncryptionKey(),
    Buffer.from(data.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptVaultSecret(data: Record<string, unknown>): string {
  return decryptValue(data as StoredKey);
}

function providerKeysCollection(uid: string, provider: ProviderKey) {
  const { db } = getFirebaseAdmin();
  return db
    .collection("users")
    .doc(uid)
    .collection("providerKeys")
    .doc(provider)
    .collection("keys");
}

function userDocument(uid: string) {
  const { db } = getFirebaseAdmin();
  return db.collection("users").doc(uid);
}

function userProvidersCollection(uid: string) {
  return getFirebaseAdmin().db.collection("users").doc(uid).collection("providers");
}

function userProviderKeysCollection(uid: string, provider: ProviderKey) {
  const { db } = getFirebaseAdmin();
  return db.collection("users").doc(uid).collection("providerKeys")
    .doc(provider).collection("keys");
}

function isProviderId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function envFallbackFor(adapter: ProviderAdapter): string | undefined {
  if (adapter === "agnes" && process.env.AGNES_API_KEY?.trim()) return "••••••" + process.env.AGNES_API_KEY.trim().slice(-4);
  if (adapter === "glm" && process.env.GLM_API_KEY?.trim()) return "••••••" + process.env.GLM_API_KEY.trim().slice(-4);
  if (adapter === "cloudinary" && process.env.CLOUDINARY_URL?.trim()) {
    try {
      const username = new URL(process.env.CLOUDINARY_URL.trim()).username;
      return username ? `••••••${decodeURIComponent(username).slice(-4)}` : "Configured from Replit Secrets";
    } catch {
      return "Configured from Replit Secrets";
    }
  }
  return undefined;
}

export async function listProviderConfigs(uid: string): Promise<ProviderConfig[]> {
  const snapshots = await userProvidersCollection(uid).get();
  const savedById = new Map(snapshots.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  const defaults: ProviderConfig[] = BUILT_IN_PROVIDERS.map((provider) => {
    const saved = savedById.get(provider.id);
    const config = {
      id: provider.id,
      name: typeof saved?.name === "string" ? saved.name : provider.name,
      category: (saved?.category === "storage" ? "storage" : "image") as ProviderCategory,
      adapter: (typeof saved?.adapter === "string" ? saved.adapter : provider.adapter) as ProviderAdapter,
      enabled: typeof saved?.enabled === "boolean" ? saved.enabled : provider.enabled,
      rotationOrder: typeof saved?.rotationOrder === "number" ? saved.rotationOrder : provider.rotationOrder,
      ...(typeof saved?.baseUrl === "string" ? { baseUrl: saved.baseUrl } : {}),
      ...(typeof saved?.model === "string" ? { model: saved.model } : {}),
      builtIn: true,
      ...(envFallbackFor(provider.adapter) ? { secretFallback: envFallbackFor(provider.adapter) } : {}),
    };
    return config;
  });
  const custom: ProviderConfig[] = snapshots.docs.flatMap((snapshot) => {
    if (BUILT_IN_PROVIDERS.some((provider) => provider.id === snapshot.id)) return [];
    const data = snapshot.data();
    if (!isProviderId(snapshot.id) || typeof data.name !== "string" ||
      (data.category !== "image" && data.category !== "storage") ||
      typeof data.adapter !== "string") return [];
    return [{
      id: snapshot.id,
      name: data.name,
      category: data.category,
      adapter: data.adapter as ProviderAdapter,
      enabled: data.enabled === true,
      rotationOrder: Number(data.rotationOrder) || 0,
      ...(typeof data.baseUrl === "string" ? { baseUrl: data.baseUrl } : {}),
      ...(typeof data.model === "string" ? { model: data.model } : {}),
      builtIn: false,
    }];
  });
  return [...defaults, ...custom].sort((a, b) =>
    a.category === b.category
      ? a.rotationOrder - b.rotationOrder || a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );
}

export async function saveProviderConfig(
  uid: string,
  input: Omit<ProviderConfig, "builtIn" | "secretFallback">,
): Promise<void> {
  if (!isProviderId(input.id)) throw new Error("Invalid provider ID.");
  await userProvidersCollection(uid).doc(input.id).set({
    name: input.name.trim(),
    category: input.category,
    adapter: input.adapter,
    enabled: input.enabled,
    rotationOrder: input.rotationOrder,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.model ? { model: input.model } : {}),
  }, { merge: true });
}

function createdAtMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Date.now();
}

function cooldownMillis(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return undefined;
}

function metadataFromSnapshot(
  snapshot: QueryDocumentSnapshot,
  provider: ProviderKey,
  now = Date.now(),
): VaultKeyMetadata {
  const data = snapshot.data() as StoredKey;
  const secret = decryptValue(data);
  const cooldownUntil = cooldownMillis(data.cooldownUntil);
  const status: ProviderKeyStatus =
    data.failureStatus === "failing"
      ? "failing"
      : cooldownUntil && cooldownUntil > now
        ? "cooldown"
        : "ready";
  return {
    id: snapshot.id,
    provider,
    label: typeof data.label === "string" ? data.label : "API key",
    maskedValue: secret.length > 4 ? `••••••${secret.slice(-4)}` : "••••",
    enabled: data.enabled === true,
    createdAt: createdAtMillis(data.createdAt),
    status,
    ...(status === "cooldown" && cooldownUntil ? { cooldownUntil } : {}),
  };
}

async function migrateLegacyKeys(uid: string): Promise<void> {
  const userRef = userDocument(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) return;
  const data = snapshot.data() ?? {};
  const hasLegacyFields = LEGACY_PROVIDERS.some((provider) => legacyFields[provider] in data);
  if (!hasLegacyFields) return;
  const legacy = LEGACY_PROVIDERS.flatMap((provider) => {
    const values = data[legacyFields[provider]];
    return Array.isArray(values)
      ? values
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .map((value, index) => ({ provider, value: value.trim(), index }))
      : [];
  });
  const { db } = getFirebaseAdmin();
  for (let offset = 0; offset < legacy.length; offset += 400) {
    const batch = db.batch();
    for (const item of legacy.slice(offset, offset + 400)) {
      const keyId = `legacy_${createHash("sha256")
        .update(`${item.provider}\0${item.index}\0${item.value}`)
        .digest("hex")
        .slice(0, 40)}`;
      batch.set(
        providerKeysCollection(uid, item.provider).doc(keyId),
        {
          label: `Imported key ${item.index + 1}`,
          enabled: true,
          createdAt: Timestamp.now(),
          ...encryptValue(item.value),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  await userRef.update({
    zsky_keys: FieldValue.delete(),
    agnes_keys: FieldValue.delete(),
    glm_keys: FieldValue.delete(),
  });
}

async function readProviderSnapshots(uid: string, provider: ProviderKey) {
  return providerKeysCollection(uid, provider).get();
}

export async function listVaultKeys(uid: string): Promise<VaultKeyMetadata[]> {
  await migrateLegacyKeys(uid);
  const providers = await listProviderConfigs(uid);
  const snapshots = await Promise.all(providers.map((provider) => readProviderSnapshots(uid, provider.id)));
  return snapshots.flatMap((snapshot, index) => snapshot.docs.map((document) =>
    metadataFromSnapshot(document, providers[index]?.id ?? ""),
  ));
}

export async function getGenerationKeys(
  uid: string,
  providers?: ProviderConfig[],
): Promise<ProviderGenerationKeys> {
  await migrateLegacyKeys(uid);
  const imageProviders = (providers ?? await listProviderConfigs(uid))
    .filter((provider) => provider.category === "image" && provider.enabled);
  const snapshots = await Promise.all(imageProviders.map((provider) => readProviderSnapshots(uid, provider.id)));
  const result: ProviderGenerationKeys = {};
  for (let index = 0; index < imageProviders.length; index += 1) {
    const provider = imageProviders[index]?.id;
    const snapshot = snapshots[index];
    if (!provider || !snapshot) continue;
    const allDocs = snapshot.docs;
    const eligible = allDocs
      .filter((document) => {
        const data = document.data() as StoredKey;
        const cooldownUntil = cooldownMillis(data.cooldownUntil);
        return (
          data.enabled === true &&
          data.failureStatus !== "failing" &&
          (!cooldownUntil || cooldownUntil <= Date.now())
        );
      })
      .map((document) => ({
        id: document.id,
        value: decryptValue(document.data() as StoredKey),
      }));

    const rotationKey = `${uid}:${provider}`;
    const offset = rotationOffsets.get(rotationKey) ?? 0;
    const rotated =
      eligible.length > 0
        ? [...eligible.slice(offset % eligible.length), ...eligible.slice(0, offset % eligible.length)]
        : [];
    if (rotated.length > 0) {
      rotationOffsets.set(rotationKey, (offset + 1) % rotated.length);
    }
    result[provider] = {
      hasVaultKeys: allDocs.some((document) => (document.data() as StoredKey).enabled === true),
      keys: rotated,
    };
  }
  return result;
}

export async function createVaultKey(
  uid: string,
  provider: ProviderKey,
  label: string,
  value: string,
): Promise<VaultKeyMetadata> {
  const keyRef = userProviderKeysCollection(uid, provider).doc();
  const { db } = getFirebaseAdmin();
  await keyRef.set({
    label: label.trim(),
    enabled: true,
    createdAt: FieldValue.serverTimestamp(),
    ...encryptValue(value.trim()),
  });
  const saved = await keyRef.get();
  return metadataFromSnapshot(saved as QueryDocumentSnapshot, provider);
}

export async function updateVaultKey(
  uid: string,
  provider: ProviderKey,
  keyId: string,
  input: { label?: string; enabled?: boolean },
): Promise<VaultKeyMetadata | null> {
  const keyRef = userProviderKeysCollection(uid, provider).doc(keyId);
  const snapshot = await keyRef.get();
  if (!snapshot.exists) return null;

  const updates: Record<string, unknown> = {};
  if (input.label !== undefined) updates.label = input.label.trim();
  if (input.enabled !== undefined) {
    updates.enabled = input.enabled;
    if (input.enabled) {
      updates.failureStatus = FieldValue.delete();
      updates.cooldownUntil = FieldValue.delete();
    }
  }
  await keyRef.update(updates);
  const updated = await keyRef.get();
  return metadataFromSnapshot(updated as QueryDocumentSnapshot, provider);
}

export async function deleteVaultKey(
  uid: string,
  provider: ProviderKey,
  keyId: string,
): Promise<boolean> {
  const keyRef = userProviderKeysCollection(uid, provider).doc(keyId);
  const snapshot = await keyRef.get();
  if (!snapshot.exists) return false;
  await keyRef.delete();
  return true;
}

export async function recordProviderKeyFailure(
  uid: string,
  provider: ProviderKey,
  keyId: string,
  status: number | null,
): Promise<void> {
  if (keyId === "environment") return;
  const keyRef = userProviderKeysCollection(uid, provider).doc(keyId);
  if (status === 401 || status === 403) {
    await keyRef.update({ failureStatus: "failing" });
    return;
  }
  if (status === 429) {
    await keyRef.update({
      cooldownUntil: Timestamp.fromMillis(Date.now() + 60_000),
    });
  }
}

export async function clearProviderKeyCooldown(
  uid: string,
  provider: ProviderKey,
  keyId: string,
): Promise<void> {
  if (keyId === "environment") return;
  await userProviderKeysCollection(uid, provider).doc(keyId).update({
    failureStatus: FieldValue.delete(),
    cooldownUntil: FieldValue.delete(),
  });
}
