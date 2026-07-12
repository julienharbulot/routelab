import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createCanonicalSinglePathRouterCase,
  parseAndVerifyCanonicalSinglePathRouterCase,
  type CanonicalSinglePathRouterCase,
} from '../../src/serialization/canonical-router-case/index.ts';

const SUCCESS_RUN =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"success","plan":{"receipt":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","amountOut":"90","hops":[{"poolId":"direct-ab","assetIn":"A","assetOut":"B","amountIn":"100","amountOut":"90","reserveInBefore":"1000","reserveOutBefore":"1000","reserveInAfter":"1100","reserveOutAfter":"910"}]},"search":{"expansions":1,"enumeratedCandidates":1,"replayedCandidates":1,"rejectedCandidates":0,"termination":"complete"}}}}';
const SUCCESS_RUN_HASH =
  'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011';
const SUCCESS_CASE =
  `{"schemaVersion":"routelab.router-case.v1","caseId":"m3-success","determinismHash":"${SUCCESS_RUN_HASH}","run":${SUCCESS_RUN}}`;

const NO_ROUTE_RUN =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"component-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"},{"poolId":"component-cd","asset0":"C","reserve0":"1000","asset1":"D","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"}]}},"request":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","assetIn":"A","assetOut":"D","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"no-route","reason":"no-candidate","search":{"expansions":1,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"complete"}}}';
const NO_ROUTE_RUN_HASH =
  'sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90';
const NO_ROUTE_CASE =
  `{"schemaVersion":"routelab.router-case.v1","caseId":"m3-no-route","determinismHash":"${NO_ROUTE_RUN_HASH}","run":${NO_ROUTE_RUN}}`;

const NO_PLAN_RUN =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":0},"result":{"status":"no-plan","reason":"work-limit","search":{"expansions":0,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"work-limit"}}}';
const NO_PLAN_RUN_HASH =
  'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4';
const NO_PLAN_CASE =
  `{"schemaVersion":"routelab.router-case.v1","caseId":"m3-no-plan","determinismHash":"${NO_PLAN_RUN_HASH}","run":${NO_PLAN_RUN}}`;

type JsonObject = Record<string, unknown>;
type ParseResult = ReturnType<typeof parseAndVerifyCanonicalSinglePathRouterCase>;
type ParseFailure = Extract<ParseResult, { readonly ok: false }>;
type CreateResult = ReturnType<typeof createCanonicalSinglePathRouterCase>;
type CreateFailure = Extract<CreateResult, { readonly ok: false }>;

interface FixtureVector {
  readonly filename: 'success.json' | 'no-route.json' | 'no-plan.json';
  readonly caseId: string;
  readonly canonicalJson: string;
  readonly runJson: string;
  readonly runHash: string;
  readonly bytes: number;
  readonly fileHash: string;
  readonly status: 'success' | 'no-route' | 'no-plan';
  readonly search: {
    readonly expansions: number;
    readonly enumeratedCandidates: number;
    readonly replayedCandidates: number;
    readonly rejectedCandidates: number;
    readonly termination: 'complete' | 'work-limit';
  };
}

const FIXTURE_DIRECTORY = new URL('../../fixtures/m3/router-cases/', import.meta.url);
const FIXTURES: readonly FixtureVector[] = [
  {
    filename: 'success.json',
    caseId: 'm3-success',
    canonicalJson: SUCCESS_CASE,
    runJson: SUCCESS_RUN,
    runHash: SUCCESS_RUN_HASH,
    bytes: 1306,
    fileHash: '35f4fde18b840bbaec6862264024ef22ab2c78f303d003635add6cd0a1735e3f',
    status: 'success',
    search: {
      expansions: 1,
      enumeratedCandidates: 1,
      replayedCandidates: 1,
      rejectedCandidates: 0,
      termination: 'complete',
    },
  },
  {
    filename: 'no-route.json',
    caseId: 'm3-no-route',
    canonicalJson: NO_ROUTE_CASE,
    runJson: NO_ROUTE_RUN,
    runHash: NO_ROUTE_RUN_HASH,
    bytes: 1077,
    fileHash: 'dfb4ebd1e382efcc1961101c55223dd755a39891c3760e500bbf8ab4a3faeb23',
    status: 'no-route',
    search: {
      expansions: 1,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'complete',
    },
  },
  {
    filename: 'no-plan.json',
    caseId: 'm3-no-plan',
    canonicalJson: NO_PLAN_CASE,
    runJson: NO_PLAN_RUN,
    runHash: NO_PLAN_RUN_HASH,
    bytes: 927,
    fileHash: '05db31a8660fe3a3b71058f282f86ddd0d6d63bc929a8725a8aecccc96971ac1',
    status: 'no-plan',
    search: {
      expansions: 0,
      enumeratedCandidates: 0,
      replayedCandidates: 0,
      rejectedCandidates: 0,
      termination: 'work-limit',
    },
  },
];

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('oracle fixture member must be an object');
  }
  return value as JsonObject;
}

