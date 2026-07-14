import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SERVICE_ROUTING_POLICY_V1,
  prepareServiceRoutingContext,
  type PreparedServiceRoutingContext,
} from '../../src/runtime/prepared-service-routing-context/index.ts';
import {
  captureServiceExactInputIntent,
  mintServiceExactInputControl,
  routeExactInputSplitServiceV2,
  type CapturedServiceExactInputControl,
  type CapturedServiceExactInputIntent,
  type ServiceExactInputSplitActionKind,
  type ServiceExactInputSplitCheckpoint,
  type ServiceExactInputSplitRouteResult,
  type ServiceExactInputSplitSearchSummary,
  type ServiceExactInputSplitSearchTermination,
  type ServiceExactInputSplitWorkCounters,
} from '../../src/router/service-exact-input-split/index.ts';

/**
 * Independent service-runtime oracle.
 *
 * Expected amounts below are derived directly from
 *   floor(amountIn * reserveOut / (reserveIn + amountIn))
 * for the zero-fee fixtures. Expected schedules and ledgers are stated here
 * explicitly; this file deliberately imports no replay, search, candidate-set,
 * numerical, route-key, checksum, or publication-decoder helper.
 */

interface PoolInput {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

const encoder = new TextEncoder();

function pool(
  poolId: string,
  asset0 = 'A',
  asset1 = 'B',
  reserve0 = 1_000n,
  reserve1 = 1_000n,
): PoolInput {
  return Object.freeze({
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  });
}

function sha256Utf8(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function independentSnapshotChecksum(pools: readonly PoolInput[]): string {
  const canonicalPools = [...pools]
    .sort((left, right) =>
      left.poolId < right.poolId ? -1 : left.poolId > right.poolId ? 1 : 0,
    )
    .map((candidate) => ({
      poolId: candidate.poolId,
      asset0: candidate.asset0,
      reserve0: candidate.reserve0.toString(10),
      asset1: candidate.asset1,
      reserve1: candidate.reserve1.toString(10),
      feeChargedNumerator: candidate.feeChargedNumerator.toString(10),
      feeDenominator: candidate.feeDenominator.toString(10),
    }));
  return sha256Utf8(
    JSON.stringify({
      schemaVersion: 'routelab.snapshot.v1',
      pools: canonicalPools,
    }),
  );
}

function rawSnapshot(snapshotId: string, pools: readonly PoolInput[]): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      snapshotId,
      snapshotChecksum: independentSnapshotChecksum(pools),
      pools: pools.map((candidate) => ({
        poolId: candidate.poolId,
        asset0: candidate.asset0,
        reserve0: candidate.reserve0.toString(10),
        asset1: candidate.asset1,
        reserve1: candidate.reserve1.toString(10),
        feeChargedNumerator: candidate.feeChargedNumerator.toString(10),
        feeDenominator: candidate.feeDenominator.toString(10),
      })),
    }),
  );
}

function publish(
  snapshotId: string,
  pools: readonly PoolInput[],
  nowNanoseconds: () => unknown,
): PreparedServiceRoutingContext {
  const result = prepareServiceRoutingContext(
    rawSnapshot(snapshotId, pools),
    SERVICE_ROUTING_POLICY_V1,
    nowNanoseconds,
  );
  if (!result.ok) {
    assert.fail(`service publication failed: ${result.error.code}`);
  }
  return result.value;
}

function captureIntent(
  context: PreparedServiceRoutingContext,
  snapshotId: string | undefined,
  amountIn: bigint,
  assetIn = 'A',
  assetOut = 'B',
): CapturedServiceExactInputIntent {
  const result = captureServiceExactInputIntent(
    context,
    snapshotId,
    assetIn,
    assetOut,
    amountIn,
  );
  if (!result.ok) assert.fail(`intent capture failed: ${result.error.code}`);
  return result.value;
}

function mintControl(
  context: PreparedServiceRoutingContext,
  deadline: bigint,
  shouldCancel:
    | ((checkpoint: ServiceExactInputSplitCheckpoint) => unknown)
    | undefined = undefined,
  debug = false,
): CapturedServiceExactInputControl {
  const result = mintServiceExactInputControl(
    context,
    deadline,
    shouldCancel,
    debug,
  );
  if (!result.ok) assert.fail(`control mint failed: ${result.error.code}`);
  return result.value;
}

function searchOf(
  result: Exclude<ServiceExactInputSplitRouteResult, { readonly status: 'invalid-context' }>,
): ServiceExactInputSplitSearchSummary<ServiceExactInputSplitSearchTermination> {
  return result.status === 'success' ? result.plan.search : result.search;
}

function incumbentOf(result: ServiceExactInputSplitRouteResult): unknown {
  if (result.status === 'success') return result.plan.receipt;
  if (result.status === 'dependency-error' || result.status === 'state-error') {
    return result.incumbent;
  }
  return null;
}

function emptyCounters(
  overrides: Partial<ServiceExactInputSplitWorkCounters> = {},
): ServiceExactInputSplitWorkCounters {
  return {
    aggregateTransitions: 0,
    directInspections: 0,
    directReplays: 0,
    directReplayRejections: 0,
    pathExpansions: 0,
    pathsRetained: 0,
    bestSingleReplays: 0,
    bestSingleReplayRejections: 0,
    candidateSetSteps: 0,
    candidateSetsRetained: 0,
    equalProposalReplays: 0,
    equalProposalReplayRejections: 0,
    proposalsRetained: 0,
    baselineAuthorizationReplays: 0,
    baselineAuthorizationReplayRejections: 0,
    greedyPartsStarted: 0,
    greedyOptionReplays: 0,
    greedyOptionReplayRejections: 0,
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalModelRouteSteps: 0,
    numericalOuterUpdatesStarted: 0,
    numericalOuterUpdatesCompleted: 0,
    numericalShareMicrosteps: 0,
    numericalReconstructionSteps: 0,
    numericalResidualOptionReplays: 0,
    numericalResidualOptionReplayRejections: 0,
    activationProbeReplays: 0,
    activationProbeReplayRejections: 0,
    repairNeighborReplays: 0,
    repairNeighborReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
    bookkeepingSteps: 0,
    diagnosticsRetained: 0,
    terminalProjections: 0,
    ...overrides,
  };
}

