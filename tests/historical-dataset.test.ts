import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CANONICAL_HISTORICAL_DATASET_DIRECTORY,
  verifyHistoricalDataset,
  type HistoricalDatasetVerificationErrorCode,
  type HistoricalDatasetVerifierDependencies,
} from '../src/verification/historical-dataset/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATASET_DIRECTORY = path.join(ROOT, CANONICAL_HISTORICAL_DATASET_DIRECTORY);
const ARTIFACT_PATHS = [
  'policy.json',
  'sources/infura-normalized.json',
  'sources/sqd-normalized.json',
  'reconciliation.json',
  'snapshot.json',
  'canonical-snapshot-content.json',
] as const;

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

async function canonicalFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  files.set('manifest.json', await readFile(path.join(DATASET_DIRECTORY, 'manifest.json')));
  for (const artifactPath of ARTIFACT_PATHS) {
    files.set(artifactPath, await readFile(path.join(DATASET_DIRECTORY, artifactPath)));
  }
  return files;
}

function decodeJson(files: ReadonlyMap<string, Uint8Array>, relativePath: string): Record<string, unknown> {
  const bytes = files.get(relativePath);
  if (bytes === undefined) throw new Error(`Missing test file: ${relativePath}`);
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected object JSON: ${relativePath}`);
  }
  return value as Record<string, unknown>;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, undefined, 2)}\n`);
}

function replaceJson(
  files: Map<string, Uint8Array>,
  relativePath: string,
  mutate: (value: Record<string, unknown>) => void,
): void {
  const value = decodeJson(files, relativePath);
  mutate(value);
  files.set(relativePath, encodeJson(value));
}

function refreshArtifactDeclaration(files: Map<string, Uint8Array>, relativePath: string): void {
  const manifest = decodeJson(files, 'manifest.json');
  const artifacts = manifest['artifacts'];
  if (!Array.isArray(artifacts)) throw new Error('Expected manifest artifacts.');
  const artifact = artifacts.find((candidate) => {
    return typeof candidate === 'object'
      && candidate !== null
      && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>)['path'] === relativePath;
  }) as Record<string, unknown> | undefined;
  const bytes = files.get(relativePath);
  if (artifact === undefined || bytes === undefined) throw new Error(`Missing artifact: ${relativePath}`);
  artifact['bytes'] = bytes.byteLength;
  artifact['sha256'] = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  files.set('manifest.json', encodeJson(manifest));
}

function injectedDependencies(
  files: ReadonlyMap<string, Uint8Array>,
  calls: string[] = [],
): HistoricalDatasetVerifierDependencies {
  return {
    readFile(filePath) {
      const relativePath = path.relative('/dataset', filePath).split(path.sep).join('/');
      calls.push(relativePath);
      const bytes = files.get(relativePath);
      if (bytes === undefined) return Promise.reject(new Error('injected read failure'));
      return Promise.resolve(bytes);
    },
  };
}

async function verify(files: ReadonlyMap<string, Uint8Array>) {
  return verifyHistoricalDataset('/dataset', injectedDependencies(files));
}

async function assertFailure(
  files: ReadonlyMap<string, Uint8Array>,
  code: HistoricalDatasetVerificationErrorCode,
  artifact: string,
): Promise<void> {
  const result = await verify(files);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, code);
  assert.equal(result.error.artifact, artifact);
  assert.equal(result.error.message.length > 0, true);
  assertDeepFrozen(result);
}

void test('verifies the canonical import once in declared order and returns a frozen context summary', async () => {
  const files = await canonicalFiles();
  const calls: string[] = [];
  const result = await verifyHistoricalDataset('/dataset', injectedDependencies(files, calls));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(calls, ['manifest.json', ...ARTIFACT_PATHS]);
  assert.deepEqual(result.value.summary, {
    schemaVersion: 'routelab.dataset-verification-summary.v1',
    datasetId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1',
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1',
    snapshotChecksum: 'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755',
    artifactCount: 6,
    poolCount: 54,
    assetCount: 12,
    sourcePairCount: 54,
    exactReconciliation: true,
  });
  assert.deepEqual(Reflect.ownKeys(result.value.context), []);
  assertDeepFrozen(result);

  const repeated = await verify(files);
  assert.equal(repeated.ok, true);
  if (repeated.ok) assert.deepEqual(repeated.value.summary, result.value.summary);
});

void test('applies manifest read, JSON, closed-shape, and safe-path precedence', async () => {
  const missing = await canonicalFiles();
  missing.delete('manifest.json');
  await assertFailure(missing, 'manifest-read-failed', 'manifest.json');

  const malformed = await canonicalFiles();
  malformed.set('manifest.json', new TextEncoder().encode('{'));
  await assertFailure(malformed, 'invalid-manifest-json', 'manifest.json');

  const alias = await canonicalFiles();
  replaceJson(alias, 'manifest.json', (manifest) => {
    manifest['generatedAt'] = '2026-07-13T00:00:00Z';
  });
  await assertFailure(alias, 'invalid-manifest-shape', 'manifest.json');

  const traversal = await canonicalFiles();
  replaceJson(traversal, 'manifest.json', (manifest) => {
    const artifacts = manifest['artifacts'] as Record<string, unknown>[];
    const first = artifacts[0];
    if (first === undefined) throw new Error('Expected artifact.');
    first['path'] = '../policy.json';
  });
  await assertFailure(traversal, 'invalid-manifest-shape', 'manifest.json');
});

