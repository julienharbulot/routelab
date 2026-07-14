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
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeCheckpoint,
  type ExactInputSplitRuntimeControl,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitRuntimeResult,
  type ExactInputSplitWorkCaps,
  type ExactInputSplitWorkCounters,
} from '../../src/router/anytime-exact-input-split/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitRuntimeRequest,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCaps,
} from '../../src/router/numerical-exact-input-split/index.ts';

const NATURAL_CAPS: ExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 2,
  maxBestSingleCandidateReplays: 2,
  maxCandidateSetExpansions: 2,
  maxEqualProposalReplays: 1,
  maxGreedyOptionReplays: 4,
  maxFinalAuthorizationReplays: 1,
});

const ZERO_COUNTERS: ExactInputSplitWorkCounters = Object.freeze({
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
  overrides: Partial<ExactInputSplitRuntimeRequest> = {},
): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 5n,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
    ...overrides,
  };
}

function numericalRequest(
  value: LiquiditySnapshot,
): NumericalExactInputSplitRuntimeRequest {
  return {
    ...request(value),
    numerical: {
      outerIterations: 64,
      innerIterations: 64,
      convergenceTolerance: 2 ** -40,
    },
  };
}

function numericalCaps(caps: ExactInputSplitWorkCaps): NumericalExactInputSplitWorkCaps {
  return {
    ...caps,
    maxNumericalProposals: 0,
    maxNumericalIterations: 0,
    maxNumericalResidualReplays: 0,
    maxNumericalAuthorizationReplays: 0,
  };
}

function counters(
  overrides: Partial<ExactInputSplitWorkCounters>,
): ExactInputSplitWorkCounters {
  return { ...ZERO_COUNTERS, ...overrides };
}

function referenceSearch(result: ExactInputSplitRuntimeResult) {
  if (result.status === 'invalid-request' || result.status === 'invalid-control') {
    assert.fail(`unexpected ${result.status}`);
  }
  if (result.status === 'success') return result.plan.search;
  return result.search;
}

function numericalSearch(result: NumericalExactInputSplitRuntimeResult) {
  if (result.status === 'invalid-request' || result.status === 'invalid-control') {
    assert.fail(`unexpected ${result.status}`);
  }
  if (result.status === 'success') return result.plan.search;
  return result.search;
}

function referenceAmount(result: ExactInputSplitRuntimeResult): bigint | null {
  if (result.status === 'success') return result.plan.receipt.amountOut;
  if (result.status === 'control-error' || result.status === 'deadline-error') {
    return result.incumbent?.amountOut ?? null;
  }
  return null;
}

function numericalAmount(result: NumericalExactInputSplitRuntimeResult): bigint | null {
  if (result.status === 'success') return result.plan.receipt.amountOut;
  if (result.status === 'control-error' || result.status === 'deadline-error') {
    return result.incumbent?.amountOut ?? null;
  }
  return null;
}

function baselineCounters(
  result: NumericalExactInputSplitRuntimeResult,
): ExactInputSplitWorkCounters {
  const observed = numericalSearch(result).counters;
  return {
    directCandidates: observed.directCandidates,
    directCandidateReplays: observed.directCandidateReplays,
    directCandidateRejections: observed.directCandidateRejections,
    pathExpansions: observed.pathExpansions,
    bestSingleCandidateReplays: observed.bestSingleCandidateReplays,
    bestSingleCandidateRejections: observed.bestSingleCandidateRejections,
    candidateSetExpansions: observed.candidateSetExpansions,
    equalProposalReplays: observed.equalProposalReplays,
    equalProposalRejections: observed.equalProposalRejections,
    greedyOptionReplays: observed.greedyOptionReplays,
    greedyOptionRejections: observed.greedyOptionRejections,
    finalAuthorizationReplays: observed.finalAuthorizationReplays,
    finalAuthorizationRejections: observed.finalAuthorizationRejections,
  };
}

function quote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (amountIn * reserveOut) / (reserveIn + amountIn);
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

