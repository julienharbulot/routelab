import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiquiditySnapshot } from '../src/domain/index.ts';
import {
  SERVICE_ROUTING_POLICY_V1,
  prepareServiceRoutingContext,
  type PreparedServiceRoutingContext,
} from '../src/runtime/prepared-service-routing-context/index.ts';
import {
  exactInputSplitSessionCounters,
  type ExactInputSplitSession,
} from '../src/router/exact-input-split-session/index.ts';
import {
  captureServiceExactInputIntent,
  mintServiceExactInputControl,
  routeExactInputSplitServiceV2,
  type CapturedServiceExactInputControl,
  type CapturedServiceExactInputIntent,
  type ServiceExactInputSplitCheckpoint,
  type ServiceExactInputSplitRouteResult,
  type ServiceExactInputSplitWorkCounters,
} from '../src/router/service-exact-input-split/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

void test('preserves the frozen reference-session misuse error', () => {
  assert.equal(
    SERVICE_ROUTING_POLICY_V1.maxEqualProposalReplays +
      SERVICE_ROUTING_POLICY_V1.maxGreedyOptionReplays +
      SERVICE_ROUTING_POLICY_V1.maxNumericalProposals,
    2_180,
  );
  assert.throws(
    () =>
      exactInputSplitSessionCounters(
        Object.freeze({}) as ExactInputSplitSession,
      ),
    new TypeError('Invalid exact-input split session.'),
  );
});

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

