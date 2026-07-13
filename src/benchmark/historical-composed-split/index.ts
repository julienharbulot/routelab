import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeRequest,
  type ExactInputSplitWorkCaps,
  type ExactInputSplitWorkCounters,
} from '../../router/anytime-exact-input-split/index.ts';
import { isStrictlyBetterSplitReceipt } from '../../router/split-exact-input/objective.ts';
import {
  projectCanonicalSplitRouterResult,
  type CanonicalSplitRouterRuntimeResult,
} from '../../serialization/canonical-split-router-result/index.ts';
import {
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  verifySyntheticRequestCorpus,
  type SyntheticExactInputRequest,
  type SyntheticRequestCorpusVerificationResult,
} from '../../verification/synthetic-request-corpus/index.ts';

export const CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH =
  'fixtures/m6/composed-historical/comparison-config.v3.json';

export const CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH =
  'fixtures/m6/composed-historical/observation-config.v2.json';

export const CANONICAL_HISTORICAL_COMPOSED_SPLIT_EVALUATION_DIRECTORY =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/composed-two-hop-pair-v3';

export const HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID =
  'm6-core12-synthetic-exhaustive-composed-two-hop-pair-evaluation-v3';

export const HISTORICAL_COMPOSED_SPLIT_RUNTIME_REVISION =
  'f98dddbd748c08594c7f0de0e9b457fe69417dd5';

const COMPARISON_CONFIG_BYTES = 2_528;
const COMPARISON_CONFIG_SHA256 =
  'sha256:4e4d1bdfe47016d23510adbc4ed8107854b5bbf0dec99f3fb88d920d7a403473';
const OBSERVATION_CONFIG_BYTES = 1_060;
const OBSERVATION_CONFIG_SHA256 =
  'sha256:6e1c5e315efd532f25f8c0fa601d29889452f1324978f7ce507b4c992ddb6d84';
const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const SNAPSHOT_CHECKSUM =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const CORPUS_SHA256 =
  'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173';
const COMPARISON_CONFIG_ID =
  'm6-core12-synthetic-exhaustive-composed-two-hop-pair-v3';
const OBSERVATION_CONFIG_ID =
  'm6-core12-synthetic-exhaustive-composed-two-hop-pair-observation-v2';

const PROFILE_IDS = Object.freeze([
  'fraction-0',
  'fraction-1-16',
  'fraction-1-8',
  'fraction-1-4',
  'fraction-1-2',
  'structural-complete',
] as const);

