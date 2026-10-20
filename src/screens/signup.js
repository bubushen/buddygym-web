// SignupScreen: alias, email, data di nascita, password e conferma, oppure Google.
import { button, el, link, pageHead, textField, topBar } from '../ui/components.js';
import { aliasProblem, birthDateProblem, passwordProblem } from '../account-rules.js';
import { parseMeasure } from '../measurements.js';
import { icon } from '../ui/icons.js';

// La registrazione è in tre pagine; i valori restano se si torna indietro.
const SEXES = [['female', 'Donna'], ['male', 'Uomo'], ['other', 'Altro'], ['prefer_not_to_say', 'Preferisco non dirlo']];
const draft = { step: 1, sex: '', birthDate: '', weight: '', height: '', alias: '', email: '' };
export function resetSignup() { Object.assign(draft, { step: 1, sex: '', birthDate: '', weight: '', height: '', alias: '', email: '' }); }

// Peso e altezza: valori plausibili, con al massimo un decimale.
export function bodyProblem(kind, text) {
  const value = parseMeasure(text);
  if (kind === 'weight') return value === null || value < 20 || value > 400 ? 'Scrivi il peso in kg, per esempio 72,5.' : null;
  return value === null || value < 100 || value > 250 ? 'Scrivi l\'altezza in cm, per esempio 175.' : null;
}

export function renderSignup(root, { onBack, onCreate, onGoogle, onLogin, checkAlias }) {
  const today = new Date().toISOString().slice(0, 10);
  const go = (step) => { draft.step = step; renderSignup(root, { onBack, onCreate, onGoogle, onLogin, checkAlias }); root.querySelector('input')?.focus({ preventScroll: true }); };
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const next = (label = 'Continua') => button({ label, type: 'submit', iconAfter: label === 'Continua' ? 'arrowRight' : null });
  let form;
  let subtitle;

  if (draft.step === 1) {
    // Pagina 1: sesso e data di nascita (da qui si calcola l'età).
    subtitle = 'Sesso e data di nascita.';
    const sexError = el('span', { className: 'bg-field__help', role: 'alert', hidden: true });
    const sexes = el('div', { className: 'bg-chips bg-chips--wrap', role: 'radiogroup', 'aria-label': 'Sesso' },
      SEXES.map(([value, label]) => el('button', { type: 'button', className: 'bg-fchip', role: 'radio', 'aria-checked': String(draft.sex === value), 'aria-pressed': String(draft.sex === value), dataset: { value }, text: label })));
    sexes.addEventListener('click', (event) => {
      const chip = event.target.closest('button');
      if (!chip) return;
      draft.sex = chip.dataset.value;
      for (const item of sexes.children) { const on = item === chip; item.setAttribute('aria-pressed', String(on)); item.setAttribute('aria-checked', String(on)); }
      sexError.hidden = true;
    });
    const birth = textField({ id: 'signupBirth', label: 'Data di nascita', type: 'date', icon: 'calendar', placeholder: 'gg/mm/aaaa', autocomplete: 'bday', help: 'Serve a calcolare la tua età. Non sarà visibile agli altri.', required: true, value: draft.birthDate });
    birth.input.max = today;
    birth.input.min = '1900-01-01';
    form = el('form', { className: 'bg-form', noValidate: true },
      el('div', { className: 'bg-field' }, el('span', { className: 'bg-field__label', text: 'Sesso' }), sexes, sexError),
      birth, next(), status);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      draft.birthDate = birth.input.value;
      const problem = birthDateProblem(draft.birthDate, today);
      birth.setError(problem ?? '');
      sexError.hidden = !!draft.sex;
      if (!draft.sex) sexError.replaceChildren(icon('alert', { small: true }), 'Scegli un\'opzione.');
      if (!draft.sex || problem) return;
      go(2);
    });
  } else if (draft.step === 2) {
    // Pagina 2: peso e altezza, i primi punti dei grafici in Account.
    subtitle = 'Peso e altezza.';
    const weight = textField({ id: 'signupWeight', label: 'Peso (kg)', icon: 'person', placeholder: 'es. 72,5', inputmode: 'decimal', help: 'Il punto di partenza del grafico del peso. Non sarà visibile agli altri.', required: true, value: draft.weight });
    const height = textField({ id: 'signupHeight', label: 'Altezza (cm)', icon: 'person', placeholder: 'es. 175', inputmode: 'decimal', help: 'Senza scarpe.', required: true, value: draft.height });
    form = el('form', { className: 'bg-form', noValidate: true }, weight, height, next(), status);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      draft.weight = weight.input.value.trim();
      draft.height = height.input.value.trim();
      const problems = [[weight, bodyProblem('weight', draft.weight)], [height, bodyProblem('height', draft.height)]];
      for (const [field, problem] of problems) field.setError(problem ?? '');
      const failed = problems.find(([, problem]) => problem);
      if (failed) { failed[0].input.focus(); return; }
      go(3);
    });
  } else {
    // Pagina 3: alias, email e password due volte (oppure Google).
    subtitle = 'Alias, email e password.';
    const alias = textField({ id: 'signupAlias', label: 'Nome utente / alias', icon: 'person', placeholder: 'es. ale_lifts', autocomplete: 'username', help: 'È il nome che vedranno il tuo coach e gli altri.', required: true, value: draft.alias });
    const email = textField({ id: 'signupEmail', label: 'Email', type: 'email', icon: 'mail', placeholder: 'nome@email.com', autocomplete: 'email', inputmode: 'email', required: true, value: draft.email });
    const password = textField({ id: 'signupPassword', label: 'Password', type: 'password', icon: 'lock', placeholder: 'Crea una password', autocomplete: 'new-password', help: 'Almeno 8 caratteri, con almeno un numero.', required: true });
    const confirm = textField({ id: 'signupConfirm', label: 'Conferma password', type: 'password', icon: 'lock', placeholder: 'Riscrivi la password', autocomplete: 'new-password', required: true });
    const submit = next('Crea account');
    // L'alias deve essere unico: controllo quando si esce dal campo.
    alias.input.addEventListener('blur', async () => {
      const value = alias.input.value.trim();
      draft.alias = value;
      if (!value) return;
      const problem = aliasProblem(value);
      if (problem) { alias.setError(problem); return; }
      alias.setError((await checkAlias(value)) === false ? 'Questo alias è già preso: scegline un altro.' : '');
    });
    email.input.addEventListener('blur', () => { draft.email = email.input.value.trim(); });
    // «Le password non coincidono.» quando si esce dal campo, non a ogni tasto.
    confirm.input.addEventListener('blur', () => {
      confirm.setError(confirm.input.value && confirm.input.value !== password.input.value ? 'Le password non coincidono.' : '');
    });
    form = el('form', { className: 'bg-form', noValidate: true },
      alias, email, password, confirm, submit,
      el('div', { className: 'bg-divider', text: 'oppure' }),
      button({ label: 'Registrati con Google', variant: 'google', onClick: async () => { status.textContent = (await onGoogle(profileValues())) ?? ''; } }),
      status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      for (const field of [alias, email, password, confirm]) field.setError('');
      status.textContent = '';
      draft.alias = alias.input.value.trim();
      draft.email = email.input.value.trim();
      const values = { ...profileValues(), alias: draft.alias, email: draft.email, password: password.input.value };
      const checks = [
        [alias, aliasProblem(values.alias)],
        [email, !values.email || !email.input.checkValidity() ? 'Scrivi un indirizzo email valido.' : null],
        [password, passwordProblem(values.password)],
        [confirm, confirm.input.value !== values.password ? 'Le password non coincidono.' : null],
      ];
      const failed = checks.filter(([, problem]) => problem);
      for (const [field, problem] of failed) field.setError(problem);
      if (failed.length) { failed[0][0].input.focus(); return; }
      submit.disabled = true;
      try {
        if ((await checkAlias(values.alias)) === false) { alias.setError('Questo alias è già preso: scegline un altro.'); alias.input.focus(); return; }
        const result = await onCreate(values);
        const target = { alias, email }[result?.field];
        if (target) { target.setError(result.message); target.input.focus(); } else if (result?.message) status.textContent = result.message;
      } finally { submit.disabled = false; }
    });
  }

  root.replaceChildren(
    topBar({ title: 'Registrati', onBack: draft.step === 1 ? onBack : () => go(draft.step - 1), backLabel: draft.step === 1 ? 'Indietro' : 'Pagina precedente' }),
    el('main', {},
      el('div', { className: 'bg-pagehead' },
        el('p', { className: 'bg-pagehead__over', text: `Passo ${draft.step} di 3` }),
        el('h1', { text: 'Crea il tuo account' }),
        el('p', { text: subtitle })),
      form,
      el('div', { className: 'bg-authfoot' }, 'Hai già un account? ', link({ label: 'Accedi', onClick: onLogin }))));
}

