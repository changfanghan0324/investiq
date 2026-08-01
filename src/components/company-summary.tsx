"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { FundamentalsMetricKey, FundamentalsResult, FundamentalsSeries } from "@/domain/fundamentals";
import { buildStockAnalysis, type StockAnalysisViewModel } from "@/domain/stock-analysis";
import { useLanguage, type Translate, type TranslationKey } from "@/i18n/language";
import { loadCompanyFundamentals } from "@/services/fundamentals-api";
import { loadMarketData } from "@/services/market-data-api";
import { addYearsClamped, todayDateString } from "@/utils/date";

import styles from "./company-summary.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

export function CompanySummary({ rawTicker }: { rawTicker: string }) {
  const { t } = useLanguage();
  const ticker = safeTicker(rawTicker);
  const [fundamentals, setFundamentals] = useState<FundamentalsResult>();
  const [priceContext, setPriceContext] = useState<StockAnalysisViewModel>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) return;
    let active = true;
    const today = todayDateString();

    loadCompanyFundamentals(ticker)
      .then((value) => { if (active) setFundamentals(value); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });

    loadMarketData({
      ticker,
      from: addYearsClamped(today, -5),
      to: today,
      requiredStart: addYearsClamped(today, -5),
      mode: "analysis",
    })
      .then((marketData) => { if (active) setPriceContext(buildStockAnalysis({ marketData, annualRiskFreeRate: 0 })); })
      .catch(() => undefined);

    return () => { active = false; };
  }, [ticker]);

  const revenue = metric(fundamentals, "revenue");
  const operatingMargin = metric(fundamentals, "operatingMargin");
  const freeCashFlow = metric(fundamentals, "freeCashFlow");
  const latestReceipt = useMemo(() => latestSourceReceipt(fundamentals), [fundamentals]);

  if (!ticker) {
    return <StateView icon={<TriangleAlert />} title={t("company.errorTitle")} text={t("company.invalidTicker")} />;
  }
  if (loading && !fundamentals) {
    return <StateView icon={<LoaderCircle className={styles.spin} />} title={t("company.loadingTitle")} text={t("company.loadingText")} />;
  }
  if (!fundamentals) {
    return <StateView icon={<TriangleAlert />} title={t("company.errorTitle")} text={t("company.errorText")} />;
  }

  return (
    <div className={styles.summary}>
      <section className={styles.companyHeader}>
        <span className={styles.companyMark}><Building2 size={22} /></span>
        <div><h1>{fundamentals.identity.name}</h1><p>{fundamentals.identity.ticker} · CIK {fundamentals.identity.cik}</p></div>
        <div className={styles.industry}>
          <span>{t("company.secIndustry")}</span>
          <strong>{fundamentals.identity.sicDescription ?? t("company.unavailable")}</strong>
          {fundamentals.identity.sicCode ? <small>SIC {fundamentals.identity.sicCode}</small> : null}
        </div>
      </section>

      <div className={styles.grid}>
        <main className={styles.mainColumn}>
          <div className={styles.trendGrid}>
            <TrendCard number="1" title={t("company.revenueTrend")} series={revenue} format="money" />
            <TrendCard number="2" title={t("company.marginTrend")} series={operatingMargin} format="percent" />
            <TrendCard number="3" title={t("company.fcfTrend")} series={freeCashFlow} format="money" constructed />
          </div>

          <section className={styles.pricePanel}>
            <header><h2>4. {t("company.priceRiskTitle")}</h2><span>{t("company.priceRiskBasis")}</span></header>
            {priceContext ? (
              <div className={styles.priceMetrics}>
                <Metric label={priceContext.returnBasis === "total" ? t("company.trailingTotalReturn") : t("company.trailingPriceReturn")} value={pct(priceContext.totalReturn ?? priceContext.priceReturn)} />
                <Metric label={t("company.annualizedVolatility")} value={priceContext.volatility === undefined ? "—" : pct(priceContext.volatility, false)} />
                <Metric label={t("company.priceAsOf")} value={priceContext.latestDate} />
              </div>
            ) : (
              <Unavailable text={t("company.priceUnavailable")} />
            )}
          </section>

          <section className={styles.takeaways}>
            <header><h2>5. {t("company.takeawaysTitle")}</h2><p>{t("company.takeawaysSubtitle")}</p></header>
            <Takeaway label={t("company.growthLabel")} text={describeTrend(revenue, "money", t)} />
            <Takeaway label={t("company.profitabilityLabel")} text={describeTrend(operatingMargin, "percent", t)} />
            <Takeaway label={t("company.cashFlowLabel")} text={describeTrend(freeCashFlow, "money", t)} />
            <Link href={`/company/${ticker}/financials`}>{t("company.openFinancials")}<ArrowRight size={14} /></Link>
          </section>
        </main>

        <aside className={styles.evidenceRail}>
          <section>
            <header><Database size={15} /><h2>{t("company.dataBasisTitle")}</h2></header>
            <dl>
              <div><dt>{t("company.primarySource")}</dt><dd>SEC EDGAR</dd></div>
              <div><dt>{t("company.reportingView")}</dt><dd>{t("company.annualLatestReported")}</dd></div>
              <div><dt>{t("company.latestFiled")}</dt><dd>{latestReceipt?.filed ?? "—"}</dd></div>
              <div><dt>{t("company.accession")}</dt><dd className={styles.mono}>{latestReceipt?.accn ?? "—"}</dd></div>
            </dl>
            <p className={styles.disclosure}>{t("company.latestReportedDisclosure")}</p>
            {latestReceipt ? <a href={latestReceipt.sourceUrl} target="_blank" rel="noreferrer">{t("company.openFiling")}<ExternalLink size={13} /></a> : null}
          </section>

          <section>
            <header><CheckCircle2 size={15} /><h2>{t("company.coverageTitle")}</h2></header>
            <p>{t("company.coverageAvailable", { count: fundamentals.metrics.filter((item) => item.available).length })}</p>
            {fundamentals.coverage.unavailable.length ? (
              <details><summary>{t("company.coverageUnavailable", { count: fundamentals.coverage.unavailable.length })}</summary>
                <ul>{fundamentals.coverage.unavailable.map((item) => <li key={item.metric}>{labelMetric(item.metric, t)} — {t("company.metricUnavailable")}</li>)}</ul>
              </details>
            ) : null}
          </section>

          <section>
            <header><Info size={15} /><h2>{t("company.whatMeansTitle")}</h2></header>
            <p>{t("company.whatMeansText")}</p>
            {fundamentals.identity.isFinancialIssuer ? <p className={styles.financialNote}>{t("company.financialIssuerNote")}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function TrendCard({ number, title, series, format, constructed = false }: { number: string; title: string; series?: FundamentalsSeries; format: "money" | "percent"; constructed?: boolean }) {
  const { t } = useLanguage();
  const chart = [...(series?.observations ?? [])].reverse().map((item) => ({ year: `FY${item.fiscalYear}`, value: item.value }));
  return (
    <section className={styles.trendCard}>
      <header><h2>{number}. {title}</h2>{constructed ? <span>{t("company.constructed")}</span> : null}</header>
      {series?.available && chart.length ? (
        <>
          <div className={styles.chart} role="img" aria-label={t("company.chartAria", { title, count: chart.length })}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#242a35" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "#777e8a", fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => compact(value, format)} tick={{ fill: "#777e8a", fontSize: 9 }} width={42} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => display(Number(value), format)} contentStyle={{ background: "#111722", border: "1px solid #363a45", borderRadius: 3, fontSize: 11 }} />
                <Bar dataKey="value" fill="#3f78ff" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <footer><span>{basisLabel(series.metric, t)}</span><strong>{display(series.observations[0].value, format)}</strong></footer>
        </>
      ) : <Unavailable text={t("company.metricUnavailable")} />}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Takeaway({ label, text }: { label: string; text: string }) { return <div className={styles.takeaway}><strong>{label}</strong><p>{text}</p></div>; }
function Unavailable({ text }: { text: string }) { return <div className={styles.unavailable}><TriangleAlert size={15} /><span>{text}</span></div>; }
function StateView({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <section className={styles.state}>{icon}<h1>{title}</h1><p>{text}</p></section>; }

function metric(result: FundamentalsResult | undefined, key: FundamentalsMetricKey) { return result?.metrics.find((item) => item.metric === key); }
function safeTicker(raw: string) { try { const value = decodeURIComponent(raw).trim().toUpperCase(); return TICKER_PATTERN.test(value) ? value : ""; } catch { return ""; } }
function pct(value: number, signed = true) { return `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`; }
function display(value: number, format: "money" | "percent") { return format === "percent" ? pct(value, false) : compactMoney(value); }
function compact(value: number, format: "money" | "percent") { return format === "percent" ? `${(value * 100).toFixed(0)}%` : compactMoney(value); }
function compactMoney(value: number) { const abs = Math.abs(value); if (abs >= 1e12) return `${value < 0 ? "−" : ""}$${(abs / 1e12).toFixed(1)}T`; if (abs >= 1e9) return `${value < 0 ? "−" : ""}$${(abs / 1e9).toFixed(1)}B`; if (abs >= 1e6) return `${value < 0 ? "−" : ""}$${(abs / 1e6).toFixed(1)}M`; return `${value < 0 ? "−" : ""}$${abs.toLocaleString("en-US")}`; }
function describeTrend(series: FundamentalsSeries | undefined, format: "money" | "percent", t: Translate) {
  if (!series?.available || !series.observations.length) return t("company.metricUnavailable");
  const latest = series.observations[0];
  const oldest = series.observations.at(-1)!;
  if (latest === oldest) return t("company.trendSingle", { value: display(latest.value, format), year: latest.fiscalYear });
  const direction = latest.value > oldest.value
    ? t("company.trendIncreased")
    : latest.value < oldest.value
      ? t("company.trendDecreased")
      : t("company.trendUnchanged");
  return t("company.trendComparison", {
    latest: display(latest.value, format),
    latestYear: latest.fiscalYear,
    direction,
    oldest: display(oldest.value, format),
    oldestYear: oldest.fiscalYear,
  });
}
function latestSourceReceipt(result?: FundamentalsResult) { return result?.metrics.flatMap((item) => item.observations.flatMap((obs) => obs.receipts)).sort((a, b) => b.filed.localeCompare(a.filed))[0]; }
const METRIC_LABEL_KEYS: Record<FundamentalsMetricKey, TranslationKey> = {
  revenue: "company.metricRevenue",
  netIncome: "company.metricNetIncome",
  operatingIncome: "company.metricOperatingIncome",
  dilutedEps: "company.metricDilutedEps",
  operatingCashFlow: "company.metricOperatingCashFlow",
  capitalExpenditure: "company.metricCapitalExpenditure",
  depreciationAndAmortization: "company.metricDepreciationAndAmortization",
  debtCurrent: "company.metricDebtCurrent",
  longTermDebtNoncurrent: "company.metricLongTermDebtNoncurrent",
  totalDebt: "company.metricTotalDebt",
  cashAndEquivalents: "company.metricCashAndEquivalents",
  dilutedShares: "company.metricDilutedShares",
  sharesOutstanding: "company.metricSharesOutstanding",
  operatingMargin: "company.metricOperatingMargin",
  freeCashFlow: "company.metricFreeCashFlow",
  ebitda: "company.metricEbitda",
  netDebt: "company.metricNetDebt",
  grossProfit: "company.metricGrossProfit",
  costOfRevenue: "company.metricCostOfRevenue",
  incomeTaxExpense: "company.metricIncomeTaxExpense",
  pretaxIncome: "company.metricPretaxIncome",
  totalAssets: "company.metricTotalAssets",
  currentAssets: "company.metricCurrentAssets",
  currentLiabilities: "company.metricCurrentLiabilities",
  stockholdersEquity: "company.metricStockholdersEquity",
  inventoryNet: "company.metricInventoryNet",
  accountsReceivableNetCurrent: "company.metricAccountsReceivable",
  accountsPayableCurrent: "company.metricAccountsPayable",
  interestExpense: "company.metricInterestExpense",
};
function labelMetric(value: FundamentalsMetricKey, t: Translate) { return t(METRIC_LABEL_KEYS[value]); }
function basisLabel(value: FundamentalsMetricKey, t: Translate) {
  if (value === "revenue") return t("company.basisRevenue");
  if (value === "operatingMargin") return t("company.basisOperatingMargin");
  if (value === "freeCashFlow") return t("company.basisFreeCashFlow");
  return t(METRIC_LABEL_KEYS[value]);
}
