import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advancePathShadowPriceProposal,
  capturePathShadowPriceConfiguration,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
  reconstructPathShadowPriceBase,
  type CapturedPathShadowPriceConfiguration,
  type PathShadowPriceIterationState,
  type PathShadowPriceReadyState,
  type PathShadowPriceResolvedHop,
  type PathShadowPriceResolvedRoute,
  type PathShadowPriceRouteModel,
} from '../../src/allocation/path-shadow-price/index.ts';

interface OracleRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface OracleRouteModel {
  readonly coefficientA: bigint;
  readonly coefficientB: bigint;
  readonly coefficientC: bigint;
  readonly exactMarginalScale: OracleRational;
  readonly exactInputScale: OracleRational;
  readonly nonauthorizingMarginalScale: number;
  readonly nonauthorizingInputScale: number;
}

interface OracleReconstruction {
  readonly nonauthorizingWeights: readonly number[];
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

interface OraclePlan {
  readonly amountOut: bigint;
  readonly allocations: readonly bigint[];
  readonly legs: readonly {
    readonly routeIndex: number;
    readonly hops: number;
    readonly allocation: bigint;
  }[];
}

interface NamedFixture {
  readonly id: string;
  readonly amountIn: bigint;
  readonly routes: readonly PathShadowPriceResolvedRoute[];
  readonly expectedModels: readonly ExpectedModel[];
  readonly expectedWeightBits: readonly string[];
  readonly expectedIntegerWeights: readonly bigint[];
  readonly expectedBases: readonly bigint[];
  readonly expectedResidual: bigint;
  readonly exhaustiveBest?: {
    readonly allocations: readonly bigint[];
    readonly amountOut: bigint;
  };
}

interface ExpectedModel {
  readonly coefficients: readonly [bigint, bigint, bigint];
  readonly marginal: readonly [bigint, bigint, string];
  readonly input: readonly [bigint, bigint, string];
}

type OracleModelResult =
  | { readonly ok: true; readonly models: readonly OracleRouteModel[] }
  | { readonly ok: false; readonly code: 'non-finite-normalization' };

type OracleProposalResult =
  | {
      readonly ok: true;
      readonly models: readonly OracleRouteModel[];
      readonly reconstruction: OracleReconstruction;
    }
  | {
      readonly ok: false;
      readonly code: 'non-finite-normalization' | 'non-finite-proposal' | 'non-convergence';
      readonly completedOuterIterations: number;
      readonly models?: readonly OracleRouteModel[];
      readonly finalWeights?: readonly number[];
    };

const OUTER_ITERATIONS = 64;
const INNER_ITERATIONS = 64;
const CONVERGENCE_TOLERANCE = 2 ** -40;

function hop(
  reserveIn: bigint,
  reserveOut: bigint,
  feeDenominator = 1n,
  feeChargedNumerator = 0n,
): PathShadowPriceResolvedHop {
  return { reserveIn, reserveOut, feeChargedNumerator, feeDenominator };
}

function route(...hops: readonly PathShadowPriceResolvedHop[]): PathShadowPriceResolvedRoute {
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
  return [coefficientA / divisor, coefficientB / divisor, coefficientC / divisor];
}

function reducedRational(numerator: bigint, denominator: bigint): OracleRational {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function leadingBinarySignificand(value: bigint): {
  readonly significand: number;
  readonly exponent: number;
} {
  const digits = value.toString(2);
  const prefixLength = Math.min(53, digits.length);
  let prefix = 0;
  for (let index = 0; index < prefixLength; index += 1) {
    prefix = prefix * 2 + (digits[index] === '1' ? 1 : 0);
  }
  return {
    significand: prefix / 2 ** (prefixLength - 1),
    exponent: digits.length - 1,
  };
}

function normalizedRational(value: OracleRational): number | undefined {
  const numerator = leadingBinarySignificand(value.numerator);
  const denominator = leadingBinarySignificand(value.denominator);
  const exponentDifference = numerator.exponent - denominator.exponent;
  const result =
    (numerator.significand / denominator.significand) * 2 ** exponentDifference;
  if (!Number.isFinite(result) || result < 2 ** -1022) return undefined;
  return result;
}

function oracleRouteModel(
  resolvedRoute: PathShadowPriceResolvedRoute,
  amountIn: bigint,
): OracleRouteModel | undefined {
  let coefficients: readonly [bigint, bigint, bigint] | undefined;
  for (const resolvedHop of resolvedRoute) {
    const multiplier = resolvedHop.feeDenominator - resolvedHop.feeChargedNumerator;
    const hopCoefficients = primitiveTriple(
      multiplier * resolvedHop.reserveOut,
      resolvedHop.feeDenominator * resolvedHop.reserveIn,
      multiplier,
    );
    if (coefficients === undefined) {
      coefficients = hopCoefficients;
      continue;
    }
    const [coefficientA1, coefficientB1, coefficientC1] = coefficients;
    const [coefficientA2, coefficientB2, coefficientC2] = hopCoefficients;
    coefficients = primitiveTriple(
      coefficientA1 * coefficientA2,
      coefficientB1 * coefficientB2,
      coefficientB2 * coefficientC1 + coefficientC2 * coefficientA1,
    );
  }
  assert.ok(coefficients !== undefined);
  const [coefficientA, coefficientB, coefficientC] = coefficients;
  const exactMarginalScale = reducedRational(coefficientA, coefficientB);
  const exactInputScale = reducedRational(coefficientC * amountIn, coefficientB);
  const nonauthorizingMarginalScale = normalizedRational(exactMarginalScale);
  const nonauthorizingInputScale = normalizedRational(exactInputScale);
  if (
    nonauthorizingMarginalScale === undefined ||
    nonauthorizingInputScale === undefined
  ) {
    return undefined;
  }
  return {
    coefficientA,
    coefficientB,
    coefficientC,
    exactMarginalScale,
    exactInputScale,
    nonauthorizingMarginalScale,
    nonauthorizingInputScale,
  };
}

function oracleModels(
  routes: readonly PathShadowPriceResolvedRoute[],
  amountIn: bigint,
): OracleModelResult {
  const models: OracleRouteModel[] = [];
  for (const resolvedRoute of routes) {
    const model = oracleRouteModel(resolvedRoute, amountIn);
    if (model === undefined) return { ok: false, code: 'non-finite-normalization' };
    models.push(model);
  }
  return { ok: true, models };
}

function validFinite(value: number): boolean {
  return Number.isFinite(value);
}

function oracleShare(
  marginalScale: number,
  inputScale: number,
  lambda: number,
): number | undefined {
  if (lambda >= marginalScale) return 0;
  const onePlusInputScale = 1 + inputScale;
  const endpointSquare = onePlusInputScale * onePlusInputScale;
  const endpointMarginal = marginalScale / endpointSquare;
  if (
    !validFinite(onePlusInputScale) ||
    onePlusInputScale <= 0 ||
    !validFinite(endpointSquare) ||
    endpointSquare <= 0 ||
    !validFinite(endpointMarginal) ||
    endpointMarginal <= 0
  ) {
    return undefined;
  }
  if (lambda <= endpointMarginal) return 1;

  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < INNER_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const product = inputScale * midpoint;
    const denominator = 1 + product;
    const denominatorSquare = denominator * denominator;
    const marginal = marginalScale / denominatorSquare;
    if (
      !validFinite(midpoint) ||
      midpoint < 0 ||
      midpoint > 1 ||
      !validFinite(product) ||
      product < 0 ||
      !validFinite(denominator) ||
      denominator <= 0 ||
      !validFinite(denominatorSquare) ||
      denominatorSquare <= 0 ||
      !validFinite(marginal) ||
      marginal <= 0
    ) {
      return undefined;
    }
    if (marginal > lambda) lower = midpoint;
    else upper = midpoint;
  }

  const share = (lower + upper) / 2;
  const product = inputScale * share;
  const denominator = 1 + product;
  const denominatorSquare = denominator * denominator;
  const marginal = marginalScale / denominatorSquare;
  if (
    !validFinite(share) ||
    share < 0 ||
    share > 1 ||
    !validFinite(product) ||
    product < 0 ||
    !validFinite(denominator) ||
    denominator <= 0 ||
    !validFinite(denominatorSquare) ||
    denominatorSquare <= 0 ||
    !validFinite(marginal) ||
    marginal <= 0
  ) {
    return undefined;
  }
  return share;
}

function reconstructOracle(
  amountIn: bigint,
  weights: readonly number[],
): OracleReconstruction | 'invalid-reconstruction' | 'zero-total-weight' {
  if (amountIn <= 0n) return 'invalid-reconstruction';
  const decoded: { readonly significand: bigint; readonly exponent: bigint }[] = [];
  let minimumExponent: bigint | undefined;
  for (const weight of weights) {
    const raw = float64Bits(weight);
    const sign = raw >> 63n;
    const exponentBits = (raw >> 52n) & 0x7ffn;
    const fraction = raw & ((1n << 52n) - 1n);
    if (sign !== 0n || exponentBits === 0x7ffn) return 'invalid-reconstruction';
    if (exponentBits === 0n) {
      if (fraction !== 0n) return 'invalid-reconstruction';
      decoded.push({ significand: 0n, exponent: 0n });
      continue;
    }
    const exponent = exponentBits - 1023n - 52n;
    const significand = (1n << 52n) + fraction;
    decoded.push({ significand, exponent });
    if (minimumExponent === undefined || exponent < minimumExponent) {
      minimumExponent = exponent;
    }
  }
  if (minimumExponent === undefined) return 'zero-total-weight';
  const integerWeights = decoded.map(({ significand, exponent }) =>
    significand === 0n ? 0n : significand << (exponent - minimumExponent),
  );
  const totalWeight = integerWeights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) return 'zero-total-weight';
  const baseAllocations = integerWeights.map(
    (integerWeight) => (amountIn * integerWeight) / totalWeight,
  );
  const baseTotal = baseAllocations.reduce((sum, allocation) => sum + allocation, 0n);
  return {
    nonauthorizingWeights: [...weights],
    integerWeights,
    baseAllocations,
    residualUnits: amountIn - baseTotal,
  };
}

