import type { StoryAspectRatio, StoryRecord } from '@/lib/stories';

export type ChatAgentMode =
  | 'chat'
  | 'agent'
  | 'image'
  | 'story'
  | 'video'
  | 'code'
  | 'students';

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

export type VideoAgentCommand = {
  type: 'generate_video';
  mode: 'text_to_video' | 'image_to_video';
  prompt: string;
  aspectRatio?: string;
  durationSec?: number;
  specId?: string;
  imageInput?: string;
};

export type CodeAgentCommand = {
  type: 'code_workspace_task';
  prompt: string;
};

export type StudentsAgentCommand = {
  type: 'student_study_assist';
  topic: string;
  subject: string;
  goal: string;
};

export type ProviderRecommendAgentCommand = {
  type: 'provider_recommend';
  task: 'chat' | 'code' | 'image_generation' | 'video_generation';
  priority: 'balanced' | 'speed' | 'cost';
};

export type ChatAgentCommand =
  | ImageAgentCommand
  | StoryAgentCommand
  | VideoAgentCommand
  | CodeAgentCommand
  | StudentsAgentCommand
  | ProviderRecommendAgentCommand;

export type ChatAgentRunResult = {
  ok: boolean;
  target: 'image' | 'story' | 'video' | 'code' | 'students' | 'provider_center';
  navigated: boolean;
  taskId?: string;
  storyId?: string;
  storyName?: string;
  videoJobId?: string;
  providerId?: string;
  resultSummary?: string;
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
    `You are the built-in AI Agent & assistant inside YFactory AI.`,
    `YFactory AI has 6 integrated workspaces: Image, Chat, My Stories (supports 1 to 100 scenes including 50+ scene pipelines), Video (Text-to-Video & Image-to-Video), Code (VS Code IDE-connected agent), Students, and a unified Provider Center.`,
    `NEVER tell the user to leave YFactory or use external tools like Bing Image Creator, Midjourney, or DALL-E.`,
    `If the user asks a regular question, answer naturally in their language without emitting any action block.`,
    `If the user explicitly asks to execute an action (generate images, create/render a story, generate a video, check IDE Code status, create a study plan, or recommend the best provider), you may emit ONE validated fenced block:`,
    '```yfactory-action',
    '{"type":"generate_image","prompt":"...","count":1}',
    '```',
    `Supported action types: "generate_image", "story_setup", "generate_video", "code_workspace_task", "student_study_assist", "provider_recommend".`,
    `HONESTY RULE: For "code_workspace_task", NEVER pretend to edit files locally if no IDE is connected; the backend checks active IDE sessions automatically.`,
  ];
  if (attachedStory) {
    base.push(
      `Currently linked YFactory story: "${attachedStory.storyName}" (id: "${attachedStory.id}", ${attachedStory.targetCount} scenes, ${attachedStory.aspectRatio}).`,
    );
  }
  return base.join('\n');
}

export function buildUnifiedAgentSystemPrompt(
  attachedStory: StoryRecord | null,
): string {
  const storyLine = attachedStory
    ? `Linked story: id="${attachedStory.id}", name="${attachedStory.storyName}", targetCount=${attachedStory.targetCount}, aspectRatio="${attachedStory.aspectRatio}".`
    : `No linked story yet (use "storyId": null for a new story).`;

  return [
    `You are the YFactory AI Full Agent Orchestrator with structured tool calling across all 6 YFactory sections.`,
    storyLine,
    `Decide carefully whether the user is asking a normal question (reply normally with NO yfactory-action block) or requesting a real action inside YFactory.`,
    `When executing a real action, write a short clear confirmation in the user's language and append EXACTLY ONE valid JSON block fenced with \`\`\`yfactory-action:`,
    `1. Image: {"type":"generate_image","prompt":"rich English visual prompt","count":1}`,
    `2. My Stories (supports up to 100 scenes / 50+ scenes): {"type":"story_setup","storyId":null,"storyName":"Title","script":"Full vivid scene script...","targetCount":10,"aspectRatio":"16:9","characterTraits":["trait 1"],"keepOneProvider":true,"startGeneration":true}`,
    `3. Video: {"type":"generate_video","mode":"text_to_video","prompt":"detailed English motion prompt","aspectRatio":"16:9","durationSec":5}`,
    `4. Code (IDE-connected ONLY, NOT an App Builder): {"type":"code_workspace_task","prompt":"task description for connected VS Code workspace"}`,
    `5. Students: {"type":"student_study_assist","topic":"Lesson/exam topic","subject":"Subject","goal":"Explain & Quiz"}`,
    `6. Provider Center recommendation: {"type":"provider_recommend","task":"chat","priority":"balanced"} (task: chat|code|image_generation|video_generation; priority: balanced|speed|cost)`,
    `Never invent fake results. Output strictly valid JSON inside \`\`\`yfactory-action with no comments.`,
  ].join('\n');
}

