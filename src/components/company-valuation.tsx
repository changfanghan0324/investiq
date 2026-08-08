"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Calculator, CheckCircle2, Database, Info, LoaderCircle, Play, TriangleAlert } from "lucide-react";

import { receiptEconomicYear, type FundamentalsMetricKey, type FundamentalsResult, type FundamentalsSeries } from "@/domain/fundamentals";
import { buildValuationReadiness, type ValuationReadiness } from "@/domain/valuation-readiness";
import {
  ValuationError,
  buildComparableValuation,
  buildDcfValuation,
  buildGrowthMarginSensitivity,
  buildScenarioRange,
  buildWaccTerminalGrowthSensitivity,
  compareToCurrentPrice,
  parseRequiredValuationNumber,
  type DcfAssumptions,
  type DcfScenarioRange,
  type DcfValuation,
  type ComparableMetric,
  type ComparableValuationResult,
  type SensitivityTable,
} from "@/domain/valuation";
import { useLanguage, type Translate } from "@/i18n/language";
import { loadAnalysisMarketData } from "@/services/analysis-market-data";
import { loadCompanyFundamentals } from "@/services/fundamentals-api";
import { saveValuationSnapshot } from "@/services/valuation-snapshot";
import { addYearsClamped, todayDateString } from "@/utils/date";

import styles from "./company-valuation.module.css";
import { FinancialOriginLabel } from "./financial-origin-label";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

type FieldKey = "baseRevenue" | "dilutedShares" | "growth" | "margin" | "tax" | "da" | "capex" | "nwc" | "wacc" | "terminal" | "netDebt" | "currentPrice" | "currentPriceDate";
type FormState = Record<FieldKey, string>;
type ValuationInputOrigin = "sec-direct" | "sec-constructed" | "historical-derived" | "manual-example" | "manual-required" | "user-entered";
type FieldOrigins = Record<FieldKey, ValuationInputOrigin>;

interface ValuationView {
  base: DcfValuation;
  scenarios: DcfScenarioRange;
  waccTerminal: SensitivityTable;
  growthMargin: SensitivityTable;
  current?: ReturnType<typeof compareToCurrentPrice>;
}

const STARTER: FormState = {
  baseRevenue: "",
  dilutedShares: "",
  growth: "5.0",
  margin: "",
  tax: "21.0",
  da: "",
  capex: "4.0",
  nwc: "0.0",
  wacc: "9.0",
  terminal: "2.5",
  netDebt: "",
  currentPrice: "",
  currentPriceDate: "",
};

const STARTER_ORIGINS: FieldOrigins = Object.fromEntries(
  (Object.keys(STARTER) as FieldKey[]).map((key) => [key, STARTER[key] === "" ? "manual-required" : "manual-example"]),
) as FieldOrigins;

