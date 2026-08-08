import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const publicText = () => [
  read('README.md'),
  read('README.zh-CN.md'),
  read('docs/DEMO_SCRIPT.md'),
  read('src/i18n/language.tsx'),
  read('src/components/aapl-case-study.tsx'),
].join('\n');

describe('final portfolio release contracts', () => {
  it('keeps forbidden placeholder, scope, and misleading copy out of public surfaces', () => {
    const text = publicText();
    expect(text).not.toMatch(/Open live AAPL research/i);
    expect(text).not.toMatch(/unverified placeholder/i);
    expect(text).not.toMatch(/Growth Calculators/i);
    expect(text).not.toMatch(/lets a portfolio hold any number of symbols/i);
    expect(text).not.toMatch(/Server verified/i);
  });

  it('puts exact public-demo truth in both language catalogs and recruiter docs', () => {
    const catalog = read('src/i18n/language.tsx');
    expect(catalog).toContain('Public demo mode');
    expect(catalog).toContain('not actual AAPL, MSFT, SPY, or other market history');
    expect(catalog).toContain('公开演示模式');
    expect(catalog).toContain('并非 AAPL、MSFT、SPY 或其他证券的真实历史行情');
    expect(read('README.md')).toContain('https://investiq-eight-xi.vercel.app/case-study/aapl');
  });

  it('keeps assistant and export evidence modes fail-safe', () => {
    expect(read('src/server/assistant.ts')).toContain('absent, missing, or unrecognized');
    expect(read('src/services/assistant-api.ts')).toContain("dataMode: report.source === 'demo' ? 'synthetic-market' : 'licensed-market'");
    const pdf = read('src/services/pdf-export.ts');
    expect(pdf).toContain('Synthetic public-demo series. Not actual market history.');
    expect(pdf).toContain('Simulated estimates are not forecasts or guaranteed returns.');
  });

  it('ships every recruiter-facing document and an empty usability results template', () => {
    for (const path of [
      'docs/METHODOLOGY.md', 'docs/DATA_GOVERNANCE.md', 'docs/FINANCIAL_MODEL_CONTRACTS.md',
      'docs/SEC_SELECTION_RULES.md', 'docs/AI_ASSISTED_DEVELOPMENT.md', 'docs/LICENSE_DECISION.md',
      'docs/RELEASE_CHECKLIST.md', 'docs/RELEASE_NOTES_V1.md', 'docs/KNOWN_LIMITATIONS.md',
      'docs/usability/PARTICIPANT_SCRIPT.md', 'docs/usability/TASKS.md',
      'docs/usability/OBSERVER_GUIDE.md', 'docs/usability/ISSUE_LOG_TEMPLATE.md',
      'docs/usability/SYNTHESIS_TEMPLATE.md',
    ]) expect(existsSync(resolve(root, path)), path).toBe(true);

    expect(read('docs/usability/RESULTS_TEMPLATE.csv').trim().split('\n')).toHaveLength(1);
  });

  it('keeps the recruiter README concise and release-scoped', () => {
    const english = read('README.md');
    expect(english.trim().split('\n').length).toBeLessThanOrEqual(250);
    expect(english).toContain('v1.0.0');
    expect(english).toContain('MIT License');
    expect(existsSync(resolve(root, 'LICENSE'))).toBe(true);
    expect(read('README.zh-CN.md')).toContain('v1.0.0');
  });
});
