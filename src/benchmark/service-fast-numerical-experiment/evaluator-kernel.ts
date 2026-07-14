import {
  reconstructPathShadowPriceBase,
  type PathShadowPriceResolvedRoute,
} from '../../allocation/path-shadow-price/index.ts';
import {
  boundedExactSplitRepairFailure,
  boundedExactSplitRepairOption,
  boundedExactSplitRepairProgress,
  boundedExactSplitRepairWinner,
  createBoundedExactSplitRepairState,
  settleBoundedExactSplitRepairOption,
  type BoundedExactSplitRepairState,
} from '../../allocation/bounded-exact-split-repair/index.ts';
import type {
  ServiceFastPathShadowPriceFailure,
  ServiceFastPathShadowPriceFailureCode,
  ServiceFastPathShadowPriceProposalMetadata,
  ServiceFastPathShadowPriceReconstruction,
  ServiceFastPathShadowPriceShareActionKind,
} from '../../allocation/service-fast-path-shadow-price/index.ts';
import type { ExactInputSplitReplayReceipt } from '../../replay/exact-input-split/index.ts';
import type { DirectionalRouteHop } from '../../replay/exact-input-route/index.ts';
import {
  isPreparedRoutingContext,
  preparedRoutingContextMatchesIdentity,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  captureServiceFastExperimentActionCaps,
  serviceFastExperimentMaximumCapsForPolicy,
  serviceFastExperimentPolicyAt,
  type ServiceFastExperimentActionCaps,
  type ServiceFastExperimentPolicy,
} from './policy.ts';
import {
  classifyServiceFastExperimentAuthorization,
  copyServiceFastExperimentReceipt,
  serviceFastExperimentCompareReceipts,
  serviceFastExperimentIsStrictlyBetter,
  serviceFastExperimentReceiptHash,
  serviceFastExperimentReceiptsEqual,
  serviceFastExperimentReplayAllocations,
  type ServiceFastExperimentReplayRequestIdentity,
} from './exact-replay.ts';
import {
  prepareConfigurableServiceFastExperimentProposal,
  prepareProtectedCoarseServiceFastExperimentAnchor,
  prepareProtectedFineServiceFastExperimentAnchor,
  serviceFastExperimentMetadataEquals,
  serviceFastExperimentReconstructionEquals,
  ServiceFastExperimentAnchorParityError,
  type ServiceFastExperimentProposalAdapter,
} from './proposal-adapters.ts';

declare const serviceFastExperimentCellBrand: unique symbol;
declare const serviceFastExperimentCallBrand: unique symbol;

/** @internal */
export interface ServiceFastExperimentCell {
  readonly [serviceFastExperimentCellBrand]: typeof serviceFastExperimentCellBrand;
}

/** @internal */
export interface ServiceFastExperimentOperationalCall {
  readonly [serviceFastExperimentCallBrand]: typeof serviceFastExperimentCallBrand;
}

/** @internal */
export type ServiceFastExperimentCandidateFailureCode =
  | ServiceFastPathShadowPriceFailureCode
  | 'finite-nonconverged-replayed'
  | 'repair-no-valid-neighbor'
  | 'repair-work-limit'
  | 'authorization-rejected'
  | 'authorization-mismatch';

/** @internal */
export type ServiceFastExperimentIntegrityFailureCode =
  | 'semantic-anchor-parity-mismatch'
  | 'exact-replay-mismatch'
  | 'counter-invariant-failure'
  | 'unexpected-exception';

/** @internal */
export type ServiceFastExperimentValidationMismatch =
  | 'counter-invariant'
  | 'exact-replay'
  | 'operational-parity';

/** @internal */
export function classifyServiceFastExperimentValidationMismatch(
  policyIndex: number,
  mismatch: ServiceFastExperimentValidationMismatch,
): Extract<
  ServiceFastExperimentIntegrityFailureCode,
  | 'semantic-anchor-parity-mismatch'
  | 'exact-replay-mismatch'
  | 'counter-invariant-failure'
> {
  serviceFastExperimentPolicyAt(policyIndex);
  if (mismatch === 'counter-invariant') return 'counter-invariant-failure';
  if (mismatch === 'exact-replay') return 'exact-replay-mismatch';
  if (mismatch === 'operational-parity') {
    return policyIndex === 0
      ? 'semantic-anchor-parity-mismatch'
      : 'exact-replay-mismatch';
  }
  throw new TypeError('Service-fast validation mismatch is invalid.');
}

/** @internal */
export type ServiceFastExperimentReconstructionDisposition =
  | 'current'
  | 'current-only-nontarget'
  | 'repair-complete'
  | 'repair-incomplete';

/** @internal */
export interface ServiceFastExperimentResolvedCandidateSetInput {
  readonly routes: readonly (readonly DirectionalRouteHop[])[];
  readonly modelResolution:
    | {
        readonly ok: true;
        readonly resolvedRoutes: readonly PathShadowPriceResolvedRoute[];
      }
    | {
        readonly ok: false;
      };
}

/** @internal */
export interface PrepareServiceFastExperimentCellInput
  extends ServiceFastExperimentReplayRequestIdentity {
  readonly context: PreparedRoutingContext;
  readonly entryIncumbent?: ExactInputSplitReplayReceipt;
  readonly candidateSets: readonly ServiceFastExperimentResolvedCandidateSetInput[];
  readonly repairTargetSetIndex: number | null;
}

/** @internal */
export type ServiceFastExperimentActionKind =
  | 'proposal'
  | 'protected-share-microstep'
  | ServiceFastPathShadowPriceShareActionKind
  | 'reconstruction-step'
  | 'residual-replay'
  | 'repair-replay'
  | 'authorization-replay';

/** @internal */
export interface ServiceFastExperimentCounters {
  readonly methodActions: number;
  readonly outerUpdates: number;
  readonly shareActions: number;
  readonly reconstructionSteps: number;
  readonly residualReplays: number;
  readonly residualRejections: number;
  readonly repairReplays: number;
  readonly repairRejections: number;
  readonly authorizationReplays: number;
  readonly authorizationRejections: number;
  readonly proposals: number;
  readonly diagnostics: number;
}

/** @internal */
export interface ServiceFastExperimentRawCounters
  extends Omit<ServiceFastExperimentCounters, 'methodActions'> {
  /** Null until a protected anchor is classified outside the timed call. */
  readonly methodActions: number | null;
}

/** @internal */
export interface ServiceFastExperimentScoreEvidence {
  readonly source: 'current' | 'repair';
  readonly attemptIndex: number;
  readonly allocations: readonly bigint[];
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly receiptHash: string;
}

/** @internal */
export interface ServiceFastExperimentCurrentAttempt {
  readonly attemptIndex: number;
  readonly residualUnitsRemaining: bigint;
  readonly routeIndex: number | null;
  readonly allocations: readonly bigint[];
  readonly outcome: 'rejected' | 'valid-not-best' | 'valid-best';
  readonly failureCode: 'residual-options-exhausted' | null;
  readonly receipt: ExactInputSplitReplayReceipt | null;
}

/** @internal */
export interface ServiceFastExperimentRepairAttempt {
  readonly attemptIndex: number;
  readonly neighborIndex: number;
  readonly allocations: readonly bigint[];
  readonly outcome: 'rejected' | 'valid-not-best' | 'valid-best';
  readonly failureCode: 'repair-no-valid-neighbor' | null;
  readonly receipt: ExactInputSplitReplayReceipt | null;
}

/** @internal */
export interface ServiceFastExperimentProposalFailureEvidence {
  readonly failureCode: ServiceFastPathShadowPriceFailureCode;
  readonly converged: boolean;
  readonly completedOuterUpdates: number;
}

/** @internal */
export interface ServiceFastExperimentRepairEvidence {
  readonly target: boolean;
  readonly complete: boolean;
  readonly attempts: readonly ServiceFastExperimentRepairAttempt[];
  readonly winner: ServiceFastExperimentScoreEvidence | null;
  readonly failureCode: ServiceFastExperimentCandidateFailureCode | null;
}

/** @internal */
export interface ServiceFastExperimentCandidateSetSnapshot {
  readonly setIndex: number;
  readonly counters: ServiceFastExperimentRawCounters;
  readonly stage: SetStage;
  readonly reconstructionDisposition: ServiceFastExperimentReconstructionDisposition;
  readonly proposalMetadata: ServiceFastPathShadowPriceProposalMetadata | null;
  readonly reconstruction: ServiceFastPathShadowPriceReconstruction | null;
  readonly initialResidualUnits: bigint | null;
  readonly currentAttempts: readonly ServiceFastExperimentCurrentAttempt[];
  readonly currentScore: ServiceFastExperimentScoreEvidence | null;
  readonly repair: ServiceFastExperimentRepairEvidence | null;
  readonly selectedScore: ServiceFastExperimentScoreEvidence | null;
  readonly proposalFailure: ServiceFastExperimentProposalFailureEvidence | null;
  readonly terminalDiagnostic: ServiceFastExperimentCandidateSetDiagnostic | null;
}

/** @internal */
export type ServiceFastExperimentCandidateSetTerminalStatus =
  | 'model-resolution-failed'
  | 'proposal-failed'
  | 'score-rejected'
  | 'not-better'
  | 'authorization-rejected'
  | 'improved';

/** @internal */
export interface ServiceFastExperimentCandidateSetDiagnostic {
  readonly setIndex: number;
  readonly counters: ServiceFastExperimentRawCounters;
  readonly status: ServiceFastExperimentCandidateSetTerminalStatus;
  readonly failureCode: ServiceFastExperimentCandidateFailureCode | null;
  readonly reconstructionDisposition: ServiceFastExperimentReconstructionDisposition;
  readonly proposalMetadata: ServiceFastPathShadowPriceProposalMetadata | null;
  readonly reconstruction: ServiceFastPathShadowPriceReconstruction | null;
  readonly initialResidualUnits: bigint | null;
  readonly currentAttempts: readonly ServiceFastExperimentCurrentAttempt[];
  readonly currentScore: ServiceFastExperimentScoreEvidence | null;
  readonly repair: ServiceFastExperimentRepairEvidence | null;
  readonly selectedScore: ServiceFastExperimentScoreEvidence | null;
  readonly proposalFailure: ServiceFastExperimentProposalFailureEvidence | null;
  readonly authorizationReceipt: ExactInputSplitReplayReceipt | null;
}

/** @internal */
export interface ServiceFastExperimentCheckpoint {
  readonly policyIndex: number;
  readonly policyId: string;
  readonly setIndex: number;
  readonly actionKind: ServiceFastExperimentActionKind;
  readonly counters: ServiceFastExperimentRawCounters;
  readonly modelRouteSetupSteps: number;
  readonly stageAggregate: number;
  readonly conservativeAggregate: number;
  readonly anyValidScore: boolean;
  readonly anyImprovement: boolean;
  readonly incumbent: ExactInputSplitReplayReceipt | null;
}

/** @internal */
export interface ServiceFastExperimentValidatedCheckpoint
  extends Omit<ServiceFastExperimentCheckpoint, 'counters'> {
  readonly counters: ServiceFastExperimentCounters;
}

/** @internal */
export type ServiceFastExperimentPreActionObserver = (
  checkpoint: ServiceFastExperimentCheckpoint,
) => boolean;

/** @internal */
export interface ServiceFastExperimentRawCompleteOutcome {
  readonly status: 'complete';
  readonly policy: ServiceFastExperimentPolicy;
  readonly adapterMode: 'semantic' | 'operational';
  readonly counters: ServiceFastExperimentRawCounters;
  readonly modelRouteSetupSteps: number;
  readonly stageAggregate: number;
  readonly conservativeAggregate: number;
  readonly diagnostics: readonly ServiceFastExperimentCandidateSetDiagnostic[];
  readonly setSnapshots: readonly ServiceFastExperimentCandidateSetSnapshot[];
  readonly entryIncumbent: ExactInputSplitReplayReceipt | null;
  readonly finalIncumbent: ExactInputSplitReplayReceipt | null;
  readonly anyValidScore: boolean;
  readonly anyImprovement: boolean;
}

/** @internal */
export interface ServiceFastExperimentRawStoppedOutcome {
  readonly status: 'stopped';
  readonly reason: 'action-cap' | 'observer';
  readonly policy: ServiceFastExperimentPolicy;
  readonly adapterMode: 'semantic' | 'operational';
  readonly nextAction: ServiceFastExperimentCheckpoint;
  readonly counters: ServiceFastExperimentRawCounters;
  readonly modelRouteSetupSteps: number;
  readonly stageAggregate: number;
  readonly conservativeAggregate: number;
  readonly diagnostics: readonly ServiceFastExperimentCandidateSetDiagnostic[];
  readonly setSnapshots: readonly ServiceFastExperimentCandidateSetSnapshot[];
  readonly entryIncumbent: ExactInputSplitReplayReceipt | null;
  readonly finalIncumbent: ExactInputSplitReplayReceipt | null;
  readonly anyValidScore: boolean;
  readonly anyImprovement: boolean;
}

/** A complete result whose protected-anchor counters passed outside validation. @internal */
export interface ServiceFastExperimentCompleteOutcome
  extends ServiceFastExperimentRawCompleteOutcome {
  readonly counters: ServiceFastExperimentCounters;
}

/** A stopped result whose full prefix passed outside validation. @internal */
export interface ServiceFastExperimentStoppedOutcome
  extends ServiceFastExperimentRawStoppedOutcome {
  readonly counters: ServiceFastExperimentCounters;
  readonly nextAction: ServiceFastExperimentValidatedCheckpoint;
}

/** @internal */
export interface ServiceFastExperimentIntegrityFailureOutcome {
  readonly status: 'integrity-failure';
  readonly code: ServiceFastExperimentIntegrityFailureCode;
  readonly policy: ServiceFastExperimentPolicy;
  readonly adapterMode: 'semantic' | 'operational';
  readonly counters: ServiceFastExperimentRawCounters;
  readonly modelRouteSetupSteps: number;
  readonly stageAggregate: number;
  readonly conservativeAggregate: number;
  readonly diagnostics: readonly ServiceFastExperimentCandidateSetDiagnostic[];
  readonly setSnapshots: readonly ServiceFastExperimentCandidateSetSnapshot[];
  readonly entryIncumbent: ExactInputSplitReplayReceipt | null;
  readonly finalIncumbent: ExactInputSplitReplayReceipt | null;
  readonly anyValidScore: boolean;
  readonly anyImprovement: boolean;
}