function rawSnapshot(snapshotId: string, pools: readonly PoolInput[]): Uint8Array {
  const provisional: LiquiditySnapshot = Object.freeze({
    snapshotId,
    snapshotChecksum: `sha256:${'0'.repeat(64)}`,
    pools: Object.freeze(
      pools.map((candidate) =>
        Object.freeze({
          poolId: candidate.poolId,
          asset0: candidate.asset0,
          reserve0: candidate.reserve0,
          asset1: candidate.asset1,
          reserve1: candidate.reserve1,
          feeChargedNumerator: candidate.feeChargedNumerator,
          feeDenominator: candidate.feeDenominator,
        }),
      ),
    ),
  });
  const snapshotChecksum = computeCanonicalSnapshotChecksum(provisional);
  return encoder.encode(
    JSON.stringify({
      snapshotId,
      snapshotChecksum,
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
  if (!result.ok) assert.fail(`service publication failed: ${result.error.code}`);
  return result.value;
}

function captureIntent(
  context: PreparedServiceRoutingContext,
  snapshotId: string | undefined,
  amountIn = 100n,
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

function resultSearch(result: ServiceExactInputSplitRouteResult) {
  switch (result.status) {
    case 'success':
      return result.plan.search;
    case 'no-plan':
    case 'no-route':
    case 'dependency-error':
    case 'state-error':
      return result.search;
    case 'invalid-context':
      return undefined;
  }
}

function assertAllZero(counters: ServiceExactInputSplitWorkCounters): void {
  for (const value of Object.values(counters)) assert.equal(value, 0);
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

void test('captures opaque intents in the frozen validation order', () => {
  const context = publish('service-intent', [pool('pool-ab')], () => 0n);
  const invalidContext = captureServiceExactInputIntent(
    Object.freeze({}) as PreparedServiceRoutingContext,
    '',
    '',
    '',
    0n,
  );
  assert.deepEqual(invalidContext, {
    ok: false,
    status: 'invalid-context',
    error: { code: 'invalid-service-context', field: 'context' },
  });

  const cases = [
    captureServiceExactInputIntent(context, '', '', '', 0n),
    captureServiceExactInputIntent(context, 'other', '', '', 0n),
    captureServiceExactInputIntent(context, undefined, '\u0000', '', 0n),
    captureServiceExactInputIntent(context, undefined, 'A', '\ud800', 0n),
    captureServiceExactInputIntent(context, undefined, 'A', 'A', 0n),
    captureServiceExactInputIntent(context, undefined, 'A', 'B', 0n),
    captureServiceExactInputIntent(context, undefined, 'A', 'B', 1n << 256n),
    captureServiceExactInputIntent(context, undefined, 'missing', 'B', 1n),
    captureServiceExactInputIntent(context, undefined, 'A', 'missing', 1n),
  ];
  assert.deepEqual(
    cases.map((entry) => (entry.ok ? 'ok' : `${entry.error.code}:${entry.error.field}`)),
    [
      'invalid-snapshot-id:snapshotId',
      'snapshot-id-mismatch:snapshotId',
      'invalid-asset-identifier:assetIn',
      'invalid-asset-identifier:assetOut',
      'same-asset-request:assetOut',
      'invalid-amount-in:amountIn',
      'invalid-amount-in:amountIn',
      'unknown-asset:assetIn',
      'unknown-asset:assetOut',
    ],
  );
  for (const entry of [invalidContext, ...cases]) assertDeepFrozen(entry);

  const accepted = captureServiceExactInputIntent(
    context,
    undefined,
    'A',
    'B',
    (1n << 256n) - 1n,
  );
  assert.equal(accepted.ok, true);
  if (accepted.ok) assertDeepFrozen(accepted.value);
});

void test('mints opaque controls without invoking dependencies and validates primitives in order', () => {
  const context = publish('service-control', [pool('pool-ab')], () => 0n);
  let cancellationCalls = 0;
  const callback = (): boolean => {
    cancellationCalls += 1;
    return false;
  };
  const accepted = mintServiceExactInputControl(context, 0n, callback, true);
  assert.equal(accepted.ok, true);
  assert.equal(cancellationCalls, 0);
  assertDeepFrozen(accepted);

  const invalidContext = mintServiceExactInputControl(
    Object.freeze({}) as PreparedServiceRoutingContext,
    -1n,
    1 as never,
    1 as never,
  );
  const invalidDeadline = mintServiceExactInputControl(
    context,
    -1n,
    1 as never,
    1 as never,
  );
  const invalidCancellation = mintServiceExactInputControl(
    context,
    0n,
    1 as never,
    1 as never,
  );
  const invalidDebug = mintServiceExactInputControl(
    context,
    0n,
    undefined,
    1 as never,
  );
  assert.deepEqual(
    [invalidContext, invalidDeadline, invalidCancellation, invalidDebug].map(
      (entry) => (entry.ok ? 'ok' : `${entry.error.code}:${entry.error.field}`),
    ),
    [
      'invalid-service-context:context',
      'invalid-deadline:absoluteDeadlineNanoseconds',
      'invalid-cancellation-dependency:shouldCancel',
      'invalid-debug:debug',
    ],
  );
});

void test('rejects forged and cross-context handles before any clock sample', () => {
  let leftClockCalls = 0;
  let rightClockCalls = 0;
  const left = publish('service-left', [pool('pool-ab')], () => {
    leftClockCalls += 1;
    return 0n;
  });
  const right = publish('service-right', [pool('pool-ab')], () => {
    rightClockCalls += 1;
    return 0n;
  });
  const leftIntent = captureIntent(left, undefined);
  const leftControl = mintControl(left, 100n);
  const rightIntent = captureIntent(right, undefined);
  const rightControl = mintControl(right, 100n);

  assert.deepEqual(
    routeExactInputSplitServiceV2(
      Object.freeze({}) as PreparedServiceRoutingContext,
      Object.freeze({}) as CapturedServiceExactInputIntent,
      Object.freeze({}) as CapturedServiceExactInputControl,
    ),
    {
      status: 'invalid-context',
      error: { code: 'invalid-service-context-binding', field: 'context' },
    },
  );
  assert.equal(
    routeExactInputSplitServiceV2(
      left,
      Object.freeze({}) as CapturedServiceExactInputIntent,
      leftControl,
    ).status,
    'invalid-context',
  );
  const crossedIntent = routeExactInputSplitServiceV2(left, rightIntent, leftControl);
  const crossedControl = routeExactInputSplitServiceV2(left, leftIntent, rightControl);
  assert.equal(crossedIntent.status, 'invalid-context');
  assert.equal(crossedControl.status, 'invalid-context');
  if (crossedIntent.status === 'invalid-context') {
    assert.equal(crossedIntent.error.field, 'intent');
  }
  if (crossedControl.status === 'invalid-context') {
    assert.equal(crossedControl.error.field, 'control');
  }
  assert.equal(leftClockCalls, 0);
  assert.equal(rightClockCalls, 0);
});

void test('plain-calls the clock at entry and returns all-zero entry dependency errors', () => {
  let clockCalls = 0;
  const context = publish('service-entry-error', [pool('pool-ab')], function (
    this: unknown,
  ): never {
    assert.equal(this, undefined);
    clockCalls += 1;
    throw new Error('entry clock failure');
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n, () => {
      assert.fail('entry clock failure must suppress cancellation');
    }, true),
  );
  assert.equal(clockCalls, 1);
  assert.equal(result.status, 'dependency-error');
  if (result.status !== 'dependency-error') return;
  assert.equal(result.dependency, 'clock');
  assert.equal(result.phase, 'entry');
  assert.equal(result.error.code, 'clock-call-failed');
  assert.equal(result.incumbent, null);
  assertAllZero(result.search.counters);
  assert.deepEqual(result.search.numericalDiagnostics, []);
  assert.equal(result.search.debug, null);
  assertDeepFrozen(result);
});

void test('rejects invalid and already-expired entry samples with no session work', () => {
  for (const sample of [1, -1n] as const) {
    let clockCalls = 0;
    let cancellationCalls = 0;
    const context = publish('service-invalid-sample', [pool('pool-ab')], () => {
      clockCalls += 1;
      return sample;
    });
    const result = routeExactInputSplitServiceV2(
      context,
      captureIntent(context, undefined),
      mintControl(context, 100n, () => {
        cancellationCalls += 1;
        return false;
      }, true),
    );
    assert.equal(result.status, 'dependency-error');
    if (result.status === 'dependency-error') {
      assert.equal(result.error.code, 'invalid-clock-sample');
      assertAllZero(result.search.counters);
      assert.deepEqual(result.search.numericalDiagnostics, []);
      assert.equal(result.search.debug, null);
    }
    assert.equal(clockCalls, 1);
    assert.equal(cancellationCalls, 0);
  }

  let expiredClockCalls = 0;
  let expiredCancellationCalls = 0;
  const expired = publish('service-expired', [pool('pool-ab')], () => {
    expiredClockCalls += 1;
    return 10n;
  });
  const expiredResult = routeExactInputSplitServiceV2(
    expired,
    captureIntent(expired, undefined),
    mintControl(expired, 10n, () => {
      expiredCancellationCalls += 1;
      return false;
    }, true),
  );
  assert.equal(expiredResult.status, 'no-plan');
  if (expiredResult.status === 'no-plan') {
    assert.equal(expiredResult.reason, 'deadline-at-entry');
    assertAllZero(expiredResult.search.counters);
    assert.deepEqual(expiredResult.search.numericalDiagnostics, []);
    assert.equal(expiredResult.search.debug, null);
  }
  assert.equal(expiredClockCalls, 1);
  assert.equal(expiredCancellationCalls, 0);
});

void test('charges one bounded direct replay and the reserved terminal projection', () => {
  const clockSamples = [0n, 1n];
  let clockCalls = 0;
  let cancellationCalls = 0;
  let firstCheckpoint = true;
  const context = publish('service-direct', [pool('pool-ab')], function (
    this: unknown,
  ): bigint {
    assert.equal(this, undefined);
    const sample = clockSamples[clockCalls];
    clockCalls += 1;
    return sample ?? 1n;
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, 'service-direct'),
    mintControl(context, 100n, function (
      this: unknown,
      checkpoint,
    ): boolean {
      assert.equal(this, undefined);
      if (firstCheckpoint) {
        assert.equal(checkpoint.nextActionKind, 'direct-candidate-replay');
        assertAllZero(checkpoint.counters);
        assert.equal(checkpoint.incumbent, null);
        firstCheckpoint = false;
      }
      assertDeepFrozen(checkpoint);
      cancellationCalls += 1;
      return false;
    }),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountOut, 90n);
  assert.equal(result.plan.search.termination, 'complete');
  assert.equal(result.plan.search.counters.aggregateTransitions, 4);
  assert.equal(result.plan.search.counters.directInspections, 1);
  assert.equal(result.plan.search.counters.directReplays, 1);
  assert.equal(result.plan.search.counters.directReplayRejections, 0);
  assert.equal(result.plan.search.counters.terminalProjections, 1);
  assert.equal(clockCalls, 5);
  assert.equal(cancellationCalls, 4);
  assertDeepFrozen(result);
});

void test('checks cancellation before the action clock and preserves an incumbent', () => {
  let clockCalls = 0;
  let cancellationCalls = 0;
  const context = publish(
    'service-cancel',
    [pool('a-pool'), pool('b-pool')],
    () => {
      clockCalls += 1;
      return 0n;
    },
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n, (checkpoint) => {
      cancellationCalls += 1;
      return checkpoint.counters.directReplays === 1;
    }),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'interrupted');
  assert.equal(result.plan.search.counters.directReplays, 1);
  assert.equal(result.plan.search.counters.aggregateTransitions, 2);
  assert.equal(result.plan.search.counters.terminalProjections, 1);
  assert.equal(clockCalls, 2);
  assert.equal(cancellationCalls, 2);
});

void test('maps action cancellation and clock failures without charging the stopped action', () => {
  const cancellationContext = publish(
    'service-cancel-error',
    [pool('pool-ab')],
    () => 0n,
  );
  const cancellationResult = routeExactInputSplitServiceV2(
    cancellationContext,
    captureIntent(cancellationContext, undefined),
    mintControl(cancellationContext, 100n, () => {
      throw new Error('cancellation failure');
    }),
  );
  assert.equal(cancellationResult.status, 'dependency-error');
  if (cancellationResult.status === 'dependency-error') {
    assert.equal(cancellationResult.dependency, 'cancellation');
    assert.equal(cancellationResult.phase, 'action');
    assert.equal(cancellationResult.error.code, 'cancellation-call-failed');
    assert.equal(cancellationResult.search.counters.directReplays, 0);
    assert.equal(cancellationResult.search.counters.aggregateTransitions, 1);
    assert.equal(cancellationResult.search.counters.terminalProjections, 1);
  }

  let clockCalls = 0;
  const regressionContext = publish(
    'service-clock-regression',
    [pool('pool-ab')],
    () => {
      clockCalls += 1;
      return clockCalls === 1 ? 5n : 4n;
    },
  );
  const regressionResult = routeExactInputSplitServiceV2(
    regressionContext,
    captureIntent(regressionContext, undefined),
    mintControl(regressionContext, 100n),
  );
  assert.equal(regressionResult.status, 'dependency-error');
  if (regressionResult.status === 'dependency-error') {
    assert.equal(regressionResult.error.code, 'clock-regressed');
    assert.equal(regressionResult.search.counters.directReplays, 0);
    assert.equal(regressionResult.search.counters.aggregateTransitions, 1);
  }
});

void test('returns deadline-before-plan when the first direct boundary expires', () => {
  let clockCalls = 0;
  const context = publish('service-action-deadline', [pool('pool-ab')], () => {
    clockCalls += 1;
    return clockCalls === 1 ? 0n : 10n;
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 10n),
  );
  assert.equal(result.status, 'no-plan');
  if (result.status !== 'no-plan') return;
  assert.equal(result.reason, 'deadline-before-plan');
  assert.equal(result.search.termination, 'deadline');
  assert.equal(result.search.counters.directReplays, 0);
  assert.equal(result.search.counters.aggregateTransitions, 1);
  assert.equal(result.search.counters.terminalProjections, 1);
});

void test('charges rejected direct replays separately and preserves no incumbent', () => {
  const context = publish(
    'service-rejection',
    [pool('pool-ab', 'A', 'B', 1_000n, 1n)],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 1n),
    mintControl(context, 100n),
  );
  assert.equal(result.status, 'no-route');
  if (result.status !== 'no-route') return;
  assert.equal(result.reason, 'all-exact-replays-rejected');
  assert.equal(result.search.counters.directInspections, 1);
  assert.equal(result.search.counters.directReplays, 1);
  assert.equal(result.search.counters.directReplayRejections, 1);
  assert.equal(result.search.counters.bestSingleReplays, 1);
  assert.equal(result.search.counters.bestSingleReplayRejections, 1);
  assert.equal(result.search.counters.aggregateTransitions, 4);
});

void test('processes every canonical direct candidate across tranche and refinement', () => {
  const directPools = Array.from({ length: 12 }, (_, index) =>
    pool(`${String(index).padStart(2, '0')}-pool`),
  );
  let clockCalls = 0;
  let cancellationCalls = 0;
  const context = publish('service-many-directs', directPools, () => {
    clockCalls += 1;
    return 0n;
  });
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n, () => {
      cancellationCalls += 1;
      return false;
    }),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.counters.directInspections, 12);
  assert.equal(result.plan.search.counters.directReplays, 12);
  assert.equal(result.plan.search.termination, 'work-limit');
  assert.ok(result.plan.search.counters.aggregateTransitions > 13);
  assert.equal(result.plan.search.counters.terminalProjections, 1);
  assert.equal(
    result.plan.search.counters.proposalsRetained,
    SERVICE_ROUTING_POLICY_V1.maxRetainedProposalRecords,
  );
  assert.ok(result.plan.receipt.amountOut >= 90n);
  assert.equal(clockCalls, result.plan.search.counters.aggregateTransitions);
  assert.equal(
    cancellationCalls,
    result.plan.search.counters.aggregateTransitions - 1,
  );
});

void test('returns complete no-route only after every enabled lane exhausts naturally', () => {
  let clockCalls = 0;
  let cancellationCalls = 0;
  const context = publish(
    'service-no-direct',
    [pool('pool-ax', 'A', 'X'), pool('pool-yb', 'Y', 'B')],
    () => {
      clockCalls += 1;
      return 0n;
    },
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n, () => {
      cancellationCalls += 1;
      return false;
    }),
  );
  assert.equal(result.status, 'no-route');
  if (result.status !== 'no-route') return;
  assert.equal(result.reason, 'no-structural-candidate');
  assert.equal(result.search.termination, 'complete');
  assert.equal(result.search.counters.directReplays, 0);
  assert.equal(result.search.counters.pathExpansions, 2);
  assert.equal(result.search.counters.aggregateTransitions, 3);
  assert.equal(result.search.counters.terminalProjections, 1);
  assert.equal(clockCalls, 4);
  assert.equal(cancellationCalls, 3);
});

