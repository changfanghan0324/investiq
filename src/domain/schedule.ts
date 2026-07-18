// Purpose: Converts recurring calendar rules into actual available trading dates.

import type { DateString, IntervalUnit } from '@/types/backtest';
import { addDays, addMonthsClamped, addYearsClamped } from '@/utils/date';

export interface ScheduleInput {
  startDate: DateString;
  endDate: DateString;
  intervalValue: number;
  intervalUnit: IntervalUnit;
}

export function buildExecutionSchedule(
  tradingDates: DateString[],
  input: ScheduleInput,
): DateString[] {
  const available = tradingDates.filter((date) => date >= input.startDate && date <= input.endDate);
  if (available.length === 0) return [];

  if (input.intervalUnit === 'trading-days') {
    const step = Math.max(1, Math.floor(input.intervalValue));
    return available.filter((_, index) => index % step === 0);
  }

  const result: DateString[] = [];
  let occurrence = 0;
  while (occurrence < 20_000) {
    const dueDate = calendarDueDate(input.startDate, occurrence, input.intervalValue, input.intervalUnit);
    if (dueDate > input.endDate) break;
    const executionDate = available.find((date) => date >= dueDate);
    if (executionDate && executionDate <= input.endDate) result.push(executionDate);
    occurrence += 1;
  }
  return result;
}

function calendarDueDate(
  startDate: DateString,
  occurrence: number,
  intervalValue: number,
  unit: Exclude<IntervalUnit, 'trading-days'>,
): DateString {
  const amount = occurrence * Math.max(1, Math.floor(intervalValue));
  if (unit === 'weeks') return addDays(startDate, amount * 7);
  if (unit === 'months') return addMonthsClamped(startDate, amount);
  return addYearsClamped(startDate, amount);
}

export function nextAvailableTradingDate(
  tradingDates: DateString[],
  target: DateString,
): DateString | undefined {
  return tradingDates.find((date) => date >= target);
}
