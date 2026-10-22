import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { bridge } from './bridge.js';
import { PRESS, RISE, STAGGER } from './motion.js';
import Slider from './Slider.jsx';
import { formatTime, usePlaybackPosition } from './useMedia.js';
import { formatCountdown } from './hooks.js';
import {
  ArrowDownIcon, ArrowUpIcon, BoltIcon, ChipIcon, CloseIcon, CoffeeIcon, TimerIcon, ImageIcon, MemoryIcon, NextIcon, PauseIcon, PinIcon, PlayIcon, PrevIcon, TrayIcon
} from './icons.jsx';

export function Artwork({ src, size }) {
  return src
    ? <img className="art" src={src} width={size} height={size} alt="" draggable={false} />
    : <div className="art art-empty" style={{ width: size, height: size }}>♪</div>;
}

export function Bars({ playing }) {
  return (
    <div className={`bars${playing ? ' is-playing' : ''}`} aria-hidden>
      {[0, 1, 2, 3].map((i) => <span key={i} style={{ animationDelay: `${i * 0.13}s` }} />)}
    </div>
  );
}

// ── Shared media pieces ─────────────────────────────────────────────────

// Local seek state bridges the gap until SMTC reports the new position.
export function useSeek(media) {
  const [seekedTo, setSeekedTo] = useState(null);
  const position = usePlaybackPosition(media, seekedTo);
  const seekable = media?.duration > 0;
  const seekTo = (seconds) => {
    const target = Math.max(0, seekable ? Math.min(seconds, media.duration) : seconds);
    setSeekedTo({ position: target, at: Date.now() });
    bridge.seek(target);
  };
  const commitSeek = (fraction) => seekTo(fraction * media.duration);
  return { seekedTo, position, seekable, progress: seekable ? position / media.duration : 0, commitSeek, seekTo };
}

export function MediaTimeline({ media, seek, hold, compact = false }) {
  return (
    <div className={`timeline${compact ? ' timeline-stacked' : ''}`}>
      {!compact && <span>{formatTime(seek.position)}</span>}
      {seek.seekable
        ? <Slider className="seek" label="Seek" value={seek.progress} onCommit={seek.commitSeek} onDragChange={hold} />
        : <div className="slider seek is-disabled"><div className="slider-track" /></div>}
      {!compact && <span>{formatTime(media.duration)}</span>}
      {compact && (
        <div className="timeline-times"><span>{formatTime(seek.position)}</span><span>{formatTime(media.duration)}</span></div>
      )}
    </div>
  );
}

export function MediaControls({ media, ring = false }) {
  return (
    <div className={`controls${ring ? ' controls-ring' : ''}`}>
      <motion.button {...PRESS} aria-label="Previous" onClick={() => bridge.mediaControl('previous')}><PrevIcon /></motion.button>
      <motion.button {...PRESS} className="primary" aria-label={media.playing ? 'Pause' : 'Play'} onClick={() => bridge.mediaControl('play-pause')}>
        {media.playing ? <PauseIcon /> : <PlayIcon />}
      </motion.button>
      <motion.button {...PRESS} aria-label="Next" onClick={() => bridge.mediaControl('next')}><NextIcon /></motion.button>
    </div>
  );
}

export const lyricsFor = (media, lyrics, enabled) =>
  enabled && media && lyrics.key === `${media.title}|${media.artist}` ? lyrics.lines : [];

// ── Shelf ───────────────────────────────────────────────────────────────

