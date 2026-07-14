import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface RetainedReferenceSourceModule {
  readonly resolveRetainedReferenceSourcePath: (filePath: string) => string;
  readonly createRetainedReferenceSourceReader: (
    readFile: (filePath: string) => Promise<Uint8Array>,
  ) => (filePath: string) => Promise<Uint8Array>;
}

interface SourceBinding {
  readonly logicalPath: string;
  readonly provenancePath: string;
  readonly bytes: number;
  readonly sha256: string;
}

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const READER_PATH = path.join(
  ROOT,
  'src/verification/retained-reference-source/index.ts',
);
const PROVENANCE_README = path.join(
  ROOT,
  'fixtures/m7/numerical-representative-profile/provenance/README.md',
);
const BINDINGS: readonly SourceBinding[] = [
  {
    logicalPath: 'src/router/numerical-exact-input-split/index.ts',
    provenancePath: 'fixtures/m7/numerical-representative-profile/provenance/numerical-exact-input-split.index.source.ts',
    bytes: 55_869,
    sha256: 'f43365addfa4378eea98d2af2027eafbac2eebc173482a07a06604bd963c8305',
  },
  {
    logicalPath: 'cli/verify-historical-numerical-profile.ts',
    provenancePath: 'fixtures/m7/numerical-representative-profile/provenance/verify-historical-numerical-profile.source.ts',
    bytes: 1_008,
    sha256: '14615457261e75bbb2d8637f6600477972ca14af7d84eb6b229f62f703085cc8',
  },
  {
    logicalPath: 'cli/verify-representative-numerical-profile.ts',
    provenancePath: 'fixtures/m7/numerical-representative-profile/provenance/verify-representative-numerical-profile.source.ts',
    bytes: 985,
    sha256: 'a47c599ec1b2565787a0811ea0e8e76456396aad6f8700c6c430d85f802354ae',
  },
];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertFileIdentity(
  filePath: string,
  bytes: number,
  expectedSha256: string,
): void {
  const source = readFileSync(filePath);
  assert.equal(source.byteLength, bytes, filePath);
  assert.equal(sha256(source), expectedSha256, filePath);
}

async function loadReader(): Promise<RetainedReferenceSourceModule | undefined> {
  if (!existsSync(READER_PATH)) return undefined;
  const loaded: unknown = await import(pathToFileURL(READER_PATH).href);
  assert.equal(typeof loaded, 'object');
  assert.notEqual(loaded, null);
  return loaded as RetainedReferenceSourceModule;
}

void test('immutable numerical oracle and historical logical source identities remain exact', () => {
  assertFileIdentity(
    path.join(ROOT, 'tests/oracle/numerical-exact-input-split-runtime-oracle.test.ts'),
    52_464,
    '4f4ca6c3c0d0dd42b4a5ce8731bbdeb9d351e1d59e719ff60ed0f14eafdcb2e2',
  );
  for (const binding of BINDINGS) {
    const provenanceExists = existsSync(path.join(ROOT, binding.provenancePath));
    if (!existsSync(READER_PATH)) {
      assert.equal(provenanceExists, false, binding.provenancePath);
      assertFileIdentity(
        path.join(ROOT, binding.logicalPath),
        binding.bytes,
        binding.sha256,
      );
    } else {
      assert.equal(provenanceExists, true, binding.provenancePath);
      assertFileIdentity(
        path.join(ROOT, binding.provenancePath),
        binding.bytes,
        binding.sha256,
      );
    }
  }
  assert.equal(existsSync(PROVENANCE_README), existsSync(READER_PATH));
});

void test('provenance migration is absent only at the exact activation state or complete', async () => {
  const retained = await loadReader();
  if (retained === undefined) {
    assert.equal(existsSync(READER_PATH), false);
    for (const binding of BINDINGS) {
      assert.equal(existsSync(path.join(ROOT, binding.provenancePath)), false);
    }
    return;
  }

  assert.deepEqual(Object.keys(retained).sort(), [
    'createRetainedReferenceSourceReader',
    'resolveRetainedReferenceSourcePath',
  ]);
  const readme = readFileSync(PROVENANCE_README, 'utf8');
  for (const binding of BINDINGS) {
    assert.equal(
      retained.resolveRetainedReferenceSourcePath(binding.logicalPath),
      binding.provenancePath,
    );
    assert.equal(readme.includes(`\`${binding.logicalPath}\``), true);
    assert.equal(readme.includes(`\`${binding.provenancePath}\``), true);
    assert.equal(readme.includes(`\`${binding.sha256}\``), true);
  }

  const passThroughPaths = [
    'toString',
    'constructor',
    '__proto__',
    'hasOwnProperty',
    'valueOf',
    'cli/verify-representative-numerical-baseline.ts',
    'src/router/anytime-exact-input-split/index.ts',
    './src/router/numerical-exact-input-split/index.ts',
    '/src/router/numerical-exact-input-split/index.ts',
    'src/router/numerical-exact-input-split/index.ts.backup',
    'SRC/router/numerical-exact-input-split/index.ts',
    'fixtures/m7/numerical-representative-profile/profile-config.v1.json',
  ];
  for (const filePath of passThroughPaths) {
    assert.equal(retained.resolveRetainedReferenceSourcePath(filePath), filePath);
  }

  const reads: string[] = [];
  const reader = retained.createRetainedReferenceSourceReader(
    (filePath: string): Promise<Uint8Array> => {
      reads.push(filePath);
      return Promise.resolve(new TextEncoder().encode(filePath));
    },
  );
  for (const binding of BINDINGS) {
    const bytes = await reader(binding.logicalPath);
    assert.equal(new TextDecoder().decode(bytes), binding.provenancePath);
  }
  for (const filePath of passThroughPaths) {
    const bytes = await reader(filePath);
    assert.equal(new TextDecoder().decode(bytes), filePath);
  }
  assert.deepEqual(reads, [
    ...BINDINGS.map(({ provenancePath }) => provenancePath),
    ...passThroughPaths,
  ]);
});

