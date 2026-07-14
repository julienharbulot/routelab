import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateServiceFastSemanticPolicy,
  isFinalizedServiceFastCompleteOutcome,
  isFinalizedServiceFastStoppedOutcome,
  prepareServiceFastExperimentCell,
  prepareServiceFastOperationalPolicy,
  projectServiceFastSemanticResult,
  runServiceFastOperationalPolicy,
  serviceFastExperimentCallProgress,
  serviceFastExperimentCallSetSnapshot,
  serviceFastExperimentMaximumCapsForPolicy,
  validateServiceFastCompleteOutcome,
  validateServiceFastDeadlinePrefix,
  type ServiceFastExperimentActionCaps,
  type ServiceFastExperimentActionKind,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentCurrentAttempt,
  type ServiceFastExperimentOutcome,
  type ServiceFastExperimentRawCounters,
  type ServiceFastExperimentRepairAttempt,
  type ServiceFastExperimentResolvedCandidateSetInput,
} from '../../src/benchmark/service-fast-numerical-experiment/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../../src/runtime/prepared-routing-context/index.ts';

/*
 * This file deliberately does not import any proposer, reconstruction, repair,
 * replay, objective, or evidence implementation. prepareRoutingContext creates
 * only the opaque capability required by the black-box evaluator. Everything
 * used to construct an expected value below is derived locally from the frozen
 * contracts.
 */

