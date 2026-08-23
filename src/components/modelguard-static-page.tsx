"use client";

import { AppShell } from "@/components/app-shell";
import { MODEL_GUARD_RULE_CATALOG } from "@/domain/modelguard-rule-catalog";
import { MODEL_GUARD_SAMPLE_DEFINITIONS } from "@/data/modelguard-samples";
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
  return <div className={styles.templateList}>{MODEL_GUARD_SAMPLE_DEFINITIONS.map((sample) => <article className={styles.contentCard} key={sample.id}>
    <div className={styles.templateHeader}><h2>{sample.title}</h2><a className={styles.smallButton} href={sample.downloadPath} download>{t("modelguard.downloadTemplate")}</a></div>
    <p>{sample.description}</p>
    <dl className={styles.templateMeta}><div><dt>{t("modelguard.expectedFindings")}</dt><dd>{sample.expectedRuleIds.length ? sample.expectedRuleIds.join(", ") : t("modelguard.expectedNone")}</dd></div><div><dt>{t("modelguard.templateFormula")}</dt><dd>{sample.containsFormulas ? t("modelguard.yes") : t("modelguard.no")}</dd></div><div><dt>{t("modelguard.templateIntentionalError")}</dt><dd>{sample.intentionallyBroken ? t("modelguard.yes") : t("modelguard.no")}</dd></div></dl>
    <p className={styles.templatePurpose}>{sample.purpose}</p>
  </article>)}</div>;
}

function MethodologyContent() {
  const { t, language } = useLanguage();
  const severityLabel = (severity: string) => severity === "warning" ? t("modelguard.filterLow") : severity === "info" ? t("modelguard.filterInfo") : t(`modelguard.${severity}` as "modelguard.critical" | "modelguard.high" | "modelguard.medium");
  return <div className={styles.contentGrid}>
    <article className={styles.contentCard}><h2>{t("modelguard.checksTitle")}</h2><p>{t("modelguard.checksText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.evidenceTitle")}</h2><p>{t("modelguard.evidenceText")}</p></article>
    <article className={styles.contentCard}><h2>{t("modelguard.boundariesTitle")}</h2><p>{t("modelguard.boundariesText")}</p></article>
    <section className={styles.ruleCatalog} aria-labelledby="rule-catalog-title"><div className={styles.ruleCatalogHeader}><h2 id="rule-catalog-title">{t("modelguard.ruleCatalogTitle")}</h2><p>{t("modelguard.ruleCatalogSubtitle")}</p></div><div className={styles.ruleTable}>{MODEL_GUARD_RULE_CATALOG.map((rule) => <details open key={rule.ruleId} className={styles.ruleRow}><summary><code>{rule.ruleId}</code><strong>{language === "zh-CN" ? rule.nameZh ?? rule.name : rule.name}</strong><span>{severityLabel(rule.severity)} · {rule.category}</span></summary><div className={styles.ruleDetailGrid}><p><b>{t("modelguard.checkObject")}</b>{rule.checkObject}</p><p><b>{t("modelguard.checkLogic")}</b>{rule.logic}</p><p><b>{t("modelguard.pseudoCode")}</b>{rule.pseudoCode}</p><p><b>{t("modelguard.observed")}</b>{rule.observed}</p><p><b>{t("modelguard.expected")}</b>{rule.expected}</p><p><b>{t("modelguard.tolerance")}</b>{rule.tolerance}</p><p><b>{t("modelguard.scope")}</b>{rule.scope}</p><p><b>{t("modelguard.notApplicable")}</b>{rule.notApplicable}</p><p><b>{t("modelguard.falsePositive")}</b>{rule.falsePositive}</p><p><b>{t("modelguard.falseNegative")}</b>{rule.falseNegative}</p><p><b>{t("modelguard.remediation")}</b>{rule.remediation}</p><p><b>{t("modelguard.exampleInput")}</b>{rule.exampleInput}</p><p><b>{t("modelguard.exampleOutput")}</b>{rule.exampleOutput}</p><p><b>{t("modelguard.ruleVersion")}</b>{rule.ruleVersion}</p></div></details>)}</div></section>
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
