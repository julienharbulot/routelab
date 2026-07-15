import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';
import {
  evaluateServiceFastSemanticPolicy,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentCandidateSetDiagnostic,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentCounters,
  type ServiceFastExperimentCurrentAttempt,
  type ServiceFastExperimentRepairAttempt,
  type ServiceFastExperimentScoreEvidence,
} from '../evaluator-kernel.ts';
import {
  serviceFastExperimentCompareReceipts,
  serviceFastExperimentReceiptHash,
} from '../exact-replay.ts';
import { encodeBinary64Bits } from '../input/codec.ts';
import { ServiceFastCellFactory, inputEntryIncumbent } from './cell-adapter.ts';
import {
  SERVICE_FAST_POLICY_IDS,
  serviceFastSemanticRecordCardinality,
  serviceFastSemanticRecordIndex,
} from './contract.ts';
import {
  integrityFailure,
  rejectServiceFastEvaluatorIntegrityFailure,
} from './failure.ts';
import { hashJson } from './hash-projections.ts';
import { scanCanonicalNdjson } from './io/ndjson-cursor.ts';
import {
  validateBoundRecord,
  type ArtifactSchemaProgram,
} from './schema/program.ts';
import {
  requireJsonArray,
  requireJsonObject,
  requireString,
  type ArtifactDescriptor,
  type DecodedExperimentInput,
  type JsonObject,
  type JsonValue,
} from './types.ts';
import type { ReplayedExperimentInputs } from './input-replay.ts';

const SEMANTIC_RECORD_BYTES = 6_961;

export interface OperationalSemanticCell {
  readonly input: DecodedExperimentInput;
  readonly cell: ServiceFastExperimentCell;
  readonly cellFactory: ServiceFastCellFactory;
  readonly semanticOutcomes: readonly ServiceFastExperimentCompleteOutcome[];
  readonly semanticProjections: readonly JsonObject[];
}

export interface RegeneratedSemanticCorpus {
  readonly operationalCells: ReadonlyMap<number, OperationalSemanticCell>;
}

export type SemanticRecordVisitor = (
  record: JsonObject,
  input: DecodedExperimentInput,
  outcome: ServiceFastExperimentCompleteOutcome,
  anchor: ServiceFastExperimentCompleteOutcome,
) => void | Promise<void>;

export function projectCounterVector(
  counters: ServiceFastExperimentCounters,
): readonly number[] {
  return Object.freeze([
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
  ]);
}

function objective(receipt: ExactInputSplitReplayReceipt | null): JsonObject {
  if (receipt === null) {
    return Object.freeze({
      hasPlan: false,
      amountOut: null,
      legCount: null,
      totalHops: null,
      routeKeys: Object.freeze([]),
      allocations: Object.freeze([]),
    });
  }
  return Object.freeze({
    hasPlan: true,
    amountOut: receipt.amountOut.toString(10),
    legCount: receipt.legs.length,
    totalHops: receipt.legs.reduce(
      (sum, leg) => sum + leg.receipt.hops.length,
      0,
    ),
    routeKeys: Object.freeze(receipt.legs.map((leg) => JSON.stringify(
      leg.receipt.hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]),
    ))),
    allocations: Object.freeze(receipt.legs.map((leg) =>
      leg.allocation.toString(10))),
  });
}

export function projectScoreAttempt(
  attempt: ServiceFastExperimentCurrentAttempt | ServiceFastExperimentRepairAttempt,
): JsonObject {
  const rejected = attempt.outcome === 'rejected';
  return Object.freeze({
    attemptIndex: attempt.attemptIndex,
    allocation: Object.freeze(attempt.allocations.map((allocation) =>
      allocation.toString(10))),
    status: rejected ? 'rejected' : 'valid',
    failureCode: rejected ? attempt.failureCode : null,
    receiptHash: attempt.receipt === null
      ? null
      : serviceFastExperimentReceiptHash(attempt.receipt),
  });
}

function scoreProjection(
  score: ServiceFastExperimentScoreEvidence | null,
  attempts: readonly ServiceFastExperimentCurrentAttempt[],
): JsonObject {
  const transcript = Object.freeze(attempts.map(projectScoreAttempt));
  if (score !== null) {
    return Object.freeze({
      status: 'valid',
      failureCode: null,
      selectedAttemptIndex: score.attemptIndex,
      receiptHash: score.receiptHash,
      scoreTranscriptHash: hashJson(transcript),
    });
  }
  if (attempts.length > 0) {
    return Object.freeze({
      status: 'rejected',
      failureCode: 'residual-options-exhausted',
      selectedAttemptIndex: null,
      receiptHash: null,
      scoreTranscriptHash: hashJson(transcript),
    });
  }
  return Object.freeze({
    status: 'not-run',
    failureCode: null,
    selectedAttemptIndex: null,
    receiptHash: null,
    scoreTranscriptHash: hashJson(transcript),
  });
}

function repairProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): JsonObject | null {
  const repair = diagnostic.repair;
  if (repair === null) return null;
  const transcript = Object.freeze(repair.attempts.map(projectScoreAttempt));
  return Object.freeze({
    status: repair.complete ? 'complete' : 'incomplete',
    attemptedNeighbors: repair.attempts.length,
    rejectedNeighbors: repair.attempts.filter((attempt) =>
      attempt.outcome === 'rejected').length,
    winnerAttemptIndex: repair.complete && repair.winner !== null
      ? repair.winner.attemptIndex
      : null,
    winnerReceiptHash: repair.complete && repair.winner !== null
      ? repair.winner.receiptHash
      : null,
    failureCode: repair.failureCode,
    scoreTranscriptHash: hashJson(transcript),
  });
}

function proposalProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): JsonObject | null {
  if (diagnostic.proposalFailure !== null) {
    return Object.freeze({
      status: 'failed',
      failureCode: diagnostic.proposalFailure.failureCode,
      converged: diagnostic.proposalFailure.converged,
      completedOuterIterations:
        diagnostic.proposalFailure.completedOuterUpdates,
      weightBits: null,
      reconstructionHash: null,
    });
  }
  const metadata = diagnostic.proposalMetadata;
  const reconstruction = diagnostic.reconstruction;
  if (metadata === null) return null;
  if (reconstruction === null) {
    throw new TypeError('Ready proposal reconstruction is absent.');
  }
  const reconstructionProjection = Object.freeze({
    integerWeights: Object.freeze(reconstruction.integerWeights.map((value) =>
      value.toString(10))),
    baseAllocations: Object.freeze(reconstruction.baseAllocations.map((value) =>
      value.toString(10))),
    residualUnits: reconstruction.residualUnits.toString(10),
  });
  return Object.freeze({
    status: 'ready',
    failureCode: null,
    converged: metadata.converged,
    completedOuterIterations: metadata.completedOuterUpdates,
    weightBits: Object.freeze(metadata.weights.map(encodeBinary64Bits)),
    reconstructionHash: hashJson(reconstructionProjection),
  });
}

function authorizationProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): JsonObject {
  if (diagnostic.status === 'improved') {
    if (diagnostic.authorizationReceipt === null) {
      throw new TypeError('Accepted authorization receipt is absent.');
    }
    return Object.freeze({
      status: 'accepted',
      receiptHash: serviceFastExperimentReceiptHash(
        diagnostic.authorizationReceipt,
      ),
      failureCode: null,
    });
  }
  if (diagnostic.status === 'authorization-rejected') {
    const mismatch = diagnostic.failureCode === 'authorization-mismatch';
    return Object.freeze({
      status: mismatch ? 'mismatch' : 'rejected',
      receiptHash: null,
      failureCode: mismatch
        ? 'authorization-mismatch'
        : 'authorization-rejected',
    });
  }
  return Object.freeze({
    status: 'not-attempted',
    receiptHash: null,
    failureCode: null,
  });
}

export function projectCandidateSetDiagnostic(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
  inputSet: JsonObject,
): JsonObject {
  return Object.freeze({
    setIndex: diagnostic.setIndex,
    resolutionStatus: requireString(inputSet['resolutionStatus']),
    terminalStatus: diagnostic.status,
    failureCode: diagnostic.failureCode,
    proposal: proposalProjection(diagnostic),
    currentScore: scoreProjection(
      diagnostic.currentScore,
      diagnostic.currentAttempts,
    ),
    repair: repairProjection(diagnostic),
    selectedScoreSource: diagnostic.selectedScore?.source ?? 'none',
    reconstructionDisposition: diagnostic.reconstructionDisposition,
    authorization: authorizationProjection(diagnostic),
    counters: projectCounterVector(
      diagnostic.counters as ServiceFastExperimentCounters,
    ),
  });
}

function entryReference(input: DecodedExperimentInput): JsonObject {
  const incumbent = inputEntryIncumbent(input);
  return Object.freeze({
    origin: 'entry-baseline',
    candidateSetIndex: null,
    selectedScoreSource: null,
    selectedAttemptIndex: null,
    objectiveHash: hashJson(requireJsonObject(incumbent['objective'])),
    receiptHash: incumbent['receiptHash'] as JsonValue,
  });
}

