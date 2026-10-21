// Dati della home ricavati dallo storico esistente: ultima volta, durata media,
// scheda «Prossima». Nessun dato nuovo: le sedute sono quelle salvate da
// finishWorkoutSession (sessionId, startedAt, endedAt) per ogni esercizio.
import { readExerciseHistory, sessionMetric } from './workout-history.js';
import { displayNumber, toDisplay, unitLabel } from './units.js';

export function workoutSessions(storage, workout) {
  const sessions = new Map();
  for (const exercise of workout.exercises) {
    for (const entry of readExerciseHistory(storage, workout.id, exercise.id)) {
      if (!Number.isFinite(entry.endedAt)) continue;
      sessions.set(entry.sessionId, { sessionId: entry.sessionId, startedAt: entry.startedAt, endedAt: entry.endedAt });
    }
  }
  return [...sessions.values()].sort((a, b) => a.endedAt - b.endedAt);
}

export function lastSessionEnd(sessions) {
  return sessions.length ? sessions[sessions.length - 1].endedAt : null;
}

// Durata stimata: media delle sedute reali, arrotondata a 5 minuti.
export function averageMinutes(sessions) {
  const durations = sessions.filter((session) => Number.isFinite(session.startedAt) && session.endedAt > session.startedAt)
    .map((session) => (session.endedAt - session.startedAt) / 60000);
  if (!durations.length) return null;
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return Math.max(5, Math.round(average / 5) * 5);
}

// «Prossima»: la scheda dopo l'ultima fatta, nell'ordine della lista (il programma).
export function nextWorkoutId(workouts, lastEndById) {
  if (!workouts.length) return null;
  let lastIndex = -1;
  let lastEnd = -Infinity;
  workouts.forEach((workout, index) => {
    const end = lastEndById.get(workout.id);
    if (Number.isFinite(end) && end > lastEnd) { lastEnd = end; lastIndex = index; }
  });
  return workouts[(lastIndex + 1) % workouts.length].id;
}

// «Giorno A», «Giorno B»… dalla posizione nella lista.
export function dayLabel(index) {
  return `Giorno ${String.fromCharCode(65 + (index % 26))}`;
}

// «sab 17 ott»
export function shortDate(timestamp) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).format(timestamp);
}

// «4 × 6» oppure «10 min» (con più serie a tempo: «3 × 10 min»).
export function targetLabel(exercise) {
  if (exercise.mode === 'time') return Number(exercise.sets) > 1 ? `${exercise.sets} × ${exercise.minutes} min` : `${exercise.minutes} min`;
  return `${exercise.sets} × ${exercise.reps}`;
}

const formatNumber = (value) => value.toLocaleString('it-IT', { maximumFractionDigits: 2 });

// «Scorsa volta: 100 kg»: il carico più alto (o i minuti) dell'ultima seduta salvata.
export function lastTimeLabel(exercise, history, unit = 'kg') {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const value = sessionMetric(exercise, history[index]);
    if (value !== null) return `Scorsa volta: ${exercise.mode === 'time' ? formatNumber(value) : formatNumber(displayNumber(value, unit))} ${exercise.mode === 'time' ? 'min' : unitLabel(unit)}`;
  }
  return history.length ? 'Scorsa volta: corpo libero' : 'Prima volta';
}

// Una serie conta come fatta se è stata spuntata; le serie salvate prima della
// spunta (senza il campo «done») contano se hanno un valore.
export function rowDone(exercise, row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.done === 'boolean') return row.done;
  const filled = (value) => value !== '' && value != null;
  return exercise.mode === 'time' ? filled(row.minutes) : filled(row.reps) || filled(row.load);
}

export function plannedSets(exercise) {
  return Math.max(1, Number(exercise.sets) || 1);
}

// Avanzamento nella seduta in corso: serie fatte su serie previste (le serie aggiunte contano).
export function exerciseProgress(exercise, rows) {
  const done = rows.filter((row) => rowDone(exercise, row)).length;
  const total = Math.max(plannedSets(exercise), rows.length);
  return { done, total, complete: done >= total };
}

// Recupero tra le serie scelto nell'esercizio; 90 s per quelli creati prima del campo.
export const DEFAULT_REST_SECONDS = 90;
export function restSecondsOf(exercise) {
  const value = Number(exercise?.restSeconds);
  return Number.isInteger(value) && value >= 15 && value <= 600 ? value : DEFAULT_REST_SECONDS;
}

// EndWorkoutSheet: «Mancano Leg press (1 serie), Affondi bulgari e Calf raise.»
export function endWorkoutCheck(workout, logs) {
  const progress = workout.exercises.map((exercise, index) => ({ exercise, ...exerciseProgress(exercise, logs[index] ?? []) }));
  const missing = progress.filter((item) => !item.complete).map(({ exercise, done, total }) => (done
    ? `${exercise.title} (${total - done} serie)`
    : exercise.title));
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} e ${missing.at(-1)}` : missing[0];
  return {
    done: progress.filter((item) => item.complete).length,
    total: workout.exercises.length,
    sets: progress.reduce((sum, item) => sum + item.done, 0),
    complete: missing.length === 0,
    warning: missing.length ? `Mancano ${list}. Le serie fatte vengono salvate lo stesso.` : '',
  };
}
