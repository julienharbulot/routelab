import type { ExactInputSplitReplayReceipt } from '../../replay/exact-input-split/index.ts';
import {
  SERVICE_ROUTING_POLICY_V1,
  SERVICE_ROUTING_POLICY_V1_ID,
  isPreparedServiceRoutingContext,
  preparedServiceRoutingClock,
  preparedServiceRoutingContextHasAsset,
  preparedServiceRoutingIdentity,
  preparedServiceRoutingPolicy,
  type PreparedServiceRoutingContext,
} from '../../runtime/prepared-service-routing-context/index.ts';
import {
  createServiceExactInputSplitSession,
  runServiceExactInputSplitServicePolicy,
  type ServiceExactInputSplitSessionOutcome,
} from '../exact-input-split-session/index.ts';

export type ServiceExactInputSplitActionKind =
  | 'direct-candidate-replay'
  | 'path-expansion'
  | 'best-single-candidate-replay'
  | 'candidate-set-step'
  | 'equal-proposal-replay'
  | 'baseline-authorization-replay'
  | 'greedy-option-replay'
  | 'numerical-proposal-start'
  | 'numerical-model-route'
  | 'numerical-share-microstep'
  | 'numerical-reconstruction-step'
  | 'numerical-residual-option-replay'
  | 'activation-probe-replay'
  | 'repair-neighbor-replay'
  | 'numerical-authorization-replay'
  | 'proposal-bookkeeping'
  | 'diagnostic-bookkeeping'
  | 'terminal-projection';

export interface ServiceExactInputSplitWorkCounters {
  readonly aggregateTransitions: number;
  readonly directInspections: number;
  readonly directReplays: number;
  readonly directReplayRejections: number;
  readonly pathExpansions: number;
  readonly pathsRetained: number;
  readonly bestSingleReplays: number;
  readonly bestSingleReplayRejections: number;
  readonly candidateSetSteps: number;
  readonly candidateSetsRetained: number;
  readonly equalProposalReplays: number;
  readonly equalProposalReplayRejections: number;
  readonly proposalsRetained: number;
  readonly baselineAuthorizationReplays: number;
  readonly baselineAuthorizationReplayRejections: number;
  readonly greedyPartsStarted: number;
  readonly greedyOptionReplays: number;
  readonly greedyOptionReplayRejections: number;
  readonly numericalProposals: number;
  readonly numericalProposalFailures: number;
  readonly numericalModelRouteSteps: number;
  readonly numericalOuterUpdatesStarted: number;
  readonly numericalOuterUpdatesCompleted: number;
  readonly numericalShareMicrosteps: number;
  readonly numericalReconstructionSteps: number;
  readonly numericalResidualOptionReplays: number;
  readonly numericalResidualOptionReplayRejections: number;
  readonly activationProbeReplays: number;
  readonly activationProbeReplayRejections: number;
  readonly repairNeighborReplays: number;
  readonly repairNeighborReplayRejections: number;
  readonly numericalAuthorizationReplays: number;
  readonly numericalAuthorizationReplayRejections: number;
  readonly bookkeepingSteps: number;
  readonly diagnosticsRetained: number;
  readonly terminalProjections: number;
}

export interface ServiceExactInputSplitCheckpoint {
  readonly nextActionKind: ServiceExactInputSplitActionKind;
  readonly counters: ServiceExactInputSplitWorkCounters;
  readonly incumbent: ExactInputSplitReplayReceipt | null;
}

export interface ServiceExactInputSplitNumericalAttributableCounters {
  readonly modelRouteSteps: number;
  readonly outerUpdatesStarted: number;
  readonly outerUpdatesCompleted: number;
  readonly shareMicrosteps: number;
  readonly reconstructionSteps: number;
  readonly residualOptionReplays: number;
  readonly residualOptionReplayRejections: number;
  readonly authorizationReplays: number;
  readonly authorizationReplayRejections: number;
}

