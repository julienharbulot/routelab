import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';
import {
  prepareServiceFastOperationalPolicy,
  runServiceFastOperationalPolicy,
  validateServiceFastCompleteOutcome,
  validateServiceFastDeadlinePrefix,
  type ServiceFastExperimentCandidateSetSnapshot,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentCounters,
  type ServiceFastExperimentOutcome,
  type ServiceFastExperimentRawCounters,
  type ServiceFastExperimentStoppedOutcome,
} from '../evaluator-kernel.ts';
import {
  serviceFastExperimentCompareReceipts,
  serviceFastExperimentReceiptHash,
} from '../exact-replay.ts';
import { SERVICE_FAST_POLICY_IDS } from './contract.ts';
import {
  integrityFailure,
  rejectServiceFastEvaluatorIntegrityFailure,
} from './failure.ts';
import { hashJson } from './hash-projections.ts';
import { scanCanonicalNdjson } from './io/ndjson-cursor.ts';
import { deadlineSchedule } from './schedule.ts';
import {
  validateBoundRecord,
  type ArtifactSchemaProgram,
} from './schema/program.ts';
import {
  projectCounterVector,
  projectIncumbentReference,
  projectScoreAttempt,
  type RegeneratedSemanticCorpus,
} from './semantic-regeneration.ts';
import {
  requireJsonArray,
  requireString,
  type ArtifactDescriptor,
  type JsonObject,
} from './types.ts';

const DEADLINE_RECORD_BYTES = 32 * 1024;

export type DeadlineRecordVisitor = (
  record: JsonObject,
) => void | Promise<void>;

export function deadlineCountersMatchTarget(
  counters: ServiceFastExperimentRawCounters,
  target: readonly number[],
): boolean {
  const values = [
    counters.methodActions,
    counters.outerUpdates,
    counters.shareActions,
    counters.reconstructionSteps,
    counters.residualReplays,
    counters.residualRejections,
    counters.repairReplays,
    counters.repairRejections,
    counters.authorizationReplays,
    counters.authorizationRejections,
    counters.proposals,
    counters.diagnostics,
  ];
  return values.every((value, index) =>
    index === 0 && value === null || value === target[index]);
}

function stage(
  snapshot: ServiceFastExperimentCandidateSetSnapshot,
): string {
  if (snapshot.stage === 'share' || snapshot.stage === 'proposal') {
    return 'proposal';
  }
  if (snapshot.stage === 'current') return 'current-score';
  return snapshot.stage;
}

function authorizationTranscript(
  snapshot: ServiceFastExperimentCandidateSetSnapshot,
): readonly JsonObject[] {
  const diagnostic = snapshot.terminalDiagnostic;
  if (
    diagnostic === null ||
    diagnostic.status !== 'improved' &&
      diagnostic.status !== 'authorization-rejected'
  ) {
    return Object.freeze([]);
  }
  const selected = diagnostic.selectedScore;
  if (selected === null) {
    throw new TypeError('Authorization selected score is absent.');
  }
  const accepted = diagnostic.status === 'improved';
  const mismatch = diagnostic.failureCode === 'authorization-mismatch';
  if (accepted && diagnostic.authorizationReceipt === null) {
    throw new TypeError('Accepted authorization receipt is absent.');
  }
  return Object.freeze([Object.freeze({
    attemptIndex: 0,
    allocation: Object.freeze(selected.allocations.map((allocation) =>
      allocation.toString(10))),
    status: accepted ? 'accepted' : mismatch ? 'mismatch' : 'rejected',
    failureCode: accepted
      ? null
      : mismatch
        ? 'authorization-mismatch'
        : 'authorization-rejected',
    receiptHash: accepted
      ? serviceFastExperimentReceiptHash(
        diagnostic.authorizationReceipt as ExactInputSplitReplayReceipt,
      )
      : null,
  })]);
}

