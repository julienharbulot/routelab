import {
  advancePathShadowPriceProposal,
  capturePathShadowPriceConfiguration,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
  type PathShadowPriceBaseReconstruction,
  type PathShadowPriceCoreFailure,
  type PathShadowPriceResolvedRoute,
} from '../../allocation/path-shadow-price/index.ts';
import {
  advanceServiceFastPathShadowPriceReconstructionStep,
  advanceServiceFastPathShadowPriceShareAction,
  appendServiceFastPathShadowPriceModelRoute,
  createServiceFastPathShadowPriceState,
  serviceFastPathShadowPriceFailure,
  serviceFastPathShadowPriceProgress,
  serviceFastPathShadowPriceProposalMetadata,
  serviceFastPathShadowPriceReconstruction,
  serviceFastPathShadowPriceResidualOption,
  serviceFastPathShadowPriceScoreAllocations,
  settleServiceFastPathShadowPriceResidualOption,
  startServiceFastPathShadowPriceProposal,
  type ServiceFastPathShadowPriceFailure,
  type ServiceFastPathShadowPriceProposalMetadata,
  type ServiceFastPathShadowPriceReconstruction,
  type ServiceFastPathShadowPriceResidualOption,
  type ServiceFastPathShadowPriceResidualOutcome,
  type ServiceFastPathShadowPriceShareActionKind,
  type ServiceFastPathShadowPriceState,
} from '../../allocation/service-fast-path-shadow-price/index.ts';
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
import type { ServiceFastExperimentPolicy } from './policy.ts';

/** @internal */
export class ServiceFastExperimentAnchorParityError extends Error {
  public constructor() {
    super('Service-fast experiment anchor parity mismatch.');
    this.name = 'ServiceFastExperimentAnchorParityError';
  }
}

/** @internal */
export interface ServiceFastExperimentProposalAdapterProgress {
  readonly phase:
    | 'share-action'
    | 'reconstruction-step'
    | 'residual-option'
    | 'score-ready'
    | 'failed';
  readonly nextShareAction:
    | ServiceFastPathShadowPriceShareActionKind
    | 'protected-share-microstep'
    | null;
  readonly methodActions: number;
  readonly shareActions: number;
  readonly outerUpdates: number;
  readonly reconstructionSteps: number;
}

/** @internal */
export interface ServiceFastExperimentProposalActionResult {
  readonly ok: boolean;
  readonly outerUpdateCompleted: boolean;
  readonly failure: ServiceFastPathShadowPriceFailure | undefined;
}

/** @internal */
export interface ServiceFastExperimentProposalAdapter {
  readonly kind:
    | 'configurable'
    | 'protected-fine-anchor'
    | 'protected-coarse-anchor';
  progress(): ServiceFastExperimentProposalAdapterProgress;
  advanceShare(): ServiceFastExperimentProposalActionResult;
  advanceReconstruction(): ServiceFastExperimentProposalActionResult;
  residualOption(): ServiceFastPathShadowPriceResidualOption;
  settleResidual(
    outcome: ServiceFastPathShadowPriceResidualOutcome,
  ): ServiceFastExperimentProposalActionResult;
  metadata(): ServiceFastPathShadowPriceProposalMetadata | undefined;
  reconstruction(): ServiceFastPathShadowPriceReconstruction | undefined;
  initialResidualUnits(): bigint | undefined;
  scoreAllocations(): readonly bigint[] | undefined;
  failure(): ServiceFastPathShadowPriceFailure | undefined;
}

/** @internal */
export type PrepareServiceFastExperimentProposalAdapterResult =
  | {
      readonly ok: true;
      readonly adapter: ServiceFastExperimentProposalAdapter;
      readonly modelRouteSetupSteps: number;
    }
  | {
      readonly ok: false;
      readonly failure: ServiceFastPathShadowPriceFailure;
      readonly modelRouteSetupSteps: number;
    };

function actionResult(
  ok: boolean,
  outerUpdateCompleted: boolean,
  failure: ServiceFastPathShadowPriceFailure | undefined,
): ServiceFastExperimentProposalActionResult {
  return Object.freeze({ ok, outerUpdateCompleted, failure });
}