void test('independent multi-cap ledgers are identical through each wrapper without baseline recharge', () => {
  const value = snapshot([
    pool('a-ac', 1n, 3n),
    pool('b-ac', 3n, 4n),
  ], 'reference-multi-cap');
  assert.equal(quote(5n, 1n, 3n), 2n);
  assert.equal(quote(5n, 3n, 4n), 2n);
  assert.equal(quote(3n, 1n, 3n) + quote(2n, 3n, 4n), 3n);

  const cases: readonly {
    readonly name: string;
    readonly caps: ExactInputSplitWorkCaps;
    readonly expected: ExactInputSplitWorkCounters;
    readonly termination: 'complete' | 'work-limit';
    readonly amountOut: bigint;
  }[] = [
    {
      name: 'all-zero',
      caps: {
        maxPathExpansions: 0,
        maxBestSingleCandidateReplays: 0,
        maxCandidateSetExpansions: 0,
        maxEqualProposalReplays: 0,
        maxGreedyOptionReplays: 0,
        maxFinalAuthorizationReplays: 0,
      },
      expected: ZERO_COUNTERS,
      termination: 'work-limit',
      amountOut: 2n,
    },
    {
      name: 'one-path-prefix',
      caps: { ...NATURAL_CAPS, maxPathExpansions: 1 },
      expected: counters({ pathExpansions: 1, bestSingleCandidateReplays: 1 }),
      termination: 'work-limit',
      amountOut: 2n,
    },
    {
      name: 'one-set-frontier-step',
      caps: { ...NATURAL_CAPS, maxCandidateSetExpansions: 1 },
      expected: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 1,
      }),
      termination: 'work-limit',
      amountOut: 2n,
    },
    {
      name: 'best-single-closed-but-equal-continues',
      caps: { ...NATURAL_CAPS, maxBestSingleCandidateReplays: 0, maxGreedyOptionReplays: 0 },
      expected: counters({
        pathExpansions: 2,
        candidateSetExpansions: 2,
        equalProposalReplays: 1,
        finalAuthorizationReplays: 1,
      }),
      termination: 'work-limit',
      amountOut: 3n,
    },
    {
      name: 'equal-closed-but-greedy-continues',
      caps: { ...NATURAL_CAPS, maxEqualProposalReplays: 0 },
      expected: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 2,
        greedyOptionReplays: 4,
        finalAuthorizationReplays: 1,
      }),
      termination: 'work-limit',
      amountOut: 3n,
    },
    {
      name: 'authorization-closed',
      caps: { ...NATURAL_CAPS, maxFinalAuthorizationReplays: 0 },
      expected: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 2,
        equalProposalReplays: 1,
        greedyOptionReplays: 4,
      }),
      termination: 'work-limit',
      amountOut: 2n,
    },
    {
      name: 'natural',
      caps: NATURAL_CAPS,
      expected: counters({
        pathExpansions: 2,
        bestSingleCandidateReplays: 2,
        candidateSetExpansions: 2,
        equalProposalReplays: 1,
        greedyOptionReplays: 4,
        finalAuthorizationReplays: 1,
      }),
      termination: 'complete',
      amountOut: 3n,
    },
  ];

  for (const fixture of cases) {
    const reference = routeExactInputSplitAnytime(
      prepare(value),
      request(value),
      { workCaps: fixture.caps },
    );
    assert.deepEqual(referenceSearch(reference).counters, fixture.expected, fixture.name);
    assert.equal(referenceSearch(reference).termination, fixture.termination, fixture.name);
    assert.equal(referenceAmount(reference), fixture.amountOut, fixture.name);

    const numerical = routeExactInputSplitNumericalAnytime(
      prepare(value),
      numericalRequest(value),
      { workCaps: numericalCaps(fixture.caps) },
    );
    assert.deepEqual(baselineCounters(numerical), fixture.expected, fixture.name);
    assert.equal(numericalAmount(numerical), fixture.amountOut, fixture.name);
    assert.equal(numericalSearch(numerical).counters.numericalProposals, 0, fixture.name);
    assert.equal(numericalSearch(numerical).counters.numericalIterations, 0, fixture.name);
  }
});

void test('dependency failures before any incumbent retain null and the exact pre-unit ledger', () => {
  const value = snapshot([
    pool('a-x', 100n, 100n, 'A', 'X'),
    pool('x-c', 100n, 100n, 'X', 'C'),
  ], 'reference-no-incumbent-errors');
  const runtimeRequest = request(value, { maxHops: 2 });
  const noDirectCounters: ExactInputSplitWorkCounters = {
    ...ZERO_COUNTERS,
    directCandidates: 0,
    directCandidateReplays: 0,
  };

  const controls: readonly {
    readonly name: string;
    readonly control: ExactInputSplitRuntimeControl;
    readonly status: 'control-error' | 'deadline-error';
    readonly code: string;
    readonly pathExpansions: number;
  }[] = [
    {
      name: 'callback-throw',
      control: {
        workCaps: { ...NATURAL_CAPS, maxPathExpansions: 100 },
        shouldInterrupt(): boolean {
          throw new Error('forced callback failure');
        },
      },
      status: 'control-error',
      code: 'interruption-check-failed',
      pathExpansions: 0,
    },
    {
      name: 'callback-nonboolean',
      control: {
        workCaps: { ...NATURAL_CAPS, maxPathExpansions: 100 },
        shouldInterrupt: (() => undefined) as never,
      },
      status: 'control-error',
      code: 'invalid-interruption-result',
      pathExpansions: 0,
    },
    {
      name: 'clock-throw',
      control: {
        workCaps: { ...NATURAL_CAPS, maxPathExpansions: 100 },
        deadline: {
          deadlineNanoseconds: 100n,
          nowNanoseconds(): bigint {
            throw new Error('forced clock failure');
          },
        },
      },
      status: 'deadline-error',
      code: 'deadline-clock-failed',
      pathExpansions: 0,
    },
    {
      name: 'clock-nonbigint',
      control: {
        workCaps: { ...NATURAL_CAPS, maxPathExpansions: 100 },
        deadline: {
          deadlineNanoseconds: 100n,
          nowNanoseconds: (() => 1) as never,
        },
      },
      status: 'deadline-error',
      code: 'deadline-clock-failed',
      pathExpansions: 0,
    },
    {
      name: 'clock-negative',
      control: {
        workCaps: { ...NATURAL_CAPS, maxPathExpansions: 100 },
        deadline: { deadlineNanoseconds: 100n, nowNanoseconds: () => -1n },
      },
      status: 'deadline-error',
      code: 'deadline-clock-failed',
      pathExpansions: 0,
    },
    {
      name: 'clock-regression',
      control: (() => {
        const samples = [1n, 0n];
        return {
          workCaps: { ...NATURAL_CAPS, maxPathExpansions: 100 },
          deadline: {
            deadlineNanoseconds: 100n,
            nowNanoseconds: () => samples.shift() ?? 0n,
          },
        };
      })(),
      status: 'deadline-error',
      code: 'deadline-clock-regressed',
      pathExpansions: 1,
    },
  ];

  for (const fixture of controls) {
    const result = routeExactInputSplitAnytime(
      prepare(value),
      runtimeRequest,
      fixture.control,
    );
    assert.equal(result.status, fixture.status, fixture.name);
    if (result.status !== 'control-error' && result.status !== 'deadline-error') {
      assert.fail(`${fixture.name}: expected dependency error`);
    }
    assert.equal(result.error.code, fixture.code, fixture.name);
    assert.equal(result.incumbent, null, fixture.name);
    assert.equal(result.search.termination, fixture.status, fixture.name);
    assert.deepEqual(result.search.counters, {
      ...noDirectCounters,
      pathExpansions: fixture.pathExpansions,
    }, fixture.name);
    assertDeepFrozen(result);
  }
});

