import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import type { ExactInputSinglePathRouterRequest } from '../src/router/single-path/index.ts';
import {
  createCanonicalSinglePathRouterRun,
  parseAndVerifyCanonicalSinglePathRouterRun,
  type CanonicalSinglePathRouterRun,
} from '../src/serialization/canonical-router-run/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

interface MutableCanonicalRecord {
  schemaVersion: unknown;
  snapshot: {
    snapshotId: unknown;
    snapshotChecksum: unknown;
    content: {
      schemaVersion: unknown;
      pools: unknown;
      [field: string]: unknown;
    };
    [field: string]: unknown;
  };
  request: {
    snapshotId: unknown;
    snapshotChecksum: unknown;
    assetIn: unknown;
    assetOut: unknown;
    amountIn: unknown;
    maxHops: unknown;
    maxExpansions: unknown;
    [field: string]: unknown;
  };
  result: unknown;
  [field: string]: unknown;
}

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
    maxHops: 2,
    maxExpansions: 100,
    ...overrides,
  };
}

function createRun(
  inputSnapshot: LiquiditySnapshot,
  inputRequest: ExactInputSinglePathRouterRequest,
): CanonicalSinglePathRouterRun {
  const result = createCanonicalSinglePathRouterRun(inputSnapshot, inputRequest);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('test input must create a canonical run');
  return result.value;
}

function decode(canonicalJson: string): MutableCanonicalRecord {
  return JSON.parse(canonicalJson) as MutableCanonicalRecord;
}

function mutate(
  run: CanonicalSinglePathRouterRun,
  mutation: (record: MutableCanonicalRecord) => void,
): string {
  const record = decode(run.canonicalJson);
  mutation(record);
  return JSON.stringify(record);
}

function assertFailure(
  canonicalJson: string,
  determinismHash: string,
  expected: object,
): void {
  const result = parseAndVerifyCanonicalSinglePathRouterRun(canonicalJson, determinismHash);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.error, expected);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.equal('value' in result, false);
}

function directSuccessRun(amountIn = 100n): CanonicalSinglePathRouterRun {
  const inputSnapshot = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  return createRun(inputSnapshot, request(inputSnapshot, { amountIn }));
}

void test('round-trips success, no-route, no-plan, and huge exact records by fresh replay', () => {
  const success = directSuccessRun();
  const disconnected = snapshot([
    pool('pool-ab', 'A', 1_000n, 'B', 1_000n),
    pool('pool-cd', 'C', 1_000n, 'D', 1_000n),
  ]);
  const noRoute = createRun(disconnected, request(disconnected));
  const routable = snapshot([pool('pool-ac', 'A', 1_000n, 'C', 1_000n)]);
  const noPlan = createRun(routable, request(routable, { maxExpansions: 0 }));
  const huge = 10n ** 80n;
  const hugeSnapshot = snapshot([pool('huge-ac', 'A', huge, 'C', huge * 2n)]);
  const hugeRun = createRun(hugeSnapshot, request(hugeSnapshot, { amountIn: huge }));

  for (const run of [success, noRoute, noPlan, hugeRun]) {
    const result = parseAndVerifyCanonicalSinglePathRouterRun(
      run.canonicalJson,
      run.determinismHash,
    );
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.deepEqual(result.value, run);
    assert.notEqual(result.value, run);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.value), true);
    assert.equal(Object.isFrozen(result.value.routerResult), true);
  }
});

void test('rejects malformed JSON and strict root shape in deterministic paths', () => {
  const run = directSuccessRun();

  assertFailure('{', run.determinismHash, { code: 'invalid-canonical-run-json' });
  for (const invalidRoot of [null, [], 'record', 1, true]) {
    assertFailure(JSON.stringify(invalidRoot), run.determinismHash, {
      code: 'invalid-canonical-run-shape',
      path: '$',
    });
  }

  const cases: readonly {
    readonly json: string;
    readonly path: string;
  }[] = [
    {
      json: mutate(run, (record) => {
        delete record.schemaVersion;
      }),
      path: '$.schemaVersion',
    },
    {
      json: mutate(run, (record) => {
        delete record.result;
      }),
      path: '$.result',
    },
    {
      json: mutate(run, (record) => {
        record['extra'] = true;
      }),
      path: '$.extra',
    },
    {
      json: mutate(run, (record) => {
        record.schemaVersion = 1;
      }),
      path: '$.schemaVersion',
    },
    {
      json: mutate(run, (record) => {
        record.snapshot = null as unknown as MutableCanonicalRecord['snapshot'];
      }),
      path: '$.snapshot',
    },
  ];

  for (const current of cases) {
    assertFailure(current.json, run.determinismHash, {
      code: 'invalid-canonical-run-shape',
      path: current.path,
    });
  }
});

