import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  replayExactInputSplit,
  type ExactInputSplitReplayRequest,
} from '../src/replay/exact-input-split/index.ts';
import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeControl,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitRuntimeWorkKind,
  type ExactInputSplitWorkCaps,
} from '../src/router/anytime-exact-input-split/index.ts';
import {
  prepareRoutingContext,
  replayPreparedExactInputSplit,
  type PreparedRoutingContext,
} from '../src/runtime/prepared-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

function pool(
  poolId: string,
  reserveIn = 100n,
  reserveOut = 100n,
  assetIn = 'A',
  assetOut = 'C',
): ConstantProductPool {
  return {
    poolId,
    asset0: assetIn,
    reserve0: reserveIn,
    asset1: assetOut,
    reserve1: reserveOut,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  const value = { snapshotId: 'anytime-split', snapshotChecksum: 'pending', pools };
  return { ...value, snapshotChecksum: computeCanonicalSnapshotChecksum(value) };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected context preparation to succeed.');
  return result.value;
}

function request(value: LiquiditySnapshot, overrides: Partial<ExactInputSplitRuntimeRequest> = {}): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
    ...overrides,
  };
}

const COMPLETE_CAPS: ExactInputSplitWorkCaps = {
  maxPathExpansions: 100,
  maxBestSingleCandidateReplays: 100,
  maxCandidateSetExpansions: 100,
  maxEqualProposalReplays: 100,
  maxGreedyOptionReplays: 100,
  maxFinalAuthorizationReplays: 100,
};

function control(overrides: Partial<ExactInputSplitWorkCaps> = {}): ExactInputSplitRuntimeControl {
  return { workCaps: { ...COMPLETE_CAPS, ...overrides } };
}

function success(result: ReturnType<typeof routeExactInputSplitAnytime>) {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('Expected a successful result.');
  return result.plan;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

const SPLIT_POOLS = [pool('left-ac'), pool('right-ac')];

void test('establishes exact direct 50 before controls and authorizes the exact split 66 distinctly', () => {
  const value = snapshot(SPLIT_POOLS);
  const observed: Array<{ kind: ExactInputSplitRuntimeWorkKind; amountOut: bigint | null }> = [];
  const result = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt(checkpoint) {
      observed.push({ kind: checkpoint.nextWorkKind, amountOut: checkpoint.incumbent?.amountOut ?? null });
      assertDeepFrozen(checkpoint);
      return false;
    },
  });
  const plan = success(result);
  assert.equal(observed[0]?.kind, 'path-expansion');
  assert.equal(observed[0]?.amountOut, 50n);
  assert.ok(
    observed.findIndex(({ kind }) => kind === 'final-authorization-replay') >
      observed.findLastIndex(({ kind }) => kind === 'greedy-option-replay'),
  );
  assert.equal(plan.receipt.amountOut, 66n);
  assert.deepEqual(plan.receipt.legs.map(({ allocation }) => allocation), [50n, 50n]);
  assert.deepEqual(plan.search.counters, {
    directCandidates: 2,
    directCandidateReplays: 2,
    directCandidateRejections: 0,
    pathExpansions: 2,
    bestSingleCandidateReplays: 2,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 2,
    equalProposalReplays: 1,
    equalProposalRejections: 0,
    greedyOptionReplays: 4,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 1,
    finalAuthorizationRejections: 0,
  });
  assert.equal(plan.search.termination, 'complete');
  assertDeepFrozen(result);
});

void test('honors zero advanced caps after uncapped direct establishment without observing controls', () => {
  const value = snapshot(SPLIT_POOLS);
  let callbacks = 0;
  let clocks = 0;
  const result = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: {
      maxPathExpansions: 0,
      maxBestSingleCandidateReplays: 0,
      maxCandidateSetExpansions: 0,
      maxEqualProposalReplays: 0,
      maxGreedyOptionReplays: 0,
      maxFinalAuthorizationReplays: 0,
    },
    shouldInterrupt: () => { callbacks += 1; return true; },
    deadline: { deadlineNanoseconds: 0n, nowNanoseconds: () => { clocks += 1; return 0n; } },
  });
  const plan = success(result);
  assert.equal(plan.receipt.amountOut, 50n);
  assert.equal(plan.search.termination, 'work-limit');
  assert.equal(plan.search.counters.directCandidateReplays, 2);
  assert.equal(plan.search.counters.pathExpansions, 0);
  assert.equal(callbacks, 0);
  assert.equal(clocks, 0);
});

