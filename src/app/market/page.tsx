import type { Metadata } from "next";
import { MarketOverview } from "@/components/market-overview";

export const metadata: Metadata = {
  title: "Market Context",
  description: "End-of-day US benchmark and watchlist context for an investment research workflow.",
};

export default function MarketContextRoute() {
  return <MarketOverview />;
}
