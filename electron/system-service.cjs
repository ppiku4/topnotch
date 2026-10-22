const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// Owns the long-lived native helper and turns its JSON lines into level
// updates: system-helper.cs (compiled by PowerShell) on Windows, the Swift
// topnotch-helper binary on macOS. Restarts the helper if it exits.
function createSystemService({ onLevels, onEvent = () => {}, log = console.log }) {
  const levels = { volume: null, muted: false, brightness: null, brightnessSupported: false };
  let child = null;
  let stopped = false;
  let restartDelay = 1000;
  let restartTimer = null;
  const subscriptions = { stats: false, meter: false, fileclick: 'fileclick off' };

  function spawnHelper() {
    if (process.platform === 'darwin') {
      // Packaged: Contents/Resources/topnotch-helper; dev: build/mac/.
      const packaged = process.resourcesPath && path.join(process.resourcesPath, 'topnotch-helper');
      const exe = packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'build', 'mac', 'topnotch-helper');
      return spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    }
    // Packaged builds keep the helper outside the ASAR (asarUnpack) because
    // PowerShell can't read files inside it.
    const dir = __dirname.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
    return spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(dir, 'system-helper.ps1'),
      '-SourcePath', path.join(dir, 'system-helper.cs')
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  function start() {
    if (stopped || child) return;
    clearTimeout(restartTimer);
    child = spawnHelper();
    child.on('error', (error) => log('[system-helper] ' + error.message));

    readline.createInterface({ input: child.stdout }).on('line', handleLine);
    child.stderr.on('data', (chunk) => log('[system-helper] ' + String(chunk).trim()));
    child.on('exit', (code) => {
      child = null;
      if (stopped) return;
      log(`[system-helper] exited with ${code}, restarting in ${restartDelay}ms`);
      restartTimer = setTimeout(start, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 30000);
    });
  }

  function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (msg.type === 'ready') {
      restartDelay = 1000;
      command(subscriptions.stats ? 'stats on' : 'stats off');
      command(subscriptions.meter ? 'meter on' : 'meter off');
      command(subscriptions.fileclick);
      onEvent(msg);
      return;
    }
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
    } else if (msg.type === 'privacy' || msg.type === 'net' || msg.type === 'bluetooth' || msg.type === 'timeline' || msg.type === 'mixer' || msg.type === 'peak' || msg.type === 'file-click' || msg.type === 'file-drag') {
      onEvent(msg);
    }
  }

  // One command per line: anything that came from outside (a media app's
  // ID) can't smuggle in a second command with a line break.
  function command(line) {
    if (child && child.stdin.writable) child.stdin.write(String(line).replace(/[\r\n]+/g, ' ') + '\n');
  }

  const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));

  start();
  return {
    getLevels: () => ({ ...levels }),
    setVolume: (value) => command(`volume ${clampPercent(value)}`),
    toggleMute: () => command('mute toggle'),
    setBrightness: (value) => command(`brightness ${clampPercent(value)}`),
    setStats: (on) => { subscriptions.stats = !!on; command(on ? 'stats on' : 'stats off'); },
    listMixer: () => command('mixer list'),
    resendTimeline: () => command('timeline'),
    setMeter: (on) => { subscriptions.meter = !!on; command(on ? 'meter on' : 'meter off'); },
    setFileClick: (on, exts = []) => { subscriptions.fileclick = on ? `fileclick on ${exts.filter((e) => /^[a-z0-9]+$/.test(e)).join(',')}` : 'fileclick off'; command(subscriptions.fileclick); },
    setAppVolume: (pid, value) => command(`mixer set ${pid} ${clampPercent(value)}`),
    toggleAppMute: (pid) => command(`mixer mute ${pid} toggle`),
    seek: (seconds, appId) => command(`seek ${Math.max(0, seconds).toFixed(3)}${appId ? ' ' + appId : ''}`),
    // COM endpoints and DDC handles go stale across sleep.
    restart: () => { if (child) child.kill(); else start(); },
    stop: () => { stopped = true; clearTimeout(restartTimer); if (child) child.kill(); }
  };
}

module.exports = { createSystemService };