export type ServiceExactInputSplitNumericalFailureCode =
  | 'invalid-route-model'
  | 'non-finite-normalization'
  | 'non-finite-proposal'
  | 'non-convergence'
  | 'zero-total-weight'
  | 'invalid-reconstruction'
  | 'residual-options-exhausted'
  | 'authorization-rejected'
  | 'authorization-mismatch'
  | 'work-limit'
  | 'deadline'
  | 'interrupted'
  | 'clock-call-failed'
  | 'invalid-clock-sample'
  | 'clock-regressed'
  | 'cancellation-call-failed'
  | 'invalid-cancellation-result'
  | 'service-session-state-failed';

export interface ServiceExactInputSplitNumericalDiagnostic {
  readonly candidateSetKeyDigest: string;
  readonly routeKeyDigests: readonly string[];
  readonly status: 'improved' | 'not-better' | 'failed' | 'stopped';
  readonly failureCode: ServiceExactInputSplitNumericalFailureCode | null;
  readonly converged: boolean;
  readonly residualUnits: bigint | null;
  readonly counters: ServiceExactInputSplitNumericalAttributableCounters;
}

export interface ServiceExactInputSplitDebugFragment {
  readonly diagnosticIndex: number;
  readonly candidateSetKey: string;
  readonly routeKeys: readonly string[];
}

export interface ServiceExactInputSplitDebugProjection {
  readonly truncated: boolean;
  readonly fragments: readonly ServiceExactInputSplitDebugFragment[];
}

declare const capturedServiceExactInputIntentBrand: unique symbol;

export interface CapturedServiceExactInputIntent {
  readonly [capturedServiceExactInputIntentBrand]: typeof capturedServiceExactInputIntentBrand;
}

declare const capturedServiceExactInputControlBrand: unique symbol;

export interface CapturedServiceExactInputControl {
  readonly [capturedServiceExactInputControlBrand]: typeof capturedServiceExactInputControlBrand;
}

export type ServiceExactInputIntentError =
  | { readonly code: 'invalid-service-context'; readonly field: 'context' }
  | { readonly code: 'invalid-snapshot-id'; readonly field: 'snapshotId' }
  | { readonly code: 'snapshot-id-mismatch'; readonly field: 'snapshotId' }
  | {
      readonly code: 'invalid-asset-identifier';
      readonly field: 'assetIn' | 'assetOut';
    }
  | { readonly code: 'same-asset-request'; readonly field: 'assetOut' }
  | { readonly code: 'invalid-amount-in'; readonly field: 'amountIn' }
  | { readonly code: 'unknown-asset'; readonly field: 'assetIn' | 'assetOut' };

export type ServiceExactInputControlError =
  | { readonly code: 'invalid-service-context'; readonly field: 'context' }
  | {
      readonly code: 'invalid-deadline';
      readonly field: 'absoluteDeadlineNanoseconds';
    }
  | {
      readonly code: 'invalid-cancellation-dependency';
      readonly field: 'shouldCancel';
    }
  | { readonly code: 'invalid-debug'; readonly field: 'debug' };

export type CaptureServiceExactInputIntentResult =
  | { readonly ok: true; readonly value: CapturedServiceExactInputIntent }
  | {
      readonly ok: false;
      readonly status: 'invalid-request';
      readonly error: Exclude<
        ServiceExactInputIntentError,
        { readonly code: 'invalid-service-context' }
      >;
    }
  | {
      readonly ok: false;
      readonly status: 'invalid-context';
      readonly error: Extract<
        ServiceExactInputIntentError,
        { readonly code: 'invalid-service-context' }
      >;
    };

export type MintServiceExactInputControlResult =
  | { readonly ok: true; readonly value: CapturedServiceExactInputControl }
  | {
      readonly ok: false;
      readonly status: 'invalid-control';
      readonly error: Exclude<
        ServiceExactInputControlError,
        { readonly code: 'invalid-service-context' }
      >;
    }
  | {
      readonly ok: false;
      readonly status: 'invalid-context';
      readonly error: Extract<
        ServiceExactInputControlError,
        { readonly code: 'invalid-service-context' }
      >;
    };

export type ServiceExactInputSplitTermination =
  | 'complete'
  | 'work-limit'
  | 'deadline'
  | 'interrupted';

