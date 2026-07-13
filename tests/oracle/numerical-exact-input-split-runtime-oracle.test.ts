import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../../src/domain/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  routeExactInputSplitNumericalAnytimeWithAuthorizationReplay,
  routeExactInputSplitNumericalAnytimeWithProposalDriver,
  type NumericalExactInputSplitAuthorizationReplay,
  type NumericalExactInputSplitDiagnostic,
  type NumericalExactInputSplitProposalDriver,
  type NumericalExactInputSplitRuntimeControl,
  type NumericalExactInputSplitRuntimeRequest,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitRuntimeSearchSummary,
  type NumericalExactInputSplitRuntimeWorkKind,
  type NumericalExactInputSplitWorkCaps,
  type NumericalExactInputSplitWorkCounters,
} from '../../src/router/numerical-exact-input-split/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../../src/runtime/prepared-routing-context/index.ts';

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

interface OracleRouteReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly OracleTransitionReceipt[];
}

interface OracleSplitLegReceipt {
  readonly allocation: bigint;
  readonly receipt: OracleRouteReceipt;
}

interface OracleSplitReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly legs: readonly OracleSplitLegReceipt[];
}

interface OracleSplitRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly legs: readonly {
    readonly allocation: bigint;
    readonly route: readonly OracleHop[];
  }[];
}

interface NumericalExpectation {
  readonly status: NumericalExactInputSplitDiagnostic['status'];
  readonly failureCode: NumericalExactInputSplitDiagnostic['failureCode'];
  readonly converged: boolean;
  readonly completedOuterIterations: number;
  readonly residualUnits: bigint | null;
  readonly tuple: readonly [number, number, number, number, number, number, number];
}

const NUMERICAL = Object.freeze({
  outerIterations: 64,
  innerIterations: 64,
  convergenceTolerance: 2 ** -40,
});

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

const RT03_BASELINE_COUNTERS = Object.freeze({
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

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareHop(left: OracleHop, right: OracleHop): number {
  return (
    compareRawUtf16(left.assetIn, right.assetIn) ||
    compareRawUtf16(left.poolId, right.poolId) ||
    compareRawUtf16(left.assetOut, right.assetOut)
  );
}

function compareRoute(left: readonly OracleHop[], right: readonly OracleHop[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const comparison = compareHop(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function routeFromLeg(leg: OracleSplitLegReceipt): readonly OracleHop[] {
  return leg.receipt.hops.map(({ assetIn, poolId, assetOut }) => ({
    assetIn,
    poolId,
    assetOut,
  }));
}

function compareReceipt(left: OracleSplitReceipt, right: OracleSplitReceipt): number {
  if (left.amountOut !== right.amountOut) return left.amountOut > right.amountOut ? -1 : 1;
  if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length;
  const leftHops = left.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0);
  const rightHops = right.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0);
  if (leftHops !== rightHops) return leftHops - rightHops;
  for (let index = 0; index < left.legs.length; index += 1) {
    const comparison = compareRoute(routeFromLeg(left.legs[index]!), routeFromLeg(right.legs[index]!));
    if (comparison !== 0) return comparison;
  }
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftAllocation = left.legs[index]!.allocation;
    const rightAllocation = right.legs[index]!.allocation;
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? -1 : 1;
  }
  return 0;
}

function pool(
  poolId: string,
  reserve0: bigint,
  reserve1: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
  asset0 = 'A',
  asset1 = 'C',
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  };
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

function oracleChecksum(value: LiquiditySnapshot): string {
  const digest = createHash('sha256')
    .update(canonicalSnapshotContent(value), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId: string,
): LiquiditySnapshot {
  const pending: LiquiditySnapshot = { snapshotId, snapshotChecksum: 'pending', pools };
  return { ...pending, snapshotChecksum: oracleChecksum(pending) };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  if (!result.ok) assert.fail(`independent checksum rejected: ${result.error.code}`);
  return result.value;
}

function runtimeRequest(
  value: LiquiditySnapshot,
  amountIn: bigint,
  overrides: Partial<NumericalExactInputSplitRuntimeRequest> = {},
): NumericalExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
    numerical: NUMERICAL,
    ...overrides,
  };
}

function runtimeControl(
  capOverrides: Partial<NumericalExactInputSplitWorkCaps> = {},
  extra: Omit<Partial<NumericalExactInputSplitRuntimeControl>, 'workCaps'> = {},
): NumericalExactInputSplitRuntimeControl {
  return { workCaps: { ...COMPLETE_CAPS, ...capOverrides }, ...extra };
}

function directedEdges(pools: readonly ConstantProductPool[]): readonly OracleHop[] {
  return pools.flatMap((candidate) => [
    { assetIn: candidate.asset0, poolId: candidate.poolId, assetOut: candidate.asset1 },
    { assetIn: candidate.asset1, poolId: candidate.poolId, assetOut: candidate.asset0 },
  ]);
}

function isSimpleRoute(
  route: readonly OracleHop[],
  assetIn: string,
  assetOut: string,
): boolean {
  if (route[0]?.assetIn !== assetIn) return false;
  const assets = new Set([assetIn]);
  const pools = new Set<string>();
  let current = assetIn;
  for (const hop of route) {
    if (hop.assetIn !== current || assets.has(hop.assetOut) || pools.has(hop.poolId)) {
      return false;
    }
    assets.add(hop.assetOut);
    pools.add(hop.poolId);
    current = hop.assetOut;
  }
  return current === assetOut;
}

// Deliberately slow Cartesian enumeration, independent of the production frontier.
function discoverRoutes(
  pools: readonly ConstantProductPool[],
  assetIn: string,
  assetOut: string,
  maxHops: number,
): readonly (readonly OracleHop[])[] {
  const edges = directedEdges(pools);
  const routes: OracleHop[][] = [];
  function extend(prefix: readonly OracleHop[]): void {
    if (prefix.length > 0 && isSimpleRoute(prefix, assetIn, assetOut)) {
      routes.push(prefix.map((hop) => ({ ...hop })));
    }
    if (prefix.length === maxHops) return;
    for (const edge of edges) extend([...prefix, edge]);
  }
  extend([]);
  return routes.sort(compareRoute);
}

function combinations<T>(values: readonly T[], cardinality: number): readonly (readonly T[])[] {
  const output: T[][] = [];
  function choose(start: number, selected: readonly T[]): void {
    if (selected.length === cardinality) {
      output.push([...selected]);
      return;
    }
    for (let index = start; index < values.length; index += 1) {
      choose(index + 1, [...selected, values[index]!]);
    }
  }
  choose(0, []);
  return output;
}

function candidateSets(
  routes: readonly (readonly OracleHop[])[],
  maxRoutes: number,
): readonly (readonly (readonly OracleHop[])[])[] {
  const output: Array<readonly (readonly OracleHop[])[]> = [];
  for (let cardinality = 2; cardinality <= Math.min(maxRoutes, routes.length); cardinality += 1) {
    for (const selected of combinations(routes, cardinality)) {
      const ids = selected.flatMap((route) => route.map((hop) => hop.poolId));
      if (new Set(ids).size === ids.length) output.push(selected);
    }
  }
  return output;
}

function direction(poolValue: ConstantProductPool, assetIn: string) {
  if (poolValue.asset0 === assetIn) {
    return {
      assetOut: poolValue.asset1,
      reserveIn: poolValue.reserve0,
      reserveOut: poolValue.reserve1,
      reverse: false,
    };
  }
  if (poolValue.asset1 === assetIn) {
    return {
      assetOut: poolValue.asset0,
      reserveIn: poolValue.reserve1,
      reserveOut: poolValue.reserve0,
      reverse: true,
    };
  }
  return undefined;
}

function replayRoute(
  value: LiquiditySnapshot,
  route: readonly OracleHop[],
  amountIn: bigint,
): OracleRouteReceipt | undefined {
  const state = new Map(value.pools.map((candidate) => [candidate.poolId, { ...candidate }]));
  const receipts: OracleTransitionReceipt[] = [];
  let amount = amountIn;
  for (const hop of route) {
    const current = state.get(hop.poolId);
    const resolved = current === undefined ? undefined : direction(current, hop.assetIn);
    if (current === undefined || resolved === undefined || resolved.assetOut !== hop.assetOut) return undefined;
    const multiplier = current.feeDenominator - current.feeChargedNumerator;
    const amountOut =
      (amount * multiplier * resolved.reserveOut) /
      (resolved.reserveIn * current.feeDenominator + amount * multiplier);
    if (amount > 0n && amountOut === 0n) return undefined;
    const reserveInAfter = resolved.reserveIn + amount;
    const reserveOutAfter = resolved.reserveOut - amountOut;
    receipts.push({
      poolId: hop.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn: amount,
      amountOut,
      reserveInBefore: resolved.reserveIn,
      reserveOutBefore: resolved.reserveOut,
      reserveInAfter,
      reserveOutAfter,
    });
    state.set(
      hop.poolId,
      resolved.reverse
        ? { ...current, reserve0: reserveOutAfter, reserve1: reserveInAfter }
        : { ...current, reserve0: reserveInAfter, reserve1: reserveOutAfter },
    );
    amount = amountOut;
  }
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: route[0]?.assetIn ?? '',
    assetOut: route.at(-1)?.assetOut ?? '',
    amountIn,
    amountOut: amount,
    hops: receipts,
  };
}

