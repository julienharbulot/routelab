import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type JsonRecord = Record<string, unknown>;

interface PoolJson {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: string;
  readonly asset1: string;
  readonly reserve1: string;
  readonly feeChargedNumerator: string;
  readonly feeDenominator: string;
}

interface Pool {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

interface RequestJson {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: string;
  readonly amountIn: string;
  readonly topology: string;
}

interface Hop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

type Route = readonly Hop[];
type CandidateSet = readonly [Route, Route];

interface RouteReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly hops: readonly {
    readonly poolId: string;
    readonly assetIn: string;
    readonly assetOut: string;
    readonly amountIn: bigint;
    readonly amountOut: bigint;
    readonly reserveInBefore: bigint;
    readonly reserveOutBefore: bigint;
    readonly reserveInAfter: bigint;
    readonly reserveOutAfter: bigint;
  }[];
}

interface SplitReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly legs: readonly {
    readonly allocation: bigint;
    readonly receipt: RouteReceipt;
  }[];
}

interface Objective {
  readonly amountOut: bigint;
  readonly routes: readonly Route[];
  readonly allocations: readonly bigint[];
  readonly totalHops: number;
}

interface StructuralResult {
  readonly paths: readonly Route[];
  readonly pathExpansions: number;
  readonly candidateSets: readonly CandidateSet[];
  readonly candidateSetExpansions: number;
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATASET = 'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1';
const BASELINE =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/composed-two-hop-pair-v3';
const EVALUATION =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/numerical-path-shadow-price-v1';
const FIXTURES = 'fixtures/m7/numerical-historical';

const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const SNAPSHOT_CHECKSUM =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const CORPUS_SHA256 =
  'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173';
const BASELINE_EVALUATION_ID =
  'm6-core12-synthetic-exhaustive-composed-two-hop-pair-evaluation-v3';
const BASELINE_CONFIG_ID = 'm6-core12-synthetic-exhaustive-composed-two-hop-pair-v3';
const BASELINE_CONFIG_SHA256 =
  'sha256:4e4d1bdfe47016d23510adbc4ed8107854b5bbf0dec99f3fb88d920d7a403473';
const BASELINE_SEMANTIC_SHA256 =
  'sha256:28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e';
const COMPARISON_CONFIG_ID =
  'm7a-core12-synthetic-exhaustive-numerical-path-shadow-price-v1';
const COMPARISON_CONFIG_SHA256 =
  'sha256:96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6';
const ELIGIBILITY_ID =
  'm7a-core12-synthetic-exhaustive-numerical-path-shadow-price-eligibility-v1';
const ELIGIBILITY_SHA256 =
  'sha256:5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc';
const EVALUATION_ID =
  'm7a-core12-synthetic-exhaustive-numerical-path-shadow-price-evaluation-v1';
const SEMANTIC_SHA256 =
  'sha256:5cea9419623af330f1c05bfa30dadcce3553c6d334de2740655792cfe89a058a';
const MANIFEST_SHA256 =
  'sha256:b01f7c2ca5ef617882e95f5e0c9c7e26b72f387447e7917b7efb66abb6b6c898';
const IMPLEMENTATION_REVISION = 'cdc5a83b47ca35e9173a41e95f7e32e81e4f9d85';

const PROFILE_IDS = [
  'fraction-0',
  'fraction-1-16',
  'fraction-1-8',
  'fraction-1-4',
  'fraction-1-2',
  'structural-complete',
] as const;
const BASELINE_CAP_FIELDS = [
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
] as const;
const NUMERICAL_CAP_FIELDS = [
  'maxNumericalProposals',
  'maxNumericalIterations',
  'maxNumericalResidualReplays',
  'maxNumericalAuthorizationReplays',
] as const;
const BASELINE_COUNTER_FIELDS = [
  'directCandidates',
  'directCandidateReplays',
  'directCandidateRejections',
  'pathExpansions',
  'bestSingleCandidateReplays',
  'bestSingleCandidateRejections',
  'candidateSetExpansions',
  'equalProposalReplays',
  'equalProposalRejections',
  'greedyOptionReplays',
  'greedyOptionRejections',
  'finalAuthorizationReplays',
  'finalAuthorizationRejections',
] as const;
const NUMERICAL_COUNTER_FIELDS = [
  'numericalProposals',
  'numericalProposalFailures',
  'numericalIterations',
  'numericalResidualReplays',
  'numericalResidualReplayRejections',
  'numericalAuthorizationReplays',
  'numericalAuthorizationReplayRejections',
] as const;
const COUNTER_FIELDS = [...BASELINE_COUNTER_FIELDS, ...NUMERICAL_COUNTER_FIELDS] as const;
const REASONS = [
  'baseline-no-authorized-incumbent',
  'path-discovery-incomplete',
  'candidate-set-discovery-incomplete',
  'no-model-valid-candidate-set',
] as const;
const NUMERICAL_CONFIGURATION = {
  outerIterations: 64,
  innerIterations: 64,
  convergenceTolerance: 2 ** -40,
} as const;
const LIMITATIONS = [
  'One frozen block, venue, 12-asset allowlist, synthetic exhaustive request grid, and result-blind eligibility cohort only.',
  'Exact comparisons are request/profile-local; outputs are never summed across assets.',
  'Approximate numerical allocation only proposes candidates; fresh exact replay authorizes every retained incumbent.',
  'Typed work kinds remain separate and are not combined into a universal work scalar.',
  'No latency, speedup, representative demand, unrestricted optimum, transaction submission, custody, live execution, or production claim is made.',
] as const;

function absolute(relative: string): string {
  return path.join(ROOT, relative);
}

function bytes(relative: string): Buffer {
  return readFileSync(absolute(relative));
}

function text(relative: string): string {
  return bytes(relative).toString('utf8');
}

function parse(relative: string): JsonRecord {
  return record(JSON.parse(text(relative)) as unknown);
}

function record(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function array(value: unknown): readonly unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as readonly unknown[];
}

function exact(value: unknown): bigint {
  assert.equal(typeof value, 'string');
  assert.match(value as string, /^(?:0|[1-9][0-9]*)$/u);
  return BigInt(value as string);
}

function safeInteger(value: unknown): number {
  assert.equal(typeof value, 'number');
  assert.equal(Number.isSafeInteger(value), true);
  assert.ok((value as number) >= 0);
  return value as number;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function assertNoObservationKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoObservationKeys(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const forbidden = /^(?:implementationRevision|elapsed.*|latency.*|timing.*|warmup.*|environment.*)$/iu;
  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    assert.equal(forbidden.test(key), false, key);
    assertNoObservationKeys(nested);
  }
}

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareHop(left: Hop, right: Hop): number {
  return compareRaw(left.assetIn, right.assetIn)
    || compareRaw(left.poolId, right.poolId)
    || compareRaw(left.assetOut, right.assetOut);
}

function compareRoute(left: Route, right: Route): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    assert.ok(leftHop && rightHop);
    const comparison = compareHop(leftHop, rightHop);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function routeTuple(route: Route): readonly (readonly [string, string, string])[] {
  return route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut] as const);
}

