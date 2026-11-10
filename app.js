import { appOptions, firebaseConfig } from "./firebase-config.js";
import { DEV_MODE, getCurrentUser, login, logout } from "./auth.js";

const FIREBASE_VERSION = "12.18.0";
const ACTIVITIES = appOptions.collectionName;
const NOTICES = "notices";
const EVENTS = "events";
const LOCAL_PREFIX = "agenda-turma-b:DEV:";
const LOCAL_PROGRESS_KEY = `${LOCAL_PREFIX}progress:v1`;
const SUBJECTS = new Set(["GDE", "DesSoft", "InstruMed", "DesProd", "Tópicos", "ModSim"]);
const SOURCES = { lideres: "Líderes", professor: "Professor" };
const TYPES = { lab: "Laboratório", workshop: "Workshop", vaga: "Vaga/Oportunidade", outro: "Outro" };
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLASS_SIZE = appOptions.classSize;
const DAY_MS = 86_400_000;
const TRASH_DAYS = 7;
const LATE_ALERT_DAYS = 7; // "Atrasada" em vermelho só até 7 dias depois do prazo.
const ICONS = {
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  delete: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5",
  restore: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4",
};

const elements = {
  main: document.querySelector("main"),
  tabs: document.querySelector("#tabs"),
  form: document.querySelector("#activity-form"),
  date: document.querySelector("#activity-date"),
  title: document.querySelector("#activity-title"),
  subject: document.querySelector("#activity-subject"),
  noticeForm: document.querySelector("#notice-form"),
  noticeDetailField: document.querySelector("#notice-detail-field"),
  eventForm: document.querySelector("#event-form"),
  subjectFilter: document.querySelector("#subject-filter"),
  typeFilter: document.querySelector("#type-filter"),
  activitiesList: document.querySelector("#activities-list"),
  historyList: document.querySelector("#history-list"),
  trashList: document.querySelector("#trash-list"),
  noticesList: document.querySelector("#notices-list"),
  noticeTrashList: document.querySelector("#notice-trash-list"),
  eventsList: document.querySelector("#events-list"),
  eventTrashList: document.querySelector("#event-trash-list"),
  activitiesEmpty: document.querySelector("#activities-empty"),
  historyEmpty: document.querySelector("#history-empty"),
  trashEmpty: document.querySelector("#trash-empty"),
  noticesEmpty: document.querySelector("#notices-empty"),
  noticeTrashEmpty: document.querySelector("#notice-trash-empty"),
  eventsEmpty: document.querySelector("#events-empty"),
  eventTrashEmpty: document.querySelector("#event-trash-empty"),
  activitiesCount: document.querySelector("#activities-count"),
  historyCount: document.querySelector("#history-count"),
  trashCount: document.querySelector("#trash-count"),
  noticesCount: document.querySelector("#notices-count"),
  noticeTrashCount: document.querySelector("#notice-trash-count"),
  eventsCount: document.querySelector("#events-count"),
  eventTrashCount: document.querySelector("#event-trash-count"),
  setupBanner: document.querySelector("#setup-banner"),
  setupTitle: document.querySelector("#setup-title"),
  setupMessage: document.querySelector("#setup-message"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  deleteDialog: document.querySelector("#delete-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogDescription: document.querySelector("#dialog-description"),
  confirmDelete: document.querySelector("#confirm-delete"),
  toast: document.querySelector("#toast"),
  loginForm: document.querySelector("#login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginHint: document.querySelector("#login-hint"),
  userName: document.querySelector("#user-name"),
  logoutButton: document.querySelector("#logout-button"),
  noAccessEmail: document.querySelector("#no-access-email"),
  noAccessLogout: document.querySelector("#no-access-logout"),
};

// Tudo o que muda entre coleções: formulário, validação e textos.
const collections = {
  [ACTIVITIES]: {
    name: ACTIVITIES,
    form: elements.form,
    headings: ["Nova atividade", "Editar atividade"],
    addLabels: ["Adicionando…", "Adicionar atividade"],
    isValid: isValidActivity,
    read: readActivity,
    defaults: { doneCount: 0 },
    texts: {
      added: "Atividade adicionada à agenda.",
      trashed: "Atividade movida para a lixeira.",
      restored: "Atividade restaurada.",
      dialogTitle: "Apagar esta atividade?",
      trashNote: "Ela fica na lixeira por 7 dias e pode ser restaurada.",
    },
  },
  [NOTICES]: {
    name: NOTICES,
    form: elements.noticeForm,
    headings: ["Novo aviso", "Editar aviso"],
    addLabels: ["Publicando…", "Publicar aviso"],
    isValid: isValidNotice,
    read: readNotice,
    sync: syncNoticeForm,
    describe: describeNotice,
    texts: {
      added: "Aviso publicado.",
      trashed: "Aviso movido para a lixeira.",
      restored: "Aviso restaurado.",
      dialogTitle: "Apagar este aviso?",
      trashNote: "Ele fica na lixeira por 7 dias e pode ser restaurado.",
    },
  },
  [EVENTS]: {
    name: EVENTS,
    form: elements.eventForm,
    headings: ["Novo evento", "Editar evento"],
    addLabels: ["Publicando…", "Publicar evento"],
    isValid: isValidEvent,
    read: readEvent,
    describe: describeEvent,
    texts: {
      added: "Evento publicado.",
      trashed: "Evento movido para a lixeira.",
      restored: "Evento restaurado.",
      dialogTitle: "Apagar este evento?",
      trashNote: "Ele fica na lixeira por 7 dias e pode ser restaurado.",
    },
  },
};

const state = {
  data: { [ACTIVITIES]: [], [NOTICES]: [], [EVENTS]: [] },
  done: new Set(),
  user: null,
  service: null,
  filters: { [ACTIVITIES]: "all", [EVENTS]: "all" },
  pendingDelete: null,
  justToggled: null,
  lastCounts: new Map(),
  renderQueued: false,
  toastTimer: null,
};

start();

async function start() {
  bindEvents();
  elements.loginHint.hidden = !DEV_MODE;
  state.user = await getCurrentUser();
  // "fora": e-mail do Insper que não está na lista da turma (/members). Não carrega nada.
  document.body.dataset.role = !state.user ? "anon" : state.user.member ? state.user.role : "fora";
  elements.userName.textContent = state.user?.name ?? "";

  if (!state.user) {
    setConnection("offline", "Entre para ver a agenda");
    return;
  }

  if (!state.user.member) {
    elements.noAccessEmail.textContent = `Conta usada: ${state.user.email}`;
    setConnection("offline", "Acesso restrito à Turma B");
    return;
  }

  createChips(elements.subjectFilter, ACTIVITIES, "Todas", [...SUBJECTS].map((subject) => [subject, subject]));
  createChips(elements.typeFilter, EVENTS, "Todos", Object.entries(TYPES));
  syncNoticeForm();
  if (revealTab(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  render();

  if (!hasFirebaseConfig()) {
    useLocalMode();
    return;
  }

  try {
    state.service = await createFirebaseService(state.user);
    setConnection("online", "Sincronizado com a turma");
    subscribeAll(handleRemoteError);
  } catch (error) {
    console.error("Não foi possível iniciar o Firebase:", error);
    useLocalMode("Não foi possível conectar ao Firebase. A agenda entrou em modo local.");
  }
}

function bindEvents() {
  Object.values(collections).forEach((config) => {
    config.form.addEventListener("submit", (event) => handleSubmit(event, config));
    config.form.querySelector(".cancel-edit").addEventListener("click", () => {
      stopEdit(config);
      config.form.elements.title.focus();
    });
  });
  elements.noticeForm.elements.source.addEventListener("change", syncNoticeForm);
  elements.subjectFilter.addEventListener("click", handleFilterClick);
  elements.typeFilter.addEventListener("click", handleFilterClick);
  elements.main.addEventListener("change", handleListChange);
  elements.main.addEventListener("click", handleRowClick);
  elements.tabs.addEventListener("click", handleTabClick);
  elements.tabs.addEventListener("keydown", handleTabKey);
  document.addEventListener("click", handleAnchorClick);
  elements.deleteDialog.addEventListener("close", handleDialogClose);
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.loginForm.addEventListener("click", handleTestLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.noAccessLogout.addEventListener("click", handleLogout);
}

function isLeader() {
  return state.user?.role === "lider";
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    await login(elements.loginEmail.value);
    location.reload();
  } catch (error) {
    showToast(error.message);
  }
}

function handleTestLogin(event) {
  const button = event.target.closest("button[data-email]");
  if (!button) return;
  elements.loginEmail.value = button.dataset.email;
  elements.loginForm.requestSubmit();
}

async function handleLogout() {
  await logout();
  location.reload();
}

function hasFirebaseConfig() {
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.length > 4 && !value.startsWith("COLE_");
  });
}

async function useLocalMode(message) {
  await seedLocalItems();
  state.service = createLocalService(state.user.id);
  setConnection("offline", "Modo local");
  elements.setupBanner.hidden = false;

  if (message) {
    elements.setupTitle.textContent = "Sincronização indisponível";
    elements.setupMessage.textContent = message;
  }

  subscribeAll();
}

function subscribeAll(onError) {
  Object.values(collections).forEach((config) => {
    state.service.subscribe(config.name, (items) => handleItems(config, items), onError);
  });
  state.service.subscribeDone(handleDone, onError);
}

// Progresso individual: /progress/{uid} guarda { done: { [activityId]: true } }, legível só
// pelo próprio usuário. A atividade guarda apenas doneCount, então ninguém vê quem não fez.
async function createFirebaseService(user) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, authModule, firestore] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  await authModule.signInAnonymously(auth);

  const db = firestore.getFirestore(app);
  const now = firestore.serverTimestamp;
  const reference = (name, id) => firestore.doc(db, name, id);
  const progress = firestore.doc(db, "progress", user.id);
  const update = (name, id, fields) =>
    firestore.updateDoc(reference(name, id), { ...fields, updatedAt: now() });

  return {
    // As regras só deixam alunos lerem o que não está na lixeira, então a consulta
    // deles precisa pedir exatamente isso (regras não filtram, recusam).
    subscribe(name, onItems, onError) {
      const source = firestore.collection(db, name);
      firestore.onSnapshot(
        user.role === "lider" ? source : firestore.query(source, firestore.where("deletedAt", "==", null)),
        (snapshot) => {
          onItems(
            snapshot.docs.map((item) => ({
              id: item.id,
              ...item.data({ serverTimestamps: "estimate" }),
            })),
          );
        },
        onError,
      );
    },

    subscribeDone(onDone, onError) {
      firestore.onSnapshot(progress, (snapshot) => onDone(Object.keys(snapshot.data()?.done ?? {})), onError);
    },

    add(name, data) {
      return firestore.addDoc(firestore.collection(db, name), {
        ...data,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      });
    },

    update,
    trash: (name, id) => update(name, id, { deletedAt: now() }),
    restore: (name, id) => update(name, id, { deletedAt: null }),

    setDone(id, done) {
      const batch = firestore.writeBatch(db);
      batch.set(progress, { done: { [id]: done ? true : firestore.deleteField() } }, { merge: true });
      batch.update(reference(ACTIVITIES, id), { doneCount: firestore.increment(done ? 1 : -1) });
      return batch.commit();
    },
  };
}

function createLocalService(userId) {
  const cache = {};
  const listeners = {};
  const progress = readLocal(LOCAL_PROGRESS_KEY, {}); // { [userId]: [activityId, ...] }
  let onDone = null;

  const items = (name) => (cache[name] ??= readLocal(localKey(name), []));

  const notify = (name) => {
    const doneIds = Object.values(progress).flat();
    listeners[name]?.(
      items(name).map((item) =>
        name === ACTIVITIES
          ? { ...item, doneCount: doneIds.filter((id) => id === item.id).length }
          : { ...item },
      ),
    );
  };

  const save = (name) => {
    localStorage.setItem(localKey(name), JSON.stringify(items(name)));
    notify(name);
  };

  const update = async (name, id, fields) => {
    cache[name] = items(name).map((item) =>
      item.id === id ? { ...item, ...fields, updatedAt: new Date().toISOString() } : item,
    );
    save(name);
  };

  return {
    subscribe(name, onItems) {
      listeners[name] = onItems;
      notify(name);
    },

    subscribeDone(callback) {
      onDone = callback;
      onDone(progress[userId] ?? []);
    },

    async add(name, data) {
      const now = new Date().toISOString();
      items(name).push({ id: crypto.randomUUID(), ...data, deletedAt: null, createdAt: now, updatedAt: now });
      save(name);
    },

    update,
    trash: (name, id) => update(name, id, { deletedAt: new Date().toISOString() }),
    restore: (name, id) => update(name, id, { deletedAt: null }),

    async setDone(id, done) {
      const mine = (progress[userId] ?? []).filter((item) => item !== id);
      progress[userId] = done ? [...mine, id] : mine;
      localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(progress));
      notify(ACTIVITIES);
      onDone?.(progress[userId]);
    },
  };
}

