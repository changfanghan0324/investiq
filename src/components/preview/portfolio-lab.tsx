"use client";

import { AppShell } from "@/components/app-shell";
import {
  ChartFrame,
  ExplainerList,
  MatrixFrame,
  PlaceholderPairRows,
  PlaceholderRows,
  PlaceholderTable,
  PreviewGrid,
  PreviewNote,
  PreviewPage,
  PreviewPanel,
  PreviewStack,
} from "./preview-kit";

/** Portfolio Lab caps a weighted buy-and-hold portfolio at ten holdings. */
const HOLDING_COUNT = 10;

export function PortfolioLabPreview() {
  return (
    <AppShell>
      <PreviewPage
        titleKey="portfolioLab.title"
        purposeKey="portfolioLab.purpose"
        nextStageKeys={["portfolioLab.next1", "portfolioLab.next2", "portfolioLab.next3"]}
      >
        <PreviewGrid>
          <PreviewPanel titleKey="portfolioLab.allocation" span="rail">
            <PreviewStack>
              <PlaceholderPairRows
                rows={HOLDING_COUNT}
                idPrefix="portfolio-holding"
                leftLabelKey="portfolioLab.holdingSlot"
                leftPlaceholderKey="portfolioLab.symbolPlaceholder"
                rightLabelKey="portfolioLab.weightSlot"
                rightPlaceholderKey="portfolioLab.weightPlaceholder"
              />
              <PreviewNote messageKey="portfolioLab.weightRule" />
              <PreviewNote messageKey="portfolioLab.weightValidation" />
            </PreviewStack>
          </PreviewPanel>

          <PreviewPanel titleKey="portfolioLab.performance" span="main">
            <PreviewStack>
              <ChartFrame height={260} />
              <PreviewNote messageKey="portfolioLab.performanceNote" />
            </PreviewStack>
          </PreviewPanel>

          <PreviewPanel titleKey="portfolioLab.contribution" span="main">
            <PreviewStack>
              <PlaceholderTable
                columnKeys={[
                  "metric.holding",
                  "metric.weight",
                  "metric.contributionToReturn",
                  "metric.contributionToRisk",
                ]}
                rows={4}
              />
              <PreviewNote messageKey="portfolioLab.explainAttribution" />
            </PreviewStack>
          </PreviewPanel>

          <PreviewPanel titleKey="portfolioLab.correlation" span="rail">
            <MatrixFrame size={4} />
          </PreviewPanel>

          <PreviewPanel titleKey="portfolioLab.risk" span="rail">
            <PlaceholderRows
              labelKeys={["metric.concentration", "metric.largestPosition", "metric.sectorConcentration"]}
            />
          </PreviewPanel>

          <PreviewPanel titleKey="portfolioLab.concentrationTitle" span="main" pending={false}>
            <ExplainerList
              items={[
                "portfolioLab.explainConcentration",
                "portfolioLab.explainHhi",
                "portfolioLab.explainSector",
              ]}
            />
          </PreviewPanel>
        </PreviewGrid>
      </PreviewPage>
    </AppShell>
  );
}
