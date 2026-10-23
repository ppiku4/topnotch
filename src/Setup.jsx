import './wheel.css';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { bridge, IS_MAC } from './bridge.js';
import { RISE, STAGGER } from './motion.js';

// First-run window: downloads the conversion engines (ffmpeg, LibreOffice,
// the background-removal model) and shows each one's progress. Closing it
// lets the downloads carry on in the background.
function Check() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

export default function Setup() {
  const [engines, setEngines] = useState(null);
  useEffect(() => {
    bridge.getEngines().then(setEngines);
    return bridge.onEngines(setEngines);
  }, []);

  const list = engines || [];
  const done = list.length > 0 && list.every((e) => e.ready);
  const failed = list.some((e) => e.error && !e.ready);
  const busy = list.some((e) => e.progress != null);

  return (
    <div className="setup">
      <header className="setup-head">
        <div className="setup-logo"><span /></div>
        <div>
          <h1>{done ? 'TopNotch is ready' : 'Getting TopNotch ready'}</h1>
          <p>{done
            ? `Every converter is installed. ${IS_MAC ? 'Option' : 'Alt'}+click a file to try the wheel.`
            : 'Downloading the tools the file wheel uses. Each download is checked before it’s used, and nothing leaves your PC.'}</p>
        </div>
      </header>

      <motion.ul className="setup-list" variants={STAGGER} initial="initial" animate="animate">
        {list.map((e) => (
          <motion.li key={e.id} variants={RISE} className={`setup-item${e.ready ? ' is-ready' : ''}${e.error && !e.ready ? ' is-error' : ''}`}>
            <span className="setup-state">
              {e.ready ? <Check /> : e.progress != null ? `${Math.round(e.progress * 100)}%` : e.error ? '!' : '•'}
            </span>
            <div className="setup-text">
              <div className="setup-name">{e.label}<span>{e.size}</span></div>
              <div className="setup-sub">
                {e.ready ? (e.source === 'system' ? 'Already on this computer' : 'Installed')
                  : e.error ? e.error
                    : e.progress != null ? e.about
                      : `Waiting · ${e.about}`}
              </div>
              {e.progress != null && <div className="setup-bar"><span style={{ width: `${Math.round(e.progress * 100)}%` }} /></div>}
            </div>
            {e.error && !e.ready && !busy && <button className="setup-retry" onClick={() => bridge.installEngine(e.id)}>Retry</button>}
          </motion.li>
        ))}
      </motion.ul>

      <footer className="setup-foot">
        {failed && !busy && <button className="setup-button ghost" onClick={() => bridge.installMissingEngines()}>Retry all</button>}
        <span className="setup-spacer" />
        <button className="setup-button" onClick={() => bridge.closeSetup()}>{done ? 'Done' : 'Continue in background'}</button>
      </footer>
    </div>
  );
}
