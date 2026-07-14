import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ExperimentInputBuildError,
  SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS,
  constructAfterExperimentInputAdmission,
  parseExperimentInputRuntimeClosure,
  streamExperimentInputRecords,
  validateExperimentInputPublicationAccounting,
  verifyExperimentInputCommandManifest,
  verifyImmutableDescriptorBytes,
  type ExperimentInputOperations,
  type ExperimentInputRuntimeClosureContract,
  type ExperimentInputSource,
} from '../src/benchmark/service-fast-numerical-experiment/input/build.ts';
import {
  RuntimeImportAuditError,
  SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
  SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST,
  auditRuntimeImportClosure,
  readGitIndexTrackedPaths,
} from '../src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts';
import {
  encodeBinary64Bits,
  encodeCanonicalNdjsonRecord,
} from '../src/benchmark/service-fast-numerical-experiment/input/codec.ts';
import {
  InputPublicationError,
  defaultExclusivePublicationDependencies,
  publishExclusiveInputArtifact,
} from '../src/benchmark/service-fast-numerical-experiment/input/publication.ts';
import type { NumericalExactInputSplitRuntimeResult } from '../src/router/numerical-exact-input-split/index.ts';
import type { ExactInputSplitReplayReceipt } from '../src/replay/exact-input-split/index.ts';

const CHECKSUM = `sha256:${'1'.repeat(64)}`;
const EMPTY_HASH = identityHash([]);

const COUNTERS = Object.freeze({
  directCandidates: 1,
  directCandidateReplays: 1,
  directCandidateRejections: 0,
  pathExpansions: 1,
  bestSingleCandidateReplays: 1,
  bestSingleCandidateRejections: 0,
  candidateSetExpansions: 1,
  equalProposalReplays: 1,
  equalProposalRejections: 0,
  greedyOptionReplays: 16,
  greedyOptionRejections: 0,
  finalAuthorizationReplays: 1,
  finalAuthorizationRejections: 0,
  numericalProposals: 1,
  numericalProposalFailures: 0,
  numericalIterations: 64,
  numericalResidualReplays: 1,
  numericalResidualReplayRejections: 0,
  numericalAuthorizationReplays: 1,
  numericalAuthorizationReplayRejections: 0,
});

const RECEIPT: ExactInputSplitReplayReceipt = Object.freeze({
  snapshotId: 'snapshot-1',
  snapshotChecksum: CHECKSUM,
  assetIn: 'asset-a',
  assetOut: 'asset-b',
  amountIn: 10n,
  amountOut: 9n,
  legs: Object.freeze([
    Object.freeze({
      allocation: 10n,
      receipt: Object.freeze({
        snapshotId: 'snapshot-1',
        snapshotChecksum: CHECKSUM,
        assetIn: 'asset-a',
        assetOut: 'asset-b',
        amountIn: 10n,
        amountOut: 9n,
        hops: Object.freeze([
          Object.freeze({
            poolId: 'pool-1',
            assetIn: 'asset-a',
            assetOut: 'asset-b',
            amountIn: 10n,
            amountOut: 9n,
            reserveInBefore: 100n,
            reserveOutBefore: 100n,
            reserveInAfter: 110n,
            reserveOutAfter: 91n,
          }),
        ]),
      }),
    }),
  ]),
});

const SUCCESS_RESULT: Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'success' }
> = Object.freeze({
  status: 'success',
  plan: Object.freeze({
    receipt: RECEIPT,
    search: Object.freeze({
      counters: COUNTERS,
      termination: 'complete',
      numericalDiagnostics: Object.freeze([]),
    }),
  }),
});

const ALL_REJECTED_RESULT: Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'no-route' }
> = Object.freeze({
  status: 'no-route',
  reason: 'all-candidates-rejected',
  search: Object.freeze({
    counters: COUNTERS,
    termination: 'complete',
    numericalDiagnostics: Object.freeze([]),
  }),
});

const NO_CANDIDATE_RESULT: Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'no-route' }
> = Object.freeze({
  status: 'no-route',
  reason: 'no-candidate',
  search: Object.freeze({
    counters: COUNTERS,
    termination: 'complete',
    numericalDiagnostics: Object.freeze([]),
  }),
});

type SyntheticResult = Extract<
  NumericalExactInputSplitRuntimeResult,
  { readonly status: 'success' | 'no-route' }
>;

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function makeRuntimeClosureContract(): ExperimentInputRuntimeClosureContract {
  const placeholder = new TextEncoder().encode('x');
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-input-runtime-closure.v1',
    profileId: 'candidate-free-input-runtime-v1',
    entryRoots: Object.freeze(['cli/build-service-fast-numerical-experiment-inputs.ts']),
    projectSources: Object.freeze(
      SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST.map((sourcePath) =>
        Object.freeze({
          path: sourcePath,
          bytes: placeholder.byteLength,
          sha256: sha256(placeholder),
        }),
      ),
    ),
    nodeBuiltins: SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
    commandManifest: Object.freeze({
      path: 'package.json',
      bytes: placeholder.byteLength,
      sha256: sha256(placeholder),
      requiredScripts: SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS,
    }),
    repositoryAdmission:
      'stable-reviewed-head-clean-index-and-worktree-no-untracked-nonignored-files-no-submodules-no-concurrent-mutation',
    byteBinding: 'primary-before-construction',
    lexicalAudit: 'defense-in-depth',
  });
}

function identityHash(identities: readonly object[]): string {
  return sha256(JSON.stringify(identities));
}

function projectedCounters(): object {
  return {
    directCandidates: 1,
    directCandidateReplays: 1,
    directCandidateRejections: 0,
    pathExpansions: 1,
    bestSingleCandidateReplays: 1,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 1,
    equalProposalReplays: 1,
    equalProposalRejections: 0,
    greedyOptionReplays: 16,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 1,
    finalAuthorizationRejections: 0,
    numericalProposals: 1,
    numericalProposalFailures: 0,
    numericalIterations: 64,
    numericalResidualReplays: 1,
    numericalResidualReplayRejections: 0,
    numericalAuthorizationReplays: 1,
    numericalAuthorizationReplayRejections: 0,
  };
}

