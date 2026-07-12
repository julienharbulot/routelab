import { createHash } from 'node:crypto';

import {
  parseLiquiditySnapshot,
  type ConstantProductPool,
  type LiquiditySnapshot,
  type SnapshotValidationError,
} from '../../domain/index.ts';
import {
  routeExactInputSinglePath,
  type ExactInputSinglePathRouterRequest,
  type ExactInputSinglePathRouterResult,
  type ExactInputSinglePathRouterValidationError,
  type ExactInputSinglePathSearchSummary,
} from '../../router/single-path/index.ts';
import {
  CANONICAL_SNAPSHOT_SCHEMA_VERSION,
  serializeCanonicalSnapshotContent,
  verifyCanonicalSnapshotChecksum,
  type CanonicalSnapshotChecksumMismatchError,
} from '../canonical-snapshot/index.ts';

export const CANONICAL_ROUTER_RUN_SCHEMA_VERSION = 'routelab.router-run.v1';

export interface InvalidCanonicalRouterRequestError {
  readonly code: 'invalid-router-request';
  readonly routerError: ExactInputSinglePathRouterValidationError;
}

export interface CanonicalSinglePathRouterRun {
  readonly routerResult: Exclude<ExactInputSinglePathRouterResult, { status: 'invalid-request' }>;
  readonly canonicalJson: string;
  readonly determinismHash: string;
}

export type CanonicalSinglePathRouterRunResult =
  | { readonly ok: true; readonly value: CanonicalSinglePathRouterRun }
  | {
      readonly ok: false;
      readonly error:
        | CanonicalSnapshotChecksumMismatchError
        | InvalidCanonicalRouterRequestError;
    };

export interface InvalidCanonicalRunJsonError {
  readonly code: 'invalid-canonical-run-json';
}

export interface InvalidCanonicalRunShapeError {
  readonly code: 'invalid-canonical-run-shape';
  readonly path: string;
}

export interface UnsupportedCanonicalRunVersionError {
  readonly code: 'unsupported-canonical-run-version';
  readonly actual: string;
}

export interface UnsupportedCanonicalSnapshotVersionError {
  readonly code: 'unsupported-canonical-snapshot-version';
  readonly actual: string;
}

export interface InvalidCanonicalRunSnapshotError {
  readonly code: 'invalid-canonical-run-snapshot';
  readonly errors: readonly SnapshotValidationError[];
}

export interface InvalidCanonicalRunRequestShapeError {
  readonly code: 'invalid-canonical-run-request-shape';
  readonly path: string;
}

export interface CanonicalRunReplayMismatchError {
  readonly code: 'canonical-run-replay-mismatch';
}

export interface CanonicalRunHashMismatchError {
  readonly code: 'canonical-run-hash-mismatch';
  readonly expected: string;
  readonly actual: string;
}

export type CanonicalSinglePathRouterRunParseError =
  | InvalidCanonicalRunJsonError
  | InvalidCanonicalRunShapeError
  | UnsupportedCanonicalRunVersionError
  | UnsupportedCanonicalSnapshotVersionError
  | InvalidCanonicalRunSnapshotError
  | CanonicalSnapshotChecksumMismatchError
  | InvalidCanonicalRunRequestShapeError
  | InvalidCanonicalRouterRequestError
  | CanonicalRunReplayMismatchError
  | CanonicalRunHashMismatchError;

export type CanonicalSinglePathRouterRunParseResult =
  | { readonly ok: true; readonly value: CanonicalSinglePathRouterRun }
  | { readonly ok: false; readonly error: CanonicalSinglePathRouterRunParseError };

type InputObject = Record<string, unknown>;

const ROOT_FIELDS = ['schemaVersion', 'snapshot', 'request', 'result'] as const;
const SNAPSHOT_FIELDS = ['snapshotId', 'snapshotChecksum', 'content'] as const;
const SNAPSHOT_CONTENT_FIELDS = ['schemaVersion', 'pools'] as const;
const REQUEST_FIELDS = [
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'maxHops',
  'maxExpansions',
] as const;
const CANONICAL_POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;

function isInputObject(value: unknown): value is InputObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldPath(path: string, field: string): string {
  return `${path}.${field}`;
}

function exactObjectFieldError(
  value: InputObject,
  path: string,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) return fieldPath(path, field);
  }

  const expected = new Set(fields);
  const extra = Object.keys(value)
    .filter((field) => !expected.has(field))
    .sort()[0];
  return extra === undefined ? undefined : fieldPath(path, extra);
}

function parseFailure(error: CanonicalSinglePathRouterRunParseError) {
  return Object.freeze({ ok: false as const, error });
}

