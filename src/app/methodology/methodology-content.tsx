"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Landmark,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Type,
} from "lucide-react";

import { fontScaleOptions, languageOptions, type FontScale, type TranslationKey, useLanguage } from "@/i18n/language";

import styles from "./methodology.module.css";

const rules: Array<{
  icon: typeof CalendarDays;
  title: TranslationKey;
  text: TranslationKey;
  detail: TranslationKey;
}> = [
  { icon: CalendarDays, title: "method.orderTitle", text: "method.orderText", detail: "method.orderDetail" },
  { icon: RefreshCw, title: "method.recurringTitle", text: "method.recurringText", detail: "method.recurringDetail" },
  { icon: CircleDollarSign, title: "method.dividendTitle", text: "method.dividendText", detail: "method.dividendDetail" },
  { icon: Landmark, title: "method.feesTitle", text: "method.feesText", detail: "method.feesDetail" },
  { icon: TrendingDown, title: "method.returnTitle", text: "method.returnText", detail: "method.returnDetail" },
  { icon: ShieldCheck, title: "method.actionsTitle", text: "method.actionsText", detail: "method.actionsDetail" },
];

export function MethodologyContent() {
  const { fontScale, language, setFontScale, setLanguage, t } = useLanguage();
  const activeLanguage = languageOptions.find((option) => option.code === language) ?? languageOptions[0];
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label={t("method.backAria")}>
          <span className={styles.brandMark}><i /><b /></span>
          <strong>STOCK LENS</strong>
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
          <Link className={styles.backLink} href="/"><ArrowLeft size={15} /> {t("method.back")}</Link>
        </div>
      </header>

      <article className={styles.content}>
        <header className={styles.intro}>
          <h1>{t("method.title")}</h1>
          <p>{t("method.intro")}</p>
        </header>

        <section className={styles.ruleList} aria-label={t("method.rulesAria")}>
          {rules.map((rule, index) => {
            const Icon = rule.icon;
            return (
              <article className={styles.rule} key={rule.title}>
                <div className={styles.ruleNumber}>{String(index + 1).padStart(2, "0")}</div>
                <div className={styles.ruleIcon}><Icon size={19} /></div>
                <div>
                  <h2>{t(rule.title)}</h2>
                  <p>{t(rule.text)}</p>
                  <code>{t(rule.detail)}</code>
                </div>
              </article>
            );
          })}
        </section>

        <section className={styles.simulation}>
          <div>
            <h2>{t("method.futureTitle")}</h2>
            <p>{t("method.futureText")}</p>
          </div>
          <strong>{t("method.futureWarning")}</strong>
        </section>
      </article>
    </main>
  );
}
