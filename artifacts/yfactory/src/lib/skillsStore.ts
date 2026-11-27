import { useCallback, useEffect, useState } from "react";

export type SkillScope =
  | "all"
  | "image"
  | "chat"
  | "stories"
  | "code"
  | "students";

export type YFactorySkill = {
  id: string;
  name: string;
  nameAr?: string;
  description: string;
  descriptionAr?: string;
  scopes: SkillScope[];
  instructions: string;
  promptPrefix: string;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
};

type CachedSkillsState = {
  customSkills: YFactorySkill[];
  activeIds: string[];
  updatedAt: number;
};

const STORAGE_KEY = "yfactory.skills.store.v1";
const CHANGE_EVENT = "yfactory:skills-changed";
const MAX_ACTIVE = 12;

export const BUILTIN_SKILLS: ReadonlyArray<YFactorySkill> = [
  {
    id: "builtin_global_arabic_polish",
    name: "Polished Arabic & Clarity",
    nameAr: "صياغة عربية فصيحة واحترافية",
    description: "Clean, structured Modern Standard Arabic with clear headings and accurate terminology.",
    descriptionAr: "عربية فصيحة سلسة بعناوين منظمة ومصطلحات تقنية دقيقة عبر كامل التطبيق.",
    scopes: ["all"],
    instructions:
      "Use clean, natural, well-structured Modern Standard Arabic when replying in Arabic, with clear headings, concise bullet points, and accurate technical terminology.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_global_concise_exec",
    name: "Executive Concise Output",
    nameAr: "إجابات مركّزة وعملية مباشرة",
    description: "No filler or padding — lead immediately with concrete deliverables and steps.",
    descriptionAr: "إجابات مباشرة بدون حشو أو مقدمات طويلة، تركز على الخطوات والنتائج العملية.",
    scopes: ["all"],
    instructions:
      "Lead immediately with the core answer or deliverable. Eliminate filler, repetition, and fluff. Prioritize concrete steps, specs, and direct takeaways.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_image_cinematic",
    name: "Cinematic Photo Director",
    nameAr: "مخرج صور سينمائي فائق الواقعية",
    description: "Upgrades image prompts with 35mm cinema lighting, depth of field, and crisp textures.",
    descriptionAr: "يرفع جودة أوامر الصور تلقائياً بإضاءة سينمائية 35mm وعمق ميدان وخامات واقعية.",
    scopes: ["image"],
    instructions:
      "Ultra-detailed 35mm cinema photography, natural volumetric lighting, rich dynamic range, authentic skin/surface textures, crisp depth of field, rule-of-thirds composition, no watermarks or garbled text.",
    promptPrefix:
      "cinematic 35mm photography, natural volumetric lighting, crisp depth of field, rich realistic textures, clean composition",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_image_product_studio",
    name: "Commercial Product Studio",
    nameAr: "استوديو منتجات وإعلانات تجارية",
    description: "Clean editorial studio lighting and luxury composition for products & ads.",
    descriptionAr: "إضاءة استوديو إعلانية احترافية وتكوين نظيف للصور التجارية والمنتجات.",
    scopes: ["image"],
    instructions:
      "High-end editorial commercial product photography, clean softbox key lighting, subtle rim light, realistic reflections, minimalist luxury backdrop, sharp macro focus.",
    promptPrefix:
      "commercial studio product photography, clean softbox lighting, subtle rim light, crisp macro focus, luxury editorial backdrop",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_chat_product_architect",
    name: "Principal Tech & Product Advisor",
    nameAr: "مستشار تقني ومنتجات متعمّق",
    description: "Candid architecture & product feedback weighing UX, cost, and server stability.",
    descriptionAr: "تحليل صريح ومعمّق للمنتجات والبرمجيات مع مراعاة الأداء وحمل السيرفر وتجربة المستخدم.",
    scopes: ["chat"],
    instructions:
      "Act as a pragmatic principal software & product architect. Evaluate trade-offs honestly (cost, server load, UX, security), highlight edge cases, and propose actionable next steps.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_chat_pro_translator",
    name: "Pro Context Translator (AR/EN/FR)",
    nameAr: "مترجم سياقي احترافي (عربي/إنجليزي/فرنسي)",
    description: "Natural idiomatic translation preserving tone, formatting, and technical terms.",
    descriptionAr: "ترجمة احترافية تحافظ على المعنى والأسلوب والمصطلحات التقنية بين العربية والإنجليزية والفرنسية.",
    scopes: ["chat"],
    instructions:
      "Deliver idiomatic, culturally accurate translations across Arabic, English, and French while preserving tone, technical precision, and formatting.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_stories_screenwriter",
    name: "Master Storyboard & Consistency",
    nameAr: "كاتب سيناريو واتّساق شخصيات القصص",
    description: "Enforces visual continuity, character traits, and cinematic pacing across all story scenes.",
    descriptionAr: "يضبط تسلسل المشاهد وثبات ملامح وملابس الشخصيات وأجواء العالم عبر كامل القصة.",
    scopes: ["stories"],
    instructions:
      "Maintain strict visual and narrative continuity across all story scenes: keep character wardrobe, facial traits, lighting mood, and world rules consistent from scene 1 to the finale.",
    promptPrefix:
      "Maintain strict character identity, wardrobe, and atmospheric lighting continuity across every scene",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_stories_higgsfield_director",
    name: "Higgsfield Motion Director",
    nameAr: "مخرج حركة كاميرا Higgsfield",
    description: "Enriches Higgsfield handoff prompts with smooth 24fps camera choreography & identity lock.",
    descriptionAr: "يعزّز أوامر تحريك مشاهد القصص في Higgsfield بحركة كاميرا ناعمة وثبات ملامح الشخصيات.",
    scopes: ["stories"],
    instructions:
      "Frame every motion directive with smooth 24fps camera choreography, natural physics, stable facial identity, atmospheric depth, and clean start-to-end motion pacing.",
    promptPrefix:
      "smooth 24fps film camera choreography, stable character face identity, realistic physics and ambient light",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_code_strict_ts",
    name: "Strict TypeScript & Security Guard",
    nameAr: "مراجع TypeScript وأمان الكود",
    description: "Type-safe TypeScript, zero `any`, input validation, and clean production diffs.",
    descriptionAr: "كود TypeScript صارم وآمن مع التحقق من المدخلات وتعديلات نظيفة جاهزة للإنتاج.",
    scopes: ["code"],
    instructions:
      "Write strict, type-safe TypeScript with zero `any`, explicit error handling, input validation, no exposed secrets, and minimal, clean diffs ready for production.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_code_mobile_pwa",
    name: "Mobile-First PWA & RTL Specialist",
    nameAr: "خبير واجهات الهاتف وPWA وRTL",
    description: "Mobile-first responsive layouts, crisp RTL support, zero overflow, lightweight bundles.",
    descriptionAr: "تصميم متجاوب للهاتف أولاً مع دعم كامل للعربية RTL وبدون أي خروج عن الشاشة.",
    scopes: ["code"],
    instructions:
      "Optimize every UI component for mobile screens first: prevent horizontal overflow, support full RTL/LTR directionality, maintain >=40px tap targets, and keep bundles lightweight.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_students_socratic",
    name: "Socratic Mentor & Memory Coach",
    nameAr: "مدرّب سقراطي وتثبيت الحفظ",
    description: "Step-by-step guided discovery, memory mnemonics, and quick understanding checks.",
    descriptionAr: "يشرح بالأمثلة والروابط الذهنية لتثبيت الحفظ ويختم بسؤال سريع للتأكد من الفهم.",
    scopes: ["students"],
    instructions:
      "Teach through guided discovery: break ideas into bite-sized intuition, add memorable mnemonics or visual analogies, and end with a targeted check-understanding prompt.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "builtin_students_exam_strategist",
    name: "Exam Mastery & Trap Prevention",
    nameAr: "خبير تفوّق في الامتحانات وتجنّب الفخاخ",
    description: "Highlights rubric keywords, common exam traps, and step-by-step answer verification.",
    descriptionAr: "يركّز على الكلمات المفتاحية للدرجة الكاملة وتنبيهات الأخطاء الشائعة في الامتحانات.",
    scopes: ["students"],
    instructions:
      "Highlight the exact scoring rubric keywords, warn about common student mistakes and trick questions, and show clean step-by-step verification for every solution.",
    promptPrefix: "",
    isBuiltIn: true,
    createdAt: 1,
    updatedAt: 1,
  },
];