function routeKey(route: Route): string {
  return JSON.stringify(routeTuple(route));
}

function candidateSetKey(routes: CandidateSet): string {
  return JSON.stringify(routes.map(routeTuple));
}

function parsePools(snapshot: JsonRecord): readonly Pool[] {
  return array(snapshot['pools']).map((value): Pool => {
    const source = record(value) as unknown as PoolJson;
    return {
      poolId: source.poolId,
      asset0: source.asset0,
      reserve0: exact(source.reserve0),
      asset1: source.asset1,
      reserve1: exact(source.reserve1),
      feeChargedNumerator: exact(source.feeChargedNumerator),
      feeDenominator: exact(source.feeDenominator),
    };
  });
}

function discoverStructure(
  pools: readonly Pool[],
  request: RequestJson,
): StructuralResult {
  const adjacency = new Map<string, Hop[]>();
  for (const pool of pools) {
    for (const hop of [
      { assetIn: pool.asset0, poolId: pool.poolId, assetOut: pool.asset1 },
      { assetIn: pool.asset1, poolId: pool.poolId, assetOut: pool.asset0 },
    ]) {
      const edges = adjacency.get(hop.assetIn) ?? [];
      edges.push(hop);
      adjacency.set(hop.assetIn, edges);
    }
  }
  for (const edges of adjacency.values()) edges.sort(compareHop);

  const paths: Route[] = [];
  let pathExpansions = 0;
  function walk(
    asset: string,
    prefix: Route,
    visitedAssets: ReadonlySet<string>,
    visitedPools: ReadonlySet<string>,
  ): void {
    if (prefix.length === 2) return;
    for (const hop of adjacency.get(asset) ?? []) {
      pathExpansions += 1;
      if (visitedPools.has(hop.poolId) || visitedAssets.has(hop.assetOut)) continue;
      const next = [...prefix, hop];
      if (hop.assetOut === request.assetOut) {
        paths.push(next);
        continue;
      }
      walk(
        hop.assetOut,
        next,
        new Set([...visitedAssets, hop.assetOut]),
        new Set([...visitedPools, hop.poolId]),
      );
    }
  }
  walk(request.assetIn, [], new Set([request.assetIn]), new Set());
  paths.sort(compareRoute);

  const candidateSets: CandidateSet[] = [];
  let candidateSetExpansions = 0;
  for (let anchor = 1; anchor < paths.length; anchor += 1) {
    const anchorRoute = paths[anchor];
    assert.ok(anchorRoute);
    for (let prefix = 0; prefix < anchor; prefix += 1) {
      const prefixRoute = paths[prefix];
      assert.ok(prefixRoute);
      candidateSetExpansions += 1;
      const prefixPools = new Set(prefixRoute.map(({ poolId }) => poolId));
      candidateSetExpansions += 1;
      if (anchorRoute.every(({ poolId }) => !prefixPools.has(poolId))) {
        candidateSets.push([prefixRoute, anchorRoute]);
      }
    }
  }
  return { paths, pathExpansions, candidateSets, candidateSetExpansions };
}

function replayRoute(
  poolsById: ReadonlyMap<string, Pool>,
  route: Route,
  amountIn: bigint,
): RouteReceipt | undefined {
  if (amountIn <= 0n || route.length === 0) return undefined;
  let currentAmount = amountIn;
  const hops: RouteReceipt['hops'][number][] = [];
  for (const hop of route) {
    const pool = poolsById.get(hop.poolId);
    if (pool === undefined || hop.assetIn !== (hops.at(-1)?.assetOut ?? route[0]?.assetIn)) {
      return undefined;
    }
    let reserveIn: bigint;
    let reserveOut: bigint;
    if (hop.assetIn === pool.asset0 && hop.assetOut === pool.asset1) {
      reserveIn = pool.reserve0;
      reserveOut = pool.reserve1;
    } else if (hop.assetIn === pool.asset1 && hop.assetOut === pool.asset0) {
      reserveIn = pool.reserve1;
      reserveOut = pool.reserve0;
    } else {
      return undefined;
    }
    const multiplier = pool.feeDenominator - pool.feeChargedNumerator;
    const amountOut = (currentAmount * multiplier * reserveOut)
      / ((reserveIn * pool.feeDenominator) + (currentAmount * multiplier));
    if (amountOut <= 0n || amountOut >= reserveOut) return undefined;
    hops.push({
      poolId: pool.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn: currentAmount,
      amountOut,
      reserveInBefore: reserveIn,
      reserveOutBefore: reserveOut,
      reserveInAfter: reserveIn + currentAmount,
      reserveOutAfter: reserveOut - amountOut,
    });
    currentAmount = amountOut;
  }
  const first = route[0];
  const last = route.at(-1);
  assert.ok(first && last);
  return {
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_CHECKSUM,
    assetIn: first.assetIn,
    assetOut: last.assetOut,
    amountIn,
    amountOut: currentAmount,
    hops,
  };
}

function replaySplit(
  poolsById: ReadonlyMap<string, Pool>,
  routes: readonly Route[],
  allocations: readonly bigint[],
): SplitReceipt | undefined {
  if (routes.length !== allocations.length) return undefined;
  const legs: SplitReceipt['legs'][number][] = [];
  const usedPools = new Set<string>();
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const allocation = allocations[index];
    assert.ok(route);
    assert.notEqual(allocation, undefined);
    if (allocation === 0n) continue;
    if ((allocation ?? -1n) < 0n || route.some(({ poolId }) => usedPools.has(poolId))) {
      return undefined;
    }
    const receipt = replayRoute(poolsById, route, allocation ?? -1n);
    if (receipt === undefined) return undefined;
    for (const { poolId } of route) usedPools.add(poolId);
    legs.push({ allocation: allocation ?? -1n, receipt });
  }
  if (legs.length === 0) return undefined;
  legs.sort((left, right) => compareRoute(routeFromLeg(left), routeFromLeg(right)));
  return {
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_CHECKSUM,
    assetIn: legs[0]?.receipt.assetIn ?? '',
    assetOut: legs[0]?.receipt.assetOut ?? '',
    amountIn: legs.reduce((sum, leg) => sum + leg.allocation, 0n),
    amountOut: legs.reduce((sum, leg) => sum + leg.receipt.amountOut, 0n),
    legs,
  };
}

function routeFromLeg(leg: SplitReceipt['legs'][number]): Route {
  return leg.receipt.hops.map(({ assetIn, poolId, assetOut }) => ({ assetIn, poolId, assetOut }));
}

function objective(receipt: SplitReceipt): Objective {
  const routes = receipt.legs.map(routeFromLeg);
  return {
    amountOut: receipt.amountOut,
    routes,
    allocations: receipt.legs.map(({ allocation }) => allocation),
    totalHops: routes.reduce((sum, route) => sum + route.length, 0),
  };
}

