// Datas da agenda: sempre strings AAAA-MM-DD (as do <input type="date">) no fuso local.

export const DAY_MS = 86_400_000;
export const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Meio-dia: evita pular de dia na troca de horário de verão.
export function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function toDateValue(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
}

export function todayValue() {
  return toDateValue(new Date());
}

export function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toDateValue(date);
}

export function daysUntil(value) {
  return Math.round((parseDate(value) - parseDate(todayValue())) / DAY_MS);
}

// 0 = esta semana, 1 = próxima (semanas começando na segunda).
export function weekOffset(value) {
  const weekStart = (date) => date.getTime() - ((date.getDay() + 6) % 7) * DAY_MS;
  return Math.round((weekStart(parseDate(value)) - weekStart(parseDate(todayValue()))) / (7 * DAY_MS));
}

export function weekLabel(value) {
  return ["Esta semana", "Próxima semana"][weekOffset(value)] ?? "Depois";
}

// Segunda-feira da semana de hoje + offset semanas.
export function weekStartDate(offset) {
  const date = parseDate(todayValue());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offset * 7);
  return date;
}

// "10–16 nov" ou "28 nov–4 dez" para a semana que começa em start.
export function formatWeek(start) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const month = (date) => MONTHS[date.getMonth()].toLowerCase();
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${month(end)}`
    : `${start.getDate()} ${month(start)}–${end.getDate()} ${month(end)}`;
}

// "Qui 13/11"
export function formatShortDate(value) {
  const [, month, day] = value.split("-");
  return `${WEEKDAYS[parseDate(value).getDay()]} ${day}/${month}`;
}

// "13 de novembro de 2026"
export function formatLongDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(parseDate(value));
}

// "quinta-feira, 13 de novembro"
export function formatDayTitle(value) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(parseDate(value));
}

// "novembro de 2026"
export function formatMonth(date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}

// Timestamp do Firestore ou string ISO (modo local) → milissegundos.
export function toMillis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : Date.parse(value);
}

// Momento exato de uma data + horário opcional (sem horário = fim do dia).
export function momentOf(date, time) {
  const [hour, minute] = (time || "23:59").split(":").map(Number);
  const moment = parseDate(date);
  moment.setHours(hour, minute, 0, 0);
  return moment.getTime();
}
