import type { Metadata } from "next";
import { CompanyFinancials } from "@/components/company-financials";

export const metadata: Metadata = { title: "Company Financials" };

export default async function CompanyFinancialsRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyFinancials key={ticker} rawTicker={ticker} />;
}
