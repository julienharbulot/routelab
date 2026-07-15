import { createHash } from 'node:crypto';

import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';
import {
  serviceFastExperimentCompareReceipts,
  serviceFastExperimentReceiptHash,
} from '../exact-replay.ts';
import { encodeBinary64Bits } from '../input/codec.ts';
import type {
  ServiceFastExperimentCandidateSetDiagnostic,
  ServiceFastExperimentCandidateSetSnapshot,
  ServiceFastExperimentCompleteOutcome,
  ServiceFastExperimentCounters,
  ServiceFastExperimentCurrentAttempt,
  ServiceFastExperimentRawCounters,
  ServiceFastExperimentRepairAttempt,
  ServiceFastExperimentScoreEvidence,
  ServiceFastExperimentStoppedOutcome,
} from '../evaluator-kernel.ts';
import {
  ACCEPTED_POLICY_IDS,
  type AcceptedInputRecord,
  type AcceptedJson,
  type AcceptedJsonObject,
} from './contract.ts';

function object(value: AcceptedJson | undefined): AcceptedJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Accepted projection object is invalid.');
  }
  return value as AcceptedJsonObject;
}

function list(value: AcceptedJson | undefined): readonly AcceptedJson[] {
  if (!Array.isArray(value)) throw new TypeError('Accepted projection array is invalid.');
  return value as readonly AcceptedJson[];
}

function string(value: AcceptedJson | undefined): string {
  if (typeof value !== 'string') throw new TypeError('Accepted projection string is invalid.');
  return value;
}

export function hashAcceptedJson(value: AcceptedJson): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

export function hashAcceptedBytes(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function projectAcceptedCounterVector(
  counters: ServiceFastExperimentCounters | ServiceFastExperimentRawCounters,
): readonly number[] {
  if (counters.methodActions === null) {
    throw new TypeError('Accepted projection requires classified method actions.');
  }
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

function inputEntryIncumbent(input: AcceptedInputRecord): AcceptedJsonObject {
  return object(object(input.value['entryBaseline'])['incumbent']);
}

function objective(receipt: ExactInputSplitReplayReceipt | null): AcceptedJsonObject {
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
    totalHops: receipt.legs.reduce((sum, leg) => sum + leg.receipt.hops.length, 0),
    routeKeys: Object.freeze(receipt.legs.map((leg) => JSON.stringify(
      leg.receipt.hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]),
    ))),
    allocations: Object.freeze(receipt.legs.map((leg) => leg.allocation.toString(10))),
  });
}

export function projectAcceptedScoreAttempt(
  attempt: ServiceFastExperimentCurrentAttempt | ServiceFastExperimentRepairAttempt,
): AcceptedJsonObject {
  const rejected = attempt.outcome === 'rejected';
  return Object.freeze({
    attemptIndex: attempt.attemptIndex,
    allocation: Object.freeze(attempt.allocations.map((allocation) => allocation.toString(10))),
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
): AcceptedJsonObject {
  const transcript = Object.freeze(attempts.map(projectAcceptedScoreAttempt));
  if (score !== null) {
    return Object.freeze({
      status: 'valid',
      failureCode: null,
      selectedAttemptIndex: score.attemptIndex,
      receiptHash: score.receiptHash,
      scoreTranscriptHash: hashAcceptedJson(transcript),
    });
  }
  if (attempts.length > 0) {
    return Object.freeze({
      status: 'rejected',
      failureCode: 'residual-options-exhausted',
      selectedAttemptIndex: null,
      receiptHash: null,
      scoreTranscriptHash: hashAcceptedJson(transcript),
    });
  }
  return Object.freeze({
    status: 'not-run',
    failureCode: null,
    selectedAttemptIndex: null,
    receiptHash: null,
    scoreTranscriptHash: hashAcceptedJson(transcript),
  });
}

function repairProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): AcceptedJsonObject | null {
  const repair = diagnostic.repair;
  if (repair === null) return null;
  const transcript = Object.freeze(repair.attempts.map(projectAcceptedScoreAttempt));
  return Object.freeze({
    status: repair.complete ? 'complete' : 'incomplete',
    attemptedNeighbors: repair.attempts.length,
    rejectedNeighbors: repair.attempts.filter((attempt) => attempt.outcome === 'rejected').length,
    winnerAttemptIndex: repair.complete && repair.winner !== null
      ? repair.winner.attemptIndex
      : null,
    winnerReceiptHash: repair.complete && repair.winner !== null
      ? repair.winner.receiptHash
      : null,
    failureCode: repair.failureCode,
    scoreTranscriptHash: hashAcceptedJson(transcript),
  });
}

function proposalProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): AcceptedJsonObject | null {
  if (diagnostic.proposalFailure !== null) {
    return Object.freeze({
      status: 'failed',
      failureCode: diagnostic.proposalFailure.failureCode,
      converged: diagnostic.proposalFailure.converged,
      completedOuterIterations: diagnostic.proposalFailure.completedOuterUpdates,
      weightBits: null,
      reconstructionHash: null,
    });
  }
  const metadata = diagnostic.proposalMetadata;
  const reconstruction = diagnostic.reconstruction;
  if (metadata === null) return null;
  if (reconstruction === null) throw new TypeError('Accepted ready reconstruction is absent.');
  const projected = Object.freeze({
    integerWeights: Object.freeze(reconstruction.integerWeights.map((value) => value.toString(10))),
    baseAllocations: Object.freeze(reconstruction.baseAllocations.map((value) => value.toString(10))),
    residualUnits: reconstruction.residualUnits.toString(10),
  });
  return Object.freeze({
    status: 'ready',
    failureCode: null,
    converged: metadata.converged,
    completedOuterIterations: metadata.completedOuterUpdates,
    weightBits: Object.freeze(metadata.weights.map(encodeBinary64Bits)),
    reconstructionHash: hashAcceptedJson(projected),
  });
}

function authorizationProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): AcceptedJsonObject {
  if (diagnostic.status === 'improved') {
    if (diagnostic.authorizationReceipt === null) {
      throw new TypeError('Accepted authorization receipt is absent.');
    }
    return Object.freeze({
      status: 'accepted',
      receiptHash: serviceFastExperimentReceiptHash(diagnostic.authorizationReceipt),
      failureCode: null,
    });
  }
  if (diagnostic.status === 'authorization-rejected') {
    const mismatch = diagnostic.failureCode === 'authorization-mismatch';
    return Object.freeze({
      status: mismatch ? 'mismatch' : 'rejected',
      receiptHash: null,
      failureCode: mismatch ? 'authorization-mismatch' : 'authorization-rejected',
    });
  }
  return Object.freeze({ status: 'not-attempted', receiptHash: null, failureCode: null });
}

export function projectAcceptedCandidateDiagnostic(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
  inputSet: AcceptedJsonObject,
): AcceptedJsonObject {
  return Object.freeze({
    setIndex: diagnostic.setIndex,
    resolutionStatus: string(inputSet['resolutionStatus']),
    terminalStatus: diagnostic.status,
    failureCode: diagnostic.failureCode,
    proposal: proposalProjection(diagnostic),
    currentScore: scoreProjection(diagnostic.currentScore, diagnostic.currentAttempts),
    repair: repairProjection(diagnostic),
    selectedScoreSource: diagnostic.selectedScore?.source ?? 'none',
    reconstructionDisposition: diagnostic.reconstructionDisposition,
    authorization: authorizationProjection(diagnostic),
    counters: projectAcceptedCounterVector(diagnostic.counters),
  });
}

function projectDiagnostics(
  input: AcceptedInputRecord,
  outcome: Pick<ServiceFastExperimentCompleteOutcome, 'diagnostics'>,
): readonly AcceptedJsonObject[] {
  const inputSets = list(object(input.value['candidateDiscovery'])['candidateSets']);
  if (inputSets.length !== outcome.diagnostics.length) {
    throw new TypeError('Accepted diagnostic count is invalid.');
  }
  return Object.freeze(outcome.diagnostics.map((diagnostic, index) => {
    const inputSet = inputSets[index];
    if (inputSet === undefined) throw new TypeError('Accepted input set is absent.');
    return projectAcceptedCandidateDiagnostic(diagnostic, object(inputSet));
  }));
}

function entryReference(input: AcceptedInputRecord): AcceptedJsonObject {
  const incumbent = inputEntryIncumbent(input);
  return Object.freeze({
    origin: 'entry-baseline',
    candidateSetIndex: null,
    selectedScoreSource: null,
    selectedAttemptIndex: null,
    objectiveHash: hashAcceptedJson(object(incumbent['objective'])),
    receiptHash: incumbent['receiptHash'] ?? null,
  });
}

