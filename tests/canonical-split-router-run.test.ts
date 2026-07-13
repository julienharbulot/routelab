import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import type {
  ExactInputSplitRuntimeRequest,
  ExactInputSplitWorkCaps,
} from '../src/router/anytime-exact-input-split/index.ts';
import {
  CANONICAL_SPLIT_ROUTER_RUN_SCHEMA_VERSION,
  createCanonicalSplitRouterRun,
  parseAndVerifyCanonicalSplitRouterRun,
  type CanonicalSplitRouterRun,
} from '../src/serialization/canonical-split-router-run/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

/* eslint-disable
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-argument,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-return,
  @typescript-eslint/no-unnecessary-type-assertion
*/
type MutableRecord = any;

function pool(poolId: string, reserve = 100n): ConstantProductPool {
  return {
    poolId,
    asset0: 'A',
    reserve0: reserve,
    asset1: 'B',
    reserve1: reserve,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  const provisional: LiquiditySnapshot = {
    snapshotId: 'pre-m6-two-direct-pools',
    snapshotChecksum: 'pending',
    pools,
  };
  return {
    ...provisional,
    snapshotChecksum: computeCanonicalSnapshotChecksum(provisional),
  };
}

function request(input: LiquiditySnapshot, amountIn = 100n): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: input.snapshotId,
    snapshotChecksum: input.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'B',
    amountIn,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
  };
}

const fullCaps: ExactInputSplitWorkCaps = {
  maxPathExpansions: 100,
  maxBestSingleCandidateReplays: 100,
  maxCandidateSetExpansions: 100,
  maxEqualProposalReplays: 100,
  maxGreedyOptionReplays: 100,
  maxFinalAuthorizationReplays: 100,
};
const zeroCaps: ExactInputSplitWorkCaps = {
  maxPathExpansions: 0,
  maxBestSingleCandidateReplays: 0,
  maxCandidateSetExpansions: 0,
  maxEqualProposalReplays: 0,
  maxGreedyOptionReplays: 0,
  maxFinalAuthorizationReplays: 0,
};

function createRun(caps = fullCaps, amountIn = 100n): CanonicalSplitRouterRun {
  const input = snapshot([pool('direct-0'), pool('direct-1')]);
  const result = createCanonicalSplitRouterRun(input, request(input, amountIn), caps);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected canonical split run');
  return result.value;
}

function mutate(
  run: CanonicalSplitRouterRun,
  change: (record: MutableRecord) => void,
): string {
  const record = JSON.parse(run.canonicalJson) as MutableRecord;
  change(record);
  return JSON.stringify(record);
}

function assertFailure(
  json: string,
  hash: string,
  expected: object,
): void {
  const result = parseAndVerifyCanonicalSplitRouterRun(json, hash);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.error, expected);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.error), true);
  }
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

void test('writes the additive split schema with hand-audited 50/66 math and exact ledger', () => {
  const run = createRun();
  assert.equal(CANONICAL_SPLIT_ROUTER_RUN_SCHEMA_VERSION, 'routelab.split-router-run.v1');
  assert.equal(run.determinismHash, 'sha256:d38c5035cf41b14847adf623ab9bc18051a1a48c5e8433afb257fcc7f1944f7a');
  assert.equal(
    run.determinismHash,
    `sha256:${createHash('sha256').update(run.canonicalJson, 'utf8').digest('hex')}`,
  );
  const decoded = JSON.parse(run.canonicalJson) as MutableRecord;
  assert.deepEqual(Object.keys(decoded), ['schemaVersion', 'snapshot', 'request', 'control', 'result']);
  assert.equal(decoded.request.amountIn, '100');
  assert.deepEqual(decoded.control, fullCaps);
  assert.equal(decoded.result.plan.receipt.amountOut, '66');
  assert.deepEqual(
    decoded.result.plan.receipt.legs.map((leg: MutableRecord) => leg.allocation),
    ['50', '50'],
  );
  assert.deepEqual(decoded.result.plan.search, {
    counters: {
      directCandidates: 2,
      directCandidateReplays: 2,
      directCandidateRejections: 0,
      pathExpansions: 2,
      bestSingleCandidateReplays: 2,
      bestSingleCandidateRejections: 0,
      candidateSetExpansions: 2,
      equalProposalReplays: 1,
      equalProposalRejections: 0,
      greedyOptionReplays: 4,
      greedyOptionRejections: 0,
      finalAuthorizationReplays: 1,
      finalAuthorizationRejections: 0,
    },
    termination: 'complete',
  });
  assert.equal(run.canonicalJson.includes('deadline'), false);
  assert.equal(run.canonicalJson.includes('timing'), false);
  assert.equal(run.canonicalJson.includes('environment'), false);
  assertDeepFrozen(run);
});

