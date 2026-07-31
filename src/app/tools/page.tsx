import type { Metadata } from "next";
import { ToolsHub } from "@/components/tools-hub";

export const metadata: Metadata = {
  title: "Research Tools",
  description: "Supporting calculators and historical strategy tools for the InvestIQ research workflow.",
};

export default function ToolsRoute() {
  return <ToolsHub />;
}
