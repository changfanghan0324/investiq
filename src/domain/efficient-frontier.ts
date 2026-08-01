// Purpose: Pure, deterministic, long-only HISTORICAL (in-sample) efficient-frontier engine.
//
// Scope and conventions:
// - This is a backward-looking, descriptive study of the return series it is handed, NOT a forecast,
//   an optimizer of the future, or a recommendation. Every figure is measured on the aligned window
//   the caller supplied; nothing here predicts, extrapolates, ridge-shrinks, or randomly samples.
// - Sample arithmetic means and sample (÷ N-1) covariance are NOISY estimates of unknown quantities.
//   Mean estimates in particular are so imprecise over ordinary sample lengths that the exact shape
//   of a historical frontier — and especially which asset sits at the high-return corner — is largely
//   estimation error, not signal. Read this as "what minimized realized variance for each realized
//   target return over this window", never as "what to hold".
// - Every return, mean, and weight is a decimal fraction (0.01 is +1%, 0.25 is a 25% weight).
//   Nothing in this module converts to percent, rounds for display, or formats.
// - Every function is deterministic: no clock, no randomness, no I/O, no dependencies. The same input
//   always yields the byte-identical output.
// - Weights are long-only and fully invested: every weight is ≥ 0 and the set sums to 1.
// - `AnalyticsError` is thrown for unusable input; a frontier is never fabricated from data that
//   cannot support the covariance/mean math.

import {
  AnalyticsError,
  globalMinimumVarianceWeights,
  MIN_RISK_OBSERVATIONS,
  TRADING_DAYS_PER_YEAR,
} from '@/domain/analytics';
import type { DatedValue, ReturnSeries } from '@/domain/analytics';
import type { DateString } from '@/types/backtest';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Fewest return series the frontier accepts; a frontier of one asset is a single point, not a curve. */
export const EFFICIENT_FRONTIER_MIN_SERIES = 2;

/**
 * Most return series the frontier accepts. The exact subset solver enumerates every non-empty active
 * subset (up to 2^n − 1), so this ceiling of 10 caps that at 1023 subsets per target and keeps the
 * whole sweep small, auditable, and fast.
 */
export const EFFICIENT_FRONTIER_MAX_SERIES = 10;

/**
 * Fewest inner-aligned daily observations before a frontier is computed at all. Shares the module-wide
 * statistical floor (`MIN_RISK_OBSERVATIONS`, 60 ≈ a quarter trading year): a covariance from a
 * handful of overlapping days would mislead more than it informs.
 */
export const EFFICIENT_FRONTIER_MIN_OBSERVATIONS = MIN_RISK_OBSERVATIONS;

/** Default number of frontier points swept across the target-return range. */
export const DEFAULT_FRONTIER_POINT_COUNT = 21;

/** Fewest and most frontier points the sweep will produce. */
export const MIN_FRONTIER_POINT_COUNT = 5;
export const MAX_FRONTIER_POINT_COUNT = 51;

/**
 * A weight is accepted as long-only when it is at least this far below zero (a tiny negative from
 * floating-point round-off is clamped to exactly 0; anything more negative rejects the subset).
 */
const FEASIBILITY_TOLERANCE = 1e-9;

/** How far a solved subset may miss the sum-to-one and target-mean constraints before it is rejected. */
const CONSTRAINT_TOLERANCE = 1e-8;

/**
 * Pivot magnitude at or below which the Gaussian elimination treats a system as singular. A subset
 * whose asset means are all equal makes the two equality constraints linearly dependent and collapses
 * a pivot to ~0; such subsets are skipped, never solved into arbitrary weights.
 */
const SINGULAR_PIVOT_TOLERANCE = 1e-12;

/** One holding's weight in a single frontier point, aligned to {@link EfficientFrontier.symbols}. */
export interface FrontierWeight {
  symbol: string;
  /** Long-only fraction of the portfolio in this holding; ≥ 0, and the point's weights sum to 1. */
  weight: number;
}

/**
 * One point on the historical frontier: the minimum-variance long-only fully-invested portfolio whose
 * in-sample daily mean return equals `targetDailyMean`, over the aligned window.
 */
export interface FrontierPoint {
  /** The swept target: the portfolio's in-sample daily mean return, a decimal fraction. */
  targetDailyMean: number;
  /** Arithmetic annualization of the target daily mean: `targetDailyMean · 252`. Not compounded. */
  annualizedReturn: number;
  /** In-sample daily variance of the portfolio, wᵀΣw on the sample covariance. */
  dailyVariance: number;
  /** Annualized volatility: `sqrt(dailyVariance · 252)`. */
  annualizedVolatility: number;
  /** The minimizing weights, aligned to `symbols` order; long-only and summing to 1. */
  weights: FrontierWeight[];
}