export function projectIncumbentReference(
  input: DecodedExperimentInput,
  outcome: Pick<ServiceFastExperimentCompleteOutcome,
    'diagnostics' | 'finalIncumbent'>,
): JsonObject {
  const installed = [...outcome.diagnostics].reverse().find((diagnostic) =>
    diagnostic.status === 'improved');
  if (installed === undefined) return entryReference(input);
  const selected = installed.selectedScore;
  const receipt = outcome.finalIncumbent;
  if (selected === null || receipt === null) {
    throw new TypeError('Installed incumbent evidence is absent.');
  }
  return Object.freeze({
    origin: 'candidate-set',
    candidateSetIndex: installed.setIndex,
    selectedScoreSource: selected.source,
    selectedAttemptIndex: selected.attemptIndex,
    objectiveHash: hashJson(objective(receipt)),
    receiptHash: serviceFastExperimentReceiptHash(receipt),
  });
}

function anchorComparison(
  anchor: ExactInputSplitReplayReceipt | null,
  policy: ExactInputSplitReplayReceipt | null,
): JsonObject {
  if (anchor === null && policy === null) {
    return Object.freeze({
      relation: 'both-no-plan',
      comparison: 'equal',
      anchorHasPlan: false,
      policyHasPlan: false,
    });
  }
  if (anchor === null) {
    return Object.freeze({
      relation: 'policy-plan-gained',
      comparison: 'policy-better',
      anchorHasPlan: false,
      policyHasPlan: true,
    });
  }
  if (policy === null) {
    return Object.freeze({
      relation: 'anchor-plan-lost',
      comparison: 'policy-worse',
      anchorHasPlan: true,
      policyHasPlan: false,
    });
  }
  const compared = serviceFastExperimentCompareReceipts(policy, anchor);
  return Object.freeze({
    relation: compared < 0
      ? 'policy-objective-strictly-better'
      : compared > 0
        ? 'policy-objective-strictly-worse'
        : 'objective-equal',
    comparison: compared < 0
      ? 'policy-better'
      : compared > 0
        ? 'policy-worse'
        : 'equal',
    anchorHasPlan: true,
    policyHasPlan: true,
  });
}

function exactRegret(
  anchor: ExactInputSplitReplayReceipt | null,
  policy: ExactInputSplitReplayReceipt | null,
): JsonObject {
  if (anchor === null) {
    return Object.freeze({
      outputDelta: null,
      bpsNumerator: null,
      bpsDenominator: null,
      integerBps: null,
    });
  }
  if (anchor.amountOut <= 0n) {
    throw new TypeError('Anchor output cannot be a rational denominator.');
  }
  const outputDelta = anchor.amountOut - (policy?.amountOut ?? 0n);
  const numerator = outputDelta * 10_000n;
  return Object.freeze({
    outputDelta: outputDelta.toString(10),
    bpsNumerator: numerator.toString(10),
    bpsDenominator: anchor.amountOut.toString(10),
    integerBps: (numerator / anchor.amountOut).toString(10),
  });
}

function projectDiagnostics(
  input: DecodedExperimentInput,
  outcome: ServiceFastExperimentCompleteOutcome,
): readonly JsonObject[] {
  const discovery = requireJsonObject(input.value['candidateDiscovery']);
  const inputSets = requireJsonArray(discovery['candidateSets']);
  if (inputSets.length !== outcome.diagnostics.length) {
    throw new TypeError('Candidate diagnostic count is invalid.');
  }
  return Object.freeze(outcome.diagnostics.map((diagnostic, index) => {
    const inputSet = inputSets[index];
    if (inputSet === undefined) throw new TypeError('Input candidate set is absent.');
    return projectCandidateSetDiagnostic(diagnostic, requireJsonObject(inputSet));
  }));
}

export function projectOperationalCompleteOutcome(
  input: DecodedExperimentInput,
  outcome: ServiceFastExperimentCompleteOutcome,
): JsonObject {
  return Object.freeze({
    entryIncumbentHash: hashJson(inputEntryIncumbent(input)),
    candidateSetDiagnostics: projectDiagnostics(input, outcome),
    finalIncumbent: projectIncumbentReference(input, outcome),
    counters: projectCounterVector(outcome.counters),
  });
}

