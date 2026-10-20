// WorkoutSummaryFinal: trofeo all'apertura, confronto scorrendo, «Fine» in basso.
import { el } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { formatDuration } from '../workout-summary.js';

const thousands = (value) => {
  const [whole, decimals] = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: false }).format(value).split(',');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decimals ? `,${decimals}` : ''}`;
};
const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${thousands(Math.abs(value))}`;
const dayName = (timestamp) => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric' }).format(timestamp);
const shortDay = (timestamp) => {
  const text = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' }).format(timestamp);
  return text.charAt(0).toLocaleUpperCase('it') + text.slice(1);
};

// Coriandoli dai due lati, 22 pezzi per lato, una volta sola.
export function confetti() {
  const box = el('div', { className: 'bg-confetti', 'aria-hidden': 'true' });
  const random = (min, max) => min + Math.random() * (max - min);
  for (const side of ['l', 'r']) {
    const sign = side === 'l' ? 1 : -1;
    for (let index = 0; index < 22; index += 1) {
      const piece = el('i', { className: `${side} c${1 + Math.floor(Math.random() * 4)}${Math.random() < 0.35 ? ' disc' : ''}` });
      const x1 = random(50, 206);
      piece.style.cssText = `--x1:${sign * x1}px;--y1:${-random(140, 400)}px;--x2:${sign * x1 * random(1.3, 1.8)}px;--y2:${random(120, 380)}px;--r:${(Math.random() < 0.5 ? -1 : 1) * random(250, 900)}deg;--d:${random(0, 0.32).toFixed(2)}s`;
      box.append(piece);
    }
  }
  // Durata dell'animazione più il ritardo massimo: poi i coriandoli spariscono dalla pagina.
  setTimeout(() => box.remove(), 3200);
  return box;
}

function deltaBadge(delta, unit) {
  if (delta === null) return el('span', { className: 'bg-delta bg-delta--flat', text: 'prima volta' });
  if (delta === 0) return el('span', { className: 'bg-delta bg-delta--flat', text: 'uguale' });
  return el('span', { className: 'bg-delta' }, icon(delta > 0 ? 'arrowUp' : 'arrowDown', { small: true }), `${delta > 0 ? '+' : ''}${thousands(Math.abs(delta))} ${unit}`);
}

export function renderSummary(root, dock, { workout, summary, name, celebrate, date, published, onDone, onPublish }) {
  const allSets = summary.sets >= summary.planned;
  const stats = el('div', { className: 'bg-stats' },
    el('div', { className: 'bg-stat' }, el('b', { text: thousands(summary.volume) }), el('span', { text: 'kg di volume' }),
      summary.volumeChange !== null ? el('em', { text: `${summary.volumeChange > 0 ? '+' : summary.volumeChange < 0 ? '−' : ''}${Math.abs(summary.volumeChange)}%` }) : null),
    el('div', { className: 'bg-stat' }, el('b', { text: String(summary.sets) }), el('span', { text: 'serie' }),
      el('em', { text: allSets ? 'tutte fatte' : `di ${summary.planned} previste` })),
    el('div', { className: 'bg-stat' }, el('b', { text: `${summary.exercisesDone}/${summary.exercisesTotal}` }), el('span', { text: 'esercizi' }),
      el('em', { text: 'completati' })));

  const shown = summary.records.slice(0, 3);
  const records = shown.map((record) => el('div', { className: 'bg-pr' },
    el('span', { className: 'bg-pr__ic' }, icon('trophy')),
    el('span', {}, el('small', { text: 'Nuovo record' }), el('b', { text: `${record.title} · ${thousands(record.load)} kg × ${record.reps}` }))));
  const moreRecords = summary.records.length > 3 ? el('p', { className: 'bg-note bg-note--center', text: `e altri ${summary.records.length - 3}` }) : null;

  let comparison;
  if (summary.previousVolume !== null && summary.previousEnd) {
    const top = Math.max(summary.volume, summary.previousVolume) || 1;
    const width = (value) => `${Math.round(value / top * 94)}%`;
    const difference = summary.volume - summary.previousVolume;
    comparison = [
      el('div', { className: 'bg-blocktitle bg-blocktitle--summary' }, el('h2', { text: `Rispetto a ${dayName(summary.previousEnd)}` })),
      el('div', { className: 'bg-cmp' },
        el('div', { className: 'bg-cmp__row' }, el('span', { text: shortDay(summary.previousEnd) }),
          el('span', { className: 'bg-cmp__bar' }, el('i', { style: `width:${width(summary.previousVolume)}` })), el('b', { text: thousands(summary.previousVolume) })),
        el('div', { className: 'bg-cmp__row bg-cmp__row--now' }, el('span', { text: 'Oggi' }),
          el('span', { className: 'bg-cmp__bar' }, el('i', { style: `width:${width(summary.volume)}` })), el('b', { text: thousands(summary.volume) })),
        el('span', { className: 'bg-cmp__note' }, 'Volume totale in kg · ',
          el('b', { text: `${signed(difference)} kg${summary.volumeChange !== null ? ` (${summary.volumeChange > 0 ? '+' : summary.volumeChange < 0 ? '−' : ''}${Math.abs(summary.volumeChange)}%)` : ''}` }))),
    ];
  } else {
    comparison = [el('p', { className: 'bg-empty bg-empty--spaced', text: 'Prima volta con questa scheda: la prossima volta vedrai il confronto.' })];
  }

  const rows = summary.exercises.map((item) => el('div', { className: 'bg-exrow' },
    el('span', { className: 'bg-exrow__body' },
      el('span', { className: 'bg-exrow__name', text: item.title }),
      el('span', { className: 'bg-exrow__meta', text: item.value === null ? 'non svolto' : `${item.unit === 'min' ? 'tempo massimo' : 'carico massimo'} ${thousands(item.value)} ${item.unit}` })),
    item.value === null ? null : deltaBadge(item.delta, item.unit)));

  root.replaceChildren(
    celebrate ? confetti() : '',
    el('main', {},
      el('div', { className: 'bg-sumhead' },
        el('div', { className: 'bg-sumhead__badge' }, icon('check')),
        // Dallo Storico: la data al posto di «completato».
        el('p', { className: 'bg-sumhead__over', text: `${workout.title} · ${date ?? 'completato'}` }),
        el('h1', { text: name ? `Grande, ${name}.` : 'Grande!' })),
      el('div', { className: 'bg-bigtime' }, summary.duration !== null ? formatDuration(summary.duration) : '—', el('small', { text: 'durata allenamento' })),
      stats,
      records,
      moreRecords,
      comparison,
      el('div', { className: 'bg-blocktitle bg-blocktitle--rows' }, el('h2', { text: 'Esercizio per esercizio' }), el('span', { text: 'carico massimo' })),
      el('div', { className: 'bg-exlist' }, rows),
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
  // Pubblicare è sempre una scelta: Fine chiude, Pubblica apre il pannello per il Social.
  const publish = published
    ? el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--disabled', disabled: true }, 'Pubblicato ✓')
    : el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--primary', onClick: onPublish }, icon('share', { small: true }), 'Pubblica');
  dock.replaceChildren(el('div', { className: 'bg-dock bg-dock--split' },
    el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--outline', text: 'Fine', onClick: onDone }),
    publish));
}
