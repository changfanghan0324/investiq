import type { ReactNode } from "react";
import { CompanyResearchShell } from "@/components/company-research-shell";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  return <CompanyResearchShell ticker={ticker}>{children}</CompanyResearchShell>;
}
