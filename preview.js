// Página do link publicado: carrega o modelo exatamente como um app externo faria.
import { engineFor } from './engines/index.js';
import { createTester } from './tester.js';

const $ = selector => document.querySelector(selector);
const base = new URL('./', location.href).href;
$('#url').textContent = base;

const report = message => { if (message) $('#status').textContent = message; };

try {
  const response = await fetch(`${base}metadata.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('modelo não encontrado');
  const engine = engineFor(await response.json());
  $('#previewPanel').dataset.media = engine.media;
  let target = null;
  const tester = createTester({ getTarget: () => target, notify: report });
  tester.update();
  const model = await engine.open(base);
  target = { engine, model };
  tester.update();
  $('#status').textContent = `Modelo de ${engine.title.toLowerCase()} carregado: ${model.labels.join(', ')}`;
} catch (error) {
  console.error(error);
  $('#status').textContent = `Não foi possível carregar o modelo: ${error.message || error}`;
}
