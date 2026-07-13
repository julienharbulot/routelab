import { createHash } from 'node:crypto';

import {
  parseLiquiditySnapshot,
  type ConstantProductPool,
  type LiquiditySnapshot,
  type SnapshotValidationError,
} from '../../domain/index.ts';
import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeControlValidationError,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitRuntimeResult,
  type ExactInputSplitRuntimeSearchSummary,
  type ExactInputSplitRuntimeValidationError,
  type ExactInputSplitWorkCaps,
  type ExactInputSplitWorkCounters,
} from '../../router/anytime-exact-input-split/index.ts';
import type { ExactInputRouteReplayReceipt } from '../../replay/exact-input-route/index.ts';
import { prepareRoutingContext } from '../../runtime/prepared-routing-context/index.ts';
import {
  CANONICAL_SNAPSHOT_SCHEMA_VERSION,
  serializeCanonicalSnapshotContent,
  type CanonicalSnapshotChecksumMismatchError,
} from '../canonical-snapshot/index.ts';

export const CANONICAL_SPLIT_ROUTER_RUN_SCHEMA_VERSION =
  'routelab.split-router-run.v1';

type CanonicalRuntimeResult = Extract<
  ExactInputSplitRuntimeResult,
  { readonly status: 'success' | 'no-route' | 'no-plan' }
>;

export interface CanonicalSplitRouterRun {
  readonly routerResult: CanonicalRuntimeResult;
  readonly canonicalJson: string;
  readonly determinismHash: string;
}

export interface InvalidCanonicalSplitRouterRequestError {
  readonly code: 'invalid-split-router-request';
  readonly routerError: ExactInputSplitRuntimeValidationError;
}

export interface InvalidCanonicalSplitRouterControlError {
  readonly code: 'invalid-split-router-control';
  readonly controlError: ExactInputSplitRuntimeControlValidationError;
}

export interface NoncanonicalSplitRouterResultError {
  readonly code: 'noncanonical-split-router-result';
  readonly status: ExactInputSplitRuntimeResult['status'];
  readonly termination: string | null;
}

export type CanonicalSplitRouterRunCreateError =
  | CanonicalSnapshotChecksumMismatchError
  | InvalidCanonicalSplitRouterRequestError
  | InvalidCanonicalSplitRouterControlError
  | NoncanonicalSplitRouterResultError;

export type CanonicalSplitRouterRunCreateResult =
  | { readonly ok: true; readonly value: CanonicalSplitRouterRun }
  | { readonly ok: false; readonly error: CanonicalSplitRouterRunCreateError };

export interface InvalidCanonicalSplitRunJsonError {
  readonly code: 'invalid-canonical-split-run-json';
}

export interface InvalidCanonicalSplitRunShapeError {
  readonly code: 'invalid-canonical-split-run-shape';
  readonly path: string;
}

export interface UnsupportedCanonicalSplitRunVersionError {
  readonly code: 'unsupported-canonical-split-run-version';
  readonly actual: string;
}

export interface UnsupportedCanonicalSplitSnapshotVersionError {
  readonly code: 'unsupported-canonical-split-snapshot-version';
  readonly actual: string;
}

export interface InvalidCanonicalSplitRunSnapshotError {
  readonly code: 'invalid-canonical-split-run-snapshot';
  readonly errors: readonly SnapshotValidationError[];
}

export interface InvalidCanonicalSplitRunRequestShapeError {
  readonly code: 'invalid-canonical-split-run-request-shape';
  readonly path: string;
}

export interface InvalidCanonicalSplitRunControlShapeError {
  readonly code: 'invalid-canonical-split-run-control-shape';
  readonly path: string;
}

export interface CanonicalSplitRunReplayMismatchError {
  readonly code: 'canonical-split-run-replay-mismatch';
}

export interface CanonicalSplitRunHashMismatchError {
  readonly code: 'canonical-split-run-hash-mismatch';
  readonly expected: string;
  readonly actual: string;
}

