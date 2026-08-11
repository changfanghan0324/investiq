import type { Metadata } from "next";
import { ModelGuardStaticPage } from "@/components/modelguard-static-page";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Templates",
  description: "ModelGuard workbook templates for a repeatable review handoff.",
  path: "/templates",
});

export default function TemplatesPage() {
  return <ModelGuardStaticPage kind="templates" />;
}
