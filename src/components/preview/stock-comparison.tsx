"use client";

import { AppShell } from "@/components/app-shell";
import {
  ChartFrame,
  ExplainerList,
  MatrixFrame,
  PlaceholderField,
  PlaceholderTable,
  PreviewGrid,
  PreviewNote,
  PreviewPage,
  PreviewPanel,
  PreviewStack,
} from "./preview-kit";

/** Five slots are rendered because five is the maximum; two is the minimum to run a comparison. */
const SLOT_COUNT = 5;

export function StockComparisonPreview() {
  return (
    <AppShell>
      <PreviewPage
        titleKey="compare.title"
        purposeKey="compare.purpose"
        nextStageKeys={["compare.next1", "compare.next2", "compare.next3"]}
      >
        <PreviewGrid>
          <PreviewPanel titleKey="compare.symbols" span="rail">
            <PreviewStack>
              {Array.from({ length: SLOT_COUNT }, (_, slot) => (
                <PlaceholderField
                  key={slot}
                  id={`compare-slot-${slot + 1}`}
                  labelKey="compare.slot"
                  labelParams={{ count: slot + 1 }}
                  placeholderKey="compare.slotPlaceholder"
                />
              ))}
              <PreviewNote messageKey="compare.slotRule" />
              <PreviewNote messageKey="compare.alignmentNote" />
            </PreviewStack>
          </PreviewPanel>

          <PreviewPanel titleKey="compare.chart" span="main">
            <PreviewStack>
              <ChartFrame height={260} />
              <PreviewNote messageKey="compare.chartNote" />
            </PreviewStack>
          </PreviewPanel>

          <PreviewPanel titleKey="compare.metrics" span="main">
            <PlaceholderTable
              columnKeys={[
                "result.ticker",
                "metric.annualizedReturn",
                "metric.volatility",
                "metric.sharpe",
                "result.maxDrawdown",
                "metric.beta",
              ]}
              rows={SLOT_COUNT}
            />
          </PreviewPanel>

          <PreviewPanel titleKey="compare.correlation" span="rail">
            <MatrixFrame size={SLOT_COUNT} />
          </PreviewPanel>

          <PreviewPanel titleKey="compare.explainTitle" span="full" pending={false}>
            <ExplainerList
              items={[
                "compare.explainReturn",
                "compare.explainVolatility",
                "compare.explainSharpe",
                "compare.explainDrawdown",
                "compare.explainCorrelation",
              ]}
            />
          </PreviewPanel>
        </PreviewGrid>
      </PreviewPage>
    </AppShell>
  );
}
