"use client";

// Purpose: Portfolio Lab workspace — one to ten long-only holdings weighted to exactly 100%,
// bought once with a fixed initial capital and then left alone, measured on the trading dates
// every holding shares.
//
// Honesty rules this file follows:
// - Every portfolio figure comes from `buildPortfolioLab`. Nothing is recalculated here, and a
//   figure the shared window cannot support renders as an em dash with a stated reason, never as
//   zero. The only arithmetic in this file is display formatting, the SPY overlay rebasing (which
//   reads the domain's own `cumulativePriceReturns`), and the illustrative drawdown example.
// - Buy-and-hold only: capital is deployed once at the first shared close, share counts are
//   fractional and then fixed, and nothing is rebalanced. The page says so in the basis panel, in
//   the execution summary, in the diagnosis notes, and inside the CSV header.
// - Only end-of-day close fields are read. Price-only execution values stay separate from the
//   vendor adjusted-close total-return proxy used for performance when coverage is complete.
// - Weights must total exactly 100%. A total above or below that blocks the run instead of being
//   silently rescaled, and the running total is visible at all times.
// - Holdings load strictly one at a time, in row order. SPY is requested afterwards and only when
//   it is not already a holding. A holding that fails blocks the results — a partial portfolio is
//   a different portfolio — but every per-ticker status and every successful load stays on screen.
// - A failed SPY removes beta and the benchmark overlay only. Every other figure stays visible.
// - Sector concentration is never inferred. The domain reports it as unavailable and this page
//   states that gap rather than filling it.
// - The Sharpe ratio uses exactly the risk-free rate the reader typed. No rate feed is read.
// - The CSV is written in this browser from the results already rendered. Nothing is uploaded, and
//   no key, credential, or request detail is included in the file.
// - No external logo service is called; the mark is a monogram of the ticker itself.
// - A result is shown only while it still describes the form on screen. Editing any
//   calculation-affecting input immediately cancels whatever is in flight and clears the result,
//   the load ledger, and everything derived from them — a figure measured on other inputs must
//   never be read as this portfolio's.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { Activity, ChevronDown, Download, Info, Play, Plus, RefreshCw, Scale, TriangleAlert, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell, ShellDisclaimer } from "@/components/app-shell";
import { AnalyticsError, HOLDING_CONCENTRATION_THRESHOLD, cumulativePriceReturns, globalMinimumVarianceWeights, inverseVolatilityWeights, toReturnBasisBars } from "@/domain/analytics";
import { computeEfficientFrontier, type EfficientFrontier } from "@/domain/efficient-frontier";
import { isValidSymbol, normalizeSymbol } from "@/domain/market-overview";
import {
  MAX_PORTFOLIO_HOLDINGS,
  MIN_PORTFOLIO_HOLDINGS,
  buildPortfolioLab,
  type ConcentrationBand,
  type PortfolioDiagnosisCode,
  type PortfolioDiagnosisNote,
  type PortfolioDiagnosisSeverity,
  type PortfolioLabViewModel,
} from "@/domain/portfolio-lab";
import { simulatePeriodicRebalancing, type RebalancingResult } from "@/domain/portfolio-rebalancing";
import { buildRiskContext, type RiskContextAnswers } from "@/domain/risk-context";
import { MIN_COMMON_CLOSES, commonTradingDates } from "@/domain/stock-comparison";
import { MarketDataError, loadMarketData } from "@/services/market-data-api";
import { type Translate, type TranslationKey, useLanguage } from "@/i18n/language";
import {
  FREQUENCY_OPTIONS,
  GOAL_OPTIONS,
  HORIZON_OPTIONS,
  LIMITATION_KEYS,
  LOSS_THRESHOLD_OPTIONS,
  METRIC_KEYS,
  MODE_DETAIL_KEYS,
  MODE_LABEL_KEYS,
  NOTE_KEYS,
  THRESHOLD_KEYS,
  VOLATILITY_KEYS,
  type RiskContextOption,
} from "@/i18n/risk-context-keys";
import type { DateString, MarketData } from "@/types/backtest";
import { daysBetween } from "@/utils/date";

import styles from "./portfolio-lab.module.css";

/** Benchmark for beta and the optional overlay. An investable ETF, not the index itself. */
const BENCHMARK_SYMBOL = "SPY";

/** Opening example, so the workspace shows real output instead of an empty form. */
const EXAMPLE_HOLDINGS: Array<{ symbol: string; weightPercent: string }> = [
  { symbol: "AAPL", weightPercent: "40.0" },
  { symbol: "MSFT", weightPercent: "30.0" },
  { symbol: "SPY", weightPercent: "30.0" },
];

/** Trailing window of the opening example, in years. */
const EXAMPLE_YEARS = 5;

/** Capital deployed once at the first shared close. Always shown and always editable. */
const DEFAULT_INITIAL_CAPITAL = "10000";

/** Default annual risk-free rate, in percent. Always shown and always editable. */
const DEFAULT_RISK_FREE_PERCENT = "0.0";

/** Weights are entered in percent and must total exactly this before anything runs. */
const WEIGHT_TOTAL_PERCENT = 100;

/**
 * Slack allowed on the weight total, in percentage points. It absorbs binary floating-point
 * rounding only — 33.3 + 33.4 + 33.3 lands about 1e-14 away from 100 — and is far tighter than
 * the domain's own weight tolerance, so a total the reader can see is off is never accepted.
 */
const WEIGHT_TOTAL_TOLERANCE_PERCENT = 1e-6;

/** Weight input granularity, in percentage points. */
const WEIGHT_STEP_PERCENT = 0.1;

/** Accepted range for the typed annual risk-free rate, in percent. */
const RISK_FREE_PERCENT_LIMIT = 25;

const MIN_INITIAL_CAPITAL = 1;
const MAX_INITIAL_CAPITAL = 1_000_000_000;

/** Balance used to restate the measured drawdown in dollars. An illustration, not a projection. */
const DRAWDOWN_EXAMPLE_BALANCE = 10_000;

/**
 * Opening answers for the Risk Context panel. Every one of the four carries a weight of zero in the
 * domain's `MODE_WEIGHTS`, so the panel opens on the balanced reading rather than on a leaning the
 * reader never stated.
 */
const DEFAULT_RISK_ANSWERS: RiskContextAnswers = {
  horizon: "3-to-7-years",
  lossThreshold: "up-to-20",
  frequency: "quarterly",
  goal: "learn",
};

/** Earliest start date offered, matching the rest of the product. */
const EARLIEST_START_DATE = "1990-01-01";

/** Shortest window that can produce daily returns worth reading, in calendar days. */
const MIN_WINDOW_DAYS = 30;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PORTFOLIO_COLOR = "#5b8cff";
const BENCHMARK_COLOR = "#f2b636";

type ChartTab = "value" | "cumulative";

const CHART_TABS: Array<{ id: ChartTab; labelKey: TranslationKey }> = [
  { id: "value", labelKey: "portfolioLab.tabValue" },
  { id: "cumulative", labelKey: "portfolioLab.tabCumulative" },
];

/** Every diagnosis code the domain can emit, mapped to the prose the reader sees. */
const DIAGNOSIS_KEYS: Record<PortfolioDiagnosisCode, TranslationKey> = {
  "concentration-concentrated": "portfolioLab.diagConcentrationConcentrated",
  "concentration-focused": "portfolioLab.diagConcentrationFocused",
  "concentration-diversified": "portfolioLab.diagConcentrationDiversified",
  "concentration-holding-above-threshold": "portfolioLab.diagHoldingAboveThreshold",
  "drawdown-shallow": "portfolioLab.diagDrawdownShallow",
  "drawdown-moderate": "portfolioLab.diagDrawdownModerate",
  "drawdown-deep": "portfolioLab.diagDrawdownDeep",
  "drawdown-severe": "portfolioLab.diagDrawdownSevere",
  "volatility-calm": "portfolioLab.diagVolatilityCalm",
  "volatility-normal": "portfolioLab.diagVolatilityNormal",
  "volatility-elevated": "portfolioLab.diagVolatilityElevated",
  "volatility-stressed": "portfolioLab.diagVolatilityStressed",
  "benchmark-unavailable": "portfolioLab.diagBenchmarkUnavailable",
  "benchmark-partial-overlap": "portfolioLab.diagBenchmarkPartial",
  "common-window-shortened": "portfolioLab.diagWindowShortened",
  "sector-data-unavailable": "portfolioLab.diagSectorUnavailable",
  "price-return-only": "portfolioLab.diagPriceReturnOnly",
  "total-return-basis": "portfolioLab.diagTotalReturnBasis",
  "limited-sample": "portfolioLab.diagLimitedSample",
  "no-rebalancing": "portfolioLab.diagNoRebalancing",
  "not-investment-advice": "portfolioLab.diagNotAdvice",
};

/** Severity is named in text as well as styled, so colour is never the only signal. */
const SEVERITY_KEYS: Record<PortfolioDiagnosisSeverity, TranslationKey> = {
  info: "portfolioLab.severityInfo",
  caution: "portfolioLab.severityCaution",
  warning: "portfolioLab.severityWarning",
};

const CONCENTRATION_BAND_KEYS: Record<ConcentrationBand, TranslationKey> = {
  concentrated: "portfolioLab.bandConcentrated",
  focused: "portfolioLab.bandFocused",
  diversified: "portfolioLab.bandDiversified",
};

type LoadStatus = "pending" | "loading" | "ready" | "error" | "skipped" | "reused";

/**
 * A failure that is either already human-readable (produced by the service) or a catalog key.
 * Keys stay unresolved until render so switching language re-translates them instead of freezing
 * English text into state.
 */
interface FailureMessage {
  message?: string;
  messageKey?: TranslationKey;
}

interface SymbolLoad extends FailureMessage {
  symbol: string;
  status: LoadStatus;
  data?: MarketData;
}

/** One editable holding row. The id survives insertions and removals, unlike an index. */
interface HoldingSlot {
  id: number;
  symbol: string;
  weightPercent: string;
}

interface FormState {
  startDate: string;
  endDate: string;
  initialCapital: string;
  riskFreePercent: string;
}

/** One validated holding of a run request. */
interface HoldingInput {
  symbol: string;
  /** Decimal fraction, as the domain requires; the form collects percent. */
  weight: number;
  /** The percent string the reader typed, echoed back verbatim in the copy and the CSV. */
  weightPercent: string;
}

/** A validated, normalized run request. */
interface PortfolioInput {
  holdings: HoldingInput[];
  startDate: DateString;
  endDate: DateString;
  initialCapital: number;
  /** Decimal fraction, as the domain requires; the form collects percent. */
  annualRiskFreeRate: number;
  riskFreePercent: string;
}

/** Every load of one run, in the order the requests were issued. */
interface RunState {
  input: PortfolioInput;
  holdings: SymbolLoad[];
  benchmark: SymbolLoad;
}

interface FieldError {
  field: string;
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
}

/** Either a built portfolio or the reason one could not be built from loaded data. */
interface Assembled {
  view?: PortfolioLabViewModel;
  /** Set when the holdings loaded but the portfolio itself is not computable. */
  failure?: FieldError;
  /** Set when SPY loaded but could not be used; every non-beta figure survives. */
  benchmarkFailureKey?: TranslationKey;
  /** The benchmark series the domain accepted, kept for the optional chart overlay. */
  benchmarkData?: MarketData;
}

// --- Pure helpers -----------------------------------------------------------

/** The trailing `years`-long window ending today, in UTC so it never shifts with the viewer's zone. */
function trailingRange(now: Date, years: number): { startDate: DateString; endDate: DateString } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function isoDate(date: Date): DateString {
  return date.toISOString().slice(0, 10);
}

function holdingSymbolField(id: number): string {
  return `holding-symbol-${id}`;
}

function holdingWeightField(id: number): string {
  return `holding-weight-${id}`;
}

