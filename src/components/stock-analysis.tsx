"use client";

// Purpose: Stock Analysis workspace — one US stock or ETF's price history, risk figures,
// benchmark relationship, corporate actions, and a beginner explanation of what they mean.
//
// Honesty rules this file follows:
// - Every metric comes from `buildStockAnalysis`. Nothing is recalculated here, and a figure the
//   window cannot support renders as an em dash with a stated reason, never as zero or a guess.
// - Only closing prices are read, so every return shown is a price return. Dividends are listed
//   as cash events and are never reinvested into any figure on this page. The page says both.
// - The asset loads first and the SPY benchmark second, sequentially. A failed benchmark leaves
//   the asset result intact and labels beta and correlation unavailable with the benchmark error.
// - The Sharpe ratio uses exactly the risk-free rate the reader typed. No rate feed is read.
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
import { Info, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell, ShellDisclaimer } from "@/components/app-shell";
import { AnalyticsError } from "@/domain/analytics";
import { isValidSymbol, normalizeSymbol } from "@/domain/market-overview";
import {
  VOLUME_AVERAGE_WINDOW,
  buildStockAnalysis,
  describeDrawdownScenario,
  type StockAnalysisViewModel,
} from "@/domain/stock-analysis";
import { loadAnalysisMarketData } from "@/services/analysis-market-data";
import { MarketDataError } from "@/services/market-data-api";
import { type Translate, type TranslationKey, useLanguage } from "@/i18n/language";
import type { DateString, DividendEvent, MarketData, SplitEvent } from "@/types/backtest";
import { daysBetween } from "@/utils/date";

import styles from "./stock-analysis.module.css";

/** Benchmark for beta and correlation. An investable ETF, not the index itself. */
const BENCHMARK_SYMBOL = "SPY";

/** Opening example, so the workspace shows real output instead of an empty form. */
const EXAMPLE_TICKER = "AAPL";

/** Trailing window of the opening example, in years. */
const EXAMPLE_YEARS = 5;

/** Default annual risk-free rate, in percent. Always shown and always editable. */
const DEFAULT_RISK_FREE_PERCENT = "0.0";

/** Accepted range for the typed annual risk-free rate, in percent. */
const RISK_FREE_PERCENT_LIMIT = 25;

/** Earliest start date offered, matching the rest of the product. */
const EARLIEST_START_DATE = "1990-01-01";

/** Shortest window that can produce daily returns worth reading, in calendar days. */
const MIN_WINDOW_DAYS = 30;

/** Hypothetical amount the drawdown scenario restates. */
const SCENARIO_AMOUNT = 10_000;

/** How many corporate-action events are listed per kind. */
const RECENT_EVENT_LIMIT = 5;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CLOSE_COLOR = "#5b8cff";
const MA_COLORS: Record<number, string> = { 50: "#f2b636", 200: "#c084fc" };
const VOLUME_COLOR = "#4b6a91";
const GAIN_COLOR = "#089981";
const LOSS_COLOR = "#f23645";

type ChartTab = "price" | "cumulative" | "daily" | "volume";

const CHART_TABS: Array<{ id: ChartTab; labelKey: TranslationKey }> = [
  { id: "price", labelKey: "stock.tabPrice" },
  { id: "cumulative", labelKey: "stock.tabCumulative" },
  { id: "daily", labelKey: "stock.tabDaily" },
  { id: "volume", labelKey: "stock.tabVolume" },
];

/** Which sequential request the page is waiting on, if any. */
type Phase = "idle" | "asset" | "benchmark" | "ready";

type FieldKey = "ticker" | "startDate" | "endDate" | "riskFree";

interface FormState {
  ticker: string;
  startDate: string;
  endDate: string;
  riskFreePercent: string;
}

/** A validated, normalized run request. */
interface AnalysisInput {
  ticker: string;
  startDate: DateString;
  endDate: DateString;
  /** Decimal fraction, as the domain requires; the form collects percent. */
  annualRiskFreeRate: number;
  /** The percent string the reader typed, echoed back verbatim in the copy. */
  riskFreePercent: string;
}

interface FieldError {
  field: FieldKey;
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
}

/**
 * A failure message that is either already human-readable (produced by the service) or a
 * catalog key. Keys stay unresolved until render so switching language re-translates them
 * instead of freezing English text into state.
 */
interface FailureMessage {
  message?: string;
  messageKey?: TranslationKey;
}

