import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createOfflineRouterBenchmarkReport,
  discoverOfflineRouterCases,
  type OfflineRouterBenchmarkDependencies,
  type OfflineRouterBenchmarkEnvironment,
  type OfflineRouterCaseDirectoryEntry,
} from '../../src/benchmark/offline-router-cases/index.ts';

const NO_PLAN_RUN =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":0},"result":{"status":"no-plan","reason":"work-limit","search":{"expansions":0,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"work-limit"}}}';
const NO_PLAN_HASH =
  'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4';
const NO_PLAN_CASE =
  `{"schemaVersion":"routelab.router-case.v1","caseId":"m3-no-plan","determinismHash":"${NO_PLAN_HASH}","run":${NO_PLAN_RUN}}`;

const LIMITATIONS = [
  'one observed verification per case; no warmup or repetition',
  'timings are non-statistical observations, not performance conclusions',
  'inputs are fixed offline repository cases',
  'routing is bounded exact-replayed single-path only',
  'no live service, transaction submission, custody, or protocol execution',
] as const;
const ENVIRONMENT: OfflineRouterBenchmarkEnvironment = {
  nodeVersion: 'v24.oracle',
  platform: 'oracle-platform',
  arch: 'oracle-arch',
};
const USAGE = 'Usage: pnpm replay:cases [--cases <directory>]\n';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../../cli/replay-cases.ts', import.meta.url));
const FIXTURE_DIRECTORY = fileURLToPath(
  new URL('../../fixtures/m3/router-cases/', import.meta.url),
);

interface InjectedDependencies {
  readonly dependencies: OfflineRouterBenchmarkDependencies;
  readonly directoryCalls: string[];
  readonly fileCalls: string[];
  readonly clockCalls: number;
}

function dependencies(
  entries: readonly OfflineRouterCaseDirectoryEntry[],
  files: ReadonlyMap<string, string>,
  clockValues: readonly bigint[],
): InjectedDependencies {
  const directoryCalls: string[] = [];
  const fileCalls: string[] = [];
  let clockIndex = 0;
  return {
    dependencies: {
      readDirectory(directory) {
        directoryCalls.push(directory);
        return Promise.resolve(entries);
      },
      readFile(path) {
        fileCalls.push(path);
        const value = files.get(path);
        return value === undefined
          ? Promise.reject(new Error('injected unreadable file'))
          : Promise.resolve(value);
      },
      now() {
        const value = clockValues[clockIndex];
        if (value === undefined) throw new Error('injected clock exhausted');
        clockIndex += 1;
        return value;
      },
    },
    directoryCalls,
    fileCalls,
    get clockCalls() {
      return clockIndex;
    },
  };
}

function withCaseId(canonicalCaseJson: string, caseId: string): string {
  const record = JSON.parse(canonicalCaseJson) as Record<string, unknown>;
  record['caseId'] = caseId;
  return JSON.stringify(record);
}

async function fixture(filename: string): Promise<string> {
  return readFile(join(FIXTURE_DIRECTORY, filename), 'utf8');
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function runCli(arguments_: readonly string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...arguments_], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
}