function compareObjective(left: Objective, right: Objective): number {
  if (left.amountOut !== right.amountOut) return left.amountOut > right.amountOut ? 1 : -1;
  if (left.routes.length !== right.routes.length) return left.routes.length < right.routes.length ? 1 : -1;
  if (left.totalHops !== right.totalHops) return left.totalHops < right.totalHops ? 1 : -1;
  for (let index = 0; index < left.routes.length; index += 1) {
    const comparison = compareRoute(left.routes[index] ?? [], right.routes[index] ?? []);
    if (comparison !== 0) return comparison < 0 ? 1 : -1;
  }
  for (let index = 0; index < left.allocations.length; index += 1) {
    const leftAllocation = left.allocations[index] ?? 0n;
    const rightAllocation = right.allocations[index] ?? 0n;
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? 1 : -1;
  }
  return 0;
}

function compareReceipt(left: SplitReceipt, right: SplitReceipt): number {
  return compareObjective(objective(left), objective(right));
}

function equalAllocations(amount: bigint, cardinality: number): readonly bigint[] {
  const divisor = BigInt(cardinality);
  const base = amount / divisor;
  const remainder = amount % divisor;
  return Array.from(
    { length: cardinality },
    (_, index) => base + (BigInt(index) < remainder ? 1n : 0n),
  );
}

function positiveChunks(amount: bigint, parts: number): readonly bigint[] {
  const divisor = BigInt(parts);
  const base = amount / divisor;
  const remainder = amount % divisor;
  if (base === 0n) return Array.from({ length: Number(remainder) }, () => 1n);
  return Array.from(
    { length: parts },
    (_, index) => base + (BigInt(index) < remainder ? 1n : 0n),
  );
}

function zeroCounters(): Record<(typeof COUNTER_FIELDS)[number], number> {
  return Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])) as Record<
    (typeof COUNTER_FIELDS)[number],
    number
  >;
}

function reconstructBaseline(
  poolsById: ReadonlyMap<string, Pool>,
  request: RequestJson,
  structure: StructuralResult,
): { readonly receipt: SplitReceipt; readonly counters: JsonRecord } {
  const counters = zeroCounters();
  let incumbent: SplitReceipt | undefined;
  for (const route of structure.paths.filter((value) => value.length === 1)) {
    counters.directCandidates += 1;
    counters.directCandidateReplays += 1;
    const replay = replaySplit(poolsById, [route], [exact(request.amountIn)]);
    if (replay === undefined) counters.directCandidateRejections += 1;
    else if (incumbent === undefined || compareReceipt(replay, incumbent) > 0) incumbent = replay;
  }
  counters.pathExpansions = structure.pathExpansions;
  for (const route of structure.paths) {
    counters.bestSingleCandidateReplays += 1;
    const replay = replaySplit(poolsById, [route], [exact(request.amountIn)]);
    if (replay === undefined) counters.bestSingleCandidateRejections += 1;
    else if (incumbent === undefined || compareReceipt(replay, incumbent) > 0) incumbent = replay;
  }
  counters.candidateSetExpansions = structure.candidateSetExpansions;

  const proposals = new Map<string, SplitReceipt>();
  function collect(receipt: SplitReceipt): void {
    const key = JSON.stringify(receipt.legs.map((leg) => ({
      allocation: leg.allocation.toString(10),
      route: routeTuple(routeFromLeg(leg)),
    })));
    if (!proposals.has(key)) proposals.set(key, receipt);
  }
  for (const routes of structure.candidateSets) {
    counters.equalProposalReplays += 1;
    const replay = replaySplit(poolsById, routes, equalAllocations(exact(request.amountIn), 2));
    if (replay === undefined) counters.equalProposalRejections += 1;
    else collect(replay);
  }
  for (const routes of structure.candidateSets) {
    const allocations = [0n, 0n];
    let finalProposal: SplitReceipt | undefined;
    let abandoned = false;
    for (const chunk of positiveChunks(exact(request.amountIn), 16)) {
      let winningIndex: number | undefined;
      let winningReceipt: SplitReceipt | undefined;
      for (let index = 0; index < routes.length; index += 1) {
        counters.greedyOptionReplays += 1;
        const option = [...allocations];
        option[index] = (option[index] ?? 0n) + chunk;
        const replay = replaySplit(poolsById, routes, option);
        if (replay === undefined) {
          counters.greedyOptionRejections += 1;
          continue;
        }
        if (winningReceipt === undefined || replay.amountOut > winningReceipt.amountOut) {
          winningIndex = index;
          winningReceipt = replay;
        }
      }
      if (winningIndex === undefined || winningReceipt === undefined) {
        abandoned = true;
        break;
      }
      allocations[winningIndex] = (allocations[winningIndex] ?? 0n) + chunk;
      finalProposal = winningReceipt;
    }
    if (!abandoned && finalProposal !== undefined) collect(finalProposal);
  }
  const orderedProposals = [...proposals.values()].sort((left, right) => {
    const comparison = compareReceipt(left, right);
    return comparison === 0 ? 0 : comparison > 0 ? -1 : 1;
  });
  for (const proposal of orderedProposals) {
    if (incumbent !== undefined && compareReceipt(proposal, incumbent) <= 0) continue;
    counters.finalAuthorizationReplays += 1;
    const routes = proposal.legs.map(routeFromLeg);
    const allocations = proposal.legs.map(({ allocation }) => allocation);
    const authorization = replaySplit(poolsById, routes, allocations);
    if (authorization === undefined) counters.finalAuthorizationRejections += 1;
    else if (incumbent === undefined || compareReceipt(authorization, incumbent) > 0) {
      incumbent = authorization;
    }
  }
  assert.ok(incumbent);
  return {
    receipt: incumbent,
    counters: Object.fromEntries(BASELINE_COUNTER_FIELDS.map((field) => [field, counters[field]])),
  };
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function primitive(a: bigint, b: bigint, c: bigint): readonly [bigint, bigint, bigint] {
  const divisor = gcd(gcd(a, b), c);
  assert.ok(divisor > 0n);
  return [a / divisor, b / divisor, c / divisor];
}

function normalizedPositiveRational(numerator: bigint, denominator: bigint): number {
  assert.ok(numerator > 0n && denominator > 0n);
  const divisor = gcd(numerator, denominator);
  const n = numerator / divisor;
  const d = denominator / divisor;
  function normalizedInteger(value: bigint): readonly [number, number] {
    const binary = value.toString(2);
    const width = Math.min(53, binary.length);
    let prefix = 0;
    for (let index = 0; index < width; index += 1) {
      prefix = (prefix * 2) + (binary[index] === '1' ? 1 : 0);
    }
    return [prefix / (2 ** (width - 1)), binary.length - 1];
  }
  const [nSignificand, nExponent] = normalizedInteger(n);
  const [dSignificand, dExponent] = normalizedInteger(d);
  const value = (nSignificand / dSignificand) * (2 ** (nExponent - dExponent));
  assert.equal(Number.isFinite(value), true);
  assert.ok(value >= 2 ** -1022);
  return value;
}

function routeModel(
  poolsById: ReadonlyMap<string, Pool>,
  route: Route,
  amountIn: bigint,
): readonly [number, number] {
  let coefficients: readonly [bigint, bigint, bigint] | undefined;
  for (const hop of route) {
    const pool = poolsById.get(hop.poolId);
    assert.ok(pool);
    let reserveIn: bigint;
    let reserveOut: bigint;
    if (hop.assetIn === pool.asset0 && hop.assetOut === pool.asset1) {
      reserveIn = pool.reserve0;
      reserveOut = pool.reserve1;
    } else {
      assert.equal(hop.assetIn, pool.asset1);
      assert.equal(hop.assetOut, pool.asset0);
      reserveIn = pool.reserve1;
      reserveOut = pool.reserve0;
    }
    const multiplier = pool.feeDenominator - pool.feeChargedNumerator;
    const next = primitive(
      multiplier * reserveOut,
      pool.feeDenominator * reserveIn,
      multiplier,
    );
    coefficients = coefficients === undefined
      ? next
      : primitive(
        coefficients[0] * next[0],
        coefficients[1] * next[1],
        (next[1] * coefficients[2]) + (next[2] * coefficients[0]),
      );
  }
  assert.ok(coefficients);
  return [
    normalizedPositiveRational(coefficients[0], coefficients[1]),
    normalizedPositiveRational(coefficients[2] * amountIn, coefficients[1]),
  ];
}

function routeShare(s: number, q: number, lambda: number): number {
  if (lambda >= s) return 0;
  const onePlusQ = 1 + q;
  const marginalAtOne = s / (onePlusQ * onePlusQ);
  if (lambda <= marginalAtOne) return 1;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const mid = (lower + upper) / 2;
    const denominator = 1 + (q * mid);
    const marginal = s / (denominator * denominator);
    if (marginal > lambda) lower = mid;
    else upper = mid;
  }
  return (lower + upper) / 2;
}

