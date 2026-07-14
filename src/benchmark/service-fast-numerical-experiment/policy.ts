import type {
  ServiceFastPathShadowPriceDriverId,
  ServiceFastPathShadowPriceNonConvergence,
} from '../../allocation/service-fast-path-shadow-price/index.ts';

/** @internal */
export type ServiceFastExperimentReconstruction =
  | 'current'
  | 'bounded-exact-neighborhood-v1';

/** @internal */
export type ServiceFastExperimentPolicyId =
  `${ServiceFastPathShadowPriceDriverId}--${ServiceFastPathShadowPriceNonConvergence}--${ServiceFastExperimentReconstruction}`;

/** @internal */
export interface ServiceFastExperimentPolicy {
  readonly policyIndex: number;
  readonly policyId: ServiceFastExperimentPolicyId;
  readonly driverId: ServiceFastPathShadowPriceDriverId;
  readonly nonConvergence: ServiceFastPathShadowPriceNonConvergence;
  readonly reconstruction: ServiceFastExperimentReconstruction;
  readonly maximumShareActions: number;
}

/** @internal */
export interface ServiceFastExperimentActionCaps {
  readonly proposals: number;
  readonly shareActions: number;
  readonly reconstructionSteps: number;
  readonly residualReplays: number;
  readonly repairReplays: number;
  readonly authorizationReplays: number;
  readonly stageAggregate: number;
}

/** @internal */
export interface ServiceFastExperimentMaximumCaps
  extends ServiceFastExperimentActionCaps {
  readonly modelRouteSetupSteps: number;
  readonly conservativeAggregate: number;
}

interface DriverPolicy {
  readonly driverId: ServiceFastPathShadowPriceDriverId;
  readonly maximumShareActions: number;
}

const DRIVERS: readonly DriverPolicy[] = Object.freeze([
  Object.freeze({ driverId: 'bisection-o64-i64', maximumShareActions: 68_640 }),
  Object.freeze({ driverId: 'bisection-o64-i24', maximumShareActions: 27_040 }),
  Object.freeze({ driverId: 'bisection-o32-i16', maximumShareActions: 9_504 }),
  Object.freeze({ driverId: 'bisection-o16-i12', maximumShareActions: 3_808 }),
  Object.freeze({ driverId: 'pinned-sqrt-o64', maximumShareActions: 2_080 }),
  Object.freeze({
    driverId: 'fixed-newton-sqrt-o64-n8',
    maximumShareActions: 11_440,
  }),
]);

const NON_CONVERGENCE: readonly ServiceFastPathShadowPriceNonConvergence[] =
  Object.freeze(['strict-reject', 'final-finite-replay']);
const RECONSTRUCTIONS: readonly ServiceFastExperimentReconstruction[] =
  Object.freeze(['current', 'bounded-exact-neighborhood-v1']);

const POLICIES: readonly ServiceFastExperimentPolicy[] = Object.freeze(
  DRIVERS.flatMap((driver) =>
    NON_CONVERGENCE.flatMap((nonConvergence) =>
      RECONSTRUCTIONS.map((reconstruction) => {
        const policyIndex =
          DRIVERS.indexOf(driver) * NON_CONVERGENCE.length * RECONSTRUCTIONS.length +
          NON_CONVERGENCE.indexOf(nonConvergence) * RECONSTRUCTIONS.length +
          RECONSTRUCTIONS.indexOf(reconstruction);
        return Object.freeze({
          policyIndex,
          policyId: `${driver.driverId}--${nonConvergence}--${reconstruction}`,
          driverId: driver.driverId,
          nonConvergence,
          reconstruction,
          maximumShareActions: driver.maximumShareActions,
        });
      }),
    ),
  ),
);

/** @internal */
export const SERVICE_FAST_EXPERIMENT_POLICY_COUNT = 24;

/** @internal */
export const SERVICE_FAST_EXPERIMENT_ANCHOR_POLICY_ID =
  'bisection-o64-i64--strict-reject--current' as const;

