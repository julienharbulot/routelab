import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CANONICAL_SPLIT_ROUTER_CASE_SCHEMA_VERSION,
  createCanonicalSplitRouterCase,
  parseAndVerifyCanonicalSplitRouterCase,
} from '../src/serialization/canonical-split-router-case/index.ts';
import {
  OFFLINE_SPLIT_CASE_VERIFICATION_LIMITATIONS,
  OFFLINE_SPLIT_CASE_VERIFICATION_SCHEMA_VERSION,
  verifyOfflineSplitRouterCases,
  type OfflineSplitCaseDirectoryEntry,
  type OfflineSplitCaseVerificationDependencies,
} from '../src/verification/offline-split-router-cases/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES = fileURLToPath(
  new URL('../fixtures/pre-m6/split-router-cases/', import.meta.url),
);
const CLI = fileURLToPath(new URL('../cli/replay-split-cases.ts', import.meta.url));
const USAGE = 'Usage: pnpm replay:split-cases [--cases <directory>]\n';

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf8');
}

function caseWithId(canonicalJson: string, caseId: string): string {
  const parsed = JSON.parse(canonicalJson) as Record<string, unknown>;
  parsed['caseId'] = caseId;
  return JSON.stringify(parsed);
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

interface Injected {
  readonly dependencies: OfflineSplitCaseVerificationDependencies;
  readonly directoryCalls: string[];
  readonly fileCalls: string[];
}

function dependencies(
  entries: readonly OfflineSplitCaseDirectoryEntry[],
  files: ReadonlyMap<string, string>,
): Injected {
  const directoryCalls: string[] = [];
  const fileCalls: string[] = [];
  return {
    directoryCalls,
    fileCalls,
    dependencies: {
      readDirectory(directory) {
        directoryCalls.push(directory);
        return Promise.resolve(entries);
      },
      readFile(path) {
        fileCalls.push(path);
        const content = files.get(path);
        return content === undefined
          ? Promise.reject(new Error('missing injected file'))
          : Promise.resolve(content);
      },
    },
  };
}

void test('fixed split cases have exact bytes, hashes, fresh replay, and no trailing whitespace', async () => {
  const complete = await fixture('complete-split-66.json');
  const limited = await fixture('work-limit-fallback-50.json');
  assert.equal(complete.endsWith('}'), true);
  assert.equal(limited.endsWith('}'), true);
  assert.equal(complete.endsWith('\n'), false);
  assert.equal(limited.endsWith('\n'), false);

  const expected = [
    [complete, 'pre-m6-split-improves-66', 'sha256:d38c5035cf41b14847adf623ab9bc18051a1a48c5e8433afb257fcc7f1944f7a', 66n, 'complete'],
    [limited, 'pre-m6-direct-fallback-work-limit-50', 'sha256:84eff360c586b13db3fcc79c216837f19998bdf09b1dabd4ac94f34bee96d67e', 50n, 'work-limit'],
  ] as const;
  for (const [json, caseId, hash, amountOut, termination] of expected) {
    const parsed = parseAndVerifyCanonicalSplitRouterCase(json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.value.caseId, caseId);
    assert.equal(parsed.value.run.determinismHash, hash);
    assert.equal(parsed.value.run.routerResult.status, 'success');
    if (parsed.value.run.routerResult.status === 'success') {
      assert.equal(parsed.value.run.routerResult.plan.receipt.amountOut, amountOut);
      assert.equal(parsed.value.run.routerResult.plan.search.termination, termination);
    }
    assertDeepFrozen(parsed.value);
  }
});

void test('split-case wrapper strictly verifies the inner run and exact outer bytes', async () => {
  const canonicalJson = await fixture('complete-split-66.json');
  const parsed = parseAndVerifyCanonicalSplitRouterCase(canonicalJson);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(CANONICAL_SPLIT_ROUTER_CASE_SCHEMA_VERSION, 'routelab.split-router-case.v1');
  const recreated = createCanonicalSplitRouterCase(
    parsed.value.caseId,
    parsed.value.run.canonicalJson,
    parsed.value.run.determinismHash,
  );
  assert.equal(recreated.ok, true);
  if (recreated.ok) assert.equal(recreated.value.canonicalJson, canonicalJson);

  assert.deepEqual(createCanonicalSplitRouterCase('', parsed.value.run.canonicalJson, parsed.value.run.determinismHash), {
    ok: false,
    error: { code: 'invalid-split-router-case-id' },
  });
  const extra = JSON.parse(canonicalJson) as Record<string, unknown>;
  extra['timing'] = 1;
  const extraResult = parseAndVerifyCanonicalSplitRouterCase(JSON.stringify(extra));
  assert.deepEqual(extraResult, {
    ok: false,
    error: { code: 'invalid-split-router-case-shape', path: '$.timing' },
  });
  const whitespace = parseAndVerifyCanonicalSplitRouterCase(` ${canonicalJson}`);
  assert.deepEqual(whitespace, {
    ok: false,
    error: { code: 'split-router-case-canonical-mismatch' },
  });
  const tampered = JSON.parse(canonicalJson) as {
    run: { result: { plan: { receipt: { amountOut: string } } } };
  };
  tampered.run.result.plan.receipt.amountOut = '65';
  const tamperedResult = parseAndVerifyCanonicalSplitRouterCase(JSON.stringify(tampered));
  assert.equal(tamperedResult.ok, false);
  if (!tamperedResult.ok) assert.deepEqual(tamperedResult.error, { code: 'canonical-split-run-replay-mismatch' });
});

void test('verifier reads JSON files once in raw UTF-16 order and emits deterministic semantics only', async () => {
  const base = await fixture('complete-split-66.json');
  const emoji = '\u{1f600}.json';
  const privateUse = '\ue000.json';
  const entries = [
    { name: privateUse, isFile: true },
    { name: 'README.md', isFile: true },
    { name: emoji, isFile: true },
    { name: 'Z.json', isFile: true },
  ];
  const files = new Map([
    [join('/cases', 'Z.json'), caseWithId(base, 'case-z')],
    [join('/cases', emoji), caseWithId(base, 'case-emoji')],
    [join('/cases', privateUse), caseWithId(base, 'case-private')],
  ]);
  const injected = dependencies(entries, files);
  const result = await verifyOfflineSplitRouterCases('/cases', injected.dependencies);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.summary.cases.map(({ filename }) => filename), ['Z.json', emoji, privateUse]);
  assert.deepEqual(injected.fileCalls, [join('/cases', 'Z.json'), join('/cases', emoji), join('/cases', privateUse)]);
  assert.deepEqual(injected.directoryCalls, ['/cases']);
  assert.equal(result.value.summary.schemaVersion, OFFLINE_SPLIT_CASE_VERIFICATION_SCHEMA_VERSION);
  assert.deepEqual(result.value.summary.limitations, OFFLINE_SPLIT_CASE_VERIFICATION_LIMITATIONS);
  assert.equal(result.value.canonicalJson.includes('elapsed'), false);
  assert.equal(result.value.canonicalJson.includes('environment'), false);
  assert.equal(result.value.canonicalJson.includes('clock'), false);
  assertDeepFrozen(result);
});

