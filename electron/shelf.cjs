const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createWriter } = require('./persistence.cjs');

async function mapBounded(items, fn, concurrency = 8) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}
const exists = async (file) => {
  try { await fs.promises.access(file); return true; }
  catch (error) { return !['ENOENT', 'ENOTDIR'].includes(error.code); }
};

function createShelf({ dir, onChange }) {
  const file = path.join(dir, 'shelf.json');
  let items = [];
  try { items = [...new Set(JSON.parse(fs.readFileSync(file, 'utf8')).filter((p) => typeof p === 'string'))]; } catch (_) {}
  const writer = createWriter(file);
  const icons = new Map();
  const pendingIcons = new Map();
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function iconFor(filePath) {
    if (icons.has(filePath)) return icons.get(filePath);
    if (!pendingIcons.has(filePath)) {
      pendingIcons.set(filePath, app.getFileIcon(filePath, { size: 'normal' })
        .then((icon) => icon.toDataURL(), () => null).then((icon) => {
          pendingIcons.delete(filePath);
          if (items.includes(filePath)) {
            if (icons.size >= 256) icons.delete(icons.keys().next().value);
            icons.set(filePath, icon);
          }
          return icon;
        }));
    }
    return pendingIcons.get(filePath);
  }
  async function list() {
    const snapshot = [...items];
    const rows = await mapBounded(snapshot, async (p) => (await exists(p))
      ? { path: p, name: path.basename(p), icon: await iconFor(p) } : null);
    return rows.filter(Boolean);
  }
  async function publish() {
    for (const p of icons.keys()) if (!items.includes(p)) icons.delete(p);
    writer.write(JSON.stringify(items));
    onChange(await list());
  }
  return {
    list,
    add: (paths) => serialize(async () => {
      const candidates = [...new Set(paths.filter((p) => typeof p === 'string' && p && !items.includes(p)))];
      const valid = await mapBounded(candidates, exists);
      items.push(...candidates.filter((_p, i) => valid[i]));
      await publish();
    }),
    remove: (p) => serialize(async () => { items = items.filter((i) => i !== p); await publish(); }),
    clear: () => serialize(async () => { items = []; await publish(); }),
    flush: async () => { await queue; await writer.flush(); },
    has: (p) => items.includes(p),
    icon: (p) => icons.get(p)
  };
}
module.exports = { createShelf };
