const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (!isMainThread) {
  try {
    const { decodeDib, decodeIco } = require('./image-codecs.cjs');
    const buf = Buffer.from(workerData.bytes);
    const result = workerData.ext === 'bmp' ? decodeDib(buf, 14, { fileHeader: true }) : decodeIco(buf);
    const bytes = result.data || result.png;
    parentPort.postMessage(result, [bytes.buffer]);
  } catch (error) { parentPort.postMessage({ error: error.message }); }
} else {
  // Bound decoding and keep malformed images off the Electron main thread.
  exports.decodeImage = (buf, ext) => new Promise((resolve, reject) => {
    const bytes = Uint8Array.from(buf);
    // Node's worker loader needs a physical path in packaged Electron apps.
    const workerFile = __filename.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
    const worker = new Worker(workerFile, {
      workerData: { bytes: bytes.buffer, ext }, transferList: [bytes.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 64 }
    });
    const timer = setTimeout(() => finish(new Error('Image decoding timed out')), 30000);
    let settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      if (error) reject(error);
      else {
        if (result.data) result.data = Buffer.from(result.data);
        if (result.png) result.png = Buffer.from(result.png);
        resolve(result);
      }
    }
    worker.once('message', (result) => finish(result.error ? new Error(result.error) : null, result));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!settled) finish(new Error(`Image decoder exited (${code})`)); });
  });
}
