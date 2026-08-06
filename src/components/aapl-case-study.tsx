"use client";

import Link from "next/link";
import {
  ArrowRight,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  Scale,
  ShieldCheck,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { buildAaplCaseStudy, type AaplScenarioView } from "@/domain/aapl-case-study";
import { useLanguage, type Translate } from "@/i18n/language";

import styles from "./portfolio-pages.module.css";

const caseView = buildAaplCaseStudy();

export function AaplCaseStudy() {
  const { locale, t } = useLanguage();
  const { source, historical, bridge, scenarios, sensitivity } = caseView;

  return (
    <AppShell>
      <article className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.caseTags}>
            <span>{t("caseStudy.snapshot")}</span>
            <span>{t("caseStudy.caseAsOf", { date: source.caseAsOf })}</span>
            <span>{t("caseStudy.educational")}</span>
          </div>
          <h1>{t("caseStudy.title")}</h1>
          <p>{t("caseStudy.subtitle")}</p>
          <div className={styles.actions}>
            <a
              href="https://github.com/changfanghan0324/investiq/blob/main/docs/EQUITY_RESEARCH_SAMPLE_AAPL.md"
              target="_blank"
              rel="noreferrer"
            >
              {t("caseStudy.openSample")}<ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </header>

        <section className={styles.caseSummary} aria-labelledby="case-summary">
          <div>
            <span>{t("caseStudy.analyst")}</span>
            <h2 id="case-summary">{t("caseStudy.summaryTitle")}</h2>
            <p>{t("caseStudy.summaryText")}</p>
          </div>
          <div className={styles.caseOutputStrip}>
            {scenarios.map((scenario) => (
              <div key={scenario.id}>
                <small>{scenarioName(scenario, t)}</small>
                <strong>{moneyPerShare(scenario.valuation.impliedSharePrice, locale)}</strong>
                <span>{t("caseStudy.scenarioOutput")}</span>
              </div>
            ))}
          </div>
          <p className={styles.caseDisclaimer}>{t("caseStudy.latestReported")}</p>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-history">
          <div className={styles.sectionHeading}>
            <div><span>{t("caseStudy.reported")}</span><h2 id="case-history">{t("caseStudy.historicalTitle")}</h2></div>
            <p>{t("caseStudy.historicalText")}</p>
          </div>
          <div className={styles.caseMetricGrid}>
            <MetricCard
              title={t("caseStudy.revenueTitle")}
              value={compactMoney(historical.revenueLatest, locale)}
              text={t("caseStudy.revenueReading", {
                value: compactMoney(historical.revenueLatest, locale),
                cagr: percent(historical.revenueCagr, locale),
              })}
              tag={t("caseStudy.reported")}
            />
            <MetricCard
              title={t("caseStudy.marginTitle")}
              value={percent(historical.operatingMarginLatest, locale)}
              text={t("caseStudy.marginReading", {
                value: percent(historical.operatingMarginLatest, locale),
                change: percentagePoints(historical.operatingMarginChange, locale),
              })}
              tag={t("caseStudy.constructed")}
            />
            <MetricCard
              title={t("caseStudy.fcfTitle")}
              value={compactMoney(historical.freeCashFlowLatest, locale)}
              text={t("caseStudy.fcfReading", { value: compactMoney(historical.freeCashFlowLatest, locale) })}
              tag={t("caseStudy.constructed")}
            />
            <MetricCard
              title={t("caseStudy.epsTitle")}
              value={moneyPerShare(historical.dilutedEpsLatest, locale)}
              text={t("caseStudy.epsReading", {
                value: moneyPerShare(historical.dilutedEpsLatest, locale),
                cagr: percent(historical.dilutedEpsCagr, locale),
              })}
              tag={t("caseStudy.reported")}
            />
            <MetricCard
              title={t("caseStudy.taxTitle")}
              value={percent(historical.effectiveTaxLatest, locale)}
              text={t("caseStudy.taxReading", {
                latest: percent(historical.effectiveTaxLatest, locale),
                median: percent(historical.effectiveTaxMedian, locale),
              })}
              tag={t("caseStudy.constructed")}
            />
          </div>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-bridge">
          <div className={styles.sectionHeading}>
            <div><span>{t("caseStudy.constructed")}</span><h2 id="case-bridge">{t("caseStudy.bridgeTitle")}</h2></div>
            <p>{t("caseStudy.bridgeText")}</p>
          </div>
          <div className={styles.bridgePanel}>
            <dl>
              <BridgeRow label={t("caseStudy.commercialPaper")} value={billionsMoney(bridge.commercialPaper, locale)} />
              <BridgeRow label={t("caseStudy.currentTermDebt")} value={billionsMoney(bridge.currentTermDebt, locale)} />
              <BridgeRow label={t("caseStudy.currentDebt")} value={billionsMoney(bridge.currentDebt, locale)} subtotal />
              <BridgeRow label={t("caseStudy.noncurrentDebt")} value={billionsMoney(bridge.noncurrentDebt, locale)} />
              <BridgeRow label={t("caseStudy.cash")} value={`−${billionsMoney(bridge.cashAndEquivalents, locale)}`} />
              <BridgeRow label={t("caseStudy.dcfNetDebt")} value={billionsMoney(bridge.dcfNetDebt, locale)} total />
            </dl>
            <div className={styles.bridgeFormula}>
              <Scale aria-hidden="true" />
              <span>{t("caseStudy.bridgeFormula")}</span>
              <strong>{billionsMoney(bridge.dcfNetDebt, locale)}</strong>
              <small>{bridge.periodEnd}</small>
            </div>
          </div>
          <div className={styles.liquidityCallout}>
            <strong>{t("caseStudy.marketableSecurities")}: {billionsMoney(bridge.marketableSecurities, locale)}</strong>
            <p>{t("caseStudy.liquidityContext", {
              value: billionsMoney(bridge.marketableSecurities, locale),
              perShare: moneyPerShare(bridge.broaderLiquidityImpactPerShare, locale),
            })}</p>
          </div>
          <div className={styles.shareConvention}>
            <div><span>{t("caseStudy.shareTitle")}</span><strong>{t("caseStudy.dilutedShares")}</strong><b>{billionsCount(source.dilutedWeightedAverageShares.value, locale)}</b></div>
            <div><span>{t("caseStudy.shareTitle")}</span><strong>{t("caseStudy.pointShares")}</strong><b>{billionsCount(pointShares(), locale)}</b></div>
            <p>{t("caseStudy.shareText")}</p>
          </div>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-scenarios">
          <div className={styles.sectionHeading}>
            <div><span>{t("caseStudy.analyst")}</span><h2 id="case-scenarios">{t("caseStudy.scenarioTitle")}</h2></div>
            <p>{t("caseStudy.scenarioText")}</p>
          </div>
          <div className={styles.caseTableScroll} role="region" tabIndex={0} aria-label={t("caseStudy.scenarioTitle")}>
            <table className={styles.caseTable}>
              <thead><tr><th>{t("caseStudy.assumptionOwner")}</th>{scenarios.map((scenario) => <th key={scenario.id}>{scenarioName(scenario, t)}</th>)}</tr></thead>
              <tbody>
                <ScenarioRow label={t("valuation.revenueGrowth")} scenarios={scenarios} value={(item) => rate(item.assumptions.revenueGrowth, locale)} />
                <ScenarioRow label={t("valuation.operatingMargin")} scenarios={scenarios} value={(item) => rate(item.assumptions.operatingMargin, locale)} />
                <ScenarioRow label={t("valuation.cashTax")} scenarios={scenarios} value={(item) => percent(item.assumptions.cashTaxRate, locale)} />
                <ScenarioRow label={t("valuation.daRevenue")} scenarios={scenarios} value={(item) => rate(item.assumptions.daPercentOfRevenue, locale)} />
                <ScenarioRow label={t("valuation.capexRevenue")} scenarios={scenarios} value={(item) => rate(item.assumptions.capexPercentOfRevenue, locale)} />
                <ScenarioRow label={t("valuation.nwcIncremental")} scenarios={scenarios} value={(item) => rate(item.assumptions.nwcPercentOfIncrementalRevenue, locale)} />
                <ScenarioRow label="WACC" scenarios={scenarios} value={(item) => percent(item.assumptions.wacc, locale)} />
                <ScenarioRow label={t("valuation.terminalGrowth")} scenarios={scenarios} value={(item) => percent(item.assumptions.terminalGrowth, locale)} />
                <ScenarioRow label={t("caseStudy.scenarioOutput")} scenarios={scenarios} value={(item) => moneyPerShare(item.valuation.impliedSharePrice, locale)} strong />
                <ScenarioRow label={t("caseStudy.terminalShare")} scenarios={scenarios} value={(item) => item.valuation.terminalValuePercentOfEnterprise === null ? "—" : percent(item.valuation.terminalValuePercentOfEnterprise, locale)} />
              </tbody>
            </table>
          </div>
          <div className={styles.caseNotes}>
            <p>{t("caseStudy.nwcNote")}</p>
            <p>{t("caseStudy.horizonNote")}</p>
          </div>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-sensitivity">
          <div className={styles.sectionHeading}>
            <div><span>{t("caseStudy.analyst")}</span><h2 id="case-sensitivity">{t("caseStudy.sensitivityTitle")}</h2></div>
            <p>{t("caseStudy.sensitivityText", {
              low: moneyPerShare(sensitivity.minimum, locale),
              high: moneyPerShare(sensitivity.maximum, locale),
            })}</p>
          </div>
          <SensitivityTable locale={locale} t={t} />
        </section>

        <section className={styles.caseSection} aria-labelledby="case-thesis">
          <div className={styles.sectionHeading}>
            <div><span>{t("caseStudy.analyst")}</span><h2 id="case-thesis">{t("caseStudy.thesisTitle")}</h2></div>
          </div>
          <ul className={styles.caseList}>{source.thesisKeys.map((key) => <li key={key}>{t(key)}</li>)}</ul>
          <div className={styles.calibrationCallout}>
            <FlaskConical aria-hidden="true" />
            <div><h3>{t("caseStudy.calibrationTitle")}</h3><p>{t("caseStudy.calibrationText")}</p></div>
          </div>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-catalysts-risks">
          <div className={styles.sectionHeading}>
            <div><span>{t("caseStudy.officialMonitoring")}</span><h2 id="case-catalysts-risks">{t("caseStudy.catalystRiskTitle")}</h2></div>
          </div>
          <div className={styles.subsequentNote}><strong>{t("caseStudy.subsequentTitle")}</strong><p>{t("caseStudy.subsequentText")}</p></div>
          <div className={styles.narrativeGrid}>
            {[...source.catalysts, ...source.risks].map((item) => {
              const citation = source.citations.find((candidate) => candidate.id === item.citationId);
              return <article key={item.id}><h3>{t(item.titleKey)}</h3><p>{t(item.textKey)}</p><small>{t(item.monitorKey)}</small>{citation ? <a href={citation.url} target="_blank" rel="noreferrer">{t("caseStudy.openSource")}<ExternalLink size={11} aria-hidden="true" /></a> : null}</article>;
            })}
          </div>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-conditions">
          <div className={styles.conditionGrid}>
            <div><h2 id="case-conditions">{t("caseStudy.invalidationTitle")}</h2><ul>{source.invalidationKeys.map((key) => <li key={key}>{t(key)}</li>)}</ul></div>
            <div><h2>{t("caseStudy.unresolvedTitle")}</h2><ul>{source.unresolvedKeys.map((key) => <li key={key}>{t(key)}</li>)}</ul></div>
          </div>
        </section>

        <section className={styles.caseSection} aria-labelledby="case-sources">
          <details className={styles.sourceDetails}>
            <summary id="case-sources"><span><FileCheck2 aria-hidden="true" />{t("caseStudy.sourcesTitle")}</span></summary>
            <p>{t("caseStudy.sourcesText")}</p>
            <div className={styles.sourceRegister}>
              {caseView.sourceReceipts.map((receipt) => (
                <a key={`${receipt.accn}-${receipt.concept}-${receipt.start ?? receipt.end}`} href={receipt.sourceUrl} target="_blank" rel="noreferrer">
                  <strong>{receipt.concept}</strong><span>{receipt.end} · {receipt.accn}</span><small>{receipt.form} · {receipt.filed}</small>
                </a>
              ))}
              {source.citations.map((citation) => (
                <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer">
                  <strong>{t(citation.sectionKey)}</strong><span>{citation.periodEnd} · {citation.documentType}</span><small>{citation.publishedOrFiled}</small>
                </a>
              ))}
            </div>
          </details>
        </section>

        <section className={styles.journey} aria-labelledby="case-journey">
          <div className={styles.sectionHeading}><div><h2 id="case-journey">{t("caseStudy.workspaceTitle")}</h2></div><p>{t("caseStudy.workspaceText")}</p></div>
          <div>
            <JourneyLink number="1" href="/company/AAPL" title={t("caseStudy.summaryStep")} text={t("caseStudy.summaryStepText")} />
            <JourneyLink number="2" href="/company/AAPL/financials" title={t("caseStudy.financialsStep")} text={t("caseStudy.financialsStepText")} />
            <JourneyLink number="3" href="/company/AAPL/valuation" title={t("caseStudy.valuationStep")} text={t("caseStudy.valuationStepText")} />
            <JourneyLink number="4" href="/company/AAPL/report" title={t("caseStudy.reportStep")} text={t("caseStudy.reportStepText")} />
          </div>
        </section>

        <section className={styles.note}>
          <ShieldCheck size={24} aria-hidden="true" />
          <div><h2>{t("caseStudy.limitsTitle")}</h2><p>{t("caseStudy.limitsText")}</p></div>
        </section>
      </article>
    </AppShell>
  );
}

