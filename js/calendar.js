import { addDays, formatLongDate, momentOf, parseDate, toDateValue, todayValue } from "./dates.js";
import { createText } from "./dom.js";

// Calendário: links do Google Agenda e do Outlook, arquivo .ics e a grade do mês.
// Tudo sem servidor: os links abrem o evento já preenchido na conta da pessoa; o .ics
// serve para Outlook (desktop), iPhone e qualquer outro calendário.
//
// Item de calendário: { uid, title, description, date, time, allDay, start, end, alarm }
// (start/end em ms; alarm no formato do .ics, ex.: "-P1D").

const MINUTE = 60_000;

export function activityToCalendar(activity, siteUrl) {
  const timed = Boolean(activity.dueTime);
  const end = momentOf(activity.dueDate, activity.dueTime);
  return {
    uid: `${activity.id}@agenda-b`,
    title: `[${activity.subject}] ${activity.title}`,
    description: `Entrega da turma${timed ? ` até ${activity.dueTime}` : ""}. ${siteUrl}`,
    date: activity.dueDate,
    time: activity.dueTime ?? "",
    allDay: !timed,
    start: end - 30 * MINUTE, // bloco de 30 min terminando no prazo
    end,
    alarm: timed ? "-P1D" : "-PT6H", // sem horário: 18h da véspera
  };
}

export function eventToCalendar(event, typeLabel, siteUrl) {
  const timed = Boolean(event.time);
  const start = momentOf(event.date, event.time || "00:00");
  return {
    uid: `${event.id}@agenda-b`,
    title: event.title,
    description: `${typeLabel}. ${event.description}${event.link ? ` ${event.link}` : ""} ${siteUrl}`,
    date: event.date,
    time: event.time ?? "",
    allDay: !timed,
    start,
    end: start + 60 * MINUTE,
    alarm: timed ? "-PT2H" : "-PT6H",
  };
}

export function opportunityToCalendar(opportunity, siteUrl) {
  return {
    uid: `${opportunity.id}@agenda-b`,
    title: `Prazo: ${opportunity.title}`,
    description: `${opportunity.org ? `${opportunity.org}. ` : ""}${opportunity.description}${
      opportunity.link ? ` ${opportunity.link}` : ""
    } ${siteUrl}`,
    date: opportunity.deadline,
    time: "",
    allDay: true,
    start: momentOf(opportunity.deadline, "00:00"),
    end: momentOf(opportunity.deadline, "23:59"),
    alarm: "-P2D",
  };
}

// ---------- Links ----------

const pad = (n) => String(n).padStart(2, "0");

// 20261120T233000 (horário local, sem fuso)
function compactLocal(ms) {
  const date = new Date(ms);
  return `${toDateValue(date).replaceAll("-", "")}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

// 2026-11-20T23:30:00-03:00
function isoWithOffset(ms) {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${toDateValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(
    Math.floor(Math.abs(offset) / 60),
  )}:${pad(Math.abs(offset) % 60)}`;
}

export function googleCalendarUrl(item) {
  const dates = item.allDay
    ? `${item.date.replaceAll("-", "")}/${addDays(item.date, 1).replaceAll("-", "")}`
    : `${compactLocal(item.start)}/${compactLocal(item.end)}`;
  const params = new URLSearchParams({ action: "TEMPLATE", text: item.title, dates, details: item.description });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// Outlook web da conta do Insper (Microsoft 365).
export function outlookCalendarUrl(item) {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: item.title,
    body: item.description,
    allday: String(item.allDay),
    startdt: item.allDay ? item.date : isoWithOffset(item.start),
    enddt: item.allDay ? addDays(item.date, 1) : isoWithOffset(item.end),
  });
  return `https://outlook.office.com/calendar/deeplink/compose?${params}`;
}

// ---------- .ics ----------

// O UID é fixo por item: importar de novo atualiza em vez de duplicar. O sufixo
// "@agenda-b" vem do nome antigo do site e fica assim de propósito: trocar
// duplicaria os eventos de quem já importou.
export function buildIcs(items) {
  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
  const events = items.flatMap((item) => [
    "BEGIN:VEVENT",
    `UID:${item.uid}`,
    `DTSTAMP:${stamp}`,
    ...(item.allDay
      ? [`DTSTART;VALUE=DATE:${item.date.replaceAll("-", "")}`, `DTEND;VALUE=DATE:${addDays(item.date, 1).replaceAll("-", "")}`]
      : [`DTSTART:${compactLocal(item.start)}`, `DTEND:${compactLocal(item.end)}`]),
    `SUMMARY:${icsText(item.title)}`,
    `DESCRIPTION:${icsText(item.description)}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(item.title)}`,
    `TRIGGER:${item.alarm}`,
    "END:VALARM",
    "END:VEVENT",
  ]);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pauta//Insper//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Pauta",
    ...events,
    "END:VCALENDAR",
  ];
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

export function downloadIcs(items, filename) {
  const blob = new Blob([buildIcs(items)], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function icsText(value) {
  return value.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");
}

// Linhas de no máximo 75 bytes (RFC 5545); a continuação começa com espaço.
function icsFold(line) {
  const encoder = new TextEncoder();
  const parts = [""];
  for (const char of line) {
    const limit = parts.length === 1 ? 75 : 74;
    if (encoder.encode(parts.at(-1) + char).length > limit) parts.push("");
    parts[parts.length - 1] += char;
  }
  return parts.join("\r\n ");
}

// ---------- Grade do mês ----------

// month: qualquer Date do mês. byDate: Map("AAAA-MM-DD" → [{ kind, label }]).
// Semanas começam na segunda. Cada dia é um botão (aria-pressed = selecionado).
export function renderMonthGrid(container, month, byDate, selected) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const today = todayValue();

  const days = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = toDateValue(date);
    const entries = byDate.get(value) ?? [];

    const day = document.createElement("button");
    day.type = "button";
    day.className = "calendar-day";
    day.dataset.date = value;
    day.classList.toggle("is-other-month", date.getMonth() !== month.getMonth());
    day.classList.toggle("is-today", value === today);
    day.classList.toggle("has-entries", entries.length > 0);
    day.setAttribute("aria-pressed", String(value === selected));
    day.setAttribute("aria-label", `${formatLongDate(value)}${entries.length ? `: ${describe(entries)}` : ""}`);
    if (value !== selected) day.tabIndex = -1;

    const markers = createText("span", "", "calendar-markers");
    entries.slice(0, 3).forEach((entry) => {
      const marker = createText("span", entry.label, `calendar-marker is-${entry.kind}`);
      marker.translate = entry.kind !== "activity";
      markers.append(marker);
    });
    if (entries.length > 3) markers.append(createText("span", `+${entries.length - 3}`, "calendar-more"));
    day.append(createText("span", String(date.getDate()), "calendar-number"), markers);
    return day;
  });
  container.replaceChildren(...days);
  // Garante um dia focável quando o selecionado não está neste mês.
  if (!container.querySelector('[tabindex="0"], .calendar-day:not([tabindex])')) {
    container.querySelector(".calendar-day:not(.is-other-month)").tabIndex = 0;
  }
  return parseDate(toDateValue(first));
}

function describe(entries) {
  const count = (kind) => entries.filter((entry) => entry.kind === kind).length;
  return [
    [count("activity"), "entrega", "entregas"],
    [count("event"), "evento", "eventos"],
    [count("opportunity"), "prazo de oportunidade", "prazos de oportunidade"],
  ]
    .filter(([n]) => n)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(", ");
}
