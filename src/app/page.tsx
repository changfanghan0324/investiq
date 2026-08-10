import type { Metadata } from "next";
import { ModelGuardHome } from "@/components/modelguard-home";
import { homeMetadata } from "@/config/site-metadata";

export const metadata: Metadata = homeMetadata;

export default function ModelGuardRoute() {
  return <ModelGuardHome />;
}
