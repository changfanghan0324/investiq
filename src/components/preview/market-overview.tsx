"use client";

import { AppShell } from "@/components/app-shell";
import {
  ChartFrame,
  EmptyState,
  PlaceholderRows,
  PlaceholderTable,
  PreviewGrid,
  PreviewPage,
  PreviewPanel,
} from "./preview-kit";

export function MarketOverviewPreview() {
  return (
    <AppShell>
      <PreviewPage
        titleKey="market.title"
        purposeKey="market.purpose"
        nextStageKeys={["market.next1", "market.next2", "market.next3"]}
      >
        <PreviewGrid>
          <PreviewPanel titleKey="market.indices" span="full">
            <PlaceholderTable
              columnKeys={["result.ticker", "result.price", "metric.oneYearReturn", "metric.volatility", "result.maxDrawdown"]}
              rows={3}
            />
          </PreviewPanel>

          <PreviewPanel titleKey="market.watchlist" span="rail">
            <EmptyState messageKey="market.watchlistEmpty" />
          </PreviewPanel>

          <PreviewPanel titleKey="market.performance" span="main">
            <ChartFrame height={260} />
          </PreviewPanel>

          <PreviewPanel titleKey="market.risk" span="full">
            <PlaceholderRows labelKeys={["metric.volatilityRegime", "metric.vix", "metric.indexDrawdown"]} />
          </PreviewPanel>
        </PreviewGrid>
      </PreviewPage>
    </AppShell>
  );
}
