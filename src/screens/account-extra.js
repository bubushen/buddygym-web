// Schermate dell'account: Password dimenticata (ForgotPasswordScreen), Impostazioni
// (SettingsScreen, dall'ingranaggio dell'Account) ed Elimina account (DeleteAccountScreen).
import { button, el, link, openSheet, textField, topBar } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { passwordProblem } from '../account-rules.js';
import { ADD_ME, PAUSE_CHOICES, REST_CHOICES, THEMES } from '../settings.js';

function hero(name, title, text, { danger = false } = {}) {
  return el('div', { className: 'bg-center' },
    el('div', { className: `bg-hero-ic${danger ? ' bg-hero-ic--danger' : ''}` }, icon(name)),
    el('h1', { text: title }),
    el('p', {}, text));
}

// ——— Password dimenticata ————————————————————————————————————————————————————————
export function renderForgotPassword(root, { email: initial = '', onBack, onSend, onLogin, onGoogle }) {
  let timer = null;
  const showSent = (email) => {
    clearInterval(timer);
    const resend = button({ label: 'Invia di nuovo', variant: 'outline' });
    let left = 45;
    const tick = () => {
      resend.disabled = left > 0;
      resend.classList.toggle('bg-btn--disabled', left > 0);
      resend.firstChild.textContent = left > 0 ? `Invia di nuovo (tra 0:${String(left).padStart(2, '0')})` : 'Invia di nuovo';
      left -= 1;
      if (left < -1) clearInterval(timer);
    };
    resend.replaceChildren(document.createTextNode(''));
    tick();
    timer = setInterval(() => { if (!root.isConnected || root.hidden) { clearInterval(timer); return; } tick(); }, 1000);
    resend.addEventListener('click', async () => { if (left > 0) return; await onSend(email); showSent(email); });
    root.replaceChildren(
      topBar({ title: 'Password dimenticata', onBack }),
      el('main', {},
        // Messaggio identico che l'account esista o no: nessuno scopre chi è iscritto.
        hero('mail', 'Controlla la mail', ['Se esiste un account con ', el('b', { className: 'bg-strong', text: email }), ', ti è arrivato un link valido per 30 minuti. Guarda anche nello spam.']),
        el('div', { className: 'bg-form bg-form--hero' },
          el('a', { className: 'bg-btn bg-btn--block bg-btn--primary', href: 'mailto:', text: 'Apri l\'app Mail' }),
          resend,
          el('p', { className: 'bg-note bg-note--center', text: 'Ti eri registrato con Google? Non hai una password: entra con Google.' }),
          button({ label: 'Continua con Google', variant: 'google', onClick: onGoogle }),
          el('div', { className: 'bg-center-link' }, link({ label: 'Torna all\'accesso', onClick: onLogin })))));
  };
  const email = textField({ id: 'forgotEmail', label: 'Email', type: 'email', icon: 'mail', placeholder: 'nome@email.com', autocomplete: 'email', inputmode: 'email', required: true, value: initial });
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const send = button({ label: 'Invia il link', type: 'submit' });
  const form = el('form', { className: 'bg-form bg-form--hero', noValidate: true }, email, send, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = email.input.value.trim();
    if (!value || !email.input.checkValidity()) { email.setError('Scrivi un indirizzo email valido.'); email.input.focus(); return; }
    email.setError('');
    send.disabled = true;
    try {
      const problem = await onSend(value);
      if (problem) status.textContent = problem; else showSent(value);
    } finally { send.disabled = false; }
  });
  root.replaceChildren(
    topBar({ title: 'Password dimenticata', onBack }),
    el('main', {}, hero('key', 'Recupera l\'accesso', 'Scrivi la mail del tuo account: ti mandiamo un link per scegliere una nuova password.'), form));
}

// ——— Impostazioni ————————————————————————————————————————————————————————————————
function choiceSheet(title, options, current, onPick) {
  const view = openSheet({
    label: title,
    content: el('div', { className: 'bg-sheet__body' },
      el('h2', { text: title }),
      el('div', { className: 'bg-set-list bg-set-list--sheet', role: 'radiogroup', 'aria-label': title }, options.map(([value, label]) => el('button', {
        type: 'button', className: 'bg-srow', role: 'radio', 'aria-checked': String(value === current),
        onClick: () => { view.close(); if (value !== current) onPick(value); },
      }, el('span', { text: label }), value === current ? icon('check', { small: true }) : null)))),
  });
}

