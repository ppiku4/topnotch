const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// Owns the long-lived PowerShell helper (system-helper.cs) and turns its
// JSON lines into level updates. Restarts the helper if it exits.
function createSystemService({ onLevels, onEvent = () => {}, log = console.log }) {
  const levels = { volume: null, muted: false, brightness: null, brightnessSupported: false };
  let child = null;
  let stopped = false;
  let restartDelay = 1000;

  function start() {
    // Packaged builds keep the helper outside the ASAR (asarUnpack) because
    // PowerShell can't read files inside it.
    const dir = __dirname.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(dir, 'system-helper.ps1'),
      '-SourcePath', path.join(dir, 'system-helper.cs')
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', handleLine);
    child.stderr.on('data', (chunk) => log('[system-helper] ' + String(chunk).trim()));
    child.on('exit', (code) => {
      child = null;
      if (stopped) return;
      log(`[system-helper] exited with ${code}, restarting in ${restartDelay}ms`);
      setTimeout(start, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 30000);
    });
  }

  function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (msg.type === 'ready') { restartDelay = 1000; onEvent(msg); return; }
    if (msg.type === 'error') { log('[system-helper] ' + msg.message); return; }
    if (msg.type === 'volume') {
      const changed = levels.volume !== null && (levels.volume !== msg.value || levels.muted !== msg.muted);
      levels.volume = msg.value;
      levels.muted = msg.muted;
      onLevels({ ...levels }, changed ? 'volume' : null);
    } else if (msg.type === 'brightness') {
      const changed = levels.brightness !== null && levels.brightness !== msg.value;
      levels.brightness = msg.supported ? msg.value : null;
      levels.brightnessSupported = msg.supported;
      onLevels({ ...levels }, changed ? 'brightness' : null);
    } else if (msg.type === 'privacy' || msg.type === 'net' || msg.type === 'bluetooth' || msg.type === 'timeline' || msg.type === 'mixer' || msg.type === 'peak') {
      onEvent(msg);
    }
  }

  function command(line) {
    if (child && child.stdin.writable) child.stdin.write(line + '\n');
  }

  const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));

  start();
  return {
    getLevels: () => ({ ...levels }),
    setVolume: (value) => command(`volume ${clampPercent(value)}`),
    toggleMute: () => command('mute toggle'),
    setBrightness: (value) => command(`brightness ${clampPercent(value)}`),
    setStats: (on) => command(on ? 'stats on' : 'stats off'),
    listMixer: () => command('mixer list'),
    resendTimeline: () => command('timeline'),
    setMeter: (on) => command(on ? 'meter on' : 'meter off'),
    setAppVolume: (pid, value) => command(`mixer set ${pid} ${clampPercent(value)}`),
    toggleAppMute: (pid) => command(`mixer mute ${pid} toggle`),
    seek: (seconds, appId) => command(`seek ${Math.max(0, seconds).toFixed(3)}${appId ? ' ' + appId : ''}`),
    // COM endpoints and DDC handles go stale across sleep.
    restart: () => { if (child) child.kill(); else start(); },
    stop: () => { stopped = true; if (child) child.kill(); }
  };
}

module.exports = { createSystemService };
