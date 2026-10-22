// File conversion behind the Shift+click wheel. Images use sharp (plus
// ag-psd and small BMP/ICO codecs), documents use marked/turndown/mammoth/
// unpdf and Chromium's PDF printer, and anything else falls back to the
// user's LibreOffice. Audio and video go through ffmpeg: the one on PATH, or
// a pinned build TopNotch downloads on request. Output always lands next to
// the original under a free name.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const EXT_ALIASES = { jpeg: 'jpg', jpe: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', aif: 'aiff', text: 'txt' };
const KINDS = {
  image: ['png', 'jpg', 'webp', 'tiff', 'avif', 'gif', 'bmp', 'ico', 'psd', 'svg'],
  document: ['txt', 'md', 'html', 'docx', 'doc', 'odt', 'rtf', 'pdf', 'docm', 'dotx', 'dotm', 'dot', 'ott', 'wpd', 'wps', 'fodt'],
  spreadsheet: ['xlsx', 'xls', 'ods', 'csv', 'xlsm', 'xlsb', 'xltx', 'xlt', 'ots', 'fods', 'tsv'],
  presentation: ['pptx', 'ppt', 'odp', 'pptm', 'ppsx', 'pps', 'potx', 'pot', 'otp', 'fodp', 'key'],
  drawing: ['vsdx', 'vsd', 'odg', 'otg', 'pub'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff']
};
const TARGETS = {
  image: ['png', 'jpg', 'webp', 'tiff', 'avif', 'gif', 'bmp', 'ico', 'psd'],
  document: ['pdf', 'docx', 'txt', 'md', 'html', 'odt', 'rtf', 'doc'],
  spreadsheet: ['xlsx', 'pdf', 'csv', 'ods', 'xls', 'html'],
  presentation: ['pptx', 'pdf', 'odp', 'ppt'],
  drawing: ['pdf', 'png', 'svg', 'odg'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'gif', 'mp3', 'wav', 'm4a'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus']
};

const FFMPEG_VERSION = '7.1.1';
const FFMPEG_URL = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;
const FFMPEG_SHA256 = '04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4';
const FFMPEG_SIZE = '88 MB';
const LIBREOFFICE_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

const extOf = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return EXT_ALIASES[ext] || ext;
};

function kindOf(file) {
  const ext = extOf(file);
  return Object.keys(KINDS).find((kind) => KINDS[kind].includes(ext)) || null;
}

// "photo.png" → "photo (1).png" … until the name is free.
function freePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}.${ext}`);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base} (${n}).${ext}`);
  return candidate;
}

function outputFor(file, ext) {
  return freePath(path.dirname(file), path.basename(file, path.extname(file)), ext);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'topnotch-convert-'));
}

// ── Images ────────────────────────────────────────────────────────────────

// Uncompressed BMP / ICO DIB → RGBA. Covers 1/4/8/24/32-bit, which is what
// Windows writes; RLE and bitfield variants other than plain BGRA are rare.
function decodeDib(buf, offset, { fileHeader, icon }) {
  const pixelOffset = fileHeader ? buf.readUInt32LE(10) : null;
  const h = offset;
  const headerSize = buf.readUInt32LE(h);
  const width = buf.readInt32LE(h + 4);
  let height = buf.readInt32LE(h + 8);
  if (icon) height /= 2; // XOR mask + AND mask
  const bpp = buf.readUInt16LE(h + 14);
  const compression = buf.readUInt32LE(h + 16);
  if (compression !== 0 && compression !== 3) throw new Error('Compressed BMP files are not supported');
  const topDown = height < 0;
  height = Math.abs(height);
  const colors = bpp <= 8 ? (buf.readUInt32LE(h + 32) || 1 << bpp) : 0;
  const palette = h + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const data = pixelOffset ?? palette + colors * 4;
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  const out = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = data + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let b, g, r, a = 255;
      if (bpp === 32) { b = buf[row + x * 4]; g = buf[row + x * 4 + 1]; r = buf[row + x * 4 + 2]; a = buf[row + x * 4 + 3]; if (a) anyAlpha = true; }
      else if (bpp === 24) { b = buf[row + x * 3]; g = buf[row + x * 3 + 1]; r = buf[row + x * 3 + 2]; }
      else if (bpp === 16) { const v = buf.readUInt16LE(row + x * 2); r = ((v >> 10) & 31) * 8; g = ((v >> 5) & 31) * 8; b = (v & 31) * 8; }
      else {
        const perByte = 8 / bpp;
        const byte = buf[row + Math.floor(x / perByte)];
        const index = (byte >> ((perByte - 1 - (x % perByte)) * bpp)) & ((1 << bpp) - 1);
        const p = palette + index * 4;
        b = buf[p]; g = buf[p + 1]; r = buf[p + 2];
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  // 32-bit BMPs often leave alpha at zero; treat them as opaque.
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width, height, data: out };
}

