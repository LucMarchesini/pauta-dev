import { DEV_MODE, getCurrentUser, login, logout } from "./auth.js";
import { ACTIVITIES, EVENTS, FILES, NOTICES, OPPORTUNITIES, createService } from "./data.js";
import { initAdmin, materiasProblem, parseMaterias } from "./admin.js";
import {
  activityToCalendar,
  downloadIcs,
  eventToCalendar,
  googleCalendarUrl,
  opportunityToCalendar,
  outlookCalendarUrl,
  renderMonthGrid,
} from "./calendar.js";
import {
  DATE_PATTERN,
  DAY_MS,
  MONTHS,
  TIME_PATTERN,
  addDays,
  daysUntil,
  formatDayTitle,
  formatLongDate,
  formatMonth,
  formatShortDate,
  formatWeek,
  momentOf,
  parseDate,
  toDateValue,
  toMillis,
  todayValue,
  weekLabel,
  weekOffset,
  weekStartDate,
} from "./dates.js";
import { createSpacer, createText, externalLink, icon, normalizeText, plural, safeUrl, showToast } from "./dom.js";
import { LINK_PROBLEM, TITLE_PROBLEM, clearProblems, setFieldError, setSubmitLabel, showProblems, watchFields } from "./forms.js";

const SOURCES = { lideres: "Líderes", professor: "Professor" };
const EVENT_TYPES = { lab: "Laboratório", workshop: "Workshop", palestra: "Palestra", outro: "Outro" };
const KINDS = { estagio: "Estágio", pesquisa: "Pesquisa / IC", bolsa: "Bolsa", competicao: "Competição", outro: "Outro" };
const CATEGORIES = { slides: "Slides", lista: "Lista", gabarito: "Gabarito", material: "Material de apoio", outro: "Outro" };
const TRASH_DAYS = 7;
const LATE_ALERT_DAYS = 7; // "Atrasada" em vermelho só até 7 dias depois do prazo.
const LOAD_WEEKS = 5; // semanas na carga semanal (esta + 4)
const HEAVY_WEEK = 5; // a partir de quantas entregas a semana é "pesada"
const HEAVY_DAY = 3; // a partir de quantas entregas no mesmo dia vale um alerta
const TURMA_KEY = "agenda-b:turma"; // última turma aberta neste navegador
const SEEN_KEY = "agenda-b:visto:"; // + id da turma: o que este navegador já viu em cada aba

const $ = (selector) => document.querySelector(selector);

const elements = {
  main: $("main"),
  tabs: $("#tabs"),
  pageEyebrow: $("#page-eyebrow"),
  pageTitle: $("#page-title"),
  pageSummary: $("#page-summary"),
  turmaSwitch: $("#turma-switch"),
  turmaSelect: $("#turma-select"),
  setupBanner: $("#setup-banner"),
  setupTitle: $("#setup-title"),
  setupMessage: $("#setup-message"),
  archivedBanner: $("#archived-banner"),
  connectionPill: $("#connection-pill"),
  connectionLabel: $("#connection-label"),
  deleteDialog: $("#delete-dialog"),
  dialogTitle: $("#dialog-title"),
  dialogDescription: $("#dialog-description"),
  confirmDelete: $("#confirm-delete"),
  loginForm: $("#login-form"),
  loginEmail: $("#login-email"),
  loginHint: $("#login-hint"),
  userName: $("#user-name"),
  noAccessEmail: $("#no-access-email"),
  noticeDetailField: $("#notice-detail-field"),
  weekLoad: $("#week-load"),
  calendarButton: $("#calendar-button"),
  calendarTitle: $("#calendar-title"),
  calendarGrid: $("#calendar-grid"),
  dayTitle: $("#day-title"),
  dayList: $("#day-list"),
  dayEmpty: $("#day-empty"),
  addCalendarDialog: $("#add-calendar-dialog"),
  addCalendarDescription: $("#add-calendar-description"),
  addGoogle: $("#add-google"),
  addOutlook: $("#add-outlook"),
  materiasDialog: $("#materias-dialog"),
  materiasForm: $("#materias-form"),
  materiaList: $("#materia-list"),
  materiaNew: $("#materia-new"),
};

// Cada lista tem no HTML os ids #<chave>-list, #<chave>-empty e #<chave>-count.
const lists = Object.fromEntries(
  [
    "activities",
    "history",
    "trash",
    "notices",
    "notice-trash",
    "events",
    "event-trash",
    "opportunities",
    "opportunity-trash",
    "files",
    "file-trash",
  ].map((key) => [key, { list: $(`#${key}-list`), empty: $(`#${key}-empty`), count: $(`#${key}-count`) }]),
);

// Tudo o que muda entre coleções: formulário, validação, cartão e textos.
const collections = {
  [ACTIVITIES]: {
    form: $("#activity-form"),
    headings: ["Nova atividade", "Editar atividade"],
    addLabels: ["Adicionando…", "Adicionar atividade"],
    isValid: isValidActivity,
    read: readActivity,
    defaults: { doneCount: 0 },
    texts: ["Atividade adicionada à agenda.", "Atividade movida para a lixeira.", "Atividade restaurada.", "Apagar esta atividade?", "Ela"],
  },
  [NOTICES]: {
    form: $("#notice-form"),
    headings: ["Novo aviso", "Editar aviso"],
    addLabels: ["Publicando…", "Publicar aviso"],
    isValid: isValidNotice,
    read: readNotice,
    sync: syncNoticeForm,
    describe: describeNotice,
    texts: ["Aviso publicado.", "Aviso movido para a lixeira.", "Aviso restaurado.", "Apagar este aviso?", "Ele"],
  },
  [EVENTS]: {
    form: $("#event-form"),
    headings: ["Novo evento", "Editar evento"],
    addLabels: ["Publicando…", "Publicar evento"],
    isValid: isValidEvent,
    read: readEvent,
    describe: describeEvent,
    texts: ["Evento publicado.", "Evento movido para a lixeira.", "Evento restaurado.", "Apagar este evento?", "Ele"],
  },
  [OPPORTUNITIES]: {
    form: $("#opportunity-form"),
    headings: ["Nova oportunidade", "Editar oportunidade"],
    addLabels: ["Publicando…", "Publicar oportunidade"],
    isValid: isValidOpportunity,
    read: readOpportunity,
    describe: describeOpportunity,
    texts: [
      "Oportunidade publicada.",
      "Oportunidade movida para a lixeira.",
      "Oportunidade restaurada.",
      "Apagar esta oportunidade?",
      "Ela",
    ],
  },
  [FILES]: {
    form: $("#file-form"),
    headings: ["Novo arquivo", "Editar arquivo"],
    addLabels: ["Adicionando…", "Adicionar arquivo"],
    isValid: isValidFile,
    read: readFile,
    describe: describeFile,
    texts: ["Arquivo adicionado.", "Arquivo movido para a lixeira.", "Arquivo restaurado.", "Apagar este arquivo?", "Ele"],
  },
};
// Aba de cada coleção (para as bolinhas de novidades). O calendário só junta o que já
// está nas outras abas, então não tem bolinha própria.
const PANEL_OF = {
  [ACTIVITIES]: "painel-atividades",
  [NOTICES]: "painel-avisos",
  [EVENTS]: "painel-eventos",
  [OPPORTUNITIES]: "painel-oportunidades",
  [FILES]: "painel-arquivos",
};