function replaySplit(
  value: LiquiditySnapshot,
  routes: readonly (readonly OracleHop[])[],
  allocations: readonly bigint[],
): OracleSplitReceipt | undefined {
  const legs: OracleSplitLegReceipt[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const allocation = allocations[index]!;
    if (allocation === 0n) continue;
    const receipt = replayRoute(value, routes[index]!, allocation);
    if (receipt === undefined) return undefined;
    legs.push({ allocation, receipt });
  }
  if (legs.length === 0) return undefined;
  legs.sort((left, right) => compareRoute(routeFromLeg(left), routeFromLeg(right)));
  const amountIn = allocations.reduce((sum, allocation) => sum + allocation, 0n);
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn,
    amountOut: legs.reduce((sum, leg) => sum + leg.receipt.amountOut, 0n),
    legs,
  };
}

function replayRequest(
  value: LiquiditySnapshot,
  request: OracleSplitRequest,
): OracleSplitReceipt | undefined {
  return replaySplit(
    value,
    request.legs.map((leg) => leg.route),
    request.legs.map((leg) => leg.allocation),
  );
}

function equalAllocation(amountIn: bigint, cardinality: number): readonly bigint[] {
  const divisor = BigInt(cardinality);
  const base = amountIn / divisor;
  const residual = amountIn % divisor;
  return Array.from(
    { length: cardinality },
    (_, index) => base + (BigInt(index) < residual ? 1n : 0n),
  );
}

function chunks(amountIn: bigint, parts: number): readonly bigint[] {
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const residual = amountIn % divisor;
  if (base === 0n) {
    const unitChunks: bigint[] = [];
    for (let remaining = residual; remaining > 0n; remaining -= 1n) unitChunks.push(1n);
    return unitChunks;
  }
  return Array.from(
    { length: parts },
    (_, index) => base + (BigInt(index) < residual ? 1n : 0n),
  );
}

function greedyReceipt(
  value: LiquiditySnapshot,
  routes: readonly (readonly OracleHop[])[],
  amountIn: bigint,
  parts: number,
): OracleSplitReceipt | undefined {
  const allocations = routes.map(() => 0n);
  let last: OracleSplitReceipt | undefined;
  for (const chunk of chunks(amountIn, parts)) {
    let winner: { readonly index: number; readonly receipt: OracleSplitReceipt } | undefined;
    for (let index = 0; index < routes.length; index += 1) {
      const option = [...allocations];
      option[index] = option[index]! + chunk;
      const receipt = replaySplit(value, routes, option);
      if (receipt !== undefined && (winner === undefined || compareReceipt(receipt, winner.receipt) < 0)) {
        winner = { index, receipt };
      }
    }
    if (winner === undefined) return undefined;
    allocations[winner.index] = allocations[winner.index]! + chunk;
    last = winner.receipt;
  }
  return last;
}

function baselineReceipt(
  value: LiquiditySnapshot,
  request: NumericalExactInputSplitRuntimeRequest,
): OracleSplitReceipt | undefined {
  const routes = discoverRoutes(value.pools, request.assetIn, request.assetOut, request.maxHops);
  const proposals: OracleSplitReceipt[] = [];
  for (const route of routes) {
    const receipt = replaySplit(value, [route], [request.amountIn]);
    if (receipt !== undefined) proposals.push(receipt);
  }
  for (const selected of candidateSets(routes, request.maxRoutes)) {
    const equal = replaySplit(value, selected, equalAllocation(request.amountIn, selected.length));
    if (equal !== undefined) proposals.push(equal);
    const greedy = greedyReceipt(value, selected, request.amountIn, request.greedyParts);
    if (greedy !== undefined) proposals.push(greedy);
  }
  return proposals.sort(compareReceipt)[0];
}

