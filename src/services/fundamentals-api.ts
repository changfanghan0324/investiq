import type { FundamentalsResult } from "@/domain/fundamentals";

export class FundamentalsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundamentalsApiError";
  }
}

export async function loadCompanyFundamentals(ticker: string): Promise<FundamentalsResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`/api/fundamentals?ticker=${encodeURIComponent(ticker)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new FundamentalsApiError(readMessage(payload) ?? "Company fundamentals are temporarily unavailable.");
    }
    if (!isFundamentalsResult(payload)) {
      throw new FundamentalsApiError("The fundamentals service returned an invalid response.");
    }
    return payload;
  } catch (error) {
    if (error instanceof FundamentalsApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FundamentalsApiError("The SEC filing request timed out. Please try again.");
    }
    throw new FundamentalsApiError("Unable to connect to the fundamentals service.");
  } finally {
    window.clearTimeout(timeout);
  }
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

function isFundamentalsResult(value: unknown): value is FundamentalsResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FundamentalsResult>;
  return (
    candidate.period === "annual" &&
    candidate.basis === "as-most-recently-reported" &&
    candidate.displayOnly === true &&
    typeof candidate.disclaimer === "string" &&
    Array.isArray(candidate.fiscalYears) &&
    Array.isArray(candidate.metrics) &&
    Boolean(candidate.identity && typeof candidate.identity.ticker === "string")
  );
}
