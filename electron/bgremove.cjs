// Background removal for the file wheel. Runs the ISNet "general use" model
// (DIS, Apache-2.0; the ONNX export rembg publishes) on the CPU through
// onnxruntime-node. The model is about 179 MB, so it's downloaded only when
// the user asks, checked against a pinned SHA-256.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const MODEL_SHA256 = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a';
const MODEL_SIZE = '179 MB';
const INPUT = 1024; // ISNet's input resolution
const IDLE_RELEASE_MS = 60000;

function createBackgroundRemover({ dir, log }) {
  const home = path.join(dir, 'vendor', 'isnet');
  const modelFile = path.join(home, 'isnet-general-use.onnx');
  let session = null;
  let releaseTimer = null;
  let downloading = null;

  const installed = () => fs.existsSync(modelFile);

  async function download(onProgress) {
    if (downloading) return downloading;
    downloading = (async () => {
      fs.mkdirSync(home, { recursive: true });
      const partial = modelFile + '.part';
      try {
        const response = await fetch(MODEL_URL);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const total = Number(response.headers.get('content-length')) || 0;
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(partial);
        let received = 0;
        for await (const chunk of response.body) {
          hash.update(chunk);
          received += chunk.length;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          if (total) onProgress?.(received / total);
        }
        await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
        if (hash.digest('hex') !== MODEL_SHA256) throw new Error('Model download failed its checksum');
        fs.renameSync(partial, modelFile);
        log('background model installed');
        return modelFile;
      } finally {
        downloading = null;
        fs.promises.rm(partial, { force: true }).catch(() => {});
      }
    })();
    return downloading;
  }

  // The session holds a few hundred MB; drop it a minute after last use.
  async function getSession() {
    clearTimeout(releaseTimer);
    if (!session) {
      const ort = require('onnxruntime-node');
      session = await ort.InferenceSession.create(modelFile, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
    }
    releaseTimer = setTimeout(() => { session?.release?.(); session = null; }, IDLE_RELEASE_MS);
    return session;
  }

  // sharp pipeline in, PNG with a transparent background written to `out`.
  async function removeBackground(input, out, onProgress) {
    const sharp = require('sharp');
    const ort = require('onnxruntime-node');
    const { data: rgba, info } = await input.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    onProgress?.(0.1);

    // rembg's ISNet preprocessing: RGB scaled to 0..1 by the brightest
    // value, minus 0.5, as a 1×3×1024×1024 planar tensor.
    const small = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .removeAlpha().resize(INPUT, INPUT, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
    let max = 1;
    for (let i = 0; i < small.length; i++) if (small[i] > max) max = small[i];
    const plane = INPUT * INPUT;
    const tensor = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) {
      tensor[i] = small[i * 3] / max - 0.5;
      tensor[plane + i] = small[i * 3 + 1] / max - 0.5;
      tensor[plane * 2 + i] = small[i * 3 + 2] / max - 0.5;
    }
    onProgress?.(0.25);

    const model = await getSession();
    const results = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, INPUT, INPUT]) });
    const prediction = results[model.outputNames[0]].data;
    onProgress?.(0.85);

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < plane; i++) { const v = prediction[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const range = hi - lo || 1;
    const mask = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) mask[i] = Math.round(((prediction[i] - lo) / range) * 255);

    const alpha = await sharp(mask, { raw: { width: INPUT, height: INPUT, channels: 1 } })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();
    for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = Math.round((rgba[i * 4 + 3] * alpha[i]) / 255);
    await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(out);
    onProgress?.(1);
  }

  return { installed, download, removeBackground, size: MODEL_SIZE };
}

module.exports = { createBackgroundRemover };
