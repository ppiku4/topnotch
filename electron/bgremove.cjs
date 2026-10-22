// Background removal for the file wheel and the image editor. Runs one of
// several segmentation models (ONNX exports published by rembg) through
// onnxruntime-node, on the GPU via DirectML or on the CPU. Models are large,
// so each is downloaded only when the user asks, checked against a pinned
// SHA-256.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RELEASES = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';
const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };

// ISNet (DIS, Apache-2.0) and BiRefNet (MIT). BiRefNet needs a sigmoid on
// its output; ISNet's is already a 0..1-ish map.
const MODELS = {
  isnet: {
    label: 'ISNet',
    about: 'Fast, good all-round',
    file: 'isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    size: '179 MB',
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    sigmoid: false
  },
  'birefnet-lite': {
    label: 'BiRefNet Lite',
    about: 'Sharper edges, a few seconds per image',
    file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    size: '224 MB',
    ...IMAGENET,
    sigmoid: true
  },
  birefnet: {
    label: 'BiRefNet',
    about: 'Best quality (hair, fine detail), slowest',
    file: 'BiRefNet-general-epoch_244.onnx',
    sha256: '58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c',
    size: '973 MB',
    ...IMAGENET,
    sigmoid: true
  },
  'birefnet-portrait': {
    label: 'BiRefNet Portrait',
    about: 'Tuned for people and hair',
    file: 'BiRefNet-portrait-epoch_150.onnx',
    sha256: '1ba1c8ff5a7bbfadc8d8d13fb11d7be793f91f23d9d466549e37a854f6668f99',
    size: '973 MB',
    ...IMAGENET,
    sigmoid: true
  }
};
const DEFAULT_MODEL = 'isnet';
const INPUT = 1024; // every model here takes 1024×1024
const IDLE_RELEASE_MS = 60000;

