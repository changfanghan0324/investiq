import type { Metadata } from "next";
import { DcaBacktestDashboard } from "@/components/dca-backtest-dashboard";

export const metadata: Metadata = {
  title: "Historical DCA Backtest",
  description: "Backtest a historical recurring-investment plan with fees, taxes, and dividends.",
};

export default function HistoricalDcaRoute() {
  return <DcaBacktestDashboard />;
}
