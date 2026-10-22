const fs = require('fs');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// pipeline observes errors on every stream, including open/write/close errors,
// and destroys the response when the destination fails.
async function saveResponse(response, dest, sha256, onProgress, fallbackSize = 0) {
  try {
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
    const total = Number(response.headers.get('content-length')) || fallbackSize;
    const hash = crypto.createHash('sha256');
    let received = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        try {
          hash.update(chunk);
          received += chunk.length;
          onProgress?.({ received, total, progress: total ? Math.min(1, received / total) : 0 });
          callback(null, chunk);
        } catch (error) { callback(error); }
      }
    });
    await pipeline(Readable.from(response.body), meter, fs.createWriteStream(dest));
    if (hash.digest('hex') !== sha256.toLowerCase()) throw new Error('Download failed its checksum');
    return dest;
  } catch (error) {
    await fs.promises.rm(dest, { force: true }).catch(() => {});
    throw error;
  }
}

async function downloadVerified(urls, sha256, dest, onProgress) {
  let lastError;
  for (const url of [].concat(urls)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
      let lastReport = 0;
      await saveResponse(response, dest, sha256, ({ progress, total }) => {
        if (total && Date.now() - lastReport > 150) { lastReport = Date.now(); onProgress?.(progress); }
      });
      onProgress?.(1);
      return dest;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('No download URL');
}

module.exports = { saveResponse, downloadVerified };
