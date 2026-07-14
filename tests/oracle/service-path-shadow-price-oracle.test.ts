import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  advanceServicePathShadowPriceReconstructionStep,
  advanceServicePathShadowPriceShareMicrostep,
  appendServicePathShadowPriceModelRoute,
  createServicePathShadowPriceState,
  servicePathShadowPriceFailure,
  servicePathShadowPriceInitialResidualUnits,
  servicePathShadowPriceProgress,
  servicePathShadowPriceReadyWeights,
  servicePathShadowPriceResidualOption,
  servicePathShadowPriceScoreAllocations,
  settleServicePathShadowPriceResidualOption,
  startServicePathShadowPriceProposal,
  type ServicePathShadowPriceResidualOutcome,
  type ServicePathShadowPriceResidualOption,
  type ServicePathShadowPriceState,
} from '../../src/allocation/service-path-shadow-price/index.ts';

interface OracleHop {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

type OracleRoute = readonly OracleHop[];

interface OracleModel {
  readonly marginalScale: number;
  readonly inputScale: number;
}

interface OracleReadyProposal {
  readonly status: 'ready';
  readonly weights: readonly number[];
  readonly shareMicrosteps: number;
  readonly outerUpdatesStarted: 64;
  readonly outerUpdatesCompleted: 64;
}

interface OracleFailedProposal {
  readonly status: 'non-convergence';
  readonly weights: readonly number[];
  readonly shareMicrosteps: number;
  readonly outerUpdatesStarted: 64;
  readonly outerUpdatesCompleted: 64;
}

type OracleProposal = OracleReadyProposal | OracleFailedProposal;

interface OracleReconstruction {
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

interface SystemProposal {
  readonly state: ServicePathShadowPriceState;
  readonly outerUpdatesStarted: number;
  readonly outerUpdatesCompleted: number;
}

const OUTER_UPDATES = 64;
const INNER_UPDATES = 64;
const CONVERGENCE_TOLERANCE = 2 ** -40;

function hop(
  reserveIn: bigint,
  reserveOut: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): OracleHop {
  return { reserveIn, reserveOut, feeChargedNumerator, feeDenominator };
}

function route(...hops: readonly OracleHop[]): OracleRoute {
  return hops;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function primitiveTriple(
  coefficientA: bigint,
  coefficientB: bigint,
  coefficientC: bigint,
): readonly [bigint, bigint, bigint] {
  const divisor = greatestCommonDivisor(
    greatestCommonDivisor(coefficientA, coefficientB),
    coefficientC,
  );
  assert.ok(divisor > 0n);
  return [coefficientA / divisor, coefficientB / divisor, coefficientC / divisor];
}

function leadingBinaryValue(value: bigint): {
  readonly significand: number;
  readonly exponent: number;
} {
  const bits = value.toString(2);
  const prefix = bits.slice(0, 53);
  let significandInteger = 0;
  for (const bit of prefix) significandInteger = significandInteger * 2 + Number(bit);
  return {
    significand: significandInteger / 2 ** (prefix.length - 1),
    exponent: bits.length - 1,
  };
}

function normalizedRatio(numerator: bigint, denominator: bigint): number {
  const divisor = greatestCommonDivisor(numerator, denominator);
  const reducedNumerator = leadingBinaryValue(numerator / divisor);
  const reducedDenominator = leadingBinaryValue(denominator / divisor);
  const value =
    (reducedNumerator.significand / reducedDenominator.significand) *
    2 ** (reducedNumerator.exponent - reducedDenominator.exponent);
  assert.ok(Number.isFinite(value) && value >= 2 ** -1022);
  return value;
}

function oracleModel(resolvedRoute: OracleRoute, amountIn: bigint): OracleModel {
  let coefficients: readonly [bigint, bigint, bigint] | undefined;
  for (const resolvedHop of resolvedRoute) {
    const multiplier =
      resolvedHop.feeDenominator - resolvedHop.feeChargedNumerator;
    const next = primitiveTriple(
      multiplier * resolvedHop.reserveOut,
      resolvedHop.feeDenominator * resolvedHop.reserveIn,
      multiplier,
    );
    if (coefficients === undefined) {
      coefficients = next;
      continue;
    }
    coefficients = primitiveTriple(
      coefficients[0] * next[0],
      coefficients[1] * next[1],
      next[1] * coefficients[2] + next[2] * coefficients[0],
    );
  }
  assert.ok(coefficients !== undefined);
  return {
    marginalScale: normalizedRatio(coefficients[0], coefficients[1]),
    inputScale: normalizedRatio(coefficients[2] * amountIn, coefficients[1]),
  };
}

function oracleShare(
  model: OracleModel,
  lambda: number,
): { readonly share: number; readonly actions: number } {
  if (lambda >= model.marginalScale) return { share: 0, actions: 1 };
  const endpointDenominator = (1 + model.inputScale) ** 2;
  const endpointMarginal = model.marginalScale / endpointDenominator;
  assert.ok(Number.isFinite(endpointMarginal) && endpointMarginal > 0);
  if (lambda <= endpointMarginal) return { share: 1, actions: 1 };

  let lower = 0;
  let upper = 1;
  for (let update = 0; update < INNER_UPDATES; update += 1) {
    const share = (lower + upper) / 2;
    const denominator = 1 + model.inputScale * share;
    const marginal = model.marginalScale / (denominator * denominator);
    assert.ok(Number.isFinite(marginal) && marginal > 0);
    if (marginal > lambda) lower = share;
    else upper = share;
  }
  const share = (lower + upper) / 2;
  assert.ok(Number.isFinite(share) && share >= 0 && share <= 1);
  return { share, actions: 1 + INNER_UPDATES + 1 };
}

function oracleProposal(amountIn: bigint, routes: readonly OracleRoute[]): OracleProposal {
  const models = routes.map((candidate) => oracleModel(candidate, amountIn));
  let lambdaLower = 0;
  let lambdaUpper = Math.max(...models.map((model) => model.marginalScale));
  let shareMicrosteps = 0;

  for (let update = 0; update < OUTER_UPDATES; update += 1) {
    const lambda = lambdaLower + (lambdaUpper - lambdaLower) / 2;
    let sum = 0;
    for (const model of models) {
      const sampled = oracleShare(model, lambda);
      shareMicrosteps += sampled.actions;
      sum += sampled.share;
    }
    if (sum > 1) lambdaLower = lambda;
    else lambdaUpper = lambda;
  }

  const finalLambda = lambdaLower + (lambdaUpper - lambdaLower) / 2;
  const weights: number[] = [];
  let sum = 0;
  for (const model of models) {
    const sampled = oracleShare(model, finalLambda);
    shareMicrosteps += sampled.actions;
    weights.push(sampled.share);
    sum += sampled.share;
  }
  const common = {
    weights,
    shareMicrosteps,
    outerUpdatesStarted: 64 as const,
    outerUpdatesCompleted: 64 as const,
  };
  return Math.abs(sum - 1) <= CONVERGENCE_TOLERANCE
    ? { status: 'ready', ...common }
    : { status: 'non-convergence', ...common };
}

function float64Bits(value: number): bigint {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, value, false);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  return bits;
}

function float64Hex(value: number): string {
  return float64Bits(value).toString(16).padStart(16, '0');
}

function reconstructOracle(
  amountIn: bigint,
  weights: readonly number[],
): OracleReconstruction {
  const decoded = weights.map((weight) => {
    const bits = float64Bits(weight);
    const exponentBits = (bits >> 52n) & 0x7ffn;
    const fraction = bits & ((1n << 52n) - 1n);
    assert.equal(bits >> 63n, 0n);
    assert.notEqual(exponentBits, 0n);
    assert.notEqual(exponentBits, 0x7ffn);
    return {
      significand: (1n << 52n) + fraction,
      exponent: exponentBits - 1_023n - 52n,
    };
  });
  const minimumExponent = decoded.reduce(
    (minimum, value) => value.exponent < minimum ? value.exponent : minimum,
    decoded[0]!.exponent,
  );
  const integerWeights = decoded.map(
    (value) => value.significand << (value.exponent - minimumExponent),
  );
  const totalWeight = integerWeights.reduce((sum, value) => sum + value, 0n);
  const baseAllocations = integerWeights.map(
    (weight) => (amountIn * weight) / totalWeight,
  );
  const baseTotal = baseAllocations.reduce((sum, value) => sum + value, 0n);
  return {
    integerWeights,
    baseAllocations,
    residualUnits: amountIn - baseTotal,
  };
}

function runSystemProposal(
  amountIn: bigint,
  routes: readonly OracleRoute[],
): SystemProposal {
  const state = createServicePathShadowPriceState(amountIn, routes.length);
  for (const candidate of routes) {
    const result = appendServicePathShadowPriceModelRoute(state, candidate);
    assert.equal(result.ok, true);
    assert.equal(Object.isFrozen(result), true);
  }
  const started = startServicePathShadowPriceProposal(state);
  assert.equal(started.ok, true);
  assert.equal(Object.isFrozen(started), true);

  let outerUpdatesStarted = 0;
  let outerUpdatesCompleted = 0;
  let guard = 0;
  while (servicePathShadowPriceProgress(state).phase === 'share-microstep') {
    const result = advanceServicePathShadowPriceShareMicrostep(state);
    guard += 1;
    assert.ok(guard < 100_000);
    assert.equal(Object.isFrozen(result), true);
    if (!result.ok) break;
    if (result.outerUpdateStarted) outerUpdatesStarted += 1;
    if (result.outerUpdateCompleted) outerUpdatesCompleted += 1;
  }
  return { state, outerUpdatesStarted, outerUpdatesCompleted };
}

function assertSystemProposalMatches(
  actual: SystemProposal,
  expected: OracleProposal,
): void {
  const progress = servicePathShadowPriceProgress(actual.state);
  assert.equal(progress.shareMicrosteps, expected.shareMicrosteps);
  assert.equal(progress.outerUpdatesStarted, expected.outerUpdatesStarted);
  assert.equal(progress.outerUpdatesCompleted, expected.outerUpdatesCompleted);
  assert.equal(actual.outerUpdatesStarted, expected.outerUpdatesStarted);
  assert.equal(actual.outerUpdatesCompleted, expected.outerUpdatesCompleted);
  const weights = servicePathShadowPriceReadyWeights(actual.state);
  if (expected.status === 'non-convergence') {
    assert.equal(progress.phase, 'failed');
    assert.equal(weights, undefined);
    const failure = servicePathShadowPriceFailure(actual.state);
    assert.equal(Object.isFrozen(failure), true);
    assert.deepEqual(failure, {
      code: 'non-convergence',
      converged: false,
      completedOuterUpdates: 64,
    });
    return;
  }
  assert.equal(progress.phase, 'reconstruction-step');
  assert.equal(Object.isFrozen(weights), true);
  const weightsAgain = servicePathShadowPriceReadyWeights(actual.state);
  assert.notEqual(weightsAgain, weights);
  assert.deepEqual(weightsAgain, weights);
  assert.deepEqual(weights?.map(float64Hex), expected.weights.map(float64Hex));
}

function advanceSystemReconstruction(
  state: ServicePathShadowPriceState,
  expected: OracleReconstruction,
): void {
  const routeCount = expected.baseAllocations.length;
  for (let action = 1; action <= routeCount * 3; action += 1) {
    const advanced = advanceServicePathShadowPriceReconstructionStep(state);
    assert.equal(advanced.ok, true);
    assert.equal(Object.isFrozen(advanced), true);
    assert.equal(servicePathShadowPriceProgress(state).reconstructionSteps, action);
  }
  assert.equal(servicePathShadowPriceInitialResidualUnits(state), expected.residualUnits);
  assert.equal(servicePathShadowPriceProgress(state).phase, 'residual-option');
}

function settleExpectedResiduals(
  state: ServicePathShadowPriceState,
  expected: OracleReconstruction,
  winnerIndexes: readonly number[],
): readonly ServicePathShadowPriceResidualOption[] {
  const observed: ServicePathShadowPriceResidualOption[] = [];
  const current = [...expected.baseAllocations];
  if (expected.residualUnits === 0n) {
    assert.deepEqual(winnerIndexes, []);
    const option = servicePathShadowPriceResidualOption(state);
    observed.push(option);
    assert.deepEqual(option, {
      allocations: current,
      routeIndex: null,
      residualUnitsRemaining: 0n,
    });
    assert.equal(Object.isFrozen(option), true);
    assert.equal(Object.isFrozen(option.allocations), true);
    assert.equal(settleServicePathShadowPriceResidualOption(state, 'valid-best').ok, true);
    const score = servicePathShadowPriceScoreAllocations(state);
    assert.equal(Object.isFrozen(score), true);
    assert.deepEqual(score, current);
    return observed;
  }

  assert.equal(BigInt(winnerIndexes.length), expected.residualUnits);
  for (let round = 0; round < winnerIndexes.length; round += 1) {
    const winnerIndex = winnerIndexes[round];
    assert.ok(winnerIndex !== undefined && winnerIndex < current.length);
    const remaining = expected.residualUnits - BigInt(round);
    for (let routeIndex = 0; routeIndex < current.length; routeIndex += 1) {
      const allocations = [...current];
      allocations[routeIndex] = allocations[routeIndex]! + 1n;
      const option = servicePathShadowPriceResidualOption(state);
      observed.push(option);
      assert.deepEqual(option, {
        allocations,
        routeIndex,
        residualUnitsRemaining: remaining,
      });
      assert.equal(Object.isFrozen(option), true);
      assert.equal(Object.isFrozen(option.allocations), true);
      const outcome: ServicePathShadowPriceResidualOutcome =
        routeIndex === winnerIndex ? 'valid-best' : 'valid-not-best';
      assert.equal(settleServicePathShadowPriceResidualOption(state, outcome).ok, true);
    }
    current[winnerIndex] = current[winnerIndex]! + 1n;
  }
  assert.equal(servicePathShadowPriceProgress(state).phase, 'score-ready');
  const score = servicePathShadowPriceScoreAllocations(state);
  assert.equal(Object.isFrozen(score), true);
  assert.deepEqual(score, current);
  return observed;
}

void test('independently derives the F5 ledger, reconstruction, and two residual options', () => {
  const amountIn = 5n;
  const routes = [route(hop(1n, 3n)), route(hop(3n, 4n))];
  const expectedProposal = oracleProposal(amountIn, routes);
  assert.equal(expectedProposal.status, 'ready');
  assert.equal(expectedProposal.shareMicrosteps, 8_515);
  assert.deepEqual(expectedProposal.weights.map(float64Hex), [
    '3fd999999999999c',
    '3fe3333333333334',
  ]);
  const actual = runSystemProposal(amountIn, routes);
  assertSystemProposalMatches(actual, expectedProposal);

  const expectedReconstruction = reconstructOracle(
    amountIn,
    expectedProposal.weights,
  );
  assert.deepEqual(expectedReconstruction.baseAllocations, [2n, 2n]);
  assert.equal(expectedReconstruction.residualUnits, 1n);
  advanceSystemReconstruction(actual.state, expectedReconstruction);
  assert.equal(servicePathShadowPriceProgress(actual.state).reconstructionSteps, 6);
  const options = settleExpectedResiduals(actual.state, expectedReconstruction, [1]);
  assert.equal(options.length, 2);
  assert.deepEqual(servicePathShadowPriceScoreAllocations(actual.state), [2n, 3n]);
});

void test('independently derives the F6 endpoint ledger and unchanged residual replay', () => {
  const amountIn = 100n;
  const routes = [route(hop(100n, 100n)), route(hop(100n, 100n))];
  const expectedProposal = oracleProposal(amountIn, routes);
  assert.equal(expectedProposal.status, 'ready');
  assert.equal(expectedProposal.shareMicrosteps, 8_450);
  assert.deepEqual(expectedProposal.weights.map(float64Hex), [
    '3fdffffffffffffe',
    '3fdffffffffffffe',
  ]);
  const actual = runSystemProposal(amountIn, routes);
  assertSystemProposalMatches(actual, expectedProposal);

  const expectedReconstruction = reconstructOracle(
    amountIn,
    expectedProposal.weights,
  );
  assert.deepEqual(expectedReconstruction.baseAllocations, [50n, 50n]);
  assert.equal(expectedReconstruction.residualUnits, 0n);
  advanceSystemReconstruction(actual.state, expectedReconstruction);
  assert.equal(servicePathShadowPriceProgress(actual.state).reconstructionSteps, 6);
  const options = settleExpectedResiduals(actual.state, expectedReconstruction, []);
  assert.equal(options.length, 1);
  assert.deepEqual(servicePathShadowPriceScoreAllocations(actual.state), [50n, 50n]);
});

void test('retains strict finite non-convergence after the independently counted ledger', () => {
  const scale = 2n ** 60n;
  const amountIn = 1n;
  const routes = [
    route(hop(10n * scale, 3n * scale)),
    route(hop(scale, 8n * scale)),
  ];
  const expected = oracleProposal(amountIn, routes);
  assert.equal(expected.status, 'non-convergence');
  assert.equal(expected.shareMicrosteps, 130);
  const actual = runSystemProposal(amountIn, routes);
  assertSystemProposalMatches(actual, expected);
});

void test('enumerates every canonical route for three- and four-route multi-unit residuals', () => {
  const fixtures = [
    {
      amountIn: 2n,
      routes: Array.from({ length: 3 }, () => route(hop(10n, 10n))),
      winners: [2, 0],
      final: [1n, 0n, 1n],
    },
    {
      amountIn: 3n,
      routes: Array.from({ length: 4 }, () => route(hop(10n, 10n))),
      winners: [3, 1, 0],
      final: [1n, 1n, 0n, 1n],
    },
  ] as const;

  for (const fixture of fixtures) {
    const expectedProposal = oracleProposal(fixture.amountIn, fixture.routes);
    assert.equal(expectedProposal.status, 'ready');
    const actual = runSystemProposal(fixture.amountIn, fixture.routes);
    assertSystemProposalMatches(actual, expectedProposal);
    const expectedReconstruction = reconstructOracle(
      fixture.amountIn,
      expectedProposal.weights,
    );
    assert.deepEqual(
      expectedReconstruction.baseAllocations,
      Array.from({ length: fixture.routes.length }, () => 0n),
    );
    assert.equal(
      expectedReconstruction.residualUnits,
      BigInt(fixture.winners.length),
    );
    advanceSystemReconstruction(actual.state, expectedReconstruction);
    const options = settleExpectedResiduals(
      actual.state,
      expectedReconstruction,
      fixture.winners,
    );
    assert.equal(options.length, fixture.routes.length * fixture.winners.length);
    for (let round = 0; round < fixture.winners.length; round += 1) {
      assert.deepEqual(
        options
          .slice(round * fixture.routes.length, (round + 1) * fixture.routes.length)
          .map((option) => option.routeIndex),
        Array.from({ length: fixture.routes.length }, (_value, index) => index),
      );
    }
    assert.ok(
      options.some((option) =>
        option.allocations.some((allocation, index) =>
          index !== option.routeIndex && allocation === 0n,
        ),
      ),
    );
    assert.deepEqual(servicePathShadowPriceScoreAllocations(actual.state), fixture.final);
  }
});

void test('preserves independently reconstructed low bits across 255-bit inputs', () => {
  const firstAmount = (1n << 255n) - 19n;
  const secondAmount = (1n << 255n) - 1n;
  assert.equal(Number(firstAmount), Number(secondAmount));
  const scored: bigint[][] = [];

  for (const amountIn of [firstAmount, secondAmount]) {
    const routes = [
      route(hop(amountIn, amountIn)),
      route(hop(amountIn, amountIn)),
    ];
    const expectedProposal = oracleProposal(amountIn, routes);
    assert.equal(expectedProposal.status, 'ready');
    const actual = runSystemProposal(amountIn, routes);
    assertSystemProposalMatches(actual, expectedProposal);
    const expectedReconstruction = reconstructOracle(
      amountIn,
      expectedProposal.weights,
    );
    const half = amountIn / 2n;
    assert.deepEqual(expectedReconstruction.baseAllocations, [half, half]);
    assert.equal(expectedReconstruction.residualUnits, 1n);
    assert.notEqual(BigInt(Math.floor(Number(amountIn) / 2)), half);
    advanceSystemReconstruction(actual.state, expectedReconstruction);
    settleExpectedResiduals(actual.state, expectedReconstruction, [1]);
    const allocations = servicePathShadowPriceScoreAllocations(actual.state);
    assert.deepEqual(allocations, [half, half + 1n]);
    assert.equal(allocations?.reduce((sum, value) => sum + value, 0n), amountIn);
    scored.push([...(allocations ?? [])]);
  }

  assert.deepEqual(
    scored[1]?.map((value, index) => value - scored[0]![index]!),
    [9n, 9n],
  );
});

void test('pauses without hidden work and keeps handles and observations frozen and opaque', () => {
  const state = createServicePathShadowPriceState(5n, 2);
  assert.equal(Object.isFrozen(state), true);
  assert.deepEqual(Object.getOwnPropertyNames(state), []);
  assert.equal(appendServicePathShadowPriceModelRoute(state, route(hop(1n, 3n))).ok, true);
  assert.equal(appendServicePathShadowPriceModelRoute(state, route(hop(3n, 4n))).ok, true);
  assert.equal(startServicePathShadowPriceProposal(state).ok, true);
  for (let action = 0; action < 257; action += 1) {
    assert.equal(advanceServicePathShadowPriceShareMicrostep(state).ok, true);
  }

  const paused = servicePathShadowPriceProgress(state);
  const observedAgain = servicePathShadowPriceProgress(state);
  assert.equal(Object.isFrozen(paused), true);
  assert.notEqual(paused, observedAgain);
  assert.deepEqual(observedAgain, paused);
  assert.equal(paused.shareMicrosteps, 257);
  assert.equal(advanceServicePathShadowPriceShareMicrostep(state).ok, true);
  assert.equal(servicePathShadowPriceProgress(state).shareMicrosteps, 258);

  const lookalike = { ...state };
  const cloned = structuredClone(state);
  assert.throws(() => servicePathShadowPriceProgress(lookalike), /Unknown/u);
  assert.throws(() => servicePathShadowPriceProgress(cloned), /Unknown/u);
});

void test('keeps the stepwise source independent from macro proposal and reconstruction calls', () => {
  const source = readFileSync(
    new URL('../../src/allocation/service-path-shadow-price/index.ts', import.meta.url),
    'utf8',
  );
  for (const forbiddenCall of [
    'preparePathShadowPriceProposal',
    'advancePathShadowPriceProposal',
    'finalizePathShadowPriceProposal',
    'reconstructPathShadowPriceBase',
  ]) {
    assert.equal(
      new RegExp(`\\b${forbiddenCall}\\s*\\(`, 'u').test(source),
      false,
      forbiddenCall,
    );
  }
  assert.equal(
    /^import(?!\s+type\b).*path-shadow-price\/index\.ts/mu.test(source),
    false,
  );
});