void test('samples an already-expired deadline only after establishing the direct baseline', () => {
  const value = snapshot(SPLIT_POOLS);
  const result = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    deadline: { deadlineNanoseconds: 7n, nowNanoseconds: () => 7n },
  });
  const plan = success(result);
  assert.equal(plan.receipt.amountOut, 50n);
  assert.equal(plan.search.termination, 'deadline');
  assert.equal(plan.search.counters.directCandidateReplays, 2);
  assert.equal(plan.search.counters.pathExpansions, 0);
});

void test('returns typed no-plan at the first capped unit when no direct baseline exists', () => {
  const value = snapshot([
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('xc', 100n, 100n, 'X', 'C'),
  ]);
  const result = routeExactInputSplitAnytime(
    prepare(value),
    request(value, { maxHops: 2 }),
    control({ maxPathExpansions: 0 }),
  );
  assert.deepEqual(result, {
    status: 'no-plan',
    reason: 'work-limit',
    search: {
      counters: {
        directCandidates: 0, directCandidateReplays: 0, directCandidateRejections: 0,
        pathExpansions: 0, bestSingleCandidateReplays: 0, bestSingleCandidateRejections: 0,
        candidateSetExpansions: 0, equalProposalReplays: 0, equalProposalRejections: 0,
        greedyOptionReplays: 0, greedyOptionRejections: 0,
        finalAuthorizationReplays: 0, finalAuthorizationRejections: 0,
      },
      termination: 'work-limit',
    },
  });
});

void test('keeps unreplayed paths eligible for split work after the best-single cap closes', () => {
  const value = snapshot([
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('xc', 100n, 100n, 'X', 'C'),
    pool('ay', 100n, 100n, 'A', 'Y'),
    pool('yc', 100n, 100n, 'Y', 'C'),
  ]);
  const result = routeExactInputSplitAnytime(
    prepare(value),
    request(value, { maxHops: 2 }),
    control({ maxBestSingleCandidateReplays: 0 }),
  );
  const plan = success(result);
  assert.equal(plan.search.termination, 'work-limit');
  assert.equal(plan.search.counters.bestSingleCandidateReplays, 0);
  assert.equal(plan.search.counters.equalProposalReplays, 1);
  assert.equal(plan.search.counters.finalAuthorizationReplays, 1);
  assert.equal(plan.receipt.amountOut, 48n);
});

void test('authorizes a better best-single replay without split final-authorization work', () => {
  const value = snapshot([
    pool('direct-ac', 100n, 50n),
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('xc', 100n, 100n, 'X', 'C'),
  ]);
  const result = routeExactInputSplitAnytime(
    prepare(value),
    request(value, { maxHops: 2, maxRoutes: 1 }),
    control({ maxFinalAuthorizationReplays: 0 }),
  );
  const plan = success(result);
  assert.equal(plan.search.termination, 'complete');
  assert.equal(plan.receipt.amountOut, 33n);
  assert.deepEqual(plan.receipt.legs[0]?.receipt.hops.map(({ poolId }) => poolId), ['ax', 'xc']);
  assert.equal(plan.search.counters.bestSingleCandidateReplays, 2);
  assert.equal(plan.search.counters.finalAuthorizationReplays, 0);
});

void test('forces every eligible boundary without accounting the pending unit', () => {
  const value = snapshot(SPLIT_POOLS);
  const kinds: readonly ExactInputSplitRuntimeWorkKind[] = [
    'path-expansion',
    'best-single-candidate-replay',
    'candidate-set-expansion',
    'equal-proposal-replay',
    'final-authorization-replay',
    'greedy-option-replay',
  ];
  for (const kind of kinds) {
    let priorCounters: unknown;
    const result = routeExactInputSplitAnytime(prepare(value), request(value), {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt(checkpoint) {
        if (checkpoint.nextWorkKind !== kind) return false;
        priorCounters = checkpoint.counters;
        return true;
      },
    });
    const plan = success(result);
    assert.equal(plan.search.termination, 'interrupted');
    assert.deepEqual(plan.search.counters, priorCounters);
    assert.equal(plan.receipt.amountOut, 50n);
  }
});

