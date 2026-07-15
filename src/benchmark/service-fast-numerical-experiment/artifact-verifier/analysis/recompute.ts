import {
  SERVICE_FAST_CASE_IDS,
  SERVICE_FAST_CLAUSE_IDS,
  SERVICE_FAST_DEADLINES_MS,
  SERVICE_FAST_HOTSPOT_CASE_IDS,
  SERVICE_FAST_LIMITATIONS,
  SERVICE_FAST_OPERATIONAL_CASE_IDS,
  SERVICE_FAST_POLICY_IDS,
} from '../contract.ts';
import { hashJson } from '../hash-projections.ts';
import type { AdmittedSourceClosure } from '../source-admission.ts';
import {
  requireJsonArray,
  requireJsonObject,
  requireSafeNonnegativeInteger,
  requireSafePositiveInteger,
  requireString,
  type ArtifactDescriptor,
  type EnvironmentValue,
  type ExactRationalValue,
  type JsonObject,
  type JsonValue,
} from '../types.ts';
import type {
  DeadlineCounts,
  MutableFailureCounts,
  ServiceFastAnalysisAccumulator,
} from './accumulator.ts';
import {
  compareRational,
  medianOfFive,
  medianRational,
  nullableMedianOfThree,
  rational,
  rationalJson,
} from './rational.ts';

const ZERO = rational(0n, 1n);
const ONE = rational(1n, 1n);
const NINE_TENTHS = rational(9n, 10n);

export interface AnalysisDescriptors {
  readonly config: ArtifactDescriptor;
  readonly artifactSchema: ArtifactDescriptor;
  readonly sourceClosure: ArtifactDescriptor;
  readonly inputArtifact: ArtifactDescriptor;
}

function descriptorJson(value: ArtifactDescriptor): JsonObject {
  return Object.freeze({
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
  });
}

function key(...values: readonly (string | number)[]): string {
  return JSON.stringify(values);
}

function completeBigints(
  values: readonly (bigint | undefined)[],
  count: number,
): readonly bigint[] {
  if (values.length !== count || values.some((value) => value === undefined)) {
    throw new TypeError('Observation sweep is incomplete.');
  }
  return values as readonly bigint[];
}

function completeNullableBigints(
  values: readonly (bigint | null | undefined)[],
): readonly (bigint | null)[] {
  if (values.length !== 3 || values.some((value) => value === undefined)) {
    throw new TypeError('Timeline sweep is incomplete.');
  }
  return values as readonly (bigint | null)[];
}

function callCaseMetric(
  accumulator: ServiceFastAnalysisAccumulator,
  policyIndex: number,
  caseId: string,
): Readonly<{ readonly json: JsonObject; readonly ratio: ExactRationalValue }> {
  const candidateMedians: bigint[] = [];
  const anchorMedians: bigint[] = [];
  const deltas: bigint[] = [];
  const timingIndexes = [...accumulator.callSweeps.keys()]
    .map((encoded) => JSON.parse(encoded) as [number, string, number])
    .filter(([index, candidateCase]) => index === policyIndex && candidateCase === caseId)
    .map(([, , timingIndex]) => timingIndex)
    .sort((left, right) => left - right);
  for (const timingIndex of timingIndexes) {
    const candidate = accumulator.callSweeps.get(key(policyIndex, caseId, timingIndex));
    const anchor = accumulator.callSweeps.get(key(0, caseId, timingIndex));
    if (candidate === undefined || anchor === undefined) {
      throw new TypeError('Paired call observation is absent.');
    }
    const candidateMedian = medianOfFive(completeBigints(candidate, 5));
    const anchorMedian = medianOfFive(completeBigints(anchor, 5));
    candidateMedians.push(candidateMedian);
    anchorMedians.push(anchorMedian);
    deltas.push(candidateMedian - anchorMedian);
  }
  if (timingIndexes.length === 0 || new Set(timingIndexes).size !== timingIndexes.length) {
    throw new TypeError('Call case population is invalid.');
  }
  const anchorSum = anchorMedians.reduce((sum, value) => sum + value, 0n);
  const candidateSum = candidateMedians.reduce((sum, value) => sum + value, 0n);
  if (anchorSum <= 0n) throw new TypeError('Anchor elapsed denominator is invalid.');
  const deltaMedian = medianRational(deltas);
  const ratio = rational(candidateSum, anchorSum);
  return Object.freeze({
    ratio,
    json: Object.freeze({
      caseId,
      pairedDeltaMedian: rationalJson(deltaMedian),
      elapsedRatio: rationalJson(ratio),
    }),
  });
}

