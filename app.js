import { appOptions, firebaseConfig } from "./firebase-config.js";
import { DEV_MODE, getCurrentUser, login, logout } from "./auth.js";

const FIREBASE_VERSION = "12.18.0";
const LOCAL_STORAGE_KEY = "agenda-turma-b:DEV:activities:v1";
const LOCAL_PROGRESS_KEY = "agenda-turma-b:DEV:progress:v1";
const SUBJECTS = new Set(["GDE", "DesSoft", "InstruMed", "DesProd", "Tópicos", "ModSim"]);
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
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
  form: document.querySelector("#activity-form"),
  formTitle: document.querySelector("#insert-title"),
  date: document.querySelector("#activity-date"),
  title: document.querySelector("#activity-title"),
  subject: document.querySelector("#activity-subject"),
  submit: document.querySelector("#submit-button"),
  cancelEdit: document.querySelector("#cancel-edit"),
  subjectFilter: document.querySelector("#subject-filter"),
  activitiesList: document.querySelector("#activities-list"),
  historyList: document.querySelector("#history-list"),
  trashList: document.querySelector("#trash-list"),
  activitiesEmpty: document.querySelector("#activities-empty"),
  historyEmpty: document.querySelector("#history-empty"),
  trashEmpty: document.querySelector("#trash-empty"),
  activitiesCount: document.querySelector("#activities-count"),
  historyCount: document.querySelector("#history-count"),
  trashCount: document.querySelector("#trash-count"),
  setupBanner: document.querySelector("#setup-banner"),
  setupTitle: document.querySelector("#setup-title"),
  setupMessage: document.querySelector("#setup-message"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  deleteDialog: document.querySelector("#delete-dialog"),
  dialogDescription: document.querySelector("#dialog-description"),
  confirmDelete: document.querySelector("#confirm-delete"),
  toast: document.querySelector("#toast"),
  loginForm: document.querySelector("#login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginHint: document.querySelector("#login-hint"),
  userName: document.querySelector("#user-name"),
  logoutButton: document.querySelector("#logout-button"),
};

const state = {
  items: [],
  done: new Set(),
  user: null,
  service: null,
  filter: "all",
  editingId: null,
  pendingDeleteId: null,
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
  document.body.dataset.role = state.user?.role ?? "anon";
  elements.userName.textContent = state.user?.name ?? "";

  if (!state.user) {
    setConnection("offline", "Entre para ver a agenda");
    return;
  }

  createFilterChips();
  render();

  if (!hasFirebaseConfig()) {
    useLocalMode();
    return;
  }

  try {
    state.service = await createFirebaseService(state.user.id);
    setConnection("online", "Sincronizado com a turma");
    state.service.subscribe(handleItems, handleDone, handleRemoteError);
  } catch (error) {
    console.error("Não foi possível iniciar o Firebase:", error);
    useLocalMode("Não foi possível conectar ao Firebase. A agenda entrou em modo local.");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.cancelEdit.addEventListener("click", () => {
    stopEdit();
    elements.title.focus();
  });
  elements.subjectFilter.addEventListener("click", handleFilterClick);
  [elements.activitiesList, elements.historyList, elements.trashList].forEach((list) => {
    list.addEventListener("change", handleListChange);
    list.addEventListener("click", handleRowClick);
  });
  elements.deleteDialog.addEventListener("close", handleDialogClose);
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.loginForm.addEventListener("click", handleTestLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
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

  state.service.subscribe(handleItems, handleDone);
}

// Progresso individual: /progress/{uid} guarda { done: { [activityId]: true } }, legível só
// pelo próprio usuário. A atividade guarda apenas doneCount, então ninguém vê quem não fez.
async function createFirebaseService(userId) {
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
  const activities = firestore.collection(db, appOptions.collectionName);
  const activity = (id) => firestore.doc(db, appOptions.collectionName, id);
  const progress = firestore.doc(db, "progress", userId);
  const update = (id, fields) =>
    firestore.updateDoc(activity(id), { ...fields, updatedAt: firestore.serverTimestamp() });

  return {
    subscribe(onItems, onDone, onError) {
      firestore.onSnapshot(
        activities,
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
      firestore.onSnapshot(progress, (snapshot) => onDone(Object.keys(snapshot.data()?.done ?? {})), onError);
    },

    add({ title, subject, dueDate }) {
      return firestore.addDoc(activities, {
        title,
        subject,
        dueDate,
        doneCount: 0,
        deletedAt: null,
        createdAt: firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp(),
      });
    },

    update,
    trash: (id) => update(id, { deletedAt: firestore.serverTimestamp() }),
    restore: (id) => update(id, { deletedAt: null }),

    setDone(id, done) {
      const batch = firestore.writeBatch(db);
      batch.set(progress, { done: { [id]: done ? true : firestore.deleteField() } }, { merge: true });
      batch.update(activity(id), { doneCount: firestore.increment(done ? 1 : -1) });
      return batch.commit();
    },
  };
}

function createLocalService(userId) {
  let localItems = readLocal(LOCAL_STORAGE_KEY, []).filter(isValidActivity);
  const progress = readLocal(LOCAL_PROGRESS_KEY, {}); // { [userId]: [activityId, ...] }
  let listener = null;

  const notify = () => {
    const doneIds = Object.values(progress).flat();
    listener?.onItems(
      localItems.map((item) => ({
        ...item,
        doneCount: doneIds.filter((id) => id === item.id).length,
      })),
    );
    listener?.onDone(progress[userId] ?? []);
  };

  const save = () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localItems));
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(progress));
    notify();
  };

  const update = async (id, fields) => {
    localItems = localItems.map((item) =>
      item.id === id ? { ...item, ...fields, updatedAt: new Date().toISOString() } : item,
    );
    save();
  };

  return {
    subscribe(onItems, onDone) {
      listener = { onItems, onDone };
      notify();
    },

    async add({ title, subject, dueDate }) {
      const now = new Date().toISOString();
      localItems.push({
        id: crypto.randomUUID(),
        title,
        subject,
        dueDate,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      save();
    },

    update,
    trash: (id) => update(id, { deletedAt: new Date().toISOString() }),
    restore: (id) => update(id, { deletedAt: null }),

    async setDone(id, done) {
      const mine = (progress[userId] ?? []).filter((item) => item !== id);
      progress[userId] = done ? [...mine, id] : mine;
      save();
    },
  };
}

// Dev: popula o localStorage com o snapshot estático na primeira execução.
// Para voltar ao snapshot original, rode no console: resetDevData()
async function seedLocalItems() {
  if (localStorage.getItem(LOCAL_STORAGE_KEY) !== null || !appOptions.seedUrl) return;
  try {
    const response = await fetch(appOptions.seedUrl, { cache: "no-store" });
    if (response.ok) localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(await response.json()));
  } catch (error) {
    console.warn("Sem snapshot de dev:", error);
  }
}

window.resetDevData = () => {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
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
    /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
  );
}