function decode(value: string): JsonObject {
  return asObject(JSON.parse(value) as unknown);
}

function mutate(value: string, change: (record: JsonObject) => void): string {
  const record = decode(value);
  change(record);
  return JSON.stringify(record);
}

function runObject(record: JsonObject): JsonObject {
  return asObject(record['run']);
}

function innerSnapshot(record: JsonObject): JsonObject {
  return asObject(runObject(record)['snapshot']);
}

function innerRequest(record: JsonObject): JsonObject {
  return asObject(runObject(record)['request']);
}

function innerResult(record: JsonObject): JsonObject {
  return asObject(runObject(record)['result']);
}

function parseFailure(value: string): ParseFailure {
  const parsed = parseAndVerifyCanonicalSinglePathRouterCase(value);
  if (parsed.ok) assert.fail('mutated case unexpectedly passed verification');
  assert.equal('value' in parsed, false);
  assertDeepFrozen(parsed);
  return parsed;
}

function createFailure(
  caseId: string,
  runJson: string,
  determinismHash: string,
): CreateFailure {
  const created = createCanonicalSinglePathRouterCase(caseId, runJson, determinismHash);
  if (created.ok) assert.fail('invalid case inputs unexpectedly created a case');
  assert.equal('value' in created, false);
  assertDeepFrozen(created);
  return created;
}

function assertParseError(value: string, expected: Readonly<Record<string, unknown>>): void {
  assert.deepEqual(parseFailure(value).error, expected);
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

function searchSummary(value: CanonicalSinglePathRouterCase) {
  const routerResult = value.run.routerResult;
  return routerResult.status === 'success'
    ? routerResult.plan.search
    : routerResult.search;
}

void test('fixture bytes exactly match independent wrappers, external hashes, and all counters', async () => {
  const readme = await readFile(new URL('README.md', FIXTURE_DIRECTORY), 'utf8');
  for (const fixture of FIXTURES) {
    const bytes = await readFile(new URL(fixture.filename, FIXTURE_DIRECTORY));
    const fileJson = bytes.toString('utf8');
    assert.equal(fileJson, fixture.canonicalJson);
    assert.equal(bytes.byteLength, fixture.bytes);
    assert.equal(Buffer.byteLength(fixture.canonicalJson, 'utf8'), fixture.bytes);
    assert.equal(sha256(bytes), fixture.fileHash);
    assert.equal(bytes[0], 0x7b);
    assert.equal(bytes[1], 0x22);
    assert.equal(bytes[bytes.length - 1], 0x7d);
    assert.equal(fileJson.includes('\n'), false);
    assert.equal(fileJson.includes('\r'), false);
    assert.equal(fileJson.charCodeAt(0), 0x7b);

    for (const excluded of [
      'elapsed',
      'observation',
      'environment',
      'timestamp',
      'timing',
      'benchmarkResult',
    ]) {
      assert.equal(fileJson.includes(excluded), false);
    }

    const parsed = parseAndVerifyCanonicalSinglePathRouterCase(fileJson);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.value.caseId, fixture.caseId);
    assert.equal(parsed.value.canonicalJson, fixture.canonicalJson);
    assert.equal(parsed.value.run.canonicalJson, fixture.runJson);
    assert.equal(parsed.value.run.determinismHash, fixture.runHash);
    assert.equal(parsed.value.run.routerResult.status, fixture.status);
    assert.deepEqual(searchSummary(parsed.value), fixture.search);
    if (parsed.value.run.routerResult.status === 'success') {
      assert.equal(parsed.value.run.routerResult.plan.receipt.amountOut, 90n);
    } else if (parsed.value.run.routerResult.status === 'no-route') {
      assert.equal(parsed.value.run.routerResult.reason, 'no-candidate');
    } else {
      assert.equal(parsed.value.run.routerResult.reason, 'work-limit');
    }
    assertDeepFrozen(parsed);

    assert.ok(readme.includes(`\`${fixture.filename}\``));
    assert.ok(readme.includes(`\`${fixture.caseId}\``));
    assert.ok(readme.includes(`\`${fixture.bytes}\``) || readme.includes(` ${fixture.bytes} `));
    assert.ok(readme.includes(`\`${fixture.fileHash}\``));
    assert.ok(readme.includes(`\`${fixture.runHash}\``));
  }
});