const EVENT_FIELDS = Object.freeze([
  Object.freeze({
    field: 'firstStrictImprovementNanoseconds',
    event: 'first-exact-authorization-strictly-improving-entry-incumbent',
  }),
  Object.freeze({
    field: 'finalBestInstallNanoseconds',
    event: 'final-best-incumbent-first-installed',
  }),
] as const);

function eventMetric(
  accumulator: ServiceFastAnalysisAccumulator,
  policyIndex: number,
  caseId: string,
  field: typeof EVENT_FIELDS[number]['field'],
  event: typeof EVENT_FIELDS[number]['event'],
): JsonObject {
  const timingIndexes = [...accumulator.timelineSweeps.keys()]
    .map((encoded) => JSON.parse(encoded) as [number, string, number, string])
    .filter(([index, candidateCase, , candidateField]) =>
      index === policyIndex && candidateCase === caseId && candidateField === field)
    .map(([, , timingIndex]) => timingIndex)
    .sort((left, right) => left - right);
  let anchorAvailabilityCount = 0;
  let candidateAvailabilityCount = 0;
  const paired: bigint[] = [];
  for (const timingIndex of timingIndexes) {
    const candidate = accumulator.timelineSweeps.get(
      key(policyIndex, caseId, timingIndex, field),
    );
    const anchor = accumulator.timelineSweeps.get(key(0, caseId, timingIndex, field));
    if (candidate === undefined || anchor === undefined) {
      throw new TypeError('Paired timeline observation is absent.');
    }
    const candidateMedian = nullableMedianOfThree(completeNullableBigints(candidate));
    const anchorMedian = nullableMedianOfThree(completeNullableBigints(anchor));
    if (anchorMedian !== null) anchorAvailabilityCount += 1;
    if (candidateMedian !== null) candidateAvailabilityCount += 1;
    if (anchorMedian !== null && candidateMedian !== null) {
      paired.push(candidateMedian - anchorMedian);
    }
  }
  if (timingIndexes.length === 0 || new Set(timingIndexes).size !== timingIndexes.length) {
    throw new TypeError('Timeline event population is invalid.');
  }
  return Object.freeze({
    caseId,
    event,
    anchorAvailabilityCount,
    candidateAvailabilityCount,
    pairedFiniteCount: paired.length,
    pairedFiniteMedianDelta: paired.length === 0
      ? null
      : rationalJson(medianRational(paired)),
  });
}

function frozenCounts(counts: DeadlineCounts): JsonObject {
  return Object.freeze({ ...counts });
}

function deadlineMetric(
  accumulator: ServiceFastAnalysisAccumulator,
  policyIndex: number,
  caseId: string,
  deadlineMilliseconds: number,
): JsonObject {
  const anchor = accumulator.deadline.get(key(0, caseId, deadlineMilliseconds));
  const candidate = accumulator.deadline.get(
    key(policyIndex, caseId, deadlineMilliseconds),
  );
  if (anchor === undefined || candidate === undefined) {
    throw new TypeError('Deadline count cell is absent.');
  }
  return Object.freeze({
    caseId,
    deadlineMilliseconds,
    anchor: frozenCounts(anchor),
    candidate: frozenCounts(candidate),
  });
}

function failureJson(counts: MutableFailureCounts): JsonObject {
  return Object.freeze({ ...counts });
}

function driverContract(config: JsonObject, policyId: string): Readonly<{
  readonly driverId: string;
  readonly maximumShareActions: number;
}> {
  const policyMatrix = requireJsonObject(config['policyMatrix']);
  const driverId = policyId.split('--')[0];
  if (driverId === undefined) throw new TypeError('Policy driver is absent.');
  const driver = requireJsonArray(policyMatrix['drivers'])
    .map(requireJsonObject)
    .find((candidate) => candidate['driverId'] === driverId);
  if (driver === undefined) throw new TypeError('Policy driver is unbound.');
  return Object.freeze({
    driverId,
    maximumShareActions: requireSafePositiveInteger(
      driver['maximumShareActions'],
    ),
  });
}

