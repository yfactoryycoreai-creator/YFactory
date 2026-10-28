import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import './auth-pages.css';

export type ProviderKey = 'zsky' | 'agnes' | 'glm';
export type UserApiKeys = {
  zsky_keys: string[];
  agnes_keys: string[];
  glm_keys: string[];
};
export type SettingsUser = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

export type SettingsPageProps = {
  user: SettingsUser;
  keys: UserApiKeys;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onAddKey: (provider: ProviderKey, key: string) => Promise<void>;
  onDeleteKey: (provider: ProviderKey, key: string) => Promise<void>;
  onBack: () => void;
  onLogout: () => void;
};

const providers: ProviderKey[] = ['zsky', 'agnes', 'glm'];
const keyField: Record<ProviderKey, keyof UserApiKeys> = {
  zsky: 'zsky_keys',
  agnes: 'agnes_keys',
  glm: 'glm_keys',
};

export default function SettingsPage({
  user,
  keys,
  loading,
  saving,
  error,
  onAddKey,
  onDeleteKey,
  onBack,
  onLogout,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const isRtl = (i18n.resolvedLanguage ?? i18n.language) === 'ar';
  const [drafts, setDrafts] = useState<Record<ProviderKey, string>>({
    zsky: '',
    agnes: '',
    glm: '',
  });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState<ProviderKey | null>(null);
  const [savedProvider, setSavedProvider] = useState<ProviderKey | null>(null);
  const displayName = user.displayName || user.email || 'YFactory creator';
  const initials = (user.displayName || user.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const submitKey = async (event: FormEvent<HTMLFormElement>, provider: ProviderKey) => {
    event.preventDefault();
    const value = drafts[provider].trim();
    if (!value || saving || activeProvider) return;
    setActiveProvider(provider);
    setSavedProvider(null);
    try {
      await onAddKey(provider, value);
      setDrafts((current) => ({ ...current, [provider]: '' }));
      setSavedProvider(provider);
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <main className="auth-screen settings-screen" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="settings-shell">
        <header className="settings-topbar">
          <button className="settings-back" type="button" onClick={onBack} data-testid="button-settings-back">
            <ArrowLeft size={17} aria-hidden="true" />
            <span>{t('settings.backToDashboard')}</span>
          </button>
          <div className="settings-brand" aria-label="YFactory">
            <span className="settings-brand-mark">Y</span>
            <span>YFactory</span>
          </div>
          <button className="settings-logout" type="button" onClick={onLogout} data-testid="button-settings-logout">
            <LogOut size={16} aria-hidden="true" />
            <span>{t('settings.logout')}</span>
          </button>
        </header>

        <div className="settings-content">
          <div className="settings-heading">
            <div>
              <div className="settings-eyebrow"><span /> YFACTORY / ACCOUNT</div>
              <h1>{t('settings.title')}</h1>
              <p>{t('settings.subtitle')}</p>
            </div>
            <button className="settings-mobile-back" type="button" onClick={onBack} aria-label={t('settings.backToDashboard')} data-testid="button-settings-mobile-back">
              <ArrowLeft size={18} />
            </button>
          </div>

          {error && (
            <div className="settings-error" role="alert" data-testid="status-settings-error">
              <span className="error-dot" />
              {error || t('common.error')}
            </div>
          )}

          <section className="account-panel" aria-labelledby="account-title">
            <div className="section-kicker">{t('settings.account')}</div>
            <div className="account-info">
              {user.photoURL ? (
                <img className="account-avatar" src={user.photoURL} alt="" data-testid="img-account-avatar" />
              ) : (
                <div className="account-avatar account-avatar-fallback" aria-hidden="true">
                  {initials || <UserRound size={21} />}
                </div>
              )}
              <div className="account-copy">
                <h2 id="account-title" data-testid="text-account-name">{displayName}</h2>
                {user.email && <p data-testid="text-account-email">{user.email}</p>}
              </div>
              <span className="account-verified"><ShieldCheck size={15} /> <span>Signed in</span></span>
            </div>
          </section>

          <section className="keys-section" aria-labelledby="keys-title">
            <div className="keys-heading">
              <div className="keys-heading-icon"><KeyRound size={18} /></div>
              <div>
                <h2 id="keys-title">{t('settings.apiKeysTitle')}</h2>
                <p>{t('settings.subtitle')}</p>
              </div>
              <span className="keys-count">{providers.reduce((count, provider) => count + (keys[keyField[provider]]?.length ?? 0), 0)} <span>KEYS</span></span>
            </div>

            {loading ? (
              <div className="settings-loading" aria-live="polite" data-testid="status-settings-loading">
                <span className="skeleton-line" />
                <span className="skeleton-line short" />
                <span className="skeleton-line" />
              </div>
            ) : (
              <div className="provider-list">
                {providers.map((provider) => {
                  const providerKeys = keys[keyField[provider]] ?? [];
                  return (
                    <article className="provider-card" key={provider} data-testid={`card-provider-${provider}`}>
                      <div className="provider-card-head">
                        <div className={`provider-symbol provider-symbol-${provider}`} aria-hidden="true">
                          {provider === 'zsky' ? 'Z' : provider === 'agnes' ? 'A' : 'G'}
                        </div>
                        <div className="provider-copy">
                          <h3>{t(`settings.providers.${provider}`)}</h3>
                          <p>{t(`settings.providerDescriptions.${provider}`)}</p>
                        </div>
                        <span className="provider-count">{providerKeys.length}</span>
                        <ChevronDown size={16} className="provider-chevron" aria-hidden="true" />
                      </div>

                      {providerKeys.length ? (
                        <ul className="provider-key-list" aria-label={`${t(`settings.providers.${provider}`)} API keys`}>
                          {providerKeys.map((key, index) => {
                            const revealId = `${provider}-${index}`;
                            return (
                              <li className="provider-key-row" key={`${provider}-${index}-${key.slice(-5)}`} data-testid={`row-key-${provider}-${index}`}>
                                <span className="key-row-icon"><KeyRound size={14} /></span>
                                <code data-testid={`text-key-${provider}-${index}`}>
                                  {revealed[revealId] ? key : `••••••••••••${key.slice(-4)}`}
                                </code>
                                <button
                                  className="icon-action reveal-action"
                                  type="button"
                                  aria-label={revealed[revealId] ? 'Hide API key' : 'Reveal API key'}
                                  aria-pressed={Boolean(revealed[revealId])}
                                  onClick={() => setRevealed((current) => ({ ...current, [revealId]: !current[revealId] }))}
                                  data-testid={`button-toggle-key-${provider}-${index}`}
                                >
                                  {revealed[revealId] ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                                <button
                                  className="icon-action delete-action"
                                  type="button"
                                  aria-label={`${t('settings.deleteKey')} ${t(`settings.providers.${provider}`)} ${index + 1}`}
                                  disabled={saving}
                                  onClick={() => void onDeleteKey(provider, key)}
                                  data-testid={`button-delete-key-${provider}-${index}`}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <div className="provider-empty" data-testid={`text-empty-keys-${provider}`}>
                          <span className="empty-indicator" />
                          {t('settings.emptyKeys')}
                        </div>
                      )}

                      <form className="provider-add-form" onSubmit={(event) => void submitKey(event, provider)}>
                        <label className="visually-hidden" htmlFor={`input-key-${provider}`}>
                          {t('settings.keyPlaceholder')} — {t(`settings.providers.${provider}`)}
                        </label>
                        <input
                          id={`input-key-${provider}`}
                          type="password"
                          autoComplete="off"
                          value={drafts[provider]}
                          onChange={(event) => setDrafts((current) => ({ ...current, [provider]: event.currentTarget.value }))}
                          placeholder={t('settings.keyPlaceholder')}
                          disabled={saving || Boolean(activeProvider)}
                          data-testid={`input-api-key-${provider}`}
                        />
                        <button
                          className="add-key-button"
                          type="submit"
                          disabled={!drafts[provider].trim() || saving || Boolean(activeProvider)}
                          data-testid={`button-add-key-${provider}`}
                        >
                          {activeProvider === provider ? (
                            <LoaderCircle className="auth-spinner" size={16} />
                          ) : savedProvider === provider ? (
                            <Check size={16} />
                          ) : (
                            <Plus size={16} />
                          )}
                          <span>{activeProvider === provider ? t('settings.saving') : savedProvider === provider ? t('settings.keySaved') : t('settings.addKey')}</span>
                        </button>
                      </form>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="security-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{t('settings.subtitle')}</span>
            </div>
          </section>
        </div>
        <footer className="settings-footer">
          <span>YFactory</span>
          <span className="footer-separator" />
          <span>Creator workspace</span>
        </footer>
      </div>
    </main>
  );
}
