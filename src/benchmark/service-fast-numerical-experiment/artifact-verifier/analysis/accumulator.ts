import {
  SERVICE_FAST_CANDIDATE_FAILURE_CODES,
  SERVICE_FAST_POLICY_IDS,
} from '../contract.ts';
import {
  requireBoolean,
  requireJsonArray,
  requireJsonObject,
  requireSafeNonnegativeInteger,
  requireString,
  type DecodedExperimentInput,
  type JsonObject,
} from '../types.ts';

const FAILURE_CODES = Object.freeze([
  'non-convergence',
  'residual-options-exhausted',
] as const);

export interface MutableFailureCounts {
  nonConvergence: number;
  residualOptionsExhausted: number;
  untypedFailures: number;
  exactSafetyFailures: number;
}

export interface MutableSemanticMetrics {
  finalObjectivesNeverWorse: boolean;
  anchorPlanLostCount: number;
  unterminatedDiagnosticCount: number;
  readonly serviceFailures: MutableFailureCounts;
  readonly amplifiedFailures: MutableFailureCounts;
}

export interface DeadlineCounts {
  entryPlan: number;
  anyValidScore: number;
  anyImprovement: number;
  anchorQuality: number;
  completeStage: number;
}

function failureCounts(): MutableFailureCounts {
  return {
    nonConvergence: 0,
    residualOptionsExhausted: 0,
    untypedFailures: 0,
    exactSafetyFailures: 0,
  };
}

function semanticMetrics(): MutableSemanticMetrics {
  return {
    finalObjectivesNeverWorse: true,
    anchorPlanLostCount: 0,
    unterminatedDiagnosticCount: 0,
    serviceFailures: failureCounts(),
    amplifiedFailures: failureCounts(),
  };
}

function deadlineCounts(): DeadlineCounts {
  return {
    entryPlan: 0,
    anyValidScore: 0,
    anyImprovement: 0,
    anchorQuality: 0,
    completeStage: 0,
  };
}

function mapKey(...values: readonly (string | number)[]): string {
  return JSON.stringify(values);
}

function nanoseconds(value: unknown): bigint {
  const text = requireString(value);
  const result = BigInt(text);
  if (result < 0n) throw new TypeError('Elapsed time is negative.');
  return result;
}

function countFailureFamily(
  target: MutableFailureCounts,
  diagnostics: readonly JsonObject[],
): void {
  for (const diagnostic of diagnostics) {
    const failure = diagnostic['failureCode'];
    if (failure === null) continue;
    if (
      typeof failure !== 'string' ||
      !SERVICE_FAST_CANDIDATE_FAILURE_CODES.includes(
        failure as typeof SERVICE_FAST_CANDIDATE_FAILURE_CODES[number],
      )
    ) {
      target.untypedFailures += 1;
      throw new TypeError('Untyped candidate failure cannot enter analysis.');
    }
    if (failure === 'authorization-mismatch') {
      target.exactSafetyFailures += 1;
      throw new TypeError('Exact-safety failure cannot enter analysis.');
    }
    if (failure === FAILURE_CODES[0]) target.nonConvergence += 1;
    if (failure === FAILURE_CODES[1]) target.residualOptionsExhausted += 1;
  }
}

export class ServiceFastAnalysisAccumulator {
  readonly semantic = Object.freeze(
    SERVICE_FAST_POLICY_IDS.map(() => semanticMetrics()),
  );
  readonly callSweeps = new Map<string, (bigint | undefined)[]>();
  readonly timelineSweeps = new Map<string, (bigint | null | undefined)[]>();
  readonly deadline = new Map<string, DeadlineCounts>();

  acceptSemantic(record: JsonObject, input: DecodedExperimentInput): void {
    const policyIndex = requireSafeNonnegativeInteger(record['policyMatrixIndex']);
    const metrics = this.semantic[policyIndex];
    if (metrics === undefined) throw new TypeError('Semantic policy index is invalid.');
    const comparison = requireJsonObject(record['anchorComparison']);
    if (comparison['comparison'] === 'policy-worse') {
      metrics.finalObjectivesNeverWorse = false;
    }
    if (comparison['relation'] === 'anchor-plan-lost') {
      metrics.anchorPlanLostCount += 1;
    }
    const diagnostics = requireJsonArray(record['candidateSetDiagnostics']).map(
      requireJsonObject,
    );
    metrics.unterminatedDiagnosticCount += diagnostics.filter((diagnostic) =>
      typeof diagnostic['terminalStatus'] !== 'string').length;
    if (input.serviceDecisionMember) {
      countFailureFamily(metrics.serviceFailures, diagnostics);
    }
    if (input.amplifiedStressMember) {
      countFailureFamily(metrics.amplifiedFailures, diagnostics);
    }
  }

  acceptCall(record: JsonObject): void {
    const policyIndex = requireSafeNonnegativeInteger(record['policyMatrixIndex']);
    const caseId = requireString(record['caseId']);
    const timingIndex = requireSafeNonnegativeInteger(record['timingCohortIndex']);
    const sweepIndex = requireSafeNonnegativeInteger(record['sweepIndex']);
    const key = mapKey(policyIndex, caseId, timingIndex);
    const sweeps = this.callSweeps.get(key) ?? Array<bigint | undefined>(5);
    if (sweepIndex >= 5 || sweeps[sweepIndex] !== undefined) {
      throw new TypeError('Call sweep identity is duplicated.');
    }
    sweeps[sweepIndex] = nanoseconds(record['elapsedNanoseconds']);
    this.callSweeps.set(key, sweeps);
  }

  acceptTimeline(record: JsonObject): void {
    const policyIndex = requireSafeNonnegativeInteger(record['policyMatrixIndex']);
    const caseId = requireString(record['caseId']);
    const timingIndex = requireSafeNonnegativeInteger(record['timingCohortIndex']);
    const sweepIndex = requireSafeNonnegativeInteger(record['sweepIndex']);
    const fields = Object.freeze([
      'firstStrictImprovementNanoseconds',
      'finalBestInstallNanoseconds',
    ] as const);
    for (const field of fields) {
      const key = mapKey(policyIndex, caseId, timingIndex, field);
      const sweeps = this.timelineSweeps.get(key) ??
        Array<bigint | null | undefined>(3);
      if (sweepIndex >= 3 || sweeps[sweepIndex] !== undefined) {
        throw new TypeError('Timeline sweep identity is duplicated.');
      }
      const value = record[field];
      sweeps[sweepIndex] = value === null ? null : nanoseconds(value);
      this.timelineSweeps.set(key, sweeps);
    }
  }

  acceptDeadline(record: JsonObject): void {
    const policyIndex = requireSafeNonnegativeInteger(record['policyMatrixIndex']);
    const caseId = requireString(record['caseId']);
    const deadlineMilliseconds = requireSafeNonnegativeInteger(
      record['deadlineMilliseconds'],
    );
    const key = mapKey(policyIndex, caseId, deadlineMilliseconds);
    const counts = this.deadline.get(key) ?? deadlineCounts();
    for (const field of [
      'entryPlan',
      'anyValidScore',
      'anyImprovement',
      'anchorQuality',
      'completeStage',
    ] as const) {
      if (requireBoolean(record[field])) counts[field] += 1;
    }
    this.deadline.set(key, counts);
  }
}
