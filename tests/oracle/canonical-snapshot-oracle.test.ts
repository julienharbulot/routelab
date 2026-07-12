import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLiquiditySnapshot,
  type ConstantProductPool,
  type LiquiditySnapshot,
} from '../../src/domain/index.ts';
import {
  CANONICAL_SNAPSHOT_SCHEMA_VERSION,
  computeCanonicalSnapshotChecksum,
  serializeCanonicalSnapshotContent,
  verifyCanonicalSnapshotChecksum,
} from '../../src/serialization/canonical-snapshot/index.ts';

const GOLDEN_CANONICAL =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[' +
  '{"poolId":"pool-ab","asset0":"A","reserve0":"1000000","asset1":"B",' +
  '"reserve1":"2000000","feeChargedNumerator":"3","feeDenominator":"1000"},' +
  '{"poolId":"pool-bc","asset0":"B","reserve0":"3000000","asset1":"C",' +
  '"reserve1":"4000000","feeChargedNumerator":"0","feeDenominator":"1"}' +
  ']}';
const GOLDEN_CHECKSUM =
  'sha256:38a5b270abaec128c9dc06da76fe025934b65d42571f72c274fc2e8594c11a8e';

const EMPTY_CANONICAL = '{"schemaVersion":"routelab.snapshot.v1","pools":[]}';
const EMPTY_CHECKSUM =
  'sha256:a55a6064850ae495e101033c3b3927c7bf8725d44deb3ef852e42e5e0259653e';

const HUGE_UNREDUCED_CANONICAL =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[' +
  '{"poolId":"huge","asset0":"μ",' +
  '"reserve0":"9007199254740993123456789012345678901234567890",' +
  '"asset1":"asset/Ω","reserve1":"340282366920938463463374607431768211457",' +
  '"feeChargedNumerator":"6","feeDenominator":"2000"}' +
  ']}';
const HUGE_UNREDUCED_CHECKSUM =
  'sha256:c0a8eaa34594f90628bc0c7866904fdb4a2ab549394c4b3436fc952f73f590d0';
const HUGE_REDUCED_CANONICAL =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[' +
  '{"poolId":"huge","asset0":"μ",' +
  '"reserve0":"9007199254740993123456789012345678901234567890",' +
  '"asset1":"asset/Ω","reserve1":"340282366920938463463374607431768211457",' +
  '"feeChargedNumerator":"3","feeDenominator":"1000"}' +
  ']}';
const HUGE_REDUCED_CHECKSUM =
  'sha256:31b4504d0f1d862eecbf266544f1f038350294c34f35f7350847e3045039cd6f';

const ESCAPED_CANONICAL =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[' +
  '{"poolId":"quote\\"slash\\\\line\\nend","asset0":"tab\\tasset","reserve0":"1",' +
  '"asset1":"control\\u0001-\\ud800","reserve1":"2",' +
  '"feeChargedNumerator":"0","feeDenominator":"7"}' +
  ']}';
const ESCAPED_CHECKSUM =
  'sha256:52e83e1d4ef6de8edb8594d97e6005f998df6192a41d11ec19f0a0ff1f66ce55';

const UTF16_ORDER_CANONICAL =
  '{"schemaVersion":"routelab.snapshot.v1","pools":[' +
  '{"poolId":"A","asset0":"x","reserve0":"1","asset1":"y","reserve1":"2",' +
  '"feeChargedNumerator":"0","feeDenominator":"1"},' +
  '{"poolId":"😀","asset0":"x","reserve0":"3","asset1":"y","reserve1":"4",' +
  '"feeChargedNumerator":"0","feeDenominator":"1"},' +
  '{"poolId":"","asset0":"x","reserve0":"5","asset1":"y","reserve1":"6",' +
  '"feeChargedNumerator":"0","feeDenominator":"1"}' +
  ']}';
const UTF16_ORDER_CHECKSUM =
  'sha256:64af6c3bc301cc6194f08a480b6803571c34d995e30d7c45399563a3b89e64de';

function pool(
  poolId: string,
  asset0: string,
  reserve0: bigint,
  asset1: string,
  reserve1: bigint,
  feeChargedNumerator: bigint,
  feeDenominator: bigint,
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
  snapshotId = 'oracle-snapshot',
  snapshotChecksum = 'supplied-checksum',
): LiquiditySnapshot {
  return { snapshotId, snapshotChecksum, pools };
}

const poolAb = pool('pool-ab', 'A', 1_000_000n, 'B', 2_000_000n, 3n, 1_000n);
const poolBc = pool('pool-bc', 'B', 3_000_000n, 'C', 4_000_000n, 0n, 1n);

void test('matches independent golden bytes and digest and round-trips exact strings', () => {
  const input = snapshot([poolBc, poolAb]);
  const canonical = serializeCanonicalSnapshotContent(input);

  assert.equal(CANONICAL_SNAPSHOT_SCHEMA_VERSION, 'routelab.snapshot.v1');
  assert.equal(canonical, GOLDEN_CANONICAL);
  assert.equal(Buffer.byteLength(canonical, 'utf8'), 325);
  assert.equal(computeCanonicalSnapshotChecksum(input), GOLDEN_CHECKSUM);
  assert.match(GOLDEN_CHECKSUM, /^sha256:[0-9a-f]{64}$/u);

  const decoded: unknown = JSON.parse(canonical);
  assert.equal(typeof decoded, 'object');
  assert.notEqual(decoded, null);
  assert.equal(Array.isArray(decoded), false);
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return;

  const reparsed = parseLiquiditySnapshot({
    snapshotId: input.snapshotId,
    snapshotChecksum: input.snapshotChecksum,
    pools: (decoded as Record<string, unknown>)['pools'],
  });
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.deepEqual(reparsed.value, snapshot([poolAb, poolBc]));
  assert.equal(reparsed.value.pools[0]?.reserve0, 1_000_000n);
  assert.equal(typeof reparsed.value.pools[0]?.reserve0, 'bigint');
});

void test('is identical for every permutation and uses raw UTF-16 pool-id order', () => {
  const a = pool('A', 'x', 1n, 'y', 2n, 0n, 1n);
  const emoji = pool('😀', 'x', 3n, 'y', 4n, 0n, 1n);
  const privateUse = pool('', 'x', 5n, 'y', 6n, 0n, 1n);
  const permutations: readonly (readonly ConstantProductPool[])[] = [
    [a, emoji, privateUse],
    [a, privateUse, emoji],
    [emoji, a, privateUse],
    [emoji, privateUse, a],
    [privateUse, a, emoji],
    [privateUse, emoji, a],
  ];

  for (const pools of permutations) {
    const input = snapshot(pools);
    assert.equal(serializeCanonicalSnapshotContent(input), UTF16_ORDER_CANONICAL);
    assert.equal(computeCanonicalSnapshotChecksum(input), UTF16_ORDER_CHECKSUM);
  }
  assert.equal(Buffer.byteLength(UTF16_ORDER_CANONICAL, 'utf8'), 409);
});

void test('matches independent empty, huge, unreduced-fee, and escaping vectors', () => {
  const empty = snapshot([]);
  assert.equal(serializeCanonicalSnapshotContent(empty), EMPTY_CANONICAL);
  assert.equal(Buffer.byteLength(EMPTY_CANONICAL, 'utf8'), 51);
  assert.equal(computeCanonicalSnapshotChecksum(empty), EMPTY_CHECKSUM);

  const hugeUnreduced = snapshot([
    pool(
      'huge',
      'μ',
      9_007_199_254_740_993_123_456_789_012_345_678_901_234_567_890n,
      'asset/Ω',
      340_282_366_920_938_463_463_374_607_431_768_211_457n,
      6n,
      2_000n,
    ),
  ]);
  const hugeReduced = snapshot([
    pool(
      'huge',
      'μ',
      9_007_199_254_740_993_123_456_789_012_345_678_901_234_567_890n,
      'asset/Ω',
      340_282_366_920_938_463_463_374_607_431_768_211_457n,
      3n,
      1_000n,
    ),
  ]);
  assert.equal(serializeCanonicalSnapshotContent(hugeUnreduced), HUGE_UNREDUCED_CANONICAL);
  assert.equal(Buffer.byteLength(HUGE_UNREDUCED_CANONICAL, 'utf8'), 265);
  assert.equal(computeCanonicalSnapshotChecksum(hugeUnreduced), HUGE_UNREDUCED_CHECKSUM);
  assert.equal(serializeCanonicalSnapshotContent(hugeReduced), HUGE_REDUCED_CANONICAL);
  assert.equal(computeCanonicalSnapshotChecksum(hugeReduced), HUGE_REDUCED_CHECKSUM);
  assert.notEqual(HUGE_UNREDUCED_CHECKSUM, HUGE_REDUCED_CHECKSUM);

  const escaped = snapshot([
    pool('quote"slash\\line\nend', 'tab\tasset', 1n, 'control\u0001-\ud800', 2n, 0n, 7n),
  ]);
  assert.equal(serializeCanonicalSnapshotContent(escaped), ESCAPED_CANONICAL);
  assert.equal(Buffer.byteLength(ESCAPED_CANONICAL, 'utf8'), 218);
  assert.equal(computeCanonicalSnapshotChecksum(escaped), ESCAPED_CHECKSUM);
});

void test('excludes identity and observational aliases but changes for every financial field', () => {
  const baselinePool = pool('financial', 'asset-a', 11n, 'asset-b', 13n, 3n, 1_000n);
  const baseline = snapshot([baselinePool], 'identity-a', 'claim-a');
  const withAliases: LiquiditySnapshot & {
    readonly observedAt: string;
    readonly cache: Readonly<Record<string, unknown>>;
  } = {
    ...snapshot([baselinePool], 'identity-b', 'claim-b'),
    observedAt: '2099-01-01T00:00:00Z',
    cache: { derived: true },
  };

  assert.equal(
    serializeCanonicalSnapshotContent(withAliases),
    serializeCanonicalSnapshotContent(baseline),
  );
  assert.equal(
    computeCanonicalSnapshotChecksum(withAliases),
    computeCanonicalSnapshotChecksum(baseline),
  );

  const variants: readonly ConstantProductPool[] = [
    { ...baselinePool, poolId: 'financial-changed' },
    { ...baselinePool, asset0: 'asset-a-changed' },
    { ...baselinePool, reserve0: 12n },
    { ...baselinePool, asset1: 'asset-b-changed' },
    { ...baselinePool, reserve1: 14n },
    { ...baselinePool, feeChargedNumerator: 4n },
    { ...baselinePool, feeDenominator: 1_001n },
  ];
  const baselineChecksum = computeCanonicalSnapshotChecksum(baseline);
  for (const variant of variants) {
    assert.notEqual(computeCanonicalSnapshotChecksum(snapshot([variant])), baselineChecksum);
  }
});

void test('repeats exactly and verifies case-sensitively with frozen results', () => {
  const matching = snapshot([poolBc, poolAb], 'matching-id', GOLDEN_CHECKSUM);
  const first = computeCanonicalSnapshotChecksum(matching);
  const second = computeCanonicalSnapshotChecksum(matching);
  assert.equal(first, GOLDEN_CHECKSUM);
  assert.equal(second, first);

  const success = verifyCanonicalSnapshotChecksum(matching);
  assert.deepEqual(success, { ok: true, checksum: GOLDEN_CHECKSUM });
  assert.equal(Object.isFrozen(success), true);

  const uppercaseClaim = `sha256:${GOLDEN_CHECKSUM.slice('sha256:'.length).toUpperCase()}`;
  const mismatchInput = snapshot([poolBc, poolAb], 'mismatch-id', uppercaseClaim);
  const failure = verifyCanonicalSnapshotChecksum(mismatchInput);
  assert.deepEqual(failure, {
    ok: false,
    error: {
      code: 'snapshot-checksum-mismatch',
      expected: GOLDEN_CHECKSUM,
      actual: uppercaseClaim,
    },
  });
  assert.equal(Object.isFrozen(failure), true);
  if (failure.ok) return;
  assert.equal(Object.isFrozen(failure.error), true);
});

void test('does not mutate or freeze caller-owned snapshot aliases', () => {
  const callerPool = pool('mutable', 'left', 101n, 'right', 202n, 1n, 10n);
  const callerPools: ConstantProductPool[] = [callerPool];
  const input = snapshot(callerPools, 'caller-id', 'incorrect-claim');
  const before = structuredClone(input);

  serializeCanonicalSnapshotContent(input);
  computeCanonicalSnapshotChecksum(input);
  const verification = verifyCanonicalSnapshotChecksum(input);

  assert.equal(verification.ok, false);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(callerPools), false);
  assert.equal(Object.isFrozen(callerPool), false);
  assert.equal(input.snapshotChecksum, 'incorrect-claim');
});
