import { ImageResponse } from "next/og";

export const alt = "InvestIQ — Investment Research & Portfolio Analytics";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 82px", color: "#f5f8fc", background: "#020b17", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ width: 66, height: 66, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #1980ff", borderRadius: 16, color: "#58b2ff", fontSize: 28 }}>IQ</div>
        <div style={{ fontSize: 38, fontWeight: 700 }}>Invest<span style={{ color: "#1980ff" }}>IQ</span></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ maxWidth: 940, fontSize: 62, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-2px" }}>Investment Research &amp; Portfolio Analytics</div>
        <div style={{ color: "#9fb0c5", fontSize: 27 }}>Evidence → Assumptions → Risk → Memo</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#8392a6", fontSize: 21 }}>
        <span>Evidence-first · reproducible · educational</span>
        <span>Built by Fang Han Chang / Peter Chang</span>
      </div>
    </div>,
    size,
  );
}