for (const [name, config] of Object.entries(collections)) {
  config.name = name;
  config.dialog = $(`#${name}-dialog`);
  config.editingId = null;
}

const state = {
  user: null,
  profile: null,
  turma: null, // { id, nome, semestre, materias, tamanho, arquivada, papel }
  service: null,
  turmaService: null,
  role: "anon", // anon | fora | admin | aluno | lider
  data: Object.fromEntries(Object.keys(collections).map((name) => [name, []])),
  done: new Set(),
  filters: { [ACTIVITIES]: "all", [EVENTS]: "all", [OPPORTUNITIES]: "all", [FILES]: "all" },
  pendingDelete: null,
  justToggled: null,
  lastCounts: new Map(),
  renderQueued: false,
  calendarMonth: parseDate(todayValue()),
  calendarDay: todayValue(),
  calendarItem: null,
  materias: [], // rascunho do diálogo de matérias
  seen: {}, // { coleção: { idDoItem: carimbo } } — o que este navegador já viu
  fresh: {}, // { coleção: Set(ids) } — novidades destacadas na aba aberta agora
  baseTitle: document.title,
};

start();

// ---------- Início ----------

async function start() {
  if (DEV_MODE) document.title = `[DEV] ${document.title}`;
  state.baseTitle = document.title;
  bindEvents();
  elements.loginHint.hidden = !DEV_MODE;
  state.user = await getCurrentUser();
  elements.userName.textContent = state.user?.name ?? "";

  if (!state.user) return applyRole("anon", "Entre para ver a agenda");

  try {
    state.service = await createService(state.user);
    state.profile = await state.service.profile();
  } catch (error) {
    return handleRemoteError(error);
  }
  if (DEV_MODE) elements.setupBanner.hidden = false;

  const turmas = sortTurmas(state.profile.turmas);
  const saved = readSavedTurma();
  state.turma = turmas.find((turma) => turma.id === saved) ?? turmas.find((turma) => !turma.arquivada) ?? turmas[0] ?? null;
  if (state.profile.admin) initAdmin(state.service);

  if (!state.turma) {
    elements.noAccessEmail.textContent = `Conta usada: ${state.user.email}`;
    if (!state.profile.admin) return applyRole("fora", "Sem turma");
    applyRole("admin", DEV_MODE ? "Modo local" : "Conectado");
    elements.pageTitle.textContent = "Administração";
    elements.pageSummary.textContent = "Você não está em nenhuma turma; aqui você gerencia todas.";
    return showTab($("#painel-admin"));
  }

  const archived = state.turma.arquivada;
  applyRole(archived ? "aluno" : state.turma.papel, DEV_MODE ? "Modo local" : "Sincronizado com a turma");
  document.body.dataset.archived = String(archived);
  elements.archivedBanner.hidden = !archived;
  fillTurmaSwitch(turmas);
  renderHeading();
  createChips($("#type-filter"), EVENTS, "Todos", Object.entries(EVENT_TYPES));
  createChips($("#kind-filter"), OPPORTUNITIES, "Todas", Object.entries(KINDS));
  applyMaterias();
  syncNoticeForm();
  if (revealTab(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  render();

  state.seen = readSeen();
  state.turmaService = state.service.openTurma(state.turma.id, state.turma.papel);
  state.turmaService.subscribeTurma(handleTurma, handleRemoteError);
  Object.keys(collections).forEach((name) => {
    state.turmaService.subscribe(name, (items) => handleItems(name, items), handleRemoteError);
  });
  state.turmaService.subscribeDone(handleDone, handleRemoteError);
}

function applyRole(role, connection) {
  state.role = role;
  document.body.dataset.role = role;
  document.body.dataset.admin = String(Boolean(state.profile?.admin));
  setConnection(role === "anon" || role === "fora" ? "offline" : "online", connection);
  if (DEV_MODE && role !== "anon") setConnection("offline", connection);
}

function bindEvents() {
  watchFields(elements.loginForm);
  watchFields(elements.materiasForm);
  for (const config of Object.values(collections)) {
    watchFields(config.form);
    config.form.addEventListener("submit", (event) => handleSubmit(event, config));
    config.dialog.addEventListener("close", () => stopEdit(config));
  }
  document.querySelectorAll("dialog [data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-new]");
    if (button) openNew(collections[button.dataset.new]);
  });
  collections[NOTICES].form.elements.source.addEventListener("change", syncNoticeForm);
  for (const group of ["#subject-filter", "#type-filter", "#kind-filter", "#file-filter"]) {
    $(group).addEventListener("click", handleFilterClick);
  }
  elements.main.addEventListener("change", handleListChange);
  document.addEventListener("click", handleRowClick);
  elements.tabs.addEventListener("click", handleTabClick);
  elements.tabs.addEventListener("keydown", handleTabKey);
  document.addEventListener("click", handleAnchorClick);
  window.addEventListener("hashchange", () => revealTab(location.hash));
  // Voltar para a aba do navegador conta como ver a aba aberta da Pauta.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });
  elements.deleteDialog.addEventListener("close", handleDialogClose);
  elements.loginForm.addEventListener("submit", handleLogin);
  if (DEV_MODE) elements.loginForm.addEventListener("click", handleTestLogin);
  $("#logout-button").addEventListener("click", handleLogout);
  $("#no-access-logout").addEventListener("click", handleLogout);
  elements.turmaSelect.addEventListener("change", () => {
    saveTurmaChoice(elements.turmaSelect.value);
    location.reload();
  });
  $("#summary-button").addEventListener("click", handleSummary);
  elements.calendarButton.addEventListener("click", () => exportIcs(upcomingActivities(true).map(toCalendarItem(ACTIVITIES))));
  $("#export-all-button").addEventListener("click", exportAll);
  $("#month-prev").addEventListener("click", () => moveMonth(-1));
  $("#month-next").addEventListener("click", () => moveMonth(1));
  $("#month-today").addEventListener("click", () => selectDay(todayValue(), true));
  elements.calendarGrid.addEventListener("click", (event) => {
    const day = event.target.closest(".calendar-day");
    if (day) selectDay(day.dataset.date, true);
  });
  elements.calendarGrid.addEventListener("keydown", handleGridKey);
  $("#add-ics").addEventListener("click", () => {
    exportIcs([state.calendarItem], false);
    elements.addCalendarDialog.close();
  });
  $("#materias-button").addEventListener("click", openMaterias);
  $("#materia-add").addEventListener("click", addMateria);
  elements.materiaNew.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addMateria();
    }
  });
  elements.materiaList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    state.materias.splice(Number(button.dataset.index), 1);
    renderMateriaDraft();
  });
  elements.materiasForm.addEventListener("submit", saveMaterias);
  // Atualiza a cada minuto as contagens "faltam Xh" sem refazer as listas.
  window.setInterval(updateCountdowns, 60_000);
}

function isLeader() {
  return state.role === "lider";
}

// ---------- Turma ----------

