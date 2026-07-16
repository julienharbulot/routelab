import { runHttpLoad } from '../src/service/load.ts';

const args = process.argv.slice(2).filter((value) => value !== '--');
const smoke = args.includes('--smoke');
const modeIndex = args.indexOf('--mode');
const rawMode = modeIndex === -1 ? 'same-thread' : args[modeIndex + 1];
if (rawMode !== 'same-thread' && rawMode !== 'worker') {
  throw new Error('--mode must be same-thread or worker.');
}
const concurrencyIndex = args.indexOf('--concurrency');
const rawConcurrency = concurrencyIndex === -1
  ? (smoke ? '1' : '1,4,16')
  : args[concurrencyIndex + 1];
if (rawConcurrency === undefined || !/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/u.test(rawConcurrency)) {
  throw new Error('--concurrency must be a comma-separated list of positive integers.');
}
const concurrency = rawConcurrency.split(',').map(Number);
const report = await runHttpLoad(concurrency, { smoke, mode: rawMode });
for (const row of report.rows) {
  process.stdout.write(
    `mode=${row.mode} c=${row.concurrency} requests=${row.requests} completed=${row.completed} ` +
    `typedErrors=${row.typedErrors} timedOut=${row.timedOut} ` +
    `schemaFailures=${row.responseSchemaFailures} ` +
    `p50=${((row.successfulLatency?.p50Micros ?? 0) / 1_000).toFixed(2)}ms ` +
    `p95=${((row.successfulLatency?.p95Micros ?? 0) / 1_000).toFixed(2)}ms ` +
    `p99=${row.successfulLatency?.p99Micros === null || row.successfulLatency === null
      ? 'n/a'
      : `${(row.successfulLatency.p99Micros / 1_000).toFixed(2)}ms`} ` +
    `throughput=${row.throughputPerSecond.toFixed(1)}/s\n`,
  );
}
process.stdout.write(smoke
  ? 'load smoke passed; raw smoke observations are ignored\n'
  : 'wrote reports/service-v2.{md,summary.json}, reports/service-latency.svg; raw observations are ignored\n');