/**
 * A historical, in-sample long-only efficient frontier. See the module and
 * {@link computeEfficientFrontier} JSDoc for the emphatic caveat that this is descriptive analysis of
 * noisy sample statistics, not a forecast or a recommendation.
 */
export interface EfficientFrontier {
  /** Names the method so a view never mislabels it as forward-looking optimization. */
  method: 'historical-efficient-frontier';
  /** Holding symbols, in input order; every point's weights are aligned to this order. */
  symbols: string[];
  /** Inner-aligned daily observations, present in EVERY series, behind the means and covariance. */
  observations: number;
  /** Sample arithmetic mean daily return of each series, aligned to `symbols`. */
  meanDailyReturns: number[];
  /** In-sample daily mean of the long-only global minimum-variance portfolio. */
  minimumVarianceDailyMean: number;
  /** Efficient upper branch from the GMV mean to the highest individual sample mean. */
  points: FrontierPoint[];
}

/**
 * Computes a deterministic, long-only, HISTORICAL (in-sample) efficient frontier from aligned daily
 * return series.
 *
 * Method, stated exactly:
 * - Alignment: the series are inner-joined on date (a date survives only when EVERY series carries
 *   it), so a holiday or a shorter listing history never pairs mismatched days or imputes a return.
 * - Estimates: per-asset sample ARITHMETIC means and the n×n SAMPLE covariance matrix (÷ N-1), the
 *   same Bessel-corrected estimator the rest of the analytics module uses. Both are noisy; see below.
 * - Target sweep: `pointCount` targets are spaced evenly and deterministically from the long-only
 *   global-minimum-variance portfolio's sample mean to the maximum individual sample mean, inclusive.
 *   The dominated lower branch is excluded, so the result is the efficient upper branch rather than
 *   the full minimum-variance locus.
 * - Exact subset solver: for each target, every non-empty active subset of assets (up to 2^n − 1) is
 *   considered. For a subset it solves the equality-constrained minimum-variance problem
 *   `min wᵀΣ_S w  s.t.  Σw = 1 and μ_Sᵀw = target` via the KKT linear system with stable Gaussian
 *   elimination (partial pivoting). When all means in a subset are equal and match the target, the
 *   redundant mean constraint is removed and the sum-only minimum-variance KKT system is solved;
 *   other singular subsets are skipped. A solution is accepted only when every weight is ≥ 0 within tolerance
 *   (tiny negatives clamped to 0) and both constraints hold within tolerance; the zeroed-out assets
 *   expand the subset weights back to a full long-only vector. Among all accepted candidates the one
 *   with the minimum in-sample variance is chosen, with a deterministic tie-break (fewer active
 *   assets, then lower subset index).
 * - Endpoints: the first point is the long-only GMV portfolio and the last point is the minimum-
 *   variance long-only portfolio that achieves the highest sample mean. When several assets tie at
 *   that mean, the endpoint may diversify among them. Both endpoints use the same subset enumeration.
 * - Each point reports the target daily mean, its arithmetic annualization `target · 252`, the daily
 *   variance wᵀΣw, and the annualized volatility `sqrt(variance · 252)`.
 *
 * Explicitly NOT done: no ridge/shrinkage of the covariance, no random or Monte-Carlo sampling, no
 * extrapolation beyond the observed mean range, no expected-return model, and no external dependency.
 *
 * Rejections — a frontier is never fabricated from unusable data. Throws {@link AnalyticsError} for:
 * fewer than {@link EFFICIENT_FRONTIER_MIN_SERIES} or more than {@link EFFICIENT_FRONTIER_MAX_SERIES}
 * series; duplicate symbols; a non-integer `pointCount` outside
 * [{@link MIN_FRONTIER_POINT_COUNT}, {@link MAX_FRONTIER_POINT_COUNT}]; a return series with a non-ISO
 * date, a duplicate date, or a non-finite value; fewer than {@link EFFICIENT_FRONTIER_MIN_OBSERVATIONS}
 * inner-aligned observations (a short or misaligned window); a sample covariance matrix that is not
 * positive definite (a flat/zero-variance series, perfectly correlated series, or otherwise singular
 * — the frontier is then not unique); or any target for which no long-only feasible portfolio exists
 * beyond numerical tolerance.
 *
 * Interpretation caveat (repeated because it matters): sample means and covariance are NOISY estimates
 * of unknown quantities, and mean estimates are especially imprecise. This is a backward-looking,
 * educational description of what minimized realized variance for each realized target return over the
 * supplied window. It is NOT a forecast, NOT predictive, and NOT investment advice.
 */
