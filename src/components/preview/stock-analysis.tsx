"use client";

import { AppShell } from "@/components/app-shell";
import {
  ChartFrame,
  PlaceholderField,
  PlaceholderRows,
  PreviewGrid,
  PreviewPage,
  PreviewPanel,
} from "./preview-kit";

export function StockAnalysisPreview() {
  return (
    <AppShell>
      <PreviewPage
        titleKey="stock.title"
        purposeKey="stock.purpose"
        nextStageKeys={["stock.next1", "stock.next2", "stock.next3"]}
      >
        <PreviewGrid>
          <PreviewPanel titleKey="stock.search" span="rail">
            <PlaceholderField id="stock-symbol" labelKey="stock.search" placeholderKey="stock.searchPlaceholder" />
          </PreviewPanel>

          <PreviewPanel titleKey="stock.performance" span="main">
            <ChartFrame height={260} />
          </PreviewPanel>

          <PreviewPanel titleKey="stock.summary" span="rail">
            <PlaceholderRows
              labelKeys={["metric.sector", "metric.industry", "metric.exchange", "metric.currency", "metric.availableHistory"]}
            />
          </PreviewPanel>

          <PreviewPanel titleKey="stock.metrics" span="main">
            <PlaceholderRows
              labelKeys={["metric.annualizedReturn", "metric.volatility", "metric.sharpe", "result.maxDrawdown", "metric.beta"]}
            />
          </PreviewPanel>

          <PreviewPanel titleKey="stock.actions" span="full">
            <PlaceholderRows labelKeys={["metric.dividends", "metric.splits"]} />
          </PreviewPanel>
        </PreviewGrid>
      </PreviewPage>
    </AppShell>
  );
}
