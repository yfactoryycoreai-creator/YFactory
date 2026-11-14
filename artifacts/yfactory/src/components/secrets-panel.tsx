import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import {
  createVaultKey,
  deleteVaultKey,
  loadVaultKeys,
  loadVaultProviders,
  revealVaultKeyValue,
  updateVaultKeyMetadata,
  type VaultKey,
  type VaultProviderOption,
} from '@/lib/apiKeyVault';

type SecretsPanelProps = {
  userId: string | null;
  getIdToken?: () => Promise<string>;
};

type SecretFormMode = 'create' | 'edit' | null;

const MAX_SECRET_COUNT = 100;
function keyOrder(left: VaultKey, right: VaultKey): number {
  return (left.modelName ?? left.providerName ?? left.label).localeCompare(
    right.modelName ?? right.providerName ?? right.label,
    undefined,
    { numeric: true },
  );
}

function ProviderAvatar({ keyEntry }: { keyEntry: VaultKey }) {
  const name = keyEntry.providerName ?? keyEntry.modelName ?? keyEntry.label;
  return (
    <span className="secret-provider-avatar" aria-hidden="true">
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '•'}
    </span>
  );
}

export default function SecretsPanel({ userId, getIdToken }: SecretsPanelProps) {
  const { t, i18n } = useTranslation();
  const isRtl = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const deleteDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const [keys, setKeys] = useState<VaultKey[]>([]);
  const [keysOwnerId, setKeysOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [providerOptions, setProviderOptions] = useState<VaultProviderOption[]>([]);
  const [providerLoadError, setProviderLoadError] = useState('');
  const [formMode, setFormMode] = useState<SecretFormMode>(null);
  const [formOwnerId, setFormOwnerId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<VaultKey | null>(null);
  const [providerInput, setProviderInput] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VaultKey | null>(null);
  const [pendingDeleteOwnerId, setPendingDeleteOwnerId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<{ id: string; value: string } | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    let active = true;
    setKeys([]);
    setKeysOwnerId(null);
    setRevealedValue(null);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    setFormMode(null);
    setFormOwnerId(null);
    setEditingKey(null);
    setProviderInput('');
    setValue('');
    setPendingDelete(null);
    setPendingDeleteOwnerId(null);
    setLoading(true);
    setLoadError('');
    setStatusMessage('');
    if (!getIdToken) {
      setLoading(false);
      setLoadError(t('settings.vaultLoadFailed'));
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const token = await getIdToken();
        const savedKeys = await loadVaultKeys(token);
        if (active) {
          setKeys(savedKeys.sort(keyOrder));
          setKeysOwnerId(userId);
          setLoadError('');
        }
      } catch {
        if (active) setLoadError(t('settings.vaultLoadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, userId, t]);

  useEffect(() => {
    let active = true;
    setProviderOptions([]);
    setProviderLoadError('');
    if (!getIdToken) {
      setProviderLoadError(t('settings.providerLoadFailed'));
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const token = await getIdToken();
        const options = await loadVaultProviders(token);
        if (active) setProviderOptions(options);
      } catch {
        if (active) setProviderLoadError(t('settings.providerLoadFailed'));
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, userId, t]);

  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
  }, []);

  const visibleKeys = keysOwnerId === userId ? keys : [];
  const loadingForUser = loading || (Boolean(getIdToken) && keysOwnerId !== userId && !loadError);
  const providerQuery = providerInput.trim().toLocaleLowerCase();
  const selectedProvider = providerOptions.find((provider) =>
    provider.id.toLocaleLowerCase() === providerQuery ||
    provider.label.toLocaleLowerCase() === providerQuery,
  );
  const providerMatches = providerOptions.some((provider) =>
    provider.id.toLocaleLowerCase().includes(providerQuery) ||
    provider.label.toLocaleLowerCase().includes(providerQuery),
  );
  const providerIsUnsupported = Boolean(providerQuery) && !providerMatches;
  const hasReachedSecretLimit = visibleKeys.length >= MAX_SECRET_COUNT;

  const resetForm = () => {
    setFormMode(null);
    setFormOwnerId(null);
    setEditingKey(null);
    setProviderInput('');
    setValue('');
    setShowValue(false);
    setFormError('');
  };

  const openNewSecret = () => {
    resetForm();
    setStatusMessage('');
    setFormOwnerId(userId);
    setFormMode('create');
  };

  const openEditSecret = (key: VaultKey) => {
    setEditingKey(key);
    setProviderInput(key.providerName ?? '');
    setValue('');
    setShowValue(false);
    setFormError('');
    setStatusMessage('');
    setFormOwnerId(userId);
    setFormMode('edit');
  };

  const handleSaveSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formOwnerId !== userIdRef.current || !formMode) return;
    const requestedUserId = userIdRef.current;
    if (formMode === 'create' && !selectedProvider) {
      setFormError(providerIsUnsupported
        ? t('settings.notSupportedYet')
        : t('settings.providerRequired'));
      return;
    }
    if (formMode === 'create' && !value.trim()) {
      setFormError(t('settings.secretValueRequired'));
      return;
    }
    if (!getIdToken) {
      setFormError(t('settings.vaultSaveFailed'));
      return;
    }
    if (formMode === 'create' && hasReachedSecretLimit) {
      setFormError(t('settings.secretLimitReached'));
      return;
    }

    setFormBusy(true);
    setFormError('');
    try {
      const token = await getIdToken();
      if (userIdRef.current !== requestedUserId) return;
      if (formMode === 'edit' && editingKey) {
        const updatedKey = await updateVaultKeyMetadata(token, editingKey, {
          value: value.trim() || null,
        });
        if (userIdRef.current !== requestedUserId) return;
        setKeys((current) =>
          current.map((key) => key.id === editingKey.id ? updatedKey : key).sort(keyOrder),
        );
        if (revealedValue?.id === editingKey.id) setRevealedValue(null);
        setStatusMessage(t('settings.secretUpdated'));
      } else {
        if (formMode !== 'create' || !selectedProvider) {
          throw new Error('Choose a supported provider before saving.');
        }
        const savedKey = await createVaultKey(token, {
          provider: selectedProvider.id,
          value: value.trim(),
        });
        if (userIdRef.current !== requestedUserId) return;
        setKeys((current) => [...current, savedKey].sort(keyOrder));
        setStatusMessage(t('settings.secretSaved'));
      }
      resetForm();
    } catch {
      setFormError(
        formMode === 'edit'
          ? t('settings.vaultUpdateFailed')
          : t('settings.vaultSaveFailed'),
      );
    } finally {
      setFormBusy(false);
    }
  };

  const toggleSecretVisibility = async (key: VaultKey) => {
    if (revealedValue?.id === key.id) {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
      setRevealedValue(null);
      return;
    }
    if (!getIdToken) return;
    const requestedUserId = userId;
    setRevealingId(key.id);
    setActionError('');
    try {
      const token = await getIdToken();
      if (userIdRef.current !== requestedUserId) return;
      const secret = await revealVaultKeyValue(token, key);
      if (userIdRef.current !== requestedUserId) return;
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      setRevealedValue({ id: key.id, value: secret });
      revealTimerRef.current = setTimeout(() => {
        setRevealedValue((current) => current?.id === key.id ? null : current);
        revealTimerRef.current = null;
      }, 15_000);
    } catch {
      setActionError(t('settings.vaultRevealFailed'));
    } finally {
      setRevealingId(null);
    }
  };

  const copySecretValue = async (key: VaultKey) => {
    if (!getIdToken || !navigator.clipboard) {
      setActionError(t('settings.vaultCopyFailed'));
      return;
    }
    const requestedUserId = userId;
    setRevealingId(key.id);
    setActionError('');
    let secret = '';
    try {
      secret = await revealVaultKeyValue(await getIdToken(), key);
      if (userIdRef.current !== requestedUserId) return;
      await navigator.clipboard.writeText(secret);
      setStatusMessage(t('settings.secretCopied'));
    } catch {
      setActionError(t('settings.vaultCopyFailed'));
    } finally {
      secret = '';
      setRevealingId(null);
    }
  };

  const handleDeleteSecret = async () => {
    if (
      !pendingDelete ||
      !getIdToken ||
      pendingDeleteOwnerId !== userIdRef.current
    ) throw new Error('Secret deletion is unavailable.');
    const key = pendingDelete;
    const requestedUserId = pendingDeleteOwnerId;
    setDeletingId(key.id);
    try {
      const token = await getIdToken();
      if (userIdRef.current !== requestedUserId) return;
      await deleteVaultKey(token, key);
      if (userIdRef.current !== requestedUserId) return;
      setKeys((current) => current.filter((item) => item.id !== key.id));
      if (revealedValue?.id === key.id) setRevealedValue(null);
      setStatusMessage(t('settings.secretDeleted'));
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="secrets-panel" aria-labelledby="api-keys-title">
      <header className="secrets-panel-heading">
        <div className="api-keys-title-block">
          <span className="api-keys-title-icon" aria-hidden="true">
            <LockKeyhole size={25} />
          </span>
          <div className="api-keys-title-copy">
            <h1 id="api-keys-title">{t('settings.apiKeysTitle')}</h1>
            <p>{t('settings.apiKeysEntryDescription')}</p>
          </div>
        </div>
        <button
          className="factory-primary-button secrets-new-button"
          type="button"
          onClick={openNewSecret}
          disabled={!getIdToken || hasReachedSecretLimit || loadingForUser}
          title={hasReachedSecretLimit ? t('settings.secretLimitReached') : undefined}
          data-testid="button-new-api-key"
        >
          <Plus size={17} aria-hidden="true" />
          {t('settings.newApiKey')}
        </button>
      </header>

      {loadError && <p className="secret-error-line" role="alert">{loadError}</p>}
      {statusMessage && keysOwnerId === userId && (
        <div className="secret-success-banner" role="status">
          <Check size={18} aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
      )}
      {actionError && <p className="secret-error-line" role="alert">{actionError}</p>}
      {hasReachedSecretLimit && (
        <p className="secret-status-line" role="status">{t('settings.secretLimitReached')}</p>
      )}

      <ul className="secrets-list" aria-label={t('settings.savedApiKeys')}>
        {loadingForUser && <li className="secrets-empty">{t('settings.loadingKeys')}</li>}
        {!loadingForUser && visibleKeys.length === 0 && !loadError && (
          <li className="secrets-empty">
            <strong>{t('settings.emptyKeysTitle')}</strong>
            <span>{t('settings.emptyKeys')}</span>
          </li>
        )}
        {visibleKeys.map((key) => (
          <li className="secrets-row" key={`${key.provider}:${key.id}`}>
            <ProviderAvatar keyEntry={key} />
            <div className="secrets-entry">
              <div className="secret-card-heading">
                <strong dir="ltr">{key.modelName ?? key.providerName ?? key.label}</strong>
                <span className="secret-model-badge">
                  {key.usage
                    ? t(`settings.usage${key.usage[0].toUpperCase()}${key.usage.slice(1)}`)
                    : key.modelName && key.modelType
                      ? t(`settings.modelTypes.${key.modelType}`)
                      : t('settings.noModelsYet')}
                </span>
              </div>
              <code dir="ltr">
                {revealedValue?.id === key.id ? revealedValue.value : key.maskedValue}
              </code>
              {!key.modelName && !key.providerName && (
                <small className="secret-form-hint">{t('settings.editToFinishSetup')}</small>
              )}
              {key.usage === 'chat' && !key.chatSupported && (
                <small className="secret-unsupported-note">{t('settings.notSupportedYet')}</small>
              )}
            </div>
            <div className="secrets-actions">
              <button
                className="secret-icon-button"
                type="button"
                disabled={!getIdToken || deletingId === key.id || revealingId === key.id}
                aria-label={revealedValue?.id === key.id
                  ? t('settings.hideSecretValue')
                  : t('settings.showSecretValue')}
                onClick={() => void toggleSecretVisibility(key)}
                data-testid={`button-reveal-secret-${key.id}`}
              >
                {revealingId === key.id
                  ? <LoaderCircle className="loading-spinner" size={17} aria-hidden="true" />
                  : revealedValue?.id === key.id
                    ? <EyeOff size={17} aria-hidden="true" />
                    : <Eye size={17} aria-hidden="true" />}
              </button>
              <button
                className="secret-icon-button"
                type="button"
                disabled={!getIdToken || deletingId === key.id || revealingId === key.id}
                aria-label={t('settings.copySecretValue')}
                onClick={() => void copySecretValue(key)}
                data-testid={`button-copy-secret-${key.id}`}
              >
                {revealingId === key.id
                  ? <LoaderCircle className="loading-spinner" size={17} aria-hidden="true" />
                  : <Copy size={17} aria-hidden="true" />}
              </button>
              <button
                className="secret-icon-button"
                type="button"
                disabled={!getIdToken || deletingId === key.id}
                aria-label={t('settings.editSecretAria', { name: key.label })}
                onClick={() => openEditSecret(key)}
                data-testid={`button-edit-secret-${key.id}`}
              >
                <Pencil size={17} aria-hidden="true" />
              </button>
              <button
                className="secret-icon-button secrets-delete-button"
                type="button"
                disabled={!getIdToken || deletingId === key.id}
                aria-label={t('settings.deleteSecretAria', { name: key.label })}
                aria-busy={deletingId === key.id}
                onClick={() => {
                  setPendingDelete(key);
                  setPendingDeleteOwnerId(userId);
                  deleteDialogRef.current?.open(
                    t('settings.confirmDeleteSecret', { name: key.label }),
                  );
                }}
                data-testid={`button-delete-secret-${key.id}`}
              >
                {deletingId === key.id
                  ? <LoaderCircle className="loading-spinner" size={17} aria-hidden="true" />
                  : <Trash2 size={17} aria-hidden="true" />}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="secrets-footer-illustration" aria-hidden="true">
        <svg viewBox="0 0 160 160" fill="none">
          <path d="M80 12 130 32v39c0 34-20 58-50 77C50 129 30 105 30 71V32L80 12Z" fill="currentColor" fillOpacity=".12" />
          <path d="M80 12 130 32v39c0 34-20 58-50 77C50 129 30 105 30 71V32L80 12Z" stroke="currentColor" strokeWidth="5" />
          <rect x="58" y="72" width="44" height="36" rx="8" fill="currentColor" />
          <path d="M68 72V59a12 12 0 0 1 24 0v13" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <circle cx="80" cy="88" r="4" fill="var(--app-bg)" />
          <path d="M80 92v7" stroke="var(--app-bg)" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>

      <DialogPrimitive.Root
        open={formMode !== null && formOwnerId === userId}
        onOpenChange={(nextOpen) => {
          if (formBusy) return;
          if (!nextOpen) resetForm();
        }}
      >
        <DialogPrimitive.Portal
          container={typeof document === 'undefined' ? undefined : document.body}
        >
          <DialogPrimitive.Overlay className="confirmation-backdrop" />
          <DialogPrimitive.Content
            className="confirmation-content secret-form-sheet"
            dir={isRtl ? 'rtl' : 'ltr'}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              document.getElementById(
                formMode === 'edit' ? 'secret-key-value-input' : 'secret-provider-input',
              )?.focus();
            }}
          >
            <form onSubmit={(event) => void handleSaveSecret(event)}>
              <header className="secret-form-heading">
                <DialogPrimitive.Title className="confirmation-title">
                  {formMode === 'edit' ? t('settings.editApiKeyTitle') : t('settings.newApiKey')}
                </DialogPrimitive.Title>
                <DialogPrimitive.Close asChild>
                  <button
                    className="secret-sheet-close"
                    type="button"
                    aria-label={t('settings.cancel')}
                    disabled={formBusy}
                  >
                    <X size={19} aria-hidden="true" />
                  </button>
                </DialogPrimitive.Close>
              </header>
              <label className="secret-sheet-field">
                <span>{t('settings.provider')}</span>
                {formMode === 'edit' ? (
                  <input
                    value={editingKey?.providerName ?? t('settings.providerNotSet')}
                    readOnly
                    dir="ltr"
                    data-testid="input-api-key-provider-readonly"
                  />
                ) : (
                  <>
                    <input
                      id="secret-provider-input"
                      value={providerInput}
                      list="api-key-provider-options"
                      required
                      maxLength={100}
                      placeholder={t('settings.providerPlaceholder')}
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                      onChange={(event) => {
                        setProviderInput(event.currentTarget.value);
                        setFormError('');
                      }}
                      aria-invalid={Boolean(formError && !selectedProvider)}
                      data-testid="input-api-key-provider"
                    />
                    <datalist id="api-key-provider-options">
                      {providerOptions.map((provider) => (
                        <option key={provider.id} value={provider.label} />
                      ))}
                    </datalist>
                    {providerIsUnsupported && (
                      <small className="secret-provider-unsupported">
                        {t('settings.notSupportedYet')}
                      </small>
                    )}
                    {providerLoadError && (
                      <small className="secret-error-line" role="alert">{providerLoadError}</small>
                    )}
                  </>
                )}
              </label>
              <label className="secret-sheet-field">
                <span>{t('settings.apiKeyValue')}</span>
                <span className="secret-value-input-wrap">
                  <input
                    id="secret-key-value-input"
                    type={showValue ? 'text' : 'password'}
                    value={value}
                    required={formMode === 'create'}
                    maxLength={4096}
                    placeholder={t('settings.keyValuePlaceholder')}
                    autoComplete="new-password"
                    dir="ltr"
                    onChange={(event) => {
                      setValue(event.currentTarget.value);
                      setFormError('');
                    }}
                    data-testid="input-api-key-value"
                  />
                  <button
                    className="secret-reveal-button"
                    type="button"
                    disabled={!value || formBusy}
                    aria-label={showValue ? t('settings.hideSecretValue') : t('settings.showSecretValue')}
                    onClick={() => setShowValue((visible) => !visible)}
                  >
                    {showValue
                      ? <EyeOff size={18} aria-hidden="true" />
                      : <Eye size={18} aria-hidden="true" />}
                  </button>
                </span>
                {formMode === 'edit' && editingKey && (
                  <small className="secret-form-hint">
                    {t('settings.keepExistingKey')} · {t('settings.currentKey')}: <code dir="ltr">{editingKey.maskedValue}</code>
                  </small>
                )}
              </label>
              {formError && <p className="secret-error-line" role="alert">{formError}</p>}
              <div className="secret-sheet-actions">
                <DialogPrimitive.Close asChild>
                  <button
                    className="confirmation-button confirmation-cancel"
                    type="button"
                    disabled={formBusy}
                  >
                    {t('settings.cancel')}
                  </button>
                </DialogPrimitive.Close>
                <button
                  className="confirmation-button confirmation-secret-save"
                  type="submit"
                  disabled={
                    formBusy ||
                    (formMode === 'create' && !selectedProvider) ||
                    (formMode === 'create' && !value.trim()) ||
                    !getIdToken ||
                    (formMode === 'create' && hasReachedSecretLimit)
                  }
                  aria-busy={formBusy}
                  data-testid="button-save-secret"
                >
                  {formBusy && <LoaderCircle className="confirmation-spinner" size={17} aria-hidden="true" />}
                  {formBusy
                    ? t('settings.saving')
                    : formMode === 'edit'
                      ? t('settings.updateSecret')
                      : t('settings.saveSecret')}
                </button>
              </div>
            </form>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ConfirmActionDialog
        ref={deleteDialogRef}
        title={t('settings.deleteSecretTitle')}
        description={t('settings.confirmDeleteSecret', { name: pendingDelete?.label ?? '' })}
        confirmLabel={t('settings.deleteSecret')}
        busyLabel={t('settings.deletingSecret')}
        cancelLabel={t('settings.cancel')}
        failureMessage={t('settings.vaultDeleteFailed')}
        onConfirm={handleDeleteSecret}
        danger
        dir={isRtl ? 'rtl' : 'ltr'}
      />
    </section>
  );
}