let memoryState: CachedSkillsState | null = null;
let hydratedFromServer = false;

function readCachedState(): CachedSkillsState {
  if (memoryState) return memoryState;
  const fallback: CachedSkillsState = {
    customSkills: [],
    activeIds: [],
    updatedAt: 0,
  };
  if (typeof window === "undefined") {
    memoryState = fallback;
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memoryState = fallback;
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<CachedSkillsState>;
    memoryState = {
      customSkills: Array.isArray(parsed.customSkills)
        ? parsed.customSkills.map((s) => ({ ...s, isBuiltIn: false }))
        : [],
      activeIds: Array.isArray(parsed.activeIds)
        ? parsed.activeIds.filter((x): x is string => typeof x === "string")
        : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
    return memoryState;
  } catch {
    memoryState = fallback;
    return fallback;
  }
}

function writeCachedState(next: CachedSkillsState): void {
  memoryState = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function getAllSkills(): YFactorySkill[] {
  const st = readCachedState();
  return [...st.customSkills, ...BUILTIN_SKILLS];
}

export function getActiveSkillIds(): string[] {
  return readCachedState().activeIds;
}

export function getActiveSkillsForScope(
  scope: SkillScope,
  extraScopes: SkillScope[] = [],
): YFactorySkill[] {
  const activeSet = new Set(readCachedState().activeIds);
  if (activeSet.size === 0) return [];
  const wanted = new Set<SkillScope>(["all", scope, ...extraScopes]);
  return getAllSkills().filter(
    (sk) =>
      activeSet.has(sk.id) &&
      (scope === "all" || sk.scopes.some((s) => wanted.has(s))),
  );
}

export function getLocalizedSkillName(skill: YFactorySkill, locale: string): string {
  return locale.startsWith("ar") && skill.nameAr ? skill.nameAr : skill.name;
}

export function getLocalizedSkillDesc(skill: YFactorySkill, locale: string): string {
  return locale.startsWith("ar") && skill.descriptionAr
    ? skill.descriptionAr
    : skill.description;
}

/**
 * Formats active skills into a clean system-prompt instruction block
 * for Chat, Unified Agent, Code, Stories, and Students.
 */
export function buildSkillsSystemDirective(
  scope: SkillScope,
  extraScopes: SkillScope[] = [],
): string {
  const active = getActiveSkillsForScope(scope, extraScopes);
  if (active.length === 0) return "";
  return [
    `ACTIVE YFACTORY SKILLS (follow these user-selected rules across this task):`,
    ...active.map((s) => `- [${s.name}]: ${s.instructions}`),
  ]
    .join("\n")
    .slice(0, 4500);
}

/**
 * Enhances an image or image-edit prompt using active Image (and Global) skills.
 */
export function applySkillsToImagePrompt(rawPrompt: string): string {
  const active = getActiveSkillsForScope("image");
  if (active.length === 0) return rawPrompt;
  const directives = active
    .map((s) => (s.promptPrefix.trim() || s.instructions.trim()).slice(0, 260))
    .filter(Boolean);
  if (directives.length === 0) return rawPrompt;
  return `${rawPrompt.trim()}\n\n[Style & Direction Rules: ${directives.join(" | ")}]`.slice(
    0,
    20_000,
  );
}

/**
 * Enhances a Higgsfield / Story motion prompt using active Stories skills.
 */
export function applySkillsToMotionPrompt(rawPrompt: string): string {
  const active = getActiveSkillsForScope("stories");
  if (active.length === 0) return rawPrompt;
  const cues = active
    .map((s) => (s.promptPrefix.trim() || s.instructions.trim()).slice(0, 220))
    .filter(Boolean);
  if (cues.length === 0) return rawPrompt;
  return `${rawPrompt.trim()}\nSkill Direction: ${cues.join(" · ")}`;
}

async function skillsFetch<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : `Skills API error (HTTP ${resp.status})`,
    );
  }
  return data as T;
}

