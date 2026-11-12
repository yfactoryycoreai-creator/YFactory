import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Eye, EyeOff, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import {
  createVaultKey,
  deleteVaultKey,
  loadVaultKeys,
  replaceVaultKeyValue,
  type VaultKey,
} from '@/lib/apiKeyVault';

type SecretsPanelProps = {
  getIdToken?: () => Promise<string>;
};

type SecretFormMode = 'create' | 'edit' | null;

const MAX_SECRET_COUNT = 100;
const SECRET_NAME_PATTERN = /^[A-Z0-9_]{1,100}$/;
const SECRET_NAME_SUGGESTIONS = [
  'AGNES_API_KEY_1',
  'CLOUDFLARE_API_TOKEN_1',
  'CLOUDFLARE_ACCOUNT_ID_1',
  'GLM_API_KEY_1',
  'CLOUDINARY_URL',
] as const;

function nextGeminiKeyName(keys: VaultKey[]): string {
  const usedNumbers = new Set(
    keys.flatMap((key) => {
      const match = /^GEMINI_API_KEY_(\d+)$/.exec(key.label.trim().toUpperCase());
      return match ? [Number(match[1])] : [];
    }),
  );
  let next = 1;
  while (usedNumbers.has(next)) next += 1;
  return `GEMINI_API_KEY_${next}`;
}

function providerForSecretName(name: string): string {
  if (/^GEMINI_/.test(name)) return 'gemini';
  if (/^AGNES_API_KEY(?:_[1-9]\d*)?$/.test(name)) return 'agnes';
  if (/^GLM_API_KEY(?:_[1-9]\d*)?$/.test(name)) return 'glm';
  return 'custom';
}

function keyOrder(left: VaultKey, right: VaultKey): number {
  return left.label.localeCompare(right.label, undefined, { numeric: true });
}

