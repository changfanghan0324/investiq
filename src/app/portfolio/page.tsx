import type { Metadata } from "next";
import { PortfolioLab } from "@/components/portfolio-lab";

export const metadata: Metadata = {
  title: "Portfolio Lab",
  description:
    "Weight a buy-and-hold portfolio of US stocks and ETFs on end-of-day closing prices, then read its return, drawdown, concentration, and correlation.",
};

export default function PortfolioLabRoute() {
  return <PortfolioLab />;
}
