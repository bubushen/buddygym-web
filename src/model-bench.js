// Schermata «Prova modelli» (solo nella versione di prova, npm run build:bench):
// misura sul telefono il tempo di MediaPipe Heavy e di RTMPose sullo stesso video.
import { decodeFrames } from './video-decoder.js';

const BENCH_URL = new URL('../vendor/bench/', import.meta.url).href;
const MEDIAPIPE_URL = new URL('../vendor/mediapipe/', import.meta.url).href;
const SECONDS = 10;
const FPS = 30;
const TARGET_SECONDS = 30;

export async function benchAvailable() {
  try { return (await fetch(`${BENCH_URL}manifest.json`)).ok; } catch { return false; }
}

function loadOrt() {
  if (globalThis.ort) return Promise.resolve(globalThis.ort);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BENCH_URL}ort.min.js`;
    script.onload = () => {
      globalThis.ort.env.wasm.wasmPaths = BENCH_URL;
      globalThis.ort.env.wasm.numThreads = 1;
      resolve(globalThis.ort);
    };
    script.onerror = () => reject(new Error('ONNX Runtime non disponibile.'));
    document.head.append(script);
  });
}

// --- RTMPose: RTMDet-nano trova la persona, RTMPose i 17 punti nel ritaglio 192×256.
function tensor(ort, context, width, height, mean, std, bgr) {
  const { data } = context.getImageData(0, 0, width, height);
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    const channels = bgr ? [data[i * 4 + 2], data[i * 4 + 1], data[i * 4]] : [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    for (let c = 0; c < 3; c += 1) out[c * plane + i] = (channels[c] - mean[c]) / std[c];
  }
  return new ort.Tensor('float32', out, [1, 3, height, width]);
}

function createRtm(ort, detector, poser) {
  const det = Object.assign(document.createElement('canvas'), { width: 320, height: 320 }).getContext('2d', { willReadFrequently: true });
  const crop = Object.assign(document.createElement('canvas'), { width: 192, height: 256 }).getContext('2d', { willReadFrequently: true });
  return async (source) => {
    const scale = Math.min(320 / source.width, 320 / source.height);
    det.fillStyle = 'rgb(114,114,114)';
    det.fillRect(0, 0, 320, 320);
    det.drawImage(source, 0, 0, source.width * scale, source.height * scale);
    const { dets } = await detector.run({ input: tensor(ort, det, 320, 320, [103.53, 116.28, 123.675], [57.375, 57.12, 58.395], true) });
    const [x1, y1, x2, y2, score] = dets.data.slice(0, 5);
    if (!(score > 0.3)) return false;
    let w = (x2 - x1) / scale * 1.25;
    let h = (y2 - y1) / scale * 1.25;
    if (w > h * 0.75) h = w / 0.75; else w = h * 0.75;
    crop.drawImage(source, (x1 + x2) / 2 / scale - w / 2, (y1 + y2) / 2 / scale - h / 2, w, h, 0, 0, 192, 256);
    await poser.run({ input: tensor(ort, crop, 192, 256, [123.675, 116.28, 103.53], [58.395, 57.12, 57.375], false) });
    return true;
  };
}

async function createMediaPipe(delegate) {
  const { FilesetResolver, PoseLandmarker } = await import(`${MEDIAPIPE_URL}vision_bundle.js`);
  const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_URL}wasm`);
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${MEDIAPIPE_URL}pose_landmarker_heavy.task`, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  // Tempi sempre crescenti, anche per il fotogramma di riscaldamento.
  let clock = 0;
  return {
    run: async (source) => !!landmarker.detectForVideo(source, (clock += 33)).landmarks?.[0],
    close: () => landmarker.close(),
  };
}

const CONFIGS = [
  { label: 'MediaPipe Heavy · GPU', mediapipe: 'GPU' },
  { label: 'MediaPipe Heavy · CPU', mediapipe: 'CPU' },
  { label: 'RTMPose-m · GPU (WebGPU)', model: 'rtmpose-m', provider: 'webgpu' },
  { label: 'RTMPose-l · GPU (WebGPU)', model: 'rtmpose-l', provider: 'webgpu' },
  { label: 'RTMPose-m · CPU', model: 'rtmpose-m', provider: 'wasm' },
];

async function measure(config, frames, report) {
  let run;
  let close = () => {};
  if (config.mediapipe) {
    const mp = await createMediaPipe(config.mediapipe);
    run = (frame) => mp.run(frame.bitmap, frame.time);
    close = mp.close;
  } else {
    if (config.provider === 'webgpu' && !navigator.gpu) return { label: config.label, error: 'WebGPU non disponibile su questo telefono' };
    const ort = await loadOrt();
    const options = { executionProviders: [config.provider] };
    const detector = await ort.InferenceSession.create(`${BENCH_URL}rtmdet.onnx`, options);
    const poser = await ort.InferenceSession.create(`${BENCH_URL}${config.model}.onnx`, options);
    const rtm = createRtm(ort, detector, poser);
    run = (frame) => rtm(frame.bitmap);
    close = () => { detector.release?.(); poser.release?.(); };
  }
  // Un fotogramma di riscaldamento, escluso dalla misura.
  await run(frames[0]);
  let found = 0;
  const started = performance.now();
  for (const [index, frame] of frames.entries()) {
    if (await run(frame)) found += 1;
    if (index % 15 === 0) { report(`${config.label}: ${index + 1}/${frames.length}`); await new Promise((resolve) => setTimeout(resolve, 0)); }
  }
  const msPerFrame = (performance.now() - started) / frames.length;
  close();
  return { label: config.label, msPerFrame, found, total: frames.length, projected: msPerFrame * FPS * TARGET_SECONDS / 1000 };
}

export function renderBench(root, { onBack }) {
  root.innerHTML = `
    <button type="button" class="back-button" id="benchBack"><span aria-hidden="true">←</span> Account</button>
    <div class="page-heading page-heading-inner"><p class="eyebrow">VERSIONE DI PROVA</p><h1>Prova modelli</h1>
      <p>Misura su questo telefono quanto impiega ogni modello di riconoscimento del corpo. Analizza i primi ${SECONDS} s del video a ${FPS} fotogrammi al secondo e stima il tempo per un video di ${TARGET_SECONDS} s. Tieni lo schermo acceso fino alla fine.</p></div>
    <label class="secondary-button bench-pick">Scegli un video<input type="file" id="benchVideo" accept="video/*" hidden /></label>
    <button type="button" class="primary-button" id="benchStart">Avvia la prova con il video del curl incluso</button>
    <p class="account-message" id="benchStatus" role="status">Pronto.</p>
    <div id="benchResults"></div>
    <button type="button" class="secondary-button" id="benchCopy" hidden>Copia i risultati</button>`;
  const status = root.querySelector('#benchStatus');
  const results = root.querySelector('#benchResults');
  const startButton = root.querySelector('#benchStart');
  let file = null;
  let lastText = '';
  root.querySelector('#benchBack').onclick = onBack;
  root.querySelector('#benchVideo').onchange = (event) => {
    file = event.target.files?.[0] ?? null;
    startButton.textContent = file ? `Avvia la prova con ${file.name}` : 'Avvia la prova con il video del curl incluso';
  };
  root.querySelector('#benchCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(lastText); status.textContent = 'Risultati copiati: incollali nella chat.'; } catch { status.textContent = 'Copia non riuscita: seleziona il testo dei risultati e copialo a mano.'; }
  };
  startButton.onclick = async () => {
    startButton.disabled = true;
    results.replaceChildren();
    root.querySelector('#benchCopy').hidden = true;
    try {
      const wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
      const blob = file ?? await fetch(new URL('../reference/curl-corretto.mp4', import.meta.url)).then((response) => response.blob());
      status.textContent = 'Preparo i fotogrammi…';
      const pending = [];
      await decodeFrames(blob, { fps: FPS, onFrame(canvas, time) { if (time < SECONDS) pending.push(createImageBitmap(canvas).then((bitmap) => ({ bitmap, time }))); } });
      const frames = await Promise.all(pending);
      const rows = [];
      for (const config of CONFIGS) {
        status.textContent = `${config.label}: avvio…`;
        let row;
        try { row = await measure(config, frames, (text) => { status.textContent = text; }); } catch (error) { row = { label: config.label, error: error.message }; }
        rows.push(row);
        const line = document.createElement('p');
        line.className = 'bench-row';
        line.textContent = row.error
          ? `${row.label}: ${row.error}`
          : `${row.label}: ${Math.round(row.msPerFrame)} ms per fotogramma · persona trovata ${row.found}/${row.total} · video di ${TARGET_SECONDS} s ≈ ${Math.round(row.projected)} s`;
        results.append(line);
      }
      frames.forEach((frame) => frame.bitmap.close());
      lastText = [`Prova modelli · ${navigator.userAgent}`, `Video: ${file?.name ?? 'curl incluso'} · primi ${frames.length} fotogrammi a ${FPS} fps`, ...[...results.children].map((node) => node.textContent)].join('\n');
      root.querySelector('#benchCopy').hidden = false;
      status.textContent = 'Prova completata.';
      wakeLock?.release?.();
    } catch (error) {
      status.textContent = `Prova interrotta: ${error.message}`;
    } finally {
      startButton.disabled = false;
    }
  };
}