function projectedReceipt(): object {
  return {
    snapshotId: 'snapshot-1',
    snapshotChecksum: CHECKSUM,
    assetIn: 'asset-a',
    assetOut: 'asset-b',
    amountIn: '10',
    amountOut: '9',
    legs: [
      {
        allocation: '10',
        receipt: {
          snapshotId: 'snapshot-1',
          snapshotChecksum: CHECKSUM,
          assetIn: 'asset-a',
          assetOut: 'asset-b',
          amountIn: '10',
          amountOut: '9',
          hops: [
            {
              poolId: 'pool-1',
              assetIn: 'asset-a',
              assetOut: 'asset-b',
              amountIn: '10',
              amountOut: '9',
              reserveInBefore: '100',
              reserveOutBefore: '100',
              reserveInAfter: '110',
              reserveOutAfter: '91',
            },
          ],
        },
      },
    ],
  };
}

function projectedResult(
  result: SyntheticResult,
): object {
  const search = {
    counters: projectedCounters(),
    termination: 'complete',
    numericalDiagnostics: [],
  };
  return result.status === 'success'
    ? { status: 'success', plan: { receipt: projectedReceipt(), search } }
    : { status: 'no-route', reason: result.reason, search };
}

function makeSource(
  result: SyntheticResult = SUCCESS_RESULT,
  maximumBytes = 1_048_576,
): ExperimentInputSource {
  const eligible = result.status === 'success';
  const identity = [{ caseId: 'case-a', requestId: 'request-1' }];
  const fullHash = identityHash(identity);
  const priorHash = eligible ? fullHash : EMPTY_HASH;
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1',
    artifactPath: 'fixtures/test-input.ndjson',
    maximumBytes,
    runtimeClosure: makeRuntimeClosureContract(),
    cases: Object.freeze([
      Object.freeze({
        caseId: 'case-a',
        snapshotId: 'snapshot-1',
        snapshotChecksum: CHECKSUM,
        serviceDecision: true,
        operational: true,
        snapshot: Object.freeze({ snapshotId: 'snapshot-1', snapshotChecksum: CHECKSUM }),
        requests: Object.freeze([
          Object.freeze({
            requestId: 'request-1',
            assetIn: 'asset-a',
            assetOut: 'asset-b',
            amountBucket: 'bucket-1',
            amountIn: '10',
            topology: 'direct-edge-present',
          }),
        ]),
      }),
    ]),
    baselineCells: Object.freeze([
      Object.freeze({
        caseId: 'case-a',
        requestId: 'request-1',
        result: projectedResult(result),
      }),
    ]),
    eligibilityCells: Object.freeze([
      Object.freeze({
        caseId: 'case-a',
        requestId: 'request-1',
        status: eligible ? 'eligible' : 'ineligible',
        ...(eligible ? {} : { reason: 'baseline-no-authorized-incumbent' }),
        search: Object.freeze({
          pathExpansions: 1,
          enumeratedPaths: 1,
          pathTermination: 'complete',
          candidateSetExpansions: 1,
          enumeratedCandidateSets: 1,
          candidateSetTermination: 'complete',
        }),
        modelValidCandidateSetCount: 1,
      }),
    ]),
    cohorts: Object.freeze({
      full: Object.freeze({ count: 1, sha256: fullHash }),
      serviceDecision: Object.freeze({ count: 1, sha256: fullHash }),
      amplifiedStress: Object.freeze({ count: 0, sha256: EMPTY_HASH }),
      priorEligibleBoundOnly: Object.freeze({ count: eligible ? 1 : 0, sha256: priorHash }),
      priorEligibleServiceBoundOnly: Object.freeze({ count: eligible ? 1 : 0, sha256: priorHash }),
      operational: Object.freeze({
        count: 1,
        sha256: fullHash,
        perCaseCounts: Object.freeze({ 'case-a': 1 }),
        nonemptyStrataPerCase: Object.freeze({ 'case-a': 1 }),
      }),
    }),
  });
}

function makeOperations(
  result: SyntheticResult = SUCCESS_RESULT,
  calls = { prepare: 0, route: 0, discover: 0, resolve: 0, replay: 0 },
): ExperimentInputOperations {
  return Object.freeze({
    prepare: () => {
      calls.prepare += 1;
      return Object.freeze({ ok: true as const, value: Object.freeze({}) });
    },
    route: () => {
      calls.route += 1;
      return result;
    },
    discover: () => {
      calls.discover += 1;
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({
          search: Object.freeze({
            pathExpansions: 1,
            enumeratedPaths: 1,
            pathTermination: 'complete' as const,
            candidateSetExpansions: 1,
            enumeratedCandidateSets: 1,
            candidateSetTermination: 'complete' as const,
          }),
          candidateSets: Object.freeze([
            Object.freeze({
              routes: Object.freeze([
                Object.freeze([
                  Object.freeze({
                    assetIn: 'asset-a',
                    poolId: 'pool-1',
                    assetOut: 'asset-b',
                  }),
                ]),
              ]),
            }),
          ]),
        }),
      });
    },
    resolve: () => {
      calls.resolve += 1;
      return Object.freeze({
        ok: true as const,
        value: Object.freeze([
          Object.freeze([
            Object.freeze({
              reserveIn: 100n,
              reserveOut: 100n,
              feeChargedNumerator: 3n,
              feeDenominator: 1_000n,
            }),
          ]),
        ]),
      });
    },
    replay: () => {
      calls.replay += 1;
      return Object.freeze({ ok: true as const, value: RECEIPT });
    },
  });
}

async function buildOne(
  source: ExperimentInputSource,
  operations: ExperimentInputOperations,
): Promise<{ summary: Awaited<ReturnType<typeof streamExperimentInputRecords>>; record: Record<string, unknown> }> {
  const chunks: Uint8Array[] = [];
  const summary = await streamExperimentInputRecords(source, operations, {
    write: (chunk) => {
      chunks.push(Uint8Array.from(chunk));
      return Promise.resolve();
    },
  });
  const bytes = Buffer.concat(chunks);
  const lines = bytes.toString('utf8').split('\n');
  assert.equal(lines.at(-1), '');
  assert.equal(lines.length, 2);
  return { summary, record: JSON.parse(lines[0] ?? '') as Record<string, unknown> };
}