export function CompanyValuation({ rawTicker }: { rawTicker: string }) {
  const { t, language } = useLanguage();
  const ticker = safeTicker(rawTicker);
  const [fundamentals, setFundamentals] = useState<FundamentalsResult>();
  const [form, setForm] = useState<FormState>(STARTER);
  const [fieldOrigins, setFieldOrigins] = useState<FieldOrigins>(STARTER_ORIGINS);
  const [priceFromProvider, setPriceFromProvider] = useState(false);
  const [settled, setSettled] = useState(false);
  const [view, setView] = useState<ValuationView>();
  const [comparableMetric, setComparableMetric] = useState<ComparableMetric>("pe");
  const [multiples, setMultiples] = useState({ low: "", median: "", high: "" });
  const [comparable, setComparable] = useState<ComparableValuationResult>();
  const [comparableError, setComparableError] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ticker) return;
    let active = true;
    const today = todayDateString();
    loadCompanyFundamentals(ticker)
      .then((result) => {
        if (!active) return;
        setFundamentals(result);
        const readiness = buildValuationReadiness(result);
        setForm((current) => suggestedForm(result, readiness, current));
        setFieldOrigins((current) => suggestedOrigins(result, readiness, current));
        if (readiness.defaultComparableMethod) setComparableMetric(readiness.defaultComparableMethod);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setSettled(true); });
    loadAnalysisMarketData({ ticker, from: addYearsClamped(today, -1), to: today, requiredStart: addYearsClamped(today, -1) })
      .then((marketData) => {
        const latest = marketData.prices.at(-1);
        if (!active || !latest || marketData.source === "demo") return;
        setForm((current) => ({ ...current, currentPrice: String(latest.close), currentPriceDate: latest.date }));
        setPriceFromProvider(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [ticker]);

  const readiness = useMemo(() => fundamentals ? buildValuationReadiness(fundamentals) : undefined, [fundamentals]);
  const anchors = useMemo(() => readiness ? editableAnchors(readiness, form) : undefined, [readiness, form]);
  const comparableBasis = useMemo(() => fundamentals && anchors ? comparableValues(fundamentals, anchors) : undefined, [fundamentals, anchors]);
  const currentPrice = optionalPositiveFinite(form.currentPrice);
  const datedCurrentPrice = currentPrice !== undefined && isValidQuoteDate(form.currentPriceDate, todayDateString()) ? currentPrice : undefined;
  const canRun = Boolean(anchors && ["growth", "margin", "tax", "da", "capex", "nwc", "wacc", "terminal", "netDebt"].every((key) => optionalFinite(form[key as FieldKey]) !== undefined));

  function updateField(field: FieldKey, value: string, origin: ValuationInputOrigin = "user-entered") {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldOrigins((current) => ({ ...current, [field]: origin }));
    setView(undefined);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!fundamentals || !anchors || !readiness) return;
    try {
      const assumptions = buildAssumptions(form, anchors);
      const base = buildDcfValuation(assumptions);
      const scenarios = buildScenarioRange([
        { id: "bear", assumptions: shiftScenario(assumptions, -0.03, -0.02, 0.01, -0.005) },
        { id: "base", assumptions },
        { id: "bull", assumptions: shiftScenario(assumptions, 0.03, 0.02, -0.01, 0.005) },
      ]);
      const waccTerminal = buildWaccTerminalGrowthSensitivity(
        assumptions,
        around(assumptions.wacc, 0.01),
        around(assumptions.terminalGrowth, 0.005),
      );
      const growthMargin = buildGrowthMarginSensitivity(
        assumptions,
        around(numberRate(form.growth), 0.02),
        around(numberRate(form.margin), 0.02),
      );
      const quoteDate = currentPrice === undefined ? undefined : requiredQuoteDate(form.currentPriceDate, todayDateString(), t);
      const current = currentPrice !== undefined && quoteDate ? compareToCurrentPrice({ impliedSharePrice: base.impliedSharePrice, currentPrice, valuationDate: todayDateString(), quoteDate }) : undefined;
      setView({ base, scenarios, waccTerminal, growthMargin, current });
      const byId = Object.fromEntries(scenarios.scenarios.map((item) => [item.id, item.valuation.impliedSharePrice]));
      saveValuationSnapshot({
        version: 1,
        ticker,
        generatedAt: new Date().toISOString(),
        fiscalYear: anchors.fiscalYear,
        assumptions,
        anchorProvenance: {
          baseRevenue: snapshotAnchor("baseRevenue", anchors.baseRevenue, anchors.fiscalYear, readiness, fieldOrigins.baseRevenue),
          dilutedShares: snapshotAnchor("dilutedShares", anchors.dilutedShares, anchors.fiscalYear, readiness, fieldOrigins.dilutedShares),
          netDebt: snapshotAnchor("netDebt", assumptions.netDebt, anchors.fiscalYear, readiness, fieldOrigins.netDebt),
        },
        values: { bear: byId.bear, base: byId.base, bull: byId.bull, low: scenarios.lowImpliedSharePrice, high: scenarios.highImpliedSharePrice, enterpriseValue: base.bridge.enterpriseValue, equityValue: base.bridge.equityValue, ...(currentPrice !== undefined && quoteDate ? { currentPrice, quoteDate } : {}), ...(current ? { upsideDownside: current.upsideDownside } : {}) },
      });
      setError(undefined);
    } catch (caught) {
      setView(undefined);
      setError(caught instanceof ValuationError ? caught.message : t("valuation.genericError"));
    }
  }

  function submitComparable(event: FormEvent) {
    event.preventDefault();
    if (!anchors || !comparableBasis) return;
    try {
      const financialMetric = comparableBasis[comparableMetric];
      if (financialMetric === undefined) throw new ValuationError(t("valuation.compsMetricUnavailable"));
      const result = buildComparableValuation({ metric: comparableMetric, financialMetric, multiples: { low: finiteNumber(multiples.low, "lowMultiple"), median: finiteNumber(multiples.median, "medianMultiple"), high: finiteNumber(multiples.high, "highMultiple") }, ...(comparableMetric === "pe" ? {} : { netDebt: parseRequiredValuationNumber(form.netDebt, "netDebt"), dilutedShares: anchors.dilutedShares }) });
      setComparable(result);
      setComparableError(undefined);
    } catch (caught) {
      setComparable(undefined);
      setComparableError(caught instanceof Error ? caught.message : t("valuation.genericError"));
    }
  }

  if (!ticker || (settled && !fundamentals)) return <PageState error text={t("valuation.loadError")} />;
  if (!fundamentals || !readiness) return <PageState text={t("valuation.loading")} />;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><span>{t("valuation.eyebrow")}</span><h1>{t("valuation.title")}</h1><p>{t("valuation.subtitle")}</p></div>
        <aside><Database size={14} /><strong>{t("valuation.secAnchors")}</strong><small>{t("valuation.userAssumptions")}</small></aside>
      </header>

      <ReadinessSummary readiness={readiness} t={t} language={language} />

      <section className={styles.topGrid}>
        <form className={styles.assumptions} onSubmit={submit}>
          <header><div><h2>{t("valuation.assumptionTitle")}</h2><p>{t("valuation.assumptionText")}</p></div><span>{t("valuation.editable")}</span></header>
          <div className={styles.anchorGrid}>
            <AnchorInput field="baseRevenue" label={t("valuation.baseRevenue")} form={form} updateField={updateField} prefix="$" source={fieldSourceLabel(fieldOrigins.baseRevenue, t)} />
            <AnchorInput field="dilutedShares" label={t("valuation.dilutedShares")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.dilutedShares, t)} />
            <label className={`${styles.anchor} ${styles.priceAnchor}`}>
              <span>{t("valuation.currentPrice")}</span>
              <div className={styles.priceInputs}>
                <div><b>$</b><input value={form.currentPrice} inputMode="decimal" placeholder={t("valuation.currentPricePlaceholder")} onChange={(event) => { updateField("currentPrice", event.target.value); setPriceFromProvider(false); }} /></div>
                <input type="date" value={form.currentPriceDate} max={todayDateString()} aria-label={t("valuation.currentPriceDate")} onChange={(event) => { updateField("currentPriceDate", event.target.value); setPriceFromProvider(false); }} />
              </div>
              <small>{priceFromProvider ? t("valuation.currentPriceProvider") : t("valuation.currentPriceManual")}</small>
            </label>
          </div>
          <div className={styles.fieldGrid}>
            <PercentField field="growth" label={t("valuation.revenueGrowth")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.growth, t)} />
            <PercentField field="margin" label={t("valuation.operatingMargin")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.margin, t)} placeholder={t("valuation.requiredPlaceholder")} />
            <PercentField field="tax" label={t("valuation.cashTax")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.tax, t)} />
            <PercentField field="da" label={t("valuation.daRevenue")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.da, t)} placeholder={t("valuation.requiredPlaceholder")} />
            <PercentField field="capex" label={t("valuation.capexRevenue")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.capex, t)} />
            <PercentField field="nwc" label={t("valuation.nwcIncremental")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.nwc, t)} />
            <PercentField field="wacc" label="WACC" form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.wacc, t)} />
            <PercentField field="terminal" label={t("valuation.terminalGrowth")} form={form} updateField={updateField} source={fieldSourceLabel(fieldOrigins.terminal, t)} />
            <label className={styles.field}><span>{t("valuation.netDebt")}</span><div><b>$</b><input value={form.netDebt} inputMode="decimal" placeholder={t("valuation.requiredPlaceholder")} onChange={(event) => updateField("netDebt", event.target.value)} /></div><small>{fieldSourceLabel(fieldOrigins.netDebt, t)} · {t("valuation.netDebtHint")}</small></label>
          </div>
          <div className={styles.formNote}><Info size={14} /><p>{t("valuation.starterWarning")}</p></div>
          {error ? <p className={styles.error}><TriangleAlert size={14} />{error}</p> : null}
          <button type="submit" disabled={!canRun} aria-disabled={!canRun}><Play size={14} />{t("valuation.run")}</button>
        </form>

        <aside className={styles.rangePanel}>
          <header><h2>{t("valuation.rangeTitle")}</h2><span>{t("valuation.rangeFirst")}</span></header>
          {view ? <RangeSummary view={view} t={t} language={language} /> : <EmptyResult t={t} />}
        </aside>
      </section>

      {view && anchors && comparableBasis ? (
        <>
          <section className={styles.sensitivitySection}>
            <header><div><h2>{t("valuation.sensitivityTitle")}</h2><p>{t("valuation.sensitivityText")}</p></div><span>{t("valuation.impliedPrice")}</span></header>
            <div className={styles.sensitivityGrid}>
              <Sensitivity title={t("valuation.waccGrowthTable")} table={view.waccTerminal} language={language} />
              <Sensitivity title={t("valuation.revenueMarginTable")} table={view.growthMargin} language={language} />
            </div>
          </section>
          <section className={styles.compsSection}>
            <header><div><h2>{t("valuation.compsTitle")}</h2><p>{t("valuation.compsText")}</p></div><span>{t("valuation.secondMethod")}</span></header>
            <div className={styles.compsGrid}>
              <div className={styles.marketMultiples}>
                <h3>{t("valuation.observedMultiples")}</h3>
                <div className={styles.multipleGrid}>
                  <Bridge label="P/E" value={comparableBasis.pe && datedCurrentPrice ? formatMultiple(datedCurrentPrice / comparableBasis.pe) : "—"} />
                  <Bridge label="Forward P/E" value="—" />
                  <Bridge label="EV / Revenue" value={datedCurrentPrice && optionalFinite(form.netDebt) !== undefined ? formatMultiple((datedCurrentPrice * anchors.dilutedShares + optionalFinite(form.netDebt)!) / anchors.baseRevenue) : "—"} />
                  <Bridge label="EV / EBITDA" value={datedCurrentPrice && comparableBasis["ev-ebitda"] && optionalFinite(form.netDebt) !== undefined ? formatMultiple((datedCurrentPrice * anchors.dilutedShares + optionalFinite(form.netDebt)!) / comparableBasis["ev-ebitda"]!) : "—"} />
                  <Bridge label="Price / Book" value="—" />
                  <Bridge label="PEG" value="—" />
                </div>
                <p>{t("valuation.unavailableMultiples")}</p>
              </div>
              <form className={styles.peerForm} onSubmit={submitComparable}>
                <label><span>{t("valuation.comparableMetric")}</span><select value={comparableMetric} onChange={(event) => { setComparableMetric(event.target.value as ComparableMetric); setComparable(undefined); }}><option value="pe" disabled={!readiness.methods.pe.available}>P/E</option><option value="ev-revenue" disabled={!readiness.methods["ev-revenue"].available}>EV / Revenue</option><option value="ev-ebitda" disabled={!readiness.methods["ev-ebitda"].available}>EV / EBITDA</option></select></label>
                <p>{comparableMetric === "pe" ? t("valuation.peBasis") : comparableMetric === "ev-revenue" ? t("valuation.evRevenueBasis") : t("valuation.evEbitdaBasis")}</p>
                <ul className={styles.methodNotes}>
                  <li>{readiness.methods.pe.available ? t("valuation.method.peAvailable") : t("valuation.method.peUnavailable")}</li>
                  <li>{readiness.methods["ev-revenue"].available ? t("valuation.method.evRevenueAvailable") : t("valuation.method.evRevenueUnavailable")}</li>
                  <li>{readiness.methods["ev-ebitda"].available ? t("valuation.method.evEbitdaAvailable") : t("valuation.method.evEbitdaUnavailable")}</li>
                </ul>
                <div className={styles.multipleInputs}>{(["low", "median", "high"] as const).map((key) => <label key={key}><span>{t(`valuation.multiple.${key}` as "valuation.multiple.low")}</span><div><input value={multiples[key]} inputMode="decimal" onChange={(event) => setMultiples({ ...multiples, [key]: event.target.value })} /><b>×</b></div></label>)}</div>
                {comparableError ? <p className={styles.error}><TriangleAlert size={14} />{comparableError}</p> : null}
                <button type="submit">{t("valuation.applyMultiples")}</button>
              </form>
              <div className={styles.comparableResult}>
                <h3>{t("valuation.comparableRange")}</h3>
                {comparable ? <><div><Bridge label={t("valuation.multiple.low")} value={usd(comparable.impliedSharePrices.low)} /><Bridge label={t("valuation.multiple.median")} value={usd(comparable.impliedSharePrices.median)} /><Bridge label={t("valuation.multiple.high")} value={usd(comparable.impliedSharePrices.high)} /></div><p>{comparable.formula}</p></> : <p>{t("valuation.comparableEmpty")}</p>}
              </div>
            </div>
          </section>
          <section className={styles.auditSection}>
            <header><div><h2>{t("valuation.modelBridge")}</h2><p>{t("valuation.modelBridgeText")}</p></div><CheckCircle2 size={17} /></header>
            <div className={styles.bridgeGrid}>
              <Bridge label={t("valuation.pvForecast")} value={money(view.base.bridge.sumPresentValueFcff, language)} />
              <Bridge label={t("valuation.pvTerminal")} value={money(view.base.bridge.presentValueOfTerminal, language)} />
              <Bridge label={t("valuation.enterpriseValue")} value={money(view.base.bridge.enterpriseValue, language)} />
              <Bridge label={t("valuation.netDebt") } value={money(view.base.bridge.netDebt, language)} />
              <Bridge label={t("valuation.equityValue")} value={money(view.base.bridge.equityValue, language)} />
              <Bridge label={t("valuation.impliedPrice")} value={usd(view.base.impliedSharePrice)} />
            </div>
            <details><summary>{t("valuation.openForecast")}</summary><ForecastTable valuation={view.base} t={t} language={language} /></details>
          </section>
        </>
      ) : null}
    </div>
  );
}

