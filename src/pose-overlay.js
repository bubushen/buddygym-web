// Disegno del tracciamento "Ibrido 2+3": zona giusta, spicchio, sagoma del
// riferimento, traiettoria del punto chiave e solo le tre articolazioni utili.
import { frameAspect } from './curl-analysis.js';
import { JOINTS } from './generic-pose.js';
import {
  alignToUser, countReps, jointAngle, matchReferencePose, phaseAt,
} from './pose-rules.js';
import { lockStillJoints, MIN_VISIBILITY, poseAtTime, smoothForDisplay, steadyLimbs } from './pose-stabilization.js';

const ELBOWS = { left: [11, 13, 15], right: [12, 14, 16] };

// Retrocompatibilità con il vecchio test: le terne misurate dal confronto.
export function measuredAngles(profile) {
  if (!profile) return [];
  if (profile.side && ELBOWS[profile.side]) return [ELBOWS[profile.side]];
  return (profile.joints ?? []).map((joint) => JOINTS.find((item) => item.name === joint.name)?.points).filter(Boolean);
}

const visible = (point) => point && (point.visibility ?? 0) >= MIN_VISIBILITY;

// Colori del design system letti una volta sola: nessun esadecimale scritto a mano.
let palette;
function themeColors() {
  if (palette) return palette;
  const style = getComputedStyle(document.documentElement);
  palette = {
    lime: style.getPropertyValue('--lime-100').trim(),
    olive: style.getPropertyValue('--olive-300').trim(),
    forest: style.getPropertyValue('--forest-900').trim(),
  };
  return palette;
}

function screenDistance(first, second, width, height) {
  return Math.hypot((second.x - first.x) * width, (second.y - first.y) * height);
}

// Unità proporzionale alla persona: il segmento più corto dell'arto in pixel.
function personUnit(landmarks, rule, width, height) {
  const [a, b, c] = rule.points;
  const lengths = [];
  if (visible(landmarks[a]) && visible(landmarks[b])) lengths.push(screenDistance(landmarks[a], landmarks[b], width, height));
  if (visible(landmarks[b]) && visible(landmarks[c])) lengths.push(screenDistance(landmarks[b], landmarks[c], width, height));
  if (lengths.length) return Math.min(...lengths);
  // Riserva: lunghezza del busto, sempre proporzionale alla persona.
  const shoulders = [landmarks[11], landmarks[12]];
  const hips = [landmarks[23], landmarks[24]];
  if (shoulders.every(visible) && hips.every(visible)) {
    const shoulder = { x: (shoulders[0].x + shoulders[1].x) / 2, y: (shoulders[0].y + shoulders[1].y) / 2 };
    const hip = { x: (hips[0].x + hips[1].x) / 2, y: (hips[0].y + hips[1].y) / 2 };
    return screenDistance(shoulder, hip, width, height) * 0.6;
  }
  return Math.min(width, height) * 0.08;
}

