import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './ui/styles/windows.css';
import './preview/preview.css';
import './shell/shell.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
