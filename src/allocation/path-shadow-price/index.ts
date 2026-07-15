import type {
  AdvancePathShadowPriceProposalResult,
  CapturedPathShadowPriceConfiguration,
  CapturePathShadowPriceConfigurationResult,
  FinalizePathShadowPriceProposalResult,
  PathShadowPriceBaseReconstruction,
  PathShadowPriceConfigurationError,
  PathShadowPriceCoreFailure,
  PathShadowPriceCoreFailureCode,
  PathShadowPriceIterationState,
  PathShadowPriceProposalRequest,
  PathShadowPriceReadyState,
  PathShadowPriceReducedRational,
  PathShadowPriceRouteModel,
  PreparePathShadowPriceProposalResult,
  ReconstructPathShadowPriceBaseResult,
} from './types.ts';

export type {
  AdvancePathShadowPriceProposalResult,
  CapturedPathShadowPriceConfiguration,
  CapturePathShadowPriceConfigurationResult,
  FinalizePathShadowPriceProposalResult,
  PathShadowPriceBaseReconstruction,
  PathShadowPriceConfigurationError,
  PathShadowPriceConfigurationInput,
  PathShadowPriceCoreFailure,
  PathShadowPriceCoreFailureCode,
  PathShadowPriceIterationState,
  PathShadowPriceProposalRequest,
  PathShadowPriceReadyState,
  PathShadowPriceReducedRational,
  PathShadowPriceResolvedHop,
  PathShadowPriceResolvedRoute,
  PathShadowPriceRouteModel,
  PreparePathShadowPriceProposalResult,
  ReconstructPathShadowPriceBaseResult,
} from './types.ts';

interface CapturedResolvedHop {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

interface ProposalStateData {
  readonly amountIn: bigint;
  readonly configuration: CapturedPathShadowPriceConfiguration;
  readonly routeModels: readonly PathShadowPriceRouteModel[];
  readonly lambdaLower: number;
  readonly lambdaUpper: number;
  readonly completedOuterIterations: number;
}

interface DecodedWeight {
  readonly significand: bigint;
  readonly binaryExponent: number;
}

type ProposalSampleResult =
  | { readonly ok: true; readonly weights: readonly number[]; readonly sum: number }
  | { readonly ok: false };

const MINIMUM_NORMAL_NUMBER = 2 ** -1022;
const MAXIMUM_ITERATIONS = 256;
const BINARY_PREFIX_BITS = 53;
const BIT_LENGTH_CHUNK = 1_024;
const BIT_LENGTH_CHUNK_BIGINT = 1_024n;
const BIT_LENGTH_CHUNK_THRESHOLD = 1n << BIT_LENGTH_CHUNK_BIGINT;
const FRACTION_MASK = (1n << 52n) - 1n;
const IMPLICIT_SIGNIFICAND_BIT = 1n << 52n;

const capturedConfigurations = new WeakSet<CapturedPathShadowPriceConfiguration>();
const iterationStates = new WeakMap<PathShadowPriceIterationState, ProposalStateData>();
const readyStates = new WeakMap<PathShadowPriceReadyState, ProposalStateData>();

function configurationFailure(
  error: PathShadowPriceConfigurationError,
): CapturePathShadowPriceConfigurationResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

function coreFailure(
  code: PathShadowPriceCoreFailureCode,
  converged: boolean,
  completedOuterIterations: number,
): { readonly ok: false; readonly error: PathShadowPriceCoreFailure } {
  const error: PathShadowPriceCoreFailure = Object.freeze({
    code,
    converged,
    completedOuterIterations,
  });
  return Object.freeze({ ok: false, error });
}

function reconstructionFailure(
  code: 'zero-total-weight' | 'invalid-reconstruction',
): ReconstructPathShadowPriceBaseResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) });
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isValidIterationCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAXIMUM_ITERATIONS
  );
}

function isValidTolerance(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    !Object.is(value, -0) &&
    value >= MINIMUM_NORMAL_NUMBER &&
    value <= 1
  );
}