const COUNTER_FIELDS = Object.freeze([
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

const SEMANTIC_LIMITATIONS = Object.freeze([
  'One frozen block, venue, 12-asset allowlist, and synthetic exhaustive request grid only.',
  'maxHops 2, maxRoutes 2, greedyParts 16, pool-disjoint routes, and six typed cap vectors bound the evaluated policy space.',
  'Typed work kinds remain separate; profile fractions do not introduce a universal work scalar or equal-cost assumption.',
  'The structural-complete profile is complete only for this corpus and bounded runtime configuration; it is not a global optimum.',
  'No transaction submission, custody, token-transfer feasibility, live execution, or production claim is made.',
]);

const OBSERVATION_LIMITATIONS = Object.freeze([
  'Latency values are raw operational observations from one environment with no threshold, speedup, scaling, tail, percentile, or statistical conclusion.',
  'No base/head algorithm comparison is made; any later comparison must reuse the exact snapshot, corpus, comparison-config, and observation-config hashes.',
]);

const MANIFEST_LIMITATIONS = Object.freeze([
  ...SEMANTIC_LIMITATIONS,
  ...OBSERVATION_LIMITATIONS,
]);

interface Profile {
  readonly profileId: (typeof PROFILE_IDS)[number];
  readonly workCaps: ExactInputSplitWorkCaps;
}

const PROFILES: readonly Profile[] = Object.freeze([
  profile('fraction-0', [0, 0, 0, 0, 0, 0]),
  profile('fraction-1-16', [8, 1, 7, 4, 110, 7]),
  profile('fraction-1-8', [16, 2, 14, 7, 220, 14]),
  profile('fraction-1-4', [31, 3, 28, 14, 440, 28]),
  profile('fraction-1-2', [61, 6, 55, 28, 880, 55]),
  profile('structural-complete', [121, 11, 110, 55, 1_760, 110]),
]);

const EXPECTED_INPUT_BINDING = Object.freeze({
  datasetId: DATASET_ID,
  snapshotId: DATASET_ID,
  snapshotChecksum: SNAPSHOT_CHECKSUM,
  corpusId: CORPUS_ID,
  corpusSha256: CORPUS_SHA256,
});

const EXPECTED_COMPARISON_CONFIG = Object.freeze({
  schemaVersion: 'routelab.composed-historical-comparison-config.v3',
  comparisonConfigId: COMPARISON_CONFIG_ID,
  inputBinding: EXPECTED_INPUT_BINDING,
  runtime: Object.freeze({
    entryPoint: 'routeExactInputSplitAnytime',
    preparedContext: 'one-verified-context-shared-across-all-runs',
    request: Object.freeze({ maxHops: 2, maxRoutes: 2, greedyParts: 16 }),
    controlMode: 'deterministic-work-caps-only-no-interruption-no-deadline',
  }),
  schedule: Object.freeze({
    semanticOrder: 'corpus-request-then-declared-profile',
    profileOrder: PROFILE_IDS,
  }),
  profiles: PROFILES,
  comparison: Object.freeze({
    kind: 'componentwise-cap-profile-progression',
    referenceProfileId: 'structural-complete',
    baseHeadInputRule: 'snapshot-corpus-and-comparison-config-hashes-must-match',
  }),
});

const EXPECTED_OBSERVATION_CONFIG = Object.freeze({
  schemaVersion: 'routelab.composed-historical-observation-config.v2',
  observationConfigId: OBSERVATION_CONFIG_ID,
  inputBinding: Object.freeze({
    comparisonConfigId: COMPARISON_CONFIG_ID,
    comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
  }),
  protocol: Object.freeze({
    timingScope: 'routeExactInputSplitAnytime-call-only',
    clock: 'process.hrtime.bigint',
    warmupSweeps: 1,
    sampleSweeps: 5,
    sweepOrder: 'forward-even-reverse-odd',
    serialization: 'outside-timed-region',
    environmentFields: Object.freeze([
      'nodeVersion', 'platform', 'arch', 'osRelease', 'cpuModel', 'logicalCpuCount',
    ]),
    resultCheck: 'deep-equal-established-semantic-result-after-timed-call',
  }),
  limitations: OBSERVATION_LIMITATIONS,
});

export interface HistoricalEvaluationEnvironment {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly osRelease: string;
  readonly cpuModel: string;
  readonly logicalCpuCount: number;
}

export interface HistoricalEvaluationReadDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
}

export interface HistoricalEvaluationGenerationDependencies
  extends HistoricalEvaluationReadDependencies {
  readonly nowNanoseconds: () => bigint;
  readonly environment: HistoricalEvaluationEnvironment;
  readonly runtimeRevision: string;
}

export type HistoricalEvaluationErrorCode =
  | 'manifest-read-failed'
  | 'invalid-manifest-json'
  | 'invalid-manifest-shape'
  | 'config-read-failed'
  | 'config-size-mismatch'
  | 'config-hash-mismatch'
  | 'invalid-config-json'
  | 'invalid-config-shape'
  | 'observation-config-read-failed'
  | 'observation-config-size-mismatch'
  | 'observation-config-hash-mismatch'
  | 'invalid-observation-config-json'
  | 'invalid-observation-config-shape'
  | 'corpus-invalid'
  | 'semantic-results-read-failed'
  | 'semantic-results-size-mismatch'
  | 'semantic-results-hash-mismatch'
  | 'invalid-semantic-results-json'
  | 'invalid-semantic-results-shape'
  | 'observations-read-failed'
  | 'observations-size-mismatch'
  | 'observations-hash-mismatch'
  | 'invalid-observations-json'
  | 'invalid-observations-shape'
  | 'semantic-replay-mismatch'
  | 'observation-schedule-mismatch'
  | 'manifest-metadata-mismatch'
  | 'invalid-runtime-revision'
  | 'invalid-environment'
  | 'clock-failed'
  | 'clock-regressed'
  | 'runtime-result-invalid'
  | 'timed-result-mismatch'
  | 'objective-regression'
  | 'terminal-profile-incomplete';

export interface HistoricalEvaluationError {
  readonly code: HistoricalEvaluationErrorCode;
  readonly artifact: string;
  readonly message: string;
}

export interface HistoricalEvaluationArtifacts {
  readonly manifestJson: string;
  readonly semanticResultsJson: string;
  readonly observationsJson: string;
  readonly summary: HistoricalEvaluationSummary;
}

export interface HistoricalEvaluationSummary {
  readonly schemaVersion: 'routelab.composed-historical-evaluation-summary.v3';
  readonly evaluationId: string;
  readonly comparisonConfigSha256: string;
  readonly observationConfigSha256: string;
  readonly semanticResultsSha256: string;
  readonly observationsSha256: string;
  readonly requestCount: number;
  readonly profileCount: number;
  readonly semanticCellCount: number;
  readonly observationSampleCount: number;
  readonly profileSummaries: readonly unknown[];
  readonly adjacentComparisons: readonly unknown[];
}

export type HistoricalEvaluationGenerationResult =
  | { readonly ok: true; readonly value: HistoricalEvaluationArtifacts }
  | { readonly ok: false; readonly error: HistoricalEvaluationError };

export type HistoricalEvaluationVerificationResult =
  | { readonly ok: true; readonly value: HistoricalEvaluationSummary }
  | { readonly ok: false; readonly error: HistoricalEvaluationError };

type VerifiedSyntheticRequestCorpusBundle = Extract<
  SyntheticRequestCorpusVerificationResult,
  { readonly ok: true }
>['value'];

/** @internal */
export interface PreverifiedHistoricalComposedSplitEvaluation {
  readonly summary: HistoricalEvaluationSummary;
  readonly semanticCells: readonly Readonly<Record<string, unknown>>[];
  readonly runtimeResults: readonly CanonicalSplitRouterRuntimeResult[];
}

/** @internal */
export type PreverifiedHistoricalComposedSplitEvaluationResult =
  | { readonly ok: true; readonly value: PreverifiedHistoricalComposedSplitEvaluation }
  | { readonly ok: false; readonly error: HistoricalEvaluationError };

type JsonRecord = Record<string, unknown>;

interface ArtifactDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface HistoricalEvaluationPreamble {
  readonly manifestJson: { readonly text: string; readonly value: unknown };
  readonly manifest: NonNullable<ReturnType<typeof parseManifest>>;
}

interface SemanticBuild {
  readonly json: string;
  readonly document: JsonRecord;
  readonly cells: readonly JsonRecord[];
  readonly results: readonly CanonicalSplitRouterRuntimeResult[];
}

class EvaluationAbort extends Error {
  readonly code: HistoricalEvaluationErrorCode;
  readonly artifact: string;

  constructor(
    code: HistoricalEvaluationErrorCode,
    artifact: string,
  ) {
    super(code);
    this.code = code;
    this.artifact = artifact;
  }
}

function profile(
  profileId: Profile['profileId'],
  values: readonly [number, number, number, number, number, number],
): Profile {
  return Object.freeze({
    profileId,
    workCaps: Object.freeze({
      maxPathExpansions: values[0],
      maxBestSingleCandidateReplays: values[1],
      maxCandidateSetExpansions: values[2],
      maxEqualProposalReplays: values[3],
      maxGreedyOptionReplays: values[4],
      maxFinalAuthorizationReplays: values[5],
    }),
  });
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function failure(
  code: HistoricalEvaluationErrorCode,
  artifact: string,
): { readonly ok: false; readonly error: HistoricalEvaluationError } {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      artifact,
      message: `Historical composed evaluation failed at ${artifact}.`,
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

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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

async function readComparisonConfig(
  dependencies: HistoricalEvaluationReadDependencies,
  descriptor: ArtifactDescriptor,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: HistoricalEvaluationError }> {
  const bytes = await safeRead(dependencies.readFile, CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH);
  if (bytes === undefined) return failure('config-read-failed', 'comparison-config.v3.json');
  if (bytes.byteLength !== descriptor.bytes) return failure('config-size-mismatch', 'comparison-config.v3.json');
  if (sha256(bytes) !== descriptor.sha256) return failure('config-hash-mismatch', 'comparison-config.v3.json');
  const parsed = parseJson(bytes);
  if (parsed === undefined) return failure('invalid-config-json', 'comparison-config.v3.json');
  if (
    !isDeepStrictEqual(parsed.value, EXPECTED_COMPARISON_CONFIG)
    || parsed.text !== JSON.stringify(EXPECTED_COMPARISON_CONFIG)
  ) return failure('invalid-config-shape', 'comparison-config.v3.json');
  return Object.freeze({ ok: true });
}

async function readObservationConfig(
  dependencies: HistoricalEvaluationReadDependencies,
  descriptor: ArtifactDescriptor,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: HistoricalEvaluationError }> {
  const bytes = await safeRead(dependencies.readFile, CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH);
  if (bytes === undefined) return failure('observation-config-read-failed', 'observation-config.v2.json');
  if (bytes.byteLength !== descriptor.bytes) {
    return failure('observation-config-size-mismatch', 'observation-config.v2.json');
  }
  if (sha256(bytes) !== descriptor.sha256) {
    return failure('observation-config-hash-mismatch', 'observation-config.v2.json');
  }
  const parsed = parseJson(bytes);
  if (parsed === undefined) {
    return failure('invalid-observation-config-json', 'observation-config.v2.json');
  }
  if (
    !isDeepStrictEqual(parsed.value, EXPECTED_OBSERVATION_CONFIG)
    || parsed.text !== JSON.stringify(EXPECTED_OBSERVATION_CONFIG)
  ) return failure('invalid-observation-config-shape', 'observation-config.v2.json');
  return Object.freeze({ ok: true });
}

function runtimeRequest(intent: SyntheticExactInputRequest): ExactInputSplitRuntimeRequest {
  return Object.freeze({
    snapshotId: DATASET_ID,
    snapshotChecksum: SNAPSHOT_CHECKSUM,
    assetIn: intent.assetIn,
    assetOut: intent.assetOut,
    amountIn: intent.amountIn,
    maxHops: 2,
    maxRoutes: 2,
    greedyParts: 16,
  });
}

function invokeCell(
  context: Parameters<typeof routeExactInputSplitAnytime>[0],
  request: ExactInputSplitRuntimeRequest,
  currentProfile: Profile,
  nowNanoseconds?: () => bigint,
): {
  readonly result: ReturnType<typeof routeExactInputSplitAnytime>;
  readonly elapsedNanoseconds: bigint;
} {
  const control = { workCaps: currentProfile.workCaps };
  const startedAt = nowNanoseconds === undefined ? 0n : sampleClock(nowNanoseconds);
  const result = routeExactInputSplitAnytime(
    context,
    request,
    control,
  );
  const finishedAt = nowNanoseconds === undefined ? 0n : sampleClock(nowNanoseconds);
  if (finishedAt < startedAt) throw new EvaluationAbort('clock-regressed', 'clock');
  return Object.freeze({ result, elapsedNanoseconds: finishedAt - startedAt });
}

function validateCellResult(
  result: ReturnType<typeof routeExactInputSplitAnytime>,
  artifact: string,
): asserts result is CanonicalSplitRouterRuntimeResult {
  if (
    result.status !== 'success'
    && result.status !== 'no-route'
    && result.status !== 'no-plan'
  ) throw new EvaluationAbort('runtime-result-invalid', artifact);
  const termination = result.status === 'success'
    ? result.plan.search.termination
    : result.search.termination;
  if (termination !== 'complete' && termination !== 'work-limit') {
    throw new EvaluationAbort('runtime-result-invalid', artifact);
  }
}

function runCell(
  context: Parameters<typeof routeExactInputSplitAnytime>[0],
  intent: SyntheticExactInputRequest,
  currentProfile: Profile,
): CanonicalSplitRouterRuntimeResult {
  const { result } = invokeCell(context, runtimeRequest(intent), currentProfile);
  validateCellResult(result, `${intent.requestId}/${currentProfile.profileId}`);
  return result;
}

function searchOf(result: CanonicalSplitRouterRuntimeResult) {
  return result.status === 'success' ? result.plan.search : result.search;
}

function zeroCounterRecord(): Record<(typeof COUNTER_FIELDS)[number], number> {
  return Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])) as Record<
    (typeof COUNTER_FIELDS)[number],
    number
  >;
}

