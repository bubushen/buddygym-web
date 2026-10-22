// Analisi delle ripetizioni di un video: funzioni pure, nessun accesso al DOM.
// Le soglie riprendono quelle di src/curl-analysis.js, ma vengono applicate a ogni ripetizione.
import { frameAspect } from './curl-analysis.js';
import { jointAngle } from './pose-rules.js';
import { MIN_VISIBILITY } from './pose-stabilization.js';

const HIP_BY_SHOULDER = { 11: 23, 12: 24 };
const ARM_COVERAGE = 0.65;
const RANGE_TOLERANCE = 1;
const RANGE_MARGIN = 15;

export const ISSUES = Object.freeze({
  range: Object.freeze({
    title: 'Ampiezza incompleta',
    detail: 'chiudi di più in alto',
    goodTitle: 'Ampiezza completa',
    goodDetail: 'braccio disteso in basso e chiuso in alto',
    genericDetail: "usa tutta l'ampiezza",
    genericGoodDetail: 'movimento completo in tutte le {n} ripetizioni',
    hint: 'Chiudi di più in alto, con il braccio disteso in basso.',
  }),
  elbow: Object.freeze({
    title: 'Gomito che si sposta',
    detail: 'tienilo fermo sul fianco',
    goodTitle: 'Gomito fermo sul fianco',
    goodDetail: 'in tutte le {n} ripetizioni',
    hint: 'Tienilo fermo sul fianco, sotto la spalla.',
  }),
  swing: Object.freeze({
    title: 'Slancio del busto',
    detail: 'busto fermo, sali con il braccio',
    goodTitle: 'Busto fermo',
    goodDetail: 'nessuno slancio',
    hint: 'Tieni il busto fermo e sali solo con il braccio.',
  }),
  fastDown: Object.freeze({
    title: 'Discesa troppo veloce',
    detail: 'scendi in 2 secondi',
    goodTitle: 'Discesa controllata',
    goodDetail: 'ritorno lento e regolare',
    hint: 'Scendi piano, in circa 2 secondi.',
  }),
});

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// Stessa definizione usata nei profili del curl: serve almeno una manciata di punti.
function spread(values) {
  return values.length >= 8 ? percentile(values, 0.9) - percentile(values, 0.1) : null;
}

