import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bridge } from './bridge.js';
import Activity from './Activities.jsx';
import { PillLyrics } from './Lyrics.jsx';
import { CONTENT, PRESS, SPRING_ISLAND, SPRING_SNAPPY, tabMotion } from './motion.js';
import { Artwork, Bars, ClipboardTab, ShelfTab, StatsTab, TimerTab } from './Tabs.jsx';
import { BluetoothTab, DashboardTab, MixerTab, MusicTab } from './Dashboard.jsx';
import { useHoverPassthrough } from './useHoverPassthrough.js';
import { useMedia } from './useMedia.js';
import {
  formatCountdown, playChime, useActivities, useClock, useArtColors, useBattery, useBatteryEvents, useBluetoothDevices, useClipboard,
  useConfig, useDragNear, useLyrics, useMixer, usePrivacy, useShelf, useStats, useSystemLevels, useTimer, useWeather
} from './hooks.js';
import {
  BatteryRing, BluetoothIcon, ClipboardIcon, CloseIcon, CoffeeIcon, GearIcon, GridIcon, MusicIcon, PhoneIcon, PinIcon,
  PulseIcon, SlidersIcon, TimerIcon, TrayIcon, WeatherIcon
} from './icons.jsx';

const SIZES = {
  idle: { width: 190, height: 32, borderRadius: 16 },
  compact: { width: 290, height: 36, borderRadius: 18 },
  lyrics: { width: 460, height: 38, borderRadius: 19 },
  activity: { width: 340, height: 48, borderRadius: 24 },
  panel: { width: 660, height: 300, borderRadius: 34 }
};
const GLASS_RADIUS = 8;
const SQUARED_RADIUS = { idle: 8, info: 8, compact: 9, lyrics: 10, activity: 12, panel: 16 };
// Info pill: text width plus side padding.
const INFO_PADDING = 36;
const INFO_MIN = 190;
const INFO_MAX = 420;
// Pill with lyrics: artwork + gaps + bars + padding around the line text.
const PILL_CHROME = 22 + 18 + 26 + 16 + 20;
const PILL_MIN = 260;
const PILL_MAX = 560;
const WHEEL_STEP = 2;

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: GridIcon },
  { id: 'music', label: 'Music', icon: MusicIcon },
  { id: 'mixer', label: 'Volume mixer', icon: SlidersIcon },
  { id: 'bluetooth', label: 'Bluetooth', icon: BluetoothIcon, feature: 'bluetooth' },
  { id: 'clipboard', label: 'Clipboard', icon: ClipboardIcon, feature: 'clipboard' },
  { id: 'timer', label: 'Focus timer', icon: CoffeeIcon, feature: 'timer' },
  { id: 'stats', label: 'System stats', icon: PulseIcon, feature: 'stats' },
  { id: 'shelf', label: 'File shelf', icon: TrayIcon, feature: 'shelf' }
];