function addCounters(
  totals: Record<(typeof COUNTER_FIELDS)[number], number>,
  maxima: Record<(typeof COUNTER_FIELDS)[number], number>,
  counters: ExactInputSplitWorkCounters,
): void {
  for (const field of COUNTER_FIELDS) {
    const total = totals[field] + counters[field];
    if (!Number.isSafeInteger(total)) {
      throw new EvaluationAbort('runtime-result-invalid', `counter.${field}`);
    }
    totals[field] = total;
    maxima[field] = Math.max(maxima[field], counters[field]);
  }
}

function cellHashValue(
  intent: SyntheticExactInputRequest,
  currentProfile: Profile,
  projectedResult: object,
): object {
  return {
    schemaVersion: 'routelab.composed-historical-semantic-cell.v3',
    inputBinding: {
      snapshotChecksum: SNAPSHOT_CHECKSUM,
      corpusSha256: CORPUS_SHA256,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
    },
    request: {
      requestId: intent.requestId,
      amountBucket: intent.amountBucket,
      topology: intent.topology,
      assetIn: intent.assetIn,
      assetOut: intent.assetOut,
      amountIn: intent.amountIn.toString(10),
    },
    profile: {
      profileId: currentProfile.profileId,
      workCaps: currentProfile.workCaps,
    },
    result: projectedResult,
  };
}

