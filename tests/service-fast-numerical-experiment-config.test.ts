import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = path.join(
  ROOT,
  'fixtures/m7c/service-fast-numerical/experiment-config.v1.json',
);
const ARTIFACT_SCHEMA = path.join(
  ROOT,
  'fixtures/m7c/service-fast-numerical/experiment-artifact-schema.v1.json',
);
const VERIFIER = path.join(ROOT, 'cli/verify-service-fast-numerical-experiment-config.ts');
const EXPECTED_CONFIG_BYTES = 68_175;
const EXPECTED_CONFIG_SHA256 =
  'd21a2156f3a291a52f9888a567d6b3f7372afacccb5dfc457292d7145e3842ac';
const EXPECTED_ARTIFACT_SCHEMA_BYTES = 65_692;
const EXPECTED_ARTIFACT_SCHEMA_SHA256 =
  'ab5620110543f5fc5d7e032a4069c1693f95251dbe50ea848fca773b2b80f626';

function assertBytesAndHash(
  filePath: string,
  expectedBytes: number,
  expectedSha256: string,
): void {
  const bytes = readFileSync(filePath);
  assert.equal(bytes.length, expectedBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha256);
}

void test('the output-free service-fast experiment config verifies without candidate code', () => {
  const verifierSource = readFileSync(VERIFIER, 'utf8');
  const importSpecifiers = [...verifierSource.matchAll(/from '([^']+)'/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(importSpecifiers, [
    'node:child_process',
    'node:crypto',
    'node:fs',
    'node:path',
    'node:url',
  ]);
  assert.doesNotMatch(verifierSource, /service-fast-path-shadow-price/u);
  assert.doesNotMatch(verifierSource, /bounded-exact-split-repair/u);
  assert.doesNotMatch(verifierSource, /service-fast-numerical-experiment(?!-config)/u);

  assertBytesAndHash(CONFIG, EXPECTED_CONFIG_BYTES, EXPECTED_CONFIG_SHA256);
  assertBytesAndHash(
    ARTIFACT_SCHEMA,
    EXPECTED_ARTIFACT_SCHEMA_BYTES,
    EXPECTED_ARTIFACT_SCHEMA_SHA256,
  );

  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
    readonly observationPerformed?: unknown;
    readonly observationState?: {
      readonly acceptedCorpusObservationAuthorizedByThisConfigAlone?: unknown;
    };
  };
  assert.equal(config.observationPerformed, false);
  assert.equal(
    config.observationState?.acceptedCorpusObservationAuthorizedByThisConfigAlone,
    false,
  );

  const result = spawnSync(process.execPath, [VERIFIER], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified output-free service-fast experiment config/u);

  const unexpectedArgument = spawnSync(process.execPath, [VERIFIER, 'unexpected'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(unexpectedArgument.status, 0);
  assert.match(unexpectedArgument.stderr, /unexpected command arguments/u);
});