function enumerateAllocations(total: bigint, cardinality: number): readonly (readonly bigint[])[] {
  const output: bigint[][] = [];
  function assign(index: number, remaining: bigint, prefix: readonly bigint[]): void {
    if (index === cardinality - 1) {
      output.push([...prefix, remaining]);
      return;
    }
    for (let allocation = 0n; allocation <= remaining; allocation += 1n) {
      assign(index + 1, remaining - allocation, [...prefix, allocation]);
    }
  }
  assign(0, total, []);
  return output;
}

function exhaustiveReceipt(
  value: LiquiditySnapshot,
  routes: readonly (readonly OracleHop[])[],
  amountIn: bigint,
): OracleSplitReceipt | undefined {
  return enumerateAllocations(amountIn, routes.length)
    .map((allocations) => replaySplit(value, routes, allocations))
    .filter((receipt): receipt is OracleSplitReceipt => receipt !== undefined)
    .sort(compareReceipt)[0];
}

function assignResidual(
  value: LiquiditySnapshot,
  routes: readonly (readonly OracleHop[])[],
  bases: readonly bigint[],
  residualUnits: bigint,
): {
  readonly allocations: readonly bigint[];
  readonly receipt: OracleSplitReceipt | undefined;
  readonly replays: number;
  readonly rejections: number;
} {
  const allocations = [...bases];
  let replays = 0;
  let rejections = 0;
  let score: OracleSplitReceipt | undefined;
  if (residualUnits === 0n) {
    replays += 1;
    score = replaySplit(value, routes, allocations);
    if (score === undefined) rejections += 1;
    return { allocations, receipt: score, replays, rejections };
  }
  for (let unit = 0n; unit < residualUnits; unit += 1n) {
    let winner: { readonly index: number; readonly receipt: OracleSplitReceipt } | undefined;
    for (let index = 0; index < routes.length; index += 1) {
      const option = [...allocations];
      option[index] = option[index]! + 1n;
      replays += 1;
      const receipt = replaySplit(value, routes, option);
      if (receipt === undefined) {
        rejections += 1;
      } else if (winner === undefined || compareReceipt(receipt, winner.receipt) < 0) {
        winner = { index, receipt };
      }
    }
    if (winner === undefined) return { allocations, receipt: undefined, replays, rejections };
    allocations[winner.index] = allocations[winner.index]! + 1n;
    score = winner.receipt;
  }
  return { allocations, receipt: score, replays, rejections };
}

function routeKey(route: readonly OracleHop[]): string {
  return JSON.stringify(route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]));
}

function candidateSetKey(routes: readonly (readonly OracleHop[])[]): string {
  return JSON.stringify(
    routes.map((route) => route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])),
  );
}

function routesFor(value: LiquiditySnapshot, maxHops = 1): readonly (readonly OracleHop[])[] {
  return discoverRoutes(value.pools, 'A', 'C', maxHops).slice(0, 2);
}

function searchSummary(
  result: NumericalExactInputSplitRuntimeResult,
): NumericalExactInputSplitRuntimeSearchSummary {
  if (result.status === 'success') return result.plan.search;
  if ('search' in result) return result.search;
  assert.fail(`${result.status} has no search summary`);
}

function successReceipt(result: NumericalExactInputSplitRuntimeResult) {
  if (result.status !== 'success') assert.fail(`expected success, received ${result.status}`);
  return result.plan.receipt;
}

function assertBaseline(
  result: NumericalExactInputSplitRuntimeResult,
  expected: OracleSplitReceipt,
): void {
  assert.deepEqual(successReceipt(result), expected);
}

function tupleFromCounters(
  counters: Pick<
    NumericalExactInputSplitWorkCounters,
    | 'numericalProposals'
    | 'numericalProposalFailures'
    | 'numericalIterations'
    | 'numericalResidualReplays'
    | 'numericalResidualReplayRejections'
    | 'numericalAuthorizationReplays'
    | 'numericalAuthorizationReplayRejections'
  >,
): readonly [number, number, number, number, number, number, number] {
  return [
    counters.numericalProposals,
    counters.numericalProposalFailures,
    counters.numericalIterations,
    counters.numericalResidualReplays,
    counters.numericalResidualReplayRejections,
    counters.numericalAuthorizationReplays,
    counters.numericalAuthorizationReplayRejections,
  ];
}

function assertDiagnostic(
  result: NumericalExactInputSplitRuntimeResult,
  routes: readonly (readonly OracleHop[])[],
  expected: NumericalExpectation,
): NumericalExactInputSplitDiagnostic {
  const summary = searchSummary(result);
  assert.equal(summary.numericalDiagnostics.length, 1);
  const diagnostic = summary.numericalDiagnostics[0]!;
  assert.deepEqual(diagnostic, {
    candidateSetKey: candidateSetKey(routes),
    routeKeys: routes.map(routeKey),
    status: expected.status,
    failureCode: expected.failureCode,
    converged: expected.converged,
    completedOuterIterations: expected.completedOuterIterations,
    configuredInnerIterations: 64,
    residualUnits: expected.residualUnits,
    counters: {
      numericalProposals: expected.tuple[0],
      numericalProposalFailures: expected.tuple[1],
      numericalIterations: expected.tuple[2],
      numericalResidualReplays: expected.tuple[3],
      numericalResidualReplayRejections: expected.tuple[4],
      numericalAuthorizationReplays: expected.tuple[5],
      numericalAuthorizationReplayRejections: expected.tuple[6],
    },
  });
  assert.deepEqual(tupleFromCounters(summary.counters), expected.tuple);
  return diagnostic;
}

