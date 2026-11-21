import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Bell,
  Globe2,
  HardDrive,
  Info,
  LogOut,
  LockKeyhole,
  Moon,
  Sparkles,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import ConfirmActionDialog, {
  type ConfirmActionDialogHandle,
} from '@/components/confirm-action-dialog';
import LanguagePickerDialog from '@/components/language-picker-dialog';
import SecretsPanel from '@/components/secrets-panel';
import {
  loadKeyPoolStatus,
  loadProviders,
  loadStorageUsage,
  type KeyPoolProviderStatus,
} from '@/lib/apiKeyVault';
import {
  getNotificationAvailability,
  readAppTheme,
  readNotificationsEnabled,
  toggleAppNotifications,
  writeAppTheme,
  type AppTheme,
  type NotificationAvailability,
} from '@/lib/appPreferences';
import {
  readChatAutoNavigate,
  writeChatAutoNavigate,
} from '@/lib/chatAgent';
import {
  changeAppLanguage,
  findLanguageOption,
  isRtlLanguage,
} from '@/lib/languages';
import './auth-pages.css';

export type SettingsUser = {
  uid: string | null;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

export type SettingsPageProps = {
  user: SettingsUser;
  getIdToken?: () => Promise<string>;
  initialSubview?: 'api-keys' | null;
  initialModelTarget?: { provider: string; id: string } | null;
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

function getExtraSettingsCopy(lang: string) {
  if (lang.startsWith('ar')) {
    return {
      autoNavTitle: `الانتقال التلقائي من الشات`,
      autoNavOn: `ينقلك تلقائياً لصفحة الصور أو قصصي عند تنفيذ الأمر`,
      autoNavOff: `تبقى داخل الشات أثناء التوليد والتنفيذ`,
      themeDark: `الوضع الداكن`,
      themeLight: `الوضع الفاتح`,
      themeHintDark: `مظهر داكن مريح مع لمسات ذهبية`,
      themeHintLight: `مظهر فاتح واضح للقراءة النهارية`,
      notifOn: `مفعّلة — تصلك تنبيهات عند اكتمال التوليد`,
      notifOff: `تنبيهك عند اكتمال توليد الصور والمشاهد`,
      notifDenied: `محظورة من إعدادات المتصفح`,
      notifUnsupported: `غير مدعومة في هذا المتصفح`,
      notifTestTitle: `YFactory AI`,
      notifTestBody: `تم تفعيل الإشعارات بنجاح.`,
      aboutDetails: `منصة ويب متكاملة لإنتاج القصص والصور والمحادثة بالذكاء الاصطناعي بنظام مفاتيح المستخدم المشفّرة (BYOK).`,
      premiumDetails: `تعمل المنصة حالياً بنظام BYOK (تضيف مفاتيحك الخاصة وتتحكم بتكلفتك مباشرةً). خطط الاشتراك والمزايا المتقدمة ستتوفر عند الإطلاق الرسمي.`,
    };
  }
  if (lang.startsWith('fr')) {
    return {
      autoNavTitle: `Navigation auto depuis le chat`,
      autoNavOn: `Ouvre Images ou Mes histoires lors d'une action`,
      autoNavOff: `Reste dans le chat pendant l'exécution`,
      themeDark: `Mode sombre`,
      themeLight: `Mode clair`,
      themeHintDark: `Interface sombre avec accents dorés`,
      themeHintLight: `Interface claire et lumineuse`,
      notifOn: `Activées — alertes à la fin des générations`,
      notifOff: `Être alerté quand vos images sont prêtes`,
      notifDenied: `Bloqué dans les paramètres du navigateur`,
      notifUnsupported: `Non pris en charge sur ce navigateur`,
      notifTestTitle: `YFactory AI`,
      notifTestBody: `Les notifications sont maintenant activées.`,
      aboutDetails: `Plateforme web unifiée pour le chat IA, les images et vos histoires avec gestion chiffrée de vos clés API (BYOK).`,
      premiumDetails: `YFactory fonctionne en mode BYOK avec vos propres clés API. Les formules avancées arriveront lors du lancement public.`,
    };
  }
  if (lang.startsWith('es')) {
    return {
      autoNavTitle: `Navegación auto desde Chat`,
      autoNavOn: `Abre Imagen o Mis historias al ejecutar acciones`,
      autoNavOff: `Permanecer en Chat durante la generación`,
      themeDark: `Modo oscuro`,
      themeLight: `Modo claro`,
      themeHintDark: `Tema oscuro elegante con detalles dorados`,
      themeHintLight: `Tema claro y nítido para el día`,
      notifOn: `Activadas — avisos al completar generaciones`,
      notifOff: `Recibe avisos cuando tus imágenes estén listas`,
      notifDenied: `Bloqueadas en el navegador`,
      notifUnsupported: `No compatible en este navegador`,
      notifTestTitle: `YFactory AI`,
      notifTestBody: `Las notificaciones están activadas.`,
      aboutDetails: `Plataforma web integrada de chat IA, imágenes e historias con almacenamiento cifrado de tus claves API (BYOK).`,
      premiumDetails: `YFactory funciona con tus propias claves API (BYOK). Los planes avanzados estarán disponibles en el lanzamiento público.`,
    };
  }
  return {
    autoNavTitle: `Auto-navigate from Chat`,
    autoNavOn: `Jump to Image or My Stories when Chat runs an action`,
    autoNavOff: `Stay inside Chat while actions run`,
    themeDark: `Dark Mode`,
    themeLight: `Light Mode`,
    themeHintDark: `Dark workspace with gold accents`,
    themeHintLight: `Bright light theme across all pages`,
    notifOn: `Enabled — alerts when generations finish`,
    notifOff: `Notify when image or story generation completes`,
    notifDenied: `Blocked in browser permissions`,
    notifUnsupported: `Unsupported in this browser`,
    notifTestTitle: `YFactory AI`,
    notifTestBody: `Notifications are now enabled.`,
    aboutDetails: `Unified web studio for AI chat, image generation, and story production powered by encrypted BYOK user API keys.`,
    premiumDetails: `YFactory runs on BYOK (bring your own API keys). Subscription plans and expanded key slots will launch with the public release.`,
  };
}

export default function SettingsPage({
  user,
  getIdToken,
  initialSubview = null,
  initialModelTarget = null,
  onBack,
  onLogout,
  onDeleteAccount,
}: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const isRtl = isRtlLanguage(locale);
  const currentLang = findLanguageOption(locale);
  const extraCopy = getExtraSettingsCopy(locale);

  const [storageUsage, setStorageUsage] = useState<{
    configured: boolean;
    usedBytes: number | null;
    limitBytes: number | null;
  } | null>(null);
  const [storageUsageError, setStorageUsageError] = useState('');
  const [keyPoolStatus, setKeyPoolStatus] = useState<KeyPoolProviderStatus[] | null>(null);
  const [keyPoolStatusError, setKeyPoolStatusError] = useState('');
  const [cloudinaryEnabled, setCloudinaryEnabled] = useState(true);
  const [chatAutoNavigate, setChatAutoNavigate] = useState<boolean>(readChatAutoNavigate);
  const [theme, setTheme] = useState<AppTheme>(readAppTheme);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(readNotificationsEnabled);
  const [notifStatus, setNotifStatus] = useState<NotificationAvailability>(getNotificationAvailability);
  const [notifBusy, setNotifBusy] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [settingsSubview, setSettingsSubview] = useState<'about' | 'premium' | 'api-keys' | null>(initialSubview);

  const signOutDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const deleteAccountDialogRef = useRef<ConfirmActionDialogHandle | null>(null);
  const displayName = user.displayName || user.email || t('settings.creator');
  const initials = (user.displayName || user.email || 'Y')
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const toggleChatAutoNavigate = () => {
    setChatAutoNavigate((current) => {
      const next = !current;
      writeChatAutoNavigate(next);
      return next;
    });
  };

  const handleToggleTheme = () => {
    setTheme((current) => {
      const next: AppTheme = current === 'dark' ? 'light' : 'dark';
      writeAppTheme(next);
      return next;
    });
  };

  const handleToggleNotifications = async () => {
    if (notifBusy || notifStatus === 'unsupported') return;
    setNotifBusy(true);
    try {
      const result = await toggleAppNotifications(!notificationsEnabled, {
        title: extraCopy.notifTestTitle,
        body: extraCopy.notifTestBody,
      });
      setNotificationsEnabled(result.enabled);
      setNotifStatus(result.status);
    } finally {
      setNotifBusy(false);
    }
  };

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
      } catch {
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

  if (settingsSubview === 'api-keys') {
    return (
      <main className="auth-screen settings-screen" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="settings-shell">
          <header className="settings-topbar">
            <button
              className="settings-back"
              type="button"
              onClick={() => setSettingsSubview(null)}
              data-testid="button-secrets-back"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>{t('settings.backToSettings')}</span>
            </button>
            <div className="settings-brand" aria-label="YFactory">
              <span className="settings-brand-mark">Y</span>
              <span>YFactory</span>
            </div>
            <span className="settings-back-spacer" aria-hidden="true" />
          </header>
          <div className="settings-content api-keys-page-content">
            <SecretsPanel
              userId={user.uid}
              getIdToken={getIdToken}
              initialModelTarget={initialModelTarget}
            />
          </div>
        </div>
      </main>
    );
  }

  if (settingsSubview === 'about' || settingsSubview === 'premium') {
    const isPremium = settingsSubview === 'premium';
    return (
      <main className="auth-screen settings-screen" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="settings-shell">
          <header className="settings-topbar">
            <button
              className="settings-back"
              type="button"
              onClick={() => setSettingsSubview(null)}
              data-testid="button-settings-subpage-back"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              <span>{t('settings.backToSettings')}</span>
            </button>
            <div className="settings-brand" aria-label="YFactory">
              <span className="settings-brand-mark">Y</span>
              <span>YFactory</span>
            </div>
            <span className="settings-back-spacer" aria-hidden="true" />
          </header>
          <section className="settings-info-card" data-testid={`settings-info-${settingsSubview}`}>
            <span className="settings-info-icon" aria-hidden="true">
              {isPremium ? <Sparkles size={24} /> : <Info size={24} />}
            </span>
            <h1>{isPremium ? t('settings.premiumFeatures') : t('settings.aboutYFactory')}</h1>
            <p>{isPremium ? extraCopy.premiumDetails : extraCopy.aboutDetails}</p>
            <span className="settings-status-pill">
              {isPremium ? t('settings.comingSoon') : 'YFactory AI · Web Studio'}
            </span>
          </section>
        </div>
      </main>
    );
  }

  const notifHint =
    notifStatus === 'unsupported'
      ? extraCopy.notifUnsupported
      : notifStatus === 'denied'
        ? extraCopy.notifDenied
        : notificationsEnabled
          ? extraCopy.notifOn
          : extraCopy.notifOff;

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
              <div className="settings-eyebrow"><span /> {t('settings.accountEyebrow')}</div>
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
              <span className="account-verified"><ShieldCheck size={15} /> <span>{t('settings.signedIn')}</span></span>
            </div>
          </section>

          <section className="settings-preferences-panel" aria-label={t('settings.language')}>
            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                <Globe2 size={19} aria-hidden="true" />
                <strong>{t('settings.language')}</strong>
              </div>
              <button
                type="button"
                className="settings-language-trigger"
                onClick={() => setLanguagePickerOpen(true)}
                aria-haspopup="dialog"
                data-testid="select-language"
              >
                <span dir="auto">{currentLang.nativeName}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className="settings-preferences-panel" aria-label={t('settings.apiKeysTitle')}>
            <button
              className="settings-preference-link settings-secrets-link"
              type="button"
              onClick={() => setSettingsSubview('api-keys')}
              data-testid="button-open-api-keys"
            >
              <span className="settings-preference-copy">
                <LockKeyhole size={19} aria-hidden="true" />
                <span className="settings-secrets-link-copy">
                  <strong>{t('settings.apiKeysTitle')}</strong>
                  <small>{t('settings.apiKeysEntryDescription')}</small>
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </section>

          <section className="settings-preferences-panel" aria-label={t('settings.preferences')}>
            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                <ArrowUpRight size={19} aria-hidden="true" />
                <span className="settings-secrets-link-copy">
                  <strong>{extraCopy.autoNavTitle}</strong>
                  <small>
                    {chatAutoNavigate ? extraCopy.autoNavOn : extraCopy.autoNavOff}
                  </small>
                </span>
              </div>
              <div className="settings-preference-state">
                <button
                  type="button"
                  className={chatAutoNavigate ? 'settings-switch is-on' : 'settings-switch'}
                  role="switch"
                  aria-checked={chatAutoNavigate}
                  aria-label={extraCopy.autoNavTitle}
                  onClick={toggleChatAutoNavigate}
                  data-testid="toggle-chat-auto-navigate"
                >
                  <span />
                </button>
              </div>
            </div>

            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                <Bell size={19} aria-hidden="true" />
                <span className="settings-secrets-link-copy">
                  <strong>{t('settings.notifications')}</strong>
                  <small>{notifHint}</small>
                </span>
              </div>
              <div className="settings-preference-state">
                <button
                  type="button"
                  className={notificationsEnabled ? 'settings-switch is-on' : 'settings-switch'}
                  role="switch"
                  aria-checked={notificationsEnabled}
                  aria-label={t('settings.notifications')}
                  disabled={notifBusy || notifStatus === 'unsupported'}
                  onClick={() => void handleToggleNotifications()}
                  data-testid="toggle-notifications"
                >
                  <span />
                </button>
              </div>
            </div>

            <div className="settings-preference-row">
              <div className="settings-preference-copy">
                {theme === 'dark' ? (
                  <Moon size={19} aria-hidden="true" />
                ) : (
                  <Sun size={19} aria-hidden="true" />
                )}
                <span className="settings-secrets-link-copy">
                  <strong>
                    {theme === 'dark' ? extraCopy.themeDark : extraCopy.themeLight}
                  </strong>
                  <small>
                    {theme === 'dark' ? extraCopy.themeHintDark : extraCopy.themeHintLight}
                  </small>
                </span>
              </div>
              <div className="settings-preference-state">
                <button
                  type="button"
                  className={theme === 'dark' ? 'settings-switch is-on' : 'settings-switch'}
                  role="switch"
                  aria-checked={theme === 'dark'}
                  aria-label={t('settings.darkMode')}
                  onClick={handleToggleTheme}
                  data-testid="toggle-dark-mode"
                >
                  <span />
                </button>
              </div>
            </div>

            <button
              className="settings-preference-link"
              type="button"
              onClick={() => setSettingsSubview('about')}
              data-testid="button-about-yfactory"
            >
              <span className="settings-preference-copy">
                <Info size={19} aria-hidden="true" />
                <strong>{t('settings.aboutYFactory')}</strong>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              className="settings-preference-link"
              type="button"
              onClick={() => setSettingsSubview('premium')}
              data-testid="button-premium-features"
            >
              <span className="settings-preference-copy">
                <Sparkles size={19} aria-hidden="true" />
                <strong>{t('settings.premiumFeatures')}</strong>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </section>

          <details className="account-panel key-pool-status-panel" data-testid="key-pool-status-panel" hidden>
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
          <span>{t('settings.creatorWorkspace')}</span>
        </footer>
      </div>

      <LanguagePickerDialog
        open={languagePickerOpen}
        currentCode={currentLang.code}
        onClose={() => setLanguagePickerOpen(false)}
        onSelect={(lang) => changeAppLanguage(lang.code)}
      />

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
