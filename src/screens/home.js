// HomeScreen: app bar, «Le tue schede», una WorkoutCard per scheda nell'ordine
// del programma. La tab bar è disegnata dalla cornice dell'app.
import { appBar, el, emptyState, pageHead, workoutCard } from '../ui/components.js';
import { averageMinutes, dayLabel, lastSessionEnd, nextWorkoutId, shortDate, workoutSessions } from '../workout-insights.js';
import { plannedSeconds } from '../pilates.js';

// In Pilates (PilatesHomeScreen) le schede sono sequenze: icona Pilates, durata prevista
// se non c'è ancora una sessione, «Inizia sessione» e i giorni di fila sotto il titolo.
export function renderHome(root, { workouts, storage, activeWorkoutId, initial, canAdd, pilates = false, streak = 0, onAccount, onAdd, onOpen, onStart }) {
  const sessionsById = new Map(workouts.map((workout) => [workout.id, workoutSessions(storage, workout)]));
  const lastEndById = new Map([...sessionsById].map(([id, sessions]) => [id, lastSessionEnd(sessions)]));
  // Con un allenamento in corso la scheda in evidenza è quella che si sta facendo.
  const nextId = activeWorkoutId ?? nextWorkoutId(workouts, lastEndById);

  const cards = workouts.map((workout, index) => {
    const sessions = sessionsById.get(workout.id);
    const count = workout.exercises.length;
    const minutes = averageMinutes(sessions) ?? (pilates && count ? Math.round(plannedSeconds(workout) / 60) : null);
    const lastEnd = lastEndById.get(workout.id);
    const next = workout.id === nextId;
    return workoutCard({
      title: workout.title,
      overline: next ? 'Prossima' : dayLabel(index),
      meta: [
        { icon: pilates ? 'pilates' : 'dumbbell', text: `${count} ${count === 1 ? 'esercizio' : 'esercizi'}` },
        minutes ? { icon: 'clock', text: `~${minutes} min` } : null,
      ].filter(Boolean),
      foot: lastEnd ? `Ultima volta: ${shortDate(lastEnd)}` : null,
      next: next && count > 0,
      ctaLabel: pilates
        ? (workout.id === activeWorkoutId ? 'Riprendi sessione' : 'Inizia sessione')
        : (workout.id === activeWorkoutId ? 'Riprendi allenamento' : 'Inizia allenamento'),
      onOpen: () => onOpen(workout),
      onStart: () => onStart(workout),
    });
  });

  const total = workouts.length;
  const subtitle = pilates
    ? `${total} ${total === 1 ? 'sequenza' : 'sequenze'}${streak ? ` · ${streak} ${streak === 1 ? 'giorno' : 'giorni'} di fila` : ''}`
    : `${total} ${total === 1 ? 'scheda' : 'schede'}`;
  root.replaceChildren(
    appBar({ initial, onAccount, onAdd, showAdd: canAdd, addLabel: pilates ? 'Aggiungi sequenza' : 'Aggiungi scheda' }),
    el('main', {},
      pageHead({ title: pilates ? 'Le tue sequenze' : 'Le tue schede', subtitle }),
      total
        ? el('div', { className: 'bg-list' }, cards)
        : emptyState(pilates ? 'Non hai ancora creato sequenze. Tocca + per crearne una.' : 'Non hai ancora creato schede. Tocca + per crearne una.')),
  );
}