void test('applies cap before callback and treats equality at natural exhaustion as complete', () => {
  const value = snapshot(SPLIT_POOLS);
  const capCallbacks: ExactInputSplitRuntimeWorkKind[] = [];
  const capped = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: { ...COMPLETE_CAPS, maxPathExpansions: 1 },
    shouldInterrupt: (checkpoint) => { capCallbacks.push(checkpoint.nextWorkKind); return false; },
  });
  assert.equal(success(capped).search.termination, 'work-limit');
  assert.equal(success(capped).search.counters.pathExpansions, 1);
  assert.equal(capCallbacks.filter((kind) => kind === 'path-expansion').length, 1);

  const exact = routeExactInputSplitAnytime(prepare(value), request(value), control({
    maxPathExpansions: 2,
    maxBestSingleCandidateReplays: 2,
    maxCandidateSetExpansions: 2,
    maxEqualProposalReplays: 1,
    maxGreedyOptionReplays: 4,
    maxFinalAuthorizationReplays: 1,
  }));
  assert.equal(success(exact).search.termination, 'complete');
  assert.equal(success(exact).receipt.amountOut, 66n);
  assert.equal(success(exact).search.counters.finalAuthorizationReplays, 1);
});

void test('sorts unique proposals best-first so added equal work cannot consume scarce authorization', () => {
  const value = snapshot([
    pool('left-ac', 50n, 50n),
    pool('right-ac', 50n, 100n),
  ]);
  const run = (equalCap: number) => routeExactInputSplitAnytime(
    prepare(value),
    request(value, { greedyParts: 4 }),
    control({
      maxEqualProposalReplays: equalCap,
      maxGreedyOptionReplays: 8,
      maxFinalAuthorizationReplays: 1,
    }),
  );
  const withoutEqual = success(run(0));
  const withEqual = success(run(1));
  assert.equal(withoutEqual.receipt.amountOut, 76n);
  assert.equal(withEqual.receipt.amountOut, 76n);
  assert.equal(withoutEqual.search.counters.finalAuthorizationReplays, 1);
  assert.equal(withEqual.search.counters.finalAuthorizationReplays, 1);

  const duplicateValue = snapshot(SPLIT_POOLS);
  const duplicate = success(routeExactInputSplitAnytime(
    prepare(duplicateValue),
    request(duplicateValue),
    control({
      maxPathExpansions: 2,
      maxBestSingleCandidateReplays: 2,
      maxCandidateSetExpansions: 2,
      maxEqualProposalReplays: 1,
      maxGreedyOptionReplays: 4,
      maxFinalAuthorizationReplays: 1,
    }),
  ));
  assert.equal(duplicate.search.termination, 'complete');
  assert.equal(duplicate.search.counters.finalAuthorizationReplays, 1);
});

void test('keeps the anchored set frontier prefix stable when discovery appends a path', () => {
  const value = snapshot([
    pool('a'),
    pool('b'),
    pool('c'),
    pool('z', 100n, 1n),
  ]);
  const run = (pathCap: number) => routeExactInputSplitAnytime(
    prepare(value),
    request(value, { maxRoutes: 3 }),
    control({
      maxPathExpansions: pathCap,
      maxCandidateSetExpansions: 9,
      maxGreedyOptionReplays: 0,
    }),
  );
  const three = success(run(3));
  const four = success(run(4));
  assert.equal(three.receipt.amountOut, 73n);
  assert.equal(four.receipt.amountOut, 73n);
  assert.equal(three.search.counters.candidateSetExpansions, 9);
  assert.equal(four.search.counters.candidateSetExpansions, 9);

  const threePathValue = snapshot([pool('a'), pool('b'), pool('c')]);
  const naturallyExhausted = success(routeExactInputSplitAnytime(
    prepare(threePathValue),
    request(threePathValue, { maxRoutes: 3 }),
    control({
      maxPathExpansions: 3,
      maxBestSingleCandidateReplays: 3,
      maxCandidateSetExpansions: 10,
    }),
  ));
  assert.equal(naturallyExhausted.search.counters.candidateSetExpansions, 10);
  assert.equal(naturallyExhausted.search.termination, 'complete');
});

