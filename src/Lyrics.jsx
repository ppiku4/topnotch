import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bridge } from './bridge.js';
import { getLevel, useLoudness } from './beat.js';
import { SPRING_SOFT } from './motion.js';

// Seconds into the track right now. SMTC positions are snapshots; extrapolate
// from when they were taken (or from a local seek, until SMTC confirms it).
export function currentPosition(media, seekedTo) {
  if (!media) return 0;
  const useSeek = seekedTo && seekedTo.at > media.positionAt;
  const base = useSeek ? seekedTo.position : media.position;
  const since = useSeek ? seekedTo.at : media.positionAt;
  const elapsed = media.playing ? (Date.now() - since) / 1000 : 0;
  return base + Math.max(0, elapsed);
}

function lineIndexAt(lines, position) {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= position + 0.15) index = i; else break;
  }
  return index;
}

// Rough syllable count: vowel groups, minus a silent trailing "e".
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Words sung long: "ooh", "yeah", stretched letters ("loooove"), or ones
// followed by a comma, dash or ellipsis.
const STRETCHY = /^(o+h+|a+h+|u+h+|ye+a+h+|whoa+|na+|la+|mm+|hey+|oh+)$/i;
const isStretchy = (word) => STRETCHY.test(word.replace(/[^a-z]/gi, '')) || /([aeiouy])\1{2,}/i.test(word);

// Per-word start/end. Real word stamps when the LRC has them. Otherwise the
// line is "sung" at about 4.5 syllables per second, each word taking time by
// its syllables; whatever time is left before the next line goes mostly to
// held words (last word, stretchy words), the way singers pull them out.
// Fast lines leave no slack, so their words animate quickly.
function wordTimings(line, nextTime) {
  if (!line || !line.text) return [];
  // Lyricsfile records say when the line actually ends; older LRC only
  // tells us when the next one starts.
  const lineEnd = line.end && (!nextTime || line.end <= nextTime + 0.05) ? line.end : null;
  const gap = Math.max(0.4, (lineEnd ?? nextTime ?? line.time + 5) - line.time);
  if (line.words?.length) {
    return line.words.map((w, i) => {
      const next = line.words[i + 1]?.time;
      const end = w.end ?? next ?? Math.min(line.time + gap - 0.1, w.time + 0.3 + syllables(w.text) * 0.22);
      return { text: w.text, start: w.time, end: Math.max(end, w.time + 0.12) };
    });
  }
  const tokens = line.text.split(/\s+/).filter(Boolean);
  const sylls = tokens.map(syllables);
  const pauses = tokens.map((t, i) => (i < tokens.length - 1 && /[,;:—-]$/.test(t) ? 0.18 : 0));
  const usable = Math.max(0.3, gap - (lineEnd ? 0.02 : 0.12));
  const natural = sylls.reduce((a, b) => a + b, 0) * 0.22 + pauses.reduce((a, b) => a + b, 0);
  const pace = natural > usable ? usable / natural : 1;
  const durations = sylls.map((n) => n * 0.22 * pace);
  // Spread the slack: held words get most of it, capped so a long
  // instrumental gap doesn't stretch one word for ten seconds.
  let slack = Math.min(usable - natural * pace, lineEnd ? 6 : 3);
  if (slack > 0.05) {
    const holds = tokens.map((t, i) => (i === tokens.length - 1 ? 3 : 0) + (isStretchy(t) ? 2 : 0) + (pauses[i] ? 1 : 0));
    const totalHold = holds.reduce((a, b) => a + b, 0);
    if (totalHold > 0) {
      const share = slack * 0.85;
      holds.forEach((h, i) => { durations[i] += (share * h) / totalHold; });
      slack -= share;
    }
    const each = slack / tokens.length;
    durations.forEach((_, i) => { durations[i] += each; });
  }
  let cursor = line.time;
  return tokens.map((text, i) => {
    const word = { text, start: cursor, end: cursor + durations[i] };
    cursor += durations[i] + pauses[i] * pace;
    return word;
  });
}

