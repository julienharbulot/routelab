import type {
  PathShadowPriceReducedRational,
  PathShadowPriceResolvedRoute,
  PathShadowPriceRouteModel,
} from '../path-shadow-price/index.ts';

declare const serviceFastPathShadowPriceStateBrand: unique symbol;

/** @internal */
export type ServiceFastPathShadowPriceDriverId =
  | 'bisection-o64-i64'
  | 'bisection-o64-i24'
  | 'bisection-o32-i16'
  | 'bisection-o16-i12'
  | 'pinned-sqrt-o64'
  | 'fixed-newton-sqrt-o64-n8';

/** @internal */
export type ServiceFastPathShadowPriceNonConvergence =
  | 'strict-reject'
  | 'final-finite-replay';

/** @internal */
export interface ServiceFastPathShadowPricePolicy {
  readonly driverId: ServiceFastPathShadowPriceDriverId;
  readonly nonConvergence: ServiceFastPathShadowPriceNonConvergence;
}

/** @internal */
export interface ServiceFastPathShadowPriceState {
  readonly [serviceFastPathShadowPriceStateBrand]:
    typeof serviceFastPathShadowPriceStateBrand;
}

/** @internal */
export type ServiceFastPathShadowPricePhase =
  | 'model-route'
  | 'proposal-start'
  | 'share-action'
  | 'reconstruction-step'
  | 'residual-option'
  | 'score-ready'
  | 'failed';

/** @internal */
export type ServiceFastPathShadowPriceShareActionKind =
  | 'bisection-endpoint'
  | 'bisection-inner-update'
  | 'bisection-final-share'
  | 'pinned-sqrt-endpoint'
  | 'pinned-sqrt-formula'
  | 'fixed-newton-sqrt-endpoint'
  | 'fixed-newton-sqrt-normalization'
  | 'fixed-newton-sqrt-update'
  | 'fixed-newton-sqrt-finalization';

/** @internal */
export type ServiceFastPathShadowPriceFailureCode =
  | 'invalid-route-model'
  | 'non-finite-normalization'
  | 'non-finite-proposal'
  | 'non-convergence'
  | 'zero-total-weight'
  | 'invalid-reconstruction'
  | 'residual-options-exhausted';

/** @internal */
export interface ServiceFastPathShadowPriceFailure {
  readonly code: ServiceFastPathShadowPriceFailureCode;
  readonly converged: boolean;
  readonly completedOuterUpdates: number;
}

/** @internal */
export interface ServiceFastPathShadowPriceProgress {
  readonly phase: ServiceFastPathShadowPricePhase;
  readonly driverId: ServiceFastPathShadowPriceDriverId;
  readonly nonConvergence: ServiceFastPathShadowPriceNonConvergence;
  readonly nextShareAction: ServiceFastPathShadowPriceShareActionKind | null;
  readonly routeCount: number;
  readonly modelRoutesCompleted: number;
  readonly outerUpdatesStarted: number;
  readonly outerUpdatesCompleted: number;
  /** Method-core share actions; common endpoint actions are excluded. */
  readonly methodActions: number;
  /** All charged endpoint and method-core share actions. */
  readonly shareActions: number;
  readonly reconstructionSteps: number;
}

/** @internal */
export interface ServiceFastPathShadowPriceProposalMetadata {
  readonly converged: boolean;
  readonly diagnostic: 'finite-nonconverged-replayed' | null;
  readonly completedOuterUpdates: number;
  readonly weights: readonly number[];
}