export type CanonicalSplitRouterRunParseError =
  | InvalidCanonicalSplitRunJsonError
  | InvalidCanonicalSplitRunShapeError
  | UnsupportedCanonicalSplitRunVersionError
  | UnsupportedCanonicalSplitSnapshotVersionError
  | InvalidCanonicalSplitRunSnapshotError
  | CanonicalSnapshotChecksumMismatchError
  | InvalidCanonicalSplitRunRequestShapeError
  | InvalidCanonicalSplitRunControlShapeError
  | CanonicalSplitRouterRunCreateError
  | CanonicalSplitRunReplayMismatchError
  | CanonicalSplitRunHashMismatchError;

export type CanonicalSplitRouterRunParseResult =
  | { readonly ok: true; readonly value: CanonicalSplitRouterRun }
  | { readonly ok: false; readonly error: CanonicalSplitRouterRunParseError };

type InputObject = Record<string, unknown>;

const ROOT_FIELDS = ['schemaVersion', 'snapshot', 'request', 'control', 'result'] as const;
const SNAPSHOT_FIELDS = ['snapshotId', 'snapshotChecksum', 'content'] as const;
const SNAPSHOT_CONTENT_FIELDS = ['schemaVersion', 'pools'] as const;
const REQUEST_FIELDS = [
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'maxHops',
  'maxRoutes',
  'greedyParts',
] as const;
const CAP_FIELDS = [
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
] as const;
const COUNTER_FIELDS = [
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
const SPLIT_RECEIPT_FIELDS = [
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'amountOut',
  'legs',
] as const;
const LEG_FIELDS = ['allocation', 'receipt'] as const;
const ROUTE_RECEIPT_FIELDS = [
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'amountOut',
  'hops',
] as const;
const HOP_RECEIPT_FIELDS = [
  'poolId',
  'assetIn',
  'assetOut',
  'amountIn',
  'amountOut',
  'reserveInBefore',
  'reserveOutBefore',
  'reserveInAfter',
  'reserveOutAfter',
] as const;
const SEARCH_FIELDS = ['counters', 'termination'] as const;
const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;

function isInputObject(value: unknown): value is InputObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactFieldError(
  value: InputObject,
  path: string,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) return `${path}.${field}`;
  }
  const expected = new Set(fields);
  const extra = Object.keys(value)
    .filter((field) => !expected.has(field))
    .sort()[0];
  return extra === undefined ? undefined : `${path}.${extra}`;
}

function failure(error: CanonicalSplitRouterRunParseError) {
  return Object.freeze({ ok: false as const, error });
}

function createFailure(error: CanonicalSplitRouterRunCreateError) {
  return Object.freeze({ ok: false as const, error });
}

function shapeFailure(path: string) {
  return failure(
    Object.freeze({ code: 'invalid-canonical-split-run-shape' as const, path }),
  );
}

function requestShapeFailure(path: string) {
  return failure(
    Object.freeze({
      code: 'invalid-canonical-split-run-request-shape' as const,
      path,
    }),
  );
}

function controlShapeFailure(path: string) {
  return failure(
    Object.freeze({
      code: 'invalid-canonical-split-run-control-shape' as const,
      path,
    }),
  );
}

function capturePool(pool: ConstantProductPool): ConstantProductPool {
  return Object.freeze({
    poolId: pool.poolId,
    asset0: pool.asset0,
    reserve0: pool.reserve0,
    asset1: pool.asset1,
    reserve1: pool.reserve1,
    feeChargedNumerator: pool.feeChargedNumerator,
    feeDenominator: pool.feeDenominator,
  });
}

function captureSnapshot(snapshot: LiquiditySnapshot): LiquiditySnapshot {
  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    pools: Object.freeze(Array.from(snapshot.pools, capturePool)),
  });
}

function captureRequest(
  request: ExactInputSplitRuntimeRequest,
): ExactInputSplitRuntimeRequest | InvalidCanonicalSplitRouterRequestError {
  const values: Record<string, unknown> = {};
  const fields = [
    ['snapshotId', 'snapshot-identity-mismatch', 'snapshotIdentity'],
    ['snapshotChecksum', 'snapshot-identity-mismatch', 'snapshotIdentity'],
    ['assetIn', 'empty-identifier', 'assetIn'],
    ['assetOut', 'empty-identifier', 'assetOut'],
    ['amountIn', 'nonpositive-input', 'amountIn'],
    ['maxHops', 'invalid-max-hops', 'maxHops'],
    ['maxRoutes', 'invalid-max-routes', 'maxRoutes'],
    ['greedyParts', 'invalid-greedy-parts', 'greedyParts'],
  ] as const;
  for (const [field, code, errorField] of fields) {
    try {
      values[field] = Reflect.get(request, field);
    } catch {
      return Object.freeze({
        code: 'invalid-split-router-request',
        routerError: Object.freeze({ code, field: errorField }) as ExactInputSplitRuntimeValidationError,
      });
    }
  }
  return Object.freeze(values) as unknown as ExactInputSplitRuntimeRequest;
}

