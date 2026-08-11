import type { Metadata } from "next";
import { ModelGuardWorkspace } from "@/components/modelguard-workspace";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Audit workspace",
  description: "Audit an XLSX financial model locally in your browser.",
  path: "/workspace",
  indexable: false,
});

export default function WorkspacePage() {
  return <ModelGuardWorkspace />;
}