// Files parked on the notch. Drop any number in; select several (click,
// Ctrl/⌘+click, Shift+click) and drag them out together, or grab them all
// with the stack handle.
export function ShelfTab({ items, dragging }) {
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);
  const paths = items.map((i) => i.path);

  // Forget selections for files that left the shelf.
  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((p) => paths.includes(p)));
      return next.size === current.size ? current : next;
    });
  }, [paths.join('|')]);

  const select = (e, path) => {
    const index = paths.indexOf(path);
    setSelected((current) => {
      if (e.shiftKey && anchor.current != null) {
        const from = paths.indexOf(anchor.current);
        const [a, b] = from < index ? [from, index] : [index, from];
        return new Set(paths.slice(a, b + 1));
      }
      anchor.current = path;
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(current);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
      }
      return current.size === 1 && current.has(path) ? new Set() : new Set([path]);
    });
  };
  // Dragging a selected file takes the whole selection, in shelf order.
  const dragOut = (e, path) => {
    e.preventDefault();
    bridge.dragFromShelf(selected.has(path) ? paths.filter((p) => selected.has(p)) : [path]);
  };
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className={`tab tab-shelf${dragging ? ' is-dropping' : ''}`}>
      {items.length === 0 ? (
        <div className="drop-hint"><TrayIcon /><span>Drop files here to park them.<br />Drag them back out when you need them.</span></div>
      ) : (
        <>
          <div className="tab-header">
            <span
              className="shelf-stack"
              draggable
              title={`Drag all ${items.length} file${items.length === 1 ? '' : 's'}`}
              onDragStart={(e) => { e.preventDefault(); bridge.dragFromShelf(paths); }}
            >
              <TrayIcon />{items.length}
            </span>
            <span className="shelf-count">{selected.size ? `${selected.size} selected` : `file${items.length === 1 ? '' : 's'}`}</span>
            <span className="tab-spacer" />
            <button className="text-button" onClick={() => setSelected(allSelected ? new Set() : new Set(paths))}>{allSelected ? 'Select none' : 'Select all'}</button>
            {selected.size > 0
              ? <button className="text-button" onClick={() => { selected.forEach((p) => bridge.removeFromShelf(p)); setSelected(new Set()); }}>Remove</button>
              : <button className="text-button" onClick={() => bridge.clearShelf()}>Clear</button>}
          </div>
          <motion.div className="shelf-grid" variants={STAGGER} initial="initial" animate="animate" onClick={(e) => { if (e.target === e.currentTarget) setSelected(new Set()); }}>
            {items.map((item) => (
              <motion.div
                variants={RISE}
                layout
                key={item.path}
                className={`shelf-item${selected.has(item.path) ? ' is-selected' : ''}`}
                title={item.path}
                draggable
                onClick={(e) => select(e, item.path)}
                onDragStart={(e) => dragOut(e, item.path)}
              >
                {selected.has(item.path) && selected.size > 1 && <span className="shelf-badge">{paths.filter((p) => selected.has(p)).indexOf(item.path) + 1}</span>}
                {item.icon ? <img src={item.icon} alt="" draggable={false} /> : <TrayIcon />}
                <span>{item.name}</span>
                <button className="shelf-remove" aria-label="Remove" onClick={(e) => { e.stopPropagation(); bridge.removeFromShelf(item.path); }}><CloseIcon /></button>
              </motion.div>
            ))}
          </motion.div>
          {dragging && <div className="drop-overlay">Drop to add</div>}
        </>
      )}
    </div>
  );
}

// ── Clipboard ───────────────────────────────────────────────────────────

