import type { Metadata } from "next";
import { ResearchHome } from "@/components/research-home";
import { homeMetadata } from "@/config/site-metadata";

export const metadata: Metadata = homeMetadata;

export default function ResearchRoute() {
  return <ResearchHome />;
}