function allocationVector(
  receipt: OracleSplitReceipt | ReturnType<typeof successReceipt>,
  routes: readonly (readonly OracleHop[])[],
): readonly bigint[] {
  const allocations = new Map(
    receipt.legs.map((leg) => [
      routeKey(leg.receipt.hops.map(({ assetIn, poolId, assetOut }) => ({ assetIn, poolId, assetOut }))),
      leg.allocation,
    ]),
  );
  return routes.map((route) => allocations.get(routeKey(route)) ?? 0n);
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function oneHopFixture(
  id: string,
  a: readonly [bigint, bigint],
  b: readonly [bigint, bigint],
  aFee: readonly [bigint, bigint] = [0n, 1n],
  bFee: readonly [bigint, bigint] = [0n, 1n],
): LiquiditySnapshot {
  return snapshot(
    [
      pool('a-ac', a[0], a[1], aFee[0], aFee[1]),
      pool('b-ac', b[0], b[1], bFee[0], bFee[1]),
    ],
    id,
  );
}

const RT00 = oneHopFixture('RT00', [2n, 2n], [2n, 2n]);
const RT01 = oneHopFixture('RT01', [1n, 2n], [1n, 2n]);
const RT02 = oneHopFixture('RT02', [4n, 9n], [1n, 9n]);
const RT03 = oneHopFixture('RT03', [1n, 3n], [3n, 4n]);
const RT04 = oneHopFixture('RT04', [1n, 2n], [2n, 2n]);
const RT05 = oneHopFixture('RT05', [1n, 2n], [2n, 2n], [0n, 1n], [1n, 10n]);
const RT06 = oneHopFixture('RT06', [2n, 2n], [2n, 2n]);
const RT07 = oneHopFixture('RT07', [4n, 9n], [4n, 9n]);
const RT08 = snapshot(
  [
    pool('a-ax', 10n, 20n, 1n, 10n, 'A', 'X'),
    pool('x-c', 15n, 12n, 1n, 20n, 'X', 'C'),
    pool('b-ac', 8n, 10n),
  ],
  'RT08',
);
const U = 10n ** 80n;
const RT09 = oneHopFixture('RT09', [U, U], [U, 2n * U]);

function partialFixture(
  id: string,
  a: readonly [bigint, bigint],
  b: readonly [bigint, bigint],
): LiquiditySnapshot {
  return snapshot(
    [pool('a-ac', a[0], a[1]), pool('b-ac', b[0], b[1]), pool('c-ac', 1n, 2n)],
    id,
  );
}

const RT10 = partialFixture('RT10', [2n ** 1100n, 1n], [1n, 1n]);
const RT11 = partialFixture('RT11', [1n, 1n], [1n, 1n]);
const RT12 = partialFixture('RT12', [2n ** 1022n, 1n], [2n ** 1021n, 1n]);
const K = 2n ** 60n;
const RT13 = partialFixture('RT13', [10n * K, 3n * K], [K, 8n * K]);

void test('independent RT00-RT13 snapshot identities match the frozen checksums', () => {
  const expected = [
    'sha256:eb0be1e3d216f1c05df6ebc9541548b22c310d69660d24b205bc0eb2e58b47e6',
    'sha256:98679b3cdcc21c8ba0aec829282e89de1f2788fdeb48701ef51242bec435412d',
    'sha256:13dc93f1a4808b31ea4edd0fc8a7903bf31266e36299737b79de457abe3a6596',
    'sha256:f92350833e171a9b7840fc1be24a5edcbcceaa1767d058c6abfa1226aaef4e9f',
    'sha256:3c9749f12446274f627f3bb477466731104befac040428a69ce647df1b33e44a',
    'sha256:1d42f1b791a5b17a32910897ff4b233c4de0a703e22979a9cf05e724c869b7ef',
    'sha256:eb0be1e3d216f1c05df6ebc9541548b22c310d69660d24b205bc0eb2e58b47e6',
    'sha256:a31a71828968641eb22113460e09f2efe4deb5efeb53e857d49ed3982007489f',
    'sha256:daeacf46d5127abfa1dc9fd59d7465de10fd05adf109ab103eb579fd3007c8a7',
    'sha256:5cfe786d132bd7da374278a090d1147d415d5c8ad4a3455898176bfd4f56616e',
    'sha256:0ffddaa585bdfb8461fae0e2d92173b838ee82eb9587ca921ac6c63375dc89b9',
    'sha256:9284267cbe5d0c2c1012ea821e24cf3ab4bc3336c2a4dec5a8fcdcaf18030a9f',
    'sha256:a8f62f9ad58822c9453d8c8995bd565e5d1a1a046eb643f9a3cb4584b9cd148c',
    'sha256:92999fd3005eba3be7c53e85dc081740458bae62a7b93c547d2f58f074ec9dbf',
  ];
  assert.deepEqual(
    [RT00, RT01, RT02, RT03, RT04, RT05, RT06, RT07, RT08, RT09, RT10, RT11, RT12, RT13]
      .map((value) => value.snapshotChecksum),
    expected,
  );
});

void test('independent replay, residual choice, and exhaustive objectives derive RT01-RT09', () => {
  const tinyCases = [
    { value: RT01, amount: 2n, bases: [1n, 1n], residual: 0n, score: [1n, 1n], output: 2n, gap: 0n, rejections: 0 },
    { value: RT02, amount: 3n, bases: [1n, 1n], residual: 1n, score: [1n, 2n], output: 7n, gap: 0n, rejections: 0 },
    { value: RT03, amount: 5n, bases: [2n, 2n], residual: 1n, score: [2n, 3n], output: 4n, gap: 0n, rejections: 0 },
    { value: RT04, amount: 3n, bases: [1n, 1n], residual: 1n, score: [1n, 2n], output: 2n, gap: 0n, rejections: 1 },
    { value: RT07, amount: 2n, bases: [1n, 1n], residual: 0n, score: [1n, 1n], output: 2n, gap: 1n, rejections: 0 },
  ] as const;
  for (const fixture of tinyCases) {
    const routes = routesFor(fixture.value);
    const residual = assignResidual(fixture.value, routes, fixture.bases, fixture.residual);
    const exhaustive = exhaustiveReceipt(fixture.value, routes, fixture.amount);
    assert.deepEqual(residual.allocations, fixture.score);
    assert.equal(residual.receipt?.amountOut, fixture.output);
    assert.equal(residual.rejections, fixture.rejections);
    assert.equal((exhaustive?.amountOut ?? 0n) - fixture.output, fixture.gap);
    if (fixture.gap === 0n && residual.receipt !== undefined && exhaustive !== undefined) {
      assert.equal(compareReceipt(residual.receipt, exhaustive), 0);
    }
  }

  const rt05Residual = assignResidual(RT05, routesFor(RT05), [1n, 1n], 1n);
  assert.equal(rt05Residual.receipt, undefined);
  assert.deepEqual([rt05Residual.replays, rt05Residual.rejections], [2, 2]);
  const rt06Residual = assignResidual(RT06, routesFor(RT06), [1n, 1n], 0n);
  assert.equal(rt06Residual.receipt, undefined);
  assert.deepEqual([rt06Residual.replays, rt06Residual.rejections], [1, 1]);

  const rt08Routes = routesFor(RT08, 2);
  const rt08Residual = assignResidual(RT08, rt08Routes, [2n, 3n], 1n);
  const rt08Exhaustive = exhaustiveReceipt(RT08, rt08Routes, 6n);
  assert.deepEqual(rt08Residual.allocations, [2n, 4n]);
  assert.equal(rt08Residual.receipt?.amountOut, 4n);
  assert.equal(rt08Exhaustive?.amountOut, 4n);
  if (rt08Residual.receipt === undefined || rt08Exhaustive === undefined) {
    assert.fail('RT08 independent replay unexpectedly rejected');
  }
  assert.notEqual(compareReceipt(rt08Residual.receipt, rt08Exhaustive), 0);

  const rt09Routes = routesFor(RT09);
  const bases = [
    107106781186547548165816805582890081377465480031414098727577933285204793952405405n,
    192893218813452451834183194417109918622534519968585901272422066714795206047594596n,
  ];
  const rt09Residual = assignResidual(RT09, rt09Routes, bases, 1n);
  assert.deepEqual(rt09Residual.allocations, [bases[0], bases[1]! + 1n]);
  assert.equal(
    rt09Residual.receipt?.amountOut,
    183431457505076198047932451031610991550821683253151305915117620700702577576969613n,
  );
  assert.deepEqual([rt09Residual.replays, rt09Residual.rejections], [2, 0]);
  assert.equal(baselineReceipt(RT09, runtimeRequest(RT09, 3n * U + 2n))?.amountOut, 180n * 10n ** 78n);

  assert.equal(baselineReceipt(RT10, runtimeRequest(RT10, 1n))?.amountOut, 1n);
  assert.equal(baselineReceipt(RT11, runtimeRequest(RT11, 2n ** 700n))?.amountOut, 1n);
  assert.equal(baselineReceipt(RT12, runtimeRequest(RT12, 1n))?.amountOut, 1n);
  assert.equal(baselineReceipt(RT13, runtimeRequest(RT13, 1n))?.amountOut, 7n);
});

void test('RT00 has no incumbent and therefore no numerical proposal identity', () => {
  const request = runtimeRequest(RT00, 1n);
  assert.equal(baselineReceipt(RT00, request), undefined);
  const result = routeExactInputSplitNumericalAnytime(prepare(RT00), request, runtimeControl());
  assert.equal(result.status, 'no-route');
  if (result.status !== 'no-route') return;
  assert.equal(result.reason, 'all-candidates-rejected');
  assert.deepEqual(result.search, {
    counters: {
      directCandidates: 2,
      directCandidateReplays: 2,
      directCandidateRejections: 2,
      pathExpansions: 2,
      bestSingleCandidateReplays: 2,
      bestSingleCandidateRejections: 2,
      candidateSetExpansions: 2,
      equalProposalReplays: 0,
      equalProposalRejections: 0,
      greedyOptionReplays: 2,
      greedyOptionRejections: 2,
      finalAuthorizationReplays: 0,
      finalAuthorizationRejections: 0,
      numericalProposals: 0,
      numericalProposalFailures: 0,
      numericalIterations: 0,
      numericalResidualReplays: 0,
      numericalResidualReplayRejections: 0,
      numericalAuthorizationReplays: 0,
      numericalAuthorizationReplayRejections: 0,
    },
    termination: 'complete',
    numericalDiagnostics: [],
  });
});

void test('RT01-RT09 match frozen numerical outcomes and preserve or improve the exact baseline', () => {
  const cases = [
    { value: RT01, amount: 2n, status: 'not-better', residual: 0n, tuple: [1, 0, 64, 1, 0, 0, 0], allocation: [1n, 1n], output: 2n, baselineOutput: 2n },
    { value: RT02, amount: 3n, status: 'not-better', residual: 1n, tuple: [1, 0, 64, 2, 0, 0, 0], allocation: [1n, 2n], output: 7n, baselineOutput: 7n },
    { value: RT03, amount: 5n, status: 'improved', residual: 1n, tuple: [1, 0, 64, 2, 0, 1, 0], allocation: [2n, 3n], output: 4n, baselineOutput: 3n },
    { value: RT04, amount: 3n, status: 'improved', residual: 1n, tuple: [1, 0, 64, 2, 1, 1, 0], allocation: [1n, 2n], output: 2n, baselineOutput: 1n },
    { value: RT05, amount: 3n, status: 'failed', residual: 1n, tuple: [1, 0, 64, 2, 2, 0, 0], allocation: [3n, 0n], output: 1n, baselineOutput: 1n, failure: 'residual-options-exhausted' },
    { value: RT06, amount: 2n, status: 'failed', residual: 0n, tuple: [1, 0, 64, 1, 1, 0, 0], allocation: [2n, 0n], output: 1n, baselineOutput: 1n, failure: 'residual-options-exhausted' },
    { value: RT07, amount: 2n, status: 'not-better', residual: 0n, tuple: [1, 0, 64, 1, 0, 0, 0], allocation: [2n, 0n], output: 3n, baselineOutput: 3n },
    { value: RT08, amount: 6n, status: 'not-better', residual: 1n, tuple: [1, 0, 64, 2, 0, 0, 0], allocation: [0n, 6n], output: 4n, baselineOutput: 4n, maxHops: 2 },
    { value: RT09, amount: 3n * U + 2n, status: 'improved', residual: 1n, tuple: [1, 0, 64, 2, 0, 1, 0], allocation: [
      107106781186547548165816805582890081377465480031414098727577933285204793952405405n,
      192893218813452451834183194417109918622534519968585901272422066714795206047594597n,
    ], output: 183431457505076198047932451031610991550821683253151305915117620700702577576969613n, baselineOutput: 180n * 10n ** 78n },
  ] as const;

  for (const fixture of cases) {
    const request = runtimeRequest(fixture.value, fixture.amount, {
      maxHops: 'maxHops' in fixture ? fixture.maxHops : 1,
    });
    const baseline = baselineReceipt(fixture.value, request);
    assert.notEqual(baseline, undefined);
    assert.equal(baseline?.amountOut, fixture.baselineOutput);
    const result = routeExactInputSplitNumericalAnytime(
      prepare(fixture.value),
      request,
      runtimeControl(),
    );
    const routes = routesFor(fixture.value, request.maxHops);
    assertDiagnostic(result, routes, {
      status: fixture.status,
      failureCode: 'failure' in fixture ? fixture.failure : null,
      converged: true,
      completedOuterIterations: 64,
      residualUnits: fixture.residual,
      tuple: fixture.tuple,
    });
    assert.deepEqual(allocationVector(successReceipt(result), routes), fixture.allocation);
    assert.equal(successReceipt(result).amountOut, fixture.output);
    assert.ok(successReceipt(result).amountOut >= baseline.amountOut);
  }
});

void test('RT10-RT13 map normalization, atomic iteration, underflow, and convergence failures', () => {
  const cases = [
    { value: RT10, amount: 1n, failure: 'non-finite-normalization', completed: 0, iterations: 0, baselineOutput: 1n },
    { value: RT11, amount: 2n ** 700n, failure: 'non-finite-proposal', completed: 0, iterations: 1, baselineOutput: 1n },
    { value: RT12, amount: 1n, failure: 'non-finite-proposal', completed: 53, iterations: 54, baselineOutput: 1n },
    { value: RT13, amount: 1n, failure: 'non-convergence', completed: 64, iterations: 64, baselineOutput: 7n },
  ] as const;
  for (const fixture of cases) {
    const request = runtimeRequest(fixture.value, fixture.amount);
    const baseline = baselineReceipt(fixture.value, request);
    assert.equal(baseline?.amountOut, fixture.baselineOutput);
    const result = routeExactInputSplitNumericalAnytime(
      prepare(fixture.value),
      request,
      runtimeControl({ maxCandidateSetExpansions: 2 }),
    );
    assertBaseline(result, baseline);
    assertDiagnostic(result, routesFor(fixture.value), {
      status: 'failed',
      failureCode: fixture.failure,
      converged: false,
      completedOuterIterations: fixture.completed,
      residualUnits: null,
      tuple: [1, 1, fixture.iterations, 0, 0, 0, 0],
    });
  }
});

interface StopTarget {
  readonly kind: NumericalExactInputSplitRuntimeWorkKind;
  readonly tuple: readonly [number, number, number, number, number, number, number];
  readonly converged: boolean;
  readonly completed: number;
  readonly residual: bigint | null;
  readonly clockCall: number;
}

const STOP_TARGETS: readonly StopTarget[] = [
  { kind: 'numerical-proposal', tuple: [0, 0, 0, 0, 0, 0, 0], converged: false, completed: 0, residual: null, clockCall: 13 },
  { kind: 'numerical-iteration', tuple: [1, 0, 0, 0, 0, 0, 0], converged: false, completed: 0, residual: null, clockCall: 14 },
  { kind: 'numerical-residual-replay', tuple: [1, 0, 64, 0, 0, 0, 0], converged: true, completed: 64, residual: 1n, clockCall: 78 },
  { kind: 'numerical-authorization-replay', tuple: [1, 0, 64, 2, 0, 0, 0], converged: true, completed: 64, residual: 1n, clockCall: 80 },
];

function assertRt03Stopped(
  result: NumericalExactInputSplitRuntimeResult,
  target: StopTarget,
  termination: 'work-limit' | 'interrupted' | 'deadline' | 'control-error' | 'deadline-error',
): void {
  const baseline = baselineReceipt(RT03, runtimeRequest(RT03, 5n));
  assert.notEqual(baseline, undefined);
  if (result.status === 'control-error' || result.status === 'deadline-error') {
    assert.deepEqual(result.incumbent, baseline);
  } else {
    assertBaseline(result, baseline!);
  }
  assert.equal(searchSummary(result).termination, termination);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(RT03_BASELINE_COUNTERS).map((field) => [
        field,
        searchSummary(result).counters[field as keyof typeof RT03_BASELINE_COUNTERS],
      ]),
    ),
    RT03_BASELINE_COUNTERS,
  );
  assertDiagnostic(result, routesFor(RT03), {
    status: 'stopped',
    failureCode: null,
    converged: target.converged,
    completedOuterIterations: target.completed,
    residualUnits: target.residual,
    tuple: target.tuple,
  });
}

