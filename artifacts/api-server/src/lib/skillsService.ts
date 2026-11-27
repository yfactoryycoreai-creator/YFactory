import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebaseAdmin";

export type SkillScope =
  | "all"
  | "image"
  | "chat"
  | "stories"
  | "code"
  | "students";

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  scopes: SkillScope[];
  instructions: string;
  promptPrefix: string;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
};

export type UserSkillsSnapshot = {
  customSkills: SkillRecord[];
  activeIds: string[];
  updatedAt: number;
};

export class SkillsServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const VALID_SCOPES: ReadonlyArray<SkillScope> = [
  "all",
  "image",
  "chat",
  "stories",
  "code",
  "students",
];

const MAX_CUSTOM_SKILLS = 40;
const MAX_ACTIVE_SKILLS = 12;

/**
 * Built-in curated skills mirrored on the frontend so backend services
 * (Students AI Teacher, Interactive Exams, etc.) can resolve instructions
 * for both built-in and custom skills without extra client payloads.
 */
export const BUILTIN_SKILL_INSTRUCTIONS: Readonly<
  Record<string, { name: string; scopes: SkillScope[]; instructions: string }>
> = {
  builtin_global_arabic_polish: {
    name: "Polished Arabic & Clarity",
    scopes: ["all"],
    instructions:
      "Use clean, natural, well-structured Modern Standard Arabic when replying in Arabic, with clear headings, concise bullet points, and accurate technical terminology.",
  },
  builtin_global_concise_exec: {
    name: "Executive Concise Output",
    scopes: ["all"],
    instructions:
      "Lead immediately with the core answer or deliverable. Eliminate filler, repetition, and fluff. Prioritize concrete steps, specs, and direct takeaways.",
  },
  builtin_image_cinematic: {
    name: "Cinematic Photo Director",
    scopes: ["image"],
    instructions:
      "Ultra-detailed 35mm cinema photography, natural volumetric lighting, rich dynamic range, authentic skin/surface textures, crisp depth of field, rule-of-thirds composition, no watermarks or garbled text.",
  },
  builtin_image_product_studio: {
    name: "Commercial Product Studio",
    scopes: ["image"],
    instructions:
      "High-end editorial commercial product photography, clean softbox key lighting, subtle rim light, realistic reflections, minimalist luxury backdrop, sharp macro focus.",
  },
  builtin_chat_product_architect: {
    name: "Principal Tech & Product Advisor",
    scopes: ["chat"],
    instructions:
      "Act as a pragmatic principal software & product architect. Evaluate trade-offs honestly (cost, server load, UX, security), highlight edge cases, and propose actionable next steps.",
  },
  builtin_chat_pro_translator: {
    name: "Pro Context Translator (AR/EN/FR)",
    scopes: ["chat"],
    instructions:
      "Deliver idiomatic, culturally accurate translations across Arabic, English, and French while preserving tone, technical precision, and formatting.",
  },
  builtin_stories_screenwriter: {
    name: "Master Storyboard & Consistency",
    scopes: ["stories"],
    instructions:
      "Maintain strict visual and narrative continuity across all story scenes: keep character wardrobe, facial traits, lighting mood, and world rules consistent from scene 1 to the finale.",
  },
  builtin_stories_higgsfield_director: {
    name: "Higgsfield Motion Director",
    scopes: ["stories"],
    instructions:
      "Frame every motion directive with smooth 24fps camera choreography, natural physics, stable facial identity, atmospheric depth, and clean start-to-end motion pacing.",
  },
  builtin_code_strict_ts: {
    name: "Strict TypeScript & Security Guard",
    scopes: ["code"],
    instructions:
      "Write strict, type-safe TypeScript with zero `any`, explicit error handling, input validation, no exposed secrets, and minimal, clean diffs ready for production.",
  },
  builtin_code_mobile_pwa: {
    name: "Mobile-First PWA & RTL Specialist",
    scopes: ["code"],
    instructions:
      "Optimize every UI component for mobile screens first: prevent horizontal overflow, support full RTL/LTR directionality, maintain >=40px tap targets, and keep bundles lightweight.",
  },
  builtin_students_socratic: {
    name: "Socratic Mentor & Memory Coach",
    scopes: ["students"],
    instructions:
      "Teach through guided discovery: break ideas into bite-sized intuition, add memorable mnemonics or visual analogies, and end with a targeted check-understanding prompt.",
  },
  builtin_students_exam_strategist: {
    name: "Exam Mastery & Trap Prevention",
    scopes: ["students"],
    instructions:
      "Highlight the exact scoring rubric keywords, warn about common student mistakes and trick questions, and show clean step-by-step verification for every solution.",
  },
};

