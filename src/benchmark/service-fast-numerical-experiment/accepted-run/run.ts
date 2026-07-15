import {
  evaluateServiceFastSemanticPolicy,
  prepareServiceFastOperationalPolicy,
  runServiceFastOperationalPolicy,
  validateServiceFastCompleteOutcome,
  validateServiceFastDeadlinePrefix,
  type ServiceFastExperimentCheckpoint,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentOutcome,
  type ServiceFastExperimentStoppedOutcome,
} from '../evaluator-kernel.ts';
import { serviceFastExperimentReceiptsEqual } from '../exact-replay.ts';
import { AcceptedAnalysisAccumulator } from './analysis.ts';
import { sampleAcceptedOperationalClock } from './clock.ts';
import {
  ACCEPTED_EXECUTION_SCHEDULE,
  ACCEPTED_POLICY_IDS,
  type AcceptedJsonObject,
} from './contract.ts';
import {
  acceptedRunFailure,
  projectAcceptedRunFailure,
} from './failure.ts';
import type { AcceptedPreparedCell } from './input.ts';
import {
  defaultAcceptedPreflightDependencies,
  performAcceptedPreflight,
  type AcceptedPreflightResult,
} from './preflight.ts';
import {
  projectAcceptedDeadlineOutcome,
  projectAcceptedOperationalOutcome,
  projectAcceptedSemanticRecord,
  hashAcceptedJson,
} from './projection.ts';
import {
  abortAcceptedPublication,
  publishAcceptedArtifacts,
  type AcceptedPreparedArtifact,
} from './publication.ts';
import {
  acceptedCallProtocolSchedule,
  acceptedDeadlineProtocolSchedule,
  acceptedSemanticSchedule,
  acceptedTimelineSchedule,
  type AcceptedScheduleItem,
} from './schedule.ts';
import {
  AcceptedEvidenceSerializer,
  sealAcceptedEvidence,
} from './serialization.ts';

export const ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS =
  99_999_999_999_999_999_999n;

export interface AcceptedCandidateDependencies {
  readonly clock: () => bigint;
  readonly evaluateSemantic: typeof evaluateServiceFastSemanticPolicy;
  readonly prepareOperational: typeof prepareServiceFastOperationalPolicy;
  readonly runOperational: typeof runServiceFastOperationalPolicy;
  readonly validateComplete: typeof validateServiceFastCompleteOutcome;
  readonly validateDeadline: typeof validateServiceFastDeadlinePrefix;
}

export function defaultAcceptedCandidateDependencies(): AcceptedCandidateDependencies {
  return Object.freeze({
    clock: sampleAcceptedOperationalClock,
    evaluateSemantic: evaluateServiceFastSemanticPolicy,
    prepareOperational: prepareServiceFastOperationalPolicy,
    runOperational: runServiceFastOperationalPolicy,
    validateComplete: validateServiceFastCompleteOutcome,
    validateDeadline: validateServiceFastDeadlinePrefix,
  });
}

function candidateFailure(): never {
  throw acceptedRunFailure('candidate-unexpected');
}

function cellFor(
  preflight: AcceptedPreflightResult,
  item: AcceptedScheduleItem,
): AcceptedPreparedCell {
  const prepared = preflight.cells[item.cell.sourceIndex];
  if (prepared === undefined || prepared.input !== item.cell) return candidateFailure();
  return prepared;
}

function completeSemantic(
  outcome: ReturnType<typeof evaluateServiceFastSemanticPolicy>,
): ServiceFastExperimentCompleteOutcome {
  if (outcome.status !== 'complete') return candidateFailure();
  return outcome;
}

function elapsed(entry: bigint, returned: bigint): bigint {
  admitAcceptedClockSample(entry);
  admitAcceptedClockSample(returned);
  if (returned < entry) return candidateFailure();
  return returned - entry;
}

export function admitAcceptedClockSample(sample: bigint): bigint {
  if (sample < 0n || sample > ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS) {
    return candidateFailure();
  }
  return sample;
}