void test('the publication and operational-width admission is closed before observation', () => {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
    readonly runtime: {
      readonly clockAdmission: {
        readonly maximumNanosecondDecimalDigits: number;
        readonly maximumNanosecondValue: string;
        readonly absoluteDeadlines: string;
      };
      readonly recordOnlyAdmission: Readonly<Record<string, string>>;
    };
    readonly cohorts: {
      readonly operational: { readonly perCaseCounts: Readonly<Record<string, number>> };
    };
    readonly artifacts: {
      readonly publication: Readonly<Record<string, string>>;
      readonly sizeAdmission: { readonly operationalEnvelope: Readonly<Record<string, unknown>> };
    };
  };
  const schema = JSON.parse(readFileSync(ARTIFACT_SCHEMA, 'utf8')) as {
    readonly primitiveCodecs: Readonly<Record<string, string>>;
    readonly enums: { readonly decisionReason: readonly string[] };
    readonly objectSchemas: readonly {
      readonly schemaId: string;
      readonly fields: readonly (readonly [string, string])[];
    }[];
  };

  assert.deepEqual(Object.keys(config.artifacts.publication), [
    'atomicVisibility',
    'coordinationScope',
    'filesystemPrecondition',
    'lockPath',
    'lockAcquisition',
    'destinationChecks',
    'staging',
    'failurePrecedence',
    'commitPoint',
    'preCommitFailure',
    'postCommitFailure',
    'externalRaceDisposition',
  ]);
  assert.match(config.artifacts.publication['lockAcquisition'] ?? '', /before-any-candidate-call/u);
  assert.match(config.artifacts.publication['preCommitFailure'] ?? '', /retain-the-lock/u);
  assert.match(config.artifacts.publication['coordinationScope'] ?? '', /cooperating-tool-instances/u);
  assert.match(
    config.artifacts.publication['externalRaceDisposition'] ?? '',
    /no-atomic-no-overwrite-guarantee/u,
  );

  const maximumNanosecondValue = '9'.repeat(20);
  const maximumNanoseconds = BigInt(maximumNanosecondValue);
  assert.equal(config.runtime.clockAdmission.maximumNanosecondDecimalDigits, 20);
  assert.equal(config.runtime.clockAdmission.maximumNanosecondValue, maximumNanosecondValue);
  assert.match(config.runtime.clockAdmission.absoluteDeadlines, /before-any-candidate-action/u);
  assert.deepEqual(config.runtime.recordOnlyAdmission, {
    cpuSpeedMHz: 'safe-nonnegative-integer-at-most-9007199254740991',
    totalMemoryBytes:
      'canonical-positive-decimal-at-most-9007199254740991-and-at-most-16-decimal-digits',
    timezone: 'nonempty-json-string-at-most-128-utf8-bytes',
  });

  const validNanoseconds = (value: string): boolean =>
    /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= maximumNanoseconds;
  const validMemory = (value: string): boolean =>
    /^[1-9][0-9]{0,15}$/u.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
  const validTimezone = (value: string): boolean =>
    value.length > 0 && Buffer.byteLength(value, 'utf8') <= 128;
  const validMetricSigned = (value: string): boolean =>
    /^(0|-?[1-9][0-9]{0,22})$/u.test(value);
  const validMetricPositive = (value: string): boolean =>
    /^[1-9][0-9]{0,22}$/u.test(value);

  assert.equal(validNanoseconds(maximumNanosecondValue), true);
  assert.equal(validNanoseconds(`1${maximumNanosecondValue}`), false);
  assert.equal(validMemory(Number.MAX_SAFE_INTEGER.toString(10)), true);
  assert.equal(validMemory('0'), false);
  assert.equal(validMemory('9007199254740992'), false);
  assert.equal(validMemory('10000000000000000'), false);
  assert.equal(validTimezone('x'.repeat(128)), true);
  assert.equal(validTimezone(''), false);
  assert.equal(validTimezone('x'.repeat(129)), false);
  assert.equal(Buffer.byteLength(JSON.stringify('\u0000'.repeat(128)), 'utf8') - 2, 768);

  const perCaseMaximum = Math.max(...Object.values(config.cohorts.operational.perCaseCounts));
  const evenMedianMaximum = 2n * maximumNanoseconds;
  const caseSumMaximum = BigInt(perCaseMaximum) * maximumNanoseconds;
  assert.equal(perCaseMaximum, 108);
  assert.equal(evenMedianMaximum.toString(10).length, 21);
  assert.equal(caseSumMaximum, 10_799_999_999_999_999_999_892n);
  assert.equal(caseSumMaximum.toString(10).length, 23);
  assert.equal(validMetricSigned(`-${caseSumMaximum.toString(10)}`), true);
  assert.equal(validMetricPositive(caseSumMaximum.toString(10)), true);
  assert.equal(validMetricSigned(`1${caseSumMaximum.toString(10)}`), false);
  assert.equal(validMetricPositive(`1${caseSumMaximum.toString(10)}`), false);
  assert.equal(maximumNanoseconds - 100_000_000n + 100_000_000n <= maximumNanoseconds, true);
  assert.equal(maximumNanoseconds + 100_000_000n <= maximumNanoseconds, false);

  assert.equal(
    schema.primitiveCodecs['nanoseconds'],
    'json-string-regex-^(0|[1-9][0-9]{0,19})$-maximum-20-decimal-digits-and-maximum-value-99999999999999999999',
  );
  assert.deepEqual(schema.enums.decisionReason, [
    'highest-ranked-qualifying-policy',
    'trustworthy-complete-no-policy-qualified',
    'incomplete-or-untrustworthy-observation',
  ]);
  const fields = (schemaId: string): ReadonlyMap<string, string> =>
    new Map(schema.objectSchemas.find((value) => value.schemaId === schemaId)?.fields ?? []);
  assert.equal(fields('ExactRational').get('numerator'), 'primitive:boundedMetricSignedDecimal');
  assert.equal(fields('ExactRational').get('denominator'), 'primitive:boundedMetricPositiveDecimal');
  assert.equal(fields('Environment').get('totalMemoryBytes'), 'primitive:recordOnlyTotalMemoryBytes');
  assert.equal(fields('Environment').get('timezone'), 'primitive:recordOnlyTimezone');
  assert.equal(fields('Decision').get('reason'), 'enum:decisionReason');
  assert.equal(config.artifacts.sizeAdmission.operationalEnvelope['readmeAdmission'],
    'fixed-template-dry-serialized-with-maximal-config-and-committed-input-derived-widths-before-source-closure');
});