function buildSemantic(
  verified: Extract<Awaited<ReturnType<typeof verifySyntheticRequestCorpus>>, { readonly ok: true }>['value'],
): SemanticBuild {
  const cells: JsonRecord[] = [];
  const results: CanonicalSplitRouterRuntimeResult[] = [];
  const accumulators = PROFILES.map((currentProfile) => ({
    profileId: currentProfile.profileId,
    statusCounts: { success: 0, noRoute: 0, noPlan: 0 },
    terminationCounts: { complete: 0, workLimit: 0 },
    counterTotals: zeroCounterRecord(),
    counterMaxima: zeroCounterRecord(),
  }));
  for (const intent of verified.corpus.requests) {
    for (let profileIndex = 0; profileIndex < PROFILES.length; profileIndex += 1) {
      const currentProfile = PROFILES[profileIndex];
      const accumulator = accumulators[profileIndex];
      if (currentProfile === undefined || accumulator === undefined) {
        throw new EvaluationAbort('runtime-result-invalid', 'semantic-schedule');
      }
      const result = runCell(verified.context, intent, currentProfile);
      results.push(result);
      const search = searchOf(result);
      if (result.status === 'success') accumulator.statusCounts.success += 1;
      else if (result.status === 'no-route') accumulator.statusCounts.noRoute += 1;
      else accumulator.statusCounts.noPlan += 1;
      if (search.termination === 'complete') accumulator.terminationCounts.complete += 1;
      else accumulator.terminationCounts.workLimit += 1;
      addCounters(accumulator.counterTotals, accumulator.counterMaxima, search.counters);
      const projected = projectCanonicalSplitRouterResult(result);
      const semanticHash = sha256(JSON.stringify(cellHashValue(intent, currentProfile, projected)));
      cells.push({
        requestId: intent.requestId,
        amountBucket: intent.amountBucket,
        topology: intent.topology,
        assetIn: intent.assetIn,
        assetOut: intent.assetOut,
        amountIn: intent.amountIn.toString(10),
        profileId: currentProfile.profileId,
        workCaps: currentProfile.workCaps,
        semanticHash,
        result: projected,
      });
    }
  }
  const profileSummaries = accumulators.map((accumulator) => ({
    profileId: accumulator.profileId,
    statusCounts: accumulator.statusCounts,
    terminationCounts: accumulator.terminationCounts,
    counterTotals: accumulator.counterTotals,
    counterMaxima: accumulator.counterMaxima,
  }));
  const requestCount = verified.corpus.requests.length;

  const adjacentComparisons = [];
  for (let profileIndex = 1; profileIndex < PROFILES.length; profileIndex += 1) {
    const previousProfile = PROFILES[profileIndex - 1];
    const currentProfile = PROFILES[profileIndex];
    if (previousProfile === undefined || currentProfile === undefined) {
      throw new EvaluationAbort('runtime-result-invalid', 'profile-schedule');
    }
    let newlyPlanned = 0;
    let noLongerPlanned = 0;
    let strictlyImproved = 0;
    let equalObjective = 0;
    let regressed = 0;
    for (let requestIndex = 0; requestIndex < requestCount; requestIndex += 1) {
      const previous = results[requestIndex * PROFILES.length + profileIndex - 1];
      const current = results[requestIndex * PROFILES.length + profileIndex];
      if (previous === undefined || current === undefined) {
        throw new EvaluationAbort('runtime-result-invalid', 'comparison-schedule');
      }
      if (previous.status !== 'success' && current.status === 'success') newlyPlanned += 1;
      else if (previous.status === 'success' && current.status !== 'success') noLongerPlanned += 1;
      else if (previous.status !== 'success' && current.status !== 'success') equalObjective += 1;
      else if (previous.status === 'success' && current.status === 'success') {
        if (isStrictlyBetterSplitReceipt(current.plan.receipt, previous.plan.receipt)) {
          strictlyImproved += 1;
        } else if (isStrictlyBetterSplitReceipt(previous.plan.receipt, current.plan.receipt)) {
          regressed += 1;
        } else {
          equalObjective += 1;
        }
      }
    }
    if (noLongerPlanned !== 0 || regressed !== 0) {
      throw new EvaluationAbort('objective-regression', currentProfile.profileId);
    }
    adjacentComparisons.push({
      previousProfileId: previousProfile.profileId,
      profileId: currentProfile.profileId,
      newlyPlanned,
      noLongerPlanned,
      strictlyImproved,
      equalObjective,
      regressed,
    });
  }

  const terminalSummary = profileSummaries[profileSummaries.length - 1];
  if (
    terminalSummary === undefined
    || terminalSummary.terminationCounts.complete !== requestCount
    || terminalSummary.terminationCounts.workLimit !== 0
  ) throw new EvaluationAbort('terminal-profile-incomplete', 'structural-complete');

  const document = {
    schemaVersion: 'routelab.composed-historical-semantic-results.v3',
    evaluationId: HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID,
    inputBinding: {
      ...EXPECTED_INPUT_BINDING,
      comparisonConfigId: COMPARISON_CONFIG_ID,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
    },
    schedule: {
      semanticOrder: 'corpus-request-then-declared-profile',
      requestCount,
      profileCount: PROFILES.length,
      cellCount: cells.length,
      profileOrder: PROFILE_IDS,
    },
    cells,
    summary: { profileSummaries, adjacentComparisons },
    limitations: SEMANTIC_LIMITATIONS,
  };
  return Object.freeze({
    json: JSON.stringify(document),
    document,
    cells: Object.freeze(cells),
    results: Object.freeze(results),
  });
}

