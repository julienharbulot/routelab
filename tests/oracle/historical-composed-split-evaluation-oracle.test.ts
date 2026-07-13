import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeResult,
  type ExactInputSplitWorkCaps,
} from '../../src/router/anytime-exact-input-split/index.ts';
import { verifySyntheticRequestCorpus } from '../../src/verification/synthetic-request-corpus/index.ts';

type JsonRecord = Record<string, unknown>;
type RouteKey = readonly (readonly [string, string, string])[];

interface PoolJson {
  readonly poolId: string;
  readonly asset0: string;
  readonly reserve0: string;
  readonly asset1: string;
  readonly reserve1: string;
  readonly feeChargedNumerator: string;
  readonly feeDenominator: string;
}

interface RequestJson {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: string;
  readonly amountIn: string;
  readonly topology: string;
}

interface Objective {
  readonly output: bigint;
  readonly routes: readonly RouteKey[];
  readonly allocations: readonly bigint[];
  readonly totalHops: number;
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATASET = 'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1';
const CORPUS =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1';
const EVALUATION =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/composed-two-hop-pair-v3';
const CONFIG = 'fixtures/m6/composed-historical/comparison-config.v3.json';
const OBSERVATION_CONFIG = 'fixtures/m6/composed-historical/observation-config.v2.json';
const DATASET_ID = 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1';
const CORPUS_ID =
  'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-exhaustive-v1';
const EVALUATION_ID = 'm6-core12-synthetic-exhaustive-composed-two-hop-pair-evaluation-v3';
const SNAPSHOT_HASH =
  'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755';
const CORPUS_HASH =
  'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173';
const CONFIG_HASH =
  'sha256:4e4d1bdfe47016d23510adbc4ed8107854b5bbf0dec99f3fb88d920d7a403473';
const OBSERVATION_CONFIG_HASH =
  'sha256:6e1c5e315efd532f25f8c0fa601d29889452f1324978f7ce507b4c992ddb6d84';
const SEMANTIC_HASH =
  'sha256:28fafa1c27fe3c685756b25566ebcc357512b3d35acfdcf06afa01304cb9546e';
const OBSERVATIONS_HASH =
  'sha256:605b671af7b438e4222a543b35439b7f12830a5d2cf20a7f79764802725058b6';
const REVISION = 'f98dddbd748c08594c7f0de0e9b457fe69417dd5';
const PROFILE_IDS = [
  'fraction-0', 'fraction-1-16', 'fraction-1-8', 'fraction-1-4', 'fraction-1-2',
  'structural-complete',
] as const;
const CAP_FIELDS = [
  'maxPathExpansions', 'maxBestSingleCandidateReplays', 'maxCandidateSetExpansions',
  'maxEqualProposalReplays', 'maxGreedyOptionReplays', 'maxFinalAuthorizationReplays',
] as const;
const COUNTER_FIELDS = [
  'directCandidates', 'directCandidateReplays', 'directCandidateRejections', 'pathExpansions',
  'bestSingleCandidateReplays', 'bestSingleCandidateRejections', 'candidateSetExpansions',
  'equalProposalReplays', 'equalProposalRejections', 'greedyOptionReplays',
  'greedyOptionRejections', 'finalAuthorizationReplays', 'finalAuthorizationRejections',
] as const;
const SEMANTIC_LIMITATIONS = [
  'One frozen block, venue, 12-asset allowlist, and synthetic exhaustive request grid only.',
  'maxHops 2, maxRoutes 2, greedyParts 16, pool-disjoint routes, and six typed cap vectors bound the evaluated policy space.',
  'Typed work kinds remain separate; profile fractions do not introduce a universal work scalar or equal-cost assumption.',
  'The structural-complete profile is complete only for this corpus and bounded runtime configuration; it is not a global optimum.',
  'No transaction submission, custody, token-transfer feasibility, live execution, or production claim is made.',
] as const;
const OBSERVATION_LIMITATIONS = [
  'Latency values are raw operational observations from one environment with no threshold, speedup, scaling, tail, percentile, or statistical conclusion.',
  'No base/head algorithm comparison is made; any later comparison must reuse the exact snapshot, corpus, comparison-config, and observation-config hashes.',
] as const;

const BOUNDS = [121, 11, 110, 55, 1_760, 110] as const;
const FRACTIONS = [0, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1] as const;
const PROFILES = PROFILE_IDS.map((profileId, profileIndex) => {
  const values = BOUNDS.map((bound) => Math.ceil(bound * (FRACTIONS[profileIndex] ?? 0)));
  return {
    profileId,
    workCaps: {
      maxPathExpansions: values[0] ?? -1,
      maxBestSingleCandidateReplays: values[1] ?? -1,
      maxCandidateSetExpansions: values[2] ?? -1,
      maxEqualProposalReplays: values[3] ?? -1,
      maxGreedyOptionReplays: values[4] ?? -1,
      maxFinalAuthorizationReplays: values[5] ?? -1,
    } satisfies ExactInputSplitWorkCaps,
  };
});

function absolute(relative: string): string {
  return path.join(ROOT, relative);
}

function record(value: unknown): JsonRecord {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function array(value: unknown): readonly unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as readonly unknown[];
}

function exactKeys(value: JsonRecord, expected: readonly string[]): void {
  assert.deepEqual(Object.keys(value), expected);
}

function parseRecord(relative: string): JsonRecord {
  return record(JSON.parse(readFileSync(absolute(relative), 'utf8')) as unknown);
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exact(value: unknown): bigint {
  assert.equal(typeof value, 'string');
  assert.match(value as string, /^(?:0|[1-9][0-9]*)$/u);
  return BigInt(value as string);
}

function rawCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRoute(left: RouteKey, right: RouteKey): number {
  for (let hopIndex = 0; hopIndex < Math.min(left.length, right.length); hopIndex += 1) {
    const leftHop = left[hopIndex];
    const rightHop = right[hopIndex];
    assert.ok(leftHop && rightHop);
    for (let fieldIndex = 0; fieldIndex < 3; fieldIndex += 1) {
      const comparison = rawCompare(leftHop[fieldIndex] ?? '', rightHop[fieldIndex] ?? '');
      if (comparison !== 0) return comparison;
    }
  }
  return left.length - right.length;
}

function compareObjective(left: Objective, right: Objective): number {
  if (left.output !== right.output) return left.output > right.output ? 1 : -1;
  if (left.routes.length !== right.routes.length) return left.routes.length < right.routes.length ? 1 : -1;
  if (left.totalHops !== right.totalHops) return left.totalHops < right.totalHops ? 1 : -1;
  for (let index = 0; index < left.routes.length; index += 1) {
    const comparison = compareRoute(left.routes[index] ?? [], right.routes[index] ?? []);
    if (comparison !== 0) return comparison < 0 ? 1 : -1;
  }
  for (let index = 0; index < left.allocations.length; index += 1) {
    const leftAllocation = left.allocations[index] ?? 0n;
    const rightAllocation = right.allocations[index] ?? 0n;
    if (leftAllocation !== rightAllocation) return leftAllocation < rightAllocation ? 1 : -1;
  }
  return 0;
}

function independentProjection(result: ExactInputSplitRuntimeResult): JsonRecord {
  const counters = (value: typeof result extends never ? never : JsonRecord): JsonRecord => value;
  const search = (value: Extract<ExactInputSplitRuntimeResult, { status: 'success' }>['plan']['search']): JsonRecord => ({
    counters: counters(Object.fromEntries(COUNTER_FIELDS.map((field) => [field, value.counters[field]]))),
    termination: value.termination,
  });
  if (result.status === 'success') {
    const receipt = result.plan.receipt;
    return {
      status: 'success',
      plan: {
        receipt: {
          snapshotId: receipt.snapshotId,
          snapshotChecksum: receipt.snapshotChecksum,
          assetIn: receipt.assetIn,
          assetOut: receipt.assetOut,
          amountIn: receipt.amountIn.toString(10),
          amountOut: receipt.amountOut.toString(10),
          legs: receipt.legs.map((leg) => ({
            allocation: leg.allocation.toString(10),
            receipt: {
              snapshotId: leg.receipt.snapshotId,
              snapshotChecksum: leg.receipt.snapshotChecksum,
              assetIn: leg.receipt.assetIn,
              assetOut: leg.receipt.assetOut,
              amountIn: leg.receipt.amountIn.toString(10),
              amountOut: leg.receipt.amountOut.toString(10),
              hops: leg.receipt.hops.map((hop) => ({
                poolId: hop.poolId,
                assetIn: hop.assetIn,
                assetOut: hop.assetOut,
                amountIn: hop.amountIn.toString(10),
                amountOut: hop.amountOut.toString(10),
                reserveInBefore: hop.reserveInBefore.toString(10),
                reserveOutBefore: hop.reserveOutBefore.toString(10),
                reserveInAfter: hop.reserveInAfter.toString(10),
                reserveOutAfter: hop.reserveOutAfter.toString(10),
              })),
            },
          })),
        },
        search: search(result.plan.search),
      },
    };
  }
  if (result.status === 'no-route' || result.status === 'no-plan') {
    return { status: result.status, reason: result.reason, search: search(result.search) };
  }
  assert.fail(`non-semantic runtime result: ${result.status}`);
}

function validateSearch(result: JsonRecord, caps: JsonRecord): JsonRecord {
  const search = record(result['status'] === 'success' ? record(result['plan'])['search'] : result['search']);
  exactKeys(search, ['counters', 'termination']);
  const counters = record(search['counters']);
  exactKeys(counters, COUNTER_FIELDS);
  for (const field of COUNTER_FIELDS) {
    assert.equal(Number.isSafeInteger(counters[field]), true);
    assert.equal((counters[field] as number) >= 0, true);
  }
  for (let index = 0; index < CAP_FIELDS.length; index += 1) {
    const counter = COUNTER_FIELDS[[3, 4, 6, 7, 9, 11][index] ?? -1];
    const cap = CAP_FIELDS[index];
    assert.ok(counter && cap);
    assert.equal((counters[counter] as number) <= (caps[cap] as number), true);
  }
  assert.equal((counters['directCandidateRejections'] as number) <= (counters['directCandidateReplays'] as number), true);
  assert.equal((counters['bestSingleCandidateRejections'] as number) <= (counters['bestSingleCandidateReplays'] as number), true);
  assert.equal((counters['equalProposalRejections'] as number) <= (counters['equalProposalReplays'] as number), true);
  assert.equal((counters['greedyOptionRejections'] as number) <= (counters['greedyOptionReplays'] as number), true);
  assert.equal((counters['finalAuthorizationRejections'] as number) <= (counters['finalAuthorizationReplays'] as number), true);
  assert.ok(search['termination'] === 'complete' || search['termination'] === 'work-limit');
  if (result['status'] === 'no-route') assert.equal(search['termination'], 'complete');
  if (result['status'] === 'no-plan') assert.equal(search['termination'], 'work-limit');
  return search;
}

function validateReceipt(
  result: JsonRecord,
  request: RequestJson,
  pools: ReadonlyMap<string, PoolJson>,
): Objective {
  const receipt = record(record(result['plan'])['receipt']);
  exactKeys(receipt, ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut', 'amountIn', 'amountOut', 'legs']);
  assert.equal(receipt['snapshotId'], DATASET_ID);
  assert.equal(receipt['snapshotChecksum'], SNAPSHOT_HASH);
  assert.equal(receipt['assetIn'], request.assetIn);
  assert.equal(receipt['assetOut'], request.assetOut);
  assert.equal(receipt['amountIn'], request.amountIn);
  const legs = array(receipt['legs']);
  assert.ok(legs.length >= 1 && legs.length <= 2);
  const usedPools = new Set<string>();
  const allocations: bigint[] = [];
  const routes: RouteKey[] = [];
  let outputSum = 0n;
  let totalHops = 0;
  for (const legValue of legs) {
    const leg = record(legValue);
    exactKeys(leg, ['allocation', 'receipt']);
    const allocation = exact(leg['allocation']);
    assert.equal(allocation > 0n, true);
    allocations.push(allocation);
    const route = record(leg['receipt']);
    exactKeys(route, ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut', 'amountIn', 'amountOut', 'hops']);
    assert.equal(route['snapshotId'], DATASET_ID);
    assert.equal(route['snapshotChecksum'], SNAPSHOT_HASH);
    assert.equal(route['assetIn'], request.assetIn);
    assert.equal(route['assetOut'], request.assetOut);
    assert.equal(route['amountIn'], leg['allocation']);
    const hops = array(route['hops']);
    assert.ok(hops.length >= 1 && hops.length <= 2);
    totalHops += hops.length;
    const seenAssets = new Set([request.assetIn]);
    const routeKey: Array<readonly [string, string, string]> = [];
    let currentAsset = request.assetIn;
    let currentAmount = allocation;
    for (const hopValue of hops) {
      const hop = record(hopValue);
      exactKeys(hop, [
        'poolId', 'assetIn', 'assetOut', 'amountIn', 'amountOut', 'reserveInBefore',
        'reserveOutBefore', 'reserveInAfter', 'reserveOutAfter',
      ]);
      const poolId = hop['poolId'];
      assert.equal(typeof poolId, 'string');
      assert.equal(usedPools.has(poolId as string), false);
      usedPools.add(poolId as string);
      const pool = pools.get(poolId as string);
      assert.ok(pool);
      assert.equal(hop['assetIn'], currentAsset);
      const forward = pool.asset0 === currentAsset;
      assert.ok(forward || pool.asset1 === currentAsset);
      const nextAsset = forward ? pool.asset1 : pool.asset0;
      const reserveIn = exact(forward ? pool.reserve0 : pool.reserve1);
      const reserveOut = exact(forward ? pool.reserve1 : pool.reserve0);
      const fee = exact(pool.feeChargedNumerator);
      const denominator = exact(pool.feeDenominator);
      const multiplier = denominator - fee;
      const quoted = currentAmount * multiplier * reserveOut
        / (reserveIn * denominator + currentAmount * multiplier);
      assert.equal(quoted > 0n, true);
      assert.equal(hop['assetOut'], nextAsset);
      assert.equal(hop['amountIn'], currentAmount.toString(10));
      assert.equal(hop['amountOut'], quoted.toString(10));
      assert.equal(hop['reserveInBefore'], reserveIn.toString(10));
      assert.equal(hop['reserveOutBefore'], reserveOut.toString(10));
      assert.equal(hop['reserveInAfter'], (reserveIn + currentAmount).toString(10));
      assert.equal(hop['reserveOutAfter'], (reserveOut - quoted).toString(10));
      assert.equal(seenAssets.has(nextAsset), false);
      seenAssets.add(nextAsset);
      routeKey.push([currentAsset, pool.poolId, nextAsset]);
      currentAsset = nextAsset;
      currentAmount = quoted;
    }
    assert.equal(currentAsset, request.assetOut);
    assert.equal(route['amountOut'], currentAmount.toString(10));
    outputSum += currentAmount;
    routes.push(routeKey);
  }
  assert.equal(allocations.reduce((sum, value) => sum + value, 0n), exact(request.amountIn));
  assert.equal(outputSum, exact(receipt['amountOut']));
  for (let index = 1; index < routes.length; index += 1) {
    assert.equal(compareRoute(routes[index - 1] ?? [], routes[index] ?? []) < 0, true);
  }
  return { output: outputSum, routes, allocations, totalHops };
}

function reconstructCellHash(
  cell: JsonRecord,
  request: RequestJson,
  profile: (typeof PROFILES)[number],
): string {
  return sha256(JSON.stringify({
    schemaVersion: 'routelab.composed-historical-semantic-cell.v3',
    inputBinding: {
      snapshotChecksum: SNAPSHOT_HASH,
      corpusSha256: CORPUS_HASH,
      comparisonConfigSha256: CONFIG_HASH,
    },
    request: {
      requestId: request.requestId,
      amountBucket: request.amountBucket,
      topology: request.topology,
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountIn: request.amountIn,
    },
    profile: { profileId: profile.profileId, workCaps: profile.workCaps },
    result: record(cell['result']),
  }));
}

function expectedConfig(): JsonRecord {
  return {
    schemaVersion: 'routelab.composed-historical-comparison-config.v3',
    comparisonConfigId: 'm6-core12-synthetic-exhaustive-composed-two-hop-pair-v3',
    inputBinding: { datasetId: DATASET_ID, snapshotId: DATASET_ID, snapshotChecksum: SNAPSHOT_HASH, corpusId: CORPUS_ID, corpusSha256: CORPUS_HASH },
    runtime: { entryPoint: 'routeExactInputSplitAnytime', preparedContext: 'one-verified-context-shared-across-all-runs', request: { maxHops: 2, maxRoutes: 2, greedyParts: 16 }, controlMode: 'deterministic-work-caps-only-no-interruption-no-deadline' },
    schedule: { semanticOrder: 'corpus-request-then-declared-profile', profileOrder: PROFILE_IDS },
    profiles: PROFILES,
    comparison: { kind: 'componentwise-cap-profile-progression', referenceProfileId: 'structural-complete', baseHeadInputRule: 'snapshot-corpus-and-comparison-config-hashes-must-match' },
  };
}

function expectedObservationConfig(): JsonRecord {
  return {
    schemaVersion: 'routelab.composed-historical-observation-config.v2',
    observationConfigId: 'm6-core12-synthetic-exhaustive-composed-two-hop-pair-observation-v2',
    inputBinding: {
      comparisonConfigId: 'm6-core12-synthetic-exhaustive-composed-two-hop-pair-v3',
      comparisonConfigSha256: CONFIG_HASH,
    },
    protocol: {
      timingScope: 'routeExactInputSplitAnytime-call-only',
      clock: 'process.hrtime.bigint',
      warmupSweeps: 1,
      sampleSweeps: 5,
      sweepOrder: 'forward-even-reverse-odd',
      serialization: 'outside-timed-region',
      environmentFields: ['nodeVersion', 'platform', 'arch', 'osRelease', 'cpuModel', 'logicalCpuCount'],
      resultCheck: 'deep-equal-established-semantic-result-after-timed-call',
    },
    limitations: OBSERVATION_LIMITATIONS,
  };
}

void test('independently reconstructs the exact config bytes and conservative graph bounds', () => {
  const snapshot = parseRecord(path.join(DATASET, 'snapshot.json'));
  const pools = array(snapshot['pools']).map((value) => record(value) as unknown as PoolJson);
  const assets = new Set(pools.flatMap((pool) => [pool.asset0, pool.asset1]));
  assert.equal(assets.size, 12);
  assert.equal(pools.length, 54);
  const maximumPaths = 1 + (assets.size - 2);
  const pathExpansions = (assets.size - 1) + (assets.size - 2) * (assets.size - 1);
  const candidateSetExpansions = maximumPaths * (maximumPaths - 1);
  const disjointPairs = maximumPaths * (maximumPaths - 1) / 2;
  assert.deepEqual(
    [pathExpansions, maximumPaths, candidateSetExpansions, disjointPairs, disjointPairs * 16 * 2, disjointPairs * 2],
    BOUNDS,
  );
  const text = JSON.stringify(expectedConfig());
  const bytes = readFileSync(absolute(CONFIG));
  assert.equal(Buffer.byteLength(text), 2_528);
  assert.equal(text, bytes.toString('utf8'));
  assert.equal(sha256(text), CONFIG_HASH);
  assert.notEqual(bytes.at(-1), 0x0a);
  assert.deepEqual(Object.keys(expectedConfig()), [
    'schemaVersion', 'comparisonConfigId', 'inputBinding', 'runtime', 'schedule', 'profiles',
    'comparison',
  ]);
  assert.doesNotMatch(text, /observation|timing|clock|warmup|sample|environment|revision|limitation|Latency|speedup/iu);

  const observationText = JSON.stringify(expectedObservationConfig());
  const observationBytes = readFileSync(absolute(OBSERVATION_CONFIG));
  assert.equal(Buffer.byteLength(observationText), 1_060);
  assert.equal(observationText, observationBytes.toString('utf8'));
  assert.equal(sha256(observationText), OBSERVATION_CONFIG_HASH);
  assert.notEqual(observationBytes.at(-1), 0x0a);
});

void test('audits all persisted semantic cells, receipts, counters, hashes, objectives, and observations', async () => {
  const snapshot = parseRecord(path.join(DATASET, 'snapshot.json'));
  const poolList = array(snapshot['pools']).map((value) => record(value) as unknown as PoolJson);
  const pools = new Map(poolList.map((pool) => [pool.poolId, pool] as const));
  const corpusDocument = parseRecord(path.join(CORPUS, 'requests.json'));
  const requests = array(corpusDocument['requests']).map((value) => record(value) as unknown as RequestJson);
  assert.equal(requests.length, 396);
  assert.equal(sha256(readFileSync(absolute(path.join(CORPUS, 'requests.json')))), CORPUS_HASH);
  const semanticText = readFileSync(absolute(path.join(EVALUATION, 'semantic-results.json')), 'utf8');
  const observationsText = readFileSync(absolute(path.join(EVALUATION, 'observations.json')), 'utf8');
  const manifestText = readFileSync(absolute(path.join(EVALUATION, 'manifest.json')), 'utf8');
  assert.equal(Buffer.byteLength(semanticText), 5_955_224);
  assert.equal(Buffer.byteLength(observationsText), 2_355_505);
  assert.equal(Buffer.byteLength(manifestText), 2_787);
  assert.equal(sha256(semanticText), SEMANTIC_HASH);
  assert.equal(sha256(observationsText), OBSERVATIONS_HASH);
  assert.equal(sha256(manifestText), 'sha256:58e0e211680cf14e2d8711bad58fba25f8fba3ece127e43cb57d27337410fda8');

  const verified = await verifySyntheticRequestCorpus(CORPUS, { readFile });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  const semantic = record(JSON.parse(semanticText) as unknown);
  exactKeys(semantic, [
    'schemaVersion', 'evaluationId', 'inputBinding', 'schedule', 'cells', 'summary', 'limitations',
  ]);
  assert.equal(semantic['schemaVersion'], 'routelab.composed-historical-semantic-results.v3');
  exactKeys(record(semantic['inputBinding']), [
    'datasetId', 'snapshotId', 'snapshotChecksum', 'corpusId', 'corpusSha256',
    'comparisonConfigId', 'comparisonConfigSha256',
  ]);
  const cells = array(semantic['cells']);
  assert.equal(cells.length, 2_376);
  const objectives: Array<Objective | undefined> = [];
  const summaryAccumulators = PROFILES.map((profile) => ({
    profileId: profile.profileId,
    statusCounts: { success: 0, noRoute: 0, noPlan: 0 },
    terminationCounts: { complete: 0, workLimit: 0 },
    counterTotals: Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])),
    counterMaxima: Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])),
  }));

  for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
    const cell = record(cells[cellIndex]);
    exactKeys(cell, ['requestId', 'amountBucket', 'topology', 'assetIn', 'assetOut', 'amountIn', 'profileId', 'workCaps', 'semanticHash', 'result']);
    const requestIndex = Math.floor(cellIndex / PROFILES.length);
    const profileIndex = cellIndex % PROFILES.length;
    const request = requests[requestIndex];
    const profile = PROFILES[profileIndex];
    const accumulator = summaryAccumulators[profileIndex];
    assert.ok(request && profile && accumulator);
    assert.deepEqual(
      { requestId: cell['requestId'], assetIn: cell['assetIn'], assetOut: cell['assetOut'], amountBucket: cell['amountBucket'], amountIn: cell['amountIn'], topology: cell['topology'] },
      request,
    );
    assert.equal(cell['profileId'], profile.profileId);
    assert.deepEqual(cell['workCaps'], profile.workCaps);
    const result = record(cell['result']);
    assert.ok(result['status'] === 'success' || result['status'] === 'no-route' || result['status'] === 'no-plan');
    const search = validateSearch(result, record(cell['workCaps']));
    if (result['status'] === 'success') {
      objectives[cellIndex] = validateReceipt(result, request, pools);
      accumulator.statusCounts.success += 1;
    } else if (result['status'] === 'no-route') accumulator.statusCounts.noRoute += 1;
    else accumulator.statusCounts.noPlan += 1;
    if (search['termination'] === 'complete') accumulator.terminationCounts.complete += 1;
    else accumulator.terminationCounts.workLimit += 1;
    const counters = record(search['counters']);
    for (const field of COUNTER_FIELDS) {
      accumulator.counterTotals[field] = (accumulator.counterTotals[field] ?? 0) + (counters[field] as number);
      accumulator.counterMaxima[field] = Math.max(accumulator.counterMaxima[field] ?? 0, counters[field] as number);
    }
    assert.equal(cell['semanticHash'], reconstructCellHash(cell, request, profile));
    const runtimeResult = routeExactInputSplitAnytime(
      verified.value.context,
      { snapshotId: DATASET_ID, snapshotChecksum: SNAPSHOT_HASH, assetIn: request.assetIn, assetOut: request.assetOut, amountIn: exact(request.amountIn), maxHops: 2, maxRoutes: 2, greedyParts: 16 },
      { workCaps: profile.workCaps },
    );
    assert.deepEqual(independentProjection(runtimeResult), result);
  }

  const adjacentComparisons = [];
  for (let profileIndex = 1; profileIndex < PROFILES.length; profileIndex += 1) {
    const counts = { newlyPlanned: 0, noLongerPlanned: 0, strictlyImproved: 0, equalObjective: 0, regressed: 0 };
    for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
      const previous = objectives[requestIndex * PROFILES.length + profileIndex - 1];
      const current = objectives[requestIndex * PROFILES.length + profileIndex];
      if (previous === undefined && current !== undefined) counts.newlyPlanned += 1;
      else if (previous !== undefined && current === undefined) counts.noLongerPlanned += 1;
      else if (previous === undefined || current === undefined) counts.equalObjective += 1;
      else {
        const comparison = compareObjective(current, previous);
        if (comparison > 0) counts.strictlyImproved += 1;
        else if (comparison < 0) counts.regressed += 1;
        else counts.equalObjective += 1;
      }
    }
    assert.equal(counts.noLongerPlanned, 0);
    assert.equal(counts.regressed, 0);
    adjacentComparisons.push({ previousProfileId: PROFILE_IDS[profileIndex - 1], profileId: PROFILE_IDS[profileIndex], ...counts });
  }
  const summary = record(semantic['summary']);
  assert.deepEqual(summary['profileSummaries'], summaryAccumulators);
  assert.deepEqual(summary['adjacentComparisons'], adjacentComparisons);
  assert.deepEqual(summaryAccumulators.at(-1)?.terminationCounts, { complete: 396, workLimit: 0 });

  assert.deepEqual(semantic['limitations'], SEMANTIC_LIMITATIONS);
  for (const forbidden of [
    'observationConfig', 'timingScope', 'process.hrtime', 'warmupSweeps', 'sampleSweeps',
    'runtimeRevision', 'environment', 'nodeVersion', 'Latency values', 'speedup',
  ]) assert.equal(semanticText.includes(forbidden), false);
  const hashesBeforeObservationMutation = cells.map((cellValue, cellIndex) => {
    const request = requests[Math.floor(cellIndex / PROFILES.length)];
    const profile = PROFILES[cellIndex % PROFILES.length];
    assert.ok(request && profile);
    return reconstructCellHash(record(cellValue), request, profile);
  });
  const semanticBytesBeforeObservationMutation = JSON.stringify(semantic);
  assert.equal(semanticBytesBeforeObservationMutation, semanticText);
  const mutatedObservation = JSON.parse(JSON.stringify(expectedObservationConfig())) as unknown;
  record(record(mutatedObservation)['protocol'])['sampleSweeps'] = 99;
  assert.notEqual(
    sha256(JSON.stringify(mutatedObservation)),
    sha256(JSON.stringify(expectedObservationConfig())),
  );
  const hashesAfterObservationMutation = cells.map((cellValue, cellIndex) => {
    const request = requests[Math.floor(cellIndex / PROFILES.length)];
    const profile = PROFILES[cellIndex % PROFILES.length];
    assert.ok(request && profile);
    return reconstructCellHash(record(cellValue), request, profile);
  });
  assert.deepEqual(hashesAfterObservationMutation, hashesBeforeObservationMutation);
  assert.equal(JSON.stringify(semantic), semanticBytesBeforeObservationMutation);
  assert.equal(sha256(semanticText), SEMANTIC_HASH);

  const observations = record(JSON.parse(observationsText) as unknown);
  assert.equal(observations['schemaVersion'], 'routelab.composed-historical-timing-observations.v3');
  const measurement = record(observations['measurement']);
  const samples = array(measurement['samples']);
  assert.equal(samples.length, 11_880);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = record(samples[index]);
    exactKeys(sample, ['round', 'order', 'requestId', 'profileId', 'semanticHash', 'elapsedNanoseconds']);
    const round = Math.floor(index / 2_376);
    const order = index % 2_376;
    const cellIndex = round % 2 === 0 ? order : 2_376 - order - 1;
    const cell = record(cells[cellIndex]);
    assert.deepEqual(
      { round: sample['round'], order: sample['order'], requestId: sample['requestId'], profileId: sample['profileId'], semanticHash: sample['semanticHash'] },
      { round, order, requestId: cell['requestId'], profileId: cell['profileId'], semanticHash: cell['semanticHash'] },
    );
    exact(sample['elapsedNanoseconds']);
  }
  assert.equal(record(observations['runtime'])['runtimeRevision'], REVISION);
  const observationBinding = record(observations['inputBinding']);
  assert.equal(observationBinding['comparisonConfigSha256'], CONFIG_HASH);
  assert.equal(observationBinding['observationConfigSha256'], OBSERVATION_CONFIG_HASH);
  assert.equal(observationBinding['semanticResultsSha256'], SEMANTIC_HASH);
  assert.deepEqual(observations['limitations'], OBSERVATION_LIMITATIONS);
  const manifest = record(JSON.parse(manifestText) as unknown);
  assert.deepEqual(manifest['counts'], { requestCount: 396, profileCount: 6, semanticCellCount: 2_376, warmupSweeps: 1, sampleSweeps: 5, observationSampleCount: 11_880 });
  assert.equal(record(manifest['runtime'])['implementationRevision'], REVISION);
  const artifacts = record(manifest['artifacts']);
  assert.deepEqual(artifacts['comparisonConfig'], { path: CONFIG, bytes: 2_528, sha256: CONFIG_HASH });
  assert.deepEqual(artifacts['observationConfig'], { path: OBSERVATION_CONFIG, bytes: 1_060, sha256: OBSERVATION_CONFIG_HASH });
  assert.deepEqual(artifacts['semanticResults'], { path: 'semantic-results.json', bytes: 5_955_224, sha256: SEMANTIC_HASH });
  assert.deepEqual(artifacts['observations'], { path: 'observations.json', bytes: 2_355_505, sha256: OBSERVATIONS_HASH });
  assert.equal(semantic['evaluationId'], EVALUATION_ID);
});

