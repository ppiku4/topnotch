// Read-only integration check for restoring subscriptions after a real restart.
const { createSystemService } = require('../electron/system-service.cjs');
const { isMissingAudio } = require('./native-capabilities.cjs');
let generation = 0, restarted = false, finished = false;
let audioUnavailable = false, expectedExit = false;
const received = new Set(), errors = [];
const unavailable = [];
const timeout = setTimeout(() => finish(new Error('Helper restart timed out')), 30000);
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  service.stop();
  console.log(JSON.stringify({ restartSmoke: error || errors.length ? 'failed' : audioUnavailable ? 'passed-without-audio' : 'passed', generations: generation, resumed: [...received], skipped: audioUnavailable && !received.has('peak') ? ['peak (no audio endpoint)'] : [], unavailable, errors, error: error?.message }));
  if (error || errors.length) process.exitCode = 1;
}
function checkComplete() {
  if (generation === 2 && received.has('net') && (received.has('peak') || audioUnavailable)) finish();
}
const service = createSystemService({
  onLevels() {},
  log(message) {
    if (expectedExit && /^\[system-helper\] exited with /.test(message)) { expectedExit = false; return; }
    if (isMissingAudio(message)) {
      unavailable.push(message);
      // Mixer failure alone does not prove the meter lacks an endpoint.
      if (/^\[system-helper\] audio endpoint:/.test(message)) audioUnavailable = true;
      checkComplete();
    } else errors.push(message);
  },
  onEvent(message) {
    if (message.type === 'ready') {
      generation++;
      if (generation === 1) { service.setStats(true); service.setMeter(true); }
    }
    if (message.type === 'net' && generation === 1 && !restarted) {
      restarted = true;
      expectedExit = true;
      audioUnavailable = false; // Require fresh evidence from the restarted helper.
      service.restart();
    }
    if (generation === 2 && ['net', 'peak'].includes(message.type)) received.add(message.type);
    checkComplete();
  }
});
