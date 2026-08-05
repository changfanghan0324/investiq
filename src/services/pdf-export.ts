// Purpose: Produces a complete, downloadable portfolio report without sending report data to a third party.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type {
  BacktestResult,
  FeeComponentKind,
  MoneyWeightedReturn,
  PortfolioAggregateResult,
  PortfolioReport,
  TimeWeightedReturn,
  TransactionType,
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
  const synthetic = report.source === "demo";
  const mode = synthetic
    ? `Synthetic public-demo series — ${scenarioLabel ? `${scenarioLabel} simulated estimate` : "historical calculation path"}`
    : scenarioLabel ? `${scenarioLabel} simulated estimate` : "Historical backtest";

  doc.setFillColor(5, 20, 31);
  doc.rect(0, 0, width, synthetic ? 130 : 116, "F");
  doc.setTextColor(40, 201, 244);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(synthetic ? "INVESTIQ  /  DCA PUBLIC DEMO" : "INVESTIQ  /  DCA BACKTEST", margin, 34);
  doc.setTextColor(245, 250, 252);
  doc.setFontSize(23);
  doc.text(synthetic ? "Synthetic Series Report" : "Portfolio Backtest Report", margin, 64);
  doc.setTextColor(160, 181, 194);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${mode}  |  ${result.startDate} to ${result.endDate}  |  Generated ${new Date().toLocaleString("en-US")}`, margin, 88);
  doc.text(
    synthetic
      ? "Data source: Synthetic public-demo series. Not actual market history."
      : "For research and education only. Simulated estimates are not forecasts or guaranteed returns.",
    margin,
    104,
  );

  if (synthetic) {
    doc.text(
      "For research and education only. Simulated estimates are not forecasts or guaranteed returns.",
      margin,
      118,
    );
  }

  let y = synthetic ? 154 : 140;
  sectionTitle(doc, "Portfolio overview", y);
  y += 13;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["Ending value", "Contributions", "Net gain / loss", "Net gain ÷ contrib", "Max drawdown", "Time"]],
    body: [[
      formatCurrency(result.finalAmount),
      formatCurrency(result.totalContributions),
      formatCurrency(result.totalProfit),
      formatPercent(result.netGainRatioPercent),
      formatPercent(result.maxDrawdown.percent),
      `${result.durationDays} days`,
    ]],
    ...tableTheme(),
  });
  y = tableEnd(doc) + 26;

  sectionTitle(doc, "Performance measures", y);
  autoTable(doc, {
    startY: y + 13,
    margin: { left: margin, right: margin },
    body: [
      ["Net gain ÷ contributions (dollar-efficiency ratio, not annualized)", formatPercent(result.netGainRatioPercent)],
      ["Time-weighted return (TWR), since inception — cash-flow neutral", formatPercent(result.twr.cumulative * 100)],
      ["TWR annualized", annualizedTwrLabel(result.twr)],
      ["Money-weighted return (MWRR / annualized XIRR), investor experience", mwrrLabel(result.mwrr)],
    ],
    ...tableTheme(),
    theme: "plain",
    columnStyles: { 0: { textColor: [91, 111, 126] }, 1: { halign: "right", fontStyle: "bold" } },
  });
  y = tableEnd(doc) + 8;
  doc.setTextColor(70, 88, 103);
  doc.setFontSize(8.5);
  const measuresNote = doc.splitTextToSize(
    "Net gain ÷ contributions is a simple dollar-efficiency ratio, not a return and not annualized. TWR removes the effect of contribution timing (dividends, dividend tax, and fees stay inside it); MWRR reflects the timing and size of your contributions. Annualization is shown only after at least one calendar year. These are educational estimates, not GIPS-compliant, audited, or investment advice.",
    width - margin * 2,
  );
  doc.text(measuresNote, margin, y, { lineHeightFactor: 1.4 });
  y += measuresNote.length * 11 + 26;

  if (y > 600) {
    doc.addPage();
    y = 48;
  }
  sectionTitle(doc, "Holding attribution", y);
  autoTable(doc, {
    startY: y + 13,
    margin: { left: margin, right: margin },
    head: [["Ticker", "Company", "Ending value", "Contributed", "Net gain ÷ contrib", "Final shares"]],
    body: holdings.map(({ ticker, result: item }) => [
      ticker,
      item.companyName,
      formatCurrency(item.finalAmount),
      formatCurrency(item.totalContributions),
      formatPercent(item.netGainRatioPercent),
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

  if (result.feeComponents.length > 0) {
    if (y > 600) {
      doc.addPage();
      y = 48;
    }
    sectionTitle(doc, "Fee breakdown (audited components)", y);
    autoTable(doc, {
      startY: y + 13,
      margin: { left: margin, right: margin },
      body: [
        ...result.feeComponents.map((line) => [feeComponentLabel(line.kind), `-${formatCurrency(line.amount)}`]),
        ["Total fees", `-${formatCurrency(result.totalFees)}`],
      ],
      ...tableTheme(),
      theme: "plain",
      columnStyles: { 0: { textColor: [91, 111, 126] }, 1: { halign: "right", fontStyle: "bold" } },
    });
    y = tableEnd(doc) + 8;
    doc.setTextColor(70, 88, 103);
    doc.setFontSize(8.5);
    const feeNote = doc.splitTextToSize(
      "Each broker preset is a dated, source-backed fee scenario applying the broker's current schedule to every modeled order — not reconstructed historical charges. Regulatory components (SEC Section 31, FINRA TAF, CAT) are shown apart from broker commissions.",
      width - margin * 2,
    );
    doc.text(feeNote, margin, y, { lineHeightFactor: 1.4 });
    y += feeNote.length * 11 + 26;
  }

  if (result.liquidation) {
    if (y > 560) {
      doc.addPage();
      y = 48;
    }
    sectionTitle(doc, "Liquidation tax estimate (simplified flat rate)", y);
    autoTable(doc, {
      startY: y + 13,
      margin: { left: margin, right: margin },
      body: [
        ["Purchase principal", formatCurrency(result.purchaseCost)],
        ["Acquisition fees", formatCurrency(result.acquisitionFees)],
        ["Adjusted tax basis", formatCurrency(result.liquidation.adjustedTaxBasis)],
        ["Gross market value", formatCurrency(result.stockValue)],
        ["Sell fee", `-${formatCurrency(result.liquidation.sellFee)}`],
        ["Net amount realized", formatCurrency(result.liquidation.netAmountRealized)],
        ["Realized gain / loss", formatCurrency(result.liquidation.realizedGainLoss)],
        ["Taxable gain (netted, floored at 0)", formatCurrency(result.liquidation.taxableGain)],
        ["Capital gains tax estimate", `-${formatCurrency(result.liquidation.capitalGainsTax)}`],
      ],
      ...tableTheme(),
      theme: "plain",
      columnStyles: { 0: { textColor: [91, 111, 126] }, 1: { halign: "right", fontStyle: "bold" } },
    });
    y = tableEnd(doc) + 8;
    doc.setTextColor(70, 88, 103);
    doc.setFontSize(8.5);
    const basisNote = doc.splitTextToSize(
      "Simplified flat-rate estimate, not lot-level tax accounting. Across a portfolio, gains and losses net (IRS Topic 409) and the flat rate is applied once to the netted gain. It does not model FIFO/specific identification, holding-period rates, wash sales, lot identification, carryovers, NIIT, return of capital, or jurisdiction/account-specific rules.",
      width - margin * 2,
    );
    doc.text(basisNote, margin, y, { lineHeightFactor: 1.4 });
    y += basisNote.length * 11 + 26;
  }

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
  const fees = report.input.fees;
  const assumptionLines = [
    `Reporting basis: ${report.input.taxMode === "after-tax" ? "After-tax" : "Pre-tax"}; dividend withholding: ${report.input.dividendTaxRate.toFixed(2)}%.`,
    `End treatment: ${report.input.liquidateAtEnd ? `Liquidated; capital gains tax ${report.input.capitalGainsTaxRate.toFixed(2)}% (netted once across holdings)` : "Holdings valued at final adjusted close"}.`,
    `Broker: ${fees.brokerName} (${fees.kind === "custom" ? "custom fees" : "source-backed scenario"}). Effective ${fees.effectiveDate}; checked ${fees.checkedDate}. ${fees.notes}`,
    "Broker fees are dated scenarios: the current schedule is applied to every modeled order and one order is treated as one execution. The app does not reconstruct historical broker charges; real order minimums, fractional precision, routing, spread, and slippage are not enforced.",
    fees.sources.length > 0 ? `Fee sources: ${fees.sources.map((source) => source.url).join("  ·  ")}.` : undefined,
    "Non-trading scheduled dates roll forward. Fractional shares are rounded down to 0.001 share.",
    "Dividend eligibility is measured on ex-date and ordinary dividends are reinvested on payment date at that day's high.",
    provenanceLine(report),
  ].filter((line): line is string => Boolean(line));
  doc.text(assumptionLines.flatMap((line) => doc.splitTextToSize(line, width - margin * 2)), margin, y, { lineHeightFactor: 1.45 });

  doc.addPage();
  sectionTitle(doc, `${synthetic ? "Synthetic" : "Complete"} transaction ledger (${result.transactions.length})`, 48);
  autoTable(doc, {
    startY: 64,
    margin: { left: margin, right: margin, bottom: 38 },
    showHead: "everyPage",
    head: [["Date", "Ticker", "Action", "Shares", "Price", "Gross cash", "Fee", "Tax"]],
    body: result.transactions.map((transaction) => {
      const isAdjustment = transaction.type === "portfolio-tax-adjustment";
      return [
        transaction.date,
        transaction.ticker ?? "—",
        transactionActionLabel(transaction.type),
        isAdjustment ? "—" : transaction.shares.toFixed(3),
        isAdjustment ? "—" : formatCurrency(transaction.price),
        isAdjustment ? "—" : formatCurrency(transaction.grossCash),
        formatCurrency(transaction.fee),
        formatCurrency(transaction.tax),
      ];
    }),
    ...tableTheme(7),
  });

  doc.addPage();
  sectionTitle(doc, "Methodology and limitations", 48);
  doc.setTextColor(50, 67, 80);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const paragraphs = [
    synthetic
      ? "Synthetic execution path. Dates, ticker labels, generated prices, and transactions demonstrate the calculation workflow only. They are not actual security history or performance."
      : "Historical execution. Each recurring order is moved to the next available market session when its scheduled date is not a trading day. Purchases use that day's split-adjusted high. Period-end holdings are valued at the split-adjusted close unless liquidation is enabled.",
    "Corporate actions. Prices reflect splits and reverse splits without embedding dividend reinvestment. Ordinary dividends are modeled separately. If InvestIQ detects an unsupported or unreliable company action, calculation stops instead of silently producing a result.",
    "Drawdown. Maximum drawdown uses a cash-flow-neutral portfolio unit value, so new contributions do not appear as investment performance.",
    "Future periods. Any future figures are labeled simulated estimates and remain separate from historical results. Scenarios use the security's available history beginning no earlier than 1990 and no earlier than its actual listing data. They are not predictions, forecasts, advice, or guaranteed returns.",
    "Data and fees. Market data and broker fee schedules can be delayed, incomplete, revised, or region-specific. Confirm any decision against official filings and your brokerage statement. InvestIQ is an educational research tool, not a broker, adviser, tax professional, or execution venue.",
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
      `${synthetic ? "Synthetic public-demo series · Not actual market history" : "InvestIQ DCA backtest report"}  |  Page ${pageNumber} of ${pageCount}`,
      margin,
      doc.internal.pageSize.getHeight() - 20,
    );
  }

  const tickerPart = holdings.map((item) => item.ticker).join("-").slice(0, 40) || "portfolio";
  doc.save(`investiq-dca-${synthetic ? "synthetic-" : ""}${tickerPart}-${result.endDate}.pdf`);
}

function provenanceLine(report: PortfolioReport): string {
  const provenance = report.provenance;
  if (report.source === "demo") {
    return "Data source: Synthetic public-demo series. Not actual market history.";
  }
  const coverage = (value: string) =>
    value === "cross-checked" ? "cross-checked" : value === "none-reported" ? "none reported" : value;
  return (
    `Data provenance: Yahoo split-adjusted OHLC with dividends excluded from prices; ` +
    `dividend coverage ${coverage(provenance.dividendCoverage)}, split coverage ${coverage(provenance.splitCoverage)}, ` +
    `reorganizations provider-reported only. Last completed session ${provenance.lastCompletedSession ?? "n/a"}; fetched ${provenance.fetchedAt}. ` +
    `This DCA report models dividends directly from cross-checked events; it does not use a vendor adjusted-close total-return proxy. ` +
    `Not official, real-time, or licensed institutional data; an action absent from both providers cannot be detected.`
  );
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

const FEE_COMPONENT_LABELS: Record<FeeComponentKind, string> = {
  commission: "Broker commission",
  platform: "Platform fee",
  settlement: "Settlement fee",
  "sec-31": "SEC Section 31",
  "finra-taf": "FINRA TAF",
  cat: "CAT (Consolidated Audit Trail)",
  custom: "Custom fee",
};

function feeComponentLabel(kind: FeeComponentKind): string {
  return FEE_COMPONENT_LABELS[kind];
}

function annualizedTwrLabel(twr: TimeWeightedReturn): string {
  if (!twr.annualizationEligible || twr.annualized === undefined) {
    return "Not annualized (under 1 year)";
  }
  return formatPercent(twr.annualized * 100);
}

function mwrrLabel(mwrr: MoneyWeightedReturn): string {
  if (mwrr.status === "available" && mwrr.annualizedRate !== undefined) {
    return formatPercent(mwrr.annualizedRate * 100);
  }
  if (mwrr.status === "no-external-flows") return "Unavailable (no external cash flows)";
  if (mwrr.status === "not-converged") return "Unavailable (did not converge)";
  return "Unavailable (no unique solution)";
}

function transactionActionLabel(type: TransactionType): string {
  if (type === "contribution-buy") return "Recurring buy";
  if (type === "dividend-reinvestment") return "Dividend reinvestment";
  if (type === "portfolio-tax-adjustment") return "Portfolio capital-gains tax (netted)";
  return "Final liquidation";
}
