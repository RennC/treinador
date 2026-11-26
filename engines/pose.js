import { loadScript, loadImage, exportFiles, forEachSample, epochCallbacks } from './common.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.6/dist/teachablemachine-pose.min.js';
const MIN_SCORE = 0.2; // abaixo disso consideramos que não há pessoa na imagem
const load = () => loadScript(LIB);

async function classify(net, canvas) {
  const { pose, posenetOutput } = await net.estimatePose(canvas);
  return {
    pose: pose && pose.score >= MIN_SCORE ? pose : null,
    predictions: await net.predict(posenetOutput),
  };
}

export default {
  id: 'pose',
  title: 'Pose',
  description: 'Reconhece posições do corpo pela câmera ou por fotos.',
  media: 'camera',
  sampleSize: 257,
  params: { epochs: 50, batchSize: 16, learningRate: 0.0001 },
  minimum: () => 5,
  requirement: 'Colete pelo menos 5 amostras em cada classe, com o corpo visível.',
  defaultClasses: () => ['Class 1', 'Class 2'],

  drawPose(context, pose) {
    tmPose.drawKeypoints(pose.keypoints, 0.5, context);
    tmPose.drawSkeleton(pose.keypoints, 0.5, context);
  },

  async train(classes, params, progress) {
    progress(null, 'Carregando o modelo de pose…');
    await load();
    const net = await tmPose.createTeachable({ tfjsVersion: tf.version.tfjs, modelName: 'my-pose-model' });
    try {
      net.setLabels(classes.map(c => c.name));
      let withoutPose = 0;
      await forEachSample(classes, progress, async (index, sample) => {
        const { pose, posenetOutput } = await net.estimatePose(await loadImage(sample));
        if (!pose || pose.score < MIN_SCORE) withoutPose++;
        await net.addExample(index, posenetOutput);
      });
      const last = {};
      await net.train({ ...params, denseUnits: 100 }, epochCallbacks(params.epochs, progress, last));
      return {
        accuracy: last.val_acc ?? last.acc,
        warning: withoutPose
          ? `Em ${withoutPose} amostra(s) nenhuma pessoa foi detectada com clareza. Considere substituí-las.`
          : '',
        setLabel: (index, name) => net.setLabel(index, name),
        predict: canvas => classify(net, canvas),
        export: () => exportFiles(handler => net.save(handler), net.getMetadata()),
        dispose: () => net.dispose(),
      };
    } catch (error) {
      try { net.posenetModel.dispose(); } catch { /* nada a liberar */ }
      throw error;
    }
  },

  async open(base) {
    await load();
    const net = await tmPose.load(`${base}model.json`, `${base}metadata.json`);
    return { labels: net.getClassLabels(), predict: canvas => classify(net, canvas) };
  },

  snippet: url => `<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js"></script>
<script src="${LIB}"></script>
<script>
  const URL_MODELO = "${url}";
  async function classificar(imagem) {
    const modelo = await tmPose.load(
      URL_MODELO + "model.json", URL_MODELO + "metadata.json");
    const { posenetOutput } = await modelo.estimatePose(imagem);
    return modelo.predict(posenetOutput);
  }
</script>`,
};
