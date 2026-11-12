import { DuplicateTurma } from "./data.js";
import { createText, plural, showToast } from "./dom.js";
import { clearProblems, setFieldError, setSubmitLabel, showProblems, watchFields } from "./forms.js";

// Painel dos admins: turmas (uma por semestre), matérias iniciais, membros e líderes,
// arquivar/reativar. As regras (firestore.rules.proposta) garantem que só admins gravam.

const EMAIL = /^[^\s@]+@(al\.)?insper\.edu\.br$/;
const SEMESTER = /^\d{4}\.[12]$/;

const $ = (selector) => document.querySelector(selector);

export function initAdmin(service) {
  const elements = {
    list: $("#admin-list"),
    empty: $("#admin-empty"),
    count: $("#admin-count"),
    turmaDialog: $("#turma-dialog"),
    turmaForm: $("#turma-form"),
    turmaTitle: $("#turma-form-title"),
    copyField: $("#turma-copy-field"),
    membrosDialog: $("#membros-dialog"),
    membrosForm: $("#membros-form"),
    membrosTurma: $("#membros-turma"),
  };
  let turmas = [];
  let editing = null; // id da turma em edição (null = nova)
  let membrosOf = null; // id da turma cujos membros estão abertos

  watchFields(elements.turmaForm);
  watchFields(elements.membrosForm);
  $("#new-turma-button").addEventListener("click", () => openTurma(null));
  elements.list.addEventListener("click", handleListClick);
  elements.turmaForm.addEventListener("submit", saveTurma);
  elements.membrosForm.addEventListener("submit", saveMembros);
  for (const dialog of [elements.turmaDialog, elements.membrosDialog]) {
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  }

  load();

  async function load() {
    try {
      turmas = await service.listTurmas();
    } catch (error) {
      console.error("Erro ao carregar as turmas:", error);
      showToast("Não foi possível carregar as turmas.");
      return;
    }
    // Abertas primeiro; dentro de cada grupo, semestre mais recente e depois nome.
    turmas.sort(
      (a, b) =>
        Number(a.arquivada) - Number(b.arquivada) ||
        b.semestre.localeCompare(a.semestre) ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );
    render();
  }

  function render() {
    elements.count.textContent = String(turmas.length);
    elements.count.setAttribute("aria-label", plural(turmas.length, "turma", "turmas"));
    elements.empty.hidden = turmas.length > 0;
    elements.list.replaceChildren(
      ...turmas.map((turma) => {
        const row = document.createElement("li");
        row.className = "admin-row";
        row.classList.toggle("is-archived", turma.arquivada);
        row.dataset.id = turma.id;

        const copy = createText("div", "", "admin-copy");
        copy.append(
          createText("p", `${turma.nome} · ${turma.semestre}`, "admin-title"),
          createText(
            "p",
            `${plural(turma.tamanho, "pessoa", "pessoas")} · ${plural(turma.materias.length, "matéria", "matérias")}`,
            "admin-meta",
          ),
        );
        const status = createText("span", turma.arquivada ? "Arquivada" : "Em andamento", "status-pill");
        status.dataset.status = turma.arquivada ? "archived" : "open";

        const actions = createText("div", "", "admin-actions");
        [
          ["membros", "Membros"],
          ["editar", "Editar"],
          ["arquivar", turma.arquivada ? "Reativar" : "Arquivar"],
        ].forEach(([action, label]) => {
          const button = createText("button", label, "ghost-button");
          button.type = "button";
          button.dataset.action = action;
          button.setAttribute("aria-label", `${label}: ${turma.nome} ${turma.semestre}`);
          actions.append(button);
        });
        row.append(copy, status, actions);
        return row;
      }),
    );
  }

  function handleListClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const turma = turmas.find((item) => item.id === button.closest(".admin-row").dataset.id);
    if (button.dataset.action === "membros") openMembros(turma);
    if (button.dataset.action === "editar") openTurma(turma);
    if (button.dataset.action === "arquivar") toggleArchive(turma, button);
  }

  // ---------- Criar / editar turma ----------

  function openTurma(turma) {
    editing = turma?.id ?? null;
    const form = elements.turmaForm;
    form.reset();
    clearProblems(form);
    elements.turmaTitle.textContent = turma ? "Editar turma" : "Nova turma";
    setSubmitLabel(form, turma ? "Salvar turma" : "Criar turma");
    elements.copyField.hidden = Boolean(turma);
    form.elements.copy.replaceChildren(
      new Option("Não copiar (começar vazia)", ""),
      ...turmas.map((item) => new Option(`${item.nome} · ${item.semestre}`, item.id)),
    );
    if (turma) {
      form.elements.nome.value = turma.nome;
      form.elements.semestre.value = turma.semestre;
      form.elements.materias.value = turma.materias.join("\n");
    } else {
      form.elements.semestre.value = nextSemester();
      // Sugere as matérias e os membros da turma aberta mais recente.
      const latest = turmas.find((item) => !item.arquivada);
      if (latest) {
        form.elements.nome.value = latest.nome;
        form.elements.materias.value = latest.materias.join("\n");
        form.elements.copy.value = latest.id;
      }
    }
    elements.turmaDialog.showModal();
    form.elements.nome.focus();
  }

  async function saveTurma(event) {
    event.preventDefault();
    const form = elements.turmaForm;
    const materias = parseMaterias(form.elements.materias.value);
    const data = {
      nome: form.elements.nome.value.trim().replace(/\s+/g, " "),
      semestre: form.elements.semestre.value.trim(),
      materias,
    };
    const problem = showProblems(form, {
      nome: data.nome.length < 2 && "Use pelo menos 2 caracteres.",
      semestre: !SEMESTER.test(data.semestre) && "Use o formato 2027.1 ou 2027.2.",
      materias: materiasProblem(materias),
    });
    if (problem) return showToast(problem);

    setSubmitLabel(form, "Salvando…", true);
    try {
      if (editing) {
        await service.saveTurma(editing, data);
        showToast("Turma atualizada.");
      } else {
        const id = await service.saveTurma(null, { ...data, arquivada: false });
        const copy = form.elements.copy.value;
        if (copy) await service.saveMembros(id, await service.listMembros(copy));
        showToast(copy ? "Turma criada com os membros copiados." : "Turma criada. Agora adicione os membros.");
      }
      elements.turmaDialog.close();
      await load();
    } catch (error) {
      if (error instanceof DuplicateTurma) {
        setFieldError(form.elements.semestre, error.message);
        form.elements.semestre.focus();
        return showToast(error.message);
      }
      console.error("Erro ao salvar a turma:", error);
      showToast("Não foi possível salvar a turma.");
    } finally {
      setSubmitLabel(form, editing ? "Salvar turma" : "Criar turma");
    }
  }

  async function toggleArchive(turma, button) {
    button.disabled = true;
    try {
      await service.saveTurma(turma.id, { arquivada: !turma.arquivada });
      showToast(turma.arquivada ? "Turma reativada." : "Turma arquivada: agora é só leitura.");
      await load();
    } catch (error) {
      console.error("Erro ao arquivar:", error);
      showToast("Não foi possível alterar a turma.");
      button.disabled = false;
    }
  }

  // ---------- Membros ----------

  async function openMembros(turma) {
    membrosOf = turma.id;
    const form = elements.membrosForm;
    form.reset();
    clearProblems(form);
    elements.membrosTurma.textContent = `${turma.nome} · ${turma.semestre}`.toUpperCase();
    setSubmitLabel(form, "Carregando…", true);
    elements.membrosDialog.showModal();
    try {
      const membros = await service.listMembros(turma.id);
      const byRole = (papel) =>
        Object.keys(membros)
          .filter((email) => membros[email] === papel)
          .sort()
          .join("\n");
      form.elements.lideres.value = byRole("lider");
      form.elements.alunos.value = byRole("aluno");
      setSubmitLabel(form, "Salvar membros");
      form.elements.lideres.focus();
    } catch (error) {
      console.error("Erro ao carregar membros:", error);
      showToast("Não foi possível carregar os membros.");
      elements.membrosDialog.close();
    }
  }

  async function saveMembros(event) {
    event.preventDefault();
    const form = elements.membrosForm;
    const lideres = parseEmails(form.elements.lideres);
    const alunos = parseEmails(form.elements.alunos);
    if (!lideres || !alunos) return showToast("Revise os e-mails marcados.");

    // Quem está nas duas listas fica como líder.
    const membros = Object.fromEntries([...alunos.map((email) => [email, "aluno"]), ...lideres.map((email) => [email, "lider"])]);
    setSubmitLabel(form, "Salvando…", true);
    try {
      await service.saveMembros(membrosOf, membros);
      elements.membrosDialog.close();
      showToast(`${plural(Object.keys(membros).length, "membro salvo", "membros salvos")}.`);
      await load();
    } catch (error) {
      console.error("Erro ao salvar membros:", error);
      showToast("Não foi possível salvar os membros.");
    } finally {
      setSubmitLabel(form, "Salvar membros");
    }
  }
}

// Uma por linha (ou separadas por vírgula), sem repetir, mantendo a ordem.
export function parseMaterias(text) {
  const seen = new Set();
  return text
    .split(/[\n,]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()));
}

export function materiasProblem(materias) {
  if (!materias.length) return "Informe pelo menos uma matéria.";
  if (materias.length > 20) return "Use no máximo 20 matérias.";
  if (materias.some((item) => item.length > 30)) return "Cada matéria pode ter até 30 caracteres.";
  return false;
}

// Lista de e-mails de um textarea; marca o campo e devolve null se houver e-mail inválido.
function parseEmails(field) {
  const emails = [...new Set(field.value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const invalid = emails.filter((email) => !EMAIL.test(email));
  if (invalid.length) {
    setFieldError(field, `Não são e-mails do Insper: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`);
    field.focus();
    return null;
  }
  setFieldError(field, "");
  return emails;
}

// Sugestão para a próxima turma: o semestre seguinte ao atual.
function nextSemester() {
  const now = new Date();
  return now.getMonth() < 6 ? `${now.getFullYear()}.2` : `${now.getFullYear() + 1}.1`;
}