void test('runs F5 through the strict first numerical pipeline before greedy work', () => {
  const actions: string[] = [];
  const context = publish(
    'service-f5',
    [
      pool('f5-left', 'A', 'B', 1n, 3n),
      pool('f5-right', 'A', 'B', 3n, 4n),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 5n),
    mintControl(context, 100n, (checkpoint) => {
      actions.push(checkpoint.nextActionKind);
      return false;
    }, true),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'complete');
  assert.equal(result.plan.receipt.amountOut, 4n);
  assert.deepEqual(
    result.plan.receipt.legs.map((leg) => leg.allocation),
    [2n, 3n],
  );
  const counters = result.plan.search.counters;
  assert.equal(counters.numericalProposals, 1);
  assert.equal(counters.numericalModelRouteSteps, 2);
  assert.equal(counters.numericalOuterUpdatesStarted, 64);
  assert.equal(counters.numericalOuterUpdatesCompleted, 64);
  assert.equal(counters.numericalShareMicrosteps, 8_515);
  assert.equal(counters.numericalReconstructionSteps, 6);
  assert.equal(counters.numericalResidualOptionReplays, 2);
  assert.equal(counters.numericalAuthorizationReplays, 1);
  assert.equal(counters.diagnosticsRetained, 1);
  assert.equal(counters.terminalProjections, 1);
  assert.deepEqual(result.plan.search.numericalDiagnostics[0], {
    candidateSetKeyDigest:
      'sha256:ed2b302c79e81beb467251d498806728ae2f9e52bc0dfe9c63a828f6deb5a993',
    routeKeyDigests: [
      'sha256:531865e59a1e948d22455bc9f9c4e5758e00daed263dea3c5770667b8d7e3e23',
      'sha256:db19c291582651ca0c2fb8d188589283725ba286e9241e60d646aa1323508b0b',
    ],
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
  });
  const diagnosticIndex = actions.indexOf('diagnostic-bookkeeping');
  const greedyIndex = actions.indexOf('greedy-option-replay');
  assert.ok(diagnosticIndex > actions.indexOf('numerical-proposal-start'));
  assert.ok(greedyIndex > diagnosticIndex);
  assert.equal(
    actions.slice(0, diagnosticIndex).includes('greedy-option-replay'),
    false,
  );
  assertDeepFrozen(result);
});

