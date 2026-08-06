// Purpose: Deterministically renders the English public AAPL case from the same typed
// evidence and calculated view used by the bilingual web page.

import { buildAaplCaseStudy, type AaplScenarioView } from '@/domain/aapl-case-study';
import { catalogs, type TranslationKey } from '@/i18n/language';

const view = buildAaplCaseStudy();

export function renderAaplCaseStudyMarkdown(): string {
  const { source, historical, bridge, scenarios, sensitivity } = view;
  const lines: string[] = [
    `# ${t('caseStudy.title')}`,
    '',
    `**${t('caseStudy.snapshot')}:** ${source.snapshotDate} · **${t('caseStudy.caseAsOf', { date: source.caseAsOf })}**`,
    '',
    `**${t('caseStudy.educational')}**`,
    '',
    t('caseStudy.summaryText'),
    '',
    `> ${view.fundamentalsDisclaimer}`,
    '',
    '## Five-year filing evidence',
    '',
    '| Evidence | FY2025 observation | Historical reading | Ownership |',
    '| --- | ---: | --- | --- |',
    `| ${t('caseStudy.revenueTitle')} | ${compactMoney(historical.revenueLatest)} | ${percent(historical.revenueCagr)} CAGR | ${t('caseStudy.reported')} |`,
    `| ${t('caseStudy.marginTitle')} | ${percent(historical.operatingMarginLatest)} | +${points(historical.operatingMarginChange)} pp from FY2021 | ${t('caseStudy.constructed')} |`,
    `| ${t('caseStudy.fcfTitle')} | ${compactMoney(historical.freeCashFlowLatest)} | ${percent(historical.freeCashFlowCagr)} CAGR | ${t('caseStudy.constructed')} |`,
    `| ${t('caseStudy.epsTitle')} | ${price(historical.dilutedEpsLatest)} | ${percent(historical.dilutedEpsCagr)} CAGR | ${t('caseStudy.reported')} |`,
    `| ${t('caseStudy.taxTitle')} | ${percent(historical.effectiveTaxLatest)} | ${percent(historical.effectiveTaxMedian)} five-year median | ${t('caseStudy.constructed')} context; DCF input is analyst-owned |`,
    '',
    `## ${t('caseStudy.bridgeTitle')}`,
    '',
    t('caseStudy.bridgeText'),
    '',
    '| Component | Value | Evidence concept |',
    '| --- | ---: | --- |',
    `| ${t('caseStudy.commercialPaper')} | ${billionsMoney(bridge.commercialPaper)} | \`CommercialPaper\` |`,
    `| ${t('caseStudy.currentTermDebt')} | ${billionsMoney(bridge.currentTermDebt)} | \`LongTermDebtCurrent\` |`,
    `| ${t('caseStudy.currentDebt')} | ${billionsMoney(bridge.currentDebt)} | Constructed sum |`,
    `| ${t('caseStudy.noncurrentDebt')} | ${billionsMoney(bridge.noncurrentDebt)} | \`LongTermDebtNoncurrent\` |`,
    `| ${t('caseStudy.cash')} | (${billionsMoney(bridge.cashAndEquivalents)}) | \`CashAndCashEquivalentsAtCarryingValue\` |`,
    `| **${t('caseStudy.dcfNetDebt')}** | **${billionsMoney(bridge.dcfNetDebt)}** | **${t('caseStudy.bridgeFormula')}** |`,
    '',
    t('caseStudy.liquidityContext', {
      value: billionsMoney(bridge.marketableSecurities),
      perShare: price(bridge.broaderLiquidityImpactPerShare),
    }),
    '',
    `**${t('caseStudy.dilutedShares')}:** ${billionsCount(source.dilutedWeightedAverageShares.value)}  `,
    `**${t('caseStudy.pointShares')}:** ${billionsCount(pointShares())}`,
    '',
    t('caseStudy.shareText'),
    '',
    `## ${t('caseStudy.scenarioTitle')}`,
    '',
    t('caseStudy.scenarioText'),
    '',
    scenarioTable(scenarios),
    '',
    t('caseStudy.nwcNote'),
    '',
    t('caseStudy.horizonNote'),
    '',
    `## ${t('caseStudy.sensitivityTitle')}`,
    '',
    t('caseStudy.sensitivityText', { low: price(sensitivity.minimum), high: price(sensitivity.maximum) }),
    '',
    sensitivityTable(),
    '',
    `## ${t('caseStudy.thesisTitle')}`,
    '',
    ...source.thesisKeys.map((key) => `- ${t(key)}`),
    '',
    `### ${t('caseStudy.calibrationTitle')}`,
    '',
    t('caseStudy.calibrationText'),
    '',
    `## ${t('caseStudy.catalystRiskTitle')}`,
    '',
    `**${t('caseStudy.subsequentTitle')}:** ${t('caseStudy.subsequentText')}`,
    '',
    ...[...source.catalysts, ...source.risks].flatMap((item) => {
      const citation = source.citations.find((candidate) => candidate.id === item.citationId);
      return [
        `### ${t(item.titleKey)}`,
        '',
        t(item.textKey),
        '',
        `**Monitor:** ${t(item.monitorKey)}`,
        '',
        citation ? `**Official source:** [${t(citation.sectionKey)}](${citation.url})` : '',
        '',
      ];
    }),
    `## ${t('caseStudy.invalidationTitle')}`,
    '',
    ...source.invalidationKeys.map((key) => `- ${t(key)}`),
    '',
    `## ${t('caseStudy.unresolvedTitle')}`,
    '',
    ...source.unresolvedKeys.map((key) => `- ${t(key)}`),
    '',
    `## ${t('caseStudy.sourcesTitle')}`,
    '',
    t('caseStudy.sourcesText'),
    '',
    '| XBRL concept | Period end | Filing accession | Filed |',
    '| --- | --- | --- | --- |',
    ...view.sourceReceipts.map((receipt) =>
      `| [\`${receipt.concept}\`](${receipt.sourceUrl}) | ${receipt.end} | \`${receipt.accn}\` | ${receipt.filed} |`,
    ),
    '',
    'The web case is available in English and Simplified Chinese. This checked-in Markdown artifact is generated in English.',
    '',
    `## ${t('caseStudy.limitsTitle')}`,
    '',
    t('caseStudy.limitsText'),
    '',
  ];
  return lines.join('\n');
}

