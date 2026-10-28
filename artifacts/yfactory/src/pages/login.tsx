import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import { SiGoogle } from 'react-icons/si';
import './auth-pages.css';

export type LoginPageProps = {
  loading: boolean;
  error: string | null;
  onGoogleSignIn: () => void;
};

export default function LoginPage({
  loading,
  error,
  onGoogleSignIn,
}: LoginPageProps) {
  const { t, i18n } = useTranslation();
  const isRtl = (i18n.resolvedLanguage ?? i18n.language) === 'ar';
  const isConfigError = error === 'firebase-config' || error === 'auth/firebase-config';

  return (
    <main className="auth-screen login-screen" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="auth-orbit auth-orbit-top" aria-hidden="true" />
      <div className="auth-orbit auth-orbit-bottom" aria-hidden="true" />
      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-mark" aria-hidden="true">Y</div>
        <div className="login-wordmark" aria-label="YFactory">
          <span>Y</span>Factory
        </div>
        <h1 id="login-heading">{t('auth.welcome')}</h1>
        <p className="login-tagline">{t('auth.tagline')}</p>

        {error && (
          <div className="auth-error" role="alert" data-testid="status-login-error">
            {isConfigError ? t('auth.firebaseConfigError') : t('auth.signInError')}
          </div>
        )}

        <button
          className="google-signin-button"
          type="button"
          onClick={onGoogleSignIn}
          disabled={loading}
          aria-busy={loading}
          data-testid="button-google-sign-in"
        >
          {loading ? (
            <LoaderCircle className="auth-spinner" size={20} aria-hidden="true" />
          ) : (
            <SiGoogle size={20} aria-hidden="true" />
          )}
          <span>{loading ? t('auth.signingIn') : t('auth.continueWithGoogle')}</span>
        </button>
        <p className="login-footnote" aria-live="polite">
          {loading ? t('common.loading') : ''}
        </p>
      </section>
      <span className="auth-corner-note" aria-hidden="true">YFACTORY · CREATIVE STUDIO</span>
    </main>
  );
}