void test('filters and raw-sorts captured filenames with one read and two clock calls each', async () => {
  const success = await fixture('success.json');
  const emoji = '\u{1f600}.json';
  const privateUse = '\ue000.json';
  let driftingNameReads = 0;
  let driftingFileReads = 0;
  const driftingEntry: OfflineRouterCaseDirectoryEntry = {
    get name() {
      driftingNameReads += 1;
      return driftingNameReads === 1 ? 'A.json' : 'changed.json';
    },
    get isFile() {
      driftingFileReads += 1;
      return driftingFileReads === 1;
    },
  };
  const entries: readonly OfflineRouterCaseDirectoryEntry[] = [
    { name: privateUse, isFile: true },
    { name: 'README.md', isFile: true },
    { name: 'ignored.json', isFile: false },
    { name: 'lower.JSON', isFile: true },
    { name: 'suffix.json.bak', isFile: true },
    { name: emoji, isFile: true },
    { name: 'Z.json', isFile: true },
    driftingEntry,
  ];
  const files = new Map([
    [join('/oracle/cases', 'A.json'), withCaseId(success, 'case-a')],
    [join('/oracle/cases', 'Z.json'), withCaseId(success, 'case-z')],
    [join('/oracle/cases', emoji), withCaseId(success, 'case-emoji')],
    [join('/oracle/cases', privateUse), withCaseId(success, 'case-private')],
  ]);
  const injected = dependencies(
    entries,
    files,
    [10n, 11n, 20n, 22n, 30n, 33n, 40n, 44n],
  );

  const discovered = await discoverOfflineRouterCases(
    '/oracle/cases',
    injected.dependencies,
  );
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  assert.deepEqual(
    discovered.value.map(({ filename }) => filename),
    ['A.json', 'Z.json', emoji, privateUse],
  );
  assert.deepEqual(
    discovered.value.map(({ case: value }) => value.caseId),
    ['case-a', 'case-z', 'case-emoji', 'case-private'],
  );
  assert.deepEqual(
    discovered.value.map(({ elapsedNanoseconds }) => elapsedNanoseconds),
    [1n, 2n, 3n, 4n],
  );
  assert.deepEqual(injected.directoryCalls, ['/oracle/cases']);
  assert.deepEqual(injected.fileCalls, [
    join('/oracle/cases', 'A.json'),
    join('/oracle/cases', 'Z.json'),
    join('/oracle/cases', emoji),
    join('/oracle/cases', privateUse),
  ]);
  assert.equal(injected.clockCalls, 8);
  assert.equal(driftingNameReads, 1);
  assert.equal(driftingFileReads, 1);
  for (const [index, entry] of discovered.value.entries()) {
    assert.equal(entry.canonicalCaseJson, files.get(injected.fileCalls[index] ?? ''));
  }
  assertDeepFrozen(discovered);
});

void test('emits an exact independently constructed report with separated raw semantic evidence', async () => {
  assert.equal(await fixture('no-plan.json'), NO_PLAN_CASE);
  const injected = dependencies(
    [{ name: 'no-plan.json', isFile: true }],
    new Map([[join('/oracle/cases', 'no-plan.json'), NO_PLAN_CASE]]),
    [100n, 107n],
  );
  const expected = JSON.stringify({
    schemaVersion: 'routelab.benchmark-report.v1',
    semantics: {
      caseDirectory: '/oracle/cases',
      caseCount: 1,
      cases: [
        {
          filename: 'no-plan.json',
          caseId: 'm3-no-plan',
          determinismHash: NO_PLAN_HASH,
          status: 'no-plan',
          search: {
            expansions: 0,
            enumeratedCandidates: 0,
            replayedCandidates: 0,
            rejectedCandidates: 0,
            termination: 'work-limit',
          },
          canonicalCaseJson: NO_PLAN_CASE,
          canonicalRunJson: NO_PLAN_RUN,
        },
      ],
    },
    observations: {
      environment: {
        nodeVersion: 'v24.oracle',
        platform: 'oracle-platform',
        arch: 'oracle-arch',
      },
      cases: [{ filename: 'no-plan.json', elapsedNanoseconds: '7' }],
    },
    limitations: LIMITATIONS,
  });

  const created = await createOfflineRouterBenchmarkReport(
    '/oracle/cases',
    injected.dependencies,
    ENVIRONMENT,
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.canonicalJson, expected);
  assert.deepEqual(created.value.report, JSON.parse(expected));
  assert.equal(created.value.report.semantics.cases[0]?.canonicalCaseJson, NO_PLAN_CASE);
  assert.equal(created.value.report.semantics.cases[0]?.canonicalRunJson, NO_PLAN_RUN);
  assert.equal(created.value.report.semantics.cases[0]?.determinismHash, NO_PLAN_HASH);
  assert.equal(
    typeof created.value.report.observations.cases[0]?.elapsedNanoseconds,
    'string',
  );
  assert.equal(injected.clockCalls, 2);
  assert.equal(injected.fileCalls.length, 1);
  assert.equal(sha256(created.value.canonicalJson), sha256(expected));
  assertDeepFrozen(created);
});