void test('rejects every reconstructable snapshot and request container shape boundary', () => {
  const run = directSuccessRun();
  const cases: readonly {
    readonly path: string;
    readonly change: (record: MutableCanonicalRecord) => void;
  }[] = [
    {
      path: '$.snapshot.snapshotId',
      change: (record) => {
        delete record.snapshot.snapshotId;
      },
    },
    {
      path: '$.snapshot.snapshotChecksum',
      change: (record) => {
        record.snapshot.snapshotChecksum = 1;
      },
    },
    {
      path: '$.snapshot.extra',
      change: (record) => {
        record.snapshot['extra'] = true;
      },
    },
    {
      path: '$.snapshot.content',
      change: (record) => {
        record.snapshot.content = [] as unknown as MutableCanonicalRecord['snapshot']['content'];
      },
    },
    {
      path: '$.snapshot.content.schemaVersion',
      change: (record) => {
        delete record.snapshot.content.schemaVersion;
      },
    },
    {
      path: '$.snapshot.content.pools',
      change: (record) => {
        record.snapshot.content.pools = {};
      },
    },
    {
      path: '$.snapshot.content.extra',
      change: (record) => {
        record.snapshot.content['extra'] = true;
      },
    },
    {
      path: '$.request',
      change: (record) => {
        record.request = null as unknown as MutableCanonicalRecord['request'];
      },
    },
    {
      path: '$.request.assetOut',
      change: (record) => {
        delete record.request.assetOut;
      },
    },
    {
      path: '$.request.extra',
      change: (record) => {
        record.request['extra'] = true;
      },
    },
  ];

  for (const current of cases) {
    assertFailure(mutate(run, current.change), run.determinismHash, {
      code: 'invalid-canonical-run-shape',
      path: current.path,
    });
  }

  const wrongHashType = parseAndVerifyCanonicalSinglePathRouterRun(
    run.canonicalJson,
    42 as unknown as string,
  );
  assert.equal(wrongHashType.ok, false);
  if (!wrongHashType.ok) {
    assert.deepEqual(wrongHashType.error, {
      code: 'invalid-canonical-run-shape',
      path: '$.determinismHash',
    });
    assert.equal(Object.isFrozen(wrongHashType.error), true);
  }
});

void test('applies run version, snapshot version, and snapshot validation precedence', () => {
  const run = directSuccessRun();
  assertFailure(
    mutate(run, (record) => {
      record.schemaVersion = 'routelab.router-run.v2';
    }),
    run.determinismHash,
    {
      code: 'unsupported-canonical-run-version',
      actual: 'routelab.router-run.v2',
    },
  );
  assertFailure(
    mutate(run, (record) => {
      record.snapshot.content.schemaVersion = 'routelab.snapshot.v2';
    }),
    run.determinismHash,
    {
      code: 'unsupported-canonical-snapshot-version',
      actual: 'routelab.snapshot.v2',
    },
  );

  const invalidSnapshotJson = mutate(run, (record) => {
    const pools = record.snapshot.content.pools as Array<Record<string, unknown>>;
    const firstPool = pools[0];
    if (firstPool !== undefined) firstPool['reserve0'] = '0';
    record.request.amountIn = 0;
  });
  const invalidSnapshot = parseAndVerifyCanonicalSinglePathRouterRun(
    invalidSnapshotJson,
    run.determinismHash,
  );
  assert.equal(invalidSnapshot.ok, false);
  if (invalidSnapshot.ok) return;
  assert.equal(invalidSnapshot.error.code, 'invalid-canonical-run-snapshot');
  if (invalidSnapshot.error.code !== 'invalid-canonical-run-snapshot') return;
  assert.deepEqual(invalidSnapshot.error.errors, [
    {
      code: 'nonpositive-reserve',
      path: '$.pools[0].reserve0',
      message: 'reserve0 must be positive.',
    },
  ]);
  assert.equal(Object.isFrozen(invalidSnapshot.error.errors), true);
  assert.equal(invalidSnapshot.error.errors.every((error) => Object.isFrozen(error)), true);
});

