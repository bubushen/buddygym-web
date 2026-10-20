// The clip is available in full before review, so a centered three-frame
// median can remove isolated landmark jumps without adding playback lag.
export const MIN_VISIBILITY = 0.58;
const MAX_NEIGHBOR_GAP = 0.22;
const MAX_INTERPOLATION_GAP = 0.25;

function usable(point) {
  return point && (point.visibility ?? 0) >= MIN_VISIBILITY;
}

function median3(a, b, c) {
  return a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
}

export function stabilizePoseFrames(frames) {
  return frames.map((frame, index) => {
    if (!frame.landmarks) return frame;
    const before = frames[index - 1];
    const after = frames[index + 1];
    if (!before?.landmarks || !after?.landmarks
      || frame.time - before.time > MAX_NEIGHBOR_GAP
      || after.time - frame.time > MAX_NEIGHBOR_GAP) return frame;

    return {
      ...frame,
      landmarks: frame.landmarks.map((point, landmarkIndex) => {
        const previous = before.landmarks[landmarkIndex];
        const next = after.landmarks[landmarkIndex];
        if (![previous, point, next].every(usable)) return point;
        return {
          ...point,
          x: median3(previous.x, point.x, next.x),
          y: median3(previous.y, point.y, next.y),
        };
      }),
    };
  });
}

export function poseAtTime(frames, time) {
  if (!frames.length) return null;
  if (time <= frames[0].time) return frames[0].landmarks;
  if (time >= frames[frames.length - 1].time) return frames[frames.length - 1].landmarks;

  let low = 0;
  let high = frames.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time <= time) low = middle;
    else high = middle;
  }
  const before = frames[low];
  const after = frames[high];
  if (!before.landmarks || !after.landmarks || after.time - before.time > MAX_INTERPOLATION_GAP) {
    return time - before.time <= after.time - time ? before.landmarks : after.landmarks;
  }
  const fraction = (time - before.time) / (after.time - before.time);
  return before.landmarks.map((point, index) => {
    const next = after.landmarks[index];
    if (!usable(point) || !usable(next)) return fraction < 0.5 ? point : next;
    return {
      ...point,
      x: point.x + (next.x - point.x) * fraction,
      y: point.y + (next.y - point.y) * fraction,
      visibility: Math.min(point.visibility, next.visibility),
    };
  });
}

// I video si analizzano a 30 fotogrammi al secondo (la frequenza dei telefoni):
// con fotogrammi più vicini MediaPipe non perde i movimenti veloci. Il confronto e i
// profili di riferimento usano un campione ogni 0,1 s, cioè un fotogramma ogni tre.
export const SAMPLE_FPS = 30;
export const ANALYSIS_STEP = SAMPLE_FPS / 10;
export function analysisGrid(frames) {
  return frames.filter((_, index) => index % ANALYSIS_STEP === 0);
}

// Segmenti dal busto verso le estremità: prima si corregge il punto più vicino
// al busto, poi quello successivo, che si sposta insieme a lui.
const LIMB_CHAINS = [[11, 13, 15], [12, 14, 16], [23, 25, 27], [24, 26, 28]];
const LENGTH_TOLERANCE = 0.15;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

// Una sola telecamera vede gli arti in 2D: il modello a volte allunga o accorcia
// un segmento da un fotogramma all'altro. Per le linee disegnate ogni segmento
// resta entro ±15% della sua lunghezza tipica nel video.
export function steadyLimbs(frames) {
  const aspect = frames.find((frame) => frame.aspect)?.aspect ?? 1;
  const length = (a, b) => Math.hypot((b.x - a.x) * aspect, b.y - a.y);
  const typical = new Map();
  for (const chain of LIMB_CHAINS) {
    for (let step = 0; step < chain.length - 1; step += 1) {
      const [from, to] = [chain[step], chain[step + 1]];
      typical.set(`${from}-${to}`, median(frames.flatMap((frame) => {
        const a = frame.landmarks?.[from];
        const b = frame.landmarks?.[to];
        return usable(a) && usable(b) ? [length(a, b)] : [];
      })));
    }
  }
  return frames.map((frame) => {
    if (!frame.landmarks) return frame;
    const landmarks = frame.landmarks.map((point) => ({ ...point }));
    for (const chain of LIMB_CHAINS) {
      for (let step = 0; step < chain.length - 1; step += 1) {
        const [from, to] = [chain[step], chain[step + 1]];
        const target = typical.get(`${from}-${to}`);
        const a = landmarks[from];
        const b = landmarks[to];
        if (!target || !usable(a) || !usable(b)) continue;
        const current = length(a, b);
        if (current < 1e-6) continue;
        const clamped = Math.min(target * (1 + LENGTH_TOLERANCE), Math.max(target * (1 - LENGTH_TOLERANCE), current));
        if (clamped === current) continue;
        const scale = clamped / current;
        const dx = (b.x - a.x) * scale - (b.x - a.x);
        const dy = (b.y - a.y) * scale - (b.y - a.y);
        // Il segmento successivo della catena si sposta insieme al punto corretto.
        for (const index of chain.slice(step + 1)) {
          landmarks[index].x += dx;
          landmarks[index].y += dy;
        }
      }
    }
    return { ...frame, landmarks };
  });
}

