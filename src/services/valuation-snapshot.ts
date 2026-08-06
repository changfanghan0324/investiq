// Purpose: Persists the user's last completed DCF run in this browser so the Investment Memo
// can reference the exact assumptions and outputs without rerunning or inventing a valuation.

import type { DcfAssumptions } from "@/domain/valuation";
import type { FinancialFactOrigin, SourceReceipt } from "@/domain/fundamentals";

export interface ValuationSnapshot {
  version: 1;
  ticker: string;
  generatedAt: string;
  fiscalYear: number;
  assumptions: DcfAssumptions;
  /** Optional for backward compatibility with snapshots saved before field-level provenance. */
  anchorProvenance?: Record<"baseRevenue" | "dilutedShares" | "netDebt", {
    value: number;
    origin: FinancialFactOrigin;
    fiscalYear: number;
    receipts: SourceReceipt[];
    userEdited: boolean;
    assumptionOwnership: "sec-evidence" | "user";
  }>;
  values: {
    bear: number;
    base: number;
    bull: number;
    low: number;
    high: number;
    enterpriseValue: number;
    equityValue: number;
    currentPrice?: number;
    quoteDate?: string;
    upsideDownside?: number;
  };
}

export function saveValuationSnapshot(snapshot: ValuationSnapshot): void {
  try {
    window.localStorage.setItem(storageKey(snapshot.ticker), JSON.stringify(snapshot));
  } catch {
    // Private browsing and storage policies may reject writes. The valuation remains usable;
    // the memo will state that no saved valuation is available instead of failing the page.
  }
}

export function loadValuationSnapshot(ticker: string): ValuationSnapshot | undefined {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(ticker)) ?? "null");
    if (!parsed || typeof parsed !== "object") return undefined;
    const candidate = parsed as Partial<ValuationSnapshot>;
    if (candidate.version !== 1 || candidate.ticker !== ticker || !candidate.values || !candidate.assumptions) return undefined;
    const required = [candidate.values.bear, candidate.values.base, candidate.values.bull, candidate.values.low, candidate.values.high, candidate.values.enterpriseValue, candidate.values.equityValue];
    return required.every((value) => typeof value === "number" && Number.isFinite(value)) ? candidate as ValuationSnapshot : undefined;
  } catch {
    return undefined;
  }
}

function storageKey(ticker: string): string {
  return `investiq:valuation:${ticker}`;
}
