import { createHash } from 'node:crypto';

import type { ExactInputSplitReplayReceipt } from '../../replay/exact-input-split/index.ts';
import {
  serviceFastExperimentReceiptHash,
} from './exact-replay.ts';
import {
  isFinalizedServiceFastCompleteOutcome,
  type ServiceFastExperimentCandidateSetDiagnostic,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentCurrentAttempt,
  type ServiceFastExperimentRawCounters,
  type ServiceFastExperimentRepairAttempt,
  type ServiceFastExperimentScoreEvidence,
} from './evaluator-kernel.ts';

interface FixedScoreProjection {
  readonly source: 'current' | 'repair';
  readonly attemptIndex: number;
  readonly allocations: readonly string[];
  readonly amountOut: string;
  readonly receiptHash: string;
}

/** @internal */
export interface ServiceFastExperimentSemanticProjection {
  readonly schemaVersion: 'service-fast-semantic-projection-v1';
  readonly policyIndex: number;
  readonly policyId: string;
  readonly status: 'complete';
  readonly counters: readonly number[];
  readonly modelRouteSetupSteps: number;
  readonly stageAggregate: number;
  readonly conservativeAggregate: number;
  readonly entryIncumbent: null | {
    readonly amountOut: string;
    readonly receiptHash: string;
  };
  readonly finalIncumbent: null | {
    readonly amountOut: string;
    readonly receiptHash: string;
  };
  readonly anyValidScore: boolean;
  readonly anyImprovement: boolean;
  readonly diagnostics: readonly unknown[];
  readonly semanticHash: string;
}

function sha256Projection(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex')}`;
}

function deepFreezeProjection<T>(value: T, seen = new Set<object>()): T {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const child: unknown = Reflect.get(value, key);
    deepFreezeProjection(child, seen);
  }
  return Object.freeze(value);
}

function countersProjection(
  counters: ServiceFastExperimentRawCounters,
): readonly number[] {
  const methodActions: unknown = counters.methodActions;
  if (typeof methodActions !== 'number') {
    throw new TypeError(
      'Protected-anchor method actions require outside-timing validation.',
    );
  }
  return Object.freeze([
    methodActions,
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

function receiptProjection(receipt: ExactInputSplitReplayReceipt | null):
  ServiceFastExperimentSemanticProjection['entryIncumbent'] {
  return receipt === null
    ? null
    : Object.freeze({
        amountOut: receipt.amountOut.toString(10),
        receiptHash: serviceFastExperimentReceiptHash(receipt),
      });
}

function scoreProjection(
  score: ServiceFastExperimentScoreEvidence | null,
): FixedScoreProjection | null {
  return score === null
    ? null
    : Object.freeze({
        source: score.source,
        attemptIndex: score.attemptIndex,
        allocations: Object.freeze(
          score.allocations.map((allocation) => allocation.toString(10)),
        ),
        amountOut: score.receipt.amountOut.toString(10),
        receiptHash: score.receiptHash,
      });
}

function currentAttemptProjection(attempt: ServiceFastExperimentCurrentAttempt): unknown {
  return {
    attemptIndex: attempt.attemptIndex,
    residualUnitsRemaining: attempt.residualUnitsRemaining.toString(10),
    routeIndex: attempt.routeIndex,
    allocations: attempt.allocations.map((allocation) => allocation.toString(10)),
    outcome: attempt.outcome,
    failureCode: attempt.failureCode,
    receiptHash: attempt.receipt === null
      ? null
      : serviceFastExperimentReceiptHash(attempt.receipt),
  };
}

function repairAttemptProjection(attempt: ServiceFastExperimentRepairAttempt): unknown {
  return {
    attemptIndex: attempt.attemptIndex,
    neighborIndex: attempt.neighborIndex,
    allocations: attempt.allocations.map((allocation) => allocation.toString(10)),
    outcome: attempt.outcome,
    failureCode: attempt.failureCode,
    receiptHash: attempt.receipt === null
      ? null
      : serviceFastExperimentReceiptHash(attempt.receipt),
  };
}

function numberHex(value: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function diagnosticProjection(
  diagnostic: ServiceFastExperimentCandidateSetDiagnostic,
): unknown {
  const reconstruction = diagnostic.reconstruction;
  const reconstructionProjection = reconstruction === null
    ? null
    : {
        integerWeights: reconstruction.integerWeights.map((value) => value.toString(10)),
        baseAllocations: reconstruction.baseAllocations.map((value) => value.toString(10)),
        residualUnits: reconstruction.residualUnits.toString(10),
      };
  return {
    setIndex: diagnostic.setIndex,
    status: diagnostic.status,
    failureCode: diagnostic.failureCode,
    reconstructionDisposition: diagnostic.reconstructionDisposition,
    proposalMetadata: diagnostic.proposalMetadata === null
      ? null
      : {
          converged: diagnostic.proposalMetadata.converged,
          diagnostic: diagnostic.proposalMetadata.diagnostic,
          completedOuterUpdates: diagnostic.proposalMetadata.completedOuterUpdates,
          weightBits: diagnostic.proposalMetadata.weights.map(numberHex),
        },
    proposalFailure: diagnostic.proposalFailure === null
      ? null
      : {
          failureCode: diagnostic.proposalFailure.failureCode,
          converged: diagnostic.proposalFailure.converged,
          completedOuterUpdates:
            diagnostic.proposalFailure.completedOuterUpdates,
        },
    reconstructionHash: reconstructionProjection === null
      ? null
      : sha256Projection(reconstructionProjection),
    currentTranscriptHash: sha256Projection(
      diagnostic.currentAttempts.map(currentAttemptProjection),
    ),
    currentScore: scoreProjection(diagnostic.currentScore),
    repair: diagnostic.repair === null
      ? null
      : {
          target: diagnostic.repair.target,
          complete: diagnostic.repair.complete,
          transcriptHash: sha256Projection(
            diagnostic.repair.attempts.map(repairAttemptProjection),
          ),
          winner: scoreProjection(diagnostic.repair.winner),
          failureCode: diagnostic.repair.failureCode,
        },
    selectedScore: scoreProjection(diagnostic.selectedScore),
    authorizationReceiptHash: diagnostic.authorizationReceipt === null
      ? null
      : serviceFastExperimentReceiptHash(diagnostic.authorizationReceipt),
    counters: countersProjection(diagnostic.counters),
  };
}

/** @internal */
export function projectServiceFastSemanticResult(
  outcome: ServiceFastExperimentCompleteOutcome,
): ServiceFastExperimentSemanticProjection {
  if (!isFinalizedServiceFastCompleteOutcome(outcome)) {
    throw new TypeError(
      'Only an outside-validated service-fast completion has a semantic projection.',
    );
  }
  const projectionWithoutHash = {
    schemaVersion: 'service-fast-semantic-projection-v1' as const,
    policyIndex: outcome.policy.policyIndex,
    policyId: outcome.policy.policyId,
    status: outcome.status,
    counters: countersProjection(outcome.counters),
    modelRouteSetupSteps: outcome.modelRouteSetupSteps,
    stageAggregate: outcome.stageAggregate,
    conservativeAggregate: outcome.conservativeAggregate,
    entryIncumbent: receiptProjection(outcome.entryIncumbent),
    finalIncumbent: receiptProjection(outcome.finalIncumbent),
    anyValidScore: outcome.anyValidScore,
    anyImprovement: outcome.anyImprovement,
    diagnostics: Object.freeze(outcome.diagnostics.map(diagnosticProjection)),
  };
  return deepFreezeProjection({
    ...projectionWithoutHash,
    semanticHash: sha256Projection(projectionWithoutHash),
  });
}
