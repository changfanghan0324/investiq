"use client";

// Purpose: Stock Comparison workspace — two to five US stocks or ETFs measured on the exact
// trading dates all of them share, with aligned charts, a risk-and-return table, a correlation
// matrix, a neutral narrative, and a locally generated CSV export.
//
// Honesty rules this file follows:
// - Every figure comes from `buildStockComparison`. Nothing is recalculated here, and a figure the
//   shared window cannot support renders as an em dash with a stated reason, never as zero.
// - Only closing prices are read, so every return is a price return. Dividends are excluded, and
//   the page says so in the basis panel, in the narrative notes, and inside the CSV header.
// - Selected securities load strictly one at a time, then SPY strictly after all of them. A
//   selected security that fails blocks the comparison — comparing a partial field would be a
//   different comparison — but every per-ticker status and every successful load stays on screen
//   so the reader can see exactly what to fix and retry just that ticker.
// - A failed SPY removes beta only. Every other figure stays visible and labelled.
// - The Sharpe ratio uses exactly the risk-free rate the reader typed. No rate feed is read.
// - The CSV is written in this browser from the results already rendered. Nothing is uploaded, and
//   no key, credential, or request detail is included in the file.
// - No external logo service is called; the mark is a monogram of the ticker itself.

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
import { Download, Info, Play, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
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
import { isValidSymbol, normalizeSymbol } from "@/domain/market-overview";
import {
  MAX_COMPARISON_SECURITIES,
  MIN_COMMON_CLOSES,
  MIN_COMPARISON_SECURITIES,
  buildStockComparison,
  commonTradingDates,
  type ComparedSecurity,
  type ComparisonExtreme,
  type ComparisonNoteCode,
  type StockComparisonViewModel,
} from "@/domain/stock-comparison";
import { MarketDataError, loadMarketData } from "@/services/market-data-api";
import { type Translate, type TranslationKey, useLanguage } from "@/i18n/language";
import type { DateString, MarketData } from "@/types/backtest";
import { daysBetween } from "@/utils/date";

import styles from "./stock-comparison.module.css";

/** Benchmark for beta. An investable ETF, not the index itself. */
const BENCHMARK_SYMBOL = "SPY";

/** Opening example, so the workspace shows real output instead of an empty form. */
const EXAMPLE_SYMBOLS = ["AAPL", "MSFT"];

/** Trailing window of the opening example, in years. */
const EXAMPLE_YEARS = 5;

/** Default annual risk-free rate, in percent. Always shown and always editable. */
const DEFAULT_RISK_FREE_PERCENT = "4.0";

/** Accepted range for the typed annual risk-free rate, in percent. */
const RISK_FREE_PERCENT_LIMIT = 25;

/** Earliest start date offered, matching the rest of the product. */
const EARLIEST_START_DATE = "1990-01-01";

/** Shortest window that can produce daily returns worth reading, in calendar days. */
const MIN_WINDOW_DAYS = 30;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** One colour per slot, in slot order, so five series stay distinguishable from each other. */
const SERIES_COLORS = ["#5b8cff", "#f2b636", "#45c1a8", "#c084fc", "#f5709a"];

const FALLBACK_COLOR = SERIES_COLORS[0];

type ChartTab = "cumulative" | "daily";

const CHART_TABS: Array<{ id: ChartTab; labelKey: TranslationKey }> = [
  { id: "cumulative", labelKey: "compare.tabCumulative" },
  { id: "daily", labelKey: "compare.tabDaily" },
];

/** Notes the domain narrative can raise, mapped to the prose the reader sees. */
const NOTE_KEYS: Record<ComparisonNoteCode, TranslationKey> = {
  "price-return-only": "compare.notePriceReturnOnly",
  "not-investment-advice": "compare.noteNotAdvice",
  "common-window-shortened": "compare.noteWindowShortened",
  "benchmark-unavailable": "compare.noteBenchmarkUnavailable",
  "benchmark-partial-overlap": "compare.noteBenchmarkPartial",
  "cagr-not-comparable": "compare.noteCagrNotComparable",
  "volatility-not-comparable": "compare.noteVolatilityNotComparable",
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

/** One editable symbol field. The id survives insertions and removals, unlike an index. */
interface SymbolSlot {
  id: number;
  value: string;
}

interface FormState {
  startDate: string;
  endDate: string;
  riskFreePercent: string;
}

/** A validated, normalized run request. */
interface ComparisonInput {
  symbols: string[];
  startDate: DateString;
  endDate: DateString;
  /** Decimal fraction, as the domain requires; the form collects percent. */
  annualRiskFreeRate: number;
  /** The percent string the reader typed, echoed back verbatim in the copy. */
  riskFreePercent: string;
}

/** Every load of one run, in the order the requests were issued. */
interface RunState {
  input: ComparisonInput;
  securities: SymbolLoad[];
  benchmark: SymbolLoad;
}

interface FieldError {
  field: string;
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
}

/** Either a built comparison or the reason one could not be built from loaded data. */
interface Assembled {
  view?: StockComparisonViewModel;
  /** Set when the securities loaded but the comparison itself is not computable. */
  failure?: FieldError;
  /** Set when the benchmark loaded but could not be used; every non-beta figure survives. */
  benchmarkFailureKey?: TranslationKey;
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

/**
 * Client-side gate on the form. It rejects only what is certainly wrong — a blank or unusable
 * ticker, a repeated ticker, a malformed or out-of-range date, an inverted or too-short window,
 * an unusable rate — so the service is never asked a question that cannot have an answer.
 */
function validateForm(
  slots: SymbolSlot[],
  form: FormState,
  today: DateString,
): { errors: FieldError[]; input?: ComparisonInput } {
  const errors: FieldError[] = [];
  const symbols: string[] = [];
  const seen = new Set<string>();

  slots.forEach((slot, index) => {
    const symbol = normalizeSymbol(slot.value);
    const field = symbolField(slot.id);
    if (symbol === "") {
      errors.push({ field, messageKey: "compare.validationEmpty", params: { count: index + 1 } });
      return;
    }
    if (!isValidSymbol(symbol)) {
      errors.push({ field, messageKey: "validation.ticker" });
      return;
    }
    if (seen.has(symbol)) {
      errors.push({ field, messageKey: "compare.validationDuplicate", params: { symbol } });
      return;
    }
    seen.add(symbol);
    symbols.push(symbol);
  });

  const { startDate, endDate } = form;
  if (!ISO_DATE_PATTERN.test(startDate) || startDate < EARLIEST_START_DATE) {
    errors.push({ field: "startDate", messageKey: "validation.startDate" });
  }
  if (!ISO_DATE_PATTERN.test(endDate)) {
    errors.push({ field: "endDate", messageKey: "validation.endDate" });
  } else if (endDate > today) {
    errors.push({ field: "endDate", messageKey: "compare.validationFutureEnd" });
  }

  const datesUsable = errors.every((error) => error.field !== "startDate" && error.field !== "endDate");
  if (datesUsable) {
    if (startDate > endDate) {
      errors.push({ field: "startDate", messageKey: "validation.startBeforeEnd" });
    } else if (daysBetween(startDate, endDate) < MIN_WINDOW_DAYS) {
      errors.push({
        field: "endDate",
        messageKey: "compare.validationRangeTooShort",
        params: { days: MIN_WINDOW_DAYS },
      });
    }
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
      messageKey: "compare.validationRiskFree",
      params: { max: RISK_FREE_PERCENT_LIMIT },
    });
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    input: {
      symbols,
      startDate,
      endDate,
      annualRiskFreeRate: percent / 100,
      riskFreePercent: form.riskFreePercent.trim(),
    },
  };
}

function symbolField(id: number): string {
  return `symbol-${id}`;
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
      }),
    };
  } catch (error) {
    if (error instanceof MarketDataError) return { message: error.message };
    return { messageKey: "compare.errorUnknown" };
  }
}

