const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Files parked on the notch. Only paths are kept (nothing is copied).
function createShelf({ dir, onChange }) {
  const file = path.join(dir, 'shelf.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, 'utf8')).filter((p) => typeof p === 'string'); } catch (_) {}
  const icons = new Map();

  async function iconFor(filePath) {
    if (!icons.has(filePath)) {
      try { icons.set(filePath, (await app.getFileIcon(filePath, { size: 'normal' })).toDataURL()); }
      catch (_) { icons.set(filePath, null); }
    }
    return icons.get(filePath);
  }

  async function list() {
    items = items.filter((p) => fs.existsSync(p));
    return Promise.all(items.map(async (p) => ({ path: p, name: path.basename(p), icon: await iconFor(p) })));
  }

  async function publish() {
    try { fs.writeFileSync(file, JSON.stringify(items)); } catch (_) {}
    onChange(await list());
  }

  return {
    list,
    async add(paths) {
      for (const p of paths) {
        if (typeof p === 'string' && p && fs.existsSync(p) && !items.includes(p)) items.push(p);
      }
      await publish();
    },
    async remove(p) { items = items.filter((i) => i !== p); await publish(); },
    async clear() { items = []; await publish(); },
    has: (p) => items.includes(p),
    icon: (p) => icons.get(p)
  };
}

module.exports = { createShelf };
