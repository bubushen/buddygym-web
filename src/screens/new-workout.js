// NewWorkoutScreen: nome della scheda ed esercizi in bozza; «Salva scheda» li salva insieme.
import { el, emptyState, link, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { targetLabel } from '../workout-insights.js';

function kindLabel(exercise) {
  return exercise.mode === 'time' ? 'Tempo' : 'Serie e ripetizioni';
}

// Riordino: trascinando la maniglia, oppure con le frecce su/giù quando la maniglia ha il focus.
function enableReorder(list, draft, onChange) {
  let dragging = null;
  list.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('.bg-draft__grip');
    if (!grip) return;
    event.preventDefault();
    dragging = grip.closest('.bg-draft__item');
    dragging.classList.add('bg-draft__item--dragging');
    grip.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('.bg-draft__item');
    if (!over || over === dragging || over.parentElement !== list) return;
    const box = over.getBoundingClientRect();
    list.insertBefore(dragging, event.clientY < box.top + box.height / 2 ? over : over.nextSibling);
  });
  const drop = () => {
    if (!dragging) return;
    dragging.classList.remove('bg-draft__item--dragging');
    dragging = null;
    const order = [...list.children].map((item) => item.dataset.id);
    draft.exercises.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    onChange();
  };
  list.addEventListener('pointerup', drop);
  list.addEventListener('pointercancel', drop);
  list.addEventListener('keydown', (event) => {
    const grip = event.target.closest('.bg-draft__grip');
    if (!grip || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const index = draft.exercises.findIndex((item) => item.id === grip.closest('.bg-draft__item').dataset.id);
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (target < 0 || target >= draft.exercises.length) return;
    [draft.exercises[index], draft.exercises[target]] = [draft.exercises[target], draft.exercises[index]];
    onChange(draft.exercises[target].id);
  });
}

export function renderNewWorkout(root, dock, props) {
  const { draft, editing, onClose, onAddExercise, onOpenExercise, onSave, onDelete } = props;
  const rerender = (focusId) => {
    renderNewWorkout(root, dock, props);
    if (focusId) root.querySelector(`.bg-draft__item[data-id="${CSS.escape(focusId)}"] .bg-draft__grip`)?.focus();
  };
  const name = el('input', { id: 'workoutNameInput', className: 'bg-input', placeholder: 'Es. Upper 1, Lower, Push', maxlength: 60, autocomplete: 'off', value: draft.title || null });
  const error = el('p', { className: 'bg-formstatus bg-formstatus--error', role: 'alert' });
  const canSave = () => !!draft.title.trim() && draft.exercises.length > 0;
  const save = el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--primary', text: 'Salva scheda' });
  const syncSave = () => {
    save.classList.toggle('bg-btn--disabled', !canSave());
    save.setAttribute('aria-disabled', String(!canSave()));
  };
  name.addEventListener('input', () => { draft.title = name.value; draft.dirty = true; syncSave(); });
  save.addEventListener('click', async () => {
    if (!draft.title.trim()) { error.textContent = 'Dai un nome alla scheda.'; name.focus(); return; }
    if (!draft.exercises.length) { error.textContent = 'Aggiungi almeno un esercizio.'; return; }
    save.disabled = true;
    try { error.textContent = (await onSave()) ?? ''; } finally { save.disabled = false; }
  });

  const list = el('div', { className: 'bg-draft' }, draft.exercises.map((exercise) => el('div', { className: 'bg-draft__item', dataset: { id: exercise.id } },
    el('button', { type: 'button', className: 'bg-draft__grip', 'aria-label': `Riordina ${exercise.title}: trascina oppure usa le frecce su e giù` }, icon('grip')),
    el('button', { type: 'button', className: 'bg-draft__body', onClick: () => onOpenExercise(exercise) },
      el('span', { className: 'bg-draft__name', text: exercise.title }),
      el('span', { className: 'bg-draft__meta', text: kindLabel(exercise) })),
    el('span', { className: 'bg-draft__tag', text: targetLabel(exercise) }),
    el('button', {
      type: 'button', className: 'bg-draft__del', 'aria-label': `Rimuovi ${exercise.title}`,
      onClick: () => { draft.exercises = draft.exercises.filter((item) => item !== exercise); draft.dirty = true; rerender(); },
    }, icon('trash', { small: true })))));
  enableReorder(list, draft, (focusId) => { draft.dirty = true; rerender(focusId); });

  const count = draft.exercises.length;
  root.replaceChildren(
    topBar({ title: editing ? 'Modifica scheda' : 'Nuova scheda', onBack: onClose, backIcon: 'close', backLabel: 'Chiudi senza salvare' }),
    el('main', {},
      el('div', { className: 'bg-exhead' },
        el('p', { className: 'bg-exhead__over', text: 'Scheda' }),
        el('h1', { text: editing ? 'Modifica la scheda' : 'Crea la tua scheda' }),
        el('p', { className: 'bg-exhead__lead', text: 'Dai un nome alla scheda e aggiungi gli esercizi nell\'ordine in cui li farai.' })),
      el('div', { className: 'bg-fgroup' }, el('label', { className: 'bg-flabel', for: 'workoutNameInput', text: 'Nome scheda' }), name),
      el('div', { className: 'bg-blocktitle bg-blocktitle--compact' }, el('h2', { text: 'Esercizi' }), count ? el('span', { text: `${count} ${count === 1 ? 'esercizio' : 'esercizi'}` }) : null),
      count ? list : emptyState('Nessun esercizio ancora.\nAggiungi il primo per poter salvare la scheda.'),
      el('button', { type: 'button', className: 'bg-addex', onClick: onAddExercise }, icon('plus', { small: true }), 'Aggiungi esercizio'),
      error,
      editing && onDelete ? el('div', { className: 'bg-workout-actions' }, link({ label: 'Elimina scheda', onClick: onDelete })) : null));
  root.querySelector('.bg-workout-actions .bg-link')?.classList.add('bg-link--danger');
  dock.replaceChildren(el('div', { className: 'bg-dock' }, save));
  syncSave();
}