function assertCounters(
  actual: ServiceExactInputSplitWorkCounters,
  expected: Partial<ServiceExactInputSplitWorkCounters>,
): void {
  assert.deepEqual(actual, emptyCounters(expected));
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function frequency(
  actions: readonly ServiceExactInputSplitActionKind[],
): ReadonlyMap<ServiceExactInputSplitActionKind, number> {
  const counts = new Map<ServiceExactInputSplitActionKind, number>();
  for (const action of actions) counts.set(action, (counts.get(action) ?? 0) + 1);
  return counts;
}

function assertActionFrequencies(
  actions: readonly ServiceExactInputSplitActionKind[],
  expected: Readonly<Partial<Record<ServiceExactInputSplitActionKind, number>>>,
): void {
  const actual = frequency(actions);
  for (const action of ALL_ACTION_KINDS) {
    assert.equal(actual.get(action) ?? 0, expected[action] ?? 0, action);
  }
}

const ALL_ACTION_KINDS: readonly ServiceExactInputSplitActionKind[] = [
  'direct-candidate-replay',
  'path-expansion',
  'best-single-candidate-replay',
  'candidate-set-step',
  'equal-proposal-replay',
  'baseline-authorization-replay',
  'greedy-option-replay',
  'numerical-proposal-start',
  'numerical-model-route',
  'numerical-share-microstep',
  'numerical-reconstruction-step',
  'numerical-residual-option-replay',
  'activation-probe-replay',
  'repair-neighbor-replay',
  'numerical-authorization-replay',
  'proposal-bookkeeping',
  'diagnostic-bookkeeping',
  'terminal-projection',
];

const F5_POOLS = Object.freeze([
  pool('f5-left', 'A', 'B', 1n, 3n),
  pool('f5-right', 'A', 'B', 3n, 4n),
]);
const F6_POOLS = Object.freeze([
  pool('f6-left', 'A', 'B', 100n, 100n),
  pool('f6-right', 'A', 'B', 100n, 100n),
]);

void test('F0 rejects deadline equality at entry without reserving terminal work', () => {
  let clockCalls = 0;
  const context = publish('oracle-f0', [pool('f0')], function (this: void) {
    assert.equal(this, undefined);
    clockCalls += 1;
    return 17n;
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 10n),
    mintControl(context, 17n),
  );
  assert.equal(result.status, 'no-plan');
  if (result.status !== 'no-plan') return;
  assert.equal(result.reason, 'deadline-at-entry');
  assert.equal(result.search.termination, 'deadline');
  assertCounters(result.search.counters, {});
  assert.equal(clockCalls, 1);
  assertDeepFrozen(result);
});

void test('entry clock failures are all-zero and never invoke cancellation', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly clock: () => unknown;
    readonly expectedCode: 'clock-call-failed' | 'invalid-clock-sample';
  }> = [
    {
      name: 'throw',
      clock: () => {
        throw new Error('oracle entry clock failure');
      },
      expectedCode: 'clock-call-failed',
    },
    { name: 'number', clock: () => 0, expectedCode: 'invalid-clock-sample' },
    { name: 'negative', clock: () => -1n, expectedCode: 'invalid-clock-sample' },
  ];
  for (const fixture of cases) {
    let cancellationCalls = 0;
    const context = publish(
      `oracle-entry-${fixture.name}`,
      [pool(`entry-${fixture.name}`)],
      fixture.clock,
    );
    const result = routeExactInputSplitServiceV2(
      context,
      captureIntent(context, undefined, 10n),
      mintControl(context, 100n, () => {
        cancellationCalls += 1;
        return true;
      }),
    );
    assert.equal(result.status, 'dependency-error');
    if (result.status !== 'dependency-error') continue;
    assert.equal(result.dependency, 'clock');
    assert.equal(result.phase, 'entry');
    assert.equal(result.error.code, fixture.expectedCode);
    assertCounters(result.search.counters, {});
    assert.equal(cancellationCalls, 0);
    assertDeepFrozen(result);
  }
});

void test('F1 preserves the initial tranche and stops before the ninth direct route', () => {
  const pools = Array.from({ length: 9 }, (_, index) =>
    pool(`f1-${index}`, 'A', 'B', 1_000n, 1n),
  );
  let clockCalls = 0;
  let cancellationCalls = 0;
  const context = publish('oracle-f1', pools, () => {
    clockCalls += 1;
    return clockCalls === 10 ? 100n : 10n;
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 1n),
    mintControl(context, 100n, (checkpoint) => {
      cancellationCalls += 1;
      assertDeepFrozen(checkpoint);
      return false;
    }),
  );
  assert.equal(result.status, 'no-plan');
  if (result.status !== 'no-plan') return;
  assert.equal(result.reason, 'deadline-before-plan');
  assertCounters(result.search.counters, {
    aggregateTransitions: 9,
    directInspections: 8,
    directReplays: 8,
    directReplayRejections: 8,
    terminalProjections: 1,
  });
  assert.equal(clockCalls, 10);
  assert.equal(cancellationCalls, 9);
});