interface AnalysisResult {
  input: AnalysisInput;
  /** Asset data exactly as the service returned it; the source of the plotted closes. */
  marketData: MarketData;
  view: StockAnalysisViewModel;
  /** True when the analyzed symbol is the benchmark, so beta and correlation are 1 by identity. */
  benchmarkIsSelf: boolean;
  /** Set when the benchmark request failed; the asset figures stay valid alongside it. */
  benchmarkError?: FailureMessage;
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
 * Client-side gate on the form. It rejects only what is certainly wrong — an unusable ticker,
 * a malformed or out-of-range date, an inverted or too-short window, an unusable rate — so the
 * service is never asked a question that cannot have an answer.
 */
function validateForm(form: FormState, today: DateString): { errors: FieldError[]; input?: AnalysisInput } {
  const errors: FieldError[] = [];
  const ticker = normalizeSymbol(form.ticker);
  const { startDate, endDate } = form;

  if (!isValidSymbol(ticker)) {
    errors.push({ field: "ticker", messageKey: "validation.ticker" });
  }
  if (!ISO_DATE_PATTERN.test(startDate) || startDate < EARLIEST_START_DATE) {
    errors.push({ field: "startDate", messageKey: "validation.startDate" });
  }
  if (!ISO_DATE_PATTERN.test(endDate)) {
    errors.push({ field: "endDate", messageKey: "validation.endDate" });
  } else if (endDate > today) {
    errors.push({ field: "endDate", messageKey: "stock.validationFutureEnd" });
  }

  const datesUsable = errors.every((error) => error.field !== "startDate" && error.field !== "endDate");
  if (datesUsable) {
    if (startDate > endDate) {
      errors.push({ field: "startDate", messageKey: "validation.startBeforeEnd" });
    } else if (daysBetween(startDate, endDate) < MIN_WINDOW_DAYS) {
      errors.push({
        field: "endDate",
        messageKey: "stock.validationRangeTooShort",
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
      messageKey: "stock.validationRiskFree",
      params: { max: RISK_FREE_PERCENT_LIMIT },
    });
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    input: {
      ticker,
      startDate,
      endDate,
      annualRiskFreeRate: percent / 100,
      riskFreePercent: form.riskFreePercent.trim(),
    },
  };
}

function movingAverageKey(window: number): string {
  return `ma${window}`;
}

/** The benchmark's own failure text, preferring the service's message over a generic key. */
function benchmarkFailure(outcome: { error?: string; errorKey?: TranslationKey }): FailureMessage {
  if (outcome.error) return { message: outcome.error };
  return { messageKey: outcome.errorKey ?? "stock.errorUnknown" };
}

/** Loads one symbol's window, returning either data or an already-readable message. */
async function loadSymbol(
  ticker: string,
  startDate: DateString,
  endDate: DateString,
): Promise<{ data?: MarketData; error?: string; errorKey?: TranslationKey }> {
  try {
    return {
      data: await loadAnalysisMarketData({
        ticker,
        from: startDate,
        to: endDate,
        requiredStart: startDate,
      }),
    };
  } catch (error) {
    if (error instanceof MarketDataError) return { error: error.message };
    return { errorKey: "stock.errorUnknown" };
  }
}

// --- Workspace --------------------------------------------------------------

export function StockAnalysis() {
  const { locale, t } = useLanguage();
  const reduceMotion = useReducedMotion();

  const [form, setForm] = useState<FormState>({
    ticker: EXAMPLE_TICKER,
    startDate: "",
    endDate: "",
    riskFreePercent: DEFAULT_RISK_FREE_PERCENT,
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<AnalysisResult>();
  const [loadError, setLoadError] = useState<FailureMessage>();
  const [loadedAt, setLoadedAt] = useState<Date>();
  const [chartTab, setChartTab] = useState<ChartTab>("price");
  // The inputs the visible result was built from, so Retry repeats that exact request. This is
  // state rather than a ref because the status line and the progress steps name its ticker
  // while a run is in flight, and render must never read a ref.
  const [lastInput, setLastInput] = useState<AnalysisInput>();

  // Supersedes an in-flight sequence: every await re-checks the token before writing state.
  const runIdRef = useRef(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const isLoading = phase === "asset" || phase === "benchmark";

  const runAnalysis = useCallback(async (input: AnalysisInput) => {
    const runId = ++runIdRef.current;
    setLastInput(input);
    setLoadError(undefined);
    setResult(undefined);
    setLoadedAt(undefined);
    setPhase("asset");

    const asset = await loadSymbol(input.ticker, input.startDate, input.endDate);
    if (runIdRef.current !== runId) return;
    if (!asset.data) {
      setLoadError({ message: asset.error, messageKey: asset.errorKey ?? (asset.error ? undefined : "stock.errorUnknown") });
      setPhase("idle");
      return;
    }

    const marketData = asset.data;
    let view: StockAnalysisViewModel;
    try {
      view = buildStockAnalysis({ marketData, annualRiskFreeRate: input.annualRiskFreeRate });
    } catch (error) {
      setLoadError({ messageKey: error instanceof AnalyticsError ? "stock.errorSeries" : "stock.errorUnknown" });
      setPhase("idle");
      return;
    }

    // The benchmark is its own asset: reuse the loaded series instead of asking twice.
    if (input.ticker === BENCHMARK_SYMBOL) {
      try {
        setResult({
          input,
          marketData,
          view: buildStockAnalysis({
            marketData,
            benchmark: marketData,
            annualRiskFreeRate: input.annualRiskFreeRate,
          }),
          benchmarkIsSelf: true,
        });
      } catch {
        setResult({ input, marketData, view, benchmarkIsSelf: true });
      }
      setPhase("ready");
      setLoadedAt(new Date());
      return;
    }

    // The asset result is published before the benchmark request starts, so a benchmark
    // failure can never remove figures that were already calculated successfully.
    setResult({ input, marketData, view, benchmarkIsSelf: false });
    setPhase("benchmark");

    const benchmark = await loadSymbol(BENCHMARK_SYMBOL, input.startDate, input.endDate);
    if (runIdRef.current !== runId) return;

    if (!benchmark.data) {
      setResult({
        input,
        marketData,
        view,
        benchmarkIsSelf: false,
        benchmarkError: benchmarkFailure(benchmark),
      });
      setPhase("ready");
      setLoadedAt(new Date());
      return;
    }

    try {
      setResult({
        input,
        marketData,
        view: buildStockAnalysis({
          marketData,
          benchmark: benchmark.data,
          annualRiskFreeRate: input.annualRiskFreeRate,
        }),
        benchmarkIsSelf: false,
      });
    } catch (error) {
      setResult({
        input,
        marketData,
        view,
        benchmarkIsSelf: false,
        benchmarkError: {
          messageKey: error instanceof AnalyticsError ? "stock.errorBenchmarkSeries" : "stock.errorUnknown",
        },
      });
    }
    setPhase("ready");
    setLoadedAt(new Date());
  }, []);

  /** Retries only the benchmark leg, keeping the asset figures already on screen. */
  const retryBenchmark = useCallback(async () => {
    const current = result;
    if (!current || current.benchmarkIsSelf) return;
    const runId = ++runIdRef.current;
    setPhase("benchmark");

    const benchmark = await loadSymbol(BENCHMARK_SYMBOL, current.input.startDate, current.input.endDate);
    if (runIdRef.current !== runId) return;

    if (!benchmark.data) {
      setResult({ ...current, benchmarkError: benchmarkFailure(benchmark) });
    } else {
      try {
        setResult({
          input: current.input,
          marketData: current.marketData,
          view: buildStockAnalysis({
            marketData: current.marketData,
            benchmark: benchmark.data,
            annualRiskFreeRate: current.input.annualRiskFreeRate,
          }),
          benchmarkIsSelf: false,
        });
      } catch (error) {
        setResult({
          ...current,
          benchmarkError: {
            messageKey: error instanceof AnalyticsError ? "stock.errorBenchmarkSeries" : "stock.errorUnknown",
          },
        });
      }
    }
    setPhase("ready");
    setLoadedAt(new Date());
  }, [result]);

  // The example window depends on today's date, so it is filled in after mount: the server and
  // the client render the same empty inputs, and the first run starts once hydration is done.
  useEffect(() => {
    const timer = setTimeout(() => {
      const range = trailingRange(new Date(), EXAMPLE_YEARS);
      const example: FormState = {
        ticker: EXAMPLE_TICKER,
        startDate: range.startDate,
        endDate: range.endDate,
        riskFreePercent: DEFAULT_RISK_FREE_PERCENT,
      };
      setForm(example);
      const { input } = validateForm(example, range.endDate);
      if (input) void runAnalysis(input);
    }, 0);
    return () => clearTimeout(timer);
  }, [runAnalysis]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const today = isoDate(new Date());
    const { errors: found, input } = validateForm(form, today);
    setErrors(found);
    if (input) void runAnalysis(input);
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

  const errorFor = (field: FieldKey) => errors.find((error) => error.field === field);

  const view = result?.view;
  // Analysis mode never requests dividend history, so an empty dividend list is
  // "not loaded", not a verified zero. Presenting it as "0 dividends paid" would be
  // a false factual claim, so the count and list switch to an explicit not-loaded state.
  const dividendsNotLoaded = result?.marketData.provenance.dividendCoverage === "not-requested";

  const priceData = useMemo(() => {
    if (!result) return [];
    const averages = result.view.movingAverages.map((series) => ({
      key: movingAverageKey(series.window),
      byDate: new Map(series.points.map((point) => [point.date, point.value])),
    }));
    return result.marketData.prices.map((bar) => {
      const row: Record<string, number | string | null> = { date: bar.date, close: bar.close };
      for (const average of averages) row[average.key] = average.byDate.get(bar.date) ?? null;
      return row;
    });
  }, [result]);

  const cumulativeData = useMemo(
    () => (view ? view.cumulativeReturns.map((point) => ({ date: point.date, value: point.value * 100 })) : []),
    [view],
  );

  const dailyData = useMemo(
    () =>
      view
        ? view.dailyReturns.map((point) => ({
            date: point.date,
            gain: point.value >= 0 ? point.value * 100 : null,
            loss: point.value < 0 ? point.value * 100 : null,
          }))
        : [],
    [view],
  );

  const volumeData = useMemo(
    () => (view ? view.volume.points.map((point) => ({ date: point.date, volume: point.value })) : []),
    [view],
  );

  const events = useMemo(() => {
    if (!result) return { dividends: [] as DividendEvent[], splits: [] as SplitEvent[] };
    const { firstDate, lastDate } = result.view.history;
    return {
      dividends: result.marketData.dividends
        .filter((event) => !event.projected && event.exDate >= firstDate && event.exDate <= lastDate)
        .slice(-RECENT_EVENT_LIMIT)
        .reverse(),
      splits: result.marketData.splits
        .filter((event) => event.executionDate >= firstDate && event.executionDate <= lastDate)
        .slice(-RECENT_EVENT_LIMIT)
        .reverse(),
    };
  }, [result]);

  const scenario = useMemo(() => {
    if (!view) return undefined;
    const { drawdown } = view.maxDrawdown;
    if (!Number.isFinite(drawdown) || drawdown > 0 || drawdown <= -1) return undefined;
    try {
      return describeDrawdownScenario(view.maxDrawdown, SCENARIO_AMOUNT);
    } catch {
      return undefined;
    }
  }, [view]);

  const statusText = isLoading
    ? phase === "asset"
      ? t("stock.statusLoadingAsset", { symbol: lastInput?.ticker ?? form.ticker })
      : t("stock.statusLoadingBenchmark", { symbol: BENCHMARK_SYMBOL })
    : loadedAt
      ? t("stock.statusReady", { time: formatTimestamp(loadedAt, locale) })
      : t("stock.statusIdle");

  return (
    <AppShell
      status={
        <p className={styles.statusLine} role="status" aria-live="polite">
          <i className={isLoading ? styles.statusDotLoading : styles.statusDot} aria-hidden="true" />
          {statusText}
        </p>
      }
      actions={
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => {
            if (lastInput) void runAnalysis(lastInput);
          }}
          disabled={isLoading || !lastInput}
        >
          <RefreshCw size={13} aria-hidden="true" className={isLoading ? styles.spin : undefined} />
          <span>{isLoading ? t("stock.reloading") : t("stock.reload")}</span>
        </button>
      }
    >
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1>{t("stock.title")}</h1>
          <p className={styles.subtitle}>{t("stock.subtitle")}</p>
        </div>

        {result?.marketData.source === "demo" ? (
          <section className={styles.demoNotice} aria-label={t("analysisDemo.title")}>
            <strong>{t("analysisDemo.title")}</strong>
            <p>{t("analysisDemo.body")}</p>
          </section>
        ) : null}

        <form className={styles.controls} onSubmit={handleSubmit} aria-label={t("stock.controlsTitle")}>
          <div className={styles.controlField}>
            <label htmlFor="stock-ticker">{t("stock.tickerLabel")}</label>
            <input
              id="stock-ticker"
              className={`${styles.control} ${styles.mono}`}
              value={form.ticker}
              onChange={(event) => updateField("ticker", event.target.value)}
              placeholder={t("stock.tickerPlaceholder")}
              maxLength={12}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errorFor("ticker") ? true : undefined}
              aria-describedby={errorFor("ticker") ? "stock-ticker-error" : undefined}
            />
            {errorFor("ticker") ? (
              <p className={styles.fieldError} id="stock-ticker-error">
                {t(errorFor("ticker")!.messageKey, errorFor("ticker")!.params)}
              </p>
            ) : null}
          </div>

          <div className={styles.controlField}>
            <label htmlFor="stock-start">{t("date.start")}</label>
            <input
              id="stock-start"
              type="date"
              className={styles.control}
              value={form.startDate}
              min={EARLIEST_START_DATE}
              onChange={(event) => updateField("startDate", event.target.value)}
              aria-invalid={errorFor("startDate") ? true : undefined}
              aria-describedby={errorFor("startDate") ? "stock-start-error" : undefined}
            />
            {errorFor("startDate") ? (
              <p className={styles.fieldError} id="stock-start-error">
                {t(errorFor("startDate")!.messageKey, errorFor("startDate")!.params)}
              </p>
            ) : null}
          </div>

          <div className={styles.controlField}>
            <label htmlFor="stock-end">{t("date.end")}</label>
            <input
              id="stock-end"
              type="date"
              className={styles.control}
              value={form.endDate}
              min={EARLIEST_START_DATE}
              onChange={(event) => updateField("endDate", event.target.value)}
              aria-invalid={errorFor("endDate") ? true : undefined}
              aria-describedby={errorFor("endDate") ? "stock-end-error" : undefined}
            />
            {errorFor("endDate") ? (
              <p className={styles.fieldError} id="stock-end-error">
                {t(errorFor("endDate")!.messageKey, errorFor("endDate")!.params)}
              </p>
            ) : null}
          </div>

          <div className={styles.controlField}>
            <label htmlFor="stock-risk-free">{t("stock.riskFreeLabel")}</label>
            <input
              id="stock-risk-free"
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
                errorFor("riskFree") ? "stock-risk-free-error stock-risk-free-hint" : "stock-risk-free-hint"
              }
            />
            {errorFor("riskFree") ? (
              <p className={styles.fieldError} id="stock-risk-free-error">
                {t(errorFor("riskFree")!.messageKey, errorFor("riskFree")!.params)}
              </p>
            ) : null}
          </div>

          <button type="submit" className={styles.analyzeButton} disabled={isLoading}>
            <Play size={13} aria-hidden="true" />
            <span>{isLoading ? t("stock.analyzing") : t("stock.analyze")}</span>
          </button>

          <p className={styles.controlHint} id="stock-risk-free-hint">
            {t("stock.riskFreeHint")}
          </p>
        </form>

        {errors.length > 0 ? (
          <p className={styles.formAlert} role="alert">
            {t("stock.validationFix")}
          </p>
        ) : null}

        {isLoading ? (
          <section className={styles.progress} aria-label={t("stock.progressTitle")}>
            <ol>
              <li className={phase === "asset" ? styles.stepActive : styles.stepDone}>
                {phase === "asset"
                  ? t("stock.stepAssetLoading", { symbol: lastInput?.ticker ?? form.ticker })
                  : t("stock.stepAssetDone", { symbol: lastInput?.ticker ?? form.ticker })}
              </li>
              <li className={phase === "benchmark" ? styles.stepActive : styles.stepPending}>
                {phase === "benchmark"
                  ? t("stock.stepBenchmarkLoading", { symbol: BENCHMARK_SYMBOL })
                  : t("stock.stepBenchmarkQueued", { symbol: BENCHMARK_SYMBOL })}
              </li>
            </ol>
            <p>{t("stock.progressNote")}</p>
          </section>
        ) : null}

        {loadError ? (
          <section className={styles.errorPanel} aria-labelledby="stock-error-title">
            <h2 id="stock-error-title">
              <TriangleAlert size={14} aria-hidden="true" /> {t("stock.errorTitle")}
            </h2>
            <p>{loadError.messageKey ? t(loadError.messageKey) : loadError.message}</p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => {
                if (lastInput) void runAnalysis(lastInput);
              }}
              disabled={isLoading}
            >
              {t("stock.retry")}
            </button>
          </section>
        ) : null}

        {result && view ? (
          <>
            <section className={styles.identity} aria-label={t("stock.identityAria")}>
              <span className={styles.monogram} aria-hidden="true">
                {view.ticker.slice(0, 2)}
              </span>
              <div className={styles.identityText}>
                <div className={styles.identityTop}>
                  <b className={styles.mono}>{view.ticker}</b>
                  <span className={styles.identityName}>{view.name}</span>
                </div>
                <div className={styles.identityMeta}>
                  <span>{assetTypeLabel(result.marketData.type, t)}</span>
                  <span className={styles.mono}>{view.currency}</span>
                  <span>{t("stock.endOfDay")}</span>
                </div>
              </div>
              <dl className={styles.identityFigures}>
                <div>
                  <dt>{t("stock.latestClose")}</dt>
                  <dd className={styles.latestClose}>{formatPrice(view.latestClose, view.currency, locale)}</dd>
                  <p>{t("stock.asOf", { date: formatDate(view.latestDate, locale) })}</p>
                </div>
                <div>
                  <dt>{t("metric.availableHistory")}</dt>
                  <dd>
                    {t("stock.historyRange", {
                      from: formatDate(view.history.firstDate, locale),
                      to: formatDate(view.history.lastDate, locale),
                    })}
                  </dd>
                  <p>
                    {t("stock.historyDetail", {
                      count: formatCount(view.history.barCount, locale),
                      years: view.history.years.toFixed(1),
                    })}
                  </p>
                </div>
              </dl>
            </section>

            <section className={styles.basis} aria-labelledby="stock-basis-title">
              <h2 id="stock-basis-title">
                <Info size={13} aria-hidden="true" /> {t("stock.basisTitle")}
              </h2>
              <ul>
                <li>{t("stock.basisSplitAdjusted")}</li>
                <li>{t("stock.basisPriceReturnOnly")}</li>
                <li>{t("stock.basisRiskFree", { rate: formatRiskFree(result.input) })}</li>
              </ul>
            </section>

            <div className={styles.grid}>
              <div className={styles.mainColumn}>
                <section className={styles.panel} aria-labelledby="stock-chart-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="stock-chart-title">{t("stock.performance")}</h2>
                      <p className={styles.panelSub}>
                        {t("stock.chartWindow", {
                          from: formatDate(view.history.firstDate, locale),
                          to: formatDate(view.history.lastDate, locale),
                        })}
                      </p>
                    </div>
                  </header>

                  <div className={styles.tabs} role="tablist" aria-label={t("stock.chartTabsLabel")}>
                    {CHART_TABS.map((tab, index) => {
                      const selected = tab.id === chartTab;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          id={`stock-tab-${tab.id}`}
                          aria-selected={selected}
                          aria-controls={`stock-panel-${tab.id}`}
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

                  <div
                    role="tabpanel"
                    id={`stock-panel-${chartTab}`}
                    aria-labelledby={`stock-tab-${chartTab}`}
                    tabIndex={0}
                    className={styles.tabPanel}
                  >
                    {chartTab === "price" ? (
                      <PriceChart
                        data={priceData}
                        view={view}
                        locale={locale}
                        t={t}
                        animate={!reduceMotion}
                      />
                    ) : null}
                    {chartTab === "cumulative" ? (
                      <CumulativeChart data={cumulativeData} locale={locale} t={t} animate={!reduceMotion} />
                    ) : null}
                    {chartTab === "daily" ? (
                      <DailyReturnChart data={dailyData} locale={locale} t={t} animate={!reduceMotion} />
                    ) : null}
                    {chartTab === "volume" ? (
                      <VolumeChart
                        data={volumeData}
                        view={view}
                        locale={locale}
                        t={t}
                        animate={!reduceMotion}
                      />
                    ) : null}
                  </div>
                </section>

                <section className={styles.panel} aria-labelledby="stock-actions-title">
                  <header className={styles.panelHead}>
                    <div>
                      <h2 id="stock-actions-title">{t("stock.actions")}</h2>
                      <p className={styles.panelSub}>
                        {t("stock.eventsWindowNote", {
                          from: formatDate(view.history.firstDate, locale),
                          to: formatDate(view.history.lastDate, locale),
                        })}
                      </p>
                    </div>
                  </header>

                  <dl className={styles.countRows}>
                    <div>
                      <dt>{t("stock.dividendCount")}</dt>
                      <dd className={styles.mono}>
                        {dividendsNotLoaded ? (
                          <span className={styles.notAvailable}>
                            —<span className={styles.visuallyHidden}>{t("stock.notAvailable")}</span>
                          </span>
                        ) : (
                          formatCount(view.dividendCount, locale)
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("stock.splitCount")}</dt>
                      <dd className={styles.mono}>{formatCount(view.splitCount, locale)}</dd>
                    </div>
                  </dl>

                  {dividendsNotLoaded ? null : (
                    <p className={styles.actionNote}>{t("stock.dividendsNotReinvested")}</p>
                  )}
                  <p className={styles.actionNote}>{t("stock.splitsAdjusted")}</p>

                  <div className={styles.eventLists}>
                    <div>
                      <h3>{t("stock.recentDividends")}</h3>
                      {dividendsNotLoaded ? (
                        <p className={styles.emptyState}>{t("stock.dividendsNotLoaded")}</p>
                      ) : events.dividends.length > 0 ? (
                        <>
                          <ul className={styles.eventList}>
                            {events.dividends.map((event) => (
                              <li key={event.id}>
                                <b className={styles.mono}>
                                  {formatPrice(event.splitAdjustedCashAmount, view.currency, locale, 4)}
                                </b>
                                <span>
                                  {t("stock.dividendDates", {
                                    ex: formatDate(event.exDate, locale),
                                    pay: formatDate(event.payDate, locale),
                                  })}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {view.dividendCount > events.dividends.length ? (
                            <p className={styles.eventNote}>
                              {t("stock.showingRecent", { count: events.dividends.length })}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className={styles.emptyState}>{t("stock.noDividends")}</p>
                      )}
                    </div>
                    <div>
                      <h3>{t("stock.recentSplits")}</h3>
                      {events.splits.length > 0 ? (
                        <>
                          <ul className={styles.eventList}>
                            {events.splits.map((event) => (
                              <li key={event.id}>
                                <b className={styles.mono}>
                                  {t("stock.splitRatio", { to: event.splitTo, from: event.splitFrom })}
                                </b>
                                <span>
                                  {t(event.splitTo >= event.splitFrom ? "stock.splitForward" : "stock.splitReverse")}
                                  {" · "}
                                  {formatDate(event.executionDate, locale)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {view.splitCount > events.splits.length ? (
                            <p className={styles.eventNote}>
                              {t("stock.showingRecent", { count: events.splits.length })}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className={styles.emptyState}>{t("stock.noSplits")}</p>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <div className={styles.rail}>
                <section className={styles.panel} aria-labelledby="stock-metrics-title">
                  <header className={styles.panelHead}>
                    <h2 id="stock-metrics-title">{t("stock.metrics")}</h2>
                  </header>

                  <dl className={styles.metricRows}>
                    <MetricRow
                      label={t("stock.priceReturnLabel")}
                      value={formatSignedRate(view.priceReturn, locale)}
                      tone={view.priceReturn < 0 ? "negative" : "positive"}
                      t={t}
                    />
                    {view.totalReturn !== undefined ? (
                      <MetricRow
                        label={t("stock.totalReturnLabel")}
                        value={formatSignedRate(view.totalReturn, locale)}
                        tone={view.totalReturn < 0 ? "negative" : "positive"}
                        detail={t("stock.totalReturnDetail")}
                        t={t}
                      />
                    ) : null}
                    <MetricRow
                      label={t("stock.annualizedPriceReturn")}
                      value={view.cagr === undefined ? undefined : formatSignedRate(view.cagr, locale)}
                      tone={view.cagr === undefined ? undefined : view.cagr < 0 ? "negative" : "positive"}
                      t={t}
                    />
                    <MetricRow
                      label={t("metric.volatility")}
                      value={view.volatility === undefined ? undefined : formatRate(view.volatility, locale)}
                      t={t}
                    />
                    <MetricRow
                      label={t("metric.sharpe")}
                      value={view.sharpeRatio === undefined ? undefined : formatRatio(view.sharpeRatio, locale)}
                      detail={t("stock.riskFreeUsed", { rate: formatRiskFree(result.input) })}
                      t={t}
                    />
                    <MetricRow
                      label={t("stock.maxDrawdownLabel")}
                      value={formatRate(view.maxDrawdown.drawdown, locale)}
                      tone={view.maxDrawdown.drawdown < 0 ? "negative" : undefined}
                      detail={drawdownDetail(view, locale, t)}
                      t={t}
                    />
                    <MetricRow
                      label={t("stock.betaLabel", { symbol: BENCHMARK_SYMBOL })}
                      value={
                        view.benchmark?.beta === undefined ? undefined : formatRatio(view.benchmark.beta, locale)
                      }
                      detail={benchmarkDetail(result, locale, t)}
                      t={t}
                    />
                    <MetricRow
                      label={t("stock.correlationLabel", { symbol: BENCHMARK_SYMBOL })}
                      value={
                        view.benchmark?.correlation === undefined
                          ? undefined
                          : formatRatio(view.benchmark.correlation, locale)
                      }
                      detail={benchmarkDetail(result, locale, t)}
                      t={t}
                    />
                  </dl>

                  <p className={styles.footnote}>
                    {t(view.returnBasis === "total" ? "stock.basisTotal" : "stock.basisPrice")}
                  </p>
                  <p className={styles.footnote}>
                    {!view.riskSample.sufficient
                      ? t("stock.riskSampleInsufficient", { count: view.riskSample.observations })
                      : view.riskSample.limited
                        ? t("stock.riskSampleLimited", { count: view.riskSample.observations })
                        : t("stock.riskSampleOk", { count: view.riskSample.observations })}
                  </p>
                  <p className={styles.footnote}>{t("stock.dashMeaning")}</p>
                  <p className={styles.footnote}>
                    {t("stock.fetchedAt", { time: formatTimestamp(new Date(result.marketData.fetchedAt), locale) })}
                  </p>
                </section>

                {result.benchmarkIsSelf ? (
                  <section className={styles.notice} aria-labelledby="stock-benchmark-self">
                    <h2 id="stock-benchmark-self">{t("stock.benchmarkSelfTitle", { symbol: BENCHMARK_SYMBOL })}</h2>
                    <p>{t("stock.benchmarkSelfBody", { symbol: BENCHMARK_SYMBOL })}</p>
                  </section>
                ) : null}

                {result.benchmarkError ? (
                  <section className={styles.errorPanel} aria-labelledby="stock-benchmark-error">
                    <h2 id="stock-benchmark-error">
                      <TriangleAlert size={14} aria-hidden="true" /> {t("stock.benchmarkUnavailableTitle")}
                    </h2>
                    <p>{t("stock.benchmarkUnavailableBody", { symbol: BENCHMARK_SYMBOL })}</p>
                    <p className={styles.benchmarkReason}>
                      {result.benchmarkError.messageKey
                        ? t(result.benchmarkError.messageKey)
                        : result.benchmarkError.message}
                    </p>
                    <button
                      type="button"
                      className={styles.retryButton}
                      onClick={() => void retryBenchmark()}
                      disabled={isLoading}
                    >
                      {t("stock.benchmarkRetry", { symbol: BENCHMARK_SYMBOL })}
                    </button>
                  </section>
                ) : null}

                <section className={styles.panel} aria-labelledby="stock-means-title">
                  <header className={styles.panelHead}>
                    <h2 id="stock-means-title">{t("stock.meansTitle")}</h2>
                  </header>

                  <div className={styles.means}>
                    <p>{t("stock.meansReturn")}</p>
                    <p>{t("stock.meansVolatility")}</p>
                    <p>{t("stock.meansSharpe")}</p>
                    <p>{t("stock.meansBeta", { symbol: BENCHMARK_SYMBOL })}</p>
                    <p>{t("stock.meansCorrelation")}</p>
                  </div>

                  <h3 className={styles.subhead}>
                    {t("stock.scenarioTitle", { amount: formatPrice(SCENARIO_AMOUNT, view.currency, locale, 0) })}
                  </h3>
                  {scenario && scenario.drawdown < 0 && scenario.peakDate && scenario.troughDate ? (
                    <div className={styles.means}>
                      <p>
                        {t("stock.scenarioBody", {
                          amount: formatPrice(scenario.amount, view.currency, locale, 0),
                          peak: formatDate(scenario.peakDate, locale),
                          trough: formatPrice(scenario.troughValue, view.currency, locale),
                          troughDate: formatDate(scenario.troughDate, locale),
                          decline: formatPrice(Math.abs(scenario.decline), view.currency, locale),
                          drawdown: formatRate(scenario.drawdown, locale),
                        })}
                      </p>
                      <p>
                        {scenario.recoveryDate
                          ? t("stock.scenarioRecovered", { date: formatDate(scenario.recoveryDate, locale) })
                          : t("stock.scenarioNotRecovered", { date: formatDate(view.history.lastDate, locale) })}
                      </p>
                      <p className={styles.caveat}>{t("stock.scenarioNote")}</p>
                    </div>
                  ) : (
                    <p className={styles.emptyState}>{t("stock.scenarioNoDecline")}</p>
                  )}

                  <h3 className={styles.subhead}>{t("stock.limitationsTitle")}</h3>
                  <ul className={styles.limits}>
                    <li>{t("stock.limitDividends")}</li>
                    <li>{t("stock.limitWindow")}</li>
                    <li>{t("stock.limitClose")}</li>
                    <li>{t("stock.limitBenchmark", { symbol: BENCHMARK_SYMBOL })}</li>
                    <li>{t("stock.limitNotAdvice")}</li>
                  </ul>

                  <Link className={styles.methodLink} href="/methodology">
                    {t("stock.learnMore")}
                  </Link>
                </section>
              </div>
            </div>
          </>
        ) : isLoading || loadError ? null : (
          <p className={styles.emptyState}>{t("stock.awaitingRun")}</p>
        )}

        <ShellDisclaimer />
      </div>
    </AppShell>
  );
}

// --- Metric rows ------------------------------------------------------------

function MetricRow({
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
    <div className={styles.metricRow}>
      <dt>{label}</dt>
      <dd className={toneClass}>
        {value === undefined ? (
          <span className={styles.notAvailable}>
            —<span className={styles.visuallyHidden}>{t("stock.notAvailable")}</span>
          </span>
        ) : (
          value
        )}
      </dd>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

/** Peak, trough, and recovery dates behind the worst decline, or nothing when it never declined. */
function drawdownDetail(view: StockAnalysisViewModel, locale: string, t: Translate): string | undefined {
  const { peakDate, troughDate, recoveryDate } = view.maxDrawdown;
  if (!peakDate || !troughDate) return undefined;
  const span = t("stock.drawdownDates", {
    peak: formatDate(peakDate, locale),
    trough: formatDate(troughDate, locale),
  });
  return recoveryDate
    ? `${span} · ${t("stock.drawdownRecovered", { date: formatDate(recoveryDate, locale) })}`
    : `${span} · ${t("stock.drawdownNotRecovered")}`;
}

/** What beta and correlation were measured on, or why they are missing. */
function benchmarkDetail(result: AnalysisResult, locale: string, t: Translate): string | undefined {
  if (result.benchmarkError) return t("stock.benchmarkMissingDetail", { symbol: BENCHMARK_SYMBOL });
  const benchmark = result.view.benchmark;
  if (!benchmark) return t("stock.benchmarkPendingDetail", { symbol: BENCHMARK_SYMBOL });
  return t("stock.overlappingDays", { count: formatCount(benchmark.overlappingDays, locale) });
}

function assetTypeLabel(type: string, t: Translate): string {
  if (type === "ETF") return t("stock.typeEtf");
  if (type === "CS") return t("stock.typeCommonStock");
  return type.trim() === "" ? t("stock.typeUnknown") : type;
}

// --- Charts -----------------------------------------------------------------

const AXIS_TICK = { fill: "#787b86", fontSize: 10 };
const GRID_STROKE = "rgba(120, 123, 134, 0.15)";
const AXIS_LINE = { stroke: "rgba(120, 123, 134, 0.28)" };
const CURSOR = { stroke: "rgba(91, 140, 255, 0.52)", strokeDasharray: "3 4" };

function PriceChart({
  data,
  view,
  locale,
  t,
  animate,
}: {
  data: Array<Record<string, number | string | null>>;
  view: StockAnalysisViewModel;
  locale: string;
  t: Translate;
  animate: boolean;
}) {
  if (data.length < 2) return <p className={styles.emptyState}>{t("stock.chartEmpty")}</p>;

  const drawn = view.movingAverages.filter((series) => series.points.length > 0);
  const missing = view.movingAverages.filter((series) => series.points.length === 0);

  return (
    <>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <i style={{ background: CLOSE_COLOR }} aria-hidden="true" />
          {t("stock.seriesClose")}
        </span>
        {drawn.map((series) => (
          <span key={series.window} className={styles.legendItem}>
            <i style={{ background: MA_COLORS[series.window] ?? CLOSE_COLOR }} aria-hidden="true" />
            {t("stock.seriesMa", { window: series.window })}
          </span>
        ))}
      </div>

      <div className={styles.chartCanvas} role="img" aria-label={t("stock.chartPriceAria", { symbol: view.ticker })}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              width={58}
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={(value: number) => formatPrice(value, view.currency, locale, 0)}
            />
            <Tooltip
              cursor={CURSOR}
              content={
                <SeriesTooltip
                  locale={locale}
                  format={(value) => formatPrice(value, view.currency, locale)}
                  labels={{
                    close: t("stock.seriesClose"),
                    ...Object.fromEntries(
                      view.movingAverages.map((series) => [
                        movingAverageKey(series.window),
                        t("stock.seriesMa", { window: series.window }),
                      ]),
                    ),
                  }}
                  colors={{
                    close: CLOSE_COLOR,
                    ...Object.fromEntries(
                      view.movingAverages.map((series) => [
                        movingAverageKey(series.window),
                        MA_COLORS[series.window] ?? CLOSE_COLOR,
                      ]),
                    ),
                  }}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="close"
              stroke={CLOSE_COLOR}
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={animate}
              animationDuration={700}
              activeDot={{ r: 3, strokeWidth: 2 }}
            />
            {drawn.map((series) => (
              <Line
                key={series.window}
                type="monotone"
                dataKey={movingAverageKey(series.window)}
                stroke={MA_COLORS[series.window] ?? CLOSE_COLOR}
                strokeWidth={1.3}
                dot={false}
                connectNulls={false}
                isAnimationActive={animate}
                animationDuration={700}
                activeDot={{ r: 3, strokeWidth: 2 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className={styles.caption}>{t("stock.chartPriceCaption")}</p>
      {missing.map((series) => (
        <p key={series.window} className={styles.caption}>
          {t("stock.chartMaEmpty", { window: series.window })}
        </p>
      ))}
    </>
  );
}

function CumulativeChart({
  data,
  locale,
  t,
  animate,
}: {
  data: Array<{ date: DateString; value: number }>;
  locale: string;
  t: Translate;
  animate: boolean;
}) {
  if (data.length < 2) return <p className={styles.emptyState}>{t("stock.chartEmpty")}</p>;

  return (
    <>
      <div className={styles.chartCanvas} role="img" aria-label={t("stock.chartCumulativeAria")}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              width={54}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={(value: number) => `${value.toFixed(0)}%`}
            />
            <ReferenceLine y={0} stroke="rgba(120, 123, 134, 0.45)" strokeDasharray="3 4" />
            <Tooltip
              cursor={CURSOR}
              content={
                <SeriesTooltip
                  locale={locale}
                  format={(value) => formatSignedPercentPoints(value, locale)}
                  labels={{ value: t("stock.tabCumulative") }}
                  colors={{ value: CLOSE_COLOR }}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={CLOSE_COLOR}
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={animate}
              animationDuration={700}
              activeDot={{ r: 3, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.caption}>{t("stock.chartCumulativeCaption")}</p>
    </>
  );
}

function DailyReturnChart({
  data,
  locale,
  t,
  animate,
}: {
  data: Array<{ date: DateString; gain: number | null; loss: number | null }>;
  locale: string;
  t: Translate;
  animate: boolean;
}) {
  if (data.length === 0) return <p className={styles.emptyState}>{t("stock.chartDailyEmpty")}</p>;

  return (
    <>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <i style={{ background: GAIN_COLOR }} aria-hidden="true" />
          {t("stock.seriesGain")}
        </span>
        <span className={styles.legendItem}>
          <i style={{ background: LOSS_COLOR }} aria-hidden="true" />
          {t("stock.seriesLoss")}
        </span>
      </div>

      <div className={styles.chartCanvas} role="img" aria-label={t("stock.chartDailyAria")}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              width={54}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={(value: number) => `${value.toFixed(0)}%`}
            />
            <ReferenceLine y={0} stroke="rgba(120, 123, 134, 0.45)" />
            <Tooltip
              cursor={{ fill: "rgba(91, 140, 255, 0.12)" }}
              content={
                <SeriesTooltip
                  locale={locale}
                  format={(value) => formatSignedPercentPoints(value, locale)}
                  labels={{ gain: t("stock.seriesGain"), loss: t("stock.seriesLoss") }}
                  colors={{ gain: GAIN_COLOR, loss: LOSS_COLOR }}
                />
              }
            />
            <Bar dataKey="gain" fill={GAIN_COLOR} isAnimationActive={animate} animationDuration={600} />
            <Bar dataKey="loss" fill={LOSS_COLOR} isAnimationActive={animate} animationDuration={600} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.caption}>{t("stock.chartDailyCaption")}</p>
    </>
  );
}

function VolumeChart({
  data,
  view,
  locale,
  t,
  animate,
}: {
  data: Array<{ date: DateString; volume: number }>;
  view: StockAnalysisViewModel;
  locale: string;
  t: Translate;
  animate: boolean;
}) {
  if (view.volume.unavailable || data.length === 0) {
    return <p className={styles.emptyState}>{t("stock.volumeUnavailable")}</p>;
  }

  return (
    <>
      <dl className={styles.volumeFigures}>
        <div>
          <dt>{t("stock.volumeLatest")}</dt>
          <dd className={styles.mono}>
            {view.volume.latest === undefined ? "—" : formatVolume(view.volume.latest, locale)}
          </dd>
        </div>
        <div>
          <dt>{t("stock.volumeAverage", { count: VOLUME_AVERAGE_WINDOW })}</dt>
          <dd className={styles.mono}>
            {view.volume.averageVolume === undefined
              ? t("stock.volumeAverageUnavailable", { count: VOLUME_AVERAGE_WINDOW })
              : formatVolume(view.volume.averageVolume, locale)}
          </dd>
        </div>
      </dl>

      <div className={styles.chartCanvas} role="img" aria-label={t("stock.chartVolumeAria")}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              width={58}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={(value: number) => formatVolume(value, locale)}
            />
            <Tooltip
              cursor={{ fill: "rgba(91, 140, 255, 0.12)" }}
              content={
                <SeriesTooltip
                  locale={locale}
                  format={(value) => formatVolume(value, locale)}
                  labels={{ volume: t("stock.tabVolume") }}
                  colors={{ volume: VOLUME_COLOR }}
                />
              }
            />
            <Bar dataKey="volume" fill={VOLUME_COLOR} isAnimationActive={animate} animationDuration={600} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.caption}>{t("stock.chartVolumeCaption")}</p>
    </>
  );
}

/**
 * Shared tooltip. It prints the hovered date and one labelled row per series that reported a
 * number on that date; a series with no value on that date is omitted rather than shown as zero.
 */
function SeriesTooltip({
  active,
  payload,
  label,
  locale,
  labels,
  colors,
  format,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | null }>;
  label?: string;
  locale: string;
  labels: Record<string, string>;
  colors: Record<string, string>;
  format: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((entry) => typeof entry.value === "number");
  if (rows.length === 0) return null;

  return (
    <div className={styles.tooltip}>
      <strong>{label ? formatDate(label, locale) : ""}</strong>
      {rows.map((entry) => {
        const key = String(entry.dataKey);
        return (
          <span key={key}>
            <i style={{ background: colors[key] ?? CLOSE_COLOR }} aria-hidden="true" />
            <em>{labels[key] ?? key}</em>
            <b className={styles.mono}>{format(entry.value as number)}</b>
          </span>
        );
      })}
    </div>
  );
}

// --- Formatting -------------------------------------------------------------

function formatPrice(value: number, currency: string, locale: string, digits = 2): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
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

function formatVolume(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

/**
 * The rate exactly as typed. It is deliberately not re-formatted or rounded: the page claims to
 * state the precise input the Sharpe ratio used, so 4.125 must read as 4.125%, not 4.13%.
 */
function formatRiskFree(input: AnalysisInput): string {
  return `${input.riskFreePercent}%`;
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
