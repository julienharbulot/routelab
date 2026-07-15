/** Accepted-run-only JSON value. @internal */
export type AcceptedJson =
  | null
  | boolean
  | number
  | string
  | readonly AcceptedJson[]
  | AcceptedJsonObject;

/** Accepted-run-only JSON object. @internal */
export interface AcceptedJsonObject {
  readonly [key: string]: AcceptedJson;
}

/** Frozen byte identity used by the accepted run. @internal */
export interface AcceptedArtifactDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** Decoded and admitted experiment input identity. @internal */
export interface AcceptedInputRecord {
  readonly value: AcceptedJsonObject;
  readonly sourceIndex: number;
  readonly caseId: string;
  readonly requestId: string;
  readonly timingCohortIndex: number | null;
  readonly serviceDecisionMember: boolean;
  readonly amplifiedStressMember: boolean;
}

export const ACCEPTED_EXPERIMENT_ID =
  'm7c-core12-service-fast-numerical-v1';
export const ACCEPTED_TASK_ID = 'RLT-087';
export const ACCEPTED_CONFIG_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-config.v1.json';
export const ACCEPTED_CONFIG_BYTES = 76_816;
export const ACCEPTED_CONFIG_SHA256 =
  'sha256:28e20d4d7feedabb8d0c4331345f76891c47dcc39a1147728c3901e757413fac';
export const ACCEPTED_ARTIFACT_SCHEMA_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-artifact-schema.v1.json';
export const ACCEPTED_ARTIFACT_SCHEMA_BYTES = 67_824;
export const ACCEPTED_ARTIFACT_SCHEMA_SHA256 =
  'sha256:a1639d3b0156f0135f1df25eff0f9e7693e95c85674cb02c04145a94a9d4a07a';
export const ACCEPTED_INPUT_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-inputs.v1.ndjson';
export const ACCEPTED_SOURCE_CLOSURE_PATH =
  'fixtures/m7c/service-fast-numerical/source-closure.v1.json';
export const ACCEPTED_RETAINED_DIRECTORY =
  'datasets/experiments/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1/service-fast-numerical-v1';
export const ACCEPTED_PUBLICATION_LOCK_NAME =
  '.service-fast-numerical-v1-publication-lock';

export const ACCEPTED_POLICY_IDS = Object.freeze([
  'bisection-o64-i64--strict-reject--current',
  'bisection-o64-i64--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o64-i64--final-finite-replay--current',
  'bisection-o64-i64--final-finite-replay--bounded-exact-neighborhood-v1',
  'bisection-o64-i24--strict-reject--current',
  'bisection-o64-i24--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o64-i24--final-finite-replay--current',
  'bisection-o64-i24--final-finite-replay--bounded-exact-neighborhood-v1',
  'bisection-o32-i16--strict-reject--current',
  'bisection-o32-i16--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o32-i16--final-finite-replay--current',
  'bisection-o32-i16--final-finite-replay--bounded-exact-neighborhood-v1',
  'bisection-o16-i12--strict-reject--current',
  'bisection-o16-i12--strict-reject--bounded-exact-neighborhood-v1',
  'bisection-o16-i12--final-finite-replay--current',
  'bisection-o16-i12--final-finite-replay--bounded-exact-neighborhood-v1',
  'pinned-sqrt-o64--strict-reject--current',
  'pinned-sqrt-o64--strict-reject--bounded-exact-neighborhood-v1',
  'pinned-sqrt-o64--final-finite-replay--current',
  'pinned-sqrt-o64--final-finite-replay--bounded-exact-neighborhood-v1',
  'fixed-newton-sqrt-o64-n8--strict-reject--current',
  'fixed-newton-sqrt-o64-n8--strict-reject--bounded-exact-neighborhood-v1',
  'fixed-newton-sqrt-o64-n8--final-finite-replay--current',
  'fixed-newton-sqrt-o64-n8--final-finite-replay--bounded-exact-neighborhood-v1',
] as const);