/** Applies one load outcome to the row that requested it, keeping its symbol and identity. */
function applyOutcome(load: SymbolLoad, outcome: FailureMessage & { data?: MarketData }): SymbolLoad {
  if (outcome.data) return { symbol: load.symbol, status: "ready", data: outcome.data };
  return {
    symbol: load.symbol,
    status: "error",
    message: outcome.message,
    messageKey: outcome.messageKey ?? (outcome.message ? undefined : "compare.errorUnknown"),
  };
}

function replaceSecurity(run: RunState, symbol: string, next: (load: SymbolLoad) => SymbolLoad): RunState {
  return {
    ...run,
    securities: run.securities.map((load) => (load.symbol === symbol ? next(load) : load)),
  };
}

/**
 * Builds the comparison from whatever loaded, or explains why it cannot be built.
 *
 * The overlap is checked before the domain is called so a non-overlapping window produces a
 * translated explanation with the real count instead of an untranslated thrown message. A
 * benchmark that cannot be used is dropped and reported on its own, because beta is the only
 * figure that depends on it.
 */
function assemble(run: RunState): Assembled | undefined {
  const securities = run.securities.map((load) => load.data);
  if (securities.some((data) => data === undefined)) return undefined;
  const loaded = securities as MarketData[];

  const shared = commonTradingDates(loaded.map((data) => data.prices));
  if (shared.length < MIN_COMMON_CLOSES) {
    return {
      failure: {
        field: "overlap",
        messageKey: "compare.errorNoOverlap",
        params: { count: shared.length, min: MIN_COMMON_CLOSES },
      },
    };
  }

  // SPY can also be one of the selected securities; reuse that series rather than asking twice.
  const benchmark =
    run.benchmark.data ?? loaded.find((data) => normalizeSymbol(data.ticker) === BENCHMARK_SYMBOL);
  const request = { securities: loaded, annualRiskFreeRate: run.input.annualRiskFreeRate };

  try {
    return { view: buildStockComparison({ ...request, benchmark }) };
  } catch {
    if (!benchmark) return { failure: { field: "series", messageKey: "compare.errorSeries" } };
  }

  try {
    return { view: buildStockComparison(request), benchmarkFailureKey: "compare.errorBenchmarkSeries" };
  } catch {
    return { failure: { field: "series", messageKey: "compare.errorSeries" } };
  }
}

function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? FALLBACK_COLOR;
}

// --- Workspace --------------------------------------------------------------

