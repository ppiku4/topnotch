const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

function load(relative, mocks = {}, globals = {}, append = '') {
  const filename = path.resolve(__dirname, '..', relative);
  const localRequire = createRequire(filename);
  const box = {
    module: { exports: {} }, exports: {}, Buffer, process, console,
    setTimeout, clearTimeout, setInterval, clearInterval, structuredClone,
    __dirname: path.dirname(filename), __filename: filename,
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
    ...globals
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + append, box, { filename });
  return box.module.exports;
}
module.exports = { load };
