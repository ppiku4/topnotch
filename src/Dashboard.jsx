import { useState } from 'react';
import { motion } from 'framer-motion';
import { bridge } from './bridge.js';
import { LyricsList } from './Lyrics.jsx';
import Slider from './Slider.jsx';
import { BrightnessRow, VolumeRow } from './Levels.jsx';
import { PRESS, RISE, STAGGER } from './motion.js';
import { Artwork, Bars, MediaControls, MediaTimeline, lyricsFor, useSeek } from './Tabs.jsx';
import { formatCountdown } from './hooks.js';
import {
  ArrowDownIcon, ArrowUpIcon, BatteryIcon, BluetoothIcon, CalculatorIcon, ChevronIcon, CoffeeIcon, MusicIcon,
  PulseIcon, RefreshIcon, ScissorsIcon, VolumeIcon
} from './icons.jsx';

function formatRate(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${bytes} B/s`;
}

// Artwork, blown up and blurred behind the card, tinted toward the accent.
function ArtBackdrop({ art }) {
  return (
    <div className="art-backdrop" aria-hidden>
      {art && <img src={art} alt="" draggable={false} />}
      <div className="art-backdrop-shade" />
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────

function MediaCard({ media, hold, onOpen }) {
  const seek = useSeek(media);
  return (
    <motion.div variants={RISE} className="card media-card">
      <ArtBackdrop art={media.art} />
      <div className="media-card-top" onClick={onOpen} title="Open in Music">
        <span className="art-with-badge">
          <Artwork src={media.art} size={64} />
          <span className="app-badge"><MusicIcon /></span>
        </span>
        <div className="meta">
          <div className="title" title={media.title}>{media.title}</div>
          <div className="artist">{media.artist || media.album}</div>
        </div>
      </div>
      <MediaTimeline media={media} seek={seek} hold={hold} compact />
      <MediaControls media={media} ring />
    </motion.div>
  );
}

function EmptyMediaCard() {
  return (
    <motion.div variants={RISE} className="card media-card media-card-empty">
      <span className="empty-icon"><MusicIcon /></span>
      <span>Nothing playing</span>
      <span className="muted">Play something in any app</span>
    </motion.div>
  );
}

function Meter({ label, value }) {
  return (
    <div className="mini-meter">
      <span className="mini-meter-label">{label}</span>
      <div className="mini-meter-bar"><div className={value > 85 ? 'is-hot' : ''} style={{ transform: `scaleX(${(value ?? 0) / 100})` }} /></div>
      <span className="mini-meter-value">{value ?? '–'}%</span>
    </div>
  );
}

export function DashboardTab({ media, stats, timerState, features, hold, goTo }) {
  const { timer, remaining } = timerState;
  return (
    <motion.div className="tab dashboard" variants={STAGGER} initial="initial" animate="animate">
      {media ? <MediaCard media={media} hold={hold} onOpen={() => goTo('music')} /> : <EmptyMediaCard />}
      <div className="dashboard-side">
        {features.timer && (
          <motion.button variants={RISE} {...PRESS} className="card card-row focus-row" onClick={() => goTo('timer')}>
            <span className="row-icon"><CoffeeIcon /></span>
            <span className="row-title">{timer ? timer.label : 'Focus timer'}</span>
            <span className={`row-value${timer ? ' is-running' : ''}`}>{timer ? formatCountdown(remaining) : '25:00'}</span>
            <span className="row-chevron"><ChevronIcon /></span>
          </motion.button>
        )}
        {features.stats && (
          <>
            <motion.div variants={RISE} className="card meters-card" onClick={() => goTo('stats')}>
              <Meter label="CPU" value={stats?.cpu} />
              <Meter label="RAM" value={stats?.ram} />
            </motion.div>
            <motion.div variants={RISE} className="card card-row net-card">
              <span className="row-title">Network</span>
              <span className="net-value"><ArrowDownIcon />{formatRate(stats?.rx ?? 0)}</span>
              <span className="net-value"><ArrowUpIcon />{formatRate(stats?.tx ?? 0)}</span>
            </motion.div>
          </>
        )}
        <motion.div variants={RISE} className="tools-row">
          <motion.button {...PRESS} className="card tool" title="Calculator" onClick={() => bridge.quickTool('calculator')}><CalculatorIcon /></motion.button>
          <motion.button {...PRESS} className="card tool" title="Snip screen" onClick={() => bridge.quickTool('snip')}><ScissorsIcon /></motion.button>
          <motion.button {...PRESS} className="card tool" title="Task Manager" onClick={() => bridge.quickTool('taskmgr')}><PulseIcon /></motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Music ──────────────────────────────────────────────────────────────

function ResyncButton() {
  const [spinning, setSpinning] = useState(false);
  const resync = () => {
    bridge.resyncLyrics();
    setSpinning(true);
    setTimeout(() => setSpinning(false), 1200);
  };
  return (
    <motion.button {...PRESS} className={`icon-button resync${spinning ? ' is-spinning' : ''}`} title="Re-sync lyrics" aria-label="Re-sync lyrics" onClick={resync}>
      <RefreshIcon />
    </motion.button>
  );
}

export function MusicTab({ media, lyrics, levels, hold, showLyrics }) {
  const seek = useSeek(media);
  if (!media) return <div className="tab tab-empty"><span className="empty-icon"><MusicIcon /></span>Nothing playing</div>;
  const lines = lyricsFor(media, lyrics, showLyrics);
  return (
    <motion.div className="tab music" variants={STAGGER} initial="initial" animate="animate">
      <motion.div variants={RISE} className="music-art">
        <ArtBackdrop art={media.art} />
        <Artwork src={media.art} size={150} />
      </motion.div>
      <div className="music-main">
        <motion.div variants={RISE} className="music-head">
          <div className="meta">
            <div className="title" title={media.title}>{media.title}</div>
            <div className="artist">{media.artist || media.album}</div>
          </div>
          <Bars playing={media.playing} />
          {showLyrics && <ResyncButton />}
        </motion.div>
        {lines.length > 0
          ? <LyricsList lines={lines} media={media} seekedTo={seek.seekedTo} onSeek={seek.seekTo} />
          : <div className="lyrics-placeholder">{showLyrics ? 'No synced lyrics for this track' : ''}</div>}
        <MediaTimeline media={media} seek={seek} hold={hold} />
        <div className="music-bottom">
          <MediaControls media={media} />
          <div className="music-volume"><VolumeRow levels={levels} hold={hold} /></div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Mixer ──────────────────────────────────────────────────────────────

export function MixerTab({ levels, sessions, hold }) {
  return (
    <motion.div className="tab mixer" variants={STAGGER} initial="initial" animate="animate">
      <motion.div variants={RISE} className="card mixer-master">
        <VolumeRow levels={levels} hold={hold} />
        <BrightnessRow levels={levels} hold={hold} />
      </motion.div>
      <div className="mixer-apps">
        {sessions.length === 0 && <div className="muted mixer-empty">No apps are playing sound</div>}
        {sessions.map((s) => (
          <motion.div variants={RISE} layout key={s.pid} className="mixer-app">
            <span className="mixer-icon">{s.icon ? <img src={s.icon} alt="" /> : <VolumeIcon level={60} />}</span>
            <span className="mixer-name" title={s.name}>{s.name}</span>
            <Slider label={`${s.name} volume`} value={s.muted ? 0 : s.volume / 100} onChange={(v) => bridge.setAppVolume(s.pid, v * 100)} onDragChange={hold} />
            <button className={`mixer-mute${s.muted ? ' is-muted' : ''}`} aria-label={s.muted ? 'Unmute' : 'Mute'} onClick={() => bridge.toggleAppMute(s.pid)}>
              <VolumeIcon level={s.muted ? 0 : s.volume} />
            </button>
          </motion.div>
        ))}
      </div>
      <button className="text-button mixer-more" onClick={() => bridge.quickTool('sound')}>Sound settings</button>
    </motion.div>
  );
}

// ── Bluetooth ──────────────────────────────────────────────────────────

export function BluetoothTab({ devices }) {
  const sorted = [...devices].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  return (
    <motion.div className="tab bluetooth" variants={STAGGER} initial="initial" animate="animate">
      <div className="tab-header">
        <span>Paired devices</span>
        <button className="text-button" onClick={() => bridge.quickTool('bluetooth')}>Bluetooth settings</button>
      </div>
      {sorted.length === 0 ? (
        <div className="tab-empty"><span className="empty-icon"><BluetoothIcon /></span>No paired devices</div>
      ) : (
        <div className="bt-list">
          {sorted.map((d) => (
            <motion.div variants={RISE} key={d.name} className={`card bt-device${d.connected ? ' is-connected' : ''}`}>
              <span className="bt-icon"><BluetoothIcon /></span>
              <span className="bt-name">{d.name}</span>
              {d.connected && d.battery >= 0 && (
                <span className={`bt-battery${d.battery <= 20 ? ' is-low' : ''}`}><BatteryIcon level={d.battery} />{d.battery}%</span>
              )}
              <span className="bt-state">{d.connected ? 'Connected' : 'Not connected'}</span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
