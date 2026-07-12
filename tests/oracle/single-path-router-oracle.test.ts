import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ConstantProductPool,
  LiquiditySnapshot,
} from '../../src/domain/index.ts';
import {
  routeExactInputSinglePath,
  type ExactInputSinglePathRouterRequest,
} from '../../src/router/single-path/index.ts';

interface OracleHop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface OracleTransitionReceipt extends OracleHop {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly reserveInBefore: bigint;
  readonly reserveOutBefore: bigint;
  readonly reserveInAfter: bigint;
  readonly reserveOutAfter: bigint;
}

interface OracleReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly OracleTransitionReceipt[];
}

interface OracleSearchSummary {
  readonly expansions: number;
  readonly enumeratedCandidates: number;
  readonly replayedCandidates: number;
  readonly rejectedCandidates: number;
  readonly termination: 'complete' | 'work-limit';
}

type OracleRouterOutcome =
  | {
      readonly status: 'success';
      readonly receipt: OracleReceipt;
      readonly search: OracleSearchSummary;
    }
  | {
      readonly status: 'no-route';
      readonly reason: 'no-candidate' | 'all-candidates-rejected';
      readonly search: OracleSearchSummary;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: OracleSearchSummary;
    };

interface OracleEnumerationTrace {
  readonly paths: readonly (readonly OracleHop[])[];
  readonly expansions: number;
  readonly termination: 'complete' | 'work-limit';
}

interface TraversalFrame {
  readonly path: readonly OracleHop[];
  readonly visitedAssets: ReadonlySet<string>;
  readonly visitedPools: ReadonlySet<string>;
  readonly edges: readonly OracleHop[];
  nextEdgeIndex: number;
}

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): ConstantProductPool {
  return Object.freeze({
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  });
}

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'oracle-snapshot',
  snapshotChecksum = 'oracle-checksum',
): LiquiditySnapshot {
  return Object.freeze({
    snapshotId,
    snapshotChecksum,
    pools: Object.freeze([...pools]),
  });
}

