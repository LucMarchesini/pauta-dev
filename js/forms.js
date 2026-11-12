import { createText } from "./dom.js";

// Erros junto aos campos: aria-invalid + mensagem ligada por aria-describedby.

export const TITLE_PROBLEM = "Use pelo menos 3 caracteres.";
export const LINK_PROBLEM = "O link precisa começar com http:// ou https://.";

// Marca cada campo inválido (restrição do HTML ou `problems` = { nomeDoCampo: mensagem }),
// foca o primeiro e devolve a mensagem dele ("" se está tudo certo).
export function showProblems(form, problems = {}) {
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

function constraintProblem(field) {
  const { validity } = field;
  if (validity.valid) return "";
  if (validity.valueMissing) return field.tagName === "SELECT" ? "Selecione uma opção." : "Preencha este campo.";
  if (validity.tooShort) return `Use pelo menos ${field.minLength} caracteres.`;
  if (field.type === "email") return "Digite um e-mail válido.";
  if (field.type === "url") return LINK_PROBLEM;
  return "Revise este campo.";
}

export function setFieldError(field, message) {
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

export function clearProblems(form) {
  for (const field of form.elements) if (field.id) setFieldError(field, "");
}

// Editar um campo marcado tira a marcação dele.
export function watchFields(form) {
  const clear = (event) => {
    if (event.target.hasAttribute("aria-invalid")) setFieldError(event.target, "");
  };
  form.addEventListener("input", clear);
  form.addEventListener("change", clear);
}

export function setSubmitLabel(form, label, busy = false) {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = busy;
  submit.querySelector("span").textContent = label;
}
