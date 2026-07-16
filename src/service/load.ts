import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadHistoricalPortfolioCases } from '../benchmark/portfolio/cases.ts';
import type { PortfolioCase } from '../benchmark/portfolio/types.ts';
import {
  captureEvidenceSource,
  inspectEvidenceSource,
  type EvidenceSourceIdentity,
} from '../evidence/source-identity.ts';
import { quote, type QuoteEffort, type QuoteStrategy } from '../index.ts';
import {
  makeDeadlineLoadRow,
  makeServiceLoadRow,
  runClientLane,
  type ExpectedResult,
  type Observation,
} from './load-client.ts';
import { renderServiceLatencySvg, renderServiceMarkdown } from './load-report.ts';
import type {
  DeadlineLoadRow,
  OverloadBurstResult,
  ServiceExecutionIdentity,
  ServiceLoadMode,
  ServiceLoadReport,
  ServiceLoadRow,
  ServiceMode,
  WorkerRetentionGate,
} from './load-types.ts';
import { SERVICE_POLICY } from './policy.ts';
import { startQuoteServiceProcess, type QuoteServiceProcess } from './process.ts';

export type {
  ClientLatencyDistribution,
  DeadlineClassification,
  DeadlineLoadRow,
  OverloadBurstResult,
  ServiceLoadMode,
  ServiceLoadReport,
  ServiceLoadRow,
  ServiceMode,
} from './load-types.ts';

const FULL_WARMUPS = 50;
const FULL_REQUESTS = 1_000;
const SMOKE_WARMUPS = 3;
const SMOKE_REQUESTS = 12;
const REQUEST_TIMEOUT_MS = 10_000;
const QUOTE_DEADLINE_MS = 5_000;
const DEADLINE_CONCURRENCY = 16;
const DEADLINES_MS = [25, 50, 100] as const;
const DEADLINE_REQUESTS = 200;
const OVERLOAD_EXTRA_REQUESTS = 16;

interface LoadedInputs {
  readonly cases: readonly PortfolioCase[];
  readonly corpus: Awaited<ReturnType<typeof loadHistoricalPortfolioCases>>['corpus'];
}

interface ModeRun {
  readonly rows: readonly ServiceLoadRow[];
  readonly deadlineSweep: readonly DeadlineLoadRow[];
  readonly overloadBurst: OverloadBurstResult | null;
  readonly observations: readonly (Observation & { readonly mode: ServiceMode })[];
  readonly logs: readonly string[];
}

function environment(revision: string): ServiceLoadReport['environment'] {
  return Object.freeze({
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unavailable',
    commit: revision,
  });
}

function executionIdentity(
  source: EvidenceSourceIdentity,
  value: ServiceLoadReport['environment'],
): ServiceExecutionIdentity {
  return Object.freeze({
    sourceRevision: source.revision,
    sourceDigest: source.digest,
    node: value.node,
    platform: value.platform,
    arch: value.arch,
    cpu: value.cpu,
  });
}

function expectedResults(
  cases: readonly PortfolioCase[],
  strategy: QuoteStrategy,
  effort: QuoteEffort,
): ReadonlyMap<string, ExpectedResult> {
  return new Map(cases.map((input) => {
    const result = quote(input.context, input.request, { strategy, effort });
    if (!result.ok) throw new Error(`Expected load quote failed for ${input.caseId}.`);
    return [input.caseId, Object.freeze({
      amountOut: result.value.amountOut.toString(10),
      planFingerprint: result.value.planFingerprint,
    })] as const;
  }));
}

async function settleMetrics(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
}

