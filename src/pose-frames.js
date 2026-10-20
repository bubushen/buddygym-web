// Formato compatto per salvare le pose di un video: tempo e, per ogni punto del
// corpo, x, y e visibilità arrotondati. Un minuto di video occupa circa 400 KB.
// Formato 2: 30 fotogrammi al secondo. Le pose salvate nel formato 1 (10 al
// secondo) non vengono più lette e si ricalcolano alla prima apertura.
export const POSE_FORMAT = 2;

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export function packFrames(frames) {
  return {
    format: POSE_FORMAT,
    aspect: frames.find((frame) => frame.aspect)?.aspect ?? null,
    frames: frames.map((frame) => [round(frame.time, 3), frame.landmarks
      ? frame.landmarks.flatMap((point) => [round(point.x, 4), round(point.y, 4), round(point.visibility ?? 0, 2)])
      : null]),
  };
}

export function unpackFrames(packed) {
  if (!packed || packed.format !== POSE_FORMAT || !Array.isArray(packed.frames)) return null;
  return packed.frames.map(([time, values]) => ({
    time,
    aspect: packed.aspect ?? undefined,
    landmarks: values ? Array.from({ length: values.length / 3 }, (_, index) => ({
      x: values[index * 3], y: values[index * 3 + 1], visibility: values[index * 3 + 2],
    })) : null,
  }));
}