function captureCaps(
  caps: ExactInputSplitWorkCaps,
): ExactInputSplitWorkCaps | InvalidCanonicalSplitRouterControlError {
  const values: Record<string, unknown> = {};
  for (const field of CAP_FIELDS) {
    try {
      values[field] = Reflect.get(caps, field);
    } catch {
      return Object.freeze({
        code: 'invalid-split-router-control',
        controlError: Object.freeze({
          code: 'invalid-work-cap',
          field: `workCaps.${field}`,
        }),
      });
    }
  }
  return Object.freeze(values) as unknown as ExactInputSplitWorkCaps;
}

function projectCounters(counters: ExactInputSplitWorkCounters): object {
  return {
    directCandidates: counters.directCandidates,
    directCandidateReplays: counters.directCandidateReplays,
    directCandidateRejections: counters.directCandidateRejections,
    pathExpansions: counters.pathExpansions,
    bestSingleCandidateReplays: counters.bestSingleCandidateReplays,
    bestSingleCandidateRejections: counters.bestSingleCandidateRejections,
    candidateSetExpansions: counters.candidateSetExpansions,
    equalProposalReplays: counters.equalProposalReplays,
    equalProposalRejections: counters.equalProposalRejections,
    greedyOptionReplays: counters.greedyOptionReplays,
    greedyOptionRejections: counters.greedyOptionRejections,
    finalAuthorizationReplays: counters.finalAuthorizationReplays,
    finalAuthorizationRejections: counters.finalAuthorizationRejections,
  };
}

function projectSearch(search: ExactInputSplitRuntimeSearchSummary): object {
  return { counters: projectCounters(search.counters), termination: search.termination };
}

