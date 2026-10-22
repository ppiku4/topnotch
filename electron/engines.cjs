// Conversion engines TopNotch downloads on first run (or from Settings):
// LibreOffice for office documents. ffmpeg and the background-removal
// models live in convert.cjs and bgremove.cjs; this file holds the shared
// verified download and the LibreOffice install, which differs per OS:
//   macOS:   mount the official DMG, copy LibreOffice.app into userData
//   Windows: extract the official MSI (administrative install, no admin
//            rights, nothing registered with Windows) into userData
const fs = require('fs');
const os = require('os');
const path = require('path');
const { downloadVerified } = require('./download.cjs');
const { spawn } = require('child_process');

const MAC = process.platform === 'darwin';
const LIBREOFFICE_VERSION = '26.2.6';
// The stable mirror drops a version once it's superseded; the archive keeps
// it under its full build number, so it's the fallback.
const LIBREOFFICE = MAC ? {
  urls: [
    `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/mac/aarch64/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_aarch64.dmg`,
    `https://downloadarchive.documentfoundation.org/libreoffice/old/${LIBREOFFICE_VERSION}.3/mac/aarch64/LibreOffice_${LIBREOFFICE_VERSION}.3_MacOS_aarch64.dmg`
  ],
  sha256: '94bb3248df074c225490a8a6d1d9dc87c7d6783dbb7a8e9f0d0c3d94348552af',
  size: '284 MB'
} : {
  urls: [
    `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`,
    `https://downloadarchive.documentfoundation.org/libreoffice/old/${LIBREOFFICE_VERSION}.3/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}.3_Win_x86-64.msi`
  ],
  sha256: 'f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660',
  size: '356 MB'
};

function run(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, ...options });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() || `${path.basename(exe)} exit ${code}`))));
  });
}

function createLibreOffice({ dir, log }) {
  const home = path.join(dir, 'vendor', 'libreoffice');
  const bundled = MAC
    ? path.join(home, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
    : path.join(home, 'program', 'soffice.exe');
  let installing = null;

  // Our download first, then a copy the user installed themselves.
  function find() {
    if (fs.existsSync(bundled)) return bundled;
    if (MAC) {
      const app = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
      return fs.existsSync(app) ? app : null;
    }
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    for (const root of roots) {
      const exe = path.join(root, 'LibreOffice', 'program', 'soffice.exe');
      if (fs.existsSync(exe)) return exe;
    }
    return null;
  }

  // MSI administrative installs put files under TARGETDIR following the
  // package's folder table; find program\soffice.exe wherever it landed
  // and move that folder up to `home`.
  function findProgramDir(root, depth = 0) {
    if (depth > 3) return null;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(root, entry.name);
      if (entry.name.toLowerCase() === 'program' && fs.existsSync(path.join(full, 'soffice.exe'))) return root;
      const found = findProgramDir(full, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function install(onProgress) {
    if (installing) return installing;
    installing = (async () => {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'topnotch-lo-'));
      try {
        const file = path.join(work, MAC ? 'LibreOffice.dmg' : 'LibreOffice.msi');
        // Download is most of the time; unpacking takes the last 10%.
        await downloadVerified(LIBREOFFICE.urls, LIBREOFFICE.sha256, file, (p) => onProgress?.(p * 0.9));
        await fs.promises.rm(home, { recursive: true, force: true });
        fs.mkdirSync(home, { recursive: true });
        if (MAC) {
          const mount = path.join(work, 'mnt');
          fs.mkdirSync(mount);
          await run('/usr/bin/hdiutil', ['attach', file, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount]);
          try {
            // ditto keeps the app's signature, symlinks and extended attributes.
            await run('/usr/bin/ditto', [path.join(mount, 'LibreOffice.app'), path.join(home, 'LibreOffice.app')]);
          } finally {
            await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {});
          }
        } else {
          const target = path.join(work, 'extract');
          await run('msiexec.exe', ['/a', file, '/qn', `TARGETDIR=${target}`]);
          const root = findProgramDir(target);
          if (!root) throw new Error('soffice.exe missing after extracting LibreOffice');
          for (const entry of fs.readdirSync(root)) {
            // An administrative install keeps a copy of the MSI; drop it.
            if (entry.toLowerCase().endsWith('.msi')) continue;
            await fs.promises.rename(path.join(root, entry), path.join(home, entry));
          }
        }
        if (!fs.existsSync(bundled)) throw new Error('LibreOffice did not install correctly');
        onProgress?.(1);
        log(`LibreOffice ${LIBREOFFICE_VERSION} installed`);
        return bundled;
      } catch (error) {
        await fs.promises.rm(home, { recursive: true, force: true }).catch(() => {});
        throw error;
      } finally {
        installing = null;
        fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    })();
    return installing;
  }

  return {
    find,
    install,
    bundled: () => fs.existsSync(bundled),
    remove: () => fs.promises.rm(home, { recursive: true, force: true }),
    info: { version: LIBREOFFICE_VERSION, size: LIBREOFFICE.size }
  };
}

module.exports = { downloadVerified, createLibreOffice };
