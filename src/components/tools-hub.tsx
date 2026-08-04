"use client";

import Link from "next/link";
import { ArrowRight, Calculator, ChartNoAxesCombined, Clock3 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/i18n/language";

import styles from "./tools-hub.module.css";

export function ToolsHub() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.heading}>
          <span><Calculator size={18} />{t("tools.eyebrow")}</span>
          <h1>{t("tools.title")}</h1>
          <p>{t("tools.subtitle")}</p>
        </header>
        <section className={styles.grid} aria-label={t("tools.listAria")}>
          <Link className={styles.tool} href="/tools/dca">
            <Clock3 size={22} />
            <div><h2>{t("tools.dcaTitle")}</h2><p>{t("tools.dcaText")}</p></div>
            <span>{t("tools.open")}<ArrowRight size={14} /></span>
          </Link>
          <Link className={styles.tool} href="/market">
            <ChartNoAxesCombined size={22} />
            <div><h2>{t("tools.marketTitle")}</h2><p>{t("tools.marketText")}</p></div>
            <span>{t("tools.open")}<ArrowRight size={14} /></span>
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
