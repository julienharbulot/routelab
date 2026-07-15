import {
  capturePathShadowPriceConfiguration,
  type CapturedPathShadowPriceConfiguration,
} from '../../allocation/path-shadow-price/index.ts';
import type { ExactInputSplitRuntimeRequest } from '../anytime-exact-input-split/index.ts';
import {
  isPreparedRoutingContext,
  preparedRoutingContextHasAsset,
  preparedRoutingContextMatchesIdentity,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import type {
  NumericalExactInputSplitRuntimeControl,
  NumericalExactInputSplitRuntimeControlValidationError,
  NumericalExactInputSplitRuntimeRequest,
  NumericalExactInputSplitRuntimeResult,
  NumericalExactInputSplitRuntimeValidationError,
  NumericalExactInputSplitWorkCaps,
} from './types.ts';

type InvalidRequest = Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'invalid-request' }
>;
type InvalidControl = Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'invalid-control' }
>;

export interface CapturedRequest extends ExactInputSplitRuntimeRequest {
  readonly numerical: CapturedPathShadowPriceConfiguration;
}
export interface CapturedControl {
  readonly caps: NumericalExactInputSplitWorkCaps;
  readonly shouldInterrupt: NumericalExactInputSplitRuntimeControl['shouldInterrupt'];
  readonly deadlineNanoseconds: bigint | undefined;
  readonly nowNanoseconds: (() => bigint) | undefined;
}

