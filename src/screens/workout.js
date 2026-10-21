// WorkoutScreen (prima di iniziare) e WorkoutActiveScreen (allenamento in corso).
import { el, emptyState, link, pageHead, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { readExerciseHistory, readSetLog } from '../workout-history.js';
import { averageMinutes, exerciseProgress, lastSessionEnd, lastTimeLabel, shortDate, targetLabel, workoutSessions } from '../workout-insights.js';
import { clockText, exerciseMeta, plannedSeconds } from '../pilates.js';

const number = (index) => String(index + 1).padStart(2, '0');

const target = (exercise) => (exercise.mode === 'pilates' ? clockText(exercise.seconds) : targetLabel(exercise));

function exerciseRow({ exercise, index, meta, state, onOpen }) {
  return el('button', { type: 'button', className: `bg-exrow${state ? ` bg-exrow--${state}` : ''}`, onClick: onOpen },
    el('span', { className: 'bg-exrow__num' }, state === 'done' ? icon('check', { small: true }) : number(index)),
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: exercise.title }),
      el('span', { className: 'bg-exrow__meta', text: meta })),
    el('span', { className: 'bg-exrow__target', text: target(exercise) }),
    icon('chevronRight', { small: true }));
}

// PilatesSessionScreen: stessa struttura, con durata, attrezzo e livello al posto di
// serie × ripetizioni; `progress` dice quali esercizi sono fatti e quale è in corso.
export function renderWorkoutScreen(root, dock, { workout, storage, active, editable, pilatesProgress, onBack, onOpenExercise, onStart, onStop, onEdit, onAddExercise, onMenu, unit = 'kg' }) {
  const exercises = workout.exercises;
  const pilates = workout.mode === 'pilates';
  let head;
  let rows;
  if (pilates && active) {
    const { done, current } = pilatesProgress;
    head = pageHead({ title: workout.title, subtitle: `${done.size} di ${exercises.length} esercizi fatti · tocca un esercizio per aprirlo` });
    head.classList.add('bg-pagehead--tight');
    rows = exercises.map((exercise, index) => {
      const state = done.has(index) ? 'done' : index === current ? 'current' : '';
      return exerciseRow({ exercise, index, meta: state === 'done' ? 'Fatto' : state === 'current' ? 'In corso' : exerciseMeta(exercise), state, onOpen: () => onOpenExercise(exercise) });
    });
  } else if (pilates) {
    head = pageHead({ title: workout.title });
    head.classList.add('bg-pagehead--tight');
    rows = exercises.map((exercise, index) => exerciseRow({ exercise, index, meta: exerciseMeta(exercise), onOpen: () => onOpenExercise(exercise) }));
  } else if (active) {
    // In corso: fatto, in corso (serie iniziate) o da fare.
    const progress = exercises.map((exercise) => exerciseProgress(exercise, readSetLog(storage, workout.id, exercise.id)));
    const doneCount = progress.filter((item) => item.complete).length;
    head = pageHead({ title: workout.title, subtitle: `${doneCount} di ${exercises.length} esercizi fatti · tocca un esercizio per aprirlo` });
    head.classList.add('bg-pagehead--tight');
    rows = exercises.map((exercise, index) => {
      const { done, total, complete } = progress[index];
      const meta = complete ? `Fatto · ${done} serie`
        : done ? `In corso · serie ${done + 1} di ${total}`
          : lastTimeLabel(exercise, readExerciseHistory(storage, workout.id, exercise.id), unit);
      return exerciseRow({ exercise, index, meta, state: complete ? 'done' : done ? 'current' : '', onOpen: () => onOpenExercise(exercise) });
    });
  } else {
    head = pageHead({ title: workout.title });
    head.classList.add('bg-pagehead--tight');
    rows = exercises.map((exercise, index) => exerciseRow({
      exercise, index, meta: lastTimeLabel(exercise, readExerciseHistory(storage, workout.id, exercise.id), unit), onOpen: () => onOpenExercise(exercise),
    }));
  }

  const sessions = workoutSessions(storage, workout);
  const minutes = averageMinutes(sessions) ?? (pilates && exercises.length ? Math.round(plannedSeconds(workout) / 60) : null);
  const last = lastSessionEnd(sessions);
  const noun = pilates ? 'sequenza' : 'scheda';
  const summary = active ? null : el('div', { className: 'bg-summary' },
    el('span', {}, icon(pilates ? 'pilates' : 'dumbbell', { small: true }), `${exercises.length} ${exercises.length === 1 ? 'esercizio' : 'esercizi'}`),
    minutes ? el('span', {}, icon('clock', { small: true }), `~${minutes} min`) : null,
    last ? el('span', { text: `Ultima volta: ${shortDate(last)}` }) : null);

  root.replaceChildren(
    topBar({ title: pilates ? 'Sequenza' : 'Scheda', onBack, backLabel: pilates ? 'Torna alle sequenze' : 'Torna alle schede',
      action: onMenu ? el('button', { type: 'button', className: 'bg-iconbtn', 'aria-label': `Gestisci ${noun}`, onClick: onMenu }, icon('more')) : null }),
    el('main', {},
      head,
      summary,
      exercises.length
        ? el('div', { className: `bg-exlist${active ? ' bg-exlist--spaced' : ''}` }, rows)
        : emptyState(`Questa ${noun} non ha ancora esercizi.`),
      editable ? el('div', { className: 'bg-workout-actions' },
        link({ label: 'Aggiungi esercizio', onClick: onAddExercise }),
        link({ label: `Modifica ${noun}`, onClick: onEdit })) : null));

  dock.replaceChildren(active
    ? el('div', { className: 'bg-startdock' },
      el('button', { type: 'button', className: 'bg-startbtn bg-startbtn--stop', onClick: onStop, text: pilates ? 'Termina sessione' : 'Termina allenamento' }))
    : exercises.length
      ? el('div', { className: 'bg-startdock' },
        el('button', { type: 'button', className: 'bg-startbtn', onClick: onStart }, icon('play'), pilates ? 'Inizia sessione' : 'Inizia allenamento'),
        el('span', { className: 'bg-startdock__note', text: 'Il cronometro parte subito e resta attivo in tutta l\'app.' }))
      : '');
}