function validateEnvironment(environment: HistoricalEvaluationEnvironment): void {
  if (
    !environment
    || typeof environment.nodeVersion !== 'string'
    || environment.nodeVersion.length === 0
    || typeof environment.platform !== 'string'
    || environment.platform.length === 0
    || typeof environment.arch !== 'string'
    || environment.arch.length === 0
    || typeof environment.osRelease !== 'string'
    || environment.osRelease.length === 0
    || typeof environment.cpuModel !== 'string'
    || environment.cpuModel.length === 0
    || !Number.isSafeInteger(environment.logicalCpuCount)
    || environment.logicalCpuCount <= 0
  ) throw new EvaluationAbort('invalid-environment', 'environment');
}

function sampleClock(nowNanoseconds: () => bigint): bigint {
  try {
    const value = nowNanoseconds();
    if (typeof value !== 'bigint' || value < 0n) {
      throw new EvaluationAbort('clock-failed', 'clock');
    }
    return value;
  } catch (error) {
    if (error instanceof EvaluationAbort) throw error;
    throw new EvaluationAbort('clock-failed', 'clock');
  }
}

function runObservedCell(
  verified: Extract<Awaited<ReturnType<typeof verifySyntheticRequestCorpus>>, { readonly ok: true }>['value'],
  semantic: SemanticBuild,
  cellIndex: number,
  nowNanoseconds: () => bigint,
  timed: boolean,
): { readonly elapsedNanoseconds: string; readonly result: CanonicalSplitRouterRuntimeResult } {
  const requestIndex = Math.floor(cellIndex / PROFILES.length);
  const profileIndex = cellIndex % PROFILES.length;
  const intent = verified.corpus.requests[requestIndex];
  const currentProfile = PROFILES[profileIndex];
  const expectedCell = semantic.cells[cellIndex];
  if (intent === undefined || currentProfile === undefined || expectedCell === undefined) {
    throw new EvaluationAbort('observation-schedule-mismatch', 'observation-schedule');
  }
  const request = runtimeRequest(intent);
  const invoked = invokeCell(
    verified.context,
    request,
    currentProfile,
    timed ? nowNanoseconds : undefined,
  );
  const { result } = invoked;
  validateCellResult(result, `${intent.requestId}/${currentProfile.profileId}`);
  if (!isDeepStrictEqual(projectCanonicalSplitRouterResult(result), expectedCell['result'])) {
    throw new EvaluationAbort('timed-result-mismatch', `${intent.requestId}/${currentProfile.profileId}`);
  }
  return Object.freeze({
    elapsedNanoseconds: invoked.elapsedNanoseconds.toString(10),
    result,
  });
}

function buildObservations(
  verified: Extract<Awaited<ReturnType<typeof verifySyntheticRequestCorpus>>, { readonly ok: true }>['value'],
  semantic: SemanticBuild,
  semanticSha256: string,
  dependencies: HistoricalEvaluationGenerationDependencies,
): string {
  validateEnvironment(dependencies.environment);
  if (dependencies.runtimeRevision !== HISTORICAL_COMPOSED_SPLIT_RUNTIME_REVISION) {
    throw new EvaluationAbort('invalid-runtime-revision', 'runtimeRevision');
  }
  const cellCount = semantic.cells.length;
  for (let index = 0; index < cellCount; index += 1) {
    runObservedCell(verified, semantic, index, dependencies.nowNanoseconds, false);
  }
  const samples = [];
  for (let round = 0; round < 5; round += 1) {
    for (let order = 0; order < cellCount; order += 1) {
      const cellIndex = round % 2 === 0 ? order : cellCount - order - 1;
      const cell = semantic.cells[cellIndex];
      if (cell === undefined) {
        throw new EvaluationAbort('observation-schedule-mismatch', 'observation-schedule');
      }
      const observed = runObservedCell(
        verified,
        semantic,
        cellIndex,
        dependencies.nowNanoseconds,
        true,
      );
      samples.push({
        round,
        order,
        requestId: cell['requestId'],
        profileId: cell['profileId'],
        semanticHash: cell['semanticHash'],
        elapsedNanoseconds: observed.elapsedNanoseconds,
      });
    }
  }
  return JSON.stringify({
    schemaVersion: 'routelab.composed-historical-timing-observations.v3',
    evaluationId: HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID,
    inputBinding: {
      ...EXPECTED_INPUT_BINDING,
      comparisonConfigId: COMPARISON_CONFIG_ID,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
      observationConfigId: OBSERVATION_CONFIG_ID,
      observationConfigSha256: OBSERVATION_CONFIG_SHA256,
      semanticResultsSha256: semanticSha256,
    },
    runtime: {
      entryPoint: 'routeExactInputSplitAnytime',
      runtimeRevision: dependencies.runtimeRevision,
    },
    measurement: {
      timingScope: 'routeExactInputSplitAnytime-call-only',
      clock: 'process.hrtime.bigint',
      warmupSweeps: 1,
      sampleSweeps: 5,
      sweepOrder: 'forward-even-reverse-odd',
      serialization: 'outside-timed-region',
      environment: dependencies.environment,
      samples,
    },
    limitations: OBSERVATION_LIMITATIONS,
  });
}

