// Componenti del design system BuddyGym, costruiti come elementi DOM.
// Gli stili sono in src/ui/components.css e usano solo i token di src/theme.css.
import { icon } from './icons.js';
import { isPilates } from '../mode.js';

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

// AppBar: account a sinistra, logotipo (o titolo della sezione) al centro, a destra
// l'azione primaria (+) oppure un'altra azione della sezione.
export function appBar({ initial, onAccount, onAdd, addLabel = 'Aggiungi scheda', showAdd = true, title = null, action = null }) {
  const account = el('button', { type: 'button', className: 'bg-avatar', 'aria-label': 'Il tuo account', onClick: onAccount },
    initial ? initial : icon('person'));
  const brand = title
    ? el('span', { className: 'bg-appbar__brand', text: title })
    : el('span', { className: 'bg-appbar__brand' }, 'Buddy', el('span', { text: isPilates() ? 'Pilates' : 'Gym' }));
  const add = action ?? (showAdd
    ? el('button', { type: 'button', className: 'bg-iconbtn bg-iconbtn--primary', 'aria-label': addLabel, onClick: onAdd }, icon('plus'))
    : el('span', { className: 'bg-appbar__spacer' }));
  return el('header', { className: 'bg-appbar' }, account, brand, add);
}

// Top bar delle pagine interne: indietro (o chiudi), titolo centrato.
export function topBar({ title, onBack, backLabel = 'Indietro', backIcon = 'back' }) {
  return el('header', { className: 'bg-topbar' },
    el('button', { type: 'button', className: 'bg-iconbtn', 'aria-label': backLabel, onClick: onBack }, icon(backIcon)),
    el('span', { className: 'bg-topbar__title', text: title }),
    el('span'));
}

export function pageHead({ title, subtitle }) {
  return el('div', { className: 'bg-pagehead' }, el('h1', { text: title }), subtitle ? el('p', { text: subtitle }) : null);
}

const TABS = [
  { id: 'schede', label: 'Schede', icon: 'dumbbell' },
  { id: 'storico', label: 'Storico', icon: 'history' },
  { id: 'nutrizione', label: 'Nutrizione', icon: 'apple' },
  { id: 'coaching', label: 'Coaching', icon: 'chat' },
  { id: 'social', label: 'Social', icon: 'people' },
];

// TabBar: cinque sezioni sempre visibili, con le etichette. Voce attiva con pill e
// aria-current; il Social può avere un pallino per nuovi commenti o «Forza».
// In Pilates la prima voce è Sequenze, con l'icona Pilates; le altre restano uguali.
export function tabBar({ current, onSelect, dots = {} }) {
  const tabs = isPilates() ? [{ id: 'schede', label: 'Sequenze', icon: 'pilates' }, ...TABS.slice(1)] : TABS;
  return el('nav', { className: 'bg-tabbar', 'aria-label': 'Navigazione principale' },
    tabs.map((tab) => el('button', {
      type: 'button',
      className: 'bg-tab',
      'aria-current': tab.id === current ? 'page' : null,
      'aria-label': dots[tab.id] ? `${tab.label}, novità` : null,
      onClick: () => onSelect(tab.id),
    }, el('span', { className: 'bg-tab__pill' }, icon(tab.icon), dots[tab.id] ? el('span', { className: 'bg-tab__dot' }) : null), tab.label)));
}

// WorkoutCard: variante standard (chevron, piede "Ultima volta") o "next"
// (fondo highlight, CTA "Inizia allenamento"). Tutta la card apre la scheda.
export function workoutCard({ title, overline, meta = [], foot, next = false, onOpen, onStart, ctaLabel = 'Inizia allenamento' }) {
  const metaItems = meta.map((item) => el('span', {}, icon(item.icon, { small: true }), item.text));
  const card = el('article', { className: `bg-card${next ? ' bg-card--next' : ''}` },
    next ? null : icon('chevronRight', { className: 'bg-card__chev' }),
    overline ? el('p', { className: 'bg-card__over', text: overline }) : null,
    el('h3', { className: 'bg-card__title' },
      el('button', { type: 'button', className: 'bg-card__link', onClick: onOpen, text: title })),
    metaItems.length ? el('div', { className: 'bg-card__meta' }, metaItems) : null,
    next
      ? el('button', { type: 'button', className: 'bg-btn bg-btn--on-highlight', onClick: (event) => { event.stopPropagation(); onStart?.(); }, text: ctaLabel })
      : (foot ? el('div', { className: 'bg-card__foot' }, el('span', { text: foot })) : null));
  // Il pulsante del titolo copre tutta la card (area di tocco e nome accessibile).
  return card;
}

// Pulsanti a tutta larghezza: primary, google, outline; link per le azioni minori.
export function button({ label, variant = 'primary', block = true, type = 'button', onClick, iconAfter, iconBefore, disabled = false }) {
  const className = `bg-btn${block ? ' bg-btn--block' : ''} bg-btn--${variant}${disabled ? ' bg-btn--disabled' : ''}`;
  return el('button', { type, className, onClick, 'aria-disabled': disabled ? 'true' : null },
    variant === 'google' ? googleLogo() : (iconBefore ? icon(iconBefore, { small: true }) : null),
    label,
    iconAfter ? icon(iconAfter, { small: true }) : null);
}

