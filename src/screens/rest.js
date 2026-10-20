// ExerciseRestScreen: pannello in basso al posto delle frecce, con l'anello che si svuota.
import { el } from '../ui/components.js';
import { formatRest } from '../rest-timer.js';

const SVG = 'http://www.w3.org/2000/svg';
const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ring() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('aria-hidden', 'true');
  const circle = (className) => {
    const node = document.createElementNS(SVG, 'circle');
    for (const [key, value] of Object.entries({ class: className, cx: 48, cy: 48, r: RADIUS })) node.setAttribute(key, value);
    svg.append(node);
    return node;
  };
  circle('bg-rest__track');
  const progress = circle('bg-rest__prog');
  progress.setAttribute('stroke-dasharray', CIRCUMFERENCE.toFixed(1));
  return { svg, progress };
}

export function renderRest(panel, { remaining, total, next, detail, onMinus, onPlus, onSkip }) {
  const { svg, progress } = ring();
  const time = el('span', { className: 'bg-rest__time', text: formatRest(remaining) });
  const label = el('p', { className: 'bg-rest__next', text: next });
  const sub = el('p', { className: 'bg-rest__sub', text: detail });
  const buttons = el('div', { className: 'bg-rest__btns' },
    el('button', { type: 'button', className: 'bg-btn bg-btn--outline', 'aria-label': 'Togli 15 secondi', onClick: onMinus, text: '−15 s' }),
    el('button', { type: 'button', className: 'bg-btn bg-btn--outline', 'aria-label': 'Aggiungi 15 secondi', onClick: onPlus, text: '+15 s' }),
    el('button', { type: 'button', className: 'bg-btn bg-btn--primary', onClick: onSkip, text: 'Salta' }));
  panel.replaceChildren(
    el('div', { className: 'bg-rest__top' },
      el('div', { className: 'bg-rest__ring' }, svg, time),
      el('div', {}, el('p', { className: 'bg-rest__over', text: 'Recupero' }), label, sub)),
    buttons);
  panel.hidden = false;
  const view = {
    update(seconds, totalSeconds) {
      time.textContent = formatRest(seconds);
      progress.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - seconds / totalSeconds)).toFixed(1));
    },
    // Fine recupero: «Vai: serie 2» per un momento, senza pulsanti.
    go(text) {
      time.textContent = '0:00';
      progress.setAttribute('stroke-dashoffset', CIRCUMFERENCE.toFixed(1));
      label.textContent = text;
      sub.textContent = '';
      buttons.hidden = true;
    },
  };
  view.update(remaining, total);
  return view;
}
