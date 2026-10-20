// Linee del corpo disegnate sopra un video: busto, braccia, gambe, articolazioni
// e, sulle articolazioni misurate dal confronto, l'angolo in gradi.
import { lockStillJoints, MIN_VISIBILITY, poseAtTime, smoothForDisplay, steadyLimbs } from './pose-stabilization.js';
import { JOINTS } from './generic-pose.js';

const TORSO = '#55c7ef';
const ARM = '#c8fb60';
const LEG = '#f8b35a';
const ANGLE = '#ffffff';
const SEGMENTS = [
  [11, 12, TORSO], [11, 23, TORSO], [12, 24, TORSO], [23, 24, TORSO],
  [11, 13, ARM], [13, 15, ARM], [12, 14, ARM], [14, 16, ARM],
  [23, 25, LEG], [25, 27, LEG], [24, 26, LEG], [26, 28, LEG],
];
const JOINT_POINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const ELBOWS = { left: [11, 13, 15], right: [12, 14, 16] };

// Articolazioni su cui mostrare l'angolo, a partire dal profilo usato nel confronto.
export function measuredAngles(profile) {
  if (!profile) return [];
  if (profile.side && ELBOWS[profile.side]) return [ELBOWS[profile.side]];
  return (profile.joints ?? []).map((joint) => JOINTS.find((item) => item.name === joint.name)?.points).filter(Boolean);
}

const visible = (point) => point && (point.visibility ?? 0) >= MIN_VISIBILITY;

export function drawPose(context, landmarks, { width, height, angles = [] }) {
  const xy = (point) => [point.x * width, point.y * height];
  const stroke = Math.max(3, Math.min(width, height) / 110);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const [a, b, color] of SEGMENTS) {
    const from = landmarks[a];
    const to = landmarks[b];
    if (!visible(from) || !visible(to)) continue;
    context.beginPath();
    context.moveTo(...xy(from));
    context.lineTo(...xy(to));
    context.strokeStyle = color;
    context.lineWidth = stroke;
    context.stroke();
  }
  for (const index of JOINT_POINTS) {
    const point = landmarks[index];
    if (!visible(point)) continue;
    const [x, y] = xy(point);
    context.beginPath();
    context.arc(x, y, stroke * 1.3, 0, Math.PI * 2);
    context.fillStyle = '#10200c';
    context.fill();
    context.lineWidth = stroke * 0.7;
    context.strokeStyle = index <= 16 ? ARM : LEG;
    context.stroke();
  }
  for (const [a, b, c] of angles) {
    const [start, center, end] = [landmarks[a], landmarks[b], landmarks[c]];
    if (![start, center, end].every(visible)) continue;
    const [sx, sy] = xy(start);
    const [cx, cy] = xy(center);
    const [ex, ey] = xy(end);
    const from = Math.atan2(sy - cy, sx - cx);
    let sweep = Math.atan2(ey - cy, ex - cx) - from;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    const radius = Math.max(18, Math.min(width, height) / 16);
    context.beginPath();
    context.arc(cx, cy, radius, from, from + sweep, sweep < 0);
    context.strokeStyle = ANGLE;
    context.lineWidth = Math.max(2, stroke / 2);
    context.stroke();
    const label = `${Math.round(Math.abs(sweep * 180 / Math.PI))}°`;
    context.font = `700 ${Math.round(Math.max(16, Math.min(width, height) / 22))}px sans-serif`;
    context.lineWidth = Math.max(3, stroke * 0.9);
    context.strokeStyle = '#10200c';
    context.strokeText(label, cx + radius * 0.9, cy - radius * 0.4);
    context.fillStyle = ANGLE;
    context.fillText(label, cx + radius * 0.9, cy - radius * 0.4);
  }
}

// Collega un canvas a un video: le linee seguono la riproduzione, le pause e i salti.
export function createPoseOverlay(video, canvas) {
  const context = canvas.getContext('2d');
  let frames = [];
  let angles = [];
  let request;
  function size() {
    if (!video.videoWidth || (canvas.width === video.videoWidth && canvas.height === video.videoHeight)) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!frames.length || !video.videoWidth) return;
    size();
    const landmarks = poseAtTime(frames, video.currentTime);
    if (landmarks) drawPose(context, landmarks, { width: canvas.width, height: canvas.height, angles });
  }
  function loop() {
    draw();
    if (!video.paused && !video.ended) request = requestAnimationFrame(loop);
  }
  video.addEventListener('loadedmetadata', draw);
  video.addEventListener('play', () => { cancelAnimationFrame(request); loop(); });
  for (const name of ['pause', 'seeked', 'timeupdate']) video.addEventListener(name, draw);
  function set(nextFrames, nextAngles = []) {
    // Linee levigate senza ritardo (punti fermi stabili, movimenti seguiti) e
    // lunghezza degli arti tenuta costante.
    frames = nextFrames?.length ? steadyLimbs(lockStillJoints(smoothForDisplay(nextFrames))) : [];
    angles = nextAngles;
    canvas.hidden = frames.length === 0;
    draw();
  }
  return { set, draw, hasFrames: () => frames.length > 0 };
}