export type ServiceExactInputSplitSearchTermination =
  | ServiceExactInputSplitTermination
  | 'state-error';

export interface ServiceExactInputSplitSearchSummary<
  TTermination extends ServiceExactInputSplitSearchTermination = ServiceExactInputSplitTermination,
> {
  readonly policyId: typeof SERVICE_ROUTING_POLICY_V1_ID;
  readonly termination: TTermination;
  readonly counters: ServiceExactInputSplitWorkCounters;
  readonly numericalDiagnostics: readonly ServiceExactInputSplitNumericalDiagnostic[];
  readonly debug: ServiceExactInputSplitDebugProjection | null;
}

export interface ServiceExactInputSplitPlan<
  TTermination extends ServiceExactInputSplitTermination = ServiceExactInputSplitTermination,
> {
  readonly receipt: ExactInputSplitReplayReceipt;
  readonly search: ServiceExactInputSplitSearchSummary<TTermination>;
}

export type ServiceExactInputSplitContextError = {
  readonly code: 'invalid-service-context-binding';
  readonly field: 'context' | 'intent' | 'control';
};

export type ServiceExactInputSplitClockErrorCode =
  | 'clock-call-failed'
  | 'invalid-clock-sample'
  | 'clock-regressed';

export type ServiceExactInputSplitCancellationErrorCode =
  | 'cancellation-call-failed'
  | 'invalid-cancellation-result';

export type ServiceExactInputSplitDependencyErrorCode =
  | ServiceExactInputSplitClockErrorCode
  | ServiceExactInputSplitCancellationErrorCode;

export interface ServiceExactInputSplitDependencyError {
  readonly code: ServiceExactInputSplitDependencyErrorCode;
}

export interface ServiceExactInputSplitStateError {
  readonly code: 'service-session-state-failed';
}

export type ServiceExactInputSplitRouteResult =
  | { readonly status: 'success'; readonly plan: ServiceExactInputSplitPlan }
  | {
      readonly status: 'no-plan';
      readonly reason: 'work-limit';
      readonly search: ServiceExactInputSplitSearchSummary<'work-limit'>;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'deadline-at-entry' | 'deadline-before-plan';
      readonly search: ServiceExactInputSplitSearchSummary<'deadline'>;
    }
  | {
      readonly status: 'no-plan';
      readonly reason: 'interrupted';
      readonly search: ServiceExactInputSplitSearchSummary<'interrupted'>;
    }
  | {
      readonly status: 'no-route';
      readonly reason:
        | 'no-structural-candidate'
        | 'all-exact-replays-rejected';
      readonly search: ServiceExactInputSplitSearchSummary<'complete'>;
    }
  | {
      readonly status: 'invalid-context';
      readonly error: ServiceExactInputSplitContextError;
    }
  | {
      readonly status: 'dependency-error';
      readonly dependency: 'clock';
      readonly phase: 'entry' | 'action';
      readonly termination: 'deadline';
      readonly error: ServiceExactInputSplitDependencyError & {
        readonly code: ServiceExactInputSplitClockErrorCode;
      };
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ServiceExactInputSplitSearchSummary<'deadline'>;
    }
  | {
      readonly status: 'dependency-error';
      readonly dependency: 'cancellation';
      readonly phase: 'action';
      readonly termination: 'interrupted';
      readonly error: ServiceExactInputSplitDependencyError & {
        readonly code: ServiceExactInputSplitCancellationErrorCode;
      };
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ServiceExactInputSplitSearchSummary<'interrupted'>;
    }
  | {
      readonly status: 'state-error';
      readonly error: ServiceExactInputSplitStateError;
      readonly incumbent: ExactInputSplitReplayReceipt | null;
      readonly search: ServiceExactInputSplitSearchSummary<'state-error'>;
    };

interface CapturedIntentState {
  readonly context: PreparedServiceRoutingContext;
  readonly policyId: typeof SERVICE_ROUTING_POLICY_V1_ID;
  readonly snapshotId: string;
  readonly snapshotChecksum: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
}