// Lightweight 20-second per-user cache to avoid repeated Firestore reads on hot paths
const SNAPSHOT_CACHE_TTL_MS = 20_000;
const snapshotCache = new Map<
  string,
  { expiresAt: number; snapshot: UserSkillsSnapshot }
>();

function userCustomSkillsCol(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("customSkills");
}

function userSkillsStateDoc(uid: string) {
  return getFirebaseAdmin()
    .db.collection("users")
    .doc(uid)
    .collection("skillsMeta")
    .doc("state");
}

function invalidateCache(uid: string): void {
  snapshotCache.delete(uid);
}

function sanitizeScopes(raw: unknown): SkillScope[] {
  if (!Array.isArray(raw)) return ["all"];
  const valid = [
    ...new Set(
      raw.filter(
        (s): s is SkillScope =>
          typeof s === "string" && VALID_SCOPES.includes(s as SkillScope),
      ),
    ),
  ];
  if (valid.length === 0) return ["all"];
  if (valid.includes("all")) return ["all"];
  return valid;
}

function skillFromDoc(id: string, d: Record<string, unknown>): SkillRecord {
  return {
    id,
    name: String(d.name ?? "Custom Skill").trim().slice(0, 80) || "Custom Skill",
    description: String(d.description ?? "").trim().slice(0, 220),
    scopes: sanitizeScopes(d.scopes),
    instructions: String(d.instructions ?? "").trim().slice(0, 3000),
    promptPrefix: String(d.promptPrefix ?? "").trim().slice(0, 400),
    isBuiltIn: false,
    createdAt: typeof d.createdAt === "number" ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

export async function getUserSkillsSnapshot(
  uid: string,
  bypassCache = false,
): Promise<UserSkillsSnapshot> {
  if (!bypassCache) {
    const cached = snapshotCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.snapshot;
    }
  }

  const [skillsSnap, stateSnap] = await Promise.all([
    userCustomSkillsCol(uid).orderBy("updatedAt", "desc").limit(MAX_CUSTOM_SKILLS).get(),
    userSkillsStateDoc(uid).get(),
  ]);

  const customSkills = skillsSnap.docs.map((doc) =>
    skillFromDoc(doc.id, doc.data() ?? {}),
  );
  const stateData = stateSnap.exists ? (stateSnap.data() ?? {}) : {};
  const validCustomIds = new Set(customSkills.map((s) => s.id));
  const rawActive = Array.isArray(stateData.activeIds)
    ? (stateData.activeIds as unknown[]).filter(
        (x): x is string =>
          typeof x === "string" &&
          (x in BUILTIN_SKILL_INSTRUCTIONS || validCustomIds.has(x)),
      )
    : [];

  const snapshot: UserSkillsSnapshot = {
    customSkills,
    activeIds: [...new Set(rawActive)].slice(0, MAX_ACTIVE_SKILLS),
    updatedAt:
      typeof stateData.updatedAt === "number" ? stateData.updatedAt : Date.now(),
  };

  snapshotCache.set(uid, {
    expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS,
    snapshot,
  });
  return snapshot;
}

export async function createCustomSkill(
  uid: string,
  input: {
    name: string;
    description?: string;
    scopes: SkillScope[];
    instructions: string;
    promptPrefix?: string;
    activate?: boolean;
  },
): Promise<{ skill: SkillRecord; activeIds: string[] }> {
  const name = input.name.trim().slice(0, 80);
  const instructions = input.instructions.trim().slice(0, 3000);
  if (!name || !instructions) {
    throw new SkillsServiceError(
      "Skill name and instructions are required.",
      "validation_failed",
      400,
    );
  }

  const current = await getUserSkillsSnapshot(uid, true);
  if (current.customSkills.length >= MAX_CUSTOM_SKILLS) {
    throw new SkillsServiceError(
      `Maximum of ${MAX_CUSTOM_SKILLS} custom skills reached. Delete an unused skill first.`,
      "skills_limit_reached",
      400,
    );
  }

  const now = Date.now();
  const id = `skill_${now}_${randomBytes(3).toString("hex")}`;
  const record: SkillRecord = {
    id,
    name,
    description: (input.description ?? "").trim().slice(0, 220),
    scopes: sanitizeScopes(input.scopes),
    instructions,
    promptPrefix: (input.promptPrefix ?? "").trim().slice(0, 400),
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  };

  await userCustomSkillsCol(uid)
    .doc(id)
    .set({ ...record, createdAtTs: Timestamp.fromMillis(now) });

  let activeIds = current.activeIds;
  if (input.activate) {
    activeIds = [...new Set([...activeIds, id])].slice(-MAX_ACTIVE_SKILLS);
    await userSkillsStateDoc(uid).set(
      { activeIds, updatedAt: now },
      { merge: true },
    );
  }

  invalidateCache(uid);
  return { skill: record, activeIds };
}

export async function updateCustomSkill(
  uid: string,
  skillId: string,
  patch: Partial<{
    name: string;
    description: string;
    scopes: SkillScope[];
    instructions: string;
    promptPrefix: string;
  }>,
): Promise<SkillRecord | null> {
  const ref = userCustomSkillsCol(uid).doc(skillId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const existing = skillFromDoc(skillId, snap.data() ?? {});
  const nextName =
    typeof patch.name === "string" ? patch.name.trim().slice(0, 80) : existing.name;
  const nextInstructions =
    typeof patch.instructions === "string"
      ? patch.instructions.trim().slice(0, 3000)
      : existing.instructions;

  if (!nextName || !nextInstructions) {
    throw new SkillsServiceError(
      "Skill name and instructions cannot be empty.",
      "validation_failed",
      400,
    );
  }

  const updated: SkillRecord = {
    ...existing,
    name: nextName,
    description:
      typeof patch.description === "string"
        ? patch.description.trim().slice(0, 220)
        : existing.description,
    scopes:
      patch.scopes !== undefined ? sanitizeScopes(patch.scopes) : existing.scopes,
    instructions: nextInstructions,
    promptPrefix:
      typeof patch.promptPrefix === "string"
        ? patch.promptPrefix.trim().slice(0, 400)
        : existing.promptPrefix,
    updatedAt: Date.now(),
  };

  await ref.set(updated, { merge: true });
  invalidateCache(uid);
  return updated;
}

export async function deleteCustomSkill(
  uid: string,
  skillId: string,
): Promise<{ deleted: boolean; activeIds: string[] }> {
  const ref = userCustomSkillsCol(uid).doc(skillId);
  const snap = await ref.get();
  if (!snap.exists) {
    const cur = await getUserSkillsSnapshot(uid);
    return { deleted: false, activeIds: cur.activeIds };
  }

  await ref.delete();
  const cur = await getUserSkillsSnapshot(uid, true);
  const activeIds = cur.activeIds.filter((id) => id !== skillId);
  if (activeIds.length !== cur.activeIds.length) {
    await userSkillsStateDoc(uid).set(
      { activeIds, updatedAt: Date.now() },
      { merge: true },
    );
  }
  invalidateCache(uid);
  return { deleted: true, activeIds };
}

export async function setActiveSkillIds(
  uid: string,
  rawActiveIds: string[],
): Promise<string[]> {
  const cur = await getUserSkillsSnapshot(uid, true);
  const validCustomIds = new Set(cur.customSkills.map((s) => s.id));
  const cleaned = [
    ...new Set(
      rawActiveIds.filter(
        (id) =>
          typeof id === "string" &&
          (id in BUILTIN_SKILL_INSTRUCTIONS || validCustomIds.has(id)),
      ),
    ),
  ].slice(0, MAX_ACTIVE_SKILLS);

  await userSkillsStateDoc(uid).set(
    { activeIds: cleaned, updatedAt: Date.now() },
    { merge: true },
  );
  invalidateCache(uid);
  return cleaned;
}

/**
 * Builds a concise system-prompt block of all active skills matching `scope`
 * (including `"all"` global skills) for server-side AI calls (Students Tutor,
 * Interactive Exams, etc.). Returns empty string if no skills are active.
 */
export async function getActiveSkillInstructionsForScope(
  uid: string,
  scope: Exclude<SkillScope, "all">,
): Promise<string> {
  const snap = await getUserSkillsSnapshot(uid);
  if (snap.activeIds.length === 0) return "";

  const customById = new Map(snap.customSkills.map((s) => [s.id, s]));
  const blocks: string[] = [];

  for (const id of snap.activeIds) {
    const built = BUILTIN_SKILL_INSTRUCTIONS[id];
    if (built) {
      if (built.scopes.includes("all") || built.scopes.includes(scope)) {
        blocks.push(`- [${built.name}]: ${built.instructions}`);
      }
      continue;
    }
    const custom = customById.get(id);
    if (custom && (custom.scopes.includes("all") || custom.scopes.includes(scope))) {
      blocks.push(`- [${custom.name}]: ${custom.instructions}`);
    }
  }

  if (blocks.length === 0) return "";
  return [
    `ACTIVE USER SKILLS (follow these customized preferences closely):`,
    ...blocks,
  ]
    .join("\n")
    .slice(0, 4500);
}