function solveWeights(models: readonly (readonly [number, number])[]): readonly number[] | undefined {
  let lambdaLower = 0;
  let lambdaUpper = Math.max(...models.map(([s]) => s));
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const lambda = lambdaLower + ((lambdaUpper - lambdaLower) / 2);
    const sum = models.reduce((total, [s, q]) => total + routeShare(s, q, lambda), 0);
    assert.equal(Number.isFinite(sum), true);
    if (sum > 1) lambdaLower = lambda;
    else lambdaUpper = lambda;
  }
  const lambda = lambdaLower + ((lambdaUpper - lambdaLower) / 2);
  const weights = models.map(([s, q]) => routeShare(s, q, lambda));
  const sum = weights.reduce((total, value) => total + value, 0);
  const difference = sum - 1;
  const absoluteDifference = difference < 0 ? -difference : difference;
  return absoluteDifference <= NUMERICAL_CONFIGURATION.convergenceTolerance ? weights : undefined;
}

function reconstructAllocations(
  weights: readonly number[],
  amountIn: bigint,
): { readonly allocations: readonly bigint[]; readonly residual: bigint } {
  const decoded = weights.map((weight): { readonly significand: bigint; readonly exponent: number } | undefined => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, weight, false);
    const bits = view.getBigUint64(0, false);
    assert.equal(bits >> 63n, 0n);
    const exponentBits = Number((bits >> 52n) & 0x7ffn);
    const fraction = bits & ((1n << 52n) - 1n);
    if (exponentBits === 0 && fraction === 0n) return undefined;
    assert.ok(exponentBits > 0 && exponentBits < 2047);
    return {
      significand: (1n << 52n) + fraction,
      exponent: exponentBits - 1023 - 52,
    };
  });
  const positive = decoded.filter((value): value is NonNullable<typeof value> => value !== undefined);
  assert.ok(positive.length > 0);
  const commonExponent = Math.min(...positive.map(({ exponent }) => exponent));
  const integerWeights = decoded.map((value) => value === undefined
    ? 0n
    : value.significand << BigInt(value.exponent - commonExponent));
  const totalWeight = integerWeights.reduce((sum, value) => sum + value, 0n);
  assert.ok(totalWeight > 0n);
  const allocations = integerWeights.map((weight) => (amountIn * weight) / totalWeight);
  const baseTotal = allocations.reduce((sum, value) => sum + value, 0n);
  assert.ok(baseTotal <= amountIn);
  return { allocations, residual: amountIn - baseTotal };
}

function projectRouteReceipt(receipt: RouteReceipt): JsonRecord {
  return {
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn.toString(10),
    amountOut: receipt.amountOut.toString(10),
    hops: receipt.hops.map((hop) => ({
      poolId: hop.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn: hop.amountIn.toString(10),
      amountOut: hop.amountOut.toString(10),
      reserveInBefore: hop.reserveInBefore.toString(10),
      reserveOutBefore: hop.reserveOutBefore.toString(10),
      reserveInAfter: hop.reserveInAfter.toString(10),
      reserveOutAfter: hop.reserveOutAfter.toString(10),
    })),
  };
}

function projectSplitReceipt(receipt: SplitReceipt): JsonRecord {
  return {
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn.toString(10),
    amountOut: receipt.amountOut.toString(10),
    legs: receipt.legs.map((leg) => ({
      allocation: leg.allocation.toString(10),
      receipt: projectRouteReceipt(leg.receipt),
    })),
  };
}

function objectiveProjection(receipt: SplitReceipt): JsonRecord {
  const value = objective(receipt);
  return {
    status: 'authorized',
    tuple: {
      amountOut: value.amountOut.toString(10),
      legCount: value.routes.length,
      totalHops: value.totalHops,
      routeSequence: value.routes.map((route) => route.map(({ assetIn, poolId, assetOut }) => ({
        assetIn,
        poolId,
        assetOut,
      }))),
      allocations: value.allocations.map((allocation) => allocation.toString(10)),
    },
  };
}

function routesAndAllocationsFromProjectedReceipt(
  projected: JsonRecord,
): { readonly routes: readonly Route[]; readonly allocations: readonly bigint[] } {
  const legs = array(projected['legs']);
  return {
    routes: legs.map((value): Route => {
      const leg = record(value);
      const routeReceipt = record(leg['receipt']);
      return array(routeReceipt['hops']).map((hopValue): Hop => {
        const hop = record(hopValue);
        return {
          assetIn: String(hop['assetIn']),
          poolId: String(hop['poolId']),
          assetOut: String(hop['assetOut']),
        };
      });
    }),
    allocations: legs.map((value) => exact(record(value)['allocation'])),
  };
}

function assertFreshReceipt(
  poolsById: ReadonlyMap<string, Pool>,
  projected: JsonRecord,
): SplitReceipt {
  const { routes, allocations } = routesAndAllocationsFromProjectedReceipt(projected);
  const replay = replaySplit(poolsById, routes, allocations);
  assert.ok(replay);
  assert.deepEqual(projectSplitReceipt(replay), projected);
  assert.equal(allocations.reduce((sum, value) => sum + value, 0n), exact(projected['amountIn']));
  return replay;
}

