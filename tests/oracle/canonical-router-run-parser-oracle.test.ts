import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { parseAndVerifyCanonicalSinglePathRouterRun } from '../../src/serialization/canonical-router-run/index.ts';

const SUCCESS_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"success","plan":{"receipt":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","amountOut":"90","hops":[{"poolId":"direct-ab","assetIn":"A","assetOut":"B","amountIn":"100","amountOut":"90","reserveInBefore":"1000","reserveOutBefore":"1000","reserveInAfter":"1100","reserveOutAfter":"910"}]},"search":{"expansions":1,"enumeratedCandidates":1,"replayedCandidates":1,"rejectedCandidates":0,"termination":"complete"}}}}';
const SUCCESS_HASH =
  'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011';

const NO_PLAN_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":0},"result":{"status":"no-plan","reason":"work-limit","search":{"expansions":0,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"work-limit"}}}';
const NO_PLAN_HASH =
  'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4';

const NO_ROUTE_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"component-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"},{"poolId":"component-cd","asset0":"C","reserve0":"1000","asset1":"D","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"}]}},"request":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","assetIn":"A","assetOut":"D","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"no-route","reason":"no-candidate","search":{"expansions":1,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"complete"}}}';
const NO_ROUTE_HASH =
  'sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90';

const HUGE_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-huge","snapshotChecksum":"sha256:532f062d1ec1aeb942649a1327fae244b96555a34fe74e79f5b554b45d879465","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"huge-ab","asset0":"A","reserve0":"1000000000000000000000000000000","asset1":"B","reserve1":"1000000000000000000000000000000","feeChargedNumerator":"0","feeDenominator":"1"}]}},"request":{"snapshotId":"snapshot-huge","snapshotChecksum":"sha256:532f062d1ec1aeb942649a1327fae244b96555a34fe74e79f5b554b45d879465","assetIn":"A","assetOut":"B","amountIn":"9007199254740993","maxHops":1,"maxExpansions":10},"result":{"status":"success","plan":{"receipt":{"snapshotId":"snapshot-huge","snapshotChecksum":"sha256:532f062d1ec1aeb942649a1327fae244b96555a34fe74e79f5b554b45d879465","assetIn":"A","assetOut":"B","amountIn":"9007199254740993","amountOut":"9007199254740911","hops":[{"poolId":"huge-ab","assetIn":"A","assetOut":"B","amountIn":"9007199254740993","amountOut":"9007199254740911","reserveInBefore":"1000000000000000000000000000000","reserveOutBefore":"1000000000000000000000000000000","reserveInAfter":"1000000000000009007199254740993","reserveOutAfter":"999999999999990992800745259089"}]},"search":{"expansions":1,"enumeratedCandidates":1,"replayedCandidates":1,"rejectedCandidates":0,"termination":"complete"}}}}';
const HUGE_HASH =
  'sha256:14b72b2090b3df8fb8f42a2039e8ef75e45003d18cf71e3acf3538afe7a041b1';

type ParseResult = ReturnType<typeof parseAndVerifyCanonicalSinglePathRouterRun>;
type ParseFailure = Extract<ParseResult, { readonly ok: false }>;
type JsonObject = Record<string, unknown>;

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('oracle fixture member must be an object');
  }
  return value as JsonObject;
}

function parseRecord(value: string): JsonObject {
  return asObject(JSON.parse(value) as unknown);
}

function snapshot(record: JsonObject): JsonObject {
  return asObject(record['snapshot']);
}

function content(record: JsonObject): JsonObject {
  return asObject(snapshot(record)['content']);
}

function request(record: JsonObject): JsonObject {
  return asObject(record['request']);
}

function result(record: JsonObject): JsonObject {
  return asObject(record['result']);
}

function mutate(base: string, change: (record: JsonObject) => void): string {
  const record = parseRecord(base);
  change(record);
  return JSON.stringify(record);
}

function failure(canonicalJson: string, determinismHash = SUCCESS_HASH): ParseFailure {
  const parsed = parseAndVerifyCanonicalSinglePathRouterRun(canonicalJson, determinismHash);
  if (parsed.ok) assert.fail('untrusted mutation unexpectedly produced an accepted run');
  assert.deepEqual(Object.keys(parsed), ['ok', 'error']);
  assert.equal('value' in parsed, false);
  assertDeepFrozen(parsed);
  return parsed;
}

