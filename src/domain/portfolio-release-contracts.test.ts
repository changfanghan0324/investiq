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

  it('puts the local-only ModelGuard contract in both language catalogs and docs', () => {
    const catalog = read('src/i18n/language.tsx');
    expect(catalog).toContain('Processed locally. Not uploaded. No AI. No financial-data API.');
    expect(catalog).toContain('在本地处理。不上传。不使用 AI。不调用金融数据 API。');
    expect(read('README.md')).toContain('https://investiq-eight-xi.vercel.app/');
    expect(read('README.md')).toContain('no market-data provider');
  });

  it('keeps audit exports local and provenance-linked', () => {
    expect(read('src/services/modelguard-exports.ts')).toContain('auditReportToJson');
    expect(read('src/services/modelguard-exports.ts')).toContain('auditReportToCsv');
    expect(read('src/services/modelguard-exports.ts')).toContain('auditReportToPdf');
    expect(read('src/domain/modelguard-schema.ts')).toContain('WorkbookProvenance');
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
    expect(english).toContain('ModelGuard');
    expect(english).toContain('MIT');
    expect(existsSync(resolve(root, 'LICENSE'))).toBe(true);
    expect(read('README.zh-CN.md')).toContain('ModelGuard');
  });
});