void test('F2 replays a two-hop ledger against transitioned zero-fee reserves', () => {
  const context = publish(
    'oracle-f2',
    [
      pool('f2-ab', 'A', 'B', 100n, 100n),
      pool('f2-bc', 'B', 'C', 100n, 100n),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 50n, 'A', 'C'),
    mintControl(context, 1n),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  // floor(50*100/(100+50))=33, then floor(33*100/(100+33))=24.
  assert.equal(result.plan.receipt.amountOut, 24n);
  assert.deepEqual(result.plan.receipt.legs.map((leg) => leg.allocation), [50n]);
  assert.deepEqual(
    result.plan.receipt.legs[0]?.receipt.hops.map((hop) => ({
      amountIn: hop.amountIn,
      amountOut: hop.amountOut,
      reserveInBefore: hop.reserveInBefore,
      reserveOutBefore: hop.reserveOutBefore,
      reserveInAfter: hop.reserveInAfter,
      reserveOutAfter: hop.reserveOutAfter,
    })),
    [
      {
        amountIn: 50n,
        amountOut: 33n,
        reserveInBefore: 100n,
        reserveOutBefore: 100n,
        reserveInAfter: 150n,
        reserveOutAfter: 67n,
      },
      {
        amountIn: 33n,
        amountOut: 24n,
        reserveInBefore: 100n,
        reserveOutBefore: 100n,
        reserveInAfter: 133n,
        reserveOutAfter: 76n,
      },
    ],
  );
  assertCounters(result.plan.search.counters, {
    aggregateTransitions: 5,
    pathExpansions: 3,
    pathsRetained: 1,
    bestSingleReplays: 1,
    terminalProjections: 1,
  });
});

void test('F3 distinguishes a completed structural miss from interruption', () => {
  const context = publish(
    'oracle-f3',
    [pool('f3-ab', 'A', 'B'), pool('f3-cd', 'C', 'D')],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 10n, 'A', 'D'),
    mintControl(context, 1n),
  );
  assert.equal(result.status, 'no-route');
  if (result.status !== 'no-route') return;
  assert.equal(result.reason, 'no-structural-candidate');
  assert.equal(result.search.termination, 'complete');
  assertCounters(result.search.counters, {
    aggregateTransitions: 3,
    pathExpansions: 2,
    terminalProjections: 1,
  });
});

void test('F4 distinguishes structural candidates whose exact replays all reject', () => {
  const context = publish(
    'oracle-f4',
    [pool('f4-ab', 'A', 'B', 100n, 1n)],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 10n),
    mintControl(context, 1n),
  );
  assert.equal(result.status, 'no-route');
  if (result.status !== 'no-route') return;
  assert.equal(result.reason, 'all-exact-replays-rejected');
  assertCounters(result.search.counters, {
    aggregateTransitions: 4,
    directInspections: 1,
    directReplays: 1,
    directReplayRejections: 1,
    pathExpansions: 1,
    pathsRetained: 1,
    bestSingleReplays: 1,
    bestSingleReplayRejections: 1,
    terminalProjections: 1,
  });
});

void test('F5 gives the first numerical diagnostic strict priority and exact work', () => {
  const actions: ServiceExactInputSplitActionKind[] = [];
  let clockCalls = 0;
  const context = publish('oracle-f5', F5_POOLS, () => {
    clockCalls += 1;
    return 0n;
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 5n),
    mintControl(context, 1n, (checkpoint) => {
      actions.push(checkpoint.nextActionKind);
      return false;
    }, true),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'complete');
  // Equal [3,2] gives 2+1=3. Numerical [2,3] gives 2+2=4.
  assert.equal(result.plan.receipt.amountOut, 4n);
  assert.deepEqual(result.plan.receipt.legs.map((leg) => leg.allocation), [2n, 3n]);
  assert.deepEqual(
    result.plan.receipt.legs.map((leg) =>
      leg.receipt.hops.map((hop) => ({
        amountIn: hop.amountIn,
        amountOut: hop.amountOut,
        reserveInBefore: hop.reserveInBefore,
        reserveOutBefore: hop.reserveOutBefore,
        reserveInAfter: hop.reserveInAfter,
        reserveOutAfter: hop.reserveOutAfter,
      })),
    ),
    [
      [
        {
          amountIn: 2n,
          amountOut: 2n,
          reserveInBefore: 1n,
          reserveOutBefore: 3n,
          reserveInAfter: 3n,
          reserveOutAfter: 1n,
        },
      ],
      [
        {
          amountIn: 3n,
          amountOut: 2n,
          reserveInBefore: 3n,
          reserveOutBefore: 4n,
          reserveInAfter: 6n,
          reserveOutAfter: 2n,
        },
      ],
    ],
  );
  assertCounters(result.plan.search.counters, {
    aggregateTransitions: 8_554,
    directInspections: 2,
    directReplays: 2,
    pathExpansions: 2,
    pathsRetained: 2,
    bestSingleReplays: 2,
    candidateSetSteps: 4,
    candidateSetsRetained: 1,
    equalProposalReplays: 1,
    proposalsRetained: 3,
    baselineAuthorizationReplays: 1,
    greedyPartsStarted: 5,
    greedyOptionReplays: 10,
    numericalProposals: 1,
    numericalModelRouteSteps: 2,
    numericalOuterUpdatesStarted: 64,
    numericalOuterUpdatesCompleted: 64,
    numericalShareMicrosteps: 8_515,
    numericalReconstructionSteps: 6,
    numericalResidualOptionReplays: 2,
    numericalAuthorizationReplays: 1,
    bookkeepingSteps: 4,
    diagnosticsRetained: 1,
    terminalProjections: 1,
  });
  assertActionFrequencies(actions, {
    'direct-candidate-replay': 2,
    'path-expansion': 2,
    'best-single-candidate-replay': 2,
    'candidate-set-step': 4,
    'equal-proposal-replay': 1,
    'baseline-authorization-replay': 1,
    'greedy-option-replay': 10,
    'numerical-proposal-start': 1,
    'numerical-model-route': 2,
    'numerical-share-microstep': 8_515,
    'numerical-reconstruction-step': 6,
    'numerical-residual-option-replay': 2,
    'numerical-authorization-replay': 1,
    'proposal-bookkeeping': 3,
    'diagnostic-bookkeeping': 1,
    'terminal-projection': 1,
  });
  const diagnosticIndex = actions.indexOf('diagnostic-bookkeeping');
  assert.ok(diagnosticIndex >= 0);
  const directIndices = actions.flatMap((action, index) =>
    action === 'direct-candidate-replay' ? [index] : [],
  );
  assert.equal(directIndices.length, 2);
  assert.ok(directIndices[0]! < diagnosticIndex);
  assert.ok(directIndices[1]! > diagnosticIndex);
  assert.equal(
    actions
      .slice(0, diagnosticIndex)
      .some((action) => action === 'greedy-option-replay'),
    false,
  );
  assert.ok(actions.indexOf('greedy-option-replay') > diagnosticIndex);
  // Entry plus every successful action boundary samples 0n. Repeated samples
  // equal to the prior sample execute; equality is only terminal at deadline.
  assert.equal(clockCalls, result.plan.search.counters.aggregateTransitions + 1);

  const leftKey = '[["A","f5-left","B"]]';
  const rightKey = '[["A","f5-right","B"]]';
  const setKey = `[${leftKey},${rightKey}]`;
  assert.deepEqual(result.plan.search.numericalDiagnostics, [
    {
      candidateSetKeyDigest: sha256Utf8(setKey),
      routeKeyDigests: [sha256Utf8(leftKey), sha256Utf8(rightKey)],
      status: 'improved',
      failureCode: null,
      converged: true,
      residualUnits: 1n,
      counters: {
        modelRouteSteps: 2,
        outerUpdatesStarted: 64,
        outerUpdatesCompleted: 64,
        shareMicrosteps: 8_515,
        reconstructionSteps: 6,
        residualOptionReplays: 2,
        residualOptionReplayRejections: 0,
        authorizationReplays: 1,
        authorizationReplayRejections: 0,
      },
    },
  ]);
  assertDeepFrozen(result);
});