function createBackgroundRemover({ dir, log, getSettings = () => ({}), onStatus = () => {} }) {
  const home = path.join(dir, 'vendor', 'bgmodels');
  // 0.1.6 kept ISNet in vendor/isnet; keep using it if it's there.
  const legacy = path.join(dir, 'vendor', 'isnet', MODELS.isnet.file);
  const fileOf = (id) => (id === 'isnet' && fs.existsSync(legacy) ? legacy : path.join(home, MODELS[id].file));
  const installed = (id) => !!MODELS[id] && fs.existsSync(fileOf(id));
  const downloads = new Map();  // id → { promise, progress }
  let session = null;           // { key, session, device }
  let releaseTimer = null;

  const current = () => {
    const { bgModel } = getSettings();
    return MODELS[bgModel] ? bgModel : DEFAULT_MODEL;
  };

  function status() {
    return {
      selected: current(),
      device: getSettings().aiDevice === 'gpu' ? 'gpu' : 'cpu',
      lastDevice: session?.device || null,
      models: Object.entries(MODELS).map(([id, m]) => ({
        id,
        label: m.label,
        about: m.about,
        size: m.size,
        installed: installed(id),
        progress: downloads.has(id) ? downloads.get(id).progress : null
      }))
    };
  }

  function download(id = current(), onProgress) {
    const model = MODELS[id];
    if (!model) return Promise.reject(new Error('Unknown model'));
    if (downloads.has(id)) return downloads.get(id).promise;
    const entry = { progress: 0, promise: null };
    const report = (progress) => { entry.progress = progress; onProgress?.(progress); onStatus(status()); };
    entry.promise = (async () => {
      fs.mkdirSync(home, { recursive: true });
      const target = path.join(home, model.file);
      const partial = target + '.part';
      try {
        const response = await fetch(RELEASES + model.file);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const total = Number(response.headers.get('content-length')) || 0;
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(partial);
        let received = 0;
        let lastReport = 0;
        for await (const chunk of response.body) {
          hash.update(chunk);
          received += chunk.length;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          if (total && Date.now() - lastReport > 150) { lastReport = Date.now(); report(received / total); }
        }
        await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
        if (hash.digest('hex') !== model.sha256) throw new Error('Model download failed its checksum');
        fs.renameSync(partial, target);
        log(`background model ${id} installed`);
        return target;
      } finally {
        downloads.delete(id);
        fs.promises.rm(partial, { force: true }).catch(() => {});
        onStatus(status());
      }
    })();
    downloads.set(id, entry);
    onStatus(status());
    return entry.promise;
  }

  async function remove(id) {
    if (!MODELS[id] || downloads.has(id)) return;
    if (session?.key.startsWith(id + '|')) await releaseSession();
    const files = [path.join(home, MODELS[id].file)];
    if (id === 'isnet') files.push(legacy);
    for (const file of files) await fs.promises.rm(file, { force: true });
    log(`background model ${id} deleted`);
    onStatus(status());
  }

  async function releaseSession() {
    clearTimeout(releaseTimer);
    const old = session;
    session = null;
    try { await old?.session.release(); } catch (_) {}
  }

  // GPU runs through DirectML (Windows) or CoreML (macOS); if the driver or
  // the model's ops refuse, fall back to the CPU so the job still finishes.
  async function getSession(id) {
    const ort = require('onnxruntime-node');
    const wantGpu = getSettings().aiDevice === 'gpu';
    const key = `${id}|${wantGpu ? 'gpu' : 'cpu'}`;
    clearTimeout(releaseTimer);
    if (session?.key !== key) {
      await releaseSession();
      const options = { graphOptimizationLevel: 'all' };
      let created = null;
      let device = 'cpu';
      if (wantGpu) {
        try {
          // macOS: CoreML (GPU / Neural Engine). Windows: DirectML, which
          // needs memory patterns off and sequential execution.
          created = await ort.InferenceSession.create(fileOf(id), process.platform === 'darwin'
            ? { ...options, executionProviders: ['coreml'] }
            : {
              ...options,
              executionProviders: [{ name: 'dml', performancePreference: 'high-performance' }],
              enableMemPattern: false,
              executionMode: 'sequential'
            });
          device = 'gpu';
        } catch (error) {
          log('background removal: GPU unavailable, using CPU (' + String(error.message).split('\n')[0].slice(0, 160) + ')');
        }
      }
      if (!created) created = await ort.InferenceSession.create(fileOf(id), { ...options, executionProviders: ['cpu'] });
      session = { key, session: created, device };
      onStatus(status());
    }
    releaseTimer = setTimeout(releaseSession, IDLE_RELEASE_MS);
    return session.session;
  }

  // sharp pipeline in, PNG with a transparent background: written to `out`,
  // or returned as a buffer when `out` is null (the editor).
  async function removeBackground(input, out, onProgress) {
    const id = current();
    if (!installed(id)) throw new Error(`${MODELS[id].label} model is not downloaded`);
    const model = MODELS[id];
    const sharp = require('sharp');
    const ort = require('onnxruntime-node');
    const { data: rgba, info } = await input.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    onProgress?.(0.1);

    // rembg's preprocessing: RGB scaled to 0..1 by the brightest value,
    // then (x - mean) / std per channel, as a 1×3×1024×1024 planar tensor.
    const small = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .removeAlpha().resize(INPUT, INPUT, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
    let max = 1;
    for (let i = 0; i < small.length; i++) if (small[i] > max) max = small[i];
    const plane = INPUT * INPUT;
    const tensor = new Float32Array(plane * 3);
    for (let c = 0; c < 3; c++) {
      const mean = model.mean[c];
      const std = model.std[c];
      for (let i = 0; i < plane; i++) tensor[c * plane + i] = (small[i * 3 + c] / max - mean) / std;
    }
    onProgress?.(0.25);

    const net = await getSession(id);
    // Only the mask: ISNet also returns its side outputs, hundreds of MB.
    const results = await net.run({ [net.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, INPUT, INPUT]) }, [net.outputNames[0]]);
    const prediction = results[net.outputNames[0]].data;
    onProgress?.(0.85);

    const values = new Float32Array(plane);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < plane; i++) {
      const v = model.sigmoid ? 1 / (1 + Math.exp(-prediction[i])) : prediction[i];
      values[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const range = hi - lo || 1;
    const mask = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) mask[i] = Math.round(((values[i] - lo) / range) * 255);

    const alpha = await sharp(mask, { raw: { width: INPUT, height: INPUT, channels: 1 } })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();
    for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = Math.round((rgba[i * 4 + 3] * alpha[i]) / 255);
    const png = sharp(rgba, { raw: { width, height, channels: 4 } }).png();
    onProgress?.(1);
    if (!out) return png.toBuffer();
    await png.toFile(out);
    return out;
  }

  return {
    installed: () => installed(current()),
    size: () => MODELS[current()].size,
    label: () => MODELS[current()].label,
    download,
    remove,
    status,
    removeBackground
  };
}

module.exports = { createBackgroundRemover, BG_MODELS: Object.keys(MODELS) };