export function acceptedAbsoluteDeadline(
  entrySample: bigint,
  deadlineMilliseconds: number,
): bigint {
  admitAcceptedClockSample(entrySample);
  if (!Number.isSafeInteger(deadlineMilliseconds) || deadlineMilliseconds <= 0) {
    return candidateFailure();
  }
  return admitAcceptedClockSample(
    entrySample + BigInt(deadlineMilliseconds) * 1_000_000n,
  );
}

export function measureAcceptedInvocation<Value>(
  clock: () => bigint,
  work: (entrySample: bigint) => Value,
): Readonly<{
  readonly value: Value;
  readonly entrySample: bigint;
  readonly returnSample: bigint;
}> {
  const entrySample = admitAcceptedClockSample(clock());
  const value = work(entrySample);
  const returnSample = admitAcceptedClockSample(clock());
  elapsed(entrySample, returnSample);
  return Object.freeze({ value, entrySample, returnSample });
}

function completeOperational(
  dependencies: AcceptedCandidateDependencies,
  prepared: AcceptedPreparedCell,
  policyMatrixIndex: number,
  semantic: ServiceFastExperimentCompleteOutcome,
  observer?: (checkpoint: ServiceFastExperimentCheckpoint) => boolean,
): Readonly<{
  readonly outcome: ServiceFastExperimentCompleteOutcome;
  readonly entrySample: bigint;
  readonly returnSample: bigint;
  readonly raw: ServiceFastExperimentOutcome;
}> {
  const call = dependencies.prepareOperational(prepared.cell, policyMatrixIndex);
  const measured = measureAcceptedInvocation(
    dependencies.clock,
    () => dependencies.runOperational(call, observer),
  );
  const { value: raw, entrySample, returnSample } = measured;
  if (raw.status !== 'complete') return candidateFailure();
  const validated = dependencies.validateComplete(raw, semantic);
  if (!validated.ok) return candidateFailure();
  elapsed(entrySample, returnSample);
  return Object.freeze({ outcome: validated.value, entrySample, returnSample, raw });
}

function baseObservation(item: AcceptedScheduleItem): AcceptedJsonObject {
  if (item.observationIndex === null || item.cell.timingCohortIndex === null) {
    return candidateFailure();
  }
  return Object.freeze({
    observationIndex: item.observationIndex,
    caseId: item.cell.caseId,
    requestId: item.cell.requestId,
    timingCohortIndex: item.cell.timingCohortIndex,
    sweepIndex: item.sweepIndex,
    policyId: ACCEPTED_POLICY_IDS[item.policyMatrixIndex] ?? candidateFailure(),
    policyMatrixIndex: item.policyMatrixIndex,
  });
}

function requireSemantic(
  outcomes: ReadonlyMap<number, readonly ServiceFastExperimentCompleteOutcome[]>,
  item: AcceptedScheduleItem,
): ServiceFastExperimentCompleteOutcome {
  const value = outcomes.get(item.cell.sourceIndex)?.[item.policyMatrixIndex];
  return value ?? candidateFailure();
}

function requireExpectedHash(
  hashes: ReadonlyMap<number, readonly string[]>,
  item: AcceptedScheduleItem,
): string {
  return hashes.get(item.cell.sourceIndex)?.[item.policyMatrixIndex] ?? candidateFailure();
}

function validateOperationalProjection(
  item: AcceptedScheduleItem,
  outcome: ServiceFastExperimentCompleteOutcome,
  expectedHash: string,
): void {
  if (hashAcceptedJson(projectAcceptedOperationalOutcome(item.cell, outcome)) !== expectedHash) {
    candidateFailure();
  }
}

interface TimelineSamples {
  firstValid: bigint | null;
  firstImprovement: bigint | null;
  finalBest: bigint | null;
  last: bigint;
}

