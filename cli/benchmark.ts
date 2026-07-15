import { runPortfolioBenchmark } from '../src/benchmark/portfolio/run.ts';

const report = await runPortfolioBenchmark();
const comparisons = report.numericalComparisons
  .map((value) => `${value.profile} ${value.beatsGreedy}/${value.tiesGreedy}/${value.losesGreedy}`)
  .join(', ');
process.stdout.write(
  `portfolio-v1: ${report.configuration.caseCount} cases, ${report.quality.length} quality rows, ` +
  `${report.latency.reduce((sum, value) => sum + value.samples, 0)} latency observations\n` +
  `numerical beats/ties/loses greedy: ${comparisons}\n` +
  'wrote reports/portfolio-v1.{md,json}, reports/quality-vs-budget.svg, and ignored raw observations\n',
);
