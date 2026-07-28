import type { TranslationKey } from "@/i18n/language";

export type NavRouteId = "market" | "stock" | "compare" | "portfolio" | "dca";

export interface NavRoute {
  /** Stable identifier used to pick the route icon in the shell. */
  id: NavRouteId;
  href: string;
  /** Full label used by the desktop top navigation. */
  labelKey: TranslationKey;
  /** Abbreviated label used by the mobile bottom navigation. */
  shortLabelKey: TranslationKey;
}

/** The five primary workspaces. /methodology is documentation and stays out of this list. */
export const primaryRoutes: readonly NavRoute[] = [
  { id: "market", href: "/", labelKey: "nav.market", shortLabelKey: "nav.marketShort" },
  { id: "stock", href: "/stock", labelKey: "nav.stock", shortLabelKey: "nav.stockShort" },
  { id: "compare", href: "/compare", labelKey: "nav.compare", shortLabelKey: "nav.compareShort" },
  { id: "portfolio", href: "/portfolio", labelKey: "nav.portfolio", shortLabelKey: "nav.portfolioShort" },
  { id: "dca", href: "/dca", labelKey: "nav.dca", shortLabelKey: "nav.dcaShort" },
];

/** Exact match for "/", prefix match for nested segments of every other route. */
export function isActiveRoute(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/") return current === "/";
  return current === href || current.startsWith(`${href}/`);
}
