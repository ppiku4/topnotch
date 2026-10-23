const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (!isMainThread && require.main === module) {
  let queue = Promise.resolve();
  parentPort.on('message', ({ id, task, args }) => {
    queue = queue.then(async () => {
    try {
      const result = await require(workerData.operations)[task](...args);
      parentPort.postMessage({ id, result }, !Buffer.isBuffer(result) && ArrayBuffer.isView(result) && result.byteLength === result.buffer.byteLength ? [result.buffer] : []);
    } catch (error) { parentPort.postMessage({ id, error: error.message }); }
    });
  });
} else {
  let worker = null;
  let nextId = 0;
  let idle;
  const pending = new Map();
  function stop(error) {
    const old = worker;
    worker = null;
    clearTimeout(idle);
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear();
    old?.terminate().catch(() => {});
  }
  exports.runImageTask = (task, ...args) => new Promise((resolve, reject) => {
    clearTimeout(idle);
    if (!worker) {
      const file = __filename.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
      const current = worker = new Worker(file, { workerData: { operations: require.resolve('./image-operations.cjs') } });
      current.on('message', ({ id, result, error }) => {
        const job = pending.get(id);
        if (!job) return;
        pending.delete(id); clearTimeout(job.timer);
        if (error) job.reject(new Error(error)); else job.resolve(result);
        if (!pending.size) {
          current.unref();
          idle = setTimeout(() => stop(new Error('Worker idle')), 30000);
          idle.unref();
        }
      });
      current.on('error', (error) => { if (worker === current) stop(error); });
      current.on('exit', (code) => { if (worker === current) stop(new Error(`Image worker exited (${code})`)); });
    }
    worker.ref();
    const id = ++nextId;
    const timer = setTimeout(() => stop(new Error('Image processing timed out')), 180000);
    pending.set(id, { resolve, reject, timer });
    try { worker.postMessage({ id, task, args }); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); if (!pending.size) stop(error); }
  });
}
