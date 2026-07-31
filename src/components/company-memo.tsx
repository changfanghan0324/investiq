"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Database, ExternalLink, FileDown, FileText, LoaderCircle, Save, TriangleAlert } from "lucide-react";

import type { FundamentalsMetricKey, FundamentalsResult, FundamentalsSeries, SourceReceipt } from "@/domain/fundamentals";
import { useLanguage, type Translate } from "@/i18n/language";
import { loadCompanyFundamentals } from "@/services/fundamentals-api";
import { loadValuationSnapshot, type ValuationSnapshot } from "@/services/valuation-snapshot";

import styles from "./company-memo.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

interface Notes {
  thesis: string;
  catalysts: string;
  risks: string;
  conclusion: string;
}

const EMPTY_NOTES: Notes = { thesis: "", catalysts: "", risks: "", conclusion: "" };

export function CompanyMemo({ rawTicker }: { rawTicker: string }) {
  const { t, language } = useLanguage();
  const ticker = safeTicker(rawTicker);
  const [fundamentals, setFundamentals] = useState<FundamentalsResult>();
  const [valuation] = useState<ValuationSnapshot | undefined>(() => ticker ? loadValuationSnapshot(ticker) : undefined);
  const [notes, setNotes] = useState<Notes>(() => ticker ? loadNotes(ticker) : EMPTY_NOTES);
  const [settled, setSettled] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    let active = true;
    loadCompanyFundamentals(ticker)
      .then((result) => { if (active) setFundamentals(result); })
      .catch(() => undefined)
      .finally(() => { if (active) setSettled(true); });
    return () => { active = false; };
  }, [ticker]);

  const receipt = useMemo(() => fundamentals ? latestReceipt(fundamentals) : undefined, [fundamentals]);

  function save() {
    try { window.localStorage.setItem(notesKey(ticker), JSON.stringify(notes)); } catch { /* Browser storage may be disabled. */ }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  if (!ticker || (settled && !fundamentals)) return <PageState error text={t("memo.loadError")} />;
  if (!fundamentals) return <PageState text={t("memo.loading")} />;

  const revenue = metric(fundamentals, "revenue");
  const margin = metric(fundamentals, "operatingMargin");
  const fcf = metric(fundamentals, "freeCashFlow");

  return (
    <div className={styles.page} id="investment-memo">
      <header className={styles.heading}>
        <div><span>{t("memo.eyebrow")}</span><h1>{t("memo.title")}</h1><p>{t("memo.subtitle")}</p></div>
        <div className={styles.actions}><button type="button" onClick={save}><Save size={14} />{saved ? t("memo.saved") : t("memo.save")}</button><button type="button" onClick={() => window.print()}><FileDown size={14} />{t("memo.printPdf")}</button></div>
      </header>

      <section className={styles.memo}>
        <header className={styles.memoHeader}>
          <div><small>{t("memo.onePage")}</small><h2>{fundamentals.identity.name}</h2><p>{ticker} · {fundamentals.identity.sicDescription ?? t("company.unavailable")}</p></div>
          <div><span>{t("memo.reportingBasis")}</span><strong>{t("company.annualLatestReported")}</strong><small>{receipt?.filed ?? "—"}</small></div>
        </header>

        <div className={styles.memoGrid}>
          <main>
            <MemoSection number="01" title={t("memo.overviewTitle")}>
              <div className={styles.overviewGrid}>
                <Fact label={t("memo.company")} value={fundamentals.identity.name} />
                <Fact label={t("memo.industry")} value={fundamentals.identity.sicDescription ?? t("company.unavailable")} />
                <Fact label={t("memo.latestFiscalYear")} value={`FY${fundamentals.fiscalYears[0] ?? "—"}`} />
              </div>
              <p className={styles.coverageNote}>{t("memo.businessUnavailable")}</p>
            </MemoSection>

            <MemoSection number="02" title={t("memo.financialEvidenceTitle")}>
              <div className={styles.evidenceGrid}>
                <Evidence label={t("company.metricRevenue")} series={revenue} format="money" t={t} language={language} />
                <Evidence label={t("company.metricOperatingMargin")} series={margin} format="percent" t={t} language={language} />
                <Evidence label={t("company.metricFreeCashFlow")} series={fcf} format="money" t={t} language={language} />
              </div>
              <p className={styles.interpretation}>{buildInterpretation(revenue, margin, fcf, t, language)}</p>
            </MemoSection>

            <MemoSection number="03" title={t("memo.thesisTitle")}>
              <textarea value={notes.thesis} onChange={(event) => setNotes({ ...notes, thesis: event.target.value })} placeholder={t("memo.thesisPlaceholder")} />
            </MemoSection>

            <div className={styles.splitSections}>
              <MemoSection number="04" title={t("memo.catalystsTitle")}>
                <textarea value={notes.catalysts} onChange={(event) => setNotes({ ...notes, catalysts: event.target.value })} placeholder={t("memo.catalystsPlaceholder")} />
              </MemoSection>
              <MemoSection number="05" title={t("memo.risksTitle")}>
                <textarea value={notes.risks} onChange={(event) => setNotes({ ...notes, risks: event.target.value })} placeholder={t("memo.risksPlaceholder")} />
              </MemoSection>
            </div>
          </main>

          <aside>
            <section className={styles.valuationCard}>
              <header><FileText size={15} /><h3>{t("memo.valuationTitle")}</h3></header>
              {valuation ? (
                <>
                  <div className={styles.scenarios}><Fact label={t("valuation.scenario.bear")} value={usd(valuation.values.bear)} /><Fact label={t("valuation.scenario.base")} value={usd(valuation.values.base)} /><Fact label={t("valuation.scenario.bull")} value={usd(valuation.values.bull)} /></div>
                  <dl><div><dt>{t("memo.range")}</dt><dd>{usd(valuation.values.low)} – {usd(valuation.values.high)}</dd></div><div><dt>{t("valuation.currentPrice")}</dt><dd>{valuation.values.currentPrice === undefined ? "—" : `${usd(valuation.values.currentPrice)} · ${valuation.values.quoteDate}`}</dd></div><div><dt>{t("memo.generated")}</dt><dd>{valuation.generatedAt.slice(0, 10)}</dd></div></dl>
                  <p>{t("memo.valuationDisclosure")}</p>
                </>
              ) : <div className={styles.missing}><p>{t("memo.noValuation")}</p><Link href={`/company/${ticker}/valuation`}>{t("memo.openValuation")}</Link></div>}
            </section>

            <section className={styles.conclusionCard}>
              <h3>{t("memo.conclusionTitle")}</h3>
              <textarea value={notes.conclusion} onChange={(event) => setNotes({ ...notes, conclusion: event.target.value })} placeholder={t("memo.conclusionPlaceholder")} />
              <p>{t("memo.noRecommendation")}</p>
            </section>

            <section className={styles.sourceCard}>
              <header><Database size={15} /><h3>{t("memo.sourcesTitle")}</h3></header>
              <dl><div><dt>{t("company.primarySource")}</dt><dd>SEC EDGAR</dd></div><div><dt>{t("company.accession")}</dt><dd>{receipt?.accn ?? "—"}</dd></div><div><dt>{t("company.latestFiled")}</dt><dd>{receipt?.filed ?? "—"}</dd></div></dl>
              {receipt ? <a href={receipt.sourceUrl} target="_blank" rel="noreferrer">{t("company.openFiling")}<ExternalLink size={12} /></a> : null}
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}

function MemoSection({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <section className={styles.section}><header><span>{number}</span><h3>{title}</h3></header>{children}</section>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className={styles.fact}><span>{label}</span><strong>{value}</strong></div>; }
function Evidence({ label, series, format, t, language }: { label: string; series?: FundamentalsSeries; format: "money" | "percent"; t: Translate; language: string }) { if (!series?.available || !series.observations.length) return <Fact label={label} value="—" />; const latest = series.observations[0]; const oldest = series.observations.at(-1)!; const change = format === "percent" ? latest.value - oldest.value : annualGrowth(latest.value, oldest.value, latest.fiscalYear - oldest.fiscalYear); return <div className={styles.fact}><span>{label}</span><strong>{format === "percent" ? percent(latest.value, language) : money(latest.value, language)}</strong><small>{change === undefined ? t("company.metricUnavailable") : format === "percent" ? `${signed(change * 100)} pp` : `${signed(change * 100)}% CAGR`}</small></div>; }
function PageState({ text, error = false }: { text: string; error?: boolean }) { return <section className={styles.state}>{error ? <TriangleAlert /> : <LoaderCircle className={styles.spin} />}<h1>{text}</h1></section>; }

function buildInterpretation(revenue: FundamentalsSeries | undefined, margin: FundamentalsSeries | undefined, fcf: FundamentalsSeries | undefined, t: Translate, language: string) { const revenueGrowth = seriesGrowth(revenue); const marginChange = seriesChange(margin); const fcfGrowth = seriesGrowth(fcf); if (revenueGrowth === undefined && marginChange === undefined && fcfGrowth === undefined) return t("memo.evidenceUnavailable"); return t("memo.interpretation", { revenue: revenueGrowth === undefined ? "—" : `${signed(revenueGrowth * 100)}%`, margin: marginChange === undefined ? "—" : `${signed(marginChange * 100)} pp`, fcf: fcfGrowth === undefined ? "—" : `${signed(fcfGrowth * 100)}%`, basis: language === "zh-CN" ? "CAGR" : "CAGR" }); }
function seriesGrowth(series?: FundamentalsSeries) { if (!series?.available || series.observations.length < 2) return undefined; const latest = series.observations[0]; const oldest = series.observations.at(-1)!; return annualGrowth(latest.value, oldest.value, latest.fiscalYear - oldest.fiscalYear); }
function seriesChange(series?: FundamentalsSeries) { if (!series?.available || series.observations.length < 2) return undefined; return series.observations[0].value - series.observations.at(-1)!.value; }
function annualGrowth(latest: number, oldest: number, years: number) { return latest > 0 && oldest > 0 && years > 0 ? Math.pow(latest / oldest, 1 / years) - 1 : undefined; }
function metric(result: FundamentalsResult, key: FundamentalsMetricKey) { return result.metrics.find((item) => item.metric === key); }
function latestReceipt(result: FundamentalsResult): SourceReceipt | undefined { return result.metrics.flatMap((item) => item.observations.flatMap((observation) => observation.receipts)).sort((a, b) => b.filed.localeCompare(a.filed))[0]; }
function loadNotes(ticker: string): Notes { try { const value: unknown = JSON.parse(window.localStorage.getItem(notesKey(ticker)) ?? "null"); if (!value || typeof value !== "object") return EMPTY_NOTES; const notes = value as Partial<Notes>; return { thesis: text(notes.thesis), catalysts: text(notes.catalysts), risks: text(notes.risks), conclusion: text(notes.conclusion) }; } catch { return EMPTY_NOTES; } }
function text(value: unknown) { return typeof value === "string" ? value.slice(0, 4000) : ""; }
function notesKey(ticker: string) { return `investiq:memo:${ticker}`; }
function safeTicker(raw: string) { try { const value = decodeURIComponent(raw).trim().toUpperCase(); return TICKER_PATTERN.test(value) ? value : ""; } catch { return ""; } }
function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(1)}`; }
function usd(value: number) { return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function money(value: number, language: string) { return `$${new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`; }
function percent(value: number, language: string) { return new Intl.NumberFormat(language === "zh-CN" ? "zh-CN" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(value); }
