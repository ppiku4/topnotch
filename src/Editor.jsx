import './wheel.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { bridge } from './bridge.js';
import { SPRING_SNAPPY } from './motion.js';

// Quick image editor opened from the file wheel: crop (free or fixed ratio),
// rotate, flip, resize and brightness/contrast/saturation, then save as any
// image format next to the original. Edits happen on a canvas; main
// re-encodes the PNG into the chosen format.
const RATIOS = [
  { id: 'free', label: 'Free', value: null },
  { id: 'original', label: 'Original', value: 'original' },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '4:5', label: '4:5', value: 4 / 5 }
];
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const MIN_CROP = 0.03;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function Icon({ d }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
}
const ROTATE_L = <Icon d={<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>} />;
const ROTATE_R = <Icon d={<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>} />;
const FLIP_H = <Icon d={<><path d="M12 3v18" /><path d="M8 7L3 12l5 5z" /><path d="M16 7l5 5-5 5z" /></>} />;
const FLIP_V = <Icon d={<><path d="M3 12h18" /><path d="M7 8l5-5 5 5z" /><path d="M7 16l5 5 5-5z" /></>} />;
const SPARKLE = <Icon d={<><path d="M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6z" /><path d="M5 15l.8 1.9 1.9.8-1.9.8L5 20.4l-.8-1.9-1.9-.8 1.9-.8zM18 14l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /></>} />;
// Formats that can't hold transparency (saved over white).
const OPAQUE = ['jpg', 'bmp'];
const LOCK = (on) => <Icon d={on ? <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></> : <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></>} />;

// Draws the source rotated (quarter turns) and flipped into a new canvas.
function orient(img, rotation, flipX, flipY, preview = false) {
  const quarter = ((rotation / 90) % 4 + 4) % 4;
  const swap = quarter % 2 === 1;
  const canvas = document.createElement('canvas');
  const scale = preview ? Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  canvas.width = Math.max(1, Math.round((swap ? img.naturalHeight : img.naturalWidth) * scale));
  canvas.height = Math.max(1, Math.round((swap ? img.naturalWidth : img.naturalHeight) * scale));
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((quarter * Math.PI) / 2);
  ctx.scale((flipX ? -1 : 1) * scale, (flipY ? -1 : 1) * scale);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvas;
}

function Slider({ label, value, min, max, onChange, format = (v) => `${v > 0 ? '+' : ''}${v}` }) {
  return (
    <label className="ed-slider">
      <span className="ed-slider-head"><span>{label}</span><span className="ed-value">{format(value)}</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(0)} />
    </label>
  );
}

function decodeEditorImage(bytes) {
  return new Promise((resolve, reject) => {
    const url = typeof bytes === 'string' ? bytes : URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const image = new Image();
    const release = () => { if (typeof bytes !== 'string') URL.revokeObjectURL(url); };
    image.onload = () => { release(); resolve(image); };
    image.onerror = () => { release(); reject(new Error('Could not decode the image')); };
    image.src = url;
  });
}

