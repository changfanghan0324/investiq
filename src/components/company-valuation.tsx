"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Calculator, CheckCircle2, Database, Info, LoaderCircle, Play, TriangleAlert } from "lucide-react";

import type { FundamentalsMetricKey, FundamentalsResult, FundamentalsSeries } from "@/domain/fundamentals";
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

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

type FieldKey = "growth" | "margin" | "tax" | "da" | "capex" | "nwc" | "wacc" | "terminal" | "netDebt" | "currentPrice" | "currentPriceDate";
type FormState = Record<FieldKey, string>;

interface ValuationView {
  base: DcfValuation;
  scenarios: DcfScenarioRange;
  waccTerminal: SensitivityTable;
  growthMargin: SensitivityTable;
  current?: ReturnType<typeof compareToCurrentPrice>;
}

const STARTER: FormState = {
  growth: "5.0",
  margin: "15.0",
  tax: "21.0",
  da: "3.0",
  capex: "4.0",
  nwc: "0.0",
  wacc: "9.0",
  terminal: "2.5",
  netDebt: "",
  currentPrice: "",
  currentPriceDate: "",
};

export function CompanyValuation({ rawTicker }: { rawTicker: string }) {
  const { t, language } = useLanguage();
  const ticker = safeTicker(rawTicker);
  const [fundamentals, setFundamentals] = useState<FundamentalsResult>();
  const [form, setForm] = useState<FormState>(STARTER);
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
        setForm((current) => suggestedForm(result, current));
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

  const anchors = useMemo(() => fundamentals ? dcfAnchors(fundamentals) : undefined, [fundamentals]);
  const comparableBasis = useMemo(() => fundamentals && anchors ? comparableValues(fundamentals, anchors) : undefined, [fundamentals, anchors]);
  const currentPrice = optionalPositiveFinite(form.currentPrice);
  const datedCurrentPrice = currentPrice !== undefined && isValidQuoteDate(form.currentPriceDate, todayDateString()) ? currentPrice : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!fundamentals || !anchors) return;
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
      saveValuationSnapshot({ version: 1, ticker, generatedAt: new Date().toISOString(), fiscalYear: anchors.fiscalYear, assumptions, values: { bear: byId.bear, base: byId.base, bull: byId.bull, low: scenarios.lowImpliedSharePrice, high: scenarios.highImpliedSharePrice, enterpriseValue: base.bridge.enterpriseValue, equityValue: base.bridge.equityValue, ...(currentPrice !== undefined && quoteDate ? { currentPrice, quoteDate } : {}), ...(current ? { upsideDownside: current.upsideDownside } : {}) } });
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
  if (!fundamentals || !anchors || !comparableBasis) return <PageState text={settled ? t("valuation.coverageError") : t("valuation.loading")} error={settled} />;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><span>{t("valuation.eyebrow")}</span><h1>{t("valuation.title")}</h1><p>{t("valuation.subtitle")}</p></div>
        <aside><Database size={14} /><strong>{t("valuation.secAnchors")}</strong><small>{t("valuation.userAssumptions")}</small></aside>
      </header>

      <section className={styles.topGrid}>
        <form className={styles.assumptions} onSubmit={submit}>
          <header><div><h2>{t("valuation.assumptionTitle")}</h2><p>{t("valuation.assumptionText")}</p></div><span>{t("valuation.editable")}</span></header>
          <div className={styles.anchorGrid}>
            <Anchor label={t("valuation.baseRevenue")} value={money(anchors.baseRevenue, language)} detail={`FY${anchors.fiscalYear}`} />
            <Anchor label={t("valuation.dilutedShares")} value={compact(anchors.dilutedShares, language)} detail={`FY${anchors.fiscalYear}`} />
            <label className={`${styles.anchor} ${styles.priceAnchor}`}>
              <span>{t("valuation.currentPrice")}</span>
              <div className={styles.priceInputs}>
                <div><b>$</b><input value={form.currentPrice} inputMode="decimal" placeholder={t("valuation.currentPricePlaceholder")} onChange={(event) => { setForm({ ...form, currentPrice: event.target.value }); setPriceFromProvider(false); }} /></div>
                <input type="date" value={form.currentPriceDate} max={todayDateString()} aria-label={t("valuation.currentPriceDate")} onChange={(event) => { setForm({ ...form, currentPriceDate: event.target.value }); setPriceFromProvider(false); }} />
              </div>
              <small>{priceFromProvider ? t("valuation.currentPriceProvider") : t("valuation.currentPriceManual")}</small>
            </label>
          </div>
          <div className={styles.fieldGrid}>
            <PercentField field="growth" label={t("valuation.revenueGrowth")} form={form} setForm={setForm} source={t("valuation.historicalStarter")} />
            <PercentField field="margin" label={t("valuation.operatingMargin")} form={form} setForm={setForm} source={t("valuation.latestStarter")} />
            <PercentField field="tax" label={t("valuation.cashTax")} form={form} setForm={setForm} source={t("valuation.manualStarter")} />
            <PercentField field="da" label={t("valuation.daRevenue")} form={form} setForm={setForm} source={t("valuation.historicalStarter")} />
            <PercentField field="capex" label={t("valuation.capexRevenue")} form={form} setForm={setForm} source={t("valuation.latestStarter")} />
            <PercentField field="nwc" label={t("valuation.nwcIncremental")} form={form} setForm={setForm} source={t("valuation.manualStarter")} />
            <PercentField field="wacc" label="WACC" form={form} setForm={setForm} source={t("valuation.manualStarter")} />
            <PercentField field="terminal" label={t("valuation.terminalGrowth")} form={form} setForm={setForm} source={t("valuation.manualStarter")} />
            <label className={styles.field}><span>{t("valuation.netDebt")}</span><div><b>$</b><input value={form.netDebt} inputMode="decimal" onChange={(event) => setForm({ ...form, netDebt: event.target.value })} /></div><small>{t("valuation.netDebtHint")}</small></label>
          </div>
          <div className={styles.formNote}><Info size={14} /><p>{t("valuation.starterWarning")}</p></div>
          {error ? <p className={styles.error}><TriangleAlert size={14} />{error}</p> : null}
          <button type="submit"><Play size={14} />{t("valuation.run")}</button>
        </form>

        <aside className={styles.rangePanel}>
          <header><h2>{t("valuation.rangeTitle")}</h2><span>{t("valuation.rangeFirst")}</span></header>
          {view ? <RangeSummary view={view} t={t} language={language} /> : <EmptyResult t={t} />}
        </aside>
      </section>

      {view ? (
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
                <label><span>{t("valuation.comparableMetric")}</span><select value={comparableMetric} onChange={(event) => { setComparableMetric(event.target.value as ComparableMetric); setComparable(undefined); }}><option value="pe">P/E</option><option value="ev-revenue">EV / Revenue</option><option value="ev-ebitda">EV / EBITDA</option></select></label>
                <p>{comparableMetric === "pe" ? t("valuation.peBasis") : comparableMetric === "ev-revenue" ? t("valuation.evRevenueBasis") : t("valuation.evEbitdaBasis")}</p>
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
function Anchor({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className={styles.anchor}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Bridge({ label, value }: { label: string; value: string }) { return <div className={styles.bridge}><span>{label}</span><strong>{value}</strong></div>; }

function PercentField({ field, label, form, setForm, source }: { field: FieldKey; label: string; form: FormState; setForm: (value: FormState) => void; source: string }) {
  return <label className={styles.field}><span>{label}</span><div><input value={form[field]} inputMode="decimal" onChange={(event) => setForm({ ...form, [field]: event.target.value })} /><b>%</b></div><small>{source}</small></label>;
}

function Sensitivity({ title, table, language }: { title: string; table: SensitivityTable; language: string }) {
  return <div className={styles.sensitivity}><h3>{title}</h3><div className={styles.tableScroll}><table><thead><tr><th>{axis(table.rowAxis.label)} ↓ / {axis(table.columnAxis.label)} →</th>{table.columnAxis.values.map((value) => <th key={value}>{percent(value, language, 1)}</th>)}</tr></thead><tbody>{table.cells.map((row, index) => <tr key={table.rowAxis.values[index]}><th>{percent(table.rowAxis.values[index], language, 1)}</th>{row.map((cell, cellIndex) => <td key={cellIndex} className={!cell.available ? styles.na : undefined}>{cell.available ? usd(cell.impliedSharePrice) : "—"}</td>)}</tr>)}</tbody></table></div></div>;
}

function ForecastTable({ valuation, t, language }: { valuation: DcfValuation; t: Translate; language: string }) {
  return <div className={styles.tableScroll}><table className={styles.forecast}><thead><tr><th>{t("valuation.year")}</th><th>{t("valuation.revenue")}</th><th>EBIT</th><th>NOPAT</th><th>D&amp;A</th><th>CapEx</th><th>ΔNWC</th><th>FCFF</th><th>PV FCFF</th></tr></thead><tbody>{valuation.rows.map((row) => <tr key={row.year}><th>{row.year}</th><td>{money(row.revenue, language)}</td><td>{money(row.ebit, language)}</td><td>{money(row.nopat, language)}</td><td>{money(row.da, language)}</td><td>{money(row.capex, language)}</td><td>{money(row.changeInNwc, language)}</td><td>{money(row.fcff, language)}</td><td>{money(row.presentValue, language)}</td></tr>)}</tbody></table></div>;
}

function PageState({ text, error = false }: { text: string; error?: boolean }) { return <section className={styles.state}>{error ? <TriangleAlert /> : <LoaderCircle className={styles.spin} />}<h1>{text}</h1></section>; }

function dcfAnchors(result: FundamentalsResult) {
  const revenue = metric(result, "revenue");
  const margin = metric(result, "operatingMargin");
  const shares = metric(result, "dilutedShares");
  if (!revenue?.available || !margin?.available || !shares?.available) return undefined;
  const latestRevenue = revenue.observations[0];
  const sameMargin = margin.observations.find((item) => item.fiscalYear === latestRevenue.fiscalYear) ?? margin.observations[0];
  const sameShares = shares.observations.find((item) => item.fiscalYear === latestRevenue.fiscalYear) ?? shares.observations[0];
  return { baseRevenue: latestRevenue.value, dilutedShares: sameShares.value, operatingMargin: sameMargin.value, fiscalYear: latestRevenue.fiscalYear };
}

function suggestedForm(result: FundamentalsResult, current: FormState): FormState {
  const revenue = metric(result, "revenue");
  const capex = metric(result, "capitalExpenditure");
  const da = metric(result, "depreciationAndAmortization");
  const margin = metric(result, "operatingMargin");
  const netDebt = metric(result, "netDebt")?.observations[0]?.value;
  const growth = revenue ? medianAnnualGrowth(revenue) : undefined;
  const medianMargin = margin ? medianSeriesValue(margin) : undefined;
  const capexPercent = revenue && capex ? medianAlignedRatio(capex, revenue) : undefined;
  const daPercent = revenue && da ? medianAlignedRatio(da, revenue) : undefined;
  return {
    ...current,
    ...(growth === undefined ? {} : { growth: (growth * 100).toFixed(1) }),
    ...(medianMargin === undefined ? {} : { margin: (medianMargin * 100).toFixed(1) }),
    ...(capexPercent === undefined ? {} : { capex: (capexPercent * 100).toFixed(1) }),
    ...(daPercent === undefined ? {} : { da: (daPercent * 100).toFixed(1) }),
    ...(netDebt === undefined ? {} : { netDebt: netDebt.toFixed(0) }),
  };
}

function comparableValues(result: FundamentalsResult, anchors: NonNullable<ReturnType<typeof dcfAnchors>>): Record<ComparableMetric, number | undefined> {
  const eps = metric(result, "dilutedEps")?.observations[0]?.value;
  const ebitda = metric(result, "ebitda")?.observations.find((item) => item.fiscalYear === anchors.fiscalYear)?.value;
  return { pe: eps && eps > 0 ? eps : undefined, "ev-revenue": anchors.baseRevenue, "ev-ebitda": ebitda !== undefined && ebitda > 0 ? ebitda : undefined };
}

function buildAssumptions(form: FormState, anchors: NonNullable<ReturnType<typeof dcfAnchors>>): DcfAssumptions {
  return { baseRevenue: anchors.baseRevenue, dilutedShares: anchors.dilutedShares, forecastYears: 5, revenueGrowth: numberRate(form.growth), operatingMargin: numberRate(form.margin), cashTaxRate: numberRate(form.tax), daPercentOfRevenue: numberRate(form.da), capexPercentOfRevenue: numberRate(form.capex), nwcPercentOfIncrementalRevenue: numberRate(form.nwc), wacc: numberRate(form.wacc), terminalGrowth: numberRate(form.terminal), netDebt: parseRequiredValuationNumber(form.netDebt, "netDebt") };
}

function shiftScenario(base: DcfAssumptions, growth: number, margin: number, wacc: number, terminal: number): DcfAssumptions { return { ...base, revenueGrowth: clamp((base.revenueGrowth as number) + growth, -0.99, 1), operatingMargin: clamp((base.operatingMargin as number) + margin, -2, 1), wacc: clamp(base.wacc + wacc, 0.001, 1), terminalGrowth: Math.min(clamp(base.terminalGrowth + terminal, -1, 1), base.wacc + wacc - 0.001) }; }
function around(value: number, step: number) { return [-2, -1, 0, 1, 2].map((offset) => value + offset * step); }
function finiteNumber(value: string, name: string) { return parseRequiredValuationNumber(value, name); }
function numberRate(value: string) { return finiteNumber(value, "rate") / 100; }
function metric(result: FundamentalsResult, key: FundamentalsMetricKey): FundamentalsSeries | undefined { return result.metrics.find((item) => item.metric === key); }
function medianAnnualGrowth(series: FundamentalsSeries) { if (series.observations.length < 3) return undefined; const chronological = [...series.observations].sort((a, b) => a.fiscalYear - b.fiscalYear); const rates: number[] = []; for (let index = 1; index < chronological.length; index += 1) { const prior = chronological[index - 1]; const current = chronological[index]; if (prior.value > 0 && current.value > 0 && current.fiscalYear === prior.fiscalYear + 1) rates.push(current.value / prior.value - 1); } return rates.length >= 2 ? median(rates) : undefined; }
function medianSeriesValue(series: FundamentalsSeries) { return series.observations.length >= 3 ? median(series.observations.map((item) => item.value)) : undefined; }
function medianAlignedRatio(numerator: FundamentalsSeries, denominator: FundamentalsSeries) { const ratios: number[] = []; for (const item of numerator.observations) { const match = denominator.observations.find((other) => other.fiscalYear === item.fiscalYear && other.periodEnd === item.periodEnd); if (match && match.value > 0) ratios.push(item.value / match.value); } return ratios.length >= 3 ? median(ratios) : undefined; }
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
