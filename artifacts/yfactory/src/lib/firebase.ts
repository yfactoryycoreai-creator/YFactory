import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export { getAuth };

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || undefined,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || undefined,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || undefined,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
};

console.log('[Firebase] Loaded client config', {
  projectId: firebaseConfig.projectId || '(missing)',
  authDomain: firebaseConfig.authDomain || '(missing)',
});

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
export const firebaseConfigurationIssues = [
  ...(firebaseConfig.projectId &&
  /^\d+:\d+:(web|android|ios):/i.test(firebaseConfig.projectId)
    ? ['Firebase projectId must be the Project ID, not the Firebase App ID.']
    : []),
  ...(firebaseConfig.authDomain && !firebaseConfig.authDomain.includes('.')
    ? [
        'Firebase authDomain must be a full hostname (typically <project-id>.firebaseapp.com), not a bare project ID or the Replit app domain.',
      ]
    : []),
];
export const firebaseIsConfigured =
  missingFirebaseFields.length === 0 && firebaseConfigurationIssues.length === 0;

const app = firebaseIsConfigured
  ? getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApp()
  : null;

export const auth = app ? getAuth(app) : null;
export const firebaseAuth = auth;
export const firestore = app ? getFirestore(app) : null;

export async function signInWithGoogle() {
  if (!auth) {
    throw new Error('Firebase configuration is incomplete.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function signOutFromFirebase() {
  if (!auth) return;
  await signOut(auth);
}
