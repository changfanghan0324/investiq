import type { Metadata } from "next";

export const SITE_URL = "https://investiq-eight-xi.vercel.app";
export const SITE_NAME = "InvestIQ";
export const DEFAULT_TITLE = "InvestIQ — Investment Research & Portfolio Analytics";
export const HOME_TITLE = "InvestIQ — Auditable Investment Research & Portfolio Analytics";
export const SITE_DESCRIPTION = "Trace official SEC filing evidence, test explicit valuation assumptions, and connect holdings to portfolio-level risk in one reproducible workflow.";

export const SOCIAL_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "InvestIQ — Investment Research & Portfolio Analytics" };

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
  keywords: ["investment research", "SEC filing evidence", "DCF valuation", "portfolio analytics", "risk analytics"],
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