async function runDeadlineLanes(
  service: QuoteServiceProcess,
  loaded: LoadedInputs,
  requests: number,
  warmups: number,
): Promise<{
  readonly rows: readonly DeadlineLoadRow[];
  readonly observations: readonly Observation[];
}> {
  const rows: DeadlineLoadRow[] = [];
  const observations: Observation[] = [];
  for (const deadlineMs of DEADLINES_MS) {
    const configuration = {
      strategy: 'numerical-split' as const,
      effort: 'balanced' as const,
      deadlineMs,
      timeoutMs: REQUEST_TIMEOUT_MS,
    };
    await runClientLane(service.endpoint, loaded.cases, undefined, 1, warmups, configuration);
    await service.resetMetrics();
    await settleMetrics();
    const lane = await runClientLane(
      service.endpoint,
      loaded.cases,
      undefined,
      DEADLINE_CONCURRENCY,
      requests,
      configuration,
    );
    await settleMetrics();
    const server = await service.readMetrics();
    observations.push(...lane.observations);
    rows.push(makeDeadlineLoadRow(deadlineMs, requests, lane.observations, server));
  }
  return Object.freeze({ rows: Object.freeze(rows), observations: Object.freeze(observations) });
}

async function runOverloadLane(
  service: QuoteServiceProcess,
  loaded: LoadedInputs,
): Promise<{ readonly result: OverloadBurstResult; readonly observations: readonly Observation[] }> {
  const requests = SERVICE_POLICY.workerCount
    + SERVICE_POLICY.maxQueuedWork
    + OVERLOAD_EXTRA_REQUESTS;
  const selected = loaded.cases.slice(-1);
  const configuration = {
    strategy: 'numerical-split' as const,
    effort: 'thorough' as const,
    deadlineMs: QUOTE_DEADLINE_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
  };
  const expected = expectedResults(selected, configuration.strategy, configuration.effort);
  await runClientLane(service.endpoint, selected, expected, 1, 1, configuration);
  await service.resetMetrics();
  await settleMetrics();
  const lane = await runClientLane(
    service.endpoint,
    selected,
    expected,
    requests,
    requests,
    configuration,
  );
  await settleMetrics();
  const server = await service.readMetrics();
  const overloaded = lane.observations.filter((value) =>
    value.status === 503 && value.errorCode === 'overloaded'
  );
  const result: OverloadBurstResult = Object.freeze({
    mode: 'worker',
    requests,
    activeCapacity: SERVICE_POLICY.workerCount,
    queueCapacity: SERVICE_POLICY.maxQueuedWork,
    acceptedCount: server.admissionAcceptedCount,
    overloadedCount: overloaded.length,
    retryAfterCount: overloaded.filter((value) => value.retryAfterPresent).length,
    acceptedExactQuoteCount: lane.observations.filter((value) =>
      value.outcome === 'completed' && value.exactValidationPassed && value.semanticMatch
    ).length,
    clientTimeoutCount: lane.observations.filter((value) => value.outcome === 'timed-out').length,
    schemaOrInternalFailureCount: lane.observations.filter((value) =>
      value.outcome === 'schema-failure'
      || (value.outcome === 'typed-error' && value.errorCode !== 'overloaded')
    ).length,
    server,
  });
  return Object.freeze({ result, observations: lane.observations });
}

async function runMode(
  mode: ServiceMode,
  concurrencyLevels: readonly number[],
  loaded: LoadedInputs,
  requests: number,
  warmups: number,
  root: string,
  includeSpecialLanes: boolean,
): Promise<ModeRun> {
  const expected = expectedResults(loaded.cases, 'greedy-split', 'fast');
  const configuration = {
    strategy: 'greedy-split' as const,
    effort: 'fast' as const,
    deadlineMs: QUOTE_DEADLINE_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
  };
  const service = await startQuoteServiceProcess(root, mode);
  const rows: ServiceLoadRow[] = [];
  const observations: (Observation & { readonly mode: ServiceMode })[] = [];
  let deadlineSweep: readonly DeadlineLoadRow[] = Object.freeze([]);
  let overloadBurst: OverloadBurstResult | null = null;
  try {
    for (const concurrency of concurrencyLevels) {
      await runClientLane(service.endpoint, loaded.cases, expected, 1, warmups, configuration);
      await service.resetMetrics();
      await settleMetrics();
      const lane = await runClientLane(
        service.endpoint,
        loaded.cases,
        expected,
        concurrency,
        requests,
        configuration,
      );
      await settleMetrics();
      const server = await service.readMetrics();
      observations.push(...lane.observations.map((value) => Object.freeze({ ...value, mode })));
      rows.push(makeServiceLoadRow(
        mode,
        concurrency,
        requests,
        lane.elapsed,
        lane.observations,
        server,
      ));
    }
    if (mode === 'worker' && includeSpecialLanes) {
      const deadlines = await runDeadlineLanes(service, loaded, DEADLINE_REQUESTS, FULL_WARMUPS);
      deadlineSweep = deadlines.rows;
      observations.push(...deadlines.observations.map((value) =>
        Object.freeze({ ...value, mode })
      ));
      const overload = await runOverloadLane(service, loaded);
      overloadBurst = overload.result;
      observations.push(...overload.observations.map((value) =>
        Object.freeze({ ...value, mode })
      ));
    }
  } finally {
    await service.shutdown();
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    deadlineSweep,
    overloadBurst,
    observations: Object.freeze(observations),
    logs: service.logs,
  });
}

