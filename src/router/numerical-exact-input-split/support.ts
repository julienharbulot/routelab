import type {
  ExactInputSplitReplayLegRequest,
  ExactInputSplitReplayReceipt,
  ExactInputSplitReplayRequest,
} from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import type {
  ExactInputSplitRuntimeControlError,
  ExactInputSplitRuntimeDeadlineError,
  ExactInputSplitRuntimeRequest,
  ExactInputSplitRuntimeTermination,
} from '../anytime-exact-input-split/index.ts';
import { isStrictlyBetterSplitReceipt } from '../shared/objective.ts';
import type { CapturedControl } from './validation.ts';
import type {
  NumericalExactInputSplitCandidateCounters,
  NumericalExactInputSplitDiagnostic,
  NumericalExactInputSplitFailureCode,
  NumericalExactInputSplitRuntimeCheckpoint,
  NumericalExactInputSplitRuntimeResult,
  NumericalExactInputSplitRuntimeSearchSummary,
  NumericalExactInputSplitRuntimeWorkKind,
  NumericalExactInputSplitWorkCaps,
  NumericalExactInputSplitWorkCounters,
} from './types.ts';

export type MutableCounters = {
  -readonly [Key in keyof NumericalExactInputSplitWorkCounters]: number;
};
export type MutableCandidateCounters = {
  -readonly [Key in keyof NumericalExactInputSplitCandidateCounters]: number;
};

export interface SplitProposal {
  readonly key: string;
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly legs: readonly ExactInputSplitReplayLegRequest[];
}
export interface CandidateDiagnosticState {
  readonly candidateSetKey: string;
  readonly routeKeys: readonly string[];
  readonly counters: MutableCandidateCounters;
  completedOuterIterations: number;
  converged: boolean;
  residualUnits: bigint | null;
}

const KIND_CAP: Record<
  NumericalExactInputSplitRuntimeWorkKind,
  keyof NumericalExactInputSplitWorkCaps
> = {
  'path-expansion': 'maxPathExpansions',
  'best-single-candidate-replay': 'maxBestSingleCandidateReplays',
  'candidate-set-expansion': 'maxCandidateSetExpansions',
  'equal-proposal-replay': 'maxEqualProposalReplays',
  'greedy-option-replay': 'maxGreedyOptionReplays',
  'final-authorization-replay': 'maxFinalAuthorizationReplays',
  'numerical-proposal': 'maxNumericalProposals',
  'numerical-iteration': 'maxNumericalIterations',
  'numerical-residual-replay': 'maxNumericalResidualReplays',
  'numerical-authorization-replay': 'maxNumericalAuthorizationReplays',
};

const KIND_COUNTER: Record<
  NumericalExactInputSplitRuntimeWorkKind,
  keyof NumericalExactInputSplitWorkCounters
> = {
  'path-expansion': 'pathExpansions',
  'best-single-candidate-replay': 'bestSingleCandidateReplays',
  'candidate-set-expansion': 'candidateSetExpansions',
  'equal-proposal-replay': 'equalProposalReplays',
  'greedy-option-replay': 'greedyOptionReplays',
  'final-authorization-replay': 'finalAuthorizationReplays',
  'numerical-proposal': 'numericalProposals',
  'numerical-iteration': 'numericalIterations',
  'numerical-residual-replay': 'numericalResidualReplays',
  'numerical-authorization-replay': 'numericalAuthorizationReplays',
};

export function freshCounters(): MutableCounters {
  return {
    directCandidates: 0,
    directCandidateReplays: 0,
    directCandidateRejections: 0,
    pathExpansions: 0,
    bestSingleCandidateReplays: 0,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 0,
    equalProposalReplays: 0,
    equalProposalRejections: 0,
    greedyOptionReplays: 0,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 0,
    finalAuthorizationRejections: 0,
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalIterations: 0,
    numericalResidualReplays: 0,
    numericalResidualReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
  };
}

export function freshCandidateCounters(): MutableCandidateCounters {
  return {
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalIterations: 0,
    numericalResidualReplays: 0,
    numericalResidualReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
  };
}