// Abertas primeiro; depois o semestre mais recente.
function sortTurmas(turmas) {
  return [...turmas].sort(
    (a, b) => Number(a.arquivada) - Number(b.arquivada) || b.semestre.localeCompare(a.semestre) || a.nome.localeCompare(b.nome),
  );
}

function readSavedTurma() {
  try {
    return localStorage.getItem(TURMA_KEY);
  } catch {
    return null;
  }
}

function saveTurmaChoice(id) {
  try {
    localStorage.setItem(TURMA_KEY, id);
  } catch {
    // Sem armazenamento: a escolha vale só até recarregar.
  }
}

function fillTurmaSwitch(turmas) {
  elements.turmaSwitch.hidden = turmas.length < 2;
  elements.turmaSelect.replaceChildren(
    ...turmas.map((turma) => {
      const option = new Option(`${turma.nome} · ${turma.semestre}${turma.arquivada ? " (arquivada)" : ""}`, turma.id);
      option.selected = turma.id === state.turma.id;
      return option;
    }),
  );
}

function renderHeading() {
  const turma = state.turma;
  elements.pageEyebrow.textContent = `Semestre ${turma.semestre}${turma.arquivada ? " · arquivado" : ""}`;
  elements.pageTitle.textContent = turma.nome;
}

// A turma mudou no servidor (ex.: líder editou as matérias).
function handleTurma(turma) {
  Object.assign(state.turma, turma);
  applyMaterias();
  scheduleRender();
}

function materias() {
  return state.turma?.materias ?? [];
}

// Matérias da turma → opções dos formulários e chips de filtro.
function applyMaterias() {
  const list = materias();
  const subject = collections[ACTIVITIES].form.elements.subject;
  subject.replaceChildren(subject.options[0], ...list.map(subjectOption));
  const fileSubject = collections[FILES].form.elements.subject;
  fileSubject.replaceChildren(new Option("Geral", ""), ...list.map(subjectOption));

  for (const [name, filter] of [
    [ACTIVITIES, "#subject-filter"],
    [FILES, "#file-filter"],
  ]) {
    const values = name === FILES ? ["", ...list] : list;
    if (state.filters[name] !== "all" && !values.includes(state.filters[name])) state.filters[name] = "all";
    const options = values.map((value) => [value, value || "Geral"]);
    createChips($(filter), name, "Todas", options, false);
  }
}

function subjectOption(subject) {
  const option = new Option(subject, subject);
  option.translate = false;
  return option;
}

// ---------- Login ----------

async function handleLogin(event) {
  event.preventDefault();
  const problem = showProblems(elements.loginForm);
  if (problem) return showToast(problem);
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

// ---------- Dados ----------

function isItem(item, dateField) {
  return Boolean(item) && typeof item.id === "string" && typeof item.title === "string" && DATE_PATTERN.test(item[dateField]);
}

const isTime = (value) => !value || TIME_PATTERN.test(value);

function isValidActivity(item) {
  // A matéria pode ter saído da lista da turma: a atividade continua aparecendo.
  return isItem(item, "dueDate") && typeof item.subject === "string" && isTime(item.dueTime);
}

function isValidNotice(item) {
  return isItem(item, "date") && typeof item.body === "string" && Object.hasOwn(SOURCES, item.source);
}

function isValidEvent(item) {
  return isItem(item, "date") && typeof item.description === "string" && Object.hasOwn(EVENT_TYPES, item.type) && isTime(item.time);
}

function isValidOpportunity(item) {
  return isItem(item, "deadline") && typeof item.description === "string" && Object.hasOwn(KINDS, item.kind);
}

function isValidFile(item) {
  return (
    Boolean(item) &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    Object.hasOwn(CATEGORIES, item.category) &&
    Boolean(safeUrl(item.link))
  );
}

function handleItems(name, items) {
  state.data[name] = items.filter(collections[name].isValid);
  // Primeira vez desta coleção neste navegador: tudo conta como visto (sem bolinhas).
  if (!state.seen[name]) markSeen(name);
  scheduleRender();
}

function handleDone(ids) {
  state.done = new Set(ids);
  scheduleRender();
}

// Junta num só render as atualizações que chegam no mesmo quadro.
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
  elements.setupTitle.textContent = "A Pauta não está sincronizando";
  elements.setupMessage.textContent = "Confira a configuração e as regras do Firestore antes de compartilhar o link.";
  showToast("Não foi possível atualizar os dados da turma.");
}

const active = (name) => state.data[name].filter((item) => !item.deletedAt);

// ---------- Formulários (criar e editar) ----------

// Cada read devolve { data, problems }: problems = { nomeDoCampo: mensagem } para o que
// as restrições do HTML não cobrem (texto só com espaços, link fora de http/https…).
function readActivity(fields) {
  const data = {
    dueDate: fields.dueDate.value,
    dueTime: fields.dueTime.value,
    title: normalizeText(fields.title.value),
    subject: fields.subject.value,
  };
  return {
    data,
    problems: {
      title: data.title.length < 3 && TITLE_PROBLEM,
      subject: !data.subject && "Selecione a matéria.",
      dueTime: !isTime(data.dueTime) && "Use o formato 23:59.",
    },
  };
}

function readNotice(fields) {
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
      sourceDetail: fromProfessor && data.sourceDetail.length < 2 && "Informe o professor e a matéria.",
    },
  };
}

// Link opcional ou obrigatório: devolve [href normalizado, problema].
function readLink(field, required) {
  const raw = field.value.trim();
  const url = raw ? safeUrl(raw) : null;
  if (!raw) return ["", required && "Cole o link."];
  return [url ? url.href : "", !url && LINK_PROBLEM];
}

function readEvent(fields) {
  const [link, linkProblem] = readLink(fields.link, false);
  const data = {
    type: fields.type.value,
    title: normalizeText(fields.title.value),
    description: fields.description.value.trim(),
    date: fields.date.value,
    time: fields.time.value,
    link,
  };
  return {
    data,
    problems: {
      type: !Object.hasOwn(EVENT_TYPES, data.type) && "Selecione o tipo.",
      title: data.title.length < 3 && TITLE_PROBLEM,
      description: !data.description && "Escreva uma descrição.",
      link: linkProblem,
    },
  };
}

function readOpportunity(fields) {
  const [link, linkProblem] = readLink(fields.link, false);
  const data = {
    kind: fields.kind.value,
    title: normalizeText(fields.title.value),
    org: normalizeText(fields.org.value),
    description: fields.description.value.trim(),
    deadline: fields.deadline.value,
    link,
  };
  return {
    data,
    problems: {
      kind: !Object.hasOwn(KINDS, data.kind) && "Selecione o tipo.",
      title: data.title.length < 3 && TITLE_PROBLEM,
      description: !data.description && "Escreva uma descrição.",
      link: linkProblem,
    },
  };
}

function readFile(fields) {
  const [link, linkProblem] = readLink(fields.link, true);
  const data = {
    title: normalizeText(fields.title.value),
    category: fields.category.value,
    subject: fields.subject.value,
    link,
  };
  return {
    data,
    problems: {
      title: data.title.length < 3 && TITLE_PROBLEM,
      category: !Object.hasOwn(CATEGORIES, data.category) && "Selecione o tipo.",
      link: linkProblem,
    },
  };
}