function scenarioTable(scenarios: AaplScenarioView[]): string {
  const row = (label: string, format: (scenario: AaplScenarioView) => string) =>
    `| ${label} | ${scenarios.map(format).join(' | ')} |`;
  return [
    `| ${t('caseStudy.assumptionOwner')} | ${scenarios.map((scenario) => t(`caseStudy.${scenario.id}` as 'caseStudy.bear' | 'caseStudy.base' | 'caseStudy.bull')).join(' | ')} |`,
    '| --- | ---: | ---: | ---: |',
    row(t('valuation.revenueGrowth'), (scenario) => rate(scenario.assumptions.revenueGrowth)),
    row(t('valuation.operatingMargin'), (scenario) => rate(scenario.assumptions.operatingMargin)),
    row(t('valuation.cashTax'), (scenario) => percent(scenario.assumptions.cashTaxRate)),
    row(t('valuation.daRevenue'), (scenario) => rate(scenario.assumptions.daPercentOfRevenue)),
    row(t('valuation.capexRevenue'), (scenario) => rate(scenario.assumptions.capexPercentOfRevenue)),
    row(t('valuation.nwcIncremental'), (scenario) => rate(scenario.assumptions.nwcPercentOfIncrementalRevenue)),
    row('WACC', (scenario) => percent(scenario.assumptions.wacc)),
    row(t('valuation.terminalGrowth'), (scenario) => percent(scenario.assumptions.terminalGrowth)),
    row(`**${t('caseStudy.scenarioOutput')}**`, (scenario) => `**${price(scenario.valuation.impliedSharePrice)}**`),
    row(t('caseStudy.terminalShare'), (scenario) => percent(scenario.valuation.terminalValuePercentOfEnterprise ?? 0)),
  ].join('\n');
}

function sensitivityTable(): string {
  const { table } = view.sensitivity;
  return [
    `| ${t('caseStudy.sensitivityAxis')} | ${table.columnAxis.values.map(percent).join(' | ')} |`,
    `| --- | ${table.columnAxis.values.map(() => '---:').join(' | ')} |`,
    ...table.cells.map((row, rowIndex) =>
      `| ${percent(table.rowAxis.values[rowIndex])} | ${row.map((cell) => cell.available ? price(cell.impliedSharePrice) : '—').join(' | ')} |`,
    ),
  ].join('\n');
}

function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
  let value: string = catalogs.en[key];
  for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

function pointShares(): number {
  return view.source.balanceSheet.find((item) => item.id === 'sharesOutstanding')?.value ?? 0;
}

function rate(value: number | readonly number[]): string {
  return percent(Array.isArray(value) ? value[0] : value as number);
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function billionsMoney(value: number): string {
  return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value / 1_000_000_000)}B`;
}

function billionsCount(value: number): string {
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value / 1_000_000_000)}B`;
}

function price(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function percent(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function points(value: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100);
}
