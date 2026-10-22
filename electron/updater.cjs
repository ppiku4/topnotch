// Checks the GitHub repository in package.json for a newer release.
// Nothing is downloaded or installed automatically; "Download" opens the
// release page in the browser.
const pkg = require('../package.json');

function repoFromPackage() {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.#]+)/i);
  if (!match || /your-github-username/i.test(match[1])) return null;
  return { owner: match[1], repo: match[2] };
}

const parse = (v) => String(v).replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function checkForUpdate(currentVersion) {
  const repo = repoFromPackage();
  if (!repo) return { status: 'unconfigured', current: currentVersion };
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TopNotch' },
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return { status: 'none', current: currentVersion, repo };
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const release = await response.json();
  return {
    status: isNewer(release.tag_name, currentVersion) ? 'available' : 'current',
    current: currentVersion,
    latest: String(release.tag_name).replace(/^v/i, ''),
    url: release.html_url,
    repo
  };
}

// ── Download and install ──────────────────────────────────────────────────
// Installed (NSIS) builds use electron-updater: it downloads the installer
// named in the release's latest.yml into its cache under %LOCALAPPDATA%,
// checks it against the SHA-512 in latest.yml, then runs it silently and
// relaunches the app. Portable and development copies can't replace
// themselves, so the new exe is downloaded to the Downloads folder instead.
// macOS builds aren't signed with a Developer ID, which Squirrel.Mac needs,
// so there the new DMG is downloaded and opened for a drag-to-install.
const fs = require('fs');
const path = require('path');
const { saveResponse } = require('./download.cjs');

function createInstaller({ app, shell, log, onProgress }) {
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  const mac = process.platform === 'darwin';
  const canSelfInstall = app.isPackaged && !portable && !mac;
  let busy = false;

  async function installWithUpdater() {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = { info: (m) => log('updater: ' + m), warn: (m) => log('updater: ' + m), error: (m) => log('updater error: ' + m), debug: () => {} };
    const onDownload = (p) => onProgress({ phase: 'downloading', percent: Math.round(p.percent), transferred: p.transferred, total: p.total });
    autoUpdater.on('download-progress', onDownload);
    try {
      onProgress({ phase: 'checking' });
      const result = await autoUpdater.checkForUpdates();
      // Compare versions directly: older electron-updater releases don't
      // return isUpdateAvailable.
      const latest = result?.updateInfo?.version;
      if (!latest || !isNewer(latest, app.getVersion())) return { status: 'current' };
      onProgress({ phase: 'downloading', percent: 0 });
      await autoUpdater.downloadUpdate();
      onProgress({ phase: 'installing', version: result.updateInfo.version });
      // Give the UI a moment to show "Installing", then quit; the installer
      // runs silently (/S) and starts the new version when it's done.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
      return { status: 'installing', version: result.updateInfo.version };
    } finally {
      autoUpdater.removeListener('download-progress', onDownload);
    }
  }

  async function downloadToFolder(release) {
    const wanted = mac ? new RegExp(`^TopNotch-[\\d.]+-${process.arch}\\.dmg$`)
      : portable ? /^TopNotch-[\d.]+\.exe$/ : /^TopNotch-Setup-[\d.]+\.exe$/;
    const asset = release.assets.find((a) => wanted.test(a.name));
    if (!asset) throw new Error('no matching download in the release');
    const target = path.join(app.getPath('downloads'), asset.name);
    onProgress({ phase: 'downloading', percent: 0 });
    const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    const partial = target + '.part';
    const expected = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '')?.[1];
    if (!expected) {
      await response.body.cancel();
      throw new Error('the release has no checksum for this file');
    }
    let lastPercent = -1;
    await saveResponse(response, partial, expected, ({ received, progress }) => {
      const percent = Math.floor(progress * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress({ phase: 'downloading', percent, transferred: received, total });
      }
    }, total);
    fs.renameSync(partial, target);
    if (mac) shell.openPath(target); else shell.showItemInFolder(target);
    return { status: 'downloaded', path: target, version: String(release.tag_name).replace(/^v/i, '') };
  }

  return {
    canSelfInstall,
    async install() {
      if (busy) return { status: 'busy' };
      busy = true;
      try {
        if (canSelfInstall) return await installWithUpdater();
        const repo = repoFromPackage();
        if (!repo) return { status: 'unconfigured' };
        const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TopNotch' },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`GitHub ${response.status}`);
        return await downloadToFolder(await response.json());
      } catch (error) {
        log('update: ' + error.message);
        // electron-updater errors include whole HTTP dumps; keep the first line.
        const first = String(error.message || error).split('\n')[0].trim();
        const friendly = /\b404\b/.test(first)
          ? "GitHub returned 404: the release isn't publicly visible."
          : /ENOTFOUND|ETIMEDOUT|ECONNRESET|network|fetch failed/i.test(first)
            ? 'No connection to GitHub.'
            : first.slice(0, 160);
        return { status: 'error', error: friendly };
      } finally {
        busy = false;
      }
    }
  };
}

module.exports = { checkForUpdate, repoFromPackage, createInstaller };
