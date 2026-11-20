import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebaseAdmin";

export type StoredChatRole = "user" | "assistant";
export type StoredChatFeedback = "like" | "dislike" | null;

export type StoredChatMessage = {
  id: string;
  role: StoredChatRole;
  text: string;
  modelName?: string;
  feedback?: StoredChatFeedback;
  stopped?: boolean;
  createdAt: number;
};

export type ChatConversationSummary = {
  id: string;
  title: string;
  pinned: boolean;
  projectName: string | null;
  modelProvider: string | null;
  modelKeyId: string | null;
  modelName: string | null;
  messageCount: number;
  lastMessagePreview: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatConversationDetail = ChatConversationSummary & {
  messages: StoredChatMessage[];
};

const MAX_CONVERSATIONS_LIST = 200;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const MAX_MESSAGE_TEXT_LENGTH = 32_000;
const MAX_TITLE_LENGTH = 120;
const MAX_PROJECT_NAME_LENGTH = 80;

function conversationsCollection(uid: string) {
  const { db } = getFirebaseAdmin();
  return db.collection("users").doc(uid).collection("conversations");
}

function toMillis(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return fallback;
}

function sanitizeTitle(value: unknown, fallback = "New chat"): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, MAX_TITLE_LENGTH);
}

function sanitizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

export function sanitizeMessages(raw: unknown): StoredChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const result: StoredChatMessage[] = [];
  for (let i = 0; i < raw.length && result.length < MAX_MESSAGES_PER_CONVERSATION; i += 1) {
    const item = raw[i];
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "user" || record.role === "assistant" ? record.role : null;
    const text = typeof record.text === "string" ? record.text.slice(0, MAX_MESSAGE_TEXT_LENGTH) : null;
    if (!role || text === null) continue;
    const rawId = record.id;
    const id =
      typeof rawId === "string" && rawId.trim()
        ? rawId.trim().slice(0, 64)
        : typeof rawId === "number" && Number.isFinite(rawId)
          ? String(rawId)
          : `msg_${now}_${i}`;
    const modelName = sanitizeOptionalString(record.modelName, 200);
    const feedback: StoredChatFeedback =
      record.feedback === "like" || record.feedback === "dislike" ? record.feedback : null;
    const stopped = record.stopped === true;
    const createdAt = toMillis(record.createdAt, now);
    result.push({
      id,
      role,
      text,
      ...(modelName ? { modelName } : {}),
      feedback,
      ...(stopped ? { stopped: true } : {}),
      createdAt,
    });
  }
  return result;
}

function summaryFromData(id: string, data: DocumentData): ChatConversationSummary {
  const now = Date.now();
  const messages = sanitizeMessages(data.messages);
  const lastMessage = messages[messages.length - 1];
  const preview =
    typeof data.lastMessagePreview === "string" && data.lastMessagePreview.trim()
      ? data.lastMessagePreview.trim().slice(0, 160)
      : lastMessage
        ? lastMessage.text.replace(/\s+/g, " ").trim().slice(0, 160)
        : "";
  return {
    id,
    title: sanitizeTitle(data.title),
    pinned: data.pinned === true,
    projectName: sanitizeOptionalString(data.projectName, MAX_PROJECT_NAME_LENGTH),
    modelProvider: sanitizeOptionalString(data.modelProvider, 64),
    modelKeyId: sanitizeOptionalString(data.modelKeyId, 128),
    modelName: sanitizeOptionalString(data.modelName, 200),
    messageCount:
      typeof data.messageCount === "number" && Number.isFinite(data.messageCount)
        ? data.messageCount
        : messages.length,
    lastMessagePreview: preview,
    createdAt: toMillis(data.createdAt, now),
    updatedAt: toMillis(data.updatedAt, now),
  };
}

function detailFromData(id: string, data: DocumentData): ChatConversationDetail {
  const summary = summaryFromData(id, data);
  return {
    ...summary,
    messages: sanitizeMessages(data.messages),
  };
}