void test('runs F6 with 8450 shares and one unchanged residual replay', () => {
  const context = publish(
    'service-f6',
    [
      pool('f6-left', 'A', 'B', 100n, 100n),
      pool('f6-right', 'A', 'B', 100n, 100n),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 100n),
    mintControl(context, 100n),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.receipt.amountOut, 66n);
  assert.deepEqual(
    result.plan.receipt.legs.map((leg) => leg.allocation),
    [50n, 50n],
  );
  const counters = result.plan.search.counters;
  assert.equal(counters.numericalShareMicrosteps, 8_450);
  assert.equal(counters.numericalReconstructionSteps, 6);
  assert.equal(counters.numericalResidualOptionReplays, 1);
  assert.equal(counters.numericalAuthorizationReplays, 0);
  assert.equal(result.plan.search.numericalDiagnostics[0]?.status, 'not-better');
  assert.equal(result.plan.search.numericalDiagnostics[0]?.converged, true);
  assert.equal(result.plan.search.numericalDiagnostics[0]?.residualUnits, 0n);
});

void test('uses the literal 2n numerical threshold and suppresses unavailable equal work', () => {
  const context = publish(
    'service-low-input',
    Array.from({ length: 4 }, (_, index) => pool(`low-${index}`)),
    () => 0n,
  );
  const one = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 1n),
    mintControl(context, 100n),
  );
  const two = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 2n),
    mintControl(context, 100n),
  );
  const oneSearch = resultSearch(one);
  const twoSearch = resultSearch(two);
  assert.ok(oneSearch !== undefined);
  assert.ok(twoSearch !== undefined);
  assert.equal(oneSearch.counters.candidateSetsRetained, 11);
  assert.equal(oneSearch.counters.equalProposalReplays, 0);
  assert.equal(oneSearch.counters.numericalModelRouteSteps, 0);
  assert.equal(oneSearch.counters.numericalProposals, 0);
  assert.equal(twoSearch.counters.candidateSetsRetained, 11);
  assert.ok(twoSearch.counters.equalProposalReplays > 0);
  assert.ok(twoSearch.counters.numericalModelRouteSteps >= 2);
  assert.ok(twoSearch.counters.numericalProposals >= 1);
});

