"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioAggregateResult } from "@/types/backtest";
import { type Translate, useLanguage } from "@/i18n/language";

import styles from "./dca-backtest-dashboard.module.css";

type ChartMode = "value" | "return" | "drawdown";
type ChartRange = "ytd" | "1y" | "3y" | "all";

interface ChartDatum {
  date: string;
  value: number;
  contributed: number;
  returnPercent: number;
  drawdown: number;
}

export function PortfolioPerformanceChart({ result }: { result: PortfolioAggregateResult }) {
  const { locale, t } = useLanguage();
  const [mode, setMode] = useState<ChartMode>("value");
  const [range, setRange] = useState<ChartRange>("all");
  const data = useMemo(() => buildChartData(result, range), [result, range]);
  const rangeDays = data.length > 1
    ? (Date.parse(`${data.at(-1)!.date}T00:00:00Z`) - Date.parse(`${data[0].date}T00:00:00Z`)) / 86_400_000
    : 0;

  return (
    <div className={styles.chartShell}>
      <div className={styles.chartToolbar}>
        <div className={styles.chartTabs} aria-label={t("chart.metric")}>
          {(["value", "return", "drawdown"] as const).map((item) => (
            <button
              type="button"
              key={item}
              className={mode === item ? styles.chartTabActive : styles.chartTab}
              onClick={() => setMode(item)}
            >
              {t(item === "value" ? "chart.value" : item === "return" ? "chart.return" : "chart.drawdown")}
            </button>
          ))}
        </div>
        <div className={styles.rangeTabs} aria-label={t("chart.range")}>
          {(["ytd", "1y", "3y", "all"] as const).map((item) => (
            <button
              type="button"
              key={item}
              className={range === item ? styles.rangeActive : styles.rangeButton}
              onClick={() => setRange(item)}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chartLegend}>
        <span><i className={styles.legendCyan} />{legendForMode(mode, t)}</span>
        {mode === "value" ? <span><i className={styles.legendSlate} />{t("chart.contributedCapital")}</span> : null}
      </div>

      <div className={styles.chartCanvas} aria-label={t("chart.aria", { mode: t(mode === "value" ? "chart.value" : mode === "return" ? "chart.return" : "chart.drawdown") })}>
        {range === "all" ? (
          <div className={styles.chartEventBands} aria-hidden="true">
            <span>{t("chart.covid")}</span>
            <span>{t("chart.inflation")}</span>
          </div>
        ) : null}
        <ResponsiveContainer className={styles.chartResponsive} width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="dcaValueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#24aef2" stopOpacity={0.24} />
                <stop offset="88%" stopColor="#24aef2" stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="dcaDrawdownFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f23645" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#f23645" stopOpacity={0.32} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(120, 123, 134, 0.15)" vertical={false} />
            <XAxis
              dataKey="date"
              minTickGap={52}
              tickLine={false}
              axisLine={{ stroke: "rgba(120, 123, 134, 0.28)" }}
              tick={{ fill: "#787b86", fontSize: 10 }}
              tickFormatter={(value: string) => formatAxisDate(value, rangeDays, locale)}
            />
            <YAxis
              width={58}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#787b86", fontSize: 10 }}
              tickFormatter={(value: number) => mode === "value" ? compactCurrency(value) : `${value.toFixed(0)}%`}
            />
            <Tooltip content={<ChartTooltip mode={mode} />} cursor={{ stroke: "rgba(91, 140, 255, 0.52)", strokeDasharray: "3 4" }} />
            {mode === "value" ? (
              <>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#24aef2"
                  strokeWidth={2.25}
                  fill="url(#dcaValueFill)"
                  animationDuration={900}
                  animationEasing="ease-out"
                  activeDot={{ r: 4, fill: "#ffffff", stroke: "#24aef2", strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="contributed"
                  stroke="#8a8e99"
                  strokeWidth={1.6}
                  dot={false}
                  animationDuration={700}
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey={mode === "return" ? "returnPercent" : "drawdown"}
                stroke={mode === "return" ? "#089981" : "#f23645"}
                strokeWidth={2.1}
                fill={mode === "return" ? "url(#dcaValueFill)" : "url(#dcaDrawdownFill)"}
                animationDuration={850}
                animationEasing="ease-out"
                activeDot={{ r: 4, fill: "#f4fbff", strokeWidth: 2 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function buildChartData(result: PortfolioAggregateResult, range: ChartRange): ChartDatum[] {
  const contributions = new Map<string, number>();
  result.transactions.forEach((transaction) => {
    if (transaction.type !== "contribution-buy") return;
    contributions.set(transaction.date, (contributions.get(transaction.date) ?? 0) + transaction.grossCash);
  });

  let contributed = 0;
  let peak = 1;
  const complete = result.portfolio.map((point) => {
    contributed += contributions.get(point.date) ?? 0;
    peak = Math.max(peak, point.unitValue);
    return {
      date: point.date,
      value: point.value,
      contributed,
      returnPercent: (point.unitValue - 1) * 100,
      drawdown: ((point.unitValue - peak) / Math.max(peak, 0.000001)) * 100,
    };
  });

  const lastDate = Date.parse(`${complete.at(-1)?.date ?? result.endDate}T00:00:00Z`);
  const years = range === "1y" ? 1 : range === "3y" ? 3 : undefined;
  const lastYear = new Date(lastDate).getUTCFullYear();
  const ytdStart = Date.parse(`${lastYear}-01-01T00:00:00Z`);
  const visible = range === "ytd"
    ? complete.filter((item) => Date.parse(`${item.date}T00:00:00Z`) >= ytdStart)
    : years
      ? complete.filter((item) => Date.parse(`${item.date}T00:00:00Z`) >= lastDate - years * 365.25 * 86_400_000)
      : complete;
  const step = Math.max(1, Math.ceil(visible.length / 520));
  return visible.filter((_, index) => index % step === 0 || index === visible.length - 1);
}

function ChartTooltip({ active, payload, mode }: { active?: boolean; payload?: Array<{ payload: ChartDatum }>; mode: ChartMode }) {
  const { t } = useLanguage();
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className={styles.chartTooltip}>
      <strong>{point.date}</strong>
      {mode === "value" ? (
        <>
          <span><i className={styles.legendCyan} />{t("chart.portfolio")} {usd(point.value)}</span>
          <span><i className={styles.legendSlate} />{t("chart.contributed")} {usd(point.contributed)}</span>
        </>
      ) : (
        <span>{mode === "return" ? t("chart.cashFlowReturn") : t("chart.drawdown")} {mode === "return" ? point.returnPercent.toFixed(2) : point.drawdown.toFixed(2)}%</span>
      )}
    </div>
  );
}

function compactCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function legendForMode(mode: ChartMode, t: Translate) {
  if (mode === "return") return t("chart.cashFlowReturn");
  if (mode === "drawdown") return t("chart.peakDrawdown");
  return t("chart.portfolioValue");
}

function formatAxisDate(value: string, rangeDays: number, locale: string) {
  if (rangeDays <= 730) {
    const date = new Date(`${value}T00:00:00Z`);
    const month = date.toLocaleDateString(locale, { month: "short", timeZone: "UTC" });
    return rangeDays <= 370 ? `${month} ${date.getUTCDate()}` : `${month} '${value.slice(2, 4)}`;
  }
  return value.slice(0, 4);
}