function assertError(
  canonicalJson: string,
  determinismHash: string,
  expected: Readonly<Record<string, unknown>>,
): void {
  assert.deepEqual(failure(canonicalJson, determinismHash).error, expected);
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

void test('round-trips independent success, no-route, no-plan, and huge exact vectors', () => {
  const vectors = [
    { json: SUCCESS_JSON, hash: SUCCESS_HASH, bytes: 1142, status: 'success' },
    { json: NO_ROUTE_JSON, hash: NO_ROUTE_HASH, bytes: 912, status: 'no-route' },
    { json: NO_PLAN_JSON, hash: NO_PLAN_HASH, bytes: 763, status: 'no-plan' },
    { json: HUGE_JSON, hash: HUGE_HASH, bytes: 1358, status: 'success' },
  ] as const;

  for (const vector of vectors) {
    assert.equal(Buffer.byteLength(vector.json, 'utf8'), vector.bytes);
    assert.equal(sha256(vector.json), vector.hash);
    const first = parseAndVerifyCanonicalSinglePathRouterRun(vector.json, vector.hash);
    const second = parseAndVerifyCanonicalSinglePathRouterRun(vector.json, vector.hash);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) continue;
    assert.equal(first.value.canonicalJson, vector.json);
    assert.equal(first.value.determinismHash, vector.hash);
    assert.equal(first.value.routerResult.status, vector.status);
    assert.deepEqual(second.value, first.value);
    assert.notEqual(second.value, first.value);
    assertDeepFrozen(first);
    assertDeepFrozen(second);
  }

  const huge = parseAndVerifyCanonicalSinglePathRouterRun(HUGE_JSON, HUGE_HASH);
  assert.equal(huge.ok, true);
  if (!huge.ok || huge.value.routerResult.status !== 'success') return;
  const receipt = huge.value.routerResult.plan.receipt;
  assert.equal(receipt.amountIn, 9_007_199_254_740_993n);
  assert.equal(receipt.amountOut, 9_007_199_254_740_911n);
  assert.equal(receipt.hops[0]?.reserveInBefore, 10n ** 30n);
  assert.equal(receipt.hops[0]?.reserveInAfter, 1_000_000_000_000_009_007_199_254_740_993n);
  assert.equal(receipt.hops[0]?.reserveOutAfter, 999_999_999_999_990_992_800_745_259_089n);
});

void test('rejects malformed JSON and strict reconstructable shapes in frozen precedence', () => {
  assertError('{', SUCCESS_HASH, { code: 'invalid-canonical-run-json' });
  for (const value of [null, [], 'run', 1, true]) {
    assertError(JSON.stringify(value), SUCCESS_HASH, {
      code: 'invalid-canonical-run-shape',
      path: '$',
    });
  }

  const cases: readonly [string, string, (record: JsonObject) => void][] = [
    ['missing root version', '$.schemaVersion', (record) => delete record['schemaVersion']],
    ['missing root result', '$.result', (record) => delete record['result']],
    ['extra root field', '$.extra', (record) => { record['extra'] = true; }],
    ['root version type', '$.schemaVersion', (record) => { record['schemaVersion'] = 1; }],
    ['snapshot container', '$.snapshot', (record) => { record['snapshot'] = []; }],
    [
      'missing snapshot id',
      '$.snapshot.snapshotId',
      (record) => delete snapshot(record)['snapshotId'],
    ],
    [
      'snapshot checksum type',
      '$.snapshot.snapshotChecksum',
      (record) => { snapshot(record)['snapshotChecksum'] = 1; },
    ],
    [
      'extra snapshot field',
      '$.snapshot.extra',
      (record) => { snapshot(record)['extra'] = true; },
    ],
    [
      'content container',
      '$.snapshot.content',
      (record) => { snapshot(record)['content'] = null; },
    ],
    [
      'missing content version',
      '$.snapshot.content.schemaVersion',
      (record) => delete content(record)['schemaVersion'],
    ],
    [
      'pool collection type',
      '$.snapshot.content.pools',
      (record) => { content(record)['pools'] = {}; },
    ],
    [
      'extra content field',
      '$.snapshot.content.extra',
      (record) => { content(record)['extra'] = true; },
    ],
    ['request container', '$.request', (record) => { record['request'] = []; }],
    [
      'missing request asset',
      '$.request.assetOut',
      (record) => delete request(record)['assetOut'],
    ],
    [
      'extra request field',
      '$.request.extra',
      (record) => { request(record)['extra'] = true; },
    ],
  ];

  for (const [label, path, change] of cases) {
    const parsed = failure(mutate(SUCCESS_JSON, change));
    assert.deepEqual(parsed.error, { code: 'invalid-canonical-run-shape', path }, label);
  }

  const wrongHashType = parseAndVerifyCanonicalSinglePathRouterRun(
    SUCCESS_JSON,
    42 as unknown as string,
  );
  assert.equal(wrongHashType.ok, false);
  if (wrongHashType.ok) return;
  assert.deepEqual(wrongHashType.error, {
    code: 'invalid-canonical-run-shape',
    path: '$.determinismHash',
  });
  assertDeepFrozen(wrongHashType);

  const missingAndExtra = mutate(SUCCESS_JSON, (record) => {
    delete record['snapshot'];
    record['aaa'] = true;
  });
  assertError(missingAndExtra, SUCCESS_HASH, {
    code: 'invalid-canonical-run-shape',
    path: '$.snapshot',
  });
});