function improvementPpm(baseline: number, treatment: number): number | null {
  return baseline <= 0 ? null : Math.floor((baseline - treatment) * 1_000_000 / baseline);
}

function workerDecision(
  rows: readonly ServiceLoadRow[],
  evaluated: boolean,
): ServiceLoadReport['workerDecision'] {
  if (!evaluated) return Object.freeze({
    evaluated: false,
    retained: false,
    decision: 'not-evaluated',
    gate: null,
    reason: 'A worker decision requires the full same-run comparison.',
  });
  const same1 = rows.find((value) => value.mode === 'same-thread' && value.concurrency === 1);
  const worker1 = rows.find((value) => value.mode === 'worker' && value.concurrency === 1);
  const same16 = rows.find((value) => value.mode === 'same-thread' && value.concurrency === 16);
  const worker16 = rows.find((value) => value.mode === 'worker' && value.concurrency === 16);
  if (same1 === undefined || worker1 === undefined || same16 === undefined || worker16 === undefined) {
    throw new Error('Worker retention requires concurrency 1 and 16 for both modes.');
  }
  const p95 = improvementPpm(
    same16.successfulLatency?.p95Micros ?? 0,
    worker16.successfulLatency?.p95Micros ?? 0,
  );
  const p99 = improvementPpm(
    same16.successfulLatency?.p99Micros ?? 0,
    worker16.successfulLatency?.p99Micros ?? 0,
  );
  const tail = (p99 ?? Number.NEGATIVE_INFINITY) > (p95 ?? Number.NEGATIVE_INFINITY)
    ? { metric: 'p99' as const, value: p99 }
    : { metric: 'p95' as const, value: p95 };
  const eventLoop = improvementPpm(
    same16.server.eventLoopDelayMaxMicros,
    worker16.server.eventLoopDelayMaxMicros,
  );
  const throughputRatio = same16.throughputPerSecond <= 0
    ? null
    : Math.floor(worker16.throughputPerSecond * 1_000_000 / same16.throughputPerSecond);
  const p50Overhead = worker1.successfulLatency === null || same1.successfulLatency === null
    ? null
    : worker1.successfulLatency.p50Micros - same1.successfulLatency.p50Micros;
  const semanticAndSchemaRegressionFree = rows.every((value) =>
    value.completed === value.requests
    && value.responseSchemaFailures === 0
    && value.semanticMatchCount === value.requests
  );
  const noLostRequests = rows.every((value) =>
    value.completed + value.typedErrors + value.timedOut + value.responseSchemaFailures
      === value.requests
    && value.server.structuredCompletionCount === value.requests
  );
  const memoryReported = rows.every((value) =>
    value.server.initialRssBytes > 0
    && value.server.peakRssBytes >= value.server.initialRssBytes
    && value.server.finalRssBytes > 0
  );
  const gate: WorkerRetentionGate = Object.freeze({
    semanticAndSchemaRegressionFree,
    tailLatencyMetric: tail.value === null ? null : tail.metric,
    tailLatencyImprovementPpm: tail.value,
    eventLoopMaxImprovementPpm: eventLoop,
    tailOrEventLoopPassed: (tail.value ?? Number.NEGATIVE_INFINITY) >= 250_000
      || (eventLoop ?? Number.NEGATIVE_INFINITY) >= 500_000,
    concurrency16ThroughputRatioPpm: throughputRatio,
    throughputPassed: (throughputRatio ?? 0) >= 900_000,
    concurrency1P50OverheadMicros: p50Overhead,
    concurrency1OverheadPassed: p50Overhead !== null && p50Overhead <= 2_000,
    noLostRequests,
    memoryReported,
  });
  const retained = Object.values(gate).filter((value) => typeof value === 'boolean')
    .every((value) => value);
  return Object.freeze({
    evaluated: true,
    retained,
    decision: retained ? 'retained' : 'rejected',
    gate,
    reason: retained
      ? 'The frozen semantic, tail, throughput, c1 overhead, admission, and memory gates passed.'
      : 'At least one frozen semantic, tail, throughput, c1 overhead, admission, or memory gate failed.',
  });
}

