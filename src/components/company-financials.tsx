"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, FileWarning, LoaderCircle, TriangleAlert } from "lucide-react";

import { buildCompanyFinancialAnalysis, type CompanyRatioKey, type CompanyRatioSeries } from "@/domain/company-financial-analysis";
import type { FundamentalsMetricKey, FundamentalsResult, FundamentalsSeries } from "@/domain/fundamentals";
import { useLanguage, type Translate } from "@/i18n/language";
import { loadCompanyFundamentals } from "@/services/fundamentals-api";

import styles from "./company-financials.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

export function CompanyFinancials({ rawTicker }: { rawTicker: string }) {
  const { t } = useLanguage();
  const ticker = safeTicker(rawTicker);
  const [result, setResult] = useState<FundamentalsResult>();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let active = true;
    loadCompanyFundamentals(ticker)
      .then((value) => { if (active) setResult(value); })
      .catch(() => undefined)
      .finally(() => { if (active) setSettled(true); });
    return () => { active = false; };
  }, [ticker]);

  if (!ticker || (settled && !result)) return <PageState error text={t("financials.error")} />;
  if (!result) return <PageState text={t("financials.loading")} />;

  const revenue = metric(result, "revenue");
  const eps = metric(result, "dilutedEps");
  const fcf = metric(result, "freeCashFlow");
  const ebitda = metric(result, "ebitda");
  const operatingMargin = metric(result, "operatingMargin");
  const operatingCashFlow = metric(result, "operatingCashFlow");
  const ratios = buildCompanyFinancialAnalysis(result);
  const ratio = (key: CompanyRatioKey) => ratios.find((item) => item.metric === key);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><h1>{t("financials.title")}</h1><p>{t("financials.subtitle", { years: result.fiscalYears.length })}</p></div>
        <span><CheckCircle2 size={14} />{t("financials.basis")}</span>
      </header>

      <section className={styles.group}>
        <GroupHeader number="1" title={t("financials.growthTitle")} text={t("financials.growthText")} />
        <div className={styles.metricGrid}>
          <FinancialMetric label={t("company.metricRevenue")} series={revenue} format="money" t={t} />
          <FinancialMetric label={t("company.metricEbitda")} series={ebitda} format="money" t={t} constructed />
          <FinancialMetric label={t("company.metricDilutedEps")} series={eps} format="perShare" t={t} />
          <FinancialMetric label={t("company.metricFreeCashFlow")} series={fcf} format="money" t={t} constructed />
        </div>
      </section>

      <section className={styles.group}>
        <GroupHeader number="2" title={t("financials.profitabilityTitle")} text={t("financials.profitabilityText")} />
        <div className={styles.metricGrid}>
          <FinancialMetric label={t("company.metricOperatingMargin")} series={operatingMargin} format="percent" t={t} />
          <RatioMetric label={t("financials.grossMargin")} series={ratio("grossMargin")} />
          <RatioMetric label={t("financials.netMargin")} series={ratio("netMargin")} />
          <RatioMetric label={t("financials.roe")} series={ratio("returnOnEquity")} />
          <RatioMetric label={t("financials.roa")} series={ratio("returnOnAssets")} />
          <RatioMetric label={t("financials.roic")} series={ratio("returnOnInvestedCapital")} />
        </div>
      </section>

      <div className={styles.lowerGrid}>
        <section className={styles.group}>
          <GroupHeader number="3" title={t("financials.healthTitle")} text={t("financials.healthText")} />
          <div className={styles.metricGridCompact}>
            <FinancialMetric label={t("company.metricOperatingCashFlow")} series={operatingCashFlow} format="money" t={t} />
            <RatioMetric label={t("financials.debtEquity")} series={ratio("debtToEquity")} />
            <RatioMetric label={t("financials.currentRatio")} series={ratio("currentRatio")} />
            <RatioMetric label={t("financials.quickRatio")} series={ratio("quickRatio")} />
            <RatioMetric label={t("financials.interestCoverage")} series={ratio("interestCoverage")} />
            <RatioMetric label={t("financials.netDebtEbitda")} series={ratio("netDebtToEbitda")} />
          </div>
        </section>

        <section className={styles.group}>
          <GroupHeader number="4" title={t("financials.efficiencyTitle")} text={t("financials.efficiencyText")} />
          <div className={styles.metricGridCompact}>
            <RatioMetric label={t("financials.assetTurnover")} series={ratio("assetTurnover")} />
            <RatioMetric label={t("financials.inventoryTurnover")} series={ratio("inventoryTurnover")} />
            <RatioMetric label={t("financials.receivablesTurnover")} series={ratio("receivablesTurnover")} />
            <RatioMetric label={t("financials.cashCycle")} series={ratio("cashConversionCycle")} />
          </div>
          <p className={styles.methodNote}><FileWarning size={14} />{result.identity.isFinancialIssuer ? t("financials.financialIssuerGate") : t("financials.averageBalanceBasis")}</p>
        </section>
      </div>

      <details className={styles.audit}>
        <summary className={styles.auditHeader}><div><h2>{t("financials.auditTitle")}</h2><p>{t("financials.auditText")}</p></div><span>{t("financials.openEvidence")}</span></summary>
        <div className={styles.auditRows}>
          {result.metrics.filter((item) => item.available).map((item) => {
            const latest = item.observations[0];
            const receipt = latest.receipts[0];
            return (
              <details key={item.metric}>
                <summary><span>{metricName(item.metric, t)}</span><strong>FY{latest.fiscalYear}</strong><small>{receipt?.filed ?? "—"}</small></summary>
                <div><code>{receipt?.taxonomy}:{receipt?.concept}</code><span>{receipt?.accn}</span>{receipt ? <a href={receipt.sourceUrl} target="_blank" rel="noreferrer">{t("company.openFiling")}<ExternalLink size={12} /></a> : null}</div>
              </details>
            );
          })}
          {ratios.filter((item) => item.available).map((item) => {
            const latest = item.observations[0];
            return (
              <details key={`ratio-${item.metric}`}>
                <summary><span>{ratioName(item.metric, t)}</span><strong>FY{latest.fiscalYear}</strong><small>{latest.receipts.length} sources</small></summary>
                <div>{latest.receipts.map((receipt) => <a key={`${receipt.concept}-${receipt.accn}-${receipt.start ?? "instant"}-${receipt.end}`} href={receipt.sourceUrl} target="_blank" rel="noreferrer"><code>{receipt.concept}</code><ExternalLink size={12} /></a>)}</div>
              </details>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function GroupHeader({ number, title, text }: { number: string; title: string; text: string }) { return <header className={styles.groupHeader}><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></header>; }

function FinancialMetric({ label, series, format, t, constructed = false }: { label: string; series?: FundamentalsSeries; format: Format; t: Translate; constructed?: boolean }) {
  if (!series?.available || !series.observations.length) return <UnavailableMetric label={label} text={t("company.metricUnavailable")} />;
  const latest = series.observations[0];
  const oldest = series.observations.at(-1)!;
  const cagr = annualGrowth(latest.value, oldest.value, latest.fiscalYear - oldest.fiscalYear);
  const periodValue = format === "percent" ? signedPoints(latest.value - oldest.value) : cagr === undefined ? "—" : signedPercent(cagr);
  return (
    <article className={styles.metric}>
      <header><span>{label}</span>{constructed ? <small>{t("company.constructed")}</small> : null}</header>
      <strong>{formatValue(latest.value, format)}</strong>
      <p>FY{latest.fiscalYear}</p>
      <div><span>{format === "percent" ? t("financials.periodChange") : t("financials.periodGrowth")}</span><b>{periodValue}</b></div>
      <details><summary>{t("financials.formula")}</summary><p>{financialBasis(series.metric, t)}</p></details>
    </article>
  );
}

function RatioMetric({ label, series }: { label: string; series?: CompanyRatioSeries }) {
  const { t } = useLanguage();
  if (!series?.available || !series.observations.length) return <UnavailableMetric label={label} text={ratioUnavailableText(series, t)} />;
  const latest = series.observations[0];
  const value = series.unit === "percent" ? plainPercent(latest.value) : series.unit === "days" ? `${latest.value.toFixed(1)} ${t("financials.days")}` : `${latest.value.toFixed(2)}×`;
  return <article className={styles.metric}><header><span>{label}</span><small>{t("company.constructed")}</small></header><strong>{value}</strong><p>FY{latest.fiscalYear} · {latest.receipts.length} sources</p><details><summary>{t("financials.formula")}</summary><p>{series.formula}{series.basis ? ` ${series.basis}` : ""}</p></details></article>;
}

function UnavailableMetric({ label, text }: { label: string; text: string }) { return <article className={`${styles.metric} ${styles.metricUnavailable}`}><header><span>{label}</span></header><strong>—</strong><p>{text}</p></article>; }
function PageState({ text, error = false }: { text: string; error?: boolean }) { return <section className={styles.state}>{error ? <TriangleAlert /> : <LoaderCircle className={styles.spin} />}<h1>{text}</h1></section>; }

type Format = "money" | "percent" | "perShare";
function metric(result: FundamentalsResult, key: FundamentalsMetricKey) { return result.metrics.find((item) => item.metric === key); }
function annualGrowth(latest: number, oldest: number, years: number) { if (!(latest > 0) || !(oldest > 0) || years <= 0) return undefined; return Math.pow(latest / oldest, 1 / years) - 1; }
function signedPercent(value: number) { return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function signedPoints(value: number) { return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`; }
function plainPercent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function formatValue(value: number, format: Format) { if (format === "percent") return plainPercent(value); if (format === "perShare") return `$${value.toFixed(2)}`; const abs = Math.abs(value); if (abs >= 1e12) return `${value < 0 ? "−" : ""}$${(abs / 1e12).toFixed(1)}T`; if (abs >= 1e9) return `${value < 0 ? "−" : ""}$${(abs / 1e9).toFixed(1)}B`; if (abs >= 1e6) return `${value < 0 ? "−" : ""}$${(abs / 1e6).toFixed(1)}M`; return `$${value.toLocaleString("en-US")}`; }
function safeTicker(raw: string) { try { const value = decodeURIComponent(raw).trim().toUpperCase(); return TICKER_PATTERN.test(value) ? value : ""; } catch { return ""; } }
function ratioUnavailableText(series: CompanyRatioSeries | undefined, t: Translate) { if (series?.unavailableReason === "financial-issuer") return t("financials.financialRatioUnavailable"); if (series?.unavailableReason === "unknown-industry") return t("financials.unknownIndustryUnavailable"); return t("financials.ratioUnavailable"); }
function ratioName(key: CompanyRatioKey, t: Translate) { const labels: Record<CompanyRatioKey, string> = { grossMargin: t("financials.grossMargin"), netMargin: t("financials.netMargin"), returnOnEquity: t("financials.roe"), returnOnAssets: t("financials.roa"), returnOnInvestedCapital: t("financials.roic"), debtToEquity: t("financials.debtEquity"), currentRatio: t("financials.currentRatio"), quickRatio: t("financials.quickRatio"), interestCoverage: t("financials.interestCoverage"), netDebtToEbitda: t("financials.netDebtEbitda"), assetTurnover: t("financials.assetTurnover"), inventoryTurnover: t("financials.inventoryTurnover"), receivablesTurnover: t("financials.receivablesTurnover"), cashConversionCycle: t("financials.cashCycle") }; return labels[key]; }
function metricName(key: FundamentalsMetricKey, t: Translate) { const labels: Record<FundamentalsMetricKey, string> = { revenue: t("company.metricRevenue"), netIncome: t("company.metricNetIncome"), operatingIncome: t("company.metricOperatingIncome"), dilutedEps: t("company.metricDilutedEps"), operatingCashFlow: t("company.metricOperatingCashFlow"), capitalExpenditure: t("company.metricCapitalExpenditure"), depreciationAndAmortization: t("company.metricDepreciationAndAmortization"), debtCurrent: t("company.metricDebtCurrent"), longTermDebtNoncurrent: t("company.metricLongTermDebtNoncurrent"), totalDebt: t("company.metricTotalDebt"), cashAndEquivalents: t("company.metricCashAndEquivalents"), dilutedShares: t("company.metricDilutedShares"), sharesOutstanding: t("company.metricSharesOutstanding"), operatingMargin: t("company.metricOperatingMargin"), freeCashFlow: t("company.metricFreeCashFlow"), ebitda: t("company.metricEbitda"), netDebt: t("company.metricNetDebt"), grossProfit: t("company.metricGrossProfit"), costOfRevenue: t("company.metricCostOfRevenue"), incomeTaxExpense: t("company.metricIncomeTaxExpense"), pretaxIncome: t("company.metricPretaxIncome"), totalAssets: t("company.metricTotalAssets"), currentAssets: t("company.metricCurrentAssets"), currentLiabilities: t("company.metricCurrentLiabilities"), stockholdersEquity: t("company.metricStockholdersEquity"), inventoryNet: t("company.metricInventoryNet"), accountsReceivableNetCurrent: t("company.metricAccountsReceivable"), accountsPayableCurrent: t("company.metricAccountsPayable"), interestExpense: t("company.metricInterestExpense") }; return labels[key]; }
function financialBasis(key: FundamentalsMetricKey, t: Translate) { if (key === "revenue") return t("company.basisRevenue"); if (key === "operatingMargin") return t("company.basisOperatingMargin"); if (key === "freeCashFlow") return t("company.basisFreeCashFlow"); return t("financials.reportedAnnualBasis"); }
