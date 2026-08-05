"use client";

// Purpose: Market Overview workspace — trailing-year benchmark ETFs, a locally saved
// watchlist, a normalized comparison chart, and an educational risk summary.
//
// Honesty rules this file follows:
// - Every number rendered comes from data the market-data service actually returned.
//   Anything not computable renders as an em dash, never as zero and never as a guess.
// - Symbols load one at a time. A symbol that fails is reported on its own row and does
//   not remove the symbols that succeeded, so partial success stays visible and labelled.
// - Only closing prices are read, so all returns are price returns. The UI says so.
// - Only ticker symbols are persisted. No prices, metrics, or timestamps are stored.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Info, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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
import { EvidenceModeNotice } from "@/components/evidence-mode-notice";
import { AnalyticsError } from "@/domain/analytics";
import {
  BENCHMARK_SYMBOLS,
  MAX_WATCHLIST_SYMBOLS,
  addWatchlistSymbol,
  buildNormalizedSeries,
  deriveMarketRisk,
  normalizeSymbol,
  parseStoredWatchlist,
  removeWatchlistSymbol,
  summarizePriceWindow,
  trailingWindow,
  windowHasTotalReturn,
  type DrawdownBand,
  type PriceWindowSummary,
  type VolatilityBand,
  type WatchlistRejection,
} from "@/domain/market-overview";
import type { ReturnBasis } from "@/domain/analytics";
import { loadAnalysisMarketData } from "@/services/analysis-market-data";
import { MarketDataError } from "@/services/market-data-api";
import { type Translate, type TranslationKey, useLanguage } from "@/i18n/language";
import type { DateString, MarketData, PriceBar } from "@/types/backtest";

import styles from "./market-overview.module.css";

/** Only ticker symbols live here; see `parseStoredWatchlist` for the read-side contract. */
const WATCHLIST_STORAGE_KEY = "investiq-market-watchlist";

const BENCHMARK_COLORS: Record<string, string> = {
  SPY: "#5b8cff",
  QQQ: "#c084fc",
  DIA: "#f2b636",
};

/** Cycled for watchlist symbols so up to ten series stay distinguishable from each other. */
const WATCHLIST_COLORS = [
  "#45c1a8",
  "#f5709a",
  "#7dd3fc",
  "#fbbf24",
  "#a3e635",
  "#fb7185",
  "#38bdf8",
  "#e879f9",
  "#facc15",
  "#2dd4bf",
];

const VOLATILITY_BAND_KEYS: Record<VolatilityBand, TranslationKey> = {
  calm: "market.bandCalm",
  normal: "market.bandNormal",
  elevated: "market.bandElevated",
  stressed: "market.bandStressed",
};

const DRAWDOWN_BAND_KEYS: Record<DrawdownBand, TranslationKey> = {
  shallow: "market.bandShallow",
  moderate: "market.bandModerate",
  deep: "market.bandDeep",
  severe: "market.bandSevere",
};

const REJECTION_KEYS: Record<WatchlistRejection, TranslationKey> = {
  invalid: "market.rejectInvalid",
  duplicate: "market.rejectDuplicate",
  full: "market.rejectFull",
};

type RowKind = "benchmark" | "watchlist";
type RowStatus = "pending" | "loading" | "ready" | "error";

interface SymbolRow {
  symbol: string;
  kind: RowKind;
  status: RowStatus;
  /** Fund or company name exactly as the market-data service reported it. */
  name?: string;
  bars?: PriceBar[];
  summary?: PriceWindowSummary;
  source?: MarketData["source"];
  /** Message produced by the service; already human-readable. */
  error?: string;
  /** Locally generated failure, translated at render time. */
  errorKey?: TranslationKey;
}

interface DateRange {
  from: DateString;
  to: DateString;
}

interface LoadOutcome {
  name?: string;
  bars?: PriceBar[];
  summary?: PriceWindowSummary;
  source?: MarketData["source"];
  error?: string;
  errorKey?: TranslationKey;
}

