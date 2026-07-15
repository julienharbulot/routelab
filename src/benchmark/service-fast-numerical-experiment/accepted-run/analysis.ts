import {
  ACCEPTED_CASE_IDS,
  ACCEPTED_CLAUSE_IDS,
  ACCEPTED_DEADLINES_MS,
  ACCEPTED_EXECUTION_SCHEDULE,
  ACCEPTED_HOTSPOT_CASE_IDS,
  ACCEPTED_LIMITATIONS,
  ACCEPTED_OPERATIONAL_CASE_IDS,
  ACCEPTED_POLICY_IDS,
  type AcceptedArtifactDescriptor,
  type AcceptedInputRecord,
  type AcceptedJson,
  type AcceptedJsonObject,
} from './contract.ts';
import { hashAcceptedJson } from './projection.ts';

interface ExactRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface FailureCounts {
  nonConvergence: number;
  residualOptionsExhausted: number;
  untypedFailures: number;
  exactSafetyFailures: number;
}

interface SemanticMetrics {
  finalObjectivesNeverWorse: boolean;
  anchorPlanLostCount: number;
  unterminatedDiagnosticCount: number;
  readonly serviceFailures: FailureCounts;
  readonly amplifiedFailures: FailureCounts;
}

interface DeadlineCounts {
  entryPlan: number;
  anyValidScore: number;
  anyImprovement: number;
  anchorQuality: number;
  completeStage: number;
}

export interface AcceptedAnalysisDescriptors {
  readonly config: AcceptedArtifactDescriptor;
  readonly artifactSchema: AcceptedArtifactDescriptor;
  readonly sourceClosure: AcceptedArtifactDescriptor;
  readonly inputArtifact: AcceptedArtifactDescriptor;
}

export interface AcceptedAnalysisClosure {
  readonly implementationInputRevision: string;
}

function object(value: AcceptedJson | undefined): AcceptedJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Accepted analysis object is invalid.');
  }
  return value as AcceptedJsonObject;
}

function list(value: AcceptedJson | undefined): readonly AcceptedJson[] {
  if (!Array.isArray(value)) throw new TypeError('Accepted analysis array is invalid.');
  return value as readonly AcceptedJson[];
}

function string(value: AcceptedJson | undefined): string {
  if (typeof value !== 'string') throw new TypeError('Accepted analysis string is invalid.');
  return value;
}

function integer(value: AcceptedJson | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Accepted analysis integer is invalid.');
  }
  return value;
}

function positiveInteger(value: AcceptedJson | undefined): number {
  const result = integer(value);
  if (result === 0) throw new TypeError('Accepted analysis positive integer is invalid.');
  return result;
}

function boolean(value: AcceptedJson | undefined): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Accepted analysis boolean is invalid.');
  return value;
}

function key(...values: readonly (string | number)[]): string {
  return JSON.stringify(values);
}

function failureCounts(): FailureCounts {
  return { nonConvergence: 0, residualOptionsExhausted: 0, untypedFailures: 0, exactSafetyFailures: 0 };
}

function semanticMetrics(): SemanticMetrics {
  return {
    finalObjectivesNeverWorse: true,
    anchorPlanLostCount: 0,
    unterminatedDiagnosticCount: 0,
    serviceFailures: failureCounts(),
    amplifiedFailures: failureCounts(),
  };
}

function deadlineCounts(): DeadlineCounts {
  return { entryPlan: 0, anyValidScore: 0, anyImprovement: 0, anchorQuality: 0, completeStage: 0 };
}

const CANDIDATE_FAILURE_CODES = new Set([
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
]);

function countFailureFamily(
  target: FailureCounts,
  diagnostics: readonly AcceptedJsonObject[],
): void {
  for (const diagnostic of diagnostics) {
    const failure = diagnostic['failureCode'];
    if (failure === null) continue;
    if (typeof failure !== 'string' || !CANDIDATE_FAILURE_CODES.has(failure)) {
      target.untypedFailures += 1;
      throw new TypeError('Untyped candidate failure cannot enter accepted analysis.');
    }
    if (failure === 'authorization-mismatch') {
      target.exactSafetyFailures += 1;
      throw new TypeError('Exact-safety failure cannot enter accepted analysis.');
    }
    if (failure === 'non-convergence') target.nonConvergence += 1;
    if (failure === 'residual-options-exhausted') target.residualOptionsExhausted += 1;
  }
}

