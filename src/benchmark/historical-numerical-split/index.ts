import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitConfiguration,
  type NumericalExactInputSplitDiagnostic,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCaps,
  type NumericalExactInputSplitWorkCounters,
} from '../../router/numerical-exact-input-split/index.ts';
import { isStrictlyBetterSplitReceipt } from '../../router/split-exact-input/objective.ts';
import {
  projectCanonicalSplitRouterResult,
  projectCanonicalSplitRouterWorkCounters,
  type CanonicalSplitRouterRuntimeResult,
} from '../../serialization/canonical-split-router-result/index.ts';
import {
  CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
  verifyHistoricalComposedSplitEvaluationWithVerifiedCorpus,
} from '../historical-composed-split/index.ts';
import {
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  verifySyntheticRequestCorpus,
  type SyntheticExactInputRequest,
  type SyntheticRequestCorpusVerificationResult,
} from '../../verification/synthetic-request-corpus/index.ts';

export const CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH =
  'fixtures/m7/numerical-historical/comparison-config.v1.json';

export const CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH =
  'fixtures/m7/numerical-historical/eligibility.v1.json';

export const CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH =
  'fixtures/m7/numerical-historical/forced-failure-evidence.v1.json';

export const CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/numerical-path-shadow-price-v1';

export const HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID =
  'm7a-core12-synthetic-exhaustive-numerical-path-shadow-price-evaluation-v1';

export const HISTORICAL_NUMERICAL_SPLIT_RUNTIME_REVISION =
  'cdc5a83b47ca35e9173a41e95f7e32e81e4f9d85';

const COMPARISON_CONFIG_ID =
  'm7a-core12-synthetic-exhaustive-numerical-path-shadow-price-v1';
const COMPARISON_CONFIG_BYTES = 4_650;
const COMPARISON_CONFIG_SHA256 =
  'sha256:96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6';
const ELIGIBILITY_ID =
  'm7a-core12-synthetic-exhaustive-numerical-path-shadow-price-eligibility-v1';
const ELIGIBILITY_BYTES = 261_915;
const ELIGIBILITY_SHA256 =
  'sha256:5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc';
const FORCED_FAILURE_EVIDENCE_ID =
  'm7a-numerical-runtime-forced-failure-baseline-preservation-v1';
const FORCED_FAILURE_EVIDENCE_BYTES = 2_721;
const FORCED_FAILURE_EVIDENCE_SHA256 =
  'sha256:e2a3ccf161ac33b938da45e1e50569fdbe6b28d34268b468b6dfd24a45d2c4e7';
const FORCED_FAILURE_SOURCE_PATH =
  'tests/oracle/numerical-exact-input-split-runtime-oracle.test.ts';
const FORCED_FAILURE_SOURCE_BYTES = 52_464;
const FORCED_FAILURE_SOURCE_SHA256 =
  'sha256:4f4ca6c3c0d0dd42b4a5ce8731bbdeb9d351e1d59e719ff60ed0f14eafdcb2e2';
const FORCED_FAILURE_SOURCE_TEST_COUNT = 13;
const BASELINE_SEMANTIC_SHA256 =
  'sha256:28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e';
const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const SNAPSHOT_CHECKSUM =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const CORPUS_SHA256 =
  'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173';

const PROFILE_IDS = Object.freeze([
  'fraction-0',
  'fraction-1-16',
  'fraction-1-8',
  'fraction-1-4',
  'fraction-1-2',
  'structural-complete',
] as const);

const BASE_COUNTER_FIELDS = Object.freeze([
  'directCandidates',
  'directCandidateReplays',
  'directCandidateRejections',
  'pathExpansions',
  'bestSingleCandidateReplays',
  'bestSingleCandidateRejections',
  'candidateSetExpansions',
  'equalProposalReplays',
  'equalProposalRejections',
  'greedyOptionReplays',
  'greedyOptionRejections',
  'finalAuthorizationReplays',
  'finalAuthorizationRejections',
] as const);

const COUNTER_FIELDS = Object.freeze([
  ...BASE_COUNTER_FIELDS,
  'numericalProposals',
  'numericalProposalFailures',
  'numericalIterations',
  'numericalResidualReplays',
  'numericalResidualReplayRejections',
  'numericalAuthorizationReplays',
  'numericalAuthorizationReplayRejections',
] as const);

const CAP_FIELDS = Object.freeze([
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
  'maxNumericalProposals',
  'maxNumericalIterations',
  'maxNumericalResidualReplays',
  'maxNumericalAuthorizationReplays',
] as const);

const REASONS = Object.freeze([
  'baseline-no-authorized-incumbent',
  'path-discovery-incomplete',
  'candidate-set-discovery-incomplete',
  'no-model-valid-candidate-set',
] as const);

const FORCED_FAILURE_CASES = Object.freeze([
  Object.freeze({
    scenario: 'missing-baseline-suppresses-numerical-work',
    testName: 'RT00 has no incumbent and therefore no numerical proposal identity',
  }),
  Object.freeze({
    scenario: 'natural-model-and-replay-outcomes',
    testName: 'RT01-RT09 match frozen numerical outcomes and preserve or improve the exact baseline',
  }),
  Object.freeze({
    scenario: 'normalization-iteration-underflow-and-convergence-failures',
    testName: 'RT10-RT13 map normalization, atomic iteration, underflow, and convergence failures',
  }),
  Object.freeze({
    scenario: 'numerical-cap-stops',
    testName: 'all four numerical caps stop before charge and exact caps complete naturally',
  }),
  Object.freeze({
    scenario: 'cap-callback-clock-precedence',
    testName: 'cap precedence suppresses callback and clock at the pending numerical unit',
  }),
  Object.freeze({
    scenario: 'callback-stops-and-callback-failures',
    testName: 'callback true, throw, and nonboolean stop at every numerical kind',
  }),
  Object.freeze({
    scenario: 'deadline-and-clock-failures',
    testName: 'absolute deadline, clock failure, and one monotonic history cover every numerical kind',
  }),
  Object.freeze({
    scenario: 'forced-proposal-core-failures',
    testName: 'proposal-only seam maps the three naturally unreachable core failure codes',
  }),
  Object.freeze({
    scenario: 'authorization-rejection-and-mismatch',
    testName: 'authorization seam is phase-limited and requires recursive exact receipt identity',
  }),
  Object.freeze({
    scenario: 'mutation-reentrancy-and-freshness',
    testName: 'pool permutation, captured mutation, reentrancy, freshness, and deep freeze are deterministic',
  }),
] as const);

const FORCED_FAILURE_LIMITATIONS = Object.freeze([
  'This artifact binds the exact retained independent runtime-oracle source; the repository test gate executes that source, while the historical evaluator validates its canonical identity and derives the decision clause from the declared outcomes.',
  'The historical evaluation does not inject failures into market cells, and this evidence makes no timing, performance, default-mode, production, or unrestricted-optimality claim.',
]);

const FORCED_FAILURE_SOURCE_BINDING = Object.freeze({
  path: FORCED_FAILURE_SOURCE_PATH,
  bytes: FORCED_FAILURE_SOURCE_BYTES,
  sha256: FORCED_FAILURE_SOURCE_SHA256,
  testCount: FORCED_FAILURE_SOURCE_TEST_COUNT,
});