export function StockComparison() {
  const { locale, t } = useLanguage();
  const reduceMotion = useReducedMotion();

  const [slots, setSlots] = useState<SymbolSlot[]>(() =>
    EXAMPLE_SYMBOLS.map((value, index) => ({ id: index + 1, value })),
  );
  const [form, setForm] = useState<FormState>({
    startDate: "",
    endDate: "",
    riskFreePercent: DEFAULT_RISK_FREE_PERCENT,
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [run, setRun] = useState<RunState>();
  const [running, setRunning] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date>();
  const [chartTab, setChartTab] = useState<ChartTab>("cumulative");

  // Supersedes an in-flight sequence: every await re-checks the token before writing state.
  const runIdRef = useRef(0);
  const nextSlotIdRef = useRef(EXAMPLE_SYMBOLS.length + 1);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Loads SPY, which happens only after every selected security is on screen. Callers pass the
   * token of their own sequence so a superseded run cannot write a benchmark into a newer one.
   */
  const loadBenchmarkLeg = useCallback(async (input: ComparisonInput, runId: number) => {
    setRun((prev) => (prev ? { ...prev, benchmark: { ...prev.benchmark, status: "loading" } } : prev));
    const outcome = await loadSymbol(BENCHMARK_SYMBOL, input.startDate, input.endDate);
    if (runIdRef.current !== runId) return;
    setRun((prev) => (prev ? { ...prev, benchmark: applyOutcome(prev.benchmark, outcome) } : prev));
  }, []);

  const runComparison = useCallback(
    async (input: ComparisonInput) => {
      const runId = ++runIdRef.current;
      const benchmarkIsSelected = input.symbols.includes(BENCHMARK_SYMBOL);

      setRunning(true);
      setLoadedAt(undefined);
      setRun({
        input,
        securities: input.symbols.map((symbol) => ({ symbol, status: "pending" })),
        benchmark: { symbol: BENCHMARK_SYMBOL, status: benchmarkIsSelected ? "reused" : "pending" },
      });

      // Strictly sequential: one request is in flight at a time, in slot order.
      let allLoaded = true;
      for (const symbol of input.symbols) {
        if (runIdRef.current !== runId) return;
        setRun((prev) => (prev ? replaceSecurity(prev, symbol, (load) => ({ ...load, status: "loading" })) : prev));
        const outcome = await loadSymbol(symbol, input.startDate, input.endDate);
        if (runIdRef.current !== runId) return;
        setRun((prev) => (prev ? replaceSecurity(prev, symbol, (load) => applyOutcome(load, outcome)) : prev));
        if (!outcome.data) allLoaded = false;
      }

      // A blocked comparison cannot use a benchmark, so SPY is not requested at all — and the
      // queue says so rather than leaving a step that looks like it is still coming.
      if (allLoaded && !benchmarkIsSelected) {
        await loadBenchmarkLeg(input, runId);
      } else if (!allLoaded && !benchmarkIsSelected) {
        setRun((prev) => (prev ? { ...prev, benchmark: { ...prev.benchmark, status: "skipped" } } : prev));
      }

      if (runIdRef.current !== runId) return;
      setRunning(false);
      setLoadedAt(new Date());
    },
    [loadBenchmarkLeg],
  );

  /** Retries one selected security, then continues to SPY if that was the last one missing. */
  const retrySecurity = useCallback(
    async (symbol: string) => {
      const current = run;
      if (!current) return;
      const runId = ++runIdRef.current;
      setRunning(true);

      setRun((prev) => (prev ? replaceSecurity(prev, symbol, (load) => ({ ...load, status: "loading" })) : prev));
      const outcome = await loadSymbol(symbol, current.input.startDate, current.input.endDate);
      if (runIdRef.current !== runId) return;
      setRun((prev) => (prev ? replaceSecurity(prev, symbol, (load) => applyOutcome(load, outcome)) : prev));

      const allLoaded =
        outcome.data !== undefined &&
        current.securities.every((load) => load.symbol === symbol || load.data !== undefined);
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

  // The example window depends on today's date, so it is filled in after mount: the server and
  // the client render the same empty date inputs, and the first run starts once hydration is done.
  useEffect(() => {
    const timer = setTimeout(() => {
      const range = trailingRange(new Date(), EXAMPLE_YEARS);
      const example: FormState = { ...range, riskFreePercent: DEFAULT_RISK_FREE_PERCENT };
      setForm(example);
      const exampleSlots = EXAMPLE_SYMBOLS.map((value, index) => ({ id: index + 1, value }));
      const { input } = validateForm(exampleSlots, example, range.endDate);
      if (input) void runComparison(input);
    }, 0);
    return () => clearTimeout(timer);
  }, [runComparison]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { errors: found, input } = validateForm(slots, form, isoDate(new Date()));
    setErrors(found);
    if (input) void runComparison(input);
  }

  function updateSlot(id: number, value: string) {
    // Uppercased as it is typed, so what the reader sees is exactly what is requested.
    setSlots((prev) => prev.map((slot) => (slot.id === id ? { ...slot, value: value.toUpperCase() } : slot)));
    setErrors([]);
  }

  function addSlot() {
    setSlots((prev) =>
      prev.length >= MAX_COMPARISON_SECURITIES ? prev : [...prev, { id: nextSlotIdRef.current++, value: "" }],
    );
    setErrors([]);
  }

  function removeSlot(id: number) {
    setSlots((prev) => (prev.length <= MIN_COMPARISON_SECURITIES ? prev : prev.filter((slot) => slot.id !== id)));
    setErrors([]);
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors([]);
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

  const assembled = useMemo(() => (run ? assemble(run) : undefined), [run]);
  const view = assembled?.view;

  const failedSecurities = useMemo(
    () => run?.securities.filter((load) => load.status === "error") ?? [],
    [run],
  );

  /** SPY failed to load, or loaded but could not be used. Beta is the only casualty. */
  const benchmarkFailure = useMemo<FailureMessage | undefined>(() => {
    if (assembled?.benchmarkFailureKey) return { messageKey: assembled.benchmarkFailureKey };
    if (run?.benchmark.status === "error") {
      return { message: run.benchmark.message, messageKey: run.benchmark.messageKey };
    }
    return undefined;
  }, [assembled, run]);

  const colorBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    view?.securities.forEach((security, index) => map.set(security.symbol, seriesColor(index)));
    return map;
  }, [view]);

  const cumulativeData = useMemo(() => {
    if (!view) return [];
    const rows = new Map<DateString, Record<string, number | string>>(
      view.commonWindow.dates.map((date) => [date, { date }]),
    );
    for (const security of view.securities) {
      for (const point of security.cumulativeReturns) {
        const row = rows.get(point.date);
        if (row) row[security.symbol] = point.value * 100;
      }
    }
    return [...rows.values()];
  }, [view]);

  const dailyData = useMemo(() => {
    if (!view) return [];
    const rows = new Map<DateString, Record<string, number | string>>(
      view.commonWindow.dates.slice(1).map((date) => [date, { date }]),
    );
    for (const security of view.securities) {
      for (const point of security.dailyReturns) {
        const row = rows.get(point.date);
        if (row) row[security.symbol] = point.value * 100;
      }
    }
    return [...rows.values()];
  }, [view]);

  const loadingSymbol = run?.securities.find((load) => load.status === "loading")?.symbol;
  const benchmarkLoading = run?.benchmark.status === "loading";

  const statusText = running
    ? loadingSymbol
      ? t("compare.statusLoadingSymbol", { symbol: loadingSymbol })
      : benchmarkLoading
        ? t("compare.statusLoadingBenchmark", { symbol: BENCHMARK_SYMBOL })
        : t("compare.statusWorking")
    : loadedAt
      ? t("compare.statusReady", { time: formatTimestamp(loadedAt, locale) })
      : t("compare.statusIdle");

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
            if (run) void runComparison(run.input);
          }}
          disabled={running || !run}
        >
          <RefreshCw size={13} aria-hidden="true" className={running ? styles.spin : undefined} />
          <span>{running ? t("compare.rerunning") : t("compare.rerun")}</span>
        </button>
      }
    >
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1>{t("compare.title")}</h1>
          <p className={styles.subtitle}>{t("compare.subtitle")}</p>
        </div>

        <form className={styles.controls} onSubmit={handleSubmit} aria-label={t("compare.controlsTitle")}>
          <fieldset className={styles.symbolFields}>
            <legend>{t("compare.symbols")}</legend>
            {slots.map((slot, index) => {
              const fieldError = errorFor(symbolField(slot.id));
              const inputId = `compare-symbol-${slot.id}`;
              return (
                <div key={slot.id} className={styles.symbolField}>
                  <label htmlFor={inputId}>{t("compare.symbolLabel", { count: index + 1 })}</label>
                  <div className={styles.symbolRow}>
                    <input
                      id={inputId}
                      className={`${styles.control} ${styles.mono}`}
                      value={slot.value}
                      onChange={(event) => updateSlot(slot.id, event.target.value)}
                      placeholder={t("compare.symbolPlaceholder")}
                      maxLength={12}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={fieldError ? true : undefined}
                      aria-describedby={fieldError ? `${inputId}-error` : undefined}
                    />
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeSlot(slot.id)}
                      disabled={slots.length <= MIN_COMPARISON_SECURITIES}
                      aria-label={t("compare.removeSymbol", { count: index + 1 })}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                  {fieldError ? (
                    <p className={styles.fieldError} id={`${inputId}-error`}>
                      {t(fieldError.messageKey, fieldError.params)}
                    </p>
                  ) : null}
                </div>
              );
            })}

            <button
              type="button"
              className={styles.addButton}
              onClick={addSlot}
              disabled={slots.length >= MAX_COMPARISON_SECURITIES}
              aria-describedby="compare-slot-hint"
            >
              <Plus size={13} aria-hidden="true" />
              <span>{t("compare.addSymbol")}</span>
            </button>
            <p className={styles.controlHint} id="compare-slot-hint">
              {slots.length >= MAX_COMPARISON_SECURITIES
                ? t("compare.slotLimitReached", { max: MAX_COMPARISON_SECURITIES })
                : t("compare.slotLimit", { min: MIN_COMPARISON_SECURITIES, max: MAX_COMPARISON_SECURITIES })}
            </p>
          </fieldset>

          <div className={styles.windowFields}>
            <div className={styles.controlField}>
              <label htmlFor="compare-start">{t("date.start")}</label>
              <input
                id="compare-start"
                type="date"
                className={styles.control}
                value={form.startDate}
                min={EARLIEST_START_DATE}
                onChange={(event) => updateField("startDate", event.target.value)}
                aria-invalid={errorFor("startDate") ? true : undefined}
                aria-describedby={errorFor("startDate") ? "compare-start-error" : undefined}
              />
              {errorFor("startDate") ? (
                <p className={styles.fieldError} id="compare-start-error">
                  {t(errorFor("startDate")!.messageKey, errorFor("startDate")!.params)}
                </p>
              ) : null}
            </div>

            <div className={styles.controlField}>
              <label htmlFor="compare-end">{t("date.end")}</label>
              <input
                id="compare-end"
                type="date"
                className={styles.control}
                value={form.endDate}
                min={EARLIEST_START_DATE}
                onChange={(event) => updateField("endDate", event.target.value)}
                aria-invalid={errorFor("endDate") ? true : undefined}
                aria-describedby={errorFor("endDate") ? "compare-end-error" : undefined}
              />
              {errorFor("endDate") ? (
                <p className={styles.fieldError} id="compare-end-error">
                  {t(errorFor("endDate")!.messageKey, errorFor("endDate")!.params)}
                </p>
              ) : null}
            </div>

            <div className={styles.controlField}>
              <label htmlFor="compare-risk-free">{t("compare.riskFreeLabel")}</label>
              <input
                id="compare-risk-free"
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
                    ? "compare-risk-free-error compare-risk-free-hint"
                    : "compare-risk-free-hint"
                }
              />
              {errorFor("riskFree") ? (
                <p className={styles.fieldError} id="compare-risk-free-error">
                  {t(errorFor("riskFree")!.messageKey, errorFor("riskFree")!.params)}
                </p>
              ) : null}
              <p className={styles.controlHint} id="compare-risk-free-hint">
                {t("compare.riskFreeHint")}
              </p>
            </div>

            <button type="submit" className={styles.runButton} disabled={running}>
              <Play size={13} aria-hidden="true" />
              <span>{running ? t("compare.running") : t("compare.run")}</span>
            </button>
          </div>
        </form>

        {errors.length > 0 ? (
          <p className={styles.formAlert} role="alert">
            {t("compare.validationFix")}
          </p>
        ) : null}

        {run ? (
          <LoadQueue
            run={run}
            running={running}
            onRetrySecurity={(symbol) => void retrySecurity(symbol)}
            t={t}
          />
        ) : null}

        {failedSecurities.length > 0 ? (
          <section className={styles.errorPanel} aria-labelledby="compare-blocked-title">
            <h2 id="compare-blocked-title">
              <TriangleAlert size={14} aria-hidden="true" /> {t("compare.blockedTitle")}
            </h2>
            <p>
              {t("compare.blockedBody", {
                symbols: joinSymbols(
                  failedSecurities.map((load) => load.symbol),
                  locale,
                ),
              })}
            </p>
            <p>{t("compare.blockedRetained")}</p>
            <ul>
              {failedSecurities.map((load) => (
                <li key={load.symbol}>
                  <b className={styles.mono}>{load.symbol}</b>
                  <span>{failureText(load, t)}</span>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => void retrySecurity(load.symbol)}
                    disabled={running}
                  >
                    {t("compare.retrySymbol", { symbol: load.symbol })}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => {
                if (run) void runComparison(run.input);
              }}
              disabled={running}
            >
              {t("compare.retryAll")}
            </button>
          </section>
        ) : null}

        {assembled?.failure ? (
          <section className={styles.errorPanel} aria-labelledby="compare-error-title">
            <h2 id="compare-error-title">
              <TriangleAlert size={14} aria-hidden="true" /> {t("compare.errorTitle")}
            </h2>
            <p>{t(assembled.failure.messageKey, assembled.failure.params)}</p>
            {run ? <OwnHistoryList securities={run.securities} locale={locale} t={t} /> : null}
          </section>
        ) : null}

        {view && run ? (
          <>
            <section className={styles.basis} aria-labelledby="compare-basis-title">
              <h2 id="compare-basis-title">
                <Info size={13} aria-hidden="true" /> {t("compare.basisTitle")}
              </h2>
              <ul>
                <li>{t("compare.basisSplitAdjusted")}</li>
                <li>{t("compare.basisDividends")}</li>
                <li>{t("compare.basisRiskFree", { rate: `${run.input.riskFreePercent}%` })}</li>
                <li>
                  {t("compare.basisCalendar", { count: formatCount(view.commonWindow.sessions, locale) })}
                </li>
                <li>{t("compare.basisBeta", { symbol: BENCHMARK_SYMBOL })}</li>
                <li>{t("compare.basisNoAdvice")}</li>
              </ul>
            </section>

            <SharedWindowPanel view={view} locale={locale} t={t} />

            {benchmarkFailure ? (
              <section className={styles.errorPanel} aria-labelledby="compare-benchmark-error">
                <h2 id="compare-benchmark-error">
                  <TriangleAlert size={14} aria-hidden="true" /> {t("compare.benchmarkUnavailableTitle")}
                </h2>
                <p>{t("compare.benchmarkUnavailableBody", { symbol: BENCHMARK_SYMBOL })}</p>
                <p className={styles.benchmarkReason}>{failureText(benchmarkFailure, t)}</p>
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={() => void retryBenchmark()}
                  disabled={running}
                >
                  {t("compare.retrySymbol", { symbol: BENCHMARK_SYMBOL })}
                </button>
              </section>
            ) : null}

            <div className={styles.grid}>
              <div className={styles.mainColumn}>
                <section className={styles.panel} aria-labelledby="compare-chart-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="compare-chart-title">{t("compare.chartTitle")}</h2>
                      <p className={styles.panelSub}>
                        {t("compare.chartWindow", {
                          from: formatDate(view.commonWindow.startDate, locale),
                          to: formatDate(view.commonWindow.endDate, locale),
                          count: formatCount(view.commonWindow.sessions, locale),
                        })}
                      </p>
                    </div>
                  </header>

                  <div className={styles.tabs} role="tablist" aria-label={t("compare.chartTabsLabel")}>
                    {CHART_TABS.map((tab, index) => {
                      const selected = tab.id === chartTab;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`compare-tab-${tab.id}`}
                          aria-selected={selected}
                          aria-controls={`compare-panel-${tab.id}`}
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
                    {view.securities.map((security) => (
                      <span key={security.symbol} className={styles.legendItem}>
                        <i style={{ background: colorBySymbol.get(security.symbol) }} aria-hidden="true" />
                        <b className={styles.mono}>{security.symbol}</b>
                        <em>{security.name}</em>
                      </span>
                    ))}
                  </div>

                  <div
                    role="tabpanel"
                    id={`compare-panel-${chartTab}`}
                    aria-labelledby={`compare-tab-${chartTab}`}
                    tabIndex={0}
                    className={styles.tabPanel}
                  >
                    <ComparisonChart
                      data={chartTab === "cumulative" ? cumulativeData : dailyData}
                      symbols={view.securities.map((security) => security.symbol)}
                      colors={colorBySymbol}
                      locale={locale}
                      ariaLabel={t(
                        chartTab === "cumulative" ? "compare.chartCumulativeAria" : "compare.chartDailyAria",
                        { symbols: joinSymbols(view.narrative.symbols, locale) },
                      )}
                      emptyLabel={t(
                        chartTab === "cumulative" ? "compare.chartEmpty" : "compare.chartDailyEmpty",
                      )}
                      animate={!reduceMotion}
                    />
                    <p className={styles.caption}>
                      {t(
                        chartTab === "cumulative"
                          ? "compare.chartCumulativeCaption"
                          : "compare.chartDailyCaption",
                        { date: formatDate(view.commonWindow.startDate, locale) },
                      )}
                    </p>
                    <p className={styles.caption}>{t("compare.chartTextEquivalent")}</p>
                  </div>
                </section>

                <section className={styles.panel} aria-labelledby="compare-metrics-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="compare-metrics-title">{t("compare.metrics")}</h2>
                      <p className={styles.panelSub}>
                        {t("compare.metricsSub", { count: formatCount(view.commonWindow.sessions, locale) })}
                      </p>
                    </div>
                    <button type="button" className={styles.downloadButton} onClick={handleDownload}>
                      <Download size={13} aria-hidden="true" />
                      <span>{t("compare.download")}</span>
                    </button>
                  </header>

                  <MetricsTable view={view} colors={colorBySymbol} locale={locale} t={t} />

                  <p className={styles.footnote}>{t("compare.dashMeaning")}</p>
                  <p className={styles.footnote}>{t("compare.csvNote")}</p>
                </section>

                <section className={styles.panel} aria-labelledby="compare-correlation-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="compare-correlation-title">{t("compare.correlation")}</h2>
                      <p className={styles.panelSub}>{t("compare.correlationSub")}</p>
                    </div>
                  </header>
                  <CorrelationTable view={view} locale={locale} t={t} />
                  <p className={styles.footnote}>{t("compare.matrixDiagonalNote")}</p>
                </section>
              </div>

              <div className={styles.rail}>
                <section className={styles.panel} aria-labelledby="compare-summary-title">
                  <header className={styles.panelHead}>
                    <h2 id="compare-summary-title">{t("compare.summaryTitle")}</h2>
                  </header>
                  <NarrativeProse view={view} locale={locale} t={t} />
                </section>

                <section className={styles.panel} aria-labelledby="compare-explain-title">
                  <header className={styles.panelHead}>
                    <h2 id="compare-explain-title">{t("compare.explainTitle")}</h2>
                  </header>
                  <div className={styles.means}>
                    <p>{t("compare.explainWindow")}</p>
                    <p>{t("compare.explainTotalReturn")}</p>
                    <p>{t("compare.explainReturn")}</p>
                    <p>{t("compare.explainVolatility")}</p>
                    <p>{t("compare.explainSharpe")}</p>
                    <p>{t("compare.explainDrawdown")}</p>
                    <p>{t("compare.explainBeta", { symbol: BENCHMARK_SYMBOL })}</p>
                    <p>{t("compare.explainCorrelation")}</p>
                  </div>

                  <h3 className={styles.subhead}>{t("compare.limitationsTitle")}</h3>
                  <ul className={styles.limits}>
                    <li>{t("compare.limitDividends")}</li>
                    <li>{t("compare.limitWindow")}</li>
                    <li>{t("compare.limitClose")}</li>
                    <li>{t("compare.limitBenchmark", { symbol: BENCHMARK_SYMBOL })}</li>
                    <li>{t("compare.limitNotAdvice")}</li>
                  </ul>

                  <Link className={styles.methodLink} href="/methodology">
                    {t("compare.learnMore")}
                  </Link>
                </section>
              </div>
            </div>
          </>
        ) : running || failedSecurities.length > 0 || assembled?.failure ? null : (
          <p className={styles.emptyState}>{t("compare.awaitingRun")}</p>
        )}

        <ShellDisclaimer />
      </div>
    </AppShell>
  );
}

// --- Progress ---------------------------------------------------------------

/**
 * The load ledger: every request of the current run, in the order it was issued, with its own
 * status and its own failure text. It stays on screen after the run so a reader whose comparison
 * was blocked can see which securities did load and which one to fix.
 */
function LoadQueue({
  run,
  running,
  onRetrySecurity,
  t,
}: {
  run: RunState;
  running: boolean;
  onRetrySecurity: (symbol: string) => void;
  t: Translate;
}) {
  return (
    <section className={styles.progress} aria-label={t("compare.progressTitle")}>
      <ol aria-live="polite">
        {run.securities.map((load) => (
          <li key={load.symbol} className={stepClass(load.status)}>
            <b className={styles.mono}>{load.symbol}</b>
            <span>{statusLabel(load, t)}</span>
            {load.status === "error" ? (
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => onRetrySecurity(load.symbol)}
                disabled={running}
              >
                {t("compare.retrySymbol", { symbol: load.symbol })}
              </button>
            ) : null}
          </li>
        ))}
        <li className={stepClass(run.benchmark.status)}>
          <b className={styles.mono}>{run.benchmark.symbol}</b>
          <span>{statusLabel(run.benchmark, t, true)}</span>
        </li>
      </ol>
      <p>{t("compare.progressNote", { symbol: BENCHMARK_SYMBOL })}</p>
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
      return isBenchmark ? t("compare.stepBenchmarkQueued") : t("compare.stepQueued");
    case "loading":
      return t("compare.stepLoading");
    case "ready":
      return isBenchmark ? t("compare.stepBenchmarkReady") : t("compare.stepReady");
    case "reused":
      return t("compare.stepBenchmarkReused", { symbol: load.symbol });
    case "skipped":
      return t("compare.stepBenchmarkSkipped");
    case "error":
      return failureText(load, t);
  }
}

