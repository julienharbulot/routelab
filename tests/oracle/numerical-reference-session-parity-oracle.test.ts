import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../../src/runtime/prepared-routing-context/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  routeExactInputSplitNumericalAnytimeWithAuthorizationReplay,
  routeExactInputSplitNumericalAnytimeWithProposalDriver,
  type NumericalExactInputSplitAuthorizationReplay,
  type NumericalExactInputSplitProposalDriver,
  type NumericalExactInputSplitRuntimeCheckpoint,
  type NumericalExactInputSplitRuntimeRequest,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCaps,
  type NumericalExactInputSplitWorkCounters,
} from '../../src/router/numerical-exact-input-split/index.ts';

interface ExpectedCheckpoint {
  readonly kind: NumericalExactInputSplitRuntimeCheckpoint['nextWorkKind'];
  readonly counters: NumericalExactInputSplitWorkCounters;
  readonly incumbentAmountOut: bigint;
}

const COMPLETE_CAPS: NumericalExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 100,
  maxBestSingleCandidateReplays: 100,
  maxCandidateSetExpansions: 100,
  maxEqualProposalReplays: 100,
  maxGreedyOptionReplays: 100,
  maxFinalAuthorizationReplays: 100,
  maxNumericalProposals: 100,
  maxNumericalIterations: 100,
  maxNumericalResidualReplays: 100,
  maxNumericalAuthorizationReplays: 100,
});

const DIRECT_COUNTERS: NumericalExactInputSplitWorkCounters = Object.freeze({
  directCandidates: 2,
  directCandidateReplays: 2,
  directCandidateRejections: 0,
  pathExpansions: 0,
  bestSingleCandidateReplays: 0,
  bestSingleCandidateRejections: 0,
  candidateSetExpansions: 0,
  equalProposalReplays: 0,
  equalProposalRejections: 0,
  greedyOptionReplays: 0,
  greedyOptionRejections: 0,
  finalAuthorizationReplays: 0,
  finalAuthorizationRejections: 0,
  numericalProposals: 0,
  numericalProposalFailures: 0,
  numericalIterations: 0,
  numericalResidualReplays: 0,
  numericalResidualReplayRejections: 0,
  numericalAuthorizationReplays: 0,
  numericalAuthorizationReplayRejections: 0,
});

const BASELINE_COUNTERS: NumericalExactInputSplitWorkCounters = Object.freeze({
  ...DIRECT_COUNTERS,
  pathExpansions: 2,
  bestSingleCandidateReplays: 2,
  candidateSetExpansions: 2,
  equalProposalReplays: 1,
  greedyOptionReplays: 4,
  finalAuthorizationReplays: 1,
});

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalSnapshotContent(value: LiquiditySnapshot): string {
  const pools = [...value.pools]
    .sort((left, right) => compareRawUtf16(left.poolId, right.poolId))
    .map((candidate) => ({
      poolId: candidate.poolId,
      asset0: candidate.asset0,
      reserve0: candidate.reserve0.toString(10),
      asset1: candidate.asset1,
      reserve1: candidate.reserve1.toString(10),
      feeChargedNumerator: candidate.feeChargedNumerator.toString(10),
      feeDenominator: candidate.feeDenominator.toString(10),
    }));
  return JSON.stringify({ schemaVersion: 'routelab.snapshot.v1', pools });
}

function pool(
  poolId: string,
  reserve0: bigint,
  reserve1: bigint,
  asset0 = 'A',
  asset1 = 'C',
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId: string,
): LiquiditySnapshot {
  const pending: LiquiditySnapshot = { snapshotId, snapshotChecksum: 'pending', pools };
  const digest = createHash('sha256')
    .update(canonicalSnapshotContent(pending), 'utf8')
    .digest('hex');
  return { ...pending, snapshotChecksum: `sha256:${digest}` };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  if (!result.ok) assert.fail(`prepared context rejected: ${result.error.code}`);
  return result.value;
}

function request(
  value: LiquiditySnapshot,
  overrides: Partial<NumericalExactInputSplitRuntimeRequest> = {},
): NumericalExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 5n,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
    numerical: {
      outerIterations: 64,
      innerIterations: 64,
      convergenceTolerance: 2 ** -40,
    },
    ...overrides,
  };
}

