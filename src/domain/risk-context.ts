// Purpose: Pure decision logic behind Portfolio Lab's Risk Context panel — turns four stated
// preferences plus the measured figures of one Portfolio Lab result into an educational reading of
// that result.
//
// Scope and conventions:
// - EDUCATION ONLY. Nothing here ranks a holding, names a weight, states what to hold, or says
//   what happens next. The module emits translation codes and measured numbers; the prose behind
//   every code is held to a forbidden-word list by `risk-context.test.ts`.
// - The mode is a descriptive label for the four answers, never a risk score, a rating, or a
//   grade of the portfolio. It changes which measured figures are pointed at first and nothing
//   else: no measured figure is ever recomputed, scaled, or softened by an answer.
// - Deterministic and total: the same answers and the same measured figures always produce the
//   same reading, in the same order. No clock, no randomness, no I/O, no storage.
// - A drawdown arrives in the analytics layer's convention — a non-positive decimal fraction,
//   where -0.2 is a 20% decline — and volatility is a non-negative decimal fraction. Nothing here
//   converts to percent, rounds, or formats.
// - `volatility` is `undefined` when the measured window could not support it, never 0.
// - Contribution frequency shapes what is worth reading; it never simulates contributions.
//   Portfolio Lab measures one lump-sum allocation, and the reading says so rather than implying
//   a schedule was modelled.

import { AnalyticsError } from '@/domain/analytics';

// --- Answers ----------------------------------------------------------------

/** How long the reader says the money is meant to stay invested. */
export type RiskHorizon = 'under-3-years' | '3-to-7-years' | '8-plus-years';

/** The largest temporary decline the reader believes they could sit through. */
export type LossThresholdChoice = 'up-to-10' | 'up-to-20' | '30-or-more';

/** How often the reader says they would add money. Portfolio Lab still measures a lump sum. */
export type ContributionFrequency = 'one-time' | 'monthly' | 'quarterly';

export type InvestmentGoal = 'learn' | 'long-term-growth' | 'planned-expense';

export interface RiskContextAnswers {
  horizon: RiskHorizon;
  lossThreshold: LossThresholdChoice;
  frequency: ContributionFrequency;
  goal: InvestmentGoal;
}

/** Each loss choice as the decimal fraction the measured drawdown is compared against. */
export const LOSS_THRESHOLD_FRACTIONS: Record<LossThresholdChoice, number> = {
  'up-to-10': 0.1,
  'up-to-20': 0.2,
  '30-or-more': 0.3,
};

/**
 * Round balance the measured decline is restated on, so a percentage becomes a number of dollars.
 * An illustration of one measured figure, never a projection of a balance.
 */
export const TEMPORARY_LOSS_ILLUSTRATION_BALANCE = 10_000;

/**
 * Slack on the threshold comparison, as a decimal fraction. It absorbs binary floating-point
 * rounding only: a measured decline of exactly the selected threshold reads as inside it, and it
 * takes more than a rounding error to read as having exceeded it.
 */
export const THRESHOLD_COMPARISON_TOLERANCE = 1e-9;

// --- Mode -------------------------------------------------------------------

/**
 * A neutral name for the shape of the four answers. It describes the reader's stated situation,
 * not the portfolio and not a level of risk.
 */
export type RiskContextMode = 'loss-sensitive' | 'balanced-context' | 'long-horizon-variability';

/**
 * How far each answer moves the reading away from decline depth and toward path variability.
 * Negative pulls toward the depth of a single decline, positive toward variation over time.
 * Horizon and the stated loss threshold carry the most weight because they are the two answers
 * that say when the money is wanted and how large a dip the reader says they could sit through;
 * goal and frequency only break ties between them.
 */
export const MODE_WEIGHTS = {
  horizon: { 'under-3-years': -2, '3-to-7-years': 0, '8-plus-years': 2 },
  lossThreshold: { 'up-to-10': -2, 'up-to-20': 0, '30-or-more': 2 },
  goal: { 'planned-expense': -2, learn: 0, 'long-term-growth': 1 },
  frequency: { 'one-time': -1, quarterly: 0, monthly: 1 },
} as const;

/**
 * Inclusive cut points on the answer score. At or below `lossSensitive` the reading leads with
 * decline depth; at or above `longHorizonVariability` it leads with variability; between them it
 * gives both equal room.
 */
export const MODE_SCORE_LIMITS = { lossSensitive: -1, longHorizonVariability: 3 } as const;