function nanoseconds(value: AcceptedJson | undefined): bigint {
  const result = BigInt(string(value));
  if (result < 0n || result > 99_999_999_999_999_999_999n) {
    throw new TypeError('Accepted nanoseconds value is invalid.');
  }
  return result;
}

export class AcceptedAnalysisAccumulator {
  readonly semantic = ACCEPTED_POLICY_IDS.map(() => semanticMetrics());
  readonly callSweeps = new Map<string, (bigint | undefined)[]>();
  readonly timelineSweeps = new Map<string, (bigint | null | undefined)[]>();
  readonly deadline = new Map<string, DeadlineCounts>();

  acceptSemantic(record: AcceptedJsonObject, input: AcceptedInputRecord): void {
    const policyIndex = integer(record['policyMatrixIndex']);
    const metrics = this.semantic[policyIndex];
    if (metrics === undefined) throw new TypeError('Accepted semantic policy is invalid.');
    const comparison = object(record['anchorComparison']);
    if (comparison['comparison'] === 'policy-worse') metrics.finalObjectivesNeverWorse = false;
    if (comparison['relation'] === 'anchor-plan-lost') metrics.anchorPlanLostCount += 1;
    const diagnostics = list(record['candidateSetDiagnostics']).map(object);
    metrics.unterminatedDiagnosticCount += diagnostics.filter((diagnostic) =>
      typeof diagnostic['terminalStatus'] !== 'string').length;
    if (input.serviceDecisionMember) countFailureFamily(metrics.serviceFailures, diagnostics);
    if (input.amplifiedStressMember) countFailureFamily(metrics.amplifiedFailures, diagnostics);
  }

  acceptCall(record: AcceptedJsonObject): void {
    const policyIndex = integer(record['policyMatrixIndex']);
    const caseId = string(record['caseId']);
    const timingIndex = integer(record['timingCohortIndex']);
    const sweepIndex = integer(record['sweepIndex']);
    const encoded = key(policyIndex, caseId, timingIndex);
    const sweeps = this.callSweeps.get(encoded) ?? Array<bigint | undefined>(5);
    if (sweepIndex >= 5 || sweeps[sweepIndex] !== undefined) {
      throw new TypeError('Accepted call sweep identity is duplicated.');
    }
    sweeps[sweepIndex] = nanoseconds(record['elapsedNanoseconds']);
    this.callSweeps.set(encoded, sweeps);
  }

  acceptTimeline(record: AcceptedJsonObject): void {
    const policyIndex = integer(record['policyMatrixIndex']);
    const caseId = string(record['caseId']);
    const timingIndex = integer(record['timingCohortIndex']);
    const sweepIndex = integer(record['sweepIndex']);
    for (const field of [
      'firstStrictImprovementNanoseconds',
      'finalBestInstallNanoseconds',
    ] as const) {
      const encoded = key(policyIndex, caseId, timingIndex, field);
      const sweeps = this.timelineSweeps.get(encoded) ?? Array<bigint | null | undefined>(3);
      if (sweepIndex >= 3 || sweeps[sweepIndex] !== undefined) {
        throw new TypeError('Accepted timeline sweep identity is duplicated.');
      }
      const value = record[field];
      sweeps[sweepIndex] = value === null ? null : nanoseconds(value);
      this.timelineSweeps.set(encoded, sweeps);
    }
  }

  acceptDeadline(record: AcceptedJsonObject): void {
    const policyIndex = integer(record['policyMatrixIndex']);
    const caseId = string(record['caseId']);
    const deadlineMilliseconds = positiveInteger(record['deadlineMilliseconds']);
    const encoded = key(policyIndex, caseId, deadlineMilliseconds);
    const counts = this.deadline.get(encoded) ?? deadlineCounts();
    for (const field of [
      'entryPlan',
      'anyValidScore',
      'anyImprovement',
      'anchorQuality',
      'completeStage',
    ] as const) {
      if (boolean(record[field])) counts[field] += 1;
    }
    this.deadline.set(encoded, counts);
  }
}

