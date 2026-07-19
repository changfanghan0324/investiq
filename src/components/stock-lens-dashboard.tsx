"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Apple,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Info,
  LoaderCircle,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { brokerPresets, getBrokerPreset } from "@/constants/broker-presets";
import { PortfolioPerformanceChart } from "@/components/portfolio-performance-chart";
import { createPortfolioReport } from "@/services/create-portfolio-report";
import {
  askPortfolioAssistant,
  type AssistantMessage,
} from "@/services/assistant-api";
import { exportPortfolioPdf } from "@/services/pdf-export";
import type {
  BacktestResult,
  FeeRule,
  IntervalUnit,
  PortfolioAggregateResult,
  PortfolioInput,
  PortfolioPositionInput,
  PortfolioReport,
  ProjectionScenarioId,
} from "@/types/backtest";
import { addYearsClamped, formatDuration, todayDateString } from "@/utils/date";
import { formatCurrency, formatPercent } from "@/utils/format";

import styles from "./stock-lens-dashboard.module.css";

type LoadingMode = "live" | "demo";
type ResultMode = ProjectionScenarioId | "historical";
type HealthState = "checking" | "ready" | "degraded";
type FieldErrors = Record<string, string>;

const intervalOptions: Array<{ label: string; value: IntervalUnit }> = [
  { label: "Day", value: "trading-days" },
  { label: "Week", value: "weeks" },
  { label: "Month", value: "months" },
  { label: "Year", value: "years" },
];