export default function Island() {
  const config = useConfig();
  const features = config.features;
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const media = useMedia();
  const lyrics = useLyrics();
  const privacy = usePrivacy();
  const clipboard = useClipboard();
  const shelf = useShelf();
  const dragNear = useDragNear();
  // The pin is the "Keep open" setting, so it survives restarts.
  const pinned = !!config.keepOpen;
  const setPinned = (on) => bridge.setConfig({ keepOpen: on });
  const { hovered, hold, open, close, handlers } = useHoverPassthrough({ pinned, expandOnHover: config.expandOnHover !== false });
  const [covered, setCovered] = useState(false);
  useEffect(() => bridge.onCovered(setCovered), []);
  useEffect(() => bridge.onGlassShapeRequest(() => reportShapeRef.current?.()), []);
  useEffect(() => { const t = setTimeout(() => reportShapeRef.current?.(), 120); return () => clearTimeout(t); });
  const reportShapeRef = useRef(null);
  const [pillTextWidth, setPillTextWidth] = useState(300);
  const onPillWidth = useCallback((w) => setPillTextWidth(w), []);
  const [infoWidth, setInfoWidth] = useState(220);
  // Dark glass: the window region follows the island every animation frame.
  const islandRef = useRef(null);
  const glass = config.material === 'glass';
  const reportShape = useCallback(() => {
    const el = islandRef.current;
    if (!glass || !el) return;
    const box = el.getBoundingClientRect();
    const zoom = box.width / (el.offsetWidth || box.width || 1);
    const style = getComputedStyle(el);
    const radius = parseFloat(style.borderBottomLeftRadius) * zoom || 0;
    const hidden = parseFloat(style.opacity) < 0.05;
    bridge.reportIslandShape({ x: box.left, y: box.top, width: box.width, height: box.height, radius, hidden });
  }, [glass]);
  reportShapeRef.current = reportShape;
  const onInfoWidth = useCallback((w) => setInfoWidth(w), []);
  useEffect(() => bridge.onOpenPanel((tabId) => {
    setPinned(true);
    if (tabId) setTabState(tabId);
    open();
  }), [open]);
  const hoveredRef = useRef(hovered);
  hoveredRef.current = hovered;

  const [tab, setTabState] = useState('dashboard');
  const tabDirection = useRef(1);
  const [dropping, setDropping] = useState(false);
  const activities = useActivities();

  // Hover panels carry their own sliders, so the pop-up is only for changes
  // made while the island is closed (keys, other apps, wheel).
  const levels = useSystemLevels((kind) => {
    if (!hoveredRef.current) activities.push('osd', kind, 1600);
  });

  useEffect(() => bridge.onBluetooth((event) => {
    if (featuresRef.current.bluetooth) activities.push('bluetooth', event, 4000);
  }), [activities.push]);

  useBatteryEvents(features.charging, (event) => activities.push('battery', event, 3500));

  const timerState = useTimer((finished) => {
    const title = finished.pomodoro ? (finished.phase === 'focus' ? 'Focus done · take a break' : 'Break over · back to focus') : 'Time’s up';
    playChime();
    bridge.notify('TopNotch', title);
    activities.push('timer', { title, sub: finished.pomodoro ? 'Pomodoro' : finished.label }, 6000);
  });

  const visibleTabs = TABS.filter((t) => !t.feature || features[t.feature]);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : 'dashboard';
  const setTab = (id) => {
    const from = TABS.findIndex((t) => t.id === activeTab);
    const to = TABS.findIndex((t) => t.id === id);
    tabDirection.current = to >= from ? 1 : -1;
    setTabState(id);
  };

  // A file drag reached the top of the screen: open on the shelf.
  useEffect(() => {
    if (dragNear) { setTab('shelf'); return undefined; }
    const timer = setTimeout(() => { if (!hoveredRef.current) bridge.setPassthrough(true); }, 400);
    return () => clearTimeout(timer);
  }, [dragNear]);

  const panelOpen = hovered || (features.shelf && (dragNear || dropping));
  const stats = useStats(panelOpen && (activeTab === 'stats' || activeTab === 'dashboard'));
  const mixer = useMixer(panelOpen && activeTab === 'mixer');
  const bluetoothDevices = useBluetoothDevices();
  const weather = useWeather();
  const battery = useBattery();
  // Accent follows the artwork unless a fixed swatch is chosen; edge glow
  // only controls the halo and panel tint.
  const albumColors = useArtColors(config.accent === 'album' || !config.accent ? media?.art : null);
  const artColors = config.accent && config.accent !== 'album' ? [config.accent, config.accent] : albumColors;
  const edgeGlow = config.edgeGlow || 'subtle';

  const privacyActive = features.privacy && (privacy.camera.length > 0 || privacy.microphone.length > 0);
  const timerRunning = features.timer && !!timerState.timer;
  // Paused media steps aside for the day/time/weather pill; hover still
  // opens the panel with its controls.
  const showInfo = features.pillInfo !== false && !media?.playing;
  const state = panelOpen ? 'panel'
    : activities.current ? 'activity'
    : media?.playing || timerRunning || privacyActive || (media && !showInfo) ? 'compact'
    : showInfo ? 'info'
    : 'idle';
  const pillLyrics = features.lyrics && features.pillLyrics !== false && media?.playing && !privacy.call && lyrics.key === `${media.title}|${media.artist}` && lyrics.lines.length > 0
    ? lyrics.lines : null;
  // Music playing without pill lyrics: day/time/weather sits between the
  // artwork and the bars instead.
  const compactInfo = state === 'compact' && !pillLyrics && media?.playing && features.pillInfo !== false && !timerRunning && !privacy.call
    ? { weather: features.weather ? weather : null } : null;
  const size = state === 'compact' && pillLyrics ? 'lyrics' : compactInfo ? 'compactInfo' : state;
  const squared = config.corners === 'squared';
  const target = {
    ...SIZES[size],
    ...(size === 'lyrics' ? { width: Math.round(Math.min(PILL_MAX, Math.max(PILL_MIN, pillTextWidth + PILL_CHROME))) } : null),
    ...(size === 'compactInfo' ? { ...SIZES.compact, width: Math.round(Math.min(PILL_MAX, Math.max(PILL_MIN, infoWidth + PILL_CHROME))), ...(squared ? { borderRadius: SQUARED_RADIUS.compact } : null) } : null),
    ...(size === 'info' ? { width: Math.round(Math.min(INFO_MAX, Math.max(INFO_MIN, infoWidth + INFO_PADDING))), height: 32, borderRadius: squared ? SQUARED_RADIUS.info : 16 } : null),
    // The Music tab grows taller so about four lyric lines fit.
    ...(size === 'panel' && activeTab === 'music' && media ? { height: 350 } : null),
    ...(squared ? { borderRadius: SQUARED_RADIUS[size] ?? SQUARED_RADIUS.compact } : null),
    // Dark glass: Windows rounds the blur window's corners by a fixed 8 DIP
    // and can't be clipped further, so the island matches that radius
    // (divided by the notch size, which is applied as CSS zoom).
    ...(glass ? { borderRadius: GLASS_RADIUS / (config.scale || 1) } : null),
    // Hide behind maximized windows; hovering the top edge still brings it back.
    opacity: covered && !panelOpen ? 0 : 1,
    y: covered && !panelOpen ? -12 : 0
  };

  const onWheel = (e) => {
    // Chromium reports Shift+wheel as horizontal scroll (deltaY = 0).
    const delta = e.deltaY || e.deltaX;
    if (!delta || (state === 'panel' && e.target.closest('.clip-list, .shelf-grid'))) return;
    const step = delta < 0 ? WHEEL_STEP : -WHEEL_STEP;
    if (e.shiftKey && levels.brightnessSupported && levels.brightness !== null) bridge.setBrightness(levels.brightness + step);
    else if (levels.volume !== null) bridge.setVolume(levels.volume + step);
  };

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const dropHandlers = features.shelf ? {
    onDragEnter: (e) => { if (hasFiles(e)) { e.preventDefault(); setDropping(true); setTab('shelf'); } },
    onDragOver: (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); },
    onDrop: (e) => {
      e.preventDefault();
      setDropping(false);
      const paths = [...e.dataTransfer.files].map((f) => bridge.pathForFile(f)).filter(Boolean);
      if (paths.length) bridge.addToShelf(paths);
    }
  } : {};

  const glowing = edgeGlow !== 'off' && artColors && media?.playing && state !== 'panel';
  const style = artColors ? { '--accent': artColors[0], '--accent-2': artColors[1] } : undefined;

  return (
    <div className="stage" style={{ zoom: config.scale }}>
      <motion.div
        className={`island${glowing ? ` is-glowing glow-${edgeGlow}` : ''}${config.material === 'glass' ? ' is-glass' : ''}${squared ? ' is-squared' : ''}`}
        style={style}
        {...handlers}
        {...dropHandlers}
        onWheel={onWheel}
        ref={islandRef}
        onUpdate={reportShape}
        onAnimationComplete={reportShape}
        onLayoutAnimationComplete={reportShape}
        initial={false}
        animate={target}
        transition={SPRING_ISLAND}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {state === 'panel' && (
            <motion.div key="panel" className="panel" {...CONTENT}>
              {edgeGlow !== 'off' && artColors && (activeTab === 'dashboard' || activeTab === 'music') && media && <div className={`panel-glow glow-${edgeGlow}`} />}
              <div className="top-bar">
                <div className="tab-group">
                  {visibleTabs.map(({ id, label, icon: Icon }) => (
                    <motion.button {...PRESS} key={id} className={`tab-button${activeTab === id ? ' is-active' : ''}`} aria-label={label} title={label} onClick={() => setTab(id)}>
                      {activeTab === id && <motion.span layoutId="tab-highlight" className="tab-highlight" transition={SPRING_SNAPPY} />}
                      <Icon />
                    </motion.button>
                  ))}
                </div>
                <span className="tab-spacer" />
                {features.weather && weather && (
                  <span className="status-chip" title={weather.place}>
                    <WeatherIcon condition={weather.condition} isDay={weather.isDay} />{weather.temperature}{weather.unit}
                  </span>
                )}
                {battery && (
                  <span className={`status-chip battery-chip${battery.charging ? ' is-charging' : battery.level <= 20 ? ' is-low' : ''}`} title={battery.charging ? 'Charging' : 'On battery'}>
                    {battery.level}%<BatteryRing level={battery.level} charging={battery.charging} />
                  </span>
                )}
                <motion.button {...PRESS} className={`icon-button${pinned ? ' is-active' : ''}`} aria-label={pinned ? 'Unpin' : 'Keep open'} title={pinned ? 'Unpin' : 'Keep open'} onClick={() => setPinned(!pinned)}><PinIcon filled={pinned} /></motion.button>
                <motion.button {...PRESS} className="icon-button" aria-label="Settings" title="Settings" onClick={() => bridge.openSettings()}><GearIcon /></motion.button>
                <motion.button {...PRESS} className="icon-button" aria-label="Close" title="Close" onClick={() => { setPinned(false); close(); }}><CloseIcon /></motion.button>
              </div>
              <div className="tab-stage">
                <AnimatePresence mode="popLayout" initial={false} custom={tabDirection.current}>
                  <motion.div key={activeTab} className="tab-frame" {...tabMotion(tabDirection.current)}>
                    {activeTab === 'dashboard' && <DashboardTab media={media} stats={stats} timerState={timerState} features={features} hold={hold} goTo={setTab} />}
                    {activeTab === 'music' && <MusicTab media={media} lyrics={lyrics} levels={levels} hold={hold} showLyrics={features.lyrics} />}
                    {activeTab === 'mixer' && <MixerTab levels={levels} sessions={mixer} hold={hold} />}
                    {activeTab === 'bluetooth' && <BluetoothTab devices={bluetoothDevices} />}
                    {activeTab === 'shelf' && <ShelfTab items={shelf} dragging={dropping || dragNear} />}
                    {activeTab === 'clipboard' && <ClipboardTab items={clipboard} />}
                    {activeTab === 'timer' && <TimerTab timerState={timerState} />}
                    {activeTab === 'stats' && <StatsTab stats={stats} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
          {state === 'activity' && <Activity key={`activity-${activities.current.kind}`} activity={activities.current} levels={levels} hold={hold} />}
          {state === 'info' && <InfoPill key="info" weather={features.weather ? weather : null} onWidth={onInfoWidth} />}
          {state === 'compact' && (
            <Compact key="compact" media={media} lyrics={pillLyrics} onLyricsWidth={onPillWidth} info={compactInfo} onInfoWidth={onInfoWidth} privacy={features.privacy ? privacy : null} timerState={timerRunning ? timerState : null} />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// Day · time · weather, reporting its natural width so the pill can fit it.
function InfoRow({ weather, onWidth }) {
  const now = useClock();
  const measure = useRef(null);
  const day = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const temp = weather ? `${weather.temperature}${weather.unit}` : null;
  useLayoutEffect(() => { if (measure.current) onWidth(measure.current.scrollWidth); }, [day, time, temp, onWidth]);
  return (
    <span className="info-row" ref={measure}>
      <span className="info-day">{day}</span>
      <span className="info-time">{time}</span>
      {weather && (
        <span className="info-weather" title={weather.place}>
          <WeatherIcon condition={weather.condition} isDay={weather.isDay} />{temp}
        </span>
      )}
    </span>
  );
}

function InfoPill({ weather, onWidth }) {
  return <motion.div className="info-pill" {...CONTENT}><InfoRow weather={weather} onWidth={onWidth} /></motion.div>;
}

function Compact({ media, lyrics, onLyricsWidth, info, onInfoWidth, privacy, timerState }) {
  const camera = privacy?.camera.length > 0;
  const mic = privacy?.microphone.length > 0;
  const call = privacy?.call;
  const users = privacy ? [...new Set([...privacy.camera, ...privacy.microphone])] : [];

  let left;
  if (call) left = <span className="compact-call"><PhoneIcon /><span>{call}</span></span>;
  else if (media) left = <Artwork src={media.art} size={22} />;
  else if (timerState) left = <span className="compact-timer-icon"><TimerIcon /></span>;
  else left = <span className="compact-label">{users.join(', ')}</span>;

  return (
    <motion.div className={`compact${lyrics ? ' has-lyrics' : ''}`} {...CONTENT}>
      {left}
      {lyrics && <PillLyrics lines={lyrics} media={media} onWidth={onLyricsWidth} />}
      {!lyrics && info && <span className="compact-info"><InfoRow weather={info.weather} onWidth={onInfoWidth} /></span>}
      <span className="compact-right">
        {timerState
          ? <span className="compact-countdown">{formatCountdown(timerState.remaining)}</span>
          : media && <Bars playing={media.playing} />}
        {(camera || mic) && (
          <span className="privacy-dots" title={users.join(', ')}>
            {camera && <span className="dot dot-camera" />}
            {mic && <span className="dot dot-mic" />}
          </span>
        )}
      </span>
    </motion.div>
  );
}
