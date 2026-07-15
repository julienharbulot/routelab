import { registeredSchemaRules } from './registry.ts';
import {
  recordEnforcementSite,
  type RuleVerificationLedger,
} from './types.ts';
import type { AdmittedSourceClosure } from '../source-admission.ts';

export function recordParentAuthenticatedPrecondition(
  ledger: RuleVerificationLedger,
  closure: AdmittedSourceClosure,
): void {
  const parentRules = registeredSchemaRules().filter((rule) =>
    rule.enforcementSites.includes('parent-authenticated-precondition'));
  if (
    parentRules.length !== 4 ||
    parentRules.some((rule) =>
      rule.schemaId !== 'SourceClosure' ||
      ![2, 4, 6, 7].includes(rule.occurrenceIndex ?? -1)) ||
    closure.descriptor.sha256.length !== 'sha256:'.length + 64
  ) {
    throw new TypeError('Parent-authenticated precondition is invalid.');
  }
  // No mutable attestation is handed to this child. The fixed no-argument
  // dispatcher is the reviewed trust root: it authenticates the historical
  // closure/Git relation and exact parent/child profiles immediately before its
  // sole child dispatch. Direct entry invocation is nonconforming.
  recordEnforcementSite(
    ledger,
    registeredSchemaRules(),
    'parent-authenticated-precondition',
  );
}

export function recordRetainedExecutionGateEvidence(
  ledger: RuleVerificationLedger,
  closure: AdmittedSourceClosure,
): void {
  const executionRules = registeredSchemaRules().filter((rule) =>
    rule.verificationModes.includes('execution-gate-only'));
  if (
    executionRules.length !== 8 ||
    closure.value['observationPerformed'] !== false
  ) {
    throw new TypeError('Retained execution-gate evidence is invalid.');
  }
  // These tokens report authenticated historical execution evidence. The
  // durable verifier reconstructs every mechanically checkable subclause, but
  // does not claim to re-observe lock/candidate/staging or timing-sample order.
  recordEnforcementSite(
    ledger,
    registeredSchemaRules(),
    'retained-execution-evidence',
  );
}
