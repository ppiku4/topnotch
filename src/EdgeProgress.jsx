import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A thin, glowing accent line along the island's outline, drawn like a
// comet: a dot leads at the head and the tail thins out at the start. It
// leaves out the side docked against the screen edge and fills from one end
// of that side round to the other (left to right when docked top or bottom);
// a floating island gets the full outline from the top centre.
// `read()` returns progress 0..1, or null to hide. Polled four times a
// second here, with the island's live size and corner radii, so only this
// SVG re-renders and it follows the island while it animates.
const LENGTH = 1000; // normalised path length (pathLength)
const STROKE = 0.75;
// The tail thins to a point over the first stretch of the fill, drawn as
// short steps of shrinking width (SVG strokes can't vary along a path).
const TAPER = 90;      // path units (of LENGTH) the taper spans at most
const TAPER_STEPS = 9;
const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];

function measure(island) {
  if (!island) return null;
  const style = getComputedStyle(island);
  return { w: island.offsetWidth, h: island.offsetHeight, radii: CORNERS.map((k) => parseFloat(style[k]) || 0) };
}

// The outline, inset a little so the glow shows on both sides of the line
// (the island clips anything outside it), minus the docked side.
const INSET = 1.5;
function outline({ w, h, radii }, edge) {
  const i = INSET;
  const right = w - i, bottom = h - i;
  const max = Math.max(0, Math.min(w, h) / 2 - i);
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r - i, max)));
  const arc = (r, sweep, x, y) => (r ? `A ${r} ${r} 0 0 ${sweep} ${x} ${y}` : '');
  const parts = {
    // Down the left, along the bottom, up the right.
    top: [`M ${i} ${i}`, `V ${bottom - bl}`, arc(bl, 0, i + bl, bottom), `H ${right - br}`, arc(br, 0, right, bottom - br), `V ${i}`],
    // Up the left, along the top, down the right.
    bottom: [`M ${i} ${bottom}`, `V ${i + tl}`, arc(tl, 1, i + tl, i), `H ${right - tr}`, arc(tr, 1, right, i + tr), `V ${bottom}`],
    // Along the top, down the right, back along the bottom.
    left: [`M ${i} ${i}`, `H ${right - tr}`, arc(tr, 1, right, i + tr), `V ${bottom - br}`, arc(br, 1, right - br, bottom), `H ${i}`],
    right: [`M ${right} ${i}`, `H ${i + tl}`, arc(tl, 0, i, i + tl), `V ${bottom - bl}`, arc(bl, 0, i + bl, bottom), `H ${right}`]
  }[edge];
  if (parts) return { d: parts.filter(Boolean).join(' '), start: startOf(parts[0]) };
  return { start: [w / 2, i], d: [
    `M ${w / 2} ${i}`,
    `H ${right - tr}`, tr ? `A ${tr} ${tr} 0 0 1 ${right} ${i + tr}` : '',
    `V ${bottom - br}`, br ? `A ${br} ${br} 0 0 1 ${right - br} ${bottom}` : '',
    `H ${i + bl}`, bl ? `A ${bl} ${bl} 0 0 1 ${i} ${bottom - bl}` : '',
    `V ${i + tl}`, tl ? `A ${tl} ${tl} 0 0 1 ${i + tl} ${i}` : '',
    'Z'
  ].filter(Boolean).join(' ') };
}

// "M x y" -> [x, y]
const startOf = (move) => move.slice(2).split(' ').map(Number);

const same = (a, b) => a && b && a.w === b.w && a.h === b.h && a.radii.every((r, k) => r === b.radii[k]);

export function EdgeProgress({ read, edge }) {
  const ref = useRef(null);
  const trackRef = useRef(null);
  const [value, setValue] = useState(() => read());
  const [shape, setShape] = useState(null);
  const [head, setHead] = useState(null);
  useEffect(() => {
    const tick = () => {
      setValue(read());
      const next = measure(ref.current?.parentElement);
      setShape((current) => (same(current, next) ? current : next));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [read]);

  const visible = value != null && shape && shape.w > 0 && shape.h > 0;
  const { d } = visible ? outline(shape, edge) : { d: '' };
  const filled = visible ? Math.max(0, Math.min(1, value)) * LENGTH : 0;
  // A comet: the tail thins out at the start, a dot leads at the head.
  const taper = Math.min(TAPER, filled * 0.6);

  // Where the head is, for the dot (pathLength only rescales dashes, so
  // convert to the path's real length).
  useLayoutEffect(() => {
    const path = trackRef.current;
    if (!visible || !path) { setHead(null); return; }
    const point = path.getPointAtLength((path.getTotalLength() * filled) / LENGTH);
    setHead((current) => (current && Math.abs(current[0] - point.x) < 0.05 && Math.abs(current[1] - point.y) < 0.05 ? current : [point.x, point.y]));
  }, [visible, d, filled]);

  // A dash from `from` to `to` along the path.
  const dash = (from, to) => ({ strokeDasharray: `0 ${from} ${Math.max(0, to - from)} ${LENGTH}` });
  return (
    <svg ref={ref} className="edge-progress" aria-hidden="true" width="100%" height="100%" style={visible ? undefined : { display: 'none' }}>
      {visible && (
        <>
          <path ref={trackRef} className="edge-progress-track" d={d} pathLength={LENGTH} />
          <path className="edge-progress-glow" d={d} pathLength={LENGTH} {...dash(taper * 0.6, filled)} />
          {taper > 0 && Array.from({ length: TAPER_STEPS }, (_, k) => {
            const t = k / TAPER_STEPS; // 0 at the tail's end, 1 where it meets the body
            return (
              <path
                key={k}
                className="edge-progress-fill is-taper"
                d={d}
                pathLength={LENGTH}
                {...dash((taper * k) / TAPER_STEPS, (taper * (k + 1)) / TAPER_STEPS + 0.5)}
                style={{ strokeWidth: STROKE * (0.15 + t * 0.85), opacity: 0.4 + t * 0.6 }}
              />
            );
          })}
          <path className="edge-progress-fill" d={d} pathLength={LENGTH} {...dash(taper, filled)} />
          {head && filled > 0 && (
            <>
              <circle className="edge-progress-dot-glow" cx={head[0]} cy={head[1]} r={3.2} />
              <circle className="edge-progress-dot" cx={head[0]} cy={head[1]} r={1.4} />
            </>
          )}
        </>
      )}
    </svg>
  );
}
