// Runs as a plain Node child process so a crash in the native SMTC addon
// can never take down the notch window. Sends { type: 'media', state }.
const { SMTCMonitor } = require('@coooookies/windows-smtc-monitor');

const PLAYING = 4;
let monitor;
try {
  monitor = new SMTCMonitor();
} catch (error) {
  console.error('[media-worker] SMTC unavailable:', error.message);
  process.exit(1);
}

let lastArtKey = null;
let lastSent = '';

function pickSession() {
  const sessions = monitor.sessions.filter((s) => s.media && s.media.title);
  if (!sessions.length) return null;
  const current = SMTCMonitor.getCurrentMediaSession();
  const currentId = current && current.sourceAppId;
  sessions.sort((a, b) => (b.lastUpdatedTime || 0) - (a.lastUpdatedTime || 0));
  const isPlaying = (s) => s.playback && s.playback.playbackStatus === PLAYING;
  return sessions.find((s) => s.sourceAppId === currentId && isPlaying(s))
    || sessions.find(isPlaying)
    || sessions.find((s) => s.sourceAppId === currentId)
    || sessions[0];
}

function mimeOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return 'image/png';
}

function publish() {
  const session = pickSession();
  if (!session) {
    if (lastSent !== 'null') {
      lastSent = 'null';
      lastArtKey = null;
      process.send({ type: 'media', state: null });
    }
    return;
  }

  const { media, playback, timeline } = session;
  const state = {
    appId: session.sourceAppId,
    title: media.title,
    artist: media.artist || media.albumArtist || '',
    album: media.albumTitle || '',
    playing: !!playback && playback.playbackStatus === PLAYING,
    position: timeline ? timeline.position : 0,
    duration: timeline ? timeline.duration : 0,
    // SMTC only updates position on seek/state change; the renderer extrapolates.
    positionAt: Date.now()
  };

  const thumb = media.thumbnail;
  const artKey = thumb && thumb.length ? `${state.appId}|${state.title}|${thumb.length}` : '';
  const signature = JSON.stringify([state.appId, state.title, state.artist, state.playing, state.position, state.duration, artKey]);
  if (signature === lastSent) return;
  lastSent = signature;

  if (artKey !== lastArtKey) {
    lastArtKey = artKey;
    state.art = artKey ? `data:${mimeOf(thumb)};base64,${thumb.toString('base64')}` : null;
  }
  process.send({ type: 'media', state });
}

let pending = null;
function schedulePublish() {
  if (pending) return;
  pending = setTimeout(() => { pending = null; publish(); }, 60);
}

for (const event of ['session-media-changed', 'session-timeline-changed', 'session-playback-changed',
  'session-added', 'session-removed', 'current-session-changed']) {
  monitor.on(event, schedulePublish);
}

// Safety net in case an app updates without raising an event.
setInterval(publish, 2000);
publish();

process.on('disconnect', () => {
  try { monitor.destroy(); } catch (_) {}
  process.exit(0);
});