function normalizedFastProgress(
  state: ServiceFastPathShadowPriceState,
): ServiceFastExperimentProposalAdapterProgress {
  const progress = serviceFastPathShadowPriceProgress(state);
  return Object.freeze({
    phase: progress.phase === 'model-route' || progress.phase === 'proposal-start'
      ? 'failed'
      : progress.phase,
    nextShareAction: progress.nextShareAction,
    methodActions: progress.methodActions,
    shareActions: progress.shareActions,
    outerUpdates: progress.outerUpdatesCompleted,
    reconstructionSteps: progress.reconstructionSteps,
  });
}

class ConfigurableAdapter implements ServiceFastExperimentProposalAdapter {
  public readonly kind = 'configurable' as const;
  private readonly state: ServiceFastPathShadowPriceState;

  public constructor(state: ServiceFastPathShadowPriceState) {
    this.state = state;
  }

  public progress(): ServiceFastExperimentProposalAdapterProgress {
    return normalizedFastProgress(this.state);
  }

  public advanceShare(): ServiceFastExperimentProposalActionResult {
    const result = advanceServiceFastPathShadowPriceShareAction(this.state);
    return result.ok
      ? actionResult(true, result.outerUpdateCompleted, undefined)
      : actionResult(false, result.outerUpdateCompleted, result.error);
  }

  public advanceReconstruction(): ServiceFastExperimentProposalActionResult {
    const result = advanceServiceFastPathShadowPriceReconstructionStep(this.state);
    return result.ok
      ? actionResult(true, false, undefined)
      : actionResult(false, false, result.error);
  }

  public residualOption(): ServiceFastPathShadowPriceResidualOption {
    return serviceFastPathShadowPriceResidualOption(this.state);
  }

  public settleResidual(
    outcome: ServiceFastPathShadowPriceResidualOutcome,
  ): ServiceFastExperimentProposalActionResult {
    const result = settleServiceFastPathShadowPriceResidualOption(this.state, outcome);
    return result.ok
      ? actionResult(true, false, undefined)
      : actionResult(false, false, result.error);
  }

  public metadata(): ServiceFastPathShadowPriceProposalMetadata | undefined {
    return serviceFastPathShadowPriceProposalMetadata(this.state);
  }

  public reconstruction(): ServiceFastPathShadowPriceReconstruction | undefined {
    return serviceFastPathShadowPriceReconstruction(this.state);
  }

  public initialResidualUnits(): bigint | undefined {
    return this.reconstruction()?.residualUnits;
  }

  public scoreAllocations(): readonly bigint[] | undefined {
    return serviceFastPathShadowPriceScoreAllocations(this.state);
  }

  public failure(): ServiceFastPathShadowPriceFailure | undefined {
    return serviceFastPathShadowPriceFailure(this.state);
  }
}

function sameNumberBits(left: number, right: number): boolean {
  return Object.is(left, right);
}

function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => {
      const other = right[index];
      return other !== undefined && sameNumberBits(value, other);
    });
}

