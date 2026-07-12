import { createHash } from 'node:crypto';

import type { LiquiditySnapshot } from '../../domain/index.ts';

export const CANONICAL_SNAPSHOT_SCHEMA_VERSION = 'routelab.snapshot.v1';

export interface CanonicalSnapshotChecksumMismatchError {
  readonly code: 'snapshot-checksum-mismatch';
  readonly expected: string;
  readonly actual: string;
}

export type CanonicalSnapshotChecksumVerification =
  | { readonly ok: true; readonly checksum: string }
  | {
      readonly ok: false;
      readonly error: CanonicalSnapshotChecksumMismatchError;
    };

export function serializeCanonicalSnapshotContent(snapshot: LiquiditySnapshot): string {
  const pools = [...snapshot.pools]
    .sort((left, right) => {
      if (left.poolId < right.poolId) return -1;
      if (left.poolId > right.poolId) return 1;
      return 0;
    })
    .map((pool) => ({
      poolId: pool.poolId,
      asset0: pool.asset0,
      reserve0: pool.reserve0.toString(10),
      asset1: pool.asset1,
      reserve1: pool.reserve1.toString(10),
      feeChargedNumerator: pool.feeChargedNumerator.toString(10),
      feeDenominator: pool.feeDenominator.toString(10),
    }));

  return JSON.stringify({
    schemaVersion: CANONICAL_SNAPSHOT_SCHEMA_VERSION,
    pools,
  });
}

export function computeCanonicalSnapshotChecksum(snapshot: LiquiditySnapshot): string {
  const canonicalContent = serializeCanonicalSnapshotContent(snapshot);
  const digest = createHash('sha256').update(canonicalContent, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export function verifyCanonicalSnapshotChecksum(
  snapshot: LiquiditySnapshot,
): CanonicalSnapshotChecksumVerification {
  const expected = computeCanonicalSnapshotChecksum(snapshot);
  const actual = snapshot.snapshotChecksum;

  if (actual === expected) {
    return Object.freeze({ ok: true, checksum: expected });
  }

  const error: CanonicalSnapshotChecksumMismatchError = Object.freeze({
    code: 'snapshot-checksum-mismatch',
    expected,
    actual,
  });
  return Object.freeze({ ok: false, error });
}