const FORCED_FAILURE_EVIDENCE_BINDING = Object.freeze({
  evidenceId: FORCED_FAILURE_EVIDENCE_ID,
  path: CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
  bytes: FORCED_FAILURE_EVIDENCE_BYTES,
  sha256: FORCED_FAILURE_EVIDENCE_SHA256,
  source: FORCED_FAILURE_SOURCE_BINDING,
});

const NUMERICAL_CONFIGURATION: NumericalExactInputSplitConfiguration = Object.freeze({
  outerIterations: 64,
  innerIterations: 64,
  convergenceTolerance: 2 ** -40,
});

const LIMITATIONS = Object.freeze([
  'One frozen block, venue, 12-asset allowlist, synthetic exhaustive request grid, and result-blind eligibility cohort only.',
  'Exact comparisons are request/profile-local; outputs are never summed across assets.',
  'Approximate numerical allocation only proposes candidates; fresh exact replay authorizes every retained incumbent.',
  'Typed work kinds remain separate and are not combined into a universal work scalar.',
  'No latency, speedup, representative demand, unrestricted optimum, transaction submission, custody, live execution, or production claim is made.',
]);

type JsonRecord = Record<string, unknown>;
type ProfileId = (typeof PROFILE_IDS)[number];
type EligibilityReason = (typeof REASONS)[number];
type ObjectiveRelation = 'strictly-improved' | 'equal' | 'regressed';
type ForcedFailureOutcome = 'baseline-preserved' | 'baseline-not-preserved';
type VerifiedCorpusBundle = Extract<
  SyntheticRequestCorpusVerificationResult,
  { readonly ok: true }
>['value'];

interface ArtifactDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface Profile {
  readonly profileId: ProfileId;
  readonly workCaps: NumericalExactInputSplitWorkCaps;
}

interface ComparisonConfig {
  readonly value: JsonRecord;
  readonly profiles: readonly Profile[];
}

interface EligibilityCell {
  readonly requestId: string;
  readonly profileId: ProfileId;
  readonly status: 'eligible' | 'ineligible';
  readonly reason?: EligibilityReason;
}

interface EligibilityArtifact {
  readonly value: JsonRecord;
  readonly cells: readonly EligibilityCell[];
}

interface ForcedFailureEvidenceCase {
  readonly scenario: string;
  readonly testName: string;
  readonly outcome: ForcedFailureOutcome;
}

interface ForcedFailureEvidence {
  readonly value: JsonRecord;
  readonly cases: readonly ForcedFailureEvidenceCase[];
}

interface SemanticBuild {
  readonly json: string;
  readonly document: JsonRecord;
  readonly summary: HistoricalNumericalSplitEvaluationSummary;
}

export interface HistoricalNumericalSplitEvaluationReadDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
}

export type HistoricalNumericalSplitEvaluationErrorCode =
  | 'manifest-read-failed'
  | 'invalid-manifest-json'
  | 'invalid-manifest-shape'
  | 'config-read-failed'
  | 'config-size-mismatch'
  | 'config-hash-mismatch'
  | 'invalid-config-json'
  | 'invalid-config-shape'
  | 'eligibility-read-failed'
  | 'eligibility-size-mismatch'
  | 'eligibility-hash-mismatch'
  | 'invalid-eligibility-json'
  | 'invalid-eligibility-shape'
  | 'forced-failure-evidence-read-failed'
  | 'forced-failure-evidence-size-mismatch'
  | 'forced-failure-evidence-hash-mismatch'
  | 'invalid-forced-failure-evidence-json'
  | 'invalid-forced-failure-evidence-shape'
  | 'forced-failure-source-read-failed'
  | 'forced-failure-source-size-mismatch'
  | 'forced-failure-source-hash-mismatch'
  | 'forced-failure-source-test-mismatch'
  | 'corpus-invalid'
  | 'baseline-evaluation-invalid'
  | 'baseline-binding-mismatch'
  | 'semantic-results-read-failed'
  | 'semantic-results-size-mismatch'
  | 'semantic-results-hash-mismatch'
  | 'invalid-semantic-results-json'
  | 'invalid-semantic-results-shape'
  | 'semantic-replay-mismatch'
  | 'manifest-metadata-mismatch'
  | 'runtime-result-invalid'
  | 'baseline-prefix-mismatch';

export interface HistoricalNumericalSplitEvaluationError {
  readonly code: HistoricalNumericalSplitEvaluationErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface HistoricalNumericalSplitDecisionClauses {
  readonly noEligibleObjectiveRegressions: boolean;
  readonly forcedFailuresPreserveBaseline: boolean;
  readonly allEligibleCandidateSetsHaveTerminalDiagnostics: boolean;
  readonly atLeastOneEligibleRequestStrictlyImprovesExactOutput: boolean;
}

export interface HistoricalNumericalSplitEvaluationSummary {
  readonly schemaVersion: 'routelab.numerical-historical-evaluation-summary.v1';
  readonly evaluationId: string;
  readonly comparisonConfigSha256: string;
  readonly eligibilitySha256: string;
  readonly baselineSemanticResultsSha256: string;
  readonly semanticResultsSha256: string;
  readonly requestCount: number;
  readonly profileCount: number;
  readonly cellCount: number;
  readonly eligibleCellCount: number;
  readonly ineligibleCellCount: number;
  readonly objectiveRelations: Readonly<Record<ObjectiveRelation, number>>;
  readonly ineligibleReasons: Readonly<Record<EligibilityReason, number>>;
  readonly diagnosticStatuses: Readonly<Record<string, number>>;
  readonly diagnosticFailureCodes: Readonly<Record<string, number>>;
  readonly counterTotals: Readonly<Record<(typeof COUNTER_FIELDS)[number], number>>;
  readonly counterMaxima: Readonly<Record<(typeof COUNTER_FIELDS)[number], number>>;
  readonly strictlyImprovedRequestCount: number;
  readonly decision: {
    readonly mode: 'primary' | 'experimental';
    readonly clauses: HistoricalNumericalSplitDecisionClauses;
  };
}

export interface HistoricalNumericalSplitEvaluationArtifacts {
  readonly manifestJson: string;
  readonly semanticResultsJson: string;
  readonly summary: HistoricalNumericalSplitEvaluationSummary;
}

export type HistoricalNumericalSplitEvaluationGenerationResult =
  | { readonly ok: true; readonly value: HistoricalNumericalSplitEvaluationArtifacts }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError };

export type HistoricalNumericalSplitEvaluationVerificationResult =
  | { readonly ok: true; readonly value: HistoricalNumericalSplitEvaluationSummary }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError };

class EvaluationAbort extends Error {
  readonly code: HistoricalNumericalSplitEvaluationErrorCode;
  readonly artifact: string;

  constructor(
    code: HistoricalNumericalSplitEvaluationErrorCode,
    artifact: string,
  ) {
    super(code);
    this.code = code;
    this.artifact = artifact;
  }
}

function failure(
  code: HistoricalNumericalSplitEvaluationErrorCode,
  artifact: string,
): { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError } {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      artifact,
      message: `Historical numerical evaluation failed at ${artifact}.`,
    }),
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function parseJson(bytes: Uint8Array): { readonly text: string; readonly value: unknown } | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Object.freeze({ text, value: JSON.parse(text) as unknown });
  } catch {
    return undefined;
  }
}

