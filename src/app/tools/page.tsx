import { ToolsHub } from "@/components/tools-hub";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "Research Tools",
  description: "Supporting calculators and historical strategy tools for the InvestIQ research workflow.",
  path: "/tools",
  indexable: false,
});

export default function ToolsRoute() {
  return <ToolsHub />;
}
