// Schermate dedicate al Pilates: nuovo esercizio a tempo (PilatesNewSessionScreen),
// timer dell'esercizio (PilatesExerciseScreen) e riepilogo (PilatesSummaryScreen).
// In Pilates non compaiono mai kg, serie o ripetizioni.
import { el, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { DEFAULT_PAUSE, EQUIPMENT, LEVELS, clockText, exerciseMeta, isoWeek, parseClock } from '../pilates.js';
import { formatDuration } from '../workout-summary.js';

const SVG = 'http://www.w3.org/2000/svg';

function stepper({ id, label, value, unit, onStep }) {
  const input = el('input', { id, inputmode: 'numeric', value, 'aria-label': label, autocomplete: 'off' });
  const arrow = (direction, name, text) => el('button', { type: 'button', 'aria-label': text, onClick: () => { input.value = onStep(input.value, direction); } }, icon(name, { small: true }));
  const box = el('div', { className: 'bg-stepper' }, input, el('span', { className: 'bg-stepper__unit', text: unit }),
    el('span', { className: 'bg-stepper__btns' }, arrow(1, 'chevronUp', 'Aumenta'), arrow(-1, 'chevronDown', 'Diminuisci')));
  return { box, input };
}

export function levelBars(level) {
  return el('span', { className: 'bg-level', 'aria-label': `Livello ${level} di 3` },
    [1, 2, 3].map((step) => el('i', { className: step <= level ? 'on' : '' })));
}

// ——— Nuovo esercizio ———————————————————————————————————————————————————————————
export function renderPilatesExerciseForm(root, dock, { workoutTitle, exercise, referenceName, names = [], onBack, onSave }) {
  // Nomi già usati suggeriti mentre si scrive (stesso esercizio = stesso storico).
  const suggestions = el('datalist', { id: 'pilatesNames' }, names.map((value) => el('option', { value })));
  const name = el('input', { id: 'pilatesName', className: 'bg-input', placeholder: 'Es. The Hundred, Roll Up', maxlength: 60, autocomplete: 'off', list: 'pilatesNames', value: exercise?.title ?? null });
  // Durata a passi di 15 s (min:sec); pausa a passi di 5 s.
  const duration = stepper({
    id: 'pilatesDuration', label: 'Durata', unit: 'min', value: clockText(exercise?.seconds ?? 180),
    onStep: (text, direction) => clockText(Math.min(3600, Math.max(15, (parseClock(text) ?? 180) + direction * 15))),
  });
  const pause = stepper({
    id: 'pilatesPause', label: 'Pausa dopo', unit: 'sec', value: String(exercise?.pauseSeconds ?? DEFAULT_PAUSE),
    onStep: (text, direction) => String(Math.min(600, Math.max(0, (Number(text) || 0) + direction * 5))),
  });
  let level = exercise?.level ?? 1;
  const levels = el('div', { className: 'bg-seg bg-seg--form', role: 'radiogroup', 'aria-label': 'Livello' },
    [1, 2, 3].map((value) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(value === level), 'aria-selected': String(value === level), dataset: { level: String(value) }, text: `${value} · ${LEVELS[value]}` })));
  levels.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    level = Number(button.dataset.level);
    for (const item of levels.children) {
      const on = item === button;
      item.setAttribute('aria-checked', String(on));
      item.setAttribute('aria-selected', String(on));
    }
  });
  let equipment = exercise?.equipment ?? 'Mat';
  const chips = el('div', { className: 'bg-chips bg-chips--wrap', role: 'radiogroup', 'aria-label': 'Attrezzo' },
    EQUIPMENT.map((item) => el('button', { type: 'button', className: 'bg-fchip', role: 'radio', 'aria-checked': String(item === equipment), 'aria-pressed': String(item === equipment), text: item })));
  chips.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    equipment = button.textContent;
    for (const item of chips.children) {
      const on = item === button;
      item.setAttribute('aria-pressed', String(on));
      item.setAttribute('aria-checked', String(on));
    }
  });
  const howTo = el('textarea', { id: 'pilatesHowTo', className: 'bg-textarea', placeholder: 'Respirazione, posizione, cosa sentire', maxlength: 1000 });
  howTo.value = exercise?.howTo ?? '';
  const file = el('input', { type: 'file', accept: 'video/*', hidden: true });
  const fileState = el('span', { className: 'bg-upload__state', text: referenceName ?? 'Nessun video selezionato' });
  file.addEventListener('change', () => { fileState.textContent = file.files?.[0]?.name ?? 'Nessun video selezionato'; });
  const progress = el('p', { className: 'bg-note', role: 'status', hidden: true });
  const error = el('p', { className: 'bg-formstatus bg-formstatus--error', role: 'alert', hidden: true });
  const save = el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--primary' }, 'Salva esercizio', icon('arrowRight', { small: true }));

  const fail = (message) => { error.textContent = message; error.hidden = !message; };
  save.addEventListener('click', async () => {
    const title = name.value.trim();
    const seconds = parseClock(duration.input.value);
    const pauseSeconds = Number(pause.input.value);
    if (!title) { fail('Inserisci il nome dell’esercizio.'); name.focus(); return; }
    if (seconds === null || seconds < 10 || seconds > 3600) { fail('Scrivi la durata in minuti e secondi, per esempio 3:00.'); duration.input.focus(); return; }
    if (!Number.isInteger(pauseSeconds) || pauseSeconds < 0 || pauseSeconds > 600) { fail('La pausa va da 0 a 600 secondi.'); pause.input.focus(); return; }
    await onSave({ title, seconds, pauseSeconds, level, equipment, howTo: howTo.value.trim() }, file.files?.[0] ?? null, {
      button: save, fail,
      report: (text) => { progress.hidden = false; progress.textContent = text; },
      done: () => { progress.hidden = true; },
    });
  });

  root.replaceChildren(
    topBar({ title: workoutTitle.trim() || 'Nuova sequenza', onBack, backLabel: 'Torna alla sequenza' }),
    el('main', {},
      el('div', { className: 'bg-exhead' },
        el('p', { className: 'bg-exhead__over', text: 'Esercizio' }),
        el('h1', { text: exercise ? 'Modifica esercizio' : 'Nuovo esercizio' }),
        el('p', { className: 'bg-exhead__lead', text: 'Gli esercizi Pilates sono a tempo.' })),
      el('div', { className: 'bg-fgroup' }, el('label', { className: 'bg-flabel', for: 'pilatesName', text: 'Nome esercizio' }), name, suggestions),
      el('div', { className: 'bg-fgroup' }, el('div', { className: 'bg-pair2' },
        el('div', {}, el('label', { className: 'bg-flabel', for: 'pilatesDuration', text: 'Durata' }), duration.box),
        el('div', {}, el('label', { className: 'bg-flabel', for: 'pilatesPause', text: 'Pausa dopo' }), pause.box))),
      el('div', { className: 'bg-fgroup' }, el('span', { className: 'bg-flabel', text: 'Livello' }), levels),
      el('div', { className: 'bg-fgroup' }, el('span', { className: 'bg-flabel', text: 'Attrezzo' }), chips),
      el('div', { className: 'bg-fgroup' }, el('label', { className: 'bg-flabel', for: 'pilatesHowTo' }, 'Come farlo', el('small', { text: 'facoltativo' })), howTo),
      el('section', { className: 'bg-upload' },
        el('h3', {}, 'Video di riferimento personale', el('small', { text: 'facoltativo' })),
        el('p', { text: 'Carica una breve ripresa dell\'esercizio. Verrà usata per confrontare postura e allineamento nei tuoi video futuri.' }),
        el('button', { type: 'button', className: 'bg-upload__btn', onClick: () => file.click() }, icon('plus', { small: true }), 'Scegli video di riferimento'),
        fileState, file),
      progress, error,
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
  dock.replaceChildren(el('div', { className: 'bg-dock' }, save));
}

// ——— Timer dell'esercizio ——————————————————————————————————————————————————————
const RADIUS = 100;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function bigRing() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 220 220');
  svg.setAttribute('aria-hidden', 'true');
  const circle = (className) => {
    const node = document.createElementNS(SVG, 'circle');
    for (const [key, value] of Object.entries({ class: className, cx: 110, cy: 110, r: RADIUS })) node.setAttribute(key, value);
    svg.append(node);
    return node;
  };
  circle('bg-bigring__track');
  const progress = circle('bg-bigring__prog');
  progress.setAttribute('stroke-dasharray', CIRCUMFERENCE.toFixed(1));
  return { svg, progress };
}