void test('F6 records an unchanged zero-residual replay without authorization', () => {
  const context = publish('oracle-f6', F6_POOLS, () => 0n);
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 100n),
    mintControl(context, 1n),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  // Each 50-unit leg independently gives floor(50*100/150)=33.
  assert.equal(result.plan.receipt.amountOut, 66n);
  assert.deepEqual(result.plan.receipt.legs.map((leg) => leg.allocation), [50n, 50n]);
  assert.deepEqual(
    result.plan.receipt.legs.map((leg) => leg.receipt.hops[0]),
    [
      {
        poolId: 'f6-left',
        assetIn: 'A',
        assetOut: 'B',
        amountIn: 50n,
        amountOut: 33n,
        reserveInBefore: 100n,
        reserveOutBefore: 100n,
        reserveInAfter: 150n,
        reserveOutAfter: 67n,
      },
      {
        poolId: 'f6-right',
        assetIn: 'A',
        assetOut: 'B',
        amountIn: 50n,
        amountOut: 33n,
        reserveInBefore: 100n,
        reserveOutBefore: 100n,
        reserveInAfter: 150n,
        reserveOutAfter: 67n,
      },
    ],
  );
  assertCounters(result.plan.search.counters, {
    aggregateTransitions: 8_509,
    directInspections: 2,
    directReplays: 2,
    pathExpansions: 2,
    pathsRetained: 2,
    bestSingleReplays: 2,
    candidateSetSteps: 4,
    candidateSetsRetained: 1,
    equalProposalReplays: 1,
    proposalsRetained: 1,
    baselineAuthorizationReplays: 1,
    greedyPartsStarted: 16,
    greedyOptionReplays: 32,
    numericalProposals: 1,
    numericalModelRouteSteps: 2,
    numericalOuterUpdatesStarted: 64,
    numericalOuterUpdatesCompleted: 64,
    numericalShareMicrosteps: 8_450,
    numericalReconstructionSteps: 6,
    numericalResidualOptionReplays: 1,
    bookkeepingSteps: 4,
    diagnosticsRetained: 1,
    terminalProjections: 1,
  });
  const diagnostic = result.plan.search.numericalDiagnostics[0];
  assert.equal(diagnostic?.status, 'not-better');
  assert.equal(diagnostic?.failureCode, null);
  assert.equal(diagnostic?.converged, true);
  assert.equal(diagnostic?.residualUnits, 0n);
  assert.equal(diagnostic?.counters.residualOptionReplays, 1);
  assert.equal(diagnostic?.counters.authorizationReplays, 0);
});