function search(result: NumericalExactInputSplitRuntimeResult) {
  if (result.status === 'invalid-request' || result.status === 'invalid-control') {
    assert.fail(`unexpected ${result.status}`);
  }
  if (result.status === 'success') return result.plan.search;
  return result.search;
}

function receipt(result: NumericalExactInputSplitRuntimeResult) {
  if (result.status !== 'success') assert.fail(`expected success, received ${result.status}`);
  return result.plan.receipt;
}

function counters(
  overrides: Partial<NumericalExactInputSplitWorkCounters>,
): NumericalExactInputSplitWorkCounters {
  return { ...DIRECT_COUNTERS, ...overrides };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    assertDeepFrozen(nested, seen);
  }
}

function expectedRt03Trace(): readonly ExpectedCheckpoint[] {
  const expected: ExpectedCheckpoint[] = [
    { kind: 'path-expansion', counters: counters({}), incumbentAmountOut: 2n },
    { kind: 'path-expansion', counters: counters({ pathExpansions: 1 }), incumbentAmountOut: 2n },
    { kind: 'best-single-candidate-replay', counters: counters({ pathExpansions: 2 }), incumbentAmountOut: 2n },
    {
      kind: 'best-single-candidate-replay',
      counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 1 }),
      incumbentAmountOut: 2n,
    },
    {
      kind: 'candidate-set-expansion',
      counters: counters({ pathExpansions: 2, bestSingleCandidateReplays: 2 }),
      incumbentAmountOut: 2n,
    },
    {
      kind: 'candidate-set-expansion',
      counters: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 1,
      }),
      incumbentAmountOut: 2n,
    },
    {
      kind: 'equal-proposal-replay',
      counters: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 2,
      }),
      incumbentAmountOut: 2n,
    },
    {
      kind: 'greedy-option-replay',
      counters: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 2,
        equalProposalReplays: 1,
      }),
      incumbentAmountOut: 2n,
    },
  ];
  for (let greedyOptionReplays = 1; greedyOptionReplays <= 3; greedyOptionReplays += 1) {
    expected.push({
      kind: 'greedy-option-replay',
      counters: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 2,
        equalProposalReplays: 1,
        greedyOptionReplays,
      }),
      incumbentAmountOut: 2n,
    });
  }
  expected.push({
    kind: 'final-authorization-replay',
    counters: counters({
      pathExpansions: 2,
      bestSingleCandidateReplays: 2,
      candidateSetExpansions: 2,
      equalProposalReplays: 1,
      greedyOptionReplays: 4,
    }),
    incumbentAmountOut: 2n,
  });
  expected.push({
    kind: 'numerical-proposal',
    counters: BASELINE_COUNTERS,
    incumbentAmountOut: 3n,
  });
  for (let numericalIterations = 0; numericalIterations < 64; numericalIterations += 1) {
    expected.push({
      kind: 'numerical-iteration',
      counters: { ...BASELINE_COUNTERS, numericalProposals: 1, numericalIterations },
      incumbentAmountOut: 3n,
    });
  }
  expected.push({
    kind: 'numerical-residual-replay',
    counters: {
      ...BASELINE_COUNTERS,
      numericalProposals: 1,
      numericalIterations: 64,
    },
    incumbentAmountOut: 3n,
  });
  expected.push({
    kind: 'numerical-residual-replay',
    counters: {
      ...BASELINE_COUNTERS,
      numericalProposals: 1,
      numericalIterations: 64,
      numericalResidualReplays: 1,
    },
    incumbentAmountOut: 3n,
  });
  expected.push({
    kind: 'numerical-authorization-replay',
    counters: {
      ...BASELINE_COUNTERS,
      numericalProposals: 1,
      numericalIterations: 64,
      numericalResidualReplays: 2,
    },
    incumbentAmountOut: 3n,
  });
  assert.equal(expected.length, 80);
  return expected;
}