export function frozenCounters(
  counters: MutableCounters,
): NumericalExactInputSplitWorkCounters {
  return Object.freeze({
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
  });
}

export function frozenCandidateCounters(
  counters: MutableCandidateCounters,
): NumericalExactInputSplitCandidateCounters {
  return Object.freeze({
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections,
  });
}

export function search(
  counters: MutableCounters,
  termination: ExactInputSplitRuntimeTermination,
  diagnostics: readonly NumericalExactInputSplitDiagnostic[],
): NumericalExactInputSplitRuntimeSearchSummary {
  return Object.freeze({
    counters: frozenCounters(counters),
    termination,
    numericalDiagnostics: Object.freeze([...diagnostics]),
  });
}

export function finish(
  counters: MutableCounters,
  termination: 'complete' | 'work-limit' | 'interrupted' | 'deadline',
  incumbent: ExactInputSplitReplayReceipt | undefined,
  hadCandidate: boolean,
  diagnostics: readonly NumericalExactInputSplitDiagnostic[],
): NumericalExactInputSplitRuntimeResult {
  const summary = search(counters, termination, diagnostics);
  if (incumbent !== undefined) {
    return Object.freeze({
      status: 'success',
      plan: Object.freeze({ receipt: incumbent, search: summary }),
    });
  }
  if (termination !== 'complete') {
    return Object.freeze({ status: 'no-plan', reason: termination, search: summary });
  }
  return Object.freeze({
    status: 'no-route',
    reason: hadCandidate ? 'all-candidates-rejected' : 'no-candidate',
    search: summary,
  });
}

export type Boundary =
  | { readonly outcome: 'execute' }
  | { readonly outcome: 'cap' }
  | { readonly outcome: 'interrupted' }
  | { readonly outcome: 'deadline' }
  | {
      readonly outcome: 'control-error';
      readonly error: ExactInputSplitRuntimeControlError;
    }
  | {
      readonly outcome: 'deadline-error';
      readonly error: ExactInputSplitRuntimeDeadlineError;
    };

export function boundary(
  kind: NumericalExactInputSplitRuntimeWorkKind,
  control: CapturedControl,
  counters: MutableCounters,
  incumbent: ExactInputSplitReplayReceipt | undefined,
  priorClock: { value: bigint | undefined },
): Boundary {
  if (counters[KIND_COUNTER[kind]] === control.caps[KIND_CAP[kind]]) {
    return { outcome: 'cap' };
  }
  if (control.shouldInterrupt !== undefined) {
    const checkpoint: NumericalExactInputSplitRuntimeCheckpoint = Object.freeze({
      nextWorkKind: kind,
      counters: frozenCounters(counters),
      incumbent: incumbent ?? null,
    });
    let interrupted: unknown;
    try {
      interrupted = control.shouldInterrupt(checkpoint);
    } catch {
      return {
        outcome: 'control-error',
        error: Object.freeze({ code: 'interruption-check-failed' }),
      };
    }
    if (typeof interrupted !== 'boolean') {
      return {
        outcome: 'control-error',
        error: Object.freeze({ code: 'invalid-interruption-result' }),
      };
    }
    if (interrupted) return { outcome: 'interrupted' };
  }
  if (control.nowNanoseconds !== undefined) {
    let sample: unknown;
    try {
      sample = control.nowNanoseconds();
    } catch {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-failed',
          field: 'nowNanoseconds',
        }),
      };
    }
    if (typeof sample !== 'bigint' || sample < 0n) {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-failed',
          field: 'nowNanoseconds',
        }),
      };
    }
    if (priorClock.value !== undefined && sample < priorClock.value) {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-regressed',
          field: 'nowNanoseconds',
        }),
      };
    }
    priorClock.value = sample;
    if (sample >= control.deadlineNanoseconds!) return { outcome: 'deadline' };
  }
  return { outcome: 'execute' };
}