function oracleLambdaMidpoint(lower: number, upper: number): number | undefined {
  const difference = upper - lower;
  const halfDifference = difference / 2;
  if (
    !validFinite(difference) ||
    difference < 0 ||
    !validFinite(halfDifference) ||
    (difference > 0 && halfDifference === 0)
  ) {
    return undefined;
  }
  const midpoint = lower + halfDifference;
  if (!validFinite(midpoint) || midpoint < 0) return undefined;
  return midpoint;
}

function oracleProposal(
  routes: readonly PathShadowPriceResolvedRoute[],
  amountIn: bigint,
): OracleProposalResult {
  const modeled = oracleModels(routes, amountIn);
  if (!modeled.ok) return { ok: false, code: modeled.code, completedOuterIterations: 0 };
  let lambdaLower = 0;
  let lambdaUpper = 0;
  for (const model of modeled.models) {
    if (model.nonauthorizingMarginalScale > lambdaUpper) {
      lambdaUpper = model.nonauthorizingMarginalScale;
    }
  }

  for (let iteration = 0; iteration < OUTER_ITERATIONS; iteration += 1) {
    const lambda = oracleLambdaMidpoint(lambdaLower, lambdaUpper);
    if (lambda === undefined) {
      return {
        ok: false,
        code: 'non-finite-proposal',
        completedOuterIterations: iteration,
        models: modeled.models,
      };
    }
    let sum = 0;
    for (const model of modeled.models) {
      const share = oracleShare(
        model.nonauthorizingMarginalScale,
        model.nonauthorizingInputScale,
        lambda,
      );
      if (share === undefined) {
        return {
          ok: false,
          code: 'non-finite-proposal',
          completedOuterIterations: iteration,
          models: modeled.models,
        };
      }
      sum += share;
    }
    if (!validFinite(sum) || sum < 0 || sum > modeled.models.length) {
      return {
        ok: false,
        code: 'non-finite-proposal',
        completedOuterIterations: iteration,
        models: modeled.models,
      };
    }
    if (sum > 1) lambdaLower = lambda;
    else lambdaUpper = lambda;
  }

  const finalLambda = oracleLambdaMidpoint(lambdaLower, lambdaUpper);
  if (finalLambda === undefined) {
    return {
      ok: false,
      code: 'non-finite-proposal',
      completedOuterIterations: OUTER_ITERATIONS,
      models: modeled.models,
    };
  }
  const finalWeights: number[] = [];
  let sum = 0;
  for (const model of modeled.models) {
    const share = oracleShare(
      model.nonauthorizingMarginalScale,
      model.nonauthorizingInputScale,
      finalLambda,
    );
    if (share === undefined) {
      return {
        ok: false,
        code: 'non-finite-proposal',
        completedOuterIterations: OUTER_ITERATIONS,
        models: modeled.models,
      };
    }
    finalWeights.push(share);
    sum += share;
  }
  if (!validFinite(sum) || sum <= 0 || sum > modeled.models.length) {
    return {
      ok: false,
      code: 'non-finite-proposal',
      completedOuterIterations: OUTER_ITERATIONS,
      models: modeled.models,
    };
  }
  const difference = sum - 1;
  const absoluteDifference = difference < 0 ? -difference : difference;
  if (absoluteDifference > CONVERGENCE_TOLERANCE) {
    return {
      ok: false,
      code: 'non-convergence',
      completedOuterIterations: OUTER_ITERATIONS,
      models: modeled.models,
      finalWeights,
    };
  }
  const reconstruction = reconstructOracle(amountIn, finalWeights);
  assert.notEqual(reconstruction, 'invalid-reconstruction');
  assert.notEqual(reconstruction, 'zero-total-weight');
  if (typeof reconstruction === 'string') throw new Error('Unexpected oracle reconstruction.');
  return { ok: true, models: modeled.models, reconstruction };
}