// Dati delle prime due pagine: si salvano nel profilo al primo accesso.
function profileValues() {
  return { sex: draft.sex, birthDate: draft.birthDate, weight: parseMeasure(draft.weight), height: parseMeasure(draft.height) };
}

// Alias da scegliere dopo la registrazione con Google (o per account già esistenti).
export function renderAliasPrompt(root, { onSave, checkAlias, onLater }) {
  const alias = textField({ id: 'aliasOnly', label: 'Nome utente / alias', icon: 'person', placeholder: 'es. ale_lifts', autocomplete: 'username', help: 'È il nome che vedranno il tuo coach e gli altri.', required: true });
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const submit = button({ label: 'Salva alias', type: 'submit' });
  const form = el('form', { className: 'bg-form', noValidate: true }, alias, submit, button({ label: 'Più tardi', variant: 'outline', onClick: onLater }), status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alias.setError('');
    const value = alias.input.value.trim();
    const problem = aliasProblem(value);
    if (problem) { alias.setError(problem); alias.input.focus(); return; }
    submit.disabled = true;
    try {
      if ((await checkAlias(value)) === false) { alias.setError('Questo alias è già preso: scegline un altro.'); return; }
      const message = await onSave(value);
      if (message) status.textContent = message;
    } finally { submit.disabled = false; }
  });
  root.replaceChildren(
    topBar({ title: 'Account', onBack: onLater }),
    el('main', {}, pageHead({ title: 'Scegli il tuo alias', subtitle: 'Un nome per farti riconoscere dal tuo coach.' }), form));
}
