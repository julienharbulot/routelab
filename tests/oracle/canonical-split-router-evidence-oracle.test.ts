import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { LiquiditySnapshot } from '../../src/domain/index.ts';
import type {
  ExactInputSplitRuntimeRequest,
  ExactInputSplitWorkCaps,
} from '../../src/router/anytime-exact-input-split/index.ts';
import {
  createCanonicalSplitRouterCase,
  parseAndVerifyCanonicalSplitRouterCase,
} from '../../src/serialization/canonical-split-router-case/index.ts';
import {
  createCanonicalSplitRouterRun,
  parseAndVerifyCanonicalSplitRouterRun,
} from '../../src/serialization/canonical-split-router-run/index.ts';
import {
  verifyOfflineSplitRouterCases,
  type OfflineSplitCaseDirectoryEntry,
  type OfflineSplitCaseVerificationDependencies,
} from '../../src/verification/offline-split-router-cases/index.ts';

/* The production APIs above are black-box subjects.  Expected canonical content,
 * AMM arithmetic, hashes, ledgers, ordering, and projections below are local. */

type JsonRecord = Record<string, unknown>;
type ParseRunResult = ReturnType<typeof parseAndVerifyCanonicalSplitRouterRun>;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = fileURLToPath(
  new URL('../../fixtures/pre-m6/split-router-cases/', import.meta.url),
);
const SPLIT_CLI = fileURLToPath(new URL('../../cli/replay-split-cases.ts', import.meta.url));
const DEMO_CLI = fileURLToPath(new URL('../../cli/demo.ts', import.meta.url));

const SNAPSHOT_ID = 'pre-m6-two-direct-pools';
const SNAPSHOT_HASH =
  'sha256:15d26e434befa00d782d61ee4bf9e0fd704a83bb3b3720b89fd63ff0f7120b6f';
const FULL_RUN_HASH =
  'sha256:d38c5035cf41b14847adf623ab9bc18051a1a48c5e8433afb257fcc7f1944f7a';
const LIMITED_RUN_HASH =
  'sha256:84eff360c586b13db3fcc79c216837f19998bdf09b1dabd4ac94f34bee96d67e';

const CAP_FIELDS = [
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
] as const;
const COUNTER_FIELDS = [
  'directCandidates',
  'directCandidateReplays',
  'directCandidateRejections',
  'pathExpansions',
  'bestSingleCandidateReplays',
  'bestSingleCandidateRejections',
  'candidateSetExpansions',
  'equalProposalReplays',
  'equalProposalRejections',
  'greedyOptionReplays',
  'greedyOptionRejections',
  'finalAuthorizationReplays',
  'finalAuthorizationRejections',
] as const;

const FULL_CAPS: ExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 100,
  maxBestSingleCandidateReplays: 100,
  maxCandidateSetExpansions: 100,
  maxEqualProposalReplays: 100,
  maxGreedyOptionReplays: 100,
  maxFinalAuthorizationReplays: 100,
});
const ZERO_CAPS: ExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 0,
  maxBestSingleCandidateReplays: 0,
  maxCandidateSetExpansions: 0,
  maxEqualProposalReplays: 0,
  maxGreedyOptionReplays: 0,
  maxFinalAuthorizationReplays: 0,
});

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function object(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function array(value: unknown): unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as unknown[];
}

function independentSnapshotContent(): JsonRecord {
  return {
    schemaVersion: 'routelab.snapshot.v1',
    pools: ['direct-0', 'direct-1'].map((poolId) => ({
      poolId,
      asset0: 'A',
      reserve0: '100',
      asset1: 'B',
      reserve1: '100',
      feeChargedNumerator: '0',
      feeDenominator: '1',
    })),
  };
}

function fixtureSnapshot(): LiquiditySnapshot {
  return {
    snapshotId: SNAPSHOT_ID,
    snapshotChecksum: SNAPSHOT_HASH,
    pools: ['direct-0', 'direct-1'].map((poolId) => ({
      poolId,
      asset0: 'A',
      reserve0: 100n,
      asset1: 'B',
      reserve1: 100n,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    })),
  };
}

function fixtureRequest(amountIn = 100n): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: SNAPSHOT_ID,
    snapshotChecksum: SNAPSHOT_HASH,
    assetIn: 'A',
    assetOut: 'B',
    amountIn,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
  };
}

function disconnectedFixture(): {
  readonly snapshot: LiquiditySnapshot;
  readonly request: ExactInputSplitRuntimeRequest;
} {
  const content = {
    schemaVersion: 'routelab.snapshot.v1',
    pools: [
      { poolId: 'ac', asset0: 'A', reserve0: '100', asset1: 'C', reserve1: '100', feeChargedNumerator: '0', feeDenominator: '1' },
      { poolId: 'db', asset0: 'D', reserve0: '100', asset1: 'B', reserve1: '100', feeChargedNumerator: '0', feeDenominator: '1' },
    ],
  };
  const snapshot: LiquiditySnapshot = {
    snapshotId: 'disconnected',
    snapshotChecksum: sha256(JSON.stringify(content)),
    pools: [
      { poolId: 'ac', asset0: 'A', reserve0: 100n, asset1: 'C', reserve1: 100n, feeChargedNumerator: 0n, feeDenominator: 1n },
      { poolId: 'db', asset0: 'D', reserve0: 100n, asset1: 'B', reserve1: 100n, feeChargedNumerator: 0n, feeDenominator: 1n },
    ],
  };
  return {
    snapshot,
    request: {
      ...fixtureRequest(),
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.snapshotChecksum,
    },
  };
}