function RangeSummary({ view, t, language }: { view: ValuationView; t: Translate; language: string }) {
  return <div className={styles.rangeBody}>
    <div className={styles.rangeTrack}><i /><span style={{ left: "50%" }} /></div>
    <div className={styles.rangeBounds}><b>{usd(view.scenarios.lowImpliedSharePrice)}</b><small>{t("valuation.to")}</small><b>{usd(view.scenarios.highImpliedSharePrice)}</b></div>
    <div className={styles.scenarios}>{view.scenarios.scenarios.map((item) => <div key={item.id}><span>{t(`valuation.scenario.${item.id}` as "valuation.scenario.bear")}</span><strong>{usd(item.valuation.impliedSharePrice)}</strong></div>)}</div>
    <div className={styles.keyMetrics}>
      <Bridge label={t("valuation.baseImplied")} value={usd(view.base.impliedSharePrice)} />
      <Bridge label={t("valuation.marketComparison")} value={view.current ? signedPercent(view.current.upsideDownside, language) : "—"} />
      <Bridge label={t("valuation.terminalShare")} value={view.base.terminalValuePercentOfEnterprise === null ? "—" : percent(view.base.terminalValuePercentOfEnterprise, language)} />
    </div>
    <p>{t("valuation.rangeDisclosure")}</p>
  </div>;
}

