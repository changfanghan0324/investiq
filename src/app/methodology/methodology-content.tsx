"use client";

// Purpose: The standalone methodology document. It states the shared data contract and the
// calculation rules behind the research platform so the workspaces themselves stay uncluttered.
//
// Honesty rules this file follows:
// - It documents only rules the code actually implements. It computes nothing, shows no market
//   figure, and introduces no calculation of its own.
// - Every string comes from the translation catalog, so both languages stay complete.
// - Section and clause numbering is derived from position, never hand-written, so the contents
//   list and the headings can never disagree.

import Link from "next/link";
import { ArrowLeft, ChevronDown, Type } from "lucide-react";

import { fontScaleOptions, languageOptions, type FontScale, type TranslationKey, useLanguage } from "@/i18n/language";

import styles from "./methodology.module.css";

/** One numbered rule inside a section. `rule` is the compact restatement, when one helps. */
interface Clause {
  title: TranslationKey;
  text: TranslationKey;
  rule?: TranslationKey;
}

interface Section {
  /** Anchor target; also the key the formula section is recognised by. */
  id: string;
  title: TranslationKey;
  summary: TranslationKey;
  clauses: Clause[];
}

/** Definition entry in the formula reference. */
interface FormulaEntry {
  term: TranslationKey;
  formula: TranslationKey;
  note: TranslationKey;
}