void test('clock and environment changes alter observations only', async () => {
  const entries = [{ name: 'no-plan.json', isFile: true }];
  const files = new Map([[join('/cases', 'no-plan.json'), NO_PLAN_CASE]]);
  const first = await createOfflineRouterBenchmarkReport(
    '/cases',
    dependencies(entries, files, [0n, 5n]).dependencies,
    ENVIRONMENT,
  );
  const second = await createOfflineRouterBenchmarkReport(
    '/cases',
    dependencies(entries, files, [100n, 109n]).dependencies,
    { nodeVersion: 'v99.changed', platform: 'changed', arch: 'changed' },
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.report.semantics, second.value.report.semantics);
  assert.deepEqual(first.value.report.limitations, second.value.report.limitations);
  assert.notDeepEqual(first.value.report.observations, second.value.report.observations);
  assert.equal(
    JSON.stringify(first.value.report.semantics).includes('Nanoseconds'),
    false,
  );
  assert.equal(JSON.stringify(first.value.report.semantics).includes('"nodeVersion":'), false);
  assert.equal(JSON.stringify(first.value.report.semantics).includes('"platform":'), false);
  assert.equal(JSON.stringify(first.value.report.semantics).includes('"arch":'), false);
  assert.equal(
    first.value.report.semantics.cases[0]?.determinismHash,
    second.value.report.semantics.cases[0]?.determinismHash,
  );
  assert.equal(
    first.value.report.semantics.cases[0]?.canonicalCaseJson,
    second.value.report.semantics.cases[0]?.canonicalCaseJson,
  );
  assert.equal(
    first.value.report.semantics.cases[0]?.canonicalRunJson,
    second.value.report.semantics.cases[0]?.canonicalRunJson,
  );
});

void test('directory, file, case, duplicate, and negative-clock failures are atomic and frozen', async () => {
  const directoryFailure = await discoverOfflineRouterCases('/private', {
    readDirectory() {
      return Promise.reject(new Error('private directory prose'));
    },
    readFile() {
      return Promise.reject(new Error('must not be called'));
    },
    now() {
      throw new Error('must not be called');
    },
  });
  assert.deepEqual(directoryFailure, {
    ok: false,
    error: { code: 'case-directory-read-failed', directory: '/private' },
  });
  assert.equal('value' in directoryFailure, false);
  assertDeepFrozen(directoryFailure);

  const success = await fixture('success.json');
  const fileInjected = dependencies(
    [
      { name: 'b.json', isFile: true },
      { name: 'a.json', isFile: true },
    ],
    new Map([[join('/cases', 'a.json'), success]]),
    [0n, 1n, 2n],
  );
  const fileFailure = await discoverOfflineRouterCases(
    '/cases',
    fileInjected.dependencies,
  );
  assert.deepEqual(fileFailure, {
    ok: false,
    error: { code: 'case-file-read-failed', filename: 'b.json' },
  });
  assert.deepEqual(fileInjected.fileCalls, [
    join('/cases', 'a.json'),
    join('/cases', 'b.json'),
  ]);
  assert.equal(fileInjected.clockCalls, 3);
  assert.equal('value' in fileFailure, false);
  assertDeepFrozen(fileFailure);

  const invalidInjected = dependencies(
    [
      { name: 'z.json', isFile: true },
      { name: 'a.json', isFile: true },
    ],
    new Map([
      [join('/cases', 'a.json'), '{'],
      [join('/cases', 'z.json'), success],
    ]),
    [5n],
  );
  const invalid = await discoverOfflineRouterCases('/cases', invalidInjected.dependencies);
  assert.deepEqual(invalid, {
    ok: false,
    error: {
      code: 'invalid-router-case-file',
      filename: 'a.json',
      caseError: { code: 'invalid-router-case-json' },
    },
  });
  assert.deepEqual(invalidInjected.fileCalls, [join('/cases', 'a.json')]);
  assert.equal(invalidInjected.clockCalls, 1);
  assert.equal('value' in invalid, false);
  assertDeepFrozen(invalid);

  const duplicateInjected = dependencies(
    [
      { name: 'second.json', isFile: true },
      { name: 'first.json', isFile: true },
    ],
    new Map([
      [join('/cases', 'first.json'), success],
      [join('/cases', 'second.json'), success],
    ]),
    [0n, 1n, 2n, 3n],
  );
  const duplicate = await discoverOfflineRouterCases(
    '/cases',
    duplicateInjected.dependencies,
  );
  assert.deepEqual(duplicate, {
    ok: false,
    error: {
      code: 'duplicate-router-case-id',
      caseId: 'm3-success',
      firstFilename: 'first.json',
      duplicateFilename: 'second.json',
    },
  });
  assert.equal(duplicateInjected.fileCalls.length, 2);
  assert.equal(duplicateInjected.clockCalls, 4);
  assert.equal('value' in duplicate, false);
  assertDeepFrozen(duplicate);

  const negativeInjected = dependencies(
    [{ name: 'negative.json', isFile: true }],
    new Map([[join('/cases', 'negative.json'), NO_PLAN_CASE]]),
    [10n, 9n],
  );
  const negative = await createOfflineRouterBenchmarkReport(
    '/cases',
    negativeInjected.dependencies,
    ENVIRONMENT,
  );
  assert.deepEqual(negative, {
    ok: false,
    error: { code: 'negative-elapsed-time', filename: 'negative.json' },
  });
  assert.equal('value' in negative, false);
  assertDeepFrozen(negative);
});

