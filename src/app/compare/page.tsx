import type { Metadata } from "next";
import { StockComparison } from "@/components/stock-comparison";

export const metadata: Metadata = {
  title: "Stock Comparison",
  description:
    "Compare two to five US stocks or ETFs on the trading dates they all share: price return, volatility, Sharpe ratio, drawdown, beta, and correlation.",
};

export default function StockComparisonRoute() {
  return <StockComparison />;
}