void test('create replay-verifies fixed inner vectors and emits exact canonical wrappers', () => {
  for (const fixture of FIXTURES) {
    const created = createCanonicalSinglePathRouterCase(
      fixture.caseId,
      fixture.runJson,
      fixture.runHash,
    );
    assert.equal(created.ok, true);
    if (!created.ok) continue;
    assert.equal(created.value.caseId, fixture.caseId);
    assert.equal(created.value.canonicalJson, fixture.canonicalJson);
    assert.equal(created.value.run.canonicalJson, fixture.runJson);
    assert.equal(created.value.run.determinismHash, fixture.runHash);
    assert.deepEqual(searchSummary(created.value), fixture.search);
    assertDeepFrozen(created);
  }

  const alternate = createCanonicalSinglePathRouterCase(
    'opaque/Case-\u03a9',
    SUCCESS_RUN,
    SUCCESS_RUN_HASH,
  );
  assert.equal(alternate.ok, true);
  if (alternate.ok) {
    assert.equal(alternate.value.caseId, 'opaque/Case-\u03a9');
    assert.equal(alternate.value.run.determinismHash, SUCCESS_RUN_HASH);
    assert.equal(alternate.value.canonicalJson.includes('opaque/Case-\u03a9'), true);
    assertDeepFrozen(alternate);
  }
});

