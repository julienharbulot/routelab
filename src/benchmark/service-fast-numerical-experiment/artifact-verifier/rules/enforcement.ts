import { registeredSchemaRules } from './registry.ts';
import {
  recordExactRuleEnforcement,
  recordEnforcementSite,
  type RuleEnforcementSite,
  type RuleVerificationLedger,
} from './types.ts';

export const RULE_ENFORCEMENT_CONDITIONS: Readonly<
  Record<RuleEnforcementSite, string>
> = Object.freeze({
  'source-admission':
    'admitServiceFastSources exact closure/config topology, role, descriptor, and protected binding checks',
  'parent-authenticated-precondition':
    'fixed dispatcher historical Git/source-closure authentication and exact parent/child runtime-profile audit before sole child dispatch',
  'retained-execution-evidence':
    'authenticated retained source enforces non-reobservable lock, candidate, staging, and operational sample ordering',
  'input-replay':
    'replayAndAdmitExperimentInputs schema validation plus exact regenerated/public/retained byte equality',
  'input-and-artifact-regeneration':
    'exact input replay followed by complete semantic, operational, and deadline artifact regeneration',
  'artifact-regeneration':
    'complete semantic, call, timeline, and deadline projection/hash equality',
  'timeline-causality':
    'admitTimelineCausality compares decoded finite event deltas in causality order',
  'analysis-recompute':
    'independent bigint analysis, qualification, ranking, and decision object equality',
  'analysis-and-manifest-recompute':
    'analysis equality followed by manifest descriptor, decision, and environment equality',
  'environment-record-only':
    'schema-admitted record-only CPU speed, memory, and timezone values bypass current-host matching and are reused unchanged',
  'manifest-recompute':
    'README byte equality plus complete manifest object and aggregate recomputation',
});

function record(
  ledger: RuleVerificationLedger,
  site: RuleEnforcementSite,
): void {
  if (RULE_ENFORCEMENT_CONDITIONS[site].length === 0) {
    throw new TypeError('Rule enforcement condition is absent.');
  }
  recordEnforcementSite(ledger, registeredSchemaRules(), site);
}

export function recordSourceAdmissionEnforcement(
  ledger: RuleVerificationLedger,
): void {
  record(ledger, 'source-admission');
}

export function recordTimelineCausalityEnforcement(
  ledger: RuleVerificationLedger,
): void {
  recordExactRuleEnforcement(
    ledger,
    registeredSchemaRules(),
    Object.freeze({
      schemaId: 'TimelineRecord',
      collection: 'crossFieldRules',
      occurrenceIndex: 1,
      field: null,
      text: 'visible-event-times-are-monotonic-in-event-causality-order-when-both-exist',
    }),
    'local-structural',
    'timeline-causality',
  );
}

export function recordEnvironmentRecordOnlyEnforcement(
  ledger: RuleVerificationLedger,
): void {
  recordExactRuleEnforcement(
    ledger,
    registeredSchemaRules(),
    Object.freeze({
      schemaId: 'Environment',
      collection: 'crossFieldRules',
      occurrenceIndex: 1,
      field: null,
      text: 'record-only-fields-do-not-gate-runtime',
    }),
    'local-structural',
    'environment-record-only',
  );
}

export function recordInputReplayEnforcement(
  ledger: RuleVerificationLedger,
): void {
  record(ledger, 'input-replay');
}

export function recordArtifactRegenerationEnforcement(
  ledger: RuleVerificationLedger,
): void {
  record(ledger, 'input-and-artifact-regeneration');
  record(ledger, 'artifact-regeneration');
}

export function recordAnalysisRecomputeEnforcement(
  ledger: RuleVerificationLedger,
): void {
  record(ledger, 'analysis-recompute');
}

export function recordManifestRecomputeEnforcement(
  ledger: RuleVerificationLedger,
): void {
  record(ledger, 'analysis-and-manifest-recompute');
  record(ledger, 'manifest-recompute');
}
