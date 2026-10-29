import {
  deleteDoc,
  doc,
  getDoc,
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
    return emptyKeys();
  }

  return toUserApiKeys(snapshot.data());
}

export async function saveUserApiKeys(
  uid: string,
  keys: UserApiKeys,
): Promise<UserApiKeys> {
  const userRef = getUserDocument(uid);
  const savedKeys: UserApiKeys = {
    zsky_keys: keys.zsky_keys.map((key) => key.trim()).filter(Boolean),
    agnes_keys: keys.agnes_keys.map((key) => key.trim()).filter(Boolean),
    glm_keys: keys.glm_keys.map((key) => key.trim()).filter(Boolean),
  };

  await setDoc(userRef, savedKeys, { merge: true });
  return savedKeys;
}

export async function deleteUserDocument(uid: string): Promise<DocumentData | null> {
  const userRef = getUserDocument(uid);
  const snapshot = await getDoc(userRef);
  const previousData = snapshot.exists() ? snapshot.data() : null;
  await deleteDoc(userRef);
  return previousData;
}

export async function restoreUserDocument(
  uid: string,
  previousData: DocumentData,
): Promise<void> {
  await setDoc(getUserDocument(uid), previousData);
}
