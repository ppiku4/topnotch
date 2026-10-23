import React from 'react';
import { createRoot } from 'react-dom/client';
import { bridge } from './bridge.js';
import { MotionConfig } from 'framer-motion';
import './styles.css';
import './a11y.css';

// Load only the screen used by this window. Vite also loads its CSS chunk.
const PAGES = {
  settings: () => import('./Settings.jsx'),
  wheel: () => import('./Wheel.jsx'),
  editor: () => import('./Editor.jsx'),
  setup: () => import('./Setup.jsx')
};
const page = window.location.hash.slice(1).split(/[?&]/)[0];
const pageModule = (PAGES[page] || (() => import('./Island.jsx')))();
const Page = React.lazy(() => pageModule);
document.documentElement.classList.add(PAGES[page] ? `is-${page}` : 'is-notch');

function Ready({ children }) {
  React.useEffect(() => { bridge.rendererReady?.(); }, []);
  return children;
}

// reducedMotion="user": with the OS animation setting off, springs that
// move or scale things are skipped and only fades remain.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <React.Suspense fallback={null}><Ready><Page /></Ready></React.Suspense>
    </MotionConfig>
  </React.StrictMode>
);
