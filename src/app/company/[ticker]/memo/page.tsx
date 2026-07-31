import type { Metadata } from "next";
import { CompanyMemo } from "@/components/company-memo";

export const metadata: Metadata = { title: "Investment Memo" };

export default async function CompanyMemoRoute({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyMemo key={ticker} rawTicker={ticker} />;
}
