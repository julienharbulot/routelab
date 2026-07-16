import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureEvidenceSource,
  verifyEvidenceSource,
} from '../src/evidence/source-identity.ts';

const TEST_OPTIONS = Object.freeze({
  pathSetVersion: 'routelab.test-evidence-paths.v1',
  pathSpecs: Object.freeze(['src', 'package.json']),
});

function git(root: string, ...arguments_: string[]): string {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'routelab-evidence-source-'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'reports', 'raw'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), 'reports/raw/\n');
  await writeFile(path.join(root, 'src', 'z.ts'), 'export const z = 1;\n');
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(root, 'package.json'), '{"private":true}\n');
  await writeFile(path.join(root, 'reports', 'result.md'), '# retained\n');
  git(root, 'init', '-b', 'main');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=RouteLab Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'fixture',
  );
  return root;
}

void test('evidence identity has deterministic path order, digest, and full source SHA', async () => {
  const root = await repository();
  try {
    const first = captureEvidenceSource(root, TEST_OPTIONS);
    const second = captureEvidenceSource(root, TEST_OPTIONS);
    assert.deepEqual(first.pathSet.paths, ['package.json', 'src/a.ts', 'src/z.ts']);
    assert.equal(first.digest, second.digest);
    assert.equal(first.revision, git(root, 'rev-parse', 'HEAD'));
    assert.match(first.revision, /^[0-9a-f]{40}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('retained evidence rejects dirty relevant paths', async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 2;\n');
    assert.throws(
      () => captureEvidenceSource(root, TEST_OPTIONS),
      /clean relevant paths/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('report-only and ignored changes do not block retained evidence', async () => {
  const root = await repository();
  try {
    await writeFile(path.join(root, 'reports', 'result.md'), '# regenerated\n');
    await writeFile(path.join(root, 'reports', 'raw', 'observations.json'), '{}\n');
    assert.doesNotThrow(() => captureEvidenceSource(root, TEST_OPTIONS));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('verification rejects a changed relevant executable tree', async () => {
  const root = await repository();
  try {
    const identity = captureEvidenceSource(root, TEST_OPTIONS);
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 3;\n');
    const issues = verifyEvidenceSource(identity, root, TEST_OPTIONS);
    assert.equal(issues.some((issue) => issue.includes('digest does not match')), true);
    assert.equal(issues.some((issue) => issue.includes('paths are dirty')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('release:verify is complete and does not recurse', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  const command = manifest.scripts?.['release:verify'];
  assert.equal(typeof command, 'string');
  assert.doesNotMatch(command ?? '', /release:verify/u);
  for (const required of [
    'lint',
    'typecheck',
    'test',
    'build',
    'test:package',
    'verify:historical-data',
    'verify:synthetic-requests',
    'benchmark:verify',
    'service:verify',
    'test:api',
    'serve:smoke',
    'load:smoke',
    'pack --dry-run',
  ]) assert.equal(command?.includes(required), true, `release:verify is missing ${required}.`);
});
