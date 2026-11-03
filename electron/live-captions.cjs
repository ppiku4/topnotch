// Turns the rolling text of Windows Live Captions into lyric lines.
//
// Live Captions shows the last few lines of an ongoing transcript and keeps
// rewriting the newest one as recognition firms up. Each time a new line
// starts, it becomes a lyric line stamped with the media position at that
// moment, so the normal lyrics view shows it as the current line. Earlier
// lines get their final wording when it arrives.
const MAX_LINES = 300;

const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
// The first words of a line identify it while its end is still changing.
const head = (text) => clean(text).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').split(' ').slice(0, 3).join(' ');

function createCaptionLines() {
  let lines = [];

  // text: the whole caption box; position: media seconds now.
  // Returns true when the lines changed.
  function update(text, position) {
    const parts = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
    if (!parts.length) return false;
    let changed = false;
    // Find where the box's lines continue what we already have: the first
    // part whose opening words match one of our recent lines.
    const recent = lines.slice(-parts.length - 2);
    let base = -1;
    for (let i = 0; i < parts.length && base < 0; i++) {
      const at = recent.findIndex((line) => head(line.text) && head(line.text) === head(parts[i]));
      if (at >= 0) base = lines.length - recent.length + at - i;
    }
    if (base < 0) base = lines.length; // all new
    parts.forEach((part, i) => {
      const index = base + i;
      if (index < 0) return;
      if (index < lines.length) {
        if (lines[index].text !== part) { lines[index] = { ...lines[index], text: part }; changed = true; }
      } else {
        const previous = lines[lines.length - 1];
        // Never stamp a new line before the one above it (after a seek back).
        const time = Math.max(position, previous ? previous.time + 0.05 : 0);
        lines.push({ time, text: part });
        changed = true;
      }
    });
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
    return changed;
  }

  return {
    update,
    reset() { lines = []; },
    // Every word is already spoken when it appears: show it fully lit.
    lines: () => lines.map((line) => ({ ...line, words: line.text.split(' ').map((w) => ({ time: line.time, end: line.time + 0.01, text: w })) }))
  };
}

module.exports = { createCaptionLines };
