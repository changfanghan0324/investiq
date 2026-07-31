"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Clock3,
  FileSearch,
  FileText,
  Search,
  ShieldCheck,
  Sigma,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { AppShell } from "@/components/app-shell";
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
          setRecent(parsed.filter((item): item is string => typeof item === "string" && TICKER_PATTERN.test(item)).slice(0, 4));
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
      // Storage is a convenience only; research remains usable when it is blocked.
    }
    router.push(`/company/${encodeURIComponent(ticker)}`);
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <motion.section
          className={styles.command}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          aria-labelledby="research-heading"
        >
          <h1 id="research-heading">{t("research.title")}</h1>
          <p>{t("research.subtitle")}</p>
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
            <motion.button type="submit" whileTap={reducedMotion ? undefined : { scale: 0.985 }}>
              {t("research.searchAction")}
              <ArrowRight size={16} aria-hidden="true" />
            </motion.button>
            <Link className={styles.secondaryAction} href="/portfolio">
              {t("research.openPortfolio")}
            </Link>
          </form>
          {error ? <p className={styles.formError} id="research-error" role="alert">{error}</p> : null}
        </motion.section>

        <section className={styles.workspace} aria-label={t("research.workspaceAria")}>
          <article className={styles.panel}>
            <header><Clock3 size={17} /><h2>{t("research.recentTitle")}</h2></header>
            {recent.length === 0 ? (
              <div className={styles.emptyState}>
                <FileSearch size={31} aria-hidden="true" />
                <strong>{t("research.recentEmpty")}</strong>
                <p>{t("research.recentHint")}</p>
              </div>
            ) : (
              <div className={styles.recentList}>
                {recent.map((ticker) => (
                  <Link key={ticker} href={`/company/${encodeURIComponent(ticker)}`}>
                    <span className={styles.recentTicker}>{ticker.slice(0, 1)}</span>
                    <span><strong>{ticker}</strong><small>{t("research.recentBasis")}</small></span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </article>

          <article className={styles.panel}>
            <header><Sigma size={17} /><h2>{t("research.demoTitle")}</h2></header>
            <div className={styles.demoCard}>
              <div className={styles.demoIdentity}>
                <span className={styles.tickerMark}>A</span>
                <div><strong>AAPL</strong><span>Apple Inc.</span></div>
                <span className={styles.demoLabel}>{t("research.demoLabel")}</span>
              </div>
              <dl>
                <div><dt>{t("research.demoSource")}</dt><dd>SEC EDGAR</dd></div>
                <div><dt>{t("research.demoBasis")}</dt><dd>{t("research.latestReported")}</dd></div>
              </dl>
              <Link className={styles.panelAction} href="/company/AAPL">
                {t("research.viewDemo")}<ArrowRight size={15} />
              </Link>
            </div>
          </article>
        </section>

        <section className={styles.capabilities} aria-labelledby="capabilities-heading">
          <h2 id="capabilities-heading">{t("research.capabilitiesTitle")}</h2>
          <div className={styles.capabilityRows}>
            <Capability icon={<BarChart3 />} title={t("research.financialsTitle")} detail={t("research.financialsText")} />
            <Capability icon={<Sigma />} title={t("research.valuationTitle")} detail={t("research.valuationText")} />
            <Capability icon={<BriefcaseBusiness />} title={t("research.portfolioTitle")} detail={t("research.portfolioText")} />
            <Capability icon={<FileText />} title={t("research.memoTitle")} detail={t("research.memoText")} />
          </div>
          <div className={styles.contextLinks}>
            <Link href="/market">{t("research.marketContext")}<ArrowRight size={14} /></Link>
            <Link href="/methodology">{t("research.methodology")}<ArrowRight size={14} /></Link>
          </div>
        </section>

        <footer className={styles.disclaimer}>
          <ShieldCheck size={15} aria-hidden="true" />
          <span>{t("research.disclaimer")}</span>
        </footer>
      </div>
    </AppShell>
  );
}

function Capability({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className={styles.capability}>
      <span className={styles.capabilityIcon} aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
