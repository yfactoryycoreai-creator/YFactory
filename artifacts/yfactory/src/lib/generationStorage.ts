export type GeneratorSettings = {
  imageCount: '1' | '2' | '4';
  videoDuration: '5' | '10' | '15';
  videoRatio: '16:9' | '9:16' | '1:1';
  videoQuality: '720p' | '1080p' | '2160p';
  audioVoice: 'default' | 'warm' | 'bright';
  audioDuration: '30' | '60' | '90';
  audioStyle: 'natural' | 'cinematic' | 'energetic';
};

export type GeneratedImageHistoryItem = {
  id: string;
  prompt: string;
  createdAt: number;
  imageData: string;
  savedToFactory?: boolean;
  provider?: 'agnes' | 'glm' | 'zsky' | 'pollinations';
};

export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  imageCount: '1',
  videoDuration: '5',
  videoRatio: '16:9',
  videoQuality: '720p',
  audioVoice: 'default',
  audioDuration: '30',
  audioStyle: 'natural',
};

const SETTINGS_STORAGE_KEY = 'yfactory.generator-settings.v1';
const IMAGE_HISTORY_STORAGE_KEY = 'yfactory.image-history.v1';
export const MAX_PERSISTED_IMAGES = 8;

const allowedValues: {
  [Key in keyof GeneratorSettings]: readonly GeneratorSettings[Key][];
} = {
  imageCount: ['1', '2', '4'],
  videoDuration: ['5', '10', '15'],
  videoRatio: ['16:9', '9:16', '1:1'],
  videoQuality: ['720p', '1080p', '2160p'],
  audioVoice: ['default', 'warm', 'bright'],
  audioDuration: ['30', '60', '90'],
  audioStyle: ['natural', 'cinematic', 'energetic'],
};

function isAllowedSetting<Key extends keyof GeneratorSettings>(
  key: Key,
  value: unknown,
): value is GeneratorSettings[Key] {
  return (
    typeof value === 'string' &&
    (allowedValues[key] as readonly string[]).includes(value)
  );
}

export function readGeneratorSettings(): GeneratorSettings {
  if (typeof window === 'undefined') return DEFAULT_GENERATOR_SETTINGS;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_GENERATOR_SETTINGS;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const settings = { ...DEFAULT_GENERATOR_SETTINGS };

    (Object.keys(settings) as (keyof GeneratorSettings)[]).forEach((key) => {
      if (isAllowedSetting(key, saved[key])) {
        Object.assign(settings, {
          [key]: saved[key] as GeneratorSettings[typeof key],
        });
      }
    });

    return settings;
  } catch {
    return DEFAULT_GENERATOR_SETTINGS;
  }
}

export function writeGeneratorSettings(settings: GeneratorSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function isGeneratedImageHistoryItem(
  value: unknown,
): value is GeneratedImageHistoryItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.prompt === 'string' &&
    typeof item.createdAt === 'number' &&
    typeof item.imageData === 'string' &&
    (item.provider === undefined ||
      item.provider === 'agnes' ||
      item.provider === 'glm' ||
      item.provider === 'zsky' ||
      item.provider === 'pollinations') &&
    (item.imageData.startsWith('data:image/') ||
      (item.savedToFactory === true &&
        item.imageData.startsWith('https://')))
  );
}

export function readGeneratedImageHistory(): GeneratedImageHistoryItem[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(IMAGE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isGeneratedImageHistoryItem)
      .slice(0, MAX_PERSISTED_IMAGES);
  } catch {
    return [];
  }
}

export function writeGeneratedImageHistory(
  history: GeneratedImageHistoryItem[],
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    IMAGE_HISTORY_STORAGE_KEY,
    JSON.stringify(history.slice(0, MAX_PERSISTED_IMAGES)),
  );
}
