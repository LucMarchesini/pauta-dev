import { appOptions } from "./firebase-config.js";
import { DEV_MODE, getCurrentUser, login, logout } from "./auth.js";
import { ACTIVITIES, EVENTS, NOTICES, createFirebaseService, createLocalService } from "./data.js";

const SUBJECTS = new Set(["GDE", "DesSoft", "InstruMed", "DesProd", "Tópicos", "ModSim"]);
const SOURCES = { lideres: "Líderes", professor: "Professor" };
const TYPES = { lab: "Laboratório", workshop: "Workshop", vaga: "Vaga/Oportunidade", outro: "Outro" };
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_PROBLEM = "Use pelo menos 3 caracteres.";
const LINK_PROBLEM = "O link precisa começar com http:// ou https://.";
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
  activityForm: document.querySelector("#activity-form"),
  noticeForm: document.querySelector("#notice-form"),
  noticeDetailField: document.querySelector("#notice-detail-field"),
  eventForm: document.querySelector("#event-form"),
  subjectFilter: document.querySelector("#subject-filter"),
  typeFilter: document.querySelector("#type-filter"),
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

// Cada lista tem no HTML os ids #<chave>-list, #<chave>-empty e #<chave>-count.
const lists = Object.fromEntries(
  ["activities", "history", "trash", "notices", "notice-trash", "events", "event-trash"].map((key) => [
    key,
    {
      list: document.querySelector(`#${key}-list`),
      empty: document.querySelector(`#${key}-empty`),
      count: document.querySelector(`#${key}-count`),
    },
  ]),
);

