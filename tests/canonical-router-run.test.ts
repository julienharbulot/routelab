import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLiquiditySnapshot,
  type ConstantProductPool,
  type LiquiditySnapshot,
} from '../src/domain/index.ts';
import type { ExactInputSinglePathRouterRequest } from '../src/router/single-path/index.ts';
import {
  createCanonicalSinglePathRouterRun,
  CANONICAL_ROUTER_RUN_SCHEMA_VERSION,
} from '../src/serialization/canonical-router-run/index.ts';
import {
  computeCanonicalSnapshotChecksum,
  verifyCanonicalSnapshotChecksum,
} from '../src/serialization/canonical-snapshot/index.ts';

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator,
    feeDenominator,
  };
}

function snapshot(
  pools: readonly ConstantProductPool[],
  snapshotId = 'snapshot-1',
): LiquiditySnapshot {
  const provisional: LiquiditySnapshot = {
    snapshotId,
    snapshotChecksum: 'pending',
    pools,
  };
  return {
    ...provisional,
    snapshotChecksum: computeCanonicalSnapshotChecksum(provisional),
  };
}

function request(
  inputSnapshot: LiquiditySnapshot,
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: inputSnapshot.snapshotId,
    snapshotChecksum: inputSnapshot.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxExpansions: 100,
    ...overrides,
  };
}

function requireRun(
  inputSnapshot: LiquiditySnapshot,
  inputRequest: ExactInputSinglePathRouterRequest,
) {
  const result = createCanonicalSinglePathRouterRun(inputSnapshot, inputRequest);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected a canonical router run');
  return result;
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length === 0) return [[]];

  const result: T[][] = [];
  for (const [index, value] of values.entries()) {
    const remainder = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const permutation of permutations(remainder)) {
      result.push([value, ...permutation]);
    }
  }
  return result;
}

void test('writes the exact success record and digest with exact strings and ordered fields', () => {
  const inputSnapshot = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  const result = requireRun(inputSnapshot, request(inputSnapshot));
  const expected =
    '{"schemaVersion":"routelab.router-run.v1","snapshot":{"snapshotId":"snapshot-1","snapshotChecksum":"sha256:4bcdfee87b6b59998593f23fff0a842a6fa6e49a1b4f9fd57b050de0fe883b60","content":{"schemaVersion":"routelab.snapshot.v1","pools":[{"poolId":"pool-ac","asset0":"A","reserve0":"1000","asset1":"C","reserve1":"1000","feeChargedNumerator":"0","feeDenominator":"1"}]}},"request":{"snapshotId":"snapshot-1","snapshotChecksum":"sha256:4bcdfee87b6b59998593f23fff0a842a6fa6e49a1b4f9fd57b050de0fe883b60","assetIn":"A","assetOut":"C","amountIn":"100","maxHops":1,"maxExpansions":100},"result":{"status":"success","plan":{"receipt":{"snapshotId":"snapshot-1","snapshotChecksum":"sha256:4bcdfee87b6b59998593f23fff0a842a6fa6e49a1b4f9fd57b050de0fe883b60","assetIn":"A","assetOut":"C","amountIn":"100","amountOut":"90","hops":[{"poolId":"pool-ac","assetIn":"A","assetOut":"C","amountIn":"100","amountOut":"90","reserveInBefore":"1000","reserveOutBefore":"1000","reserveInAfter":"1100","reserveOutAfter":"910"}]},"search":{"expansions":1,"enumeratedCandidates":1,"replayedCandidates":1,"rejectedCandidates":0,"termination":"complete"}}}}';

  assert.equal(CANONICAL_ROUTER_RUN_SCHEMA_VERSION, 'routelab.router-run.v1');
  assert.equal(result.value.canonicalJson, expected);
  assert.equal(Buffer.byteLength(result.value.canonicalJson, 'utf8'), 1_121);
  assert.equal(
    result.value.determinismHash,
    'sha256:fe36978745311c287b8118a11ed880d548d3e6780e32605eae9639173850cc2d',
  );
  assert.match(result.value.determinismHash, /^sha256:[0-9a-f]{64}$/u);

  const decoded = JSON.parse(result.value.canonicalJson) as Record<string, unknown>;
  assert.deepEqual(Object.keys(decoded), ['schemaVersion', 'snapshot', 'request', 'result']);
  assert.equal(result.value.routerResult.status, 'success');
});

