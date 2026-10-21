// Riepilogo di fine allenamento (WorkoutSummaryFinal), calcolato dallo storico
// salvato da finishWorkoutSession: niente dati nuovi.
import { readExerciseHistory, sessionMetric } from './workout-history.js';
import { plannedSets } from './workout-insights.js';
import { exerciseEntries, exerciseKey, sessionRecords } from './records.js';

const num = (value) => Number(String(value ?? '').replace(',', '.'));
const rowVolume = (row) => (num(row.reps) > 0 && num(row.load) > 0 ? num(row.reps) * num(row.load) : 0);
const entriesVolume = (entries) => entries.reduce((sum, entry) => sum + entry.rows.reduce((total, row) => total + rowVolume(row), 0), 0);

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function workoutSummary(storage, workout, sessionId, allWorkouts = [workout]) {
  const perExercise = workout.exercises.map((exercise) => {
    const history = readExerciseHistory(storage, workout.id, exercise.id).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    const today = history.find((entry) => entry.sessionId === sessionId) ?? null;
    const before = history.filter((entry) => entry.sessionId !== sessionId && (!today?.startedAt || (entry.endedAt ?? 0) <= today.startedAt));
    return { exercise, today, before };
  });
  const session = perExercise.find((item) => item.today)?.today ?? null;
  // Seduta precedente della stessa scheda: l'ultima finita prima di questa.
  const previousEnds = perExercise.flatMap((item) => item.before.filter((entry) => Number.isFinite(entry.endedAt)));
  const previousEnd = previousEnds.length ? Math.max(...previousEnds.map((entry) => entry.endedAt)) : null;
  const previousId = previousEnds.find((entry) => entry.endedAt === previousEnd)?.sessionId ?? null;
  const previousEntries = perExercise.flatMap((item) => item.before.filter((entry) => entry.sessionId === previousId));

  const volume = entriesVolume(perExercise.flatMap((item) => (item.today ? [item.today] : [])));
  const previousVolume = previousId ? entriesVolume(previousEntries) : null;
  const sets = perExercise.reduce((sum, item) => sum + (item.today?.rows.length ?? 0), 0);
  const planned = workout.exercises.reduce((sum, exercise) => sum + plannedSets(exercise), 0);
  const done = perExercise.filter((item) => item.today?.rows.length).length;

  const records = [];
  const seen = new Set();
  const exercises = perExercise.map(({ exercise, today, before }) => {
    const value = today ? sessionMetric(exercise, today) : null;
    const last = before.filter((entry) => entry.sessionId === previousId).at(-1) ?? before.at(-1);
    const lastValue = last ? sessionMetric(exercise, last) : null;
    // Record di carico o di ripetizioni, confrontati con lo stesso esercizio in tutte le schede.
    const key = exerciseKey(exercise.title);
    if (exercise.mode === 'reps' && today && !seen.has(key)) {
      seen.add(key);
      for (const event of sessionRecords(exerciseEntries(storage, allWorkouts, exercise.title), sessionId)) {
        records.push({ title: exercise.title, load: event.load, reps: event.reps, kind: event.kind });
      }
    }
    return {
      title: exercise.title, unit: exercise.mode === 'time' ? 'min' : 'kg', value,
      delta: value !== null && lastValue !== null ? Math.round((value - lastValue) * 10) / 10 : null,
    };
  });

  return {
    startedAt: session?.startedAt ?? null,
    endedAt: session?.endedAt ?? null,
    duration: session?.startedAt && session?.endedAt ? session.endedAt - session.startedAt : null,
    volume,
    previousVolume,
    previousEnd,
    volumeChange: previousVolume ? Math.round((volume - previousVolume) / previousVolume * 100) : null,
    sets,
    planned,
    exercisesDone: done,
    exercisesTotal: workout.exercises.length,
    records,
    exercises,
  };
}