void test('verifier rejects nonfiles, tampering, duplicate IDs, and read failures atomically', async () => {
  const base = await fixture('complete-split-66.json');
  const nonfile = await verifyOfflineSplitRouterCases('/cases', dependencies([
    { name: 'nested.json', isFile: false },
  ], new Map()).dependencies);
  assert.deepEqual(nonfile, {
    ok: false,
    error: { code: 'split-case-entry-not-file', filename: 'nested.json' },
  });

  const duplicate = await verifyOfflineSplitRouterCases('/cases', dependencies([
    { name: 'a.json', isFile: true },
    { name: 'b.json', isFile: true },
  ], new Map([
    [join('/cases', 'a.json'), base],
    [join('/cases', 'b.json'), base],
  ])).dependencies);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, 'duplicate-split-router-case-id');
  assert.equal('value' in duplicate, false);

  const invalid = await verifyOfflineSplitRouterCases('/cases', dependencies([
    { name: 'bad.json', isFile: true },
  ], new Map([[join('/cases', 'bad.json'), `${base}\n`]])).dependencies);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.code, 'invalid-split-router-case-file');
    if (invalid.error.code === 'invalid-split-router-case-file') {
      assert.equal(invalid.error.caseError.code, 'split-router-case-canonical-mismatch');
    }
  }

  const directoryFailure = await verifyOfflineSplitRouterCases('/cases', {
    readDirectory: () => Promise.reject(new Error('private detail')),
    readFile: () => Promise.reject(new Error('must not run')),
  });
  assert.deepEqual(directoryFailure, {
    ok: false,
    error: { code: 'split-case-directory-read-failed', directory: '/cases' },
  });
  const fileFailure = await verifyOfflineSplitRouterCases('/cases', {
    readDirectory: () => Promise.resolve([{ name: 'case.json', isFile: true }]),
    readFile: () => Promise.reject(new Error('private detail')),
  });
  assert.deepEqual(fileFailure, {
    ok: false,
    error: { code: 'split-case-file-read-failed', filename: 'case.json' },
  });
  assertDeepFrozen(fileFailure);
});

void test('split replay CLI has deterministic help, argument, failure, and fixed-case success', () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, USAGE);
  assert.equal(help.stderr, '');

  const invalid = spawnSync(process.execPath, [CLI, '--cases'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr, USAGE);

  const failure = spawnSync(process.execPath, [CLI, '--cases', 'missing-split-cases'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.equal(failure.stderr, 'split case replay failed: split-case-directory-read-failed\n');

  const success = spawnSync(process.execPath, [CLI], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  const summary = JSON.parse(success.stdout) as {
    caseCount: number;
    cases: readonly { caseId: string; amountOut: string; termination: string }[];
  };
  assert.equal(summary.caseCount, 2);
  assert.deepEqual(summary.cases.map(({ caseId, amountOut, termination }) => ({ caseId, amountOut, termination })), [
    { caseId: 'pre-m6-split-improves-66', amountOut: '66', termination: 'complete' },
    { caseId: 'pre-m6-direct-fallback-work-limit-50', amountOut: '50', termination: 'work-limit' },
  ]);
});
