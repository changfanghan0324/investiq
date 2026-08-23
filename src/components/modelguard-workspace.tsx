"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { compareAuditFindings, compareWorkbooks, type AuditReport, type VersionChange, type VersionFindingChange } from "@/domain/modelguard-audit";
import { sampleDefinition } from "@/data/modelguard-samples";
import { ruleCatalogEntry } from "@/domain/modelguard-rule-catalog";
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

const MODEL_STATUS_KEYS = {
  "Review blocked": "modelguard.statusReviewBlocked",
  "Needs review": "modelguard.statusNeedsReview",
  "Audit complete with limitations": "modelguard.statusAuditCompleteWithLimitations",
  "Ready for review": "modelguard.statusReadyForReview",
} as const;

type ModelStatusKey = (typeof MODEL_STATUS_KEYS)[keyof typeof MODEL_STATUS_KEYS];

function decodeBase64(source: string): ArrayBuffer {
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function ModelGuardWorkspace() {
  const { t, language } = useLanguage();
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
  const [issueFilter, setIssueFilter] = useState<"all" | "critical" | "high" | "medium" | "low" | "info" | "cannot-verify" | "not-applicable" | "dcf" | "accounting" | "assumption" | "scenario">("all");
  const [issueSheet, setIssueSheet] = useState("all");
  const [issueRule, setIssueRule] = useState("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [versionFilter, setVersionFilter] = useState<"all" | "formula" | "value" | "format" | "sheet" | "severity" | "status">("all");
  const [exportFeedback, setExportFeedback] = useState<{ name: string; generatedAt: string; url: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [versionSampleLoading, setVersionSampleLoading] = useState(false);
  const [versionSampleError, setVersionSampleError] = useState<string | null>(null);
  const [sampleMode, setSampleMode] = useState(false);
  const [activeSampleId, setActiveSampleId] = useState<"clean" | "error">("clean");
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
    setIssueSheet("all");
    setIssueRule("all");
    setIssueSearch("");
    setVersionFilter("all");
    setExportFeedback((current) => { if (current) URL.revokeObjectURL(current.url); return null; });
    setExportError(null);
    setVersionSampleError(null);
    setSampleMode(false);
    setActiveSampleId("clean");
    setSamplePhase("idle");
    setSampleError(null);
    workerRef.current?.terminate();
    workerRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useEffect(() => () => {
    if (exportFeedback) URL.revokeObjectURL(exportFeedback.url);
  }, [exportFeedback]);

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
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      clearSession();
      setError(code === "BLANK_WORKBOOK" ? t("modelguard.blankWorkbook") : code.includes("too many") ? t("modelguard.fileLimitExceeded") : t("modelguard.fileRejected"));
    }
  }, [clearSession, runAudit, t]);

  const loadSample = useCallback(async (requestedSampleId?: "clean" | "error") => {
    const sampleId = requestedSampleId ?? activeSampleId;
    setSampleMode(true);
    setSamplePhase("preparing");
    setSampleError(null);
    setError(null);
    try {
      if (sampleId === "error") {
        const { MODEL_GUARD_ERROR_SAMPLE_BASE64 } = await import("@/data/modelguard-sample-error");
        await runAudit(decodeBase64(MODEL_GUARD_ERROR_SAMPLE_BASE64), "Error sample model.xlsx", { ...SAMPLE_PROVENANCE, disclaimer: "Synthetic fictional company workbook with intentional audit findings for demonstration. It is not live financial data or investment advice." }, true);
      } else {
        const { MODEL_GUARD_CLEAN_SAMPLE_BASE64 } = await import("@/data/modelguard-sample-clean");
        await runAudit(decodeBase64(MODEL_GUARD_CLEAN_SAMPLE_BASE64), "Sample model.xlsx", SAMPLE_PROVENANCE, true);
      }
    } catch {
      setSamplePhase("error");
      setSampleError(t("modelguard.sampleLoadError"));
    }
  }, [activeSampleId, runAudit, t]);

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
      if (sampleId === "clean" || sampleId === "error") {
        setActiveSampleId(sampleId);
        void loadSample(sampleId);
        return;
      }
      setSampleMode(true);
      setSamplePhase("error");
      setSampleError(t("modelguard.sampleUnknown"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSample, t]);

  const download = useCallback((name: string, body: string | Uint8Array, type: string): string | null => {
    const blobPart = typeof body === "string" ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([blobPart], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    return url;
  }, []);

  const auditVersionBytes = useCallback(async (bytes: ArrayBuffer, candidateName: string): Promise<{ workbook: ParsedWorkbook; report: AuditReport }> => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/model-audit.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === "complete") { worker.terminate(); resolve({ workbook: event.data.workbook, report: event.data.report }); }
      if (event.data.type === "error") { worker.terminate(); reject(new Error(event.data.message)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error("VERSION_AUDIT_FAILED")); };
    worker.postMessage({ type: "parse", input: bytes, fileName: candidateName }, [bytes]);
  }), []);

  const parseVersion = useCallback(async (candidate: File | undefined, side: "before" | "after") => {
    if (!candidate || !candidate.name.toLowerCase().endsWith(".xlsx") || candidate.size > MAX_BYTES) return;
    try {
      const result = await auditVersionBytes(await candidate.arrayBuffer(), candidate.name);
      if (side === "before") { setBeforeVersion(result.workbook); setBeforeVersionReport(result.report); }
      else { setAfterVersion(result.workbook); setAfterVersionReport(result.report); }
      setVersionSampleError(null);
    } catch { setVersionSampleError(t("modelguard.versionSampleError")); }
  }, [auditVersionBytes, t]);

  const loadVersionSample = useCallback(async () => {
    setVersionSampleLoading(true);
    setVersionSampleError(null);
    try {
      const [{ MODEL_GUARD_VERSION_BEFORE_BASE64 }, { MODEL_GUARD_VERSION_AFTER_BASE64 }] = await Promise.all([
        import("@/data/modelguard-sample-version-before"),
        import("@/data/modelguard-sample-version-after"),
      ]);
      const [before, after] = await Promise.all([
        auditVersionBytes(decodeBase64(MODEL_GUARD_VERSION_BEFORE_BASE64), "Version Before.xlsx"),
        auditVersionBytes(decodeBase64(MODEL_GUARD_VERSION_AFTER_BASE64), "Version After.xlsx"),
      ]);
      setBeforeVersion(before.workbook); setBeforeVersionReport(before.report);
      setAfterVersion(after.workbook); setAfterVersionReport(after.report);
      setVersionChanges(compareWorkbooks(before.workbook, after.workbook));
      setVersionFindings(compareAuditFindings(before.report, after.report));
    } catch { setVersionSampleError(t("modelguard.versionSampleError")); }
    finally { setVersionSampleLoading(false); }
  }, [auditVersionBytes, t]);

  const runVersionCompare = useCallback(() => {
    if (beforeVersion && afterVersion && beforeVersionReport && afterVersionReport) {
      setVersionChanges(compareWorkbooks(beforeVersion, afterVersion));
      setVersionFindings(compareAuditFindings(beforeVersionReport, afterVersionReport));
    }
  }, [afterVersion, afterVersionReport, beforeVersion, beforeVersionReport]);

  const exportReport = useCallback((name: string, body: string | Uint8Array, type: string) => {
    try {
      const url = download(name, body, type);
      if (!url) throw new Error("EXPORT_NOT_AVAILABLE");
      setExportFeedback((current) => { if (current) URL.revokeObjectURL(current.url); return { name, generatedAt: new Date().toISOString(), url }; });
      setExportError(null);
    } catch { setExportError(t("modelguard.exportError")); }
  }, [download, t]);

  const knownSample = sampleMode ? sampleDefinition(activeSampleId === "error" ? "modelguard-error-model.xlsx" : "modelguard-clean-model.xlsx") : sampleDefinition(fileName);
  const issueSheets = report ? [...new Set(report.issues.map((issue) => issue.sheet).filter((sheet): sheet is string => Boolean(sheet)))].sort() : [];
  const visibleIssues = report?.issues.filter((issue) => {
    const status = issue.status ?? "failed";
    const severityMatch = issueFilter === "all" || issueFilter === "dcf" ? (issueFilter !== "dcf" || issue.category === "dcf") : issueFilter === "accounting" || issueFilter === "assumption" || issueFilter === "scenario" ? issue.category === issueFilter : issueFilter === "cannot-verify" || issueFilter === "not-applicable" ? status === issueFilter : issueFilter === "low" ? issue.severity === "low" || issue.severity === "warning" : issue.severity === issueFilter;
    const sheetMatch = issueSheet === "all" || issue.sheet === issueSheet;
    const ruleMatch = issueRule === "all" || issue.ruleId === issueRule;
    const query = issueSearch.trim().toLowerCase();
    const textMatch = !query || [issue.ruleId, issue.title, issue.message, issue.sheet, issue.address, issue.observed, issue.expected].filter(Boolean).join(" ").toLowerCase().includes(query);
    return severityMatch && sheetMatch && ruleMatch && textMatch;
  }) ?? [];
  const rootCauseGroups = report ? [...new Map(report.issues.filter((issue) => issue.rootCauseId).map((issue) => [issue.rootCauseId!, { id: issue.rootCauseId!, title: issue.rootCauseTitle ?? issue.rootCauseId!, description: issue.rootCauseDescription ?? "", signals: report.issues.filter((candidate) => candidate.rootCauseId === issue.rootCauseId) }])).values()] : [];
  const exportBaseName = report ? report.fileName.replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_") : "modelguard-audit";
  const severityLabelKey = (severity: string) => severity === "warning" ? "modelguard.filterLow" : severity === "info" ? "modelguard.filterInfo" : `modelguard.${severity}`;

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

          <ol className={styles.workflowSteps} aria-label={t("modelguard.workflowLabel")}>
            {["workflowChoose", "workflowInspect", "workflowReview", "workflowExport"].map((key, index) => <li key={key}><span>0{index + 1}</span><strong>{t(`modelguard.${key}` as "modelguard.workflowChoose" | "modelguard.workflowInspect" | "modelguard.workflowReview" | "modelguard.workflowExport")}</strong></li>)}
          </ol>

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
            {knownSample ? <div className={styles.expectedBox}><strong>{t("modelguard.expectedFindings")}</strong><span>{knownSample.expectedRuleIds.length ? knownSample.expectedRuleIds.join(", ") : t("modelguard.expectedNone")}</span><small>{knownSample.purpose}</small></div> : null}
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
            <div className={styles.sampleActions}><button className={styles.smallButton} type="button" onClick={() => void loadVersionSample()} disabled={versionSampleLoading}>{versionSampleLoading ? t("modelguard.versionSampleLoading") : t("modelguard.versionSampleAction")}</button></div>
            {versionSampleError ? <p className={styles.error} role="alert">{versionSampleError}</p> : null}
            <button className={styles.smallButton} type="button" disabled={!beforeVersion || !afterVersion || !beforeVersionReport || !afterVersionReport} onClick={runVersionCompare}>{t("modelguard.versionCompare")}</button>
            {versionChanges.length || versionFindings.length ? <>
              <div className={styles.versionSummary} aria-live="polite"><span>{t("modelguard.versionNew")}: <strong>{versionFindings.filter((change) => change.status === "new").length}</strong></span><span>{t("modelguard.versionResolved")}: <strong>{versionFindings.filter((change) => change.status === "resolved").length}</strong></span><span>{t("modelguard.versionPersisting")}: <strong>{versionFindings.filter((change) => change.status === "persisting").length}</strong></span><span>{t("modelguard.versionChanged")}: <strong>{versionFindings.filter((change) => change.status === "changed").length}</strong></span><span>{t("modelguard.changes")}: <strong>{versionChanges.length}</strong></span></div>
              <div className={styles.filterBar} role="group" aria-label={t("modelguard.versionFilterLabel")}><button className={versionFilter === "all" ? styles.filterActive : styles.filterButton} type="button" onClick={() => setVersionFilter("all")}>{t("modelguard.filterAll")}</button>{["formula", "value", "format", "sheet", "severity", "status"].map((filter) => <button key={filter} className={versionFilter === filter ? styles.filterActive : styles.filterButton} type="button" onClick={() => setVersionFilter(filter as typeof versionFilter)}>{t(`modelguard.versionFilter${filter[0].toUpperCase()}${filter.slice(1)}` as "modelguard.versionFilterFormula" | "modelguard.versionFilterValue" | "modelguard.versionFilterFormat" | "modelguard.versionFilterSheet" | "modelguard.versionFilterSeverity" | "modelguard.versionFilterStatus")}</button>)}</div>
              <div className={styles.sampleActions}><button className={styles.smallButton} type="button" onClick={() => { const url = URL.createObjectURL(new Blob([versionChangesToCsv(versionChanges)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "modelguard-version-changes.csv"; link.click(); URL.revokeObjectURL(url); }}>{t("modelguard.exportCsv")}</button><button className={styles.smallButton} type="button" onClick={() => { const url = URL.createObjectURL(new Blob([versionFindingsToCsv(versionFindings)], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "modelguard-version-findings.csv"; link.click(); URL.revokeObjectURL(url); }}>{t("modelguard.exportCsv")}</button></div>
              <ul className={styles.versionFindings}>{versionFindings.filter((change) => versionFilter === "all" || versionFilter === "status" || (versionFilter === "severity" && ["critical", "high"].includes(change.severity))).map((change) => <li key={`${change.status}-${change.ruleId}-${change.sheet ?? "workbook"}-${change.address ?? ""}-${change.period ?? ""}`}><span className={`${styles.severity} ${styles[`severity${change.severity}`]}`}>{t(`modelguard.version${change.status[0].toUpperCase()}${change.status.slice(1)}` as "modelguard.versionNew" | "modelguard.versionResolved" | "modelguard.versionPersisting" | "modelguard.versionChanged")}</span> <code>{change.ruleId}</code> {change.sheet ? `${change.sheet}!${change.address ?? ""}` : t("modelguard.workbook")}{change.period ? ` · ${change.period}` : ""}</li>)}</ul>
              <ul className={styles.versionChanges}>{versionChanges.filter((change) => versionFilter === "all" || versionFilter === "formula" && change.changeType === "formula" || versionFilter === "value" && change.changeType === "value" || versionFilter === "format" && change.changeType === "format" || versionFilter === "sheet" && change.changeType?.startsWith("sheet-")).map((change, index) => <li key={`${change.kind}-${change.sheet}-${change.address}-${index}`}><span className={styles.changeType}>{change.changeType ?? change.kind}</span> <code>{change.sheet}{change.address ? `!${change.address}` : ""}</code><span>{change.before?.formula ?? String(change.before?.value ?? "—")} → {change.after?.formula ?? String(change.after?.value ?? "—")}</span></li>)}</ul>
            </> : null}
          </section>

          {report ? <section className={styles.reportSection} aria-labelledby="issue-explorer-title">
            <div className={styles.reportHeader}>
              <div><p className={styles.eyebrow}>{t("modelguard.reportLabel")}</p><h2 id="issue-explorer-title">{t("modelguard.issueExplorer")}</h2><p className={styles.modelStatus}>{t("modelguard.modelStatus")}: <strong>{t(MODEL_STATUS_KEYS[report.modelStatus] as ModelStatusKey)}</strong></p></div>
              <div className={styles.sampleActions}>
                <button className={styles.smallButton} type="button" onClick={() => exportReport(`${exportBaseName}_${new Date().toISOString().slice(0, 10)}.json`, auditReportToJson(report), "application/json")}>{t("modelguard.exportJson")}</button>
                <button className={styles.smallButton} type="button" onClick={() => exportReport(`${exportBaseName}_${new Date().toISOString().slice(0, 10)}.csv`, auditReportToCsv(report), "text/csv;charset=utf-8")}>{t("modelguard.exportCsv")}</button>
                <button className={styles.smallButton} type="button" onClick={() => exportReport(`${exportBaseName}_${new Date().toISOString().slice(0, 10)}.pdf`, auditReportToPdf(report, { versionComparison: { newFindings: versionFindings.filter((change) => change.status === "new").length, resolvedFindings: versionFindings.filter((change) => change.status === "resolved").length, persistingFindings: versionFindings.filter((change) => change.status === "persisting").length, changedFindings: versionFindings.filter((change) => change.status === "changed").length } }), "application/pdf")}>{t("modelguard.exportPdf")}</button>
              </div>
            </div>
            {exportFeedback ? <p className={styles.exportFeedback} role="status">{t("modelguard.exportSuccess")} · <strong>{exportFeedback.name}</strong> · {new Date(exportFeedback.generatedAt).toLocaleString()} · <a href={exportFeedback.url} download={exportFeedback.name}>{t("modelguard.downloadAgain")}</a></p> : null}
            {exportError ? <p className={styles.error} role="alert">{exportError}</p> : null}
            <div className={styles.reportMeta}><span>{t("modelguard.modelFile")}: {report.fileName}</span><span>SHA-256: {report.workbookSha256.slice(0, 16)}…</span><span>{t("modelguard.ruleVersion")}: 1.0</span><span>{t("modelguard.sheets")}: {workbook?.stats.worksheets ?? "—"}</span><span>{t("modelguard.formulas")}: {workbook?.stats.formulas ?? "—"}</span></div>
            {knownSample ? <div className={styles.expectedBox}><strong>{t("modelguard.expectedActual")}</strong>{knownSample.expectedRuleIds.length ? knownSample.expectedRuleIds.map((ruleId) => <span key={ruleId}><code>{ruleId}</code> · {report.issues.some((issue) => issue.ruleId === ruleId) ? t("modelguard.expectedFound") : t("modelguard.expectedMissing")}</span>) : <span>{t("modelguard.expectedNone")}</span>}</div> : null}
            <div className={styles.summaryGrid}>
              <div><span>{t("modelguard.critical")}</span><strong>{report.summary.critical}</strong></div>
              <div><span>{t("modelguard.high")}</span><strong>{report.summary.high}</strong></div>
              <div><span>{t("modelguard.medium")}</span><strong>{report.summary.medium}</strong></div>
              <div><span>{t("modelguard.filterLow")}</span><strong>{(report.summary.low ?? 0) + report.summary.warning}</strong></div>
              <div><span>{t("modelguard.info")}</span><strong>{report.summary.info}</strong></div>
              <div><span>{t("modelguard.passed")}</span><strong>{report.summary.passed}</strong></div>
              <div><span>{t("modelguard.cannotVerify")}</span><strong>{report.summary.cannotVerify}</strong></div>
              <div><span>{t("modelguard.notApplicable")}</span><strong>{report.summary.notApplicable}</strong></div>
            </div>
            <div className={styles.filterBar} role="group" aria-label={t("modelguard.issueExplorer")}>
              {(["all", "critical", "high", "medium", "low", "info", "cannot-verify", "not-applicable", "dcf", "accounting", "assumption", "scenario"] as const).map((filter) => <button key={filter} className={issueFilter === filter ? styles.filterActive : styles.filterButton} type="button" onClick={() => setIssueFilter(filter)}>{t(`modelguard.filter${filter === "all" ? "All" : filter === "cannot-verify" ? "CannotVerify" : filter === "not-applicable" ? "NotApplicable" : filter === "info" ? "Info" : filter[0].toUpperCase() + filter.slice(1)}` as "modelguard.filterAll" | "modelguard.filterCritical" | "modelguard.filterHigh" | "modelguard.filterMedium" | "modelguard.filterLow" | "modelguard.filterInfo" | "modelguard.filterCannotVerify" | "modelguard.filterNotApplicable" | "modelguard.filterDcf" | "modelguard.filterAccounting" | "modelguard.filterAssumption" | "modelguard.filterScenario")}</button>)}
            </div>
            <div className={styles.filterFields}><input aria-label={t("modelguard.searchIssues")} placeholder={t("modelguard.searchIssues")} value={issueSearch} onChange={(event) => setIssueSearch(event.target.value)} /><select aria-label={t("modelguard.filterSheet")} value={issueSheet} onChange={(event) => setIssueSheet(event.target.value)}><option value="all">{t("modelguard.filterSheet")}: {t("modelguard.filterAll")}</option>{issueSheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select><input aria-label={t("modelguard.filterRule")} placeholder={t("modelguard.filterRule")} value={issueRule === "all" ? "" : issueRule} onChange={(event) => setIssueRule(event.target.value || "all")} /></div>
            {rootCauseGroups.length ? <section className={styles.rootCauseSection} aria-labelledby="root-cause-title"><h3 id="root-cause-title">{t("modelguard.rootCauseGroups")}</h3>{rootCauseGroups.map((group) => <article className={styles.rootCauseCard} key={group.id}><strong>{language === "zh-CN" ? "未提供外部工作簿" : group.title}</strong><p>{language === "zh-CN" ? "多个信号可能来自同一外部工作簿依赖，该文件不在本次上传的证据范围内。" : group.description}</p><span>{t("modelguard.relatedSignals")}: {group.signals.map((signal) => signal.ruleId).join(", ")}</span></article>)}</section> : null}
            {visibleIssues.length ? <div className={styles.issueList}>{visibleIssues.map((issue) => <article className={styles.issue} key={issue.id}>
              <div className={styles.issueTop}><span className={`${styles.severity} ${styles[`severity${issue.severity}`]}`}>{t(severityLabelKey(issue.severity) as "modelguard.filterLow" | "modelguard.filterInfo" | "modelguard.critical" | "modelguard.high" | "modelguard.medium")}</span><code>{issue.ruleId}</code></div>
              <h3>{language === "zh-CN" ? ruleCatalogEntry(issue.ruleId)?.nameZh ?? issue.title : issue.title}</h3><p>{language === "zh-CN" ? `检测到规则 ${issue.ruleId} 的确定性信号。请根据观察值与预期条件复核该单元格。` : issue.message}</p>
              <dl><div><dt>{t("modelguard.location")}</dt><dd>{issue.sheet ? `${issue.sheet}!${issue.address ?? ""}` : t("modelguard.workbook")}</dd></div>{issue.period ? <div><dt>{t("modelguard.period")}</dt><dd>{issue.period}</dd></div> : null}{issue.observed ? <div><dt>{t("modelguard.observed")}</dt><dd>{issue.observed}</dd></div> : null}{issue.expected ? <div><dt>{t("modelguard.expected")}</dt><dd>{issue.expected}</dd></div> : null}{issue.difference ? <div><dt>{t("modelguard.difference")}</dt><dd>{issue.difference}</dd></div> : null}{issue.tolerance ? <div><dt>{t("modelguard.tolerance")}</dt><dd>{issue.tolerance}</dd></div> : null}</dl>
              {issue.whyItMatters ? <details open className={styles.issueDetails}><summary>{t("modelguard.whyItMatters")}</summary><p>{issue.whyItMatters}</p><p><strong>{t("modelguard.impact")}</strong>: {issue.impact}</p><p><strong>{t("modelguard.remediation")}</strong>: {issue.remediation}</p><p><strong>{t("modelguard.howToVerify")}</strong>: {issue.howToVerify}</p><p><strong>{t("modelguard.recheck")}</strong>: {issue.recheck}</p><p><strong>{t("modelguard.falsePositive")}</strong>: {issue.potentialFalsePositive}</p><p><strong>{t("modelguard.falseNegative")}</strong>: {issue.potentialFalseNegative}</p></details> : null}
            </article>)}</div> : <p className={styles.notice}>{t("modelguard.noIssues")}</p>}
            {!visibleIssues.length && report.issues.length === 0 ? <p className={styles.disclaimer}>{t("modelguard.cleanDisclaimer")}</p> : null}
            {report.limitations?.length ? <details open className={styles.limitations}><summary>{t("modelguard.limitations")}</summary><ul>{report.limitations.map((limitation) => <li key={limitation}>{language === "zh-CN" ? limitation.replace("ModelGuard reads formula text and cached workbook values but does not recalculate Excel formulas.", "ModelGuard 读取公式文本和工作簿缓存值，但不会重新计算 Excel 公式。") : limitation}</li>)}<li>{t("modelguard.unverifiableCount")}: {report.summary.cannotVerify}</li><li>{t("modelguard.auditTime")}: {new Date(report.generatedAt).toLocaleString()}</li><li>{t("modelguard.modelSha")}: {report.workbookSha256}</li><li>{t("modelguard.ruleVersion")}: 1.0</li></ul></details> : null}
          </section> : null}
        </section>
      </div>
    </AppShell>
  );
}
