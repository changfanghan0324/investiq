import { AboutPage } from "@/components/about-page";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "About",
  description: "The evidence, governance, and product decisions behind InvestIQ.",
  path: "/about",
});

export default function AboutRoute() {
  return <AboutPage />;
}
