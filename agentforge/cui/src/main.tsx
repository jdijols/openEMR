import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cal-sans';
import App from './App.js';
import './index.css';

const el =
  document.getElementById('agentforge-panel-root') ??
  document.getElementById('root');
if (el === null) {
  throw new Error('missing #agentforge-panel-root or #root');
}

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
