import { workbookParser } from "@/services/modelguard-parser";
import { auditWorkbook, type AuditReport } from "@/domain/modelguard-audit";
import type { ParsedWorkbook, WorkbookProvenance } from "@/domain/modelguard-schema";

type ParseMessage = { type: "parse"; input: ArrayBuffer; fileName: string; provenance?: WorkbookProvenance };
type CancelMessage = { type: "cancel" };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ParseMessage | CancelMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};
let cancelled = false;

scope.onmessage = async (event: MessageEvent<ParseMessage | CancelMessage>) => {
  if (event.data.type === "cancel") {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    const parsed = await workbookParser.parse(event.data.input, { fileName: event.data.fileName, provenance: event.data.provenance });
    const report = auditWorkbook(parsed);
    if (!cancelled) scope.postMessage({ type: "complete", workbook: parsed, report } satisfies { type: "complete"; workbook: ParsedWorkbook; report: AuditReport });
  } catch (error) {
    if (!cancelled) scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Workbook could not be parsed" });
  }
};

export {};