function passwordSheet(onSave) {
  const password = textField({ id: 'changePassword', label: 'Nuova password', type: 'password', icon: 'lock', placeholder: 'Crea una password', autocomplete: 'new-password', help: 'Almeno 8 caratteri, con almeno un numero.' });
  const confirm = textField({ id: 'changePasswordConfirm', label: 'Conferma password', type: 'password', icon: 'lock', placeholder: 'Riscrivi la password', autocomplete: 'new-password' });
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const save = button({ label: 'Salva password', type: 'submit' });
  const form = el('form', { className: 'bg-form bg-form--sheet', noValidate: true }, password, confirm, save, status);
  const view = openSheet({ label: 'Cambia password', content: el('div', { className: 'bg-sheet__body' }, el('h2', { text: 'Cambia password' }), form) });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    password.setError(''); confirm.setError('');
    const problem = passwordProblem(password.input.value);
    if (problem) { password.setError(problem); return; }
    if (confirm.input.value !== password.input.value) { confirm.setError('Le password non coincidono.'); return; }
    save.disabled = true;
    try {
      const error = await onSave(password.input.value);
      if (error) status.textContent = error; else view.close();
    } finally { save.disabled = false; }
  });
  password.input.focus();
}

export function renderSettings(root, props) {
  const { settings, mode, modeLocked, privacy, onBack, onSetting, onMode, onPrivacy, onPassword, onSignOut, onDelete } = props;
  const pilates = mode === 'pilates';
  const rerender = () => renderSettings(root, props);
  const row = ({ label, hint, value, onClick, danger = false, disabled = false, chevron = !!onClick }) => el(onClick ? 'button' : 'div', {
    type: onClick ? 'button' : null, className: `bg-srow${danger ? ' bg-srow--danger' : ''}`, onClick, disabled,
  }, el('span', {}, label, hint ? el('small', { text: hint }) : null), value ? el('em', { text: value }) : null, chevron ? icon('chevronRight', { small: true }) : null);
  const toggle = ({ label, hint, checked, onChange, disabled = false }) => {
    const sw = el('button', { type: 'button', className: 'bg-switch', role: 'switch', 'aria-checked': String(checked), 'aria-label': label, disabled });
    sw.addEventListener('click', async () => {
      const value = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(value));
      sw.disabled = true;
      if ((await onChange(value)) === false) sw.setAttribute('aria-checked', String(!value));
      sw.disabled = false;
    });
    return el('div', { className: 'bg-srow' }, el('span', {}, label, hint ? el('small', { text: hint }) : null), sw);
  };
  const set = (key, value) => { onSetting(key, value); rerender(); };
  const seconds = (value) => `${value} s`;

  const training = pilates
    ? [
      row({ label: 'Modalità', value: 'Pilates', onClick: modeLocked ? null : () => choiceSheet('Modalità', [['gym', 'Palestra'], ['pilates', 'Pilates']], mode, onMode), hint: modeLocked ? 'Termina la sessione in corso per cambiare' : null }),
      row({ label: 'Pausa predefinita tra esercizi', value: seconds(settings.pauseDefault), onClick: () => choiceSheet('Pausa predefinita', PAUSE_CHOICES.map((value) => [value, seconds(value)]), settings.pauseDefault, (value) => set('pauseDefault', value)) }),
    ]
    : [
      row({ label: 'Modalità', value: 'Palestra', onClick: modeLocked ? null : () => choiceSheet('Modalità', [['gym', 'Palestra'], ['pilates', 'Pilates']], mode, onMode), hint: modeLocked ? 'Termina l\'allenamento in corso per cambiare' : null }),
      row({ label: 'Unità di peso', value: 'kg', hint: 'Libbre in arrivo', chevron: false }),
      row({ label: 'Recupero predefinito', value: seconds(settings.restDefault), onClick: () => choiceSheet('Recupero predefinito', REST_CHOICES.map((value) => [value, seconds(value)]), settings.restDefault, (value) => set('restDefault', value)) }),
      toggle({ label: 'Suggerimenti di progressione', checked: settings.progression, onChange: (value) => { onSetting('progression', value); } }),
    ];

  root.replaceChildren(
    topBar({ title: 'Impostazioni', onBack }),
    el('main', {},
      el('h2', { className: 'bg-section', text: 'Allenamento' }),
      el('div', { className: 'bg-set-list' }, training),
      el('h2', { className: 'bg-section', text: 'Notifiche' }),
      el('div', { className: 'bg-set-list' },
        toggle({ label: 'Promemoria allenamento', hint: 'In arrivo: nei giorni in cui hai una scheda', checked: false, onChange: () => false, disabled: true }),
        toggle({ label: 'Social', hint: 'Commenti e Forza', checked: settings.notifySocial, onChange: (value) => { onSetting('notifySocial', value); } })),
      el('h2', { className: 'bg-section', text: 'Aspetto' }),
      el('div', { className: 'bg-seg bg-seg--settings', role: 'radiogroup', 'aria-label': 'Aspetto' }, Object.entries(THEMES).map(([value, label]) => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(settings.theme === value), 'aria-selected': String(settings.theme === value),
        onClick: () => set('theme', value), text: label,
      }))),
      privacy ? [
        el('h2', { className: 'bg-section', text: 'Privacy' }),
        el('div', { className: 'bg-set-list' },
          toggle({ label: 'Mostra le statistiche agli amici', hint: pilates ? 'Sessioni e minuti di pratica' : 'Allenamenti e tempo in palestra', checked: privacy.shareStats, onChange: (value) => onPrivacy('shareStats', value) }),
          pilates ? null : toggle({ label: 'Mostra i carichi agli amici', hint: 'Volume, kg e record', checked: privacy.shareLoads, onChange: (value) => onPrivacy('shareLoads', value) }),
          row({ label: 'Chi può aggiungermi', value: ADD_ME[settings.addMe], onClick: () => choiceSheet('Chi può aggiungermi', Object.entries(ADD_ME), settings.addMe, (value) => set('addMe', value)) })),
        el('p', { className: 'bg-section__note bg-section__note--after', text: 'Le misure corporee non sono mai visibili agli altri.' }),
      ] : null,
      el('h2', { className: 'bg-section', text: 'Account' }),
      el('div', { className: 'bg-set-list' },
        row({ label: 'Cambia password', onClick: () => passwordSheet(onPassword) }),
        row({ label: 'Esci', onClick: onSignOut, chevron: false }),
        row({ label: 'Elimina account', onClick: onDelete, danger: true })),
      el('div', { className: 'bg-exspacer bg-exspacer--form', 'aria-hidden': 'true' })));
}