function timelineVisible(
  samples: TimelineSamples,
  checkpoint: Pick<ServiceFastExperimentCheckpoint, 'anyValidScore' | 'anyImprovement' | 'incumbent'>,
  sample: bigint,
  entry: bigint,
  semantic: ServiceFastExperimentCompleteOutcome,
  hasCandidateFinal: boolean,
): void {
  admitAcceptedClockSample(sample);
  if (sample < samples.last || sample < entry) candidateFailure();
  samples.last = sample;
  const relative = sample - entry;
  if (checkpoint.anyValidScore && samples.firstValid === null) samples.firstValid = relative;
  if (checkpoint.anyImprovement && samples.firstImprovement === null) {
    samples.firstImprovement = relative;
  }
  if (
    samples.finalBest === null && hasCandidateFinal && checkpoint.incumbent !== null &&
    semantic.finalIncumbent !== null &&
    serviceFastExperimentReceiptsEqual(checkpoint.incumbent, semantic.finalIncumbent)
  ) samples.finalBest = relative;
}

function admitTimelineOrder(samples: TimelineSamples): void {
  if (
    samples.firstValid !== null && samples.firstImprovement !== null &&
      samples.firstValid > samples.firstImprovement ||
    samples.firstImprovement !== null && samples.finalBest !== null &&
      samples.firstImprovement > samples.finalBest
  ) candidateFailure();
}

function deadlineRun(
  dependencies: AcceptedCandidateDependencies,
  prepared: AcceptedPreparedCell,
  item: AcceptedScheduleItem,
  semantic: ServiceFastExperimentCompleteOutcome,
): Readonly<{
  readonly outcome: ServiceFastExperimentCompleteOutcome |
    ServiceFastExperimentStoppedOutcome;
  readonly termination: 'complete' | 'deadline' | 'work-limit';
  readonly elapsedNanoseconds: bigint;
}> {
  const deadlineMilliseconds = item.deadlineMilliseconds;
  if (deadlineMilliseconds === null) return candidateFailure();
  const call = dependencies.prepareOperational(prepared.cell, item.policyMatrixIndex);
  const entrySample = admitAcceptedClockSample(dependencies.clock());
  const absoluteDeadline = acceptedAbsoluteDeadline(entrySample, deadlineMilliseconds);
  let lastSample = entrySample;
  const raw = dependencies.runOperational(call, () => {
    const sample = admitAcceptedClockSample(dependencies.clock());
    if (sample < lastSample) return candidateFailure();
    lastSample = sample;
    return sample >= absoluteDeadline;
  });
  const returnSample = admitAcceptedClockSample(dependencies.clock());
  if (returnSample < lastSample) return candidateFailure();
  const elapsedNanoseconds = elapsed(entrySample, returnSample);
  if (raw.status === 'integrity-failure') return candidateFailure();
  if (raw.status === 'complete') {
    const validated = dependencies.validateComplete(raw, semantic);
    if (!validated.ok) return candidateFailure();
    return Object.freeze({
      outcome: validated.value,
      termination: 'complete',
      elapsedNanoseconds,
    });
  }
  const validated = dependencies.validateDeadline(call, raw, semantic);
  if (!validated.ok) return candidateFailure();
  const termination = raw.reason === 'observer' ? 'deadline' : 'work-limit';
  if (
    termination === 'deadline' &&
    elapsedNanoseconds < BigInt(deadlineMilliseconds) * 1_000_000n
  ) return candidateFailure();
  return Object.freeze({ outcome: validated.value, termination, elapsedNanoseconds });
}

