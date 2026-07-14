import { createHash } from 'node:crypto';

import {
  advanceServicePathShadowPriceReconstructionStep,
  advanceServicePathShadowPriceShareMicrostep,
  appendServicePathShadowPriceModelRoute,
  createServicePathShadowPriceState,
  servicePathShadowPriceFailure,
  servicePathShadowPriceInitialResidualUnits,
  servicePathShadowPriceProgress,
  servicePathShadowPriceReadyWeights,
  servicePathShadowPriceResidualOption,
  servicePathShadowPriceScoreAllocations,
  settleServicePathShadowPriceResidualOption,
  startServicePathShadowPriceProposal,
  type ServicePathShadowPriceState,
} from '../../allocation/service-path-shadow-price/index.ts';
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
  resolvePreparedPathShadowPriceRoute,
  replayPreparedExactInputSplit,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  advancePreparedServiceDirectRoute,
  createPreparedServiceDirectRouteCursor,
  hasPreparedServiceDirectRoute,
  preparedServiceRoutingBaseContext,
  preparedServiceRoutingClock,
  preparedServiceRoutingPolicy,
  SERVICE_ROUTING_POLICY_V1_ID,
  type PreparedServiceDirectRouteCursor,
  type PreparedServiceRoutingContext,
  type ServiceRoutingPolicy,
} from '../../runtime/prepared-service-routing-context/index.ts';
import {
  createSharedCandidateSetFrontier,
  expandSharedCandidateSetFrontier,
  hasSharedCandidateSetExpansion,
  materializeSharedCandidateSets,
} from '../../search/shared-route-discovery/index.ts';
import {
  advanceServiceRouteDiscoveryFrontier,
  appendServiceRouteDiscoveryPath,
  closeServiceRouteDiscoveryPathInput,
  createServiceRouteDiscoveryFrontier,
  hasServiceRouteDiscoveryStep,
  serviceRouteDiscoveryIsComplete,
  type ServiceRouteDiscoveryFrontier,
} from '../../search/service-route-discovery/index.ts';
import { isStrictlyBetterSplitReceipt } from '../split-exact-input/objective.ts';
import type {
  ServiceExactInputSplitActionKind,
  ServiceExactInputSplitCancellationErrorCode,
  ServiceExactInputSplitCheckpoint,
  ServiceExactInputSplitClockErrorCode,
  ServiceExactInputSplitDebugProjection,
  ServiceExactInputSplitNumericalDiagnostic,
  ServiceExactInputSplitNumericalFailureCode,
  ServiceExactInputSplitRouteResult,
  ServiceExactInputSplitWorkCounters,
} from '../service-exact-input-split/index.ts';

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

