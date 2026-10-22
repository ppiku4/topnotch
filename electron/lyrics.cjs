// Synced lyrics from lrclib.net (free, no key; https://lrclib.net/docs).
// Returns { lines: [{ time, end?, text, words? }], id, duration }.
const YAML = require('yaml');
const { version } = require('../package.json');

// The docs ask clients to name themselves with version and homepage.
const USER_AGENT = `TopNotch v${version} (https://github.com/ppiku4/topnotch)`;

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

// Lyricsfile (YAML, on every record) carries line end times and, for
// word-synced records (hasWordSync), real per-word times. End times let a
// line's last words finish when the singer stops instead of stretching
// into the gap before the next line.
function parseLyricsfile(text) {
  let doc;
  try { doc = YAML.parse(String(text || '')); } catch (_) { return null; }
  if (!doc || !Array.isArray(doc.lines)) return null;
  const sec = (ms) => (Number.isFinite(Number(ms)) ? Number(ms) / 1000 : null);
  const lines = [];
  for (const l of doc.lines) {
    const time = sec(l?.start_ms);
    if (time == null) continue;
    const line = { time, text: String(l.text ?? '').replace(/\s+/g, ' ').trim() };
    const end = sec(l.end_ms);
    if (end != null && end > time) line.end = end;
    if (Array.isArray(l.words)) {
      const words = l.words
        .map((w) => ({ time: sec(w?.start_ms), end: sec(w?.end_ms), text: String(w?.text ?? '').trim() }))
        .filter((w) => w.time != null && w.text);
      if (words.length) line.words = words.map((w) => (w.end != null && w.end > w.time ? w : { time: w.time, text: w.text }));
    }
    lines.push(line);
  }
  return lines.sort((a, b) => a.time - b.time);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One request at a time with a short gap (the docs' throttling advice);
// 429/503 wait out Retry-After plus jitter, once.
let queue = Promise.resolve();
function getJson(url) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404) return null;
      if ((response.status === 429 || response.status === 503) && attempt === 0) {
        const wait = Math.min(30, Number(response.headers.get('retry-after')) || 2);
        await sleep(wait * 1000 * (1 + Math.random() * 0.3));
        continue;
      }
      if (!response.ok) throw new Error(`lrclib ${response.status}`);
      if (!/json/i.test(response.headers.get('content-type') || '')) throw new Error('lrclib sent no JSON');
      return response.json();
    }
  };
  const result = queue.then(run);
  queue = result.catch(() => {}).then(() => sleep(300));
  return result;
}

const norm = (v) => String(v || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, '');