function descriptor(relativePath: string, json: string): ArtifactDescriptor {
  return Object.freeze({ path: relativePath, bytes: byteLength(json), sha256: sha256(json) });
}

function buildManifest(
  runtimeRevision: string,
  semanticDescriptor: ArtifactDescriptor,
  observationsDescriptor: ArtifactDescriptor,
): JsonRecord {
  return {
    schemaVersion: 'routelab.composed-historical-evaluation-manifest.v3',
    evaluationId: HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID,
    inputBinding: {
      ...EXPECTED_INPUT_BINDING,
      comparisonConfigId: COMPARISON_CONFIG_ID,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
      observationConfigId: OBSERVATION_CONFIG_ID,
      observationConfigSha256: OBSERVATION_CONFIG_SHA256,
    },
    runtime: {
      entryPoint: 'routeExactInputSplitAnytime',
      implementationRevision: runtimeRevision,
    },
    artifacts: {
      comparisonConfig: {
        path: CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
        bytes: COMPARISON_CONFIG_BYTES,
        sha256: COMPARISON_CONFIG_SHA256,
      },
      observationConfig: {
        path: CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH,
        bytes: OBSERVATION_CONFIG_BYTES,
        sha256: OBSERVATION_CONFIG_SHA256,
      },
      semanticResults: semanticDescriptor,
      observations: observationsDescriptor,
    },
    counts: {
      requestCount: 396,
      profileCount: 6,
      semanticCellCount: 2_376,
      warmupSweeps: 1,
      sampleSweeps: 5,
      observationSampleCount: 11_880,
    },
    limitations: MANIFEST_LIMITATIONS,
  };
}

function summaryFrom(
  semantic: SemanticBuild,
  observationsSha256: string,
): HistoricalEvaluationSummary {
  const summary = semantic.document['summary'] as JsonRecord;
  return deepFreeze({
    schemaVersion: 'routelab.composed-historical-evaluation-summary.v3' as const,
    evaluationId: HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID,
    comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
    observationConfigSha256: OBSERVATION_CONFIG_SHA256,
    semanticResultsSha256: sha256(semantic.json),
    observationsSha256,
    requestCount: 396,
    profileCount: 6,
    semanticCellCount: 2_376,
    observationSampleCount: 11_880,
    profileSummaries: summary['profileSummaries'] as readonly unknown[],
    adjacentComparisons: summary['adjacentComparisons'] as readonly unknown[],
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as JsonRecord)) deepFreeze(nested);
  return Object.freeze(value);
}

function cachedReadDependencies(
  dependencies: HistoricalEvaluationReadDependencies,
): HistoricalEvaluationReadDependencies {
  const reads = new Map<string, Promise<Uint8Array>>();
  return Object.freeze({
    readFile(filePath: string): Promise<Uint8Array> {
      let read = reads.get(filePath);
      if (read === undefined) {
        read = Promise.resolve().then(() => dependencies.readFile(filePath));
        reads.set(filePath, read);
      }
      return read.then((bytes) => Uint8Array.from(bytes));
    },
  });
}

async function readHistoricalEvaluationPreamble(
  directory: string,
  dependencies: HistoricalEvaluationReadDependencies,
): Promise<
  | { readonly ok: true; readonly value: HistoricalEvaluationPreamble }
  | { readonly ok: false; readonly error: HistoricalEvaluationError }
> {
  const manifestBytes = await safeRead(dependencies.readFile, path.join(directory, 'manifest.json'));
  if (manifestBytes === undefined) return failure('manifest-read-failed', 'manifest.json');
  const manifestJson = parseJson(manifestBytes);
  if (manifestJson === undefined) return failure('invalid-manifest-json', 'manifest.json');
  const manifest = parseManifest(manifestJson.value);
  if (manifest === undefined) return failure('invalid-manifest-shape', 'manifest.json');
  const config = await readComparisonConfig(dependencies, manifest.config);
  if (!config.ok) return config;
  const observationConfig = await readObservationConfig(dependencies, manifest.observationConfig);
  if (!observationConfig.ok) return observationConfig;
  return Object.freeze({ ok: true, value: Object.freeze({ manifestJson, manifest }) });
}

