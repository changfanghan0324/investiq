"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Calculator,
  Check,
  ExternalLink,
  FileCheck2,
  FileQuestion,
  FileText,
  Code2,
  Landmark,
  PieChart,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { AppShell } from "@/components/app-shell";
import { EvidenceModeNotice } from "@/components/evidence-mode-notice";
import { publicProfile } from "@/config/public-profile";
import { useLanguage } from "@/i18n/language";

import styles from "./research-home.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;
const RECENT_RESEARCH_KEY = "investiq-recent-research";

export function ResearchHome() {
  const { t } = useLanguage();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_RESEARCH_KEY) ?? "[]");
        if (Array.isArray(parsed)) {
          setRecent(parsed.filter((item): item is string => (
            typeof item === "string" && TICKER_PATTERN.test(item)
          )).slice(0, 4));
        }
      } catch {
        setRecent([]);
      }
    });
    return () => window.clearTimeout(restore);
  }, []);

  function openResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticker = query.trim().toUpperCase();
    if (!TICKER_PATTERN.test(ticker)) {
      setError(t("research.validation"));
      return;
    }
    setError("");
    const nextRecent = [ticker, ...recent.filter((item) => item !== ticker)].slice(0, 4);
    setRecent(nextRecent);
    try {
      window.localStorage.setItem(RECENT_RESEARCH_KEY, JSON.stringify(nextRecent));
    } catch {
      // Recent research is optional; navigation remains available without storage.
    }
    router.push(`/company/${encodeURIComponent(ticker)}`);
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <motion.section
          className={styles.hero}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: "easeOut" }}
          aria-labelledby="research-heading"
        >
          <div className={styles.heroCopy}>
            <h1 id="research-heading" aria-label={t("research.auditTitle")}>
              {t("research.auditTitleLead")}<em>{t("research.auditTitleAccent")}</em>{t("research.auditTitleTail")}
            </h1>
            <p>{t("research.auditSubtitle")}</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/case-study/aapl">
                <FileText size={18} aria-hidden="true" />
                {t("research.caseStudyAction")}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a className={styles.secondaryAction} href="#company-search">
                <Search size={18} aria-hidden="true" />
                {t("research.openCompanyAction")}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
          </div>

          <section className={styles.evidencePreview} aria-labelledby="evidence-preview-heading">
            <h2 id="evidence-preview-heading">{t("research.evidencePreviewTitle")}</h2>
            <div className={styles.evidenceFlow}>
              <EvidenceStep icon={<FileCheck2 />} title={t("research.filedFact")} detail={t("research.filedFactText")} />
              <EvidenceStep icon={<ReceiptText />} title={t("research.sourceReceipt")} detail={t("research.sourceReceiptText")} />
              <EvidenceStep icon={<SlidersHorizontal />} title={t("research.modelAssumption")} detail={t("research.modelAssumptionText")} />
              <EvidenceStep icon={<Calculator />} title={t("research.calculatedOutput")} detail={t("research.calculatedOutputText")} />
              <EvidenceStep unavailable icon={<FileQuestion />} title={t("research.unavailableStays")} detail={t("research.unavailableStaysText")} />
            </div>
            <p className={styles.evidencePromise}>
              <ShieldCheck size={18} aria-hidden="true" />
              {t("research.evidencePromise")}
            </p>
          </section>
        </motion.section>

        <EvidenceModeNotice id="public-demo-mode" homepage />

        <section className={styles.truthBand} aria-labelledby="truth-heading">
          <div className={styles.truthTitle}>
            <ShieldCheck size={46} aria-hidden="true" />
            <h2 id="truth-heading">{t("research.truthTitle")}</h2>
          </div>
          <ul>
            <TruthRow>{t("research.truthSec")}</TruthRow>
            <TruthRow warning>{t("research.truthSynthetic")}</TruthRow>
            <TruthRow>{t("research.truthUnavailable")}</TruthRow>
          </ul>
        </section>

        <section className={styles.workflow} aria-labelledby="workflow-heading">
          <h2 id="workflow-heading">{t("research.workflowTitle")}</h2>
          <div className={styles.workflowRail}>
            <WorkflowStep number="1" icon={<Landmark />} title={t("research.workflowFundamentals")} detail={t("research.workflowFundamentalsText")} />
            <WorkflowStep number="2" icon={<Calculator />} title={t("research.workflowValuation")} detail={t("research.workflowValuationText")} />
            <WorkflowStep number="3" icon={<PieChart />} title={t("research.workflowRisk")} detail={t("research.workflowRiskText")} />
            <WorkflowStep number="4" icon={<FileText />} title={t("research.workflowMemo")} detail={t("research.workflowMemoText")} />
          </div>
        </section>

        <section className={styles.companySearch} id="company-search" aria-labelledby="company-search-heading">
          <div>
            <h2 id="company-search-heading">{t("research.companySearchTitle")}</h2>
            <p>{t("research.companySearchText")}</p>
          </div>
          <form className={styles.searchForm} onSubmit={openResearch} noValidate>
            <label className={styles.searchField}>
              <span className={styles.visuallyHidden}>{t("research.searchLabel")}</span>
              <Search size={19} aria-hidden="true" />
              <input
                value={query}
                placeholder={t("research.searchPlaceholder")}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "research-error" : undefined}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (error) setError("");
                }}
              />
            </label>
            <button type="submit">
              {t("research.searchAction")}<ArrowRight size={16} aria-hidden="true" />
            </button>
          </form>
          {error ? <p className={styles.formError} id="research-error" role="alert">{error}</p> : null}
          {recent.length > 0 ? (
            <nav className={styles.recentList} aria-label={t("research.recentTitle")}>
              <span>{t("research.recentTitle")}</span>
              {recent.map((ticker) => <Link key={ticker} href={`/company/${encodeURIComponent(ticker)}`}>{ticker}</Link>)}
            </nav>
          ) : null}
        </section>

        <section className={styles.owner} aria-labelledby="owner-heading">
          <div>
            <h2 id="owner-heading">{t("research.ownerTitle")}</h2>
            <p>{t("research.ownerText")}</p>
          </div>
          <Link href="/about">{t("research.aboutAction")}<ArrowRight size={15} aria-hidden="true" /></Link>
        </section>

        <footer className={styles.footer}>
          <strong>Invest<span>IQ</span></strong>
          <nav aria-label={t("research.footerLinksAria")}>
            <a href={publicProfile.repository} target="_blank" rel="noreferrer">
              <Code2 size={14} aria-hidden="true" />GitHub<ExternalLink size={12} aria-hidden="true" />
            </a>
            <Link href="/methodology">{t("research.methodology")}<ArrowRight size={12} aria-hidden="true" /></Link>
            <Link href="/case-study/aapl">{t("research.caseStudyAction")}<ArrowRight size={12} aria-hidden="true" /></Link>
            <Link href="/about">{t("research.projectBrief")}<ArrowRight size={12} aria-hidden="true" /></Link>
          </nav>
        </footer>
      </div>
    </AppShell>
  );
}

function EvidenceStep({
  icon,
  title,
  detail,
  unavailable = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  unavailable?: boolean;
}) {
  return (
    <div className={unavailable ? styles.evidenceStepUnavailable : styles.evidenceStep}>
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function TruthRow({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <li>{warning ? <TriangleAlert size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}<span>{children}</span></li>;
}

function WorkflowStep({ number, icon, title, detail }: { number: string; icon: ReactNode; title: string; detail: string }) {
  return (
    <article className={styles.workflowStep}>
      <span className={styles.workflowIcon} aria-hidden="true">{icon}</span>
      <b>{number}</b>
      <h3>{title}</h3>
      <p>{detail}</p>
    </article>
  );
}
