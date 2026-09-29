import { format, startOfDay } from 'date-fns';

/** `YYYY-MM-DD HH:mm:ss` in local time — the string the endpoint expects. */
export function formatResignationDate(date) {
  return format(date, 'yyyy-MM-dd HH:mm:ss');
}

/** `YYYY-MM-DD`, how the classic screens show a chosen date. */
export function formatResignationDayLabel(date) {
  return format(date, 'yyyy-MM-dd');
}

/** Earliest selectable resignation date: the start of today. */
export function earliestResignationDate(now = new Date()) {
  return startOfDay(now);
}