void test('propagates checksum and semantic request errors while rejecting request encodings', () => {
  const run = directSuccessRun();
  const badChecksumJson = mutate(run, (record) => {
    record.snapshot.snapshotChecksum = 'supplied-wrong-checksum';
  });
  const checksumFailure = parseAndVerifyCanonicalSinglePathRouterRun(
    badChecksumJson,
    run.determinismHash,
  );
  assert.equal(checksumFailure.ok, false);
  if (checksumFailure.ok) return;
  assert.equal(checksumFailure.error.code, 'snapshot-checksum-mismatch');
  if (checksumFailure.error.code !== 'snapshot-checksum-mismatch') return;
  assert.match(checksumFailure.error.expected, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(checksumFailure.error.actual, 'supplied-wrong-checksum');
  assert.equal(Object.isFrozen(checksumFailure.error), true);

  const shapeCases: readonly { readonly field: string; readonly value: unknown }[] = [
    { field: 'snapshotId', value: 1 },
    { field: 'snapshotChecksum', value: null },
    { field: 'assetIn', value: false },
    { field: 'assetOut', value: [] },
    { field: 'amountIn', value: 100 },
    { field: 'amountIn', value: '0' },
    { field: 'amountIn', value: '01' },
    { field: 'amountIn', value: '+1' },
    { field: 'amountIn', value: '1e2' },
    { field: 'maxHops', value: 0 },
    { field: 'maxHops', value: 1.5 },
    { field: 'maxHops', value: Number.MAX_SAFE_INTEGER + 1 },
    { field: 'maxExpansions', value: -1 },
    { field: 'maxExpansions', value: Number.POSITIVE_INFINITY },
  ];
  for (const current of shapeCases) {
    const changed = mutate(run, (record) => {
      record.request[current.field] = current.value;
    });
    assertFailure(changed, run.determinismHash, {
      code: 'invalid-canonical-run-request-shape',
      path: `$.request.${current.field}`,
    });
  }

  assertFailure(
    mutate(run, (record) => {
      record.snapshot.snapshotChecksum = 'supplied-wrong-checksum';
      record.request.amountIn = 0;
    }),
    run.determinismHash,
    {
      code: 'invalid-canonical-run-request-shape',
      path: '$.request.amountIn',
    },
  );

  const semanticFailure = parseAndVerifyCanonicalSinglePathRouterRun(
    mutate(run, (record) => {
      record.request.assetIn = '';
    }),
    run.determinismHash,
  );
  assert.equal(semanticFailure.ok, false);
  if (semanticFailure.ok) return;
  assert.deepEqual(semanticFailure.error, {
    code: 'invalid-router-request',
    routerError: {
      code: 'empty-identifier',
      field: 'assetIn',
      message: 'request.assetIn must not be empty.',
    },
  });
  assert.equal(Object.isFrozen(semanticFailure.error), true);
  if (semanticFailure.error.code === 'invalid-router-request') {
    assert.equal(Object.isFrozen(semanticFailure.error.routerError), true);
  }
});

void test('authorizes result semantics only through canonical replay byte equality', () => {
  const run = directSuccessRun();
  const mutations: string[] = [];
  mutations.push(
    mutate(run, (record) => {
      record.result = null;
    }),
  );
  mutations.push(
    mutate(run, (record) => {
      const result = record.result as Record<string, unknown>;
      result['status'] = 'no-route';
    }),
  );
  mutations.push(
    mutate(run, (record) => {
      const result = record.result as {
        plan: { receipt: { amountOut: string }; search: Record<string, unknown> };
      };
      result.plan.receipt.amountOut = '91';
    }),
  );
  mutations.push(
    mutate(run, (record) => {
      const result = record.result as {
        plan: { receipt: { hops: Array<Record<string, unknown>> } };
      };
      const firstHop = result.plan.receipt.hops[0];
      if (firstHop !== undefined) firstHop['reserveOutAfter'] = '909';
    }),
  );
  mutations.push(
    mutate(run, (record) => {
      const result = record.result as { plan: { search: Record<string, unknown> } };
      result.plan.search['expansions'] = 2;
    }),
  );
  mutations.push(
    mutate(run, (record) => {
      const result = record.result as Record<string, unknown>;
      result['elapsedMilliseconds'] = 1;
    }),
  );
  mutations.push(`${run.canonicalJson}\n`);

  const decoded = decode(run.canonicalJson);
  mutations.push(
    JSON.stringify({
      snapshot: decoded.snapshot,
      schemaVersion: decoded.schemaVersion,
      request: decoded.request,
      result: decoded.result,
    }),
  );
  const pretty = JSON.stringify(decoded, null, 2);
  const prettyHash = `sha256:${createHash('sha256').update(pretty, 'utf8').digest('hex')}`;
  assertFailure(pretty, prettyHash, { code: 'canonical-run-replay-mismatch' });

  for (const changed of mutations) {
    assertFailure(changed, run.determinismHash, {
      code: 'canonical-run-replay-mismatch',
    });
  }
});

void test('checks the claimed hash only after exact canonical byte replay', () => {
  const run = directSuccessRun();
  const supplied = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

  assertFailure(run.canonicalJson, supplied, {
    code: 'canonical-run-hash-mismatch',
    expected: run.determinismHash,
    actual: supplied,
  });
  assertFailure(run.canonicalJson, 'not-normalized', {
    code: 'canonical-run-hash-mismatch',
    expected: run.determinismHash,
    actual: 'not-normalized',
  });
});

void test('rejects noncanonical pool ordering after validating identical snapshot content', () => {
  const pools = [
    pool('pool-ac', 'A', 1_000n, 'C', 1_000n),
    pool('pool-ab', 'A', 1_000n, 'B', 2_000n),
    pool('pool-bc', 'B', 2_000n, 'C', 2_000n),
  ];
  const inputSnapshot = snapshot(pools);
  const run = createRun(inputSnapshot, request(inputSnapshot));
  const reordered = mutate(run, (record) => {
    const embeddedPools = record.snapshot.content.pools as unknown[];
    embeddedPools.reverse();
  });

  assertFailure(reordered, run.determinismHash, {
    code: 'canonical-run-replay-mismatch',
  });
});
