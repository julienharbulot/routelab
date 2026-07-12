import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { LiquiditySnapshot } from '../../src/domain/index.ts';
import type { ExactInputSinglePathRouterRequest } from '../../src/router/single-path/index.ts';
import { createCanonicalSinglePathRouterRun } from '../../src/serialization/canonical-router-run/index.ts';

const DIRECT_CONTENT =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}';
const DIRECT_CHECKSUM =
  'sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3';

const DISCONNECTED_CONTENT =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"component-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"},{"poolId":"component-cd","asset0":"C","reserve0":"1000","asset1":"D","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"}]}';
const DISCONNECTED_CHECKSUM =
  'sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743';

const HUGE_CONTENT =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"huge-ab","asset0":"A","reserve0":"1000000000000000000000000000000","asset1":"B","reserve1":"1000000000000000000000000000000","feeChargedNumerator":"0","feeDenominator":"1"}]}';
const HUGE_CHECKSUM =
  'sha256:532f062d1ec1aeb942649a1327fae244b96555a34fe74e79f5b554b45d879465';

const SUCCESS_CANONICAL_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"success","plan":{"receipt":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","amountOut":"90","hops":[{"poolId":"direct-ab","assetIn":"A","assetOut":"B","amountIn":"100","amountOut":"90","reserveInBefore":"1000","reserveOutBefore":"1000","reserveInAfter":"1100","reserveOutAfter":"910"}]},"search":{"expansions":1,"enumeratedCandidates":1,"replayedCandidates":1,"rejectedCandidates":0,"termination":"complete"}}}}';
const SUCCESS_HASH =
  'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011';

const NO_PLAN_CANONICAL_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"direct-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"3","feeDenominator":"1000"}]}},"request":{"snapshotId":"snapshot-direct","snapshotChecksum":"sha256:ed8bb56fbc26b3105c7a1c1772ab2a05babe3ec8aa473fcba0e22ef086ececb3","assetIn":"A","assetOut":"B","amountIn":"100","maxHops":1,"maxExpansions":0},"result":{"status":"no-plan","reason":"work-limit","search":{"expansions":0,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"work-limit"}}}';
const NO_PLAN_HASH =
  'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4';

const NO_ROUTE_CANONICAL_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"component-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"},{"poolId":"component-cd","asset0":"C","reserve0":"1000","asset1":"D","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"}]}},"request":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","assetIn":"A","assetOut":"D","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"no-route","reason":"no-candidate","search":{"expansions":1,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"complete"}}}';
const NO_ROUTE_HASH =
  'sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90';

const COUNTER_CHANGED_NO_ROUTE_JSON =
  '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"component-ab","asset0":"A","reserve0":"1000","asset1":"B","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"},{"poolId":"component-cd","asset0":"C","reserve0":"1000","asset1":"D","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"}]}},"request":{"snapshotId":"snapshot-disconnected","snapshotChecksum":"sha256:b835a39ae996b81f1e6e16f4b0888fabf73caf656daa0aaf56deb541f714b743","assetIn":"A","assetOut":"D","amountIn":"100","maxHops":1,"maxExpansions":10},"result":{"status":"no-route","reason":"no-candidate","search":{"expansions":2,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"complete"}}}';
const COUNTER_CHANGED_NO_ROUTE_HASH =
  'sha256:520df7717494d0b32e068a6d037d488134740168aec68150920a37433c4416b2';

type RunResult = ReturnType<typeof createCanonicalSinglePathRouterRun>;
type SuccessfulRun = Extract<RunResult, { readonly ok: true }>;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

function directSnapshot(): LiquiditySnapshot {
  return {
    snapshotId: 'snapshot-direct',
    snapshotChecksum: DIRECT_CHECKSUM,
    pools: [
      {
        poolId: 'direct-ab',
        asset0: 'A',
        reserve0: 1000n,
        asset1: 'B',
        reserve1: 1000n,
        feeChargedNumerator: 3n,
        feeDenominator: 1000n,
      },
    ],
  };
}

function directRequest(
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'snapshot-direct',
    snapshotChecksum: DIRECT_CHECKSUM,
    assetIn: 'A',
    assetOut: 'B',
    amountIn: 100n,
    maxHops: 1,
    maxExpansions: 10,
    ...overrides,
  };
}

function disconnectedSnapshot(reversePools = false): LiquiditySnapshot {
  const pools: LiquiditySnapshot['pools'] = [
    {
      poolId: 'component-ab',
      asset0: 'A',
      reserve0: 1000n,
      asset1: 'B',
      reserve1: 1000n,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    },
    {
      poolId: 'component-cd',
      asset0: 'C',
      reserve0: 1000n,
      asset1: 'D',
      reserve1: 1000n,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    },
  ];

  return {
    snapshotId: 'snapshot-disconnected',
    snapshotChecksum: DISCONNECTED_CHECKSUM,
    pools: reversePools ? [...pools].reverse() : pools,
  };
}

