import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
  CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
  CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH,
  createHistoricalNumericalSplitEvaluation,
  verifyHistoricalNumericalSplitEvaluation,
  type HistoricalNumericalSplitEvaluationArtifacts,
  type HistoricalNumericalSplitEvaluationErrorCode,
} from '../src/benchmark/historical-numerical-split/index.ts';

type JsonRecord = Record<string, unknown>;
type Files = Map<string, Uint8Array>;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG_SHA256 = '96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6';
const ELIGIBILITY_SHA256 = '5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc';
const COUNTER_FIELDS = [
  'directCandidates', 'directCandidateReplays', 'directCandidateRejections',
  'pathExpansions', 'bestSingleCandidateReplays', 'bestSingleCandidateRejections',
  'candidateSetExpansions', 'equalProposalReplays', 'equalProposalRejections',
  'greedyOptionReplays', 'greedyOptionRejections', 'finalAuthorizationReplays',
  'finalAuthorizationRejections', 'numericalProposals', 'numericalProposalFailures',
  'numericalIterations', 'numericalResidualReplays', 'numericalResidualReplayRejections',
  'numericalAuthorizationReplays', 'numericalAuthorizationReplayRejections',
] as const;

function record(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function array(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const readCounts = new Map<string, number>();
const generatedPromise = createHistoricalNumericalSplitEvaluation({
  readFile(filePath: string): Promise<Uint8Array> {
    readCounts.set(filePath, (readCounts.get(filePath) ?? 0) + 1);
    return new Promise((resolve, reject) => {
      readFile(path.join(ROOT, filePath), (error, bytes) => {
        if (error) reject(error);
        else resolve(Uint8Array.from(bytes));
      });
    });
  },
});

async function generatedArtifacts(): Promise<HistoricalNumericalSplitEvaluationArtifacts> {
  const result = await generatedPromise;
  if (!result.ok) assert.fail(`${result.error.code}/${result.error.artifact}`);
  return result.value;
}

function persistedFiles(artifacts: HistoricalNumericalSplitEvaluationArtifacts): Files {
  const encoder = new TextEncoder();
  return new Map([
    [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'manifest.json'),
      encoder.encode(artifacts.manifestJson)],
    [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'semantic-results.json'),
      encoder.encode(artifacts.semanticResultsJson)],
  ]);
}

function layeredReader(files: Files) {
  return async (filePath: string): Promise<Uint8Array> => {
    const override = files.get(filePath);
    if (override !== undefined) return Uint8Array.from(override);
    return Uint8Array.from(await import('node:fs/promises').then(({ readFile: read }) =>
      read(path.join(ROOT, filePath))));
  };
}