function numericalEvaluation(
  poolsById: ReadonlyMap<string, Pool>,
  request: RequestJson,
  structure: StructuralResult,
  baselineReceipt: SplitReceipt,
  baselineCounters: JsonRecord,
): {
  readonly result: JsonRecord;
  readonly receipt: SplitReceipt;
  readonly diagnostics: readonly JsonRecord[];
  readonly counters: JsonRecord;
} {
  const amountIn = exact(request.amountIn);
  let incumbent = baselineReceipt;
  const counters = zeroCounters();
  for (const field of BASELINE_COUNTER_FIELDS) counters[field] = safeInteger(baselineCounters[field]);
  const diagnostics: JsonRecord[] = [];

  for (const routes of structure.candidateSets) {
    counters.numericalProposals += 1;
    counters.numericalIterations += 64;
    const diagnosticCounters = {
      numericalProposals: 1,
      numericalProposalFailures: 0,
      numericalIterations: 64,
      numericalResidualReplays: 0,
      numericalResidualReplayRejections: 0,
      numericalAuthorizationReplays: 0,
      numericalAuthorizationReplayRejections: 0,
    };
    const identity = {
      candidateSetKey: candidateSetKey(routes),
      routeKeys: routes.map(routeKey),
    };
    const weights = solveWeights(routes.map((route) => routeModel(poolsById, route, amountIn)));
    if (weights === undefined) {
      counters.numericalProposalFailures += 1;
      diagnosticCounters.numericalProposalFailures = 1;
      diagnostics.push({
        ...identity,
        status: 'failed',
        failureCode: 'non-convergence',
        converged: false,
        completedOuterIterations: 64,
        configuredInnerIterations: 64,
        residualUnits: null,
        counters: diagnosticCounters,
      });
      continue;
    }
    const reconstructed = reconstructAllocations(weights, amountIn);
    assert.ok(reconstructed.residual < 2n);
    const allocations = [...reconstructed.allocations];
    let score: SplitReceipt | undefined;
    let exhausted = false;
    if (reconstructed.residual === 0n) {
      counters.numericalResidualReplays += 1;
      diagnosticCounters.numericalResidualReplays += 1;
      score = replaySplit(poolsById, routes, allocations);
      if (score === undefined) {
        counters.numericalResidualReplayRejections += 1;
        diagnosticCounters.numericalResidualReplayRejections += 1;
        exhausted = true;
      }
    } else {
      for (let unit = 0n; unit < reconstructed.residual; unit += 1n) {
        let winner: { readonly index: number; readonly receipt: SplitReceipt } | undefined;
        for (let index = 0; index < routes.length; index += 1) {
          const option = [...allocations];
          option[index] = (option[index] ?? 0n) + 1n;
          counters.numericalResidualReplays += 1;
          diagnosticCounters.numericalResidualReplays += 1;
          const replay = replaySplit(poolsById, routes, option);
          if (replay === undefined) {
            counters.numericalResidualReplayRejections += 1;
            diagnosticCounters.numericalResidualReplayRejections += 1;
            continue;
          }
          if (winner === undefined || compareReceipt(replay, winner.receipt) > 0) {
            winner = { index, receipt: replay };
          }
        }
        if (winner === undefined) {
          exhausted = true;
          break;
        }
        allocations[winner.index] = (allocations[winner.index] ?? 0n) + 1n;
        score = winner.receipt;
      }
    }
    if (exhausted || score === undefined) {
      diagnostics.push({
        ...identity,
        status: 'failed',
        failureCode: 'residual-options-exhausted',
        converged: true,
        completedOuterIterations: 64,
        configuredInnerIterations: 64,
        residualUnits: reconstructed.residual.toString(10),
        counters: diagnosticCounters,
      });
      continue;
    }
    if (compareReceipt(score, incumbent) <= 0) {
      diagnostics.push({
        ...identity,
        status: 'not-better',
        failureCode: null,
        converged: true,
        completedOuterIterations: 64,
        configuredInnerIterations: 64,
        residualUnits: reconstructed.residual.toString(10),
        counters: diagnosticCounters,
      });
      continue;
    }

    counters.numericalAuthorizationReplays += 1;
    diagnosticCounters.numericalAuthorizationReplays += 1;
    const authorization = replaySplit(poolsById, routes, allocations);
    assert.ok(authorization);
    assert.deepEqual(projectSplitReceipt(authorization), projectSplitReceipt(score));
    assert.ok(compareReceipt(authorization, incumbent) > 0);
    incumbent = authorization;
    diagnostics.push({
      ...identity,
      status: 'improved',
      failureCode: null,
      converged: true,
      completedOuterIterations: 64,
      configuredInnerIterations: 64,
      residualUnits: reconstructed.residual.toString(10),
      counters: diagnosticCounters,
    });
  }

  const projectedCounters = Object.fromEntries(COUNTER_FIELDS.map((field) => [field, counters[field]]));
  return {
    receipt: incumbent,
    diagnostics,
    counters: projectedCounters,
    result: {
      status: 'success',
      plan: {
        receipt: projectSplitReceipt(incumbent),
        search: {
          counters: projectedCounters,
          termination: 'complete',
          numericalDiagnostics: diagnostics,
        },
      },
    },
  };
}

function inputBinding(): JsonRecord {
  return {
    datasetId: DATASET_ID,
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_CHECKSUM,
    corpusId: CORPUS_ID,
    corpusSha256: CORPUS_SHA256,
    baselineEvaluationId: BASELINE_EVALUATION_ID,
    baselineComparisonConfigId: BASELINE_CONFIG_ID,
    baselineComparisonConfigSha256: BASELINE_CONFIG_SHA256,
    baselineSemanticResultsSchemaVersion: 'routelab.composed-historical-semantic-results.v3',
    baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
  };
}

function profileCaps(
  baselineProfile: JsonRecord,
): { readonly profileId: string; readonly workCaps: JsonRecord } {
  const baselineCaps = record(baselineProfile['workCaps']);
  const equalCap = safeInteger(baselineCaps['maxEqualProposalReplays']);
  return {
    profileId: String(baselineProfile['profileId']),
    workCaps: {
      ...Object.fromEntries(BASELINE_CAP_FIELDS.map((field) => [field, safeInteger(baselineCaps[field])])),
      maxNumericalProposals: equalCap,
      maxNumericalIterations: 64 * equalCap,
      maxNumericalResidualReplays: 2 * equalCap,
      maxNumericalAuthorizationReplays: equalCap,
    },
  };
}

