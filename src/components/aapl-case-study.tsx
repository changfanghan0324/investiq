"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/i18n/language";

import styles from "./portfolio-pages.module.css";

export function AaplCaseStudy() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <article className={styles.page}>
        <header className={styles.hero}>
          <h1>{t("caseStudy.title")}</h1>
          <p>{t("caseStudy.subtitle")}</p>
          <div className={styles.actions}>
            <Link href="/company/AAPL">{t("caseStudy.openLive")}<ArrowRight size={15} aria-hidden="true" /></Link>
            <a href="https://github.com/changfanghan0324/investiq/blob/main/docs/EQUITY_RESEARCH_SAMPLE_AAPL.md" target="_blank" rel="noreferrer">
              {t("caseStudy.openSample")}<ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </header>

        <section className={styles.leadSection} aria-labelledby="case-purpose">
          <h2 id="case-purpose">{t("caseStudy.purposeTitle")}</h2>
          <p>{t("caseStudy.purposeText")}</p>
        </section>

        <section className={styles.evidenceTable} aria-labelledby="case-evidence">
          <h2 id="case-evidence">{t("caseStudy.evidenceTitle")}</h2>
          <dl>
            <EvidenceRow title={t("caseStudy.secTitle")} status={t("caseStudy.realEvidence")} text={t("caseStudy.secText")} />
            <EvidenceRow title={t("caseStudy.marketTitle")} status={t("caseStudy.conditionalEvidence")} text={t("caseStudy.marketText")} />
            <EvidenceRow title={t("caseStudy.valuationTitle")} status={t("caseStudy.assumptionEvidence")} text={t("caseStudy.valuationText")} />
            <EvidenceRow title={t("caseStudy.memoTitle")} status={t("caseStudy.userEvidence")} text={t("caseStudy.memoText")} />
          </dl>
        </section>

        <section className={styles.journey} aria-labelledby="case-journey">
          <h2 id="case-journey">{t("caseStudy.journeyTitle")}</h2>
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

function EvidenceRow({ title, status, text }: { title: string; status: string; text: string }) {
  return (
    <div>
      <dt><FileCheck2 size={16} aria-hidden="true" /><span>{title}</span><b>{status}</b></dt>
      <dd>{text}</dd>
    </div>
  );
}

function JourneyLink({ number, href, title, text }: { number: string; href: string; title: string; text: string }) {
  return (
    <Link href={href}>
      <b>{number}</b><span><strong>{title}</strong><small>{text}</small></span><ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}
