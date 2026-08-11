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
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Info,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  MessageSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { AppShell } from "@/components/app-shell";
import { EvidenceModeNotice } from "@/components/evidence-mode-notice";
import { brokerPresets, getBrokerPreset } from "@/constants/broker-presets";
import { PortfolioPerformanceChart } from "@/components/portfolio-performance-chart";
import { MAX_DCA_HOLDINGS } from "@/domain/dca-limits";
import { type Translate, type TranslationKey, useLanguage } from "@/i18n/language";
import { useServiceReadiness } from "@/components/readiness-provider";
import { createPortfolioReport } from "@/services/create-portfolio-report";
import {
  askPortfolioAssistant,
  type AssistantMessage,
} from "@/services/assistant-api";
import { exportPortfolioPdf } from "@/services/pdf-export";
import type {
  BacktestResult,
  FeeComponentKind,
  FeeConfig,
  FeeRule,
  IntervalUnit,
  MoneyWeightedReturn,
  PortfolioAggregateResult,
  PortfolioInput,
  PortfolioPositionInput,
  PortfolioReport,
  ProjectionScenarioId,
  TimeWeightedReturn,
} from "@/types/backtest";
import { addYearsClamped, todayDateString } from "@/utils/date";
import { formatCurrency, formatPercent } from "@/utils/format";

import styles from "./dca-backtest-dashboard.module.css";

type LoadingMode = "live" | "demo";
type ResultMode = ProjectionScenarioId | "historical";
type FieldErrors = Record<string, string>;

/** Browser-local portfolio label, stored under the shared `investiq-` key namespace. */
const PORTFOLIO_NAME_STORAGE_KEY = "investiq-dca-portfolio-name";

const intervalOptions: Array<{ labelKey: TranslationKey; value: IntervalUnit }> = [
  { labelKey: "holding.day", value: "trading-days" },
  { labelKey: "holding.week", value: "weeks" },
  { labelKey: "holding.month", value: "months" },
  { labelKey: "holding.year", value: "years" },
];

