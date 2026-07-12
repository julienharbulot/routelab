import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  resumeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  routeExactInputSinglePathResumable,
  type ExactInputSinglePathInterruptionCheckpoint,
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
    snapshotId: 'resumable-snapshot',
    snapshotChecksum: 'resumable-checksum',
    pools,
  };
}

function request(
  overrides: Partial<ExactInputSinglePathRouterRequest> = {},
): ExactInputSinglePathRouterRequest {
  return {
    snapshotId: 'resumable-snapshot',
    snapshotChecksum: 'resumable-checksum',
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

function checkpointFrom(
  result: ExactInputSinglePathResumableResult,
): ExactInputSinglePathResumableCheckpoint {
  assert.equal('checkpoint' in result, true);
  if (!('checkpoint' in result) || result.checkpoint === null) {
    throw new Error('expected a resumable checkpoint');
  }
  return result.checkpoint;
}

function withoutCheckpoint(result: ExactInputSinglePathResumableResult): unknown {
  if (!('checkpoint' in result)) return result;
  const outcome = { ...result } as Record<string, unknown>;
  delete outcome['checkpoint'];
  return outcome;
}

function allNonemptySubsets(values: readonly number[]): readonly (readonly number[])[] {
  const result: number[][] = [];
  for (let mask = 1; mask < 1 << values.length; mask += 1) {
    result.push(values.filter((_value, index) => (mask & (1 << index)) !== 0));
  }
  return result;
}

void test('matches one-shot cumulative outcomes across every expansion partition', () => {
  const inputSnapshot = routingGraph();
  const oneShotByCap = new Map<number, ExactInputSinglePathResumableResult>();
  for (let cap = 0; cap <= 4; cap += 1) {
    oneShotByCap.set(
      cap,
      routeExactInputSinglePathResumable(
        inputSnapshot,
        request({ maxExpansions: cap }),
        { shouldInterrupt: () => false },
      ),
    );
  }

  for (const prefix of allNonemptySubsets([0, 1, 2, 3])) {
    const caps = [...prefix, 4];
    const initialCap = caps[0]!;
    let actual = routeExactInputSinglePathResumable(
      inputSnapshot,
      request({ maxExpansions: initialCap }),
      { shouldInterrupt: () => false },
    );
    assert.deepEqual(withoutCheckpoint(actual), withoutCheckpoint(oneShotByCap.get(initialCap)!));

    for (const cap of caps.slice(1)) {
      actual = resumeExactInputSinglePath(checkpointFrom(actual), cap, {
        shouldInterrupt: () => false,
      });
      assert.deepEqual(withoutCheckpoint(actual), withoutCheckpoint(oneShotByCap.get(cap)!));
    }
  }

  const complete = oneShotByCap.get(4);
  assert.equal(complete?.status, 'success');
  if (complete?.status !== 'success') return;
  assert.equal(complete.plan.search.termination, 'complete');
  assert.equal(complete.plan.search.expansions, 4);
  assert.equal(complete.plan.receipt.amountOut, 165n);
  assert.equal(complete.checkpoint, null);
});

void test('preserves the interruptible API outcome at every reachable boundary', () => {
  for (let cap = 0; cap <= 5; cap += 1) {
    const inputRequest = request({ maxExpansions: cap });
    const expected = routeExactInputSinglePathInterruptible(
      routingGraph(),
      inputRequest,
      { shouldInterrupt: () => false },
    );
    const actual = routeExactInputSinglePathResumable(
      routingGraph(),
      inputRequest,
      { shouldInterrupt: () => false },
    );
    assert.deepEqual(withoutCheckpoint(actual), expected);
  }

  for (let boundary = 0; boundary <= 3; boundary += 1) {
    const control = {
      shouldInterrupt(checkpoint: ExactInputSinglePathInterruptionCheckpoint) {
        return checkpoint.expansions === boundary;
      },
    };
    const expected = routeExactInputSinglePathInterruptible(
      routingGraph(),
      request(),
      control,
    );
    const actual = routeExactInputSinglePathResumable(
      routingGraph(),
      request(),
      control,
    );
    assert.deepEqual(withoutCheckpoint(actual), expected);
  }
});

void test('reuses and branches tokens without consuming or cross-mutating them', () => {
  const initial = routeExactInputSinglePathResumable(
    routingGraph(),
    request({ maxExpansions: 1 }),
    { shouldInterrupt: () => false },
  );
  const source = checkpointFrom(initial);
  const sourceBefore = structuredClone(source);

  const branchAtTwo = resumeExactInputSinglePath(source, 2, {
    shouldInterrupt: () => false,
  });
  const branchAtFour = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  const repeatAtFour = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });

  assert.deepEqual(source, sourceBefore);
  assert.notEqual(checkpointFrom(branchAtTwo), source);
  assert.deepEqual(branchAtFour, repeatAtFour);
  assert.equal(branchAtFour.status, 'success');
  if (branchAtFour.status === 'success') {
    assert.equal(branchAtFour.plan.search.termination, 'complete');
    assert.equal(branchAtFour.plan.receipt.amountOut, 165n);
    assert.equal(branchAtFour.checkpoint, null);
  }

  const branchAtThree = resumeExactInputSinglePath(checkpointFrom(branchAtTwo), 3, {
    shouldInterrupt: () => false,
  });
  const completedViaBranch = resumeExactInputSinglePath(checkpointFrom(branchAtThree), 4, {
    shouldInterrupt: () => false,
  });
  assert.deepEqual(completedViaBranch, branchAtFour);

  const reverseOrderSource = checkpointFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const reverseAtFour = resumeExactInputSinglePath(reverseOrderSource, 4, {
    shouldInterrupt: () => false,
  });
  const reverseAtTwo = resumeExactInputSinglePath(reverseOrderSource, 2, {
    shouldInterrupt: () => false,
  });
  assert.deepEqual(reverseAtFour, branchAtFour);
  assert.deepEqual(withoutCheckpoint(reverseAtTwo), withoutCheckpoint(branchAtTwo));
  assertDeepFrozen(source);
  assertDeepFrozen(branchAtTwo);
});

