import type { ExactInputSplitReplayReceipt } from '../replay/exact-input-split/index.ts';
import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeResult,
  type ExactInputSplitWorkCounters,
} from '../router/anytime-exact-input-split/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitDiagnostic,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCounters,
} from '../router/numerical-exact-input-split/index.ts';
import {
  prepareRoutingContext,
  replayPreparedExactInputSplit,
  type PreparedRoutingContext,
} from '../runtime/prepared-routing-context/index.ts';
import { parseLiquiditySnapshot } from '../domain/index.ts';
import { effortProfile } from './effort-profiles.ts';
import { computePlanFingerprint } from './plan-fingerprint.ts';
import type {
  PrepareSnapshotResult,
  QuoteDiagnostics,
  QuoteEffort,
  QuoteError,
  QuoteOptions,
  QuoteRequest,
  QuoteResult,
  QuoteRoute,
  QuoteStrategy,
  QuoteTermination,
  RoutingContext,
  ValidatedQuote,
} from './types.ts';

interface RoutingContextState {
  readonly prepared: PreparedRoutingContext;
}

interface CapturedRequest {
  readonly snapshotId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxRoutes: number;
}

interface CapturedOptions {
  readonly strategy: QuoteStrategy;
  readonly effort: QuoteEffort;
  readonly deadlineMs: number | undefined;
  readonly includeDiagnostics: boolean;
}

type RuntimeResult = ExactInputSplitRuntimeResult | NumericalExactInputSplitRuntimeResult;
type RuntimeCounters = ExactInputSplitWorkCounters | NumericalExactInputSplitWorkCounters;

const contextStates = new WeakMap<RoutingContext, RoutingContextState>();
const STRATEGIES = new Set<QuoteStrategy>(['best-single', 'greedy-split', 'numerical-split']);
const EFFORTS = new Set<QuoteEffort>(['fast', 'balanced', 'thorough']);

function failure(error: QuoteError): QuoteResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

function invalid(field: string, message: string): QuoteResult {
  return failure({ code: 'invalid-request', field, message });
}

export function prepareSnapshot(input: unknown): PrepareSnapshotResult {
  const parsed = parseLiquiditySnapshot(input);
  if (!parsed.ok) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'invalid-snapshot',
        issues: Object.freeze(parsed.errors.map((issue) => Object.freeze({ ...issue }))),
      }),
    });
  }
  const prepared = prepareRoutingContext(parsed.value);
  if (!prepared.ok) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'snapshot-mismatch',
        expected: prepared.error.expected,
        actual: prepared.error.actual,
      }),
    });
  }
  const context = Object.freeze({
    snapshotId: parsed.value.snapshotId,
    snapshotChecksum: parsed.value.snapshotChecksum,
  }) as RoutingContext;
  contextStates.set(context, Object.freeze({ prepared: prepared.value }));
  return Object.freeze({ ok: true, value: context });
}

function captureRequest(source: QuoteRequest): CapturedRequest | QuoteResult {
  let snapshotId: unknown;
  let assetIn: unknown;
  let assetOut: unknown;
  let amountIn: unknown;
  let maxHops: unknown;
  let maxRoutes: unknown;
  try {
    snapshotId = source.snapshotId;
    assetIn = source.assetIn;
    assetOut = source.assetOut;
    amountIn = source.amountIn;
    maxHops = source.maxHops ?? 3;
    maxRoutes = source.maxRoutes ?? 3;
  } catch {
    return invalid('request', 'The quote request could not be read.');
  }
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    return invalid('snapshotId', 'snapshotId must be a nonempty string.');
  }
  if (typeof assetIn !== 'string' || assetIn.length === 0) {
    return invalid('assetIn', 'assetIn must be a nonempty string.');
  }
  if (typeof assetOut !== 'string' || assetOut.length === 0) {
    return invalid('assetOut', 'assetOut must be a nonempty string.');
  }
  if (assetIn === assetOut) return invalid('assetOut', 'assetIn and assetOut must differ.');
  if (typeof amountIn !== 'bigint' || amountIn <= 0n) {
    return invalid('amountIn', 'amountIn must be positive.');
  }
  if (!Number.isSafeInteger(maxHops) || (maxHops as number) < 1 || (maxHops as number) > 8) {
    return invalid('maxHops', 'maxHops must be a safe integer from 1 through 8.');
  }
  if (!Number.isSafeInteger(maxRoutes) || (maxRoutes as number) < 1 || (maxRoutes as number) > 4) {
    return invalid('maxRoutes', 'maxRoutes must be a safe integer from 1 through 4.');
  }
  return Object.freeze({
    snapshotId,
    assetIn,
    assetOut,
    amountIn,
    maxHops,
    maxRoutes,
  }) as CapturedRequest;
}

