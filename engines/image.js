import { loadScript, loadImage, exportFiles, forEachSample, epochCallbacks } from './common.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js';
const BASE_MODEL = { version: 2, alpha: 0.35 }; // mesma base do Teachable Machine
const load = () => loadScript(LIB);

function wrap(net, accuracy) {
  return {
    accuracy,
    setLabel: (index, name) => net.setLabel(index, name),
    predict: async canvas => ({ predictions: await net.predict(canvas) }),
    export: () => exportFiles(handler => net.save(handler), net.getMetadata()),
    dispose: () => net.model?.dispose(),
  };
}

export default {
  id: 'image',
  title: 'Imagem',
  description: 'O computador aprende a reconhecer objetos, desenhos ou gestos.',
  media: 'camera',
  sampleSize: 224,
  params: { epochs: 50, batchSize: 16, learningRate: 0.001 },
  minimum: () => 5,
  requirement: 'Tire pelo menos 5 fotos em cada classe.',
  defaultClasses: () => ['Classe 1', 'Classe 2'],

  async train(classes, params, progress) {
    progress(null, 'Carregando o modelo base…');
    await load();
    const net = await tmImage.createTeachable(
      { tfjsVersion: tf.version.tfjs, modelName: 'tm-my-image-model' }, { ...BASE_MODEL });
    try {
      net.setLabels(classes.map(c => c.name));
      await forEachSample(classes, progress, async (index, sample) => net.addExample(index, await loadImage(sample)));
      const last = {};
      await net.train({ ...params, denseUnits: 100 }, epochCallbacks(params.epochs, progress, last));
      return wrap(net, last.val_acc ?? last.acc);
    } catch (error) {
      try { net.model?.dispose(); } catch { /* nada a liberar */ }
      throw error;
    }
  },

  // Carrega um link publicado, do mesmo jeito que um aplicativo externo.
  async open(base) {
    await load();
    const net = await tmImage.load(`${base}model.json`, `${base}metadata.json`);
    return { labels: net.getClassLabels(), predict: async canvas => ({ predictions: await net.predict(canvas) }) };
  },

  snippet: url => `<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js"></script>
<script src="${LIB}"></script>
<script>
  const URL_MODELO = "${url}";
  async function classificar(imagem) {
    const modelo = await tmImage.load(
      URL_MODELO + "model.json", URL_MODELO + "metadata.json");
    return modelo.predict(imagem);
  }
</script>`,
};