// Mostra "Professor e matéria" só quando a origem é Professor; data padrão = hoje.
function syncNoticeForm() {
  const fields = collections[NOTICES].form.elements;
  const fromProfessor = fields.source.value === "professor";
  elements.noticeDetailField.hidden = !fromProfessor;
  fields.sourceDetail.required = fromProfessor;
  if (!fromProfessor) setFieldError(fields.sourceDetail, "");
  if (!fields.date.value) fields.date.value = todayValue();
}

function openNew(config) {
  if (!isLeader()) return;
  stopEdit(config);
  config.dialog.showModal();
  config.form.elements.title.focus();
}

async function handleSubmit(event, config) {
  event.preventDefault();
  if (!isLeader() || !state.turmaService) return;

  const { data, problems } = config.read(config.form.elements);
  const problem = showProblems(config.form, problems);
  if (problem) return showToast(problem);

  const editingId = config.editingId;
  setFormBusy(config, true);
  try {
    if (editingId) {
      await state.turmaService.update(config.name, editingId, data);
      showToast("Alterações salvas.");
    } else {
      await state.turmaService.add(config.name, { ...data, ...config.defaults });
      showToast(config.texts[0]);
    }
    config.dialog.close();
  } catch (error) {
    console.error("Erro ao salvar:", error);
    showToast(editingId ? "Não foi possível salvar. Tente novamente." : "Não foi possível adicionar. Tente novamente.");
  } finally {
    setFormBusy(config, false);
  }
}

function startEdit(config, item) {
  config.form.reset(); // campos opcionais ausentes no item (ex.: dueTime) não herdam a edição anterior
  config.editingId = item.id;
  // Matéria que saiu da lista da turma: aparece só para esta edição.
  const subject = config.form.elements.subject;
  if (subject && item.subject && ![...subject.options].some((option) => option.value === item.subject)) {
    subject.append(subjectOption(item.subject));
  }
  for (const field of config.form.elements) {
    if (!(field.name in item)) continue;
    if (field.type === "checkbox") field.checked = Boolean(item[field.name]);
    else field.value = item[field.name];
  }
  config.sync?.();
  setEditing(config, true);
  config.dialog.showModal();
  config.form.elements.title.focus();
}

function stopEdit(config) {
  config.editingId = null;
  config.form.reset();
  config.sync?.();
  setEditing(config, false);
}

function setEditing(config, editing) {
  clearProblems(config.form);
  config.dialog.querySelector("h2").textContent = config.headings[editing ? 1 : 0];
  setFormBusy(config, false);
}

function setFormBusy(config, busy) {
  const labels = config.editingId ? ["Salvando…", "Salvar alterações"] : config.addLabels;
  setSubmitLabel(config.form, labels[busy ? 0 : 1], busy);
}

// ---------- Matérias (líder) ----------

function openMaterias() {
  if (!isLeader()) return;
  state.materias = [...materias()];
  elements.materiaNew.value = "";
  clearProblems(elements.materiasForm);
  renderMateriaDraft();
  elements.materiasDialog.showModal();
  elements.materiaNew.focus();
}

function renderMateriaDraft() {
  elements.materiaList.replaceChildren(
    ...state.materias.map((materia, index) => {
      const item = createText("li", "", "materia-chip");
      const label = createText("span", materia);
      label.translate = false;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.index = String(index);
      remove.setAttribute("aria-label", `Remover ${materia}`);
      remove.append(icon("close"));
      item.append(label, remove);
      return item;
    }),
  );
}

function addMateria() {
  const value = normalizeText(elements.materiaNew.value);
  if (!value) return;
  if (state.materias.some((item) => item.toLowerCase() === value.toLowerCase())) {
    setFieldError(elements.materiaNew, "Essa matéria já está na lista.");
    return;
  }
  const problem = materiasProblem([...state.materias, value]);
  if (problem) {
    setFieldError(elements.materiaNew, problem);
    return;
  }
  state.materias.push(value);
  elements.materiaNew.value = "";
  setFieldError(elements.materiaNew, "");
  renderMateriaDraft();
  elements.materiaNew.focus();
}

async function saveMaterias(event) {
  event.preventDefault();
  if (elements.materiaNew.value.trim()) addMateria();
  const list = parseMaterias(state.materias.join("\n"));
  const problem = materiasProblem(list);
  if (problem) {
    setFieldError(elements.materiaNew, problem);
    return showToast(problem);
  }
  setSubmitLabel(elements.materiasForm, "Salvando…", true);
  try {
    await state.turmaService.setMaterias(list);
    elements.materiasDialog.close();
    showToast("Matérias atualizadas.");
  } catch (error) {
    console.error("Erro ao salvar matérias:", error);
    showToast("Não foi possível salvar as matérias.");
  } finally {
    setSubmitLabel(elements.materiasForm, "Salvar matérias");
  }
}

// ---------- Ações nas listas ----------

async function handleListChange(event) {
  const checkbox = event.target.closest('input[data-action="toggle"]');
  if (!checkbox || !state.turmaService) return;

  const done = checkbox.checked;
  checkbox.disabled = true;
  state.justToggled = checkbox.dataset.id;
  try {
    await state.turmaService.setDone(checkbox.dataset.id, done);
    showToast(done ? "Marcada como feita." : "Marcação desfeita.");
  } catch (error) {
    console.error("Erro ao salvar progresso:", error);
    checkbox.checked = !done;
    checkbox.disabled = false;
    showToast("Não foi possível salvar sua marcação.");
  }
}

function handleRowClick(event) {
  const button = event.target.closest("button[data-action][data-collection]");
  if (!button || !state.turmaService) return;
  const config = collections[button.dataset.collection];
  const item = config && state.data[config.name].find((entry) => entry.id === button.dataset.id);
  if (!item) return;

  if (button.dataset.action === "calendar") return openCalendarDialog(toCalendarItem(config.name)(item));
  if (!isLeader()) return;
  if (button.dataset.action === "edit") startEdit(config, item);
  if (button.dataset.action === "delete") confirmTrash(config, item);
  if (button.dataset.action === "restore") restoreItem(config, item);
}

function confirmTrash(config, item) {
  state.pendingDelete = { config, id: item.id };
  elements.dialogTitle.textContent = config.texts[3];
  elements.dialogDescription.textContent = `“${item.title}” sai da agenda de todos. ${config.texts[4]} fica na lixeira por 7 dias e pode ser restaurad${config.texts[4] === "Ela" ? "a" : "o"}.`;
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
    await state.turmaService.trash(config.name, id);
    showToast(config.texts[1]);
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
    await state.turmaService.restore(config.name, item.id);
    showToast(config.texts[2]);
  } catch (error) {
    console.error("Erro ao restaurar:", error);
    render();
    showToast("Não foi possível restaurar. Tente novamente.");
  }
}

// Espera a animação de saída da linha (com movimento reduzido não há animação).
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
  render(); // marca a aba como vista e atualiza as bolinhas
}

function visibleTabs() {
  return [...elements.tabs.querySelectorAll('[role="tab"]')].filter((tab) => tab.offsetParent !== null);
}

function handleTabClick(event) {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  showTab(document.getElementById(tab.getAttribute("aria-controls")));
  window.scrollTo({ top: 0 });
}