export default function Editor() {
  const [doc, setDoc] = useState(null);       // { file, name, mode, ext, targets, image } | { error }
  const [img, setImg] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [crop, setCrop] = useState(FULL);
  const [cropping, setCropping] = useState(false);
  const [ratio, setRatio] = useState('free');
  const [adjust, setAdjust] = useState({ brightness: 0, contrast: 0, saturation: 0 });
  const [size, setSize] = useState(null);     // output { w, h } or null = crop size
  const [lockSize, setLockSize] = useState(true);
  const [format, setFormat] = useState('png');
  const [status, setStatus] = useState(null); // { kind: 'saving'|'done'|'error', text, output? }
  // Remove background: 'idle' | 'working' | 'done' | { needs } | { downloading } | { error }
  const [bg, setBg] = useState('idle');
  const original = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const [view, setView] = useState({ w: 0, h: 0 });

  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const next = await bridge.getEditorImage();
    if (!next || generation !== loadGeneration.current) return;
    setImg(null);
    setDoc(next);
    setRotation(0); setFlipX(false); setFlipY(false); setCrop(FULL); setRatio('free');
    setAdjust({ brightness: 0, contrast: 0, saturation: 0 }); setSize(null); setStatus(null);
    setCropping(next.mode === 'crop');
    setBg('idle');
    original.current = null;
    setFormat(next.targets?.includes(next.ext) ? next.ext : 'png');
    if (next.image) {
      try {
        const image = await decodeEditorImage(next.image);
        if (generation === loadGeneration.current) setImg(image);
      } catch (error) { if (generation === loadGeneration.current) setDoc({ error: error.message }); }
    }
  }, []);
  useEffect(() => { load(); const unsubscribe = bridge.onEditorOpen(load); return () => { loadGeneration.current++; unsubscribe(); }; }, [load]);
  useEffect(() => bridge.onEditorProgress((progress) => setBg((b) => (b && b.downloading !== undefined ? { downloading: progress } : b))), []);

  // The cut-out replaces the picture; crop, rotation and adjustments stay
  // and apply on top of it. Restore brings the original back.
  const swapImage = async (src) => { setImg(await decodeEditorImage(src)); };
  const removeBackground = async () => {
    setBg('working');
    const result = await bridge.removeBackgroundInEditor();
    if (result?.needs) { setBg({ needs: result.needs, size: result.size }); return; }
    if (!result?.image) { setBg({ error: result?.error || 'Could not remove the background' }); return; }
    if (!original.current) original.current = img;
    try { await swapImage(result.image); } catch (error) { setBg({ error: error.message }); return; }
    setBg('done');
    if (OPAQUE.includes(format)) setFormat('png');
  };
  const downloadModel = async () => {
    setBg({ downloading: 0 });
    const result = await bridge.downloadBackgroundModel();
    if (result?.ok) removeBackground();
    else setBg({ error: result?.error || 'Download failed' });
  };
  const restoreBackground = () => {
    if (original.current) setImg(original.current);
    original.current = null;
    setBg('idle');
  };

  const oriented = useMemo(() => (img ? orient(img, rotation, flipX, flipY, true) : null), [img, rotation, flipX, flipY]);
  const swapped = Math.abs(rotation / 90) % 2 === 1;
  const sourceSize = img ? { w: swapped ? img.naturalHeight : img.naturalWidth, h: swapped ? img.naturalWidth : img.naturalHeight } : { w: 0, h: 0 };
  const activeCrop = cropping ? crop : FULL;
  const cropPx = oriented ? { w: Math.max(1, Math.round(activeCrop.w * sourceSize.w)), h: Math.max(1, Math.round(activeCrop.h * sourceSize.h)) } : { w: 0, h: 0 };
  const outSize = size || cropPx;
  const filter = `brightness(${1 + adjust.brightness / 100}) contrast(${1 + adjust.contrast / 100}) saturate(${1 + adjust.saturation / 100})`;

  // Fit the oriented image into the stage.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !oriented) return undefined;
    const fit = () => {
      const box = frame.getBoundingClientRect();
      const scale = Math.min((box.width - 48) / oriented.width, (box.height - 48) / oriented.height, 1);
      setView({ w: Math.round(oriented.width * scale), h: Math.round(oriented.height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [oriented]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !oriented || !view.w) return;
    canvas.width = view.w * devicePixelRatio;
    canvas.height = view.h * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    ctx.filter = filter;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(oriented, 0, 0, canvas.width, canvas.height);
  }, [oriented, view, filter]);

  // Fixed ratios in pixels → normalized crop box, kept centred and inside.
  const ratioValue = (id) => {
    const r = RATIOS.find((x) => x.id === id)?.value;
    if (r === 'original') return img ? img.naturalWidth / img.naturalHeight : null;
    return r;
  };
  const fitRatio = (box, r) => {
    if (!r || !oriented) return box;
    const aspect = r * sourceSize.h / sourceSize.w; // normalized w/h
    let w = box.w, h = w / aspect;
    if (h > 1) { h = 1; w = h * aspect; }
    if (w > 1) { w = 1; h = w / aspect; }
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
  };
  const chooseRatio = (id) => {
    setRatio(id);
    setCropping(true);
    const r = ratioValue(id);
    if (r) setCrop((c) => fitRatio({ ...FULL, ...((c.w === 1 && c.h === 1) ? {} : c) }, r));
  };

  // Crop box dragging: body moves it, corners resize it (keeping the ratio).
  const drag = useRef(null);
  const onCropDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop };
  };
  const onCropMove = (e) => {
    const d = drag.current;
    if (!d || !view.w) return;
    const dx = (e.clientX - d.x) / view.w;
    const dy = (e.clientY - d.y) / view.h;
    const s = d.start;
    if (d.handle === 'move') {
      setCrop({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    const west = d.handle.includes('w'), north = d.handle.includes('n');
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (west) x0 = clamp(x0 + dx, 0, x1 - MIN_CROP); else x1 = clamp(x1 + dx, x0 + MIN_CROP, 1);
    if (north) y0 = clamp(y0 + dy, 0, y1 - MIN_CROP); else y1 = clamp(y1 + dy, y0 + MIN_CROP, 1);
    const r = ratioValue(ratio);
    if (r && oriented) {
      const aspect = r * sourceSize.h / sourceSize.w;
      let w = x1 - x0, h = y1 - y0;
      if (w / h > aspect) w = h * aspect; else h = w / aspect;
      // Anchor the opposite corner and keep the box inside the image.
      const ax = west ? s.x + s.w : s.x, ay = north ? s.y + s.h : s.y;
      const maxW = west ? ax : 1 - ax, maxH = north ? ay : 1 - ay;
      if (w > maxW) { w = maxW; h = w / aspect; }
      if (h > maxH) { h = maxH; w = h * aspect; }
      x0 = west ? ax - w : ax; y0 = north ? ay - h : ay; x1 = x0 + w; y1 = y0 + h;
    }
    setCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    setSize(null);
  };
  const onCropUp = () => { drag.current = null; };

  const turn = (deg) => { setRotation((r) => r + deg); setCrop(FULL); setSize(null); };
  const reset = () => {
    restoreBackground();
    setRotation(0); setFlipX(false); setFlipY(false); setCrop(FULL); setRatio('free'); setSize(null);
    setAdjust({ brightness: 0, contrast: 0, saturation: 0 });
  };

  const setWidth = (w) => {
    w = clamp(Math.round(w) || 1, 1, 16384);
    setSize({ w, h: lockSize ? Math.max(1, Math.round(w * cropPx.h / cropPx.w)) : outSize.h });
  };
  const setHeight = (h) => {
    h = clamp(Math.round(h) || 1, 1, 16384);
    setSize({ h, w: lockSize ? Math.max(1, Math.round(h * cropPx.w / cropPx.h)) : outSize.w });
  };

  const save = async () => {
    if (!oriented) return;
    setStatus({ kind: 'saving', text: 'Saving…' });
    const sx = Math.round(activeCrop.x * sourceSize.w), sy = Math.round(activeCrop.y * sourceSize.h);
    const out = document.createElement('canvas');
    out.width = outSize.w;
    out.height = outSize.h;
    const ctx = out.getContext('2d');
    ctx.filter = filter;
    ctx.imageSmoothingQuality = 'high';
    const full = orient(img, rotation, flipX, flipY);
    ctx.drawImage(full, sx, sy, cropPx.w, cropPx.h, 0, 0, out.width, out.height);
    full.width = full.height = 1;
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    const result = await bridge.saveEdited(await blob.arrayBuffer(), format);
    if (result?.ok) setStatus({ kind: 'done', text: `Saved ${result.output.split(/[\\/]/).pop()}`, output: result.output });
    else setStatus({ kind: 'error', text: result?.error || 'Could not save' });
  };

  const handles = ['nw', 'ne', 'sw', 'se'];
  const edited = bg === 'done' || rotation % 360 !== 0 || flipX || flipY || crop !== FULL || size || adjust.brightness || adjust.contrast || adjust.saturation;

  return (
    <div className="editor">
      <header className="ed-bar">
        <span className="ed-title">{doc?.name || 'Editor'}</span>
        {oriented && <span className="ed-dim">{sourceSize.w} × {sourceSize.h}</span>}
        <span className="ed-spacer" />
        <button className="ed-icon" title="Close" aria-label="Close" onClick={() => bridge.closeEditor()}>
          <Icon d={<><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>} />
        </button>
      </header>
      <div className="ed-body">
        <div className="ed-stage" ref={frameRef} onPointerMove={onCropMove} onPointerUp={onCropUp}>
          {doc?.error && <div className="ed-empty">Can’t open this image: {doc.error}</div>}
          {!doc?.error && !oriented && <div className="ed-empty">Loading…</div>}
          {oriented && (
            <div className="ed-canvas-wrap" style={{ width: view.w, height: view.h }}>
              <canvas ref={canvasRef} style={{ width: view.w, height: view.h }} />
              {cropping && (
                <>
                  <div className="ed-shade" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${crop.x * 100}% ${crop.y * 100}%, ${crop.x * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%, ${(crop.x + crop.w) * 100}% ${crop.y * 100}%, ${crop.x * 100}% ${crop.y * 100}%)` }} />
                  <div
                    className="ed-crop"
                    style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                    onPointerDown={(e) => onCropDown(e, 'move')}
                  >
                    <span className="ed-grid" />
                    {handles.map((h) => <span key={h} className={`ed-handle h-${h}`} onPointerDown={(e) => onCropDown(e, h)} />)}
                    <span className="ed-crop-size">{cropPx.w} × {cropPx.h}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="ed-side">
          <section>
            <div className="ed-head">
              <span>Crop</span>
              <button className={`ed-toggle${cropping ? ' is-on' : ''}`} onClick={() => { setCropping((c) => !c); setSize(null); }}>{cropping ? 'On' : 'Off'}</button>
            </div>
            <div className="ed-chips">
              {RATIOS.map((r) => (
                <button key={r.id} className={`ed-chip${ratio === r.id && cropping ? ' is-active' : ''}`} onClick={() => chooseRatio(r.id)}>
                  {ratio === r.id && cropping && <motion.span layoutId="ratio-pill" className="ed-chip-bg" transition={SPRING_SNAPPY} />}
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="ed-head"><span>Rotate & flip</span></div>
            <div className="ed-row">
              <button className="ed-tool" title="Rotate left" onClick={() => turn(-90)}>{ROTATE_L}</button>
              <button className="ed-tool" title="Rotate right" onClick={() => turn(90)}>{ROTATE_R}</button>
              <button className={`ed-tool${flipX ? ' is-on' : ''}`} title="Flip horizontal" onClick={() => { setFlipX((f) => !f); setCrop(FULL); }}>{FLIP_H}</button>
              <button className={`ed-tool${flipY ? ' is-on' : ''}`} title="Flip vertical" onClick={() => { setFlipY((f) => !f); setCrop(FULL); }}>{FLIP_V}</button>
            </div>
          </section>

          <section>
            <div className="ed-head"><span>Background</span>{bg === 'done' && <button className="ed-link" onClick={restoreBackground}>Restore</button>}</div>
            {bg && bg.needs ? (
              <div className="ed-bg-prompt">
                <span>Needs the AI model ({bg.size}), downloaded once.</span>
                <button className="ed-button" onClick={downloadModel}>Download</button>
              </div>
            ) : bg && bg.downloading !== undefined ? (
              <div className="ed-bg-prompt">
                <span>Downloading model · {Math.round(bg.downloading * 100)}%</span>
                <div className="ed-progress"><span style={{ width: `${Math.round(bg.downloading * 100)}%` }} /></div>
              </div>
            ) : (
              <button className={`ed-wide${bg === 'done' ? ' is-on' : ''}`} onClick={removeBackground} disabled={!oriented || bg === 'working' || bg === 'done'}>
                <span className={bg === 'working' ? 'ed-spin' : undefined}>{SPARKLE}</span>
                {bg === 'working' ? 'Removing background…' : bg === 'done' ? 'Background removed' : 'Remove background'}
              </button>
            )}
            {bg && bg.error && <div className="ed-status is-error"><span>{bg.error}</span></div>}
            {bg === 'done' && OPAQUE.includes(format) && <p className="ed-note">{format.toUpperCase()} can't keep transparency; it will be saved over white.</p>}
          </section>

          <section>
            <div className="ed-head"><span>Resize</span>{size && <button className="ed-link" onClick={() => setSize(null)}>Original</button>}</div>
            <div className="ed-row ed-size">
              <label><span>W</span><input type="number" min="1" value={outSize.w} onChange={(e) => setWidth(e.target.value)} /></label>
              <button className={`ed-tool small${lockSize ? ' is-on' : ''}`} title="Keep proportions" onClick={() => setLockSize((l) => !l)}>{LOCK(lockSize)}</button>
              <label><span>H</span><input type="number" min="1" value={outSize.h} onChange={(e) => setHeight(e.target.value)} /></label>
            </div>
          </section>

          <section>
            <div className="ed-head"><span>Adjust</span></div>
            <Slider label="Brightness" value={adjust.brightness} min={-100} max={100} onChange={(v) => setAdjust((a) => ({ ...a, brightness: v }))} />
            <Slider label="Contrast" value={adjust.contrast} min={-100} max={100} onChange={(v) => setAdjust((a) => ({ ...a, contrast: v }))} />
            <Slider label="Saturation" value={adjust.saturation} min={-100} max={100} onChange={(v) => setAdjust((a) => ({ ...a, saturation: v }))} />
          </section>

          <section className="ed-save">
            <div className="ed-head"><span>Save as</span></div>
            <div className="ed-chips formats">
              {(doc?.targets || []).map((t) => (
                <button key={t} className={`ed-chip${format === t ? ' is-active' : ''}`} onClick={() => setFormat(t)}>
                  {format === t && <motion.span layoutId="format-pill" className="ed-chip-bg" transition={SPRING_SNAPPY} />}
                  <span>{t.toUpperCase()}</span>
                </button>
              ))}
            </div>
            <div className="ed-row">
              <button className="ed-button ghost" onClick={reset} disabled={!edited}>Reset</button>
              <button className="ed-button" onClick={save} disabled={!oriented || status?.kind === 'saving'}>Save copy</button>
            </div>
            {status && (
              <div className={`ed-status is-${status.kind}`}>
                <span>{status.text}</span>
                {status.output && <button className="ed-link" onClick={() => bridge.revealEdited(status.output)}>Show in folder</button>}
              </div>
            )}
            <p className="ed-note">Saved next to the original; it is never overwritten.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