void test('applies version, snapshot, and request-shape taxonomy in deterministic order', () => {
  assertError(
    mutate(SUCCESS_JSON, (record) => { record['schemaVersion'] = 'routelab.router-run.v2'; }),
    SUCCESS_HASH,
    { code: 'unsupported-canonical-run-version', actual: 'routelab.router-run.v2' },
  );
  assertError(
    mutate(SUCCESS_JSON, (record) => {
      content(record)['schemaVersion'] = 'routelab.snapshot.v2';
    }),
    SUCCESS_HASH,
    { code: 'unsupported-canonical-snapshot-version', actual: 'routelab.snapshot.v2' },
  );

  const invalidSnapshot = mutate(SUCCESS_JSON, (record) => {
    const pools = content(record)['pools'] as unknown[];
    asObject(pools[0])['reserve0'] = '0';
    request(record)['amountIn'] = 0;
  });
  const snapshotFailure = failure(invalidSnapshot);
  assert.equal(snapshotFailure.error.code, 'invalid-canonical-run-snapshot');
  if (snapshotFailure.error.code !== 'invalid-canonical-run-snapshot') return;
  assert.deepEqual(
    snapshotFailure.error.errors.map(({ code, path }) => ({ code, path })),
    [{ code: 'nonpositive-reserve', path: '$.pools[0].reserve0' }],
  );
  assertDeepFrozen(snapshotFailure.error.errors);

  const poolExtra = mutate(SUCCESS_JSON, (record) => {
    const pools = content(record)['pools'] as unknown[];
    asObject(pools[0])['observation'] = 1;
  });
  const extraFailure = failure(poolExtra);
  assert.equal(extraFailure.error.code, 'invalid-canonical-run-snapshot');
  if (extraFailure.error.code === 'invalid-canonical-run-snapshot') {
    assert.deepEqual(
      extraFailure.error.errors.map(({ code, path }) => ({ code, path })),
      [{ code: 'unknown-field', path: '$.pools[0].observation' }],
    );
  }

  const requestShapeCases: readonly [string, unknown][] = [
    ['snapshotId', 1],
    ['snapshotChecksum', null],
    ['assetIn', false],
    ['assetOut', []],
    ['amountIn', 100],
    ['amountIn', ''],
    ['amountIn', '0'],
    ['amountIn', '01'],
    ['amountIn', '+1'],
    ['amountIn', '-1'],
    ['amountIn', '1.0'],
    ['amountIn', '1e2'],
    ['amountIn', ' 1'],
    ['maxHops', 0],
    ['maxHops', -1],
    ['maxHops', 1.5],
    ['maxHops', Number.MAX_SAFE_INTEGER + 1],
    ['maxExpansions', -1],
    ['maxExpansions', 1.5],
    ['maxExpansions', Number.MAX_SAFE_INTEGER + 1],
  ];
  for (const [field, value] of requestShapeCases) {
    assertError(
      mutate(SUCCESS_JSON, (record) => { request(record)[field] = value; }),
      SUCCESS_HASH,
      { code: 'invalid-canonical-run-request-shape', path: `$.request.${field}` },
    );
  }
});

