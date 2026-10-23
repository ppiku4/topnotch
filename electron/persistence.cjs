const fs = require('fs');

// Serialize writes and coalesce pending snapshots. Readers see either the old
// complete file or the new one, never an interrupted JSON write.
function createWriter(file, encode = (value) => value) {
  let pending;
  let writing = null;
  let failure = null;
  async function drain() {
    while (pending !== undefined) {
      const value = pending;
      pending = undefined;
      try {
        await fs.promises.writeFile(file + '.tmp', encode(value));
        await fs.promises.rename(file + '.tmp', file);
        failure = null;
      } catch (error) { failure = error; }
    }
  }
  function start() {
    if (!writing) writing = Promise.resolve().then(drain).finally(() => {
      writing = null;
      if (pending !== undefined) start();
    });
  }
  function write(value) {
    pending = value;
    start();
  }
  async function flush() {
    while (writing) await writing;
    if (failure) throw failure;
  }
  return { write, flush };
}
module.exports = { createWriter };
