/* Разбор трека нейросетями MusiCNN: одна ставит жанровые метки (обучена на метках last.fm),
   четыре маленьких оценивают настроение. Работает в отдельном потоке, чтобы плеер не подвисал.
   На вход — кусок трека: моно, 16 кГц. */
self.window = self;                                           // библиотека разбора звука ищет window даже в отдельном потоке
importScripts('tf.min.js', 'essentia-wasm.module.js', 'essentia.js-model.umd.js');

const extractor = new EssentiaModel.EssentiaTFInputExtractor(Module, 'musicnn');
const tagger = new EssentiaModel.TensorflowMusiCNN(tf, 'msd-musicnn-1/model.json');
/* у каждой модели настроения два выхода; второе число — номер выхода «да» */
const MOODS = [['happy', 0], ['sad', 1], ['relaxed', 1], ['aggressive', 0]]
  .map(([name, yes]) => ({ name, yes, model: new EssentiaModel.TensorflowMusiCNN(tf, `mood_${name}/model.json`) }));
const ready = Promise.all([tagger.initialize(), ...MOODS.map(m => m.model.initialize())]);

self.onmessage = async e => {
  const { id, signal } = e.data;
  try {
    await ready;
    let sum = 0;
    for (let i = 0; i < signal.length; i++) sum += signal[i] * signal[i];
    const features = extractor.computeFrameWise(signal, 256);
    const patches = await tagger.predict(features, true);     // по строке из 50 оценок на каждые ~3 секунды
    const tags = new Array(50).fill(0);
    for (const p of patches) for (let i = 0; i < 50; i++) tags[i] += p[i] / patches.length;
    const moods = {};
    for (const m of MOODS) {
      const rows = await m.model.predict(features, true);
      moods[m.name] = rows.reduce((s, r) => s + r[m.yes], 0) / rows.length;
    }
    self.postMessage({ id, tags, moods, rms: Math.sqrt(sum / signal.length), backend: tf.getBackend() });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
