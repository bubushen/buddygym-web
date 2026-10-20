export const ACTIVE_WORKOUT_KEY = 'buddygym:active-workout:v1';

export function formatElapsed(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function loadActiveWorkout(storage, workouts) {
  try {
    const value = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY));
    if (value && typeof value.workoutId === 'string' && Number.isFinite(value.startedAt)
      && value.startedAt <= Date.now() && workouts.some((item) => item.id === value.workoutId)) return value;
  } catch { /* Nessun allenamento ripristinabile. */ }
  return null;
}
