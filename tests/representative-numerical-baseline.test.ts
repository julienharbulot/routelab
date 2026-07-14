import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import {
  createRepresentativeNumericalBaseline,
  defaultRepresentativeBaselineDependencies,
  verifyRepresentativeNumericalBaseline,
} from '../src/benchmark/representative-numerical-baseline/index.ts';

interface RetainedReferenceReaderModule {
  readonly createRetainedReferenceSourceReader: (
    readFile: (filePath: string) => Promise<Uint8Array>,
  ) => (filePath: string) => Promise<Uint8Array>;
}

const RETAINED_READER_URL = new URL(
  '../src/verification/retained-reference-source/index.ts',
  import.meta.url,
);
const retainedReaderModule: RetainedReferenceReaderModule | undefined =
  existsSync(RETAINED_READER_URL)
    ? await import(RETAINED_READER_URL.href) as RetainedReferenceReaderModule
    : undefined;

void test('runtime identity mismatch rejects before any bound input read or baseline call', async () => {
  let reads = 0;
  let calls = 0;
  const result = await createRepresentativeNumericalBaseline({
    readFile(): Promise<Uint8Array> {
      reads += 1;
      return Promise.reject(new Error('must not read'));
    },
    versions: { node: 'v0.0.0', v8: '0', uv: '0' },
    route() {
      calls += 1;
      throw new Error('must not route');
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected runtime identity rejection.');
  assert.equal(result.error.code, 'runtime-version-mismatch');
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

void test('accepted representative baseline reconstructs exact snapshots, requests, results, and eligibility', { timeout: 60_000 }, async () => {
  const defaultDependencies = defaultRepresentativeBaselineDependencies();
  const result = await verifyRepresentativeNumericalBaseline(
    {
      ...defaultDependencies,
      readFile: retainedReaderModule === undefined
        ? defaultDependencies.readFile
        : retainedReaderModule.createRetainedReferenceSourceReader(
          defaultDependencies.readFile,
        ),
    },
  );
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
  if (!result.ok) return;
  assert.deepEqual(result.value.summary, {
    caseCount: 4,
    requestCount: 1584,
    cellCount: 1584,
    eligibleCounts: {
      'historical-anchor': 396,
      'synthetic-dual-spanning-tree': 174,
      'synthetic-reserve-compressed-1e12': 303,
      'synthetic-reserve-amplified-1e60': 396,
    },
    orderedEligibleCellSha256: 'sha256:48f86261df3e87a2add397e3456f049640fbdfd3e964524201051b452327b5e7',
  });
  assert.equal(result.value.files.size, 9);
});