function EmptyResult({ t }: { t: Translate }) { return <div className={styles.empty}><Calculator size={28} /><strong>{t("valuation.emptyTitle")}</strong><p>{t("valuation.emptyText")}</p></div>; }
function Bridge({ label, value }: { label: string; value: string }) { return <div className={styles.bridge}><span>{label}</span><strong>{value}</strong></div>; }

function AnchorInput({ field, label, form, updateField, source, prefix }: { field: "baseRevenue" | "dilutedShares"; label: string; form: FormState; updateField: (field: FieldKey, value: string) => void; source: string; prefix?: string }) {
  return <label className={`${styles.anchor} ${styles.anchorInput}`}><span>{label}</span><div>{prefix ? <b>{prefix}</b> : null}<input value={form[field]} inputMode="decimal" onChange={(event) => updateField(field, event.target.value)} /></div><small>{source}</small></label>;
}

function PercentField({ field, label, form, updateField, source, placeholder }: { field: FieldKey; label: string; form: FormState; updateField: (field: FieldKey, value: string) => void; source: string; placeholder?: string }) {
  return <label className={styles.field}><span>{label}</span><div><input value={form[field]} inputMode="decimal" placeholder={placeholder} onChange={(event) => updateField(field, event.target.value)} /><b>%</b></div><small>{source}</small></label>;
}