void test('prepared replay matches legacy validation and exact receipts while consuming prepared pools', () => {
  const value = snapshot([
    pool('a-direct'),
    pool('ax', 10n ** 80n, 2n * 10n ** 80n, 'A', 'X'),
    pool('xc', 2n * 10n ** 80n, 3n * 10n ** 80n, 'X', 'C'),
    pool('ay', 100n, 100n, 'A', 'Y'),
    pool('yx', 100n, 100n, 'Y', 'X'),
    pool('zero', 100n, 1n),
  ]);
  const context = prepare(value);
  const base = {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
  } as const;
  const route = [
    { assetIn: 'A', poolId: 'ax', assetOut: 'X' },
    { assetIn: 'X', poolId: 'xc', assetOut: 'C' },
  ] as const;
  const cases: ExactInputSplitReplayRequest[] = [
    { ...base, amountIn: 100n, legs: [{ allocation: 100n, route: [{ assetIn: 'A', poolId: 'a-direct', assetOut: 'C' }] }] },
    { ...base, amountIn: 10n ** 60n, legs: [{ allocation: 10n ** 60n, route }] },
    { ...base, amountIn: 1n, legs: [{ allocation: 0n, route }, { allocation: 1n, route: [{ assetIn: 'A', poolId: 'a-direct', assetOut: 'C' }] }] },
    { ...base, amountIn: 2n, legs: [
      { allocation: 1n, route: [{ assetIn: 'A', poolId: 'zero', assetOut: 'C' }] },
      { allocation: 1n, route: [{ assetIn: 'A', poolId: 'a-direct', assetOut: 'C' }] },
    ] },
    { ...base, amountIn: 1n, legs: [{ allocation: 1n, route: [{ assetIn: 'A', poolId: 'missing', assetOut: 'C' }] }] },
    { ...base, amountIn: 1n, legs: [{ allocation: 1n, route: [{ assetIn: 'A', poolId: 'zero', assetOut: 'C' }] }] },
    { ...base, amountIn: 3n, legs: [{ allocation: 2n, route: [{ assetIn: 'A', poolId: 'a-direct', assetOut: 'C' }] }] },
    { ...base, amountIn: 2n, legs: [
      { allocation: 1n, route },
      { allocation: 1n, route: [
        { assetIn: 'A', poolId: 'ay', assetOut: 'Y' },
        { assetIn: 'Y', poolId: 'yx', assetOut: 'X' },
        { assetIn: 'X', poolId: 'xc', assetOut: 'C' },
      ] },
    ] },
  ];
  for (const replayRequest of cases) {
    assert.deepEqual(
      replayPreparedExactInputSplit(context, replayRequest),
      replayExactInputSplit(value, replayRequest),
    );
  }
});

void test('classifies callback and clock failures with unchanged pre-unit ledgers', () => {
  const value = snapshot(SPLIT_POOLS);
  const callbackThrow = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt: () => { throw new Error('boom'); },
  });
  assert.equal(callbackThrow.status, 'control-error');
  if (callbackThrow.status === 'control-error') {
    assert.deepEqual(callbackThrow.error, { code: 'interruption-check-failed' });
    assert.equal(callbackThrow.incumbent?.amountOut, 50n);
    assert.equal(callbackThrow.search.counters.pathExpansions, 0);
  }
  const invalidCallback = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    shouldInterrupt: (() => 'yes') as unknown as () => boolean,
  });
  assert.equal(invalidCallback.status, 'control-error');
  if (invalidCallback.status === 'control-error') assert.deepEqual(invalidCallback.error, { code: 'invalid-interruption-result' });

  let sample = 2n;
  const regressed = routeExactInputSplitAnytime(prepare(value), request(value), {
    workCaps: COMPLETE_CAPS,
    deadline: { deadlineNanoseconds: 100n, nowNanoseconds: () => sample-- },
  });
  assert.equal(regressed.status, 'deadline-error');
  if (regressed.status === 'deadline-error') {
    assert.deepEqual(regressed.error, { code: 'deadline-clock-regressed', field: 'nowNanoseconds' });
    assert.equal(regressed.search.counters.pathExpansions, 1);
  }
});