function localKey(name) {
  return `${LOCAL_PREFIX}${name}:v1`;
}

// Dev: popula o localStorage com o snapshot estático na primeira execução.
// Para voltar ao snapshot original, rode no console: resetDevData()
async function seedLocalItems() {
  if (localStorage.getItem(localKey(ACTIVITIES)) !== null || !appOptions.seedUrl) return;
  try {
    const response = await fetch(appOptions.seedUrl, { cache: "no-store" });
    if (response.ok) localStorage.setItem(localKey(ACTIVITIES), JSON.stringify(await response.json()));
  } catch (error) {
    console.warn("Sem snapshot de dev:", error);
  }
}

window.resetDevData = () => {
  Object.keys(collections).forEach((name) => localStorage.removeItem(localKey(name)));
  localStorage.removeItem(LOCAL_PROGRESS_KEY);
  location.reload();
};

function readLocal(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved?.constructor === fallback.constructor ? saved : fallback;
  } catch {
    return fallback;
  }
}

function isValidActivity(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    SUBJECTS.has(item.subject) &&
    DATE_PATTERN.test(item.dueDate)
  );
}

function isValidNotice(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    Object.hasOwn(SOURCES, item.source) &&
    DATE_PATTERN.test(item.date)
  );
}

function isValidEvent(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.description === "string" &&
    Object.hasOwn(TYPES, item.type) &&
    DATE_PATTERN.test(item.date)
  );
}

