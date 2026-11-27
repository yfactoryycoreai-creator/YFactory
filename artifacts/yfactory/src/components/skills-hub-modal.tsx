import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  Globe2,
  GraduationCap,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { isRtlLanguage } from "@/lib/languages";
import {
  buildSkillsSystemDirective,
  getLocalizedSkillDesc,
  getLocalizedSkillName,
  useYFactorySkills,
  type SkillScope,
  type YFactorySkill,
} from "@/lib/skillsStore";
import "./skills-hub.css";

const ALL_SCOPES: ReadonlyArray<SkillScope> = [
  "all",
  "image",
  "chat",
  "stories",
  "code",
  "students",
];

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      title: "مركز المهارات الشامل (YFactory Skills)",
      subtitle:
        "أنشئ وفعّل مهارات ذكاء اصطناعي مخصّصة تعمل تلقائياً عبر جميع أقسام التطبيق (الصور، الشات، قصصي، البرمجة، والطلاب).",
      newSkill: "إنشاء مهارة جديدة",
      editSkill: "تعديل المهارة",
      backList: "العودة للمهارات",
      searchPh: "ابحث عن مهارة...",
      activeOn: "مفعّلة",
      activeOff: "تفعيل",
      builtIn: "مهارة جاهزة",
      custom: "مهارتي",
      clearAll: "إيقاف الكل",
      exportJson: "تصدير",
      importJson: "استيراد",
      duplicate: "نسخ كمهارة مخصّصة",
      nameLbl: "اسم المهارة",
      namePh: "مثلاً: خبير قصص تاريخية، أسلوب تصوير ليلي، مراجع React...",
      descLbl: "وصف قصير (اختياري)",
      descPh: "ماذا تفعل هذه المهارة ومتى تُستخدم؟",
      scopesLbl: "الأقسام التي تعمل فيها المهارة:",
      instLbl: "تعليمات وقواعد المهارة (تُطبَّق تلقائياً على الذكاء الاصطناعي)",
      instPh: "اكتب القواعد الدقيقة والأسلوب والقيود التي تريد من الذكاء الاصطناعي الالتزام بها...",
      prefixLbl: "إضافة قصيرة لأوامر الصور / Higgsfield (اختياري)",
      prefixPh: "مثلاً: dramatic chiaroscuro lighting, 85mm lens, crisp shadows",
      saveSkill: "حفظ وتفعيل المهارة",
      saving: "جارٍ الحفظ...",
      cancel: "إلغاء",
      empty: "لا توجد مهارات مطابقة للبحث حالياً.",
      barTitle: "المهارات النشطة",
      barNone: "لا توجد مهارات مفعّلة لهذا القسم",
      manageBtn: "المهارات",
      importedOk: (n: number) => `تم استيراد ${n} مهارة بنجاح!`,
      scopes: {
        all: "الكل (شامل)",
        image: "الصور",
        chat: "الدردشة",
        stories: "قصصي",
        code: "البرمجة",
        students: "الطلاب",
      } as Record<SkillScope, string>,
    };
  }
  return {
    title: "Universal YFactory Skills Hub",
    subtitle:
      "Create and toggle custom AI skills that automatically power every workspace across YFactory (Image, Chat, My Stories, Code, and Students).",
    newSkill: "New Skill",
    editSkill: "Edit Skill",
    backList: "Back to Skills",
    searchPh: "Search skills...",
    activeOn: "Active",
    activeOff: "Activate",
    builtIn: "Built-in",
    custom: "Custom",
    clearAll: "Turn Off All",
    exportJson: "Export",
    importJson: "Import",
    duplicate: "Customize Copy",
    nameLbl: "Skill Name",
    namePh: "e.g. Historical Storyteller, Studio Lighting, Strict React Reviewer...",
    descLbl: "Short Description (optional)",
    descPh: "What does this skill do?",
    scopesLbl: "Target Workspaces (where this skill applies):",
    instLbl: "Skill Instructions & Rules (applied automatically to AI)",
    instPh: "Write the exact rules, tone, formatting, or engineering standards for the AI to follow...",
    prefixLbl: "Short Prompt Add-on for Image / Higgsfield (optional)",
    prefixPh: "e.g. dramatic chiaroscuro lighting, 85mm lens, crisp shadows",
    saveSkill: "Save & Activate Skill",
    saving: "Saving...",
    cancel: "Cancel",
    empty: "No skills match your filter.",
    barTitle: "Active Skills",
    barNone: "No skills active for this workspace",
    manageBtn: "Skills",
    importedOk: (n: number) => `Imported ${n} skill(s) successfully!`,
    scopes: {
      all: "All (Global)",
      image: "Image",
      chat: "Chat",
      stories: "My Stories",
      code: "Code",
      students: "Students",
    } as Record<SkillScope, string>,
  };
}

