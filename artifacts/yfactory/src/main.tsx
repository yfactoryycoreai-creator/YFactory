import { createRoot } from 'react-dom/client';

import './i18n';
import { applyAppTheme, readAppTheme } from '@/lib/appPreferences';
import { initLanguageDirectionSync } from '@/lib/languages';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import './theme.css';

applyAppTheme(readAppTheme());
initLanguageDirectionSync();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: () => undefined,
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