function rational(numerator: bigint, denominator: bigint): ExactRational {
  if (denominator <= 0n) throw new TypeError('Accepted rational denominator is invalid.');
  return Object.freeze({ numerator, denominator });
}

function rationalJson(value: ExactRational): AcceptedJsonObject {
  return Object.freeze({
    numerator: value.numerator.toString(10),
    denominator: value.denominator.toString(10),
  });
}

function rationalFromJson(value: AcceptedJson | undefined): ExactRational {
  const source = object(value);
  return rational(BigInt(string(source['numerator'])), BigInt(string(source['denominator'])));
}

function compareRational(left: ExactRational, right: ExactRational): number {
  const compared = left.numerator * right.denominator - right.numerator * left.denominator;
  return compared < 0n ? -1 : compared > 0n ? 1 : 0;
}

function medianRational(values: readonly bigint[]): ExactRational {
  if (values.length === 0) throw new TypeError('Accepted median population is empty.');
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new TypeError('Accepted median value is absent.');
  if (sorted.length % 2 === 1) return rational(upper, 1n);
  const lower = sorted[middle - 1];
  if (lower === undefined) throw new TypeError('Accepted median value is absent.');
  return rational(lower + upper, 2n);
}

function medianOfFive(values: readonly bigint[]): bigint {
  if (values.length !== 5) throw new TypeError('Accepted five-sweep median is incomplete.');
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const result = sorted[2];
  if (result === undefined) throw new TypeError('Accepted median is absent.');
  return result;
}

function nullableMedianOfThree(values: readonly (bigint | null)[]): bigint | null {
  if (values.length !== 3) throw new TypeError('Accepted three-sweep median is incomplete.');
  const sorted = [...values].sort((left, right) =>
    left === null ? right === null ? 0 : 1
      : right === null ? -1 : left < right ? -1 : left > right ? 1 : 0);
  return sorted[1] ?? null;
}

function completeBigints(values: readonly (bigint | undefined)[], count: number): readonly bigint[] {
  if (values.length !== count || values.some((value) => value === undefined)) {
    throw new TypeError('Accepted observation sweep is incomplete.');
  }
  return values as readonly bigint[];
}

function completeNullable(values: readonly (bigint | null | undefined)[]): readonly (bigint | null)[] {
  if (values.length !== 3 || values.some((value) => value === undefined)) {
    throw new TypeError('Accepted nullable sweep is incomplete.');
  }
  return values as readonly (bigint | null)[];
}

function callCaseMetric(
  accumulator: AcceptedAnalysisAccumulator,
  policyIndex: number,
  caseId: string,
): { readonly json: AcceptedJsonObject; readonly ratio: ExactRational } {
  const timingIndexes = [...accumulator.callSweeps.keys()]
    .map((encoded) => JSON.parse(encoded) as [number, string, number])
    .filter(([index, candidateCase]) => index === policyIndex && candidateCase === caseId)
    .map(([, , timingIndex]) => timingIndex)
    .sort((left, right) => left - right);
  if (timingIndexes.length === 0 || new Set(timingIndexes).size !== timingIndexes.length) {
    throw new TypeError('Accepted call case population is invalid.');
  }
  const candidateMedians: bigint[] = [];
  const anchorMedians: bigint[] = [];
  const deltas: bigint[] = [];
  for (const timingIndex of timingIndexes) {
    const candidate = accumulator.callSweeps.get(key(policyIndex, caseId, timingIndex));
    const anchor = accumulator.callSweeps.get(key(0, caseId, timingIndex));
    if (candidate === undefined || anchor === undefined) throw new TypeError('Accepted paired call is absent.');
    const candidateMedian = medianOfFive(completeBigints(candidate, 5));
    const anchorMedian = medianOfFive(completeBigints(anchor, 5));
    candidateMedians.push(candidateMedian);
    anchorMedians.push(anchorMedian);
    deltas.push(candidateMedian - anchorMedian);
  }
  const anchorSum = anchorMedians.reduce((sum, value) => sum + value, 0n);
  if (anchorSum <= 0n) throw new TypeError('Accepted anchor elapsed denominator is invalid.');
  const ratio = rational(candidateMedians.reduce((sum, value) => sum + value, 0n), anchorSum);
  return Object.freeze({
    ratio,
    json: Object.freeze({
      caseId,
      pairedDeltaMedian: rationalJson(medianRational(deltas)),
      elapsedRatio: rationalJson(ratio),
    }),
  });
}

