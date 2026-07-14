import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceServiceFastPathShadowPriceShareAction,
  appendServiceFastPathShadowPriceModelRoute,
  createServiceFastPathShadowPriceState,
  serviceFastPathShadowPriceFailure,
  serviceFastPathShadowPriceProgress,
  serviceFastPathShadowPriceProposalMetadata,
  startServiceFastPathShadowPriceProposal,
  type ServiceFastPathShadowPriceFailure,
  type ServiceFastPathShadowPriceProgress,
  type ServiceFastPathShadowPriceProposalMetadata,
  type ServiceFastPathShadowPriceStepResult,
} from '../../src/allocation/service-fast-path-shadow-price/index.ts';
import {
  advanceServicePathShadowPriceShareMicrostep,
  appendServicePathShadowPriceModelRoute,
  createServicePathShadowPriceState,
  servicePathShadowPriceFailure,
  servicePathShadowPriceProgress,
  servicePathShadowPriceReadyWeights,
  startServicePathShadowPriceProposal,
} from '../../src/allocation/service-path-shadow-price/index.ts';

type DriverId =
  | 'bisection-o64-i64'
  | 'bisection-o64-i24'
  | 'bisection-o32-i16'
  | 'bisection-o16-i12'
  | 'pinned-sqrt-o64'
  | 'fixed-newton-sqrt-o64-n8';

type NonConvergence = 'strict-reject' | 'final-finite-replay';

type ShareActionKind =
  | 'bisection-endpoint'
  | 'bisection-inner-update'
  | 'bisection-final-share'
  | 'pinned-sqrt-endpoint'
  | 'pinned-sqrt-formula'
  | 'fixed-newton-sqrt-endpoint'
  | 'fixed-newton-sqrt-normalization'
  | 'fixed-newton-sqrt-update'
  | 'fixed-newton-sqrt-finalization';

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

interface BisectionDriver {
  readonly driverId: DriverId;
  readonly method: 'bisection';
  readonly outerUpdates: number;
  readonly innerUpdates: number;
}

interface PinnedSqrtDriver {
  readonly driverId: 'pinned-sqrt-o64';
  readonly method: 'pinned-sqrt';
  readonly outerUpdates: 64;
}

interface FixedNewtonDriver {
  readonly driverId: 'fixed-newton-sqrt-o64-n8';
  readonly method: 'fixed-newton-sqrt';
  readonly outerUpdates: 64;
  readonly newtonUpdates: 8;
}

type OracleDriver = BisectionDriver | PinnedSqrtDriver | FixedNewtonDriver;

interface OracleProposal {
  readonly driverId: DriverId;
  readonly amountIn: bigint;
  readonly earlierSamples: readonly OracleEarlierSample[];
  readonly finalSample: OracleFinalSample;
  readonly converged: boolean;
  readonly completedOuterUpdates: number;
  readonly actions: readonly ShareActionKind[];
  readonly actionSteps: readonly OracleActionStep[];
}

interface OracleActionStep {
  readonly actionKind: ShareActionKind;
  readonly outerUpdateStarted: boolean;
  readonly outerUpdateCompleted: boolean;
}

interface OracleEarlierSample {
  readonly status: 'earlier-sample';
  readonly completedOuterUpdates: number;
  readonly weights: readonly number[];
}

interface OracleFinalSample {
  readonly status: 'final-sample';
  readonly completedOuterUpdates: number;
  readonly weights: readonly number[];
}

type OracleProposalSample = OracleEarlierSample | OracleFinalSample;

interface OracleReconstruction {
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

interface NewtonUpdate {
  readonly quotient: number;
  readonly sum: number;
  readonly y: number;
}

interface NewtonTrace {
  readonly exponentBits: number;
  readonly fractionBits: bigint;
  readonly k: number;
  readonly z: number;
  readonly m: number;
  readonly e: number;
  readonly updates: readonly NewtonUpdate[];
  readonly scale: number;
  readonly root: number;
}

type NewtonTraceDisposition =
  | { readonly status: 'accepted'; readonly trace: NewtonTrace }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'ratio-not-finite'
        | 'ratio-not-normal-greater-than-one'
        | 'decomposition-out-of-domain'
        | 'update-not-positive-normal'
        | 'scale-not-positive-normal';
      readonly updateIndex: number | null;
    };

type NewtonFinalizationDisposition =
  | {
      readonly status: 'accepted';
      readonly root: number;
      readonly numerator: number;
      readonly share: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'input-scale-not-positive-normal'
        | 'root-not-finite-at-least-one'
        | 'numerator-not-positive-normal-or-zero'
        | 'share-not-positive-normal-or-zero'
        | 'share-out-of-range';
    };

type FinalReplayRejection =
  | 'strict-mode'
  | 'earlier-sample'
  | 'negative-zero'
  | 'subnormal'
  | 'nonfinite'
  | 'out-of-range'
  | 'invalid-reconstruction'
  | 'zero-total-weight';

type ProposalDisposition =
  | {
      readonly status: 'accepted';
      readonly converged: boolean;
      readonly diagnostic: 'finite-nonconverged-replayed' | null;
      readonly reconstruction: OracleReconstruction;
    }
  | {
      readonly status: 'rejected';
      readonly reason: FinalReplayRejection;
      readonly routeIndex: number | null;
    };

type DecodedWeight =
  | { readonly status: 'zero' }
  | {
      readonly status: 'normal';
      readonly significand: bigint;
      readonly binaryExponent: number;
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'negative' | 'subnormal' | 'nonfinite';
    };

const CONVERGENCE_TOLERANCE = 2 ** -40;
const MINIMUM_NORMAL = 2 ** -1022;
const FRACTION_MASK = (1n << 52n) - 1n;
const SIGNIFICAND_BIT = 1n << 52n;

const DRIVERS: readonly OracleDriver[] = [
  {
    driverId: 'bisection-o64-i64',
    method: 'bisection',
    outerUpdates: 64,
    innerUpdates: 64,
  },
  {
    driverId: 'bisection-o64-i24',
    method: 'bisection',
    outerUpdates: 64,
    innerUpdates: 24,
  },
  {
    driverId: 'bisection-o32-i16',
    method: 'bisection',
    outerUpdates: 32,
    innerUpdates: 16,
  },
  {
    driverId: 'bisection-o16-i12',
    method: 'bisection',
    outerUpdates: 16,
    innerUpdates: 12,
  },
  {
    driverId: 'pinned-sqrt-o64',
    method: 'pinned-sqrt',
    outerUpdates: 64,
  },
  {
    driverId: 'fixed-newton-sqrt-o64-n8',
    method: 'fixed-newton-sqrt',
    outerUpdates: 64,
    newtonUpdates: 8,
  },
];

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
  assert.ok(value > 0n);
  const bits = value.toString(2);
  const prefix = bits.slice(0, 53);
  let significandInteger = 0;
  for (const bit of prefix) {
    significandInteger = significandInteger * 2 + (bit === '1' ? 1 : 0);
  }
  return {
    significand: significandInteger / 2 ** (prefix.length - 1),
    exponent: bits.length - 1,
  };
}