void test('the input stream preserves exact baseline, discovery, replay, and field order', async () => {
  const calls = { prepare: 0, route: 0, discover: 0, resolve: 0, replay: 0 };
  const { summary, record } = await buildOne(makeSource(), makeOperations(SUCCESS_RESULT, calls));
  assert.deepEqual(calls, { prepare: 1, route: 1, discover: 1, resolve: 1, replay: 1 });
  assert.equal(summary.recordCount, 1);
  assert.equal(summary.sha256, sha256(encodeCanonicalNdjsonRecord(record)));
  assert.deepEqual(Object.keys(record), [
    'schemaVersion',
    'sourceIndex',
    'caseId',
    'requestId',
    'snapshot',
    'request',
    'priorEligibility',
    'serviceDecisionMember',
    'amplifiedStressMember',
    'timingCohortIndex',
    'entryBaseline',
    'candidateDiscovery',
    'repairTargetSetIndex',
    'actionCeilingProfileId',
  ]);
  assert.equal(record['repairTargetSetIndex'], 0);
  const baseline = record['entryBaseline'] as Record<string, unknown>;
  const incumbent = baseline['incumbent'] as Record<string, unknown>;
  assert.equal(incumbent['status'], 'success');
  assert.equal((incumbent['objective'] as Record<string, unknown>)['amountOut'], '9');
  assert.equal(
    incumbent['receiptHash'],
    sha256(JSON.stringify(projectedReceipt())),
  );
  const discovery = record['candidateDiscovery'] as Record<string, unknown>;
  const candidate = (discovery['candidateSets'] as Array<Record<string, unknown>>)[0];
  assert.equal(candidate?.['resolutionStatus'], 'resolved');
  assert.equal(candidate?.['candidateSetKey'], '[[["asset-a","pool-1","asset-b"]]]');
  const route = (candidate?.['routes'] as Array<Record<string, unknown>>)[0];
  const hop = (route?.['hops'] as Array<Record<string, unknown>>)[0];
  assert.deepEqual(Object.keys(hop ?? {}), ['poolId', 'assetIn', 'assetOut']);
});

void test('all-rejected no-route remains a typed no-plan incumbent without a replay', async () => {
  const calls = { prepare: 0, route: 0, discover: 0, resolve: 0, replay: 0 };
  const { record } = await buildOne(
    makeSource(ALL_REJECTED_RESULT),
    makeOperations(ALL_REJECTED_RESULT, calls),
  );
  assert.equal(calls.replay, 0);
  assert.equal(calls.discover, 1);
  assert.equal(calls.resolve, 1);
  const baseline = record['entryBaseline'] as Record<string, unknown>;
  const incumbent = baseline['incumbent'] as Record<string, unknown>;
  assert.equal(incumbent['status'], 'no-route');
  assert.equal(incumbent['reason'], 'all-candidates-rejected');
  assert.equal(incumbent['receipt'], null);
  assert.equal((incumbent['objective'] as Record<string, unknown>)['hasPlan'], false);
});

void test('no-candidate no-route retains empty discovery without inventing a repair target', async () => {
  const calls = { prepare: 0, route: 0, discover: 0, resolve: 0, replay: 0 };
  const base = makeOperations(NO_CANDIDATE_RESULT, calls);
  const operations: ExperimentInputOperations = {
    ...base,
    discover: () => {
      calls.discover += 1;
      return {
        ok: true,
        value: {
          search: {
            pathExpansions: 1,
            enumeratedPaths: 0,
            pathTermination: 'complete',
            candidateSetExpansions: 0,
            enumeratedCandidateSets: 0,
            candidateSetTermination: 'complete',
          },
          candidateSets: [],
        },
      };
    },
  };
  const { record } = await buildOne(makeSource(NO_CANDIDATE_RESULT), operations);
  assert.deepEqual(calls, { prepare: 1, route: 1, discover: 1, resolve: 0, replay: 0 });
  assert.equal(record['repairTargetSetIndex'], null);
  const discovery = record['candidateDiscovery'] as Record<string, unknown>;
  assert.deepEqual(discovery['candidateSets'], []);
  const incumbent = (record['entryBaseline'] as Record<string, unknown>)[
    'incumbent'
  ] as Record<string, unknown>;
  assert.equal(incumbent['reason'], 'no-candidate');
});

void test('discovery retains only the first four sets and resolves each exactly once', async () => {
  const calls = { prepare: 0, route: 0, discover: 0, resolve: 0, replay: 0 };
  const base = makeOperations(SUCCESS_RESULT, calls);
  const candidateSets = Array.from({ length: 5 }, (_, index) => ({
    routes: [
      [
        {
          assetIn: 'asset-a',
          poolId: `pool-${index + 1}`,
          assetOut: 'asset-b',
        },
      ],
    ],
  }));
  const operations: ExperimentInputOperations = {
    ...base,
    discover: () => {
      calls.discover += 1;
      return {
        ok: true,
        value: {
          search: {
            pathExpansions: 5,
            enumeratedPaths: 5,
            pathTermination: 'complete',
            candidateSetExpansions: 5,
            enumeratedCandidateSets: 5,
            candidateSetTermination: 'complete',
          },
          candidateSets,
        },
      };
    },
    resolve: () => {
      const resolutionIndex = calls.resolve;
      calls.resolve += 1;
      return resolutionIndex === 0
        ? { ok: false }
        : {
            ok: true,
            value: [
              [
                {
                  reserveIn: 100n,
                  reserveOut: 100n,
                  feeChargedNumerator: 3n,
                  feeDenominator: 1_000n,
                },
              ],
            ],
          };
    },
  };
  const { record } = await buildOne(makeSource(), operations);
  assert.equal(calls.discover, 1);
  assert.equal(calls.resolve, 4);
  assert.equal(record['repairTargetSetIndex'], 1);
  const discovery = record['candidateDiscovery'] as Record<string, unknown>;
  const retained = discovery['candidateSets'] as Array<Record<string, unknown>>;
  assert.equal(retained.length, 4);
  assert.equal(retained[0]?.['resolutionStatus'], 'failed');
  assert.equal(retained[1]?.['resolutionStatus'], 'resolved');
});

