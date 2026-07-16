import { computePlanFingerprint } from '../../public/plan-fingerprint.ts';
import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitWorkCounters,
} from '../../router/numerical-exact-input-split/index.ts';
import { replayPreparedExactInputSplit } from '../../runtime/prepared-routing-context/index.ts';
import { LARGE_BUDGET_PROFILE } from './config.ts';
import type {
  ExactBenchmarkOutcome,
  PortfolioCase,
} from './types.ts';

function counter(counters: NumericalExactInputSplitWorkCounters, field: string): number {
  const value = (counters as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : 0;
}

export function runLargeBudgetComparison(input: PortfolioCase): ExactBenchmarkOutcome {
  const result = routeExactInputSplitNumericalAnytime(input.prepared, {
    snapshotId: input.snapshot.snapshotId,
    snapshotChecksum: input.snapshot.snapshotChecksum,
    assetIn: input.request.assetIn,
    assetOut: input.request.assetOut,
    amountIn: input.request.amountIn,
    maxHops: input.request.maxHops ?? 3,
    maxRoutes: input.request.maxRoutes ?? 3,
    greedyParts: LARGE_BUDGET_PROFILE.greedyParts,
    numerical: LARGE_BUDGET_PROFILE.numerical,
  }, { workCaps: LARGE_BUDGET_PROFILE.workCaps });
  if (result.status === 'no-route') return Object.freeze({ outcome: 'no-route' });
  if (result.status !== 'success') {
    throw new Error(`Reference failed for ${input.caseId}: ${result.status}.`);
  }
  const receipt = result.plan.receipt;
  const authorization = replayPreparedExactInputSplit(input.prepared, {
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn,
    legs: receipt.legs.map((leg) => ({
      allocation: leg.allocation,
      route: leg.receipt.hops.map(({ poolId, assetIn, assetOut }) => ({
        poolId,
        assetIn,
        assetOut,
      })),
    })),
  });
  if (!authorization.ok) {
    throw new Error(`Fresh large-budget comparison replay rejected ${input.caseId}.`);
  }
  const counters = result.plan.search.counters;
  const diagnostics = result.plan.search.numericalDiagnostics;
  const planRoutes = Object.freeze(authorization.value.legs.map((leg) => Object.freeze({
    allocation: leg.allocation,
    amountOut: leg.receipt.amountOut,
    hops: Object.freeze(leg.receipt.hops.map((hop) => Object.freeze({
      poolId: hop.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn: hop.amountIn,
      amountOut: hop.amountOut,
    }))),
  })));
  const semantic = Object.freeze({
    amountOut: authorization.value.amountOut,
    routes: Object.freeze(planRoutes.map((route) => Object.freeze({
      allocation: route.allocation,
      amountOut: route.amountOut,
      hops: Object.freeze(route.hops.map(({ poolId, assetIn, assetOut }) => Object.freeze({
        poolId,
        assetIn,
        assetOut,
      }))),
    }))),
    termination: result.plan.search.termination,
    work: Object.freeze({ ...counters }),
    numericalProposalAttemptedCount: counters.numericalProposals,
    numericalProposalConvergedCount: diagnostics.filter(
      ({ counters: value, converged }) => value.numericalProposals > 0 && converged,
    ).length,
    numericalProposalFailedCount: counters.numericalProposals - diagnostics.filter(
      ({ counters: value, converged }) => value.numericalProposals > 0 && converged,
    ).length,
    numericalIterations: counters.numericalIterations,
    allProposalsConverged: counters.numericalProposals > 0 && diagnostics
      .filter(({ counters: value }) => value.numericalProposals > 0)
      .every(({ converged }) => converged),
    numericalImprovementSelected: diagnostics.some(({ status }) => status === 'improved'),
    authorizationRejections:
      counters.finalAuthorizationRejections +
      counter(counters, 'numericalAuthorizationReplayRejections'),
  });
  return Object.freeze({
    outcome: 'quote',
    value: Object.freeze({
      ...semantic,
      planFingerprint: computePlanFingerprint({
        snapshotId: input.snapshot.snapshotId,
        snapshotChecksum: input.snapshot.snapshotChecksum,
        assetIn: input.request.assetIn,
        assetOut: input.request.assetOut,
        amountIn: input.request.amountIn,
        amountOut: authorization.value.amountOut,
        routes: planRoutes,
      }),
    }),
  });
}
