import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  resumeExactInputSinglePath,
  resumeExactInputSinglePathWithDeadline,
  routeExactInputSinglePathResumable,
  routeExactInputSinglePathWithDeadline,
  type ExactInputSinglePathDeadlineControl,
  type ExactInputSinglePathDeadlineResult,
  type ExactInputSinglePathResumableCheckpoint,
  type ExactInputSinglePathResumableResult,
  type ExactInputSinglePathRouterRequest,
} from '../src/router/single-path/index.ts';

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
): ConstantProductPool {
  return {
    poolId,
    asset0,
    reserve0,
    asset1,
    reserve1,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  return {
    snapshotId: 'deadline-snapshot',
    snapshotChecksum: 'deadline-checksum',
    pools,
  };
}

function request(
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'deadline-snapshot',
    snapshotChecksum: 'deadline-checksum',
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 2,
    maxExpansions: 100,
    ...overrides,
  };
}

function routingGraph(): LiquiditySnapshot {
  return snapshot([
    pool('a-direct-ac', 'A', 1_000n, 'C', 1_000n),
    pool('b-hop-ab', 'A', 1_000n, 'B', 2_000n),
    pool('c-hop-bc', 'B', 2_000n, 'C', 2_000n),
  ]);
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

function tokenFrom(
  result: ExactInputSinglePathDeadlineResult | ExactInputSinglePathResumableResult,
): ExactInputSinglePathResumableCheckpoint {
  assert.equal('checkpoint' in result, true);
  if (!('checkpoint' in result) || result.checkpoint === null) {
    throw new Error('expected a paused checkpoint');
  }
  return result.checkpoint;
}

function expectedDeadlineProjection(
  inner: ExactInputSinglePathResumableResult,
): unknown {
  if (inner.status === 'success') {
    return {
      status: 'success',
      plan: {
        receipt: inner.plan.receipt,
        search: {
          ...inner.plan.search,
          termination:
            inner.plan.search.termination === 'interrupted'
              ? 'deadline'
              : inner.plan.search.termination,
        },
      },
      checkpoint: inner.checkpoint,
    };
  }
  if (inner.status === 'no-route') return inner;
  if (inner.status === 'no-plan') {
    return {
      status: 'no-plan',
      reason: inner.reason === 'interrupted' ? 'deadline' : inner.reason,
      search: {
        ...inner.search,
        termination: inner.search.termination === 'interrupted' ? 'deadline' : inner.search.termination,
      },
      checkpoint: inner.checkpoint,
    };
  }
  return inner;
}

void test('forces deadline at every eligible boundary with exact cumulative state', () => {
  for (let boundary = 0; boundary <= 3; boundary += 1) {
    let deadlineReads = 0;
    let clockReads = 0;
    let clockCalls = 0;
    const actual = routeExactInputSinglePathWithDeadline(
      routingGraph(),
      request(),
      {
        get deadlineNanoseconds() {
          deadlineReads += 1;
          return 100n;
        },
        get nowNanoseconds() {
          clockReads += 1;
          return () => {
            const sample = clockCalls < boundary ? 99n : 100n;
            clockCalls += 1;
            return sample;
          };
        },
      },
    );
    const expected = routeExactInputSinglePathResumable(
      routingGraph(),
      request(),
      {
        shouldInterrupt(checkpoint) {
          return checkpoint.expansions === boundary;
        },
      },
    );

    assert.deepEqual(actual, expectedDeadlineProjection(expected));
    assert.equal(deadlineReads, 1);
    assert.equal(clockReads, 1);
    assert.equal(clockCalls, boundary + 1);
    assert.notEqual(tokenFrom(actual), null);
    assertDeepFrozen(actual);
  }
});

void test('uses equality as reached, continues below, and supports huge bigint samples', () => {
  const equal = routeExactInputSinglePathWithDeadline(routingGraph(), request(), {
    deadlineNanoseconds: 10n ** 80n,
    nowNanoseconds: () => 10n ** 80n,
  });
  assert.equal(equal.status, 'no-plan');
  if (equal.status === 'no-plan') {
    assert.equal(equal.reason, 'deadline');
    assert.equal(equal.search.expansions, 0);
  }

  const greater = routeExactInputSinglePathWithDeadline(routingGraph(), request(), {
    deadlineNanoseconds: 10n ** 80n,
    nowNanoseconds: () => 10n ** 80n + 1n,
  });
  assert.deepEqual(greater, equal);

  let calls = 0;
  const below = routeExactInputSinglePathWithDeadline(routingGraph(), request(), {
    deadlineNanoseconds: 10n ** 80n,
    nowNanoseconds() {
      calls += 1;
      return 10n ** 80n - 1n;
    },
  });
  assert.equal(below.status, 'success');
  if (below.status === 'success') {
    assert.equal(below.plan.search.termination, 'complete');
    assert.equal(below.plan.search.expansions, 4);
    assert.equal(below.plan.receipt.amountOut, 165n);
    assert.equal(below.checkpoint, null);
  }
  assert.equal(calls, 4);
});

void test('keeps invalid, complete, and work-limit precedence ahead of timing access', () => {
  let reads = 0;
  const unreadControl = {
    get deadlineNanoseconds(): bigint {
      reads += 1;
      throw new Error('must remain lazy');
    },
    get nowNanoseconds(): () => bigint {
      reads += 1;
      throw new Error('must remain lazy');
    },
  };

  const invalid = routeExactInputSinglePathWithDeadline(
    routingGraph(),
    request({ amountIn: 0n }),
    unreadControl,
  );
  assert.equal(invalid.status, 'invalid-request');
  assert.equal(reads, 0);

  const zeroCap = routeExactInputSinglePathWithDeadline(
    routingGraph(),
    request({ maxExpansions: 0 }),
    unreadControl,
  );
  assert.equal(zeroCap.status, 'no-plan');
  if (zeroCap.status === 'no-plan') assert.equal(zeroCap.reason, 'work-limit');
  assert.equal(reads, 0);

  let boundedCalls = 0;
  const bounded = routeExactInputSinglePathWithDeadline(
    routingGraph(),
    request({ maxExpansions: 3 }),
    {
      deadlineNanoseconds: 100n,
      nowNanoseconds() {
        boundedCalls += 1;
        return 99n;
      },
    },
  );
  assert.equal(bounded.status, 'success');
  if (bounded.status === 'success') {
    assert.equal(bounded.plan.search.termination, 'work-limit');
    assert.equal(bounded.plan.search.expansions, 3);
  }
  assert.equal(boundedCalls, 3);

  let completionCalls = 0;
  const complete = routeExactInputSinglePathWithDeadline(
    snapshot([pool('direct-ac', 'A', 1_000n, 'C', 1_000n)]),
    request({ maxHops: 1, maxExpansions: 1 }),
    {
      deadlineNanoseconds: 100n,
      nowNanoseconds() {
        completionCalls += 1;
        return 99n;
      },
    },
  );
  assert.equal(complete.status, 'success');
  if (complete.status === 'success') assert.equal(complete.plan.search.termination, 'complete');
  assert.equal(completionCalls, 1);
});

void test('validates deadline before clock capture with frozen prose-free errors', () => {
  const invalidControls = [
    {
      get deadlineNanoseconds(): bigint {
        throw new Error('private deadline prose');
      },
      nowNanoseconds: () => 0n,
    },
    {
      deadlineNanoseconds: 1 as unknown as bigint,
      nowNanoseconds: () => 0n,
    },
    {
      deadlineNanoseconds: -1n,
      nowNanoseconds: () => 0n,
    },
  ];

  for (const candidate of invalidControls) {
    let clockReads = 0;
    const control = {
      get deadlineNanoseconds() {
        return candidate.deadlineNanoseconds;
      },
      get nowNanoseconds() {
        clockReads += 1;
        return candidate.nowNanoseconds;
      },
    };
    const result = routeExactInputSinglePathWithDeadline(
      routingGraph(),
      request(),
      control,
    );
    assert.deepEqual(result, {
      status: 'deadline-error',
      error: {
        code: 'invalid-deadline-nanoseconds',
        field: 'deadlineNanoseconds',
      },
    });
    assert.equal(clockReads, 0);
    assert.equal('checkpoint' in result, false);
    assertDeepFrozen(result);
  }
});

void test('maps clock capture, invocation, sample, and regression defects atomically', () => {
  const clockFailures: readonly ExactInputSinglePathDeadlineControl[] = [
    {
      deadlineNanoseconds: 10n,
      get nowNanoseconds(): () => bigint {
        throw new Error('private clock getter prose');
      },
    },
    {
      deadlineNanoseconds: 10n,
      nowNanoseconds: 1 as unknown as () => bigint,
    },
    {
      deadlineNanoseconds: 10n,
      nowNanoseconds() {
        throw new Error('private clock invocation prose');
      },
    },
    {
      deadlineNanoseconds: 10n,
      nowNanoseconds: () => 1 as unknown as bigint,
    },
    {
      deadlineNanoseconds: 10n,
      nowNanoseconds: () => -1n,
    },
  ];

  for (const control of clockFailures) {
    const result = routeExactInputSinglePathWithDeadline(
      routingGraph(),
      request(),
      control,
    );
    assert.deepEqual(result, {
      status: 'deadline-error',
      error: { code: 'deadline-clock-failed', field: 'nowNanoseconds' },
    });
    assert.equal('checkpoint' in result, false);
    assertDeepFrozen(result);
  }

  const samples = [1n, 2n, 1n];
  const regressed = routeExactInputSinglePathWithDeadline(
    routingGraph(),
    request(),
    {
      deadlineNanoseconds: 100n,
      nowNanoseconds() {
        return samples.shift()!;
      },
    },
  );
  assert.deepEqual(regressed, {
    status: 'deadline-error',
    error: { code: 'deadline-clock-regressed', field: 'nowNanoseconds' },
  });
  assert.equal('checkpoint' in regressed, false);
  assertDeepFrozen(regressed);
});

void test('enforces token and cap precedence before lazy deadline access on resume', () => {
  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  let reads = 0;
  const unreadControl = {
    get deadlineNanoseconds(): bigint {
      reads += 1;
      throw new Error('must not be read');
    },
    get nowNanoseconds(): () => bigint {
      reads += 1;
      throw new Error('must not be read');
    },
  };

  const forged = resumeExactInputSinglePathWithDeadline(
    { ...source },
    Number.NaN,
    unreadControl,
  );
  assert.deepEqual(forged, {
    status: 'invalid-resume',
    error: { code: 'invalid-router-checkpoint', field: 'checkpoint' },
  });
  assert.equal(reads, 0);

  for (const cap of [Number.NaN, -1, 0]) {
    const invalidCap = resumeExactInputSinglePathWithDeadline(
      source,
      cap,
      unreadControl,
    );
    assert.deepEqual(invalidCap, {
      status: 'invalid-resume',
      error: {
        code: 'invalid-resume-max-expansions',
        field: 'maxExpansions',
      },
    });
    assert.equal(reads, 0);
  }

  const equalCap = resumeExactInputSinglePathWithDeadline(source, 1, unreadControl);
  assert.equal(equalCap.status, 'success');
  if (equalCap.status === 'success') {
    assert.equal(equalCap.plan.search.termination, 'work-limit');
  }
  const equalToken = tokenFrom(equalCap);
  assert.notEqual(equalToken, source);
  assert.deepEqual(equalToken, source);
  assert.equal(reads, 0);
});

void test('deadline tokens resume through either API and immediate expiry returns a fresh token', () => {
  let clockCalls = 0;
  const paused = routeExactInputSinglePathWithDeadline(
    routingGraph(),
    request(),
    {
      deadlineNanoseconds: 1n,
      nowNanoseconds() {
        const result = clockCalls === 0 ? 0n : 1n;
        clockCalls += 1;
        return result;
      },
    },
  );
  assert.equal(paused.status, 'success');
  if (paused.status === 'success') {
    assert.equal(paused.plan.search.termination, 'deadline');
    assert.equal(paused.plan.search.expansions, 1);
  }
  const deadlineToken = tokenFrom(paused);
  const ordinaryComplete = resumeExactInputSinglePath(deadlineToken, 4, {
    shouldInterrupt: () => false,
  });
  assert.equal(ordinaryComplete.status, 'success');
  if (ordinaryComplete.status === 'success') {
    assert.equal(ordinaryComplete.plan.search.termination, 'complete');
    assert.equal(ordinaryComplete.plan.receipt.amountOut, 165n);
  }

  const expiredAgain = resumeExactInputSinglePathWithDeadline(
    deadlineToken,
    4,
    { deadlineNanoseconds: 0n, nowNanoseconds: () => 0n },
  );
  assert.equal(expiredAgain.status, 'success');
  if (expiredAgain.status === 'success') {
    assert.equal(expiredAgain.plan.search.termination, 'deadline');
  }
  const freshToken = tokenFrom(expiredAgain);
  assert.notEqual(freshToken, deadlineToken);
  assert.deepEqual(freshToken, deadlineToken);

  const deadlineComplete = resumeExactInputSinglePathWithDeadline(
    deadlineToken,
    4,
    { deadlineNanoseconds: 100n, nowNanoseconds: () => 1n },
  );
  assert.deepEqual(deadlineComplete, expectedDeadlineProjection(ordinaryComplete));
});

void test('deadline failures after progress discard the branch and preserve source reuse', () => {
  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const sourceBefore = structuredClone(source);
  const samples = [5n, 4n];
  const failed = resumeExactInputSinglePathWithDeadline(
    source,
    4,
    {
      deadlineNanoseconds: 100n,
      nowNanoseconds() {
        return samples.shift()!;
      },
    },
  );
  assert.deepEqual(failed, {
    status: 'deadline-error',
    error: { code: 'deadline-clock-regressed', field: 'nowNanoseconds' },
  });
  assert.equal('checkpoint' in failed, false);
  assert.deepEqual(source, sourceBefore);

  const recovered = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  assert.equal(recovered.status, 'success');
  if (recovered.status === 'success') {
    assert.equal(recovered.plan.search.termination, 'complete');
    assert.equal(recovered.plan.receipt.amountOut, 165n);
  }
});

void test('captures deadline then standalone clock once and resists mutation and reentrancy', () => {
  const inputSnapshot = routingGraph();
  const inputRequest = request();
  const accessOrder: string[] = [];
  let nested: ExactInputSinglePathResumableResult | undefined;
  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const mutableControl: {
    deadlineNanoseconds: bigint;
    nowNanoseconds: () => bigint;
  } = {
    deadlineNanoseconds: 100n,
    nowNanoseconds: () => 99n,
  };
  const control: ExactInputSinglePathDeadlineControl = {
    get deadlineNanoseconds() {
      accessOrder.push('deadline');
      const mutableSnapshot = inputSnapshot as unknown as {
        snapshotId: string;
        pools: ConstantProductPool[];
      };
      const mutableRequest = inputRequest as unknown as { amountIn: bigint };
      mutableSnapshot.snapshotId = 'mutated';
      mutableSnapshot.pools = [pool('mutated', 'A', 1n, 'C', 1n)];
      mutableRequest.amountIn = 1n;
      return mutableControl.deadlineNanoseconds;
    },
    get nowNanoseconds() {
      accessOrder.push('clock');
      return function (this: unknown): bigint {
        assert.equal(this, undefined);
        accessOrder.push('sample');
        mutableControl.deadlineNanoseconds = 0n;
        mutableControl.nowNanoseconds = () => 200n;
        if (nested === undefined) {
          nested = resumeExactInputSinglePath(source, 2, {
            shouldInterrupt: () => false,
          });
        }
        return 99n;
      };
    },
  };

  const actual = routeExactInputSinglePathWithDeadline(
    inputSnapshot,
    inputRequest,
    control,
  );
  assert.equal(actual.status, 'success');
  if (actual.status === 'success') {
    assert.equal(actual.plan.search.termination, 'complete');
    assert.equal(actual.plan.receipt.amountIn, 100n);
    assert.equal(actual.plan.receipt.amountOut, 165n);
  }
  assert.deepEqual(accessOrder.slice(0, 3), ['deadline', 'clock', 'sample']);
  assert.equal(accessOrder.filter((entry) => entry === 'deadline').length, 1);
  assert.equal(accessOrder.filter((entry) => entry === 'clock').length, 1);
  assert.equal(accessOrder.filter((entry) => entry === 'sample').length, 4);
  assert.notEqual(nested, undefined);
  assertDeepFrozen(actual);
});

void test('does not carry regression state or timing configuration across resume tokens', () => {
  const source = tokenFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const atTwo = resumeExactInputSinglePathWithDeadline(
    source,
    2,
    { deadlineNanoseconds: 1_000n, nowNanoseconds: () => 900n },
  );
  assert.equal(atTwo.status, 'success');
  if (atTwo.status === 'success') assert.equal(atTwo.plan.search.termination, 'work-limit');
  const atTwoToken = tokenFrom(atTwo);

  const atThree = resumeExactInputSinglePathWithDeadline(
    atTwoToken,
    3,
    { deadlineNanoseconds: 10n, nowNanoseconds: () => 0n },
  );
  assert.equal(atThree.status, 'success');
  if (atThree.status === 'success') {
    assert.equal(atThree.plan.search.termination, 'work-limit');
    assert.equal(atThree.plan.search.expansions, 3);
  }
  const token = tokenFrom(atThree);
  assert.deepEqual(Object.keys(token), [
    'kind',
    'snapshotId',
    'snapshotChecksum',
    'assetIn',
    'assetOut',
    'amountIn',
    'maxHops',
    'expansions',
    'enumeratedCandidates',
    'replayedCandidates',
    'rejectedCandidates',
    'incumbent',
  ]);
  assert.equal('deadlineNanoseconds' in token, false);
  assert.equal('nowNanoseconds' in token, false);
  assert.equal('previousSample' in token, false);
  assertDeepFrozen(token);
});