async function writeReport(
  report: ServiceLoadReport,
  observations: readonly (Observation & { readonly mode: ServiceMode })[],
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

function validateSpecialLanes(report: ServiceLoadReport, issues: string[]): void {
  for (const value of report.deadlineSweep) {
    const classified = Object.values(value.classifications).reduce((sum, count) => sum + count, 0);
    if (classified !== value.requests) issues.push(`${value.deadlineMs}ms: classifications mismatch.`);
    if (value.requests < 100) issues.push(`${value.deadlineMs}ms: insufficient rate observations.`);
    if (
      value.exactValidationCount
      !== value.classifications['complete-exact-quote']
        + value.classifications['validated-deadline-incumbent']
    ) issues.push(`${value.deadlineMs}ms: exact validation count mismatch.`);
    if (
      value.server.admissionAcceptedCount + value.server.admissionRejectedCount !== value.requests
      || value.server.structuredCompletionCount !== value.requests
    ) issues.push(`${value.deadlineMs}ms: server admission counts mismatch.`);
  }
  const burst = report.overloadBurst;
  if (burst !== null && (
    burst.requests <= burst.activeCapacity + burst.queueCapacity
    || burst.overloadedCount === 0
    || burst.retryAfterCount !== burst.overloadedCount
    || burst.acceptedExactQuoteCount !== burst.acceptedCount
    || burst.clientTimeoutCount !== 0
    || burst.schemaOrInternalFailureCount !== 0
    || burst.acceptedCount + burst.overloadedCount !== burst.requests
    || burst.server.maximumQueuedWork > burst.queueCapacity
    || burst.server.admissionAcceptedCount !== burst.acceptedCount
    || burst.server.admissionRejectedCount !== burst.overloadedCount
    || burst.server.structuredCompletionCount !== burst.requests
  )) issues.push('Overload burst did not satisfy its bounded admission contract.');
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
      value.completed + value.typedErrors + value.timedOut + value.responseSchemaFailures
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
      value.server.admissionAcceptedCount + value.server.admissionRejectedCount !== value.requests
      || value.server.structuredCompletionCount !== value.requests
    ) issues.push(`${key}: server admission counts do not reconcile.`);
  }
  if (report.workerDecision.evaluated) {
    if (report.comparisonIdentity === null) issues.push('Worker decision lacks comparison identity.');
    else if (
      JSON.stringify(report.comparisonIdentity.sameThread)
      !== JSON.stringify(report.comparisonIdentity.worker)
    ) issues.push('Comparison modes do not share source/environment identity.');
    if (!report.rows.some((value) => value.mode === 'same-thread')
      || !report.rows.some((value) => value.mode === 'worker')) {
      issues.push('Worker decision lacks both comparison modes.');
    }
  }
  validateSpecialLanes(report, issues);
  return Object.freeze(issues);
}