/** Sums the four answer weights. Exported so the boundary between modes stays testable. */
export function scoreRiskContextAnswers(answers: RiskContextAnswers): number {
  return (
    MODE_WEIGHTS.horizon[answers.horizon] +
    MODE_WEIGHTS.lossThreshold[answers.lossThreshold] +
    MODE_WEIGHTS.goal[answers.goal] +
    MODE_WEIGHTS.frequency[answers.frequency]
  );
}

export function classifyRiskContextMode(score: number): RiskContextMode {
  if (score <= MODE_SCORE_LIMITS.lossSensitive) return 'loss-sensitive';
  if (score >= MODE_SCORE_LIMITS.longHorizonVariability) return 'long-horizon-variability';
  return 'balanced-context';
}

// --- Codes ------------------------------------------------------------------

/** Figures already on the Portfolio Lab page that the answers point at first. */
export type RiskContextMetric =
  | 'max-drawdown'
  | 'annualized-volatility'
  | 'window-length'
  | 'concentration'
  | 'benchmark-beta';

/**
 * The order focus metrics are always emitted in, so the same answers produce the same list in the
 * same sequence no matter which rule contributed a metric first.
 */
export const RISK_CONTEXT_METRIC_ORDER: readonly RiskContextMetric[] = [
  'max-drawdown',
  'annualized-volatility',
  'window-length',
  'concentration',
  'benchmark-beta',
];

/** Why those figures, stated one answer at a time. */
export type RiskContextNoteCode =
  | 'horizon-under-3'
  | 'horizon-3-to-7'
  | 'horizon-8-plus'
  | 'goal-learn'
  | 'goal-growth'
  | 'goal-expense'
  | 'frequency-one-time'
  | 'frequency-monthly'
  | 'frequency-quarterly'
  | 'contributions-not-modelled';

export type RiskContextThresholdCode = 'threshold-exceeded' | 'threshold-within';

export type RiskContextVolatilityCode = 'volatility-measured' | 'volatility-unavailable';

/** What this reading cannot see. Always emitted in full; never conditional on the answers. */
export type RiskContextLimitationCode =
  | 'past-not-forecast'
  | 'no-personal-finances'
  | 'education-only';

export const RISK_CONTEXT_LIMITATIONS: readonly RiskContextLimitationCode[] = [
  'past-not-forecast',
  'no-personal-finances',
  'education-only',
];

const HORIZON_NOTES: Record<RiskHorizon, RiskContextNoteCode> = {
  'under-3-years': 'horizon-under-3',
  '3-to-7-years': 'horizon-3-to-7',
  '8-plus-years': 'horizon-8-plus',
};

const GOAL_NOTES: Record<InvestmentGoal, RiskContextNoteCode> = {
  learn: 'goal-learn',
  'long-term-growth': 'goal-growth',
  'planned-expense': 'goal-expense',
};

const FREQUENCY_NOTES: Record<ContributionFrequency, RiskContextNoteCode> = {
  'one-time': 'frequency-one-time',
  monthly: 'frequency-monthly',
  quarterly: 'frequency-quarterly',
};

/** Which figures each answer puts first. Order inside a rule does not matter; the canonical
 *  metric order is applied afterwards. */
const HORIZON_METRICS: Record<RiskHorizon, readonly RiskContextMetric[]> = {
  'under-3-years': ['max-drawdown', 'window-length'],
  '3-to-7-years': ['max-drawdown', 'annualized-volatility'],
  '8-plus-years': ['annualized-volatility', 'concentration'],
};

const GOAL_METRICS: Record<InvestmentGoal, readonly RiskContextMetric[]> = {
  learn: ['window-length'],
  'long-term-growth': ['concentration', 'benchmark-beta'],
  'planned-expense': ['max-drawdown'],
};

const FREQUENCY_METRICS: Record<ContributionFrequency, readonly RiskContextMetric[]> = {
  'one-time': ['max-drawdown'],
  monthly: ['annualized-volatility'],
  quarterly: ['annualized-volatility'],
};

/**
 * The figures the answers point at, deduplicated and returned in `RISK_CONTEXT_METRIC_ORDER`.
 * Every answer set contributes at least two metrics, so the list is never empty.
 */
export function riskContextFocusMetrics(answers: RiskContextAnswers): RiskContextMetric[] {
  const selected = new Set<RiskContextMetric>([
    ...HORIZON_METRICS[answers.horizon],
    ...GOAL_METRICS[answers.goal],
    ...FREQUENCY_METRICS[answers.frequency],
  ]);
  return RISK_CONTEXT_METRIC_ORDER.filter((metric) => selected.has(metric));
}

// --- Reading ----------------------------------------------------------------

