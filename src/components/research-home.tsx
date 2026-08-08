"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { publicProfile } from "@/config/public-profile";
import { useLanguage } from "@/i18n/language";

import styles from "./research-home.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;
const RECENT_RESEARCH_KEY = "investiq-recent-research";

export function ResearchHome() {
  const { t } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState("AAPL");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_RESEARCH_KEY) ?? "[]");
        if (Array.isArray(parsed)) {
          setRecent(parsed.filter((item): item is string => typeof item === "string" && TICKER_PATTERN.test(item)).slice(0, 4));
        }
      } catch {
        setRecent([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
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
        <section className={styles.hero} aria-labelledby="research-heading">
          <div className={styles.heroCopy}>
            <h1 id="research-heading">{t("research.heroTitle")}</h1>
            <p>{t("research.heroSubtitle")}</p>
          </div>
          <form className={styles.searchForm} onSubmit={openResearch} noValidate>
            <label htmlFor="home-ticker">{t("research.tickerLabel")}</label>
            <div className={styles.searchRow}>
              <input
                id="home-ticker"
                value={query}
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
              <button type="submit">{t("research.searchAction")}</button>
            </div>
            {error ? <p className={styles.formError} id="research-error" role="alert">{error}</p> : null}
            <div className={styles.heroLinks}>
              <Link href="/case-study/aapl">{t("research.viewCaseStudy")}</Link>
              <Link href="/methodology">{t("research.readMethodology")}</Link>
            </div>
          </form>
        </section>

        <section className={styles.dataTruth} aria-labelledby="data-truth-heading">
          <h2 id="data-truth-heading">{t("research.publicDemoDataTitle")}</h2>
          <dl>
            <div><dt>{t("research.companyFinancials")}</dt><dd>{t("research.realSecFilings")}</dd></div>
            <div><dt>{t("research.marketExamples")}</dt><dd>{t("research.syntheticMarketHistory")}</dd></div>
            <div><dt>{t("research.missingFields")}</dt><dd>{t("research.missingFieldsText")}</dd></div>
          </dl>
        </section>

        <section className={styles.researchTools} aria-labelledby="research-tools-heading">
          <h2 id="research-tools-heading">{t("research.toolsTitle")}</h2>
          <div className={styles.toolGrid}>
            <article><h3>{t("research.financialsTool")}</h3><p>{t("research.financialsToolText")}</p><Link href="/company/AAPL/financials">{t("research.openFinancials")}</Link></article>
            <article><h3>{t("research.valuationTool")}</h3><p>{t("research.valuationToolText")}</p><Link href="/company/AAPL/valuation">{t("research.openValuation")}</Link></article>
            <article><h3>{t("research.portfolioTool")}</h3><p>{t("research.portfolioToolText")}</p><Link href="/portfolio">{t("research.buildPortfolio")}</Link></article>
          </div>
        </section>

        <footer className={styles.footer}>
          <div><strong>{t("research.ownerFooter")}</strong><p>{t("research.ownerFooterText")}</p></div>
          <nav aria-label={t("research.footerLinksAria")}>
            <a href={publicProfile.repository} target="_blank" rel="noreferrer">GitHub</a>
            <Link href="/about">{t("research.aboutLink")}</Link>
            <Link href="/methodology">{t("research.methodologyLink")}</Link>
          </nav>
        </footer>
      </div>
    </AppShell>
  );
}
