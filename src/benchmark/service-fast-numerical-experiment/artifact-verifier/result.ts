import { SERVICE_FAST_EXPERIMENT_ID } from './contract.ts';
import type { ServiceFastIntegrityFailureCode } from './failure.ts';
import type { VerificationAggregates } from './types.ts';

export function encodeIntegrityFailureResult(
  integrityFailure: ServiceFastIntegrityFailureCode,
): string {
  return `${JSON.stringify({
    ok: false,
    experimentId: SERVICE_FAST_EXPERIMENT_ID,
    integrityFailure,
  })}\n`;
}

export function encodeVerificationSuccess(
  aggregates: VerificationAggregates,
): string {
  return `${JSON.stringify({
    ok: true,
    experimentId: SERVICE_FAST_EXPERIMENT_ID,
    manifestSha256: aggregates.manifestSha256,
    semanticAggregate: aggregates.semanticAggregate,
    operationalAggregate: aggregates.operationalAggregate,
    analysisAggregate: aggregates.analysisAggregate,
    decisionStatus: aggregates.decisionStatus,
    decisionIdentity: aggregates.decisionIdentity,
  })}\n`;
}
