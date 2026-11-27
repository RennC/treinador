// Cartões de classe: coleta por câmera (imagem e pose) ou por microfone (áudio).
import { openCamera, closeCamera, switchCamera, grabFrame, fileToCanvas } from './camera.js';
import { thumbnail } from './engines/audio.js';

const MAX_SAMPLES = 500;

export const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export function mediaError(error, device = 'câmera') {
  if (error?.name === 'NotAllowedError') return `Permissão negada. Libere ${device === 'câmera' ? 'a câmera' : 'o microfone'} nas configurações do site no navegador.`;
  if (error?.name === 'NotFoundError') return `Não há ${device} disponível neste aparelho.`;
  if (error?.name === 'NotReadableError') return `Não foi possível usar ${device === 'câmera' ? 'a câmera' : 'o microfone'}: talvez outro aplicativo esteja usando.`;
  return error?.message || `Não foi possível abrir ${device === 'câmera' ? 'a câmera' : 'o microfone'}.`;
}

// ---------- Gravação de áudio (uma classe por vez) ----------

let stopCurrent = null;

export function stopRecording() {
  stopCurrent?.();
  stopCurrent = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRecording();
});

// ---------- Cartões ----------

/**
 * context: { engine, project, notify, changed(), renamed(cls), remove(cls), beforeCapture() }
 */
export function classCard(cls, context) {
  const { engine, project, notify } = context;
  const audio = engine.media === 'microphone';
  const noise = audio && project.classes.indexOf(cls) === 0;
  const count = el('p', { className: 'count' });
  count.setAttribute('aria-live', 'polite');
  const thumbs = el('div', { className: audio ? 'thumbs audio' : 'thumbs' });

  const updateCount = () => {
    const minimum = engine.minimum(project.classes.indexOf(cls));
    const total = cls.samples.length;
    const missing = minimum - total;
    count.textContent = missing > 0
      ? `${missing === 1 ? 'Falta 1 exemplo' : `Faltam ${missing} exemplos`}. Você tem ${total}.`
      : `✓ ${total} exemplos. Já dá para treinar.`;
    count.classList.toggle('enough', missing <= 0);
  };

  const addThumb = sample => {
    const src = audio ? thumbnail(sample) : sample;
    const button = el('button', { ariaLabel: 'Apagar este exemplo (toque duas vezes)' }, el('img', { src, alt: '' }));
    let timer;
    // Dois toques para excluir, para evitar apagar sem querer.
    button.onclick = () => {
      if (!button.classList.contains('armed')) {
        button.classList.add('armed');
        timer = setTimeout(() => button.classList.remove('armed'), 2500);
        return;
      }
      clearTimeout(timer);
      cls.samples.splice([...thumbs.children].indexOf(button), 1);
      button.remove();
      updateCount();
      context.changed();
    };
    thumbs.append(button);
  };

  const addSample = sample => {
    if (cls.samples.length >= MAX_SAMPLES) {
      notify(`Cada classe aceita até ${MAX_SAMPLES} exemplos.`);
      return false;
    }
    cls.samples.push(sample);
    addThumb(sample);
    updateCount();
    context.changed();
    thumbs.scrollTop = thumbs.scrollHeight;
    return true;
  };

  const name = el('input', { value: cls.name, maxLength: 60, readOnly: noise });
  name.oninput = () => {
    cls.name = name.value;
    context.renamed(cls);
  };
  const head = el('div', { className: 'class-head' },
    el('label', {}, noise ? 'Som do ambiente' : 'Nome da classe', name));
  if (!noise) {
    head.append(el('button', { className: 'danger', textContent: 'Apagar classe', onclick: () => context.remove(cls) }));
  }

  const controls = audio
    ? audioControls({ context, addSample, noise })
    : cameraControls({ context, addSample });

  cls.samples.forEach(addThumb);
  updateCount();
  return el('article', { className: 'class-card' }, head,
    el('div', { className: 'row' }, ...controls.buttons), ...controls.panels, count, thumbs);
}