void test('returns fresh token identities at equal-cap and immediately interrupted boundaries', () => {
  const initial = routeExactInputSinglePathResumable(
    routingGraph(),
    request({ maxExpansions: 1 }),
    { shouldInterrupt: () => false },
  );
  const source = checkpointFrom(initial);
  let equalCapControlReads = 0;
  const equalCap = resumeExactInputSinglePath(source, 1, {
    get shouldInterrupt(): (
      checkpoint: ExactInputSinglePathInterruptionCheckpoint,
    ) => boolean {
      equalCapControlReads += 1;
      throw new Error('equal cap must win before control capture');
    },
  });
  const equalCapToken = checkpointFrom(equalCap);
  assert.equal(equalCapControlReads, 0);
  assert.notEqual(equalCapToken, source);
  assert.deepEqual(equalCapToken, source);
  assert.equal(equalCap.status, 'success');
  if (equalCap.status === 'success') {
    assert.equal(equalCap.plan.search.termination, 'work-limit');
  }

  const resumedBoundaries: number[] = [];
  const immediate = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt(checkpoint) {
      resumedBoundaries.push(checkpoint.expansions);
      return true;
    },
  });
  const immediateToken = checkpointFrom(immediate);
  assert.deepEqual(resumedBoundaries, [1]);
  assert.notEqual(immediateToken, source);
  assert.deepEqual(immediateToken, source);
  assert.equal(immediate.status, 'success');
  if (immediate.status === 'success') {
    assert.equal(immediate.plan.search.termination, 'interrupted');
  }
});