function float64Bits(value: number): bigint {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false);
}

function float64Hex(value: number): string {
  return float64Bits(value).toString(16).padStart(16, '0');
}

function modelProjection(models: readonly PathShadowPriceRouteModel[]) {
  return models.map((model) => ({
    coefficients: [model.coefficientA, model.coefficientB, model.coefficientC],
    marginal: [
      model.exactMarginalScale.numerator,
      model.exactMarginalScale.denominator,
      float64Hex(model.nonauthorizingMarginalScale),
    ],
    input: [
      model.exactInputScale.numerator,
      model.exactInputScale.denominator,
      float64Hex(model.nonauthorizingInputScale),
    ],
  }));
}

function oracleModelProjection(models: readonly OracleRouteModel[]) {
  return models.map((model) => ({
    coefficients: [model.coefficientA, model.coefficientB, model.coefficientC],
    marginal: [
      model.exactMarginalScale.numerator,
      model.exactMarginalScale.denominator,
      float64Hex(model.nonauthorizingMarginalScale),
    ],
    input: [
      model.exactInputScale.numerator,
      model.exactInputScale.denominator,
      float64Hex(model.nonauthorizingInputScale),
    ],
  }));
}

function expectedModelProjection(models: readonly ExpectedModel[]) {
  return models.map(({ coefficients, marginal, input }) => ({
    coefficients: [...coefficients],
    marginal: [...marginal],
    input: [...input],
  }));
}