function handleItems(items) {
  state.items = items.filter(isValidActivity);
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
  console.error("Erro ao sincronizar atividades:", error);
  setConnection("offline", "Erro de sincronização");
  elements.setupBanner.hidden = false;
  elements.setupTitle.textContent = "A agenda não está sincronizando";
  elements.setupMessage.textContent =
    "Confira a configuração e as regras do Firestore antes de compartilhar o link.";
  showToast("Não foi possível atualizar os dados da turma.");
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!isLeader() || !state.service || !elements.form.reportValidity()) return;

  const activity = {
    dueDate: elements.date.value,
    title: normalizeTitle(elements.title.value),
    subject: elements.subject.value,
  };

  if (activity.title.length < 3 || !SUBJECTS.has(activity.subject)) {
    showToast("Revise o título e a disciplina da atividade.");
    return;
  }

  const editingId = state.editingId;
  setFormBusy(true);
  try {
    if (editingId) {
      await state.service.update(editingId, activity);
      showToast("Alterações salvas.");
    } else {
      await state.service.add(activity);
      showToast("Atividade adicionada à agenda.");
    }
    stopEdit();
    elements.title.focus();
  } catch (error) {
    console.error("Erro ao salvar atividade:", error);
    showToast(editingId ? "Não foi possível salvar. Tente novamente." : "Não foi possível adicionar. Tente novamente.");
  } finally {
    setFormBusy(false);
  }
}

function startEdit(activity) {
  state.editingId = activity.id;
  elements.date.value = activity.dueDate;
  elements.title.value = activity.title;
  elements.subject.value = activity.subject;
  elements.formTitle.textContent = "Editar atividade";
  elements.cancelEdit.hidden = false;
  setFormBusy(false);
  elements.form.scrollIntoView({ block: "center" });
  elements.title.focus({ preventScroll: true });
}

function stopEdit() {
  state.editingId = null;
  elements.form.reset();
  elements.formTitle.textContent = "Nova atividade";
  elements.cancelEdit.hidden = true;
  setFormBusy(false);
}

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

  const activity = state.items.find((item) => item.id === button.dataset.id);
  if (!activity) return;

  if (button.dataset.action === "edit") startEdit(activity);
  if (button.dataset.action === "delete") confirmTrash(activity);
  if (button.dataset.action === "restore") restoreActivity(activity);
}

function confirmTrash(activity) {
  state.pendingDeleteId = activity.id;
  elements.dialogDescription.textContent = `“${activity.title}” sai da agenda de todos. Ela fica na lixeira por ${TRASH_DAYS} dias e pode ser restaurada.`;
  elements.deleteDialog.showModal();
}