void test('projects no-route and no-plan reasons and counters as distinct semantic records', () => {
  const disconnected = snapshot([
    pool('pool-ab', 'A', 1_000n, 'B', 1_000n),
    pool('pool-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const noRoute = requireRun(disconnected, request(disconnected));
  assert.equal(noRoute.value.routerResult.status, 'no-route');
  assert.match(
    noRoute.value.canonicalJson,
    /"result":\{"status":"no-route","reason":"no-candidate","search":\{"expansions":1,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"complete"\}\}\}$/u,
  );

  const allRejectedSnapshot = snapshot([pool('tiny-ac', 'A', 1_000n, 'C', 1n)]);
  const allRejected = requireRun(
    allRejectedSnapshot,
    request(allRejectedSnapshot, { amountIn: 1n }),
  );
  assert.equal(allRejected.value.routerResult.status, 'no-route');
  assert.match(
    allRejected.value.canonicalJson,
    /"result":\{"status":"no-route","reason":"all-candidates-rejected","search":\{"expansions":1,"enumeratedCandidates":1,"replayedCandidates":1,"rejectedCandidates":1,"termination":"complete"\}\}\}$/u,
  );

  const routable = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  const noPlan = requireRun(
    routable,
    request(routable, { maxExpansions: 0 }),
  );
  assert.equal(noPlan.value.routerResult.status, 'no-plan');
  assert.match(
    noPlan.value.canonicalJson,
    /"result":\{"status":"no-plan","reason":"work-limit","search":\{"expansions":0,"enumeratedCandidates":0,"replayedCandidates":0,"rejectedCandidates":0,"termination":"work-limit"\}\}\}$/u,
  );
  assert.notEqual(noRoute.value.canonicalJson, noPlan.value.canonicalJson);
  assert.notEqual(noRoute.value.determinismHash, noPlan.value.determinismHash);
});

void test('repeats exactly and ignores pool order and observation aliases', () => {
  const pools = [
    pool('pool-ac', 'A', 1_000n, 'C', 1_000n),
    pool('pool-ab', 'A', 1_000n, 'B', 2_000n),
    pool('pool-bc', 'B', 2_000n, 'C', 2_000n),
  ];
  const records = new Set<string>();
  const hashes = new Set<string>();

  for (const order of permutations(pools)) {
    const inputSnapshot = snapshot(order);
    const result = requireRun(
      inputSnapshot,
      request(inputSnapshot, { maxHops: 2 }),
    );
    records.add(result.value.canonicalJson);
    hashes.add(result.value.determinismHash);
  }

  assert.equal(records.size, 1);
  assert.equal(hashes.size, 1);

  const base = snapshot(pools);
  const aliased = {
    ...base,
    elapsedNanoseconds: 12_345n,
    trace: { selected: true },
    pools: base.pools.map((value) => ({ ...value, cachedPrice: 42 })),
  } as LiquiditySnapshot;
  const baseRequest = request(base, { maxHops: 2 });
  const aliasedRequest = {
    ...baseRequest,
    observedAt: '2099-01-01T00:00:00Z',
    environment: { locale: 'different' },
  } as ExactInputSinglePathRouterRequest;
  const baseline = requireRun(base, baseRequest);
  const withAliases = requireRun(aliased, aliasedRequest);

  assert.equal(withAliases.value.canonicalJson, baseline.value.canonicalJson);
  assert.equal(withAliases.value.determinismHash, baseline.value.determinismHash);
  assert.equal(baseline.value.canonicalJson.includes('elapsedNanoseconds'), false);
  assert.equal(baseline.value.canonicalJson.includes('observedAt'), false);
  assert.equal(baseline.value.canonicalJson.includes('message'), false);
  for (let repetition = 0; repetition < 10; repetition += 1) {
    assert.equal(
      requireRun(base, baseRequest).value.determinismHash,
      baseline.value.determinismHash,
    );
  }
});

