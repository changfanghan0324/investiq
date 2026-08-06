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
  const { language, t } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState("AAPL");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const zh = language === "zh-CN";

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
            <h1 id="research-heading">{zh ? "基于 SEC 申报文件的公司研究" : "Company research built from SEC filings."}</h1>
            <p>{zh ? "查看财务表现、测试估值假设，并理解投资组合风险。" : "Review financial performance, test valuation assumptions, and understand portfolio risk."}</p>
          </div>
          <form className={styles.searchForm} onSubmit={openResearch} noValidate>
            <label htmlFor="home-ticker">{zh ? "股票代码" : "Ticker"}</label>
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
              <button type="submit">{zh ? "研究公司" : "Research company"}</button>
            </div>
            {error ? <p className={styles.formError} id="research-error" role="alert">{error}</p> : null}
            <div className={styles.heroLinks}>
              <Link href="/case-study/aapl">{zh ? "查看 AAPL 示例" : "View the AAPL example"}</Link>
              <Link href="/methodology">{zh ? "阅读方法说明" : "Read methodology"}</Link>
            </div>
          </form>
        </section>

        <section className={styles.dataTruth} aria-labelledby="data-truth-heading">
          <h2 id="data-truth-heading">{zh ? "本公开演示使用的数据" : "Data used in this public demo"}</h2>
          <dl>
            <div><dt>{zh ? "公司财务数据" : "Company financials"}</dt><dd>{zh ? "真实 SEC 申报文件" : "Real SEC filings"}</dd></div>
            <div><dt>{zh ? "市场示例" : "Market examples"}</dt><dd>{zh ? "合成数据——并非 AAPL、MSFT、SPY 或其他证券的真实市场历史" : "Synthetic data—not actual AAPL, MSFT, SPY, or other market history"}</dd></div>
            <div><dt>{zh ? "缺失字段" : "Missing fields"}</dt><dd>{zh ? "保持不可用，绝不以零替代" : "Left unavailable and never replaced with zero"}</dd></div>
          </dl>
        </section>

        <section className={styles.researchTools} aria-labelledby="research-tools-heading">
          <h2 id="research-tools-heading">{zh ? "研究工具" : "Research tools"}</h2>
          <div className={styles.toolGrid}>
            <article><h3>{zh ? "公司财务" : "Company Financials"}</h3><p>{zh ? "查看收入、利润率、现金流与财务健康状况。" : "Review revenue, margins, cash flow, and financial health."}</p><Link href="/company/AAPL/financials">{zh ? "查看财务" : "Open financials"}</Link></article>
            <article><h3>{zh ? "估值" : "Valuation"}</h3><p>{zh ? "测试 DCF 假设与敏感性。" : "Test DCF assumptions and sensitivity."}</p><Link href="/company/AAPL/valuation">{zh ? "打开估值" : "Open valuation"}</Link></article>
            <article><h3>{zh ? "投资组合" : "Portfolio"}</h3><p>{zh ? "衡量回报、回撤、相关性与集中度。" : "Measure return, drawdown, correlation, and concentration."}</p><Link href="/portfolio">{zh ? "建立投资组合" : "Build a portfolio"}</Link></article>
          </div>
        </section>

        <footer className={styles.footer}>
          <div><strong>{zh ? "由 Fang Han Chang（Peter Chang）构建" : "Built by Fang Han Chang (Peter Chang)"}</strong><p>{zh ? "金融背景 · 即将入读波士顿大学 MSBA" : "Finance background · Incoming Boston University MSBA student"}</p></div>
          <nav aria-label={t("research.footerLinksAria")}>
            <a href={publicProfile.repository} target="_blank" rel="noreferrer">GitHub</a>
            <Link href="/about">{zh ? "关于" : "About"}</Link>
            <Link href="/methodology">{zh ? "方法说明" : "Methodology"}</Link>
          </nav>
        </footer>
      </div>
    </AppShell>
  );
}