function visible(point) {
  return !!point && (point.visibility ?? 0) >= MIN_VISIBILITY;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Segmenta una serie di angoli con la stessa isteresi di countReps:
// partenza nella fascia iniziale, almeno il 70% del range, ritorno nella fascia.
function segmentsFromSamples(samples, zone, concentric = 'down') {
  const min = Number(zone?.min);
  const max = Number(zone?.max);
  const range = max - min;
  if (!(range > 0) || !Array.isArray(samples) || !samples.length) return [];
  const down = concentric !== 'up';
  const start = down ? max : min;
  const target = down ? min + range * 0.3 : max - range * 0.3;
  const band = range * 0.2;
  const reps = [];
  let armed = false;
  let active = null;
  for (const sample of samples) {
    const value = sample?.angle;
    const time = sample?.time;
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    const inStart = down ? value >= start - band : value <= start + band;
    const atTarget = down ? value <= target : value >= target;
    if (!armed) {
      if (!inStart) continue;
      armed = true;
      continue;
    }
    if (!active) {
      if (!inStart) active = { start: time, peakTime: time, peakAngle: value, reached: false };
      continue;
    }
    // Il picco è l'estremo verso cui si muove la concentrica; a parità vale l'ultimo.
    if (down ? value <= active.peakAngle : value >= active.peakAngle) {
      active.peakAngle = value;
      active.peakTime = time;
    }
    if (atTarget) {
      active.reached = true;
      continue;
    }
    if (inStart) {
      if (active.reached) {
        reps.push({
          index: reps.length + 1,
          start: active.start,
          end: time,
          peakTime: active.peakTime,
          peakAngle: active.peakAngle,
        });
      }
      // Anche un tentativo incompleto si chiude: il prossimo movimento riparte.
      active = null;
    }
  }
  return reps;
}

function angleSamples(frames, rule) {
  if (!Array.isArray(frames) || !Array.isArray(rule?.points) || rule.points.length !== 3) return [];
  const geometry = rule.geometry ?? 1;
  return frames.map((frame) => ({
    time: frame?.time,
    angle: jointAngle(frame?.landmarks, rule.points, frameAspect(frame ?? {}, geometry)),
  }));
}

export function segmentReps(frames, rule) {
  return segmentsFromSamples(angleSamples(frames, rule), rule?.zone, rule?.concentric);
}

// Una riga per fotogramma, con le stesse misure del profilo curl (visibilità 0,58).
function frameRow(frame, rule) {
  const points = rule?.points;
  if (!Array.isArray(points) || points.length !== 3) return null;
  const landmarks = frame?.landmarks;
  const shoulder = landmarks?.[points[0]];
  const elbow = landmarks?.[points[1]];
  const wrist = landmarks?.[points[2]];
  if (![shoulder, elbow, wrist].every(visible)) return null;
  const aspect = frameAspect(frame, rule.geometry ?? 1);
  const elbowAngle = jointAngle(landmarks, points, aspect);
  if (!Number.isFinite(elbowAngle)) return null;
  const upperArmTilt = Math.atan2((elbow.x - shoulder.x) * aspect, elbow.y - shoulder.y) * 180 / Math.PI;
  const hip = landmarks?.[HIP_BY_SHOULDER[points[0]]];
  const torsoTilt = hip && visible(hip)
    ? Math.atan2((shoulder.x - hip.x) * aspect, hip.y - shoulder.y) * 180 / Math.PI
    : null;
  return { time: frame.time, elbowAngle, upperArmTilt, torsoTilt };
}

// Mediana su tre fotogrammi, come smoothRows in curl-analysis.js.
function smoothRows(rows) {
  return rows.map((row, index) => {
    if (!row) return null;
    const neighbors = rows.slice(Math.max(0, index - 1), index + 2).filter(Boolean);
    const torsoNeighbors = neighbors.map((item) => item.torsoTilt).filter((value) => value !== null);
    return {
      ...row,
      upperArmTilt: percentile(neighbors.map((item) => item.upperArmTilt), 0.5),
      torsoTilt: torsoNeighbors.length ? percentile(torsoNeighbors, 0.5) : null,
    };
  });
}

function repMeasurements(repFrames, rule) {
  const rows = smoothRows(repFrames.map((frame) => frameRow(frame, rule)));
  const validRows = rows.filter(Boolean);
  const armCoverage = repFrames.length ? validRows.length / repFrames.length : 0;
  const tilts = validRows.map((row) => row.upperArmTilt);
  const torsoValues = validRows.map((row) => row.torsoTilt).filter((value) => value !== null);
  const torsoCoverage = validRows.length ? torsoValues.length / validRows.length : 0;
  const elbowSpread = spread(tilts);
  const torsoSpread = spread(torsoValues);
  return {
    elbowEvaluable: armCoverage >= ARM_COVERAGE && elbowSpread !== null,
    elbowSpread,
    elbowOffset: tilts.length ? percentile(tilts.map((value) => Math.abs(value)), 0.5) : null,
    swingEvaluable: armCoverage >= ARM_COVERAGE && torsoCoverage >= ARM_COVERAGE && torsoSpread !== null,
    torsoSpread,
  };
}

// Discesa media del riferimento: solo il profilo curl conserva le righe nel tempo.
function referenceDescent(reference, rule, kind) {
  if (kind !== 'curl' || !Array.isArray(reference?.rows)) return null;
  const samples = reference.rows
    .filter(Boolean)
    .map((row) => ({ time: row.time, angle: row.elbowAngle }));
  const reps = segmentsFromSamples(samples, rule?.zone, rule?.concentric);
  const descents = reps
    .map((rep) => rep.end - rep.peakTime)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!descents.length) return null;
  return descents.reduce((total, value) => total + value, 0) / descents.length;
}

function issueDetail(id, kind) {
  if (id === 'range' && kind === 'generic') return ISSUES.range.genericDetail;
  return ISSUES[id].detail;
}

function goodDetail(id, kind, total) {
  if (id === 'range' && kind === 'generic') return ISSUES.range.genericGoodDetail.replace('{n}', String(total));
  return ISSUES[id].goodDetail.replace('{n}', String(total));
}

export function repWarning(issueId) {
  const issue = ISSUES[issueId];
  return issue ? { title: issue.title, hint: issue.hint } : null;
}

export function repList(numbers) {
  const values = [...new Set((Array.isArray(numbers) ? numbers : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value)))]
    .sort((a, b) => a - b);
  if (!values.length) return '';
  if (values.length === 1) return `Rip. ${values[0]}`;
  return `Rip. ${values.slice(0, -1).join(', ')} e ${values[values.length - 1]}`;
}

