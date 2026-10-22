import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { bridge } from './bridge.js';
import { SPRING_ISLAND, SPRING_SNAPPY } from './motion.js';

// Alt+click wheel: one ring segment per action for the clicked file,
// with the file in the hub. Engines that aren't installed yet (ffmpeg,
// LibreOffice) are offered in the hub when their action is picked.
const SIZE = 340;
const C = SIZE / 2;
const R_OUT = 158;
const R_IN = 70;
const GAP = 0.035; // radians between segments

const KIND_LABEL = { image: 'Image', document: 'Document', spreadsheet: 'Spreadsheet', presentation: 'Presentation', drawing: 'Drawing', video: 'Video', audio: 'Audio' };

function polar(r, a) { return [C + r * Math.cos(a), C + r * Math.sin(a)]; }

function sectorPath(a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(R_OUT, a0);
  const [x1, y1] = polar(R_OUT, a1);
  const [x2, y2] = polar(R_IN, a1);
  const [x3, y3] = polar(R_IN, a0);
  return `M${x0},${y0} A${R_OUT},${R_OUT} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${R_IN},${R_IN} 0 ${large} 0 ${x3},${y3} Z`;
}

function ActionIcon({ icon }) {
  if (icon === 'edit') {
    return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>;
  }
  if (icon === 'removebg') {
    return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6z" /><path d="M5 15l.8 1.9 1.9.8-1.9.8L5 20.4l-.8-1.9-1.9-.8 1.9-.8zM18 14l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /></svg>;
  }
  if (icon === 'crop') {
    return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></svg>;
  }
  return null;
}

function KindIcon({ kind }) {
  const common = { viewBox: '0 0 24 24', width: 26, height: 26, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'image') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 9" /></svg>;
  if (kind === 'video') return <svg {...common}><rect x="3" y="5" width="13" height="14" rx="3" /><path d="M16 10l5-3v10l-5-3" /></svg>;
  if (kind === 'spreadsheet') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M3 15h18M9 4v16" /></svg>;
  if (kind === 'presentation') return <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8M8 12l3-3 2 2 3-3" /></svg>;
  if (kind === 'drawing') return <svg {...common}><circle cx="7" cy="7" r="3" /><rect x="13" y="13" width="7" height="7" rx="1.5" /><path d="M9.5 9.5l4 4" /></svg>;
  if (kind === 'audio') return <svg {...common}><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>;
  return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
}

