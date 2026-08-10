import { ModelGuardStaticPage } from "@/components/modelguard-static-page";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "Model audit methodology",
  description: "Deterministic, explainable checks for financial model review.",
  path: "/methodology",
});

export default function MethodologyPage() {
  return <ModelGuardStaticPage kind="methodology" />;
}