// Tudo o que muda entre coleções: formulário, validação e textos.
const collections = {
  [ACTIVITIES]: {
    name: ACTIVITIES,
    form: elements.activityForm,
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
  if (DEV_MODE) document.title = `[DEV] ${document.title}`;
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

  createChips(elements.subjectFilter, ACTIVITIES, "Todas", [...SUBJECTS].map((subject) => [subject, subject]), false);
  createChips(elements.typeFilter, EVENTS, "Todos", Object.entries(TYPES));
  syncNoticeForm();
  if (revealTab(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  render();

  // Modo local (localStorage + snapshot) só existe em DEV. Fora dele, se o Firebase
  // falhar, fica só o erro de sincronização e nada pode ser gravado (state.service nulo).
  if (DEV_MODE) {
    await useLocalMode();
    return;
  }

  try {
    state.service = await createFirebaseService(state.user);
    setConnection("online", "Sincronizado com a turma");
    subscribeAll(handleRemoteError);
  } catch (error) {
    handleRemoteError(error);
  }
}

function bindEvents() {
  [elements.loginForm, ...Object.values(collections).map((config) => config.form)].forEach((form) => {
    form.addEventListener("input", handleFieldInput);
    form.addEventListener("change", handleFieldInput);
  });
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
  if (DEV_MODE) elements.loginForm.addEventListener("click", handleTestLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.noAccessLogout.addEventListener("click", handleLogout);
}

function isLeader() {
  return state.user?.role === "lider";
}

async function handleLogin(event) {
  event.preventDefault();
  const problem = showProblems(elements.loginForm, {});
  if (problem) {
    showToast(problem);
    return;
  }
  try {
    await login(elements.loginEmail.value);
    location.reload();
  } catch (error) {
    setFieldError(elements.loginEmail, error.message);
    elements.loginEmail.focus();
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

// Só em DEV (ver start): dados no localStorage e aviso de ambiente visível.
async function useLocalMode() {
  state.service = await createLocalService(state.user.id);
  setConnection("offline", "Modo local");
  elements.setupBanner.hidden = false;
  subscribeAll();
}

function subscribeAll(onError) {
  Object.values(collections).forEach((config) => {
    state.service.subscribe(config.name, (items) => handleItems(config, items), onError);
  });
  state.service.subscribeDone(handleDone, onError);
}

// Base comum: id e título em texto e data AAAA-MM-DD no campo indicado.
function isItem(item, dateField) {
  return (
    Boolean(item) && typeof item.id === "string" && typeof item.title === "string" && DATE_PATTERN.test(item[dateField])
  );
}

function isValidActivity(item) {
  return isItem(item, "dueDate") && SUBJECTS.has(item.subject);
}

function isValidNotice(item) {
  return isItem(item, "date") && typeof item.body === "string" && Object.hasOwn(SOURCES, item.source);
}

function isValidEvent(item) {
  return isItem(item, "date") && typeof item.description === "string" && Object.hasOwn(TYPES, item.type);
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

// Cada read devolve { data, problems }: problems = { nomeDoCampo: mensagem } para o que
// as restrições do HTML não cobrem (texto só com espaços, link fora de http/https…).
function readActivity() {
  const fields = elements.activityForm.elements;
  const data = {
    dueDate: fields.dueDate.value,
    title: normalizeText(fields.title.value),
    subject: fields.subject.value,
  };
  return {
    data,
    problems: {
      title: data.title.length < 3 && TITLE_PROBLEM,
      subject: !SUBJECTS.has(data.subject) && "Selecione a disciplina.",
    },
  };
}

function readNotice() {
  const fields = elements.noticeForm.elements;
  const fromProfessor = fields.source.value === "professor";
  const data = {
    title: normalizeText(fields.title.value),
    body: fields.body.value.trim(),
    source: fields.source.value,
    sourceDetail: fromProfessor ? normalizeText(fields.sourceDetail.value) : "",
    date: fields.date.value,
    pinned: fields.pinned.checked,
  };
  return {
    data,
    problems: {
      title: data.title.length < 3 && TITLE_PROBLEM,
      body: !data.body && "Escreva o texto do aviso.",
      sourceDetail: fromProfessor && data.sourceDetail.length < 2 && "Informe o professor e a disciplina.",
    },
  };
}

function readEvent() {
  const fields = elements.eventForm.elements;
  const link = fields.link.value.trim();
  const url = link ? safeUrl(link) : null;
  const data = {
    type: fields.type.value,
    title: normalizeText(fields.title.value),
    description: fields.description.value.trim(),
    date: fields.date.value,
    link: url ? url.href : "",
  };
  return {
    data,
    problems: {
      type: !Object.hasOwn(TYPES, data.type) && "Selecione o tipo.",
      title: data.title.length < 3 && TITLE_PROBLEM,
      description: !data.description && "Escreva uma descrição.",
      link: link && !url && LINK_PROBLEM,
    },
  };
}

// Mostra "Professor e disciplina" só quando a origem é Professor; data padrão = hoje.
function syncNoticeForm() {
  const fields = elements.noticeForm.elements;
  const fromProfessor = fields.source.value === "professor";
  elements.noticeDetailField.hidden = !fromProfessor;
  fields.sourceDetail.required = fromProfessor;
  if (!fromProfessor) setFieldError(fields.sourceDetail, "");
  if (!fields.date.value) fields.date.value = todayValue();
}

// ---------- Erros junto aos campos ----------

// Marca cada campo inválido (restrição do HTML ou problems) com aria-invalid e uma
// mensagem ligada por aria-describedby, foca o primeiro e devolve a mensagem dele.
function showProblems(form, problems) {
  let first = null;
  let firstMessage = "";
  for (const field of form.elements) {
    if (!field.name || !field.willValidate) continue;
    const message = constraintProblem(field) || problems[field.name] || "";
    setFieldError(field, message);
    if (message && !first) [first, firstMessage] = [field, message];
  }
  first?.focus();
  return firstMessage;
}

// Mensagens próprias (em português) para as restrições do HTML.
function constraintProblem(field) {
  const { validity } = field;
  if (validity.valid) return "";
  if (validity.valueMissing) return field.tagName === "SELECT" ? "Selecione uma opção." : "Preencha este campo.";
  if (validity.tooShort) return `Use pelo menos ${field.minLength} caracteres.`;
  if (field.type === "email") return "Digite um e-mail válido.";
  if (field.type === "url") return LINK_PROBLEM;
  return "Revise este campo.";
}

function setFieldError(field, message) {
  const id = `${field.id}-error`;
  let error = document.getElementById(id);
  if (!message) {
    error?.remove();
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
    return;
  }
  if (!error) {
    error = createText("p", "", "field-error");
    error.id = id;
    field.closest(".field").append(error);
  }
  error.textContent = message;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", id);
}

function clearProblems(form) {
  for (const field of form.elements) if (field.id) setFieldError(field, "");
}

// Editar um campo marcado tira a marcação dele.
function handleFieldInput(event) {
  if (event.target.hasAttribute("aria-invalid")) setFieldError(event.target, "");
}

async function handleSubmit(event, config) {
  event.preventDefault();
  if (!isLeader() || !state.service) return;

  const { data, problems } = config.read();
  const problem = showProblems(config.form, problems);
  if (problem) {
    showToast(problem);
    return;
  }

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
  clearProblems(config.form);
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
  if (!button || !isLeader() || !state.service) return;

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
// translate = false para rótulos que são siglas (disciplinas).
function createChips(group, collection, allLabel, options, translate = true) {
  group.dataset.collection = collection;
  const chips = [["all", allLabel], ...options].map(([value, label]) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = value;
    chip.textContent = label;
    if (!translate && value !== "all") chip.translate = false;
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
  const today = todayValue();
  const filter = state.filters[ACTIVITIES];
  const active = state.data[ACTIVITIES].filter((item) => !item.deletedAt && (filter === "all" || item.subject === filter));
  const upcoming = active.filter((item) => item.dueDate >= today).sort(byDate("dueDate", 1));
  const history = active.filter((item) => item.dueDate < today).sort(byDate("dueDate", -1));
  const trash = trashOf(ACTIVITIES);

  renderActivityList("activities", upcoming, "upcoming");
  renderActivityList("history", history, "history");
  renderActivityList("trash", trash, "trash");

  setCount("activities", upcoming.length, "atividade pendente", "atividades pendentes");
  setCount("history", history.length, "atividade passada", "atividades passadas");
  setCount("trash", trash.length, "atividade na lixeira", "atividades na lixeira");
}

function renderNotices() {
  const active = state.data[NOTICES].filter((item) => !item.deletedAt).sort(compareNotices);
  const trash = trashOf(NOTICES);

  renderEntryList("notices", active, NOTICES, false);
  renderEntryList("notice-trash", trash, NOTICES, true);

  setCount("notices", active.length, "aviso", "avisos");
  setCount("notice-trash", trash.length, "aviso na lixeira", "avisos na lixeira");
}

// Eventos com data passada saem da lista sozinhos (não são apagados).
function renderEvents() {
  const today = todayValue();
  const filter = state.filters[EVENTS];
  const upcoming = state.data[EVENTS]
    .filter((item) => !item.deletedAt && item.date >= today && (filter === "all" || item.type === filter))
    .sort(byDate("date", 1));
  const trash = trashOf(EVENTS);

  renderEntryList("events", upcoming, EVENTS, false);
  renderEntryList("event-trash", trash, EVENTS, true);

  setCount("events", upcoming.length, "evento", "eventos");
  setCount("event-trash", trash.length, "evento na lixeira", "eventos na lixeira");
}

function setCount(key, total, singular, plural) {
  const { count, empty } = lists[key];
  count.textContent = String(total);
  count.setAttribute("aria-label", `${total} ${total === 1 ? singular : plural}`);
  empty.hidden = total !== 0;
}

// Lixeira (últimos 7 dias), mais recentes primeiro. Só líderes a veem.
function trashOf(name) {
  return isLeader() ? state.data[name].filter(isInTrash).sort(byDeletedAt) : [];
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

function renderActivityList(key, items, kind) {
  const { list } = lists[key];
  const before = previousIds(list);
  const fragment = document.createDocumentFragment();
  let group = null;

  items.forEach((activity) => {
    if (kind === "upcoming" && weekLabel(activity.dueDate) !== group) {
      group = weekLabel(activity.dueDate);
      fragment.append(createText("li", group, "week-group"));
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
function renderEntryList(key, items, collection, inTrash) {
  const { list } = lists[key];
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
  time.setAttribute("aria-label", formatLongDate(date));
  time.append(createText("span", day, "date-day"), createText("span", MONTHS[Number(month) - 1], "date-month"));
  time.dataset.year = year;
  return time;
}

function createActivityCopy(activity, kind) {
  const copy = createText("div", "", "activity-copy");
  const title = createText("p", activity.title, "activity-title");
  title.title = activity.title;
  const meta = createText("p", "", "activity-meta");
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
  const copy = createText("div", "", "entry-copy");
  const meta = createText("p", "", "entry-meta");
  if (inTrash) meta.textContent = `Pode ser restaurado até ${formatRestoreDate(item)}`;
  else meta.append(...description.meta);

  copy.append(meta, createText("h3", item.title, "entry-title"), createText("p", description.body, "entry-body"));
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
  const due = createText("span", "", "due");
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

function createSubjectBadge(subject) {
  const badge = createText("span", subject, "subject-badge");
  badge.translate = false;
  return badge;
}

function createProgressText(activity) {
  const count = doneCountOf(activity);
  const text = createText(
    "span",
    count >= CLASS_SIZE ? "Turma toda concluiu" : `${count} de ${CLASS_SIZE} concluíram`,
    "progress-count",
  );
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

// Ordena pelo campo de data (1 = crescente, -1 = decrescente) e, no empate, pelo título.
function byDate(field, direction) {
  return (a, b) => a[field].localeCompare(b[field]) * direction || a.title.localeCompare(b.title, "pt-BR");
}

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function daysUntil(value) {
  return Math.round((parseDate(value) - parseDate(todayValue())) / DAY_MS);
}

// 0 = esta semana, 1 = próxima (semanas começando na segunda).
function weekOffset(value) {
  const weekStart = (date) => date.getTime() - ((date.getDay() + 6) % 7) * DAY_MS;
  const today = parseDate(todayValue());
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

function todayValue() {
  return toDateInputValue(new Date());
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
