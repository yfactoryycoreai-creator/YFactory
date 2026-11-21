import type { StoryAspectRatio, StoryRecord } from '@/lib/stories';

export type ChatAgentMode = 'chat' | 'image' | 'story';

export type ImageAgentCommand = {
  type: 'generate_image';
  prompt: string;
  count: '1' | '2' | '4';
};

export type StoryAgentCommand = {
  type: 'story_setup';
  storyId?: string | null;
  storyName: string;
  script: string;
  targetCount: number;
  aspectRatio: StoryAspectRatio;
  characterTraits: string[];
  keepOneProvider: boolean;
  startGeneration: boolean;
};

export type ChatAgentCommand = ImageAgentCommand | StoryAgentCommand;

export type ChatAgentRunResult = {
  ok: boolean;
  target: 'image' | 'story';
  navigated: boolean;
  storyId?: string;
  storyName?: string;
  generatedImages?: Array<{ url: string; provider: string }>;
  errorMessage?: string;
};

const AUTO_NAV_STORAGE_KEY = 'yfactory.chat.autoNavigate';

export function readChatAutoNavigate(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const saved = window.localStorage.getItem(AUTO_NAV_STORAGE_KEY);
    if (saved === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function writeChatAutoNavigate(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      AUTO_NAV_STORAGE_KEY,
      enabled ? 'true' : 'false',
    );
  } catch {
    // Keep in-memory state if storage is unavailable.
  }
}

export function buildYFactoryChatSystemPrompt(
  attachedStory: StoryRecord | null,
): string {
  const base = [
    `You are the built-in AI assistant inside YFactory AI.`,
    `YFactory AI has its own built-in Image Generator workspace and My Stories scene generator.`,
    `NEVER tell the user to leave YFactory or use external tools like Bing Image Creator, Midjourney, or DALL-E.`,
    `If the user asks how long image or story scene generation takes, explain that scenes generate sequentially in the background inside YFactory (usually a few seconds per image depending on provider load, so 50 scenes can take several minutes) and they can track progress in the My Stories or Image tab.`,
    `If the user wants you to directly generate images or build/edit a story right now, remind them they can tap the Generate image or My Stories pill above the message box.`,
  ];
  if (attachedStory) {
    base.push(
      `Currently linked YFactory story: "${attachedStory.storyName}" (${attachedStory.targetCount} scenes, ${attachedStory.aspectRatio}).`,
    );
  }
  return base.join('\n');
}

export function buildImageAgentSystemPrompt(): string {
  return [
    `You are the YFactory AI Image Agent.`,
    `Your job is to turn the user's image request into a real generation action inside the YFactory Image workspace.`,
    `NEVER say you cannot generate images and NEVER suggest external tools like Bing or Midjourney.`,
    `If the user is asking a general question (like how long generation takes) instead of requesting a new image, answer concisely WITHOUT emitting a yfactory-action block.`,
    `When the user requests generating an image:`,
    `1. Reply briefly in the user's language confirming the image concept and count.`,
    `2. At the end of your reply, include exactly one fenced action block using this exact format:`,
    '```yfactory-action',
    `{"type":"generate_image","prompt":"detailed English visual prompt","count":1}`,
    '```',
    `Rules for JSON:`,
    `- "type" must be "generate_image".`,
    `- "prompt" must be a rich, clear English image generation prompt (max 2000 chars).`,
    `- "count" must be 1, 2, or 4 (default 1 unless the user asked for multiple images).`,
    `- Output valid JSON inside the yfactory-action block with no comments.`,
  ].join('\n');
}

export function buildStoryAgentSystemPrompt(
  attachedStory: StoryRecord | null,
): string {
  const existing = attachedStory
    ? [
        `Currently linked story — ALWAYS reuse this storyId unless the user explicitly asks to create a brand new separate story:`,
        `- storyId: "${attachedStory.id}"`,
        `- storyName: "${attachedStory.storyName}"`,
        `- current targetCount: ${attachedStory.targetCount}`,
        `- current aspectRatio: "${attachedStory.aspectRatio}"`,
        `- current characterTraits: ${JSON.stringify(attachedStory.characterTraits)}`,
        attachedStory.script.trim()
          ? `- current script excerpt: ${attachedStory.script.trim().slice(0, 3000)}`
          : `- current script: (empty)`,
      ].join('\n')
    : `No story is currently linked. Create a new story with "storyId": null.`;

  return [
    `You are the YFactory AI Story Agent connected directly to the real My Stories workspace.`,
    `YFactory AI generates scene images natively on its own backend. NEVER say you cannot generate images and NEVER recommend external tools like Bing Image Creator, Midjourney, or Leonardo.`,
    `You can create or update a story, write its script, set targetCount (1 to 100), set aspectRatio ("16:9", "9:16", or "1:1"), set up to 3 characterTraits (each max 80 chars), and start scene image generation.`,
    existing,
    `IMPORTANT: If the user is ONLY asking a question (e.g., how long generation takes, or asking for advice) and NOT asking to create, edit, or start generating a story right now, answer naturally in their language WITHOUT emitting any yfactory-action block.`,
    `When the user asks to create/update a story or start generating its scenes:`,
    `1. Reply clearly in the user's language summarizing the action.`,
    `2. At the end of your reply, include exactly one fenced action block using this exact format:`,
    '```yfactory-action',
    `{"type":"story_setup","storyId":null,"storyName":"Story Title","script":"Full story script divided into vivid scenes...","targetCount":10,"aspectRatio":"16:9","characterTraits":["trait 1","trait 2","trait 3"],"keepOneProvider":true,"startGeneration":false}`,
    '```',
    `Rules for JSON:`,
    `- "type" must be "story_setup".`,
    `- "storyId" MUST be the linked storyId above when updating/starting the current story, or null ONLY for a brand new story.`,
    `- "storyName" must be a concise title (max 100 chars).`,
    `- "script" must contain the full written story/scene script (preserve the existing script when just starting generation).`,
    `- "targetCount" must be an integer from 1 to 100 (default 10).`,
    `- "aspectRatio" must be "16:9", "9:16", or "1:1" (default "16:9").`,
    `- "characterTraits" must be an array of 0 to 3 short visual descriptions (each <= 80 chars).`,
    `- "startGeneration" must be true ONLY if the user asks to generate/render the scene images now; otherwise false.`,
    `- Output valid JSON inside the yfactory-action block with no comments.`,
  ].join('\n');
}

