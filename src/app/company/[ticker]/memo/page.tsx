import { CompanyMemo } from "@/components/company-memo";
import { companyPageMetadata } from "@/config/site-metadata";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return companyPageMetadata({ ticker, section: "Investment Memo", path: `/company/${encodeURIComponent(ticker.toUpperCase())}/memo` });
}

export default async function CompanyMemoRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyMemo key={ticker} rawTicker={ticker} />;
}
