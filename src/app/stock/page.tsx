import type { Metadata } from "next";
import { StockAnalysis } from "@/components/stock-analysis";

export const metadata: Metadata = {
  title: "Stock Analysis",
  description: "Per-symbol risk and return history for a single US stock or ETF.",
};

export default function StockAnalysisRoute() {
  return <StockAnalysis />;
}
