import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadHistoricalPortfolioCases } from '../benchmark/portfolio/cases.ts';
import type { PortfolioCase } from '../benchmark/portfolio/types.ts';
import { quote } from '../index.ts';
import { SERVICE_POLICY } from './policy.ts';
import { startQuoteServiceProcess } from './process.ts';
import {
  renderServiceLatencySvg,
  renderServiceMarkdown,
} from './load-report.ts';
import type { ServiceMetrics } from './types.ts';

export type ServiceMode = 'same-thread' | 'worker';

export interface ClientLatencyDistribution {
  readonly samples: number;
  readonly p50Micros: number;
  readonly p95Micros: number;
  readonly p99Micros: number | null;
  readonly maxMicros: number;
}

export interface ServiceLoadRow {
  readonly mode: ServiceMode;
  readonly concurrency: number;
  readonly requests: number;
  readonly completed: number;
  readonly typedErrors: number;
  readonly timedOut: number;
  readonly responseSchemaFailures: number;
  readonly exactOutputPresenceCount: number;
  readonly fingerprintPresenceCount: number;
  readonly semanticMatchCount: number;
  readonly deadlineCompletionCount: number;
  readonly deadlineCompletionRatePpm: number | null;
  readonly successfulLatency: ClientLatencyDistribution | null;
  readonly errorResponseLatency: ClientLatencyDistribution | null;
  readonly throughputPerSecond: number;
  readonly server: ServiceMetrics;
}

export interface ServiceLoadReport {
  readonly schemaVersion: 'routelab.service-load-summary.v2';
  readonly observedAt: string;
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly commit: string;
  };
  readonly corpus: {
    readonly corpusId: string;
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly requestCount: number;
    readonly claim: 'synthetic exact-input requests derived from one historical pool-reserve snapshot';
  };
  readonly configuration: {
    readonly modes: readonly ServiceMode[];
    readonly processModel: 'isolated-load-generator-and-server-processes';
    readonly host: '127.0.0.1';
    readonly requestsPerConcurrency: number;
    readonly warmupsPerConcurrency: number;
    readonly requestTimeoutMs: number;
    readonly quoteDeadlineMs: number;
    readonly strategy: 'greedy-split';
    readonly effort: 'fast';
    readonly caseCount: number;
    readonly sameThreadMaximumActiveWork: number;
    readonly workerMaximumActiveWork: number;
    readonly maximumQueuedWork: number;
    readonly workerCount: number;
  };
  readonly rows: readonly ServiceLoadRow[];
  readonly workerDecision: {
    readonly evaluated: boolean;
    readonly retained: boolean;
    readonly decision: 'not-evaluated' | 'retained' | 'rejected';
    readonly reason: string;
  };
}

interface Observation {
  readonly concurrency: number;
  readonly caseId: string;
  readonly elapsedNanoseconds: string;
  readonly outcome: 'completed' | 'typed-error' | 'timed-out' | 'schema-failure';
  readonly status: number | null;
  readonly errorCode: string | null;
  readonly exactOutputPresent: boolean;
  readonly fingerprintPresent: boolean;
  readonly semanticMatch: boolean;
  readonly deadlineCompleted: boolean;
}

const FULL_WARMUPS = 50;
const FULL_REQUESTS = 1_000;
const SMOKE_WARMUPS = 3;
const SMOKE_REQUESTS = 12;
const REQUEST_TIMEOUT_MS = 10_000;
const QUOTE_DEADLINE_MS = 5_000;

interface GateResult {
  readonly retained: boolean;
  readonly reason: string;
}

interface ExpectedResult {
  readonly amountOut: string;
  readonly planFingerprint: string;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function distribution(values: readonly number[]): ClientLatencyDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    samples: sorted.length,
    p50Micros: Math.round(percentile(sorted, 0.50)),
    p95Micros: Math.round(percentile(sorted, 0.95)),
    p99Micros: sorted.length >= 1_000 ? Math.round(percentile(sorted, 0.99)) : null,
    maxMicros: Math.round(sorted.at(-1) ?? 0),
  });
}

