import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { AnalyticsError } from '@/domain/analytics';
import {
  LOSS_THRESHOLD_FRACTIONS,
  MODE_SCORE_LIMITS,
  RISK_CONTEXT_LIMITATIONS,
  RISK_CONTEXT_METRIC_ORDER,
  TEMPORARY_LOSS_ILLUSTRATION_BALANCE,
  buildRiskContext,
  classifyRiskContextMode,
  riskContextFocusMetrics,
  scoreRiskContextAnswers,
} from '@/domain/risk-context';
import type {
  ContributionFrequency,
  InvestmentGoal,
  LossThresholdChoice,
  RiskContextAnswers,
  RiskHorizon,
} from '@/domain/risk-context';
import { catalogs } from '@/i18n/language';
import {
  FREQUENCY_OPTIONS,
  GOAL_OPTIONS,
  HORIZON_OPTIONS,
  LIMITATION_KEYS,
  LOSS_THRESHOLD_OPTIONS,
  METRIC_KEYS,
  MODE_DETAIL_KEYS,
  MODE_LABEL_KEYS,
  NOTE_KEYS,
  RISK_CONTEXT_KEY_PREFIX,
  THRESHOLD_KEYS,
  VOLATILITY_KEYS,
} from '@/i18n/risk-context-keys';

const HORIZONS: RiskHorizon[] = ['under-3-years', '3-to-7-years', '8-plus-years'];
const THRESHOLDS: LossThresholdChoice[] = ['up-to-10', 'up-to-20', '30-or-more'];
const FREQUENCIES: ContributionFrequency[] = ['one-time', 'monthly', 'quarterly'];
const GOALS: InvestmentGoal[] = ['learn', 'long-term-growth', 'planned-expense'];

/** Every combination of the four answers: 81 readings, all of which must be well formed. */
function everyAnswerSet(): RiskContextAnswers[] {
  const all: RiskContextAnswers[] = [];
  for (const horizon of HORIZONS) {
    for (const lossThreshold of THRESHOLDS) {
      for (const frequency of FREQUENCIES) {
        for (const goal of GOALS) all.push({ horizon, lossThreshold, frequency, goal });
      }
    }
  }
  return all;
}

const BALANCED: RiskContextAnswers = {
  horizon: '3-to-7-years',
  lossThreshold: 'up-to-20',
  frequency: 'quarterly',
  goal: 'learn',
};

const LOSS_SENSITIVE: RiskContextAnswers = {
  horizon: 'under-3-years',
  lossThreshold: 'up-to-10',
  frequency: 'one-time',
  goal: 'planned-expense',
};

const LONG_HORIZON: RiskContextAnswers = {
  horizon: '8-plus-years',
  lossThreshold: '30-or-more',
  frequency: 'monthly',
  goal: 'long-term-growth',
};

function reading(answers: RiskContextAnswers, maxDrawdown: number, volatility?: number) {
  return buildRiskContext({ answers, measurement: { maxDrawdown, volatility } });
}

describe('context mode', () => {
  it('names the loss-sensitive mode for a short horizon and a low stated threshold', () => {
    const result = reading(LOSS_SENSITIVE, -0.25, 0.19);
    assert.equal(result.mode, 'loss-sensitive');
    assert.equal(result.modeScore, -7);
  });

  it('names the balanced mode for answers between the two ends', () => {
    const result = reading(BALANCED, -0.25, 0.19);
    assert.equal(result.mode, 'balanced-context');
    assert.equal(result.modeScore, 0);
  });

  it('names the long-horizon variability mode for a long horizon and a high stated threshold', () => {
    const result = reading(LONG_HORIZON, -0.25, 0.19);
    assert.equal(result.mode, 'long-horizon-variability');
    assert.equal(result.modeScore, 6);
  });

  it('places the mode boundaries on the documented inclusive cut points', () => {
    const { lossSensitive, longHorizonVariability } = MODE_SCORE_LIMITS;
    assert.equal(classifyRiskContextMode(lossSensitive), 'loss-sensitive');
    assert.equal(classifyRiskContextMode(lossSensitive + 1), 'balanced-context');
    assert.equal(classifyRiskContextMode(longHorizonVariability - 1), 'balanced-context');
    assert.equal(classifyRiskContextMode(longHorizonVariability), 'long-horizon-variability');
  });

  it('reaches all three modes across the answer space, and nothing else', () => {
    const modes = new Set(everyAnswerSet().map((answers) => reading(answers, -0.2).mode));
    assert.deepEqual(
      [...modes].sort(),
      ['balanced-context', 'long-horizon-variability', 'loss-sensitive'],
    );
  });

  it('is a label for the answers only: the same portfolio keeps identical measured figures', () => {
    const sensitive = reading(LOSS_SENSITIVE, -0.31, 0.22);
    const long = reading(LONG_HORIZON, -0.31, 0.22);
    assert.notEqual(sensitive.mode, long.mode);
    assert.equal(sensitive.measuredDrawdown, long.measuredDrawdown);
    assert.equal(sensitive.drawdownMagnitude, long.drawdownMagnitude);
    assert.equal(sensitive.illustration.loss, long.illustration.loss);
    assert.equal(sensitive.volatility, long.volatility);
  });

  it('is deterministic: the same request always produces the same reading', () => {
    for (const answers of everyAnswerSet()) {
      assert.deepEqual(reading(answers, -0.1834, 0.2131), reading(answers, -0.1834, 0.2131));
    }
  });

  it('scores each answer independently of the others', () => {
    const base = scoreRiskContextAnswers(BALANCED);
    assert.equal(scoreRiskContextAnswers({ ...BALANCED, horizon: '8-plus-years' }), base + 2);
    assert.equal(scoreRiskContextAnswers({ ...BALANCED, lossThreshold: 'up-to-10' }), base - 2);
    assert.equal(scoreRiskContextAnswers({ ...BALANCED, frequency: 'monthly' }), base + 1);
    assert.equal(scoreRiskContextAnswers({ ...BALANCED, goal: 'planned-expense' }), base - 2);
  });
});