const BASE_CAP_FIELDS = [
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


function invalidRequest(
  error: NumericalExactInputSplitRuntimeValidationError,
): InvalidRequest {
  return Object.freeze({ status: 'invalid-request', error: Object.freeze(error) });
}

function invalidControl(
  error: NumericalExactInputSplitRuntimeControlValidationError,
): InvalidControl {
  return Object.freeze({ status: 'invalid-control', error: Object.freeze(error) });
}

export function captureRequest(
  context: PreparedRoutingContext,
  source: NumericalExactInputSplitRuntimeRequest,
): CapturedRequest | InvalidRequest {
  let snapshotId: unknown;
  let snapshotChecksum: unknown;
  let assetIn: unknown;
  let assetOut: unknown;
  let amountIn: unknown;
  let maxHops: unknown;
  let maxRoutes: unknown;
  let greedyParts: unknown;
  try {
    snapshotId = source.snapshotId;
  } catch {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  try {
    snapshotChecksum = source.snapshotChecksum;
  } catch {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  try {
    assetIn = source.assetIn;
  } catch {
    return invalidRequest({ code: 'empty-identifier', field: 'assetIn' });
  }
  try {
    assetOut = source.assetOut;
  } catch {
    return invalidRequest({ code: 'empty-identifier', field: 'assetOut' });
  }
  try {
    amountIn = source.amountIn;
  } catch {
    return invalidRequest({ code: 'nonpositive-input', field: 'amountIn' });
  }
  try {
    maxHops = source.maxHops;
  } catch {
    return invalidRequest({ code: 'invalid-max-hops', field: 'maxHops' });
  }
  try {
    maxRoutes = source.maxRoutes;
  } catch {
    return invalidRequest({ code: 'invalid-max-routes', field: 'maxRoutes' });
  }
  try {
    greedyParts = source.greedyParts;
  } catch {
    return invalidRequest({ code: 'invalid-greedy-parts', field: 'greedyParts' });
  }

  let numerical: unknown;
  try {
    numerical = source.numerical;
  } catch {
    numerical = undefined;
  }
  let outerIterations: unknown;
  let innerIterations: unknown;
  let convergenceTolerance: unknown;
  if (typeof numerical === 'object' && numerical !== null) {
    try {
      outerIterations = Reflect.get(numerical, 'outerIterations');
    } catch {
      outerIterations = undefined;
    }
    try {
      innerIterations = Reflect.get(numerical, 'innerIterations');
    } catch {
      innerIterations = undefined;
    }
    try {
      convergenceTolerance = Reflect.get(numerical, 'convergenceTolerance');
    } catch {
      convergenceTolerance = undefined;
    }
  }

  const inherited = Object.freeze({
    snapshotId,
    snapshotChecksum,
    assetIn,
    assetOut,
    amountIn,
    maxHops,
    maxRoutes,
    greedyParts,
  }) as ExactInputSplitRuntimeRequest;
  const inheritedFailure = validateInheritedRequest(context, inherited);
  if (inheritedFailure !== undefined) return inheritedFailure;
  if (typeof numerical !== 'object' || numerical === null) {
    return invalidRequest({
      code: 'invalid-numerical-configuration',
      field: 'numerical',
    });
  }
  const configuration = capturePathShadowPriceConfiguration(
    Object.freeze({ outerIterations, innerIterations, convergenceTolerance }),
  );
  if (!configuration.ok) return invalidRequest(configuration.error);
  return Object.freeze({ ...inherited, numerical: configuration.value });
}

function validateInheritedRequest(
  context: PreparedRoutingContext,
  request: ExactInputSplitRuntimeRequest,
): InvalidRequest | undefined {
  if (
    !isPreparedRoutingContext(context) ||
    typeof request.snapshotId !== 'string' ||
    typeof request.snapshotChecksum !== 'string' ||
    !preparedRoutingContextMatchesIdentity(
      context,
      request.snapshotId,
      request.snapshotChecksum,
    )
  ) {
    return invalidRequest({ code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' });
  }
  if (typeof request.assetIn !== 'string' || request.assetIn.length === 0) {
    return invalidRequest({ code: 'empty-identifier', field: 'assetIn' });
  }
  if (typeof request.assetOut !== 'string' || request.assetOut.length === 0) {
    return invalidRequest({ code: 'empty-identifier', field: 'assetOut' });
  }
  if (typeof request.amountIn !== 'bigint' || request.amountIn <= 0n) {
    return invalidRequest({ code: 'nonpositive-input', field: 'amountIn' });
  }
  if (request.assetIn === request.assetOut) {
    return invalidRequest({ code: 'same-asset-request', field: 'assetOut' });
  }
  if (!Number.isSafeInteger(request.maxHops) || request.maxHops <= 0) {
    return invalidRequest({ code: 'invalid-max-hops', field: 'maxHops' });
  }
  if (!Number.isSafeInteger(request.maxRoutes) || request.maxRoutes <= 0) {
    return invalidRequest({ code: 'invalid-max-routes', field: 'maxRoutes' });
  }
  if (!Number.isSafeInteger(request.greedyParts) || request.greedyParts <= 0) {
    return invalidRequest({ code: 'invalid-greedy-parts', field: 'greedyParts' });
  }
  if (!preparedRoutingContextHasAsset(context, request.assetIn)) {
    return invalidRequest({ code: 'unknown-asset', field: 'assetIn' });
  }
  if (!preparedRoutingContextHasAsset(context, request.assetOut)) {
    return invalidRequest({ code: 'unknown-asset', field: 'assetOut' });
  }
  return undefined;
}

export function captureControl(
  source: NumericalExactInputSplitRuntimeControl,
): CapturedControl | InvalidControl {
  let workCaps: unknown;
  try {
    workCaps = source.workCaps;
  } catch {
    return invalidControl({ code: 'invalid-work-caps', field: 'workCaps' });
  }
  if (
    (typeof workCaps !== 'object' && typeof workCaps !== 'function') ||
    workCaps === null
  ) {
    return invalidControl({ code: 'invalid-work-caps', field: 'workCaps' });
  }
  const values: Partial<Record<keyof NumericalExactInputSplitWorkCaps, number>> = {};
  for (const field of [...BASE_CAP_FIELDS, ...NUMERICAL_CAP_FIELDS]) {
    let value: unknown;
    try {
      value = Reflect.get(workCaps, field);
    } catch {
      return invalidControl({ code: 'invalid-work-cap', field: `workCaps.${field}` });
    }
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      return invalidControl({ code: 'invalid-work-cap', field: `workCaps.${field}` });
    }
    values[field] = value as number;
  }
  let shouldInterrupt: unknown;
  try {
    shouldInterrupt = source.shouldInterrupt;
  } catch {
    return invalidControl({
      code: 'invalid-interruption-callback',
      field: 'shouldInterrupt',
    });
  }
  if (shouldInterrupt !== undefined && typeof shouldInterrupt !== 'function') {
    return invalidControl({
      code: 'invalid-interruption-callback',
      field: 'shouldInterrupt',
    });
  }
  let deadline: unknown;
  try {
    deadline = source.deadline;
  } catch {
    return invalidControl({ code: 'invalid-deadline-control', field: 'deadline' });
  }
  let deadlineNanoseconds: unknown;
  let nowNanoseconds: unknown;
  if (deadline !== undefined) {
    if (
      (typeof deadline !== 'object' && typeof deadline !== 'function') ||
      deadline === null
    ) {
      return invalidControl({ code: 'invalid-deadline-control', field: 'deadline' });
    }
    try {
      deadlineNanoseconds = Reflect.get(deadline, 'deadlineNanoseconds');
    } catch {
      return invalidControl({
        code: 'invalid-deadline-nanoseconds',
        field: 'deadline.deadlineNanoseconds',
      });
    }
    if (typeof deadlineNanoseconds !== 'bigint' || deadlineNanoseconds < 0n) {
      return invalidControl({
        code: 'invalid-deadline-nanoseconds',
        field: 'deadline.deadlineNanoseconds',
      });
    }
    try {
      nowNanoseconds = Reflect.get(deadline, 'nowNanoseconds');
    } catch {
      return invalidControl({
        code: 'invalid-deadline-clock',
        field: 'deadline.nowNanoseconds',
      });
    }
    if (typeof nowNanoseconds !== 'function') {
      return invalidControl({
        code: 'invalid-deadline-clock',
        field: 'deadline.nowNanoseconds',
      });
    }
  }
  return Object.freeze({
    caps: Object.freeze(values) as NumericalExactInputSplitWorkCaps,
    shouldInterrupt: shouldInterrupt as NumericalExactInputSplitRuntimeControl['shouldInterrupt'],
    deadlineNanoseconds: deadlineNanoseconds as bigint | undefined,
    nowNanoseconds: nowNanoseconds as (() => bigint) | undefined,
  });
}