/** @internal */
export interface ServiceFastPathShadowPriceReconstruction {
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

/** @internal */
export interface ServiceFastPathShadowPriceResidualOption {
  readonly allocations: readonly bigint[];
  readonly routeIndex: number | null;
  readonly residualUnitsRemaining: bigint;
}

/** @internal */
export type ServiceFastPathShadowPriceResidualOutcome =
  | 'rejected'
  | 'valid-not-best'
  | 'valid-best';

/** @internal */
export type ServiceFastPathShadowPriceStepResult =
  | {
      readonly ok: true;
      readonly phase: ServiceFastPathShadowPricePhase;
      readonly actionKind: ServiceFastPathShadowPriceShareActionKind | null;
      readonly outerUpdateStarted: boolean;
      readonly outerUpdateCompleted: boolean;
    }
  | {
      readonly ok: false;
      readonly error: ServiceFastPathShadowPriceFailure;
      readonly actionKind: ServiceFastPathShadowPriceShareActionKind | null;
      readonly outerUpdateStarted: boolean;
      readonly outerUpdateCompleted: boolean;
    };

interface CapturedResolvedHop {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

interface CapturedPolicy {
  readonly driverId: ServiceFastPathShadowPriceDriverId;
  readonly nonConvergence: ServiceFastPathShadowPriceNonConvergence;
}

interface DecodedWeight {
  readonly significand: bigint;
  readonly binaryExponent: number;
}

interface DriverConfiguration {
  readonly driverId: ServiceFastPathShadowPriceDriverId;
  readonly method: 'bisection' | 'pinned-sqrt' | 'fixed-newton-sqrt';
  readonly outerUpdates: number;
  readonly innerUpdates: number | null;
  readonly newtonUpdates: number | null;
  readonly convergenceTolerance: number;
}

interface MutableState {
  readonly amountIn: bigint;
  readonly routeCount: number;
  readonly policy: CapturedPolicy;
  readonly driver: DriverConfiguration;
  readonly models: PathShadowPriceRouteModel[];
  phase: ServiceFastPathShadowPricePhase;
  nextShareAction: ServiceFastPathShadowPriceShareActionKind | null;
  lambdaLower: number;
  lambdaUpper: number;
  sampleKind: 'outer' | 'final';
  sampleLambda: number | undefined;
  sampleRouteIndex: number;
  sampleWeights: number[];
  sampleSum: number;
  shareLower: number;
  shareUpper: number;
  innerUpdates: number;
  newtonMantissa: number | undefined;
  newtonExponent: number | undefined;
  newtonY: number | undefined;
  newtonUpdates: number;
  outerUpdatesStarted: number;
  outerUpdatesCompleted: number;
  methodActions: number;
  shareActions: number;
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
  residualUnitsRemaining: bigint | undefined;
  residualOptionIndex: number;
  residualOptionPending: boolean;
  residualBestAllocations: readonly bigint[] | undefined;
  currentAllocations: readonly bigint[] | undefined;
  proposalMetadata: ServiceFastPathShadowPriceProposalMetadata | undefined;
  reconstruction: ServiceFastPathShadowPriceReconstruction | undefined;
  scoreAllocations: readonly bigint[] | undefined;
  failure: ServiceFastPathShadowPriceFailure | undefined;
}

const CONVERGENCE_TOLERANCE = 2 ** -40;
const MINIMUM_NORMAL_NUMBER = 2 ** -1022;
const BINARY_PREFIX_BITS = 53;
const BIT_LENGTH_CHUNK = 1_024;
const BIT_LENGTH_CHUNK_BIGINT = 1_024n;
const BIT_LENGTH_CHUNK_THRESHOLD = 1n << BIT_LENGTH_CHUNK_BIGINT;
const BINARY64_FRACTION_MASK = (1n << 52n) - 1n;
const BINARY64_FRACTION_DIVISOR = 2 ** 52;
const BINARY64_IMPLICIT_SIGNIFICAND_BIT = 1n << 52n;

const BISECTION_64_64: DriverConfiguration = Object.freeze({
  driverId: 'bisection-o64-i64',
  method: 'bisection',
  outerUpdates: 64,
  innerUpdates: 64,
  newtonUpdates: null,
  convergenceTolerance: CONVERGENCE_TOLERANCE,
});
const BISECTION_64_24: DriverConfiguration = Object.freeze({
  driverId: 'bisection-o64-i24',
  method: 'bisection',
  outerUpdates: 64,
  innerUpdates: 24,
  newtonUpdates: null,
  convergenceTolerance: CONVERGENCE_TOLERANCE,
});
const BISECTION_32_16: DriverConfiguration = Object.freeze({
  driverId: 'bisection-o32-i16',
  method: 'bisection',
  outerUpdates: 32,
  innerUpdates: 16,
  newtonUpdates: null,
  convergenceTolerance: CONVERGENCE_TOLERANCE,
});
const BISECTION_16_12: DriverConfiguration = Object.freeze({
  driverId: 'bisection-o16-i12',
  method: 'bisection',
  outerUpdates: 16,
  innerUpdates: 12,
  newtonUpdates: null,
  convergenceTolerance: CONVERGENCE_TOLERANCE,
});
const PINNED_SQRT_64: DriverConfiguration = Object.freeze({
  driverId: 'pinned-sqrt-o64',
  method: 'pinned-sqrt',
  outerUpdates: 64,
  innerUpdates: null,
  newtonUpdates: null,
  convergenceTolerance: CONVERGENCE_TOLERANCE,
});
const FIXED_NEWTON_SQRT_64_8: DriverConfiguration = Object.freeze({
  driverId: 'fixed-newton-sqrt-o64-n8',
  method: 'fixed-newton-sqrt',
  outerUpdates: 64,
  innerUpdates: null,
  newtonUpdates: 8,
  convergenceTolerance: CONVERGENCE_TOLERANCE,
});

const states = new WeakMap<ServiceFastPathShadowPriceState, MutableState>();

function driverConfiguration(
  driverId: ServiceFastPathShadowPriceDriverId,
): DriverConfiguration {
  switch (driverId) {
    case 'bisection-o64-i64': return BISECTION_64_64;
    case 'bisection-o64-i24': return BISECTION_64_24;
    case 'bisection-o32-i16': return BISECTION_32_16;
    case 'bisection-o16-i12': return BISECTION_16_12;
    case 'pinned-sqrt-o64': return PINNED_SQRT_64;
    case 'fixed-newton-sqrt-o64-n8': return FIXED_NEWTON_SQRT_64_8;
  }
}

function isDriverId(value: unknown): value is ServiceFastPathShadowPriceDriverId {
  return value === 'bisection-o64-i64' ||
    value === 'bisection-o64-i24' ||
    value === 'bisection-o32-i16' ||
    value === 'bisection-o16-i12' ||
    value === 'pinned-sqrt-o64' ||
    value === 'fixed-newton-sqrt-o64-n8';
}

function isNonConvergence(
  value: unknown,
): value is ServiceFastPathShadowPriceNonConvergence {
  return value === 'strict-reject' || value === 'final-finite-replay';
}

function capturePolicy(value: unknown): CapturedPolicy | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const source = value as Record<string, unknown>;
    const driverId = source['driverId'];
    const nonConvergence = source['nonConvergence'];
    return isDriverId(driverId) && isNonConvergence(nonConvergence)
      ? Object.freeze({ driverId, nonConvergence })
      : undefined;
  } catch {
    return undefined;
  }
}

