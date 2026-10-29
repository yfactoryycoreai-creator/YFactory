import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
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
import ConfirmActionDialog from '@/components/confirm-action-dialog';
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
  ready: boolean;
  saving: boolean;
  error: string | null;
  onSaveKeys: (keys: UserApiKeys) => Promise<void>;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
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
  ready,
  saving,
  error,
  onSaveKeys,
  onBack,
  onLogout,
  onDeleteAccount,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const isRtl = (i18n.resolvedLanguage ?? i18n.language) === 'ar';
  const [draftKeys, setDraftKeys] = useState<UserApiKeys>(keys);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const displayName = user.displayName || user.email || 'YFactory creator';
  const initials = (user.displayName || user.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    if (!loading) setDraftKeys(keys);
  }, [keys, loading]);

  const updateKey = (provider: ProviderKey, index: number, value: string) => {
    setSaved(false);
    setDraftKeys((current) => ({
      ...current,
      [keyField[provider]]: current[keyField[provider]].map((key, keyIndex) =>
        keyIndex === index ? value : key,
      ),
    }));
  };

  const addKeyField = (provider: ProviderKey) => {
    setSaved(false);
    setDraftKeys((current) => ({
      ...current,
      [keyField[provider]]: [...current[keyField[provider]], ''],
    }));
  };

  const deleteKeyField = (provider: ProviderKey, index: number) => {
    setSaved(false);
    setDraftKeys((current) => ({
      ...current,
      [keyField[provider]]: current[keyField[provider]].filter(
        (_, keyIndex) => keyIndex !== index,
      ),
    }));
  };

  const saveDrafts = async () => {
    if (saving || loading || !ready) return;
    setSaved(false);
    try {
      await onSaveKeys(draftKeys);
      setSaved(true);
    } catch {
      // The parent supplies the visible Firestore error.
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
          <button
            className="settings-logout"
            type="button"
            onClick={() => setLogoutConfirmationOpen(true)}
            data-testid="button-settings-logout"
          >
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
              <span className="keys-count">{providers.reduce((count, provider) => count + (draftKeys[keyField[provider]]?.filter((key) => key.trim()).length ?? 0), 0)} <span>KEYS</span></span>
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
                  const providerKeys = draftKeys[keyField[provider]] ?? [];
                  const savedKeyCount = providerKeys.filter((key) => key.trim()).length;
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
                         <span className="provider-count">{savedKeyCount}</span>
                      </div>

                      {providerKeys.length ? (
                        <ul className="provider-key-list" aria-label={`${t(`settings.providers.${provider}`)} API keys`}>
                          {providerKeys.map((key, index) => {
                             const revealId = `${provider}-${index}`;
                            return (
                               <li className="provider-key-row" key={`${provider}-${index}`} data-testid={`row-key-${provider}-${index}`}>
                                 <label className="visually-hidden" htmlFor={`input-api-key-${provider}${index ? `-${index}` : ''}`}>
                                   {t('settings.keyPlaceholder')} — {t(`settings.providers.${provider}`)} {index + 1}
                                 </label>
                                 <input
                                   id={`input-api-key-${provider}${index ? `-${index}` : ''}`}
                                   className="provider-key-input"
                                   type={revealed[revealId] ? 'text' : 'password'}
                                   autoComplete="off"
                                   value={key}
                                   onChange={(event) => updateKey(provider, index, event.currentTarget.value)}
                                   placeholder={t('settings.keyPlaceholder')}
                                   disabled={saving || !ready}
                                   data-testid={`input-api-key-${provider}${index ? `-${index}` : ''}`}
                                 />
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
                                  disabled={saving || !ready}
                                   onClick={() => deleteKeyField(provider, index)}
                                  data-testid={`button-delete-key-${provider}-${index}`}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                       ) : providerKeys.length === 0 ? (
                        <div className="provider-empty" data-testid={`text-empty-keys-${provider}`}>
                          <span className="empty-indicator" />
                          {t('settings.emptyKeys')}
                        </div>
                       ) : null}

                       <div className="provider-add-form">
                        <button
                           className="add-key-button"
                           type="button"
                           onClick={() => addKeyField(provider)}
                           disabled={saving || !ready}
                          data-testid={`button-add-key-${provider}`}
                        >
                           <Plus size={16} />
                           <span>{t('settings.addKey')}</span>
                        </button>
                       </div>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="settings-save-row">
              <button
                className="settings-save-button"
                type="button"
                onClick={() => void saveDrafts()}
                disabled={loading || saving || !ready}
                data-testid="button-save-api-keys"
              >
                {saving ? <LoaderCircle className="auth-spinner" size={16} /> : saved ? <Check size={16} /> : null}
                <span>{saving ? t('settings.saving') : saved ? t('settings.keySaved') : t('settings.saveKeys')}</span>
              </button>
            </div>
            <div className="security-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{t('settings.securityNote')}</span>
            </div>
          </section>
          <section className="danger-zone" aria-labelledby="danger-zone-title">
            <div>
              <h2 id="danger-zone-title">{t('settings.dangerZone')}</h2>
              <p>{t('settings.deleteAccountDescription')}</p>
            </div>
            <button
              className="settings-delete-account"
              type="button"
              onClick={() => setDeleteConfirmationOpen(true)}
              data-testid="button-delete-account"
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>{t('settings.deleteAccount')}</span>
            </button>
          </section>
        </div>
        <footer className="settings-footer">
          <span>YFactory</span>
          <span className="footer-separator" />
          <span>Creator workspace</span>
        </footer>
      </div>
      <ConfirmActionDialog
        open={logoutConfirmationOpen}
        onOpenChange={setLogoutConfirmationOpen}
        title={t('confirmation.logoutTitle')}
        description={t('confirmation.logoutDescription')}
        confirmLabel={t('confirmation.confirm')}
        busyLabel={t('confirmation.loggingOut')}
        cancelLabel={t('confirmation.cancel')}
        failureMessage={t('confirmation.logoutFailed')}
        onConfirm={onLogout}
        dir={isRtl ? 'rtl' : 'ltr'}
      />
      <ConfirmActionDialog
        open={deleteConfirmationOpen}
        onOpenChange={setDeleteConfirmationOpen}
        title={t('confirmation.deleteTitle')}
        description={t('confirmation.deleteDescription')}
        confirmLabel={t('confirmation.deleteConfirm')}
        busyLabel={t('confirmation.deleting')}
        cancelLabel={t('confirmation.cancel')}
        failureMessage={t('confirmation.deleteFailed')}
        recentLoginMessage={t('confirmation.recentLogin')}
        onConfirm={onDeleteAccount}
        dir={isRtl ? 'rtl' : 'ltr'}
        danger
      />
    </main>
  );
}