function validateConcurrency(concurrencyLevels: readonly number[]): void {
  if (
    concurrencyLevels.length === 0
    || concurrencyLevels.some((value) =>
      !Number.isSafeInteger(value) || value < 1 || value > 64
    )
    || new Set(concurrencyLevels).size !== concurrencyLevels.length
  ) throw new Error('Concurrency levels must be unique integers from 1 through 64.');
}

export async function runHttpLoad(
  concurrencyLevels: readonly number[],
  options: {
    readonly smoke?: boolean;
    readonly root?: string;
    readonly mode?: ServiceLoadMode;
  } = {},
): Promise<ServiceLoadReport> {
  validateConcurrency(concurrencyLevels);
  const root = options.root ?? process.cwd();
  const smoke = options.smoke ?? false;
  const mode = options.mode ?? 'same-thread';
  if (!smoke && mode === 'worker') {
    throw new Error('Retained worker evidence requires compare mode in one invocation.');
  }
  if (!smoke && mode === 'compare' && (!concurrencyLevels.includes(1)
    || !concurrencyLevels.includes(16))) {
    throw new Error('Retained compare mode requires concurrency 1 and 16.');
  }
  const evidenceSource = smoke ? inspectEvidenceSource(root) : captureEvidenceSource(root);
  const reportEnvironment = environment(evidenceSource.revision);
  const requests = smoke ? SMOKE_REQUESTS : FULL_REQUESTS;
  const warmups = smoke ? SMOKE_WARMUPS : FULL_WARMUPS;
  const loaded = await loadHistoricalPortfolioCases(root);
  const modes: readonly ServiceMode[] = mode === 'compare'
    ? Object.freeze(['same-thread', 'worker'])
    : Object.freeze([mode]);
  const runs: ModeRun[] = [];
  for (const runModeName of modes) {
    runs.push(await runMode(
      runModeName,
      concurrencyLevels,
      loaded,
      requests,
      warmups,
      root,
      !smoke && mode === 'compare',
    ));
  }
  const rows = Object.freeze(runs.flatMap((value) => value.rows));
  const identity = executionIdentity(evidenceSource, reportEnvironment);
  const evaluated = !smoke && mode === 'compare';
  const report: ServiceLoadReport = Object.freeze({
    schemaVersion: 'routelab.service-load-summary.v2',
    evidenceSource,
    observedAt: new Date().toISOString(),
    environment: reportEnvironment,
    comparisonIdentity: mode === 'compare'
      ? Object.freeze({ sameThread: identity, worker: identity })
      : null,
    corpus: Object.freeze({
      corpusId: loaded.corpus.corpusId,
      snapshotId: loaded.corpus.snapshotId,
      snapshotChecksum: loaded.corpus.snapshotChecksum,
      requestCount: loaded.corpus.requestCount,
      claim: 'synthetic exact-input requests derived from one historical pool-reserve snapshot',
    }),
    configuration: Object.freeze({
      modes,
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
      deadlineConcurrency: DEADLINE_CONCURRENCY,
      deadlineValuesMs: DEADLINES_MS,
      deadlineRequestsPerValue: smoke ? 0 : DEADLINE_REQUESTS,
      overloadBurstRequests: smoke
        ? 0
        : SERVICE_POLICY.workerCount + SERVICE_POLICY.maxQueuedWork + OVERLOAD_EXTRA_REQUESTS,
    }),
    rows,
    deadlineSweep: Object.freeze(runs.flatMap((value) => value.deadlineSweep)),
    overloadBurst: runs.find((value) => value.overloadBurst !== null)?.overloadBurst ?? null,
    workerDecision: workerDecision(rows, evaluated),
  });
  const issues = validateServiceLoadReport(report);
  if (issues.length !== 0) throw new Error(`Service load report is invalid: ${issues.join(' ')}`);
  const observations = Object.freeze(runs.flatMap((value) => value.observations));
  const logs = Object.freeze(runs.flatMap((value) => value.logs));
  if (!smoke) await writeReport(report, observations, logs, root);
  else {
    const raw = path.join(root, 'reports', 'raw');
    await mkdir(raw, { recursive: true });
    await writeFile(path.join(raw, 'service-v2-smoke-observations.json'), `${JSON.stringify({
      report,
      observations,
      serviceLogs: logs,
    })}\n`);
  }
  return report;
}

