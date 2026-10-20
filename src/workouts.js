export const WORKOUT_STORAGE_KEY = 'buddygym:workouts:v2';

const EXAMPLES = [
  {
    id: 'upper-1-example', title: 'Upper 1', source: 'example',
    exercises: [{ id: 'upper-1-curl', title: 'Curl con manubrio', mode: 'reps', sets: 3, reps: 10 }],
  },
  {
    id: 'lower-example', title: 'Lower', source: 'example',
    exercises: [
      { id: 'lower-bike', title: 'Bike', mode: 'time', minutes: 10 },
      { id: 'lower-leg-press', title: 'Leg press', mode: 'reps', sets: 3, reps: 8 },
    ],
  },
  {
    id: 'upper-2-example', title: 'Upper 2', source: 'example',
    exercises: [{ id: 'upper-2-curl', title: 'Curl con manubrio', mode: 'reps', sets: 4, reps: 8 }],
  },
];

export function exampleWorkouts() {
  return structuredClone(EXAMPLES);
}

function validExercise(exercise) {
  if (!exercise || typeof exercise.id !== 'string' || typeof exercise.title !== 'string' || !exercise.title.trim()) return false;
  if (exercise.restSeconds !== undefined && !(Number.isInteger(exercise.restSeconds) && exercise.restSeconds >= 0)) return false;
  // Gli esercizi a tempo possono avere più serie (per esempio 3 × 45 s di plank).
  if (exercise.mode === 'time') return Number.isFinite(exercise.minutes) && exercise.minutes > 0
    && (exercise.sets === undefined || (Number.isInteger(exercise.sets) && exercise.sets > 0));
  return exercise.mode === 'reps' && Number.isInteger(exercise.sets) && exercise.sets > 0 && Number.isInteger(exercise.reps) && exercise.reps > 0;
}

export function validWorkout(workout) {
  return workout && typeof workout.id === 'string' && typeof workout.title === 'string' && workout.title.trim()
    && Array.isArray(workout.exercises) && workout.exercises.every(validExercise);
}

export function loadWorkouts(storage) {
  try {
    const raw = storage.getItem(WORKOUT_STORAGE_KEY);
    if (raw === null) return exampleWorkouts();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(validWorkout)) return parsed;
  } catch { /* Il browser può impedire l'accesso all'archiviazione locale. */ }
  return exampleWorkouts();
}

export function saveWorkouts(storage, workouts) {
  try {
    storage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(workouts));
    return true;
  } catch { return false; }
}

export function migrateLegacyCurlLogs(storage) {
  for (const [oldId, newId] of [['coach-demo:dumbbell-curl', 'upper-1-example:upper-1-curl'], ['personal-demo:dumbbell-curl', 'upper-2-example:upper-2-curl']]) {
    try {
      const oldKey = `buddygym:set-log:v1:${oldId}`;
      const newKey = `buddygym:set-log:v1:${newId}`;
      const previous = storage.getItem(oldKey);
      if (previous !== null && storage.getItem(newKey) === null) storage.setItem(newKey, previous);
    } catch { /* Il registro corrente resta utilizzabile anche senza migrazione. */ }
  }
}

export function exerciseSummary(exercise) {
  return exercise.mode === 'time'
    ? `${exercise.minutes} minuti`
    : `${exercise.sets} serie × ${exercise.reps} ripetizioni`;
}

export function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