interface CapturedControlState {
  readonly context: PreparedServiceRoutingContext;
  readonly policyId: typeof SERVICE_ROUTING_POLICY_V1_ID;
  readonly absoluteDeadlineNanoseconds: bigint;
  readonly shouldCancel:
    | ((checkpoint: ServiceExactInputSplitCheckpoint) => unknown)
    | undefined;
  readonly debug: boolean;
}

const CAPTURED_INTENTS = new WeakMap<
  CapturedServiceExactInputIntent,
  CapturedIntentState
>();
const CAPTURED_CONTROLS = new WeakMap<
  CapturedServiceExactInputControl,
  CapturedControlState
>();

const MAX_REQUEST_AMOUNT_EXCLUSIVE =
  1n << BigInt(SERVICE_ROUTING_POLICY_V1.maxRequestAmountBits);

function frozenFailure<
  TStatus extends 'invalid-request' | 'invalid-control' | 'invalid-context',
  TError extends ServiceExactInputIntentError | ServiceExactInputControlError,
>(status: TStatus, error: TError): { readonly ok: false; readonly status: TStatus; readonly error: TError } {
  return Object.freeze({ ok: false, status, error: Object.freeze(error) });
}

function isServiceIdentifier(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > SERVICE_ROUTING_POLICY_V1.maxIdentifierCodeUnits ||
    Buffer.byteLength(value, 'utf8') >
      SERVICE_ROUTING_POLICY_V1.maxIdentifierUtf8Bytes
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

function amountFitsPolicy(value: bigint): boolean {
  return value > 0n && value < MAX_REQUEST_AMOUNT_EXCLUSIVE;
}

export function captureServiceExactInputIntent(
  context: PreparedServiceRoutingContext,
  snapshotId: string | undefined,
  assetIn: string,
  assetOut: string,
  amountIn: bigint,
): CaptureServiceExactInputIntentResult {
  if (
    !isPreparedServiceRoutingContext(context) ||
    preparedServiceRoutingPolicy(context) !== SERVICE_ROUTING_POLICY_V1
  ) {
    return frozenFailure('invalid-context', {
      code: 'invalid-service-context',
      field: 'context',
    });
  }
  const identity = preparedServiceRoutingIdentity(context)!;
  if (
    snapshotId !== undefined &&
    (typeof snapshotId !== 'string' || !isServiceIdentifier(snapshotId))
  ) {
    return frozenFailure('invalid-request', {
      code: 'invalid-snapshot-id',
      field: 'snapshotId',
    });
  }
  if (snapshotId !== undefined && snapshotId !== identity.snapshotId) {
    return frozenFailure('invalid-request', {
      code: 'snapshot-id-mismatch',
      field: 'snapshotId',
    });
  }
  if (typeof assetIn !== 'string' || !isServiceIdentifier(assetIn)) {
    return frozenFailure('invalid-request', {
      code: 'invalid-asset-identifier',
      field: 'assetIn',
    });
  }
  if (typeof assetOut !== 'string' || !isServiceIdentifier(assetOut)) {
    return frozenFailure('invalid-request', {
      code: 'invalid-asset-identifier',
      field: 'assetOut',
    });
  }
  if (assetIn === assetOut) {
    return frozenFailure('invalid-request', {
      code: 'same-asset-request',
      field: 'assetOut',
    });
  }
  if (typeof amountIn !== 'bigint' || !amountFitsPolicy(amountIn)) {
    return frozenFailure('invalid-request', {
      code: 'invalid-amount-in',
      field: 'amountIn',
    });
  }
  if (!preparedServiceRoutingContextHasAsset(context, assetIn)) {
    return frozenFailure('invalid-request', {
      code: 'unknown-asset',
      field: 'assetIn',
    });
  }
  if (!preparedServiceRoutingContextHasAsset(context, assetOut)) {
    return frozenFailure('invalid-request', {
      code: 'unknown-asset',
      field: 'assetOut',
    });
  }
  const value = Object.freeze({}) as CapturedServiceExactInputIntent;
  CAPTURED_INTENTS.set(
    value,
    Object.freeze({
      context,
      policyId: identity.policyId,
      snapshotId: identity.snapshotId,
      snapshotChecksum: identity.snapshotChecksum,
      assetIn,
      assetOut,
      amountIn,
    }),
  );
  return Object.freeze({ ok: true, value });
}

export function mintServiceExactInputControl(
  context: PreparedServiceRoutingContext,
  absoluteDeadlineNanoseconds: bigint,
  shouldCancel:
    | ((checkpoint: ServiceExactInputSplitCheckpoint) => unknown)
    | undefined,
  debug: boolean,
): MintServiceExactInputControlResult {
  if (
    !isPreparedServiceRoutingContext(context) ||
    preparedServiceRoutingPolicy(context) !== SERVICE_ROUTING_POLICY_V1
  ) {
    return frozenFailure('invalid-context', {
      code: 'invalid-service-context',
      field: 'context',
    });
  }
  if (
    typeof absoluteDeadlineNanoseconds !== 'bigint' ||
    absoluteDeadlineNanoseconds < 0n
  ) {
    return frozenFailure('invalid-control', {
      code: 'invalid-deadline',
      field: 'absoluteDeadlineNanoseconds',
    });
  }
  if (shouldCancel !== undefined && typeof shouldCancel !== 'function') {
    return frozenFailure('invalid-control', {
      code: 'invalid-cancellation-dependency',
      field: 'shouldCancel',
    });
  }
  if (typeof debug !== 'boolean') {
    return frozenFailure('invalid-control', {
      code: 'invalid-debug',
      field: 'debug',
    });
  }
  const identity = preparedServiceRoutingIdentity(context)!;
  const value = Object.freeze({}) as CapturedServiceExactInputControl;
  CAPTURED_CONTROLS.set(
    value,
    Object.freeze({
      context,
      policyId: identity.policyId,
      absoluteDeadlineNanoseconds,
      shouldCancel,
      debug,
    }),
  );
  return Object.freeze({ ok: true, value });
}

function emptyCounters(): ServiceExactInputSplitWorkCounters {
  return Object.freeze({
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
  });
}

function reservedTerminalStateErrorCounters(): ServiceExactInputSplitWorkCounters {
  return Object.freeze({
    ...emptyCounters(),
    aggregateTransitions: 1,
    terminalProjections: 1,
  });
}

function debugProjection(debug: boolean): ServiceExactInputSplitDebugProjection | null {
  return debug
    ? Object.freeze({ truncated: false, fragments: Object.freeze([]) })
    : null;
}

function searchSummary<
  TTermination extends ServiceExactInputSplitSearchTermination,
>(
  termination: TTermination,
  counters: ServiceExactInputSplitWorkCounters,
  debug: boolean,
  numericalDiagnostics: readonly ServiceExactInputSplitNumericalDiagnostic[] =
    Object.freeze([]),
  capturedDebug: ServiceExactInputSplitDebugProjection | null = debugProjection(debug),
): ServiceExactInputSplitSearchSummary<TTermination> {
  return Object.freeze({
    policyId: SERVICE_ROUTING_POLICY_V1_ID,
    termination,
    counters,
    numericalDiagnostics: Object.freeze([...numericalDiagnostics]),
    debug: capturedDebug,
  });
}

function invalidContext(
  field: ServiceExactInputSplitContextError['field'],
): ServiceExactInputSplitRouteResult {
  return Object.freeze({
    status: 'invalid-context',
    error: Object.freeze({
      code: 'invalid-service-context-binding',
      field,
    }),
  });
}

type ServiceExactInputSplitDependencyProjection =
  | {
      readonly dependency: 'clock';
      readonly phase: 'entry' | 'action';
      readonly termination: 'deadline';
      readonly code: ServiceExactInputSplitClockErrorCode;
      readonly search: ServiceExactInputSplitSearchSummary<'deadline'>;
    }
  | {
      readonly dependency: 'cancellation';
      readonly phase: 'action';
      readonly termination: 'interrupted';
      readonly code: ServiceExactInputSplitCancellationErrorCode;
      readonly search: ServiceExactInputSplitSearchSummary<'interrupted'>;
    };

function dependencyResult(
  projection: ServiceExactInputSplitDependencyProjection,
  incumbent: ExactInputSplitReplayReceipt | null,
): ServiceExactInputSplitRouteResult {
  if (projection.dependency === 'clock') {
    return Object.freeze({
      status: 'dependency-error',
      dependency: projection.dependency,
      phase: projection.phase,
      termination: projection.termination,
      error: Object.freeze({ code: projection.code }),
      incumbent,
      search: projection.search,
    });
  }
  return Object.freeze({
    status: 'dependency-error',
    dependency: projection.dependency,
    phase: projection.phase,
    termination: projection.termination,
    error: Object.freeze({ code: projection.code }),
    incumbent,
    search: projection.search,
  });
}

export function routeExactInputSplitServiceV2(
  context: PreparedServiceRoutingContext,
  intent: CapturedServiceExactInputIntent,
  control: CapturedServiceExactInputControl,
): ServiceExactInputSplitRouteResult {
  if (
    !isPreparedServiceRoutingContext(context) ||
    preparedServiceRoutingPolicy(context) !== SERVICE_ROUTING_POLICY_V1
  ) {
    return invalidContext('context');
  }
  const intentState = CAPTURED_INTENTS.get(intent);
  if (
    intentState === undefined ||
    intentState.context !== context ||
    intentState.policyId !== SERVICE_ROUTING_POLICY_V1_ID
  ) {
    return invalidContext('intent');
  }
  const controlState = CAPTURED_CONTROLS.get(control);
  if (
    controlState === undefined ||
    controlState.context !== context ||
    controlState.policyId !== SERVICE_ROUTING_POLICY_V1_ID
  ) {
    return invalidContext('control');
  }

  const clock = preparedServiceRoutingClock(context)!;
  let entrySample: unknown;
  try {
    entrySample = Reflect.apply(clock, undefined, []);
  } catch {
    return dependencyResult(
      {
        dependency: 'clock',
        phase: 'entry',
        termination: 'deadline',
        code: 'clock-call-failed',
        search: searchSummary('deadline', emptyCounters(), false),
      },
      null,
    );
  }
  if (typeof entrySample !== 'bigint' || entrySample < 0n) {
    return dependencyResult(
      {
        dependency: 'clock',
        phase: 'entry',
        termination: 'deadline',
        code: 'invalid-clock-sample',
        search: searchSummary('deadline', emptyCounters(), false),
      },
      null,
    );
  }
  if (entrySample >= controlState.absoluteDeadlineNanoseconds) {
    return Object.freeze({
      status: 'no-plan',
      reason: 'deadline-at-entry',
      search: searchSummary('deadline', emptyCounters(), false),
    });
  }

  let outcome: ServiceExactInputSplitSessionOutcome | undefined;
  try {
    const session = createServiceExactInputSplitSession(
      context,
      Object.freeze({
        snapshotId: intentState.snapshotId,
        snapshotChecksum: intentState.snapshotChecksum,
        assetIn: intentState.assetIn,
        assetOut: intentState.assetOut,
        amountIn: intentState.amountIn,
        maxHops: SERVICE_ROUTING_POLICY_V1.maxHops,
        maxRoutes: SERVICE_ROUTING_POLICY_V1.maxRoutes,
        greedyParts: SERVICE_ROUTING_POLICY_V1.greedyParts,
      }),
      Object.freeze({
        absoluteDeadlineNanoseconds: controlState.absoluteDeadlineNanoseconds,
        shouldCancel: controlState.shouldCancel,
        debug: controlState.debug,
      }),
      entrySample,
    );
    outcome = runServiceExactInputSplitServicePolicy(session);
    return outcome.result;
  } catch {
    return Object.freeze({
      status: 'state-error',
      error: Object.freeze({ code: 'service-session-state-failed' }),
      incumbent: outcome?.incumbent ?? null,
      search: searchSummary(
        'state-error',
        outcome?.counters ?? reservedTerminalStateErrorCounters(),
        controlState.debug,
      ),
    });
  }
}