export function operationalResult(
  stop: Exclude<Boundary, { readonly outcome: 'execute' | 'cap' }>,
  counters: MutableCounters,
  incumbent: ExactInputSplitReplayReceipt | undefined,
  hadCandidate: boolean,
  diagnostics: readonly NumericalExactInputSplitDiagnostic[],
): NumericalExactInputSplitRuntimeResult {
  if (stop.outcome === 'interrupted' || stop.outcome === 'deadline') {
    return finish(counters, stop.outcome, incumbent, hadCandidate, diagnostics);
  }
  if (stop.outcome === 'control-error') {
    return Object.freeze({
      status: 'control-error',
      error: stop.error,
      incumbent: incumbent ?? null,
      search: search(counters, 'control-error', diagnostics),
    });
  }
  return Object.freeze({
    status: 'deadline-error',
    error: stop.error,
    incumbent: incumbent ?? null,
    search: search(counters, 'deadline-error', diagnostics),
  });
}

export function partialReplayRequest(
  request: ExactInputSplitRuntimeRequest,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: legs.reduce((sum, leg) => sum + leg.allocation, 0n),
    legs: Object.freeze(legs),
  });
}

export function fullReplayRequest(
  request: ExactInputSplitRuntimeRequest,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    legs: Object.freeze(legs),
  });
}

export function positiveLegs(
  routes: readonly (readonly DirectionalRouteHop[])[],
  allocations: readonly bigint[],
): readonly ExactInputSplitReplayLegRequest[] {
  return Object.freeze(
    routes.flatMap((route, index) => {
      const allocation = allocations[index];
      return allocation === undefined || allocation === 0n
        ? []
        : [Object.freeze({ allocation, route })];
    }),
  );
}

export function* positiveChunks(amountIn: bigint, parts: number): Generator<bigint> {
  const divisor = BigInt(parts);
  const base = amountIn / divisor;
  const remainder = amountIn % divisor;
  if (base === 0n) {
    for (let index = 0n; index < remainder; index += 1n) yield 1n;
  } else {
    for (let index = 0; index < parts; index += 1) {
      yield base + (BigInt(index) < remainder ? 1n : 0n);
    }
  }
}

export function proposalKey(legs: readonly ExactInputSplitReplayLegRequest[]): string {
  return JSON.stringify(
    legs.map((leg) => ({
      allocation: leg.allocation.toString(10),
      route: leg.route.map(({ assetIn, poolId, assetOut }) => ({
        assetIn,
        poolId,
        assetOut,
      })),
    })),
  );
}

export function compareProposals(left: SplitProposal, right: SplitProposal): number {
  if (isStrictlyBetterSplitReceipt(left.receipt, right.receipt)) return -1;
  if (isStrictlyBetterSplitReceipt(right.receipt, left.receipt)) return 1;
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

export function routeKey(route: readonly DirectionalRouteHop[]): string {
  return JSON.stringify(
    route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut]),
  );
}

export function candidateSetKey(
  routes: readonly (readonly DirectionalRouteHop[])[],
): string {
  return JSON.stringify(
    routes.map((route) =>
      route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut]),
    ),
  );
}

export function createDiagnosticState(
  routes: readonly (readonly DirectionalRouteHop[])[],
): CandidateDiagnosticState {
  return {
    candidateSetKey: candidateSetKey(routes),
    routeKeys: Object.freeze(routes.map(routeKey)),
    counters: freshCandidateCounters(),
    completedOuterIterations: 0,
    converged: false,
    residualUnits: null,
  };
}

export function diagnostic(
  state: CandidateDiagnosticState,
  configuredInnerIterations: number,
  status: NumericalExactInputSplitDiagnostic['status'],
  failureCode: NumericalExactInputSplitFailureCode | null,
): NumericalExactInputSplitDiagnostic {
  return Object.freeze({
    candidateSetKey: state.candidateSetKey,
    routeKeys: Object.freeze([...state.routeKeys]),
    status,
    failureCode,
    converged: state.converged,
    completedOuterIterations: state.completedOuterIterations,
    configuredInnerIterations,
    residualUnits: state.residualUnits,
    counters: frozenCandidateCounters(state.counters),
  });
}

