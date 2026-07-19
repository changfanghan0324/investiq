import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";

import styles from "./methodology.module.css";

export const metadata: Metadata = {
  title: "How Stock Lens calculates results",
  description: "The execution, dividend, return, drawdown, fee, tax, and simulation rules used by Stock Lens.",
};

const rules = [
  {
    icon: CalendarDays,
    title: "Order timing",
    text: "Each scheduled contribution is matched to an actual US trading session. If the scheduled date is closed, the order moves to the next available session.",
    detail: "Execution price = that session’s split-adjusted daily high",
  },
  {
    icon: RefreshCw,
    title: "Recurring purchases",
    text: "Cash orders purchase as many fractional shares as the available cash can fund after the selected broker fee. Share orders buy the exact requested quantity to three decimal places.",
    detail: "Shares added = investable cash ÷ execution price",
  },
  {
    icon: CircleDollarSign,
    title: "Dividends",
    text: "Eligible shares are recorded on the ex-dividend date. Ordinary dividends are received on the payment date, reduced by withholding tax when Aftertax is selected, then reinvested at that day’s adjusted high.",
    detail: "Net dividend = gross dividend − withholding tax − reinvestment fee",
  },
  {
    icon: Landmark,
    title: "Fees and taxes",
    text: "The selected broker plan is applied to every purchase, dividend reinvestment, and optional final sale. Capital-gains tax is only applied when the portfolio is liquidated and Aftertax reporting is selected.",
    detail: "Every fee and tax remains visible in Return breakdown",
  },
  {
    icon: TrendingDown,
    title: "Return and drawdown",
    text: "Contributions are not counted as investment performance. Stock Lens maintains a cash-flow-neutral unit value so new deposits do not create artificial gains or hide losses.",
    detail: "Drawdown = (current unit value − prior peak) ÷ prior peak",
  },
  {
    icon: ShieldCheck,
    title: "Company-action safety stop",
    text: "Split-adjusted OHLC and verified splits are supported. If a merger, spin-off, exchange, special distribution, right, warrant, or another event cannot be handled reliably, calculation stops instead of estimating through it.",
    detail: "Unsupported company action = no result is displayed",
  },
];

export default function MethodologyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Return to Stock Lens portfolio lab">
          <span className={styles.brandMark}><i /><b /></span>
          <strong>STOCK LENS</strong>
        </Link>
        <Link className={styles.backLink} href="/"><ArrowLeft size={15} /> Portfolio Lab</Link>
      </header>

      <article className={styles.content}>
        <header className={styles.intro}>
          <h1>How Stock Lens calculates your backtest</h1>
          <p>This page documents the rules that directly change the numbers. The normal Portfolio Lab stays focused on building and reviewing a backtest.</p>
        </header>

        <section className={styles.ruleList} aria-label="Calculation rules">
          {rules.map((rule, index) => {
            const Icon = rule.icon;
            return (
              <article className={styles.rule} key={rule.title}>
                <div className={styles.ruleNumber}>{String(index + 1).padStart(2, "0")}</div>
                <div className={styles.ruleIcon}><Icon size={19} /></div>
                <div>
                  <h2>{rule.title}</h2>
                  <p>{rule.text}</p>
                  <code>{rule.detail}</code>
                </div>
              </article>
            );
          })}
        </section>

        <section className={styles.simulation}>
          <div>
            <h2>Future dates are simulated estimates</h2>
            <p>Future scenarios use the selected security’s available history, beginning no earlier than 1990 and never before its actual listing history. Historical results and simulated estimates remain separate throughout the interface and PDF.</p>
          </div>
          <strong>Not a forecast. Not guaranteed performance.</strong>
        </section>
      </article>
    </main>
  );
}
