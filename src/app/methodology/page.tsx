import type { Metadata } from "next";
import { MethodologyContent } from "./methodology-content";

export const metadata: Metadata = {
  title: "How Stock Lens calculates results",
  description: "The execution, dividend, return, drawdown, fee, tax, and simulation rules used by Stock Lens.",
};

export default function MethodologyPage() {
  return <MethodologyContent />;
}