/** The trailing year ending today, in UTC so the window never shifts with the viewer's zone. */
function trailingYearRange(now: Date): DateRange {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function loadSymbolWindow(symbol: string, range: DateRange): Promise<LoadOutcome> {
  try {
    const data = await loadAnalysisMarketData({
      ticker: symbol,
      from: range.from,
      to: range.to,
      requiredStart: range.from,
    });
    const bars = trailingWindow(data.prices, range.from);
    if (bars.length === 0) return { errorKey: "market.errorEmptyWindow" };
    return { name: data.name, bars, summary: summarizePriceWindow(bars), source: data.source };
  } catch (error) {
    if (error instanceof MarketDataError) return { error: error.message };
    if (error instanceof AnalyticsError) return { errorKey: "market.errorEmptyWindow" };
    return { errorKey: "market.errorUnknown" };
  }
}

function applyOutcome(row: SymbolRow, outcome: LoadOutcome): SymbolRow {
  if (outcome.summary && outcome.bars) {
    return {
      symbol: row.symbol,
      kind: row.kind,
      status: "ready",
      name: outcome.name,
      bars: outcome.bars,
      summary: outcome.summary,
      source: outcome.source,
    };
  }
  return {
    symbol: row.symbol,
    kind: row.kind,
    status: "error",
    error: outcome.error,
    errorKey: outcome.errorKey ?? (outcome.error ? undefined : "market.errorUnknown"),
  };
}

function seriesColor(row: SymbolRow, watchlistIndex: number): string {
  return BENCHMARK_COLORS[row.symbol] ?? WATCHLIST_COLORS[watchlistIndex % WATCHLIST_COLORS.length];
}

export function MarketOverview() {
  const { locale, t } = useLanguage();
  const reduceMotion = useReducedMotion();

  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [rows, setRows] = useState<SymbolRow[]>(() =>
    BENCHMARK_SYMBOLS.map((symbol) => ({ symbol, kind: "benchmark" as const, status: "pending" as const })),
  );
  const [range, setRange] = useState<DateRange>();
  const [loadedAt, setLoadedAt] = useState<Date>();
  const [sequenceRunning, setSequenceRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [rejection, setRejection] = useState<{ reason: WatchlistRejection; symbol: string }>();
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);

  // Supersedes an in-flight sequence: every await re-checks the token before writing state.
  const runIdRef = useRef(0);
  const rangeRef = useRef<DateRange>(undefined);

  const persistWatchlist = useCallback((symbols: string[]) => {
    try {
      window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(symbols));
    } catch {
      // A blocked or full storage slot must not break the page; the session still works.
    }
  }, []);

  const loadAll = useCallback(async (symbols: string[]) => {
    const runId = ++runIdRef.current;
    const nextRange = trailingYearRange(new Date());
    rangeRef.current = nextRange;
    setRange(nextRange);
    setSequenceRunning(true);
    setLoadedAt(undefined);

    const queue: SymbolRow[] = [
      ...BENCHMARK_SYMBOLS.map((symbol) => ({ symbol, kind: "benchmark" as const, status: "pending" as const })),
      ...symbols.map((symbol) => ({ symbol, kind: "watchlist" as const, status: "pending" as const })),
    ];
    setRows(queue);

    for (const item of queue) {
      if (runIdRef.current !== runId) return;
      setRows((prev) => prev.map((row) => (row.symbol === item.symbol ? { ...row, status: "loading" } : row)));
      const outcome = await loadSymbolWindow(item.symbol, nextRange);
      if (runIdRef.current !== runId) return;
      setRows((prev) => prev.map((row) => (row.symbol === item.symbol ? applyOutcome(row, outcome) : row)));
    }

    if (runIdRef.current !== runId) return;
    setSequenceRunning(false);
    setLoadedAt(new Date());
  }, []);

  /** Loads a single symbol, appending its row when it is new and replacing it when it is a retry. */
  const loadOne = useCallback(async (symbol: string, kind: RowKind) => {
    const activeRange = rangeRef.current ?? trailingYearRange(new Date());
    rangeRef.current = activeRange;
    setRange(activeRange);
    setRows((prev) =>
      prev.some((row) => row.symbol === symbol)
        ? prev.map((row) => (row.symbol === symbol ? { symbol, kind: row.kind, status: "loading" } : row))
        : [...prev, { symbol, kind, status: "loading" }],
    );

    const outcome = await loadSymbolWindow(symbol, activeRange);
    // A removal while the request was open must win: only an existing row is updated.
    setRows((prev) => prev.map((row) => (row.symbol === symbol ? applyOutcome(row, outcome) : row)));
    setLoadedAt(new Date());
  }, []);

  // The saved watchlist is read after mount so the server and client render the same empty
  // list, and the read is deferred past commit so restoring it never cascades a render from
  // inside the effect body.
  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = parseStoredWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY));
      setWatchlist(stored);
      void loadAll(stored);
    }, 0);
    return () => clearTimeout(timer);
  }, [loadAll]);

  const loadingSymbol = rows.find((row) => row.status === "loading")?.symbol;
  const isLoading = sequenceRunning || loadingSymbol !== undefined;

  const benchmarkRows = useMemo(() => rows.filter((row) => row.kind === "benchmark"), [rows]);
  const watchlistRows = useMemo(() => rows.filter((row) => row.kind === "watchlist"), [rows]);
  const failedRows = useMemo(() => rows.filter((row) => row.status === "error"), [rows]);
  const readyRows = useMemo(() => rows.filter((row) => row.status === "ready"), [rows]);
  const isDemo = readyRows.some((row) => row.source === "demo");

  const colorBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    let watchlistIndex = 0;
    for (const row of rows) {
      map.set(row.symbol, seriesColor(row, watchlistIndex));
      if (row.kind === "watchlist") watchlistIndex += 1;
    }
    return map;
  }, [rows]);

  const risk = useMemo(
    () =>
      deriveMarketRisk(
        benchmarkRows
          .filter((row): row is SymbolRow & { summary: PriceWindowSummary } => row.summary !== undefined)
          .map((row) => ({ symbol: row.symbol, summary: row.summary })),
      ),
    [benchmarkRows],
  );

  const chartRows = useMemo(
    () => readyRows.filter((row) => row.bars && !hiddenSeries.includes(row.symbol)),
    [readyRows, hiddenSeries],
  );

  // One shared basis for the whole comparison: total return only when every charted
  // symbol has complete adjusted-close coverage; otherwise price return for all of them,
  // so the normalized chart never mixes an adjusted close against a raw close.
  const returnBasis: ReturnBasis = useMemo(
    () =>
      chartRows.length > 0 && chartRows.every((row) => windowHasTotalReturn(row.bars ?? []))
        ? "total"
        : "price",
    [chartRows],
  );

  const chartSeries = useMemo(
    () =>
      buildNormalizedSeries(
        chartRows.map((row) => ({ symbol: row.symbol, bars: row.bars ?? [] })),
        returnBasis,
      ),
    [chartRows, returnBasis],
  );

  const chartData = useMemo(
    () =>
      chartSeries.map((point) => {
        const datum: Record<string, string | number> = { date: point.date };
        for (const [symbol, value] of Object.entries(point.values)) datum[symbol] = value * 100;
        return datum;
      }),
    [chartSeries],
  );

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = addWatchlistSymbol(watchlist, draft);
    if (result.rejected) {
      setRejection({ reason: result.rejected, symbol: normalizeSymbol(draft) });
      return;
    }
    setRejection(undefined);
    setDraft("");
    setWatchlist(result.symbols);
    persistWatchlist(result.symbols);
    if (result.added) void loadOne(result.added, "watchlist");
  }

  function handleRemove(symbol: string) {
    const next = removeWatchlistSymbol(watchlist, symbol);
    setWatchlist(next);
    persistWatchlist(next);
    setRows((prev) => prev.filter((row) => !(row.kind === "watchlist" && row.symbol === symbol)));
    setHiddenSeries((prev) => prev.filter((entry) => entry !== symbol));
    if (rejection?.symbol === symbol) setRejection(undefined);
  }

  function toggleSeries(symbol: string) {
    setHiddenSeries((prev) =>
      prev.includes(symbol) ? prev.filter((entry) => entry !== symbol) : [...prev, symbol],
    );
  }

  return (
    <AppShell
      status={
        <p className={styles.statusLine} role="status" aria-live="polite">
          <i className={isLoading ? styles.statusDotLoading : styles.statusDot} aria-hidden="true" />
          {isLoading
            ? loadingSymbol
              ? t("market.loadingSymbol", { symbol: loadingSymbol })
              : t("market.statusLoading")
            : loadedAt
              ? t("market.statusLoaded", { time: formatTimestamp(loadedAt, locale) })
              : t("market.statusIdle")}
        </p>
      }
      actions={
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => void loadAll(watchlist)}
          disabled={isLoading}
        >
          <RefreshCw size={13} aria-hidden="true" className={isLoading ? styles.spin : undefined} />
          <span>{isLoading ? t("market.refreshing") : t("market.refresh")}</span>
        </button>
      }
    >
      <div className={styles.page}>
        <div className={styles.pageHead}>
          <h1>{t("market.title")}</h1>
          <p className={styles.subtitle}>{t(isDemo ? "market.subtitleSynthetic" : "market.subtitle")}</p>
          <p className={styles.windowLine}>
            {range ? t("market.window", { from: formatDate(range.from, locale), to: formatDate(range.to, locale) }) : t("market.windowPending")}
          </p>
        </div>

        {isDemo ? <EvidenceModeNotice id="market-demo-title" /> : null}

        {!isDemo ? <div className={styles.explainers}>
          <Explainer titleKey="market.etfProxyTitle" bodyKey="market.etfProxy" />
          <Explainer
            titleKey={returnBasis === "total" ? "market.totalReturnTitle" : "market.priceReturnTitle"}
            bodyKey={returnBasis === "total" ? "market.totalReturnBasis" : "market.priceReturnOnly"}
          />
        </div> : null}

        {failedRows.length > 0 ? (
          <section className={styles.errorPanel} aria-labelledby="market-errors">
            <h2 id="market-errors">
              <TriangleAlert size={14} aria-hidden="true" /> {t("market.errorsTitle")}
            </h2>
            <p>{t("market.partialNotice")}</p>
            <ul>
              {failedRows.map((row) => (
                <li key={row.symbol}>
                  <b className={styles.mono}>{row.symbol}</b>
                  <span>{row.errorKey ? t(row.errorKey) : row.error}</span>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => void loadOne(row.symbol, row.kind)}
                    disabled={isLoading}
                  >
                    {t("market.retryAction", { symbol: row.symbol })}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={styles.cards} aria-label={t("market.benchmarks")}>
          {benchmarkRows.map((row, index) => (
            <BenchmarkCard
              key={row.symbol}
              row={row}
              accent={colorBySymbol.get(row.symbol) ?? "#5b8cff"}
              delay={reduceMotion ? 0 : index * 0.05}
              reduceMotion={Boolean(reduceMotion)}
            />
          ))}
        </section>

        <div className={styles.grid}>
          <section className={`${styles.panel} ${styles.watchlistPanel}`} aria-labelledby="market-watchlist">
            <header className={styles.panelHead}>
              <h2 id="market-watchlist">{t("market.watchlist")}</h2>
              <span className={styles.count}>{watchlist.length}/{MAX_WATCHLIST_SYMBOLS}</span>
            </header>

            <ul className={styles.watchlistItems}>
              {watchlistRows.map((row) => (
                <li key={row.symbol} className={styles.watchlistItem}>
                  <span className={styles.swatch} style={{ background: colorBySymbol.get(row.symbol) }} aria-hidden="true" />
                  <div className={styles.watchlistIdentity}>
                    <b className={styles.mono}>{row.symbol}</b>
                    {row.name ? <span>{row.name}</span> : null}
                  </div>
                  <div className={styles.watchlistFigures}>
                    {row.status === "ready" && row.summary ? (
                      <>
                        <b>{formatPrice(row.summary.close, locale)}</b>
                        <ReturnValue value={row.summary.priceReturn} locale={locale} t={t} />
                      </>
                    ) : (
                      <span className={styles.rowState}>{rowStateLabel(row, t)}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => handleRemove(row.symbol)}
                    aria-label={t("market.removeAction", { symbol: row.symbol })}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            {watchlistRows.length === 0 ? <p className={styles.emptyState}>{t("market.watchlistEmptyLive")}</p> : null}

            <form className={styles.addForm} onSubmit={handleAdd}>
              <label htmlFor="market-add-symbol">{t("market.addLabel")}</label>
              <div className={styles.addRow}>
                <input
                  id="market-add-symbol"
                  className={styles.mono}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (rejection) setRejection(undefined);
                  }}
                  placeholder={t("market.addPlaceholder")}
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="market-watchlist-hint"
                  aria-invalid={rejection ? true : undefined}
                />
                <button type="submit" className={styles.addButton} disabled={isLoading || draft.trim() === ""}>
                  <Plus size={13} aria-hidden="true" />
                  <span>{t("market.addAction")}</span>
                </button>
              </div>
              {rejection ? (
                <p className={styles.fieldError} role="alert">
                  {t(REJECTION_KEYS[rejection.reason], { symbol: rejection.symbol, max: MAX_WATCHLIST_SYMBOLS })}
                </p>
              ) : null}
              <p id="market-watchlist-hint" className={styles.hint}>
                {t("market.watchlistHint", { max: MAX_WATCHLIST_SYMBOLS })}
              </p>
            </form>
          </section>

          <div className={styles.mainColumn}>
            <section className={styles.panel} aria-labelledby="market-performance">
              <header className={styles.panelHead}>
                <div>
                  <h2 id="market-performance">{t("market.performance")}</h2>
                  <p className={styles.panelSub}>{t("market.chartSubtitle")}</p>
                </div>
              </header>

              {readyRows.length > 0 ? (
                <div className={styles.legend} role="group" aria-label={t("market.chartSeriesLabel")}>
                  {readyRows.map((row) => {
                    const hidden = hiddenSeries.includes(row.symbol);
                    return (
                      <button
                        key={row.symbol}
                        type="button"
                        className={hidden ? styles.legendChipOff : styles.legendChip}
                        onClick={() => toggleSeries(row.symbol)}
                        aria-pressed={!hidden}
                        aria-label={t("market.chartToggle", { symbol: row.symbol })}
                      >
                        <i style={{ background: colorBySymbol.get(row.symbol) }} aria-hidden="true" />
                        <span className={styles.mono}>{row.symbol}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {chartData.length > 1 ? (
                <>
                  <div className={styles.chartCanvas} role="img" aria-label={t("market.chartAria")}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(120, 123, 134, 0.15)" vertical={false} />
                        <XAxis
                          dataKey="date"
                          minTickGap={48}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(120, 123, 134, 0.28)" }}
                          tick={{ fill: "#787b86", fontSize: 10 }}
                          tickFormatter={(value: string) => formatAxisDate(value, locale)}
                        />
                        <YAxis
                          width={52}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "#787b86", fontSize: 10 }}
                          tickFormatter={(value: number) => `${value.toFixed(0)}%`}
                        />
                        <ReferenceLine y={0} stroke="rgba(120, 123, 134, 0.45)" strokeDasharray="3 4" />
                        <Tooltip
                          content={<ChartTooltip locale={locale} colors={colorBySymbol} />}
                          cursor={{ stroke: "rgba(91, 140, 255, 0.52)", strokeDasharray: "3 4" }}
                        />
                        {chartRows.map((row) => (
                          <Line
                            key={row.symbol}
                            type="monotone"
                            dataKey={row.symbol}
                            stroke={colorBySymbol.get(row.symbol)}
                            strokeWidth={1.8}
                            dot={false}
                            isAnimationActive={!reduceMotion}
                            animationDuration={700}
                            activeDot={{ r: 3.5, strokeWidth: 2 }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className={styles.caption}>
                    {t("market.chartCaption", { date: formatDate(chartSeries[0].date, locale) })}
                  </p>
                </>
              ) : (
                <p className={styles.emptyState}>
                  {isLoading ? t("market.statusLoading") : t("market.chartEmpty")}
                </p>
              )}
            </section>

            <section className={styles.panel} aria-labelledby="market-analytics">
              <header className={styles.panelHead}>
                <h2 id="market-analytics">{t("market.analyticsTitle")}</h2>
              </header>
              <MetricsTable
                rows={rows}
                locale={locale}
                t={t}
                ariaLabel={t("market.tableWatchlistAria")}
                colors={colorBySymbol}
              />
            </section>
          </div>

          <section className={`${styles.panel} ${styles.riskPanel}`} aria-labelledby="market-risk">
            <header className={styles.panelHead}>
              <h2 id="market-risk">{t("market.risk")}</h2>
            </header>

            {risk ? (
              <dl className={styles.riskRows}>
                <div className={styles.riskRow}>
                  <dt>{t("market.riskVolatilityLabel")}</dt>
                  <dd>
                    <span className={styles.band}>{t(VOLATILITY_BAND_KEYS[risk.volatilityBand])}</span>
                  </dd>
                  <p>{t("market.riskVolatilityDetail", { symbol: risk.volatilitySymbol, value: formatRate(risk.volatility, locale) })}</p>
                </div>
                <div className={styles.riskRow}>
                  <dt>{t("market.riskDrawdownLabel")}</dt>
                  <dd>
                    <span className={styles.band}>{t(DRAWDOWN_BAND_KEYS[risk.drawdownBand])}</span>
                  </dd>
                  <p>{t("market.riskDrawdownDetail", { symbol: risk.drawdownSymbol, value: formatRate(risk.drawdown, locale) })}</p>
                </div>
              </dl>
            ) : (
              <p className={styles.emptyState}>{isLoading ? t("market.statusLoading") : t("market.riskUnavailable")}</p>
            )}

            <h3 className={styles.riskSubhead}>{t("market.riskDrawdownList")}</h3>
            <ul className={styles.riskList}>
              {benchmarkRows.map((row) => (
                <li key={row.symbol}>
                  <span className={styles.mono}>{row.symbol}</span>
                  {row.status === "ready" && row.summary ? (
                    <b className={styles.negative}>{formatRate(row.summary.maxDrawdown, locale)}</b>
                  ) : (
                    <span className={styles.rowState}>{rowStateLabel(row, t)}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className={styles.means}>
              <h3>{t("market.meansTitle")}</h3>
              <p>{t("market.meansVolatility")}</p>
              <p>{t("market.meansDrawdown")}</p>
              <p className={styles.caveat}>{t("market.meansCaveat")}</p>
              <Link className={styles.methodLink} href="/methodology">
                {t("market.learnMore")}
              </Link>
            </div>
          </section>
        </div>

        <ShellDisclaimer />
      </div>
    </AppShell>
  );
}

function Explainer({ titleKey, bodyKey }: { titleKey: TranslationKey; bodyKey: TranslationKey }) {
  const { t } = useLanguage();
  return (
    <section className={styles.explainer}>
      <h2>
        <Info size={13} aria-hidden="true" /> {t(titleKey)}
      </h2>
      <p>{t(bodyKey)}</p>
    </section>
  );
}

function BenchmarkCard({
  row,
  accent,
  delay,
  reduceMotion,
}: {
  row: SymbolRow;
  accent: string;
  delay: number;
  reduceMotion: boolean;
}) {
  const { locale, t } = useLanguage();
  const summary = row.status === "ready" ? row.summary : undefined;

  return (
    <motion.article
      className={styles.card}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay }}
    >
      <header className={styles.cardHead}>
        <span className={styles.swatch} style={{ background: accent }} aria-hidden="true" />
        <b className={styles.mono}>{row.symbol}</b>
        <span className={styles.cardName}>{row.name ?? t("market.benchmarkProxy")}</span>
      </header>

      {summary ? (
        <>
          <div className={styles.cardPrimary}>
            <strong>{formatPrice(summary.close, locale)}</strong>
            <div className={styles.cardReturn}>
              <span>{t("market.priceReturnLabel")}</span>
              <ReturnValue value={summary.priceReturn} locale={locale} t={t} />
            </div>
          </div>
          <Sparkline bars={row.bars ?? []} accent={accent} />
          <dl className={styles.cardFooter}>
            <div>
              <dt>{t("market.totalReturnLabel")}</dt>
              <dd>
                {summary.totalReturn === undefined ? (
                  <NotAvailable t={t} />
                ) : (
                  <ReturnValue value={summary.totalReturn} locale={locale} t={t} />
                )}
              </dd>
            </div>
            <div>
              <dt>{t("metric.volatility")}</dt>
              <dd>{summary.volatility === undefined ? <NotAvailable t={t} /> : formatRate(summary.volatility, locale)}</dd>
            </div>
            <div>
              <dt>{t("result.maxDrawdown")}</dt>
              <dd className={styles.negative}>{formatRate(summary.maxDrawdown, locale)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className={styles.cardState}>{rowStateLabel(row, t)}</p>
      )}
    </motion.article>
  );
}

/**
 * Decorative closing-price trace for a card. It carries no labels or scale, so it is hidden
 * from assistive technology; the figures beside it are the accessible version.
 */
function Sparkline({ bars, accent }: { bars: PriceBar[]; accent: string }) {
  const points = useMemo(() => {
    if (bars.length < 2) return "";
    const step = Math.max(1, Math.ceil(bars.length / 120));
    const sampled = bars.filter((_, index) => index % step === 0 || index === bars.length - 1);
    const closes = sampled.map((bar) => bar.close);
    const low = Math.min(...closes);
    const high = Math.max(...closes);
    const span = high - low || 1;
    return sampled
      .map((bar, index) => {
        const x = (index / (sampled.length - 1)) * 100;
        const y = 26 - ((bar.close - low) / span) * 24;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [bars]);

  if (!points) return null;
  return (
    <svg className={styles.sparkline} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" stroke={accent} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricsTable({
  rows,
  locale,
  t,
  ariaLabel,
  colors,
}: {
  rows: SymbolRow[];
  locale: string;
  t: Translate;
  ariaLabel: string;
  colors: Map<string, string>;
}) {
  return (
    <div className={styles.tableWrap} role="region" aria-label={ariaLabel} tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("result.ticker")}</th>
            <th scope="col">{t("market.colLastClose")}</th>
            <th scope="col">{t("metric.oneYearReturn")}</th>
            <th scope="col">{t("metric.volatility")}</th>
            <th scope="col">{t("result.maxDrawdown")}</th>
            <th scope="col">{t("market.colSessions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol}>
              <th scope="row">
                <span className={styles.swatch} style={{ background: colors.get(row.symbol) }} aria-hidden="true" />
                <span className={styles.mono}>{row.symbol}</span>
                {row.name ? <em>{row.name}</em> : null}
              </th>
              {row.status === "ready" && row.summary ? (
                <>
                  <td>{formatPrice(row.summary.close, locale)}</td>
                  <td><ReturnValue value={row.summary.priceReturn} locale={locale} t={t} /></td>
                  <td>{row.summary.volatility === undefined ? <NotAvailable t={t} /> : formatRate(row.summary.volatility, locale)}</td>
                  <td className={styles.negative}>{formatRate(row.summary.maxDrawdown, locale)}</td>
                  <td>{row.summary.barCount}</td>
                </>
              ) : (
                <td colSpan={5} className={styles.rowState}>{rowStateLabel(row, t)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  locale,
  colors,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
  locale: string;
  colors: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entries = [...payload].sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
  return (
    <div className={styles.tooltip}>
      <strong>{label ? formatDate(label, locale) : ""}</strong>
      {entries.map((entry) => (
        <span key={String(entry.dataKey)}>
          <i style={{ background: colors.get(String(entry.dataKey)) }} aria-hidden="true" />
          <b className={styles.mono}>{String(entry.dataKey)}</b>
          {typeof entry.value === "number" ? `${entry.value >= 0 ? "+" : ""}${entry.value.toFixed(2)}%` : ""}
        </span>
      ))}
    </div>
  );
}

function ReturnValue({ value, locale, t }: { value: number | undefined; locale: string; t: Translate }) {
  if (value === undefined) return <NotAvailable t={t} />;
  return <b className={value < 0 ? styles.negative : styles.positive}>{formatSignedRate(value, locale)}</b>;
}

function NotAvailable({ t }: { t: Translate }) {
  return (
    <span className={styles.notAvailable} title={t("market.notAvailable")}>
      —<span className={styles.visuallyHidden}>{t("market.notAvailable")}</span>
    </span>
  );
}

function rowStateLabel(row: SymbolRow, t: Translate): string {
  if (row.status === "loading") return t("market.loadingSymbol", { symbol: row.symbol });
  if (row.status === "pending") return t("market.queued");
  if (row.status === "error") return row.errorKey ? t(row.errorKey) : (row.error ?? t("market.errorUnknown"));
  return t("market.notAvailable");
}

function formatPrice(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSignedRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
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
  return value.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