export async function syncSkillsFromServer(
  getIdToken?: () => Promise<string>,
  force = false,
): Promise<CachedSkillsState> {
  if (!getIdToken || (hydratedFromServer && !force)) {
    return readCachedState();
  }
  try {
    const tok = await getIdToken();
    const remote = await skillsFetch<{
      customSkills: YFactorySkill[];
      activeIds: string[];
      updatedAt: number;
    }>("/api/skills", tok);
    hydratedFromServer = true;
    const next: CachedSkillsState = {
      customSkills: (remote.customSkills ?? []).map((s) => ({
        ...s,
        isBuiltIn: false,
      })),
      activeIds: remote.activeIds ?? [],
      updatedAt: remote.updatedAt ?? Date.now(),
    };
    writeCachedState(next);
    return next;
  } catch {
    return readCachedState();
  }
}

export async function toggleSkillActive(
  skillId: string,
  getIdToken?: () => Promise<string>,
): Promise<string[]> {
  const cur = readCachedState();
  const isOn = cur.activeIds.includes(skillId);
  const nextActive = isOn
    ? cur.activeIds.filter((id) => id !== skillId)
    : [...cur.activeIds, skillId].slice(-MAX_ACTIVE);

  writeCachedState({ ...cur, activeIds: nextActive, updatedAt: Date.now() });

  if (getIdToken) {
    try {
      const tok = await getIdToken();
      const res = await skillsFetch<{ activeIds: string[] }>(
        "/api/skills/state",
        tok,
        { method: "PUT", body: JSON.stringify({ activeIds: nextActive }) },
      );
      writeCachedState({
        ...readCachedState(),
        activeIds: res.activeIds,
        updatedAt: Date.now(),
      });
      return res.activeIds;
    } catch {
      // Keep optimistic local toggle if server is temporarily unavailable.
    }
  }
  return nextActive;
}