void test('all retained verifier entries use the provenance reader only after migration', () => {
  const cliBindings = [
    {
      path: 'cli/verify-historical-numerical-profile.ts',
      preBytes: 1_008,
      preSha256: '14615457261e75bbb2d8637f6600477972ca14af7d84eb6b229f62f703085cc8',
    },
    {
      path: 'cli/verify-representative-numerical-profile.ts',
      preBytes: 985,
      preSha256: 'a47c599ec1b2565787a0811ea0e8e76456396aad6f8700c6c430d85f802354ae',
    },
    {
      path: 'cli/verify-representative-numerical-baseline.ts',
      preBytes: 945,
      preSha256: 'ff21ff2130045159a6687a4a2ff73ad15a14706ef707c3ede137ffaa113f7fa3',
    },
  ] as const;
  for (const binding of cliBindings) {
    const absolutePath = path.join(ROOT, binding.path);
    if (!existsSync(READER_PATH)) {
      assertFileIdentity(absolutePath, binding.preBytes, binding.preSha256);
      continue;
    }
    const source = readFileSync(absolutePath, 'utf8');
    assert.equal(
      source.includes("from '../src/verification/retained-reference-source/index.ts'"),
      true,
      binding.path,
    );
    assert.equal(source.includes('createRetainedReferenceSourceReader('), true, binding.path);
  }
});

void test('source-bound retained verifier CLIs reconstruct the exact accepted summaries', {
  timeout: 120_000,
}, () => {
  const commands = [
    {
      cli: 'cli/verify-historical-numerical-profile.ts',
      expected: {
        schemaVersion: 'routelab.numerical-baseline-profile-summary.v1',
        profileId: 'm7b-core12-synthetic-exhaustive-numerical-baseline-profile-v1',
        profileConfigSha256: 'sha256:894aca8f1c402a5677582f18db3d24de40f199141dca284fac75aef945438349',
        eligibleCellCount: 414,
        totalNumericalCalls: 4_554,
        timingSampleCount: 2_070,
        cpuProfileCount: 3,
        semanticWorkSha256: 'sha256:da8aea57ea9c4ded88edc6d9b4a7e703a4a2c4d3d5953a37226e06d36e77396a',
        timingObservationsSha256: 'sha256:84727a7ab98e22eb83a6a55cab4384554f102a4c1ad60d6b5e364765d067346e',
        cpuProfileObservationsSha256: 'sha256:42397d3f425f338f7aac7042e50d48d12cc4fd32c17a41b4c49368106d95e3a9',
        analysisSha256: 'sha256:4c88f87cb4bdc7dee3fddd21d984d55a3424c1549f99a7f6f4205019affc0c58',
        recommendation: 'decline-sound-pruning-selection-from-this-profile',
      },
    },
    {
      cli: 'cli/verify-representative-numerical-baseline.ts',
      expected: {
        caseCount: 4,
        requestCount: 1_584,
        cellCount: 1_584,
        eligibleCounts: {
          'historical-anchor': 396,
          'synthetic-dual-spanning-tree': 174,
          'synthetic-reserve-compressed-1e12': 303,
          'synthetic-reserve-amplified-1e60': 396,
        },
        orderedEligibleCellSha256: 'sha256:48f86261df3e87a2add397e3456f049640fbdfd3e964524201051b452327b5e7',
      },
    },
    {
      cli: 'cli/verify-representative-numerical-profile.ts',
      expected: {
        schemaVersion: 'routelab.numerical-representative-profile-summary.v1',
        profileId: 'm7b-core12-supported-regime-numerical-preacceleration-profile-v1',
        profileConfigSha256: 'sha256:b2ac31c4781471872110bbd2546e8681cee3a3301477db34b3931f06a8648734',
        eligibleCellCount: 1_269,
        totalNumericalCalls: 13_959,
        timingSampleCount: 6_345,
        cpuProfileCount: 12,
        semanticWorkSha256: 'sha256:3d6b060d247c4b24dacef5a0fc150f60e3ecce26f1a0e0b02a3ccd7c87d9971e',
        timingObservationsSha256: 'sha256:ef567cf6bcf90ee36f2d19aa30988fc116b0765d5d87523249074caf478f8a22',
        cpuProfileObservationsSha256: 'sha256:dcc009ef8dede0ac05a5aea55b661abf3302ad1018fa9af0bb2de01446efca40',
        analysisSha256: 'sha256:f31be79d81a61681dff70249fd7dde4f733eb03d8afd538c910949d061b5892b',
        recommendation: 'decline-sound-pruning-selection-from-this-supported-regime-suite',
      },
    },
  ] as const;
  for (const command of commands) {
    const result = spawnSync(process.execPath, [path.join(ROOT, command.cli)], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 120_000,
    });
    assert.equal(result.error, undefined, command.cli);
    assert.equal(result.status, 0, `${command.cli}: ${result.stderr}`);
    assert.equal(result.stderr, '', command.cli);
    assert.equal(result.stdout.endsWith('\n'), true, command.cli);
    assert.deepEqual(JSON.parse(result.stdout) as unknown, command.expected, command.cli);
  }
});
