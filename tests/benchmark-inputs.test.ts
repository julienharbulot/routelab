import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generatePortfolioRequests } from '../src/benchmark/portfolio/generate-cases.ts';
import {
  loadPortfolioInputs,
  PORTFOLIO_INPUT_DIRECTORY,
} from '../src/benchmark/portfolio/input-manifest.ts';

void test('retained inputs derive the frozen 396-request benchmark corpus', async () => {
  const inputs = await loadPortfolioInputs();
  const corpus = generatePortfolioRequests(inputs.datasetId, inputs.snapshot, inputs.assets);
  assert.deepEqual(
    [inputs.summary.poolCount, inputs.summary.assetCount, corpus.summary.requestCount],
    [54, 12, 396],
  );
  assert.equal(corpus.summary.directRequestCount, 324);
  assert.equal(corpus.summary.multiHopOnlyRequestCount, 72);
  assert.equal(
    corpus.summary.corpusDigest,
    'sha256:be31d0abcbd80d2364df3e5a9a62aeabf7e93fddce3b7a66f6cea66967ab74ac',
  );
  assert.deepEqual(
    corpus.requests.map(({ requestId, assetIn, assetOut, amountBucket, amountIn, topology }) =>
      [requestId, assetIn, assetOut, amountBucket, amountIn.toString(10), topology]
    ).filter((_, index) => index === 0 || index === 395),
    [
      ['request-0001', '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', 'max-reserve-1-in-100000', '269808139664661', 'direct-edge-present'],
      ['request-0396', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0xd533a949740bb3306d119cc777fa900ba034cd52', 'max-reserve-1-in-1000', '75619326628', 'direct-edge-present'],
    ],
  );
});

void test('retained input verification rejects changed files and block identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'routelab-inputs-'));
  const directory = path.join(root, PORTFOLIO_INPUT_DIRECTORY);
  await cp(PORTFOLIO_INPUT_DIRECTORY, directory, { recursive: true });
  const snapshotPath = path.join(directory, 'snapshot.json');
  await writeFile(snapshotPath, `${await readFile(snapshotPath, 'utf8')} `);
  await assert.rejects(loadPortfolioInputs(root), /file hash mismatch/u);

  await cp(PORTFOLIO_INPUT_DIRECTORY, directory, { recursive: true, force: true });
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  (manifest['chain'] as Record<string, unknown>)['number'] = '19000001';
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(loadPortfolioInputs(root), /Block identity/u);
});