interface OraclePool {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: bigint;
  readonly asset1: string;
  readonly reserve1: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

interface OracleSnapshot {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly pools: readonly OraclePool[];
}

interface OracleHop {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

interface OracleResolvedHop {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

type OracleRoute = readonly OracleHop[];
type OracleResolvedRoute = readonly OracleResolvedHop[];

interface OracleTransitionReceipt {
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
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

interface OracleSplitReceipt {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly legs: readonly {
    readonly allocation: bigint;
    readonly receipt: OracleRouteReceipt;
  }[];
}

interface OracleReconstruction {
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

interface OracleBisectionProposal {
  readonly actions: readonly ServiceFastExperimentActionKind[];
  readonly weights: readonly number[];
  readonly converged: boolean;
  readonly completedOuterUpdates: number;
}

interface OracleFixture {
  readonly snapshot: OracleSnapshot;
  readonly context: PreparedRoutingContext;
  readonly routes: readonly OracleRoute[];
  readonly resolvedRoutes: readonly OracleResolvedRoute[];
}

const MINIMUM_NORMAL = 2 ** -1022;
const FRACTION_MASK = (1n << 52n) - 1n;
const SIGNIFICAND_BIT = 1n << 52n;
const POLICY_CURRENT = 14;
const POLICY_REPAIR = 15;

const COUNTER_KEYS = Object.freeze([
  'methodActions',
  'outerUpdates',
  'shareActions',
  'reconstructionSteps',
  'residualReplays',
  'residualRejections',
  'repairReplays',
  'repairRejections',
  'authorizationReplays',
  'authorizationRejections',
  'proposals',
  'diagnostics',
] as const);

interface CorrectedProposalFailureEvidence {
  readonly failureCode: string;
  readonly converged: boolean;
  readonly completedOuterUpdates: number;
}

interface CorrectedCurrentAttempt extends ServiceFastExperimentCurrentAttempt {
  readonly failureCode: 'residual-options-exhausted' | null;
}

interface CorrectedRepairAttempt extends ServiceFastExperimentRepairAttempt {
  readonly failureCode: 'repair-no-valid-neighbor' | null;
}

interface CorrectedSetEvidence {
  readonly setIndex: number;
  readonly counters: ServiceFastExperimentRawCounters;
  readonly proposalFailure: CorrectedProposalFailureEvidence | null;
  readonly currentAttempts: readonly CorrectedCurrentAttempt[];
  readonly repair: null | {
    readonly attempts: readonly CorrectedRepairAttempt[];
  };
}

interface CorrectedOutcomeEvidence {
  readonly counters: ServiceFastExperimentRawCounters;
  readonly diagnostics: readonly CorrectedSetEvidence[];
  readonly setSnapshots: readonly CorrectedSetEvidence[];
}

function correctedOutcome(outcome: ServiceFastExperimentOutcome | ServiceFastExperimentCompleteOutcome):
  CorrectedOutcomeEvidence {
  return outcome;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    seen.has(value)
  ) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function assertCounterPartition(
  outcome: ServiceFastExperimentOutcome | ServiceFastExperimentCompleteOutcome,
): void {
  const corrected = correctedOutcome(outcome);
  assert.equal(corrected.setSnapshots.length > 0, true);
  const totals = Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])) as unknown as {
    -readonly [Key in typeof COUNTER_KEYS[number]]: number | null;
  };
  const methods = corrected.setSnapshots.map((snapshot) => snapshot.counters.methodActions);
  if (methods.every((value) => value === null)) totals.methodActions = null;
  else {
    assert.ok(methods.every((value) => typeof value === 'number'));
    totals.methodActions = methods.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    );
  }
  for (const key of COUNTER_KEYS) {
    if (key === 'methodActions') continue;
    totals[key] = corrected.setSnapshots.reduce(
      (sum, snapshot) => sum + snapshot.counters[key],
      0,
    );
  }
  assert.deepEqual(totals, corrected.counters);
  for (const diagnostic of corrected.diagnostics) {
    const snapshot = corrected.setSnapshots.find(
      (candidate) => candidate.setIndex === diagnostic.setIndex,
    );
    assert.notEqual(snapshot, undefined);
    assert.deepEqual(snapshot?.counters, diagnostic.counters);
    assert.notEqual(snapshot?.counters, diagnostic.counters);
    assert.deepEqual(snapshot?.proposalFailure, diagnostic.proposalFailure);
  }
  for (const snapshot of corrected.setSnapshots) {
    assertDeepFrozen(snapshot.counters);
    if (snapshot.proposalFailure !== null) assertDeepFrozen(snapshot.proposalFailure);
  }
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

function canonicalSnapshotChecksum(pools: readonly OraclePool[]): string {
  const canonicalPools = [...pools]
    .sort((left, right) => left.poolId < right.poolId ? -1 : left.poolId > right.poolId ? 1 : 0)
    .map((pool) => ({
      poolId: pool.poolId,
      asset0: pool.asset0,
      reserve0: pool.reserve0.toString(10),
      asset1: pool.asset1,
      reserve1: pool.reserve1.toString(10),
      feeChargedNumerator: pool.feeChargedNumerator.toString(10),
      feeDenominator: pool.feeDenominator.toString(10),
    }));
  return sha256Json({
    schemaVersion: 'routelab.snapshot.v1',
    pools: canonicalPools,
  });
}

function directPool(
  poolId: string,
  reserveIn: bigint,
  reserveOut: bigint = reserveIn,
): OraclePool {
  return Object.freeze({
    poolId,
    asset0: 'A',
    reserve0: reserveIn,
    asset1: 'C',
    reserve1: reserveOut,
    feeChargedNumerator: 3n,
    feeDenominator: 1_000n,
  });
}

function makeFixture(
  routeCount = 2,
  reserveIn = 10_000n,
  reserveOut = reserveIn,
): OracleFixture {
  const pools = Object.freeze(Array.from({ length: routeCount }, (_, index) =>
    directPool(`${String.fromCharCode(97 + index)}-ac`, reserveIn, reserveOut)));
  const snapshot: OracleSnapshot = Object.freeze({
    snapshotId: `service-fast-evaluator-oracle-${routeCount}-${reserveIn}`,
    snapshotChecksum: canonicalSnapshotChecksum(pools),
    pools,
  });
  const prepared = prepareRoutingContext(snapshot);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error('Expected an independently checksummed context.');
  const routes = Object.freeze(pools.map((pool) => Object.freeze([
    Object.freeze({ assetIn: 'A', poolId: pool.poolId, assetOut: 'C' }),
  ])));
  const resolvedRoutes = Object.freeze(pools.map((pool) => Object.freeze([
    Object.freeze({
      reserveIn: pool.reserve0,
      reserveOut: pool.reserve1,
      feeChargedNumerator: pool.feeChargedNumerator,
      feeDenominator: pool.feeDenominator,
    }),
  ])));
  return Object.freeze({
    snapshot,
    context: prepared.value,
    routes,
    resolvedRoutes,
  });
}

function candidateSet(
  routes: readonly OracleRoute[],
  resolvedRoutes: readonly OracleResolvedRoute[] | null,
): ServiceFastExperimentResolvedCandidateSetInput {
  return Object.freeze({
    routes,
    modelResolution: resolvedRoutes === null
      ? Object.freeze({ ok: false as const })
      : Object.freeze({ ok: true as const, resolvedRoutes }),
  });
}

function prepareCell(
  fixture: OracleFixture,
  amountIn: bigint,
  candidateSets: readonly ServiceFastExperimentResolvedCandidateSetInput[] = [
    candidateSet(fixture.routes, fixture.resolvedRoutes),
  ],
  entryIncumbent?: OracleSplitReceipt,
): ServiceFastExperimentCell {
  const repairTargetSetIndex = candidateSets.findIndex(
    (candidate) => candidate.modelResolution.ok,
  );
  return prepareServiceFastExperimentCell({
    context: fixture.context,
    snapshotId: fixture.snapshot.snapshotId,
    snapshotChecksum: fixture.snapshot.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn,
    ...(entryIncumbent === undefined ? {} : { entryIncumbent }),
    candidateSets,
    repairTargetSetIndex: repairTargetSetIndex < 0 ? null : repairTargetSetIndex,
  });
}

function completeSemantic(
  cell: ServiceFastExperimentCell,
  policyIndex: number,
): ServiceFastExperimentCompleteOutcome {
  const outcome = evaluateServiceFastSemanticPolicy(cell, policyIndex);
  assert.equal(outcome.status, 'complete');
  if (outcome.status !== 'complete') throw new Error('Expected semantic completion.');
  return outcome;
}

function caps(
  policyIndex: number,
  overrides: Partial<ServiceFastExperimentActionCaps>,
): ServiceFastExperimentActionCaps {
  return Object.freeze({
    ...serviceFastExperimentMaximumCapsForPolicy(policyIndex),
    ...overrides,
  });
}

function bigintSum(values: readonly bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

function oracleReplay(
  fixture: OracleFixture,
  routes: readonly OracleRoute[],
  allocations: readonly bigint[],
): OracleSplitReceipt | null {
  assert.equal(routes.length, allocations.length);
  const amountIn = bigintSum(allocations);
  if (amountIn <= 0n || allocations.some((allocation) => allocation < 0n)) return null;
  const pools = new Map(fixture.snapshot.pools.map((pool) => [pool.poolId, pool]));
  const legs: Array<OracleSplitReceipt['legs'][number]> = [];
  let totalOut = 0n;
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const allocation = allocations[routeIndex];
    const route = routes[routeIndex];
    if (allocation === undefined || route === undefined) return null;
    if (allocation === 0n) continue;
    let currentAmount = allocation;
    const hopReceipts: OracleTransitionReceipt[] = [];
    const localPools = new Map<string, OraclePool>();
    for (const hop of route) {
      const initialPool = pools.get(hop.poolId);
      if (initialPool === undefined) return null;
      const pool = localPools.get(hop.poolId) ?? initialPool;
      const forward = pool.asset0 === hop.assetIn && pool.asset1 === hop.assetOut;
      const reverse = pool.asset1 === hop.assetIn && pool.asset0 === hop.assetOut;
      if (!forward && !reverse) return null;
      const reserveIn = forward ? pool.reserve0 : pool.reserve1;
      const reserveOut = forward ? pool.reserve1 : pool.reserve0;
      const multiplier = pool.feeDenominator - pool.feeChargedNumerator;
      const multipliedInput = currentAmount * multiplier;
      const amountOut = (multipliedInput * reserveOut) /
        (reserveIn * pool.feeDenominator + multipliedInput);
      if (amountOut <= 0n) return null;
      const reserveInAfter = reserveIn + currentAmount;
      const reserveOutAfter = reserveOut - amountOut;
      hopReceipts.push(Object.freeze({
        poolId: pool.poolId,
        assetIn: hop.assetIn,
        assetOut: hop.assetOut,
        amountIn: currentAmount,
        amountOut,
        reserveInBefore: reserveIn,
        reserveOutBefore: reserveOut,
        reserveInAfter,
        reserveOutAfter,
      }));
      localPools.set(pool.poolId, Object.freeze({
        ...pool,
        reserve0: forward ? reserveInAfter : reserveOutAfter,
        reserve1: forward ? reserveOutAfter : reserveInAfter,
      }));
      currentAmount = amountOut;
    }
    const routeReceipt: OracleRouteReceipt = Object.freeze({
      snapshotId: fixture.snapshot.snapshotId,
      snapshotChecksum: fixture.snapshot.snapshotChecksum,
      assetIn: 'A',
      assetOut: 'C',
      amountIn: allocation,
      amountOut: currentAmount,
      hops: Object.freeze(hopReceipts),
    });
    legs.push(Object.freeze({ allocation, receipt: routeReceipt }));
    totalOut += currentAmount;
  }
  if (legs.length === 0) return null;
  return Object.freeze({
    snapshotId: fixture.snapshot.snapshotId,
    snapshotChecksum: fixture.snapshot.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn,
    amountOut: totalOut,
    legs: Object.freeze(legs),
  });
}

function compareRaw(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRoutes(left: OracleRoute, right: OracleRoute): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) throw new Error('Route index escaped.');
    const comparison = compareRaw(a.assetIn, b.assetIn) ||
      compareRaw(a.poolId, b.poolId) || compareRaw(a.assetOut, b.assetOut);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function receiptRoute(leg: OracleSplitReceipt['legs'][number]): OracleRoute {
  return leg.receipt.hops.map((hop) => ({
    assetIn: hop.assetIn,
    poolId: hop.poolId,
    assetOut: hop.assetOut,
  }));
}

function oracleCompareReceipts(
  left: OracleSplitReceipt,
  right: OracleSplitReceipt,
): -1 | 0 | 1 {
  if (left.amountOut !== right.amountOut) return left.amountOut > right.amountOut ? -1 : 1;
  if (left.legs.length !== right.legs.length) return left.legs.length < right.legs.length ? -1 : 1;
  const leftHops = left.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0);
  const rightHops = right.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0);
  if (leftHops !== rightHops) return leftHops < rightHops ? -1 : 1;
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftLeg = left.legs[index];
    const rightLeg = right.legs[index];
    if (leftLeg === undefined || rightLeg === undefined) throw new Error('Leg escaped.');
    const routeComparison = compareRoutes(receiptRoute(leftLeg), receiptRoute(rightLeg));
    if (routeComparison !== 0) return routeComparison < 0 ? -1 : 1;
  }
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftAllocation = left.legs[index]?.allocation;
    const rightAllocation = right.legs[index]?.allocation;
    if (leftAllocation === undefined || rightAllocation === undefined) {
      throw new Error('Allocation escaped.');
    }
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? -1 : 1;
  }
  return 0;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function primitiveTriple(
  a: bigint,
  b: bigint,
  c: bigint,
): readonly [bigint, bigint, bigint] {
  const divisor = greatestCommonDivisor(greatestCommonDivisor(a, b), c);
  assert.ok(divisor > 0n);
  return [a / divisor, b / divisor, c / divisor];
}