void test('changes bytes and hashes for every changed semantic input or result', () => {
  const base = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  const baseline = requireRun(base, request(base));
  const changedContent = snapshot([pool('pool-ac', 'A', 1_001n, 'C', 1_000n)]);
  const changedId = snapshot(base.pools, 'snapshot-2');
  const variants = [
    requireRun(changedContent, request(changedContent)),
    requireRun(changedId, request(changedId)),
    requireRun(base, request(base, { amountIn: 101n })),
    requireRun(base, request(base, { maxHops: 2 })),
    requireRun(base, request(base, { maxExpansions: 0 })),
  ];

  for (const variant of variants) {
    assert.notEqual(variant.value.canonicalJson, baseline.value.canonicalJson);
    assert.notEqual(variant.value.determinismHash, baseline.value.determinismHash);
  }
});

void test('preserves huge exact values as strings and safe counters as numbers', () => {
  const huge = 10n ** 80n;
  const inputSnapshot = snapshot([pool('huge-ac', 'A', huge, 'C', huge * 2n)]);
  const inputRequest = request(inputSnapshot, {
    amountIn: huge,
    maxExpansions: Number.MAX_SAFE_INTEGER,
  });
  const result = requireRun(inputSnapshot, inputRequest);
  const decoded = JSON.parse(result.value.canonicalJson) as {
    request: { amountIn: unknown; maxExpansions: unknown };
    result: { plan: { receipt: { amountIn: unknown; amountOut: unknown } } };
  };

  assert.equal(decoded.request.amountIn, huge.toString(10));
  assert.equal(decoded.result.plan.receipt.amountIn, huge.toString(10));
  assert.equal(decoded.result.plan.receipt.amountOut, huge.toString(10));
  assert.equal(typeof decoded.request.amountIn, 'string');
  assert.equal(typeof decoded.result.plan.receipt.amountOut, 'string');
  assert.equal(decoded.request.maxExpansions, Number.MAX_SAFE_INTEGER);
  assert.equal(typeof decoded.request.maxExpansions, 'number');
});

void test('verifies checksum first and returns typed invalid requests without records', () => {
  const valid = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  const mismatched: LiquiditySnapshot = {
    ...valid,
    snapshotChecksum: 'not-the-content-checksum',
  };
  let requestReads = 0;
  const unreadRequest = new Proxy(request(mismatched), {
    get() {
      requestReads += 1;
      throw new Error('checksum mismatch must not read the request');
    },
  });
  const checksumFailure = createCanonicalSinglePathRouterRun(mismatched, unreadRequest);
  const directVerification = verifyCanonicalSnapshotChecksum(mismatched);

  assert.equal(checksumFailure.ok, false);
  assert.equal(directVerification.ok, false);
  if (checksumFailure.ok || directVerification.ok) return;
  assert.deepEqual(checksumFailure.error, directVerification.error);
  assert.equal(checksumFailure.error.code, 'snapshot-checksum-mismatch');
  assert.equal('value' in checksumFailure, false);
  assert.equal(Object.isFrozen(checksumFailure), true);
  assert.equal(Object.isFrozen(checksumFailure.error), true);
  assert.equal(requestReads, 0);

  const invalidRequest = createCanonicalSinglePathRouterRun(
    valid,
    request(valid, { amountIn: 0n }),
  );
  assert.equal(invalidRequest.ok, false);
  if (invalidRequest.ok) return;
  assert.deepEqual(invalidRequest.error, {
    code: 'invalid-router-request',
    routerError: {
      code: 'nonpositive-input',
      field: 'amountIn',
      message: 'request.amountIn must be positive.',
    },
  });
  assert.equal('value' in invalidRequest, false);
  assert.equal(Object.isFrozen(invalidRequest), true);
  assert.equal(Object.isFrozen(invalidRequest.error), true);
  if (invalidRequest.error.code === 'invalid-router-request') {
    assert.equal(Object.isFrozen(invalidRequest.error.routerError), true);
  }

  const unsafeCounter = createCanonicalSinglePathRouterRun(
    valid,
    request(valid, { maxExpansions: Number.MAX_SAFE_INTEGER + 1 }),
  );
  assert.equal(unsafeCounter.ok, false);
  if (unsafeCounter.ok) return;
  assert.equal(unsafeCounter.error.code, 'invalid-router-request');
  assert.equal('value' in unsafeCounter, false);
  if (unsafeCounter.error.code === 'invalid-router-request') {
    assert.equal(unsafeCounter.error.routerError.code, 'invalid-max-expansions');
  }
});