function setState(
  snapshot: ServiceFastExperimentCandidateSetSnapshot,
): JsonObject {
  const current = Object.freeze(snapshot.currentAttempts.map(projectScoreAttempt));
  const repair = Object.freeze(
    (snapshot.repair?.attempts ?? []).map(projectScoreAttempt),
  );
  const authorization = authorizationTranscript(snapshot);
  const isTerminal = snapshot.stage === 'terminal';
  return Object.freeze({
    setIndex: snapshot.setIndex,
    stage: stage(snapshot),
    terminalStatus: isTerminal
      ? snapshot.terminalDiagnostic?.status ?? null
      : null,
    failureCode: isTerminal
      ? snapshot.terminalDiagnostic?.failureCode ?? null
      : snapshot.proposalFailure?.failureCode ?? null,
    currentScoreTranscriptHash: hashJson(current),
    repairScoreTranscriptHash: hashJson(repair),
    authorizationTranscriptHash: hashJson(authorization),
    counters: projectCounterVector(
      snapshot.counters as ServiceFastExperimentCounters,
    ),
  });
}

function atLeastAnchor(
  incumbent: ExactInputSplitReplayReceipt | null,
  anchor: ExactInputSplitReplayReceipt | null,
): boolean {
  if (anchor === null) return true;
  if (incumbent === null) return false;
  return serviceFastExperimentCompareReceipts(incumbent, anchor) <= 0;
}

function validatedOutcome(
  input: Parameters<typeof projectIncumbentReference>[0],
  outcome: ServiceFastExperimentCompleteOutcome | ServiceFastExperimentStoppedOutcome,
  termination: 'complete' | 'deadline' | 'work-limit',
  anchor: ServiceFastExperimentCompleteOutcome,
): Readonly<{
  readonly projection: JsonObject;
  readonly states: readonly JsonObject[];
}> {
  const states = Object.freeze(outcome.setSnapshots.map(setState));
  const projection: JsonObject = Object.freeze({
    termination,
    entryPlan: outcome.entryIncumbent !== null,
    anyValidScore: outcome.anyValidScore,
    anyImprovement: outcome.anyImprovement,
    anchorQuality: atLeastAnchor(
      outcome.finalIncumbent,
      anchor.finalIncumbent,
    ),
    completeStage: outcome.status === 'complete',
    incumbent: projectIncumbentReference(input, outcome),
    diagnosticStateHash: hashJson(states),
    counters: projectCounterVector(outcome.counters),
  });
  return Object.freeze({ projection, states });
}

function validationFailure(code: string): never {
  if (code === 'counter-invariant-failure') {
    return integrityFailure('counter-invariant-failure');
  }
  if (code === 'semantic-anchor-parity-mismatch') {
    return integrityFailure('semantic-anchor-parity-mismatch');
  }
  return integrityFailure('exact-replay-mismatch');
}

function runDeadlinePrefix(
  retained: JsonObject,
  item: ReturnType<typeof deadlineSchedule>[number],
): Readonly<{
  readonly outcome: ServiceFastExperimentCompleteOutcome |
    ServiceFastExperimentStoppedOutcome;
  readonly termination: 'complete' | 'deadline' | 'work-limit';
}> {
  const semantic = item.cell.semanticOutcomes[item.policyMatrixIndex];
  if (semantic === undefined) return integrityFailure('cohort-mismatch');
  const call = prepareServiceFastOperationalPolicy(
    item.cell.cell,
    item.policyMatrixIndex,
  );
  const expectedTermination = requireString(retained['termination']);
  const target = requireJsonArray(retained['counters']).map((value) => {
    if (typeof value !== 'number') return integrityFailure('artifact-shape-failure');
    return value;
  });
  const raw: ServiceFastExperimentOutcome = runServiceFastOperationalPolicy(
    call,
    expectedTermination === 'deadline'
      ? (checkpoint) => deadlineCountersMatchTarget(checkpoint.counters, target)
      : undefined,
  );
  if (raw.status === 'integrity-failure') {
    return rejectServiceFastEvaluatorIntegrityFailure(raw.code);
  }
  if (raw.status === 'complete') {
    const validation = validateServiceFastCompleteOutcome(raw, semantic);
    if (!validation.ok) return validationFailure(validation.code);
    return Object.freeze({ outcome: validation.value, termination: 'complete' });
  }
  const validation = validateServiceFastDeadlinePrefix(call, raw, semantic);
  if (!validation.ok) return validationFailure(validation.code);
  return Object.freeze({
    outcome: validation.value,
    termination: raw.reason === 'observer' ? 'deadline' : 'work-limit',
  });
}