void test('attributes an outer start performed by a failing share microstep', () => {
  const huge = 1n << 255n;
  const context = publish(
    'service-failed-share',
    [
      pool('left-1', 'A', 'LX', 1n, huge),
      pool('left-2', 'LX', 'LY', 1n, huge),
      pool('left-3', 'LY', 'B', 1n, huge),
      pool('right-1', 'A', 'RX', 1n, huge),
      pool('right-2', 'RX', 'RY', 1n, huge),
      pool('right-3', 'RY', 'B', 1n, huge),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, huge),
    mintControl(context, 100n),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  const counters = result.plan.search.counters;
  assert.equal(counters.numericalProposals, 1);
  assert.equal(counters.numericalShareMicrosteps, 1);
  assert.equal(counters.numericalOuterUpdatesStarted, 1);
  assert.equal(counters.numericalOuterUpdatesCompleted, 0);
  assert.equal(counters.numericalProposalFailures, 1);
  assert.deepEqual(result.plan.search.numericalDiagnostics[0], {
    candidateSetKeyDigest:
      result.plan.search.numericalDiagnostics[0]?.candidateSetKeyDigest,
    routeKeyDigests:
      result.plan.search.numericalDiagnostics[0]?.routeKeyDigests,
    status: 'failed',
    failureCode: 'non-finite-proposal',
    converged: false,
    residualUnits: null,
    counters: {
      modelRouteSteps: 2,
      outerUpdatesStarted: 1,
      outerUpdatesCompleted: 0,
      shareMicrosteps: 1,
      reconstructionSteps: 0,
      residualOptionReplays: 0,
      residualOptionReplayRejections: 0,
      authorizationReplays: 0,
      authorizationReplayRejections: 0,
    },
  });
});

void test('preserves a semantic numerical outcome when cancellation reaches its diagnostic boundary', () => {
  const context = publish(
    'service-f5-diagnostic-stop',
    [
      pool('f5-left', 'A', 'B', 1n, 3n),
      pool('f5-right', 'A', 'B', 3n, 4n),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 5n),
    mintControl(
      context,
      100n,
      (checkpoint) => checkpoint.nextActionKind === 'diagnostic-bookkeeping',
    ),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'interrupted');
  assert.equal(result.plan.search.counters.diagnosticsRetained, 1);
  assert.equal(result.plan.search.counters.bookkeepingSteps, 2);
  assert.equal(result.plan.search.numericalDiagnostics[0]?.status, 'improved');
  assert.equal(result.plan.search.numericalDiagnostics[0]?.failureCode, null);
  assert.equal(result.plan.search.numericalDiagnostics[0]?.converged, true);
});

void test('runs later-family equal work before its numerical model lane', () => {
  const actions: string[] = [];
  const context = publish(
    'service-later-family-order',
    [pool('order-1'), pool('order-2'), pool('order-3')],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n, (checkpoint) => {
      actions.push(checkpoint.nextActionKind);
      return false;
    }),
  );
  assert.equal(result.status, 'success');
  const firstDiagnostic = actions.indexOf('diagnostic-bookkeeping');
  const laterEqual = actions.indexOf('equal-proposal-replay', firstDiagnostic + 1);
  const laterModel = actions.indexOf('numerical-model-route', firstDiagnostic + 1);
  assert.ok(firstDiagnostic >= 0);
  assert.ok(laterEqual > firstDiagnostic);
  assert.ok(laterModel > laterEqual);
});

