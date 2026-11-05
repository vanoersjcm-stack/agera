import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAuth } from './auth';
import { t } from './i18n';
import { applyTheme } from './theme';
import './styles.css';

applyTheme();

const root = createRoot(document.getElementById('root')!);
initAuth().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  () => root.render(<p className="error">{t("Could not reach the login service.")}</p>),
);
