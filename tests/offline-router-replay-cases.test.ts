import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

import {
  createOfflineRouterBenchmarkReport,
  discoverOfflineRouterCases,
  OFFLINE_ROUTER_BENCHMARK_LIMITATIONS,
  OFFLINE_ROUTER_BENCHMARK_REPORT_SCHEMA_VERSION,
  type OfflineRouterBenchmarkDependencies,
  type OfflineRouterBenchmarkEnvironment,
  type OfflineRouterCaseDirectoryEntry,
} from '../src/benchmark/offline-router-cases/index.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../cli/replay-cases.ts', import.meta.url));
const FIXTURE_DIRECTORY = fileURLToPath(
  new URL('../fixtures/m3/router-cases/', import.meta.url),
);
const USAGE = 'Usage: pnpm replay:cases [--cases <directory>]\n';

const FIXED_ENVIRONMENT: OfflineRouterBenchmarkEnvironment = {
  nodeVersion: 'v24.test',
  platform: 'test-platform',
  arch: 'test-arch',
};

interface InMemoryDependencies {
  readonly dependencies: OfflineRouterBenchmarkDependencies;
  readonly directoryCalls: string[];
  readonly fileCalls: string[];
  readonly clockCalls: number;
}

function createDependencies(
  entries: readonly OfflineRouterCaseDirectoryEntry[],
  files: ReadonlyMap<string, string>,
  clockValues: readonly bigint[],
): InMemoryDependencies {
  const directoryCalls: string[] = [];
  const fileCalls: string[] = [];
  let clockIndex = 0;
  const dependencies: OfflineRouterBenchmarkDependencies = {
    readDirectory(directory) {
      directoryCalls.push(directory);
      return Promise.resolve(entries);
    },
    readFile(path) {
      fileCalls.push(path);
      const value = files.get(path);
      return value === undefined
        ? Promise.reject(new Error('missing injected file'))
        : Promise.resolve(value);
    },
    now() {
      const value = clockValues[clockIndex];
      if (value === undefined) throw new Error('missing injected clock value');
      clockIndex += 1;
      return value;
    },
  };
  return {
    dependencies,
    directoryCalls,
    fileCalls,
    get clockCalls() {
      return clockIndex;
    },
  };
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

function withCaseId(canonicalCaseJson: string, caseId: string): string {
  const parsed = JSON.parse(canonicalCaseJson) as Record<string, unknown>;
  parsed['caseId'] = caseId;
  return JSON.stringify(parsed);
}

async function fixture(filename: string): Promise<string> {
  return readFile(join(FIXTURE_DIRECTORY, filename), 'utf8');
}

void test('discovers regular JSON files in raw UTF-16 filename order exactly once', async () => {
  const base = await fixture('success.json');
  const emoji = '\u{1f600}.json';
  const privateUse = '\ue000.json';
  const entries = [
    { name: privateUse, isFile: true },
    { name: 'README.md', isFile: true },
    { name: 'ignored.json', isFile: false },
    { name: emoji, isFile: true },
    { name: 'Z.json', isFile: true },
  ];
  const files = new Map([
    [join('/cases', 'Z.json'), withCaseId(base, 'case-z')],
    [join('/cases', emoji), withCaseId(base, 'case-emoji')],
    [join('/cases', privateUse), withCaseId(base, 'case-private')],
  ]);
  const injected = createDependencies(entries, files, [10n, 13n, 20n, 25n, 30n, 38n]);

  const result = await discoverOfflineRouterCases('/cases', injected.dependencies);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.map(({ filename }) => filename),
    ['Z.json', emoji, privateUse],
  );
  assert.deepEqual(
    result.value.map(({ case: value }) => value.caseId),
    ['case-z', 'case-emoji', 'case-private'],
  );
  assert.deepEqual(
    result.value.map(({ elapsedNanoseconds }) => elapsedNanoseconds),
    [3n, 5n, 8n],
  );
  assert.deepEqual(injected.directoryCalls, ['/cases']);
  assert.deepEqual(injected.fileCalls, [
    join('/cases', 'Z.json'),
    join('/cases', emoji),
    join('/cases', privateUse),
  ]);
  assert.equal(injected.clockCalls, 6);
  assert.equal(result.value[0]?.canonicalCaseJson, files.get(join('/cases', 'Z.json')));
  assertDeepFrozen(result);
});