// Loudness comes from the shared meter in beat.js (also used by the glow).

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Apple Music-style word state, written straight to the DOM each frame:
//   --p  fill progress through the word (0 unsung, 1 sung)
//   --a  "hold": the word being sung swells and lifts, easing in over
//        120 ms and settling over 350 ms after it's done
//   --h  how long the word is held (0 short … 1 long); longer holds swell more
//   --g  glow: only held words bloom, fading half a second after they end
function paintWords(elements, words, position) {
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    const el = elements[i];
    if (!el) continue;
    const w = words[i];
    const linear = clamp01((position - w.start) / (w.end - w.start));
    // Ease-in-out so the colour eases into and out of each word.
    const p = linear * linear * (3 - 2 * linear);
    const held = clamp01((w.end - w.start - 0.45) / 1.0);
    const hold = position < w.start ? 0
      : position <= w.end ? easeInOut(clamp01((position - w.start) / 0.18))
      : 1 - easeInOut(clamp01((position - w.end) / 0.45));
    const glow = position < w.start ? 0 : position <= w.end ? p : clamp01(1 - (position - w.end) / 0.6);
    el.style.setProperty('--p', p.toFixed(3));
    // Louder passages push the swell a little and the glow more.
    const loudness = getLevel();
    const energy = 0.55 + loudness * 0.7;
    el.style.setProperty('--a', (hold * (0.8 + loudness * 0.3)).toFixed(3));
    el.style.setProperty('--h', held.toFixed(3));
    el.style.setProperty('--g', Math.min(1, held * glow * energy).toFixed(3));
    if (p > 0) active = i;
  }
  return active;
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const LEAD_IN = 0.08;

// Calls onFrame(position) every animation frame while playing, once otherwise.
function useLyricClock(media, seekedTo, onFrame) {
  useLoudness();
  const latest = useRef({ media, seekedTo, onFrame });
  latest.current = { media, seekedTo, onFrame };
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const { media: m, seekedTo: s, onFrame: f } = latest.current;
      // Light words ~80 ms early: by the time the frame reaches the screen
      // the singer has started the word.
      f(currentPosition(m, s) + LEAD_IN);
      if (m?.playing) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [media?.playing, media?.positionAt, seekedTo]);
}

function Dots({ dotsRef }) {
  return <span className="lyric-dots" ref={dotsRef} aria-label="Instrumental"><i /><i /><i /></span>;
}

// Lines rise in (their words then fade up one by one in CSS) and drift up
// and out a little faster, so the next line is never waiting on the old one.
const LINE_MOTION = {
  initial: { opacity: 0, y: 9, filter: 'blur(3px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(3px)', transition: { duration: 0.24, ease: [0.5, 0, 0.75, 0] } }
};

// ── Pill: one line, reports its natural width so the pill can fit it ─────

