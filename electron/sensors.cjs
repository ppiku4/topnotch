// CPU temperature via LibreHardwareMonitor (MPL-2.0). Windows gives normal
// apps no CPU sensor, so TopNotch downloads LHM on request into userData,
// starts it elevated (UAC prompt) and reads its web server, bound to
// 127.0.0.1 only, so nothing is reachable from the network.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const VERSION = 'v0.9.6';
const DOWNLOAD_URL = `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/${VERSION}/LibreHardwareMonitor.zip`;
const DOWNLOAD_SIZE = '6.3 MB';
const PORT = 18085;
const TASK_NAME = 'TopNotch Sensors';

// LHM reads "<exe name>.config" next to the exe (appSettings key/value).
const LHM_SETTINGS = {
  startMinMenuItem: 'true',
  minTrayMenuItem: 'true',
  minCloseMenuItem: 'true',
  runWebServerMenuItem: 'true',
  listenerIp: '127.0.0.1',
  listenerPort: String(PORT),
  authenticationEnabled: 'false'
};

function powershell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function createSensors({ dir, log }) {
  const home = path.join(dir, 'vendor', 'LibreHardwareMonitor');
  const exe = path.join(home, 'LibreHardwareMonitor.exe');
  let busy = null;

  const installed = () => fs.existsSync(exe);

  function writeSettings() {
    const file = path.join(home, 'LibreHardwareMonitor.config');
    let current = {};
    try {
      const xml = fs.readFileSync(file, 'utf8');
      for (const m of xml.matchAll(/<add key="([^"]+)" value="([^"]*)"\s*\/>/g)) current[m[1]] = m[2];
    } catch (_) {}
    const merged = { ...current, ...LHM_SETTINGS };
    const escape = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const body = Object.entries(merged).map(([k, v]) => `    <add key="${escape(k)}" value="${escape(v)}" />`).join('\n');
    fs.writeFileSync(file, `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <appSettings>\n${body}\n  </appSettings>\n</configuration>\n`);
  }

  async function readJson() {
    const response = await fetch(`http://127.0.0.1:${PORT}/data.json`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`LHM ${response.status}`);
    return response.json();
  }

  // Hottest CPU temperature sensor in LHM's tree ("CPU Package", "Core (Tctl/Tdie)", …).
  function cpuTemperature(node, inCpu = false) {
    let best = null;
    const isCpu = inCpu || /\/(amdcpu|intelcpu)\//.test(node.SensorId || '') || /cpu\.png$/i.test(node.ImageURL || '');
    if (isCpu && node.Type === 'Temperature' && typeof node.Value === 'string') {
      const value = parseFloat(node.Value.replace(',', '.'));
      if (Number.isFinite(value)) best = value;
    }
    for (const child of node.Children || []) {
      const v = cpuTemperature(child, isCpu);
      if (v != null && (best == null || v > best)) best = v;
    }
    return best;
  }

  async function running() {
    try { await readJson(); return true; } catch (_) { return false; }
  }

  async function taskExists() {
    try {
      await new Promise((resolve, reject) => execFile('schtasks.exe', ['/Query', '/TN', TASK_NAME], { windowsHide: true }, (e) => (e ? reject(e) : resolve())));
      return true;
    } catch (_) { return false; }
  }

  return {
    info: { version: VERSION, url: DOWNLOAD_URL, size: DOWNLOAD_SIZE },

    async status() {
      return { installed: installed(), running: await running(), atSignIn: await taskExists(), busy: busy !== null };
    },

    async readCpuTemperature() {
      try { return cpuTemperature(await readJson()); } catch (_) { return null; }
    },

    async install() {
      if (busy) return busy;
      busy = (async () => {
        fs.mkdirSync(home, { recursive: true });
        const zip = path.join(home, 'LibreHardwareMonitor.zip');
        log(`sensors: downloading ${DOWNLOAD_URL}`);
        const response = await fetch(DOWNLOAD_URL, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`download failed (${response.status})`);
        fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
        await powershell(`Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(home)} -Force`);
        fs.rmSync(zip, { force: true });
        if (!installed()) throw new Error('LibreHardwareMonitor.exe not found in the download');
        writeSettings();
        log('sensors: installed');
      })().finally(() => { busy = null; });
      return busy;
    },

    // Shows the Windows UAC prompt; rejects if the user declines.
    async start() {
      if (!installed()) throw new Error('not installed');
      writeSettings();
      await powershell(`Start-Process -FilePath ${psQuote(exe)} -WorkingDirectory ${psQuote(home)} -Verb RunAs -WindowStyle Minimized`);
      for (let i = 0; i < 20; i++) {
        if (await running()) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return running();
    },

    // A scheduled task with highest privileges starts LHM at sign-in without
    // a UAC prompt each time. Creating or removing it needs one UAC prompt.
    async setAtSignIn(on) {
      const action = on
        ? `schtasks.exe /Create /F /TN '${TASK_NAME}' /SC ONLOGON /RL HIGHEST /TR '\\"${exe}\\"'`
        : `schtasks.exe /Delete /F /TN '${TASK_NAME}'`;
      await powershell(`Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile', '-Command', ${psQuote(action)}`);
      return taskExists();
    }
  };
}

module.exports = { createSensors };
