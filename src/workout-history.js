const HISTORY_PREFIX = 'buddygym:history:v1:';
const LOG_PREFIX = 'buddygym:set-log:v1:';

export function exerciseLogKey(workoutId, exerciseId) {
  return `${LOG_PREFIX}${workoutId}:${exerciseId}`;
}

export function exerciseHistoryKey(workoutId, exerciseId) {
  return `${HISTORY_PREFIX}${workoutId}:${exerciseId}`;
}

export function readSetLog(storage, workoutId, exerciseId) {
  try {
    const saved = JSON.parse(storage.getItem(exerciseLogKey(workoutId, exerciseId)));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

export function readExerciseHistory(storage, workoutId, exerciseId) {
  try {
    const saved = JSON.parse(storage.getItem(exerciseHistoryKey(workoutId, exerciseId)));
    return Array.isArray(saved) ? saved.filter((entry) => entry && Array.isArray(entry.rows))
      .map((entry) => ({ ...entry, rows: entry.rows.filter((row) => row && typeof row === 'object') })) : [];
  } catch { return []; }
}

function recordedRows(exercise, rows) {
  return rows.flatMap((row, index) => {
    const filled = exercise.mode === 'time'
      ? row?.minutes !== '' && row?.minutes != null
      : row && (row.reps !== '' && row.reps != null || row.load !== '' && row.load != null);
    return filled ? [{ ...row, set: index + 1 }] : [];
  });
}

export function saveExerciseSession(storage, workoutId, exercise, session) {
  const rows = recordedRows(exercise, readSetLog(storage, workoutId, exercise.id));
  if (!rows.length) return true;
  const key = exerciseHistoryKey(workoutId, exercise.id);
  const previous = readExerciseHistory(storage, workoutId, exercise.id);
  const entry = { sessionId: session.sessionId, startedAt: session.startedAt, endedAt: session.endedAt, rows };
  const index = previous.findIndex((item) => item.sessionId === entry.sessionId);
  if (index < 0) previous.push(entry);
  else previous[index] = entry;
  try {
    storage.setItem(key, JSON.stringify(previous));
    return true;
  } catch { return false; }
}

export function finishWorkoutSession(storage, workout, session, endedAt = Date.now()) {
  if (!storage) return false;
  const entry = { sessionId: `workout-${session.startedAt}`, startedAt: session.startedAt, endedAt };
  for (const exercise of workout.exercises) {
    if (!saveExerciseSession(storage, workout.id, exercise, entry)) return false;
  }
  for (const exercise of workout.exercises) {
    try { storage.removeItem(exerciseLogKey(workout.id, exercise.id)); } catch { return false; }
  }
  return true;
}

export function migratePreviousLog(storage, workoutId, exercise, hasActiveSession) {
  if (!storage || hasActiveSession) return false;
  const rows = recordedRows(exercise, readSetLog(storage, workoutId, exercise.id));
  if (!rows.length) return false;
  const previous = readExerciseHistory(storage, workoutId, exercise.id);
  const legacy = previous.find((entry) => entry.sessionId === 'legacy');
  if (legacy) {
    if (JSON.stringify(legacy.rows) !== JSON.stringify(rows)) return false;
    try { storage.removeItem(exerciseLogKey(workoutId, exercise.id)); return true; } catch { return false; }
  }
  if (!saveExerciseSession(storage, workoutId, exercise, { sessionId: 'legacy', startedAt: null, endedAt: null })) return false;
  try { storage.removeItem(exerciseLogKey(workoutId, exercise.id)); return true; } catch { return false; }
}

export function sessionMetric(exercise, entry) {
  const field = exercise.mode === 'time' ? 'minutes' : 'load';
  const values = entry.rows.filter((row) => row?.[field] !== '' && row?.[field] != null
    && (exercise.mode === 'time' || Number(row.reps) > 0))
    .map((row) => Number(row[field])).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? Math.max(...values) : null;
}
