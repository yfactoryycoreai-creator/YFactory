import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getFirebaseAdmin, requireEncryptionKey } from "./firebaseAdmin";

export const PROVIDERS = ["zsky", "agnes", "glm"] as const;
export type ProviderKey = (typeof PROVIDERS)[number];
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
  ProviderKey,
  { hasVaultKeys: boolean; keys: GenerationKey[] }
>;

const legacyFields: Record<ProviderKey, string> = {
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
  const hasLegacyFields = PROVIDERS.some((provider) => legacyFields[provider] in data);
  if (!hasLegacyFields) return;
  const legacy = PROVIDERS.flatMap((provider) => {
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
  const snapshots = await Promise.all(
    PROVIDERS.map((provider) => readProviderSnapshots(uid, provider)),
  );
  return snapshots.flatMap((snapshot, index) => {
    const provider = PROVIDERS[index];
    return provider
      ? snapshot.docs.map((document) => metadataFromSnapshot(document, provider))
      : [];
  });
}

export async function getGenerationKeys(
  uid: string,
): Promise<ProviderGenerationKeys> {
  await migrateLegacyKeys(uid);
  const snapshots = await Promise.all(
    PROVIDERS.map((provider) => readProviderSnapshots(uid, provider)),
  );

  const result = {
    zsky: { hasVaultKeys: false, keys: [] as GenerationKey[] },
    agnes: { hasVaultKeys: false, keys: [] as GenerationKey[] },
    glm: { hasVaultKeys: false, keys: [] as GenerationKey[] },
  };
  for (let index = 0; index < PROVIDERS.length; index += 1) {
    const provider = PROVIDERS[index];
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
      hasVaultKeys: allDocs.length > 0,
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
  const keyRef = providerKeysCollection(uid, provider).doc();
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
  const keyRef = providerKeysCollection(uid, provider).doc(keyId);
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
  const keyRef = providerKeysCollection(uid, provider).doc(keyId);
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
  const keyRef = providerKeysCollection(uid, provider).doc(keyId);
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
  await providerKeysCollection(uid, provider).doc(keyId).update({
    failureStatus: FieldValue.delete(),
    cooldownUntil: FieldValue.delete(),
  });
}
