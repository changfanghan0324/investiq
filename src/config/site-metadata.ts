import type { Metadata } from "next";

export const SITE_URL = "https://investiq-eight-xi.vercel.app";
export const SITE_NAME = "InvestIQ";
export const DEFAULT_TITLE = "InvestIQ — Investment Research & Portfolio Analytics";
export const HOME_TITLE = "InvestIQ — Auditable Investment Research & Portfolio Analytics";
export const SITE_DESCRIPTION = "Trace official SEC filing evidence, test explicit valuation assumptions, and connect holdings to portfolio-level risk in one reproducible workflow.";

const socialImage = { url: "/opengraph-image", width: 1200, height: 630, alt: "InvestIQ — Investment Research & Portfolio Analytics" };

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
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    images: [socialImage.url],
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
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: [socialImage.url],
  },
};