function identityMatches(
  retained: JsonObject,
  item: ReturnType<typeof deadlineSchedule>[number],
): boolean {
  return retained['observationIndex'] === item.observationIndex &&
    retained['caseId'] === item.cell.input.caseId &&
    retained['requestId'] === item.cell.input.requestId &&
    retained['timingCohortIndex'] === item.cell.input.timingCohortIndex &&
    retained['deadlineIndex'] === item.deadlineIndex &&
    retained['deadlineMilliseconds'] === item.deadlineMilliseconds &&
    retained['sweepIndex'] === item.sweepIndex &&
    retained['policyId'] === SERVICE_FAST_POLICY_IDS[item.policyMatrixIndex] &&
    retained['policyMatrixIndex'] === item.policyMatrixIndex;
}

export function admitDeadlineElapsedNanoseconds(
  termination: string,
  elapsedNanosecondsValue: string,
  deadlineMilliseconds: number,
): bigint {
  const elapsedNanoseconds = BigInt(elapsedNanosecondsValue);
  if (
    elapsedNanoseconds < 0n ||
    !Number.isSafeInteger(deadlineMilliseconds) ||
    deadlineMilliseconds <= 0 ||
    termination === 'deadline' &&
      elapsedNanoseconds < BigInt(deadlineMilliseconds) * 1_000_000n
  ) {
    return integrityFailure('clock-invariant-failure');
  }
  return elapsedNanoseconds;
}

export async function regenerateDeadlineObservations(
  repositoryRoot: string,
  descriptor: ArtifactDescriptor,
  program: ArtifactSchemaProgram,
  semantic: RegeneratedSemanticCorpus,
  visitor?: DeadlineRecordVisitor,
): Promise<void> {
  const schedule = deadlineSchedule(semantic.operationalCells);
  await scanCanonicalNdjson(
    repositoryRoot,
    descriptor,
    256 * 1024 * 1024,
    108_864,
    DEADLINE_RECORD_BYTES,
    async ({ index, value }) => {
      const retained = validateBoundRecord(
        program,
        'deadline-observations.ndjson',
        value,
      );
      const item = schedule[index];
      if (item === undefined || !identityMatches(retained, item)) {
        return integrityFailure('cohort-mismatch');
      }
      const result = runDeadlinePrefix(retained, item);
      admitDeadlineElapsedNanoseconds(
        result.termination,
        requireString(retained['elapsedNanoseconds']),
        item.deadlineMilliseconds,
      );
      const anchor = item.cell.semanticOutcomes[0];
      if (anchor === undefined) return integrityFailure('cohort-mismatch');
      const wrapped = validatedOutcome(
        item.cell.input,
        result.outcome,
        result.termination,
        anchor,
      );
      const expectedFields = wrapped.projection;
      for (const [key, expected] of Object.entries(expectedFields)) {
        if (JSON.stringify(retained[key]) !== JSON.stringify(expected)) {
          return integrityFailure('exact-replay-mismatch');
        }
      }
      if (retained['validatedOutcomeHash'] !== hashJson(expectedFields)) {
        return integrityFailure('exact-replay-mismatch');
      }
      if (visitor !== undefined) await visitor(retained);
    },
  );
}
