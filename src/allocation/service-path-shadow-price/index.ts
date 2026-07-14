import type {
  PathShadowPriceReducedRational,
  PathShadowPriceResolvedRoute,
  PathShadowPriceRouteModel,
} from '../path-shadow-price/index.ts';

declare const servicePathShadowPriceStateBrand: unique symbol;

/** @internal */
export interface ServicePathShadowPriceState {
  readonly [servicePathShadowPriceStateBrand]: typeof servicePathShadowPriceStateBrand;
}

/** @internal */
export type ServicePathShadowPricePhase =
  | 'model-route'
  | 'proposal-start'
  | 'share-microstep'
  | 'reconstruction-step'
  | 'residual-option'
  | 'score-ready'
  | 'failed';

/** @internal */
export type ServicePathShadowPriceFailureCode =
  | 'invalid-route-model'
  | 'non-finite-normalization'
  | 'non-finite-proposal'
  | 'non-convergence'
  | 'zero-total-weight'
  | 'invalid-reconstruction'
  | 'residual-options-exhausted';

/** @internal */
export interface ServicePathShadowPriceFailure {
  readonly code: ServicePathShadowPriceFailureCode;
  readonly converged: boolean;
  readonly completedOuterUpdates: number;
}

/** @internal */
export interface ServicePathShadowPriceProgress {
  readonly phase: ServicePathShadowPricePhase;
  readonly routeCount: number;
  readonly modelRoutesCompleted: number;
  readonly outerUpdatesStarted: number;
  readonly outerUpdatesCompleted: number;
  readonly shareMicrosteps: number;
  readonly reconstructionSteps: number;
}

/** @internal */
export interface ServicePathShadowPriceResidualOption {
  readonly allocations: readonly bigint[];
  readonly routeIndex: number | null;
  readonly residualUnitsRemaining: bigint;
}

/** @internal */
export type ServicePathShadowPriceResidualOutcome =
  | 'rejected'
  | 'valid-not-best'
  | 'valid-best';

interface DecodedWeight {
  readonly significand: bigint;
  readonly binaryExponent: number;
}

/** @internal */
export type ServicePathShadowPriceStepResult =
  | {
      readonly ok: true;
      readonly phase: ServicePathShadowPricePhase;
      readonly outerUpdateStarted: boolean;
      readonly outerUpdateCompleted: boolean;
    }
  | {
      readonly ok: false;
      readonly error: ServicePathShadowPriceFailure;
    };

