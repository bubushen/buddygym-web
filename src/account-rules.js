// Regole dei campi dell'account, uguali in registrazione e nuova password.

// Almeno 8 caratteri con almeno un numero (scritto sotto il campo prima dell'errore).
export function passwordProblem(password) {
  if (password.length < 8 || !/\d/.test(password)) return 'Almeno 8 caratteri, con almeno un numero.';
  return null;
}

// Alias: 3–30 caratteri, lettere, numeri, punto e trattino basso (come nel database).
export function aliasProblem(alias) {
  if (!alias) return 'Scegli un alias.';
  if (alias.length < 3 || alias.length > 30) return 'Da 3 a 30 caratteri.';
  if (!/^[A-Za-z0-9._]+$/.test(alias)) return 'Usa solo lettere, numeri, punto e trattino basso.';
  return null;
}

// Data di nascita obbligatoria, reale e non futura.
export function birthDateProblem(value, today = new Date().toISOString().slice(0, 10)) {
  if (!value) return 'Inserisci la data di nascita.';
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid || value < '1900-01-01' || value > today) return 'Inserisci una data di nascita valida.';
  return null;
}

// Età in anni compiuti (dalla data di nascita).
export function ageFromBirthDate(value, today = new Date()) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age;
}

// Messaggi degli errori di accesso di Supabase. Credenziali sbagliate: un solo
// messaggio sotto la password, senza dire se è sbagliata l'email o la password.
export function signInError(error) {
  if (!error) return null;
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  if (/invalid_credentials|invalid login credentials/i.test(text)) return { field: 'password', message: 'Email o password non corrette.' };
  if (/email_not_confirmed|email not confirmed/i.test(text)) return { message: 'Conferma prima la tua email: apri il link che ti abbiamo mandato.' };
  if (/rate|too many/i.test(text)) return { message: 'Troppi tentativi. Riprova tra qualche minuto.' };
  return { message: `Accesso non riuscito: ${error.message}` };
}