void test('the compact semantic record has an output-independent uniform cap proof', () => {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
    readonly artifacts: {
      readonly sizeAdmission: {
        readonly uniformSemanticEnvelope: {
          readonly maximumSemanticRecordBytesIncludingLineFeed: number;
          readonly semanticRecordCount: number;
          readonly semanticFileCapBytes: number;
        };
      };
    };
  };
  const hash = `sha256:${'f'.repeat(64)}`;
  const structuralInteger = Number.MAX_SAFE_INTEGER;
  const counters = Array<number>(12).fill(structuralInteger);
  const proposal = {
    status: 'failed',
    failureCode: 'finite-nonconverged-replayed',
    converged: false,
    completedOuterIterations: structuralInteger,
    weightBits: Array<string>(4).fill('f'.repeat(16)),
    reconstructionHash: hash,
  };
  const currentScore = {
    status: 'rejected',
    failureCode: 'finite-nonconverged-replayed',
    selectedAttemptIndex: structuralInteger,
    receiptHash: hash,
    scoreTranscriptHash: hash,
  };
  const authorization = {
    status: 'not-attempted',
    receiptHash: hash,
    failureCode: 'finite-nonconverged-replayed',
  };
  const repair = {
    status: 'incomplete',
    attemptedNeighbors: structuralInteger,
    rejectedNeighbors: structuralInteger,
    winnerAttemptIndex: structuralInteger,
    winnerReceiptHash: hash,
    failureCode: 'finite-nonconverged-replayed',
    scoreTranscriptHash: hash,
  };
  const candidateSetDiagnostics = Array.from({ length: 4 }, (_, setIndex) => ({
    setIndex: structuralInteger,
    resolutionStatus: 'resolved',
    terminalStatus: 'model-resolution-failed',
    failureCode: 'finite-nonconverged-replayed',
    proposal,
    currentScore,
    repair: setIndex === 0 ? repair : null,
    selectedScoreSource: 'current',
    reconstructionDisposition: 'current-only-nontarget',
    authorization,
    counters,
  }));
  const output = '9'.repeat(86);
  const bps = '9'.repeat(90);
  const maximalRecord = {
    schemaVersion: 'routelab.service-fast-numerical-semantic-result.v1',
    semanticIndex: structuralInteger,
    sourceIndex: structuralInteger,
    policyMatrixIndex: structuralInteger,
    entryIncumbentHash: hash,
    candidateSetDiagnostics,
    finalIncumbent: {
      origin: 'candidate-set',
      candidateSetIndex: structuralInteger,
      selectedScoreSource: 'current',
      selectedAttemptIndex: structuralInteger,
      objectiveHash: hash,
      receiptHash: hash,
    },
    anchorComparison: {
      relation: 'policy-objective-strictly-better',
      comparison: 'policy-better',
      anchorHasPlan: false,
      policyHasPlan: false,
    },
    exactRegret: {
      outputDelta: `-${output}`,
      bpsNumerator: `-${bps}`,
      bpsDenominator: output,
      integerBps: `-${bps}`,
    },
    counters,
    semanticHash: hash,
  };
  const envelope = config.artifacts.sizeAdmission.uniformSemanticEnvelope;
  const recordBytes = Buffer.byteLength(`${JSON.stringify(maximalRecord)}\n`, 'utf8');
  assert.equal(recordBytes, 6_961);
  assert.equal(recordBytes, envelope.maximumSemanticRecordBytesIncludingLineFeed);
  assert.equal(recordBytes * envelope.semanticRecordCount, 264_629_376);
  assert.ok(recordBytes * envelope.semanticRecordCount <= envelope.semanticFileCapBytes);
});

void test('the pre-output counter accounting is closed and non-overlapping', () => {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
    readonly semanticEvidence: {
      readonly counterOrder: readonly string[];
      readonly counterSemantics: Readonly<Record<string, string>>;
    };
  };
  const { counterOrder, counterSemantics } = config.semanticEvidence;
  assert.deepEqual(Object.keys(counterSemantics).slice(0, 12), counterOrder);
  assert.match(counterSemantics['shareActions'] ?? '', /every-endpoint-or-method-core/u);
  assert.match(counterSemantics['methodActions'] ?? '', /excluding-the-common-endpoint/u);
  assert.match(counterSemantics['outerUpdates'] ?? '', /final-recomputed-sample-is-not/u);
  assert.match(counterSemantics['counterMutation'] ?? '', /pending-action-is-uncharged/u);
  assert.match(counterSemantics['aggregateAccounting'] ?? '', /not-double-counted/u);
});
