import { CompanyValuation } from "@/components/company-valuation";
import { companyPageMetadata } from "@/config/site-metadata";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return companyPageMetadata({ ticker, section: "Valuation", path: `/company/${encodeURIComponent(ticker.toUpperCase())}/valuation` });
}

export default async function CompanyValuationRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyValuation key={ticker} rawTicker={ticker} />;
}
