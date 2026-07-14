import type {
  ExactInputSplitReplayLegRequest,
  ExactInputSplitReplayReceipt,
  ExactInputSplitReplayRequest,
  ExactInputSplitReplayResult,
} from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import {
  createPreparedSimplePathFrontier,
  expandPreparedSimplePathFrontier,
  hasPreparedSimplePathExpansion,
  materializePreparedSimplePaths,
  preparedDirectRoutes,
  replayPreparedExactInputSplit,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  createSharedCandidateSetFrontier,
  expandSharedCandidateSetFrontier,
  hasSharedCandidateSetExpansion,
  materializeSharedCandidateSets,
} from '../../search/shared-route-discovery/index.ts';
import { isStrictlyBetterSplitReceipt } from '../split-exact-input/objective.ts';

export interface ExactInputSplitSessionRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxRoutes: number;
  readonly greedyParts: number;
}

export interface ExactInputSplitSessionWorkCaps {
  readonly maxPathExpansions: number;
  readonly maxBestSingleCandidateReplays: number;
  readonly maxCandidateSetExpansions: number;
  readonly maxEqualProposalReplays: number;
  readonly maxGreedyOptionReplays: number;
  readonly maxFinalAuthorizationReplays: number;
  readonly maxNumericalProposals: number;
  readonly maxNumericalIterations: number;
  readonly maxNumericalResidualReplays: number;
  readonly maxNumericalAuthorizationReplays: number;
}

export interface ExactInputSplitSessionWorkCounters {
  readonly directCandidates: number;
  readonly directCandidateReplays: number;
  readonly directCandidateRejections: number;
  readonly pathExpansions: number;
  readonly bestSingleCandidateReplays: number;
  readonly bestSingleCandidateRejections: number;
  readonly candidateSetExpansions: number;
  readonly equalProposalReplays: number;
  readonly equalProposalRejections: number;
  readonly greedyOptionReplays: number;
  readonly greedyOptionRejections: number;
  readonly finalAuthorizationReplays: number;
  readonly finalAuthorizationRejections: number;
  readonly numericalProposals: number;
  readonly numericalProposalFailures: number;
  readonly numericalIterations: number;
  readonly numericalResidualReplays: number;
  readonly numericalResidualReplayRejections: number;
  readonly numericalAuthorizationReplays: number;
  readonly numericalAuthorizationReplayRejections: number;
}

export type ExactInputSplitSessionWorkKind =
  | 'path-expansion'
  | 'best-single-candidate-replay'
  | 'candidate-set-expansion'
  | 'equal-proposal-replay'
  | 'greedy-option-replay'
  | 'final-authorization-replay'
  | 'numerical-proposal'
  | 'numerical-iteration'
  | 'numerical-residual-replay'
  | 'numerical-authorization-replay';

export type ExactInputSplitSessionControlError =
  | { readonly code: 'interruption-check-failed' }
  | { readonly code: 'invalid-interruption-result' };

export type ExactInputSplitSessionDeadlineError =
  | { readonly code: 'deadline-clock-failed'; readonly field: 'nowNanoseconds' }
  | { readonly code: 'deadline-clock-regressed'; readonly field: 'nowNanoseconds' };

export type ExactInputSplitSessionBoundary =
  | { readonly outcome: 'execute' }
  | { readonly outcome: 'cap' }
  | { readonly outcome: 'interrupted' }
  | { readonly outcome: 'deadline' }
  | {
      readonly outcome: 'control-error';
      readonly error: ExactInputSplitSessionControlError;
    }
  | {
      readonly outcome: 'deadline-error';
      readonly error: ExactInputSplitSessionDeadlineError;
    };

export type ExactInputSplitReferencePolicyOutcome =
  | { readonly outcome: 'complete' }
  | { readonly outcome: 'work-limit' }
  | Exclude<
      ExactInputSplitSessionBoundary,
      { readonly outcome: 'execute' | 'cap' }
    >;

export interface ExactInputSplitSessionCheckpoint {
  readonly nextWorkKind: ExactInputSplitSessionWorkKind;
  readonly counters: ExactInputSplitSessionWorkCounters;
  readonly incumbent: ExactInputSplitReplayReceipt | null;
}

export interface ExactInputSplitSessionControl {
  readonly workCaps: ExactInputSplitSessionWorkCaps;
  readonly shouldInterrupt:
    | ((checkpoint: ExactInputSplitSessionCheckpoint) => unknown)
    | undefined;
  readonly deadlineNanoseconds: bigint | undefined;
  readonly nowNanoseconds: (() => unknown) | undefined;
}

