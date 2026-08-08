import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site-metadata";

/** Keep operational/query-driven workspaces out of search indexes. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about", "/methodology", "/case-study/"],
      disallow: ["/company/", "/compare", "/portfolio", "/tools", "/market", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