function captureOptions(source: QuoteOptions | undefined): CapturedOptions | QuoteResult {
  let strategy: unknown = 'greedy-split';
  let effort: unknown = 'balanced';
  let deadlineMs: unknown;
  let includeDiagnostics: unknown = false;
  try {
    if (source !== undefined) {
      strategy = source.strategy ?? strategy;
      effort = source.effort ?? effort;
      deadlineMs = source.deadlineMs;
      includeDiagnostics = source.includeDiagnostics ?? false;
    }
  } catch {
    return invalid('options', 'The quote options could not be read.');
  }
  if (typeof strategy !== 'string' || !STRATEGIES.has(strategy as QuoteStrategy)) {
    return invalid('strategy', 'strategy must be best-single, greedy-split, or numerical-split.');
  }
  if (typeof effort !== 'string' || !EFFORTS.has(effort as QuoteEffort)) {
    return invalid('effort', 'effort must be fast, balanced, or thorough.');
  }
  if (
    deadlineMs !== undefined &&
    (!Number.isSafeInteger(deadlineMs) || (deadlineMs as number) < 0 || (deadlineMs as number) > 60_000)
  ) {
    return invalid('deadlineMs', 'deadlineMs must be a safe integer from 0 through 60000.');
  }
  if (typeof includeDiagnostics !== 'boolean') {
    return invalid('includeDiagnostics', 'includeDiagnostics must be boolean.');
  }
  return Object.freeze({ strategy, effort, deadlineMs, includeDiagnostics }) as CapturedOptions;
}

function isFailure(value: CapturedRequest | CapturedOptions | QuoteResult): value is QuoteResult {
  return 'ok' in value;
}

function runtimeResult(
  state: RoutingContextState,
  context: RoutingContext,
  request: CapturedRequest,
  options: CapturedOptions,
  started: bigint,
): RuntimeResult {
  const profile = effortProfile(options.effort);
  const maxRoutes = options.strategy === 'best-single' ? 1 : request.maxRoutes;
  const runtimeRequest = {
    snapshotId: context.snapshotId,
    snapshotChecksum: context.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
    maxRoutes,
    greedyParts: profile.greedyParts,
  };
  const deadline = options.deadlineMs === undefined
    ? undefined
    : Object.freeze({
        deadlineNanoseconds: started + BigInt(options.deadlineMs) * 1_000_000n,
        nowNanoseconds: () => process.hrtime.bigint(),
      });
  const baseCaps = {
    maxPathExpansions: profile.workCaps.maxPathExpansions,
    maxBestSingleCandidateReplays: profile.workCaps.maxBestSingleCandidateReplays,
    maxCandidateSetExpansions: profile.workCaps.maxCandidateSetExpansions,
    maxEqualProposalReplays: profile.workCaps.maxEqualProposalReplays,
    maxGreedyOptionReplays: profile.workCaps.maxGreedyOptionReplays,
    maxFinalAuthorizationReplays: profile.workCaps.maxFinalAuthorizationReplays,
  };
  const baseControl = deadline === undefined
    ? { workCaps: baseCaps }
    : { workCaps: baseCaps, deadline };
  if (options.strategy !== 'numerical-split') {
    return routeExactInputSplitAnytime(state.prepared, runtimeRequest, baseControl);
  }
  const numericalControl = deadline === undefined
    ? { workCaps: profile.workCaps }
    : { workCaps: profile.workCaps, deadline };
  return routeExactInputSplitNumericalAnytime(
    state.prepared,
    { ...runtimeRequest, numerical: profile.numerical },
    numericalControl,
  );
}

function mapRuntimeFailure(result: RuntimeResult): QuoteResult {
  if (result.status === 'invalid-request') {
    if (result.error.code === 'snapshot-identity-mismatch') {
      return failure({ code: 'snapshot-mismatch', message: 'The request does not match the prepared snapshot.' });
    }
    return invalid(result.error.field, `The routing core rejected ${result.error.field}.`);
  }
  if (result.status === 'invalid-control') {
    return failure({ code: 'internal-invariant-failure', message: 'A frozen effort profile was invalid.' });
  }
  if (result.status === 'no-route') {
    return failure({ code: 'no-route', message: 'No exact route was found within the requested bounds.' });
  }
  if (result.status === 'no-plan') {
    if (result.reason === 'deadline') {
      return failure({
        code: 'deadline-before-plan',
        message: 'The deadline was reached before an exact plan was available.',
      });
    }
    return failure({ code: 'no-route', message: 'No exact plan was available within the effort profile.' });
  }
  return failure({ code: 'dependency-failure', message: 'The routing control boundary failed.' });
}

function authorize(
  prepared: PreparedRoutingContext,
  receipt: ExactInputSplitReplayReceipt,
): ExactInputSplitReplayReceipt | undefined {
  const replay = replayPreparedExactInputSplit(prepared, {
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn,
    legs: receipt.legs.map((leg) => ({
      allocation: leg.allocation,
      route: leg.receipt.hops.map(({ poolId, assetIn, assetOut }) => ({
        poolId,
        assetIn,
        assetOut,
      })),
    })),
  });
  return replay.ok ? replay.value : undefined;
}

