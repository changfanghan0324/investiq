import { EquityReport } from "@/components/equity-report";
import { companyPageMetadata } from "@/config/site-metadata";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return companyPageMetadata({ ticker, section: "Equity Research Report", path: `/company/${encodeURIComponent(ticker.toUpperCase())}/report` });
}

export default async function EquityReportRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <EquityReport key={ticker} rawTicker={ticker} />;
}
