import type {
  ExactInputSplitRuntimeResult,
  ExactInputSplitRuntimeSearchSummary,
  ExactInputSplitWorkCounters,
} from '../../router/anytime-exact-input-split/index.ts';
import type { ExactInputRouteReplayReceipt } from '../../replay/exact-input-route/index.ts';

export type CanonicalSplitRouterRuntimeResult = Extract<
  ExactInputSplitRuntimeResult,
  { readonly status: 'success' | 'no-route' | 'no-plan' }
>;

export function projectCanonicalSplitRouterWorkCounters(
  counters: ExactInputSplitWorkCounters,
): object {
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
  return {
    counters: projectCanonicalSplitRouterWorkCounters(search.counters),
    termination: search.termination,
  };
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
  receipt: Extract<
    CanonicalSplitRouterRuntimeResult,
    { readonly status: 'success' }
  >['plan']['receipt'],
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

export function projectCanonicalSplitRouterResult(
  result: CanonicalSplitRouterRuntimeResult,
): object {
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