function quote(reserveIn: bigint, reserveOut: bigint, amountIn: bigint): bigint {
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

function hop(poolId: string, amountIn: bigint): JsonRecord {
  const amountOut = quote(100n, 100n, amountIn);
  return {
    poolId,
    assetIn: 'A',
    assetOut: 'B',
    amountIn: amountIn.toString(10),
    amountOut: amountOut.toString(10),
    reserveInBefore: '100',
    reserveOutBefore: '100',
    reserveInAfter: (100n + amountIn).toString(10),
    reserveOutAfter: (100n - amountOut).toString(10),
  };
}

function leg(poolId: string, allocation: bigint): JsonRecord {
  const amountOut = quote(100n, 100n, allocation);
  return {
    allocation: allocation.toString(10),
    receipt: {
      snapshotId: SNAPSHOT_ID,
      snapshotChecksum: SNAPSHOT_HASH,
      assetIn: 'A',
      assetOut: 'B',
      amountIn: allocation.toString(10),
      amountOut: amountOut.toString(10),
      hops: [hop(poolId, allocation)],
    },
  };
}

function counters(full: boolean): JsonRecord {
  return {
    directCandidates: 2,
    directCandidateReplays: 2,
    directCandidateRejections: 0,
    pathExpansions: full ? 2 : 0,
    bestSingleCandidateReplays: full ? 2 : 0,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: full ? 2 : 0,
    equalProposalReplays: full ? 1 : 0,
    equalProposalRejections: 0,
    greedyOptionReplays: full ? 4 : 0,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: full ? 1 : 0,
    finalAuthorizationRejections: 0,
  };
}

function expectedRun(full: boolean): string {
  const amountOut = full ? 66n : 50n;
  const allocations = full
    ? [leg('direct-0', 50n), leg('direct-1', 50n)]
    : [leg('direct-0', 100n)];
  return JSON.stringify({
    schemaVersion: 'routelab.split-router-run.v1',
    snapshot: {
      snapshotId: SNAPSHOT_ID,
      snapshotChecksum: SNAPSHOT_HASH,
      content: independentSnapshotContent(),
    },
    request: {
      snapshotId: SNAPSHOT_ID,
      snapshotChecksum: SNAPSHOT_HASH,
      assetIn: 'A',
      assetOut: 'B',
      amountIn: '100',
      maxHops: 1,
      maxRoutes: 2,
      greedyParts: 2,
    },
    control: full ? FULL_CAPS : ZERO_CAPS,
    result: {
      status: 'success',
      plan: {
        receipt: {
          snapshotId: SNAPSHOT_ID,
          snapshotChecksum: SNAPSHOT_HASH,
          assetIn: 'A',
          assetOut: 'B',
          amountIn: '100',
          amountOut: amountOut.toString(10),
          legs: allocations,
        },
        search: {
          counters: counters(full),
          termination: full ? 'complete' : 'work-limit',
        },
      },
    },
  });
}

function expectedCase(full: boolean): string {
  const run = expectedRun(full);
  return JSON.stringify({
    schemaVersion: 'routelab.split-router-case.v1',
    caseId: full
      ? 'pre-m6-split-improves-66'
      : 'pre-m6-direct-fallback-work-limit-50',
    determinismHash: full ? FULL_RUN_HASH : LIMITED_RUN_HASH,
    run: JSON.parse(run) as unknown,
  });
}

function mutate(base: string, change: (record: JsonRecord) => void): string {
  const record = object(JSON.parse(base) as unknown);
  change(record);
  return JSON.stringify(record);
}

function runParts(record: JsonRecord): {
  snapshot: JsonRecord;
  content: JsonRecord;
  request: JsonRecord;
  control: JsonRecord;
  result: JsonRecord;
  receipt: JsonRecord;
  search: JsonRecord;
  counters: JsonRecord;
  legs: JsonRecord[];
  hops: JsonRecord[];
} {
  const snapshot = object(record['snapshot']);
  const content = object(snapshot['content']);
  const request = object(record['request']);
  const control = object(record['control']);
  const result = object(record['result']);
  const plan = object(result['plan']);
  const receipt = object(plan['receipt']);
  const search = object(plan['search']);
  const workCounters = object(search['counters']);
  const legs = array(receipt['legs']).map(object);
  const hops = legs.flatMap((value) => array(object(value['receipt'])['hops']).map(object));
  return {
    snapshot,
    content,
    request,
    control,
    result,
    receipt,
    search,
    counters: workCounters,
    legs,
    hops,
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function runFailure(
  canonicalJson: string,
  determinismHash = FULL_RUN_HASH,
  label = 'tampered or noncanonical run',
): Extract<ParseRunResult, { readonly ok: false }> {
  const parsed = parseAndVerifyCanonicalSplitRouterRun(canonicalJson, determinismHash);
  if (parsed.ok) assert.fail(`${label} was accepted`);
  assertDeepFrozen(parsed);
  return parsed;
}

function assertRunError(
  canonicalJson: string,
  expected: Readonly<Record<string, unknown>>,
  determinismHash = FULL_RUN_HASH,
): void {
  assert.deepEqual(runFailure(canonicalJson, determinismHash).error, expected);
}

void test('independently derives the exact fixed snapshot, runs, cases, hashes, and bytes', async () => {
  const snapshotContent = JSON.stringify(independentSnapshotContent());
  assert.equal(sha256(snapshotContent), SNAPSHOT_HASH);
  assert.equal(quote(100n, 100n, 100n), 50n);
  assert.equal(quote(100n, 100n, 50n), 33n);
  assert.equal(quote(100n, 100n, 50n) * 2n, 66n);

  const vectors = [
    {
      filename: 'complete-split-66.json',
      full: true,
      runHash: FULL_RUN_HASH,
      caseBytes: 2614,
      caseHash: 'sha256:c31e273c836ccd7b3394960a3a86a81cd8d808d2d5ff17fb256b48951c2ffd68',
    },
    {
      filename: 'work-limit-fallback-50.json',
      full: false,
      runHash: LIMITED_RUN_HASH,
      caseBytes: 2205,
      caseHash: 'sha256:1f846fc00cf1bf8373790471780c21330e3c6f869b2d3f6feac18d73066e722e',
    },
  ] as const;

  for (const vector of vectors) {
    const run = expectedRun(vector.full);
    const canonicalCase = expectedCase(vector.full);
    const fixture = await readFile(join(FIXTURES, vector.filename), 'utf8');
    assert.equal(sha256(run), vector.runHash);
    assert.equal(Buffer.byteLength(canonicalCase, 'utf8'), vector.caseBytes);
    assert.equal(sha256(canonicalCase), vector.caseHash);
    assert.equal(fixture, canonicalCase);
    assert.equal(fixture.endsWith('}'), true);
    assert.equal(fixture.endsWith('\n'), false);
    assert.equal(/[ \t\r\n]$/u.test(fixture), false);
  }
});

void test('black-box create and parse return fresh deep-frozen deterministic values for all result classes', () => {
  const success = createCanonicalSplitRouterRun(fixtureSnapshot(), fixtureRequest(), FULL_CAPS);
  const limited = createCanonicalSplitRouterRun(fixtureSnapshot(), fixtureRequest(), ZERO_CAPS);
  assert.equal(success.ok, true);
  assert.equal(limited.ok, true);
  if (!success.ok || !limited.ok) return;
  assert.equal(success.value.canonicalJson, expectedRun(true));
  assert.equal(success.value.determinismHash, FULL_RUN_HASH);
  assert.equal(limited.value.canonicalJson, expectedRun(false));
  assert.equal(limited.value.determinismHash, LIMITED_RUN_HASH);

  const disconnected = disconnectedFixture();
  const noRoute = createCanonicalSplitRouterRun(disconnected.snapshot, disconnected.request, FULL_CAPS);
  const noPlan = createCanonicalSplitRouterRun(disconnected.snapshot, disconnected.request, ZERO_CAPS);
  assert.equal(noRoute.ok, true);
  assert.equal(noPlan.ok, true);
  if (noRoute.ok) assert.equal(noRoute.value.routerResult.status, 'no-route');
  if (noPlan.ok) assert.equal(noPlan.value.routerResult.status, 'no-plan');

  const huge = 10n ** 80n;
  const hugeContent = {
    schemaVersion: 'routelab.snapshot.v1',
    pools: ['direct-0', 'direct-1'].map((poolId) => ({
      poolId,
      asset0: 'A',
      reserve0: huge.toString(10),
      asset1: 'B',
      reserve1: huge.toString(10),
      feeChargedNumerator: '0',
      feeDenominator: '1',
    })),
  };
  const hugeSnapshot: LiquiditySnapshot = {
    snapshotId: SNAPSHOT_ID,
    snapshotChecksum: sha256(JSON.stringify(hugeContent)),
    pools: ['direct-0', 'direct-1'].map((poolId) => ({
      poolId, asset0: 'A', reserve0: huge, asset1: 'B', reserve1: huge,
      feeChargedNumerator: 0n, feeDenominator: 1n,
    })),
  };
  const hugeRun = createCanonicalSplitRouterRun(
    hugeSnapshot,
    { ...fixtureRequest(huge), snapshotChecksum: hugeSnapshot.snapshotChecksum },
    FULL_CAPS,
  );
  assert.equal(hugeRun.ok, true);
  if (hugeRun.ok) {
    const decoded = object(JSON.parse(hugeRun.value.canonicalJson) as unknown);
    assert.equal(object(decoded['request'])['amountIn'], huge.toString(10));
  }

  for (const run of [success.value, limited.value, ...(noRoute.ok ? [noRoute.value] : []), ...(noPlan.ok ? [noPlan.value] : []), ...(hugeRun.ok ? [hugeRun.value] : [])]) {
    const first = parseAndVerifyCanonicalSplitRouterRun(run.canonicalJson, run.determinismHash);
    const second = parseAndVerifyCanonicalSplitRouterRun(run.canonicalJson, run.determinismHash);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) continue;
    assert.deepEqual(first.value, second.value);
    assert.notEqual(first.value, second.value);
    assert.notEqual(first.value.routerResult, second.value.routerResult);
    assert.equal(first.value.canonicalJson, run.canonicalJson);
    assert.equal(first.value.determinismHash, sha256(run.canonicalJson));
    assertDeepFrozen(first);
    assertDeepFrozen(second);
  }
});

void test('rejects every semantic run class and never trusts supplied result bytes or hash', () => {
  const base = expectedRun(true);
  const tamperers: readonly [string, (record: JsonRecord) => void][] = [
    ['snapshot id', (record) => { runParts(record).snapshot['snapshotId'] = 'other'; }],
    ['snapshot checksum', (record) => { runParts(record).snapshot['snapshotChecksum'] = 'sha256:bad'; }],
    ['snapshot content', (record) => { object(array(runParts(record).content['pools'])[0])['reserve0'] = '101'; }],
    ['request snapshot id', (record) => { runParts(record).request['snapshotId'] = 'other'; }],
    ['request checksum', (record) => { runParts(record).request['snapshotChecksum'] = 'sha256:bad'; }],
    ['request input asset', (record) => { runParts(record).request['assetIn'] = 'B'; }],
    ['request output asset', (record) => { runParts(record).request['assetOut'] = 'A'; }],
    ['request amount', (record) => { runParts(record).request['amountIn'] = '101'; }],
    ['request hops', (record) => { runParts(record).request['maxHops'] = 2; }],
    ['request routes', (record) => { runParts(record).request['maxRoutes'] = 1; }],
    ['request greedy parts', (record) => { runParts(record).request['greedyParts'] = 3; }],
    ['result status', (record) => { runParts(record).result['status'] = 'no-plan'; }],
    ['split snapshot id', (record) => { runParts(record).receipt['snapshotId'] = 'other'; }],
    ['split checksum', (record) => { runParts(record).receipt['snapshotChecksum'] = 'sha256:bad'; }],
    ['split input asset', (record) => { runParts(record).receipt['assetIn'] = 'B'; }],
    ['split output asset', (record) => { runParts(record).receipt['assetOut'] = 'A'; }],
    ['split amount in', (record) => { runParts(record).receipt['amountIn'] = '101'; }],
    ['split amount out', (record) => { runParts(record).receipt['amountOut'] = '65'; }],
    ['allocation', (record) => { runParts(record).legs[0]!['allocation'] = '49'; }],
    ['route identity', (record) => { object(runParts(record).legs[0]!['receipt'])['snapshotId'] = 'other'; }],
    ['route checksum', (record) => { object(runParts(record).legs[0]!['receipt'])['snapshotChecksum'] = 'sha256:bad'; }],
    ['route input asset', (record) => { object(runParts(record).legs[0]!['receipt'])['assetIn'] = 'B'; }],
    ['route output asset', (record) => { object(runParts(record).legs[0]!['receipt'])['assetOut'] = 'A'; }],
    ['route amount in', (record) => { object(runParts(record).legs[0]!['receipt'])['amountIn'] = '49'; }],
    ['route amount', (record) => { object(runParts(record).legs[0]!['receipt'])['amountOut'] = '32'; }],
    ['hop pool', (record) => { runParts(record).hops[0]!['poolId'] = 'direct-1'; }],
    ['hop input asset', (record) => { runParts(record).hops[0]!['assetIn'] = 'B'; }],
    ['hop output asset', (record) => { runParts(record).hops[0]!['assetOut'] = 'A'; }],
    ['hop amount in', (record) => { runParts(record).hops[0]!['amountIn'] = '49'; }],
    ['hop amount', (record) => { runParts(record).hops[0]!['amountOut'] = '32'; }],
    ['hop reserve before', (record) => { runParts(record).hops[0]!['reserveInBefore'] = '99'; }],
    ['hop output reserve before', (record) => { runParts(record).hops[0]!['reserveOutBefore'] = '99'; }],
    ['hop input reserve after', (record) => { runParts(record).hops[0]!['reserveInAfter'] = '149'; }],
    ['hop reserve after', (record) => { runParts(record).hops[0]!['reserveOutAfter'] = '68'; }],
    ['termination', (record) => { runParts(record).search['termination'] = 'work-limit'; }],
  ];
  for (const field of CAP_FIELDS) {
    const tampered = mutate(base, (record) => {
      runParts(record).control[field] = 0;
    });
    assert.equal(runFailure(tampered).error.code, 'canonical-split-run-replay-mismatch', field);
  }
  for (const field of COUNTER_FIELDS) {
    const tampered = mutate(base, (record) => {
      runParts(record).counters[field] = 99;
    });
    assert.equal(runFailure(tampered).error.code, 'canonical-split-run-replay-mismatch', field);
  }
  for (const [label, change] of tamperers) {
    const tampered = mutate(base, change);
    const suppliedSelfHash = sha256(tampered);
    const reconstructableInputOnly = label === 'request hops';
    const failure = runFailure(
      tampered,
      reconstructableInputOnly ? FULL_RUN_HASH : suppliedSelfHash,
      label,
    );
    if (!reconstructableInputOnly) {
      assert.notEqual(failure.error.code, 'canonical-split-run-hash-mismatch', label);
    }
  }

  const disconnected = disconnectedFixture();
  for (const [caps, expectedStatus] of [[FULL_CAPS, 'no-route'], [ZERO_CAPS, 'no-plan']] as const) {
    const created = createCanonicalSplitRouterRun(disconnected.snapshot, disconnected.request, caps);
    assert.equal(created.ok, true);
    if (!created.ok) continue;
    assert.equal(created.value.routerResult.status, expectedStatus);
    const changedReason = mutate(created.value.canonicalJson, (record) => {
      object(record['result'])['reason'] = 'tampered';
    });
    const parsed = runFailure(changedReason, sha256(changedReason), `${expectedStatus} reason`);
    assert.equal(parsed.error.code, 'canonical-split-run-replay-mismatch');
  }

  assertRunError(base, {
    code: 'canonical-split-run-hash-mismatch',
    expected: FULL_RUN_HASH,
    actual: `sha256:${'0'.repeat(64)}`,
  }, `sha256:${'0'.repeat(64)}`);
  assertRunError(` ${base}`, { code: 'canonical-split-run-replay-mismatch' }, `sha256:${'0'.repeat(64)}`);
  const reordered = object(JSON.parse(base) as unknown);
  const reorderedJson = JSON.stringify({ result: reordered['result'], schemaVersion: reordered['schemaVersion'], snapshot: reordered['snapshot'], request: reordered['request'], control: reordered['control'] });
  assertRunError(reorderedJson, { code: 'canonical-split-run-replay-mismatch' });
});

void test('enforces strict run shapes, aliases, semantic-only fields, versions, decimals, safe integers, and precedence', () => {
  const base = expectedRun(true);
  assertRunError('{', { code: 'invalid-canonical-split-run-json' });
  for (const primitive of [null, [], 1, true, 'run']) {
    assertRunError(JSON.stringify(primitive), { code: 'invalid-canonical-split-run-shape', path: '$' });
  }

  const aliases: readonly [string, (record: JsonRecord) => void][] = [
    ['$.timing', (record) => { record['timing'] = 1; }],
    ['$.deadline', (record) => { record['deadline'] = '1'; }],
    ['$.callback', (record) => { record['callback'] = false; }],
    ['$.environment', (record) => { record['environment'] = {}; }],
    ['$.snapshot.extra', (record) => { runParts(record).snapshot['extra'] = true; }],
    ['$.snapshot.content.extra', (record) => { runParts(record).content['extra'] = true; }],
    ['$.request.timing', (record) => { runParts(record).request['timing'] = 1; }],
    ['$.control.deadline', (record) => { runParts(record).control['deadline'] = '1'; }],
    ['$.control.shouldInterrupt', (record) => { runParts(record).control['shouldInterrupt'] = false; }],
    ['$.result.plan.search.elapsed', (record) => { runParts(record).search['elapsed'] = 1; }],
    ['$.result.plan.receipt.extra', (record) => { runParts(record).receipt['extra'] = 1; }],
    ['$.result.plan.receipt.legs[0].extra', (record) => { runParts(record).legs[0]!['extra'] = 1; }],
    ['$.result.plan.receipt.legs[0].receipt.extra', (record) => { object(runParts(record).legs[0]!['receipt'])['extra'] = 1; }],
    ['$.result.plan.receipt.legs[0].receipt.hops[0].extra', (record) => { runParts(record).hops[0]!['extra'] = 1; }],
    ['$.result.plan.search.counters.extra', (record) => { runParts(record).counters['extra'] = 1; }],
  ];
  for (const [path, change] of aliases) {
    assertRunError(mutate(base, change), { code: 'invalid-canonical-split-run-shape', path });
  }

  assertRunError(mutate(base, (record) => { record['schemaVersion'] = 'routelab.split-router-run.v2'; }), {
    code: 'unsupported-canonical-split-run-version', actual: 'routelab.split-router-run.v2',
  });
  assertRunError(mutate(base, (record) => { runParts(record).content['schemaVersion'] = 'routelab.snapshot.v2'; }), {
    code: 'unsupported-canonical-split-snapshot-version', actual: 'routelab.snapshot.v2',
  });

  for (const amount of ['01', '+1', '-1', '1.0', '1e2', '', ' 1']) {
    assertRunError(mutate(base, (record) => { runParts(record).request['amountIn'] = amount; }), {
      code: 'invalid-canonical-split-run-request-shape', path: '$.request.amountIn',
    });
  }
  const nestedDecimals: readonly [string, (record: JsonRecord) => void][] = [
    ['$.result.plan.receipt.amountOut', (record) => { runParts(record).receipt['amountOut'] = '01'; }],
    ['$.result.plan.receipt.legs[0].allocation', (record) => { runParts(record).legs[0]!['allocation'] = '-1'; }],
    ['$.result.plan.receipt.legs[0].receipt.amountIn', (record) => { object(runParts(record).legs[0]!['receipt'])['amountIn'] = '1e2'; }],
    ['$.result.plan.receipt.legs[0].receipt.hops[0].reserveOutAfter', (record) => { runParts(record).hops[0]!['reserveOutAfter'] = '+67'; }],
  ];
  for (const [path, change] of nestedDecimals) {
    assertRunError(mutate(base, change), { code: 'invalid-canonical-split-run-shape', path });
  }
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assertRunError(mutate(base, (record) => { runParts(record).request['maxHops'] = value; }), {
      code: 'invalid-canonical-split-run-request-shape', path: '$.request.maxHops',
    });
  }
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assertRunError(mutate(base, (record) => { runParts(record).control['maxPathExpansions'] = value; }), {
      code: 'invalid-canonical-split-run-control-shape', path: '$.control.maxPathExpansions',
    });
  }
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assertRunError(mutate(base, (record) => { runParts(record).counters['pathExpansions'] = value; }), {
      code: 'invalid-canonical-split-run-shape', path: '$.result.plan.search.counters.pathExpansions',
    });
  }
  assert.equal(runFailure(mutate(base, (record) => { runParts(record).control['maxPathExpansions'] = Number.MAX_SAFE_INTEGER; })).error.code, 'canonical-split-run-hash-mismatch');
  assert.equal(runFailure(mutate(base, (record) => { runParts(record).counters['pathExpansions'] = Number.MAX_SAFE_INTEGER; })).error.code, 'canonical-split-run-replay-mismatch');

  const invalidSnapshotFirst = mutate(base, (record) => {
    object(array(runParts(record).content['pools'])[0])['reserve0'] = '0';
    runParts(record).request['amountIn'] = '01';
    runParts(record).control['maxPathExpansions'] = -1;
  });
  assert.equal(runFailure(invalidSnapshotFirst).error.code, 'invalid-canonical-split-run-snapshot');
  const badShapeBeforeVersion = mutate(base, (record) => {
    record['schemaVersion'] = 'v2';
    runParts(record).receipt['extra'] = true;
  });
  assertRunError(badShapeBeforeVersion, { code: 'invalid-canonical-split-run-shape', path: '$.result.plan.receipt.extra' });

  let requestReads = 0;
  let capReads = 0;
  const mismatched = { ...fixtureSnapshot(), snapshotChecksum: 'sha256:bad' };
  const checksumFirst = createCanonicalSplitRouterRun(
    mismatched,
    new Proxy(fixtureRequest(), { get() { requestReads += 1; throw new Error('untrusted'); } }),
    new Proxy(FULL_CAPS, { get() { capReads += 1; throw new Error('untrusted'); } }),
  );
  assert.equal(checksumFirst.ok, false);
  if (!checksumFirst.ok) assert.equal(checksumFirst.error.code, 'snapshot-checksum-mismatch');
  assert.equal(requestReads, 0);
  assert.equal(capReads, 0);
  assert.deepEqual(createCanonicalSplitRouterRun(fixtureSnapshot(), fixtureRequest(0n), FULL_CAPS), {
    ok: false,
    error: { code: 'invalid-split-router-request', routerError: { code: 'nonpositive-input', field: 'amountIn' } },
  });
  assert.deepEqual(createCanonicalSplitRouterRun(fixtureSnapshot(), fixtureRequest(), { ...FULL_CAPS, maxGreedyOptionReplays: -1 }), {
    ok: false,
    error: { code: 'invalid-split-router-control', controlError: { code: 'invalid-work-cap', field: 'workCaps.maxGreedyOptionReplays' } },
  });
});

