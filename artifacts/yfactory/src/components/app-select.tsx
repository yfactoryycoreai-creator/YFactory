import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import "./app-select.css";

export type AppSelectOption = {
  value: string;
  label: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: "default" | "ok";
  imageUrl?: string;
  disabled?: boolean;
};

type AppSelectProps = {
  id?: string;
  title: string;
  value: string;
  options: ReadonlyArray<AppSelectOption>;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  dir?: "rtl" | "ltr";
  valueDir?: "rtl" | "ltr" | "auto";
  testId?: string;
  onChange: (value: string) => void;
};

export default function AppSelect({
  id,
  title,
  value,
  options,
  placeholder = "Select...",
  searchable,
  searchPlaceholder = "Search...",
  emptyText = "No matching options",
  disabled = false,
  dir = "ltr",
  valueDir = "auto",
  testId,
  onChange,
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const showSearch = searchable ?? options.length >= 7;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.subtitle && o.subtitle.toLowerCase().includes(q)) ||
        (o.badge && o.badge.toLowerCase().includes(q)),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        id={id}
        type="button"
        className="yf-select-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <span className="yf-select-trigger-main">
          {selected?.imageUrl && (
            <img
              className="yf-select-trigger-thumb"
              src={selected.imageUrl}
              alt=""
            />
          )}
          <span
            className={`yf-select-trigger-label${selected ? "" : " is-placeholder"}`}
            dir={valueDir}
          >
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown size={16} className="yf-select-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="yf-select-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          dir={dir}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="yf-select-sheet">
            <div className="yf-select-grabber" aria-hidden="true" />
            <div className="yf-select-head">
              <h3>{title}</h3>
              <button
                type="button"
                className="yf-select-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            {showSearch && (
              <label className="yf-select-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  placeholder={searchPlaceholder}
                  autoFocus
                />
              </label>
            )}

            <div className="yf-select-list" role="listbox" aria-label={title}>
              {filtered.length === 0 ? (
                <div className="yf-select-empty">{emptyText}</div>
              ) : (
                filtered.map((opt) => {
                  const isSel = opt.value === value;
                  return (
                    <button
                      key={`${opt.value}-${opt.label}`}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      disabled={opt.disabled}
                      className={`yf-select-option${isSel ? " is-selected" : ""}`}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <span className="yf-select-opt-left">
                        {opt.imageUrl && (
                          <img
                            className="yf-select-opt-thumb"
                            src={opt.imageUrl}
                            alt=""
                            loading="lazy"
                          />
                        )}
                        <span className="yf-select-opt-copy">
                          <strong dir={valueDir}>{opt.label}</strong>
                          {opt.subtitle && (
                            <small dir={valueDir}>{opt.subtitle}</small>
                          )}
                        </span>
                      </span>
                      <span className="yf-select-opt-right">
                        {opt.badge && (
                          <span
                            className={`yf-select-badge${
                              opt.badgeTone === "ok" ? " is-ok" : ""
                            }`}
                          >
                            {opt.badge}
                          </span>
                        )}
                        <span
                          className={`yf-select-radio${isSel ? " is-selected" : ""}`}
                          aria-hidden="true"
                        >
                          {isSel && <Check size={12} strokeWidth={3} />}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