function handleTabKey(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = visibleTabs();
  const index = tabs.indexOf(document.activeElement);
  const next =
    event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1)
        : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  next.focus();
  next.click();
}

// Links como #historico ou #avisos abrem a aba (e a seção recolhida) do destino.
function handleAnchorClick(event) {
  const link = event.target.closest('a[href^="#"]');
  if (link) revealTab(link.hash);
}

function revealTab(hash) {
  const target = hash && document.getElementById(hash.slice(1));
  if (!target) return false;
  if (target.tagName === "DETAILS") target.open = true;
  const panel = target.closest('[role="tabpanel"]');
  if (!panel?.hidden) return Boolean(panel);
  showTab(panel);
  return true;
}

// ---------- Filtros ----------

// options: [[valor, rótulo], ...]. translate = false para siglas (matérias).
function createChips(group, collection, allLabel, options, translate = true) {
  group.dataset.collection = collection;
  const chips = [["all", allLabel], ...options].map(([value, label]) => {
    const chip = createText("button", label, "chip");
    chip.type = "button";
    chip.dataset.value = value;
    if (!translate && value !== "all" && value !== "") chip.translate = false;
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
  group.querySelectorAll(".chip").forEach((item) => item.setAttribute("aria-pressed", String(item === chip)));
  render();
}

const passes = (name, value) => state.filters[name] === "all" || state.filters[name] === value;

// ---------- Render ----------

function render() {
  if (!state.turma) return;
  syncSeen();
  renderActivities();
  renderNotices();
  renderEvents();
  renderOpportunities();
  renderFiles();
  if (!$("#painel-calendario").hidden) renderCalendar();
  updateBadges();
  state.justToggled = null;
  state.lastCounts = new Map(state.data[ACTIVITIES].map((item) => [item.id, doneCountOf(item)]));
}

// ---------- Novidades (bolinhas nas abas) ----------

// Por navegador e por turma: guarda, para cada item visto, o carimbo da última versão
// vista (updatedAt). Item novo ou editado depois disso conta como novidade. Marcar
// "eu já fiz" não muda o updatedAt, então não conta.

function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY + state.turma.id)) ?? {};
  } catch {
    return {};
  }
}

function saveSeen() {
  try {
    localStorage.setItem(SEEN_KEY + state.turma.id, JSON.stringify(state.seen));
  } catch {
    // Sem armazenamento: as novidades valem só até recarregar.
  }
}

function stampOf(item) {
  return Math.max(toMillis(item.updatedAt) || 0, toMillis(item.createdAt) || 0);
}

// O que aparece na aba (eventos, oportunidades e entregas passadas não contam).
function relevant(name) {
  const today = todayValue();
  const items = active(name);
  if (name === ACTIVITIES) return items.filter((item) => item.dueDate >= today);
  if (name === EVENTS) return items.filter((item) => item.date >= today);
  if (name === OPPORTUNITIES) return items.filter((item) => item.deadline >= today);
  return items;
}

function unseen(name) {
  const seen = state.seen[name] ?? {};
  return relevant(name).filter((item) => !Object.hasOwn(seen, item.id) || stampOf(item) > seen[item.id]);
}

function markSeen(name) {
  const next = Object.fromEntries(active(name).map((item) => [item.id, stampOf(item)]));
  if (JSON.stringify(next) === JSON.stringify(state.seen[name])) return;
  state.seen[name] = next;
  saveSeen();
}

function isPanelOnScreen(name) {
  return !document.getElementById(PANEL_OF[name]).hidden && document.visibilityState === "visible";
}

// Aba aberta: guarda o que era novidade (para a etiqueta "Novo") e marca tudo como visto.
// Ao sair da aba, as etiquetas somem.
function syncSeen() {
  for (const name of Object.keys(PANEL_OF)) {
    if (!state.seen[name]) continue; // coleção ainda carregando
    if (!isPanelOnScreen(name)) {
      if (document.visibilityState === "visible") state.fresh[name] = null;
      continue;
    }
    state.fresh[name] ??= new Set();
    unseen(name).forEach((item) => state.fresh[name].add(item.id));
    markSeen(name);
  }
}

function isFresh(name, id) {
  return Boolean(state.fresh[name]?.has(id));
}

function updateBadges() {
  let total = 0;
  for (const [name, panelId] of Object.entries(PANEL_OF)) {
    const count = state.seen[name] && !isPanelOnScreen(name) ? unseen(name).length : 0;
    total += count;
    setBadge(document.querySelector(`[aria-controls="${panelId}"]`), count);
  }
  document.title = total ? `(${total}) ${state.baseTitle}` : state.baseTitle;
}

function setBadge(tab, count) {
  let badge = tab.querySelector(".tab-badge");
  if (!badge) {
    badge = createText("span", "", "tab-badge");
    tab.append(badge);
  }
  badge.hidden = count === 0;
  if (!count) return;
  badge.replaceChildren(count > 99 ? "99+" : String(count), createText("span", count === 1 ? " novidade" : " novidades", "visually-hidden"));
}

function newLabel() {
  return createText("span", "Novo", "new-label");
}

function upcomingActivities(filtered) {
  const today = todayValue();
  return active(ACTIVITIES)
    .filter((item) => item.dueDate >= today && (!filtered || passes(ACTIVITIES, item.subject)))
    .sort(byDue(1));
}

