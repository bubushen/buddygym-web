// EndWorkoutSheet: conferma prima di terminare l'allenamento.
import { button, el, openSheet } from '../ui/components.js';
import { icon } from '../ui/icons.js';

export function openEndWorkoutSheet({ workoutTitle, duration, check, onEnd, onContinue }) {
  const stat = (value, label) => el('div', {}, el('b', { text: value }), el('span', { text: label }));
  const end = button({ label: 'Termina e vedi il riepilogo' });
  const keep = button({ label: 'Continua ad allenarti', variant: 'outline' });
  const view = openSheet({
    label: 'Terminare l\'allenamento?',
    onDismiss: onContinue,
    content: el('div', { className: 'bg-sheet__body' },
      el('div', {},
        el('h2', { text: 'Terminare l\'allenamento?' }),
        el('p', { text: check.complete ? `Hai completato tutta la scheda ${workoutTitle}.` : 'Non hai finito tutti gli esercizi.' })),
      el('div', { className: 'bg-sheet__stats' },
        stat(duration, 'durata'),
        stat(`${check.done}/${check.total}`, 'esercizi'),
        stat(String(check.sets), 'serie')),
      check.warning ? el('div', { className: 'bg-sheet__warn' }, icon('info', { small: true }), el('span', { text: check.warning })) : null,
      el('div', { className: 'bg-sheet__actions' }, end, keep)),
  });
  end.addEventListener('click', () => { view.close(); onEnd(); });
  keep.addEventListener('click', () => { view.close(); onContinue?.(); });
  return view;
}