interface CapturedResolvedHop {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

interface MutableState {
  readonly amountIn: bigint;
  readonly routeCount: number;
  readonly models: PathShadowPriceRouteModel[];
  phase: ServicePathShadowPricePhase;
  lambdaLower: number;
  lambdaUpper: number;
  sampleKind: 'outer' | 'final';
  sampleLambda: number | undefined;
  sampleRouteIndex: number;
  sampleWeights: number[];
  sampleSum: number;
  shareStage: 'endpoint' | 'inner' | 'final';
  shareLower: number;
  shareUpper: number;
  innerUpdates: number;
  outerUpdatesStarted: number;
  outerUpdatesCompleted: number;
  shareMicrosteps: number;
  reconstructionPass: 0 | 1 | 2;
  reconstructionRouteIndex: number;
  reconstructionSteps: number;
  decodedWeights: Array<DecodedWeight | 0>;
  minimumExponent: number | undefined;
  positiveWeightCount: number;
  integerWeights: bigint[];
  totalIntegerWeight: bigint;
  baseAllocations: bigint[];
  allocatedTotal: bigint;
  initialResidualUnits: bigint | undefined;
  residualUnitsRemaining: bigint | undefined;
  residualOptionIndex: number;
  residualOptionPending: boolean;
  residualBestAllocations: readonly bigint[] | undefined;
  currentAllocations: readonly bigint[] | undefined;
  scoreAllocations: readonly bigint[] | undefined;
  readyWeights: readonly number[] | undefined;
  failure: ServicePathShadowPriceFailure | undefined;
}

const OUTER_UPDATES = 64;
const INNER_UPDATES = 64;
const CONVERGENCE_TOLERANCE = 2 ** -40;
const MINIMUM_NORMAL_NUMBER = 2 ** -1022;
const BINARY_PREFIX_BITS = 53;
const BIT_LENGTH_CHUNK = 1_024;
const BIT_LENGTH_CHUNK_BIGINT = 1_024n;
const BIT_LENGTH_CHUNK_THRESHOLD = 1n << BIT_LENGTH_CHUNK_BIGINT;
const FRACTION_MASK = (1n << 52n) - 1n;
const IMPLICIT_SIGNIFICAND_BIT = 1n << 52n;

const states = new WeakMap<ServicePathShadowPriceState, MutableState>();

function stateOf(handle: ServicePathShadowPriceState): MutableState {
  const state = states.get(handle);
  if (state === undefined) throw new TypeError('Unknown service shadow-price state.');
  return state;
}

function frozenFailure(
  code: ServicePathShadowPriceFailureCode,
  converged: boolean,
  completedOuterUpdates: number,
): ServicePathShadowPriceFailure {
  return Object.freeze({ code, converged, completedOuterUpdates });
}

function fail(
  state: MutableState,
  code: ServicePathShadowPriceFailureCode,
): ServicePathShadowPriceStepResult {
  const error = frozenFailure(
    code,
    state.readyWeights !== undefined,
    state.outerUpdatesCompleted,
  );
  state.failure = error;
  state.phase = 'failed';
  return Object.freeze({ ok: false, error });
}

function success(
  state: MutableState,
  outerUpdateStarted = false,
  outerUpdateCompleted = false,
): ServicePathShadowPriceStepResult {
  return Object.freeze({
    ok: true,
    phase: state.phase,
    outerUpdateStarted,
    outerUpdateCompleted,
  });
}

function captureResolvedRoute(value: unknown): readonly CapturedResolvedHop[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return undefined;
  const route: CapturedResolvedHop[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      const candidate: unknown = value[index];
      if (
        (typeof candidate !== 'object' && typeof candidate !== 'function') ||
        candidate === null
      ) {
        return undefined;
      }
      const source = candidate as Record<string, unknown>;
      const reserveIn = source['reserveIn'];
      const reserveOut = source['reserveOut'];
      const feeChargedNumerator = source['feeChargedNumerator'];
      const feeDenominator = source['feeDenominator'];
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
      route.push(
        Object.freeze({
          reserveIn,
          reserveOut,
          feeChargedNumerator,
          feeDenominator,
        }),
      );
    }
  } catch {
    return undefined;
  }
  return Object.freeze(route);
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
  return reducedA > 0n && reducedB > 0n && reducedC > 0n
    ? Object.freeze([reducedA, reducedB, reducedC])
    : undefined;
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
  return reducedNumerator > 0n && reducedDenominator > 0n
    ? Object.freeze({ numerator: reducedNumerator, denominator: reducedDenominator })
    : undefined;
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
  return Number.isFinite(significand) && significand >= 1 && significand < 2
    ? Object.freeze({ significand, exponent })
    : undefined;
}

function normalizeReducedRational(
  rational: PathShadowPriceReducedRational,
): number | undefined {
  const numerator = normalizePositiveBigint(rational.numerator);
  const denominator = normalizePositiveBigint(rational.denominator);
  if (numerator === undefined || denominator === undefined) return undefined;
  const exponentDifference = numerator.exponent - denominator.exponent;
  if (!Number.isSafeInteger(exponentDifference)) return undefined;
  const significandRatio = numerator.significand / denominator.significand;
  const powerOfTwo = 2 ** exponentDifference;
  const ratio = significandRatio * powerOfTwo;
  return Number.isFinite(ratio) && ratio > 0 && ratio >= MINIMUM_NORMAL_NUMBER
    ? ratio
    : undefined;
}

