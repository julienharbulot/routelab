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
const EXPECTED_CONFIG_BYTES = 62_014;
const EXPECTED_CONFIG_SHA256 =
  '191bce2ff6a39cc7cbef5ce233c3b322b6eb04747e41965e7764298cb206edac';
const EXPECTED_ARTIFACT_SCHEMA_BYTES = 64_860;
const EXPECTED_ARTIFACT_SCHEMA_SHA256 =
  'ab4291f2fdb4fe3640b865e584a27ccbb6894b5f7cc8ee987fc8234e08c9fe1d';

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