void test('all four numerical caps stop before charge and exact caps complete naturally', () => {
  const capCases = [
    { target: STOP_TARGETS[0]!, value: RT03, caps: { maxNumericalProposals: 0 } },
    { target: STOP_TARGETS[1]!, value: RT03, caps: { maxNumericalIterations: 0 } },
    {
      target: { ...STOP_TARGETS[2]!, tuple: [1, 0, 64, 1, 1, 0, 0] as const },
      value: RT04,
      caps: { maxNumericalResidualReplays: 1 },
    },
    { target: STOP_TARGETS[3]!, value: RT03, caps: { maxNumericalAuthorizationReplays: 0 } },
  ] as const;
  for (const fixture of capCases) {
    const amount = fixture.value === RT04 ? 3n : 5n;
    const result = routeExactInputSplitNumericalAnytime(
      prepare(fixture.value),
      runtimeRequest(fixture.value, amount),
      runtimeControl(fixture.caps),
    );
    const baseline = baselineReceipt(fixture.value, runtimeRequest(fixture.value, amount));
    assertBaseline(result, baseline!);
    assert.equal(searchSummary(result).termination, 'work-limit');
    assertDiagnostic(result, routesFor(fixture.value), {
      status: 'stopped',
      failureCode: null,
      converged: fixture.target.converged,
      completedOuterIterations: fixture.target.completed,
      residualUnits: fixture.target.residual,
      tuple: fixture.target.tuple,
    });
  }

  const exact = routeExactInputSplitNumericalAnytime(
    prepare(RT03),
    runtimeRequest(RT03, 5n),
    runtimeControl({
      maxNumericalProposals: 1,
      maxNumericalIterations: 64,
      maxNumericalResidualReplays: 2,
      maxNumericalAuthorizationReplays: 1,
    }),
  );
  assert.equal(searchSummary(exact).termination, 'complete');
  assert.equal(successReceipt(exact).amountOut, 4n);
});