// lrclib holds several crowd-synced copies of most songs: album cuts, radio
// edits and ones timed against the YouTube video (often stored under the
// video's full title). They differ by seconds, so a wrong pick shifts every
// line. Gather all candidates (exact lookup, cleaned search, raw-title
// search) and take the one whose duration is closest to what's playing;
// copies stored under the exact playing title win ties, since they were
// usually synced to this very upload.
function pickBest(candidates, { name, who, rawTitle, duration }) {
  const raw = norm(rawTitle);
  const scored = [];
  const seen = new Set();
  for (const r of candidates) {
    if (!r?.syncedLyrics || seen.has(r.id)) continue;
    seen.add(r.id);
    const track = norm(r.trackName);
    const sameRaw = raw && track === raw;
    if (!sameRaw && !(track === name || track.includes(name) || name.includes(track))) continue;
    const artist = norm(r.artistName);
    const sameArtist = !who || artist.includes(who) || who.includes(artist) || raw.includes(artist);
    let score = sameArtist ? 0 : 100;
    if (duration > 0) score += Math.abs((r.duration || 0) - duration) * 4;
    if (sameRaw) score -= 3;
    if (r.hasWordSync) score -= 2;
    if (/\b(live|remix|acoustic|sped|slowed|nightcore|karaoke|instrumental|cover)\b/i.test(r.trackName + ' ' + r.albumName)
      && !/\b(live|remix|acoustic|sped|slowed|nightcore|karaoke|instrumental|cover)\b/i.test(rawTitle)) score += 40;
    scored.push({ r, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.r || null;
}

// Throws only when every request failed (network trouble), so the caller can retry.
async function fetchLrclib({ title, artist, album, duration }) {
  const track = cleanTrack(title, artist);
  if (!track.name) return { lines: [] };
  let requests = 0;
  let failures = 0;
  const attempt = async (url) => {
    requests++;
    try { return await getJson(url); } catch (_) { failures++; return null; }
  };
  const params = (fields) => new URLSearchParams(Object.entries(fields).filter(([, v]) => v));
  const toResult = (record) => ({
    lines: (record?.syncedLyrics || record?.hasWordSync) && parseLyricsfile(record.lyricsfile)?.length
      ? parseLyricsfile(record.lyricsfile)
      : parseLrc(record?.syncedLyrics),
    id: record?.id ?? null,
    duration: record?.duration ?? null,
    wordSync: !!record?.hasWordSync
  });

  // The signature lookup matches within ±2 s of the duration; a copy within
  // a second of what's playing is as good as it gets, so stop there.
  const found = await attempt('https://lrclib.net/api/get?' + params({
    track_name: track.name,
    artist_name: track.artist,
    album_name: album && !/youtube|vevo/i.test(album) ? album : '',
    duration: duration >= 1 && duration <= 3600 ? String(Math.round(duration)) : ''
  }));
  if (found?.syncedLyrics && duration > 0 && Math.abs((found.duration || 0) - duration) <= 1) return toResult(found);

  const byName = await attempt('https://lrclib.net/api/search?' + params({ q: `${track.artist} ${track.name}` }));
  // Videos are often stored under their full title; worth a look only when
  // the title isn't already clean.
  const byTitle = norm(title) !== norm(track.name)
    ? await attempt('https://lrclib.net/api/search?' + params({ track_name: String(title || '') }))
    : null;
  if (failures === requests) throw new Error('lrclib unreachable');

  const candidates = [found, ...(Array.isArray(byName) ? byName : []), ...(Array.isArray(byTitle) ? byTitle : [])];
  return toResult(pickBest(candidates, { name: norm(track.name), who: norm(track.artist), rawTitle: title, duration }));
}


// ── Word timing from NetEase Cloud Music ──────────────────────────────────
// lrclib is almost always line-synced only, and estimated word timing can't
// follow how a line is actually sung. NetEase's "yrc" lyrics carry real
// per-word start/duration for most popular songs, so TopNotch uses them for
// the words and lrclib (matched to the exact upload) for where they sit.

const NETEASE = 'https://music.163.com/api';
const NETEASE_HEADERS = { 'User-Agent': USER_AGENT, Referer: 'https://music.163.com/' };
const VERSION_WORDS = /\b(live|remix|acoustic|sped|slowed|nightcore|karaoke|instrumental|cover|reverb|8d|edit)\b/i;

async function neteaseJson(url) {
  const response = await fetch(url, { headers: NETEASE_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('netease ' + response.status);
  return response.json();
}

// "[start,dur](ws,wd,0)Word (ws,wd,0)word …" → { time, end, text, words }.
function parseYrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const head = /^\[(\d+),(\d+)\]/.exec(raw);
    if (!head) continue; // credits are JSON lines
    const tokens = [...raw.slice(head[0].length).matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)]
      .map((m) => ({ time: +m[1] / 1000, end: (+m[1] + +m[2]) / 1000, text: m[3].trim().replace(/[（]/g, '(').replace(/[）]/g, ')') }))
      .filter((w) => w.text);
    // Punctuation arrives as its own token ("Love", ","): glue closing marks
    // to the word before and opening brackets to the word after.
    const words = [];
    let opening = '';
    for (const t of tokens) {
      if (/^[(\[“"]+$/.test(t.text)) { opening += t.text; continue; }
      if (/^[^\p{L}\p{N}]+$/u.test(t.text) && words.length) { words[words.length - 1].text += t.text; continue; }
      words.push({ ...t, text: opening + t.text });
      opening = '';
    }
    if (!words.length) continue;
    const time = +head[1] / 1000;
    lines.push({ time, end: time + +head[2] / 1000, text: words.map((w) => w.text).join(' '), words });
  }
  return lines;
}

async function fetchNetease(track, rawTitle, duration) {
  const search = await neteaseJson(NETEASE + '/search/get?' + new URLSearchParams({ s: track.artist + ' ' + track.name, type: '1', limit: '10' }));
  const name = norm(track.name);
  const who = norm(track.artist);
  const songs = (search?.result?.songs || []).filter((song) => {
    const songName = norm(song.name);
    if (!(songName === name || songName.startsWith(name) || name.startsWith(songName))) return false;
    if (VERSION_WORDS.test(song.name) && !VERSION_WORDS.test(rawTitle)) return false;
    return !who || (song.artists || []).some((a) => norm(a.name).includes(who) || who.includes(norm(a.name)));
  });
  songs.sort((a, b) => (duration > 0 ? Math.abs(a.duration / 1000 - duration) - Math.abs(b.duration / 1000 - duration) : 0));
  for (const song of songs.slice(0, 2)) {
    const lyric = await neteaseJson(NETEASE + '/song/lyric/v1?' + new URLSearchParams({ id: String(song.id), lv: '1', yv: '1', tv: '0', rv: '0' }));
    const lines = parseYrc(lyric?.yrc?.lyric);
    if (lines.length >= 4) return { lines, duration: song.duration / 1000, id: song.id };
  }
  return null;
}

// Word overlap between two lines, 0..1 ("swimmin'" vs "swimming" count).
function similarity(a, b) {
  const words = (text) => String(text).toLowerCase().replace(/in'(?=\s|$)/g, 'ing').match(/[a-z0-9À-￿]+/g) || [];
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return 0;
  const pool = new Map();
  for (const w of y) pool.set(w, (pool.get(w) || 0) + 1);
  let common = 0;
  for (const w of x) if (pool.get(w) > 0) { common++; pool.set(w, pool.get(w) - 1); }
  return (2 * common) / (x.length + y.length);
}

// NetEase times the album cut; the upload playing can differ (an intro, a
// cut verse, a longer pause). Pair lines in order with a longest-common-
// subsequence over fuzzy text, so repeated choruses pair with the right
// occurrence, then move each NetEase line to its partner's time, keeping
// its word timing. Unpaired lines take the shift of the nearest paired
// line before them. Too few pairs means a different song or version.
function alignTo(reference, lines) {
  const n = lines.length, m = reference.length;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const sim = (i, j) => { const v = similarity(lines[i].text, reference[j].text); return v >= 0.6 ? v : 0; };
  const sims = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => sim(i, j)));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      score[i][j] = Math.max(score[i + 1][j], score[i][j + 1], sims[i][j] ? sims[i][j] + score[i + 1][j + 1] : 0);
    }
  }
  const shiftOf = new Array(n).fill(null);
  let pairs = 0;
  for (let i = 0, j = 0; i < n && j < m;) {
    if (sims[i][j] && score[i][j] === sims[i][j] + score[i + 1][j + 1]) { shiftOf[i] = reference[j].time - lines[i].time; pairs++; i++; j++; }
    else if (score[i + 1][j] >= score[i][j + 1]) i++;
    else j++;
  }
  const worded = lines.filter((l) => l.text.length > 3).length;
  if (pairs < Math.max(4, worded * 0.5)) return null;
  let last = shiftOf.find((v) => v != null);
  const out = lines.map((line, i) => {
    if (shiftOf[i] != null) last = shiftOf[i];
    const shift = last;
    return { ...line, time: line.time + shift, end: line.end + shift, words: line.words.map((w) => ({ ...w, time: w.time + shift, end: w.end + shift })) };
  });
  // A shifted line must not run into the next one.
  for (let i = 0; i < out.length - 1; i++) {
    const limit = out[i + 1].time;
    if (out[i].end > limit) out[i].end = limit;
    for (const w of out[i].words) { if (w.end > limit) w.end = limit; if (w.time > limit) w.time = limit; }
  }
  // Lines before the first pair can land before 0 s (an intro the upload cut).
  return out.filter((line, i) => line.end > 0 && (i === 0 || line.time >= out[i - 1].time));
}

async function fetchLyrics({ title, artist, album, duration }) {
  const track = cleanTrack(title, artist);
  const lrclib = await fetchLrclib({ title, artist, album, duration });
  if (!track.name || lrclib.wordSync) return lrclib;
  let netease = null;
  try { netease = await fetchNetease(track, title, duration); } catch (_) {}
  if (!netease) return lrclib;
  // With lrclib to align against, trust the alignment; without it, only
  // when NetEase's cut is the same length as what's playing.
  const aligned = lrclib.lines.length
    ? alignTo(lrclib.lines, netease.lines)
    : duration > 0 && Math.abs(netease.duration - duration) <= 1.5 ? netease.lines : null;
  if (!aligned) return lrclib;
  return { ...lrclib, lines: aligned, wordSync: true, source: 'netease ' + netease.id };
}

module.exports = { fetchLyrics, cleanTrack, parseLrc, parseLyricsfile, parseYrc, alignTo, pickBest };
