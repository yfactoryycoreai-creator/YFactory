import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import ConfirmActionDialog from '@/components/confirm-action-dialog';
import {
  createVaultKey,
  deleteVaultKey,
  loadVaultKeys,
  maskNewKey,
  updateVaultKey,
  type ProviderKey,
  type VaultKey,
} from '@/lib/apiKeyVault';
import './auth-pages.css';

export type SettingsUser = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

export type SettingsPageProps = {
  user: SettingsUser;
  getIdToken?: () => Promise<string>;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
};

const providers: Array<{ id: ProviderKey; symbol: string }> = [
  { id: 'zsky', symbol: 'Z' },
  { id: 'agnes', symbol: 'A' },
  { id: 'glm', symbol: 'G' },
];

function formatCreatedDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(timestamp),
  );
}

export default function SettingsPage({
  user,
  getIdToken,
  onBack,
  onLogout,
  onDeleteAccount,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = locale === 'ar';
  const [keys, setKeys] = useState<VaultKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busyActions, setBusyActions] = useState<string[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [addingProvider, setAddingProvider] = useState<ProviderKey | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [revealNewValue, setRevealNewValue] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const displayName = user.displayName || user.email || 'YFactory creator';
  const initials = (user.displayName || user.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    let active = true;
    if (!getIdToken) {
      setKeysLoading(false);
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const token = await getIdToken();
        const savedKeys = await loadVaultKeys(token);
        if (active) {
          setKeys((current) => {
            const receivedIds = new Set(savedKeys.map((key) => key.id));
            const localKeys = current.filter(
              (key) => key.id.startsWith('pending-') || !receivedIds.has(key.id),
            );
            return [...localKeys, ...savedKeys];
          });
          setError('');
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('settings.vaultLoadFailed'),
          );
        }
      } finally {
        if (active) setKeysLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, t]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const beginAction = (action: string) => {
    setBusyActions((current) =>
      current.includes(action) ? current : [...current, action],
    );
  };
  const endAction = (action: string) => {
    setBusyActions((current) => current.filter((item) => item !== action));
  };

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError('');
    try {
      await onLogout();
    } catch {
      setLogoutError(t('confirmation.logoutFailed'));
      setSigningOut(false);
    }
  };

  const openAddForm = (provider: ProviderKey) => {
    setError('');
    setAddingProvider(provider);
    setNewLabel('');
    setNewValue('');
    setRevealNewValue(false);
  };

  const closeAddForm = () => {
    setAddingProvider(null);
    setNewLabel('');
    setNewValue('');
    setRevealNewValue(false);
  };

  const handleAddKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!getIdToken || !addingProvider || !newLabel.trim() || !newValue.trim()) {
      return;
    }
    const provider = addingProvider;
    const action = `add:${provider}`;
    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimisticKey: VaultKey = {
      id: optimisticId,
      provider,
      label: newLabel.trim(),
      maskedValue: maskNewKey(newValue.trim()),
      enabled: true,
      createdAt: Date.now(),
      status: 'ready',
    };
    const valueToSave = newValue.trim();
    setError('');
    setKeys((current) => [optimisticKey, ...current]);
    beginAction(action);
    try {
      const token = await getIdToken();
      const savedKey = await createVaultKey(token, {
        provider,
        label: optimisticKey.label,
        value: valueToSave,
      });
      setKeys((current) =>
        current.map((key) => (key.id === optimisticId ? savedKey : key)),
      );
      setToast(t('settings.keySaved'));
      closeAddForm();
    } catch (saveError) {
      setKeys((current) => current.filter((key) => key.id !== optimisticId));
      setError(
        saveError instanceof Error
          ? saveError.message
          : t('settings.vaultSaveFailed'),
      );
    } finally {
      endAction(action);
    }
  };

  const handleUpdateKey = async (
    key: VaultKey,
    updates: { label?: string; enabled?: boolean },
  ) => {
    if (!getIdToken) return;
    const action = `update:${key.id}`;
    const previousKey = key;
    const optimisticKey = {
      ...key,
      ...updates,
      ...(updates.enabled === true
        ? { status: 'ready' as const, cooldownUntil: undefined }
        : {}),
    };
    setError('');
    setKeys((current) =>
      current.map((item) => (item.id === key.id ? optimisticKey : item)),
    );
    beginAction(action);
    try {
      const token = await getIdToken();
      const savedKey = await updateVaultKey(token, key, updates);
      setKeys((current) =>
        current.map((item) => (item.id === key.id ? savedKey : item)),
      );
      if (updates.label !== undefined) {
        setLabelDrafts((current) => {
          const next = { ...current };
          delete next[key.id];
          return next;
        });
      }
      setToast(t('settings.keyUpdated'));
    } catch (updateError) {
      setKeys((current) =>
        current.map((item) => (item.id === key.id ? previousKey : item)),
      );
      setError(
        updateError instanceof Error
          ? updateError.message
          : t('settings.vaultSaveFailed'),
      );
    } finally {
      endAction(action);
    }
  };

  const handleDeleteKey = async (key: VaultKey) => {
    if (!getIdToken) return;
    const action = `delete:${key.id}`;
    setError('');
    setKeys((current) => current.filter((item) => item.id !== key.id));
    beginAction(action);
    try {
      const token = await getIdToken();
      await deleteVaultKey(token, key);
      setLabelDrafts((current) => {
        const next = { ...current };
        delete next[key.id];
        return next;
      });
      setToast(t('settings.keyDeleted'));
    } catch (deleteError) {
      setKeys((current) =>
        current.some((item) => item.id === key.id) ? current : [...current, key],
      );
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t('settings.vaultDeleteFailed'),
      );
    } finally {
      endAction(action);
    }
  };

  const keysForProvider = (provider: ProviderKey) =>
    keys.filter((key) => key.provider === provider);

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
            onClick={() => void handleLogout()}
            disabled={signingOut}
            aria-busy={signingOut}
            data-testid="button-settings-logout"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{signingOut ? t('auth.signingOut') : t('settings.logout')}</span>
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

          {(error || logoutError) && (
            <div className="settings-error" role="alert" data-testid="status-settings-error">
              <span className="error-dot" />
              {logoutError || error}
            </div>
          )}

          <section className="account-panel" aria-labelledby="account-title">
            <div className="section-kicker">{t('settings.account')}</div>
            <div className="account-info">
              {user.photoURL ? (
                <img className="account-avatar" src={user.photoURL} alt="" loading="lazy" data-testid="img-account-avatar" />
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
              <span className="keys-count">{keys.length} <span>KEYS</span></span>
            </div>

            <div className="provider-list">
              {providers.map(({ id: provider, symbol }) => {
                const providerKeys = keysForProvider(provider);
                const isAdding = addingProvider === provider;
                return (
                  <article className="provider-card" key={provider} data-testid={`card-provider-${provider}`}>
                    <div className="provider-card-head">
                      <div className={`provider-symbol provider-symbol-${provider}`} aria-hidden="true">
                        {symbol}
                      </div>
                      <div className="provider-copy">
                        <h3>{t(`settings.providers.${provider}`)}</h3>
                        <p>{t(`settings.providerDescriptions.${provider}`)}</p>
                      </div>
                      <span className="provider-count">{providerKeys.length}</span>
                    </div>

                    {providerKeys.length > 0 ? (
                      <ul className="provider-key-list" aria-label={`${t(`settings.providers.${provider}`)} API keys`}>
                        {providerKeys.map((key) => {
                          const labelValue = labelDrafts[key.id] ?? key.label;
                          const labelChanged = labelValue.trim() !== key.label;
                          const isUpdating = busyActions.includes(`update:${key.id}`);
                          const isDeleting = busyActions.includes(`delete:${key.id}`);
                          return (
                            <li className="vault-key-row" key={key.id} data-testid={`row-key-${provider}-${key.id}`}>
                              <div className="vault-key-details">
                                <div className="vault-key-label-row">
                                  <input
                                    className="vault-key-label"
                                    value={labelValue}
                                    maxLength={80}
                                    aria-label={`${t('settings.keyName')} — ${key.label}`}
                                    onChange={(event) =>
                                      setLabelDrafts((current) => ({
                                        ...current,
                                        [key.id]: event.currentTarget.value,
                                      }))
                                    }
                                    disabled={isUpdating || isDeleting}
                                    data-testid={`input-key-label-${key.id}`}
                                  />
                                  {labelChanged && (
                                    <button
                                      className="icon-action"
                                      type="button"
                                      aria-label={t('settings.saveKeyName')}
                                      disabled={!getIdToken || isUpdating || !labelValue.trim()}
                                      onClick={() =>
                                        void handleUpdateKey(key, {
                                          label: labelValue.trim(),
                                        })
                                      }
                                      data-testid={`button-save-key-label-${key.id}`}
                                    >
                                      <Check size={15} />
                                    </button>
                                  )}
                                </div>
                                <code className="vault-key-mask" dir="ltr">{key.maskedValue}</code>
                                <div className="vault-key-meta">
                                  <span className={`vault-key-status vault-key-status-${key.status}`}>
                                    {key.status === 'failing'
                                      ? t('settings.statusFailing')
                                      : key.status === 'cooldown'
                                        ? t('settings.statusCooldown')
                                        : key.enabled
                                          ? t('settings.statusReady')
                                          : t('settings.statusDisabled')}
                                  </span>
                                  <span>{t('settings.created', { date: formatCreatedDate(key.createdAt, locale) })}</span>
                                </div>
                              </div>
                              <div className="vault-key-actions">
                                <button
                                  className={`vault-key-toggle${key.enabled ? ' is-enabled' : ''}`}
                                  type="button"
                                  role="switch"
                                  aria-checked={key.enabled}
                                  aria-label={`${t('settings.enabled')} ${key.label}`}
                                  disabled={!getIdToken || isUpdating || isDeleting}
                                  onClick={() =>
                                    void handleUpdateKey(key, { enabled: !key.enabled })
                                  }
                                  data-testid={`button-toggle-key-${key.id}`}
                                >
                                  <span />
                                </button>
                                <button
                                  className="icon-action delete-action"
                                  type="button"
                                  aria-label={`${t('settings.deleteKey')} ${key.label}`}
                                  disabled={!getIdToken || isUpdating || isDeleting}
                                  onClick={() => void handleDeleteKey(key)}
                                  data-testid={`button-delete-key-${key.id}`}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="provider-empty" data-testid={`text-empty-keys-${provider}`}>
                        <span className="empty-indicator" />
                        {keysLoading ? t('settings.loadingKeys') : t('settings.emptyKeys')}
                      </div>
                    )}

                    <div className="provider-add-form">
                      {isAdding ? (
                        <form className="vault-add-form" onSubmit={(event) => void handleAddKey(event)}>
                          <input
                            className="vault-add-label"
                            value={newLabel}
                            maxLength={80}
                            onChange={(event) => setNewLabel(event.currentTarget.value)}
                            placeholder={t('settings.keyNamePlaceholder')}
                            aria-label={t('settings.keyName')}
                            required
                            autoFocus
                            data-testid={`input-new-key-label-${provider}`}
                          />
                          <div className="vault-add-value-wrap">
                            <input
                              className="vault-add-value"
                              type={revealNewValue ? 'text' : 'password'}
                              value={newValue}
                              maxLength={4096}
                              autoComplete="off"
                              onChange={(event) => setNewValue(event.currentTarget.value)}
                              placeholder={t('settings.keyValuePlaceholder')}
                              aria-label={t('settings.keyValue')}
                              required
                              data-testid={`input-new-key-value-${provider}`}
                            />
                            <button
                              className="icon-action reveal-action"
                              type="button"
                              aria-label={revealNewValue ? t('settings.hideKey') : t('settings.showKey')}
                              onClick={() => setRevealNewValue((current) => !current)}
                            >
                              {revealNewValue ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                          <div className="vault-add-actions">
                            <button
                              className="add-key-button"
                              type="submit"
                              disabled={
                                !getIdToken ||
                                busyActions.includes(`add:${provider}`) ||
                                !newLabel.trim() ||
                                !newValue.trim()
                              }
                              data-testid={`button-save-new-key-${provider}`}
                            >
                              {busyActions.includes(`add:${provider}`)
                                ? t('settings.saving')
                                : t('settings.saveKey')}
                            </button>
                            <button
                              className="vault-cancel-button"
                              type="button"
                              onClick={closeAddForm}
                              disabled={busyActions.includes(`add:${provider}`)}
                            >
                              {t('settings.cancel')}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          className="add-key-button"
                          type="button"
                          onClick={() => openAddForm(provider)}
                          disabled={!getIdToken || busyActions.includes(`add:${provider}`)}
                          data-testid={`button-add-key-${provider}`}
                        >
                          <Plus size={16} />
                          <span>{t('settings.addKey')}</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
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
      {toast && <div className="settings-toast" role="status">{toast}</div>}
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