function environment(root: string): ServiceLoadReport['environment'] {
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

function bodyFor(input: PortfolioCase): string {
  return JSON.stringify({
    snapshotId: input.request.snapshotId,
    assetIn: input.request.assetIn,
    assetOut: input.request.assetOut,
    amountIn: input.request.amountIn.toString(10),
    maxHops: input.request.maxHops,
    maxRoutes: input.request.maxRoutes,
    strategy: 'greedy-split',
    effort: 'fast',
    deadlineMs: QUOTE_DEADLINE_MS,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function invoke(
  endpoint: string,
  input: PortfolioCase,
  expected: ExpectedResult,
): Promise<Observation> {
  const started = process.hrtime.bigint();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyFor(input),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const elapsed = process.hrtime.bigint() - started;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return Object.freeze({
        concurrency: 0,
        caseId: input.caseId,
        elapsedNanoseconds: elapsed.toString(10),
        outcome: 'schema-failure',
        status: response.status,
        errorCode: null,
        exactOutputPresent: false,
        fingerprintPresent: false,
        semanticMatch: false,
        deadlineCompleted: false,
      });
    }
    const value = record(json);
    const exactOutputPresent = typeof value?.['amountOut'] === 'string'
      && /^(?:0|[1-9][0-9]*)$/u.test(value['amountOut']);
    const fingerprintPresent = typeof value?.['planFingerprint'] === 'string'
      && /^sha256:[0-9a-f]{64}$/u.test(value['planFingerprint']);
    const semanticMatch = value?.['amountOut'] === expected.amountOut
      && value?.['planFingerprint'] === expected.planFingerprint;
    if (response.ok) {
      const valid = typeof value?.['requestId'] === 'string'
        && value['schemaVersion'] === 'routelab.quote.v1'
        && value['snapshotId'] === input.request.snapshotId
        && exactOutputPresent
        && fingerprintPresent
        && typeof value['termination'] === 'string';
      return Object.freeze({
        concurrency: 0,
        caseId: input.caseId,
        elapsedNanoseconds: elapsed.toString(10),
        outcome: valid ? 'completed' : 'schema-failure',
        status: response.status,
        errorCode: null,
        exactOutputPresent,
        fingerprintPresent,
        semanticMatch,
        deadlineCompleted: valid && value['termination'] !== 'deadline',
      });
    }
    const error = record(value?.['error']);
    const code = typeof error?.['code'] === 'string' ? error['code'] : null;
    const valid = typeof value?.['requestId'] === 'string' && code !== null;
    return Object.freeze({
      concurrency: 0,
      caseId: input.caseId,
      elapsedNanoseconds: elapsed.toString(10),
      outcome: valid ? 'typed-error' : 'schema-failure',
      status: response.status,
      errorCode: code,
      exactOutputPresent,
      fingerprintPresent,
      semanticMatch: false,
      deadlineCompleted: false,
    });
  } catch (error) {
    const elapsed = process.hrtime.bigint() - started;
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return Object.freeze({
      concurrency: 0,
      caseId: input.caseId,
      elapsedNanoseconds: elapsed.toString(10),
      outcome: timedOut ? 'timed-out' : 'schema-failure',
      status: null,
      errorCode: null,
      exactOutputPresent: false,
      fingerprintPresent: false,
      semanticMatch: false,
      deadlineCompleted: false,
    });
  }
}

async function runLane(
  endpoint: string,
  cases: readonly PortfolioCase[],
  expected: ReadonlyMap<string, ExpectedResult>,
  concurrency: number,
  requests: number,
): Promise<{ readonly elapsed: bigint; readonly observations: readonly Observation[] }> {
  const observations: Observation[] = [];
  let next = 0;
  const started = process.hrtime.bigint();
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= requests) return;
      const input = cases[index % cases.length];
      if (input === undefined) throw new Error('Service load request corpus is empty.');
      const expectedResult = expected.get(input.caseId);
      if (expectedResult === undefined) throw new Error('Expected service quote is missing.');
      const observation = await invoke(endpoint, input, expectedResult);
      observations.push(Object.freeze({ ...observation, concurrency }));
    }
  });
  await Promise.all(workers);
  return Object.freeze({
    elapsed: process.hrtime.bigint() - started,
    observations: Object.freeze(observations),
  });
}