void test('first numerical diagnostic preempts every pending refinement lane', () => {
  const actions: ServiceExactInputSplitActionKind[] = [];
  const context = publish(
    'oracle-first-numerical-priority',
    [
      pool('priority-a', 'A', 'B', 1n, 3n),
      pool('priority-b', 'A', 'B', 3n, 4n),
      pool('priority-c', 'A', 'B', 5n, 7n),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 5n),
    mintControl(context, 1n, (checkpoint) => {
      actions.push(checkpoint.nextActionKind);
      return false;
    }),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  const firstDiagnostic = actions.indexOf('diagnostic-bookkeeping');
  assert.ok(firstDiagnostic >= 0);
  assert.equal(result.plan.search.counters.numericalProposals, 4);
  assert.equal(result.plan.search.counters.diagnosticsRetained, 4);

  const indicesOf = (kind: ServiceExactInputSplitActionKind): number[] =>
    actions.flatMap((action, index) => (action === kind ? [index] : []));
  for (const kind of [
    'direct-candidate-replay',
    'candidate-set-step',
    'equal-proposal-replay',
  ] as const) {
    const indices = indicesOf(kind);
    assert.ok(indices.some((index) => index < firstDiagnostic), `${kind} prefix`);
    assert.ok(indices.some((index) => index > firstDiagnostic), `${kind} refinement`);
  }
  // All three canonical paths and their best-single replays are prerequisites
  // for the first ordered set in this fixture, so those lanes exhaust before
  // numerical eligibility rather than remaining pending refinements.
  for (const kind of [
    'path-expansion',
    'best-single-candidate-replay',
  ] as const) {
    const indices = indicesOf(kind);
    assert.equal(indices.length, 3);
    assert.ok(indices.every((index) => index < firstDiagnostic), kind);
  }
  assert.ok(indicesOf('greedy-option-replay')[0]! > firstDiagnostic);
  assert.equal(
    actions
      .slice(0, firstDiagnostic)
      .filter((action) => action === 'equal-proposal-replay').length,
    1,
  );
});

void test('factories reject forged and cross-context capabilities in frozen order', () => {
  const first = publish('oracle-auth-one', [pool('auth-one')], () => 0n);
  const second = publish('oracle-auth-two', [pool('auth-two')], () => 0n);
  const firstIntent = captureIntent(first, undefined, 10n);
  const firstControl = mintControl(first, 1n);

  assert.deepEqual(
    captureServiceExactInputIntent(first, 'wrong', 'A', 'B', 10n),
    {
      ok: false,
      status: 'invalid-request',
      error: { code: 'snapshot-id-mismatch', field: 'snapshotId' },
    },
  );
  assert.deepEqual(
    captureServiceExactInputIntent(first, undefined, 'A', 'A', 10n),
    {
      ok: false,
      status: 'invalid-request',
      error: { code: 'same-asset-request', field: 'assetOut' },
    },
  );
  assert.deepEqual(
    captureServiceExactInputIntent(first, undefined, 'A', 'B', 0n),
    {
      ok: false,
      status: 'invalid-request',
      error: { code: 'invalid-amount-in', field: 'amountIn' },
    },
  );
  assert.deepEqual(
    mintServiceExactInputControl(first, -1n, undefined, false),
    {
      ok: false,
      status: 'invalid-control',
      error: {
        code: 'invalid-deadline',
        field: 'absoluteDeadlineNanoseconds',
      },
    },
  );

  const forgedIntent = Object.freeze({}) as CapturedServiceExactInputIntent;
  const forgedControl = Object.freeze({}) as CapturedServiceExactInputControl;
  assert.deepEqual(routeExactInputSplitServiceV2(first, forgedIntent, firstControl), {
    status: 'invalid-context',
    error: { code: 'invalid-service-context-binding', field: 'intent' },
  });
  assert.deepEqual(routeExactInputSplitServiceV2(first, firstIntent, forgedControl), {
    status: 'invalid-context',
    error: { code: 'invalid-service-context-binding', field: 'control' },
  });
  assert.deepEqual(
    routeExactInputSplitServiceV2(second, firstIntent, firstControl),
    {
      status: 'invalid-context',
      error: { code: 'invalid-service-context-binding', field: 'intent' },
    },
  );
});

type StopMode =
  | 'cancel'
  | 'cancellation-throws'
  | 'cancellation-invalid'
  | 'deadline-equality'
  | 'deadline-expired'
  | 'clock-throws'
  | 'clock-invalid'
  | 'clock-negative'
  | 'clock-regression';

interface BoundaryRun {
  readonly result: ServiceExactInputSplitRouteResult;
  readonly checkpoint: ServiceExactInputSplitCheckpoint;
  readonly clockCalledAtTarget: boolean;
}

function runF5Boundary(
  target: ServiceExactInputSplitActionKind,
  mode: StopMode,
  occurrence = 1,
): BoundaryRun {
  let armedClock = false;
  let clockCalledAtTarget = false;
  let checkpointAtTarget: ServiceExactInputSplitCheckpoint | undefined;
  let seen = 0;
  const context = publish('oracle-boundary', F5_POOLS, function (this: void) {
    assert.equal(this, undefined);
    if (!armedClock) return 10n;
    clockCalledAtTarget = true;
    switch (mode) {
      case 'deadline-equality':
        return 100n;
      case 'deadline-expired':
        return 101n;
      case 'clock-throws':
        throw new Error('oracle clock failure');
      case 'clock-invalid':
        return 10;
      case 'clock-negative':
        return -1n;
      case 'clock-regression':
        return 9n;
      case 'cancel':
      case 'cancellation-throws':
      case 'cancellation-invalid':
        assert.fail('cancellation failure must stop before the clock');
    }
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 5n),
    mintControl(
      context,
      100n,
      function (this: void, checkpoint) {
        assert.equal(this, undefined);
        if (checkpoint.nextActionKind !== target) return false;
        seen += 1;
        if (seen !== occurrence) return false;
        assertDeepFrozen(checkpoint);
        checkpointAtTarget = checkpoint;
        switch (mode) {
          case 'cancel':
            return true;
          case 'cancellation-throws':
            throw new Error('oracle cancellation failure');
          case 'cancellation-invalid':
            return 'not-a-boolean';
          case 'deadline-equality':
          case 'deadline-expired':
          case 'clock-throws':
          case 'clock-invalid':
          case 'clock-negative':
          case 'clock-regression':
            armedClock = true;
            return false;
        }
      },
    ),
  );
  assert.ok(checkpointAtTarget, `${target} occurrence ${occurrence} was not observed`);
  return {
    result,
    checkpoint: checkpointAtTarget,
    clockCalledAtTarget,
  };
}

function assertUnchargedStoppedBoundary(
  run: BoundaryRun,
  mode: StopMode,
  numericalDiagnostic: 'none' | 'stopped' | 'preserve',
): void {
  assert.notEqual(run.result.status, 'invalid-context');
  if (run.result.status === 'invalid-context') return;
  const search = searchOf(run.result);
  const expected = {
    ...run.checkpoint.counters,
    aggregateTransitions: run.checkpoint.counters.aggregateTransitions + 1,
    diagnosticsRetained:
      run.checkpoint.counters.diagnosticsRetained +
      (numericalDiagnostic === 'none' ? 0 : 1),
    terminalProjections: run.checkpoint.counters.terminalProjections + 1,
  };
  assert.deepEqual(search.counters, expected);
  assert.deepEqual(incumbentOf(run.result), run.checkpoint.incumbent);

  if (mode.startsWith('cancellation') || mode === 'cancel') {
    assert.equal(run.clockCalledAtTarget, false);
  } else {
    assert.equal(run.clockCalledAtTarget, true);
  }
  if (mode === 'cancel') {
    assert.equal(search.termination, 'interrupted');
  } else if (mode === 'cancellation-throws') {
    assert.equal(run.result.status, 'dependency-error');
    if (run.result.status === 'dependency-error') {
      assert.equal(run.result.dependency, 'cancellation');
      assert.equal(run.result.error.code, 'cancellation-call-failed');
    }
  } else if (mode === 'cancellation-invalid') {
    assert.equal(run.result.status, 'dependency-error');
    if (run.result.status === 'dependency-error') {
      assert.equal(run.result.dependency, 'cancellation');
      assert.equal(run.result.error.code, 'invalid-cancellation-result');
    }
  } else if (mode === 'deadline-equality' || mode === 'deadline-expired') {
    assert.equal(search.termination, 'deadline');
  } else {
    assert.equal(run.result.status, 'dependency-error');
    if (run.result.status === 'dependency-error') {
      assert.equal(run.result.dependency, 'clock');
      assert.equal(
        run.result.error.code,
        mode === 'clock-throws'
          ? 'clock-call-failed'
          : mode === 'clock-regression'
            ? 'clock-regressed'
            : 'invalid-clock-sample',
      );
    }
  }
  if (numericalDiagnostic === 'stopped') {
    const diagnostic = search.numericalDiagnostics.at(-1);
    assert.equal(diagnostic?.status, 'stopped');
    assert.equal(
      diagnostic?.failureCode,
      mode === 'cancel'
        ? 'interrupted'
        : mode === 'cancellation-throws'
          ? 'cancellation-call-failed'
          : mode === 'cancellation-invalid'
            ? 'invalid-cancellation-result'
            : mode === 'deadline-equality' || mode === 'deadline-expired'
              ? 'deadline'
              : mode === 'clock-throws'
                ? 'clock-call-failed'
                : mode === 'clock-regression'
                  ? 'clock-regressed'
                  : 'invalid-clock-sample',
    );
  } else if (numericalDiagnostic === 'preserve') {
    const diagnostic = search.numericalDiagnostics.at(-1);
    assert.equal(diagnostic?.status, 'improved');
    assert.equal(diagnostic?.failureCode, null);
    assert.equal(diagnostic?.converged, true);
    assert.equal(diagnostic?.residualUnits, 1n);
  }
  assertDeepFrozen(run.result);
}

const ENABLED_EXTERNAL_BOUNDARIES: ReadonlyArray<{
  readonly action: ServiceExactInputSplitActionKind;
  readonly numericalDiagnostic: 'none' | 'stopped' | 'preserve';
}> = [
  { action: 'direct-candidate-replay', numericalDiagnostic: 'none' },
  { action: 'path-expansion', numericalDiagnostic: 'none' },
  { action: 'best-single-candidate-replay', numericalDiagnostic: 'none' },
  { action: 'candidate-set-step', numericalDiagnostic: 'none' },
  { action: 'equal-proposal-replay', numericalDiagnostic: 'none' },
  { action: 'baseline-authorization-replay', numericalDiagnostic: 'none' },
  // Model extraction deliberately precedes numerical-proposal-start.
  { action: 'numerical-model-route', numericalDiagnostic: 'none' },
  { action: 'numerical-proposal-start', numericalDiagnostic: 'none' },
  { action: 'numerical-share-microstep', numericalDiagnostic: 'stopped' },
  {
    action: 'numerical-reconstruction-step',
    numericalDiagnostic: 'stopped',
  },
  {
    action: 'numerical-residual-option-replay',
    numericalDiagnostic: 'stopped',
  },
  {
    action: 'numerical-authorization-replay',
    numericalDiagnostic: 'stopped',
  },
  { action: 'proposal-bookkeeping', numericalDiagnostic: 'none' },
  // The outcome is already semantic here; boundary stop only retains it.
  { action: 'diagnostic-bookkeeping', numericalDiagnostic: 'preserve' },
  { action: 'greedy-option-replay', numericalDiagnostic: 'none' },
  { action: 'terminal-projection', numericalDiagnostic: 'none' },
];

void test('every enabled external action checks cancellation then clock before charge', () => {
  const modes: readonly StopMode[] = [
    'cancel',
    'cancellation-throws',
    'cancellation-invalid',
    'deadline-equality',
    'deadline-expired',
    'clock-throws',
    'clock-invalid',
    'clock-negative',
    'clock-regression',
  ];
  for (const { action, numericalDiagnostic } of ENABLED_EXTERNAL_BOUNDARIES) {
    for (const mode of modes) {
      const run = runF5Boundary(action, mode);
      assertUnchargedStoppedBoundary(run, mode, numericalDiagnostic);
      if (action === 'direct-candidate-replay' && mode === 'cancel') {
        assert.equal(run.result.status, 'no-plan');
        if (run.result.status === 'no-plan') {
          assert.equal(run.result.reason, 'interrupted');
        }
      }
      if (
        action === 'direct-candidate-replay' &&
        mode === 'deadline-equality'
      ) {
        assert.equal(run.result.status, 'no-plan');
        if (run.result.status === 'no-plan') {
          assert.equal(run.result.reason, 'deadline-before-plan');
        }
      }
    }
  }
});

void test('numerical proposal bookkeeping owns a reservation and stopped diagnostic', () => {
  for (const mode of ['cancel', 'deadline-equality'] as const) {
    assertUnchargedStoppedBoundary(
      runF5Boundary('proposal-bookkeeping', mode, 2),
      mode,
      'stopped',
    );
  }
});

void test('natural numerical diagnostic cap completes at four and stops before five', () => {
  const pools3 = Array.from({ length: 3 }, (_, index) =>
    pool(`cap3-${index}`, 'A', 'B', 100n + BigInt(index), 100n),
  );
  const completeContext = publish('oracle-natural-cap-3', pools3, () => 0n);
  const complete = routeExactInputSplitServiceV2(
    completeContext,
    captureIntent(completeContext, undefined, 20n),
    mintControl(completeContext, 1n),
  );
  assert.equal(complete.status, 'success');
  if (complete.status !== 'success') return;
  assert.equal(complete.plan.search.termination, 'complete');
  assert.equal(complete.plan.search.counters.numericalProposals, 4);
  assert.equal(complete.plan.search.counters.diagnosticsRetained, 4);

  const pools4 = Array.from({ length: 4 }, (_, index) =>
    pool(`cap4-${index}`, 'A', 'B', 100n + BigInt(index), 100n),
  );
  const stoppedContext = publish('oracle-natural-cap-4', pools4, () => 0n);
  const stopped = routeExactInputSplitServiceV2(
    stoppedContext,
    captureIntent(stoppedContext, undefined, 20n),
    mintControl(stoppedContext, 1n),
  );
  assert.equal(stopped.status, 'success');
  if (stopped.status !== 'success') return;
  assert.equal(stopped.plan.search.termination, 'work-limit');
  assert.equal(stopped.plan.search.counters.numericalProposals, 4);
  assert.equal(stopped.plan.search.counters.diagnosticsRetained, 4);
  assert.equal(stopped.plan.search.counters.terminalProjections, 1);
});

void test('retained candidate-set cap is no-plan work-limit without an incumbent', () => {
  const pools = Array.from({ length: 17 }, (_, index) =>
    pool(`no-incumbent-${index}`, 'A', 'B', 1_000n, 1n),
  );
  const context = publish('oracle-no-incumbent-cap', pools, () => 0n);
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 1n),
    mintControl(context, 1n),
  );
  assert.equal(result.status, 'no-plan');
  if (result.status !== 'no-plan') return;
  assert.equal(result.reason, 'work-limit');
  assert.equal(result.search.counters.candidateSetsRetained, 128);
  assert.equal(result.search.counters.terminalProjections, 1);
});