interface ReferenceSessionState {
  readonly policy: 'reference-v1';
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

type MutableServiceCounters = {
  -readonly [Key in keyof ServiceExactInputSplitWorkCounters]: number;
};

export interface ServiceExactInputSplitSessionRequest {
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
  readonly maxHops: number;
  readonly maxRoutes: number;
  readonly greedyParts: number;
}

export interface ServiceExactInputSplitSessionControl {
  readonly absoluteDeadlineNanoseconds: bigint;
  readonly shouldCancel:
    | ((checkpoint: ServiceExactInputSplitCheckpoint) => unknown)
    | undefined;
  readonly debug: boolean;
}

declare const serviceExactInputSplitSessionBrand: unique symbol;

export interface ServiceExactInputSplitSession {
  readonly [serviceExactInputSplitSessionBrand]: typeof serviceExactInputSplitSessionBrand;
}

interface ServiceCandidateFamily {
  readonly routes: readonly (readonly DirectionalRouteHop[])[];
  readonly routeKeys: readonly string[];
  readonly candidateSetKey: string;
  readonly numerical: ServicePathShadowPriceState;
  modelIndex: number;
  modelFailed: boolean;
  equalStage: 'replay' | 'bookkeeping' | 'authorization' | 'done';
  equalScore: ExactInputSplitReplayReceipt | undefined;
  equalLegs: readonly ExactInputSplitReplayLegRequest[] | undefined;
  numericalStage:
    | 'waiting'
    | 'start'
    | 'share'
    | 'reconstruction'
    | 'residual'
    | 'bookkeeping'
    | 'authorization'
    | 'diagnostic'
    | 'done';
  numericalScore: ExactInputSplitReplayReceipt | undefined;
  numericalLegs: readonly ExactInputSplitReplayLegRequest[] | undefined;
  residualRound: bigint | undefined;
  residualBest: ExactInputSplitReplayReceipt | undefined;
  numericalStatus: 'improved' | 'not-better' | 'failed' | 'stopped';
  numericalFailureCode: ServiceExactInputSplitNumericalFailureCode | null;
  numericalCounterStart: ServiceExactInputSplitWorkCounters | undefined;
  numericalProposalStarted: boolean;
  numericalDiagnosticRetained: boolean;
  equalProposalReserved: boolean;
  numericalProposalReserved: boolean;
}

interface ServiceGreedyState {
  readonly family: ServiceCandidateFamily;
  readonly allocations: bigint[];
  readonly chunkBase: bigint;
  readonly chunkRemainder: bigint;
  chunkIndex: number;
  routeIndex: number;
  winningIndex: number | undefined;
  winningReceipt: ExactInputSplitReplayReceipt | undefined;
  finalScore: ExactInputSplitReplayReceipt | undefined;
  finalLegs: readonly ExactInputSplitReplayLegRequest[] | undefined;
  stage: 'option' | 'bookkeeping' | 'authorization' | 'done';
  proposalReserved: boolean;
}

interface ServiceSessionState {
  readonly policy: 'service-v2';
  readonly context: PreparedServiceRoutingContext;
  readonly baseContext: PreparedRoutingContext;
  readonly request: ServiceExactInputSplitSessionRequest;
  readonly control: ServiceExactInputSplitSessionControl;
  readonly servicePolicy: ServiceRoutingPolicy;
  readonly nowNanoseconds: () => unknown;
  readonly counters: MutableServiceCounters;
  readonly directCursor: PreparedServiceDirectRouteCursor;
  readonly pathFrontier: ReturnType<typeof createPreparedSimplePathFrontier>;
  readonly setFrontier: ServiceRouteDiscoveryFrontier;
  readonly paths: Array<readonly DirectionalRouteHop[]>;
  readonly families: ServiceCandidateFamily[];
  readonly equalFamilies: ServiceCandidateFamily[];
  readonly numericalFamilies: ServiceCandidateFamily[];
  readonly proposals: Map<string, SplitProposal>;
  readonly numericalDiagnostics: ServiceExactInputSplitNumericalDiagnostic[];
  readonly debugFragments: Array<{
    readonly diagnosticIndex: number;
    readonly candidateSetKey: string;
    readonly routeKeys: readonly string[];
  }>;
  debugBytes: number;
  debugTruncated: boolean;
  bestPathIndex: number;
  equalFamilyIndex: number;
  familyIndex: number;
  greedyFamilyIndex: number;
  greedy: ServiceGreedyState | undefined;
  strictPipeline: 'pending' | 'active' | 'complete';
  strictFamily: ServiceCandidateFamily | undefined;
  equalLaneClosed: boolean;
  equalLaneCapClosed: boolean;
  numericalLaneClosed: boolean;
  numericalLaneCapClosed: boolean;
  pathClosed: boolean;
  setInputClosed: boolean;
  setClosed: boolean;
  directClosed: boolean;
  bestClosed: boolean;
  proposalBookkeepingSteps: number;
  diagnosticBookkeepingSteps: number;
  reservedProposalSlots: number;
  priorClock: bigint;
  incumbent: ExactInputSplitReplayReceipt | undefined;
  hadStructuralCandidate: boolean;
  workLimited: boolean;
  terminalProjected: boolean;
  ran: boolean;
}

type SessionState = ReferenceSessionState | ServiceSessionState;

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

function referenceStateOf<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): ReferenceSessionState {
  const state = SESSION_STATES.get(session);
  if (state === undefined || state.policy !== 'reference-v1') {
    throw new TypeError('Invalid exact-input split session.');
  }
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
    policy: 'reference-v1',
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

function freshServiceCounters(): MutableServiceCounters {
  return {
    aggregateTransitions: 0,
    directInspections: 0,
    directReplays: 0,
    directReplayRejections: 0,
    pathExpansions: 0,
    pathsRetained: 0,
    bestSingleReplays: 0,
    bestSingleReplayRejections: 0,
    candidateSetSteps: 0,
    candidateSetsRetained: 0,
    equalProposalReplays: 0,
    equalProposalReplayRejections: 0,
    proposalsRetained: 0,
    baselineAuthorizationReplays: 0,
    baselineAuthorizationReplayRejections: 0,
    greedyPartsStarted: 0,
    greedyOptionReplays: 0,
    greedyOptionReplayRejections: 0,
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalModelRouteSteps: 0,
    numericalOuterUpdatesStarted: 0,
    numericalOuterUpdatesCompleted: 0,
    numericalShareMicrosteps: 0,
    numericalReconstructionSteps: 0,
    numericalResidualOptionReplays: 0,
    numericalResidualOptionReplayRejections: 0,
    activationProbeReplays: 0,
    activationProbeReplayRejections: 0,
    repairNeighborReplays: 0,
    repairNeighborReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
    bookkeepingSteps: 0,
    diagnosticsRetained: 0,
    terminalProjections: 0,
  };
}

function captureServiceRequest(
  request: ServiceExactInputSplitSessionRequest,
): ServiceExactInputSplitSessionRequest {
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

function captureServiceControl(
  control: ServiceExactInputSplitSessionControl,
): ServiceExactInputSplitSessionControl {
  return Object.freeze({
    absoluteDeadlineNanoseconds: control.absoluteDeadlineNanoseconds,
    shouldCancel: control.shouldCancel,
    debug: control.debug,
  });
}

function serviceStateOf(
  session: ServiceExactInputSplitSession,
): ServiceSessionState {
  const state = SESSION_STATES.get(session);
  if (state === undefined || state.policy !== 'service-v2') {
    throw new TypeError('Invalid exact-input split service session.');
  }
  return state;
}

export function createServiceExactInputSplitSession(
  context: PreparedServiceRoutingContext,
  request: ServiceExactInputSplitSessionRequest,
  control: ServiceExactInputSplitSessionControl,
  entryClockSample: bigint,
): ServiceExactInputSplitSession {
  const servicePolicy = preparedServiceRoutingPolicy(context);
  const nowNanoseconds = preparedServiceRoutingClock(context);
  if (servicePolicy === undefined || nowNanoseconds === undefined) {
    throw new TypeError('Unknown prepared service routing context.');
  }
  const capturedRequest = captureServiceRequest(request);
  const session = Object.freeze({}) as ServiceExactInputSplitSession;
  SESSION_STATES.set(session, {
    policy: 'service-v2',
    context,
    baseContext: preparedServiceRoutingBaseContext(context),
    request: capturedRequest,
    control: captureServiceControl(control),
    servicePolicy,
    nowNanoseconds,
    counters: freshServiceCounters(),
    directCursor: createPreparedServiceDirectRouteCursor(
      context,
      capturedRequest.assetIn,
      capturedRequest.assetOut,
    ),
    pathFrontier: createPreparedSimplePathFrontier(
      preparedServiceRoutingBaseContext(context),
      capturedRequest,
    ),
    setFrontier: createServiceRouteDiscoveryFrontier(
      capturedRequest.maxRoutes,
      capturedRequest.maxHops,
    ),
    paths: [],
    families: [],
    equalFamilies: [],
    numericalFamilies: [],
    proposals: new Map(),
    numericalDiagnostics: [],
    debugFragments: [],
    debugBytes: 0,
    debugTruncated: false,
    bestPathIndex: 0,
    equalFamilyIndex: 0,
    familyIndex: 0,
    greedyFamilyIndex: 0,
    greedy: undefined,
    strictPipeline: capturedRequest.amountIn >= 2n ? 'pending' : 'complete',
    strictFamily: undefined,
    equalLaneClosed: capturedRequest.amountIn < 2n,
    equalLaneCapClosed: false,
    numericalLaneClosed: capturedRequest.amountIn < 2n,
    numericalLaneCapClosed: false,
    pathClosed: false,
    setInputClosed: false,
    setClosed: false,
    directClosed: false,
    bestClosed: false,
    proposalBookkeepingSteps: 0,
    diagnosticBookkeepingSteps: 0,
    reservedProposalSlots: 0,
    priorClock: entryClockSample,
    incumbent: undefined,
    hadStructuralCandidate: false,
    workLimited: false,
    terminalProjected: false,
    ran: false,
  });
  return session;
}

export function serviceExactInputSplitSessionCounters(
  session: ServiceExactInputSplitSession,
): ServiceExactInputSplitWorkCounters {
  const counters = serviceStateOf(session).counters;
  return Object.freeze({
    aggregateTransitions: counters.aggregateTransitions,
    directInspections: counters.directInspections,
    directReplays: counters.directReplays,
    directReplayRejections: counters.directReplayRejections,
    pathExpansions: counters.pathExpansions,
    pathsRetained: counters.pathsRetained,
    bestSingleReplays: counters.bestSingleReplays,
    bestSingleReplayRejections: counters.bestSingleReplayRejections,
    candidateSetSteps: counters.candidateSetSteps,
    candidateSetsRetained: counters.candidateSetsRetained,
    equalProposalReplays: counters.equalProposalReplays,
    equalProposalReplayRejections: counters.equalProposalReplayRejections,
    proposalsRetained: counters.proposalsRetained,
    baselineAuthorizationReplays: counters.baselineAuthorizationReplays,
    baselineAuthorizationReplayRejections:
      counters.baselineAuthorizationReplayRejections,
    greedyPartsStarted: counters.greedyPartsStarted,
    greedyOptionReplays: counters.greedyOptionReplays,
    greedyOptionReplayRejections: counters.greedyOptionReplayRejections,
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalModelRouteSteps: counters.numericalModelRouteSteps,
    numericalOuterUpdatesStarted: counters.numericalOuterUpdatesStarted,
    numericalOuterUpdatesCompleted: counters.numericalOuterUpdatesCompleted,
    numericalShareMicrosteps: counters.numericalShareMicrosteps,
    numericalReconstructionSteps: counters.numericalReconstructionSteps,
    numericalResidualOptionReplays: counters.numericalResidualOptionReplays,
    numericalResidualOptionReplayRejections:
      counters.numericalResidualOptionReplayRejections,
    activationProbeReplays: counters.activationProbeReplays,
    activationProbeReplayRejections: counters.activationProbeReplayRejections,
    repairNeighborReplays: counters.repairNeighborReplays,
    repairNeighborReplayRejections: counters.repairNeighborReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections,
    bookkeepingSteps: counters.bookkeepingSteps,
    diagnosticsRetained: counters.diagnosticsRetained,
    terminalProjections: counters.terminalProjections,
  });
}

export function serviceExactInputSplitSessionNumericalDiagnostics(
  session: ServiceExactInputSplitSession,
): readonly ServiceExactInputSplitNumericalDiagnostic[] {
  return Object.freeze([...serviceStateOf(session).numericalDiagnostics]);
}

export function serviceExactInputSplitSessionDebug(
  session: ServiceExactInputSplitSession,
): ServiceExactInputSplitDebugProjection | null {
  const state = serviceStateOf(session);
  if (!state.control.debug) return null;
  return Object.freeze({
    truncated: state.debugTruncated,
    fragments: Object.freeze([...state.debugFragments]),
  });
}

export type ServiceExactInputSplitSessionBoundary =
  | { readonly outcome: 'execute' }
  | { readonly outcome: 'cap'; readonly scope: 'lane' | 'aggregate' }
  | { readonly outcome: 'deadline' }
  | { readonly outcome: 'interrupted' }
  | {
      readonly outcome: 'dependency-error';
      readonly dependency: 'clock';
      readonly termination: 'deadline';
      readonly code: ServiceExactInputSplitClockErrorCode;
    }
  | {
      readonly outcome: 'dependency-error';
      readonly dependency: 'cancellation';
      readonly termination: 'interrupted';
      readonly code: ServiceExactInputSplitCancellationErrorCode;
    };

function serviceActionAtCap(
  state: ServiceSessionState,
  kind: ServiceExactInputSplitActionKind,
): boolean {
  const { counters, servicePolicy: policy } = state;
  switch (kind) {
    case 'direct-candidate-replay':
      return (
        counters.directInspections >= policy.maxDirectInspections ||
        counters.directReplays >= policy.maxDirectReplays
      );
    case 'path-expansion':
      return counters.pathExpansions >= policy.maxPathExpansions;
    case 'best-single-candidate-replay':
      return counters.bestSingleReplays >= policy.maxBestSingleCandidateReplays;
    case 'candidate-set-step':
      return counters.candidateSetSteps >= policy.maxCandidateSetSteps;
    case 'equal-proposal-replay':
      return counters.equalProposalReplays >= policy.maxEqualProposalReplays;
    case 'baseline-authorization-replay':
      return (
        counters.baselineAuthorizationReplays >=
        policy.maxBaselineAuthorizationReplays
      );
    case 'greedy-option-replay':
      return counters.greedyOptionReplays >= policy.maxGreedyOptionReplays;
    case 'numerical-proposal-start':
      return counters.numericalProposals >= policy.maxNumericalProposals;
    case 'numerical-model-route':
      return (
        counters.numericalModelRouteSteps >= policy.maxNumericalModelRouteSteps
      );
    case 'numerical-share-microstep':
      return (
        counters.numericalShareMicrosteps >= policy.maxNumericalShareMicrosteps
      );
    case 'numerical-reconstruction-step':
      return (
        counters.numericalReconstructionSteps >=
        policy.maxNumericalReconstructionSteps
      );
    case 'numerical-residual-option-replay':
      return (
        counters.numericalResidualOptionReplays >=
        policy.maxNumericalResidualOptionReplays
      );
    case 'activation-probe-replay':
      return counters.activationProbeReplays >= policy.maxActivationProbeReplays;
    case 'repair-neighbor-replay':
      return counters.repairNeighborReplays >= policy.maxRepairNeighborReplays;
    case 'numerical-authorization-replay':
      return (
        counters.numericalAuthorizationReplays >=
        policy.maxNumericalAuthorizationReplays
      );
    case 'proposal-bookkeeping':
      return (
        state.proposalBookkeepingSteps >=
        policy.maxEqualProposalReplays +
          policy.maxGreedyOptionReplays +
          policy.maxNumericalProposals
      );
    case 'diagnostic-bookkeeping':
      return (
        state.diagnosticBookkeepingSteps >= policy.maxNumericalDiagnostics ||
        counters.diagnosticsRetained >= policy.maxNumericalDiagnostics
      );
    case 'terminal-projection':
      return counters.terminalProjections >= 1;
  }
}

export function observeServiceExactInputSplitSessionBoundary(
  session: ServiceExactInputSplitSession,
  kind: ServiceExactInputSplitActionKind,
): ServiceExactInputSplitSessionBoundary {
  const state = serviceStateOf(session);
  if (serviceActionAtCap(state, kind)) {
    state.workLimited = true;
    return Object.freeze({ outcome: 'cap', scope: 'lane' });
  }
  if (
    kind !== 'terminal-projection' &&
    state.counters.aggregateTransitions >=
      state.servicePolicy.maxAggregateTransitions - 1
  ) {
    state.workLimited = true;
    return Object.freeze({ outcome: 'cap', scope: 'aggregate' });
  }
  if (state.control.shouldCancel !== undefined) {
    const checkpoint: ServiceExactInputSplitCheckpoint = Object.freeze({
      nextActionKind: kind,
      counters: serviceExactInputSplitSessionCounters(session),
      incumbent: state.incumbent ?? null,
    });
    let cancelled: unknown;
    try {
      cancelled = Reflect.apply(state.control.shouldCancel, undefined, [checkpoint]);
    } catch {
      return Object.freeze({
        outcome: 'dependency-error',
        dependency: 'cancellation',
        termination: 'interrupted',
        code: 'cancellation-call-failed',
      });
    }
    if (typeof cancelled !== 'boolean') {
      return Object.freeze({
        outcome: 'dependency-error',
        dependency: 'cancellation',
        termination: 'interrupted',
        code: 'invalid-cancellation-result',
      });
    }
    if (cancelled) return Object.freeze({ outcome: 'interrupted' });
  }
  let sample: unknown;
  try {
    sample = Reflect.apply(state.nowNanoseconds, undefined, []);
  } catch {
    return Object.freeze({
      outcome: 'dependency-error',
      dependency: 'clock',
      termination: 'deadline',
      code: 'clock-call-failed',
    });
  }
  if (typeof sample !== 'bigint' || sample < 0n) {
    return Object.freeze({
      outcome: 'dependency-error',
      dependency: 'clock',
      termination: 'deadline',
      code: 'invalid-clock-sample',
    });
  }
  if (sample < state.priorClock) {
    return Object.freeze({
      outcome: 'dependency-error',
      dependency: 'clock',
      termination: 'deadline',
      code: 'clock-regressed',
    });
  }
  state.priorClock = sample;
  if (sample >= state.control.absoluteDeadlineNanoseconds) {
    return Object.freeze({ outcome: 'deadline' });
  }
  return Object.freeze({ outcome: 'execute' });
}

function consumeServiceTerminalReservation(state: ServiceSessionState): boolean {
  if (
    state.terminalProjected ||
    state.counters.aggregateTransitions >= state.servicePolicy.maxAggregateTransitions
  ) {
    return false;
  }
  state.terminalProjected = true;
  state.counters.terminalProjections += 1;
  state.counters.aggregateTransitions += 1;
  return true;
}

interface ServiceSessionOutcomeBase {
  readonly incumbent: ExactInputSplitReplayReceipt | null;
  readonly counters: ServiceExactInputSplitWorkCounters;
  readonly result: ServiceExactInputSplitRouteResult;
}

export type ServiceExactInputSplitSessionOutcome =
  | (ServiceSessionOutcomeBase & {
      readonly outcome: 'complete';
      readonly termination: 'complete';
      readonly noRouteReason:
        | 'no-structural-candidate'
        | 'all-exact-replays-rejected'
        | null;
    })
  | (ServiceSessionOutcomeBase & {
      readonly outcome: 'stopped';
      readonly termination: 'work-limit' | 'deadline' | 'interrupted';
    })
  | (ServiceSessionOutcomeBase & {
      readonly outcome: 'dependency-error';
      readonly dependency: 'clock';
      readonly code: ServiceExactInputSplitClockErrorCode;
      readonly termination: 'deadline';
    })
  | (ServiceSessionOutcomeBase & {
      readonly outcome: 'dependency-error';
      readonly dependency: 'cancellation';
      readonly code: ServiceExactInputSplitCancellationErrorCode;
      readonly termination: 'interrupted';
    })
  | (ServiceSessionOutcomeBase & {
      readonly outcome: 'state-error';
      readonly termination: 'work-limit' | 'deadline' | 'interrupted';
    });

type ServiceTerminalProjection =
  | {
      readonly kind: 'complete';
      readonly noRouteReason:
        | 'no-structural-candidate'
        | 'all-exact-replays-rejected';
    }
  | {
      readonly kind: 'stopped';
      readonly termination: 'work-limit' | 'deadline' | 'interrupted';
    }
  | {
      readonly kind: 'dependency';
      readonly dependency: 'clock' | 'cancellation';
      readonly code:
        | ServiceExactInputSplitClockErrorCode
        | ServiceExactInputSplitCancellationErrorCode;
      readonly termination: 'deadline' | 'interrupted';
    }
  | { readonly kind: 'state-error' };

function projectServiceTerminalResult(
  state: ServiceSessionState,
  projection: ServiceTerminalProjection,
): {
  readonly incumbent: ExactInputSplitReplayReceipt | null;
  readonly counters: ServiceExactInputSplitWorkCounters;
  readonly result: ServiceExactInputSplitRouteResult;
} {
  const incumbent = state.incumbent ?? null;
  const counters = serviceExactInputSplitSessionCountersFromState(state);
  const numericalDiagnostics = Object.freeze([
    ...state.numericalDiagnostics,
  ]);
  const debug: ServiceExactInputSplitDebugProjection | null = state.control.debug
    ? Object.freeze({
        truncated: state.debugTruncated,
        fragments: Object.freeze(
          state.debugFragments.map((fragment) =>
            Object.freeze({
              diagnosticIndex: fragment.diagnosticIndex,
              candidateSetKey: fragment.candidateSetKey,
              routeKeys: Object.freeze([...fragment.routeKeys]),
            }),
          ),
        ),
      })
    : null;
  const search = <
    TTermination extends
      | 'complete'
      | 'work-limit'
      | 'deadline'
      | 'interrupted'
      | 'state-error',
  >(termination: TTermination) =>
    Object.freeze({
      policyId: SERVICE_ROUTING_POLICY_V1_ID,
      termination,
      counters,
      numericalDiagnostics,
      debug,
    });
  let result: ServiceExactInputSplitRouteResult;
  if (projection.kind === 'state-error') {
    result = Object.freeze({
      status: 'state-error',
      error: Object.freeze({ code: 'service-session-state-failed' }),
      incumbent,
      search: search('state-error'),
    });
  } else if (projection.kind === 'dependency') {
    result =
      projection.dependency === 'clock'
        ? Object.freeze({
            status: 'dependency-error',
            dependency: 'clock',
            phase: 'action',
            termination: 'deadline',
            error: Object.freeze({
              code: projection.code as ServiceExactInputSplitClockErrorCode,
            }),
            incumbent,
            search: search('deadline'),
          })
        : Object.freeze({
            status: 'dependency-error',
            dependency: 'cancellation',
            phase: 'action',
            termination: 'interrupted',
            error: Object.freeze({
              code: projection.code as ServiceExactInputSplitCancellationErrorCode,
            }),
            incumbent,
            search: search('interrupted'),
          });
  } else if (incumbent !== null) {
    result = Object.freeze({
      status: 'success',
      plan: Object.freeze({
        receipt: incumbent,
        search: search(
          projection.kind === 'complete'
            ? 'complete'
            : projection.termination,
        ),
      }),
    });
  } else if (projection.kind === 'complete') {
    result = Object.freeze({
      status: 'no-route',
      reason: projection.noRouteReason,
      search: search('complete'),
    });
  } else if (projection.termination === 'work-limit') {
    result = Object.freeze({
      status: 'no-plan',
      reason: 'work-limit',
      search: search('work-limit'),
    });
  } else if (projection.termination === 'deadline') {
    result = Object.freeze({
      status: 'no-plan',
      reason: 'deadline-before-plan',
      search: search('deadline'),
    });
  } else {
    result = Object.freeze({
      status: 'no-plan',
      reason: 'interrupted',
      search: search('interrupted'),
    });
  }
  return Object.freeze({ incumbent, counters, result });
}

function stoppedServiceOutcome(
  state: ServiceSessionState,
  termination: 'work-limit' | 'deadline' | 'interrupted',
): ServiceExactInputSplitSessionOutcome {
  if (!consumeServiceTerminalReservation(state)) {
    const projected = projectServiceTerminalResult(state, {
      kind: 'state-error',
    });
    return Object.freeze({
      outcome: 'state-error',
      termination: 'work-limit',
      ...projected,
    });
  }
  const projected = projectServiceTerminalResult(state, {
    kind: 'stopped',
    termination,
  });
  return Object.freeze({
    outcome: 'stopped',
    termination,
    ...projected,
  });
}

function dependencyServiceOutcome(
  state: ServiceSessionState,
  boundary: Extract<
    ServiceExactInputSplitSessionBoundary,
    { readonly outcome: 'dependency-error' }
  >,
): ServiceExactInputSplitSessionOutcome {
  if (!consumeServiceTerminalReservation(state)) {
    const projected = projectServiceTerminalResult(state, {
      kind: 'state-error',
    });
    return Object.freeze({
      outcome: 'state-error',
      termination: 'work-limit',
      ...projected,
    });
  }
  const projected = projectServiceTerminalResult(state, {
    kind: 'dependency',
    dependency: boundary.dependency,
    code: boundary.code,
    termination: boundary.termination,
  });
  if (boundary.dependency === 'clock') {
    return Object.freeze({
      outcome: 'dependency-error',
      dependency: boundary.dependency,
      code: boundary.code,
      termination: boundary.termination,
      ...projected,
    });
  }
  return Object.freeze({
    outcome: 'dependency-error',
    dependency: boundary.dependency,
    code: boundary.code,
    termination: boundary.termination,
    ...projected,
  });
}

function serviceExactInputSplitSessionCountersFromState(
  state: ServiceSessionState,
): ServiceExactInputSplitWorkCounters {
  const counters = state.counters;
  return Object.freeze({ ...counters });
}

type ServiceActionGate =
  | { readonly outcome: 'execute' }
  | { readonly outcome: 'lane-cap' }
  | {
      readonly outcome: 'terminal';
      readonly value: ServiceExactInputSplitSessionOutcome;
    };

function gateServiceAction(
  session: ServiceExactInputSplitSession,
  kind: ServiceExactInputSplitActionKind,
): ServiceActionGate {
  const state = serviceStateOf(session);
  const boundary = observeServiceExactInputSplitSessionBoundary(session, kind);
  if (boundary.outcome === 'execute') return Object.freeze({ outcome: 'execute' });
  if (boundary.outcome === 'cap' && boundary.scope === 'lane') {
    return Object.freeze({ outcome: 'lane-cap' });
  }
  try {
    cleanupServiceTerminalBoundary(state, boundary);
  } catch {
    return Object.freeze({
      outcome: 'terminal',
      value: serviceStateError(state).value,
    });
  }
  if (boundary.outcome === 'cap') {
    return Object.freeze({
      outcome: 'terminal',
      value: stoppedServiceOutcome(state, 'work-limit'),
    });
  }
  if (boundary.outcome === 'interrupted') {
    return Object.freeze({
      outcome: 'terminal',
      value: stoppedServiceOutcome(state, 'interrupted'),
    });
  }
  if (boundary.outcome === 'deadline') {
    return Object.freeze({
      outcome: 'terminal',
      value: stoppedServiceOutcome(state, 'deadline'),
    });
  }
  return Object.freeze({
    outcome: 'terminal',
    value: dependencyServiceOutcome(state, boundary),
  });
}

function chargeServiceAction(
  state: ServiceSessionState,
  kind: ServiceExactInputSplitActionKind,
): void {
  state.counters.aggregateTransitions += 1;
  switch (kind) {
    case 'direct-candidate-replay':
      state.counters.directInspections += 1;
      state.counters.directReplays += 1;
      return;
    case 'path-expansion':
      state.counters.pathExpansions += 1;
      return;
    case 'best-single-candidate-replay':
      state.counters.bestSingleReplays += 1;
      return;
    case 'candidate-set-step':
      state.counters.candidateSetSteps += 1;
      return;
    case 'equal-proposal-replay':
      state.counters.equalProposalReplays += 1;
      return;
    case 'baseline-authorization-replay':
      state.counters.baselineAuthorizationReplays += 1;
      return;
    case 'greedy-option-replay':
      state.counters.greedyOptionReplays += 1;
      return;
    case 'numerical-proposal-start':
      state.counters.numericalProposals += 1;
      return;
    case 'numerical-model-route':
      state.counters.numericalModelRouteSteps += 1;
      return;
    case 'numerical-share-microstep':
      state.counters.numericalShareMicrosteps += 1;
      return;
    case 'numerical-reconstruction-step':
      state.counters.numericalReconstructionSteps += 1;
      return;
    case 'numerical-residual-option-replay':
      state.counters.numericalResidualOptionReplays += 1;
      return;
    case 'activation-probe-replay':
      state.counters.activationProbeReplays += 1;
      return;
    case 'repair-neighbor-replay':
      state.counters.repairNeighborReplays += 1;
      return;
    case 'numerical-authorization-replay':
      state.counters.numericalAuthorizationReplays += 1;
      return;
    case 'proposal-bookkeeping':
      state.proposalBookkeepingSteps += 1;
      state.counters.bookkeepingSteps += 1;
      return;
    case 'diagnostic-bookkeeping':
      state.diagnosticBookkeepingSteps += 1;
      state.counters.bookkeepingSteps += 1;
      return;
    case 'terminal-projection':
      throw new Error('Terminal projection uses its reserved aggregate charge.');
  }
}

function serviceRouteKey(route: readonly DirectionalRouteHop[]): string {
  return JSON.stringify(
    route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut]),
  );
}

