"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, FileWarning, LoaderCircle, TriangleAlert } from "lucide-react";

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
  const netIncome = metric(result, "netIncome");
  const eps = metric(result, "dilutedEps");
  const fcf = metric(result, "freeCashFlow");
  const operatingMargin = metric(result, "operatingMargin");
  const operatingCashFlow = metric(result, "operatingCashFlow");
  const netMargin = alignedRatio(netIncome, revenue);

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
          <FinancialMetric label={t("company.metricNetIncome")} series={netIncome} format="money" t={t} />
          <FinancialMetric label={t("company.metricDilutedEps")} series={eps} format="perShare" t={t} />
          <FinancialMetric label={t("company.metricFreeCashFlow")} series={fcf} format="money" t={t} constructed />
        </div>
      </section>

      <section className={styles.group}>
        <GroupHeader number="2" title={t("financials.profitabilityTitle")} text={t("financials.profitabilityText")} />
        <div className={styles.metricGrid}>
          <FinancialMetric label={t("company.metricOperatingMargin")} series={operatingMargin} format="percent" t={t} />
          <DerivedMetric label={t("financials.netMargin")} value={netMargin} formula={t("financials.netMarginFormula")} />
          <UnavailableMetric label={t("financials.grossMargin")} text={t("financials.grossMarginUnavailable")} />
          <UnavailableMetric label="ROIC" text={t("financials.roicUnavailable")} />
        </div>
      </section>

      <div className={styles.lowerGrid}>
        <section className={styles.group}>
          <GroupHeader number="3" title={t("financials.healthTitle")} text={t("financials.healthText")} />
          <div className={styles.metricGridCompact}>
            <FinancialMetric label={t("company.metricOperatingCashFlow")} series={operatingCashFlow} format="money" t={t} />
            <UnavailableMetric label={t("financials.debtEquity")} text={t("financials.balanceUnavailable")} />
            <UnavailableMetric label={t("financials.currentRatio")} text={t("financials.balanceUnavailable")} />
            <UnavailableMetric label={t("financials.interestCoverage")} text={t("financials.balanceUnavailable")} />
          </div>
        </section>

        <section className={styles.group}>
          <GroupHeader number="4" title={t("financials.efficiencyTitle")} text={t("financials.efficiencyText")} />
          <div className={styles.coverageGate}>
            <FileWarning size={22} />
            <strong>{t("financials.efficiencyGateTitle")}</strong>
            <p>{result.identity.isFinancialIssuer ? t("financials.financialIssuerGate") : t("financials.efficiencyGateText")}</p>
            <ul><li>{t("financials.assetTurnover")}</li><li>{t("financials.inventoryTurnover")}</li><li>{t("financials.cashCycle")}</li></ul>
          </div>
        </section>
      </div>

      <section className={styles.audit}>
        <h2>{t("financials.auditTitle")}</h2>
        <p>{t("financials.auditText")}</p>
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
        </div>
      </section>
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

function DerivedMetric({ label, value, formula }: { label: string; value?: number; formula: string }) {
  const { t } = useLanguage();
  if (value === undefined) return <UnavailableMetric label={label} text={t("company.metricUnavailable")} />;
  return <article className={styles.metric}><header><span>{label}</span><small>{t("company.constructed")}</small></header><strong>{plainPercent(value)}</strong><p>{t("financials.latestAligned")}</p><details><summary>{t("financials.formula")}</summary><p>{formula}</p></details></article>;
}

function UnavailableMetric({ label, text }: { label: string; text: string }) { return <article className={`${styles.metric} ${styles.metricUnavailable}`}><header><span>{label}</span></header><strong>—</strong><p>{text}</p></article>; }
function PageState({ text, error = false }: { text: string; error?: boolean }) { return <section className={styles.state}>{error ? <TriangleAlert /> : <LoaderCircle className={styles.spin} />}<h1>{text}</h1></section>; }

type Format = "money" | "percent" | "perShare";
function metric(result: FundamentalsResult, key: FundamentalsMetricKey) { return result.metrics.find((item) => item.metric === key); }
function alignedRatio(numerator?: FundamentalsSeries, denominator?: FundamentalsSeries) { if (!numerator?.available || !denominator?.available) return undefined; const latest = numerator.observations[0]; const match = denominator.observations.find((item) => item.fiscalYear === latest.fiscalYear && item.periodEnd === latest.periodEnd && item.receipts[0]?.start === latest.receipts[0]?.start); return match && match.value > 0 ? latest.value / match.value : undefined; }
function annualGrowth(latest: number, oldest: number, years: number) { if (!(latest > 0) || !(oldest > 0) || years <= 0) return undefined; return Math.pow(latest / oldest, 1 / years) - 1; }
function signedPercent(value: number) { return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function signedPoints(value: number) { return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`; }
function plainPercent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function formatValue(value: number, format: Format) { if (format === "percent") return plainPercent(value); if (format === "perShare") return `$${value.toFixed(2)}`; const abs = Math.abs(value); if (abs >= 1e12) return `${value < 0 ? "−" : ""}$${(abs / 1e12).toFixed(1)}T`; if (abs >= 1e9) return `${value < 0 ? "−" : ""}$${(abs / 1e9).toFixed(1)}B`; if (abs >= 1e6) return `${value < 0 ? "−" : ""}$${(abs / 1e6).toFixed(1)}M`; return `$${value.toLocaleString("en-US")}`; }
function safeTicker(raw: string) { try { const value = decodeURIComponent(raw).trim().toUpperCase(); return TICKER_PATTERN.test(value) ? value : ""; } catch { return ""; } }
function metricName(key: FundamentalsMetricKey, t: Translate) { const labels: Record<FundamentalsMetricKey, string> = { revenue: t("company.metricRevenue"), netIncome: t("company.metricNetIncome"), operatingIncome: t("company.metricOperatingIncome"), dilutedEps: t("company.metricDilutedEps"), operatingCashFlow: t("company.metricOperatingCashFlow"), capitalExpenditure: t("company.metricCapitalExpenditure"), depreciationAndAmortization: t("company.metricDepreciationAndAmortization"), debtCurrent: t("company.metricDebtCurrent"), longTermDebtNoncurrent: t("company.metricLongTermDebtNoncurrent"), totalDebt: t("company.metricTotalDebt"), cashAndEquivalents: t("company.metricCashAndEquivalents"), dilutedShares: t("company.metricDilutedShares"), sharesOutstanding: t("company.metricSharesOutstanding"), operatingMargin: t("company.metricOperatingMargin"), freeCashFlow: t("company.metricFreeCashFlow"), ebitda: t("company.metricEbitda"), netDebt: t("company.metricNetDebt") }; return labels[key]; }
function financialBasis(key: FundamentalsMetricKey, t: Translate) { if (key === "revenue") return t("company.basisRevenue"); if (key === "operatingMargin") return t("company.basisOperatingMargin"); if (key === "freeCashFlow") return t("company.basisFreeCashFlow"); return t("financials.reportedAnnualBasis"); }
