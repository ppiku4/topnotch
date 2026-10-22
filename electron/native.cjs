// OS-level calls (input state, glass, focus, media keys) for the current
// platform. Both modules export the same functions.
module.exports = process.platform === 'darwin' ? require('./darwin.cjs') : require('./win32.cjs');