void test('empty filtered discovery and report are canonical frozen successes', async () => {
  const injected = dependencies(
    [
      { name: 'README.md', isFile: true },
      { name: 'nested.json', isFile: false },
      { name: 'upper.JSON', isFile: true },
    ],
    new Map(),
    [],
  );
  const report = await createOfflineRouterBenchmarkReport(
    '/empty',
    injected.dependencies,
    ENVIRONMENT,
  );
  assert.equal(report.ok, true);
  if (!report.ok) return;
  assert.equal(report.value.report.semantics.caseCount, 0);
  assert.deepEqual(report.value.report.semantics.cases, []);
  assert.deepEqual(report.value.report.observations.cases, []);
  assert.deepEqual(injected.fileCalls, []);
  assert.equal(injected.clockCalls, 0);
  assertDeepFrozen(report);
});

void test('CLI help and argument failures use exact streams and exits', () => {
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stdout, USAGE);
  assert.equal(help.stderr, '');

  const invalidArguments: readonly (readonly string[])[] = [
    ['--unknown'],
    ['--cases'],
    ['--cases', ''],
    ['--cases', '--other'],
    ['--cases', 'a', '--cases', 'b'],
    ['positional'],
    ['--help', '--cases', 'a'],
    ['--cases', 'a', 'extra'],
  ];
  for (const arguments_ of invalidArguments) {
    const result = runCli(arguments_);
    assert.equal(result.status, 1, arguments_.join(' '));
    assert.equal(result.stdout, '', arguments_.join(' '));
    assert.equal(result.stderr, USAGE, arguments_.join(' '));
  }
});

void test('CLI emits one report line on success and one stable runtime failure line', async () => {
  const success = runCli([]);
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  assert.equal(success.stdout.endsWith('\n'), true);
  assert.equal(success.stdout.slice(0, -1).includes('\n'), false);
  const report = JSON.parse(success.stdout) as {
    schemaVersion: string;
    semantics: {
      caseDirectory: string;
      caseCount: number;
      cases: Array<{
        filename: string;
        canonicalCaseJson: string;
        canonicalRunJson: string;
      }>;
    };
    observations: { environment: object; cases: unknown[] };
    limitations: string[];
  };
  assert.equal(report.schemaVersion, 'routelab.benchmark-report.v1');
  assert.equal(report.semantics.caseDirectory, 'fixtures/m3/router-cases');
  assert.equal(report.semantics.caseCount, 3);
  assert.deepEqual(
    report.semantics.cases.map(({ filename }) => filename),
    ['no-plan.json', 'no-route.json', 'success.json'],
  );
  for (const entry of report.semantics.cases) {
    assert.equal(
      entry.canonicalCaseJson,
      await fixture(entry.filename),
    );
    const caseRecord = JSON.parse(entry.canonicalCaseJson) as { run: unknown };
    assert.equal(entry.canonicalRunJson, JSON.stringify(caseRecord.run));
  }
  assert.deepEqual(report.limitations, LIMITATIONS);
  assert.equal(report.observations.cases.length, 3);

  const override = runCli(['--cases', 'fixtures/m3/router-cases']);
  assert.equal(override.status, 0);
  assert.equal(override.stderr, '');
  assert.equal(override.stdout.endsWith('\n'), true);

  const runtimeFailure = runCli([
    '--cases',
    'fixtures/m3/router-cases-does-not-exist',
  ]);
  assert.equal(runtimeFailure.status, 1);
  assert.equal(runtimeFailure.stdout, '');
  assert.equal(
    runtimeFailure.stderr,
    'case replay failed: case-directory-read-failed\n',
  );
});