// Só aceita links http(s); javascript:, data: e outros esquemas viram null.
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function handleItems(config, items) {
  state.data[config.name] = items.filter(config.isValid);
  scheduleRender();
}

function handleDone(ids) {
  state.done = new Set(ids);
  scheduleRender();
}

// Junta num só render as atualizações que chegam no mesmo quadro (atividades + progresso).
function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function handleRemoteError(error) {
  console.error("Erro ao sincronizar a agenda:", error);
  setConnection("offline", "Erro de sincronização");
  elements.setupBanner.hidden = false;
  elements.setupTitle.textContent = "A agenda não está sincronizando";
  elements.setupMessage.textContent =
    "Confira a configuração e as regras do Firestore antes de compartilhar o link.";
  showToast("Não foi possível atualizar os dados da turma.");
}

// ---------- Formulários (criar e editar) ----------

function readActivity() {
  const activity = {
    dueDate: elements.date.value,
    title: normalizeText(elements.title.value),
    subject: elements.subject.value,
  };
  if (activity.title.length < 3 || !SUBJECTS.has(activity.subject)) {
    showToast("Revise o título e a disciplina da atividade.");
    return null;
  }
  return activity;
}

function readNotice() {
  const fields = elements.noticeForm.elements;
  const fromProfessor = fields.source.value === "professor";
  const notice = {
    title: normalizeText(fields.title.value),
    body: fields.body.value.trim(),
    source: fields.source.value,
    sourceDetail: fromProfessor ? normalizeText(fields.sourceDetail.value) : "",
    date: fields.date.value,
    pinned: fields.pinned.checked,
  };
  if (notice.title.length < 3 || !notice.body || (fromProfessor && notice.sourceDetail.length < 2)) {
    showToast("Revise o título, o texto e a origem do aviso.");
    return null;
  }
  return notice;
}

