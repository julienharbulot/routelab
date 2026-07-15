import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { loadPortfolioCases } from '../benchmark/portfolio/cases.ts';
import { renderMarkdown } from '../benchmark/portfolio/report.ts';
import type { BenchmarkReport, HttpLoadRow } from '../benchmark/portfolio/types.ts';
import { closeQuoteHttpService, createQuoteHttpService } from './server.ts';

export interface LoadReport {
  readonly schemaVersion: 'routelab.http-load.v1';
  readonly observedAt: string;
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly commit: string;
  };
  readonly configuration: {
    readonly host: '127.0.0.1';
    readonly requestsPerConcurrency: number;
    readonly warmups: number;
    readonly requestTimeoutMs: number;
    readonly quoteDeadlineMs: number;
    readonly strategy: 'greedy-split';
    readonly effort: 'fast';
    readonly caseCount: number;
    readonly sameThread: true;
  };
  readonly rows: readonly HttpLoadRow[];
}

interface Observation {
  readonly concurrency: number;
  readonly caseId: string;
  readonly elapsedNanoseconds: string;
  readonly outcome: 'completed' | 'failed' | 'timed-out';
  readonly deadlineCompleted: boolean;
}

const WARMUPS = 10;
const FULL_REQUESTS = 120;
const SMOKE_REQUESTS = 12;
const REQUEST_TIMEOUT_MS = 10_000;
const QUOTE_DEADLINE_MS = 5_000;

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? null;
}

function roundMicros(nanoseconds: number): number {
  return Math.round(nanoseconds / 1_000);
}

function environment(root: string): LoadReport['environment'] {
  let commit = 'unavailable';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Source archives can still produce local operational measurements.
  }
  return Object.freeze({
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unavailable',
    commit,
  });
}