const EVENT_FIELDS = Object.freeze([
  Object.freeze({ field: 'firstStrictImprovementNanoseconds', event: 'first-exact-authorization-strictly-improving-entry-incumbent' }),
  Object.freeze({ field: 'finalBestInstallNanoseconds', event: 'final-best-incumbent-first-installed' }),
] as const);

function eventMetric(
  accumulator: AcceptedAnalysisAccumulator,
  policyIndex: number,
  caseId: string,
  field: typeof EVENT_FIELDS[number]['field'],
  event: typeof EVENT_FIELDS[number]['event'],
): AcceptedJsonObject {
  const timingIndexes = [...accumulator.timelineSweeps.keys()]
    .map((encoded) => JSON.parse(encoded) as [number, string, number, string])
    .filter(([index, candidateCase, , candidateField]) =>
      index === policyIndex && candidateCase === caseId && candidateField === field)
    .map(([, , timingIndex]) => timingIndex)
    .sort((left, right) => left - right);
  if (timingIndexes.length === 0 || new Set(timingIndexes).size !== timingIndexes.length) {
    throw new TypeError('Accepted event population is invalid.');
  }
  let anchorAvailabilityCount = 0;
  let candidateAvailabilityCount = 0;
  const paired: bigint[] = [];
  for (const timingIndex of timingIndexes) {
    const candidate = accumulator.timelineSweeps.get(key(policyIndex, caseId, timingIndex, field));
    const anchor = accumulator.timelineSweeps.get(key(0, caseId, timingIndex, field));
    if (candidate === undefined || anchor === undefined) throw new TypeError('Accepted paired event is absent.');
    const candidateMedian = nullableMedianOfThree(completeNullable(candidate));
    const anchorMedian = nullableMedianOfThree(completeNullable(anchor));
    if (anchorMedian !== null) anchorAvailabilityCount += 1;
    if (candidateMedian !== null) candidateAvailabilityCount += 1;
    if (anchorMedian !== null && candidateMedian !== null) paired.push(candidateMedian - anchorMedian);
  }
  return Object.freeze({
    caseId,
    event,
    anchorAvailabilityCount,
    candidateAvailabilityCount,
    pairedFiniteCount: paired.length,
    pairedFiniteMedianDelta: paired.length === 0 ? null : rationalJson(medianRational(paired)),
  });
}

function deadlineMetric(
  accumulator: AcceptedAnalysisAccumulator,
  policyIndex: number,
  caseId: string,
  deadlineMilliseconds: number,
): AcceptedJsonObject {
  const anchor = accumulator.deadline.get(key(0, caseId, deadlineMilliseconds));
  const candidate = accumulator.deadline.get(key(policyIndex, caseId, deadlineMilliseconds));
  if (anchor === undefined || candidate === undefined) throw new TypeError('Accepted deadline count is absent.');
  return Object.freeze({
    caseId,
    deadlineMilliseconds,
    anchor: Object.freeze({ ...anchor }),
    candidate: Object.freeze({ ...candidate }),
  });
}

function driverContract(config: AcceptedJsonObject, policyId: string): { readonly driverId: string; readonly maximumShareActions: number } {
  const driverId = policyId.split('--')[0];
  if (driverId === undefined) throw new TypeError('Accepted policy driver is absent.');
  const driver = list(object(config['policyMatrix'])['drivers'])
    .map(object)
    .find((candidate) => candidate['driverId'] === driverId);
  if (driver === undefined) throw new TypeError('Accepted driver contract is absent.');
  return Object.freeze({ driverId, maximumShareActions: positiveInteger(driver['maximumShareActions']) });
}

