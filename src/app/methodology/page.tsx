import type { Metadata } from "next";
import { MethodologyContent } from "./methodology-content";

export const metadata: Metadata = {
  title: "Methodology and calculation reference",
  description:
    "The shared end-of-day data contract and the calculation rules behind every InvestIQ workspace: Market Overview, Stock Analysis, Stock Comparison, Portfolio Lab, and DCA Backtest, with a formula reference and the limits of each figure.",
};

export default function MethodologyPage() {
  return <MethodologyContent />;
}
