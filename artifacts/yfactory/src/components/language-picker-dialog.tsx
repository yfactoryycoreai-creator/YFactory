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

type PickerCopy = {
  title: string;
  search: string;
  empty: string;
  close: string;
};

const PICKER_COPY: Record<string, PickerCopy> = {
  ar: {
    title: `اختر اللغة`,
    search: `ابحث عن لغة...`,
    empty: `لا توجد لغة مطابقة للبحث.`,
    close: `إغلاق`,
  },
  fr: {
    title: `Choisir la langue`,
    search: `Rechercher une langue...`,
    empty: `Aucune langue trouvée.`,
    close: `Fermer`,
  },
  es: {
    title: `Elegir idioma`,
    search: `Buscar idioma...`,
    empty: `No se encontraron idiomas.`,
    close: `Cerrar`,
  },
  de: {
    title: `Sprache wählen`,
    search: `Sprachen suchen...`,
    empty: `Keine passende Sprache gefunden.`,
    close: `Schließen`,
  },
  it: {
    title: `Scegli lingua`,
    search: `Cerca lingue...`,
    empty: `Nessuna lingua trovata.`,
    close: `Chiudi`,
  },
  pt: {
    title: `Escolher idioma`,
    search: `Pesquisar idiomas...`,
    empty: `Nenhum idioma encontrado.`,
    close: `Fechar`,
  },
  tr: {
    title: `Dil seçin`,
    search: `Dil ara...`,
    empty: `Eşleşen dil bulunamadı.`,
    close: `Kapat`,
  },
  ru: {
    title: `Выберите язык`,
    search: `Поиск языков...`,
    empty: `Подходящие языки не найдены.`,
    close: `Закрыть`,
  },
  ur: {
    title: `زبان منتخب کریں`,
    search: `زبان تلاش کریں...`,
    empty: `کوئی زبان نہیں ملی۔`,
    close: `بند کریں`,
  },
  fa: {
    title: `انتخاب زبان`,
    search: `جستجوی زبان...`,
    empty: `هیچ زبان مطابقی یافت نشد.`,
    close: `بستن`,
  },
  'zh-cn': {
    title: `选择语言`,
    search: `搜索语言...`,
    empty: `未找到匹配的语言。`,
    close: `关闭`,
  },
  'zh-tw': {
    title: `選擇語言`,
    search: `搜尋語言...`,
    empty: `找不到相符的語言。`,
    close: `關閉`,
  },
  ja: {
    title: `言語を選択`,
    search: `言語を検索...`,
    empty: `一致する言語が見つかりません。`,
    close: `閉じる`,
  },
  ko: {
    title: `언어 선택`,
    search: `언어 검색...`,
    empty: `일치하는 언어가 없습니다.`,
    close: `닫기`,
  },
  hi: {
    title: `भाषा चुनें`,
    search: `भाषा खोजें...`,
    empty: `कोई मेल खाती भाषा नहीं मिली।`,
    close: `बंद करें`,
  },
  id: {
    title: `Pilih bahasa`,
    search: `Cari bahasa...`,
    empty: `Tidak ada bahasa yang cocok.`,
    close: `Tutup`,
  },
  bn: {
    title: `ভাষা নির্বাচন করুন`,
    search: `ভাষা খুঁজুন...`,
    empty: `কোনো মিল পাওয়া যায়নি।`,
    close: `বন্ধ করুন`,
  },
  en: {
    title: `Choose language`,
    search: `Search languages...`,
    empty: `No matching languages found.`,
    close: `Close`,
  },
};

function getPickerLabels(lang: string): PickerCopy {
  const lower = lang.trim().toLowerCase();
  const base = lower.split('-')[0] ?? 'en';
  return PICKER_COPY[lower] ?? PICKER_COPY[base] ?? PICKER_COPY.en!;
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