void test('captures drifting snapshot accessors once before verification and execution', () => {
  const firstPool = pool('pool-ac', 'A', 1_000n, 'C', 1_000n);
  const secondPool = pool('drifted-pool', 'A', 9_000n, 'C', 1n);
  const firstSnapshot = snapshot([firstPool]);
  const poolReads = {
    poolId: 0,
    asset0: 0,
    reserve0: 0,
    asset1: 0,
    reserve1: 0,
    feeChargedNumerator: 0,
    feeDenominator: 0,
  };
  const snapshotReads = { snapshotId: 0, snapshotChecksum: 0, pools: 0 };
  const driftingPool: ConstantProductPool = {
    get poolId() {
      poolReads.poolId += 1;
      return poolReads.poolId === 1 ? firstPool.poolId : secondPool.poolId;
    },
    get asset0() {
      poolReads.asset0 += 1;
      return poolReads.asset0 === 1 ? firstPool.asset0 : secondPool.asset0;
    },
    get reserve0() {
      poolReads.reserve0 += 1;
      return poolReads.reserve0 === 1 ? firstPool.reserve0 : secondPool.reserve0;
    },
    get asset1() {
      poolReads.asset1 += 1;
      return poolReads.asset1 === 1 ? firstPool.asset1 : secondPool.asset1;
    },
    get reserve1() {
      poolReads.reserve1 += 1;
      return poolReads.reserve1 === 1 ? firstPool.reserve1 : secondPool.reserve1;
    },
    get feeChargedNumerator() {
      poolReads.feeChargedNumerator += 1;
      return poolReads.feeChargedNumerator === 1
        ? firstPool.feeChargedNumerator
        : secondPool.feeChargedNumerator;
    },
    get feeDenominator() {
      poolReads.feeDenominator += 1;
      return poolReads.feeDenominator === 1
        ? firstPool.feeDenominator
        : secondPool.feeDenominator;
    },
  };
  const driftingSnapshot: LiquiditySnapshot = {
    get snapshotId() {
      snapshotReads.snapshotId += 1;
      return snapshotReads.snapshotId === 1 ? firstSnapshot.snapshotId : 'drifted-id';
    },
    get snapshotChecksum() {
      snapshotReads.snapshotChecksum += 1;
      return snapshotReads.snapshotChecksum === 1
        ? firstSnapshot.snapshotChecksum
        : 'drifted-checksum';
    },
    get pools() {
      snapshotReads.pools += 1;
      return snapshotReads.pools === 1 ? [driftingPool] : [secondPool];
    },
  };

  const result = requireRun(driftingSnapshot, request(firstSnapshot));
  const decoded = JSON.parse(result.value.canonicalJson) as {
    snapshot: {
      snapshotId: string;
      snapshotChecksum: string;
      content: { pools: unknown };
    };
  };
  const reconstructed = parseLiquiditySnapshot({
    snapshotId: decoded.snapshot.snapshotId,
    snapshotChecksum: decoded.snapshot.snapshotChecksum,
    pools: decoded.snapshot.content.pools,
  });

  assert.equal(reconstructed.ok, true);
  if (!reconstructed.ok) return;
  assert.equal(
    computeCanonicalSnapshotChecksum(reconstructed.value),
    decoded.snapshot.snapshotChecksum,
  );
  assert.equal(result.value.routerResult.status, 'success');
  if (result.value.routerResult.status !== 'success') return;
  assert.equal(result.value.routerResult.plan.receipt.hops[0]?.poolId, 'pool-ac');
  assert.equal(result.value.routerResult.plan.receipt.hops[0]?.reserveInBefore, 1_000n);
  assert.deepEqual(snapshotReads, { snapshotId: 1, snapshotChecksum: 1, pools: 1 });
  assert.equal(Object.values(poolReads).every((count) => count === 1), true);
});

