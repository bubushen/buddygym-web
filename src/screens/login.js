// LoginScreen: pagina Account quando non è stato fatto l'accesso.
// Accedi è l'unica azione primaria; Google e Registrati sono più deboli.
import { button, el, link, pageHead, textField, topBar } from '../ui/components.js';

export function renderLogin(root, { onBack, onSignIn, onGoogle, onApple, onForgot, onSignup }) {
  const email = textField({ id: 'loginEmail', label: 'Email', type: 'email', icon: 'mail', placeholder: 'nome@email.com', autocomplete: 'email', inputmode: 'email', required: true });
  const password = textField({ id: 'loginPassword', label: 'Password', type: 'password', icon: 'lock', placeholder: 'La tua password', autocomplete: 'current-password', required: true });
  const status = el('p', { className: 'bg-formstatus', role: 'status' });
  const submit = button({ label: 'Accedi', type: 'submit' });

  const setStatus = (text) => { status.textContent = text ?? ''; };
  const busy = (value) => { submit.disabled = value; };

  const form = el('form', { className: 'bg-form', noValidate: true },
    email,
    password,
    el('div', { className: 'bg-form__aside' }, link({ label: 'Password dimenticata?', onClick: async () => {
      email.setError(''); password.setError('');
      const value = email.input.value.trim();
      if (!value) { email.setError('Scrivi la tua email: ti mandiamo il link per scegliere una nuova password.'); email.input.focus(); return; }
      setStatus(await onForgot(value));
    } })),
    submit,
    el('div', { className: 'bg-divider', text: 'oppure' }),
    button({ label: 'Continua con Google', variant: 'google', onClick: async () => setStatus(await onGoogle()) }),
    onApple ? button({ label: 'Continua con Apple', variant: 'outline', onClick: async () => setStatus(await onApple()) }) : null,
    status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    email.setError(''); password.setError(''); setStatus('');
    const emailValue = email.input.value.trim();
    if (!emailValue || !email.input.checkValidity()) { email.setError('Scrivi un indirizzo email valido.'); email.input.focus(); return; }
    if (!password.input.value) { password.setError('Scrivi la password.'); password.input.focus(); return; }
    busy(true);
    try {
      const result = await onSignIn(emailValue, password.input.value);
      // Credenziali sbagliate: un solo messaggio sotto la password, senza dire quale dei due.
      if (result?.field === 'password') password.setError(result.message);
      else if (result?.message) setStatus(result.message);
    } finally { busy(false); }
  });

  root.replaceChildren(
    topBar({ title: 'Account', onBack }),
    el('main', {},
      pageHead({ title: 'Accedi', subtitle: 'Bentornato. Accedi per ritrovare schede e progressi.' }),
      form,
      el('div', { className: 'bg-authfoot' },
        el('p', { className: 'bg-authfoot__lead', text: 'Non hai ancora un account?' }),
        button({ label: 'Registrati', variant: 'outline', onClick: onSignup }))));
  return { setStatus };
}