function captureUnknownArray(value: unknown): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const source = value as readonly unknown[];
    const length = source.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const captured: unknown[] = [];
    for (let index = 0; index < length; index += 1) captured.push(source[index]);
    return captured;
  } catch {
    return undefined;
  }
}

function captureResolvedHop(value: unknown): CapturedResolvedHop | undefined {
  if (!isObject(value)) return undefined;
  const source = value as Record<string, unknown>;
  let reserveIn: unknown;
  let reserveOut: unknown;
  let feeChargedNumerator: unknown;
  let feeDenominator: unknown;
  try {
    reserveIn = source['reserveIn'];
    reserveOut = source['reserveOut'];
    feeChargedNumerator = source['feeChargedNumerator'];
    feeDenominator = source['feeDenominator'];
  } catch {
    return undefined;
  }
  if (
    typeof reserveIn !== 'bigint' ||
    reserveIn <= 0n ||
    typeof reserveOut !== 'bigint' ||
    reserveOut <= 0n ||
    typeof feeChargedNumerator !== 'bigint' ||
    feeChargedNumerator < 0n ||
    typeof feeDenominator !== 'bigint' ||
    feeDenominator <= 0n ||
    feeChargedNumerator >= feeDenominator
  ) {
    return undefined;
  }
  return Object.freeze({
    reserveIn,
    reserveOut,
    feeChargedNumerator,
    feeDenominator,
  });
}

