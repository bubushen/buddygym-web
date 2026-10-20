// HomeScreen: app bar, «Le tue schede», una WorkoutCard per scheda nell'ordine
// del programma. La tab bar è disegnata dalla cornice dell'app.
import { appBar, el, emptyState, pageHead, workoutCard } from '../ui/components.js';
import { averageMinutes, dayLabel, lastSessionEnd, nextWorkoutId, shortDate, workoutSessions } from '../workout-insights.js';

export function renderHome(root, { workouts, storage, activeWorkoutId, initial, canAdd, onAccount, onAdd, onOpen, onStart }) {
  const sessionsById = new Map(workouts.map((workout) => [workout.id, workoutSessions(storage, workout)]));
  const lastEndById = new Map([...sessionsById].map(([id, sessions]) => [id, lastSessionEnd(sessions)]));
  // Con un allenamento in corso la scheda in evidenza è quella che si sta facendo.
  const nextId = activeWorkoutId ?? nextWorkoutId(workouts, lastEndById);

  const cards = workouts.map((workout, index) => {
    const sessions = sessionsById.get(workout.id);
    const minutes = averageMinutes(sessions);
    const lastEnd = lastEndById.get(workout.id);
    const count = workout.exercises.length;
    const next = workout.id === nextId;
    return workoutCard({
      title: workout.title,
      overline: next ? 'Prossima' : dayLabel(index),
      meta: [
        { icon: 'dumbbell', text: `${count} ${count === 1 ? 'esercizio' : 'esercizi'}` },
        minutes ? { icon: 'clock', text: `~${minutes} min` } : null,
      ].filter(Boolean),
      foot: lastEnd ? `Ultima volta: ${shortDate(lastEnd)}` : null,
      next: next && count > 0,
      ctaLabel: workout.id === activeWorkoutId ? 'Riprendi allenamento' : 'Inizia allenamento',
      onOpen: () => onOpen(workout),
      onStart: () => onStart(workout),
    });
  });

  const total = workouts.length;
  root.replaceChildren(
    appBar({ initial, onAccount, onAdd, showAdd: canAdd }),
    el('main', {},
      pageHead({ title: 'Le tue schede', subtitle: `${total} ${total === 1 ? 'scheda' : 'schede'}` }),
      total
        ? el('div', { className: 'bg-list' }, cards)
        : emptyState('Non hai ancora creato schede. Tocca + per crearne una.')),
  );
}