async function safeRead(
  readFile: (filePath: string) => Promise<Uint8Array>,
  filePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return Uint8Array.from(await readFile(filePath));
  } catch {
    return undefined;
  }
}

function cachedDependencies(
  dependencies: HistoricalNumericalSplitEvaluationReadDependencies,
): HistoricalNumericalSplitEvaluationReadDependencies {
  const cache = new Map<string, Promise<Uint8Array>>();
  return Object.freeze({
    readFile(filePath: string): Promise<Uint8Array> {
      let read = cache.get(filePath);
      if (read === undefined) {
        read = Promise.resolve().then(() => dependencies.readFile(filePath));
        cache.set(filePath, read);
      }
      return read.then((bytes) => Uint8Array.from(bytes));
    },
  });
}

function parseCaps(value: unknown): NumericalExactInputSplitWorkCaps | undefined {
  if (!isRecord(value) || !hasExactKeys(value, CAP_FIELDS)) return undefined;
  const caps: Partial<Record<(typeof CAP_FIELDS)[number], number>> = {};
  for (const field of CAP_FIELDS) {
    if (!isSafeNonnegativeInteger(value[field])) return undefined;
    caps[field] = value[field];
  }
  return Object.freeze(caps) as NumericalExactInputSplitWorkCaps;
}

function parseProfiles(value: unknown): readonly Profile[] | undefined {
  if (!Array.isArray(value) || value.length !== PROFILE_IDS.length) return undefined;
  const values = value as readonly unknown[];
  const profiles: Profile[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    const profileId = PROFILE_IDS[index];
    if (
      profileId === undefined
      || !isRecord(current)
      || !hasExactKeys(current, ['profileId', 'workCaps'])
      || current['profileId'] !== profileId
    ) return undefined;
    const workCaps = parseCaps(current['workCaps']);
    if (workCaps === undefined) return undefined;
    profiles.push(Object.freeze({ profileId, workCaps }));
  }
  return Object.freeze(profiles);
}

function validateConfigShape(value: unknown): ComparisonConfig | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'comparisonConfigId', 'inputBinding', 'runtime', 'schedule',
    'profiles', 'comparison',
  ])) return undefined;
  if (
    value['schemaVersion'] !== 'routelab.numerical-historical-comparison-config.v1'
    || value['comparisonConfigId'] !== COMPARISON_CONFIG_ID
    || !isRecord(value['runtime'])
    || !isRecord(value['schedule'])
    || !isRecord(value['inputBinding'])
    || !isRecord(value['comparison'])
  ) return undefined;
  const runtime = value['runtime'];
  const schedule = value['schedule'];
  if (
    runtime['entryPoint'] !== 'routeExactInputSplitNumericalAnytime'
    || !isRecord(runtime['request'])
    || runtime['request']['maxHops'] !== 2
    || runtime['request']['maxRoutes'] !== 2
    || runtime['request']['greedyParts'] !== 16
    || !isDeepStrictEqual(runtime['request']['numerical'], NUMERICAL_CONFIGURATION)
    || !isDeepStrictEqual(schedule['profileOrder'], PROFILE_IDS)
  ) return undefined;
  const profiles = parseProfiles(value['profiles']);
  if (profiles === undefined) return undefined;
  return Object.freeze({ value, profiles });
}

async function readComparisonConfig(
  dependencies: HistoricalNumericalSplitEvaluationReadDependencies,
  expected: ArtifactDescriptor,
): Promise<
  | { readonly ok: true; readonly value: ComparisonConfig }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError }
> {
  const bytes = await safeRead(dependencies.readFile, CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH);
  if (bytes === undefined) return failure('config-read-failed', 'comparison-config.v1.json');
  if (bytes.byteLength !== expected.bytes) return failure('config-size-mismatch', 'comparison-config.v1.json');
  if (sha256(bytes) !== expected.sha256) return failure('config-hash-mismatch', 'comparison-config.v1.json');
  if (expected.bytes !== COMPARISON_CONFIG_BYTES || expected.sha256 !== COMPARISON_CONFIG_SHA256) {
    return failure('invalid-config-shape', 'comparison-config.v1.json');
  }
  const parsed = parseJson(bytes);
  if (parsed === undefined) return failure('invalid-config-json', 'comparison-config.v1.json');
  const config = validateConfigShape(parsed.value);
  if (config === undefined || parsed.text !== JSON.stringify(parsed.value)) {
    return failure('invalid-config-shape', 'comparison-config.v1.json');
  }
  return Object.freeze({ ok: true, value: config });
}

function parseEligibilityCell(value: unknown): EligibilityCell | undefined {
  if (!isRecord(value)) return undefined;
  const status = value['status'];
  if (status === 'eligible') {
    if (!hasExactKeys(value, ['requestId', 'profileId', 'status'])) return undefined;
  } else if (status === 'ineligible') {
    if (!hasExactKeys(value, ['requestId', 'profileId', 'status', 'reason'])) return undefined;
    if (!REASONS.includes(value['reason'] as EligibilityReason)) return undefined;
  } else return undefined;
  if (
    typeof value['requestId'] !== 'string'
    || !PROFILE_IDS.includes(value['profileId'] as ProfileId)
  ) return undefined;
  return Object.freeze({
    requestId: value['requestId'],
    profileId: value['profileId'] as ProfileId,
    status,
    ...(status === 'ineligible' ? { reason: value['reason'] as EligibilityReason } : {}),
  });
}

function validateEligibilityShape(value: unknown): EligibilityArtifact | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'eligibilityId', 'inputBinding', 'schedule', 'classification', 'cells',
  ])) return undefined;
  if (
    value['schemaVersion'] !== 'routelab.numerical-historical-eligibility.v1'
    || value['eligibilityId'] !== ELIGIBILITY_ID
    || !isRecord(value['inputBinding'])
    || !isRecord(value['schedule'])
    || !isRecord(value['classification'])
    || !Array.isArray(value['cells'])
    || value['cells'].length !== 2_376
  ) return undefined;
  const classification = value['classification'];
  if (
    classification['maxHops'] !== 2
    || classification['maxRoutes'] !== 2
    || !isDeepStrictEqual(classification['reasonPrecedence'], REASONS)
    || !isDeepStrictEqual(value['schedule']['profileOrder'], PROFILE_IDS)
  ) return undefined;
  const cells: EligibilityCell[] = [];
  for (const raw of value['cells']) {
    const cell = parseEligibilityCell(raw);
    if (cell === undefined) return undefined;
    cells.push(cell);
  }
  return Object.freeze({ value, cells: Object.freeze(cells) });
}

async function readEligibility(
  dependencies: HistoricalNumericalSplitEvaluationReadDependencies,
  expected: ArtifactDescriptor,
): Promise<
  | { readonly ok: true; readonly value: EligibilityArtifact }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError }
