import type { Metadata } from "next";

import { AaplCaseStudy } from "@/components/aapl-case-study";

export const metadata: Metadata = {
  title: "AAPL Research Case Study",
  description: "A dated, evidence-linked Apple case separating SEC facts, constructed observations, and analyst-owned DCF scenarios.",
};

export default function AaplCaseStudyRoute() {
  return <AaplCaseStudy />;
}