export function analyzeReps({ frames, rule, reference, kind = 'curl' } = {}) {
  const resolvedKind = kind === 'generic' ? 'generic' : 'curl';
  const sourceFrames = Array.isArray(frames) ? frames : [];
  const segments = segmentsFromSamples(angleSamples(sourceFrames, rule), rule?.zone, rule?.concentric);
  const down = rule?.concentric !== 'up';

  const referencePeaks = resolvedKind === 'curl' && Array.isArray(reference?.peaks)
    ? reference.peaks.map((peak) => Number(peak?.angle)).filter((value) => Number.isFinite(value))
    : [];
  const referenceFlexion = referencePeaks.length ? percentile(referencePeaks, 0.5) : finiteOr(rule?.zone?.min, 0);
  const referenceVariation = referencePeaks.length ? spread(referencePeaks) ?? 0 : 0;
  const flexionMargin = Math.max(RANGE_MARGIN, referenceVariation + 8);

  const referenceElbowSpread = finiteOr(reference?.elbowSpread, 0);
  const referenceElbowOffset = finiteOr(reference?.elbowOffset, 0);
  const referenceTorsoSpread = finiteOr(reference?.torsoSpread, 0);
  const elbowLimit = referenceElbowSpread + Math.max(8, referenceElbowSpread * 0.6);
  const elbowOffsetLimit = referenceElbowOffset + 12;
  const torsoLimit = referenceTorsoSpread + Math.max(7, referenceTorsoSpread * 0.6);

  const averageDescent = referenceDescent(reference, rule, resolvedKind);
  const fastDownLimit = averageDescent !== null && averageDescent > 0 ? averageDescent * 0.6 : 1.0;

  const internal = segments.map((segment) => {
    const repFrames = sourceFrames.filter((frame) => frame.time >= segment.start && frame.time <= segment.end);
    const measures = repMeasurements(repFrames, rule);
    const issues = [];

    const rangeLimit = resolvedKind === 'curl'
      ? referenceFlexion + flexionMargin
      : down ? finiteOr(rule?.zone?.min, 0) + RANGE_TOLERANCE : finiteOr(rule?.zone?.max, 0) - RANGE_TOLERANCE;
    const rangeIssue = resolvedKind === 'curl'
      ? segment.peakAngle > rangeLimit
      : down ? segment.peakAngle > rangeLimit : segment.peakAngle < rangeLimit;
    if (rangeIssue) issues.push('range');

    const elbowIssue = resolvedKind === 'curl' && measures.elbowEvaluable
      && (measures.elbowSpread > elbowLimit || measures.elbowOffset > elbowOffsetLimit);
    if (elbowIssue) issues.push('elbow');

    const swingIssue = resolvedKind === 'curl' && measures.swingEvaluable
      && measures.torsoSpread > torsoLimit;
    if (swingIssue) issues.push('swing');

    if (segment.end - segment.peakTime < fastDownLimit) issues.push('fastDown');
    return { ...segment, issues, elbowEvaluable: measures.elbowEvaluable, swingEvaluable: measures.swingEvaluable };
  });

  const reps = internal.map((rep) => ({
    index: rep.index,
    start: rep.start,
    end: rep.end,
    clean: rep.issues.length === 0,
    issues: rep.issues,
  }));
  const total = reps.length;
  const clean = reps.filter((rep) => rep.clean).length;
  const good = [];
  const improve = [];

  const addCheck = (id, evaluable) => {
    const affected = internal.filter((rep) => rep.issues.includes(id));
    if (affected.length) {
      const numbers = affected.map((rep) => rep.index);
      improve.push({
        id,
        title: ISSUES[id].title,
        detail: `${repList(numbers)} · ${issueDetail(id, resolvedKind)}`,
        reps: numbers,
        at: affected[0].start,
      });
    } else if (evaluable) {
      good.push({ id, title: ISSUES[id].goodTitle, detail: goodDetail(id, resolvedKind, total) });
    }
  };

  if (total > 0) {
    addCheck('range', true);
    if (resolvedKind === 'curl') {
      addCheck('elbow', internal.every((rep) => rep.elbowEvaluable));
      addCheck('swing', internal.every((rep) => rep.swingEvaluable));
    }
    addCheck('fastDown', true);
  }

  return { reps, clean, total, good, improve };
}

export function preflightProblem(frames, rule, durationSeconds) {
  const list = Array.isArray(frames) ? frames : [];
  const points = Array.isArray(rule?.points) ? rule.points : [];
  const visibleFrames = points.length === 3
    ? list.filter((frame) => points.every((index) => visible(frame?.landmarks?.[index]))).length
    : 0;
  const ratio = list.length ? visibleFrames / list.length : 0;
  if (ratio < 0.4) {
    return {
      id: 'noPerson',
      title: 'Non vediamo bene il braccio',
      advice: 'Inquadrati di lato, dalla testa ai fianchi, con il braccio che lavora verso la camera.',
    };
  }

  const duration = finiteOr(durationSeconds, finiteOr(list[list.length - 1]?.time, 0));
  if (duration > 60) {
    return {
      id: 'tooLong',
      title: 'Video troppo lungo',
      advice: 'Registra al massimo 60 secondi, da 1 a 12 ripetizioni.',
    };
  }

  const reps = segmentReps(list, rule);
  if (!reps.length) {
    return {
      id: 'noReps',
      title: 'Nessuna ripetizione riconosciuta',
      advice: "Fai il movimento completo e tieni il telefono fermo all'altezza del petto.",
    };
  }
  if (reps.length > 12) {
    return {
      id: 'tooMany',
      title: 'Troppe ripetizioni',
      advice: 'Registra da 1 a 12 ripetizioni.',
    };
  }
  return null;
}
