import type { Metadata } from "next";

import { EquityReport } from "@/components/equity-report";

export const metadata: Metadata = { title: "Equity Research Report" };

export default async function EquityReportRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <EquityReport key={ticker} rawTicker={ticker} />;
}