export function computeEfficientFrontier(
  series: ReturnSeries[],
  pointCount: number = DEFAULT_FRONTIER_POINT_COUNT,
): EfficientFrontier {
  if (series.length < EFFICIENT_FRONTIER_MIN_SERIES || series.length > EFFICIENT_FRONTIER_MAX_SERIES) {
    throw new AnalyticsError(
      `An efficient frontier needs between ${EFFICIENT_FRONTIER_MIN_SERIES} and ` +
        `${EFFICIENT_FRONTIER_MAX_SERIES} return series; received ${series.length}.`,
    );
  }

  if (!Number.isInteger(pointCount) || pointCount < MIN_FRONTIER_POINT_COUNT || pointCount > MAX_FRONTIER_POINT_COUNT) {
    throw new AnalyticsError(
      `The frontier point count must be an integer between ${MIN_FRONTIER_POINT_COUNT} and ` +
        `${MAX_FRONTIER_POINT_COUNT}; received ${pointCount}.`,
    );
  }

  const seen = new Set<string>();
  for (const entry of series) {
    const symbol = entry.symbol.trim().toUpperCase();
    if (!symbol) throw new AnalyticsError('Every efficient-frontier series needs a symbol.');
    if (seen.has(symbol)) {
      throw new AnalyticsError(`Return series ${symbol} appears more than once.`);
    }
    seen.add(symbol);
    validateReturnSeries(entry.returns, entry.symbol);
  }

  const columns = alignReturnColumns(series.map((entry) => entry.returns));
  const observations = columns.length === 0 ? 0 : columns[0].length;
  if (observations < EFFICIENT_FRONTIER_MIN_OBSERVATIONS) {
    throw new AnalyticsError(
      `An efficient frontier needs at least ${EFFICIENT_FRONTIER_MIN_OBSERVATIONS} inner-aligned ` +
        `observations across every series; only ${observations} dates overlap.`,
    );
  }

  const meanDailyReturns = columns.map((column) => mean(column));
  const covariance = sampleCovarianceMatrix(columns);
  if (!isPositiveDefinite(covariance)) {
    throw new AnalyticsError(
      'The sample covariance matrix is singular or not positive definite (a flat/zero-variance ' +
        'series, perfectly correlated series, or too few observations), so the frontier is not ' +
        'unique; the efficient frontier is rejected.',
    );
  }

  const minimumVariance = globalMinimumVarianceWeights(series);
  const minimumVarianceDailyMean = minimumVariance.weights.reduce(
    (total, entry, index) => total + entry.weight * meanDailyReturns[index],
    0,
  );
  const maxMean = Math.max(...meanDailyReturns);
  if (!(maxMean > minimumVarianceDailyMean + CONSTRAINT_TOLERANCE)) {
    throw new AnalyticsError(
      'The sample means do not provide a distinct efficient return range above the minimum-variance portfolio.',
    );
  }

  const points: FrontierPoint[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    // Even, deterministic sweep with exact endpoints GMV mean (index 0) and max mean (last index).
    const target =
      pointCount === 1
        ? minimumVarianceDailyMean
        : minimumVarianceDailyMean + ((maxMean - minimumVarianceDailyMean) * index) / (pointCount - 1);

    const best = minimumVarianceForTarget(covariance, meanDailyReturns, target);
    if (best === null) {
      throw new AnalyticsError(
        `No long-only feasible portfolio reaches the target daily mean ${target}; the efficient ` +
          'frontier is rejected.',
      );
    }

    points.push({
      targetDailyMean: target,
      annualizedReturn: target * TRADING_DAYS_PER_YEAR,
      dailyVariance: best.variance,
      annualizedVolatility: Math.sqrt(Math.max(0, best.variance) * TRADING_DAYS_PER_YEAR),
      weights: series.map((entry, assetIndex) => ({
        symbol: entry.symbol,
        weight: best.weights[assetIndex],
      })),
    });
  }

  return {
    method: 'historical-efficient-frontier',
    symbols: series.map((entry) => entry.symbol.trim().toUpperCase()),
    observations,
    meanDailyReturns,
    minimumVarianceDailyMean,
    points,
  };
}

// --- Solver -----------------------------------------------------------------

interface FrontierCandidate {
  /** Bitmask of active assets, used only for the deterministic tie-break. */
  mask: number;
  activeCount: number;
  variance: number;
  weights: number[];
}

