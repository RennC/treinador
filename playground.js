// Entrega o modelo treinado à nossa cópia do playground, sem link e sem arquivo.
// As duas páginas ficam no mesmo endereço (origem), por isso dividem o IndexedDB do navegador.
// O banco, a chave e o formato são lidos por playground/modelo-local.js.
export const PLAYGROUND_URL = '../playground/';

const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('treinador-playground', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('modelo');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// files: o resultado de model.export(). Substitui o modelo enviado antes.
export async function sendToPlayground(files, name) {
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('modelo', 'readwrite');
      tx.objectStore('modelo').put({ name, ...files }, 'atual');
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// O botão só aparece onde a cópia do playground existe.
export const hasPlayground = () => fetch(`${PLAYGROUND_URL}modelo-local.js`, { method: 'HEAD', cache: 'no-cache' })
  .then(response => response.ok, () => false);