export const ACCEPTED_CASE_IDS = Object.freeze([
  'historical-anchor',
  'synthetic-dual-spanning-tree',
  'synthetic-reserve-compressed-1e12',
  'synthetic-reserve-amplified-1e60',
] as const);
export const ACCEPTED_OPERATIONAL_CASE_IDS = Object.freeze(
  ACCEPTED_CASE_IDS.slice(0, 3),
);
export const ACCEPTED_HOTSPOT_CASE_IDS = Object.freeze([
  'historical-anchor',
  'synthetic-reserve-compressed-1e12',
] as const);
export const ACCEPTED_DEADLINES_MS = Object.freeze([1, 5, 10, 25, 50, 100]);
export const ACCEPTED_LIMITATIONS = Object.freeze([
  'numerical-candidate-stage-only',
  'policy-not-yet-supported',
  'no-service-latency-claim',
  'no-load-or-concurrency-claim',
  'no-representative-demand-claim',
  'no-production-financial-execution-claim',
  'no-unrestricted-optimality-claim',
]);
export const ACCEPTED_CLAUSE_IDS = Object.freeze([
  'fresh-exact-safety',
  'full-semantic-nonregression',
  'service-failure-reduction',
  'service-timing-nonregression',
  'hotspot-speedup',
  'deadline-and-event-quality',
]);
export const ACCEPTED_COUNTER_KEYS = Object.freeze([
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

export const ACCEPTED_EXECUTION_SCHEDULE = Object.freeze({
  totalPolicyCalls: 237_600,
  semanticCalls: 38_016,
  callWarmups: 6_048,
  callRetained: 30_240,
  timelineRetained: 18_144,
  deadlineWarmups: 36_288,
  deadlineRetained: 108_864,
});

export interface AcceptedRetainedFileContract {
  readonly name: string;
  readonly contentRole: string | null;
  readonly schemaVersion: string | null;
  readonly recordCount: number | null;
  readonly maxBytes: number;
}

const FILES = Object.freeze([
  Object.freeze({ name: 'inputs.ndjson', contentRole: 'input', schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1', recordCount: 1_584, maxBytes: 64 * 1024 * 1024 }),
  Object.freeze({ name: 'semantic-results.ndjson', contentRole: 'semantic', schemaVersion: 'routelab.service-fast-numerical-semantic-result.v1', recordCount: 38_016, maxBytes: 256 * 1024 * 1024 }),
  Object.freeze({ name: 'call-timing-observations.ndjson', contentRole: 'call-timing', schemaVersion: 'routelab.service-fast-numerical-call-timing-observation.v1', recordCount: 30_240, maxBytes: 128 * 1024 * 1024 }),
  Object.freeze({ name: 'incumbent-timeline-observations.ndjson', contentRole: 'incumbent-timeline', schemaVersion: 'routelab.service-fast-numerical-incumbent-timeline-observation.v1', recordCount: 18_144, maxBytes: 128 * 1024 * 1024 }),
  Object.freeze({ name: 'deadline-observations.ndjson', contentRole: 'deadline', schemaVersion: 'routelab.service-fast-numerical-deadline-observation.v1', recordCount: 108_864, maxBytes: 256 * 1024 * 1024 }),
  Object.freeze({ name: 'analysis.json', contentRole: 'analysis', schemaVersion: 'routelab.service-fast-numerical-analysis.v1', recordCount: null, maxBytes: 8 * 1024 * 1024 }),
  Object.freeze({ name: 'manifest.json', contentRole: null, schemaVersion: 'routelab.service-fast-numerical-manifest.v1', recordCount: null, maxBytes: 1024 * 1024 }),
  Object.freeze({ name: 'README.md', contentRole: 'readme', schemaVersion: null, recordCount: null, maxBytes: 1024 * 1024 }),
] satisfies readonly AcceptedRetainedFileContract[]);

export function acceptedRetainedFileContracts(): readonly AcceptedRetainedFileContract[] {
  return FILES;
}

export function acceptedDescriptor(
  path: string,
  bytes: number,
  sha256: string,
): AcceptedArtifactDescriptor {
  return Object.freeze({ path, bytes, sha256 });
}