function routes(receipt: ExactInputSplitReplayReceipt): readonly QuoteRoute[] {
  return Object.freeze(receipt.legs.map((leg) => Object.freeze({
    allocation: leg.allocation,
    amountOut: leg.receipt.amountOut,
    hops: Object.freeze(leg.receipt.hops.map((hop) => Object.freeze({
      poolId: hop.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn: hop.amountIn,
      amountOut: hop.amountOut,
    }))),
  })));
}

function numericCounter(counters: RuntimeCounters, field: string): number {
  const value = (counters as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : 0;
}

function diagnostics(
  counters: RuntimeCounters,
  numerical: readonly NumericalExactInputSplitDiagnostic[],
  strategy: QuoteStrategy,
): QuoteDiagnostics {
  const attemptedProposals = numerical.filter(
    ({ counters: value }) => value.numericalProposals > 0,
  );
  const convergedProposals = attemptedProposals.filter(({ converged }) => converged).length;
  const numericalOutcome = strategy !== 'numerical-split' || numerical.length === 0
    ? 'not-applicable' as const
    : numerical.some(({ status }) => status === 'improved')
      ? 'improved' as const
      : numerical.some(({ status }) => status === 'not-better')
        ? 'not-better' as const
        : numerical.some(({ status }) => status === 'failed')
          ? 'failed' as const
          : 'stopped' as const;
  return Object.freeze({
    work: work(counters),
    pathExpansions: counters.pathExpansions,
    candidateSetExpansions: counters.candidateSetExpansions,
    numericalProposals: numericCounter(counters, 'numericalProposals'),
    numericalConvergedProposals: convergedProposals,
    numericalFailedProposals: attemptedProposals.length - convergedProposals,
    numericalIterations: numericCounter(counters, 'numericalIterations'),
    allProposalsConverged: strategy === 'numerical-split'
      ? attemptedProposals.length > 0 && attemptedProposals.every(({ converged }) => converged)
      : null,
    numericalFailures: numerical.filter(({ status }) => status === 'failed').length,
    numericalOutcome,
    authorizationRejections:
      counters.finalAuthorizationRejections +
      numericCounter(counters, 'numericalAuthorizationReplayRejections'),
  });
}

function work(counters: RuntimeCounters): Readonly<Record<string, number>> {
  return Object.freeze({ ...counters });
}

function termination(value: string): QuoteTermination {
  if (value === 'complete' || value === 'work-limit' || value === 'deadline' || value === 'interrupted') {
    return value;
  }
  return 'interrupted';
}

export function quote(
  context: RoutingContext,
  sourceRequest: QuoteRequest,
  sourceOptions?: QuoteOptions,
): QuoteResult {
  const started = process.hrtime.bigint();
  const state = contextStates.get(context);
  if (state === undefined) {
    return failure({ code: 'snapshot-mismatch', message: 'context was not created by prepareSnapshot.' });
  }
  const capturedRequest = captureRequest(sourceRequest);
  if (isFailure(capturedRequest)) return capturedRequest;
  if (capturedRequest.snapshotId !== context.snapshotId) {
    return failure({
      code: 'snapshot-mismatch',
      message: 'request.snapshotId must match the prepared snapshot.',
    });
  }
  const capturedOptions = captureOptions(sourceOptions);
  if (isFailure(capturedOptions)) return capturedOptions;

  const result = runtimeResult(state, context, capturedRequest, capturedOptions, started);
  if (result.status !== 'success') return mapRuntimeFailure(result);
  const authorized = authorize(state.prepared, result.plan.receipt);
  if (authorized === undefined) {
    return failure({
      code: 'internal-invariant-failure',
      message: 'Fresh exact replay rejected the selected plan.',
    });
  }
  const numerical = 'numericalDiagnostics' in result.plan.search
    ? result.plan.search.numericalDiagnostics
    : Object.freeze([]);
  const selectedRoutes = routes(authorized);
  const selectedNumericalImprovement = numerical.some(({ status }) => status === 'improved');
  const execution = Object.freeze({
    snapshotId: authorized.snapshotId,
    snapshotChecksum: authorized.snapshotChecksum,
    assetIn: authorized.assetIn,
    assetOut: authorized.assetOut,
    amountIn: authorized.amountIn,
    amountOut: authorized.amountOut,
    routes: selectedRoutes,
    requestedStrategy: capturedOptions.strategy,
    effort: capturedOptions.effort,
    planKind: selectedRoutes.length === 1 ? 'single' as const : 'split' as const,
    ...(capturedOptions.strategy === 'numerical-split'
      ? { numericalImprovementSelected: selectedNumericalImprovement }
      : {}),
    termination: termination(result.plan.search.termination),
  });
  const value: ValidatedQuote = {
    ...execution,
    planFingerprint: computePlanFingerprint(execution),
    timing: Object.freeze({
      elapsedMicros: Number((process.hrtime.bigint() - started) / 1_000n),
    }),
    ...(capturedOptions.includeDiagnostics
      ? { diagnostics: diagnostics(result.plan.search.counters, numerical, capturedOptions.strategy) }
      : {}),
  };
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}
