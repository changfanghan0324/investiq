import type { Metadata } from "next";
import { ModelGuardStaticPage } from "@/components/modelguard-static-page";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy and security",
  description: "How ModelGuard keeps workbook audit processing local to the browser.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return <ModelGuardStaticPage kind="privacy" />;
}