export default function SecretsPanel({ getIdToken }: SecretsPanelProps) {
  const { t, i18n } = useTranslation();
  const isRtl = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const deleteDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const [keys, setKeys] = useState<VaultKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formMode, setFormMode] = useState<SecretFormMode>(null);
  const [editingKey, setEditingKey] = useState<VaultKey | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VaultKey | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
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
  }, [getIdToken, t]);

  const normalizedName = name.trim().toUpperCase();
  const existingKey = formMode === 'create'
    ? keys.find((key) => key.label.trim().toUpperCase() === normalizedName)
    : undefined;
  const nameIsValid = SECRET_NAME_PATTERN.test(normalizedName);
  const hasReachedSecretLimit = keys.length >= MAX_SECRET_COUNT;

  const resetForm = () => {
    setFormMode(null);
    setEditingKey(null);
    setName('');
    setValue('');
    setShowValue(false);
    setFormError('');
  };

  const openNewSecret = () => {
    resetForm();
    setStatusMessage('');
    setName(nextGeminiKeyName(keys));
    setFormMode('create');
  };

  const openEditSecret = (key: VaultKey) => {
    setEditingKey(key);
    setName(key.label);
    setValue('');
    setShowValue(false);
    setFormError('');
    setStatusMessage('');
    setFormMode('edit');
  };

  const handleSaveSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nameIsValid) {
      setFormError(t('settings.secretNameInvalid'));
      return;
    }
    if (!value.trim()) {
      setFormError(t('settings.secretValueRequired'));
      return;
    }
    if (!getIdToken) {
      setFormError(t('settings.vaultSaveFailed'));
      return;
    }
    if (formMode === 'create' && existingKey) {
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
      if (formMode === 'edit' && editingKey) {
        const updatedKey = await replaceVaultKeyValue(
          token,
          editingKey,
          value.trim(),
        );
        setKeys((current) =>
          current.map((key) => key.id === editingKey.id ? updatedKey : key).sort(keyOrder),
        );
        setStatusMessage(t('settings.keyUpdated'));
      } else {
        const savedKey = await createVaultKey(token, {
          provider: providerForSecretName(normalizedName),
          label: normalizedName,
          value: value.trim(),
        });
        setKeys((current) => [...current, savedKey].sort(keyOrder));
        setStatusMessage(t('settings.keySaved'));
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

  const handleDeleteSecret = async () => {
    if (!pendingDelete || !getIdToken) throw new Error('Secret deletion is unavailable.');
    const key = pendingDelete;
    setDeletingId(key.id);
    try {
      await deleteVaultKey(await getIdToken(), key);
      setKeys((current) => current.filter((item) => item.id !== key.id));
      setStatusMessage(t('settings.keyDeleted'));
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="secrets-panel" aria-labelledby="secrets-title">
      <header className="secrets-panel-heading">
        <h2 id="secrets-title">{t('settings.secretsTitle')}</h2>
        <button
          className="factory-primary-button secrets-new-button"
          type="button"
          onClick={openNewSecret}
          disabled={!getIdToken || hasReachedSecretLimit || loading}
          title={hasReachedSecretLimit ? t('settings.secretLimitReached') : undefined}
          data-testid="button-new-secret"
        >
          <Plus size={17} aria-hidden="true" />
          {t('settings.newSecret')}
        </button>
      </header>

      {loadError && <p className="secret-error-line" role="alert">{loadError}</p>}
      {statusMessage && <p className="secret-status-line" role="status">{statusMessage}</p>}
      {hasReachedSecretLimit && (
        <p className="secret-status-line" role="status">{t('settings.secretLimitReached')}</p>
      )}

      <ul className="secrets-list" aria-label={t('settings.savedSecrets')}>
        {loading && <li className="secrets-empty">{t('settings.loadingKeys')}</li>}
        {!loading && keys.length === 0 && !loadError && (
          <li className="secrets-empty">{t('settings.emptyKeys')}</li>
        )}
        {keys.map((key) => (
          <li className="secrets-row" key={`${key.provider}:${key.id}`}>
            <div className="secrets-entry">
              <strong dir="ltr">{key.label}</strong>
              <code dir="ltr">{key.maskedValue}</code>
                {key.provider !== 'gemini' && (
                  <small>{t('settings.notUsedByChat')}</small>
                )}
            </div>
            <div className="secrets-actions">
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
        open={formMode !== null}
        onOpenChange={(nextOpen) => {
          if (formBusy) return;
          if (nextOpen) setFormMode('create');
          else resetForm();
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
                  maxLength={100}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  readOnly={formMode === 'edit'}
                  dir="ltr"
                  onChange={(event) => {
                    setName(event.currentTarget.value.toUpperCase());
                    setFormError('');
                  }}
                  aria-invalid={Boolean(formError && !nameIsValid)}
                  data-testid="input-secret-name"
                />
              </label>
              {name && !nameIsValid && (
                <p className="secret-error-line" role="alert">{t('settings.secretNameInvalid')}</p>
              )}
              {formMode === 'create' && (
                <div className="secret-suggestions" aria-label={t('settings.secretSuggestions')}>
                  {[nextGeminiKeyName(keys), ...SECRET_NAME_SUGGESTIONS].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={formBusy}
                      onClick={() => {
                        setName(suggestion);
                        setFormError('');
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <label className="secret-sheet-field">
                <span>{t('settings.secretValue')}</span>
                <span className="secret-value-input-wrap">
                  <input
                    type={showValue ? 'text' : 'password'}
                    value={value}
                    maxLength={4096}
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
              </label>
              {existingKey && (
                <div className="secret-existing-note" role="status">
                  <span>{t('settings.secretAlreadyExists')}</span>
                  <button
                    type="button"
                    disabled={formBusy}
                    onClick={() => openEditSecret(existingKey)}
                  >
                    {t('settings.updateExistingSecret')}
                  </button>
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
                    !value.trim() ||
                    !getIdToken ||
                    Boolean(existingKey) ||
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
