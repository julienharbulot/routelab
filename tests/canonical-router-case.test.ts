import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CANONICAL_ROUTER_CASE_SCHEMA_VERSION,
  createCanonicalSinglePathRouterCase,
  parseAndVerifyCanonicalSinglePathRouterCase,
  type CanonicalSinglePathRouterCase,
} from '../src/serialization/canonical-router-case/index.ts';

interface FixtureExpectation {
  readonly filename: 'success.json' | 'no-route.json' | 'no-plan.json';
  readonly caseId: string;
  readonly status: 'success' | 'no-route' | 'no-plan';
  readonly bytes: number;
  readonly fileHash: string;
  readonly runHash: string;
  readonly expansions: number;
}

interface MutableCaseRecord {
  schemaVersion: unknown;
  caseId: unknown;
  determinismHash: unknown;
  run: Record<string, unknown>;
  [field: string]: unknown;
}

const FIXTURE_DIRECTORY = new URL('../fixtures/m3/router-cases/', import.meta.url);
const FIXTURES: readonly FixtureExpectation[] = [
  {
    filename: 'success.json',
    caseId: 'm3-success',
    status: 'success',
    bytes: 1_306,
    fileHash: '35f4fde18b840bbaec6862264024ef22ab2c78f303d003635add6cd0a1735e3f',
    runHash: 'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011',
    expansions: 1,
  },
  {
    filename: 'no-route.json',
    caseId: 'm3-no-route',
    status: 'no-route',
    bytes: 1_077,
    fileHash: 'dfb4ebd1e382efcc1961101c55223dd755a39891c3760e500bbf8ab4a3faeb23',
    runHash: 'sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90',
    expansions: 1,
  },
  {
    filename: 'no-plan.json',
    caseId: 'm3-no-plan',
    status: 'no-plan',
    bytes: 927,
    fileHash: '05db31a8660fe3a3b71058f282f86ddd0d6d63bc929a8725a8aecccc96971ac1',
    runHash: 'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4',
    expansions: 0,
  },
];

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
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

async function readFixture(filename: FixtureExpectation['filename']): Promise<{
  readonly bytes: Buffer;
  readonly json: string;
}> {
  const bytes = await readFile(new URL(filename, FIXTURE_DIRECTORY));
  return { bytes, json: bytes.toString('utf8') };
}

function decode(canonicalJson: string): MutableCaseRecord {
  return JSON.parse(canonicalJson) as MutableCaseRecord;
}

function mutate(
  canonicalJson: string,
  change: (record: MutableCaseRecord) => void,
): string {
  const record = decode(canonicalJson);
  change(record);
  return JSON.stringify(record);
}

function assertParseFailure(canonicalJson: string, expected: object): void {
  const result = parseAndVerifyCanonicalSinglePathRouterCase(canonicalJson);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, expected);
  assert.equal('value' in result, false);
  assertDeepFrozen(result);
}

function searchExpansions(value: CanonicalSinglePathRouterCase): number {
  const result = value.run.routerResult;
  return result.status === 'success'
    ? result.plan.search.expansions
    : result.search.expansions;
}

void test('fixed files match bytes, hashes, statuses, counters, and documentation', async () => {
  assert.equal(CANONICAL_ROUTER_CASE_SCHEMA_VERSION, 'routelab.router-case.v1');
  const readme = await readFile(new URL('README.md', FIXTURE_DIRECTORY), 'utf8');

  for (const fixture of FIXTURES) {
    const file = await readFixture(fixture.filename);
    assert.equal(file.bytes.byteLength, fixture.bytes);
    assert.equal(sha256(file.bytes), fixture.fileHash);
    assert.equal(file.bytes[0], 0x7b);
    assert.notEqual(file.bytes[file.bytes.length - 1], 0x0a);
    assert.equal(file.json.includes('\n'), false);
    assert.equal(file.json.includes('\r'), false);
    assert.equal(file.json.includes('elapsed'), false);
    assert.equal(file.json.includes('observation'), false);
    assert.equal(file.json.includes('environment'), false);

    const parsed = parseAndVerifyCanonicalSinglePathRouterCase(file.json);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.value.caseId, fixture.caseId);
    assert.equal(parsed.value.canonicalJson, file.json);
    assert.equal(parsed.value.run.determinismHash, fixture.runHash);
    assert.equal(parsed.value.run.routerResult.status, fixture.status);
    assert.equal(searchExpansions(parsed.value), fixture.expansions);
    assertDeepFrozen(parsed);

    assert.ok(readme.includes(`\`${fixture.filename}\``));
    assert.ok(readme.includes(`\`${fixture.caseId}\``));
    assert.ok(readme.includes(`\`${fixture.fileHash}\``));
    assert.ok(readme.includes(`\`${fixture.runHash}\``));
  }
});

void test('create replay-verifies one inner run and emits the exact canonical wrapper', async () => {
  const file = await readFixture('success.json');
  const record = decode(file.json);
  const innerJson = JSON.stringify(record.run);
  const result = createCanonicalSinglePathRouterCase(
    'm3-success',
    innerJson,
    record.determinismHash as string,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.canonicalJson, file.json);
  assert.equal(result.value.caseId, 'm3-success');
  assert.equal(result.value.run.canonicalJson, innerJson);
  assert.equal(result.value.run.routerResult.status, 'success');
  assertDeepFrozen(result);

  const alternate = createCanonicalSinglePathRouterCase(
    'alternate-case-id',
    innerJson,
    record.determinismHash as string,
  );
  assert.equal(alternate.ok, true);
  if (!alternate.ok) return;
  assert.equal(alternate.value.run.determinismHash, result.value.run.determinismHash);
  assert.notEqual(alternate.value.canonicalJson, result.value.canonicalJson);
});

