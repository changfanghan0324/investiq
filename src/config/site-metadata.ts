import type { Metadata } from "next";

export const SITE_URL = "https://investiq-eight-xi.vercel.app";
export const SITE_NAME = "ModelGuard";
export const DEFAULT_TITLE = "ModelGuard — Private Financial Model Audit";
export const HOME_TITLE = "ModelGuard — Check a financial model before someone else does";
export const SITE_DESCRIPTION = "Audit accounting linkages, formulas, DCF logic, assumptions, and scenario consistency locally in your browser.";

export const SOCIAL_IMAGE = { url: "/opengraph.svg", width: 1200, height: 630, alt: "ModelGuard — Private Financial Model Audit" };

export const rootMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: "%s — InvestIQ" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    url: "/",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE.url],
  },
  keywords: ["financial model audit", "DCF model review", "investment committee readiness", "spreadsheet audit"],
  icons: { icon: "/icon.svg" },
};

export const homeMetadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    url: "/",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE.url],
  },
};

/**
 * Shared metadata contract for routes outside the research launcher.
 *
 * `path` is deliberately explicit so canonical URLs cannot drift from the
 * route that rendered the page. Operational workspaces remain noindex until
 * their data and query state are stable enough to be useful landing pages.
 */
export function publicPageMetadata({
  title,
  description,
  path,
  indexable = true,
}: {
  title: string;
  description: string;
  path: string;
  indexable?: boolean;
}): Metadata {
  const fullTitle = `${title} — ${SITE_NAME}`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: fullTitle,
      description,
      siteName: SITE_NAME,
      type: "website",
      url: path,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [SOCIAL_IMAGE.url],
    },
  };
}

export function companyPageMetadata({ ticker, section = "Company Summary", path }: { ticker: string; section?: string; path?: string }): Metadata {
  const normalizedTicker = ticker.trim().toUpperCase();
  return publicPageMetadata({
    title: `${section}: ${normalizedTicker}`,
    description: `Evidence-linked ${section.toLowerCase()} for ${normalizedTicker}, with unavailable fields kept unavailable and every figure tied to its source or formula.`,
    path: path ?? `/company/${encodeURIComponent(normalizedTicker)}`,
    indexable: false,
  });
}