function normalizedRatio(numerator: bigint, denominator: bigint): number {
  assert.ok(numerator > 0n && denominator > 0n);
  const divisor = greatestCommonDivisor(numerator, denominator);
  const reducedNumerator = leadingBinaryValue(numerator / divisor);
  const reducedDenominator = leadingBinaryValue(denominator / divisor);
  const ratio =
    (reducedNumerator.significand / reducedDenominator.significand) *
    2 ** (reducedNumerator.exponent - reducedDenominator.exponent);
  assert.ok(Number.isFinite(ratio) && ratio >= MINIMUM_NORMAL);
  return ratio;
}

function oracleModel(resolvedRoute: OracleRoute, amountIn: bigint): OracleModel {
  assert.ok(resolvedRoute.length > 0 && amountIn > 0n);
  let coefficients: readonly [bigint, bigint, bigint] | undefined;
  for (const resolvedHop of resolvedRoute) {
    const multiplier =
      resolvedHop.feeDenominator - resolvedHop.feeChargedNumerator;
    const next = primitiveTriple(
      multiplier * resolvedHop.reserveOut,
      resolvedHop.feeDenominator * resolvedHop.reserveIn,
      multiplier,
    );
    coefficients =
      coefficients === undefined
        ? next
        : primitiveTriple(
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

function decodeWeightHex(hex: string): DecodedWeight {
  assert.match(hex, /^[0-9a-f]{16}$/u);
  const bits = BigInt(`0x${hex}`);
  const sign = bits >> 63n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & FRACTION_MASK;
  if (sign !== 0n) return { status: 'invalid', reason: 'negative' };
  if (exponentBits === 0) {
    return fraction === 0n
      ? { status: 'zero' }
      : { status: 'invalid', reason: 'subnormal' };
  }
  if (exponentBits === 0x7ff) {
    return { status: 'invalid', reason: 'nonfinite' };
  }
  return {
    status: 'normal',
    significand: SIGNIFICAND_BIT + fraction,
    binaryExponent: exponentBits - 1_023 - 52,
  };
}

function reconstructFromHexWeights(
  amountIn: bigint,
  weightHex: readonly string[],
): OracleReconstruction | { readonly failure: 'invalid-reconstruction' | 'zero-total-weight' } {
  const decoded = weightHex.map(decodeWeightHex);
  if (decoded.some((weight) => weight.status === 'invalid')) {
    return { failure: 'invalid-reconstruction' };
  }
  const positive = decoded.filter(
    (weight): weight is Extract<DecodedWeight, { readonly status: 'normal' }> =>
      weight.status === 'normal',
  );
  if (positive.length === 0) return { failure: 'zero-total-weight' };
  const minimumExponent = positive.reduce(
    (minimum, weight) => Math.min(minimum, weight.binaryExponent),
    positive[0]!.binaryExponent,
  );
  const integerWeights = decoded.map((weight) => {
    if (weight.status === 'zero') return 0n;
    if (weight.status === 'invalid') {
      throw new Error('invalid decoded weight escaped reconstruction rejection');
    }
    return weight.significand << BigInt(weight.binaryExponent - minimumExponent);
  });
  const totalWeight = integerWeights.reduce((sum, weight) => sum + weight, 0n);
  assert.ok(totalWeight > 0n);
  const baseAllocations = integerWeights.map(
    (weight) => (amountIn * weight) / totalWeight,
  );
  const baseTotal = baseAllocations.reduce((sum, allocation) => sum + allocation, 0n);
  assert.ok(baseTotal <= amountIn);
  return {
    integerWeights,
    baseAllocations,
    residualUnits: amountIn - baseTotal,
  };
}

function isPositiveNormal(value: number): boolean {
  return Number.isFinite(value) && value >= MINIMUM_NORMAL;
}

function isPositiveNormalOrPositiveZero(value: number): boolean {
  return !Object.is(value, -0) && (value === 0 || isPositiveNormal(value));
}

function assertPositiveNormalOrPositiveZero(value: number): void {
  assert.ok(isPositiveNormalOrPositiveZero(value));
}

function endpointShare(
  model: OracleModel,
  lambda: number,
): 0 | 1 | undefined {
  if (lambda >= model.marginalScale) return 0;
  const onePlusInputScale = 1 + model.inputScale;
  const endpointDenominator = onePlusInputScale * onePlusInputScale;
  const endpointMarginal = model.marginalScale / endpointDenominator;
  assert.ok(Number.isFinite(endpointMarginal) && endpointMarginal > 0);
  return lambda <= endpointMarginal ? 1 : undefined;
}

function fixedNewtonTrace(ratio: number, updateCount = 8): NewtonTraceDisposition {
  if (!Number.isFinite(ratio)) {
    return { status: 'rejected', reason: 'ratio-not-finite', updateIndex: null };
  }
  if (!isPositiveNormal(ratio) || ratio <= 1) {
    return {
      status: 'rejected',
      reason: 'ratio-not-normal-greater-than-one',
      updateIndex: null,
    };
  }
  const bits = float64Bits(ratio);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fractionBits = bits & FRACTION_MASK;
  const k = exponentBits - 1_023;
  const z = 1 + Number(fractionBits) / 2 ** 52;
  const m = k % 2 === 0 ? z : 2 * z;
  const e = k % 2 === 0 ? k : k - 1;
  if (!(m >= 1 && m < 4 && e >= 0 && e <= 1_022 && e % 2 === 0)) {
    return { status: 'rejected', reason: 'decomposition-out-of-domain', updateIndex: null };
  }

  let y = 1;
  const updates: NewtonUpdate[] = [];
  for (let index = 0; index < updateCount; index += 1) {
    const quotient = m / y;
    const sum = y + quotient;
    y = sum / 2;
    if (!(isPositiveNormal(quotient) && isPositiveNormal(sum) && isPositiveNormal(y))) {
      return {
        status: 'rejected',
        reason: 'update-not-positive-normal',
        updateIndex: index,
      };
    }
    updates.push({ quotient, sum, y });
  }
  const scale = 2 ** (e / 2);
  const root = y * scale;
  if (!isPositiveNormal(scale)) {
    return { status: 'rejected', reason: 'scale-not-positive-normal', updateIndex: null };
  }
  return {
    status: 'accepted',
    trace: { exponentBits, fractionBits, k, z, m, e, updates, scale, root },
  };
}

function fixedNewtonFinalization(
  root: number,
  inputScale: number,
): NewtonFinalizationDisposition {
  if (!isPositiveNormal(inputScale)) {
    return { status: 'rejected', reason: 'input-scale-not-positive-normal' };
  }
  if (!Number.isFinite(root) || root < 1) {
    return { status: 'rejected', reason: 'root-not-finite-at-least-one' };
  }
  const numerator = root - 1;
  if (!isPositiveNormalOrPositiveZero(numerator)) {
    return { status: 'rejected', reason: 'numerator-not-positive-normal-or-zero' };
  }
  const share = numerator / inputScale;
  if (!isPositiveNormalOrPositiveZero(share)) {
    return { status: 'rejected', reason: 'share-not-positive-normal-or-zero' };
  }
  if (share > 1) return { status: 'rejected', reason: 'share-out-of-range' };
  return { status: 'accepted', root, numerator, share };
}

function oracleRouteShare(
  model: OracleModel,
  lambda: number,
  driver: OracleDriver,
): { readonly weight: number; readonly actions: readonly ShareActionKind[] } {
  if (driver.method === 'bisection') {
    const actions: ShareActionKind[] = ['bisection-endpoint'];
    const endpoint = endpointShare(model, lambda);
    if (endpoint !== undefined) return { weight: endpoint, actions };
    let lower = 0;
    let upper = 1;
    for (let update = 0; update < driver.innerUpdates; update += 1) {
      actions.push('bisection-inner-update');
      const mid = (lower + upper) / 2;
      const denominator = 1 + model.inputScale * mid;
      const marginal = model.marginalScale / (denominator * denominator);
      assert.ok(Number.isFinite(denominator) && denominator > 0);
      assert.ok(Number.isFinite(marginal) && marginal > 0);
      if (marginal > lambda) lower = mid;
      else upper = mid;
    }
    actions.push('bisection-final-share');
    const weight = (lower + upper) / 2;
    assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
    return { weight, actions };
  }

  if (driver.method === 'pinned-sqrt') {
    const actions: ShareActionKind[] = ['pinned-sqrt-endpoint'];
    const endpoint = endpointShare(model, lambda);
    if (endpoint !== undefined) return { weight: endpoint, actions };
    actions.push('pinned-sqrt-formula');
    const ratio = model.marginalScale / lambda;
    const root = Math.sqrt(ratio);
    const numerator = root - 1;
    const weight = numerator / model.inputScale;
    assert.ok(Number.isFinite(ratio) && ratio > 1);
    assert.ok(Number.isFinite(root) && root >= 1);
    assertPositiveNormalOrPositiveZero(numerator);
    assertPositiveNormalOrPositiveZero(weight);
    assert.ok(weight <= 1);
    return { weight, actions };
  }

  const actions: ShareActionKind[] = ['fixed-newton-sqrt-endpoint'];
  const endpoint = endpointShare(model, lambda);
  if (endpoint !== undefined) return { weight: endpoint, actions };
  actions.push('fixed-newton-sqrt-normalization');
  const ratio = model.marginalScale / lambda;
  const traceDisposition = fixedNewtonTrace(ratio, driver.newtonUpdates);
  if (traceDisposition.status === 'rejected') {
    throw new Error(`independent valid fixture rejected Newton trace: ${traceDisposition.reason}`);
  }
  const { trace } = traceDisposition;
  for (let updateIndex = 0; updateIndex < trace.updates.length; updateIndex += 1) {
    actions.push('fixed-newton-sqrt-update');
  }
  actions.push('fixed-newton-sqrt-finalization');
  const finalization = fixedNewtonFinalization(trace.root, model.inputScale);
  if (finalization.status === 'rejected') {
    throw new Error(
      `independent valid fixture rejected Newton finalization: ${finalization.reason}`,
    );
  }
  return { weight: finalization.share, actions };
}

function oracleProposal(
  amountIn: bigint,
  routes: readonly OracleRoute[],
  driver: OracleDriver,
): OracleProposal {
  const models = routes.map((candidate) => oracleModel(candidate, amountIn));
  let lambdaLower = 0;
  let lambdaUpper = Math.max(...models.map((model) => model.marginalScale));
  const actions: ShareActionKind[] = [];
  const actionSteps: OracleActionStep[] = [];
  const earlierSamples: OracleEarlierSample[] = [];

  const appendRouteActions = (
    routeIndex: number,
    actionKinds: readonly ShareActionKind[],
    sampleStatus: 'earlier-sample' | 'final-sample',
  ): void => {
    for (const [actionIndex, actionKind] of actionKinds.entries()) {
      actions.push(actionKind);
      actionSteps.push({
        actionKind,
        outerUpdateStarted:
          sampleStatus === 'earlier-sample' && routeIndex === 0 && actionIndex === 0,
        outerUpdateCompleted:
          sampleStatus === 'earlier-sample' &&
          routeIndex === models.length - 1 &&
          actionIndex === actionKinds.length - 1,
      });
    }
  };

  for (let update = 0; update < driver.outerUpdates; update += 1) {
    const lambdaMid = lambdaLower + (lambdaUpper - lambdaLower) / 2;
    let sum = 0;
    const weights: number[] = [];
    for (const [routeIndex, model] of models.entries()) {
      const sampled = oracleRouteShare(model, lambdaMid, driver);
      appendRouteActions(routeIndex, sampled.actions, 'earlier-sample');
      weights.push(sampled.weight);
      sum += sampled.weight;
    }
    assert.ok(Number.isFinite(sum) && sum >= 0 && sum <= routes.length);
    earlierSamples.push({
      status: 'earlier-sample',
      completedOuterUpdates: update + 1,
      weights,
    });
    if (sum > 1) lambdaLower = lambdaMid;
    else lambdaUpper = lambdaMid;
  }

  const finalLambda = lambdaLower + (lambdaUpper - lambdaLower) / 2;
  const weights: number[] = [];
  let finalSum = 0;
  for (const [routeIndex, model] of models.entries()) {
    const sampled = oracleRouteShare(model, finalLambda, driver);
    appendRouteActions(routeIndex, sampled.actions, 'final-sample');
    weights.push(sampled.weight);
    finalSum += sampled.weight;
  }
  const difference = finalSum - 1;
  const absoluteDifference = difference < 0 ? -difference : difference;
  return {
    driverId: driver.driverId,
    amountIn,
    earlierSamples,
    finalSample: {
      status: 'final-sample',
      completedOuterUpdates: driver.outerUpdates,
      weights,
    },
    converged: absoluteDifference <= CONVERGENCE_TOLERANCE,
    completedOuterUpdates: driver.outerUpdates,
    actions,
    actionSteps,
  };
}

function actionCounts(
  actions: readonly ShareActionKind[],
): Readonly<Record<ShareActionKind, number>> {
  const counts = Object.fromEntries(
    [
      'bisection-endpoint',
      'bisection-inner-update',
      'bisection-final-share',
      'pinned-sqrt-endpoint',
      'pinned-sqrt-formula',
      'fixed-newton-sqrt-endpoint',
      'fixed-newton-sqrt-normalization',
      'fixed-newton-sqrt-update',
      'fixed-newton-sqrt-finalization',
    ].map((kind) => [kind, 0]),
  ) as Record<ShareActionKind, number>;
  for (const action of actions) counts[action] += 1;
  return counts;
}

function replayWeightRejection(weight: number): FinalReplayRejection | undefined {
  if (Object.is(weight, -0)) return 'negative-zero';
  if (!Number.isFinite(weight)) return 'nonfinite';
  if (weight < 0 || weight > 1) return 'out-of-range';
  if (weight !== 0 && weight < MINIMUM_NORMAL) return 'subnormal';
  const decoded = decodeWeightHex(float64Hex(weight));
  if (decoded.status !== 'invalid') return undefined;
  if (decoded.reason === 'subnormal') return 'subnormal';
  if (decoded.reason === 'nonfinite') return 'nonfinite';
  return 'out-of-range';
}

function finalDisposition(
  proposal: OracleProposal,
  mode: NonConvergence,
  sample: OracleProposalSample = proposal.finalSample,
): ProposalDisposition {
  if (!proposal.converged && mode === 'strict-reject') {
    return { status: 'rejected', reason: 'strict-mode', routeIndex: null };
  }
  if (
    sample.status !== 'final-sample' ||
    sample.completedOuterUpdates !== proposal.completedOuterUpdates
  ) {
    return { status: 'rejected', reason: 'earlier-sample', routeIndex: null };
  }
  for (const [routeIndex, weight] of sample.weights.entries()) {
    const rejection = replayWeightRejection(weight);
    if (rejection !== undefined) {
      return { status: 'rejected', reason: rejection, routeIndex };
    }
  }
  const reconstruction = reconstructFromHexWeights(
    proposal.amountIn,
    sample.weights.map(float64Hex),
  );
  if ('failure' in reconstruction) {
    return { status: 'rejected', reason: reconstruction.failure, routeIndex: null };
  }
  return {
    status: 'accepted',
    converged: proposal.converged,
    diagnostic: proposal.converged ? null : 'finite-nonconverged-replayed',
    reconstruction,
  };
}

interface ActualProposalObservation {
  readonly steps: readonly ServiceFastPathShadowPriceStepResult[];
  readonly progress: ServiceFastPathShadowPriceProgress;
  readonly metadata: ServiceFastPathShadowPriceProposalMetadata | undefined;
  readonly failure: ServiceFastPathShadowPriceFailure | undefined;
}

function runActualProposal(
  amountIn: bigint,
  routes: readonly OracleRoute[],
  driverId: DriverId,
  nonConvergence: NonConvergence,
): ActualProposalObservation {
  const state = createServiceFastPathShadowPriceState(amountIn, routes.length, {
    driverId,
    nonConvergence,
  });
  for (const candidate of routes) {
    const appended = appendServiceFastPathShadowPriceModelRoute(state, candidate);
    assert.equal(appended.ok, true);
  }
  const started = startServiceFastPathShadowPriceProposal(state);
  assert.equal(started.ok, true);

  const steps: ServiceFastPathShadowPriceStepResult[] = [];
  let guard = 0;
  while (serviceFastPathShadowPriceProgress(state).phase === 'share-action') {
    const before = serviceFastPathShadowPriceProgress(state);
    assert.notEqual(before.nextShareAction, null);
    const step = advanceServiceFastPathShadowPriceShareAction(state);
    assert.equal(step.actionKind, before.nextShareAction);
    steps.push(step);
    guard += 1;
    assert.ok(guard < 50_000);
    if (!step.ok) break;
  }
  return {
    steps: Object.freeze(steps),
    progress: serviceFastPathShadowPriceProgress(state),
    metadata: serviceFastPathShadowPriceProposalMetadata(state),
    failure: serviceFastPathShadowPriceFailure(state),
  };
}

function isEndpointAction(actionKind: ShareActionKind): boolean {
  return actionKind === 'bisection-endpoint' ||
    actionKind === 'pinned-sqrt-endpoint' ||
    actionKind === 'fixed-newton-sqrt-endpoint';
}

function actualActionSteps(
  steps: readonly ServiceFastPathShadowPriceStepResult[],
): readonly OracleActionStep[] {
  return steps.map((step) => {
    if (step.actionKind === null) {
      throw new Error('A charged production share action omitted its action kind.');
    }
    return {
      actionKind: step.actionKind,
      outerUpdateStarted: step.outerUpdateStarted,
      outerUpdateCompleted: step.outerUpdateCompleted,
    };
  });
}

function runProtected64Proposal(
  amountIn: bigint,
  routes: readonly OracleRoute[],
) {
  const state = createServicePathShadowPriceState(amountIn, routes.length);
  for (const candidate of routes) {
    assert.equal(appendServicePathShadowPriceModelRoute(state, candidate).ok, true);
  }
  assert.equal(startServicePathShadowPriceProposal(state).ok, true);
  const steps: Array<{
    readonly ok: boolean;
    readonly outerUpdateStarted: boolean;
    readonly outerUpdateCompleted: boolean;
  }> = [];
  let guard = 0;
  while (servicePathShadowPriceProgress(state).phase === 'share-microstep') {
    const step = advanceServicePathShadowPriceShareMicrostep(state);
    steps.push({
      ok: step.ok,
      outerUpdateStarted: step.ok ? step.outerUpdateStarted : false,
      outerUpdateCompleted: step.ok ? step.outerUpdateCompleted : false,
    });
    guard += 1;
    assert.ok(guard < 50_000);
    if (!step.ok) break;
  }
  return {
    steps: Object.freeze(steps),
    progress: servicePathShadowPriceProgress(state),
    weights: servicePathShadowPriceReadyWeights(state),
    failure: servicePathShadowPriceFailure(state),
  };
}

void test('locks the six independently derived driver weight and action goldens', () => {
  const routes = [route(hop(1n, 3n)), route(hop(3n, 4n))];
  const actual = DRIVERS.map((driver) => {
    const proposal = oracleProposal(5n, routes, driver);
    const counts = actionCounts(proposal.actions);
    return {
      driverId: proposal.driverId,
      earlierSampleCount: proposal.earlierSamples.length,
      earlierSampleStatuses: [...new Set(proposal.earlierSamples.map((sample) => sample.status))],
      finalSampleStatus: proposal.finalSample.status,
      weightBits: proposal.finalSample.weights.map(float64Hex),
      converged: proposal.converged,
      completedOuterUpdates: proposal.completedOuterUpdates,
      actionCount: proposal.actions.length,
      actionCounts: Object.fromEntries(
        Object.entries(counts).filter((entry) => entry[1] !== 0),
      ),
    };
  });

  assert.deepEqual(actual, [
    {
      driverId: 'bisection-o64-i64',
      earlierSampleCount: 64,
      earlierSampleStatuses: ['earlier-sample'],
      finalSampleStatus: 'final-sample',
      weightBits: ['3fd999999999999c', '3fe3333333333334'],
      converged: true,
      completedOuterUpdates: 64,
      actionCount: 8_515,
      actionCounts: {
        'bisection-endpoint': 130,
        'bisection-inner-update': 8_256,
        'bisection-final-share': 129,
      },
    },
    {
      driverId: 'bisection-o64-i24',
      earlierSampleCount: 64,
      earlierSampleStatuses: ['earlier-sample'],
      finalSampleStatus: 'final-sample',
      weightBits: ['3fd99999a0000000', '3fe3333330000000'],
      converged: true,
      completedOuterUpdates: 64,
      actionCount: 3_355,
      actionCounts: {
        'bisection-endpoint': 130,
        'bisection-inner-update': 3_096,
        'bisection-final-share': 129,
      },
    },
    {
      driverId: 'bisection-o32-i16',
      earlierSampleCount: 32,
      earlierSampleStatuses: ['earlier-sample'],
      finalSampleStatus: 'final-sample',
      weightBits: ['3fd999a000000000', '3fe3335000000000'],
      converged: false,
      completedOuterUpdates: 32,
      actionCount: 1_171,
      actionCounts: {
        'bisection-endpoint': 66,
        'bisection-inner-update': 1_040,
        'bisection-final-share': 65,
      },
    },
    {
      driverId: 'bisection-o16-i12',
      earlierSampleCount: 16,
      earlierSampleStatuses: ['earlier-sample'],
      finalSampleStatus: 'final-sample',
      weightBits: ['3fd99a0000000000', '3fe3350000000000'],
      converged: false,
      completedOuterUpdates: 16,
      actionCount: 463,
      actionCounts: {
        'bisection-endpoint': 34,
        'bisection-inner-update': 396,
        'bisection-final-share': 33,
      },
    },
    {
      driverId: 'pinned-sqrt-o64',
      earlierSampleCount: 64,
      earlierSampleStatuses: ['earlier-sample'],
      finalSampleStatus: 'final-sample',
      weightBits: ['3fd999999999999b', '3fe3333333333333'],
      converged: true,
      completedOuterUpdates: 64,
      actionCount: 259,
      actionCounts: {
        'pinned-sqrt-endpoint': 130,
        'pinned-sqrt-formula': 129,
      },
    },
    {
      driverId: 'fixed-newton-sqrt-o64-n8',
      earlierSampleCount: 64,
      earlierSampleStatuses: ['earlier-sample'],
      finalSampleStatus: 'final-sample',
      weightBits: ['3fd999999999999a', '3fe3333333333333'],
      converged: true,
      completedOuterUpdates: 64,
      actionCount: 1_420,
      actionCounts: {
        'fixed-newton-sqrt-endpoint': 130,
        'fixed-newton-sqrt-normalization': 129,
        'fixed-newton-sqrt-update': 1_032,
        'fixed-newton-sqrt-finalization': 129,
      },
    },
  ]);
});

void test('locks the four-set/four-route method and share action ceilings', () => {
  const maximumCandidateSets = 4;
  const maximumRoutes = 4;
  const table = DRIVERS.map((driver) => {
    const samplesPerRoute = driver.outerUpdates + 1;
    const methodActionsPerSample =
      driver.method === 'bisection'
        ? driver.innerUpdates + 1
        : driver.method === 'pinned-sqrt'
          ? 1
          : driver.newtonUpdates + 2;
    const endpointActionsPerSample = 1;
    const multiplier = maximumCandidateSets * maximumRoutes * samplesPerRoute;
    return {
      driverId: driver.driverId,
      samplesPerRoute,
      endpointActionsPerSample,
      methodActionsPerSample,
      maximumEndpointActions: multiplier * endpointActionsPerSample,
      maximumMethodActions: multiplier * methodActionsPerSample,
      maximumShareActions:
        multiplier * (endpointActionsPerSample + methodActionsPerSample),
    };
  });

  assert.deepEqual(table, [
    {
      driverId: 'bisection-o64-i64',
      samplesPerRoute: 65,
      endpointActionsPerSample: 1,
      methodActionsPerSample: 65,
      maximumEndpointActions: 1_040,
      maximumMethodActions: 67_600,
      maximumShareActions: 68_640,
    },
    {
      driverId: 'bisection-o64-i24',
      samplesPerRoute: 65,
      endpointActionsPerSample: 1,
      methodActionsPerSample: 25,
      maximumEndpointActions: 1_040,
      maximumMethodActions: 26_000,
      maximumShareActions: 27_040,
    },
    {
      driverId: 'bisection-o32-i16',
      samplesPerRoute: 33,
      endpointActionsPerSample: 1,
      methodActionsPerSample: 17,
      maximumEndpointActions: 528,
      maximumMethodActions: 8_976,
      maximumShareActions: 9_504,
    },
    {
      driverId: 'bisection-o16-i12',
      samplesPerRoute: 17,
      endpointActionsPerSample: 1,
      methodActionsPerSample: 13,
      maximumEndpointActions: 272,
      maximumMethodActions: 3_536,
      maximumShareActions: 3_808,
    },
    {
      driverId: 'pinned-sqrt-o64',
      samplesPerRoute: 65,
      endpointActionsPerSample: 1,
      methodActionsPerSample: 1,
      maximumEndpointActions: 1_040,
      maximumMethodActions: 1_040,
      maximumShareActions: 2_080,
    },
    {
      driverId: 'fixed-newton-sqrt-o64-n8',
      samplesPerRoute: 65,
      endpointActionsPerSample: 1,
      methodActionsPerSample: 10,
      maximumEndpointActions: 1_040,
      maximumMethodActions: 10_400,
      maximumShareActions: 11_440,
    },
  ]);
});

void test('matches all six opaque production drivers to independent action and proposal goldens', () => {
  const routes = [route(hop(1n, 3n)), route(hop(3n, 4n))];

  for (const driver of DRIVERS) {
    const expected = oracleProposal(5n, routes, driver);
    assert.deepEqual(
      expected.actionSteps.map((step) => step.actionKind),
      expected.actions,
    );
    for (const nonConvergence of [
      'strict-reject',
      'final-finite-replay',
    ] as const) {
      const actual = runActualProposal(
        5n,
        routes,
        driver.driverId,
        nonConvergence,
      );
      const disposition = finalDisposition(expected, nonConvergence);
      assert.deepEqual(actualActionSteps(actual.steps), expected.actionSteps);
      assert.equal(actual.progress.shareActions, expected.actionSteps.length);
      assert.equal(
        actual.progress.methodActions,
        expected.actions.filter((actionKind) => !isEndpointAction(actionKind)).length,
      );
      assert.equal(actual.progress.outerUpdatesStarted, driver.outerUpdates);
      assert.equal(actual.progress.outerUpdatesCompleted, driver.outerUpdates);
      assert.equal(
        actual.steps.filter((step) => step.outerUpdateStarted).length,
        driver.outerUpdates,
      );
      assert.equal(
        actual.steps.filter((step) => step.outerUpdateCompleted).length,
        driver.outerUpdates,
      );

      if (disposition.status === 'rejected') {
        assert.equal(disposition.reason, 'strict-mode');
        assert.equal(actual.progress.phase, 'failed');
        assert.equal(actual.metadata, undefined);
        assert.deepEqual(actual.failure, {
          code: 'non-convergence',
          converged: false,
          completedOuterUpdates: driver.outerUpdates,
        });
        assert.equal(actual.steps.at(-1)?.ok, false);
        assert.ok(actual.steps.slice(0, -1).every((step) => step.ok));
        continue;
      }

      assert.equal(actual.progress.phase, 'reconstruction-step');
      assert.equal(actual.failure, undefined);
      assert.ok(actual.steps.every((step) => step.ok));
      assert.deepEqual(
        actual.metadata === undefined
          ? undefined
          : {
              converged: actual.metadata.converged,
              diagnostic: actual.metadata.diagnostic,
              completedOuterUpdates: actual.metadata.completedOuterUpdates,
              weightBits: actual.metadata.weights.map(float64Hex),
            },
        {
          converged: disposition.converged,
          diagnostic: disposition.diagnostic,
          completedOuterUpdates: driver.outerUpdates,
          weightBits: expected.finalSample.weights.map(float64Hex),
        },
      );
    }
  }
});

void test('matches protected configurable-64 observations to the independent oracle', () => {
  const driver = DRIVERS[0]!;
  const scale = 2n ** 60n;
  const fixtures = [
    {
      amountIn: 5n,
      routes: [route(hop(1n, 3n)), route(hop(3n, 4n))],
    },
    {
      amountIn: 1n,
      routes: [
        route(hop(10n * scale, 3n * scale)),
        route(hop(scale, 8n * scale)),
      ],
    },
  ] as const;

  for (const fixture of fixtures) {
    const expected = oracleProposal(fixture.amountIn, fixture.routes, driver);
    const configurable = runActualProposal(
      fixture.amountIn,
      fixture.routes,
      driver.driverId,
      'strict-reject',
    );
    const protected64 = runProtected64Proposal(fixture.amountIn, fixture.routes);

    assert.deepEqual(actualActionSteps(configurable.steps), expected.actionSteps);
    assert.deepEqual(
      protected64.steps.map((step) => ({
        outerUpdateStarted: step.outerUpdateStarted,
        outerUpdateCompleted: step.outerUpdateCompleted,
      })),
      expected.actionSteps.map((step) => ({
        outerUpdateStarted: step.outerUpdateStarted,
        outerUpdateCompleted: step.outerUpdateCompleted,
      })),
    );
    assert.equal(configurable.progress.shareActions, expected.actions.length);
    assert.equal(protected64.progress.shareMicrosteps, expected.actions.length);
    assert.equal(
      configurable.progress.outerUpdatesStarted,
      expected.completedOuterUpdates,
    );
    assert.equal(
      protected64.progress.outerUpdatesStarted,
      expected.completedOuterUpdates,
    );
    assert.equal(
      configurable.progress.outerUpdatesCompleted,
      expected.completedOuterUpdates,
    );
    assert.equal(
      protected64.progress.outerUpdatesCompleted,
      expected.completedOuterUpdates,
    );

    if (!expected.converged) {
      assert.equal(configurable.progress.phase, 'failed');
      assert.equal(protected64.progress.phase, 'failed');
      assert.deepEqual(configurable.failure, protected64.failure);
      assert.deepEqual(configurable.failure, {
        code: 'non-convergence',
        converged: false,
        completedOuterUpdates: 64,
      });
      assert.equal(configurable.metadata, undefined);
      assert.equal(protected64.weights, undefined);
      continue;
    }

    assert.ok(configurable.steps.every((step) => step.ok));
    assert.ok(protected64.steps.every((step) => step.ok));
    assert.equal(configurable.progress.phase, 'reconstruction-step');
    assert.equal(protected64.progress.phase, 'reconstruction-step');
    assert.deepEqual(
      configurable.metadata?.weights.map(float64Hex),
      expected.finalSample.weights.map(float64Hex),
    );
    assert.deepEqual(
      protected64.weights?.map(float64Hex),
      expected.finalSample.weights.map(float64Hex),
    );
    assert.equal(configurable.failure, undefined);
    assert.equal(protected64.failure, undefined);
  }
});

void test('matches naturally reachable production endpoint failures to frozen domains', () => {
  const amountIn = 1n << 1_000n;
  const routes = [route(hop(1n, 1n)), route(hop(1n, 1n))];

  for (const driver of DRIVERS) {
    const expectedEndpoint: ShareActionKind =
      driver.method === 'bisection'
        ? 'bisection-endpoint'
        : driver.method === 'pinned-sqrt'
          ? 'pinned-sqrt-endpoint'
          : 'fixed-newton-sqrt-endpoint';
    const actual = runActualProposal(
      amountIn,
      routes,
      driver.driverId,
      'final-finite-replay',
    );
    assert.deepEqual(actual.steps, [
      {
        ok: false,
        error: {
          code: 'non-finite-proposal',
          converged: false,
          completedOuterUpdates: 0,
        },
        actionKind: expectedEndpoint,
        outerUpdateStarted: true,
        outerUpdateCompleted: false,
      },
    ]);
    assert.deepEqual(actual.progress, {
      phase: 'failed',
      driverId: driver.driverId,
      nonConvergence: 'final-finite-replay',
      nextShareAction: null,
      routeCount: 2,
      modelRoutesCompleted: 2,
      outerUpdatesStarted: 1,
      outerUpdatesCompleted: 0,
      methodActions: 0,
      shareActions: 1,
      reconstructionSteps: 0,
    });
    assert.equal(actual.metadata, undefined);
    assert.deepEqual(actual.failure, {
      code: 'non-finite-proposal',
      converged: false,
      completedOuterUpdates: 0,
    });
  }
});

void test('locks IEEE-754 decode, exact bigint reconstruction, and final-finite admission', () => {
  assert.deepEqual(decodeWeightHex('0000000000000000'), { status: 'zero' });
  assert.deepEqual(decodeWeightHex('3ff0000000000000'), {
    status: 'normal',
    significand: 4_503_599_627_370_496n,
    binaryExponent: -52,
  });
  assert.deepEqual(decodeWeightHex('8000000000000000'), {
    status: 'invalid',
    reason: 'negative',
  });
  assert.deepEqual(decodeWeightHex('0000000000000001'), {
    status: 'invalid',
    reason: 'subnormal',
  });
  assert.deepEqual(decodeWeightHex('7ff0000000000000'), {
    status: 'invalid',
    reason: 'nonfinite',
  });
  assert.deepEqual(decodeWeightHex('7ff8000000000000'), {
    status: 'invalid',
    reason: 'nonfinite',
  });
  assert.deepEqual(reconstructFromHexWeights(1n, ['8000000000000000']), {
    failure: 'invalid-reconstruction',
  });
  assert.deepEqual(reconstructFromHexWeights(1n, ['0000000000000000']), {
    failure: 'zero-total-weight',
  });

  const routes = [route(hop(1n, 3n)), route(hop(3n, 4n))];
  const expectedReconstructions = [
    {
      integerWeights: [7_205_759_403_792_796n, 10_808_639_105_689_192n],
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    },
    {
      integerWeights: [7_205_759_511_166_976n, 10_808_638_998_315_008n],
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    },
    {
      integerWeights: [7_205_786_891_583_488n, 10_808_886_495_805_440n],
      baseAllocations: [1n, 3n],
      residualUnits: 1n,
    },
    {
      integerWeights: [7_206_199_208_443_904n, 10_812_597_347_549_184n],
      baseAllocations: [1n, 3n],
      residualUnits: 1n,
    },
    {
      integerWeights: [7_205_759_403_792_795n, 10_808_639_105_689_190n],
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    },
    {
      integerWeights: [7_205_759_403_792_794n, 10_808_639_105_689_190n],
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    },
  ];
  for (const [index, driver] of DRIVERS.entries()) {
    const proposal = oracleProposal(5n, routes, driver);
    assert.deepEqual(
      reconstructFromHexWeights(5n, proposal.finalSample.weights.map(float64Hex)),
      expectedReconstructions[index],
    );
  }

  const lower32 = oracleProposal(5n, routes, DRIVERS[2]!);
  const lower16 = oracleProposal(5n, routes, DRIVERS[3]!);
  assert.deepEqual(finalDisposition(lower32, 'strict-reject'), {
    status: 'rejected',
    reason: 'strict-mode',
    routeIndex: null,
  });
  assert.deepEqual(finalDisposition(lower32, 'final-finite-replay'), {
    status: 'accepted',
    converged: false,
    diagnostic: 'finite-nonconverged-replayed',
    reconstruction: expectedReconstructions[2],
  });
  assert.deepEqual(finalDisposition(lower16, 'strict-reject'), {
    status: 'rejected',
    reason: 'strict-mode',
    routeIndex: null,
  });
  assert.deepEqual(finalDisposition(lower16, 'final-finite-replay'), {
    status: 'accepted',
    converged: false,
    diagnostic: 'finite-nonconverged-replayed',
    reconstruction: expectedReconstructions[3],
  });

  const lastEarlierSample = lower32.earlierSamples.at(-1);
  assert.ok(lastEarlierSample !== undefined);
  assert.ok(lastEarlierSample.weights.every(Number.isFinite));
  assert.deepEqual(
    finalDisposition(lower32, 'final-finite-replay', lastEarlierSample),
    { status: 'rejected', reason: 'earlier-sample', routeIndex: null },
  );
  assert.deepEqual(
    finalDisposition(lower32, 'final-finite-replay', {
      ...lower32.finalSample,
      completedOuterUpdates: lower32.completedOuterUpdates - 1,
    }),
    { status: 'rejected', reason: 'earlier-sample', routeIndex: null },
  );

  const finalSample = (weights: readonly number[]): OracleFinalSample => ({
    status: 'final-sample',
    completedOuterUpdates: lower32.completedOuterUpdates,
    weights,
  });
  const rejectedWeights: readonly {
    readonly weights: readonly number[];
    readonly reason: FinalReplayRejection;
    readonly routeIndex: number | null;
  }[] = [
    { weights: [-0, 1], reason: 'negative-zero', routeIndex: 0 },
    { weights: [Number.MIN_VALUE, 1], reason: 'subnormal', routeIndex: 0 },
    { weights: [Number.NaN, 1], reason: 'nonfinite', routeIndex: 0 },
    { weights: [Number.POSITIVE_INFINITY, 1], reason: 'nonfinite', routeIndex: 0 },
    { weights: [Number.NEGATIVE_INFINITY, 1], reason: 'nonfinite', routeIndex: 0 },
    { weights: [-0.25, 1], reason: 'out-of-range', routeIndex: 0 },
    { weights: [1.25, 0], reason: 'out-of-range', routeIndex: 0 },
    { weights: [0, 0], reason: 'zero-total-weight', routeIndex: null },
  ];
  for (const rejected of rejectedWeights) {
    assert.deepEqual(
      finalDisposition(lower32, 'final-finite-replay', finalSample(rejected.weights)),
      {
        status: 'rejected',
        reason: rejected.reason,
        routeIndex: rejected.routeIndex,
      },
    );
  }

  assert.deepEqual(
    finalDisposition(lower32, 'final-finite-replay', finalSample([0, 1])),
    {
      status: 'accepted',
      converged: false,
      diagnostic: 'finite-nonconverged-replayed',
      reconstruction: {
        integerWeights: [0n, 4_503_599_627_370_496n],
        baseAllocations: [0n, 5n],
        residualUnits: 0n,
      },
    },
  );

  const hugeAmount = (1n << 255n) - 19n;
  const huge = reconstructFromHexWeights(hugeAmount, [
    '3fe0000000000000',
    '3fe0000000000000',
  ]);
  assert.equal('failure' in huge, false);
  if ('failure' in huge) throw new Error('Expected an exact reconstruction.');
  assert.deepEqual(huge.baseAllocations, [hugeAmount / 2n, hugeAmount / 2n]);
  assert.equal(huge.residualUnits, 1n);
  assert.equal(
    huge.baseAllocations.reduce((sum, allocation) => sum + allocation, 0n) +
      huge.residualUnits,
    hugeAmount,
  );
});

void test('locks eight-update Newton traces across fraction and exponent extremes', () => {
  const traceGolden = (ratio: number) => {
    const disposition = fixedNewtonTrace(ratio);
    if (disposition.status === 'rejected') {
      throw new Error(`Expected accepted Newton trace, received ${disposition.reason}.`);
    }
    const { trace } = disposition;
    return {
      ratio: float64Hex(ratio),
      exponentBits: trace.exponentBits,
      fractionBits: trace.fractionBits.toString(16).padStart(13, '0'),
      k: trace.k,
      z: float64Hex(trace.z),
      m: float64Hex(trace.m),
      e: trace.e,
      scale: float64Hex(trace.scale),
      root: float64Hex(trace.root),
      updates: trace.updates.map((update) => ({
        quotient: float64Hex(update.quotient),
        sum: float64Hex(update.sum),
        y: float64Hex(update.y),
      })),
    };
  };

  assert.deepEqual(
    [traceGolden(2), traceGolden(6), traceGolden(Number.MAX_VALUE)],
    [
      {
        ratio: '4000000000000000',
        exponentBits: 1_024,
        fractionBits: '0000000000000',
        k: 1,
        z: '3ff0000000000000',
        m: '4000000000000000',
        e: 0,
        scale: '3ff0000000000000',
        root: '3ff6a09e667f3bcc',
        updates: [
          {
            quotient: '4000000000000000',
            sum: '4008000000000000',
            y: '3ff8000000000000',
          },
          {
            quotient: '3ff5555555555555',
            sum: '4006aaaaaaaaaaaa',
            y: '3ff6aaaaaaaaaaaa',
          },
          {
            quotient: '3ff6969696969697',
            sum: '4006a0a0a0a0a0a0',
            y: '3ff6a0a0a0a0a0a0',
          },
          {
            quotient: '3ff6a09c2c5e0f16',
            sum: '4006a09e667f57db',
            y: '3ff6a09e667f57db',
          },
          {
            quotient: '3ff6a09e667f1fbe',
            sum: '4006a09e667f3bcc',
            y: '3ff6a09e667f3bcc',
          },
          {
            quotient: '3ff6a09e667f3bcd',
            sum: '4006a09e667f3bcc',
            y: '3ff6a09e667f3bcc',
          },
          {
            quotient: '3ff6a09e667f3bcd',
            sum: '4006a09e667f3bcc',
            y: '3ff6a09e667f3bcc',
          },
          {
            quotient: '3ff6a09e667f3bcd',
            sum: '4006a09e667f3bcc',
            y: '3ff6a09e667f3bcc',
          },
        ],
      },
      {
        ratio: '4018000000000000',
        exponentBits: 1_025,
        fractionBits: '8000000000000',
        k: 2,
        z: '3ff8000000000000',
        m: '3ff8000000000000',
        e: 2,
        scale: '4000000000000000',
        root: '4003988e1409212e',
        updates: [
          {
            quotient: '3ff8000000000000',
            sum: '4004000000000000',
            y: '3ff4000000000000',
          },
          {
            quotient: '3ff3333333333333',
            sum: '400399999999999a',
            y: '3ff399999999999a',
          },
          {
            quotient: '3ff397829cbc14e5',
            sum: '4003988e1b2ad740',
            y: '3ff3988e1b2ad740',
          },
          {
            quotient: '3ff3988e0ce76b20',
            sum: '4003988e14092130',
            y: '3ff3988e14092130',
          },
          {
            quotient: '3ff3988e1409212d',
            sum: '4003988e1409212e',
            y: '3ff3988e1409212e',
          },
          {
            quotient: '3ff3988e1409212f',
            sum: '4003988e1409212e',
            y: '3ff3988e1409212e',
          },
          {
            quotient: '3ff3988e1409212f',
            sum: '4003988e1409212e',
            y: '3ff3988e1409212e',
          },
          {
            quotient: '3ff3988e1409212f',
            sum: '4003988e1409212e',
            y: '3ff3988e1409212e',
          },
        ],
      },
      {
        ratio: '7fefffffffffffff',
        exponentBits: 2_046,
        fractionBits: 'fffffffffffff',
        k: 1_023,
        z: '3fffffffffffffff',
        m: '400fffffffffffff',
        e: 1_022,
        scale: '5fe0000000000000',
        root: '5ff0000000000000',
        updates: [
          {
            quotient: '400fffffffffffff',
            sum: '4014000000000000',
            y: '4004000000000000',
          },
          {
            quotient: '3ff9999999999999',
            sum: '4010666666666666',
            y: '4000666666666666',
          },
          {
            quotient: '3fff3831f3831f38',
            sum: '4010013fb013fb01',
            y: '4000013fb013fb01',
          },
          {
            quotient: '3ffffd80d1bb2e94',
            sum: '401000000c78c926',
            y: '400000000c78c926',
          },
          {
            quotient: '3fffffffe70e6dc6',
            sum: '4010000000000004',
            y: '4000000000000004',
          },
          {
            quotient: '3ffffffffffffff7',
            sum: '4010000000000000',
            y: '4000000000000000',
          },
          {
            quotient: '3fffffffffffffff',
            sum: '4010000000000000',
            y: '4000000000000000',
          },
          {
            quotient: '3fffffffffffffff',
            sum: '4010000000000000',
            y: '4000000000000000',
          },
        ],
      },
    ],
  );

  const squareRootOfTwo = fixedNewtonTrace(2);
  if (squareRootOfTwo.status === 'rejected') throw new Error('Expected accepted trace.');
  assert.equal(squareRootOfTwo.status, 'accepted');
  assert.equal(float64Hex(Math.sqrt(2)), '3ff6a09e667f3bcd');
  assert.notEqual(float64Hex(squareRootOfTwo.trace.root), float64Hex(Math.sqrt(2)));
});

void test('returns typed Newton ratio and finalization domain rejections', () => {
  // The production state is intentionally opaque, so raw mantissa/exponent/root
  // injection is impossible; these frozen domain cases remain purely independent.
  for (const ratio of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(fixedNewtonTrace(ratio), {
      status: 'rejected',
      reason: 'ratio-not-finite',
      updateIndex: null,
    });
  }
  for (const ratio of [-1, -0, 0, Number.MIN_VALUE, 1]) {
    assert.deepEqual(fixedNewtonTrace(ratio), {
      status: 'rejected',
      reason: 'ratio-not-normal-greater-than-one',
      updateIndex: null,
    });
  }

  for (const inputScale of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    -0,
    0,
    Number.MIN_VALUE,
  ]) {
    assert.deepEqual(fixedNewtonFinalization(2, inputScale), {
      status: 'rejected',
      reason: 'input-scale-not-positive-normal',
    });
  }
  for (const root of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    0.5,
  ]) {
    assert.deepEqual(fixedNewtonFinalization(root, 1), {
      status: 'rejected',
      reason: 'root-not-finite-at-least-one',
    });
  }
  assert.deepEqual(fixedNewtonFinalization(1 + 2 ** -52, 2 ** 1_022), {
    status: 'rejected',
    reason: 'share-not-positive-normal-or-zero',
  });
  assert.deepEqual(fixedNewtonFinalization(2, 0.5), {
    status: 'rejected',
    reason: 'share-out-of-range',
  });
  assert.deepEqual(fixedNewtonFinalization(1, 1), {
    status: 'accepted',
    root: 1,
    numerator: 0,
    share: 0,
  });
});

// The black-box proposal assertions above compare production observations to these
// independent goldens. Reconstruction and residual actuals remain deferred until
// that production increment integrates; no production helper constructs expected
// values here.
