"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, FileDown, LoaderCircle, TriangleAlert } from "lucide-react";

import { buildCompanyFinancialAnalysis, type CompanyRatioKey } from "@/domain/company-financial-analysis";
import type { FundamentalsMetricKey, FundamentalsResult, FundamentalsSeries } from "@/domain/fundamentals";
import { buildEquityResearchReport, type EquityReportDisclaimer, type EquityReportLimitation, type EquityResearchReport } from "@/services/create-equity-report";
import { loadCompanyFundamentals } from "@/services/fundamentals-api";
import { loadMemoNotes } from "@/services/memo-storage";
import { loadValuationSnapshot } from "@/services/valuation-snapshot";
import { useLanguage, type Translate } from "@/i18n/language";

import styles from "./equity-report.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

export function EquityReport({ rawTicker }: { rawTicker: string }) {
  const { t, language } = useLanguage();
  const ticker = safeTicker(rawTicker);
  const [fundamentals, setFundamentals] = useState<FundamentalsResult>();
  const [generatedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let active = true;
    loadCompanyFundamentals(ticker)
      .then((result) => { if (active) setFundamentals(result); })
      .catch(() => undefined)
      .finally(() => { if (active) setSettled(true); });
    return () => { active = false; };
  }, [ticker]);

  const report = useMemo(() => {
    if (!fundamentals || !generatedAt) return undefined;
    return buildEquityResearchReport({
      fundamentals,
      ratios: buildCompanyFinancialAnalysis(fundamentals),
      valuation: loadValuationSnapshot(ticker),
      notes: loadMemoNotes(ticker),
      generatedAt,
    });
  }, [fundamentals, generatedAt, ticker]);

  function printReport() {
    const originalTitle = document.title;
    document.title = `InvestIQ_${ticker}_Equity_Research_Report_${generatedAt}`;
    const restore = () => { document.title = originalTitle; window.removeEventListener("afterprint", restore); };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  if (!ticker || (settled && !fundamentals)) return <PageState error text={t("report.loadError")} />;
  if (!report) return <PageState text={t("report.loading")} />;

  return (
    <article className={styles.report} aria-labelledby="equity-report-title">
      <header className={styles.toolbar}>
        <div><span>{t("report.eyebrow")}</span><h1 id="equity-report-title">{t("report.title")}</h1><p>{t("report.subtitle")}</p></div>
        <button type="button" onClick={printReport} aria-label={t("report.exportAria")}><FileDown size={15} />{t("report.export")}</button>
      </header>

      <div className={styles.paper}>
        <ReportCover report={report} t={t} />
        <ReportSection number="01" title={t("report.executiveTitle")} nature={t("report.userInterpretationNature")}>
          <div className={styles.noteGrid}>
            <Narrative label={t("memo.thesisTitle")} value={report.userInterpretation.thesis} fallback={t("report.noteUnavailable")} />
            <Narrative label={t("memo.catalystsTitle")} value={report.userInterpretation.catalysts} fallback={t("report.noteUnavailable")} />
            <Narrative label={t("memo.risksTitle")} value={report.userInterpretation.risks} fallback={t("report.noteUnavailable")} />
            <Narrative label={t("memo.conclusionTitle")} value={report.userInterpretation.conclusion} fallback={t("report.noteUnavailable")} />
          </div>
        </ReportSection>

        <ReportSection number="02" title={t("report.financialTitle")} nature={t("report.reportedNature")} pageBreak>
          <p className={styles.sectionIntro}>{language === "zh-CN" ? t("report.secDisclaimer") : report.reportedFacts.disclaimer}</p>
          <FinancialTable report={report} language={language} t={t} />
        </ReportSection>

        <ReportSection number="03" title={t("report.ratiosTitle")} nature={t("report.constructedNature")} pageBreak>
          <RatioTable report={report} language={language} t={t} />
        </ReportSection>

        <ReportSection number="04" title={t("report.valuationTitle")} nature={t("report.modeledNature")} pageBreak>
          <ValuationSection report={report} language={language} t={t} />
        </ReportSection>

        <ReportSection number="05" title={t("report.sourcesTitle")} nature={t("report.reportedNature")}>
          <p className={styles.sectionIntro}>{t("report.sourcesIntro", { count: report.sources.length })}</p>
          <ol className={styles.sources}>
            {report.sources.map((source) => (
              <li key={`${source.accn}:${source.sourceUrl}`}>
                <div><strong>{source.concepts.join(" · ")}</strong><span>{source.form} · FY{source.fy} · {source.filed}</span></div>
                <code>{source.accn}</code>
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">SEC <ExternalLink size={11} /></a>
              </li>
            ))}
          </ol>
        </ReportSection>

        <ReportSection number="06" title={t("report.limitationsTitle")} nature={t("report.controlNature")}>
          <ul className={styles.limitations}>{report.limitations.map((item) => <li key={item}>{limitationText(item, t)}</li>)}</ul>
          <div className={styles.disclaimer}>{report.disclaimers.map((item) => <p key={item}>{disclaimerText(item, t)}</p>)}</div>
        </ReportSection>

        <footer className={styles.reportFooter}>
          <span>InvestIQ · {report.identity.ticker} · {t("report.title")}</span>
          <span>{t("report.generated", { date: report.generatedAt })}</span>
          <strong>{t("report.notAdvice")}</strong>
        </footer>
      </div>
    </article>
  );
}

