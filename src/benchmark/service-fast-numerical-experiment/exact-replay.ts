import { createHash } from 'node:crypto';

import type { PreparedRoutingContext } from '../../runtime/prepared-routing-context/index.ts';
import { replayPreparedExactInputSplit } from '../../runtime/prepared-routing-context/index.ts';
import type {
  ExactInputSplitReplayLegRequest,
  ExactInputSplitReplayReceipt,
  ExactInputSplitReplayResult,
} from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import { isStrictlyBetterSplitReceipt } from '../../router/split-exact-input/objective.ts';

/** @internal */
export interface ServiceFastExperimentReplayRequestIdentity {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
}

/** @internal */
export type ServiceFastExperimentAuthorizationClassification =
  | {
      readonly outcome: 'authorization-rejected';
      readonly receipt: null;
    }
  | {
      readonly outcome: 'authorization-mismatch';
      readonly receipt: null;
    }
  | {
      readonly outcome: 'not-better';
      readonly receipt: ExactInputSplitReplayReceipt;
    }
  | {
      readonly outcome: 'improved';
      readonly receipt: ExactInputSplitReplayReceipt;
    };

function copyHop(hop: DirectionalRouteHop): DirectionalRouteHop {
  return Object.freeze({
    assetIn: hop.assetIn,
    poolId: hop.poolId,
    assetOut: hop.assetOut,
  });
}

function copyReceipt(receipt: ExactInputSplitReplayReceipt): ExactInputSplitReplayReceipt {
  return Object.freeze({
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn,
    amountOut: receipt.amountOut,
    legs: Object.freeze(receipt.legs.map((leg) => Object.freeze({
      allocation: leg.allocation,
      receipt: Object.freeze({
        snapshotId: leg.receipt.snapshotId,
        snapshotChecksum: leg.receipt.snapshotChecksum,
        assetIn: leg.receipt.assetIn,
        assetOut: leg.receipt.assetOut,
        amountIn: leg.receipt.amountIn,
        amountOut: leg.receipt.amountOut,
        hops: Object.freeze(leg.receipt.hops.map((hop) => Object.freeze({ ...hop }))),
      }),
    }))),
  });
}

function scalarEqual(left: unknown, right: unknown): boolean {
  return left === right;
}

/** @internal */
export function serviceFastExperimentReceiptsEqual(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): boolean {
  if (
    !scalarEqual(left.snapshotId, right.snapshotId) ||
    !scalarEqual(left.snapshotChecksum, right.snapshotChecksum) ||
    !scalarEqual(left.assetIn, right.assetIn) ||
    !scalarEqual(left.assetOut, right.assetOut) ||
    !scalarEqual(left.amountIn, right.amountIn) ||
    !scalarEqual(left.amountOut, right.amountOut) ||
    left.legs.length !== right.legs.length
  ) {
    return false;
  }
  for (let legIndex = 0; legIndex < left.legs.length; legIndex += 1) {
    const leftLeg = left.legs[legIndex];
    const rightLeg = right.legs[legIndex];
    if (
      leftLeg === undefined ||
      rightLeg === undefined ||
      leftLeg.allocation !== rightLeg.allocation
    ) {
      return false;
    }
    const leftReceipt = leftLeg.receipt;
    const rightReceipt = rightLeg.receipt;
    if (
      leftReceipt.snapshotId !== rightReceipt.snapshotId ||
      leftReceipt.snapshotChecksum !== rightReceipt.snapshotChecksum ||
      leftReceipt.assetIn !== rightReceipt.assetIn ||
      leftReceipt.assetOut !== rightReceipt.assetOut ||
      leftReceipt.amountIn !== rightReceipt.amountIn ||
      leftReceipt.amountOut !== rightReceipt.amountOut ||
      leftReceipt.hops.length !== rightReceipt.hops.length
    ) {
      return false;
    }
    for (let hopIndex = 0; hopIndex < leftReceipt.hops.length; hopIndex += 1) {
      const leftHop = leftReceipt.hops[hopIndex];
      const rightHop = rightReceipt.hops[hopIndex];
      if (
        leftHop === undefined ||
        rightHop === undefined ||
        leftHop.poolId !== rightHop.poolId ||
        leftHop.assetIn !== rightHop.assetIn ||
        leftHop.assetOut !== rightHop.assetOut ||
        leftHop.amountIn !== rightHop.amountIn ||
        leftHop.amountOut !== rightHop.amountOut ||
        leftHop.reserveInBefore !== rightHop.reserveInBefore ||
        leftHop.reserveOutBefore !== rightHop.reserveOutBefore ||
        leftHop.reserveInAfter !== rightHop.reserveInAfter ||
        leftHop.reserveOutAfter !== rightHop.reserveOutAfter
      ) {
        return false;
      }
    }
  }
  return true;
}

