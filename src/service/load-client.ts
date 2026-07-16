import type { PortfolioCase } from '../benchmark/portfolio/types.ts';
import { computePlanFingerprint } from '../public/plan-fingerprint.ts';
import type { QuoteEffort, QuoteStrategy, SerializedQuote } from '../public/types.ts';
import { replayExactInputSplit } from '../replay/exact-input-split/index.ts';
import { parseSerializedQuote } from './serialized-quote.ts';
import type {
  ClientLatencyDistribution,
  DeadlineClassification,
  DeadlineLoadRow,
  ServiceLoadRow,
  ServiceMode,
} from './load-types.ts';
import type { ServiceMetrics } from './types.ts';

export interface ExpectedResult {
  readonly amountOut: string;
  readonly planFingerprint: string;
}

export interface LoadRequestConfiguration {
  readonly strategy: QuoteStrategy;
  readonly effort: QuoteEffort;
  readonly deadlineMs: number;
  readonly timeoutMs: number;
}

export interface Observation {
  readonly sequence: number;
  readonly concurrency: number;
  readonly caseId: string;
  readonly elapsedNanoseconds: string;
  readonly outcome: 'completed' | 'typed-error' | 'timed-out' | 'schema-failure';
  readonly status: number | null;
  readonly errorCode: string | null;
  readonly retryAfterPresent: boolean;
  readonly exactOutputPresent: boolean;
  readonly fingerprintPresent: boolean;
  readonly exactValidationPassed: boolean;
  readonly semanticMatch: boolean;
  readonly termination: string | null;
  readonly deadlineClassification: DeadlineClassification;
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function clientDistribution(
  values: readonly number[],
): ClientLatencyDistribution | null {
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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function bodyFor(input: PortfolioCase, configuration: LoadRequestConfiguration): string {
  return JSON.stringify({
    snapshotId: input.request.snapshotId,
    assetIn: input.request.assetIn,
    assetOut: input.request.assetOut,
    amountIn: input.request.amountIn.toString(10),
    maxHops: input.request.maxHops,
    maxRoutes: input.request.maxRoutes,
    strategy: configuration.strategy,
    effort: configuration.effort,
    deadlineMs: configuration.deadlineMs,
  });
}

function exactQuoteMatchesCase(value: SerializedQuote, input: PortfolioCase): boolean {
  if (
    value.snapshotId !== input.snapshot.snapshotId
    || value.snapshotChecksum !== input.snapshot.snapshotChecksum
    || value.assetIn !== input.request.assetIn
    || value.assetOut !== input.request.assetOut
    || value.amountIn !== input.request.amountIn.toString(10)
    || value.routes.reduce((sum, route) => sum + BigInt(route.allocation), 0n)
      !== input.request.amountIn
    || value.planKind !== (value.routes.length === 1 ? 'single' : 'split')
  ) return false;
  const replay = replayExactInputSplit(input.snapshot, {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: value.assetIn,
    assetOut: value.assetOut,
    amountIn: BigInt(value.amountIn),
    legs: value.routes.map((route) => ({
      allocation: BigInt(route.allocation),
      route: route.hops.map(({ poolId, assetIn, assetOut }) => ({
        poolId,
        assetIn,
        assetOut,
      })),
    })),
  });
  if (!replay.ok || replay.value.amountOut.toString(10) !== value.amountOut) return false;
  const replayMatchesWire = replay.value.legs.every((leg, routeIndex) => {
    const route = value.routes[routeIndex];
    return route !== undefined
      && leg.allocation.toString(10) === route.allocation
      && leg.receipt.amountOut.toString(10) === route.amountOut
      && leg.receipt.hops.every((hop, hopIndex) => {
        const wireHop = route.hops[hopIndex];
        return wireHop !== undefined
          && hop.poolId === wireHop.poolId
          && hop.assetIn === wireHop.assetIn
          && hop.assetOut === wireHop.assetOut
          && hop.amountIn.toString(10) === wireHop.amountIn
          && hop.amountOut.toString(10) === wireHop.amountOut;
      });
  });
  if (!replayMatchesWire) return false;
  return computePlanFingerprint({
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: value.assetIn,
    assetOut: value.assetOut,
    amountIn: BigInt(value.amountIn),
    amountOut: BigInt(value.amountOut),
    routes: value.routes.map((route) => ({
      allocation: BigInt(route.allocation),
      amountOut: BigInt(route.amountOut),
      hops: route.hops.map((hop) => ({
        poolId: hop.poolId,
        assetIn: hop.assetIn,
        assetOut: hop.assetOut,
        amountIn: BigInt(hop.amountIn),
        amountOut: BigInt(hop.amountOut),
      })),
    })),
  }) === value.planFingerprint;
}

function deadlineClassification(
  responseOk: boolean,
  exactValidationPassed: boolean,
  termination: string | null,
  status: number | null,
  errorCode: string | null,
  timedOut: boolean,
): DeadlineClassification {
  if (timedOut) return 'client-timeout';
  if (responseOk && exactValidationPassed && termination === 'complete') {
    return 'complete-exact-quote';
  }
  if (responseOk && exactValidationPassed && termination === 'deadline') {
    return 'validated-deadline-incumbent';
  }
  if (status === 408 && errorCode === 'deadline-before-plan') return 'deadline-before-plan';
  if (status === 503 && errorCode === 'overloaded') return 'overload';
  return 'schema-or-internal-failure';
}

export async function invokeService(
  endpoint: string,
  input: PortfolioCase,
  expected: ExpectedResult | undefined,
  sequence: number,
  concurrency: number,
  configuration: LoadRequestConfiguration,
): Promise<Observation> {
  const started = process.hrtime.bigint();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyFor(input, configuration),
      signal: AbortSignal.timeout(configuration.timeoutMs),
    });
    const elapsed = process.hrtime.bigint() - started;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    const value = record(json);
    const quote = response.ok ? parseSerializedQuote(json) : undefined;
    const exactOutputPresent = typeof value?.['amountOut'] === 'string'
      && /^(?:0|[1-9][0-9]*)$/u.test(value['amountOut']);
    const fingerprintPresent = typeof value?.['planFingerprint'] === 'string'
      && /^sha256:[0-9a-f]{64}$/u.test(value['planFingerprint']);
    const requestIdPresent = typeof value?.['requestId'] === 'string';
    const exactValidationPassed = quote !== undefined
      && requestIdPresent
      && quote.requestedStrategy === configuration.strategy
      && quote.effort === configuration.effort
      && exactQuoteMatchesCase(quote, input);
    const semanticMatch = exactValidationPassed && expected !== undefined
      && quote.amountOut === expected.amountOut
      && quote.planFingerprint === expected.planFingerprint;
    if (response.ok) {
      const outcome = exactValidationPassed ? 'completed' as const : 'schema-failure' as const;
      return Object.freeze({
        sequence,
        concurrency,
        caseId: input.caseId,
        elapsedNanoseconds: elapsed.toString(10),
        outcome,
        status: response.status,
        errorCode: null,
        retryAfterPresent: false,
        exactOutputPresent,
        fingerprintPresent,
        exactValidationPassed,
        semanticMatch,
        termination: quote?.termination ?? null,
        deadlineClassification: deadlineClassification(
          true,
          exactValidationPassed,
          quote?.termination ?? null,
          response.status,
          null,
          false,
        ),
      });
    }
    const error = record(value?.['error']);
    const code = typeof error?.['code'] === 'string' ? error['code'] : null;
    const valid = requestIdPresent && code !== null;
    return Object.freeze({
      sequence,
      concurrency,
      caseId: input.caseId,
      elapsedNanoseconds: elapsed.toString(10),
      outcome: valid ? 'typed-error' : 'schema-failure',
      status: response.status,
      errorCode: code,
      retryAfterPresent: response.headers.has('retry-after'),
      exactOutputPresent,
      fingerprintPresent,
      exactValidationPassed: false,
      semanticMatch: false,
      termination: null,
      deadlineClassification: deadlineClassification(
        false,
        false,
        null,
        response.status,
        code,
        false,
      ),
    });
  } catch (error) {
    const elapsed = process.hrtime.bigint() - started;
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return Object.freeze({
      sequence,
      concurrency,
      caseId: input.caseId,
      elapsedNanoseconds: elapsed.toString(10),
      outcome: timedOut ? 'timed-out' : 'schema-failure',
      status: null,
      errorCode: null,
      retryAfterPresent: false,
      exactOutputPresent: false,
      fingerprintPresent: false,
      exactValidationPassed: false,
      semanticMatch: false,
      termination: null,
      deadlineClassification: deadlineClassification(
        false,
        false,
        null,
        null,
        null,
        timedOut,
      ),
    });
  }
}

