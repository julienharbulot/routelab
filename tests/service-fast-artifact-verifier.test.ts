import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import type {
  ServiceFastExperimentRawCounters,
} from '../src/benchmark/service-fast-numerical-experiment/index.ts';
import {
  ServiceFastAnalysisAccumulator,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/analysis/accumulator.ts';
import {
  compareServiceFastPolicyResults,
  decideServiceFastPolicy,
  qualifyServiceFastPolicyResult,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/analysis/recompute.ts';
import {
  compareRational,
  medianOfFive,
  medianRational,
  nullableMedianOfThree,
  rational,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/analysis/rational.ts';
import {
  admitTimelineCausality,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/complete-regeneration.ts';
import {
  SERVICE_FAST_ARTIFACT_SCHEMA_PATH,
  SERVICE_FAST_CANDIDATE_FAILURE_CODES,
  SERVICE_FAST_CONFIG_PATH,
  SERVICE_FAST_DEADLINES_MS,
  SERVICE_FAST_INPUT_PATH,
  SERVICE_FAST_INPUT_RECORD_COUNT,
  SERVICE_FAST_OPERATIONAL_CASE_IDS,
  SERVICE_FAST_POLICY_IDS,
  SERVICE_FAST_RETAINED_DIRECTORY,
  SERVICE_FAST_SEMANTIC_RECORD_COUNT,
  SERVICE_FAST_SOURCE_CLOSURE_PATH,
  artifactSchemaDescriptor,
  configDescriptor,
  serviceFastRetainedFileContracts,
  serviceFastSemanticRecordCardinality,
  serviceFastSemanticRecordIndex,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/contract.ts';
import {
  admitDeadlineElapsedNanoseconds,
  deadlineCountersMatchTarget,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/deadline-regeneration.ts';
import {
  SERVICE_FAST_INTEGRITY_FAILURE_CODES,
  ServiceFastArtifactIntegrityError,
  ServiceFastVerifierEnvironmentError,
  encodeServiceFastVerifierToolFailure,
  integrityFailure,
  integrityFailureCode,
  isIntegrityFailure,
  isVerifierEnvironmentFailure,
  rejectServiceFastEvaluatorIntegrityFailure,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/failure.ts';
import {
  descriptorForBytes,
  hashJson,
  semanticRecordHash,
  sha256Bytes,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/hash-projections.ts';
import {
  admitServiceFastVerifierHostCapture,
  admitServiceFastVerifierHostSnapshot,
  type ServiceFastVerifierHostSnapshot,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/host-admission.ts';
import {
  decodeCanonicalServiceFastInputBytes,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/input-replay.ts';
import {
  BoundedFileError,
  admitRetainedArtifactFiles,
  readBoundedRegularFile,
  scanBoundedRegularFile,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/io/bounded-file.ts';
import {
  scanCanonicalNdjson,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/io/ndjson-cursor.ts';
import {
  StrictJsonError,
  parseCanonicalFixtureJson,
  parseCanonicalJson,
  parseCanonicalNdjsonLine,
  parseStrictJsonText,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/json/strict-json.ts';
import {
  recomputeManifest,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/manifest-recompute.ts';
import {
  renderServiceFastReadme,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/readme-recompute.ts';
import {
  encodeIntegrityFailureResult,
  encodeVerificationSuccess,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/result.ts';
import {
  recordAnalysisRecomputeEnforcement,
  recordArtifactRegenerationEnforcement,
  recordEnvironmentRecordOnlyEnforcement,
  recordInputReplayEnforcement,
  recordManifestRecomputeEnforcement,
  recordSourceAdmissionEnforcement,
  recordTimelineCausalityEnforcement,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/rules/enforcement.ts';
import {
  recordParentAuthenticatedPrecondition,
  recordRetainedExecutionGateEvidence,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/rules/execution-gates.ts';
import {
  admitSchemaRuleRegistry,
  registeredSchemaRules,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/rules/registry.ts';
import {
  assertRuleVerificationLedger,
  createRuleVerificationLedger,
  ruleIdentityKey,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/rules/types.ts';
import {
  callOnlySchedule,
  deadlineSchedule,
  timelineSchedule,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/schedule.ts';
import {
  compileArtifactSchemaProgram,
  validateSchemaObject,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/schema/program.ts';
import type {
  OperationalSemanticCell,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/semantic-regeneration.ts';
import {
  admitConfiguredProtectedSources,
  admitConfiguredSourceArray,
  decodeServiceFastSourceClosureBytes,
  type AdmittedSourceClosure,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/source-admission.ts';
import {
  requireJsonArray,
  requireJsonObject,
  requireString,
  type ArtifactDescriptor,
  type DecodedExperimentInput,
  type EnvironmentValue,
  type JsonObject,
  type JsonValue,
} from '../src/benchmark/service-fast-numerical-experiment/artifact-verifier/types.ts';
import {
  decodeServiceFastDurableRuntimeProfileSource,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/durable-runtime-profile.ts';
import {
  auditServiceFastRuntimeImports,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts';

const ENCODER = new TextEncoder();
const HASH = `sha256:${'a'.repeat(64)}`;

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function fixtureObject(relativePath: string): Promise<JsonObject> {
  return requireJsonObject(parseCanonicalFixtureJson(
    Uint8Array.from(await readFile(relativePath)),
  ));
}

function sourceDescriptor(relativePath: string): JsonObject {
  return {
    path: relativePath,
    bytes: 1,
    sha256: HASH,
  };
}

function sourceRoles(
  requiredRoles: readonly string[],
  assignedRoles: readonly string[],
): readonly string[] {
  return requiredRoles.filter((role) => assignedRoles.includes(role));
}

function syntheticSourceClosureValue(config: JsonObject): JsonObject {
  const sourceContract = requireJsonObject(
    requireJsonObject(config['artifacts'])['sourceClosure'],
  );
  const assignments = requireJsonObject(sourceContract['sourceRoleAssignments']);
  const rootAssignments = requireJsonObject(assignments['implementationRoots']);
  const fileAssignments = requireJsonObject(assignments['requiredFiles']);
  const requiredRoles = requireJsonArray(sourceContract['requiredRoles']).map(
    requireString,
  );
  const roots = requireJsonArray(sourceContract['implementationRoots']).map(
    requireString,
  );
  const requiredFiles = requireJsonArray(sourceContract['requiredFiles']).map(
    requireString,
  );
  const sources: JsonObject[] = [];
  for (const root of roots) {
    const assigned = requireJsonArray(rootAssignments[root]).map(requireString);
    const relativePath = `${root}/synthetic-verifier-source.ts`;
    sources.push({
      roles: sourceRoles(requiredRoles, assigned),
      ...sourceDescriptor(relativePath),
    });
  }
  for (const relativePath of requiredFiles) {
    const assigned = requireJsonArray(fileAssignments[relativePath]).map(
      requireString,
    );
    sources.push({
      roles: sourceRoles(requiredRoles, assigned),
      ...sourceDescriptor(relativePath),
    });
  }
  return {
    schemaVersion: 'routelab.service-fast-numerical-source-closure.v1',
    experimentId: 'm7c-core12-service-fast-numerical-v1',
    implementationInputRevision: 'b'.repeat(40),
    observationPerformed: false,
    config: { ...configDescriptor() },
    artifactSchema: { ...artifactSchemaDescriptor() },
    inputArtifact: sourceDescriptor(SERVICE_FAST_INPUT_PATH),
    sources,
    protectedSources: Object.values(requireJsonObject(
      config['protectedRuntimeSources'],
    )),
  };
}

function canonicalFixtureBytes(value: JsonValue): Uint8Array {
  return ENCODER.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function operationalCells(): ReadonlyMap<number, OperationalSemanticCell> {
  const cells = new Map<number, OperationalSemanticCell>();
  let timingCohortIndex = 0;
  const caseCounts = Object.freeze([72, 108, 72]);
  for (let caseIndex = 0; caseIndex < SERVICE_FAST_OPERATIONAL_CASE_IDS.length;
    caseIndex += 1) {
    const caseId = SERVICE_FAST_OPERATIONAL_CASE_IDS[caseIndex];
    const caseCount = caseCounts[caseIndex];
    if (caseId === undefined || caseCount === undefined) {
      throw new TypeError('Synthetic operational case contract is absent.');
    }
    for (let localIndex = 0; localIndex < caseCount; localIndex += 1) {
      const input: DecodedExperimentInput = Object.freeze({
        value: Object.freeze({}),
        sourceIndex: timingCohortIndex,
        caseId,
        requestId: `${caseId}-${localIndex}`,
        timingCohortIndex,
        serviceDecisionMember: true,
        amplifiedStressMember: false,
      });
      cells.set(timingCohortIndex, {
        input,
        cell: Object.freeze({}),
        cellFactory: Object.freeze({}),
        semanticOutcomes: Object.freeze([]),
        semanticProjections: Object.freeze([]),
      } as unknown as OperationalSemanticCell);
      timingCohortIndex += 1;
    }
  }
  return cells;
}

function failureCounts(
  overrides: Partial<Record<
    'nonConvergence' | 'residualOptionsExhausted' |
      'untypedFailures' | 'exactSafetyFailures',
    number
  >> = {},
): JsonObject {
  return {
    nonConvergence: 0,
    residualOptionsExhausted: 0,
    untypedFailures: 0,
    exactSafetyFailures: 0,
    ...overrides,
  };
}

function qualifyingPolicyResult(
  policyId: string,
  policyMatrixIndex: number,
  elapsedNumerator: string,
): JsonObject {
  const firstCase = SERVICE_FAST_OPERATIONAL_CASE_IDS[0];
  const firstDeadline = SERVICE_FAST_DEADLINES_MS[0];
  if (firstCase === undefined || firstDeadline === undefined) {
    throw new TypeError('Synthetic analysis contract is empty.');
  }
  const callCases = SERVICE_FAST_OPERATIONAL_CASE_IDS.map((caseId) => ({
    caseId,
    pairedDeltaMedian: { numerator: '-1', denominator: '1' },
    elapsedRatio: { numerator: elapsedNumerator, denominator: '10' },
  }));
  return {
    policyId,
    policyMatrixIndex,
    semantic: {
      invalidFreshReplayCount: 0,
      forcedFailureIncumbentMismatchCount: 0,
      finalObjectivesNeverWorse: true,
      anchorPlanLostCount: 0,
      unterminatedDiagnosticCount: 0,
      anchorServiceFailures: failureCounts({ nonConvergence: 2 }),
      candidateServiceFailures: failureCounts({ nonConvergence: 1 }),
      amplifiedFailures: failureCounts(),
    },
    callCases,
    instrumentedEvents: [{
      caseId: firstCase,
      event: 'synthetic-event',
      anchorAvailabilityCount: 0,
      candidateAvailabilityCount: 1,
      pairedFiniteCount: 0,
      pairedFiniteMedianDelta: null,
    }],
    deadlineCases: [{
      caseId: firstCase,
      deadlineMilliseconds: firstDeadline,
      anchor: {
        entryPlan: 1,
        anyValidScore: 1,
        anyImprovement: 0,
        anchorQuality: 0,
        completeStage: 0,
      },
      candidate: {
        entryPlan: 1,
        anyValidScore: 1,
        anyImprovement: 1,
        anchorQuality: 1,
        completeStage: 0,
      },
    }],
    rankingValues: {
      worstHotspotElapsedRatio: {
        numerator: elapsedNumerator,
        denominator: '10',
      },
      anchorQualityVector: [1],
      mappedShareActionCeiling: 64,
      policyMatrixIndex,
    },
  };
}

function verifierEnvironment(): EnvironmentValue {
  return Object.freeze({
    nodeVersion: 'v24.18.0',
    v8Version: '13.6.233.17-node.50',
    uvVersion: '1.52.1',
    platform: 'linux',
    arch: 'x64',
    endianness: 'LE',
    osType: 'Linux',
    osRelease: '6.18.33.2-microsoft-standard-WSL2',
    cpuModel: '13th Gen Intel(R) Core(TM) i9-13900H',
    cpuSpeedMHz: 1,
    logicalCpuCount: 20,
    availableParallelism: 20,
    totalMemoryBytes: '1',
    timezone: 'Pacific/Fiji',
    execArgv: Object.freeze([]),
    nodeOptionsState: 'unset',
    mainThread: true,
  });
}

function verifierHostSnapshot(): ServiceFastVerifierHostSnapshot {
  return Object.freeze({
    nodeRuntime: 'v24.18.0',
    v8Runtime: '13.6.233.17-node.50',
    uvRuntime: '1.52.1',
    operatingSystemPlatform: 'linux',
    architecture: 'x64',
    byteOrder: 'LE',
    osType: 'Linux',
    osRelease: '6.18.33.2-microsoft-standard-WSL2',
    cpuModel: '13th Gen Intel(R) Core(TM) i9-13900H',
    logicalCpuCount: 20,
    logicalParallelism: 20,
    startupArguments: Object.freeze([]),
    runtimeOptions: undefined,
  });
}

void test('strict JSON rejects prototype, duplicate, noncanonical, and BOM inputs', () => {
  const prototypeValue = requireJsonObject(parseStrictJsonText(
    '{"__proto__":{"polluted":true},"safe":1}',
  ));
  assert.equal(Object.getPrototypeOf(prototypeValue), null);
  assert.equal(Object.hasOwn(prototypeValue, '__proto__'), true);
  assert.deepEqual(Object.keys(prototypeValue), ['__proto__', 'safe']);
  const nestedPrototype = requireJsonObject(prototypeValue['__proto__']);
  assert.equal(Object.getPrototypeOf(nestedPrototype), null);
  assert.equal(nestedPrototype['polluted'], true);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);

  assert.throws(
    () => parseStrictJsonText('{"duplicate":1,"duplicate":2}'),
    StrictJsonError,
  );
  assert.throws(
    () => parseStrictJsonText('{"__proto__":1,"__proto__":2}'),
    StrictJsonError,
  );
  assert.throws(
    () => parseStrictJsonText('{"a":1,"\\u0061":2}'),
    StrictJsonError,
  );
  assert.throws(
    () => parseCanonicalJson(Uint8Array.from([0xc3, 0x28, 0x0a])),
    StrictJsonError,
  );
  assert.deepEqual(
    parseCanonicalJson(ENCODER.encode('{"value":1}\n')),
    Object.assign(Object.create(null) as JsonObject, { value: 1 }),
  );
  assert.throws(
    () => parseCanonicalJson(ENCODER.encode('{ "value": 1 }\n')),
    StrictJsonError,
  );
  assert.throws(
    () => parseCanonicalJson(ENCODER.encode('{"value":1}\r\n')),
    StrictJsonError,
  );
  assert.throws(
    () => parseCanonicalJson(ENCODER.encode('{"value":1}\n\n')),
    StrictJsonError,
  );
  assert.deepEqual(
    parseCanonicalNdjsonLine(ENCODER.encode('{"value":1}\n')),
    Object.assign(Object.create(null) as JsonObject, { value: 1 }),
  );
  assert.throws(
    () => parseCanonicalNdjsonLine(ENCODER.encode('{"value":1}')),
    StrictJsonError,
  );

  const withBom = (text: string): Uint8Array => Uint8Array.from([
    0xef,
    0xbb,
    0xbf,
    ...ENCODER.encode(text),
  ]);
  assert.throws(() => parseCanonicalJson(withBom('{"value":1}\n')), StrictJsonError);
  assert.throws(
    () => parseCanonicalFixtureJson(withBom('{\n  "value": 1\n}\n')),
    StrictJsonError,
  );
  assert.throws(
    () => parseCanonicalNdjsonLine(withBom('{"value":1}\n')),
    StrictJsonError,
  );
});

void test('schema registry binds all 171 identities to exact modes and sites', async () => {
  const [config, schema] = await Promise.all([
    fixtureObject(SERVICE_FAST_CONFIG_PATH),
    fixtureObject(SERVICE_FAST_ARTIFACT_SCHEMA_PATH),
  ]);
  const program = compileArtifactSchemaProgram(schema, config);
  assert.doesNotThrow(() => admitSchemaRuleRegistry(program));
  const rules = registeredSchemaRules();
  assert.equal(rules.length, 171);
  assert.equal(
    rules.filter((rule) => rule.collection === 'crossFieldRules').length,
    153,
  );
  assert.equal(
    rules.filter((rule) => rule.collection === 'arrayRules').length,
    18,
  );

  const schemaIdentityKeys: string[] = [];
  for (const objectSchema of program.schemas.values()) {
    objectSchema.crossFieldRules.forEach((text, occurrenceIndex) => {
      schemaIdentityKeys.push(ruleIdentityKey({
        schemaId: objectSchema.schemaId,
        collection: 'crossFieldRules',
        occurrenceIndex,
        field: null,
        text,
      }));
    });
    for (const [field, text] of objectSchema.arrayRules) {
      schemaIdentityKeys.push(ruleIdentityKey({
        schemaId: objectSchema.schemaId,
        collection: 'arrayRules',
        occurrenceIndex: null,
        field,
        text,
      }));
    }
  }
  assert.deepEqual(rules.map(ruleIdentityKey), schemaIdentityKeys);

  const modeSites = new Map<string, number>();
  for (const rule of rules) {
    assert.equal(rule.verificationModes.length, rule.enforcementSites.length);
    rule.verificationModes.forEach((mode, index) => {
      const site = rule.enforcementSites[index];
      assert.notEqual(site, undefined);
      const key = `${mode} @ ${site}`;
      modeSites.set(key, (modeSites.get(key) ?? 0) + 1);
    });
  }
  assert.deepEqual([...modeSites].sort(), [
    ['cross-file @ analysis-and-manifest-recompute', 7],
    ['cross-file @ manifest-recompute', 4],
    ['cross-file @ parent-authenticated-precondition', 4],
    ['cross-file @ source-admission', 1],
    ['deterministically-regenerated @ analysis-and-manifest-recompute', 4],
    ['deterministically-regenerated @ analysis-recompute', 18],
    ['deterministically-regenerated @ artifact-regeneration', 92],
    ['deterministically-regenerated @ input-and-artifact-regeneration', 12],
    ['deterministically-regenerated @ input-replay', 17],
    ['deterministically-regenerated @ manifest-recompute', 3],
    ['execution-gate-only @ retained-execution-evidence', 8],
    ['input-or-config-dependent @ analysis-and-manifest-recompute', 2],
    ['input-or-config-dependent @ input-replay', 17],
    ['input-or-config-dependent @ parent-authenticated-precondition', 1],
    ['input-or-config-dependent @ source-admission', 4],
    ['local-structural @ environment-record-only', 1],
    ['local-structural @ source-admission', 1],
    ['local-structural @ timeline-causality', 1],
  ]);

  const closureBytes = canonicalFixtureBytes(syntheticSourceClosureValue(config));
  const decoded = decodeServiceFastSourceClosureBytes(closureBytes);
  const admittedClosure: AdmittedSourceClosure = Object.freeze({
    ...decoded,
    descriptor: Object.freeze({
      path: SERVICE_FAST_SOURCE_CLOSURE_PATH,
      bytes: closureBytes.byteLength,
      sha256: sha256Bytes(closureBytes),
    }),
  });
  const ledger = createRuleVerificationLedger();
  recordSourceAdmissionEnforcement(ledger);
  recordParentAuthenticatedPrecondition(ledger, admittedClosure);
  recordRetainedExecutionGateEvidence(ledger, admittedClosure);
  recordInputReplayEnforcement(ledger);
  recordArtifactRegenerationEnforcement(ledger);
  recordTimelineCausalityEnforcement(ledger);
  recordAnalysisRecomputeEnforcement(ledger);
  recordEnvironmentRecordOnlyEnforcement(ledger);
  recordManifestRecomputeEnforcement(ledger);
  assert.equal(ledger.size, 197);
  assert.doesNotThrow(() => assertRuleVerificationLedger(ledger, rules));
  const firstToken = ledger.values().next().value;
  assert.equal(typeof firstToken, 'string');
  ledger.delete(firstToken as string);
  assert.throws(() => assertRuleVerificationLedger(ledger, rules), TypeError);

  const mutatedSchema = jsonClone(schema);
  const schemaObjects = requireJsonArray(mutatedSchema['objectSchemas']);
  const firstSchema = schemaObjects.map(requireJsonObject).find((candidate) =>
    Array.isArray(candidate['crossFieldRules']) &&
    candidate['crossFieldRules'].length > 0);
  if (firstSchema === undefined) {
    throw new TypeError('Synthetic schema mutation target is absent.');
  }
  const firstCrossRules = requireJsonArray(firstSchema['crossFieldRules']) as JsonValue[];
  firstCrossRules[0] = 'mutated-rule-identity';
  const mutatedProgram = compileArtifactSchemaProgram(mutatedSchema, config);
  assert.throws(() => admitSchemaRuleRegistry(mutatedProgram), TypeError);

  const descriptor = {
    path: 'synthetic.json',
    bytes: 1,
    sha256: HASH,
  };
  assert.doesNotThrow(() => validateSchemaObject(program, 'Descriptor', descriptor));
  assert.throws(
    () => validateSchemaObject(program, 'Descriptor', { ...descriptor, bytes: -1 }),
    TypeError,
  );
});

void test('source closure admission enforces exact topology and protected bindings', async () => {
  const config = await fixtureObject(SERVICE_FAST_CONFIG_PATH);
  const value = syntheticSourceClosureValue(config);
  const bytes = canonicalFixtureBytes(value);
  const decoded = decodeServiceFastSourceClosureBytes(bytes);
  assert.equal(decoded.implementationInputRevision, 'b'.repeat(40));
  assert.equal(decoded.inputArtifact.path, SERVICE_FAST_INPUT_PATH);
  assert.doesNotThrow(() => admitConfiguredSourceArray(config, decoded.value));
  assert.doesNotThrow(() => admitConfiguredProtectedSources(config, decoded.value));

  const reordered = jsonClone(decoded.value);
  const reorderedSources = requireJsonArray(reordered['sources']) as JsonValue[];
  [reorderedSources[0], reorderedSources[1]] = [
    reorderedSources[1] as JsonValue,
    reorderedSources[0] as JsonValue,
  ];
  assert.throws(() => admitConfiguredSourceArray(config, reordered), TypeError);

  const protectedMutation = jsonClone(decoded.value);
  const protectedSources = requireJsonArray(
    protectedMutation['protectedSources'],
  );
  const firstProtected = requireJsonObject(protectedSources[0]) as unknown as
    Record<string, JsonValue>;
  firstProtected['sha256'] = `sha256:${'c'.repeat(64)}`;
  assert.throws(
    () => admitConfiguredProtectedSources(config, protectedMutation),
    TypeError,
  );

  const observed = jsonClone(value) as unknown as Record<string, JsonValue>;
  observed['observationPerformed'] = true;
  assert.throws(
    () => decodeServiceFastSourceClosureBytes(canonicalFixtureBytes(observed)),
    TypeError,
  );
  assert.throws(
    () => decodeServiceFastSourceClosureBytes(
      ENCODER.encode(JSON.stringify(value)),
    ),
    StrictJsonError,
  );
});

void test('failure classification is closed, frozen, and hostile-value safe', () => {
  const unexpectedEnvelope = `${JSON.stringify({
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'verification',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  })}\n`;
  const environmentEnvelope = `${JSON.stringify({
    ok: false,
    cause: 'environment-admission-failure',
    phase: 'verification',
    detailCode: 'environment-admission-failure',
    committed: false,
    secondaryCleanup: null,
  })}\n`;
  const hostile = new Proxy({}, {
    getPrototypeOf: () => {
      throw new Error('prototype trap must not run');
    },
    get: () => {
      throw new Error('property trap must not run');
    },
  });
  assert.equal(isIntegrityFailure(hostile), false);
  assert.equal(integrityFailureCode(hostile), undefined);
  assert.equal(encodeServiceFastVerifierToolFailure(hostile), unexpectedEnvelope);

  const spoof: unknown = Object.setPrototypeOf(
    {},
    ServiceFastArtifactIntegrityError.prototype,
  );
  assert.equal(isIntegrityFailure(spoof), false);
  assert.equal(integrityFailureCode(spoof), undefined);
  assert.equal(encodeServiceFastVerifierToolFailure(spoof), unexpectedEnvelope);
  assert.throws(
    () => new ServiceFastArtifactIntegrityError(undefined as never),
    TypeError,
  );

  for (const code of SERVICE_FAST_INTEGRITY_FAILURE_CODES) {
    let caught: unknown;
    try {
      integrityFailure(code);
    } catch (error) {
      caught = error;
    }
    assert.equal(isIntegrityFailure(caught), true);
    assert.equal(integrityFailureCode(caught), code);
    assert.equal(Object.isFrozen(caught), true);
    assert.equal(
      encodeIntegrityFailureResult(code),
      `${JSON.stringify({
        ok: false,
        experimentId: 'm7c-core12-service-fast-numerical-v1',
        integrityFailure: code,
      })}\n`,
    );
  }

  const mappings = [
    'semantic-anchor-parity-mismatch',
    'exact-replay-mismatch',
    'counter-invariant-failure',
    'unexpected-exception',
  ] as const;
  for (const code of mappings) {
    assert.throws(
      () => rejectServiceFastEvaluatorIntegrityFailure(code),
      (error: unknown) => integrityFailureCode(error) === code,
    );
  }

  const environmentError = new ServiceFastVerifierEnvironmentError();
  assert.equal(isVerifierEnvironmentFailure(environmentError), true);
  assert.equal(Object.isFrozen(environmentError), true);
  assert.equal(
    encodeServiceFastVerifierToolFailure(environmentError),
    environmentEnvelope,
  );
  assert.equal(
    encodeServiceFastVerifierToolFailure(
      Object.create(ServiceFastVerifierEnvironmentError.prototype),
    ),
    unexpectedEnvelope,
  );
});

void test('host admission checks only the exact current-host capture boundary', () => {
  const valid = verifierHostSnapshot();
  assert.doesNotThrow(() => admitServiceFastVerifierHostSnapshot(valid));
  assert.doesNotThrow(() => admitServiceFastVerifierHostSnapshot({
    ...valid,
    runtimeOptions: '',
  }));

  const mutations: readonly Partial<ServiceFastVerifierHostSnapshot>[] = [
    { nodeRuntime: 'v0.0.0' },
    { v8Runtime: '0' },
    { uvRuntime: '0' },
    { operatingSystemPlatform: 'darwin' },
    { architecture: 'arm64' },
    { byteOrder: 'BE' },
    { osType: 'Darwin' },
    { osRelease: 'other' },
    { cpuModel: undefined },
    { logicalCpuCount: 19 },
    { logicalParallelism: 19 },
    { startupArguments: ['--inspect'] },
    { runtimeOptions: '--require=hostile' },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => admitServiceFastVerifierHostSnapshot({ ...valid, ...mutation }),
      (error: unknown) => isVerifierEnvironmentFailure(error),
    );
  }

  assert.doesNotThrow(() => admitServiceFastVerifierHostCapture(() => valid));
  assert.throws(
    () => admitServiceFastVerifierHostCapture(() => {
      throw new Proxy(new Error('hostile capture'), {
        getPrototypeOf: () => {
          throw new Error('capture trap');
        },
      });
    }),
    (error: unknown) => isVerifierEnvironmentFailure(error),
  );
});

void test('bounded reads reject caps, links, FIFOs, and retained-directory extras', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-artifact-verifier-'));
  try {
    const fileBytes = ENCODER.encode('bounded regular file\n');
    await writeFile(path.join(root, 'file.bin'), fileBytes);
    const descriptor = descriptorForBytes('file.bin', fileBytes);
    assert.deepEqual(
      await scanBoundedRegularFile(root, 'file.bin', fileBytes.byteLength),
      descriptor,
    );
    assert.deepEqual(
      await readBoundedRegularFile(
        root,
        'file.bin',
        fileBytes.byteLength,
        descriptor,
      ),
      fileBytes,
    );
    await assert.rejects(
      scanBoundedRegularFile(root, 'file.bin', fileBytes.byteLength - 1),
      (error: unknown) => error instanceof BoundedFileError && error.code === 'cap',
    );
    await assert.rejects(
      scanBoundedRegularFile(root, 'file.bin', fileBytes.byteLength, undefined, {
        ...descriptor,
        sha256: `sha256:${'0'.repeat(64)}`,
      }),
      (error: unknown) =>
        error instanceof BoundedFileError && error.code === 'identity',
    );

    await symlink('file.bin', path.join(root, 'link.bin'));
    await assert.rejects(scanBoundedRegularFile(root, 'link.bin', 1024));
    await mkdir(path.join(root, 'directory.bin'));
    await assert.rejects(
      scanBoundedRegularFile(root, 'directory.bin', 1024),
      (error: unknown) => error instanceof BoundedFileError && error.code === 'shape',
    );

    const ndjsonBytes = ENCODER.encode('{"index":0}\n{"index":1}\n');
    await writeFile(path.join(root, 'records.ndjson'), ndjsonBytes);
    const ndjsonDescriptor = descriptorForBytes('records.ndjson', ndjsonBytes);
    const seen: number[] = [];
    await scanCanonicalNdjson(
      root,
      ndjsonDescriptor,
      ndjsonBytes.byteLength,
      2,
      32,
      ({ index, value }) => {
        assert.equal(requireJsonObject(value)['index'], index);
        seen.push(index);
      },
    );
    assert.deepEqual(seen, [0, 1]);
    await assert.rejects(
      scanCanonicalNdjson(
        root,
        ndjsonDescriptor,
        ndjsonBytes.byteLength,
        3,
        32,
        () => undefined,
      ),
      TypeError,
    );
    await assert.rejects(
      scanCanonicalNdjson(
        root,
        ndjsonDescriptor,
        ndjsonBytes.byteLength,
        2,
        11,
        () => undefined,
      ),
      TypeError,
    );

    const retainedRoot = path.join(root, SERVICE_FAST_RETAINED_DIRECTORY);
    await mkdir(retainedRoot, { recursive: true });
    for (const contract of serviceFastRetainedFileContracts()) {
      await writeFile(
        path.join(retainedRoot, contract.name),
        ENCODER.encode(`${contract.name}\n`),
      );
    }
    const retained = await admitRetainedArtifactFiles(root);
    assert.deepEqual(
      [...retained.keys()],
      serviceFastRetainedFileContracts().map(({ name }) => name),
    );
    await writeFile(path.join(retainedRoot, 'ninth-untrusted-entry'), 'x');
    await assert.rejects(
      admitRetainedArtifactFiles(root),
      (error: unknown) => error instanceof BoundedFileError && error.code === 'shape',
    );

    const fifoPath = path.join(root, 'hostile.fifo');
    const fifo = spawnSync('/usr/bin/mkfifo', [fifoPath], {
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(fifo.status, 0, fifo.stderr);
    const scannerUrl = pathToFileURL(path.resolve(
      'src/benchmark/service-fast-numerical-experiment/artifact-verifier/io/bounded-file.ts',
    )).href;
    const probe = [
      `import { scanBoundedRegularFile } from ${JSON.stringify(scannerUrl)};`,
      'try {',
      `  await scanBoundedRegularFile(${JSON.stringify(root)}, 'hostile.fifo', 1024);`,
      "  process.stdout.write('accepted\\n');",
      '  process.exitCode = 2;',
      '} catch (error) {',
      "  process.stdout.write(`${error instanceof Error && 'code' in error ? String(error.code) : 'other'}\\n`);",
      '}',
    ].join('\n');
    const probed = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
        timeout: 2_000,
      },
    );
    assert.equal(probed.error, undefined);
    assert.equal(probed.status, 0, probed.stderr);
    assert.equal(probed.stdout, 'shape\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('durable runtime profile admits the exact read-only verifier graph', async () => {
  const repositoryRoot = path.resolve('.');
  const profileBytes = Uint8Array.from(await readFile(
    'src/benchmark/service-fast-numerical-experiment/artifact-verifier/runtime-profile.ts',
  ));
  const profile = decodeServiceFastDurableRuntimeProfileSource(profileBytes);
  const projectSources = await Promise.all(profile.projectSources.map(
    async (sourcePath) => descriptorForBytes(
      sourcePath,
      Uint8Array.from(await readFile(sourcePath)),
    ),
  ));
  const result = await auditServiceFastRuntimeImports({
    repositoryRoot,
    profile: Object.freeze({
      profileId: profile.profileId,
      entryRoots: profile.entryRoots,
      projectSources: Object.freeze(projectSources),
      nodeBuiltins: profile.nodeBuiltins,
      pathCapabilities: profile.pathCapabilities,
    }),
    trackedPaths: new Set(profile.projectSources),
    ignoredPaths: new Set(),
  });
  assert.deepEqual(result.projectSources, [...profile.projectSources].sort());
  assert.deepEqual(result.nodeBuiltins, [...profile.nodeBuiltins].sort());
});

void test('input decoding and schedules preserve exact cardinality and canonical order', () => {
  const values: JsonObject[] = Array.from(
    { length: SERVICE_FAST_INPUT_RECORD_COUNT },
    (_, sourceIndex) => ({
      request: {
        assetIn: 'A',
        assetOut: 'C',
        amountIn: '1',
      },
      candidateDiscovery: {
        candidateSets: [
          { routes: [{ route: 0 }, { route: 1 }] },
          { routes: [{ route: 2 }, { route: 3 }] },
        ],
      },
      sourceIndex,
      caseId: 'synthetic-case',
      requestId: `request-${sourceIndex}`,
      timingCohortIndex: null,
      serviceDecisionMember: true,
      amplifiedStressMember: false,
    }),
  );
  const encode = (records: readonly JsonObject[]): Uint8Array => ENCODER.encode(
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );
  const bytes = encode(values);
  const decoded = decodeCanonicalServiceFastInputBytes(bytes);
  assert.equal(decoded.length, SERVICE_FAST_INPUT_RECORD_COUNT);
  assert.equal(decoded[0]?.sourceIndex, 0);
  assert.equal(
    decoded[SERVICE_FAST_INPUT_RECORD_COUNT - 1]?.sourceIndex,
    SERVICE_FAST_INPUT_RECORD_COUNT - 1,
  );
  assert.equal(
    serviceFastSemanticRecordCardinality(decoded.length),
    SERVICE_FAST_SEMANTIC_RECORD_COUNT,
  );
  assert.equal(serviceFastSemanticRecordIndex(0, 0), 0);
  assert.equal(
    serviceFastSemanticRecordIndex(
      SERVICE_FAST_INPUT_RECORD_COUNT - 1,
      SERVICE_FAST_POLICY_IDS.length - 1,
    ),
    SERVICE_FAST_SEMANTIC_RECORD_COUNT - 1,
  );
  assert.throws(() => serviceFastSemanticRecordCardinality(1_583), TypeError);
  assert.throws(() => serviceFastSemanticRecordIndex(-1, 0), TypeError);
  assert.throws(
    () => serviceFastSemanticRecordIndex(0, SERVICE_FAST_POLICY_IDS.length),
    TypeError,
  );

  const oneRoute = jsonClone(values);
  const firstDiscovery = requireJsonObject(oneRoute[0]?.['candidateDiscovery']);
  const firstSet = requireJsonObject(
    requireJsonArray(firstDiscovery['candidateSets'])[0],
  ) as unknown as Record<string, JsonValue>;
  firstSet['routes'] = [{ route: 0 }];
  assert.throws(() => decodeCanonicalServiceFastInputBytes(encode(oneRoute)), TypeError);
  assert.throws(
    () => decodeCanonicalServiceFastInputBytes(encode(values.slice(0, -1))),
    TypeError,
  );
  assert.throws(
    () => decodeCanonicalServiceFastInputBytes(bytes.slice(0, -1)),
    TypeError,
  );

  const cells = operationalCells();
  assert.equal(cells.size, 252);
  const calls = callOnlySchedule(cells);
  const timelines = timelineSchedule(cells);
  const deadlines = deadlineSchedule(cells);
  assert.equal(calls.length, 30_240);
  assert.equal(timelines.length, 18_144);
  assert.equal(deadlines.length, 108_864);
  assert.equal(calls.every(({ observationIndex }, index) =>
    observationIndex === index), true);
  assert.deepEqual(
    calls.slice(0, SERVICE_FAST_POLICY_IDS.length).map(
      ({ policyMatrixIndex }) => policyMatrixIndex,
    ),
    Array.from({ length: SERVICE_FAST_POLICY_IDS.length }, (_, index) => index),
  );
  assert.equal(calls[2_016]?.cell.input.timingCohortIndex, 59);
  assert.equal(calls[2_016]?.policyMatrixIndex, 11);
  assert.equal(calls[8_640]?.cell.input.timingCohortIndex, 72);
  assert.equal(calls[8_640]?.policyMatrixIndex, 0);
  assert.equal(calls[10_080]?.cell.input.timingCohortIndex, 132);
  assert.equal(calls[10_080]?.policyMatrixIndex, 12);
  assert.equal(deadlines[0]?.deadlineMilliseconds, 1);
  assert.equal(deadlines[2_016]?.policyMatrixIndex, 11);
  assert.equal(deadlines[5_184]?.deadlineMilliseconds, 5);
  assert.equal(deadlines[5_184]?.policyMatrixIndex, 1);

  const incomplete = new Map(cells);
  incomplete.delete(0);
  assert.throws(() => callOnlySchedule(incomplete), TypeError);
  assert.throws(() => timelineSchedule(incomplete), TypeError);
  assert.throws(() => deadlineSchedule(incomplete), TypeError);
});

void test('deadline and timeline regeneration helpers reject noncausal retained evidence', () => {
  const counters: ServiceFastExperimentRawCounters = Object.freeze({
    methodActions: null,
    outerUpdates: 1,
    shareActions: 2,
    reconstructionSteps: 3,
    residualReplays: 4,
    residualRejections: 5,
    repairReplays: 6,
    repairRejections: 7,
    authorizationReplays: 8,
    authorizationRejections: 9,
    proposals: 10,
    diagnostics: 11,
  });
  const target = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(deadlineCountersMatchTarget(counters, target), true);
  assert.equal(
    deadlineCountersMatchTarget(counters, [...target.slice(0, 10), 99, 11]),
    false,
  );
  assert.equal(
    admitDeadlineElapsedNanoseconds('deadline', '1000000', 1),
    1_000_000n,
  );
  assert.equal(admitDeadlineElapsedNanoseconds('complete', '0', 100), 0n);
  assert.throws(
    () => admitDeadlineElapsedNanoseconds('deadline', '999999', 1),
    (error: unknown) => integrityFailureCode(error) === 'clock-invariant-failure',
  );
  assert.throws(
    () => admitDeadlineElapsedNanoseconds('work-limit', '-1', 1),
    (error: unknown) => integrityFailureCode(error) === 'clock-invariant-failure',
  );

  const ledger = createRuleVerificationLedger();
  assert.doesNotThrow(() => admitTimelineCausality({
    firstValidScoreNanoseconds: '1',
    firstStrictImprovementNanoseconds: '2',
    finalBestInstallNanoseconds: '3',
  }, ledger));
  assert.equal(ledger.size, 1);
  assert.doesNotThrow(() => admitTimelineCausality({
    firstValidScoreNanoseconds: null,
    firstStrictImprovementNanoseconds: null,
    finalBestInstallNanoseconds: null,
  }, ledger));
  assert.throws(
    () => admitTimelineCausality({
      firstValidScoreNanoseconds: '3',
      firstStrictImprovementNanoseconds: '2',
      finalBestInstallNanoseconds: '1',
    }, ledger),
    (error: unknown) => integrityFailureCode(error) === 'clock-invariant-failure',
  );

  const record = Object.freeze({
    schemaVersion: 'synthetic',
    sourceIndex: 0,
    exactAmount: '90071992547409931234567890',
  });
  assert.equal(semanticRecordHash(record), semanticRecordHash(record));
  assert.notEqual(
    semanticRecordHash(record),
    semanticRecordHash({ ...record, sourceIndex: 1 }),
  );
  assert.equal(hashJson(record), semanticRecordHash(record));
});

void test('bigint analysis and failure-family admission are exact and fail fast', async () => {
  const huge = 1n << 220n;
  assert.equal(
    compareRational(rational(huge + 1n, huge), rational(huge, huge)),
    1,
  );
  assert.deepEqual(medianRational([9n, 1n, 5n, 3n]), rational(8n, 2n));
  assert.equal(medianOfFive([huge + 5n, huge + 1n, huge + 4n, huge + 3n, huge + 2n]), huge + 3n);
  assert.equal(nullableMedianOfThree([null, 7n, 3n]), 7n);
  assert.equal(nullableMedianOfThree([null, null, 3n]), null);
  assert.throws(() => rational(1n, 0n), TypeError);

  const config = await fixtureObject(SERVICE_FAST_CONFIG_PATH);
  const semanticEvidence = requireJsonObject(config['semanticEvidence']);
  assert.deepEqual(
    requireJsonArray(semanticEvidence['candidateFailureCodes']),
    SERVICE_FAST_CANDIDATE_FAILURE_CODES,
  );
  const input: DecodedExperimentInput = Object.freeze({
    value: Object.freeze({}),
    sourceIndex: 0,
    caseId: 'synthetic',
    requestId: 'synthetic',
    timingCohortIndex: null,
    serviceDecisionMember: true,
    amplifiedStressMember: false,
  });
  const semanticRecord = (failureCode: JsonValue): JsonObject => ({
    policyMatrixIndex: 0,
    anchorComparison: {
      comparison: 'equal',
      relation: 'objective-equal',
    },
    candidateSetDiagnostics: [{
      terminalStatus: 'proposal-failed',
      failureCode,
    }],
  });
  const counted = new ServiceFastAnalysisAccumulator();
  counted.acceptSemantic(semanticRecord('non-convergence'), input);
  assert.equal(counted.semantic[0]?.serviceFailures.nonConvergence, 1);

  const amplifiedInput: DecodedExperimentInput = Object.freeze({
    ...input,
    serviceDecisionMember: false,
    amplifiedStressMember: true,
  });
  const amplifiedOnly = new ServiceFastAnalysisAccumulator();
  amplifiedOnly.acceptSemantic(
    semanticRecord('residual-options-exhausted'),
    amplifiedInput,
  );
  assert.equal(
    amplifiedOnly.semantic[0]?.serviceFailures.residualOptionsExhausted,
    0,
  );
  assert.equal(
    amplifiedOnly.semantic[0]?.amplifiedFailures.residualOptionsExhausted,
    1,
  );

  const untyped = new ServiceFastAnalysisAccumulator();
  assert.throws(
    () => untyped.acceptSemantic(semanticRecord('not-a-frozen-code'), input),
    TypeError,
  );
  assert.equal(untyped.semantic[0]?.serviceFailures.untypedFailures, 1);

  const unsafe = new ServiceFastAnalysisAccumulator();
  assert.throws(
    () => unsafe.acceptSemantic(semanticRecord('authorization-mismatch'), input),
    TypeError,
  );
  assert.equal(unsafe.semantic[0]?.serviceFailures.exactSafetyFailures, 1);
  assert.throws(
    () => rejectServiceFastEvaluatorIntegrityFailure('exact-replay-mismatch'),
    (error: unknown) => integrityFailureCode(error) === 'exact-replay-mismatch',
  );
});

void test('qualification, ranking, and fallback are deterministic and safety-gated', () => {
  const slower = qualifyingPolicyResult(
    SERVICE_FAST_POLICY_IDS[1],
    1,
    '8',
  );
  const faster = qualifyingPolicyResult(
    SERVICE_FAST_POLICY_IDS[2],
    2,
    '7',
  );
  const slowerQualification = qualifyServiceFastPolicyResult(slower);
  const fasterQualification = qualifyServiceFastPolicyResult(faster);
  assert.equal(slowerQualification['qualifies'], true);
  assert.equal(fasterQualification['qualifies'], true);
  assert.equal(compareServiceFastPolicyResults(faster, slower), -1);

  const tieLeft = jsonClone(slower);
  const tieRight = jsonClone(slower);
  const leftRanking = requireJsonObject(tieLeft['rankingValues']) as unknown as
    Record<string, JsonValue>;
  const rightRanking = requireJsonObject(tieRight['rankingValues']) as unknown as
    Record<string, JsonValue>;
  leftRanking['anchorQualityVector'] = [1, 2];
  rightRanking['anchorQualityVector'] = [1, 1];
  assert.equal(compareServiceFastPolicyResults(tieLeft, tieRight), -1);
  rightRanking['anchorQualityVector'] = [1, 2];
  leftRanking['mappedShareActionCeiling'] = 32;
  rightRanking['mappedShareActionCeiling'] = 64;
  assert.equal(compareServiceFastPolicyResults(tieLeft, tieRight), -32);
  rightRanking['mappedShareActionCeiling'] = 32;
  leftRanking['policyMatrixIndex'] = 1;
  rightRanking['policyMatrixIndex'] = 2;
  assert.equal(compareServiceFastPolicyResults(tieLeft, tieRight), -1);

  const decision = decideServiceFastPolicy(
    [slower, faster],
    [slowerQualification, fasterQualification],
  );
  assert.deepEqual(decision, {
    status: 'selected-policy',
    policyId: SERVICE_FAST_POLICY_IDS[2],
    fallbackDecisionId: null,
    rankedQualifyingPolicyIds: [
      SERVICE_FAST_POLICY_IDS[2],
      SERVICE_FAST_POLICY_IDS[1],
    ],
    reason: 'highest-ranked-qualifying-policy',
  });
  assert.deepEqual(
    decideServiceFastPolicy(
      [slower, faster],
      [slowerQualification, fasterQualification],
    ),
    decision,
  );

  const unsafe = jsonClone(faster);
  const amplified = requireJsonObject(
    requireJsonObject(unsafe['semantic'])['amplifiedFailures'],
  ) as unknown as Record<string, JsonValue>;
  amplified['exactSafetyFailures'] = 1;
  assert.equal(qualifyServiceFastPolicyResult(unsafe)['qualifies'], false);
  assert.deepEqual(
    decideServiceFastPolicy([unsafe], [qualifyServiceFastPolicyResult(unsafe)]),
    {
      status: 'strict-reference-fallback',
      policyId: null,
      fallbackDecisionId: 'strict-reference-fallback',
      rankedQualifyingPolicyIds: [],
      reason: 'trustworthy-complete-no-policy-qualified',
    },
  );
});

void test('manifest, README, and result envelopes recompute deterministically', () => {
  const environment = verifierEnvironment();
  const decision: JsonObject = Object.freeze({
    status: 'strict-reference-fallback',
    policyId: null,
    fallbackDecisionId: 'strict-reference-fallback',
    rankedQualifyingPolicyIds: Object.freeze([]),
    reason: 'trustworthy-complete-no-policy-qualified',
  });
  const inputBytes = ENCODER.encode('{"input":true}\n');
  const inputArtifact: ArtifactDescriptor = Object.freeze({
    path: SERVICE_FAST_INPUT_PATH,
    bytes: inputBytes.byteLength,
    sha256: sha256Bytes(inputBytes),
  });
  const closureBytes = ENCODER.encode('{"closure":true}\n');
  const closure: AdmittedSourceClosure = Object.freeze({
    value: Object.freeze({ observationPerformed: false }),
    bytes: closureBytes,
    descriptor: Object.freeze({
      path: SERVICE_FAST_SOURCE_CLOSURE_PATH,
      bytes: closureBytes.byteLength,
      sha256: sha256Bytes(closureBytes),
    }),
    implementationInputRevision: 'd'.repeat(40),
    inputArtifact,
  });
  const readme = renderServiceFastReadme({
    implementationRevision: closure.implementationInputRevision,
    inputArtifact,
    sourceClosure: closure.descriptor,
    environment,
    decision,
  });
  const readmeBytes = ENCODER.encode(readme);
  const manifestBytes = ENCODER.encode('{"retainedManifest":true}\n');
  const retained = new Map<string, ArtifactDescriptor>();
  for (const contract of serviceFastRetainedFileContracts()) {
    const bytes = contract.name === 'inputs.ndjson'
      ? inputBytes
      : contract.name === 'README.md'
        ? readmeBytes
        : contract.name === 'manifest.json'
          ? manifestBytes
          : ENCODER.encode(`${JSON.stringify({ name: contract.name })}\n`);
    retained.set(contract.name, Object.freeze({
      path: `${SERVICE_FAST_RETAINED_DIRECTORY}/${contract.name}`,
      bytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    }));
  }
  const analysis: JsonObject = Object.freeze({ decision });
  const recompute = () => recomputeManifest({
    config: configDescriptor(),
    artifactSchema: artifactSchemaDescriptor(),
    sourceClosure: closure,
    inputArtifact,
    retained,
    analysis,
    environment,
    manifestBytes,
    readmeBytes,
  });
  const first = recompute();
  const second = recompute();
  assert.deepEqual(first, second);
  assert.equal(first.manifest['schemaVersion'],
    'routelab.service-fast-numerical-manifest.v1');
  const artifacts = requireJsonArray(first.manifest['artifacts']).map(
    requireJsonObject,
  );
  assert.deepEqual(
    artifacts.map((entry) => entry['name']),
    [
      'inputs.ndjson',
      'semantic-results.ndjson',
      'call-timing-observations.ndjson',
      'incumbent-timeline-observations.ndjson',
      'deadline-observations.ndjson',
      'analysis.json',
      'README.md',
    ],
  );
  assert.equal(artifacts.some((entry) => entry['name'] === 'manifest.json'), false);
  for (const entry of artifacts) {
    const contract = serviceFastRetainedFileContracts().find(({ name }) =>
      name === entry['name']);
    assert.notEqual(contract, undefined);
    assert.equal(entry['recordCount'], contract?.recordCount);
    assert.equal(entry['schemaVersion'], contract?.schemaVersion);
  }
  assert.equal(first.aggregates.manifestSha256, sha256Bytes(manifestBytes));
  assert.equal(
    first.aggregates.semanticAggregate,
    retained.get('semantic-results.ndjson')?.sha256,
  );
  assert.equal(first.aggregates.decisionStatus, 'strict-reference-fallback');
  assert.equal(first.aggregates.decisionIdentity, 'strict-reference-fallback');
  assert.equal(
    encodeVerificationSuccess(first.aggregates),
    `${JSON.stringify({
      ok: true,
      experimentId: 'm7c-core12-service-fast-numerical-v1',
      manifestSha256: first.aggregates.manifestSha256,
      semanticAggregate: first.aggregates.semanticAggregate,
      operationalAggregate: first.aggregates.operationalAggregate,
      analysisAggregate: first.aggregates.analysisAggregate,
      decisionStatus: 'strict-reference-fallback',
      decisionIdentity: 'strict-reference-fallback',
    })}\n`,
  );

  assert.throws(() => recomputeManifest({
    config: configDescriptor(),
    artifactSchema: artifactSchemaDescriptor(),
    sourceClosure: closure,
    inputArtifact,
    retained,
    analysis,
    environment,
    manifestBytes,
    readmeBytes: ENCODER.encode(`${readme}mutation`),
  }), TypeError);
  const missing = new Map(retained);
  missing.delete('analysis.json');
  assert.throws(() => recomputeManifest({
    config: configDescriptor(),
    artifactSchema: artifactSchemaDescriptor(),
    sourceClosure: closure,
    inputArtifact,
    retained: missing,
    analysis,
    environment,
    manifestBytes,
    readmeBytes,
  }), TypeError);
});
