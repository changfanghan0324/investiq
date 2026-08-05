"use client";

import { TriangleAlert } from "lucide-react";

import { useLanguage } from "@/i18n/language";

import styles from "./evidence-mode-notice.module.css";

export function EvidenceModeNotice({ id, homepage = false }: { id: string; homepage?: boolean }) {
  const { t } = useLanguage();
  const titleKey = homepage ? "research.publicDemoTitle" : "analysisDemo.title";
  return (
    <section className={homepage ? styles.homeNotice : styles.notice} aria-labelledby={id}>
      <TriangleAlert aria-hidden="true" />
      <div>
        <strong id={id}>{t(titleKey)}</strong>
        <p>{t(homepage ? "research.publicDemoBody" : "analysisDemo.body")}</p>
        <small>{t(homepage ? "research.publicDemoDetail" : "analysisDemo.detail")}</small>
      </div>
    </section>
  );
}
