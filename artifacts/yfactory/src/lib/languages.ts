import i18n from 'i18next';

export type LanguageDirection = 'ltr' | 'rtl';

export type AppLanguageOption = {
  code: string;
  nativeName: string;
  englishName: string;
  dir: LanguageDirection;
};

const BLOCKED_LANGUAGE_PREFIXES = ['he', 'iw'];
const RTL_LANGUAGE_PREFIXES = ['ar', 'ur', 'fa', 'ps', 'sd', 'ckb', 'ug', 'dv'];

export function isBlockedLanguage(code: string): boolean {
  const lower = code.trim().toLowerCase();
  return BLOCKED_LANGUAGE_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}-`),
  );
}

export function isRtlLanguage(code: string | null | undefined): boolean {
  if (!code) return false;
  const lower = code.trim().toLowerCase();
  return RTL_LANGUAGE_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}-`),
  );
}

export function getLanguageDirection(
  code: string | null | undefined,
): LanguageDirection {
  return isRtlLanguage(code) ? 'rtl' : 'ltr';
}

const registeredLanguages: AppLanguageOption[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
];

export function getAvailableLanguages(): AppLanguageOption[] {
  return [...registeredLanguages];
}

export function findLanguageOption(
  code: string | null | undefined,
): AppLanguageOption {
  const normalized = (code ?? 'en').trim().toLowerCase();
  const exact = registeredLanguages.find(
    (item) => item.code.toLowerCase() === normalized,
  );
  if (exact) return exact;
  const base = normalized.split('-')[0] ?? 'en';
  const prefixMatch = registeredLanguages.find(
    (item) => item.code.toLowerCase() === base,
  );
  return prefixMatch ?? registeredLanguages[0]!;
}

export function applyDocumentLanguage(code: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = getLanguageDirection(code);
}

export function registerLanguagePack(
  meta: AppLanguageOption,
  resources: {
    translation: Record<string, unknown>;
    chat: Record<string, unknown>;
  },
): void {
  if (isBlockedLanguage(meta.code)) return;
  if (!registeredLanguages.some((item) => item.code === meta.code)) {
    registeredLanguages.push(meta);
  }
  const supported = i18n.options.supportedLngs;
  if (Array.isArray(supported) && !supported.includes(meta.code)) {
    supported.push(meta.code);
  }
  i18n.addResourceBundle(meta.code, 'translation', resources.translation, true, true);
  i18n.addResourceBundle(meta.code, 'chat', resources.chat, true, true);
}

export function changeAppLanguage(code: string): void {
  if (isBlockedLanguage(code)) return;
  const target = findLanguageOption(code);
  applyDocumentLanguage(target.code);
  try {
    window.localStorage.setItem('yfactory.locale', target.code);
  } catch {
    // Keep active in session even if storage is unavailable.
  }
  void i18n.changeLanguage(target.code);
}

let directionHookBound = false;

export function initLanguageDirectionSync(): void {
  if (directionHookBound) return;
  directionHookBound = true;

  i18n.on('languageChanged', (language) => {
    applyDocumentLanguage(language);
  });

  try {
    const saved =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('yfactory.locale')
        : null;
    if (saved && !isBlockedLanguage(saved)) {
      const match = registeredLanguages.find(
        (item) => item.code.toLowerCase() === saved.toLowerCase(),
      );
      if (match && match.code !== i18n.language) {
        applyDocumentLanguage(match.code);
        void i18n.changeLanguage(match.code);
        return;
      }
    }
  } catch {
    // Ignore storage read errors.
  }
  applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language ?? 'en');
}
