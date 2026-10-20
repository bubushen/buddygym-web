import { loadWorkouts, validWorkout, WORKOUT_STORAGE_KEY } from './workouts.js';

function isWorkoutDataKey(key) {
  return key === WORKOUT_STORAGE_KEY
    || key.startsWith('buddygym:history:v1:')
    || key.startsWith('buddygym:set-log:v1:');
}

export function createLocalBackup(storage, createdAt = new Date().toISOString()) {
  const records = {};
  if (!storage) throw new Error('Archivio locale non disponibile.');
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isWorkoutDataKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) records[key] = value;
  }
  return { format: 'buddygym-workout-backup', version: 1, createdAt, records };
}

export function validateLocalBackup(backup) {
  if (!backup || backup.format !== 'buddygym-workout-backup' || backup.version !== 1
    || !backup.records || typeof backup.records !== 'object' || Array.isArray(backup.records)) return false;
  return Object.entries(backup.records).every(([key, value]) => {
    if (!isWorkoutDataKey(key) || typeof value !== 'string') return false;
    try {
      const parsed = JSON.parse(value);
      if (key === WORKOUT_STORAGE_KEY) return Array.isArray(parsed) && parsed.every(validWorkout);
      if (key.startsWith('buddygym:history:v1:')) return Array.isArray(parsed) && parsed.every((entry) =>
        entry && typeof entry.sessionId === 'string' && Array.isArray(entry.rows));
      return Array.isArray(parsed);
    } catch { return false; }
  });
}

export function importLocalBackup(storage, backup) {
  if (!validateLocalBackup(backup)) throw new Error('Il file non è un backup Buddy Gym valido.');
  const importedWorkouts = backup.records[WORKOUT_STORAGE_KEY]
    ? JSON.parse(backup.records[WORKOUT_STORAGE_KEY]) : [];
  const currentWorkouts = loadWorkouts(storage);
  const importedIds = new Set(importedWorkouts.map((workout) => workout.id));
  for (const [key, value] of Object.entries(backup.records)) {
    if (key === WORKOUT_STORAGE_KEY) continue;
    if (key.startsWith('buddygym:history:v1:')) {
      let current = [];
      try {
        const parsed = JSON.parse(storage.getItem(key) || '[]');
        if (Array.isArray(parsed)) current = parsed.filter((entry) => entry && typeof entry.sessionId === 'string');
      } catch { /* Lo storico del backup resta valido. */ }
      const merged = new Map(current.map((entry) => [entry.sessionId, entry]));
      for (const entry of JSON.parse(value)) merged.set(entry.sessionId, entry);
      storage.setItem(key, JSON.stringify([...merged.values()]));
    } else storage.setItem(key, value);
  }
  storage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify([
    ...importedWorkouts,
    ...currentWorkouts.filter((workout) => !importedIds.has(workout.id)),
  ]));
}