/** Execute the exact 237,600-call accepted schedule and seal all evidence in memory. @internal */
export function executeAcceptedCandidates(
  preflight: AcceptedPreflightResult,
  dependencies: AcceptedCandidateDependencies = defaultAcceptedCandidateDependencies(),
): readonly AcceptedPreparedArtifact[] {
  const accumulator = new AcceptedAnalysisAccumulator();
  const serializer = new AcceptedEvidenceSerializer();
  const semanticOutcomes = new Map<number, ServiceFastExperimentCompleteOutcome[]>();
  const semanticHashes = new Map<number, string[]>();
  let outerCalls = 0;
  let currentSourceIndex = -1;
  let currentAnchor: ServiceFastExperimentCompleteOutcome | undefined;
  try {
    for (const item of acceptedSemanticSchedule(preflight.records)) {
      const prepared = cellFor(preflight, item);
      if (item.cell.sourceIndex !== currentSourceIndex) {
        currentSourceIndex = item.cell.sourceIndex;
        currentAnchor = undefined;
      }
      const outcome = completeSemantic(
        dependencies.evaluateSemantic(prepared.cell, item.policyMatrixIndex),
      );
      outerCalls += 1;
      if (item.policyMatrixIndex === 0) currentAnchor = outcome;
      const anchor = currentAnchor ?? candidateFailure();
      const record = projectAcceptedSemanticRecord(
        item.cell,
        item.policyMatrixIndex,
        outcome,
        anchor,
      );
      serializer.appendSemantic(record);
      accumulator.acceptSemantic(record, item.cell);
      if (item.cell.timingCohortIndex !== null) {
        const outcomes = semanticOutcomes.get(item.cell.sourceIndex) ?? [];
        const hashes = semanticHashes.get(item.cell.sourceIndex) ?? [];
        outcomes[item.policyMatrixIndex] = outcome;
        hashes[item.policyMatrixIndex] = hashAcceptedJson(
          projectAcceptedOperationalOutcome(item.cell, outcome),
        );
        semanticOutcomes.set(item.cell.sourceIndex, outcomes);
        semanticHashes.set(item.cell.sourceIndex, hashes);
      }
    }

    for (const item of acceptedCallProtocolSchedule(preflight.records)) {
      const prepared = cellFor(preflight, item);
      const semantic = requireSemantic(semanticOutcomes, item);
      const result = completeOperational(
        dependencies,
        prepared,
        item.policyMatrixIndex,
        semantic,
      );
      outerCalls += 1;
      const expectedHash = requireExpectedHash(semanticHashes, item);
      validateOperationalProjection(item, result.outcome, expectedHash);
      if (item.phase === 'call-retained') {
        const record: AcceptedJsonObject = Object.freeze({
          schemaVersion: 'routelab.service-fast-numerical-call-timing-observation.v1',
          ...baseObservation(item),
          elapsedNanoseconds: elapsed(result.entrySample, result.returnSample).toString(10),
          validatedOutcomeHash: expectedHash,
        });
        serializer.appendCall(record);
        accumulator.acceptCall(record);
      }
    }

    for (const item of acceptedTimelineSchedule(preflight.records)) {
      const prepared = cellFor(preflight, item);
      const semantic = requireSemantic(semanticOutcomes, item);
      const call = dependencies.prepareOperational(prepared.cell, item.policyMatrixIndex);
      const entrySample = admitAcceptedClockSample(dependencies.clock());
      const samples: TimelineSamples = {
        firstValid: null,
        firstImprovement: null,
        finalBest: null,
        last: entrySample,
      };
      const hasCandidateFinal = semantic.diagnostics.some((diagnostic) =>
        diagnostic.status === 'improved');
      const raw = dependencies.runOperational(call, (checkpoint) => {
        timelineVisible(
          samples,
          checkpoint,
          admitAcceptedClockSample(dependencies.clock()),
          entrySample,
          semantic,
          hasCandidateFinal,
        );
        return false;
      });
      const returnSample = admitAcceptedClockSample(dependencies.clock());
      outerCalls += 1;
      if (raw.status !== 'complete') return candidateFailure();
      timelineVisible(
        samples,
        Object.freeze({
          anyValidScore: raw.anyValidScore,
          anyImprovement: raw.anyImprovement,
          incumbent: raw.finalIncumbent,
        }),
        returnSample,
        entrySample,
        semantic,
        hasCandidateFinal,
      );
      const validated = dependencies.validateComplete(raw, semantic);
      if (!validated.ok) return candidateFailure();
      admitTimelineOrder(samples);
      const expectedHash = requireExpectedHash(semanticHashes, item);
      validateOperationalProjection(item, validated.value, expectedHash);
      const record: AcceptedJsonObject = Object.freeze({
        schemaVersion: 'routelab.service-fast-numerical-incumbent-timeline-observation.v1',
        ...baseObservation(item),
        firstValidScoreNanoseconds: samples.firstValid?.toString(10) ?? null,
        firstStrictImprovementNanoseconds: samples.firstImprovement?.toString(10) ?? null,
        finalBestInstallNanoseconds: samples.finalBest?.toString(10) ?? null,
        validatedOutcomeHash: expectedHash,
      });
      serializer.appendTimeline(record);
      accumulator.acceptTimeline(record);
    }

    for (const item of acceptedDeadlineProtocolSchedule(preflight.records)) {
      const prepared = cellFor(preflight, item);
      const semantic = requireSemantic(semanticOutcomes, item);
      const anchor = semanticOutcomes.get(item.cell.sourceIndex)?.[0] ?? candidateFailure();
      const result = deadlineRun(dependencies, prepared, item, semantic);
      outerCalls += 1;
      const projection = projectAcceptedDeadlineOutcome(
        item.cell,
        result.outcome,
        result.termination,
        anchor,
      );
      if (item.phase === 'deadline-retained') {
        if (item.deadlineIndex === null || item.deadlineMilliseconds === null) {
          return candidateFailure();
        }
        const record: AcceptedJsonObject = Object.freeze({
          schemaVersion: 'routelab.service-fast-numerical-deadline-observation.v1',
          observationIndex: item.observationIndex,
          caseId: item.cell.caseId,
          requestId: item.cell.requestId,
          timingCohortIndex: item.cell.timingCohortIndex,
          deadlineIndex: item.deadlineIndex,
          deadlineMilliseconds: item.deadlineMilliseconds,
          sweepIndex: item.sweepIndex,
          policyId: ACCEPTED_POLICY_IDS[item.policyMatrixIndex] ?? candidateFailure(),
          policyMatrixIndex: item.policyMatrixIndex,
          elapsedNanoseconds: result.elapsedNanoseconds.toString(10),
          ...projection,
          validatedOutcomeHash: hashAcceptedJson(projection),
        });
        serializer.appendDeadline(record);
        accumulator.acceptDeadline(record);
      }
    }
    if (outerCalls !== ACCEPTED_EXECUTION_SCHEDULE.totalPolicyCalls) return candidateFailure();
  } catch (error) {
    throw projectAcceptedRunFailure(error, 'candidate-unexpected');
  }
  try {
    return sealAcceptedEvidence({ preflight, accumulator, serializer });
  } catch (error) {
    throw projectAcceptedRunFailure(error, 'serialization-unexpected');
  }
}

