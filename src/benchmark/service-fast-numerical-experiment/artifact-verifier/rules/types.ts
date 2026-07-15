import type { ArtifactSchemaProgram } from '../schema/program.ts';
import type { JsonObject } from '../types.ts';

export type VerificationMode =
  | 'local-structural'
  | 'input-or-config-dependent'
  | 'deterministically-regenerated'
  | 'cross-file'
  | 'execution-gate-only';

export const VERIFICATION_MODE_ORDER = Object.freeze([
  'local-structural',
  'input-or-config-dependent',
  'deterministically-regenerated',
  'cross-file',
  'execution-gate-only',
] as const);

export type SchemaRuleIdentity =
  | Readonly<{
    readonly schemaId: string;
    readonly collection: 'crossFieldRules';
    readonly occurrenceIndex: number;
    readonly field: null;
    readonly text: string;
  }>
  | Readonly<{
    readonly schemaId: string;
    readonly collection: 'arrayRules';
    readonly occurrenceIndex: null;
    readonly field: string;
    readonly text: string;
  }>;

export type RegisteredSchemaRule = SchemaRuleIdentity & Readonly<{
  readonly verificationModes: readonly VerificationMode[];
  readonly enforcementSites: readonly RuleEnforcementSite[];
}>;

export type RuleEnforcementSite =
  | 'source-admission'
  | 'parent-authenticated-precondition'
  | 'retained-execution-evidence'
  | 'input-replay'
  | 'input-and-artifact-regeneration'
  | 'artifact-regeneration'
  | 'timeline-causality'
  | 'analysis-recompute'
  | 'analysis-and-manifest-recompute'
  | 'environment-record-only'
  | 'manifest-recompute';

export interface RuleVerificationContext {
  readonly program: ArtifactSchemaProgram;
  readonly config: JsonObject;
}

export type RuleVerificationLedger = Set<string>;

export function createRuleVerificationLedger(): RuleVerificationLedger {
  return new Set();
}

function verificationToken(
  registered: RegisteredSchemaRule,
  mode: VerificationMode,
  site: RuleEnforcementSite,
): string {
  return JSON.stringify([
    ruleIdentityKey(registered),
    mode,
    site,
  ]);
}

export function recordEnforcementSite(
  ledger: RuleVerificationLedger,
  rules: readonly RegisteredSchemaRule[],
  site: RuleEnforcementSite,
): void {
  for (const registered of rules) {
    registered.verificationModes.forEach((mode, index) => {
      if (registered.enforcementSites[index] === site) {
        ledger.add(verificationToken(registered, mode, site));
      }
    });
  }
}

export function recordExactRuleEnforcement(
  ledger: RuleVerificationLedger,
  rules: readonly RegisteredSchemaRule[],
  identity: SchemaRuleIdentity,
  mode: VerificationMode,
  site: RuleEnforcementSite,
): void {
  const key = ruleIdentityKey(identity);
  const registered = rules.find((candidate) => ruleIdentityKey(candidate) === key);
  if (registered === undefined) {
    throw new TypeError('Schema rule enforcement identity is not registered.');
  }
  const modeIndex = registered.verificationModes.indexOf(mode);
  if (modeIndex < 0 || registered.enforcementSites[modeIndex] !== site) {
    throw new TypeError('Schema rule enforcement mode or site differs.');
  }
  ledger.add(verificationToken(registered, mode, site));
}

function expectedVerificationTokens(
  rules: readonly RegisteredSchemaRule[],
): readonly string[] {
  return rules.flatMap((registered) =>
    registered.verificationModes.map((mode, index) => {
      const site = registered.enforcementSites[index];
      if (site === undefined) {
        throw new TypeError('Schema rule enforcement site is absent.');
      }
      return verificationToken(registered, mode, site);
    }),
  );
}

export function registeredRuleHasCanonicalEnforcementSites(
  registered: RegisteredSchemaRule,
): boolean {
  return registered.enforcementSites.length === registered.verificationModes.length &&
    registered.enforcementSites.every((site) => {
      switch (site) {
        case 'source-admission':
        case 'parent-authenticated-precondition':
        case 'retained-execution-evidence':
        case 'input-replay':
        case 'input-and-artifact-regeneration':
        case 'artifact-regeneration':
        case 'timeline-causality':
        case 'analysis-recompute':
        case 'analysis-and-manifest-recompute':
        case 'environment-record-only':
        case 'manifest-recompute':
          return true;
      }
    });
}

export function assertRuleVerificationLedger(
  ledger: RuleVerificationLedger,
  rules: readonly RegisteredSchemaRule[],
): void {
  const expected = expectedVerificationTokens(rules);
  if (
    ledger.size !== expected.length || new Set(expected).size !== expected.length ||
    expected.some((token) => !ledger.has(token)) ||
    [...ledger].some((token) => !expected.includes(token))
  ) {
    throw new TypeError('Schema rule verification coverage is incomplete.');
  }
}

export function ruleIdentityKey(identity: SchemaRuleIdentity): string {
  return JSON.stringify([
    identity.schemaId,
    identity.collection,
    identity.occurrenceIndex,
    identity.field,
    identity.text,
  ]);
}