void test('debug is observational, independently byte-bounded, and digest-only by default', () => {
  const context = publish('oracle-debug', F5_POOLS, () => 0n);
  const intent = captureIntent(context, undefined, 5n);
  const withoutDebug = routeExactInputSplitServiceV2(
    context,
    intent,
    mintControl(context, 1n, undefined, false),
  );
  const withDebug = routeExactInputSplitServiceV2(
    context,
    intent,
    mintControl(context, 1n, undefined, true),
  );
  assert.equal(withoutDebug.status, 'success');
  assert.equal(withDebug.status, 'success');
  if (withoutDebug.status !== 'success' || withDebug.status !== 'success') return;
  assert.deepEqual(withDebug.plan.receipt, withoutDebug.plan.receipt);
  assert.deepEqual(withDebug.plan.search.counters, withoutDebug.plan.search.counters);
  assert.deepEqual(
    withDebug.plan.search.numericalDiagnostics,
    withoutDebug.plan.search.numericalDiagnostics,
  );
  assert.equal(withoutDebug.plan.search.debug, null);
  const debug = withDebug.plan.search.debug;
  assert.ok(debug);
  assert.equal(debug.truncated, false);
  assert.equal(debug.fragments.length, 1);
  assert.deepEqual(debug.fragments[0], {
    diagnosticIndex: 0,
    candidateSetKey:
      '[[["A","f5-left","B"]],[["A","f5-right","B"]]]',
    routeKeys: ['[["A","f5-left","B"]]', '[["A","f5-right","B"]]'],
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify(debug), 'utf8') <=
      SERVICE_ROUTING_POLICY_V1.maxDebugProjectionBytes,
  );
  for (const fragment of debug.fragments) {
    assert.ok(
      Buffer.byteLength(fragment.candidateSetKey, 'utf8') <=
        SERVICE_ROUTING_POLICY_V1.maxOptionalKeyBytes,
    );
    for (const key of fragment.routeKeys) {
      assert.ok(
        Buffer.byteLength(key, 'utf8') <=
          SERVICE_ROUTING_POLICY_V1.maxOptionalKeyBytes,
      );
    }
  }
});

