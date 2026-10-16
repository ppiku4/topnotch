import { useEffect, useState } from 'react';
import { bridge } from './bridge.js';

export function useMedia() {
  const [media, setMedia] = useState(null);
  useEffect(() => bridge.onMediaState(setMedia), []);
  return media;
}

// SMTC reports position only on change, so extrapolate while playing.
// `seekedTo` ({ position, at }) bridges the gap until SMTC confirms a seek.
export function usePlaybackPosition(media, seekedTo) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!media?.playing) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [media?.playing]);

  if (!media) return 0;
  const useSeek = seekedTo && seekedTo.at > media.positionAt;
  const base = useSeek ? seekedTo.position : media.position;
  const since = useSeek ? seekedTo.at : media.positionAt;
  const elapsed = media.playing ? (now - since) / 1000 : 0;
  const position = base + Math.max(0, elapsed);
  return media.duration > 0 ? Math.min(position, media.duration) : position;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