function captureResolvedRoutes(value: unknown): readonly (readonly CapturedResolvedHop[])[] | undefined {
  const sourceRoutes = captureUnknownArray(value);
  if (sourceRoutes === undefined || sourceRoutes.length < 2) return undefined;
  const routes: Array<readonly CapturedResolvedHop[]> = [];
  for (const sourceRoute of sourceRoutes) {
    const sourceHops = captureUnknownArray(sourceRoute);
    if (sourceHops === undefined || sourceHops.length === 0) return undefined;
    const hops: CapturedResolvedHop[] = [];
    for (const sourceHop of sourceHops) {
      const hop = captureResolvedHop(sourceHop);
      if (hop === undefined) return undefined;
      hops.push(hop);
    }
    routes.push(Object.freeze(hops));
  }
  return Object.freeze(routes);
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

function reduceCoefficientTriple(
  coefficientA: bigint,
  coefficientB: bigint,
  coefficientC: bigint,
): readonly [bigint, bigint, bigint] | undefined {
  if (coefficientA <= 0n || coefficientB <= 0n || coefficientC <= 0n) {
    return undefined;
  }
  const divisor = greatestCommonDivisor(
    greatestCommonDivisor(coefficientA, coefficientB),
    coefficientC,
  );
  if (divisor <= 0n) return undefined;
  const reducedA = coefficientA / divisor;
  const reducedB = coefficientB / divisor;
  const reducedC = coefficientC / divisor;
  if (reducedA <= 0n || reducedB <= 0n || reducedC <= 0n) return undefined;
  return Object.freeze([reducedA, reducedB, reducedC]);
}

function reduceRational(
  numerator: bigint,
  denominator: bigint,
): PathShadowPriceReducedRational | undefined {
  if (numerator <= 0n || denominator <= 0n) return undefined;
  const divisor = greatestCommonDivisor(numerator, denominator);
  if (divisor <= 0n) return undefined;
  const reducedNumerator = numerator / divisor;
  const reducedDenominator = denominator / divisor;
  if (reducedNumerator <= 0n || reducedDenominator <= 0n) return undefined;
  return Object.freeze({
    numerator: reducedNumerator,
    denominator: reducedDenominator,
  });
}

function structuralBitLength(value: bigint): number | undefined {
  if (value <= 0n) return undefined;
  let remaining = value;
  let bitLength = 0;
  while (remaining >= BIT_LENGTH_CHUNK_THRESHOLD) {
    if (bitLength > Number.MAX_SAFE_INTEGER - BIT_LENGTH_CHUNK) return undefined;
    remaining >>= BIT_LENGTH_CHUNK_BIGINT;
    bitLength += BIT_LENGTH_CHUNK;
  }
  while (remaining !== 0n) {
    if (bitLength === Number.MAX_SAFE_INTEGER) return undefined;
    remaining >>= 1n;
    bitLength += 1;
  }
  return Number.isSafeInteger(bitLength) && bitLength > 0 ? bitLength : undefined;
}

function normalizePositiveBigint(
  value: bigint,
): { readonly significand: number; readonly exponent: number } | undefined {
  const bitLength = structuralBitLength(value);
  if (bitLength === undefined) return undefined;
  const exponent = bitLength - 1;
  if (!Number.isSafeInteger(exponent) || exponent < 0) return undefined;
  const prefixBits = Math.min(BINARY_PREFIX_BITS, bitLength);
  const discardedBits = bitLength - prefixBits;
  if (!Number.isSafeInteger(discardedBits) || discardedBits < 0) return undefined;
  const leadingBits = value >> BigInt(discardedBits);
  let prefix = 0;
  for (let bitIndex = prefixBits - 1; bitIndex >= 0; bitIndex -= 1) {
    const bit = (leadingBits >> BigInt(bitIndex)) & 1n;
    prefix = prefix * 2 + (bit === 1n ? 1 : 0);
  }
  const divisor = 2 ** (prefixBits - 1);
  const significand = prefix / divisor;
  if (!Number.isFinite(significand) || significand < 1 || significand >= 2) {
    return undefined;
  }
  return Object.freeze({ significand, exponent });
}

function normalizeReducedRational(
  rational: PathShadowPriceReducedRational,
): number | undefined {
  const numerator = normalizePositiveBigint(rational.numerator);
  if (numerator === undefined) return undefined;
  const denominator = normalizePositiveBigint(rational.denominator);
  if (denominator === undefined) return undefined;
  const exponentDifference = numerator.exponent - denominator.exponent;
  if (!Number.isSafeInteger(exponentDifference)) return undefined;
  const significandRatio = numerator.significand / denominator.significand;
  const powerOfTwo = 2 ** exponentDifference;
  const ratio = significandRatio * powerOfTwo;
  if (
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    ratio < MINIMUM_NORMAL_NUMBER
  ) {
    return undefined;
  }
  return ratio;
}

function buildRouteModel(
  route: readonly CapturedResolvedHop[],
  amountIn: bigint,
): PathShadowPriceRouteModel | 'invalid-route-model' | 'non-finite-normalization' {
  let coefficients: readonly [bigint, bigint, bigint] | undefined;
  for (const hop of route) {
    const multiplier = hop.feeDenominator - hop.feeChargedNumerator;
    const next = reduceCoefficientTriple(
      multiplier * hop.reserveOut,
      hop.feeDenominator * hop.reserveIn,
      multiplier,
    );
    if (next === undefined) return 'invalid-route-model';
    if (coefficients === undefined) {
      coefficients = next;
      continue;
    }
    const composed = reduceCoefficientTriple(
      coefficients[0] * next[0],
      coefficients[1] * next[1],
      next[1] * coefficients[2] + next[2] * coefficients[0],
    );
    if (composed === undefined) return 'invalid-route-model';
    coefficients = composed;
  }
  if (coefficients === undefined) return 'invalid-route-model';
  const exactMarginalScale = reduceRational(coefficients[0], coefficients[1]);
  const exactInputScale = reduceRational(coefficients[2] * amountIn, coefficients[1]);
  if (exactMarginalScale === undefined || exactInputScale === undefined) {
    return 'invalid-route-model';
  }
  const nonauthorizingMarginalScale = normalizeReducedRational(exactMarginalScale);
  if (nonauthorizingMarginalScale === undefined) return 'non-finite-normalization';
  const nonauthorizingInputScale = normalizeReducedRational(exactInputScale);
  if (nonauthorizingInputScale === undefined) return 'non-finite-normalization';
  return Object.freeze({
    coefficientA: coefficients[0],
    coefficientB: coefficients[1],
    coefficientC: coefficients[2],
    exactMarginalScale,
    exactInputScale,
    nonauthorizingMarginalScale,
    nonauthorizingInputScale,
  });
}

function createIterationState(data: ProposalStateData): PathShadowPriceIterationState {
  const state = Object.freeze({
    completedOuterIterations: data.completedOuterIterations,
  }) as PathShadowPriceIterationState;
  iterationStates.set(state, data);
  return state;
}

function createReadyState(data: ProposalStateData): PathShadowPriceReadyState {
  const state = Object.freeze({
    completedOuterIterations: data.completedOuterIterations,
  }) as PathShadowPriceReadyState;
  readyStates.set(state, data);
  return state;
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isUnitShare(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function checkedPositiveHalving(value: number): number | undefined {
  const result = value / 2;
  if (!isFiniteNonnegative(result)) return undefined;
  if (value > 0 && result === 0) return undefined;
  return result;
}

function shareAtLambda(
  marginalScale: number,
  inputScale: number,
  lambda: number,
  innerIterations: number,
): number | undefined {
  if (lambda >= marginalScale) return 0;
  const onePlusInputScale = 1 + inputScale;
  if (!isFinitePositive(onePlusInputScale)) return undefined;
  const endpointDenominator = onePlusInputScale * onePlusInputScale;
  if (!isFinitePositive(endpointDenominator)) return undefined;
  const endpointMarginal = marginalScale / endpointDenominator;
  if (!isFinitePositive(endpointMarginal)) return undefined;
  if (lambda <= endpointMarginal) return 1;

  let shareLower = 0;
  let shareUpper = 1;
  for (let iteration = 0; iteration < innerIterations; iteration += 1) {
    const shareSum = shareLower + shareUpper;
    if (!Number.isFinite(shareSum) || shareSum < 0 || shareSum > 2) return undefined;
    const shareMid = checkedPositiveHalving(shareSum);
    if (shareMid === undefined || !isUnitShare(shareMid)) return undefined;
    const scaledShare = inputScale * shareMid;
    if (!isFiniteNonnegative(scaledShare)) return undefined;
    if (inputScale > 0 && shareMid > 0 && scaledShare === 0) return undefined;
    const denominator = 1 + scaledShare;
    if (!isFinitePositive(denominator)) return undefined;
    const denominatorSquared = denominator * denominator;
    if (!isFinitePositive(denominatorSquared)) return undefined;
    const marginal = marginalScale / denominatorSquared;
    if (!isFinitePositive(marginal)) return undefined;
    if (marginal > lambda) shareLower = shareMid;
    else shareUpper = shareMid;
  }

  const finalShareSum = shareLower + shareUpper;
  if (!Number.isFinite(finalShareSum) || finalShareSum < 0 || finalShareSum > 2) {
    return undefined;
  }
  const shareMid = checkedPositiveHalving(finalShareSum);
  if (shareMid === undefined || !isUnitShare(shareMid)) return undefined;
  const scaledShare = inputScale * shareMid;
  if (!isFiniteNonnegative(scaledShare)) return undefined;
  if (inputScale > 0 && shareMid > 0 && scaledShare === 0) return undefined;
  const denominator = 1 + scaledShare;
  if (!isFinitePositive(denominator)) return undefined;
  const denominatorSquared = denominator * denominator;
  if (!isFinitePositive(denominatorSquared)) return undefined;
  const marginal = marginalScale / denominatorSquared;
  if (!isFinitePositive(marginal)) return undefined;
  return shareMid;
}

function lambdaMidpoint(lambdaLower: number, lambdaUpper: number): number | undefined {
  const difference = lambdaUpper - lambdaLower;
  if (!isFiniteNonnegative(difference)) return undefined;
  const halfDifference = checkedPositiveHalving(difference);
  if (halfDifference === undefined) return undefined;
  const lambdaMid = lambdaLower + halfDifference;
  if (!isFiniteNonnegative(lambdaMid)) return undefined;
  return lambdaMid;
}

function sampleProposal(data: ProposalStateData, lambda: number): ProposalSampleResult {
  const weights: number[] = [];
  let sum = 0;
  for (const model of data.routeModels) {
    const weight = shareAtLambda(
      model.nonauthorizingMarginalScale,
      model.nonauthorizingInputScale,
      lambda,
      data.configuration.innerIterations,
    );
    if (weight === undefined) return Object.freeze({ ok: false });
    const nextSum = sum + weight;
    if (
      !Number.isFinite(nextSum) ||
      nextSum < 0 ||
      nextSum > data.routeModels.length
    ) {
      return Object.freeze({ ok: false });
    }
    weights.push(weight);
    sum = nextSum;
  }
  return Object.freeze({ ok: true, weights: Object.freeze(weights), sum });
}

function decodeWeight(value: number): DecodedWeight | 0 | undefined {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, value, false);
  let bits = 0n;
  for (let index = 0; index < bytes.length; index += 1) {
    bits = (bits << 8n) | BigInt(view.getUint8(index));
  }
  const firstByte = view.getUint8(0);
  if ((firstByte & 0x80) !== 0) return undefined;
  const exponentBits = (bits >> 52n) & 0x7ffn;
  const fraction = bits & FRACTION_MASK;
  if (exponentBits === 0n) return fraction === 0n ? 0 : undefined;
  if (exponentBits === 0x7ffn) return undefined;
  const exponent = ((firstByte & 0x7f) * 16) + (view.getUint8(1) >> 4);
  return Object.freeze({
    significand: IMPLICIT_SIGNIFICAND_BIT + fraction,
    binaryExponent: exponent - 1_023 - 52,
  });
}

function reconstructCapturedWeights(
  amountIn: bigint,
  nonauthorizingWeights: readonly number[],
): ReconstructPathShadowPriceBaseResult {
  if (typeof amountIn !== 'bigint' || amountIn <= 0n) {
    return reconstructionFailure('invalid-reconstruction');
  }
  const decodedWeights: Array<DecodedWeight | 0> = [];
  let minimumExponent: number | undefined;
  let positiveWeightCount = 0;
  for (const weight of nonauthorizingWeights) {
    if (typeof weight !== 'number') return reconstructionFailure('invalid-reconstruction');
    const decoded = decodeWeight(weight);
    if (decoded === undefined) return reconstructionFailure('invalid-reconstruction');
    decodedWeights.push(decoded);
    if (decoded === 0) continue;
    positiveWeightCount += 1;
    if (minimumExponent === undefined || decoded.binaryExponent < minimumExponent) {
      minimumExponent = decoded.binaryExponent;
    }
  }
  if (minimumExponent === undefined || positiveWeightCount === 0) {
    return reconstructionFailure('zero-total-weight');
  }

  const integerWeights: bigint[] = [];
  let totalIntegerWeight = 0n;
  for (const decoded of decodedWeights) {
    if (decoded === 0) {
      integerWeights.push(0n);
      continue;
    }
    const shift = decoded.binaryExponent - minimumExponent;
    if (!Number.isSafeInteger(shift) || shift < 0) {
      return reconstructionFailure('invalid-reconstruction');
    }
    const integerWeight = decoded.significand << BigInt(shift);
    if (integerWeight <= 0n) return reconstructionFailure('invalid-reconstruction');
    integerWeights.push(integerWeight);
    totalIntegerWeight += integerWeight;
  }
  if (totalIntegerWeight <= 0n) return reconstructionFailure('zero-total-weight');

  const baseAllocations: bigint[] = [];
  let allocatedTotal = 0n;
  for (const integerWeight of integerWeights) {
    const baseAllocation = (amountIn * integerWeight) / totalIntegerWeight;
    if (baseAllocation < 0n) return reconstructionFailure('invalid-reconstruction');
    baseAllocations.push(baseAllocation);
    allocatedTotal += baseAllocation;
    if (allocatedTotal > amountIn) return reconstructionFailure('invalid-reconstruction');
  }
  const residualUnits = amountIn - allocatedTotal;
  if (
    residualUnits < 0n ||
    residualUnits >= BigInt(positiveWeightCount) ||
    allocatedTotal + residualUnits !== amountIn
  ) {
    return reconstructionFailure('invalid-reconstruction');
  }

  const value: PathShadowPriceBaseReconstruction = Object.freeze({
    nonauthorizingWeights: Object.freeze([...nonauthorizingWeights]),
    integerWeights: Object.freeze(integerWeights),
    baseAllocations: Object.freeze(baseAllocations),
    residualUnits,
  });
  return Object.freeze({ ok: true, value });
}

/** @internal */
export function capturePathShadowPriceConfiguration(
  input: unknown,
): CapturePathShadowPriceConfigurationResult {
  if (!isObject(input)) {
    return configurationFailure({
      code: 'invalid-numerical-configuration',
      field: 'numerical',
    });
  }
  const source = input as Record<string, unknown>;
  let outerIterations: unknown;
  try {
    outerIterations = source['outerIterations'];
  } catch {
    return configurationFailure({
      code: 'invalid-outer-iterations',
      field: 'numerical.outerIterations',
    });
  }
  if (!isValidIterationCount(outerIterations)) {
    return configurationFailure({
      code: 'invalid-outer-iterations',
      field: 'numerical.outerIterations',
    });
  }
  let innerIterations: unknown;
  try {
    innerIterations = source['innerIterations'];
  } catch {
    return configurationFailure({
      code: 'invalid-inner-iterations',
      field: 'numerical.innerIterations',
    });
  }
  if (!isValidIterationCount(innerIterations)) {
    return configurationFailure({
      code: 'invalid-inner-iterations',
      field: 'numerical.innerIterations',
    });
  }
  let convergenceTolerance: unknown;
  try {
    convergenceTolerance = source['convergenceTolerance'];
  } catch {
    return configurationFailure({
      code: 'invalid-convergence-tolerance',
      field: 'numerical.convergenceTolerance',
    });
  }
  if (!isValidTolerance(convergenceTolerance)) {
    return configurationFailure({
      code: 'invalid-convergence-tolerance',
      field: 'numerical.convergenceTolerance',
    });
  }
  const value = Object.freeze({
    outerIterations,
    innerIterations,
    convergenceTolerance,
  }) as CapturedPathShadowPriceConfiguration;
  capturedConfigurations.add(value);
  return Object.freeze({ ok: true, value });
}

/** @internal */
export function preparePathShadowPriceProposal(
  request: PathShadowPriceProposalRequest,
): PreparePathShadowPriceProposalResult {
  let amountIn: unknown;
  let sourceRoutes: unknown;
  let configuration: unknown;
  try {
    amountIn = request.amountIn;
  } catch {
    return coreFailure('invalid-route-model', false, 0);
  }
  try {
    sourceRoutes = request.routes;
  } catch {
    return coreFailure('invalid-route-model', false, 0);
  }
  try {
    configuration = request.configuration;
  } catch {
    throw new TypeError('Path shadow-price configuration capture failed.');
  }
  if (
    !isObject(configuration) ||
    !capturedConfigurations.has(configuration as CapturedPathShadowPriceConfiguration)
  ) {
    throw new TypeError('Path shadow-price configuration was not captured by this module.');
  }
  if (typeof amountIn !== 'bigint' || amountIn <= 0n) {
    return coreFailure('invalid-route-model', false, 0);
  }
  const routes = captureResolvedRoutes(sourceRoutes);
  if (routes === undefined) return coreFailure('invalid-route-model', false, 0);

  const routeModels: PathShadowPriceRouteModel[] = [];
  for (const route of routes) {
    const model = buildRouteModel(route, amountIn);
    if (model === 'invalid-route-model') {
      return coreFailure('invalid-route-model', false, 0);
    }
    if (model === 'non-finite-normalization') {
      return coreFailure('non-finite-normalization', false, 0);
    }
    routeModels.push(model);
  }
  const frozenRouteModels = Object.freeze(routeModels);
  let lambdaUpper = 0;
  for (const model of frozenRouteModels) {
    if (model.nonauthorizingMarginalScale > lambdaUpper) {
      lambdaUpper = model.nonauthorizingMarginalScale;
    }
  }
  if (!isFinitePositive(lambdaUpper)) {
    return coreFailure('non-finite-proposal', false, 0);
  }
  const data: ProposalStateData = Object.freeze({
    amountIn,
    configuration: configuration as CapturedPathShadowPriceConfiguration,
    routeModels: frozenRouteModels,
    lambdaLower: 0,
    lambdaUpper,
    completedOuterIterations: 0,
  });
  const state = createIterationState(data);
  const value = Object.freeze({ state, routeModels: frozenRouteModels });
  return Object.freeze({ ok: true, value });
}

/** @internal */
export function advancePathShadowPriceProposal(
  state: PathShadowPriceIterationState,
): AdvancePathShadowPriceProposalResult {
  const data = iterationStates.get(state);
  if (data === undefined) {
    throw new TypeError('Expected a current path shadow-price iteration state.');
  }
  const lambdaMid = lambdaMidpoint(data.lambdaLower, data.lambdaUpper);
  if (lambdaMid === undefined) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  const sample = sampleProposal(data, lambdaMid);
  if (!sample.ok) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  const completedOuterIterations = data.completedOuterIterations + 1;
  const nextData: ProposalStateData = Object.freeze({
    ...data,
    lambdaLower: sample.sum > 1 ? lambdaMid : data.lambdaLower,
    lambdaUpper: sample.sum > 1 ? data.lambdaUpper : lambdaMid,
    completedOuterIterations,
  });
  if (completedOuterIterations === data.configuration.outerIterations) {
    const readyState = createReadyState(nextData);
    const value = Object.freeze({ status: 'ready' as const, state: readyState });
    return Object.freeze({ ok: true, value });
  }
  const iterationState = createIterationState(nextData);
  const value = Object.freeze({ status: 'continue' as const, state: iterationState });
  return Object.freeze({ ok: true, value });
}

/** @internal */
export function finalizePathShadowPriceProposal(
  state: PathShadowPriceReadyState,
): FinalizePathShadowPriceProposalResult {
  const data = readyStates.get(state);
  if (data === undefined) {
    throw new TypeError('Expected a ready path shadow-price proposal state.');
  }
  const lambdaMid = lambdaMidpoint(data.lambdaLower, data.lambdaUpper);
  if (lambdaMid === undefined) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  const sample = sampleProposal(data, lambdaMid);
  if (!sample.ok) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  if (!isFinitePositive(sample.sum)) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  const difference = sample.sum - 1;
  if (!Number.isFinite(difference)) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  const absoluteDifference = difference < 0 ? -difference : difference;
  if (!Number.isFinite(absoluteDifference)) {
    return coreFailure('non-finite-proposal', false, data.completedOuterIterations);
  }
  if (absoluteDifference > data.configuration.convergenceTolerance) {
    return coreFailure('non-convergence', false, data.completedOuterIterations);
  }
  const reconstruction = reconstructCapturedWeights(data.amountIn, sample.weights);
  if (!reconstruction.ok) {
    return coreFailure(reconstruction.error.code, true, data.completedOuterIterations);
  }
  const value = Object.freeze({
    converged: true as const,
    completedOuterIterations: data.completedOuterIterations,
    configuredInnerIterations: data.configuration.innerIterations,
    reconstruction: reconstruction.value,
  });
  return Object.freeze({ ok: true, value });
}

/** @internal */
export function reconstructPathShadowPriceBase(
  amountIn: bigint,
  nonauthorizingWeights: readonly number[],
): ReconstructPathShadowPriceBaseResult {
  const capturedAmountIn: unknown = amountIn;
  const capturedWeights = captureUnknownArray(nonauthorizingWeights);
  if (capturedWeights === undefined) return reconstructionFailure('invalid-reconstruction');
  return reconstructCapturedWeights(
    capturedAmountIn as bigint,
    capturedWeights as readonly number[],
  );
}