> {
  const bytes = await safeRead(dependencies.readFile, CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH);
  if (bytes === undefined) return failure('eligibility-read-failed', 'eligibility.v1.json');
  if (bytes.byteLength !== expected.bytes) return failure('eligibility-size-mismatch', 'eligibility.v1.json');
  if (sha256(bytes) !== expected.sha256) return failure('eligibility-hash-mismatch', 'eligibility.v1.json');
  if (expected.bytes !== ELIGIBILITY_BYTES || expected.sha256 !== ELIGIBILITY_SHA256) {
    return failure('invalid-eligibility-shape', 'eligibility.v1.json');
  }
  const parsed = parseJson(bytes);
  if (parsed === undefined) return failure('invalid-eligibility-json', 'eligibility.v1.json');
  const eligibility = validateEligibilityShape(parsed.value);
  if (eligibility === undefined || parsed.text !== JSON.stringify(parsed.value)) {
    return failure('invalid-eligibility-shape', 'eligibility.v1.json');
  }
  return Object.freeze({ ok: true, value: eligibility });
}

function eligibilityDescriptorFromConfig(config: ComparisonConfig): ArtifactDescriptor | undefined {
  const inputBinding = config.value['inputBinding'];
  if (!isRecord(inputBinding) || !isRecord(inputBinding['eligibility'])) return undefined;
  const value = inputBinding['eligibility'];
  if (
    !hasExactKeys(value, ['path', 'schemaVersion', 'eligibilityId', 'bytes', 'sha256'])
    || value['path'] !== CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH
    || value['schemaVersion'] !== 'routelab.numerical-historical-eligibility.v1'
    || value['eligibilityId'] !== ELIGIBILITY_ID
    || !isSafeNonnegativeInteger(value['bytes'])
    || !isSha256(value['sha256'])
  ) return undefined;
  return Object.freeze({ path: value['path'], bytes: value['bytes'], sha256: value['sha256'] });
}

function parseForcedFailureEvidenceDocument(value: unknown): ForcedFailureEvidence | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'evidenceId', 'decisionClause', 'runtimeRevision', 'source',
    'rule', 'cases', 'limitations',
  ])) return undefined;
  if (
    value['schemaVersion'] !== 'routelab.numerical-forced-failure-evidence.v1'
    || value['evidenceId'] !== FORCED_FAILURE_EVIDENCE_ID
    || value['decisionClause'] !== 'forced-failures-preserve-baseline'
    || value['runtimeRevision'] !== HISTORICAL_NUMERICAL_SPLIT_RUNTIME_REVISION
    || !isDeepStrictEqual(value['source'], FORCED_FAILURE_SOURCE_BINDING)
    || value['rule'] !== 'all-declared-forced-failure-scenarios-retain-an-exact-authorized-baseline'
    || !Array.isArray(value['cases'])
    || value['cases'].length !== FORCED_FAILURE_CASES.length
    || !isDeepStrictEqual(value['limitations'], FORCED_FAILURE_LIMITATIONS)
  ) return undefined;
  const rawCases = value['cases'] as readonly unknown[];
  const cases: ForcedFailureEvidenceCase[] = [];
  for (let index = 0; index < rawCases.length; index += 1) {
    const current = rawCases[index];
    const expected = FORCED_FAILURE_CASES[index];
    if (
      expected === undefined
      || !isRecord(current)
      || !hasExactKeys(current, ['scenario', 'testName', 'outcome'])
      || current['scenario'] !== expected.scenario
      || current['testName'] !== expected.testName
      || current['outcome'] !== 'baseline-preserved'
    ) return undefined;
    cases.push(Object.freeze({
      scenario: expected.scenario,
      testName: expected.testName,
      outcome: current['outcome'],
    }));
  }
  return Object.freeze({ value, cases: Object.freeze(cases) });
}

/** @internal */
export function validateHistoricalNumericalForcedFailureEvidenceDocument(
  value: unknown,
): boolean {
  return parseForcedFailureEvidenceDocument(value) !== undefined;
}

/** @internal */
export function validateHistoricalNumericalForcedFailureSource(
  sourceText: string,
  requiredTestNames: readonly string[],
  declaredTestCount: number,
): boolean {
  if (
    typeof sourceText !== 'string'
    || !Number.isSafeInteger(declaredTestCount)
    || declaredTestCount <= 0
    || requiredTestNames.length === 0
  ) return false;
  const declaredNames = Array.from(
    sourceText.matchAll(/void test\('([^'\r\n]+)'/gu),
    (match) => match[1],
  );
  if (
    declaredNames.length !== declaredTestCount
    || declaredNames.some((name) => name === undefined)
  ) return false;
  return requiredTestNames.every((name) =>
    declaredNames.filter((declared) => declared === name).length === 1);
}

async function readForcedFailureEvidence(
  dependencies: HistoricalNumericalSplitEvaluationReadDependencies,
  expected: ArtifactDescriptor,
): Promise<
  | { readonly ok: true; readonly value: ForcedFailureEvidence }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError }
> {
  const bytes = await safeRead(
    dependencies.readFile,
    CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
  );
  if (bytes === undefined) {
    return failure('forced-failure-evidence-read-failed', 'forced-failure-evidence.v1.json');
  }
  if (bytes.byteLength !== expected.bytes) {
    return failure('forced-failure-evidence-size-mismatch', 'forced-failure-evidence.v1.json');
  }
  if (sha256(bytes) !== expected.sha256) {
    return failure('forced-failure-evidence-hash-mismatch', 'forced-failure-evidence.v1.json');
  }
  const parsed = parseJson(bytes);
  if (parsed === undefined) {
    return failure('invalid-forced-failure-evidence-json', 'forced-failure-evidence.v1.json');
  }
  const evidence = parseForcedFailureEvidenceDocument(parsed.value);
  if (
    evidence === undefined
    || parsed.text !== JSON.stringify(parsed.value)
    || expected.path !== CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH
    || expected.bytes !== FORCED_FAILURE_EVIDENCE_BYTES
    || expected.sha256 !== FORCED_FAILURE_EVIDENCE_SHA256
  ) return failure('invalid-forced-failure-evidence-shape', 'forced-failure-evidence.v1.json');

  const sourceBytes = await safeRead(dependencies.readFile, FORCED_FAILURE_SOURCE_PATH);
  if (sourceBytes === undefined) {
    return failure('forced-failure-source-read-failed', FORCED_FAILURE_SOURCE_PATH);
  }
  if (sourceBytes.byteLength !== FORCED_FAILURE_SOURCE_BYTES) {
    return failure('forced-failure-source-size-mismatch', FORCED_FAILURE_SOURCE_PATH);
  }
  if (sha256(sourceBytes) !== FORCED_FAILURE_SOURCE_SHA256) {
    return failure('forced-failure-source-hash-mismatch', FORCED_FAILURE_SOURCE_PATH);
  }
  let sourceText: string;
  try {
    sourceText = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  } catch {
    return failure('forced-failure-source-test-mismatch', FORCED_FAILURE_SOURCE_PATH);
  }
  if (!validateHistoricalNumericalForcedFailureSource(
    sourceText,
    evidence.cases.map((current) => current.testName),
    FORCED_FAILURE_SOURCE_TEST_COUNT,
  )) return failure('forced-failure-source-test-mismatch', FORCED_FAILURE_SOURCE_PATH);
  return Object.freeze({ ok: true, value: evidence });
}