function renderActivities() {
  const today = todayValue();
  const all = active(ACTIVITIES).filter((item) => passes(ACTIVITIES, item.subject));
  const upcoming = all.filter((item) => item.dueDate >= today).sort(byDue(1));
  const history = all.filter((item) => item.dueDate < today).sort(byDue(-1));
  const trash = trashOf(ACTIVITIES);

  renderActivityList("activities", upcoming, "upcoming");
  renderActivityList("history", history, "history");
  renderActivityList("trash", trash, "trash");
  renderWeekLoad();
  elements.calendarButton.disabled = upcoming.length === 0;

  setCount("activities", upcoming.length, "atividade pendente", "atividades pendentes");
  setCount("history", history.length, "atividade passada", "atividades passadas");
  setCount("trash", trash.length, "atividade na lixeira", "atividades na lixeira");

  // Resumo no topo: entregas desta semana e a próxima entrega.
  const pending = upcomingActivities(false).filter((item) => !state.done.has(item.id));
  const thisWeek = pending.filter((item) => weekOffset(item.dueDate) === 0).length;
  const next = pending[0];
  elements.pageSummary.textContent = [
    `${plural(state.turma.tamanho, "pessoa", "pessoas")}`,
    thisWeek ? `${plural(thisWeek, "entrega pendente", "entregas pendentes")} esta semana` : "nada pendente esta semana",
    next && `próxima: ${next.subject} ${formatShortDate(next.dueDate).toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderNotices() {
  const list = active(NOTICES).sort(compareNotices);
  renderEntries(NOTICES, "notices", "notice-trash", list, ["aviso", "avisos"]);
}

// Eventos e oportunidades com data passada saem da lista sozinhos (não são apagados).
function renderEvents() {
  const today = todayValue();
  const list = active(EVENTS)
    .filter((item) => item.date >= today && passes(EVENTS, item.type))
    .sort((a, b) => momentOf(a.date, a.time) - momentOf(b.date, b.time) || a.title.localeCompare(b.title, "pt-BR"));
  renderEntries(EVENTS, "events", "event-trash", list, ["evento", "eventos"]);
}

function renderOpportunities() {
  const today = todayValue();
  const list = active(OPPORTUNITIES)
    .filter((item) => item.deadline >= today && passes(OPPORTUNITIES, item.kind))
    .sort(byDate("deadline", 1));
  renderEntries(OPPORTUNITIES, "opportunities", "opportunity-trash", list, ["oportunidade", "oportunidades"]);
}

function renderFiles() {
  const list = active(FILES)
    .filter((item) => passes(FILES, item.subject))
    // Por matéria (Geral por último) e depois pelo nome.
    .sort(
      (a, b) =>
        Number(!a.subject) - Number(!b.subject) ||
        a.subject.localeCompare(b.subject, "pt-BR") ||
        a.title.localeCompare(b.title, "pt-BR"),
    );
  renderEntries(FILES, "files", "file-trash", list, ["arquivo", "arquivos"]);
}

function renderEntries(name, key, trashKey, list, [singular, many]) {
  const trash = trashOf(name);
  renderEntryList(key, list, name, false);
  renderEntryList(trashKey, trash, name, true);
  setCount(key, list.length, singular, many);
  setCount(trashKey, trash.length, `${singular} na lixeira`, `${many} na lixeira`);
}

function setCount(key, total, singular, many) {
  const { count, empty } = lists[key];
  count.textContent = String(total);
  count.setAttribute("aria-label", `${total} ${total === 1 ? singular : many}`);
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

function compareNotices(a, b) {
  return (
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    b.date.localeCompare(a.date) ||
    (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0)
  );
}

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
    row.classList.toggle("is-fresh", kind === "upcoming" && isFresh(ACTIVITIES, activity.id));
    row.append(
      kind === "trash" ? createSpacer("task-check") : createCheckbox(activity),
      createDateBlock(activity.dueDate),
      createActivityCopy(activity, kind),
      createSubjectBadge(activity.subject),
      createRowActions(activity, ACTIVITIES, kind === "trash", kind === "upcoming"),
    );
    fragment.append(row);
  });
  list.replaceChildren(fragment);
}

// Cartões de avisos, eventos, oportunidades e arquivos: data (ou ícone), conteúdo e ações.
function renderEntryList(key, items, collection, inTrash) {
  const { list } = lists[key];
  const before = previousIds(list);
  const config = collections[collection];
  const cards = items.map((item) => {
    const description = { ...config.describe(item), collection };
    const card = document.createElement("li");
    card.className = "entry";
    card.dataset.id = item.id;
    card.classList.toggle("is-pinned", Boolean(item.pinned) && !inTrash);
    card.classList.toggle("is-new", before.size > 0 && !before.has(item.id));
    card.classList.toggle("is-fresh", !inTrash && isFresh(collection, item.id));
    const lead = description.date ? createDateBlock(description.date) : createText("span", "", "entry-icon");
    if (!description.date) lead.append(icon("file"));
    card.append(lead, createEntryCopy(item, description, inTrash), createRowActions(item, collection, inTrash, description.calendar));
    return card;
  });
  list.replaceChildren(...cards);
}

function createCheckbox(activity) {
  const done = state.done.has(activity.id);
  const label = createText("label", "", "task-check");
  label.classList.toggle("is-changed", activity.id === state.justToggled);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = done;
  input.disabled = state.turma.arquivada;
  input.dataset.id = activity.id;
  input.dataset.action = "toggle";
  input.setAttribute("aria-label", done ? `Desmarcar ${activity.title} como feita` : `Marcar ${activity.title} como feita`);

  const checkmark = createText("span", "", "checkmark");
  checkmark.setAttribute("aria-hidden", "true");
  checkmark.append(icon("check"));
  label.append(input, checkmark);
  return label;
}

function createDateBlock(date) {
  const [year, month, day] = date.split("-");
  const time = createText("time", "", "date-block");
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
  if (kind === "upcoming" && isFresh(ACTIVITIES, activity.id)) meta.append(newLabel());
  meta.append(createDue(activity), createProgressText(activity));
  if (kind === "upcoming") copy.append(createProgressBar(activity));
  return copy;
}

// description: { date, meta: [Node], body, link?, calendar? }.
function createEntryCopy(item, description, inTrash) {
  const copy = createText("div", "", "entry-copy");
  const meta = createText("p", "", "entry-meta");
  if (inTrash) meta.textContent = `Pode ser restaurado até ${formatRestoreDate(item)}`;
  else meta.append(...(isFresh(description.collection, item.id) ? [newLabel()] : []), ...description.meta);

  copy.append(meta, createText("h3", item.title, "entry-title"));
  if (description.body) copy.append(createText("p", description.body, "entry-body"));
  if (description.link && !inTrash) copy.append(description.link);
  return copy;
}

function describeNotice(notice) {
  const source = createText("span", notice.source === "professor" ? `Professor — ${notice.sourceDetail}` : SOURCES.lideres);
  const meta = notice.pinned ? [createText("span", "Fixado", "pin-label"), source] : [source];
  return { date: notice.date, meta, body: notice.body };
}

function linkTo(value, text) {
  const url = value ? safeUrl(value) : null;
  return url ? externalLink(url, text(url), "entry-link") : null;
}

function describeEvent(event) {
  const meta = [createText("span", EVENT_TYPES[event.type], "type-label")];
  if (event.time) meta.push(createText("span", `às ${event.time}`));
  meta.push(createText("span", relativeDay(event.date)));
  return {
    date: event.date,
    meta,
    body: event.description,
    link: linkTo(event.link, (url) => `Abrir em ${url.hostname}`),
    calendar: true,
  };
}

function describeOpportunity(opportunity) {
  const days = daysUntil(opportunity.deadline);
  const meta = [createText("span", KINDS[opportunity.kind], "type-label")];
  if (opportunity.org) meta.push(createText("span", opportunity.org));
  const due = createText(
    "span",
    days === 0 ? "Inscrições até hoje" : days === 1 ? "Inscrições até amanhã" : `Inscrições até ${formatShortDate(opportunity.deadline)} · faltam ${days} dias`,
    "due",
  );
  if (days <= 2) due.dataset.tone = "soon";
  else if (days <= 7) due.dataset.tone = "week";
  meta.push(due);
  return {
    date: opportunity.deadline,
    meta,
    body: opportunity.description,
    link: linkTo(opportunity.link, () => "Inscrever-se"),
    calendar: true,
  };
}

function describeFile(file) {
  const subject = createText("span", file.subject || "Geral");
  subject.translate = !file.subject;
  return {
    date: null,
    meta: [createText("span", CATEGORIES[file.category], "type-label"), subject],
    body: "",
    link: linkTo(file.link, (url) => `Abrir (${url.hostname.replace(/^www\./, "")})`),
  };
}

function relativeDay(date) {
  const days = daysUntil(date);
  return days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`;
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

  if (days === 0 && activity.dueTime) {
    // Hoje com horário: texto e tom recalculados a cada minuto por updateCountdowns.
    due.dataset.dueAt = String(momentOf(activity.dueDate, activity.dueTime));
    due.dataset.done = String(done);
    updateCountdown(due);
    return due;
  }

  const base = days === 0 ? "Vence hoje" : days === 1 ? "Vence amanhã" : `Em ${days} dias`;
  due.textContent = activity.dueTime ? `${base} · ${activity.dueTime}` : base;
  if (!done && days <= 2) due.dataset.tone = "soon";
  else if (!done && weekOffset(activity.dueDate) === 0) due.dataset.tone = "week";
  return due;
}

function updateCountdowns() {
  document.querySelectorAll(".due[data-due-at]").forEach(updateCountdown);
}

function updateCountdown(due) {
  const at = Number(due.dataset.dueAt);
  const time = new Date(at).toTimeString().slice(0, 5);
  const minutes = Math.ceil((at - Date.now()) / 60_000);
  const done = due.dataset.done === "true";
  if (minutes <= 0) {
    due.textContent = `Venceu hoje às ${time}`;
    if (done) delete due.dataset.tone;
    else due.dataset.tone = "late";
    return;
  }
  const left = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h`;
  due.textContent = `Vence hoje às ${time} · faltam ${left}`;
  if (done) delete due.dataset.tone;
  else due.dataset.tone = "soon";
}

function createSubjectBadge(subject) {
  const badge = createText("span", subject, "subject-badge");
  badge.translate = false;
  return badge;
}

function classSize() {
  return Math.max(state.turma?.tamanho ?? 0, 1);
}

function createProgressText(activity) {
  const count = doneCountOf(activity);
  const size = classSize();
  const text = createText("span", count >= size ? "Turma toda concluiu" : `${count} de ${size} concluíram`, "progress-count");
  text.classList.toggle("is-complete", count >= size);
  text.classList.toggle("is-changing", countChanged(activity));
  return text;
}

function createProgressBar(activity) {
  const bar = createText("span", "", "progress-bar");
  bar.setAttribute("aria-hidden", "true");
  const fill = createText("span", "", "progress-fill");
  fill.style.setProperty("--p", doneCountOf(activity) / classSize());
  if (countChanged(activity)) {
    fill.style.setProperty("--from", state.lastCounts.get(activity.id) / classSize());
    fill.classList.add("is-changing");
  }
  bar.append(fill);
  return bar;
}

function doneCountOf(activity) {
  return Math.min(activity.doneCount ?? 0, classSize());
}

function countChanged(activity) {
  const previous = state.lastCounts.get(activity.id);
  return previous !== undefined && previous !== doneCountOf(activity);
}

// Calendário para todos; editar/apagar/restaurar só para líderes.
function createRowActions(item, collection, inTrash, withCalendar) {
  const buttons = [];
  if (withCalendar && !inTrash) buttons.push(["calendar", "Adicionar ao calendário:"]);
  if (isLeader()) buttons.push(...(inTrash ? [["restore", "Restaurar"]] : [["edit", "Editar"], ["delete", "Apagar"]]));
  if (!buttons.length) return createSpacer("row-spacer");

  const actions = createText("div", "", "row-actions");
  buttons.forEach(([action, verb]) => {
    const button = createText("button", "", "icon-button");
    button.type = "button";
    button.dataset.id = item.id;
    button.dataset.collection = collection;
    button.dataset.action = action;
    button.setAttribute("aria-label", `${verb} ${item.title}`);
    button.title = action === "calendar" ? "Adicionar ao calendário" : verb;
    button.append(icon(action));
    actions.append(button);
  });
  return actions;
}

// ---------- Carga semanal ----------

// Entregas por semana (todas as matérias, inclusive as que eu já fiz): ajuda os líderes
// a ver semanas pesadas cedo e negociar prazos com os professores.
function renderWeekLoad() {
  const all = active(ACTIVITIES);
  const weeks = Array.from({ length: LOAD_WEEKS }, (_, offset) => {
    const items = all.filter((item) => weekOffset(item.dueDate) === offset);
    const perDay = new Map();
    items.forEach((item) => perDay.set(item.dueDate, (perDay.get(item.dueDate) ?? 0) + 1));
    const [busyDay, busyCount] = [...perDay].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return { offset, count: items.length, busyDay: busyCount >= HEAVY_DAY ? busyDay : null, busyCount };
  });

  elements.weekLoad.hidden = weeks.every((week) => week.count === 0);
  const scale = Math.max(HEAVY_WEEK, ...weeks.map((week) => week.count));
  elements.weekLoad.replaceChildren(
    ...weeks.map(({ offset, count, busyDay, busyCount }) => {
      const range = formatWeek(weekStartDate(offset));
      const heavy = count >= HEAVY_WEEK || Boolean(busyDay);
      const noun = count === 1 ? "entrega" : "entregas";

      const item = createText("li", "", "week-load-item");
      item.classList.toggle("is-heavy", heavy);
      item.classList.toggle("is-current", offset === 0);
      const bar = createText("span", "", "week-load-bar");
      bar.style.setProperty("--p", count / scale);
      const note = busyDay ? `${busyCount} na ${formatShortDate(busyDay).split(" ")[0].toLowerCase()}` : noun;
      item.append(
        createText("span", ["Esta semana", "Próxima"][offset] ?? range, "week-load-label"),
        createText("strong", String(count), "week-load-count"),
        bar,
        createText("span", note, "week-load-note"),
      );
      const alert = busyDay ? `, ${busyCount} no mesmo dia (${formatShortDate(busyDay)})` : heavy ? ", semana pesada" : "";
      item.setAttribute("aria-label", `Semana de ${range}: ${count} ${noun}${alert}`);
      item.title = item.getAttribute("aria-label");
      [...item.children].forEach((child) => child.setAttribute("aria-hidden", "true"));
      return item;
    }),
  );
}

// ---------- Resumo da semana (para colar no grupo) ----------

async function handleSummary() {
  const text = buildSummary();
  // No celular, abre a folha de compartilhar (WhatsApp direto); no computador, copia.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  showToast((await copyText(text)) ? "Resumo copiado. É só colar no grupo." : "Não foi possível copiar o resumo.");
}

// Formatação do WhatsApp (*negrito*): entregas desta semana e da próxima, eventos,
// inscrições que fecham nas duas semanas e avisos fixados. Ignora os filtros.
function buildSummary() {
  const today = todayValue();
  const soon = (date) => date >= today && weekOffset(date) <= 1;
  const activities = active(ACTIVITIES).filter((item) => soon(item.dueDate)).sort(byDue(1));
  const events = active(EVENTS)
    .filter((item) => soon(item.date))
    .sort((a, b) => momentOf(a.date, a.time) - momentOf(b.date, b.time));
  const deadlines = active(OPPORTUNITIES).filter((item) => soon(item.deadline)).sort(byDate("deadline", 1));
  const pinned = active(NOTICES).filter((item) => item.pinned).sort(compareNotices);

  const week = (offset) => {
    const lines = activities
      .filter((item) => weekOffset(item.dueDate) === offset)
      .map((item) => `• ${formatShortDate(item.dueDate)} · ${item.subject} — ${item.title}${item.dueTime ? ` (até ${item.dueTime})` : ""}`);
    return lines.length ? lines : ["• Nenhuma entrega"];
  };

  const lines = [
    `*${state.turma.nome} — semana de ${formatWeek(weekStartDate(0))}*`,
    "",
    "*Esta semana*",
    ...week(0),
    "",
    "*Próxima semana*",
    ...week(1),
  ];
  if (events.length) {
    lines.push(
      "",
      "*Eventos*",
      ...events.map((item) => `• ${formatShortDate(item.date)}${item.time ? ` ${item.time}` : ""} · ${EVENT_TYPES[item.type]} — ${item.title}`),
    );
  }
  if (deadlines.length) {
    lines.push("", "*Inscrições fechando*", ...deadlines.map((item) => `• até ${formatShortDate(item.deadline)} — ${item.title}`));
  }
  if (pinned.length) lines.push("", "*Avisos fixados*", ...pinned.map((item) => `• ${item.title}`));
  lines.push("", `Agenda completa: ${siteUrl()}`);
  return lines.join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sem permissão para a área de transferência: cópia à moda antiga.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

function siteUrl() {
  return `${location.origin}${location.pathname}`;
}

// ---------- Calendário ----------

function toCalendarItem(name) {
  if (name === ACTIVITIES) return (item) => activityToCalendar(item, siteUrl());
  if (name === EVENTS) return (item) => eventToCalendar(item, EVENT_TYPES[item.type], siteUrl());
  return (item) => opportunityToCalendar(item, siteUrl());
}

function exportIcs(items, withToast = true) {
  if (!items.length) return;
  downloadIcs(items, `pauta-${state.turma.id}.ics`);
  if (withToast) {
    showToast(`${plural(items.length, "item exportado", "itens exportados")}. Abra o arquivo para adicionar ao seu calendário.`);
  }
}

// Tudo o que ainda vai acontecer: entregas, eventos e prazos de oportunidades.
function exportAll() {
  const today = todayValue();
  exportIcs([
    ...upcomingActivities(false).map(toCalendarItem(ACTIVITIES)),
    ...active(EVENTS).filter((item) => item.date >= today).map(toCalendarItem(EVENTS)),
    ...active(OPPORTUNITIES).filter((item) => item.deadline >= today).map(toCalendarItem(OPPORTUNITIES)),
  ]);
}

function openCalendarDialog(item) {
  state.calendarItem = item;
  elements.addCalendarDescription.textContent = `“${item.title}” — ${formatDayTitle(item.date)}${item.time ? `, às ${item.time}` : ""}.`;
  elements.addGoogle.href = googleCalendarUrl(item);
  elements.addOutlook.href = outlookCalendarUrl(item);
  elements.addCalendarDialog.showModal();
}

// Tudo o que aparece no mês: Map("AAAA-MM-DD" → [{ kind, label, item, name }]).
function calendarEntries() {
  const byDate = new Map();
  const add = (date, entry) => byDate.set(date, [...(byDate.get(date) ?? []), entry]);
  active(ACTIVITIES)
    .sort(byDue(1))
    .forEach((item) => add(item.dueDate, { kind: "activity", label: item.subject, item, name: ACTIVITIES }));
  active(EVENTS)
    .sort((a, b) => momentOf(a.date, a.time) - momentOf(b.date, b.time))
    .forEach((item) => add(item.date, { kind: "event", label: item.title, item, name: EVENTS }));
  active(OPPORTUNITIES).forEach((item) =>
    add(item.deadline, { kind: "opportunity", label: `Prazo: ${item.title}`, item, name: OPPORTUNITIES }),
  );
  return byDate;
}

function renderCalendar() {
  if (!state.turma) return;
  const byDate = calendarEntries();
  const title = formatMonth(state.calendarMonth);
  elements.calendarTitle.textContent = title.charAt(0).toUpperCase() + title.slice(1);
  renderMonthGrid(elements.calendarGrid, state.calendarMonth, byDate, state.calendarDay);
  renderDay(byDate.get(state.calendarDay) ?? []);
}

function renderDay(entries) {
  const day = state.calendarDay;
  const title = formatDayTitle(day);
  elements.dayTitle.textContent = `${title.charAt(0).toUpperCase()}${title.slice(1)}${day === todayValue() ? " · hoje" : ""}`;
  elements.dayEmpty.hidden = entries.length > 0;
  elements.dayList.replaceChildren(
    ...entries.map(({ kind, item, name }) => {
      const li = createText("li", "", `day-item is-${kind}`);
      const copy = createText("div", "", "day-copy");
      const kindLabel = { activity: "Entrega", event: EVENT_TYPES[item.type], opportunity: "Prazo de inscrição" }[kind];
      const detail = [
        kindLabel,
        kind === "activity" && item.subject,
        (item.dueTime || item.time) && `às ${item.dueTime || item.time}`,
        kind === "activity" && state.done.has(item.id) && "feita",
      ]
        .filter(Boolean)
        .join(" · ");
      copy.append(createText("p", detail, "day-meta"), createText("p", item.title, "day-title"));
      const button = createText("button", "", "icon-button");
      button.type = "button";
      button.dataset.action = "calendar";
      button.dataset.collection = name;
      button.dataset.id = item.id;
      button.setAttribute("aria-label", `Adicionar ao calendário: ${item.title}`);
      button.title = "Adicionar ao calendário";
      button.append(icon("calendar"));
      li.append(copy, button);
      return li;
    }),
  );
}

function selectDay(value, focus) {
  state.calendarDay = value;
  state.calendarMonth = parseDate(value);
  renderCalendar();
  if (focus) elements.calendarGrid.querySelector(`[data-date="${value}"]`)?.focus();
}

function moveMonth(step) {
  const month = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + step, 1, 12);
  state.calendarMonth = month;
  // Mantém o dia selecionado se ele está no mês; senão, o dia 1 (ou hoje, se for o mês atual).
  const today = todayValue();
  state.calendarDay = today.slice(0, 7) === toDateValue(month).slice(0, 7) ? today : toDateValue(month);
  renderCalendar();
}

// Setas movem o dia (←/→ um dia, ↑/↓ uma semana); Home/End vão ao começo/fim da semana.
function handleGridKey(event) {
  const day = event.target.closest(".calendar-day");
  if (!day) return;
  const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const weekday = (parseDate(day.dataset.date).getDay() + 6) % 7;
  const step = steps[event.key] ?? (event.key === "Home" ? -weekday : event.key === "End" ? 6 - weekday : null);
  if (step === null) return;
  event.preventDefault();
  selectDay(addDays(day.dataset.date, step), true);
}

// ---------- Utilitários ----------

// Ordena pelo campo de data (1 = crescente, -1 = decrescente) e, no empate, pelo título.
function byDate(field, direction) {
  return (a, b) => a[field].localeCompare(b[field]) * direction || a.title.localeCompare(b.title, "pt-BR");
}

// Atividades: data, depois horário (sem horário = fim do dia), depois título.
function byDue(direction) {
  return (a, b) =>
    (momentOf(a.dueDate, a.dueTime) - momentOf(b.dueDate, b.dueTime)) * direction || a.title.localeCompare(b.title, "pt-BR");
}

function formatRestoreDate(item) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(toMillis(item.deletedAt) + TRASH_DAYS * DAY_MS);
}

function setConnection(mode, label) {
  elements.connectionPill.dataset.mode = mode;
  elements.connectionLabel.textContent = label;
}