void test('brands tokens by identity and rejects token or cap defects before control access', () => {
  const source = checkpointFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
  const lookalike = { ...source } as ExactInputSinglePathResumableCheckpoint;
  const cloned = structuredClone(source);
  const jsonValue = JSON.parse(
    JSON.stringify(source, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as ExactInputSinglePathResumableCheckpoint;
  const proxied = new Proxy(source, {});
  const invalidTokens = [
    lookalike,
    cloned,
    jsonValue,
    proxied,
    null as unknown as ExactInputSinglePathResumableCheckpoint,
    1 as unknown as ExactInputSinglePathResumableCheckpoint,
  ];

  for (const checkpoint of invalidTokens) {
    let controlReads = 0;
    const result = resumeExactInputSinglePath(checkpoint, Number.NaN, {
      get shouldInterrupt() {
        controlReads += 1;
        return () => false;
      },
    });
    assert.deepEqual(result, {
      status: 'invalid-resume',
      error: { code: 'invalid-router-checkpoint', field: 'checkpoint' },
    });
    assert.equal(controlReads, 0);
    assertDeepFrozen(result);
  }

  for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 2 ** 53, 0]) {
    let controlReads = 0;
    const result = resumeExactInputSinglePath(source, cap, {
      get shouldInterrupt() {
        controlReads += 1;
        return () => false;
      },
    });
    assert.deepEqual(result, {
      status: 'invalid-resume',
      error: { code: 'invalid-resume-max-expansions', field: 'maxExpansions' },
    });
    assert.equal(controlReads, 0);
    assertDeepFrozen(result);
  }
});

void test('obeys checkpoint presence rules for every termination class', () => {
  const noPlanWorkLimit = routeExactInputSinglePathResumable(
    routingGraph(),
    request({ maxExpansions: 0 }),
    { shouldInterrupt: () => false },
  );
  assert.equal(noPlanWorkLimit.status, 'no-plan');
  assert.notEqual(checkpointFrom(noPlanWorkLimit), null);

  const noPlanInterrupted = routeExactInputSinglePathResumable(
    routingGraph(),
    request(),
    { shouldInterrupt: () => true },
  );
  assert.equal(noPlanInterrupted.status, 'no-plan');
  assert.notEqual(checkpointFrom(noPlanInterrupted), null);

  const successWorkLimit = routeExactInputSinglePathResumable(
    routingGraph(),
    request({ maxExpansions: 1 }),
    { shouldInterrupt: () => false },
  );
  assert.equal(successWorkLimit.status, 'success');
  assert.notEqual(checkpointFrom(successWorkLimit), null);

  const successComplete = routeExactInputSinglePathResumable(
    snapshot([pool('direct-ac', 'A', 1_000n, 'C', 1_000n)]),
    request({ maxHops: 1, maxExpansions: 1 }),
    { shouldInterrupt: () => false },
  );
  assert.equal(successComplete.status, 'success');
  if (successComplete.status === 'success') assert.equal(successComplete.checkpoint, null);

  const disconnected = snapshot([
    pool('component-ab', 'A', 1_000n, 'B', 1_000n),
    pool('component-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const noRouteComplete = routeExactInputSinglePathResumable(
    disconnected,
    request({ assetOut: 'D' }),
    { shouldInterrupt: () => false },
  );
  assert.equal(noRouteComplete.status, 'no-route');
  if (noRouteComplete.status === 'no-route') assert.equal(noRouteComplete.checkpoint, null);

  let invalidControlReads = 0;
  const invalidRequest = routeExactInputSinglePathResumable(
    routingGraph(),
    request({ amountIn: 0n }),
    {
      get shouldInterrupt() {
        invalidControlReads += 1;
        return () => false;
      },
    },
  );
  assert.equal(invalidRequest.status, 'invalid-request');
  assert.equal('checkpoint' in invalidRequest, false);
  assert.equal(invalidControlReads, 0);

  const controlError = routeExactInputSinglePathResumable(routingGraph(), request(), {
    shouldInterrupt() {
      throw new Error('private callback prose');
    },
  });
  assert.deepEqual(controlError, {
    status: 'control-error',
    error: { code: 'interruption-check-failed' },
  });
  assert.equal('checkpoint' in controlError, false);
  assertDeepFrozen(controlError);
});

void test('captures resume control once and discards partial work on control failure', () => {
  const source = checkpointFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );

  const getterFailure = resumeExactInputSinglePath(source, 4, {
    get shouldInterrupt(): (
      checkpoint: ExactInputSinglePathInterruptionCheckpoint,
    ) => boolean {
      throw new Error('private getter prose');
    },
  });
  assert.deepEqual(getterFailure, {
    status: 'control-error',
    error: { code: 'interruption-check-failed' },
  });

  let reads = 0;
  let calls = 0;
  const invocationFailure = resumeExactInputSinglePath(source, 4, {
    get shouldInterrupt() {
      reads += 1;
      return () => {
        calls += 1;
        if (calls === 2) throw new Error('private invocation prose');
        return false;
      };
    },
  });
  assert.deepEqual(invocationFailure, getterFailure);
  assert.equal(reads, 1);
  assert.equal(calls, 2);
  assert.equal('checkpoint' in invocationFailure, false);

  const recovered = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt: () => false,
  });
  assert.equal(recovered.status, 'success');
  if (recovered.status === 'success') {
    assert.equal(recovered.plan.search.termination, 'complete');
    assert.equal(recovered.plan.receipt.amountOut, 165n);
  }
});

