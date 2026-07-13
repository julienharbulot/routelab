import type { LiquiditySnapshot } from '../src/domain/index.ts';
import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitWorkCaps,
} from '../src/router/anytime-exact-input-split/index.ts';
import { prepareRoutingContext } from '../src/runtime/prepared-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

const provisionalSnapshot: LiquiditySnapshot = {
  snapshotId: 'pre-m6-two-direct-pools',
  snapshotChecksum: 'pending',
  pools: [
    {
      poolId: 'direct-0',
      asset0: 'A',
      reserve0: 100n,
      asset1: 'B',
      reserve1: 100n,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    },
    {
      poolId: 'direct-1',
      asset0: 'A',
      reserve0: 100n,
      asset1: 'B',
      reserve1: 100n,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    },
  ],
};
const snapshot: LiquiditySnapshot = Object.freeze({
  ...provisionalSnapshot,
  snapshotChecksum: computeCanonicalSnapshotChecksum(provisionalSnapshot),
});
const request: ExactInputSplitRuntimeRequest = Object.freeze({
  snapshotId: snapshot.snapshotId,
  snapshotChecksum: snapshot.snapshotChecksum,
  assetIn: 'A',
  assetOut: 'B',
  amountIn: 100n,
  maxHops: 1,
  maxRoutes: 2,
  greedyParts: 2,
});
const fullWorkCaps: ExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 100,
  maxBestSingleCandidateReplays: 100,
  maxCandidateSetExpansions: 100,
  maxEqualProposalReplays: 100,
  maxGreedyOptionReplays: 100,
  maxFinalAuthorizationReplays: 100,
});
const restrictedWorkCaps: ExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 0,
  maxBestSingleCandidateReplays: 0,
  maxCandidateSetExpansions: 0,
  maxEqualProposalReplays: 0,
  maxGreedyOptionReplays: 0,
  maxFinalAuthorizationReplays: 0,
});

const prepared = prepareRoutingContext(snapshot);
if (!prepared.ok) throw new Error(`fixture checksum failed: ${prepared.error.code}`);
const fullResult = routeExactInputSplitAnytime(prepared.value, request, {
  workCaps: fullWorkCaps,
});
if (fullResult.status !== 'success') {
  throw new Error(`full fixture routing failed: ${fullResult.status}`);
}
const restrictedResult = routeExactInputSplitAnytime(prepared.value, request, {
  workCaps: restrictedWorkCaps,
});
if (restrictedResult.status !== 'success') {
  throw new Error(`restricted fixture routing failed: ${restrictedResult.status}`);
}

const allocations = fullResult.plan.receipt.legs.map((leg) =>
  leg.allocation.toString(10),
);
const fallbackLeg = restrictedResult.plan.receipt.legs[0];
if (
  fullResult.plan.receipt.amountOut !== 66n ||
  allocations.length !== 2 ||
  allocations[0] !== '50' ||
  allocations[1] !== '50' ||
  restrictedResult.plan.search.termination !== 'work-limit' ||
  restrictedResult.plan.receipt.amountOut !== 50n ||
  restrictedResult.plan.receipt.legs.length !== 1 ||
  fallbackLeg?.allocation !== 100n
) {
  throw new Error('fixture routing result disagrees with the hand-audited 50/66 case');
}

const fallbackOutput = restrictedResult.plan.receipt.amountOut;
const splitOutput = fullResult.plan.receipt.amountOut;

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 'routelab.pre-m6-split-demo.v1',
    fixture: 'two zero-fee 100/100 direct pools',
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    exactInput: request.amountIn.toString(10),
    bestSingleOutput: fallbackOutput.toString(10),
    mandatoryFallbackOutput: fallbackOutput.toString(10),
    splitAllocations: allocations,
    splitOutput: splitOutput.toString(10),
    exactImprovement: (splitOutput - fallbackOutput).toString(10),
    runs: {
      full: {
        termination: fullResult.plan.search.termination,
        counters: fullResult.plan.search.counters,
        workCaps: fullWorkCaps,
      },
      restricted: {
        termination: restrictedResult.plan.search.termination,
        counters: restrictedResult.plan.search.counters,
        workCaps: restrictedWorkCaps,
      },
    },
    limitations: [
      'fixed offline fixture evidence only',
      'no performance or throughput conclusion',
      'no unrestricted global-optimality claim',
      'no live service, transaction, custody, or protocol execution',
    ],
  })}\n`,
);
