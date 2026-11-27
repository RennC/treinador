// Modo offline: guarda o app, as bibliotecas e os modelos base.
const CACHE = 'treinador-v8';
// Caminhos relativos ao endereço do app, que no GitHub Pages fica em uma subpasta.
const SHELL = ['./', 'styles.css', 'app.js', 'store.js', 'camera.js', 'cards.js', 'tester.js', 'results.js', 'home.js',
  'publish.js', 'playground.js', 'preview.js', 'preview.html', 'marca.css', 'festa.js', 'brand/zoom-logo.svg', 'brand/clube-inovacao.png',
  'engines/index.js', 'engines/common.js', 'engines/image.js', 'engines/pose.js', 'engines/audio.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map(path => new URL(path, self.location).href);
// TensorFlow.js 1.3.1: a biblioteca de pose não funciona com versões mais novas.
const LIBS = [
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js',
  'https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.6/dist/teachablemachine-pose.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.4.0/dist/speech-commands.min.js',
];
// Modelos base dos três tipos (imagem, pose e áudio) e arquivos das fontes.
const RUNTIME = [
  'https://fonts.gstatic.com/',
  'https://storage.googleapis.com/teachable-machine-models/',
  'https://storage.googleapis.com/tfjs-models/',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...SHELL, ...LIBS]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // O endereço github.io é compartilhado entre sites: apaga só os caches antigos deste app.
    await Promise.all(keys.filter(key => key.startsWith('treinador-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Bibliotecas, fontes e modelos base não mudam: cache primeiro, guardando no primeiro uso.
  if (LIBS.includes(url.href) || RUNTIME.some(prefix => url.href.startsWith(prefix))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  // Arquivos do app: rede primeiro, cache quando estiver offline.
  const file = url.origin + url.pathname;
  if (SHELL.includes(file)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(file, response.clone());
        return response;
      } catch (error) {
        const hit = await cache.match(file);
        if (hit) return hit;
        throw error;
      }
    })());
  }
});