/** @internal */
export type ServiceFastExperimentOutcome =
  | ServiceFastExperimentRawCompleteOutcome
  | ServiceFastExperimentRawStoppedOutcome
  | ServiceFastExperimentIntegrityFailureOutcome;

/** @internal */
export type ServiceFastExperimentSemanticOutcome =
  | ServiceFastExperimentCompleteOutcome
  | ServiceFastExperimentRawStoppedOutcome
  | ServiceFastExperimentIntegrityFailureOutcome;

interface CapturedCandidateSet {
  readonly routes: readonly (readonly DirectionalRouteHop[])[];
  readonly resolvedRoutes: readonly PathShadowPriceResolvedRoute[] | undefined;
}

interface CellState {
  readonly context: PreparedRoutingContext;
  readonly identity: ServiceFastExperimentReplayRequestIdentity;
  readonly entryIncumbent: ExactInputSplitReplayReceipt | undefined;
  readonly candidateSets: readonly CapturedCandidateSet[];
  readonly repairTargetSetIndex: number | null;
}

export type SetStage =
  | 'model-resolution'
  | 'proposal'
  | 'share'
  | 'reconstruction'
  | 'current'
  | 'repair'
  | 'authorization'
  | 'terminal';

interface MutableCounters {
  methodActions: number | null;
  outerUpdates: number;
  shareActions: number;
  reconstructionSteps: number;
  residualReplays: number;
  residualRejections: number;
  repairReplays: number;
  repairRejections: number;
  authorizationReplays: number;
  authorizationRejections: number;
  proposals: number;
  diagnostics: number;
}

const COUNTER_KEYS = Object.freeze([
  'methodActions',
  'outerUpdates',
  'shareActions',
  'reconstructionSteps',
  'residualReplays',
  'residualRejections',
  'repairReplays',
  'repairRejections',
  'authorizationReplays',
  'authorizationRejections',
  'proposals',
  'diagnostics',
] as const);

interface MutableSetState {
  readonly setIndex: number;
  readonly input: CapturedCandidateSet;
  readonly adapter: ServiceFastExperimentProposalAdapter | undefined;
  readonly setupFailure: ServiceFastPathShadowPriceFailure | undefined;
  readonly counters: MutableCounters;
  stage: SetStage;
  proposalMetadata: ServiceFastPathShadowPriceProposalMetadata | undefined;
  proposalFailure: ServiceFastExperimentProposalFailureEvidence | undefined;
  reconstruction: ServiceFastPathShadowPriceReconstruction | undefined;
  initialResidualUnits: bigint | undefined;
  currentAttempts: ServiceFastExperimentCurrentAttempt[];
  currentRoundBest: ServiceFastExperimentScoreEvidence | undefined;
  currentScore: ServiceFastExperimentScoreEvidence | undefined;
  currentFailure: ServiceFastExperimentCandidateFailureCode | undefined;
  repairState: BoundedExactSplitRepairState | undefined;
  repairAttempts: ServiceFastExperimentRepairAttempt[];
  repairBest: ServiceFastExperimentScoreEvidence | undefined;
  repairFailure: 'repair-no-valid-neighbor' | 'repair-work-limit' | undefined;
  selectedScore: ServiceFastExperimentScoreEvidence | undefined;
  reconstructionDisposition: ServiceFastExperimentReconstructionDisposition;
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic | undefined;
}

interface CallState {
  readonly cellHandle: ServiceFastExperimentCell;
  readonly cell: CellState;
  readonly policy: ServiceFastExperimentPolicy;
  readonly mode: 'semantic' | 'operational';
  readonly adapterSelection: 'normal' | 'configurable-shadow';
  readonly caps: ServiceFastExperimentActionCaps;
  readonly sets: MutableSetState[];
  readonly counters: MutableCounters;
  readonly modelRouteSetupSteps: number;
  readonly entryIncumbent: ExactInputSplitReplayReceipt | undefined;
  incumbent: ExactInputSplitReplayReceipt | undefined;
  setIndex: number;
  anyValidScore: boolean;
  anyImprovement: boolean;
  integrityFailure: ServiceFastExperimentIntegrityFailureCode | undefined;
  complete: boolean;
}

const cells = new WeakMap<ServiceFastExperimentCell, CellState>();
const calls = new WeakMap<ServiceFastExperimentOperationalCall, CallState>();
const stoppedOutcomeCalls = new WeakMap<
  ServiceFastExperimentRawStoppedOutcome,
  ServiceFastExperimentOperationalCall
>();
const completeOutcomeStates = new WeakMap<
  ServiceFastExperimentRawCompleteOutcome,
  CallState
>();
const semanticOutcomeCells = new WeakMap<
  ServiceFastExperimentCompleteOutcome,
  CellState
>();
const finalizedCompleteOutcomes = new WeakSet<ServiceFastExperimentCompleteOutcome>();
const finalizedStoppedOutcomes = new WeakSet<ServiceFastExperimentStoppedOutcome>();
const consumedRawCompleteOutcomes = new WeakSet<
  ServiceFastExperimentRawCompleteOutcome
>();
const consumedRawStoppedOutcomes = new WeakSet<
  ServiceFastExperimentRawStoppedOutcome
>();

function cellStateOf(cell: ServiceFastExperimentCell): CellState {
  const state = cells.get(cell);
  if (state === undefined) throw new TypeError('Unknown service-fast experiment cell.');
  return state;
}

function callStateOf(call: ServiceFastExperimentOperationalCall): CallState {
  const state = calls.get(call);
  if (state === undefined) throw new TypeError('Unknown service-fast experiment call.');
  return state;
}

/** @internal */
export function isFinalizedServiceFastCompleteOutcome(
  outcome: unknown,
): outcome is ServiceFastExperimentCompleteOutcome {
  return typeof outcome === 'object' &&
    outcome !== null &&
    finalizedCompleteOutcomes.has(outcome as ServiceFastExperimentCompleteOutcome);
}

/** @internal */
export function isFinalizedServiceFastStoppedOutcome(
  outcome: unknown,
): outcome is ServiceFastExperimentStoppedOutcome {
  return typeof outcome === 'object' &&
    outcome !== null &&
    finalizedStoppedOutcomes.has(outcome as ServiceFastExperimentStoppedOutcome);
}

function copyHop(source: unknown): DirectionalRouteHop {
  let assetIn: unknown;
  let poolId: unknown;
  let assetOut: unknown;
  try {
    const hop = source as {
      readonly assetIn?: unknown;
      readonly poolId?: unknown;
      readonly assetOut?: unknown;
    };
    assetIn = hop.assetIn;
    poolId = hop.poolId;
    assetOut = hop.assetOut;
  } catch {
    throw new TypeError('Service-fast experiment route hop is invalid.');
  }
  if (
    typeof assetIn !== 'string' || assetIn.length === 0 ||
    typeof poolId !== 'string' || poolId.length === 0 ||
    typeof assetOut !== 'string' || assetOut.length === 0
  ) {
    throw new TypeError('Service-fast experiment route hop is invalid.');
  }
  return Object.freeze({ assetIn, poolId, assetOut });
}

function captureRoutes(
  source: unknown,
): readonly (readonly DirectionalRouteHop[])[] {
  if (!Array.isArray(source)) {
    throw new TypeError('Service-fast experiment candidate routes are invalid.');
  }
  const length = source.length;
  if (!Number.isSafeInteger(length) || length < 2 || length > 4) {
    throw new TypeError('Service-fast experiment candidate routes are outside bounds.');
  }
  const routes: Array<readonly DirectionalRouteHop[]> = [];
  for (let routeIndex = 0; routeIndex < length; routeIndex += 1) {
    const sourceRoute: unknown = source[routeIndex];
    if (!Array.isArray(sourceRoute) || sourceRoute.length < 1 || sourceRoute.length > 4) {
      throw new TypeError('Service-fast experiment candidate route is invalid.');
    }
    const route: DirectionalRouteHop[] = [];
    for (let hopIndex = 0; hopIndex < sourceRoute.length; hopIndex += 1) {
      const hop: unknown = sourceRoute[hopIndex];
      route.push(copyHop(hop));
    }
    routes.push(Object.freeze(route));
  }
  return Object.freeze(routes);
}

function copyResolvedRoute(source: unknown): PathShadowPriceResolvedRoute {
  const route = source;
  if (!Array.isArray(route) || route.length < 1 || route.length > 4) {
    throw new TypeError('Service-fast experiment resolved route is invalid.');
  }
  const captured: Array<PathShadowPriceResolvedRoute[number]> = [];
  for (let hopIndex = 0; hopIndex < route.length; hopIndex += 1) {
    const sourceHop: unknown = route[hopIndex];
    let reserveIn: unknown;
    let reserveOut: unknown;
    let feeChargedNumerator: unknown;
    let feeDenominator: unknown;
    try {
      const hop = sourceHop as {
        readonly reserveIn?: unknown;
        readonly reserveOut?: unknown;
        readonly feeChargedNumerator?: unknown;
        readonly feeDenominator?: unknown;
      };
      reserveIn = hop.reserveIn;
      reserveOut = hop.reserveOut;
      feeChargedNumerator = hop.feeChargedNumerator;
      feeDenominator = hop.feeDenominator;
    } catch {
      throw new TypeError('Service-fast experiment resolved hop is invalid.');
    }
    if (
      typeof reserveIn !== 'bigint' || reserveIn <= 0n ||
      typeof reserveOut !== 'bigint' || reserveOut <= 0n ||
      typeof feeChargedNumerator !== 'bigint' || feeChargedNumerator < 0n ||
      typeof feeDenominator !== 'bigint' || feeDenominator <= feeChargedNumerator
    ) {
      throw new TypeError('Service-fast experiment resolved hop is invalid.');
    }
    captured.push(Object.freeze({
      reserveIn,
      reserveOut,
      feeChargedNumerator,
      feeDenominator,
    }));
  }
  return Object.freeze(captured);
}

function captureCandidateSet(source: ServiceFastExperimentResolvedCandidateSetInput):
  CapturedCandidateSet {
  let sourceRoutes: readonly (readonly DirectionalRouteHop[])[];
  let resolution: ServiceFastExperimentResolvedCandidateSetInput['modelResolution'];
  try {
    sourceRoutes = source.routes;
    resolution = source.modelResolution;
  } catch {
    throw new TypeError('Service-fast experiment candidate set is invalid.');
  }
  const routes = captureRoutes(sourceRoutes);
  let ok: unknown;
  try {
    ok = resolution.ok;
  } catch {
    throw new TypeError('Service-fast experiment model resolution is invalid.');
  }
  if (ok !== true && ok !== false) {
    throw new TypeError('Service-fast experiment model resolution is invalid.');
  }
  if (!ok) return Object.freeze({ routes, resolvedRoutes: undefined });
  let sourceResolved: readonly PathShadowPriceResolvedRoute[];
  try {
    sourceResolved = (resolution as { readonly ok: true; readonly resolvedRoutes: readonly PathShadowPriceResolvedRoute[] }).resolvedRoutes;
  } catch {
    throw new TypeError('Service-fast experiment model resolution is invalid.');
  }
  if (!Array.isArray(sourceResolved) || sourceResolved.length !== routes.length) {
    throw new TypeError('Service-fast experiment model resolution is invalid.');
  }
  const resolvedRoutes = sourceResolved.map(copyResolvedRoute);
  if (resolvedRoutes.some((route, index) => route.length !== routes[index]?.length)) {
    throw new TypeError('Service-fast experiment model resolution is invalid.');
  }
  return Object.freeze({
    routes,
    resolvedRoutes: Object.freeze(resolvedRoutes),
  });
}

function validateEntryIncumbent(
  context: PreparedRoutingContext,
  identity: ServiceFastExperimentReplayRequestIdentity,
  source: ExactInputSplitReplayReceipt | undefined,
): ExactInputSplitReplayReceipt | undefined {
  if (source === undefined) return undefined;
  const captured = copyServiceFastExperimentReceipt(source);
  if (
    captured.snapshotId !== identity.snapshotId ||
    captured.snapshotChecksum !== identity.snapshotChecksum ||
    captured.assetIn !== identity.assetIn ||
    captured.assetOut !== identity.assetOut ||
    captured.amountIn !== identity.amountIn
  ) {
    throw new TypeError('Service-fast experiment entry incumbent identity is invalid.');
  }
  const routes = captured.legs.map((leg) =>
    Object.freeze(leg.receipt.hops.map(copyHop)));
  const allocations = captured.legs.map((leg) => leg.allocation);
  const replay = serviceFastExperimentReplayAllocations(
    context,
    identity,
    routes,
    allocations,
  );
  if (!replay.ok || !serviceFastExperimentReceiptsEqual(replay.value, captured)) {
    throw new TypeError('Service-fast experiment entry incumbent did not fresh replay.');
  }
  return copyServiceFastExperimentReceipt(replay.value);
}

