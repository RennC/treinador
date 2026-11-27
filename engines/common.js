// Funções compartilhadas pelos três tipos de projeto.
const loaded = new Map();

export function loadScript(url) {
  if (!loaded.has(url)) {
    loaded.set(url, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => {
        loaded.delete(url);
        script.remove();
        reject(new Error('Não consegui carregar. Verifique a internet e tente de novo.'));
      };
      document.head.append(script);
    }));
  }
  return loaded.get(url);
}

// onload em vez de decode(): decode() pode ficar parado quando a tela não está sendo desenhada.
export const loadImage = src => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Um exemplo salvo está com defeito. Apague e junte de novo.'));
  image.src = src;
});

const toBase64 = buffer => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(new Blob([buffer]));
});

// Converte um modelo treinado nos três arquivos que o link publica.
export async function exportFiles(save, metadata) {
  let files;
  await save(tf.io.withSaveHandler(async artifacts => {
    files = {
      model: {
        modelTopology: artifacts.modelTopology,
        format: 'layers-model',
        generatedBy: `TensorFlow.js tfjs-layers v${tf.version['tfjs-layers']}`,
        convertedBy: null,
        weightsManifest: [{ paths: ['./model.weights.bin'], weights: artifacts.weightSpecs }],
      },
      weights: await toBase64(artifacts.weightData),
    };
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
  }));
  files.metadata = { ...metadata, timeStamp: new Date().toISOString() };
  return files;
}

// Percorre as amostras informando o andamento, sem travar a tela.
export async function forEachSample(classes, progress, handle) {
  const total = classes.reduce((sum, c) => sum + c.samples.length, 0);
  let done = 0;
  for (const [index, cls] of classes.entries()) {
    for (const sample of cls.samples) {
      await handle(index, sample);
      if (++done % 5 === 0 || done === total) {
        progress(done / total, `Olhando os exemplos: ${done} de ${total}`);
        await new Promise(resolve => setTimeout(resolve));
      }
    }
  }
}

export const epochCallbacks = (epochs, progress, last) => ({
  onEpochEnd: async (epoch, logs) => {
    Object.assign(last, logs);
    progress((epoch + 1) / epochs, `Treinando… ${Math.round((epoch + 1) / epochs * 100)}%`);
    await tf.nextFrame();
  },
});
