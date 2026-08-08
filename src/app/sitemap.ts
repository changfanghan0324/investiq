import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site-metadata";

/** Only durable, indexable editorial pages belong in the public sitemap. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date("2026-08-08T00:00:00.000Z");
  return ["/", "/about", "/methodology", "/case-study/aapl"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