function validateBindings(
  config: ComparisonConfig,
  eligibility: EligibilityArtifact,
  verified: VerifiedCorpusBundle,
): void {
  const configBinding = config.value['inputBinding'];
  const eligibilityBinding = eligibility.value['inputBinding'];
  if (!isRecord(configBinding) || !isRecord(eligibilityBinding)) {
    throw new EvaluationAbort('baseline-binding-mismatch', 'input-binding');
  }
  const commonConfigBinding = { ...configBinding };
  delete commonConfigBinding['eligibility'];
  if (
    !isDeepStrictEqual(commonConfigBinding, eligibilityBinding)
    || configBinding['datasetId'] !== DATASET_ID
    || configBinding['snapshotChecksum'] !== SNAPSHOT_CHECKSUM
    || configBinding['corpusId'] !== CORPUS_ID
    || configBinding['corpusSha256'] !== CORPUS_SHA256
    || configBinding['baselineSemanticResultsSha256'] !== BASELINE_SEMANTIC_SHA256
    || verified.corpus.datasetId !== DATASET_ID
    || verified.corpus.corpusId !== CORPUS_ID
    || verified.corpus.snapshotChecksum !== SNAPSHOT_CHECKSUM
  ) throw new EvaluationAbort('baseline-binding-mismatch', 'input-binding');
  for (let index = 0; index < eligibility.cells.length; index += 1) {
    const cell = eligibility.cells[index];
    const request = verified.corpus.requests[Math.floor(index / PROFILE_IDS.length)];
    const profileId = PROFILE_IDS[index % PROFILE_IDS.length];
    if (cell === undefined || request === undefined || profileId === undefined
      || cell.requestId !== request.requestId || cell.profileId !== profileId) {
      throw new EvaluationAbort('invalid-eligibility-shape', 'eligibility-schedule');
    }
  }
}

function projectNumericalCounters(counters: NumericalExactInputSplitWorkCounters): object {
  return {
    ...projectCanonicalSplitRouterWorkCounters(counters),
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections: counters.numericalAuthorizationReplayRejections,
  };
}

function projectDiagnostic(diagnostic: NumericalExactInputSplitDiagnostic): object {
  return {
    candidateSetKey: diagnostic.candidateSetKey,
    routeKeys: diagnostic.routeKeys,
    status: diagnostic.status,
    failureCode: diagnostic.failureCode,
    converged: diagnostic.converged,
    completedOuterIterations: diagnostic.completedOuterIterations,
    configuredInnerIterations: diagnostic.configuredInnerIterations,
    residualUnits: diagnostic.residualUnits === null ? null : diagnostic.residualUnits.toString(10),
    counters: {
      numericalProposals: diagnostic.counters.numericalProposals,
      numericalProposalFailures: diagnostic.counters.numericalProposalFailures,
      numericalIterations: diagnostic.counters.numericalIterations,
      numericalResidualReplays: diagnostic.counters.numericalResidualReplays,
      numericalResidualReplayRejections: diagnostic.counters.numericalResidualReplayRejections,
      numericalAuthorizationReplays: diagnostic.counters.numericalAuthorizationReplays,
      numericalAuthorizationReplayRejections:
        diagnostic.counters.numericalAuthorizationReplayRejections,
    },
  };
}

function projectNumericalResult(
  result: Extract<NumericalExactInputSplitRuntimeResult, { readonly status: 'success' }>,
): object {
  const baselineProjection = projectCanonicalSplitRouterResult(result);
  const baselinePlan = (baselineProjection as { readonly plan: JsonRecord }).plan;
  return {
    status: 'success',
    plan: {
      receipt: baselinePlan['receipt'],
      search: {
        counters: projectNumericalCounters(result.plan.search.counters),
        termination: result.plan.search.termination,
        numericalDiagnostics: result.plan.search.numericalDiagnostics.map(projectDiagnostic),
      },
    },
  };
}

function objectiveOf(result: CanonicalSplitRouterRuntimeResult): object {
  if (result.status !== 'success') return { status: 'no-authorized-incumbent', tuple: null };
  const receipt = result.plan.receipt;
  return {
    status: 'authorized',
    tuple: {
      amountOut: receipt.amountOut.toString(10),
      legCount: receipt.legs.length,
      totalHops: receipt.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0),
      routeSequence: receipt.legs.map((leg) => leg.receipt.hops.map((hop) => ({
        assetIn: hop.assetIn,
        poolId: hop.poolId,
        assetOut: hop.assetOut,
      }))),
      allocations: receipt.legs.map((leg) => leg.allocation.toString(10)),
    },
  };
}

function objectiveRelation(
  numerical: Extract<NumericalExactInputSplitRuntimeResult, { readonly status: 'success' }>,
  baseline: Extract<CanonicalSplitRouterRuntimeResult, { readonly status: 'success' }>,
): ObjectiveRelation {
  if (isStrictlyBetterSplitReceipt(numerical.plan.receipt, baseline.plan.receipt)) {
    return 'strictly-improved';
  }
  if (isStrictlyBetterSplitReceipt(baseline.plan.receipt, numerical.plan.receipt)) {
    return 'regressed';
  }
  return 'equal';
}

function validateBaselinePrefix(
  numerical: Extract<NumericalExactInputSplitRuntimeResult, { readonly status: 'success' }>,
  baseline: Extract<CanonicalSplitRouterRuntimeResult, { readonly status: 'success' }>,
  artifact: string,
): void {
  for (const field of BASE_COUNTER_FIELDS) {
    if (numerical.plan.search.counters[field] !== baseline.plan.search.counters[field]) {
      throw new EvaluationAbort('baseline-prefix-mismatch', artifact);
    }
  }
  if (isStrictlyBetterSplitReceipt(baseline.plan.receipt, numerical.plan.receipt)) {
    throw new EvaluationAbort('baseline-prefix-mismatch', artifact);
  }
}

function zeroCounters(): Record<(typeof COUNTER_FIELDS)[number], number> {
  return Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])) as Record<
    (typeof COUNTER_FIELDS)[number], number
  >;
}

function addCounters(
  totals: Record<(typeof COUNTER_FIELDS)[number], number>,
  maxima: Record<(typeof COUNTER_FIELDS)[number], number>,
  counters: NumericalExactInputSplitWorkCounters,
): void {
  for (const field of COUNTER_FIELDS) {
    const total = totals[field] + counters[field];
    if (!Number.isSafeInteger(total)) throw new EvaluationAbort('runtime-result-invalid', field);
    totals[field] = total;
    maxima[field] = Math.max(maxima[field], counters[field]);
  }
}

function diagnosticsAreTerminal(
  result: Extract<NumericalExactInputSplitRuntimeResult, { readonly status: 'success' }>,
): boolean {
  const diagnostics = result.plan.search.numericalDiagnostics;
  return result.plan.search.termination === 'complete'
    && diagnostics.length > 0
    && diagnostics.every((diagnostic) => {
      if (diagnostic.status === 'stopped') return false;
      if (diagnostic.status === 'failed') return diagnostic.failureCode !== null;
      return diagnostic.failureCode === null;
    });
}