function normalizeImageCount(raw: unknown, userPrompt: string): '1' | '2' | '4' {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (num >= 3) return '4';
  if (num === 2) return '2';
  if (num === 1) return '1';
  if (/(?:\b4\b|four|أربع|اربع|4 صور)/i.test(userPrompt)) return '4';
  if (/(?:\b2\b|two|صورتين|صورتان|2 صور)/i.test(userPrompt)) return '2';
  return '1';
}

function normalizeAspectRatio(
  raw: unknown,
  fallback: StoryAspectRatio = '16:9',
): StoryAspectRatio {
  if (raw === '16:9' || raw === '9:16' || raw === '1:1') return raw;
  return fallback;
}

function normalizeTargetCount(raw: unknown, fallback = 10): number {
  const n = Math.round(Number(raw));
  if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  return Math.min(100, Math.max(1, fallback));
}

function normalizeTraits(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 3);
}

function tryParseCommandJson(
  jsonText: string,
  userPrompt: string,
  attachedStory: StoryRecord | null,
): ChatAgentCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.type === 'generate_image') {
    const prompt =
      typeof obj.prompt === 'string' && obj.prompt.trim()
        ? obj.prompt.trim().slice(0, 20_000)
        : userPrompt.trim().slice(0, 20_000);
    if (!prompt) return null;
    return {
      type: 'generate_image',
      prompt,
      count: normalizeImageCount(obj.count, userPrompt),
    };
  }

  if (obj.type === 'story_setup') {
    const wantsNewStory =
      /(?:new story|قصة جديدة|قصة اخرى|قصة أخرى)/i.test(userPrompt);
    const explicitId =
      typeof obj.storyId === 'string' && obj.storyId.trim()
        ? obj.storyId.trim()
        : null;
    const storyId =
      explicitId ?? (!wantsNewStory && attachedStory ? attachedStory.id : null);
    const storyName =
      typeof obj.storyName === 'string' && obj.storyName.trim()
        ? obj.storyName.trim().slice(0, 120)
        : attachedStory?.storyName ||
          userPrompt.replace(/\s+/g, ' ').trim().slice(0, 60) ||
          'New Story';
    const rawScript =
      typeof obj.script === 'string' ? obj.script.trim().slice(0, 20_000) : '';
    const script = rawScript || (attachedStory?.script ?? '');
    const targetCount = normalizeTargetCount(
      obj.targetCount,
      attachedStory?.targetCount ?? 10,
    );
    const aspectRatio = normalizeAspectRatio(
      obj.aspectRatio,
      attachedStory?.aspectRatio ?? '16:9',
    );
    const characterTraits =
      obj.characterTraits !== undefined &&
      Array.isArray(obj.characterTraits) &&
      obj.characterTraits.length > 0
        ? normalizeTraits(obj.characterTraits)
        : attachedStory?.characterTraits ?? [];
    const keepOneProvider =
      typeof obj.keepOneProvider === 'boolean'
        ? obj.keepOneProvider
        : attachedStory?.keepOneProvider ?? true;
    const startGeneration = obj.startGeneration === true;

    return {
      type: 'story_setup',
      storyId,
      storyName,
      script,
      targetCount,
      aspectRatio,
      characterTraits,
      keepOneProvider,
      startGeneration,
    };
  }

  return null;
}

export function extractAgentCommand(
  rawReply: string,
  mode: ChatAgentMode,
  userPrompt: string,
  attachedStory: StoryRecord | null,
): { cleanText: string; command: ChatAgentCommand | null } {
  const actionRegex = /```(?:yfactory-action|json)\s*([\s\S]*?)```/gi;
  let foundCommand: ChatAgentCommand | null = null;
  let cleanText = rawReply;

  let match: RegExpExecArray | null;
  while ((match = actionRegex.exec(rawReply)) !== null) {
    const candidate = tryParseCommandJson(
      (match[1] ?? '').trim(),
      userPrompt,
      attachedStory,
    );
    if (candidate) {
      foundCommand = candidate;
      cleanText = cleanText.replace(match[0], '').trim();
      break;
    }
  }

  if (!foundCommand && mode === 'image' && !rawReply.trim() && userPrompt.trim()) {
    foundCommand = {
      type: 'generate_image',
      prompt: userPrompt.trim().slice(0, 20_000),
      count: normalizeImageCount(undefined, userPrompt),
    };
  }

  return {
    cleanText: cleanText.trim() || rawReply.trim(),
    command: foundCommand,
  };
}
