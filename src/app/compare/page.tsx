import { StockComparison } from "@/components/stock-comparison";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "Stock Comparison",
  description:
    "Compare two to five US stocks or ETFs on the trading dates they all share: price return, volatility, Sharpe ratio, drawdown, beta, and correlation.",
  path: "/compare",
  indexable: false,
});

export default function StockComparisonRoute() {
  return <StockComparison />;
}