function requestProjection(intent: SyntheticExactInputRequest): object {
  return {
    requestId: intent.requestId,
    amountBucket: intent.amountBucket,
    topology: intent.topology,
    assetIn: intent.assetIn,
    assetOut: intent.assetOut,
    amountIn: intent.amountIn.toString(10),
  };
}

function descriptor(relativePath: string, json: string): ArtifactDescriptor {
  return Object.freeze({ path: relativePath, bytes: byteLength(json), sha256: sha256(json) });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as JsonRecord)) deepFreeze(nested);
  return Object.freeze(value);
}

/** @internal */
export function deriveHistoricalNumericalSplitDecision(
  noEligibleObjectiveRegressions: boolean,
  forcedFailureOutcomes: readonly ForcedFailureOutcome[],
  allEligibleCandidateSetsHaveTerminalDiagnostics: boolean,
  atLeastOneEligibleRequestStrictlyImprovesExactOutput: boolean,
): HistoricalNumericalSplitEvaluationSummary['decision'] {
  const clauses: HistoricalNumericalSplitDecisionClauses = Object.freeze({
    noEligibleObjectiveRegressions,
    forcedFailuresPreserveBaseline:
      forcedFailureOutcomes.length === FORCED_FAILURE_CASES.length
      && forcedFailureOutcomes.every((outcome) => outcome === 'baseline-preserved'),
    allEligibleCandidateSetsHaveTerminalDiagnostics,
    atLeastOneEligibleRequestStrictlyImprovesExactOutput,
  });
  return Object.freeze({
    mode: Object.values(clauses).every((value) => value) ? 'primary' : 'experimental',
    clauses,
  });
}

function buildSemantic(
  verified: VerifiedCorpusBundle,
  config: ComparisonConfig,
  eligibility: EligibilityArtifact,
  forcedFailureEvidence: ForcedFailureEvidence,
  baselineCells: readonly Readonly<JsonRecord>[],
  baselineResults: readonly CanonicalSplitRouterRuntimeResult[],
): SemanticBuild {
  if (baselineCells.length !== 2_376 || baselineResults.length !== 2_376) {
    throw new EvaluationAbort('baseline-binding-mismatch', 'baseline-schedule');
  }
  const cells: JsonRecord[] = [];
  const relations: Record<ObjectiveRelation, number> = {
    'strictly-improved': 0,
    equal: 0,
    regressed: 0,
  };
  const reasons = Object.fromEntries(REASONS.map((reason) => [reason, 0])) as Record<EligibilityReason, number>;
  const diagnosticStatuses: Record<string, number> = {};
  const diagnosticFailureCodes: Record<string, number> = {};
  const totals = zeroCounters();
  const maxima = zeroCounters();
  const improvedRequests = new Set<string>();
  let eligibleCount = 0;
  let terminalDiagnostics = true;

  for (let index = 0; index < eligibility.cells.length; index += 1) {
    const eligibilityCell = eligibility.cells[index];
    const request = verified.corpus.requests[Math.floor(index / PROFILE_IDS.length)];
    const profile = config.profiles[index % PROFILE_IDS.length];
    const baselineCell = baselineCells[index];
    const baselineResult = baselineResults[index];
    if (
      eligibilityCell === undefined || request === undefined || profile === undefined
      || baselineCell === undefined || baselineResult === undefined
      || baselineCell['requestId'] !== request.requestId
      || baselineCell['profileId'] !== profile.profileId
      || typeof baselineCell['semanticHash'] !== 'string'
    ) throw new EvaluationAbort('baseline-binding-mismatch', 'baseline-schedule');

    const common = {
      request: requestProjection(request),
      profile: { profileId: profile.profileId, workCaps: profile.workCaps },
      numericalConfiguration: NUMERICAL_CONFIGURATION,
      baseline: {
        evaluationId: 'm6-core12-synthetic-exhaustive-composed-two-hop-pair-evaluation-v3',
        semanticHash: baselineCell['semanticHash'],
        objective: objectiveOf(baselineResult),
      },
      eligibility: eligibilityCell.status === 'eligible'
        ? { status: 'eligible' }
        : { status: 'ineligible', reason: eligibilityCell.reason },
    };

    if (eligibilityCell.status === 'ineligible') {
      if (eligibilityCell.reason === undefined) {
        throw new EvaluationAbort('invalid-eligibility-shape', 'eligibility-cell');
      }
      reasons[eligibilityCell.reason] += 1;
      const hashValue = {
        schemaVersion: 'routelab.numerical-historical-semantic-cell.v1',
        inputBinding: {
          snapshotChecksum: SNAPSHOT_CHECKSUM,
          corpusSha256: CORPUS_SHA256,
          comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
          eligibilitySha256: ELIGIBILITY_SHA256,
          forcedFailureEvidence: FORCED_FAILURE_EVIDENCE_BINDING,
          baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
        },
        ...common,
        objectiveRelation: 'not-evaluated',
      };
      cells.push({
        ...common,
        objectiveRelation: 'not-evaluated',
        semanticHash: sha256(JSON.stringify(hashValue)),
      });
      continue;
    }

    eligibleCount += 1;
    if (baselineResult.status !== 'success') {
      throw new EvaluationAbort('baseline-binding-mismatch', `${request.requestId}/${profile.profileId}`);
    }
    const result = routeExactInputSplitNumericalAnytime(
      verified.context,
      Object.freeze({
        snapshotId: DATASET_ID,
        snapshotChecksum: SNAPSHOT_CHECKSUM,
        assetIn: request.assetIn,
        assetOut: request.assetOut,
        amountIn: request.amountIn,
        maxHops: 2,
        maxRoutes: 2,
        greedyParts: 16,
        numerical: NUMERICAL_CONFIGURATION,
      }),
      Object.freeze({ workCaps: profile.workCaps }),
    );
    if (result.status !== 'success') {
      throw new EvaluationAbort('runtime-result-invalid', `${request.requestId}/${profile.profileId}`);
    }
    validateBaselinePrefix(result, baselineResult, `${request.requestId}/${profile.profileId}`);
    const relation = objectiveRelation(result, baselineResult);
    relations[relation] += 1;
    if (result.plan.receipt.amountOut > baselineResult.plan.receipt.amountOut) {
      improvedRequests.add(request.requestId);
    }
    addCounters(totals, maxima, result.plan.search.counters);
    terminalDiagnostics &&= diagnosticsAreTerminal(result);
    for (const diagnostic of result.plan.search.numericalDiagnostics) {
      diagnosticStatuses[diagnostic.status] = (diagnosticStatuses[diagnostic.status] ?? 0) + 1;
      if (diagnostic.failureCode !== null) {
        diagnosticFailureCodes[diagnostic.failureCode] =
          (diagnosticFailureCodes[diagnostic.failureCode] ?? 0) + 1;
      }
    }
    const projectedResult = projectNumericalResult(result);
    const hashValue = {
      schemaVersion: 'routelab.numerical-historical-semantic-cell.v1',
      inputBinding: {
        snapshotChecksum: SNAPSHOT_CHECKSUM,
        corpusSha256: CORPUS_SHA256,
        comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
        eligibilitySha256: ELIGIBILITY_SHA256,
        forcedFailureEvidence: FORCED_FAILURE_EVIDENCE_BINDING,
        baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
      },
      ...common,
      objectiveRelation: relation,
      result: projectedResult,
    };
    cells.push({
      ...common,
      objectiveRelation: relation,
      semanticHash: sha256(JSON.stringify(hashValue)),
      result: projectedResult,
    });
  }

  const decision = deriveHistoricalNumericalSplitDecision(
    relations.regressed === 0,
    forcedFailureEvidence.cases.map((current) => current.outcome),
    terminalDiagnostics,
    improvedRequests.size > 0,
  );
  const semanticSummary = {
    eligibility: {
      eligible: eligibleCount,
      ineligible: eligibility.cells.length - eligibleCount,
      reasons,
    },
    objectiveRelations: relations,
    diagnostics: { statuses: diagnosticStatuses, failureCodes: diagnosticFailureCodes },
    work: { counterTotals: totals, counterMaxima: maxima },
    strictlyImprovedRequestCount: improvedRequests.size,
    decision,
  };
  const document = {
    schemaVersion: 'routelab.numerical-historical-semantic-results.v1',
    evaluationId: HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID,
    inputBinding: {
      datasetId: DATASET_ID,
      snapshotId: DATASET_ID,
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      corpusId: CORPUS_ID,
      corpusSha256: CORPUS_SHA256,
      comparisonConfigId: COMPARISON_CONFIG_ID,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
      eligibilityId: ELIGIBILITY_ID,
      eligibilitySha256: ELIGIBILITY_SHA256,
      forcedFailureEvidence: FORCED_FAILURE_EVIDENCE_BINDING,
      baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
    },
    schedule: {
      semanticOrder: 'corpus-request-then-declared-profile',
      requestCount: verified.corpus.requests.length,
      profileCount: PROFILE_IDS.length,
      cellCount: cells.length,
      profileOrder: PROFILE_IDS,
    },
    cells,
    summary: semanticSummary,
    limitations: LIMITATIONS,
  };
  const json = JSON.stringify(document);
  const summary: HistoricalNumericalSplitEvaluationSummary = deepFreeze({
    schemaVersion: 'routelab.numerical-historical-evaluation-summary.v1',
    evaluationId: HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID,
    comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
    eligibilitySha256: ELIGIBILITY_SHA256,
    baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
    semanticResultsSha256: sha256(json),
    requestCount: verified.corpus.requests.length,
    profileCount: PROFILE_IDS.length,
    cellCount: cells.length,
    eligibleCellCount: eligibleCount,
    ineligibleCellCount: cells.length - eligibleCount,
    objectiveRelations: relations,
    ineligibleReasons: reasons,
    diagnosticStatuses,
    diagnosticFailureCodes,
    counterTotals: totals,
    counterMaxima: maxima,
    strictlyImprovedRequestCount: improvedRequests.size,
    decision,
  });
  return Object.freeze({ json, document, summary });
}