async function handleDialogClose() {
  if (elements.deleteDialog.returnValue !== "confirm" || !state.pendingDeleteId) {
    state.pendingDeleteId = null;
    return;
  }

  const id = state.pendingDeleteId;
  state.pendingDeleteId = null;
  elements.confirmDelete.disabled = true;

  try {
    await animateOut(id);
    await state.service.trash(id);
    if (state.editingId === id) stopEdit();
    showToast("Atividade movida para a lixeira.");
  } catch (error) {
    console.error("Erro ao apagar atividade:", error);
    render();
    showToast("Não foi possível apagar a atividade.");
  } finally {
    elements.confirmDelete.disabled = false;
  }
}

async function restoreActivity(activity) {
  try {
    await animateOut(activity.id);
    await state.service.restore(activity.id);
    showToast("Atividade restaurada.");
  } catch (error) {
    console.error("Erro ao restaurar atividade:", error);
    render();
    showToast("Não foi possível restaurar a atividade.");
  }
}

// Espera a animação de saída da linha (com movimento reduzido não há animação e segue direto).
async function animateOut(id) {
  const row = document.querySelector(`.activity-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.classList.add("is-leaving");
  await Promise.allSettled(row.getAnimations().map((animation) => animation.finished));
}

function createFilterChips() {
  const chips = ["all", ...SUBJECTS].map((subject) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.subject = subject;
    chip.textContent = subject === "all" ? "Todas" : subject;
    chip.setAttribute("aria-pressed", String(subject === state.filter));
    return chip;
  });
  elements.subjectFilter.replaceChildren(...chips);
}

function handleFilterClick(event) {
  const chip = event.target.closest("button[data-subject]");
  if (!chip) return;
  state.filter = chip.dataset.subject;
  elements.subjectFilter.querySelectorAll(".chip").forEach((item) => {
    item.setAttribute("aria-pressed", String(item === chip));
  });
  render();
}

function render() {
  const today = toDateInputValue(new Date());
  const inFilter = (item) => state.filter === "all" || item.subject === state.filter;
  const active = state.items.filter((item) => !item.deletedAt && inFilter(item));
  const upcoming = active.filter((item) => item.dueDate >= today).sort((a, b) => compareDates(a, b, 1));
  const history = active.filter((item) => item.dueDate < today).sort((a, b) => compareDates(a, b, -1));
  const trash = state.items
    .filter((item) => item.deletedAt && Date.now() - toMillis(item.deletedAt) < TRASH_DAYS * DAY_MS)
    .sort((a, b) => toMillis(b.deletedAt) - toMillis(a.deletedAt));

  renderList(elements.activitiesList, upcoming, "upcoming");
  renderList(elements.historyList, history, "history");
  renderList(elements.trashList, isLeader() ? trash : [], "trash");

  setCount(elements.activitiesCount, elements.activitiesEmpty, upcoming.length, "atividade pendente", "atividades pendentes");
  setCount(elements.historyCount, elements.historyEmpty, history.length, "atividade passada", "atividades passadas");
  setCount(elements.trashCount, elements.trashEmpty, trash.length, "atividade na lixeira", "atividades na lixeira");

  state.justToggled = null;
  state.lastCounts = new Map(state.items.map((item) => [item.id, doneCountOf(item)]));
}

function setCount(badge, empty, total, singular, plural) {
  badge.textContent = String(total);
  badge.setAttribute("aria-label", `${total} ${total === 1 ? singular : plural}`);
  empty.hidden = total !== 0;
}

function renderList(list, items, kind) {
  const before = new Set([...list.children].map((child) => child.dataset.id));
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
      createRowActions(activity, kind),
    );
    fragment.append(row);
  });

  list.replaceChildren(fragment);
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
    meta.textContent = `Pode ser restaurada até ${formatShortDate(toMillis(activity.deletedAt) + TRASH_DAYS * DAY_MS)}`;
    return copy;
  }

  meta.append(createDue(activity), createProgressText(activity));
  if (kind === "upcoming") copy.append(createProgressBar(activity));
  return copy;
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

function createRowActions(activity, kind) {
  if (!isLeader()) return createSpacer("row-spacer");

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const buttons =
    kind === "trash"
      ? [["restore", "Restaurar"]]
      : [
          ["edit", "Editar"],
          ["delete", "Apagar"],
        ];

  buttons.forEach(([action, verb]) => {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.dataset.id = activity.id;
    button.dataset.action = action;
    button.setAttribute("aria-label", `${verb} ${activity.title}`);
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

function compareDates(a, b, direction) {
  const dateComparison = a.dueDate.localeCompare(b.dueDate) * direction;
  if (dateComparison !== 0) return dateComparison;
  return a.title.localeCompare(b.title, "pt-BR");
}

function normalizeTitle(value) {
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

function formatShortDate(millis) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(millis);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setFormBusy(isBusy) {
  const labels = state.editingId ? ["Salvando…", "Salvar alterações"] : ["Adicionando…", "Adicionar atividade"];
  elements.submit.disabled = isBusy;
  elements.submit.querySelector("span").textContent = isBusy ? labels[0] : labels[1];
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