function ReadinessSummary({ readiness, t, language }: { readiness: ValuationReadiness; t: Translate; language: string }) {
  const da = readiness.anchors.daRevenueReference;
  const available = [readiness.anchors.baseRevenue, readiness.anchors.dilutedShares, readiness.anchors.netDebt, readiness.anchors.operatingMarginReference, ...(da.value === undefined ? [] : [da])];
  return <section className={styles.readiness}>
    <header><div><h2>{t("valuation.readinessTitle")}</h2><p>{t("valuation.readinessText")}</p></div><span>{t("valuation.partialCoverage")}</span></header>
    <div className={styles.readinessGrid}>
      <div><h3>{t("valuation.availableEvidence")}</h3><ul>{available.map((item) => <li key={item.key}><CheckCircle2 size={15} /><span><b>{anchorLabel(item.key, t)}</b><small>{item.value === undefined ? t("valuation.manualRequired") : <>{anchorValue(item.key, item.value, language)} · {item.origin === "historical-derived" ? t("valuation.source.historical") : <FinancialOriginLabel origin={item.origin} />}</>}</small></span></li>)}</ul></div>
      <div><h3>{t("valuation.needsReview")}</h3><ul>{da.value === undefined ? <li><TriangleAlert size={15} /><span><b>{t("valuation.daRevenue")}</b><small>{da.status === "limited-history" ? t("valuation.limitedDa") : t("valuation.manualRequired")}</small></span></li> : null}<li><TriangleAlert size={15} /><span><b>{t("valuation.forecastMargin")}</b><small>{(readiness.anchors.operatingMarginReference.value ?? 0) <= 0 ? t("valuation.lossMarginRequired") : t("valuation.userOwnedForecast")}</small></span></li></ul></div>
    </div>
    <details><summary>{t("valuation.openEvidence")}</summary><div className={styles.receipts}>{available.flatMap((item) => item.receipts).map((receipt, index) => <a key={`${receipt.accn}-${receipt.concept}-${receipt.end}-${index}`} href={receipt.sourceUrl} target="_blank" rel="noreferrer">{receipt.concept} · FY{receiptEconomicYear(receipt)} · {receipt.accn}</a>)}</div></details>
  </section>;
}