function expectedConfig(baselineConfig: JsonRecord): JsonRecord {
  const profiles = array(baselineConfig['profiles']).map((value) => profileCaps(record(value)));
  return {
    schemaVersion: 'routelab.numerical-historical-comparison-config.v1',
    comparisonConfigId: COMPARISON_CONFIG_ID,
    inputBinding: {
      ...inputBinding(),
      eligibility: {
        path: 'fixtures/m7/numerical-historical/eligibility.v1.json',
        schemaVersion: 'routelab.numerical-historical-eligibility.v1',
        eligibilityId: ELIGIBILITY_ID,
        bytes: 261_915,
        sha256: ELIGIBILITY_SHA256,
      },
    },
    runtime: {
      entryPoint: 'routeExactInputSplitNumericalAnytime',
      preparedContext: 'one-verified-context-shared-across-all-runs',
      request: {
        maxHops: 2,
        maxRoutes: 2,
        greedyParts: 16,
        numerical: NUMERICAL_CONFIGURATION,
      },
      controlMode: 'deterministic-work-caps-only-no-interruption-no-deadline',
    },
    schedule: {
      semanticOrder: 'corpus-request-then-declared-profile',
      profileOrder: PROFILE_IDS,
    },
    profiles,
    comparison: {
      kind: 'identical-input-baseline-versus-numerical-path-allocation',
      baselineCellReference: 'same-request-id-profile-id-and-semantic-hash',
      eligibilityRule: 'frozen-all-cell-first-applicable-reason',
      resultRetention: 'all-2376-cells',
      objectiveComparison: 'exact-split-objective-per-request-profile',
      outputAggregation: 'none-across-assets',
      modeDecision: {
        modes: ['primary', 'experimental'],
        requiredClauses: [
          'no-eligible-objective-regressions',
          'forced-failures-preserve-baseline',
          'all-eligible-candidate-sets-have-terminal-diagnostics',
          'at-least-one-eligible-request-strictly-improves-exact-output',
        ],
      },
    },
  };
}

function expectedManifest(summary: JsonRecord): JsonRecord {
  const decision = record(summary['decision']);
  return {
    schemaVersion: 'routelab.numerical-historical-evaluation-manifest.v1',
    evaluationId: EVALUATION_ID,
    inputBinding: {
      datasetId: DATASET_ID,
      snapshotId: DATASET_ID,
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      corpusId: CORPUS_ID,
      corpusSha256: CORPUS_SHA256,
      baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
    },
    runtime: {
      entryPoint: 'routeExactInputSplitNumericalAnytime',
      implementationRevision: IMPLEMENTATION_REVISION,
    },
    artifacts: {
      comparisonConfig: {
        path: 'fixtures/m7/numerical-historical/comparison-config.v1.json',
        bytes: 4_650,
        sha256: COMPARISON_CONFIG_SHA256,
      },
      eligibility: {
        path: 'fixtures/m7/numerical-historical/eligibility.v1.json',
        bytes: 261_915,
        sha256: ELIGIBILITY_SHA256,
      },
      semanticResults: {
        path: 'semantic-results.json',
        bytes: 21_697_979,
        sha256: SEMANTIC_SHA256,
      },
    },
    counts: {
      requestCount: 396,
      profileCount: 6,
      cellCount: 2_376,
      eligibleCellCount: 414,
      ineligibleCellCount: 1_962,
    },
    decision,
    limitations: LIMITATIONS,
  };
}

