import { ModelGuardStaticPage } from "@/components/modelguard-static-page";
import { publicPageMetadata } from "@/config/site-metadata";

export const metadata = publicPageMetadata({
  title: "About",
  description: "The product principles behind ModelGuard.",
  path: "/about",
});

export default function AboutRoute() {
  return <ModelGuardStaticPage kind="about" />;
}
