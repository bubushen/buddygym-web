import { withScreenOn } from './screen-awake.js';
// Un minuto registrato dal telefono in 4K pesa centinaia di MB: troppo per
// l'archivio del browser e per il limite di caricamento del coach. Il video
// viene ricodificato a 720p senza audio, riproducendolo una volta in tempo reale.
const MAX_LONG_SIDE = 1280;
const VIDEO_BITS_PER_SECOND = 2_500_000;
// MP4 prima: WebM non è riproducibile su tutte le versioni di iOS.
const MIME_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function recordingMimeType(recorder = globalThis.MediaRecorder) {
  if (!recorder?.isTypeSupported) return null;
  return MIME_TYPES.find((type) => recorder.isTypeSupported(type)) ?? null;
}

export function canCompressVideo() {
  return !!recordingMimeType() && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export function compressedSize(width, height, maxLongSide = MAX_LONG_SIDE) {
  const scale = Math.min(1, maxLongSide / Math.max(width, height));
  // I codificatori H.264 richiedono dimensioni pari.
  const even = (value) => Math.max(2, Math.round(value * scale / 2) * 2);
  return { width: even(width), height: even(height) };
}

// La riduzione riproduce il video in tempo reale: lo schermo deve restare acceso.
export function compressVideo(file, options) {
  return withScreenOn(() => compressVideoNow(file, options));
}

async function compressVideoNow(file, { report = () => {} } = {}) {
  const mimeType = recordingMimeType();
  if (!mimeType || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('Questo browser non può ridurre il video. Registra un filmato più breve o a risoluzione 1080p.');
  }
  const media = document.createElement('video');
  media.muted = true;
  media.playsInline = true;
  media.preload = 'auto';
  media.style.cssText = 'position:fixed;width:2px;height:2px;left:-9999px;opacity:0.01;pointer-events:none';
  const url = URL.createObjectURL(file);
  document.body.append(media);
  let recorder;
  try {
    await new Promise((resolve, reject) => {
      media.addEventListener('loadedmetadata', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error('Impossibile leggere il video da ridurre.')), { once: true });
      media.src = url;
      media.load();
    });
    const { width, height } = compressedSize(media.videoWidth, media.videoHeight);
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d');
    context.drawImage(media, 0, 0, width, height);
    const stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', (event) => reject(event.error ?? new Error('Riduzione del video non riuscita.')), { once: true });
    });
    let finished = false;
    // requestAnimationFrame e non requestVideoFrameCallback: quest'ultimo rallenta
    // per i video che non sono visibili sullo schermo, come questo.
    const draw = () => {
      if (finished) return;
      context.drawImage(media, 0, 0, width, height);
      report(`Riduco il video · ${Math.round(media.currentTime)} / ${Math.round(media.duration)} s`);
      requestAnimationFrame(draw);
    };
    await new Promise((resolve, reject) => {
      media.addEventListener('ended', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error('Riduzione del video interrotta.')), { once: true });
      recorder.start(1000);
      draw();
      media.play().catch(reject);
    });
    finished = true;
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const type = mimeType.split(';')[0];
    const name = file.name.replace(/\.[^.]+$/, '') + (type === 'video/mp4' ? '.mp4' : '.webm');
    return new File(chunks, name, { type, lastModified: Date.now() });
  } finally {
    if (recorder?.state === 'recording') recorder.stop();
    media.pause();
    media.removeAttribute('src');
    media.load();
    media.remove();
    URL.revokeObjectURL(url);
  }
}