void test('preserves reader and writer error precedence and lower-layer error polarity', () => {
  const wrongChecksum = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const shapeBeforeChecksum = mutate(SUCCESS_JSON, (record) => {
    snapshot(record)['snapshotChecksum'] = wrongChecksum;
    request(record)['amountIn'] = '01';
  });
  assertError(shapeBeforeChecksum, SUCCESS_HASH, {
    code: 'invalid-canonical-run-request-shape',
    path: '$.request.amountIn',
  });

  const checksumBeforeRouter = mutate(SUCCESS_JSON, (record) => {
    snapshot(record)['snapshotChecksum'] = wrongChecksum;
    request(record)['assetIn'] = '';
  });
  assertError(checksumBeforeRouter, SUCCESS_HASH, {
    code: 'snapshot-checksum-mismatch',
    expected: 'sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3',
    actual: wrongChecksum,
  });

  const requestIdentityMismatch = mutate(SUCCESS_JSON, (record) => {
    request(record)['snapshotId'] = 'different-snapshot';
  });
  const identityFailure = failure(requestIdentityMismatch);
  assert.equal(identityFailure.error.code, 'invalid-router-request');
  if (identityFailure.error.code === 'invalid-router-request') {
    assert.deepEqual(
      {
        code: identityFailure.error.routerError.code,
        field: identityFailure.error.routerError.field,
      },
      { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
    );
    assertDeepFrozen(identityFailure.error.routerError);
  }

  const sameAsset = mutate(SUCCESS_JSON, (record) => {
    request(record)['assetOut'] = 'A';
  });
  const sameAssetFailure = failure(sameAsset);
  assert.equal(sameAssetFailure.error.code, 'invalid-router-request');
  if (sameAssetFailure.error.code === 'invalid-router-request') {
    assert.deepEqual(
      {
        code: sameAssetFailure.error.routerError.code,
        field: sameAssetFailure.error.routerError.field,
      },
      { code: 'same-asset-request', field: 'assetOut' },
    );
  }
});

void test('never authorizes supplied result, receipt, reason, hop, or counters', () => {
  const mutations: readonly ((record: JsonObject) => void)[] = [
    (record) => { record['result'] = null; },
    (record) => { result(record)['status'] = 'no-route'; },
    (record) => {
      const plan = asObject(result(record)['plan']);
      asObject(plan['receipt'])['amountOut'] = '999999';
    },
    (record) => {
      const plan = asObject(result(record)['plan']);
      const hops = asObject(plan['receipt'])['hops'] as unknown[];
      asObject(hops[0])['reserveOutAfter'] = '1';
    },
    (record) => {
      const plan = asObject(result(record)['plan']);
      asObject(plan['search'])['expansions'] = 2;
    },
    (record) => {
      const plan = asObject(result(record)['plan']);
      asObject(plan['search'])['termination'] = 'work-limit';
    },
    (record) => { result(record)['extra'] = { elapsedMs: 1 }; },
    (record) => {
      request(record)['amountIn'] = '101';
      const plan = asObject(result(record)['plan']);
      const receipt = asObject(plan['receipt']);
      receipt['amountIn'] = '101';
      receipt['amountOut'] = '999999';
      const hops = receipt['hops'] as unknown[];
      asObject(hops[0])['amountIn'] = '101';
      asObject(hops[0])['amountOut'] = '999999';
    },
  ];

  for (const change of mutations) {
    const forged = mutate(SUCCESS_JSON, change);
    assertError(forged, sha256(forged), { code: 'canonical-run-replay-mismatch' });
  }

  const noRouteReason = mutate(NO_ROUTE_JSON, (record) => {
    result(record)['reason'] = 'all-candidates-rejected';
  });
  assertError(noRouteReason, sha256(noRouteReason), {
    code: 'canonical-run-replay-mismatch',
  });

  const noPlanCounter = mutate(NO_PLAN_JSON, (record) => {
    asObject(result(record)['search'])['replayedCandidates'] = 1;
  });
  assertError(noPlanCounter, sha256(noPlanCounter), {
    code: 'canonical-run-replay-mismatch',
  });
});

void test('freshly verifies semantic changes and rejects stale inputs, ordering, and whitespace', () => {
  const renamedSnapshot = mutate(SUCCESS_JSON, (record) => {
    snapshot(record)['snapshotId'] = 'snapshot-renamed';
  });
  const renamedFailure = failure(renamedSnapshot, sha256(renamedSnapshot));
  assert.equal(renamedFailure.error.code, 'invalid-router-request');
  if (renamedFailure.error.code === 'invalid-router-request') {
    assert.deepEqual(
      {
        code: renamedFailure.error.routerError.code,
        field: renamedFailure.error.routerError.field,
      },
      { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
    );
  }

  const staleAmount = mutate(SUCCESS_JSON, (record) => {
    request(record)['amountIn'] = '101';
  });
  assertError(staleAmount, sha256(staleAmount), {
    code: 'canonical-run-replay-mismatch',
  });

  const changedContent = mutate(SUCCESS_JSON, (record) => {
    const pools = content(record)['pools'] as unknown[];
    asObject(pools[0])['reserve0'] = '1001';
  });
  assertError(changedContent, sha256(changedContent), {
    code: 'snapshot-checksum-mismatch',
    expected: 'sha256:74f8b7313b6fc275b01798e9868176b7ac6ebc0348fbb0546fbcd50d96da789b',
    actual: 'sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3',
  });

  const selfConsistentLimit = mutate(SUCCESS_JSON, (record) => {
    request(record)['maxExpansions'] = 11;
  });
  const acceptedLimit = parseAndVerifyCanonicalSinglePathRouterRun(
    selfConsistentLimit,
    sha256(selfConsistentLimit),
  );
  assert.equal(acceptedLimit.ok, true);
  if (acceptedLimit.ok) {
    assert.equal(acceptedLimit.value.canonicalJson, selfConsistentLimit);
    assert.equal(acceptedLimit.value.routerResult.status, 'success');
    assertDeepFrozen(acceptedLimit);
  }

  const parsed = parseRecord(SUCCESS_JSON);
  const reordered = JSON.stringify({
    snapshot: parsed['snapshot'],
    schemaVersion: parsed['schemaVersion'],
    request: parsed['request'],
    result: parsed['result'],
  });
  assertError(reordered, sha256(reordered), { code: 'canonical-run-replay-mismatch' });

  const pretty = JSON.stringify(parsed, null, 2);
  assertError(pretty, sha256(pretty), { code: 'canonical-run-replay-mismatch' });

  const reversedPools = mutate(NO_ROUTE_JSON, (record) => {
    const pools = content(record)['pools'] as unknown[];
    pools.reverse();
  });
  assertError(reversedPools, sha256(reversedPools), {
    code: 'canonical-run-replay-mismatch',
  });
});

void test('checks exact canonical bytes before supplied hash and reports computed hash polarity', () => {
  const wrongHash = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  assertError(SUCCESS_JSON, wrongHash, {
    code: 'canonical-run-hash-mismatch',
    expected: SUCCESS_HASH,
    actual: wrongHash,
  });
  assertError(SUCCESS_JSON, SUCCESS_HASH.toUpperCase(), {
    code: 'canonical-run-hash-mismatch',
    expected: SUCCESS_HASH,
    actual: SUCCESS_HASH.toUpperCase(),
  });
  assertError(SUCCESS_JSON, 'not-a-hash', {
    code: 'canonical-run-hash-mismatch',
    expected: SUCCESS_HASH,
    actual: 'not-a-hash',
  });

  const whitespace = `${SUCCESS_JSON}\n`;
  assertError(whitespace, wrongHash, { code: 'canonical-run-replay-mismatch' });
  assert.equal(whitespace, `${SUCCESS_JSON}\n`);
  assert.equal(wrongHash, 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
});
