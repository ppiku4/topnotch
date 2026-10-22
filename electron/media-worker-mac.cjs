// macOS media worker: the counterpart of media-worker.cjs. Since macOS 15.4,
// apps can't read the system Now Playing info directly, so this runs
// ungive/mediaremote-adapter (BSD-3) through the system Perl, which macOS
// still allows, and turns its JSON stream into the same { type: 'media' }
// messages. Also carries play/pause/next/previous and seek back to it.
//
// argv: <path to mediaremote-adapter.pl> <path to MediaRemoteAdapter.framework>
const { spawn } = require('child_process');
const readline = require('readline');

const [script, framework] = process.argv.slice(2);
const PERL = '/usr/bin/perl';
const COMMANDS = { 'play-pause': 2, next: 4, previous: 5 };

let current = {};      // merged payload (the stream sends diffs)
let lastSent = '';
let lastArtKey = null;
let stream = null;
let restartDelay = 2000;

function publish() {
  const p = current;
  if (!p || !p.title || !p.bundleIdentifier) {
    if (lastSent !== 'null') {
      lastSent = 'null';
      lastArtKey = null;
      process.send({ type: 'media', state: null });
    }
    return;
  }
  const micros = (v) => (Number.isFinite(v) ? v / 1e6 : 0);
  const state = {
    appId: p.bundleIdentifier,
    title: p.title,
    artist: p.artist || '',
    album: p.album || '',
    playing: !!p.playing,
    position: micros(p.elapsedTimeMicros),
    duration: micros(p.durationMicros),
    // When elapsedTime was taken; the renderer extrapolates from there.
    positionAt: Number.isFinite(p.timestampEpochMicros) ? Math.round(p.timestampEpochMicros / 1000) : Date.now()
  };
  const artKey = p.artworkData ? `${state.appId}|${state.title}|${p.artworkData.length}` : '';
  const signature = JSON.stringify([state.appId, state.title, state.artist, state.playing, state.position, state.positionAt, state.duration, artKey]);
  if (signature === lastSent) return;
  lastSent = signature;
  if (artKey !== lastArtKey) {
    lastArtKey = artKey;
    state.art = artKey ? `data:${p.artworkMimeType || 'image/jpeg'};base64,${p.artworkData}` : null;
  }
  process.send({ type: 'media', state });
}

function startStream() {
  stream = spawn(PERL, [script, framework, 'stream', '--micros', '--debounce=80'], { stdio: ['ignore', 'pipe', 'pipe'] });
  readline.createInterface({ input: stream.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (!msg || msg.type !== 'data' || !msg.payload) return;
    restartDelay = 2000; // healthy again
    if (msg.diff) {
      for (const [key, value] of Object.entries(msg.payload)) {
        if (value === null) delete current[key]; else current[key] = value;
      }
    } else {
      current = { ...msg.payload };
    }
    publish();
  });
  stream.stderr.on('data', (chunk) => console.error('[mediaremote] ' + String(chunk).trim()));
  // Perl couldn't start at all: 'exit' won't follow, so retry from here.
  stream.on('error', (error) => {
    console.error('[mediaremote] ' + error.message);
    stream = null;
    setTimeout(startStream, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 60000);
  });
  stream.on('exit', (code) => {
    stream = null;
    console.error(`[mediaremote] stream exited ${code}, restarting in ${restartDelay}ms`);
    setTimeout(startStream, restartDelay);
    // A missing or broken adapter shouldn't respawn Perl every 2 s forever.
    restartDelay = Math.min(restartDelay * 2, 60000);
  });
}

function run(args) {
  const child = spawn(PERL, [script, framework, ...args], { stdio: 'ignore' });
  child.on('error', (error) => console.error('[mediaremote] ' + error.message));
}

process.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'control' && COMMANDS[msg.action] != null) run(['send', String(COMMANDS[msg.action])]);
  if (msg.type === 'seek' && Number.isFinite(msg.seconds)) run(['seek', String(Math.max(0, Math.round(msg.seconds * 1e6)))]);
});

process.on('disconnect', () => {
  if (stream) stream.kill('SIGTERM');
  process.exit(0);
});

startStream();