export async function listChatConversations(uid: string): Promise<ChatConversationSummary[]> {
  const snapshot = await conversationsCollection(uid)
    .orderBy("updatedAt", "desc")
    .limit(MAX_CONVERSATIONS_LIST)
    .get();
  const items = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
    summaryFromData(doc.id, doc.data()),
  );
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function getChatConversation(
  uid: string,
  conversationId: string,
): Promise<ChatConversationDetail | null> {
  const snapshot = await conversationsCollection(uid).doc(conversationId).get();
  if (!snapshot.exists) return null;
  return detailFromData(snapshot.id, snapshot.data() ?? {});
}

export async function createChatConversation(
  uid: string,
  input: {
    title?: string;
    pinned?: boolean;
    projectName?: string | null;
    modelProvider?: string | null;
    modelKeyId?: string | null;
    modelName?: string | null;
    messages?: StoredChatMessage[];
  } = {},
): Promise<ChatConversationDetail> {
  const now = Date.now();
  const messages = sanitizeMessages(input.messages ?? []);
  const firstUserMessage = messages.find((item) => item.role === "user");
  const fallbackTitle = firstUserMessage
    ? firstUserMessage.text.replace(/\s+/g, " ").trim().slice(0, 60)
    : "New chat";
  const title = sanitizeTitle(input.title, fallbackTitle || "New chat");
  const lastMessage = messages[messages.length - 1];
  const lastMessagePreview = lastMessage
    ? lastMessage.text.replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
  const docRef = conversationsCollection(uid).doc();
  const payload: DocumentData = {
    title,
    pinned: input.pinned === true,
    projectName: sanitizeOptionalString(input.projectName, MAX_PROJECT_NAME_LENGTH),
    modelProvider: sanitizeOptionalString(input.modelProvider, 64),
    modelKeyId: sanitizeOptionalString(input.modelKeyId, 128),
    modelName: sanitizeOptionalString(input.modelName, 200),
    messages,
    messageCount: messages.length,
    lastMessagePreview,
    createdAt: now,
    updatedAt: now,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  };
  await docRef.set(payload);
  return detailFromData(docRef.id, payload);
}

export async function updateChatConversation(
  uid: string,
  conversationId: string,
  patch: {
    title?: string;
    pinned?: boolean;
    projectName?: string | null;
    modelProvider?: string | null;
    modelKeyId?: string | null;
    modelName?: string | null;
    messages?: StoredChatMessage[];
  },
): Promise<ChatConversationDetail | null> {
  const docRef = conversationsCollection(uid).doc(conversationId);
  const existing = await docRef.get();
  if (!existing.exists) return null;

  const now = Date.now();
  const updates: DocumentData = {
    updatedAt: now,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  };

  if (patch.title !== undefined) {
    updates.title = sanitizeTitle(patch.title);
  }
  if (patch.pinned !== undefined) {
    updates.pinned = patch.pinned === true;
  }
  if (patch.projectName !== undefined) {
    updates.projectName = sanitizeOptionalString(patch.projectName, MAX_PROJECT_NAME_LENGTH);
  }
  if (patch.modelProvider !== undefined) {
    updates.modelProvider = sanitizeOptionalString(patch.modelProvider, 64);
  }
  if (patch.modelKeyId !== undefined) {
    updates.modelKeyId = sanitizeOptionalString(patch.modelKeyId, 128);
  }
  if (patch.modelName !== undefined) {
    updates.modelName = sanitizeOptionalString(patch.modelName, 200);
  }
  if (patch.messages !== undefined) {
    const messages = sanitizeMessages(patch.messages);
    const lastMessage = messages[messages.length - 1];
    updates.messages = messages;
    updates.messageCount = messages.length;
    updates.lastMessagePreview = lastMessage
      ? lastMessage.text.replace(/\s+/g, " ").trim().slice(0, 160)
      : "";
  }

  await docRef.update(updates);
  const updated = await docRef.get();
  if (!updated.exists) return null;
  return detailFromData(updated.id, updated.data() ?? {});
}

export async function deleteChatConversation(
  uid: string,
  conversationId: string,
): Promise<boolean> {
  const docRef = conversationsCollection(uid).doc(conversationId);
  const existing = await docRef.get();
  if (!existing.exists) return false;
  await docRef.delete();
  return true;
}
