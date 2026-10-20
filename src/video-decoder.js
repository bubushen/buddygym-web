// Decodifica un video MP4/MOV in sequenza con il decodificatore hardware
// (WebCodecs), invece di posizionare un elemento <video> su ogni istante: ogni
// salto obbliga il telefono a ridecodificare dal fotogramma chiave precedente.
// Per ogni istante richiesto (time = k / fps) si usa il fotogramma più vicino.
import { createFile, DataStream } from '../vendor/mp4box.js';

const READ_CHUNK = 4 * 1024 * 1024;

export function canDecodeSequentially() {
  return typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function';
}

// Rotazione salvata nel file (i telefoni registrano spesso in orizzontale e
// indicano di ruotare): il fotogramma va mostrato come lo mostra <video>.
export function rotationFromMatrix(matrix) {
  if (!matrix) return 0;
  const [a, b] = [matrix[0], matrix[1]];
  const degrees = Math.round(Math.atan2(b, a) * 180 / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

function codecDescription(track, file) {
  const entry = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 8);
}

// mp4box indica a ogni lettura da quale posizione proseguire: i video dei telefoni
// hanno l'indice (moov) alla fine, quindi prima si legge fino all'indice, poi si
// torna ai dati dei fotogrammi.
async function append(file, blob, offset) {
  const buffer = await blob.slice(offset, offset + READ_CHUNK).arrayBuffer();
  buffer.fileStart = offset;
  return file.appendBuffer(buffer);
}

async function readTrack(blob) {
  const file = createFile();
  let info = null;
  let failure = null;
  file.onReady = (value) => { info = value; };
  file.onError = (_module, message) => { failure = new Error(message || 'File video non leggibile.'); };
  let offset = 0;
  while (!info && !failure && offset < blob.size) offset = await append(file, blob, offset);
  if (failure) throw failure;
  if (!info) throw new Error('Struttura del video non riconosciuta.');
  return { file, info };
}

/**
 * Chiama `onFrame(source, time)` per ogni istante k/fps, in ordine. `source` è un
 * canvas già ruotato e ridotto (lato lungo ≤ maxSide); vale solo durante la chiamata.
 */
export async function decodeFrames(blob, { fps, maxSide = 960, onFrame }) {
  const { file, info } = await readTrack(blob);
  const track = info.videoTracks?.[0];
  if (!track) throw new Error('Nessuna traccia video.');
  const config = {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    description: codecDescription(track, file),
  };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`Codifica ${track.codec} non supportata.`);

  const rotation = rotationFromMatrix(track.matrix);
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? track.video.height : track.video.width;
  const height = sideways ? track.video.width : track.video.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(width * scale), height: Math.round(height * scale) });
  const context = canvas.getContext('2d');
  const frameDuration = 1 / (track.nb_samples / (track.duration / track.timescale) || 30);
  let next = 0;
  let firstTimestamp = null;
  let failure = null;

  const decoder = new VideoDecoder({
    output(frame) {
      try {
        if (failure) return;
        firstTimestamp ??= frame.timestamp;
        const time = (frame.timestamp - firstTimestamp) / 1e6;
        // Usa questo fotogramma per ogni istante richiesto a cui è il più vicino.
        while (next / fps <= time + frameDuration / 2) {
          const target = Math.round(next / fps * 1000) / 1000;
          if (Math.abs(target - time) <= frameDuration / 2 + 1e-6 || target < time) {
            context.save();
            context.translate(canvas.width / 2, canvas.height / 2);
            context.rotate(rotation * Math.PI / 180);
            const [drawWidth, drawHeight] = sideways ? [canvas.height, canvas.width] : [canvas.width, canvas.height];
            context.drawImage(frame, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
            context.restore();
            onFrame(canvas, target);
          }
          next += 1;
        }
      } catch (error) {
        failure = error;
      } finally {
        frame.close();
      }
    },
    error(error) { failure = error; },
  });
  decoder.configure(config);

  let samplesDone;
  const allSamples = new Promise((resolve) => { samplesDone = resolve; });
  let received = 0;
  file.onSamples = (_id, _user, samples) => {
    for (const sample of samples) {
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: Math.round(sample.cts * 1e6 / sample.timescale),
        duration: Math.round(sample.duration * 1e6 / sample.timescale),
        data: sample.data,
      }));
    }
    received += samples.length;
    file.releaseUsedSamples(track.id, received);
    if (received >= track.nb_samples) samplesDone();
  };
  file.setExtractionOptions(track.id, null, { nbSamples: 60 });
  file.start();
  // Si riparte dai dati dei fotogrammi e si legge a blocchi, lasciando al
  // decodificatore il tempo di lavorare.
  let offset = file.seek(0, true).offset;
  while (offset < blob.size && !failure) {
    while (decoder.decodeQueueSize > 120 && !failure) await new Promise((resolve) => setTimeout(resolve, 5));
    offset = await append(file, blob, offset);
  }
  file.flush();
  await Promise.race([allSamples, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!failure) await decoder.flush();
  decoder.close();
  if (failure) throw failure;
}