function maximumRatio(values: readonly ExactRational[]): ExactRational {
  const first = values[0];
  if (first === undefined) throw new TypeError('Accepted ratio population is empty.');
  return values.slice(1).reduce((maximum, value) =>
    compareRational(value, maximum) > 0 ? value : maximum, first);
}

function buildPolicyResult(
  accumulator: AcceptedAnalysisAccumulator,
  config: AcceptedJsonObject,
  policyIndex: number,
): AcceptedJsonObject {
  const policyId = ACCEPTED_POLICY_IDS[policyIndex];
  const semantic = accumulator.semantic[policyIndex];
  const anchorService = accumulator.semantic[0]?.serviceFailures;
  if (policyId === undefined || semantic === undefined || anchorService === undefined) {
    throw new TypeError('Accepted policy result is absent.');
  }
  const driver = driverContract(config, policyId);
  const ratios = new Map<string, ExactRational>();
  const callCases = ACCEPTED_OPERATIONAL_CASE_IDS.map((caseId) => {
    const metric = callCaseMetric(accumulator, policyIndex, caseId);
    ratios.set(caseId, metric.ratio);
    return metric.json;
  });
  const instrumentedEvents = ACCEPTED_HOTSPOT_CASE_IDS.flatMap((caseId) =>
    EVENT_FIELDS.map(({ field, event }) => eventMetric(accumulator, policyIndex, caseId, field, event)));
  const deadlineCases = ACCEPTED_OPERATIONAL_CASE_IDS.flatMap((caseId) =>
    ACCEPTED_DEADLINES_MS.map((deadline) => deadlineMetric(accumulator, policyIndex, caseId, deadline)));
  const anchorQualityVector = deadlineCases.map((value) =>
    integer(object(value['candidate'])['anchorQuality']));
  const hotspotRatios = ACCEPTED_HOTSPOT_CASE_IDS.map((caseId) => {
    const value = ratios.get(caseId);
    if (value === undefined) throw new TypeError('Accepted hotspot ratio is absent.');
    return value;
  });
  return Object.freeze({
    policyId,
    policyMatrixIndex: policyIndex,
    driverId: driver.driverId,
    mappedShareActionCeiling: driver.maximumShareActions,
    semantic: Object.freeze({
      invalidFreshReplayCount: 0,
      forcedFailureIncumbentMismatchCount: 0,
      finalObjectivesNeverWorse: semantic.finalObjectivesNeverWorse,
      anchorPlanLostCount: semantic.anchorPlanLostCount,
      unterminatedDiagnosticCount: semantic.unterminatedDiagnosticCount,
      anchorServiceFailures: Object.freeze({ ...anchorService }),
      candidateServiceFailures: Object.freeze({ ...semantic.serviceFailures }),
      amplifiedFailures: Object.freeze({ ...semantic.amplifiedFailures }),
    }),
    callCases: Object.freeze(callCases),
    instrumentedEvents: Object.freeze(instrumentedEvents),
    deadlineCases: Object.freeze(deadlineCases),
    rankingValues: Object.freeze({
      worstHotspotElapsedRatio: rationalJson(maximumRatio(hotspotRatios)),
      anchorQualityVector: Object.freeze(anchorQualityVector),
      mappedShareActionCeiling: driver.maximumShareActions,
      policyMatrixIndex: policyIndex,
    }),
  });
}

const ZERO = rational(0n, 1n);
const ONE = rational(1n, 1n);
const NINE_TENTHS = rational(9n, 10n);