function equalBigints(left: readonly bigint[], right: readonly bigint[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

class FineAnchorAdapter implements ServiceFastExperimentProposalAdapter {
  public readonly kind = 'protected-fine-anchor' as const;
  private readonly fine: ServicePathShadowPriceState;

  public constructor(fine: ServicePathShadowPriceState) {
    this.fine = fine;
  }

  public progress(): ServiceFastExperimentProposalAdapterProgress {
    const progress = servicePathShadowPriceProgress(this.fine);
    return Object.freeze({
      phase: progress.phase === 'share-microstep'
        ? 'share-action'
        : progress.phase === 'model-route' || progress.phase === 'proposal-start'
          ? 'failed'
          : progress.phase,
      nextShareAction: progress.phase === 'share-microstep'
        ? 'protected-share-microstep'
        : null,
      methodActions: 0,
      shareActions: progress.shareMicrosteps,
      outerUpdates: progress.outerUpdatesCompleted,
      reconstructionSteps: progress.reconstructionSteps,
    });
  }

  public advanceShare(): ServiceFastExperimentProposalActionResult {
    const result = advanceServicePathShadowPriceShareMicrostep(this.fine);
    return result.ok
      ? actionResult(true, result.outerUpdateCompleted, undefined)
      : actionResult(false, false, Object.freeze({
          code: result.error.code,
          converged: result.error.converged,
          completedOuterUpdates: result.error.completedOuterUpdates,
        }));
  }

  public advanceReconstruction(): ServiceFastExperimentProposalActionResult {
    const result = advanceServicePathShadowPriceReconstructionStep(this.fine);
    return result.ok
      ? actionResult(true, false, undefined)
      : actionResult(false, false, Object.freeze({
          code: result.error.code,
          converged: result.error.converged,
          completedOuterUpdates: result.error.completedOuterUpdates,
        }));
  }

  public residualOption(): ServiceFastPathShadowPriceResidualOption {
    return servicePathShadowPriceResidualOption(this.fine);
  }

  public settleResidual(
    outcome: ServiceFastPathShadowPriceResidualOutcome,
  ): ServiceFastExperimentProposalActionResult {
    const result = settleServicePathShadowPriceResidualOption(this.fine, outcome);
    return result.ok
      ? actionResult(true, false, undefined)
      : actionResult(false, false, Object.freeze({
          code: result.error.code,
          converged: result.error.converged,
          completedOuterUpdates: result.error.completedOuterUpdates,
        }));
  }

  public metadata(): ServiceFastPathShadowPriceProposalMetadata | undefined {
    const weights = servicePathShadowPriceReadyWeights(this.fine);
    if (weights === undefined) return undefined;
    const progress = servicePathShadowPriceProgress(this.fine);
    return Object.freeze({
      converged: true,
      diagnostic: null,
      completedOuterUpdates: progress.outerUpdatesCompleted,
      weights,
    });
  }

  public reconstruction(): ServiceFastPathShadowPriceReconstruction | undefined {
    return undefined;
  }

  public initialResidualUnits(): bigint | undefined {
    return servicePathShadowPriceInitialResidualUnits(this.fine);
  }

  public scoreAllocations(): readonly bigint[] | undefined {
    return servicePathShadowPriceScoreAllocations(this.fine);
  }

  public failure(): ServiceFastPathShadowPriceFailure | undefined {
    const failure = servicePathShadowPriceFailure(this.fine);
    return failure === undefined
      ? undefined
      : Object.freeze({
          code: failure.code,
          converged: failure.converged,
          completedOuterUpdates: failure.completedOuterUpdates,
        });
  }
}

function prepareFast(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
  policy: ServiceFastExperimentPolicy,
): PrepareServiceFastExperimentProposalAdapterResult {
  const state = createServiceFastPathShadowPriceState(amountIn, routes.length, {
    driverId: policy.driverId,
    nonConvergence: policy.nonConvergence,
  });
  let setupSteps = 0;
  for (const route of routes) {
    setupSteps += 1;
    const append = appendServiceFastPathShadowPriceModelRoute(state, route);
    if (!append.ok) {
      return Object.freeze({
        ok: false,
        failure: append.error,
        modelRouteSetupSteps: setupSteps,
      });
    }
  }
  const start = startServiceFastPathShadowPriceProposal(state);
  if (!start.ok) {
    return Object.freeze({
      ok: false,
      failure: start.error,
      modelRouteSetupSteps: setupSteps,
    });
  }
  return Object.freeze({
    ok: true,
    adapter: new ConfigurableAdapter(state),
    modelRouteSetupSteps: setupSteps,
  });
}

/** @internal */
export function prepareConfigurableServiceFastExperimentProposal(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
  policy: ServiceFastExperimentPolicy,
): PrepareServiceFastExperimentProposalAdapterResult {
  return prepareFast(amountIn, routes, policy);
}

/** @internal */
export function prepareProtectedFineServiceFastExperimentAnchor(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
  policy: ServiceFastExperimentPolicy,
): PrepareServiceFastExperimentProposalAdapterResult {
  if (
    policy.policyIndex !== 0 ||
    policy.policyId !== 'bisection-o64-i64--strict-reject--current'
  ) {
    throw new TypeError('Protected fine anchor requires the frozen anchor policy.');
  }
  const fine = createServicePathShadowPriceState(amountIn, routes.length);
  let setupSteps = 0;
  for (const route of routes) {
    setupSteps += 1;
    const fineAppend = appendServicePathShadowPriceModelRoute(fine, route);
    if (!fineAppend.ok) {
      return Object.freeze({
        ok: false,
        failure: Object.freeze({
          code: fineAppend.error.code,
          converged: fineAppend.error.converged,
          completedOuterUpdates: fineAppend.error.completedOuterUpdates,
        }),
        modelRouteSetupSteps: setupSteps,
      });
    }
  }
  const fineStart = startServicePathShadowPriceProposal(fine);
  if (!fineStart.ok) {
    return Object.freeze({
      ok: false,
      failure: Object.freeze({
        code: fineStart.error.code,
        converged: fineStart.error.converged,
        completedOuterUpdates: fineStart.error.completedOuterUpdates,
      }),
      modelRouteSetupSteps: setupSteps,
    });
  }
  return Object.freeze({
    ok: true,
    adapter: new FineAnchorAdapter(fine),
    modelRouteSetupSteps: setupSteps,
  });
}

/** @internal */
export type ServiceFastExperimentCoarseAnchorProposalResult =
  | {
      readonly ok: true;
      readonly metadata: ServiceFastPathShadowPriceProposalMetadata;
      readonly reconstruction: ServiceFastPathShadowPriceReconstruction;
      readonly modelRouteSetupSteps: number;
    }
  | {
      readonly ok: false;
      readonly failure: PathShadowPriceCoreFailure;
      readonly modelRouteSetupSteps: number;
    };

/** @internal */
export function runProtectedCoarseServiceFastExperimentAnchor(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
): ServiceFastExperimentCoarseAnchorProposalResult {
  const capturedConfiguration = capturePathShadowPriceConfiguration({
    outerIterations: 64,
    innerIterations: 64,
    convergenceTolerance: 2 ** -40,
  });
  if (!capturedConfiguration.ok) {
    throw new Error('Frozen protected anchor configuration was rejected.');
  }
  const prepared = preparePathShadowPriceProposal({
    amountIn,
    routes,
    configuration: capturedConfiguration.value,
  });
  if (!prepared.ok) {
    return Object.freeze({
      ok: false,
      failure: prepared.error,
      modelRouteSetupSteps: routes.length,
    });
  }
  let state = prepared.value.state;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const advanced = advancePathShadowPriceProposal(state);
    if (!advanced.ok) {
      return Object.freeze({
        ok: false,
        failure: advanced.error,
        modelRouteSetupSteps: routes.length,
      });
    }
    if (advanced.value.status === 'continue') {
      state = advanced.value.state;
      continue;
    }
    if (iteration !== 63) throw new ServiceFastExperimentAnchorParityError();
    const finalized = finalizePathShadowPriceProposal(advanced.value.state);
    if (!finalized.ok) {
      return Object.freeze({
        ok: false,
        failure: finalized.error,
        modelRouteSetupSteps: routes.length,
      });
    }
    const source = finalized.value.reconstruction;
    const metadata: ServiceFastPathShadowPriceProposalMetadata = Object.freeze({
      converged: true,
      diagnostic: null,
      completedOuterUpdates: finalized.value.completedOuterIterations,
      weights: Object.freeze([...source.nonauthorizingWeights]),
    });
    const reconstruction: ServiceFastPathShadowPriceReconstruction = Object.freeze({
      integerWeights: Object.freeze([...source.integerWeights]),
      baseAllocations: Object.freeze([...source.baseAllocations]),
      residualUnits: source.residualUnits,
    });
    return Object.freeze({
      ok: true,
      metadata,
      reconstruction,
      modelRouteSetupSteps: routes.length,
    });
  }
  throw new Error('Protected anchor did not reach its frozen finalization boundary.');
}

class CoarseAnchorAdapter implements ServiceFastExperimentProposalAdapter {
  public readonly kind = 'protected-coarse-anchor' as const;
  private readonly sourceMetadata: ServiceFastPathShadowPriceProposalMetadata;
  private readonly sourceReconstruction: ServiceFastPathShadowPriceReconstruction;
  private readonly routeCount: number;
  private phase: 'residual-option' | 'score-ready' | 'failed' = 'residual-option';
  private currentAllocations: readonly bigint[];
  private residualUnitsRemaining: bigint;
  private residualOptionIndex = 0;
  private residualOptionPending = false;
  private residualBestAllocations: readonly bigint[] | undefined;
  private score: readonly bigint[] | undefined;
  private currentFailure: ServiceFastPathShadowPriceFailure | undefined;

  public constructor(
    metadata: ServiceFastPathShadowPriceProposalMetadata,
    reconstruction: ServiceFastPathShadowPriceReconstruction,
  ) {
    this.sourceMetadata = metadata;
    this.sourceReconstruction = reconstruction;
    this.routeCount = reconstruction.baseAllocations.length;
    this.currentAllocations = reconstruction.baseAllocations;
    this.residualUnitsRemaining = reconstruction.residualUnits;
  }

  public progress(): ServiceFastExperimentProposalAdapterProgress {
    return Object.freeze({
      phase: this.phase,
      nextShareAction: null,
      methodActions: 0,
      shareActions: 0,
      outerUpdates: this.sourceMetadata.completedOuterUpdates,
      reconstructionSteps: 0,
    });
  }

  public advanceShare(): ServiceFastExperimentProposalActionResult {
    throw new TypeError('Protected coarse anchor has no fine share action.');
  }

  public advanceReconstruction(): ServiceFastExperimentProposalActionResult {
    throw new TypeError('Protected coarse anchor reconstruction is already authoritative.');
  }

  public residualOption(): ServiceFastPathShadowPriceResidualOption {
    if (this.phase !== 'residual-option' || this.residualOptionPending) {
      throw new TypeError('No new protected coarse residual option is available.');
    }
    let allocations: readonly bigint[];
    let routeIndex: number | null;
    if (this.residualUnitsRemaining === 0n) {
      allocations = Object.freeze([...this.currentAllocations]);
      routeIndex = null;
    } else {
      routeIndex = this.residualOptionIndex;
      const candidate = [...this.currentAllocations];
      const prior = candidate[routeIndex];
      if (prior === undefined) {
        throw new Error('Protected coarse residual route is unavailable.');
      }
      candidate[routeIndex] = prior + 1n;
      allocations = Object.freeze(candidate);
    }
    this.residualOptionPending = true;
    return Object.freeze({
      allocations,
      routeIndex,
      residualUnitsRemaining: this.residualUnitsRemaining,
    });
  }

  public settleResidual(
    outcome: ServiceFastPathShadowPriceResidualOutcome,
  ): ServiceFastExperimentProposalActionResult {
    if (
      this.phase !== 'residual-option' ||
      !this.residualOptionPending ||
      (outcome !== 'rejected' &&
        outcome !== 'valid-not-best' &&
        outcome !== 'valid-best')
    ) {
      throw new TypeError('Protected coarse residual outcome is invalid.');
    }
    this.residualOptionPending = false;
    if (this.residualUnitsRemaining === 0n) {
      if (outcome === 'rejected') return this.failResidual();
      this.score = Object.freeze([...this.currentAllocations]);
      this.phase = 'score-ready';
      return actionResult(true, false, undefined);
    }
    if (outcome === 'valid-best') {
      const candidate = [...this.currentAllocations];
      const prior = candidate[this.residualOptionIndex];
      if (prior === undefined) throw new Error('Protected coarse residual state is invalid.');
      candidate[this.residualOptionIndex] = prior + 1n;
      this.residualBestAllocations = Object.freeze(candidate);
    }
    this.residualOptionIndex += 1;
    if (this.residualOptionIndex < this.routeCount) {
      return actionResult(true, false, undefined);
    }
    const winner = this.residualBestAllocations;
    if (winner === undefined) return this.failResidual();
    this.currentAllocations = winner;
    this.residualUnitsRemaining -= 1n;
    this.residualOptionIndex = 0;
    this.residualBestAllocations = undefined;
    if (this.residualUnitsRemaining === 0n) {
      this.score = winner;
      this.phase = 'score-ready';
    }
    return actionResult(true, false, undefined);
  }

  private failResidual(): ServiceFastExperimentProposalActionResult {
    const failure: ServiceFastPathShadowPriceFailure = Object.freeze({
      code: 'residual-options-exhausted',
      converged: true,
      completedOuterUpdates: this.sourceMetadata.completedOuterUpdates,
    });
    this.currentFailure = failure;
    this.phase = 'failed';
    return actionResult(false, false, failure);
  }

  public metadata(): ServiceFastPathShadowPriceProposalMetadata {
    return Object.freeze({
      ...this.sourceMetadata,
      weights: Object.freeze([...this.sourceMetadata.weights]),
    });
  }

  public reconstruction(): ServiceFastPathShadowPriceReconstruction {
    return Object.freeze({
      integerWeights: Object.freeze([...this.sourceReconstruction.integerWeights]),
      baseAllocations: Object.freeze([...this.sourceReconstruction.baseAllocations]),
      residualUnits: this.sourceReconstruction.residualUnits,
    });
  }

  public initialResidualUnits(): bigint {
    return this.sourceReconstruction.residualUnits;
  }

  public scoreAllocations(): readonly bigint[] | undefined {
    return this.score === undefined ? undefined : Object.freeze([...this.score]);
  }

  public failure(): ServiceFastPathShadowPriceFailure | undefined {
    return this.currentFailure;
  }
}

/** @internal */
export function prepareProtectedCoarseServiceFastExperimentAnchor(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
  policy: ServiceFastExperimentPolicy,
): PrepareServiceFastExperimentProposalAdapterResult {
  if (
    policy.policyIndex !== 0 ||
    policy.policyId !== 'bisection-o64-i64--strict-reject--current'
  ) {
    throw new TypeError('Protected coarse anchor requires the frozen anchor policy.');
  }
  const result = runProtectedCoarseServiceFastExperimentAnchor(amountIn, routes);
  if (!result.ok) {
    return Object.freeze({
      ok: false,
      failure: Object.freeze({
        code: result.failure.code,
        converged: result.failure.converged,
        completedOuterUpdates: result.failure.completedOuterIterations,
      }),
      modelRouteSetupSteps: result.modelRouteSetupSteps,
    });
  }
  return Object.freeze({
    ok: true,
    adapter: new CoarseAnchorAdapter(result.metadata, result.reconstruction),
    modelRouteSetupSteps: result.modelRouteSetupSteps,
  });
}

/** @internal */
export function serviceFastExperimentReconstructionEquals(
  left: ServiceFastPathShadowPriceReconstruction,
  right: ServiceFastPathShadowPriceReconstruction,
): boolean {
  return left.residualUnits === right.residualUnits &&
    equalBigints(left.integerWeights, right.integerWeights) &&
    equalBigints(left.baseAllocations, right.baseAllocations);
}

/** @internal */
export function serviceFastExperimentMetadataEquals(
  left: ServiceFastPathShadowPriceProposalMetadata,
  right: ServiceFastPathShadowPriceProposalMetadata,
): boolean {
  return left.converged === right.converged &&
    left.diagnostic === right.diagnostic &&
    left.completedOuterUpdates === right.completedOuterUpdates &&
    equalNumbers(left.weights, right.weights);
}

/** @internal */
export function copyPathShadowPriceBaseReconstruction(
  reconstruction: PathShadowPriceBaseReconstruction,
): ServiceFastPathShadowPriceReconstruction {
  return Object.freeze({
    integerWeights: Object.freeze([...reconstruction.integerWeights]),
    baseAllocations: Object.freeze([...reconstruction.baseAllocations]),
    residualUnits: reconstruction.residualUnits,
  });
}