function ReportCover({ report, t }: { report: EquityResearchReport; t: Translate }) {
  return (
    <header className={styles.cover}>
      <div><span>INVESTIQ RESEARCH</span><h2>{report.identity.name}</h2><p>{report.identity.ticker} · {report.identity.sicDescription ?? t("company.unavailable")}</p></div>
      <dl>
        <div><dt>{t("report.generatedLabel")}</dt><dd>{report.generatedAt}</dd></div>
        <div><dt>CIK</dt><dd>{report.identity.cik}</dd></div>
        <div><dt>{t("memo.reportingBasis")}</dt><dd>{t("company.annualLatestReported")}</dd></div>
      </dl>
    </header>
  );
}

function ReportSection({ number, title, nature, pageBreak = false, children }: { number: string; title: string; nature: string; pageBreak?: boolean; children: ReactNode }) {
  return <section className={`${styles.section} ${pageBreak ? styles.pageBreak : ""}`}><header><span>{number}</span><div><h2>{title}</h2><small>{nature}</small></div></header>{children}</section>;
}

function Narrative({ label, value, fallback }: { label: string; value: string; fallback: string }) {
  return <section><h3>{label}</h3><p className={value ? undefined : styles.unavailable}>{value || fallback}</p></section>;
}

function FinancialTable({ report, language, t }: { report: EquityResearchReport; language: string; t: Translate }) {
  return (
    <div className={styles.tableWrap}><table><thead><tr><th>{t("report.metric")}</th>{report.reportedFacts.fiscalYears.map((year) => <th key={year}>FY{year}</th>)}</tr></thead><tbody>
      {report.reportedFacts.financials.map((series) => <tr key={series.metric}><th>{metricName(series.metric, t)}<small>{financialBasisName(series.metric, t)}</small></th>{report.reportedFacts.fiscalYears.map((year) => <td key={year}>{formatObservation(series, year, language)}</td>)}</tr>)}
    </tbody></table></div>
  );
}

function RatioTable({ report, language, t }: { report: EquityResearchReport; language: string; t: Translate }) {
  return <div className={styles.tableWrap}><table><thead><tr><th>{t("report.metric")}</th><th>{t("report.latest")}</th><th>{t("report.formula")}</th><th>{t("report.evidence")}</th></tr></thead><tbody>{report.reportedFacts.ratios.map((series) => {
    const latest = series.observations[0];
    return <tr key={series.metric}><th>{ratioName(series.metric, t)}</th><td>{latest ? formatRatio(latest.value, series.unit, language) : "—"}</td><td>{ratioFormulaName(series.metric, t)}</td><td>{latest ? t("report.receiptCount", { count: latest.receipts.length }) : unavailableRatio(series.unavailableReason, t)}</td></tr>;
  })}</tbody></table></div>;
}

