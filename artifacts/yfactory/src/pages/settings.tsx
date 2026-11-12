import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChevronDown,
  HardDrive,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import SecretsPanel from '@/components/secrets-panel';
import {
  loadKeyPoolStatus,
  loadProviders,
  loadStorageUsage,
  type KeyPoolProviderStatus,
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
  const [storageUsage, setStorageUsage] = useState<{
    configured: boolean;
    usedBytes: number | null;
    limitBytes: number | null;
  } | null>(null);
  const [storageUsageError, setStorageUsageError] = useState('');
  const [keyPoolStatus, setKeyPoolStatus] = useState<KeyPoolProviderStatus[] | null>(null);
  const [keyPoolStatusError, setKeyPoolStatusError] = useState('');
  const [cloudinaryEnabled, setCloudinaryEnabled] = useState(true);
  const signOutDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const deleteAccountDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const displayName = user.displayName || user.email || 'YFactory creator';
  const initials = (user.displayName || user.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    if (!getIdToken) {
      setKeyPoolStatusError(t('settings.keyPoolLoadFailed'));
      return;
    }
    let active = true;
    void (async () => {
      try {
        const token = await getIdToken();
        const [providersResult, usageResult, keyStatusResult] = await Promise.allSettled([
          loadProviders(token),
          loadStorageUsage(token),
          loadKeyPoolStatus(token),
        ]);
        if (!active) return;
        if (providersResult.status === 'fulfilled') {
          setCloudinaryEnabled(
            providersResult.value.some((provider) => provider.id === 'cloudinary' && provider.enabled),
          );
        }
        if (keyStatusResult.status === 'fulfilled') {
          setKeyPoolStatus(keyStatusResult.value);
          setKeyPoolStatusError('');
        } else {
          setKeyPoolStatus(null);
          setKeyPoolStatusError(t('settings.keyPoolLoadFailed'));
        }
        if (usageResult.status === 'rejected') {
          setStorageUsage(null);
          setStorageUsageError(t('settings.storageLoadFailed'));
          return;
        }
        setStorageUsage(usageResult.value);
        setStorageUsageError('');
      } catch (loadError) {
        if (active) {
          setStorageUsageError(t('settings.storageLoadFailed'));
          setKeyPoolStatusError(t('settings.keyPoolLoadFailed'));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, t]);

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
            onClick={() => signOutDialogRef.current?.open()}
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

          <SecretsPanel getIdToken={getIdToken} />
          <details className="account-panel key-pool-status-panel" data-testid="key-pool-status-panel">
            <summary className="key-pool-status-summary">
              <h2>{t('settings.keyPoolTitle')}</h2>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className="key-pool-status-content">
              {keyPoolStatusError ? (
                <p className="settings-inline-error" role="status">{keyPoolStatusError}</p>
              ) : !keyPoolStatus ? (
                <p role="status">{t('settings.keyPoolLoading')}</p>
              ) : keyPoolStatus.filter((provider) => provider.credentialCount > 0).length === 0 ? (
                <p>{t('settings.keyPoolEmpty')}</p>
              ) : (
                <div className="key-pool-provider-list">
                  {keyPoolStatus.filter((provider) => provider.credentialCount > 0).map((provider) => (
                  <div className="key-pool-provider" key={provider.provider}>
                    <div className="key-pool-provider-heading">
                      <strong>{t(`settings.keyPoolProviders.${provider.provider}`)}</strong>
                      <span>{t('settings.keyPoolCount', { count: provider.credentialCount })}</span>
                    </div>
                    {provider.credentials.length > 0 && (
                      <ul>
                        {provider.credentials.map((credential) => (
                          <li key={`${provider.provider}-${credential.index}`}>
                            <span>{t('settings.keyPoolIndex', { index: credential.index })}</span>
                            <span>
                              {credential.state === 'ready'
                                ? t('settings.statusReady')
                                : credential.state === 'disabled'
                                  ? t('settings.statusDisabled')
                                  : t('settings.keyPoolCooldownUntil', {
                                      time: typeof credential.until === 'number'
                                        ? new Date(credential.until).toLocaleString(locale)
                                        : '—',
                                    })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  ))}
                </div>
              )}
            </div>
          </details>
          <section className="account-panel storage-usage-panel" aria-labelledby="cloudinary-usage-title">
            <div className="section-kicker"><HardDrive size={14} /> {t('settings.cloudinaryStorage')}</div>
            <h2 id="cloudinary-usage-title">{t('settings.storageUsage')}</h2>
            {!storageUsage && storageUsageError ? (
              <p className="settings-inline-error">{storageUsageError}</p>
            ) : !cloudinaryEnabled ? (
              <p>{t('settings.storageDisabled')}</p>
            ) : storageUsage && !storageUsage.configured ? (
              <p>{t('settings.storageCredentialsMissing')}</p>
            ) : storageUsage?.configured && storageUsage.usedBytes !== null && storageUsage.limitBytes !== null ? (
              <>
                <div className="storage-usage-copy">
                  <span>{formatBytes(storageUsage.usedBytes)} {t('settings.storageUsed')}</span>
                  <span>{formatBytes(storageUsage.limitBytes)} {t('settings.storageLimit')}</span>
                </div>
                <div className="factory-storage-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) * 100))}>
                  <span className={storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) >= 0.8 ? 'storage-warning' : ''} style={{ width: `${Math.min(100, storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) * 100)}%` }} />
                </div>
                {storageUsage.usedBytes / Math.max(storageUsage.limitBytes, 1) >= 0.8 && <p className="settings-inline-warning">{t('settings.storageWarning')}</p>}
              </>
            ) : (
              <p>{t('settings.storageUsageUnavailable')}</p>
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
              onClick={() => deleteAccountDialogRef.current?.open()}
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
        ref={signOutDialogRef}
        title={t('confirmation.signOutTitle')}
        description={t('confirmation.logoutDescription')}
        confirmLabel={t('confirmation.signOut')}
        busyLabel={t('confirmation.loggingOut')}
        cancelLabel={t('confirmation.cancel')}
        failureMessage={t('confirmation.logoutFailed')}
        onConfirm={onLogout}
        dir={isRtl ? 'rtl' : 'ltr'}
      />
      <ConfirmActionDialog
        ref={deleteAccountDialogRef}
        title={t('confirmation.deleteTitle')}
        description={t('confirmation.deleteDescription')}
        confirmLabel={t('confirmation.deleteConfirm')}
        busyLabel={t('confirmation.deleting')}
        cancelLabel={t('confirmation.cancel')}
        failureMessage={t('confirmation.deleteFailed')}
        recentLoginMessage={t('confirmation.recentLogin')}
        onConfirm={onDeleteAccount}
        danger
        confirmationPhrase="DELETE"
        confirmationPhraseLabel={t('confirmation.typeDelete')}
        dir={isRtl ? 'rtl' : 'ltr'}
      />
    </main>
  );
}