void test('case wrapper round-trips exact bytes and rejects wrapper and nested tampering', async () => {
  for (const full of [true, false]) {
    const canonicalCase = expectedCase(full);
    const parsed = parseAndVerifyCanonicalSplitRouterCase(canonicalCase);
    const parsedAgain = parseAndVerifyCanonicalSplitRouterCase(canonicalCase);
    assert.equal(parsed.ok, true);
    assert.equal(parsedAgain.ok, true);
    if (!parsed.ok || !parsedAgain.ok) continue;
    const recreated = createCanonicalSplitRouterCase(parsed.value.caseId, parsed.value.run.canonicalJson, parsed.value.run.determinismHash);
    assert.equal(recreated.ok, true);
    if (recreated.ok) assert.equal(recreated.value.canonicalJson, canonicalCase);
    assert.notEqual(parsed.value, parsedAgain.value);
    assert.deepEqual(parsed.value, parsedAgain.value);
    assertDeepFrozen(parsed);
  }
  assert.deepEqual(createCanonicalSplitRouterCase('', expectedRun(true), FULL_RUN_HASH), {
    ok: false, error: { code: 'invalid-split-router-case-id' },
  });
  assert.deepEqual(parseAndVerifyCanonicalSplitRouterCase('{'), {
    ok: false, error: { code: 'invalid-split-router-case-json' },
  });
  const base = expectedCase(true);
  const wrapperAliases: readonly [string, (record: JsonRecord) => void][] = [
    ['$.schemaVersion', (record) => { delete record['schemaVersion']; }],
    ['$.caseId', (record) => { delete record['caseId']; }],
    ['$.determinismHash', (record) => { delete record['determinismHash']; }],
    ['$.run', (record) => { delete record['run']; }],
    ['$.timing', (record) => { record['timing'] = 1; }],
  ];
  for (const [path, change] of wrapperAliases) {
    const parsed = parseAndVerifyCanonicalSplitRouterCase(mutate(base, change));
    assert.deepEqual(parsed, { ok: false, error: { code: 'invalid-split-router-case-shape', path } });
  }
  const version = parseAndVerifyCanonicalSplitRouterCase(mutate(base, (record) => { record['schemaVersion'] = 'routelab.split-router-case.v2'; }));
  assert.deepEqual(version, { ok: false, error: { code: 'unsupported-split-router-case-version', actual: 'routelab.split-router-case.v2' } });
  const changedId = parseAndVerifyCanonicalSplitRouterCase(mutate(base, (record) => { record['caseId'] = 'other'; }));
  assert.equal(changedId.ok, true);
  if (changedId.ok) assert.equal(changedId.value.caseId, 'other');
  const emptyId = parseAndVerifyCanonicalSplitRouterCase(mutate(base, (record) => { record['caseId'] = ''; }));
  assert.deepEqual(emptyId, { ok: false, error: { code: 'invalid-split-router-case-id' } });
  const changedHash = parseAndVerifyCanonicalSplitRouterCase(mutate(base, (record) => { record['determinismHash'] = `sha256:${'0'.repeat(64)}`; }));
  assert.equal(changedHash.ok, false);
  if (!changedHash.ok) assert.equal(changedHash.error.code, 'canonical-split-run-hash-mismatch');
  const changedRun = parseAndVerifyCanonicalSplitRouterCase(mutate(base, (record) => {
    const run = object(record['run']);
    runParts(run).receipt['amountOut'] = '65';
  }));
  assert.deepEqual(changedRun, { ok: false, error: { code: 'canonical-split-run-replay-mismatch' } });
  assert.deepEqual(parseAndVerifyCanonicalSplitRouterCase(` ${base}`), {
    ok: false, error: { code: 'split-router-case-canonical-mismatch' },
  });
  const parsedBase = object(JSON.parse(base) as unknown);
  const reorderedCase = JSON.stringify({
    caseId: parsedBase['caseId'],
    schemaVersion: parsedBase['schemaVersion'],
    determinismHash: parsedBase['determinismHash'],
    run: parsedBase['run'],
  });
  assert.deepEqual(parseAndVerifyCanonicalSplitRouterCase(reorderedCase), {
    ok: false, error: { code: 'split-router-case-canonical-mismatch' },
  });
  assert.equal((await readFile(join(FIXTURES, 'complete-split-66.json'), 'utf8')), base);
});