export async function createHistoricalComposedSplitEvaluation(
  dependencies: HistoricalEvaluationGenerationDependencies,
): Promise<HistoricalEvaluationGenerationResult> {
  const config = await readComparisonConfig(dependencies, {
    path: CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
    bytes: COMPARISON_CONFIG_BYTES,
    sha256: COMPARISON_CONFIG_SHA256,
  });
  if (!config.ok) return config;
  const observationConfig = await readObservationConfig(dependencies, {
    path: CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH,
    bytes: OBSERVATION_CONFIG_BYTES,
    sha256: OBSERVATION_CONFIG_SHA256,
  });
  if (!observationConfig.ok) return observationConfig;
  const verified = await verifySyntheticRequestCorpus(
    CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
    { readFile: dependencies.readFile },
  );
  if (!verified.ok) return failure('corpus-invalid', `corpus/${verified.error.artifact}`);
  try {
    const semantic = buildSemantic(verified.value);
    const semanticDescriptor = descriptor('semantic-results.json', semantic.json);
    const observationsJson = buildObservations(
      verified.value,
      semantic,
      semanticDescriptor.sha256,
      dependencies,
    );
    const observationsDescriptor = descriptor('observations.json', observationsJson);
    const manifestJson = JSON.stringify(buildManifest(
      dependencies.runtimeRevision,
      semanticDescriptor,
      observationsDescriptor,
    ));
    const summary = summaryFrom(semantic, observationsDescriptor.sha256);
    return Object.freeze({
      ok: true,
      value: deepFreeze({
        manifestJson,
        semanticResultsJson: semantic.json,
        observationsJson,
        summary,
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
  return Object.freeze({
    path: value['path'],
    bytes: value['bytes'],
    sha256: value['sha256'],
  });
}

function parseManifest(value: unknown): {
  readonly value: JsonRecord;
  readonly runtimeRevision: string;
  readonly config: ArtifactDescriptor;
  readonly observationConfig: ArtifactDescriptor;
  readonly semantic: ArtifactDescriptor;
  readonly observations: ArtifactDescriptor;
} | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'evaluationId', 'inputBinding', 'runtime', 'artifacts', 'counts', 'limitations',
  ])) return undefined;
  if (!isRecord(value['artifacts']) || !hasExactKeys(value['artifacts'], [
    'comparisonConfig', 'observationConfig', 'semanticResults', 'observations',
  ])) return undefined;
  const config = parseDescriptor(
    value['artifacts']['comparisonConfig'],
    CANONICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
  );
  const semantic = parseDescriptor(value['artifacts']['semanticResults'], 'semantic-results.json');
  const observations = parseDescriptor(value['artifacts']['observations'], 'observations.json');
  const observationConfig = parseDescriptor(
    value['artifacts']['observationConfig'],
    CANONICAL_HISTORICAL_OBSERVATION_CONFIG_PATH,
  );
  if (
    config === undefined
    || observationConfig === undefined
    || semantic === undefined
    || observations === undefined
    || !isRecord(value['runtime'])
    || !hasExactKeys(value['runtime'], ['entryPoint', 'implementationRevision'])
    || value['runtime']['entryPoint'] !== 'routeExactInputSplitAnytime'
    || typeof value['runtime']['implementationRevision'] !== 'string'
    || value['runtime']['implementationRevision'] !== HISTORICAL_COMPOSED_SPLIT_RUNTIME_REVISION
  ) return undefined;
  return Object.freeze({
    value,
    runtimeRevision: value['runtime']['implementationRevision'],
    config,
    observationConfig,
    semantic,
    observations,
  });
}

async function readDeclaredArtifact(
  directory: string,
  dependencies: HistoricalEvaluationReadDependencies,
  artifact: ArtifactDescriptor,
  prefix: 'semantic-results' | 'observations',
): Promise<{ readonly ok: true; readonly bytes: Uint8Array; readonly parsed: { readonly text: string; readonly value: unknown } } | { readonly ok: false; readonly error: HistoricalEvaluationError }> {
  const bytes = await safeRead(dependencies.readFile, path.join(directory, artifact.path));
  if (bytes === undefined) return failure(`${prefix}-read-failed`, artifact.path);
  if (bytes.byteLength !== artifact.bytes) return failure(`${prefix}-size-mismatch`, artifact.path);
  if (sha256(bytes) !== artifact.sha256) return failure(`${prefix}-hash-mismatch`, artifact.path);
  const parsed = parseJson(bytes);
  if (parsed === undefined) return failure(`invalid-${prefix}-json`, artifact.path);
  return Object.freeze({ ok: true, bytes, parsed });
}

function basicSemanticShape(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, [
      'schemaVersion', 'evaluationId', 'inputBinding', 'schedule', 'cells', 'summary', 'limitations',
    ])
    && value['schemaVersion'] === 'routelab.composed-historical-semantic-results.v3'
    && Array.isArray(value['cells'])
    && value['cells'].length === 2_376;
}

function basicObservationsShape(value: unknown): value is JsonRecord {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'schemaVersion', 'evaluationId', 'inputBinding', 'runtime', 'measurement', 'limitations',
    ])
    || value['schemaVersion'] !== 'routelab.composed-historical-timing-observations.v3'
    || !isRecord(value['inputBinding'])
    || !isRecord(value['runtime'])
    || !hasExactKeys(value['runtime'], ['entryPoint', 'runtimeRevision'])
    || !isRecord(value['measurement'])
    || !hasExactKeys(value['measurement'], [
      'timingScope', 'clock', 'warmupSweeps', 'sampleSweeps', 'sweepOrder', 'serialization',
      'environment', 'samples',
    ])
  ) return false;
  const measurement = value['measurement'];
  if (
    !isRecord(measurement['environment'])
    || !hasExactKeys(measurement['environment'], [
      'nodeVersion', 'platform', 'arch', 'osRelease', 'cpuModel', 'logicalCpuCount',
    ])
    || !Array.isArray(measurement['samples'])
    || measurement['samples'].length !== 11_880
  ) return false;
  return measurement['samples'].every((sample: unknown) => isRecord(sample) && hasExactKeys(sample, [
    'round', 'order', 'requestId', 'profileId', 'semanticHash', 'elapsedNanoseconds',
  ]));
}