function buildRouteModel(
  route: readonly CapturedResolvedHop[],
  amountIn: bigint,
): PathShadowPriceRouteModel | ServicePathShadowPriceFailureCode {
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
  const nonauthorizingInputScale = normalizeReducedRational(exactInputScale);
  if (
    nonauthorizingMarginalScale === undefined ||
    nonauthorizingInputScale === undefined
  ) {
    return 'non-finite-normalization';
  }
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

function lambdaMidpoint(lambdaLower: number, lambdaUpper: number): number | undefined {
  const difference = lambdaUpper - lambdaLower;
  if (!isFiniteNonnegative(difference)) return undefined;
  const halfDifference = checkedPositiveHalving(difference);
  if (halfDifference === undefined) return undefined;
  const lambdaMid = lambdaLower + halfDifference;
  return isFiniteNonnegative(lambdaMid) ? lambdaMid : undefined;
}

function shareMidpointMarginal(
  model: PathShadowPriceRouteModel,
  shareLower: number,
  shareUpper: number,
): { readonly share: number; readonly marginal: number } | undefined {
  const shareSum = shareLower + shareUpper;
  if (!Number.isFinite(shareSum) || shareSum < 0 || shareSum > 2) return undefined;
  const share = checkedPositiveHalving(shareSum);
  if (share === undefined || !isUnitShare(share)) return undefined;
  const scaledShare = model.nonauthorizingInputScale * share;
  if (!isFiniteNonnegative(scaledShare)) return undefined;
  if (model.nonauthorizingInputScale > 0 && share > 0 && scaledShare === 0) {
    return undefined;
  }
  const denominator = 1 + scaledShare;
  if (!isFinitePositive(denominator)) return undefined;
  const denominatorSquared = denominator * denominator;
  if (!isFinitePositive(denominatorSquared)) return undefined;
  const marginal = model.nonauthorizingMarginalScale / denominatorSquared;
  return isFinitePositive(marginal) ? Object.freeze({ share, marginal }) : undefined;
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

function resetSample(state: MutableState): void {
  state.sampleLambda = undefined;
  state.sampleRouteIndex = 0;
  state.sampleWeights = [];
  state.sampleSum = 0;
  state.shareStage = 'endpoint';
  state.shareLower = 0;
  state.shareUpper = 1;
  state.innerUpdates = 0;
}

function completeRouteShare(
  state: MutableState,
  weight: number,
): ServicePathShadowPriceStepResult {
  const nextSum = state.sampleSum + weight;
  if (
    !Number.isFinite(nextSum) ||
    nextSum < 0 ||
    nextSum > state.routeCount
  ) {
    return fail(state, 'non-finite-proposal');
  }
  state.sampleWeights.push(weight);
  state.sampleSum = nextSum;
  if (state.sampleRouteIndex + 1 < state.routeCount) {
    state.sampleRouteIndex += 1;
    state.shareStage = 'endpoint';
    state.shareLower = 0;
    state.shareUpper = 1;
    state.innerUpdates = 0;
    return success(state);
  }

  if (state.sampleKind === 'outer') {
    const lambda = state.sampleLambda;
    if (lambda === undefined) return fail(state, 'non-finite-proposal');
    if (state.sampleSum > 1) state.lambdaLower = lambda;
    else state.lambdaUpper = lambda;
    state.outerUpdatesCompleted += 1;
    if (state.outerUpdatesCompleted === OUTER_UPDATES) state.sampleKind = 'final';
    resetSample(state);
    return success(state, false, true);
  }

  if (!isFinitePositive(state.sampleSum)) return fail(state, 'non-finite-proposal');
  const difference = state.sampleSum - 1;
  if (!Number.isFinite(difference)) return fail(state, 'non-finite-proposal');
  const absoluteDifference = difference < 0 ? -difference : difference;
  if (!Number.isFinite(absoluteDifference)) return fail(state, 'non-finite-proposal');
  if (absoluteDifference > CONVERGENCE_TOLERANCE) {
    return fail(state, 'non-convergence');
  }
  state.readyWeights = Object.freeze([...state.sampleWeights]);
  state.phase = 'reconstruction-step';
  return success(state);
}

/** @internal */
export function createServicePathShadowPriceState(
  amountIn: bigint,
  routeCount: number,
): ServicePathShadowPriceState {
  if (
    typeof amountIn !== 'bigint' ||
    amountIn <= 0n ||
    !Number.isSafeInteger(routeCount) ||
    routeCount < 2 ||
    routeCount > 4
  ) {
    throw new TypeError('Service shadow-price request is outside fixed bounds.');
  }
  const handle = Object.freeze({}) as ServicePathShadowPriceState;
  states.set(handle, {
    amountIn,
    routeCount,
    models: [],
    phase: 'model-route',
    lambdaLower: 0,
    lambdaUpper: 0,
    sampleKind: 'outer',
    sampleLambda: undefined,
    sampleRouteIndex: 0,
    sampleWeights: [],
    sampleSum: 0,
    shareStage: 'endpoint',
    shareLower: 0,
    shareUpper: 1,
    innerUpdates: 0,
    outerUpdatesStarted: 0,
    outerUpdatesCompleted: 0,
    shareMicrosteps: 0,
    reconstructionPass: 0,
    reconstructionRouteIndex: 0,
    reconstructionSteps: 0,
    decodedWeights: [],
    minimumExponent: undefined,
    positiveWeightCount: 0,
    integerWeights: [],
    totalIntegerWeight: 0n,
    baseAllocations: [],
    allocatedTotal: 0n,
    initialResidualUnits: undefined,
    residualUnitsRemaining: undefined,
    residualOptionIndex: 0,
    residualOptionPending: false,
    residualBestAllocations: undefined,
    currentAllocations: undefined,
    scoreAllocations: undefined,
    readyWeights: undefined,
    failure: undefined,
  });
  return handle;
}

/** @internal */
export function servicePathShadowPriceProgress(
  handle: ServicePathShadowPriceState,
): ServicePathShadowPriceProgress {
  const state = stateOf(handle);
  return Object.freeze({
    phase: state.phase,
    routeCount: state.routeCount,
    modelRoutesCompleted: state.models.length,
    outerUpdatesStarted: state.outerUpdatesStarted,
    outerUpdatesCompleted: state.outerUpdatesCompleted,
    shareMicrosteps: state.shareMicrosteps,
    reconstructionSteps: state.reconstructionSteps,
  });
}

/** @internal */
export function appendServicePathShadowPriceModelRoute(
  handle: ServicePathShadowPriceState,
  sourceRoute: PathShadowPriceResolvedRoute,
): ServicePathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'model-route' || state.models.length >= state.routeCount) {
    throw new TypeError('No service shadow-price model route is pending.');
  }
  const route = captureResolvedRoute(sourceRoute);
  if (route === undefined) return fail(state, 'invalid-route-model');
  const model = buildRouteModel(route, state.amountIn);
  if (typeof model === 'string') return fail(state, model);
  state.models.push(model);
  if (model.nonauthorizingMarginalScale > state.lambdaUpper) {
    state.lambdaUpper = model.nonauthorizingMarginalScale;
  }
  if (state.models.length === state.routeCount) state.phase = 'proposal-start';
  return success(state);
}

