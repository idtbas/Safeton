import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './ui/styles/windows.css';
import './preview/preview.css';
import './shell/shell.css';
import './shell/system.css';
import './apps/apps.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { captureInstallPrompt } from './os/platform';
import { Root } from './Root';

captureInstallPrompt();

// Offline start for the installed application (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
