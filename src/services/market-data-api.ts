// Purpose: Loads validated market data from the same-origin Next.js API without exposing vendor credentials.

import type { DateString, MarketData } from '@/types/backtest';

export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketDataError';
  }
}

export async function loadMarketData(options: {
  ticker: string;
  from: DateString;
  to: DateString;
  requiredStart: DateString;
}): Promise<MarketData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch('/api/market-data', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    });
    const payload: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = getApiMessage(payload);
      if (response.status === 400 || response.status === 404 || response.status === 422) {
        throw new MarketDataError(message ?? 'Please review the ticker and selected dates.');
      }
      if (response.status === 429) {
        throw new MarketDataError('The market-data service is busy. Please wait briefly and try again.');
      }
      throw new MarketDataError(message ?? 'Market data is temporarily unavailable. Please try again later.');
    }

    if (!isMarketData(payload)) {
      throw new MarketDataError('The market-data service returned an invalid response. Please try again later.');
    }
    return payload;
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MarketDataError('The market-data request timed out. Please try again.');
    }
    throw new MarketDataError('Unable to connect to the market-data service. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

function getApiMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

function isMarketData(value: unknown): value is MarketData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MarketData>;
  return (
    typeof candidate.ticker === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.currency === 'USD' &&
    Array.isArray(candidate.prices) &&
    candidate.prices.length > 0 &&
    Array.isArray(candidate.dividends) &&
    Array.isArray(candidate.splits) &&
    Array.isArray(candidate.tickerChanges)
  );
}