/** A typed percent, or undefined when the field is blank or not a finite number. */
function parsePercent(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** The running total of the typed weights. Unreadable fields count as nothing, never as zero-weight. */
function weightTotalPercent(slots: HoldingSlot[]): number {
  return slots.reduce((total, slot) => total + (parsePercent(slot.weightPercent) ?? 0), 0);
}

function weightsTotalOneHundred(total: number): boolean {
  return Math.abs(total - WEIGHT_TOTAL_PERCENT) <= WEIGHT_TOTAL_TOLERANCE_PERCENT;
}

/**
 * Equal weights that still total exactly 100%. Splitting 100 by three cannot be written as three
 * equal one-decimal numbers, so the remainder is handed to the rows that need it — 33.3, 33.4,
 * 33.3 — rather than leaving a total the run would refuse.
 */
function equalWeightPercents(count: number): string[] {
  const tenths = WEIGHT_TOTAL_PERCENT * 10;
  return Array.from({ length: count }, (_, index) => {
    const share = Math.round(((index + 1) * tenths) / count) - Math.round((index * tenths) / count);
    return (share / 10).toFixed(1);
  });
}

/** Rounds fractional weights to visible 0.1 percentage-point units while preserving exactly 100%. */
function allocationPercents(weights: number[]): string[] {
  const rawUnits = weights.map((weight) => weight * 1000);
  const units = rawUnits.map(Math.floor);
  let remaining = 1000 - units.reduce((total, value) => total + value, 0);
  const order = rawUnits
    .map((value, index) => ({ index, remainder: value - units[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < order.length && remaining > 0; index += 1, remaining -= 1) {
    units[order[index].index] += 1;
  }
  return units.map((value) => (value / 10).toFixed(1));
}

/**
 * Client-side gate on the form. It rejects only what is certainly wrong — a blank or unusable
 * ticker, a repeated ticker, a weight that is not a usable number, a total that is not 100%, a
 * malformed or out-of-range date, an inverted or too-short window, an unusable capital or rate —
 * so the service is never asked a question that cannot have an answer.
 */
function validateForm(
  slots: HoldingSlot[],
  form: FormState,
  today: DateString,
): { errors: FieldError[]; input?: PortfolioInput } {
  const errors: FieldError[] = [];
  const holdings: HoldingInput[] = [];
  const seen = new Set<string>();

  slots.forEach((slot, index) => {
    const symbol = normalizeSymbol(slot.symbol);
    const symbolFieldName = holdingSymbolField(slot.id);
    let symbolUsable = true;

    if (symbol === "") {
      errors.push({
        field: symbolFieldName,
        messageKey: "portfolioLab.validationEmptySymbol",
        params: { count: index + 1 },
      });
      symbolUsable = false;
    } else if (!isValidSymbol(symbol)) {
      errors.push({ field: symbolFieldName, messageKey: "validation.ticker" });
      symbolUsable = false;
    } else if (seen.has(symbol)) {
      errors.push({
        field: symbolFieldName,
        messageKey: "portfolioLab.validationDuplicate",
        params: { symbol },
      });
      symbolUsable = false;
    } else {
      seen.add(symbol);
    }

    const weightFieldName = holdingWeightField(slot.id);
    const percent = parsePercent(slot.weightPercent);
    if (percent === undefined) {
      errors.push({
        field: weightFieldName,
        messageKey: "portfolioLab.validationWeightNumber",
        params: { count: index + 1 },
      });
      return;
    }
    if (percent < 0) {
      errors.push({ field: weightFieldName, messageKey: "portfolioLab.validationWeightNegative" });
      return;
    }
    if (percent > WEIGHT_TOTAL_PERCENT) {
      errors.push({
        field: weightFieldName,
        messageKey: "portfolioLab.validationWeightAboveTotal",
        params: { max: WEIGHT_TOTAL_PERCENT },
      });
      return;
    }

    if (symbolUsable) {
      holdings.push({ symbol, weight: percent / 100, weightPercent: slot.weightPercent.trim() });
    }
  });

  // The total is checked on what the reader typed, so the message names the figure on screen.
  const total = weightTotalPercent(slots);
  if (!weightsTotalOneHundred(total)) {
    errors.push({
      field: "weights",
      messageKey: "portfolioLab.validationWeightTotal",
      params: { total: total.toFixed(1), target: WEIGHT_TOTAL_PERCENT },
    });
  }

  const { startDate, endDate } = form;
  if (!ISO_DATE_PATTERN.test(startDate) || startDate < EARLIEST_START_DATE) {
    errors.push({ field: "startDate", messageKey: "validation.startDate" });
  }
  if (!ISO_DATE_PATTERN.test(endDate)) {
    errors.push({ field: "endDate", messageKey: "validation.endDate" });
  } else if (endDate > today) {
    errors.push({ field: "endDate", messageKey: "portfolioLab.validationFutureEnd" });
  }

  const datesUsable = errors.every((error) => error.field !== "startDate" && error.field !== "endDate");
  if (datesUsable) {
    if (startDate > endDate) {
      errors.push({ field: "startDate", messageKey: "validation.startBeforeEnd" });
    } else if (daysBetween(startDate, endDate) < MIN_WINDOW_DAYS) {
      errors.push({
        field: "endDate",
        messageKey: "portfolioLab.validationRangeTooShort",
        params: { days: MIN_WINDOW_DAYS },
      });
    }
  }

  const capital = Number(form.initialCapital.trim());
  const capitalUsable =
    form.initialCapital.trim() !== "" &&
    Number.isFinite(capital) &&
    capital >= MIN_INITIAL_CAPITAL &&
    capital <= MAX_INITIAL_CAPITAL;
  if (!capitalUsable) {
    errors.push({
      field: "initialCapital",
      messageKey: "portfolioLab.validationCapital",
      params: { min: MIN_INITIAL_CAPITAL, max: MAX_INITIAL_CAPITAL },
    });
  }

  const percent = Number(form.riskFreePercent.trim());
  const percentUsable =
    form.riskFreePercent.trim() !== "" &&
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= RISK_FREE_PERCENT_LIMIT;
  if (!percentUsable) {
    errors.push({
      field: "riskFree",
      messageKey: "portfolioLab.validationRiskFree",
      params: { max: RISK_FREE_PERCENT_LIMIT },
    });
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    input: {
      holdings,
      startDate,
      endDate,
      initialCapital: capital,
      annualRiskFreeRate: percent / 100,
      riskFreePercent: form.riskFreePercent.trim(),
    },
  };
}

/** Loads one symbol's window, returning either data or an already-readable message. */
async function loadSymbol(
  symbol: string,
  startDate: DateString,
  endDate: DateString,
): Promise<FailureMessage & { data?: MarketData }> {
  try {
    return {
      data: await loadMarketData({
        ticker: symbol,
        from: startDate,
        to: endDate,
        requiredStart: startDate,
        mode: "analysis",
      }),
    };
  } catch (error) {
    if (error instanceof MarketDataError) return { message: error.message };
    return { messageKey: "portfolioLab.errorUnknown" };
  }
}

/** Applies one load outcome to the row that requested it, keeping its symbol and identity. */
function applyOutcome(load: SymbolLoad, outcome: FailureMessage & { data?: MarketData }): SymbolLoad {
  if (outcome.data) return { symbol: load.symbol, status: "ready", data: outcome.data };
  return {
    symbol: load.symbol,
    status: "error",
    message: outcome.message,
    messageKey: outcome.messageKey ?? (outcome.message ? undefined : "portfolioLab.errorUnknown"),
  };
}

function replaceHolding(run: RunState, symbol: string, next: (load: SymbolLoad) => SymbolLoad): RunState {
  return {
    ...run,
    holdings: run.holdings.map((load) => (load.symbol === symbol ? next(load) : load)),
  };
}

/**
 * Builds the portfolio from whatever loaded, or explains why it cannot be built.
 *
 * The shared calendar is checked before the domain is called so a non-overlapping window produces
 * a translated explanation with the real count instead of an untranslated thrown message. A
 * benchmark that cannot be used is dropped and reported on its own, because beta and the overlay
 * are the only things that depend on it.
 */
function assemble(run: RunState): Assembled | undefined {
  const loaded = run.holdings.map((load) => load.data);
  if (loaded.some((data) => data === undefined)) return undefined;
  const marketData = loaded as MarketData[];

  const shared = commonTradingDates(marketData.map((data) => data.prices));
  if (shared.length < MIN_COMMON_CLOSES) {
    return {
      failure: {
        field: "overlap",
        messageKey: "portfolioLab.errorNoOverlap",
        params: { count: shared.length, min: MIN_COMMON_CLOSES },
      },
    };
  }

  // SPY can also be a holding; reuse that series rather than asking for it twice.
  const benchmark =
    run.benchmark.data ?? marketData.find((data) => normalizeSymbol(data.ticker) === BENCHMARK_SYMBOL);
  const request = {
    holdings: marketData.map((data, index) => ({ marketData: data, weight: run.input.holdings[index].weight })),
    initialCapital: run.input.initialCapital,
    annualRiskFreeRate: run.input.annualRiskFreeRate,
  };

  try {
    return { view: buildPortfolioLab({ ...request, benchmark }), benchmarkData: benchmark };
  } catch {
    if (!benchmark) return { failure: { field: "series", messageKey: "portfolioLab.errorSeries" } };
  }

  try {
    return {
      view: buildPortfolioLab(request),
      benchmarkFailureKey: "portfolioLab.errorBenchmarkSeries",
    };
  } catch {
    return { failure: { field: "series", messageKey: "portfolioLab.errorSeries" } };
  }
}

// --- Workspace --------------------------------------------------------------

export function PortfolioLab() {
  const { locale, t } = useLanguage();
  const reduceMotion = useReducedMotion();

  const [slots, setSlots] = useState<HoldingSlot[]>(() =>
    EXAMPLE_HOLDINGS.map((entry, index) => ({ id: index + 1, ...entry })),
  );
  const [form, setForm] = useState<FormState>({
    startDate: "",
    endDate: "",
    initialCapital: DEFAULT_INITIAL_CAPITAL,
    riskFreePercent: DEFAULT_RISK_FREE_PERCENT,
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [run, setRun] = useState<RunState>();
  const [running, setRunning] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date>();
  const [chartTab, setChartTab] = useState<ChartTab>("value");
  // The Risk Context answers. They describe the reader, not the portfolio, so they are deliberately
  // held here and nowhere else: no storage, no query string, no request, and they are not part of
  // the run, so changing one never invalidates a result or re-measures anything.
  const [riskAnswers, setRiskAnswers] = useState<RiskContextAnswers>(DEFAULT_RISK_ANSWERS);

  // Supersedes an in-flight sequence: every await re-checks the token before writing state.
  const runIdRef = useRef(0);
  const nextSlotIdRef = useRef(EXAMPLE_HOLDINGS.length + 1);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Loads SPY, which happens only after every holding is on screen. Callers pass the token of
   * their own sequence so a superseded run cannot write a benchmark into a newer one.
   */
  const loadBenchmarkLeg = useCallback(async (input: PortfolioInput, runId: number) => {
    setRun((prev) => (prev ? { ...prev, benchmark: { ...prev.benchmark, status: "loading" } } : prev));
    const outcome = await loadSymbol(BENCHMARK_SYMBOL, input.startDate, input.endDate);
    if (runIdRef.current !== runId) return;
    setRun((prev) => (prev ? { ...prev, benchmark: applyOutcome(prev.benchmark, outcome) } : prev));
  }, []);

  const runPortfolio = useCallback(
    async (input: PortfolioInput) => {
      const runId = ++runIdRef.current;
      const symbols = input.holdings.map((holding) => holding.symbol);
      const benchmarkIsHolding = symbols.includes(BENCHMARK_SYMBOL);

      setRunning(true);
      setLoadedAt(undefined);
      setRun({
        input,
        holdings: symbols.map((symbol) => ({ symbol, status: "pending" })),
        benchmark: { symbol: BENCHMARK_SYMBOL, status: benchmarkIsHolding ? "reused" : "pending" },
      });

      // Strictly sequential: one request is in flight at a time, in row order.
      let allLoaded = true;
      for (const symbol of symbols) {
        if (runIdRef.current !== runId) return;
        setRun((prev) => (prev ? replaceHolding(prev, symbol, (load) => ({ ...load, status: "loading" })) : prev));
        const outcome = await loadSymbol(symbol, input.startDate, input.endDate);
        if (runIdRef.current !== runId) return;
        setRun((prev) => (prev ? replaceHolding(prev, symbol, (load) => applyOutcome(load, outcome)) : prev));
        if (!outcome.data) allLoaded = false;
      }

      // A blocked portfolio cannot use a benchmark, so SPY is not requested at all — and the queue
      // says so rather than leaving a step that looks like it is still coming.
      if (allLoaded && !benchmarkIsHolding) {
        await loadBenchmarkLeg(input, runId);
      } else if (!allLoaded && !benchmarkIsHolding) {
        setRun((prev) => (prev ? { ...prev, benchmark: { ...prev.benchmark, status: "skipped" } } : prev));
      }

      if (runIdRef.current !== runId) return;
      setRunning(false);
      setLoadedAt(new Date());
    },
    [loadBenchmarkLeg],
  );

  /** Retries one holding, then continues to SPY if that was the last one missing. */
  const retryHolding = useCallback(
    async (symbol: string) => {
      const current = run;
      if (!current) return;
      const runId = ++runIdRef.current;
      setRunning(true);

      setRun((prev) => (prev ? replaceHolding(prev, symbol, (load) => ({ ...load, status: "loading" })) : prev));
      const outcome = await loadSymbol(symbol, current.input.startDate, current.input.endDate);
      if (runIdRef.current !== runId) return;
      setRun((prev) => (prev ? replaceHolding(prev, symbol, (load) => applyOutcome(load, outcome)) : prev));

      const allLoaded =
        outcome.data !== undefined &&
        current.holdings.every((load) => load.symbol === symbol || load.data !== undefined);
      if (allLoaded && current.benchmark.status !== "reused" && !current.benchmark.data) {
        await loadBenchmarkLeg(current.input, runId);
      }

      if (runIdRef.current !== runId) return;
      setRunning(false);
      setLoadedAt(new Date());
    },
    [loadBenchmarkLeg, run],
  );

  /** Retries only SPY, keeping every non-beta figure already on screen. */
  const retryBenchmark = useCallback(async () => {
    const current = run;
    if (!current || current.benchmark.status === "reused") return;
    const runId = ++runIdRef.current;
    setRunning(true);
    await loadBenchmarkLeg(current.input, runId);
    if (runIdRef.current !== runId) return;
    setRunning(false);
    setLoadedAt(new Date());
  }, [loadBenchmarkLeg, run]);

  // The example window depends on today's date, so it is filled in after mount: the server and the
  // client render the same empty date inputs, and the first run starts once hydration is done.
  useEffect(() => {
    const timer = setTimeout(() => {
      const range = trailingRange(new Date(), EXAMPLE_YEARS);
      const example: FormState = {
        ...range,
        initialCapital: DEFAULT_INITIAL_CAPITAL,
        riskFreePercent: DEFAULT_RISK_FREE_PERCENT,
      };
      setForm(example);
      const exampleSlots = EXAMPLE_HOLDINGS.map((entry, index) => ({ id: index + 1, ...entry }));
      const { input } = validateForm(exampleSlots, example, range.endDate);
      if (input) void runPortfolio(input);
    }, 0);
    return () => clearTimeout(timer);
  }, [runPortfolio]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { errors: found, input } = validateForm(slots, form, isoDate(new Date()));
    setErrors(found);
    if (input) void runPortfolio(input);
  }

  /**
   * Drops the current run the moment a calculation-affecting input changes. Bumping the token
   * supersedes any sequence still in flight — every await re-checks it and returns without writing
   * — and clearing the run takes the load ledger, the results, and everything derived from them off
   * screen together. Nothing measured on the previous inputs survives the edit.
   */
  function invalidateCurrentRun() {
    runIdRef.current += 1;
    setRun(undefined);
    setRunning(false);
    setLoadedAt(undefined);
  }

  function updateSymbol(id: number, value: string) {
    // Uppercased as it is typed, so what the reader sees is exactly what is requested.
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, symbol: value.toUpperCase() } : slot)));
    setErrors([]);
    invalidateCurrentRun();
  }

  function updateWeight(id: number, value: string) {
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, weightPercent: value } : slot)));
    setErrors([]);
    invalidateCurrentRun();
  }

  function addSlot() {
    setSlots((prev) =>
      prev.length >= MAX_PORTFOLIO_HOLDINGS
        ? prev
        : [...prev, { id: nextSlotIdRef.current++, symbol: "", weightPercent: "" }],
    );
    setErrors([]);
    invalidateCurrentRun();
  }

  function removeSlot(id: number) {
    setSlots((prev) => (prev.length <= MIN_PORTFOLIO_HOLDINGS ? prev : prev.filter((slot) => slot.id !== id)));
    setErrors([]);
    invalidateCurrentRun();
  }

  /** Rewrites every weight so they are as equal as one decimal place allows and still total 100%. */
  function applyEqualWeights() {
    setSlots((prev) => {
      const shares = equalWeightPercents(prev.length);
      return prev.map((slot, index) => ({ ...slot, weightPercent: shares[index] }));
    });
    setErrors([]);
    invalidateCurrentRun();
  }

  /** Applies the transparent inverse-volatility rule to the measured shared-window returns. */
  function applyRiskAdjustedWeights() {
    if (!view) return;
    try {
      const allocation = inverseVolatilityWeights(
        view.holdings.map((holding) => ({ symbol: holding.symbol, returns: holding.dailyReturns })),
      );
      const percents = allocationPercents(allocation.weights.map((entry) => entry.weight));
      const bySymbol = new Map(allocation.weights.map((entry, index) => [entry.symbol, percents[index]]));
      setSlots((prev) => prev.map((slot) => ({ ...slot, weightPercent: bySymbol.get(normalizeSymbol(slot.symbol)) ?? slot.weightPercent })));
      setErrors([]);
      invalidateCurrentRun();
    } catch {
      setErrors([{ field: "weights", messageKey: "portfolioLab.riskAdjustedUnavailable" }]);
    }
  }

  /** Applies the correlation-aware, long-only historical global minimum-variance solution. */
  function applyMinimumVarianceWeights() {
    if (!view) return;
    try {
      const allocation = globalMinimumVarianceWeights(
        view.holdings.map((holding) => ({ symbol: holding.symbol, returns: holding.dailyReturns })),
      );
      const percents = allocationPercents(allocation.weights.map((entry) => entry.weight));
      const bySymbol = new Map(allocation.weights.map((entry, index) => [entry.symbol, percents[index]]));
      setSlots((prev) => prev.map((slot) => ({ ...slot, weightPercent: bySymbol.get(normalizeSymbol(slot.symbol)) ?? slot.weightPercent })));
      setErrors([]);
      invalidateCurrentRun();
    } catch {
      setErrors([{ field: "weights", messageKey: "portfolioLab.minimumVarianceUnavailable" }]);
    }
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors([]);
    invalidateCurrentRun();
  }

  function handleTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = CHART_TABS.length - 1;
    let next: number | undefined;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === undefined) return;
    event.preventDefault();
    setChartTab(CHART_TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  const errorFor = (field: string) => errors.find((error) => error.field === field);

  const total = weightTotalPercent(slots);
  const totalIsExact = weightsTotalOneHundred(total);

  const assembled = useMemo(() => (run ? assemble(run) : undefined), [run]);
  const view = assembled?.view;
  const rebalancingAnalysis = useMemo(() => {
    const currentView = assembled?.view;
    if (!currentView) return undefined;
    const holdings = currentView.holdings.map((holding) => ({
      symbol: holding.symbol,
      targetWeight: holding.targetWeight,
      returns: holding.dailyReturns,
    }));
    try {
      return {
        scenarios: (["none", "quarterly", "annual"] as const).map((frequency) =>
          simulatePeriodicRebalancing({
            holdings,
            initialDate: currentView.window.startDate,
            initialValue: currentView.allocatedCapital,
            frequency,
          }),
        ),
        unavailable: false as const,
      };
    } catch (error) {
      if (error instanceof AnalyticsError) return { unavailable: true as const };
      throw error;
    }
  }, [assembled]);
  const frontierAnalysis = useMemo(() => {
    const currentView = assembled?.view;
    if (!currentView) return undefined;
    if (currentView.holdings.length < 2) return { unavailable: true as const, needsTwo: true as const };
    try {
      return {
        frontier: computeEfficientFrontier(
          currentView.holdings.map((holding) => ({ symbol: holding.symbol, returns: holding.dailyReturns })),
        ),
        unavailable: false as const,
      };
    } catch (error) {
      if (error instanceof AnalyticsError) return { unavailable: true as const, needsTwo: false as const };
      throw error;
    }
  }, [assembled]);

  const failedHoldings = useMemo(
    () => run?.holdings.filter((load) => load.status === "error") ?? [],
    [run],
  );

  /** SPY failed to load, or loaded but could not be used. Beta and the overlay are the casualties. */
  const benchmarkFailure = useMemo<FailureMessage | undefined>(() => {
    if (assembled?.benchmarkFailureKey) return { messageKey: assembled.benchmarkFailureKey };
    if (run?.benchmark.status === "error") {
      return { message: run.benchmark.message, messageKey: run.benchmark.messageKey };
    }
    return undefined;
  }, [assembled, run]);

  /**
   * SPY rebased so it starts at the same dollar figure the portfolio started at. It is drawn only
   * when SPY traded on every shared session: rebasing a partial series would start the benchmark
   * line on a different date than the portfolio line and quietly compare two windows.
   */
  const benchmarkSeries = (() => {
    const data = assembled?.benchmarkData;
    if (!view || !data || !view.benchmark?.coversCommonWindow) return undefined;
    const windowDates = new Set(view.window.dates);
    const bars = data.prices.filter((bar) => windowDates.has(bar.date));
    if (bars.length < 2) return undefined;
    // The domain measures the cumulative return; the only arithmetic here is restating it in the
    // portfolio's own starting dollars so the two lines share one axis.
    return cumulativePriceReturns(toReturnBasisBars(bars, view.returnBasis)).map((point) => ({
      date: point.date,
      cumulative: point.value,
      value: view.allocatedCapital * (1 + point.value),
    }));
  })();

  const chartData = (() => {
    if (!view) return [];
    const rows = new Map<DateString, Record<string, number | string>>(
      view.performanceValueSeries.map((point) => [point.date, { date: point.date, portfolioValue: point.value }]),
    );
    for (const point of view.cumulativeReturns) {
      const row = rows.get(point.date);
      if (row) row.portfolioReturn = point.value * 100;
    }
    for (const point of benchmarkSeries ?? []) {
      const row = rows.get(point.date);
      if (row) {
        row.benchmarkValue = point.value;
        row.benchmarkReturn = point.cumulative * 100;
      }
    }
    return [...rows.values()];
  })();

  const loadingSymbol = run?.holdings.find((load) => load.status === "loading")?.symbol;
  const benchmarkLoading = run?.benchmark.status === "loading";

  const statusText = running
    ? loadingSymbol
      ? t("portfolioLab.statusLoadingSymbol", { symbol: loadingSymbol })
      : benchmarkLoading
        ? t("portfolioLab.statusLoadingBenchmark", { symbol: BENCHMARK_SYMBOL })
        : t("portfolioLab.statusWorking")
    : loadedAt
      ? t("portfolioLab.statusReady", { time: formatTimestamp(loadedAt, locale) })
      : t("portfolioLab.statusIdle");

  function handleDownload() {
    if (!view || !run) return;
    downloadCsv(buildCsv(view, run.input, t), csvFilename(view));
  }

  return (
    <AppShell
      status={
        <p className={styles.statusLine} role="status" aria-live="polite">
          <i className={running ? styles.statusDotLoading : styles.statusDot} aria-hidden="true" />
          {statusText}
        </p>
      }
      actions={
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => {
            if (run) void runPortfolio(run.input);
          }}
          disabled={running || !run}
        >
          <RefreshCw size={13} aria-hidden="true" className={running ? styles.spin : undefined} />
          <span>{running ? t("portfolioLab.rerunning") : t("portfolioLab.rerun")}</span>
        </button>
      }
    >
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1>{t("portfolioLab.title")}</h1>
          <p className={styles.subtitle}>{t("portfolioLab.subtitle")}</p>
        </div>

        <form className={styles.controls} onSubmit={handleSubmit} aria-label={t("portfolioLab.controlsTitle")}>
          <fieldset className={styles.holdingFields}>
            <legend>{t("portfolioLab.holdings")}</legend>

            {slots.map((slot, index) => {
              const symbolError = errorFor(holdingSymbolField(slot.id));
              const weightError = errorFor(holdingWeightField(slot.id));
              const symbolId = `portfolio-symbol-${slot.id}`;
              const weightId = `portfolio-weight-${slot.id}`;
              return (
                <div key={slot.id} className={styles.holdingRow}>
                  <div className={styles.holdingField}>
                    <label htmlFor={symbolId}>{t("portfolioLab.symbolLabel", { count: index + 1 })}</label>
                    <input
                      id={symbolId}
                      className={`${styles.control} ${styles.mono}`}
                      value={slot.symbol}
                      onChange={(event) => updateSymbol(slot.id, event.target.value)}
                      placeholder={t("portfolioLab.symbolPlaceholderLive")}
                      maxLength={12}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={symbolError ? true : undefined}
                      aria-describedby={symbolError ? `${symbolId}-error` : undefined}
                    />
                    {symbolError ? (
                      <p className={styles.fieldError} id={`${symbolId}-error`}>
                        {t(symbolError.messageKey, symbolError.params)}
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.holdingField}>
                    <label htmlFor={weightId}>{t("portfolioLab.weightLabel", { count: index + 1 })}</label>
                    <input
                      id={weightId}
                      type="number"
                      inputMode="decimal"
                      step={WEIGHT_STEP_PERCENT}
                      min={0}
                      max={WEIGHT_TOTAL_PERCENT}
                      className={`${styles.control} ${styles.mono}`}
                      value={slot.weightPercent}
                      onChange={(event) => updateWeight(slot.id, event.target.value)}
                      aria-invalid={weightError ? true : undefined}
                      aria-describedby={weightError ? `${weightId}-error` : undefined}
                    />
                    {weightError ? (
                      <p className={styles.fieldError} id={`${weightId}-error`}>
                        {t(weightError.messageKey, weightError.params)}
                      </p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeSlot(slot.id)}
                    disabled={slots.length <= MIN_PORTFOLIO_HOLDINGS}
                    aria-label={t("portfolioLab.removeHolding", { count: index + 1 })}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}

            <div className={styles.holdingActions}>
              <button
                type="button"
                className={styles.addButton}
                onClick={addSlot}
                disabled={slots.length >= MAX_PORTFOLIO_HOLDINGS}
                aria-describedby="portfolio-slot-hint"
              >
                <Plus size={13} aria-hidden="true" />
                <span>{t("portfolioLab.addHolding")}</span>
              </button>
              <button type="button" className={styles.equalButton} onClick={applyEqualWeights}>
                <Scale size={13} aria-hidden="true" />
                <span>{t("portfolioLab.equalWeight")}</span>
              </button>
              <button type="button" className={styles.equalButton} onClick={applyRiskAdjustedWeights} disabled={!view}>
                <Activity size={13} aria-hidden="true" />
                <span>{t("portfolioLab.riskAdjustedWeight")}</span>
              </button>
              <button type="button" className={styles.equalButton} onClick={applyMinimumVarianceWeights} disabled={!view}>
                <Activity size={13} aria-hidden="true" />
                <span>{t("portfolioLab.minimumVarianceWeight")}</span>
              </button>
            </div>

            <p className={styles.controlHint} id="portfolio-slot-hint">
              {slots.length >= MAX_PORTFOLIO_HOLDINGS
                ? t("portfolioLab.slotLimitReached", { max: MAX_PORTFOLIO_HOLDINGS })
                : t("portfolioLab.slotLimit", { min: MIN_PORTFOLIO_HOLDINGS, max: MAX_PORTFOLIO_HOLDINGS })}
            </p>

            {/* The running total is always on screen, and it is the gate: nothing runs unless it
                reads exactly 100%. Nothing is ever rescaled on the reader's behalf. */}
            <div
              className={totalIsExact ? styles.weightTotalExact : styles.weightTotalOff}
              role="status"
              aria-live="polite"
            >
              <span>{t("portfolioLab.weightTotalLabel")}</span>
              <b className={styles.mono}>{formatPercentPointsPlain(total, locale)}</b>
              <em>
                {totalIsExact
                  ? t("portfolioLab.weightTotalExact")
                  : total > WEIGHT_TOTAL_PERCENT
                    ? t("portfolioLab.weightTotalOver", {
                        amount: formatPercentPointsPlain(total - WEIGHT_TOTAL_PERCENT, locale),
                      })
                    : t("portfolioLab.weightTotalUnder", {
                        amount: formatPercentPointsPlain(WEIGHT_TOTAL_PERCENT - total, locale),
                      })}
              </em>
            </div>
            {errorFor("weights") ? (
              <p className={styles.fieldError} id="portfolio-weights-error">
                {t(errorFor("weights")!.messageKey, errorFor("weights")!.params)}
              </p>
            ) : null}
          </fieldset>

          <div className={styles.windowFields}>
            <div className={styles.controlField}>
              <label htmlFor="portfolio-capital">{t("portfolioLab.capitalLabel")}</label>
              <input
                id="portfolio-capital"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={MIN_INITIAL_CAPITAL}
                max={MAX_INITIAL_CAPITAL}
                className={`${styles.control} ${styles.mono}`}
                value={form.initialCapital}
                onChange={(event) => updateField("initialCapital", event.target.value)}
                aria-invalid={errorFor("initialCapital") ? true : undefined}
                aria-describedby={
                  errorFor("initialCapital")
                    ? "portfolio-capital-error portfolio-capital-hint"
                    : "portfolio-capital-hint"
                }
              />
              {errorFor("initialCapital") ? (
                <p className={styles.fieldError} id="portfolio-capital-error">
                  {t(errorFor("initialCapital")!.messageKey, errorFor("initialCapital")!.params)}
                </p>
              ) : null}
              <p className={styles.controlHint} id="portfolio-capital-hint">
                {t("portfolioLab.capitalHint")}
              </p>
            </div>

            <div className={styles.controlField}>
              <label htmlFor="portfolio-start">{t("date.start")}</label>
              <input
                id="portfolio-start"
                type="date"
                className={styles.control}
                value={form.startDate}
                min={EARLIEST_START_DATE}
                onChange={(event) => updateField("startDate", event.target.value)}
                aria-invalid={errorFor("startDate") ? true : undefined}
                aria-describedby={errorFor("startDate") ? "portfolio-start-error" : undefined}
              />
              {errorFor("startDate") ? (
                <p className={styles.fieldError} id="portfolio-start-error">
                  {t(errorFor("startDate")!.messageKey, errorFor("startDate")!.params)}
                </p>
              ) : null}
            </div>

            <div className={styles.controlField}>
              <label htmlFor="portfolio-end">{t("date.end")}</label>
              <input
                id="portfolio-end"
                type="date"
                className={styles.control}
                value={form.endDate}
                min={EARLIEST_START_DATE}
                onChange={(event) => updateField("endDate", event.target.value)}
                aria-invalid={errorFor("endDate") ? true : undefined}
                aria-describedby={errorFor("endDate") ? "portfolio-end-error" : undefined}
              />
              {errorFor("endDate") ? (
                <p className={styles.fieldError} id="portfolio-end-error">
                  {t(errorFor("endDate")!.messageKey, errorFor("endDate")!.params)}
                </p>
              ) : null}
            </div>

            <div className={styles.controlField}>
              <label htmlFor="portfolio-risk-free">{t("portfolioLab.riskFreeLabel")}</label>
              <input
                id="portfolio-risk-free"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                max={RISK_FREE_PERCENT_LIMIT}
                className={`${styles.control} ${styles.mono}`}
                value={form.riskFreePercent}
                onChange={(event) => updateField("riskFreePercent", event.target.value)}
                aria-invalid={errorFor("riskFree") ? true : undefined}
                aria-describedby={
                  errorFor("riskFree")
                    ? "portfolio-risk-free-error portfolio-risk-free-hint"
                    : "portfolio-risk-free-hint"
                }
              />
              {errorFor("riskFree") ? (
                <p className={styles.fieldError} id="portfolio-risk-free-error">
                  {t(errorFor("riskFree")!.messageKey, errorFor("riskFree")!.params)}
                </p>
              ) : null}
              <p className={styles.controlHint} id="portfolio-risk-free-hint">
                {t("portfolioLab.riskFreeHint")}
              </p>
            </div>

            <button type="submit" className={styles.runButton} disabled={running}>
              <Play size={13} aria-hidden="true" />
              <span>{running ? t("portfolioLab.running") : t("portfolioLab.run")}</span>
            </button>
          </div>
        </form>

        {errors.length > 0 ? (
          <p className={styles.formAlert} role="alert">
            {errorFor("weights")
              ? t("portfolioLab.validationFixWeights", { total: formatPercentPointsPlain(total, locale) })
              : t("portfolioLab.validationFix")}
          </p>
        ) : null}

        {run ? (
          <LoadQueue run={run} running={running} onRetryHolding={(symbol) => void retryHolding(symbol)} t={t} />
        ) : null}

        {failedHoldings.length > 0 ? (
          <section className={styles.errorPanel} aria-labelledby="portfolio-blocked-title">
            <h2 id="portfolio-blocked-title">
              <TriangleAlert size={14} aria-hidden="true" /> {t("portfolioLab.blockedTitle")}
            </h2>
            <p>
              {t("portfolioLab.blockedBody", {
                symbols: joinSymbols(
                  failedHoldings.map((load) => load.symbol),
                  locale,
                ),
              })}
            </p>
            <p>{t("portfolioLab.blockedRetained")}</p>
            <ul>
              {failedHoldings.map((load) => (
                <li key={load.symbol}>
                  <b className={styles.mono}>{load.symbol}</b>
                  <span>{failureText(load, t)}</span>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => void retryHolding(load.symbol)}
                    disabled={running}
                  >
                    {t("portfolioLab.retrySymbol", { symbol: load.symbol })}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => {
                if (run) void runPortfolio(run.input);
              }}
              disabled={running}
            >
              {t("portfolioLab.retryAll")}
            </button>
          </section>
        ) : null}

        {assembled?.failure ? (
          <section className={styles.errorPanel} aria-labelledby="portfolio-error-title">
            <h2 id="portfolio-error-title">
              <TriangleAlert size={14} aria-hidden="true" /> {t("portfolioLab.errorTitle")}
            </h2>
            <p>{t(assembled.failure.messageKey, assembled.failure.params)}</p>
            {run ? <OwnHistoryList holdings={run.holdings} locale={locale} t={t} /> : null}
          </section>
        ) : null}

        {view && run ? (
          <>
            <section className={styles.basis} aria-labelledby="portfolio-basis-title">
              <h2 id="portfolio-basis-title">
                <Info size={13} aria-hidden="true" /> {t("portfolioLab.basisTitle")}
              </h2>
              <ul>
                <li>{t("portfolioLab.basisBuyAndHold", { date: formatDate(view.window.startDate, locale) })}</li>
                <li>{t("portfolioLab.basisFixedShares")}</li>
                <li>{t("portfolioLab.basisNoRebalancing")}</li>
                <li>{t("portfolioLab.basisSplitAdjusted")}</li>
                <li>{t(view.returnBasis === "total" ? "portfolioLab.basisTotalReturn" : "portfolioLab.basisDividends")}</li>
                <li>{t("portfolioLab.basisRiskFree", { rate: `${run.input.riskFreePercent}%` })}</li>
                <li>
                  {t("portfolioLab.basisCalendar", { count: formatCount(view.window.sessions, locale) })}
                </li>
                <li>{t("portfolioLab.basisObservations", { count: formatCount(view.riskSample.observations, locale) })}</li>
                <li>{t("portfolioLab.basisBeta", { symbol: BENCHMARK_SYMBOL })}</li>
                <li>{t("portfolioLab.basisSector")}</li>
                <li>{t("portfolioLab.basisNoAdvice")}</li>
              </ul>
            </section>

            <WindowPanel view={view} locale={locale} t={t} />

            {benchmarkFailure ? (
              <section className={styles.errorPanel} aria-labelledby="portfolio-benchmark-error">
                <h2 id="portfolio-benchmark-error">
                  <TriangleAlert size={14} aria-hidden="true" /> {t("portfolioLab.benchmarkUnavailableTitle")}
                </h2>
                <p>{t("portfolioLab.benchmarkUnavailableBody", { symbol: BENCHMARK_SYMBOL })}</p>
                <p className={styles.benchmarkReason}>{failureText(benchmarkFailure, t)}</p>
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={() => void retryBenchmark()}
                  disabled={running}
                >
                  {t("portfolioLab.retrySymbol", { symbol: BENCHMARK_SYMBOL })}
                </button>
              </section>
            ) : null}

            <HeadlineMetrics view={view} input={run.input} locale={locale} t={t} />
            {rebalancingAnalysis && !rebalancingAnalysis.unavailable ? (
              <RebalancingPanel scenarios={rebalancingAnalysis.scenarios} basis={view.returnBasis} locale={locale} t={t} />
            ) : rebalancingAnalysis?.unavailable ? (
              <AdvancedAnalysisUnavailable title={t("portfolioLab.rebalanceTitle")} body={t("portfolioLab.rebalanceUnavailable")} />
            ) : null}
            {frontierAnalysis && !frontierAnalysis.unavailable ? (
              <EfficientFrontierPanel frontier={frontierAnalysis.frontier} locale={locale} t={t} />
            ) : frontierAnalysis?.unavailable ? (
              <AdvancedAnalysisUnavailable
                title={t("portfolioLab.frontierTitle")}
                body={t(frontierAnalysis.needsTwo ? "portfolioLab.frontierNeedsTwo" : "portfolioLab.frontierUnavailable")}
              />
            ) : null}

            <div className={styles.grid}>
              <div className={styles.mainColumn}>
                <section className={styles.panel} aria-labelledby="portfolio-chart-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="portfolio-chart-title">{t("portfolioLab.chartTitle")}</h2>
                      <p className={styles.panelSub}>
                        {t("portfolioLab.chartWindow", {
                          from: formatDate(view.window.startDate, locale),
                          to: formatDate(view.window.endDate, locale),
                          count: formatCount(view.window.sessions, locale),
                        })}
                      </p>
                    </div>
                  </header>

                  <div className={styles.tabs} role="tablist" aria-label={t("portfolioLab.chartTabsLabel")}>
                    {CHART_TABS.map((tab, index) => {
                      const selected = tab.id === chartTab;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`portfolio-tab-${tab.id}`}
                          aria-selected={selected}
                          aria-controls={`portfolio-panel-${tab.id}`}
                          tabIndex={selected ? 0 : -1}
                          ref={(node) => {
                            tabRefs.current[index] = node;
                          }}
                          className={selected ? styles.tabActive : styles.tab}
                          onClick={() => setChartTab(tab.id)}
                          onKeyDown={(event) => handleTabKeys(event, index)}
                        >
                          {t(tab.labelKey)}
                        </button>
                      );
                    })}
                  </div>

                  <div className={styles.legend}>
                    <span className={styles.legendItem}>
                      <i style={{ background: PORTFOLIO_COLOR }} aria-hidden="true" />
                      <b>{t("portfolioLab.legendPortfolio")}</b>
                      <em>
                        {t("portfolioLab.legendPortfolioDetail", {
                          count: formatCount(view.holdings.length, locale),
                        })}
                      </em>
                    </span>
                    {benchmarkSeries ? (
                      <span className={styles.legendItem}>
                        <i style={{ background: BENCHMARK_COLOR }} aria-hidden="true" />
                        <b className={styles.mono}>{BENCHMARK_SYMBOL}</b>
                        <em>
                          {t("portfolioLab.legendBenchmarkDetail", {
                            amount: formatMoney(view.allocatedCapital, locale),
                          })}
                        </em>
                      </span>
                    ) : null}
                  </div>

                  <div
                    role="tabpanel"
                    id={`portfolio-panel-${chartTab}`}
                    aria-labelledby={`portfolio-tab-${chartTab}`}
                    tabIndex={0}
                    className={styles.tabPanel}
                  >
                    <PortfolioChart
                      data={chartData}
                      tab={chartTab}
                      withBenchmark={benchmarkSeries !== undefined}
                      locale={locale}
                      ariaLabel={t(
                        chartTab === "value" ? "portfolioLab.chartValueAria" : "portfolioLab.chartCumulativeAria",
                        {
                          from: formatDate(view.window.startDate, locale),
                          to: formatDate(view.window.endDate, locale),
                        },
                      )}
                      emptyLabel={t("portfolioLab.chartEmpty")}
                      portfolioLabel={t("portfolioLab.legendPortfolio")}
                      animate={!reduceMotion}
                    />
                    <p className={styles.caption}>
                      {t(
                        chartTab === "value"
                          ? "portfolioLab.chartValueCaption"
                          : "portfolioLab.chartCumulativeCaption",
                        {
                          date: formatDate(view.window.startDate, locale),
                          amount: formatMoney(view.allocatedCapital, locale),
                        },
                      )}
                    </p>
                    <p className={styles.caption}>
                      {benchmarkSeries
                        ? t("portfolioLab.chartBenchmarkPresent", {
                            symbol: BENCHMARK_SYMBOL,
                            amount: formatMoney(view.allocatedCapital, locale),
                          })
                        : view.benchmark
                          ? t("portfolioLab.chartBenchmarkPartial", {
                              symbol: BENCHMARK_SYMBOL,
                              count: formatCount(view.benchmark.overlappingSessions, locale),
                              total: formatCount(view.window.sessions, locale),
                            })
                          : t("portfolioLab.chartBenchmarkMissing", { symbol: BENCHMARK_SYMBOL })}
                    </p>
                    <p className={styles.caption}>{t("portfolioLab.chartTextEquivalent")}</p>
                  </div>
                </section>

                <section className={styles.panel} aria-labelledby="portfolio-attribution-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="portfolio-attribution-title">{t("portfolioLab.attributionTitle")}</h2>
                      <p className={styles.panelSub}>{t("portfolioLab.attributionSub")}</p>
                    </div>
                    <button type="button" className={styles.downloadButton} onClick={handleDownload}>
                      <Download size={13} aria-hidden="true" />
                      <span>{t("portfolioLab.download")}</span>
                    </button>
                  </header>

                  <AttributionTable view={view} locale={locale} t={t} />

                  <p className={styles.footnote}>{t("portfolioLab.attributionDriftNote")}</p>
                  <p className={styles.footnote}>{t("portfolioLab.dashMeaning")}</p>
                  <p className={styles.footnote}>{t("portfolioLab.csvNote")}</p>
                </section>

                <section className={styles.panel} aria-labelledby="portfolio-correlation-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="portfolio-correlation-title">{t("portfolioLab.correlationTitle")}</h2>
                      <p className={styles.panelSub}>{t("portfolioLab.correlationSub")}</p>
                    </div>
                  </header>
                  <CorrelationTable view={view} locale={locale} t={t} />
                  <p className={styles.footnote}>{t("portfolioLab.matrixDiagonalNote")}</p>
                </section>

                <ExecutionSummary view={view} locale={locale} t={t} />
              </div>

              <div className={styles.rail}>
                <ConcentrationPanel view={view} locale={locale} t={t} />
                <DiagnosisPanel view={view} locale={locale} t={t} />
                <RiskContextPanel
                  view={view}
                  answers={riskAnswers}
                  onAnswersChange={setRiskAnswers}
                  locale={locale}
                  t={t}
                />

                <section className={styles.panel} aria-labelledby="portfolio-explain-title">
                  <header className={styles.panelHead}>
                    <h2 id="portfolio-explain-title">{t("portfolioLab.explainLiveTitle")}</h2>
                  </header>
                  <div className={styles.means}>
                    <p>{t("portfolioLab.explainBuyAndHold")}</p>
                    <p>{t("portfolioLab.explainDrift")}</p>
                    <p>{t("portfolioLab.explainContribution")}</p>
                    <p>{t("portfolioLab.explainVolatilityLive")}</p>
                    <p>{t("portfolioLab.explainSharpeLive")}</p>
                    <p>{t("portfolioLab.explainSortinoLive")}</p>
                    <p>{t("portfolioLab.explainVarLive")}</p>
                    <p>{t("portfolioLab.explainDrawdownLive")}</p>
                    <p>{t("portfolioLab.explainBetaLive", { symbol: BENCHMARK_SYMBOL })}</p>
                    <p>{t("portfolioLab.explainAlphaLive", { symbol: BENCHMARK_SYMBOL })}</p>
                    <p>{t("portfolioLab.explainHhiLive")}</p>
                  </div>

                  <h3 className={styles.subhead}>{t("portfolioLab.limitationsTitle")}</h3>
                  <ul className={styles.limits}>
                    <li>{t("portfolioLab.limitDividends")}</li>
                    <li>{t("portfolioLab.limitNoRebalancing")}</li>
                    <li>{t("portfolioLab.limitNoCosts")}</li>
                    <li>{t("portfolioLab.limitWindow")}</li>
                    <li>{t("portfolioLab.limitClose")}</li>
                    <li>{t("portfolioLab.limitSector")}</li>
                    <li>{t("portfolioLab.limitNotAdvice")}</li>
                  </ul>

                  <Link className={styles.methodLink} href="/methodology">
                    {t("portfolioLab.learnMore")}
                  </Link>
                </section>
              </div>
            </div>
          </>
        ) : running || failedHoldings.length > 0 || assembled?.failure ? null : (
          <p className={styles.emptyState}>{t("portfolioLab.awaitingRun")}</p>
        )}

        <ShellDisclaimer />
      </div>
    </AppShell>
  );
}

// --- Progress ---------------------------------------------------------------

/**
 * The load ledger: every request of the current run, in the order it was issued, with its own
 * status and its own failure text. It stays on screen after the run so a reader whose portfolio
 * was blocked can see which holdings did load and which one to fix.
 */
function LoadQueue({
  run,
  running,
  onRetryHolding,
  t,
}: {
  run: RunState;
  running: boolean;
  onRetryHolding: (symbol: string) => void;
  t: Translate;
}) {
  return (
    <section className={styles.progress} aria-label={t("portfolioLab.progressTitle")}>
      <ol aria-live="polite">
        {run.holdings.map((load) => (
          <li key={load.symbol} className={stepClass(load.status)}>
            <b className={styles.mono}>{load.symbol}</b>
            <span>{statusLabel(load, t)}</span>
            {load.status === "error" ? (
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => onRetryHolding(load.symbol)}
                disabled={running}
              >
                {t("portfolioLab.retrySymbol", { symbol: load.symbol })}
              </button>
            ) : null}
          </li>
        ))}
        <li className={stepClass(run.benchmark.status)}>
          <b className={styles.mono}>{run.benchmark.symbol}</b>
          <span>{statusLabel(run.benchmark, t, true)}</span>
        </li>
      </ol>
      <p>{t("portfolioLab.progressNote", { symbol: BENCHMARK_SYMBOL })}</p>
    </section>
  );
}

function stepClass(status: LoadStatus): string | undefined {
  if (status === "loading") return styles.stepActive;
  if (status === "ready" || status === "reused") return styles.stepDone;
  if (status === "error") return styles.stepFailed;
  if (status === "skipped") return styles.stepSkipped;
  return styles.stepPending;
}

function statusLabel(load: SymbolLoad, t: Translate, isBenchmark = false): string {
  switch (load.status) {
    case "pending":
      return isBenchmark ? t("portfolioLab.stepBenchmarkQueued") : t("portfolioLab.stepQueued");
    case "loading":
      return t("portfolioLab.stepLoading");
    case "ready":
      return isBenchmark ? t("portfolioLab.stepBenchmarkReady") : t("portfolioLab.stepReady");
    case "reused":
      return t("portfolioLab.stepBenchmarkReused", { symbol: load.symbol });
    case "skipped":
      return t("portfolioLab.stepBenchmarkSkipped");
    case "error":
      return failureText(load, t);
  }
}

function failureText(failure: FailureMessage, t: Translate): string {
  if (failure.messageKey) return t(failure.messageKey);
  return failure.message ?? t("portfolioLab.errorUnknown");
}

/** The history each holding actually returned, so a non-overlapping window can be diagnosed. */
function OwnHistoryList({
  holdings,
  locale,
  t,
}: {
  holdings: SymbolLoad[];
  locale: string;
  t: Translate;
}) {
  const loaded = holdings.filter((load) => load.data && load.data.prices.length > 0);
  if (loaded.length === 0) return null;

  return (
    <ul className={styles.historyList}>
      {loaded.map((load) => {
        const prices = load.data!.prices;
        return (
          <li key={load.symbol}>
            <b className={styles.mono}>{load.symbol}</b>
            <span>
              {t("portfolioLab.ownHistory", {
                from: formatDate(prices[0].date, locale),
                to: formatDate(prices[prices.length - 1].date, locale),
                count: formatCount(prices.length, locale),
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// --- Shared window ----------------------------------------------------------

/**
 * The calendar every figure on the page was measured on, and why it is that long. A holding whose
 * own history starts on the shared start date is named as a limit, because a later listing is the
 * usual reason a five-year request produces a shorter window.
 */
function WindowPanel({ view, locale, t }: { view: PortfolioLabViewModel; locale: string; t: Translate }) {
  const { window } = view;

  return (
    <section className={styles.window} aria-labelledby="portfolio-window-title">
      <h2 id="portfolio-window-title">{t("portfolioLab.windowTitle")}</h2>
      <p className={styles.windowRange}>
        {t("portfolioLab.windowRange", {
          from: formatDate(window.startDate, locale),
          to: formatDate(window.endDate, locale),
        })}
      </p>
      <p className={styles.windowSessions}>
        {t("portfolioLab.windowSessions", {
          count: formatCount(window.sessions, locale),
          years: window.years.toFixed(1),
        })}
      </p>

      <ul className={styles.windowReasons}>
        <li>
          {t("portfolioLab.windowStartLimited", {
            date: formatDate(window.startDate, locale),
            symbols: joinSymbols(window.startLimitedBy, locale),
          })}
        </li>
        <li>
          {t("portfolioLab.windowEndLimited", {
            date: formatDate(window.endDate, locale),
            symbols: joinSymbols(window.endLimitedBy, locale),
          })}
        </li>
        <li>
          {window.shortenedFor.length > 0
            ? t("portfolioLab.windowShortened", { symbols: joinSymbols(window.shortenedFor, locale) })
            : t("portfolioLab.windowAligned", { count: formatCount(window.sessions, locale) })}
        </li>
      </ul>

      <ul className={styles.windowHoldings}>
        {view.holdings.map((holding) => {
          const dropped = holding.suppliedBars - holding.usedSessions;
          return (
            <li key={holding.symbol}>
              <b className={styles.mono}>{holding.symbol}</b>
              <span>
                {t("portfolioLab.windowHolding", {
                  from: formatDate(holding.suppliedFirstDate, locale),
                  to: formatDate(holding.suppliedLastDate, locale),
                  supplied: formatCount(holding.suppliedBars, locale),
                  used: formatCount(holding.usedSessions, locale),
                })}
              </span>
              {dropped > 0 ? (
                <em>{t("portfolioLab.windowHoldingDropped", { count: formatCount(dropped, locale) })}</em>
              ) : (
                <em>{t("portfolioLab.windowHoldingComplete")}</em>
              )}
            </li>
          );
        })}
      </ul>

      {view.benchmark ? (
        <p className={styles.windowBenchmark}>
          {view.benchmark.coversCommonWindow
            ? t("portfolioLab.windowBenchmarkFull", {
                symbol: view.benchmark.symbol,
                count: formatCount(view.benchmark.overlappingSessions, locale),
              })
            : t("portfolioLab.windowBenchmarkPartial", {
                symbol: view.benchmark.symbol,
                count: formatCount(view.benchmark.overlappingSessions, locale),
                total: formatCount(window.sessions, locale),
              })}
        </p>
      ) : (
        <p className={styles.windowBenchmark}>
          {t("portfolioLab.windowBenchmarkMissing", { symbol: BENCHMARK_SYMBOL })}
        </p>
      )}
    </section>
  );
}

// --- Headline ---------------------------------------------------------------

/**
 * The decision-relevant figures that describe the whole portfolio. Every one is read straight from the view
 * model; a figure the window cannot support renders as an em dash with the reason beside it.
 */
function HeadlineMetrics({
  view,
  input,
  locale,
  t,
}: {
  view: PortfolioLabViewModel;
  input: PortfolioInput;
  locale: string;
  t: Translate;
}) {
  const drawdown = view.maxDrawdown;

  return (
    <section className={styles.headline} aria-labelledby="portfolio-headline-title">
      <h2 id="portfolio-headline-title" className={styles.headlineTitle}>
        {t("portfolioLab.headlineTitle")}
      </h2>
      <p className={styles.headlineSub}>
        {t("portfolioLab.headlineSub", {
          capital: formatMoney(view.allocatedCapital, locale),
          from: formatDate(view.window.startDate, locale),
          to: formatDate(view.window.endDate, locale),
        })}
      </p>

      <dl className={styles.metricCards}>
        <MetricCard
          label={t("portfolioLab.metricFinalValue")}
          value={formatMoney(view.performanceFinalValue, locale)}
          detail={t("portfolioLab.metricFinalValueDetail", {
            gain: formatSignedMoney(view.performanceGain, locale),
            basis: t(view.returnBasis === "total" ? "portfolioLab.basisNameTotal" : "portfolioLab.basisNamePrice"),
          })}
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricTotalReturn")}
          value={formatSignedRate(view.totalPriceReturn, locale)}
          tone={view.totalPriceReturn < 0 ? "negative" : "positive"}
          detail={t("portfolioLab.metricTotalReturnDetail")}
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricVendorTotalReturn")}
          value={view.totalReturn === undefined ? undefined : formatSignedRate(view.totalReturn, locale)}
          tone={view.totalReturn === undefined ? undefined : view.totalReturn < 0 ? "negative" : "positive"}
          detail={
            view.totalReturn === undefined
              ? t("portfolioLab.metricVendorTotalReturnMissing")
              : t("portfolioLab.metricVendorTotalReturnDetail")
          }
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricCagr")}
          value={view.cagr === undefined ? undefined : formatSignedRate(view.cagr, locale)}
          tone={view.cagr === undefined ? undefined : view.cagr < 0 ? "negative" : "positive"}
          detail={
            view.cagr === undefined
              ? t("portfolioLab.metricCagrMissing")
              : t("portfolioLab.metricCagrDetail", { years: view.window.years.toFixed(1) })
          }
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricVolatility")}
          value={view.volatility === undefined ? undefined : formatRate(view.volatility, locale)}
          detail={
            view.volatility === undefined
              ? t("portfolioLab.metricVolatilityMissing")
              : t("portfolioLab.metricVolatilityDetail")
          }
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricSharpe")}
          value={view.sharpeRatio === undefined ? undefined : formatRatio(view.sharpeRatio, locale)}
          detail={
            view.sharpeRatio === undefined
              ? t("portfolioLab.metricSharpeMissing")
              : t("portfolioLab.metricSharpeDetail", { rate: `${input.riskFreePercent}%` })
          }
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricSortino")}
          value={view.sortinoRatio === undefined ? undefined : formatRatio(view.sortinoRatio, locale)}
          detail={view.sortinoRatio === undefined ? t("portfolioLab.metricSortinoMissing") : t("portfolioLab.metricSortinoDetail", { rate: `${input.riskFreePercent}%` })}
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricVar")}
          value={view.historicalValueAtRisk.value === undefined ? undefined : formatRate(view.historicalValueAtRisk.value, locale)}
          tone={view.historicalValueAtRisk.value !== undefined && view.historicalValueAtRisk.value > 0 ? "negative" : undefined}
          detail={view.historicalValueAtRisk.value === undefined ? t("portfolioLab.metricVarMissing") : t("portfolioLab.metricVarDetail", { confidence: formatRate(view.historicalValueAtRisk.confidence, locale), count: formatCount(view.historicalValueAtRisk.sample, locale) })}
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricMaxDrawdown")}
          value={formatRate(drawdown.drawdown, locale)}
          tone={drawdown.drawdown < 0 ? "negative" : undefined}
          detail={drawdownDetail(view, locale, t)}
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricBeta", { symbol: BENCHMARK_SYMBOL })}
          value={view.benchmark?.beta === undefined ? undefined : formatRatio(view.benchmark.beta, locale)}
          detail={
            view.benchmark === undefined
              ? t("portfolioLab.metricBetaMissing", { symbol: BENCHMARK_SYMBOL })
              : view.benchmark.beta === undefined
                ? t("portfolioLab.metricBetaNotComputable", { symbol: BENCHMARK_SYMBOL })
                : t("portfolioLab.metricBetaDetail", {
                    symbol: BENCHMARK_SYMBOL,
                    count: formatCount(view.benchmark.overlappingSessions, locale),
                  })
          }
          t={t}
        />
        <MetricCard
          label={t("portfolioLab.metricAlpha", { symbol: BENCHMARK_SYMBOL })}
          value={view.benchmark?.alpha === undefined ? undefined : formatSignedRate(view.benchmark.alpha, locale)}
          tone={view.benchmark?.alpha === undefined ? undefined : view.benchmark.alpha < 0 ? "negative" : "positive"}
          detail={view.benchmark?.alpha === undefined ? t("portfolioLab.metricAlphaMissing") : t("portfolioLab.metricAlphaDetail", { symbol: BENCHMARK_SYMBOL, count: formatCount(view.benchmark.overlappingSessions, locale) })}
          t={t}
        />
      </dl>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  t,
}: {
  label: string;
  value?: string;
  detail?: string;
  tone?: "positive" | "negative";
  t: Translate;
}) {
  const toneClass = tone === "negative" ? styles.negative : tone === "positive" ? styles.positive : undefined;
  return (
    <div className={styles.metricCard}>
      <dt>{label}</dt>
      <dd>
        {value === undefined ? (
          <span className={styles.notAvailable}>
            —<span className={styles.visuallyHidden}>{t("portfolioLab.notAvailable")}</span>
          </span>
        ) : (
          <b className={toneClass}>{value}</b>
        )}
        {detail ? <em>{detail}</em> : null}
      </dd>
    </div>
  );
}

function RebalancingPanel({
  scenarios,
  basis,
  locale,
  t,
}: {
  scenarios: RebalancingResult[];
  basis: PortfolioLabViewModel["returnBasis"];
  locale: string;
  t: Translate;
}) {
  const labels = {
    none: t("portfolioLab.rebalanceNone"),
    quarterly: t("portfolioLab.rebalanceQuarterly"),
    annual: t("portfolioLab.rebalanceAnnual"),
  } as const;
  return (
    <section className={styles.rebalancePanel} aria-labelledby="portfolio-rebalance-title">
      <header className={styles.panelHead}>
        <div><h2 id="portfolio-rebalance-title">{t("portfolioLab.rebalanceTitle")}</h2><p className={styles.panelSub}>{t("portfolioLab.rebalanceSub", { basis: t(basis === "total" ? "portfolioLab.basisNameTotal" : "portfolioLab.basisNamePrice") })}</p></div>
      </header>
      <div className={styles.rebalanceTableWrap}>
        <table className={styles.rebalanceTable}>
          <thead><tr><th>{t("portfolioLab.rebalanceFrequency")}</th><th>{t("portfolioLab.rebalanceEnding")}</th><th>{t("portfolioLab.rebalanceReturn")}</th><th>{t("portfolioLab.rebalanceEvents")}</th><th>{t("portfolioLab.rebalanceTurnover")}</th></tr></thead>
          <tbody>{scenarios.map((scenario) => <tr key={scenario.frequency}><th>{labels[scenario.frequency]}</th><td>{formatMoney(scenario.endingValue, locale)}</td><td className={scenario.totalReturn < 0 ? styles.negative : styles.positive}>{formatSignedRate(scenario.totalReturn, locale)}</td><td>{formatCount(scenario.events.length, locale)}</td><td>{formatRate(scenario.averageTurnover, locale)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className={styles.footnote}>{t("portfolioLab.rebalanceDisclosure")}</p>
    </section>
  );
}

function EfficientFrontierPanel({ frontier, locale, t }: { frontier: EfficientFrontier; locale: string; t: Translate }) {
  const data = frontier.points.map((point) => ({
    volatility: point.annualizedVolatility * 100,
    annualReturn: point.annualizedReturn * 100,
  }));
  return (
    <section className={styles.frontierPanel} aria-labelledby="portfolio-frontier-title">
      <header className={styles.panelHead}><div><h2 id="portfolio-frontier-title">{t("portfolioLab.frontierTitle")}</h2><p className={styles.panelSub}>{t("portfolioLab.frontierSub", { count: formatCount(frontier.observations, locale) })}</p></div></header>
      <div className={styles.frontierChart} role="img" aria-label={t("portfolioLab.frontierAria")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 18, bottom: 8, left: 4 }}>
            <CartesianGrid stroke="#252b38" strokeDasharray="2 4" />
            <XAxis type="number" dataKey="volatility" tick={{ fill: "#7f8796", fontSize: 10 }} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} label={{ value: t("portfolioLab.frontierXAxis"), position: "insideBottom", offset: -2, fill: "#7f8796", fontSize: 10 }} />
            <YAxis
              type="number"
              dataKey="annualReturn"
              tick={{ fill: "#7f8796", fontSize: 10 }}
              tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
              width={62}
              label={{ value: t("portfolioLab.frontierYAxis"), angle: -90, position: "insideLeft", fill: "#7f8796", fontSize: 10 }}
            />
            <Tooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, t("portfolioLab.frontierAnnualReturn")]} labelFormatter={(_, payload) => payload?.[0] ? t("portfolioLab.frontierTooltip", { volatility: `${Number(payload[0].payload.volatility).toFixed(2)}%` }) : ""} contentStyle={{ background: "#161b25", border: "1px solid #343b49", borderRadius: 4, fontSize: 11 }} />
            <Line type="monotone" dataKey="annualReturn" stroke="#6f97ff" strokeWidth={2} dot={{ r: 2, fill: "#8aa9ff" }} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.footnote}>{t("portfolioLab.frontierDisclosure")}</p>
    </section>
  );
}

function AdvancedAnalysisUnavailable({ title, body }: { title: string; body: string }) {
  return (
    <section className={styles.advancedUnavailable} role="status">
      <div>
        <TriangleAlert size={15} aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      <p>{body}</p>
    </section>
  );
}

/** Peak, trough, and recovery dates behind the worst decline, or the fact that it never declined. */
function drawdownDetail(view: PortfolioLabViewModel, locale: string, t: Translate): string {
  const { peakDate, troughDate, recoveryDate } = view.maxDrawdown;
  if (!peakDate || !troughDate) return t("portfolioLab.drawdownNone");
  const span = t("portfolioLab.drawdownDates", {
    peak: formatDate(peakDate, locale),
    trough: formatDate(troughDate, locale),
  });
  return recoveryDate
    ? `${span} · ${t("portfolioLab.drawdownRecovered", { date: formatDate(recoveryDate, locale) })}`
    : `${span} · ${t("portfolioLab.drawdownNotRecovered")}`;
}

// --- Attribution ------------------------------------------------------------

/**
 * What each holding was bought with and what it did with it. `data-label` lets the stylesheet
 * restack these rows as cards on a narrow screen without duplicating the content in the DOM.
 */
function AttributionTable({
  view,
  locale,
  t,
}: {
  view: PortfolioLabViewModel;
  locale: string;
  t: Translate;
}) {
  const columns: Array<{ key: string; label: string }> = [
    { key: "allocation", label: t("portfolioLab.colInitialAllocation") },
    { key: "shares", label: t("portfolioLab.colShares") },
    { key: "initialWeight", label: t("portfolioLab.colInitialWeight") },
    { key: "finalWeight", label: t("portfolioLab.colFinalWeight") },
    { key: "priceReturn", label: t("portfolioLab.colPriceReturn") },
    { key: "contributionDollars", label: t("portfolioLab.colContributionDollars") },
    { key: "contributionPoints", label: t("portfolioLab.colContributionPoints") },
  ];

  return (
    <>
      {/* The scroll region is named by text the reader can also see once the layout is compact,
          so the promise that it scrolls is not visible to assistive technology alone. */}
      <p className={styles.scrollLabel} id="portfolio-attribution-label">
        {t("portfolioLab.attributionAria")}
      </p>
      <div
        className={styles.tableWrap}
        role="region"
        aria-labelledby="portfolio-attribution-label"
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>
            {t("portfolioLab.attributionCaption", {
              from: formatDate(view.window.startDate, locale),
              to: formatDate(view.window.endDate, locale),
              count: formatCount(view.window.sessions, locale),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("result.ticker")}</th>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.holdings.map((holding) => (
              <tr key={holding.symbol}>
                <th scope="row">
                  <span className={styles.monogram} aria-hidden="true">
                    {holding.symbol.slice(0, 2)}
                  </span>
                  <span className={styles.rowIdentity}>
                    <b className={styles.mono}>{holding.symbol}</b>
                    <em>{holding.name}</em>
                  </span>
                </th>
                <td data-label={columns[0].label}>{formatMoney(holding.initialAllocation, locale)}</td>
                <td data-label={columns[1].label} className={styles.mono}>
                  {formatShares(holding.shares, locale)}
                </td>
                <td data-label={columns[2].label}>{formatRate(holding.targetWeight, locale)}</td>
                <td data-label={columns[3].label}>
                  {formatRate(holding.finalWeight, locale)}
                  <em className={styles.cellDetail}>
                    {t("portfolioLab.driftDetail", {
                      amount: formatSignedPercentPoints(
                        (holding.finalWeight - holding.targetWeight) * 100,
                        locale,
                      ),
                    })}
                  </em>
                </td>
                <td data-label={columns[4].label}>
                  <b className={holding.priceReturn < 0 ? styles.negative : styles.positive}>
                    {formatSignedRate(holding.priceReturn, locale)}
                  </b>
                  <em className={styles.cellDetail}>
                    {t("portfolioLab.priceReturnDetail", {
                      entry: formatMoney(holding.entryClose, locale),
                      final: formatMoney(holding.finalClose, locale),
                    })}
                  </em>
                </td>
                <td data-label={columns[5].label}>
                  <b className={holding.contributionDollars < 0 ? styles.negative : styles.positive}>
                    {formatSignedMoney(holding.contributionDollars, locale)}
                  </b>
                </td>
                <td data-label={columns[6].label}>
                  <b className={holding.contributionToTotalReturn < 0 ? styles.negative : styles.positive}>
                    {formatSignedPercentPoints(holding.contributionToTotalReturn * 100, locale)}
                  </b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The symmetric correlation matrix. Every cell sits under a column header and beside a row header,
 * so assistive technology names both holdings of the pair without the grid repeating itself.
 */
function CorrelationTable({
  view,
  locale,
  t,
}: {
  view: PortfolioLabViewModel;
  locale: string;
  t: Translate;
}) {
  const { symbols, values } = view.correlations;

  if (symbols.length < 2) {
    return <p className={styles.emptyState}>{t("portfolioLab.correlationSingleHolding")}</p>;
  }

  return (
    <>
      {/* Named by visible text for the same reason as the attribution table above. */}
      <p className={styles.scrollLabel} id="portfolio-matrix-label">
        {t("portfolioLab.matrixAria")}
      </p>
      <div className={styles.tableWrap} role="region" aria-labelledby="portfolio-matrix-label" tabIndex={0}>
        <table className={styles.matrix}>
          <caption className={styles.visuallyHidden}>
            {t("portfolioLab.matrixCaption", {
              symbols: joinSymbols(symbols, locale),
              count: formatCount(view.window.sessions - 1, locale),
            })}
          </caption>
          <thead>
            <tr>
              <td>
                <span className={styles.visuallyHidden}>{t("portfolioLab.matrixCorner")}</span>
              </td>
              {symbols.map((symbol) => (
                <th key={symbol} scope="col" className={styles.mono}>
                  {symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSymbol, row) => (
              <tr key={rowSymbol}>
                <th scope="row" className={styles.mono}>
                  {rowSymbol}
                </th>
                {symbols.map((columnSymbol, column) => {
                  const value = values[row]?.[column];
                  return (
                    <td key={columnSymbol} className={row === column ? styles.matrixDiagonal : undefined}>
                      {value === undefined ? (
                        <span className={styles.notAvailable}>
                          —<span className={styles.visuallyHidden}>{t("portfolioLab.notAvailable")}</span>
                        </span>
                      ) : (
                        formatRatio(value, locale)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Execution --------------------------------------------------------------

/**
 * How the capital was actually put to work: one purchase per holding on the entry date, fractional
 * shares, and nothing touched afterwards. It closes with the domain's own cross-check, which proves
 * the per-holding contributions and the portfolio total are the same dollars summed two ways.
 */
function ExecutionSummary({ view, locale, t }: { view: PortfolioLabViewModel; locale: string; t: Translate }) {
  const { attribution, window } = view;

  return (
    <section className={styles.panel} aria-labelledby="portfolio-execution-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="portfolio-execution-title">{t("portfolioLab.executionTitle")}</h2>
          <p className={styles.panelSub}>{t("portfolioLab.executionSub")}</p>
        </div>
      </header>

      <dl className={styles.executionList}>
        <div>
          <dt>{t("portfolioLab.executionCapital")}</dt>
          <dd>{formatMoney(view.initialCapital, locale)}</dd>
        </div>
        <div>
          <dt>{t("portfolioLab.executionAllocated")}</dt>
          <dd>{formatMoney(view.allocatedCapital, locale)}</dd>
        </div>
        <div>
          <dt>{t("portfolioLab.executionEntry")}</dt>
          <dd>
            {t("portfolioLab.executionEntryValue", {
              date: formatDate(window.startDate, locale),
              count: formatCount(view.holdings.length, locale),
            })}
          </dd>
        </div>
        <div>
          <dt>{t("portfolioLab.executionExit")}</dt>
          <dd>
            {t("portfolioLab.executionExitValue", {
              date: formatDate(window.endDate, locale),
              amount: formatMoney(view.finalValue, locale),
            })}
          </dd>
        </div>
        <div>
          <dt>{t("portfolioLab.executionTrades")}</dt>
          <dd>{t("portfolioLab.executionTradesValue", { count: formatCount(view.holdings.length, locale) })}</dd>
        </div>
      </dl>

      <ul className={styles.executionNotes}>
        <li>{t("portfolioLab.executionFractional")}</li>
        <li>{t("portfolioLab.executionNoRebalancing")}</li>
        <li>{t("portfolioLab.executionNoCosts")}</li>
        <li>{t("portfolioLab.executionCloseOnly")}</li>
      </ul>

      <h3 className={styles.subhead}>{t("portfolioLab.crossCheckTitle")}</h3>
      <p className={attribution.withinTolerance ? styles.crossCheckPass : styles.crossCheckFail}>
        {attribution.withinTolerance
          ? t("portfolioLab.crossCheckPass", {
              contributions: formatSignedMoney(attribution.contributionDollars, locale),
              gain: formatSignedMoney(attribution.portfolioGain, locale),
            })
          : t("portfolioLab.crossCheckFail", {
              contributions: formatSignedMoney(attribution.contributionDollars, locale),
              gain: formatSignedMoney(attribution.portfolioGain, locale),
            })}
      </p>
      <p className={styles.footnote}>{t("portfolioLab.crossCheckDetail")}</p>
    </section>
  );
}

// --- Concentration ----------------------------------------------------------

/**
 * How much of the portfolio rode on how few positions, read from the target weights the reader
 * typed rather than from the weights price movement drifted them to. Sector concentration is
 * stated as unavailable, because this data source carries no sector and a guess would be invented.
 */
function ConcentrationPanel({
  view,
  locale,
  t,
}: {
  view: PortfolioLabViewModel;
  locale: string;
  t: Translate;
}) {
  const { concentration } = view;
  const threshold = formatRate(HOLDING_CONCENTRATION_THRESHOLD, locale);

  return (
    <section className={styles.panel} aria-labelledby="portfolio-concentration-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="portfolio-concentration-title">{t("portfolioLab.concentrationLiveTitle")}</h2>
          <p className={styles.panelSub}>{t("portfolioLab.concentrationSub")}</p>
        </div>
      </header>

      {/* The band is named in words, so the reading never depends on the colour of the panel. */}
      <p className={styles.bandLine}>
        <b>{t(CONCENTRATION_BAND_KEYS[concentration.band])}</b>
        <em>
          {t("portfolioLab.concentrationBandDetail", {
            effective: formatRatio(concentration.effectiveHoldings, locale),
            holdings: formatCount(view.holdings.length, locale),
          })}
        </em>
      </p>

      <dl className={styles.concentrationList}>
        <div>
          <dt>{t("portfolioLab.concentrationLargest")}</dt>
          <dd>
            <b className={styles.mono}>{concentration.largestWeightSymbol}</b>{" "}
            {formatRate(concentration.largestWeight, locale)}
          </dd>
        </div>
        <div>
          <dt>{t("portfolioLab.concentrationHhi")}</dt>
          <dd>{formatIndex(concentration.herfindahlIndex, locale)}</dd>
        </div>
        <div>
          <dt>{t("portfolioLab.concentrationEffective")}</dt>
          <dd>{formatRatio(concentration.effectiveHoldings, locale)}</dd>
        </div>
      </dl>

      {/* The bar is decoration; the percentage beside it carries the value. */}
      <ul className={styles.weightBars}>
        {view.holdings.map((holding) => (
          <li key={holding.symbol}>
            <b className={styles.mono}>{holding.symbol}</b>
            <span className={styles.weightBar} aria-hidden="true">
              <i style={{ width: `${Math.min(100, holding.targetWeight * 100)}%` }} />
            </span>
            <em>{formatRate(holding.targetWeight, locale)}</em>
          </li>
        ))}
      </ul>

      {concentration.flags.length > 0 ? (
        <ul className={styles.flagList}>
          {concentration.flags.map((flag) => (
            <li key={flag.label}>
              {t("portfolioLab.concentrationFlag", {
                symbol: flag.label,
                weight: formatRate(flag.weight, locale),
                threshold: formatRate(flag.threshold, locale),
              })}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.footnote}>{t("portfolioLab.concentrationNoFlags", { threshold })}</p>
      )}

      <p className={styles.footnote}>{t("portfolioLab.concentrationTargetNote")}</p>
      <p className={styles.footnote}>{t("portfolioLab.concentrationSectorUnavailable")}</p>
    </section>
  );
}

// --- Diagnosis --------------------------------------------------------------

/**
 * The domain's educational reading of this window. Every sentence comes from a code the engine
 * emitted, so nothing here is written about a portfolio that was not measured, and every note is
 * labelled with its severity in words as well as in style.
 */
function DiagnosisPanel({ view, locale, t }: { view: PortfolioLabViewModel; locale: string; t: Translate }) {
  const { diagnosis, maxDrawdown } = view;

  return (
    <section className={styles.panel} aria-labelledby="portfolio-diagnosis-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="portfolio-diagnosis-title">{t("portfolioLab.diagnosisTitle")}</h2>
          <p className={styles.panelSub}>{t("portfolioLab.diagnosisSub")}</p>
        </div>
      </header>

      <ul className={styles.diagnosisList}>
        {diagnosis.notes.map((note) => (
          <li key={`${note.code}:${note.symbol ?? ""}`} className={severityClass(note.severity)}>
            <span className={styles.severityTag}>{t(SEVERITY_KEYS[note.severity])}</span>
            <span>{t(DIAGNOSIS_KEYS[note.code], diagnosisParams(note, locale))}</span>
          </li>
        ))}
      </ul>

      {/* The only arithmetic in this panel: the measured drawdown restated on a round balance,
          so a percentage becomes a number of dollars. It is an illustration, not a projection. */}
      <p className={styles.footnote}>
        {t("portfolioLab.diagnosisDrawdownDollars", {
          balance: formatMoney(DRAWDOWN_EXAMPLE_BALANCE, locale),
          amount: formatMoney(DRAWDOWN_EXAMPLE_BALANCE * Math.abs(maxDrawdown.drawdown), locale),
          rate: formatRate(maxDrawdown.drawdown, locale),
        })}
      </p>
      <p className={styles.footnote}>{t("portfolioLab.diagnosisEducational")}</p>
    </section>
  );
}

function severityClass(severity: PortfolioDiagnosisSeverity): string {
  if (severity === "warning") return styles.noteWarning;
  if (severity === "caution") return styles.noteCaution;
  return styles.noteInfo;
}

/**
 * Every placeholder any diagnosis sentence can use, formatted once. A note carries at most one
 * measured figure, so the same value is offered as a rate, a ratio, and a count, and each catalog
 * string picks the reading that suits it. A note with no figure renders an em dash, never a zero.
 */
function diagnosisParams(note: PortfolioDiagnosisNote, locale: string): Record<string, string> {
  const { value } = note;
  return {
    symbol: note.symbol ?? BENCHMARK_SYMBOL,
    rate: value === undefined ? "—" : formatRate(value, locale),
    ratio: value === undefined ? "—" : formatRatio(value, locale),
    count: value === undefined ? "—" : formatCount(value, locale),
    threshold: formatRate(HOLDING_CONCENTRATION_THRESHOLD, locale),
  };
}

// --- Risk context -----------------------------------------------------------

/**
 * The reader's own four answers read against the figures this window already measured.
 *
 * Every sentence, every ordering, and the mode label itself come from `buildRiskContext`; this
 * component picks the catalog string for each code the domain emitted and formats the two measured
 * numbers the reading echoes back. No figure is recalculated here and no answer changes one: the
 * drawdown and the volatility below are the same values the headline strip is showing.
 *
 * The answers live in this tab only. Changing one re-renders this panel and nothing else — no
 * request is made, no run is invalidated, and nothing is written anywhere.
 */
function RiskContextPanel({
  view,
  answers,
  onAnswersChange,
  locale,
  t,
}: {
  view: PortfolioLabViewModel;
  answers: RiskContextAnswers;
  onAnswersChange: (next: RiskContextAnswers) => void;
  locale: string;
  t: Translate;
}) {
  // The domain refuses a measurement it cannot read rather than clamping it. A view model always
  // carries a drawdown in [-1, 0], so this is a guard against a measurement changing shape later,
  // not an expected path: the panel disappears rather than describing a figure the domain rejected.
  const reading = useMemo(() => {
    try {
      return buildRiskContext({
        answers,
        measurement: { maxDrawdown: view.maxDrawdown.drawdown, volatility: view.volatility },
      });
    } catch {
      return undefined;
    }
  }, [answers, view]);

  if (!reading) return null;

  // The threshold is stated as a size of decline and the illustration is a dollar amount of loss,
  // so both read the decline as a magnitude. The signed figure stays in the headline card.
  const decline = formatRate(reading.drawdownMagnitude, locale);

  return (
    <section className={styles.panel} aria-labelledby="portfolio-risk-context-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="portfolio-risk-context-title">{t("riskContext.title")}</h2>
          <p className={styles.panelSub}>{t("riskContext.sub")}</p>
        </div>
      </header>

      <div className={styles.riskFields}>
        <RiskContextField
          id="portfolio-risk-horizon"
          labelKey="riskContext.horizonLabel"
          options={HORIZON_OPTIONS}
          value={answers.horizon}
          onChange={(horizon) => onAnswersChange({ ...answers, horizon })}
          t={t}
        />
        <RiskContextField
          id="portfolio-risk-loss"
          labelKey="riskContext.lossLabel"
          options={LOSS_THRESHOLD_OPTIONS}
          value={answers.lossThreshold}
          onChange={(lossThreshold) => onAnswersChange({ ...answers, lossThreshold })}
          t={t}
        />
        <RiskContextField
          id="portfolio-risk-frequency"
          labelKey="riskContext.frequencyLabel"
          options={FREQUENCY_OPTIONS}
          value={answers.frequency}
          onChange={(frequency) => onAnswersChange({ ...answers, frequency })}
          t={t}
        />
        <RiskContextField
          id="portfolio-risk-goal"
          labelKey="riskContext.goalLabel"
          options={GOAL_OPTIONS}
          value={answers.goal}
          onChange={(goal) => onAnswersChange({ ...answers, goal })}
          t={t}
        />
      </div>

      {/* The mode is the one line that summarises all four answers, so it is the announced region
          rather than the whole reading underneath it. It is named in words, never by colour. */}
      <p className={styles.riskMode} role="status" aria-live="polite">
        <span>{t("riskContext.modeLabel")}</span>
        <b>{t(MODE_LABEL_KEYS[reading.mode])}</b>
        <em>{t(MODE_DETAIL_KEYS[reading.mode])}</em>
      </p>
      <p className={styles.footnote}>{t("riskContext.modeCaption")}</p>

      <h3 className={styles.subhead}>{t("riskContext.readingTitle")}</h3>
      <div className={styles.riskReading}>
        <p>
          {t(THRESHOLD_KEYS[reading.thresholdCode], {
            rate: decline,
            threshold: formatRate(reading.lossThreshold, locale),
          })}
        </p>
        <p>
          {t("riskContext.illustration", {
            balance: formatMoney(reading.illustration.balance, locale),
            rate: decline,
            amount: formatMoney(reading.illustration.loss, locale),
          })}
        </p>
        <p>
          {t(
            VOLATILITY_KEYS[reading.volatilityCode],
            reading.volatility === undefined
              ? undefined
              : { rate: formatRate(reading.volatility, locale) },
          )}
        </p>
      </div>

      {/* Ordered, because the domain emits these in the order it means them to be read. */}
      <h3 className={styles.subhead}>{t("riskContext.focusTitle")}</h3>
      <ol className={styles.riskFocus}>
        {reading.focusMetrics.map((metric) => (
          <li key={metric}>{t(METRIC_KEYS[metric])}</li>
        ))}
      </ol>

      <h3 className={styles.subhead}>{t("riskContext.notesTitle")}</h3>
      <ul className={styles.limits}>
        {reading.notes.map((note) => (
          <li key={note}>{t(NOTE_KEYS[note])}</li>
        ))}
      </ul>

      {/* Always the full list: what this reading cannot see does not depend on the answers. */}
      <h3 className={styles.subhead}>{t("riskContext.limitsTitle")}</h3>
      <ul className={styles.limits}>
        {reading.limitations.map((limitation) => (
          <li key={limitation}>{t(LIMITATION_KEYS[limitation])}</li>
        ))}
      </ul>

      <p className={styles.footnote}>{t("riskContext.privacy")}</p>
    </section>
  );
}

/**
 * One labelled native select. The option list and its labels come from the shared key map, so the
 * control can only offer values the domain accepts and only wording both catalogs already carry.
 */
function RiskContextField<Value extends string>({
  id,
  labelKey,
  options,
  value,
  onChange,
  t,
}: {
  id: string;
  labelKey: TranslationKey;
  options: ReadonlyArray<RiskContextOption<Value>>;
  value: Value;
  onChange: (next: Value) => void;
  t: Translate;
}) {
  return (
    <div className={styles.riskField}>
      <label htmlFor={id}>{t(labelKey)}</label>
      <span className={styles.riskSelectWrap}>
        <select
          id={id}
          className={`${styles.control} ${styles.riskSelect}`}
          value={value}
          onChange={(event) => onChange(event.target.value as Value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" />
      </span>
    </div>
  );
}

// --- Chart ------------------------------------------------------------------

const AXIS_TICK = { fill: "#787b86", fontSize: 10 };
const GRID_STROKE = "rgba(120, 123, 134, 0.15)";
const AXIS_LINE = { stroke: "rgba(120, 123, 134, 0.28)" };
const CURSOR = { stroke: "rgba(91, 140, 255, 0.52)", strokeDasharray: "3 4" };

/**
 * One line for the portfolio and, when SPY covered every shared session, one rebased line for the
 * benchmark. Both tabs read the same rows, so switching tabs never changes which dates are drawn.
 */
function PortfolioChart({
  data,
  tab,
  withBenchmark,
  locale,
  ariaLabel,
  emptyLabel,
  portfolioLabel,
  animate,
}: {
  data: Array<Record<string, number | string>>;
  tab: ChartTab;
  withBenchmark: boolean;
  locale: string;
  ariaLabel: string;
  emptyLabel: string;
  /** The word the legend uses for the blue line, so the tooltip names it the same way. */
  portfolioLabel: string;
  animate: boolean;
}) {
  if (data.length < 2) return <p className={styles.emptyState}>{emptyLabel}</p>;

  const isValue = tab === "value";
  const portfolioKey = isValue ? "portfolioValue" : "portfolioReturn";
  const benchmarkKey = isValue ? "benchmarkValue" : "benchmarkReturn";

  return (
    <div className={styles.chartCanvas} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="date"
            minTickGap={48}
            tickLine={false}
            axisLine={AXIS_LINE}
            tick={AXIS_TICK}
            tickFormatter={(value: string) => formatAxisDate(value, locale)}
          />
          <YAxis
            width={64}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            domain={isValue ? ["auto", "auto"] : undefined}
            tickFormatter={(value: number) =>
              isValue ? formatAxisMoney(value, locale) : `${value.toFixed(0)}%`
            }
          />
          {/* Break-even only means something on the cumulative tab; on the value tab zero dollars
              is off the axis and a line there would be noise. */}
          {isValue ? null : (
            <ReferenceLine y={0} stroke="rgba(120, 123, 134, 0.45)" strokeDasharray="3 4" />
          )}
          <Tooltip
            cursor={CURSOR}
            content={<ChartTooltip locale={locale} isValue={isValue} portfolioLabel={portfolioLabel} />}
          />
          <Line
            type="monotone"
            dataKey={portfolioKey}
            stroke={PORTFOLIO_COLOR}
            strokeWidth={1.8}
            dot={false}
            connectNulls={false}
            isAnimationActive={animate}
            animationDuration={700}
            activeDot={{ r: 3, strokeWidth: 2 }}
          />
          {withBenchmark ? (
            <Line
              type="monotone"
              dataKey={benchmarkKey}
              stroke={BENCHMARK_COLOR}
              strokeWidth={1.4}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={animate}
              animationDuration={700}
              activeDot={{ r: 3, strokeWidth: 2 }}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Prints the hovered date and one labelled row per line that reported a value on that date. */
function ChartTooltip({
  active,
  payload,
  label,
  locale,
  isValue,
  portfolioLabel,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | null }>;
  label?: string;
  locale: string;
  isValue: boolean;
  portfolioLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((entry) => typeof entry.value === "number");
  if (rows.length === 0) return null;

  return (
    <div className={styles.tooltip}>
      <strong>{label ? formatDate(label, locale) : ""}</strong>
      {rows.map((entry) => {
        const key = String(entry.dataKey);
        const isBenchmark = key.startsWith("benchmark");
        const value = entry.value as number;
        return (
          <span key={key}>
            <i style={{ background: isBenchmark ? BENCHMARK_COLOR : PORTFOLIO_COLOR }} aria-hidden="true" />
            <em className={isBenchmark ? styles.mono : undefined}>{isBenchmark ? BENCHMARK_SYMBOL : portfolioLabel}</em>
            <b>{isValue ? formatMoney(value, locale) : formatSignedPercentPoints(value, locale)}</b>
          </span>
        );
      })}
    </div>
  );
}

// --- CSV export -------------------------------------------------------------

/**
 * Builds the CSV text from the rendered view model. Numbers are written as plain decimal fractions
 * with a dot separator so the file stays machine-readable in every locale, a figure the window
 * could not support is written as an empty cell rather than a zero, and the header states the
 * buy-and-hold basis so the file cannot be read as a rebalanced or total-return result.
 */
function buildCsv(view: PortfolioLabViewModel, input: PortfolioInput, t: Translate): string {
  const { window, concentration, attribution, benchmark } = view;

  const rows: string[][] = [
    [t("portfolioLab.csvTitle")],
    [t("portfolioLab.csvBasis"), t("portfolioLab.csvBasisText")],
    [t("portfolioLab.csvEmptyCells"), t("portfolioLab.csvEmptyCellsText")],
    [t("portfolioLab.csvRequestedWindow"), `${input.startDate} / ${input.endDate}`],
    [t("portfolioLab.csvWindowStart"), window.startDate],
    [t("portfolioLab.csvWindowEnd"), window.endDate],
    [t("portfolioLab.csvSessions"), String(window.sessions)],
    [t("portfolioLab.csvRiskFree"), `${input.riskFreePercent}%`],
    [
      t("portfolioLab.csvReturnBasis"),
      t(view.returnBasis === "total" ? "portfolioLab.csvBasisTotal" : "portfolioLab.csvBasisPrice"),
    ],
    [t("portfolioLab.csvObservations"), String(view.riskSample.observations)],
    [t("portfolioLab.csvBenchmark"), benchmark ? benchmark.symbol : t("portfolioLab.csvNone")],
    [],
    [t("portfolioLab.csvTotals")],
    [t("portfolioLab.csvInitialCapital"), decimal(view.initialCapital, 2)],
    [t("portfolioLab.csvAllocatedCapital"), decimal(view.allocatedCapital, 2)],
    [t("portfolioLab.csvFinalValue"), decimal(view.finalValue, 2)],
    [t("portfolioLab.csvTotalGain"), decimal(view.totalGain, 2)],
    [t("portfolioLab.csvPerformanceFinalValue"), decimal(view.performanceFinalValue, 2)],
    [t("portfolioLab.csvPerformanceGain"), decimal(view.performanceGain, 2)],
    [t("portfolioLab.csvTotalReturn"), decimal(view.totalPriceReturn, 6)],
    [t("portfolioLab.csvVendorTotalReturn"), decimal(view.totalReturn, 6)],
    [t("portfolioLab.csvCagr"), decimal(view.cagr, 6)],
    [t("portfolioLab.csvVolatility"), decimal(view.volatility, 6)],
    [t("portfolioLab.csvSharpe"), decimal(view.sharpeRatio, 4)],
    [t("portfolioLab.csvSortino"), decimal(view.sortinoRatio, 4)],
    [t("portfolioLab.csvVar"), decimal(view.historicalValueAtRisk.value, 6)],
    [t("portfolioLab.csvVarConfidence"), decimal(view.historicalValueAtRisk.confidence, 4)],
    [t("portfolioLab.csvMaxDrawdown"), decimal(view.maxDrawdown.drawdown, 6)],
    [t("portfolioLab.csvPeakDate"), view.maxDrawdown.peakDate ?? ""],
    [t("portfolioLab.csvTroughDate"), view.maxDrawdown.troughDate ?? ""],
    [t("portfolioLab.csvRecoveryDate"), view.maxDrawdown.recoveryDate ?? ""],
    [t("portfolioLab.csvBeta"), decimal(benchmark?.beta, 4)],
    [t("portfolioLab.csvAlpha"), decimal(benchmark?.alpha, 6)],
    [t("portfolioLab.csvBenchmarkCorrelation"), decimal(benchmark?.correlation, 4)],
    [t("portfolioLab.csvBenchmarkSessions"), benchmark ? String(benchmark.overlappingSessions) : ""],
    [],
    [t("portfolioLab.csvHoldings")],
    [
      t("result.ticker"),
      t("portfolioLab.csvName"),
      t("portfolioLab.csvTargetWeight"),
      t("portfolioLab.csvShares"),
      t("portfolioLab.csvEntryClose"),
      t("portfolioLab.csvFinalClose"),
      t("portfolioLab.csvInitialAllocation"),
      t("portfolioLab.csvHoldingFinalValue"),
      t("portfolioLab.csvFinalWeight"),
      t("portfolioLab.csvPriceReturn"),
      t("portfolioLab.csvVendorTotalReturn"),
      t("portfolioLab.csvContributionDollars"),
      t("portfolioLab.csvContributionReturn"),
      t("portfolioLab.csvSessionsUsed"),
      t("portfolioLab.csvOwnBars"),
      t("portfolioLab.csvOwnFirst"),
      t("portfolioLab.csvOwnLast"),
    ],
  ];

  for (const holding of view.holdings) {
    rows.push([
      holding.symbol,
      holding.name,
      decimal(holding.targetWeight, 6),
      decimal(holding.shares, 6),
      decimal(holding.entryClose, 4),
      decimal(holding.finalClose, 4),
      decimal(holding.initialAllocation, 2),
      decimal(holding.finalValue, 2),
      decimal(holding.finalWeight, 6),
      decimal(holding.priceReturn, 6),
      decimal(holding.totalReturn, 6),
      decimal(holding.contributionDollars, 2),
      decimal(holding.contributionToTotalReturn, 6),
      String(holding.usedSessions),
      String(holding.suppliedBars),
      holding.suppliedFirstDate,
      holding.suppliedLastDate,
    ]);
  }

  rows.push(
    [],
    [t("portfolioLab.csvCrossCheck")],
    [t("portfolioLab.csvCrossCheckContributions"), decimal(attribution.contributionDollars, 6)],
    [t("portfolioLab.csvCrossCheckGain"), decimal(attribution.portfolioGain, 6)],
    [t("portfolioLab.csvCrossCheckDifference"), decimal(attribution.dollarDifference, 10)],
    [t("portfolioLab.csvCrossCheckTolerance"), decimal(attribution.tolerance, 12)],
    [
      t("portfolioLab.csvCrossCheckWithin"),
      attribution.withinTolerance ? t("portfolioLab.csvYes") : t("portfolioLab.csvNo"),
    ],
    [],
    [t("portfolioLab.csvConcentration")],
    [t("portfolioLab.csvLargestSymbol"), concentration.largestWeightSymbol],
    [t("portfolioLab.csvLargestWeight"), decimal(concentration.largestWeight, 6)],
    [t("portfolioLab.csvHhi"), decimal(concentration.herfindahlIndex, 6)],
    [t("portfolioLab.csvEffectiveHoldings"), decimal(concentration.effectiveHoldings, 4)],
    [t("portfolioLab.csvBand"), t(CONCENTRATION_BAND_KEYS[concentration.band])],
    [t("portfolioLab.csvSector"), t("portfolioLab.csvSectorUnavailable")],
    [],
    [t("portfolioLab.csvCorrelation")],
    ["", ...view.correlations.symbols],
  );
  view.correlations.symbols.forEach((symbol, row) => {
    rows.push([
      symbol,
      ...view.correlations.symbols.map((_, column) => decimal(view.correlations.values[row]?.[column], 6)),
    ]);
  });

  // Codes and measured figures only: the prose is rendered on the page, and repeating it here
  // would freeze one language into a file the reader may open in the other.
  rows.push(
    [],
    [t("portfolioLab.csvDiagnosis")],
    [t("portfolioLab.csvDiagCode"), t("portfolioLab.csvDiagSeverity"), t("portfolioLab.csvDiagValue")],
  );
  for (const note of view.diagnosis.notes) {
    rows.push([
      note.symbol ? `${note.code} (${note.symbol})` : note.code,
      note.severity,
      decimal(note.value, 6),
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function decimal(value: number | undefined, digits: number): string {
  return value === undefined || !Number.isFinite(value) ? "" : value.toFixed(digits);
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvFilename(view: PortfolioLabViewModel): string {
  const tickers = view.holdings.map((holding) => holding.symbol.replace(/[^A-Z0-9]/g, "")).join("-");
  return `investiq-portfolio_${tickers}_${view.window.startDate}_${view.window.endDate}.csv`;
}

/**
 * Writes the file straight from this browser. The bytes come from the view model already on
 * screen, so no request is made, nothing is uploaded, and no credential can be included.
 */
function downloadCsv(content: string, filename: string): void {
  // The BOM keeps Simplified Chinese headers readable when the file is opened in Excel.
  const blob = new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// --- Formatting -------------------------------------------------------------

/** Ticker lists, joined with the reader's own list conjunction. */
function joinSymbols(symbols: string[], locale: string): string {
  if (symbols.length === 0) return "—";
  return new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(symbols);
}

/** US dollars, because every instrument this product reads is priced in them. */
function formatMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

/** Short enough for an axis tick, so a six-figure balance does not crowd out the plot. */
function formatAxisMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Fractional share counts, shown to four places because they are rarely whole. */
function formatShares(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value);
}

function formatRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

/** Already-scaled percentage points, kept out of the percent style so they are not scaled twice. */
function formatSignedPercentPoints(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value)}%`;
}

/** The weight total, which is a running sum the reader is typing, so it carries no sign. */
function formatPercentPointsPlain(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatRatio(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** The HHI, which needs a third place to separate a broad portfolio from a very broad one. */
function formatIndex(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
}

function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso: DateString, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatAxisDate(iso: DateString, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function formatTimestamp(value: Date, locale: string): string {
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