const shortDay = (time) => {
  const text = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' }).format(time);
  return text.charAt(0).toLocaleUpperCase('it') + text.slice(1);
};

// Blocco centrale dell'esercizio: anello col tempo rimanente, Pausa/Riprendi/Avvia e Fatto,
// durata/livello/attrezzo, «Come farlo» e le ultime volte (data · durata · livello).
export function renderPilatesBlock(root, { exercise, history, state, onStart, onPause, onResume, onDone }) {
  const { svg, progress } = bigRing();
  const time = el('b', { text: clockText(exercise.seconds) });
  const caption = el('span', { text: `su ${clockText(exercise.seconds)}` });
  const ring = el('div', { className: 'bg-bigring', role: 'timer', 'aria-label': `Tempo dell'esercizio ${exercise.title}` }, svg, el('div', { className: 'bg-bigring__in' }, time, caption));
  const play = el('div', { className: 'bg-play' });
  const drawButtons = (mode) => {
    const main = mode === 'running'
      ? el('button', { type: 'button', className: 'bg-btn bg-btn--outline', onClick: onPause }, icon('pause'), 'Pausa')
      : mode === 'paused'
        ? el('button', { type: 'button', className: 'bg-btn bg-btn--outline', onClick: onResume }, icon('play'), 'Riprendi')
        : el('button', { type: 'button', className: 'bg-btn bg-btn--outline', onClick: onStart }, icon('play'), 'Avvia');
    const done = mode === 'done'
      ? el('button', { type: 'button', className: 'bg-btn bg-btn--outline bg-btn--disabled', disabled: true }, icon('check', { small: true }), 'Fatto')
      : el('button', { type: 'button', className: 'bg-btn bg-btn--primary', onClick: onDone }, icon('check', { small: true }), 'Fatto');
    play.replaceChildren(...(mode === 'done' ? [main, done] : [main, done]));
  };

  const rows = history.slice(-3).reverse().map((entry) => el('tr', {},
    el('td', { text: shortDay(entry.endedAt ?? entry.startedAt ?? Date.now()) }),
    el('td', {}, el('b', { text: clockText(entry.rows[0]?.seconds ?? 0) })),
    el('td', {}, levelBars(entry.rows[0]?.level ?? exercise.level))));

  root.replaceChildren(...[
    ring, play,
    el('div', { className: 'bg-stats bg-stats--pilates' },
      el('div', { className: 'bg-stat' }, el('b', { text: clockText(exercise.seconds) }), el('span', { text: 'durata' })),
      el('div', { className: 'bg-stat' }, el('b', {}, levelBars(exercise.level)), el('span', { text: `livello ${exercise.level}` })),
      el('div', { className: 'bg-stat' }, el('b', { text: exercise.equipment }), el('span', { text: 'attrezzo' }))),
    exercise.howTo ? [
      el('div', { className: 'bg-blocktitle' }, el('h2', { text: 'Come farlo' })),
      el('div', { className: 'bg-tips', text: exercise.howTo }),
    ] : null,
    el('div', { className: 'bg-blocktitle' }, el('h2', { text: 'Ultime volte' }), el('span', { text: exercise.title })),
    rows.length
      ? el('table', { className: 'bg-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Data' }), el('th', { text: 'Durata' }), el('th', { text: 'Livello' }))),
        el('tbody', {}, rows))
      : el('p', { className: 'bg-empty', text: 'Prima volta con questo esercizio.' }),
  ].flat().filter(Boolean));

  const view = {
    update({ remaining, total, mode }) {
      time.textContent = clockText(Math.ceil(remaining / 1000));
      caption.textContent = mode === 'idle' ? `su ${clockText(total / 1000)}` : mode === 'done' ? 'fatto' : `rimanenti su ${clockText(total / 1000)}`;
      progress.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - remaining / total)).toFixed(1));
      if (view.mode !== mode) { view.mode = mode; drawButtons(mode); }
    },
    mode: null,
  };
  view.update(state);
  return view;
}

