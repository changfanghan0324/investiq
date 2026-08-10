"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { useLanguage } from "@/i18n/language";
import styles from "./modelguard-page.module.css";

export function ModelGuardHome() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.hero} aria-labelledby="modelguard-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>MODELGUARD</p>
            <h1 id="modelguard-title">{t("modelguard.homeTitle")}</h1>
            <p className={styles.lede}>{t("modelguard.homeSubtitle")}</p>
            <div className={styles.actions}>
              <Link className={styles.primaryButton} href="/workspace">{t("modelguard.uploadAction")}</Link>
              <Link className={styles.secondaryButton} href="/workspace?sample=clean">{t("modelguard.sampleAction")}</Link>
            </div>
            <p className={styles.privacyLine}>{t("modelguard.privacyLine")}</p>
          </div>
          <div className={styles.heroPanel} aria-label={t("modelguard.localOnly")}>
            <div className={styles.panelRule} />
            <span className={styles.panelLabel}>{t("modelguard.localOnly")}</span>
            <strong>{t("modelguard.localOnlyCount")}</strong>
            <p>{t("modelguard.localOnlySession")}</p>
          </div>
        </section>

        <section className={styles.featureGrid} aria-label={t("modelguard.capabilitiesLabel")}>
          <article>
            <span className={styles.featureIndex}>01</span>
            <h2>{t("modelguard.deterministicTitle")}</h2>
            <p>{t("modelguard.deterministicText")}</p>
          </article>
          <article>
            <span className={styles.featureIndex}>02</span>
            <h2>{t("modelguard.cellTitle")}</h2>
            <p>{t("modelguard.cellText")}</p>
          </article>
          <article>
            <span className={styles.featureIndex}>03</span>
            <h2>{t("modelguard.privateTitle")}</h2>
            <p>{t("modelguard.privateText")}</p>
          </article>
        </section>

        <footer className={styles.footer}><span>{t("modelguard.homeFooter")}</span><span>{t("modelguard.footerDetail")}</span></footer>
      </div>
    </AppShell>
  );
}