void test('captures injected directory entry properties once before filtering and sorting', async () => {
  const base = await fixture('success.json');
  let nameReads = 0;
  let isFileReads = 0;
  const entry: OfflineRouterCaseDirectoryEntry = {
    get name() {
      nameReads += 1;
      return nameReads === 1 ? 'selected.json' : 'drifted.json';
    },
    get isFile() {
      isFileReads += 1;
      return isFileReads === 1;
    },
  };
  const files = new Map([[join('/cases', 'selected.json'), base]]);
  const injected = createDependencies([entry], files, [1n, 2n]);

  const result = await discoverOfflineRouterCases('/cases', injected.dependencies);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value[0]?.filename, 'selected.json');
  assert.equal(nameReads, 1);
  assert.equal(isFileReads, 1);
});

void test('returns atomic frozen directory, file, case, duplicate, and clock failures', async () => {
  const success = await fixture('success.json');
  const noPlan = await fixture('no-plan.json');

  const directoryFailure = await discoverOfflineRouterCases('/cases', {
    readDirectory() {
      return Promise.reject(new Error('private filesystem prose'));
    },
    readFile() {
      return Promise.reject(new Error('must not run'));
    },
    now() {
      throw new Error('must not run');
    },
  });
  assert.deepEqual(directoryFailure, {
    ok: false,
    error: { code: 'case-directory-read-failed', directory: '/cases' },
  });
  assert.equal('value' in directoryFailure, false);
  assertDeepFrozen(directoryFailure);

  const fileFailure = await discoverOfflineRouterCases('/cases', {
    readDirectory() {
      return Promise.resolve([
        { name: 'a.json', isFile: true },
        { name: 'b.json', isFile: true },
      ]);
    },
    readFile(path) {
      return path.endsWith('a.json')
        ? Promise.resolve(success)
        : Promise.reject(new Error('private filesystem prose'));
    },
    now: (() => {
      const values = [0n, 1n, 2n];
      return () => values.shift() ?? 3n;
    })(),
  });
  assert.deepEqual(fileFailure, {
    ok: false,
    error: { code: 'case-file-read-failed', filename: 'b.json' },
  });
  assert.equal('value' in fileFailure, false);
  assertDeepFrozen(fileFailure);

  const invalidInjected = createDependencies(
    [{ name: 'bad.json', isFile: true }],
    new Map([[join('/cases', 'bad.json'), '{']]),
    [0n],
  );
  const invalid = await discoverOfflineRouterCases('/cases', invalidInjected.dependencies);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.deepEqual(invalid.error, {
      code: 'invalid-router-case-file',
      filename: 'bad.json',
      caseError: { code: 'invalid-router-case-json' },
    });
    assertDeepFrozen(invalid);
  }

  const duplicateInjected = createDependencies(
    [
      { name: 'a.json', isFile: true },
      { name: 'b.json', isFile: true },
    ],
    new Map([
      [join('/cases', 'a.json'), success],
      [join('/cases', 'b.json'), success],
    ]),
    [0n, 1n, 2n, 3n],
  );
  const duplicate = await discoverOfflineRouterCases('/cases', duplicateInjected.dependencies);
  assert.deepEqual(duplicate, {
    ok: false,
    error: {
      code: 'duplicate-router-case-id',
      caseId: 'm3-success',
      firstFilename: 'a.json',
      duplicateFilename: 'b.json',
    },
  });
  assert.equal('value' in duplicate, false);
  assertDeepFrozen(duplicate);

  const negativeInjected = createDependencies(
    [{ name: 'case.json', isFile: true }],
    new Map([[join('/cases', 'case.json'), noPlan]]),
    [9n, 8n],
  );
  const negative = await discoverOfflineRouterCases('/cases', negativeInjected.dependencies);
  assert.deepEqual(negative, {
    ok: false,
    error: { code: 'negative-elapsed-time', filename: 'case.json' },
  });
  assert.equal('value' in negative, false);
  assertDeepFrozen(negative);
});

