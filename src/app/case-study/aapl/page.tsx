import type { Metadata } from "next";

import { AaplCaseStudy } from "@/components/aapl-case-study";

export const metadata: Metadata = {
  title: "AAPL Research Case Study",
  description: "A stable walkthrough of InvestIQ's source-to-conclusion research workflow.",
};

export default function AaplCaseStudyRoute() {
  return <AaplCaseStudy />;
}
