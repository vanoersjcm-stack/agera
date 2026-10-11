import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAuth } from './auth';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
initAuth().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  () => root.render(<p className="error">Could not reach the login service.</p>),
);
