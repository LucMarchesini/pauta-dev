import { appOptions, firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "12.18.0";
const LOCAL_STORAGE_KEY = "agenda-turma-b:DEV:activities:v1";
const SUBJECTS = new Set(["GDE", "DesSoft", "InstruMed", "DesProd", "Tópicos", "ModSim"]);
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

const elements = {
  form: document.querySelector("#activity-form"),
  date: document.querySelector("#activity-date"),
  title: document.querySelector("#activity-title"),
  subject: document.querySelector("#activity-subject"),
  submit: document.querySelector("#submit-button"),
  activitiesList: document.querySelector("#activities-list"),
  historyList: document.querySelector("#history-list"),
  activitiesEmpty: document.querySelector("#activities-empty"),
  historyEmpty: document.querySelector("#history-empty"),
  activitiesCount: document.querySelector("#activities-count"),
  historyCount: document.querySelector("#history-count"),
  setupBanner: document.querySelector("#setup-banner"),
  setupTitle: document.querySelector("#setup-title"),
  setupMessage: document.querySelector("#setup-message"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  deleteDialog: document.querySelector("#delete-dialog"),
  dialogDescription: document.querySelector("#dialog-description"),
  confirmDelete: document.querySelector("#confirm-delete"),
  toast: document.querySelector("#toast"),
};

const state = {
  items: [],
  service: null,
  pendingDeleteId: null,
  toastTimer: null,
};

elements.date.min = toDateInputValue(new Date());

start();

async function start() {
  bindEvents();
  render();

  if (!hasFirebaseConfig()) {
    useLocalMode();
    return;
  }

  try {
    state.service = await createFirebaseService();
    setConnection("online", "Sincronizado com a turma");
    state.service.subscribe(handleItems, handleRemoteError);
  } catch (error) {
    console.error("Não foi possível iniciar o Firebase:", error);
    useLocalMode("Não foi possível conectar ao Firebase. A agenda entrou em modo local.");
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleSubmit);
  elements.activitiesList.addEventListener("change", handleListChange);
  elements.historyList.addEventListener("change", handleListChange);
  elements.historyList.addEventListener("click", handleHistoryClick);
  elements.deleteDialog.addEventListener("close", handleDialogClose);
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
  state.service = createLocalService();
  setConnection("offline", "Modo local");
  elements.setupBanner.hidden = false;

  if (message) {
    elements.setupTitle.textContent = "Sincronização indisponível";
    elements.setupMessage.textContent = message;
  }

  state.service.subscribe(handleItems);
}

async function createFirebaseService() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  await authModule.signInAnonymously(auth);

  const db = firestoreModule.getFirestore(app);
  const activities = firestoreModule.collection(db, appOptions.collectionName);

  return {
    subscribe(onItems, onError) {
      return firestoreModule.onSnapshot(
        activities,
        (snapshot) => {
          const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
          onItems(items);
        },
        onError,
      );
    },

    async add({ title, subject, dueDate }) {
      await firestoreModule.addDoc(activities, {
        title,
        subject,
        dueDate,
        completed: false,
        createdAt: firestoreModule.serverTimestamp(),
        updatedAt: firestoreModule.serverTimestamp(),
      });
    },

    async toggle(id, completed) {
      const reference = firestoreModule.doc(db, appOptions.collectionName, id);
      await firestoreModule.updateDoc(reference, {
        completed,
        updatedAt: firestoreModule.serverTimestamp(),
      });
    },

    async remove(id) {
      const reference = firestoreModule.doc(db, appOptions.collectionName, id);
      await firestoreModule.deleteDoc(reference);
    },
  };
}

function createLocalService() {
  let localItems = readLocalItems();
  const listeners = new Set();

  const notify = () => {
    const snapshot = localItems.map((item) => ({ ...item }));
    listeners.forEach((listener) => listener(snapshot));
  };

  const save = () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localItems));
    notify();
  };

  return {
    subscribe(onItems) {
      listeners.add(onItems);
      onItems(localItems.map((item) => ({ ...item })));
      return () => listeners.delete(onItems);
    },

    async add({ title, subject, dueDate }) {
      const now = new Date().toISOString();
      localItems.push({
        id: crypto.randomUUID(),
        title,
        subject,
        dueDate,
        completed: false,
        createdAt: now,
        updatedAt: now,
      });
      save();
    },

    async toggle(id, completed) {
      localItems = localItems.map((item) =>
        item.id === id ? { ...item, completed, updatedAt: new Date().toISOString() } : item,
      );
      save();
    },

    async remove(id) {
      localItems = localItems.filter((item) => item.id !== id);
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
  location.reload();
};

function readLocalItems() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter(isValidActivity) : [];
  } catch {
    return [];
  }
}

function isValidActivity(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    SUBJECTS.has(item.subject) &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) &&
    typeof item.completed === "boolean"
  );
}

