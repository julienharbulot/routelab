import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
  CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
  CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH,
  CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH,
  createHistoricalNumericalSplitEvaluation,
  deriveHistoricalNumericalSplitDecision,
  validateHistoricalNumericalForcedFailureEvidenceDocument,
  validateHistoricalNumericalForcedFailureSource,
  verifyHistoricalNumericalSplitEvaluation,
  type HistoricalNumericalSplitEvaluationArtifacts,
  type HistoricalNumericalSplitEvaluationErrorCode,
} from '../src/benchmark/historical-numerical-split/index.ts';

type JsonRecord = Record<string, unknown>;
type Files = Map<string, Uint8Array>;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG_SHA256 = '96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6';
const ELIGIBILITY_SHA256 = '5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc';
const EVIDENCE_SHA256 = 'e2a3ccf161ac33b938da45e1e50569fdbe6b28d34268b468b6dfd24a45d2c4e7';
const SOURCE = 'tests/oracle/numerical-exact-input-split-runtime-oracle.test.ts';
const SOURCE_SHA256 = '4f4ca6c3c0d0dd42b4a5ce8731bbdeb9d351e1d59e719ff60ed0f14eafdcb2e2';
const CORPUS_MANIFEST =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/manifest.json';
const FORCED_FAILURE_BINDING = {
  evidenceId: 'm7a-numerical-runtime-forced-failure-baseline-preservation-v1',
  path: CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
  bytes: 2_721,
  sha256: `sha256:${EVIDENCE_SHA256}`,
  source: {
    path: SOURCE,
    bytes: 52_464,
    sha256: `sha256:${SOURCE_SHA256}`,
    testCount: 13,
  },
} as const;
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