/** What the measured window supplies. Read straight from a `PortfolioLabViewModel`. */
export interface RiskContextMeasurement {
  /** Worst close-to-close decline in portfolio value, as a non-positive fraction. */
  maxDrawdown: number;
  /** Annualized volatility of the portfolio's daily returns; omitted when unmeasurable. */
  volatility?: number;
}

export interface RiskContextRequest {
  answers: RiskContextAnswers;
  measurement: RiskContextMeasurement;
}

/** The measured decline restated in dollars on a round balance. */
export interface TemporaryLossIllustration {
  balance: number;
  /** `balance * |maxDrawdown|`: what that same decline would have been on that balance. */
  loss: number;
}

export interface RiskContextReading {
  /** Descriptive name for the four answers. Not a score and not a rating. */
  mode: RiskContextMode;
  /** The summed answer weights the mode came from, so the label is auditable. */
  modeScore: number;
  /** The selected threshold as a decimal fraction. */
  lossThreshold: number;
  /** The measured drawdown, echoed unchanged in the analytics layer's sign convention. */
  measuredDrawdown: number;
  /** The same decline as a positive magnitude, which is what the threshold compares against. */
  drawdownMagnitude: number;
  exceedsThreshold: boolean;
  thresholdCode: RiskContextThresholdCode;
  illustration: TemporaryLossIllustration;
  /** Echoed unchanged; absent exactly when the measurement had none. */
  volatility?: number;
  volatilityCode: RiskContextVolatilityCode;
  /** Figures to read first, in canonical order; never empty. */
  focusMetrics: RiskContextMetric[];
  /** One note per answer, in answer order: horizon, goal, frequency, then the lump-sum caveat. */
  notes: RiskContextNoteCode[];
  limitations: readonly RiskContextLimitationCode[];
  /** Always true: this reading is educational context and is not investment advice. */
  educationalOnly: true;
}

/**
 * Builds the Risk Context reading for one Portfolio Lab result.
 *
 * Throws `AnalyticsError` when `maxDrawdown` is not a finite fraction in [-1, 0], or when a
 * supplied `volatility` is not a finite number at or above zero. Nothing is inferred from a bad
 * figure and nothing is clamped: a measurement that cannot be read is refused.
 */
export function buildRiskContext(request: RiskContextRequest): RiskContextReading {
  const { answers, measurement } = request;
  validateMeasurement(measurement);

  const modeScore = scoreRiskContextAnswers(answers);
  const lossThreshold = LOSS_THRESHOLD_FRACTIONS[answers.lossThreshold];
  const drawdownMagnitude = Math.abs(measurement.maxDrawdown);
  const exceedsThreshold = drawdownMagnitude > lossThreshold + THRESHOLD_COMPARISON_TOLERANCE;

  const notes: RiskContextNoteCode[] = [
    HORIZON_NOTES[answers.horizon],
    GOAL_NOTES[answers.goal],
    FREQUENCY_NOTES[answers.frequency],
  ];
  // Only a reader who said they would add money repeatedly needs telling that the schedule was
  // not simulated; for a one-time contribution the lump sum is what was measured.
  if (answers.frequency !== 'one-time') notes.push('contributions-not-modelled');

  return {
    mode: classifyRiskContextMode(modeScore),
    modeScore,
    lossThreshold,
    measuredDrawdown: measurement.maxDrawdown,
    drawdownMagnitude,
    exceedsThreshold,
    thresholdCode: exceedsThreshold ? 'threshold-exceeded' : 'threshold-within',
    illustration: {
      balance: TEMPORARY_LOSS_ILLUSTRATION_BALANCE,
      loss: TEMPORARY_LOSS_ILLUSTRATION_BALANCE * drawdownMagnitude,
    },
    volatility: measurement.volatility,
    volatilityCode:
      measurement.volatility === undefined ? 'volatility-unavailable' : 'volatility-measured',
    focusMetrics: riskContextFocusMetrics(answers),
    notes,
    limitations: RISK_CONTEXT_LIMITATIONS,
    educationalOnly: true,
  };
}

function validateMeasurement(measurement: RiskContextMeasurement): void {
  const { maxDrawdown, volatility } = measurement;
  if (!Number.isFinite(maxDrawdown) || maxDrawdown > 0 || maxDrawdown < -1) {
    throw new AnalyticsError(
      `A measured drawdown must be a finite fraction between -1 and 0; received ${maxDrawdown}.`,
    );
  }
  if (volatility !== undefined && (!Number.isFinite(volatility) || volatility < 0)) {
    throw new AnalyticsError(
      `Measured volatility must be a finite number at or above zero; received ${volatility}.`,
    );
  }
}