export function projectAcceptedIncumbentReference(
  input: AcceptedInputRecord,
  outcome: Pick<ServiceFastExperimentCompleteOutcome, 'diagnostics' | 'finalIncumbent'>,
): AcceptedJsonObject {
  const installed = [...outcome.diagnostics].reverse().find((diagnostic) =>
    diagnostic.status === 'improved');
  if (installed === undefined) return entryReference(input);
  if (installed.selectedScore === null || outcome.finalIncumbent === null) {
    throw new TypeError('Accepted installed incumbent evidence is absent.');
  }
  return Object.freeze({
    origin: 'candidate-set',
    candidateSetIndex: installed.setIndex,
    selectedScoreSource: installed.selectedScore.source,
    selectedAttemptIndex: installed.selectedScore.attemptIndex,
    objectiveHash: hashAcceptedJson(objective(outcome.finalIncumbent)),
    receiptHash: serviceFastExperimentReceiptHash(outcome.finalIncumbent),
  });
}

function anchorComparison(
  anchor: ExactInputSplitReplayReceipt | null,
  policy: ExactInputSplitReplayReceipt | null,
): AcceptedJsonObject {
  if (anchor === null && policy === null) {
    return Object.freeze({ relation: 'both-no-plan', comparison: 'equal', anchorHasPlan: false, policyHasPlan: false });
  }
  if (anchor === null) {
    return Object.freeze({ relation: 'policy-plan-gained', comparison: 'policy-better', anchorHasPlan: false, policyHasPlan: true });
  }
  if (policy === null) {
    return Object.freeze({ relation: 'anchor-plan-lost', comparison: 'policy-worse', anchorHasPlan: true, policyHasPlan: false });
  }
  const compared = serviceFastExperimentCompareReceipts(policy, anchor);
  return Object.freeze({
    relation: compared < 0
      ? 'policy-objective-strictly-better'
      : compared > 0 ? 'policy-objective-strictly-worse' : 'objective-equal',
    comparison: compared < 0 ? 'policy-better' : compared > 0 ? 'policy-worse' : 'equal',
    anchorHasPlan: true,
    policyHasPlan: true,
  });
}

function exactRegret(
  anchor: ExactInputSplitReplayReceipt | null,
  policy: ExactInputSplitReplayReceipt | null,
): AcceptedJsonObject {
  if (anchor === null) {
    return Object.freeze({ outputDelta: null, bpsNumerator: null, bpsDenominator: null, integerBps: null });
  }
  if (anchor.amountOut <= 0n) throw new TypeError('Accepted anchor denominator is invalid.');
  const outputDelta = anchor.amountOut - (policy?.amountOut ?? 0n);
  const numerator = outputDelta * 10_000n;
  return Object.freeze({
    outputDelta: outputDelta.toString(10),
    bpsNumerator: numerator.toString(10),
    bpsDenominator: anchor.amountOut.toString(10),
    integerBps: (numerator / anchor.amountOut).toString(10),
  });
}

export function projectAcceptedOperationalOutcome(
  input: AcceptedInputRecord,
  outcome: ServiceFastExperimentCompleteOutcome,
): AcceptedJsonObject {
  return Object.freeze({
    entryIncumbentHash: hashAcceptedJson(inputEntryIncumbent(input)),
    candidateSetDiagnostics: projectDiagnostics(input, outcome),
    finalIncumbent: projectAcceptedIncumbentReference(input, outcome),
    counters: projectAcceptedCounterVector(outcome.counters),
  });
}

export function projectAcceptedSemanticRecord(
  input: AcceptedInputRecord,
  policyMatrixIndex: number,
  outcome: ServiceFastExperimentCompleteOutcome,
  anchor: ServiceFastExperimentCompleteOutcome,
): AcceptedJsonObject {
  if (ACCEPTED_POLICY_IDS[policyMatrixIndex] === undefined) {
    throw new TypeError('Accepted policy index is invalid.');
  }
  const withoutHash: AcceptedJsonObject = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-semantic-result.v1',
    semanticIndex: input.sourceIndex * ACCEPTED_POLICY_IDS.length + policyMatrixIndex,
    sourceIndex: input.sourceIndex,
    policyMatrixIndex,
    entryIncumbentHash: hashAcceptedJson(inputEntryIncumbent(input)),
    candidateSetDiagnostics: projectDiagnostics(input, outcome),
    finalIncumbent: projectAcceptedIncumbentReference(input, outcome),
    anchorComparison: anchorComparison(anchor.finalIncumbent, outcome.finalIncumbent),
    exactRegret: exactRegret(anchor.finalIncumbent, outcome.finalIncumbent),
    counters: projectAcceptedCounterVector(outcome.counters),
  });
  return Object.freeze({ ...withoutHash, semanticHash: hashAcceptedJson(withoutHash) });
}

