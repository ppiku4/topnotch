import React from 'react';
import { createRoot } from 'react-dom/client';
import Island from './Island.jsx';
import Settings from './Settings.jsx';
import './styles.css';
import './dashboard.css';
import './lyrics.css';
import './settings.css';

const isSettings = window.location.hash.startsWith('#settings');
document.documentElement.classList.add(isSettings ? 'is-settings' : 'is-notch');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isSettings ? <Settings /> : <Island />}
  </React.StrictMode>
);
