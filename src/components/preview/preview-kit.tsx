"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";

import { ShellDisclaimer } from "@/components/app-shell";
import { type TranslationKey, useLanguage } from "@/i18n/language";

import styles from "./preview.module.css";

/**
 * Shared building blocks for the foundation preview routes. Every value shown here is a
 * placeholder: these pages are not connected to market data, so they never display a
 * number that could be mistaken for a live or calculated result.
 */

export function PreviewPage({
  titleKey,
  purposeKey,
  nextStageKeys,
  children,
}: {
  titleKey: TranslationKey;
  purposeKey: TranslationKey;
  nextStageKeys: readonly TranslationKey[];
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.titleRow}>
          <h1>{t(titleKey)}</h1>
          <span className={styles.previewBadge}>{t("preview.badge")}</span>
        </div>
        <p className={styles.scope}>{t("preview.scope")}</p>
      </div>

      <div className={styles.intent}>
        <section className={styles.intentBlock} aria-labelledby="preview-purpose">
          <h2 id="preview-purpose">{t("preview.purpose")}</h2>
          <p>{t(purposeKey)}</p>
        </section>
        <section className={styles.intentBlock} aria-labelledby="preview-next-stage">
          <h2 id="preview-next-stage">{t("preview.nextStage")}</h2>
          <ul className={styles.nextStage}>
            {nextStageKeys.map((key) => <li key={key}>{t(key)}</li>)}
          </ul>
        </section>
      </div>

      {children}

      <DcaPointer />
      <ShellDisclaimer />
    </div>
  );
}

/** Workspace grid that mirrors the concept layouts: optional left rail, main column, right rail. */
export function PreviewGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function PreviewPanel({
  titleKey,
  children,
  span = "main",
  pending = true,
}: {
  titleKey: TranslationKey;
  children: ReactNode;
  span?: "full" | "main" | "rail";
  pending?: boolean;
}) {
  const { t } = useLanguage();
  const spanClass = span === "full" ? styles.spanFull : span === "main" ? styles.spanMain : styles.spanRail;
  return (
    <section className={`${styles.panel} ${spanClass}`}>
      <header className={styles.panelHead}>
        <h2>{t(titleKey)}</h2>
        {pending ? <span className={styles.pending}>{t("preview.noData")}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Neutral chart frame with gridlines only — no plotted series, because there is no data. */
export function ChartFrame({ height = 240 }: { height?: number }) {
  const { t } = useLanguage();
  return (
    <div className={styles.chartFrame} style={{ minHeight: height }}>
      <div className={styles.chartGrid} aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <p className={styles.chartNote}><Info size={13} aria-hidden="true" /> {t("preview.chartPlaceholder")}</p>
    </div>
  );
}

/** Table skeleton: real column headers, em-dash cells, and an explicit empty-state note. */
export function PlaceholderTable({
  columnKeys,
  rows = 4,
}: {
  columnKeys: readonly TranslationKey[];
  rows?: number;
}) {
  const { t } = useLanguage();
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>{columnKeys.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {columnKeys.map((key) => <td key={key}>—</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.tableNote}>{t("preview.tablePlaceholder")}</p>
    </div>
  );
}

export function PlaceholderRows({ labelKeys }: { labelKeys: readonly TranslationKey[] }) {
  const { t } = useLanguage();
  return (
    <dl className={styles.rows}>
      {labelKeys.map((key) => (
        <div className={styles.row} key={key}>
          <dt>{t(key)}</dt>
          <dd>—</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ messageKey }: { messageKey: TranslationKey }) {
  const { t } = useLanguage();
  return <p className={styles.emptyState}>{t(messageKey)}</p>;
}

/** Disabled input frames stand in for controls that arrive with the data connection. */
export function PlaceholderField({
  labelKey,
  labelParams,
  placeholderKey,
  id,
}: {
  labelKey: TranslationKey;
  labelParams?: Record<string, string | number>;
  placeholderKey: TranslationKey;
  id: string;
}) {
  const { t } = useLanguage();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{t(labelKey, labelParams)}</label>
      <input id={id} type="text" disabled placeholder={t(placeholderKey)} />
    </div>
  );
}

/** Paired disabled inputs, used for symbol-plus-weight allocation rows. */
export function PlaceholderPairRows({
  rows,
  idPrefix,
  leftLabelKey,
  leftPlaceholderKey,
  rightLabelKey,
  rightPlaceholderKey,
}: {
  rows: number;
  idPrefix: string;
  leftLabelKey: TranslationKey;
  leftPlaceholderKey: TranslationKey;
  rightLabelKey: TranslationKey;
  rightPlaceholderKey: TranslationKey;
}) {
  return (
    <div className={styles.pairRows}>
      {Array.from({ length: rows }, (_, row) => (
        <div className={styles.pairRow} key={row}>
          <PlaceholderField
            id={`${idPrefix}-symbol-${row + 1}`}
            labelKey={leftLabelKey}
            labelParams={{ count: row + 1 }}
            placeholderKey={leftPlaceholderKey}
          />
          <PlaceholderField
            id={`${idPrefix}-weight-${row + 1}`}
            labelKey={rightLabelKey}
            labelParams={{ count: row + 1 }}
            placeholderKey={rightPlaceholderKey}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Square grid standing in for a correlation matrix. The cells are hidden from assistive
 * technology so an empty matrix is never read out as a set of values; the note carries the
 * meaning instead.
 */
export function MatrixFrame({ size }: { size: number }) {
  const { t } = useLanguage();
  return (
    <div>
      <div
        className={styles.matrix}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {Array.from({ length: size * size }, (_, cell) => <i key={cell}>—</i>)}
      </div>
      <p className={styles.tableNote}>{t("preview.matrixPlaceholder")}</p>
    </div>
  );
}

/** Vertical stack with consistent spacing for grouped fields, notes, and frames. */
export function PreviewStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

/** Short guidance line explaining a rule that will apply once the page reads market data. */
export function PreviewNote({ messageKey }: { messageKey: TranslationKey }) {
  const { t } = useLanguage();
  return (
    <p className={styles.note}>
      <Info size={13} aria-hidden="true" /> <span>{t(messageKey)}</span>
    </p>
  );
}

export function ExplainerList({ items }: { items: readonly TranslationKey[] }) {
  const { t } = useLanguage();
  return (
    <ul className={styles.explainer}>
      {items.map((key) => <li key={key}>{t(key)}</li>)}
    </ul>
  );
}

function DcaPointer() {
  const { t } = useLanguage();
  return (
    <aside className={styles.pointer}>
      <div>
        <span className={styles.workingBadge}>{t("preview.workingToday")}</span>
        <p>{t("preview.dcaHint")}</p>
      </div>
      <Link className={styles.pointerLink} href="/dca">
        {t("preview.openDca")} <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </aside>
  );
}