export function projectSemanticRecord(
  input: DecodedExperimentInput,
  policyMatrixIndex: number,
  outcome: ServiceFastExperimentCompleteOutcome,
  anchor: ServiceFastExperimentCompleteOutcome,
): JsonObject {
  const withoutHash: JsonObject = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-semantic-result.v1',
    semanticIndex: serviceFastSemanticRecordIndex(
      input.sourceIndex,
      policyMatrixIndex,
    ),
    sourceIndex: input.sourceIndex,
    policyMatrixIndex,
    entryIncumbentHash: hashJson(inputEntryIncumbent(input)),
    candidateSetDiagnostics: projectDiagnostics(input, outcome),
    finalIncumbent: projectIncumbentReference(input, outcome),
    anchorComparison: anchorComparison(
      anchor.finalIncumbent,
      outcome.finalIncumbent,
    ),
    exactRegret: exactRegret(anchor.finalIncumbent, outcome.finalIncumbent),
    counters: projectCounterVector(outcome.counters),
  });
  return Object.freeze({
    ...withoutHash,
    semanticHash: hashJson(withoutHash),
  });
}

function requireComplete(
  outcome: ReturnType<typeof evaluateServiceFastSemanticPolicy>,
): ServiceFastExperimentCompleteOutcome {
  if (outcome.status === 'integrity-failure') {
    return rejectServiceFastEvaluatorIntegrityFailure(outcome.code);
  }
  if (outcome.status !== 'complete') {
    return integrityFailure('counter-invariant-failure');
  }
  return outcome;
}

export async function regenerateSemanticCorpus(
  repositoryRoot: string,
  descriptor: ArtifactDescriptor,
  program: ArtifactSchemaProgram,
  replayed: ReplayedExperimentInputs,
  visitor?: SemanticRecordVisitor,
): Promise<RegeneratedSemanticCorpus> {
  const semanticRecordCount = serviceFastSemanticRecordCardinality(
    replayed.records.length,
  );
  const factory = new ServiceFastCellFactory(replayed.source, replayed.operations);
  const operationalCells = new Map<number, OperationalSemanticCell>();
  let activeSourceIndex = -1;
  let activeInput: DecodedExperimentInput | undefined;
  let activeCell: ReturnType<ServiceFastCellFactory['prepare']> | undefined;
  let activeAnchor: ServiceFastExperimentCompleteOutcome | undefined;
  let activeOutcomes: ServiceFastExperimentCompleteOutcome[] = [];
  let activeProjections: JsonObject[] = [];

  await scanCanonicalNdjson(
    repositoryRoot,
    descriptor,
    256 * 1024 * 1024,
    semanticRecordCount,
    SEMANTIC_RECORD_BYTES,
    async ({ index, value }) => {
      const retained = validateBoundRecord(
        program,
        'semantic-results.ndjson',
        value,
      );
      const sourceIndex = Math.floor(index / SERVICE_FAST_POLICY_IDS.length);
      const policyIndex = index % SERVICE_FAST_POLICY_IDS.length;
      const input = replayed.records[sourceIndex];
      if (input === undefined) {
        return integrityFailure('artifact-shape-failure');
      }
      if (sourceIndex !== activeSourceIndex) {
        activeSourceIndex = sourceIndex;
        activeInput = input;
        activeCell = factory.prepare(input);
        activeAnchor = undefined;
        activeOutcomes = [];
        activeProjections = [];
      }
      if (activeInput !== input || activeCell === undefined) {
        return integrityFailure('cohort-mismatch');
      }
      const outcome = requireComplete(
        evaluateServiceFastSemanticPolicy(activeCell, policyIndex),
      );
      if (policyIndex === 0) activeAnchor = outcome;
      if (activeAnchor === undefined) {
        return integrityFailure('semantic-anchor-parity-mismatch');
      }
      const regenerated = projectSemanticRecord(
        input,
        policyIndex,
        outcome,
        activeAnchor,
      );
      if (JSON.stringify(retained) !== JSON.stringify(regenerated)) {
        return integrityFailure('exact-replay-mismatch');
      }
      if (visitor !== undefined) {
        await visitor(regenerated, input, outcome, activeAnchor);
      }
      if (input.timingCohortIndex !== null) {
        activeOutcomes.push(outcome);
        activeProjections.push(projectOperationalCompleteOutcome(input, outcome));
        if (policyIndex === SERVICE_FAST_POLICY_IDS.length - 1) {
          operationalCells.set(input.timingCohortIndex, Object.freeze({
            input,
            cell: activeCell,
            cellFactory: factory,
            semanticOutcomes: Object.freeze(activeOutcomes),
            semanticProjections: Object.freeze(activeProjections),
          }));
        }
      }
    },
  );
  if (operationalCells.size !== 252) {
    return integrityFailure('cohort-mismatch');
  }
  return Object.freeze({ operationalCells });
}