export function DcaBacktestDashboard() {
  const { t } = useLanguage();
  const { readiness } = useServiceReadiness();
  const health = readiness.dca;
  const [input, setInput] = useState<PortfolioInput>(createDefaultInput);
  const [portfolioName, setPortfolioName] = useState("Portfolio 01");
  const [report, setReport] = useState<PortfolioReport>();
  const [resultMode, setResultMode] = useState<ResultMode>("historical");
  const [loadingMode, setLoadingMode] = useState<LoadingMode | undefined>();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [advancedFees, setAdvancedFees] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const inputRevisionRef = useRef(0);

  useEffect(() => {
    const restoreName = window.setTimeout(() => {
      try {
        const savedName = window.localStorage.getItem(PORTFOLIO_NAME_STORAGE_KEY)?.trim();
        if (savedName) setPortfolioName(savedName);
      } catch {
        // The portfolio remains usable when browser storage is blocked.
      }
    });
    return () => window.clearTimeout(restoreName);
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

  function renamePortfolio(name: string) {
    const nextName = name.trim() || "Portfolio 01";
    setPortfolioName(nextName);
    try {
      window.localStorage.setItem(PORTFOLIO_NAME_STORAGE_KEY, nextName);
    } catch {
      // The label still works for this session when persistence is unavailable.
    }
  }

  function addHolding() {
    setError("");
    if (input.positions.length >= MAX_DCA_HOLDINGS) {
      setError(t("validation.holdingLimit", { count: MAX_DCA_HOLDINGS }));
      return;
    }
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
    if (!demo && health !== "ready") {
      setError(t("run.liveUnavailable"));
      return;
    }
    const validation = validatePortfolio(input, t);
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
        setError(t("error.inputsChanged"));
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
        setError(caught instanceof Error ? caught.message : t("error.backtest"));
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
      scenarioLabel: resultMode === "historical" ? undefined : labelScenario(resultMode, t),
    });
  }

  return (
    <AppShell>
      <div className={styles.appShell}>
      <header className={styles.quietPageHead}>
        <h1>{t(health !== "ready" || report?.source === "demo" ? "dca.titleSynthetic" : "dca.title")}</h1>
        <p>{t(health !== "ready" || report?.source === "demo" ? "dca.subtitleSynthetic" : "dca.subtitle")}</p>
        <span>{health === "ready" ? t("header.liveCapability") : t("header.publicDemoAvailable")}</span>
      </header>

      <div className={`${styles.dashboardGrid} ${setupCollapsed ? styles.setupCollapsed : ""}`}>
        <aside className={`${styles.builder} ${setupCollapsed ? styles.builderCollapsed : ""}`} aria-label={t("builder.setup")}>
          <BuilderHeader
            name={portfolioName}
            collapsed={setupCollapsed}
            onRename={renamePortfolio}
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
              disabled={input.positions.length >= MAX_DCA_HOLDINGS}
              onClick={addHolding}
            >
              <Plus size={15} /> {t("holding.add")}
            </motion.button>
            <p className={styles.sequentialHint}>{t("holding.limit", { count: MAX_DCA_HOLDINGS })}</p>

            <div className={styles.builderDivider} />
            <SectionLabel icon={<CalendarDays size={14} />} title={t("date.window")} />
            <div className={styles.dateRow}>
              <Field label={t("date.start")} htmlFor="start-date" error={fieldErrors.startDate}>
                <input
                  id="start-date"
                  className={styles.input}
                  type="date"
                  min="1990-01-01"
                  max={todayDateString()}
                  value={input.startDate}
                  aria-invalid={Boolean(fieldErrors.startDate)}
                  aria-describedby={fieldErrors.startDate ? "start-date-error" : undefined}
                  onChange={(event) => updateInput((current) => ({ ...current, startDate: event.target.value }))}
                />
              </Field>
              <span className={styles.dateConnector}>{t("date.to")}</span>
              <Field label={t("date.end")} htmlFor="end-date" error={fieldErrors.endDate}>
                <input
                  id="end-date"
                  className={styles.input}
                  type="date"
                  min="1990-01-01"
                  max={todayDateString()}
                  value={input.endDate}
                  aria-invalid={Boolean(fieldErrors.endDate)}
                  aria-describedby={fieldErrors.endDate ? "end-date-error" : undefined}
                  onChange={(event) => updateInput((current) => ({ ...current, endDate: event.target.value }))}
                />
              </Field>
            </div>
            <p className={styles.helperText}>{t("date.nonTrading")}</p>

            <details className={styles.advancedAssumptions}>
              <summary>{t("dca.advancedTitle")}</summary>
              <p className={styles.advancedIntro}>{t("dca.advancedText")}</p>
            <div className={styles.builderDivider} />
            <SectionLabel icon={<ShieldCheck size={14} />} title={t("tax.section")} />
            <Field label={t("tax.basis")}>
              <SegmentedControl
                ariaLabel={t("tax.basis")}
                value={input.taxMode}
                options={[
                  { label: t("tax.pretax"), value: "pre-tax" },
                  { label: t("tax.aftertax"), value: "after-tax" },
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
                    <label htmlFor="withholding-rate">{t("tax.dividendWithholding")}</label>
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
                <strong>{t("tax.liquidate")}</strong>
                <small>{t("tax.finalClose")}</small>
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
                  <label htmlFor="capital-gains-rate">{t("tax.capitalGains")}</label>
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
            <SectionLabel icon={<BarChart3 size={14} />} title={t("broker.section")} />
            <Field label={t("broker.plan")} htmlFor="broker-plan">
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
              <Field label={t("broker.planName")} htmlFor="broker-plan-name">
                <input
                  id="broker-plan-name"
                  className={styles.input}
                  value={input.fees.brokerName}
                  onChange={(event) => updateInput((current) => ({ ...current, fees: { ...current.fees, brokerName: event.target.value } }))}
                  placeholder={t("broker.placeholder")}
                />
              </Field>
            ) : null}
            <button type="button" className={styles.feeDisclosure} onClick={() => setAdvancedFees((value) => !value)}>
              <span><Info size={13} /> {advancedFees ? t("broker.hideFees") : input.fees.kind === "custom" ? t("broker.reviewFees") : t("broker.reviewScenario")}</span>
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
                  {input.fees.kind === "custom" ? (
                    <>
                      <FeeEditor title={t("broker.buyOrder")} ruleKey="buy" value={input.fees.buy} errors={fieldErrors} onChange={(buy) => updateInput((current) => ({ ...current, fees: { ...current.fees, buy } }))} />
                      <FeeEditor title={t("broker.sellOrder")} ruleKey="sell" value={input.fees.sell} errors={fieldErrors} onChange={(sell) => updateInput((current) => ({ ...current, fees: { ...current.fees, sell } }))} />
                      <FeeEditor title={t("broker.dividendReinvestment")} ruleKey="dividendReinvestment" value={input.fees.dividendReinvestment} errors={fieldErrors} onChange={(dividendReinvestment) => updateInput((current) => ({ ...current, fees: { ...current.fees, dividendReinvestment } }))} />
                      <p className={styles.brokerNote}>{t("broker.customNoHidden")}</p>
                    </>
                  ) : (
                    <BrokerScenarioDisclosure fees={input.fees} />
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <p className={styles.brokerNote}>{localizedBrokerNote(input.fees.brokerId, input.fees.notes, t)} {t("broker.checked", { date: input.fees.checkedDate })}</p>
            </details>

            {error ? (
              <motion.div className={styles.errorBanner} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert">
                <CircleHelp size={16} />
                <span>{error}</span>
              </motion.div>
            ) : null}

          </div>
          <div className={styles.builderActionBar}>
            <button
              type="button"
              className={styles.runButton}
              disabled={Boolean(loadingMode) || health === "checking"}
              onClick={() => void run(health !== "ready")}
            >
              <span className={styles.runIcon}>
                {loadingMode ? <LoaderCircle size={17} className={styles.spin} /> : <Play size={15} aria-hidden="true" />}
              </span>
              <span className={styles.runLabel}>
                {loadingMode ? t("run.calculating") : health === "checking" ? t("run.checking") : health === "ready" ? t("run.liveBacktest") : t("run.demo")}
              </span>
            </button>
            <p className={styles.dataModeLine}>{health === "ready" ? t("run.liveDataAvailable") : t("run.syntheticDataNotice")}</p>
          </div>
        </aside>

        <section className={styles.workspace} ref={workspaceRef} id="portfolio-lab">
          {health !== "ready" || report?.source === "demo" ? (
            <EvidenceModeNotice
              id="dca-demo-title"
              provenance={report?.source === "demo" ? report.provenance : undefined}
            />
          ) : null}
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

        {selected && report ? (
          <aside className={styles.resultActions} aria-label={t("audit.summaryAria")}>
            <button type="button" onClick={() => setAssistantOpen(true)} disabled={readiness.assistant !== "ready"}>
              <MessageSquare size={15} aria-hidden="true" /> {t("run.explainResults")}
            </button>
            <button type="button" onClick={exportPdf}>
              <Download size={15} aria-hidden="true" /> {t("header.exportPdf")}
            </button>
            <details>
              <summary>{t("run.resultDetails")}</summary>
              <InsightsRail result={selected} report={report} holdingResults={holdingResults} />
            </details>
          </aside>
        ) : null}
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
      </div>
    </AppShell>
  );
}

function BuilderHeader({
  name,
  collapsed,
  onRename,
  onToggle,
}: {
  name: string;
  collapsed: boolean;
  onRename: (name: string) => void;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [editing]);

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onRename(draftName);
    setEditing(false);
  }

  function cancelEdit() {
    setDraftName(name);
    setEditing(false);
  }

  return (
    <div className={styles.builderHeader}>
      <button
        type="button"
        className={styles.builderToggle}
        aria-expanded={!collapsed}
        aria-controls="backtest-setup-controls"
        aria-label={collapsed ? t("builder.expand") : t("builder.collapse")}
        onClick={onToggle}
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span>{t("builder.setup")}</span>
      </button>
      <div className={styles.portfolioHeading}>
        {editing ? (
          <form className={styles.portfolioNameEditor} onSubmit={saveName}>
            <input
              ref={nameInputRef}
              value={draftName}
              maxLength={40}
              aria-label={t("builder.portfolioName")}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelEdit();
              }}
            />
            <button type="submit" aria-label={t("builder.saveName")} title={t("builder.saveName")}>
              <Check size={14} />
            </button>
            <button type="button" aria-label={t("builder.cancelName")} title={t("builder.cancelName")} onClick={cancelEdit}>
              <X size={14} />
            </button>
          </form>
        ) : (
          <div className={styles.portfolioNameDisplay}>
            <strong>{name}</strong>
            <button
              type="button"
              className={styles.editPortfolioName}
              aria-label={t("builder.rename", { name })}
              title={t("builder.renameTitle")}
              onClick={() => {
                setDraftName(name);
                setEditing(true);
              }}
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
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
  const { t } = useLanguage();
  const tickerKey = `ticker-${position.id}`;
  const orderKey = `order-${position.id}`;
  const intervalKey = `interval-${position.id}`;
  const tickerInputId = `${position.id}-ticker`;
  const orderInputId = `${position.id}-order-value`;
  const intervalInputId = `${position.id}-interval-value`;
  return (
    <div
      className={styles.holdingCard}
    >
      <div className={styles.holdingTopline}>
        <span className={styles.holdingIndex}>{index + 1}</span>
        <div className={styles.tickerIdentity}>
          <TickerBadge ticker={position.ticker || "?"} />
          <label htmlFor={tickerInputId}>
            <input
              id={tickerInputId}
              aria-label={t("holding.tickerAria", { count: index + 1 })}
              aria-invalid={Boolean(errors[tickerKey])}
              aria-describedby={errors[tickerKey] ? `${tickerKey}-error` : undefined}
              value={position.ticker}
              maxLength={12}
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t("holding.tickerPlaceholder")}
              onChange={(event) => onChange({ ticker: event.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "") })}
            />
            <small>{position.ticker ? t("holding.companyCode", { ticker: position.ticker }) : t("holding.enterTicker")}</small>
          </label>
        </div>
        {removable ? (
          <button type="button" aria-label={t("holding.remove", { count: index + 1 })} className={styles.iconButton} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        ) : <span className={styles.iconSpacer} />}
      </div>
      {errors[tickerKey] ? <small className={styles.fieldError} id={`${tickerKey}-error`}>{errors[tickerKey]}</small> : null}
      <div className={styles.orderRow}>
        <Field
          label={position.investment.mode === "amount" ? t("holding.usdPerOrder") : t("holding.sharesPerOrder")}
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
        <Field label={t("holding.repeat")} htmlFor={intervalInputId} error={errors[intervalKey]} errorId={`${intervalKey}-error`}>
          <div className={styles.intervalControl}>
            <select
              id={intervalInputId}
              aria-label={t("holding.intervalUnit", { count: index + 1 })}
              value={position.investment.intervalUnit}
              onChange={(event) => onChange({ investment: { ...position.investment, intervalUnit: event.target.value as IntervalUnit } })}
            >
              {intervalOptions.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
            </select>
          </div>
        </Field>
      </div>
      <details className={styles.holdingAdvanced}>
        <summary>{t("holding.orderType")}</summary>
        <Field label={t("holding.orderType")}>
          <SegmentedControl
            ariaLabel={`${t("holding.orderType")} ${index + 1}`}
            value={position.investment.mode}
            options={[{ label: t("holding.cash"), value: "amount" }, { label: t("holding.shares"), value: "shares" }]}
            onChange={(mode) => onChange({ investment: { ...position.investment, mode: mode as "amount" | "shares" } })}
          />
        </Field>
        <Field label={t("holding.every")}>
          <input
            aria-label={t("holding.intervalCount", { count: index + 1 })}
            className={styles.input}
            type="number"
            min="1"
            step="1"
            value={position.investment.intervalValue}
            onChange={(event) => onChange({ investment: { ...position.investment, intervalValue: safeNumber(event.target.value) } })}
          />
        </Field>
      </details>
    </div>
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
  const { t } = useLanguage();
  const projectionOptions = report.projection?.scenarios ?? [];
  const baselineProjection = projectionOptions.find((scenario) => scenario.id === "baseline") ?? projectionOptions[0];
  const positive = result.totalProfit >= 0;
  const transactions = showAllTransactions ? [...result.transactions].reverse() : result.transactions.slice(-7).reverse();

  return (
    <div key={`${report.source}-${resultMode}-${result.endDate}`}>
      <div className={styles.resultHeader}>
        <div>
          <div className={styles.resultTitleRow}>
            <h1>{t(report.source === "demo" ? "result.performanceSynthetic" : "result.performance")}</h1>
            <span className={report.source === "demo" ? styles.demoPill : styles.livePill}>
              <i /> {report.source === "demo" ? t("result.synthetic") : t("result.verified")}
            </span>
          </div>
          <div className={styles.scenarioTabs} role="group" aria-label={t("result.scenario")}>
            <button
              type="button"
              className={resultMode === "historical" ? styles.scenarioActive : undefined}
              disabled={!report.historical}
              onClick={() => onResultMode("historical")}
            >
              {t(report.source === "demo" ? "result.syntheticSeries" : "result.historical")}
            </button>
            <button
              type="button"
              className={resultMode !== "historical" ? styles.scenarioActive : undefined}
              disabled={!baselineProjection}
              title={baselineProjection ? t("result.openSimulation") : t("result.chooseFuture")}
              onClick={() => baselineProjection && onResultMode(baselineProjection.id)}
            >
              {t("result.projected")}
            </button>
          </div>
        </div>
        <div className={styles.resultContext}>
          <button type="button" aria-label={t("result.details")} title={`${portfolioTitle(holdingResults.map((item) => item.ticker))} · ${result.startDate} ${t("date.to")} ${result.endDate}`}><Info size={16} /></button>
          <p>{result.startDate} — {result.endDate} · {t(result.holdingsCount === 1 ? "run.holding" : "run.holdings", { count: result.holdingsCount })} · {formatLocalizedDuration(result.durationDays, t)}</p>
        </div>
      </div>

      {resultMode !== "historical" ? (
        <div className={styles.simulationBanner}>
          <Zap size={15} />
          <span><strong>{t("result.simulationTitle")}</strong> {t(report.source === "demo" ? "result.simulationTextSynthetic" : "result.simulationText")}</span>
          <div className={styles.projectionScenarioTabs} role="group" aria-label={t("result.projectionAssumption")}>
            {projectionOptions.map((scenario) => (
              <button type="button" key={scenario.id} className={resultMode === scenario.id ? styles.projectionScenarioActive : undefined} onClick={() => onResultMode(scenario.id)}>{labelScenario(scenario.id, t)}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.metricGrid}>
        <Metric label={t("result.finalValue")} value={result.finalAmount} formatter={formatCurrency} />
        <Metric label={t("result.netContributions")} value={result.totalContributions} formatter={formatCurrency} />
        <Metric label={t("result.netGainLoss")} value={result.totalProfit} formatter={formatCurrency} tone={positive ? "positive" : "negative"} />
        <Metric label={t("result.maxDrawdown")} value={result.maxDrawdown.percent} formatter={formatPercent} tone="negative" />
      </div>

      <PortfolioPerformanceChart result={result} synthetic={report.source === "demo"} />

      <div className={styles.lowerGrid}>
        {/* Reveals on mount, not on scroll: a scroll-triggered fade left these panels blank
            below the fold, which read as a large empty gap on mobile. */}
        <section className={styles.panel}>
          <PanelHeader title={t("result.attribution")} meta={t("result.contributionWeighted")} />
          <div className={styles.attributionHeader}>
            <span>{t("result.ticker")}</span><span>{t("result.finalValue")}</span><span>{t("result.return")}</span><span>{t("result.portfolio")}</span>
          </div>
          {holdingResults.map((holding) => {
            const allocation = result.finalAmount > 0 ? holding.result.finalAmount / result.finalAmount * 100 : 0;
            return (
              <div className={styles.attributionRow} key={holding.ticker}>
                <div><TickerBadge ticker={holding.ticker} /><span><strong>{holding.ticker}</strong><small>{holding.result.companyName}</small></span></div>
                <strong>{compactCurrency(holding.result.finalAmount)}</strong>
                <strong className={holding.result.netGainRatioPercent >= 0 ? styles.positive : styles.negative}>{formatPercent(holding.result.netGainRatioPercent)}</strong>
                <div className={styles.allocationCell}><span>{allocation.toFixed(1)}%</span><i><b style={{ width: `${Math.min(100, allocation)}%` }} /></i></div>
              </div>
            );
          })}
        </section>

        <section className={styles.panel}>
          <PanelHeader title={t("result.recentTransactions")} meta={t("result.totalCount", { count: result.transactions.length })} />
          <div
            className={styles.transactionScroller}
            role="region"
            aria-label={t("result.recentTransactions")}
            tabIndex={0}
          >
            <div className={styles.transactionHeader}>
              <span>{t("result.date")}</span><span>{t("result.ticker")}</span><span>{t("result.action")}</span><span>{t("holding.shares")}</span><span>{t(report.source === "demo" ? "result.syntheticPrice" : "result.price")}</span>
            </div>
            {transactions.map((transaction, index) => {
              const isAdjustment = transaction.type === "portfolio-tax-adjustment";
              return (
                <div className={styles.transactionRow} key={`${transaction.date}-${transaction.ticker}-${transaction.type}-${index}`}>
                  <span>{transaction.date}</span>
                  <strong>{transaction.ticker ?? "—"}</strong>
                  <span>{transactionActionLabel(transaction.type, t)}</span>
                  <span>{isAdjustment ? "—" : transaction.shares.toFixed(3)}</span>
                  <span>{isAdjustment ? "—" : formatCurrency(transaction.price)}</span>
                </div>
              );
            })}
          </div>
          <button type="button" className={styles.tableAction} onClick={onToggleTransactions}>
            {showAllTransactions ? t("result.showRecent") : t("result.viewAll")} <ArrowRight size={14} />
          </button>
        </section>
      </div>
    </div>
  );
}

function InsightsRail({
  result,
  report,
  holdingResults,
}: {
  result: PortfolioAggregateResult;
  report: PortfolioReport;
  holdingResults: Array<{ ticker: string; result: BacktestResult }>;
}) {
  const { t } = useLanguage();
  void holdingResults;
  const synthetic = report.source === "demo";
  const contributionBase = Math.max(result.totalContributions, 0.000001);
  return (
    <div className={styles.insightScroll}>
      <RailSection title={t("audit.execution")}>
        <AuditRow label={t(synthetic ? "audit.syntheticPurchasePrice" : "audit.purchasePrice")} value={t(synthetic ? "audit.syntheticDailyHigh" : "audit.dailyHigh")} />
        <AuditRow label={t("audit.nonTrading")} value={t("audit.nextSession")} />
        <AuditRow label={t(synthetic ? "audit.syntheticPriceBasis" : "audit.priceBasis")} value={t("audit.priceExcludesDividends")} />
        <AuditRow label={t("audit.dividends")} value={t("audit.payDate")} />
        <AuditRow label={t("audit.dividendCoverage")} value={coverageLabel(report.provenance.dividendCoverage, t)} verified={report.provenance.dividendCoverage === "cross-checked"} />
        <AuditRow label={t("audit.splitCoverage")} value={coverageLabel(report.provenance.splitCoverage, t)} verified={report.provenance.splitCoverage === "cross-checked"} />
        {report.provenance.lastCompletedSession ? (
          <AuditRow label={t("audit.lastSession")} value={report.provenance.lastCompletedSession} />
        ) : null}
        <AuditRow label={t("audit.dataSource")} value={report.source === "demo" ? t("audit.syntheticDemo") : t("audit.liveSource")} verified={report.source !== "demo"} />
        {report.source !== "demo" ? <p className={styles.railFootnote}>{t("audit.coverageLimitation")}</p> : null}
      </RailSection>

      <RailSection title={t(synthetic ? "audit.syntheticPerformanceMeasures" : "audit.performanceMeasures")}>
        <AuditRow label={t("result.netGainRatio")} value={formatPercent(result.netGainRatioPercent)} tone={result.totalProfit >= 0 ? "positive" : "negative"} />
        <AuditRow label={t("result.twrPeriod")} value={formatPercent(result.twr.cumulative * 100)} tone={result.twr.cumulative >= 0 ? "positive" : "negative"} />
        <AuditRow label={t("result.twrAnnualized")} value={twrAnnualizedLabel(result.twr, t)} />
        <AuditRow label={t("result.mwrr")} value={mwrrLabel(result.mwrr, t)} />
        <p className={styles.railFootnote}>{t("audit.measuresNote")}</p>
      </RailSection>

      <RailSection title={t(synthetic ? "audit.syntheticReturnBreakdown" : "audit.returnBreakdown")}>
        <AuditRow label={t(synthetic ? "audit.syntheticStockReturn" : "audit.stockReturn")} value={formatPercent(result.priceReturn / contributionBase * 100)} tone={result.priceReturn >= 0 ? "positive" : "negative"} />
        <AuditRow label={t("audit.dividendReturn")} value={formatPercent(result.grossDividends / contributionBase * 100)} tone="positive" />
        <AuditRow label={t("audit.fees")} value={formatPercent(-result.totalFees / contributionBase * 100)} tone="negative" />
        <AuditRow label={t("audit.taxes")} value={formatPercent(-(result.dividendTax + result.capitalGainsTax) / contributionBase * 100)} tone="negative" />
        <AuditRow label={t("result.netGainRatio")} value={formatPercent(result.netGainRatioPercent)} tone={result.totalProfit >= 0 ? "positive" : "negative"} strong />
      </RailSection>

      {result.feeComponents.length > 0 ? (
        <RailSection title={t("audit.feeBreakdown")}>
          {result.feeComponents.map((line) => (
            <AuditRow key={line.kind} label={feeComponentLabel(line.kind, t)} value={formatCurrency(line.amount)} tone="negative" />
          ))}
          <AuditRow label={t("audit.fees")} value={formatCurrency(result.totalFees)} tone="negative" strong />
          <p className={styles.railFootnote}>{t("audit.feeBreakdownFootnote")}</p>
        </RailSection>
      ) : null}

      {result.liquidation ? (
        <RailSection title={t("audit.liquidationBasis")}>
          <AuditRow label={t("audit.adjustedBasis")} value={formatCurrency(result.liquidation.adjustedTaxBasis)} />
          <AuditRow label={t("audit.netRealized")} value={formatCurrency(result.liquidation.netAmountRealized)} />
          <AuditRow label={t("audit.realizedGainLoss")} value={formatCurrency(result.liquidation.realizedGainLoss)} tone={result.liquidation.realizedGainLoss >= 0 ? "positive" : "negative"} />
          <AuditRow label={t("audit.taxableGain")} value={formatCurrency(result.liquidation.taxableGain)} />
          <AuditRow label={t("audit.capitalGainsTax")} value={formatCurrency(result.liquidation.capitalGainsTax)} tone="negative" />
          <p className={styles.railFootnote}>{t("audit.liquidationBasisFootnote")}</p>
        </RailSection>
      ) : null}

      <RailSection title={t("audit.risk")}>
        <div className={styles.riskValue}><span>{t("result.maxDrawdown")}</span><strong>{formatPercent(result.maxDrawdown.percent)}</strong></div>
        <div className={styles.drawdownStrip}><i style={{ width: `${Math.min(100, Math.abs(result.maxDrawdown.percent) * 2.1)}%` }} /></div>
        <AuditRow label={t("audit.peak")} value={result.maxDrawdown.peakDate ?? "—"} />
        <AuditRow label={t("audit.trough")} value={result.maxDrawdown.troughDate ?? "—"} />
        <AuditRow label={t("audit.recovery")} value={result.maxDrawdown.recoveryDate ?? t("audit.notRecovered")} />
        <p className={styles.railFootnote}>{t("audit.cashFlowFootnote")}</p>
      </RailSection>

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
  const { t } = useLanguage();
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
      setError(caught instanceof Error ? caught.message : t("error.assistant"));
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
        aria-label={t("ai.dialog")}
      >
        <div className={styles.drawerHeader}>
          <div><span><MessageSquare size={16} /></span><div><strong>{t("run.explainResults")}</strong><small>{t("ai.subtitle")}</small></div></div>
          <button type="button" aria-label={t("ai.close")} onClick={onClose}><X size={18} /></button>
        </div>
        <div className={styles.aiGuardrail}><ShieldCheck size={15} /><span>{t("ai.guardrail")}</span></div>
        <div className={styles.messageList}>
          {messages.length === 0 ? (
            <div className={styles.aiEmpty}>
              <Info size={30} />
              <h2>{t("ai.understand")}</h2>
              <p>{t("ai.help")}</p>
              <div>
                {[t("ai.promptReturn"), t("ai.promptDrawdown"), t("ai.promptFees")].map((prompt) => (
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
              <span>{message.role === "assistant" ? <MessageSquare size={13} /> : t("ai.you")}</span>
              <p>{message.text}</p>
            </motion.div>
          ))}
          {loading ? <div className={styles.thinking}><i /><i /><i /><span>{t("ai.reading")}</span></div> : null}
          {error ? <div className={styles.aiError}>{error}</div> : null}
        </div>
        <form className={styles.aiComposer} onSubmit={(event) => void submit(event)}>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t("ai.placeholder")}
            maxLength={500}
            rows={3}
          />
          <div><span>{question.length}/500</span><button type="submit" disabled={!question.trim() || loading}>{t("ai.ask")} <ArrowRight size={14} /></button></div>
        </form>
        <p className={styles.explanationReceipt}>{t("run.explanationReceipt")}</p>
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
  const display = value;
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong className={tone === "positive" ? styles.positive : tone === "negative" ? styles.negative : undefined}>{formatter(display)}</strong>
    </div>
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
  const { t } = useLanguage();
  const fields: Array<{ key: keyof FeeRule; label: string }> = [
    { key: "fixed", label: t("fee.fixed") },
    { key: "perShare", label: t("fee.perShare") },
    { key: "percentOfValue", label: t("fee.percent") },
    { key: "minimum", label: t("fee.minimum") },
    { key: "maximum", label: t("fee.maximum") },
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
                placeholder={t("fee.none")}
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

function BrokerScenarioDisclosure({ fees }: { fees: FeeConfig }) {
  const { t } = useLanguage();
  return (
    <div className={styles.scenarioDisclosure}>
      <p>{t("broker.readOnlyScenario")}</p>
      <p>{t("broker.scenarioGrain")}</p>
      <dl className={styles.scenarioMeta}>
        <div><dt>{t("broker.effective")}</dt><dd>{fees.effectiveDate}</dd></div>
        <div><dt>{t("broker.checkedLabel")}</dt><dd>{fees.checkedDate}</dd></div>
      </dl>
      {fees.sources.length > 0 ? (
        <div className={styles.scenarioSources}>
          <span>{t("broker.sources")}</span>
          <ul>
            {fees.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
  return <span className={styles.tickerBadge} aria-hidden="true">{normalized.slice(0, 1) || "?"}</span>;
}

function WorkspaceLoading({ loading }: { loading: boolean }) {
  const { t } = useLanguage();
  return (
    <div className={styles.emptyWorkspace}>
      <span><Activity size={26} /></span>
      <h1>{loading ? t("workspace.loadingTitle") : t("workspace.readyTitle")}</h1>
      <p>{loading ? t("workspace.loadingText") : t("workspace.readyText")}</p>
      {loading ? <div className={styles.loadingTrack}><i /></div> : null}
    </div>
  );
}

function createDefaultInput(): PortfolioInput {
  const today = todayDateString();
  return {
    positions: [
      { id: "holding-aapl", ticker: "AAPL", investment: { mode: "amount", value: 500, intervalValue: 1, intervalUnit: "months" } },
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

function validatePortfolio(input: PortfolioInput, t: Translate): { summary?: string; fields: FieldErrors } {
  const fields: FieldErrors = {};
  let formError: string | undefined;

  if (input.positions.length === 0) formError = t("validation.addHolding");
  if (input.positions.length > MAX_DCA_HOLDINGS) {
    formError = t("validation.holdingLimit", { count: MAX_DCA_HOLDINGS });
  }

  const tickers = input.positions.map((position) => position.ticker.trim().toUpperCase());
  input.positions.forEach((position, index) => {
    const ticker = tickers[index];
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
      fields[`ticker-${position.id}`] = t("validation.ticker");
    } else if (tickers.filter((candidate) => candidate === ticker).length > 1) {
      fields[`ticker-${position.id}`] = t("validation.uniqueTicker");
    }

    if (!Number.isFinite(position.investment.value) || position.investment.value <= 0) {
      fields[`order-${position.id}`] = position.investment.mode === "amount"
        ? t("validation.cash")
        : t("validation.shares");
    }
    if (!Number.isInteger(position.investment.intervalValue) || position.investment.intervalValue <= 0) {
      fields[`interval-${position.id}`] = t("validation.interval");
    }
  });

  if (!isValidDateString(input.startDate) || input.startDate < "1990-01-01") {
    fields.startDate = t("validation.startDate");
  }
  if (!isValidDateString(input.endDate)) {
    fields.endDate = t("validation.endDate");
  } else if (input.endDate > todayDateString()) {
    fields.endDate = t("validation.futureDisabled");
  }
  if (!fields.startDate && !fields.endDate && input.startDate > input.endDate) {
    fields.startDate = t("validation.startBeforeEnd");
    fields.endDate = t("validation.endAfterStart");
  }

  if (input.taxMode === "after-tax" && !isPercent(input.dividendTaxRate)) {
    fields.dividendTaxRate = t("validation.dividendTax");
  }
  if (input.liquidateAtEnd && !isPercent(input.capitalGainsTaxRate)) {
    fields.capitalGainsTaxRate = t("validation.capitalTax");
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
        fields[`fee-${key}-${String(field)}`] = t("validation.feeNegative");
      }
    });
    if (value.maximum !== undefined && value.maximum < value.minimum) {
      fields[`fee-${key}-maximum`] = t("validation.maximum");
    }
  });

  const hasFieldErrors = Object.keys(fields).length > 0;
  return {
    fields,
    summary: formError ?? (hasFieldErrors ? t("validation.fix") : undefined),
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

function labelScenario(mode: Exclude<ResultMode, "historical">, t: Translate) {
  if (mode === "conservative") return t("result.conservative");
  if (mode === "optimistic") return t("result.optimistic");
  return t("result.baseline");
}

function transactionActionLabel(type: string, t: Translate) {
  if (type === "contribution-buy") return t("result.buy");
  if (type === "dividend-reinvestment") return t("result.dividendReinvest");
  if (type === "portfolio-tax-adjustment") return t("result.portfolioTax");
  return t("result.liquidate");
}

function twrAnnualizedLabel(twr: TimeWeightedReturn, t: Translate): string {
  if (!twr.annualizationEligible || twr.annualized === undefined) {
    return t("result.notAnnualizedUnderYear");
  }
  return formatPercent(twr.annualized * 100);
}

function mwrrLabel(mwrr: MoneyWeightedReturn, t: Translate): string {
  if (mwrr.status === "available" && mwrr.annualizedRate !== undefined) {
    return formatPercent(mwrr.annualizedRate * 100);
  }
  if (mwrr.status === "no-external-flows") return t("result.mwrrNoFlows");
  if (mwrr.status === "not-converged") return t("result.mwrrNotConverged");
  return t("result.mwrrNoSolution");
}

const feeComponentKeys: Record<FeeComponentKind, TranslationKey> = {
  commission: "fee.component.commission",
  platform: "fee.component.platform",
  settlement: "fee.component.settlement",
  "sec-31": "fee.component.sec31",
  "finra-taf": "fee.component.finraTaf",
  cat: "fee.component.cat",
  custom: "fee.component.custom",
};

function feeComponentLabel(kind: FeeComponentKind, t: Translate) {
  return t(feeComponentKeys[kind]);
}

function coverageLabel(
  coverage: "cross-checked" | "not-requested" | "none-reported" | "demo",
  t: Translate,
) {
  if (coverage === "cross-checked") return t("audit.coverageChecked");
  if (coverage === "none-reported") return t("audit.coverageNoneReported");
  if (coverage === "demo") return t("audit.syntheticDemo");
  return t("audit.coverageNotRequested");
}

function formatLocalizedDuration(days: number, t: Translate) {
  if (days < 31) return t("duration.days", { count: days });
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.44);
  if (years === 0) return t("duration.months", { count: months });
  if (months > 0) return `${years}y ${months}m`;
  return t("duration.years", { count: years });
}

function compactCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return formatCurrency(value);
}

function localizedBrokerNote(brokerId: string, fallback: string, t: Translate) {
  const keys: Record<string, TranslationKey> = {
    robinhood: "broker.note.robinhood",
    webull: "broker.note.webull",
    "moomoo-us": "broker.note.moomooUs",
    "moomoo-non-us": "broker.note.moomooNonUs",
    firstrade: "broker.note.firstrade",
    "ibkr-lite": "broker.note.ibkrLite",
    "ibkr-pro-fixed": "broker.note.ibkrFixed",
    "ibkr-pro-tiered": "broker.note.ibkrTiered",
    custom: "broker.note.custom",
  };
  return keys[brokerId] ? t(keys[brokerId]) : fallback;
}

function safeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