function stateOf(handle: ServiceFastPathShadowPriceState): MutableState {
  const state = states.get(handle);
  if (state === undefined) throw new TypeError('Unknown service-fast shadow-price state.');
  return state;
}

function frozenFailure(
  code: ServiceFastPathShadowPriceFailureCode,
  converged: boolean,
  completedOuterUpdates: number,
): ServiceFastPathShadowPriceFailure {
  return Object.freeze({ code, converged, completedOuterUpdates });
}

function fail(
  state: MutableState,
  code: ServiceFastPathShadowPriceFailureCode,
  actionKind: ServiceFastPathShadowPriceShareActionKind | null = null,
  outerUpdateStarted = false,
  outerUpdateCompleted = false,
): ServiceFastPathShadowPriceStepResult {
  const error = frozenFailure(
    code,
    state.proposalMetadata?.converged === true,
    state.outerUpdatesCompleted,
  );
  state.failure = error;
  state.phase = 'failed';
  state.nextShareAction = null;
  return Object.freeze({
    ok: false,
    error,
    actionKind,
    outerUpdateStarted,
    outerUpdateCompleted,
  });
}

function success(
  state: MutableState,
  actionKind: ServiceFastPathShadowPriceShareActionKind | null = null,
  outerUpdateStarted = false,
  outerUpdateCompleted = false,
): ServiceFastPathShadowPriceStepResult {
  return Object.freeze({
    ok: true,
    phase: state.phase,
    actionKind,
    outerUpdateStarted,
    outerUpdateCompleted,
  });
}

function firstShareAction(
  method: DriverConfiguration['method'],
): ServiceFastPathShadowPriceShareActionKind {
  if (method === 'bisection') return 'bisection-endpoint';
  if (method === 'pinned-sqrt') return 'pinned-sqrt-endpoint';
  return 'fixed-newton-sqrt-endpoint';
}