void test('RT03 exposes all 80 exact pre-unit checkpoints in the frozen reference order', () => {
  const value = snapshot([
    pool('a-ac', 1n, 3n),
    pool('b-ac', 3n, 4n),
  ], 'RT03');
  assert.equal(
    value.snapshotChecksum,
    'sha256:f92350833e171a9b7840fc1be24a5edcbcceaa1767d058c6abfa1226aaef4e9f',
  );
  const observed: NumericalExactInputSplitRuntimeCheckpoint[] = [];
  const result = routeExactInputSplitNumericalAnytime(
    prepare(value),
    request(value),
    {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt(checkpoint): boolean {
        observed.push(checkpoint);
        return false;
      },
    },
  );
  const expected = expectedRt03Trace();
  assert.equal(observed.length, 80);
  for (const [index, checkpoint] of observed.entries()) {
    const expectedCheckpoint = expected[index]!;
    assert.equal(checkpoint.nextWorkKind, expectedCheckpoint.kind, `checkpoint ${index + 1}`);
    assert.deepEqual(checkpoint.counters, expectedCheckpoint.counters, `checkpoint ${index + 1}`);
    assert.equal(checkpoint.incumbent?.amountOut, expectedCheckpoint.incumbentAmountOut, `checkpoint ${index + 1}`);
    assertDeepFrozen(checkpoint);
  }
  assert.equal(new Set(observed).size, 80);
  assert.equal(new Set(observed.map(({ counters: item }) => item)).size, 80);
  assert.equal(search(result).termination, 'complete');
  assert.deepEqual(search(result).counters, {
    ...BASELINE_COUNTERS,
    numericalProposals: 1,
    numericalIterations: 64,
    numericalResidualReplays: 2,
    numericalAuthorizationReplays: 1,
  });
  assert.equal(receipt(result).amountOut, 4n);
  assert.deepEqual(
    receipt(result).legs.map(({ allocation, receipt: legReceipt }) => [
      legReceipt.hops[0]?.poolId,
      allocation,
    ]),
    [['a-ac', 2n], ['b-ac', 3n]],
  );
});

void test('proposal driver preserves property timing, method receiver, and state identity', () => {
  const value = snapshot([
    pool('a-ac', 1n, 3n),
    pool('b-ac', 3n, 4n),
  ], 'proposal-driver-call-identity');
  const states = [0, 1, 2, 3].map((completedOuterIterations) => (
    Object.freeze({ completedOuterIterations })
  ));
  const events: string[] = [];
  let prepareInput: unknown;
  const target = {
    prepare(this: unknown, input: unknown): unknown {
      assert.equal(this, driver);
      events.push('call.prepare');
      prepareInput = input;
      return {
        ok: true,
        value: {
          state: states[0],
          routeModels: Object.freeze([]),
        },
      };
    },
    advance(this: unknown, state: { readonly completedOuterIterations: number }): unknown {
      assert.equal(this, driver);
      events.push(`call.advance.${state.completedOuterIterations}`);
      assert.equal(state, states[state.completedOuterIterations]);
      const completed = state.completedOuterIterations + 1;
      return {
        ok: true,
        value: {
          status: completed === 3 ? 'ready' : 'continue',
          state: states[completed],
        },
      };
    },
    finalize(this: unknown, state: { readonly completedOuterIterations: number }): unknown {
      assert.equal(this, driver);
      events.push(`call.finalize.${state.completedOuterIterations}`);
      assert.equal(state, states[3]);
      return {
        ok: false,
        error: {
          code: 'invalid-reconstruction',
          converged: true,
          completedOuterIterations: 3,
        },
      };
    },
  };
  const driver = new Proxy(target, {
    get(source, property, receiver): unknown {
      events.push(`get.${String(property)}`);
      return Reflect.get(source, property, receiver);
    },
  }) as unknown as NumericalExactInputSplitProposalDriver;
  const result = routeExactInputSplitNumericalAnytimeWithProposalDriver(
    prepare(value),
    request(value, {
      numerical: {
        outerIterations: 3,
        innerIterations: 5,
        convergenceTolerance: 1,
      },
    }),
    { workCaps: COMPLETE_CAPS },
    driver,
  );
  assert.deepEqual(events, [
    'get.prepare',
    'call.prepare',
    'get.advance',
    'call.advance.0',
    'get.advance',
    'call.advance.1',
    'get.advance',
    'call.advance.2',
    'get.finalize',
    'call.finalize.3',
  ]);
  assert.equal(Object.isFrozen(prepareInput), true);
  const input = prepareInput as {
    readonly amountIn: bigint;
    readonly routes: readonly unknown[];
    readonly configuration: object;
  };
  assert.equal(input.amountIn, 5n);
  assert.equal(input.routes.length, 2);
  assert.equal(Object.isFrozen(input.routes), true);
  assert.equal(Object.isFrozen(input.configuration), true);
  assert.equal(receipt(result).amountOut, 3n);
  assert.equal(search(result).counters.numericalProposals, 1);
  assert.equal(search(result).counters.numericalIterations, 3);
  assert.equal(search(result).counters.numericalProposalFailures, 1);
  assert.deepEqual(search(result).numericalDiagnostics.map((diagnostic) => ({
    status: diagnostic.status,
    failureCode: diagnostic.failureCode,
    completedOuterIterations: diagnostic.completedOuterIterations,
    configuredInnerIterations: diagnostic.configuredInnerIterations,
  })), [{
    status: 'failed',
    failureCode: 'invalid-reconstruction',
    completedOuterIterations: 3,
    configuredInnerIterations: 5,
  }]);
});