function leadingBinary(value: bigint): { readonly significand: number; readonly exponent: number } {
  const bits = value.toString(2);
  const prefix = bits.slice(0, 53);
  let integer = 0;
  for (const bit of prefix) integer = integer * 2 + (bit === '1' ? 1 : 0);
  return {
    significand: integer / 2 ** (prefix.length - 1),
    exponent: bits.length - 1,
  };
}

function normalizedRatio(numerator: bigint, denominator: bigint): number {
  const divisor = greatestCommonDivisor(numerator, denominator);
  const left = leadingBinary(numerator / divisor);
  const right = leadingBinary(denominator / divisor);
  return (left.significand / right.significand) * 2 ** (left.exponent - right.exponent);
}

function routeModel(route: OracleResolvedRoute, amountIn: bigint): {
  readonly marginalScale: number;
  readonly inputScale: number;
} {
  let coefficients: readonly [bigint, bigint, bigint] | undefined;
  for (const hop of route) {
    const multiplier = hop.feeDenominator - hop.feeChargedNumerator;
    const next = primitiveTriple(
      multiplier * hop.reserveOut,
      hop.feeDenominator * hop.reserveIn,
      multiplier,
    );
    coefficients = coefficients === undefined
      ? next
      : primitiveTriple(
          coefficients[0] * next[0],
          coefficients[1] * next[1],
          next[1] * coefficients[2] + next[2] * coefficients[0],
        );
  }
  if (coefficients === undefined) throw new Error('Empty route model.');
  return {
    marginalScale: normalizedRatio(coefficients[0], coefficients[1]),
    inputScale: normalizedRatio(coefficients[2] * amountIn, coefficients[1]),
  };
}

function bisectionShare(
  model: ReturnType<typeof routeModel>,
  lambda: number,
  innerUpdates: number,
): { readonly weight: number; readonly actions: readonly ServiceFastExperimentActionKind[] } {
  const actions: ServiceFastExperimentActionKind[] = ['bisection-endpoint'];
  if (lambda >= model.marginalScale) return { weight: 0, actions };
  const endpointDenominator = (1 + model.inputScale) ** 2;
  const endpointMarginal = model.marginalScale / endpointDenominator;
  if (lambda <= endpointMarginal) return { weight: 1, actions };
  let lower = 0;
  let upper = 1;
  for (let update = 0; update < innerUpdates; update += 1) {
    actions.push('bisection-inner-update');
    const middle = (lower + upper) / 2;
    const denominator = 1 + model.inputScale * middle;
    const marginal = model.marginalScale / (denominator * denominator);
    if (marginal > lambda) lower = middle;
    else upper = middle;
  }
  actions.push('bisection-final-share');
  return { weight: (lower + upper) / 2, actions };
}

function bisectionProposal(
  amountIn: bigint,
  routes: readonly OracleResolvedRoute[],
  outerUpdates = 16,
  innerUpdates = 12,
): OracleBisectionProposal {
  const models = routes.map((route) => routeModel(route, amountIn));
  let lambdaLower = 0;
  let lambdaUpper = Math.max(...models.map((model) => model.marginalScale));
  const actions: ServiceFastExperimentActionKind[] = [];
  for (let update = 0; update < outerUpdates; update += 1) {
    const lambda = lambdaLower + (lambdaUpper - lambdaLower) / 2;
    let sum = 0;
    for (const model of models) {
      const sampled = bisectionShare(model, lambda, innerUpdates);
      actions.push(...sampled.actions);
      sum += sampled.weight;
    }
    if (sum > 1) lambdaLower = lambda;
    else lambdaUpper = lambda;
  }
  const finalLambda = lambdaLower + (lambdaUpper - lambdaLower) / 2;
  const weights: number[] = [];
  let finalSum = 0;
  for (const model of models) {
    const sampled = bisectionShare(model, finalLambda, innerUpdates);
    actions.push(...sampled.actions);
    weights.push(sampled.weight);
    finalSum += sampled.weight;
  }
  return Object.freeze({
    actions: Object.freeze(actions),
    weights: Object.freeze(weights),
    converged: Math.abs(finalSum - 1) <= 2 ** -40,
    completedOuterUpdates: outerUpdates,
  });
}

function float64Bits(value: number): bigint {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  return bits;
}

function reconstructWeights(amountIn: bigint, weights: readonly number[]): OracleReconstruction {
  const decoded = weights.map((weight) => {
    assert.ok(!Object.is(weight, -0) && Number.isFinite(weight) && weight >= 0 && weight <= 1);
    if (weight === 0) return null;
    assert.ok(weight >= MINIMUM_NORMAL);
    const bits = float64Bits(weight);
    const exponentBits = Number((bits >> 52n) & 0x7ffn);
    const fraction = bits & FRACTION_MASK;
    return {
      significand: SIGNIFICAND_BIT + fraction,
      exponent: exponentBits - 1_023 - 52,
    };
  });
  const positive = decoded.filter((value): value is NonNullable<typeof value> => value !== null);
  assert.ok(positive.length > 0);
  const minimumExponent = Math.min(...positive.map((value) => value.exponent));
  const integerWeights = decoded.map((value) => value === null
    ? 0n
    : value.significand << BigInt(value.exponent - minimumExponent));
  const totalWeight = bigintSum(integerWeights);
  const baseAllocations = integerWeights.map((weight) => (amountIn * weight) / totalWeight);
  return Object.freeze({
    integerWeights: Object.freeze(integerWeights),
    baseAllocations: Object.freeze(baseAllocations),
    residualUnits: amountIn - bigintSum(baseAllocations),
  });
}