function readEvent() {
  const fields = elements.eventForm.elements;
  const link = fields.link.value.trim();
  const url = link ? safeUrl(link) : null;
  const event = {
    type: fields.type.value,
    title: normalizeText(fields.title.value),
    description: fields.description.value.trim(),
    date: fields.date.value,
    link: url ? url.href : "",
  };
  if (event.title.length < 3 || !event.description || !Object.hasOwn(TYPES, event.type)) {
    showToast("Revise o tipo, o título e a descrição do evento.");
    return null;
  }
  if (link && !url) {
    showToast("O link precisa começar com http:// ou https://.");
    fields.link.focus();
    return null;
  }
  return event;
}

// Mostra "Professor e disciplina" só quando a origem é Professor; data padrão = hoje.
function syncNoticeForm() {
  const fields = elements.noticeForm.elements;
  const fromProfessor = fields.source.value === "professor";
  elements.noticeDetailField.hidden = !fromProfessor;
  fields.sourceDetail.required = fromProfessor;
  if (!fields.date.value) fields.date.value = toDateInputValue(new Date());
}

async function handleSubmit(event, config) {
  event.preventDefault();
  if (!isLeader() || !state.service || !config.form.reportValidity()) return;

  const data = config.read();
  if (!data) return;

  const editingId = config.editingId;
  setFormBusy(config, true);
  try {
    if (editingId) {
      await state.service.update(config.name, editingId, data);
      showToast("Alterações salvas.");
    } else {
      await state.service.add(config.name, { ...data, ...config.defaults });
      showToast(config.texts.added);
    }
    stopEdit(config);
    config.form.elements.title.focus();
  } catch (error) {
    console.error("Erro ao salvar:", error);
    showToast(editingId ? "Não foi possível salvar. Tente novamente." : "Não foi possível adicionar. Tente novamente.");
  } finally {
    setFormBusy(config, false);
  }
}

