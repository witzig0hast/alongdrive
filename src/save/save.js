// Spielstände in IndexedDB + Export/Import als JSON
const DB_NAME = 'deaddesert';
const STORE = 'saves';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const res = fn(store);
    t.oncomplete = () => {
      db.close();
      resolve(res && 'result' in res ? res.result : undefined);
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const SaveStore = {
  async list() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      return (all || []).sort((a, b) => b.updated - a.updated).map(({ data, ...meta }) => meta);
    } catch {
      return [];
    }
  },
  async get(id) {
    return tx('readonly', (s) => s.get(id));
  },
  async put(rec) {
    rec.updated = Date.now();
    await tx('readwrite', (s) => s.put(rec));
    return rec;
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
  },
  newId() {
    return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  },
  exportJSON(rec) {
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dead-desert-${(rec.name || 'save').replace(/[^\w-]+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  },
  async importFile(file) {
    const text = await file.text();
    const rec = JSON.parse(text);
    if (!rec || !rec.data || !rec.seed) throw new Error('Ungültiger Spielstand');
    rec.id = this.newId();
    rec.name = (rec.name || 'Import') + ' (Import)';
    await this.put(rec);
    return rec;
  },
};