void test('validates captured request/control fields once and rejects forged contexts without work', () => {
  const value = snapshot(SPLIT_POOLS);
  const reads = new Map<string, number>();
  const once = <T>(name: string, item: T) => {
    reads.set(name, (reads.get(name) ?? 0) + 1);
    return item;
  };
  const requestValue = request(value);
  const requestKeys = [
    'snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut',
    'amountIn', 'maxHops', 'maxRoutes', 'greedyParts',
  ] as const;
  const requestSource = Object.defineProperties({}, Object.fromEntries(
    requestKeys.map((name) => [name, { enumerable: true, get: () => once(`request.${name}`, requestValue[name]) }]),
  )) as ExactInputSplitRuntimeRequest;
  const capKeys = [
    'maxPathExpansions', 'maxBestSingleCandidateReplays',
    'maxCandidateSetExpansions', 'maxEqualProposalReplays',
    'maxGreedyOptionReplays', 'maxFinalAuthorizationReplays',
  ] as const;
  const capSource = Object.defineProperties({}, Object.fromEntries(
    capKeys.map((name) => [name, { enumerable: true, get: () => once(`cap.${name}`, COMPLETE_CAPS[name]) }]),
  )) as ExactInputSplitWorkCaps;
  const controlSource = Object.defineProperties({}, {
    workCaps: { get: () => once('control.workCaps', capSource) },
    shouldInterrupt: { get: () => once('control.shouldInterrupt', undefined) },
    deadline: { get: () => once('control.deadline', undefined) },
  }) as ExactInputSplitRuntimeControl;
  assert.equal(routeExactInputSplitAnytime(prepare(value), requestSource, controlSource).status, 'success');
  for (const count of reads.values()) assert.equal(count, 1);

  const forged = Object.freeze({}) as PreparedRoutingContext;
  const forgedResult = routeExactInputSplitAnytime(forged, request(value), control());
  assert.deepEqual(forgedResult, { status: 'invalid-request', error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' } });
});

void test('uses exact bigint reconstruction and returns a complete no-route only after exhaustive work', () => {
  const unit = 10n ** 80n;
  const value = snapshot([pool('left-ac', unit, unit), pool('right-ac', unit, 2n * unit)]);
  const large = routeExactInputSplitAnytime(prepare(value), request(value, { amountIn: 3n * unit + 2n, greedyParts: 3 }), control());
  const plan = success(large);
  assert.equal(plan.receipt.legs.reduce((sum, leg) => sum + leg.allocation, 0n), 3n * unit + 2n);
  assert.equal(typeof plan.receipt.amountOut, 'bigint');

  const disconnected = snapshot([
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('yc', 100n, 100n, 'Y', 'C'),
  ]);
  const noRoute = routeExactInputSplitAnytime(prepare(disconnected), request(disconnected, { maxHops: 3 }), control());
  assert.equal(noRoute.status, 'no-route');
  if (noRoute.status === 'no-route') {
    assert.equal(noRoute.reason, 'no-candidate');
    assert.equal(noRoute.search.termination, 'complete');
  }
});

void test('counts exact replay rejections and keeps huge greedy configurations lazy under a zero cap', () => {
  const rejectedValue = snapshot([pool('zero-left', 100n, 1n), pool('zero-right', 100n, 1n)]);
  const rejected = routeExactInputSplitAnytime(prepare(rejectedValue), request(rejectedValue, { amountIn: 1n }), control());
  assert.equal(rejected.status, 'no-route');
  if (rejected.status === 'no-route') {
    assert.equal(rejected.reason, 'all-candidates-rejected');
    assert.equal(rejected.search.counters.directCandidateRejections, 2);
    assert.equal(rejected.search.counters.bestSingleCandidateRejections, 2);
    assert.equal(rejected.search.counters.equalProposalReplays, 0);
    assert.equal(rejected.search.counters.greedyOptionRejections, 2);
  }

  const splitValue = snapshot(SPLIT_POOLS);
  const lazy = routeExactInputSplitAnytime(
    prepare(splitValue),
    request(splitValue, { greedyParts: Number.MAX_SAFE_INTEGER }),
    control({ maxGreedyOptionReplays: 0 }),
  );
  assert.equal(success(lazy).search.termination, 'work-limit');
  assert.equal(success(lazy).search.counters.greedyOptionReplays, 0);
});

void test('is deterministic under pool permutations and monotonic as heterogeneous caps increase', () => {
  const forward = snapshot(SPLIT_POOLS);
  const reverse = snapshot([...SPLIT_POOLS].reverse());
  const left = routeExactInputSplitAnytime(prepare(forward), request(forward), control());
  const right = routeExactInputSplitAnytime(prepare(reverse), request(reverse), control());
  assert.deepEqual(right, left);

  const outputs: bigint[] = [];
  for (const cap of [0, 1, 2, 4, 100]) {
    const result = routeExactInputSplitAnytime(prepare(forward), request(forward), control({
      maxPathExpansions: cap,
      maxBestSingleCandidateReplays: cap,
      maxCandidateSetExpansions: cap,
      maxEqualProposalReplays: cap,
      maxGreedyOptionReplays: cap,
      maxFinalAuthorizationReplays: cap,
    }));
    outputs.push(success(result).receipt.amountOut);
  }
  assert.deepEqual(outputs, [50n, 50n, 66n, 66n, 66n]);
});
