import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  HardDrive,
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
  createProvider,
  deleteVaultKey,
  loadVaultKeys,
  loadProviders,
  loadStorageUsage,
  maskNewKey,
  updateVaultKey,
  updateProviderConfig,
  type ProviderConfig,
  type ProviderAdapter,
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

const providerSymbols: Record<string, string> = {
  zsky: 'Z',
  agnes: 'A',
  glm: 'G',
  pollinations: 'P',
  cloudinary: 'C',
};

const providerAdapters: Array<{ id: ProviderAdapter; label: string }> = [
  { id: 'agnes', label: 'Agnes' },
  { id: 'glm', label: 'GLM' },
  { id: 'zsky', label: 'ZSky' },
  { id: 'pollinations', label: 'Pollinations' },
  { id: 'cloudinary', label: 'Cloudinary' },
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
];

function formatCreatedDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(timestamp),
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
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
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [storageUsage, setStorageUsage] = useState<{
    configured: boolean;
    usedBytes: number | null;
    limitBytes: number | null;
  } | null>(null);
  const [storageUsageError, setStorageUsageError] = useState('');
  const [keysLoading, setKeysLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busyActions, setBusyActions] = useState<string[]>([]);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [addingProvider, setAddingProvider] = useState<ProviderKey | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [providerCategory, setProviderCategory] = useState<'image' | 'storage'>('image');
  const [providerAdapter, setProviderAdapter] = useState<ProviderAdapter>('agnes');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerSaving, setProviderSaving] = useState(false);
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
    if (!getIdToken) return;
    let active = true;
    void (async () => {
      try {
        const token = await getIdToken();
        const [receivedProviders, usageResult] = await Promise.allSettled([
          loadProviders(token),
          loadStorageUsage(token),
        ]);
        if (!active) return;
        if (receivedProviders.status === 'fulfilled') {
          setProviderConfigs(receivedProviders.value);
        } else {
          setError(
            receivedProviders.reason instanceof Error
              ? receivedProviders.reason.message
              : t('settings.vaultLoadFailed'),
          );
        }
        if (usageResult.status === 'fulfilled') {
          setStorageUsage(usageResult.value);
          setStorageUsageError('');
        } else {
          setStorageUsage(null);
          setStorageUsageError(
            usageResult.reason instanceof Error
              ? usageResult.reason.message
              : 'Cloudinary usage could not be loaded.',
          );
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : t('settings.vaultLoadFailed'));
        }
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

  const handleCreateProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!getIdToken || !providerName.trim() || providerSaving) return;
    setProviderSaving(true);
    setError('');
    try {
      const token = await getIdToken();
      const result = await createProvider(token, {
        name: providerName.trim(),
        category: providerCategory,
        adapter: providerAdapter,
        ...(providerAdapter === 'openai-compatible'
          ? { baseUrl: providerBaseUrl.trim(), model: providerModel.trim() }
          : {}),
      });
      setProviderConfigs(result.providers);
      setProviderName('');
      setProviderBaseUrl('');
      setProviderModel('');
      setProviderFormOpen(false);
      setToast('Provider added');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Provider could not be added.');
    } finally {
      setProviderSaving(false);
    }
  };

  const handleProviderUpdate = async (
    provider: ProviderConfig,
    updates: { enabled?: boolean; rotationOrder?: number },
  ) => {
    if (!getIdToken) return;
    const previous = providerConfigs;
    setProviderConfigs((current) =>
      current.map((item) => item.id === provider.id ? { ...item, ...updates } : item),
    );
    try {
      const token = await getIdToken();
      const result = await updateProviderConfig(token, provider.id, updates);
      setProviderConfigs(result.providers);
    } catch (updateError) {
      setProviderConfigs(previous);
      setError(updateError instanceof Error ? updateError.message : 'Provider could not be updated.');
    }
  };

  const moveImageProvider = async (provider: ProviderConfig, delta: -1 | 1) => {
    const imageProviders = providerConfigs
      .filter((item) => item.category === 'image')
      .sort((left, right) => left.rotationOrder - right.rotationOrder);
    const index = imageProviders.findIndex((item) => item.id === provider.id);
    const swap = imageProviders[index + delta];
    if (!swap) return;
    await handleProviderUpdate(provider, { rotationOrder: swap.rotationOrder });
    await handleProviderUpdate(swap, { rotationOrder: provider.rotationOrder });
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
              {providerConfigs.map((providerConfig) => {
                const provider = providerConfig.id;
                const symbol = providerSymbols[providerConfig.adapter] ?? providerConfig.name.slice(0, 1).toUpperCase();
                const providerKeys = keysForProvider(provider);
                const isAdding = addingProvider === provider;
                const imageProviderOrder = providerConfigs
                  .filter((item) => item.category === 'image')
                  .sort((left, right) => left.rotationOrder - right.rotationOrder);
                const imagePosition = imageProviderOrder.findIndex((item) => item.id === provider);
                return (
                  <article className="provider-card" key={provider} data-testid={`card-provider-${provider}`}>
                    <div className="provider-card-head">
                      <div className={`provider-symbol provider-symbol-${provider}`} aria-hidden="true">
                        {symbol}
                      </div>
                      <div className="provider-copy">
                        <h3>{providerConfig.name}</h3>
                        <p>
                          {providerConfig.category === 'storage' ? 'Storage provider' : `Image provider · ${providerConfig.adapter}`}
                          {providerConfig.adapter === 'zsky' ? ' · API format not verified; skipped' : ''}
                        </p>
                      </div>
                      <span className="provider-count">{providerKeys.length}</span>
                      {providerConfig.category === 'image' && (
                        <div className="provider-rotation">
                          <button
                            className="icon-action"
                            type="button"
                            aria-label={`Move ${providerConfig.name} earlier`}
                            title="Move earlier"
                            disabled={imagePosition <= 0}
                            onClick={() => void moveImageProvider(providerConfig, -1)}
                          ><ArrowUp size={14} /></button>
                          <button
                            className="icon-action"
                            type="button"
                            aria-label={`Move ${providerConfig.name} later`}
                            title="Move later"
                            disabled={imagePosition < 0 || imagePosition >= imageProviderOrder.length - 1}
                            onClick={() => void moveImageProvider(providerConfig, 1)}
                          ><ArrowDown size={14} /></button>
                          {provider === 'pollinations' ? (
                            <small>Always last</small>
                          ) : (
                            <button
                              className={`vault-key-toggle${providerConfig.enabled ? ' is-enabled' : ''}`}
                              type="button"
                              role="switch"
                              aria-checked={providerConfig.enabled}
                              aria-label={`Enable ${providerConfig.name}`}
                              onClick={() => void handleProviderUpdate(providerConfig, { enabled: !providerConfig.enabled })}
                            ><span /></button>
                          )}
                        </div>
                      )}
                      {providerConfig.category === 'storage' && (
                        <div className="provider-rotation">
                          <span className="provider-storage-label">Enabled</span>
                          <button
                            className={`vault-key-toggle${providerConfig.enabled ? ' is-enabled' : ''}`}
                            type="button"
                            role="switch"
                            aria-checked={providerConfig.enabled}
                            aria-label={`Enable ${providerConfig.name}`}
                            onClick={() => void handleProviderUpdate(providerConfig, { enabled: !providerConfig.enabled })}
                          ><span /></button>
                        </div>
                      )}
                    </div>

                    {providerConfig.secretFallback && !providerKeys.some((key) => key.enabled) && (
                      <div className="provider-secret-fallback">
                        <span>{providerConfig.secretFallback}</span>
                        <small>from Replit Secrets · read-only</small>
                      </div>
                    )}

                    {providerKeys.length > 0 ? (
                      <ul className="provider-key-list" aria-label={`${providerConfig.name} API keys`}>
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
                    ) : providerConfig.adapter !== 'pollinations' ? (
                      <div className="provider-empty" data-testid={`text-empty-keys-${provider}`}>
                        <span className="empty-indicator" />
                        {keysLoading ? t('settings.loadingKeys') : t('settings.emptyKeys')}
                      </div>
                    ) : null}

                    <div className="provider-add-form">
                      {isAdding && providerConfig.adapter !== 'pollinations' ? (
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
                      ) : providerConfig.adapter !== 'pollinations' ? (
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
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            {providerFormOpen ? (
              <form className="vault-add-form provider-create-form" onSubmit={(event) => void handleCreateProvider(event)}>
                <h3>Add provider</h3>
                <label>
                  <span>Provider name</span>
                  <input value={providerName} maxLength={80} required onChange={(event) => setProviderName(event.currentTarget.value)} placeholder="My image provider" />
                </label>
                <label>
                  <span>Category</span>
                  <select
                    value={providerCategory}
                    onChange={(event) => {
                      const next = event.currentTarget.value as 'image' | 'storage';
                      setProviderCategory(next);
                      setProviderAdapter(next === 'storage' ? 'cloudinary' : 'agnes');
                    }}
                  >
                    <option value="image">Image</option>
                    <option value="storage">Storage</option>
                  </select>
                </label>
                <label>
                  <span>Adapter</span>
                  <select value={providerAdapter} onChange={(event) => setProviderAdapter(event.currentTarget.value as ProviderAdapter)}>
                    {providerAdapters
                      .filter((adapter) => providerCategory === 'storage' ? adapter.id === 'cloudinary' : adapter.id !== 'cloudinary')
                      .map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.label}</option>)}
                  </select>
                </label>
                {providerAdapter === 'openai-compatible' && (
                  <>
                    <label>
                      <span>Base URL</span>
                      <input type="url" value={providerBaseUrl} required placeholder="https://api.example.com/v1" onChange={(event) => setProviderBaseUrl(event.currentTarget.value)} />
                    </label>
                    <label>
                      <span>Model name</span>
                      <input value={providerModel} required placeholder="image-model" onChange={(event) => setProviderModel(event.currentTarget.value)} />
                    </label>
                  </>
                )}
                <div className="vault-add-actions">
                  <button className="add-key-button" type="submit" disabled={providerSaving || !providerName.trim() || (providerAdapter === 'openai-compatible' && (!providerBaseUrl.trim() || !providerModel.trim()))}>
                    {providerSaving ? 'Adding…' : 'Add provider'}
                  </button>
                  <button className="vault-cancel-button" type="button" onClick={() => setProviderFormOpen(false)} disabled={providerSaving}>Cancel</button>
                </div>
              </form>
            ) : (
              <button className="add-key-button" type="button" onClick={() => setProviderFormOpen(true)} disabled={!getIdToken}>
                <Plus size={16} /><span>Add provider</span>
              </button>
            )}

            <div className="security-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{t('settings.securityNote')}</span>
            </div>
          </section>
          <section className="account-panel storage-usage-panel" aria-labelledby="cloudinary-usage-title">
            <div className="section-kicker"><HardDrive size={14} /> Cloudinary storage</div>
            <h2 id="cloudinary-usage-title">Storage usage</h2>
            {!storageUsage && storageUsageError ? (
              <p className="settings-inline-error">{storageUsageError}</p>
            ) : !providerConfigs.some((provider) => provider.id === 'cloudinary' && provider.enabled) ? (
              <p>Cloudinary is disabled in provider settings.</p>
            ) : storageUsage && !storageUsage.configured ? (
              <p>Cloudinary credentials are missing. Add a Cloudinary key in the vault or set `CLOUDINARY_URL` in Replit Secrets.</p>
            ) : storageUsage?.configured && storageUsage.usedBytes !== null && storageUsage.limitBytes !== null ? (
              <>
                <div className="storage-usage-copy">
                  <span>{formatBytes(storageUsage.usedBytes)} used</span>
                  <span>{formatBytes(storageUsage.limitBytes)} limit</span>
                </div>
                <div className="factory-storage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) * 100))}>
                  <span className={storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) >= 0.8 ? 'storage-warning' : ''} style={{ width: `${Math.min(100, storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) * 100)}%` }} />
                </div>
                {storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) >= 0.8 && <p className="settings-inline-warning">Cloudinary storage is at least 80% used.</p>}
              </>
            ) : (
              <p>Cloudinary is configured; usage limits were not included in the account response.</p>
            )}
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
