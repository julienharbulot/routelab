import type { ArtifactDescriptor, RetainedArtifactDescriptor } from './types.ts';

export const SERVICE_FAST_EXPERIMENT_ID =
  'm7c-core12-service-fast-numerical-v1';
export const SERVICE_FAST_TASK_ID = 'RLT-087';
export const SERVICE_FAST_CONFIG_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-config.v1.json';
export const SERVICE_FAST_CONFIG_BYTES = 76_816;
export const SERVICE_FAST_CONFIG_SHA256 =
  'sha256:28e20d4d7feedabb8d0c4331345f76891c47dcc39a1147728c3901e757413fac';
export const SERVICE_FAST_ARTIFACT_SCHEMA_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-artifact-schema.v1.json';
export const SERVICE_FAST_ARTIFACT_SCHEMA_BYTES = 67_824;
export const SERVICE_FAST_ARTIFACT_SCHEMA_SHA256 =
  'sha256:a1639d3b0156f0135f1df25eff0f9e7693e95c85674cb02c04145a94a9d4a07a';
export const SERVICE_FAST_INPUT_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-inputs.v1.ndjson';
export const SERVICE_FAST_SOURCE_CLOSURE_PATH =
  'fixtures/m7c/service-fast-numerical/source-closure.v1.json';
export const SERVICE_FAST_RETAINED_DIRECTORY =
  'datasets/experiments/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1/service-fast-numerical-v1';
export const SERVICE_FAST_MAXIMUM_DIRECTORY_BYTES = 768 * 1024 * 1024;

