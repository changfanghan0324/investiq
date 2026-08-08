import { CompanyFinancials } from "@/components/company-financials";
import { companyPageMetadata } from "@/config/site-metadata";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return companyPageMetadata({ ticker, section: "Company Financials", path: `/company/${encodeURIComponent(ticker.toUpperCase())}/financials` });
}

export default async function CompanyFinancialsRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyFinancials key={ticker} rawTicker={ticker} />;
}
