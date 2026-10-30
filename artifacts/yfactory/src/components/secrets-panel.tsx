import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createVaultKey, deleteVaultKey, loadVaultKeys, replaceVaultKeyValue, type VaultKey } from '@/lib/apiKeyVault';

type SecretsPanelProps = {
  getIdToken?: () => Promise<string>;
};

function providerForSecretName(name: string): 'agnes' | 'glm' | null {
  const match = /^(AGNES|GLM)_API_KEY(?:_([2-9]|[1-9]\d+))?$/.exec(name.trim());
  if (match?.[1] === 'AGNES') return 'agnes';
  if (match?.[1] === 'GLM') return 'glm';
  return null;
}

function keyOrder(left: VaultKey, right: VaultKey): number {
  return left.label.localeCompare(right.label, undefined, { numeric: true });
}

export default function SecretsPanel({ getIdToken }: SecretsPanelProps) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<VaultKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedValue, setEditedValue] = useState('');
  const [busyActions, setBusyActions] = useState<string[]>([]);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    let active = true;
    if (!getIdToken) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const token = await getIdToken();
        const savedKeys = await loadVaultKeys(token);
        if (active) setKeys(savedKeys.sort(keyOrder));
      } catch (error) {
        if (active) {
          setToast(error instanceof Error ? error.message : t('settings.vaultLoadFailed'));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, t]);

  const beginAction = (action: string) => {
    setBusyActions((current) => current.includes(action) ? current : [...current, action]);
  };
  const endAction = (action: string) => {
    setBusyActions((current) => current.filter((item) => item !== action));
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    const provider = providerForSecretName(trimmedName);
    if (!getIdToken || !provider || !trimmedValue || busyActions.includes('add')) {
      if (!provider) setToast(t('settings.secretNameInvalid'));
      return;
    }
    const action = 'add';
    beginAction(action);
    try {
      const token = await getIdToken();
      const savedKey = await createVaultKey(token, {
        provider,
        label: trimmedName,
        value: trimmedValue,
      });
      setKeys((current) => [...current, savedKey].sort(keyOrder));
      setName('');
      setValue('');
      setToast(t('settings.keySaved'));
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('settings.vaultSaveFailed'));
    } finally {
      endAction(action);
    }
  };

  const handleDelete = async (key: VaultKey) => {
    if (!getIdToken) return;
    const action = `delete:${key.id}`;
    beginAction(action);
    try {
      await deleteVaultKey(await getIdToken(), key);
      setKeys((current) => current.filter((item) => item.id !== key.id));
      if (editingId === key.id) {
        setEditingId(null);
        setEditedValue('');
      }
      setToast(t('settings.keyDeleted'));
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('settings.vaultDeleteFailed'));
    } finally {
      endAction(action);
    }
  };

  const handleEditValue = async (event: FormEvent<HTMLFormElement>, key: VaultKey) => {
    event.preventDefault();
    if (!getIdToken || !editedValue.trim()) return;
    const action = `edit:${key.id}`;
    beginAction(action);
    try {
      const updatedKey = await replaceVaultKeyValue(
        await getIdToken(),
        key,
        editedValue.trim(),
      );
      setKeys((current) => current.map((item) => item.id === key.id ? updatedKey : item));
      setEditingId(null);
      setEditedValue('');
      setToast(t('settings.keyUpdated'));
    } catch (error) {
      setToast(error instanceof Error ? error.message : t('settings.vaultSaveFailed'));
    } finally {
      endAction(action);
    }
  };

  return (
    <section className="secrets-panel" aria-labelledby="secrets-title">
      <h2 id="secrets-title">{t('settings.secretsTitle')}</h2>
      <form className="secrets-add-form" onSubmit={(event) => void handleAdd(event)}>
        <label>
          <span>{t('settings.secretName')}</span>
          <input
            value={name}
            maxLength={80}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(event) => setName(event.currentTarget.value)}
            required
            data-testid="input-secret-name"
          />
        </label>
        <label>
          <span>{t('settings.secretValue')}</span>
          <input
            type="password"
            value={value}
            maxLength={4096}
            autoComplete="new-password"
            onChange={(event) => setValue(event.currentTarget.value)}
            required
            data-testid="input-secret-value"
          />
        </label>
        <button
          className="add-key-button secrets-add-button"
          type="submit"
          disabled={!getIdToken || busyActions.includes('add') || !name.trim() || !value.trim()}
          aria-busy={busyActions.includes('add')}
          data-testid="button-add-secret"
        >
          {busyActions.includes('add') ? t('settings.saving') : t('settings.addSecret')}
        </button>
      </form>

      <ul className="secrets-list" aria-label={t('settings.savedSecrets')}>
        {loading && <li className="secrets-empty">{t('settings.loadingKeys')}</li>}
        {!loading && keys.length === 0 && (
          <li className="secrets-empty">{t('settings.emptyKeys')}</li>
        )}
        {keys.map((key) => {
          const editing = editingId === key.id;
          const isEditing = busyActions.includes(`edit:${key.id}`);
          const isDeleting = busyActions.includes(`delete:${key.id}`);
          return (
            <li className="secrets-row" key={`${key.provider}:${key.id}`}>
              <div className="secrets-entry">
                <strong dir="ltr">{key.label}</strong>
                <code dir="ltr">{key.maskedValue}</code>
              </div>
              <div className="secrets-actions">
                {editing ? (
                  <form className="secrets-edit-form" onSubmit={(event) => void handleEditValue(event, key)}>
                    <input
                      type="password"
                      value={editedValue}
                      maxLength={4096}
                      autoComplete="new-password"
                      autoFocus
                      aria-label={t('settings.secretValue')}
                      onChange={(event) => setEditedValue(event.currentTarget.value)}
                      required
                    />
                    <button type="submit" disabled={isEditing || !editedValue.trim()} aria-busy={isEditing}>
                      {isEditing ? t('settings.saving') : t('settings.saveSecret')}
                    </button>
                    <button
                      type="button"
                      disabled={isEditing}
                      onClick={() => {
                        setEditingId(null);
                        setEditedValue('');
                      }}
                    >
                      {t('settings.cancel')}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={!getIdToken || isDeleting || isEditing}
                    onClick={() => {
                      setEditingId(key.id);
                      setEditedValue('');
                    }}
                    data-testid={`button-edit-secret-${key.id}`}
                  >
                    {t('settings.editValue')}
                  </button>
                )}
                <button
                  className="secrets-delete-button"
                  type="button"
                  disabled={!getIdToken || isDeleting || isEditing}
                  aria-busy={isDeleting}
                  onClick={() => void handleDelete(key)}
                  data-testid={`button-delete-secret-${key.id}`}
                >
                  {isDeleting ? t('settings.deletingSecret') : t('settings.deleteSecret')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {toast && <div className="settings-toast" role="alert">{toast}</div>}
    </section>
  );
}
