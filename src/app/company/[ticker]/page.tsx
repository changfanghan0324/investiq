import { CompanySummary } from "@/components/company-summary";
import { companyPageMetadata } from "@/config/site-metadata";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return companyPageMetadata({ ticker, section: "Company Summary" });
}

export default async function CompanySummaryRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanySummary key={ticker} rawTicker={ticker} />;
}