void test('cap precedence suppresses callback and clock at the pending numerical unit', () => {
  let proposalCallbacks = 0;
  let clockCalls = 0;
  const result = routeExactInputSplitNumericalAnytime(
    prepare(RT03),
    runtimeRequest(RT03, 5n),
    runtimeControl(
      { maxNumericalProposals: 0 },
      {
        shouldInterrupt: (checkpoint) => {
          if (checkpoint.nextWorkKind === 'numerical-proposal') {
            proposalCallbacks += 1;
            throw new Error('cap must precede callback');
          }
          return false;
        },
        deadline: {
          deadlineNanoseconds: 100n,
          nowNanoseconds: () => {
            clockCalls += 1;
            return 0n;
          },
        },
      },
    ),
  );
  assertRt03Stopped(result, STOP_TARGETS[0]!, 'work-limit');
  assert.equal(proposalCallbacks, 0);
  assert.equal(clockCalls, 12);

  let callbackPrecedenceClockCalls = 0;
  const interrupted = routeExactInputSplitNumericalAnytime(
    prepare(RT03),
    runtimeRequest(RT03, 5n),
    runtimeControl({}, {
      shouldInterrupt: (checkpoint) => checkpoint.nextWorkKind === 'numerical-proposal',
      deadline: {
        deadlineNanoseconds: 100n,
        nowNanoseconds: () => {
          callbackPrecedenceClockCalls += 1;
          return 0n;
        },
      },
    }),
  );
  assertRt03Stopped(interrupted, STOP_TARGETS[0]!, 'interrupted');
  assert.equal(callbackPrecedenceClockCalls, 12);
});

