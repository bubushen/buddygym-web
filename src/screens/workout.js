// WorkoutScreen (prima di iniziare) e WorkoutActiveScreen (allenamento in corso).
import { el, emptyState, link, pageHead, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { readExerciseHistory, readSetLog } from '../workout-history.js';
import { averageMinutes, exerciseProgress, lastSessionEnd, lastTimeLabel, shortDate, targetLabel, workoutSessions } from '../workout-insights.js';

const number = (index) => String(index + 1).padStart(2, '0');

function exerciseRow({ exercise, index, meta, state, onOpen }) {
  return el('button', { type: 'button', className: `bg-exrow${state ? ` bg-exrow--${state}` : ''}`, onClick: onOpen },
    el('span', { className: 'bg-exrow__num' }, state === 'done' ? icon('check', { small: true }) : number(index)),
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: exercise.title }),
      el('span', { className: 'bg-exrow__meta', text: meta })),
    el('span', { className: 'bg-exrow__target', text: targetLabel(exercise) }),
    icon('chevronRight', { small: true }));
}

export function renderWorkoutScreen(root, dock, { workout, storage, active, editable, onBack, onOpenExercise, onStart, onStop, onEdit, onAddExercise }) {
  const exercises = workout.exercises;
  let head;
  let rows;
  if (active) {
    // In corso: fatto, in corso (serie iniziate) o da fare.
    const progress = exercises.map((exercise) => exerciseProgress(exercise, readSetLog(storage, workout.id, exercise.id)));
    const doneCount = progress.filter((item) => item.complete).length;
    head = pageHead({ title: workout.title, subtitle: `${doneCount} di ${exercises.length} esercizi fatti · tocca un esercizio per aprirlo` });
    head.classList.add('bg-pagehead--tight');
    rows = exercises.map((exercise, index) => {
      const { done, total, complete } = progress[index];
      const meta = complete ? `Fatto · ${done} serie`
        : done ? `In corso · serie ${done + 1} di ${total}`
          : lastTimeLabel(exercise, readExerciseHistory(storage, workout.id, exercise.id));
      return exerciseRow({ exercise, index, meta, state: complete ? 'done' : done ? 'current' : '', onOpen: () => onOpenExercise(exercise) });
    });
  } else {
    head = pageHead({ title: workout.title });
    head.classList.add('bg-pagehead--tight');
    rows = exercises.map((exercise, index) => exerciseRow({
      exercise, index, meta: lastTimeLabel(exercise, readExerciseHistory(storage, workout.id, exercise.id)), onOpen: () => onOpenExercise(exercise),
    }));
  }

  const sessions = workoutSessions(storage, workout);
  const minutes = averageMinutes(sessions);
  const last = lastSessionEnd(sessions);
  const summary = active ? null : el('div', { className: 'bg-summary' },
    el('span', {}, icon('dumbbell', { small: true }), `${exercises.length} ${exercises.length === 1 ? 'esercizio' : 'esercizi'}`),
    minutes ? el('span', {}, icon('clock', { small: true }), `~${minutes} min`) : null,
    last ? el('span', { text: `Ultima volta: ${shortDate(last)}` }) : null);

  root.replaceChildren(
    topBar({ title: 'Scheda', onBack, backLabel: 'Torna alle schede' }),
    el('main', {},
      head,
      summary,
      exercises.length
        ? el('div', { className: `bg-exlist${active ? ' bg-exlist--spaced' : ''}` }, rows)
        : emptyState('Questa scheda non ha ancora esercizi.'),
      editable ? el('div', { className: 'bg-workout-actions' },
        link({ label: 'Aggiungi esercizio', onClick: onAddExercise }),
        link({ label: 'Modifica scheda', onClick: onEdit })) : null));

  dock.replaceChildren(active
    ? el('div', { className: 'bg-startdock' },
      el('button', { type: 'button', className: 'bg-startbtn bg-startbtn--stop', onClick: onStop, text: 'Termina allenamento' }))
    : exercises.length
      ? el('div', { className: 'bg-startdock' },
        el('button', { type: 'button', className: 'bg-startbtn', onClick: onStart }, icon('play'), 'Inizia allenamento'),
        el('span', { className: 'bg-startdock__note', text: 'Il cronometro parte subito e resta attivo in tutta l\'app.' }))
      : '');
}