export function qualifyAcceptedPolicy(result: AcceptedJsonObject): AcceptedJsonObject {
  const semantic = object(result['semantic']);
  const anchorFailures = object(semantic['anchorServiceFailures']);
  const candidateFailures = object(semantic['candidateServiceFailures']);
  const amplifiedFailures = object(semantic['amplifiedFailures']);
  const fresh = semantic['invalidFreshReplayCount'] === 0 &&
    semantic['forcedFailureIncumbentMismatchCount'] === 0 &&
    amplifiedFailures['untypedFailures'] === 0 &&
    amplifiedFailures['exactSafetyFailures'] === 0;
  const full = semantic['finalObjectivesNeverWorse'] === true &&
    semantic['anchorPlanLostCount'] === 0 && semantic['unterminatedDiagnosticCount'] === 0;
  const nonConvergence = integer(candidateFailures['nonConvergence']);
  const residual = integer(candidateFailures['residualOptionsExhausted']);
  const anchorNonConvergence = integer(anchorFailures['nonConvergence']);
  const anchorResidual = integer(anchorFailures['residualOptionsExhausted']);
  const failures = nonConvergence <= anchorNonConvergence && residual <= anchorResidual &&
    (nonConvergence < anchorNonConvergence || residual < anchorResidual) &&
    amplifiedFailures['untypedFailures'] === 0 && amplifiedFailures['exactSafetyFailures'] === 0;
  const calls = list(result['callCases']).map(object);
  const timing = calls.every((metric) =>
    compareRational(rationalFromJson(metric['pairedDeltaMedian']), ZERO) <= 0 &&
    compareRational(rationalFromJson(metric['elapsedRatio']), ONE) <= 0);
  const speed = calls.filter((metric) =>
    ACCEPTED_HOTSPOT_CASE_IDS.includes(string(metric['caseId']) as typeof ACCEPTED_HOTSPOT_CASE_IDS[number]))
    .every((metric) => compareRational(rationalFromJson(metric['elapsedRatio']), NINE_TENTHS) <= 0);
  const deadlines = list(result['deadlineCases']).map(object);
  const deadlineNonregression = deadlines.every((metric) => {
    const anchor = object(metric['anchor']);
    const candidate = object(metric['candidate']);
    return integer(candidate['entryPlan']) >= integer(anchor['entryPlan']) &&
      integer(candidate['anchorQuality']) >= integer(anchor['anchorQuality']);
  });
  const events = list(result['instrumentedEvents']).map(object);
  const eventNonregression = events.every((metric) => {
    const paired = integer(metric['pairedFiniteCount']);
    return integer(metric['candidateAvailabilityCount']) >= integer(metric['anchorAvailabilityCount']) &&
      (paired === 0 || compareRational(rationalFromJson(metric['pairedFiniteMedianDelta']), ZERO) <= 0);
  });
  const strict = deadlines.some((metric) => {
    if (!ACCEPTED_HOTSPOT_CASE_IDS.includes(string(metric['caseId']) as typeof ACCEPTED_HOTSPOT_CASE_IDS[number])) return false;
    const anchor = object(metric['anchor']);
    const candidate = object(metric['candidate']);
    return integer(candidate['anchorQuality']) > integer(anchor['anchorQuality']);
  }) || events.some((metric) =>
    integer(metric['candidateAvailabilityCount']) > integer(metric['anchorAvailabilityCount']) ||
    integer(metric['pairedFiniteCount']) > 0 &&
      compareRational(rationalFromJson(metric['pairedFiniteMedianDelta']), ZERO) < 0);
  const passes = Object.freeze([fresh, full, failures, timing, speed, deadlineNonregression && eventNonregression && strict]);
  const evidenceHash = hashAcceptedJson(result);
  return Object.freeze({
    policyId: result['policyId'] ?? null,
    clauseResults: Object.freeze(ACCEPTED_CLAUSE_IDS.map((clauseId, index) => Object.freeze({
      clauseId,
      passed: passes[index] ?? false,
      policyEvidenceHash: evidenceHash,
    }))),
    qualifies: passes.every(Boolean),
  });
}

export function compareAcceptedPolicyResults(left: AcceptedJsonObject, right: AcceptedJsonObject): number {
  const leftRanking = object(left['rankingValues']);
  const rightRanking = object(right['rankingValues']);
  let compared = compareRational(
    rationalFromJson(leftRanking['worstHotspotElapsedRatio']),
    rationalFromJson(rightRanking['worstHotspotElapsedRatio']),
  );
  if (compared !== 0) return compared;
  const leftVector = list(leftRanking['anchorQualityVector']);
  const rightVector = list(rightRanking['anchorQualityVector']);
  if (leftVector.length !== rightVector.length) throw new TypeError('Accepted ranking vector length differs.');
  for (let index = 0; index < leftVector.length; index += 1) {
    const difference = integer(rightVector[index]) - integer(leftVector[index]);
    if (difference !== 0) return difference;
  }
  compared = positiveInteger(leftRanking['mappedShareActionCeiling']) -
    positiveInteger(rightRanking['mappedShareActionCeiling']);
  if (compared !== 0) return compared;
  return integer(leftRanking['policyMatrixIndex']) - integer(rightRanking['policyMatrixIndex']);
}