function startEdit(config, item) {
  config.editingId = item.id;
  for (const field of config.form.elements) {
    if (!(field.name in item)) continue;
    if (field.type === "checkbox") field.checked = Boolean(item[field.name]);
    else field.value = item[field.name];
  }
  config.sync?.();
  setEditing(config, true);
  config.form.scrollIntoView({ block: "center" });
  config.form.elements.title.focus({ preventScroll: true });
}

function stopEdit(config) {
  config.editingId = null;
  config.form.reset();
  config.sync?.();
  setEditing(config, false);
}

function setEditing(config, editing) {
  config.form.closest("section").querySelector("h2").textContent = config.headings[editing ? 1 : 0];
  config.form.querySelector(".cancel-edit").hidden = !editing;
  setFormBusy(config, false);
}

function setFormBusy(config, isBusy) {
  const labels = config.editingId ? ["Salvando…", "Salvar alterações"] : config.addLabels;
  const submit = config.form.querySelector('[type="submit"]');
  submit.disabled = isBusy;
  submit.querySelector("span").textContent = labels[isBusy ? 0 : 1];
}

// ---------- Ações nas listas ----------

async function handleListChange(event) {
  const checkbox = event.target.closest('input[data-action="toggle"]');
  if (!checkbox || !state.service) return;

  const done = checkbox.checked;
  checkbox.disabled = true;
  state.justToggled = checkbox.dataset.id;
  try {
    await state.service.setDone(checkbox.dataset.id, done);
    showToast(done ? "Marcada como feita." : "Marcação desfeita.");
  } catch (error) {
    console.error("Erro ao salvar progresso:", error);
    checkbox.checked = !done;
    checkbox.disabled = false;
    showToast("Não foi possível salvar sua marcação.");
  }
}

function handleRowClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !isLeader()) return;

  const config = collections[button.dataset.collection];
  const item = config && state.data[config.name].find((entry) => entry.id === button.dataset.id);
  if (!item) return;

  if (button.dataset.action === "edit") startEdit(config, item);
  if (button.dataset.action === "delete") confirmTrash(config, item);
  if (button.dataset.action === "restore") restoreItem(config, item);
}

function confirmTrash(config, item) {
  state.pendingDelete = { config, id: item.id };
  elements.dialogTitle.textContent = config.texts.dialogTitle;
  elements.dialogDescription.textContent = `“${item.title}” sai da agenda de todos. ${config.texts.trashNote}`;
  elements.deleteDialog.showModal();
}

async function handleDialogClose() {
  const pending = state.pendingDelete;
  state.pendingDelete = null;
  if (elements.deleteDialog.returnValue !== "confirm" || !pending) return;

  const { config, id } = pending;
  elements.confirmDelete.disabled = true;
  try {
    await animateOut(id);
    await state.service.trash(config.name, id);
    if (config.editingId === id) stopEdit(config);
    showToast(config.texts.trashed);
  } catch (error) {
    console.error("Erro ao apagar:", error);
    render();
    showToast("Não foi possível apagar. Tente novamente.");
  } finally {
    elements.confirmDelete.disabled = false;
  }
}

async function restoreItem(config, item) {
  try {
    await animateOut(item.id);
    await state.service.restore(config.name, item.id);
    showToast(config.texts.restored);
  } catch (error) {
    console.error("Erro ao restaurar:", error);
    render();
    showToast("Não foi possível restaurar. Tente novamente.");
  }
}

// Espera a animação de saída da linha (com movimento reduzido não há animação e segue direto).
async function animateOut(id) {
  const selector = CSS.escape(id);
  const row = document.querySelector(`.activity-row[data-id="${selector}"], .entry[data-id="${selector}"]`);
  if (!row) return;
  row.classList.add("is-leaving");
  await Promise.allSettled(row.getAnimations().map((animation) => animation.finished));
}

// ---------- Abas ----------

function showTab(panel) {
  elements.tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
    const selected = tab.getAttribute("aria-controls") === panel.id;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  });
}

function handleTabClick(event) {
  const tab = event.target.closest('[role="tab"]');
  if (tab) showTab(document.getElementById(tab.getAttribute("aria-controls")));
}

function handleTabKey(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const tabs = [...elements.tabs.querySelectorAll('[role="tab"]')];
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = tabs[(tabs.indexOf(document.activeElement) + step + tabs.length) % tabs.length];
  next.focus();
  next.click();
}

// Links como #historico ou #avisos abrem a aba que contém o destino antes de rolar até ele.
function handleAnchorClick(event) {
  const link = event.target.closest('a[href^="#"]');
  if (link) revealTab(link.hash);
}

function revealTab(hash) {
  const panel = hash && document.getElementById(hash.slice(1))?.closest('[role="tabpanel"]');
  if (!panel?.hidden) return false;
  showTab(panel);
  return true;
}

