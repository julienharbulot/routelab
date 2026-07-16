import { runPortfolioBenchmark } from '../src/benchmark/portfolio/run.ts';
import { loadHistoricalPortfolioCases } from '../src/benchmark/portfolio/cases.ts';
import { quote } from '../src/index.ts';

const arguments_ = process.argv.slice(2);
if (arguments_.some((value) => value !== '--smoke')) {
  throw new Error('Usage: pnpm benchmark [-- --smoke]');
}
if (arguments_.includes('--smoke')) {
  const loaded = await loadHistoricalPortfolioCases();
  const selected = [loaded.cases[0], loaded.cases[Math.floor(loaded.cases.length / 2)], loaded.cases.at(-1)];
  let quotes = 0;
  for (const item of selected) {
    if (item === undefined) throw new Error('Benchmark smoke selection is incomplete.');
    for (const strategy of ['best-single', 'greedy-split', 'numerical-split'] as const) {
      const result = quote(item.context, item.request, { strategy, effort: 'fast' });
      if (!result.ok) throw new Error(`${item.caseId}/${strategy} failed: ${result.error.code}.`);
      quotes += 1;
    }
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'routelab.benchmark-smoke.v1',
    retainedRequestCount: selected.length,
    strategyCount: 3,
    quotes,
  })}\n`);
  process.exit(0);
}

const report = await runPortfolioBenchmark();
const comparisons = report.quality.numericalComparisons
  .filter((value) => value.dimension === 'overall')
  .map((value) => `${value.profile} ${value.beatsGreedy}/${value.tiesGreedy}/${value.losesGreedy}`)
  .join(', ');
process.stdout.write(
  `portfolio-v2: ${report.corpus.requestCount} requests, ${report.quality.rowCount} quality rows, ` +
  `${report.latency.reduce((sum, value) => sum + value.samples, 0)} latency observations\n` +
  `numerical beats/ties/loses greedy: ${comparisons}\n` +
  'wrote reports/portfolio-v2.{md,summary.json}, reports/quality-by-effort.svg, ' +
  'reports/historical-regret-distribution.svg, and ignored raw observations\n',
);
