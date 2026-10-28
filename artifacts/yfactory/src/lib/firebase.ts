import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredFirebaseFields = [
  'apiKey',
  'authDomain',
  'projectId',
  'messagingSenderId',
  'appId',
] as const;

export const missingFirebaseFields = requiredFirebaseFields.filter(
  (field) => !firebaseConfig[field],
);
export const firebaseIsConfigured = missingFirebaseFields.length === 0;

const app = firebaseIsConfigured
  ? getApps().length > 0
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firebaseAuth = app ? getAuth(app) : null;
export const firestore = app ? getFirestore(app) : null;

export async function signInWithGoogle() {
  if (!firebaseAuth) {
    throw new Error('Firebase configuration is incomplete.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(firebaseAuth, provider);
}

export async function signOutFromFirebase() {
  if (!firebaseAuth) return;
  await signOut(firebaseAuth);
}