void test('independently reconstructs the frozen historical numerical evaluation', () => {
  const snapshotRaw = parse(`${DATASET}/snapshot.json`);
  assert.equal(snapshotRaw['snapshotId'], DATASET_ID);
  assert.equal(snapshotRaw['snapshotChecksum'], SNAPSHOT_CHECKSUM);
  const pools = parsePools(snapshotRaw);
  assert.equal(pools.length, 54);
  const poolsById = new Map(pools.map((pool) => [pool.poolId, pool]));

  const requestsRaw = text(`${CORPUS}/requests.json`);
  assert.equal(Buffer.byteLength(requestsRaw), 99_301);
  assert.equal(sha256(requestsRaw), CORPUS_SHA256);
  const requestsDocument = record(JSON.parse(requestsRaw) as unknown);
  const requests = array(requestsDocument['requests']) as unknown as readonly RequestJson[];
  assert.equal(requests.length, 396);

  const baselineRaw = text(`${BASELINE}/semantic-results.json`);
  assert.equal(sha256(baselineRaw), BASELINE_SEMANTIC_SHA256);
  assert.equal(JSON.stringify(JSON.parse(baselineRaw) as unknown), baselineRaw);
  const baselineDocument = record(JSON.parse(baselineRaw) as unknown);
  const baselineCells = array(baselineDocument['cells']).map(record);
  assert.equal(baselineCells.length, 2_376);
  const baselineConfigRaw = text('fixtures/m6/composed-historical/comparison-config.v3.json');
  assert.equal(sha256(baselineConfigRaw), BASELINE_CONFIG_SHA256);
  const baselineConfig = record(JSON.parse(baselineConfigRaw) as unknown);

  const configRaw = text(`${FIXTURES}/comparison-config.v1.json`);
  assert.equal(Buffer.byteLength(configRaw), 4_650);
  assert.equal(sha256(configRaw), COMPARISON_CONFIG_SHA256);
  assert.equal(configRaw.endsWith('\n'), false);
  const config = expectedConfig(baselineConfig);
  assert.equal(JSON.stringify(config), configRaw);
  const profiles = array(config['profiles']).map(record);
  for (const profile of profiles) {
    assert.deepEqual(
      Object.keys(record(profile['workCaps'])),
      [...BASELINE_CAP_FIELDS, ...NUMERICAL_CAP_FIELDS],
    );
  }
  assert.deepEqual(
    profiles.map((profile) => Object.values(record(profile['workCaps'])).slice(6)),
    [[0, 0, 0, 0], [4, 256, 8, 4], [7, 448, 14, 7], [14, 896, 28, 14],
      [28, 1_792, 56, 28], [55, 3_520, 110, 55]],
  );
  assert.equal(NUMERICAL_CONFIGURATION.convergenceTolerance, 9.094947017729282e-13);
  const toleranceBuffer = new ArrayBuffer(8);
  const toleranceView = new DataView(toleranceBuffer);
  toleranceView.setFloat64(0, NUMERICAL_CONFIGURATION.convergenceTolerance, false);
  assert.equal(toleranceView.getBigUint64(0, false), 0x3d70_0000_0000_0000n);

  const structures = new Map<string, StructuralResult>();
  for (const request of requests) {
    structures.set(request.requestId, discoverStructure(pools, request));
  }
  assert.deepEqual(
    [...structures.values()].reduce((range, value) => [
      Math.min(range[0] ?? Infinity, value.paths.length),
      Math.max(range[1] ?? -Infinity, value.paths.length),
      Math.min(range[2] ?? Infinity, value.pathExpansions),
      Math.max(range[3] ?? -Infinity, value.pathExpansions),
      Math.min(range[4] ?? Infinity, value.candidateSets.length),
      Math.max(range[5] ?? -Infinity, value.candidateSets.length),
      Math.min(range[6] ?? Infinity, value.candidateSetExpansions),
      Math.max(range[7] ?? -Infinity, value.candidateSetExpansions),
    ], [] as number[]),
    [5, 11, 57, 102, 10, 55, 20, 110],
  );

  const expectedEligibilityCells: JsonRecord[] = [];
  const reasonCounts: Record<(typeof REASONS)[number], number> = {
    'baseline-no-authorized-incumbent': 0,
    'path-discovery-incomplete': 0,
    'candidate-set-discovery-incomplete': 0,
    'no-model-valid-candidate-set': 0,
  };
  let eligibleCount = 0;
  for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
    const request = requests[requestIndex];
    assert.ok(request);
    const structure = structures.get(request.requestId);
    assert.ok(structure);
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
      const profile = profiles[profileIndex];
      const baselineCell = baselineCells[(requestIndex * profiles.length) + profileIndex];
      assert.ok(profile && baselineCell);
      assert.equal(baselineCell['requestId'], request.requestId);
      assert.equal(baselineCell['profileId'], profile['profileId']);
      const baselineResult = record(baselineCell['result']);
      const caps = record(profile['workCaps']);
      let reason: (typeof REASONS)[number] | undefined;
      if (baselineResult['status'] !== 'success') reason = 'baseline-no-authorized-incumbent';
      else if (safeInteger(caps['maxPathExpansions']) < structure.pathExpansions) {
        reason = 'path-discovery-incomplete';
      } else if (safeInteger(caps['maxCandidateSetExpansions']) < structure.candidateSetExpansions) {
        reason = 'candidate-set-discovery-incomplete';
      } else if (structure.candidateSets.length === 0) {
        reason = 'no-model-valid-candidate-set';
      }
      if (reason === undefined) {
        eligibleCount += 1;
        expectedEligibilityCells.push({
          requestId: request.requestId,
          profileId: profile['profileId'],
          status: 'eligible',
        });
      } else {
        reasonCounts[reason] += 1;
        expectedEligibilityCells.push({
          requestId: request.requestId,
          profileId: profile['profileId'],
          status: 'ineligible',
          reason,
        });
      }
    }
  }
  assert.equal(eligibleCount, 414);
  assert.deepEqual(reasonCounts, {
    'baseline-no-authorized-incumbent': 111,
    'path-discovery-incomplete': 1_851,
    'candidate-set-discovery-incomplete': 0,
    'no-model-valid-candidate-set': 0,
  });
  const expectedEligibility = {
    schemaVersion: 'routelab.numerical-historical-eligibility.v1',
    eligibilityId: ELIGIBILITY_ID,
    inputBinding: inputBinding(),
    schedule: {
      semanticOrder: 'corpus-request-then-declared-profile',
      profileOrder: PROFILE_IDS,
    },
    classification: {
      maxHops: 2,
      maxRoutes: 2,
      reasonPrecedence: REASONS,
      counts: {
        cellCount: 2_376,
        eligible: 414,
        ineligible: 1_962,
        reasons: reasonCounts,
      },
    },
    cells: expectedEligibilityCells,
  };
  const eligibilityRaw = text(`${FIXTURES}/eligibility.v1.json`);
  assert.equal(Buffer.byteLength(eligibilityRaw), 261_915);
  assert.equal(sha256(eligibilityRaw), ELIGIBILITY_SHA256);
  assert.equal(eligibilityRaw.endsWith('\n'), false);
  assert.equal(JSON.stringify(expectedEligibility), eligibilityRaw);

  const semanticRaw = text(`${EVALUATION}/semantic-results.json`);
  assert.equal(Buffer.byteLength(semanticRaw), 21_697_979);
  assert.equal(sha256(semanticRaw), SEMANTIC_SHA256);
  assert.equal(semanticRaw.endsWith('\n'), false);
  assert.equal(semanticRaw.includes('implementationRevision'), false);
  const retainedSemantic = record(JSON.parse(semanticRaw) as unknown);
  assertNoObservationKeys(retainedSemantic);
  const retainedCells = array(retainedSemantic['cells']).map(record);
  assert.equal(retainedCells.length, 2_376);

  const totals = zeroCounters();
  const maxima = zeroCounters();
  const relationCounts = { 'strictly-improved': 0, equal: 0, regressed: 0 };
  const statusCounts: Record<string, number> = {};
  const failureCounts: Record<string, number> = {};
  const strictlyImprovedRequests = new Set<string>();
  const expectedCells: JsonRecord[] = [];
  let terminalDiagnostics = true;

  for (let index = 0; index < expectedEligibilityCells.length; index += 1) {
    const request = requests[Math.floor(index / profiles.length)];
    const profile = profiles[index % profiles.length];
    const baselineCell = baselineCells[index];
    const eligibilityCell = expectedEligibilityCells[index];
    const retainedCell = retainedCells[index];
    assert.ok(request && profile && baselineCell && eligibilityCell && retainedCell);
    const baselineResult = record(baselineCell['result']);
    let baselineReceipt: SplitReceipt | undefined;
    let baselineObjective: JsonRecord;
    if (baselineResult['status'] === 'success') {
      const plan = record(baselineResult['plan']);
      baselineReceipt = assertFreshReceipt(poolsById, record(plan['receipt']));
      baselineObjective = objectiveProjection(baselineReceipt);
    } else {
      baselineObjective = { status: 'no-authorized-incumbent', tuple: null };
    }
    const common = {
      request: {
        requestId: request.requestId,
        amountBucket: request.amountBucket,
        topology: request.topology,
        assetIn: request.assetIn,
        assetOut: request.assetOut,
        amountIn: request.amountIn,
      },
      profile: {
        profileId: profile['profileId'],
        workCaps: profile['workCaps'],
      },
      numericalConfiguration: NUMERICAL_CONFIGURATION,
      baseline: {
        evaluationId: BASELINE_EVALUATION_ID,
        semanticHash: baselineCell['semanticHash'],
        objective: baselineObjective,
      },
      eligibility: eligibilityCell['status'] === 'eligible'
        ? { status: 'eligible' }
        : { status: 'ineligible', reason: eligibilityCell['reason'] },
    };
    const hashBinding = {
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      corpusSha256: CORPUS_SHA256,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
      eligibilitySha256: ELIGIBILITY_SHA256,
      baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
    };

    if (eligibilityCell['status'] !== 'eligible') {
      assert.equal('result' in retainedCell, false);
      const hashValue = {
        schemaVersion: 'routelab.numerical-historical-semantic-cell.v1',
        inputBinding: hashBinding,
        ...common,
        objectiveRelation: 'not-evaluated',
      };
      expectedCells.push({
        ...common,
        objectiveRelation: 'not-evaluated',
        semanticHash: sha256(JSON.stringify(hashValue)),
      });
      continue;
    }

    assert.ok(baselineReceipt);
    const structure = structures.get(request.requestId);
    assert.ok(structure);
    const baselinePlan = record(baselineResult['plan']);
    const baselineSearch = record(baselinePlan['search']);
    const baselineCounters = record(baselineSearch['counters']);
    const reconstructedBaseline = reconstructBaseline(poolsById, request, structure);
    assert.deepEqual(projectSplitReceipt(reconstructedBaseline.receipt), projectSplitReceipt(baselineReceipt));
    assert.deepEqual(reconstructedBaseline.counters, baselineCounters);

    const numerical = numericalEvaluation(
      poolsById,
      request,
      structure,
      reconstructedBaseline.receipt,
      reconstructedBaseline.counters,
    );
    const retainedResult = record(retainedCell['result']);
    assert.deepEqual(numerical.result, retainedResult);
    const relationComparison = compareReceipt(numerical.receipt, reconstructedBaseline.receipt);
    const relation = relationComparison > 0 ? 'strictly-improved'
      : relationComparison === 0 ? 'equal' : 'regressed';
    relationCounts[relation] += 1;
    assert.ok(numerical.receipt.amountOut >= reconstructedBaseline.receipt.amountOut);
    if (numerical.receipt.amountOut > reconstructedBaseline.receipt.amountOut) {
      strictlyImprovedRequests.add(request.requestId);
    }
    for (const field of COUNTER_FIELDS) {
      const value = safeInteger(numerical.counters[field]);
      totals[field] += value;
      maxima[field] = Math.max(maxima[field], value);
    }
    for (const diagnostic of numerical.diagnostics) {
      const status = String(diagnostic['status']);
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const failureCode = diagnostic['failureCode'];
      if (failureCode !== null) {
        assert.equal(typeof failureCode, 'string');
        const code = failureCode as string;
        failureCounts[code] = (failureCounts[code] ?? 0) + 1;
      }
      terminalDiagnostics &&= ['failed', 'not-better', 'improved'].includes(status)
        && safeInteger(diagnostic['completedOuterIterations']) === 64
        && safeInteger(diagnostic['configuredInnerIterations']) === 64;
    }
    assert.equal(numerical.diagnostics.length, structure.candidateSets.length);
    const hashValue = {
      schemaVersion: 'routelab.numerical-historical-semantic-cell.v1',
      inputBinding: hashBinding,
      ...common,
      objectiveRelation: relation,
      result: numerical.result,
    };
    expectedCells.push({
      ...common,
      objectiveRelation: relation,
      semanticHash: sha256(JSON.stringify(hashValue)),
      result: numerical.result,
    });
  }

  assert.deepEqual(relationCounts, { 'strictly-improved': 318, equal: 96, regressed: 0 });
  assert.deepEqual(statusCounts, { failed: 2_868, 'not-better': 7_664, improved: 496 });
  assert.deepEqual(failureCounts, { 'non-convergence': 1_381, 'residual-options-exhausted': 1_487 });
  assert.equal(strictlyImprovedRequests.size, 307);
  assert.equal(terminalDiagnostics, true);
  const clauses = {
    noEligibleObjectiveRegressions: relationCounts.regressed === 0,
    forcedFailuresPreserveBaseline: true,
    allEligibleCandidateSetsHaveTerminalDiagnostics: terminalDiagnostics,
    atLeastOneEligibleRequestStrictlyImprovesExactOutput: strictlyImprovedRequests.size > 0,
  };
  assert.deepEqual(clauses, {
    noEligibleObjectiveRegressions: true,
    forcedFailuresPreserveBaseline: true,
    allEligibleCandidateSetsHaveTerminalDiagnostics: true,
    atLeastOneEligibleRequestStrictlyImprovesExactOutput: true,
  });
  const summary = {
    eligibility: {
      eligible: 414,
      ineligible: 1_962,
      reasons: reasonCounts,
    },
    objectiveRelations: relationCounts,
    diagnostics: {
      statuses: statusCounts,
      failureCodes: failureCounts,
    },
    work: {
      counterTotals: Object.fromEntries(COUNTER_FIELDS.map((field) => [field, totals[field]])),
      counterMaxima: Object.fromEntries(COUNTER_FIELDS.map((field) => [field, maxima[field]])),
    },
    strictlyImprovedRequestCount: strictlyImprovedRequests.size,
    decision: { mode: 'primary', clauses },
  };
  const expectedSemantic = {
    schemaVersion: 'routelab.numerical-historical-semantic-results.v1',
    evaluationId: EVALUATION_ID,
    inputBinding: {
      datasetId: DATASET_ID,
      snapshotId: DATASET_ID,
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      corpusId: CORPUS_ID,
      corpusSha256: CORPUS_SHA256,
      comparisonConfigId: COMPARISON_CONFIG_ID,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
      eligibilityId: ELIGIBILITY_ID,
      eligibilitySha256: ELIGIBILITY_SHA256,
      baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
    },
    schedule: {
      semanticOrder: 'corpus-request-then-declared-profile',
      requestCount: 396,
      profileCount: 6,
      cellCount: 2_376,
      profileOrder: PROFILE_IDS,
    },
    cells: expectedCells,
    summary,
    limitations: LIMITATIONS,
  };
  assert.equal(JSON.stringify(expectedSemantic), semanticRaw);

  const manifestRaw = text(`${EVALUATION}/manifest.json`);
  assert.equal(Buffer.byteLength(manifestRaw), 2_275);
  assert.equal(sha256(manifestRaw), MANIFEST_SHA256);
  assert.equal(manifestRaw.endsWith('\n'), false);
  assert.equal(JSON.stringify(expectedManifest(summary)), manifestRaw);
  assert.deepEqual(
    readdirSync(absolute(EVALUATION)).sort(compareRaw),
    ['README.md', 'manifest.json', 'semantic-results.json'],
  );

  const inputReadme = text(`${FIXTURES}/README.md`);
  const resultReadme = text(`${EVALUATION}/README.md`);
  const normalizedInputReadme = inputReadme.replace(/\s+/gu, ' ');
  const normalizedResultReadme = resultReadme.replace(/\s+/gu, ' ');
  for (const claim of [
    'Exactly 414 cells are eligible',
    '111 have no authorized',
    '1,851 have incomplete path discovery',
    '64 outer iterations',
    '64 inner iterations',
    'binary64 value `2^-40`',
    '55, 3,520, 110, and 55',
  ]) assert.equal(normalizedInputReadme.includes(claim), true, claim);
  for (const claim of [
    '414 cells were eligible and executed exactly once',
    '1,962 ineligible cells',
    '318 eligible cells improved',
    '96 were equal',
    'none regressed',
    '307 distinct requests',
    '11,028 terminal candidate diagnostics',
    '496 improved',
    '7,664 not-better',
    '2,868 failed proposals',
    '1,381 non-convergences',
    '1,487 exhausted exact residual-option scans',
    'records numerical mode as `primary`',
    'never added across assets',
    'The evidence supports no latency, speedup, representative-demand, unrestricted or discrete global-optimality',
  ]) assert.equal(normalizedResultReadme.includes(claim), true, claim);
  assert.equal(resultReadme.includes('observations.json'), false);
  assert.equal(array(record(parse(`${EVALUATION}/manifest.json`))['limitations']).length, 5);

  const forcedFailureEvidence = text('tests/oracle/numerical-exact-input-split-runtime-oracle.test.ts');
  for (const evidence of [
    'all four numerical caps stop before charge',
    'callback true, throw, and nonboolean stop at every numerical kind',
    'absolute deadline, clock failure, and one monotonic history cover every numerical kind',
    'proposal-only seam maps the three naturally unreachable core failure codes',
    'authorization seam is phase-limited and requires recursive exact receipt identity',
    'preserve or improve the exact baseline',
  ]) assert.equal(forcedFailureEvidence.includes(evidence), true, evidence);
  assert.equal(forcedFailureEvidence.includes("from '../../src/replay"), false);
  assert.equal(forcedFailureEvidence.includes("from '../../src/objective"), false);
  const ownSource = text('tests/oracle/historical-numerical-split-evaluation-oracle.test.ts');
  assert.equal(/^\s*import .* from ['"](?:\.\.\/)+src\//mu.test(ownSource), false);
});