function disconnectedRequest(): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'snapshot-disconnected',
    snapshotChecksum: DISCONNECTED_CHECKSUM,
    assetIn: 'A',
    assetOut: 'D',
    amountIn: 100n,
    maxHops: 1,
    maxExpansions: 10,
  };
}

function expectSuccess(result: RunResult): SuccessfulRun {
  if (result.ok) return result;
  assert.fail(`expected canonical run, received ${result.error.code}`);
}

function externalVectorDigest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
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

function assertNoRecord(result: RunResult): asserts result is Extract<RunResult, { ok: false }> {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('invalid input unexpectedly produced a canonical run');
  assert.deepEqual(Object.keys(result), ['ok', 'error']);
  assert.equal('value' in result, false);
  assert.equal('canonicalJson' in result, false);
  assert.equal('determinismHash' in result, false);
}

void test('independent fixed success record matches exact UTF-8 bytes and external digest', () => {
  assert.equal(Buffer.byteLength(DIRECT_CONTENT, 'utf8'), 185);
  assert.equal(externalVectorDigest(DIRECT_CONTENT), DIRECT_CHECKSUM);
  assert.equal(Buffer.byteLength(SUCCESS_CANONICAL_JSON, 'utf8'), 1142);
  assert.equal(externalVectorDigest(SUCCESS_CANONICAL_JSON), SUCCESS_HASH);

  const run = expectSuccess(
    createCanonicalSinglePathRouterRun(directSnapshot(), directRequest()),
  );
  assert.equal(run.value.canonicalJson, SUCCESS_CANONICAL_JSON);
  assert.equal(run.value.determinismHash, SUCCESS_HASH);
  assert.equal(run.value.routerResult.status, 'success');
  if (run.value.routerResult.status !== 'success') assert.fail('expected a success result');
  assert.equal(run.value.routerResult.plan.receipt.amountOut, 90n);
  assert.deepEqual(run.value.routerResult.plan.search, {
    expansions: 1,
    enumeratedCandidates: 1,
    replayedCandidates: 1,
    rejectedCandidates: 0,
    termination: 'complete',
  });
});

void test('independent no-plan and no-route records remain distinct and deterministic', () => {
  assert.equal(Buffer.byteLength(NO_PLAN_CANONICAL_JSON, 'utf8'), 763);
  assert.equal(externalVectorDigest(NO_PLAN_CANONICAL_JSON), NO_PLAN_HASH);
  assert.equal(Buffer.byteLength(DISCONNECTED_CONTENT, 'utf8'), 320);
  assert.equal(externalVectorDigest(DISCONNECTED_CONTENT), DISCONNECTED_CHECKSUM);
  assert.equal(Buffer.byteLength(NO_ROUTE_CANONICAL_JSON, 'utf8'), 912);
  assert.equal(externalVectorDigest(NO_ROUTE_CANONICAL_JSON), NO_ROUTE_HASH);

  const noPlan = expectSuccess(
    createCanonicalSinglePathRouterRun(
      directSnapshot(),
      directRequest({ maxExpansions: 0 }),
    ),
  );
  assert.equal(noPlan.value.canonicalJson, NO_PLAN_CANONICAL_JSON);
  assert.equal(noPlan.value.determinismHash, NO_PLAN_HASH);
  assert.equal(noPlan.value.routerResult.status, 'no-plan');

  const noRoute = expectSuccess(
    createCanonicalSinglePathRouterRun(disconnectedSnapshot(), disconnectedRequest()),
  );
  assert.equal(noRoute.value.canonicalJson, NO_ROUTE_CANONICAL_JSON);
  assert.equal(noRoute.value.determinismHash, NO_ROUTE_HASH);
  assert.equal(noRoute.value.routerResult.status, 'no-route');
  assert.notEqual(noRoute.value.determinismHash, noPlan.value.determinismHash);
});