function currentAttempts(
  fixture: OracleFixture,
  routes: readonly OracleRoute[],
  reconstruction: OracleReconstruction,
): {
  readonly attempts: readonly CorrectedCurrentAttempt[];
  readonly winner: OracleSplitReceipt | null;
  readonly allocations: readonly bigint[] | null;
} {
  let allocations = [...reconstruction.baseAllocations];
  let remaining = reconstruction.residualUnits;
  const attempts: CorrectedCurrentAttempt[] = [];
  let finalWinner: OracleSplitReceipt | null = null;
  if (remaining === 0n) {
    const receipt = oracleReplay(fixture, routes, allocations);
    attempts.push(Object.freeze({
      attemptIndex: 0,
      residualUnitsRemaining: 0n,
      routeIndex: null,
      allocations: Object.freeze([...allocations]),
      outcome: receipt === null ? 'rejected' : 'valid-best',
      failureCode: receipt === null ? 'residual-options-exhausted' : null,
      receipt,
    }));
    return Object.freeze({
      attempts: Object.freeze(attempts),
      winner: receipt,
      allocations: receipt === null ? null : Object.freeze([...allocations]),
    });
  }
  while (remaining > 0n) {
    let roundWinner: OracleSplitReceipt | null = null;
    let roundAllocations: readonly bigint[] | null = null;
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const option = [...allocations];
      option[routeIndex] = option[routeIndex]! + 1n;
      const receipt = oracleReplay(fixture, routes, option);
      const better = receipt !== null &&
        (roundWinner === null || oracleCompareReceipts(receipt, roundWinner) < 0);
      attempts.push(Object.freeze({
        attemptIndex: attempts.length,
        residualUnitsRemaining: remaining,
        routeIndex,
        allocations: Object.freeze(option),
        outcome: receipt === null ? 'rejected' : better ? 'valid-best' : 'valid-not-best',
        failureCode: receipt === null ? 'residual-options-exhausted' : null,
        receipt,
      }));
      if (better && receipt !== null) {
        roundWinner = receipt;
        roundAllocations = Object.freeze(option);
      }
    }
    if (roundWinner === null || roundAllocations === null) {
      return Object.freeze({ attempts: Object.freeze(attempts), winner: null, allocations: null });
    }
    allocations = [...roundAllocations];
    remaining -= 1n;
    finalWinner = roundWinner;
  }
  return Object.freeze({
    attempts: Object.freeze(attempts),
    winner: finalWinner,
    allocations: Object.freeze(allocations),
  });
}

function repairNeighborhood(reconstruction: OracleReconstruction): readonly (readonly bigint[])[] {
  const anchor = [...reconstruction.baseAllocations];
  const positiveIndexes = reconstruction.integerWeights
    .map((weight, index) => ({ weight, index }))
    .filter(({ weight }) => weight > 0n)
    .map(({ index }) => index);
  for (let index = 0; index < Number(reconstruction.residualUnits); index += 1) {
    const routeIndex = positiveIndexes[index];
    if (routeIndex === undefined) throw new Error('Residual route escaped.');
    anchor[routeIndex] = anchor[routeIndex]! + 1n;
  }
  const result: Array<readonly bigint[]> = [];
  const seen = new Set<string>();
  const add = (allocation: readonly bigint[]): void => {
    const key = allocation.map(String).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(Object.freeze([...allocation]));
  };
  add(anchor);
  const amountIn = bigintSum(anchor);
  for (let routeIndex = 0; routeIndex < anchor.length; routeIndex += 1) {
    const endpoint = Array<bigint>(anchor.length).fill(0n);
    endpoint[routeIndex] = amountIn;
    add(endpoint);
  }
  for (const radius of [1n, 2n] as const) {
    for (let donorIndex = 0; donorIndex < anchor.length; donorIndex += 1) {
      const donor = anchor[donorIndex];
      if (donor === undefined || donor < radius) continue;
      for (let receiverIndex = 0; receiverIndex < anchor.length; receiverIndex += 1) {
        if (receiverIndex === donorIndex) continue;
        const option = [...anchor];
        option[donorIndex] = donor - radius;
        option[receiverIndex] = option[receiverIndex]! + radius;
        add(option);
      }
    }
  }
  return Object.freeze(result);
}

function repairAttempts(
  fixture: OracleFixture,
  routes: readonly OracleRoute[],
  reconstruction: OracleReconstruction,
): {
  readonly attempts: readonly CorrectedRepairAttempt[];
  readonly winner: OracleSplitReceipt | null;
  readonly allocations: readonly bigint[] | null;
} {
  let winner: OracleSplitReceipt | null = null;
  let winnerAllocations: readonly bigint[] | null = null;
  const attempts = repairNeighborhood(reconstruction).map((allocations, neighborIndex) => {
    const receipt = oracleReplay(fixture, routes, allocations);
    const better = receipt !== null &&
      (winner === null || oracleCompareReceipts(receipt, winner) < 0);
    if (better && receipt !== null) {
      winner = receipt;
      winnerAllocations = allocations;
    }
    return Object.freeze({
      attemptIndex: neighborIndex,
      neighborIndex,
      allocations,
      outcome: receipt === null ? 'rejected' as const
        : better ? 'valid-best' as const : 'valid-not-best' as const,
      failureCode: receipt === null ? 'repair-no-valid-neighbor' as const : null,
      receipt,
    });
  });
  return Object.freeze({
    attempts: Object.freeze(attempts),
    winner,
    allocations: winnerAllocations,
  });
}