void test('proves the timed call boundary, one-context architecture, and semantic replay precedence', () => {
  const source = readFileSync(absolute('src/benchmark/historical-composed-split/index.ts'), 'utf8');
  assert.equal(source.match(/routeExactInputSplitAnytime\s*\(/gu)?.length, 1);
  assert.equal(source.match(/verifySyntheticRequestCorpus\s*\(/gu)?.length, 2);
  for (const forbidden of [
    'prepareRoutingContext(', 'parseAndPrepareRoutingContext(', 'routeExactInputSinglePath(',
    'routeExactInputSplit(', 'routeExactInputSplitGreedy(', 'createCanonicalSplitRouterRun(',
  ]) assert.equal(source.includes(forbidden), false);
  const invoke = source.slice(
    source.indexOf('function invokeCell('),
    source.indexOf('function validateCellResult('),
  );
  const controlIndex = invoke.indexOf('const control =');
  const startedIndex = invoke.indexOf('const startedAt =');
  const routeIndex = invoke.indexOf('routeExactInputSplitAnytime(');
  const finishedIndex = invoke.indexOf('const finishedAt =');
  const returnIndex = invoke.indexOf('return Object.freeze');
  assert.equal(
    controlIndex < startedIndex
      && startedIndex < routeIndex
      && routeIndex < finishedIndex
      && finishedIndex < returnIndex,
    true,
  );
  assert.equal(invoke.match(/routeExactInputSplitAnytime\s*\(/gu)?.length, 1);
  assert.equal(invoke.includes('validateCellResult'), false);
  assert.equal(invoke.includes('projectCanonicalSplitRouterResult'), false);

  const observed = source.slice(
    source.indexOf('function runObservedCell('),
    source.indexOf('function buildObservations('),
  );
  const requestIndex = observed.indexOf('const request = runtimeRequest');
  const invocationIndex = observed.indexOf('const invoked = invokeCell');
  const validationIndex = observed.indexOf('validateCellResult');
  const projectionIndex = observed.indexOf('projectCanonicalSplitRouterResult');
  assert.equal(
    requestIndex < invocationIndex
      && invocationIndex < validationIndex
      && validationIndex < projectionIndex,
    true,
  );

  const verifier = source.slice(source.indexOf('export async function verifyHistoricalComposedSplitEvaluation('));
  const semanticComparisonIndex = verifier.indexOf('semanticArtifact.parsed.text !== semantic.json');
  const observationReadIndex = verifier.indexOf('const observationsArtifact = await readDeclaredArtifact');
  assert.ok(semanticComparisonIndex >= 0);
  assert.equal(semanticComparisonIndex < observationReadIndex, true);
});