// Filtro "One Euro": leviga molto quando un punto è fermo e poco quando si muove,
// perché la frequenza di taglio cresce con la velocità. Il video è già completo:
// si filtra in avanti e all'indietro e si fa la media, così le linee non restano
// indietro rispetto al movimento.
const SMOOTHING = { minCutoff: 0.8, beta: 4, derivativeCutoff: 1 };

function alpha(cutoff, interval) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / interval);
}

function oneEuroPass(samples, order) {
  const output = new Array(samples.length).fill(null);
  let previous = null;
  for (const index of order) {
    const sample = samples[index];
    if (!sample) { previous = null; continue; }
    if (!previous || Math.abs(sample.time - previous.time) > 0.3) {
      output[index] = sample.value;
      previous = { time: sample.time, value: sample.value, derivative: 0 };
      continue;
    }
    const interval = Math.abs(sample.time - previous.time) || 1 / 30;
    const derivative = (sample.value - previous.value) / interval;
    const smoothedDerivative = previous.derivative + alpha(SMOOTHING.derivativeCutoff, interval) * (derivative - previous.derivative);
    // I punti poco visibili (coperti o incerti) vengono levigati di più.
    const cutoff = (SMOOTHING.minCutoff + SMOOTHING.beta * Math.abs(smoothedDerivative)) * Math.max(0.3, sample.visibility);
    const value = previous.value + alpha(cutoff, interval) * (sample.value - previous.value);
    output[index] = value;
    previous = { time: sample.time, value, derivative: smoothedDerivative };
  }
  return output;
}

function zeroLag(samples) {
  const forward = [...samples.keys()];
  const ahead = oneEuroPass(samples, forward);
  const behind = oneEuroPass(samples, forward.reverse());
  return ahead.map((value, index) => (value === null ? null : (value + behind[index]) / 2));
}

export function smoothForDisplay(frames) {
  const aspect = frames.find((frame) => frame.aspect)?.aspect ?? 1;
  const count = frames.find((frame) => frame.landmarks)?.landmarks.length ?? 0;
  const result = frames.map((frame) => (frame.landmarks ? { ...frame, landmarks: frame.landmarks.map((point) => ({ ...point })) } : frame));
  for (let index = 0; index < count; index += 1) {
    const series = (read) => frames.map((frame) => {
      const point = frame.landmarks?.[index];
      return point ? { time: frame.time, value: read(point), visibility: point.visibility ?? 0 } : null;
    });
    // Coordinate nelle proporzioni reali, perché la velocità sia la stessa in ogni direzione.
    const xs = zeroLag(series((point) => point.x * aspect));
    const ys = zeroLag(series((point) => point.y));
    // Anche la visibilità viene levigata: un punto incerto non lampeggia.
    const visibility = zeroLag(series((point) => point.visibility ?? 0).map((sample) => sample && { ...sample, visibility: 0.3 }));
    result.forEach((frame, frameIndex) => {
      const point = frame.landmarks?.[index];
      if (!point || xs[frameIndex] === null) return;
      point.x = xs[frameIndex] / aspect;
      point.y = ys[frameIndex];
      point.visibility = visibility[frameIndex];
    });
  }
  return result;
}

// Parte bassa del corpo ferma: negli esercizi da seduti o in piedi fermi (lat
// machine, curl, pulley) MediaPipe sposta un po' anche, ginocchia e caviglie quando
// il busto si muove. Se in tutto il video un punto resta entro il 30% del busto dalla
// sua posizione abituale, viene disegnato fermo in quella posizione. Negli esercizi
// in cui le gambe lavorano (squat, affondi) si spostano molto di più e restano libere.
const LOWER_BODY = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const STILL_LIMIT = 0.3;

function torsoLength(frames, aspect) {
  const lengths = frames.flatMap((frame) => {
    const l = frame.landmarks;
    if (!l || ![11, 12, 23, 24].every((index) => usable(l[index]))) return [];
    const shoulder = { x: (l[11].x + l[12].x) / 2 * aspect, y: (l[11].y + l[12].y) / 2 };
    const hip = { x: (l[23].x + l[24].x) / 2 * aspect, y: (l[23].y + l[24].y) / 2 };
    return [Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)];
  });
  return median(lengths);
}

export function lockStillJoints(frames) {
  const aspect = frames.find((frame) => frame.aspect)?.aspect ?? 1;
  const torso = torsoLength(frames, aspect);
  if (!torso) return frames;
  const result = frames.map((frame) => (frame.landmarks ? { ...frame, landmarks: frame.landmarks.map((point) => ({ ...point })) } : frame));
  for (const index of LOWER_BODY) {
    const points = frames.map((frame) => frame.landmarks?.[index]).filter(Boolean);
    if (points.length < 10) continue;
    const center = { x: median(points.map((point) => point.x)), y: median(points.map((point) => point.y)) };
    const distances = points.map((point) => Math.hypot((point.x - center.x) * aspect, point.y - center.y)).sort((a, b) => a - b);
    const spread = distances[Math.floor(distances.length * 0.9)] / torso;
    if (spread > STILL_LIMIT) continue;
    for (const frame of result) {
      const point = frame.landmarks?.[index];
      if (point) { point.x = center.x; point.y = center.y; }
    }
  }
  return result;
}
