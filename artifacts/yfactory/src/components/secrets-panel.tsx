import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Eye, EyeOff, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import {
  createVaultKey,
  deleteVaultKey,
  loadVaultKeys,
  revealVaultKeyValue,
  updateVaultKeyMetadata,
  type SecretModelType,
  type VaultKey,
} from '@/lib/apiKeyVault';

type SecretsPanelProps = {
  userId: string | null;
  getIdToken?: () => Promise<string>;
};

type SecretFormMode = 'create' | 'edit' | null;

const MAX_SECRET_COUNT = 100;
const SECRET_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,100}$/u;

function keyOrder(left: VaultKey, right: VaultKey): number {
  return left.label.localeCompare(right.label, undefined, { numeric: true });
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
  const [modelType, setModelType] = useState<SecretModelType | ''>('');
  const [description, setDescription] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VaultKey | null>(null);
  const [pendingDeleteOwnerId, setPendingDeleteOwnerId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    let active = true;
    setKeys([]);
    setKeysOwnerId(null);
    setRevealedValues({});
    setFormMode(null);
    setFormOwnerId(null);
    setEditingKey(null);
    setName('');
    setValue('');
    setModelType('');
    setDescription('');
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

  const visibleKeys = keysOwnerId === userId ? keys : [];
  const loadingForUser = loading || (Boolean(getIdToken) && keysOwnerId !== userId && !loadError);
  const normalizedName = name.trim();
  const duplicateKey = visibleKeys.find((key) =>
    key.label.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase() &&
    key.id !== editingKey?.id,
  );
  const nameIsValid = SECRET_NAME_PATTERN.test(normalizedName);
  const hasReachedSecretLimit = visibleKeys.length >= MAX_SECRET_COUNT;

  const resetForm = () => {
    setFormMode(null);
    setFormOwnerId(null);
    setEditingKey(null);
    setName('');
    setValue('');
    setModelType('');
    setDescription('');
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
    setName(key.label);
    setModelType(key.modelType ?? '');
    setDescription(key.description ?? '');
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
    if (!modelType) {
      setFormError(t('settings.secretModelTypeRequired'));
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
          label: normalizedName,
          modelType,
          description: description.trim() || null,
          value: value.trim() || null,
        });
        if (userIdRef.current !== requestedUserId) return;
        setKeys((current) =>
          current.map((key) => key.id === editingKey.id ? updatedKey : key).sort(keyOrder),
        );
        setRevealedValues((current) => {
          const next = { ...current };
          delete next[editingKey.id];
          return next;
        });
        setStatusMessage(t('settings.secretUpdated'));
      } else {
        const savedKey = await createVaultKey(token, {
          label: normalizedName,
          value: value.trim(),
          modelType,
          description: description.trim(),
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
    if (Object.prototype.hasOwnProperty.call(revealedValues, key.id)) {
      setRevealedValues((current) => {
        const next = { ...current };
        delete next[key.id];
        return next;
      });
      return;
    }
    if (!getIdToken) return;
    const requestedUserId = userId;
    setRevealingId(key.id);
    setActionError('');
    try {
      const token = await getIdToken();
      if (userIdRef.current !== requestedUserId) return;
      const revealedValue = await revealVaultKeyValue(token, key);
      if (userIdRef.current !== requestedUserId) return;
      setRevealedValues((current) => ({ ...current, [key.id]: revealedValue }));
    } catch {
      setActionError(t('settings.vaultRevealFailed'));
    } finally {
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
      setRevealedValues((current) => {
        const next = { ...current };
        delete next[key.id];
        return next;
      });
      setStatusMessage(t('settings.secretDeleted'));
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="secrets-panel" aria-labelledby="secrets-title">
      <header className="secrets-panel-heading">
        <h2 id="secrets-title">{t('settings.savedSecrets')}</h2>
        <button
          className="factory-primary-button secrets-new-button"
          type="button"
          onClick={openNewSecret}
          disabled={!getIdToken || hasReachedSecretLimit || loadingForUser}
          title={hasReachedSecretLimit ? t('settings.secretLimitReached') : undefined}
          data-testid="button-new-secret"
        >
          <Plus size={17} aria-hidden="true" />
          {t('settings.addSecret')}
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

      <ul className="secrets-list" aria-label={t('settings.savedSecrets')}>
        {loadingForUser && <li className="secrets-empty">{t('settings.loadingKeys')}</li>}
        {!loadingForUser && visibleKeys.length === 0 && !loadError && (
          <li className="secrets-empty">
            <span className="secrets-empty-icon" aria-hidden="true"><Plus size={21} /></span>
            <strong>{t('settings.emptyKeysTitle')}</strong>
            <span>{t('settings.emptyKeys')}</span>
          </li>
        )}
        {visibleKeys.map((key) => (
          <li className="secrets-row" key={`${key.provider}:${key.id}`}>
            <div className="secrets-entry">
              <strong dir="ltr">{key.label}</strong>
              <span className="secret-model-badge">
                {key.modelType
                  ? t(`settings.modelTypes.${key.modelType}`)
                  : t('settings.modelTypeUnspecified')}
              </span>
              {key.description && <small className="secret-description">{key.description}</small>}
              <code dir="ltr">{revealedValues[key.id] ?? key.maskedValue}</code>
            </div>
            <div className="secrets-actions">
              <button
                className="secret-icon-button"
                type="button"
                disabled={!getIdToken || deletingId === key.id || revealingId === key.id}
                aria-label={revealedValues[key.id]
                  ? t('settings.hideSecretValue')
                  : t('settings.showSecretValue')}
                onClick={() => void toggleSecretVisibility(key)}
                data-testid={`button-reveal-secret-${key.id}`}
              >
                {revealingId === key.id
                  ? <LoaderCircle className="loading-spinner" size={17} aria-hidden="true" />
                  : revealedValues[key.id]
                    ? <EyeOff size={17} aria-hidden="true" />
                    : <Eye size={17} aria-hidden="true" />}
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
                  {formMode === 'edit' ? t('settings.editSecretTitle') : t('settings.newSecret')}
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
                <span>{t('settings.secretName')}</span>
                <input
                  id="secret-name-input"
                  value={name}
                  required
                  maxLength={100}
                  placeholder={t('settings.secretNamePlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                    setFormError('');
                  }}
                  aria-invalid={Boolean(formError && !nameIsValid)}
                  data-testid="input-secret-name"
                />
              </label>
              {name && !nameIsValid && (
                <p className="secret-error-line" role="alert">{t('settings.secretNameInvalid')}</p>
              )}
              <label className="secret-sheet-field">
                <span>{t('settings.modelType')}</span>
                <select
                  className="secret-model-select"
                  value={modelType}
                  required
                  onChange={(event) => {
                    setModelType(event.currentTarget.value as SecretModelType | '');
                    setFormError('');
                  }}
                  aria-invalid={Boolean(formError && !modelType)}
                  data-testid="select-secret-model-type"
                >
                  <option value="">{t('settings.selectModelType')}</option>
                  <option value="images">{t('settings.modelTypes.images')}</option>
                  <option value="video">{t('settings.modelTypes.video')}</option>
                  <option value="text">{t('settings.modelTypes.text')}</option>
                </select>
                <small className="secret-form-hint">{t('settings.secretModelTypeNote')}</small>
              </label>
              <label className="secret-sheet-field">
                <span>{t('settings.secretValue')}</span>
                <span className="secret-value-input-wrap">
                  <input
                    type={showValue ? 'text' : 'password'}
                    value={value}
                    required={formMode === 'create'}
                    maxLength={4096}
                    placeholder={formMode === 'edit'
                      ? t('settings.keepExistingKey')
                      : t('settings.keyValuePlaceholder')}
                    autoComplete="new-password"
                    dir="ltr"
                    onChange={(event) => {
                      setValue(event.currentTarget.value);
                      setFormError('');
                    }}
                    data-testid="input-secret-value"
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
                    {t('settings.currentKey')}: <code dir="ltr">{editingKey.maskedValue}</code>
                  </small>
                )}
              </label>
              <label className="secret-sheet-field">
                <span>{t('settings.secretDescription')}</span>
                <textarea
                  className="secret-description-input"
                  value={description}
                  maxLength={500}
                  placeholder={t('settings.secretDescriptionPlaceholder')}
                  rows={3}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                  data-testid="input-secret-description"
                />
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
                    !modelType ||
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