function serviceCandidateSetKey(
  routes: readonly (readonly DirectionalRouteHop[])[],
): string {
  return JSON.stringify(
    routes.map((route) =>
      route.map(({ assetIn, poolId, assetOut }) => [assetIn, poolId, assetOut]),
    ),
  );
}

function serviceKeyDigest(key: string): string {
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`;
}

function createServiceCandidateFamily(
  state: ServiceSessionState,
  routes: readonly (readonly DirectionalRouteHop[])[],
): ServiceCandidateFamily {
  const capturedRoutes = Object.freeze([...routes]);
  const routeKeys = Object.freeze(capturedRoutes.map(serviceRouteKey));
  const candidateSetKey = serviceCandidateSetKey(capturedRoutes);
  return {
    routes: capturedRoutes,
    routeKeys,
    candidateSetKey,
    numerical: createServicePathShadowPriceState(
      state.request.amountIn,
      capturedRoutes.length,
    ),
    modelIndex: 0,
    modelFailed: false,
    equalStage: 'replay',
    equalScore: undefined,
    equalLegs: undefined,
    numericalStage: 'waiting',
    numericalScore: undefined,
    numericalLegs: undefined,
    residualRound: undefined,
    residualBest: undefined,
    numericalStatus: 'failed',
    numericalFailureCode: null,
    numericalCounterStart: undefined,
    numericalProposalStarted: false,
    numericalDiagnosticRetained: false,
    equalProposalReserved: false,
    numericalProposalReserved: false,
  };
}

function equalServiceLegs(
  state: ServiceSessionState,
  routes: readonly (readonly DirectionalRouteHop[])[],
): readonly ExactInputSplitReplayLegRequest[] | undefined {
  const cardinality = BigInt(routes.length);
  const base = state.request.amountIn / cardinality;
  if (base === 0n) return undefined;
  const remainder = state.request.amountIn % cardinality;
  return Object.freeze(
    routes.map((route, index) =>
      Object.freeze({
        allocation: base + (BigInt(index) < remainder ? 1n : 0n),
        route,
      }),
    ),
  );
}

function serviceProposalIsBetter(
  state: ServiceSessionState,
  score: ExactInputSplitReplayReceipt,
): boolean {
  return (
    state.incumbent === undefined ||
    isStrictlyBetterSplitReceipt(score, state.incumbent)
  );
}

function authorizeServiceProposal(
  state: ServiceSessionState,
  legs: readonly ExactInputSplitReplayLegRequest[],
  score: ExactInputSplitReplayReceipt,
  rejectionCounter:
    | 'baselineAuthorizationReplayRejections'
    | 'numericalAuthorizationReplayRejections',
): 'improved' | 'rejected' | 'mismatch' | 'not-better' {
  const replay = replayPreparedExactInputSplit(
    state.baseContext,
    fullReplayRequest(state.request, legs),
  );
  if (!replay.ok) {
    state.counters[rejectionCounter] += 1;
    return 'rejected';
  }
  const captured = captureReplayReceipt(replay.value);
  if (captured === undefined || !receiptSemanticallyEquals(captured, score)) {
    state.counters[rejectionCounter] += 1;
    return 'mismatch';
  }
  if (!serviceProposalIsBetter(state, captured)) return 'not-better';
  state.incumbent = captured;
  return 'improved';
}

type ServiceDirectStepOutcome =
  | { readonly outcome: 'continue' }
  | { readonly outcome: 'closed' }
  | { readonly outcome: 'terminal'; readonly value: ServiceExactInputSplitSessionOutcome };

function advanceServiceDirectCandidate(
  session: ServiceExactInputSplitSession,
): ServiceDirectStepOutcome {
  const state = serviceStateOf(session);
  const gate = gateServiceAction(session, 'direct-candidate-replay');
  if (gate.outcome === 'terminal') return gate;
  if (gate.outcome === 'lane-cap') {
    state.directClosed = true;
    return Object.freeze({ outcome: 'closed' });
  }

  chargeServiceAction(state, 'direct-candidate-replay');
  state.hadStructuralCandidate = true;
  let route: readonly DirectionalRouteHop[] | undefined;
  try {
    route = advancePreparedServiceDirectRoute(state.context, state.directCursor);
  } catch {
    return Object.freeze({
      outcome: 'terminal',
      value: serviceStateError(state).value,
    });
  }
  if (route === undefined) {
    return Object.freeze({
      outcome: 'terminal',
      value: serviceStateError(state).value,
    });
  }
  const replay = replayPreparedExactInputSplit(
    state.baseContext,
    fullReplayRequest(state.request, [
      Object.freeze({ allocation: state.request.amountIn, route }),
    ]),
  );
  if (!replay.ok) {
    state.counters.directReplayRejections += 1;
  } else if (
    state.incumbent === undefined ||
    isStrictlyBetterSplitReceipt(replay.value, state.incumbent)
  ) {
    state.incumbent = replay.value;
  }
  return Object.freeze({ outcome: 'continue' });
}

type ServiceSchedulerStep =
  | { readonly outcome: 'progress' }
  | { readonly outcome: 'waiting' }
  | {
      readonly outcome: 'terminal';
      readonly value: ServiceExactInputSplitSessionOutcome;
    };

function serviceStateError(
  state: ServiceSessionState,
): Extract<ServiceSchedulerStep, { readonly outcome: 'terminal' }> {
  try {
    cleanupServiceStateFailure(state);
  } catch {
    // Preserve the state-error result even if already-corrupt diagnostic state
    // cannot be projected a second time.
  }
  consumeServiceTerminalReservation(state);
  const projected = projectServiceTerminalResult(state, {
    kind: 'state-error',
  });
  return Object.freeze({
    outcome: 'terminal',
    value: Object.freeze({
      outcome: 'state-error',
      termination: 'work-limit',
      ...projected,
    }),
  });
}

function terminalSchedulerStep(
  gate: Extract<ServiceActionGate, { readonly outcome: 'terminal' }>,
): ServiceSchedulerStep {
  return Object.freeze({ outcome: 'terminal', value: gate.value });
}

function closeServicePathInput(state: ServiceSessionState): void {
  if (!state.setInputClosed) {
    closeServiceRouteDiscoveryPathInput(state.setFrontier);
    state.setInputClosed = true;
  }
}

function advanceServicePath(
  session: ServiceExactInputSplitSession,
): ServiceSchedulerStep {
  const state = serviceStateOf(session);
  if (state.pathClosed) return Object.freeze({ outcome: 'waiting' });
  if (!hasPreparedSimplePathExpansion(state.pathFrontier)) {
    state.pathClosed = true;
    closeServicePathInput(state);
    return Object.freeze({ outcome: 'progress' });
  }
  if (state.paths.length >= state.servicePolicy.maxRetainedCompletePaths) {
    state.pathClosed = true;
    state.workLimited = true;
    closeServicePathInput(state);
    return Object.freeze({ outcome: 'progress' });
  }
  const gate = gateServiceAction(session, 'path-expansion');
  if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
  if (gate.outcome === 'lane-cap') {
    state.pathClosed = true;
    closeServicePathInput(state);
    return Object.freeze({ outcome: 'progress' });
  }
  chargeServiceAction(state, 'path-expansion');
  try {
    const emitted = expandPreparedSimplePathFrontier(state.pathFrontier);
    if (emitted !== undefined) {
      state.paths.push(emitted);
      state.counters.pathsRetained += 1;
      state.hadStructuralCandidate = true;
      appendServiceRouteDiscoveryPath(state.setFrontier, emitted);
    }
    if (!hasPreparedSimplePathExpansion(state.pathFrontier)) {
      state.pathClosed = true;
      closeServicePathInput(state);
    }
  } catch {
    return serviceStateError(state);
  }
  return Object.freeze({ outcome: 'progress' });
}

function advanceServiceBestSingle(
  session: ServiceExactInputSplitSession,
): ServiceSchedulerStep {
  const state = serviceStateOf(session);
  if (state.bestClosed) return Object.freeze({ outcome: 'waiting' });
  const route = state.paths[state.bestPathIndex];
  if (route === undefined) {
    if (state.pathClosed) state.bestClosed = true;
    return Object.freeze({ outcome: 'waiting' });
  }
  const gate = gateServiceAction(session, 'best-single-candidate-replay');
  if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
  if (gate.outcome === 'lane-cap') {
    state.bestClosed = true;
    return Object.freeze({ outcome: 'progress' });
  }
  chargeServiceAction(state, 'best-single-candidate-replay');
  state.bestPathIndex += 1;
  const replay = replayPreparedExactInputSplit(
    state.baseContext,
    fullReplayRequest(state.request, [
      Object.freeze({ allocation: state.request.amountIn, route }),
    ]),
  );
  if (!replay.ok) state.counters.bestSingleReplayRejections += 1;
  else if (serviceProposalIsBetter(state, replay.value)) state.incumbent = replay.value;
  if (state.pathClosed && state.bestPathIndex >= state.paths.length) {
    state.bestClosed = true;
  }
  return Object.freeze({ outcome: 'progress' });
}

function advanceServiceCandidateSet(
  session: ServiceExactInputSplitSession,
): ServiceSchedulerStep {
  const state = serviceStateOf(session);
  if (state.setClosed) return Object.freeze({ outcome: 'waiting' });
  if (!hasServiceRouteDiscoveryStep(state.setFrontier)) {
    if (serviceRouteDiscoveryIsComplete(state.setFrontier)) state.setClosed = true;
    return Object.freeze({ outcome: 'waiting' });
  }
  if (state.families.length >= state.servicePolicy.maxRetainedCandidateSets) {
    state.setClosed = true;
    state.workLimited = true;
    return Object.freeze({ outcome: 'progress' });
  }
  const gate = gateServiceAction(session, 'candidate-set-step');
  if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
  if (gate.outcome === 'lane-cap') {
    state.setClosed = true;
    return Object.freeze({ outcome: 'progress' });
  }
  chargeServiceAction(state, 'candidate-set-step');
  try {
    const advanced = advanceServiceRouteDiscoveryFrontier(state.setFrontier);
    if (advanced.emitted) {
      const family = createServiceCandidateFamily(
        state,
        advanced.candidateSet.routes,
      );
      state.families.push(family);
      const equalEligible =
        state.request.amountIn / BigInt(family.routes.length) > 0n;
      if (equalEligible) {
        if (!state.equalLaneClosed) state.equalFamilies.push(family);
        else if (state.equalLaneCapClosed) state.workLimited = true;
      }
      if (state.request.amountIn >= 2n) {
        if (!state.numericalLaneClosed) state.numericalFamilies.push(family);
        else if (state.numericalLaneCapClosed) state.workLimited = true;
      }
      state.counters.candidateSetsRetained += 1;
    }
    if (serviceRouteDiscoveryIsComplete(state.setFrontier)) state.setClosed = true;
  } catch {
    return serviceStateError(state);
  }
  return Object.freeze({ outcome: 'progress' });
}

function hasServiceProposalCapacity(state: ServiceSessionState): boolean {
  return (
    state.proposals.size + state.reservedProposalSlots <
    state.servicePolicy.maxRetainedProposalRecords
  );
}

function reserveServiceProposal(state: ServiceSessionState): boolean {
  if (!hasServiceProposalCapacity(state)) return false;
  state.reservedProposalSlots += 1;
  return true;
}

function releaseServiceProposal(state: ServiceSessionState): void {
  if (state.reservedProposalSlots <= 0) {
    throw new Error('Service proposal reservation underflow.');
  }
  state.reservedProposalSlots -= 1;
}

function retainServiceProposal(
  state: ServiceSessionState,
  score: ExactInputSplitReplayReceipt,
  legs: readonly ExactInputSplitReplayLegRequest[],
): void {
  releaseServiceProposal(state);
  const key = proposalKey(legs);
  if (!state.proposals.has(key)) {
    state.proposals.set(key, Object.freeze({ key, receipt: score, legs }));
    state.counters.proposalsRetained += 1;
  }
}

function numericalFailureCode(
  family: ServiceCandidateFamily,
): ServiceExactInputSplitNumericalFailureCode | null {
  return servicePathShadowPriceFailure(family.numerical)?.code ?? null;
}

function numericalCounterDelta(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
) {
  const start = family.numericalCounterStart ?? freshServiceCounters();
  const counters = state.counters;
  return Object.freeze({
    modelRouteSteps:
      counters.numericalModelRouteSteps - start.numericalModelRouteSteps,
    outerUpdatesStarted:
      counters.numericalOuterUpdatesStarted - start.numericalOuterUpdatesStarted,
    outerUpdatesCompleted:
      counters.numericalOuterUpdatesCompleted - start.numericalOuterUpdatesCompleted,
    shareMicrosteps:
      counters.numericalShareMicrosteps - start.numericalShareMicrosteps,
    reconstructionSteps:
      counters.numericalReconstructionSteps - start.numericalReconstructionSteps,
    residualOptionReplays:
      counters.numericalResidualOptionReplays -
      start.numericalResidualOptionReplays,
    residualOptionReplayRejections:
      counters.numericalResidualOptionReplayRejections -
      start.numericalResidualOptionReplayRejections,
    authorizationReplays:
      counters.numericalAuthorizationReplays - start.numericalAuthorizationReplays,
    authorizationReplayRejections:
      counters.numericalAuthorizationReplayRejections -
      start.numericalAuthorizationReplayRejections,
  });
}

function retainServiceNumericalDiagnostic(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
  tolerateNumericalStateFailure = false,
): void {
  if (family.numericalDiagnosticRetained) return;
  if (state.numericalDiagnostics.length >= state.servicePolicy.maxNumericalDiagnostics) {
    throw new Error('Reserved service numerical diagnostic capacity was lost.');
  }
  let failure: ReturnType<typeof servicePathShadowPriceFailure>;
  let converged = false;
  let residualUnits: bigint | null = null;
  try {
    failure = servicePathShadowPriceFailure(family.numerical);
    converged =
      failure?.converged ??
      servicePathShadowPriceReadyWeights(family.numerical) !== undefined;
    residualUnits =
      servicePathShadowPriceInitialResidualUnits(family.numerical) ?? null;
  } catch (error) {
    if (!tolerateNumericalStateFailure) throw error;
    failure = undefined;
  }
  const diagnostic: ServiceExactInputSplitNumericalDiagnostic = Object.freeze({
    candidateSetKeyDigest: serviceKeyDigest(family.candidateSetKey),
    routeKeyDigests: Object.freeze(family.routeKeys.map(serviceKeyDigest)),
    status: family.numericalStatus,
    failureCode: family.numericalFailureCode ?? failure?.code ?? null,
    converged,
    residualUnits,
    counters: numericalCounterDelta(state, family),
  });
  const diagnosticIndex = state.numericalDiagnostics.length;
  state.numericalDiagnostics.push(diagnostic);
  family.numericalDiagnosticRetained = true;
  if (state.strictFamily === family) {
    state.strictPipeline = 'complete';
    state.strictFamily = undefined;
  }
  state.counters.diagnosticsRetained += 1;
  if (!state.control.debug || state.debugTruncated) return;
  const keysFit =
    Buffer.byteLength(family.candidateSetKey, 'utf8') <=
      state.servicePolicy.maxOptionalKeyBytes &&
    family.routeKeys.every(
      (key) =>
        Buffer.byteLength(key, 'utf8') <= state.servicePolicy.maxOptionalKeyBytes,
    );
  const fragment = Object.freeze({
    diagnosticIndex,
    candidateSetKey: family.candidateSetKey,
    routeKeys: family.routeKeys,
  });
  const prospectiveFragments = Object.freeze([
    ...state.debugFragments,
    fragment,
  ]);
  const prospectiveBytes = Buffer.byteLength(
    JSON.stringify({ truncated: false, fragments: prospectiveFragments }),
    'utf8',
  );
  if (
    !keysFit ||
    prospectiveBytes > state.servicePolicy.maxDebugProjectionBytes
  ) {
    state.debugTruncated = true;
    return;
  }
  state.debugFragments.push(fragment);
  state.debugBytes = prospectiveBytes;
}

function setNumericalFailure(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
  code?: ServiceExactInputSplitNumericalFailureCode,
): void {
  if (family.numericalProposalReserved) {
    releaseServiceProposal(state);
    family.numericalProposalReserved = false;
  }
  state.counters.numericalProposalFailures += 1;
  family.numericalStatus = 'failed';
  family.numericalFailureCode = code ?? numericalFailureCode(family);
  family.numericalStage = 'diagnostic';
}

function releaseFamilyProposalReservations(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
): void {
  if (family.equalProposalReserved) {
    releaseServiceProposal(state);
    family.equalProposalReserved = false;
    family.equalStage = 'done';
  }
  if (family.numericalProposalReserved) {
    releaseServiceProposal(state);
    family.numericalProposalReserved = false;
  }
}

function activeServiceFamily(
  state: ServiceSessionState,
): ServiceCandidateFamily | undefined {
  return state.strictFamily ?? state.numericalFamilies[state.familyIndex];
}

function activeServiceEqualFamily(
  state: ServiceSessionState,
): ServiceCandidateFamily | undefined {
  return state.equalFamilies[state.equalFamilyIndex];
}

function retainActiveNumericalStop(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
  status: 'failed' | 'stopped',
  failureCode: ServiceExactInputSplitNumericalFailureCode,
): void {
  releaseFamilyProposalReservations(state, family);
  if (!family.numericalProposalStarted || family.numericalDiagnosticRetained) {
    return;
  }
  const semanticOutcomeKnown = family.numericalStage === 'diagnostic';
  if (!semanticOutcomeKnown) {
    if (status === 'failed') state.counters.numericalProposalFailures += 1;
    family.numericalStatus = status;
    family.numericalFailureCode = failureCode;
  }
  family.numericalStage = 'done';
  retainServiceNumericalDiagnostic(
    state,
    family,
    status === 'failed' && !semanticOutcomeKnown,
  );
}

function cleanupServiceStateFailure(state: ServiceSessionState): void {
  const family = activeServiceFamily(state);
  if (family !== undefined) {
    retainActiveNumericalStop(
      state,
      family,
      'failed',
      'service-session-state-failed',
    );
  }
  const equalFamily = activeServiceEqualFamily(state);
  if (equalFamily !== undefined && equalFamily !== family) {
    releaseFamilyProposalReservations(state, equalFamily);
  }
  const greedy = state.greedy;
  if (greedy?.proposalReserved) {
    releaseServiceProposal(state);
    greedy.proposalReserved = false;
  }
}

function serviceBoundaryFailureCode(
  boundary: Exclude<
    ServiceExactInputSplitSessionBoundary,
    { readonly outcome: 'execute' }
  >,
): ServiceExactInputSplitNumericalFailureCode {
  if (boundary.outcome === 'cap') return 'work-limit';
  if (boundary.outcome === 'deadline') return 'deadline';
  if (boundary.outcome === 'interrupted') return 'interrupted';
  return boundary.code;
}

function cleanupServiceTerminalBoundary(
  state: ServiceSessionState,
  boundary: Exclude<
    ServiceExactInputSplitSessionBoundary,
    { readonly outcome: 'execute' }
  >,
): void {
  const family = activeServiceFamily(state);
  if (family !== undefined) {
    releaseFamilyProposalReservations(state, family);
    if (
      family.numericalProposalStarted &&
      !family.numericalDiagnosticRetained
    ) {
      if (family.numericalStage !== 'diagnostic') {
        family.numericalStatus = 'stopped';
        family.numericalFailureCode = serviceBoundaryFailureCode(boundary);
      }
      family.numericalStage = 'done';
      retainServiceNumericalDiagnostic(state, family);
    }
  }
  const equalFamily = activeServiceEqualFamily(state);
  if (equalFamily !== undefined && equalFamily !== family) {
    releaseFamilyProposalReservations(state, equalFamily);
  }
  const greedy = state.greedy;
  if (greedy?.proposalReserved) {
    releaseServiceProposal(state);
    greedy.proposalReserved = false;
  }
}

function advanceServiceFamilyModelRoute(
  session: ServiceExactInputSplitSession,
  family: ServiceCandidateFamily,
): ServiceSchedulerStep {
  const state = serviceStateOf(session);
  const gate = gateServiceAction(session, 'numerical-model-route');
  if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
  if (gate.outcome === 'lane-cap') {
    family.modelFailed = true;
    family.numericalStage = 'done';
    return Object.freeze({ outcome: 'progress' });
  }
  chargeServiceAction(state, 'numerical-model-route');
  const route = family.routes[family.modelIndex];
  if (route === undefined) return serviceStateError(state);
  try {
    const resolved = resolvePreparedPathShadowPriceRoute(state.baseContext, route);
    if (!resolved.ok) {
      family.modelFailed = true;
      family.numericalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    const modeled = appendServicePathShadowPriceModelRoute(
      family.numerical,
      resolved.value,
    );
    family.modelIndex += 1;
    if (!modeled.ok) {
      family.modelFailed = true;
      family.numericalStage = 'done';
    }
  } catch {
    return serviceStateError(state);
  }
  return Object.freeze({ outcome: 'progress' });
}

function advanceServiceFamily(
  session: ServiceExactInputSplitSession,
  family: ServiceCandidateFamily,
  exactProducersClosed: boolean,
  lane: 'strict' | 'equal' | 'numerical',
): ServiceSchedulerStep {
  const state = serviceStateOf(session);
  if (lane !== 'equal' && family.numericalCounterStart === undefined) {
    family.numericalCounterStart = serviceExactInputSplitSessionCountersFromState(state);
  }

  if (
    lane !== 'equal' &&
    state.request.amountIn < 2n &&
    !family.modelFailed
  ) {
    family.modelFailed = true;
    family.numericalStage = 'done';
  }

  if (
    lane === 'strict' &&
    !family.modelFailed &&
    family.modelIndex < family.routes.length &&
    state.incumbent !== undefined
  ) {
    return advanceServiceFamilyModelRoute(session, family);
  }

  if (lane !== 'numerical' && family.equalStage === 'replay') {
    const legs = equalServiceLegs(state, family.routes);
    if (legs === undefined) {
      family.equalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    if (!hasServiceProposalCapacity(state)) {
      if (state.reservedProposalSlots > 0) {
        return Object.freeze({ outcome: 'waiting' });
      }
      state.workLimited = true;
      family.equalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    const gate = gateServiceAction(session, 'equal-proposal-replay');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      family.equalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    if (!reserveServiceProposal(state)) return serviceStateError(state);
    family.equalProposalReserved = true;
    chargeServiceAction(state, 'equal-proposal-replay');
    const replay = replayPreparedExactInputSplit(
      state.baseContext,
      fullReplayRequest(state.request, legs),
    );
    if (!replay.ok) {
      state.counters.equalProposalReplayRejections += 1;
      releaseServiceProposal(state);
      family.equalProposalReserved = false;
      family.equalStage = 'done';
    } else {
      family.equalScore = replay.value;
      family.equalLegs = legs;
      family.equalStage = 'bookkeeping';
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (lane !== 'numerical' && family.equalStage === 'bookkeeping') {
    const gate = gateServiceAction(session, 'proposal-bookkeeping');
    if (gate.outcome === 'terminal') {
      if (family.equalProposalReserved) {
        releaseServiceProposal(state);
        family.equalProposalReserved = false;
      }
      return terminalSchedulerStep(gate);
    }
    if (gate.outcome === 'lane-cap') {
      if (family.equalProposalReserved) {
        releaseServiceProposal(state);
        family.equalProposalReserved = false;
      }
      family.equalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'proposal-bookkeeping');
    const score = family.equalScore;
    const legs = family.equalLegs;
    if (
      score === undefined ||
      legs === undefined ||
      !family.equalProposalReserved
    ) {
      return serviceStateError(state);
    }
    retainServiceProposal(state, score, legs);
    family.equalProposalReserved = false;
    family.equalStage = serviceProposalIsBetter(state, score)
      ? 'authorization'
      : 'done';
    return Object.freeze({ outcome: 'progress' });
  }

  if (lane !== 'numerical' && family.equalStage === 'authorization') {
    const score = family.equalScore;
    const legs = family.equalLegs;
    if (score === undefined || legs === undefined) return serviceStateError(state);
    if (!serviceProposalIsBetter(state, score)) {
      family.equalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    const gate = gateServiceAction(session, 'baseline-authorization-replay');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      family.equalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'baseline-authorization-replay');
    authorizeServiceProposal(
      state,
      legs,
      score,
      'baselineAuthorizationReplayRejections',
    );
    family.equalStage = 'done';
    return Object.freeze({ outcome: 'progress' });
  }

  if (lane === 'equal') return Object.freeze({ outcome: 'waiting' });

  if (
    lane === 'numerical' &&
    !family.modelFailed &&
    family.modelIndex < family.routes.length &&
    state.incumbent !== undefined
  ) {
    return advanceServiceFamilyModelRoute(session, family);
  }

  if (family.numericalStage === 'waiting') {
    if (family.modelFailed) {
      family.numericalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    if (state.incumbent === undefined) {
      if (exactProducersClosed) family.numericalStage = 'done';
      return Object.freeze({ outcome: exactProducersClosed ? 'progress' : 'waiting' });
    }
    family.numericalStage = 'start';
  }

  if (family.numericalStage === 'start') {
    if (
      state.numericalDiagnostics.length >= state.servicePolicy.maxNumericalDiagnostics ||
      !hasServiceProposalCapacity(state)
    ) {
      if (
        state.numericalDiagnostics.length <
          state.servicePolicy.maxNumericalDiagnostics &&
        state.reservedProposalSlots > 0
      ) {
        return Object.freeze({ outcome: 'waiting' });
      }
      state.workLimited = true;
      family.numericalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    const gate = gateServiceAction(session, 'numerical-proposal-start');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      family.numericalStage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    if (!reserveServiceProposal(state)) return serviceStateError(state);
    family.numericalProposalReserved = true;
    chargeServiceAction(state, 'numerical-proposal-start');
    family.numericalProposalStarted = true;
    try {
      const started = startServicePathShadowPriceProposal(family.numerical);
      if (!started.ok) setNumericalFailure(state, family);
      else family.numericalStage = 'share';
    } catch {
      return serviceStateError(state);
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (family.numericalStage === 'share') {
    const gate = gateServiceAction(session, 'numerical-share-microstep');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      if (family.numericalProposalReserved) {
        releaseServiceProposal(state);
        family.numericalProposalReserved = false;
      }
      family.numericalStatus = 'stopped';
      family.numericalFailureCode = 'work-limit';
      family.numericalStage = 'diagnostic';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'numerical-share-microstep');
    try {
      const before = servicePathShadowPriceProgress(family.numerical);
      const advanced = advanceServicePathShadowPriceShareMicrostep(
        family.numerical,
      );
      const after = servicePathShadowPriceProgress(family.numerical);
      state.counters.numericalOuterUpdatesStarted +=
        after.outerUpdatesStarted - before.outerUpdatesStarted;
      state.counters.numericalOuterUpdatesCompleted +=
        after.outerUpdatesCompleted - before.outerUpdatesCompleted;
      if (advanced.ok) {
        if (after.phase === 'reconstruction-step') {
          family.numericalStage = 'reconstruction';
        }
      } else {
        setNumericalFailure(state, family, advanced.error.code);
      }
    } catch {
      return serviceStateError(state);
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (family.numericalStage === 'reconstruction') {
    const gate = gateServiceAction(session, 'numerical-reconstruction-step');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      if (family.numericalProposalReserved) {
        releaseServiceProposal(state);
        family.numericalProposalReserved = false;
      }
      family.numericalStatus = 'stopped';
      family.numericalFailureCode = 'work-limit';
      family.numericalStage = 'diagnostic';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'numerical-reconstruction-step');
    try {
      const advanced = advanceServicePathShadowPriceReconstructionStep(
        family.numerical,
      );
      if (!advanced.ok) setNumericalFailure(state, family, advanced.error.code);
      else if (
        servicePathShadowPriceProgress(family.numerical).phase ===
        'residual-option'
      ) {
        family.numericalStage = 'residual';
      }
    } catch {
      return serviceStateError(state);
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (family.numericalStage === 'residual') {
    const gate = gateServiceAction(session, 'numerical-residual-option-replay');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      if (family.numericalProposalReserved) {
        releaseServiceProposal(state);
        family.numericalProposalReserved = false;
      }
      family.numericalStatus = 'stopped';
      family.numericalFailureCode = 'work-limit';
      family.numericalStage = 'diagnostic';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'numerical-residual-option-replay');
    let option;
    try {
      option = servicePathShadowPriceResidualOption(family.numerical);
    } catch {
      return serviceStateError(state);
    }
    if (family.residualRound !== option.residualUnitsRemaining) {
      family.residualRound = option.residualUnitsRemaining;
      family.residualBest = undefined;
    }
    const legs = positiveExactInputSplitSessionLegs(
      family.routes,
      option.allocations,
    );
    const replay = replayPreparedExactInputSplit(
      state.baseContext,
      partialReplayRequest(state.request, legs),
    );
    let residualOutcome: 'rejected' | 'valid-not-best' | 'valid-best';
    if (!replay.ok) {
      state.counters.numericalResidualOptionReplayRejections += 1;
      residualOutcome = 'rejected';
    } else if (
      family.residualBest === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, family.residualBest)
    ) {
      family.residualBest = replay.value;
      residualOutcome = 'valid-best';
    } else {
      residualOutcome = 'valid-not-best';
    }
    try {
      const settled = settleServicePathShadowPriceResidualOption(
        family.numerical,
        residualOutcome,
      );
      if (!settled.ok) {
        setNumericalFailure(state, family, settled.error.code);
        return Object.freeze({ outcome: 'progress' });
      }
      if (
        servicePathShadowPriceProgress(family.numerical).phase === 'score-ready'
      ) {
        const allocations = servicePathShadowPriceScoreAllocations(
          family.numerical,
        );
        if (allocations === undefined || family.residualBest === undefined) {
          return serviceStateError(state);
        }
        family.numericalLegs = positiveExactInputSplitSessionLegs(
          family.routes,
          allocations,
        );
        family.numericalScore = family.residualBest;
        family.numericalStage = 'bookkeeping';
      }
    } catch {
      return serviceStateError(state);
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (family.numericalStage === 'bookkeeping') {
    const gate = gateServiceAction(session, 'proposal-bookkeeping');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      if (family.numericalProposalReserved) {
        releaseServiceProposal(state);
        family.numericalProposalReserved = false;
      }
      family.numericalStatus = 'stopped';
      family.numericalFailureCode = 'work-limit';
      family.numericalStage = 'diagnostic';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'proposal-bookkeeping');
    const score = family.numericalScore;
    const legs = family.numericalLegs;
    if (
      score === undefined ||
      legs === undefined ||
      !family.numericalProposalReserved
    ) {
      return serviceStateError(state);
    }
    retainServiceProposal(state, score, legs);
    family.numericalProposalReserved = false;
    if (serviceProposalIsBetter(state, score)) {
      family.numericalStage = 'authorization';
    } else {
      family.numericalStatus = 'not-better';
      family.numericalStage = 'diagnostic';
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (family.numericalStage === 'authorization') {
    const score = family.numericalScore;
    const legs = family.numericalLegs;
    if (score === undefined || legs === undefined) return serviceStateError(state);
    if (!serviceProposalIsBetter(state, score)) {
      family.numericalStatus = 'not-better';
      family.numericalFailureCode = null;
      family.numericalStage = 'diagnostic';
      return Object.freeze({ outcome: 'progress' });
    }
    const gate = gateServiceAction(session, 'numerical-authorization-replay');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      family.numericalStatus = 'stopped';
      family.numericalFailureCode = 'work-limit';
      family.numericalStage = 'diagnostic';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'numerical-authorization-replay');
    let outcome;
    try {
      outcome = authorizeServiceProposal(
        state,
        legs,
        score,
        'numericalAuthorizationReplayRejections',
      );
    } catch {
      return serviceStateError(state);
    }
    if (outcome === 'improved') {
      family.numericalStatus = 'improved';
      family.numericalFailureCode = null;
    } else if (outcome === 'not-better') {
      family.numericalStatus = 'not-better';
      family.numericalFailureCode = null;
    } else {
      family.numericalStatus = 'failed';
      family.numericalFailureCode =
        outcome === 'rejected' ? 'authorization-rejected' : 'authorization-mismatch';
      state.counters.numericalProposalFailures += 1;
    }
    family.numericalStage = 'diagnostic';
    return Object.freeze({ outcome: 'progress' });
  }

  if (family.numericalStage === 'diagnostic') {
    const gate = gateServiceAction(session, 'diagnostic-bookkeeping');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') return serviceStateError(state);
    chargeServiceAction(state, 'diagnostic-bookkeeping');
    try {
      retainServiceNumericalDiagnostic(state, family);
    } catch {
      return serviceStateError(state);
    }
    family.numericalStage = 'done';
    return Object.freeze({ outcome: 'progress' });
  }

  return Object.freeze({ outcome: 'waiting' });
}

function createServiceGreedyState(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
): ServiceGreedyState {
  const divisor = BigInt(state.request.greedyParts);
  return {
    family,
    allocations: family.routes.map(() => 0n),
    chunkBase: state.request.amountIn / divisor,
    chunkRemainder: state.request.amountIn % divisor,
    chunkIndex: 0,
    routeIndex: 0,
    winningIndex: undefined,
    winningReceipt: undefined,
    finalScore: undefined,
    finalLegs: undefined,
    stage: 'option',
    proposalReserved: false,
  };
}

function advanceServiceGreedy(
  session: ServiceExactInputSplitSession,
): ServiceSchedulerStep {
  const state = serviceStateOf(session);
  let greedy = state.greedy;
  if (greedy === undefined) {
    const family = state.families[state.greedyFamilyIndex];
    if (family === undefined) return Object.freeze({ outcome: 'waiting' });
    greedy = createServiceGreedyState(state, family);
    state.greedy = greedy;
  }

  if (greedy.stage === 'option') {
    if (!greedy.proposalReserved && !hasServiceProposalCapacity(state)) {
      state.workLimited = true;
      state.greedyFamilyIndex = state.families.length;
      state.greedy = undefined;
      return Object.freeze({ outcome: 'progress' });
    }
    const chunkIndex = BigInt(greedy.chunkIndex);
    const chunk =
      greedy.chunkBase === 0n
        ? chunkIndex < greedy.chunkRemainder
          ? 1n
          : undefined
        : greedy.chunkBase + (chunkIndex < greedy.chunkRemainder ? 1n : 0n);
    const route = greedy.family.routes[greedy.routeIndex];
    if (chunk === undefined || route === undefined) return serviceStateError(state);
    const gate = gateServiceAction(session, 'greedy-option-replay');
    if (gate.outcome === 'terminal') {
      if (greedy.proposalReserved) {
        releaseServiceProposal(state);
        greedy.proposalReserved = false;
      }
      return terminalSchedulerStep(gate);
    }
    if (gate.outcome === 'lane-cap') {
      if (greedy.proposalReserved) {
        releaseServiceProposal(state);
        greedy.proposalReserved = false;
      }
      state.greedyFamilyIndex = state.families.length;
      state.greedy = undefined;
      return Object.freeze({ outcome: 'progress' });
    }
    if (!greedy.proposalReserved) {
      if (!reserveServiceProposal(state)) return serviceStateError(state);
      greedy.proposalReserved = true;
    }
    chargeServiceAction(state, 'greedy-option-replay');
    if (greedy.routeIndex === 0) state.counters.greedyPartsStarted += 1;
    const optionAllocations = [...greedy.allocations];
    optionAllocations[greedy.routeIndex] =
      optionAllocations[greedy.routeIndex]! + chunk;
    const replay = replayPreparedExactInputSplit(
      state.baseContext,
      partialReplayRequest(
        state.request,
        positiveExactInputSplitSessionLegs(greedy.family.routes, optionAllocations),
      ),
    );
    if (!replay.ok) {
      state.counters.greedyOptionReplayRejections += 1;
    } else if (
      greedy.winningReceipt === undefined ||
      replay.value.amountOut > greedy.winningReceipt.amountOut
    ) {
      greedy.winningIndex = greedy.routeIndex;
      greedy.winningReceipt = replay.value;
    }
    greedy.routeIndex += 1;
    if (greedy.routeIndex < greedy.family.routes.length) {
      return Object.freeze({ outcome: 'progress' });
    }
    if (greedy.winningIndex === undefined || greedy.winningReceipt === undefined) {
      if (greedy.proposalReserved) {
        releaseServiceProposal(state);
        greedy.proposalReserved = false;
      }
      greedy.stage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    greedy.allocations[greedy.winningIndex] =
      greedy.allocations[greedy.winningIndex]! + chunk;
    greedy.finalScore = greedy.winningReceipt;
    greedy.chunkIndex += 1;
    greedy.routeIndex = 0;
    greedy.winningIndex = undefined;
    greedy.winningReceipt = undefined;
    if (
      (greedy.chunkBase === 0n &&
        BigInt(greedy.chunkIndex) === greedy.chunkRemainder) ||
      (greedy.chunkBase !== 0n &&
        greedy.chunkIndex === state.request.greedyParts)
    ) {
      greedy.finalLegs = positiveExactInputSplitSessionLegs(
        greedy.family.routes,
        greedy.allocations,
      );
      greedy.stage = 'bookkeeping';
    }
    return Object.freeze({ outcome: 'progress' });
  }

  if (greedy.stage === 'bookkeeping') {
    const gate = gateServiceAction(session, 'proposal-bookkeeping');
    if (gate.outcome === 'terminal') {
      if (greedy.proposalReserved) {
        releaseServiceProposal(state);
        greedy.proposalReserved = false;
      }
      return terminalSchedulerStep(gate);
    }
    if (gate.outcome === 'lane-cap') {
      if (greedy.proposalReserved) {
        releaseServiceProposal(state);
        greedy.proposalReserved = false;
      }
      greedy.stage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'proposal-bookkeeping');
    if (
      greedy.finalScore === undefined ||
      greedy.finalLegs === undefined ||
      !greedy.proposalReserved
    ) {
      return serviceStateError(state);
    }
    retainServiceProposal(state, greedy.finalScore, greedy.finalLegs);
    greedy.proposalReserved = false;
    greedy.stage = serviceProposalIsBetter(state, greedy.finalScore)
      ? 'authorization'
      : 'done';
    return Object.freeze({ outcome: 'progress' });
  }

  if (greedy.stage === 'authorization') {
    if (greedy.finalScore === undefined || greedy.finalLegs === undefined) {
      return serviceStateError(state);
    }
    if (!serviceProposalIsBetter(state, greedy.finalScore)) {
      greedy.stage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    const gate = gateServiceAction(session, 'baseline-authorization-replay');
    if (gate.outcome === 'terminal') return terminalSchedulerStep(gate);
    if (gate.outcome === 'lane-cap') {
      greedy.stage = 'done';
      return Object.freeze({ outcome: 'progress' });
    }
    chargeServiceAction(state, 'baseline-authorization-replay');
    authorizeServiceProposal(
      state,
      greedy.finalLegs,
      greedy.finalScore,
      'baselineAuthorizationReplayRejections',
    );
    greedy.stage = 'done';
    return Object.freeze({ outcome: 'progress' });
  }

  if (greedy.proposalReserved) {
    releaseServiceProposal(state);
    greedy.proposalReserved = false;
  }
  state.greedy = undefined;
  state.greedyFamilyIndex += 1;
  return Object.freeze({ outcome: 'progress' });
}

function familyNaturallyDone(family: ServiceCandidateFamily): boolean {
  return family.equalStage === 'done' && family.numericalStage === 'done';
}

function activateStrictServiceFamily(state: ServiceSessionState): boolean {
  if (
    state.strictPipeline !== 'pending' ||
    state.incumbent === undefined
  ) {
    return state.strictPipeline === 'active';
  }
  const family = state.numericalFamilies[state.familyIndex];
  if (family === undefined) return false;
  state.strictPipeline = 'active';
  state.strictFamily = family;
  return true;
}

function strictServicePipelineComplete(state: ServiceSessionState): boolean {
  return state.strictPipeline === 'complete';
}

function advanceCompletedServiceEqualHead(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
): void {
  if (
    state.equalFamilies[state.equalFamilyIndex] === family &&
    family.equalStage === 'done'
  ) {
    state.equalFamilyIndex += 1;
  }
}

function advanceCompletedServiceNumericalHead(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
): void {
  if (
    state.numericalFamilies[state.familyIndex] === family &&
    family.numericalStage === 'done'
  ) {
    state.familyIndex += 1;
  }
}

function advanceCompletedStrictServiceFamily(
  state: ServiceSessionState,
  family: ServiceCandidateFamily,
): void {
  advanceCompletedServiceEqualHead(state, family);
  advanceCompletedServiceNumericalHead(state, family);
  if (state.strictFamily === family && familyNaturallyDone(family)) {
    state.strictFamily = undefined;
    state.strictPipeline = family.numericalDiagnosticRetained
      ? 'complete'
      : 'pending';
  }
}

function closeUnavailableServiceLanes(state: ServiceSessionState): boolean {
  if (state.strictPipeline === 'active') return false;
  let closed = false;
  const equalFamily = state.equalFamilies[state.equalFamilyIndex];
  const equalInFlight =
    equalFamily !== undefined && equalFamily.equalStage !== 'replay';
  const equalCapped =
    state.counters.equalProposalReplays >=
      state.servicePolicy.maxEqualProposalReplays ||
    state.proposals.size >= state.servicePolicy.maxRetainedProposalRecords;
  if (!state.equalLaneClosed && !equalInFlight && equalCapped) {
    state.equalLaneClosed = true;
    state.equalLaneCapClosed = true;
    state.equalFamilyIndex = state.equalFamilies.length;
    closed = true;
    if (equalFamily !== undefined) state.workLimited = true;
  }
  const numericalFamily = state.numericalFamilies[state.familyIndex];
  const numericalInFlight =
    numericalFamily?.numericalProposalStarted === true &&
    !numericalFamily.numericalDiagnosticRetained;
  const numericalModelReady =
    numericalFamily !== undefined &&
    !numericalFamily.modelFailed &&
    numericalFamily.modelIndex === numericalFamily.routes.length &&
    numericalFamily.numericalStage === 'waiting';
  const numericalCapped =
    (!numericalModelReady &&
      state.counters.numericalModelRouteSteps >=
        state.servicePolicy.maxNumericalModelRouteSteps) ||
    (!numericalInFlight &&
      (state.counters.numericalProposals >=
        state.servicePolicy.maxNumericalProposals ||
        state.numericalDiagnostics.length >=
          state.servicePolicy.maxNumericalDiagnostics ||
        state.proposals.size >=
          state.servicePolicy.maxRetainedProposalRecords));
  const numericalNaturallyUnavailable =
    state.incumbent === undefined && serviceExactProducersClosed(state);
  if (
    !state.numericalLaneClosed &&
    !numericalInFlight &&
    (numericalCapped || numericalNaturallyUnavailable)
  ) {
    state.numericalLaneClosed = true;
    state.numericalLaneCapClosed = numericalCapped;
    state.familyIndex = state.numericalFamilies.length;
    closed = true;
    if (state.strictPipeline === 'pending') {
      state.strictPipeline = 'complete';
    }
    if (numericalCapped && numericalFamily !== undefined) {
      state.workLimited = true;
    }
  }
  return closed;
}

function serviceExactProducersClosed(state: ServiceSessionState): boolean {
  return (
    state.directClosed &&
    state.pathClosed &&
    state.bestClosed &&
    state.setClosed &&
    (state.equalLaneClosed ||
      state.equalFamilyIndex >= state.equalFamilies.length)
  );
}

function finalizeServiceSession(
  session: ServiceExactInputSplitSession,
): ServiceExactInputSplitSessionOutcome {
  const state = serviceStateOf(session);
  if (state.reservedProposalSlots !== 0) {
    return serviceStateError(state).value;
  }
  if (state.workLimited) {
    return stoppedServiceOutcome(state, 'work-limit');
  }
  const gate = gateServiceAction(session, 'terminal-projection');
  if (gate.outcome === 'terminal') return gate.value;
  if (gate.outcome === 'lane-cap' || !consumeServiceTerminalReservation(state)) {
    return serviceStateError(state).value;
  }
  const noRouteReason = state.hadStructuralCandidate
    ? 'all-exact-replays-rejected'
    : 'no-structural-candidate';
  const projected = projectServiceTerminalResult(state, {
    kind: 'complete',
    noRouteReason,
  });
  return Object.freeze({
    outcome: 'complete',
    termination: 'complete',
    noRouteReason: state.incumbent === undefined ? noRouteReason : null,
    ...projected,
  });
}

function runServiceExactInputSplitServicePolicyUnchecked(
  session: ServiceExactInputSplitSession,
): ServiceExactInputSplitSessionOutcome {
  const state = serviceStateOf(session);
  if (state.ran) {
    return serviceStateError(state).value;
  }
  state.ran = true;

  let trancheActions = 0;
  while (
    trancheActions < state.servicePolicy.initialDirectTranche &&
    state.incumbent === undefined &&
    hasPreparedServiceDirectRoute(state.context, state.directCursor)
  ) {
    const step = advanceServiceDirectCandidate(session);
    if (step.outcome === 'terminal') return step.value;
    if (step.outcome === 'closed') break;
    trancheActions += 1;
  }
  if (!hasPreparedServiceDirectRoute(state.context, state.directCursor)) {
    state.directClosed = true;
  }

  let bootstrapGuard = 0;
  while (!strictServicePipelineComplete(state)) {
    bootstrapGuard += 1;
    if (bootstrapGuard > state.servicePolicy.maxAggregateTransitions) {
      return serviceStateError(state).value;
    }
    closeUnavailableServiceLanes(state);
    if (strictServicePipelineComplete(state)) break;
    activateStrictServiceFamily(state);
    const family = state.strictFamily;
    if (state.strictPipeline === 'active') {
      if (family === undefined) return serviceStateError(state).value;
      const familyStep = advanceServiceFamily(
        session,
        family,
        serviceExactProducersClosed(state),
        'strict',
      );
      if (familyStep.outcome === 'terminal') return familyStep.value;
      if (familyStep.outcome === 'progress') {
        advanceCompletedStrictServiceFamily(state, family);
        continue;
      }
      return serviceStateError(state).value;
    }

    let producerProgress = false;
    const best = advanceServiceBestSingle(session);
    if (best.outcome === 'terminal') return best.value;
    producerProgress ||= best.outcome === 'progress';
    if (activateStrictServiceFamily(state)) continue;
    const set = advanceServiceCandidateSet(session);
    if (set.outcome === 'terminal') return set.value;
    producerProgress ||= set.outcome === 'progress';
    if (activateStrictServiceFamily(state)) continue;
    const path = advanceServicePath(session);
    if (path.outcome === 'terminal') return path.value;
    producerProgress ||= path.outcome === 'progress';
    closeUnavailableServiceLanes(state);
    if (
      state.incumbent === undefined &&
      state.numericalFamilies[state.familyIndex] !== undefined
    ) {
      break;
    }

    if (!producerProgress) {
      if (state.pathClosed && state.bestClosed && state.setClosed) {
        break;
      }
      return serviceStateError(state).value;
    }
  }

  let refinementGuard = 0;
  while (true) {
    refinementGuard += 1;
    if (refinementGuard > state.servicePolicy.maxAggregateTransitions) {
      return serviceStateError(state).value;
    }
    let progressed = false;

    if (activateStrictServiceFamily(state)) {
      const family = state.strictFamily;
      if (family === undefined) return serviceStateError(state).value;
      const familyStep = advanceServiceFamily(
        session,
        family,
        serviceExactProducersClosed(state),
        'strict',
      );
      if (familyStep.outcome === 'terminal') return familyStep.value;
      if (familyStep.outcome !== 'progress') {
        return serviceStateError(state).value;
      }
      advanceCompletedStrictServiceFamily(state, family);
      continue;
    }

    if (!state.directClosed) {
      if (hasPreparedServiceDirectRoute(state.context, state.directCursor)) {
        const direct = advanceServiceDirectCandidate(session);
        if (direct.outcome === 'terminal') return direct.value;
        progressed = true;
      } else {
        state.directClosed = true;
        progressed = true;
      }
      if (activateStrictServiceFamily(state)) continue;
    }

    const path = advanceServicePath(session);
    if (path.outcome === 'terminal') return path.value;
    progressed ||= path.outcome === 'progress';

    const best = advanceServiceBestSingle(session);
    if (best.outcome === 'terminal') return best.value;
    progressed ||= best.outcome === 'progress';
    if (activateStrictServiceFamily(state)) continue;

    const set = advanceServiceCandidateSet(session);
    if (set.outcome === 'terminal') return set.value;
    progressed ||= set.outcome === 'progress';
    closeUnavailableServiceLanes(state);
    if (activateStrictServiceFamily(state)) continue;

    const equalFamily = state.equalFamilies[state.equalFamilyIndex];
    if (equalFamily !== undefined) {
      const equalStep = advanceServiceFamily(
        session,
        equalFamily,
        serviceExactProducersClosed(state),
        'equal',
      );
      if (equalStep.outcome === 'terminal') return equalStep.value;
      progressed ||= equalStep.outcome === 'progress';
      if (equalStep.outcome === 'progress') {
        advanceCompletedServiceEqualHead(state, equalFamily);
      }
      if (activateStrictServiceFamily(state)) continue;
    }

    const numericalFamily = state.numericalFamilies[state.familyIndex];
    if (numericalFamily !== undefined) {
      const numericalStep = advanceServiceFamily(
        session,
        numericalFamily,
        serviceExactProducersClosed(state),
        'numerical',
      );
      if (numericalStep.outcome === 'terminal') return numericalStep.value;
      progressed ||= numericalStep.outcome === 'progress';
      if (numericalStep.outcome === 'progress') {
        advanceCompletedServiceNumericalHead(state, numericalFamily);
      }
    }
    closeUnavailableServiceLanes(state);

    const nonGreedyComplete =
      state.directClosed &&
      state.pathClosed &&
      state.bestClosed &&
      state.setClosed &&
      (state.equalLaneClosed ||
        state.equalFamilyIndex >= state.equalFamilies.length) &&
      (state.numericalLaneClosed ||
        state.familyIndex >= state.numericalFamilies.length);
    if (nonGreedyComplete) break;
    if (!progressed) return serviceStateError(state).value;
  }

  let greedyGuard = 0;
  while (state.greedyFamilyIndex < state.families.length || state.greedy !== undefined) {
    greedyGuard += 1;
    if (greedyGuard > state.servicePolicy.maxAggregateTransitions) {
      return serviceStateError(state).value;
    }
    const greedy = advanceServiceGreedy(session);
    if (greedy.outcome === 'terminal') return greedy.value;
    if (greedy.outcome !== 'progress') return serviceStateError(state).value;
  }

  return finalizeServiceSession(session);
}

export function runServiceExactInputSplitServicePolicy(
  session: ServiceExactInputSplitSession,
): ServiceExactInputSplitSessionOutcome {
  const state = serviceStateOf(session);
  try {
    return runServiceExactInputSplitServicePolicyUnchecked(session);
  } catch {
    return serviceStateError(state).value;
  }
}

export function exactInputSplitSessionCounters<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): ExactInputSplitSessionWorkCounters {
  const counters = referenceStateOf(session).counters;
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
  return referenceStateOf(session).incumbent;
}

export function exactInputSplitSessionHadCandidate<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): boolean {
  return referenceStateOf(session).hadCandidate;
}

export function exactInputSplitSessionWorkLimited<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): boolean {
  return referenceStateOf(session).workLimited;
}

export function exactInputSplitSessionCandidateSets<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): CandidateSets {
  return referenceStateOf(session).candidateSets;
}

export function appendExactInputSplitSessionDiagnostic<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  diagnostic: TDiagnostic,
): void {
  referenceStateOf(session).diagnostics.push(diagnostic);
}

export function exactInputSplitSessionDiagnostics<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): readonly TDiagnostic[] {
  return Object.freeze([
    ...referenceStateOf(session).diagnostics,
  ]) as readonly TDiagnostic[];
}

export function observeExactInputSplitSessionBoundary<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  kind: ExactInputSplitSessionWorkKind,
): ExactInputSplitSessionBoundary {
  const state = referenceStateOf(session);
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
  const state = referenceStateOf(session);
  state.counters[KIND_COUNTER[kind]] += 1;
}

export function recordExactInputSplitSessionNumericalProposalFailure<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
): void {
  referenceStateOf(session).counters.numericalProposalFailures += 1;
}

export function recordExactInputSplitSessionNumericalResidualReplayRejection<
  TDiagnostic,
>(session: ExactInputSplitSession<TDiagnostic>): void {
  referenceStateOf(session).counters.numericalResidualReplayRejections += 1;
}

export function recordExactInputSplitSessionNumericalAuthorizationReplayRejection<
  TDiagnostic,
>(session: ExactInputSplitSession<TDiagnostic>): void {
  referenceStateOf(session).counters.numericalAuthorizationReplayRejections += 1;
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
  const state = referenceStateOf(session);
  return replayPreparedExactInputSplit(
    state.context,
    partialReplayRequest(state.request, legs),
  );
}

export function replayExactInputSplitSessionFull<TDiagnostic>(
  session: ExactInputSplitSession<TDiagnostic>,
  legs: readonly ExactInputSplitReplayLegRequest[],
): ExactInputSplitReplayResult {
  const state = referenceStateOf(session);
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
  state: ReferenceSessionState,
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
  const state = referenceStateOf(session);
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
  const state = referenceStateOf(session);
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