function decodeIco(buf) {
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const entry = { width: buf[e] || 256, size: buf.readUInt32LE(e + 8), offset: buf.readUInt32LE(e + 12) };
    if (!best || entry.width > best.width) best = entry;
  }
  if (!best) throw new Error('Empty icon file');
  const image = buf.subarray(best.offset, best.offset + best.size);
  if (image.readUInt32BE(0) === 0x89504e47) return { png: image };
  return decodeDib(buf, best.offset, { icon: true });
}

function encodeBmp({ width, height, data }) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + stride * height;
  const out = Buffer.alloc(size);
  out.write('BM', 0);
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[row + x * 3] = data[i + 2];
      out[row + x * 3 + 1] = data[i + 1];
      out[row + x * 3 + 2] = data[i];
    }
  }
  return out;
}

async function encodeIco(sharp, input) {
  const sizes = [16, 32, 48, 256];
  const pngs = await Promise.all(sizes.map((s) => input.clone()
    .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s === 256 ? 0 : s;
    header[e + 1] = s === 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

// Any supported image file → a sharp pipeline.
async function loadImage(file) {
  const sharp = require('sharp');
  const ext = extOf(file);
  const buf = await fs.promises.readFile(file);
  const raw = (img) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });
  if (ext === 'psd') {
    const { readPsd, initializeCanvas } = require('ag-psd');
    // Only raw pixel buffers are needed; no real canvas in the main process.
    initializeCanvas(() => { throw new Error('PSD layer previews are not supported'); },
      (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
    const psd = readPsd(buf, { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    if (!psd.imageData) throw new Error('This PSD has no flattened image (save it with "Maximize compatibility")');
    return raw({ width: psd.width, height: psd.height, data: Buffer.from(psd.imageData.data.buffer) });
  }
  if (ext === 'bmp') return raw(decodeDib(buf, 14, { fileHeader: true }));
  if (ext === 'ico') {
    const icon = decodeIco(buf);
    return icon.png ? sharp(icon.png) : raw(icon);
  }
  return sharp(buf, { animated: ext === 'gif' || ext === 'webp', density: ext === 'svg' ? 192 : undefined });
}

// Encodes a sharp pipeline as `ext` into `out`.
async function saveImage(input, ext, out) {
  const sharp = require('sharp');
  if (ext === 'png') return input.png().toFile(out);
  if (ext === 'jpg') return input.flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toFile(out);
  if (ext === 'webp') return input.webp({ quality: 90 }).toFile(out);
  if (ext === 'tiff') return input.tiff({ compression: 'lzw' }).toFile(out);
  if (ext === 'avif') return input.avif({ quality: 60 }).toFile(out);
  if (ext === 'gif') return input.gif().toFile(out);
  if (ext === 'ico') return fs.promises.writeFile(out, await encodeIco(sharp, input));
  const { data, info } = await input.flatten(ext === 'bmp' ? { background: '#ffffff' } : false).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { width: info.width, height: info.height, data };
  if (ext === 'bmp') return fs.promises.writeFile(out, encodeBmp(image));
  if (ext === 'psd') {
    const { writePsdBuffer } = require('ag-psd');
    const imageData = { width: image.width, height: image.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
    const psd = { width: image.width, height: image.height, imageData, children: [{ name: 'Background', imageData }] };
    return fs.promises.writeFile(out, writePsdBuffer(psd));
  }
  throw new Error(`Can't write .${ext}`);
}

// Flattened PNG for the editor (Chromium can't show PSD, TIFF, ICO…).
async function previewImage(file) {
  const input = await loadImage(file);
  const png = await input.rotate().png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Documents ─────────────────────────────────────────────────────────────

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function htmlPage(body, title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.55 "Segoe UI",system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#111}
pre,code{font-family:Consolas,monospace;background:#f3f3f3;border-radius:4px}pre{padding:.8em;overflow:auto;white-space:pre-wrap}
code{padding:.1em .3em}pre code{padding:0}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3em .6em}
img{max-width:100%}blockquote{margin-left:0;padding-left:1em;border-left:3px solid #ccc;color:#444}</style></head><body>${body}</body></html>`;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

function htmlToMarkdown(html) {
  const TurndownService = require('turndown');
  return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
    .remove(['script', 'style', 'head', 'title'])
    .turndown(html) + '\n';
}

async function pdfText(file) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await fs.promises.readFile(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.trim());
}

// Reads txt/md/html/docx/pdf as HTML (null if this needs LibreOffice).
async function documentHtml(file) {
  const ext = extOf(file);
  const title = path.basename(file, path.extname(file));
  if (ext === 'html') return fs.promises.readFile(file, 'utf8');
  if (ext === 'txt') return htmlPage(`<pre style="background:none;padding:0">${escapeHtml(await fs.promises.readFile(file, 'utf8'))}</pre>`, title);
  if (ext === 'md') {
    const { marked } = await import('marked');
    return htmlPage(marked.parse(await fs.promises.readFile(file, 'utf8')), title);
  }
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.convertToHtml({ path: file });
    return htmlPage(value, title);
  }
  if (ext === 'pdf') {
    const pages = await pdfText(file);
    const body = pages.map((p) => p.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('')).join('<hr>');
    return htmlPage(body, title);
  }
  return null;
}

const BUILTIN_DOC = {
  txt: ['md', 'html', 'pdf'],
  md: ['txt', 'html', 'pdf'],
  html: ['txt', 'md', 'pdf'],
  docx: ['txt', 'md', 'html', 'pdf'],
  pdf: ['txt', 'md', 'html']
};

// LibreOffice export filters for --convert-to, per kind of source (Writer,
// Calc, Impress, Draw each have their own).
const OFFICE_FILTERS = {
  document: {
    docx: 'docx:MS Word 2007 XML',
    doc: 'doc:MS Word 97',
    odt: 'odt',
    rtf: 'rtf',
    pdf: 'pdf:writer_pdf_Export',
    html: 'html:XHTML Writer File:UTF8',
    txt: 'txt:Text (encoded):UTF8'
  },
  spreadsheet: {
    xlsx: 'xlsx:Calc MS Excel 2007 XML',
    xls: 'xls:MS Excel 97',
    ods: 'ods',
    // Comma-separated, double quotes, UTF-8; LibreOffice writes the first sheet.
    csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
    pdf: 'pdf:calc_pdf_Export',
    html: 'html:HTML (StarCalc)'
  },
  presentation: {
    pptx: 'pptx:Impress MS PowerPoint 2007 XML',
    ppt: 'ppt:MS PowerPoint 97',
    odp: 'odp',
    pdf: 'pdf:impress_pdf_Export'
  },
  drawing: {
    pdf: 'pdf:draw_pdf_Export',
    png: 'png:draw_png_Export',
    svg: 'svg:draw_svg_Export',
    odg: 'odg'
  }
};
// Import filters for sources LibreOffice would otherwise guess wrong.
const OFFICE_IMPORT = {
  pdf: 'writer_pdf_import',
  html: 'HTML (StarWriter)', // opens as a web page by default, which can't be saved as RTF/DOC
  csv: 'Text - txt - csv (StarCalc):44,34,76',
  tsv: 'Text - txt - csv (StarCalc):9,34,76'
};

function findLibreOffice() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const root of roots) {
    const exe = path.join(root, 'LibreOffice', 'program', 'soffice.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function run(exe, args, { onStdout, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stderr = '';
    let timer = timeout ? setTimeout(() => child.kill(), timeout) : null;
    child.stdout.on('data', (chunk) => onStdout?.(String(chunk)));
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `exit ${code}`));
    });
  });
}

async function officeConvert(soffice, file, ext, out) {
  const work = tempDir();
  try {
    let source = file;
    // LibreOffice doesn't read Markdown; hand it the rendered HTML.
    if (extOf(file) === 'md') {
      source = path.join(work, path.basename(file, path.extname(file)) + '.html');
      await fs.promises.writeFile(source, await documentHtml(file));
    }
    const profile = 'file:///' + path.join(work, 'profile').replace(/\\/g, '/');
    const args = [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo'];
    const filter = OFFICE_FILTERS[kindOf(file)]?.[ext];
    if (!filter) throw new Error(`Can't convert to .${ext}`);
    const importFilter = OFFICE_IMPORT[extOf(source)];
    if (importFilter) args.push(`--infilter=${importFilter}`);
    args.push('--convert-to', filter, '--outdir', work, source);
    await run(soffice, args, { timeout: 180000 });
    const produced = fs.readdirSync(work).find((name) => extOf(name) === ext);
    if (!produced) throw new Error('LibreOffice produced no file');
    await fs.promises.copyFile(path.join(work, produced), out);
  } finally {
    fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Audio / video ─────────────────────────────────────────────────────────

const FFMPEG_ARGS = {
  mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-sn'],
  mov: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-sn'],
  mkv: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-sn'],
  webm: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '128k', '-sn'],
  gif: ['-vf', "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer", '-an', '-sn'],
  mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-vn', '-c:a', 'pcm_s16le'],
  m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  flac: ['-vn', '-c:a', 'flac'],
  ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
  opus: ['-vn', '-c:a', 'libopus', '-b:a', '160k']
};

async function ffmpegConvert(ffmpeg, file, ext, out, onProgress) {
  let duration = 0;
  const args = ['-hide_banner', '-nostdin', '-y', '-i', file, ...FFMPEG_ARGS[ext], '-progress', 'pipe:1', '-nostats', out];
  const child = spawn(ffmpeg, args, { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-16000);
    if (!duration) {
      const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
    }
  });
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      const m = /^out_time_us=(\d+)/.exec(line.trim());
      if (m && duration) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / duration));
    }
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      fs.promises.rm(out, { force: true }).catch(() => {});
      const lines = stderr.trim().split(/\r?\n/).filter((l) => !/^\s*(frame|size|Press)/.test(l));
      reject(new Error(lines.slice(-1)[0] || `ffmpeg exit ${code}`));
    });
  });
}