void test('keeps captured snapshot and request immutable across caller mutation and reentrancy', () => {
  const inputSnapshot = routingGraph();
  const inputRequest = request({ maxExpansions: 1 });
  const source = checkpointFrom(
    routeExactInputSinglePathResumable(inputSnapshot, inputRequest, {
      shouldInterrupt: () => false,
    }),
  );

  const mutableSnapshot = inputSnapshot as unknown as {
    snapshotId: string;
    snapshotChecksum: string;
    pools: ConstantProductPool[];
  };
  const mutableRequest = inputRequest as unknown as {
    snapshotId: string;
    snapshotChecksum: string;
    assetIn: string;
    assetOut: string;
    amountIn: bigint;
    maxHops: number;
    maxExpansions: number;
  };
  mutableSnapshot.snapshotId = 'substituted-id';
  mutableSnapshot.snapshotChecksum = 'substituted-checksum';
  mutableSnapshot.pools = [pool('substituted', 'A', 1n, 'C', 1n)];
  mutableRequest.snapshotId = 'substituted-id';
  mutableRequest.snapshotChecksum = 'substituted-checksum';
  mutableRequest.assetIn = 'C';
  mutableRequest.assetOut = 'A';
  mutableRequest.amountIn = 1n;
  mutableRequest.maxHops = 1;
  mutableRequest.maxExpansions = 0;

  let nested: ExactInputSinglePathResumableResult | undefined;
  const actual = resumeExactInputSinglePath(source, 4, {
    shouldInterrupt(checkpoint) {
      if (nested === undefined && checkpoint.expansions === 1) {
        nested = resumeExactInputSinglePath(source, 2, {
          shouldInterrupt: () => false,
        });
      }
      return false;
    },
  });
  const expected = routeExactInputSinglePathResumable(
    routingGraph(),
    request({ maxExpansions: 4 }),
    { shouldInterrupt: () => false },
  );

  assert.deepEqual(actual, expected);
  assert.equal(actual.status, 'success');
  if (actual.status === 'success') {
    assert.equal(actual.plan.receipt.amountIn, 100n);
    assert.equal(actual.plan.receipt.amountOut, 165n);
  }
  assert.notEqual(nested, undefined);
  assert.deepEqual(
    withoutCheckpoint(nested!),
    withoutCheckpoint(
      routeExactInputSinglePathResumable(
        routingGraph(),
        request({ maxExpansions: 2 }),
        { shouldInterrupt: () => false },
      ),
    ),
  );
  assertDeepFrozen(actual);
});

void test('exposes only the frozen public token contract in canonical field order', () => {
  const token = checkpointFrom(
    routeExactInputSinglePathResumable(
      routingGraph(),
      request({ maxExpansions: 1 }),
      { shouldInterrupt: () => false },
    ),
  );
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
  assert.equal(token.kind, 'routelab.in-memory-router-checkpoint.v1');
  assert.equal('maxExpansions' in token, false);
  assert.equal('frontier' in token, false);
  assert.equal('snapshot' in token, false);
  assert.equal('request' in token, false);
  assertDeepFrozen(token);
});
