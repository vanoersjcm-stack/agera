import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { initAuth } from './auth';
import { t, useLanguage } from './i18n';
import { applyTheme } from './theme';
import './styles.css';

applyTheme();

/** Remounts the app when the language changes, so every label is rendered again without a page reload. */
function Root() {
  const language = useLanguage();
  return (
    <ErrorBoundary>
      <App key={language} />
    </ErrorBoundary>
  );
}

const root = createRoot(document.getElementById('root')!);
initAuth().then(
  () =>
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>,
    ),
  () => root.render(<p className="error">{t("Could not reach the login service.")}</p>),
);
