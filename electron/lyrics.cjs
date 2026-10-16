// Synced lyrics from lrclib.net (free, no key). Returns [{ time, text }] or [].

// YouTube-style titles: "Artist - Song (Live From …) [4K]" with a channel
// name ("ArtistVEVO") as the artist. Split those so the lookup has a chance.
function cleanTrack(title, artist) {
  let name = String(title || '')
    .replace(/\s*[([{【][^)\]}】]*[)\]}】]/g, '')       // any bracketed suffix
    .replace(/\s*\|.*$/, '')                           // "Song | Official Video"
    .trim();
  let who = String(artist || '').replace(/(VEVO|\s*-\s*Topic|Official|Music)$/i, '').trim();
  const dash = name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) { who = dash[1].trim(); name = dash[2].trim(); }
  name = name.replace(/\s+(ft\.?|feat\.?|featuring)\s.+$/i, '').replace(/["“”]/g, '').trim();
  who = who.replace(/\s*(,|&|\bx\b|ft\.?|feat\.?).*$/i, '').trim();
  return { name, artist: who };
}

const stampSeconds = (m, s) => Number(m) * 60 + Number(s);

// Lines: [{ time, text, words? }]. Enhanced LRC ("<mm:ss.xx> word") gives real
// per-word times; plain LRC leaves `words` out and the UI estimates them.
function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '');
    let words;
    if (/<\d+:\d+(?:\.\d+)?>/.test(body)) {
      words = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g)]
        .map((m) => ({ time: stampSeconds(m[1], m[2]), text: m[3].trim() }))
        .filter((w) => w.text);
    }
    const plain = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    for (const s of stamps) {
      lines.push(words?.length ? { time: stampSeconds(s[1], s[2]), text: plain, words } : { time: stampSeconds(s[1], s[2]), text: plain });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TopNotch (https://github.com/)' },
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`lrclib ${response.status}`);
  return response.json();
}

const norm = (v) => String(v || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, '');

// Throws only when every request failed (network trouble), so the caller can retry.
async function fetchLyrics({ title, artist, duration }) {
  const track = cleanTrack(title, artist);
  if (!track.name) return [];
  let failures = 0;
  const attempt = async (url) => {
    try { return await getJson(url); } catch (_) { failures++; return null; }
  };

  const exact = new URLSearchParams({ track_name: track.name, artist_name: track.artist });
  if (duration > 0) exact.set('duration', String(Math.round(duration)));
  let found = await attempt('https://lrclib.net/api/get?' + exact);

  if (!found?.syncedLyrics) {
    const results = await attempt('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${track.artist} ${track.name}` }));
    const name = norm(track.name);
    const who = norm(track.artist);
    // Prefer same artist, then closest duration (live versions run longer).
    const score = (r) => (norm(r.artistName).includes(who) || who.includes(norm(r.artistName)) ? 0 : 1000)
      + (duration > 0 ? Math.abs((r.duration || 0) - duration) : 0);
    found = Array.isArray(results)
      ? results
          .filter((r) => r.syncedLyrics && (norm(r.trackName) === name || norm(r.trackName).includes(name) || name.includes(norm(r.trackName))))
          .sort((a, b) => score(a) - score(b))[0]
      : null;
  }

  if (!found && failures === 2) throw new Error('lrclib unreachable');
  return parseLrc(found?.syncedLyrics);
}

module.exports = { fetchLyrics, cleanTrack, parseLrc };