// ---------- Filtro ----------

// options: [[valor, rótulo], ...]. O grupo guarda a coleção que ele filtra.
function createChips(group, collection, allLabel, options) {
  group.dataset.collection = collection;
  const chips = [["all", allLabel], ...options].map(([value, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = value;
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(value === state.filters[collection]));
    return chip;
  });
  group.replaceChildren(...chips);
}

function handleFilterClick(event) {
  const chip = event.target.closest("button[data-value]");
  if (!chip) return;
  const group = chip.parentElement;
  state.filters[group.dataset.collection] = chip.dataset.value;
  group.querySelectorAll(".chip").forEach((item) => {
    item.setAttribute("aria-pressed", String(item === chip));
  });
  render();
}

// ---------- Render ----------

function render() {
  renderActivities();
  renderNotices();
  renderEvents();
  state.justToggled = null;
  state.lastCounts = new Map(state.data[ACTIVITIES].map((item) => [item.id, doneCountOf(item)]));
}

function renderActivities() {
  const today = toDateInputValue(new Date());
  const items = state.data[ACTIVITIES];
  const filter = state.filters[ACTIVITIES];
  const inFilter = (item) => filter === "all" || item.subject === filter;
  const active = items.filter((item) => !item.deletedAt && inFilter(item));
  const upcoming = active.filter((item) => item.dueDate >= today).sort((a, b) => compareDates(a, b, 1));
  const history = active.filter((item) => item.dueDate < today).sort((a, b) => compareDates(a, b, -1));
  const trash = items.filter(isInTrash).sort(byDeletedAt);

  renderActivityList(elements.activitiesList, upcoming, "upcoming");
  renderActivityList(elements.historyList, history, "history");
  renderActivityList(elements.trashList, isLeader() ? trash : [], "trash");

  setCount(elements.activitiesCount, elements.activitiesEmpty, upcoming.length, "atividade pendente", "atividades pendentes");
  setCount(elements.historyCount, elements.historyEmpty, history.length, "atividade passada", "atividades passadas");
  setCount(elements.trashCount, elements.trashEmpty, trash.length, "atividade na lixeira", "atividades na lixeira");
}

function renderNotices() {
  const items = state.data[NOTICES];
  const active = items.filter((item) => !item.deletedAt).sort(compareNotices);
  const trash = items.filter(isInTrash).sort(byDeletedAt);

  renderEntryList(elements.noticesList, active, NOTICES, false);
  renderEntryList(elements.noticeTrashList, isLeader() ? trash : [], NOTICES, true);

  setCount(elements.noticesCount, elements.noticesEmpty, active.length, "aviso", "avisos");
  setCount(elements.noticeTrashCount, elements.noticeTrashEmpty, trash.length, "aviso na lixeira", "avisos na lixeira");
}

// Eventos com data passada saem da lista sozinhos (não são apagados).
function renderEvents() {
  const today = toDateInputValue(new Date());
  const items = state.data[EVENTS];
  const filter = state.filters[EVENTS];
  const upcoming = items
    .filter((item) => !item.deletedAt && item.date >= today && (filter === "all" || item.type === filter))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR"));
  const trash = items.filter(isInTrash).sort(byDeletedAt);

  renderEntryList(elements.eventsList, upcoming, EVENTS, false);
  renderEntryList(elements.eventTrashList, isLeader() ? trash : [], EVENTS, true);

  setCount(elements.eventsCount, elements.eventsEmpty, upcoming.length, "evento", "eventos");
  setCount(elements.eventTrashCount, elements.eventTrashEmpty, trash.length, "evento na lixeira", "eventos na lixeira");
}

function setCount(badge, empty, total, singular, plural) {
  badge.textContent = String(total);
  badge.setAttribute("aria-label", `${total} ${total === 1 ? singular : plural}`);
  empty.hidden = total !== 0;
}

function isInTrash(item) {
  return Boolean(item.deletedAt) && Date.now() - toMillis(item.deletedAt) < TRASH_DAYS * DAY_MS;
}

function byDeletedAt(a, b) {
  return toMillis(b.deletedAt) - toMillis(a.deletedAt);
}

// Fixados primeiro, depois os mais recentes.
function compareNotices(a, b) {
  return (
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    b.date.localeCompare(a.date) ||
    (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0)
  );
}

// Linhas que não estavam na lista antes ganham a animação de entrada.
function previousIds(list) {
  return new Set([...list.children].map((child) => child.dataset.id));
}