function row(
  mode: ServiceMode,
  concurrency: number,
  requests: number,
  elapsed: bigint,
  observations: readonly Observation[],
  server: ServiceMetrics,
): ServiceLoadRow {
  const successfulMicros = observations
    .filter((value) => value.outcome === 'completed')
    .map((value) => Number(value.elapsedNanoseconds) / 1_000);
  const errorMicros = observations
    .filter((value) => value.outcome === 'typed-error' || value.outcome === 'schema-failure')
    .map((value) => Number(value.elapsedNanoseconds) / 1_000);
  return Object.freeze({
    mode,
    concurrency,
    requests,
    completed: observations.filter((value) => value.outcome === 'completed').length,
    typedErrors: observations.filter((value) => value.outcome === 'typed-error').length,
    timedOut: observations.filter((value) => value.outcome === 'timed-out').length,
    responseSchemaFailures:
      observations.filter((value) => value.outcome === 'schema-failure').length,
    exactOutputPresenceCount:
      observations.filter((value) => value.exactOutputPresent).length,
    fingerprintPresenceCount:
      observations.filter((value) => value.fingerprintPresent).length,
    semanticMatchCount: observations.filter((value) => value.semanticMatch).length,
    deadlineCompletionCount:
      observations.filter((value) => value.deadlineCompleted).length,
    deadlineCompletionRatePpm: successfulMicros.length === 0
      ? null
      : Math.floor(
        observations.filter((value) => value.deadlineCompleted).length
          * 1_000_000
          / successfulMicros.length,
      ),
    successfulLatency: distribution(successfulMicros),
    errorResponseLatency: distribution(errorMicros),
    throughputPerSecond:
      Number((BigInt(requests) * 1_000_000_000_000n) / elapsed) / 1_000,
    server,
  });
}