function maximumRatio(values: readonly ExactRationalValue[]): ExactRationalValue {
  const first = values[0];
  if (first === undefined) throw new TypeError('Ratio population is empty.');
  return values.slice(1).reduce((maximum, value) =>
    compareRational(value, maximum) > 0 ? value : maximum, first);
}

interface BuiltPolicyResult {
  readonly json: JsonObject;
  readonly ratios: ReadonlyMap<string, ExactRationalValue>;
}

function buildPolicyResult(
  accumulator: ServiceFastAnalysisAccumulator,
  config: JsonObject,
  policyIndex: number,
): BuiltPolicyResult {
  const policyId = SERVICE_FAST_POLICY_IDS[policyIndex];
  const semantic = accumulator.semantic[policyIndex];
  if (policyId === undefined || semantic === undefined) {
    throw new TypeError('Policy result index is invalid.');
  }
  const driver = driverContract(config, policyId);
  const ratios = new Map<string, ExactRationalValue>();
  const callCases = SERVICE_FAST_OPERATIONAL_CASE_IDS.map((caseId) => {
    const metric = callCaseMetric(accumulator, policyIndex, caseId);
    ratios.set(caseId, metric.ratio);
    return metric.json;
  });
  const instrumentedEvents = SERVICE_FAST_HOTSPOT_CASE_IDS.flatMap((caseId) =>
    EVENT_FIELDS.map(({ field, event }) =>
      eventMetric(accumulator, policyIndex, caseId, field, event)));
  const deadlineCases = SERVICE_FAST_OPERATIONAL_CASE_IDS.flatMap((caseId) =>
    SERVICE_FAST_DEADLINES_MS.map((deadlineMilliseconds) =>
      deadlineMetric(accumulator, policyIndex, caseId, deadlineMilliseconds)));
  const anchorQualityVector = deadlineCases.map((value) => {
    const candidate = requireJsonObject(value['candidate']);
    return requireSafeNonnegativeInteger(candidate['anchorQuality']);
  });
  const hotspotRatios = SERVICE_FAST_HOTSPOT_CASE_IDS.map((caseId) => {
    const ratio = ratios.get(caseId);
    if (ratio === undefined) throw new TypeError('Hotspot ratio is absent.');
    return ratio;
  });
  const rankingValues = Object.freeze({
    worstHotspotElapsedRatio: rationalJson(maximumRatio(hotspotRatios)),
    anchorQualityVector: Object.freeze(anchorQualityVector),
    mappedShareActionCeiling: driver.maximumShareActions,
    policyMatrixIndex: policyIndex,
  });
  const anchorService = accumulator.semantic[0]?.serviceFailures;
  if (anchorService === undefined) throw new TypeError('Anchor semantic metrics are absent.');
  return Object.freeze({
    ratios,
    json: Object.freeze({
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
        anchorServiceFailures: failureJson(anchorService),
        candidateServiceFailures: failureJson(semantic.serviceFailures),
        amplifiedFailures: failureJson(semantic.amplifiedFailures),
      }),
      callCases: Object.freeze(callCases),
      instrumentedEvents: Object.freeze(instrumentedEvents),
      deadlineCases: Object.freeze(deadlineCases),
      rankingValues,
    }),
  });
}

function rationalFromJson(value: JsonValue | undefined): ExactRationalValue {
  const object = requireJsonObject(value);
  return rational(
    BigInt(requireString(object['numerator'])),
    BigInt(requireString(object['denominator'])),
  );
}

