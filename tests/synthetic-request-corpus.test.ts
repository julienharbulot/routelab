import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { isPreparedRoutingContext } from '../src/runtime/prepared-routing-context/index.ts';
import {
  CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY,
  verifySyntheticRequestCorpus,
  type SyntheticRequestCorpusVerificationErrorCode,
} from '../src/verification/synthetic-request-corpus/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HISTORICAL_DIRECTORY =
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS_DIRECTORY = CANONICAL_SYNTHETIC_REQUEST_CORPUS_DIRECTORY;
const CORPUS_MANIFEST = path.join(CORPUS_DIRECTORY, 'manifest.json');
const REQUESTS = path.join(CORPUS_DIRECTORY, 'requests.json');
const HISTORICAL_FILES = [
  'manifest.json',
  'policy.json',
  'sources/infura-normalized.json',
  'sources/sqd-normalized.json',
  'reconciliation.json',
  'snapshot.json',
  'canonical-snapshot-content.json',
] as const;

type Files = Map<string, Uint8Array>;

function canonicalFiles(): Files {
  const files: Files = new Map();
  files.set(CORPUS_MANIFEST, Uint8Array.from(readFileSync(path.join(ROOT, CORPUS_MANIFEST))));
  files.set(REQUESTS, Uint8Array.from(readFileSync(path.join(ROOT, REQUESTS))));
  for (const relative of HISTORICAL_FILES) {
    const key = path.join(HISTORICAL_DIRECTORY, relative);
    files.set(key, Uint8Array.from(readFileSync(path.join(ROOT, key))));
  }
  return files;
}