export async function runClientLane(
  endpoint: string,
  cases: readonly PortfolioCase[],
  expected: ReadonlyMap<string, ExpectedResult> | undefined,
  concurrency: number,
  requests: number,
  configuration: LoadRequestConfiguration,
): Promise<{ readonly elapsed: bigint; readonly observations: readonly Observation[] }> {
  const observations = new Array<Observation>(requests);
  let next = 0;
  const started = process.hrtime.bigint();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= requests) return;
      const input = cases[index % cases.length];
      if (input === undefined) throw new Error('Service load request corpus is empty.');
      const expectedResult = expected?.get(input.caseId);
      observations[index] = await invokeService(
        endpoint,
        input,
        expectedResult,
        index,
        concurrency,
        configuration,
      );
    }
  }));
  return Object.freeze({
    elapsed: process.hrtime.bigint() - started,
    observations: Object.freeze(observations),
  });
}

function elapsedMicros(values: readonly Observation[]): readonly number[] {
  return values.map((value) => Number(value.elapsedNanoseconds) / 1_000);
}

export function makeServiceLoadRow(
  mode: ServiceMode,
  concurrency: number,
  requests: number,
  elapsed: bigint,
  observations: readonly Observation[],
  server: ServiceMetrics,
): ServiceLoadRow {
  const completed = observations.filter((value) => value.outcome === 'completed');
  const errors = observations.filter((value) =>
    value.outcome === 'typed-error' || value.outcome === 'schema-failure'
  );
  const deadlineCompleted = completed.filter((value) => value.termination !== 'deadline').length;
  return Object.freeze({
    mode,
    concurrency,
    requests,
    completed: completed.length,
    typedErrors: observations.filter((value) => value.outcome === 'typed-error').length,
    timedOut: observations.filter((value) => value.outcome === 'timed-out').length,
    responseSchemaFailures:
      observations.filter((value) => value.outcome === 'schema-failure').length,
    exactOutputPresenceCount:
      observations.filter((value) => value.exactOutputPresent).length,
    fingerprintPresenceCount:
      observations.filter((value) => value.fingerprintPresent).length,
    semanticMatchCount: observations.filter((value) => value.semanticMatch).length,
    deadlineCompletionCount: deadlineCompleted,
    deadlineCompletionRatePpm: completed.length === 0
      ? null
      : Math.floor(deadlineCompleted * 1_000_000 / completed.length),
    successfulLatency: clientDistribution(elapsedMicros(completed)),
    errorResponseLatency: clientDistribution(elapsedMicros(errors)),
    throughputPerSecond:
      Number((BigInt(requests) * 1_000_000_000_000n) / elapsed) / 1_000,
    server,
  });
}

