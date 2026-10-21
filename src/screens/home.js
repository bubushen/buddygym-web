// HomeScreen: app bar, «Le tue schede», una WorkoutCard per scheda nell'ordine
// del programma. La tab bar è disegnata dalla cornice dell'app.
import { appBar, el, emptyState, pageHead, workoutCard } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { averageMinutes, dayLabel, lastSessionEnd, nextWorkoutId, shortDate, workoutSessions } from '../workout-insights.js';
import { plannedSeconds } from '../pilates.js';

// In Pilates (PilatesHomeScreen) le schede sono sequenze: icona Pilates, durata prevista
// se non c'è ancora una sessione, «Inizia sessione» e i giorni di fila sotto il titolo.
// Pressione lunga (o tasto destro) su una card: menu della scheda (WorkoutManageScreen).
function onLongPress(card, run) {
  if (!run) return card;
  let timer = null;
  let fired = false;
  const cancel = () => clearTimeout(timer);
  card.addEventListener('pointerdown', () => { fired = false; timer = setTimeout(() => { fired = true; run(); }, 500); });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'pointermove']) card.addEventListener(type, (event) => { if (type !== 'pointermove' || Math.abs(event.movementY) > 4) cancel(); });
  card.addEventListener('click', (event) => { if (fired) { event.preventDefault(); event.stopPropagation(); fired = false; } }, true);
  card.addEventListener('contextmenu', (event) => { event.preventDefault(); cancel(); run(); });
  card.style.setProperty('-webkit-touch-callout', 'none');
  return card;
}

export function renderHome(root, { workouts: all, storage, activeWorkoutId, initial, canAdd, pilates = false, streak = 0, onAccount, onAdd, onOpen, onStart, onManage }) {
  const workouts = all.filter((workout) => !workout.archived);
  const archived = all.filter((workout) => workout.archived);
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
    return onLongPress(workoutCard({
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
    }), onManage ? () => onManage(workout) : null);
  });
  // Archiviate: in fondo, una riga per scheda; pressione lunga o tocco per il menu.
  const archivedList = archived.length ? [
    el('h2', { className: 'bg-section', text: 'Archiviate' }),
    el('div', { className: 'bg-set-list' }, archived.map((workout) => el('button', {
      type: 'button', className: 'bg-srow', onClick: () => onManage?.(workout),
      'aria-label': `${workout.title}, archiviata: apri il menu`,
    }, el('span', {}, workout.title, el('small', { text: `${workout.exercises.length} ${workout.exercises.length === 1 ? 'esercizio' : 'esercizi'}` })), icon('more', { small: true })))),
  ] : null;

  const total = workouts.length;
  const subtitle = pilates
    ? `${total} ${total === 1 ? 'sequenza' : 'sequenze'}${streak ? ` · ${streak} ${streak === 1 ? 'giorno' : 'giorni'} di fila` : ''}`
    : `${total} ${total === 1 ? 'scheda' : 'schede'}`;
  root.replaceChildren(
    appBar({ initial, onAccount, onAdd, showAdd: canAdd, addLabel: pilates ? 'Aggiungi sequenza' : 'Aggiungi scheda' }),
    el('main', {},
      pageHead({ title: pilates ? 'Le tue sequenze' : 'Le tue schede', subtitle }),
      total
        ? el('div', { className: 'bg-list bg-focuslist' }, cards)
        : emptyState(pilates ? 'Non hai ancora creato sequenze. Tocca + per crearne una.' : 'Non hai ancora creato schede. Tocca + per crearne una.'),
      archivedList),
  );
}