const SECTIONS: Section[] = [
  {
    id: "data-contract",
    title: "method.data.title",
    summary: "method.data.summary",
    clauses: [
      { title: "method.data.scopeTitle", text: "method.data.scopeText", rule: "method.data.scopeRule" },
      { title: "method.data.eodTitle", text: "method.data.eodText" },
      { title: "method.data.sequentialTitle", text: "method.data.sequentialText", rule: "method.data.sequentialRule" },
      { title: "method.data.adjustedTitle", text: "method.data.adjustedText", rule: "method.data.adjustedRule" },
      { title: "method.data.dividendsTitle", text: "method.data.dividendsText", rule: "method.data.dividendsRule" },
      { title: "method.data.datesTitle", text: "method.data.datesText", rule: "method.data.datesRule" },
      { title: "method.data.missingTitle", text: "method.data.missingText", rule: "method.data.missingRule" },
      { title: "method.data.stopTitle", text: "method.data.stopText", rule: "method.data.stopRule" },
      { title: "method.data.sourceTitle", text: "method.data.sourceText" },
    ],
  },
  {
    id: "market-overview",
    title: "method.market.title",
    summary: "method.market.summary",
    clauses: [
      { title: "method.market.proxiesTitle", text: "method.market.proxiesText", rule: "method.market.proxiesRule" },
      { title: "method.market.windowTitle", text: "method.market.windowText", rule: "method.market.windowRule" },
      { title: "method.market.metricsTitle", text: "method.market.metricsText", rule: "method.market.metricsRule" },
      { title: "method.market.watchlistTitle", text: "method.market.watchlistText", rule: "method.market.watchlistRule" },
      { title: "method.market.bandsTitle", text: "method.market.bandsText" },
      { title: "method.market.dividendsTitle", text: "method.market.dividendsText" },
    ],
  },
  {
    id: "company-fundamentals",
    title: "method.fundamentals.title",
    summary: "method.fundamentals.summary",
    clauses: [
      { title: "method.fundamentals.sourceTitle", text: "method.fundamentals.sourceText", rule: "method.fundamentals.sourceRule" },
      { title: "method.fundamentals.periodTitle", text: "method.fundamentals.periodText", rule: "method.fundamentals.periodRule" },
      { title: "method.fundamentals.constructedTitle", text: "method.fundamentals.constructedText", rule: "method.fundamentals.constructedRule" },
      { title: "method.fundamentals.coverageTitle", text: "method.fundamentals.coverageText" },
    ],
  },
  {
    id: "valuation",
    title: "method.valuation.title",
    summary: "method.valuation.summary",
    clauses: [
      { title: "method.valuation.fcffTitle", text: "method.valuation.fcffText", rule: "method.valuation.fcffRule" },
      { title: "method.valuation.terminalTitle", text: "method.valuation.terminalText", rule: "method.valuation.terminalRule" },
      { title: "method.valuation.rangeTitle", text: "method.valuation.rangeText", rule: "method.valuation.rangeRule" },
      { title: "method.valuation.compsTitle", text: "method.valuation.compsText", rule: "method.valuation.compsRule" },
    ],
  },
  {
    id: "stock-analysis",
    title: "method.stock.title",
    summary: "method.stock.summary",
    clauses: [
      { title: "method.stock.returnsTitle", text: "method.stock.returnsText", rule: "method.stock.returnsRule" },
      { title: "method.stock.cumulativeTitle", text: "method.stock.cumulativeText", rule: "method.stock.cumulativeRule" },
      { title: "method.stock.smaTitle", text: "method.stock.smaText", rule: "method.stock.smaRule" },
      { title: "method.stock.cagrTitle", text: "method.stock.cagrText", rule: "method.stock.cagrRule" },
      { title: "method.stock.volatilityTitle", text: "method.stock.volatilityText", rule: "method.stock.volatilityRule" },
      { title: "method.stock.sharpeTitle", text: "method.stock.sharpeText", rule: "method.stock.sharpeRule" },
      { title: "method.stock.benchmarkTitle", text: "method.stock.benchmarkText", rule: "method.stock.benchmarkRule" },
      { title: "method.stock.volumeTitle", text: "method.stock.volumeText", rule: "method.stock.volumeRule" },
      { title: "method.stock.drawdownTitle", text: "method.stock.drawdownText", rule: "method.stock.drawdownRule" },
    ],
  },
  {
    id: "stock-comparison",
    title: "method.compare.title",
    summary: "method.compare.summary",
    clauses: [
      { title: "method.compare.countTitle", text: "method.compare.countText", rule: "method.compare.countRule" },
      { title: "method.compare.sequentialTitle", text: "method.compare.sequentialText" },
      { title: "method.compare.windowTitle", text: "method.compare.windowText", rule: "method.compare.windowRule" },
      { title: "method.compare.recomputeTitle", text: "method.compare.recomputeText" },
      { title: "method.compare.correlationTitle", text: "method.compare.correlationText", rule: "method.compare.correlationRule" },
      { title: "method.compare.narrativeTitle", text: "method.compare.narrativeText" },
      { title: "method.compare.csvTitle", text: "method.compare.csvText", rule: "method.compare.csvRule" },
    ],
  },
  {
    id: "portfolio-lab",
    title: "method.portfolio.title",
    summary: "method.portfolio.summary",
    clauses: [
      { title: "method.portfolio.holdingsTitle", text: "method.portfolio.holdingsText", rule: "method.portfolio.holdingsRule" },
      { title: "method.portfolio.allocationTitle", text: "method.portfolio.allocationText", rule: "method.portfolio.allocationRule" },
      { title: "method.portfolio.holdTitle", text: "method.portfolio.holdText", rule: "method.portfolio.holdRule" },
      { title: "method.portfolio.windowTitle", text: "method.portfolio.windowText" },
      { title: "method.portfolio.driftTitle", text: "method.portfolio.driftText", rule: "method.portfolio.driftRule" },
      { title: "method.portfolio.attributionTitle", text: "method.portfolio.attributionText", rule: "method.portfolio.attributionRule" },
      { title: "method.portfolio.concentrationTitle", text: "method.portfolio.concentrationText", rule: "method.portfolio.concentrationRule" },
      { title: "method.portfolio.sectorTitle", text: "method.portfolio.sectorText" },
      { title: "method.portfolio.benchmarkTitle", text: "method.portfolio.benchmarkText" },
      { title: "method.portfolio.downsideTitle", text: "method.portfolio.downsideText", rule: "method.portfolio.downsideRule" },
      { title: "method.portfolio.inverseTitle", text: "method.portfolio.inverseText", rule: "method.portfolio.inverseRule" },
      { title: "method.portfolio.excludedTitle", text: "method.portfolio.excludedText", rule: "method.portfolio.excludedRule" },
    ],
  },
  {
    id: "risk-context",
    title: "method.risk.title",
    summary: "method.risk.summary",
    clauses: [
      { title: "method.risk.questionsTitle", text: "method.risk.questionsText", rule: "method.risk.questionsRule" },
      { title: "method.risk.effectTitle", text: "method.risk.effectText", rule: "method.risk.effectRule" },
      { title: "method.risk.localTitle", text: "method.risk.localText", rule: "method.risk.localRule" },
      { title: "method.risk.illustrationTitle", text: "method.risk.illustrationText" },
      { title: "method.risk.notAdviceTitle", text: "method.risk.notAdviceText" },
    ],
  },
  {
    id: "dca-backtest",
    title: "method.dca.title",
    summary: "method.dca.summary",
    clauses: [
      { title: "method.dca.scheduleTitle", text: "method.dca.scheduleText", rule: "method.dca.scheduleRule" },
      { title: "method.dca.executionTitle", text: "method.dca.executionText", rule: "method.dca.executionRule" },
      { title: "method.dca.precisionTitle", text: "method.dca.precisionText", rule: "method.dca.precisionRule" },
      { title: "method.dca.dividendsTitle", text: "method.dca.dividendsText", rule: "method.dca.dividendsRule" },
      { title: "method.dca.feesTitle", text: "method.dca.feesText", rule: "method.dca.feesRule" },
      { title: "method.dca.liquidationTitle", text: "method.dca.liquidationText", rule: "method.dca.liquidationRule" },
      { title: "method.dca.performanceTitle", text: "method.dca.performanceText", rule: "method.dca.performanceRule" },
      { title: "method.dca.drawdownTitle", text: "method.dca.drawdownText", rule: "method.dca.drawdownRule" },
      { title: "method.dca.actionsTitle", text: "method.dca.actionsText", rule: "method.dca.actionsRule" },
      { title: "method.dca.futureTitle", text: "method.dca.futureText" },
    ],
  },
  {
    id: "formulas",
    title: "method.formulas.title",
    summary: "method.formulas.summary",
    clauses: [],
  },
  {
    id: "limitations",
    title: "method.limits.title",
    summary: "method.limits.summary",
    clauses: [
      { title: "method.limits.adviceTitle", text: "method.limits.adviceText" },
      { title: "method.limits.pastTitle", text: "method.limits.pastText" },
      { title: "method.limits.priceReturnTitle", text: "method.limits.priceReturnText" },
      { title: "method.limits.costsTitle", text: "method.limits.costsText" },
      { title: "method.limits.dataTitle", text: "method.limits.dataText" },
      { title: "method.limits.modelTitle", text: "method.limits.modelText" },
    ],
  },
];

