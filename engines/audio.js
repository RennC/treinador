import { loadScript, exportFiles, epochCallbacks } from './common.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.4.0/dist/speech-commands.min.js';
export const NOISE = 'Background Noise';
const RECORD_TIMEOUT = 6000;
const LISTEN = { probabilityThreshold: 0, invokeCallbackOnNoiseAndUnknown: true, overlapFactor: 0.5 };

let basePromise = null;
let recorder = null;
let queue = Promise.resolve(); // uma gravação por vez
let counter = 0;

function loadBase() {
  basePromise ??= (async () => {
    await loadScript(LIB);
    const base = speechCommands.create('BROWSER_FFT');
    await base.ensureModelLoaded();
    return base;
  })().catch(error => {
    basePromise = null;
    throw error;
  });
  return basePromise;
}

function assertMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('O microfone exige HTTPS (ou localhost).');
  }
}

async function recordOne() {
  assertMicrophone();
  const base = await loadBase();
  recorder ??= base.createTransfer(`recorder${++counter}`);
  const current = recorder;
  let timer;
  try {
    await Promise.race([
      current.collectExample('sample'),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('O microfone não está enviando som. Verifique se ele está livre e ligado.')), RECORD_TIMEOUT);
      }),
    ]);
  } catch (error) {
    // Descarta o gravador travado para a próxima tentativa começar do zero.
    current.audioDataExtractor?.stop().catch(() => {});
    delete base.transferRecognizers[current.name];
    recorder = null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const { spectrogram } = current.getExamples('sample').at(-1).example;
  current.clearExamples();
  return { data: Float32Array.from(spectrogram.data), frameSize: spectrogram.frameSize };
}

// Escuta o microfone e entrega as probabilidades; devolve uma função que encerra a escuta.
function listener(recognizer, names) {
  let chain = Promise.resolve(); // ligar e desligar acontecem um de cada vez
  let latest = 0;
  const halt = async () => {
    if (recognizer.isListening()) await recognizer.stopListening();
  };
  return async function listen(onPredictions) {
    assertMicrophone();
    const mine = ++latest;
    const started = chain.then(async () => {
      if (mine !== latest) return; // outro pedido chegou antes de este começar
      await halt();
      await recognizer.listen(async ({ scores }) => {
        onPredictions(names().map((className, index) => ({ className, probability: scores[index] })));
      }, LISTEN);
    });
    chain = started.catch(() => {});
    await started;
    // Um pedido antigo não pode desligar a escuta mais nova.
    return () => {
      if (mine === latest) chain = chain.then(halt).catch(() => {});
      return chain;
    };
  };
}

// Desenha o espectrograma de uma amostra para servir de miniatura.
export function thumbnail({ data, frameSize }) {
  const frames = data.length / frameSize;
  const bins = Math.min(frameSize, 160); // as frequências mais altas quase não têm informação
  const canvas = document.createElement('canvas');
  canvas.width = frames;
  canvas.height = bins;
  const context = canvas.getContext('2d');
  const image = context.createImageData(frames, bins);
  let min = Infinity;
  let max = -Infinity;
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  for (let x = 0; x < frames; x++) {
    for (let y = 0; y < bins; y++) {
      const level = (data[x * frameSize + y] - min) / (max - min || 1);
      const strong = Math.max(0, level - 0.5) * 2;
      image.data.set([strong * 245, level * 90 + strong * 60, 40 + level * 190 - strong * 90, 255],
        ((bins - 1 - y) * frames + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export default {
  id: 'audio',
  title: 'Áudio',
  description: 'Reconhece sons de 1 segundo captados pelo microfone.',
  media: 'microphone',
  params: { epochs: 50, batchSize: 16, learningRate: 0.001 },
  minimum: index => index === 0 ? 20 : 8,
  requirement: 'Grave pelo menos 20 amostras de ruído de fundo e 8 em cada outra classe.',
  defaultClasses: () => [NOISE, 'Class 2'],

  record() {
    const result = queue.then(recordOne);
    queue = result.catch(() => {});
    return result;
  },

  async train(classes, params, progress) {
    progress(null, 'Carregando o modelo de áudio…');
    const base = await loadBase();
    const name = `model${++counter}`;
    const net = base.createTransfer(name);
    const release = () => {
      try { net.transferHead?.dispose(); } catch { /* já liberado */ }
      delete base.transferRecognizers[name];
    };
    try {
      // A biblioteca ordena os rótulos em ordem alfabética; chaves numéricas mantêm a ordem das classes.
      const labels = classes.map(c => c.name);
      classes.forEach((cls, index) => {
        for (const { data, frameSize } of cls.samples) {
          net.dataset.addExample({ label: String(index).padStart(3, '0'), spectrogram: { data, frameSize } });
        }
      });
      net.collateTransferWords();
      const last = {};
      const optimizer = tf.train.adam(params.learningRate);
      progress(0, 'Treinando…');
      try {
        await net.train({
          epochs: params.epochs,
          batchSize: params.batchSize,
          validationSplit: 0.15,
          optimizer,
          callback: epochCallbacks(params.epochs, progress, last),
        });
      } finally {
        optimizer.dispose();
      }

      const listen = listener(net, () => labels);
      let stop = null;
      return {
        accuracy: last.val_acc ?? last.acc,
        setLabel: (index, value) => { labels[index] = value; },
        listen: async onPredictions => (stop = await listen(onPredictions)),
        export: () => exportFiles(handler => net.save(handler), { ...net.getMetadata(), wordLabels: [...labels] }),
        dispose: () => Promise.resolve(stop?.()).then(release),
      };
    } catch (error) {
      release();
      throw error;
    }
  },

  async open(base) {
    await loadScript(LIB);
    const net = speechCommands.create('BROWSER_FFT', undefined, `${base}model.json`, `${base}metadata.json`);
    await net.ensureModelLoaded();
    return { labels: net.wordLabels(), listen: listener(net, () => net.wordLabels()) };
  },

  snippet: url => `<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js"></script>
<script src="${LIB}"></script>
<script>
  const URL_MODELO = "${url}";
  async function ouvir(aoReconhecer) {
    const modelo = speechCommands.create("BROWSER_FFT", undefined,
      URL_MODELO + "model.json", URL_MODELO + "metadata.json");
    await modelo.ensureModelLoaded();
    modelo.listen(async ({ scores }) => aoReconhecer(modelo.wordLabels(), scores),
      { probabilityThreshold: 0.75, overlapFactor: 0.5 });
  }
</script>`,
};
