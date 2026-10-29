import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
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
  const isUnauthorizedDomain = error === 'auth/unauthorized-domain';

  return (
    <main className="auth-screen login-screen" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="auth-orbit auth-orbit-top" aria-hidden="true" />
      <div className="auth-orbit auth-orbit-bottom" aria-hidden="true" />
      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 78 64" role="presentation">
            <defs>
              <linearGradient id="yfactory-left-arm" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#11b9ff" />
                <stop offset="1" stopColor="#2877ff" />
              </linearGradient>
              <linearGradient id="yfactory-right-arm" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2d82ff" />
                <stop offset="1" stopColor="#7543f6" />
              </linearGradient>
              <linearGradient id="yfactory-stem" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#167cff" />
                <stop offset="1" stopColor="#713bf0" />
              </linearGradient>
            </defs>
            <path d="M2 0h21l23 31H31z" fill="url(#yfactory-left-arm)" />
            <path d="M43 0h33L53 31H31z" fill="url(#yfactory-right-arm)" />
            <path d="M30 25h22v39H37z" fill="url(#yfactory-stem)" />
          </svg>
        </div>
        <div className="login-wordmark" aria-label="YFactory">
          <span>Y</span>Factory
        </div>
        <h1 id="login-heading">{t('auth.welcome')}</h1>
        <p className="login-tagline">{t('auth.tagline')}</p>

        {error && (
          <div className="auth-error" role="alert" data-testid="status-login-error">
            {isConfigError
              ? t('auth.firebaseConfigError')
              : isUnauthorizedDomain
                ? t('auth.unauthorizedDomainError', {
                    domain: typeof window === 'undefined' ? '' : window.location.hostname,
                  })
              : t('auth.signInError', { code: error })}
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
          <svg
            className="google-mark"
            viewBox="0 0 48 48"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.72 6C44.42 37.98 46.98 31.88 46.98 24.55z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.92-2.15 15.89-5.8l-7.72-6c-2.15 1.45-4.91 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.97 23.97 0 0 0 0 21.56z"
            />
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
          </svg>
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
