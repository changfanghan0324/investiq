import type { Metadata } from "next";
import { ResearchHome } from "@/components/research-home";

export const metadata: Metadata = {
  title: "Investment Research",
  description: "Build an evidence-backed view of a US-listed company, its valuation assumptions, and portfolio risk.",
};

export default function ResearchRoute() {
  return <ResearchHome />;
}