async function expectCode(
  artifacts: HistoricalNumericalSplitEvaluationArtifacts,
  files: Files,
  code: HistoricalNumericalSplitEvaluationErrorCode,
): Promise<void> {
  const result = await verifyHistoricalNumericalSplitEvaluation(
    CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
    { readFile: layeredReader(new Map([...persistedFiles(artifacts), ...files])) },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.doesNotMatch(result.error.message, /ENOENT|\/tmp\/|Error:/u);
}

void test('freezes the exact result-blind comparison and eligibility artifacts', () => {
  const config = readFileSync(path.join(ROOT, CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH));
  assert.equal(config.byteLength, 4_650);
  assert.equal(createHash('sha256').update(config).digest('hex'), CONFIG_SHA256);
  assert.notEqual(config.at(-1), 0x0a);

  const eligibility = readFileSync(path.join(ROOT, CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH));
  assert.equal(eligibility.byteLength, 261_915);
  assert.equal(createHash('sha256').update(eligibility).digest('hex'), ELIGIBILITY_SHA256);
  assert.notEqual(eligibility.at(-1), 0x0a);
});

void test('retains all cells, full exact objectives/results, work and the mechanical decision', async () => {
  const artifacts = await generatedArtifacts();
  const semantic = record(JSON.parse(artifacts.semanticResultsJson) as unknown);
  const cells = array(semantic['cells']).map(record);
  assert.equal(cells.length, 2_376);
  assert.equal(cells[0]?.['objectiveRelation'], 'not-evaluated');
  assert.equal(Object.hasOwn(cells[0] ?? {}, 'result'), false);

  const eligible = cells.filter((cell) => record(cell['eligibility'])['status'] === 'eligible');
  assert.equal(eligible.length, 414);
  const firstEligible = eligible[0];
  assert.ok(firstEligible);
  const objective = record(record(firstEligible['baseline'])['objective']);
  const tuple = record(objective['tuple']);
  assert.deepEqual(Object.keys(tuple), [
    'amountOut', 'legCount', 'totalHops', 'routeSequence', 'allocations',
  ]);
  const result = record(firstEligible['result']);
  const search = record(record(result['plan'])['search']);
  assert.deepEqual(Object.keys(record(search['counters'])), COUNTER_FIELDS);
  assert.ok(array(search['numericalDiagnostics']).length > 0);
  assert.match(firstEligible['semanticHash'] as string, /^sha256:[0-9a-f]{64}$/u);

  assert.equal(artifacts.summary.eligibleCellCount, 414);
  assert.equal(artifacts.summary.ineligibleCellCount, 1_962);
  assert.deepEqual(artifacts.summary.objectiveRelations, {
    'strictly-improved': 318,
    equal: 96,
    regressed: 0,
  });
  assert.equal(artifacts.summary.strictlyImprovedRequestCount, 307);
  assert.deepEqual(artifacts.summary.diagnosticStatuses, {
    failed: 2_868,
    'not-better': 7_664,
    improved: 496,
  });
  assert.equal(artifacts.summary.decision.mode, 'primary');
  assert.deepEqual(artifacts.summary.decision.clauses, {
    noEligibleObjectiveRegressions: true,
    forcedFailuresPreserveBaseline: true,
    allEligibleCandidateSetsHaveTerminalDiagnostics: true,
    atLeastOneEligibleRequestStrictlyImprovesExactOutput: true,
  });
  assert.equal(artifacts.semanticResultsJson.includes('elapsed'), false);
  assert.equal(artifacts.semanticResultsJson.includes('runtimeRevision'), false);
  assert.equal(Object.isFrozen(artifacts), true);
  assert.equal(Object.isFrozen(artifacts.summary.counterTotals), true);
  for (const [filePath, count] of readCounts) {
    assert.equal(count, 1, filePath);
  }
});

void test('fresh verification reproduces exact bytes and rejects tampering in order', async () => {
  const artifacts = await generatedArtifacts();
  const files = persistedFiles(artifacts);
  const verified = await verifyHistoricalNumericalSplitEvaluation(
    CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
    { readFile: layeredReader(files) },
  );
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.value.semanticResultsSha256, sha256(artifacts.semanticResultsJson));
  }

  const missingManifest = new Map<string, Uint8Array>();
  missingManifest.set(
    path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'manifest.json'),
    new TextEncoder().encode('{}'),
  );
  await expectCode(artifacts, missingManifest, 'invalid-manifest-shape');

  const changedSemantic = record(JSON.parse(artifacts.semanticResultsJson) as unknown);
  record(array(changedSemantic['cells'])[0])['semanticHash'] = `sha256:${'0'.repeat(64)}`;
  const changedSemanticJson = JSON.stringify(changedSemantic);
  const changedManifest = record(JSON.parse(artifacts.manifestJson) as unknown);
  const descriptor = record(record(changedManifest['artifacts'])['semanticResults']);
  descriptor['bytes'] = Buffer.byteLength(changedSemanticJson);
  descriptor['sha256'] = sha256(changedSemanticJson);
  await expectCode(artifacts, new Map([
    [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'manifest.json'),
      new TextEncoder().encode(JSON.stringify(changedManifest))],
    [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'semantic-results.json'),
      new TextEncoder().encode(changedSemanticJson)],
  ]), 'semantic-replay-mismatch');
});
