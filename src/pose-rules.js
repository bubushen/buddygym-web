// Regole di lettura del movimento per il disegno sopra il video.
// Funzioni pure: nessun accesso al DOM, così restano facili da provare.
import { frameAspect } from './curl-analysis.js';
import { JOINTS, jointAngle } from './generic-pose.js';
import { MIN_VISIBILITY } from './pose-stabilization.js';

export { jointAngle };

// Regole future definite dal coach: chiave = id o titolo dell'esercizio.
// Voce: { points, zone, concentric, errors }. Se presente, ha la precedenza.
// TODO: quando il design system definirà --warning, usare errors per lo spicchio fuori zona.
export const RULES = Object.freeze({});

const CURL_POINTS = { left: [11, 13, 15], right: [12, 14, 16] };
const CURL_ZONE = { min: 40, max: 165 };

function normalizedZone(min, max, fallback = CURL_ZONE) {
  const low = Number.isFinite(Number(min)) ? Number(min) : fallback.min;
  const high = Number.isFinite(Number(max)) ? Number(max) : fallback.max;
  return { min: Math.min(low, high), max: Math.max(low, high) };
}

// Curl: braccio dal lato del riferimento, zona corretta e discesa come concentrica.
function curlRule(profile) {
  const side = profile?.side === 'right' ? 'right' : 'left';
  const points = CURL_POINTS[side];
  let zone;
  if (profile?.zone) {
    zone = normalizedZone(profile.zone.min, profile.zone.max);
  } else if (Number.isFinite(Number(profile?.min)) && Number.isFinite(Number(profile?.max))) {
    zone = normalizedZone(profile.min, profile.max);
  } else {
    // Il picco del riferimento dice quanto si chiude il gomito: la zona parte poco sotto.
    const peaks = Array.isArray(profile?.peaks)
      ? profile.peaks.map((peak) => Number(peak?.angle)).filter(Number.isFinite)
      : [];
    const min = peaks.length ? Math.max(20, Math.min(...peaks) - 10) : CURL_ZONE.min;
    zone = { min, max: CURL_ZONE.max };
  }
  return { points, main: points[1], trail: points[2], zone, concentric: 'down', geometry: profile?.geometry ?? 1 };
}

// Generico: l'articolazione che si muove di più, con la sua zona.
function genericRule(profile) {
  const joints = Array.isArray(profile?.joints) ? profile.joints : [];
  const best = joints.reduce((top, joint) => {
    const range = Number(joint?.range);
    return Number.isFinite(range) && (!top || range > top.range) ? { joint, range } : top;
  }, null);
  const points = best && JOINTS.find((item) => item.name === best.joint.name)?.points;
  if (!points) return { ...curlRule(profile), points: [...CURL_POINTS.left], main: 13, trail: 15 };
  const zone = normalizedZone(best.joint.min, best.joint.max);
  const concentric = best.joint.concentric === 'up' || best.joint.concentric === 'down'
    ? best.joint.concentric
    : profile?.concentric === 'up' || profile?.concentric === 'down'
      ? profile.concentric
      : 'down';
  return { points, main: points[1], trail: points[2], zone, concentric, geometry: profile?.geometry ?? 1 };
}

export function exerciseRule(profile, kind) {
  const resolved = kind ?? (profile?.side ? 'curl' : profile?.joints?.length ? 'generic' : 'curl');
  const base = resolved === 'generic' ? genericRule(profile) : curlRule(profile);
  const custom = profile ? RULES[profile.exerciseId] ?? RULES[profile.exerciseTitle] : null;
  if (!custom) return base;
  const points = custom.points ?? base.points;
  return {
    ...base,
    ...custom,
    points,
    main: custom.main ?? points[1],
    trail: custom.trail ?? points[2],
    zone: custom.zone ? normalizedZone(custom.zone.min, custom.zone.max, base.zone) : base.zone,
    concentric: custom.concentric ?? base.concentric,
  };
}

function angleValue(angles, index) {
  const value = angles?.[index];
  return typeof value === 'number' ? value : value?.angle;
}

