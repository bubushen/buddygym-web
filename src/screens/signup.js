// SignupScreen: alias, email, data di nascita, password e conferma, oppure Google.
import { button, el, link, pageHead, textField, topBar } from '../ui/components.js';
import { aliasProblem, birthDateProblem, passwordProblem } from '../account-rules.js';
import { icon } from '../ui/icons.js';

// SignupStepsScreen: registrazione in 3 passi (te, alias ed email, password).
// Indietro torna al passo precedente con i dati già inseriti; dal passo 1 al benvenuto.
const SEXES = [['female', 'Donna'], ['male', 'Uomo'], ['other', 'Altro'], ['prefer_not_to_say', 'Preferisco non dirlo']];
const STEPS = {
  1: ['Parliamo di te', 'Ci servono per adattare l\'app a te.'],
  2: ['Come ti chiami?', 'Il tuo nome nell\'app e la mail per accedere.'],
  3: ['Scegli una password', 'Ultimo passo.'],
};
const draft = { step: 1, sex: '', birthDate: '', alias: '', email: '' };
export function resetSignup() { Object.assign(draft, { step: 1, sex: '', birthDate: '', alias: '', email: '' }); }

// «2002-03-12» → «12 marzo 2002».
export function longDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
}

export function renderSignup(root, dock, props) {
  const { onBack, onCreate, onGoogle, onLogin, checkAlias } = props;
  const today = new Date().toISOString().slice(0, 10);
  const go = (step) => { draft.step = step; renderSignup(root, dock, props); };
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const last = draft.step === 3;
  const next = el('button', { type: 'submit', form: 'signupForm', className: 'bg-btn bg-btn--block bg-btn--primary' }, last ? 'Crea account' : 'Continua', icon('arrowRight', { small: true }));
  // «Continua» è attivo solo quando i campi obbligatori del passo sono validi.
  const setReady = (ready) => {
    next.disabled = !ready;
    next.classList.toggle('bg-btn--disabled', !ready);
  };
  let fields;
  let ready;
  let submit;

  if (draft.step === 1) {
    const options = el('div', { className: 'bg-optgrid' }, SEXES.map(([value, label]) => el('button', {
      type: 'button', className: 'bg-opt', role: 'radio', 'aria-checked': String(draft.sex === value), dataset: { value }, text: label,
    })));
    options.addEventListener('click', (event) => {
      const option = event.target.closest('.bg-opt');
      if (!option) return;
      draft.sex = option.dataset.value;
      for (const item of options.children) item.setAttribute('aria-checked', String(item === option));
      setReady(ready());
    });
    // Un solo campo con una sola icona: l'input data del telefono, invisibile, copre il campo.
    const label = el('span', { text: draft.birthDate ? longDate(draft.birthDate) : 'Seleziona la data' });
    const input = el('input', { type: 'date', id: 'signupBirth', 'aria-label': 'Data di nascita', max: today, min: '1900-01-01', autocomplete: 'bday', value: draft.birthDate || null });
    const date = el('div', { className: `bg-datebtn${draft.birthDate ? ' bg-datebtn--set' : ''}` },
      icon('calendar', { small: true }), label, icon('chevronDown', { small: true }), input);
    input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* Il tocco apre comunque il selettore. */ } });
    const help = el('span', { className: 'bg-field__help', text: 'Serve a calcolare la tua età. Non sarà visibile agli altri.' });
    input.addEventListener('change', () => {
      draft.birthDate = input.value;
      const problem = draft.birthDate ? birthDateProblem(draft.birthDate, today) : null;
      label.textContent = draft.birthDate ? longDate(draft.birthDate) : 'Seleziona la data';
      date.classList.toggle('bg-datebtn--set', !!draft.birthDate);
      date.closest('.bg-datefield')?.classList.toggle('bg-field--error', !!problem);
      help.replaceChildren(...(problem ? [icon('alert', { small: true }), problem] : ['Serve a calcolare la tua età. Non sarà visibile agli altri.']));
      setReady(ready());
    });
    fields = [
      el('div', { role: 'radiogroup', 'aria-labelledby': 'signupSexLabel' }, el('span', { className: 'bg-flabel', id: 'signupSexLabel', text: 'Sesso' }), options),
      el('div', { className: 'bg-datefield' }, el('span', { className: 'bg-flabel', text: 'Data di nascita' }), date, help),
      el('div', { className: 'bg-divider', text: 'oppure' }),
      button({ label: 'Registrati con Google', variant: 'google', onClick: async () => { status.textContent = (await onGoogle(profileValues())) ?? ''; } }),
    ];
    ready = () => !!draft.sex && !birthDateProblem(draft.birthDate, today);
    submit = () => go(2);
  } else if (draft.step === 2) {
    const alias = textField({ id: 'signupAlias', label: 'Nome utente / alias', icon: 'person', placeholder: 'es. ale_lifts', autocomplete: 'username', help: 'È il nome che vedranno il tuo coach e gli altri.', required: true, value: draft.alias });
    const email = textField({ id: 'signupEmail', label: 'Email', type: 'email', icon: 'mail', placeholder: 'nome@email.com', autocomplete: 'email', inputmode: 'email', required: true, value: draft.email });
    const validEmail = () => !!email.input.value.trim() && email.input.checkValidity();
    ready = () => !aliasProblem(alias.input.value.trim()) && validEmail();
    for (const field of [alias, email]) field.input.addEventListener('input', () => { draft.alias = alias.input.value.trim(); draft.email = email.input.value.trim(); setReady(ready()); });
    // L'alias deve essere unico: controllo quando si esce dal campo.
    alias.input.addEventListener('blur', async () => {
      const value = alias.input.value.trim();
      if (!value) return;
      const problem = aliasProblem(value);
      alias.setError(problem ?? ((await checkAlias(value)) === false ? 'Questo alias è già preso: scegline un altro.' : ''));
    });
    email.input.addEventListener('blur', () => { email.setError(email.input.value.trim() && !validEmail() ? 'Scrivi un indirizzo email valido.' : ''); });
    fields = [alias, email];
    submit = async () => {
      if ((await checkAlias(draft.alias)) === false) { alias.setError('Questo alias è già preso: scegline un altro.'); alias.input.focus(); return; }
      go(3);
    };
  } else {
    const password = textField({ id: 'signupPassword', label: 'Password', type: 'password', icon: 'lock', placeholder: 'Crea una password', autocomplete: 'new-password', help: 'Almeno 8 caratteri, con almeno un numero.', required: true });
    const confirm = textField({ id: 'signupConfirm', label: 'Conferma password', type: 'password', icon: 'lock', placeholder: 'Riscrivi la password', autocomplete: 'new-password', required: true });
    ready = () => !passwordProblem(password.input.value) && confirm.input.value === password.input.value;
    for (const field of [password, confirm]) field.input.addEventListener('input', () => setReady(ready()));
    // «Le password non coincidono.» quando si esce dal campo, non a ogni tasto.
    confirm.input.addEventListener('blur', () => {
      confirm.setError(confirm.input.value && confirm.input.value !== password.input.value ? 'Le password non coincidono.' : '');
    });
    fields = [password, confirm];
    submit = async () => {
      const result = await onCreate({ ...profileValues(), alias: draft.alias, email: draft.email, password: password.input.value });
      // Alias o email rifiutati dal server: si torna al passo 2 con il messaggio.
      if (result?.field === 'alias' || result?.field === 'email') { go(2); root.querySelector('.bg-formstatus').textContent = result.message; return; }
      if (result?.message) status.textContent = result.message;
    };
  }

  const form = el('form', { id: 'signupForm', className: 'bg-form bg-form--steps', noValidate: true }, fields, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ready() || next.dataset.busy) return;
    next.dataset.busy = '1';
    try { await submit(); } finally { delete next.dataset.busy; }
  });
  const [title, lead] = STEPS[draft.step];
  root.replaceChildren(
    el('header', { className: 'bg-steps' },
      el('button', { type: 'button', className: 'bg-iconbtn', 'aria-label': draft.step === 1 ? 'Indietro' : 'Passo precedente', onClick: draft.step === 1 ? onBack : () => go(draft.step - 1) }, icon('back')),
      el('div', { className: 'bg-progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '3', 'aria-valuenow': String(draft.step), 'aria-label': `Passo ${draft.step} di 3` },
        [1, 2, 3].map((step) => el('i', { className: step <= draft.step ? 'on' : '' }))),
      el('span', { className: 'bg-steps__n', text: `${draft.step} di 3` })),
    el('main', {},
      el('div', { className: 'bg-stepshead' }, el('h1', { text: title }), el('p', { text: lead })),
      form));
  dock.replaceChildren(el('div', { className: 'bg-authdock' }, next, el('span', {}, 'Hai già un account? ', link({ label: 'Accedi', onClick: onLogin }))));
  setReady(ready());
}

// Sesso e data di nascita: si salvano nel profilo al primo accesso.
function profileValues() {
  return { sex: draft.sex, birthDate: draft.birthDate };
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
