import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site-metadata";

export const dynamic = "force-static";

/** Only durable, indexable editorial pages belong in the public sitemap. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date("2026-08-08T00:00:00.000Z");
  return ["/", "/templates", "/methodology", "/privacy", "/about"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