describe('threshold comparison', () => {
  it('reports a decline deeper than the selected threshold as having exceeded it', () => {
    const result = reading({ ...BALANCED, lossThreshold: 'up-to-20' }, -0.2634);
    assert.equal(result.lossThreshold, 0.2);
    assert.equal(result.exceedsThreshold, true);
    assert.equal(result.thresholdCode, 'threshold-exceeded');
  });

  it('reports a shallower decline as inside the selected threshold', () => {
    const result = reading({ ...BALANCED, lossThreshold: 'up-to-20' }, -0.1409);
    assert.equal(result.exceedsThreshold, false);
    assert.equal(result.thresholdCode, 'threshold-within');
  });

  it('treats a decline of exactly the threshold as inside it', () => {
    for (const lossThreshold of THRESHOLDS) {
      const threshold = LOSS_THRESHOLD_FRACTIONS[lossThreshold];
      const result = reading({ ...BALANCED, lossThreshold }, -threshold);
      assert.equal(result.exceedsThreshold, false, lossThreshold);
    }
  });

  it('does not let floating-point rounding flip the comparison', () => {
    // 0.1 + 0.2 - 0.1 is 0.30000000000000004, one representable step above 30%.
    const result = reading({ ...BALANCED, lossThreshold: '30-or-more' }, -(0.1 + 0.2 - 0.1));
    assert.equal(result.exceedsThreshold, false);
  });

  it('compares against the same threshold the reader selected, for every choice', () => {
    assert.deepEqual(LOSS_THRESHOLD_FRACTIONS, { 'up-to-10': 0.1, 'up-to-20': 0.2, '30-or-more': 0.3 });
    const drawdown = -0.25;
    assert.equal(reading({ ...BALANCED, lossThreshold: 'up-to-10' }, drawdown).exceedsThreshold, true);
    assert.equal(reading({ ...BALANCED, lossThreshold: 'up-to-20' }, drawdown).exceedsThreshold, true);
    assert.equal(reading({ ...BALANCED, lossThreshold: '30-or-more' }, drawdown).exceedsThreshold, false);
  });
});

describe('measured drawdown', () => {
  it('echoes the measured drawdown unchanged and restates it on the illustration balance', () => {
    const result = reading(BALANCED, -0.1834);
    assert.equal(result.measuredDrawdown, -0.1834);
    assert.equal(result.drawdownMagnitude, 0.1834);
    assert.equal(result.illustration.balance, TEMPORARY_LOSS_ILLUSTRATION_BALANCE);
    assert.ok(Math.abs(result.illustration.loss - 1834) < 1e-9);
  });

  it('restates whatever was measured, not a rounded band', () => {
    for (const drawdown of [-0.0137, -0.0912, -0.2, -0.3671, -0.5555, -0.9999]) {
      const result = reading(BALANCED, drawdown);
      const expected = TEMPORARY_LOSS_ILLUSTRATION_BALANCE * Math.abs(drawdown);
      assert.ok(Math.abs(result.illustration.loss - expected) < 1e-9, String(drawdown));
      assert.equal(result.measuredDrawdown, drawdown);
    }
  });

  it('illustrates nothing when the window never declined', () => {
    const result = reading(BALANCED, 0);
    assert.equal(result.drawdownMagnitude, 0);
    assert.equal(result.illustration.loss, 0);
    assert.equal(result.exceedsThreshold, false);
  });

  it('refuses a drawdown that is not a fraction between -1 and 0', () => {
    for (const bad of [0.01, -1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => reading(BALANCED, bad), AnalyticsError, String(bad));
    }
  });

  it('refuses volatility that is not a finite number at or above zero', () => {
    for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => reading(BALANCED, -0.2, bad), AnalyticsError, String(bad));
    }
  });
});