function ValuationSection({ report, language, t }: { report: EquityResearchReport; language: string; t: Translate }) {
  const valuation = report.modeledAssumptions;
  if (!valuation) return <div className={styles.missing}><p>{t("report.valuationUnavailable")}</p><Link href={`/company/${report.identity.ticker}/valuation`}>{t("memo.openValuation")}</Link></div>;
  const a = valuation.assumptions;
  const assumptionRows = [
    [t("valuation.baseRevenue"), money(a.baseRevenue, language)],
    [t("report.forecastYears"), String(a.forecastYears)],
    [t("valuation.revenueGrowth"), rates(a.revenueGrowth, language)],
    [t("valuation.operatingMargin"), rates(a.operatingMargin, language)],
    [t("valuation.cashTax"), percent(a.cashTaxRate, language)],
    [t("valuation.daRevenue"), rates(a.daPercentOfRevenue, language)],
    [t("valuation.capexRevenue"), rates(a.capexPercentOfRevenue, language)],
    [t("valuation.nwcIncremental"), rates(a.nwcPercentOfIncrementalRevenue, language)],
    ["WACC", percent(a.wacc, language)],
    [t("valuation.terminalGrowth"), percent(a.terminalGrowth, language)],
    [t("valuation.netDebt"), money(a.netDebt, language)],
    [t("valuation.dilutedShares"), number(a.dilutedShares, language)],
  ];
  return <>
    <div className={styles.scenarios}><Scenario label={t("valuation.scenario.bear")} value={valuation.values.bear} language={language} /><Scenario label={t("valuation.scenario.base")} value={valuation.values.base} language={language} /><Scenario label={t("valuation.scenario.bull")} value={valuation.values.bull} language={language} /></div>
    <div className={styles.valuationGrid}>
      <div className={styles.tableWrap}><table><thead><tr><th>{t("report.assumption")}</th><th>{t("report.value")}</th></tr></thead><tbody>{assumptionRows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody></table></div>
      <dl className={styles.bridge}><div><dt>{t("valuation.enterpriseValue")}</dt><dd>{money(valuation.values.enterpriseValue, language)}</dd></div><div><dt>{t("valuation.equityValue")}</dt><dd>{money(valuation.values.equityValue, language)}</dd></div><div><dt>{t("valuation.currentPrice")}</dt><dd>{valuation.values.currentPrice === undefined ? "—" : `${money(valuation.values.currentPrice, language)} · ${valuation.values.quoteDate}`}</dd></div><div><dt>{t("memo.range")}</dt><dd>{money(valuation.values.low, language)} – {money(valuation.values.high, language)}</dd></div></dl>
    </div>
    <p className={styles.sectionIntro}>{t("report.valuationDisclosure")}</p>
  </>;
}

function Scenario({ label, value, language }: { label: string; value: number; language: string }) { return <div><span>{label}</span><strong>{money(value, language)}</strong></div>; }
function PageState({ text, error = false }: { text: string; error?: boolean }) { return <section className={styles.state}>{error ? <TriangleAlert /> : <LoaderCircle className={styles.spin} />}<h1>{text}</h1></section>; }

function formatObservation(series: FundamentalsSeries, year: number, language: string) { const item = series.observations.find((entry) => entry.fiscalYear === year); if (!item) return "—"; if (series.unit === "USD") return money(item.value, language); if (series.unit === "USD/shares") return money(item.value, language); if (series.unit === "shares") return number(item.value, language); return percent(item.value, language); }
function formatRatio(value: number, unit: "ratio" | "percent" | "days", language: string) { if (unit === "percent") return percent(value, language); if (unit === "days") return `${number(value, language)} d`; return `${number(value, language)}×`; }
function money(value: number, language: string) { return new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value); }
function number(value: number, language: string) { return new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { maximumFractionDigits: 2 }).format(value); }
function percent(value: number, language: string) { return new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(value); }
function rates(value: number | readonly number[], language: string) { return Array.isArray(value) ? value.map((item) => percent(item, language)).join(" / ") : percent(value as number, language); }
function safeTicker(raw: string) { try { const value = decodeURIComponent(raw).trim().toUpperCase(); return TICKER_PATTERN.test(value) ? value : ""; } catch { return ""; } }
function unavailableRatio(reason: string | undefined, t: Translate) { if (reason === "financial-issuer") return t("financials.financialRatioUnavailable"); if (reason === "unknown-industry") return t("financials.unknownIndustryUnavailable"); return t("financials.ratioUnavailable"); }
function limitationText(code: EquityReportLimitation, t: Translate) { const labels: Record<EquityReportLimitation, string> = { "business-narrative-not-sourced": t("report.limitBusiness"), "peers-not-sourced": t("report.limitPeers"), "sector-not-sourced": t("report.limitSector"), "valuation-not-run": t("report.limitValuation"), "dated-price-unavailable": t("report.limitPrice"), "unavailable-sec-facts": t("report.limitFacts"), "historical-not-forecast": t("report.limitHistorical") }; return labels[code]; }
function disclaimerText(code: EquityReportDisclaimer, t: Translate) { const labels: Record<EquityReportDisclaimer, string> = { "educational-only": t("report.disclaimerEducational"), "assumption-dependent": t("report.disclaimerAssumptions"), "no-recommendation": t("report.disclaimerNoRecommendation") }; return labels[code]; }
function financialBasisName(key: FundamentalsMetricKey, t: Translate) { const labels: Partial<Record<FundamentalsMetricKey, string>> = { revenue: t("report.basisRevenue"), grossProfit: t("report.basisGrossProfit"), operatingIncome: t("report.basisOperatingIncome"), netIncome: t("report.basisNetIncome"), dilutedEps: t("report.basisDilutedEps"), operatingCashFlow: t("report.basisOperatingCashFlow"), capitalExpenditure: t("report.basisCapex"), freeCashFlow: t("report.basisFcf"), ebitda: t("report.basisEbitda"), totalDebt: t("report.basisTotalDebt"), cashAndEquivalents: t("report.basisCash") }; return labels[key] ?? t("financials.reportedAnnualBasis"); }
function ratioFormulaName(key: CompanyRatioKey, t: Translate) { const labels: Record<CompanyRatioKey, string> = { grossMargin: t("report.formulaGrossMargin"), netMargin: t("report.formulaNetMargin"), returnOnEquity: t("report.formulaRoe"), returnOnAssets: t("report.formulaRoa"), returnOnInvestedCapital: t("report.formulaRoic"), debtToEquity: t("report.formulaDebtEquity"), currentRatio: t("report.formulaCurrent"), quickRatio: t("report.formulaQuick"), interestCoverage: t("report.formulaInterestCoverage"), netDebtToEbitda: t("report.formulaNetDebtEbitda"), assetTurnover: t("report.formulaAssetTurnover"), inventoryTurnover: t("report.formulaInventoryTurnover"), receivablesTurnover: t("report.formulaReceivablesTurnover"), cashConversionCycle: t("report.formulaCashCycle") }; return labels[key]; }
function metricName(key: FundamentalsMetricKey, t: Translate) { const labels: Record<FundamentalsMetricKey, string> = { revenue: t("company.metricRevenue"), netIncome: t("company.metricNetIncome"), operatingIncome: t("company.metricOperatingIncome"), dilutedEps: t("company.metricDilutedEps"), operatingCashFlow: t("company.metricOperatingCashFlow"), capitalExpenditure: t("company.metricCapitalExpenditure"), depreciationAndAmortization: t("company.metricDepreciationAndAmortization"), debtCurrent: t("company.metricDebtCurrent"), longTermDebtNoncurrent: t("company.metricLongTermDebtNoncurrent"), totalDebt: t("company.metricTotalDebt"), cashAndEquivalents: t("company.metricCashAndEquivalents"), dilutedShares: t("company.metricDilutedShares"), sharesOutstanding: t("company.metricSharesOutstanding"), operatingMargin: t("company.metricOperatingMargin"), freeCashFlow: t("company.metricFreeCashFlow"), ebitda: t("company.metricEbitda"), netDebt: t("company.metricNetDebt"), grossProfit: t("company.metricGrossProfit"), costOfRevenue: t("company.metricCostOfRevenue"), incomeTaxExpense: t("company.metricIncomeTaxExpense"), pretaxIncome: t("company.metricPretaxIncome"), totalAssets: t("company.metricTotalAssets"), currentAssets: t("company.metricCurrentAssets"), currentLiabilities: t("company.metricCurrentLiabilities"), stockholdersEquity: t("company.metricStockholdersEquity"), inventoryNet: t("company.metricInventoryNet"), accountsReceivableNetCurrent: t("company.metricAccountsReceivable"), accountsPayableCurrent: t("company.metricAccountsPayable"), interestExpense: t("company.metricInterestExpense") }; return labels[key]; }
function ratioName(key: CompanyRatioKey, t: Translate) { const labels: Record<CompanyRatioKey, string> = { grossMargin: t("financials.grossMargin"), netMargin: t("financials.netMargin"), returnOnEquity: t("financials.roe"), returnOnAssets: t("financials.roa"), returnOnInvestedCapital: t("financials.roic"), debtToEquity: t("financials.debtEquity"), currentRatio: t("financials.currentRatio"), quickRatio: t("financials.quickRatio"), interestCoverage: t("financials.interestCoverage"), netDebtToEbitda: t("financials.netDebtEbitda"), assetTurnover: t("financials.assetTurnover"), inventoryTurnover: t("financials.inventoryTurnover"), receivablesTurnover: t("financials.receivablesTurnover"), cashConversionCycle: t("financials.cashCycle") }; return labels[key]; }