export function StockLensDashboard() {
  const [input, setInput] = useState<PortfolioInput>(createDefaultInput);
  const [report, setReport] = useState<PortfolioReport>();
  const [resultMode, setResultMode] = useState<ResultMode>("historical");
  const [loadingMode, setLoadingMode] = useState<LoadingMode | undefined>("demo");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [advancedFees, setAdvancedFees] = useState(false);
  const [health, setHealth] = useState<HealthState>("checking");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const inputRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (active) setHealth(payload.services?.marketData === "ready" ? "ready" : "degraded");
      })
      .catch(() => {
        if (active) setHealth("degraded");
      });

    const previewRevision = inputRevisionRef.current;
    createPortfolioReport({ input: createDefaultInput(), demo: true })
      .then((preview) => {
        if (active && inputRevisionRef.current === previewRevision) setReport(preview);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingMode(undefined);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(() => selectResult(report, resultMode), [report, resultMode]);
  const holdingResults = useMemo(
    () => selectHoldingResults(report, resultMode),
    [report, resultMode],
  );

  function updateInput(updater: (current: PortfolioInput) => PortfolioInput) {
    inputRevisionRef.current += 1;
    setInput(updater);
    setReport(undefined);
    setResultMode("historical");
    setShowAllTransactions(false);
    setAssistantOpen(false);
    setFieldErrors({});
    setError("");
  }

  function updatePosition(id: string, patch: Partial<PortfolioPositionInput>) {
    updateInput((current) => ({
      ...current,
      positions: current.positions.map((position) => position.id === id ? { ...position, ...patch } : position),
    }));
  }

  function addHolding() {
    setError("");
    const template = input.positions.at(-1)?.investment ?? {
      mode: "amount" as const,
      value: 100,
      intervalValue: 1,
      intervalUnit: "months" as const,
    };
    updateInput((current) => ({
      ...current,
      positions: [
        ...current.positions,
        { id: `holding-${Date.now()}`, ticker: "", investment: { ...template } },
      ],
    }));
  }

  async function run(demo = false) {
    setError("");
    const validation = validatePortfolio(input);
    setFieldErrors(validation.fields);
    if (validation.summary) {
      setError(validation.summary);
      if (Object.keys(validation.fields).some((key) => key.startsWith("fee-"))) setAdvancedFees(true);
      return;
    }
    const revisionAtStart = inputRevisionRef.current;
    const inputSnapshot: PortfolioInput = {
      ...input,
      positions: input.positions.map((position) => ({
        ...position,
        ticker: position.ticker.trim().toUpperCase(),
        investment: { ...position.investment },
      })),
      fees: {
        ...input.fees,
        buy: { ...input.fees.buy },
        sell: { ...input.fees.sell },
        dividendReinvestment: { ...input.fees.dividendReinvestment },
      },
    };
    setLoadingMode(demo ? "demo" : "live");
    setAssistantOpen(false);
    try {
      const next = await createPortfolioReport({
        input: inputSnapshot,
        demo,
      });
      if (inputRevisionRef.current !== revisionAtStart) {
        setError("Inputs changed while the calculation was running. Run again to create a report for the current setup.");
        return;
      }
      setReport(next);
      const firstMode: ResultMode = next.historical
        ? "historical"
        : next.projection?.scenarios.find((scenario) => scenario.id === "baseline")?.id ?? "historical";
      setResultMode(firstMode);
      setShowAllTransactions(false);
      window.setTimeout(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (caught) {
      if (inputRevisionRef.current === revisionAtStart) {
        setError(caught instanceof Error ? caught.message : "The backtest could not be completed. Please try again.");
      }
    } finally {
      setLoadingMode(undefined);
    }
  }

  function exportPdf() {
    if (!report || !selected) return;
    exportPortfolioPdf({
      report,
      result: selected,
      holdings: holdingResults,
      scenarioLabel: resultMode === "historical" ? undefined : labelScenario(resultMode),
    });
  }

  return (
    <main className={styles.appShell}>
      <AmbientBackground />
      <Header
        health={health}
        reportReady={Boolean(report && selected)}
        onAssistant={() => setAssistantOpen(true)}
        onExport={exportPdf}
      />

      <div className={`${styles.dashboardGrid} ${setupCollapsed ? styles.setupCollapsed : ""}`}>
        <aside className={`${styles.builder} ${setupCollapsed ? styles.builderCollapsed : ""}`} aria-label="Backtest setup">
          <BuilderHeader
            holdings={input.positions.length}
            collapsed={setupCollapsed}
            onToggle={() => setSetupCollapsed((value) => !value)}
          />
          <div className={styles.builderScroll} id="backtest-setup-controls">
            <div className={styles.holdingStack}>
              <AnimatePresence initial={false}>
                {input.positions.map((position, index) => (
                  <HoldingEditor
                    key={position.id}
                    position={position}
                    index={index}
                    removable={input.positions.length > 1}
                    errors={fieldErrors}
                    onChange={(patch) => updatePosition(position.id, patch)}
                    onRemove={() => updateInput((current) => ({
                      ...current,
                      positions: current.positions.filter((item) => item.id !== position.id),
                    }))}
                  />
                ))}
              </AnimatePresence>
            </div>
            <motion.button
              type="button"
              className={styles.addHolding}
              onClick={addHolding}
              whileTap={{ scale: 0.975 }}
              whileHover={{ scale: 1.006 }}
              transition={{ type: "spring", stiffness: 450, damping: 28 }}
            >
              <Plus size={15} /> Add holding
            </motion.button>
            <p className={styles.sequentialHint}>Unlimited holdings · live data loads sequentially</p>

            <div className={styles.builderDivider} />
            <SectionLabel icon={<CalendarDays size={14} />} title="Date window" />
            <div className={styles.dateRow}>
              <Field label="Start date" htmlFor="start-date" error={fieldErrors.startDate}>
                <input
                  id="start-date"
                  className={styles.input}
                  type="date"
                  min="1990-01-01"
                  value={input.startDate}
                  aria-invalid={Boolean(fieldErrors.startDate)}
                  aria-describedby={fieldErrors.startDate ? "start-date-error" : undefined}
                  onChange={(event) => updateInput((current) => ({ ...current, startDate: event.target.value }))}
                />
              </Field>
              <span className={styles.dateConnector}>to</span>
              <Field label="End date" htmlFor="end-date" error={fieldErrors.endDate}>
                <input
                  id="end-date"
                  className={styles.input}
                  type="date"
                  min="1990-01-01"
                  value={input.endDate}
                  aria-invalid={Boolean(fieldErrors.endDate)}
                  aria-describedby={fieldErrors.endDate ? "end-date-error" : undefined}
                  onChange={(event) => updateInput((current) => ({ ...current, endDate: event.target.value }))}
                />
              </Field>
            </div>
            <p className={styles.helperText}>Non-trading dates roll forward to the next market session.</p>

            <div className={styles.builderDivider} />
            <SectionLabel icon={<ShieldCheck size={14} />} title="Taxes & reporting" />
            <Field label="Reporting basis">
              <SegmentedControl
                ariaLabel="Reporting basis"
                value={input.taxMode}
                options={[
                  { label: "Pretax", value: "pre-tax" },
                  { label: "Aftertax", value: "after-tax" },
                ]}
                onChange={(taxMode) => updateInput((current) => ({ ...current, taxMode: taxMode as PortfolioInput["taxMode"] }))}
              />
            </Field>
            <AnimatePresence initial={false}>
              {input.taxMode === "after-tax" ? (
                <motion.div
                  className={styles.compactFieldGroup}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className={styles.compactFieldRow}>
                    <label htmlFor="withholding-rate">Dividend withholding</label>
                    <div className={styles.suffixInput}>
                      <input
                        id="withholding-rate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={input.dividendTaxRate}
                        aria-invalid={Boolean(fieldErrors.dividendTaxRate)}
                        aria-describedby={fieldErrors.dividendTaxRate ? "dividendTaxRate-error" : undefined}
                        onChange={(event) => updateInput((current) => ({ ...current, dividendTaxRate: safeNumber(event.target.value) }))}
                      />
                      <span>%</span>
                    </div>
                  </div>
                  {fieldErrors.dividendTaxRate ? <small className={styles.fieldError} id="dividendTaxRate-error">{fieldErrors.dividendTaxRate}</small> : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <label className={styles.toggleRow}>
              <span>
                <strong>Liquidate at end</strong>
                <small>Otherwise value at final adjusted close</small>
              </span>
              <input
                type="checkbox"
                checked={input.liquidateAtEnd}
                onChange={(event) => updateInput((current) => ({ ...current, liquidateAtEnd: event.target.checked }))}
              />
              <i aria-hidden="true" />
            </label>
            {input.liquidateAtEnd ? (
              <div className={styles.compactFieldGroup}>
                <div className={styles.compactFieldRow}>
                  <label htmlFor="capital-gains-rate">Capital gains tax</label>
                  <div className={styles.suffixInput}>
                    <input
                      id="capital-gains-rate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={input.capitalGainsTaxRate}
                      aria-invalid={Boolean(fieldErrors.capitalGainsTaxRate)}
                      aria-describedby={fieldErrors.capitalGainsTaxRate ? "capitalGainsTaxRate-error" : undefined}
                      onChange={(event) => updateInput((current) => ({ ...current, capitalGainsTaxRate: safeNumber(event.target.value) }))}
                    />
                    <span>%</span>
                  </div>
                </div>
                {fieldErrors.capitalGainsTaxRate ? <small className={styles.fieldError} id="capitalGainsTaxRate-error">{fieldErrors.capitalGainsTaxRate}</small> : null}
              </div>
            ) : null}

            <div className={styles.builderDivider} />
            <SectionLabel icon={<BarChart3 size={14} />} title="Broker & pricing" />
            <Field label="Broker / pricing plan" htmlFor="broker-plan">
              <div className={styles.selectWrap}>
                <select
                  id="broker-plan"
                  className={styles.select}
                  value={input.fees.brokerId}
                  onChange={(event) => updateInput((current) => ({ ...current, fees: getBrokerPreset(event.target.value) }))}
                >
                  {brokerPresets.map((broker) => (
                    <option key={broker.brokerId} value={broker.brokerId}>{broker.brokerName}</option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </div>
            </Field>
            {input.fees.brokerId === "custom" ? (
              <Field label="Plan name" htmlFor="broker-plan-name">
                <input
                  id="broker-plan-name"
                  className={styles.input}
                  value={input.fees.brokerName}
                  onChange={(event) => updateInput((current) => ({ ...current, fees: { ...current.fees, brokerName: event.target.value } }))}
                  placeholder="Your broker"
                />
              </Field>
            ) : null}
            <button type="button" className={styles.feeDisclosure} onClick={() => setAdvancedFees((value) => !value)}>
              <span><Info size={13} /> {advancedFees ? "Hide" : "Review or edit"} exact fee rules</span>
              <ChevronDown size={14} className={advancedFees ? styles.chevronOpen : undefined} />
            </button>
            <AnimatePresence initial={false}>
              {advancedFees ? (
                <motion.div
                  className={styles.advancedFees}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <FeeEditor title="Buy order" ruleKey="buy" value={input.fees.buy} errors={fieldErrors} onChange={(buy) => updateInput((current) => ({ ...current, fees: { ...current.fees, buy } }))} />
                  <FeeEditor title="Sell order" ruleKey="sell" value={input.fees.sell} errors={fieldErrors} onChange={(sell) => updateInput((current) => ({ ...current, fees: { ...current.fees, sell } }))} />
                  <FeeEditor title="Dividend reinvestment" ruleKey="dividendReinvestment" value={input.fees.dividendReinvestment} errors={fieldErrors} onChange={(dividendReinvestment) => updateInput((current) => ({ ...current, fees: { ...current.fees, dividendReinvestment } }))} />
                </motion.div>
              ) : null}
            </AnimatePresence>
            <p className={styles.brokerNote}>{input.fees.notes} Checked {input.fees.effectiveDate}.</p>

            {error ? (
              <motion.div className={styles.errorBanner} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert">
                <CircleHelp size={16} />
                <span>{error}</span>
              </motion.div>
            ) : null}

          </div>
          <div className={styles.builderActionBar}>
            <motion.button
              type="button"
              className={styles.runButton}
              disabled={Boolean(loadingMode)}
              onClick={() => void run(false)}
              whileTap={loadingMode ? undefined : { scale: 0.975 }}
              transition={{ type: "spring", stiffness: 460, damping: 28 }}
            >
              <span className={styles.runIcon}>
                {loadingMode === "live" ? <LoaderCircle size={17} className={styles.spin} /> : <Play size={15} fill="currentColor" />}
              </span>
              <span className={styles.runLabel}>{loadingMode === "live" ? "Calculating exact sessions…" : "Run live backtest"}</span>
              <span className={styles.runTrailing}>{loadingMode ? null : <ArrowRight size={15} />}</span>
            </motion.button>
            <motion.button
              type="button"
              className={styles.demoButton}
              disabled={Boolean(loadingMode)}
              onClick={() => void run(true)}
              whileTap={loadingMode ? undefined : { scale: 0.98 }}
              transition={{ type: "spring", stiffness: 440, damping: 28 }}
            >
              <RefreshCw size={13} className={loadingMode === "demo" ? styles.spin : undefined} />
              Load synthetic demo
            </motion.button>
            <div className={styles.readyState}>
              <span className={health === "ready" ? styles.statusReady : styles.statusMuted} />
              {loadingMode === "live"
                ? "Aligning exact trading sessions"
                : health === "checking"
                  ? "Checking services"
                  : health === "ready"
                    ? "Market-data service ready"
                    : "Service status unavailable"}
            </div>
          </div>
        </aside>

        <section className={styles.workspace} ref={workspaceRef} id="portfolio-lab">
          {selected && report ? (
            <ResultsWorkspace
              report={report}
              result={selected}
              resultMode={resultMode}
              holdingResults={holdingResults}
              showAllTransactions={showAllTransactions}
              onResultMode={setResultMode}
              onToggleTransactions={() => setShowAllTransactions((value) => !value)}
            />
          ) : (
            <WorkspaceLoading loading={Boolean(loadingMode)} />
          )}
        </section>

        <aside className={styles.insights} aria-label="Portfolio audit summary">
          {selected && report ? (
            <InsightsRail
              result={selected}
              report={report}
              holdingResults={holdingResults}
              onAssistant={() => setAssistantOpen(true)}
            />
          ) : (
            <InsightsLoading />
          )}
        </aside>
      </div>

      <div className={styles.mobileRunBar}>
        <div>
          <strong>{input.positions.length} holding{input.positions.length === 1 ? "" : "s"}</strong>
          <span>{input.startDate.slice(0, 4)}–{input.endDate.slice(0, 4)}</span>
        </div>
        <button type="button" disabled={Boolean(loadingMode)} onClick={() => void run(false)}>
          {loadingMode === "live" ? <LoaderCircle size={15} className={styles.spin} /> : <Play size={14} fill="currentColor" />}
          {loadingMode === "live" ? "Calculating…" : "Run live"}
        </button>
      </div>

      <AnimatePresence>
        {assistantOpen && report && selected ? (
          <AssistantDrawer
            report={report}
            mode={resultMode}
            onClose={() => setAssistantOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}

function Header({
  health,
  reportReady,
  onAssistant,
  onExport,
}: {
  health: HealthState;
  reportReady: boolean;
  onAssistant: () => void;
  onExport: () => void;
}) {
  return (
    <header className={styles.topbar}>
      <a className={styles.brand} href="#portfolio-lab" aria-label="Stock Lens portfolio lab">
        <span className={styles.brandMark}><i /><b /></span>
        <strong>STOCK LENS</strong>
        <em>US EQUITIES</em>
      </a>
      <nav className={styles.navLinks} aria-label="Primary navigation">
        <a className={styles.navActive} href="#portfolio-lab">Portfolio Lab</a>
        <a href="/methodology">How it works</a>
      </nav>
      <div className={styles.headerActions}>
        <HeaderMarketPulse />
        <div className={styles.marketStatus} title="Stock Lens service status">
          <span className={health === "ready" ? styles.statusReady : health === "checking" ? styles.statusChecking : styles.statusMuted} />
          <div><strong>{health === "ready" ? "Data ready" : health === "checking" ? "Checking data" : "Data degraded"}</strong><small>Server verified</small></div>
        </div>
        <motion.button type="button" className={styles.secondaryAction} disabled={!reportReady} onClick={onAssistant} whileTap={reportReady ? { scale: 0.96 } : undefined}>
          <Sparkles size={15} /> <span>AI Analyst</span>
        </motion.button>
        <motion.button type="button" className={styles.primaryAction} disabled={!reportReady} onClick={onExport} whileTap={reportReady ? { scale: 0.96 } : undefined}>
          <Download size={15} /> <span>Export PDF</span>
        </motion.button>
      </div>
    </header>
  );
}

function HeaderMarketPulse() {
  const reduceMotion = useReducedMotion();
  return (
    <div className={styles.headerPulse} aria-hidden="true">
      <svg viewBox="0 0 108 30" role="presentation">
        <path className={styles.pulseBaseline} d="M2 23 L106 23" />
        <motion.path
          className={styles.pulseLine}
          d="M2 24 L10 20 L18 22 L27 14 L36 17 L44 10 L52 13 L61 9 L70 12 L79 5 L87 8 L97 3 L106 6"
          initial={reduceMotion ? false : { pathLength: 0, opacity: 0.35 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1.35, ease: "easeOut", repeat: Infinity, repeatDelay: 2.4 }}
        />
      </svg>
    </div>
  );
}

function BuilderHeader({
  holdings,
  collapsed,
  onToggle,
}: {
  holdings: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.builderHeader}>
      <button
        type="button"
        className={styles.builderToggle}
        aria-expanded={!collapsed}
        aria-controls="backtest-setup-controls"
        aria-label={collapsed ? "Expand backtest setup" : "Collapse backtest setup"}
        onClick={onToggle}
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span>Backtest setup</span>
      </button>
      <div className={styles.portfolioHeading}>
        <strong>Portfolio 01 <Pencil size={13} aria-hidden="true" /></strong>
        <button type="button" aria-label={`${holdings} holdings in portfolio`} title={`${holdings} holdings`}><MoreVertical size={16} /></button>
      </div>
    </div>
  );
}

function HoldingEditor({
  position,
  index,
  removable,
  errors,
  onChange,
  onRemove,
}: {
  position: PortfolioPositionInput;
  index: number;
  removable: boolean;
  errors: FieldErrors;
  onChange: (patch: Partial<PortfolioPositionInput>) => void;
  onRemove: () => void;
}) {
  const tickerKey = `ticker-${position.id}`;
  const orderKey = `order-${position.id}`;
  const intervalKey = `interval-${position.id}`;
  const tickerInputId = `${position.id}-ticker`;
  const orderInputId = `${position.id}-order-value`;
  const intervalInputId = `${position.id}-interval-value`;
  return (
    <motion.div
      layout
      className={styles.holdingCard}
      initial={{ opacity: 0, x: -12, scale: 0.985 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0, x: -10, scale: 0.97 }}
      whileHover={{ y: -1, borderColor: "rgba(91, 140, 255, 0.48)" }}
      transition={{ type: "spring", stiffness: 310, damping: 28, delay: Math.min(index * 0.035, 0.18) }}
    >
      <div className={styles.holdingTopline}>
        <span className={styles.holdingIndex}>{index + 1}</span>
        <div className={styles.tickerIdentity}>
          <TickerBadge ticker={position.ticker || "?"} />
          <label htmlFor={tickerInputId}>
            <input
              id={tickerInputId}
              aria-label={`Holding ${index + 1} ticker`}
              aria-invalid={Boolean(errors[tickerKey])}
              aria-describedby={errors[tickerKey] ? `${tickerKey}-error` : undefined}
              value={position.ticker}
              maxLength={12}
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Ticker"
              onChange={(event) => onChange({ ticker: event.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "") })}
            />
            <small>{companyLabel(position.ticker)}</small>
          </label>
        </div>
        {removable ? (
          <button type="button" aria-label={`Remove holding ${index + 1}`} className={styles.iconButton} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        ) : <span className={styles.iconSpacer} />}
      </div>
      {errors[tickerKey] ? <small className={styles.fieldError} id={`${tickerKey}-error`}>{errors[tickerKey]}</small> : null}
      <Field label="Order type">
        <SegmentedControl
          ariaLabel={`Holding ${index + 1} order type`}
          value={position.investment.mode}
          options={[{ label: "Cash", value: "amount" }, { label: "Shares", value: "shares" }]}
          onChange={(mode) => onChange({ investment: { ...position.investment, mode: mode as "amount" | "shares" } })}
        />
      </Field>
      <div className={styles.orderRow}>
        <Field
          label={position.investment.mode === "amount" ? "USD per order" : "Shares per order"}
          htmlFor={orderInputId}
          error={errors[orderKey]}
          errorId={`${orderKey}-error`}
        >
          <div className={styles.numberInput}>
            {position.investment.mode === "amount" ? <span>$</span> : null}
            <input
              id={orderInputId}
              type="number"
              min="0.001"
              step={position.investment.mode === "amount" ? "1" : "0.001"}
              value={position.investment.value}
              aria-invalid={Boolean(errors[orderKey])}
              aria-describedby={errors[orderKey] ? `${orderKey}-error` : undefined}
              onChange={(event) => onChange({ investment: { ...position.investment, value: safeNumber(event.target.value) } })}
            />
            {position.investment.mode === "shares" ? <span>sh</span> : null}
          </div>
        </Field>
        <Field label="Repeat schedule" htmlFor={intervalInputId} error={errors[intervalKey]} errorId={`${intervalKey}-error`}>
          <div className={styles.intervalControl}>
            <span>Every</span>
            <input
              id={intervalInputId}
              aria-label={`Holding ${index + 1} interval count`}
              aria-invalid={Boolean(errors[intervalKey])}
              aria-describedby={errors[intervalKey] ? `${intervalKey}-error` : undefined}
              type="number"
              min="1"
              step="1"
              value={position.investment.intervalValue}
              onChange={(event) => onChange({ investment: { ...position.investment, intervalValue: safeNumber(event.target.value) } })}
            />
            <select
              aria-label={`Holding ${index + 1} interval unit`}
              value={position.investment.intervalUnit}
              onChange={(event) => onChange({ investment: { ...position.investment, intervalUnit: event.target.value as IntervalUnit } })}
            >
              {intervalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </Field>
      </div>
    </motion.div>
  );
}

function ResultsWorkspace({
  report,
  result,
  resultMode,
  holdingResults,
  showAllTransactions,
  onResultMode,
  onToggleTransactions,
}: {
  report: PortfolioReport;
  result: PortfolioAggregateResult;
  resultMode: ResultMode;
  holdingResults: Array<{ ticker: string; result: BacktestResult }>;
  showAllTransactions: boolean;
  onResultMode: (mode: ResultMode) => void;
  onToggleTransactions: () => void;
}) {
  const projectionOptions = report.projection?.scenarios ?? [];
  const baselineProjection = projectionOptions.find((scenario) => scenario.id === "baseline") ?? projectionOptions[0];
  const positive = result.totalProfit >= 0;
  const transactions = showAllTransactions ? [...result.transactions].reverse() : result.transactions.slice(-7).reverse();

  return (
    <motion.div key={`${report.source}-${resultMode}-${result.endDate}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.06 }}>
      <div className={styles.resultHeader}>
        <div>
          <div className={styles.resultTitleRow}>
            <h1>Portfolio performance</h1>
            <span className={report.source === "demo" ? styles.demoPill : styles.livePill}>
              <i /> {report.source === "demo" ? "SYNTHETIC PREVIEW" : "VERIFIED LIVE DATA"}
            </span>
          </div>
          <div className={styles.scenarioTabs} aria-label="Report scenario">
            <button
              type="button"
              className={resultMode === "historical" ? styles.scenarioActive : undefined}
              disabled={!report.historical}
              onClick={() => onResultMode("historical")}
            >
              Historical
            </button>
            <button
              type="button"
              className={resultMode !== "historical" ? styles.scenarioActive : undefined}
              disabled={!baselineProjection}
              title={baselineProjection ? "Open simulated estimate" : "Choose a future end date to create a simulated estimate"}
              onClick={() => baselineProjection && onResultMode(baselineProjection.id)}
            >
              Projected
            </button>
          </div>
        </div>
        <div className={styles.resultContext}>
          <button type="button" aria-label="Portfolio result details" title={`${portfolioTitle(holdingResults.map((item) => item.ticker))} · ${result.startDate} to ${result.endDate}`}><Info size={16} /></button>
          <p>{result.startDate} — {result.endDate} · {result.holdingsCount} holdings · {formatDuration(result.durationDays)}</p>
        </div>
      </div>

      {resultMode !== "historical" ? (
        <div className={styles.simulationBanner}>
          <Zap size={15} />
          <span><strong>Simulated estimate — not a forecast.</strong> This scenario is separated from historical performance and is not a prediction or guaranteed return.</span>
          <div className={styles.projectionScenarioTabs} aria-label="Projection assumption">
            {projectionOptions.map((scenario) => (
              <button type="button" key={scenario.id} className={resultMode === scenario.id ? styles.projectionScenarioActive : undefined} onClick={() => onResultMode(scenario.id)}>{scenario.label}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.metricGrid}>
        <Metric label="Final value" value={result.finalAmount} formatter={formatCurrency} />
        <Metric label="Total return" value={result.totalReturnPercent} formatter={formatPercent} tone={positive ? "positive" : "negative"} />
        <Metric label="Net contributions" value={result.totalContributions} formatter={formatCurrency} />
        <Metric label="Max drawdown" value={result.maxDrawdown.percent} formatter={formatPercent} tone="negative" />
      </div>

      <PortfolioPerformanceChart result={result} />

      <div className={styles.lowerGrid}>
        <motion.section className={styles.panel} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.18 }} transition={{ duration: 0.42 }}>
          <PanelHeader title="Holding attribution" meta="Contribution-weighted" />
          <div className={styles.attributionHeader}>
            <span>Ticker</span><span>Final value</span><span>Return</span><span>Portfolio</span>
          </div>
          {holdingResults.map((holding) => {
            const allocation = result.finalAmount > 0 ? holding.result.finalAmount / result.finalAmount * 100 : 0;
            return (
              <div className={styles.attributionRow} key={holding.ticker}>
                <div><TickerBadge ticker={holding.ticker} /><span><strong>{holding.ticker}</strong><small>{holding.result.companyName}</small></span></div>
                <strong>{compactCurrency(holding.result.finalAmount)}</strong>
                <strong className={holding.result.totalReturnPercent >= 0 ? styles.positive : styles.negative}>{formatPercent(holding.result.totalReturnPercent)}</strong>
                <div className={styles.allocationCell}><span>{allocation.toFixed(1)}%</span><i><b style={{ width: `${Math.min(100, allocation)}%` }} /></i></div>
              </div>
            );
          })}
        </motion.section>

        <motion.section className={styles.panel} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.18 }} transition={{ duration: 0.42, delay: 0.06 }}>
          <PanelHeader title="Recent transactions" meta={`${result.transactions.length} total`} />
          <div className={styles.transactionScroller}>
            <div className={styles.transactionHeader}>
              <span>Date</span><span>Ticker</span><span>Action</span><span>Shares</span><span>Price</span>
            </div>
            {transactions.map((transaction, index) => (
              <div className={styles.transactionRow} key={`${transaction.date}-${transaction.ticker}-${transaction.type}-${index}`}>
                <span>{transaction.date}</span>
                <strong>{transaction.ticker ?? "—"}</strong>
                <span>{transaction.type === "contribution-buy" ? "Buy" : transaction.type === "dividend-reinvestment" ? "Dividend reinvest" : "Liquidate"}</span>
                <span>{transaction.shares.toFixed(3)}</span>
                <span>{formatCurrency(transaction.price)}</span>
              </div>
            ))}
          </div>
          <button type="button" className={styles.tableAction} onClick={onToggleTransactions}>
            {showAllTransactions ? "Show recent only" : "View all transactions"} <ArrowRight size={14} />
          </button>
        </motion.section>
      </div>
    </motion.div>
  );
}

function InsightsRail({
  result,
  report,
  holdingResults,
  onAssistant,
}: {
  result: PortfolioAggregateResult;
  report: PortfolioReport;
  holdingResults: Array<{ ticker: string; result: BacktestResult }>;
  onAssistant: () => void;
}) {
  const topHolding = [...holdingResults].sort((a, b) => b.result.totalProfit - a.result.totalProfit)[0];
  const contributionBase = Math.max(result.totalContributions, 0.000001);
  return (
    <div className={styles.insightScroll}>
      <RailSection title="Execution summary">
        <AuditRow label="Purchase price" value="Daily high" />
        <AuditRow label="Non-trading date" value="Next session" />
        <AuditRow label="OHLC basis" value="Split-adjusted" />
        <AuditRow label="Dividends" value="Pay-date reinvested" />
        <AuditRow label="Data source" value={report.source === "demo" ? "Synthetic demo" : "Yahoo + Massive"} verified={report.source !== "demo"} />
      </RailSection>

      <RailSection title="Return breakdown">
        <AuditRow label="Stock return" value={formatPercent(result.priceReturn / contributionBase * 100)} tone={result.priceReturn >= 0 ? "positive" : "negative"} />
        <AuditRow label="Dividend return" value={formatPercent(result.grossDividends / contributionBase * 100)} tone="positive" />
        <AuditRow label="Fees" value={formatPercent(-result.totalFees / contributionBase * 100)} tone="negative" />
        <AuditRow label="Taxes" value={formatPercent(-(result.dividendTax + result.capitalGainsTax) / contributionBase * 100)} tone="negative" />
        <AuditRow label="Total return" value={formatPercent(result.totalReturnPercent)} tone={result.totalProfit >= 0 ? "positive" : "negative"} strong />
      </RailSection>

      <RailSection title="Risk">
        <div className={styles.riskValue}><span>Max drawdown</span><strong>{formatPercent(result.maxDrawdown.percent)}</strong></div>
        <div className={styles.drawdownStrip}><i style={{ width: `${Math.min(100, Math.abs(result.maxDrawdown.percent) * 2.1)}%` }} /></div>
        <AuditRow label="Peak" value={result.maxDrawdown.peakDate ?? "—"} />
        <AuditRow label="Trough" value={result.maxDrawdown.troughDate ?? "—"} />
        <AuditRow label="Recovery" value={result.maxDrawdown.recoveryDate ?? "Not recovered"} />
        <p className={styles.railFootnote}>Cash-flow-neutral unit value prevents contributions from being counted as performance.</p>
      </RailSection>

      <button type="button" className={styles.aiCard} onClick={onAssistant}>
        <div><Sparkles size={18} /><strong>AI analysis</strong><ArrowRight size={16} /></div>
        <p>
          {topHolding
            ? `${topHolding.ticker} is the strongest profit contributor in this run. Ask for a plain-language explanation grounded only in this report.`
            : "Ask a plain-language question about this portfolio report."}
        </p>
        <span>Open report assistant</span>
      </button>
    </div>
  );
}

function AssistantDrawer({
  report,
  mode,
  onClose,
}: {
  report: PortfolioReport;
  mode: ResultMode;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || loading) return;
    setError("");
    setLoading(true);
    setQuestion("");
    const prior = messages;
    setMessages([...prior, { role: "user", text: nextQuestion }]);
    try {
      const answer = await askPortfolioAssistant({
        report,
        scenario: mode,
        question: nextQuestion,
        history: prior,
      });
      setMessages([...prior, { role: "user", text: nextQuestion }, { role: "assistant", text: answer }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assistant is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div className={styles.drawerOverlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.aside
        className={styles.assistantDrawer}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 270 }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="AI report analyst"
      >
        <div className={styles.drawerHeader}>
          <div><span><Sparkles size={16} /></span><div><strong>Stock Lens AI</strong><small>Report-grounded analyst</small></div></div>
          <button type="button" aria-label="Close AI analyst" onClick={onClose}><X size={18} /></button>
        </div>
        <div className={styles.aiGuardrail}><ShieldCheck size={15} /><span>Uses only this report. It explains results but never gives buy, sell, timing, or allocation advice.</span></div>
        <div className={styles.messageList}>
          {messages.length === 0 ? (
            <div className={styles.aiEmpty}>
              <Bot size={30} />
              <h2>Understand the numbers.</h2>
              <p>Ask why the return differs from the stock chart, how taxes affected the result, or what caused the drawdown.</p>
              <div>
                {["Explain my total return", "What caused the max drawdown?", "Break down fees and taxes"].map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>{prompt}</button>
                ))}
              </div>
            </div>
          ) : messages.map((message, index) => (
            <motion.div
              key={`${message.role}-${index}`}
              className={message.role === "assistant" ? styles.assistantMessage : styles.userMessage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <span>{message.role === "assistant" ? <Sparkles size={13} /> : "YOU"}</span>
              <p>{message.text}</p>
            </motion.div>
          ))}
          {loading ? <div className={styles.thinking}><i /><i /><i /><span>Reading your report</span></div> : null}
          {error ? <div className={styles.aiError}>{error}</div> : null}
        </div>
        <form className={styles.aiComposer} onSubmit={(event) => void submit(event)}>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about this backtest…"
            maxLength={500}
            rows={3}
          />
          <div><span>{question.length}/500</span><button type="submit" disabled={!question.trim() || loading}>Ask analyst <ArrowRight size={14} /></button></div>
        </form>
      </motion.aside>
    </motion.div>
  );
}

function Metric({
  label,
  value,
  formatter,
  tone,
}: {
  label: string;
  value: number;
  formatter: (value: number) => string;
  tone?: "positive" | "negative";
}) {
  const [display, setDisplay] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      const frame = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / 780);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, value]);
  return (
    <motion.div className={styles.metric} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }}>
      <span>{label}</span>
      <strong className={tone === "positive" ? styles.positive : tone === "negative" ? styles.negative : undefined}>{formatter(display)}</strong>
    </motion.div>
  );
}

function FeeEditor({
  title,
  ruleKey,
  value,
  errors,
  onChange,
}: {
  title: string;
  ruleKey: "buy" | "sell" | "dividendReinvestment";
  value: FeeRule;
  errors: FieldErrors;
  onChange: (value: FeeRule) => void;
}) {
  const fields: Array<{ key: keyof FeeRule; label: string }> = [
    { key: "fixed", label: "Fixed $" },
    { key: "perShare", label: "$/share" },
    { key: "percentOfValue", label: "% value" },
    { key: "minimum", label: "Minimum $" },
    { key: "maximum", label: "Maximum $" },
  ];
  return (
    <fieldset className={styles.feeEditor}>
      <legend>{title}</legend>
      <div>
        {fields.map((field) => {
          const errorKey = `fee-${ruleKey}-${String(field.key)}`;
          const inputId = `${errorKey}-input`;
          return (
            <div className={styles.feeField} key={field.key}>
              <label htmlFor={inputId}>{field.label}</label>
              <input
                id={inputId}
                type="number"
                min="0"
                step="0.000001"
                value={value[field.key] ?? ""}
                placeholder="None"
                aria-invalid={Boolean(errors[errorKey])}
                aria-describedby={errors[errorKey] ? `${errorKey}-error` : undefined}
                onChange={(event) => onChange({
                  ...value,
                  [field.key]: event.target.value === "" && field.key === "maximum" ? undefined : safeNumber(event.target.value),
                })}
              />
              {errors[errorKey] ? <small className={styles.fieldError} id={`${errorKey}-error`}>{errors[errorKey]}</small> : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  const resolvedErrorId = errorId ?? (htmlFor ? `${htmlFor}-error` : undefined);
  return (
    <div className={styles.field}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {children}
      {error ? <small className={styles.fieldError} id={resolvedErrorId}>{error}</small> : null}
    </div>
  );
}

function SegmentedControl({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          className={value === option.value ? styles.segmentActive : undefined}
          onClick={() => onChange(option.value)}
        >
          {value === option.value ? <motion.i initial={{ opacity: 0 }} animate={{ opacity: 1 }} /> : null}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ icon, title, meta }: { icon: React.ReactNode; title: string; meta?: string }) {
  return <div className={styles.sectionLabel}><span>{icon}{title}</span>{meta ? <small>{meta}</small> : null}</div>;
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return <header className={styles.panelHeader}><h2>{title}</h2><span>{meta}</span></header>;
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={styles.railSection}><h2>{title}</h2>{children}</section>;
}

function AuditRow({
  label,
  value,
  tone,
  strong,
  verified,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  strong?: boolean;
  verified?: boolean;
}) {
  return (
    <div className={`${styles.auditRow} ${strong ? styles.auditStrong : ""}`}>
      <span>{label}</span>
      <strong className={tone === "positive" ? styles.positive : tone === "negative" ? styles.negative : undefined}>{value}{verified ? <Check size={12} /> : null}</strong>
    </div>
  );
}

function TickerBadge({ ticker }: { ticker: string }) {
  const normalized = ticker.trim().toUpperCase();
  if (normalized === "AAPL") {
    return <span className={`${styles.tickerBadge} ${styles.appleBadge}`} aria-hidden="true"><Apple size={17} fill="currentColor" /></span>;
  }
  if (normalized === "GOOG" || normalized === "GOOGL") {
    return <span className={`${styles.tickerBadge} ${styles.googleBadge}`} aria-hidden="true">G</span>;
  }
  if (normalized === "MSFT") {
    return <span className={`${styles.tickerBadge} ${styles.microsoftBadge}`} aria-hidden="true"><i /><i /><i /><i /></span>;
  }
  const palette = ["#5b8cff", "#19b89e", "#9b8cff", "#d99a47", "#f05d69"];
  const color = palette[normalized.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
  return <span className={styles.tickerBadge} style={{ color, borderColor: `${color}55`, background: `${color}12` }}>{normalized.slice(0, 1) || "?"}</span>;
}

function WorkspaceLoading({ loading }: { loading: boolean }) {
  return (
    <div className={styles.emptyWorkspace}>
      <span><Activity size={26} /></span>
      <h1>{loading ? "Building your portfolio timeline" : "Ready for an exact-session backtest"}</h1>
      <p>{loading ? "Aligning trading dates, adjusted prices, dividends, taxes, and fees." : "Configure any number of US stocks or ETFs, then run the model."}</p>
      {loading ? <div className={styles.loadingTrack}><i /></div> : null}
    </div>
  );
}

function InsightsLoading() {
  return <div className={styles.insightsEmpty}><Sparkles size={24} /><strong>Audit-ready results</strong><p>Execution, return attribution, risk, and AI explanations will appear here.</p></div>;
}

function AmbientBackground() {
  return <div className={styles.ambient} aria-hidden="true"><i /><i /><i /></div>;
}

function createDefaultInput(): PortfolioInput {
  const today = todayDateString();
  return {
    positions: [
      { id: "holding-aapl", ticker: "AAPL", investment: { mode: "amount", value: 500, intervalValue: 1, intervalUnit: "months" } },
      { id: "holding-goog", ticker: "GOOG", investment: { mode: "amount", value: 500, intervalValue: 1, intervalUnit: "months" } },
      { id: "holding-msft", ticker: "MSFT", investment: { mode: "amount", value: 500, intervalValue: 1, intervalUnit: "months" } },
    ],
    startDate: addYearsClamped(today, -8),
    endDate: today,
    taxMode: "pre-tax",
    dividendTaxRate: 30,
    liquidateAtEnd: false,
    capitalGainsTaxRate: 0,
    fees: getBrokerPreset("ibkr-lite"),
  };
}

function validatePortfolio(input: PortfolioInput): { summary?: string; fields: FieldErrors } {
  const fields: FieldErrors = {};
  let formError: string | undefined;

  if (input.positions.length === 0) formError = "Add at least one holding.";

  const tickers = input.positions.map((position) => position.ticker.trim().toUpperCase());
  input.positions.forEach((position, index) => {
    const ticker = tickers[index];
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
      fields[`ticker-${position.id}`] = "Enter a valid US ticker, such as NVDA, VOO, or BRK.B.";
    } else if (tickers.filter((candidate) => candidate === ticker).length > 1) {
      fields[`ticker-${position.id}`] = "Each ticker can appear only once.";
    }

    if (!Number.isFinite(position.investment.value) || position.investment.value <= 0) {
      fields[`order-${position.id}`] = position.investment.mode === "amount"
        ? "Cash per order must be greater than $0."
        : "Shares per order must be greater than 0.";
    }
    if (!Number.isInteger(position.investment.intervalValue) || position.investment.intervalValue <= 0) {
      fields[`interval-${position.id}`] = "Interval must be a positive whole number.";
    }
  });

  if (!isValidDateString(input.startDate) || input.startDate < "1990-01-01") {
    fields.startDate = "Choose a valid date on or after Jan 1, 1990.";
  }
  if (!isValidDateString(input.endDate)) {
    fields.endDate = "Choose a valid end date.";
  }
  if (!fields.startDate && !fields.endDate && input.startDate > input.endDate) {
    fields.startDate = "Start date must be on or before the end date.";
    fields.endDate = "End date must be on or after the start date.";
  }

  if (input.taxMode === "after-tax" && !isPercent(input.dividendTaxRate)) {
    fields.dividendTaxRate = "Dividend withholding must be between 0% and 100%.";
  }
  if (input.liquidateAtEnd && !isPercent(input.capitalGainsTaxRate)) {
    fields.capitalGainsTaxRate = "Capital gains tax must be between 0% and 100%.";
  }

  const feeRules: Array<{ key: "buy" | "sell" | "dividendReinvestment"; value: FeeRule }> = [
    { key: "buy", value: input.fees.buy },
    { key: "sell", value: input.fees.sell },
    { key: "dividendReinvestment", value: input.fees.dividendReinvestment },
  ];
  const feeFields: Array<keyof FeeRule> = ["fixed", "perShare", "percentOfValue", "minimum", "maximum"];
  feeRules.forEach(({ key, value }) => {
    feeFields.forEach((field) => {
      const amount = value[field];
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
        fields[`fee-${key}-${String(field)}`] = "Fee values cannot be negative.";
      }
    });
    if (value.maximum !== undefined && value.maximum < value.minimum) {
      fields[`fee-${key}-maximum`] = "Maximum must be at least the minimum fee.";
    }
  });

  const hasFieldErrors = Object.keys(fields).length > 0;
  return {
    fields,
    summary: formError ?? (hasFieldErrors ? "Fix the highlighted fields before running the backtest." : undefined),
  };
}

function isPercent(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function portfolioTitle(tickers: string[]): string {
  if (tickers.length <= 4) return tickers.join(" · ");
  return `${tickers.slice(0, 4).join(" · ")} +${tickers.length - 4}`;
}

function companyLabel(ticker: string): string {
  const names: Record<string, string> = {
    AAPL: "Apple Inc.",
    GOOG: "Alphabet Inc., Class C",
    GOOGL: "Alphabet Inc., Class A",
    MSFT: "Microsoft Corporation",
    NVDA: "NVIDIA Corporation",
    SPY: "SPDR S&P 500 ETF Trust",
    SOXL: "Direxion Semiconductor Bull 3X",
    RYCEY: "Rolls-Royce Holdings ADR",
  };
  return names[ticker.trim().toUpperCase()] ?? "US stock or ETF";
}

function selectResult(report: PortfolioReport | undefined, mode: ResultMode): PortfolioAggregateResult | undefined {
  if (!report) return undefined;
  if (mode === "historical") return report.historical;
  return report.projection?.scenarios.find((scenario) => scenario.id === mode)?.result;
}

function selectHoldingResults(report: PortfolioReport | undefined, mode: ResultMode) {
  if (!report) return [];
  return report.holdings.flatMap((holding) => {
    const result = mode === "historical"
      ? holding.report.historical
      : holding.report.projection?.scenarios.find((scenario) => scenario.id === mode)?.result;
    return result ? [{ ticker: holding.position.ticker, result }] : [];
  });
}

function labelScenario(mode: Exclude<ResultMode, "historical">) {
  if (mode === "conservative") return "Conservative";
  if (mode === "optimistic") return "Optimistic";
  return "Baseline";
}

function compactCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return formatCurrency(value);
}

function safeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