void test('creates the exact separated report field order with bigint timing strings', async () => {
  const canonicalCaseJson = await fixture('no-plan.json');
  const caseRecord = JSON.parse(canonicalCaseJson) as {
    determinismHash: string;
    run: Record<string, unknown>;
  };
  const canonicalRunJson = JSON.stringify(caseRecord.run);
  const injected = createDependencies(
    [{ name: 'no-plan.json', isFile: true }],
    new Map([[join('/display/cases', 'no-plan.json'), canonicalCaseJson]]),
    [100n, 107n],
  );

  const result = await createOfflineRouterBenchmarkReport(
    '/display/cases',
    injected.dependencies,
    FIXED_ENVIRONMENT,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const expected = JSON.stringify({
    schemaVersion: 'routelab.benchmark-report.v1',
    semantics: {
      caseDirectory: '/display/cases',
      caseCount: 1,
      cases: [
        {
          filename: 'no-plan.json',
          caseId: 'm3-no-plan',
          determinismHash: caseRecord.determinismHash,
          status: 'no-plan',
          search: {
            expansions: 0,
            enumeratedCandidates: 0,
            replayedCandidates: 0,
            rejectedCandidates: 0,
            termination: 'work-limit',
          },
          canonicalCaseJson,
          canonicalRunJson,
        },
      ],
    },
    observations: {
      environment: {
        nodeVersion: 'v24.test',
        platform: 'test-platform',
        arch: 'test-arch',
      },
      cases: [{ filename: 'no-plan.json', elapsedNanoseconds: '7' }],
    },
    limitations: [
      'one observed verification per case; no warmup or repetition',
      'timings are non-statistical observations, not performance conclusions',
      'inputs are fixed offline repository cases',
      'routing is bounded exact-replayed single-path only',
      'no live service, transaction submission, custody, or protocol execution',
    ],
  });

  assert.equal(OFFLINE_ROUTER_BENCHMARK_REPORT_SCHEMA_VERSION, 'routelab.benchmark-report.v1');
  assert.equal(result.value.canonicalJson, expected);
  assert.deepEqual(result.value.report, JSON.parse(expected));
  assert.equal(typeof result.value.report.observations.cases[0]?.elapsedNanoseconds, 'string');
  assert.deepEqual(result.value.report.limitations, OFFLINE_ROUTER_BENCHMARK_LIMITATIONS);
  assertDeepFrozen(result);
});

void test('timing and environment changes affect observations only', async () => {
  const canonicalCaseJson = await fixture('success.json');
  const entries = [{ name: 'success.json', isFile: true }];
  const files = new Map([[join('/cases', 'success.json'), canonicalCaseJson]]);
  const first = await createOfflineRouterBenchmarkReport(
    '/cases',
    createDependencies(entries, files, [0n, 5n]).dependencies,
    FIXED_ENVIRONMENT,
  );
  const second = await createOfflineRouterBenchmarkReport(
    '/cases',
    createDependencies(entries, files, [100n, 109n]).dependencies,
    { nodeVersion: 'different', platform: 'other', arch: 'alternate' },
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.report.semantics, second.value.report.semantics);
  assert.notDeepEqual(first.value.report.observations, second.value.report.observations);
  assert.equal(
    first.value.report.semantics.cases[0]?.determinismHash,
    second.value.report.semantics.cases[0]?.determinismHash,
  );
  assert.notEqual(first.value.canonicalJson, second.value.canonicalJson);
});

function runCli(arguments_: readonly string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...arguments_], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
}

void test('CLI implements exact help and argument failure streams and exits', () => {
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stdout, USAGE);
  assert.equal(help.stderr, '');

  const invalidArguments: readonly (readonly string[])[] = [
    ['--unknown'],
    ['--cases'],
    ['--cases', '--cases'],
    ['--cases', '--unknown'],
    ['--cases', 'a', '--cases', 'b'],
    ['extra'],
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

void test('CLI emits one compact report line or one stable runtime failure line', () => {
  const success = runCli([]);
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  assert.equal(success.stdout.endsWith('\n'), true);
  assert.equal(success.stdout.slice(0, -1).includes('\n'), false);
  const report = JSON.parse(success.stdout) as {
    schemaVersion: string;
    semantics: { caseDirectory: string; caseCount: number };
  };
  assert.deepEqual(report, {
    ...report,
    schemaVersion: 'routelab.benchmark-report.v1',
    semantics: {
      ...report.semantics,
      caseDirectory: 'fixtures/m3/router-cases',
      caseCount: 3,
    },
  });

  const override = runCli(['--cases', 'fixtures/m3/router-cases']);
  assert.equal(override.status, 0);
  assert.equal(override.stderr, '');

  const failure = runCli(['--cases', 'fixtures/m3/router-cases-does-not-exist']);
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.equal(failure.stderr, 'case replay failed: case-directory-read-failed\n');
});
