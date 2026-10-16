import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bridge } from './bridge.js';
import { useConfig } from './hooks.js';
import { SPRING_SNAPPY, SPRING_SOFT } from './motion.js';
import {
  BluetoothIcon, BoltIcon, BookIcon, ClockIcon, CameraIcon, ClipboardIcon, CloseIcon, CoffeeIcon, ExpandIcon, FolderIcon, GlowIcon,
  GridIcon, InfoIcon, LayersIcon, LyricsIcon, MonitorIcon, MusicIcon, PaletteIcon, PinIcon, PointerIcon, PulseIcon,
  RefreshIcon, ShrinkIcon, SlidersIcon, SquareIcon, ThermometerIcon, TrayIcon, WeatherIcon, WheelIcon
} from './icons.jsx';

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersIcon },
  { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
  { id: 'widgets', label: 'Widgets', icon: GridIcon },
  { id: 'tips', label: 'Tips', icon: BookIcon },
  { id: 'about', label: 'About', icon: InfoIcon }
];

const SWATCHES = ['#5ac8fa', '#34c759', '#ffd60a', '#ff9f0a', '#ff453a', '#ff375f', '#bf5af2', '#ffffff'];

// ── Controls ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <button className={`toggle${checked ? ' is-on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <motion.span layout transition={SPRING_SNAPPY} />
    </button>
  );
}