export function qualifyServiceFastPolicyResult(
  result: JsonObject,
): JsonObject {
  const semantic = requireJsonObject(result['semantic']);
  const anchorFailures = requireJsonObject(semantic['anchorServiceFailures']);
  const candidateFailures = requireJsonObject(semantic['candidateServiceFailures']);
  const amplifiedFailures = requireJsonObject(semantic['amplifiedFailures']);
  const fresh = semantic['invalidFreshReplayCount'] === 0 &&
    semantic['forcedFailureIncumbentMismatchCount'] === 0 &&
    amplifiedFailures['untypedFailures'] === 0 &&
    amplifiedFailures['exactSafetyFailures'] === 0;
  const fullSemantic = semantic['finalObjectivesNeverWorse'] === true &&
    semantic['anchorPlanLostCount'] === 0 &&
    semantic['unterminatedDiagnosticCount'] === 0;
  const nonConvergence = requireSafeNonnegativeInteger(
    candidateFailures['nonConvergence'],
  );
  const anchorNonConvergence = requireSafeNonnegativeInteger(
    anchorFailures['nonConvergence'],
  );
  const residual = requireSafeNonnegativeInteger(
    candidateFailures['residualOptionsExhausted'],
  );
  const anchorResidual = requireSafeNonnegativeInteger(
    anchorFailures['residualOptionsExhausted'],
  );
  const failures = nonConvergence <= anchorNonConvergence &&
    residual <= anchorResidual &&
    (nonConvergence < anchorNonConvergence || residual < anchorResidual) &&
    amplifiedFailures['untypedFailures'] === 0 &&
    amplifiedFailures['exactSafetyFailures'] === 0;
  const calls = requireJsonArray(result['callCases']).map(requireJsonObject);
  const timing = calls.every((metric) =>
    compareRational(rationalFromJson(metric['pairedDeltaMedian']), ZERO) <= 0 &&
    compareRational(rationalFromJson(metric['elapsedRatio']), ONE) <= 0);
  const speed = calls
    .filter((metric) => SERVICE_FAST_HOTSPOT_CASE_IDS.includes(
      requireString(metric['caseId']) as typeof SERVICE_FAST_HOTSPOT_CASE_IDS[number],
    ))
    .every((metric) =>
      compareRational(rationalFromJson(metric['elapsedRatio']), NINE_TENTHS) <= 0);
  const deadlines = requireJsonArray(result['deadlineCases']).map(requireJsonObject);
  const deadlineNonregression = deadlines.every((metric) => {
    const anchor = requireJsonObject(metric['anchor']);
    const candidate = requireJsonObject(metric['candidate']);
    return requireSafeNonnegativeInteger(candidate['entryPlan']) >=
        requireSafeNonnegativeInteger(anchor['entryPlan']) &&
      requireSafeNonnegativeInteger(candidate['anchorQuality']) >=
        requireSafeNonnegativeInteger(anchor['anchorQuality']);
  });
  const events = requireJsonArray(result['instrumentedEvents']).map(requireJsonObject);
  const eventNonregression = events.every((metric) => {
    const paired = requireSafeNonnegativeInteger(metric['pairedFiniteCount']);
    return requireSafeNonnegativeInteger(metric['candidateAvailabilityCount']) >=
        requireSafeNonnegativeInteger(metric['anchorAvailabilityCount']) &&
      (paired === 0 || compareRational(
        rationalFromJson(metric['pairedFiniteMedianDelta']),
        ZERO,
      ) <= 0);
  });
  const strict = deadlines.some((metric) => {
    if (!SERVICE_FAST_HOTSPOT_CASE_IDS.includes(
      requireString(metric['caseId']) as typeof SERVICE_FAST_HOTSPOT_CASE_IDS[number],
    )) return false;
    const anchor = requireJsonObject(metric['anchor']);
    const candidate = requireJsonObject(metric['candidate']);
    return requireSafeNonnegativeInteger(candidate['anchorQuality']) >
      requireSafeNonnegativeInteger(anchor['anchorQuality']);
  }) || events.some((metric) =>
    requireSafeNonnegativeInteger(metric['candidateAvailabilityCount']) >
      requireSafeNonnegativeInteger(metric['anchorAvailabilityCount']) ||
    requireSafeNonnegativeInteger(metric['pairedFiniteCount']) > 0 &&
      compareRational(
        rationalFromJson(metric['pairedFiniteMedianDelta']),
        ZERO,
      ) < 0);
  const passes = Object.freeze([
    fresh,
    fullSemantic,
    failures,
    timing,
    speed,
    deadlineNonregression && eventNonregression && strict,
  ]);
  const evidenceHash = hashJson(result);
  const clauseResults = SERVICE_FAST_CLAUSE_IDS.map((clauseId, index) =>
    Object.freeze({
      clauseId,
      passed: passes[index] ?? false,
      policyEvidenceHash: evidenceHash,
    }));
  return Object.freeze({
    policyId: result['policyId'] as JsonValue,
    clauseResults: Object.freeze(clauseResults),
    qualifies: passes.every(Boolean),
  });
}