void test('completes naturally when numerical work exhausts its cap exactly', () => {
  const context = publish(
    'service-exact-numerical-cap',
    [pool('cap-1'), pool('cap-2'), pool('cap-3')],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'complete');
  assert.equal(
    result.plan.search.counters.numericalProposals,
    SERVICE_ROUTING_POLICY_V1.maxNumericalProposals,
  );
  assert.equal(
    result.plan.search.counters.diagnosticsRetained,
    SERVICE_ROUTING_POLICY_V1.maxNumericalDiagnostics,
  );
});

void test('reports work-limit when another numerical family is pending at the cap', () => {
  const context = publish(
    'service-pending-numerical-cap',
    [pool('cap-1'), pool('cap-2'), pool('cap-3'), pool('cap-4')],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined),
    mintControl(context, 100n),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'work-limit');
  assert.equal(
    result.plan.search.counters.numericalProposals,
    SERVICE_ROUTING_POLICY_V1.maxNumericalProposals,
  );
  assert.equal(
    result.plan.search.counters.diagnosticsRetained,
    SERVICE_ROUTING_POLICY_V1.maxNumericalDiagnostics,
  );
});

void test('activates the first strict pipeline after refinement finds the first incumbent', () => {
  const actions: string[] = [];
  const pools = [
    ...Array.from({ length: 8 }, (_, index) =>
      pool(`0${index}-rejected`, 'A', 'B', 1_000n, 1n),
    ),
    pool('08-valid', 'A', 'B', 1_000n, 1_000n),
  ];
  const context = publish('service-refinement-strict', pools, () => 0n);
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 2n),
    mintControl(context, 100n, (checkpoint) => {
      actions.push(checkpoint.nextActionKind);
      return false;
    }),
  );
  assert.equal(result.status, 'success');
  const ninthDirect = actions.reduce<number[]>(
    (indices, action, index) =>
      action === 'direct-candidate-replay' ? [...indices, index] : indices,
    [],
  )[8];
  assert.ok(ninthDirect !== undefined);
  const strictStart = actions.indexOf('numerical-model-route', ninthDirect + 1);
  const strictEnd = actions.indexOf('diagnostic-bookkeeping', strictStart + 1);
  assert.ok(strictStart > ninthDirect);
  assert.ok(strictEnd > strictStart);
  const forbidden = new Set([
    'direct-candidate-replay',
    'path-expansion',
    'best-single-candidate-replay',
    'candidate-set-step',
    'greedy-option-replay',
  ]);
  assert.equal(
    actions.slice(strictStart, strictEnd).some((action) => forbidden.has(action)),
    false,
  );
});

