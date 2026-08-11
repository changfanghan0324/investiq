import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site-metadata";

export const dynamic = "force-static";

/** Keep the local audit workspace out of search indexes. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about", "/methodology", "/templates", "/privacy"],
      disallow: ["/workspace", "/api/", "/market", "/compare", "/portfolio", "/tools", "/company/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
