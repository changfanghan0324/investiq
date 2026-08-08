"use client";

import type { FinancialFactOrigin, FinancialCoverageStatus, FundamentalsObservation } from "@/domain/fundamentals";
import { useLanguage } from "@/i18n/language";

export function FinancialOriginLabel({
  observation,
  origin = observation?.origin,
  coverageStatus,
  className,
}: {
  observation?: FundamentalsObservation;
  origin?: FinancialFactOrigin;
  coverageStatus?: FinancialCoverageStatus;
  className?: string;
}) {
  const { t } = useLanguage();
  if (coverageStatus === "limited-history") return <span className={className}>{t("company.originLimited")}</span>;
  if (origin === "direct-standard") return <span className={className}>{t("company.originDirect")}</span>;
  if (origin === "constructed-standard") return <span className={className}>{t("company.originConstructed")}</span>;
  if (origin === "direct-custom-extension") return <span className={className}>{t("company.originCustom")}</span>;
  if (origin === "manual-user") return <span className={className}>{t("company.originManual")}</span>;
  return null;
}