/** @internal */
export const SERVICE_FAST_EXPERIMENT_MAXIMUM_CAPS:
  ServiceFastExperimentMaximumCaps = Object.freeze({
    proposals: 4,
    modelRouteSetupSteps: 16,
    shareActions: 68_640,
    reconstructionSteps: 48,
    residualReplays: 48,
    repairReplays: 29,
    authorizationReplays: 4,
    stageAggregate: 68_773,
    conservativeAggregate: 68_789,
  });

function copyPolicy(policy: ServiceFastExperimentPolicy): ServiceFastExperimentPolicy {
  return Object.freeze({ ...policy });
}

/** @internal */
export function serviceFastExperimentPolicyAt(
  policyIndex: number,
): ServiceFastExperimentPolicy {
  if (!Number.isSafeInteger(policyIndex) || policyIndex < 0 || policyIndex >= 24) {
    throw new TypeError('Service-fast experiment policy index is invalid.');
  }
  const policy = POLICIES[policyIndex];
  if (policy === undefined) {
    throw new Error('Service-fast experiment policy matrix is incomplete.');
  }
  return copyPolicy(policy);
}

/** @internal */
export function serviceFastExperimentPolicies():
  readonly ServiceFastExperimentPolicy[] {
  return Object.freeze(POLICIES.map(copyPolicy));
}

/** @internal */
export function serviceFastExperimentMaximumCapsForPolicy(
  policyIndex: number,
): ServiceFastExperimentMaximumCaps {
  const policy = serviceFastExperimentPolicyAt(policyIndex);
  return Object.freeze({
    ...SERVICE_FAST_EXPERIMENT_MAXIMUM_CAPS,
    shareActions: policy.maximumShareActions,
  });
}

function validCap(value: unknown, maximum: number): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum;
}

/** @internal */
export function captureServiceFastExperimentActionCaps(
  source: ServiceFastExperimentActionCaps | undefined,
  policyIndex: number,
): ServiceFastExperimentActionCaps {
  const maximum = serviceFastExperimentMaximumCapsForPolicy(policyIndex);
  if (source === undefined) {
    return Object.freeze({
      proposals: maximum.proposals,
      shareActions: maximum.shareActions,
      reconstructionSteps: maximum.reconstructionSteps,
      residualReplays: maximum.residualReplays,
      repairReplays: maximum.repairReplays,
      authorizationReplays: maximum.authorizationReplays,
      stageAggregate: maximum.stageAggregate,
    });
  }
  let proposals: unknown;
  let shareActions: unknown;
  let reconstructionSteps: unknown;
  let residualReplays: unknown;
  let repairReplays: unknown;
  let authorizationReplays: unknown;
  let stageAggregate: unknown;
  try {
    proposals = source.proposals;
    shareActions = source.shareActions;
    reconstructionSteps = source.reconstructionSteps;
    residualReplays = source.residualReplays;
    repairReplays = source.repairReplays;
    authorizationReplays = source.authorizationReplays;
    stageAggregate = source.stageAggregate;
  } catch {
    throw new TypeError('Service-fast experiment action caps are invalid.');
  }
  if (
    !validCap(proposals, maximum.proposals) ||
    !validCap(shareActions, maximum.shareActions) ||
    !validCap(reconstructionSteps, maximum.reconstructionSteps) ||
    !validCap(residualReplays, maximum.residualReplays) ||
    !validCap(repairReplays, maximum.repairReplays) ||
    !validCap(authorizationReplays, maximum.authorizationReplays) ||
    !validCap(stageAggregate, maximum.stageAggregate)
  ) {
    throw new TypeError('Service-fast experiment action caps are invalid.');
  }
  return Object.freeze({
    proposals,
    shareActions,
    reconstructionSteps,
    residualReplays,
    repairReplays,
    authorizationReplays,
    stageAggregate,
  });
}