declare const exactInputSplitSessionBrand: unique symbol;

export interface ExactInputSplitSession<TDiagnostic = never> {
  readonly [exactInputSplitSessionBrand]: TDiagnostic;
}

export type ExactInputSplitSessionAuthorizationReplay = (
  context: PreparedRoutingContext,
  request: ExactInputSplitReplayRequest,
) => ExactInputSplitReplayResult;

export type ExactInputSplitSessionAuthorizationOutcome =
  | 'improved'
  | 'rejected'
  | 'mismatch';

type MutableCounters = {
  -readonly [Key in keyof ExactInputSplitSessionWorkCounters]: number;
};

type PathFrontier = ReturnType<typeof createPreparedSimplePathFrontier>;
type CandidateSetFrontier = ReturnType<typeof createSharedCandidateSetFrontier>;
type CandidateSets = ReturnType<typeof materializeSharedCandidateSets>;

interface SplitProposal {
  readonly key: string;
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly legs: readonly ExactInputSplitReplayLegRequest[];
}

interface SessionState {
  readonly context: PreparedRoutingContext;
  readonly request: ExactInputSplitSessionRequest;
  readonly control: ExactInputSplitSessionControl;
  readonly counters: MutableCounters;
  readonly proposals: Map<string, SplitProposal>;
  readonly diagnostics: unknown[];
  priorClock: bigint | undefined;
  pathFrontier: PathFrontier | undefined;
  candidateSetFrontier: CandidateSetFrontier | undefined;
  candidateSets: CandidateSets;
  incumbent: ExactInputSplitReplayReceipt | undefined;
  hadCandidate: boolean;
  workLimited: boolean;
  referencePolicyRan: boolean;
}

const SESSION_STATES = new WeakMap<object, SessionState>();

const KIND_CAP: Record<
  ExactInputSplitSessionWorkKind,
  keyof ExactInputSplitSessionWorkCaps
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
  ExactInputSplitSessionWorkKind,
  keyof ExactInputSplitSessionWorkCounters
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

function freshCounters(): MutableCounters {
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

function stateOf<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): SessionState {
  const state = SESSION_STATES.get(session);
  if (state === undefined) throw new TypeError('Invalid exact-input split session.');
  return state;
}

function capturedRequest(
  request: ExactInputSplitSessionRequest,
): ExactInputSplitSessionRequest {
  return Object.freeze({
    snapshotId: request.snapshotId,
    snapshotChecksum: request.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountIn: request.amountIn,
    maxHops: request.maxHops,
    maxRoutes: request.maxRoutes,
    greedyParts: request.greedyParts,
  });
}

function capturedControl(
  control: ExactInputSplitSessionControl,
): ExactInputSplitSessionControl {
  return Object.freeze({
    workCaps: Object.freeze({
      maxPathExpansions: control.workCaps.maxPathExpansions,
      maxBestSingleCandidateReplays:
        control.workCaps.maxBestSingleCandidateReplays,
      maxCandidateSetExpansions: control.workCaps.maxCandidateSetExpansions,
      maxEqualProposalReplays: control.workCaps.maxEqualProposalReplays,
      maxGreedyOptionReplays: control.workCaps.maxGreedyOptionReplays,
      maxFinalAuthorizationReplays: control.workCaps.maxFinalAuthorizationReplays,
      maxNumericalProposals: control.workCaps.maxNumericalProposals,
      maxNumericalIterations: control.workCaps.maxNumericalIterations,
      maxNumericalResidualReplays: control.workCaps.maxNumericalResidualReplays,
      maxNumericalAuthorizationReplays:
        control.workCaps.maxNumericalAuthorizationReplays,
    }),
    shouldInterrupt: control.shouldInterrupt,
    deadlineNanoseconds: control.deadlineNanoseconds,
    nowNanoseconds: control.nowNanoseconds,
  });
}

export function createExactInputSplitSession<TDiagnostic = never>(
  context: PreparedRoutingContext,
  request: ExactInputSplitSessionRequest,
  control: ExactInputSplitSessionControl,
): ExactInputSplitSession<TDiagnostic> {
  const session = Object.freeze({}) as ExactInputSplitSession<TDiagnostic>;
  SESSION_STATES.set(session, {
    context,
    request: capturedRequest(request),
    control: capturedControl(control),
    counters: freshCounters(),
    proposals: new Map(),
    diagnostics: [],
    priorClock: undefined,
    pathFrontier: undefined,
    candidateSetFrontier: undefined,
    candidateSets: Object.freeze([]),
    incumbent: undefined,
    hadCandidate: false,
    workLimited: false,
    referencePolicyRan: false,
  });
  return session;
}