function capturedConfiguration(): CapturedPathShadowPriceConfiguration {
  const result = capturePathShadowPriceConfiguration({
    outerIterations: OUTER_ITERATIONS,
    innerIterations: INNER_ITERATIONS,
    convergenceTolerance: CONVERGENCE_TOLERANCE,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected valid numerical configuration.');
  return result.value;
}

function prepareActual(
  configuration: CapturedPathShadowPriceConfiguration,
  fixture: Pick<NamedFixture, 'amountIn' | 'routes'>,
) {
  return preparePathShadowPriceProposal({
    amountIn: fixture.amountIn,
    routes: fixture.routes,
    configuration,
  });
}

function advanceToReady(
  initialState: PathShadowPriceIterationState,
  id: string,
): PathShadowPriceReadyState {
  let state = initialState;
  let ready: PathShadowPriceReadyState | undefined;
  for (let update = 1; update <= OUTER_ITERATIONS; update += 1) {
    const advanced = advancePathShadowPriceProposal(state);
    assert.equal(advanced.ok, true, `${id}: outer update ${update} must succeed`);
    if (!advanced.ok) throw new Error(`${id}: unexpected outer failure`);
    assert.equal(advanced.value.state.completedOuterIterations, update, id);
    if (update < OUTER_ITERATIONS) {
      assert.equal(advanced.value.status, 'continue', id);
      if (advanced.value.status !== 'continue') throw new Error(`${id}: became ready early`);
      state = advanced.value.state;
    } else {
      assert.equal(advanced.value.status, 'ready', id);
      if (advanced.value.status !== 'ready') throw new Error(`${id}: did not become ready`);
      ready = advanced.value.state;
    }
  }
  assert.ok(ready !== undefined);
  return ready;
}

function assertActualSuccess(
  configuration: CapturedPathShadowPriceConfiguration,
  fixture: Pick<NamedFixture, 'id' | 'amountIn' | 'routes'>,
  expected: Extract<OracleProposalResult, { readonly ok: true }>,
): void {
  const prepared = prepareActual(configuration, fixture);
  assert.equal(prepared.ok, true, `${fixture.id}: preparation`);
  if (!prepared.ok) throw new Error(`${fixture.id}: unexpected preparation failure`);
  assert.deepEqual(
    modelProjection(prepared.value.routeModels),
    oracleModelProjection(expected.models),
    `${fixture.id}: route models`,
  );
  const ready = advanceToReady(prepared.value.state, fixture.id);
  const finalized = finalizePathShadowPriceProposal(ready);
  assert.equal(finalized.ok, true, `${fixture.id}: finalization`);
  if (!finalized.ok) throw new Error(`${fixture.id}: unexpected finalization failure`);
  assert.equal(finalized.value.converged, true, fixture.id);
  assert.equal(finalized.value.completedOuterIterations, OUTER_ITERATIONS, fixture.id);
  assert.equal(finalized.value.configuredInnerIterations, INNER_ITERATIONS, fixture.id);
  assert.deepEqual(
    finalized.value.reconstruction.nonauthorizingWeights.map(float64Hex),
    expected.reconstruction.nonauthorizingWeights.map(float64Hex),
    `${fixture.id}: weights`,
  );
  assert.deepEqual(
    finalized.value.reconstruction.integerWeights,
    expected.reconstruction.integerWeights,
    `${fixture.id}: integer weights`,
  );
  assert.deepEqual(
    finalized.value.reconstruction.baseAllocations,
    expected.reconstruction.baseAllocations,
    `${fixture.id}: base allocations`,
  );
  assert.equal(
    finalized.value.reconstruction.residualUnits,
    expected.reconstruction.residualUnits,
    `${fixture.id}: residual`,
  );
  assert.equal(
    finalized.value.reconstruction.baseAllocations.reduce(
      (sum, allocation) => sum + allocation,
      0n,
    ) + finalized.value.reconstruction.residualUnits,
    fixture.amountIn,
    `${fixture.id}: exact reconstruction identity`,
  );
}

function exactRouteOutput(
  resolvedRoute: PathShadowPriceResolvedRoute,
  allocation: bigint,
): bigint | undefined {
  let amount = allocation;
  for (const resolvedHop of resolvedRoute) {
    const multiplier = resolvedHop.feeDenominator - resolvedHop.feeChargedNumerator;
    amount =
      (amount * multiplier * resolvedHop.reserveOut) /
      (resolvedHop.reserveIn * resolvedHop.feeDenominator + amount * multiplier);
    if (amount === 0n) return undefined;
  }
  return amount;
}

function exactPlan(
  routes: readonly PathShadowPriceResolvedRoute[],
  allocations: readonly bigint[],
): OraclePlan | undefined {
  const legs: OraclePlan['legs'][number][] = [];
  let amountOut = 0n;
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const allocation = allocations[routeIndex];
    const resolvedRoute = routes[routeIndex];
    assert.ok(allocation !== undefined && resolvedRoute !== undefined);
    if (allocation === 0n) continue;
    const routeOutput = exactRouteOutput(resolvedRoute, allocation);
    if (routeOutput === undefined) return undefined;
    amountOut += routeOutput;
    legs.push({ routeIndex, hops: resolvedRoute.length, allocation });
  }
  if (legs.length === 0) return undefined;
  return { amountOut, allocations: [...allocations], legs };
}

function compareExactPlans(left: OraclePlan, right: OraclePlan): number {
  if (left.amountOut !== right.amountOut) return left.amountOut > right.amountOut ? -1 : 1;
  if (left.legs.length !== right.legs.length) return left.legs.length - right.legs.length;
  const leftHops = left.legs.reduce((sum, leg) => sum + leg.hops, 0);
  const rightHops = right.legs.reduce((sum, leg) => sum + leg.hops, 0);
  if (leftHops !== rightHops) return leftHops - rightHops;
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftRouteIndex = left.legs[index]?.routeIndex;
    const rightRouteIndex = right.legs[index]?.routeIndex;
    assert.ok(leftRouteIndex !== undefined && rightRouteIndex !== undefined);
    if (leftRouteIndex !== rightRouteIndex) return leftRouteIndex - rightRouteIndex;
  }
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftAllocation = left.legs[index]?.allocation;
    const rightAllocation = right.legs[index]?.allocation;
    assert.ok(leftAllocation !== undefined && rightAllocation !== undefined);
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? -1 : 1;
  }
  return 0;
}

function nonnegativeCompositions(total: bigint, slots: number): readonly bigint[][] {
  if (slots === 1) return [[total]];
  const output: bigint[][] = [];
  for (let allocation = 0n; allocation <= total; allocation += 1n) {
    for (const suffix of nonnegativeCompositions(total - allocation, slots - 1)) {
      output.push([allocation, ...suffix]);
    }
  }
  return output;
}

function exhaustiveBest(
  routes: readonly PathShadowPriceResolvedRoute[],
  amountIn: bigint,
): OraclePlan | undefined {
  const plans: OraclePlan[] = [];
  for (const allocations of nonnegativeCompositions(amountIn, routes.length)) {
    const plan = exactPlan(routes, allocations);
    if (plan !== undefined) plans.push(plan);
  }
  return plans.sort(compareExactPlans)[0];
}