function renderActivityList(list, items, kind) {
  const before = previousIds(list);
  const fragment = document.createDocumentFragment();
  let group = null;

  items.forEach((activity) => {
    if (kind === "upcoming" && weekLabel(activity.dueDate) !== group) {
      group = weekLabel(activity.dueDate);
      fragment.append(createGroupLabel(group));
    }

    const row = document.createElement("li");
    row.className = "activity-row";
    row.dataset.id = activity.id;
    row.classList.toggle("is-done", state.done.has(activity.id));
    row.classList.toggle("is-new", before.size > 0 && !before.has(activity.id));

    row.append(
      kind === "trash" ? createSpacer("task-check") : createCheckbox(activity),
      createDateBlock(activity.dueDate),
      createActivityCopy(activity, kind),
      createSubjectBadge(activity.subject),
      createRowActions(activity, ACTIVITIES, kind === "trash"),
    );
    fragment.append(row);
  });

  list.replaceChildren(fragment);
}

// Cartões de avisos e eventos: data, conteúdo (descrito pela coleção) e ações.
function renderEntryList(list, items, collection, inTrash) {
  const before = previousIds(list);
  const cards = items.map((item) => {
    const card = document.createElement("li");
    card.className = "entry";
    card.dataset.id = item.id;
    card.classList.toggle("is-pinned", Boolean(item.pinned) && !inTrash);
    card.classList.toggle("is-new", before.size > 0 && !before.has(item.id));
    card.append(
      createDateBlock(item.date),
      createEntryCopy(item, collections[collection].describe(item), inTrash),
      createRowActions(item, collection, inTrash),
    );
    return card;
  });
  list.replaceChildren(...cards);
}

function createGroupLabel(text) {
  const label = document.createElement("li");
  label.className = "week-group";
  label.textContent = text;
  return label;
}

function createCheckbox(activity) {
  const done = state.done.has(activity.id);
  const label = document.createElement("label");
  label.className = "task-check";
  label.classList.toggle("is-changed", activity.id === state.justToggled);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = done;
  input.dataset.id = activity.id;
  input.dataset.action = "toggle";
  input.setAttribute(
    "aria-label",
    done ? `Desmarcar ${activity.title} como feita` : `Marcar ${activity.title} como feita`,
  );

  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  checkmark.setAttribute("aria-hidden", "true");
  checkmark.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 7"/></svg>';

  label.append(input, checkmark);
  return label;
}

function createDateBlock(date) {
  const [year, month, day] = date.split("-");
  const time = document.createElement("time");
  time.className = "date-block";
  time.dateTime = date;

  const dayElement = document.createElement("span");
  dayElement.className = "date-day";
  dayElement.textContent = day;

  const monthElement = document.createElement("span");
  monthElement.className = "date-month";
  monthElement.textContent = MONTHS[Number(month) - 1];

  time.setAttribute("aria-label", formatLongDate(date));
  time.append(dayElement, monthElement);
  time.dataset.year = year;
  return time;
}

function createActivityCopy(activity, kind) {
  const copy = document.createElement("div");
  copy.className = "activity-copy";

  const title = document.createElement("p");
  title.className = "activity-title";
  title.textContent = activity.title;
  title.title = activity.title;

  const meta = document.createElement("p");
  meta.className = "activity-meta";
  copy.append(title, meta);

  if (kind === "trash") {
    meta.textContent = `Pode ser restaurada até ${formatRestoreDate(activity)}`;
    return copy;
  }

  meta.append(createDue(activity), createProgressText(activity));
  if (kind === "upcoming") copy.append(createProgressBar(activity));
  return copy;
}

// description: { meta: [Node], body: string, link?: Node }. Todo texto entra por textContent.
function createEntryCopy(item, description, inTrash) {
  const copy = document.createElement("div");
  copy.className = "entry-copy";

  const meta = document.createElement("p");
  meta.className = "entry-meta";
  if (inTrash) meta.textContent = `Pode ser restaurado até ${formatRestoreDate(item)}`;
  else meta.append(...description.meta);

  const title = document.createElement("h3");
  title.className = "entry-title";
  title.textContent = item.title;

  const body = document.createElement("p");
  body.className = "entry-body";
  body.textContent = description.body;

  copy.append(meta, title, body);
  if (description.link && !inTrash) copy.append(description.link);
  return copy;
}

function describeNotice(notice) {
  const source = createText(
    "span",
    notice.source === "professor" ? `Professor — ${notice.sourceDetail}` : SOURCES.lideres,
  );
  const meta = notice.pinned ? [createText("span", "Fixado", "pin-label"), source] : [source];
  return { meta, body: notice.body };
}