// ——— Riepilogo di fine sessione ————————————————————————————————————————————————
export function renderPilatesSummary(root, dock, { workout, summary, name, celebrate, confetti, date, published, onDone, onPublish }) {
  const delta = summary.weekDelta;
  const deltaText = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} min`;
  const stats = el('div', { className: 'bg-stats' },
    el('div', { className: 'bg-stat' }, el('b', { text: `${summary.exercisesDone}/${summary.exercisesTotal}` }), el('span', { text: 'esercizi' }), el('em', { text: 'completati' })),
    el('div', { className: 'bg-stat' }, el('b', { text: String(summary.weekMinutes) }), el('span', { text: 'min questa settimana' }),
      summary.previousWeekMinutes ? el('em', { text: deltaText }) : el('em', { text: ' ' })),
    el('div', { className: 'bg-stat' }, el('b', { text: String(summary.daysInRow) }), el('span', { text: summary.daysInRow === 1 ? 'giorno di fila' : 'giorni di fila' }), el('em', { text: ' ' })));

  const milestones = (summary.milestones ?? []).map((item) => el('div', { className: 'bg-pr' },
    el('span', { className: 'bg-pr__ic' }, icon('star')),
    el('span', {}, el('small', { text: 'Nuovo traguardo' }), el('b', { text: item.title }))));

  const endedAt = summary.endedAt ?? Date.now();
  const top = Math.max(summary.weekMinutes, summary.previousWeekMinutes) || 1;
  const width = (value) => `${Math.round(value / top * 90)}%`;
  const comparison = summary.previousWeekMinutes ? [
    el('div', { className: 'bg-blocktitle bg-blocktitle--summary' }, el('h2', { text: 'Rispetto alla settimana scorsa' })),
    el('div', { className: 'bg-cmp' },
      el('div', { className: 'bg-cmp__row' }, el('span', { text: `Sett. ${isoWeek(endedAt - 7 * 86_400_000)}` }),
        el('span', { className: 'bg-cmp__bar' }, el('i', { style: `width:${width(summary.previousWeekMinutes)}` })), el('b', { text: String(summary.previousWeekMinutes) })),
      el('div', { className: 'bg-cmp__row bg-cmp__row--now' }, el('span', { text: 'Questa' }),
        el('span', { className: 'bg-cmp__bar' }, el('i', { style: `width:${width(summary.weekMinutes)}` })), el('b', { text: String(summary.weekMinutes) })),
      el('span', { className: 'bg-cmp__note' }, 'Minuti di pratica · ', el('b', { text: deltaText }))),
  ] : [el('p', { className: 'bg-empty bg-empty--spaced', text: 'Prima settimana di pratica: la prossima vedrai il confronto.' })];

  const rows = summary.exercises.map((item) => el('div', { className: 'bg-exrow' },
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: item.title }),
      el('span', { className: 'bg-exrow__meta', text: item.seconds ? `${clockText(item.seconds)} · livello ${item.level}` : 'non svolto' })),
    item.seconds
      ? item.levelUp
        ? el('span', { className: 'bg-delta' }, icon('arrowUp', { small: true }), 'livello')
        : el('span', { className: 'bg-delta bg-delta--flat', text: item.seconds >= item.planned ? 'completo' : 'parziale' })
      : null));

  root.replaceChildren(
    celebrate ? confetti() : '',
    el('main', {},
      el('div', { className: 'bg-sumhead' },
        el('div', { className: 'bg-sumhead__badge' }, icon('check')),
        el('p', { className: 'bg-sumhead__over', text: `${workout.title} · ${date ?? 'completata'}` }),
        el('h1', { text: name ? `Fatto, ${name}.` : 'Fatto.' })),
      el('div', { className: 'bg-bigtime' }, formatDuration(summary.duration), el('small', { text: 'durata sessione' })),
      stats,
      milestones,
      comparison,
      el('div', { className: 'bg-blocktitle bg-blocktitle--rows' }, el('h2', { text: 'Esercizio per esercizio' })),
      el('div', { className: 'bg-exlist' }, rows),
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
  const publish = published
    ? el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--disabled', disabled: true }, 'Pubblicato ✓')
    : el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--primary', onClick: onPublish }, icon('share', { small: true }), 'Pubblica');
  dock.replaceChildren(el('div', { className: 'bg-dock bg-dock--split' },
    el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--outline', text: 'Fine', onClick: onDone }),
    publish));
}

export { exerciseMeta };
