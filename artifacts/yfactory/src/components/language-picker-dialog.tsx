import { useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import {
  getAvailableLanguages,
  isRtlLanguage,
  type AppLanguageOption,
} from '@/lib/languages';

type LanguagePickerDialogProps = {
  open: boolean;
  currentCode: string;
  onClose: () => void;
  onSelect: (language: AppLanguageOption) => void;
};

function getPickerLabels(lang: string) {
  if (lang.startsWith('ar')) {
    return {
      title: `اختر اللغة`,
      search: `ابحث عن لغة...`,
      empty: `لا توجد لغة مطابقة للبحث.`,
      close: `إغلاق`,
    };
  }
  if (lang.startsWith('fr')) {
    return {
      title: `Choisir la langue`,
      search: `Rechercher une langue...`,
      empty: `Aucune langue trouvée.`,
      close: `Fermer`,
    };
  }
  if (lang.startsWith('es')) {
    return {
      title: `Elegir idioma`,
      search: `Buscar idioma...`,
      empty: `No se encontraron idiomas.`,
      close: `Cerrar`,
    };
  }
  return {
    title: `Choose language`,
    search: `Search languages...`,
    empty: `No matching languages found.`,
    close: `Close`,
  };
}

export default function LanguagePickerDialog({
  open,
  currentCode,
  onClose,
  onSelect,
}: LanguagePickerDialogProps) {
  const [query, setQuery] = useState('');
  const isRtl = isRtlLanguage(currentCode);
  const ui = getPickerLabels(currentCode);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const languages = getAvailableLanguages();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = languages.filter((item) => {
    if (!normalizedQuery) return true;
    return (
      item.nativeName.toLocaleLowerCase().includes(normalizedQuery) ||
      item.englishName.toLocaleLowerCase().includes(normalizedQuery) ||
      item.code.toLocaleLowerCase().includes(normalizedQuery)
    );
  });

  const activeNormalized = currentCode.trim().toLowerCase();

  return (
    <div
      className="lang-picker-backdrop"
      dir={isRtl ? 'rtl' : 'ltr'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="language-picker-dialog"
    >
      <section
        className="lang-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={ui.title}
      >
        <div className="lang-picker-grabber" aria-hidden="true" />
        <div className="lang-picker-head">
          <h2>{ui.title}</h2>
          <button
            type="button"
            className="lang-picker-close"
            onClick={onClose}
            aria-label={ui.close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <label className="lang-picker-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={ui.search}
            aria-label={ui.search}
            autoFocus
            data-testid="input-language-search"
          />
        </label>

        <div className="lang-picker-list" role="listbox" aria-label={ui.title}>
          {filtered.length === 0 ? (
            <div className="lang-picker-empty">{ui.empty}</div>
          ) : (
            filtered.map((lang) => {
              const isSelected = lang.code.toLowerCase() === activeNormalized;
              return (
                <button
                  type="button"
                  key={lang.code}
                  role="option"
                  aria-selected={isSelected}
                  className={`lang-picker-row ${isSelected ? 'is-active' : ''}`}
                  onClick={() => {
                    onSelect(lang);
                    onClose();
                  }}
                  data-testid={`button-lang-${lang.code}`}
                >
                  <span className="lang-picker-names">
                    <strong dir="auto">{lang.nativeName}</strong>
                    <small>{lang.englishName}</small>
                  </span>
                  <span className="lang-picker-badges">
                    {lang.dir === 'rtl' && (
                      <span className="lang-picker-dir">RTL</span>
                    )}
                    {isSelected && (
                      <Check
                        size={18}
                        className="lang-picker-check"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