/**
 * Minimum-variance long-only fully-invested portfolio whose sample mean equals `target`, found by
 * enumerating every non-empty active subset and keeping the lowest-variance feasible candidate.
 * Returns null when no subset yields a non-negative feasible solution for this target.
 */
function minimumVarianceForTarget(
  covariance: number[][],
  means: number[],
  target: number,
): FrontierCandidate | null {
  const n = means.length;
  let best: FrontierCandidate | null = null;

  for (let mask = 1; mask < 1 << n; mask += 1) {
    const active: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) active.push(i);
    }

    // A non-negative convex combination of a subset can only land inside the subset's mean range;
    // skip subsets that cannot possibly reach the target before solving.
    let subMin = Infinity;
    let subMax = -Infinity;
    for (const i of active) {
      if (means[i] < subMin) subMin = means[i];
      if (means[i] > subMax) subMax = means[i];
    }
    if (target < subMin - CONSTRAINT_TOLERANCE || target > subMax + CONSTRAINT_TOLERANCE) continue;

    const subCovariance = active.map((i) => active.map((j) => covariance[i][j]));
    const subMeans = active.map((i) => means[i]);
    const subWeights = solveEqualityMinimumVariance(subCovariance, subMeans, target);
    if (subWeights === null) continue; // singular subset (dependent constraints).

    // Accept only non-negative, fully-invested, on-target solutions; clamp round-off negatives to 0.
    let feasible = true;
    let weightSum = 0;
    let meanReached = 0;
    for (let s = 0; s < subWeights.length; s += 1) {
      if (subWeights[s] < -FEASIBILITY_TOLERANCE) {
        feasible = false;
        break;
      }
      const clamped = subWeights[s] < 0 ? 0 : subWeights[s];
      subWeights[s] = clamped;
      weightSum += clamped;
      meanReached += clamped * subMeans[s];
    }
    if (!feasible) continue;
    if (Math.abs(weightSum - 1) > CONSTRAINT_TOLERANCE) continue;
    if (Math.abs(meanReached - target) > CONSTRAINT_TOLERANCE) continue;

    const weights = new Array<number>(n).fill(0);
    active.forEach((assetIndex, s) => {
      weights[assetIndex] = subWeights[s];
    });
    const variance = quadraticForm(covariance, weights);

    const candidate: FrontierCandidate = {
      mask,
      activeCount: active.length,
      variance,
      weights,
    };
    if (best === null || isBetterCandidate(candidate, best)) best = candidate;
  }

  return best;
}

/** True when candidate `a` should be preferred over `b`: lower variance, then sparser, then lower mask. */
function isBetterCandidate(a: FrontierCandidate, b: FrontierCandidate): boolean {
  if (!approximatelyEqual(a.variance, b.variance)) return a.variance < b.variance;
  if (a.activeCount !== b.activeCount) return a.activeCount < b.activeCount;
  return a.mask < b.mask;
}

/**
 * Solves `min wᵀΣw s.t. Σw = 1 and μᵀw = target` for one subset via its KKT linear system
 *
 *   [ 2Σ  Aᵀ ] [w]   [0]
 *   [ A   0  ] [λ] = [b],   A = [1…1; μ₁…μ_k],  b = [1; target]
 *
 * with stable Gaussian elimination (partial pivoting). Returns the subset weights, or null when the
 * system is singular (e.g. all subset means equal, making the two constraints dependent).
 */
function solveEqualityMinimumVariance(
  covariance: number[][],
  means: number[],
  target: number,
): number[] | null {
  const meanRange = Math.max(...means) - Math.min(...means);
  if (meanRange <= CONSTRAINT_TOLERANCE) {
    if (Math.abs(means[0] - target) > CONSTRAINT_TOLERANCE) return null;
    return solveSumOnlyMinimumVariance(covariance);
  }
  const k = means.length;
  const dim = k + 2;
  const matrix = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const rhs = new Array<number>(dim).fill(0);

  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) matrix[i][j] = 2 * covariance[i][j];
    matrix[i][k] = 1; // sum-to-one column of Aᵀ
    matrix[i][k + 1] = means[i]; // target-mean column of Aᵀ
    matrix[k][i] = 1; // sum-to-one row of A
    matrix[k + 1][i] = means[i]; // target-mean row of A
  }
  rhs[k] = 1;
  rhs[k + 1] = target;

  const solution = solveLinearSystem(matrix, rhs);
  if (solution === null) return null;
  return solution.slice(0, k);
}

