"use client";

import Link from "next/link";
import { ArrowRight, Code2, ExternalLink, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { publicProfile } from "@/config/public-profile";
import { useLanguage } from "@/i18n/language";

import styles from "./portfolio-pages.module.css";

export function AboutPage() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <article className={styles.page}>
        <header className={styles.hero}>
          <h1>{t("about.title")}</h1>
          <p>{t("about.subtitle")}</p>
          <div className={styles.actions}>
            <Link href="/case-study/aapl">{t("about.caseStudyAction")}<ArrowRight size={15} aria-hidden="true" /></Link>
            <Link href="/methodology">{t("research.methodology")}<ArrowRight size={15} aria-hidden="true" /></Link>
            <a href={publicProfile.repository} target="_blank" rel="noreferrer">
              <Code2 size={15} aria-hidden="true" />GitHub<ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </header>

        <section className={styles.leadSection} aria-labelledby="about-owner">
          <h2 id="about-owner">{t("about.ownerTitle")}</h2>
          <p>{t("about.ownerText")}</p>
        </section>

        <section className={styles.split}>
          <div>
            <h2>{t("about.productTitle")}</h2>
            <p>{t("about.productText")}</p>
          </div>
          <div>
            <h2>{t("about.boundaryTitle")}</h2>
            <p>{t("about.boundaryText")}</p>
          </div>
        </section>

        <section className={styles.principles} aria-labelledby="about-principles">
          <h2 id="about-principles">{t("about.principlesTitle")}</h2>
          <div>
            <Principle title={t("about.lineageTitle")} text={t("about.lineageText")} />
            <Principle title={t("about.reproducibleTitle")} text={t("about.reproducibleText")} />
            <Principle title={t("about.failureTitle")} text={t("about.failureText")} />
            <Principle title={t("about.usabilityTitle")} text={t("about.usabilityText")} />
          </div>
        </section>

        <section className={styles.note}>
          <ShieldCheck size={24} aria-hidden="true" />
          <div><h2>{t("about.privacyTitle")}</h2><p>{t("about.privacyText")}</p></div>
        </section>
      </article>
    </AppShell>
  );
}

function Principle({ title, text }: { title: string; text: string }) {
  return <article><h3>{title}</h3><p>{text}</p></article>;
}