void test('canonicalizes the mandatory direct fallback under six zero caps as work-limit', () => {
  const run = createRun(zeroCaps);
  assert.equal(run.determinismHash, 'sha256:84eff360c586b13db3fcc79c216837f19998bdf09b1dabd4ac94f34bee96d67e');
  assert.equal(run.routerResult.status, 'success');
  if (run.routerResult.status !== 'success') return;
  assert.equal(run.routerResult.plan.receipt.amountOut, 50n);
  assert.equal(run.routerResult.plan.search.termination, 'work-limit');
  assert.deepEqual(run.routerResult.plan.search.counters, {
    directCandidates: 2,
    directCandidateReplays: 2,
    directCandidateRejections: 0,
    pathExpansions: 0,
    bestSingleCandidateReplays: 0,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 0,
    equalProposalReplays: 0,
    equalProposalRejections: 0,
    greedyOptionReplays: 0,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 0,
    finalAuthorizationRejections: 0,
  });
});

void test('projects deterministic no-route and cap-driven no-plan records without inventing an incumbent', () => {
  const provisional: LiquiditySnapshot = {
    snapshotId: 'disconnected',
    snapshotChecksum: 'pending',
    pools: [
      { ...pool('component-ac'), asset1: 'C' },
      { ...pool('component-db'), asset0: 'D' },
    ],
  };
  const disconnected = {
    ...provisional,
    snapshotChecksum: computeCanonicalSnapshotChecksum(provisional),
  };
  const disconnectedRequest = request(disconnected);
  const complete = createCanonicalSplitRouterRun(disconnected, disconnectedRequest, fullCaps);
  assert.equal(complete.ok, true);
  if (complete.ok) {
    assert.equal(complete.value.routerResult.status, 'no-route');
    if (complete.value.routerResult.status === 'no-route') {
      assert.equal(complete.value.routerResult.reason, 'no-candidate');
      assert.equal(complete.value.routerResult.search.termination, 'complete');
    }
  }
  const limited = createCanonicalSplitRouterRun(disconnected, disconnectedRequest, zeroCaps);
  assert.equal(limited.ok, true);
  if (limited.ok) {
    assert.equal(limited.value.routerResult.status, 'no-plan');
    if (limited.value.routerResult.status === 'no-plan') {
      assert.equal(limited.value.routerResult.reason, 'work-limit');
      assert.equal(limited.value.routerResult.search.termination, 'work-limit');
    }
  }
});