export function transitionReceiptEquals(
  left: ExactInputSplitReplayReceipt['legs'][number]['receipt']['hops'][number],
  right: ExactInputSplitReplayReceipt['legs'][number]['receipt']['hops'][number],
): boolean {
  return (
    left.poolId === right.poolId &&
    left.assetIn === right.assetIn &&
    left.assetOut === right.assetOut &&
    left.amountIn === right.amountIn &&
    left.amountOut === right.amountOut &&
    left.reserveInBefore === right.reserveInBefore &&
    left.reserveOutBefore === right.reserveOutBefore &&
    left.reserveInAfter === right.reserveInAfter &&
    left.reserveOutAfter === right.reserveOutAfter
  );
}

export function receiptSemanticallyEquals(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): boolean {
  if (
    left.snapshotId !== right.snapshotId ||
    left.snapshotChecksum !== right.snapshotChecksum ||
    left.assetIn !== right.assetIn ||
    left.assetOut !== right.assetOut ||
    left.amountIn !== right.amountIn ||
    left.amountOut !== right.amountOut ||
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
      leftLeg.allocation !== rightLeg.allocation ||
      leftLeg.receipt.snapshotId !== rightLeg.receipt.snapshotId ||
      leftLeg.receipt.snapshotChecksum !== rightLeg.receipt.snapshotChecksum ||
      leftLeg.receipt.assetIn !== rightLeg.receipt.assetIn ||
      leftLeg.receipt.assetOut !== rightLeg.receipt.assetOut ||
      leftLeg.receipt.amountIn !== rightLeg.receipt.amountIn ||
      leftLeg.receipt.amountOut !== rightLeg.receipt.amountOut ||
      leftLeg.receipt.hops.length !== rightLeg.receipt.hops.length
    ) {
      return false;
    }
    for (let hopIndex = 0; hopIndex < leftLeg.receipt.hops.length; hopIndex += 1) {
      const leftHop = leftLeg.receipt.hops[hopIndex];
      const rightHop = rightLeg.receipt.hops[hopIndex];
      if (
        leftHop === undefined ||
        rightHop === undefined ||
        !transitionReceiptEquals(leftHop, rightHop)
      ) {
        return false;
      }
    }
  }
  return true;
}

export function captureReplayReceipt(
  source: ExactInputSplitReplayReceipt,
): ExactInputSplitReplayReceipt | undefined {
  try {
    const legs = Object.freeze(
      Array.from(source.legs, (sourceLeg) => {
        const sourceReceipt = sourceLeg.receipt;
        const hops = Object.freeze(
          Array.from(sourceReceipt.hops, (hop) =>
            Object.freeze({
              poolId: hop.poolId,
              assetIn: hop.assetIn,
              assetOut: hop.assetOut,
              amountIn: hop.amountIn,
              amountOut: hop.amountOut,
              reserveInBefore: hop.reserveInBefore,
              reserveOutBefore: hop.reserveOutBefore,
              reserveInAfter: hop.reserveInAfter,
              reserveOutAfter: hop.reserveOutAfter,
            }),
          ),
        );
        const receipt = Object.freeze({
          snapshotId: sourceReceipt.snapshotId,
          snapshotChecksum: sourceReceipt.snapshotChecksum,
          assetIn: sourceReceipt.assetIn,
          assetOut: sourceReceipt.assetOut,
          amountIn: sourceReceipt.amountIn,
          amountOut: sourceReceipt.amountOut,
          hops,
        });
        return Object.freeze({ allocation: sourceLeg.allocation, receipt });
      }),
    );
    return Object.freeze({
      snapshotId: source.snapshotId,
      snapshotChecksum: source.snapshotChecksum,
      assetIn: source.assetIn,
      assetOut: source.assetOut,
      amountIn: source.amountIn,
      amountOut: source.amountOut,
      legs,
    });
  } catch {
    return undefined;
  }
}
