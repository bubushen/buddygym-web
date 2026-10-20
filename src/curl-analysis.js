// Measurements are deliberately limited to what one side-view camera can see.
// Thresholds below are prototype margins around one reference, not clinical norms.
import { MIN_VISIBILITY } from './pose-stabilization.js';

// Geometry 1 measured angles on landmarks normalized separately to width and height,
// which stretches a 9:16 frame. Geometry 2 restores the real proportions first.
// Profiles keep their geometry so an attempt is always measured like its reference.
export const GEOMETRY_VERSION = 2;

export function frameAspect(frame, geometry) {
  return geometry >= 2 && Number.isFinite(frame.aspect) && frame.aspect > 0 ? frame.aspect : 1;
}

const SIDES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
};

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function angle(a, center, b) {
  const v1 = [a.x - center.x, a.y - center.y];
  const v2 = [b.x - center.x, b.y - center.y];
  const length = Math.hypot(...v1) * Math.hypot(...v2);
  if (length < 0.0001) return null;
  const cosine = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / length));
  return Math.acos(cosine) * 180 / Math.PI;
}

function visible(point) { return point && (point.visibility ?? 0) >= MIN_VISIBILITY; }

function frameFeatures(frame, side, geometry) {
  const indexes = SIDES[side];
  const landmarks = frame.landmarks;
  const aspect = frameAspect(frame, geometry);
  const scaled = (point) => point && { ...point, x: point.x * aspect };
  const shoulder = scaled(landmarks?.[indexes.shoulder]);
  const elbow = scaled(landmarks?.[indexes.elbow]);
  const wrist = scaled(landmarks?.[indexes.wrist]);
  const hip = scaled(landmarks?.[indexes.hip]);
  if (![shoulder, elbow, wrist].every(visible)) return null;
  const elbowAngle = angle(shoulder, elbow, wrist);
  if (elbowAngle === null) return null;
  const upperArmTilt = Math.atan2(elbow.x - shoulder.x, elbow.y - shoulder.y) * 180 / Math.PI;
  const torsoTilt = visible(hip)
    ? Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * 180 / Math.PI
    : null;
  return { time: frame.time, elbowAngle, upperArmTilt, torsoTilt };
}

function smoothRows(rows) {
  return rows.map((row, index) => {
    if (!row) return null;
    const neighbors = rows.slice(Math.max(0, index - 1), index + 2).filter(Boolean);
    return {
      ...row,
      elbowAngle: percentile(neighbors.map((item) => item.elbowAngle), 0.5),
      upperArmTilt: percentile(neighbors.map((item) => item.upperArmTilt), 0.5),
      torsoTilt: percentile(neighbors.map((item) => item.torsoTilt).filter((value) => value !== null), 0.5),
    };
  });
}

function movementCycles(rows) {
  const values = rows.filter(Boolean).map((row) => row.elbowAngle);
  if (values.length < 12) return { cycles: [], ignoredBoundary: false };
  const extendedAngle = percentile(values, 0.85);
  const cycles = [];
  let active = null;
  let lastTime = null;
  let extendedRows = [];
  let ready = false;
  for (const row of rows) {
    if (!row || (lastTime !== null && row.time - lastTime > 0.7)) {
      active = null;
      ready = false;
      extendedRows = [];
    }
    if (!row) continue;
    lastTime = row.time;
    if (!active && row.elbowAngle >= extendedAngle - 15) {
      extendedRows.push(row);
      if (extendedRows.length > 4) extendedRows.shift();
      if (extendedRows.length >= 3) {
        const angles = extendedRows.map((item) => item.elbowAngle);
        if (Math.max(...angles) - Math.min(...angles) < 15) ready = true;
      }
    }
    if (!active && ready && row.elbowAngle < extendedAngle - 30) {
      active = { start: row.time, angle: row.elbowAngle, time: row.time };
      ready = false;
      extendedRows = [];
    } else if (active) {
      if (row.elbowAngle < active.angle) {
        active.angle = row.elbowAngle;
        active.time = row.time;
      }
      if (row.elbowAngle >= extendedAngle - 15) {
        if (extendedAngle - active.angle >= 45 && row.time - active.start >= 0.45) {
          cycles.push({ ...active, end: row.time });
        }
        active = null;
        ready = true;
        extendedRows = [row];
      }
    }
  }
  if (cycles.length < 3) return { cycles, ignoredBoundary: false };

  // A short, shallow motion at either recording edge is likely a phone interaction.
  // Apply this only when multiple consistent curls provide a comparison.
  const medianAngle = percentile(cycles.map((cycle) => cycle.angle), 0.5);
  const medianDuration = percentile(cycles.map((cycle) => cycle.end - cycle.start), 0.5);
  const firstTime = rows.find(Boolean).time;
  const lastTimeInVideo = rows.findLast(Boolean).time;
  const kept = cycles.filter((cycle, index) => {
    const atEdge = index === 0 && cycle.start - firstTime < 0.75
      || index === cycles.length - 1 && lastTimeInVideo - cycle.end < 0.75;
    const shallow = cycle.angle > medianAngle + 20;
    const unusuallyFast = cycle.end - cycle.start < medianDuration * 0.7;
    return !(atEdge && shallow && unusuallyFast);
  });
  return { cycles: kept, ignoredBoundary: kept.length < cycles.length };
}

function spread(values) {
  return values.length >= 8 ? percentile(values, 0.9) - percentile(values, 0.1) : null;
}