function Segmented({ value, options, onChange, id }) {
  return (
    <div className="segmented">
      {options.map(([key, label]) => (
        <button key={key} className={value === key ? 'is-active' : ''} onClick={() => onChange(key)}>
          {value === key && <motion.span layoutId={`seg-${id}`} className="segmented-thumb" transition={SPRING_SNAPPY} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Row({ icon: Icon, title, sub, children, disabled }) {
  return (
    <div className={`row${disabled ? ' is-disabled' : ''}`}>
      {Icon && <span className="row-icon-box"><Icon /></span>}
      <div className="row-text">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Group({ title, aside, children }) {
  return (
    <section className="group">
      {(title || aside) && <div className="group-head"><h3>{title}</h3>{aside && <span>{aside}</span>}</div>}
      <div className="group-card">{children}</div>
    </section>
  );
}

// Saved on Enter or when the field loses focus, not on every keystroke.
function CityInput({ value }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => { if (draft.trim() !== value) bridge.setConfig({ weatherCity: draft.trim() }); };
  return (
    <input
      className="text-input"
      placeholder="Auto"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

const set = (patch) => bridge.setConfig(patch);
const setFeature = (key) => (on) => bridge.setConfig({ features: { [key]: on } });

// CPU temperature through LibreHardwareMonitor, downloaded on request.
function Sensors() {
  const [status, setStatus] = useState(null);
  const [working, setWorking] = useState(null);
  const [error, setError] = useState('');
  const refresh = () => bridge.sensorsStatus().then(setStatus);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  const run = async (label, action) => {
    setWorking(label);
    setError('');
    const result = await action();
    if (!result?.ok) setError(result?.error?.includes('canceled') || result?.error?.includes('cancelled')
      ? 'Administrator permission was declined.' : result?.error || 'Something went wrong.');
    else if (result.started === false) setError('LibreHardwareMonitor started but its sensor feed is not responding yet.');
    setWorking(null);
    refresh();
  };

  if (!status) return <Row icon={ThermometerIcon} title="CPU temperature" sub="Checking…" />;
  const sub = !status.installed
    ? `Windows doesn't give apps the CPU temperature. This downloads LibreHardwareMonitor ${status.version} (${status.size}, MPL-2.0) from its GitHub release and runs it as administrator. Windows will ask for permission.`
    : status.running
      ? 'LibreHardwareMonitor is running; CPU temperature shows in the System tab. Its data stays on this PC (127.0.0.1 only).'
      : 'Installed but not running. Starting it asks for administrator permission.';
  return (
    <>
      <Row icon={ThermometerIcon} title="CPU temperature" sub={sub}>
        {!status.installed && <button className="button" disabled={!!working} onClick={() => run('install', bridge.installSensors)}>{working === 'install' ? 'Downloading…' : 'Download & enable'}</button>}
        {status.installed && !status.running && <button className="button" disabled={!!working} onClick={() => run('start', bridge.startSensors)}>{working === 'start' ? 'Starting…' : 'Start as admin'}</button>}
        {status.running && <span className="status-ok">Running</span>}
      </Row>
      {status.installed && (
        <Row icon={BoltIcon} title="Start sensors at sign-in" sub="Adds a Windows scheduled task with highest privileges, so there's no prompt at each sign-in. Changing it asks for administrator permission.">
          <Toggle checked={!!status.atSignIn} onChange={(v) => run('task', () => bridge.setSensorsAtSignIn(v))} />
        </Row>
      )}
      {error && <div className="row row-error">{error}</div>}
    </>
  );
}

// ── Sections ────────────────────────────────────────────────────────────

function General({ config }) {
  const [displays, setDisplays] = useState([]);
  useEffect(() => { bridge.getDisplays().then(setDisplays); }, []);
  return (
    <>
      <Group title="Display">
        <Row icon={ExpandIcon} title="Notch size" sub="Scale the notch to match your screen.">
          <div className="range-with-value">
            <input type="range" min="0.8" max="1.4" step="0.05" value={config.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
            <span>{Math.round(config.scale * 100)}%</span>
          </div>
        </Row>
        <Row icon={MonitorIcon} title="Show on" sub="Choose which display the notch appears on.">
          <select value={config.displayId ?? ''} onChange={(e) => set({ displayId: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Primary display</option>
            {displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Row>
      </Group>
      <Group title="Behaviour">
        <Row icon={BoltIcon} title="Open at sign-in" sub="Start TopNotch when Windows starts.">
          <Toggle checked={!!config.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
        </Row>
        <Row icon={PointerIcon} title="Expand on hover" sub="Open the notch when your cursor reaches it. Off: click the pill to open.">
          <Toggle checked={config.expandOnHover !== false} onChange={(v) => set({ expandOnHover: v })} />
        </Row>
        <Row icon={PinIcon} title="Keep open" sub="Don't collapse the expanded notch when the pointer leaves. Same as the pin.">
          <Toggle checked={!!config.keepOpen} onChange={(v) => set({ keepOpen: v })} />
        </Row>
        <Row icon={ShrinkIcon} title="Hide behind maximised windows" sub="Fade out while a window fills the screen. Hover the top edge to bring it back.">
          <Toggle checked={!!config.hideBehindMaximized} onChange={(v) => set({ hideBehindMaximized: v })} />
        </Row>
      </Group>
      <Group title="Sensors">
        <Sensors />
      </Group>
    </>
  );
}

function Appearance({ config }) {
  const accent = config.accent || 'album';
  return (
    <Group title="Colour & shape">
      <Row icon={PaletteIcon} title="Accent" sub="Lyrics edge, bars, highlights and glow.">
        <div className="swatches">
          <button className={`swatch swatch-album${accent === 'album' ? ' is-active' : ''}`} title="From album art" onClick={() => set({ accent: 'album' })}><MusicIcon /></button>
          {SWATCHES.map((c) => (
            <button key={c} className={`swatch${accent === c ? ' is-active' : ''}`} style={{ background: c }} title={c} onClick={() => set({ accent: c })} />
          ))}
        </div>
      </Row>
      <Row icon={GlowIcon} title="Edge glow" sub="A soft accent-coloured halo around the notch while music plays.">
        <Segmented id="glow" value={config.edgeGlow || 'subtle'} onChange={(v) => set({ edgeGlow: v })} options={[['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong']]} />
      </Row>
      <Row icon={SquareIcon} title="Corners" sub={config.material === 'glass' ? "Dark glass uses Windows' own 8 px corners." : undefined} disabled={config.material === 'glass'}>
        <Segmented id="corners" value={config.corners || 'rounded'} onChange={(v) => set({ corners: v })} options={[['rounded', 'Rounded'], ['squared', 'Squared']]} />
      </Row>
      <Row icon={LayersIcon} title="Material" sub="Dark glass blurs the desktop behind the notch (Windows 11 rounds its corners).">
        <Segmented id="material" value={config.material || 'solid'} onChange={(v) => set({ material: v })} options={[['solid', 'Solid'], ['glass', 'Dark glass']]} />
      </Row>
    </Group>
  );
}

const WIDGETS = [
  ['lyrics', LyricsIcon, 'Synced lyrics', 'Word-by-word lyrics in the Music tab (lrclib.net).'],
  ['pillLyrics', MusicIcon, 'Lyrics in the pill', 'Show the current line on the collapsed notch while music plays.'],
  ['pillInfo', ClockIcon, 'Day, time & weather in the pill', 'Shown on the collapsed notch while nothing is playing.'],
  ['weather', WeatherIcon, 'Weather', 'Current temperature and conditions (Open-Meteo).'],
  ['privacy', CameraIcon, 'Camera & mic indicator', 'Green and orange dots, plus the call app, while a device is in use.'],
  ['clipboard', ClipboardIcon, 'Clipboard history', 'Last 30 copied items. Text is saved to disk.'],
  ['shelf', TrayIcon, 'File shelf', 'Drag files onto the notch to park them.'],
  ['timer', CoffeeIcon, 'Focus timer', 'Countdowns and pomodoro with a chime when done.'],
  ['stats', PulseIcon, 'System', 'Processor, memory and network speed.'],
  ['bluetooth', BluetoothIcon, 'Bluetooth', 'Paired devices and connect/disconnect pop-ups.'],
  ['charging', BoltIcon, 'Charging pop-ups', 'Laptop plug, unplug and low battery.']
];

function Widgets({ config }) {
  return (
    <>
      <Group title="Show in the notch">
        {WIDGETS.map(([key, icon, title, sub]) => (
          <Row key={key} icon={icon} title={title} sub={sub} disabled={key === 'pillLyrics' && !config.features.lyrics}>
            <Toggle checked={config.features[key] !== false} onChange={setFeature(key)} />
          </Row>
        ))}
      </Group>
      <Group title="Weather">
        <Row icon={WeatherIcon} title="City" sub="Empty uses an approximate location from your IP address (ipwho.is).">
          <CityInput value={config.weatherCity || ''} />
        </Row>
        <Row title="Unit">
          <Segmented id="unit" value={config.temperatureUnit || 'c'} onChange={(v) => set({ temperatureUnit: v })} options={[['c', '°C'], ['f', '°F']]} />
        </Row>
      </Group>
    </>
  );
}

const TIPS = [
  [PointerIcon, 'Open the notch', 'Hover it (or click, if Expand on hover is off) to see media, controls and widgets.'],
  [WheelIcon, 'Scroll to adjust', 'Scroll over the notch for volume; hold Shift for brightness.'],
  [PinIcon, 'Keep it open', 'Use the pin in the notch header while you work.'],
  [TrayIcon, 'Park files', 'Drag files to the top of the screen to drop them on the shelf.'],
  [ExpandIcon, 'Seek a song', 'Click anywhere on the progress bar to jump to that point.'],
  [LyricsIcon, 'Jump to a lyric', 'In the Music tab, click any line to play from there.'],
  [CloseIcon, 'Quit', 'Right-click the tray icon and choose Quit TopNotch.']
];

function Tips() {
  return (
    <Group>
      {TIPS.map(([icon, title, sub]) => <Row key={title} icon={icon} title={title} sub={sub} />)}
    </Group>
  );
}

function UpdateRow() {
  const [state, setState] = useState(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    setState(await bridge.checkForUpdate());
    setChecking(false);
  };
  const sub = !state ? 'Look for a newer release on GitHub.'
    : state.status === 'available' ? `Version ${state.latest} is available (you have ${state.current}).`
    : state.status === 'current' ? `You're up to date (${state.current}).`
    : state.status === 'none' ? 'No releases published yet.'
    : state.status === 'unconfigured' ? 'Set "repository" in package.json to your GitHub repo to enable update checks.'
    : `Couldn't check: ${state.error}`;
  return (
    <Row icon={RefreshIcon} title="Updates" sub={sub}>
      {state?.status === 'available'
        ? <button className="button button-primary" onClick={() => bridge.openRelease(state.url)}>Download</button>
        : <button className="button" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check for updates'}</button>}
    </Row>
  );
}

function About() {
  const [info, setInfo] = useState(null);
  useEffect(() => { bridge.getAppInfo().then(setInfo); }, []);
  return (
    <>
      <div className="about-hero">
        <img src="./icon.png" alt="" width={64} height={64} />
        <h2>TopNotch</h2>
        <div className="row-sub">Version {info?.version ?? '…'} · Dynamic Island for Windows</div>
        <p>Media, lyrics, system stats, Bluetooth and quick controls in a notch at the top of your screen.</p>
      </div>
      <Group title="Updates">
        <UpdateRow />
      </Group>
      <Group title="Files">
        <Row icon={FolderIcon} title="Log" sub="topnotch.log, useful when something misbehaves.">
          <button className="button" onClick={() => bridge.openFolder('log')}>Show log</button>
        </Row>
        <Row icon={FolderIcon} title="Data folder" sub="Settings, clipboard history and the file shelf.">
          <button className="button" onClick={() => bridge.openFolder('data')}>Open folder</button>
        </Row>
      </Group>
      <Group title="Built with">
        <Row title="Open-Meteo" sub="Weather data, no account needed." />
        <Row title="lrclib.net" sub="Community synced lyrics." />
        <Row title="windows-smtc-monitor" sub="Media session info from Windows (MIT)." />
        <Row title={`Electron ${info?.electron ?? ''}`} sub="React, Vite and framer-motion." />
      </Group>
    </>
  );
}

// ── Window ──────────────────────────────────────────────────────────────

export default function Settings() {
  const config = useConfig();
  const [section, setSection] = useState('general');
  const [version, setVersion] = useState('');
  useEffect(() => { bridge.getAppInfo().then((i) => setVersion(i?.version ?? '')); }, []);
  const current = SECTIONS.find((s) => s.id === section);

  return (
    <div className="settings-window">
      <aside className="sidebar">
        <div className="brand drag">
          <img src="./icon.png" alt="" width={28} height={28} />
          <div><div className="brand-name">TopNotch</div><div className="row-sub">Settings</div></div>
        </div>
        <nav>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item${section === id ? ' is-active' : ''}`} onClick={() => setSection(id)}>
              {section === id && <motion.span layoutId="nav-active" className="nav-active" transition={SPRING_SNAPPY} />}
              <Icon /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><span>Version {version}</span></div>
      </aside>
      <main className="content">
        <header className="content-head drag">
          <h1>{current.label}</h1>
          <button className="close-button no-drag" aria-label="Close" onClick={() => bridge.closeSettings()}><CloseIcon /></button>
        </header>
        <div className="content-scroll">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: SPRING_SOFT }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            >
              {section === 'general' && <General config={config} />}
              {section === 'appearance' && <Appearance config={config} />}
              {section === 'widgets' && <Widgets config={config} />}
              {section === 'tips' && <Tips />}
              {section === 'about' && <About />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