const FORMULAS: FormulaEntry[] = [
  { term: "method.formulas.tradingDaysTerm", formula: "method.formulas.tradingDaysFormula", note: "method.formulas.tradingDaysNote" },
  { term: "method.formulas.calendarDaysTerm", formula: "method.formulas.calendarDaysFormula", note: "method.formulas.calendarDaysNote" },
  { term: "method.formulas.dailyReturnTerm", formula: "method.formulas.dailyReturnFormula", note: "method.formulas.dailyReturnNote" },
  { term: "method.formulas.priceReturnTerm", formula: "method.formulas.priceReturnFormula", note: "method.formulas.priceReturnNote" },
  { term: "method.formulas.netGainRatioTerm", formula: "method.formulas.netGainRatioFormula", note: "method.formulas.netGainRatioNote" },
  { term: "method.formulas.twrTerm", formula: "method.formulas.twrFormula", note: "method.formulas.twrNote" },
  { term: "method.formulas.mwrrTerm", formula: "method.formulas.mwrrFormula", note: "method.formulas.mwrrNote" },
  { term: "method.formulas.cagrTerm", formula: "method.formulas.cagrFormula", note: "method.formulas.cagrNote" },
  { term: "method.formulas.volatilityTerm", formula: "method.formulas.volatilityFormula", note: "method.formulas.volatilityNote" },
  { term: "method.formulas.sharpeTerm", formula: "method.formulas.sharpeFormula", note: "method.formulas.sharpeNote" },
  { term: "method.formulas.sortinoTerm", formula: "method.formulas.sortinoFormula", note: "method.formulas.sortinoNote" },
  { term: "method.formulas.varTerm", formula: "method.formulas.varFormula", note: "method.formulas.varNote" },
  { term: "method.formulas.alphaTerm", formula: "method.formulas.alphaFormula", note: "method.formulas.alphaNote" },
  { term: "method.formulas.riskFreeTerm", formula: "method.formulas.riskFreeFormula", note: "method.formulas.riskFreeNote" },
  { term: "method.formulas.drawdownTerm", formula: "method.formulas.drawdownFormula", note: "method.formulas.drawdownNote" },
  { term: "method.formulas.betaTerm", formula: "method.formulas.betaFormula", note: "method.formulas.betaNote" },
  { term: "method.formulas.correlationTerm", formula: "method.formulas.correlationFormula", note: "method.formulas.correlationNote" },
  { term: "method.formulas.hhiTerm", formula: "method.formulas.hhiFormula", note: "method.formulas.hhiNote" },
  { term: "method.formulas.effectiveTerm", formula: "method.formulas.effectiveFormula", note: "method.formulas.effectiveNote" },
  { term: "method.formulas.fcffTerm", formula: "method.formulas.fcffFormula", note: "method.formulas.fcffNote" },
  { term: "method.formulas.terminalTerm", formula: "method.formulas.terminalFormula", note: "method.formulas.terminalNote" },
  { term: "method.formulas.equityBridgeTerm", formula: "method.formulas.equityBridgeFormula", note: "method.formulas.equityBridgeNote" },
];