export async function clearActiveSkillsForScope(
  scope: SkillScope,
  getIdToken?: () => Promise<string>,
): Promise<string[]> {
  const cur = readCachedState();
  const all = getAllSkills();
  const byId = new Map(all.map((s) => [s.id, s]));
  const nextActive = cur.activeIds.filter((id) => {
    if (scope === "all") return false;
    const sk = byId.get(id);
    if (!sk) return false;
    return !sk.scopes.includes(scope) && !sk.scopes.includes("all");
  });
  writeCachedState({ ...cur, activeIds: nextActive, updatedAt: Date.now() });
  if (getIdToken) {
    try {
      const tok = await getIdToken();
      await skillsFetch("/api/skills/state", tok, {
        method: "PUT",
        body: JSON.stringify({ activeIds: nextActive }),
      });
    } catch {
      // ignore transient error
    }
  }
  return nextActive;
}

export async function saveNewCustomSkill(
  input: {
    name: string;
    description: string;
    scopes: SkillScope[];
    instructions: string;
    promptPrefix?: string;
    activate?: boolean;
  },
  getIdToken?: () => Promise<string>,
): Promise<YFactorySkill> {
  if (getIdToken) {
    const tok = await getIdToken();
    const res = await skillsFetch<{ skill: YFactorySkill; activeIds: string[] }>(
      "/api/skills",
      tok,
      { method: "POST", body: JSON.stringify(input) },
    );
    const cur = readCachedState();
    const created: YFactorySkill = { ...res.skill, isBuiltIn: false };
    writeCachedState({
      customSkills: [created, ...cur.customSkills.filter((s) => s.id !== created.id)],
      activeIds: res.activeIds,
      updatedAt: Date.now(),
    });
    return created;
  }

  const now = Date.now();
  const local: YFactorySkill = {
    id: `skill_local_${now}`,
    name: input.name.trim().slice(0, 80),
    description: input.description.trim().slice(0, 220),
    scopes: input.scopes.length > 0 ? input.scopes : ["all"],
    instructions: input.instructions.trim().slice(0, 3000),
    promptPrefix: (input.promptPrefix ?? "").trim().slice(0, 400),
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  };
  const cur = readCachedState();
  writeCachedState({
    customSkills: [local, ...cur.customSkills],
    activeIds:
      input.activate !== false
        ? [...new Set([...cur.activeIds, local.id])].slice(-MAX_ACTIVE)
        : cur.activeIds,
    updatedAt: now,
  });
  return local;
}