export function drawTracking(context, landmarks, { width, height, rule, reference = null, trail = [] }) {
  if (!rule?.points || !Array.isArray(landmarks)) return;
  const colors = themeColors();
  const [shoulderIndex, elbowIndex, wristIndex] = rule.points;
  const shoulder = landmarks[shoulderIndex];
  const elbow = landmarks[elbowIndex];
  const wrist = landmarks[wristIndex];
  const unit = personUnit(landmarks, rule, width, height);
  const xy = (point) => [point.x * width, point.y * height];

  // 1. Zona giusta: arco olive attorno all'articolazione principale.
  if (visible(shoulder) && visible(elbow) && visible(wrist)) {
    const [sx, sy] = xy(shoulder);
    const [ex, ey] = xy(elbow);
    const [wx, wy] = xy(wrist);
    const baseAngle = Math.atan2(sy - ey, sx - ex);
    let sweep = Math.atan2(wy - ey, wx - ex) - baseAngle;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    const sign = sweep < 0 ? -1 : 1;
    const min = Math.max(0, Math.min(180, Math.min(rule.zone.min, rule.zone.max)));
    const max = Math.max(0, Math.min(180, Math.max(rule.zone.min, rule.zone.max)));
    const radius = Math.max(12, unit * 0.32);
    const arcWidth = Math.max(4, unit * 0.07);
    const zoneStart = baseAngle + sign * min * Math.PI / 180;
    const zoneEnd = baseAngle + sign * max * Math.PI / 180;
    context.beginPath();
    context.arc(ex, ey, radius, zoneStart, zoneEnd, sign < 0);
    context.strokeStyle = colors.olive;
    context.globalAlpha = 0.8;
    context.lineWidth = arcWidth;
    context.lineCap = 'round';
    context.stroke();
    context.globalAlpha = 1;

    // 2. Spicchio pieno dall'arto superiore all'angolo attuale.
    context.beginPath();
    context.moveTo(ex, ey);
    context.arc(ex, ey, Math.max(6, radius - arcWidth), baseAngle, baseAngle + sweep, sweep < 0);
    context.closePath();
    context.fillStyle = colors.lime;
    context.globalAlpha = 0.6;
    context.fill();
    context.globalAlpha = 1;
    // TODO: quando il design system definirà --warning, colorare lo spicchio
    // quando è fuori dalla zona. Oggi niente arancione.
  }

  // 3. Sagoma del riferimento: capsule bianche al 40%.
  if (Array.isArray(reference)) {
    const points = [reference[shoulderIndex], reference[elbowIndex], reference[wristIndex]];
    if (points.every(visible)) {
      const capsule = Math.max(5, unit * 0.12);
      context.beginPath();
      context.moveTo(...xy(points[0]));
      context.lineTo(...xy(points[1]));
      context.lineTo(...xy(points[2]));
      context.strokeStyle = 'white';
      context.globalAlpha = 0.4;
      context.lineWidth = capsule;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  // 4. Traiettoria della fase concentrica: opacità crescente verso l'ora.
  if (trail.length) {
    const dot = Math.max(1.5, unit * 0.025);
    trail.forEach((point, index) => {
      if (!visible(point)) return;
      context.beginPath();
      context.arc(...xy(point), dot, 0, Math.PI * 2);
      context.fillStyle = colors.lime;
      context.globalAlpha = 0.15 + 0.85 * ((index + 1) / trail.length);
      context.fill();
    });
    context.globalAlpha = 1;
  }

  // 5. Linee e pallini dell'utente, solo le tre articolazioni della regola.
  const segments = [[shoulder, elbow], [elbow, wrist]];
  const lineWidth = Math.max(1.5, unit * 0.02);
  const borderWidth = lineWidth * 7 / 3;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = colors.forest;
  context.lineWidth = borderWidth;
  for (const [from, to] of segments) {
    if (!visible(from) || !visible(to)) continue;
    context.beginPath();
    context.moveTo(...xy(from));
    context.lineTo(...xy(to));
    context.stroke();
  }
  context.strokeStyle = colors.lime;
  context.lineWidth = lineWidth;
  for (const [from, to] of segments) {
    if (!visible(from) || !visible(to)) continue;
    context.beginPath();
    context.moveTo(...xy(from));
    context.lineTo(...xy(to));
    context.stroke();
  }
  const dot = Math.max(2, unit * 0.03);
  const dotBorder = Math.max(1, unit * 0.012);
  for (const point of [shoulder, elbow, wrist]) {
    if (!visible(point)) continue;
    const [x, y] = xy(point);
    context.beginPath();
    context.arc(x, y, dot + dotBorder, 0, Math.PI * 2);
    context.fillStyle = colors.forest;
    context.fill();
    context.beginPath();
    context.arc(x, y, dot, 0, Math.PI * 2);
    context.fillStyle = colors.lime;
    context.fill();
  }
}

// Collega un canvas a un video: le linee seguono la riproduzione, le pause e i salti.
export function createPoseOverlay(video, canvas) {
  const context = canvas.getContext('2d');
  let frames = [];
  let angles = [];
  let rule = null;
  let referenceFrames = [];
  let referenceCache = null;
  let repTimes = [];
  let targetReps = null;
  let hudMode = 'none';
  let showTrail = true;
  let hud = null;
  let repNode = null;
  let cueNode = null;
  let lastRep = '';
  let lastCue = '';
  let request;

  function size() {
    if (!video.videoWidth || (canvas.width === video.videoWidth && canvas.height === video.videoHeight)) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  function frameIndexAt(time) {
    if (!frames.length) return -1;
    if (time <= frames[0].time) return 0;
    if (time >= frames[frames.length - 1].time) return frames.length - 1;
    let low = 0;
    let high = frames.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (frames[middle].time <= time) low = middle;
      else high = middle;
    }
    return time - frames[low].time <= frames[high].time - time ? low : high;
  }

  function prepare() {
    if (!rule || !frames.length) {
      angles = [];
      repTimes = [];
      return;
    }
    angles = frames.map((frame) => jointAngle(frame.landmarks, rule.points, frameAspect(frame, rule.geometry ?? 1)));
    repTimes = countReps(angles, rule.zone, rule.concentric)
      .map((index) => frames[index]?.time)
      .filter(Number.isFinite);
  }

  // Angoli e fasi del riferimento calcolati una volta per ogni configurazione.
  function prepareReference() {
    if (!rule || !referenceFrames.length) {
      referenceCache = null;
      return;
    }
    const values = referenceFrames.map((frame) => (frame?.landmarks
      ? jointAngle(frame.landmarks, rule.points, frameAspect(frame, rule.geometry ?? 1))
      : null));
    const phases = values.map((_, index) => phaseAt(values, index, rule.concentric));
    referenceCache = { frames: referenceFrames, rule, angles: values, phases };
  }

  function ensureHud() {
    if (hud || !canvas.parentElement) return;
    const root = document.createElement('div');
    root.className = 'bg-pose-hud';
    root.hidden = true;

    const top = document.createElement('div');
    top.className = 'bg-pose-hud__top';
    repNode = document.createElement('span');
    repNode.className = 'bg-pose-hud__reps';
    cueNode = document.createElement('span');
    cueNode.className = 'bg-pose-hud__cue';
    top.append(repNode, cueNode);

    const legend = document.createElement('div');
    legend.className = 'bg-pose-hud__legend';
    for (const [kind, label] of [['ref', 'riferimento'], ['zone', 'zona giusta'], ['you', 'tu']]) {
      const item = document.createElement('span');
      item.className = 'bg-pose-hud__key';
      const mark = document.createElement('i');
      mark.className = `bg-pose-hud__mark bg-pose-hud__mark--${kind}`;
      const text = document.createElement('span');
      text.textContent = label;
      item.append(mark, text);
      legend.append(item);
    }

    root.append(top, legend);
    canvas.parentElement.append(root);
    hud = root;
  }

  function hideHud() {
    if (hud) hud.hidden = true;
  }

  function showHud() {
    if (!frames.length || hudMode === 'none' || !rule) {
      hideHud();
      return;
    }
    ensureHud();
    if (!hud) return;
    hud.hidden = false;
    const name = `bg-pose-hud bg-pose-hud--${hudMode}`;
    if (hud.className !== name) hud.className = name;
  }

  function countAt(time) {
    let low = 0;
    let high = repTimes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (repTimes[middle] <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function updateHud(time, phase) {
    showHud();
    if (!hud || hud.hidden || hudMode !== 'training') return;
    const count = countAt(time);
    const text = targetReps ? `Rip. ${count}/${targetReps}` : `Rip. ${count}`;
    if (text !== lastRep) {
      repNode.textContent = text;
      lastRep = text;
    }
    const cue = phase === 'up' ? 'Segui la sagoma ↑' : 'Scendi piano ↓';
    if (cue !== lastCue) {
      cueNode.textContent = cue;
      lastCue = cue;
    }
  }

  // Ultimi punti della fase concentrica in corso, dal più vecchio al più recente.
  function currentTrail(index) {
    if (!Number.isFinite(index) || index < 0) return [];
    if (phaseAt(angles, index, rule.concentric) !== 'up') return [];
    const points = [];
    for (let cursor = index; cursor >= 0 && points.length < 20; cursor -= 1) {
      if (phaseAt(angles, cursor, rule.concentric) !== 'up') break;
      const point = frames[cursor]?.landmarks?.[rule.trail];
      if (visible(point)) points.push(point);
    }
    return points.reverse();
  }

  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!frames.length || !video.videoWidth) {
      hideHud();
      return;
    }
    size();
    const time = video.currentTime;
    const index = frameIndexAt(time);
    const landmarks = poseAtTime(frames, time) ?? frames[index]?.landmarks;
    if (!landmarks) {
      hideHud();
      return;
    }
    const aspect = frames[index]?.aspect ?? canvas.width / canvas.height;
    const angle = rule ? jointAngle(landmarks, rule.points, aspect) : null;
    const phase = rule ? phaseAt(angles, index, rule.concentric) : 'down';
    let reference = null;
    if (rule && referenceFrames.length && Number.isFinite(angle)) {
      const match = matchReferencePose(referenceFrames, rule, angle, phase, referenceCache);
      if (match?.landmarks) reference = alignToUser(match.landmarks, landmarks, rule, aspect);
    }
    if (rule) {
      drawTracking(context, landmarks, {
        width: canvas.width,
        height: canvas.height,
        rule,
        reference,
        trail: showTrail ? currentTrail(index) : [],
      });
    }
    updateHud(time, phase);
  }

  function loop() {
    draw();
    if (!video.paused && !video.ended) request = requestAnimationFrame(loop);
  }

  video.addEventListener('loadedmetadata', draw);
  video.addEventListener('play', () => { cancelAnimationFrame(request); loop(); });
  for (const name of ['pause', 'seeked', 'timeupdate']) video.addEventListener(name, draw);

  function set(nextFrames, options = {}) {
    // Linee levigate senza ritardo (punti fermi stabili, movimenti seguiti) e
    // lunghezza degli arti tenuta costante.
    frames = nextFrames?.length ? steadyLimbs(lockStillJoints(smoothForDisplay(nextFrames))) : [];
    rule = options.rule ?? null;
    referenceFrames = Array.isArray(options.referenceFrames) ? options.referenceFrames : [];
    const planned = Number(options.targetReps);
    targetReps = Number.isFinite(planned) && planned > 0 ? planned : null;
    hudMode = options.hud === 'legend' || options.hud === 'training' ? options.hud : 'none';
    showTrail = options.trail !== false;
    prepare();
    prepareReference();
    lastRep = '';
    lastCue = '';
    canvas.hidden = frames.length === 0;
    showHud();
    draw();
  }

  return { set, draw, hasFrames: () => frames.length > 0, frames: () => frames };
}
