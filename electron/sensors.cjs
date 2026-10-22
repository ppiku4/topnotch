// CPU temperature via LibreHardwareMonitor (MPL-2.0). Windows gives normal
// apps no CPU sensor, so TopNotch downloads LHM on request and reads its web
// server, bound to 127.0.0.1 only, so nothing is reachable from the network.
//
// LHM needs administrator rights. To keep that from becoming a way for any
// program to gain them, the elevated copy never runs from a user-writable
// folder: the download (checked against a pinned SHA-256) is kept in
// userData, and the elevated step checks it again and unpacks it into
// Program Files, which only administrators can change. Both "Start as
// admin" and the sign-in task run that copy.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VERSION = 'v0.9.6';
const DOWNLOAD_URL = `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/${VERSION}/LibreHardwareMonitor.zip`;
const DOWNLOAD_SHA256 = '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001';
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

function settingsXml() {
  const escape = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const body = Object.entries(LHM_SETTINGS).map(([k, v]) => `    <add key="${escape(k)}" value="${escape(v)}" />`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <appSettings>\n${body}\n  </appSettings>\n</configuration>\n`;
}

function powershell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 180000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

// Single-quoted PowerShell string literal.
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Runs `script` in an elevated PowerShell (one UAC prompt) and waits for it.
// -EncodedCommand carries the script as base64, so paths with quotes or
// spaces can't break out of it. Exit codes: 0 ok, 3 checksum mismatch.
async function elevated(script) {
  const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, 'utf16le').toString('base64');
  const code = await powershell(
    `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'; ` +
    `[Console]::Out.Write($p.ExitCode)`
  );
  if (code === '3') throw new Error('The LibreHardwareMonitor download failed its checksum.');
  if (code !== '0') throw new Error(`The administrator step failed (exit ${code}).`);
}

function createSensors({ dir, log }) {
  const home = path.join(dir, 'vendor', 'LibreHardwareMonitor');
  const zip = path.join(home, `LibreHardwareMonitor-${VERSION}.zip`);
  const legacyExe = path.join(home, 'LibreHardwareMonitor.exe'); // pre-0.1.11 installs ran from here
  const secureDir = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'TopNotch Sensors', 'LibreHardwareMonitor');
  const secureExe = path.join(secureDir, 'LibreHardwareMonitor.exe');
  let busy = null;

  const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const zipReady = () => { try { return sha256(zip) === DOWNLOAD_SHA256; } catch (_) { return false; } };
  const secured = () => fs.existsSync(secureExe) && fs.existsSync(path.join(secureDir, `topnotch-${VERSION}`));
  const installed = () => zipReady() || secured();

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

  // The task's command line, or null when there's no task.
  async function taskCommand() {
    try {
      const xml = await new Promise((resolve, reject) => execFile('schtasks.exe', ['/Query', '/TN', TASK_NAME, '/XML'], { windowsHide: true }, (e, out) => (e ? reject(e) : resolve(out))));
      const match = /<Command>([^<]*)<\/Command>/i.exec(xml);
      return match ? match[1].replace(/&quot;/g, '"').replace(/^"|"$/g, '') : '';
    } catch (_) { return null; }
  }

  async function download() {
    fs.mkdirSync(home, { recursive: true });
    log(`sensors: downloading ${DOWNLOAD_URL}`);
    const response = await fetch(DOWNLOAD_URL, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(buffer).digest('hex') !== DOWNLOAD_SHA256) {
      throw new Error('The LibreHardwareMonitor download failed its checksum.');
    }
    fs.writeFileSync(zip, buffer);
  }

  // PowerShell that (re)installs the verified zip into Program Files unless
  // this version is already there. Runs elevated.
  function installScript() {
    return [
      `$zip = ${psQuote(zip)}`,
      `$target = ${psQuote(secureDir)}`,
      `$marker = Join-Path $target ${psQuote(`topnotch-${VERSION}`)}`,
      `if (-not ((Test-Path -LiteralPath $marker) -and (Test-Path -LiteralPath (Join-Path $target 'LibreHardwareMonitor.exe')))) {`,
      `  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower() -ne ${psQuote(DOWNLOAD_SHA256)}) { exit 3 }`,
      `  Get-Process -Name LibreHardwareMonitor -ErrorAction SilentlyContinue | Stop-Process -Force`,
      `  Start-Sleep -Milliseconds 500`,
      `  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }`,
      `  New-Item -ItemType Directory -Force -Path $target | Out-Null`,
      `  Expand-Archive -LiteralPath $zip -DestinationPath $target -Force`,
      `  Set-Content -LiteralPath $marker -Value ${psQuote(VERSION)}`,
      `}`,
      `Set-Content -LiteralPath (Join-Path $target 'LibreHardwareMonitor.config') -Encoding UTF8 -Value ${psQuote(settingsXml())}`
    ].join('\n');
  }

  async function ensureZip() {
    if (!zipReady()) await download();
  }

  return {
    info: { version: VERSION, url: DOWNLOAD_URL, size: DOWNLOAD_SIZE },

    async status() {
      const command = await taskCommand();
      const atSignIn = command !== null;
      return {
        installed: installed() || fs.existsSync(legacyExe),
        running: await running(),
        atSignIn,
        // A task left by an older version points at the user-writable copy.
        taskNeedsUpdate: atSignIn && path.resolve(command || '').toLowerCase() !== secureExe.toLowerCase(),
        busy: busy !== null
      };
    },

    async readCpuTemperature() {
      try { return cpuTemperature(await readJson()); } catch (_) { return null; }
    },

    async install() {
      if (busy) return busy;
      busy = ensureZip().then(() => log('sensors: downloaded and verified')).finally(() => { busy = null; });
      return busy;
    },

    // One UAC prompt: install into Program Files if needed, then start it.
    async start() {
      await ensureZip();
      await elevated(`${installScript()}\nStart-Process -FilePath (Join-Path $target 'LibreHardwareMonitor.exe') -WorkingDirectory $target -WindowStyle Minimized`);
      // The old user-folder copy is no longer used.
      if (fs.existsSync(legacyExe)) {
        for (const entry of fs.readdirSync(home)) {
          if (entry !== path.basename(zip)) fs.rmSync(path.join(home, entry), { recursive: true, force: true });
        }
      }
      for (let i = 0; i < 20; i++) {
        if (await running()) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return running();
    },

    // A scheduled task with highest privileges starts LHM at sign-in without
    // a UAC prompt each time; it always points at the Program Files copy.
    async setAtSignIn(on) {
      if (on) {
        await ensureZip();
        await elevated(`${installScript()}\n& schtasks.exe /Create /F /TN ${psQuote(TASK_NAME)} /SC ONLOGON /RL HIGHEST /TR ('"' + (Join-Path $target 'LibreHardwareMonitor.exe') + '"') | Out-Null\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`);
      } else {
        await elevated(`& schtasks.exe /Delete /F /TN ${psQuote(TASK_NAME)} | Out-Null`);
      }
      return (await taskCommand()) !== null;
    }
  };
}

module.exports = { createSensors };