// Conta una ripetizione quando l'angolo esce dalla zona di partenza, arriva
// almeno al 70% del range verso l'altro estremo e torna nella zona di partenza.
// Restituisce gli indici dei fotogrammi in cui la ripetizione si chiude.
export function countReps(angles, zone, concentric = 'down') {
  const values = angles ?? [];
  const min = Number(zone?.min);
  const max = Number(zone?.max);
  const range = max - min;
  if (!(range > 0) || !values.length) return [];
  const down = concentric !== 'up';
  const start = down ? max : min;
  const target = down ? min + range * 0.3 : max - range * 0.3;
  const band = range * 0.2;
  const completions = [];
  let armed = false;
  let reached = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = angleValue(values, index);
    if (!Number.isFinite(value)) continue;
    const inStart = down ? value >= start - band : value <= start + band;
    const atTarget = down ? value <= target : value >= target;
    if (!armed) {
      if (!inStart) continue;
      armed = true;
      reached = false;
      continue;
    }
    if (atTarget) { reached = true; continue; }
    if (reached && inStart) {
      completions.push(index);
      reached = false;
    }
  }
  return completions;
}

// Fase fisica: 'up' mentre il peso sale (concentrica), 'down' mentre scende.
// `concentric` è il verso dell'angolo nella concentrica: per il curl è 'down'.
export function phaseAt(angles, index, concentric = 'down') {
  const current = angleValue(angles, index);
  if (!Number.isFinite(current)) return 'down';
  let previousIndex = index - 1;
  while (previousIndex >= 0 && !Number.isFinite(angleValue(angles, previousIndex))) previousIndex -= 1;
  if (previousIndex < 0) return 'up';
  const previous = angleValue(angles, previousIndex);
  if (!Number.isFinite(previous) || current === previous) return 'up';
  const direction = current < previous ? 'down' : 'up';
  return direction === concentric ? 'up' : 'down';
}

// Fotogramma del riferimento con l'angolo principale più vicino nella stessa fase.
// `cache` evita di ricalcolare angoli e fasi a ogni fotogramma dell'overlay.
export function matchReferencePose(referenceFrames, rule, angle, phase, cache = null) {
  if (!Array.isArray(referenceFrames) || !referenceFrames.length || !rule?.points || !Number.isFinite(angle)) return null;
  const geometry = rule.geometry ?? 1;
  const reusable = cache?.frames === referenceFrames && cache?.rule === rule;
  const angles = reusable
    ? cache.angles
    : referenceFrames.map((frame) => (frame?.landmarks
      ? jointAngle(frame.landmarks, rule.points, frameAspect(frame, geometry))
      : null));
  const phases = reusable ? cache.phases : angles.map((_, index) => phaseAt(angles, index, rule.concentric));
  let best = null;
  let bestDistance = Infinity;
  for (let index = 0; index < referenceFrames.length; index += 1) {
    if (!Number.isFinite(angles[index]) || phases[index] !== phase) continue;
    const distance = Math.abs(angles[index] - angle);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = referenceFrames[index];
    }
  }
  return best;
}

const anchorVisible = (point) => point && (point.visibility ?? 0) >= MIN_VISIBILITY;

// Trasla e scala la sagoma del riferimento sulla spalla dell'utente, usando
// la lunghezza del primo segmento (spalla-gomito) come unità.
export function alignToUser(referenceLandmarks, userLandmarks, rule, aspect = 1) {
  if (!Array.isArray(referenceLandmarks) || !Array.isArray(userLandmarks) || !rule?.points) return null;
  const [anchor, next] = rule.points;
  const referenceAnchor = referenceLandmarks[anchor];
  const referenceNext = referenceLandmarks[next];
  const userAnchor = userLandmarks[anchor];
  const userNext = userLandmarks[next];
  if (![referenceAnchor, referenceNext, userAnchor, userNext].every(anchorVisible)) return null;
  const length = (first, second) => Math.hypot((second.x - first.x) * aspect, second.y - first.y);
  const referenceLength = length(referenceAnchor, referenceNext);
  const userLength = length(userAnchor, userNext);
  if (!(referenceLength > 1e-6) || !(userLength > 0)) return null;
  const scale = userLength / referenceLength;
  return referenceLandmarks.map((point) => (point ? {
    ...point,
    x: userAnchor.x + (point.x - referenceAnchor.x) * scale,
    y: userAnchor.y + (point.y - referenceAnchor.y) * scale,
  } : point));
}