/** @internal */
export function prepareServiceFastExperimentCell(
  source: PrepareServiceFastExperimentCellInput,
): ServiceFastExperimentCell {
  let context: PreparedRoutingContext;
  let snapshotId: unknown;
  let snapshotChecksum: unknown;
  let assetIn: unknown;
  let assetOut: unknown;
  let amountIn: unknown;
  let entryIncumbent: ExactInputSplitReplayReceipt | undefined;
  let sourceSets: readonly ServiceFastExperimentResolvedCandidateSetInput[];
  let repairTargetSetIndex: unknown;
  try {
    context = source.context;
    snapshotId = source.snapshotId;
    snapshotChecksum = source.snapshotChecksum;
    assetIn = source.assetIn;
    assetOut = source.assetOut;
    amountIn = source.amountIn;
    entryIncumbent = source.entryIncumbent;
    sourceSets = source.candidateSets;
    repairTargetSetIndex = source.repairTargetSetIndex;
  } catch {
    throw new TypeError('Service-fast experiment cell is invalid.');
  }
  if (
    !isPreparedRoutingContext(context) ||
    typeof snapshotId !== 'string' || snapshotId.length === 0 ||
    typeof snapshotChecksum !== 'string' || snapshotChecksum.length === 0 ||
    typeof assetIn !== 'string' || assetIn.length === 0 ||
    typeof assetOut !== 'string' || assetOut.length === 0 || assetIn === assetOut ||
    typeof amountIn !== 'bigint' || amountIn <= 0n ||
    !preparedRoutingContextMatchesIdentity(context, snapshotId, snapshotChecksum) ||
    !Array.isArray(sourceSets) || sourceSets.length > 4
  ) {
    throw new TypeError('Service-fast experiment cell is outside frozen bounds.');
  }
  const candidateSets = Object.freeze(sourceSets.map(captureCandidateSet));
  const firstResolvedIndex = candidateSets.findIndex(
    (candidateSet) => candidateSet.resolvedRoutes !== undefined,
  );
  const expectedTarget = firstResolvedIndex < 0 ? null : firstResolvedIndex;
  if (repairTargetSetIndex !== expectedTarget) {
    throw new TypeError('Service-fast experiment repair target is invalid.');
  }
  const setupSteps = candidateSets.reduce(
    (sum, candidateSet) => sum + (candidateSet.resolvedRoutes?.length ?? 0),
    0,
  );
  if (setupSteps > 16) {
    throw new TypeError('Service-fast experiment model setup exceeds its bound.');
  }
  const identity: ServiceFastExperimentReplayRequestIdentity = Object.freeze({
    snapshotId,
    snapshotChecksum,
    assetIn,
    assetOut,
    amountIn,
  });
  const capturedIncumbent = validateEntryIncumbent(
    context,
    identity,
    entryIncumbent,
  );
  const handle = Object.freeze({}) as ServiceFastExperimentCell;
  cells.set(handle, Object.freeze({
    context,
    identity,
    entryIncumbent: capturedIncumbent,
    candidateSets,
    repairTargetSetIndex: expectedTarget,
  }));
  return handle;
}

function emptyCounters(methodActions: number | null): MutableCounters {
  return {
    methodActions,
    outerUpdates: 0,
    shareActions: 0,
    reconstructionSteps: 0,
    residualReplays: 0,
    residualRejections: 0,
    repairReplays: 0,
    repairRejections: 0,
    authorizationReplays: 0,
    authorizationRejections: 0,
    proposals: 0,
    diagnostics: 0,
  };
}

function stageAggregate(counters: MutableCounters): number {
  return counters.proposals +
    counters.shareActions +
    counters.reconstructionSteps +
    counters.residualReplays +
    counters.repairReplays +
    counters.authorizationReplays;
}

function copyCounters(counters: MutableCounters): ServiceFastExperimentRawCounters {
  return Object.freeze({ ...counters });
}

type NumericCounterKey = Exclude<keyof MutableCounters, 'methodActions'>;

function incrementCounter(
  state: CallState,
  set: MutableSetState,
  key: NumericCounterKey,
  delta = 1,
): void {
  state.counters[key] += delta;
  set.counters[key] += delta;
}

