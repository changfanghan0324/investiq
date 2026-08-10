"use client";

import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/i18n/language";
import styles from "./modelguard-page.module.css";

type StaticPageKind = "templates" | "methodology" | "privacy" | "about";

export function ModelGuardStaticPage({ kind }: { kind: StaticPageKind }) {
  const { t } = useLanguage();
  const titleKey = `modelguard.${kind}Title` as const;
  const subtitleKey = `modelguard.${kind}Subtitle` as const;
  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.content} aria-labelledby="page-title">
          <p className={styles.eyebrow}>MODELGUARD / {kind.toUpperCase()}</p>
          <h1 id="page-title">{t(titleKey)}</h1>
          <p>{t(subtitleKey)}</p>
          {kind === "templates" ? <TemplateContent /> : null}
          {kind === "methodology" ? <MethodologyContent /> : null}
          {kind === "privacy" ? <PrivacyContent /> : null}
          {kind === "about" ? <AboutContent /> : null}
        </section>
      </div>
    </AppShell>
  );
}

function TemplateContent() {
  const { t } = useLanguage();
  return <div className={styles.contentGrid}>
    <article className={styles.contentCard}><h2>{t("modelguard.cleanTitle")}</h2><p>{t("modelguard.cleanText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.handoffTitle")}</h2><p>{t("modelguard.handoffText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.includedTitle")}</h2><p>{t("modelguard.includedText")}</p></article>
  </div>;
}

function MethodologyContent() {
  const { t } = useLanguage();
  return <div className={styles.contentGrid}>
    <article className={styles.contentCard}><h2>{t("modelguard.checksTitle")}</h2><p>{t("modelguard.checksText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.evidenceTitle")}</h2><p>{t("modelguard.evidenceText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.boundariesTitle")}</h2><p>{t("modelguard.boundariesText")}</p></article>
  </div>;
}

function PrivacyContent() {
  const { t } = useLanguage();
  return <div className={styles.contentGrid}>
    <article className={styles.contentCard}><h2>{t("modelguard.localProcessingTitle")}</h2><p>{t("modelguard.localProcessingText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.ephemeralTitle")}</h2><p>{t("modelguard.ephemeralText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.safeExportsTitle")}</h2><p>{t("modelguard.safeExportsText")}</p></article>
  </div>;
}

function AboutContent() {
  const { t } = useLanguage();
  return <div className={styles.contentGrid}>
    <article className={styles.contentCard}><h2>{t("modelguard.whyTitle")}</h2><p>{t("modelguard.whyText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.audienceTitle")}</h2><p>{t("modelguard.audienceText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.stanceTitle")}</h2><p>{t("modelguard.stanceText")}</p></article>
  </div>;
}
