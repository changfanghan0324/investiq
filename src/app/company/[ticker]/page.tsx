import type { Metadata } from "next";
import { CompanySummary } from "@/components/company-summary";

export const metadata: Metadata = { title: "Company Summary" };

export default async function CompanySummaryRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanySummary key={ticker} rawTicker={ticker} />;
}
