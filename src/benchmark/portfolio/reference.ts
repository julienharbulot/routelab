import { createHash } from 'node:crypto';

import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitWorkCounters,
} from '../../router/numerical-exact-input-split/index.ts';
import { replayPreparedExactInputSplit } from '../../runtime/prepared-routing-context/index.ts';
import { REFERENCE_PROFILE } from './config.ts';
import type {
  ExactBenchmarkOutcome,
  ExactBenchmarkQuote,
  PortfolioCase,
} from './types.ts';

function fingerprint(
  input: PortfolioCase,
  value: Omit<ExactBenchmarkQuote, 'semanticFingerprint'>,
): string {
  const semantic = {
    schemaVersion: 'routelab.benchmark-reference-semantic.v1',
    caseId: input.caseId,
    snapshotId: input.snapshot.snapshotId,
    snapshotChecksum: input.snapshot.snapshotChecksum,
    assetIn: input.request.assetIn,
    assetOut: input.request.assetOut,
    amountIn: input.request.amountIn.toString(10),
    amountOut: value.amountOut.toString(10),
    routes: value.routes.map((route) => ({
      allocation: route.allocation.toString(10),
      amountOut: route.amountOut.toString(10),
      hops: route.hops,
    })),
    strategy: 'numerical-reference',
    profile: REFERENCE_PROFILE,
    termination: value.termination,
    work: value.work,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(semantic), 'utf8').digest('hex')}`;
}

function counter(counters: NumericalExactInputSplitWorkCounters, field: string): number {
  const value = (counters as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : 0;
}

export function runReference(input: PortfolioCase): ExactBenchmarkOutcome {
  const result = routeExactInputSplitNumericalAnytime(input.prepared, {
    snapshotId: input.snapshot.snapshotId,
    snapshotChecksum: input.snapshot.snapshotChecksum,
    assetIn: input.request.assetIn,
    assetOut: input.request.assetOut,
    amountIn: input.request.amountIn,
    maxHops: input.request.maxHops ?? 3,
    maxRoutes: input.request.maxRoutes ?? 3,
    greedyParts: REFERENCE_PROFILE.greedyParts,
    numerical: REFERENCE_PROFILE.numerical,
  }, { workCaps: REFERENCE_PROFILE.workCaps });
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
    throw new Error(`Fresh reference replay rejected ${input.caseId}.`);
  }
  const counters = result.plan.search.counters;
  const diagnostics = result.plan.search.numericalDiagnostics;
  const semantic = Object.freeze({
    amountOut: authorization.value.amountOut,
    routes: Object.freeze(authorization.value.legs.map((leg) => Object.freeze({
      allocation: leg.allocation,
      amountOut: leg.receipt.amountOut,
      hops: Object.freeze(leg.receipt.hops.map(({ poolId, assetIn, assetOut }) => Object.freeze({
        poolId,
        assetIn,
        assetOut,
      }))),
    }))),
    termination: result.plan.search.termination,
    work: Object.freeze({ ...counters }),
    numericalProposals: counters.numericalProposals,
    numericalIterations: counters.numericalIterations,
    numericalConverged: diagnostics.length > 0 && diagnostics.every(({ converged }) => converged),
    authorizationRejections:
      counters.finalAuthorizationRejections +
      counter(counters, 'numericalAuthorizationReplayRejections'),
  });
  return Object.freeze({
    outcome: 'quote',
    value: Object.freeze({ ...semantic, semanticFingerprint: fingerprint(input, semantic) }),
  });
}
