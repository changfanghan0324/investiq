// Purpose: the single mapping from every code `@/domain/risk-context` can emit to the catalog
// string the reader sees, plus the option lists the four controls render.
//
// It lives beside the catalog rather than inside the component so that the mapping is typed
// against `TranslationKey` — a code with no catalog string is a type error — and so that the
// forbidden-advice tests can read the mapping without importing a client component.

import type {
  ContributionFrequency,
  InvestmentGoal,
  LossThresholdChoice,
  RiskContextLimitationCode,
  RiskContextMetric,
  RiskContextMode,
  RiskContextNoteCode,
  RiskContextThresholdCode,
  RiskContextVolatilityCode,
  RiskHorizon,
} from '@/domain/risk-context';
import type { TranslationKey } from '@/i18n/language';

/** Prefix every Risk Context string shares, so the catalog block can be checked as a whole. */
export const RISK_CONTEXT_KEY_PREFIX = 'riskContext.';

export interface RiskContextOption<Value extends string> {
  value: Value;
  labelKey: TranslationKey;
}

export const HORIZON_OPTIONS: ReadonlyArray<RiskContextOption<RiskHorizon>> = [
  { value: 'under-3-years', labelKey: 'riskContext.horizonUnder3' },
  { value: '3-to-7-years', labelKey: 'riskContext.horizon3to7' },
  { value: '8-plus-years', labelKey: 'riskContext.horizon8plus' },
];

export const LOSS_THRESHOLD_OPTIONS: ReadonlyArray<RiskContextOption<LossThresholdChoice>> = [
  { value: 'up-to-10', labelKey: 'riskContext.lossUpTo10' },
  { value: 'up-to-20', labelKey: 'riskContext.lossUpTo20' },
  { value: '30-or-more', labelKey: 'riskContext.loss30Plus' },
];

export const FREQUENCY_OPTIONS: ReadonlyArray<RiskContextOption<ContributionFrequency>> = [
  { value: 'one-time', labelKey: 'riskContext.frequencyOneTime' },
  { value: 'monthly', labelKey: 'riskContext.frequencyMonthly' },
  { value: 'quarterly', labelKey: 'riskContext.frequencyQuarterly' },
];

export const GOAL_OPTIONS: ReadonlyArray<RiskContextOption<InvestmentGoal>> = [
  { value: 'learn', labelKey: 'riskContext.goalLearn' },
  { value: 'long-term-growth', labelKey: 'riskContext.goalGrowth' },
  { value: 'planned-expense', labelKey: 'riskContext.goalExpense' },
];

export const MODE_LABEL_KEYS: Record<RiskContextMode, TranslationKey> = {
  'loss-sensitive': 'riskContext.modeLossSensitive',
  'balanced-context': 'riskContext.modeBalanced',
  'long-horizon-variability': 'riskContext.modeLongHorizon',
};

export const MODE_DETAIL_KEYS: Record<RiskContextMode, TranslationKey> = {
  'loss-sensitive': 'riskContext.modeLossSensitiveDetail',
  'balanced-context': 'riskContext.modeBalancedDetail',
  'long-horizon-variability': 'riskContext.modeLongHorizonDetail',
};

export const THRESHOLD_KEYS: Record<RiskContextThresholdCode, TranslationKey> = {
  'threshold-exceeded': 'riskContext.thresholdExceeded',
  'threshold-within': 'riskContext.thresholdWithin',
};

export const VOLATILITY_KEYS: Record<RiskContextVolatilityCode, TranslationKey> = {
  'volatility-measured': 'riskContext.volatilityMeasured',
  'volatility-unavailable': 'riskContext.volatilityUnavailable',
};

export const METRIC_KEYS: Record<RiskContextMetric, TranslationKey> = {
  'max-drawdown': 'riskContext.metricMaxDrawdown',
  'annualized-volatility': 'riskContext.metricVolatility',
  'window-length': 'riskContext.metricWindow',
  concentration: 'riskContext.metricConcentration',
  'benchmark-beta': 'riskContext.metricBeta',
};

export const NOTE_KEYS: Record<RiskContextNoteCode, TranslationKey> = {
  'horizon-under-3': 'riskContext.noteHorizonUnder3',
  'horizon-3-to-7': 'riskContext.noteHorizon3to7',
  'horizon-8-plus': 'riskContext.noteHorizon8plus',
  'goal-learn': 'riskContext.noteGoalLearn',
  'goal-growth': 'riskContext.noteGoalGrowth',
  'goal-expense': 'riskContext.noteGoalExpense',
  'frequency-one-time': 'riskContext.noteFrequencyOneTime',
  'frequency-monthly': 'riskContext.noteFrequencyMonthly',
  'frequency-quarterly': 'riskContext.noteFrequencyQuarterly',
  'contributions-not-modelled': 'riskContext.noteContributionsNotModelled',
};

export const LIMITATION_KEYS: Record<RiskContextLimitationCode, TranslationKey> = {
  'past-not-forecast': 'riskContext.limitNotForecast',
  'no-personal-finances': 'riskContext.limitNoPersonalFinances',
  'education-only': 'riskContext.limitEducationOnly',
};