void test('repeats exact bytes and hashes, ignores input aliases, and preserves huge bigint strings', () => {
  const baseSnapshot = snapshot([pool('direct-0'), pool('direct-1')]);
  const baseRequest = request(baseSnapshot);
  const baseline = createCanonicalSplitRouterRun(baseSnapshot, baseRequest, fullCaps);
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  for (let index = 0; index < 10; index += 1) {
    const repeated = createCanonicalSplitRouterRun(baseSnapshot, baseRequest, fullCaps);
    assert.equal(repeated.ok, true);
    if (repeated.ok) {
      assert.equal(repeated.value.canonicalJson, baseline.value.canonicalJson);
      assert.equal(repeated.value.determinismHash, baseline.value.determinismHash);
    }
  }

  const aliasedRequest = { ...baseRequest, deadline: 1n, observedAt: 'later' } as ExactInputSplitRuntimeRequest;
  const aliasedCaps = { ...fullCaps, shouldInterrupt: () => true, timing: 9 } as ExactInputSplitWorkCaps;
  const aliased = createCanonicalSplitRouterRun(baseSnapshot, aliasedRequest, aliasedCaps);
  assert.equal(aliased.ok, true);
  if (aliased.ok) assert.equal(aliased.value.canonicalJson, baseline.value.canonicalJson);

  const huge = 10n ** 80n;
  const hugeSnapshot = snapshot([pool('direct-0', huge), pool('direct-1', huge)]);
  const hugeRun = createCanonicalSplitRouterRun(
    hugeSnapshot,
    request(hugeSnapshot, huge),
    fullCaps,
  );
  assert.equal(hugeRun.ok, true);
  if (!hugeRun.ok) return;
  const decoded = JSON.parse(hugeRun.value.canonicalJson) as MutableRecord;
  assert.equal(decoded.request.amountIn, huge.toString(10));
  assert.equal(typeof decoded.request.amountIn, 'string');
  assert.equal(typeof decoded.result.plan.receipt.amountOut, 'string');
  assert.equal(typeof decoded.result.plan.search.counters.pathExpansions, 'number');
});

void test('captures caller inputs, verifies checksum before request/control, and returns typed validation failures', () => {
  const valid = snapshot([pool('direct-0'), pool('direct-1')]);
  const mismatched = { ...valid, snapshotChecksum: 'wrong' };
  let requestReads = 0;
  let capReads = 0;
  const unreadRequest = new Proxy(request(mismatched), {
    get() {
      requestReads += 1;
      throw new Error('must not read');
    },
  });
  const unreadCaps = new Proxy(fullCaps, {
    get() {
      capReads += 1;
      throw new Error('must not read');
    },
  });
  const checksumFailure = createCanonicalSplitRouterRun(mismatched, unreadRequest, unreadCaps);
  assert.equal(checksumFailure.ok, false);
  if (!checksumFailure.ok) assert.equal(checksumFailure.error.code, 'snapshot-checksum-mismatch');
  assert.equal(requestReads, 0);
  assert.equal(capReads, 0);

  const invalidRequest = createCanonicalSplitRouterRun(valid, request(valid, 0n), fullCaps);
  assert.deepEqual(invalidRequest, {
    ok: false,
    error: {
      code: 'invalid-split-router-request',
      routerError: { code: 'nonpositive-input', field: 'amountIn' },
    },
  });
  const invalidControl = createCanonicalSplitRouterRun(valid, request(valid), {
    ...fullCaps,
    maxGreedyOptionReplays: -1,
  });
  assert.deepEqual(invalidControl, {
    ok: false,
    error: {
      code: 'invalid-split-router-control',
      controlError: {
        code: 'invalid-work-cap',
        field: 'workCaps.maxGreedyOptionReplays',
      },
    },
  });

  const mutablePools = [pool('direct-0'), pool('direct-1')];
  const mutableSnapshot = snapshot(mutablePools);
  const mutableRequest = request(mutableSnapshot);
  const mutableCaps = { ...fullCaps };
  const captured = createCanonicalSplitRouterRun(mutableSnapshot, mutableRequest, mutableCaps);
  assert.equal(captured.ok, true);
  if (!captured.ok) return;
  (mutableRequest as MutableRecord).amountIn = 1n;
  (mutableCaps as MutableRecord).maxPathExpansions = 0;
  (mutablePools[0] as MutableRecord).reserve0 = 1n;
  assert.equal(JSON.parse(captured.value.canonicalJson).request.amountIn, '100');
  assertDeepFrozen(captured.value);
});