function audioControls({ context, addSample, noise }) {
  const { engine, notify } = context;
  const status = el('p', { className: 'help', hidden: true });
  status.setAttribute('aria-live', 'polite');
  const one = el('button', { className: 'primary', textContent: 'Gravar 1 vez' });
  const many = el('button', { textContent: 'Gravar várias vezes' });

  const start = async continuous => {
    context.beforeCapture();
    notify('');
    let cancelled = false;
    const reset = () => {
      many.textContent = 'Gravar várias vezes';
      many.classList.remove('recording');
      one.disabled = many.disabled = false;
      status.hidden = true;
    };
    stopCurrent = () => { cancelled = true; reset(); };
    one.disabled = true;
    many.disabled = !continuous;
    if (continuous) {
      many.textContent = 'Parar';
      many.classList.add('recording');
    }
    status.hidden = false;
    status.textContent = 'Preparando o microfone…';
    try {
      let recorded = 0;
      do {
        const pending = engine.record();
        status.textContent = recorded ? `Gravando… já foram ${recorded}` : 'Gravando…';
        const sample = await pending;
        if (cancelled || !addSample(sample)) break;
        recorded++;
      } while (continuous);
    } catch (error) {
      if (!cancelled) notify(mediaError(error, 'microfone'));
    }
    if (!cancelled) {
      stopCurrent = null;
      reset();
    }
  };

  one.onclick = () => start(false);
  many.onclick = () => many.classList.contains('recording') ? stopRecording() : start(true);

  const hint = el('p', {
    className: 'help',
    textContent: noise
      ? 'Fique em silêncio e grave o som da sala.'
      : 'Faça o som enquanto grava. Cada gravação dura 1 segundo.',
  });
  return { buttons: [one, many], panels: [hint, status] };
}

function cameraControls({ context, addSample }) {
  const { engine, notify } = context;
  const video = el('video', { muted: true, playsInline: true, autoplay: true });
  const record = el('button', { className: 'primary record', textContent: 'Tirar foto' });
  const flip = el('button', { textContent: 'Trocar câmera' });
  const close = el('button', { textContent: 'Fechar câmera', onclick: closeCamera });
  const capture = el('div', { className: 'capture', hidden: true },
    el('div', { className: 'camera' }, video),
    el('p', { className: 'help', textContent: 'Toque para tirar uma foto. Segure para tirar várias.' }),
    el('div', { className: 'row' }, record, flip, close));

  const toSample = canvas => canvas.toDataURL('image/jpeg', 0.92);

  let interval = null;
  let delay = null;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(interval);
    interval = delay = null;
    record.classList.remove('recording');
  };
  const shoot = () => {
    const frame = grabFrame(engine.sampleSize);
    if (frame && !addSample(toSample(frame))) stop();
  };
  record.onpointerdown = event => {
    if (event.button !== 0 || delay) return;
    record.setPointerCapture(event.pointerId);
    shoot();
    // Um toque rápido tira só uma foto; a sequência começa depois de segurar um instante.
    delay = setTimeout(() => {
      record.classList.add('recording');
      interval = setInterval(shoot, 150);
    }, 500);
  };
  record.onpointerup = record.onpointercancel = record.onlostpointercapture = stop;
  // Teclado e leitores de tela acionam o botão sem ponteiro (detail igual a 0).
  record.onclick = event => { if (event.detail === 0) shoot(); };
  record.oncontextmenu = event => event.preventDefault();
  flip.onclick = () => switchCamera().catch(error => notify(mediaError(error)));

  const cameraButton = el('button', { className: 'primary', textContent: 'Usar a câmera' });
  cameraButton.onclick = async () => {
    context.beforeCapture();
    notify('');
    try {
      const opening = openCamera(video, () => { stop(); capture.hidden = true; });
      capture.hidden = false;
      await opening;
    } catch (error) {
      notify(mediaError(error));
    }
  };

  const file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  file.onchange = async () => {
    let failed = 0;
    for (const item of [...file.files]) {
      try {
        if (!addSample(toSample(await fileToCanvas(item, engine.sampleSize)))) break;
      } catch {
        failed++;
      }
    }
    file.value = '';
    if (failed) notify(`${failed} arquivo(s) não puderam ser lidos como imagem.`);
  };

  const choose = el('label', { className: 'button', tabIndex: 0 }, 'Escolher fotos', file);
  return { buttons: [cameraButton, choose], panels: [capture] };
}