function reader(files: Files, reads: string[] = []) {
  return (filePath: string): Promise<Uint8Array> => {
    reads.push(filePath);
    const bytes = files.get(filePath);
    if (bytes === undefined) throw new Error(`sensitive OS detail for ${filePath}`);
    return Promise.resolve(Uint8Array.from(bytes));
  };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function json(files: Files, filePath: string): Record<string, unknown> {
  const bytes = files.get(filePath);
  assert.ok(bytes);
  return JSON.parse(text(bytes)) as Record<string, unknown>;
}

function replaceJson(files: Files, filePath: string, value: unknown): void {
  files.set(filePath, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
}

function replaceRequestsAndAuthorizeArtifact(files: Files, bytes: Uint8Array): void {
  files.set(REQUESTS, Uint8Array.from(bytes));
  const manifest = json(files, CORPUS_MANIFEST);
  const artifact = manifest['artifact'] as Record<string, unknown>;
  artifact['bytes'] = bytes.byteLength;
  artifact['sha256'] = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  replaceJson(files, CORPUS_MANIFEST, manifest);
}

async function expectCode(
  files: Files,
  expected: SyntheticRequestCorpusVerificationErrorCode,
): Promise<void> {
  const result = await verifySyntheticRequestCorpus(CORPUS_DIRECTORY, {
    readFile: reader(files),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, expected);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.doesNotMatch(result.error.message, /sensitive OS detail/u);
}

void test('verifies the exhaustive corpus once and returns a frozen reusable bundle', async () => {
  const files = canonicalFiles();
  const reads: string[] = [];
  const result = await verifySyntheticRequestCorpus(CORPUS_DIRECTORY, {
    readFile: reader(files, reads),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(reads, [
    CORPUS_MANIFEST,
    path.join(HISTORICAL_DIRECTORY, 'manifest.json'),
    path.join(HISTORICAL_DIRECTORY, 'policy.json'),
    path.join(HISTORICAL_DIRECTORY, 'sources/infura-normalized.json'),
    path.join(HISTORICAL_DIRECTORY, 'sources/sqd-normalized.json'),
    path.join(HISTORICAL_DIRECTORY, 'reconciliation.json'),
    path.join(HISTORICAL_DIRECTORY, 'snapshot.json'),
    path.join(HISTORICAL_DIRECTORY, 'canonical-snapshot-content.json'),
    REQUESTS,
  ]);
  assert.equal(new Set(reads).size, reads.length);
  assert.equal(isPreparedRoutingContext(result.value.context), true);
  assert.deepEqual(result.value.summary, {
    schemaVersion: 'routelab.synthetic-request-corpus-verification-summary.v1',
    corpusId:
      'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1',
    datasetId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1',
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1',
    snapshotChecksum:
      'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755',
    artifactSha256:
      'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173',
    requestCount: 396,
    amountBucketCount: 3,
    directRequestCount: 324,
    multiHopOnlyRequestCount: 72,
    randomness: 'none',
  });
  assert.equal(result.value.corpus.requests.length, 396);
  assert.deepEqual(result.value.corpus.requests[0], {
    requestId: 'request-0001',
    assetIn: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e',
    assetOut: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    amountBucket: 'max-reserve-1-in-100000',
    amountIn: 269_808_139_664_661n,
    topology: 'direct-edge-present',
  });
  assert.deepEqual(result.value.corpus.requests.at(-1), {
    requestId: 'request-0396',
    assetIn: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    assetOut: '0xd533a949740bb3306d119cc777fa900ba034cd52',
    amountBucket: 'max-reserve-1-in-1000',
    amountIn: 75_619_326_628n,
    topology: 'direct-edge-present',
  });
  assert.equal(
    result.value.corpus.requests.filter(
      ({ topology }) => topology === 'direct-edge-absent-common-neighbor-present',
    ).length,
    72,
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.context), true);
  assert.equal(Object.isFrozen(result.value.corpus), true);
  assert.equal(Object.isFrozen(result.value.corpus.requests), true);
  assert.equal(Object.isFrozen(result.value.corpus.requests[0]), true);
  assert.equal(Object.isFrozen(result.value.summary), true);
});

void test('applies manifest read, JSON, strict-shape, and fixed-safe-path precedence', async () => {
  const missing = canonicalFiles();
  missing.delete(CORPUS_MANIFEST);
  await expectCode(missing, 'manifest-read-failed');

  const invalidJson = canonicalFiles();
  invalidJson.set(CORPUS_MANIFEST, new TextEncoder().encode('{'));
  await expectCode(invalidJson, 'invalid-manifest-json');

  const alias = canonicalFiles();
  const aliasManifest = json(alias, CORPUS_MANIFEST);
  aliasManifest['seed'] = 'forbidden';
  replaceJson(alias, CORPUS_MANIFEST, aliasManifest);
  await expectCode(alias, 'invalid-manifest-shape');

  const traversal = canonicalFiles();
  const traversalManifest = json(traversal, CORPUS_MANIFEST);
  (traversalManifest['artifact'] as Record<string, unknown>)['path'] = '../requests.json';
  replaceJson(traversal, CORPUS_MANIFEST, traversalManifest);
  const reads: string[] = [];
  const result = await verifySyntheticRequestCorpus(CORPUS_DIRECTORY, {
    readFile: reader(traversal, reads),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'invalid-manifest-shape');
  assert.deepEqual(reads, [CORPUS_MANIFEST]);
});

void test('requires complete historical verification before reading requests', async () => {
  const files = canonicalFiles();
  const policyPath = path.join(HISTORICAL_DIRECTORY, 'policy.json');
  const policy = files.get(policyPath);
  assert.ok(policy);
  files.set(policyPath, Uint8Array.from([...policy, 0x20]));
  const reads: string[] = [];
  const result = await verifySyntheticRequestCorpus(CORPUS_DIRECTORY, {
    readFile: reader(files, reads),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'historical-dataset-invalid');
    assert.equal(result.error.artifact, 'historical-dataset/policy.json');
  }
  assert.equal(reads.includes(REQUESTS), false);
});

void test('checks request read, size, and hash before parsing content', async () => {
  const missing = canonicalFiles();
  missing.delete(REQUESTS);
  await expectCode(missing, 'requests-read-failed');

  const size = canonicalFiles();
  const original = size.get(REQUESTS);
  assert.ok(original);
  size.set(REQUESTS, Uint8Array.from([...original, 0x20]));
  await expectCode(size, 'requests-size-mismatch');

  const hash = canonicalFiles();
  const changed = Uint8Array.from(original);
  changed[changed.length - 1] = 0x5d;
  hash.set(REQUESTS, changed);
  await expectCode(hash, 'requests-hash-mismatch');
});

void test('rejects authorized malformed JSON and strict corpus-shape drift', async () => {
  const invalidJson = canonicalFiles();
  replaceRequestsAndAuthorizeArtifact(invalidJson, new TextEncoder().encode('{'));
  await expectCode(invalidJson, 'invalid-requests-json');

  const alias = canonicalFiles();
  const corpus = json(alias, REQUESTS);
  const first = (corpus['requests'] as Array<Record<string, unknown>>)[0];
  assert.ok(first);
  first['result'] = 'forbidden';
  replaceRequestsAndAuthorizeArtifact(alias, new TextEncoder().encode(JSON.stringify(corpus)));
  await expectCode(alias, 'invalid-requests-shape');

  const duplicate = canonicalFiles();
  const duplicateCorpus = json(duplicate, REQUESTS);
  const requests = duplicateCorpus['requests'] as Array<Record<string, unknown>>;
  assert.ok(requests[0]);
  assert.ok(requests[1]);
  requests[1]['requestId'] = requests[0]['requestId'];
  replaceRequestsAndAuthorizeArtifact(
    duplicate,
    new TextEncoder().encode(JSON.stringify(duplicateCorpus)),
  );
  await expectCode(duplicate, 'invalid-requests-shape');
});

void test('derives every amount and topology instead of trusting an authorized artifact', async () => {
  const files = canonicalFiles();
  const corpus = json(files, REQUESTS);
  const requests = corpus['requests'] as Array<Record<string, unknown>>;
  assert.ok(requests[0]);
  requests[0]['amountIn'] = '269808139664662';
  replaceRequestsAndAuthorizeArtifact(files, new TextEncoder().encode(JSON.stringify(corpus)));
  await expectCode(files, 'corpus-derivation-mismatch');

  const topology = canonicalFiles();
  const topologyCorpus = json(topology, REQUESTS);
  const noDirect = (topologyCorpus['requests'] as Array<Record<string, unknown>>).find(
    (request) => request['topology'] === 'direct-edge-absent-common-neighbor-present',
  );
  assert.ok(noDirect);
  noDirect['topology'] = 'direct-edge-present';
  replaceRequestsAndAuthorizeArtifact(
    topology,
    new TextEncoder().encode(JSON.stringify(topologyCorpus)),
  );
  await expectCode(topology, 'corpus-derivation-mismatch');
});

void test('checks frozen manifest metadata only after exact corpus derivation', async () => {
  const files = canonicalFiles();
  const manifest = json(files, CORPUS_MANIFEST);
  (manifest['sourceDataset'] as Record<string, unknown>)['datasetId'] = 'drifted-dataset';
  replaceJson(files, CORPUS_MANIFEST, manifest);
  await expectCode(files, 'manifest-metadata-mismatch');
});