function failureText(failure: FailureMessage, t: Translate): string {
  if (failure.messageKey) return t(failure.messageKey);
  return failure.message ?? t("compare.errorUnknown");
}

/** The history each security actually returned, so a non-overlapping window can be diagnosed. */
function OwnHistoryList({
  securities,
  locale,
  t,
}: {
  securities: SymbolLoad[];
  locale: string;
  t: Translate;
}) {
  const loaded = securities.filter((load) => load.data && load.data.prices.length > 0);
  if (loaded.length === 0) return null;

  return (
    <ul className={styles.historyList}>
      {loaded.map((load) => {
        const prices = load.data!.prices;
        return (
          <li key={load.symbol}>
            <b className={styles.mono}>{load.symbol}</b>
            <span>
              {t("compare.ownHistory", {
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
 * The window every figure on the page was measured on, and why it is that long. A security whose
 * own history starts on the shared start date is named as a limit, because a later listing is the
 * usual reason a five-year request produces a shorter comparison.
 */
function SharedWindowPanel({
  view,
  locale,
  t,
}: {
  view: StockComparisonViewModel;
  locale: string;
  t: Translate;
}) {
  const { commonWindow } = view;
  const shortened = view.securities.filter((security) => security.suppliedBars > commonWindow.sessions);

  return (
    <section className={styles.window} aria-labelledby="compare-window-title">
      <h2 id="compare-window-title">{t("compare.windowTitle")}</h2>
      <p className={styles.windowRange}>
        {t("compare.windowRange", {
          from: formatDate(commonWindow.startDate, locale),
          to: formatDate(commonWindow.endDate, locale),
        })}
      </p>
      <p className={styles.windowSessions}>
        {t("compare.windowSessions", {
          count: formatCount(commonWindow.sessions, locale),
          years: commonWindow.years.toFixed(1),
        })}
      </p>

      <ul className={styles.windowReasons}>
        <li>
          {t("compare.windowStartLimited", {
            date: formatDate(commonWindow.startDate, locale),
            symbols: joinSymbols(commonWindow.startLimitedBy, locale),
          })}
        </li>
        <li>
          {t("compare.windowEndLimited", {
            date: formatDate(commonWindow.endDate, locale),
            symbols: joinSymbols(commonWindow.endLimitedBy, locale),
          })}
        </li>
        <li>
          {shortened.length > 0
            ? t("compare.windowShortened", {
                symbols: joinSymbols(
                  shortened.map((security) => security.symbol),
                  locale,
                ),
              })
            : t("compare.windowAligned", { count: formatCount(commonWindow.sessions, locale) })}
        </li>
      </ul>

      <ul className={styles.windowSecurities}>
        {view.securities.map((security) => {
          const dropped = security.suppliedBars - security.sessions;
          return (
            <li key={security.symbol}>
              <b className={styles.mono}>{security.symbol}</b>
              <span>
                {t("compare.windowSecurity", {
                  from: formatDate(security.suppliedFirstDate, locale),
                  to: formatDate(security.suppliedLastDate, locale),
                  supplied: formatCount(security.suppliedBars, locale),
                  used: formatCount(security.sessions, locale),
                })}
              </span>
              {dropped > 0 ? (
                <em>{t("compare.windowSecurityDropped", { count: formatCount(dropped, locale) })}</em>
              ) : (
                <em>{t("compare.windowSecurityComplete")}</em>
              )}
            </li>
          );
        })}
      </ul>

      {view.benchmark ? (
        <p className={styles.windowBenchmark}>
          {view.benchmark.coversCommonWindow
            ? t("compare.windowBenchmarkFull", {
                symbol: view.benchmark.symbol,
                count: formatCount(view.benchmark.overlappingSessions, locale),
              })
            : t("compare.windowBenchmarkPartial", {
                symbol: view.benchmark.symbol,
                count: formatCount(view.benchmark.overlappingSessions, locale),
                total: formatCount(commonWindow.sessions, locale),
              })}
        </p>
      ) : (
        <p className={styles.windowBenchmark}>
          {t("compare.windowBenchmarkMissing", { symbol: BENCHMARK_SYMBOL })}
        </p>
      )}
    </section>
  );
}

// --- Tables -----------------------------------------------------------------

function MetricsTable({
  view,
  colors,
  locale,
  t,
}: {
  view: StockComparisonViewModel;
  colors: Map<string, string>;
  locale: string;
  t: Translate;
}) {
  return (
    <>
      {/* The scroll region is named by text the reader can also see once the layout is compact,
          so the promise that it scrolls is not visible to assistive technology alone. */}
      <p className={styles.scrollLabel} id="compare-table-label">
        {t("compare.tableAria")}
      </p>
      <div
        className={styles.tableWrap}
        role="region"
        aria-labelledby="compare-table-label"
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>
            {t("compare.tableCaption", {
              from: formatDate(view.commonWindow.startDate, locale),
              to: formatDate(view.commonWindow.endDate, locale),
              count: formatCount(view.commonWindow.sessions, locale),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("result.ticker")}</th>
              <th scope="col">{t("compare.colCagr")}</th>
              <th scope="col">{t("compare.colTotalReturn")}</th>
              <th scope="col">{t("metric.volatility")}</th>
              <th scope="col">{t("metric.sharpe")}</th>
              <th scope="col">{t("result.maxDrawdown")}</th>
              <th scope="col">{t("compare.colBeta", { symbol: BENCHMARK_SYMBOL })}</th>
            </tr>
          </thead>
          <tbody>
            {view.securities.map((security) => (
              <tr key={security.symbol}>
                <th scope="row">
                  <span className={styles.monogram} aria-hidden="true">
                    {security.symbol.slice(0, 2)}
                  </span>
                  <span className={styles.rowIdentity}>
                    <b className={styles.mono} style={{ color: colors.get(security.symbol) }}>
                      {security.symbol}
                    </b>
                    <em>{security.name}</em>
                  </span>
                </th>
                <td>
                  <MetricCell
                    text={security.cagr === undefined ? undefined : formatSignedRate(security.cagr, locale)}
                    tone={
                      security.cagr === undefined ? undefined : security.cagr < 0 ? "negative" : "positive"
                    }
                    t={t}
                  />
                </td>
                <td>
                  <MetricCell
                    text={formatSignedRate(security.totalPriceReturn, locale)}
                    tone={security.totalPriceReturn < 0 ? "negative" : "positive"}
                    t={t}
                  />
                </td>
                <td>
                  <MetricCell
                    text={
                      security.volatility === undefined ? undefined : formatRate(security.volatility, locale)
                    }
                    t={t}
                  />
                </td>
                <td>
                  <MetricCell
                    text={
                      security.sharpeRatio === undefined
                        ? undefined
                        : formatRatio(security.sharpeRatio, locale)
                    }
                    t={t}
                  />
                </td>
                <td>
                  <MetricCell
                    text={formatRate(security.maxDrawdown.drawdown, locale)}
                    tone={security.maxDrawdown.drawdown < 0 ? "negative" : undefined}
                    detail={drawdownDetail(security, locale, t)}
                    t={t}
                  />
                </td>
                <td>
                  <MetricCell
                    text={security.beta === undefined ? undefined : formatRatio(security.beta, locale)}
                    detail={
                      security.beta === undefined && view.benchmark === undefined
                        ? t("compare.betaMissingDetail", { symbol: BENCHMARK_SYMBOL })
                        : undefined
                    }
                    t={t}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MetricCell({
  text,
  detail,
  tone,
  t,
}: {
  text?: string;
  detail?: string;
  tone?: "positive" | "negative";
  t: Translate;
}) {
  const toneClass = tone === "negative" ? styles.negative : tone === "positive" ? styles.positive : undefined;
  return (
    <>
      {text === undefined ? (
        <span className={styles.notAvailable}>
          —<span className={styles.visuallyHidden}>{t("compare.notAvailable")}</span>
        </span>
      ) : (
        <b className={toneClass}>{text}</b>
      )}
      {detail ? <em className={styles.cellDetail}>{detail}</em> : null}
    </>
  );
}

/** Peak, trough, and recovery dates behind the worst decline, or nothing when it never declined. */
function drawdownDetail(security: ComparedSecurity, locale: string, t: Translate): string | undefined {
  const { peakDate, troughDate, recoveryDate } = security.maxDrawdown;
  if (!peakDate || !troughDate) return undefined;
  const span = t("compare.drawdownDates", {
    peak: formatDate(peakDate, locale),
    trough: formatDate(troughDate, locale),
  });
  return recoveryDate
    ? `${span} · ${t("compare.drawdownRecovered", { date: formatDate(recoveryDate, locale) })}`
    : `${span} · ${t("compare.drawdownNotRecovered")}`;
}

/**
 * The symmetric correlation matrix. Every cell sits under a column header and beside a row header,
 * so assistive technology names both securities of the pair without the grid repeating itself.
 */
function CorrelationTable({
  view,
  locale,
  t,
}: {
  view: StockComparisonViewModel;
  locale: string;
  t: Translate;
}) {
  const { symbols, values } = view.correlations;

  return (
    <>
      {/* Named by visible text for the same reason as the metrics table above. */}
      <p className={styles.scrollLabel} id="compare-matrix-label">
        {t("compare.matrixAria")}
      </p>
      <div
        className={styles.tableWrap}
        role="region"
        aria-labelledby="compare-matrix-label"
        tabIndex={0}
      >
        <table className={styles.matrix}>
          <caption className={styles.visuallyHidden}>
            {t("compare.matrixCaption", {
              symbols: joinSymbols(symbols, locale),
              count: formatCount(view.commonWindow.sessions - 1, locale),
            })}
          </caption>
          <thead>
            <tr>
              <td>
                <span className={styles.visuallyHidden}>{t("compare.matrixCorner")}</span>
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
                          —<span className={styles.visuallyHidden}>{t("compare.notAvailable")}</span>
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

// --- Narrative --------------------------------------------------------------

/**
 * The neutral summary, built entirely from the domain narrative. It reports the highest past CAGR
 * and the lowest past volatility over the shared window and nothing else: no security is called
 * best, nothing is ranked overall, and nothing is recommended.
 */
function NarrativeProse({
  view,
  locale,
  t,
}: {
  view: StockComparisonViewModel;
  locale: string;
  t: Translate;
}) {
  const { narrative } = view;

  return (
    <div className={styles.narrative}>
      <p>
        {t("compare.narrativeWindow", {
          symbols: joinSymbols(narrative.symbols, locale),
          count: formatCount(narrative.sessions, locale),
          from: formatDate(narrative.startDate, locale),
          to: formatDate(narrative.endDate, locale),
        })}
      </p>

      {narrative.highestCagr ? (
        <p>{extremeSentence(narrative.highestCagr, "cagr", locale, t)}</p>
      ) : null}
      {narrative.lowestVolatility ? (
        <p>{extremeSentence(narrative.lowestVolatility, "volatility", locale, t)}</p>
      ) : null}

      <p className={styles.caveat}>{t("compare.narrativeNoBest")}</p>

      <ul className={styles.notes}>
        {narrative.notes.map((note) => (
          <li key={note}>{t(NOTE_KEYS[note], { symbol: BENCHMARK_SYMBOL })}</li>
        ))}
      </ul>
    </div>
  );
}

function extremeSentence(
  extreme: ComparisonExtreme,
  metric: "cagr" | "volatility",
  locale: string,
  t: Translate,
): string {
  const value = metric === "cagr" ? formatSignedRate(extreme.value, locale) : formatRate(extreme.value, locale);
  if (extreme.tiedSymbols.length > 1) {
    return t(metric === "cagr" ? "compare.narrativeCagrTie" : "compare.narrativeVolatilityTie", {
      symbols: joinSymbols(extreme.tiedSymbols, locale),
      value,
    });
  }
  return t(metric === "cagr" ? "compare.narrativeCagr" : "compare.narrativeVolatility", {
    symbol: extreme.symbol,
    value,
  });
}

// --- Chart ------------------------------------------------------------------

const AXIS_TICK = { fill: "#787b86", fontSize: 10 };
const GRID_STROKE = "rgba(120, 123, 134, 0.15)";
const AXIS_LINE = { stroke: "rgba(120, 123, 134, 0.28)" };
const CURSOR = { stroke: "rgba(91, 140, 255, 0.52)", strokeDasharray: "3 4" };

function ComparisonChart({
  data,
  symbols,
  colors,
  locale,
  ariaLabel,
  emptyLabel,
  animate,
}: {
  data: Array<Record<string, number | string>>;
  symbols: string[];
  colors: Map<string, string>;
  locale: string;
  ariaLabel: string;
  emptyLabel: string;
  animate: boolean;
}) {
  if (data.length < 2) return <p className={styles.emptyState}>{emptyLabel}</p>;

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
            width={56}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickFormatter={(value: number) => `${value.toFixed(0)}%`}
          />
          <ReferenceLine y={0} stroke="rgba(120, 123, 134, 0.45)" strokeDasharray="3 4" />
          <Tooltip cursor={CURSOR} content={<ChartTooltip locale={locale} colors={colors} />} />
          {symbols.map((symbol) => (
            <Line
              key={symbol}
              type="monotone"
              dataKey={symbol}
              stroke={colors.get(symbol) ?? FALLBACK_COLOR}
              strokeWidth={1.6}
              dot={false}
              connectNulls={false}
              isAnimationActive={animate}
              animationDuration={700}
              activeDot={{ r: 3, strokeWidth: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Prints the hovered date and one labelled row per security that reported a value on that date. */
function ChartTooltip({
  active,
  payload,
  label,
  locale,
  colors,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | null }>;
  label?: string;
  locale: string;
  colors: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((entry) => typeof entry.value === "number");
  if (rows.length === 0) return null;

  return (
    <div className={styles.tooltip}>
      <strong>{label ? formatDate(label, locale) : ""}</strong>
      {[...rows]
        .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
        .map((entry) => {
          const symbol = String(entry.dataKey);
          return (
            <span key={symbol}>
              <i style={{ background: colors.get(symbol) ?? FALLBACK_COLOR }} aria-hidden="true" />
              <em className={styles.mono}>{symbol}</em>
              <b>{formatSignedPercentPoints(entry.value as number, locale)}</b>
            </span>
          );
        })}
    </div>
  );
}

// --- CSV export -------------------------------------------------------------

/**
 * Builds the CSV text from the rendered view model. Numbers are written as plain decimal
 * fractions with a dot separator so the file stays machine-readable in every locale, and a metric
 * the window could not support is written as an empty cell rather than a zero.
 */
function buildCsv(view: StockComparisonViewModel, input: ComparisonInput, t: Translate): string {
  const rows: string[][] = [
    [t("compare.csvTitle")],
    [t("compare.csvWindowStart"), view.commonWindow.startDate],
    [t("compare.csvWindowEnd"), view.commonWindow.endDate],
    [t("compare.csvSessions"), String(view.commonWindow.sessions)],
    [t("compare.csvRiskFree"), `${input.riskFreePercent}%`],
    [t("compare.csvBenchmark"), view.benchmark ? view.benchmark.symbol : t("compare.csvNone")],
    [t("compare.csvRequestedWindow"), `${input.startDate} / ${input.endDate}`],
    [t("compare.csvBasis"), t("compare.csvBasisText")],
    [t("compare.csvEmptyCells"), t("compare.csvEmptyCellsText")],
    [],
    [t("compare.metrics")],
    [
      t("result.ticker"),
      t("compare.csvName"),
      t("compare.csvSessionsUsed"),
      t("compare.csvOwnSessions"),
      t("compare.csvOwnFirst"),
      t("compare.csvOwnLast"),
      t("compare.csvFirstClose"),
      t("compare.csvLastClose"),
      t("compare.csvTotalReturn"),
      t("compare.csvCagr"),
      t("compare.csvVolatility"),
      t("compare.csvSharpe"),
      t("compare.csvMaxDrawdown"),
      t("compare.csvPeakDate"),
      t("compare.csvTroughDate"),
      t("compare.csvRecoveryDate"),
      t("compare.csvBeta"),
    ],
  ];

  for (const security of view.securities) {
    rows.push([
      security.symbol,
      security.name,
      String(security.sessions),
      String(security.suppliedBars),
      security.suppliedFirstDate,
      security.suppliedLastDate,
      decimal(security.firstClose, 4),
      decimal(security.lastClose, 4),
      decimal(security.totalPriceReturn, 6),
      decimal(security.cagr, 6),
      decimal(security.volatility, 6),
      decimal(security.sharpeRatio, 4),
      decimal(security.maxDrawdown.drawdown, 6),
      security.maxDrawdown.peakDate ?? "",
      security.maxDrawdown.troughDate ?? "",
      security.maxDrawdown.recoveryDate ?? "",
      decimal(security.beta, 4),
    ]);
  }

  rows.push([], [t("compare.correlation")], ["", ...view.correlations.symbols]);
  view.correlations.symbols.forEach((symbol, row) => {
    rows.push([
      symbol,
      ...view.correlations.symbols.map((_, column) => decimal(view.correlations.values[row]?.[column], 6)),
    ]);
  });

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function decimal(value: number | undefined, digits: number): string {
  return value === undefined || !Number.isFinite(value) ? "" : value.toFixed(digits);
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvFilename(view: StockComparisonViewModel): string {
  const tickers = view.securities
    .map((security) => security.symbol.replace(/[^A-Z0-9]/g, ""))
    .join("-");
  return `investiq-comparison_${tickers}_${view.commonWindow.startDate}_${view.commonWindow.endDate}.csv`;
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

/** Already-scaled percentage points from a chart series, kept out of the percent style. */
function formatSignedPercentPoints(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value)}%`;
}

function formatRatio(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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