void test('captures every drifting request accessor once after checksum verification', () => {
  const inputSnapshot = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  const firstRequest = request(inputSnapshot);
  const secondRequest = request(inputSnapshot, {
    snapshotId: 'drifted-id',
    snapshotChecksum: 'drifted-checksum',
    assetIn: 'C',
    assetOut: 'A',
    amountIn: 999n,
    maxHops: 0,
    maxExpansions: 0,
  });
  const reads = {
    snapshotId: 0,
    snapshotChecksum: 0,
    assetIn: 0,
    assetOut: 0,
    amountIn: 0,
    maxHops: 0,
    maxExpansions: 0,
  };
  const driftingRequest: ExactInputSinglePathRouterRequest = {
    get snapshotId() {
      reads.snapshotId += 1;
      return reads.snapshotId === 1 ? firstRequest.snapshotId : secondRequest.snapshotId;
    },
    get snapshotChecksum() {
      reads.snapshotChecksum += 1;
      return reads.snapshotChecksum === 1
        ? firstRequest.snapshotChecksum
        : secondRequest.snapshotChecksum;
    },
    get assetIn() {
      reads.assetIn += 1;
      return reads.assetIn === 1 ? firstRequest.assetIn : secondRequest.assetIn;
    },
    get assetOut() {
      reads.assetOut += 1;
      return reads.assetOut === 1 ? firstRequest.assetOut : secondRequest.assetOut;
    },
    get amountIn() {
      reads.amountIn += 1;
      return reads.amountIn === 1 ? firstRequest.amountIn : secondRequest.amountIn;
    },
    get maxHops() {
      reads.maxHops += 1;
      return reads.maxHops === 1 ? firstRequest.maxHops : secondRequest.maxHops;
    },
    get maxExpansions() {
      reads.maxExpansions += 1;
      return reads.maxExpansions === 1
        ? firstRequest.maxExpansions
        : secondRequest.maxExpansions;
    },
  };

  const result = requireRun(inputSnapshot, driftingRequest);
  const decoded = JSON.parse(result.value.canonicalJson) as {
    request: {
      snapshotId: string;
      snapshotChecksum: string;
      assetIn: string;
      assetOut: string;
      amountIn: string;
      maxHops: number;
      maxExpansions: number;
    };
  };

  assert.deepEqual(decoded.request, {
    snapshotId: firstRequest.snapshotId,
    snapshotChecksum: firstRequest.snapshotChecksum,
    assetIn: firstRequest.assetIn,
    assetOut: firstRequest.assetOut,
    amountIn: firstRequest.amountIn.toString(10),
    maxHops: firstRequest.maxHops,
    maxExpansions: firstRequest.maxExpansions,
  });
  assert.equal(result.value.routerResult.status, 'success');
  if (result.value.routerResult.status !== 'success') return;
  assert.equal(result.value.routerResult.plan.receipt.amountIn, firstRequest.amountIn);
  assert.equal(Object.values(reads).every((count) => count === 1), true);
});

void test('freezes wrappers and integrated results without mutating caller aliases', () => {
  const inputSnapshot = snapshot([
    pool('pool-ac', 'A', 1_000n, 'C', 1_000n),
    pool('pool-ab', 'A', 1_000n, 'B', 1_000n),
  ]);
  const inputRequest = request(inputSnapshot);
  const snapshotBefore = structuredClone(inputSnapshot);
  const requestBefore = structuredClone(inputRequest);
  const result = requireRun(inputSnapshot, inputRequest);

  assert.deepEqual(inputSnapshot, snapshotBefore);
  assert.deepEqual(inputRequest, requestBefore);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.routerResult), true);
  assert.equal(result.value.routerResult.status, 'success');
  if (result.value.routerResult.status !== 'success') return;
  assert.equal(Object.isFrozen(result.value.routerResult.plan), true);
  assert.equal(Object.isFrozen(result.value.routerResult.plan.receipt), true);
  assert.equal(Object.isFrozen(result.value.routerResult.plan.receipt.hops), true);
  assert.equal(
    result.value.routerResult.plan.receipt.hops.every((hop) => Object.isFrozen(hop)),
    true,
  );
  assert.equal(Object.isFrozen(result.value.routerResult.plan.search), true);
});
