import { assignmentSnapshot, clientAssignments, createCoachStore, coachVideoUrl, prescription } from './coach-data.js';
import { exerciseSummary, makeId } from './workouts.js';
import { CURL_EXERCISE } from './exercise-catalog.js';
import { compressVideo } from './video-compress.js';
import { keepFrameFitted } from './video-frame.js';
import { saveCachedPose } from './reference-store.js';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const escape = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const action = (label, id, value = '', extra = '') => `<button type="button" class="secondary-button" data-action="${id}" data-id="${escape(value)}" ${extra}>${label}</button>`;

export function createCoachUI(root, { onPreview, prepareReference }) {
  let owner;
  let client;
  let store;
  let data;
  let loading;
  let busy = false;
  let view = 'templates';
  let generation = 0;
  let activeId;

  function message(text) { const node = root.querySelector('#coachMessage'); if (node) node.textContent = text; }
  function shell(title, description, body, back = null) {
    const backIcon = '<svg class="bg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    root.innerHTML = `${back ? `<header class="bg-topbar"><button type="button" class="bg-iconbtn" data-action="back" data-id="${escape(back)}" aria-label="Indietro">${backIcon}</button><span class="bg-topbar__title">Coaching</span><span></span></header>` : ''}
      <div class="bg-exhead"><p class="bg-exhead__over">Spazio coach</p><h1>${escape(title)}</h1><p class="bg-exhead__lead">${escape(description)}</p></div>
      <nav class="bg-segment" aria-label="Area coach">${['templates', 'exercises', 'clients'].map((tab, index) => `<button type="button" data-action="tab" data-id="${tab}" ${view === tab ? 'aria-current="page"' : ''}>${['Template', 'Esercizi', 'Clienti'][index]}</button>`).join('')}</nav>
      <p id="coachMessage" class="bg-note coach-message" role="status"></p>${body}`;
  }
  function go(next, id) {
    if (busy) return;
    root.querySelectorAll('video').forEach((video) => video.pause());
    view = next; activeId = id;
    render();
    root.closest('.app-scroll').scrollTop = 0;
  }
  async function commit(next, after) {
    if (busy) return;
    busy = true;
    const controls = [...root.querySelectorAll('button, input, select, textarea')].map((node) => [node, node.disabled]);
    controls.forEach(([node]) => { node.disabled = true; });
    const current = generation;
    try {
      message('Salvataggio…');
      await store.save(next);
      if (current !== generation) return;
      data = next;
      busy = false;
      after();
    } catch (error) {
      if (current === generation) message(error.message || 'Salvataggio non riuscito. Riprova.');
    } finally {
      if (current === generation) {
        busy = false;
        controls.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; });
      }
    }
  }
  function cards(items, renderItem, empty) {
    return items.length ? `<div class="workout-list">${items.map(renderItem).join('')}</div>` : `<p class="empty-list">${escape(empty)}</p>`;
  }
  function render() {
    if (!data) return;
    if (view === 'template') return templateForm(data.templates.find((item) => item.id === activeId));
    if (view === 'exercise') return exerciseForm(data.exercises.find((item) => item.id === activeId));
    if (view === 'single-assign') return singleExerciseForm(activeId);
    if (view === 'assign') return assignForm(activeId);
    if (view === 'client') return clientPage(activeId);
    if (view === 'assignment') return assignmentForm(activeId);
    if (view === 'video') return videoPage(activeId);
    if (view === 'exercises') {
      shell('I tuoi esercizi', 'Un video di riferimento per esercizio, riutilizzabile in tutte le tue schede.',
        `<button type="button" class="primary-button coach-add" data-action="new-exercise">Crea esercizio</button>` + cards(data.exercises, (item) =>
          `<article class="coach-card"><h2>${escape(item.title)}</h2><p>${item.reference ? 'Video di riferimento disponibile' : 'Nessun video di riferimento'}</p><div class="coach-card-actions">${action('Modifica', 'edit-exercise', item.id)}${action('Assegna esercizio', 'single-assign', item.id)}${item.reference ? action('Guarda video', 'video', item.id) : ''}${action('Elimina', 'delete-exercise', item.id)}</div></article>`, 'Crea il primo esercizio della tua libreria.'));
    } else if (view === 'clients') {
      shell('I tuoi clienti', 'Clienti fittizi per provare le assegnazioni. Il collegamento con persone reali arriverà in seguito.',
        cards(data.clients, (item) => `<button type="button" class="workout-card" data-action="client" data-id="${escape(item.id)}"><span class="coach-demo-tag">CLIENTE DI PROVA</span><strong>${escape(item.name)}</strong><p>${data.assignments.filter((plan) => plan.clientId === item.id).length} schede assegnate</p><span class="card-arrow">Apri →</span></button>`, 'Nessun cliente di prova disponibile.'));
    } else {
      view = 'templates';
      shell('Le tue schede', 'Crea template, riutilizzali e assegna una copia a ciascun cliente.',
        `<button type="button" class="primary-button coach-add" data-action="new-template">Crea template</button>` + cards(data.templates, (item) =>
          `<article class="coach-card"><span class="coach-demo-tag">TEMPLATE</span><h2>${escape(item.title)}</h2><p>${item.exercises.length} esercizi · le modifiche non cambiano le copie già assegnate.</p><div class="coach-card-actions">${action('Modifica', 'edit-template', item.id)}${action('Assegna →', 'assign', item.id)}${action('Elimina', 'delete-template', item.id)}</div></article>`, 'Crea il tuo primo template.'));
    }
  }

  function prescriptionFields(item, prefix) {
    return `<label class="editor-field">Tipo<select name="${prefix}mode"><option value="reps" ${item.mode !== 'time' ? 'selected' : ''}>Serie e ripetizioni</option><option value="time" ${item.mode === 'time' ? 'selected' : ''}>Tempo</option></select></label>
      <div class="field-pair" data-reps ${item.mode === 'time' ? 'hidden' : ''}><label class="editor-field">Serie<input type="number" name="${prefix}sets" min="1" max="999" step="1" value="${escape(item.sets ?? 3)}" /></label><label class="editor-field">Ripetizioni<input type="number" name="${prefix}reps" min="1" max="999" step="1" value="${escape(item.reps ?? 8)}" /></label></div>
      <label class="editor-field" data-time ${item.mode !== 'time' ? 'hidden' : ''}>Minuti<input type="number" name="${prefix}minutes" min="0.1" max="999" step="0.1" value="${escape(item.minutes ?? 10)}" /></label>`;
  }
  function wirePrescription(container) {
    const select = container.querySelector('select[name$="mode"]');
    const update = () => {
      const timed = select.value === 'time';
      container.querySelector('[data-time]').hidden = !timed;
      container.querySelector('[data-reps]').hidden = timed;
      container.querySelectorAll('[data-time] input').forEach((input) => { input.required = timed; });
      container.querySelectorAll('[data-reps] input').forEach((input) => { input.required = !timed; });
    };
    select.addEventListener('change', update); update();
  }
  function readPrescription(container, prefix = '') {
    const value = (key) => container.querySelector(`[name="${prefix}${key}"]`).value;
    return prescription({ mode: value('mode'), sets: value('sets'), reps: value('reps'), minutes: value('minutes') });
  }

  function templateForm(template) {
    shell(template ? 'Modifica template' : 'Nuovo template', 'Le copie già assegnate restano invariate.',
      `<form id="coachTemplateForm" class="editor-form"><label class="editor-field">Nome della scheda<input name="title" maxlength="120" required value="${escape(template?.title ?? '')}" placeholder="Es. Upper 1" /></label>
      <div id="coachTemplateRows" class="coach-rows"></div>
      <label class="editor-field">Aggiungi dalla libreria<select id="coachLibraryChoice"><option value="">Scegli un esercizio</option>${data.exercises.map((item) => `<option value="${escape(item.id)}">${escape(item.title)}</option>`).join('')}</select></label>
      <button type="button" class="secondary-button" id="coachAddRow">Aggiungi esercizio</button>
      <button type="submit" class="primary-button">Salva template →</button></form>`, 'templates');
    const rows = root.querySelector('#coachTemplateRows');
    function append(item) {
      const source = data.exercises.find((exercise) => exercise.id === item.libraryId);
      const row = document.createElement('div'); row.className = 'coach-prescription';
      row.dataset.rowId = item.id; row.dataset.libraryId = item.libraryId;
      row.innerHTML = `<div class="section-heading"><h2>${escape(source?.title ?? item.title)}</h2><button type="button" class="text-action">Rimuovi</button></div>${prescriptionFields(item, '')}`;
      row.querySelector('button').onclick = () => row.remove();
      wirePrescription(row); rows.append(row);
    }
    (template?.exercises ?? []).forEach(append);
    root.querySelector('#coachAddRow').onclick = () => {
      const source = data.exercises.find((item) => item.id === root.querySelector('#coachLibraryChoice').value);
      if (!source) { message('Scegli prima un esercizio dalla libreria.'); return; }
      append({ id: makeId(), libraryId: source.id, title: source.title, mode: 'reps', sets: 3, reps: 8 });
      message('');
    };
    root.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      try {
        const title = root.querySelector('[name="title"]').value.trim();
        if (!title) throw new Error('Inserisci il nome della scheda.');
        const exercises = [...rows.children].map((row) => ({ id: row.dataset.rowId, libraryId: row.dataset.libraryId, title: data.exercises.find((item) => item.id === row.dataset.libraryId).title, ...readPrescription(row) }));
        const next = structuredClone(data);
        const saved = { id: template?.id ?? makeId(), title, exercises };
        const index = next.templates.findIndex((item) => item.id === saved.id);
        if (index < 0) next.templates.push(saved); else next.templates[index] = saved;
        void commit(next, () => go('templates'));
      } catch (error) { message(error.message); }
    };
  }

  function exerciseForm(exercise) {
    shell(exercise ? 'Modifica esercizio' : 'Nuovo esercizio', 'Carica un video verticale o orizzontale, tra 2 e 60 secondi. Oltre 50 MB viene ridotto automaticamente a 720p.',
      `<form id="coachExerciseForm" class="editor-form"><label class="editor-field">Nome<input name="title" maxlength="120" required value="${escape(exercise?.title ?? '')}" placeholder="Es. Curl con manubrio" /></label>
      <label class="editor-field">Indicazioni di esecuzione<textarea name="instructions" maxlength="2000" rows="4" placeholder="Un’indicazione per riga">${escape(exercise?.instructions ?? '')}</textarea></label>
      <label class="editor-field">Video di riferimento<input type="file" name="reference" accept="video/mp4,video/quicktime,video/webm" /></label>
      <p class="form-help">${exercise?.reference ? 'Il riferimento attuale rimane se non scegli un nuovo video. Le schede già assegnate mantengono il video precedente fino al tuo aggiornamento.' : 'Puoi aggiungere il video anche successivamente.'}</p>
      <label class="mode-choice"><input type="checkbox" name="analyze" ${exercise?.reference?.kind || exercise?.reference?.builtin ? 'checked' : ''} /><span>Prepara il confronto automatico del movimento</span></label>
      <p class="form-help">Facoltativo e sperimentale. Il sistema misura il movimento; sei tu a scegliere una dimostrazione corretta.</p>
      <button type="submit" class="primary-button">Salva esercizio →</button></form>`, 'exercises');
    root.querySelector('form').onsubmit = async (event) => {
      event.preventDefault(); if (busy) return;
      const form = event.currentTarget;
      const title = form.elements.title.value.trim();
      if (!title) { message('Inserisci il nome dell’esercizio.'); return; }
      const id = exercise?.id ?? makeId();
      const file = form.elements.reference.files?.[0];
      const analyze = form.elements.analyze.checked;
      const instructions = form.elements.instructions.value.trim();
      const current = generation;
      const currentStore = store;
      let uploadedPath;
      let saveAttempted = false;
      busy = true;
      root.querySelectorAll('button, input, select, textarea').forEach((node) => { node.disabled = true; });
      try {
        let reference = exercise?.reference ?? null;
        if (file) {
          const result = await prepareReference(file, { id, title, mode: 'reps' }, analyze, message);
          if (current !== generation) return;
          const upload = file.size > MAX_UPLOAD_BYTES ? await compressVideo(file, { report: message }) : file;
          if (current !== generation) return;
          if (upload.size > MAX_UPLOAD_BYTES) throw new Error('Anche ridotto, il video supera 50 MB. Usa un filmato più breve.');
          message('Caricamento del video…');
          uploadedPath = await currentStore.upload(upload, id);
          // Pose già calcolate durante l'analisi: le linee sul riferimento sono subito pronte.
          if (result?.pose) saveCachedPose(`path:${uploadedPath}`, result.pose).catch(() => {});
          reference = { path: uploadedPath, name: file.name, kind: result?.kind ?? null, profile: result?.profile ?? null };
        }
        if (current !== generation) {
          if (uploadedPath) await currentStore.removeUpload(uploadedPath).catch(() => {});
          return;
        }
        const next = structuredClone(data);
        const saved = { id, title, instructions, reference };
        const index = next.exercises.findIndex((item) => item.id === id);
        if (index < 0) next.exercises.push(saved); else next.exercises[index] = saved;
        saveAttempted = true;
        await currentStore.save(next);
        uploadedPath = null;
        if (current === generation) { data = next; busy = false; go('exercises'); message('Esercizio salvato nel tuo account coach.'); }
      } catch (error) {
        // Una risposta persa potrebbe nascondere un salvataggio riuscito: non eliminare un video già referenziato.
        if (uploadedPath && !saveAttempted) await currentStore.removeUpload(uploadedPath).catch(() => {});
        if (current === generation) message(error.message || 'Non riesco a salvare l’esercizio. Riprova.');
      } finally {
        if (current === generation) { busy = false; root.querySelectorAll('button, input, select, textarea').forEach((node) => { node.disabled = false; }); }
      }
    };
  }

  function assignForm(templateId) {
    const template = data.templates.find((item) => item.id === templateId);
    if (!template) return go('templates');
    shell('Assegna la scheda', template.title,
      `<form class="editor-form" id="coachAssignForm">${data.clients.map((item) => {
        const exists = data.assignments.some((plan) => plan.clientId === item.id && plan.templateId === templateId);
        return `<label class="mode-choice"><input type="checkbox" name="client" value="${escape(item.id)}" ${exists ? 'disabled' : ''} /><span>${escape(item.name)}${exists ? ' · già assegnata' : ''}</span></label>`;
      }).join('')}<p class="form-help">Ogni cliente riceve una copia indipendente. Puoi personalizzarla dalla sua pagina.</p><button type="submit" class="primary-button">Assegna ai clienti selezionati →</button></form>`, 'templates');
    root.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      try {
        const ids = [...root.querySelectorAll('[name="client"]:checked')].map((node) => node.value);
        if (!ids.length) throw new Error('Seleziona almeno un cliente di prova.');
        const next = structuredClone(data);
        for (const id of ids) next.assignments.push(assignmentSnapshot(data, templateId, id));
        void commit(next, () => { go('clients'); message(`Scheda assegnata a ${ids.length} clienti di prova.`); });
      } catch (error) { message(error.message); }
    };
  }
  function singleExerciseForm(exerciseId) {
    const exercise = data.exercises.find((item) => item.id === exerciseId);
    if (!exercise) return go('exercises');
    shell('Assegna esercizio', `Prepara ${exercise.title} e scegli i clienti di prova. La scheda creata resterà disponibile come template.`,
      `<form class="editor-form" id="coachSingleAssignForm"><label class="editor-field">Nome della scheda<input name="title" maxlength="120" required value="${escape(exercise.title)}" /></label>
      <div class="coach-prescription"><h2>${escape(exercise.title)}</h2>${prescriptionFields({ mode: 'reps', sets: 3, reps: 8 }, '')}</div>
      <div class="section-heading"><h2>Assegna a</h2></div>${data.clients.map((item) => `<label class="mode-choice"><input type="checkbox" name="client" value="${escape(item.id)}" /><span>${escape(item.name)}</span></label>`).join('')}
      <button type="submit" class="primary-button">Assegna esercizio →</button></form>`, 'exercises');
    wirePrescription(root.querySelector('.coach-prescription'));
    root.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      try {
        const ids = [...root.querySelectorAll('[name="client"]:checked')].map((node) => node.value);
        if (!ids.length) throw new Error('Seleziona almeno un cliente di prova.');
        const title = root.querySelector('[name="title"]').value.trim();
        if (!title) throw new Error('Inserisci il nome della scheda.');
        const template = { id: makeId(), title, exercises: [{ id: makeId(), libraryId: exercise.id, title: exercise.title, ...readPrescription(root.querySelector('.coach-prescription')) }] };
        const next = structuredClone(data);
        next.templates.push(template);
        for (const id of ids) next.assignments.push(assignmentSnapshot(next, template.id, id));
        void commit(next, () => { go('clients'); message(`Esercizio assegnato a ${ids.length} clienti di prova.`); });
      } catch (error) { message(error.message); }
    };
  }
  function clientPage(id) {
    const customer = data.clients.find((item) => item.id === id);
    if (!customer) return go('clients');
    const plans = data.assignments.filter((item) => item.clientId === id);
    shell(customer.name, 'Cliente fittizio · qui gestisci soltanto le schede assegnate.',
      `${plans.length ? action('Prova come cliente →', 'preview', id) : ''}<div class="section-heading section-heading-spaced"><h2>Schede assegnate</h2></div>` + cards(plans, (item) =>
        `<article class="coach-card"><h2>${escape(item.title)}</h2><p>${item.exercises.length} esercizi · versione ${item.version}</p><ul>${item.exercises.map((exercise) => `<li>${escape(exercise.title)} · ${escape(exerciseSummary(exercise))}</li>`).join('')}</ul><div class="coach-card-actions">${action('Personalizza copia', 'edit-assignment', item.id)}${data.templates.some((template) => template.id === item.templateId) ? action('Aggiorna dal template', 'refresh-assignment', item.id) : ''}${action('Rimuovi scheda', 'remove-assignment', item.id)}</div></article>`, 'Assegna una scheda dalla sezione Template.'), 'clients');
  }
  function assignmentForm(id) {
    const plan = data.assignments.find((item) => item.id === id);
    if (!plan) return go('clients');
    shell('Personalizza la copia', 'Queste modifiche riguardano soltanto questo cliente.',
      `<form class="editor-form" id="coachAssignmentForm"><label class="editor-field">Nome della scheda<input name="title" required maxlength="120" value="${escape(plan.title)}" /></label>${plan.exercises.map((item, index) => `<div class="coach-prescription" data-index="${index}"><h2>${escape(item.title)}</h2>${prescriptionFields(item, `row${index}-`)}</div>`).join('')}<button type="submit" class="primary-button">Salva copia del cliente →</button></form>`, 'clients');
    root.querySelectorAll('.coach-prescription').forEach(wirePrescription);
    root.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      try {
        const title = root.querySelector('[name="title"]').value.trim();
        if (!title) throw new Error('Inserisci il nome della scheda.');
        const next = structuredClone(data);
        const saved = next.assignments.find((item) => item.id === id);
        saved.title = title; saved.version += 1; saved.updatedAt = Date.now();
        root.querySelectorAll('.coach-prescription').forEach((row, index) => {
          const previous = saved.exercises[index];
          const { mode, sets, reps, minutes, ...metadata } = previous;
          saved.exercises[index] = { ...metadata, ...readPrescription(row, `row${index}-`) };
        });
        void commit(next, () => go('client', plan.clientId));
      } catch (error) { message(error.message); }
    };
  }
  async function videoPage(id) {
    const exercise = data.exercises.find((item) => item.id === id);
    if (!exercise?.reference) return go('exercises');
    shell(exercise.title, 'Video di riferimento della tua libreria.', '<div class="reference-frame"><video controls playsinline preload="metadata" poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></video></div>', 'exercises');
    const player = root.querySelector('video');
    keepFrameFitted(player);
    try {
      player.src = exercise.reference.builtin === 'curl' ? CURL_EXERCISE.referenceVideo : await coachVideoUrl(client, exercise.reference);
    } catch { message('Non riesco a caricare il video. Controlla la connessione.'); }
  }

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || busy || !data) return;
    const id = target.dataset.id;
    switch (target.dataset.action) {
      case 'tab': case 'back': go(id); break;
      case 'new-template': go('template'); break;
      case 'edit-template': go('template', id); break;
      case 'new-exercise': go('exercise'); break;
      case 'edit-exercise': go('exercise', id); break;
      case 'single-assign': go('single-assign', id); break;
      case 'assign': go('assign', id); break;
      case 'client': go('client', id); break;
      case 'edit-assignment': go('assignment', id); break;
      case 'video': go('video', id); break;
      case 'preview': onPreview(data.clients.find((item) => item.id === id), clientAssignments(data, id)); break;
      case 'refresh-assignment': {
        const plan = data.assignments.find((item) => item.id === id);
        if (!confirm('Aggiornare questa copia dal template attuale? Serie, ripetizioni, indicazioni e video personalizzati verranno sostituiti.')) break;
        try {
          const next = structuredClone(data);
          next.assignments[next.assignments.findIndex((item) => item.id === id)] = assignmentSnapshot(data, plan.templateId, plan.clientId, plan);
          void commit(next, () => go('client', plan.clientId));
        } catch (error) { message(error.message); }
        break;
      }
      case 'remove-assignment': {
        const plan = data.assignments.find((item) => item.id === id);
        if (!confirm('Rimuovere questa scheda dal cliente di prova?')) break;
        const next = structuredClone(data); next.assignments = next.assignments.filter((item) => item.id !== id);
        void commit(next, () => go('client', plan.clientId)); break;
      }
      case 'delete-template': {
        if (!confirm('Eliminare il template? Le copie già assegnate resteranno disponibili.')) break;
        const next = structuredClone(data); next.templates = next.templates.filter((item) => item.id !== id);
        void commit(next, () => go('templates')); break;
      }
      case 'delete-exercise': {
        if (data.templates.some((item) => item.exercises.some((row) => row.libraryId === id))) { message('Rimuovi prima l’esercizio dai template che lo utilizzano.'); break; }
        if (!confirm('Eliminare l’esercizio dalla libreria? Le copie assegnate restano disponibili.')) break;
        const next = structuredClone(data); next.exercises = next.exercises.filter((item) => item.id !== id);
        void commit(next, () => go('exercises')); break;
      }
    }
  });

  return {
    async enter(supabase, user) {
      if (owner === user.id && data) return;
      if (owner === user.id && loading) return loading;
      generation += 1;
      const current = generation;
      owner = user.id; client = supabase; store = createCoachStore(client, owner); data = null;
      root.innerHTML = '<p class="account-message">Caricamento della tua area coach…</p>';
      loading = (async () => {
        try {
          const loaded = await store.load();
          if (current !== generation) return;
          data = loaded; render();
        } catch {
          if (current !== generation) return;
          owner = null;
          root.innerHTML = '<p class="account-message">Area coach non disponibile. Controlla la connessione e ricarica la pagina.</p>';
        } finally { if (current === generation) loading = null; }
      })();
      return loading;
    },
    reset() { generation += 1; owner = null; data = null; loading = null; busy = false; view = 'templates'; root.replaceChildren(); },
    isBusy() { return busy; },
  };
}
