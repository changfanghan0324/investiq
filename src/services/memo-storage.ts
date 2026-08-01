import type { InvestmentMemoNotes } from "@/services/create-equity-report";

export const EMPTY_MEMO_NOTES: InvestmentMemoNotes = {
  thesis: "",
  catalysts: "",
  risks: "",
  conclusion: "",
};

export function loadMemoNotes(ticker: string): InvestmentMemoNotes {
  if (typeof window === "undefined") return EMPTY_MEMO_NOTES;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(memoNotesKey(ticker)) ?? "null");
    if (!value || typeof value !== "object") return EMPTY_MEMO_NOTES;
    const notes = value as Partial<InvestmentMemoNotes>;
    return {
      thesis: text(notes.thesis),
      catalysts: text(notes.catalysts),
      risks: text(notes.risks),
      conclusion: text(notes.conclusion),
    };
  } catch {
    return EMPTY_MEMO_NOTES;
  }
}

export function saveMemoNotes(ticker: string, notes: InvestmentMemoNotes): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(memoNotesKey(ticker), JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").slice(0, 4_000) : "";
}

function memoNotesKey(ticker: string): string {
  return `investiq:memo:${ticker}`;
}