// ——— Elimina account ——————————————————————————————————————————————————————————————
export function renderDeleteAccount(root, { onBack, onExport, onDelete }) {
  const input = el('input', { id: 'deleteConfirm', placeholder: 'ELIMINA', autocomplete: 'off', autocapitalize: 'characters', 'aria-describedby': 'deleteHelp' });
  const field = el('label', { className: 'bg-field', for: 'deleteConfirm' },
    el('span', { className: 'bg-field__label', id: 'deleteHelp', text: 'Per confermare scrivi ELIMINA' }),
    el('span', { className: 'bg-field__box' }, input));
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const remove = el('button', { type: 'button', className: 'bg-btn bg-btn--block bg-btn--dangerfill', disabled: true, text: 'Elimina definitivamente' });
  const exportButton = button({ label: 'Scarica prima i miei dati', variant: 'outline' });
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    try { status.textContent = (await onExport()) ?? ''; } finally { exportButton.disabled = false; }
  });
  input.addEventListener('input', () => { remove.disabled = input.value.trim() !== 'ELIMINA'; });
  remove.addEventListener('click', async () => {
    if (input.value.trim() !== 'ELIMINA') return;
    remove.disabled = true;
    try { status.textContent = (await onDelete()) ?? ''; } finally { remove.disabled = input.value.trim() !== 'ELIMINA'; }
  });
  root.replaceChildren(
    topBar({ title: 'Elimina account', onBack }),
    el('main', {},
      hero('trash', 'Eliminare l\'account?', 'Perderai per sempre schede, sequenze, storico, record, misure corporee e post. Non si può annullare.', { danger: true }),
      el('div', { className: 'bg-form bg-form--hero' },
        exportButton, field, remove,
        button({ label: 'Annulla', variant: 'outline', onClick: onBack }),
        status)));
}
