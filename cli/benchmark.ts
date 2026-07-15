import { runPortfolioBenchmark } from '../src/benchmark/portfolio/run.ts';

const report = await runPortfolioBenchmark();
const comparisons = report.quality.numericalComparisons
  .filter((value) => value.dimension === 'overall')
  .map((value) => `${value.profile} ${value.beatsGreedy}/${value.tiesGreedy}/${value.losesGreedy}`)
  .join(', ');
process.stdout.write(
  `portfolio-v2: ${report.corpus.requestCount} requests, ${report.quality.rowCount} quality rows, ` +
  `${report.latency.reduce((sum, value) => sum + value.samples, 0)} latency observations\n` +
  `numerical beats/ties/loses greedy: ${comparisons}\n` +
  'wrote reports/portfolio-v2.{md,summary.json}, reports/quality-vs-work.svg, ' +
  'reports/historical-regret-distribution.svg, and ignored raw observations\n',
);
