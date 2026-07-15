import { runHttpLoad } from '../src/service/load.ts';

const args = process.argv.slice(2).filter((value) => value !== '--');
const smoke = args.includes('--smoke');
const concurrencyIndex = args.indexOf('--concurrency');
const rawConcurrency = concurrencyIndex === -1
  ? (smoke ? '1' : '1,4,16')
  : args[concurrencyIndex + 1];
if (rawConcurrency === undefined || !/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/u.test(rawConcurrency)) {
  throw new Error('--concurrency must be a comma-separated list of positive integers.');
}
const concurrency = rawConcurrency.split(',').map(Number);
const report = await runHttpLoad(concurrency, { smoke });
for (const row of report.rows) {
  process.stdout.write(
    `c=${row.concurrency} requests=${row.requests} completed=${row.completed} failed=${row.failed} ` +
    `timedOut=${row.timedOut} p50=${(row.p50Micros / 1_000).toFixed(2)}ms ` +
    `p95=${(row.p95Micros / 1_000).toFixed(2)}ms ` +
    `p99=${row.p99Micros === null ? 'n/a' : `${(row.p99Micros / 1_000).toFixed(2)}ms`} ` +
    `throughput=${row.throughputPerSecond.toFixed(1)}/s\n`,
  );
}
process.stdout.write(smoke
  ? 'load smoke passed; raw smoke observations are ignored\n'
  : 'wrote reports/load-v1.{md,json}; raw observations are ignored\n');
