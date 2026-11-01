import {
  KeyPoolHttpError,
  keyPool,
  type KeyPoolProvider,
} from "./keyPool";

export const MOTION_PROMPT_SUFFIX =
  "No distortion, no morphing face, no watermark, no text.";
const MAX_MOTION_WORDS = 45;
const MAX_NARRATION_WORDS = 17;

export type SceneCopyInput = {
  index: number;
  scenePrompt: string;
};

export type SceneCopy = {
  index: number;
  motionPrompt: string;
  narration: string;
  motionPromptSource: "glm" | "template";
  narrationSource: "glm" | "template";
};

type ModelCall = (prompt: string) => Promise<string>;
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function words(value: string): string[] {
  return value.trim().split(/\s+/u).filter(Boolean);
}

function truncateWords(value: string, limit: number): string {
  return words(value).slice(0, limit).join(" ");
}

function cleanLine(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function normalizeStoryMotionPrompt(value: string): string | null {
  const body = cleanLine(value)
    .replaceAll(MOTION_PROMPT_SUFFIX, "")
    .replace(/[. ]+$/u, "")
    .trim();
  if (!body) return null;
  const result = `${truncateWords(body, MAX_MOTION_WORDS - words(MOTION_PROMPT_SUFFIX).length)} ${MOTION_PROMPT_SUFFIX}`;
  return words(result).length <= MAX_MOTION_WORDS ? result : null;
}

export function normalizeStoryNarration(value: string): string | null {
  const line = cleanLine(value).replace(/^["']|["']$/gu, "").trim();
  if (!line) return null;
  return truncateWords(line, MAX_NARRATION_WORDS);
}

function sceneMoment(scenePrompt: string): string {
  const captured = scenePrompt
    .split(/visual moment from this story segment:/iu)[1]
    ?.split(/Keep the progression/i)[0]
    ?.replace(/[.\s]+$/gu, "")
    .trim();
  return truncateWords(captured || scenePrompt, 18);
}

export function templateSceneCopy(scene: SceneCopyInput): SceneCopy {
  const moment = sceneMoment(scene.scenePrompt);
  const motionPrompt = normalizeStoryMotionPrompt(
    `A subject from ${moment} shifts subtly; dust drifts past as the camera makes one slow push-in.`,
  ) ?? MOTION_PROMPT_SUFFIX;
  return {
    index: scene.index,
    motionPrompt,
    narration: "The scene tightens around its secret; what moves next may change everything.",
    motionPromptSource: "template",
    narrationSource: "template",
  };
}

function parseModelOutput(
  raw: string,
  requestedScenes: SceneCopyInput[],
): SceneCopy[] {
  const json = raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const parsed: unknown = JSON.parse(json);
  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.scenes)
      ? parsed.scenes
      : [];
  const byIndex = new Map<number, JsonRecord>();
  for (const item of entries) {
    if (isRecord(item) && Number.isInteger(item.index)) {
      byIndex.set(Number(item.index), item);
    }
  }
  return requestedScenes.map((scene) => {
    const item = byIndex.get(scene.index);
    const motionPrompt = typeof item?.motionPrompt === "string"
      ? normalizeStoryMotionPrompt(item.motionPrompt)
      : null;
    const narration = typeof item?.narration === "string"
      ? normalizeStoryNarration(item.narration)
      : null;
    const fallback = templateSceneCopy(scene);
    return {
      index: scene.index,
      motionPrompt: motionPrompt ?? fallback.motionPrompt,
      narration: narration ?? fallback.narration,
      motionPromptSource: motionPrompt ? "glm" : "template",
      narrationSource: narration ? "glm" : "template",
    };
  });
}

async function callGlmTextModel(prompt: string): Promise<string> {
  const result = await keyPool.run(
    "glm",
    async (credential, signal) => {
      if (!credential.apiKey) throw new Error("GLM text credentials are unavailable.");
      const response = await fetch(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credential.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "glm-4.7-flash",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 16_000,
            temperature: 0.6,
          }),
          signal,
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new KeyPoolHttpError(
          response.status,
          body,
          response.headers.get("retry-after") ?? undefined,
        );
      }
      const payload: unknown = await response.json().catch(() => null);
      const choice = isRecord(payload) && Array.isArray(payload.choices)
        ? payload.choices[0]
        : null;
      const message = isRecord(choice) ? choice.message : null;
      const content = isRecord(message) ? message.content : null;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("GLM returned no scene text.");
      }
      return content;
    },
    { totalDeadlineMs: 60_000 },
  );
  if (!result.ok) throw new Error("GLM scene text generation failed.");
  return result.value;
}

export async function generateStorySceneCopy(
  scenes: SceneCopyInput[],
  modelCall: ModelCall = callGlmTextModel,
): Promise<SceneCopy[]> {
  if (!scenes.length) return [];
  try {
    const prompt = [
      "Write English story-pack text for every supplied scene.",
      "Return only a JSON array. Each item must have index, motionPrompt, and narration.",
      "motionPrompt: describe only subject movement, moving environment, and exactly one slow camera move; at most 45 words including this exact trailing sentence: " +
        `"${MOTION_PROMPT_SUFFIX}"`,
      "narration: one suspenseful English line, at most 17 words, with no line breaks.",
      "Do not add extra keys, markdown, explanations, or scene events not supported by the scene prompt.",
      `Scenes: ${JSON.stringify(scenes)}`,
    ].join("\n");
    return parseModelOutput(await modelCall(prompt), scenes);
  } catch {
    return scenes.map(templateSceneCopy);
  }
}

export function isKeyPoolProvider(value: unknown): value is KeyPoolProvider {
  return value === "agnes" ||
    value === "cloudflare" ||
    value === "glm" ||
    value === "magic_hour" ||
    value === "pollinations";
}