void test('complete result parity includes counters and diagnostics', async () => {
  const source = makeSource();
  const baseline = source.baselineCells[0] as Record<string, unknown>;
  const result = baseline['result'] as Record<string, unknown>;
  const plan = result['plan'] as Record<string, unknown>;
  const search = plan['search'] as Record<string, unknown>;
  const counters = search['counters'] as Record<string, unknown>;
  const changed: ExperimentInputSource = {
    ...source,
    baselineCells: [{ ...baseline, result: { ...result, plan: { ...plan, search: { ...search, counters: { ...counters, numericalIterations: 63 } } } } }],
  };
  await assert.rejects(
    streamExperimentInputRecords(changed, makeOperations(), { write: () => Promise.resolve() }),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'baseline-parity-mismatch',
  );
});

void test('snapshot checksum, source order, cohort hash, and cap failures stop before publication', async () => {
  const checksumSource = makeSource();
  const checksumCase = checksumSource.cases[0];
  assert.ok(checksumCase);
  await assert.rejects(
    streamExperimentInputRecords(
      {
        ...checksumSource,
        cases: [{ ...checksumCase, snapshot: { snapshotId: 'snapshot-1', snapshotChecksum: `sha256:${'2'.repeat(64)}` } }],
      },
      makeOperations(),
      { write: () => Promise.resolve() },
    ),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'snapshot-identity-mismatch',
  );

  const orderedSource = makeSource();
  const baseline = orderedSource.baselineCells[0] as Record<string, unknown>;
  await assert.rejects(
    streamExperimentInputRecords(
      { ...orderedSource, baselineCells: [{ ...baseline, requestId: 'request-other' }] },
      makeOperations(),
      { write: () => Promise.resolve() },
    ),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'source-order-mismatch',
  );

  const cohortSource = makeSource();
  await assert.rejects(
    streamExperimentInputRecords(
      {
        ...cohortSource,
        cohorts: { ...cohortSource.cohorts, full: { count: 1, sha256: `sha256:${'0'.repeat(64)}` } },
      },
      makeOperations(),
      { write: () => Promise.resolve() },
    ),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'cohort-hash-mismatch',
  );

  await assert.rejects(
    streamExperimentInputRecords(makeSource(SUCCESS_RESULT, 1), makeOperations(), {
      write: () => Promise.resolve(),
    }),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'artifact-cap-exceeded',
  );
});

void test('immutable descriptor verification distinguishes byte and source-hash drift', () => {
  const bytes = new TextEncoder().encode('source');
  const binding = { path: 'src/source.ts', bytes: bytes.byteLength, sha256: sha256(bytes) };
  assert.doesNotThrow(() => verifyImmutableDescriptorBytes(binding, bytes));
  assert.throws(
    () => verifyImmutableDescriptorBytes({ ...binding, bytes: bytes.byteLength + 1 }, bytes),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'descriptor-byte-mismatch',
  );
  const changed = Uint8Array.from(bytes);
  changed[0] = 0;
  assert.throws(
    () => verifyImmutableDescriptorBytes(binding, changed),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError && error.code === 'descriptor-hash-mismatch',
  );
});

void test('runtime closure parsing rejects descriptor set, order, duplicate, and command drift', () => {
  const contract = makeRuntimeClosureContract();
  const sources = contract.projectSources.map((binding) => ({ ...binding }));
  const invalidContracts: readonly unknown[] = [
    { ...contract, projectSources: sources.slice(1) },
    { ...contract, projectSources: [sources[0], sources[0], ...sources.slice(2)] },
    { ...contract, projectSources: [sources[1], sources[0], ...sources.slice(2)] },
    {
      ...contract,
      projectSources: [
        { ...sources[0], path: 'cli/unknown-input-runtime.ts' },
        ...sources.slice(1),
      ],
    },
    {
      ...contract,
      projectSources: [{ ...sources[0], bytes: 0 }, ...sources.slice(1)],
    },
    {
      ...contract,
      projectSources: [
        {
          bytes: sources[0]?.bytes,
          path: sources[0]?.path,
          sha256: sources[0]?.sha256,
        },
        ...sources.slice(1),
      ],
    },
    { ...contract, unknown: true },
    {
      profileId: contract.profileId,
      schemaVersion: contract.schemaVersion,
      entryRoots: contract.entryRoots,
      projectSources: contract.projectSources,
      nodeBuiltins: contract.nodeBuiltins,
      commandManifest: contract.commandManifest,
      repositoryAdmission: contract.repositoryAdmission,
      byteBinding: contract.byteBinding,
      lexicalAudit: contract.lexicalAudit,
    },
    {
      ...contract,
      commandManifest: { ...contract.commandManifest, path: 'other-package.json' },
    },
    {
      ...contract,
      commandManifest: {
        bytes: contract.commandManifest.bytes,
        path: contract.commandManifest.path,
        sha256: contract.commandManifest.sha256,
        requiredScripts: contract.commandManifest.requiredScripts,
      },
    },
    {
      ...contract,
      commandManifest: {
        ...contract.commandManifest,
        requiredScripts: {
          'experiment:service-fast':
            SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS['experiment:service-fast'],
          'experiment:service-fast:inputs':
            SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS['experiment:service-fast:inputs'],
          'verify:service-fast-experiment':
            SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS['verify:service-fast-experiment'],
        },
      },
    },
  ];
  assert.doesNotThrow(() => parseExperimentInputRuntimeClosure(contract));
  for (const invalid of invalidContracts) {
    assert.throws(
      () => parseExperimentInputRuntimeClosure(invalid),
      (error: unknown) =>
        error instanceof ExperimentInputBuildError &&
        error.code === 'runtime-closure-contract-mismatch',
    );
  }
});