void test('authorization replay remains a plain phase-limited function call', () => {
  const value = snapshot([
    pool('a-ac', 1n, 3n),
    pool('b-ac', 3n, 4n),
  ], 'authorization-call-identity');
  let calls = 0;
  const authorization: NumericalExactInputSplitAuthorizationReplay = function (
    this: unknown,
    _context,
    replayRequest,
  ) {
    assert.equal(this, undefined);
    calls += 1;
    assert.equal(replayRequest.amountIn, 5n);
    assert.deepEqual(replayRequest.legs.map(({ allocation }) => allocation), [2n, 3n]);
    return {
      ok: false,
      error: {
        code: 'empty-legs',
        message: 'independent forced authorization rejection',
        legIndex: null,
        causeCode: null,
      },
    };
  };
  const result = routeExactInputSplitNumericalAnytimeWithAuthorizationReplay(
    prepare(value),
    request(value),
    { workCaps: COMPLETE_CAPS },
    authorization,
  );
  assert.equal(calls, 1);
  assert.equal(receipt(result).amountOut, 3n);
  assert.equal(search(result).counters.numericalAuthorizationReplays, 1);
  assert.equal(search(result).counters.numericalAuthorizationReplayRejections, 1);
  assert.equal(search(result).numericalDiagnostics[0]?.failureCode, 'authorization-replay-rejected');
});

void test('numerical wrapper projects no-incumbent baseline dependency errors without a tail', () => {
  const value = snapshot([
    pool('a-x', 100n, 100n, 'A', 'X'),
    pool('x-c', 100n, 100n, 'X', 'C'),
  ], 'numerical-no-incumbent-errors');
  const runtimeRequest = request(value, { maxHops: 2 });
  const callbackFailure = routeExactInputSplitNumericalAnytime(
    prepare(value),
    runtimeRequest,
    {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt(): boolean {
        throw new Error('forced callback failure');
      },
    },
  );
  assert.equal(callbackFailure.status, 'control-error');
  if (callbackFailure.status !== 'control-error') assert.fail('expected control error');
  assert.equal(callbackFailure.incumbent, null);
  assert.equal(callbackFailure.error.code, 'interruption-check-failed');
  assert.equal(callbackFailure.search.counters.pathExpansions, 0);
  assert.equal(callbackFailure.search.counters.numericalProposals, 0);
  assert.deepEqual(callbackFailure.search.numericalDiagnostics, []);

  const samples = [1n, 0n];
  const regression = routeExactInputSplitNumericalAnytime(
    prepare(value),
    runtimeRequest,
    {
      workCaps: COMPLETE_CAPS,
      deadline: {
        deadlineNanoseconds: 100n,
        nowNanoseconds: () => samples.shift() ?? 0n,
      },
    },
  );
  assert.equal(regression.status, 'deadline-error');
  if (regression.status !== 'deadline-error') assert.fail('expected deadline error');
  assert.equal(regression.incumbent, null);
  assert.equal(regression.error.code, 'deadline-clock-regressed');
  assert.equal(regression.search.counters.pathExpansions, 1);
  assert.equal(regression.search.counters.numericalProposals, 0);
  assert.deepEqual(regression.search.numericalDiagnostics, []);
  assertDeepFrozen(callbackFailure);
  assertDeepFrozen(regression);
});

void test('oracle import audit keeps production replay, search, allocation, objective, and session math out', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  for (const forbidden of [
    '/allocation/',
    '/replay/exact-input-',
    '/search/',
    '/router/anytime-exact-input-split/',
    '/split-exact-input/objective',
    '/exact-input-split-session/',
  ]) {
    assert.equal(source.includes(`from '../../src${forbidden}`), false, forbidden);
  }
});
