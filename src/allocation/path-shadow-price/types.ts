declare const capturedPathShadowPriceConfigurationBrand: unique symbol;
declare const pathShadowPriceIterationStateBrand: unique symbol;
declare const pathShadowPriceReadyStateBrand: unique symbol;

/** @internal */
export interface PathShadowPriceConfigurationInput {
  readonly outerIterations: number;
  readonly innerIterations: number;
  readonly convergenceTolerance: number;
}

/** @internal */
export interface CapturedPathShadowPriceConfiguration {
  readonly outerIterations: number;
  readonly innerIterations: number;
  readonly convergenceTolerance: number;
  readonly [capturedPathShadowPriceConfigurationBrand]:
    typeof capturedPathShadowPriceConfigurationBrand;
}

/** @internal */
export type PathShadowPriceConfigurationError =
  | {
      readonly code: 'invalid-numerical-configuration';
      readonly field: 'numerical';
    }
  | {
      readonly code: 'invalid-outer-iterations';
      readonly field: 'numerical.outerIterations';
    }
  | {
      readonly code: 'invalid-inner-iterations';
      readonly field: 'numerical.innerIterations';
    }
  | {
      readonly code: 'invalid-convergence-tolerance';
      readonly field: 'numerical.convergenceTolerance';
    };

/** @internal */
export type CapturePathShadowPriceConfigurationResult =
  | { readonly ok: true; readonly value: CapturedPathShadowPriceConfiguration }
  | { readonly ok: false; readonly error: PathShadowPriceConfigurationError };

/** @internal */
export interface PathShadowPriceResolvedHop {
  readonly reserveIn: bigint;
  readonly reserveOut: bigint;
  readonly feeChargedNumerator: bigint;
  readonly feeDenominator: bigint;
}

/** @internal */
export type PathShadowPriceResolvedRoute = readonly PathShadowPriceResolvedHop[];

/** @internal */
export interface PathShadowPriceProposalRequest {
  readonly amountIn: bigint;
  readonly routes: readonly PathShadowPriceResolvedRoute[];
  readonly configuration: CapturedPathShadowPriceConfiguration;
}

/** @internal */
export interface PathShadowPriceReducedRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** @internal */
export interface PathShadowPriceRouteModel {
  readonly coefficientA: bigint;
  readonly coefficientB: bigint;
  readonly coefficientC: bigint;
  readonly exactMarginalScale: PathShadowPriceReducedRational;
  readonly exactInputScale: PathShadowPriceReducedRational;
  readonly nonauthorizingMarginalScale: number;
  readonly nonauthorizingInputScale: number;
}

/** @internal */
export type PathShadowPriceCoreFailureCode =
  | 'invalid-route-model'
  | 'non-finite-normalization'
  | 'non-finite-proposal'
  | 'non-convergence'
  | 'zero-total-weight'
  | 'invalid-reconstruction';

/** @internal */
export interface PathShadowPriceCoreFailure {
  readonly code: PathShadowPriceCoreFailureCode;
  readonly converged: boolean;
  readonly completedOuterIterations: number;
}

/** @internal */
export interface PathShadowPriceIterationState {
  readonly completedOuterIterations: number;
  readonly [pathShadowPriceIterationStateBrand]: typeof pathShadowPriceIterationStateBrand;
}

/** @internal */
export interface PathShadowPriceReadyState {
  readonly completedOuterIterations: number;
  readonly [pathShadowPriceReadyStateBrand]: typeof pathShadowPriceReadyStateBrand;
}

/** @internal */
export type PreparePathShadowPriceProposalResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly state: PathShadowPriceIterationState;
        readonly routeModels: readonly PathShadowPriceRouteModel[];
      };
    }
  | { readonly ok: false; readonly error: PathShadowPriceCoreFailure };

/** @internal */
export type AdvancePathShadowPriceProposalResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly status: 'continue'; readonly state: PathShadowPriceIterationState }
        | { readonly status: 'ready'; readonly state: PathShadowPriceReadyState };
    }
  | { readonly ok: false; readonly error: PathShadowPriceCoreFailure };

/** @internal */
export interface PathShadowPriceBaseReconstruction {
  readonly nonauthorizingWeights: readonly number[];
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

/** @internal */
export type ReconstructPathShadowPriceBaseResult =
  | { readonly ok: true; readonly value: PathShadowPriceBaseReconstruction }
  | {
      readonly ok: false;
      readonly error: { readonly code: 'zero-total-weight' | 'invalid-reconstruction' };
    };

/** @internal */
export type FinalizePathShadowPriceProposalResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly converged: true;
        readonly completedOuterIterations: number;
        readonly configuredInnerIterations: number;
        readonly reconstruction: PathShadowPriceBaseReconstruction;
      };
    }
  | { readonly ok: false; readonly error: PathShadowPriceCoreFailure };
