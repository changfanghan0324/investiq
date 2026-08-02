"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Database, FileClock } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/i18n/language";

import styles from "./company-research-shell.module.css";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

export function CompanyResearchShell({ ticker: rawTicker, children }: { ticker: string; children: ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const decoded = safeDecode(rawTicker).trim().toUpperCase();
  const ticker = TICKER_PATTERN.test(decoded) ? decoded : "—";
  const base = ticker === "—" ? "/" : `/company/${encodeURIComponent(ticker)}`;
  const tabs = [
    { href: base, label: t("company.tabSummary"), exact: true },
    { href: `${base}/financials`, label: t("company.tabFinancials") },
    { href: `${base}/valuation`, label: t("company.tabValuation") },
    { href: `${base}/memo`, label: t("company.tabMemo") },
    { href: `${base}/report`, label: t("company.tabReport") },
  ];

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.identity} aria-label={t("company.identityAria")}>
          <span className={styles.mark}><Building2 size={21} /></span>
          <div className={styles.title}>
            <strong>{ticker}</strong>
            <span>{t("company.researchWorkspace")}</span>
          </div>
          <div className={styles.meta}>
            <span><Database size={13} />{t("company.sourceSec")}</span>
            <span><FileClock size={13} />{t("company.latestBasis")}</span>
          </div>
        </section>

        <nav className={styles.tabs} aria-label={t("company.tabsAria")}>
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={active ? styles.tabActive : styles.tab}>{tab.label}</Link>;
          })}
        </nav>

        <div className={styles.content}>{children}</div>
        <footer className={styles.footer}>{t("company.disclaimer")}</footer>
      </div>
    </AppShell>
  );
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