export interface AcceptedRunOrchestrationDependencies {
  readonly preflight: (repositoryRoot: string) => Promise<AcceptedPreflightResult>;
  readonly execute: (preflight: AcceptedPreflightResult) => readonly AcceptedPreparedArtifact[];
  readonly publish: typeof publishAcceptedArtifacts;
  readonly abort: typeof abortAcceptedPublication;
}

export function defaultAcceptedRunOrchestrationDependencies(
): AcceptedRunOrchestrationDependencies {
  return Object.freeze({
    preflight: (repositoryRoot: string) => performAcceptedPreflight(
      repositoryRoot,
      defaultAcceptedPreflightDependencies(),
    ),
    execute: executeAcceptedCandidates,
    publish: publishAcceptedArtifacts,
    abort: abortAcceptedPublication,
  });
}

/** Staging is unreachable until the candidate executor returns sealed artifacts. @internal */
export async function runAcceptedExperiment(
  repositoryRoot: string,
  dependencies: AcceptedRunOrchestrationDependencies =
    defaultAcceptedRunOrchestrationDependencies(),
): Promise<void> {
  const preflight = await dependencies.preflight(repositoryRoot);
  let artifacts: readonly AcceptedPreparedArtifact[];
  try {
    artifacts = dependencies.execute(preflight);
  } catch (error) {
    if (
      preflight.publication.released ||
      preflight.publication.committed
    ) throw error;
    return dependencies.abort(preflight.publication, error);
  }
  await dependencies.publish(preflight.publication, artifacts);
}