function residualReference(
  routes: readonly PathShadowPriceResolvedRoute[],
  amountIn: bigint,
  reconstruction: OracleReconstruction,
): OraclePlan | undefined {
  let allocations = [...reconstruction.baseAllocations];
  let allocated = amountIn - reconstruction.residualUnits;
  while (allocated < amountIn) {
    const options: OraclePlan[] = [];
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const trial = [...allocations];
      const prior = trial[routeIndex];
      assert.ok(prior !== undefined);
      trial[routeIndex] = prior + 1n;
      const plan = exactPlan(routes, trial);
      if (plan !== undefined) options.push(plan);
    }
    const winner = options.sort(compareExactPlans)[0];
    if (winner === undefined) return undefined;
    allocations = [...winner.allocations];
    allocated += 1n;
  }
  return exactPlan(routes, allocations);
}

const U = 10n ** 80n;
const K = 2n ** 60n;

const NAMED_FIXTURES: readonly NamedFixture[] = [
  {
    id: 'N00-identical-optimum-golden',
    amountIn: 2n,
    routes: [route(hop(1n, 2n)), route(hop(1n, 2n))],
    expectedModels: [
      { coefficients: [2n, 1n, 1n], marginal: [2n, 1n, '4000000000000000'], input: [2n, 1n, '4000000000000000'] },
      { coefficients: [2n, 1n, 1n], marginal: [2n, 1n, '4000000000000000'], input: [2n, 1n, '4000000000000000'] },
    ],
    expectedWeightBits: ['3fdffffffffffffe', '3fdffffffffffffe'],
    expectedIntegerWeights: [9007199254740990n, 9007199254740990n],
    expectedBases: [1n, 1n],
    expectedResidual: 0n,
    exhaustiveBest: { allocations: [1n, 1n], amountOut: 2n },
  },
  {
    id: 'N01-allocation-vector-tie-golden',
    amountIn: 3n,
    routes: [route(hop(4n, 9n)), route(hop(1n, 9n))],
    expectedModels: [
      { coefficients: [9n, 4n, 1n], marginal: [9n, 4n, '4002000000000000'], input: [3n, 4n, '3fe8000000000000'] },
      { coefficients: [9n, 1n, 1n], marginal: [9n, 1n, '4022000000000000'], input: [3n, 1n, '4008000000000000'] },
    ],
    expectedWeightBits: ['3fdc71c71c71c724', '3fe1c71c71c71c74'],
    expectedIntegerWeights: [8006399337547556n, 10007999171934440n],
    expectedBases: [1n, 1n],
    expectedResidual: 1n,
    exhaustiveBest: { allocations: [1n, 2n], amountOut: 7n },
  },
  {
    id: 'N02-coarse-greedy-gap',
    amountIn: 5n,
    routes: [route(hop(1n, 3n)), route(hop(3n, 4n))],
    expectedModels: [
      { coefficients: [3n, 1n, 1n], marginal: [3n, 1n, '4008000000000000'], input: [5n, 1n, '4014000000000000'] },
      { coefficients: [4n, 3n, 1n], marginal: [4n, 3n, '3ff5555555555555'], input: [5n, 3n, '3ffaaaaaaaaaaaab'] },
    ],
    expectedWeightBits: ['3fd999999999999c', '3fe3333333333334'],
    expectedIntegerWeights: [7205759403792796n, 10808639105689192n],
    expectedBases: [2n, 2n],
    expectedResidual: 1n,
    exhaustiveBest: { allocations: [2n, 3n], amountOut: 4n },
  },
  {
    id: 'N03-positive-input-activation',
    amountIn: 3n,
    routes: [route(hop(1n, 2n)), route(hop(2n, 2n))],
    expectedModels: [
      { coefficients: [2n, 1n, 1n], marginal: [2n, 1n, '4000000000000000'], input: [3n, 1n, '4008000000000000'] },
      { coefficients: [2n, 2n, 1n], marginal: [1n, 1n, '3ff0000000000000'], input: [3n, 2n, '3ff8000000000000'] },
    ],
    expectedWeightBits: ['3fdfaf9ddea4890e', '3fe0283110adbb78'],
    expectedIntegerWeights: [8918816858081550n, 9095581651400432n],
    expectedBases: [1n, 1n],
    expectedResidual: 1n,
    exhaustiveBest: { allocations: [1n, 2n], amountOut: 2n },
  },
  {
    id: 'N04-symmetric-floor-gap',
    amountIn: 2n,
    routes: [route(hop(4n, 9n)), route(hop(4n, 9n))],
    expectedModels: [
      { coefficients: [9n, 4n, 1n], marginal: [9n, 4n, '4002000000000000'], input: [1n, 2n, '3fe0000000000000'] },
      { coefficients: [9n, 4n, 1n], marginal: [9n, 4n, '4002000000000000'], input: [1n, 2n, '3fe0000000000000'] },
    ],
    expectedWeightBits: ['3fdffffffffffffc', '3fdffffffffffffc'],
    expectedIntegerWeights: [9007199254740988n, 9007199254740988n],
    expectedBases: [1n, 1n],
    expectedResidual: 0n,
    exhaustiveBest: { allocations: [2n, 0n], amountOut: 3n },
  },
  {
    id: 'N05-fee-and-two-hop-composition',
    amountIn: 6n,
    routes: [
      route(hop(10n, 20n, 10n, 1n), hop(15n, 12n, 20n, 1n)),
      route(hop(8n, 10n)),
    ],
    expectedModels: [
      { coefficients: [342n, 250n, 51n], marginal: [171n, 125n, '3ff5e353f7ced917'], input: [153n, 125n, '3ff395810624dd2f'] },
      { coefficients: [10n, 8n, 1n], marginal: [5n, 4n, '3ff4000000000000'], input: [3n, 4n, '3fe8000000000000'] },
    ],
    expectedWeightBits: ['3fda78420d93843a', '3fe2c3def9363de2'],
    expectedIntegerWeights: [7450574485423162n, 10563824024058820n],
    expectedBases: [2n, 3n],
    expectedResidual: 1n,
    exhaustiveBest: { allocations: [0n, 6n], amountOut: 4n },
  },
  {
    id: 'N06-nonzero-fees',
    amountIn: 7n,
    routes: [route(hop(10n, 20n, 10n, 1n)), route(hop(7n, 15n, 100n, 3n))],
    expectedModels: [
      { coefficients: [180n, 100n, 9n], marginal: [9n, 5n, '3ffccccccccccccd'], input: [63n, 100n, '3fe428f5c28f5c29'] },
      { coefficients: [1455n, 700n, 97n], marginal: [291n, 140n, '4000a0ea0ea0ea0f'], input: [97n, 100n, '3fef0a3d70a3d70a'] },
    ],
    expectedWeightBits: ['3fe165a36b0048de', '3fdd34b929ff6e46'],
    expectedIntegerWeights: [9793654306673084n, 8220744202808902n],
    expectedBases: [3n, 3n],
    expectedResidual: 1n,
    exhaustiveBest: { allocations: [2n, 5n], amountOut: 9n },
  },
  {
    id: 'N07-10e80-exact-reconstruction',
    amountIn: 3n * U + 2n,
    routes: [route(hop(U, U)), route(hop(U, 2n * U))],
    expectedModels: [
      { coefficients: [U, U, 1n], marginal: [1n, 1n, '3ff0000000000000'], input: [(3n * U + 2n) / 2n, U / 2n, '4008000000000001'] },
      { coefficients: [2n * U, U, 1n], marginal: [2n, 1n, '4000000000000000'], input: [(3n * U + 2n) / 2n, U / 2n, '4008000000000001'] },
    ],
    expectedWeightBits: ['3fd6d97555fae402', '3fe4934555028e02'],
    expectedIntegerWeights: [6431547464541186n, 11582851044940804n],
    expectedBases: [
      107106781186547548165816805582890081377465480031414098727577933285204793952405405n,
      192893218813452451834183194417109918622534519968585901272422066714795206047594596n,
    ],
    expectedResidual: 1n,
  },
  {
    id: 'N08-three-route-deterministic-tie',
    amountIn: 11n,
    routes: [route(hop(5n, 7n)), route(hop(5n, 7n)), route(hop(5n, 7n))],
    expectedModels: [
      { coefficients: [7n, 5n, 1n], marginal: [7n, 5n, '3ff6666666666666'], input: [11n, 5n, '400199999999999a'] },
      { coefficients: [7n, 5n, 1n], marginal: [7n, 5n, '3ff6666666666666'], input: [11n, 5n, '400199999999999a'] },
      { coefficients: [7n, 5n, 1n], marginal: [7n, 5n, '3ff6666666666666'], input: [11n, 5n, '400199999999999a'] },
    ],
    expectedWeightBits: ['3fd5555555555556', '3fd5555555555556', '3fd5555555555556'],
    expectedIntegerWeights: [6004799503160662n, 6004799503160662n, 6004799503160662n],
    expectedBases: [3n, 3n, 3n],
    expectedResidual: 2n,
    exhaustiveBest: { allocations: [2n, 2n, 7n], amountOut: 8n },
  },
];