export function ClipboardTab({ items }) {
  const [copied, setCopied] = useState(null);
  const copy = (id) => {
    bridge.copyClip(id);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
  };

  if (!items.length) return <div className="tab tab-empty">Copied text and images show up here.</div>;
  return (
    <div className="tab tab-clipboard">
      <div className="tab-header">
        <span>Clipboard</span>
        <button className="text-button" onClick={() => bridge.clearClipboard()}>Clear</button>
      </div>
      <motion.div className="clip-list" variants={STAGGER} initial="initial" animate="animate">
        {items.map((item) => (
          <motion.div variants={RISE} layout key={item.id} className={`clip${item.pinned ? ' is-pinned' : ''}`} onClick={() => copy(item.id)} title="Click to copy">
            {item.type === 'image'
              ? <span className="clip-image">{item.thumb ? <img src={item.thumb} alt="" /> : <ImageIcon />}<span>{item.text}</span></span>
              : <span className="clip-text">{item.text.length > 5000 ? item.text.slice(0, 5000) + '…' : item.text}</span>}
            {copied === item.id && <motion.span className="clip-copied" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>Copied</motion.span>}
            <button className="clip-action" aria-label={item.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); bridge.pinClip(item.id); }}><PinIcon filled={item.pinned} /></button>
            <button className="clip-action" aria-label="Delete" onClick={(e) => { e.stopPropagation(); bridge.removeClip(item.id); }}><CloseIcon /></button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

// ── Timer: same glowing card style as System status ────────────────────

const PRESETS = [1, 5, 10, 15, 30, 60];
const TIMER_COLOR = '#ff9f0a';
const BREAK_COLOR = '#30d158';

function PresetCard({ minutes, onStart }) {
  const hour = minutes >= 60;
  return (
    <motion.button variants={RISE} {...PRESS} className="stat-card preset-card" style={{ '--stat': TIMER_COLOR }} onClick={onStart}>
      <div className="stat-value">
        <span className="stat-number">{hour ? minutes / 60 : minutes}</span>
        <span className="stat-unit">{hour ? 'hr' : 'min'}</span>
      </div>
    </motion.button>
  );
}

export function TimerTab({ timerState }) {
  const { timer, remaining, start, startPomodoro, pause, resume, reset } = timerState;
  if (!timer) {
    return (
      <motion.div className="tab stats timer-theme" variants={STAGGER} initial="initial" animate="animate">
        <div className="stats-title is-orange"><i />FOCUS TIMER<i /></div>
        <div className="timer-grid">
          {PRESETS.map((m) => <PresetCard key={m} minutes={m} onStart={() => start(m * 60, `${m < 60 ? m + ' min' : m / 60 + ' hr'} timer`)} />)}
          <motion.button variants={RISE} {...PRESS} className="stat-card pomodoro-card" style={{ '--stat': '#ff453a' }} onClick={startPomodoro}>
            <div className="stat-head"><span>POMODORO</span><CoffeeIcon /></div>
            <div className="stat-value"><span className="stat-number">25</span><span className="stat-unit">min focus</span><span className="stat-number is-small">5</span><span className="stat-unit">min break</span></div>
          </motion.button>
        </div>
      </motion.div>
    );
  }
  const progress = 1 - remaining / timer.total;
  const color = timer.phase === 'break' ? BREAK_COLOR : TIMER_COLOR;
  return (
    <motion.div className="tab stats timer-theme" variants={STAGGER} initial="initial" animate="animate">
      <div className="stats-title is-orange"><i />FOCUS TIMER<i /></div>
      <motion.div variants={RISE} className="stat-card countdown-card" style={{ '--stat': color }}>
        <div className="stat-head"><span>{timer.label.toUpperCase()}{timer.paused ? ' · PAUSED' : ''}</span><TimerIcon /></div>
        <div className="stat-value"><span className="stat-number countdown-number">{formatCountdown(remaining)}</span></div>
        <div className="stat-bar"><div style={{ transform: `scaleX(${progress})` }} /></div>
        <div className="stat-detail">{Math.round(progress * 100)}% done</div>
      </motion.div>
      <div className="timer-actions">
        {timer.paused
          ? <motion.button variants={RISE} {...PRESS} className="stat-card action-card" style={{ '--stat': color }} onClick={resume}>Resume</motion.button>
          : <motion.button variants={RISE} {...PRESS} className="stat-card action-card" style={{ '--stat': color }} onClick={pause}>Pause</motion.button>}
        <motion.button variants={RISE} {...PRESS} className="stat-card action-card" style={{ '--stat': '#ff453a' }} onClick={reset}>Cancel</motion.button>
      </div>
    </motion.div>
  );
}

// ── Stats: four glowing status cards ───────────────────────────────────

function splitRate(bytes) {
  if (bytes >= 1048576) return [(bytes / 1048576).toFixed(1), 'MB/s'];
  if (bytes >= 1024) return [(bytes / 1024).toFixed(bytes >= 102400 ? 0 : 1), 'KB/s'];
  return [String(Math.round(bytes)), 'B/s'];
}

// Peak temperatures since the app started, for the "max" readouts.
const peaks = { cpu: null, gpu: null, rx: null, tx: null };
const track = (key, value) => {
  if (Number.isFinite(value)) peaks[key] = Math.max(peaks[key] ?? value, value);
  return peaks[key];
};

function StatCard({ label, icon: Icon, color, value, unit, bar, detail, hint, wide, onClick }) {
  return (
    <motion.div variants={RISE} className={`stat-card${wide ? ' is-wide' : ''}${onClick ? ' is-clickable' : ''}`} style={{ '--stat': color }} title={hint} onClick={onClick}>
      <div className="stat-head"><span>{label}</span><Icon /></div>
      <div className="stat-value">
        <span className="stat-number">{value ?? '—'}</span>
        {value != null && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-bar"><div style={{ transform: `scaleX(${Math.max(0, Math.min(1, (bar ?? 0) / 100))})` }} /></div>
      <div className="stat-detail">{detail}</div>
    </motion.div>
  );
}

const tempText = (now, max) => (now == null ? 'Temp —' : `${Math.round(now)}°C · max ${Math.round(max)}°C`);

// Throughput bar on a log scale: 1 KB/s near empty, 100 MB/s full.
const rateBar = (bytes) => (bytes > 0 ? Math.min(100, (Math.log10(bytes / 1024 + 1) / 5) * 100) : 0);

export function StatsTab({ stats }) {
  const s = stats || {};
  const cpuMax = track('cpu', s.cpuTemp);
  const gpuMax = track('gpu', s.gpuTemp);
  const [down, downUnit] = splitRate(s.rx ?? 0);
  const [up, upUnit] = splitRate(s.tx ?? 0);
  const [downPeak, downPeakUnit] = splitRate(track('rx', s.rx) ?? 0);
  const [upPeak, upPeakUnit] = splitRate(track('tx', s.tx) ?? 0);
  const needsSensors = stats && s.cpuTemp == null;
  return (
    <motion.div className="tab stats" variants={STAGGER} initial="initial" animate="animate">
      <div className="stats-title"><i />SYSTEM STATUS<i /></div>
      <div className="stats-grid">
        <StatCard label="CPU LOAD" icon={BoltIcon} color="#ff9f0a" value={stats ? s.cpu : null} unit="%" bar={s.cpu}
          detail={needsSensors ? 'Temp — · enable in Settings' : tempText(s.cpuTemp, cpuMax)}
          hint={needsSensors ? 'CPU temperature uses LibreHardwareMonitor. Click to set it up.' : undefined}
          onClick={needsSensors ? () => bridge.openSettings() : undefined} />
        <StatCard label="GPU" icon={ChipIcon} color="#30d158" value={s.gpu ?? null} unit="%" bar={s.gpu}
          detail={tempText(s.gpuTemp, gpuMax)} hint={s.gpuName || undefined} />
        <StatCard label="MEMORY" icon={MemoryIcon} color="#bf5af2" value={stats ? s.ram : null} unit="%" bar={s.ram}
          detail={stats ? `${s.ramUsedGb.toFixed(1)} / ${s.ramTotalGb.toFixed(0)} GB` : ''} />
        <StatCard wide label="DOWNLOAD" icon={ArrowDownIcon} color="#0a84ff" value={stats ? down : null} unit={downUnit} bar={rateBar(s.rx)}
          detail={stats ? `peak ${downPeak} ${downPeakUnit}` : ''} />
        <StatCard wide label="UPLOAD" icon={ArrowUpIcon} color="#64d2ff" value={stats ? up : null} unit={upUnit} bar={rateBar(s.tx)}
          detail={stats ? `peak ${upPeak} ${upPeakUnit}` : ''} />
      </div>
    </motion.div>
  );
}
