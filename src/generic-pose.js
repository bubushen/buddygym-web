import { frameAspect, GEOMETRY_VERSION } from './curl-analysis.js';

export const JOINTS = [
  { name: 'gomito sinistro', points: [11, 13, 15] },
  { name: 'gomito destro', points: [12, 14, 16] },
  { name: 'spalla sinistra', points: [13, 11, 23] },
  { name: 'spalla destra', points: [14, 12, 24] },
  { name: 'anca sinistra', points: [11, 23, 25] },
  { name: 'anca destra', points: [12, 24, 26] },
  { name: 'ginocchio sinistro', points: [23, 25, 27] },
  { name: 'ginocchio destro', points: [24, 26, 28] },
];

function angle(a, b, c, aspect = 1) {
  if (![a, b, c].every((point) => point && (point.visibility ?? 0) >= 0.5)) return null;
  const first = [(a.x - b.x) * aspect, a.y - b.y];
  const second = [(c.x - b.x) * aspect, c.y - b.y];
  const length = Math.hypot(...first) * Math.hypot(...second);
  if (length < 1e-6) return null;
  return Math.acos(Math.max(-1, Math.min(1, (first[0] * second[0] + first[1] * second[1]) / length))) * 180 / Math.PI;
}

function percentile(sorted, portion) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * portion))];
}

function summarizeJoint(frames, joint, geometry) {
  const values = frames.map((frame) => {
    const points = joint.points.map((index) => frame.landmarks?.[index]);
    return angle(...points, frameAspect(frame, geometry));
  }).filter((value) => value !== null).sort((a, b) => a - b);
  if (values.length < Math.max(8, frames.length * 0.35)) return null;
  const min = percentile(values, 0.1);
  const max = percentile(values, 0.9);
  return { name: joint.name, min, max, range: max - min, coverage: values.length / frames.length };
}

export function profileMovement(frames) {
  const joints = JOINTS.map((joint) => summarizeJoint(frames, joint, GEOMETRY_VERSION))
    .filter((item) => item && item.range >= 12)
    .sort((a, b) => b.range * b.coverage - a.range * a.coverage)
    .slice(0, 3);
  if (!joints.length) return { ready: false, message: 'Nel video non si vede abbastanza movimento articolare per creare un riferimento.' };
  return { ready: true, kind: 'generic', geometry: GEOMETRY_VERSION, joints, frameCount: frames.length };
}

export function compareMovement(reference, frames) {
  if (!reference?.ready || !Array.isArray(reference.joints)) return { ready: false, message: 'Il riferimento personale non è utilizzabile.' };
  const checks = reference.joints.map((expected) => {
    const joint = JOINTS.find((item) => item.name === expected.name);
    const actual = joint && summarizeJoint(frames, joint, reference.geometry ?? 1);
    if (!actual) return { name: expected.name, state: 'unavailable', message: 'Articolazione poco visibile: confronto non disponibile.', at: null };
    const rangeGap = actual.range - expected.range;
    const centerGap = (actual.min + actual.max - expected.min - expected.max) / 2;
    const tolerance = Math.max(15, expected.range * 0.3);
    if (rangeGap < -tolerance) return { name: expected.name, state: 'issue', message: 'Il movimento appare meno ampio rispetto al tuo video di riferimento.', at: null };
    if (rangeGap > tolerance || Math.abs(centerGap) > 22) return { name: expected.name, state: 'issue', message: 'Il movimento appare diverso rispetto al tuo video di riferimento.', at: null };
    return { name: expected.name, state: 'ok', message: 'L’ampiezza è simile al tuo video di riferimento.', at: null };
  });
  return { ready: checks.some((check) => check.state !== 'unavailable'), checks, message: 'Confronto di ampiezza articolare, non giudizio sulla correttezza tecnica.' };
}