void test('captures the frozen numerical configuration before proposal work', () => {
  const reads: string[] = [];
  const source = {
    get outerIterations() {
      reads.push('outerIterations');
      return OUTER_ITERATIONS;
    },
    get innerIterations() {
      reads.push('innerIterations');
      return INNER_ITERATIONS;
    },
    get convergenceTolerance() {
      reads.push('convergenceTolerance');
      return CONVERGENCE_TOLERANCE;
    },
  };
  const captured = capturePathShadowPriceConfiguration(source);
  assert.equal(captured.ok, true);
  if (!captured.ok) throw new Error('Expected configuration capture success.');
  assert.deepEqual(reads, ['outerIterations', 'innerIterations', 'convergenceTolerance']);
  assert.deepEqual(
    {
      outerIterations: captured.value.outerIterations,
      innerIterations: captured.value.innerIterations,
      convergenceTolerance: captured.value.convergenceTolerance,
    },
    {
      outerIterations: OUTER_ITERATIONS,
      innerIterations: INNER_ITERATIONS,
      convergenceTolerance: CONVERGENCE_TOLERANCE,
    },
  );
});

void test('matches the independently hand-frozen N00 through N08 core observations', () => {
  const configuration = capturedConfiguration();
  for (const fixture of NAMED_FIXTURES) {
    const expected = oracleProposal(fixture.routes, fixture.amountIn);
    assert.equal(expected.ok, true, `${fixture.id}: independent proposal`);
    if (!expected.ok) throw new Error(`${fixture.id}: unexpected independent failure`);
    assert.deepEqual(
      oracleModelProjection(expected.models),
      expectedModelProjection(fixture.expectedModels),
      `${fixture.id}: frozen model derivation`,
    );
    assert.deepEqual(
      expected.reconstruction.nonauthorizingWeights.map(float64Hex),
      fixture.expectedWeightBits,
      `${fixture.id}: frozen weight bits`,
    );
    assert.deepEqual(
      expected.reconstruction.integerWeights,
      fixture.expectedIntegerWeights,
      `${fixture.id}: frozen integer weights`,
    );
    assert.deepEqual(
      expected.reconstruction.baseAllocations,
      fixture.expectedBases,
      `${fixture.id}: frozen bases`,
    );
    assert.equal(expected.reconstruction.residualUnits, fixture.expectedResidual, fixture.id);
    assertActualSuccess(configuration, fixture, expected);

    if (fixture.exhaustiveBest !== undefined) {
      const best = exhaustiveBest(fixture.routes, fixture.amountIn);
      assert.ok(best !== undefined, `${fixture.id}: exhaustive plan`);
      assert.deepEqual(best.allocations, fixture.exhaustiveBest.allocations, fixture.id);
      assert.equal(best.amountOut, fixture.exhaustiveBest.amountOut, fixture.id);
    }
  }
});

