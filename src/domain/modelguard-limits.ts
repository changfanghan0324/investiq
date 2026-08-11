export const WORKBOOK_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxWorksheets: 50,
  maxNonEmptyCells: 200_000,
  maxFormulas: 100_000,
  maxNamedRanges: 5_000,
  maxParseMilliseconds: 20_000,
} as const;

export type WorkbookLimitKey = keyof typeof WORKBOOK_LIMITS;

export function assertWorkbookSize(byteLength: number): void {
  if (byteLength > WORKBOOK_LIMITS.maxFileBytes) {
    throw new Error(`Workbook exceeds ${WORKBOOK_LIMITS.maxFileBytes} byte limit`);
  }
}