function ScopeIcon({ scope }: { scope: SkillScope }) {
  switch (scope) {
    case "image":
      return <ImageIcon size={13} aria-hidden="true" />;
    case "chat":
      return <MessageCircle size={13} aria-hidden="true" />;
    case "stories":
      return <BookOpen size={13} aria-hidden="true" />;
    case "code":
      return <Code2 size={13} aria-hidden="true" />;
    case "students":
      return <GraduationCap size={13} aria-hidden="true" />;
    default:
      return <Globe2 size={13} aria-hidden="true" />;
  }
}

type SkillsHubModalProps = {
  open: boolean;
  locale: string;
  initialScope?: SkillScope;
  getIdToken?: () => Promise<string>;
  onClose: () => void;
  inline?: boolean;
};

export default function SkillsHubModal({
  open,
  locale,
  initialScope = "all",
  getIdToken,
  onClose,
  inline = false,
}: SkillsHubModalProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);
  const {
    allSkills,
    activeIds,
    toggleSkill,
    clearScope,
    createSkill,
    updateSkill,
    deleteSkill,
  } = useYFactorySkills(getIdToken);

  const [scopeTab, setScopeTab] = useState<SkillScope>(initialScope);
  const [searchQ, setSearchQ] = useState("");
  const [editing, setEditing] = useState<YFactorySkill | "new" | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formScopes, setFormScopes] = useState<SkillScope[]>(["all"]);
  const [formInstructions, setFormInstructions] = useState("");
  const [formPrefix, setFormPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setScopeTab(initialScope);
      setEditing(null);
      setError("");
      setNotice("");
    }
  }, [open, initialScope]);

  useEffect(() => {
    if (!open || inline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, inline, onClose]);

  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);

  const filteredSkills = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return allSkills.filter((sk) => {
      const matchesScope =
        scopeTab === "all" ||
        sk.scopes.includes("all") ||
        sk.scopes.includes(scopeTab);
      if (!matchesScope) return false;
      if (!q) return true;
      const hay = `${sk.name} ${sk.nameAr ?? ""} ${sk.description} ${sk.descriptionAr ?? ""} ${sk.instructions}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allSkills, scopeTab, searchQ]);

  const handleCopyCodeSkillsForIde = async () => {
    const dir = buildSkillsSystemDirective("code");
    if (!dir) {
      setError(
        locale.startsWith("ar")
          ? "فعّل مهارة برمجة واحدة على الأقل أولاً لنسخها للـ IDE."
          : "Activate at least one Code or Global skill first.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(dir);
      setNotice(
        locale.startsWith("ar")
          ? "تم نسخ تعليمات مهارات البرمجة للحافظة (جاهزة لـ VS Code / IDE)!"
          : "Copied active Code Skills to clipboard for VS Code / IDE!",
      );
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  if (!open) return null;

  const openCreateForm = (prefill?: YFactorySkill) => {
    setError("");
    setNotice("");
    if (prefill) {
      setEditing("new");
      setFormName(`${getLocalizedSkillName(prefill, locale)} (Copy)`);
      setFormDesc(getLocalizedSkillDesc(prefill, locale));
      setFormScopes([...prefill.scopes]);
      setFormInstructions(prefill.instructions);
      setFormPrefix(prefill.promptPrefix);
    } else {
      setEditing("new");
      setFormName("");
      setFormDesc("");
      setFormScopes(scopeTab === "all" ? ["all"] : [scopeTab]);
      setFormInstructions("");
      setFormPrefix("");
    }
  };

  const openEditForm = (skill: YFactorySkill) => {
    setError("");
    setNotice("");
    setEditing(skill);
    setFormName(skill.name);
    setFormDesc(skill.description);
    setFormScopes([...skill.scopes]);
    setFormInstructions(skill.instructions);
    setFormPrefix(skill.promptPrefix);
  };

  const toggleFormScope = (sc: SkillScope) => {
    if (sc === "all") {
      setFormScopes(["all"]);
      return;
    }
    setFormScopes((prev) => {
      const withoutAll = prev.filter((s) => s !== "all");
      if (withoutAll.includes(sc)) {
        const next = withoutAll.filter((s) => s !== sc);
        return next.length > 0 ? next : ["all"];
      }
      return [...withoutAll, sc];
    });
  };

  const handleSubmitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (!formName.trim() || !formInstructions.trim()) {
      setError(
        locale.startsWith("ar")
          ? "يرجى إدخال اسم المهارة وتعليماتها."
          : "Name and instructions are required.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editing === "new") {
        await createSkill({
          name: formName.trim(),
          description: formDesc.trim(),
          scopes: formScopes,
          instructions: formInstructions.trim(),
          promptPrefix: formPrefix.trim(),
          activate: true,
        });
      } else if (editing && !editing.isBuiltIn) {
        await updateSkill(editing.id, {
          name: formName.trim(),
          description: formDesc.trim(),
          scopes: formScopes,
          instructions: formInstructions.trim(),
          promptPrefix: formPrefix.trim(),
        });
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save skill.");
    } finally {
      setBusy(false);
    }
  };

  const handleExportCustom = () => {
    const custom = allSkills.filter((s) => !s.isBuiltIn);
    const payload = JSON.stringify({ version: 1, skills: custom }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yfactory-skills.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt) as {
        skills?: Array<Partial<YFactorySkill>>;
      };
      const items = Array.isArray(parsed.skills) ? parsed.skills : [];
      let count = 0;
      for (const item of items.slice(0, 15)) {
        if (typeof item.name === "string" && typeof item.instructions === "string") {
          await createSkill({
            name: item.name,
            description: typeof item.description === "string" ? item.description : "",
            scopes: Array.isArray(item.scopes)
              ? (item.scopes as SkillScope[])
              : ["all"],
            instructions: item.instructions,
            promptPrefix:
              typeof item.promptPrefix === "string" ? item.promptPrefix : "",
            activate: false,
          });
          count += 1;
        }
      }
      setNotice(ui.importedOk(count));
    } catch {
      setError("Invalid YFactory Skills JSON file.");
    }
  };

  const panelContent = (
      <section className={inline ? "ysh-settings-card" : "ysh-sheet"}>
        <header className="ysh-header">
          <div className="ysh-head-title">
            <span className="ysh-icon-badge" aria-hidden="true">
              <Sparkles size={19} />
            </span>
            <div>
              <h2>
                {editing === "new"
                  ? ui.newSkill
                  : editing
                    ? ui.editSkill
                    : ui.title}
              </h2>
              <p>{ui.subtitle}</p>
            </div>
          </div>
          {!inline && (
            <button
              type="button"
              className="ysh-close"
              onClick={onClose}
              aria-label="Close"
              data-testid="button-skills-close"
            >
              <X size={18} />
            </button>
          )}
        </header>

        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => void handleImportFile(e)}
        />

        {!editing && (
          <div className="ysh-toolbar">
            <nav className="ysh-scope-tabs" role="tablist">
              {ALL_SCOPES.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  role="tab"
                  aria-selected={scopeTab === sc}
                  className={`ysh-scope-pill${scopeTab === sc ? " is-active" : ""}`}
                  onClick={() => setScopeTab(sc)}
                  data-testid={`skills-scope-${sc}`}
                >
                  <ScopeIcon scope={sc} />
                  <span>{ui.scopes[sc]}</span>
                </button>
              ))}
            </nav>

            <div className="ysh-search-row">
              <div style={{ flex: 1, minWidth: 160, position: "relative" }}>
                <input
                  className="ysh-input"
                  type="search"
                  dir="auto"
                  placeholder={ui.searchPh}
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.currentTarget.value)}
                />
              </div>
              <button
                type="button"
                className="ysb-btn is-primary"
                onClick={() => openCreateForm()}
                data-testid="button-skills-create"
              >
                <Plus size={14} />
                <span>{ui.newSkill}</span>
              </button>
              <button
                type="button"
                className="ysb-btn"
                onClick={handleExportCustom}
                title={ui.exportJson}
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                className="ysb-btn"
                onClick={() => importRef.current?.click()}
                title={ui.importJson}
              >
                <Upload size={13} />
              </button>
              {(scopeTab === "code" || inline) && (
                <button
                  type="button"
                  className="ysb-btn"
                  onClick={() => void handleCopyCodeSkillsForIde()}
                >
                  <Copy size={13} />
                  <span>{locale.startsWith("ar") ? "نسخ للـ IDE" : "Copy IDE"}</span>
                </button>
              )}
              {activeIds.length > 0 && (
                <button
                  type="button"
                  className="ysb-btn"
                  onClick={() => void clearScope(scopeTab)}
                >
                  <span>{ui.clearAll}</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="ysh-body">
          {error && (
            <div className="ysh-alert" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="ysh-ok" role="status">
              {notice}
            </div>
          )}

          {editing ? (
            <form className="ysh-form" onSubmit={(e) => void handleSubmitForm(e)}>
              <div className="ysh-field">
                <label htmlFor="ysh-name">{ui.nameLbl}</label>
                <input
                  id="ysh-name"
                  className="ysh-input"
                  dir="auto"
                  maxLength={80}
                  required
                  placeholder={ui.namePh}
                  value={formName}
                  onChange={(e) => setFormName(e.currentTarget.value)}
                  data-testid="input-skill-name"
                />
              </div>

              <div className="ysh-field">
                <label htmlFor="ysh-desc">{ui.descLbl}</label>
                <input
                  id="ysh-desc"
                  className="ysh-input"
                  dir="auto"
                  maxLength={220}
                  placeholder={ui.descPh}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.currentTarget.value)}
                />
              </div>

              <div className="ysh-field">
                <label>{ui.scopesLbl}</label>
                <div className="ysh-badges">
                  {ALL_SCOPES.map((sc) => {
                    const selected = formScopes.includes(sc);
                    return (
                      <button
                        key={sc}
                        type="button"
                        className={`ysh-scope-pill${selected ? " is-active" : ""}`}
                        onClick={() => toggleFormScope(sc)}
                      >
                        <ScopeIcon scope={sc} />
                        <span>{ui.scopes[sc]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="ysh-field">
                <label htmlFor="ysh-inst">{ui.instLbl}</label>
                <textarea
                  id="ysh-inst"
                  className="ysh-textarea"
                  dir="auto"
                  maxLength={3000}
                  required
                  placeholder={ui.instPh}
                  value={formInstructions}
                  onChange={(e) => setFormInstructions(e.currentTarget.value)}
                  data-testid="input-skill-instructions"
                />
              </div>

              {(formScopes.includes("all") ||
                formScopes.includes("image") ||
                formScopes.includes("stories")) && (
                <div className="ysh-field">
                  <label htmlFor="ysh-prefix">{ui.prefixLbl}</label>
                  <input
                    id="ysh-prefix"
                    className="ysh-input"
                    dir="auto"
                    maxLength={400}
                    placeholder={ui.prefixPh}
                    value={formPrefix}
                    onChange={(e) => setFormPrefix(e.currentTarget.value)}
                  />
                </div>
              )}

              <div className="ysh-search-row">
                <button
                  type="submit"
                  className="ysb-btn is-primary"
                  disabled={busy}
                  data-testid="button-skill-save"
                >
                  {busy ? (
                    <LoaderCircle className="loading-spinner" size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  <span>{busy ? ui.saving : ui.saveSkill}</span>
                </button>
                <button
                  type="button"
                  className="ysb-btn"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  {ui.cancel}
                </button>
              </div>
            </form>
          ) : filteredSkills.length === 0 ? (
            <div style={{ textAlign: "center", padding: 26, color: "var(--app-secondary)" }}>
              <Search size={20} style={{ marginBottom: 6 }} />
              <p style={{ margin: 0, fontSize: 13 }}>{ui.empty}</p>
            </div>
          ) : (
            filteredSkills.map((sk) => {
              const isOn = activeSet.has(sk.id);
              return (
                <article
                  key={sk.id}
                  className={`ysh-card${isOn ? " is-on" : ""}`}
                  data-testid={`skill-card-${sk.id}`}
                >
                  <div className="ysh-card-head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="ysh-card-title" dir="auto">
                        {getLocalizedSkillName(sk, locale)}
                      </h3>
                      <p className="ysh-card-desc" dir="auto">
                        {getLocalizedSkillDesc(sk, locale) || sk.instructions.slice(0, 120)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`ysh-toggle${isOn ? " is-on" : ""}`}
                      onClick={() => void toggleSkill(sk.id)}
                      data-testid={`button-skill-toggle-${sk.id}`}
                    >
                      {isOn && <Check size={13} />}
                      <span>{isOn ? ui.activeOn : ui.activeOff}</span>
                    </button>
                  </div>

                  <div className="ysh-meta-row">
                    <div className="ysh-badges">
                      <span className={`ysh-badge${sk.isBuiltIn ? "" : " is-custom"}`}>
                        {sk.isBuiltIn ? ui.builtIn : ui.custom}
                      </span>
                      {sk.scopes.map((sc) => (
                        <span key={sc} className="ysh-badge">
                          {ui.scopes[sc]}
                        </span>
                      ))}
                    </div>

                    <div className="ysb-actions">
                      {sk.isBuiltIn ? (
                        <button
                          type="button"
                          className="ysb-btn"
                          onClick={() => openCreateForm(sk)}
                          title={ui.duplicate}
                        >
                          <Copy size={12} />
                          <span>{ui.duplicate}</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ysb-btn"
                            onClick={() => openEditForm(sk)}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            className="ysb-btn"
                            onClick={() => void deleteSkill(sk.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
  );

  if (inline) {
    return (
      <div
        className="ysh-settings-page"
        dir={isRtl ? "rtl" : "ltr"}
        data-testid="skills-settings-panel"
      >
        {panelContent}
      </div>
    );
  }

  return (
    <div
      className="ysh-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ui.title}
      dir={isRtl ? "rtl" : "ltr"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="skills-hub-modal"
    >
      {panelContent}
    </div>
  );
}

export function SkillsSettingsPanel({
  locale,
  initialScope = "all",
  getIdToken,
  onBack,
}: {
  locale: string;
  initialScope?: SkillScope;
  getIdToken?: () => Promise<string>;
  onBack: () => void;
}) {
  return (
    <SkillsHubModal
      open
      inline
      locale={locale}
      initialScope={initialScope}
      getIdToken={getIdToken}
      onClose={onBack}
    />
  );
}

/* ==================== INLINE WORKSPACE SKILLS BAR ==================== */

type WorkspaceSkillsBarProps = {
  scope: SkillScope;
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenHub?: (scope: SkillScope) => void;
  extraAction?: {
    label: string;
    onClick: () => void;
  };
};

export function WorkspaceSkillsBar({
  scope,
  locale,
  getIdToken,
  onOpenHub,
  extraAction,
}: WorkspaceSkillsBarProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);
  const { getActiveForScope, toggleSkill } = useYFactorySkills(getIdToken);
  const [localOpen, setLocalOpen] = useState(false);

  const active = getActiveForScope(scope);

  const openManager = () => {
    if (onOpenHub) onOpenHub(scope);
    else setLocalOpen(true);
  };

  return (
    <>
      <div
        className={`ysb-bar${active.length > 0 ? " has-active" : ""}`}
        dir={isRtl ? "rtl" : "ltr"}
        data-testid={`workspace-skills-bar-${scope}`}
      >
        <div className="ysb-left">
          <span className="ysb-title">
            <Sparkles size={13} aria-hidden="true" />
            <span>
              {ui.barTitle} ({active.length})
            </span>
          </span>
          {active.length === 0 ? (
            <span className="ysb-hint">{ui.barNone}</span>
          ) : (
            active.map((sk) => (
              <span key={sk.id} className="ysb-chip">
                <span dir="auto">{getLocalizedSkillName(sk, locale)}</span>
                <button
                  type="button"
                  onClick={() => void toggleSkill(sk.id)}
                  aria-label="Remove skill"
                >
                  <X size={11} />
                </button>
              </span>
            ))
          )}
        </div>

        <div className="ysb-actions">
          {extraAction && active.length > 0 && (
            <button
              type="button"
              className="ysb-btn"
              onClick={extraAction.onClick}
            >
              <Copy size={12} />
              <span>{extraAction.label}</span>
            </button>
          )}
          <button
            type="button"
            className="ysb-btn is-primary"
            onClick={openManager}
            data-testid={`button-open-skills-${scope}`}
          >
            <Sparkles size={12} />
            <span>{ui.manageBtn}</span>
          </button>
        </div>
      </div>

      {!onOpenHub && (
        <SkillsHubModal
          open={localOpen}
          locale={locale}
          initialScope={scope}
          getIdToken={getIdToken}
          onClose={() => setLocalOpen(false)}
        />
      )}
    </>
  );
}