interface InjectedDependencies {
  readonly dependencies: OfflineSplitCaseVerificationDependencies;
  readonly directoryCalls: string[];
  readonly fileCalls: string[];
}

function inject(
  entries: readonly OfflineSplitCaseDirectoryEntry[],
  files: ReadonlyMap<string, string>,
  failDirectory = false,
): InjectedDependencies {
  const directoryCalls: string[] = [];
  const fileCalls: string[] = [];
  return {
    directoryCalls,
    fileCalls,
    dependencies: {
      readDirectory(directory) {
        directoryCalls.push(directory);
        return failDirectory ? Promise.reject(new Error('private')) : Promise.resolve(entries);
      },
      readFile(path) {
        fileCalls.push(path);
        const value = files.get(path);
        return value === undefined ? Promise.reject(new Error('private')) : Promise.resolve(value);
      },
    },
  };
}

void test('offline verifier uses raw UTF-16 order, one read, atomic typed failures, and deterministic summaries', async () => {
  const emoji = '\u{1f600}.json';
  const privateUse = '\ue000.json';
  const entries = [
    { name: privateUse, isFile: true },
    { name: emoji, isFile: true },
    { name: 'Z.json', isFile: true },
    { name: 'README.md', isFile: true },
  ];
  const renamed = (id: string): string => mutate(expectedCase(true), (record) => { record['caseId'] = id; });
  const files = new Map([
    [join('/cases', 'Z.json'), renamed('z')],
    [join('/cases', emoji), renamed('emoji')],
    [join('/cases', privateUse), renamed('private')],
  ]);
  const injected = inject(entries, files);
  const verified = await verifyOfflineSplitRouterCases('/cases', injected.dependencies);
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.deepEqual(verified.value.summary.cases.map((item) => item.filename), ['Z.json', emoji, privateUse]);
    assert.deepEqual(injected.fileCalls, [join('/cases', 'Z.json'), join('/cases', emoji), join('/cases', privateUse)]);
    assert.deepEqual(injected.directoryCalls, ['/cases']);
    assert.equal(verified.value.canonicalJson, JSON.stringify(verified.value.summary));
    for (const excluded of ['timing', 'elapsed', 'deadline', 'clock', 'environment']) {
      assert.equal(verified.value.canonicalJson.includes(excluded), false);
    }
    assertDeepFrozen(verified);
  }

  const directoryFailure = await verifyOfflineSplitRouterCases('/cases', inject([], new Map(), true).dependencies);
  assert.deepEqual(directoryFailure, { ok: false, error: { code: 'split-case-directory-read-failed', directory: '/cases' } });
  const nonfile = await verifyOfflineSplitRouterCases('/cases', inject([{ name: 'nested.json', isFile: false }], new Map()).dependencies);
  assert.deepEqual(nonfile, { ok: false, error: { code: 'split-case-entry-not-file', filename: 'nested.json' } });
  const readFailure = await verifyOfflineSplitRouterCases('/cases', inject([{ name: 'a.json', isFile: true }], new Map()).dependencies);
  assert.deepEqual(readFailure, { ok: false, error: { code: 'split-case-file-read-failed', filename: 'a.json' } });
  const invalid = await verifyOfflineSplitRouterCases('/cases', inject([{ name: 'a.json', isFile: true }], new Map([[join('/cases', 'a.json'), `${expectedCase(true)}\n`]])).dependencies);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'invalid-split-router-case-file');
  const duplicate = await verifyOfflineSplitRouterCases('/cases', inject(
    [{ name: 'a.json', isFile: true }, { name: 'b.json', isFile: true }],
    new Map([[join('/cases', 'a.json'), expectedCase(true)], [join('/cases', 'b.json'), expectedCase(true)]]),
  ).dependencies);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.deepEqual(duplicate.error, {
    code: 'duplicate-split-router-case-id',
    caseId: 'pre-m6-split-improves-66',
    firstFilename: 'a.json',
    duplicateFilename: 'b.json',
  });
});