/** @internal */
export function startServicePathShadowPriceProposal(
  handle: ServicePathShadowPriceState,
): ServicePathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'proposal-start') {
    throw new TypeError('Service shadow-price proposal is not ready to start.');
  }
  if (!isFinitePositive(state.lambdaUpper)) return fail(state, 'non-finite-proposal');
  state.phase = 'share-microstep';
  state.sampleKind = 'outer';
  resetSample(state);
  return success(state);
}

/** @internal */
export function advanceServicePathShadowPriceShareMicrostep(
  handle: ServicePathShadowPriceState,
): ServicePathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'share-microstep') {
    throw new TypeError('No service shadow-price share microstep is pending.');
  }
  state.shareMicrosteps += 1;
  let outerUpdateStarted = false;
  if (state.sampleLambda === undefined) {
    const lambda = lambdaMidpoint(state.lambdaLower, state.lambdaUpper);
    if (lambda === undefined) return fail(state, 'non-finite-proposal');
    state.sampleLambda = lambda;
    if (state.sampleKind === 'outer') {
      state.outerUpdatesStarted += 1;
      outerUpdateStarted = true;
    }
  }
  const model = state.models[state.sampleRouteIndex];
  const lambda = state.sampleLambda;
  if (model === undefined || lambda === undefined) {
    return fail(state, 'non-finite-proposal');
  }

  if (state.shareStage === 'endpoint') {
    if (lambda >= model.nonauthorizingMarginalScale) {
      const result = completeRouteShare(state, 0);
      if (result.ok && outerUpdateStarted) {
        return success(state, true, result.outerUpdateCompleted);
      }
      return result;
    }
    const onePlusInputScale = 1 + model.nonauthorizingInputScale;
    if (!isFinitePositive(onePlusInputScale)) return fail(state, 'non-finite-proposal');
    const endpointDenominator = onePlusInputScale * onePlusInputScale;
    if (!isFinitePositive(endpointDenominator)) return fail(state, 'non-finite-proposal');
    const endpointMarginal =
      model.nonauthorizingMarginalScale / endpointDenominator;
    if (!isFinitePositive(endpointMarginal)) return fail(state, 'non-finite-proposal');
    if (lambda <= endpointMarginal) {
      const result = completeRouteShare(state, 1);
      if (result.ok && outerUpdateStarted) {
        return success(state, true, result.outerUpdateCompleted);
      }
      return result;
    }
    state.shareLower = 0;
    state.shareUpper = 1;
    state.innerUpdates = 0;
    state.shareStage = 'inner';
    return success(state, outerUpdateStarted, false);
  }

  if (state.shareStage === 'inner') {
    const midpoint = shareMidpointMarginal(
      model,
      state.shareLower,
      state.shareUpper,
    );
    if (midpoint === undefined) return fail(state, 'non-finite-proposal');
    if (midpoint.marginal > lambda) state.shareLower = midpoint.share;
    else state.shareUpper = midpoint.share;
    state.innerUpdates += 1;
    if (state.innerUpdates === INNER_UPDATES) state.shareStage = 'final';
    return success(state, outerUpdateStarted, false);
  }

  const midpoint = shareMidpointMarginal(
    model,
    state.shareLower,
    state.shareUpper,
  );
  if (midpoint === undefined) return fail(state, 'non-finite-proposal');
  const result = completeRouteShare(state, midpoint.share);
  if (result.ok && outerUpdateStarted) {
    return success(state, true, result.outerUpdateCompleted);
  }
  return result;
}