export default function Wheel() {
  const [menu, setMenu] = useState(null);
  const [hover, setHover] = useState(null);
  const [prompt, setPrompt] = useState(null); // { needs, action, progress?, error? }

  useEffect(() => bridge.onWheelMenu((next) => { setMenu(next); setHover(null); setPrompt(null); }), []);
  useEffect(() => bridge.onEngineProgress((progress) => setPrompt((p) => (p ? { ...p, progress } : p))), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') bridge.closeWheel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!menu) return null;
  const actions = menu.actions;
  const step = (Math.PI * 2) / actions.length;
  const start = -Math.PI / 2 - step / 2;

  const pick = async (action) => {
    const result = await bridge.wheelPick(action.id);
    if (result?.needs) setPrompt({ needs: result.needs, action });
  };
  const download = async () => {
    setPrompt((p) => ({ ...p, progress: 0, error: null }));
    const result = await bridge.downloadEngine(prompt.needs);
    if (result?.ok) bridge.wheelPick(prompt.action.id);
    else setPrompt((p) => ({ ...p, progress: undefined, error: result?.error || 'Download failed' }));
  };

  const hovered = actions.find((a) => a.id === hover);
  return (
    <div className="wheel-stage" onPointerDown={(e) => { if (e.target === e.currentTarget) bridge.closeWheel(); }}>
      <motion.div
        key={menu.file}
        className={`wheel kind-${menu.kind}`}
        initial={{ scale: 0.55, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={SPRING_ISLAND}
        style={{ width: SIZE, height: SIZE }}
      >
        <svg className="wheel-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle className="wheel-backplate" cx={C} cy={C} r={R_OUT + 6} />
          {actions.map((action, i) => {
            const a0 = start + i * step + GAP / 2;
            const a1 = start + (i + 1) * step - GAP / 2;
            const mid = (a0 + a1) / 2;
            const [lx, ly] = polar((R_OUT + R_IN) / 2, mid);
            const active = hover === action.id;
            return (
              <motion.g
                key={action.id}
                className={`wheel-seg${active ? ' is-active' : ''}${action.ready === false ? ' is-missing' : ''}${action.icon ? ' is-tool' : ''}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: active ? 1.04 : 1 }}
                transition={{ ...SPRING_SNAPPY, delay: active ? 0 : 0.02 * i }}
                style={{ transformOrigin: `${C}px ${C}px` }}
                onPointerEnter={() => setHover(action.id)}
                onPointerLeave={() => setHover((h) => (h === action.id ? null : h))}
                onClick={() => pick(action)}
              >
                <path d={sectorPath(a0, a1)} />
                <foreignObject x={lx - 34} y={ly - 22} width="68" height="44" pointerEvents="none">
                  <div className="wheel-label">
                    {action.icon ? <><ActionIcon icon={action.icon} /><span>{action.label}</span></> : action.label}
                    {action.ready === false && <span className="wheel-dot" />}
                  </div>
                </foreignObject>
              </motion.g>
            );
          })}
        </svg>

        <div className="wheel-hub" style={{ width: R_IN * 2 - 14, height: R_IN * 2 - 14 }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {prompt ? (
              <motion.div key="prompt" className="hub-content" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                {prompt.needs === 'ffmpeg' || prompt.needs === 'bgmodel' || prompt.needs === 'office' ? (
                  prompt.progress !== undefined ? (
                    <>
                      <div className="hub-title">Downloading</div>
                      <div className="hub-bar"><span style={{ width: `${Math.round(prompt.progress * 100)}%` }} /></div>
                      <div className="hub-sub">{({ ffmpeg: 'ffmpeg', office: 'LibreOffice', bgmodel: 'AI model' })[prompt.needs]} · {Math.round(prompt.progress * 100)}%</div>
                    </>
                  ) : (
                    <>
                      <div className="hub-title">{({ ffmpeg: 'Needs ffmpeg', office: 'Needs LibreOffice', bgmodel: 'Needs AI model' })[prompt.needs]}</div>
                      <div className="hub-sub">{prompt.error || `${menu.downloadSizes?.[prompt.needs]} download`}</div>
                      <button className="hub-button" onClick={download}>Download</button>
                    </>
                  )
                ) : (
                  <>
                    <div className="hub-title">Needs LibreOffice</div>
                    <div className="hub-sub">Free office suite</div>
                    <button className="hub-button" onClick={() => bridge.openLibreOffice()}>Get it</button>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key={hovered ? hovered.id : 'file'} className="hub-content" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
                {hovered ? (
                  <>
                    <div className="hub-title">{hovered.id === 'removebg' ? 'Remove background' : hovered.icon ? hovered.label : `To ${hovered.label}`}</div>
                    <div className="hub-sub">{hovered.ready === false ? ({ ffmpeg: 'Needs ffmpeg', office: 'Needs LibreOffice', bgmodel: 'Downloads AI model' })[hovered.needs] : hovered.id === 'removebg' ? 'Transparent PNG' : hovered.icon ? 'Quick editor' : 'Saved next to it'}</div>
                  </>
                ) : (
                  <>
                    <span className="hub-icon"><KindIcon kind={menu.kind} /></span>
                    <div className="hub-name" title={menu.name}>{menu.name}</div>
                    <div className="hub-sub">{KIND_LABEL[menu.kind]}</div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