export function link({ label, onClick, href }) {
  return href
    ? el('a', { className: 'bg-link', href, text: label })
    : el('button', { type: 'button', className: 'bg-link', onClick, text: label });
}

// Logo Google ufficiale a colori: l'unica eccezione alla palette.
function googleLogo() {
  const template = document.createElement('template');
  template.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  return template.content.firstElementChild;
}

// TextField: etichetta sempre visibile, icona a sinistra, helper o errore sotto.
// I campi password hanno l'occhio per mostrare il testo.
export function textField({ id, label, type = 'text', icon: iconName, placeholder, help, autocomplete, inputmode, required = false, value = '' }) {
  const input = el('input', { id, type, placeholder, autocomplete, inputmode, required, value: value || null });
  const helpNode = el('span', { className: 'bg-field__help', id: `${id}-help`, hidden: !help });
  if (help) helpNode.textContent = help;
  if (help) input.setAttribute('aria-describedby', helpNode.id);
  const box = el('span', { className: 'bg-field__box' }, iconName ? icon(iconName, { small: true }) : null, input);
  if (type === 'password') {
    const toggle = el('button', { type: 'button', className: 'bg-field__toggle', 'aria-label': 'Mostra password', 'aria-pressed': 'false' }, icon('eye'));
    toggle.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.setAttribute('aria-pressed', String(!showing));
      toggle.setAttribute('aria-label', showing ? 'Mostra password' : 'Nascondi password');
    });
    box.append(toggle);
  }
  const field = el('label', { className: 'bg-field', for: id }, el('span', { className: 'bg-field__label', text: label }), box, helpNode);
  // Errore: bordo e messaggio in danger, sempre con l'icona di avviso.
  field.setError = (message) => {
    field.classList.toggle('bg-field--error', !!message);
    helpNode.replaceChildren();
    if (message) {
      helpNode.append(icon('alert', { small: true }), message);
      helpNode.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', helpNode.id);
    } else {
      input.removeAttribute('aria-invalid');
      if (help) helpNode.textContent = help;
      helpNode.hidden = !help;
    }
  };
  field.input = input;
  return field;
}

export function emptyState(text) {
  return el('p', { className: 'bg-empty', text });
}

// TimerBar: tempo che scorre e stop. Toccando la barra si torna all'allenamento.
export function timerBar({ label, time, onOpen, onStop }) {
  const value = el('span', { className: 'bg-timerbar__time', text: time });
  const bar = el('div', { className: 'bg-timerbar', role: 'timer', 'aria-label': 'Durata allenamento' },
    el('button', { type: 'button', className: 'bg-timerbar__open', 'aria-label': `Apri l’allenamento in corso: ${label}`, onClick: onOpen },
      el('span', { className: 'bg-timerbar__dot' }),
      el('span', { className: 'bg-timerbar__label', text: label }),
      value),
    el('button', { type: 'button', className: 'bg-timerbar__btn', 'aria-label': 'Termina allenamento', onClick: onStop }, icon('stop')));
  bar.setTime = (text) => { value.textContent = text; };
  return bar;
}

// Foglio che sale dal basso con velo scuro dietro. Si chiude toccando il velo,
// con Esc o trascinandolo giù: equivale sempre all'azione «annulla» (onDismiss).
export function openSheet({ label, content, onDismiss }) {
  const slot = document.querySelector('#sheetSlot');
  const previousFocus = document.activeElement;
  const scrim = el('div', { className: 'bg-scrim' });
  const grab = el('span', { className: 'bg-sheet__grab', 'aria-hidden': 'true' });
  const sheet = el('div', { className: 'bg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' }, grab, content);
  let closed = false;
  const close = (dismissed) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    slot.replaceChildren();
    previousFocus?.focus?.({ preventScroll: true });
    if (dismissed) onDismiss?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(true); };
  scrim.addEventListener('click', () => close(true));
  document.addEventListener('keydown', onKey);
  // Trascinare la maniglia (o il bordo alto) verso il basso chiude il foglio.
  let startY = null;
  sheet.addEventListener('pointerdown', (event) => {
    if (event.target !== grab && event.offsetY > 32) return;
    startY = event.clientY;
    sheet.setPointerCapture(event.pointerId);
  });
  sheet.addEventListener('pointermove', (event) => {
    if (startY === null) return;
    sheet.style.translate = `0 ${Math.max(0, event.clientY - startY)}px`;
  });
  sheet.addEventListener('pointerup', (event) => {
    if (startY === null) return;
    const moved = event.clientY - startY;
    startY = null;
    sheet.style.translate = '';
    if (moved > 80) close(true);
  });
  slot.replaceChildren(scrim, sheet);
  sheet.focus({ preventScroll: true });
  return { close: () => close(false), sheet };
}
