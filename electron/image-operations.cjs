// CPU-heavy pixel loops execute only inside image-tasks' worker.
exports.tensor = (small, mean, std, input) => {
  let max = 1;
  for (const value of small) if (value > max) max = value;
  const plane = input * input;
  const tensor = new Float32Array(plane * 3);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < plane; i++) tensor[c * plane + i] = (small[i * 3 + c] / max - mean[c]) / std[c];
  }
  return tensor;
};
exports.mask = (prediction, sigmoid) => {
  const values = new Float32Array(prediction.length);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = sigmoid ? 1 / (1 + Math.exp(-prediction[i])) : prediction[i];
    values[i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const range = hi - lo || 1;
  const mask = Buffer.alloc(values.length);
  for (let i = 0; i < values.length; i++) mask[i] = Math.round(((values[i] - lo) / range) * 255);
  return mask;
};
exports.alpha = (rgba, alpha) => {
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * alpha[i] / 255);
  return rgba;
};
exports.preview = async (file) => {
  const { loadImage } = require('./convert.cjs');
  return (await loadImage(file)).rotate().png().toBuffer();
};
exports.convert = async (file, ext, out) => {
  const { loadImage, saveImage } = require('./convert.cjs');
  await saveImage((await loadImage(file)).rotate(), ext, out);
};
exports.save = async (png, ext, out) => {
  const { saveImage } = require('./convert.cjs');
  await saveImage(require('sharp')(Buffer.from(png)), ext, out);
};
