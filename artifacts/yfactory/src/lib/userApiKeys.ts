import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

function getUserDocument(uid: string) {
  if (!firestore) {
    throw new Error('Firebase Firestore is not configured.');
  }
  return doc(firestore, 'users', uid);
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