/** Two-digit section number, so the contents list and the headings line up in a monospace column. */
function sectionNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function MethodologyContent() {
  const { fontScale, language, setFontScale, setLanguage, t } = useLanguage();
  const activeLanguage = languageOptions.find((option) => option.code === language) ?? languageOptions[0];

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#methodology-document">{t("shell.skipToContent")}</a>

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label={t("method.backAria")}>
          <span className={styles.brandMark}><i /><b /></span>
          <strong>InvestIQ</strong>
        </Link>
        <div className={styles.topbarActions}>
          <label className={styles.languageControl} title={t("language.label")}>
            <span className={styles.visuallyHidden}>{t("language.label")}</span>
            <span className={styles.languageCurrent} aria-hidden="true"><span>{activeLanguage.flag}</span><b>{activeLanguage.shortLabel}</b></span>
            <select value={language} aria-label={t("language.label")} onChange={(event) => setLanguage(event.target.value as typeof language)}>
              {languageOptions.map((option) => <option key={option.code} value={option.code}>{option.flag} {option.label}</option>)}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </label>
          <label className={styles.fontScaleControl} title={t("display.fontSize")}>
            <span className={styles.visuallyHidden}>{t("display.fontSize")}</span>
            <span className={styles.fontScaleCurrent} aria-hidden="true"><Type size={13} /><b>{fontScale}%</b></span>
            <select value={fontScale} aria-label={t("display.fontSize")} onChange={(event) => setFontScale(event.target.value as FontScale)}>
              {fontScaleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </label>
          <Link className={styles.backLink} href="/" aria-label={t("method.backAria")}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{t("method.back")}</span>
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        <article
          className={styles.document}
          id="methodology-document"
          tabIndex={-1}
          aria-labelledby="methodology-title"
        >
          <header className={styles.masthead}>
            <h1 id="methodology-title">{t("method.title")}</h1>
            <p className={styles.lede}>{t("method.intro")}</p>
            <dl className={styles.docMeta}>
              <div>
                <dt>{t("method.metaScopeLabel")}</dt>
                <dd>{t("method.metaScopeValue")}</dd>
              </div>
              <div>
                <dt>{t("method.metaBasisLabel")}</dt>
                <dd>{t("method.metaBasisValue")}</dd>
              </div>
              <div>
                <dt>{t("method.metaStatusLabel")}</dt>
                <dd>{t("method.metaStatusValue")}</dd>
              </div>
            </dl>
          </header>

          <nav className={styles.toc} aria-label={t("method.tocAria")}>
            <h2 className={styles.tocTitle}>{t("method.tocTitle")}</h2>
            <ol>
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span className={styles.tocNumber}>{sectionNumber(index)}</span>
                    <span>{t(section.title)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {SECTIONS.map((section, index) => (
            <section
              className={styles.section}
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
            >
              <header className={styles.sectionHead}>
                <p className={styles.sectionNumber}>{sectionNumber(index)}</p>
                <h2 id={`${section.id}-heading`}>{t(section.title)}</h2>
                <p className={styles.sectionSummary}>{t(section.summary)}</p>
              </header>

              {section.id === "formulas" ? (
                <dl className={styles.formulaList}>
                  {FORMULAS.map((entry) => (
                    <div className={styles.formulaEntry} key={entry.term}>
                      <dt>{t(entry.term)}</dt>
                      <dd>
                        <code>{t(entry.formula)}</code>
                        <p>{t(entry.note)}</p>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <ol className={styles.clauseList}>
                  {section.clauses.map((clause, clauseIndex) => (
                    <li className={styles.clause} key={clause.title}>
                      <h3>
                        <span className={styles.clauseNumber}>{`${index + 1}.${clauseIndex + 1}`}</span>
                        <span>{t(clause.title)}</span>
                      </h3>
                      <p>{t(clause.text)}</p>
                      {clause.rule ? <code>{t(clause.rule)}</code> : null}
                    </li>
                  ))}
                </ol>
              )}

              {section.id === "dca-backtest" ? (
                <p className={styles.callout}>{t("method.dca.futureWarning")}</p>
              ) : null}
            </section>
          ))}

          <footer className={styles.docFooter}>
            <p>{t("shell.disclaimer")}</p>
            <Link className={styles.footerLink} href="/">
              <ArrowLeft size={14} aria-hidden="true" />
              <span>{t("method.back")}</span>
            </Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