export async function editCustomSkill(
  skillId: string,
  patch: {
    name: string;
    description: string;
    scopes: SkillScope[];
    instructions: string;
    promptPrefix?: string;
  },
  getIdToken?: () => Promise<string>,
): Promise<YFactorySkill> {
  if (getIdToken) {
    const tok = await getIdToken();
    const res = await skillsFetch<{ skill: YFactorySkill }>(
      `/api/skills/${encodeURIComponent(skillId)}`,
      tok,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    const cur = readCachedState();
    const updated: YFactorySkill = { ...res.skill, isBuiltIn: false };
    writeCachedState({
      ...cur,
      customSkills: cur.customSkills.map((s) => (s.id === updated.id ? updated : s)),
      updatedAt: Date.now(),
    });
    return updated;
  }

  const cur = readCachedState();
  const existing = cur.customSkills.find((s) => s.id === skillId);
  if (!existing) throw new Error("Skill not found.");
  const updated: YFactorySkill = {
    ...existing,
    ...patch,
    promptPrefix: patch.promptPrefix ?? existing.promptPrefix,
    updatedAt: Date.now(),
  };
  writeCachedState({
    ...cur,
    customSkills: cur.customSkills.map((s) => (s.id === skillId ? updated : s)),
    updatedAt: Date.now(),
  });
  return updated;
}

export async function removeCustomSkill(
  skillId: string,
  getIdToken?: () => Promise<string>,
): Promise<void> {
  if (getIdToken) {
    const tok = await getIdToken();
    const res = await skillsFetch<{ deleted: boolean; activeIds: string[] }>(
      `/api/skills/${encodeURIComponent(skillId)}`,
      tok,
      { method: "DELETE" },
    );
    const cur = readCachedState();
    writeCachedState({
      customSkills: cur.customSkills.filter((s) => s.id !== skillId),
      activeIds: res.activeIds,
      updatedAt: Date.now(),
    });
    return;
  }
  const cur = readCachedState();
  writeCachedState({
    customSkills: cur.customSkills.filter((s) => s.id !== skillId),
    activeIds: cur.activeIds.filter((id) => id !== skillId),
    updatedAt: Date.now(),
  });
}

export function useYFactorySkills(getIdToken?: () => Promise<string>) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener(CHANGE_EVENT, onChange);
    if (getIdToken && !hydratedFromServer) {
      void syncSkillsFromServer(getIdToken);
    }
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [getIdToken]);

  const allSkills = getAllSkills();
  const activeIds = getActiveSkillIds();

  const getActiveForScope = useCallback(
    (scope: SkillScope, extraScopes: SkillScope[] = []) =>
      getActiveSkillsForScope(scope, extraScopes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  return {
    allSkills,
    activeIds,
    getActiveForScope,
    toggleSkill: (id: string) => toggleSkillActive(id, getIdToken),
    clearScope: (scope: SkillScope) => clearActiveSkillsForScope(scope, getIdToken),
    createSkill: (input: Parameters<typeof saveNewCustomSkill>[0]) =>
      saveNewCustomSkill(input, getIdToken),
    updateSkill: (id: string, patch: Parameters<typeof editCustomSkill>[1]) =>
      editCustomSkill(id, patch, getIdToken),
    deleteSkill: (id: string) => removeCustomSkill(id, getIdToken),
    refresh: () => syncSkillsFromServer(getIdToken, true),
  };
}