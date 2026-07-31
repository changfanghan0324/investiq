import type { Metadata } from "next";
import { CompanyValuation } from "@/components/company-valuation";

export const metadata: Metadata = { title: "Valuation" };

export default async function CompanyValuationRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyValuation key={ticker} rawTicker={ticker} />;
}
