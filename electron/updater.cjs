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

module.exports = { checkForUpdate, repoFromPackage };