async function writeStandaloneRaw(root: string, name: string, value: unknown): Promise<void> {
  const raw = path.join(root, 'reports', 'raw');
  await mkdir(raw, { recursive: true });
  await writeFile(path.join(raw, name), `${JSON.stringify(value)}\n`);
}

export async function runDeadlineSweep(
  root = process.cwd(),
  options: { readonly smoke?: boolean } = {},
): Promise<readonly DeadlineLoadRow[]> {
  const smoke = options.smoke ?? false;
  const source = smoke ? inspectEvidenceSource(root) : captureEvidenceSource(root);
  const loaded = await loadHistoricalPortfolioCases(root);
  const service = await startQuoteServiceProcess(root, 'worker');
  try {
    const result = await runDeadlineLanes(
      service,
      loaded,
      smoke ? 24 : DEADLINE_REQUESTS,
      smoke ? SMOKE_WARMUPS : FULL_WARMUPS,
    );
    await writeStandaloneRaw(root, 'service-v2-deadline-observations.json', {
      schemaVersion: 'routelab.service-deadline-observations.v1',
      evidenceSource: source,
      rows: result.rows,
      observations: result.observations,
    });
    return result.rows;
  } finally {
    await service.shutdown();
  }
}

export async function runOverloadBurst(
  root = process.cwd(),
  options: { readonly smoke?: boolean } = {},
): Promise<OverloadBurstResult> {
  const source = options.smoke ? inspectEvidenceSource(root) : captureEvidenceSource(root);
  const loaded = await loadHistoricalPortfolioCases(root);
  const service = await startQuoteServiceProcess(root, 'worker');
  try {
    const result = await runOverloadLane(service, loaded);
    const shell: ServiceLoadReport = {
      schemaVersion: 'routelab.service-load-summary.v2',
      evidenceSource: source,
      observedAt: new Date().toISOString(),
      environment: environment(source.revision),
      comparisonIdentity: null,
      corpus: {
        corpusId: loaded.corpus.corpusId,
        snapshotId: loaded.corpus.snapshotId,
        snapshotChecksum: loaded.corpus.snapshotChecksum,
        requestCount: loaded.corpus.requestCount,
        claim: 'synthetic exact-input requests derived from one historical pool-reserve snapshot',
      },
      configuration: {
        modes: ['worker'],
        processModel: 'isolated-load-generator-and-server-processes',
        host: '127.0.0.1',
        requestsPerConcurrency: 0,
        warmupsPerConcurrency: 0,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        quoteDeadlineMs: QUOTE_DEADLINE_MS,
        strategy: 'greedy-split',
        effort: 'fast',
        caseCount: loaded.cases.length,
        sameThreadMaximumActiveWork: SERVICE_POLICY.maxActiveWork,
        workerMaximumActiveWork: SERVICE_POLICY.workerCount,
        maximumQueuedWork: SERVICE_POLICY.maxQueuedWork,
        workerCount: SERVICE_POLICY.workerCount,
        deadlineConcurrency: DEADLINE_CONCURRENCY,
        deadlineValuesMs: DEADLINES_MS,
        deadlineRequestsPerValue: 0,
        overloadBurstRequests: result.result.requests,
      },
      rows: [],
      deadlineSweep: [],
      overloadBurst: result.result,
      workerDecision: {
        evaluated: false,
        retained: false,
        decision: 'not-evaluated',
        gate: null,
        reason: 'Standalone overload behavior does not make a worker retention decision.',
      },
    };
    const issues: string[] = [];
    validateSpecialLanes(shell, issues);
    if (issues.length !== 0) throw new Error(issues.join(' '));
    await writeStandaloneRaw(root, 'service-v2-overload-observations.json', {
      schemaVersion: 'routelab.service-overload-observations.v1',
      evidenceSource: source,
      result: result.result,
      observations: result.observations,
    });
    return result.result;
  } finally {
    await service.shutdown();
  }
}