function receiptProjection(receipt: OracleSplitReceipt): unknown {
  return {
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn.toString(10),
    amountOut: receipt.amountOut.toString(10),
    legs: receipt.legs.map((leg) => ({
      allocation: leg.allocation.toString(10),
      receipt: {
        snapshotId: leg.receipt.snapshotId,
        snapshotChecksum: leg.receipt.snapshotChecksum,
        assetIn: leg.receipt.assetIn,
        assetOut: leg.receipt.assetOut,
        amountIn: leg.receipt.amountIn.toString(10),
        amountOut: leg.receipt.amountOut.toString(10),
        hops: leg.receipt.hops.map((hop) => ({
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
      },
    })),
  };
}

function receiptHash(receipt: OracleSplitReceipt): string {
  return sha256Json(receiptProjection(receipt));
}

function actionIsMethod(action: ServiceFastExperimentActionKind): boolean {
  return action === 'bisection-inner-update' || action === 'bisection-final-share' ||
    action === 'pinned-sqrt-formula' || action === 'fixed-newton-sqrt-normalization' ||
    action === 'fixed-newton-sqrt-update' || action === 'fixed-newton-sqrt-finalization';
}

void test('reconstructs the complete final-finite repair evaluator independently', () => {
  const fixture = makeFixture(2);
  const amountIn = 101n;
  const proposal = bisectionProposal(amountIn, fixture.resolvedRoutes);
  const reconstruction = reconstructWeights(amountIn, proposal.weights);
  assert.deepEqual(reconstruction.baseAllocations, [50n, 50n]);
  assert.equal(reconstruction.residualUnits, 1n);
  const current = currentAttempts(fixture, fixture.routes, reconstruction);
  const repair = repairAttempts(fixture, fixture.routes, reconstruction);
  assert.equal(repair.attempts.length, 7);
  assert.deepEqual(repair.allocations, [101n, 0n]);
  assert.notEqual(current.winner, null);
  assert.notEqual(repair.winner, null);

  const cell = prepareCell(fixture, amountIn);
  const outcome = completeSemantic(cell, POLICY_REPAIR);
  assertCounterPartition(outcome);
  const diagnostic = outcome.diagnostics[0];
  assert.notEqual(diagnostic, undefined);
  if (diagnostic === undefined) throw new Error('Missing diagnostic.');
  assert.equal(diagnostic.status, 'improved');
  assert.equal(diagnostic.failureCode, null);
  assert.equal(
    (diagnostic as unknown as CorrectedSetEvidence).proposalFailure,
    null,
  );
  assert.deepEqual(diagnostic.proposalMetadata, {
    converged: proposal.converged,
    diagnostic: proposal.converged ? null : 'finite-nonconverged-replayed',
    completedOuterUpdates: proposal.completedOuterUpdates,
    weights: proposal.weights,
  });
  assert.deepEqual(diagnostic.reconstruction, reconstruction);
  assert.deepEqual(diagnostic.currentAttempts, current.attempts);
  assert.deepEqual(diagnostic.repair?.attempts, repair.attempts);
  assert.deepEqual(diagnostic.repair?.winner?.allocations, repair.allocations);
  assert.deepEqual(diagnostic.selectedScore?.allocations, repair.allocations);
  assert.deepEqual(diagnostic.authorizationReceipt, repair.winner);
  assert.deepEqual(outcome.finalIncumbent, repair.winner);
  assert.equal(diagnostic.selectedScore?.receiptHash, receiptHash(repair.winner!));
  assert.equal(outcome.anyValidScore, true);
  assert.equal(outcome.anyImprovement, true);
  assert.deepEqual(outcome.counters, {
    methodActions: proposal.actions.filter(actionIsMethod).length,
    outerUpdates: 16,
    shareActions: proposal.actions.length,
    reconstructionSteps: 6,
    residualReplays: current.attempts.length,
    residualRejections: 0,
    repairReplays: repair.attempts.length,
    repairRejections: 0,
    authorizationReplays: 1,
    authorizationRejections: 0,
    proposals: 1,
    diagnostics: 1,
  });
  assert.equal(
    outcome.stageAggregate,
    1 + proposal.actions.length + 6 + current.attempts.length + repair.attempts.length + 1,
  );
  const firstSnapshot = serviceFastExperimentCallSetSnapshot(
    prepareServiceFastOperationalPolicy(cell, POLICY_REPAIR),
    0,
  ) as unknown as CorrectedSetEvidence;
  const secondSnapshot = serviceFastExperimentCallSetSnapshot(
    prepareServiceFastOperationalPolicy(cell, POLICY_REPAIR),
    0,
  ) as unknown as CorrectedSetEvidence;
  assert.deepEqual(firstSnapshot.counters, secondSnapshot.counters);
  assert.notEqual(firstSnapshot.counters, secondSnapshot.counters);
  assertDeepFrozen(firstSnapshot.counters);
});

void test('matches every key stopped transition and reconstructs prefix transcripts', () => {
  const fixture = makeFixture(2);
  const amountIn = 101n;
  const proposal = bisectionProposal(amountIn, fixture.resolvedRoutes);
  const reconstruction = reconstructWeights(amountIn, proposal.weights);
  const current = currentAttempts(fixture, fixture.routes, reconstruction);
  const repair = repairAttempts(fixture, fixture.routes, reconstruction);
  const cell = prepareCell(fixture, amountIn);
  const semantic = completeSemantic(cell, POLICY_REPAIR);
  const expectedActions = Object.freeze([
    'proposal' as const,
    ...proposal.actions,
    ...Array<ServiceFastExperimentActionKind>(6).fill('reconstruction-step'),
    ...Array<ServiceFastExperimentActionKind>(current.attempts.length).fill('residual-replay'),
    ...Array<ServiceFastExperimentActionKind>(repair.attempts.length).fill('repair-replay'),
    'authorization-replay' as const,
  ]);

  const trace: ServiceFastExperimentActionKind[] = [];
  const completeCall = prepareServiceFastOperationalPolicy(cell, POLICY_REPAIR);
  const rawComplete = runServiceFastOperationalPolicy(completeCall, (pending) => {
    trace.push(pending.actionKind);
    return false;
  });
  assert.equal(rawComplete.status, 'complete');
  assertCounterPartition(rawComplete);
  assert.deepEqual(trace, expectedActions);
  const terminal = serviceFastExperimentCallProgress(completeCall);
  assert.equal('status' in terminal ? terminal.status : 'checkpoint', 'complete');
  assert.deepEqual(
    validateServiceFastCompleteOutcome(rawComplete, semantic).ok,
    true,
  );

  const firstOf = (kind: ServiceFastExperimentActionKind): number => {
    const index = expectedActions.indexOf(kind);
    assert.ok(index >= 0);
    return index;
  };
  const lastOf = (kind: ServiceFastExperimentActionKind): number => {
    const index = expectedActions.lastIndexOf(kind);
    assert.ok(index >= 0);
    return index;
  };
  const targets = [...new Set([
    0,
    firstOf('bisection-endpoint'),
    firstOf('bisection-inner-update'),
    firstOf('bisection-final-share'),
    firstOf('reconstruction-step'),
    lastOf('reconstruction-step'),
    firstOf('residual-replay'),
    lastOf('residual-replay'),
    firstOf('repair-replay'),
    lastOf('repair-replay'),
    firstOf('authorization-replay'),
  ])];

  for (const target of targets) {
    const call = prepareServiceFastOperationalPolicy(cell, POLICY_REPAIR);
    let index = 0;
    const raw = runServiceFastOperationalPolicy(call, () => index++ === target);
    assert.equal(raw.status, 'stopped');
    if (raw.status !== 'stopped') throw new Error('Expected stopped prefix.');
    assert.equal(raw.nextAction.actionKind, expectedActions[target]);
    assert.deepEqual(raw.nextAction.counters, raw.counters);
    const executed = expectedActions.slice(0, target);
    const expectedCurrentCount = executed.filter((action) => action === 'residual-replay').length;
    const expectedRepairCount = executed.filter((action) => action === 'repair-replay').length;
    assert.deepEqual(
      raw.setSnapshots[0]?.currentAttempts,
      current.attempts.slice(0, expectedCurrentCount),
    );
    assertCounterPartition(raw);
    assert.deepEqual(
      raw.setSnapshots[0]?.repair?.attempts ?? [],
      repair.attempts.slice(0, expectedRepairCount),
    );
    const validation = validateServiceFastDeadlinePrefix(call, raw, semantic);
    assert.equal(validation.ok, true);
    if (!validation.ok) throw new Error('Expected independently checked prefix parity.');
    assert.equal(isFinalizedServiceFastStoppedOutcome(raw), false);
    assert.equal(isFinalizedServiceFastStoppedOutcome(validation.value), true);
  }
});

void test('pre-action caps never charge the pending unit and preserve the incumbent', () => {
  const fixture = makeFixture(2);
  const amountIn = 101n;
  const entry = oracleReplay(fixture, fixture.routes, [50n, 51n]);
  assert.notEqual(entry, null);
  const cell = prepareCell(fixture, amountIn, undefined, entry!);
  const semantic = completeSemantic(cell, POLICY_REPAIR);
  const cases = [
    ['proposals', 'proposal', { proposals: 0 }],
    ['shareActions', 'bisection-endpoint', { shareActions: 0 }],
    ['reconstructionSteps', 'reconstruction-step', { reconstructionSteps: 0 }],
    ['residualReplays', 'residual-replay', { residualReplays: 0 }],
    ['repairReplays', 'repair-replay', { repairReplays: 0 }],
    ['authorizationReplays', 'authorization-replay', { authorizationReplays: 0 }],
  ] as const;
  for (const [counter, action, override] of cases) {
    const call = prepareServiceFastOperationalPolicy(
      cell,
      POLICY_REPAIR,
      caps(POLICY_REPAIR, override),
    );
    const raw = runServiceFastOperationalPolicy(call);
    assert.equal(raw.status, 'stopped');
    if (raw.status !== 'stopped') throw new Error('Expected cap stop.');
    assert.equal(raw.reason, 'action-cap');
    assert.equal(raw.nextAction.actionKind, action);
    assert.equal(raw.counters[counter], 0);
    assert.equal(raw.nextAction.counters[counter], 0);
    assert.deepEqual(raw.finalIncumbent, entry);
    const aggregate = raw.counters.proposals + raw.counters.shareActions +
      raw.counters.reconstructionSteps + raw.counters.residualReplays +
      raw.counters.repairReplays + raw.counters.authorizationReplays;
    assert.equal(raw.stageAggregate, aggregate);
    assert.equal(validateServiceFastDeadlinePrefix(call, raw, semantic).ok, true);
  }

  const aggregateCall = prepareServiceFastOperationalPolicy(
    cell,
    POLICY_REPAIR,
    caps(POLICY_REPAIR, { stageAggregate: 1 }),
  );
  const aggregateStop = runServiceFastOperationalPolicy(aggregateCall);
  assert.equal(aggregateStop.status, 'stopped');
  if (aggregateStop.status !== 'stopped') throw new Error('Expected aggregate stop.');
  assert.equal(aggregateStop.counters.proposals, 1);
  assert.equal(aggregateStop.counters.shareActions, 0);
  assert.equal(aggregateStop.nextAction.actionKind, 'bisection-endpoint');
});

void test('authorizes only a complete exact input after every residual round', () => {
  const fixture = makeFixture(4);
  const amountIn = 1_003n;
  const proposal = bisectionProposal(amountIn, fixture.resolvedRoutes);
  const reconstruction = reconstructWeights(amountIn, proposal.weights);
  assert.deepEqual(reconstruction.baseAllocations, [250n, 250n, 250n, 250n]);
  assert.equal(reconstruction.residualUnits, 3n);
  const expected = currentAttempts(fixture, fixture.routes, reconstruction);
  assert.equal(expected.attempts.length, 12);
  const cell = prepareCell(fixture, amountIn);
  const semantic = completeSemantic(cell, POLICY_CURRENT);

  for (const completedAttempts of [8, 9]) {
    const call = prepareServiceFastOperationalPolicy(cell, POLICY_CURRENT);
    const raw = runServiceFastOperationalPolicy(
      call,
      (pending) => pending.actionKind === 'residual-replay' &&
        pending.counters.residualReplays === completedAttempts,
    );
    assert.equal(raw.status, 'stopped');
    if (raw.status !== 'stopped') throw new Error('Expected residual prefix.');
    assert.deepEqual(
      raw.setSnapshots[0]?.currentAttempts,
      expected.attempts.slice(0, completedAttempts),
    );
    assert.equal(raw.anyValidScore, completedAttempts >= 9);
    assert.equal(validateServiceFastDeadlinePrefix(call, raw, semantic).ok, true);
  }
  assert.equal(semantic.counters.authorizationReplays, 1);
  assert.equal(semantic.diagnostics[0]?.selectedScore?.receipt.amountIn, amountIn);
  assert.equal(semantic.diagnostics[0]?.authorizationReceipt?.amountIn, amountIn);
  assert.equal(bigintSum(semantic.diagnostics[0]?.selectedScore?.allocations ?? []), amountIn);
  assert.deepEqual(semantic.finalIncumbent, expected.winner);
});

void test('repairs only the first resolved multiset member and preserves failures', () => {
  const fixture = makeFixture(2);
  const amountIn = 101n;
  const resolved = candidateSet(fixture.routes, fixture.resolvedRoutes);
  const unresolved = candidateSet(fixture.routes, null);
  const multisetCell = prepareCell(fixture, amountIn, [unresolved, resolved, resolved]);
  const multiset = completeSemantic(multisetCell, POLICY_REPAIR);
  assertCounterPartition(multiset);
  assert.deepEqual(multiset.diagnostics.map((diagnostic) => ({
    setIndex: diagnostic.setIndex,
    disposition: diagnostic.reconstructionDisposition,
    repair: diagnostic.repair?.target ?? null,
  })), [
    { setIndex: 0, disposition: 'current-only-nontarget', repair: null },
    { setIndex: 1, disposition: 'repair-complete', repair: true },
    { setIndex: 2, disposition: 'current-only-nontarget', repair: null },
  ]);
  assert.equal(multiset.counters.repairReplays, 7);

  const entry = oracleReplay(fixture, fixture.routes, [101n, 0n]);
  assert.notEqual(entry, null);
  const missingRoutes = Object.freeze(fixture.routes.map((route, index) => Object.freeze([
    Object.freeze({ ...route[0]!, poolId: `missing-${index}` }),
  ])));
  const replayFailureCell = prepareCell(
    fixture,
    amountIn,
    [candidateSet(missingRoutes, fixture.resolvedRoutes)],
    entry!,
  );
  const replayFailure = completeSemantic(replayFailureCell, POLICY_REPAIR);
  assertCounterPartition(replayFailure);
  assert.deepEqual(replayFailure.finalIncumbent, entry);
  assert.equal(replayFailure.anyImprovement, false);
  assert.equal(replayFailure.counters.residualRejections, 2);
  assert.equal(replayFailure.counters.repairRejections, 7);
  assert.equal(replayFailure.diagnostics[0]?.status, 'score-rejected');
  assert.equal(replayFailure.diagnostics[0]?.failureCode, 'residual-options-exhausted');
  assert.equal(replayFailure.diagnostics[0]?.repair?.failureCode, 'repair-no-valid-neighbor');
  const correctedReplayFailure = correctedOutcome(replayFailure).diagnostics[0];
  assert.ok(correctedReplayFailure?.currentAttempts.every((attempt) =>
    attempt.outcome === 'rejected' &&
    attempt.failureCode === 'residual-options-exhausted'));
  assert.ok(correctedReplayFailure?.repair?.attempts.every((attempt) =>
    attempt.outcome === 'rejected' &&
    attempt.failureCode === 'repair-no-valid-neighbor'));

  const huge = 1n << 20_000n;
  const hostileResolved = Object.freeze([
    Object.freeze([Object.freeze({
      reserveIn: 1n,
      reserveOut: huge,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    })]),
    fixture.resolvedRoutes[1]!,
  ]);
  const proposalFailureCell = prepareCell(
    fixture,
    amountIn,
    [candidateSet(fixture.routes, hostileResolved)],
    entry!,
  );
  const proposalFailure = completeSemantic(proposalFailureCell, POLICY_REPAIR);
  assertCounterPartition(proposalFailure);
  assert.deepEqual(proposalFailure.finalIncumbent, entry);
  assert.equal(proposalFailure.anyImprovement, false);
  assert.equal(proposalFailure.diagnostics[0]?.status, 'proposal-failed');
  assert.equal(proposalFailure.diagnostics[0]?.failureCode, 'non-finite-normalization');
  const proposalFailureEvidence = correctedOutcome(proposalFailure)
    .diagnostics[0]?.proposalFailure;
  assert.deepEqual(proposalFailureEvidence, {
    failureCode: 'non-finite-normalization',
    converged: false,
    completedOuterUpdates: 0,
  });
  assert.deepEqual(Reflect.ownKeys(proposalFailureEvidence ?? {}), [
    'failureCode',
    'converged',
    'completedOuterUpdates',
  ]);

  const asymmetricResolved = Object.freeze([
    fixture.resolvedRoutes[0]!,
    Object.freeze([Object.freeze({
      reserveIn: 12_000n,
      reserveOut: 12_000n,
      feeChargedNumerator: 3n,
      feeDenominator: 1_000n,
    })]),
  ]);
  const strictProposal = bisectionProposal(amountIn, asymmetricResolved);
  assert.equal(strictProposal.converged, false);
  const strictFailure = completeSemantic(
    prepareCell(
      fixture,
      amountIn,
      [candidateSet(fixture.routes, asymmetricResolved)],
      entry!,
    ),
    12,
  );
  assert.deepEqual(strictFailure.finalIncumbent, entry);
  assert.equal(strictFailure.diagnostics[0]?.failureCode, 'non-convergence');
  assert.deepEqual(
    correctedOutcome(strictFailure).diagnostics[0]?.proposalFailure,
    {
      failureCode: 'non-convergence',
      converged: false,
      completedOuterUpdates: 16,
    },
  );
});

void test('covers null, existing, tied, and forged incumbents independently', () => {
  const fixture = makeFixture(2);
  const amountIn = 101n;
  const split = oracleReplay(fixture, fixture.routes, [50n, 51n]);
  const endpoint = oracleReplay(fixture, fixture.routes, [101n, 0n]);
  assert.notEqual(split, null);
  assert.notEqual(endpoint, null);
  assert.equal(oracleCompareReceipts(endpoint!, split!), -1);

  const noEntry = completeSemantic(prepareCell(fixture, amountIn), POLICY_REPAIR);
  assert.equal(noEntry.entryIncumbent, null);
  assert.deepEqual(noEntry.finalIncumbent, endpoint);
  assert.equal(noEntry.anyImprovement, true);

  const existing = completeSemantic(
    prepareCell(fixture, amountIn, undefined, split!),
    POLICY_REPAIR,
  );
  assert.deepEqual(existing.entryIncumbent, split);
  assert.deepEqual(existing.finalIncumbent, endpoint);
  assert.equal(existing.counters.authorizationReplays, 1);

  const tied = completeSemantic(
    prepareCell(fixture, amountIn, undefined, endpoint!),
    POLICY_REPAIR,
  );
  assert.deepEqual(tied.finalIncumbent, endpoint);
  assert.equal(tied.diagnostics[0]?.status, 'not-better');
  assert.equal(tied.counters.authorizationReplays, 0);
  assert.equal(tied.anyImprovement, false);

  assert.throws(
    () => prepareCell(
      fixture,
      amountIn,
      undefined,
      Object.freeze({ ...endpoint!, amountOut: endpoint!.amountOut + 1n }),
    ),
    TypeError,
  );
});

void test('keeps 255-bit reconstruction, replay, authorization, and decimal evidence exact', () => {
  const reserve = (1n << 255n) - 19n;
  const amountIn = (1n << 255n) - 123n;
  const fixture = makeFixture(2, reserve, reserve - 2n);
  const proposal = bisectionProposal(amountIn, fixture.resolvedRoutes);
  const reconstruction = reconstructWeights(amountIn, proposal.weights);
  const half = amountIn / 2n;
  assert.deepEqual(reconstruction.baseAllocations, [half, half]);
  assert.equal(reconstruction.residualUnits, 1n);
  const expected = currentAttempts(fixture, fixture.routes, reconstruction);
  const semantic = completeSemantic(prepareCell(fixture, amountIn), POLICY_CURRENT);
  assert.deepEqual(semantic.diagnostics[0]?.reconstruction, reconstruction);
  assert.deepEqual(semantic.diagnostics[0]?.currentAttempts, expected.attempts);
  assert.deepEqual(semantic.finalIncumbent, expected.winner);
  assert.equal(semantic.finalIncumbent?.amountIn, amountIn);
  assert.equal(semantic.diagnostics[0]?.authorizationReceipt?.amountIn, amountIn);
  const projection = projectServiceFastSemanticResult(semantic);
  assert.equal(projection.finalIncumbent?.amountOut, expected.winner?.amountOut.toString(10));
  assert.match(projection.finalIncumbent?.amountOut ?? '', /^[1-9][0-9]*$/u);
});

void test('separates semantic and operational anchors and enforces provenance fences', () => {
  const fixture = makeFixture(2);
  const cell = prepareCell(fixture, 101n);
  const semantic = completeSemantic(cell, 0);
  assert.equal(semantic.adapterMode, 'semantic');
  assert.equal(isFinalizedServiceFastCompleteOutcome(semantic), true);

  const call = prepareServiceFastOperationalPolicy(cell, 0);
  const raw = runServiceFastOperationalPolicy(call);
  assert.equal(raw.status, 'complete');
  if (raw.status !== 'complete') throw new Error('Expected operational anchor.');
  assert.equal(raw.adapterMode, 'operational');
  assert.equal(raw.counters.methodActions, null);
  assert.equal(raw.diagnostics[0]?.reconstruction, null);
  assertCounterPartition(raw);
  assert.ok(correctedOutcome(raw).setSnapshots.every(
    (snapshot) => snapshot.counters.methodActions === null,
  ));
  assert.equal(isFinalizedServiceFastCompleteOutcome(raw), false);
  assert.throws(
    () => projectServiceFastSemanticResult(
      raw as unknown as ServiceFastExperimentCompleteOutcome,
    ),
    TypeError,
  );
  const validated = validateServiceFastCompleteOutcome(raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected anchor parity.');
  assertCounterPartition(validated.value);
  assert.ok(correctedOutcome(validated.value).setSnapshots.every(
    (snapshot) => typeof snapshot.counters.methodActions === 'number',
  ));
  assert.deepEqual(
    projectServiceFastSemanticResult(validated.value),
    projectServiceFastSemanticResult(semantic),
  );
  assert.throws(
    () => projectServiceFastSemanticResult(Object.freeze({ ...semantic })),
    TypeError,
  );
  assert.deepEqual(validateServiceFastCompleteOutcome(raw, semantic), {
    ok: false,
    code: 'counter-invariant-failure',
  });

  const stoppedCall = prepareServiceFastOperationalPolicy(cell, 0);
  const stopped = runServiceFastOperationalPolicy(
    stoppedCall,
    (pending) => pending.actionKind === 'protected-share-microstep',
  );
  assert.equal(stopped.status, 'stopped');
  if (stopped.status !== 'stopped') throw new Error('Expected anchor prefix.');
  const otherCall = prepareServiceFastOperationalPolicy(cell, 0);
  assert.deepEqual(validateServiceFastDeadlinePrefix(otherCall, stopped, semantic), {
    ok: false,
    code: 'counter-invariant-failure',
  });
  assertCounterPartition(stopped);
  assert.ok(correctedOutcome(stopped).setSnapshots.every(
    (snapshot) => snapshot.counters.methodActions === null,
  ));
  const stoppedValidation = validateServiceFastDeadlinePrefix(
    stoppedCall,
    stopped,
    semantic,
  );
  assert.equal(stoppedValidation.ok, true);
  if (!stoppedValidation.ok) throw new Error('Expected finalized anchor prefix.');
  assertCounterPartition(stoppedValidation.value);
  assert.ok(correctedOutcome(stoppedValidation.value).setSnapshots.every(
    (snapshot) => typeof snapshot.counters.methodActions === 'number',
  ));

  const resumedCall = prepareServiceFastOperationalPolicy(cell, 0);
  const resumedRaw = runServiceFastOperationalPolicy(
    resumedCall,
    (pending) => pending.actionKind === 'protected-share-microstep',
  );
  assert.equal(resumedRaw.status, 'stopped');
  if (resumedRaw.status !== 'stopped') throw new Error('Expected resumable prefix.');
  assert.equal(runServiceFastOperationalPolicy(resumedCall).status, 'complete');
  assert.deepEqual(validateServiceFastDeadlinePrefix(resumedCall, resumedRaw, semantic), {
    ok: false,
    code: 'counter-invariant-failure',
  });
});

void test('projects one hand-derived failure record with a deterministic semantic hash', () => {
  const fixture = makeFixture(2);
  const cell = prepareCell(fixture, 101n, [candidateSet(fixture.routes, null)]);
  const semantic = completeSemantic(cell, POLICY_CURRENT);
  const emptyTranscriptHash = sha256Json([]);
  const withoutHash = {
    schemaVersion: 'service-fast-semantic-projection-v1' as const,
    policyIndex: POLICY_CURRENT,
    policyId: 'bisection-o16-i12--final-finite-replay--current',
    status: 'complete' as const,
    counters: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    modelRouteSetupSteps: 0,
    stageAggregate: 0,
    conservativeAggregate: 0,
    entryIncumbent: null,
    finalIncumbent: null,
    anyValidScore: false,
    anyImprovement: false,
    diagnostics: [{
      setIndex: 0,
      status: 'model-resolution-failed',
      failureCode: 'invalid-route-model',
      reconstructionDisposition: 'current',
      proposalMetadata: null,
      proposalFailure: null,
      reconstructionHash: null,
      currentTranscriptHash: emptyTranscriptHash,
      currentScore: null,
      repair: null,
      selectedScore: null,
      authorizationReceiptHash: null,
      counters: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    }],
  };
  const expectedSemanticHash =
    'sha256:a31ecab5037212ecee5bfb4f4aa42e852ed31e25c2e793c5d1dc6ec82177ca73';
  assert.equal(sha256Json(withoutHash), expectedSemanticHash);
  assert.deepEqual(Reflect.ownKeys(withoutHash.diagnostics[0] ?? {}), [
    'setIndex',
    'status',
    'failureCode',
    'reconstructionDisposition',
    'proposalMetadata',
    'proposalFailure',
    'reconstructionHash',
    'currentTranscriptHash',
    'currentScore',
    'repair',
    'selectedScore',
    'authorizationReceiptHash',
    'counters',
  ]);
  assert.equal(withoutHash.diagnostics[0]?.proposalFailure, null);
  assert.deepEqual(
    withoutHash.diagnostics[0]?.counters,
    withoutHash.counters,
  );
  const expected = Object.freeze({
    ...withoutHash,
    semanticHash: expectedSemanticHash,
  });
  assert.deepEqual(projectServiceFastSemanticResult(semantic), expected);
  assert.deepEqual(
    projectServiceFastSemanticResult(completeSemantic(cell, POLICY_CURRENT)),
    expected,
  );
});

function sourceFiles(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function importClosure(entry: string): ReadonlyMap<string, string> {
  const closure = new Map<string, string>();
  const pending = [entry];
  const staticSpecifier = /(?:from\s*|import\s*)['"]([^'"]+)['"]/gu;
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || closure.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    closure.set(file, source);
    for (const match of source.matchAll(staticSpecifier)) {
      const specifier = match[1];
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      const target = existsSync(resolved) ? resolved
        : existsSync(`${resolved}.ts`) ? `${resolved}.ts`
        : path.join(resolved, 'index.ts');
      assert.equal(existsSync(target), true, `Unresolved production import: ${specifier}`);
      pending.push(target);
    }
  }
  return closure;
}

void test('audits the production closure for test-only forcing seams', () => {
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  );
  const sourceRoot = path.join(repository, 'src');
  const experimentEntry = path.join(
    sourceRoot,
    'benchmark/service-fast-numerical-experiment/index.ts',
  );
  const closure = importClosure(experimentEntry);
  assert.ok(closure.size > 10);
  assert.ok(closure.has(path.join(
    sourceRoot,
    'benchmark/service-fast-numerical-experiment/evaluator-kernel.ts',
  )));
  for (const [file, source] of closure) {
    assert.ok(file.startsWith(`${sourceRoot}${path.sep}`));
    assert.doesNotMatch(file, /(?:^|\/)(?:tests?|fixtures|datasets|cli|scripts)(?:\/|$)/u);
    assert.doesNotMatch(source, /\b(?:__test|testOnly|faultInjector|faultInjection)\b/iu);
    assert.doesNotMatch(source, /\bprocess\.env\b|\bglobalThis\s*\[/u);
    assert.doesNotMatch(source, /\bimport\s*\(/u);
    assert.doesNotMatch(
      source,
      /\bexport\s+(?:function|const|class)\s+[A-Za-z0-9_$]*(?:test|mock|stub|inject|override|fault)[A-Za-z0-9_$]*/iu,
    );
  }
  const experimentReference = /benchmark\/service-fast-numerical-experiment/u;
  for (const file of sourceFiles(sourceRoot)) {
    if (file.startsWith(path.dirname(experimentEntry))) continue;
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      experimentReference,
      `Experiment evaluator leaked into supported runtime: ${file}`,
    );
  }
  const packageJson = readFileSync(path.join(repository, 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /service-fast-numerical-experiment/u);
});
