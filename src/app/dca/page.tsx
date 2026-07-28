import type { Metadata } from "next";
import { DcaBacktestDashboard } from "@/components/dca-backtest-dashboard";

export const metadata: Metadata = {
  title: "DCA Backtest",
  description: "Backtest a dollar-cost-averaging plan on end-of-day data, with broker fees and taxes applied.",
};

export default function DcaBacktestRoute() {
  return <DcaBacktestDashboard />;
}
