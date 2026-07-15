import {
  prepareServiceFastOperationalPolicy,
  runServiceFastOperationalPolicy,
  validateServiceFastCompleteOutcome,
  type ServiceFastExperimentCheckpoint,
  type ServiceFastExperimentCompleteOutcome,
} from '../evaluator-kernel.ts';
import {
  serviceFastExperimentReceiptsEqual,
} from '../exact-replay.ts';
import {
  SERVICE_FAST_POLICY_IDS,
} from './contract.ts';
import {
  integrityFailure,
  rejectServiceFastEvaluatorIntegrityFailure,
} from './failure.ts';
import { hashJson } from './hash-projections.ts';
import { scanCanonicalNdjson } from './io/ndjson-cursor.ts';
import {
  recordTimelineCausalityEnforcement,
} from './rules/enforcement.ts';
import type { RuleVerificationLedger } from './rules/types.ts';
import {
  callOnlySchedule,
  timelineSchedule,
  type CompleteScheduleItem,
} from './schedule.ts';
import {
  validateBoundRecord,
  type ArtifactSchemaProgram,
} from './schema/program.ts';
import type { RegeneratedSemanticCorpus } from './semantic-regeneration.ts';
import {
  requireString,
  type ArtifactDescriptor,
  type JsonObject,
} from './types.ts';

const OPERATIONAL_RECORD_BYTES = 16 * 1024;

export type OperationalRecordVisitor = (
  record: JsonObject,
) => void | Promise<void>;

function sameIdentity(
  retained: JsonObject,
  item: CompleteScheduleItem,
): boolean {
  const timingIndex = item.cell.input.timingCohortIndex;
  return retained['observationIndex'] === item.observationIndex &&
    retained['caseId'] === item.cell.input.caseId &&
    retained['requestId'] === item.cell.input.requestId &&
    retained['timingCohortIndex'] === timingIndex &&
    retained['sweepIndex'] === item.sweepIndex &&
    retained['policyId'] === SERVICE_FAST_POLICY_IDS[item.policyMatrixIndex] &&
    retained['policyMatrixIndex'] === item.policyMatrixIndex;
}

function validateComplete(
  item: CompleteScheduleItem,
  observer?: (checkpoint: ServiceFastExperimentCheckpoint) => boolean,
): ServiceFastExperimentCompleteOutcome {
  const semantic = item.cell.semanticOutcomes[item.policyMatrixIndex];
  if (semantic === undefined) return integrityFailure('cohort-mismatch');
  const call = prepareServiceFastOperationalPolicy(
    item.cell.cell,
    item.policyMatrixIndex,
  );
  const raw = runServiceFastOperationalPolicy(call, observer);
  if (raw.status === 'integrity-failure') {
    return rejectServiceFastEvaluatorIntegrityFailure(raw.code);
  }
  const validation = validateServiceFastCompleteOutcome(raw, semantic);
  if (!validation.ok) {
    if (validation.code === 'counter-invariant-failure') {
      return integrityFailure('counter-invariant-failure');
    }
    if (validation.code === 'semantic-anchor-parity-mismatch') {
      return integrityFailure('semantic-anchor-parity-mismatch');
    }
    return integrityFailure('exact-replay-mismatch');
  }
  return validation.value;
}

function expectedOutcomeHash(item: CompleteScheduleItem): string {
  const projection = item.cell.semanticProjections[item.policyMatrixIndex];
  if (projection === undefined) return integrityFailure('cohort-mismatch');
  return hashJson(projection);
}

export async function regenerateCallObservations(
  repositoryRoot: string,
  descriptor: ArtifactDescriptor,
  program: ArtifactSchemaProgram,
  semantic: RegeneratedSemanticCorpus,
  visitor?: OperationalRecordVisitor,
): Promise<void> {
  const schedule = callOnlySchedule(semantic.operationalCells);
  await scanCanonicalNdjson(
    repositoryRoot,
    descriptor,
    128 * 1024 * 1024,
    30_240,
    OPERATIONAL_RECORD_BYTES,
    async ({ index, value }) => {
      const retained = validateBoundRecord(
        program,
        'call-timing-observations.ndjson',
        value,
      );
      const item = schedule[index];
      if (item === undefined || !sameIdentity(retained, item)) {
        return integrityFailure('cohort-mismatch');
      }
      requireString(retained['elapsedNanoseconds']);
      const outcome = validateComplete(item);
      if (
        hashJson({
          entryIncumbentHash: item.cell.semanticProjections[item.policyMatrixIndex]?.['entryIncumbentHash'] ?? null,
          candidateSetDiagnostics: item.cell.semanticProjections[item.policyMatrixIndex]?.['candidateSetDiagnostics'] ?? null,
          finalIncumbent: item.cell.semanticProjections[item.policyMatrixIndex]?.['finalIncumbent'] ?? null,
          counters: item.cell.semanticProjections[item.policyMatrixIndex]?.['counters'] ?? null,
        }) !== expectedOutcomeHash(item) ||
        outcome.policy.policyIndex !== item.policyMatrixIndex ||
        retained['validatedOutcomeHash'] !== expectedOutcomeHash(item)
      ) {
        return integrityFailure('exact-replay-mismatch');
      }
      if (visitor !== undefined) await visitor(retained);
    },
  );
}