void test('create validates case ID first and propagates inner reader errors unchanged', async () => {
  const file = await readFixture('success.json');
  const record = decode(file.json);
  const innerJson = JSON.stringify(record.run);

  for (const invalidId of ['', 42 as unknown as string]) {
    const result = createCanonicalSinglePathRouterCase(invalidId, '{', 'wrong');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.error, { code: 'invalid-router-case-id' });
      assertDeepFrozen(result);
    }
  }

  const malformed = createCanonicalSinglePathRouterCase('valid-id', '{', 'wrong');
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.deepEqual(malformed.error, { code: 'invalid-canonical-run-json' });
    assertDeepFrozen(malformed);
  }

  const badHash = createCanonicalSinglePathRouterCase('valid-id', innerJson, 'wrong');
  assert.equal(badHash.ok, false);
  if (!badHash.ok) {
    assert.deepEqual(badHash.error, {
      code: 'canonical-run-hash-mismatch',
      expected: record.determinismHash,
      actual: 'wrong',
    });
    assertDeepFrozen(badHash);
  }
});

void test('parse rejects malformed and strict outer shapes before version or ID', async () => {
  const file = await readFixture('success.json');
  assertParseFailure('{', { code: 'invalid-router-case-json' });

  for (const invalidRoot of [null, [], 'case', 1, true]) {
    assertParseFailure(JSON.stringify(invalidRoot), {
      code: 'invalid-router-case-shape',
      path: '$',
    });
  }

  const cases: readonly {
    readonly path: string;
    readonly change: (record: MutableCaseRecord) => void;
  }[] = [
    {
      path: '$.schemaVersion',
      change: (record) => {
        delete record.schemaVersion;
      },
    },
    {
      path: '$.run',
      change: (record) => {
        delete (record as Record<string, unknown>)['run'];
      },
    },
    {
      path: '$.extra',
      change: (record) => {
        record['extra'] = true;
      },
    },
    {
      path: '$.schemaVersion',
      change: (record) => {
        record.schemaVersion = 1;
      },
    },
    {
      path: '$.caseId',
      change: (record) => {
        record.caseId = 1;
      },
    },
    {
      path: '$.determinismHash',
      change: (record) => {
        record.determinismHash = null;
      },
    },
    {
      path: '$.run',
      change: (record) => {
        record.run = [] as unknown as Record<string, unknown>;
      },
    },
  ];

  for (const current of cases) {
    assertParseFailure(mutate(file.json, current.change), {
      code: 'invalid-router-case-shape',
      path: current.path,
    });
  }
});

void test('parse applies version, case ID, and inner reader precedence', async () => {
  const file = await readFixture('success.json');
  assertParseFailure(
    mutate(file.json, (record) => {
      record.schemaVersion = 'routelab.router-case.v2';
      record.caseId = '';
    }),
    {
      code: 'unsupported-router-case-version',
      actual: 'routelab.router-case.v2',
    },
  );
  assertParseFailure(
    mutate(file.json, (record) => {
      record.caseId = '';
      record.run['result'] = null;
    }),
    { code: 'invalid-router-case-id' },
  );
  assertParseFailure(
    mutate(file.json, (record) => {
      record.run['result'] = null;
    }),
    { code: 'canonical-run-replay-mismatch' },
  );
  assertParseFailure(
    mutate(file.json, (record) => {
      record.determinismHash = 'wrong';
    }),
    {
      code: 'canonical-run-hash-mismatch',
      expected: FIXTURES[0]?.runHash,
      actual: 'wrong',
    },
  );
});

void test('inner snapshot, request, result, and hash mutations are rejected by the reader', async () => {
  const file = await readFixture('success.json');
  const mutations: string[] = [];
  mutations.push(
    mutate(file.json, (record) => {
      const snapshot = record.run['snapshot'] as Record<string, unknown>;
      snapshot['snapshotChecksum'] = 'wrong';
    }),
  );
  mutations.push(
    mutate(file.json, (record) => {
      const request = record.run['request'] as Record<string, unknown>;
      request['amountIn'] = '101';
    }),
  );
  mutations.push(
    mutate(file.json, (record) => {
      const result = record.run['result'] as Record<string, unknown>;
      result['status'] = 'no-route';
    }),
  );

  for (const changed of mutations) {
    const result = parseAndVerifyCanonicalSinglePathRouterCase(changed);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.notEqual(result.error.code, 'router-case-canonical-mismatch');
      assertDeepFrozen(result);
    }
  }
});

void test('exact outer bytes reject whitespace and root ordering after inner authorization', async () => {
  const file = await readFixture('success.json');
  assertParseFailure(`${file.json}\n`, { code: 'router-case-canonical-mismatch' });

  const record = decode(file.json);
  const reordered = JSON.stringify({
    caseId: record.caseId,
    schemaVersion: record.schemaVersion,
    determinismHash: record.determinismHash,
    run: record.run,
  });
  assertParseFailure(reordered, { code: 'router-case-canonical-mismatch' });
});

void test('repeated fixture parses return equal fresh deeply frozen values', async () => {
  const file = await readFixture('no-plan.json');
  const first = parseAndVerifyCanonicalSinglePathRouterCase(file.json);
  const second = parseAndVerifyCanonicalSinglePathRouterCase(file.json);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value, second.value);
  assert.notEqual(first.value, second.value);
  assert.notEqual(first.value.run, second.value.run);
  assertDeepFrozen(first);
  assertDeepFrozen(second);
});
