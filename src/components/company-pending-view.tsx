"use client";

import { CircleDashed, Database, ShieldCheck } from "lucide-react";
import { useLanguage, type TranslationKey } from "@/i18n/language";
import styles from "./company-pending-view.module.css";

export function CompanyPendingView({ titleKey, textKey }: { titleKey: TranslationKey; textKey: TranslationKey }) {
  const { t } = useLanguage();
  return (
    <section className={styles.state}>
      <CircleDashed size={27} aria-hidden="true" />
      <h1>{t(titleKey)}</h1>
      <p>{t(textKey)}</p>
      <div>
        <span><Database size={14} />{t("company.pendingSource")}</span>
        <span><ShieldCheck size={14} />{t("company.pendingHonesty")}</span>
      </div>
    </section>
  );
}
