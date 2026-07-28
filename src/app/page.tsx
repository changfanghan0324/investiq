import type { Metadata } from "next";
import { MarketOverview } from "@/components/market-overview";

export const metadata: Metadata = {
  title: "Market Overview",
  description: "End-of-day US index benchmarks, watchlist, and market risk in one view.",
};

export default function MarketOverviewRoute() {
  return <MarketOverview />;
}