function shapeFailure(path: string) {
  const error: InvalidCanonicalRunShapeError = Object.freeze({
    code: 'invalid-canonical-run-shape',
    path,
  });
  return parseFailure(error);
}

function requestShapeFailure(path: string) {
  const error: InvalidCanonicalRunRequestShapeError = Object.freeze({
    code: 'invalid-canonical-run-request-shape',
    path,
  });
  return parseFailure(error);
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
  const snapshotId = snapshot.snapshotId;
  const snapshotChecksum = snapshot.snapshotChecksum;
  const sourcePools = snapshot.pools;
  const pools = Object.freeze(Array.from(sourcePools, capturePool));

  return Object.freeze({ snapshotId, snapshotChecksum, pools });
}

function captureRequest(
  request: ExactInputSinglePathRouterRequest,
): ExactInputSinglePathRouterRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
    maxExpansions: request.maxExpansions,
  });
}

function projectSearch(search: ExactInputSinglePathSearchSummary): object {
  return {
    expansions: search.expansions,
    enumeratedCandidates: search.enumeratedCandidates,
    replayedCandidates: search.replayedCandidates,
    rejectedCandidates: search.rejectedCandidates,
    termination: search.termination,
  };
}

function projectRouterResult(
  result: Exclude<ExactInputSinglePathRouterResult, { status: 'invalid-request' }>,
): object {
  if (result.status !== 'success') {
    return {
      status: result.status,
      reason: result.reason,
      search: projectSearch(result.search),
    };
  }

  const receipt = result.plan.receipt;
  return {
    status: result.status,
    plan: {
      receipt: {
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
      },
      search: projectSearch(result.plan.search),
    },
  };
}

export function createCanonicalSinglePathRouterRun(
  snapshot: LiquiditySnapshot,
  request: ExactInputSinglePathRouterRequest,
): CanonicalSinglePathRouterRunResult {
  const capturedSnapshot = captureSnapshot(snapshot);
  const checksumVerification = verifyCanonicalSnapshotChecksum(capturedSnapshot);
  if (!checksumVerification.ok) {
    return Object.freeze({ ok: false, error: checksumVerification.error });
  }

  const capturedRequest = captureRequest(request);
  const routerResult = routeExactInputSinglePath(capturedSnapshot, capturedRequest);
  if (routerResult.status === 'invalid-request') {
    const error: InvalidCanonicalRouterRequestError = Object.freeze({
      code: 'invalid-router-request',
      routerError: routerResult.error,
    });
    return Object.freeze({ ok: false, error });
  }

  const canonicalSnapshotContent: unknown = JSON.parse(
    serializeCanonicalSnapshotContent(capturedSnapshot),
  );
  const canonicalJson = JSON.stringify({
    schemaVersion: CANONICAL_ROUTER_RUN_SCHEMA_VERSION,
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
      maxExpansions: capturedRequest.maxExpansions,
    },
    result: projectRouterResult(routerResult),
  });
  const digest = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  const value: CanonicalSinglePathRouterRun = Object.freeze({
    routerResult,
    canonicalJson,
    determinismHash: `sha256:${digest}`,
  });
  return Object.freeze({ ok: true, value });
}

