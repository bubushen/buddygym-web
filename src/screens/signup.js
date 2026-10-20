// SignupScreen: alias, email, data di nascita, password e conferma, oppure Google.
import { button, el, link, pageHead, textField, topBar } from '../ui/components.js';
import { aliasProblem, birthDateProblem, passwordProblem } from '../account-rules.js';

export function renderSignup(root, { onBack, onCreate, onGoogle, onLogin, checkAlias }) {
  const today = new Date().toISOString().slice(0, 10);
  const alias = textField({ id: 'signupAlias', label: 'Nome utente / alias', icon: 'person', placeholder: 'es. ale_lifts', autocomplete: 'username', help: 'È il nome che vedranno il tuo coach e gli altri.', required: true });
  const email = textField({ id: 'signupEmail', label: 'Email', type: 'email', icon: 'mail', placeholder: 'nome@email.com', autocomplete: 'email', inputmode: 'email', required: true });
  // type="date": sul telefono apre il selettore data di sistema.
  const birth = textField({ id: 'signupBirth', label: 'Data di nascita', type: 'date', icon: 'calendar', placeholder: 'gg/mm/aaaa', autocomplete: 'bday', help: 'Serve a calcolare la tua età. Non sarà visibile agli altri.', required: true });
  birth.input.max = today;
  birth.input.min = '1900-01-01';
  const password = textField({ id: 'signupPassword', label: 'Password', type: 'password', icon: 'lock', placeholder: 'Crea una password', autocomplete: 'new-password', help: 'Almeno 8 caratteri, con almeno un numero.', required: true });
  const confirm = textField({ id: 'signupConfirm', label: 'Conferma password', type: 'password', icon: 'lock', placeholder: 'Riscrivi la password', autocomplete: 'new-password', required: true });
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const submit = button({ label: 'Crea account', type: 'submit' });

  // L'alias deve essere unico: controllo quando si esce dal campo.
  alias.input.addEventListener('blur', async () => {
    const value = alias.input.value.trim();
    if (!value) return;
    const problem = aliasProblem(value);
    if (problem) { alias.setError(problem); return; }
    alias.setError((await checkAlias(value)) === false ? 'Questo alias è già preso: scegline un altro.' : '');
  });
  // «Le password non coincidono.» quando si esce dal campo, non a ogni tasto.
  confirm.input.addEventListener('blur', () => {
    confirm.setError(confirm.input.value && confirm.input.value !== password.input.value ? 'Le password non coincidono.' : '');
  });

  const form = el('form', { className: 'bg-form', noValidate: true },
    alias, email, birth, password, confirm, submit,
    el('div', { className: 'bg-divider', text: 'oppure' }),
    button({ label: 'Registrati con Google', variant: 'google', onClick: async () => { status.textContent = (await onGoogle()) ?? ''; } }),
    status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (const field of [alias, email, birth, password, confirm]) field.setError('');
    status.textContent = '';
    const values = {
      alias: alias.input.value.trim(),
      email: email.input.value.trim(),
      birthDate: birth.input.value,
      password: password.input.value,
    };
    const checks = [
      [alias, aliasProblem(values.alias)],
      [email, !values.email || !email.input.checkValidity() ? 'Scrivi un indirizzo email valido.' : null],
      [birth, birthDateProblem(values.birthDate, today)],
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

  root.replaceChildren(
    topBar({ title: 'Registrati', onBack }),
    el('main', {},
      pageHead({ title: 'Crea il tuo account', subtitle: 'Alias, mail, data di nascita e password.' }),
      form,
      el('div', { className: 'bg-authfoot' }, 'Hai già un account? ', link({ label: 'Accedi', onClick: onLogin }))));
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