/** @internal */
export function advanceServicePathShadowPriceReconstructionStep(
  handle: ServicePathShadowPriceState,
): ServicePathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'reconstruction-step') {
    throw new TypeError('No service shadow-price reconstruction step is pending.');
  }
  const weights = state.readyWeights;
  const weight = weights?.[state.reconstructionRouteIndex];
  if (weights === undefined || weight === undefined) {
    return fail(state, 'invalid-reconstruction');
  }
  state.reconstructionSteps += 1;

  if (state.reconstructionPass === 0) {
    const decoded = decodeWeight(weight);
    if (decoded === undefined) return fail(state, 'invalid-reconstruction');
    state.decodedWeights.push(decoded);
    if (decoded !== 0) {
      state.positiveWeightCount += 1;
      if (
        state.minimumExponent === undefined ||
        decoded.binaryExponent < state.minimumExponent
      ) {
        state.minimumExponent = decoded.binaryExponent;
      }
    }
  } else if (state.reconstructionPass === 1) {
    const decoded = state.decodedWeights[state.reconstructionRouteIndex];
    if (decoded === undefined) return fail(state, 'invalid-reconstruction');
    if (decoded === 0) {
      state.integerWeights.push(0n);
    } else {
      const minimumExponent = state.minimumExponent;
      if (minimumExponent === undefined) return fail(state, 'zero-total-weight');
      const shift = decoded.binaryExponent - minimumExponent;
      if (!Number.isSafeInteger(shift) || shift < 0) {
        return fail(state, 'invalid-reconstruction');
      }
      const integerWeight = decoded.significand << BigInt(shift);
      if (integerWeight <= 0n) return fail(state, 'invalid-reconstruction');
      state.integerWeights.push(integerWeight);
      state.totalIntegerWeight += integerWeight;
    }
  } else {
    const integerWeight = state.integerWeights[state.reconstructionRouteIndex];
    if (integerWeight === undefined || state.totalIntegerWeight <= 0n) {
      return fail(
        state,
        state.totalIntegerWeight <= 0n
          ? 'zero-total-weight'
          : 'invalid-reconstruction',
      );
    }
    const allocation = (state.amountIn * integerWeight) / state.totalIntegerWeight;
    if (allocation < 0n) return fail(state, 'invalid-reconstruction');
    state.baseAllocations.push(allocation);
    state.allocatedTotal += allocation;
    if (state.allocatedTotal > state.amountIn) {
      return fail(state, 'invalid-reconstruction');
    }
  }

  state.reconstructionRouteIndex += 1;
  if (state.reconstructionRouteIndex < state.routeCount) return success(state);

  if (state.reconstructionPass === 0) {
    if (state.minimumExponent === undefined || state.positiveWeightCount === 0) {
      return fail(state, 'zero-total-weight');
    }
    state.reconstructionPass = 1;
    state.reconstructionRouteIndex = 0;
    return success(state);
  }
  if (state.reconstructionPass === 1) {
    if (state.totalIntegerWeight <= 0n) return fail(state, 'zero-total-weight');
    state.reconstructionPass = 2;
    state.reconstructionRouteIndex = 0;
    return success(state);
  }

  const residualUnits = state.amountIn - state.allocatedTotal;
  if (
    residualUnits < 0n ||
    residualUnits >= BigInt(state.positiveWeightCount) ||
    state.allocatedTotal + residualUnits !== state.amountIn
  ) {
    return fail(state, 'invalid-reconstruction');
  }
  state.initialResidualUnits = residualUnits;
  state.residualUnitsRemaining = residualUnits;
  state.currentAllocations = Object.freeze([...state.baseAllocations]);
  state.residualOptionIndex = 0;
  state.residualOptionPending = false;
  state.residualBestAllocations = undefined;
  state.phase = 'residual-option';
  return success(state);
}