export function exactInputSplitSessionCounters<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): ExactInputSplitSessionWorkCounters {
  const counters = stateOf(session).counters;
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
    numericalResidualReplayRejections:
      counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections,
  });
}

export function exactInputSplitSessionIncumbent<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): ExactInputSplitReplayReceipt | undefined {
  return stateOf(session).incumbent;
}

export function exactInputSplitSessionHadCandidate<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): boolean {
  return stateOf(session).hadCandidate;
}

export function exactInputSplitSessionWorkLimited<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): boolean {
  return stateOf(session).workLimited;
}

export function exactInputSplitSessionCandidateSets<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): CandidateSets {
  return stateOf(session).candidateSets;
}

export function appendExactInputSplitSessionDiagnostic<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  diagnostic: TDiagnostic,
): void {
  stateOf(session).diagnostics.push(diagnostic);
}

export function exactInputSplitSessionDiagnostics<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): readonly TDiagnostic[] {
  return Object.freeze([...stateOf(session).diagnostics]) as readonly TDiagnostic[];
}

export function observeExactInputSplitSessionBoundary<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  kind: ExactInputSplitSessionWorkKind,
): ExactInputSplitSessionBoundary {
  const state = stateOf(session);
  const counter = KIND_COUNTER[kind];
  const cap = KIND_CAP[kind];
  if (state.counters[counter] === state.control.workCaps[cap]) {
    state.workLimited = true;
    return { outcome: 'cap' };
  }
  if (state.control.shouldInterrupt !== undefined) {
    const checkpoint = Object.freeze({
      nextWorkKind: kind,
      counters: exactInputSplitSessionCounters(session),
      incumbent: state.incumbent ?? null,
    });
    let interrupted: unknown;
    const shouldInterrupt = state.control.shouldInterrupt;
    try {
      interrupted = shouldInterrupt(checkpoint);
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
  if (state.control.nowNanoseconds !== undefined) {
    let sample: unknown;
    const nowNanoseconds = state.control.nowNanoseconds;
    try {
      sample = nowNanoseconds();
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
    if (state.priorClock !== undefined && sample < state.priorClock) {
      return {
        outcome: 'deadline-error',
        error: Object.freeze({
          code: 'deadline-clock-regressed',
          field: 'nowNanoseconds',
        }),
      };
    }
    state.priorClock = sample;
    if (sample >= state.control.deadlineNanoseconds!) {
      return { outcome: 'deadline' };
    }
  }
  return { outcome: 'execute' };
}

export function chargeExactInputSplitSessionWork<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  kind: ExactInputSplitSessionWorkKind,
): void {
  const state = stateOf(session);
  state.counters[KIND_COUNTER[kind]] += 1;
}

export function recordExactInputSplitSessionNumericalProposalFailure<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): void {
  stateOf(session).counters.numericalProposalFailures += 1;
}

export function recordExactInputSplitSessionNumericalResidualReplayRejection<
  TDiagnostic,
>(session: ExactInputSplitSession<TDiagnostic>): void {
  stateOf(session).counters.numericalResidualReplayRejections += 1;
}

export function recordExactInputSplitSessionNumericalAuthorizationReplayRejection<
  TDiagnostic,
>(session: ExactInputSplitSession<TDiagnostic>): void {
  stateOf(session).counters.numericalAuthorizationReplayRejections += 1;
}

export function positiveExactInputSplitSessionLegs(
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

function partialReplayRequest(
  request: ExactInputSplitSessionRequest,
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

function fullReplayRequest(
  request: ExactInputSplitSessionRequest,
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

export function replayExactInputSplitSessionPartial<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayResult {
  const state = stateOf(session);
  return replayPreparedExactInputSplit(
    state.context,
    partialReplayRequest(state.request, legs),
  );
}

export function replayExactInputSplitSessionFull<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayResult {
  const state = stateOf(session);
  return replayPreparedExactInputSplit(
    state.context,
    fullReplayRequest(state.request, legs),
  );
}

export function isStrictlyBetterExactInputSplitSessionReceipt(
  left: ExactInputSplitReplayReceipt,
  right: ExactInputSplitReplayReceipt,
): boolean {
  return isStrictlyBetterSplitReceipt(left, right);
}

function proposalKey(legs: readonly ExactInputSplitReplayLegRequest[]): string {
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

function compareProposals(left: SplitProposal, right: SplitProposal): number {
  if (isStrictlyBetterSplitReceipt(left.receipt, right.receipt)) return -1;
  if (isStrictlyBetterSplitReceipt(right.receipt, left.receipt)) return 1;
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function* positiveChunks(amountIn: bigint, parts: number): Generator<bigint> {
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

function collectProposal(
  state: SessionState,
  receipt: ExactInputSplitReplayReceipt,
  legs: readonly ExactInputSplitReplayLegRequest[],
): void {
  const key = proposalKey(legs);
  if (!state.proposals.has(key)) {
    state.proposals.set(key, Object.freeze({ key, receipt, legs }));
  }
}

export function runExactInputSplitReferencePolicy<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): ExactInputSplitReferencePolicyOutcome {
  const state = stateOf(session);
  if (state.referencePolicyRan) {
    throw new TypeError('The exact-input split reference policy already ran.');
  }
  state.referencePolicyRan = true;

  const directRoutes = preparedDirectRoutes(
    state.context,
    state.request.assetIn,
    state.request.assetOut,
  );
  for (const route of directRoutes) {
    state.hadCandidate = true;
    state.counters.directCandidates += 1;
    state.counters.directCandidateReplays += 1;
    const replay = replayPreparedExactInputSplit(
      state.context,
      fullReplayRequest(state.request, [
        Object.freeze({ allocation: state.request.amountIn, route }),
      ]),
    );
    if (!replay.ok) state.counters.directCandidateRejections += 1;
    else if (
      state.incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, state.incumbent)
    ) {
      state.incumbent = replay.value;
    }
  }

  state.pathFrontier = createPreparedSimplePathFrontier(
    state.context,
    state.request,
  );
  while (hasPreparedSimplePathExpansion(state.pathFrontier)) {
    const stop = observeExactInputSplitSessionBoundary(session, 'path-expansion');
    if (stop.outcome === 'cap') break;
    if (stop.outcome !== 'execute') return stop;
    expandPreparedSimplePathFrontier(state.pathFrontier);
    state.counters.pathExpansions += 1;
  }
  const paths = materializePreparedSimplePaths(state.pathFrontier);
  state.hadCandidate ||= paths.length > 0;

  for (const route of paths) {
    const stop = observeExactInputSplitSessionBoundary(
      session,
      'best-single-candidate-replay',
    );
    if (stop.outcome === 'cap') break;
    if (stop.outcome !== 'execute') return stop;
    state.counters.bestSingleCandidateReplays += 1;
    const legs = Object.freeze([
      Object.freeze({ allocation: state.request.amountIn, route }),
    ]);
    const replay = replayPreparedExactInputSplit(
      state.context,
      fullReplayRequest(state.request, legs),
    );
    if (!replay.ok) state.counters.bestSingleCandidateRejections += 1;
    else if (
      state.incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, state.incumbent)
    ) {
      state.incumbent = replay.value;
    }
  }

  state.candidateSetFrontier = createSharedCandidateSetFrontier(
    paths,
    state.request.maxRoutes,
  );
  while (hasSharedCandidateSetExpansion(state.candidateSetFrontier)) {
    const stop = observeExactInputSplitSessionBoundary(
      session,
      'candidate-set-expansion',
    );
    if (stop.outcome === 'cap') break;
    if (stop.outcome !== 'execute') return stop;
    expandSharedCandidateSetFrontier(state.candidateSetFrontier);
    state.counters.candidateSetExpansions += 1;
  }
  state.candidateSets = materializeSharedCandidateSets(state.candidateSetFrontier);

  for (const { routes } of state.candidateSets) {
    const cardinality = BigInt(routes.length);
    const base = state.request.amountIn / cardinality;
    if (base === 0n) continue;
    const remainder = state.request.amountIn % cardinality;
    const legs = Object.freeze(
      routes.map((route, index) =>
        Object.freeze({
          allocation: base + (BigInt(index) < remainder ? 1n : 0n),
          route,
        }),
      ),
    );
    const stop = observeExactInputSplitSessionBoundary(
      session,
      'equal-proposal-replay',
    );
    if (stop.outcome === 'cap') break;
    if (stop.outcome !== 'execute') return stop;
    state.counters.equalProposalReplays += 1;
    const replay = replayPreparedExactInputSplit(
      state.context,
      fullReplayRequest(state.request, legs),
    );
    if (!replay.ok) state.counters.equalProposalRejections += 1;
    else collectProposal(state, replay.value, legs);
  }

  candidateSets: for (const { routes } of state.candidateSets) {
    const allocations = routes.map(() => 0n);
    let allocated = 0n;
    let finalProposal: ExactInputSplitReplayReceipt | undefined;
    for (const chunk of positiveChunks(
      state.request.amountIn,
      state.request.greedyParts,
    )) {
      let winningIndex: number | undefined;
      let winningOutput: bigint | undefined;
      let winningReceipt: ExactInputSplitReplayReceipt | undefined;
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const stop = observeExactInputSplitSessionBoundary(
          session,
          'greedy-option-replay',
        );
        if (stop.outcome === 'cap') break candidateSets;
        if (stop.outcome !== 'execute') return stop;
        const optionAllocations = [...allocations];
        optionAllocations[routeIndex] = optionAllocations[routeIndex]! + chunk;
        state.counters.greedyOptionReplays += 1;
        const replay = replayPreparedExactInputSplit(
          state.context,
          partialReplayRequest(
            state.request,
            positiveExactInputSplitSessionLegs(routes, optionAllocations),
          ),
        );
        if (!replay.ok) {
          state.counters.greedyOptionRejections += 1;
          continue;
        }
        if (
          winningOutput === undefined ||
          replay.value.amountOut > winningOutput
        ) {
          winningIndex = routeIndex;
          winningOutput = replay.value.amountOut;
          winningReceipt = replay.value;
        }
      }
      if (winningIndex === undefined) continue candidateSets;
      allocations[winningIndex] = allocations[winningIndex]! + chunk;
      allocated += chunk;
      finalProposal = winningReceipt;
    }
    if (allocated !== state.request.amountIn || finalProposal === undefined) continue;
    const legs = positiveExactInputSplitSessionLegs(routes, allocations);
    collectProposal(state, finalProposal, legs);
  }

  const orderedProposals = [...state.proposals.values()].sort(compareProposals);
  for (const proposal of orderedProposals) {
    if (
      state.incumbent !== undefined &&
      !isStrictlyBetterSplitReceipt(proposal.receipt, state.incumbent)
    ) {
      continue;
    }
    const stop = observeExactInputSplitSessionBoundary(
      session,
      'final-authorization-replay',
    );
    if (stop.outcome === 'cap') break;
    if (stop.outcome !== 'execute') return stop;
    state.counters.finalAuthorizationReplays += 1;
    const replay = replayPreparedExactInputSplit(
      state.context,
      fullReplayRequest(state.request, proposal.legs),
    );
    if (!replay.ok) state.counters.finalAuthorizationRejections += 1;
    else if (
      state.incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, state.incumbent)
    ) {
      state.incumbent = replay.value;
    }
  }

  return { outcome: state.workLimited ? 'work-limit' : 'complete' };
}

function transitionReceiptEquals(
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

function receiptSemanticallyEquals(
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

function captureReplayReceipt(
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

export function authorizeExactInputSplitSessionNumericalCandidate<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  legs: readonly ExactInputSplitReplayLegRequest[],
  score: ExactInputSplitReplayReceipt,
  authorizationReplay?: ExactInputSplitSessionAuthorizationReplay,
): ExactInputSplitSessionAuthorizationOutcome {
  const state = stateOf(session);
  state.counters.numericalAuthorizationReplays += 1;
  const replay = authorizationReplay ?? replayPreparedExactInputSplit;
  const authorization = replay(
    state.context,
    fullReplayRequest(state.request, legs),
  );
  if (!authorization.ok) {
    state.counters.numericalAuthorizationReplayRejections += 1;
    return 'rejected';
  }
  const capturedAuthorization = captureReplayReceipt(authorization.value);
  if (
    capturedAuthorization === undefined ||
    !receiptSemanticallyEquals(capturedAuthorization, score) ||
    state.incumbent === undefined ||
    !isStrictlyBetterSplitReceipt(capturedAuthorization, state.incumbent)
  ) {
    state.counters.numericalAuthorizationReplayRejections += 1;
    return 'mismatch';
  }
  state.incumbent = capturedAuthorization;
  return 'improved';
}