void test('reference calls are reentrant, capture caller state once, and return fresh frozen graphs', () => {
  const mutablePools = [
    { ...pool('left-ac', 100n, 100n) },
    { ...pool('right-ac', 100n, 100n) },
  ];
  const value = snapshot(mutablePools, 'reference-reentrant');
  const context = prepare(value);
  mutablePools.reverse();
  mutablePools[0]!.reserve0 = 1n;

  const sourceRequest = { ...request(value, { amountIn: 100n }) };
  const sourceCaps = {
    maxPathExpansions: 100,
    maxBestSingleCandidateReplays: 100,
    maxCandidateSetExpansions: 100,
    maxEqualProposalReplays: 100,
    maxGreedyOptionReplays: 100,
    maxFinalAuthorizationReplays: 100,
  };
  const checkpoints: ExactInputSplitRuntimeCheckpoint[] = [];
  let nested: ExactInputSplitRuntimeResult | undefined;
  let entered = false;
  const outer = routeExactInputSplitAnytime(context, sourceRequest, {
    workCaps: sourceCaps,
    shouldInterrupt(checkpoint): boolean {
      checkpoints.push(checkpoint);
      if (!entered) {
        entered = true;
        sourceRequest.amountIn = 1n;
        sourceRequest.maxHops = 99;
        sourceCaps.maxPathExpansions = 0;
        sourceCaps.maxFinalAuthorizationReplays = 0;
        nested = routeExactInputSplitAnytime(
          context,
          request(value, { amountIn: 100n }),
          { workCaps: { ...NATURAL_CAPS } },
        );
      }
      return false;
    },
  });
  assert.equal(entered, true);
  assert.notEqual(nested, undefined);
  assert.deepEqual(outer, nested);
  assert.equal(referenceAmount(outer), 66n);
  assert.notEqual(outer, nested);
  if (outer.status !== 'success' || nested?.status !== 'success') {
    assert.fail('expected fresh successful results');
  }
  assert.notEqual(outer.plan, nested.plan);
  assert.notEqual(outer.plan.receipt, nested.plan.receipt);
  assert.notEqual(outer.plan.search, nested.plan.search);
  assert.notEqual(outer.plan.search.counters, nested.plan.search.counters);

  const repeated = routeExactInputSplitAnytime(
    context,
    request(value, { amountIn: 100n }),
    { workCaps: { ...NATURAL_CAPS } },
  );
  assert.deepEqual(repeated, nested);
  assert.notEqual(repeated, nested);
  assert.equal(new Set(checkpoints).size, checkpoints.length);
  assert.equal(
    new Set(checkpoints.map(({ counters: observed }) => observed)).size,
    checkpoints.length,
  );
  for (const checkpoint of checkpoints) assertDeepFrozen(checkpoint);
  assertDeepFrozen(outer);
  assertDeepFrozen(nested);
  assertDeepFrozen(repeated);
});

void test('oracle import audit keeps replay, search, allocation, objective, and session internals out', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  for (const forbidden of [
    '/allocation/',
    '/replay/exact-input-',
    '/search/',
    '/split-exact-input/objective',
    '/exact-input-split-session/',
  ]) {
    assert.equal(source.includes(`from '../../src${forbidden}`), false, forbidden);
  }
});