void test('checks every declared artifact read, size, and hash before parsing content', async () => {
  const missing = await canonicalFiles();
  missing.delete('sources/infura-normalized.json');
  await assertFailure(missing, 'artifact-read-failed', 'sources/infura-normalized.json');

  const wrongSize = await canonicalFiles();
  const policy = wrongSize.get('policy.json');
  if (policy === undefined) throw new Error('Expected policy.');
  wrongSize.set('policy.json', Uint8Array.from([...policy, 0x20]));
  await assertFailure(wrongSize, 'artifact-size-mismatch', 'policy.json');

  const wrongHash = await canonicalFiles();
  const infura = Uint8Array.from(wrongHash.get('sources/infura-normalized.json') ?? []);
  infura[0] = infura[0] === 0x7b ? 0x5b : 0x7b;
  wrongHash.set('sources/infura-normalized.json', infura);
  await assertFailure(wrongHash, 'artifact-hash-mismatch', 'sources/infura-normalized.json');
});

void test('strictly validates policy, normalized sources, and reconciliation after integrity', async () => {
  const policy = await canonicalFiles();
  replaceJson(policy, 'policy.json', (value) => {
    value['unexpected'] = true;
  });
  refreshArtifactDeclaration(policy, 'policy.json');
  await assertFailure(policy, 'invalid-policy', 'policy.json');

  const source = await canonicalFiles();
  replaceJson(source, 'sources/infura-normalized.json', (value) => {
    const pairs = value['pairs'] as Record<string, unknown>[];
    const first = pairs[0];
    if (first === undefined) throw new Error('Expected source pair.');
    first['reserve0'] = 1;
  });
  refreshArtifactDeclaration(source, 'sources/infura-normalized.json');
  await assertFailure(source, 'invalid-source-dataset', 'sources/infura-normalized.json');

  const reconciliation = await canonicalFiles();
  replaceJson(reconciliation, 'reconciliation.json', (value) => {
    value['unexpected'] = true;
  });
  refreshArtifactDeclaration(reconciliation, 'reconciliation.json');
  await assertFailure(reconciliation, 'invalid-reconciliation', 'reconciliation.json');
});

void test('proves source equality rather than trusting the reconciliation declaration', async () => {
  const files = await canonicalFiles();
  replaceJson(files, 'sources/sqd-normalized.json', (value) => {
    const pairs = value['pairs'] as Record<string, unknown>[];
    const first = pairs[0];
    if (first === undefined) throw new Error('Expected source pair.');
    first['reserve0'] = '122103331';
  });
  refreshArtifactDeclaration(files, 'sources/sqd-normalized.json');
  await assertFailure(files, 'source-reconciliation-mismatch', 'reconciliation.json');

  const falseClaim = await canonicalFiles();
  replaceJson(falseClaim, 'reconciliation.json', (value) => {
    value['exactMatch'] = false;
  });
  refreshArtifactDeclaration(falseClaim, 'reconciliation.json');
  await assertFailure(falseClaim, 'source-reconciliation-mismatch', 'reconciliation.json');
});

void test('enforces snapshot domain, stored order, canonical content, and preparation in sequence', async () => {
  const invalid = await canonicalFiles();
  replaceJson(invalid, 'snapshot.json', (value) => {
    value['unexpected'] = true;
  });
  refreshArtifactDeclaration(invalid, 'snapshot.json');
  await assertFailure(invalid, 'invalid-snapshot', 'snapshot.json');

  const unordered = await canonicalFiles();
  replaceJson(unordered, 'snapshot.json', (value) => {
    const pools = value['pools'] as Record<string, unknown>[];
    const first = pools[0];
    const second = pools[1];
    if (first === undefined || second === undefined) throw new Error('Expected two pools.');
    pools[0] = second;
    pools[1] = first;
  });
  refreshArtifactDeclaration(unordered, 'snapshot.json');
  await assertFailure(unordered, 'snapshot-order-mismatch', 'snapshot.json');

  const canonical = await canonicalFiles();
  const canonicalText = new TextDecoder().decode(
    canonical.get('canonical-snapshot-content.json'),
  );
  canonical.set(
    'canonical-snapshot-content.json',
    new TextEncoder().encode(canonicalText.replace('"reserve0":"122103330"', '"reserve0":"122103331"')),
  );
  refreshArtifactDeclaration(canonical, 'canonical-snapshot-content.json');
  await assertFailure(canonical, 'canonical-content-mismatch', 'canonical-snapshot-content.json');

  const checksum = await canonicalFiles();
  replaceJson(checksum, 'snapshot.json', (value) => {
    value['snapshotChecksum'] = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  });
  refreshArtifactDeclaration(checksum, 'snapshot.json');
  await assertFailure(checksum, 'snapshot-preparation-failed', 'snapshot.json');
});

void test('rejects structurally valid metadata drift only after content preparation', async () => {
  const files = await canonicalFiles();
  replaceJson(files, 'manifest.json', (manifest) => {
    manifest['selectionPolicy'] = 'different selection';
  });
  await assertFailure(files, 'manifest-metadata-mismatch', 'manifest.json');
});
