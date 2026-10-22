const { spawn } = require('child_process');
const path = require('path');
const child = spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(__dirname, '../electron/system-helper.ps1'),
  '-SourcePath', path.join(__dirname, '../electron/system-helper.cs')
], { windowsHide: true });
let buffer = '', ready = false;
const types = new Set(), errors = new Set();
const timeout = setTimeout(() => { child.kill(); console.error('Native smoke timed out'); process.exitCode = 1; }, 25000);
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/); buffer = lines.pop();
  for (const line of lines) {
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    types.add(msg.type);
    if (msg.type === 'error') errors.add(msg.message);
    if (msg.type === 'ready') {
      ready = true;
      // Read-only controls; never change playback, volume or brightness.
      child.stdin.write('get\nstats on\nmeter on\nmixer list\n');
      setTimeout(() => child.stdin.end('stats off\nmeter off\n'), 6000);
    }
  }
});
child.stderr.on('data', () => {});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => {
  clearTimeout(timeout);
  const passed = ready && code === 0 && errors.size === 0;
  console.log(JSON.stringify({ nativeSmoke: passed ? 'passed' : 'limited', exit: code, eventTypes: [...types], errors: [...errors] }));
  if (!passed) process.exitCode = 1;
});