function projectRouteReceipt(receipt: ExactInputRouteReplayReceipt): object {
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

function projectSplitReceipt(
  receipt: Extract<CanonicalRuntimeResult, { readonly status: 'success' }>['plan']['receipt'],
): object {
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

function projectResult(result: CanonicalRuntimeResult): object {
  if (result.status === 'success') {
    return {
      status: 'success',
      plan: {
        receipt: projectSplitReceipt(result.plan.receipt),
        search: projectSearch(result.plan.search),
      },
    };
  }
  return {
    status: result.status,
    reason: result.reason,
    search: projectSearch(result.search),
  };
}

export function createCanonicalSplitRouterRun(
  snapshot: LiquiditySnapshot,
  request: ExactInputSplitRuntimeRequest,
  workCaps: ExactInputSplitWorkCaps,
): CanonicalSplitRouterRunCreateResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const prepared = prepareRoutingContext(capturedSnapshot);
  if (!prepared.ok) return createFailure(prepared.error);

  const capturedRequest = captureRequest(request);
  if ('code' in capturedRequest) return createFailure(capturedRequest);
  const capturedCaps = captureCaps(workCaps);
  if ('code' in capturedCaps) return createFailure(capturedCaps);
  const routerResult = routeExactInputSplitAnytime(prepared.value, capturedRequest, {
    workCaps: capturedCaps,
  });
  if (routerResult.status === 'invalid-request') {
    return createFailure(
      Object.freeze({
        code: 'invalid-split-router-request',
        routerError: routerResult.error,
      }),
    );
  }
  if (routerResult.status === 'invalid-control') {
    return createFailure(
      Object.freeze({
        code: 'invalid-split-router-control',
        controlError: routerResult.error,
      }),
    );
  }

  const termination =
    routerResult.status === 'success'
      ? routerResult.plan.search.termination
      : 'search' in routerResult
        ? routerResult.search.termination
        : null;
  if (
    (routerResult.status !== 'success' &&
      routerResult.status !== 'no-route' &&
      routerResult.status !== 'no-plan') ||
    (termination !== 'complete' && termination !== 'work-limit')
  ) {
    return createFailure(
      Object.freeze({
        code: 'noncanonical-split-router-result',
        status: routerResult.status,
        termination,
      }),
    );
  }

  const canonicalResult: CanonicalRuntimeResult = routerResult;
  const canonicalSnapshotContent: unknown = JSON.parse(
    serializeCanonicalSnapshotContent(capturedSnapshot),
  );
  const canonicalJson = JSON.stringify({
    schemaVersion: CANONICAL_SPLIT_ROUTER_RUN_SCHEMA_VERSION,
    snapshot: {
      snapshotId: capturedSnapshot.snapshotId,
      snapshotChecksum: capturedSnapshot.snapshotChecksum,
      content: canonicalSnapshotContent,
    },
    request: {
      snapshotId: capturedRequest.snapshotId,
      snapshotChecksum: capturedRequest.snapshotChecksum,
      assetIn: capturedRequest.assetIn,
      assetOut: capturedRequest.assetOut,
      amountIn: capturedRequest.amountIn.toString(10),
      maxHops: capturedRequest.maxHops,
      maxRoutes: capturedRequest.maxRoutes,
      greedyParts: capturedRequest.greedyParts,
    },
    control: {
      maxPathExpansions: capturedCaps.maxPathExpansions,
      maxBestSingleCandidateReplays: capturedCaps.maxBestSingleCandidateReplays,
      maxCandidateSetExpansions: capturedCaps.maxCandidateSetExpansions,
      maxEqualProposalReplays: capturedCaps.maxEqualProposalReplays,
      maxGreedyOptionReplays: capturedCaps.maxGreedyOptionReplays,
      maxFinalAuthorizationReplays: capturedCaps.maxFinalAuthorizationReplays,
    },
    result: projectResult(canonicalResult),
  });
  const digest = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  const value: CanonicalSplitRouterRun = Object.freeze({
    routerResult: canonicalResult,
    canonicalJson,
    determinismHash: `sha256:${digest}`,
  });
  return Object.freeze({ ok: true, value });
}

function resultShapeError(value: unknown, path: string): string | undefined {
  if (!isInputObject(value)) return path;
  const status = value['status'];
  if (typeof status !== 'string') return `${path}.status`;
  if (status === 'success') {
    const fields = exactFieldError(value, path, ['status', 'plan']);
    if (fields !== undefined) return fields;
    const plan = value['plan'];
    if (!isInputObject(plan)) return `${path}.plan`;
    const planFields = exactFieldError(plan, `${path}.plan`, ['receipt', 'search']);
    if (planFields !== undefined) return planFields;
    const receiptError = splitReceiptShapeError(plan['receipt'], `${path}.plan.receipt`);
    if (receiptError !== undefined) return receiptError;
    return searchShapeError(plan['search'], `${path}.plan.search`);
  }
  if (status === 'no-route' || status === 'no-plan') {
    const fields = exactFieldError(value, path, ['status', 'reason', 'search']);
    if (fields !== undefined) return fields;
    if (typeof value['reason'] !== 'string') return `${path}.reason`;
    return searchShapeError(value['search'], `${path}.search`);
  }
  return `${path}.status`;
}

function splitReceiptShapeError(value: unknown, path: string): string | undefined {
  if (!isInputObject(value)) return path;
  const fields = exactFieldError(value, path, SPLIT_RECEIPT_FIELDS);
  if (fields !== undefined) return fields;
  for (const field of ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut']) {
    if (typeof value[field] !== 'string') return `${path}.${field}`;
  }
  for (const field of ['amountIn', 'amountOut']) {
    if (typeof value[field] !== 'string' || !CANONICAL_UNSIGNED_DECIMAL.test(value[field])) {
      return `${path}.${field}`;
    }
  }
  const legs = value['legs'];
  if (!Array.isArray(legs)) return `${path}.legs`;
  for (const [index, leg] of legs.entries()) {
    const legPath = `${path}.legs[${index}]`;
    if (!isInputObject(leg)) return legPath;
    const legFields = exactFieldError(leg, legPath, LEG_FIELDS);
    if (legFields !== undefined) return legFields;
    if (typeof leg['allocation'] !== 'string' || !CANONICAL_UNSIGNED_DECIMAL.test(leg['allocation'])) {
      return `${legPath}.allocation`;
    }
    const receiptError = routeReceiptShapeError(leg['receipt'], `${legPath}.receipt`);
    if (receiptError !== undefined) return receiptError;
  }
  return undefined;
}

function routeReceiptShapeError(value: unknown, path: string): string | undefined {
  if (!isInputObject(value)) return path;
  const fields = exactFieldError(value, path, ROUTE_RECEIPT_FIELDS);
  if (fields !== undefined) return fields;
  for (const field of ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut']) {
    if (typeof value[field] !== 'string') return `${path}.${field}`;
  }
  for (const field of ['amountIn', 'amountOut']) {
    if (typeof value[field] !== 'string' || !CANONICAL_UNSIGNED_DECIMAL.test(value[field])) {
      return `${path}.${field}`;
    }
  }
  const hops = value['hops'];
  if (!Array.isArray(hops)) return `${path}.hops`;
  for (const [index, hop] of hops.entries()) {
    const hopPath = `${path}.hops[${index}]`;
    if (!isInputObject(hop)) return hopPath;
    const hopFields = exactFieldError(hop, hopPath, HOP_RECEIPT_FIELDS);
    if (hopFields !== undefined) return hopFields;
    for (const field of ['poolId', 'assetIn', 'assetOut']) {
      if (typeof hop[field] !== 'string') return `${hopPath}.${field}`;
    }
    for (const field of [
      'amountIn',
      'amountOut',
      'reserveInBefore',
      'reserveOutBefore',
      'reserveInAfter',
      'reserveOutAfter',
    ]) {
      if (typeof hop[field] !== 'string' || !CANONICAL_UNSIGNED_DECIMAL.test(hop[field])) {
        return `${hopPath}.${field}`;
      }
    }
  }
  return undefined;
}

function searchShapeError(value: unknown, path: string): string | undefined {
  if (!isInputObject(value)) return path;
  const fields = exactFieldError(value, path, SEARCH_FIELDS);
  if (fields !== undefined) return fields;
  const counters = value['counters'];
  if (!isInputObject(counters)) return `${path}.counters`;
  const counterFields = exactFieldError(counters, `${path}.counters`, COUNTER_FIELDS);
  if (counterFields !== undefined) return counterFields;
  for (const field of COUNTER_FIELDS) {
    if (!Number.isSafeInteger(counters[field]) || (counters[field] as number) < 0) {
      return `${path}.counters.${field}`;
    }
  }
  if (typeof value['termination'] !== 'string') return `${path}.termination`;
  return undefined;
}

export function parseAndVerifyCanonicalSplitRouterRun(
  canonicalJson: string,
  determinismHash: string,
): CanonicalSplitRouterRunParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson) as unknown;
  } catch {
    return failure(Object.freeze({ code: 'invalid-canonical-split-run-json' }));
  }

  if (!isInputObject(parsed)) return shapeFailure('$');
  const rootError = exactFieldError(parsed, '$', ROOT_FIELDS);
  if (rootError !== undefined) return shapeFailure(rootError);
  if (typeof parsed['schemaVersion'] !== 'string') return shapeFailure('$.schemaVersion');

  const snapshotInput = parsed['snapshot'];
  if (!isInputObject(snapshotInput)) return shapeFailure('$.snapshot');
  const snapshotError = exactFieldError(snapshotInput, '$.snapshot', SNAPSHOT_FIELDS);
  if (snapshotError !== undefined) return shapeFailure(snapshotError);
  if (typeof snapshotInput['snapshotId'] !== 'string') return shapeFailure('$.snapshot.snapshotId');
  if (typeof snapshotInput['snapshotChecksum'] !== 'string') return shapeFailure('$.snapshot.snapshotChecksum');
  const content = snapshotInput['content'];
  if (!isInputObject(content)) return shapeFailure('$.snapshot.content');
  const contentError = exactFieldError(content, '$.snapshot.content', SNAPSHOT_CONTENT_FIELDS);
  if (contentError !== undefined) return shapeFailure(contentError);
  if (typeof content['schemaVersion'] !== 'string') return shapeFailure('$.snapshot.content.schemaVersion');
  if (!Array.isArray(content['pools'])) return shapeFailure('$.snapshot.content.pools');

  const requestInput = parsed['request'];
  if (!isInputObject(requestInput)) return shapeFailure('$.request');
  const requestError = exactFieldError(requestInput, '$.request', REQUEST_FIELDS);
  if (requestError !== undefined) return shapeFailure(requestError);

  const controlInput = parsed['control'];
  if (!isInputObject(controlInput)) return shapeFailure('$.control');
  const controlError = exactFieldError(controlInput, '$.control', CAP_FIELDS);
  if (controlError !== undefined) return shapeFailure(controlError);

  const resultError = resultShapeError(parsed['result'], '$.result');
  if (resultError !== undefined) return shapeFailure(resultError);
  if (typeof determinismHash !== 'string') return shapeFailure('$.determinismHash');

  const schemaVersion = parsed['schemaVersion'];
  if (schemaVersion !== CANONICAL_SPLIT_ROUTER_RUN_SCHEMA_VERSION) {
    return failure(
      Object.freeze({
        code: 'unsupported-canonical-split-run-version',
        actual: schemaVersion,
      }),
    );
  }
  const snapshotSchemaVersion = content['schemaVersion'];
  if (snapshotSchemaVersion !== CANONICAL_SNAPSHOT_SCHEMA_VERSION) {
    return failure(
      Object.freeze({
        code: 'unsupported-canonical-split-snapshot-version',
        actual: snapshotSchemaVersion,
      }),
    );
  }

  const snapshotResult = parseLiquiditySnapshot({
    snapshotId: snapshotInput['snapshotId'],
    snapshotChecksum: snapshotInput['snapshotChecksum'],
    pools: content['pools'],
  });
  if (!snapshotResult.ok) {
    return failure(
      Object.freeze({
        code: 'invalid-canonical-split-run-snapshot',
        errors: snapshotResult.errors,
      }),
    );
  }

  for (const field of ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut']) {
    if (typeof requestInput[field] !== 'string') return requestShapeFailure(`$.request.${field}`);
  }
  const amountIn = requestInput['amountIn'];
  if (typeof amountIn !== 'string' || !CANONICAL_POSITIVE_DECIMAL.test(amountIn)) {
    return requestShapeFailure('$.request.amountIn');
  }
  for (const field of ['maxHops', 'maxRoutes', 'greedyParts']) {
    if (!Number.isSafeInteger(requestInput[field]) || (requestInput[field] as number) <= 0) {
      return requestShapeFailure(`$.request.${field}`);
    }
  }
  for (const field of CAP_FIELDS) {
    if (!Number.isSafeInteger(controlInput[field]) || (controlInput[field] as number) < 0) {
      return controlShapeFailure(`$.control.${field}`);
    }
  }

  const request: ExactInputSplitRuntimeRequest = Object.freeze({
    snapshotId: requestInput['snapshotId'] as string,
    snapshotChecksum: requestInput['snapshotChecksum'] as string,
    assetIn: requestInput['assetIn'] as string,
    assetOut: requestInput['assetOut'] as string,
    amountIn: BigInt(amountIn),
    maxHops: requestInput['maxHops'] as number,
    maxRoutes: requestInput['maxRoutes'] as number,
    greedyParts: requestInput['greedyParts'] as number,
  });
  const caps = Object.freeze(
    Object.fromEntries(CAP_FIELDS.map((field) => [field, controlInput[field]])),
  ) as unknown as ExactInputSplitWorkCaps;

  const replay = createCanonicalSplitRouterRun(snapshotResult.value, request, caps);
  if (!replay.ok) return failure(replay.error);
  if (replay.value.canonicalJson !== canonicalJson) {
    return failure(Object.freeze({ code: 'canonical-split-run-replay-mismatch' }));
  }
  if (replay.value.determinismHash !== determinismHash) {
    return failure(
      Object.freeze({
        code: 'canonical-split-run-hash-mismatch',
        expected: replay.value.determinismHash,
        actual: determinismHash,
      }),
    );
  }
  return Object.freeze({ ok: true, value: replay.value });
}