void test('pool permutations, repeats, and extra observation aliases cannot change semantic bytes', () => {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const run = expectSuccess(
      createCanonicalSinglePathRouterRun(
        disconnectedSnapshot(iteration % 2 === 1),
        disconnectedRequest(),
      ),
    );
    assert.equal(run.value.canonicalJson, NO_ROUTE_CANONICAL_JSON);
    assert.equal(run.value.determinismHash, NO_ROUTE_HASH);
  }

  const snapshot = directSnapshot() as LiquiditySnapshot & {
    elapsedMs: number;
    environment: string;
    trace: readonly string[];
  };
  snapshot.elapsedMs = 999;
  snapshot.environment = 'ignored';
  snapshot.trace = ['ignored'];
  const pool = snapshot.pools[0] as LiquiditySnapshot['pools'][number] & {
    cache: object;
    timestamp: string;
  };
  pool.cache = { ignored: true };
  pool.timestamp = '2099-01-01T00:00:00Z';
  const request = directRequest() as ExactInputSinglePathRouterRequest & {
    elapsedMs: number;
    observation: object;
  };
  request.elapsedMs = 123;
  request.observation = { ignored: true };

  const aliased = expectSuccess(createCanonicalSinglePathRouterRun(snapshot, request));
  assert.equal(aliased.value.canonicalJson, SUCCESS_CANONICAL_JSON);
  assert.equal(aliased.value.determinismHash, SUCCESS_HASH);
  assert.equal(aliased.value.canonicalJson.includes('ignored'), false);
  assert.equal(aliased.value.canonicalJson.includes('elapsed'), false);
  assert.equal(aliased.value.canonicalJson.includes('timestamp'), false);
});