void test('debug truncates before the UTF-8 byte cap without changing exact work', () => {
  const longId = (prefix: string): string =>
    `${prefix}${'\\'.repeat(128 - prefix.length)}`;
  const assetIn = longId('A');
  const assetOut = longId('B');
  const pools: PoolInput[] = [];
  for (let routeIndex = 0; routeIndex < 3; routeIndex += 1) {
    const first = longId(`x${routeIndex}a`);
    const second = longId(`x${routeIndex}b`);
    const third = longId(`x${routeIndex}c`);
    pools.push(
      pool(longId(`p${routeIndex}a`), assetIn, first),
      pool(longId(`p${routeIndex}b`), first, second),
      pool(longId(`p${routeIndex}c`), second, third),
      pool(longId(`p${routeIndex}d`), third, assetOut),
    );
  }
  const context = publish('oracle-debug-truncation', pools, () => 0n);
  const intent = captureIntent(
    context,
    undefined,
    100n,
    assetIn,
    assetOut,
  );
  const plain = routeExactInputSplitServiceV2(
    context,
    intent,
    mintControl(context, 1n, undefined, false),
  );
  const verbose = routeExactInputSplitServiceV2(
    context,
    intent,
    mintControl(context, 1n, undefined, true),
  );
  assert.equal(plain.status, 'success');
  assert.equal(verbose.status, 'success');
  if (plain.status !== 'success' || verbose.status !== 'success') return;
  assert.deepEqual(verbose.plan.receipt, plain.plan.receipt);
  assert.deepEqual(verbose.plan.search.counters, plain.plan.search.counters);
  assert.deepEqual(
    verbose.plan.search.numericalDiagnostics,
    plain.plan.search.numericalDiagnostics,
  );
  assert.equal(verbose.plan.search.numericalDiagnostics.length, 4);
  const debug = verbose.plan.search.debug;
  assert.ok(debug);
  assert.equal(debug.truncated, true);
  assert.ok(debug.fragments.length < 4);
  assert.ok(
    Buffer.byteLength(JSON.stringify(debug), 'utf8') <=
      SERVICE_ROUTING_POLICY_V1.maxDebugProjectionBytes,
  );
});

void test('reruns are fresh, deeply frozen, and exact for 255-bit values', () => {
  const context = publish('oracle-fresh', [pool('fresh')], () => 0n);
  const intent = captureIntent(context, undefined, 100n);
  const control = mintControl(context, 1n);
  const first = routeExactInputSplitServiceV2(context, intent, control);
  const second = routeExactInputSplitServiceV2(context, intent, control);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.status, 'success');
  assert.equal(second.status, 'success');
  if (first.status === 'success' && second.status === 'success') {
    assert.notEqual(first.plan, second.plan);
    assert.notEqual(first.plan.receipt, second.plan.receipt);
    assert.notEqual(first.plan.search, second.plan.search);
    assert.notEqual(first.plan.search.counters, second.plan.search.counters);
  }
  assertDeepFrozen(first);
  assertDeepFrozen(second);

  const huge = (1n << 255n) - 1n;
  const hugeContext = publish(
    'oracle-huge',
    [pool('huge', 'A', 'B', huge, huge)],
    () => 0n,
  );
  const hugeResult = routeExactInputSplitServiceV2(
    hugeContext,
    captureIntent(hugeContext, undefined, huge),
    mintControl(hugeContext, 1n),
  );
  assert.equal(hugeResult.status, 'success');
  if (hugeResult.status === 'success') {
    assert.equal(hugeResult.plan.receipt.amountOut, (1n << 254n) - 1n);
  }
});

