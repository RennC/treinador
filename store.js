// Projetos guardados no próprio tablet (IndexedDB).
const open = new Promise((resolve, reject) => {
  const req = indexedDB.open('treinador-modelos', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function run(mode, action) {
  const db = await open;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode);
    const req = action(tx.objectStore('projects'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const store = {
  all: () => run('readonly', s => s.getAll()),
  put: project => run('readwrite', s => s.put(project)),
  remove: id => run('readwrite', s => s.delete(id)),
};