function validateObservations(
  value: unknown,
  semantic: SemanticBuild,
  semanticSha256: string,
  runtimeRevision: string,
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'evaluationId', 'inputBinding', 'runtime', 'measurement', 'limitations',
  ])) return false;
  if (
    value['schemaVersion'] !== 'routelab.composed-historical-timing-observations.v3'
    || value['evaluationId'] !== HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID
    || !isDeepStrictEqual(value['limitations'], OBSERVATION_LIMITATIONS)
    || !isRecord(value['inputBinding'])
    || !isDeepStrictEqual(value['inputBinding'], {
      ...EXPECTED_INPUT_BINDING,
      comparisonConfigId: COMPARISON_CONFIG_ID,
      comparisonConfigSha256: COMPARISON_CONFIG_SHA256,
      observationConfigId: OBSERVATION_CONFIG_ID,
      observationConfigSha256: OBSERVATION_CONFIG_SHA256,
      semanticResultsSha256: semanticSha256,
    })
    || !isRecord(value['runtime'])
    || !hasExactKeys(value['runtime'], ['entryPoint', 'runtimeRevision'])
    || value['runtime']['entryPoint'] !== 'routeExactInputSplitAnytime'
    || value['runtime']['runtimeRevision'] !== runtimeRevision
    || !isRecord(value['measurement'])
    || !hasExactKeys(value['measurement'], [
      'timingScope', 'clock', 'warmupSweeps', 'sampleSweeps', 'sweepOrder', 'serialization',
      'environment', 'samples',
    ])
  ) return false;
  const measurement = value['measurement'];
  if (
    measurement['timingScope'] !== 'routeExactInputSplitAnytime-call-only'
    || measurement['clock'] !== 'process.hrtime.bigint'
    || measurement['warmupSweeps'] !== 1
    || measurement['sampleSweeps'] !== 5
    || measurement['sweepOrder'] !== 'forward-even-reverse-odd'
    || measurement['serialization'] !== 'outside-timed-region'
    || !isRecord(measurement['environment'])
    || !hasExactKeys(measurement['environment'], [
      'nodeVersion', 'platform', 'arch', 'osRelease', 'cpuModel', 'logicalCpuCount',
    ])
    || !Array.isArray(measurement['samples'])
    || measurement['samples'].length !== 11_880
  ) return false;
  try {
    validateEnvironment(measurement['environment'] as unknown as HistoricalEvaluationEnvironment);
  } catch {
    return false;
  }
  const samples = measurement['samples'] as readonly unknown[];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!isRecord(sample) || !hasExactKeys(sample, [
      'round', 'order', 'requestId', 'profileId', 'semanticHash', 'elapsedNanoseconds',
    ])) return false;
    const round = Math.floor(index / 2_376);
    const order = index % 2_376;
    const cellIndex = round % 2 === 0 ? order : 2_376 - order - 1;
    const cell = semantic.cells[cellIndex];
    if (
      cell === undefined
      || sample['round'] !== round
      || sample['order'] !== order
      || sample['requestId'] !== cell['requestId']
      || sample['profileId'] !== cell['profileId']
      || sample['semanticHash'] !== cell['semanticHash']
      || typeof sample['elapsedNanoseconds'] !== 'string'
      || !/^(?:0|[1-9][0-9]*)$/u.test(sample['elapsedNanoseconds'])
    ) return false;
  }
  return true;
}

export async function verifyHistoricalComposedSplitEvaluation(
  directory: string,
  dependencies: HistoricalEvaluationReadDependencies,
): Promise<HistoricalEvaluationVerificationResult> {
  const cached = cachedReadDependencies(dependencies);

  // Preserve the supported verifier's manifest -> configs -> corpus precedence.
  const preamble = await readHistoricalEvaluationPreamble(directory, cached);
  if (!preamble.ok) return preamble;

  const verified = await verifySyntheticRequestCorpus(
    CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
    { readFile: cached.readFile },
  );
  if (!verified.ok) return failure('corpus-invalid', `corpus/${verified.error.artifact}`);

  const continued = await verifyHistoricalComposedSplitEvaluationWithVerifiedCorpus(
    directory,
    cached,
    verified.value,
    preamble.value,
  );
  if (!continued.ok) return continued;
  return Object.freeze({ ok: true, value: continued.value.summary });
}

/**
 * Continues the retained M6 verification from an already verified corpus bundle.
 * Callers must pass the exact bundle they intend to reuse for later runtime work.
 *
 * @internal
 */
export async function verifyHistoricalComposedSplitEvaluationWithVerifiedCorpus(
  directory: string,
  dependencies: HistoricalEvaluationReadDependencies,
  verified: VerifiedSyntheticRequestCorpusBundle,
  establishedPreamble?: HistoricalEvaluationPreamble,
): Promise<PreverifiedHistoricalComposedSplitEvaluationResult> {
  const loaded = establishedPreamble === undefined
    ? await readHistoricalEvaluationPreamble(directory, dependencies)
    : Object.freeze({ ok: true as const, value: establishedPreamble });
  if (!loaded.ok) return loaded;
  const { manifestJson, manifest } = loaded.value;
  const semanticArtifact = await readDeclaredArtifact(
    directory,
    dependencies,
    manifest.semantic,
    'semantic-results',
  );
  if (!semanticArtifact.ok) return semanticArtifact;
  if (!basicSemanticShape(semanticArtifact.parsed.value)) {
    return failure('invalid-semantic-results-shape', 'semantic-results.json');
  }
  let semantic: SemanticBuild;
  try {
    semantic = buildSemantic(verified);
  } catch (error) {
    if (error instanceof EvaluationAbort) return failure(error.code, error.artifact);
    return failure('semantic-replay-mismatch', 'semantic-results.json');
  }
  if (semanticArtifact.parsed.text !== semantic.json) {
    return failure('semantic-replay-mismatch', 'semantic-results.json');
  }
  const observationsArtifact = await readDeclaredArtifact(
    directory,
    dependencies,
    manifest.observations,
    'observations',
  );
  if (!observationsArtifact.ok) return observationsArtifact;
  if (!basicObservationsShape(observationsArtifact.parsed.value)) {
    return failure('invalid-observations-shape', 'observations.json');
  }
  if (!validateObservations(
    observationsArtifact.parsed.value,
    semantic,
    manifest.semantic.sha256,
    manifest.runtimeRevision,
  )) return failure('observation-schedule-mismatch', 'observations.json');

  const expectedManifest = buildManifest(
    manifest.runtimeRevision,
    descriptor('semantic-results.json', semanticArtifact.parsed.text),
    descriptor('observations.json', observationsArtifact.parsed.text),
  );
  if (
    !isDeepStrictEqual(manifest.value, expectedManifest)
    || manifestJson.text !== JSON.stringify(expectedManifest)
  ) return failure('manifest-metadata-mismatch', 'manifest.json');

  return Object.freeze({
    ok: true,
    value: deepFreeze({
      summary: summaryFrom(semantic, manifest.observations.sha256),
      semanticCells: semantic.cells,
      runtimeResults: semantic.results,
    }),
  });
}