function layeredReader(files: Files, missing: ReadonlySet<string> = new Set()) {
  return async (filePath: string): Promise<Uint8Array> => {
    if (missing.has(filePath)) throw new Error('unavailable test artifact');
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
  missing: ReadonlySet<string> = new Set(),
): Promise<void> {
  const result = await verifyHistoricalNumericalSplitEvaluation(
    CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY,
    { readFile: layeredReader(new Map([...persistedFiles(artifacts), ...files]), missing) },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.doesNotMatch(result.error.message, /ENOENT|\/tmp\/|Error:/u);
}

async function expectGenerationCode(
  files: Files,
  missing: ReadonlySet<string>,
  code: HistoricalNumericalSplitEvaluationErrorCode,
): Promise<void> {
  const result = await createHistoricalNumericalSplitEvaluation({
    readFile: layeredReader(files, missing),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.doesNotMatch(result.error.message, /ENOENT|\/tmp\/|Error:/u);
}

function filesWithDeclaredEvidence(
  artifacts: HistoricalNumericalSplitEvaluationArtifacts,
  evidenceBytes: Uint8Array,
): Files {
  const manifest = record(JSON.parse(artifacts.manifestJson) as unknown);
  const evidenceDescriptor = record(record(manifest['artifacts'])['forcedFailureEvidence']);
  evidenceDescriptor['bytes'] = evidenceBytes.byteLength;
  evidenceDescriptor['sha256'] = sha256(evidenceBytes);
  return new Map([
    [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'manifest.json'),
      new TextEncoder().encode(JSON.stringify(manifest))],
    [CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH, evidenceBytes],
  ]);
}

void test('freezes exact result-blind inputs and retained forced-failure source evidence', () => {
  const config = readFileSync(path.join(ROOT, CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH));
  assert.equal(config.byteLength, 4_650);
  assert.equal(createHash('sha256').update(config).digest('hex'), CONFIG_SHA256);
  assert.notEqual(config.at(-1), 0x0a);

  const eligibility = readFileSync(path.join(ROOT, CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH));
  assert.equal(eligibility.byteLength, 261_915);
  assert.equal(createHash('sha256').update(eligibility).digest('hex'), ELIGIBILITY_SHA256);
  assert.notEqual(eligibility.at(-1), 0x0a);

  const evidence = readFileSync(path.join(ROOT, CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH));
  assert.equal(evidence.byteLength, 2_721);
  assert.equal(createHash('sha256').update(evidence).digest('hex'), EVIDENCE_SHA256);
  assert.notEqual(evidence.at(-1), 0x0a);

  const source = readFileSync(path.join(ROOT, SOURCE));
  assert.equal(source.byteLength, 52_464);
  assert.equal(createHash('sha256').update(source).digest('hex'), SOURCE_SHA256);
});

void test('strictly validates evidence order, names, outcomes and retained source tests', () => {
  const evidence = record(JSON.parse(readFileSync(
    path.join(ROOT, CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH),
    'utf8',
  )) as unknown);
  assert.equal(validateHistoricalNumericalForcedFailureEvidenceDocument(evidence), true);
  const cases = array(evidence['cases']).map(record);
  assert.equal(cases.length, 10);
  assert.deepEqual(evidence['source'], FORCED_FAILURE_BINDING.source);
  assert.deepEqual(cases.map((current) => current['scenario']), [
    'missing-baseline-suppresses-numerical-work',
    'natural-model-and-replay-outcomes',
    'normalization-iteration-underflow-and-convergence-failures',
    'numerical-cap-stops',
    'cap-callback-clock-precedence',
    'callback-stops-and-callback-failures',
    'deadline-and-clock-failures',
    'forced-proposal-core-failures',
    'authorization-rejection-and-mismatch',
    'mutation-reentrancy-and-freshness',
  ]);

  const reordered = structuredClone(evidence);
  const reorderedCases = array(reordered['cases']) as JsonRecord[];
  [reorderedCases[0], reorderedCases[1]] = [reorderedCases[1]!, reorderedCases[0]!];
  assert.equal(validateHistoricalNumericalForcedFailureEvidenceDocument(reordered), false);

  const renamed = structuredClone(evidence);
  record(array(renamed['cases'])[0])['testName'] = 'renamed retained test';
  assert.equal(validateHistoricalNumericalForcedFailureEvidenceDocument(renamed), false);

  const unfavorable = structuredClone(evidence);
  record(array(unfavorable['cases'])[0])['outcome'] = 'baseline-not-preserved';
  assert.equal(validateHistoricalNumericalForcedFailureEvidenceDocument(unfavorable), false);

  const reorderedRoot: JsonRecord = {
    evidenceId: evidence['evidenceId'],
    schemaVersion: evidence['schemaVersion'],
    decisionClause: evidence['decisionClause'],
    runtimeRevision: evidence['runtimeRevision'],
    source: evidence['source'],
    rule: evidence['rule'],
    cases: evidence['cases'],
    limitations: evidence['limitations'],
  };
  assert.equal(validateHistoricalNumericalForcedFailureEvidenceDocument(reorderedRoot), false);

  const sourceText = readFileSync(path.join(ROOT, SOURCE), 'utf8');
  const requiredNames = cases.map((current) => current['testName'] as string);
  assert.equal(validateHistoricalNumericalForcedFailureSource(sourceText, requiredNames, 13), true);
  assert.equal(
    validateHistoricalNumericalForcedFailureSource(
      sourceText.replace(requiredNames[0]!, 'renamed retained test'),
      requiredNames,
      13,
    ),
    false,
  );
  assert.equal(validateHistoricalNumericalForcedFailureSource(sourceText, requiredNames, 12), false);
});

void test('derives and retains an unfavorable forced-failure clause without a vacuous pass', () => {
  const preserved = Array.from({ length: 10 }, () => 'baseline-preserved' as const);
  assert.deepEqual(
    deriveHistoricalNumericalSplitDecision(true, preserved, true, true),
    {
      mode: 'primary',
      clauses: {
        noEligibleObjectiveRegressions: true,
        forcedFailuresPreserveBaseline: true,
        allEligibleCandidateSetsHaveTerminalDiagnostics: true,
        atLeastOneEligibleRequestStrictlyImprovesExactOutput: true,
      },
    },
  );
  const unfavorable: Array<'baseline-preserved' | 'baseline-not-preserved'> = [...preserved];
  unfavorable[4] = 'baseline-not-preserved';
  assert.deepEqual(
    deriveHistoricalNumericalSplitDecision(true, unfavorable, true, true),
    {
      mode: 'experimental',
      clauses: {
        noEligibleObjectiveRegressions: true,
        forcedFailuresPreserveBaseline: false,
        allEligibleCandidateSetsHaveTerminalDiagnostics: true,
        atLeastOneEligibleRequestStrictlyImprovesExactOutput: true,
      },
    },
  );
  assert.equal(
    deriveHistoricalNumericalSplitDecision(true, [], true, true).clauses
      .forcedFailuresPreserveBaseline,
    false,
  );
});

void test('retains all cells, full exact objectives/results, work and the mechanical decision', async () => {
  const artifacts = await generatedArtifacts();
  const semantic = record(JSON.parse(artifacts.semanticResultsJson) as unknown);
  const manifest = record(JSON.parse(artifacts.manifestJson) as unknown);
  assert.deepEqual(
    record(semantic['inputBinding'])['forcedFailureEvidence'],
    FORCED_FAILURE_BINDING,
  );
  assert.deepEqual(
    record(manifest['inputBinding'])['forcedFailureEvidence'],
    FORCED_FAILURE_BINDING,
  );
  assert.deepEqual(record(record(manifest['artifacts'])['forcedFailureEvidence']), {
    path: CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH,
    bytes: 2_721,
    sha256: `sha256:${EVIDENCE_SHA256}`,
  });
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
  const cellHashBinding = {
    snapshotChecksum: 'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755',
    corpusSha256: 'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173',
    comparisonConfigSha256: `sha256:${CONFIG_SHA256}`,
    eligibilitySha256: `sha256:${ELIGIBILITY_SHA256}`,
    forcedFailureEvidence: FORCED_FAILURE_BINDING,
    baselineSemanticResultsSha256:
      'sha256:28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e',
  };
  for (const cell of [cells[0], firstEligible]) {
    const hashValue = {
      schemaVersion: 'routelab.numerical-historical-semantic-cell.v1',
      inputBinding: cellHashBinding,
      request: cell['request'],
      profile: cell['profile'],
      numericalConfiguration: cell['numericalConfiguration'],
      baseline: cell['baseline'],
      eligibility: cell['eligibility'],
      objectiveRelation: cell['objectiveRelation'],
      ...(Object.hasOwn(cell, 'result') ? { result: cell['result'] } : {}),
    };
    assert.equal(cell['semanticHash'], sha256(JSON.stringify(hashValue)));
  }

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
  const readOrder = [...readCounts.keys()];
  const configIndex = readOrder.indexOf(CANONICAL_NUMERICAL_HISTORICAL_COMPARISON_CONFIG_PATH);
  const eligibilityIndex = readOrder.indexOf(CANONICAL_NUMERICAL_HISTORICAL_ELIGIBILITY_PATH);
  const evidenceIndex = readOrder.indexOf(CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH);
  const sourceIndex = readOrder.indexOf(SOURCE);
  const corpusIndex = readOrder.indexOf(CORPUS_MANIFEST);
  assert.equal(
    configIndex >= 0
    && configIndex < eligibilityIndex
    && eligibilityIndex < evidenceIndex
    && evidenceIndex < sourceIndex
    && sourceIndex < corpusIndex,
    true,
  );
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

void test('rejects forced-failure evidence and source failures before corpus work', async () => {
  const evidence = Uint8Array.from(readFileSync(
    path.join(ROOT, CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH),
  ));
  const source = Uint8Array.from(readFileSync(path.join(ROOT, SOURCE)));

  await expectGenerationCode(
    new Map(),
    new Set([CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH, CORPUS_MANIFEST]),
    'forced-failure-evidence-read-failed',
  );
  await expectGenerationCode(
    new Map([[CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH, new TextEncoder().encode('{}')]]),
    new Set(),
    'forced-failure-evidence-size-mismatch',
  );
  const changedEvidence = Uint8Array.from(evidence);
  changedEvidence[100] = (changedEvidence[100] ?? 0) ^ 1;
  await expectGenerationCode(
    new Map([[CANONICAL_NUMERICAL_FORCED_FAILURE_EVIDENCE_PATH, changedEvidence]]),
    new Set(),
    'forced-failure-evidence-hash-mismatch',
  );

  await expectGenerationCode(
    new Map(),
    new Set([SOURCE, CORPUS_MANIFEST]),
    'forced-failure-source-read-failed',
  );
  await expectGenerationCode(
    new Map([[SOURCE, source.slice(0, -1)]]),
    new Set(),
    'forced-failure-source-size-mismatch',
  );
  const changedSource = Uint8Array.from(source);
  changedSource[100] = (changedSource[100] ?? 0) ^ 1;
  await expectGenerationCode(
    new Map([[SOURCE, changedSource]]),
    new Set(),
    'forced-failure-source-hash-mismatch',
  );
});

void test('rejects declared evidence JSON, shape and manifest tampering before semantic replay', async () => {
  const artifacts = await generatedArtifacts();
  const invalidJson = new TextEncoder().encode('{');
  await expectCode(
    artifacts,
    filesWithDeclaredEvidence(artifacts, invalidJson),
    'invalid-forced-failure-evidence-json',
  );
  const invalidShape = new TextEncoder().encode('{}');
  await expectCode(
    artifacts,
    filesWithDeclaredEvidence(artifacts, invalidShape),
    'invalid-forced-failure-evidence-shape',
  );

  const manifest = record(JSON.parse(artifacts.manifestJson) as unknown);
  record(record(manifest['artifacts'])['forcedFailureEvidence'])['sha256'] =
    `sha256:${'0'.repeat(64)}`;
  const changedSemantic = new TextEncoder().encode('{}');
  await expectCode(
    artifacts,
    new Map([
      [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'manifest.json'),
        new TextEncoder().encode(JSON.stringify(manifest))],
      [path.join(CANONICAL_HISTORICAL_NUMERICAL_SPLIT_EVALUATION_DIRECTORY, 'semantic-results.json'),
        changedSemantic],
    ]),
    'forced-failure-evidence-hash-mismatch',
  );
});