function Sensitivity({ title, table, language }: { title: string; table: SensitivityTable; language: string }) {
  return <div className={styles.sensitivity}><h3>{title}</h3><div className={styles.tableScroll}><table><thead><tr><th>{axis(table.rowAxis.label)} ↓ / {axis(table.columnAxis.label)} →</th>{table.columnAxis.values.map((value) => <th key={value}>{percent(value, language, 1)}</th>)}</tr></thead><tbody>{table.cells.map((row, index) => <tr key={table.rowAxis.values[index]}><th>{percent(table.rowAxis.values[index], language, 1)}</th>{row.map((cell, cellIndex) => <td key={cellIndex} className={!cell.available ? styles.na : undefined}>{cell.available ? usd(cell.impliedSharePrice) : "—"}</td>)}</tr>)}</tbody></table></div></div>;
}

function ForecastTable({ valuation, t, language }: { valuation: DcfValuation; t: Translate; language: string }) {
  return <div className={styles.tableScroll}><table className={styles.forecast}><thead><tr><th>{t("valuation.year")}</th><th>{t("valuation.revenue")}</th><th>EBIT</th><th>NOPAT</th><th>D&amp;A</th><th>CapEx</th><th>ΔNWC</th><th>FCFF</th><th>PV FCFF</th></tr></thead><tbody>{valuation.rows.map((row) => <tr key={row.year}><th>{row.year}</th><td>{money(row.revenue, language)}</td><td>{money(row.ebit, language)}</td><td>{money(row.nopat, language)}</td><td>{money(row.da, language)}</td><td>{money(row.capex, language)}</td><td>{money(row.changeInNwc, language)}</td><td>{money(row.fcff, language)}</td><td>{money(row.presentValue, language)}</td></tr>)}</tbody></table></div>;
}

function PageState({ text, error = false }: { text: string; error?: boolean }) { return <section className={styles.state}>{error ? <TriangleAlert /> : <LoaderCircle className={styles.spin} />}<h1>{text}</h1></section>; }

interface EditableAnchors { baseRevenue: number; dilutedShares: number; fiscalYear: number }

function editableAnchors(readiness: ValuationReadiness, form: FormState): EditableAnchors | undefined {
  const baseRevenue = optionalFinite(form.baseRevenue);
  const dilutedShares = optionalFinite(form.dilutedShares);
  if (readiness.fiscalYear === undefined || baseRevenue === undefined || dilutedShares === undefined || baseRevenue <= 0 || dilutedShares <= 0) return undefined;
  return { baseRevenue, dilutedShares, fiscalYear: readiness.fiscalYear };
}

