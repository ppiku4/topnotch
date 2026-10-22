import React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import Island from './Island.jsx';
import Settings from './Settings.jsx';
import Wheel from './Wheel.jsx';
import Editor from './Editor.jsx';
import Setup from './Setup.jsx';
import './styles.css';
import './dashboard.css';
import './lyrics.css';
import './settings.css';
import './wheel.css';
import './a11y.css';

// One bundle, one page per window: #settings, #wheel, #editor, #setup or the notch.
const PAGES = { settings: Settings, wheel: Wheel, editor: Editor, setup: Setup };
const page = window.location.hash.slice(1).split(/[?&]/)[0];
const Page = PAGES[page] || Island;
document.documentElement.classList.add(PAGES[page] ? `is-${page}` : 'is-notch');

// reducedMotion="user": with the OS animation setting off, springs that
// move or scale things are skipped and only fades remain.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <Page />
    </MotionConfig>
  </React.StrictMode>
);
