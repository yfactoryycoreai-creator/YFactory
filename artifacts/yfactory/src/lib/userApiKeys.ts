import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

export type ProviderKey = 'zsky' | 'agnes' | 'glm';
export type UserApiKeys = {
  zsky_keys: string[];
  agnes_keys: string[];
  glm_keys: string[];
};

export const providerKeyFields: Record<ProviderKey, keyof UserApiKeys> = {
  zsky: 'zsky_keys',
  agnes: 'agnes_keys',
  glm: 'glm_keys',
};

const emptyKeys = (): UserApiKeys => ({
  zsky_keys: [],
  agnes_keys: [],
  glm_keys: [],
});

function toUserApiKeys(data: DocumentData | undefined): UserApiKeys {
  const result = emptyKeys();
  if (!data) return result;

  for (const field of Object.values(providerKeyFields)) {
    const values = data[field];
    if (Array.isArray(values)) {
      result[field] = values.filter(
        (value): value is string => typeof value === 'string',
      );
    }
  }
  return result;
}

function getUserDocument(uid: string) {
  if (!firestore) {
    throw new Error('Firebase Firestore is not configured.');
  }
  return doc(firestore, 'users', uid);
}

export async function loadUserApiKeys(uid: string): Promise<UserApiKeys> {
  const userRef = getUserDocument(uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    const initialKeys = emptyKeys();
    await setDoc(userRef, initialKeys, { merge: true });
    return initialKeys;
  }

  return toUserApiKeys(snapshot.data());
}

export async function addUserApiKey(
  uid: string,
  provider: ProviderKey,
  apiKey: string,
): Promise<UserApiKeys> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('An API key cannot be empty.');
  }

  const userRef = getUserDocument(uid);
  const field = providerKeyFields[provider];
  return runTransaction(firestore!, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const current = snapshot.exists()
      ? toUserApiKeys(snapshot.data())
      : emptyKeys();
    const existing = current[field];

    if (existing.includes(cleanKey)) {
      throw new Error('This API key is already saved.');
    }

    const updated = { ...current, [field]: [...existing, cleanKey] };
    transaction.set(userRef, updated, { merge: true });
    return updated;
  });
}

export async function deleteUserApiKey(
  uid: string,
  provider: ProviderKey,
  apiKey: string,
): Promise<UserApiKeys> {
  const userRef = getUserDocument(uid);
  const field = providerKeyFields[provider];
  return runTransaction(firestore!, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const current = snapshot.exists()
      ? toUserApiKeys(snapshot.data())
      : emptyKeys();
    const index = current[field].indexOf(apiKey);

    if (index === -1) return current;

    const nextValues = [...current[field]];
    nextValues.splice(index, 1);
    const updated = { ...current, [field]: nextValues };
    transaction.set(userRef, updated, { merge: true });
    return updated;
  });
}