interface TimelinePresence {
  firstValid: boolean;
  firstImprovement: boolean;
  finalBest: boolean;
}

function finiteOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

export function admitTimelineCausality(
  record: JsonObject,
  ledger: RuleVerificationLedger,
): void {
  const values = [
    record['firstValidScoreNanoseconds'],
    record['firstStrictImprovementNanoseconds'],
    record['finalBestInstallNanoseconds'],
  ];
  if (values.some((value) => !finiteOrNull(value))) {
    return integrityFailure('clock-invariant-failure');
  }
  const finite = values.map((value) => value === null ? null : BigInt(value as string));
  const first = finite[0] ?? null;
  const improvement = finite[1] ?? null;
  const finalBest = finite[2] ?? null;
  if (
    finite.some((value) => value !== null && value < 0n) ||
    first !== null && improvement !== null && first > improvement ||
    improvement !== null && finalBest !== null && improvement > finalBest
  ) {
    return integrityFailure('clock-invariant-failure');
  }
  recordTimelineCausalityEnforcement(ledger);
}

export async function regenerateTimelineObservations(
  repositoryRoot: string,
  descriptor: ArtifactDescriptor,
  program: ArtifactSchemaProgram,
  semantic: RegeneratedSemanticCorpus,
  ledger: RuleVerificationLedger,
  visitor?: OperationalRecordVisitor,
): Promise<void> {
  const schedule = timelineSchedule(semantic.operationalCells);
  await scanCanonicalNdjson(
    repositoryRoot,
    descriptor,
    128 * 1024 * 1024,
    18_144,
    OPERATIONAL_RECORD_BYTES,
    async ({ index, value }) => {
      const retained = validateBoundRecord(
        program,
        'incumbent-timeline-observations.ndjson',
        value,
      );
      const item = schedule[index];
      if (item === undefined || !sameIdentity(retained, item)) {
        return integrityFailure('cohort-mismatch');
      }
      const semanticOutcome = item.cell.semanticOutcomes[item.policyMatrixIndex];
      if (semanticOutcome === undefined) return integrityFailure('cohort-mismatch');
      const hasCandidateFinal = semanticOutcome.diagnostics.some((diagnostic) =>
        diagnostic.status === 'improved');
      const seen: TimelinePresence = {
        firstValid: false,
        firstImprovement: false,
        finalBest: false,
      };
      const observe = (checkpoint: ServiceFastExperimentCheckpoint): boolean => {
        if (checkpoint.anyValidScore) seen.firstValid = true;
        if (checkpoint.anyImprovement) seen.firstImprovement = true;
        if (
          hasCandidateFinal && checkpoint.incumbent !== null &&
          semanticOutcome.finalIncumbent !== null &&
          serviceFastExperimentReceiptsEqual(
            checkpoint.incumbent,
            semanticOutcome.finalIncumbent,
          )
        ) {
          seen.finalBest = true;
        }
        return false;
      };
      const outcome = validateComplete(item, observe);
      // The accepted runner samples a terminal sentinel after the last action.
      if (outcome.anyValidScore) seen.firstValid = true;
      if (outcome.anyImprovement) seen.firstImprovement = true;
      if (
        hasCandidateFinal && outcome.finalIncumbent !== null &&
          semanticOutcome.finalIncumbent !== null &&
          serviceFastExperimentReceiptsEqual(
            outcome.finalIncumbent,
            semanticOutcome.finalIncumbent,
          )
      ) {
        seen.finalBest = true;
      }
      admitTimelineCausality(retained, ledger);
      const retainedPresence: TimelinePresence = {
        firstValid: retained['firstValidScoreNanoseconds'] !== null,
        firstImprovement:
          retained['firstStrictImprovementNanoseconds'] !== null,
        finalBest: retained['finalBestInstallNanoseconds'] !== null,
      };
      if (
        JSON.stringify(seen) !== JSON.stringify(retainedPresence) ||
        retained['validatedOutcomeHash'] !== expectedOutcomeHash(item)
      ) {
        return integrityFailure('exact-replay-mismatch');
      }
      if (visitor !== undefined) await visitor(retained);
    },
  );
}