function handleItems(items) {
  state.items = items.filter(isValidActivity);
  render();
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
  if (!state.service || !elements.form.reportValidity()) return;

  const activity = {
    dueDate: elements.date.value,
    title: normalizeTitle(elements.title.value),
    subject: elements.subject.value,
  };

  if (activity.title.length < 3 || !SUBJECTS.has(activity.subject)) {
    showToast("Revise o título e a disciplina da atividade.");
    return;
  }

  setFormBusy(true);
  try {
    await state.service.add(activity);
    elements.form.reset();
    elements.date.min = toDateInputValue(new Date());
    elements.title.focus();
    showToast("Atividade adicionada à agenda.");
  } catch (error) {
    console.error("Erro ao adicionar atividade:", error);
    showToast("Não foi possível adicionar. Tente novamente.");
  } finally {
    setFormBusy(false);
  }
}

async function handleListChange(event) {
  const checkbox = event.target.closest('input[data-action="toggle"]');
  if (!checkbox || !state.service) return;

  checkbox.disabled = true;
  try {
    await state.service.toggle(checkbox.dataset.id, checkbox.checked);
    showToast(checkbox.checked ? "Atividade movida para o histórico." : "Atividade reaberta.");
  } catch (error) {
    console.error("Erro ao alterar atividade:", error);
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    showToast("Não foi possível alterar a atividade.");
  }
}

function handleHistoryClick(event) {
  const button = event.target.closest('button[data-action="delete"]');
  if (!button) return;

  const activity = state.items.find((item) => item.id === button.dataset.id);
  if (!activity) return;

  state.pendingDeleteId = activity.id;
  elements.dialogDescription.textContent = `“${activity.title}” será removida do histórico para todos e não poderá ser recuperada.`;
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
    await state.service.remove(id);
    showToast("Atividade apagada definitivamente.");
  } catch (error) {
    console.error("Erro ao excluir atividade:", error);
    showToast("Não foi possível apagar a atividade.");
  } finally {
    elements.confirmDelete.disabled = false;
  }
}

function render() {
  const upcoming = state.items
    .filter((item) => !item.completed)
    .sort((a, b) => compareDates(a, b, 1));
  const history = state.items
    .filter((item) => item.completed)
    .sort((a, b) => compareDates(a, b, -1));

  renderList(elements.activitiesList, upcoming, false);
  renderList(elements.historyList, history, true);

  elements.activitiesCount.textContent = String(upcoming.length);
  elements.historyCount.textContent = String(history.length);
  elements.activitiesCount.setAttribute(
    "aria-label",
    `${upcoming.length} ${upcoming.length === 1 ? "atividade pendente" : "atividades pendentes"}`,
  );
  elements.historyCount.setAttribute(
    "aria-label",
    `${history.length} ${history.length === 1 ? "atividade concluída" : "atividades concluídas"}`,
  );
  elements.activitiesEmpty.hidden = upcoming.length !== 0;
  elements.historyEmpty.hidden = history.length !== 0;
}

function renderList(list, items, completed) {
  const fragment = document.createDocumentFragment();

  items.forEach((activity) => {
    const row = document.createElement("li");
    row.className = "activity-row";
    row.dataset.id = activity.id;

    row.append(
      createCheckbox(activity, completed),
      createDateBlock(activity.dueDate),
      createActivityCopy(activity),
      createSubjectBadge(activity.subject),
      completed ? createDeleteButton(activity) : createSpacer(),
    );
    fragment.append(row);
  });

  list.replaceChildren(fragment);
}

function createCheckbox(activity, completed) {
  const label = document.createElement("label");
  label.className = "task-check";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = completed;
  input.dataset.id = activity.id;
  input.dataset.action = "toggle";
  input.setAttribute(
    "aria-label",
    completed ? `Reabrir ${activity.title}` : `Marcar ${activity.title} como concluída`,
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

function createActivityCopy(activity) {
  const copy = document.createElement("div");
  copy.className = "activity-copy";

  const title = document.createElement("p");
  title.className = "activity-title";
  title.textContent = activity.title;
  title.title = activity.title;

  const year = document.createElement("span");
  year.className = "activity-year";
  year.textContent = `Entrega em ${activity.dueDate.slice(0, 4)}`;

  copy.append(title, year);
  return copy;
}

function createSubjectBadge(subject) {
  const badge = document.createElement("span");
  badge.className = "subject-badge";
  badge.textContent = subject;
  return badge;
}

function createDeleteButton(activity) {
  const button = document.createElement("button");
  button.className = "delete-button";
  button.type = "button";
  button.dataset.id = activity.id;
  button.dataset.action = "delete";
  button.setAttribute("aria-label", `Apagar ${activity.title}`);
  button.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
  return button;
}

function createSpacer() {
  const spacer = document.createElement("span");
  spacer.className = "row-spacer";
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

function formatLongDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setFormBusy(isBusy) {
  elements.submit.disabled = isBusy;
  elements.submit.querySelector("span").textContent = isBusy
    ? "Adicionando…"
    : "Adicionar atividade";
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