/** Minimum variance with only the fully-invested equality, used when active assets share one mean. */
function solveSumOnlyMinimumVariance(covariance: number[][]): number[] | null {
  const k = covariance.length;
  const dim = k + 1;
  const matrix = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const rhs = new Array<number>(dim).fill(0);
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) matrix[i][j] = 2 * covariance[i][j];
    matrix[i][k] = 1;
    matrix[k][i] = 1;
  }
  rhs[k] = 1;
  const solution = solveLinearSystem(matrix, rhs);
  return solution?.slice(0, k) ?? null;
}

/**
 * Solves a square linear system Ax = b by Gaussian elimination with partial pivoting. Returns null
 * when a pivot is at or below {@link SINGULAR_PIVOT_TOLERANCE}, i.e. the matrix is (numerically)
 * singular. Operates on copies, so the inputs are never mutated.
 */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const augmented = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let pivotMagnitude = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const magnitude = Math.abs(augmented[row][col]);
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude;
        pivotRow = row;
      }
    }
    if (pivotMagnitude <= SINGULAR_PIVOT_TOLERANCE) return null;

    if (pivotRow !== col) {
      const swap = augmented[col];
      augmented[col] = augmented[pivotRow];
      augmented[pivotRow] = swap;
    }

    const pivot = augmented[col][col];
    for (let row = col + 1; row < n; row += 1) {
      const factor = augmented[row][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) augmented[row][c] -= factor * augmented[col][c];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = augmented[i][n];
    for (let c = i + 1; c < n; c += 1) sum -= augmented[i][c] * x[c];
    x[i] = sum / augmented[i][i];
  }
  return x;
}

// --- Statistics and matrix helpers ------------------------------------------

/**
 * Inner-joins several dated return series on date, returning one aligned column of values per series
 * in input order. A date survives only when EVERY series carries it, so no column is ever padded with
 * an imputed return. Columns are ordered by date so the covariance is reproducible.
 */
function alignReturnColumns(seriesReturns: DatedValue[][]): number[][] {
  if (seriesReturns.length === 0) return [];

  const maps = seriesReturns.map((points) => new Map(points.map((point) => [point.date, point.value])));
  const sharedDates = [...new Set(seriesReturns[0].map((point) => point.date))]
    .filter((date) => maps.every((byDate) => byDate.has(date)))
    .sort((left, right) => left.localeCompare(right));

  return maps.map((byDate) => sharedDates.map((date) => byDate.get(date) as number));
}

/** Symmetric sample covariance matrix of aligned columns, using the Bessel-corrected ÷(N-1) estimator. */
function sampleCovarianceMatrix(columns: number[][]): number[][] {
  const n = columns.length;
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const value = sampleCovariance(columns[i], columns[j]);
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  return matrix;
}

/**
 * Tests positive-definiteness by attempting a Cholesky factorization: a non-positive pivot means the
 * matrix is singular or indefinite. The pivot threshold is relative to the largest diagonal entry so
 * it holds across the tiny magnitudes daily-return covariances take.
 */
function isPositiveDefinite(matrix: number[][]): boolean {
  const n = matrix.length;
  const scale = Math.max(...matrix.map((row, index) => row[index]), 0);
  const pivotFloor = scale * 1e-10;

  const lower = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= pivotFloor) return false;
        lower[i][i] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return true;
}

/** The quadratic form wᵀΣw: the in-sample daily variance of the weighted portfolio return. */
function quadraticForm(matrix: number[][], vector: number[]): number {
  let total = 0;
  for (let i = 0; i < vector.length; i += 1) {
    for (let j = 0; j < vector.length; j += 1) total += vector[i] * matrix[i][j] * vector[j];
  }
  return total;
}

function validateReturnSeries(returns: DatedValue[], symbol: string): void {
  const seenDates = new Set<DateString>();
  for (const point of returns) {
    if (!isValidIsoDate(point.date)) {
      throw new AnalyticsError(
        `Return series for ${symbol} has a date "${point.date}" that is not an ISO (YYYY-MM-DD) date.`,
      );
    }
    if (seenDates.has(point.date)) {
      throw new AnalyticsError(`Return series for ${symbol} has a duplicate date ${point.date}.`);
    }
    if (!Number.isFinite(point.value)) {
      throw new AnalyticsError(`Return series for ${symbol} has a non-finite return on ${point.date}.`);
    }
    seenDates.add(point.date);
  }
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleCovariance(a: number[], b: number[]): number {
  const meanA = mean(a);
  const meanB = mean(b);
  const sumOfProducts = a.reduce((total, value, index) => total + (value - meanA) * (b[index] - meanB), 0);
  return sumOfProducts / (a.length - 1);
}

/** True when two variances are equal to within a small relative/absolute tolerance, for tie-breaking. */
function approximatelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}
