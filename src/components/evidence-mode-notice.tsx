"use client";

import { TriangleAlert } from "lucide-react";

import { useLanguage } from "@/i18n/language";
import type { DataProvenance } from "@/types/backtest";

import styles from "./evidence-mode-notice.module.css";

export function EvidenceModeNotice({
  id,
  homepage = false,
  provenance,
}: {
  id: string;
  homepage?: boolean;
  provenance?: DataProvenance;
}) {
  const { t } = useLanguage();
  const titleKey = homepage ? "research.publicDemoTitle" : "analysisDemo.title";
  return (
    <section className={homepage ? styles.homeNotice : styles.notice} aria-labelledby={id}>
      <TriangleAlert aria-hidden="true" />
      <div>
        <strong id={id}>{t(titleKey)}</strong>
        <p>{t(homepage ? "research.publicDemoBody" : "analysisDemo.body")}</p>
        <small>{t(homepage ? "research.publicDemoDetail" : "analysisDemo.detail")}</small>
        {provenance ? (
          <dl className={styles.provenance} data-testid="market-data-provenance">
            <div><dt>{t("analysisDemo.provenanceSourceType")}</dt><dd>{t(provenance.sourceType === "synthetic" ? "analysisDemo.provenanceSynthetic" : "analysisDemo.provenanceLicensed")}</dd></div>
            <div><dt>{t("analysisDemo.provenanceProvider")}</dt><dd>{provenance.provider}</dd></div>
            <div><dt>{t("analysisDemo.provenanceGeneratedAt")}</dt><dd>{provenance.generatedAt}</dd></div>
            <div><dt>{t("analysisDemo.provenanceDisclaimer")}</dt><dd>{provenance.disclaimer}</dd></div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
