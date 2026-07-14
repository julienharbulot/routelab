import { createHash } from 'node:crypto';

import type {
  NumericalExactInputSplitDiagnostic,
  NumericalExactInputSplitRuntimeResult,
  NumericalExactInputSplitWorkCounters,
} from '../../../router/numerical-exact-input-split/index.ts';
import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';

export interface DirectionalHopInput {
  readonly assetIn: string;
  readonly poolId: string;
  readonly assetOut: string;
}

export interface ResolvedHopInput {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

export interface ExactObjectiveProjection {
  readonly hasPlan: boolean;
  readonly amountOut: string | null;
  readonly legCount: number | null;
  readonly totalHops: number | null;
  readonly routeKeys: readonly string[];
  readonly allocations: readonly string[];
}

export interface ExactIncumbentProjection {
  readonly status: 'success' | 'no-route' | 'no-plan';
  readonly reason: string | null;
  readonly receipt: object | null;
  readonly objective: ExactObjectiveProjection;
  readonly receiptHash: string | null;
}

export function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function encodeBinary64Bits(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError('Binary64 input must be finite.');
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalRouteKey(route: readonly DirectionalHopInput[]): string {
  return JSON.stringify(
    route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]),
  );
}

export function canonicalCandidateSetKey(
  routes: readonly (readonly DirectionalHopInput[])[],
): string {
  return JSON.stringify(
    routes.map((route) =>
      route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]),
    ),
  );
}

function projectRouteReceipt(
  receipt: ExactInputSplitReplayReceipt['legs'][number]['receipt'],
): object {
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

export function projectSplitReceipt(receipt: ExactInputSplitReplayReceipt): object {
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

function projectCounters(counters: NumericalExactInputSplitWorkCounters): object {
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
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections,
  };
}

function projectDiagnostic(diagnostic: NumericalExactInputSplitDiagnostic): object {
  return {
    candidateSetKey: diagnostic.candidateSetKey,
    routeKeys: diagnostic.routeKeys,
    status: diagnostic.status,
    failureCode: diagnostic.failureCode,
    converged: diagnostic.converged,
    completedOuterIterations: diagnostic.completedOuterIterations,
    configuredInnerIterations: diagnostic.configuredInnerIterations,
    residualUnits:
      diagnostic.residualUnits === null
        ? null
        : diagnostic.residualUnits.toString(10),
    counters: {
      numericalProposals: diagnostic.counters.numericalProposals,
      numericalProposalFailures: diagnostic.counters.numericalProposalFailures,
      numericalIterations: diagnostic.counters.numericalIterations,
      numericalResidualReplays: diagnostic.counters.numericalResidualReplays,
      numericalResidualReplayRejections:
        diagnostic.counters.numericalResidualReplayRejections,
      numericalAuthorizationReplays:
        diagnostic.counters.numericalAuthorizationReplays,
      numericalAuthorizationReplayRejections:
        diagnostic.counters.numericalAuthorizationReplayRejections,
    },
  };
}

function projectSearch(
  search: Extract<
    NumericalExactInputSplitRuntimeResult,
    { readonly status: 'success' }
  >['plan']['search'],
): object {
  return {
    counters: projectCounters(search.counters),
    termination: search.termination,
    numericalDiagnostics: search.numericalDiagnostics.map(projectDiagnostic),
  };
}

export function projectProtectedBaselineResult(
  result: NumericalExactInputSplitRuntimeResult,
): object {
  if (
    result.status === 'invalid-request' ||
    result.status === 'invalid-control' ||
    result.status === 'control-error' ||
    result.status === 'deadline-error'
  ) {
    throw new TypeError(`Protected reference returned ${result.status}.`);
  }
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

const NO_PLAN_OBJECTIVE: ExactObjectiveProjection = Object.freeze({
  hasPlan: false,
  amountOut: null,
  legCount: null,
  totalHops: null,
  routeKeys: Object.freeze([]),
  allocations: Object.freeze([]),
});

function objectiveOf(receipt: ExactInputSplitReplayReceipt): ExactObjectiveProjection {
  return Object.freeze({
    hasPlan: true,
    amountOut: receipt.amountOut.toString(10),
    legCount: receipt.legs.length,
    totalHops: receipt.legs.reduce(
      (total, leg) => total + leg.receipt.hops.length,
      0,
    ),
    routeKeys: Object.freeze(
      receipt.legs.map((leg) => canonicalRouteKey(leg.receipt.hops)),
    ),
    allocations: Object.freeze(
      receipt.legs.map((leg) => leg.allocation.toString(10)),
    ),
  });
}

export function projectExactIncumbent(
  result: Exclude<
    NumericalExactInputSplitRuntimeResult,
    | { readonly status: 'invalid-request' }
    | { readonly status: 'invalid-control' }
    | { readonly status: 'control-error' }
    | { readonly status: 'deadline-error' }
  >,
): ExactIncumbentProjection {
  if (result.status === 'success') {
    const receipt = projectSplitReceipt(result.plan.receipt);
    return Object.freeze({
      status: 'success',
      reason: null,
      receipt,
      objective: objectiveOf(result.plan.receipt),
      receiptHash: sha256(JSON.stringify(receipt)),
    });
  }
  return Object.freeze({
    status: result.status,
    reason: result.reason,
    receipt: null,
    objective: NO_PLAN_OBJECTIVE,
    receiptHash: null,
  });
}

function validateJsonValue(value: unknown, field: string): void {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new TypeError(`${field} contains a non-JSON value.`);
  }
  if (typeof value === 'bigint') {
    throw new TypeError(`${field} contains an unencoded bigint.`);
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError(`${field} contains a non-safe structural number.`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateJsonValue(value[index], `${field}[${index}]`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateJsonValue(child, `${field}.${key}`);
  }
}

export function encodeCanonicalNdjsonRecord(record: unknown): Uint8Array {
  validateJsonValue(record, 'record');
  return new TextEncoder().encode(`${JSON.stringify(record)}\n`);
}