function incrementMethodCounter(state: CallState, set: MutableSetState): void {
  if (
    state.counters.methodActions === null ||
    set.counters.methodActions === null
  ) {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  state.counters.methodActions += 1;
  set.counters.methodActions += 1;
}

function copyProposalFailure(
  failure: ServiceFastExperimentProposalFailureEvidence | undefined,
): ServiceFastExperimentProposalFailureEvidence | null {
  return failure === undefined
    ? null
    : Object.freeze({
        failureCode: failure.failureCode,
        converged: failure.converged,
        completedOuterUpdates: failure.completedOuterUpdates,
      });
}

function captureProposalFailure(
  failure: ServiceFastPathShadowPriceFailure,
): ServiceFastExperimentProposalFailureEvidence {
  return Object.freeze({
    failureCode: failure.code,
    converged: failure.converged,
    completedOuterUpdates: failure.completedOuterUpdates,
  });
}

function prepareSetState(
  cell: CellState,
  policy: ServiceFastExperimentPolicy,
  mode: 'semantic' | 'operational',
  adapterSelection: 'normal' | 'configurable-shadow',
  input: CapturedCandidateSet,
  setIndex: number,
): { readonly state: MutableSetState; readonly setupSteps: number } {
  let adapter: ServiceFastExperimentProposalAdapter | undefined;
  let setupFailure: ServiceFastPathShadowPriceFailure | undefined;
  let setupSteps = 0;
  const resolvedRoutes = input.resolvedRoutes;
  if (resolvedRoutes !== undefined) {
    const prepared = adapterSelection === 'configurable-shadow'
      ? prepareConfigurableServiceFastExperimentProposal(
        cell.identity.amountIn,
        resolvedRoutes,
        policy,
      )
      : mode === 'operational' && policy.policyIndex === 0
      ? prepareProtectedFineServiceFastExperimentAnchor(
        cell.identity.amountIn,
        resolvedRoutes,
        policy,
      )
      : mode === 'semantic' && policy.policyIndex === 0
        ? prepareProtectedCoarseServiceFastExperimentAnchor(
          cell.identity.amountIn,
          resolvedRoutes,
          policy,
        )
      : prepareConfigurableServiceFastExperimentProposal(
        cell.identity.amountIn,
        resolvedRoutes,
        policy,
      );
    setupSteps = prepared.modelRouteSetupSteps;
    if (prepared.ok) adapter = prepared.adapter;
    else setupFailure = prepared.failure;
  }
  const state: MutableSetState = {
    setIndex,
    input,
    adapter,
    setupFailure,
    counters: emptyCounters(
      adapterSelection === 'normal' && policy.policyIndex === 0 ? null : 0,
    ),
    stage: 'model-resolution',
    proposalMetadata: undefined,
    proposalFailure: undefined,
    reconstruction: undefined,
    initialResidualUnits: undefined,
    currentAttempts: [],
    currentRoundBest: undefined,
    currentScore: undefined,
    currentFailure: undefined,
    repairState: undefined,
    repairAttempts: [],
    repairBest: undefined,
    repairFailure: undefined,
    selectedScore: undefined,
    reconstructionDisposition: policy.reconstruction ===
        'bounded-exact-neighborhood-v1'
      ? setIndex === cell.repairTargetSetIndex
        ? 'repair-incomplete'
        : 'current-only-nontarget'
      : 'current',
    diagnostic: undefined,
  };
  return Object.freeze({ setupSteps, state });
}

function createCall(
  cell: ServiceFastExperimentCell,
  policyIndex: number,
  mode: 'semantic' | 'operational',
  sourceCaps?: ServiceFastExperimentActionCaps,
  adapterSelection: 'normal' | 'configurable-shadow' = 'normal',
): ServiceFastExperimentOperationalCall {
  const cellState = cellStateOf(cell);
  const policy = serviceFastExperimentPolicyAt(policyIndex);
  const caps = captureServiceFastExperimentActionCaps(sourceCaps, policyIndex);
  const sets: MutableSetState[] = [];
  let modelRouteSetupSteps = 0;
  for (let setIndex = 0; setIndex < cellState.candidateSets.length; setIndex += 1) {
    const input = cellState.candidateSets[setIndex];
    if (input === undefined) throw new Error('Candidate set disappeared during setup.');
    const prepared = prepareSetState(
      cellState,
      policy,
      mode,
      adapterSelection,
      input,
      setIndex,
    );
    modelRouteSetupSteps += prepared.setupSteps;
    sets.push(prepared.state);
  }
  const maximum = serviceFastExperimentMaximumCapsForPolicy(policyIndex);
  if (
    modelRouteSetupSteps > maximum.modelRouteSetupSteps ||
    modelRouteSetupSteps > maximum.conservativeAggregate
  ) {
    throw new TypeError('Service-fast experiment setup exceeds its conservative bound.');
  }
  const entryIncumbent = cellState.entryIncumbent === undefined
    ? undefined
    : copyServiceFastExperimentReceipt(cellState.entryIncumbent);
  const handle = Object.freeze({}) as ServiceFastExperimentOperationalCall;
  calls.set(handle, {
    cellHandle: cell,
    cell: cellState,
    policy,
    mode,
    adapterSelection,
    caps,
    sets,
    counters: emptyCounters(
      adapterSelection === 'normal' && policy.policyIndex === 0 ? null : 0,
    ),
    modelRouteSetupSteps,
    entryIncumbent,
    incumbent: entryIncumbent,
    setIndex: 0,
    anyValidScore: false,
    anyImprovement: false,
    integrityFailure: undefined,
    complete: sets.length === 0,
  });
  return handle;
}

/** @internal */
export function prepareServiceFastOperationalPolicy(
  cell: ServiceFastExperimentCell,
  policyIndex: number,
  caps?: ServiceFastExperimentActionCaps,
): ServiceFastExperimentOperationalCall {
  return createCall(cell, policyIndex, 'operational', caps);
}

function currentSet(state: CallState): MutableSetState | undefined {
  return state.sets[state.setIndex];
}

function copyScore(
  score: ServiceFastExperimentScoreEvidence | undefined,
): ServiceFastExperimentScoreEvidence | null {
  if (score === undefined) return null;
  return Object.freeze({
    source: score.source,
    attemptIndex: score.attemptIndex,
    allocations: Object.freeze([...score.allocations]),
    receipt: copyServiceFastExperimentReceipt(score.receipt),
    receiptHash: score.receiptHash,
  });
}

function copyProposalMetadata(
  metadata: ServiceFastPathShadowPriceProposalMetadata | undefined,
): ServiceFastPathShadowPriceProposalMetadata | null {
  return metadata === undefined
    ? null
    : Object.freeze({
        ...metadata,
        weights: Object.freeze([...metadata.weights]),
      });
}

function copyReconstruction(
  reconstruction: ServiceFastPathShadowPriceReconstruction | undefined,
): ServiceFastPathShadowPriceReconstruction | null {
  return reconstruction === undefined
    ? null
    : Object.freeze({
        integerWeights: Object.freeze([...reconstruction.integerWeights]),
        baseAllocations: Object.freeze([...reconstruction.baseAllocations]),
        residualUnits: reconstruction.residualUnits,
      });
}

function copyCurrentAttempt(
  attempt: ServiceFastExperimentCurrentAttempt,
): ServiceFastExperimentCurrentAttempt {
  return Object.freeze({
    ...attempt,
    allocations: Object.freeze([...attempt.allocations]),
    receipt: attempt.receipt === null
      ? null
      : copyServiceFastExperimentReceipt(attempt.receipt),
  });
}

function copyRepairAttempt(
  attempt: ServiceFastExperimentRepairAttempt,
): ServiceFastExperimentRepairAttempt {
  return Object.freeze({
    ...attempt,
    allocations: Object.freeze([...attempt.allocations]),
    receipt: attempt.receipt === null
      ? null
      : copyServiceFastExperimentReceipt(attempt.receipt),
  });
}

function repairEvidence(
  state: CallState,
  set: MutableSetState,
  terminalFailure?: ServiceFastExperimentCandidateFailureCode | null,
): ServiceFastExperimentRepairEvidence | null {
  const isRepairPolicy = state.policy.reconstruction ===
    'bounded-exact-neighborhood-v1';
  if (!isRepairPolicy) return null;
  const target = set.setIndex === state.cell.repairTargetSetIndex;
  if (!target) return null;
  const complete = set.repairState !== undefined &&
    boundedExactSplitRepairProgress(set.repairState).phase !== 'option';
  const upstreamFailure = terminalFailure ?? set.diagnostic?.failureCode ?? null;
  return Object.freeze({
    target: true,
    complete,
    attempts: Object.freeze(set.repairAttempts.map(copyRepairAttempt)),
    winner: complete ? copyScore(set.repairBest) : null,
    failureCode: complete
      ? set.repairFailure ?? null
      : upstreamFailure ?? 'repair-work-limit',
  });
}

function setSnapshot(
  state: CallState,
  set: MutableSetState,
): ServiceFastExperimentCandidateSetSnapshot {
  return Object.freeze({
    setIndex: set.setIndex,
    counters: copyCounters(set.counters),
    stage: set.stage,
    reconstructionDisposition: set.reconstructionDisposition,
    proposalMetadata: copyProposalMetadata(set.proposalMetadata),
    reconstruction: copyReconstruction(set.reconstruction),
    initialResidualUnits: set.initialResidualUnits ?? null,
    currentAttempts: Object.freeze(set.currentAttempts.map(copyCurrentAttempt)),
    currentScore: copyScore(set.currentScore),
    repair: repairEvidence(state, set),
    selectedScore: copyScore(set.selectedScore),
    proposalFailure: copyProposalFailure(set.proposalFailure),
    terminalDiagnostic: set.diagnostic === undefined
      ? null
      : copyDiagnostic(set.diagnostic),
  });
}

function createDiagnostic(
  state: CallState,
  set: MutableSetState,
  status: ServiceFastExperimentCandidateSetTerminalStatus,
  failureCode: ServiceFastExperimentCandidateFailureCode | null,
  authorizationReceipt?: ExactInputSplitReplayReceipt,
): void {
  if (set.diagnostic !== undefined) {
    state.integrityFailure = 'counter-invariant-failure';
    return;
  }
  set.stage = 'terminal';
  incrementCounter(state, set, 'diagnostics');
  const diagnostic: ServiceFastExperimentCandidateSetDiagnostic = Object.freeze({
    setIndex: set.setIndex,
    counters: copyCounters(set.counters),
    status,
    failureCode,
    reconstructionDisposition: set.reconstructionDisposition,
    proposalMetadata: copyProposalMetadata(set.proposalMetadata),
    reconstruction: copyReconstruction(set.reconstruction),
    initialResidualUnits: set.initialResidualUnits ?? null,
    currentAttempts: Object.freeze(set.currentAttempts.map(copyCurrentAttempt)),
    currentScore: copyScore(set.currentScore),
    repair: repairEvidence(state, set, failureCode),
    selectedScore: copyScore(set.selectedScore),
    proposalFailure: copyProposalFailure(set.proposalFailure),
    authorizationReceipt: authorizationReceipt === undefined
      ? null
      : copyServiceFastExperimentReceipt(authorizationReceipt),
  });
  set.diagnostic = diagnostic;
}

function setIntegrityFailure(
  state: CallState,
  code: ServiceFastExperimentIntegrityFailureCode,
): void {
  if (state.integrityFailure === undefined) state.integrityFailure = code;
}

function chooseSelectedScore(state: CallState, set: MutableSetState): void {
  const current = set.currentScore;
  const repair = set.repairBest;
  set.selectedScore = repair !== undefined &&
    (current === undefined ||
      serviceFastExperimentCompareReceipts(repair.receipt, current.receipt) < 0)
    ? repair
    : current;
  if (set.selectedScore === undefined) {
    const failure = set.currentFailure ?? set.repairFailure ??
      'residual-options-exhausted';
    createDiagnostic(state, set, 'score-rejected', failure);
    return;
  }
  if (!serviceFastExperimentIsStrictlyBetter(set.selectedScore.receipt, state.incumbent)) {
    createDiagnostic(state, set, 'not-better', null);
    return;
  }
  set.stage = 'authorization';
}

function beginRepairOrSelection(state: CallState, set: MutableSetState): void {
  const repairPolicy = state.policy.reconstruction ===
    'bounded-exact-neighborhood-v1';
  const target = set.setIndex === state.cell.repairTargetSetIndex;
  if (!repairPolicy) {
    set.reconstructionDisposition = 'current';
    chooseSelectedScore(state, set);
    return;
  }
  if (!target) {
    set.reconstructionDisposition = 'current-only-nontarget';
    chooseSelectedScore(state, set);
    return;
  }
  const reconstruction = set.reconstruction;
  if (reconstruction === undefined) {
    createDiagnostic(
      state,
      set,
      'proposal-failed',
      set.currentFailure ?? 'invalid-reconstruction',
    );
    return;
  }
  set.repairState = createBoundedExactSplitRepairState(reconstruction);
  set.reconstructionDisposition = 'repair-incomplete';
  set.stage = 'repair';
}

function normalizeState(state: CallState): ServiceFastExperimentActionKind | undefined {
  while (
    state.integrityFailure === undefined &&
    !state.complete
  ) {
    const set = currentSet(state);
    if (set === undefined) {
      state.complete = true;
      return undefined;
    }
    if (set.stage === 'terminal') {
      state.setIndex += 1;
      continue;
    }
    if (set.stage === 'model-resolution') {
      if (set.input.resolvedRoutes === undefined) {
        createDiagnostic(state, set, 'model-resolution-failed', 'invalid-route-model');
        continue;
      }
      if (set.setupFailure !== undefined || set.adapter === undefined) {
        const failure = set.setupFailure;
        if (failure !== undefined) {
          set.proposalFailure = captureProposalFailure(failure);
        }
        createDiagnostic(
          state,
          set,
          'proposal-failed',
          failure?.code ?? 'invalid-route-model',
        );
        continue;
      }
      set.stage = 'proposal';
      return 'proposal';
    }
    if (set.stage === 'proposal') return 'proposal';
    if (set.stage === 'share') {
      const progress = set.adapter?.progress();
      if (progress === undefined) {
        setIntegrityFailure(state, 'unexpected-exception');
        return undefined;
      }
      if (progress.phase === 'share-action') {
        if (progress.nextShareAction === null) {
          setIntegrityFailure(state, 'counter-invariant-failure');
          return undefined;
        }
        return progress.nextShareAction;
      }
      if (progress.phase === 'reconstruction-step') {
        set.proposalMetadata = set.adapter?.metadata();
        if (set.proposalMetadata === undefined) {
          setIntegrityFailure(state, 'counter-invariant-failure');
          return undefined;
        }
        set.stage = 'reconstruction';
        continue;
      }
      if (progress.phase === 'residual-option') {
        set.proposalMetadata = set.adapter?.metadata();
        set.reconstruction = set.adapter?.reconstruction();
        set.initialResidualUnits = set.adapter?.initialResidualUnits();
        if (
          set.proposalMetadata === undefined ||
          set.initialResidualUnits === undefined ||
          set.initialResidualUnits < 0n ||
          (set.reconstruction !== undefined &&
            set.initialResidualUnits !== set.reconstruction.residualUnits) ||
          (set.adapter?.kind !== 'protected-fine-anchor' &&
            set.reconstruction === undefined)
        ) {
          setIntegrityFailure(state, 'counter-invariant-failure');
          return undefined;
        }
        set.stage = 'current';
        continue;
      }
      if (progress.phase === 'failed') {
        const failure = set.adapter?.failure();
        if (failure !== undefined) {
          set.proposalFailure = captureProposalFailure(failure);
        }
        createDiagnostic(
          state,
          set,
          'proposal-failed',
          failure?.code ?? 'non-finite-proposal',
        );
        continue;
      }
      setIntegrityFailure(state, 'counter-invariant-failure');
      return undefined;
    }
    if (set.stage === 'reconstruction') {
      const progress = set.adapter?.progress();
      if (progress?.phase === 'reconstruction-step') return 'reconstruction-step';
      if (progress?.phase === 'residual-option') {
        set.reconstruction = set.adapter?.reconstruction();
        set.initialResidualUnits = set.adapter?.initialResidualUnits();
        if (
          set.initialResidualUnits === undefined ||
          set.initialResidualUnits < 0n ||
          (set.reconstruction !== undefined &&
            set.initialResidualUnits !== set.reconstruction.residualUnits) ||
          set.adapter?.kind !== 'protected-fine-anchor' &&
          set.reconstruction === undefined
        ) {
          setIntegrityFailure(state, 'counter-invariant-failure');
          return undefined;
        }
        set.stage = 'current';
        continue;
      }
      if (progress?.phase === 'failed') {
        const failure = set.adapter?.failure();
        if (failure !== undefined) {
          set.proposalFailure = captureProposalFailure(failure);
        }
        createDiagnostic(
          state,
          set,
          'proposal-failed',
          failure?.code ?? 'invalid-reconstruction',
        );
        continue;
      }
      setIntegrityFailure(state, 'counter-invariant-failure');
      return undefined;
    }
    if (set.stage === 'current') {
      const progress = set.adapter?.progress();
      if (progress?.phase === 'residual-option') return 'residual-replay';
      if (progress?.phase === 'score-ready') {
        const allocations = set.adapter?.scoreAllocations();
        if (
          allocations === undefined ||
          set.currentRoundBest === undefined ||
          !equalBigintVectors(allocations, set.currentRoundBest.allocations) ||
          set.currentRoundBest.receipt.amountIn !== state.cell.identity.amountIn
        ) {
          setIntegrityFailure(state, 'exact-replay-mismatch');
          return undefined;
        }
        set.currentScore = set.currentRoundBest;
        set.currentRoundBest = undefined;
        beginRepairOrSelection(state, set);
        continue;
      }
      if (progress?.phase === 'failed') {
        set.currentFailure = set.adapter?.failure()?.code ??
          'residual-options-exhausted';
        set.currentRoundBest = undefined;
        beginRepairOrSelection(state, set);
        continue;
      }
      setIntegrityFailure(state, 'counter-invariant-failure');
      return undefined;
    }
    if (set.stage === 'repair') {
      const repair = set.repairState;
      if (repair === undefined) {
        setIntegrityFailure(state, 'counter-invariant-failure');
        return undefined;
      }
      const progress = boundedExactSplitRepairProgress(repair);
      if (progress.phase === 'option') return 'repair-replay';
      set.reconstructionDisposition = 'repair-complete';
      const winner = boundedExactSplitRepairWinner(repair);
      const failure = boundedExactSplitRepairFailure(repair);
      if (winner === undefined) {
        set.repairFailure = failure?.code ?? 'repair-no-valid-neighbor';
        set.repairBest = undefined;
      } else if (
        set.repairBest === undefined ||
        set.repairBest.attemptIndex !== winner.neighborIndex ||
        !equalBigintVectors(set.repairBest.allocations, winner.allocations)
      ) {
        setIntegrityFailure(state, 'exact-replay-mismatch');
        return undefined;
      }
      chooseSelectedScore(state, set);
      continue;
    }
    if (set.stage === 'authorization') return 'authorization-replay';
  }
  return undefined;
}

function equalBigintVectors(left: readonly bigint[], right: readonly bigint[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function actionCounter(
  state: CallState,
  kind: ServiceFastExperimentActionKind,
): { readonly value: number; readonly cap: number } {
  if (kind === 'proposal') {
    return { value: state.counters.proposals, cap: state.caps.proposals };
  }
  if (
    kind === 'protected-share-microstep' ||
    kind === 'bisection-endpoint' ||
    kind === 'bisection-inner-update' ||
    kind === 'bisection-final-share' ||
    kind === 'pinned-sqrt-endpoint' ||
    kind === 'pinned-sqrt-formula' ||
    kind === 'fixed-newton-sqrt-endpoint' ||
    kind === 'fixed-newton-sqrt-normalization' ||
    kind === 'fixed-newton-sqrt-update' ||
    kind === 'fixed-newton-sqrt-finalization'
  ) {
    return { value: state.counters.shareActions, cap: state.caps.shareActions };
  }
  if (kind === 'reconstruction-step') {
    return {
      value: state.counters.reconstructionSteps,
      cap: state.caps.reconstructionSteps,
    };
  }
  if (kind === 'residual-replay') {
    return { value: state.counters.residualReplays, cap: state.caps.residualReplays };
  }
  if (kind === 'repair-replay') {
    return { value: state.counters.repairReplays, cap: state.caps.repairReplays };
  }
  return {
    value: state.counters.authorizationReplays,
    cap: state.caps.authorizationReplays,
  };
}

function actionIsMethod(kind: ServiceFastExperimentActionKind): boolean {
  return kind === 'bisection-inner-update' ||
    kind === 'bisection-final-share' ||
    kind === 'pinned-sqrt-formula' ||
    kind === 'fixed-newton-sqrt-normalization' ||
    kind === 'fixed-newton-sqrt-update' ||
    kind === 'fixed-newton-sqrt-finalization';
}

function checkpoint(
  state: CallState,
  set: MutableSetState,
  actionKind: ServiceFastExperimentActionKind,
): ServiceFastExperimentCheckpoint {
  const aggregate = stageAggregate(state.counters);
  return Object.freeze({
    policyIndex: state.policy.policyIndex,
    policyId: state.policy.policyId,
    setIndex: set.setIndex,
    actionKind,
    counters: copyCounters(state.counters),
    modelRouteSetupSteps: state.modelRouteSetupSteps,
    stageAggregate: aggregate,
    conservativeAggregate: aggregate + state.modelRouteSetupSteps,
    anyValidScore: state.anyValidScore,
    anyImprovement: state.anyImprovement,
    incumbent: state.incumbent === undefined
      ? null
      : copyServiceFastExperimentReceipt(state.incumbent),
  });
}

function precharge(
  state: CallState,
  set: MutableSetState,
  kind: ServiceFastExperimentActionKind,
): void {
  if (kind === 'proposal') incrementCounter(state, set, 'proposals');
  else if (
    kind === 'reconstruction-step'
  ) incrementCounter(state, set, 'reconstructionSteps');
  else if (kind === 'residual-replay') {
    incrementCounter(state, set, 'residualReplays');
  } else if (kind === 'repair-replay') {
    incrementCounter(state, set, 'repairReplays');
  } else if (kind === 'authorization-replay') {
    incrementCounter(state, set, 'authorizationReplays');
  }
  else {
    incrementCounter(state, set, 'shareActions');
    if (actionIsMethod(kind)) incrementMethodCounter(state, set);
  }
}

function scoreEvidence(
  source: 'current' | 'repair',
  attemptIndex: number,
  allocations: readonly bigint[],
  receipt: ExactInputSplitReplayReceipt,
): ServiceFastExperimentScoreEvidence {
  const capturedReceipt = copyServiceFastExperimentReceipt(receipt);
  return Object.freeze({
    source,
    attemptIndex,
    allocations: Object.freeze([...allocations]),
    receipt: capturedReceipt,
    receiptHash: serviceFastExperimentReceiptHash(capturedReceipt),
  });
}

function executeProposal(state: CallState, set: MutableSetState): void {
  if (set.stage !== 'proposal') {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  set.stage = 'share';
}

function executeShare(
  state: CallState,
  set: MutableSetState,
  kind: ServiceFastExperimentActionKind,
): void {
  const adapter = set.adapter;
  if (adapter === undefined || set.stage !== 'share') {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  const before = adapter.progress();
  const result = adapter.advanceShare();
  const after = adapter.progress();
  const methodDelta = after.methodActions - before.methodActions;
  const shareDelta = after.shareActions - before.shareActions;
  const outerDelta = after.outerUpdates - before.outerUpdates;
  if (
    shareDelta !== 1 ||
    methodDelta !== (actionIsMethod(kind) ? 1 : 0) ||
    (outerDelta !== 0 && outerDelta !== 1) ||
    state.counters.shareActions < 1 ||
    (state.counters.methodActions === null
      ? methodDelta !== 0
      : state.counters.methodActions < methodDelta)
  ) {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  incrementCounter(state, set, 'outerUpdates', outerDelta);
  if (!result.ok) {
    if (result.failure !== undefined) {
      set.proposalFailure = captureProposalFailure(result.failure);
    }
    createDiagnostic(
      state,
      set,
      'proposal-failed',
      result.failure?.code ?? 'non-finite-proposal',
    );
  }
}

function executeReconstruction(state: CallState, set: MutableSetState): void {
  const adapter = set.adapter;
  if (adapter === undefined || set.stage !== 'reconstruction') {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  const before = adapter.progress().reconstructionSteps;
  const result = adapter.advanceReconstruction();
  const after = adapter.progress().reconstructionSteps;
  if (after - before !== 1) {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  if (!result.ok) {
    if (result.failure !== undefined) {
      set.proposalFailure = captureProposalFailure(result.failure);
    }
    createDiagnostic(
      state,
      set,
      'proposal-failed',
      result.failure?.code ?? 'invalid-reconstruction',
    );
  }
}

function executeResidual(state: CallState, set: MutableSetState): void {
  const adapter = set.adapter;
  if (adapter === undefined || set.stage !== 'current') {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  const option = adapter.residualOption();
  const attemptIndex = set.currentAttempts.length;
  const replay = serviceFastExperimentReplayAllocations(
    state.cell.context,
    state.cell.identity,
    set.input.routes,
    option.allocations,
  );
  let outcome: 'rejected' | 'valid-not-best' | 'valid-best';
  let receipt: ExactInputSplitReplayReceipt | null = null;
  if (!replay.ok) {
    outcome = 'rejected';
    incrementCounter(state, set, 'residualRejections');
  } else {
    receipt = copyServiceFastExperimentReceipt(replay.value);
    if (receipt.amountIn === state.cell.identity.amountIn) {
      state.anyValidScore = true;
    }
    const candidate = scoreEvidence('current', attemptIndex, option.allocations, receipt);
    outcome = set.currentRoundBest === undefined ||
      serviceFastExperimentCompareReceipts(
        candidate.receipt,
        set.currentRoundBest.receipt,
      ) < 0
      ? 'valid-best'
      : 'valid-not-best';
    if (outcome === 'valid-best') set.currentRoundBest = candidate;
  }
  set.currentAttempts.push(Object.freeze({
    attemptIndex,
    residualUnitsRemaining: option.residualUnitsRemaining,
    routeIndex: option.routeIndex,
    allocations: Object.freeze([...option.allocations]),
    outcome,
    failureCode: outcome === 'rejected' ? 'residual-options-exhausted' : null,
    receipt,
  }));
  const settled = adapter.settleResidual(outcome);
  if (!settled.ok) {
    set.currentFailure = settled.failure?.code ?? 'residual-options-exhausted';
    set.currentRoundBest = undefined;
    return;
  }
  const nextProgress = adapter.progress();
  if (
    nextProgress.phase === 'residual-option' &&
    option.routeIndex === set.input.routes.length - 1 &&
    option.residualUnitsRemaining > 1n
  ) {
    set.currentRoundBest = undefined;
  }
}

function executeRepair(state: CallState, set: MutableSetState): void {
  const repair = set.repairState;
  if (repair === undefined || set.stage !== 'repair') {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  const option = boundedExactSplitRepairOption(repair);
  const attemptIndex = set.repairAttempts.length;
  if (option.neighborIndex !== attemptIndex) {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  const replay = serviceFastExperimentReplayAllocations(
    state.cell.context,
    state.cell.identity,
    set.input.routes,
    option.allocations,
  );
  let outcome: 'rejected' | 'valid-not-best' | 'valid-best';
  let receipt: ExactInputSplitReplayReceipt | null = null;
  if (!replay.ok) {
    outcome = 'rejected';
    incrementCounter(state, set, 'repairRejections');
  } else {
    state.anyValidScore = true;
    receipt = copyServiceFastExperimentReceipt(replay.value);
    const candidate = scoreEvidence('repair', attemptIndex, option.allocations, receipt);
    outcome = set.repairBest === undefined ||
      serviceFastExperimentCompareReceipts(candidate.receipt, set.repairBest.receipt) < 0
      ? 'valid-best'
      : 'valid-not-best';
    if (outcome === 'valid-best') set.repairBest = candidate;
  }
  set.repairAttempts.push(Object.freeze({
    attemptIndex,
    neighborIndex: option.neighborIndex,
    allocations: Object.freeze([...option.allocations]),
    outcome,
    failureCode: outcome === 'rejected' ? 'repair-no-valid-neighbor' : null,
    receipt,
  }));
  settleBoundedExactSplitRepairOption(repair, outcome);
}

function executeAuthorization(state: CallState, set: MutableSetState): void {
  const selected = set.selectedScore;
  if (selected === undefined || set.stage !== 'authorization') {
    setIntegrityFailure(state, 'counter-invariant-failure');
    return;
  }
  const replay = serviceFastExperimentReplayAllocations(
    state.cell.context,
    state.cell.identity,
    set.input.routes,
    selected.allocations,
  );
  const classification = classifyServiceFastExperimentAuthorization(
    selected.receipt,
    state.incumbent,
    replay,
  );
  if (classification.outcome === 'authorization-rejected') {
    incrementCounter(state, set, 'authorizationRejections');
    createDiagnostic(state, set, 'authorization-rejected', 'authorization-rejected');
    return;
  }
  if (classification.outcome === 'authorization-mismatch') {
    incrementCounter(state, set, 'authorizationRejections');
    createDiagnostic(state, set, 'authorization-rejected', 'authorization-mismatch');
    setIntegrityFailure(state, 'exact-replay-mismatch');
    return;
  }
  if (classification.outcome === 'not-better') {
    setIntegrityFailure(state, 'exact-replay-mismatch');
    return;
  }
  const prior = state.incumbent;
  state.incumbent = copyServiceFastExperimentReceipt(classification.receipt);
  if (!serviceFastExperimentIsStrictlyBetter(state.incumbent, prior)) {
    setIntegrityFailure(state, 'exact-replay-mismatch');
    return;
  }
  if (serviceFastExperimentIsStrictlyBetter(state.incumbent, state.entryIncumbent)) {
    state.anyImprovement = true;
  }
  createDiagnostic(state, set, 'improved', null, state.incumbent);
}

function executeAction(
  state: CallState,
  set: MutableSetState,
  kind: ServiceFastExperimentActionKind,
): void {
  if (kind === 'proposal') executeProposal(state, set);
  else if (kind === 'reconstruction-step') executeReconstruction(state, set);
  else if (kind === 'residual-replay') executeResidual(state, set);
  else if (kind === 'repair-replay') executeRepair(state, set);
  else if (kind === 'authorization-replay') executeAuthorization(state, set);
  else executeShare(state, set, kind);
}

function copyDiagnostic(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): ServiceFastExperimentCandidateSetDiagnostic {
  return Object.freeze({
    ...diagnostic,
    counters: Object.freeze({ ...diagnostic.counters }),
    proposalMetadata: copyProposalMetadata(diagnostic.proposalMetadata ?? undefined),
    reconstruction: copyReconstruction(diagnostic.reconstruction ?? undefined),
    currentAttempts: Object.freeze(diagnostic.currentAttempts.map(copyCurrentAttempt)),
    currentScore: diagnostic.currentScore === null
      ? null
      : copyScore(diagnostic.currentScore),
    repair: diagnostic.repair === null
      ? null
      : Object.freeze({
          ...diagnostic.repair,
          attempts: Object.freeze(diagnostic.repair.attempts.map(copyRepairAttempt)),
          winner: diagnostic.repair.winner === null
            ? null
            : copyScore(diagnostic.repair.winner),
        }),
    selectedScore: diagnostic.selectedScore === null
      ? null
      : copyScore(diagnostic.selectedScore),
    proposalFailure: diagnostic.proposalFailure === null
      ? null
      : Object.freeze({ ...diagnostic.proposalFailure }),
    authorizationReceipt: diagnostic.authorizationReceipt === null
      ? null
      : copyServiceFastExperimentReceipt(diagnostic.authorizationReceipt),
  });
}

function outcomeBase(state: CallState): Omit<
  ServiceFastExperimentRawCompleteOutcome,
  'status'
> {
  const aggregate = stageAggregate(state.counters);
  const diagnostics = state.sets
    .map((set) => set.diagnostic)
    .filter((value): value is ServiceFastExperimentCandidateSetDiagnostic =>
      value !== undefined)
    .map(copyDiagnostic);
  const setSnapshots = state.sets.map((set) => setSnapshot(state, set));
  return Object.freeze({
    policy: Object.freeze({ ...state.policy }),
    adapterMode: state.mode,
    counters: copyCounters(state.counters),
    modelRouteSetupSteps: state.modelRouteSetupSteps,
    stageAggregate: aggregate,
    conservativeAggregate: aggregate + state.modelRouteSetupSteps,
    diagnostics: Object.freeze(diagnostics),
    setSnapshots: Object.freeze(setSnapshots),
    entryIncumbent: state.entryIncumbent === undefined
      ? null
      : copyServiceFastExperimentReceipt(state.entryIncumbent),
    finalIncumbent: state.incumbent === undefined
      ? null
      : copyServiceFastExperimentReceipt(state.incumbent),
    anyValidScore: state.anyValidScore,
    anyImprovement: state.anyImprovement,
  });
}

function integrityOutcome(state: CallState): ServiceFastExperimentIntegrityFailureOutcome {
  const base = outcomeBase(state);
  return Object.freeze({
    status: 'integrity-failure',
    code: state.integrityFailure ?? 'unexpected-exception',
    ...base,
  });
}

function completeOutcome(
  state: CallState,
): ServiceFastExperimentRawCompleteOutcome {
  const outcome: ServiceFastExperimentRawCompleteOutcome = Object.freeze({
    status: 'complete',
    ...outcomeBase(state),
  });
  completeOutcomeStates.set(outcome, state);
  return outcome;
}

/** @internal */
export function serviceFastExperimentCallProgress(
  call: ServiceFastExperimentOperationalCall,
): ServiceFastExperimentOutcome | ServiceFastExperimentCheckpoint {
  const state = callStateOf(call);
  try {
    const action = normalizeState(state);
    if (state.integrityFailure !== undefined) return integrityOutcome(state);
    if (action === undefined) {
      return completeOutcome(state);
    }
    const set = currentSet(state);
    if (set === undefined) {
      setIntegrityFailure(state, 'counter-invariant-failure');
      return integrityOutcome(state);
    }
    return checkpoint(state, set, action);
  } catch (error) {
    setIntegrityFailure(
      state,
      error instanceof ServiceFastExperimentAnchorParityError
        ? 'semantic-anchor-parity-mismatch'
        : 'unexpected-exception',
    );
    return integrityOutcome(state);
  }
}

/** @internal */
export function serviceFastExperimentCallSetSnapshot(
  call: ServiceFastExperimentOperationalCall,
  setIndex: number,
): ServiceFastExperimentCandidateSetSnapshot {
  const state = callStateOf(call);
  if (
    !Number.isSafeInteger(setIndex) ||
    setIndex < 0 ||
    setIndex >= state.sets.length
  ) {
    throw new TypeError('Service-fast experiment candidate set index is invalid.');
  }
  const set = state.sets[setIndex];
  if (set === undefined) throw new Error('Service-fast experiment set is unavailable.');
  return setSnapshot(state, set);
}

/** @internal */
export function runServiceFastOperationalPolicy(
  call: ServiceFastExperimentOperationalCall,
  observer?: ServiceFastExperimentPreActionObserver,
): ServiceFastExperimentOutcome {
  const state = callStateOf(call);
  if (observer !== undefined && typeof observer !== 'function') {
    throw new TypeError('Service-fast experiment observer is invalid.');
  }
  while (true) {
    let action: ServiceFastExperimentActionKind | undefined;
    try {
      action = normalizeState(state);
    } catch (error) {
      setIntegrityFailure(
        state,
        error instanceof ServiceFastExperimentAnchorParityError
          ? 'semantic-anchor-parity-mismatch'
          : 'unexpected-exception',
      );
    }
    if (state.integrityFailure !== undefined) return integrityOutcome(state);
    if (action === undefined) {
      return completeOutcome(state);
    }
    const set = currentSet(state);
    if (set === undefined) {
      setIntegrityFailure(state, 'counter-invariant-failure');
      return integrityOutcome(state);
    }
    const pending = checkpoint(state, set, action);
    const perKind = actionCounter(state, action);
    if (
      perKind.value >= perKind.cap ||
      pending.stageAggregate >= state.caps.stageAggregate
    ) {
      const outcome: ServiceFastExperimentRawStoppedOutcome = Object.freeze({
        status: 'stopped',
        reason: 'action-cap',
        nextAction: pending,
        ...outcomeBase(state),
      });
      stoppedOutcomeCalls.set(outcome, call);
      return outcome;
    }
    if (observer !== undefined) {
      let stopped: unknown;
      try {
        stopped = observer(pending);
      } catch {
        setIntegrityFailure(state, 'unexpected-exception');
        return integrityOutcome(state);
      }
      if (typeof stopped !== 'boolean') {
        setIntegrityFailure(state, 'unexpected-exception');
        return integrityOutcome(state);
      }
      if (stopped) {
        const outcome: ServiceFastExperimentRawStoppedOutcome = Object.freeze({
          status: 'stopped',
          reason: 'observer',
          nextAction: pending,
          ...outcomeBase(state),
        });
        stoppedOutcomeCalls.set(outcome, call);
        return outcome;
      }
    }
    precharge(state, set, action);
    try {
      executeAction(state, set, action);
    } catch (error) {
      setIntegrityFailure(
        state,
        error instanceof ServiceFastExperimentAnchorParityError
          ? 'semantic-anchor-parity-mismatch'
          : 'unexpected-exception',
      );
    }
    const maximum = serviceFastExperimentMaximumCapsForPolicy(
      state.policy.policyIndex,
    );
    const aggregate = stageAggregate(state.counters);
    if (
      aggregate > maximum.stageAggregate ||
      aggregate + state.modelRouteSetupSteps > maximum.conservativeAggregate
    ) {
      setIntegrityFailure(state, 'counter-invariant-failure');
    }
  }
}

/** @internal */
export function evaluateServiceFastSemanticPolicy(
  cell: ServiceFastExperimentCell,
  policyIndex: number,
): ServiceFastExperimentSemanticOutcome {
  const authority = runServiceFastOperationalPolicy(
    createCall(cell, policyIndex, 'semantic'),
  );
  if (authority.status !== 'complete') return authority;
  if (policyIndex !== 0) {
    const finalized = finalizeClassifiedComplete(authority);
    if (finalized === undefined) return parityFailureFrom(authority);
    semanticOutcomeCells.set(finalized, cellStateOf(cell));
    finalizedCompleteOutcomes.add(finalized);
    return finalized;
  }
  const shadow = runServiceFastOperationalPolicy(
    createCall(
      cell,
      policyIndex,
      'semantic',
      undefined,
      'configurable-shadow',
    ),
  );
  const protectedFine = runServiceFastOperationalPolicy(
    createCall(cell, policyIndex, 'operational'),
  );
  if (shadow.status !== 'complete' || protectedFine.status !== 'complete') {
    return parityFailureFrom(authority);
  }
  const classifiedAuthority = mergeValidatedAnchorOutcome(
    authority,
    shadow,
    'semantic',
  );
  if (classifiedAuthority.status !== 'complete') return classifiedAuthority;
  const validatedFine = mergeValidatedAnchorOutcome(
    protectedFine,
    classifiedAuthority,
    'operational',
    cellStateOf(cell).identity.amountIn,
  );
  if (validatedFine.status !== 'complete') {
    return parityFailureFrom(authority);
  }
  const finalized = mergeValidatedAnchorOutcome(
    authority,
    validatedFine,
    'semantic',
  );
  if (finalized.status === 'complete') {
    semanticOutcomeCells.set(finalized, cellStateOf(cell));
    finalizedCompleteOutcomes.add(finalized);
  }
  return finalized;
}

function bigintVectorsEqual(
  left: readonly bigint[],
  right: readonly bigint[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function scoresEqual(
  left: ServiceFastExperimentScoreEvidence | null,
  right: ServiceFastExperimentScoreEvidence | null,
): boolean {
  return left === null && right === null ||
    left !== null &&
    right !== null &&
    left.source === right.source &&
    left.attemptIndex === right.attemptIndex &&
    left.receiptHash === right.receiptHash &&
    bigintVectorsEqual(left.allocations, right.allocations) &&
    serviceFastExperimentReceiptsEqual(left.receipt, right.receipt);
}

function currentAttemptsEqual(
  left: readonly ServiceFastExperimentCurrentAttempt[],
  right: readonly ServiceFastExperimentCurrentAttempt[],
): boolean {
  return left.length === right.length && left.every((attempt, index) => {
    const other = right[index];
    return other !== undefined &&
      attempt.attemptIndex === other.attemptIndex &&
      attempt.residualUnitsRemaining === other.residualUnitsRemaining &&
      attempt.routeIndex === other.routeIndex &&
      attempt.outcome === other.outcome &&
      attempt.failureCode === other.failureCode &&
      bigintVectorsEqual(attempt.allocations, other.allocations) &&
      (attempt.receipt === null && other.receipt === null ||
        attempt.receipt !== null &&
        other.receipt !== null &&
        serviceFastExperimentReceiptsEqual(attempt.receipt, other.receipt));
  });
}

function repairAttemptsEqual(
  left: readonly ServiceFastExperimentRepairAttempt[],
  right: readonly ServiceFastExperimentRepairAttempt[],
): boolean {
  return left.length === right.length && left.every((attempt, index) => {
    const other = right[index];
    return other !== undefined &&
      attempt.attemptIndex === other.attemptIndex &&
      attempt.neighborIndex === other.neighborIndex &&
      attempt.outcome === other.outcome &&
      attempt.failureCode === other.failureCode &&
      bigintVectorsEqual(attempt.allocations, other.allocations) &&
      (attempt.receipt === null && other.receipt === null ||
        attempt.receipt !== null &&
        other.receipt !== null &&
        serviceFastExperimentReceiptsEqual(attempt.receipt, other.receipt));
  });
}

function metadataEqual(
  left: ServiceFastPathShadowPriceProposalMetadata | null,
  right: ServiceFastPathShadowPriceProposalMetadata | null,
): boolean {
  return left === null && right === null ||
    left !== null &&
      right !== null &&
      serviceFastExperimentMetadataEquals(left, right);
}

function reconstructionsEqual(
  left: ServiceFastPathShadowPriceReconstruction | null,
  right: ServiceFastPathShadowPriceReconstruction | null,
  allowLeftMissing: boolean,
): boolean {
  return allowLeftMissing && left === null ||
    left === null && right === null ||
    left !== null &&
      right !== null &&
      serviceFastExperimentReconstructionEquals(left, right);
}

function repairEvidenceEqual(
  left: ServiceFastExperimentRepairEvidence | null,
  right: ServiceFastExperimentRepairEvidence | null,
): boolean {
  return left === null && right === null ||
    left !== null &&
      right !== null &&
      left.target === right.target &&
      left.complete === right.complete &&
      left.failureCode === right.failureCode &&
      repairAttemptsEqual(left.attempts, right.attempts) &&
      scoresEqual(left.winner, right.winner);
}

function rawCountersEqual(
  left: ServiceFastExperimentRawCounters,
  right: ServiceFastExperimentRawCounters,
): boolean {
  return left.methodActions === right.methodActions &&
    left.outerUpdates === right.outerUpdates &&
    left.shareActions === right.shareActions &&
    left.reconstructionSteps === right.reconstructionSteps &&
    left.residualReplays === right.residualReplays &&
    left.residualRejections === right.residualRejections &&
    left.repairReplays === right.repairReplays &&
    left.repairRejections === right.repairRejections &&
    left.authorizationReplays === right.authorizationReplays &&
    left.authorizationRejections === right.authorizationRejections &&
    left.proposals === right.proposals &&
    left.diagnostics === right.diagnostics;
}

function attributableDownstreamCountersEqual(
  left: ServiceFastExperimentRawCounters,
  right: ServiceFastExperimentRawCounters,
): boolean {
  return left.residualReplays === right.residualReplays &&
    left.residualRejections === right.residualRejections &&
    left.repairReplays === right.repairReplays &&
    left.repairRejections === right.repairRejections &&
    left.authorizationReplays === right.authorizationReplays &&
    left.authorizationRejections === right.authorizationRejections &&
    left.proposals === right.proposals &&
    left.diagnostics === right.diagnostics;
}

function operationalFineCountersEqual(
  authority: ServiceFastExperimentRawCounters,
  shadow: ServiceFastExperimentRawCounters,
): boolean {
  return authority.methodActions === null &&
    shadow.methodActions !== null &&
    authority.outerUpdates === shadow.outerUpdates &&
    authority.shareActions === shadow.shareActions &&
    authority.reconstructionSteps === shadow.reconstructionSteps;
}

function prefixCountersEqual(
  authority: ServiceFastExperimentRawCounters,
  shadow: ServiceFastExperimentRawCounters,
  protectedAnchor: boolean,
): boolean {
  return protectedAnchor
    ? operationalFineCountersEqual(authority, shadow)
    : rawCountersEqual(authority, shadow);
}

/** Applies the production elementwise counter admission relation. @internal */
export function serviceFastExperimentCounterVectorsMatch(
  authority: readonly ServiceFastExperimentRawCounters[],
  shadow: readonly ServiceFastExperimentRawCounters[],
  mode: 'protected-operational' | 'configurable-exact',
): boolean {
  const protectedAnchor = mode === 'protected-operational';
  return authority.length === shadow.length &&
    authority.every((counters, index) => {
      const other = shadow[index];
      return other !== undefined &&
        prefixCountersEqual(counters, other, protectedAnchor);
    });
}

function proposalFailuresEqual(
  left: ServiceFastExperimentProposalFailureEvidence | null,
  right: ServiceFastExperimentProposalFailureEvidence | null,
): boolean {
  return left === null && right === null ||
    left !== null &&
      right !== null &&
      left.failureCode === right.failureCode &&
      left.converged === right.converged &&
      left.completedOuterUpdates === right.completedOuterUpdates;
}

function diagnosticsEqual(
  left: ServiceFastExperimentCandidateSetDiagnostic,
  right: ServiceFastExperimentCandidateSetDiagnostic,
  allowLeftMissingReconstruction: boolean,
): boolean {
  return left.setIndex === right.setIndex &&
    left.status === right.status &&
    left.failureCode === right.failureCode &&
    attributableDownstreamCountersEqual(left.counters, right.counters) &&
    proposalFailuresEqual(left.proposalFailure, right.proposalFailure) &&
    left.reconstructionDisposition === right.reconstructionDisposition &&
    metadataEqual(left.proposalMetadata, right.proposalMetadata) &&
    reconstructionsEqual(
      left.reconstruction,
      right.reconstruction,
      allowLeftMissingReconstruction,
    ) &&
    left.initialResidualUnits === right.initialResidualUnits &&
    currentAttemptsEqual(left.currentAttempts, right.currentAttempts) &&
    scoresEqual(left.currentScore, right.currentScore) &&
    repairEvidenceEqual(left.repair, right.repair) &&
    scoresEqual(left.selectedScore, right.selectedScore) &&
    (left.authorizationReceipt === null && right.authorizationReceipt === null ||
      left.authorizationReceipt !== null &&
      right.authorizationReceipt !== null &&
      serviceFastExperimentReceiptsEqual(
        left.authorizationReceipt,
        right.authorizationReceipt,
      ));
}

function setSnapshotsEqual(
  left: ServiceFastExperimentCandidateSetSnapshot,
  right: ServiceFastExperimentCandidateSetSnapshot,
  allowLeftMissingReconstruction: boolean,
): boolean {
  return left.setIndex === right.setIndex &&
    attributableDownstreamCountersEqual(left.counters, right.counters) &&
    left.stage === right.stage &&
    left.reconstructionDisposition === right.reconstructionDisposition &&
    metadataEqual(left.proposalMetadata, right.proposalMetadata) &&
    reconstructionsEqual(
      left.reconstruction,
      right.reconstruction,
      allowLeftMissingReconstruction,
    ) &&
    left.initialResidualUnits === right.initialResidualUnits &&
    currentAttemptsEqual(left.currentAttempts, right.currentAttempts) &&
    scoresEqual(left.currentScore, right.currentScore) &&
    repairEvidenceEqual(left.repair, right.repair) &&
    scoresEqual(left.selectedScore, right.selectedScore) &&
    proposalFailuresEqual(left.proposalFailure, right.proposalFailure) &&
    (left.terminalDiagnostic === null && right.terminalDiagnostic === null ||
      left.terminalDiagnostic !== null &&
        right.terminalDiagnostic !== null &&
        diagnosticsEqual(
          left.terminalDiagnostic,
          right.terminalDiagnostic,
          allowLeftMissingReconstruction,
        ));
}

interface CounterPartitionEvidence {
  readonly counters: ServiceFastExperimentRawCounters;
  readonly diagnostics: readonly ServiceFastExperimentCandidateSetDiagnostic[];
  readonly setSnapshots: readonly ServiceFastExperimentCandidateSetSnapshot[];
}

function attemptEvidenceIsValid(
  attempt: ServiceFastExperimentCurrentAttempt | ServiceFastExperimentRepairAttempt,
): boolean {
  return attempt.outcome === 'rejected'
    ? attempt.failureCode !== null && attempt.receipt === null
    : attempt.failureCode === null && attempt.receipt !== null;
}

function counterPartitionInvariant(outcome: CounterPartitionEvidence): boolean {
  const snapshots = outcome.setSnapshots;
  if (snapshots.length === 0) {
    return outcome.diagnostics.length === 0 && COUNTER_KEYS.every((key) =>
      key === 'methodActions'
        ? outcome.counters.methodActions === null ||
          outcome.counters.methodActions === 0
        : outcome.counters[key] === 0);
  }
  for (const key of COUNTER_KEYS) {
    const parent = outcome.counters[key];
    const values = snapshots.map((snapshot) => snapshot.counters[key]);
    if (key === 'methodActions') {
      if (parent === null) {
        if (!values.every((value) => value === null)) return false;
      } else if (
        !values.every((value): value is number => typeof value === 'number') ||
        values.reduce<number>((sum, value) => sum + value, 0) !== parent
      ) {
        return false;
      }
      continue;
    }
    if (values.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== parent) {
      return false;
    }
  }
  if (outcome.counters.diagnostics !== outcome.diagnostics.length) return false;
  for (const snapshot of snapshots) {
    const values = COUNTER_KEYS
      .map((key) => snapshot.counters[key])
      .filter((value): value is number => value !== null);
    if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      return false;
    }
    if (
      !snapshot.currentAttempts.every(attemptEvidenceIsValid) ||
      !(snapshot.repair?.attempts.every(attemptEvidenceIsValid) ?? true)
    ) {
      return false;
    }
    const diagnostic = outcome.diagnostics.find(
      (candidate) => candidate.setIndex === snapshot.setIndex,
    );
    if (snapshot.terminalDiagnostic === null) {
      if (snapshot.stage === 'terminal' || snapshot.counters.diagnostics !== 0) {
        return false;
      }
      continue;
    }
    if (
      snapshot.stage !== 'terminal' ||
      snapshot.counters.diagnostics !== 1 ||
      diagnostic === undefined ||
      !diagnosticsEqual(snapshot.terminalDiagnostic, diagnostic, false) ||
      !rawCountersEqual(snapshot.counters, diagnostic.counters) ||
      !proposalFailuresEqual(snapshot.proposalFailure, diagnostic.proposalFailure)
    ) {
      return false;
    }
  }
  return outcome.diagnostics.every((diagnostic) => {
    const snapshot = snapshots.find(
      (candidate) => candidate.setIndex === diagnostic.setIndex,
    );
    return snapshot !== undefined &&
      diagnostic.counters.diagnostics === 1 &&
      diagnostic.currentAttempts.every(attemptEvidenceIsValid) &&
      (diagnostic.repair?.attempts.every(attemptEvidenceIsValid) ?? true);
  });
}

function completeOutcomesEqual(
  authority: ServiceFastExperimentRawCompleteOutcome,
  shadow: ServiceFastExperimentRawCompleteOutcome,
  allowAuthorityMissingReconstruction: boolean,
): boolean {
  if (
    !counterPartitionInvariant(authority) ||
    !counterPartitionInvariant(shadow) ||
    authority.policy.policyId !== shadow.policy.policyId ||
    authority.modelRouteSetupSteps !== shadow.modelRouteSetupSteps ||
    authority.diagnostics.length !== shadow.diagnostics.length ||
    authority.setSnapshots.length !== shadow.setSnapshots.length ||
    authority.counters.proposals !== shadow.counters.proposals ||
    authority.counters.residualReplays !== shadow.counters.residualReplays ||
    authority.counters.residualRejections !== shadow.counters.residualRejections ||
    authority.counters.repairReplays !== shadow.counters.repairReplays ||
    authority.counters.repairRejections !== shadow.counters.repairRejections ||
    authority.counters.authorizationReplays !==
      shadow.counters.authorizationReplays ||
    authority.counters.authorizationRejections !==
      shadow.counters.authorizationRejections ||
    authority.counters.diagnostics !== shadow.counters.diagnostics ||
    authority.anyValidScore !== shadow.anyValidScore ||
    authority.anyImprovement !== shadow.anyImprovement ||
    authority.entryIncumbent === null !== (shadow.entryIncumbent === null) ||
    authority.finalIncumbent === null !== (shadow.finalIncumbent === null) ||
    (authority.entryIncumbent !== null && shadow.entryIncumbent !== null &&
      !serviceFastExperimentReceiptsEqual(
        authority.entryIncumbent,
        shadow.entryIncumbent,
      )) ||
    (authority.finalIncumbent !== null && shadow.finalIncumbent !== null &&
      !serviceFastExperimentReceiptsEqual(
        authority.finalIncumbent,
        shadow.finalIncumbent,
      ))
  ) {
    return false;
  }
  return authority.diagnostics.every((diagnostic, index) => {
    const other = shadow.diagnostics[index];
    return other !== undefined && diagnosticsEqual(
      diagnostic,
      other,
      allowAuthorityMissingReconstruction,
    );
  }) && authority.setSnapshots.every((snapshot, index) => {
    const other = shadow.setSnapshots[index];
    return other !== undefined && setSnapshotsEqual(
      snapshot,
      other,
      allowAuthorityMissingReconstruction,
    );
  });
}

function parityFailureFrom(
  outcome: ServiceFastExperimentRawCompleteOutcome,
): ServiceFastExperimentIntegrityFailureOutcome {
  return Object.freeze({
    ...outcome,
    status: 'integrity-failure',
    code: 'semantic-anchor-parity-mismatch',
  });
}

function finalizeClassifiedComplete(
  outcome: ServiceFastExperimentRawCompleteOutcome,
): ServiceFastExperimentCompleteOutcome | undefined {
  const methodActions = outcome.counters.methodActions;
  if (methodActions === null || !counterPartitionInvariant(outcome)) return undefined;
  const counters: ServiceFastExperimentCounters = Object.freeze({
    ...outcome.counters,
    methodActions,
  });
  return Object.freeze({ ...outcome, counters });
}

function isClassifiedComplete(
  outcome: ServiceFastExperimentRawCompleteOutcome,
): outcome is ServiceFastExperimentCompleteOutcome {
  return outcome.counters.methodActions !== null;
}

type ValidatedReconstruction =
  | {
      readonly ok: true;
      readonly value: ServiceFastPathShadowPriceReconstruction | null;
    }
  | { readonly ok: false };

function reconstructionAmountIn(
  reconstruction: ServiceFastPathShadowPriceReconstruction,
): bigint {
  return reconstruction.baseAllocations.reduce(
    (sum, allocation) => sum + allocation,
    reconstruction.residualUnits,
  );
}

function validateProtectedReconstruction(
  metadata: ServiceFastPathShadowPriceProposalMetadata | null,
  raw: ServiceFastPathShadowPriceReconstruction | null,
  expected: ServiceFastPathShadowPriceReconstruction | null,
  amountIn: bigint | undefined,
): ValidatedReconstruction {
  if (raw !== null) {
    return expected !== null &&
        serviceFastExperimentReconstructionEquals(raw, expected)
      ? Object.freeze({ ok: true, value: copyReconstruction(raw) })
      : Object.freeze({ ok: false });
  }
  if (expected === null) return Object.freeze({ ok: true, value: null });
  if (metadata === null) return Object.freeze({ ok: false });
  const reconstructed = reconstructPathShadowPriceBase(
    amountIn ?? reconstructionAmountIn(expected),
    metadata.weights,
  );
  if (!reconstructed.ok) return Object.freeze({ ok: false });
  const protectedValue: ServiceFastPathShadowPriceReconstruction = Object.freeze({
    integerWeights: Object.freeze([...reconstructed.value.integerWeights]),
    baseAllocations: Object.freeze([...reconstructed.value.baseAllocations]),
    residualUnits: reconstructed.value.residualUnits,
  });
  return serviceFastExperimentReconstructionEquals(protectedValue, expected)
    ? Object.freeze({ ok: true, value: copyReconstruction(expected) })
    : Object.freeze({ ok: false });
}

function mergeAnchorCounters(
  authority: ServiceFastExperimentRawCounters,
  shadow: ServiceFastExperimentRawCounters,
): ServiceFastExperimentCounters | undefined {
  if (shadow.methodActions === null) return undefined;
  return Object.freeze({
    ...authority,
    methodActions: shadow.methodActions,
    outerUpdates: shadow.outerUpdates,
    shareActions: shadow.shareActions,
    reconstructionSteps: shadow.reconstructionSteps,
  });
}

function mergeValidatedAnchorOutcome(
  authority: ServiceFastExperimentRawCompleteOutcome,
  shadow: ServiceFastExperimentRawCompleteOutcome,
  adapterMode: 'semantic' | 'operational',
  amountIn?: bigint,
): ServiceFastExperimentCompleteOutcome | ServiceFastExperimentIntegrityFailureOutcome {
  if (
    shadow.counters.methodActions === null ||
    !completeOutcomesEqual(
      authority,
      shadow,
      adapterMode === 'operational',
    ) ||
    (adapterMode === 'operational' &&
      (!operationalFineCountersEqual(authority.counters, shadow.counters) ||
        !serviceFastExperimentCounterVectorsMatch(
          authority.diagnostics.map((diagnostic) => diagnostic.counters),
          shadow.diagnostics.map((diagnostic) => diagnostic.counters),
          'protected-operational',
        ) ||
        !serviceFastExperimentCounterVectorsMatch(
          authority.setSnapshots.map((snapshot) => snapshot.counters),
          shadow.setSnapshots.map((snapshot) => snapshot.counters),
          'protected-operational',
        )))
  ) {
    return parityFailureFrom(authority);
  }
  const counters = mergeAnchorCounters(authority.counters, shadow.counters);
  if (counters === undefined) return parityFailureFrom(authority);
  const aggregate = counters.proposals +
    counters.shareActions +
    counters.reconstructionSteps +
    counters.residualReplays +
    counters.repairReplays +
    counters.authorizationReplays;
  let diagnostics: readonly ServiceFastExperimentCandidateSetDiagnostic[];
  let setSnapshots: readonly ServiceFastExperimentCandidateSetSnapshot[];
  try {
    diagnostics = Object.freeze(authority.diagnostics.map((diagnostic, index) => {
      const shadowDiagnostic = shadow.diagnostics[index];
      if (shadowDiagnostic === undefined) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      if (
        adapterMode === 'operational' &&
        !operationalFineCountersEqual(
          diagnostic.counters,
          shadowDiagnostic.counters,
        )
      ) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      const diagnosticCounters = mergeAnchorCounters(
        diagnostic.counters,
        shadowDiagnostic.counters,
      );
      if (diagnosticCounters === undefined) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      const reconstruction = validateProtectedReconstruction(
        diagnostic.proposalMetadata,
        diagnostic.reconstruction,
        shadowDiagnostic.reconstruction,
        amountIn,
      );
      if (!reconstruction.ok) throw new ServiceFastExperimentAnchorParityError();
      return Object.freeze({
        ...diagnostic,
        counters: diagnosticCounters,
        reconstruction: reconstruction.value,
      });
    }));
    setSnapshots = Object.freeze(authority.setSnapshots.map((snapshot, index) => {
      const shadowSnapshot = shadow.setSnapshots[index];
      if (shadowSnapshot === undefined) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      if (
        adapterMode === 'operational' &&
        !operationalFineCountersEqual(
          snapshot.counters,
          shadowSnapshot.counters,
        )
      ) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      const snapshotCounters = mergeAnchorCounters(
        snapshot.counters,
        shadowSnapshot.counters,
      );
      if (snapshotCounters === undefined) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      const reconstruction = validateProtectedReconstruction(
        snapshot.proposalMetadata,
        snapshot.reconstruction,
        shadowSnapshot.reconstruction,
        amountIn,
      );
      if (!reconstruction.ok) throw new ServiceFastExperimentAnchorParityError();
      const terminalDiagnostic = snapshot.terminalDiagnostic === null
        ? null
        : diagnostics.find(
          (diagnostic) => diagnostic.setIndex === snapshot.setIndex,
        ) ?? null;
      if (snapshot.terminalDiagnostic !== null && terminalDiagnostic === null) {
        throw new ServiceFastExperimentAnchorParityError();
      }
      return Object.freeze({
        ...snapshot,
        counters: snapshotCounters,
        reconstruction: reconstruction.value,
        terminalDiagnostic,
      });
    }));
  } catch {
    return parityFailureFrom(authority);
  }
  return Object.freeze({
    ...authority,
    adapterMode,
    counters,
    stageAggregate: aggregate,
    conservativeAggregate: aggregate + authority.modelRouteSetupSteps,
    diagnostics,
    setSnapshots,
  });
}

/** @internal */
export type ValidateServiceFastCompleteOutcomeResult =
  | { readonly ok: true; readonly value: ServiceFastExperimentCompleteOutcome }
  | {
      readonly ok: false;
      readonly code:
        | 'semantic-anchor-parity-mismatch'
        | 'exact-replay-mismatch'
        | 'counter-invariant-failure';
    };

/** @internal */
export function validateServiceFastCompleteOutcome(
  operational: ServiceFastExperimentOutcome,
  semantic: ServiceFastExperimentOutcome,
): ValidateServiceFastCompleteOutcomeResult {
  if (
    operational.status !== 'complete' ||
    semantic.status !== 'complete' ||
    !isClassifiedComplete(semantic) ||
    consumedRawCompleteOutcomes.has(operational) ||
    !completeOutcomeStates.has(operational) ||
    !semanticOutcomeCells.has(semantic) ||
    !counterPartitionInvariant(operational) ||
    !counterPartitionInvariant(semantic) ||
    completeOutcomeStates.get(operational)?.cell !==
      semanticOutcomeCells.get(semantic)
  ) {
    return Object.freeze({ ok: false, code: 'counter-invariant-failure' });
  }
  const parityFailureCode = classifyServiceFastExperimentValidationMismatch(
    operational.policy.policyIndex,
    'operational-parity',
  );
  if (
    operational.policy.policyId !== semantic.policy.policyId ||
    operational.diagnostics.length !== semantic.diagnostics.length ||
    operational.finalIncumbent === null !== (semantic.finalIncumbent === null) ||
    (operational.finalIncumbent !== null && semantic.finalIncumbent !== null &&
      !serviceFastExperimentReceiptsEqual(
        operational.finalIncumbent,
        semantic.finalIncumbent,
      ))
  ) {
    return Object.freeze({ ok: false, code: parityFailureCode });
  }
  const merged = operational.policy.policyIndex === 0
    ? mergeValidatedAnchorOutcome(operational, semantic, 'operational')
    : completeOutcomesEqual(operational, semantic, false)
      ? finalizeClassifiedComplete(operational) ?? parityFailureFrom(operational)
      : parityFailureFrom(operational);
  if (merged.status !== 'complete') {
    return Object.freeze({ ok: false, code: parityFailureCode });
  }
  consumedRawCompleteOutcomes.add(operational);
  finalizedCompleteOutcomes.add(merged);
  return Object.freeze({ ok: true, value: merged });
}

const NON_METHOD_COUNTER_KEYS = Object.freeze([
  'outerUpdates',
  'shareActions',
  'reconstructionSteps',
  'residualReplays',
  'residualRejections',
  'repairReplays',
  'repairRejections',
  'authorizationReplays',
  'authorizationRejections',
  'proposals',
  'diagnostics',
] as const);

function nonMethodCountersEqual(
  left: ServiceFastExperimentRawCounters,
  right: ServiceFastExperimentRawCounters,
): boolean {
  return NON_METHOD_COUNTER_KEYS.every((key) => left[key] === right[key]);
}

function counterTargetRelation(
  counters: ServiceFastExperimentRawCounters,
  target: ServiceFastExperimentRawCounters,
): 'before' | 'equal' | 'diverged' {
  if (NON_METHOD_COUNTER_KEYS.some((key) => counters[key] > target[key])) {
    return 'diverged';
  }
  if (nonMethodCountersEqual(counters, target)) return 'equal';
  const aggregate = counters.proposals +
    counters.shareActions +
    counters.reconstructionSteps +
    counters.residualReplays +
    counters.repairReplays +
    counters.authorizationReplays;
  const targetAggregate = target.proposals +
    target.shareActions +
    target.reconstructionSteps +
    target.residualReplays +
    target.repairReplays +
    target.authorizationReplays;
  return aggregate >= targetAggregate ? 'diverged' : 'before';
}

type ActionFamily =
  | 'proposal'
  | 'share'
  | 'reconstruction'
  | 'residual'
  | 'repair'
  | 'authorization';

function actionFamily(kind: ServiceFastExperimentActionKind): ActionFamily {
  if (kind === 'proposal') return 'proposal';
  if (kind === 'reconstruction-step') return 'reconstruction';
  if (kind === 'residual-replay') return 'residual';
  if (kind === 'repair-replay') return 'repair';
  if (kind === 'authorization-replay') return 'authorization';
  return 'share';
}

function nullableReceiptsEqual(
  left: ExactInputSplitReplayReceipt | null,
  right: ExactInputSplitReplayReceipt | null,
): boolean {
  return left === null && right === null ||
    left !== null &&
      right !== null &&
      serviceFastExperimentReceiptsEqual(left, right);
}

function checkpointsMatchBoundary(
  left: ServiceFastExperimentCheckpoint,
  right: ServiceFastExperimentCheckpoint,
): boolean {
  return left.policyIndex === right.policyIndex &&
    left.policyId === right.policyId &&
    left.setIndex === right.setIndex &&
    actionFamily(left.actionKind) === actionFamily(right.actionKind) &&
    nonMethodCountersEqual(left.counters, right.counters) &&
    left.modelRouteSetupSteps === right.modelRouteSetupSteps &&
    left.stageAggregate === right.stageAggregate &&
    left.conservativeAggregate === right.conservativeAggregate &&
    left.anyValidScore === right.anyValidScore &&
    left.anyImprovement === right.anyImprovement &&
    nullableReceiptsEqual(left.incumbent, right.incumbent);
}

function stoppedOutcomesMatchPrefix(
  authority: ServiceFastExperimentRawStoppedOutcome,
  shadow: ServiceFastExperimentRawStoppedOutcome,
  allowAuthorityMissingReconstruction: boolean,
): boolean {
  const counterMode = allowAuthorityMissingReconstruction
    ? 'protected-operational'
    : 'configurable-exact';
  return authority.reason === shadow.reason &&
    authority.policy.policyId === shadow.policy.policyId &&
    prefixCountersEqual(
      authority.counters,
      shadow.counters,
      allowAuthorityMissingReconstruction,
    ) &&
    checkpointsMatchBoundary(authority.nextAction, shadow.nextAction) &&
    prefixCountersEqual(
      authority.nextAction.counters,
      shadow.nextAction.counters,
      allowAuthorityMissingReconstruction,
    ) &&
    nonMethodCountersEqual(authority.counters, shadow.counters) &&
    authority.modelRouteSetupSteps === shadow.modelRouteSetupSteps &&
    authority.stageAggregate === shadow.stageAggregate &&
    authority.conservativeAggregate === shadow.conservativeAggregate &&
    authority.diagnostics.length === shadow.diagnostics.length &&
    authority.setSnapshots.length === shadow.setSnapshots.length &&
    serviceFastExperimentCounterVectorsMatch(
      authority.diagnostics.map((diagnostic) => diagnostic.counters),
      shadow.diagnostics.map((diagnostic) => diagnostic.counters),
      counterMode,
    ) &&
    serviceFastExperimentCounterVectorsMatch(
      authority.setSnapshots.map((snapshot) => snapshot.counters),
      shadow.setSnapshots.map((snapshot) => snapshot.counters),
      counterMode,
    ) &&
    authority.anyValidScore === shadow.anyValidScore &&
    authority.anyImprovement === shadow.anyImprovement &&
    nullableReceiptsEqual(authority.entryIncumbent, shadow.entryIncumbent) &&
    nullableReceiptsEqual(authority.finalIncumbent, shadow.finalIncumbent) &&
    authority.diagnostics.every((diagnostic, index) => {
      const other = shadow.diagnostics[index];
      return other !== undefined && diagnosticsEqual(
        diagnostic,
        other,
        allowAuthorityMissingReconstruction,
      ) && prefixCountersEqual(
        diagnostic.counters,
        other.counters,
        allowAuthorityMissingReconstruction,
      );
    }) &&
    authority.setSnapshots.every((snapshot, index) => {
      const other = shadow.setSnapshots[index];
      return other !== undefined && setSnapshotsEqual(
        snapshot,
        other,
        allowAuthorityMissingReconstruction,
      ) && prefixCountersEqual(
        snapshot.counters,
        other.counters,
        allowAuthorityMissingReconstruction,
      );
    });
}

function currentAttemptsArePrefix(
  prefix: readonly ServiceFastExperimentCurrentAttempt[],
  complete: readonly ServiceFastExperimentCurrentAttempt[],
): boolean {
  return prefix.length <= complete.length && currentAttemptsEqual(
    prefix,
    complete.slice(0, prefix.length),
  );
}

function repairAttemptsArePrefix(
  prefix: readonly ServiceFastExperimentRepairAttempt[],
  complete: readonly ServiceFastExperimentRepairAttempt[],
): boolean {
  return prefix.length <= complete.length && repairAttemptsEqual(
    prefix,
    complete.slice(0, prefix.length),
  );
}

function prefixSnapshotMatchesSemantic(
  prefix: ServiceFastExperimentCandidateSetSnapshot,
  complete: ServiceFastExperimentCandidateSetSnapshot,
): boolean {
  if (
    prefix.setIndex !== complete.setIndex ||
    (prefix.proposalMetadata !== null &&
      !metadataEqual(prefix.proposalMetadata, complete.proposalMetadata)) ||
    (prefix.reconstruction !== null &&
      !reconstructionsEqual(prefix.reconstruction, complete.reconstruction, false)) ||
    (prefix.initialResidualUnits !== null &&
      prefix.initialResidualUnits !== complete.initialResidualUnits) ||
    !currentAttemptsArePrefix(prefix.currentAttempts, complete.currentAttempts) ||
    (prefix.currentScore !== null &&
      !scoresEqual(prefix.currentScore, complete.currentScore)) ||
    (prefix.selectedScore !== null &&
      !scoresEqual(prefix.selectedScore, complete.selectedScore))
  ) {
    return false;
  }
  if (prefix.repair !== null) {
    if (
      complete.repair === null ||
      prefix.repair.target !== complete.repair.target ||
      !repairAttemptsArePrefix(prefix.repair.attempts, complete.repair.attempts) ||
      (prefix.repair.complete &&
        (!complete.repair.complete ||
          prefix.repair.failureCode !== complete.repair.failureCode ||
          !scoresEqual(prefix.repair.winner, complete.repair.winner)))
    ) {
      return false;
    }
  }
  return prefix.terminalDiagnostic === null ||
    complete.terminalDiagnostic !== null &&
      diagnosticsEqual(prefix.terminalDiagnostic, complete.terminalDiagnostic, false);
}

function outcomeCounterInvariant(
  outcome: ServiceFastExperimentRawStoppedOutcome,
): boolean {
  const counters = outcome.counters;
  const values = NON_METHOD_COUNTER_KEYS.map((key) => counters[key]);
  if (counters.methodActions !== null) values.push(counters.methodActions);
  const aggregate = counters.proposals +
    counters.shareActions +
    counters.reconstructionSteps +
    counters.residualReplays +
    counters.repairReplays +
    counters.authorizationReplays;
  const maximum = serviceFastExperimentMaximumCapsForPolicy(
    outcome.policy.policyIndex,
  );
  return counterPartitionInvariant(outcome) && values.every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  ) &&
    aggregate === outcome.stageAggregate &&
    aggregate + outcome.modelRouteSetupSteps === outcome.conservativeAggregate &&
    outcome.stageAggregate <= maximum.stageAggregate &&
    outcome.conservativeAggregate <= maximum.conservativeAggregate &&
    counters.shareActions <= maximum.shareActions &&
    counters.reconstructionSteps <= maximum.reconstructionSteps &&
    counters.residualReplays <= maximum.residualReplays &&
    counters.repairReplays <= maximum.repairReplays &&
    counters.authorizationReplays <= maximum.authorizationReplays &&
    counters.proposals <= maximum.proposals &&
    counters.residualRejections <= counters.residualReplays &&
    counters.repairRejections <= counters.repairReplays &&
    counters.authorizationRejections <= counters.authorizationReplays &&
    counters.diagnostics === outcome.diagnostics.length;
}

function mergePrefixDiagnostic(
  raw: ServiceFastExperimentCandidateSetDiagnostic,
  shadow: ServiceFastExperimentCandidateSetDiagnostic,
  semantic: ServiceFastExperimentCandidateSetDiagnostic,
  amountIn: bigint,
  protectedAnchor: boolean,
): ServiceFastExperimentCandidateSetDiagnostic | undefined {
  if (!prefixCountersEqual(raw.counters, shadow.counters, protectedAnchor)) {
    return undefined;
  }
  const counters = mergeAnchorCounters(raw.counters, shadow.counters);
  if (counters === undefined) return undefined;
  const expected = shadow.reconstruction === null
    ? null
    : semantic.reconstruction;
  if (
    (shadow.reconstruction !== null && expected === null) ||
    !reconstructionsEqual(shadow.reconstruction, expected, false)
  ) {
    return undefined;
  }
  const reconstruction = validateProtectedReconstruction(
    raw.proposalMetadata,
    raw.reconstruction,
    expected,
    amountIn,
  );
  return reconstruction.ok
    ? Object.freeze({
        ...raw,
        counters,
        reconstruction: reconstruction.value,
      })
    : undefined;
}

function finalizeValidatedPrefix(
  raw: ServiceFastExperimentRawStoppedOutcome,
  shadow: ServiceFastExperimentRawStoppedOutcome,
  semantic: ServiceFastExperimentCompleteOutcome,
  amountIn: bigint,
  protectedAnchor: boolean,
): ServiceFastExperimentStoppedOutcome | undefined {
  const methodActions = shadow.counters.methodActions;
  const checkpointMethodActions = shadow.nextAction.counters.methodActions;
  if (
    methodActions === null ||
    checkpointMethodActions === null ||
    !prefixCountersEqual(raw.counters, shadow.counters, protectedAnchor) ||
    !prefixCountersEqual(
      raw.nextAction.counters,
      shadow.nextAction.counters,
      protectedAnchor,
    )
  ) {
    return undefined;
  }
  const diagnostics: ServiceFastExperimentCandidateSetDiagnostic[] = [];
  for (let index = 0; index < raw.diagnostics.length; index += 1) {
    const rawDiagnostic = raw.diagnostics[index];
    const shadowDiagnostic = shadow.diagnostics[index];
    if (rawDiagnostic === undefined || shadowDiagnostic === undefined) return undefined;
    const semanticDiagnostic = semantic.diagnostics.find(
      (diagnostic) => diagnostic.setIndex === rawDiagnostic.setIndex,
    );
    if (semanticDiagnostic === undefined) return undefined;
    const merged = mergePrefixDiagnostic(
      rawDiagnostic,
      shadowDiagnostic,
      semanticDiagnostic,
      amountIn,
      protectedAnchor,
    );
    if (merged === undefined) return undefined;
    diagnostics.push(merged);
  }
  const setSnapshots: ServiceFastExperimentCandidateSetSnapshot[] = [];
  for (let index = 0; index < raw.setSnapshots.length; index += 1) {
    const rawSnapshot = raw.setSnapshots[index];
    const shadowSnapshot = shadow.setSnapshots[index];
    const semanticSnapshot = semantic.setSnapshots[index];
    if (
      rawSnapshot === undefined ||
      shadowSnapshot === undefined ||
      semanticSnapshot === undefined ||
      !prefixSnapshotMatchesSemantic(shadowSnapshot, semanticSnapshot)
    ) {
      return undefined;
    }
    const expected = shadowSnapshot.reconstruction === null
      ? null
      : semanticSnapshot.reconstruction;
    if (
      (shadowSnapshot.reconstruction !== null && expected === null) ||
      !reconstructionsEqual(shadowSnapshot.reconstruction, expected, false)
    ) {
      return undefined;
    }
    const reconstruction = validateProtectedReconstruction(
      rawSnapshot.proposalMetadata,
      rawSnapshot.reconstruction,
      expected,
      amountIn,
    );
    if (!reconstruction.ok) return undefined;
    const snapshotCounters = mergeAnchorCounters(
      rawSnapshot.counters,
      shadowSnapshot.counters,
    );
    if (
      !prefixCountersEqual(
        rawSnapshot.counters,
        shadowSnapshot.counters,
        protectedAnchor,
      ) ||
      snapshotCounters === undefined
    ) {
      return undefined;
    }
    const terminalDiagnostic = rawSnapshot.terminalDiagnostic === null
      ? null
      : diagnostics.find(
        (diagnostic) => diagnostic.setIndex === rawSnapshot.setIndex,
      ) ?? null;
    if (rawSnapshot.terminalDiagnostic !== null && terminalDiagnostic === null) {
      return undefined;
    }
    setSnapshots.push(Object.freeze({
      ...rawSnapshot,
      counters: snapshotCounters,
      reconstruction: reconstruction.value,
      terminalDiagnostic,
    }));
  }
  const counters: ServiceFastExperimentCounters = Object.freeze({
    ...raw.counters,
    methodActions,
  });
  const checkpointCounters: ServiceFastExperimentCounters = Object.freeze({
    ...raw.nextAction.counters,
    methodActions: checkpointMethodActions,
  });
  const finalized: ServiceFastExperimentStoppedOutcome = Object.freeze({
    ...raw,
    counters,
    nextAction: Object.freeze({
      ...raw.nextAction,
      counters: checkpointCounters,
    }),
    diagnostics: Object.freeze(diagnostics),
    setSnapshots: Object.freeze(setSnapshots),
  });
  return outcomeCounterInvariant(finalized) ? finalized : undefined;
}

export type ValidateServiceFastDeadlinePrefixResult =
  | { readonly ok: true; readonly value: ServiceFastExperimentStoppedOutcome }
  | {
      readonly ok: false;
      readonly code:
        | 'counter-invariant-failure'
        | 'exact-replay-mismatch'
        | 'semantic-anchor-parity-mismatch';
    };

/** Replays and validates a stopped operational prefix outside the measured call. @internal */
export function validateServiceFastDeadlinePrefix(
  call: ServiceFastExperimentOperationalCall,
  outcome: ServiceFastExperimentRawStoppedOutcome,
  semantic: ServiceFastExperimentCompleteOutcome,
): ValidateServiceFastDeadlinePrefixResult {
  const state = callStateOf(call);
  const parityFailureCode = classifyServiceFastExperimentValidationMismatch(
    state.policy.policyIndex,
    'operational-parity',
  );
  if (
    stoppedOutcomeCalls.get(outcome) !== call ||
    consumedRawStoppedOutcomes.has(outcome) ||
    semanticOutcomeCells.get(semantic) !== state.cell ||
    outcome.policy.policyId !== semantic.policy.policyId ||
    !outcomeCounterInvariant(outcome)
  ) {
    return Object.freeze({ ok: false, code: 'counter-invariant-failure' });
  }
  if (
    outcome.entryIncumbent !== null && outcome.finalIncumbent === null ||
    outcome.entryIncumbent !== null &&
      outcome.finalIncumbent !== null &&
      serviceFastExperimentIsStrictlyBetter(
        outcome.entryIncumbent,
        outcome.finalIncumbent,
      )
  ) {
    return Object.freeze({ ok: false, code: 'exact-replay-mismatch' });
  }
  let currentAction: ServiceFastExperimentActionKind | undefined;
  try {
    currentAction = normalizeState(state);
  } catch {
    return Object.freeze({ ok: false, code: 'counter-invariant-failure' });
  }
  const activeSet = currentSet(state);
  if (currentAction === undefined || activeSet === undefined) {
    return Object.freeze({ ok: false, code: 'counter-invariant-failure' });
  }
  const currentCheckpoint = checkpoint(state, activeSet, currentAction);
  if (
    !checkpointsMatchBoundary(outcome.nextAction, currentCheckpoint) ||
    outcome.nextAction.actionKind !== currentCheckpoint.actionKind ||
    outcome.setSnapshots.some((snapshot, index) => {
      const current = state.sets[index];
      return current === undefined || !setSnapshotsEqual(
        snapshot,
        setSnapshot(state, current),
        false,
      );
    })
  ) {
    return Object.freeze({ ok: false, code: 'counter-invariant-failure' });
  }
  let diverged = false;
  const shadowCall = createCall(
    state.cellHandle,
    state.policy.policyIndex,
    'semantic',
    state.caps,
    'configurable-shadow',
  );
  const shadow = runServiceFastOperationalPolicy(shadowCall, (pending) => {
    const relation = counterTargetRelation(pending.counters, outcome.counters);
    if (relation === 'diverged') {
      diverged = true;
      return true;
    }
    return relation === 'equal';
  });
  if (
    diverged ||
    shadow.status !== 'stopped' ||
    !stoppedOutcomesMatchPrefix(
      outcome,
      shadow,
      state.policy.policyIndex === 0,
    )
  ) {
    return Object.freeze({ ok: false, code: parityFailureCode });
  }
  const finalized = finalizeValidatedPrefix(
    outcome,
    shadow,
    semantic,
    state.cell.identity.amountIn,
    state.policy.policyIndex === 0,
  );
  if (finalized === undefined) {
    return Object.freeze({ ok: false, code: parityFailureCode });
  }
  consumedRawStoppedOutcomes.add(outcome);
  finalizedStoppedOutcomes.add(finalized);
  return Object.freeze({ ok: true, value: finalized });
}