export function PillLyrics({ lines, media, onWidth }) {
  const [index, setIndex] = useState(() => lineIndexAt(lines, currentPosition(media)));
  const line = lines[index];
  const nextTime = lines[index + 1]?.time;
  const words = useMemo(() => wordTimings(line, nextTime), [line, nextTime]);
  const isBreak = index < 0 || !line?.text;
  const breakStart = index < 0 ? 0 : line?.time ?? 0;
  const breakEnd = index < 0 ? lines[0]?.time ?? 0 : nextTime ?? breakStart + 5;

  const els = useRef({ words: [], track: null, dots: null, measure: null, viewport: null, line: null });
  if (els.current.line !== line) els.current = { ...els.current, words: [], track: null, dots: null, line };
  const keep = (key) => (el) => { if (el) els.current[key] = el; };

  // Measure the line at its natural width (an invisible copy, not the
  // animating one) before paint, so the island resizes with the line change.
  useLayoutEffect(() => {
    const width = isBreak ? 44 : els.current.measure?.scrollWidth ?? 0;
    onWidth?.(width);
  }, [line, isBreak, onWidth]);

  useLyricClock(media, null, (position) => {
    const nextIndex = lineIndexAt(lines, position);
    if (nextIndex !== index) { setIndex(nextIndex); return; }
    const active = paintWords(els.current.words, words, position);
    const { dots, track, viewport } = els.current;
    if (dots) dots.style.setProperty('--p', clamp01((position - breakStart) / Math.max(0.5, breakEnd - breakStart)).toFixed(3));
    // Lines wider than the pill slide to keep the sung word in view.
    if (track && viewport) {
      const overflow = track.scrollWidth - viewport.clientWidth;
      let shift = 0;
      const word = els.current.words[active];
      if (overflow > 0 && word) shift = Math.min(overflow, Math.max(0, word.offsetLeft + word.offsetWidth / 2 - viewport.clientWidth * 0.45));
      track.style.transform = `translateX(${-shift}px)`;
    }
  });

  return (
    <div className="lyrics lyrics-pill" ref={keep('viewport')}>
      <span className="lyric-measure" ref={keep('measure')} aria-hidden>{line?.text}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={index} className="lyric-line" {...LINE_MOTION} transition={SPRING_SOFT}>
          {isBreak ? <Dots dotsRef={keep('dots')} /> : (
            <span className="lyric-track" ref={keep('track')}>
              {words.map((w, i) => (
                <span key={i} className="w" style={{ '--i': i }} ref={(el) => { if (el) els.current.words[i] = el; }}>{w.text}</span>
              ))}
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Music tab: Apple Music-style scrolling list, click a line to seek ─────

export function LyricsList({ lines, media, seekedTo, onSeek }) {
  const [index, setIndex] = useState(() => lineIndexAt(lines, currentPosition(media, seekedTo)));
  const [offset, setOffset] = useState(0);
  const lineEls = useRef([]);
  const wordEls = useRef([]);
  const dotsEl = useRef(null);
  const line = lines[index];
  const nextTime = lines[index + 1]?.time;
  const words = useMemo(() => wordTimings(line, nextTime), [line, nextTime]);
  const lastLine = useRef(line);
  if (lastLine.current !== line) { wordEls.current = []; dotsEl.current = null; lastLine.current = line; }

  // Keep the current line about a quarter of the way down the viewport.
  useLayoutEffect(() => {
    const el = lineEls.current[Math.max(0, index)];
    if (el) setOffset(-el.offsetTop + 18);
  }, [index, lines]);

  const breakStart = index < 0 ? 0 : line?.time ?? 0;
  const breakEnd = index < 0 ? lines[0]?.time ?? 0 : nextTime ?? breakStart + 5;

  useLyricClock(media, seekedTo, (position) => {
    const nextIndex = lineIndexAt(lines, position);
    if (nextIndex !== index) { setIndex(nextIndex); return; }
    paintWords(wordEls.current, words, position);
    if (dotsEl.current) dotsEl.current.style.setProperty('--p', clamp01((position - breakStart) / Math.max(0.5, breakEnd - breakStart)).toFixed(3));
  });

  return (
    <div className="lyrics lyrics-list">
      <div className="lyrics-scroll">
        {index < 0 && <div className="ll ll-intro is-current" style={{ '--y': `${offset}px` }}><Dots dotsRef={(el) => { if (el) dotsEl.current = el; }} /></div>}
        {lines.map((l, i) => {
          const distance = i - index;
          const current = distance === 0;
          // Lines above move first, the current one next, lines below
          // trail by 45 ms each.
          const style = {
            '--y': `${offset}px`,
            '--delay': `${Math.min(6, Math.max(0, distance + 1)) * 0.045}s`,
            ...(current ? null : {
              '--s': 0.95,
              opacity: distance < 0 ? 0.28 : Math.max(0.18, 0.5 - (distance - 1) * 0.1),
              filter: `blur(${Math.min(2.5, Math.abs(distance) * 0.8)}px)`
            })
          };
          return (
            <div
              key={i}
              ref={(el) => { lineEls.current[i] = el; }}
              className={`ll${current ? ' is-current' : ''}`}
              style={style}
              onClick={() => onSeek(l.time)}
              title="Play from this line"
            >
              {current && !l.text && <Dots dotsRef={(el) => { if (el) dotsEl.current = el; }} />}
              {current && l.text && words.map((w, j) => (
                <span key={j} className="w" style={{ '--i': j }} ref={(el) => { if (el) wordEls.current[j] = el; }}>{w.text}</span>
              ))}
              {!current && (l.text || '♪')}
            </div>
          );
        })}
      </div>
    </div>
  );
}