describe('volatility', () => {
  it('echoes measured volatility and says it was measured', () => {
    const result = reading(BALANCED, -0.2, 0.2143);
    assert.equal(result.volatility, 0.2143);
    assert.equal(result.volatilityCode, 'volatility-measured');
  });

  it('keeps a flat window distinct from an unmeasurable one', () => {
    const flat = reading(BALANCED, 0, 0);
    assert.equal(flat.volatility, 0);
    assert.equal(flat.volatilityCode, 'volatility-measured');

    const missing = reading(BALANCED, -0.2);
    assert.equal(missing.volatility, undefined);
    assert.equal(missing.volatilityCode, 'volatility-unavailable');
  });
});

describe('what to read first', () => {
  it('leads with drawdown depth and window length for a short horizon', () => {
    const metrics = riskContextFocusMetrics({ ...BALANCED, horizon: 'under-3-years' });
    assert.ok(metrics.includes('max-drawdown'));
    assert.ok(metrics.includes('window-length'));
  });

  it('leads with variation for a long horizon and a growth goal', () => {
    const metrics = riskContextFocusMetrics(LONG_HORIZON);
    assert.deepEqual(metrics, ['annualized-volatility', 'concentration', 'benchmark-beta']);
  });

  it('returns metrics in canonical order, deduplicated, and never empty', () => {
    for (const answers of everyAnswerSet()) {
      const metrics = riskContextFocusMetrics(answers);
      assert.ok(metrics.length >= 2);
      assert.equal(new Set(metrics).size, metrics.length);
      const ranks = metrics.map((metric) => RISK_CONTEXT_METRIC_ORDER.indexOf(metric));
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
      assert.ok(ranks.every((rank) => rank >= 0));
    }
  });
});

describe('notes', () => {
  it('emits one note per answer, in answer order', () => {
    const result = reading(
      { horizon: '8-plus-years', lossThreshold: 'up-to-20', frequency: 'one-time', goal: 'learn' },
      -0.2,
    );
    assert.deepEqual(result.notes, ['horizon-8-plus', 'goal-learn', 'frequency-one-time']);
  });

  it('says the contribution schedule was not simulated only when one was stated', () => {
    for (const frequency of FREQUENCIES) {
      const result = reading({ ...BALANCED, frequency }, -0.2);
      assert.equal(
        result.notes.includes('contributions-not-modelled'),
        frequency !== 'one-time',
        frequency,
      );
    }
  });

  it('always states every limitation and marks the reading educational', () => {
    for (const answers of everyAnswerSet()) {
      const result = reading(answers, -0.2, 0.2);
      assert.deepEqual([...result.limitations], [...RISK_CONTEXT_LIMITATIONS]);
      assert.equal(result.limitations.length, 3);
      assert.equal(result.educationalOnly, true);
    }
  });
});

// --- Language -----------------------------------------------------------------

/**
 * Wording this panel may never use, in either catalog. The list is the product constraint written
 * as a test: this feature explains what a measured window did, so it may state that a measured
 * decline exceeded a stated threshold, and it may never tell the reader to trade, call anything
 * appropriate for them, promise an outcome, or claim to know what comes next.
 */
const FORBIDDEN_EN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'buy', pattern: /\bbuy(s|ing)?\b/i },
  { label: 'sell', pattern: /\bsell(s|ing)?\b/i },
  { label: 'should invest', pattern: /\bshould\s+(invest|buy|sell|hold|allocate)/i },
  { label: 'suitable', pattern: /suitab/i },
  { label: 'safe', pattern: /\bsafe(r|st|ty)?\b/i },
  { label: 'guaranteed', pattern: /guarantee/i },
  { label: 'predicted', pattern: /predict/i },
  { label: 'recommended', pattern: /recommend/i },
  { label: 'forecast claim', pattern: /\bwill\s+(rise|fall|grow|return|outperform|recover)\b/i },
  { label: 'allocation instruction', pattern: /\ballocate\s+\d/i },
];

