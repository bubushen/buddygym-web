// Nuova password: si apre dal link «Password dimenticata?» ricevuto per email.
// Non è nel design: usa gli stessi componenti della registrazione.
import { button, el, pageHead, textField, topBar } from '../ui/components.js';
import { passwordProblem } from '../account-rules.js';

export function renderNewPassword(root, { onBack, onSave }) {
  const password = textField({ id: 'newPassword', label: 'Nuova password', type: 'password', icon: 'lock', placeholder: 'Crea una password', autocomplete: 'new-password', help: 'Almeno 8 caratteri, con almeno un numero.' });
  const confirm = textField({ id: 'newPasswordConfirm', label: 'Conferma password', type: 'password', icon: 'lock', placeholder: 'Riscrivi la password', autocomplete: 'new-password' });
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const submit = button({ label: 'Salva password', type: 'submit' });
  const form = el('form', { className: 'bg-form', noValidate: true }, password, confirm, submit, status);
  confirm.input.addEventListener('blur', () => {
    confirm.setError(confirm.input.value && confirm.input.value !== password.input.value ? 'Le password non coincidono.' : '');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    password.setError(''); confirm.setError(''); status.textContent = '';
    const problem = passwordProblem(password.input.value);
    if (problem) { password.setError(problem); password.input.focus(); return; }
    if (confirm.input.value !== password.input.value) { confirm.setError('Le password non coincidono.'); confirm.input.focus(); return; }
    submit.disabled = true;
    try { status.textContent = (await onSave(password.input.value)) ?? ''; } finally { submit.disabled = false; }
  });
  root.replaceChildren(
    topBar({ title: 'Account', onBack }),
    el('main', {}, pageHead({ title: 'Nuova password', subtitle: 'Scegli la password che userai da ora.' }), form));
}
