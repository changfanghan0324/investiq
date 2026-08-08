import { DcaBacktestDashboard } from "@/components/dca-backtest-dashboard";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "Historical DCA Backtest",
  description: "Backtest a historical recurring-investment plan with fees, taxes, and dividends.",
  path: "/tools/dca",
  indexable: false,
});

export default function HistoricalDcaRoute() {
  return <DcaBacktestDashboard />;
}
