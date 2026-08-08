import { MarketOverview } from "@/components/market-overview";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "Market Context",
  description: "End-of-day US benchmark and watchlist context for an investment research workflow.",
  path: "/market",
  indexable: false,
});

export default function MarketContextRoute() {
  return <MarketOverview />;
}