export function compareServiceFastPolicyResults(
  left: JsonObject,
  right: JsonObject,
): number {
  const leftRanking = requireJsonObject(left['rankingValues']);
  const rightRanking = requireJsonObject(right['rankingValues']);
  let compared = compareRational(
    rationalFromJson(leftRanking['worstHotspotElapsedRatio']),
    rationalFromJson(rightRanking['worstHotspotElapsedRatio']),
  );
  if (compared !== 0) return compared;
  const leftVector = requireJsonArray(leftRanking['anchorQualityVector']);
  const rightVector = requireJsonArray(rightRanking['anchorQualityVector']);
  for (let index = 0; index < leftVector.length; index += 1) {
    const leftValue = requireSafeNonnegativeInteger(leftVector[index]);
    const rightValue = requireSafeNonnegativeInteger(rightVector[index]);
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  compared = requireSafePositiveInteger(leftRanking['mappedShareActionCeiling']) -
    requireSafePositiveInteger(rightRanking['mappedShareActionCeiling']);
  if (compared !== 0) return compared;
  return requireSafeNonnegativeInteger(leftRanking['policyMatrixIndex']) -
    requireSafeNonnegativeInteger(rightRanking['policyMatrixIndex']);
}

export function decideServiceFastPolicy(
  results: readonly JsonObject[],
  qualifiers: readonly JsonObject[],
): JsonObject {
  const qualifyingIds = new Set(qualifiers
    .filter((value) => value['qualifies'] === true)
    .map((value) => requireString(value['policyId'])));
  const ranked = results
    .filter((value) => qualifyingIds.has(requireString(value['policyId'])))
    .sort(compareServiceFastPolicyResults)
    .map((value) => requireString(value['policyId']));
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

export function recomputeAnalysis(
  accumulator: ServiceFastAnalysisAccumulator,
  config: JsonObject,
  closure: AdmittedSourceClosure,
  descriptors: AnalysisDescriptors,
  retainedEnvironment: EnvironmentValue,
): JsonObject {
  const policyResults = SERVICE_FAST_POLICY_IDS.map((_, policyIndex) =>
    buildPolicyResult(accumulator, config, policyIndex).json);
  const qualifiers = policyResults.slice(1).map(qualifyServiceFastPolicyResult);
  const acceptedBaseRevision = requireString(config['acceptedBaseRevision']);
  if (!/^[0-9a-f]{40}$/u.test(acceptedBaseRevision)) {
    throw new TypeError('Accepted base revision is invalid.');
  }
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-analysis.v1',
    experimentId: 'm7c-core12-service-fast-numerical-v1',
    inputBinding: Object.freeze({
      acceptedBaseRevision,
      implementationInputRevision: closure.implementationInputRevision,
      config: descriptorJson(descriptors.config),
      artifactSchema: descriptorJson(descriptors.artifactSchema),
      sourceClosure: descriptorJson(descriptors.sourceClosure),
      inputArtifact: descriptorJson(descriptors.inputArtifact),
    }),
    sourceClosure: descriptorJson(descriptors.sourceClosure),
    environment: retainedEnvironment,
    populations: Object.freeze({
      fullSemanticCells: SERVICE_FAST_CASE_IDS.length * 396,
      serviceSemanticCells: 1_188,
      amplifiedSemanticCells: 396,
      operationalCells: 252,
      policyCount: SERVICE_FAST_POLICY_IDS.length,
      semanticRecordCount: 38_016,
      callRecordCount: 30_240,
      timelineRecordCount: 18_144,
      deadlineRecordCount: 108_864,
    }),
    integrity: Object.freeze({ status: 'passed', failures: Object.freeze([]) }),
    policyResults: Object.freeze(policyResults),
    qualifiers: Object.freeze(qualifiers),
    decision: decideServiceFastPolicy(policyResults, qualifiers),
    limitations: SERVICE_FAST_LIMITATIONS,
  });
}