function buildManifest(semantic: ArtifactDescriptor, summary: HistoricalNumericalSplitEvaluationSummary): JsonRecord {
  return {
    schemaVersion: 'routelab.numerical-historical-evaluation-manifest.v1',
    evaluationId: HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID,
    inputBinding: {
      datasetId: DATASET_ID,
      snapshotId: DATASET_ID,
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      corpusId: CORPUS_ID,
      corpusSha256: CORPUS_SHA256,
      forcedFailureEvidence: FORCED_FAILURE_EVIDENCE_BINDING,
      baselineSemanticResultsSha256: BASELINE_SEMANTIC_SHA256,
    },
    runtime: {
      entryPoint: 'routeExactInputSplitNumericalAnytime',
      implementationRevision: HISTORICAL_NUMERICAL_SPLIT_RUNTIME_REVISION,
    },
    artifacts: {
      comparisonConfig: {
        path: CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
        bytes: COMPARISON_CONFIG_BYTES,
        sha256: COMPARISON_CONFIG_SHA256,
      },
      eligibility: {
        path: CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH,
        bytes: ELIGIBILITY_BYTES,
        sha256: ELIGIBILITY_SHA256,
      },
      forcedFailureEvidence: {
        path: CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
        bytes: FORCED_FAILURE_EVIDENCE_BYTES,
        sha256: FORCED_FAILURE_EVIDENCE_SHA256,
      },
      semanticResults: semantic,
    },
    counts: {
      requestCount: summary.requestCount,
      profileCount: summary.profileCount,
      cellCount: summary.cellCount,
      eligibleCellCount: summary.eligibleCellCount,
      ineligibleCellCount: summary.ineligibleCellCount,
    },
    decision: summary.decision,
    limitations: LIMITATIONS,
  };
}

async function prepareInputs(
  dependencies: HistoricalNumericalSplitEvaluationReadDependencies,
  configDescriptor: ArtifactDescriptor,
  eligibilityDescriptor?: ArtifactDescriptor,
  forcedFailureEvidenceDescriptor?: ArtifactDescriptor,
): Promise<
  | {
      readonly ok: true;
      readonly value: {
        readonly verified: VerifiedCorpusBundle;
        readonly config: ComparisonConfig;
        readonly eligibility: EligibilityArtifact;
        readonly forcedFailureEvidence: ForcedFailureEvidence;
        readonly baselineCells: readonly Readonly<JsonRecord>[];
        readonly baselineResults: readonly CanonicalSplitRouterRuntimeResult[];
      };
    }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError }
> {
  const config = await readComparisonConfig(dependencies, configDescriptor);
  if (!config.ok) return config;
  const declaredEligibility = eligibilityDescriptor ?? eligibilityDescriptorFromConfig(config.value);
  if (declaredEligibility === undefined) return failure('invalid-config-shape', 'comparison-config.v1.json');
  const eligibility = await readEligibility(dependencies, declaredEligibility);
  if (!eligibility.ok) return eligibility;
  const forcedFailureEvidence = await readForcedFailureEvidence(
    dependencies,
    forcedFailureEvidenceDescriptor ?? {
      path: CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
      bytes: FORCED_FAILURE_EVIDENCE_BYTES,
      sha256: FORCED_FAILURE_EVIDENCE_SHA256,
    },
  );
  if (!forcedFailureEvidence.ok) return forcedFailureEvidence;
  const verified = await verifySyntheticRequestCorpus(
    CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
    { readFile: dependencies.readFile },
  );
  if (!verified.ok) return failure('corpus-invalid', `corpus/${verified.error.artifact}`);
  const baseline = await verifyHistoricalComposedSplitEvaluationWithVerifiedCorpus(
    CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY,
    dependencies,
    verified.value,
  );
  if (!baseline.ok) {
    return failure('baseline-evaluation-invalid', `baseline/${baseline.error.code}/${baseline.error.artifact}`);
  }
  if (baseline.value.summary.semanticResultsSha256 !== BASELINE_SEMANTIC_SHA256) {
    return failure('baseline-binding-mismatch', 'baseline/semantic-results.json');
  }
  try {
    validateBindings(config.value, eligibility.value, verified.value);
  } catch (error) {
    if (error instanceof EvaluationAbort) return failure(error.code, error.artifact);
    return failure('baseline-binding-mismatch', 'input-binding');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      verified: verified.value,
      config: config.value,
      eligibility: eligibility.value,
      forcedFailureEvidence: forcedFailureEvidence.value,
      baselineCells: baseline.value.semanticCells,
      baselineResults: baseline.value.runtimeResults,
    }),
  });
}