export function decideAcceptedPolicy(
  results: readonly AcceptedJsonObject[],
  qualifiers: readonly AcceptedJsonObject[],
): AcceptedJsonObject {
  const qualifyingIds = new Set(qualifiers
    .filter((value) => value['qualifies'] === true)
    .map((value) => string(value['policyId'])));
  const ranked = results.filter((value) => qualifyingIds.has(string(value['policyId'])))
    .sort(compareAcceptedPolicyResults)
    .map((value) => string(value['policyId']));
  const selected = ranked[0];
  return selected === undefined
    ? Object.freeze({
      status: 'strict-reference-fallback',
      policyId: null,
      fallbackDecisionId: 'strict-reference-fallback',
      rankedQualifyingPolicyIds: Object.freeze([]),
      reason: 'trustworthy-complete-no-policy-qualified',
    })
    : Object.freeze({
      status: 'selected-policy',
      policyId: selected,
      fallbackDecisionId: null,
      rankedQualifyingPolicyIds: Object.freeze(ranked),
      reason: 'highest-ranked-qualifying-policy',
    });
}

function descriptor(value: AcceptedArtifactDescriptor): AcceptedJsonObject {
  return Object.freeze({ path: value.path, bytes: value.bytes, sha256: value.sha256 });
}

export function buildAcceptedAnalysis(
  accumulator: AcceptedAnalysisAccumulator,
  config: AcceptedJsonObject,
  closure: AcceptedAnalysisClosure,
  descriptors: AcceptedAnalysisDescriptors,
  environment: AcceptedJsonObject,
): AcceptedJsonObject {
  const policyResults = ACCEPTED_POLICY_IDS.map((_, policyIndex) =>
    buildPolicyResult(accumulator, config, policyIndex));
  const qualifiers = policyResults.slice(1).map(qualifyAcceptedPolicy);
  const acceptedBaseRevision = string(config['acceptedBaseRevision']);
  if (!/^[0-9a-f]{40}$/u.test(acceptedBaseRevision) ||
    !/^[0-9a-f]{40}$/u.test(closure.implementationInputRevision)) {
    throw new TypeError('Accepted analysis revision is invalid.');
  }
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-analysis.v1',
    experimentId: 'm7c-core12-service-fast-numerical-v1',
    inputBinding: Object.freeze({
      acceptedBaseRevision,
      implementationInputRevision: closure.implementationInputRevision,
      config: descriptor(descriptors.config),
      artifactSchema: descriptor(descriptors.artifactSchema),
      sourceClosure: descriptor(descriptors.sourceClosure),
      inputArtifact: descriptor(descriptors.inputArtifact),
    }),
    sourceClosure: descriptor(descriptors.sourceClosure),
    environment,
    populations: Object.freeze({
      fullSemanticCells: ACCEPTED_CASE_IDS.length * 396,
      serviceSemanticCells: 1_188,
      amplifiedSemanticCells: 396,
      operationalCells: 252,
      policyCount: ACCEPTED_POLICY_IDS.length,
      semanticRecordCount: ACCEPTED_EXECUTION_SCHEDULE.semanticCalls,
      callRecordCount: ACCEPTED_EXECUTION_SCHEDULE.callRetained,
      timelineRecordCount: ACCEPTED_EXECUTION_SCHEDULE.timelineRetained,
      deadlineRecordCount: ACCEPTED_EXECUTION_SCHEDULE.deadlineRetained,
    }),
    integrity: Object.freeze({ status: 'passed', failures: Object.freeze([]) }),
    policyResults: Object.freeze(policyResults),
    qualifiers: Object.freeze(qualifiers),
    decision: decideAcceptedPolicy(policyResults, qualifiers),
    limitations: ACCEPTED_LIMITATIONS,
  });
}
