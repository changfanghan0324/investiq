import type { TranslationKey } from "@/i18n/language";

export type NavRouteId = "research" | "compare" | "portfolio" | "tools";

export interface NavRoute {
  /** Stable identifier used to pick the route icon in the shell. */
  id: NavRouteId;
  href: string;
  /** Full label used by the desktop top navigation. */
  labelKey: TranslationKey;
  /** Abbreviated label used by the mobile bottom navigation. */
  shortLabelKey: TranslationKey;
}

/** Primary decision workspaces. Market context and methodology are reached in context. */
export const primaryRoutes: readonly NavRoute[] = [
  { id: "research", href: "/", labelKey: "nav.research", shortLabelKey: "nav.researchShort" },
  { id: "compare", href: "/compare", labelKey: "nav.compare", shortLabelKey: "nav.compareShort" },
  { id: "portfolio", href: "/portfolio", labelKey: "nav.portfolio", shortLabelKey: "nav.portfolioShort" },
  { id: "tools", href: "/tools", labelKey: "nav.tools", shortLabelKey: "nav.toolsShort" },
];

/** Exact match for "/", prefix match for nested segments of every other route. */
export function isActiveRoute(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/") return current === "/";
  return current === href || current.startsWith(`${href}/`);
}
