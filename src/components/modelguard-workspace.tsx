"use client";

import { useCallback, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { compareWorkbooks, type AuditReport, type VersionChange } from "@/domain/modelguard-audit";
import type { ParsedWorkbook } from "@/domain/modelguard-schema";
import { auditReportToCsv, auditReportToJson, auditReportToPdf, versionChangesToCsv } from "@/services/modelguard-exports";
import { useLanguage } from "@/i18n/language";
import styles from "./modelguard-page.module.css";

const MAX_BYTES = 20 * 1024 * 1024;

export function ModelGuardWorkspace() {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "parsing" | "ready">("idle");
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [beforeVersion, setBeforeVersion] = useState<ParsedWorkbook | null>(null);
  const [afterVersion, setAfterVersion] = useState<ParsedWorkbook | null>(null);
  const [versionChanges, setVersionChanges] = useState<VersionChange[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const clearSession = useCallback(() => {
    setFileName(null);
    setFileSize(null);
    setDigest(null);
    setError(null);
    setPhase("idle");
    setWorkbook(null);
    setReport(null);
    setBeforeVersion(null);
    setAfterVersion(null);
    setVersionChanges([]);
    workerRef.current?.terminate();
    workerRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const acceptFile = useCallback(async (candidate: File | undefined) => {
    setError(null);
    setDigest(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
      setError(t("modelguard.unsupportedFormat"));
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError(t("modelguard.fileTooLarge"));
      return;
    }
    setFileName(candidate.name);
    setFileSize(candidate.size);
    try {
      const bytes = await candidate.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join("");
      setDigest(hex);
      setPhase("parsing");
      const worker = new Worker(new URL("../workers/model-audit.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ type: "complete"; workbook: ParsedWorkbook; report: AuditReport } | { type: "error"; message: string }>) => {
        if (event.data.type === "error") {
          setError(event.data.message);
          setPhase("idle");
        } else {
          setWorkbook(event.data.workbook);
          setReport(event.data.report);
          setPhase("ready");
        }
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage({ type: "parse", input: bytes, fileName: candidate.name }, [bytes]);
    } catch {
      setError(t("modelguard.fileRejected"));
      clearSession();
    }
  }, [clearSession, t]);

  const download = useCallback((name: string, body: string | Uint8Array, type: string) => {
    if (!report) return;
    const blobPart = typeof body === "string" ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([blobPart], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const parseVersion = useCallback(async (candidate: File | undefined, side: "before" | "after") => {
    if (!candidate || !candidate.name.toLowerCase().endsWith(".xlsx") || candidate.size > MAX_BYTES) return;
    const bytes = await candidate.arrayBuffer();
    await new Promise<void>((resolve) => {
      const worker = new Worker(new URL("../workers/model-audit.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ type: "complete"; workbook: ParsedWorkbook } | { type: "error" }>) => {
        if (event.data.type === "complete") {
          if (side === "before") setBeforeVersion(event.data.workbook); else setAfterVersion(event.data.workbook);
        }
        worker.terminate(); resolve();
      };
      worker.postMessage({ type: "parse", input: bytes, fileName: candidate.name }, [bytes]);
    });
  }, []);

  const runVersionCompare = useCallback(() => {
    if (beforeVersion && afterVersion) setVersionChanges(compareWorkbooks(beforeVersion, afterVersion));
  }, [afterVersion, beforeVersion]);

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.workspace} aria-labelledby="workspace-title">
          <div className={styles.workspaceHeader}>
            <div>
              <p className={styles.eyebrow}>{t("modelguard.auditLabel")}</p>
              <h1 id="workspace-title">{t("modelguard.workspaceTitle")}</h1>
              <p>{t("modelguard.workspaceSubtitle")}</p>
            </div>
            <p className={styles.privacyLine}>{t("modelguard.privacyLine")}</p>
          </div>

          <div className={styles.uploadCard}>
            <h2>{t("modelguard.uploadLabel")}</h2>
            <label htmlFor="workbook-file">{t("modelguard.acceptedFormat")}</label>
            <input ref={inputRef} id="workbook-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void acceptFile(event.target.files?.[0])} />
            <div className={styles.uploadMeta}>
              <span>{t("modelguard.maxSize")}</span>
              <span>{t("modelguard.localOnly")}</span>
            </div>
            {fileName ? <p className={styles.notice} role="status">{fileName} · {fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : ""}{digest ? ` · SHA-256 ${digest.slice(0, 16)}…` : ""}{phase === "parsing" ? ` · ${t("modelguard.parsing")}` : phase === "ready" && workbook ? ` · ${workbook.stats.worksheets} ${t("modelguard.sheets")}, ${workbook.stats.formulas} ${t("modelguard.formulas")} · ${t("modelguard.ready")}` : ""}</p> : <p className={styles.notice}>{t("modelguard.noFile")}</p>}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.sampleActions}>
              <a className={styles.smallButton} href="/samples/modelguard-clean-model.xlsx" download>{t("modelguard.tryClean")}</a>
              <a className={styles.smallButton} href="/samples/modelguard-error-model.xlsx" download>{t("modelguard.tryError")}</a>
              {fileName ? <button className={styles.smallButton} type="button" onClick={clearSession}>{t("modelguard.clearSession")}</button> : null}
            </div>
          </div>

          <section className={styles.versionCard} aria-labelledby="version-compare-title">
            <h2 id="version-compare-title">{t("modelguard.versionCompare")}</h2>
            <p>{t("modelguard.versionCompareText")}</p>
            <div className={styles.versionInputs}>
              <label htmlFor="before-version">{t("modelguard.versionBefore")}<input id="before-version" type="file" accept=".xlsx" onChange={(event) => void parseVersion(event.target.files?.[0], "before")} /></label>
              <label htmlFor="after-version">{t("modelguard.versionAfter")}<input id="after-version" type="file" accept=".xlsx" onChange={(event) => void parseVersion(event.target.files?.[0], "after")} /></label>
            </div>
            <button className={styles.smallButton} type="button" disabled={!beforeVersion || !afterVersion} onClick={runVersionCompare}>{t("modelguard.versionCompare")}</button>
            {versionChanges.length ? <><p className={styles.notice}>{t("modelguard.changes")}: {versionChanges.length}</p><button className={styles.smallButton} type="button" onClick={() => { const url = URL.createObjectURL(new Blob([versionChangesToCsv(versionChanges)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "modelguard-version-changes.csv"; link.click(); URL.revokeObjectURL(url); }}>{t("modelguard.exportCsv")}</button></> : null}
          </section>

          {report ? <section className={styles.reportSection} aria-labelledby="issue-explorer-title">
            <div className={styles.reportHeader}>
              <div><p className={styles.eyebrow}>{t("modelguard.reportLabel")}</p><h2 id="issue-explorer-title">{t("modelguard.issueExplorer")}</h2></div>
              <div className={styles.sampleActions}>
                <button className={styles.smallButton} type="button" onClick={() => download("modelguard-audit.json", auditReportToJson(report), "application/json")}>{t("modelguard.exportJson")}</button>
                <button className={styles.smallButton} type="button" onClick={() => download("modelguard-audit.csv", auditReportToCsv(report), "text/csv;charset=utf-8")}>{t("modelguard.exportCsv")}</button>
                <button className={styles.smallButton} type="button" onClick={() => download("modelguard-audit.pdf", auditReportToPdf(report), "application/pdf")}>{t("modelguard.exportPdf")}</button>
              </div>
            </div>
            <div className={styles.summaryGrid}>
              <div><span>{t("modelguard.critical")}</span><strong>{report.summary.critical}</strong></div>
              <div><span>{t("modelguard.warning")}</span><strong>{report.summary.warning}</strong></div>
              <div><span>{t("modelguard.info")}</span><strong>{report.summary.info}</strong></div>
            </div>
            {report.issues.length ? <div className={styles.issueList}>{report.issues.map((issue) => <article className={styles.issue} key={issue.id}>
              <div className={styles.issueTop}><span className={`${styles.severity} ${styles[`severity${issue.severity}`]}`}>{t(`modelguard.${issue.severity}` as "modelguard.critical" | "modelguard.warning" | "modelguard.info")}</span><code>{issue.ruleId}</code></div>
              <h3>{issue.title}</h3><p>{issue.message}</p>
              <dl><div><dt>{t("modelguard.location")}</dt><dd>{issue.sheet ? `${issue.sheet}!${issue.address ?? ""}` : t("modelguard.workbook")}</dd></div>{issue.observed ? <div><dt>{t("modelguard.observed")}</dt><dd>{issue.observed}</dd></div> : null}{issue.expected ? <div><dt>{t("modelguard.expected")}</dt><dd>{issue.expected}</dd></div> : null}</dl>
            </article>)}</div> : <p className={styles.notice}>{t("modelguard.noIssues")}</p>}
          </section> : null}
        </section>
      </div>
    </AppShell>
  );
}
