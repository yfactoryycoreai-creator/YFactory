import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Layers,
  LoaderCircle,
  Pencil,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import {
  addVaultKeyModel,
  createVaultKey,
  deleteVaultKey,
  loadVaultKeys,
  loadVaultProviders,
  removeVaultKeyModel,
  revealVaultKeyValue,
  updateVaultKeyMetadata,
  type VaultKey,
  type VaultProviderOption,
} from '@/lib/apiKeyVault';
import { isRtlLanguage } from '@/lib/languages';

type SecretsPanelProps = {
  userId: string | null;
  getIdToken?: () => Promise<string>;
  initialModelTarget?: { provider: string; id: string } | null;
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

function ProviderAvatar() {
  return (
    <span className="secret-provider-avatar" aria-hidden="true">
      <Layers size={21} />
    </span>
  );
}

export default function SecretsPanel({
  userId,
  getIdToken,
  initialModelTarget,
}: SecretsPanelProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLanguage(i18n.resolvedLanguage ?? i18n.language);
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [providerSetupKey, setProviderSetupKey] = useState<VaultKey | null>(null);
  const [activeModelsTarget, setActiveModelsTarget] =
    useState<{ provider: string; id: string } | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [manualModelOpen, setManualModelOpen] = useState(false);
  const [manualModelId, setManualModelId] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState('');
  const handledInitialTargetRef = useRef<string | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const userIdRef = useRef(userId);

  const closeKeyMenu = () => {
    setOpenMenuId(null);
    setMenuPosition(null);
  };

  const toggleKeyMenu = (menuId: string) => {
    if (openMenuId === menuId) {
      closeKeyMenu();
      return;
    }
    const button = menuButtonRefs.current.get(menuId);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(184, Math.max(0, window.innerWidth - 24));
    const menuHeight = 4 * 44 + 12;
    const isMenuRtl = isRtl;
    const preferredLeft = isMenuRtl ? rect.left : rect.right - width;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12));
    const top = window.innerHeight - rect.bottom >= menuHeight + 12
      ? rect.bottom + 6
      : Math.max(12, rect.top - menuHeight - 6);
    setMenuPosition({ top, left, width });
    setOpenMenuId(menuId);
  };

  useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuButtonRefs.current.get(openMenuId)?.contains(target) ||
          actionMenuRef.current?.contains(target))
      ) return;
      closeKeyMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeKeyMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', closeKeyMenu);
    window.addEventListener('scroll', closeKeyMenu, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', closeKeyMenu);
      window.removeEventListener('scroll', closeKeyMenu, true);
    };
  }, [openMenuId]);
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
    setActiveModelsTarget(null);
    closeKeyMenu();
    setProviderSetupKey(null);
    setManualModelOpen(false);
    setManualModelId('');
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
  const activeModelsKey = activeModelsTarget
    ? visibleKeys.find((key) =>
        key.provider === activeModelsTarget.provider && key.id === activeModelsTarget.id,
      ) ?? null
    : null;
  const visibleModels = (activeModelsKey?.models ?? []).filter((model) =>
    model.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!initialModelTarget || keysOwnerId !== userId) return;
    const targetKey = `${userId}:${initialModelTarget.provider}:${initialModelTarget.id}`;
    if (handledInitialTargetRef.current === targetKey) return;
    const target = visibleKeys.find((key) =>
      key.provider === initialModelTarget.provider && key.id === initialModelTarget.id,
    );
    if (!target) return;
    handledInitialTargetRef.current = targetKey;
    setActiveModelsTarget({ provider: target.provider, id: target.id });
  }, [
    initialModelTarget?.provider,
    initialModelTarget?.id,
    keysOwnerId,
    userId,
    visibleKeys,
  ]);

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
    setActiveModelsTarget(null);
    closeKeyMenu();
    setStatusMessage('');
    setFormOwnerId(userId);
    setFormMode('create');
  };

  const openModels = (key: VaultKey) => {
    closeKeyMenu();
    setModelSearch('');
    setManualModelOpen(false);
    setManualModelId('');
    setModelError('');
    if (!key.providerName) {
      openEditSecret(key);
      return;
    }
    setActiveModelsTarget({ provider: key.provider, id: key.id });
  };

  const openEditSecret = (key: VaultKey) => {
    closeKeyMenu();
    setEditingKey(key);
    setProviderInput(key.providerName ?? '');
    setValue('');
    setShowValue(false);
    setFormError('');
    setStatusMessage('');
    setFormOwnerId(userId);
    setFormMode('edit');
  };

  const handleShowModels = (key: VaultKey) => {
    closeKeyMenu();
    if (!key.providerName) {
      setProviderSetupKey(key);
      return;
    }
    openModels(key);
  };

  const replaceKey = (previous: VaultKey, updated: VaultKey) => {
    setKeys((current) =>
      current.map((key) =>
        key.id === previous.id && key.provider === previous.provider ? updated : key,
      ).sort(keyOrder),
    );
  };

  const saveManualModel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeModelsKey || !getIdToken || modelBusy) return;
    const modelId = manualModelId.trim();
    setModelError('');
    if (!modelId || modelId.length > 200) {
      setModelError(t('settings.modelIdInvalid'));
      return;
    }
    if (activeModelsKey.models.includes(modelId)) {
      setModelError(t('settings.modelAlreadySaved'));
      return;
    }
    setModelBusy(true);
    try {
      const updated = await addVaultKeyModel(
        await getIdToken(),
        activeModelsKey,
        modelId,
      );
      replaceKey(activeModelsKey, updated);
      setManualModelId('');
      setManualModelOpen(false);
      setStatusMessage(t('settings.modelSaved'));
    } catch {
      setModelError(t('settings.modelSaveFailed'));
    } finally {
      setModelBusy(false);
    }
  };

  const removeSavedModel = async (modelId: string) => {
    if (!activeModelsKey || !getIdToken || modelBusy) return;
    setModelBusy(true);
    setModelError('');
    try {
      const updated = await removeVaultKeyModel(
        await getIdToken(),
        activeModelsKey,
        modelId,
      );
      replaceKey(activeModelsKey, updated);
      setStatusMessage(t('settings.modelRemoved'));
    } catch {
      setModelError(t('settings.modelRemoveFailed'));
    } finally {
      setModelBusy(false);
    }
  };

  const handleSaveSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formOwnerId !== userIdRef.current || !formMode) return;
    const requestedUserId = userIdRef.current;
    const needsProvider = formMode === 'create' ||
      (formMode === 'edit' && Boolean(editingKey && !editingKey.providerName));
    if (needsProvider && !selectedProvider) {
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
          ...(!editingKey.providerName && selectedProvider
            ? { provider: selectedProvider.id }
            : {}),
        });
        if (userIdRef.current !== requestedUserId) return;
        replaceKey(editingKey, updatedKey);
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
        setActiveModelsTarget({ provider: savedKey.provider, id: savedKey.id });
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
      {activeModelsKey ? (
        <div className="api-key-models-screen" dir={isRtl ? 'rtl' : 'ltr'}>
          <header className="api-key-models-heading">
            <button
              className="secret-screen-back"
              type="button"
              onClick={() => {
                setActiveModelsTarget(null);
                setModelError('');
                setManualModelOpen(false);
                setManualModelId('');
              }}
            >
              <ArrowLeft size={19} aria-hidden="true" />
              <span>{t('settings.backToApiKeys')}</span>
            </button>
            <h1>{activeModelsKey.providerName}</h1>
          </header>
          <label className="secret-model-search">
            <Search size={19} aria-hidden="true" />
            <input
              type="search"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.currentTarget.value)}
              placeholder={t('settings.searchModels')}
              aria-label={t('settings.searchModels')}
              dir="ltr"
            />
          </label>
          {modelError && <p className="secret-error-line" role="alert">{modelError}</p>}
          {statusMessage && <p className="secret-status-line" role="status">{statusMessage}</p>}
          <ul className="secret-model-list" aria-label={t('settings.savedModels')}>
            {visibleModels.length === 0 ? (
              <li className="secret-model-empty">{t('settings.noSavedModels')}</li>
            ) : visibleModels.map((modelId) => (
              <li key={modelId}>
                <code dir="ltr">{modelId}</code>
                <button
                  className="secret-model-selected"
                  type="button"
                  disabled={!getIdToken || modelBusy}
                  aria-label={t('settings.removeModelAria', { model: modelId })}
                  onClick={() => void removeSavedModel(modelId)}
                >
                  {modelBusy
                    ? <LoaderCircle className="loading-spinner" size={18} aria-hidden="true" />
                    : <Check size={19} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
          {manualModelOpen ? (
            <form className="secret-manual-model-form" onSubmit={(event) => void saveManualModel(event)}>
              <label className="secret-sheet-field">
                <span>{t('settings.modelIdLabel')}</span>
                <input
                  autoFocus
                  value={manualModelId}
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  placeholder={t('settings.modelIdPlaceholder')}
                  onChange={(event) => {
                    setManualModelId(event.currentTarget.value);
                    setModelError('');
                  }}
                />
              </label>
              <div className="secret-sheet-actions">
                <button
                  className="confirmation-button confirmation-cancel"
                  type="button"
                  disabled={modelBusy}
                  onClick={() => {
                    setManualModelOpen(false);
                    setManualModelId('');
                    setModelError('');
                  }}
                >
                  {t('settings.cancel')}
                </button>
                <button
                  className="confirmation-button confirmation-secret-save"
                  type="submit"
                  disabled={!getIdToken || modelBusy || !manualModelId.trim()}
                >
                  {modelBusy && <LoaderCircle className="confirmation-spinner" size={17} aria-hidden="true" />}
                  {t('settings.addModel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              className="secret-add-model-button"
              type="button"
              onClick={() => {
                setManualModelOpen(true);
                setModelError('');
              }}
            >
              <Plus size={19} aria-hidden="true" />
              {t('settings.addModelManually')}
            </button>
          )}
        </div>
      ) : (
      <>
      <header className="secrets-panel-heading">
        <h1 id="api-keys-title">{t('settings.apiKeysTitle')}</h1>
        <button
          className="factory-primary-button secrets-new-button"
          type="button"
          onClick={openNewSecret}
          disabled={!getIdToken || hasReachedSecretLimit || loadingForUser}
          title={hasReachedSecretLimit ? t('settings.secretLimitReached') : undefined}
          data-testid="button-new-api-key"
        >
          <Plus size={17} aria-hidden="true" />
          {t('settings.newSecret')}
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
          <li className="secrets-empty-state">
            <div className="secrets-empty-shield" aria-hidden="true">
              <svg viewBox="0 0 160 160" fill="none">
                <ellipse cx="80" cy="84" rx="71" ry="29" transform="rotate(-25 80 84)" stroke="currentColor" strokeWidth="2" opacity=".5" />
                <path d="M80 20 119 36v31c0 28-15 48-39 63C56 115 41 95 41 67V36l39-16Z" fill="currentColor" fillOpacity=".12" />
                <path d="M80 20 119 36v31c0 28-15 48-39 63C56 115 41 95 41 67V36l39-16Z" stroke="currentColor" strokeWidth="5" />
                <rect x="64" y="69" width="32" height="27" rx="6" fill="currentColor" />
                <path d="M70 69V59a10 10 0 0 1 20 0v10" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                <circle cx="80" cy="81" r="3" fill="var(--app-bg)" />
                <path d="M80 84v6" stroke="var(--app-bg)" strokeWidth="3" strokeLinecap="round" />
                <circle cx="23" cy="107" r="4" fill="currentColor" />
                <circle cx="133" cy="55" r="4" fill="currentColor" />
              </svg>
            </div>
            <strong>{t('settings.emptyKeysTitle')}</strong>
            <span>{t('settings.emptyKeys')}</span>
            <button
              className="factory-primary-button secrets-empty-new-button"
              type="button"
              onClick={openNewSecret}
              disabled={!getIdToken || loadingForUser}
            >
              <Plus size={17} aria-hidden="true" />
              {t('settings.newSecret')}
            </button>
          </li>
        )}
        {visibleKeys.map((key) => {
          const menuId = `${key.provider}:${key.id}`;
          const displayName = key.providerName ?? key.modelName ?? key.label;
          return (
            <li className="secrets-row" key={menuId}>
              <ProviderAvatar />
              <div className="secrets-entry">
                <strong dir="ltr">{displayName}</strong>
                <code dir="ltr">
                  {revealedValue?.id === key.id ? revealedValue.value : key.maskedValue}
                </code>
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
                <div className="secret-menu-wrap">
                  <button
                    className="secret-icon-button"
                    type="button"
                    disabled={!getIdToken || deletingId === key.id}
                    aria-label={t('settings.apiKeyActions')}
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === menuId}
                    ref={(node) => {
                      if (node) menuButtonRefs.current.set(menuId, node);
                      else menuButtonRefs.current.delete(menuId);
                    }}
                    onClick={() => toggleKeyMenu(menuId)}
                    data-testid={`button-api-key-menu-${key.id}`}
                  >
                    <MoreVertical size={18} aria-hidden="true" />
                  </button>
                  {openMenuId === menuId && menuPosition && typeof document !== 'undefined' &&
                    createPortal(
                    <div
                      ref={actionMenuRef}
                      className="secret-action-menu"
                      role="menu"
                      dir={isRtl ? 'rtl' : 'ltr'}
                      style={{
                        position: 'fixed',
                        top: menuPosition.top,
                        left: menuPosition.left,
                        width: menuPosition.width,
                        zIndex: 10000,
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openEditSecret(key)}
                      >
                        <Pencil size={17} aria-hidden="true" />
                        {t('settings.apiKeyMenuEdit')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleShowModels(key)}
                      >
                        <Layers size={17} aria-hidden="true" />
                        {t('settings.showModels')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!getIdToken || revealingId === key.id}
                        onClick={() => {
                          closeKeyMenu();
                          void copySecretValue(key);
                        }}
                      >
                        <Copy size={17} aria-hidden="true" />
                        {t('settings.copyKeyAction')}
                      </button>
                      <button
                        className="secret-action-delete"
                        type="button"
                        role="menuitem"
                        disabled={!getIdToken || deletingId === key.id}
                        onClick={() => {
                          closeKeyMenu();
                          setPendingDelete(key);
                          setPendingDeleteOwnerId(userId);
                          deleteDialogRef.current?.open(
                            t('settings.confirmDeleteSecret', { name: displayName }),
                          );
                        }}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                        {t('settings.deleteAction')}
                      </button>
                    </div>,
                    document.body,
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      </>
      )}
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
                  {formMode === 'edit' ? t('settings.editApiKeyTitle') : t('settings.newSecret')}
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
                {formMode === 'edit' && editingKey?.providerName ? (
                  <input
                    value={editingKey.providerName}
                    readOnly
                    dir="ltr"
                    data-testid="input-api-key-provider-readonly"
                  />
                ) : (
                  <>
                    <input
                      id="secret-provider-input"
                      value={providerInput}
                      list={providerQuery ? 'api-key-provider-options' : undefined}
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
                    {providerQuery && (
                      <datalist id="api-key-provider-options">
                        {providerOptions.filter((provider) =>
                          provider.label.toLocaleLowerCase().includes(providerQuery.trim().toLocaleLowerCase()) ||
                          provider.id.toLocaleLowerCase().includes(providerQuery.trim().toLocaleLowerCase()),
                        ).map((provider) => (
                          <option key={provider.id} value={provider.label} />
                        ))}
                      </datalist>
                    )}
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
                    ((formMode === 'create' ||
                      (formMode === 'edit' && Boolean(editingKey && !editingKey.providerName))) &&
                      !selectedProvider) ||
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
                    : t('settings.saveSecret')}
                </button>
              </div>
            </form>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <DialogPrimitive.Root
        open={Boolean(providerSetupKey)}
        onOpenChange={(open) => {
          if (!open) setProviderSetupKey(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="confirmation-overlay" />
          <DialogPrimitive.Content
            className="confirmation-dialog secret-provider-needed"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <DialogPrimitive.Title className="confirmation-title">
              {t('settings.providerFirstTitle')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="confirmation-copy">
              {t('settings.providerFirstDescription')}
            </DialogPrimitive.Description>
            <div className="secret-sheet-actions">
              <button
                className="confirmation-button confirmation-cancel"
                type="button"
                onClick={() => setProviderSetupKey(null)}
              >
                {t('settings.cancel')}
              </button>
              <button
                className="confirmation-button confirmation-secret-save"
                type="button"
                onClick={() => {
                  const key = providerSetupKey;
                  setProviderSetupKey(null);
                  if (key) openEditSecret(key);
                }}
              >
                {t('settings.apiKeyMenuEdit')}
              </button>
            </div>
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
