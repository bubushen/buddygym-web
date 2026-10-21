// WelcomeSplitScreen (primo avvio: Palestra sopra, Pilates sotto) e il selettore
// della modalità in Account (ModePickerScreen).
import { el } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const SVG = 'http://www.w3.org/2000/svg';
// Icone grandi su griglia 48, tratto 2.4: muscolo (Palestra) e pesetto da Pilates.
const BIG_ICONS = {
  gym: ['M5 41h24c6.5 0 10.5-4.5 9.5-11L36 15', 'M36 15c1.6-1.2 2.2-3.4 1.4-5.4-1-2.4-3.8-3.4-6.2-2.6l-4.4 1.6c-1.8.7-2.6 2.8-1.6 4.5l1.8 3.1', 'M27 16.2L25.5 25', 'M5 31c3.5-3 8.5-3.8 12.5-2 1.8-4.6 7.6-6 11.2-3 2.4 2 3 5.4 1.6 8'],
  pilates: ['M19.8 28.2l8.4-8.4'],
};

function bigIcon(mode) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'bg-split__icon');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  if (mode === 'pilates') {
    for (const [cx, cy] of [[14.5, 33.5], [33.5, 14.5]]) {
      const circle = document.createElementNS(SVG, 'circle');
      for (const [key, value] of Object.entries({ cx, cy, r: 7.5 })) circle.setAttribute(key, value);
      svg.append(circle);
    }
  }
  for (const d of BIG_ICONS[mode]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function renderWelcome(root, { onChoose, onLogin }) {
  const half = (mode, label, theme) => {
    const button = el('button', { type: 'button', className: `bg-split__half bg-split__half--${mode === 'gym' ? 'gym' : 'pil'}`, 'aria-label': label },
      bigIcon(mode), el('span', { className: 'bg-split__label', text: label }));
    const wrap = el('div', { className: 'bg-split__wrap', dataset: { theme } }, button);
    // Il tocco allarga la metà scelta a tutto schermo (300 ms), poi la registrazione.
    button.addEventListener('click', () => {
      if (root.dataset.choosing) return;
      root.dataset.choosing = mode;
      const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => { delete root.dataset.choosing; onChoose(mode); }, reduce ? 0 : 300);
    });
    return wrap;
  };
  root.replaceChildren(el('div', { className: 'bg-split' },
    half('gym', 'Palestra', 'dark'),
    half('pilates', 'Pilates', 'pilates'),
    el('span', { className: 'bg-split__brand', 'aria-hidden': 'true', text: 'BUDDY' }),
    el('div', { className: 'bg-split__login', dataset: { theme: 'pilates' } }, 'Hai già un account? ',
      el('button', { type: 'button', className: 'bg-split__loginlink', onClick: onLogin, text: 'Accedi' }))));
}

// Sezione «Modalità» in Account: Palestra | Pilates, disattivata durante una sessione.
export function modePicker({ mode, locked, onChange }) {
  const options = [['gym', 'Palestra', 'dumbbell'], ['pilates', 'Pilates', 'pilates']];
  const group = el('div', { className: 'bg-modeseg', role: 'radiogroup', 'aria-label': 'Modalità' },
    options.map(([value, label, glyph]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(mode === value), disabled: locked,
      onClick: (event) => { if (mode !== value) onChange(value, { x: event.clientX, y: event.clientY }); },
    }, icon(glyph, { small: true }), label)));
  const other = mode === 'pilates' ? 'Palestra' : 'Pilates';
  return [
    el('h2', { className: 'bg-section', text: 'Modalità' }),
    group,
    el('p', { className: 'bg-note bg-modeseg__note', text: locked
      ? 'Termina la sessione in corso per cambiare modalità.'
      : `Cambia colori, ${mode === 'pilates' ? 'sequenze' : 'schede'} e statistiche. I dati di ${other} restano salvati.` }),
  ];
}