async function writeLoadReport(report: LoadReport, root: string): Promise<void> {
  const reports = path.join(root, 'reports');
  await mkdir(reports, { recursive: true });
  const table = [
    '| Concurrency | Requests | Completed | Failed | Timed out | p50 ms | p95 ms | p99 ms | req/s | Deadline completion | Event-loop max ms | Peak RSS MiB |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...report.rows.map((row) =>
      `| ${row.concurrency} | ${row.requests} | ${row.completed} | ${row.failed} | ${row.timedOut} | ${(row.p50Micros / 1_000).toFixed(2)} | ${(row.p95Micros / 1_000).toFixed(2)} | ${row.p99Micros === null ? 'n/a' : (row.p99Micros / 1_000).toFixed(2)} | ${row.throughputPerSecond.toFixed(1)} | ${(row.deadlineCompletionRate * 100).toFixed(1)}% | ${(row.eventLoopDelayMaxMicros / 1_000).toFixed(2)} | ${(row.peakRssBytes / 1_048_576).toFixed(1)} |`
    ),
  ].join('\n');
  const markdown = [
    '# RouteLab local HTTP load report v1',
    '',
    'On this machine, the same-thread loopback service completed the fixed request mix at concurrency 1, 4, and 16. Higher concurrency queues synchronous CPU work on the event loop; no worker pool was added for v0.1.',
    '',
    table,
    '',
    '## Method',
    '',
    `Each row uses ${report.configuration.warmups} warmups and ${report.configuration.requestsPerConcurrency} measured requests over localhost. All rows rotate the same ${report.configuration.caseCount} retained historical requests with ${report.configuration.strategy}/${report.configuration.effort}, a ${report.configuration.quoteDeadlineMs} ms quote deadline, and a ${report.configuration.requestTimeoutMs} ms client timeout. p99 is reported only where at least 100 end-to-end observations completed. Event-loop delay comes from Node's nanosecond histogram; RSS is sampled in the shared server/load process.`,
    '',
    'This is local portfolio evidence, not production capacity or representative demand. The service has no live upstream, signing, custody, execution, or settlement.',
    '',
    `Environment: ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}; ${report.environment.cpu}; revision ${report.environment.commit}; observed ${report.observedAt}.`,
    '',
  ].join('\n');
  await Promise.all([
    writeFile(path.join(reports, 'load-v1.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(reports, 'load-v1.md'), markdown),
  ]);
  try {
    const portfolio = JSON.parse(await readFile(path.join(reports, 'portfolio-v1.json'), 'utf8')) as BenchmarkReport;
    await writeFile(path.join(reports, 'portfolio-v1.md'), renderMarkdown(portfolio, report.rows));
  } catch {
    // The standalone load report remains complete when the portfolio report is absent.
  }
}

export async function runHttpLoad(
  concurrencyLevels: readonly number[],
  options: { readonly smoke?: boolean; readonly root?: string } = {},
): Promise<LoadReport> {
  if (
    concurrencyLevels.length === 0 ||
    concurrencyLevels.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 64) ||
    new Set(concurrencyLevels).size !== concurrencyLevels.length
  ) {
    throw new Error('Concurrency levels must be unique integers from 1 through 64.');
  }
  const root = options.root ?? process.cwd();
  const smoke = options.smoke ?? false;
  const requestsPerConcurrency = smoke ? SMOKE_REQUESTS : FULL_REQUESTS;
  const portfolio = await loadPortfolioCases(root);
  const cases = portfolio.filter(({ caseId }) => caseId.startsWith('historical-'));
  const snapshotRaw = JSON.parse(await readFile(path.join(
    root,
    'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  ), 'utf8')) as unknown;
  const service = createQuoteHttpService([snapshotRaw], () => undefined);
  await new Promise<void>((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(0, '127.0.0.1', () => {
      service.server.off('error', reject);
      resolve();
    });
  });
  const address = service.server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/v1/quote`;
  const observations: Observation[] = [];
  const rows: HttpLoadRow[] = [];
  try {
    for (const concurrency of concurrencyLevels) {
      for (let index = 0; index < WARMUPS; index += 1) {
        const input = cases[index % cases.length];
        if (input === undefined) throw new Error('HTTP load case set is empty.');
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            snapshotId: input.request.snapshotId,
            assetIn: input.request.assetIn,
            assetOut: input.request.assetOut,
            amountIn: input.request.amountIn.toString(10),
            maxHops: input.request.maxHops,
            maxRoutes: input.request.maxRoutes,
            strategy: 'greedy-split',
            effort: 'fast',
            deadlineMs: QUOTE_DEADLINE_MS,
          }),
        });
      }
      const histogram = monitorEventLoopDelay({ resolution: 10 });
      histogram.enable();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const initialRss = process.memoryUsage().rss;
      let peakRss = initialRss;
      let next = 0;
      const laneStarted = process.hrtime.bigint();
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const index = next;
          next += 1;
          if (index >= requestsPerConcurrency) return;
          const input = cases[index % cases.length];
          if (input === undefined) throw new Error('HTTP load case set is empty.');
          const started = process.hrtime.bigint();
          let outcome: Observation['outcome'];
          let deadlineCompleted = false;
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                snapshotId: input.request.snapshotId,
                assetIn: input.request.assetIn,
                assetOut: input.request.assetOut,
                amountIn: input.request.amountIn.toString(10),
                maxHops: input.request.maxHops,
                maxRoutes: input.request.maxRoutes,
                strategy: 'greedy-split',
                effort: 'fast',
                deadlineMs: QUOTE_DEADLINE_MS,
              }),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const body = await response.json() as { readonly termination?: unknown };
            outcome = response.ok ? 'completed' : 'failed';
            deadlineCompleted = response.ok && body.termination !== 'deadline';
          } catch (error) {
            outcome = error instanceof DOMException && error.name === 'TimeoutError'
              ? 'timed-out'
              : 'failed';
          }
          const elapsed = process.hrtime.bigint() - started;
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
          observations.push(Object.freeze({
            concurrency,
            caseId: input.caseId,
            elapsedNanoseconds: elapsed.toString(10),
            outcome,
            deadlineCompleted,
          }));
        }
      });
      await Promise.all(workers);
      const laneElapsed = process.hrtime.bigint() - laneStarted;
      await new Promise<void>((resolve) => setImmediate(resolve));
      histogram.disable();
      const selected = observations.filter((value) => value.concurrency === concurrency);
      const measured = selected
        .filter(({ outcome }) => outcome !== 'timed-out')
        .map(({ elapsedNanoseconds }) => Number(elapsedNanoseconds) / 1_000)
        .sort((left, right) => left - right);
      const completed = selected.filter(({ outcome }) => outcome === 'completed').length;
      const failed = selected.filter(({ outcome }) => outcome === 'failed').length;
      const timedOut = selected.filter(({ outcome }) => outcome === 'timed-out').length;
      const deadlineCompleted = selected.filter((value) => value.deadlineCompleted).length;
      rows.push(Object.freeze({
        concurrency,
        requests: requestsPerConcurrency,
        completed,
        failed,
        timedOut,
        p50Micros: Math.round(percentile(measured, 0.50) ?? 0),
        p95Micros: Math.round(percentile(measured, 0.95) ?? 0),
        p99Micros: measured.length >= 100 ? Math.round(percentile(measured, 0.99) ?? 0) : null,
        throughputPerSecond: Number((BigInt(requestsPerConcurrency) * 1_000_000_000_000n) / laneElapsed) / 1_000,
        deadlineCompletionRate: completed === 0 ? 0 : deadlineCompleted / completed,
        eventLoopDelayMeanMicros: Number.isFinite(histogram.mean) ? roundMicros(histogram.mean) : 0,
        eventLoopDelayMaxMicros: roundMicros(histogram.max),
        initialRssBytes: initialRss,
        peakRssBytes: peakRss,
        rssDeltaBytes: Math.max(0, peakRss - initialRss),
      }));
    }
  } finally {
    await closeQuoteHttpService(service);
  }
  const report: LoadReport = Object.freeze({
    schemaVersion: 'routelab.http-load.v1',
    observedAt: new Date().toISOString(),
    environment: environment(root),
    configuration: Object.freeze({
      host: '127.0.0.1',
      requestsPerConcurrency,
      warmups: WARMUPS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      quoteDeadlineMs: QUOTE_DEADLINE_MS,
      strategy: 'greedy-split',
      effort: 'fast',
      caseCount: cases.length,
      sameThread: true,
    }),
    rows: Object.freeze(rows),
  });
  const rawDirectory = path.join(root, 'reports', 'raw');
  await mkdir(rawDirectory, { recursive: true });
  await writeFile(path.join(
    rawDirectory,
    smoke ? 'load-v1-smoke-observations.json' : 'load-v1-observations.json',
  ), `${JSON.stringify({ report, observations }, null, 2)}\n`);
  if (!smoke) await writeLoadReport(report, root);
  return report;
}