// ── Service ───────────────────────────────────────────────────────────────

function createConverter({ dir, log, renderPdf, onJob }) {
  const vendor = path.join(dir, 'vendor', 'ffmpeg');
  const vendorExe = path.join(vendor, 'ffmpeg.exe');
  let ffmpegOnPath;
  let downloading = null;
  let nextId = 1;

  function pathFfmpeg() {
    if (ffmpegOnPath !== undefined) return ffmpegOnPath;
    ffmpegOnPath = null;
    for (const folder of (process.env.PATH || '').split(path.delimiter)) {
      const exe = path.join(folder.replace(/"/g, ''), 'ffmpeg.exe');
      if (folder && fs.existsSync(exe)) { ffmpegOnPath = exe; break; }
    }
    return ffmpegOnPath;
  }
  const ffmpeg = () => (fs.existsSync(vendorExe) ? vendorExe : pathFfmpeg());

  // Which engine a source/target pair needs.
  function engineFor(file, target) {
    const kind = kindOf(file);
    if (kind === 'image') return 'image';
    if (kind === 'video' || kind === 'audio') return 'ffmpeg';
    if (kind === 'document') return BUILTIN_DOC[extOf(file)]?.includes(target) ? 'document' : 'office';
    if (kind === 'spreadsheet' || kind === 'presentation' || kind === 'drawing') return 'office';
    return null;
  }

  function engines() {
    return { ffmpeg: !!ffmpeg(), office: !!findLibreOffice() };
  }

  // What the wheel offers for a file.
  function menuFor(file) {
    const kind = kindOf(file);
    if (!kind) return null;
    const ext = extOf(file);
    const available = engines();
    const actions = [];
    if (kind === 'image' && ext !== 'svg') {
      actions.push({ id: 'edit', label: 'Edit', icon: 'edit' });
      actions.push({ id: 'crop', label: 'Crop', icon: 'crop' });
    }
    for (const target of TARGETS[kind]) {
      if (target === ext) continue;
      // Office formats can't be read back as PDF text, so skip pdf→pdf-ish loops.
      const engine = engineFor(file, target);
      const needs = engine === 'ffmpeg' || engine === 'office' ? engine : null;
      actions.push({ id: `to:${target}`, label: target.toUpperCase(), target, needs, ready: needs ? available[needs] : true });
    }
    return { file, name: path.basename(file), kind, ext, actions };
  }

  async function downloadFfmpeg(onProgress) {
    if (downloading) return downloading;
    downloading = (async () => {
      const work = tempDir();
      try {
        const zip = path.join(work, 'ffmpeg.zip');
        const response = await fetch(FFMPEG_URL);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const total = Number(response.headers.get('content-length')) || 0;
        const hash = crypto.createHash('sha256');
        const outFile = fs.createWriteStream(zip);
        let received = 0;
        for await (const chunk of response.body) {
          hash.update(chunk);
          received += chunk.length;
          if (!outFile.write(chunk)) await new Promise((r) => outFile.once('drain', r));
          if (total) onProgress?.(received / total);
        }
        await new Promise((resolve, reject) => outFile.end((error) => (error ? reject(error) : resolve())));
        if (hash.digest('hex') !== FFMPEG_SHA256) throw new Error('ffmpeg download failed its checksum');
        // Windows' own bsdtar reads zip files.
        await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', work]);
        const folder = fs.readdirSync(work).find((name) => name.startsWith('ffmpeg-') && fs.statSync(path.join(work, name)).isDirectory());
        const exe = folder && path.join(work, folder, 'bin', 'ffmpeg.exe');
        if (!exe || !fs.existsSync(exe)) throw new Error('ffmpeg.exe missing from the download');
        fs.mkdirSync(vendor, { recursive: true });
        await fs.promises.copyFile(exe, vendorExe);
        const license = path.join(work, folder, 'LICENSE');
        if (fs.existsSync(license)) await fs.promises.copyFile(license, path.join(vendor, 'LICENSE.txt'));
        log(`ffmpeg ${FFMPEG_VERSION} installed`);
        return vendorExe;
      } finally {
        downloading = null;
        fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    })();
    return downloading;
  }

  async function convert(file, target) {
    const id = nextId++;
    const kind = kindOf(file);
    const name = path.basename(file);
    const engine = engineFor(file, target);
    if (!kind || !TARGETS[kind].includes(target) || !engine) throw new Error(`Can't convert ${name} to ${target}`);
    const job = { id, name, target: target.toUpperCase(), status: 'running', progress: 0 };
    const report = (patch) => { Object.assign(job, patch); onJob({ ...job }); };
    report({});
    const out = outputFor(file, target);
    try {
      if (engine === 'image') {
        await saveImage((await loadImage(file)).rotate(), target, out);
      } else if (engine === 'ffmpeg') {
        const exe = ffmpeg();
        if (!exe) throw new Error('ffmpeg is not installed');
        await ffmpegConvert(exe, file, target, out, (progress) => report({ progress }));
      } else if (engine === 'document') {
        const html = await documentHtml(file);
        if (target === 'html') await fs.promises.writeFile(out, html);
        else if (target === 'md') await fs.promises.writeFile(out, extOf(file) === 'pdf' ? (await pdfText(file)).join('\n\n---\n\n') + '\n' : htmlToMarkdown(html));
        else if (target === 'txt') await fs.promises.writeFile(out, extOf(file) === 'pdf' ? (await pdfText(file)).join('\n\n\f') + '\n' : htmlToText(html));
        else if (target === 'pdf') await fs.promises.writeFile(out, await renderPdf(html, file));
      } else {
        const soffice = findLibreOffice();
        if (!soffice) throw new Error('LibreOffice is not installed');
        // Markdown out of an office file: let LibreOffice make HTML first.
        if (target === 'md') {
          const work = tempDir();
          try {
            const html = path.join(work, 'doc.html');
            await officeConvert(soffice, file, 'html', html);
            await fs.promises.writeFile(out, htmlToMarkdown(await fs.promises.readFile(html, 'utf8')));
          } finally { fs.promises.rm(work, { recursive: true, force: true }).catch(() => {}); }
        } else await officeConvert(soffice, file, target, out);
      }
      report({ status: 'done', progress: 1, output: out });
      return out;
    } catch (error) {
      log(`convert ${name} → ${target}: ${error.message}`);
      report({ status: 'error', error: error.message });
      throw error;
    }
  }

  // Editor output: a PNG from the canvas, re-encoded as `target`.
  async function saveEdited(file, png, target) {
    const sharp = require('sharp');
    const kind = kindOf(file);
    if (kind !== 'image' || !TARGETS.image.includes(target)) throw new Error('Unsupported format');
    const out = outputFor(file, target);
    const job = { id: nextId++, name: path.basename(file), target: target.toUpperCase(), status: 'running', progress: 0 };
    onJob({ ...job });
    try {
      await saveImage(sharp(png), target, out);
      onJob({ ...job, status: 'done', progress: 1, output: out });
      return out;
    } catch (error) {
      onJob({ ...job, status: 'error', error: error.message });
      throw error;
    }
  }

  return {
    kindOf,
    menuFor,
    convert,
    saveEdited,
    previewImage,
    engines,
    downloadFfmpeg,
    ffmpegInfo: { version: FFMPEG_VERSION, size: FFMPEG_SIZE },
    libreOfficeUrl: LIBREOFFICE_URL
  };
}

// Every extension the wheel opens on, aliases included (for the helper's filter).
const EXTENSIONS = [...Object.values(KINDS).flat(), ...Object.keys(EXT_ALIASES)];

module.exports = { createConverter, kindOf, extOf, outputFor, TARGETS, EXTENSIONS };
