import type { TranslationKey } from "@/i18n/language";

export type NavRouteId = "audit" | "templates" | "methodology" | "about";

export interface NavRoute {
  /** Stable identifier used to pick the route icon in the shell. */
  id: NavRouteId;
  href: string;
  /** Full label used by the desktop top navigation. */
  labelKey: TranslationKey;
  /** Abbreviated label used by the mobile bottom navigation. */
  shortLabelKey: TranslationKey;
}

/** ModelGuard's four primary workspaces. All processing remains local to the browser. */
export const primaryRoutes: readonly NavRoute[] = [
  { id: "audit", href: "/workspace", labelKey: "nav.audit", shortLabelKey: "nav.auditShort" },
  { id: "templates", href: "/templates", labelKey: "nav.templates", shortLabelKey: "nav.templatesShort" },
  { id: "methodology", href: "/methodology", labelKey: "nav.methodology", shortLabelKey: "nav.methodologyShort" },
  { id: "about", href: "/about", labelKey: "nav.about", shortLabelKey: "nav.aboutShort" },
];

/** Exact match for "/", prefix match for nested segments of every other route. */
export function isActiveRoute(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === "/") return current === "/";
  return current === href || current.startsWith(`${href}/`);
}
