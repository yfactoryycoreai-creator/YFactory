import { createHash } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let adminApp: App | null = null;

export function requireEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret?.trim()) {
    throw new Error("ENCRYPTION_KEY is missing or empty.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function getFirebaseAdmin() {
  requireEncryptionKey();
  if (!adminApp) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    if (!serviceAccountJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing.");
    }

    let serviceAccount: Record<string, unknown>;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as Record<string, unknown>;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
    }

    const projectId =
      typeof serviceAccount.project_id === "string"
        ? serviceAccount.project_id
        : "";
    const clientEmail =
      typeof serviceAccount.client_email === "string"
        ? serviceAccount.client_email
        : "";
    const privateKey =
      typeof serviceAccount.private_key === "string"
        ? serviceAccount.private_key.replace(/\\n/g, "\n")
        : "";

    if (!projectId || !clientEmail || !privateKey.includes("PRIVATE KEY")) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email, or private_key.",
      );
    }

    const configuredProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (configuredProjectId && configuredProjectId !== projectId) {
      throw new Error(
        "NEXT_PUBLIC_FIREBASE_PROJECT_ID does not match FIREBASE_SERVICE_ACCOUNT project_id.",
      );
    }

    const existingApp = getApps().find((app) => app.name === "yfactory-admin");
    adminApp =
      existingApp ??
      initializeApp(
        {
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
          projectId,
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
        },
        "yfactory-admin",
      );
  }

  const app = adminApp;
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
    FieldValue,
  };
}

export async function verifyFirebaseIdToken(token: string): Promise<string | null> {
  const { auth } = getFirebaseAdmin();
  try {
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}
