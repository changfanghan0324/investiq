"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { compareAuditFindings, compareWorkbooks, type AuditReport, type VersionChange, type VersionFindingChange } from "@/domain/modelguard-audit";
import type { ParsedWorkbook, WorkbookProvenance } from "@/domain/modelguard-schema";
import { auditReportToCsv, auditReportToJson, auditReportToPdf, versionChangesToCsv, versionFindingsToCsv } from "@/services/modelguard-exports";
import { useLanguage } from "@/i18n/language";
import styles from "./modelguard-page.module.css";

const MAX_BYTES = 20 * 1024 * 1024;
type SamplePhase = "idle" | "preparing" | "reading" | "validating" | "auditing" | "complete" | "error";
type WorkerMessage =
  | { type: "phase"; phase: "reading" | "validating" | "auditing" }
  | { type: "complete"; workbook: ParsedWorkbook; report: AuditReport }
  | { type: "error"; message: string };

const SAMPLE_PROVENANCE: WorkbookProvenance = {
  sourceType: "sample-local",
  provider: "ModelGuard sample library",
  generatedAt: "2026-08-10T00:00:00.000Z",
  disclaimer: "Synthetic fictional company workbook bundled with ModelGuard for demonstration. It is not live financial data or investment advice.",
};

function decodeBase64(source: string): ArrayBuffer {
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

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
  const [beforeVersionReport, setBeforeVersionReport] = useState<AuditReport | null>(null);
  const [afterVersionReport, setAfterVersionReport] = useState<AuditReport | null>(null);
  const [versionChanges, setVersionChanges] = useState<VersionChange[]>([]);
  const [versionFindings, setVersionFindings] = useState<VersionFindingChange[]>([]);
  const [issueFilter, setIssueFilter] = useState<"all" | "critical" | "dcf">("all");
  const [sampleMode, setSampleMode] = useState(false);
  const [samplePhase, setSamplePhase] = useState<SamplePhase>("idle");
  const [sampleError, setSampleError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const sampleStartedRef = useRef(false);

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
    setBeforeVersionReport(null);
    setAfterVersionReport(null);
    setVersionChanges([]);
    setVersionFindings([]);
    setIssueFilter("all");
    setSampleMode(false);
    setSamplePhase("idle");
    setSampleError(null);
    workerRef.current?.terminate();
    workerRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const runAudit = useCallback(async (bytes: ArrayBuffer, candidateName: string, provenance?: WorkbookProvenance, isSample = false): Promise<void> => {
    setError(null);
    setSampleError(null);
    setDigest(null);
    setFileName(candidateName);
    setFileSize(bytes.byteLength);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join("");
    setDigest(hex);
    setPhase("parsing");
    if (isSample) setSamplePhase("reading");
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("../workers/model-audit.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "phase") {
          if (isSample) setSamplePhase(event.data.phase);
          return;
        }
        if (event.data.type === "error") {
          setError(event.data.message);
          if (isSample) {
            setSamplePhase("error");
            setSampleError(t("modelguard.sampleLoadError"));
          }
          setPhase("idle");
          worker.terminate();
          workerRef.current = null;
          reject(new Error(event.data.message));
          return;
        }
        setWorkbook(event.data.workbook);
        setReport(event.data.report);
        setPhase("ready");
        if (isSample) setSamplePhase("complete");
        worker.terminate();
        workerRef.current = null;
        resolve();
      };
      worker.postMessage({ type: "parse", input: bytes, fileName: candidateName, provenance }, [bytes]);
    });
  }, [t]);

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
    try {
      await runAudit(await candidate.arrayBuffer(), candidate.name);
    } catch {
      setError(t("modelguard.fileRejected"));
      clearSession();
    }
  }, [clearSession, runAudit, t]);

  const loadSample = useCallback(async () => {
    setSampleMode(true);
    setSamplePhase("preparing");
    setSampleError(null);
    setError(null);
    try {
      const { MODEL_GUARD_CLEAN_SAMPLE_BASE64 } = await import("@/data/modelguard-sample-clean");
      await runAudit(decodeBase64(MODEL_GUARD_CLEAN_SAMPLE_BASE64), "Sample model.xlsx", SAMPLE_PROVENANCE, true);
    } catch {
      setSamplePhase("error");
      setSampleError(t("modelguard.sampleLoadError"));
    }
  }, [runAudit, t]);

  const exitSampleMode = useCallback(() => {
    clearSession();
    window.history.replaceState(null, "", "/workspace");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [clearSession]);

  useEffect(() => {
    const sampleId = new URLSearchParams(window.location.search).get("sample");
    if (!sampleId || sampleStartedRef.current) return;
    const timer = window.setTimeout(() => {
      if (sampleStartedRef.current) return;
      sampleStartedRef.current = true;
      if (sampleId === "clean") {
        void loadSample();
        return;
      }
      setSampleMode(true);
      setSamplePhase("error");
      setSampleError(t("modelguard.sampleUnknown"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSample, t]);

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
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "phase") return;
        if (event.data.type === "complete") {
          if (side === "before") { setBeforeVersion(event.data.workbook); setBeforeVersionReport(event.data.report); }
          else { setAfterVersion(event.data.workbook); setAfterVersionReport(event.data.report); }
        }
        worker.terminate(); resolve();
      };
      worker.postMessage({ type: "parse", input: bytes, fileName: candidate.name }, [bytes]);
    });
  }, []);

  const runVersionCompare = useCallback(() => {
    if (beforeVersion && afterVersion && beforeVersionReport && afterVersionReport) {
      setVersionChanges(compareWorkbooks(beforeVersion, afterVersion));
      setVersionFindings(compareAuditFindings(beforeVersionReport, afterVersionReport));
    }
  }, [afterVersion, afterVersionReport, beforeVersion, beforeVersionReport]);

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
            {sampleMode ? <div className={styles.sampleStatus} aria-live="polite">
              <p className={styles.sampleIdentity}><strong>{t("modelguard.sampleModel")}</strong> · {t("modelguard.sampleCompany")}</p>
              {samplePhase === "preparing" ? <p className={styles.notice}>{t("modelguard.samplePreparing")}</p> : null}
              {samplePhase === "reading" ? <p className={styles.notice}>{t("modelguard.sampleReading")}</p> : null}
              {samplePhase === "validating" ? <p className={styles.notice}>{t("modelguard.sampleValidating")}</p> : null}
              {samplePhase === "auditing" ? <p className={styles.notice}>{t("modelguard.sampleAuditing")}</p> : null}
              {samplePhase === "complete" ? <p className={styles.notice}>{t("modelguard.sampleReady")}</p> : null}
              {samplePhase === "error" ? <p className={styles.error} role="alert">{sampleError ?? t("modelguard.sampleLoadError")}</p> : null}
              <div className={styles.sampleActions}>
                {samplePhase === "error" ? <button className={styles.smallButton} type="button" onClick={() => { sampleStartedRef.current = false; void loadSample(); }}>{t("modelguard.retrySample")}</button> : null}
                <button className={styles.smallButton} type="button" onClick={exitSampleMode}>{t("modelguard.uploadOwnModel")}</button>
              </div>
            </div> : <>
              <label htmlFor="workbook-file">{t("modelguard.acceptedFormat")}</label>
              <input ref={inputRef} id="workbook-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void acceptFile(event.target.files?.[0])} />
            </>}
            <div className={styles.uploadMeta}>
              <span>{t("modelguard.maxSize")}</span>
              <span>{t("modelguard.localOnly")}</span>
            </div>
            <p className={styles.calculationNotice}><strong>{t("modelguard.formulaValuesTitle")}</strong> {t("modelguard.formulaValuesText")}</p>
            {fileName ? <p className={styles.notice} role="status">{fileName} · {fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : ""}{digest ? ` · SHA-256 ${digest.slice(0, 16)}…` : ""}{phase === "parsing" ? ` · ${t("modelguard.parsing")}` : phase === "ready" && workbook ? ` · ${workbook.stats.worksheets} ${t("modelguard.sheets")}, ${workbook.stats.formulas} ${t("modelguard.formulas")} · ${t("modelguard.ready")}` : ""}</p> : sampleMode ? null : <p className={styles.notice}>{t("modelguard.noFile")}</p>}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {!sampleMode ? <div className={styles.sampleActions}>
              <a className={styles.smallButton} href="/samples/modelguard-clean-model.xlsx" download>{t("modelguard.tryClean")}</a>
              <a className={styles.smallButton} href="/samples/modelguard-error-model.xlsx" download>{t("modelguard.tryError")}</a>
              {fileName ? <button className={styles.smallButton} type="button" onClick={clearSession}>{t("modelguard.clearSession")}</button> : null}
            </div> : null}
          </div>

          <section className={styles.versionCard} aria-labelledby="version-compare-title">
            <h2 id="version-compare-title">{t("modelguard.versionCompare")}</h2>
            <p>{t("modelguard.versionCompareText")}</p>
            <div className={styles.versionInputs}>
              <label htmlFor="before-version">{t("modelguard.versionBefore")}<input id="before-version" type="file" accept=".xlsx" onChange={(event) => void parseVersion(event.target.files?.[0], "before")} /></label>
              <label htmlFor="after-version">{t("modelguard.versionAfter")}<input id="after-version" type="file" accept=".xlsx" onChange={(event) => void parseVersion(event.target.files?.[0], "after")} /></label>
            </div>
            <button className={styles.smallButton} type="button" disabled={!beforeVersion || !afterVersion || !beforeVersionReport || !afterVersionReport} onClick={runVersionCompare}>{t("modelguard.versionCompare")}</button>
            {versionChanges.length || versionFindings.length ? <>
              <div className={styles.versionSummary} aria-live="polite"><span>{t("modelguard.versionNew")}: <strong>{versionFindings.filter((change) => change.status === "new").length}</strong></span><span>{t("modelguard.versionResolved")}: <strong>{versionFindings.filter((change) => change.status === "resolved").length}</strong></span><span>{t("modelguard.versionPersisting")}: <strong>{versionFindings.filter((change) => change.status === "persisting").length}</strong></span><span>{t("modelguard.changes")}: <strong>{versionChanges.length}</strong></span></div>
              <div className={styles.sampleActions}><button className={styles.smallButton} type="button" onClick={() => { const url = URL.createObjectURL(new Blob([versionChangesToCsv(versionChanges)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "modelguard-version-changes.csv"; link.click(); URL.revokeObjectURL(url); }}>{t("modelguard.exportCsv")}</button><button className={styles.smallButton} type="button" onClick={() => { const url = URL.createObjectURL(new Blob([versionFindingsToCsv(versionFindings)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "modelguard-version-findings.csv"; link.click(); URL.revokeObjectURL(url); }}>{t("modelguard.exportCsv")}</button></div>
              <ul className={styles.versionFindings}>{versionFindings.map((change) => <li key={`${change.status}-${change.ruleId}-${change.sheet ?? "workbook"}-${change.address ?? ""}-${change.period ?? ""}`}><span className={`${styles.severity} ${styles[`severity${change.severity}`]}`}>{t(`modelguard.version${change.status[0].toUpperCase()}${change.status.slice(1)}` as "modelguard.versionNew" | "modelguard.versionResolved" | "modelguard.versionPersisting")}</span> <code>{change.ruleId}</code> {change.sheet ? `${change.sheet}!${change.address ?? ""}` : t("modelguard.workbook")}{change.period ? ` · ${change.period}` : ""}</li>)}</ul>
            </> : null}
          </section>

          {report ? <section className={styles.reportSection} aria-labelledby="issue-explorer-title">
            <div className={styles.reportHeader}>
              <div><p className={styles.eyebrow}>{t("modelguard.reportLabel")}</p><h2 id="issue-explorer-title">{t("modelguard.issueExplorer")}</h2><p className={styles.modelStatus}>{t("modelguard.modelStatus")}: <strong>{report.modelStatus}</strong></p></div>
              <div className={styles.sampleActions}>
                <button className={styles.smallButton} type="button" onClick={() => download("modelguard-audit.json", auditReportToJson(report), "application/json")}>{t("modelguard.exportJson")}</button>
                <button className={styles.smallButton} type="button" onClick={() => download("modelguard-audit.csv", auditReportToCsv(report), "text/csv;charset=utf-8")}>{t("modelguard.exportCsv")}</button>
                <button className={styles.smallButton} type="button" onClick={() => download("modelguard-audit.pdf", auditReportToPdf(report), "application/pdf")}>{t("modelguard.exportPdf")}</button>
              </div>
            </div>
            <div className={styles.summaryGrid}>
              <div><span>{t("modelguard.critical")}</span><strong>{report.summary.critical}</strong></div>
              <div><span>{t("modelguard.high")}</span><strong>{report.summary.high}</strong></div>
              <div><span>{t("modelguard.medium")}</span><strong>{report.summary.medium}</strong></div>
              <div><span>{t("modelguard.passed")}</span><strong>{report.summary.passed}</strong></div>
              <div><span>{t("modelguard.cannotVerify")}</span><strong>{report.summary.cannotVerify}</strong></div>
              <div><span>{t("modelguard.notApplicable")}</span><strong>{report.summary.notApplicable}</strong></div>
            </div>
            <div className={styles.filterBar} role="group" aria-label={t("modelguard.issueExplorer")}>
              <button className={issueFilter === "all" ? styles.filterActive : styles.filterButton} type="button" onClick={() => setIssueFilter("all")}>{t("modelguard.filterAll")}</button>
              <button className={issueFilter === "critical" ? styles.filterActive : styles.filterButton} type="button" onClick={() => setIssueFilter("critical")}>{t("modelguard.filterCritical")}</button>
              <button className={issueFilter === "dcf" ? styles.filterActive : styles.filterButton} type="button" onClick={() => setIssueFilter("dcf")}>{t("modelguard.filterDcf")}</button>
            </div>
            {report.issues.filter((issue) => issueFilter === "all" || (issueFilter === "critical" ? issue.severity === "critical" : issue.category === "dcf")).length ? <div className={styles.issueList}>{report.issues.filter((issue) => issueFilter === "all" || (issueFilter === "critical" ? issue.severity === "critical" : issue.category === "dcf")).map((issue) => <article className={styles.issue} key={issue.id}>
              <div className={styles.issueTop}><span className={`${styles.severity} ${styles[`severity${issue.severity}`]}`}>{t(`modelguard.${issue.severity}` as "modelguard.critical" | "modelguard.high" | "modelguard.medium" | "modelguard.warning" | "modelguard.info")}</span><code>{issue.ruleId}</code></div>
              <h3>{issue.title}</h3><p>{issue.message}</p>
              <dl><div><dt>{t("modelguard.location")}</dt><dd>{issue.sheet ? `${issue.sheet}!${issue.address ?? ""}` : t("modelguard.workbook")}</dd></div>{issue.period ? <div><dt>{t("modelguard.period")}</dt><dd>{issue.period}</dd></div> : null}{issue.observed ? <div><dt>{t("modelguard.observed")}</dt><dd>{issue.observed}</dd></div> : null}{issue.expected ? <div><dt>{t("modelguard.expected")}</dt><dd>{issue.expected}</dd></div> : null}{issue.difference ? <div><dt>{t("modelguard.difference")}</dt><dd>{issue.difference}</dd></div> : null}{issue.tolerance ? <div><dt>{t("modelguard.tolerance")}</dt><dd>{issue.tolerance}</dd></div> : null}</dl>
              {issue.whyItMatters ? <details className={styles.issueDetails}><summary>{t("modelguard.whyItMatters")}</summary><p>{issue.whyItMatters}</p><p>{t("modelguard.howToVerify")}: {issue.howToVerify}</p></details> : null}
            </article>)}</div> : <p className={styles.notice}>{t("modelguard.noIssues")}</p>}
          </section> : null}
        </section>
      </div>
    </AppShell>
  );
}
