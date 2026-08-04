import type { Metadata } from "next";

import { AboutPage } from "@/components/about-page";

export const metadata: Metadata = {
  title: "About",
  description: "The evidence, governance, and product decisions behind InvestIQ.",
};

export default function AboutRoute() {
  return <AboutPage />;
}
