import { createHash, randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebaseAdmin";
import { StudentsServiceError, type StudentGradeLevel } from "./studentsService";

export type CommunityPostType =
  | "summary"
  | "question"
  | "exam_share"
  | "resource_share";

export type CommunityReportReason =
  | "spam"
  | "harassment"
  | "misinformation"
  | "inappropriate"
  | "privacy";

export type StudentPublicProfile = {
  handleId: string;
  displayName: string;
  bio: string;
  gradeLevel: StudentGradeLevel;
  favoriteSubjects: string[];
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowedByMe: boolean;
  isMe: boolean;
  updatedAt: number;
};

export type CommunityCommentItem = {
  id: string;
  authorHandleId: string;
  authorName: string;
  content: string;
  isMine: boolean;
  createdAt: number;
};

export type CommunityPostItem = {
  id: string;
  authorHandleId: string;
  authorName: string;
  authorGradeLevel: StudentGradeLevel;
  postType: CommunityPostType;
  subject: string;
  gradeLevel: StudentGradeLevel;
  title: string;
  content: string;
  resourceUrl: string | null;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  likedByMe: boolean;
  isMine: boolean;
  authorFollowedByMe: boolean;
  createdAt: number;
};

const AUTO_HIDE_REPORT_THRESHOLD = 3;

function profilesCollection() {
  return getFirebaseAdmin().db.collection("studentCommunityProfiles");
}

function postsCollection() {
  return getFirebaseAdmin().db.collection("studentCommunityPosts");
}

function reportsCollection() {
  return getFirebaseAdmin().db.collection("studentCommunityReports");
}

/**
 * Deterministic pseudonymous public handle derived from uid so raw Firebase UIDs
 * and private user emails are NEVER exposed in community APIs.
 */
export function publicHandleForUid(uid: string): string {
  return `stu_${createHash("sha256").update(`yfactory-student:${uid}`).digest("hex").slice(0, 14)}`;
}

function sanitizeGrade(raw: unknown): StudentGradeLevel {
  if (
    raw === "elementary" ||
    raw === "middle" ||
    raw === "high_school" ||
    raw === "university"
  ) {
    return raw;
  }
  return "high_school";
}

function sanitizePostType(raw: unknown): CommunityPostType {
  if (
    raw === "summary" ||
    raw === "question" ||
    raw === "exam_share" ||
    raw === "resource_share"
  ) {
    return raw;
  }
  return "summary";
}

function containsPrivateContactPii(text: string): boolean {
  const emailRx = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const phoneRx = /(?:\+?\d[\d\s-]{8,}\d)/;
  return emailRx.test(text) || phoneRx.test(text);
}

function profileFromDoc(
  handleId: string,
  d: Record<string, unknown>,
  myHandleId: string,
  myFollowing: Set<string>,
): StudentPublicProfile {
  return {
    handleId,
    displayName:
      typeof d.displayName === "string" && d.displayName.trim()
        ? d.displayName.trim().slice(0, 48)
        : "YFactory Student",
    bio: typeof d.bio === "string" ? d.bio.trim().slice(0, 260) : "",
    gradeLevel: sanitizeGrade(d.gradeLevel),
    favoriteSubjects: Array.isArray(d.favoriteSubjects)
      ? d.favoriteSubjects
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().slice(0, 40))
          .filter(Boolean)
          .slice(0, 6)
      : [],
    followersCount:
      typeof d.followersCount === "number" ? Math.max(0, d.followersCount) : 0,
    followingCount:
      typeof d.followingCount === "number" ? Math.max(0, d.followingCount) : 0,
    postsCount: typeof d.postsCount === "number" ? Math.max(0, d.postsCount) : 0,
    isFollowedByMe: myFollowing.has(handleId),
    isMe: handleId === myHandleId,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

async function getOrCreateOwnProfileDoc(uid: string) {
  const handleId = publicHandleForUid(uid);
  const ref = profilesCollection().doc(handleId);
  const snap = await ref.get();
  if (snap.exists) {
    return { handleId, data: snap.data() ?? {} };
  }
  const now = Date.now();
  const initial = {
    displayName: `Student ${handleId.slice(-4).toUpperCase()}`,
    bio: "",
    gradeLevel: "high_school" as StudentGradeLevel,
    favoriteSubjects: [] as string[],
    followersCount: 0,
    followingCount: 0,
    followingHandles: [] as string[],
    postsCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(initial);
  return { handleId, data: initial };
}

export async function getMyCommunityProfile(
  uid: string,
): Promise<StudentPublicProfile> {
  const { handleId, data } = await getOrCreateOwnProfileDoc(uid);
  const following = new Set(
    Array.isArray(data.followingHandles)
      ? (data.followingHandles as string[])
      : [],
  );
  return profileFromDoc(handleId, data, handleId, following);
}

export async function updateMyCommunityProfile(
  uid: string,
  input: {
    displayName?: string;
    bio?: string;
    gradeLevel?: StudentGradeLevel;
    favoriteSubjects?: string[];
  },
): Promise<StudentPublicProfile> {
  const { handleId, data } = await getOrCreateOwnProfileDoc(uid);
  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim().slice(0, 48)
      : String(data.displayName ?? "YFactory Student");
  const bio =
    typeof input.bio === "string"
      ? input.bio.trim().slice(0, 260)
      : String(data.bio ?? "");

  if (containsPrivateContactPii(`${displayName} ${bio}`)) {
    throw new StudentsServiceError(
      "For student privacy, do not include email addresses or phone numbers in your public profile.",
      "pii_not_allowed",
      400,
    );
  }

  const gradeLevel =
    input.gradeLevel !== undefined
      ? sanitizeGrade(input.gradeLevel)
      : sanitizeGrade(data.gradeLevel);
  const favoriteSubjects =
    input.favoriteSubjects !== undefined
      ? [
          ...new Set(
            input.favoriteSubjects
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim().slice(0, 40))
              .filter(Boolean),
          ),
        ].slice(0, 6)
      : Array.isArray(data.favoriteSubjects)
        ? (data.favoriteSubjects as string[])
        : [];

  const now = Date.now();
  await profilesCollection().doc(handleId).update({
    displayName,
    bio,
    gradeLevel,
    favoriteSubjects,
    updatedAt: now,
  });

  const following = new Set(
    Array.isArray(data.followingHandles)
      ? (data.followingHandles as string[])
      : [],
  );
  return profileFromDoc(
    handleId,
    { ...data, displayName, bio, gradeLevel, favoriteSubjects, updatedAt: now },
    handleId,
    following,
  );
}

export async function toggleFollowStudent(
  uid: string,
  targetHandleId: string,
): Promise<{ following: boolean; targetFollowersCount: number }> {
  const myHandleId = publicHandleForUid(uid);
  if (targetHandleId === myHandleId) {
    throw new StudentsServiceError("You cannot follow yourself.", "invalid_follow", 400);
  }
  await getOrCreateOwnProfileDoc(uid);
  const myRef = profilesCollection().doc(myHandleId);
  const targetRef = profilesCollection().doc(targetHandleId);
  const { db } = getFirebaseAdmin();

  return db.runTransaction(async (tx) => {
    const [mySnap, targetSnap] = await Promise.all([
      tx.get(myRef),
      tx.get(targetRef),
    ]);
    if (!targetSnap.exists) {
      throw new StudentsServiceError("Student profile not found.", "not_found", 404);
    }
    const myData = mySnap.data() ?? {};
    const targetData = targetSnap.data() ?? {};
    const curList = Array.isArray(myData.followingHandles)
      ? (myData.followingHandles as string[])
      : [];
    const already = curList.includes(targetHandleId);
    const nextList = already
      ? curList.filter((h) => h !== targetHandleId)
      : [...curList, targetHandleId].slice(-200);
    const nextFollowers = Math.max(
      0,
      (typeof targetData.followersCount === "number" ? targetData.followersCount : 0) +
        (already ? -1 : 1),
    );

    tx.update(myRef, {
      followingHandles: nextList,
      followingCount: nextList.length,
    });
    tx.update(targetRef, { followersCount: nextFollowers });
    return { following: !already, targetFollowersCount: nextFollowers };
  });
}

export async function listCommunityPosts(
  uid: string,
  filters: {
    subject?: string;
    gradeLevel?: string;
    postType?: string;
    query?: string;
    onlyFollowing?: boolean;
  } = {},
): Promise<CommunityPostItem[]> {
  const { handleId: myHandleId, data: myProfile } = await getOrCreateOwnProfileDoc(uid);
  const myFollowing = new Set(
    Array.isArray(myProfile.followingHandles)
      ? (myProfile.followingHandles as string[])
      : [],
  );

  const snap = await postsCollection()
    .orderBy("createdAt", "desc")
    .limit(60)
    .get();

  const q = filters.query?.trim().toLowerCase() ?? "";
  const subj = filters.subject?.trim().toLowerCase() ?? "";
  const grade = filters.gradeLevel?.trim().toLowerCase() ?? "";
  const pType = filters.postType?.trim().toLowerCase() ?? "";

  const out: CommunityPostItem[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    if (d.hidden === true) continue;

    const authorHandleId = String(d.authorHandleId ?? "");
    const itemSubject = String(d.subject ?? "General");
    const itemGrade = sanitizeGrade(d.gradeLevel);
    const itemType = sanitizePostType(d.postType);
    const title = String(d.title ?? "");
    const content = String(d.content ?? "");
    const tags = Array.isArray(d.tags)
      ? d.tags.filter((x): x is string => typeof x === "string")
      : [];

    if (filters.onlyFollowing && !myFollowing.has(authorHandleId) && authorHandleId !== myHandleId) {
      continue;
    }
    if (subj && subj !== "all" && itemSubject.toLowerCase() !== subj) continue;
    if (grade && grade !== "all" && itemGrade !== grade) continue;
    if (pType && pType !== "all" && itemType !== pType) continue;
    if (q) {
      const hay = `${title} ${content} ${itemSubject} ${tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const likedHandles = Array.isArray(d.likedHandles)
      ? (d.likedHandles as string[])
      : [];
    out.push({
      id: doc.id,
      authorHandleId,
      authorName: String(d.authorName ?? "YFactory Student"),
      authorGradeLevel: sanitizeGrade(d.authorGradeLevel),
      postType: itemType,
      subject: itemSubject,
      gradeLevel: itemGrade,
      title,
      content,
      resourceUrl:
        typeof d.resourceUrl === "string" && /^https:\/\/.+/i.test(d.resourceUrl)
          ? d.resourceUrl
          : null,
      tags,
      likesCount: likedHandles.length,
      commentsCount: typeof d.commentsCount === "number" ? d.commentsCount : 0,
      likedByMe: likedHandles.includes(myHandleId),
      isMine: authorHandleId === myHandleId,
      authorFollowedByMe: myFollowing.has(authorHandleId),
      createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    });
  }
  return out;
}

export async function createCommunityPost(
  uid: string,
  input: {
    postType: CommunityPostType;
    subject: string;
    gradeLevel: StudentGradeLevel;
    title: string;
    content: string;
    resourceUrl?: string;
    tags?: string[];
  },
): Promise<CommunityPostItem> {
  const title = input.title.trim().slice(0, 140);
  const content = input.content.trim().slice(0, 4000);
  if (!title || !content) {
    throw new StudentsServiceError("Title and content are required.", "validation_failed", 400);
  }
  if (containsPrivateContactPii(`${title} ${content}`)) {
    throw new StudentsServiceError(
      "For student privacy, remove email addresses or phone numbers before posting publicly.",
      "pii_not_allowed",
      400,
    );
  }

  const rawUrl = input.resourceUrl?.trim() ?? "";
  if (rawUrl && !/^https:\/\/.+/i.test(rawUrl)) {
    throw new StudentsServiceError(
      "Educational resource links must start with https://",
      "invalid_url",
      400,
    );
  }

  const { handleId, data: prof } = await getOrCreateOwnProfileDoc(uid);
  const authorName = String(prof.displayName ?? "YFactory Student");
  const authorGradeLevel = sanitizeGrade(prof.gradeLevel);
  const subject = input.subject.trim().slice(0, 80) || "General";
  const gradeLevel = sanitizeGrade(input.gradeLevel);
  const postType = sanitizePostType(input.postType);
  const tags = Array.isArray(input.tags)
    ? [
        ...new Set(
          input.tags
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().slice(0, 32))
            .filter(Boolean),
        ),
      ].slice(0, 5)
    : [];

  const now = Date.now();
  const id = `cpost_${now}_${randomBytes(4).toString("hex")}`;
  await postsCollection()
    .doc(id)
    .set({
      authorHandleId: handleId,
      authorName,
      authorGradeLevel,
      postType,
      subject,
      gradeLevel,
      title,
      content,
      resourceUrl: rawUrl || null,
      tags,
      likedHandles: [],
      commentsCount: 0,
      reportCount: 0,
      reporterHandles: [],
      hidden: false,
      createdAt: now,
      createdAtTs: Timestamp.fromMillis(now),
    });

  await profilesCollection()
    .doc(handleId)
    .update({ postsCount: FieldValue.increment(1) })
    .catch(() => undefined);

  return {
    id,
    authorHandleId: handleId,
    authorName,
    authorGradeLevel,
    postType,
    subject,
    gradeLevel,
    title,
    content,
    resourceUrl: rawUrl || null,
    tags,
    likesCount: 0,
    commentsCount: 0,
    likedByMe: false,
    isMine: true,
    authorFollowedByMe: false,
    createdAt: now,
  };
}

export async function toggleLikeCommunityPost(
  uid: string,
  postId: string,
): Promise<{ liked: boolean; likesCount: number }> {
  const myHandleId = publicHandleForUid(uid);
  const ref = postsCollection().doc(postId);
  const { db } = getFirebaseAdmin();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.hidden === true) {
      throw new StudentsServiceError("Post not found.", "not_found", 404);
    }
    const cur = Array.isArray(snap.data()?.likedHandles)
      ? (snap.data()!.likedHandles as string[])
      : [];
    const liked = cur.includes(myHandleId);
    const next = liked
      ? cur.filter((h) => h !== myHandleId)
      : [...cur, myHandleId];
    tx.update(ref, { likedHandles: next });
    return { liked: !liked, likesCount: next.length };
  });
}

export async function listPostComments(
  uid: string,
  postId: string,
): Promise<CommunityCommentItem[]> {
  const myHandleId = publicHandleForUid(uid);
  const snap = await postsCollection()
    .doc(postId)
    .collection("comments")
    .orderBy("createdAt", "asc")
    .limit(60)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data() ?? {};
    const authorHandleId = String(d.authorHandleId ?? "");
    return {
      id: doc.id,
      authorHandleId,
      authorName: String(d.authorName ?? "YFactory Student"),
      content: String(d.content ?? ""),
      isMine: authorHandleId === myHandleId,
      createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    };
  });
}

export async function addPostComment(
  uid: string,
  postId: string,
  content: string,
): Promise<CommunityCommentItem> {
  const clean = content.trim().slice(0, 1200);
  if (!clean) {
    throw new StudentsServiceError("Write a comment first.", "empty_comment", 400);
  }
  if (containsPrivateContactPii(clean)) {
    throw new StudentsServiceError(
      "Do not share email addresses or phone numbers in public comments.",
      "pii_not_allowed",
      400,
    );
  }

  const postRef = postsCollection().doc(postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists || postSnap.data()?.hidden === true) {
    throw new StudentsServiceError("Post not found.", "not_found", 404);
  }

  const { handleId, data: prof } = await getOrCreateOwnProfileDoc(uid);
  const authorName = String(prof.displayName ?? "YFactory Student");
  const now = Date.now();
  const commentId = `cmt_${now}_${randomBytes(3).toString("hex")}`;

  await postRef.collection("comments").doc(commentId).set({
    authorHandleId: handleId,
    authorName,
    content: clean,
    createdAt: now,
  });
  await postRef.update({ commentsCount: FieldValue.increment(1) });

  return {
    id: commentId,
    authorHandleId: handleId,
    authorName,
    content: clean,
    isMine: true,
    createdAt: now,
  };
}

export async function deleteOwnCommunityPost(
  uid: string,
  postId: string,
): Promise<boolean> {
  const myHandleId = publicHandleForUid(uid);
  const ref = postsCollection().doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (snap.data()?.authorHandleId !== myHandleId) {
    throw new StudentsServiceError("You can only delete your own posts.", "forbidden", 403);
  }
  await ref.delete();
  return true;
}

export async function reportCommunityPost(
  uid: string,
  postId: string,
  reason: CommunityReportReason,
  details?: string,
): Promise<{ reported: true; autoHidden: boolean }> {
  const myHandleId = publicHandleForUid(uid);
  const postRef = postsCollection().doc(postId);
  const { db } = getFirebaseAdmin();

  const autoHidden = await db.runTransaction(async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists) {
      throw new StudentsServiceError("Post not found.", "not_found", 404);
    }
    const reporters = Array.isArray(snap.data()?.reporterHandles)
      ? (snap.data()!.reporterHandles as string[])
      : [];
    const nextReporters = reporters.includes(myHandleId)
      ? reporters
      : [...reporters, myHandleId];
    const shouldHide = nextReporters.length >= AUTO_HIDE_REPORT_THRESHOLD;
    tx.update(postRef, {
      reporterHandles: nextReporters,
      reportCount: nextReporters.length,
      ...(shouldHide ? { hidden: true } : {}),
    });
    return shouldHide;
  });

  const now = Date.now();
  await reportsCollection()
    .doc(`rep_${now}_${randomBytes(3).toString("hex")}`)
    .set({
      postId,
      reporterHandleId: myHandleId,
      reason,
      details: (details ?? "").trim().slice(0, 400),
      autoHidden,
      createdAt: now,
    });

  return { reported: true, autoHidden };
}