function suggestedForm(result: FundamentalsResult, readiness: ValuationReadiness, current: FormState): FormState {
  const margin = metric(result, "operatingMargin");
  const latestMargin = readiness.anchors.operatingMarginReference.value;
  const medianMargin = latestMargin !== undefined && latestMargin > 0 && margin ? medianSeriesValue(margin) : undefined;
  return {
    ...current,
    ...(readiness.anchors.baseRevenue.value === undefined ? {} : { baseRevenue: readiness.anchors.baseRevenue.value.toFixed(0) }),
    ...(readiness.anchors.dilutedShares.value === undefined ? {} : { dilutedShares: readiness.anchors.dilutedShares.value.toFixed(0) }),
    ...(readiness.anchors.netDebt.value === undefined ? {} : { netDebt: readiness.anchors.netDebt.value.toFixed(0) }),
    ...(readiness.anchors.revenueGrowthReference.value === undefined ? {} : { growth: (readiness.anchors.revenueGrowthReference.value * 100).toFixed(1) }),
    ...(medianMargin === undefined ? {} : { margin: (medianMargin * 100).toFixed(1) }),
    ...(readiness.anchors.capexRevenueReference.value === undefined ? {} : { capex: (readiness.anchors.capexRevenueReference.value * 100).toFixed(1) }),
    ...(readiness.anchors.daRevenueReference.value === undefined ? {} : { da: (readiness.anchors.daRevenueReference.value * 100).toFixed(1) }),
    ...(readiness.anchors.cashTaxReference.value === undefined ? {} : { tax: (readiness.anchors.cashTaxReference.value * 100).toFixed(1) }),
  };
}

function suggestedOrigins(result: FundamentalsResult, readiness: ValuationReadiness, current: FieldOrigins): FieldOrigins {
  const margin = metric(result, "operatingMargin");
  const latestMargin = readiness.anchors.operatingMarginReference.value;
  return {
    ...current,
    baseRevenue: inputOrigin(readiness.anchors.baseRevenue.origin),
    dilutedShares: inputOrigin(readiness.anchors.dilutedShares.origin),
    netDebt: readiness.anchors.netDebt.value === undefined ? "manual-required" : inputOrigin(readiness.anchors.netDebt.origin),
    growth: readiness.anchors.revenueGrowthReference.value === undefined ? current.growth : "historical-derived",
    margin: latestMargin !== undefined && latestMargin > 0 && margin && medianSeriesValue(margin) !== undefined ? "historical-derived" : "manual-required",
    da: readiness.anchors.daRevenueReference.value === undefined ? "manual-required" : "historical-derived",
    capex: readiness.anchors.capexRevenueReference.value === undefined ? current.capex : "historical-derived",
    tax: readiness.anchors.cashTaxReference.value === undefined ? current.tax : "historical-derived",
  };
}

function comparableValues(result: FundamentalsResult, anchors: EditableAnchors): Record<ComparableMetric, number | undefined> {
  const eps = metric(result, "dilutedEps")?.observations.find((item) => item.fiscalYear === anchors.fiscalYear)?.value;
  const ebitda = metric(result, "ebitda")?.observations.find((item) => item.fiscalYear === anchors.fiscalYear)?.value;
  return { pe: eps && eps > 0 ? eps : undefined, "ev-revenue": anchors.baseRevenue, "ev-ebitda": ebitda !== undefined && ebitda > 0 ? ebitda : undefined };
}

function buildAssumptions(form: FormState, anchors: EditableAnchors): DcfAssumptions {
  return { baseRevenue: anchors.baseRevenue, dilutedShares: anchors.dilutedShares, forecastYears: 5, revenueGrowth: numberRate(form.growth), operatingMargin: numberRate(form.margin), cashTaxRate: numberRate(form.tax), daPercentOfRevenue: numberRate(form.da), capexPercentOfRevenue: numberRate(form.capex), nwcPercentOfIncrementalRevenue: numberRate(form.nwc), wacc: numberRate(form.wacc), terminalGrowth: numberRate(form.terminal), netDebt: parseRequiredValuationNumber(form.netDebt, "netDebt") };
}

function inputOrigin(origin: ValuationReadiness["anchors"][ValuationAnchorKey]["origin"]): ValuationInputOrigin {
  return origin === "constructed-standard" ? "sec-constructed" : origin === "historical-derived" ? "historical-derived" : "sec-direct";
}