void test('callback true, throw, and nonboolean stop at every numerical kind', () => {
  for (const target of STOP_TARGETS) {
    let observed = 0;
    const interrupted = routeExactInputSplitNumericalAnytime(
      prepare(RT03),
      runtimeRequest(RT03, 5n),
      runtimeControl({}, {
        shouldInterrupt: (checkpoint) => {
          if (checkpoint.nextWorkKind !== target.kind) return false;
          observed += 1;
          assert.deepEqual(tupleFromCounters(checkpoint.counters), target.tuple);
          assert.equal(checkpoint.incumbent?.amountOut, 3n);
          return true;
        },
      }),
    );
    assertRt03Stopped(interrupted, target, 'interrupted');
    assert.equal(observed, 1);

    const thrown = routeExactInputSplitNumericalAnytime(
      prepare(RT03),
      runtimeRequest(RT03, 5n),
      runtimeControl({}, {
        shouldInterrupt: (checkpoint) => {
          if (checkpoint.nextWorkKind === target.kind) throw new Error('oracle callback failure');
          return false;
        },
      }),
    );
    assert.equal(thrown.status, 'control-error');
    if (thrown.status === 'control-error') assert.equal(thrown.error.code, 'interruption-check-failed');
    assertRt03Stopped(thrown, target, 'control-error');

    const nonboolean = routeExactInputSplitNumericalAnytime(
      prepare(RT03),
      runtimeRequest(RT03, 5n),
      runtimeControl({}, {
        shouldInterrupt: (checkpoint) =>
          checkpoint.nextWorkKind === target.kind ? (undefined as never) : false,
      }),
    );
    assert.equal(nonboolean.status, 'control-error');
    if (nonboolean.status === 'control-error') assert.equal(nonboolean.error.code, 'invalid-interruption-result');
    assertRt03Stopped(nonboolean, target, 'control-error');
  }
});

function deadlineControl(
  targetCall: number,
  behavior: 'equal' | 'throw' | 'non-bigint' | 'negative' | 'regress',
): { readonly control: NumericalExactInputSplitRuntimeControl; readonly calls: () => number } {
  let calls = 0;
  const nowNanoseconds = (): bigint => {
    calls += 1;
    if (calls !== targetCall) return behavior === 'regress' ? BigInt(calls) : 0n;
    if (behavior === 'throw') throw new Error('oracle clock failure');
    if (behavior === 'non-bigint') return undefined as never;
    if (behavior === 'negative') return -1n;
    if (behavior === 'regress') return 0n;
    return 1n;
  };
  return {
    control: runtimeControl({}, {
      deadline: {
        deadlineNanoseconds: behavior === 'regress' ? 10_000n : 1n,
        nowNanoseconds,
      },
    }),
    calls: () => calls,
  };
}

void test('absolute deadline, clock failure, and one monotonic history cover every numerical kind', () => {
  for (const target of STOP_TARGETS) {
    const equal = deadlineControl(target.clockCall, 'equal');
    const deadline = routeExactInputSplitNumericalAnytime(
      prepare(RT03),
      runtimeRequest(RT03, 5n),
      equal.control,
    );
    assertRt03Stopped(deadline, target, 'deadline');
    assert.equal(equal.calls(), target.clockCall);

    for (const behavior of ['throw', 'non-bigint', 'negative'] as const) {
      const failing = deadlineControl(target.clockCall, behavior);
      const result = routeExactInputSplitNumericalAnytime(
        prepare(RT03),
        runtimeRequest(RT03, 5n),
        failing.control,
      );
      assert.equal(result.status, 'deadline-error');
      if (result.status === 'deadline-error') assert.equal(result.error.code, 'deadline-clock-failed');
      assertRt03Stopped(result, target, 'deadline-error');
      assert.equal(failing.calls(), target.clockCall);
    }

    const regressing = deadlineControl(target.clockCall, 'regress');
    const regression = routeExactInputSplitNumericalAnytime(
      prepare(RT03),
      runtimeRequest(RT03, 5n),
      regressing.control,
    );
    assert.equal(regression.status, 'deadline-error');
    if (regression.status === 'deadline-error') assert.equal(regression.error.code, 'deadline-clock-regressed');
    assertRt03Stopped(regression, target, 'deadline-error');
    assert.equal(regressing.calls(), target.clockCall);
  }
});

function injectedFailureDriver(
  code: 'invalid-route-model' | 'zero-total-weight' | 'invalid-reconstruction',
): { readonly driver: NumericalExactInputSplitProposalDriver; readonly advances: () => number } {
  let advances = 0;
  const driver: NumericalExactInputSplitProposalDriver = {
    prepare: (request) => {
      void request;
      if (code === 'invalid-route-model') {
        return { ok: false, error: { code, converged: false, completedOuterIterations: 0 } };
      }
      return {
        ok: true,
        value: {
          state: { completedOuterIterations: 0 } as never,
          routeModels: Object.freeze([]),
        },
      };
    },
    advance: (state) => {
      advances += 1;
      const completedOuterIterations = state.completedOuterIterations + 1;
      return {
        ok: true,
        value: completedOuterIterations === 64
          ? { status: 'ready', state: { completedOuterIterations } as never }
          : { status: 'continue', state: { completedOuterIterations } as never },
      };
    },
    finalize: (state) => ({
      ok: false,
      error: {
        code,
        converged: true,
        completedOuterIterations: state.completedOuterIterations,
      },
    }),
  };
  return { driver, advances: () => advances };
}

void test('proposal-only seam maps the three naturally unreachable core failure codes', () => {
  for (const code of ['invalid-route-model', 'zero-total-weight', 'invalid-reconstruction'] as const) {
    const injected = injectedFailureDriver(code);
    const result = routeExactInputSplitNumericalAnytimeWithProposalDriver(
      prepare(RT01),
      runtimeRequest(RT01, 2n),
      runtimeControl(),
      injected.driver,
    );
    assert.equal(successReceipt(result).amountOut, 2n);
    const completed = code === 'invalid-route-model' ? 0 : 64;
    assertDiagnostic(result, routesFor(RT01), {
      status: 'failed',
      failureCode: code,
      converged: code !== 'invalid-route-model',
      completedOuterIterations: completed,
      residualUnits: null,
      tuple: [1, 1, completed, 0, 0, 0, 0],
    });
    assert.equal(injected.advances(), completed);
  }
});