void test('semantic inputs and counters change canonical bytes and hashes while huge exact values stay strings', () => {
  const baseline = expectSuccess(
    createCanonicalSinglePathRouterRun(directSnapshot(), directRequest()),
  );
  const changedAmount = expectSuccess(
    createCanonicalSinglePathRouterRun(directSnapshot(), directRequest({ amountIn: 101n })),
  );
  const changedLimit = expectSuccess(
    createCanonicalSinglePathRouterRun(
      directSnapshot(),
      directRequest({ maxExpansions: 0 }),
    ),
  );
  const renamedSnapshot = directSnapshot() as Mutable<LiquiditySnapshot>;
  renamedSnapshot.snapshotId = 'snapshot-renamed';
  const renamed = expectSuccess(
    createCanonicalSinglePathRouterRun(
      renamedSnapshot,
      directRequest({ snapshotId: 'snapshot-renamed' }),
    ),
  );

  for (const changed of [changedAmount, changedLimit, renamed]) {
    assert.notEqual(changed.value.canonicalJson, baseline.value.canonicalJson);
    assert.notEqual(changed.value.determinismHash, baseline.value.determinismHash);
  }

  assert.equal(Buffer.byteLength(COUNTER_CHANGED_NO_ROUTE_JSON, 'utf8'), 912);
  assert.equal(
    externalVectorDigest(COUNTER_CHANGED_NO_ROUTE_JSON),
    COUNTER_CHANGED_NO_ROUTE_HASH,
  );
  assert.notEqual(COUNTER_CHANGED_NO_ROUTE_JSON, NO_ROUTE_CANONICAL_JSON);
  assert.notEqual(COUNTER_CHANGED_NO_ROUTE_HASH, NO_ROUTE_HASH);

  assert.equal(Buffer.byteLength(HUGE_CONTENT, 'utf8'), 234);
  assert.equal(externalVectorDigest(HUGE_CONTENT), HUGE_CHECKSUM);
  const hugeSnapshot: LiquiditySnapshot = {
    snapshotId: 'snapshot-huge',
    snapshotChecksum: HUGE_CHECKSUM,
    pools: [
      {
        poolId: 'huge-ab',
        asset0: 'A',
        reserve0: 1_000_000_000_000_000_000_000_000_000_000n,
        asset1: 'B',
        reserve1: 1_000_000_000_000_000_000_000_000_000_000n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
  };
  const huge = expectSuccess(
    createCanonicalSinglePathRouterRun(hugeSnapshot, {
      snapshotId: 'snapshot-huge',
      snapshotChecksum: HUGE_CHECKSUM,
      assetIn: 'A',
      assetOut: 'B',
      amountIn: 9_007_199_254_740_993n,
      maxHops: 1,
      maxExpansions: 10,
    }),
  );
  assert.equal(huge.value.routerResult.status, 'success');
  if (huge.value.routerResult.status !== 'success') assert.fail('expected huge success result');
  const receipt = huge.value.routerResult.plan.receipt;
  assert.equal(receipt.amountOut, 9_007_199_254_740_911n);
  assert.equal(receipt.hops[0]?.reserveInAfter, 1_000_000_000_000_009_007_199_254_740_993n);
  assert.equal(receipt.hops[0]?.reserveOutAfter, 999_999_999_999_990_992_800_745_259_089n);
  const parsed = JSON.parse(huge.value.canonicalJson) as {
    snapshot: { content: { pools: [{ reserve0: unknown; reserve1: unknown }] } };
    request: { amountIn: unknown };
    result: { plan: { receipt: { amountIn: unknown; amountOut: unknown } } };
  };
  assert.equal(typeof parsed.snapshot.content.pools[0].reserve0, 'string');
  assert.equal(typeof parsed.snapshot.content.pools[0].reserve1, 'string');
  assert.equal(typeof parsed.request.amountIn, 'string');
  assert.equal(typeof parsed.result.plan.receipt.amountIn, 'string');
  assert.equal(typeof parsed.result.plan.receipt.amountOut, 'string');
});

void test('checksum mismatch is resolved before any request getter can execute', () => {
  const badSnapshot = directSnapshot() as Mutable<LiquiditySnapshot>;
  badSnapshot.snapshotChecksum = `sha256:${'0'.repeat(64)}`;
  const throwingRequest = Object.defineProperties({}, {
    snapshotId: { get: () => assert.fail('request.snapshotId was read before checksum failure') },
    snapshotChecksum: {
      get: () => assert.fail('request.snapshotChecksum was read before checksum failure'),
    },
    assetIn: { get: () => assert.fail('request.assetIn was read before checksum failure') },
    assetOut: { get: () => assert.fail('request.assetOut was read before checksum failure') },
    amountIn: { get: () => assert.fail('request.amountIn was read before checksum failure') },
    maxHops: { get: () => assert.fail('request.maxHops was read before checksum failure') },
    maxExpansions: {
      get: () => assert.fail('request.maxExpansions was read before checksum failure'),
    },
  }) as ExactInputSinglePathRouterRequest;

  const result = createCanonicalSinglePathRouterRun(badSnapshot, throwingRequest);
  assertNoRecord(result);
  assert.deepEqual(result.error, {
    code: 'snapshot-checksum-mismatch',
    expected: DIRECT_CHECKSUM,
    actual: badSnapshot.snapshotChecksum,
  });
  assertDeepFrozen(result);
});

void test('invalid requests return frozen typed errors without records', () => {
  const cases: readonly [
    Partial<ExactInputSinglePathRouterRequest>,
    string,
    string,
  ][] = [
    [{ assetOut: 'A' }, 'same-asset-request', 'assetOut'],
    [{ amountIn: 0n }, 'nonpositive-input', 'amountIn'],
    [{ maxHops: 0 }, 'invalid-max-hops', 'maxHops'],
    [{ maxExpansions: Number.NaN }, 'invalid-max-expansions', 'maxExpansions'],
    [{ maxExpansions: Number.POSITIVE_INFINITY }, 'invalid-max-expansions', 'maxExpansions'],
    [{ maxExpansions: 1.5 }, 'invalid-max-expansions', 'maxExpansions'],
    [
      { maxExpansions: Number.MAX_SAFE_INTEGER + 1 },
      'invalid-max-expansions',
      'maxExpansions',
    ],
  ];

  for (const [overrides, expectedCode, expectedField] of cases) {
    const result = createCanonicalSinglePathRouterRun(
      directSnapshot(),
      directRequest(overrides),
    );
    assertNoRecord(result);
    assert.equal(result.error.code, 'invalid-router-request');
    if (result.error.code !== 'invalid-router-request') assert.fail('expected router error');
    assert.equal(result.error.routerError.code, expectedCode);
    assert.equal(result.error.routerError.field, expectedField);
    assertDeepFrozen(result);
  }
});

void test('success values are deeply frozen, inputs are unchanged, and returned values do not alias callers', () => {
  const snapshot = directSnapshot();
  const request = directRequest();
  const pool = snapshot.pools[0];
  assert.ok(pool);
  const originalPool = { ...pool };
  const originalRequest = { ...request };

  const run = expectSuccess(createCanonicalSinglePathRouterRun(snapshot, request));
  assert.deepEqual(snapshot.pools, [originalPool]);
  assert.deepEqual(request, originalRequest);
  assert.equal(Object.isFrozen(snapshot), false);
  assert.equal(Object.isFrozen(snapshot.pools), false);
  assert.equal(Object.isFrozen(pool), false);
  assert.equal(Object.isFrozen(request), false);
  assertDeepFrozen(run);

  const mutablePool = pool as Mutable<typeof pool>;
  const mutableRequest = request as Mutable<typeof request>;
  mutablePool.reserve0 = 2n;
  mutableRequest.amountIn = 1n;

  assert.equal(run.value.canonicalJson, SUCCESS_CANONICAL_JSON);
  assert.equal(run.value.determinismHash, SUCCESS_HASH);
  assert.equal(run.value.routerResult.status, 'success');
  if (run.value.routerResult.status !== 'success') assert.fail('expected success result');
  assert.equal(run.value.routerResult.plan.receipt.amountIn, 100n);
  assert.equal(run.value.routerResult.plan.receipt.hops[0]?.reserveInBefore, 1000n);
});
