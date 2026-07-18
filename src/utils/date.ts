// Purpose: UTC-safe date arithmetic so market dates do not shift with the phone timezone.

import type { DateString } from '@/types/backtest';

const DAY_MS = 86_400_000;

export function parseDate(value: DateString): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function toDateString(date: Date): DateString {
  return date.toISOString().slice(0, 10);
}

export function todayDateString(): DateString {
  return toLocalDateString(new Date());
}

export function parseLocalDate(value: DateString): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function toLocalDateString(date: Date): DateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(value: DateString, days: number): DateString {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export function addMonthsClamped(value: DateString, months: number): DateString {
  const origin = parseDate(value);
  const day = origin.getUTCDate();
  const target = new Date(Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDateString(target);
}

export function addYearsClamped(value: DateString, years: number): DateString {
  return addMonthsClamped(value, years * 12);
}

export function daysBetween(start: DateString, end: DateString): number {
  return Math.max(0, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS));
}

export function previousDay(value: DateString): DateString {
  return addDays(value, -1);
}

export function isWeekday(value: DateString): boolean {
  const day = parseDate(value).getUTCDay();
  return day !== 0 && day !== 6;
}

export function nextWeekday(value: DateString): DateString {
  let cursor = value;
  while (!isWeekday(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

export function formatDate(value?: DateString): string {
  if (!value) return '—';
  return value.replaceAll('-', '/');
}

export function formatDuration(days: number): string {
  if (days < 31) return `${days} days`;
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.44);
  if (years === 0) return `${months} months`;
  return months > 0 ? `${years}y ${months}m` : `${years} years`;
}
