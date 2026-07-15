import { createHash } from 'node:crypto';

interface PlanFingerprintInput {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly routes: readonly {
    readonly allocation: bigint;
    readonly amountOut: bigint;
    readonly hops: readonly {
      readonly poolId: string;
      readonly assetIn: string;
      readonly assetOut: string;
      readonly amountIn: bigint;
      readonly amountOut: bigint;
    }[];
  }[];
}

export function computePlanFingerprint(value: PlanFingerprintInput): string {
  const plan = {
    schemaVersion: 'routelab.plan.v1',
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: value.assetIn,
    assetOut: value.assetOut,
    amountIn: value.amountIn.toString(10),
    amountOut: value.amountOut.toString(10),
    routes: value.routes.map((route) => ({
      allocation: route.allocation.toString(10),
      amountOut: route.amountOut.toString(10),
      hops: route.hops.map((hop) => ({
        poolId: hop.poolId,
        assetIn: hop.assetIn,
        assetOut: hop.assetOut,
        amountIn: hop.amountIn.toString(10),
        amountOut: hop.amountOut.toString(10),
      })),
    })),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(plan), 'utf8').digest('hex')}`;
}