function describeEvent(event) {
  const url = event.link ? safeUrl(event.link) : null;
  let link = null;
  if (url) {
    link = createText("a", `Abrir em ${url.hostname}`, "entry-link");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Abrir em ${url.hostname} (nova aba)`);
  }
  return { meta: [createText("span", TYPES[event.type], "type-label")], body: event.description, link };
}

function createText(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

// Contagem regressiva. Tons: late (atrasada), soon (até 48h), week (esta semana).
function createDue(activity) {
  const due = document.createElement("span");
  due.className = "due";
  const days = daysUntil(activity.dueDate);
  const done = state.done.has(activity.id);

  if (days < 0) {
    const ago = days === -1 ? "ontem" : `há ${-days} dias`;
    if (done) {
      due.textContent = `Venceu ${ago}`;
    } else if (-days <= LATE_ALERT_DAYS) {
      due.textContent = `Atrasada, venceu ${ago}`;
      due.dataset.tone = "late";
    } else {
      due.textContent = `Não marcada, venceu ${ago}`;
    }
    return due;
  }

  due.textContent = days === 0 ? "Vence hoje" : days === 1 ? "Vence amanhã" : `Em ${days} dias`;
  if (!done && days <= 2) due.dataset.tone = "soon";
  else if (!done && weekOffset(activity.dueDate) === 0) due.dataset.tone = "week";
  return due;
}

function createProgressText(activity) {
  const count = doneCountOf(activity);
  const text = document.createElement("span");
  text.className = "progress-count";
  text.textContent = count >= CLASS_SIZE ? "Turma toda concluiu" : `${count} de ${CLASS_SIZE} concluíram`;
  text.classList.toggle("is-complete", count >= CLASS_SIZE);
  text.classList.toggle("is-changing", countChanged(activity));
  return text;
}

function createProgressBar(activity) {
  const bar = document.createElement("span");
  bar.className = "progress-bar";
  bar.setAttribute("aria-hidden", "true");

  const fill = document.createElement("span");
  fill.className = "progress-fill";
  fill.style.setProperty("--p", doneCountOf(activity) / CLASS_SIZE);
  if (countChanged(activity)) {
    fill.style.setProperty("--from", state.lastCounts.get(activity.id) / CLASS_SIZE);
    fill.classList.add("is-changing");
  }

  bar.append(fill);
  return bar;
}

function doneCountOf(activity) {
  return Math.min(activity.doneCount ?? 0, CLASS_SIZE);
}

function countChanged(activity) {
  const previous = state.lastCounts.get(activity.id);
  return previous !== undefined && previous !== doneCountOf(activity);
}

function createSubjectBadge(subject) {
  const badge = document.createElement("span");
  badge.className = "subject-badge";
  badge.textContent = subject;
  return badge;
}

function createRowActions(item, collection, inTrash) {
  if (!isLeader()) return createSpacer("row-spacer");

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const buttons = inTrash
    ? [["restore", "Restaurar"]]
    : [
        ["edit", "Editar"],
        ["delete", "Apagar"],
      ];

  buttons.forEach(([action, verb]) => {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.dataset.id = item.id;
    button.dataset.collection = collection;
    button.dataset.action = action;
    button.setAttribute("aria-label", `${verb} ${item.title}`);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[action]}"/></svg>`;
    actions.append(button);
  });
  return actions;
}

function createSpacer(className) {
  const spacer = document.createElement("span");
  spacer.className = className;
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

// ---------- Utilitários de data e texto ----------

function compareDates(a, b, direction) {
  const dateComparison = a.dueDate.localeCompare(b.dueDate) * direction;
  if (dateComparison !== 0) return dateComparison;
  return a.title.localeCompare(b.title, "pt-BR");
}

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function daysUntil(value) {
  return Math.round((parseDate(value) - parseDate(toDateInputValue(new Date()))) / DAY_MS);
}

// 0 = esta semana, 1 = próxima (semanas começando na segunda).
function weekOffset(value) {
  const weekStart = (date) => date.getTime() - ((date.getDay() + 6) % 7) * DAY_MS;
  const today = parseDate(toDateInputValue(new Date()));
  return Math.round((weekStart(parseDate(value)) - weekStart(today)) / (7 * DAY_MS));
}

function weekLabel(value) {
  return ["Esta semana", "Próxima semana"][weekOffset(value)] ?? "Depois";
}

function toMillis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : Date.parse(value);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parseDate(value));
}

function formatRestoreDate(item) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(
    toMillis(item.deletedAt) + TRASH_DAYS * DAY_MS,
  );
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setConnection(mode, label) {
  elements.connectionPill.dataset.mode = mode;
  elements.connectionLabel.textContent = label;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}