void test('split CLI streams and exits deterministically; demo executes two audited runs', () => {
  const help = spawnSync(process.execPath, [SPLIT_CLI, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual({ status: help.status, stdout: help.stdout, stderr: help.stderr }, {
    status: 0, stdout: 'Usage: pnpm replay:split-cases [--cases <directory>]\n', stderr: '',
  });
  const invalid = spawnSync(process.execPath, [SPLIT_CLI, '--cases'], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual({ status: invalid.status, stdout: invalid.stdout, stderr: invalid.stderr }, {
    status: 1, stdout: '', stderr: 'Usage: pnpm replay:split-cases [--cases <directory>]\n',
  });
  const missing = spawnSync(process.execPath, [SPLIT_CLI, '--cases', 'missing-split-cases'], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual({ status: missing.status, stdout: missing.stdout, stderr: missing.stderr }, {
    status: 1, stdout: '', stderr: 'split case replay failed: split-case-directory-read-failed\n',
  });
  const success = spawnSync(process.execPath, [SPLIT_CLI], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  assert.equal(success.stdout.endsWith('\n'), true);
  const summary = object(JSON.parse(success.stdout) as unknown);
  assert.equal(summary['schemaVersion'], 'routelab.split-case-verification.v1');
  assert.equal(summary['caseCount'], 2);
  const cases = array(summary['cases']).map(object);
  assert.deepEqual(cases.map((value) => [value['caseId'], value['determinismHash'], value['amountOut'], value['termination']]), [
    ['pre-m6-split-improves-66', FULL_RUN_HASH, '66', 'complete'],
    ['pre-m6-direct-fallback-work-limit-50', LIMITED_RUN_HASH, '50', 'work-limit'],
  ]);

  const firstDemo = spawnSync(process.execPath, [DEMO_CLI], { cwd: ROOT, encoding: 'utf8' });
  const secondDemo = spawnSync(process.execPath, [DEMO_CLI], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(firstDemo.status, 0);
  assert.equal(firstDemo.stderr, '');
  assert.equal(secondDemo.stdout, firstDemo.stdout);
  const demo = object(JSON.parse(firstDemo.stdout) as unknown);
  assert.deepEqual({
    exactInput: demo['exactInput'],
    bestSingleOutput: demo['bestSingleOutput'],
    splitAllocations: demo['splitAllocations'],
    splitOutput: demo['splitOutput'],
    exactImprovement: demo['exactImprovement'],
  }, {
    exactInput: '100', bestSingleOutput: '50', splitAllocations: ['50', '50'], splitOutput: '66', exactImprovement: '16',
  });
  const runs = object(demo['runs']);
  assert.deepEqual(object(object(runs['full'])['counters']), counters(true));
  assert.deepEqual(object(object(runs['restricted'])['counters']), counters(false));
  assert.deepEqual(object(object(runs['full'])['workCaps']), FULL_CAPS);
  assert.deepEqual(object(object(runs['restricted'])['workCaps']), ZERO_CAPS);
  assert.equal(object(runs['full'])['termination'], 'complete');
  assert.equal(object(runs['restricted'])['termination'], 'work-limit');
  assert.deepEqual(demo['limitations'], [
    'fixed offline fixture evidence only',
    'no performance or throughput conclusion',
    'no unrestricted global-optimality claim',
    'no live service, transaction, custody, or protocol execution',
  ]);
});

void test('legacy replay command still reports the three accepted single-path v1 hashes', () => {
  const replay = spawnSync('pnpm', ['replay:cases'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(replay.status, 0);
  assert.equal(replay.stderr, '$ node cli/replay-cases.ts\n');
  const jsonStart = replay.stdout.indexOf('{');
  assert.notEqual(jsonStart, -1);
  const report = object(JSON.parse(replay.stdout.slice(jsonStart)) as unknown);
  const semantics = object(report['semantics']);
  const legacyCases = array(semantics['cases']).map(object);
  assert.deepEqual(legacyCases.map((value) => value['determinismHash']), [
    'sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4',
    'sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90',
    'sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011',
  ]);
});