export async function createHistoricalNumericalSplitEvaluation(
  sourceDependencies: HistoricalNumericalSplitEvaluationReadDependencies,
): Promise<HistoricalNumericalSplitEvaluationGenerationResult> {
  const dependencies = cachedDependencies(sourceDependencies);
  const prepared = await prepareInputs(dependencies, {
    path: CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
    bytes: COMPARISON_CONFIG_BYTES,
    sha256: COMPARISON_CONFIG_SHA256,
  });
  if (!prepared.ok) return prepared;
  try {
    const semantic = buildSemantic(
      prepared.value.verified,
      prepared.value.config,
      prepared.value.eligibility,
      prepared.value.forcedFailureEvidence,
      prepared.value.baselineCells,
      prepared.value.baselineResults,
    );
    const semanticDescriptor = descriptor('semantic-results.json', semantic.json);
    const manifestJson = JSON.stringify(buildManifest(semanticDescriptor, semantic.summary));
    return Object.freeze({
      ok: true,
      value: deepFreeze({
        manifestJson,
        semanticResultsJson: semantic.json,
        summary: semantic.summary,
      }),
    });
  } catch (error) {
    if (error instanceof EvaluationAbort) return failure(error.code, error.artifact);
    return failure('runtime-result-invalid', 'evaluation');
  }
}

function parseDescriptor(value: unknown, expectedPath: string): ArtifactDescriptor | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['path', 'bytes', 'sha256'])) return undefined;
  if (
    value['path'] !== expectedPath
    || !isSafeNonnegativeInteger(value['bytes'])
    || !isSha256(value['sha256'])
  ) return undefined;
  return Object.freeze({ path: value['path'], bytes: value['bytes'], sha256: value['sha256'] });
}

function parseManifest(value: unknown): {
  readonly value: JsonRecord;
  readonly config: ArtifactDescriptor;
  readonly eligibility: ArtifactDescriptor;
  readonly forcedFailureEvidence: ArtifactDescriptor;
  readonly semantic: ArtifactDescriptor;
} | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'evaluationId', 'inputBinding', 'runtime', 'artifacts', 'counts',
    'decision', 'limitations',
  ]) || !isRecord(value['artifacts']) || !hasExactKeys(value['artifacts'], [
    'comparisonConfig', 'eligibility', 'forcedFailureEvidence', 'semanticResults',
  ])) return undefined;
  const config = parseDescriptor(
    value['artifacts']['comparisonConfig'],
    CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
  );
  const eligibility = parseDescriptor(
    value['artifacts']['eligibility'],
    CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH,
  );
  const forcedFailureEvidence = parseDescriptor(
    value['artifacts']['forcedFailureEvidence'],
    CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
  );
  const semantic = parseDescriptor(value['artifacts']['semanticResults'], 'semantic-results.json');
  if (
    config === undefined || eligibility === undefined || forcedFailureEvidence === undefined
    || semantic === undefined
    || value['schemaVersion'] !== 'routelab.numerical-historical-evaluation-manifest.v1'
    || value['evaluationId'] !== HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID
    || !isRecord(value['runtime'])
    || value['runtime']['entryPoint'] !== 'routeExactInputSplitNumericalAnytime'
    || value['runtime']['implementationRevision'] !== HISTORICAL_NUMERICAL_SPLIT_RUNTIME_REVISION
  ) return undefined;
  return Object.freeze({ value, config, eligibility, forcedFailureEvidence, semantic });
}

async function readSemanticArtifact(
  directory: string,
  dependencies: HistoricalNumericalSplitEvaluationReadDependencies,
  artifact: ArtifactDescriptor,
): Promise<
  | { readonly ok: true; readonly value: { readonly text: string; readonly parsed: unknown } }
  | { readonly ok: false; readonly error: HistoricalNumericalSplitEvaluationError }
> {
  const bytes = await safeRead(dependencies.readFile, path.join(directory, artifact.path));
  if (bytes === undefined) return failure('semantic-results-read-failed', artifact.path);
  if (bytes.byteLength !== artifact.bytes) return failure('semantic-results-size-mismatch', artifact.path);
  if (sha256(bytes) !== artifact.sha256) return failure('semantic-results-hash-mismatch', artifact.path);
  const parsed = parseJson(bytes);
  if (parsed === undefined) return failure('invalid-semantic-results-json', artifact.path);
  if (!isRecord(parsed.value) || !hasExactKeys(parsed.value, [
    'schemaVersion', 'evaluationId', 'inputBinding', 'schedule', 'cells', 'summary', 'limitations',
  ]) || parsed.value['schemaVersion'] !== 'routelab.numerical-historical-semantic-results.v1'
    || !Array.isArray(parsed.value['cells']) || parsed.value['cells'].length !== 2_376) {
    return failure('invalid-semantic-results-shape', artifact.path);
  }
  return Object.freeze({ ok: true, value: Object.freeze({ text: parsed.text, parsed: parsed.value }) });
}

export async function verifyHistoricalNumericalSplitEvaluation(
  directory: string,
  sourceDependencies: HistoricalNumericalSplitEvaluationReadDependencies,
): Promise<HistoricalNumericalSplitEvaluationVerificationResult> {
  const dependencies = cachedDependencies(sourceDependencies);
  const manifestBytes = await safeRead(dependencies.readFile, path.join(directory, 'manifest.json'));
  if (manifestBytes === undefined) return failure('manifest-read-failed', 'manifest.json');
  const manifestJson = parseJson(manifestBytes);
  if (manifestJson === undefined) return failure('invalid-manifest-json', 'manifest.json');
  const manifest = parseManifest(manifestJson.value);
  if (manifest === undefined) return failure('invalid-manifest-shape', 'manifest.json');

  const prepared = await prepareInputs(
    dependencies,
    manifest.config,
    manifest.eligibility,
    manifest.forcedFailureEvidence,
  );
  if (!prepared.ok) return prepared;
  const semanticArtifact = await readSemanticArtifact(directory, dependencies, manifest.semantic);
  if (!semanticArtifact.ok) return semanticArtifact;

  let semantic: SemanticBuild;
  try {
    semantic = buildSemantic(
      prepared.value.verified,
      prepared.value.config,
      prepared.value.eligibility,
      prepared.value.forcedFailureEvidence,
      prepared.value.baselineCells,
      prepared.value.baselineResults,
    );
  } catch (error) {
    if (error instanceof EvaluationAbort) return failure(error.code, error.artifact);
    return failure('semantic-replay-mismatch', 'semantic-results.json');
  }
  if (semanticArtifact.value.text !== semantic.json) {
    return failure('semantic-replay-mismatch', 'semantic-results.json');
  }
  const expectedManifest = buildManifest(
    descriptor('semantic-results.json', semanticArtifact.value.text),
    semantic.summary,
  );
  if (
    !isDeepStrictEqual(manifest.value, expectedManifest)
    || manifestJson.text !== JSON.stringify(expectedManifest)
  ) return failure('manifest-metadata-mismatch', 'manifest.json');
  return Object.freeze({ ok: true, value: semantic.summary });
}