function request(
  value: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'oracle-snapshot',
    snapshotChecksum: 'oracle-checksum',
    assetIn: 'A',
    assetOut: 'D',
    amountIn: 5n,
    maxHops: 3,
    maxExpansions: 1_000,
    ...value,
  };
}

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHops(left: OracleHop, right: OracleHop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function comparePaths(
  left: readonly OracleHop[],
  right: readonly OracleHop[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    assert.ok(leftHop !== undefined && rightHop !== undefined);
    const comparison = compareHops(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function directionalEdges(pools: readonly ConstantProductPool[]): readonly OracleHop[] {
  const edges: OracleHop[] = [];
  for (const value of pools) {
    edges.push(
      { assetIn: value.asset0, poolId: value.poolId, assetOut: value.asset1 },
      { assetIn: value.asset1, poolId: value.poolId, assetOut: value.asset0 },
    );
  }
  return edges.sort(compareHops);
}

function isEligibleSequence(
  path: readonly OracleHop[],
  value: ExactInputSinglePathRouterRequest,
): boolean {
  if (path.length === 0 || path[0]?.assetIn !== value.assetIn) return false;

  const visitedAssets = new Set([value.assetIn]);
  const visitedPools = new Set<string>();
  let currentAsset = value.assetIn;

  for (const hop of path) {
    if (
      hop.assetIn !== currentAsset ||
      visitedPools.has(hop.poolId) ||
      visitedAssets.has(hop.assetOut)
    ) {
      return false;
    }
    visitedPools.add(hop.poolId);
    visitedAssets.add(hop.assetOut);
    currentAsset = hop.assetOut;
  }

  return currentAsset === value.assetOut;
}

// This intentionally generates the Cartesian product of all directional edges
// instead of walking adjacency buckets. It is slow, tiny, and structurally
// independent from the bounded proposal traversal used by the system under test.
function exhaustiveSimplePaths(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): readonly (readonly OracleHop[])[] {
  const edges = directionalEdges(value.pools);
  const paths: OracleHop[][] = [];

  function generate(prefix: readonly OracleHop[], targetLength: number): void {
    if (prefix.length === targetLength) {
      if (isEligibleSequence(prefix, routingRequest)) paths.push([...prefix]);
      return;
    }
    for (const edge of edges) generate([...prefix, edge], targetLength);
  }

  for (let length = 1; length <= routingRequest.maxHops; length += 1) {
    generate([], length);
  }

  return paths.sort(comparePaths);
}

// A separate small trace accounts for the accepted deterministic edge-charge
// checkpoints. Complete traces are cross-checked against the Cartesian-product
// path oracle before they are used for financial expectations.
function traceBoundedEnumeration(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): OracleEnumerationTrace {
  const adjacency = new Map<string, OracleHop[]>();
  for (const edge of directionalEdges(value.pools)) {
    const bucket = adjacency.get(edge.assetIn);
    if (bucket === undefined) adjacency.set(edge.assetIn, [edge]);
    else bucket.push(edge);
  }
  for (const edges of adjacency.values()) edges.sort(compareHops);

  const frames: TraversalFrame[] = [
    {
      path: [],
      visitedAssets: new Set([routingRequest.assetIn]),
      visitedPools: new Set(),
      edges: adjacency.get(routingRequest.assetIn) ?? [],
      nextEdgeIndex: 0,
    },
  ];
  const paths: OracleHop[][] = [];
  let expansions = 0;

  while (frames.length > 0) {
    const frame = frames.at(-1);
    assert.ok(frame !== undefined);

    if (frame.nextEdgeIndex >= frame.edges.length) {
      frames.pop();
      continue;
    }
    if (expansions >= routingRequest.maxExpansions) {
      return { paths, expansions, termination: 'work-limit' };
    }

    const edge = frame.edges[frame.nextEdgeIndex];
    assert.ok(edge !== undefined);
    frame.nextEdgeIndex += 1;
    expansions += 1;

    if (
      frame.visitedPools.has(edge.poolId) ||
      frame.visitedAssets.has(edge.assetOut)
    ) {
      continue;
    }

    const nextPath = [...frame.path, edge];
    if (edge.assetOut === routingRequest.assetOut) {
      paths.push(nextPath);
      continue;
    }
    if (nextPath.length >= routingRequest.maxHops) continue;

    frames.push({
      path: nextPath,
      visitedAssets: new Set([...frame.visitedAssets, edge.assetOut]),
      visitedPools: new Set([...frame.visitedPools, edge.poolId]),
      edges: adjacency.get(edge.assetOut) ?? [],
      nextEdgeIndex: 0,
    });
  }

  const exhaustive = exhaustiveSimplePaths(value, routingRequest);
  assert.deepEqual([...paths].sort(comparePaths), exhaustive);
  return { paths, expansions, termination: 'complete' };
}

// Decimal long division selects each quotient digit using only bigint
// multiplication, comparison, addition, and subtraction. Exact pool results
// are therefore independent of JavaScript's bigint division implementation
// and of every production financial helper.
function floorDivideWithoutDivision(numerator: bigint, denominator: bigint): bigint {
  assert.ok(numerator >= 0n && denominator > 0n);
  let quotient = 0n;
  let remainder = 0n;

  for (const numeratorDigit of numerator.toString(10)) {
    remainder = remainder * 10n + BigInt(numeratorDigit);
    let quotientDigit = 0n;
    while ((quotientDigit + 1n) * denominator <= remainder) {
      quotientDigit += 1n;
    }
    assert.ok(quotientDigit <= 9n);
    quotient = quotient * 10n + quotientDigit;
    remainder -= quotientDigit * denominator;
  }

  return quotient;
}

function replayWithIndependentMath(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
  path: readonly OracleHop[],
): OracleReceipt | undefined {
  const states = new Map(
    value.pools.map((entry) => [entry.poolId, { ...entry }] as const),
  );
  const receipts: OracleTransitionReceipt[] = [];
  let amountIn = routingRequest.amountIn;

  for (const hop of path) {
    const state = states.get(hop.poolId);
    if (state === undefined) return undefined;

    const forward = state.asset0 === hop.assetIn && state.asset1 === hop.assetOut;
    const reverse = state.asset1 === hop.assetIn && state.asset0 === hop.assetOut;
    if (!forward && !reverse) return undefined;

    const reserveIn = forward ? state.reserve0 : state.reserve1;
    const reserveOut = forward ? state.reserve1 : state.reserve0;
    const retainedMultiplier = state.feeDenominator - state.feeChargedNumerator;
    const numerator = amountIn * retainedMultiplier * reserveOut;
    const denominator =
      reserveIn * state.feeDenominator + amountIn * retainedMultiplier;
    const amountOut = floorDivideWithoutDivision(numerator, denominator);
    if (amountIn > 0n && amountOut === 0n) return undefined;

    const reserveInAfter = reserveIn + amountIn;
    const reserveOutAfter = reserveOut - amountOut;
    states.set(hop.poolId, {
      ...state,
      reserve0: forward ? reserveInAfter : reserveOutAfter,
      reserve1: forward ? reserveOutAfter : reserveInAfter,
    });
    receipts.push({
      ...hop,
      amountIn,
      amountOut,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter,
      reserveOutAfter,
    });
    amountIn = amountOut;
  }

  return {
    snapshotId: routingRequest.snapshotId,
    snapshotChecksum: routingRequest.snapshotChecksum,
    assetIn: routingRequest.assetIn,
    assetOut: routingRequest.assetOut,
    amountIn: routingRequest.amountIn,
    amountOut: amountIn,
    hops: receipts,
  };
}

function compareReceipts(left: OracleReceipt, right: OracleReceipt): number {
  if (left.amountOut > right.amountOut) return -1;
  if (left.amountOut < right.amountOut) return 1;
  if (left.hops.length !== right.hops.length) {
    return left.hops.length - right.hops.length;
  }
  return comparePaths(left.hops, right.hops);
}

function independentlyRoute(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): OracleRouterOutcome {
  const enumeration = traceBoundedEnumeration(value, routingRequest);
  let incumbent: OracleReceipt | undefined;
  let rejectedCandidates = 0;

  for (const path of enumeration.paths) {
    const receipt = replayWithIndependentMath(value, routingRequest, path);
    if (receipt === undefined) {
      rejectedCandidates += 1;
      continue;
    }
    if (incumbent === undefined || compareReceipts(receipt, incumbent) < 0) {
      incumbent = receipt;
    }
  }

  const search: OracleSearchSummary = {
    expansions: enumeration.expansions,
    enumeratedCandidates: enumeration.paths.length,
    replayedCandidates: enumeration.paths.length,
    rejectedCandidates,
    termination: enumeration.termination,
  };

  if (incumbent !== undefined) {
    return { status: 'success', receipt: incumbent, search };
  }
  if (enumeration.termination === 'work-limit') {
    return { status: 'no-plan', reason: 'work-limit', search };
  }
  return {
    status: 'no-route',
    reason: enumeration.paths.length === 0 ? 'no-candidate' : 'all-candidates-rejected',
    search,
  };
}

function assertMatchesIndependentOracle(
  value: LiquiditySnapshot,
  routingRequest: ExactInputSinglePathRouterRequest,
): ReturnType<typeof routeExactInputSinglePath> {
  const expected = independentlyRoute(value, routingRequest);
  const actual = routeExactInputSinglePath(value, routingRequest);

  assert.equal(actual.status, expected.status);
  if (expected.status === 'success') {
    assert.equal(actual.status, 'success');
    assert.deepEqual(actual.plan.receipt, expected.receipt);
    assert.deepEqual(actual.plan.search, expected.search);
  } else if (expected.status === 'no-route') {
    assert.equal(actual.status, 'no-route');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
  } else {
    assert.equal(actual.status, 'no-plan');
    assert.equal(actual.reason, expected.reason);
    assert.deepEqual(actual.search, expected.search);
  }

  return actual;
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const selected = values[index];
    assert.ok(selected !== undefined);
    const rest = values.filter((_, restIndex) => restIndex !== index);
    for (const suffix of permutations(rest)) result.push([selected, ...suffix]);
  }
  return result;
}

function snapshotFingerprint(value: LiquiditySnapshot): object {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    pools: value.pools.map((entry) => ({ ...entry })),
  };
}

void test('reproduces the independent M0 direct, two-hop, high-fee, and disconnected goldens', () => {
  const directSnapshot = snapshot([
    pool('direct-ab', 'A', 1_000n, 'B', 1_000n, 3n, 1_000n),
  ]);
  const direct = assertMatchesIndependentOracle(
    directSnapshot,
    request({ assetOut: 'B', amountIn: 100n, maxHops: 1 }),
  );
  assert.equal(direct.status, 'success');
  assert.equal(direct.plan.receipt.amountOut, 90n);
  assert.deepEqual(
    direct.plan.receipt.hops.map((hop) => [hop.poolId, hop.reserveInAfter, hop.reserveOutAfter]),
    [['direct-ab', 1_100n, 910n]],
  );

  const comparisonSnapshot = snapshot([
    pool('direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('hop-ab', 'A', 1_000n, 'B', 2_000n),
    pool('hop-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
  const comparison = assertMatchesIndependentOracle(
    comparisonSnapshot,
    request({ assetOut: 'C', amountIn: 100n, maxHops: 2 }),
  );
  assert.equal(comparison.status, 'success');
  assert.equal(comparison.plan.receipt.amountOut, 165n);
  assert.deepEqual(
    comparison.plan.receipt.hops.map((hop) => [hop.poolId, hop.amountOut]),
    [
      ['hop-ab', 181n],
      ['hop-bc', 165n],
    ],
  );

  const feeSnapshot = snapshot([
    pool('zero-fee-ab', 'A', 1_000n, 'B', 1_000n),
    pool('high-fee-ab', 'A', 1_000n, 'B', 1_000n, 90n, 100n),
  ]);
  const feeComparison = assertMatchesIndependentOracle(
    feeSnapshot,
    request({ assetOut: 'B', amountIn: 100n, maxHops: 1 }),
  );
  assert.equal(feeComparison.status, 'success');
  assert.equal(feeComparison.plan.receipt.amountOut, 90n);
  assert.equal(feeComparison.plan.receipt.hops[0]?.poolId, 'zero-fee-ab');
  assert.deepEqual(feeComparison.plan.search, {
    expansions: 2,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 0,
    termination: 'complete',
  });

  const disconnectedSnapshot = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const disconnected = assertMatchesIndependentOracle(
    disconnectedSnapshot,
    request({ amountIn: 100n, maxHops: 3, maxExpansions: 2 }),
  );
  assert.deepEqual(disconnected, {
    status: 'no-route',
    reason: 'no-candidate',
    search: {
      expansions: 2,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'complete',
    },
  });
});

void test('freshly replays candidates that share a prefix and preserves the caller snapshot', () => {
  const value = snapshot([
    pool('p', 'A', 100n, 'B', 100n),
    pool('a-bc', 'B', 100n, 'C', 100n),
    pool('z-bd', 'B', 100n, 'D', 200n),
    pool('z-dc', 'D', 100n, 'C', 100n),
  ]);
  const routingRequest = request({ assetOut: 'C', amountIn: 100n, maxHops: 3 });
  const beforeSnapshot = snapshotFingerprint(value);
  const beforeRequest = { ...routingRequest };

  const result = assertMatchesIndependentOracle(value, routingRequest);
  assert.equal(result.status, 'success');
  assert.equal(result.plan.receipt.amountOut, 39n);
  assert.deepEqual(
    result.plan.receipt.hops.map((hop) => hop.poolId),
    ['p', 'z-bd', 'z-dc'],
  );
  assert.deepEqual(result.plan.search, {
    expansions: 6,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 0,
    termination: 'complete',
  });
  assert.deepEqual(snapshotFingerprint(value), beforeSnapshot);
  assert.deepEqual(routingRequest, beforeRequest);
});

void test('applies the exact objective for hop count, raw UTF-16 keys, and huge outputs', () => {
  const fewerHopsSnapshot = snapshot([
    pool('a-ab', 'A', 100n, 'B', 200n),
    pool('a-bc', 'B', 100n, 'C', 100n),
    pool('z-direct', 'A', 100n, 'C', 100n),
  ]);
  const fewerHops = assertMatchesIndependentOracle(
    fewerHopsSnapshot,
    request({ assetOut: 'C', amountIn: 100n, maxHops: 2 }),
  );
  assert.equal(fewerHops.status, 'success');
  assert.equal(fewerHops.plan.receipt.amountOut, 50n);
  assert.deepEqual(fewerHops.plan.receipt.hops.map((hop) => hop.poolId), ['z-direct']);

  const utf16Snapshot = snapshot([
    pool('\u{1F600}', 'A', 100n, 'B', 100n),
    pool('\uE000', 'A', 100n, 'B', 100n),
  ]);
  for (const orderedPools of permutations(utf16Snapshot.pools)) {
    const tie = assertMatchesIndependentOracle(
      snapshot(orderedPools),
      request({ assetOut: 'B', amountIn: 100n, maxHops: 1 }),
    );
    assert.equal(tie.status, 'success');
    assert.equal(tie.plan.receipt.hops[0]?.poolId, '\u{1F600}');
  }

  const huge = 10n ** 80n;
  const hugeSnapshot = snapshot([
    pool('a-smaller-output', 'A', huge, 'B', 2n * huge),
    pool('z-larger-output', 'A', huge, 'B', 2n * huge + 2n),
  ]);
  const hugeResult = assertMatchesIndependentOracle(
    hugeSnapshot,
    request({ assetOut: 'B', amountIn: huge, maxHops: 1 }),
  );
  assert.equal(hugeResult.status, 'success');
  assert.equal(hugeResult.plan.receipt.amountOut, huge + 1n);
  assert.equal(hugeResult.plan.receipt.hops[0]?.poolId, 'z-larger-output');
});

void test('rejects zero-output candidates without losing or corrupting an incumbent', () => {
  const validThenInvalid = snapshot([
    pool('a-good', 'A', 1n, 'B', 2n),
    pool('z-zero', 'A', 100n, 'B', 1n),
  ]);
  const firstResult = assertMatchesIndependentOracle(
    validThenInvalid,
    request({ assetOut: 'B', amountIn: 1n, maxHops: 1 }),
  );
  assert.equal(firstResult.status, 'success');
  assert.equal(firstResult.plan.receipt.hops[0]?.poolId, 'a-good');
  assert.equal(firstResult.plan.receipt.amountOut, 1n);
  assert.deepEqual(firstResult.plan.search, {
    expansions: 2,
    enumeratedCandidates: 2,
    replayedCandidates: 2,
    rejectedCandidates: 1,
    termination: 'complete',
  });

  const invalidThenValid = snapshot([
    pool('a-zero', 'A', 100n, 'B', 1n),
    pool('z-good', 'A', 1n, 'B', 2n),
  ]);
  const secondResult = assertMatchesIndependentOracle(
    invalidThenValid,
    request({ assetOut: 'B', amountIn: 1n, maxHops: 1 }),
  );
  assert.equal(secondResult.status, 'success');
  assert.equal(secondResult.plan.receipt.hops[0]?.poolId, 'z-good');
  assert.deepEqual(secondResult.plan.search, firstResult.plan.search);

  const allInvalid = snapshot([
    pool('a-zero', 'A', 100n, 'B', 1n),
    pool('b-zero', 'A', 200n, 'B', 1n),
  ]);
  const rejected = assertMatchesIndependentOracle(
    allInvalid,
    request({ assetOut: 'B', amountIn: 1n, maxHops: 1, maxExpansions: 2 }),
  );
  assert.deepEqual(rejected, {
    status: 'no-route',
    reason: 'all-candidates-rejected',
    search: {
      expansions: 2,
      enumeratedCandidates: 2,
      replayedCandidates: 2,
      rejectedCandidates: 2,
      termination: 'complete',
    },
  });
});

void test('reports truthful hand-traced work-limit outcomes and exact final-frontier completion', () => {
  const pendingAtZero = snapshot([
    pool('a-direct', 'A', 10n, 'D', 20n),
    pool('z-ab', 'A', 10n, 'B', 20n),
    pool('z-bd', 'B', 10n, 'D', 20n),
  ]);
  const zeroBudget = assertMatchesIndependentOracle(
    pendingAtZero,
    request({ amountIn: 10n, maxHops: 2, maxExpansions: 0 }),
  );
  assert.deepEqual(zeroBudget, {
    status: 'no-plan',
    reason: 'work-limit',
    search: {
      expansions: 0,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'work-limit',
    },
  });

  const validPrefix = assertMatchesIndependentOracle(
    pendingAtZero,
    request({ amountIn: 10n, maxHops: 2, maxExpansions: 1 }),
  );
  assert.equal(validPrefix.status, 'success');
  assert.equal(validPrefix.plan.receipt.hops[0]?.poolId, 'a-direct');
  assert.deepEqual(validPrefix.plan.search, {
    expansions: 1,
    enumeratedCandidates: 1,
    replayedCandidates: 1,
    rejectedCandidates: 0,
    termination: 'work-limit',
  });

  const intermediateFirst = snapshot([
    pool('a-ab', 'A', 10n, 'B', 20n),
    pool('b-bd', 'B', 10n, 'D', 20n),
    pool('z-direct', 'A', 10n, 'D', 20n),
  ]);
  const noCompleteCandidate = assertMatchesIndependentOracle(
    intermediateFirst,
    request({ amountIn: 10n, maxHops: 2, maxExpansions: 1 }),
  );
  assert.deepEqual(noCompleteCandidate, {
    status: 'no-plan',
    reason: 'work-limit',
    search: {
      expansions: 1,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'work-limit',
    },
  });

  const invalidPrefixSnapshot = snapshot([
    pool('a-zero', 'A', 100n, 'B', 1n),
    pool('z-good', 'A', 1n, 'B', 2n),
  ]);
  const invalidPrefix = assertMatchesIndependentOracle(
    invalidPrefixSnapshot,
    request({ assetOut: 'B', amountIn: 1n, maxHops: 1, maxExpansions: 1 }),
  );
  assert.deepEqual(invalidPrefix, {
    status: 'no-plan',
    reason: 'work-limit',
    search: {
      expansions: 1,
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 1,
      termination: 'work-limit',
    },
  });

  const exactFinalFrontier = assertMatchesIndependentOracle(
    invalidPrefixSnapshot,
    request({ assetOut: 'B', amountIn: 1n, maxHops: 1, maxExpansions: 2 }),
  );
  assert.equal(exactFinalFrontier.status, 'success');
  assert.equal(exactFinalFrontier.plan.receipt.hops[0]?.poolId, 'z-good');
  assert.equal(exactFinalFrontier.plan.search.termination, 'complete');
});

void test('agrees with a tiny exhaustive oracle across cycles, parallel pools, limits, and all permutations', () => {
  const graphPools = [
    pool('ab-0', 'A', 7n, 'B', 11n),
    pool('ab-1', 'A', 5n, 'B', 13n, 1n, 4n),
    pool('ac', 'A', 9n, 'C', 10n),
    pool('bc', 'B', 8n, 'C', 12n, 1n, 5n),
    pool('bd', 'B', 10n, 'D', 9n),
    pool('cd', 'C', 11n, 'D', 14n, 1n, 6n),
  ] as const;
  const base = snapshot(graphPools);

  for (const amountIn of [1n, 2n, 3n, 5n, 8n]) {
    for (const maxHops of [1, 2, 3]) {
      assertMatchesIndependentOracle(
        base,
        request({ amountIn, maxHops, maxExpansions: 1_000 }),
      );
    }
  }

  const permutationRequest = request({ amountIn: 5n, maxHops: 3, maxExpansions: 1_000 });
  const expected = assertMatchesIndependentOracle(base, permutationRequest);
  assert.equal(permutations(graphPools).length, 720);
  for (const orderedPools of permutations(graphPools)) {
    const actual = assertMatchesIndependentOracle(snapshot(orderedPools), permutationRequest);
    assert.deepEqual(actual, expected);
  }
});

void test('validates atomically in the frozen precedence with exact codes and fields', () => {
  const value = snapshot([pool('ab', 'A', 10n, 'B', 10n)]);
  const cases: readonly {
    readonly name: string;
    readonly value: ExactInputSinglePathRouterRequest;
    readonly code:
      | 'snapshot-identity-mismatch'
      | 'empty-identifier'
      | 'nonpositive-input'
      | 'same-asset-request'
      | 'invalid-max-hops'
      | 'invalid-max-expansions'
      | 'unknown-asset';
    readonly field:
      | 'snapshotIdentity'
      | 'assetIn'
      | 'assetOut'
      | 'amountIn'
      | 'maxHops'
      | 'maxExpansions';
  }[] = [
    {
      name: 'identity precedes every request error',
      value: request({
        snapshotChecksum: 'wrong',
        assetIn: '',
        assetOut: '',
        amountIn: 0n,
        maxHops: 0,
        maxExpansions: -1,
      }),
      code: 'snapshot-identity-mismatch',
      field: 'snapshotIdentity',
    },
    {
      name: 'input identifier precedes output and numeric errors',
      value: request({ assetIn: '', assetOut: '', amountIn: 0n, maxHops: 0 }),
      code: 'empty-identifier',
      field: 'assetIn',
    },
    {
      name: 'output identifier precedes numeric errors',
      value: request({ assetIn: 'A', assetOut: '', amountIn: 0n, maxHops: 0 }),
      code: 'empty-identifier',
      field: 'assetOut',
    },
    {
      name: 'input amount precedes same asset and limits',
      value: request({ assetIn: 'A', assetOut: 'A', amountIn: 0n, maxHops: 0 }),
      code: 'nonpositive-input',
      field: 'amountIn',
    },
    {
      name: 'same asset precedes limits',
      value: request({ assetIn: 'A', assetOut: 'A', amountIn: 1n, maxHops: 0 }),
      code: 'same-asset-request',
      field: 'assetOut',
    },
    {
      name: 'hop limit precedes expansion limit',
      value: request({ assetOut: 'B', maxHops: 0, maxExpansions: -1 }),
      code: 'invalid-max-hops',
      field: 'maxHops',
    },
    {
      name: 'expansion limit precedes known assets',
      value: request({ assetIn: 'X', assetOut: 'Y', maxHops: 1, maxExpansions: -1 }),
      code: 'invalid-max-expansions',
      field: 'maxExpansions',
    },
    {
      name: 'unknown input precedes unknown output',
      value: request({ assetIn: 'X', assetOut: 'Y', maxHops: 1, maxExpansions: 0 }),
      code: 'unknown-asset',
      field: 'assetIn',
    },
    {
      name: 'unknown output follows known input',
      value: request({ assetIn: 'A', assetOut: 'Y', maxHops: 1, maxExpansions: 0 }),
      code: 'unknown-asset',
      field: 'assetOut',
    },
  ];

  for (const entry of cases) {
    const beforeSnapshot = snapshotFingerprint(value);
    const beforeRequest = { ...entry.value };
    const result = routeExactInputSinglePath(value, entry.value);
    assert.equal(result.status, 'invalid-request', entry.name);
    assert.equal(result.error.code, entry.code, entry.name);
    assert.equal(result.error.field, entry.field, entry.name);
    assert.match(result.error.message, /.+/u, entry.name);
    assert.ok(Object.isFrozen(result), entry.name);
    assert.ok(Object.isFrozen(result.error), entry.name);
    assert.ok(!('search' in result), entry.name);
    assert.deepEqual(snapshotFingerprint(value), beforeSnapshot, entry.name);
    assert.deepEqual(entry.value, beforeRequest, entry.name);
  }

  for (const invalidMaxHops of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = routeExactInputSinglePath(
      value,
      request({ assetOut: 'B', maxHops: invalidMaxHops }),
    );
    assert.equal(result.status, 'invalid-request');
    assert.equal(result.error.code, 'invalid-max-hops');
    assert.equal(result.error.field, 'maxHops');
  }
  for (const invalidMaxExpansions of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = routeExactInputSinglePath(
      value,
      request({ assetOut: 'B', maxExpansions: invalidMaxExpansions }),
    );
    assert.equal(result.status, 'invalid-request');
    assert.equal(result.error.code, 'invalid-max-expansions');
    assert.equal(result.error.field, 'maxExpansions');
  }

  const negativeInput = routeExactInputSinglePath(
    value,
    request({ assetOut: 'B', amountIn: -1n }),
  );
  assert.equal(negativeInput.status, 'invalid-request');
  assert.equal(negativeInput.error.code, 'nonpositive-input');

  const empty = snapshot([]);
  const emptyResult = routeExactInputSinglePath(
    empty,
    request({ assetOut: 'B', maxHops: 1, maxExpansions: 0 }),
  );
  assert.equal(emptyResult.status, 'invalid-request');
  assert.equal(emptyResult.error.code, 'unknown-asset');
  assert.equal(emptyResult.error.field, 'assetIn');
});

void test('deep-freezes every outcome and remains deterministic without mutating caller state', () => {
  const successSnapshot = snapshot([
    pool('a-good', 'A', 10n, 'B', 20n),
    pool('z-zero', 'A', 100n, 'B', 1n),
  ]);
  const successRequest = request({ assetOut: 'B', amountIn: 10n, maxHops: 1 });
  const beforeSnapshot = snapshotFingerprint(successSnapshot);
  const beforeRequest = { ...successRequest };
  const first = routeExactInputSinglePath(successSnapshot, successRequest);
  assert.equal(first.status, 'success');
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.plan));
  assert.ok(Object.isFrozen(first.plan.search));
  assert.ok(Object.isFrozen(first.plan.receipt));
  assert.ok(Object.isFrozen(first.plan.receipt.hops));
  for (const hop of first.plan.receipt.hops) assert.ok(Object.isFrozen(hop));

  const mutablePlan = first.plan as unknown as { search: object };
  assert.throws(() => {
    mutablePlan.search = {};
  }, TypeError);

  for (let run = 0; run < 20; run += 1) {
    assert.deepEqual(routeExactInputSinglePath(successSnapshot, successRequest), first);
  }
  assert.deepEqual(snapshotFingerprint(successSnapshot), beforeSnapshot);
  assert.deepEqual(successRequest, beforeRequest);

  const noRoute = routeExactInputSinglePath(
    snapshot([
      pool('ab', 'A', 10n, 'B', 10n),
      pool('cd', 'C', 10n, 'D', 10n),
    ]),
    request({ maxExpansions: 100 }),
  );
  assert.equal(noRoute.status, 'no-route');
  assert.ok(Object.isFrozen(noRoute));
  assert.ok(Object.isFrozen(noRoute.search));

  const noPlan = routeExactInputSinglePath(
    snapshot([pool('ad', 'A', 10n, 'D', 10n)]),
    request({ maxExpansions: 0 }),
  );
  assert.equal(noPlan.status, 'no-plan');
  assert.ok(Object.isFrozen(noPlan));
  assert.ok(Object.isFrozen(noPlan.search));
});
