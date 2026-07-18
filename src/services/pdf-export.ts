// Purpose: Produces a complete, downloadable portfolio report without sending report data to a third party.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type {
  BacktestResult,
  PortfolioAggregateResult,
  PortfolioReport,
} from "@/types/backtest";
import { formatCurrency, formatPercent, formatShares } from "@/utils/format";

interface ExportOptions {
  report: PortfolioReport;
  result: PortfolioAggregateResult;
  holdings: Array<{ ticker: string; result: BacktestResult }>;
  scenarioLabel?: string;
}

type PdfWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

export function exportPortfolioPdf({ report, result, holdings, scenarioLabel }: ExportOptions) {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const margin = 42;
  const width = doc.internal.pageSize.getWidth();
  const mode = scenarioLabel ? `${scenarioLabel} simulated estimate` : "Historical backtest";

  doc.setFillColor(5, 20, 31);
  doc.rect(0, 0, width, 116, "F");
  doc.setTextColor(40, 201, 244);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("STOCK LENS  /  PORTFOLIO LAB", margin, 34);
  doc.setTextColor(245, 250, 252);
  doc.setFontSize(23);
  doc.text("Portfolio Backtest Report", margin, 64);
  doc.setTextColor(160, 181, 194);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${mode}  |  ${result.startDate} to ${result.endDate}  |  Generated ${new Date().toLocaleString("en-US")}`, margin, 88);
  doc.text("For research and education only. Simulated estimates are not forecasts or guaranteed returns.", margin, 104);

  let y = 140;
  sectionTitle(doc, "Portfolio overview", y);
  y += 13;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["Ending value", "Contributions", "Total profit", "Total return", "Max drawdown", "Time"]],
    body: [[
      formatCurrency(result.finalAmount),
      formatCurrency(result.totalContributions),
      formatCurrency(result.totalProfit),
      formatPercent(result.totalReturnPercent),
      formatPercent(result.maxDrawdown.percent),
      `${result.durationDays} days`,
    ]],
    ...tableTheme(),
  });
  y = tableEnd(doc) + 26;

  sectionTitle(doc, "Holding attribution", y);
  autoTable(doc, {
    startY: y + 13,
    margin: { left: margin, right: margin },
    head: [["Ticker", "Company", "Ending value", "Contributed", "Return", "Final shares"]],
    body: holdings.map(({ ticker, result: item }) => [
      ticker,
      item.companyName,
      formatCurrency(item.finalAmount),
      formatCurrency(item.totalContributions),
      formatPercent(item.totalReturnPercent),
      formatShares(item.finalShares),
    ]),
    ...tableTheme(),
    columnStyles: { 1: { cellWidth: 150 } },
  });
  y = tableEnd(doc) + 26;

  sectionTitle(doc, "Return attribution", y);
  autoTable(doc, {
    startY: y + 13,
    margin: { left: margin, right: margin },
    body: [
      ["Ending market value", formatCurrency(result.stockValue)],
      ["Purchase cost basis", formatCurrency(result.purchaseCost)],
      ["Stock price return", formatCurrency(result.priceReturn)],
      ["Gross dividends", formatCurrency(result.grossDividends)],
      ["Dividend tax", `-${formatCurrency(result.dividendTax)}`],
      ["Capital gains tax", `-${formatCurrency(result.capitalGainsTax)}`],
      ["All fees", `-${formatCurrency(result.totalFees)}`],
      ["Uninvested cash", formatCurrency(result.cash)],
      ["Audit cross-check", formatCurrency(result.crossCheckDifference)],
    ],
    ...tableTheme(),
    theme: "plain",
    columnStyles: { 0: { textColor: [91, 111, 126] }, 1: { halign: "right", fontStyle: "bold" } },
  });
  y = tableEnd(doc) + 26;

  if (y > 650) {
    doc.addPage();
    y = 48;
  }
  sectionTitle(doc, "Risk and execution audit", y);
  autoTable(doc, {
    startY: y + 13,
    margin: { left: margin, right: margin },
    head: [["Peak", "Trough", "Recovery", "Orders", "Dividend reinvestments", "Splits", "Ticker changes"]],
    body: [[
      result.maxDrawdown.peakDate ?? "—",
      result.maxDrawdown.troughDate ?? "—",
      result.maxDrawdown.recoveryDate ?? "Not recovered",
      String(result.contributionCount),
      String(result.dividendCount),
      String(result.splitCount),
      String(result.tickerChangeCount),
    ]],
    ...tableTheme(),
  });
  y = tableEnd(doc) + 26;

  sectionTitle(doc, "Input assumptions", y);
  autoTable(doc, {
    startY: y + 13,
    margin: { left: margin, right: margin },
    head: [["Holding", "Order", "Every", "Execution"]],
    body: report.input.positions.map((position) => [
      position.ticker,
      position.investment.mode === "amount"
        ? formatCurrency(position.investment.value)
        : formatShares(position.investment.value),
      `${position.investment.intervalValue} ${labelInterval(position.investment.intervalUnit)}`,
      "Split-adjusted daily high",
    ]),
    ...tableTheme(),
  });
  y = tableEnd(doc) + 14;
  doc.setTextColor(70, 88, 103);
  doc.setFontSize(8.5);
  const assumptionLines = [
    `Reporting basis: ${report.input.taxMode === "after-tax" ? "After-tax" : "Pre-tax"}; dividend withholding: ${report.input.dividendTaxRate.toFixed(2)}%.`,
    `End treatment: ${report.input.liquidateAtEnd ? `Liquidated; capital gains tax ${report.input.capitalGainsTaxRate.toFixed(2)}%` : "Holdings valued at final adjusted close"}.`,
    `Broker: ${report.input.fees.brokerName}. Preset effective ${report.input.fees.effectiveDate}. ${report.input.fees.notes}`,
    "Non-trading scheduled dates roll forward. Fractional shares are rounded down to 0.001 share.",
    "Dividend eligibility is measured on ex-date and ordinary dividends are reinvested on payment date at that day's high.",
  ];
  doc.text(assumptionLines.flatMap((line) => doc.splitTextToSize(line, width - margin * 2)), margin, y, { lineHeightFactor: 1.45 });

  doc.addPage();
  sectionTitle(doc, `Complete transaction ledger (${result.transactions.length})`, 48);
  autoTable(doc, {
    startY: 64,
    margin: { left: margin, right: margin, bottom: 38 },
    showHead: "everyPage",
    head: [["Date", "Ticker", "Action", "Shares", "Price", "Gross cash", "Fee", "Tax"]],
    body: result.transactions.map((transaction) => [
      transaction.date,
      transaction.ticker ?? "—",
      transaction.type === "contribution-buy"
        ? "Recurring buy"
        : transaction.type === "dividend-reinvestment"
          ? "Dividend reinvestment"
          : "Final liquidation",
      transaction.shares.toFixed(3),
      formatCurrency(transaction.price),
      formatCurrency(transaction.grossCash),
      formatCurrency(transaction.fee),
      formatCurrency(transaction.tax),
    ]),
    ...tableTheme(7),
  });

  doc.addPage();
  sectionTitle(doc, "Methodology and limitations", 48);
  doc.setTextColor(50, 67, 80);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const paragraphs = [
    "Historical execution. Each recurring order is moved to the next available market session when its scheduled date is not a trading day. Purchases use that day's split-adjusted high. Period-end holdings are valued at the split-adjusted close unless liquidation is enabled.",
    "Corporate actions. Prices reflect splits and reverse splits without embedding dividend reinvestment. Ordinary dividends are modeled separately. If Stock Lens detects an unsupported or unreliable company action, calculation stops instead of silently producing a result.",
    "Drawdown. Maximum drawdown uses a cash-flow-neutral portfolio unit value, so new contributions do not appear as investment performance.",
    "Future periods. Any future figures are labeled simulated estimates and remain separate from historical results. Scenarios use the security's available history beginning no earlier than 1990 and no earlier than its actual listing data. They are not predictions, forecasts, advice, or guaranteed returns.",
    "Data and fees. Market data and broker fee schedules can be delayed, incomplete, revised, or region-specific. Confirm any decision against official filings and your brokerage statement. Stock Lens is an educational research tool, not a broker, adviser, tax professional, or execution venue.",
  ];
  let textY = 78;
  paragraphs.forEach((paragraph) => {
    const lines = doc.splitTextToSize(paragraph, width - margin * 2);
    doc.text(lines, margin, textY, { lineHeightFactor: 1.55 });
    textY += lines.length * 14 + 12;
  });

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 126, 138);
    doc.text(
      `Stock Lens complete report  |  Page ${pageNumber} of ${pageCount}`,
      margin,
      doc.internal.pageSize.getHeight() - 20,
    );
  }

  const tickerPart = holdings.map((item) => item.ticker).join("-").slice(0, 40) || "portfolio";
  doc.save(`stock-lens-${tickerPart}-${result.endDate}.pdf`);
}

function sectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setTextColor(13, 49, 69);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title.toUpperCase(), 42, y);
}

function tableEnd(doc: jsPDF) {
  return (doc as PdfWithTable).lastAutoTable?.finalY ?? 80;
}

function tableTheme(fontSize = 8.5) {
  return {
    styles: { font: "helvetica", fontSize, cellPadding: 5, textColor: [31, 48, 61] as [number, number, number] },
    headStyles: { fillColor: [9, 38, 55] as [number, number, number], textColor: [235, 248, 252] as [number, number, number], fontStyle: "bold" as const },
    alternateRowStyles: { fillColor: [242, 247, 249] as [number, number, number] },
    tableLineColor: [210, 222, 228] as [number, number, number],
    tableLineWidth: 0.4,
  };
}

function labelInterval(unit: string) {
  if (unit === "trading-days") return "Day";
  if (unit === "weeks") return "Week";
  if (unit === "years") return "Year";
  return "Month";
}