void test('parse returns fresh equal frozen cases without changing primitive inputs', () => {
  const input = NO_PLAN_CASE;
  const first = parseAndVerifyCanonicalSinglePathRouterCase(input);
  const second = parseAndVerifyCanonicalSinglePathRouterCase(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(input, NO_PLAN_CASE);
  assert.deepEqual(first.value, second.value);
  assert.notEqual(first.value, second.value);
  assert.notEqual(first.value.run, second.value.run);
  assert.notEqual(first.value.run.routerResult, second.value.run.routerResult);
  assertDeepFrozen(first);
  assertDeepFrozen(second);

  const renamed = mutate(SUCCESS_CASE, (record) => {
    record['caseId'] = 'm3-success-renamed';
  });
  const renamedResult = parseAndVerifyCanonicalSinglePathRouterCase(renamed);
  assert.equal(renamedResult.ok, true);
  if (renamedResult.ok) {
    assert.equal(renamedResult.value.caseId, 'm3-success-renamed');
    assert.equal(renamedResult.value.run.determinismHash, SUCCESS_RUN_HASH);
    assert.equal(renamedResult.value.canonicalJson, renamed);
  }
});

void test('create validates case ID before propagating exact inner reader errors', () => {
  for (const invalidId of ['', 42 as unknown as string]) {
    assert.deepEqual(createFailure(invalidId, '{', 'wrong').error, {
      code: 'invalid-router-case-id',
    });
  }

  assert.deepEqual(createFailure('valid-case', '{', 'wrong').error, {
    code: 'invalid-canonical-run-json',
  });
  assert.deepEqual(createFailure('valid-case', SUCCESS_RUN, 'wrong').error, {
    code: 'canonical-run-hash-mismatch',
    expected: SUCCESS_RUN_HASH,
    actual: 'wrong',
  });
  assert.deepEqual(
    createFailure(
      'valid-case',
      mutate(SUCCESS_RUN, (record) => { record['result'] = null; }),
      SUCCESS_RUN_HASH,
    ).error,
    { code: 'canonical-run-replay-mismatch' },
  );
});

void test('parse applies JSON, exact shape, version, ID, inner, and outer precedence', () => {
  assertParseError('{', { code: 'invalid-router-case-json' });
  assertParseError(`\ufeff${SUCCESS_CASE}`, { code: 'invalid-router-case-json' });
  for (const value of [null, [], 'case', 1, true]) {
    assertParseError(JSON.stringify(value), {
      code: 'invalid-router-case-shape',
      path: '$',
    });
  }

  const shapeCases: readonly [string, (record: JsonObject) => void][] = [
    ['$.schemaVersion', (record) => { delete record['schemaVersion']; }],
    ['$.caseId', (record) => { delete record['caseId']; }],
    ['$.determinismHash', (record) => { delete record['determinismHash']; }],
    ['$.run', (record) => { delete record['run']; }],
    ['$.extra', (record) => { record['extra'] = true; }],
    ['$.schemaVersion', (record) => { record['schemaVersion'] = 1; }],
    ['$.caseId', (record) => { record['caseId'] = 1; }],
    ['$.determinismHash', (record) => { record['determinismHash'] = null; }],
    ['$.run', (record) => { record['run'] = []; }],
  ];
  for (const [path, change] of shapeCases) {
    assertParseError(mutate(SUCCESS_CASE, change), {
      code: 'invalid-router-case-shape',
      path,
    });
  }

  const missingBeforeExtra = mutate(SUCCESS_CASE, (record) => {
    delete record['caseId'];
    record['aaa'] = true;
  });
  assertParseError(missingBeforeExtra, {
    code: 'invalid-router-case-shape',
    path: '$.caseId',
  });

  const versionBeforeId = mutate(SUCCESS_CASE, (record) => {
    record['schemaVersion'] = 'routelab.router-case.v2';
    record['caseId'] = '';
  });
  assertParseError(versionBeforeId, {
    code: 'unsupported-router-case-version',
    actual: 'routelab.router-case.v2',
  });

  const idBeforeInner = mutate(SUCCESS_CASE, (record) => {
    record['caseId'] = '';
    runObject(record)['result'] = null;
  });
  assertParseError(idBeforeInner, { code: 'invalid-router-case-id' });

  const innerBeforeOuter = mutate(SUCCESS_CASE, (record) => {
    runObject(record)['result'] = null;
  });
  assertParseError(innerBeforeOuter, { code: 'canonical-run-replay-mismatch' });

  assertParseError(`${SUCCESS_CASE}\n`, { code: 'router-case-canonical-mismatch' });
});

void test('inner snapshot, request, result, counter, and hash mutations never self-authorize', () => {
  const wrongChecksum = mutate(SUCCESS_CASE, (record) => {
    innerSnapshot(record)['snapshotChecksum'] = 'wrong';
  });
  assertParseError(wrongChecksum, {
    code: 'snapshot-checksum-mismatch',
    expected: 'sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3',
    actual: 'wrong',
  });

  const requestShape = mutate(SUCCESS_CASE, (record) => {
    innerRequest(record)['amountIn'] = '01';
  });
  assertParseError(requestShape, {
    code: 'invalid-canonical-run-request-shape',
    path: '$.request.amountIn',
  });

  const staleRequest = mutate(SUCCESS_CASE, (record) => {
    innerRequest(record)['amountIn'] = '101';
  });
  assertParseError(staleRequest, { code: 'canonical-run-replay-mismatch' });

  const resultMutations: readonly ((record: JsonObject) => void)[] = [
    (record) => { innerResult(record)['status'] = 'no-route'; },
    (record) => {
      const plan = asObject(innerResult(record)['plan']);
      asObject(plan['receipt'])['amountOut'] = '999';
    },
    (record) => {
      const plan = asObject(innerResult(record)['plan']);
      asObject(plan['search'])['expansions'] = 2;
    },
    (record) => { innerResult(record)['observation'] = { elapsedMs: 1 }; },
  ];
  for (const change of resultMutations) {
    assertParseError(mutate(SUCCESS_CASE, change), {
      code: 'canonical-run-replay-mismatch',
    });
  }

  const wrongHash = mutate(SUCCESS_CASE, (record) => {
    record['determinismHash'] = 'wrong';
  });
  assertParseError(wrongHash, {
    code: 'canonical-run-hash-mismatch',
    expected: SUCCESS_RUN_HASH,
    actual: 'wrong',
  });

  const resultBeforeHash = mutate(SUCCESS_CASE, (record) => {
    record['determinismHash'] = 'wrong';
    innerResult(record)['status'] = 'no-route';
  });
  assertParseError(resultBeforeHash, { code: 'canonical-run-replay-mismatch' });
});

void test('outer aliases, ordering, whitespace, and inner ordering fail at exact boundaries', () => {
  const outerAlias = mutate(SUCCESS_CASE, (record) => {
    record['elapsedMs'] = 1;
  });
  assertParseError(outerAlias, {
    code: 'invalid-router-case-shape',
    path: '$.elapsedMs',
  });

  const parsed = decode(SUCCESS_CASE);
  const reorderedOuter = JSON.stringify({
    caseId: parsed['caseId'],
    schemaVersion: parsed['schemaVersion'],
    determinismHash: parsed['determinismHash'],
    run: parsed['run'],
  });
  assertParseError(reorderedOuter, { code: 'router-case-canonical-mismatch' });
  assertParseError(JSON.stringify(parsed, null, 2), {
    code: 'router-case-canonical-mismatch',
  });
  assertParseError(` ${SUCCESS_CASE}`, { code: 'router-case-canonical-mismatch' });

  const inner = runObject(parsed);
  const reorderedRun = {
    snapshot: inner['snapshot'],
    schemaVersion: inner['schemaVersion'],
    request: inner['request'],
    result: inner['result'],
  };
  const innerReorderedCase = JSON.stringify({
    schemaVersion: parsed['schemaVersion'],
    caseId: parsed['caseId'],
    determinismHash: parsed['determinismHash'],
    run: reorderedRun,
  });
  assertParseError(innerReorderedCase, { code: 'canonical-run-replay-mismatch' });

  const innerAlias = mutate(SUCCESS_CASE, (record) => {
    runObject(record)['environment'] = 'ignored';
  });
  assertParseError(innerAlias, {
    code: 'invalid-canonical-run-shape',
    path: '$.environment',
  });
});