void test('reports N09 binary64 stagnation as non-convergence after 64 updates', () => {
  const fixture = {
    id: 'N09-binary-stagnation-nonconvergence',
    amountIn: 1n,
    routes: [route(hop(10n * K, 3n * K)), route(hop(K, 8n * K))],
  };
  const expected = oracleProposal(fixture.routes, fixture.amountIn);
  assert.equal(expected.ok, false);
  if (expected.ok) throw new Error('Expected independent non-convergence.');
  assert.equal(expected.code, 'non-convergence');
  assert.equal(expected.completedOuterIterations, OUTER_ITERATIONS);
  assert.deepEqual(expected.finalWeights?.map(float64Hex), [
    '3ff0000000000000',
    '3ff0000000000000',
  ]);
  assert.deepEqual(oracleModelProjection(expected.models ?? []), [
    {
      coefficients: [3458764513820540928n, 11529215046068469760n, 1n],
      marginal: [3n, 10n, '3fd3333333333333'],
      input: [1n, 11529215046068469760n, '3bf999999999999a'],
    },
    {
      coefficients: [9223372036854775808n, 1152921504606846976n, 1n],
      marginal: [8n, 1n, '4020000000000000'],
      input: [1n, 1152921504606846976n, '3c30000000000000'],
    },
  ]);

  const prepared = prepareActual(capturedConfiguration(), fixture);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error('Expected N09 preparation success.');
  assert.deepEqual(modelProjection(prepared.value.routeModels), oracleModelProjection(expected.models ?? []));
  const ready = advanceToReady(prepared.value.state, fixture.id);
  const finalized = finalizePathShadowPriceProposal(ready);
  assert.deepEqual(finalized, {
    ok: false,
    error: {
      code: 'non-convergence',
      converged: false,
      completedOuterIterations: OUTER_ITERATIONS,
    },
  });
});

void test('classifies the frozen N10 normalization and proposal failures', () => {
  const configuration = capturedConfiguration();
  const huge = 1n << 1100n;
  const normalizationCases = [
    { id: 's-underflow', amountIn: 1n, routes: [route(hop(huge, 1n)), route(hop(1n, 1n))] },
    { id: 's-overflow', amountIn: 1n, routes: [route(hop(1n, huge)), route(hop(1n, 1n))] },
    { id: 'q-overflow', amountIn: huge, routes: [route(hop(1n, 1n)), route(hop(1n, 1n))] },
  ] as const;
  for (const fixture of normalizationCases) {
    const independent = oracleProposal(fixture.routes, fixture.amountIn);
    assert.equal(independent.ok, false, fixture.id);
    if (independent.ok) throw new Error(`${fixture.id}: expected independent failure`);
    assert.equal(independent.code, 'non-finite-normalization', fixture.id);
    const prepared = prepareActual(configuration, fixture);
    assert.deepEqual(prepared, {
      ok: false,
      error: {
        code: 'non-finite-normalization',
        converged: false,
        completedOuterIterations: 0,
      },
    });
  }

  const proposalOverflow = {
    id: 'proposal-product-overflow',
    amountIn: 1n << 700n,
    routes: [route(hop(1n, 1n)), route(hop(1n, 1n))],
  };
  const independent = oracleProposal(proposalOverflow.routes, proposalOverflow.amountIn);
  assert.equal(independent.ok, false);
  if (independent.ok) throw new Error('Expected independent proposal failure.');
  assert.equal(independent.code, 'non-finite-proposal');
  assert.equal(independent.completedOuterIterations, 0);
  const prepared = prepareActual(configuration, proposalOverflow);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error('Expected proposal-overflow preparation success.');
  const advanced = advancePathShadowPriceProposal(prepared.value.state);
  assert.deepEqual(advanced, {
    ok: false,
    error: { code: 'non-finite-proposal', converged: false, completedOuterIterations: 0 },
  });

  const minimumNormalDenominator = 1n << 1022n;
  const lambdaHalvingUnderflow = {
    id: 'lambda-halving-underflow',
    amountIn: 1n,
    routes: [
      route(hop(minimumNormalDenominator, 1n)),
      route(hop(1n << 1021n, 1n)),
    ],
  };
  const underflowExpected = oracleProposal(
    lambdaHalvingUnderflow.routes,
    lambdaHalvingUnderflow.amountIn,
  );
  assert.equal(underflowExpected.ok, false);
  if (underflowExpected.ok) throw new Error('Expected lambda-halving underflow.');
  assert.equal(underflowExpected.code, 'non-finite-proposal');
  assert.equal(underflowExpected.completedOuterIterations, 53);
  assert.deepEqual(oracleModelProjection(underflowExpected.models ?? []), [
    {
      coefficients: [1n, minimumNormalDenominator, 1n],
      marginal: [1n, minimumNormalDenominator, '0010000000000000'],
      input: [1n, minimumNormalDenominator, '0010000000000000'],
    },
    {
      coefficients: [1n, 1n << 1021n, 1n],
      marginal: [1n, 1n << 1021n, '0020000000000000'],
      input: [1n, 1n << 1021n, '0020000000000000'],
    },
  ]);

  const underflowPrepared = prepareActual(configuration, lambdaHalvingUnderflow);
  assert.equal(underflowPrepared.ok, true);
  if (!underflowPrepared.ok) throw new Error('Expected halving-underflow preparation.');
  assert.deepEqual(
    modelProjection(underflowPrepared.value.routeModels),
    oracleModelProjection(underflowExpected.models ?? []),
  );
  let underflowState = underflowPrepared.value.state;
  for (let update = 1; update <= 53; update += 1) {
    const successful = advancePathShadowPriceProposal(underflowState);
    assert.equal(successful.ok, true, `halving underflow update ${update}`);
    if (!successful.ok) throw new Error('Lambda halving failed before the frozen boundary.');
    assert.equal(successful.value.status, 'continue');
    if (successful.value.status !== 'continue') throw new Error('Became ready before underflow.');
    assert.equal(successful.value.state.completedOuterIterations, update);
    underflowState = successful.value.state;
  }
  assert.deepEqual(advancePathShadowPriceProposal(underflowState), {
    ok: false,
    error: {
      code: 'non-finite-proposal',
      converged: false,
      completedOuterIterations: 53,
    },
  });
});

