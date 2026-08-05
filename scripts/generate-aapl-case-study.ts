import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderAaplCaseStudyMarkdown } from '../src/services/render-aapl-case-study-markdown';

const output = resolve(process.cwd(), 'docs/EQUITY_RESEARCH_SAMPLE_AAPL.md');
writeFileSync(output, renderAaplCaseStudyMarkdown(), 'utf8');
console.log(`Generated ${output}`);