type ValuationAnchorKey = keyof ValuationReadiness["anchors"];

function fieldSourceLabel(origin: ValuationInputOrigin, t: Translate): string {
  if (origin === "sec-direct") return t("valuation.source.secDirect");
  if (origin === "sec-constructed") return t("valuation.source.secConstructed");
  if (origin === "historical-derived") return t("valuation.source.historical");
  if (origin === "manual-required") return t("valuation.source.manualRequired");
  if (origin === "user-entered") return t("valuation.source.userEntered");
  return t("valuation.source.manualExample");
}

function anchorLabel(key: ValuationAnchorKey, t: Translate): string {
  if (key === "baseRevenue") return t("valuation.baseRevenue");
  if (key === "dilutedShares") return t("valuation.dilutedShares");
  if (key === "netDebt") return t("valuation.netDebt");
  if (key === "daRevenueReference") return t("valuation.daRevenue");
  return t("valuation.latestMargin");
}

function anchorValue(key: ValuationAnchorKey, value: number, language: string): string {
  if (key === "operatingMarginReference" || key === "daRevenueReference" || key === "capexRevenueReference" || key === "cashTaxReference" || key === "revenueGrowthReference") return percent(value, language);
  if (key === "dilutedShares") return compact(value, language);
  return money(value, language);
}

function snapshotAnchor(
  key: "baseRevenue" | "dilutedShares" | "netDebt",
  value: number,
  fiscalYear: number,
  readiness: ValuationReadiness,
  inputOriginValue: ValuationInputOrigin,
) {
  const source = readiness.anchors[key];
  const userEdited = inputOriginValue === "user-entered" || inputOriginValue === "manual-required" || inputOriginValue === "manual-example";
  return {
    value,
    origin: userEdited ? "manual-user" as const : source.origin === "constructed-standard" ? "constructed-standard" as const : "direct-standard" as const,
    fiscalYear,
    receipts: userEdited ? [] : source.receipts,
    userEdited,
    assumptionOwnership: userEdited ? "user" as const : "sec-evidence" as const,
  };
}

function shiftScenario(base: DcfAssumptions, growth: number, margin: number, wacc: number, terminal: number): DcfAssumptions { return { ...base, revenueGrowth: clamp((base.revenueGrowth as number) + growth, -0.99, 1), operatingMargin: clamp((base.operatingMargin as number) + margin, -2, 1), wacc: clamp(base.wacc + wacc, 0.001, 1), terminalGrowth: Math.min(clamp(base.terminalGrowth + terminal, -1, 1), base.wacc + wacc - 0.001) }; }
function around(value: number, step: number) { return [-2, -1, 0, 1, 2].map((offset) => value + offset * step); }
function finiteNumber(value: string, name: string) { return parseRequiredValuationNumber(value, name); }
function numberRate(value: string) { return finiteNumber(value, "rate") / 100; }
function metric(result: FundamentalsResult, key: FundamentalsMetricKey): FundamentalsSeries | undefined { return result.metrics.find((item) => item.metric === key); }
function medianSeriesValue(series: FundamentalsSeries) { return series.observations.length >= 3 ? median(series.observations.map((item) => item.value)) : undefined; }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function safeTicker(raw: string) { try { const value = decodeURIComponent(raw).trim().toUpperCase(); return TICKER_PATTERN.test(value) ? value : ""; } catch { return ""; } }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function optionalFinite(value: string) { if (value.trim() === "") return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function optionalPositiveFinite(value: string) { const parsed = optionalFinite(value); return parsed !== undefined && parsed > 0 ? parsed : undefined; }
function isValidQuoteDate(value: string, today: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today; }
function requiredQuoteDate(value: string, today: string, t: Translate) { if (!isValidQuoteDate(value, today)) throw new ValuationError(t("valuation.currentPriceDateError")); return value; }
function formatMultiple(value: number) { return Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}×` : "—"; }
function axis(label: string) { return label === "wacc" ? "WACC" : label === "terminalGrowth" ? "g" : label === "revenueGrowth" ? "Growth" : "Margin"; }
function usd(value: number) { const sign = value < 0 ? "−" : ""; return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function compact(value: number, language: string) { return new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function money(value: number, language: string) { return `$${compact(value, language)}`; }
function percent(value: number, language: string, digits = 1) { return new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value); }
function signedPercent(value: number, language: string) { return `${value > 0 ? "+" : ""}${percent(value, language)}`; }
