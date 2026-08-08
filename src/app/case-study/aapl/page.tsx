import { AaplCaseStudy } from "@/components/aapl-case-study";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "AAPL Research Case Study",
  description: "A dated, evidence-linked Apple case separating SEC facts, constructed observations, and analyst-owned DCF scenarios.",
  path: "/case-study/aapl",
});

export default function AaplCaseStudyRoute() {
  return <AaplCaseStudy />;
}