void test('decodes and reconstructs the frozen N11 IEEE-754 literals exactly', () => {
  const ordinary = reconstructPathShadowPriceBase(10n, [0.5, 0.25, 0]);
  assert.equal(ordinary.ok, true);
  if (!ordinary.ok) throw new Error('Expected ordinary reconstruction success.');
  assert.deepEqual(ordinary.value.nonauthorizingWeights.map(float64Hex), [
    '3fe0000000000000',
    '3fd0000000000000',
    '0000000000000000',
  ]);
  assert.deepEqual(ordinary.value.integerWeights, [2n ** 53n, 2n ** 52n, 0n]);
  assert.deepEqual(ordinary.value.baseAllocations, [6n, 3n, 0n]);
  assert.equal(ordinary.value.residualUnits, 1n);
  assert.deepEqual(ordinary.value, reconstructOracle(10n, [0.5, 0.25, 0]));

  for (const invalid of [-0, Number.MIN_VALUE, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.deepEqual(reconstructPathShadowPriceBase(1n, [invalid]), {
      ok: false,
      error: { code: 'invalid-reconstruction' },
    });
  }
  assert.deepEqual(reconstructPathShadowPriceBase(1n, [0, 0]), {
    ok: false,
    error: { code: 'zero-total-weight' },
  });

  const extremes = reconstructPathShadowPriceBase(12n, [2 ** -1022, Number.MAX_VALUE]);
  assert.equal(extremes.ok, true);
  if (!extremes.ok) throw new Error('Expected extreme reconstruction success.');
  assert.deepEqual(extremes.value.integerWeights, [
    2n ** 52n,
    ((2n ** 53n) - 1n) << 2045n,
  ]);
  assert.deepEqual(extremes.value.baseAllocations, [0n, 11n]);
  assert.equal(extremes.value.residualUnits, 1n);
  assert.deepEqual(extremes.value, reconstructOracle(12n, [2 ** -1022, Number.MAX_VALUE]));
});

void test('matches all 576 result-blind core cells and retains qualified exhaustive references', () => {
  const configuration = capturedConfiguration();
  const feeSchedules = [
    { feeChargedNumerator: 0n, feeDenominator: 1n },
    { feeChargedNumerator: 1n, feeDenominator: 10n },
  ] as const;
  const reservePairs = [
    [1n, 2n],
    [1n, 3n],
    [1n, 9n],
    [2n, 2n],
    [3n, 4n],
    [4n, 9n],
  ] as const;
  const shapes = feeSchedules.flatMap(({ feeChargedNumerator, feeDenominator }) =>
    reservePairs.map(([reserveIn, reserveOut]) =>
      hop(reserveIn, reserveOut, feeDenominator, feeChargedNumerator),
    ),
  );
  const inputs = [2n, 3n, 5n, 12n] as const;
  let cells = 0;
  let converged = 0;
  let noExecutableExactSplit = 0;
  let residualOptionsExhausted = 0;
  let scored = 0;
  let outputMatches = 0;
  let lowerOutputs = 0;
  let completeObjectiveMatches = 0;

  for (let leftIndex = 0; leftIndex < shapes.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < shapes.length; rightIndex += 1) {
      for (const amountIn of inputs) {
        const left = shapes[leftIndex];
        const right = shapes[rightIndex];
        assert.ok(left !== undefined && right !== undefined);
        const id = `grid-${leftIndex}-${rightIndex}-${amountIn.toString(10)}`;
        const routes = [route(left), route(right)];
        const expected = oracleProposal(routes, amountIn);
        assert.equal(expected.ok, true, `${id}: independent proposal`);
        if (!expected.ok) throw new Error(`${id}: unexpected independent failure`);
        assertActualSuccess(configuration, { id, amountIn, routes }, expected);
        cells += 1;
        converged += 1;

        const best = exhaustiveBest(routes, amountIn);
        if (best === undefined) noExecutableExactSplit += 1;
        const scoredPlan = residualReference(routes, amountIn, expected.reconstruction);
        if (scoredPlan === undefined) {
          residualOptionsExhausted += 1;
          continue;
        }
        scored += 1;
        assert.ok(best !== undefined, `${id}: a scored plan implies an exhaustive plan`);
        if (scoredPlan.amountOut === best.amountOut) outputMatches += 1;
        else if (scoredPlan.amountOut < best.amountOut) lowerOutputs += 1;
        else assert.fail(`${id}: bounded proposal exceeded exhaustive output`);
        if (compareExactPlans(scoredPlan, best) === 0) completeObjectiveMatches += 1;
      }
    }
  }

  assert.deepEqual(
    {
      cells,
      converged,
      noExecutableExactSplit,
      residualOptionsExhausted,
      scored,
      outputMatches,
      lowerOutputs,
      completeObjectiveMatches,
    },
    {
      cells: 576,
      converged: 576,
      noExecutableExactSplit: 1,
      residualOptionsExhausted: 31,
      scored: 545,
      outputMatches: 514,
      lowerOutputs: 31,
      completeObjectiveMatches: 349,
    },
  );
});