const FORBIDDEN_ZH: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: '买入', pattern: /买入|买进|加仓/ },
  { label: '卖出', pattern: /卖出|减仓|清仓/ },
  { label: '应该', pattern: /应该|应当/ },
  { label: '适合', pattern: /适合|合适/ },
  { label: '安全', pattern: /安全/ },
  { label: '保证', pattern: /保证|确保/ },
  { label: '预测', pattern: /预测|预计|必将/ },
  { label: '推荐', pattern: /推荐|建议买|建议卖|建议持有|建议配置/ },
];

function riskContextEntries(language: 'en' | 'zh-CN'): Array<[string, string]> {
  return Object.entries(catalogs[language]).filter(([key]) =>
    key.startsWith(RISK_CONTEXT_KEY_PREFIX),
  );
}

describe('forbidden advice language', () => {
  it('has a catalog string for every code the domain can emit, in both languages', () => {
    const keys = [
      ...Object.values(MODE_LABEL_KEYS),
      ...Object.values(MODE_DETAIL_KEYS),
      ...Object.values(THRESHOLD_KEYS),
      ...Object.values(VOLATILITY_KEYS),
      ...Object.values(METRIC_KEYS),
      ...Object.values(NOTE_KEYS),
      ...Object.values(LIMITATION_KEYS),
      ...HORIZON_OPTIONS.map((option) => option.labelKey),
      ...LOSS_THRESHOLD_OPTIONS.map((option) => option.labelKey),
      ...FREQUENCY_OPTIONS.map((option) => option.labelKey),
      ...GOAL_OPTIONS.map((option) => option.labelKey),
    ];
    assert.equal(new Set(keys).size, keys.length, 'two codes share one catalog string');
    for (const key of keys) {
      for (const language of ['en', 'zh-CN'] as const) {
        const text = catalogs[language][key as keyof (typeof catalogs)['en']];
        assert.equal(typeof text, 'string', `${key} missing from ${language}`);
        assert.ok(text.trim().length > 0, `${key} is blank in ${language}`);
      }
    }
  });

  it('never uses advice wording in any English Risk Context string', () => {
    const entries = riskContextEntries('en');
    assert.ok(entries.length > 0);
    for (const [key, text] of entries) {
      for (const { label, pattern } of FORBIDDEN_EN) {
        assert.ok(!pattern.test(text), `${key} uses forbidden wording "${label}": ${text}`);
      }
    }
  });

  it('never uses advice wording in any Simplified Chinese Risk Context string', () => {
    const entries = riskContextEntries('zh-CN');
    assert.ok(entries.length > 0);
    for (const [key, text] of entries) {
      for (const { label, pattern } of FORBIDDEN_ZH) {
        assert.ok(!pattern.test(text), `${key} uses forbidden wording "${label}": ${text}`);
      }
    }
  });

  it('keeps both catalogs covering the same Risk Context keys', () => {
    assert.deepEqual(
      riskContextEntries('en').map(([key]) => key).sort(),
      riskContextEntries('zh-CN').map(([key]) => key).sort(),
    );
  });

  it('still allows the sentence the product requires about an exceeded threshold', () => {
    assert.match(catalogs.en[THRESHOLD_KEYS['threshold-exceeded']], /exceeded/);
    assert.match(catalogs['zh-CN'][THRESHOLD_KEYS['threshold-exceeded']], /超过/);
  });

  it('states the limitations the product requires', () => {
    const en = catalogs.en;
    assert.match(en[LIMITATION_KEYS['past-not-forecast']], /not a forecast/i);
    assert.match(en[LIMITATION_KEYS['no-personal-finances']], /income/i);
    assert.match(en[LIMITATION_KEYS['no-personal-finances']], /emergency savings/i);
    assert.match(en[LIMITATION_KEYS['no-personal-finances']], /debt/i);
    assert.match(en[LIMITATION_KEYS['no-personal-finances']], /liquidity/i);
    assert.match(en[LIMITATION_KEYS['education-only']], /not financial advice/i);
    assert.match(catalogs['zh-CN'][LIMITATION_KEYS['education-only']], /不构成投资建议/);
  });

  it('describes the mode as a label rather than as a score or a rating', () => {
    assert.match(catalogs.en['riskContext.modeCaption'], /not a risk score/i);
    assert.match(catalogs['zh-CN']['riskContext.modeCaption'], /不是风险评分/);
  });
});
