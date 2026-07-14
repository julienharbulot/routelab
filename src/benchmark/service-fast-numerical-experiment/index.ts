/** Experiment-only service-fast numerical evaluator. @internal */
export {
  SERVICE_FAST_EXPERIMENT_ANCHOR_POLICY_ID,
  SERVICE_FAST_EXPERIMENT_MAXIMUM_CAPS,
  SERVICE_FAST_EXPERIMENT_POLICY_COUNT,
  captureServiceFastExperimentActionCaps,
  serviceFastExperimentMaximumCapsForPolicy,
  serviceFastExperimentPolicies,
  serviceFastExperimentPolicyAt,
  type ServiceFastExperimentActionCaps,
  type ServiceFastExperimentMaximumCaps,
  type ServiceFastExperimentPolicy,
  type ServiceFastExperimentPolicyId,
  type ServiceFastExperimentReconstruction,
} from './policy.ts';

/** @internal */
export {
  classifyServiceFastExperimentAuthorization,
  serviceFastExperimentCompareReceipts,
  serviceFastExperimentIsStrictlyBetter,
  serviceFastExperimentReceiptHash,
  serviceFastExperimentReceiptsEqual,
  type ServiceFastExperimentAuthorizationClassification,
  type ServiceFastExperimentReplayRequestIdentity,
} from './exact-replay.ts';

/** @internal */
export {
  evaluateServiceFastSemanticPolicy,
  classifyServiceFastExperimentValidationMismatch,
  isFinalizedServiceFastCompleteOutcome,
  isFinalizedServiceFastStoppedOutcome,
  prepareServiceFastExperimentCell,
  prepareServiceFastOperationalPolicy,
  runServiceFastOperationalPolicy,
  serviceFastExperimentCounterVectorsMatch,
  serviceFastExperimentCallProgress,
  serviceFastExperimentCallSetSnapshot,
  validateServiceFastCompleteOutcome,
  validateServiceFastDeadlinePrefix,
  type PrepareServiceFastExperimentCellInput,
  type ServiceFastExperimentActionKind,
  type ServiceFastExperimentCandidateFailureCode,
  type ServiceFastExperimentCandidateSetDiagnostic,
  type ServiceFastExperimentCandidateSetSnapshot,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentCheckpoint,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentCounters,
  type ServiceFastExperimentCurrentAttempt,
  type ServiceFastExperimentIntegrityFailureCode,
  type ServiceFastExperimentIntegrityFailureOutcome,
  type ServiceFastExperimentOperationalCall,
  type ServiceFastExperimentOutcome,
  type ServiceFastExperimentPreActionObserver,
  type ServiceFastExperimentProposalFailureEvidence,
  type ServiceFastExperimentRawCompleteOutcome,
  type ServiceFastExperimentRawCounters,
  type ServiceFastExperimentRawStoppedOutcome,
  type ServiceFastExperimentReconstructionDisposition,
  type ServiceFastExperimentRepairAttempt,
  type ServiceFastExperimentRepairEvidence,
  type ServiceFastExperimentResolvedCandidateSetInput,
  type ServiceFastExperimentScoreEvidence,
  type ServiceFastExperimentSemanticOutcome,
  type ServiceFastExperimentStoppedOutcome,
  type ServiceFastExperimentValidatedCheckpoint,
  type ServiceFastExperimentValidationMismatch,
  type ValidateServiceFastDeadlinePrefixResult,
  type ValidateServiceFastCompleteOutcomeResult,
} from './evaluator-kernel.ts';

/** @internal */
export {
  projectServiceFastSemanticResult,
  type ServiceFastExperimentSemanticProjection,
} from './evidence.ts';
