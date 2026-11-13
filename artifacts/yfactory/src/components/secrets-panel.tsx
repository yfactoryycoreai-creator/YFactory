import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
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
  revealVaultKeyValue,
  updateVaultKeyMetadata,
  type SecretUsage,
  type VaultKey,
} from '@/lib/apiKeyVault';

type SecretsPanelProps = {
  userId: string | null;
  getIdToken?: () => Promise<string>;
};

type SecretFormMode = 'create' | 'edit' | null;

const MAX_SECRET_COUNT = 100;
const SECRET_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,200}$/u;

function keyOrder(left: VaultKey, right: VaultKey): number {
  return (left.modelName ?? left.label).localeCompare(
    right.modelName ?? right.label,
    undefined,
    { numeric: true },
  );
}

function UsageIcon({ keyEntry }: { keyEntry: VaultKey }) {
  if (keyEntry.usage === 'chat' || keyEntry.modelType === 'text') {
    return <MessageCircle size={20} aria-hidden="true" />;
  }
  if (keyEntry.modelType === 'images') return <ImageIcon size={20} aria-hidden="true" />;
  if (keyEntry.modelType === 'video') return <Film size={20} aria-hidden="true" />;
  return <KeyRound size={20} aria-hidden="true" />;
}

export default function SecretsPanel({ userId, getIdToken }: SecretsPanelProps) {
  const { t, i18n } = useTranslation();
  const isRtl = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const deleteDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const [keys, setKeys] = useState<VaultKey[]>([]);
  const [keysOwnerId, setKeysOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formMode, setFormMode] = useState<SecretFormMode>(null);
  const [formOwnerId, setFormOwnerId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<VaultKey | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [usage, setUsage] = useState<SecretUsage | ''>('');
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
    setName('');
    setValue('');
    setUsage('');
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

  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
  }, []);

  const visibleKeys = keysOwnerId === userId ? keys : [];
  const loadingForUser = loading || (Boolean(getIdToken) && keysOwnerId !== userId && !loadError);
  const duplicateKey = visibleKeys.find((key) =>
    key.modelName?.toLocaleLowerCase() === name.toLocaleLowerCase() &&
    key.id !== editingKey?.id,
  );
  const nameIsValid = SECRET_NAME_PATTERN.test(name) && Boolean(name.trim());
  const hasReachedSecretLimit = visibleKeys.length >= MAX_SECRET_COUNT;

  const resetForm = () => {
    setFormMode(null);
    setFormOwnerId(null);
    setEditingKey(null);
    setName('');
    setValue('');
    setUsage('');
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
    setName(key.modelName ?? '');
    setUsage(key.usage ?? '');
    setValue('');
    setShowValue(false);
    setFormError('');
    setStatusMessage('');
    setFormOwnerId(userId);
    setFormMode('edit');
  };

  const handleSaveSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formOwnerId !== userIdRef.current) return;
    const requestedUserId = userIdRef.current;
    if (!nameIsValid) {
      setFormError(t('settings.secretNameInvalid'));
      return;
    }
    if (!usage) {
      setFormError(t('settings.secretUsageRequired'));
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
    if (duplicateKey) {
      setFormError(t('settings.secretAlreadyExists'));
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
          modelName: name,
          usage,
          value: value.trim() || null,
        });
        if (userIdRef.current !== requestedUserId) return;
        setKeys((current) =>
          current.map((key) => key.id === editingKey.id ? updatedKey : key).sort(keyOrder),
        );
        if (revealedValue?.id === editingKey.id) setRevealedValue(null);
        setStatusMessage(t('settings.secretUpdated'));
      } else {
        const savedKey = await createVaultKey(token, {
          modelName: name,
          value: value.trim(),
          usage,
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
    <section className="secrets-panel" aria-labelledby="secrets-title">
      <header className="secrets-panel-heading">
        <h2 id="secrets-title">{t('settings.savedApiKeys')}</h2>
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
            <span className="secrets-empty-shield" aria-hidden="true">
              <svg viewBox="0 0 88 88" fill="none">
                <path d="M44 8 70 18v21c0 18-11 31-26 40C29 70 18 57 18 39V18L44 8Z" fill="currentColor" fillOpacity=".12" />
                <path d="M44 8 70 18v21c0 18-11 31-26 40C29 70 18 57 18 39V18L44 8Z" stroke="currentColor" strokeWidth="3" />
                <path d="m32 43 8 8 17-18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m16 14 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5ZM70 57l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" fill="currentColor" />
              </svg>
            </span>
            <strong>{t('settings.emptyKeysTitle')}</strong>
            <span>{t('settings.emptyKeys')}</span>
          </li>
        )}
        {visibleKeys.map((key) => (
          <li className="secrets-row" key={`${key.provider}:${key.id}`}>
            <span className="secret-usage-icon" aria-hidden="true">
              <UsageIcon keyEntry={key} />
            </span>
            <div className="secrets-entry">
              <div className="secret-card-heading">
                <strong dir="ltr">{key.modelName ?? key.label}</strong>
                <span className="secret-model-badge">
                  {key.usage
                    ? t(`settings.usage${key.usage[0].toUpperCase()}${key.usage.slice(1)}`)
                    : key.modelType
                      ? t(`settings.modelTypes.${key.modelType}`)
                      : t('settings.modelTypeUnspecified')}
                </span>
              </div>
              <code dir="ltr">
                {revealedValue?.id === key.id ? revealedValue.value : key.maskedValue}
              </code>
              {(!key.modelName || !key.usage) && (
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
              document.getElementById('secret-name-input')?.focus();
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
                <span>{t('settings.modelName')}</span>
                <input
                  id="secret-name-input"
                  value={name}
                  required
                  maxLength={200}
                  placeholder={t('settings.modelNamePlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                    setFormError('');
                  }}
                  aria-invalid={Boolean(formError && !nameIsValid)}
                  data-testid="input-api-key-model-name"
                />
              </label>
              {name && !nameIsValid && (
                <p className="secret-error-line" role="alert">{t('settings.secretNameInvalid')}</p>
              )}
              <label className="secret-sheet-field">
                <span>{t('settings.usage')}</span>
                <select
                  className="secret-model-select"
                  value={usage}
                  required
                  onChange={(event) => {
                    setUsage(event.currentTarget.value as SecretUsage | '');
                    setFormError('');
                  }}
                  aria-invalid={Boolean(formError && !usage)}
                  data-testid="select-api-key-usage"
                >
                  <option value="">{t('settings.selectUsage')}</option>
                  <option value="chat">{t('settings.usageChat')}</option>
                </select>
              </label>
              <label className="secret-sheet-field">
                <span>{t('settings.apiKeyValue')}</span>
                <span className="secret-value-input-wrap">
                  <input
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
              {duplicateKey && (
                <div className="secret-existing-note" role="alert">
                  {t('settings.secretAlreadyExists')}
                </div>
              )}
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
                    !nameIsValid ||
                    !usage ||
                    (formMode === 'create' && !value.trim()) ||
                    !getIdToken ||
                    Boolean(duplicateKey) ||
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