void test('strict parser round-trips fresh state and rejects malformed/root/nested aliases', () => {
  const run = createRun();
  const parsed = parseAndVerifyCanonicalSplitRouterRun(run.canonicalJson, run.determinismHash);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, run);
    assert.notEqual(parsed.value, run);
    assertDeepFrozen(parsed.value);
  }
  assertFailure('{', run.determinismHash, { code: 'invalid-canonical-split-run-json' });
  for (const [change, path] of [
    [(record: MutableRecord) => { record.timing = 1; }, '$.timing'],
    [(record: MutableRecord) => { record.control.deadline = 1; }, '$.control.deadline'],
    [(record: MutableRecord) => { record.control.shouldInterrupt = false; }, '$.control.shouldInterrupt'],
    [(record: MutableRecord) => { record.result.plan.search.elapsed = 1; }, '$.result.plan.search.elapsed'],
    [(record: MutableRecord) => { record.result.plan.receipt.legs[0].receipt.hops[0].extra = true; }, '$.result.plan.receipt.legs[0].receipt.hops[0].extra'],
  ] as const) {
    assertFailure(mutate(run, change), run.determinismHash, {
      code: 'invalid-canonical-split-run-shape',
      path,
    });
  }
});

void test('parser enforces version, snapshot, request, control, replay, then hash precedence', () => {
  const run = createRun();
  assertFailure(mutate(run, (record) => { record.schemaVersion = 'routelab.split-router-run.v2'; }), run.determinismHash, {
    code: 'unsupported-canonical-split-run-version', actual: 'routelab.split-router-run.v2',
  });
  assertFailure(mutate(run, (record) => { record.snapshot.content.schemaVersion = 'routelab.snapshot.v2'; }), run.determinismHash, {
    code: 'unsupported-canonical-split-snapshot-version', actual: 'routelab.snapshot.v2',
  });

  const invalidSnapshot = parseAndVerifyCanonicalSplitRouterRun(
    mutate(run, (record) => {
      record.snapshot.content.pools[0].reserve0 = '0';
      record.request.amountIn = '01';
    }),
    run.determinismHash,
  );
  assert.equal(invalidSnapshot.ok, false);
  if (!invalidSnapshot.ok) assert.equal(invalidSnapshot.error.code, 'invalid-canonical-split-run-snapshot');

  assertFailure(mutate(run, (record) => { record.request.amountIn = '01'; }), run.determinismHash, {
    code: 'invalid-canonical-split-run-request-shape', path: '$.request.amountIn',
  });
  assertFailure(mutate(run, (record) => { record.control.maxPathExpansions = 1.5; }), run.determinismHash, {
    code: 'invalid-canonical-split-run-control-shape', path: '$.control.maxPathExpansions',
  });

  for (const change of [
    (record: MutableRecord) => { record.result.plan.receipt.amountOut = '65'; },
    (record: MutableRecord) => { record.result.plan.receipt.legs[0].allocation = '49'; },
    (record: MutableRecord) => { record.result.plan.receipt.legs[0].receipt.hops[0].amountOut = '32'; },
    (record: MutableRecord) => { record.result.plan.search.counters.finalAuthorizationReplays = 0; },
    (record: MutableRecord) => { record.result.plan.search.termination = 'work-limit'; },
  ]) {
    assertFailure(mutate(run, change), run.determinismHash, {
      code: 'canonical-split-run-replay-mismatch',
    });
  }

  assertFailure(run.canonicalJson, `sha256:${'0'.repeat(64)}`, {
    code: 'canonical-split-run-hash-mismatch',
    expected: run.determinismHash,
    actual: `sha256:${'0'.repeat(64)}`,
  });
  assertFailure(` ${run.canonicalJson}`, run.determinismHash, {
    code: 'canonical-split-run-replay-mismatch',
  });
  const reordered = JSON.parse(run.canonicalJson) as MutableRecord;
  const reorderedJson = JSON.stringify({ result: reordered.result, schemaVersion: reordered.schemaVersion, snapshot: reordered.snapshot, request: reordered.request, control: reordered.control });
  assertFailure(reorderedJson, run.determinismHash, { code: 'canonical-split-run-replay-mismatch' });
});