function profileForSide(frames, side, geometry) {
  const rows = smoothRows(frames.map((frame) => frameFeatures(frame, side, geometry)));
  const { cycles, ignoredBoundary } = movementCycles(rows);
  const activeRange = cycles.length
    ? { start: Math.max(0, cycles[0].start - 0.2), end: cycles[cycles.length - 1].end + 0.2 }
    : null;
  const validRows = rows.filter((row) => row && (!activeRange || row.time >= activeRange.start && row.time <= activeRange.end));
  const elbowValues = validRows.map((row) => row.elbowAngle);
  const torsoValues = validRows.map((row) => row.torsoTilt).filter((value) => value !== null);
  const movement = spread(rows.filter(Boolean).map((row) => row.elbowAngle)) ?? 0;
  const framesInRange = activeRange
    ? frames.filter((frame) => frame.time >= activeRange.start && frame.time <= activeRange.end).length
    : frames.length;
  const visibility = framesInRange ? validRows.length / framesInRange : 0;
  return {
    geometry,
    side,
    rows,
    activeRange,
    ignoredBoundary,
    visibility,
    torsoVisibility: validRows.length ? torsoValues.length / validRows.length : 0,
    score: visibility * Math.min(movement, 120),
    elbowSpread: spread(validRows.map((row) => row.upperArmTilt)),
    elbowOffset: percentile(validRows.map((row) => Math.abs(row.upperArmTilt)), 0.5),
    torsoSpread: spread(torsoValues),
    peaks: cycles.map(({ angle, time }) => ({ angle, time })),
  };
}

export function analyzeCurlVideo(frames, { geometry = GEOMETRY_VERSION } = {}) {
  const left = profileForSide(frames, 'left', geometry);
  const right = profileForSide(frames, 'right', geometry);
  return left.score >= right.score ? left : right;
}

function result(state, message, at = null) { return { state, message, at }; }

export function compareCurlVideos(reference, attempt) {
  if (reference.visibility < 0.65 || reference.peaks.length < 1) {
    return { ready: false, message: 'Nel riferimento non si vede abbastanza bene un curl completo. Servono braccio visibile, partenza distesa e ritorno alla posizione iniziale.' };
  }
  if (attempt.visibility < 0.65 || attempt.peaks.length < 1) {
    return { ready: false, message: 'Nel video da valutare non si vede abbastanza bene un curl completo. Controlla inquadratura e visibilità del polso.' };
  }

  const referenceFlexion = percentile(reference.peaks.map((peak) => peak.angle), 0.5);
  const referenceVariation = spread(reference.peaks.map((peak) => peak.angle)) ?? 0;
  const flexionMargin = Math.max(15, referenceVariation + 8);
  const incomplete = attempt.peaks.filter((peak) => peak.angle > referenceFlexion + flexionMargin);
  const referenceElbowMotion = reference.elbowSpread;
  const attemptElbowMotion = attempt.elbowSpread;
  const elbowLimit = referenceElbowMotion === null ? null : referenceElbowMotion + Math.max(8, referenceElbowMotion * 0.6);
  const elbowOffsetLimit = reference.elbowOffset === null ? null : reference.elbowOffset + 12;
  const elbowDrifts = elbowLimit !== null && attemptElbowMotion !== null && attemptElbowMotion > elbowLimit;
  const elbowMisaligned = elbowOffsetLimit !== null && attempt.elbowOffset !== null && attempt.elbowOffset > elbowOffsetLimit;
  const referenceTorsoMotion = reference.torsoSpread;
  const attemptTorsoMotion = attempt.torsoSpread;
  const torsoLimit = referenceTorsoMotion === null ? null : referenceTorsoMotion + Math.max(7, referenceTorsoMotion * 0.6);

  return {
    ready: true,
    referenceFlexion,
    checks: [
      {
        name: 'Ampiezza del curl',
        ...result(incomplete.length ? 'issue' : 'ok', incomplete.length
          ? 'In almeno una salita il gomito resta più aperto rispetto al video di riferimento: il movimento potrebbe essere incompleto.'
          : 'La flessione del gomito è simile al riferimento nelle salite rilevate.', incomplete[0]?.time ?? null),
      },
      {
        name: 'Posizione del gomito',
        ...result(elbowLimit === null || attemptElbowMotion === null || elbowOffsetLimit === null || attempt.elbowOffset === null ? 'unavailable'
          : elbowDrifts || elbowMisaligned ? 'issue' : 'ok',
        elbowLimit === null || attemptElbowMotion === null || elbowOffsetLimit === null || attempt.elbowOffset === null
          ? 'Non ci sono abbastanza punti visibili per valutare la posizione del gomito.'
          : elbowDrifts
            ? 'Il braccio superiore cambia inclinazione più del riferimento: il gomito sembra spostarsi durante il curl.'
            : elbowMisaligned
              ? 'Il gomito rimane più distante dalla verticale della spalla rispetto al riferimento.'
              : 'Il gomito rimane allineato alla spalla e stabile come nel riferimento.'),
      },
      {
        name: 'Oscillazione del busto',
        ...result(reference.torsoVisibility < 0.65 || attempt.torsoVisibility < 0.65 || torsoLimit === null || attemptTorsoMotion === null
          ? 'unavailable' : attemptTorsoMotion > torsoLimit ? 'issue' : 'ok',
        reference.torsoVisibility < 0.65 || attempt.torsoVisibility < 0.65 || torsoLimit === null || attemptTorsoMotion === null
          ? 'Per valutare il busto devono vedersi spalla e anca in entrambi i video.'
          : attemptTorsoMotion > torsoLimit
            ? 'L’inclinazione del busto varia più che nel riferimento: potrebbe esserci uno slancio.'
            : 'L’oscillazione del busto resta vicina al riferimento.'),
      },
    ],
  };
}

export const ARM_LANDMARKS = SIDES;
