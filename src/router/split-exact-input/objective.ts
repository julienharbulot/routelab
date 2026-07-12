import type { ExactInputSplitReplayLegReceipt, ExactInputSplitReplayReceipt } from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRoutes(
  left: readonly DirectionalRouteHop[],
  right: readonly DirectionalRouteHop[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    if (leftHop === undefined || rightHop === undefined) {
      throw new Error('Split route comparison reached an unavailable hop.');
    }
    const comparison =
      compareRawUtf16(leftHop.assetIn, rightHop.assetIn) ||
      compareRawUtf16(leftHop.poolId, rightHop.poolId) ||
      compareRawUtf16(leftHop.assetOut, rightHop.assetOut);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function receiptRoute(leg: ExactInputSplitReplayLegReceipt): readonly DirectionalRouteHop[] {
  return leg.receipt.hops;
}

function totalHops(receipt: ExactInputSplitReplayReceipt): number {
  return receipt.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0);
}

function compareRouteSequences(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): number {
  const sharedLength = Math.min(left.legs.length, right.legs.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftLeg = left.legs[index];
    const rightLeg = right.legs[index];
    if (leftLeg === undefined || rightLeg === undefined) {
      throw new Error('Split plan comparison reached an unavailable leg.');
    }
    const comparison = compareRoutes(receiptRoute(leftLeg), receiptRoute(rightLeg));
    if (comparison !== 0) return comparison;
  }
  return left.legs.length - right.legs.length;
}

function compareAllocations(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): number {
  for (let index = 0; index < left.legs.length; index += 1) {
    const leftAllocation = left.legs[index]?.allocation;
    const rightAllocation = right.legs[index]?.allocation;
    if (leftAllocation === undefined || rightAllocation === undefined) {
      throw new Error('Split allocation comparison reached an unavailable allocation.');
    }
    if (leftAllocation < rightAllocation) return -1;
    if (leftAllocation > rightAllocation) return 1;
  }
  return 0;
}

export function isStrictlyBetterSplitReceipt(
  candidate: ExactInputSplitReplayReceipt,
  incumbent: ExactInputSplitReplayReceipt,
): boolean {
  if (candidate.amountOut !== incumbent.amountOut) {
    return candidate.amountOut > incumbent.amountOut;
  }
  if (candidate.legs.length !== incumbent.legs.length) {
    return candidate.legs.length < incumbent.legs.length;
  }
  const candidateHops = totalHops(candidate);
  const incumbentHops = totalHops(incumbent);
  if (candidateHops !== incumbentHops) return candidateHops < incumbentHops;
  const routeComparison = compareRouteSequences(candidate, incumbent);
  if (routeComparison !== 0) return routeComparison < 0;
  return compareAllocations(candidate, incumbent) < 0;
}