function oracleAuthorization(
  value: LiquiditySnapshot,
  mode: 'identical' | 'reject' | 'mismatch',
  calls: { value: number },
): NumericalExactInputSplitAuthorizationReplay {
  return (_context, request) => {
    calls.value += 1;
    if (mode === 'reject') {
      return {
        ok: false,
        error: {
          code: 'empty-legs',
          message: 'independent injected rejection',
          legIndex: null,
          causeCode: null,
        },
      };
    }
    const oracleRequest: OracleSplitRequest = {
      snapshotId: request.snapshotId,
      snapshotChecksum: request.snapshotChecksum,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
      legs: request.legs.map((leg) => ({
        allocation: leg.allocation,
        route: leg.route.map(({ assetIn, poolId, assetOut }) => ({ assetIn, poolId, assetOut })),
      })),
    };
    const receipt = replayRequest(value, oracleRequest);
    if (receipt === undefined) assert.fail('authorization request rejected by independent replay');
    if (mode === 'identical') return { ok: true, value: receipt };
    const firstLeg = receipt.legs[0]!;
    const firstHop = firstLeg.receipt.hops[0]!;
    const mismatched: OracleSplitReceipt = {
      ...receipt,
      legs: [
        {
          ...firstLeg,
          receipt: {
            ...firstLeg.receipt,
            hops: [{ ...firstHop, reserveInAfter: firstHop.reserveInAfter + 1n }, ...firstLeg.receipt.hops.slice(1)],
          },
        },
        ...receipt.legs.slice(1),
      ],
    };
    return { ok: true, value: mismatched };
  };
}

void test('authorization seam is phase-limited and requires recursive exact receipt identity', () => {
  for (const mode of ['identical', 'reject', 'mismatch'] as const) {
    const calls = { value: 0 };
    const result = routeExactInputSplitNumericalAnytimeWithAuthorizationReplay(
      prepare(RT03),
      runtimeRequest(RT03, 5n),
      runtimeControl(),
      oracleAuthorization(RT03, mode, calls),
    );
    assert.equal(calls.value, 1);
    assertDiagnostic(result, routesFor(RT03), {
      status: mode === 'identical' ? 'improved' : 'failed',
      failureCode: mode === 'reject'
        ? 'authorization-replay-rejected'
        : mode === 'mismatch'
          ? 'authorization-result-mismatch'
          : null,
      converged: true,
      completedOuterIterations: 64,
      residualUnits: 1n,
      tuple: [1, 0, 64, 2, 0, 1, mode === 'identical' ? 0 : 1],
    });
    assert.deepEqual(
      allocationVector(successReceipt(result), routesFor(RT03)),
      mode === 'identical' ? [2n, 3n] : [3n, 2n],
    );
    assert.equal(successReceipt(result).amountOut, mode === 'identical' ? 4n : 3n);
  }
});

void test('pool permutation, captured mutation, reentrancy, freshness, and deep freeze are deterministic', () => {
  const reversed = snapshot([...RT02.pools].reverse(), RT02.snapshotId);
  assert.equal(reversed.snapshotChecksum, RT02.snapshotChecksum);
  const request = runtimeRequest(RT02, 3n);
  const reversedRequest = runtimeRequest(reversed, 3n);
  const first = routeExactInputSplitNumericalAnytime(prepare(RT02), request, runtimeControl());
  const reversedResult = routeExactInputSplitNumericalAnytime(
    prepare(reversed),
    reversedRequest,
    runtimeControl(),
  );
  assert.deepEqual(successReceipt(reversedResult), successReceipt(first));
  assert.deepEqual(searchSummary(reversedResult), searchSummary(first));

  const rt03Reversed = snapshot([...RT03.pools].reverse(), RT03.snapshotId);
  const rt03CanonicalResult = routeExactInputSplitNumericalAnytime(
    prepare(RT03),
    runtimeRequest(RT03, 5n),
    runtimeControl(),
  );
  const rt03ReversedResult = routeExactInputSplitNumericalAnytime(
    prepare(rt03Reversed),
    runtimeRequest(rt03Reversed, 5n),
    runtimeControl(),
  );
  assert.deepEqual(rt03ReversedResult, rt03CanonicalResult);

  const mutablePools = RT03.pools.map((candidate) => ({ ...candidate }));
  const mutableSnapshot = snapshot(mutablePools, 'RT03-mutable');
  const context = prepare(mutableSnapshot);
  mutablePools.reverse();
  mutablePools[0]!.reserve0 += 999n;
  const mutableNumerical: {
    outerIterations: number;
    innerIterations: number;
    convergenceTolerance: number;
  } = { ...NUMERICAL };
  const mutableRequest = runtimeRequest(mutableSnapshot, 5n, { numerical: mutableNumerical });
  const mutableCaps = { ...COMPLETE_CAPS };
  const result = routeExactInputSplitNumericalAnytime(context, mutableRequest, { workCaps: mutableCaps });
  mutableNumerical.outerIterations = 1;
  mutableCaps.maxNumericalIterations = 0;
  const repeated = routeExactInputSplitNumericalAnytime(
    prepare(snapshot(RT03.pools, 'RT03-mutable')),
    runtimeRequest(snapshot(RT03.pools, 'RT03-mutable'), 5n),
    runtimeControl(),
  );
  assert.deepEqual(result, repeated);
  assert.notEqual(result, repeated);
  assert.notEqual(successReceipt(result), successReceipt(repeated));
  assertDeepFrozen(result);
  assertDeepFrozen(repeated);

  let nested: NumericalExactInputSplitRuntimeResult | undefined;
  let entered = false;
  const reentrant = routeExactInputSplitNumericalAnytime(
    prepare(RT03),
    runtimeRequest(RT03, 5n),
    runtimeControl({}, {
      shouldInterrupt: (checkpoint) => {
        if (!entered && checkpoint.nextWorkKind === 'numerical-proposal') {
          entered = true;
          nested = routeExactInputSplitNumericalAnytime(
            prepare(RT03),
            runtimeRequest(RT03, 5n),
            runtimeControl(),
          );
        }
        return false;
      },
    }),
  );
  assert.equal(entered, true);
  assert.deepEqual(reentrant, nested);
  assert.notEqual(reentrant, nested);
});

void test('oracle import audit keeps exact replay, objective, baseline, and numerical math local', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const forbiddenImports = [
    '/allocation/path-shadow-price/',
    '/replay/exact-input-',
    '/router/anytime-exact-input-split/',
    '/router/greedy-exact-input-split/',
    '/router/split-exact-input/',
    '/search/pool-disjoint-route-sets/',
    '/search/shared-route-discovery/',
  ];
  for (const fragment of forbiddenImports) {
    assert.equal(source.includes(`from '../../src${fragment}`), false, fragment);
  }
});