async function writeReport(
  report: ServiceLoadReport,
  observations: readonly Observation[],
  serviceLogs: readonly string[],
  root: string,
): Promise<void> {
  const reports = path.join(root, 'reports');
  const raw = path.join(reports, 'raw');
  await mkdir(raw, { recursive: true });
  await Promise.all([
    writeFile(path.join(reports, 'service-v2-summary.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(reports, 'service-v2.md'), renderServiceMarkdown(report)),
    writeFile(path.join(reports, 'service-latency.svg'), renderServiceLatencySvg(report)),
    writeFile(path.join(raw, 'service-v2-observations.json'), `${JSON.stringify({
      schemaVersion: 'routelab.service-load-observations.v2',
      observations,
      serviceLogs,
    })}\n`),
  ]);
}

function gate(
  baseline: readonly ServiceLoadRow[],
  worker: readonly ServiceLoadRow[],
): GateResult {
  const baseOne = baseline.find((value) => value.concurrency === 1);
  const baseSixteen = baseline.find((value) => value.concurrency === 16);
  const workerOne = worker.find((value) => value.concurrency === 1);
  const workerSixteen = worker.find((value) => value.concurrency === 16);
  if (
    baseOne?.successfulLatency === null
    || baseOne === undefined
    || baseSixteen?.successfulLatency === null
    || baseSixteen === undefined
    || workerOne?.successfulLatency === null
    || workerOne === undefined
    || workerSixteen?.successfulLatency === null
    || workerSixteen === undefined
  ) return Object.freeze({ retained: false, reason: 'Required concurrency-1/16 rows are missing.' });
  const noRegression = worker.every((value) =>
    value.completed === value.requests
    && value.typedErrors === 0
    && value.timedOut === 0
    && value.responseSchemaFailures === 0
    && value.exactOutputPresenceCount === value.requests
    && value.fingerprintPresenceCount === value.requests
    && value.semanticMatchCount === value.requests
  );
  const p95Improvement = 1
    - workerSixteen.successfulLatency.p95Micros / baseSixteen.successfulLatency.p95Micros;
  const p99Improvement = 1
    - (workerSixteen.successfulLatency.p99Micros ?? Number.POSITIVE_INFINITY)
      / (baseSixteen.successfulLatency.p99Micros ?? 1);
  const eventLoopImprovement = 1
    - workerSixteen.server.eventLoopDelayMaxMicros
      / Math.max(1, baseSixteen.server.eventLoopDelayMaxMicros);
  const latencyGate = p95Improvement >= 0.25
    || p99Improvement >= 0.25
    || eventLoopImprovement >= 0.50;
  const throughputGate = workerSixteen.throughputPerSecond
    >= baseSixteen.throughputPerSecond * 0.90;
  const overheadMicros = workerOne.successfulLatency.p50Micros
    - baseOne.successfulLatency.p50Micros;
  const overheadGate = overheadMicros <= 2_000;
  const retained = noRegression && latencyGate && throughputGate && overheadGate;
  return Object.freeze({
    retained,
    reason: `Gate ${retained ? 'passed' : 'failed'}: c16 p95 ${(p95Improvement * 100).toFixed(1)}%, p99 ${(p99Improvement * 100).toFixed(1)}%, event-loop max ${(eventLoopImprovement * 100).toFixed(1)}%; throughput ratio ${(workerSixteen.throughputPerSecond / baseSixteen.throughputPerSecond).toFixed(3)}; c1 p50 overhead ${(overheadMicros / 1_000).toFixed(2)} ms; semantic/schema regression ${noRegression ? 'none' : 'present'}.`,
  });
}

async function baselineReport(root: string): Promise<ServiceLoadReport> {
  const parsed = JSON.parse(await readFile(
    path.join(root, 'reports', 'service-v2-summary.json'),
    'utf8',
  )) as ServiceLoadReport;
  if (
    parsed.schemaVersion !== 'routelab.service-load-summary.v2'
    || !parsed.rows.some((value) => value.mode === 'same-thread')
  ) throw new Error('Worker comparison requires a retained same-thread service-v2 baseline.');
  return parsed;
}

export function validateServiceLoadReport(report: ServiceLoadReport): readonly string[] {
  const issues: string[] = [];
  if (report.schemaVersion !== 'routelab.service-load-summary.v2') {
    issues.push('Unexpected service load report schema.');
  }
  const keys = new Set<string>();
  for (const value of report.rows) {
    const key = `${value.mode}/${value.concurrency}`;
    if (keys.has(key)) issues.push(`${key}: duplicate row.`);
    keys.add(key);
    if (
      value.completed
        + value.typedErrors
        + value.timedOut
        + value.responseSchemaFailures
      !== value.requests
    ) issues.push(`${key}: client outcome counts do not reconcile.`);
    if (value.successfulLatency?.samples !== value.completed) {
      issues.push(`${key}: successful latency sample count mismatch.`);
    }
    if (
      (value.completed >= 1_000 && value.successfulLatency?.p99Micros === null)
      || (value.completed < 1_000 && value.successfulLatency?.p99Micros !== null)
    ) issues.push(`${key}: p99 sample threshold mismatch.`);
    if (
      value.exactOutputPresenceCount > value.completed
      || value.fingerprintPresenceCount > value.completed
      || value.semanticMatchCount > value.completed
      || value.deadlineCompletionCount > value.completed
    ) issues.push(`${key}: success validation counts exceed completed responses.`);
    if (
      value.server.admissionAcceptedCount + value.server.admissionRejectedCount
      !== value.requests
    ) issues.push(`${key}: server admission counts do not reconcile.`);
    if (value.server.structuredCompletionCount !== value.requests) {
      issues.push(`${key}: structured server completion count mismatch.`);
    }
  }
  if (
    report.workerDecision.evaluated
    && (!report.rows.some((value) => value.mode === 'same-thread')
      || !report.rows.some((value) => value.mode === 'worker'))
  ) issues.push('Worker decision lacks both comparison modes.');
  return Object.freeze(issues);
}

export async function runHttpLoad(
  concurrencyLevels: readonly number[],
  options: {
    readonly smoke?: boolean;
    readonly root?: string;
    readonly mode?: ServiceMode;
  } = {},
): Promise<ServiceLoadReport> {
  if (
    concurrencyLevels.length === 0
    || concurrencyLevels.some((value) =>
      !Number.isSafeInteger(value) || value < 1 || value > 64
    )
    || new Set(concurrencyLevels).size !== concurrencyLevels.length
  ) throw new Error('Concurrency levels must be unique integers from 1 through 64.');
  const root = options.root ?? process.cwd();
  const smoke = options.smoke ?? false;
  const mode = options.mode ?? 'same-thread';
  const requests = smoke ? SMOKE_REQUESTS : FULL_REQUESTS;
  const warmups = smoke ? SMOKE_WARMUPS : FULL_WARMUPS;
  const loaded = await loadHistoricalPortfolioCases(root);
  const expected = new Map(loaded.cases.map((input) => {
    const result = quote(input.context, input.request, {
      strategy: 'greedy-split',
      effort: 'fast',
    });
    if (!result.ok) throw new Error(`Expected load quote failed for ${input.caseId}.`);
    return [input.caseId, Object.freeze({
      amountOut: result.value.amountOut.toString(10),
      planFingerprint: result.value.planFingerprint,
    })] as const;
  }));
  const baseline = !smoke && mode === 'worker' ? await baselineReport(root) : undefined;
  const service = await startQuoteServiceProcess(root, mode);
  const rows: ServiceLoadRow[] = [];
  const observations: Observation[] = [];
  try {
    for (const concurrency of concurrencyLevels) {
      await runLane(service.endpoint, loaded.cases, expected, 1, warmups);
      await service.resetMetrics();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const lane = await runLane(
        service.endpoint,
        loaded.cases,
        expected,
        concurrency,
        requests,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const server = await service.readMetrics();
      observations.push(...lane.observations);
      rows.push(row(mode, concurrency, requests, lane.elapsed, lane.observations, server));
    }
  } finally {
    await service.shutdown();
  }
  const combinedRows = baseline === undefined
    ? rows
    : [...baseline.rows.filter((value) => value.mode === 'same-thread'), ...rows];
  const gateResult = baseline === undefined ? undefined : gate(
    combinedRows.filter((value) => value.mode === 'same-thread'),
    rows,
  );
  const report: ServiceLoadReport = Object.freeze({
    schemaVersion: 'routelab.service-load-summary.v2',
    observedAt: new Date().toISOString(),
    environment: environment(root),
    corpus: Object.freeze({
      corpusId: loaded.corpus.corpusId,
      snapshotId: loaded.corpus.snapshotId,
      snapshotChecksum: loaded.corpus.snapshotChecksum,
      requestCount: loaded.corpus.requestCount,
      claim: 'synthetic exact-input requests derived from one historical pool-reserve snapshot',
    }),
    configuration: Object.freeze({
      modes: Object.freeze([...new Set(combinedRows.map((value) => value.mode))]),
      processModel: 'isolated-load-generator-and-server-processes',
      host: '127.0.0.1',
      requestsPerConcurrency: requests,
      warmupsPerConcurrency: warmups,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      quoteDeadlineMs: QUOTE_DEADLINE_MS,
      strategy: 'greedy-split',
      effort: 'fast',
      caseCount: loaded.cases.length,
      sameThreadMaximumActiveWork: SERVICE_POLICY.maxActiveWork,
      workerMaximumActiveWork: SERVICE_POLICY.workerCount,
      maximumQueuedWork: SERVICE_POLICY.maxQueuedWork,
      workerCount: SERVICE_POLICY.workerCount,
    }),
    rows: Object.freeze(combinedRows),
    workerDecision: Object.freeze({
      evaluated: gateResult !== undefined,
      retained: gateResult?.retained ?? false,
      decision: gateResult === undefined
        ? 'not-evaluated'
        : gateResult.retained ? 'retained' : 'rejected',
      reason: gateResult?.reason
        ?? 'The isolated same-thread baseline is retained before conditional worker evaluation.',
    }),
  });
  const issues = validateServiceLoadReport(report);
  if (issues.length !== 0) throw new Error(`Service load report is invalid: ${issues.join(' ')}`);
  if (!smoke) await writeReport(report, observations, service.logs, root);
  else {
    const raw = path.join(root, 'reports', 'raw');
    await mkdir(raw, { recursive: true });
    await writeFile(path.join(raw, 'service-v2-smoke-observations.json'), `${JSON.stringify({
      report,
      observations,
      serviceLogs: service.logs,
    })}\n`);
  }
  return report;
}