void test('retains a converged stopped diagnostic when cancellation reaches reconstruction', () => {
  const context = publish(
    'service-f5-stop',
    [
      pool('f5-left', 'A', 'B', 1n, 3n),
      pool('f5-right', 'A', 'B', 3n, 4n),
    ],
    () => 0n,
  );
  const result = routeExactInputSplitServiceV2(
    context,
    captureIntent(context, undefined, 5n),
    mintControl(
      context,
      100n,
      (checkpoint) =>
        checkpoint.nextActionKind === 'numerical-reconstruction-step',
    ),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.plan.search.termination, 'interrupted');
  assert.equal(result.plan.search.counters.numericalShareMicrosteps, 8_515);
  assert.equal(result.plan.search.counters.numericalReconstructionSteps, 0);
  assert.equal(result.plan.search.counters.diagnosticsRetained, 1);
  assert.equal(result.plan.search.counters.terminalProjections, 1);
  const diagnostic = result.plan.search.numericalDiagnostics[0];
  assert.equal(diagnostic?.status, 'stopped');
  assert.equal(diagnostic?.failureCode, 'interrupted');
  assert.equal(diagnostic?.converged, true);
  assert.equal(diagnostic?.counters.reconstructionSteps, 0);
});

void test('returns fresh deeply frozen projections and keeps debug observational', () => {
  const context = publish('service-fresh', [pool('pool-ab')], () => 0n);
  const intent = captureIntent(context, undefined);
  const withoutDebug = mintControl(context, 100n, undefined, false);
  const withDebug = mintControl(context, 100n, undefined, true);
  const first = routeExactInputSplitServiceV2(context, intent, withoutDebug);
  const second = routeExactInputSplitServiceV2(context, intent, withoutDebug);
  const debug = routeExactInputSplitServiceV2(context, intent, withDebug);
  assert.equal(first.status, 'success');
  assert.equal(second.status, 'success');
  assert.equal(debug.status, 'success');
  if (first.status !== 'success' || second.status !== 'success') return;
  assert.notEqual(first, second);
  assert.notEqual(first.plan, second.plan);
  assert.notEqual(first.plan.search, second.plan.search);
  assert.notEqual(first.plan.search.counters, second.plan.search.counters);
  assert.notEqual(first.plan.receipt, second.plan.receipt);
  assert.equal(first.plan.search.debug, null);
  if (debug.status === 'success') {
    assert.deepEqual(debug.plan.receipt, first.plan.receipt);
    assert.deepEqual(debug.plan.search.counters, first.plan.search.counters);
    assert.deepEqual(debug.plan.search.debug, {
      truncated: false,
      fragments: [],
    });
  }
  assertDeepFrozen(first);
  assertDeepFrozen(second);
  assertDeepFrozen(debug);
  assert.equal(resultSearch(first)?.numericalDiagnostics.length, 0);
});
