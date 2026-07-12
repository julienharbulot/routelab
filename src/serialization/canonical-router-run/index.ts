import { createHash } from 'node:crypto';

import type { ConstantProductPool, LiquiditySnapshot } from '../../domain/index.ts';
import {
  routeExactInputSinglePath,
  type ExactInputSinglePathRouterRequest,
  type ExactInputSinglePathRouterResult,
  type ExactInputSinglePathRouterValidationError,
  type ExactInputSinglePathSearchSummary,
} from '../../router/single-path/index.ts';
import {
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