/** @internal */
export function serviceFastExperimentIsStrictlyBetter(
  candidate: ExactInputSplitReplayReceipt,
  incumbent: ExactInputSplitReplayReceipt | undefined,
): boolean {
  return incumbent === undefined || isStrictlyBetterSplitReceipt(candidate, incumbent);
}

/** @internal */
export function serviceFastExperimentCompareReceipts(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): -1 | 0 | 1 {
  if (isStrictlyBetterSplitReceipt(left, right)) return -1;
  if (isStrictlyBetterSplitReceipt(right, left)) return 1;
  return 0;
}

function allocationSum(allocations: readonly bigint[]): bigint {
  let sum = 0n;
  for (const allocation of allocations) sum += allocation;
  return sum;
}

/** @internal */
export function serviceFastExperimentReplayAllocations(
  context: PreparedRoutingContext,
  identity: ServiceFastExperimentReplayRequestIdentity,
  routes: readonly (readonly DirectionalRouteHop[])[],
  allocations: readonly bigint[],
): ExactInputSplitReplayResult {
  if (routes.length !== allocations.length || routes.length === 0) {
    throw new TypeError('Service-fast experiment replay allocation shape is invalid.');
  }
  const legs: ExactInputSplitReplayLegRequest[] = [];
  for (let index = 0; index < routes.length; index += 1) {
    const allocation = allocations[index];
    const route = routes[index];
    if (allocation === undefined || route === undefined || allocation < 0n) {
      throw new TypeError('Service-fast experiment replay allocation is invalid.');
    }
    if (allocation > 0n) {
      legs.push(Object.freeze({
        allocation,
        route: Object.freeze(route.map(copyHop)),
      }));
    }
  }
  const amountIn = allocationSum(allocations);
  if (amountIn <= 0n || legs.length === 0 || amountIn > identity.amountIn) {
    throw new TypeError('Service-fast experiment replay amount is invalid.');
  }
  return replayPreparedExactInputSplit(context, Object.freeze({
    snapshotId: identity.snapshotId,
    snapshotChecksum: identity.snapshotChecksum,
    assetIn: identity.assetIn,
    assetOut: identity.assetOut,
    amountIn,
    legs: Object.freeze(legs),
  }));
}

/** @internal */
export function classifyServiceFastExperimentAuthorization(
  score: ExactInputSplitReplayReceipt,
  liveIncumbent: ExactInputSplitReplayReceipt | undefined,
  authorization: ExactInputSplitReplayResult,
): ServiceFastExperimentAuthorizationClassification {
  if (!authorization.ok) {
    return Object.freeze({ outcome: 'authorization-rejected', receipt: null });
  }
  const receipt = copyReceipt(authorization.value);
  if (!serviceFastExperimentReceiptsEqual(receipt, score)) {
    return Object.freeze({ outcome: 'authorization-mismatch', receipt: null });
  }
  if (!serviceFastExperimentIsStrictlyBetter(receipt, liveIncumbent)) {
    return Object.freeze({ outcome: 'not-better', receipt });
  }
  return Object.freeze({ outcome: 'improved', receipt });
}

function receiptProjection(receipt: ExactInputSplitReplayReceipt): unknown {
  return {
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn.toString(10),
    amountOut: receipt.amountOut.toString(10),
    legs: receipt.legs.map((leg) => ({
      allocation: leg.allocation.toString(10),
      receipt: {
        snapshotId: leg.receipt.snapshotId,
        snapshotChecksum: leg.receipt.snapshotChecksum,
        assetIn: leg.receipt.assetIn,
        assetOut: leg.receipt.assetOut,
        amountIn: leg.receipt.amountIn.toString(10),
        amountOut: leg.receipt.amountOut.toString(10),
        hops: leg.receipt.hops.map((hop) => ({
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
    })),
  };
}

/** @internal */
export function serviceFastExperimentReceiptHash(
  receipt: ExactInputSplitReplayReceipt,
): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(receiptProjection(receipt)), 'utf8')
    .digest('hex')}`;
}

/** @internal */
export function copyServiceFastExperimentReceipt(
  receipt: ExactInputSplitReplayReceipt,
): ExactInputSplitReplayReceipt {
  return copyReceipt(receipt);
}
