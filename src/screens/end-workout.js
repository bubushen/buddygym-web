// EndWorkoutSheet: conferma prima di terminare l'allenamento.
import { button, el, openSheet } from '../ui/components.js';
import { icon } from '../ui/icons.js';

// In Pilates: «sessione», sequenza e minuti di pratica al posto delle serie.
export function openEndWorkoutSheet({ workoutTitle, duration, check, pilates = false, onEnd, onContinue }) {
  const stat = (value, label) => el('div', {}, el('b', { text: value }), el('span', { text: label }));
  const question = pilates ? 'Terminare la sessione?' : 'Terminare l\'allenamento?';
  const end = button({ label: 'Termina e vedi il riepilogo' });
  const keep = button({ label: pilates ? 'Continua la sessione' : 'Continua ad allenarti', variant: 'outline' });
  const view = openSheet({
    label: question,
    onDismiss: onContinue,
    content: el('div', { className: 'bg-sheet__body' },
      el('div', {},
        el('h2', { text: question }),
        el('p', { text: check.complete ? `Hai completato tutta la ${pilates ? 'sequenza' : 'scheda'} ${workoutTitle}.` : 'Non hai finito tutti gli esercizi.' })),
      el('div', { className: 'bg-sheet__stats' },
        stat(duration, 'durata'),
        stat(`${check.done}/${check.total}`, 'esercizi'),
        pilates ? stat(String(check.minutes), 'minuti') : stat(String(check.sets), 'serie')),
      check.warning ? el('div', { className: 'bg-sheet__warn' }, icon('info', { small: true }), el('span', { text: check.warning })) : null,
      el('div', { className: 'bg-sheet__actions' }, end, keep)),
  });
  end.addEventListener('click', () => { view.close(); onEnd(); });
  keep.addEventListener('click', () => { view.close(); onContinue?.(); });
  return view;
}
