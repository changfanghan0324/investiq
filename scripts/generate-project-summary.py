#!/usr/bin/env python3
"""Generate the stable one-page InvestIQ portfolio summary PDF."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "InvestIQ_Project_Summary.pdf"
FONT_REGULAR = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")


def register_fonts() -> tuple[str, str]:
    if FONT_REGULAR.exists() and FONT_BOLD.exists():
        pdfmetrics.registerFont(TTFont("InvestIQ-Regular", str(FONT_REGULAR)))
        pdfmetrics.registerFont(TTFont("InvestIQ-Bold", str(FONT_BOLD)))
        return "InvestIQ-Regular", "InvestIQ-Bold"
    return "Helvetica", "Helvetica-Bold"


def build_pdf() -> None:
    regular, bold = register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    navy = colors.HexColor("#07131B")
    panel = colors.HexColor("#10232E")
    ink = colors.HexColor("#15242E")
    muted = colors.HexColor("#536672")
    cyan = colors.HexColor("#18A8D8")
    green = colors.HexColor("#2EAE78")
    line = colors.HexColor("#CBD6DC")
    white = colors.HexColor("#F6FAFC")

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=13 * mm,
        bottomMargin=12 * mm,
        title="InvestIQ Project Summary",
        author="InvestIQ",
        subject="Investment Research and Portfolio Analytics Platform",
    )

    title = ParagraphStyle("title", fontName=bold, fontSize=21, leading=23, textColor=white)
    subtitle = ParagraphStyle("subtitle", fontName=regular, fontSize=9.4, leading=13, textColor=colors.HexColor("#B7CAD5"))
    section = ParagraphStyle("section", fontName=bold, fontSize=9.5, leading=11, textColor=cyan, spaceAfter=3)
    body = ParagraphStyle("body", fontName=regular, fontSize=7.9, leading=10.7, textColor=ink, alignment=TA_LEFT)
    body_white = ParagraphStyle("body_white", parent=body, textColor=white)
    micro = ParagraphStyle("micro", fontName=regular, fontSize=6.7, leading=8.5, textColor=muted)
    metric = ParagraphStyle("metric", fontName=bold, fontSize=9.5, leading=11, textColor=ink)
    metric_label = ParagraphStyle("metric_label", fontName=regular, fontSize=6.5, leading=8, textColor=muted)

    story = []
    header = Table(
        [[Paragraph("InvestIQ", title), Paragraph("EVIDENCE-FIRST ANALYTICS", ParagraphStyle("tag", fontName=bold, fontSize=7, textColor=green, alignment=2))],
         [Paragraph("Investment Research &amp; Portfolio Analytics Platform", subtitle), ""]],
        colWidths=[130 * mm, 50 * mm],
    )
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), navy),
        ("SPAN", (0, 1), (1, 1)),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
        ("TOPPADDING", (0, 1), (-1, 1), 0),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.extend([header, Spacer(1, 5 * mm)])

    stats = Table([
        [Paragraph("4", metric), Paragraph("1-10", metric), Paragraph("2", metric), Paragraph("EN / ZH-CN", metric)],
        [Paragraph("connected research modules", metric_label), Paragraph("portfolio holdings", metric_label), Paragraph("valuation methods", metric_label), Paragraph("localized interface", metric_label)],
    ], colWidths=[45 * mm] * 4)
    stats.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EDF4F7")),
        ("BOX", (0, 0), (-1, -1), 0.6, line),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, line),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 5),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 0),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 5),
    ]))
    story.extend([stats, Spacer(1, 4 * mm)])

    left = [
        Paragraph("THE PROBLEM", section),
        Paragraph("Early-career analysts often split filings, valuation, portfolio risk, and written conclusions across unrelated tools. Dates and return bases drift, unsupported data becomes zero, and a single fair-value number can hide the assumptions that created it.", body),
        Spacer(1, 3 * mm),
        Paragraph("THE PRODUCT", section),
        Paragraph("InvestIQ joins official filing facts, explicit calculation contracts, scenario valuation, portfolio impact, and an evidence-linked memo. The primary audience is finance students, aspiring equity-research analysts, and asset-management interns; plain-language explanations keep the same workflow usable for self-directed investors.", body),
        Spacer(1, 3 * mm),
        Paragraph("CORE WORKFLOW", section),
        Paragraph("<b>1.</b> Search a US ticker and inspect latest-reported SEC annual facts with filing receipts.<br/><b>2.</b> Review five-year growth, margins, cash flow, and explicit data gaps.<br/><b>3.</b> Run editable FCFF DCF, bull/base/bear ranges, sensitivity tables, and sourced peer multiples.<br/><b>4.</b> Diagnose portfolio return, downside risk, benchmark relationship, attribution, correlation, and concentration.<br/><b>5.</b> Preserve evidence and analyst-owned interpretation in a printable one-page memo.", body),
    ]

    right = [
        Paragraph("MODEL GOVERNANCE", section),
        Paragraph("• Ranges before point estimates.<br/>• Reported facts separated from user assumptions.<br/>• Unavailable remains unavailable - never silent zero.<br/>• Latest-reported facts never backfilled into historical analysis.<br/>• VaR is a historical loss threshold, not a loss ceiling.<br/>• Future DCA estimates are disabled.", body),
        Spacer(1, 3 * mm),
        Paragraph("TECHNICAL STACK", section),
        Paragraph("Next.js, TypeScript, React, CSS Modules, Recharts, Vitest, SEC EDGAR APIs, same-origin server routes, Git/GitHub, and Vercel-ready deployment. Domain math is implemented as pure functions with hand-calculated and boundary-value tests.", body),
        Spacer(1, 3 * mm),
        Paragraph("SELECT ANALYTICS", section),
        Paragraph("Revenue and EPS growth • operating and net margin • constructed free cash flow • FCFF DCF • EV-to-equity bridge • WACC x terminal-growth sensitivity • comparable multiples • CAGR • volatility • Sharpe • Sortino • beta • Jensen-style alpha • maximum drawdown • historical one-day VaR • correlation • HHI and effective holdings", body),
    ]

    columns = Table([[left, right]], colWidths=[88 * mm, 88 * mm], hAlign="LEFT")
    columns.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 5),
        ("LEFTPADDING", (1, 0), (1, 0), 5),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("LINEBEFORE", (1, 0), (1, 0), 0.6, line),
    ]))
    story.extend([columns, Spacer(1, 4 * mm)])

    evidence = Table([[Paragraph("EVIDENCE BASE", section), Paragraph("PORTFOLIO DELIVERABLES", section)],
                      [Paragraph("SEC EDGAR API and developer guidance • CFA Institute material on Sortino ratio, market-risk measurement, and model communication • Damodaran firm-valuation and terminal-value framework", body_white),
                       Paragraph("Public web app • source repository • methodology • project report • AAPL research memo sample • three-minute demo script • one-page summary", body_white)]], colWidths=[90 * mm, 90 * mm])
    evidence.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), panel),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 0),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.extend([KeepTogether(evidence), Spacer(1, 3 * mm)])
    story.append(Paragraph("Educational research software only. Not investment, legal, or tax advice. Full assumptions, source links, limitations, and validation evidence are documented in README.md and docs/PROJECT_REPORT.md.", micro))

    doc.build(story)


if __name__ == "__main__":
    build_pdf()
