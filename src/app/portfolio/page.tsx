import { PortfolioLab } from "@/components/portfolio-lab";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "Portfolio Lab",
  description:
    "Weight a buy-and-hold portfolio of US stocks and ETFs on end-of-day closing prices, then read its return, drawdown, concentration, and correlation.",
  path: "/portfolio",
  indexable: false,
});

export default function PortfolioLabRoute() {
  return <PortfolioLab />;
}