export function parseAndVerifyCanonicalSinglePathRouterRun(
  canonicalJson: string,
  determinismHash: string,
): CanonicalSinglePathRouterRunParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson) as unknown;
  } catch {
    const error: InvalidCanonicalRunJsonError = Object.freeze({
      code: 'invalid-canonical-run-json',
    });
    return parseFailure(error);
  }

  if (!isInputObject(parsed)) return shapeFailure('$');
  const rootFieldError = exactObjectFieldError(parsed, '$', ROOT_FIELDS);
  if (rootFieldError !== undefined) return shapeFailure(rootFieldError);

  const schemaVersion = parsed['schemaVersion'];
  if (typeof schemaVersion !== 'string') return shapeFailure('$.schemaVersion');

  const snapshotInput = parsed['snapshot'];
  if (!isInputObject(snapshotInput)) return shapeFailure('$.snapshot');
  const snapshotFieldError = exactObjectFieldError(
    snapshotInput,
    '$.snapshot',
    SNAPSHOT_FIELDS,
  );
  if (snapshotFieldError !== undefined) return shapeFailure(snapshotFieldError);

  const snapshotId = snapshotInput['snapshotId'];
  if (typeof snapshotId !== 'string') return shapeFailure('$.snapshot.snapshotId');
  const snapshotChecksum = snapshotInput['snapshotChecksum'];
  if (typeof snapshotChecksum !== 'string') {
    return shapeFailure('$.snapshot.snapshotChecksum');
  }

  const snapshotContent = snapshotInput['content'];
  if (!isInputObject(snapshotContent)) return shapeFailure('$.snapshot.content');
  const contentFieldError = exactObjectFieldError(
    snapshotContent,
    '$.snapshot.content',
    SNAPSHOT_CONTENT_FIELDS,
  );
  if (contentFieldError !== undefined) return shapeFailure(contentFieldError);

  const snapshotSchemaVersion = snapshotContent['schemaVersion'];
  if (typeof snapshotSchemaVersion !== 'string') {
    return shapeFailure('$.snapshot.content.schemaVersion');
  }
  const pools = snapshotContent['pools'];
  if (!Array.isArray(pools)) return shapeFailure('$.snapshot.content.pools');

  const requestInput = parsed['request'];
  if (!isInputObject(requestInput)) return shapeFailure('$.request');
  const requestFieldError = exactObjectFieldError(
    requestInput,
    '$.request',
    REQUEST_FIELDS,
  );
  if (requestFieldError !== undefined) return shapeFailure(requestFieldError);

  if (typeof determinismHash !== 'string') return shapeFailure('$.determinismHash');

  if (schemaVersion !== CANONICAL_ROUTER_RUN_SCHEMA_VERSION) {
    const error: UnsupportedCanonicalRunVersionError = Object.freeze({
      code: 'unsupported-canonical-run-version',
      actual: schemaVersion,
    });
    return parseFailure(error);
  }
  if (snapshotSchemaVersion !== CANONICAL_SNAPSHOT_SCHEMA_VERSION) {
    const error: UnsupportedCanonicalSnapshotVersionError = Object.freeze({
      code: 'unsupported-canonical-snapshot-version',
      actual: snapshotSchemaVersion,
    });
    return parseFailure(error);
  }

  const snapshotResult = parseLiquiditySnapshot({
    snapshotId,
    snapshotChecksum,
    pools,
  });
  if (!snapshotResult.ok) {
    const error: InvalidCanonicalRunSnapshotError = Object.freeze({
      code: 'invalid-canonical-run-snapshot',
      errors: snapshotResult.errors,
    });
    return parseFailure(error);
  }

  const requestSnapshotId = requestInput['snapshotId'];
  if (typeof requestSnapshotId !== 'string') {
    return requestShapeFailure('$.request.snapshotId');
  }
  const requestSnapshotChecksum = requestInput['snapshotChecksum'];
  if (typeof requestSnapshotChecksum !== 'string') {
    return requestShapeFailure('$.request.snapshotChecksum');
  }
  const assetIn = requestInput['assetIn'];
  if (typeof assetIn !== 'string') return requestShapeFailure('$.request.assetIn');
  const assetOut = requestInput['assetOut'];
  if (typeof assetOut !== 'string') return requestShapeFailure('$.request.assetOut');

  const amountInString = requestInput['amountIn'];
  if (
    typeof amountInString !== 'string' ||
    !CANONICAL_POSITIVE_DECIMAL.test(amountInString)
  ) {
    return requestShapeFailure('$.request.amountIn');
  }

  const maxHops = requestInput['maxHops'];
  if (!Number.isSafeInteger(maxHops) || (maxHops as number) <= 0) {
    return requestShapeFailure('$.request.maxHops');
  }
  const maxExpansions = requestInput['maxExpansions'];
  if (!Number.isSafeInteger(maxExpansions) || (maxExpansions as number) < 0) {
    return requestShapeFailure('$.request.maxExpansions');
  }

  const request: ExactInputSinglePathRouterRequest = Object.freeze({
    snapshotId: requestSnapshotId,
    snapshotChecksum: requestSnapshotChecksum,
    assetIn,
    assetOut,
    amountIn: BigInt(amountInString),
    maxHops: maxHops as number,
    maxExpansions: maxExpansions as number,
  });
  const replay = createCanonicalSinglePathRouterRun(snapshotResult.value, request);
  if (!replay.ok) return parseFailure(replay.error);

  if (replay.value.canonicalJson !== canonicalJson) {
    const error: CanonicalRunReplayMismatchError = Object.freeze({
      code: 'canonical-run-replay-mismatch',
    });
    return parseFailure(error);
  }
  if (replay.value.determinismHash !== determinismHash) {
    const error: CanonicalRunHashMismatchError = Object.freeze({
      code: 'canonical-run-hash-mismatch',
      expected: replay.value.determinismHash,
      actual: determinismHash,
    });
    return parseFailure(error);
  }

  return Object.freeze({ ok: true, value: replay.value });
}