export const SERVICE_FAST_POLICY_IDS = Object.freeze([
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

export const SERVICE_FAST_CASE_IDS = Object.freeze([
  'historical-anchor',
  'synthetic-dual-spanning-tree',
  'synthetic-reserve-compressed-1e12',
  'synthetic-reserve-amplified-1e60',
] as const);

export const SERVICE_FAST_OPERATIONAL_CASE_IDS = Object.freeze(
  SERVICE_FAST_CASE_IDS.slice(0, 3),
);
export const SERVICE_FAST_HOTSPOT_CASE_IDS = Object.freeze([
  'historical-anchor',
  'synthetic-reserve-compressed-1e12',
] as const);
export const SERVICE_FAST_DEADLINES_MS = Object.freeze([1, 5, 10, 25, 50, 100]);

export const SERVICE_FAST_CANDIDATE_FAILURE_CODES = Object.freeze([
  'invalid-route-model',
  'non-finite-normalization',
  'non-finite-proposal',
  'non-convergence',
  'zero-total-weight',
  'invalid-reconstruction',
  'residual-options-exhausted',
  'finite-nonconverged-replayed',
  'repair-no-valid-neighbor',
  'repair-work-limit',
  'authorization-rejected',
  'authorization-mismatch',
] as const);

export const SERVICE_FAST_INPUT_RECORD_COUNT = 1_584;
export const SERVICE_FAST_SEMANTIC_RECORD_COUNT = 38_016;

export function serviceFastSemanticRecordCardinality(
  inputRecordCount: number,
): number {
  if (
    inputRecordCount !== SERVICE_FAST_INPUT_RECORD_COUNT ||
    inputRecordCount * SERVICE_FAST_POLICY_IDS.length !==
      SERVICE_FAST_SEMANTIC_RECORD_COUNT
  ) {
    throw new TypeError('Semantic schedule cardinality is invalid.');
  }
  return SERVICE_FAST_SEMANTIC_RECORD_COUNT;
}

export function serviceFastSemanticRecordIndex(
  sourceIndex: number,
  policyMatrixIndex: number,
): number {
  if (
    !Number.isSafeInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= SERVICE_FAST_INPUT_RECORD_COUNT ||
    !Number.isSafeInteger(policyMatrixIndex) ||
    policyMatrixIndex < 0 ||
    policyMatrixIndex >= SERVICE_FAST_POLICY_IDS.length
  ) {
    throw new TypeError('Semantic record identity is invalid.');
  }
  return sourceIndex * SERVICE_FAST_POLICY_IDS.length + policyMatrixIndex;
}

export const SERVICE_FAST_LIMITATIONS = Object.freeze([
  'numerical-candidate-stage-only',
  'policy-not-yet-supported',
  'no-service-latency-claim',
  'no-load-or-concurrency-claim',
  'no-representative-demand-claim',
  'no-production-financial-execution-claim',
  'no-unrestricted-optimality-claim',
]);

export const SERVICE_FAST_CLAUSE_IDS = Object.freeze([
  'fresh-exact-safety',
  'full-semantic-nonregression',
  'service-failure-reduction',
  'service-timing-nonregression',
  'hotspot-speedup',
  'deadline-and-event-quality',
]);

export const SERVICE_FAST_COUNTER_KEYS = Object.freeze([
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

export const SERVICE_FAST_EXECUTION_SCHEDULE = Object.freeze({
  totalPolicyCalls: 237_600,
  semanticCalls: 38_016,
  callWarmups: 6_048,
  callRetained: 30_240,
  timelineRetained: 18_144,
  deadlineWarmups: 36_288,
  deadlineRetained: 108_864,
});

const RETAINED_FILE_CONTRACTS = Object.freeze([
  Object.freeze({
    name: 'inputs.ndjson',
    contentRole: 'input' as const,
    schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1',
    recordCount: 1_584,
    maxBytes: 64 * 1024 * 1024,
  }),
  Object.freeze({
    name: 'semantic-results.ndjson',
    contentRole: 'semantic' as const,
    schemaVersion: 'routelab.service-fast-numerical-semantic-result.v1',
    recordCount: 38_016,
    maxBytes: 256 * 1024 * 1024,
  }),
  Object.freeze({
    name: 'call-timing-observations.ndjson',
    contentRole: 'call-timing' as const,
    schemaVersion: 'routelab.service-fast-numerical-call-timing-observation.v1',
    recordCount: 30_240,
    maxBytes: 128 * 1024 * 1024,
  }),
  Object.freeze({
    name: 'incumbent-timeline-observations.ndjson',
    contentRole: 'incumbent-timeline' as const,
    schemaVersion: 'routelab.service-fast-numerical-incumbent-timeline-observation.v1',
    recordCount: 18_144,
    maxBytes: 128 * 1024 * 1024,
  }),
  Object.freeze({
    name: 'deadline-observations.ndjson',
    contentRole: 'deadline' as const,
    schemaVersion: 'routelab.service-fast-numerical-deadline-observation.v1',
    recordCount: 108_864,
    maxBytes: 256 * 1024 * 1024,
  }),
  Object.freeze({
    name: 'analysis.json',
    contentRole: 'analysis' as const,
    schemaVersion: 'routelab.service-fast-numerical-analysis.v1',
    recordCount: null,
    maxBytes: 8 * 1024 * 1024,
  }),
  Object.freeze({
    name: 'manifest.json',
    contentRole: null,
    schemaVersion: 'routelab.service-fast-numerical-manifest.v1',
    recordCount: null,
    maxBytes: 1024 * 1024,
  }),
  Object.freeze({
    name: 'README.md',
    contentRole: 'readme' as const,
    schemaVersion: null,
    recordCount: null,
    maxBytes: 1024 * 1024,
  }),
]);

export interface RetainedFileContract {
  readonly name: string;
  readonly contentRole: RetainedArtifactDescriptor['contentRole'] | null;
  readonly schemaVersion: string | null;
  readonly recordCount: number | null;
  readonly maxBytes: number;
}

export function serviceFastRetainedFileContracts(): readonly RetainedFileContract[] {
  return RETAINED_FILE_CONTRACTS;
}

export function configDescriptor(): ArtifactDescriptor {
  return Object.freeze({
    path: SERVICE_FAST_CONFIG_PATH,
    bytes: SERVICE_FAST_CONFIG_BYTES,
    sha256: SERVICE_FAST_CONFIG_SHA256,
  });
}

export function artifactSchemaDescriptor(): ArtifactDescriptor {
  return Object.freeze({
    path: SERVICE_FAST_ARTIFACT_SCHEMA_PATH,
    bytes: SERVICE_FAST_ARTIFACT_SCHEMA_BYTES,
    sha256: SERVICE_FAST_ARTIFACT_SCHEMA_SHA256,
  });
}