function MetricCard({ title, value, text, tag }: { title: string; value: string; text: string; tag: string }) {
  return <article><span>{tag}</span><h3>{title}</h3><strong>{value}</strong><p>{text}</p></article>;
}

function BridgeRow({ label, value, subtotal = false, total = false }: { label: string; value: string; subtotal?: boolean; total?: boolean }) {
  return <div data-subtotal={subtotal || undefined} data-total={total || undefined}><dt>{label}</dt><dd>{value}</dd></div>;
}

function ScenarioRow({ label, scenarios, value, strong = false }: { label: string; scenarios: AaplScenarioView[]; value: (scenario: AaplScenarioView) => string; strong?: boolean }) {
  return <tr><th>{label}</th>{scenarios.map((scenario) => <td key={scenario.id}>{strong ? <strong>{value(scenario)}</strong> : value(scenario)}</td>)}</tr>;
}

function SensitivityTable({ locale, t }: { locale: string; t: Translate }) {
  const { table } = caseView.sensitivity;
  return <div className={styles.caseTableScroll} role="region" tabIndex={0} aria-label={t("caseStudy.sensitivityTitle")}><table className={styles.caseTable}><thead><tr><th>{t("caseStudy.sensitivityAxis")}</th>{table.columnAxis.values.map((value) => <th key={value}>{percent(value, locale)}</th>)}</tr></thead><tbody>{table.cells.map((row, rowIndex) => <tr key={table.rowAxis.values[rowIndex]}><th>{percent(table.rowAxis.values[rowIndex], locale)}</th>{row.map((cell, columnIndex) => <td key={table.columnAxis.values[columnIndex]}>{cell.available ? moneyPerShare(cell.impliedSharePrice, locale) : "—"}</td>)}</tr>)}</tbody></table></div>;
}

function JourneyLink({ number, href, title, text }: { number: string; href: string; title: string; text: string }) {
  return <Link href={href}><b>{number}</b><span><strong>{title}</strong><small>{text}</small></span><ArrowRight size={16} aria-hidden="true" /></Link>;
}

function scenarioName(scenario: AaplScenarioView, t: Translate): string {
  return t(`caseStudy.${scenario.id}` as "caseStudy.bear" | "caseStudy.base" | "caseStudy.bull");
}

function pointShares(): number {
  return caseView.source.balanceSheet.find((item) => item.id === "sharesOutstanding")?.value ?? 0;
}

function rate(value: number | readonly number[], locale: string): string {
  return percent(Array.isArray(value) ? value[0] : value as number, locale);
}

function compactMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function billionsMoney(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value / 1_000_000_000)}B`;
}

function billionsCount(value: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value / 1_000_000_000)}B`;
}

function moneyPerShare(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function percent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function percentagePoints(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100);
}