/** @internal */
export function servicePathShadowPriceResidualOption(
  handle: ServicePathShadowPriceState,
): ServicePathShadowPriceResidualOption {
  const state = stateOf(handle);
  if (state.phase !== 'residual-option' || state.residualOptionPending) {
    throw new TypeError('No new service shadow-price residual option is available.');
  }
  const current = state.currentAllocations;
  const remaining = state.residualUnitsRemaining;
  if (current === undefined || remaining === undefined) {
    throw new Error('Service shadow-price residual state is incomplete.');
  }
  let allocations: readonly bigint[];
  let routeIndex: number | null;
  if (remaining === 0n) {
    allocations = Object.freeze([...current]);
    routeIndex = null;
  } else {
    routeIndex = state.residualOptionIndex;
    const candidate = [...current];
    const prior = candidate[routeIndex];
    if (prior === undefined) {
      throw new Error('Service shadow-price residual route is unavailable.');
    }
    candidate[routeIndex] = prior + 1n;
    allocations = Object.freeze(candidate);
  }
  state.residualOptionPending = true;
  return Object.freeze({ allocations, routeIndex, residualUnitsRemaining: remaining });
}

/** @internal */
export function settleServicePathShadowPriceResidualOption(
  handle: ServicePathShadowPriceState,
  outcome: ServicePathShadowPriceResidualOutcome,
): ServicePathShadowPriceStepResult {
  const state = stateOf(handle);
  if (
    state.phase !== 'residual-option' ||
    !state.residualOptionPending ||
    (outcome !== 'rejected' &&
      outcome !== 'valid-not-best' &&
      outcome !== 'valid-best')
  ) {
    throw new TypeError('Service shadow-price residual outcome is invalid.');
  }
  const current = state.currentAllocations;
  const remaining = state.residualUnitsRemaining;
  if (current === undefined || remaining === undefined) {
    throw new Error('Service shadow-price residual state is incomplete.');
  }
  state.residualOptionPending = false;
  if (remaining === 0n) {
    if (outcome === 'rejected') return fail(state, 'residual-options-exhausted');
    state.scoreAllocations = Object.freeze([...current]);
    state.phase = 'score-ready';
    return success(state);
  }

  if (outcome === 'valid-best') {
    const candidate = [...current];
    const prior = candidate[state.residualOptionIndex];
    if (prior === undefined) return fail(state, 'invalid-reconstruction');
    candidate[state.residualOptionIndex] = prior + 1n;
    state.residualBestAllocations = Object.freeze(candidate);
  }
  state.residualOptionIndex += 1;
  if (state.residualOptionIndex < state.routeCount) return success(state);

  const winner = state.residualBestAllocations;
  if (winner === undefined) return fail(state, 'residual-options-exhausted');
  const nextRemaining = remaining - 1n;
  if (nextRemaining < 0n) return fail(state, 'invalid-reconstruction');
  state.currentAllocations = winner;
  state.residualUnitsRemaining = nextRemaining;
  state.residualOptionIndex = 0;
  state.residualBestAllocations = undefined;
  if (nextRemaining === 0n) {
    state.scoreAllocations = winner;
    state.phase = 'score-ready';
  }
  return success(state);
}

/** @internal */
export function servicePathShadowPriceScoreAllocations(
  handle: ServicePathShadowPriceState,
): readonly bigint[] | undefined {
  const allocations = stateOf(handle).scoreAllocations;
  return allocations === undefined ? undefined : Object.freeze([...allocations]);
}

/** @internal */
export function servicePathShadowPriceInitialResidualUnits(
  handle: ServicePathShadowPriceState,
): bigint | undefined {
  return stateOf(handle).initialResidualUnits;
}

/** @internal */
export function servicePathShadowPriceReadyWeights(
  handle: ServicePathShadowPriceState,
): readonly number[] | undefined {
  const weights = stateOf(handle).readyWeights;
  return weights === undefined ? undefined : Object.freeze([...weights]);
}

/** @internal */
export function servicePathShadowPriceFailure(
  handle: ServicePathShadowPriceState,
): ServicePathShadowPriceFailure | undefined {
  return stateOf(handle).failure;
}