void test('a cancellation dependency may reenter with a fresh isolated session', () => {
  const context = publish('oracle-reentrant', [pool('reentrant')], () => 0n);
  const intent = captureIntent(context, undefined, 100n);
  const innerControl = mintControl(context, 1n);
  const baseline = routeExactInputSplitServiceV2(context, intent, innerControl);
  let inner: ServiceExactInputSplitRouteResult | undefined;
  let entered = false;
  const outerControl = mintControl(context, 1n, () => {
    if (!entered) {
      entered = true;
      inner = routeExactInputSplitServiceV2(context, intent, innerControl);
    }
    return false;
  });
  const outer = routeExactInputSplitServiceV2(context, intent, outerControl);
  assert.equal(entered, true);
  assert.ok(inner);
  assert.deepEqual(inner, baseline);
  assert.deepEqual(outer, baseline);
  assert.notEqual(inner, baseline);
  assert.notEqual(outer, baseline);
  assertDeepFrozen(inner);
  assertDeepFrozen(outer);
});

void test('raw pool permutation preserves checksum identity and canonical receipt', () => {
  const pools = [
    pool('permutation-z', 'A', 'B', 100n, 101n),
    pool('permutation-a', 'A', 'B', 101n, 100n),
  ];
  const forward = publish('oracle-permutation', pools, () => 0n);
  const reverse = publish('oracle-permutation', [...pools].reverse(), () => 0n);
  const first = routeExactInputSplitServiceV2(
    forward,
    captureIntent(forward, undefined, 10n),
    mintControl(forward, 1n),
  );
  const second = routeExactInputSplitServiceV2(
    reverse,
    captureIntent(reverse, undefined, 10n),
    mintControl(reverse, 1n),
  );
  assert.deepEqual(first, second);
});

void test('source architecture keeps service scheduling isolated and reference bytes fixed', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (relativePath: string): string =>
    readFileSync(resolve(root, relativePath), 'utf8');
  const digest = (relativePath: string): string =>
    createHash('sha256').update(read(relativePath), 'utf8').digest('hex');

  assert.equal(
    digest('src/router/anytime-exact-input-split/index.ts'),
    '67bfa1b51e6cd58adcc7f7931bbfc2d747305290d96986812a6789eeb3075667',
  );
  assert.equal(
    digest('src/router/numerical-exact-input-split/index.ts'),
    '280e1b6f74901c97a2ca0df307803654d8ef27149d5f12fe6383ce401fa1bf75',
  );
  assert.equal(
    digest('tests/oracle/numerical-exact-input-split-runtime-oracle.test.ts'),
    '4f4ca6c3c0d0dd42b4a5ce8731bbdeb9d351e1d59e719ff60ed0f14eafdcb2e2',
  );

  const session = read('src/router/exact-input-split-session/index.ts');
  assert.equal((session.match(/const SESSION_STATES = new WeakMap/g) ?? []).length, 1);
  assert.match(session, /type SessionState = ReferenceSessionState \| ServiceSessionState/);
  const serviceStart = session.indexOf('function freshServiceCounters');
  const referenceResume = session.indexOf('export function exactInputSplitSessionCounters');
  assert.ok(serviceStart >= 0 && referenceResume > serviceStart);
  const serviceSlice = session.slice(serviceStart, referenceResume);
  for (const forbidden of [
    'preparedDirectRoutes(',
    'materializePreparedSimplePaths(',
    'preparePathShadowPriceProposal(',
    'advancePathShadowPriceProposal(',
    'finalizePathShadowPriceProposal(',
    'runExactInputSplitReferencePolicy(',
    'routeAnytimeExactInputSplit(',
    'routeNumericalExactInputSplit(',
  ]) {
    assert.equal(serviceSlice.includes(forbidden), false, forbidden);
  }
  assert.equal(serviceSlice.includes("gateServiceAction(state, 'activation-probe-replay')"), false);
  assert.equal(serviceSlice.includes("gateServiceAction(state, 'repair-neighbor-replay')"), false);
  assert.equal(serviceSlice.includes("chargeServiceAction(state, 'activation-probe-replay')"), false);
  assert.equal(serviceSlice.includes("chargeServiceAction(state, 'repair-neighbor-replay')"), false);

  // Runtime cap saturation for every enormous lane would make this oracle
  // impractical. The exhaustive cap/charge switch proof below complements the
  // executed natural candidate-set/numerical/diagnostic cap pairs above.
  const capStart = session.indexOf('function serviceActionAtCap');
  const capEnd = session.indexOf(
    'export function observeServiceExactInputSplitSessionBoundary',
  );
  const chargeStart = session.indexOf('function chargeServiceAction');
  const chargeEnd = session.indexOf('function serviceRouteKey');
  assert.ok(capStart >= 0 && capEnd > capStart);
  assert.ok(chargeStart >= 0 && chargeEnd > chargeStart);
  const capSwitch = session.slice(capStart, capEnd);
  const chargeSwitch = session.slice(chargeStart, chargeEnd);
  for (const action of ALL_ACTION_KINDS) {
    assert.ok(capSwitch.includes(`case '${action}':`), `cap switch: ${action}`);
    assert.ok(chargeSwitch.includes(`case '${action}':`), `charge switch: ${action}`);
  }

  assert.equal(SERVICE_ROUTING_POLICY_V1.maxRetainedProposalRecords, 128);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxGreedyOptionReplays, 2_048);
  assert.equal(SERVICE_ROUTING_POLICY_V1.maxNumericalProposals, 4);
  assert.equal(128 + 2_048 + 4, 2_180);
  assert.equal(2_180 + SERVICE_ROUTING_POLICY_V1.maxNumericalDiagnostics, 2_184);
  // Four maximum-length hops and four maximum-length routes, including JSON
  // structure and separators under the accepted identifier bounds.
  assert.equal(3_117 <= SERVICE_ROUTING_POLICY_V1.maxOptionalKeyBytes, true);
  assert.equal(12_473 <= SERVICE_ROUTING_POLICY_V1.maxOptionalKeyBytes, true);
});