function isMethodCoreAction(
  actionKind: ServiceFastPathShadowPriceShareActionKind,
): boolean {
  return actionKind !== 'bisection-endpoint' &&
    actionKind !== 'pinned-sqrt-endpoint' &&
    actionKind !== 'fixed-newton-sqrt-endpoint';
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFinitePositiveNormal(value: number): boolean {
  return Number.isFinite(value) && value >= MINIMUM_NORMAL_NUMBER;
}

function isUnitShare(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveZeroOrPositiveNormal(value: number): boolean {
  if (!Number.isFinite(value) || Object.is(value, -0) || value < 0) return false;
  return value === 0 || value >= MINIMUM_NORMAL_NUMBER;
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
  const fraction = bits & BINARY64_FRACTION_MASK;
  if (exponentBits === 0n) return fraction === 0n ? 0 : undefined;
  if (exponentBits === 0x7ffn) return undefined;
  const exponent = ((firstByte & 0x7f) * 16) + (view.getUint8(1) >> 4);
  return Object.freeze({
    significand: BINARY64_IMPLICIT_SIGNIFICAND_BIT + fraction,
    binaryExponent: exponent - 1_023 - 52,
  });
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

function captureResolvedRoute(value: unknown): readonly CapturedResolvedHop[] | undefined {
  const route: CapturedResolvedHop[] = [];
  try {
    if (!Array.isArray(value)) return undefined;
    const sourceRoute = value as readonly unknown[];
    const length = sourceRoute.length;
    if (!Number.isSafeInteger(length) || length < 1 || length > 4) return undefined;
    for (let index = 0; index < length; index += 1) {
      const candidate: unknown = sourceRoute[index];
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
      route.push(Object.freeze({
        reserveIn,
        reserveOut,
        feeChargedNumerator,
        feeDenominator,
      }));
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
): PathShadowPriceRouteModel | ServiceFastPathShadowPriceFailureCode {
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

function resetRouteShare(state: MutableState): void {
  state.shareLower = 0;
  state.shareUpper = 1;
  state.innerUpdates = 0;
  state.newtonMantissa = undefined;
  state.newtonExponent = undefined;
  state.newtonY = undefined;
  state.newtonUpdates = 0;
  state.nextShareAction = firstShareAction(state.driver.method);
}

function resetSample(state: MutableState): void {
  state.sampleLambda = undefined;
  state.sampleRouteIndex = 0;
  state.sampleWeights = [];
  state.sampleSum = 0;
  resetRouteShare(state);
}

function isFinalFiniteWeight(value: number): boolean {
  return isPositiveZeroOrPositiveNormal(value) && value <= 1;
}

function completeRouteShare(
  state: MutableState,
  weight: number,
  actionKind: ServiceFastPathShadowPriceShareActionKind,
  outerUpdateStarted: boolean,
): ServiceFastPathShadowPriceStepResult {
  const nextSum = state.sampleSum + weight;
  if (!Number.isFinite(nextSum) || nextSum < 0 || nextSum > state.routeCount) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  state.sampleWeights.push(weight);
  state.sampleSum = nextSum;
  if (state.sampleRouteIndex + 1 < state.routeCount) {
    state.sampleRouteIndex += 1;
    resetRouteShare(state);
    return success(state, actionKind, outerUpdateStarted);
  }

  if (state.sampleKind === 'outer') {
    const lambda = state.sampleLambda;
    if (lambda === undefined) {
      return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
    }
    if (state.sampleSum > 1) state.lambdaLower = lambda;
    else state.lambdaUpper = lambda;
    state.outerUpdatesCompleted += 1;
    if (state.outerUpdatesCompleted === state.driver.outerUpdates) {
      state.sampleKind = 'final';
    }
    resetSample(state);
    return success(state, actionKind, outerUpdateStarted, true);
  }

  if (!isFinitePositive(state.sampleSum)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  const difference = state.sampleSum - 1;
  if (!Number.isFinite(difference)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  const absoluteDifference = difference < 0 ? -difference : difference;
  if (!Number.isFinite(absoluteDifference)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  const converged = absoluteDifference <= state.driver.convergenceTolerance;
  if (!converged && state.policy.nonConvergence === 'strict-reject') {
    return fail(state, 'non-convergence', actionKind, outerUpdateStarted);
  }
  if (!converged && !state.sampleWeights.every(isFinalFiniteWeight)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  state.proposalMetadata = Object.freeze({
    converged,
    diagnostic: converged ? null : 'finite-nonconverged-replayed',
    completedOuterUpdates: state.outerUpdatesCompleted,
    weights: Object.freeze([...state.sampleWeights]),
  });
  state.phase = 'reconstruction-step';
  state.nextShareAction = null;
  return success(state, actionKind, outerUpdateStarted);
}

function advanceEndpointAction(
  state: MutableState,
  actionKind: ServiceFastPathShadowPriceShareActionKind,
): ServiceFastPathShadowPriceStepResult {
  let outerUpdateStarted = false;
  if (state.sampleLambda === undefined) {
    const lambda = lambdaMidpoint(state.lambdaLower, state.lambdaUpper);
    if (lambda === undefined) return fail(state, 'non-finite-proposal', actionKind);
    state.sampleLambda = lambda;
    if (state.sampleKind === 'outer') {
      state.outerUpdatesStarted += 1;
      outerUpdateStarted = true;
    }
  }
  const model = state.models[state.sampleRouteIndex];
  const lambda = state.sampleLambda;
  if (model === undefined || lambda === undefined) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }

  if (lambda >= model.nonauthorizingMarginalScale) {
    return completeRouteShare(state, 0, actionKind, outerUpdateStarted);
  }
  const onePlusInputScale = 1 + model.nonauthorizingInputScale;
  if (!isFinitePositive(onePlusInputScale)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  const endpointDenominator = onePlusInputScale * onePlusInputScale;
  if (!isFinitePositive(endpointDenominator)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  const endpointMarginal =
    model.nonauthorizingMarginalScale / endpointDenominator;
  if (!isFinitePositive(endpointMarginal)) {
    return fail(state, 'non-finite-proposal', actionKind, outerUpdateStarted);
  }
  if (lambda <= endpointMarginal) {
    return completeRouteShare(state, 1, actionKind, outerUpdateStarted);
  }

  state.shareLower = 0;
  state.shareUpper = 1;
  state.innerUpdates = 0;
  state.newtonMantissa = undefined;
  state.newtonExponent = undefined;
  state.newtonY = undefined;
  state.newtonUpdates = 0;
  if (state.driver.method === 'bisection') {
    state.nextShareAction = 'bisection-inner-update';
  } else if (state.driver.method === 'pinned-sqrt') {
    state.nextShareAction = 'pinned-sqrt-formula';
  } else {
    state.nextShareAction = 'fixed-newton-sqrt-normalization';
  }
  return success(state, actionKind, outerUpdateStarted);
}

function advanceBisectionInnerAction(
  state: MutableState,
  actionKind: 'bisection-inner-update',
): ServiceFastPathShadowPriceStepResult {
  const model = state.models[state.sampleRouteIndex];
  const lambda = state.sampleLambda;
  const configuredInnerUpdates = state.driver.innerUpdates;
  if (
    model === undefined ||
    lambda === undefined ||
    configuredInnerUpdates === null
  ) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const midpoint = shareMidpointMarginal(
    model,
    state.shareLower,
    state.shareUpper,
  );
  if (midpoint === undefined) return fail(state, 'non-finite-proposal', actionKind);
  if (midpoint.marginal > lambda) state.shareLower = midpoint.share;
  else state.shareUpper = midpoint.share;
  state.innerUpdates += 1;
  if (state.innerUpdates === configuredInnerUpdates) {
    state.nextShareAction = 'bisection-final-share';
  }
  return success(state, actionKind);
}

function advanceBisectionFinalAction(
  state: MutableState,
  actionKind: 'bisection-final-share',
): ServiceFastPathShadowPriceStepResult {
  const model = state.models[state.sampleRouteIndex];
  if (model === undefined || state.sampleLambda === undefined) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const midpoint = shareMidpointMarginal(
    model,
    state.shareLower,
    state.shareUpper,
  );
  if (midpoint === undefined) return fail(state, 'non-finite-proposal', actionKind);
  return completeRouteShare(state, midpoint.share, actionKind, false);
}

function advancePinnedSqrtFormulaAction(
  state: MutableState,
  actionKind: 'pinned-sqrt-formula',
): ServiceFastPathShadowPriceStepResult {
  const model = state.models[state.sampleRouteIndex];
  const lambda = state.sampleLambda;
  if (
    model === undefined ||
    lambda === undefined ||
    !isFinitePositiveNormal(model.nonauthorizingMarginalScale) ||
    !isFinitePositiveNormal(model.nonauthorizingInputScale) ||
    !isFinitePositive(lambda)
  ) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const ratio = model.nonauthorizingMarginalScale / lambda;
  if (!Number.isFinite(ratio) || ratio <= 1) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const root = Math.sqrt(ratio);
  if (!Number.isFinite(root) || root < 1) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const numerator = root - 1;
  if (!isPositiveZeroOrPositiveNormal(numerator)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const share = numerator / model.nonauthorizingInputScale;
  if (!isPositiveZeroOrPositiveNormal(share) || !isUnitShare(share)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  return completeRouteShare(state, share, actionKind, false);
}

function decomposeNewtonRatio(
  ratio: number,
): { readonly mantissa: number; readonly exponent: number } | undefined {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, ratio, false);
  const bits = view.getBigUint64(0, false);
  const rawExponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & BINARY64_FRACTION_MASK;
  if (rawExponent <= 0 || rawExponent >= 0x7ff) return undefined;
  const k = rawExponent - 1_023;
  const z = 1 + Number(fraction) / BINARY64_FRACTION_DIVISOR;
  const kIsEven = k % 2 === 0;
  const mantissa = kIsEven ? z : 2 * z;
  const exponent = kIsEven ? k : k - 1;
  if (
    !Number.isFinite(mantissa) ||
    mantissa < 1 ||
    mantissa >= 4 ||
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > 1_022 ||
    exponent % 2 !== 0
  ) {
    return undefined;
  }
  return Object.freeze({ mantissa, exponent });
}

function advanceFixedNewtonNormalizationAction(
  state: MutableState,
  actionKind: 'fixed-newton-sqrt-normalization',
): ServiceFastPathShadowPriceStepResult {
  const model = state.models[state.sampleRouteIndex];
  const lambda = state.sampleLambda;
  if (
    model === undefined ||
    lambda === undefined ||
    !isFinitePositiveNormal(model.nonauthorizingMarginalScale) ||
    !isFinitePositive(lambda)
  ) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const ratio = model.nonauthorizingMarginalScale / lambda;
  if (!isFinitePositiveNormal(ratio) || ratio <= 1) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const decomposition = decomposeNewtonRatio(ratio);
  if (decomposition === undefined) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  state.newtonMantissa = decomposition.mantissa;
  state.newtonExponent = decomposition.exponent;
  state.newtonY = 1;
  state.newtonUpdates = 0;
  state.nextShareAction = 'fixed-newton-sqrt-update';
  return success(state, actionKind);
}

function advanceFixedNewtonUpdateAction(
  state: MutableState,
  actionKind: 'fixed-newton-sqrt-update',
): ServiceFastPathShadowPriceStepResult {
  const mantissa = state.newtonMantissa;
  const y = state.newtonY;
  const configuredNewtonUpdates = state.driver.newtonUpdates;
  if (
    mantissa === undefined ||
    y === undefined ||
    configuredNewtonUpdates === null ||
    !isFinitePositiveNormal(mantissa) ||
    !isFinitePositiveNormal(y)
  ) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const quotient = mantissa / y;
  if (!isFinitePositiveNormal(quotient)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const sum = y + quotient;
  if (!isFinitePositiveNormal(sum)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const nextY = sum / 2;
  if (!isFinitePositiveNormal(nextY)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  state.newtonY = nextY;
  state.newtonUpdates += 1;
  if (state.newtonUpdates === configuredNewtonUpdates) {
    state.nextShareAction = 'fixed-newton-sqrt-finalization';
  }
  return success(state, actionKind);
}

function advanceFixedNewtonFinalizationAction(
  state: MutableState,
  actionKind: 'fixed-newton-sqrt-finalization',
): ServiceFastPathShadowPriceStepResult {
  const model = state.models[state.sampleRouteIndex];
  const exponent = state.newtonExponent;
  const y = state.newtonY;
  if (
    model === undefined ||
    exponent === undefined ||
    y === undefined ||
    !isFinitePositiveNormal(y) ||
    !isFinitePositiveNormal(model.nonauthorizingInputScale)
  ) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const scale = 2 ** (exponent / 2);
  if (!isFinitePositiveNormal(scale)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const root = y * scale;
  if (!Number.isFinite(root) || root < 1) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const numerator = root - 1;
  if (!isPositiveZeroOrPositiveNormal(numerator)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  const share = numerator / model.nonauthorizingInputScale;
  if (!isPositiveZeroOrPositiveNormal(share) || !isUnitShare(share)) {
    return fail(state, 'non-finite-proposal', actionKind);
  }
  return completeRouteShare(state, share, actionKind, false);
}

/** @internal */
export function createServiceFastPathShadowPriceState(
  amountIn: bigint,
  routeCount: number,
  sourcePolicy: ServiceFastPathShadowPricePolicy,
): ServiceFastPathShadowPriceState {
  const policy = capturePolicy(sourcePolicy);
  if (
    typeof amountIn !== 'bigint' ||
    amountIn <= 0n ||
    !Number.isSafeInteger(routeCount) ||
    routeCount < 2 ||
    routeCount > 4 ||
    policy === undefined
  ) {
    throw new TypeError('Service-fast shadow-price request is outside frozen bounds.');
  }
  const handle = Object.freeze({}) as ServiceFastPathShadowPriceState;
  states.set(handle, {
    amountIn,
    routeCount,
    policy,
    driver: driverConfiguration(policy.driverId),
    models: [],
    phase: 'model-route',
    nextShareAction: null,
    lambdaLower: 0,
    lambdaUpper: 0,
    sampleKind: 'outer',
    sampleLambda: undefined,
    sampleRouteIndex: 0,
    sampleWeights: [],
    sampleSum: 0,
    shareLower: 0,
    shareUpper: 1,
    innerUpdates: 0,
    newtonMantissa: undefined,
    newtonExponent: undefined,
    newtonY: undefined,
    newtonUpdates: 0,
    outerUpdatesStarted: 0,
    outerUpdatesCompleted: 0,
    methodActions: 0,
    shareActions: 0,
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
    residualUnitsRemaining: undefined,
    residualOptionIndex: 0,
    residualOptionPending: false,
    residualBestAllocations: undefined,
    currentAllocations: undefined,
    proposalMetadata: undefined,
    reconstruction: undefined,
    scoreAllocations: undefined,
    failure: undefined,
  });
  return handle;
}

/** @internal */
export function serviceFastPathShadowPriceProgress(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceProgress {
  const state = stateOf(handle);
  return Object.freeze({
    phase: state.phase,
    driverId: state.policy.driverId,
    nonConvergence: state.policy.nonConvergence,
    nextShareAction: state.nextShareAction,
    routeCount: state.routeCount,
    modelRoutesCompleted: state.models.length,
    outerUpdatesStarted: state.outerUpdatesStarted,
    outerUpdatesCompleted: state.outerUpdatesCompleted,
    methodActions: state.methodActions,
    shareActions: state.shareActions,
    reconstructionSteps: state.reconstructionSteps,
  });
}

/** @internal */
export function appendServiceFastPathShadowPriceModelRoute(
  handle: ServiceFastPathShadowPriceState,
  sourceRoute: PathShadowPriceResolvedRoute,
): ServiceFastPathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'model-route' || state.models.length >= state.routeCount) {
    throw new TypeError('No service-fast shadow-price model route is pending.');
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
export function startServiceFastPathShadowPriceProposal(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'proposal-start') {
    throw new TypeError('Service-fast shadow-price proposal is not ready to start.');
  }
  if (!Number.isFinite(state.lambdaUpper) || state.lambdaUpper <= 0) {
    return fail(state, 'non-finite-proposal');
  }
  state.phase = 'share-action';
  state.sampleKind = 'outer';
  resetSample(state);
  return success(state);
}

/** @internal */
export function advanceServiceFastPathShadowPriceShareAction(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'share-action') {
    throw new TypeError('No service-fast shadow-price share action is pending.');
  }
  const actionKind = state.nextShareAction;
  if (actionKind === null) {
    throw new TypeError('No service-fast shadow-price share action is pending.');
  }
  state.shareActions += 1;
  if (isMethodCoreAction(actionKind)) state.methodActions += 1;

  switch (actionKind) {
    case 'bisection-endpoint':
    case 'pinned-sqrt-endpoint':
    case 'fixed-newton-sqrt-endpoint':
      return advanceEndpointAction(state, actionKind);
    case 'bisection-inner-update':
      return advanceBisectionInnerAction(state, actionKind);
    case 'bisection-final-share':
      return advanceBisectionFinalAction(state, actionKind);
    case 'pinned-sqrt-formula':
      return advancePinnedSqrtFormulaAction(state, actionKind);
    case 'fixed-newton-sqrt-normalization':
      return advanceFixedNewtonNormalizationAction(state, actionKind);
    case 'fixed-newton-sqrt-update':
      return advanceFixedNewtonUpdateAction(state, actionKind);
    case 'fixed-newton-sqrt-finalization':
      return advanceFixedNewtonFinalizationAction(state, actionKind);
  }
}

/** @internal */
export function advanceServiceFastPathShadowPriceReconstructionStep(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceStepResult {
  const state = stateOf(handle);
  if (state.phase !== 'reconstruction-step') {
    throw new TypeError('No service-fast shadow-price reconstruction step is pending.');
  }
  state.reconstructionSteps += 1;
  const weights = state.proposalMetadata?.weights;
  const weight = weights?.[state.reconstructionRouteIndex];
  if (weights === undefined || weight === undefined) {
    return fail(state, 'invalid-reconstruction');
  }

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
  const integerWeights = Object.freeze([...state.integerWeights]);
  const baseAllocations = Object.freeze([...state.baseAllocations]);
  state.reconstruction = Object.freeze({
    integerWeights,
    baseAllocations,
    residualUnits,
  });
  state.residualUnitsRemaining = residualUnits;
  state.currentAllocations = baseAllocations;
  state.residualOptionIndex = 0;
  state.residualOptionPending = false;
  state.residualBestAllocations = undefined;
  state.phase = 'residual-option';
  return success(state);
}

/** @internal */
export function serviceFastPathShadowPriceResidualOption(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceResidualOption {
  const state = stateOf(handle);
  if (state.phase !== 'residual-option' || state.residualOptionPending) {
    throw new TypeError('No new service-fast shadow-price residual option is available.');
  }
  const current = state.currentAllocations;
  const remaining = state.residualUnitsRemaining;
  if (current === undefined || remaining === undefined) {
    throw new Error('Service-fast shadow-price residual state is incomplete.');
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
      throw new Error('Service-fast shadow-price residual route is unavailable.');
    }
    candidate[routeIndex] = prior + 1n;
    allocations = Object.freeze(candidate);
  }
  state.residualOptionPending = true;
  return Object.freeze({ allocations, routeIndex, residualUnitsRemaining: remaining });
}

/** @internal */
export function settleServiceFastPathShadowPriceResidualOption(
  handle: ServiceFastPathShadowPriceState,
  outcome: ServiceFastPathShadowPriceResidualOutcome,
): ServiceFastPathShadowPriceStepResult {
  const state = stateOf(handle);
  if (
    state.phase !== 'residual-option' ||
    !state.residualOptionPending ||
    (outcome !== 'rejected' &&
      outcome !== 'valid-not-best' &&
      outcome !== 'valid-best')
  ) {
    throw new TypeError('Service-fast shadow-price residual outcome is invalid.');
  }
  const current = state.currentAllocations;
  const remaining = state.residualUnitsRemaining;
  if (current === undefined || remaining === undefined) {
    throw new Error('Service-fast shadow-price residual state is incomplete.');
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
export function serviceFastPathShadowPriceScoreAllocations(
  handle: ServiceFastPathShadowPriceState,
): readonly bigint[] | undefined {
  const allocations = stateOf(handle).scoreAllocations;
  return allocations === undefined ? undefined : Object.freeze([...allocations]);
}

/** @internal */
export function serviceFastPathShadowPriceProposalMetadata(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceProposalMetadata | undefined {
  const metadata = stateOf(handle).proposalMetadata;
  return metadata === undefined
    ? undefined
    : Object.freeze({
        converged: metadata.converged,
        diagnostic: metadata.diagnostic,
        completedOuterUpdates: metadata.completedOuterUpdates,
        weights: Object.freeze([...metadata.weights]),
      });
}

/** @internal */
export function serviceFastPathShadowPriceReconstruction(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceReconstruction | undefined {
  const reconstruction = stateOf(handle).reconstruction;
  return reconstruction === undefined
    ? undefined
    : Object.freeze({
        integerWeights: Object.freeze([...reconstruction.integerWeights]),
        baseAllocations: Object.freeze([...reconstruction.baseAllocations]),
        residualUnits: reconstruction.residualUnits,
      });
}

/** @internal */
export function serviceFastPathShadowPriceFailure(
  handle: ServiceFastPathShadowPriceState,
): ServiceFastPathShadowPriceFailure | undefined {
  return stateOf(handle).failure;
}
