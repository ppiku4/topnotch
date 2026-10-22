import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bridge, IS_MAC } from './bridge.js';
import Activity from './Activities.jsx';
import { PillLyrics } from './Lyrics.jsx';
import InfoRow, { weatherColor } from './InfoRow.jsx';
import { CONTENT, PRESS, SPRING_ISLAND, SPRING_SNAPPY, tabMotion } from './motion.js';
import { Artwork, Bars, ClipboardTab, ShelfTab, StatsTab, TimerTab } from './Tabs.jsx';
import { BluetoothTab, DashboardTab, MixerTab, MusicTab } from './Dashboard.jsx';
import { useHoverPassthrough } from './useHoverPassthrough.js';
import { useBeatVars } from './beat.js';
import { useMedia } from './useMedia.js';
import {
  formatCountdown, playChime, useActivities, useArtColors, useClock, useBattery, useBatteryEvents, useBluetoothDevices, useClipboard,
  useConfig, useDock, useDragNear, useLyrics, useMixer, usePrivacy, useShelf, useStats, useSystemLevels, useTimer, useWeather
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
  panel: { width: 660, height: 300, borderRadius: 34 },
  // Left/right edges: the resting pill becomes a vertical strip.
  vIdle: { width: 30, height: 140, borderRadius: 15 },
  vInfo: { width: 48, height: 136, borderRadius: 24 },
  vCompact: { width: 40, height: 200, borderRadius: 20 }
};
const GLASS_RADIUS = 8;
const SQUARED_RADIUS = { idle: 8, info: 8, compact: 9, lyrics: 10, activity: 12, panel: 16, vIdle: 8, vInfo: 9, vCompact: 9 };
// Pointer travel (px) before a press on the island turns into a drag.
const DRAG_THRESHOLD = 6;
const isVerticalEdge = (edge) => edge === 'left' || edge === 'right';
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
  // macOS has no per-app volume API, so no Mixer there.
  ...(IS_MAC ? [] : [{ id: 'mixer', label: 'Volume mixer', icon: SlidersIcon }]),
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
  const dock = useDock();
  const edge = dock.edge;
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
    // The corners on the docked side are square; take the rounded ones.
    const radius = Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
      .map((k) => parseFloat(style[k]) || 0)) * zoom;
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

  // File wheel jobs: stay up while running, linger a few seconds when done.
  useEffect(() => bridge.onConvertJob((job) => {
    activities.push('convert', job, job.status === 'running' ? 30 * 60 * 1000 : job.status === 'done' ? 7000 : 9000);
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

  // macOS: files released over the island, reported by the native helper in
  // case the window itself never got the drop.
  useEffect(() => bridge.onShelfDrop(({ paths, x, y }) => {
    if (featuresRef.current.shelf && document.elementFromPoint(x, y)?.closest('.island')) bridge.addToShelf(paths);
  }), []);

  // A drop that misses the island must not navigate the window to the file.
  useEffect(() => {
    const block = (e) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  // While the notch is being dragged to a new edge it stays collapsed.
  // A finished conversion keeps the pill under the pointer so "Show" can be clicked.
  const convertDone = activities.current?.kind === 'convert' && activities.current.data.status === 'done';
  const panelOpen = !dock.dragging && ((hovered && !convertDone) || (features.shelf && (dragNear || dropping)));
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
  // Music and the focus timer at once: the island splits, Apple-style. The
  // pill keeps the music and the timer moves into its own round bubble.
  const split = state === 'compact' && !!media?.playing && timerRunning && !privacy.call;
  const pillTimer = timerRunning && !split ? timerState : null;
  const compactInfo = state === 'compact' && !pillLyrics && media?.playing && features.pillInfo !== false && !pillTimer && !privacy.call
    ? { weather: features.weather ? weather : null } : null;
  // On the left/right edges the resting states are a vertical strip; the
  // panel and live activities keep their horizontal shape.
  const vertical = isVerticalEdge(edge) && (state === 'idle' || state === 'info' || state === 'compact');
  const size = vertical ? (state === 'compact' ? 'vCompact' : state === 'info' ? 'vInfo' : 'vIdle')
    : state === 'compact' && pillLyrics ? 'lyrics' : compactInfo ? 'compactInfo' : state;
  const squared = config.corners === 'squared';
  const target = {
    ...SIZES[size],
    ...(size === 'lyrics' ? { width: Math.round(Math.min(PILL_MAX, Math.max(PILL_MIN, pillTextWidth + PILL_CHROME))) } : null),
    ...(size === 'compactInfo' ? { ...SIZES.compact, width: Math.round(Math.min(PILL_MAX, Math.max(PILL_MIN, infoWidth + PILL_CHROME))), ...(squared ? { borderRadius: SQUARED_RADIUS.compact } : null) } : null),
    ...(size === 'info' ? { width: Math.round(Math.min(INFO_MAX, Math.max(INFO_MIN, infoWidth + INFO_PADDING))), height: 32, borderRadius: squared ? SQUARED_RADIUS.info : 16 } : null),
    // The Music tab grows taller so about four lyric lines fit.
    ...(size === 'panel' && activeTab === 'music' && media ? { height: 350 } : null),
    ...(squared ? { borderRadius: SQUARED_RADIUS[size] ?? SQUARED_RADIUS.compact } : null),
    // Dark glass: the OS rounds the blur window's corners by a fixed 8 DIP
    // and can't be clipped further, so the island matches that radius
    // (divided by the notch size, which is applied as CSS zoom).
    ...(glass ? { borderRadius: GLASS_RADIUS / (config.scale || 1) } : null),
    // Hide behind maximized windows; hovering the edge still brings it back.
    opacity: covered && !panelOpen ? 0 : 1,
    x: covered && !panelOpen ? (edge === 'left' ? -12 : edge === 'right' ? 12 : 0) : 0,
    y: covered && !panelOpen ? (edge === 'top' ? -12 : edge === 'bottom' ? 12 : 0) : 0
  };

  // Place the island's centre at the dock anchor, kept inside the window so
  // it sits flush in the screen corner at either end of an edge.
  const zoom = config.scale || 1;
  const along = isVerticalEdge(edge) ? 'height' : 'width';
  const windowSpan = isVerticalEdge(edge) ? window.innerHeight : window.innerWidth;
  const half = ((target[along] ?? 0) * zoom) / 2;
  const anchor = Math.max(half, Math.min(windowSpan - half, dock.anchor ?? windowSpan / 2)) / zoom;
  const anchorStyle = isVerticalEdge(edge)
    ? { top: anchor, [edge]: 0, transform: 'translateY(-50%)' }
    : { left: anchor, [edge]: 0, transform: 'translateX(-50%)' };

  // Press and drag the island, or any non-interactive part of the open panel
  // (its header, gaps, labels), to move it to any edge; main follows the
  // cursor until the button is released.
  const dragStart = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0 || config.lockPosition) return;
    if (e.target.closest('button, a, input, select, textarea, .slider, .clip-list, .clip, .shelf-grid, .shelf-stack, .lyrics-list, .mixer-apps, .media-card-top, .meters-card')) return;
    dragStart.current = { x: e.screenX, y: e.screenY };
  };
  const onPointerMove = (e) => {
    const start = dragStart.current;
    if (!start) return;
    if (Math.hypot(e.screenX - start.x, e.screenY - start.y) < DRAG_THRESHOLD) return;
    dragStart.current = null;
    bridge.startDockDrag();
  };
  const onPointerUp = () => { dragStart.current = null; };

  // When a drag ends the pointer may be anywhere; let the hover logic start
  // again from "outside".
  const wasDragging = useRef(false);
  useEffect(() => {
    if (dock.dragging) { wasDragging.current = true; return; }
    if (wasDragging.current) { wasDragging.current = false; close(); }
  }, [dock.dragging, close]);

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
  // The glow and the Music tab's gradient breathe with the music (beat.js
  // writes --beat on the island each frame).
  useBeatVars(islandRef, !!media?.playing && (glowing || (state === 'panel' && (activeTab === 'music' || activeTab === 'dashboard'))));
  const style = artColors ? { '--accent': artColors[0], '--accent-2': artColors[1] } : undefined;

  return (
    <div className={`stage edge-${edge}${dock.dragging ? ' is-dragging' : ''}`} style={{ zoom: config.scale }}>
      <div className="dock-anchor" style={anchorStyle}>
      <motion.div
        className={`island edge-${edge}${vertical ? ' is-vertical' : ''}${glowing ? ` is-glowing glow-${edgeGlow}` : ''}${config.material === 'glass' ? ' is-glass' : ''}${squared ? ' is-squared' : ''}${config.lockPosition ? '' : ' is-draggable'}`}
        style={style}
        {...handlers}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
              {activeTab === 'music' && media && artColors && <div className={`music-pulse${media.playing ? ' is-playing' : ''}`} aria-hidden />}
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
                  <span className="status-chip" title={weather.place} style={{ '--weather-color': weatherColor(weather, config.weatherColor) }}>
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
          {vertical && state === 'info' && <VerticalInfo key="v-info" weather={features.weather ? weather : null} config={config} />}
          {vertical && state === 'compact' && (
            <VerticalCompact key="v-compact" media={media} privacy={features.privacy ? privacy : null} timerState={pillTimer} />
          )}
          {!vertical && state === 'info' && <InfoPill key="info" weather={features.weather ? weather : null} config={config} onWidth={onInfoWidth} />}
          {!vertical && state === 'compact' && (
            <Compact key="compact" media={media} lyrics={pillLyrics} onLyricsWidth={onPillWidth} info={compactInfo} onInfoWidth={onInfoWidth} config={config} privacy={features.privacy ? privacy : null} timerState={pillTimer} />
          )}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {split && (
          <TimerBubble
            key="timer-bubble"
            timerState={timerState}
            edge={edge}
            before={!isVerticalEdge(edge) && (dock.anchor ?? windowSpan / 2) > windowSpan * 0.72}
            // Same thickness as the pill it splits from.
            size={isVerticalEdge(edge) ? target.width : target.height}
            covered={covered}
            onEnter={(e) => { setTabState('timer'); handlers.onPointerEnter(e); }}
            onLeave={handlers.onPointerLeave}
            onClick={() => { setTabState('timer'); open(); }}
          />
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

// Focus timer as a ring that drains around the timer glyph (or the minutes
// left, in the bubble), Apple's timer Live Activity style.
function TimerRing({ timerState, size = 22, showMinutes = false }) {
  const total = timerState.timer?.total || 1;
  const left = Math.max(0, Math.min(1, timerState.remaining / total));
  const r = size / 2 - 2;
  const length = 2 * Math.PI * r;
  const minutes = Math.ceil(timerState.remaining / 60000);
  return (
    <span className={`timer-ring${timerState.timer?.paused ? ' is-paused' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} />
        <circle className="fill" cx={size / 2} cy={size / 2} r={r} strokeDasharray={length} strokeDashoffset={length * (1 - left)} />
      </svg>
      {showMinutes
        ? <span className="timer-ring-text">{timerState.remaining < 60000 ? Math.ceil(timerState.remaining / 1000) : minutes}</span>
        : <span className="timer-ring-icon"><TimerIcon /></span>}
    </span>
  );
}

// The detached bubble: grows out of the pill's side through a short "neck"
// that pinches off (and back in when the timer ends), like the Dynamic
// Island splitting into two activities.
function TimerBubble({ timerState, edge, before, size, covered, onEnter, onLeave, onClick }) {
  const vertical = isVerticalEdge(edge);
  const gap = 8;
  // Which way it travels out of the pill.
  const axis = vertical ? 'y' : 'x';
  const away = before ? -1 : 1;
  const place = vertical
    ? { top: `calc(100% + ${gap}px)`, [edge]: 0 }
    : { [before ? 'right' : 'left']: `calc(100% + ${gap}px)`, [edge]: 0 };
  const neck = vertical
    ? { top: '100%', height: gap + 12, marginTop: -6, width: size * 0.55, [edge]: (size - size * 0.55) / 2 }
    : { [before ? 'right' : 'left']: '100%', width: gap + 12, [before ? 'marginRight' : 'marginLeft']: -6, height: size * 0.55, [edge]: (size - size * 0.55) / 2 };
  return (
    <>
      <motion.span
        className="bubble-neck"
        style={{ ...neck, transformOrigin: before ? 'right center' : vertical ? 'center top' : 'left center' }}
        initial={{ opacity: 1, [vertical ? 'scaleY' : 'scaleX']: 0.2 }}
        // Stretches on the same spring as the bubble, so the two move as one.
        animate={{ opacity: 0, [vertical ? 'scaleY' : 'scaleX']: 1, transition: { ...SPRING_ISLAND, opacity: { duration: 0.42, ease: [0.32, 0.72, 0, 1] } } }}
        exit={{ opacity: 1, [vertical ? 'scaleY' : 'scaleX']: 1, transition: { duration: 0.2 } }}
      />
      <motion.button
        className="timer-bubble"
        style={{ ...place, width: size, height: size }}
        title={`Focus timer · ${formatCountdown(timerState.remaining)} left`}
        aria-label="Focus timer"
        initial={{ [axis]: -away * (size + gap) * 0.6, scale: 0.45, opacity: 0 }}
        animate={{ [axis]: 0, scale: 1, opacity: covered ? 0 : 1 }}
        exit={{ [axis]: -away * (size + gap) * 0.6, scale: 0.45, opacity: 0, transition: { ...SPRING_ISLAND, opacity: { duration: 0.18, delay: 0.12 } } }}
        transition={SPRING_ISLAND}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onClick={onClick}
      >
        <TimerRing timerState={timerState} size={size - 8} showMinutes />
      </motion.button>
    </>
  );
}

// ── Vertical strip (left/right edges) ──────────────────────────────────

function VerticalInfo({ weather, config }) {
  const now = useClock(!!config.clockSeconds);
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: config.clockFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: config.clockFormat === '12h' ? true : config.clockFormat === '24h' ? false : undefined
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  return (
    <motion.div
      className={`v-info clock-${config.clockStyle || 'regular'}`}
      {...CONTENT}
      style={{ '--clock-color': config.clockColor === 'accent' ? 'var(--accent)' : 'var(--text)', '--weather-color': weatherColor(weather, config.weatherColor) }}
    >
      <span className="v-time">{hour}</span>
      <span className="v-time">{minute}</span>
      {period && <span className="v-period">{period}</span>}
      {weather && (
        <span className="v-weather" title={weather.place}>
          <WeatherIcon condition={weather.condition} isDay={weather.isDay} />
          <span>{weather.temperature}°</span>
        </span>
      )}
    </motion.div>
  );
}

function VerticalCompact({ media, privacy, timerState }) {
  const camera = privacy?.camera.length > 0;
  const mic = privacy?.microphone.length > 0;
  const call = privacy?.call;
  let top = <span />;
  if (call) top = <span className="v-call" title={call}><PhoneIcon /></span>;
  else if (timerState && !media?.playing) top = <TimerRing timerState={timerState} size={28} />;
  else if (media) top = <Artwork src={media.art} size={26} />;
  return (
    <motion.div className="v-compact" {...CONTENT}>
      {top}
      {timerState && <span className="v-countdown">{formatCountdown(timerState.remaining)}</span>}
      <span className="v-bottom">
        {(camera || mic) && (
          <span className="privacy-dots v-dots">
            {camera && <span className="dot dot-camera" />}
            {mic && <span className="dot dot-mic" />}
          </span>
        )}
        {media && <Bars playing={media.playing} />}
      </span>
    </motion.div>
  );
}

function InfoPill({ weather, config, onWidth }) {
  return <motion.div className="info-pill" {...CONTENT}><InfoRow weather={weather} config={config} onWidth={onWidth} /></motion.div>;
}

function Compact({ media, lyrics, onLyricsWidth, info, onInfoWidth, config, privacy, timerState }) {
  const camera = privacy?.camera.length > 0;
  const mic = privacy?.microphone.length > 0;
  const call = privacy?.call;
  const users = privacy ? [...new Set([...privacy.camera, ...privacy.microphone])] : [];

  let left;
  if (call) left = <span className="compact-call"><PhoneIcon /><span>{call}</span></span>;
  // Paused music steps aside for a running timer.
  else if (timerState && !media?.playing) left = <TimerRing timerState={timerState} size={24} />;
  else if (media) left = <Artwork src={media.art} size={22} />;
  else left = <span className="compact-label">{users.join(', ')}</span>;

  return (
    <motion.div className={`compact${lyrics ? ' has-lyrics' : ''}`} {...CONTENT}>
      {left}
      {lyrics && <PillLyrics lines={lyrics} media={media} onWidth={onLyricsWidth} />}
      {!lyrics && info && <span className="compact-info"><InfoRow weather={info.weather} config={config} onWidth={onInfoWidth} /></span>}
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
