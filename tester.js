// Painel de teste ao vivo, usado no app (modelo em memória) e na página do link.
import { openCamera, closeCamera, switchCamera, grabFrame, fileToCanvas } from './camera.js';
import { showPredictions, drawOverlay } from './results.js';
import { mediaError } from './cards.js';

const $ = selector => document.querySelector(selector);

/**
 * getTarget() devolve { engine, model } quando há um modelo pronto, ou null.
 */
export function createTester({ getTarget, notify, beforeStart = () => {} }) {
  let active = null; // { stop() } enquanto o teste ao vivo está ligado
  let run = 0;

  function clear() {
    run++;
    $('#predictions').replaceChildren();
    if ($('#winner')) $('#winner').textContent = '';
    $('#previewImage').hidden = true;
  }

  function update() {
    const target = getTarget();
    const microphone = target?.engine.media === 'microphone' || $('#previewPanel').dataset.media === 'microphone';
    $('#previewToggle').disabled = !target;
    $('#previewToggle').textContent = `${active ? 'Desligar' : 'Ligar'} ${microphone ? 'microfone' : 'câmera'}`;
    $('#previewSwitch').hidden = !active || microphone;
    $('#previewFileLabel').hidden = microphone;
    $('#previewFileLabel').classList.toggle('disabled', !target);
    $('#previewFile').disabled = !target;
    $('#listening').hidden = !active || !microphone;
  }

  function stop() {
    const previous = active;
    active = null;
    run++;
    previous?.stop();
    update();
  }

  async function startCamera(target) {
    const session = { stop: closeCamera };
    const opening = openCamera($('#previewCamera video'), () => {
      $('#previewCamera').hidden = true;
      if (active === session) {
        active = null;
        run++;
        update();
      }
    });
    active = session;
    $('#previewCamera').hidden = false;
    $('#previewImage').hidden = true;
    update();
    if (!await opening) return;
    const current = ++run;
    while (current === run && active === session) {
      const frame = grabFrame(target.engine.sampleSize);
      if (frame) {
        const result = await target.model.predict(frame);
        if (current !== run) return;
        showPredictions($('#predictions'), result.predictions);
        drawOverlay($('#overlay'), target.engine, result.pose, target.engine.sampleSize);
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  }

  async function startMicrophone(target) {
    let cancel = false;
    let stopListening = null;
    const session = { stop: () => { cancel = true; stopListening?.(); } };
    active = session;
    update();
    stopListening = await target.model.listen(predictions => {
      if (active === session) showPredictions($('#predictions'), predictions);
    });
    if (cancel) stopListening();
  }

  $('#previewToggle').onclick = async () => {
    if (active) return stop();
    const target = getTarget();
    if (!target) return;
    beforeStart();
    notify('');
    const microphone = target.engine.media === 'microphone';
    try {
      await (microphone ? startMicrophone(target) : startCamera(target));
    } catch (error) {
      stop();
      notify(mediaError(error, microphone ? 'microfone' : 'câmera'));
    }
  };

  $('#previewSwitch').onclick = () => switchCamera().catch(error => notify(mediaError(error)));

  $('#previewFile').onchange = async event => {
    const [file] = event.target.files;
    event.target.value = '';
    const target = getTarget();
    if (!file || !target) return;
    stop();
    const current = ++run;
    try {
      const size = target.engine.sampleSize;
      const canvas = await fileToCanvas(file, size);
      const result = await target.model.predict(canvas);
      if (current !== run) return;
      if (result.pose) target.engine.drawPose(canvas.getContext('2d'), result.pose);
      $('#previewImage').src = canvas.toDataURL('image/jpeg', 0.92);
      $('#previewImage').hidden = false;
      showPredictions($('#predictions'), result.predictions);
    } catch (error) {
      notify(`Não foi possível testar a imagem: ${error.message || error}`);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) stop();
  });

  return { stop, clear, update };
}