export function buildImageAgentSystemPrompt(): string {
  return [
    `You are the YFactory AI Image Agent.`,
    `Your job is to turn the user's image request into a real generation action inside the YFactory Image workspace.`,
    `NEVER say you cannot generate images and NEVER suggest external tools like Bing or Midjourney.`,
    `If the user is asking a general question instead of requesting a new image, answer concisely WITHOUT emitting a yfactory-action block.`,
    `When the user requests generating an image:`,
    `1. Reply briefly in the user's language confirming the image concept and count.`,
    `2. At the end of your reply, include exactly one fenced action block using this exact format:`,
    '```yfactory-action',
    `{"type":"generate_image","prompt":"detailed English visual prompt","count":1}`,
    '```',
    `Rules: "type" must be "generate_image", "prompt" must be a rich English prompt, "count" must be 1, 2, or 4.`,
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
    `YFactory AI generates scene images natively on its own backend (supports 1 to 100 scenes, including 50+ scene stories tracked by the Persistent Task Manager). NEVER recommend external tools.`,
    existing,
    `IMPORTANT: If the user is ONLY asking a question and NOT asking to create, edit, or start generating a story right now, answer naturally WITHOUT emitting any yfactory-action block.`,
    `When creating/updating a story or starting scene generation, reply clearly in the user's language and append ONE fenced block:`,
    '```yfactory-action',
    `{"type":"story_setup","storyId":null,"storyName":"Story Title","script":"Full story script divided into vivid scenes...","targetCount":10,"aspectRatio":"16:9","characterTraits":["trait 1","trait 2","trait 3"],"keepOneProvider":true,"startGeneration":false}`,
    '```',
    `Rules: "targetCount" integer 1..100, "aspectRatio" "16:9"|"9:16"|"1:1", "characterTraits" 0..3 items (<=80 chars each), "startGeneration" true ONLY if user asked to render images now.`,
  ].join('\n');
}

export function buildVideoAgentSystemPrompt(): string {
  return [
    `You are the YFactory AI Video Agent connected directly to YFactory Video Studio and Provider Center.`,
    `When the user asks to generate a video, confirm briefly in their language and append ONE fenced block:`,
    '```yfactory-action',
    `{"type":"generate_video","mode":"text_to_video","prompt":"detailed English cinematic video prompt","aspectRatio":"16:9","durationSec":5}`,
    '```',
    `If the user is only asking a question, reply normally with NO action block.`,
  ].join('\n');
}

export function buildCodeAgentSystemPrompt(): string {
  return [
    `You are YFactory Code inside Chat, linked strictly to the user's connected VS Code / IDE workspace.`,
    `You are NOT an App Builder. NEVER claim to have edited local files directly from Chat.`,
    `When the user asks to inspect or route a coding task to their IDE workspace, reply briefly in their language and append ONE fenced block:`,
    '```yfactory-action',
    `{"type":"code_workspace_task","prompt":"concise engineering task for the connected IDE workspace"}`,
    '```',
    `For general coding explanations or snippets, answer directly in Markdown without emitting an action block.`,
  ].join('\n');
}

export function buildStudentsAgentSystemPrompt(): string {
  return [
    `You are the YFactory Students AI Learning Agent.`,
    `Explain concepts step-by-step clearly in the student's language.`,
    `When the user asks to start a structured study plan, lesson review, or exam prep session inside the Students workspace, reply concisely and append ONE fenced block:`,
    '```yfactory-action',
    `{"type":"student_study_assist","topic":"Core lesson or exam topic","subject":"Mathematics / Physics / Biology / etc.","goal":"Visual explanation & practice quiz"}`,
    '```',
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

  if (obj.type === 'generate_video') {
    const prompt =
      typeof obj.prompt === 'string' && obj.prompt.trim()
        ? obj.prompt.trim().slice(0, 4000)
        : userPrompt.trim().slice(0, 4000);
    if (!prompt) return null;
    const mode = obj.mode === 'image_to_video' ? 'image_to_video' : 'text_to_video';
    const duration = Number(obj.durationSec);
    return {
      type: 'generate_video',
      mode,
      prompt,
      ...(typeof obj.aspectRatio === 'string' && obj.aspectRatio.trim()
        ? { aspectRatio: obj.aspectRatio.trim() }
        : {}),
      ...(Number.isFinite(duration) && duration >= 4 && duration <= 12
        ? { durationSec: Math.round(duration) }
        : {}),
      ...(typeof obj.specId === 'string' && obj.specId.trim()
        ? { specId: obj.specId.trim() }
        : {}),
      ...(typeof obj.imageInput === 'string' && obj.imageInput.trim()
        ? { imageInput: obj.imageInput.trim() }
        : {}),
    };
  }

  if (obj.type === 'code_workspace_task') {
    const prompt =
      typeof obj.prompt === 'string' && obj.prompt.trim()
        ? obj.prompt.trim().slice(0, 2000)
        : userPrompt.trim().slice(0, 2000);
    if (!prompt) return null;
    return { type: 'code_workspace_task', prompt };
  }

  if (obj.type === 'student_study_assist') {
    const topic =
      typeof obj.topic === 'string' && obj.topic.trim()
        ? obj.topic.trim().slice(0, 240)
        : userPrompt.trim().slice(0, 120);
    if (!topic) return null;
    return {
      type: 'student_study_assist',
      topic,
      subject:
        typeof obj.subject === 'string' && obj.subject.trim()
          ? obj.subject.trim().slice(0, 80)
          : 'General',
      goal:
        typeof obj.goal === 'string' && obj.goal.trim()
          ? obj.goal.trim().slice(0, 120)
          : 'Explain & Quiz',
    };
  }

  if (obj.type === 'provider_recommend') {
    const task =
      obj.task === 'code' ||
      obj.task === 'image_generation' ||
      obj.task === 'video_generation'
        ? obj.task
        : 'chat';
    const priority =
      obj.priority === 'speed' || obj.priority === 'cost'
        ? obj.priority
        : 'balanced';
    return { type: 'provider_recommend', task, priority };
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