export function makeDeadlineLoadRow(
  deadlineMs: 25 | 50 | 100,
  requests: number,
  observations: readonly Observation[],
  server: ServiceMetrics,
): DeadlineLoadRow {
  const classifications = Object.freeze({
    'complete-exact-quote': observations.filter(
      (value) => value.deadlineClassification === 'complete-exact-quote',
    ).length,
    'validated-deadline-incumbent': observations.filter(
      (value) => value.deadlineClassification === 'validated-deadline-incumbent',
    ).length,
    'deadline-before-plan': observations.filter(
      (value) => value.deadlineClassification === 'deadline-before-plan',
    ).length,
    overload: observations.filter((value) => value.deadlineClassification === 'overload').length,
    'client-timeout': observations.filter(
      (value) => value.deadlineClassification === 'client-timeout',
    ).length,
    'schema-or-internal-failure': observations.filter(
      (value) => value.deadlineClassification === 'schema-or-internal-failure',
    ).length,
  });
  const complete = observations.filter(
    (value) => value.deadlineClassification === 'complete-exact-quote',
  );
  const incumbent = observations.filter(
    (value) => value.deadlineClassification === 'validated-deadline-incumbent',
  );
  const errors = observations.filter((value) =>
    value.deadlineClassification !== 'complete-exact-quote'
    && value.deadlineClassification !== 'validated-deadline-incumbent'
    && value.deadlineClassification !== 'client-timeout'
  );
  return Object.freeze({
    mode: 'worker',
    concurrency: 16,
    deadlineMs,
    requests,
    classifications,
    exactValidationCount: observations.filter((value) => value.exactValidationPassed).length,
    completeQuoteLatency: clientDistribution(elapsedMicros(complete)),
    deadlineIncumbentLatency: clientDistribution(elapsedMicros(incumbent)),
    errorResponseLatency: clientDistribution(elapsedMicros(errors)),
    server,
  });
}
