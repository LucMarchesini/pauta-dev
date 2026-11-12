// Pequenos construtores de DOM. Todo texto entra por textContent (nunca innerHTML com dados).

export const ICONS = {
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  delete: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5",
  restore: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M12 13v5M9.5 15.5h5",
  file: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  check: "m5 12 4 4L19 7",
  close: "M6 6l12 12M18 6 6 18",
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

export function createText(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function createSpacer(className) {
  const spacer = createText("span", "", className);
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

export function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ");
}

// Só aceita links http(s); javascript:, data: e outros esquemas viram null.
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// Link externo seguro (nova aba, sem opener).
export function externalLink(url, text, className) {
  const link = createText("a", text, className);
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${text} (nova aba)`);
  return link;
}

let toastTimer = null;
export function showToast(message) {
  const toast = document.querySelector("#toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