function setStage(snapshot: ServiceFastExperimentCandidateSetSnapshot): string {
  if (snapshot.stage === 'share' || snapshot.stage === 'proposal') return 'proposal';
  if (snapshot.stage === 'current') return 'current-score';
  return snapshot.stage;
}

function authorizationTranscript(
  snapshot: ServiceFastExperimentCandidateSetSnapshot,
): readonly AcceptedJsonObject[] {
  const diagnostic = snapshot.terminalDiagnostic;
  if (
    diagnostic === null ||
    diagnostic.status !== 'improved' && diagnostic.status !== 'authorization-rejected'
  ) return Object.freeze([]);
  const selected = diagnostic.selectedScore;
  if (selected === null) throw new TypeError('Accepted authorization score is absent.');
  const accepted = diagnostic.status === 'improved';
  const mismatch = diagnostic.failureCode === 'authorization-mismatch';
  if (accepted && diagnostic.authorizationReceipt === null) {
    throw new TypeError('Accepted authorization receipt is absent.');
  }
  return Object.freeze([Object.freeze({
    attemptIndex: 0,
    allocation: Object.freeze(selected.allocations.map((value) => value.toString(10))),
    status: accepted ? 'accepted' : mismatch ? 'mismatch' : 'rejected',
    failureCode: accepted ? null : mismatch ? 'authorization-mismatch' : 'authorization-rejected',
    receiptHash: accepted
      ? serviceFastExperimentReceiptHash(diagnostic.authorizationReceipt as ExactInputSplitReplayReceipt)
      : null,
  })]);
}

function deadlineSetState(
  snapshot: ServiceFastExperimentCandidateSetSnapshot,
): AcceptedJsonObject {
  const current = Object.freeze(snapshot.currentAttempts.map(projectAcceptedScoreAttempt));
  const repair = Object.freeze((snapshot.repair?.attempts ?? []).map(projectAcceptedScoreAttempt));
  const authorization = authorizationTranscript(snapshot);
  const terminal = snapshot.stage === 'terminal';
  return Object.freeze({
    setIndex: snapshot.setIndex,
    stage: setStage(snapshot),
    terminalStatus: terminal ? snapshot.terminalDiagnostic?.status ?? null : null,
    failureCode: terminal
      ? snapshot.terminalDiagnostic?.failureCode ?? null
      : snapshot.proposalFailure?.failureCode ?? null,
    currentScoreTranscriptHash: hashAcceptedJson(current),
    repairScoreTranscriptHash: hashAcceptedJson(repair),
    authorizationTranscriptHash: hashAcceptedJson(authorization),
    counters: projectAcceptedCounterVector(snapshot.counters),
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

export function projectAcceptedDeadlineOutcome(
  input: AcceptedInputRecord,
  outcome: ServiceFastExperimentCompleteOutcome | ServiceFastExperimentStoppedOutcome,
  termination: 'complete' | 'deadline' | 'work-limit',
  anchor: ServiceFastExperimentCompleteOutcome,
): AcceptedJsonObject {
  const states = Object.freeze(outcome.setSnapshots.map(deadlineSetState));
  return Object.freeze({
    termination,
    entryPlan: outcome.entryIncumbent !== null,
    anyValidScore: outcome.anyValidScore,
    anyImprovement: outcome.anyImprovement,
    anchorQuality: atLeastAnchor(outcome.finalIncumbent, anchor.finalIncumbent),
    completeStage: outcome.status === 'complete',
    incumbent: projectAcceptedIncumbentReference(input, outcome),
    diagnosticStateHash: hashAcceptedJson(states),
    counters: projectAcceptedCounterVector(outcome.counters),
  });
}