void test('the command manifest binds package bytes and all three exact scripts', () => {
  const packageValue = {
    scripts: {
      ...SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS,
      unrelated: 'node cli/unrelated.ts',
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(packageValue));
  const manifest = Object.freeze({
    path: 'package.json',
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    requiredScripts: SERVICE_FAST_EXPERIMENT_INPUT_REQUIRED_SCRIPTS,
  });
  assert.doesNotThrow(() => verifyExperimentInputCommandManifest(manifest, bytes));

  const wrongBytes = new TextEncoder().encode(
    JSON.stringify({
      scripts: {
        ...packageValue.scripts,
        'experiment:service-fast': 'node cli/wrong.ts',
      },
    }),
  );
  assert.throws(
    () =>
      verifyExperimentInputCommandManifest(
        { ...manifest, bytes: wrongBytes.byteLength, sha256: sha256(wrongBytes) },
        wrongBytes,
      ),
    (error: unknown) =>
      error instanceof ExperimentInputBuildError &&
      error.code === 'package-command-manifest-mismatch',
  );
});

void test('construction is never called after runtime admission failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-admission-order-'));
  try {
    const fixture = await writeAuditSource(root, 'export {};\n');
    await writeFile(path.join(root, AUDIT_ROOT), 'export const changed = true;\n');
    const runtimeClosure = Object.freeze({
      ...makeRuntimeClosureContract(),
      entryRoots: fixture.expected.entryRoots,
      projectSources: fixture.expected.projectSources,
      nodeBuiltins: fixture.expected.nodeBuiltins,
    });
    let constructions = 0;
    await assert.rejects(
      constructAfterExperimentInputAdmission(
        { ...makeSource(), runtimeClosure },
        async (expected) => {
          await auditRuntimeImportClosure({
            repositoryRoot: root,
            expected,
            trackedPaths: fixture.tracked,
          });
        },
        () => {
          constructions += 1;
          return Promise.resolve(undefined);
        },
      ),
      (error: unknown) =>
        error instanceof RuntimeImportAuditError &&
        error.code === 'runtime-source-byte-mismatch',
    );
    assert.equal(constructions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('canonical codecs preserve exact strings and binary64 big-endian bits', () => {
  assert.equal(encodeBinary64Bits(2 ** -40), '3d70000000000000');
  assert.equal(encodeBinary64Bits(-0), '8000000000000000');
  assert.throws(() => encodeBinary64Bits(Number.POSITIVE_INFINITY), /finite/u);
  assert.equal(
    Buffer.from(
      encodeCanonicalNdjsonRecord({ exact: '900719925474099100000', bits: '3d70000000000000' }),
    ).toString('utf8'),
    '{"exact":"900719925474099100000","bits":"3d70000000000000"}\n',
  );
  assert.throws(() => encodeCanonicalNdjsonRecord({ exact: 1n }), /unencoded bigint/u);
  assert.throws(() => encodeCanonicalNdjsonRecord({ missing: undefined }), /non-JSON value/u);
  assert.throws(
    () => encodeCanonicalNdjsonRecord({ structural: Number.MAX_SAFE_INTEGER + 1 }),
    /non-safe structural number/u,
  );
});

void test('exclusive publication commits by no-overwrite link and cleans owned staging', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-input-publication-'));
  const destination = path.join(directory, 'inputs.ndjson');
  try {
    const result = await publishExclusiveInputArtifact({
      destinationPath: destination,
      maximumBytes: 64,
      produce: async (sink) => {
        await sink.write(new TextEncoder().encode('{"ok":true}\n'));
        return 1;
      },
    });
    assert.equal(result.value, 1);
    assert.equal(await readFile(destination, 'utf8'), '{"ok":true}\n');
    assert.deepEqual(await readdir(directory), ['inputs.ndjson']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('publication conflicts never replace a lock or destination and cap failures clean up', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-input-conflict-'));
  const destination = path.join(directory, 'inputs.ndjson');
  const lockPath = path.join(directory, '.inputs.ndjson-publication-lock');
  try {
    await writeFile(lockPath, 'owned-elsewhere', { flag: 'wx' });
    await assert.rejects(
      publishExclusiveInputArtifact({
        destinationPath: destination,
        maximumBytes: 64,
        produce: () => Promise.resolve(undefined),
      }),
      (error: unknown) =>
        error instanceof InputPublicationError && error.code === 'publication-lock-conflict',
    );
    assert.equal(await readFile(lockPath, 'utf8'), 'owned-elsewhere');
    await rm(lockPath);

    await writeFile(destination, 'keep', { flag: 'wx' });
    await assert.rejects(
      publishExclusiveInputArtifact({
        destinationPath: destination,
        maximumBytes: 64,
        produce: () => Promise.resolve(undefined),
      }),
      (error: unknown) =>
        error instanceof InputPublicationError && error.code === 'destination-conflict-initial',
    );
    assert.equal(await readFile(destination, 'utf8'), 'keep');
    assert.deepEqual(await readdir(directory), ['inputs.ndjson']);
    await rm(destination);

    await assert.rejects(
      publishExclusiveInputArtifact({
        destinationPath: destination,
        maximumBytes: 1,
        produce: async (sink) => sink.write(new Uint8Array([1, 2])),
      }),
      (error: unknown) =>
        error instanceof InputPublicationError && error.code === 'artifact-cap-exceeded',
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('builder/publisher byte-hash mismatch rejects before commit and removes all owned paths', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-input-accounting-'));
  const destination = path.join(directory, 'inputs.ndjson');
  const staging = path.join(directory, '.inputs.ndjson.staging-accounting-mismatch');
  const lock = path.join(directory, '.inputs.ndjson-publication-lock');
  const defaults = defaultExclusivePublicationDependencies();
  try {
    await assert.rejects(
      publishExclusiveInputArtifact(
        {
          destinationPath: destination,
          maximumBytes: 64,
          produce: async (sink) => {
            await sink.write(new TextEncoder().encode('{"ok":true}\n'));
            return Object.freeze({
              recordCount: 1,
              bytes: 0,
              sha256: `sha256:${'0'.repeat(64)}`,
            });
          },
          validateBeforeCommit: ({ value, bytes, sha256: artifactHash }) => {
            validateExperimentInputPublicationAccounting(value, {
              bytes,
              sha256: artifactHash,
            });
          },
        },
        { ...defaults, uniqueSuffix: () => 'accounting-mismatch' },
      ),
      (error: unknown) =>
        error instanceof InputPublicationError &&
        error.code === 'input-construction-failed' &&
        /accounting differs/u.test(error.message),
    );
    assert.deepEqual(await readdir(directory), []);
    for (const filePath of [destination, staging, lock]) {
      await assert.rejects(lstat(filePath), { code: 'ENOENT' });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('a final destination race is detected without replacement and follows frozen precedence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-input-final-race-'));
  const destination = path.join(directory, 'inputs.ndjson');
  const defaults = defaultExclusivePublicationDependencies();
  let destinationChecks = 0;
  try {
    await assert.rejects(
      publishExclusiveInputArtifact(
        {
          destinationPath: destination,
          maximumBytes: 64,
          produce: async (sink) => sink.write(new TextEncoder().encode('staged\n')),
        },
        {
          ...defaults,
          uniqueSuffix: () => 'final-race',
          lstat: async (filePath) => {
            if (filePath === destination) {
              destinationChecks += 1;
              if (destinationChecks === 2) await writeFile(destination, 'racer', { flag: 'wx' });
            }
            await defaults.lstat(filePath);
          },
        },
      ),
      (error: unknown) =>
        error instanceof InputPublicationError && error.code === 'destination-conflict-final',
    );
    assert.equal(destinationChecks, 2);
    assert.equal(await readFile(destination, 'utf8'), 'racer');
    assert.deepEqual(await readdir(directory), ['inputs.ndjson']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('postcommit sync failure never rolls back the published destination', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-input-postcommit-'));
  const destination = path.join(directory, 'inputs.ndjson');
  const defaults = defaultExclusivePublicationDependencies();
  try {
    await assert.rejects(
      publishExclusiveInputArtifact(
        {
          destinationPath: destination,
          maximumBytes: 64,
          produce: async (sink) => sink.write(new TextEncoder().encode('committed\n')),
        },
        {
          ...defaults,
          uniqueSuffix: () => 'postcommit',
          openDirectory: () =>
            Promise.resolve({
              write: () => Promise.resolve(),
              sync: () => Promise.reject(new Error('forced parent sync failure')),
              close: () => Promise.resolve(),
            }),
        },
      ),
      (error: unknown) =>
        error instanceof InputPublicationError &&
        error.code === 'postcommit-parent-sync-failed' &&
        error.committed,
    );
    assert.equal(await readFile(destination, 'utf8'), 'committed\n');
    assert.deepEqual(await readdir(directory), ['inputs.ndjson']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('failed precommit staging cleanup retains the owned lock for manual review', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-input-cleanup-'));
  const destination = path.join(directory, 'inputs.ndjson');
  const defaults = defaultExclusivePublicationDependencies();
  try {
    await assert.rejects(
      publishExclusiveInputArtifact(
        {
          destinationPath: destination,
          maximumBytes: 64,
          produce: () => Promise.reject(new Error('forced producer failure')),
        },
        {
          ...defaults,
          uniqueSuffix: () => 'cleanup-test',
          unlink: async (filePath) => {
            if (filePath.includes('.staging-')) throw new Error('forced staging cleanup failure');
            await defaults.unlink(filePath);
          },
        },
      ),
      (error: unknown) =>
        error instanceof InputPublicationError &&
        error.code === 'precommit-staging-cleanup-failed' &&
        error.committed === false,
    );
    await lstat(path.join(directory, '.inputs.ndjson-publication-lock'));
    await lstat(path.join(directory, '.inputs.ndjson.staging-cleanup-test'));
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const NEW_RUNTIME_FILES = Object.freeze([
  'cli/build-service-fast-numerical-experiment-inputs.ts',
  'src/benchmark/service-fast-numerical-experiment/input/build.ts',
  'src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts',
  'src/benchmark/service-fast-numerical-experiment/input/codec.ts',
  'src/benchmark/service-fast-numerical-experiment/input/frozen-bindings.ts',
  'src/benchmark/service-fast-numerical-experiment/input/publication.ts',
]);

void test('the production input runtime closure reaches no experiment candidate or observer', async () => {
  const tracked = new Set(await readGitIndexTrackedPaths('.'));
  for (const filePath of NEW_RUNTIME_FILES) tracked.add(filePath);
  const expected = {
    entryRoots: Object.freeze(['cli/build-service-fast-numerical-experiment-inputs.ts']),
    projectSources: Object.freeze(
      await Promise.all(
        SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST.map(async (sourcePath) => {
          const bytes = Uint8Array.from(await readFile(sourcePath));
          return Object.freeze({
            path: sourcePath,
            bytes: bytes.byteLength,
            sha256: sha256(bytes),
          });
        }),
      ),
    ),
    nodeBuiltins: SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
  };
  const closure = await auditRuntimeImportClosure({
    repositoryRoot: '.',
    expected,
    trackedPaths: tracked,
  });
  assert.equal(
    closure.files.some((filePath) =>
      /service-fast-path-shadow-price|bounded-exact-split-repair|evaluator|proposal-adapters|\/policy\.ts$/u.test(
        filePath,
      ),
    ),
    false,
  );
  assert.deepEqual(
    closure.files,
    [...SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST].sort(),
  );
  assert.deepEqual(
    closure.builtins,
    [...SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST].sort(),
  );
});

const AUDIT_ROOT = 'cli/build-service-fast-numerical-experiment-inputs.ts';

async function writeAuditSource(
  repositoryRoot: string,
  source: string,
  extras: Readonly<Record<string, string>> = {},
): Promise<{
  readonly tracked: ReadonlySet<string>;
  readonly expected: Readonly<{
    readonly entryRoots: readonly string[];
    readonly projectSources: readonly Readonly<{
      readonly path: string;
      readonly bytes: number;
      readonly sha256: string;
    }>[];
    readonly nodeBuiltins: readonly string[];
  }>;
}> {
  const tracked = new Set<string>();
  const projectSources: { path: string; bytes: number; sha256: string }[] = [];
  for (const filePath of SERVICE_FAST_INPUT_PROJECT_RUNTIME_ALLOWLIST) {
    const contents =
      filePath === AUDIT_ROOT ? source : (extras[filePath] ?? 'export {};\n');
    const absolute = path.join(repositoryRoot, filePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
    const bytes = new TextEncoder().encode(contents);
    tracked.add(filePath);
    projectSources.push({ path: filePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  for (const [filePath, contents] of Object.entries(extras)) {
    if (tracked.has(filePath)) continue;
    const absolute = path.join(repositoryRoot, filePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);
    tracked.add(filePath);
  }
  return Object.freeze({
    tracked,
    expected: Object.freeze({
      entryRoots: Object.freeze([AUDIT_ROOT]),
      projectSources: Object.freeze(projectSources.map((value) => Object.freeze(value))),
      nodeBuiltins: SERVICE_FAST_INPUT_BUILTIN_RUNTIME_ALLOWLIST,
    }),
  });
}

void test('the recursive audit rejects barrels, packages, loading, clocks, traversal, and forbidden paths', async (context) => {
  const cases = [
    {
      name: 'barrel',
      source: "import '../src/index.ts';\n",
      extras: { 'src/index.ts': 'export {};\n' },
      code: 'project-runtime-not-allowlisted',
    },
    { name: 'bare package', source: "import value from 'package';\nvoid value;\n", code: 'bare-import-forbidden' },
    { name: 'dynamic loading', source: "const target = './leaf.ts';\nvoid import(target);\n", code: 'dynamic-import-forbidden' },
    { name: 'runtime require', source: "declare const require: (value: string) => unknown;\nrequire('../src/domain/liquidity-snapshot.ts');\n", code: 'runtime-loader-forbidden' },
    { name: 'subprocess', source: "import { spawn } from 'node:child_process';\nvoid spawn;\n", code: 'builtin-import-forbidden' },
    { name: 'clock', source: 'void process.hrtime.bigint();\n', code: 'operational-clock-forbidden' },
    { name: 'traversal', source: "import '../../outside.ts';\n", code: 'traversal-target' },
    { name: 'code generation', source: "void eval('1');\n", code: 'runtime-codegen-forbidden' },
    { name: 'network', source: "void fetch('https://example.invalid');\n", code: 'runtime-network-forbidden' },
    { name: 'worker', source: "void new Worker('worker.js');\n", code: 'runtime-worker-forbidden' },
    { name: 'profiler', source: 'console.profile();\n', code: 'runtime-profiler-forbidden' },
    {
      name: 'escaped specifier',
      source: "import '../src/domain/liquidity\\x2dsnapshot.ts';\n",
      code: 'escaped-module-specifier',
    },
    {
      name: 'ambiguous type import',
      source: "import type from '../src/domain/liquidity-snapshot.ts';\nvoid type;\n",
      code: 'ambiguous-type-import',
    },
    {
      name: 'builtin loader bypass',
      source: "const moduleBuiltin = process.getBuiltinModule('node:module');\nconst runtimeRequire = moduleBuiltin.createRequire('/tmp/input.cjs');\nvoid runtimeRequire('node:child_process');\n",
      code: 'runtime-loader-forbidden',
    },
    {
      name: 'escaped loader identifier',
      source: "void process.get\\u0042uiltinModule('node:module');\n",
      code: 'escaped-identifier-forbidden',
    },
    {
      name: 'concatenated process reflection',
      source: "void Reflect.get(process, 'get' + 'BuiltinModule');\n",
      code: 'runtime-reflection-forbidden',
    },
    {
      name: 'aliased reflection and process',
      source: "const reflection = Reflect;\nconst runtime = process;\nvoid reflection.get(runtime, 'getBuiltinModule');\n",
      code: 'runtime-reflection-forbidden',
    },
    {
      name: 'computed reflection',
      source: "void Reflect['get'](process, 'getBuiltinModule');\n",
      code: 'runtime-reflection-forbidden',
    },
    {
      name: 'arrow constructor code generation',
      source: "void (() => {}).constructor('return process')();\n",
      code: 'runtime-codegen-forbidden',
    },
    {
      name: 'reflected fetch',
      source: "void Reflect.get(globalThis, 'fetch');\n",
      code: 'runtime-network-forbidden',
    },
    {
      name: 'reflected Date',
      source: "void Reflect.get(globalThis, 'Date');\n",
      code: 'operational-clock-forbidden',
    },
    {
      name: 'reflected console profiler',
      source: "void Reflect.get(console, 'profile');\n",
      code: 'runtime-profiler-forbidden',
    },
    {
      name: 'require resolve',
      source: "declare const require: { resolve(value: string): string };\nvoid require.resolve('node:module');\n",
      code: 'runtime-loader-forbidden',
    },
    {
      name: 'VM compile function',
      source: "void compileFunction('return process');\n",
      code: 'runtime-codegen-forbidden',
    },
    {
      name: 'VM context runner',
      source: "void runInNewContext('process.getBuiltinModule(\\'node:module\\')');\n",
      code: 'runtime-codegen-forbidden',
    },
    {
      name: 'VM module loader',
      source: "void new SourceTextModule('export default 1');\n",
      code: 'runtime-codegen-forbidden',
    },
    {
      name: 'regex backtick before loader',
      source: "const pattern = /foo`bar/u;\nvoid pattern;\nvoid process.getBuiltinModule('node:module');\n",
      code: 'runtime-loader-forbidden',
    },
    {
      name: 'candidate',
      source: "import '../src/allocation/service-fast-path-shadow-price/candidate.ts';\n",
      extras: { 'src/allocation/service-fast-path-shadow-price/candidate.ts': 'export {};\n' },
      code: 'project-runtime-not-allowlisted',
    },
    {
      name: 'evaluator',
      source: "import '../src/benchmark/service-fast-numerical-experiment/evaluator-kernel.ts';\n",
      extras: { 'src/benchmark/service-fast-numerical-experiment/evaluator-kernel.ts': 'export {};\n' },
      code: 'project-runtime-not-allowlisted',
    },
    {
      name: 'allowed-looking new path',
      source: "import '../src/runtime/prepared-routing-context/new-helper.ts';\n",
      extras: { 'src/runtime/prepared-routing-context/new-helper.ts': 'export {};\n' },
      code: 'project-runtime-not-allowlisted',
    },
  ] as const;
  for (const auditCase of cases) {
    await context.test(auditCase.name, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-'));
      try {
        const fixture = await writeAuditSource(
          root,
          auditCase.source,
          'extras' in auditCase ? auditCase.extras : {},
        );
        await assert.rejects(
          auditRuntimeImportClosure({
            repositoryRoot: root,
            expected: fixture.expected,
            trackedPaths: fixture.tracked,
          }),
          (error: unknown) =>
            error instanceof RuntimeImportAuditError && error.code === auditCase.code,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

const PRIMARY_RUNTIME_INTEGRITY_PROBES = Object.freeze([
  Object.freeze({
    name: 'stored constructor property',
    source: 'const property = "constructor"; (()=>{})[property]("return process")();',
  }),
  Object.freeze({
    name: 'reflected stored constructor property',
    source:
      'const fn = ()=>{}; const property = "constructor"; Reflect.get(fn, property)("return process")();',
  }),
  Object.freeze({
    name: 'joined constructor property',
    source: '(()=>{})[["con", "structor"].join("")]("return process")();',
  }),
  Object.freeze({
    name: 'template constructor property',
    source:
      'const property = `con${"struc"}tor`; (()=>{})[property]("return process")();',
  }),
  Object.freeze({
    name: 'stdout constructor loader',
    source:
      'const property = "constructor"; process.stdout[property][property]("return process.getBuiltinModule(\\"node:module\\")")();',
  }),
  Object.freeze({
    name: 'stdout constructor network',
    source:
      'const property = "constructor"; process.stdout[property][property]("return fetch")()("https://example.invalid");',
  }),
  Object.freeze({
    name: 'stdout constructor clock',
    source:
      'const property = "constructor"; process.stdout[property][property]("return Date.now()")();',
  }),
  Object.freeze({
    name: 'stdout constructor profiler',
    source:
      'const property = "constructor"; process.stdout[property][property]("return console.profile()")();',
  }),
  Object.freeze({
    name: 'control-statement regex before loader',
    source:
      'if (true) /`/.test(""); process.getBuiltinModule("node:module"); const trailing = /`/;',
  }),
]);

void test('runtime byte binding rejects reflective synthesis before lexical closure', async (context) => {
  for (const probe of PRIMARY_RUNTIME_INTEGRITY_PROBES) {
    await context.test(probe.name, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-integrity-'));
      try {
        const fixture = await writeAuditSource(root, 'export {};\n');
        await writeFile(path.join(root, AUDIT_ROOT), probe.source);
        await assert.rejects(
          auditRuntimeImportClosure({
            repositoryRoot: root,
            expected: fixture.expected,
            trackedPaths: fixture.tracked,
          }),
          (error: unknown) =>
            error instanceof RuntimeImportAuditError &&
            error.code === 'runtime-source-byte-mismatch' &&
            error.artifact === AUDIT_ROOT,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

void test('runtime descriptors distinguish byte-count and same-width hash drift', async (context) => {
  await context.test('byte count', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-byte-drift-'));
    try {
      const fixture = await writeAuditSource(root, 'export {};\n');
      await writeFile(path.join(root, AUDIT_ROOT), 'export const changed = true;\n');
      await assert.rejects(
        auditRuntimeImportClosure({
          repositoryRoot: root,
          expected: fixture.expected,
          trackedPaths: fixture.tracked,
        }),
        (error: unknown) =>
          error instanceof RuntimeImportAuditError &&
          error.code === 'runtime-source-byte-mismatch',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await context.test('same-width hash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-hash-drift-'));
    try {
      const fixture = await writeAuditSource(root, 'export const value = 1;\n');
      await writeFile(path.join(root, AUDIT_ROOT), 'export const value = 2;\n');
      await assert.rejects(
        auditRuntimeImportClosure({
          repositoryRoot: root,
          expected: fixture.expected,
          trackedPaths: fixture.tracked,
        }),
        (error: unknown) =>
          error instanceof RuntimeImportAuditError &&
          error.code === 'runtime-source-hash-mismatch',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

void test('the recursive audit preserves its explicit safe runtime subset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-safe-'));
  try {
    const fixture = await writeAuditSource(
      root,
      [
        'class Box { constructor(readonly value: number) {} }',
        'const box = new Box(4 / 2);',
        "const field = 'value';",
        'void Reflect.get(box, field);',
        'void Reflect.apply((value: number) => value, undefined, [box.value]);',
        'const pattern = /foo`bar/u;',
        "const message = `${box.value}:${pattern.source}`;",
        'void process.pid;',
        'void process.stdout.write(message);',
        'void process.stderr.write(message);',
        'process.exitCode = 0;',
      ].join('\n'),
    );
    await assert.rejects(
      auditRuntimeImportClosure({
        repositoryRoot: root,
        expected: fixture.expected,
        trackedPaths: fixture.tracked,
      }),
      (error: unknown) =>
        error instanceof RuntimeImportAuditError && error.code === 'runtime-closure-mismatch',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('the recursive audit rejects untracked, absolute, symlink, and nonregular targets', async (context) => {
  await context.test('untracked descriptor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-untracked-'));
    try {
      const fixture = await writeAuditSource(root, 'export {};\n');
      const tracked = new Set(fixture.tracked);
      tracked.delete('src/domain/liquidity-snapshot.ts');
      await assert.rejects(
        auditRuntimeImportClosure({ repositoryRoot: root, expected: fixture.expected, trackedPaths: tracked }),
        (error: unknown) =>
          error instanceof RuntimeImportAuditError && error.code === 'untracked-target',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await context.test('absolute import', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-absolute-'));
    try {
      const fixture = await writeAuditSource(root, "import '/tmp/outside.ts';\n");
      await assert.rejects(
        auditRuntimeImportClosure({
          repositoryRoot: root,
          expected: fixture.expected,
          trackedPaths: fixture.tracked,
        }),
        (error: unknown) =>
          error instanceof RuntimeImportAuditError && error.code === 'absolute-target',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await context.test('symlink descriptor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-symlink-'));
    try {
      const fixture = await writeAuditSource(root, 'export {};\n');
      const target = path.join(root, 'src/domain/liquidity-snapshot.ts');
      await rm(target);
      await writeFile(path.join(root, 'src/domain/real.ts'), 'export {};\n');
      await symlink('real.ts', target);
      await assert.rejects(
        auditRuntimeImportClosure({
          repositoryRoot: root,
          expected: fixture.expected,
          trackedPaths: fixture.tracked,
        }),
        (error: unknown) =>
          error instanceof RuntimeImportAuditError && error.code === 'symlink-target',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await context.test('nonregular descriptor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rlt087-audit-nonregular-'));
    try {
      const fixture = await writeAuditSource(root, 'export {};\n');
      const target = path.join(root, 'src/domain/liquidity-snapshot.ts');
      await rm(target);
      await mkdir(target);
      await assert.rejects(
        auditRuntimeImportClosure({
          repositoryRoot: root,
          expected: fixture.expected,
          trackedPaths: fixture.tracked,
        }),
        (error: unknown) =>
          error instanceof RuntimeImportAuditError && error.code === 'runtime-target-not-file',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
