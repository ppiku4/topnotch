// Read-only integration check for restoring subscriptions after a real restart.
const { createSystemService } = require('../electron/system-service.cjs');
let generation = 0, restarted = false, finished = false;
const received = new Set(), errors = [];
const timeout = setTimeout(() => finish(new Error('Helper restart timed out')), 30000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  service.stop();
  console.log(JSON.stringify({ restartSmoke: error || errors.length ? 'failed' : 'passed', generations: generation, resumed: [...received], errors, error: error?.message }));
  if (error || errors.length) process.exitCode = 1;
}
const service = createSystemService({
  onLevels() {},
  log(message) { if (!message.includes('exited with')) errors.push(message); },
  onEvent(message) {
    if (message.type === 'ready') {
      generation++;
      if (generation === 1) { service.setStats(true); service.setMeter(true); }
    }
    if (message.type === 'net' && generation === 1 && !restarted) { restarted = true; service.restart(); }
    if (generation === 2 && ['net', 'peak'].includes(message.type)) received.add(message.type);
    if (received.size === 2) finish();
  }
});
