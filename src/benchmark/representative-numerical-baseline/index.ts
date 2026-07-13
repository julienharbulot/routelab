import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  parseLiquiditySnapshot,
  type ConstantProductPool,
  type LiquiditySnapshot,
} from '../../domain/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  type NumericalExactInputSplitDiagnostic,
  type NumericalExactInputSplitRuntimeResult,
  type NumericalExactInputSplitWorkCounters,
} from '../../router/numerical-exact-input-split/index.ts';
import {
  parseAndPrepareRoutingContext,
  resolvePreparedPathShadowPriceRoutes,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import { discoverSharedRoutes } from '../../search/shared-route-discovery/index.ts';
import {
  computeCanonicalSnapshotChecksum,
} from '../../serialization/canonical-snapshot/index.ts';
import {
  projectCanonicalSplitRouterResult,
  projectCanonicalSplitRouterWorkCounters,
} from '../../serialization/canonical-split-router-result/index.ts';
import {
  CANONICAL_HISTORICAL_DATASET_DIRECTORY,
  verifyHistoricalDataset,
} from '../../verification/historical-dataset/index.ts';

export const REPRESENTATIVE_PROFILE_CONFIG_DIRECTORY =
  'fixtures/m7/numerical-representative-profile';
export const REPRESENTATIVE_STRESS_SUITE_DIRECTORY =
  'datasets/stress/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1';
export const REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1';
export const REPRESENTATIVE_BASELINE_DIRECTORY =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1/numerical-preprofile-baseline-v1';

const SUITE_CONFIG_PATH = `${REPRESENTATIVE_PROFILE_CONFIG_DIRECTORY}/snapshot-suite-config.v1.json`;
const BASELINE_CONFIG_PATH = `${REPRESENTATIVE_PROFILE_CONFIG_DIRECTORY}/baseline-config.v1.json`;
const RUNTIME_SOURCE_PATH = 'src/router/numerical-exact-input-split/index.ts';
const NUMERICAL_COMPARISON_CONFIG_PATH =
  'fixtures/m7/numerical-historical/comparison-config.v1.json';
const HISTORICAL_ELIGIBILITY_PATH = 'fixtures/m7/numerical-historical/eligibility.v1.json';
const HISTORICAL_SEMANTIC_PATH =
  'datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/numerical-path-shadow-price-v1/semantic-results.json';
const HISTORICAL_REQUESTS_PATH =
  'datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/requests.json';
const HISTORICAL_SNAPSHOT_PATH = `${CANONICAL_HISTORICAL_DATASET_DIRECTORY}/snapshot.json`;

const BINDINGS = Object.freeze({
  suiteConfig: Object.freeze({ path: SUITE_CONFIG_PATH, bytes: 8_842, sha256: 'sha256:c2391d79a230d532918339a390b9150a58789a9263a906cae1ea4192219361c1' }),
  baselineConfig: Object.freeze({ path: BASELINE_CONFIG_PATH, bytes: 6_813, sha256: 'sha256:fb35f57912007bb4a72835cb1aecb49c3110049e5f097dca029960f65bcfb73a' }),
  runtimeSource: Object.freeze({ path: RUNTIME_SOURCE_PATH, bytes: 55_869, sha256: 'sha256:f43365addfa4378eea98d2af2027eafbac2eebc173482a07a06604bd963c8305' }),
  numericalComparisonConfig: Object.freeze({ path: NUMERICAL_COMPARISON_CONFIG_PATH, bytes: 4_650, sha256: 'sha256:96ceb8b4441e9e81c40b5662f948e91bee661a0205469b70a5dbd4e4bbb4aff6' }),
  historicalEligibility: Object.freeze({ path: HISTORICAL_ELIGIBILITY_PATH, bytes: 261_915, sha256: 'sha256:5ed542c5da28a0a03eb88bece5b04cea623877b4760cea1ccdc0b27b5b91bbdc' }),
  historicalSemantic: Object.freeze({ path: HISTORICAL_SEMANTIC_PATH, bytes: 21_698_448, sha256: 'sha256:96c123b72fd73aed2d6063f17d4f0e6ad90e834cd752959ec693598dec329661' }),
  historicalRequests: Object.freeze({ path: HISTORICAL_REQUESTS_PATH, bytes: 99_301, sha256: 'sha256:c470f0a33b5d03cdd1ac8d88c92a8e2ec79b78f7d488541c0f4a321ff3e03173' }),
  historicalSnapshot: Object.freeze({ path: HISTORICAL_SNAPSHOT_PATH, bytes: 18_502, sha256: 'sha256:4c43d4920f0edb487a262f1d321ba4790d07c7563e2a3b0157c5b51122fb3478' }),
});

const CASES = Object.freeze([
  Object.freeze({
    caseId: 'historical-anchor',
    classification: 'historical-stored-reserve-anchor',
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1',
    snapshotChecksum: 'sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755',
    poolCount: 54,
  }),
  Object.freeze({
    caseId: 'synthetic-dual-spanning-tree',
    classification: 'synthetic-topology-work-stress',
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-dual-spanning-tree-v1',
    snapshotChecksum: 'sha256:76a6d1b90541af4b799c2aa7a9fa6bdf49a7bac0398fba4d9ee32bb1c81f6832',
    poolCount: 22,
  }),
  Object.freeze({
    caseId: 'synthetic-reserve-compressed-1e12',
    classification: 'synthetic-floor-and-activation-stress',
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-reserve-compressed-1e12-v1',
    snapshotChecksum: 'sha256:bc28e5ef7cbe5709995c4dba56e2313996334df0107775e10218c9fe0878deb1',
    poolCount: 54,
  }),
  Object.freeze({
    caseId: 'synthetic-reserve-amplified-1e60',
    classification: 'synthetic-arbitrary-precision-magnitude-stress',
    snapshotId: 'ethereum-mainnet-uniswap-v2-block-19000000-core12-v1-synthetic-reserve-amplified-1e60-v1',
    snapshotChecksum: 'sha256:40c3abaa585d2bb48a5e167577afc9ac17f3dec7944967536fd375c7bb501575',
    poolCount: 54,
  }),
] as const);

const FIRST_TREE_POOL_IDS = new Set([
  '0x004375dff511095cc5a197a54140a24efef3a416', '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852',
  '0x0de0fa91b6dbab8c8503aaa2d1dfa91a192cb149', '0x1f447690a6ddf18400533b705516159e1312f892',
  '0x210a97ba874a8e279c95b350ae8ba143a143c159', '0x231b7589426ffe1b75405526fc32ac09d44364c4',
  '0x2fdbadf3c4d5a8666bc06645b8358ab803996e28', '0x340a5a2f73ebaa181ec2826802fdf8ed21fc759a',
  '0x5ac13261c181a9c3938bfe1b649e65d10f98566b', '0x6d4fd456edeca58cf53a8b586cd50754547dbdb2',
  '0x6f81d90e771b551451382b4c8b41c86b978d3420',
]);
const SECOND_TREE_POOL_IDS = new Set([
  '0x3041cbd36888becc7bbcbc0045e3b1f144466f5f', '0x38e12fdd8dc51e48830863151e1afa7799e6fe97',
  '0x3cd132ac73a4043bb4f1674369e70be6f88edd73', '0x3da1313ae46132a397d90d95b1424a9a7e3e0fce',
  '0x3eed0af1c5f350c6571525d9e3eeea7d2608af81', '0x48978ef5beb2d69e27def9c046cebe18ab5708ad',
  '0x517f9dd285e75b599234f7221227339478d0fcc8', '0x674e114dad81838d151d9beda2271228eeae0e8b',
  '0x71aa44cbed2ca17077aee7c5087e86a53fc01f6e', '0x72ef722d2a6c3b72e6113b6f3f1c62c75aa152e5',
  '0x8a01ba64fbc7b12ee13f817dfa862881fec531b8',
]);

const BUCKETS = Object.freeze([
  Object.freeze({ id: 'max-reserve-1-in-100000', denominator: 100_000n }),
  Object.freeze({ id: 'max-reserve-1-in-10000', denominator: 10_000n }),
  Object.freeze({ id: 'max-reserve-1-in-1000', denominator: 1_000n }),
]);
const NUMERICAL = Object.freeze({ outerIterations: 64, innerIterations: 64, convergenceTolerance: 2 ** -40 });
const WORK_CAPS = Object.freeze({
  maxPathExpansions: 121,
  maxBestSingleCandidateReplays: 11,
  maxCandidateSetExpansions: 110,
  maxEqualProposalReplays: 55,
  maxGreedyOptionReplays: 1760,
  maxFinalAuthorizationReplays: 110,
  maxNumericalProposals: 55,
  maxNumericalIterations: 3520,
  maxNumericalResidualReplays: 110,
  maxNumericalAuthorizationReplays: 55,
});
const LIMITATIONS = Object.freeze([
  'The suite contains one accepted historical stored-reserve anchor and three deterministic synthetic stress cases; synthetic cases are not historical observations.',
  'The exhaustive requests are exact reserve fractions, not historical demand, equal-value notionals, production traffic, or statistical market samples.',
  'Results are timing-free and preserve separate work counters; they establish no latency, speedup, production, or unrestricted-optimality claim.',
  'Approximate numerical allocation only proposes candidates; fresh exact replay alone authorizes every retained incumbent.',
]);

type CaseId = (typeof CASES)[number]['caseId'];
type Topology = 'direct-edge-present' | 'direct-edge-absent-common-neighbor-present' | 'direct-edge-absent-no-common-neighbor';
type EligibilityReason = 'baseline-no-authorized-incumbent' | 'path-discovery-incomplete' | 'candidate-set-discovery-incomplete' | 'no-model-valid-candidate-set';
type JsonObject = Record<string, unknown>;

export interface RepresentativeRequest {
  readonly requestId: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountBucket: string;
  readonly amountIn: bigint;
  readonly topology: Topology;
}

export interface RepresentativeCase {
  readonly caseId: CaseId;
  readonly classification: string;
  readonly snapshot: LiquiditySnapshot;
  readonly context: PreparedRoutingContext;
  readonly requests: readonly RepresentativeRequest[];
}

export interface RepresentativeBaselineDependencies {
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly versions: Readonly<{ node: string; v8: string; uv: string }>;
  readonly route?: typeof routeExactInputSplitNumericalAnytime;
}

export interface RepresentativeBaselineArtifacts {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly summary: Readonly<{
    caseCount: 4;
    requestCount: 1584;
    cellCount: 1584;
    eligibleCounts: Readonly<Record<CaseId, number>>;
    orderedEligibleCellSha256: string;
  }>;
}

export type RepresentativeBaselineResult =
  | { readonly ok: true; readonly value: RepresentativeBaselineArtifacts }
  | { readonly ok: false; readonly error: Readonly<{ code: string; artifact: string; message: string }> };

function failure(code: string, artifact: string, message: string): RepresentativeBaselineResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, artifact, message }) });
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function descriptor(filePath: string, bytes: Uint8Array): object {
  return { path: filePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function readBound(
  dependencies: RepresentativeBaselineDependencies,
  binding: Readonly<{ path: string; bytes: number; sha256: string }>,
): Promise<Uint8Array> {
  const bytes = Uint8Array.from(await dependencies.readFile(binding.path));
  if (bytes.byteLength !== binding.bytes || sha256(bytes) !== binding.sha256) {
    throw new BaselineAbort('input-binding-mismatch', binding.path);
  }
  return bytes;
}

function parseJson(bytes: Uint8Array, artifact: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new BaselineAbort('invalid-json', artifact);
  }
}

class BaselineAbort extends Error {
  readonly code: string;
  readonly artifact: string;

  constructor(code: string, artifact: string) {
    super(`${code}: ${artifact}`);
    this.code = code;
    this.artifact = artifact;
  }
}

function clonePool(pool: ConstantProductPool, transform: (reserve: bigint) => bigint): ConstantProductPool {
  return Object.freeze({
    poolId: pool.poolId,
    asset0: pool.asset0,
    reserve0: transform(pool.reserve0),
    asset1: pool.asset1,
    reserve1: transform(pool.reserve1),
    feeChargedNumerator: pool.feeChargedNumerator,
    feeDenominator: pool.feeDenominator,
  });
}

function derivedSnapshot(
  caseIndex: 1 | 2 | 3,
  pools: readonly ConstantProductPool[],
): LiquiditySnapshot {
  const declared = CASES[caseIndex];
  const candidate: LiquiditySnapshot = Object.freeze({
    snapshotId: declared.snapshotId,
    snapshotChecksum: declared.snapshotChecksum,
    pools: Object.freeze([...pools]),
  });
  if (pools.length !== declared.poolCount || computeCanonicalSnapshotChecksum(candidate) !== declared.snapshotChecksum) {
    throw new BaselineAbort('derived-snapshot-mismatch', declared.caseId);
  }
  const prepared = parseAndPrepareRoutingContext(projectSnapshot(candidate));
  if (!prepared.ok) throw new BaselineAbort('derived-snapshot-invalid', declared.caseId);
  return candidate;
}

function buildSnapshots(source: LiquiditySnapshot): readonly LiquiditySnapshot[] {
  if (source.snapshotId !== CASES[0].snapshotId || source.snapshotChecksum !== CASES[0].snapshotChecksum || source.pools.length !== 54) {
    throw new BaselineAbort('historical-snapshot-mismatch', HISTORICAL_SNAPSHOT_PATH);
  }
  const treeIds = new Set([...FIRST_TREE_POOL_IDS, ...SECOND_TREE_POOL_IDS]);
  const treePools = source.pools.filter((pool) => treeIds.has(pool.poolId));
  const divisor = 1_000_000_000_000n;
  const multiplier = 10n ** 60n;
  return Object.freeze([
    source,
    derivedSnapshot(1, treePools),
    derivedSnapshot(2, source.pools.map((pool) => clonePool(pool, (reserve) => {
      const divided = reserve / divisor;
      return divided < 1n ? 1n : divided;
    }))),
    derivedSnapshot(3, source.pools.map((pool) => clonePool(pool, (reserve) => reserve * multiplier))),
  ]);
}

function projectSnapshot(snapshot: LiquiditySnapshot): object {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    pools: snapshot.pools.map((pool) => ({
      poolId: pool.poolId,
      asset0: pool.asset0,
      reserve0: pool.reserve0.toString(10),
      asset1: pool.asset1,
      reserve1: pool.reserve1.toString(10),
      feeChargedNumerator: pool.feeChargedNumerator.toString(10),
      feeDenominator: pool.feeDenominator.toString(10),
    })),
  };
}

function classifyTopology(adjacency: ReadonlyMap<string, ReadonlySet<string>>, assetIn: string, assetOut: string): Topology {
  const inputNeighbors = adjacency.get(assetIn) ?? new Set<string>();
  if (inputNeighbors.has(assetOut)) return 'direct-edge-present';
  const outputNeighbors = adjacency.get(assetOut) ?? new Set<string>();
  for (const neighbor of inputNeighbors) {
    if (outputNeighbors.has(neighbor)) return 'direct-edge-absent-common-neighbor-present';
  }
  return 'direct-edge-absent-no-common-neighbor';
}

function buildRequests(snapshot: LiquiditySnapshot): readonly RepresentativeRequest[] {
  const assets = [...new Set(snapshot.pools.flatMap((pool) => [pool.asset0, pool.asset1]))].sort();
  if (assets.length !== 12) throw new BaselineAbort('asset-count-mismatch', snapshot.snapshotId);
  const adjacency = new Map<string, Set<string>>(assets.map((asset) => [asset, new Set<string>()]));
  const maxReserve = new Map<string, bigint>(assets.map((asset) => [asset, 0n]));
  for (const pool of snapshot.pools) {
    adjacency.get(pool.asset0)?.add(pool.asset1);
    adjacency.get(pool.asset1)?.add(pool.asset0);
    if (pool.reserve0 > (maxReserve.get(pool.asset0) ?? 0n)) maxReserve.set(pool.asset0, pool.reserve0);
    if (pool.reserve1 > (maxReserve.get(pool.asset1) ?? 0n)) maxReserve.set(pool.asset1, pool.reserve1);
  }
  const requests: RepresentativeRequest[] = [];
  for (const assetIn of assets) {
    for (const assetOut of assets) {
      if (assetIn === assetOut) continue;
      for (const bucket of BUCKETS) {
        const quotient = (maxReserve.get(assetIn) ?? 0n) / bucket.denominator;
        requests.push(Object.freeze({
          requestId: `request-${String(requests.length + 1).padStart(4, '0')}`,
          assetIn,
          assetOut,
          amountBucket: bucket.id,
          amountIn: quotient < 1n ? 1n : quotient,
          topology: classifyTopology(adjacency, assetIn, assetOut),
        }));
      }
    }
  }
  if (requests.length !== 396) throw new BaselineAbort('request-count-mismatch', snapshot.snapshotId);
  return Object.freeze(requests);
}

function projectRequest(request: RepresentativeRequest): object {
  return {
    requestId: request.requestId,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    amountBucket: request.amountBucket,
    amountIn: request.amountIn.toString(10),
    topology: request.topology,
  };
}

function projectNumericalCounters(counters: NumericalExactInputSplitWorkCounters): object {
  return {
    ...projectCanonicalSplitRouterWorkCounters(counters),
    numericalProposals: counters.numericalProposals,
    numericalProposalFailures: counters.numericalProposalFailures,
    numericalIterations: counters.numericalIterations,
    numericalResidualReplays: counters.numericalResidualReplays,
    numericalResidualReplayRejections: counters.numericalResidualReplayRejections,
    numericalAuthorizationReplays: counters.numericalAuthorizationReplays,
    numericalAuthorizationReplayRejections: counters.numericalAuthorizationReplayRejections,
  };
}

function projectDiagnostic(diagnostic: NumericalExactInputSplitDiagnostic): object {
  return {
    candidateSetKey: diagnostic.candidateSetKey,
    routeKeys: diagnostic.routeKeys,
    status: diagnostic.status,
    failureCode: diagnostic.failureCode,
    converged: diagnostic.converged,
    completedOuterIterations: diagnostic.completedOuterIterations,
    configuredInnerIterations: diagnostic.configuredInnerIterations,
    residualUnits: diagnostic.residualUnits === null ? null : diagnostic.residualUnits.toString(10),
    counters: {
      numericalProposals: diagnostic.counters.numericalProposals,
      numericalProposalFailures: diagnostic.counters.numericalProposalFailures,
      numericalIterations: diagnostic.counters.numericalIterations,
      numericalResidualReplays: diagnostic.counters.numericalResidualReplays,
      numericalResidualReplayRejections: diagnostic.counters.numericalResidualReplayRejections,
      numericalAuthorizationReplays: diagnostic.counters.numericalAuthorizationReplays,
      numericalAuthorizationReplayRejections: diagnostic.counters.numericalAuthorizationReplayRejections,
    },
  };
}

function searchOf(result: Exclude<NumericalExactInputSplitRuntimeResult, { status: 'invalid-request' | 'invalid-control' | 'control-error' | 'deadline-error' }>) {
  return result.status === 'success' ? result.plan.search : result.search;
}

function projectNumericalResult(result: NumericalExactInputSplitRuntimeResult): object {
  if (result.status === 'invalid-request' || result.status === 'invalid-control' || result.status === 'control-error' || result.status === 'deadline-error') {
    throw new BaselineAbort('runtime-result-invalid', result.status);
  }
  const base = projectCanonicalSplitRouterResult(result);
  const search = searchOf(result);
  if (result.status === 'success') {
    const plan = (base as { plan: JsonObject }).plan;
    return {
      status: 'success',
      plan: {
        receipt: plan['receipt'],
        search: {
          counters: projectNumericalCounters(search.counters),
          termination: search.termination,
          numericalDiagnostics: search.numericalDiagnostics.map(projectDiagnostic),
        },
      },
    };
  }
  return {
    status: result.status,
    reason: result.reason,
    search: {
      counters: projectNumericalCounters(search.counters),
      termination: search.termination,
      numericalDiagnostics: search.numericalDiagnostics.map(projectDiagnostic),
    },
  };
}

function classifyEligibility(
  context: PreparedRoutingContext,
  snapshot: LiquiditySnapshot,
  request: RepresentativeRequest,
  result: NumericalExactInputSplitRuntimeResult,
): Readonly<{ status: 'eligible'; search: object; modelValidCandidateSetCount: number } | { status: 'ineligible'; reason: EligibilityReason; search: object; modelValidCandidateSetCount: number }> {
  const discovery = discoverSharedRoutes(context, {
    snapshotId: snapshot.snapshotId,
    snapshotChecksum: snapshot.snapshotChecksum,
    assetIn: request.assetIn,
    assetOut: request.assetOut,
    maxHops: 2,
    maxPathExpansions: WORK_CAPS.maxPathExpansions,
    maxRoutes: 2,
    maxCandidateSetExpansions: WORK_CAPS.maxCandidateSetExpansions,
  });
  if (!discovery.ok) throw new BaselineAbort('eligibility-discovery-invalid', `${snapshot.snapshotId}/${request.requestId}`);
  const structuralSearch = {
    pathExpansions: discovery.value.search.pathExpansions,
    enumeratedPaths: discovery.value.search.enumeratedPaths,
    pathTermination: discovery.value.search.pathTermination,
    candidateSetExpansions: discovery.value.search.candidateSetExpansions,
    enumeratedCandidateSets: discovery.value.search.enumeratedCandidateSets,
    candidateSetTermination: discovery.value.search.candidateSetTermination,
  };
  const modelValidCandidateSetCount = discovery.value.candidateSets.filter(({ routes }) =>
    resolvePreparedPathShadowPriceRoutes(context, routes).ok).length;
  let reason: EligibilityReason | undefined;
  if (result.status !== 'success') reason = 'baseline-no-authorized-incumbent';
  else if (discovery.value.search.pathTermination !== 'complete') reason = 'path-discovery-incomplete';
  else if (discovery.value.search.candidateSetTermination !== 'complete') reason = 'candidate-set-discovery-incomplete';
  else if (modelValidCandidateSetCount === 0) reason = 'no-model-valid-candidate-set';
  return reason === undefined
    ? Object.freeze({ status: 'eligible', search: structuralSearch, modelValidCandidateSetCount })
    : Object.freeze({ status: 'ineligible', reason, search: structuralSearch, modelValidCandidateSetCount });
}

function assertVersions(versions: RepresentativeBaselineDependencies['versions']): void {
  if (versions.node !== 'v24.18.0' || versions.v8 !== '13.6.233.17-node.50' || versions.uv !== '1.52.1') {
    throw new BaselineAbort('runtime-version-mismatch', 'process.versions');
  }
}

function parseRecord(value: unknown, artifact: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BaselineAbort('invalid-json-shape', artifact);
  return value as JsonObject;
}

function artifactPath(directory: string, fileName: string): string {
  return `${directory}/${fileName}`;
}

export async function createRepresentativeNumericalBaseline(
  dependencies: RepresentativeBaselineDependencies,
): Promise<RepresentativeBaselineResult> {
  try {
    assertVersions(dependencies.versions);
    const [, , , , historicalEligibilityBytes, historicalSemanticBytes, historicalRequestsBytes, historicalSnapshotBytes] = await Promise.all([
      readBound(dependencies, BINDINGS.suiteConfig),
      readBound(dependencies, BINDINGS.baselineConfig),
      readBound(dependencies, BINDINGS.runtimeSource),
      readBound(dependencies, BINDINGS.numericalComparisonConfig),
      readBound(dependencies, BINDINGS.historicalEligibility),
      readBound(dependencies, BINDINGS.historicalSemantic),
      readBound(dependencies, BINDINGS.historicalRequests),
      readBound(dependencies, BINDINGS.historicalSnapshot),
    ]);
    const historicalVerification = await verifyHistoricalDataset(CANONICAL_HISTORICAL_DATASET_DIRECTORY, { readFile: dependencies.readFile });
    if (!historicalVerification.ok) throw new BaselineAbort('historical-dataset-invalid', historicalVerification.error.artifact);
    const sourceParsed = parseLiquiditySnapshot(parseJson(historicalSnapshotBytes, HISTORICAL_SNAPSHOT_PATH));
    if (!sourceParsed.ok) throw new BaselineAbort('historical-snapshot-invalid', HISTORICAL_SNAPSHOT_PATH);
    const snapshots = buildSnapshots(sourceParsed.value);
    const historicalRequests = parseRecord(parseJson(historicalRequestsBytes, HISTORICAL_REQUESTS_PATH), HISTORICAL_REQUESTS_PATH);
    const historicalSemantic = parseRecord(parseJson(historicalSemanticBytes, HISTORICAL_SEMANTIC_PATH), HISTORICAL_SEMANTIC_PATH);
    const historicalEligibility = parseRecord(parseJson(historicalEligibilityBytes, HISTORICAL_ELIGIBILITY_PATH), HISTORICAL_ELIGIBILITY_PATH);
    if (!Array.isArray(historicalRequests['requests']) || !Array.isArray(historicalSemantic['cells']) || !Array.isArray(historicalEligibility['cells'])) {
      throw new BaselineAbort('historical-cross-check-invalid', 'historical-artifacts');
    }

    const cases: RepresentativeCase[] = [];
    for (let index = 0; index < CASES.length; index += 1) {
      const declared = CASES[index];
      const snapshot = snapshots[index];
      if (declared === undefined || snapshot === undefined) throw new BaselineAbort('suite-shape-invalid', 'case-order');
      const prepared = index === 0
        ? Object.freeze({ ok: true as const, value: historicalVerification.value.context })
        : parseAndPrepareRoutingContext(projectSnapshot(snapshot));
      if (!prepared.ok) throw new BaselineAbort('snapshot-preparation-failed', declared.caseId);
      const requests = buildRequests(snapshot);
      cases.push(Object.freeze({ caseId: declared.caseId, classification: declared.classification, snapshot, context: prepared.value, requests }));
    }
    if (!isDeepStrictEqual(cases[0]?.requests.map(projectRequest), historicalRequests['requests'])) {
      throw new BaselineAbort('historical-request-projection-mismatch', HISTORICAL_REQUESTS_PATH);
    }

    const route = dependencies.route ?? routeExactInputSplitNumericalAnytime;
    const semanticCells: object[] = [];
    const eligibilityCells: object[] = [];
    const eligibleIdentities: object[] = [];
    const eligibleCounts = Object.fromEntries(CASES.map(({ caseId }) => [caseId, 0])) as Record<CaseId, number>;
    const ineligibleReasons = Object.fromEntries(CASES.map(({ caseId }) => [caseId, {
      'baseline-no-authorized-incumbent': 0,
      'path-discovery-incomplete': 0,
      'candidate-set-discovery-incomplete': 0,
      'no-model-valid-candidate-set': 0,
    }])) as Record<CaseId, Record<EligibilityReason, number>>;

    for (const suiteCase of cases) {
      for (let requestIndex = 0; requestIndex < suiteCase.requests.length; requestIndex += 1) {
        const request = suiteCase.requests[requestIndex];
        if (request === undefined) throw new BaselineAbort('request-schedule-invalid', suiteCase.caseId);
        const result = route(suiteCase.context, Object.freeze({
          snapshotId: suiteCase.snapshot.snapshotId,
          snapshotChecksum: suiteCase.snapshot.snapshotChecksum,
          assetIn: request.assetIn,
          assetOut: request.assetOut,
          amountIn: request.amountIn,
          maxHops: 2,
          maxRoutes: 2,
          greedyParts: 16,
          numerical: NUMERICAL,
        }), Object.freeze({ workCaps: WORK_CAPS }));
        const projectedResult = projectNumericalResult(result);
        const eligibility = classifyEligibility(suiteCase.context, suiteCase.snapshot, request, result);
        if (suiteCase.caseId === 'historical-anchor') {
          const priorCell = historicalSemantic['cells'][requestIndex * 6 + 5] as JsonObject | undefined;
          const priorEligibility = historicalEligibility['cells'][requestIndex * 6 + 5] as JsonObject | undefined;
          if (priorCell?.['result'] === undefined || !isDeepStrictEqual(priorCell['result'], projectedResult)
            || priorEligibility?.['status'] !== 'eligible' || eligibility.status !== 'eligible') {
            throw new BaselineAbort('historical-result-cross-check-mismatch', request.requestId);
          }
        }
        const common = { caseId: suiteCase.caseId, requestId: request.requestId };
        semanticCells.push({ ...common, result: projectedResult });
        eligibilityCells.push({ ...common, ...eligibility });
        if (eligibility.status === 'eligible') {
          eligibleCounts[suiteCase.caseId] += 1;
          eligibleIdentities.push(common);
        } else {
          ineligibleReasons[suiteCase.caseId][eligibility.reason] += 1;
        }
      }
      if (eligibleCounts[suiteCase.caseId] === 0) throw new BaselineAbort('empty-eligible-case-cohort', suiteCase.caseId);
      const caseCells = eligibilityCells.slice(-396) as Array<{ status?: string; search?: { candidateSetExpansions?: number } }>;
      if (!caseCells.some((cell) => cell.status === 'eligible' && (cell.search?.candidateSetExpansions ?? 0) > 0)) {
        throw new BaselineAbort('no-positive-candidate-set-work', suiteCase.caseId);
      }
    }

    const requestsDocument = {
      schemaVersion: 'routelab.supported-regime-request-corpus.v1',
      corpusId: 'm7b-core12-supported-regime-exhaustive-requests-v1',
      suiteId: 'm7b-core12-supported-regime-suite-v1',
      cases: cases.map((suiteCase) => ({
        caseId: suiteCase.caseId,
        snapshotId: suiteCase.snapshot.snapshotId,
        snapshotChecksum: suiteCase.snapshot.snapshotChecksum,
        requests: suiteCase.requests.map(projectRequest),
      })),
    };
    const requestsBytes = jsonBytes(requestsDocument);
    const requestManifestBytes = jsonBytes({
      schemaVersion: 'routelab.supported-regime-request-corpus-manifest.v1',
      corpusId: 'm7b-core12-supported-regime-exhaustive-requests-v1',
      inputBinding: { suiteConfig: BINDINGS.suiteConfig },
      schedule: { caseOrder: CASES.map(({ caseId }) => caseId), requestCountPerCase: 396, totalRequestCount: 1584 },
      artifact: descriptor('requests.json', requestsBytes),
      limitations: LIMITATIONS,
    });

    const derivedSnapshotFiles = cases.slice(1).map((suiteCase) => {
      const fileName = `${suiteCase.caseId}.snapshot.json`;
      return Object.freeze({ suiteCase, fileName, bytes: jsonBytes(projectSnapshot(suiteCase.snapshot)) });
    });
    const stressManifestBytes = jsonBytes({
      schemaVersion: 'routelab.supported-regime-snapshot-suite-manifest.v1',
      suiteId: 'm7b-core12-supported-regime-suite-v1',
      inputBinding: { suiteConfig: BINDINGS.suiteConfig, historicalDatasetDirectory: CANONICAL_HISTORICAL_DATASET_DIRECTORY, historicalSnapshot: BINDINGS.historicalSnapshot },
      cases: cases.map((suiteCase, index) => ({
        caseId: suiteCase.caseId,
        classification: suiteCase.classification,
        snapshotId: suiteCase.snapshot.snapshotId,
        snapshotChecksum: suiteCase.snapshot.snapshotChecksum,
        poolCount: suiteCase.snapshot.pools.length,
        artifact: index === 0 ? BINDINGS.historicalSnapshot : descriptor(derivedSnapshotFiles[index - 1]?.fileName ?? '', derivedSnapshotFiles[index - 1]?.bytes ?? new Uint8Array()),
      })),
      limitations: LIMITATIONS,
    });

    const semanticBytes = jsonBytes({
      schemaVersion: 'routelab.numerical-representative-semantic-results.v1',
      baselineId: 'm7b-core12-supported-regime-numerical-preprofile-baseline-v1',
      inputBinding: { suiteConfig: BINDINGS.suiteConfig, baselineConfig: BINDINGS.baselineConfig, runtimeSource: BINDINGS.runtimeSource, numericalComparisonConfig: BINDINGS.numericalComparisonConfig },
      schedule: { caseOrder: CASES.map(({ caseId }) => caseId), requestOrder: 'case-corpus-source-order', cellCountPerCase: 396, totalCellCount: 1584 },
      cells: semanticCells,
      limitations: LIMITATIONS,
    });
    const eligibilityBytes = jsonBytes({
      schemaVersion: 'routelab.numerical-representative-eligibility.v1',
      baselineId: 'm7b-core12-supported-regime-numerical-preprofile-baseline-v1',
      inputBinding: { suiteConfig: BINDINGS.suiteConfig, baselineConfig: BINDINGS.baselineConfig },
      classification: { precedence: ['baseline-no-authorized-incumbent', 'path-discovery-incomplete', 'candidate-set-discovery-incomplete', 'no-model-valid-candidate-set', 'eligible'], eligibleCounts, ineligibleReasons },
      orderedEligibleCellSha256: sha256(JSON.stringify(eligibleIdentities)),
      cells: eligibilityCells,
    });
    const baselineManifestBytes = jsonBytes({
      schemaVersion: 'routelab.numerical-representative-baseline-manifest.v1',
      baselineId: 'm7b-core12-supported-regime-numerical-preprofile-baseline-v1',
      inputBinding: {
        suiteConfig: BINDINGS.suiteConfig,
        baselineConfig: BINDINGS.baselineConfig,
        runtimeSource: BINDINGS.runtimeSource,
        numericalComparisonConfig: BINDINGS.numericalComparisonConfig,
        historicalCrossCheck: { eligibility: BINDINGS.historicalEligibility, semanticResults: BINDINGS.historicalSemantic },
      },
      executionRuntime: dependencies.versions,
      counts: { caseCount: 4, requestCount: 1584, cellCount: 1584, eligibleCounts },
      artifacts: {
        stressSuiteManifest: descriptor(`${REPRESENTATIVE_STRESS_SUITE_DIRECTORY}/manifest.json`, stressManifestBytes),
        requestManifest: descriptor(`${REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY}/manifest.json`, requestManifestBytes),
        requests: descriptor(`${REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY}/requests.json`, requestsBytes),
        semanticResults: descriptor('semantic-results.json', semanticBytes),
        eligibility: descriptor('eligibility.json', eligibilityBytes),
      },
      orderedEligibleCellSha256: sha256(JSON.stringify(eligibleIdentities)),
      limitations: LIMITATIONS,
    });

    const files = new Map<string, Uint8Array>();
    files.set(artifactPath(REPRESENTATIVE_STRESS_SUITE_DIRECTORY, 'manifest.json'), stressManifestBytes);
    for (const artifact of derivedSnapshotFiles) files.set(artifactPath(REPRESENTATIVE_STRESS_SUITE_DIRECTORY, artifact.fileName), artifact.bytes);
    files.set(artifactPath(REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY, 'manifest.json'), requestManifestBytes);
    files.set(artifactPath(REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY, 'requests.json'), requestsBytes);
    files.set(artifactPath(REPRESENTATIVE_BASELINE_DIRECTORY, 'manifest.json'), baselineManifestBytes);
    files.set(artifactPath(REPRESENTATIVE_BASELINE_DIRECTORY, 'semantic-results.json'), semanticBytes);
    files.set(artifactPath(REPRESENTATIVE_BASELINE_DIRECTORY, 'eligibility.json'), eligibilityBytes);
    const total = [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    if (stressManifestBytes.byteLength + derivedSnapshotFiles.reduce((sum, artifact) => sum + artifact.bytes.byteLength, 0) > 524_288
      || requestManifestBytes.byteLength + requestsBytes.byteLength > 1_048_576
      || semanticBytes.byteLength > 134_217_728 || eligibilityBytes.byteLength > 8_388_608
      || baselineManifestBytes.byteLength > 1_048_576 || total > 150_994_944) {
      throw new BaselineAbort('resource-cap-exceeded', 'generated-output');
    }
    return Object.freeze({ ok: true, value: Object.freeze({
      files,
      summary: Object.freeze({ caseCount: 4 as const, requestCount: 1584 as const, cellCount: 1584 as const, eligibleCounts: Object.freeze({ ...eligibleCounts }), orderedEligibleCellSha256: sha256(JSON.stringify(eligibleIdentities)) }),
    }) });
  } catch (error) {
    if (error instanceof BaselineAbort) return failure(error.code, error.artifact, error.message);
    return failure('baseline-generation-failed', 'generation', error instanceof Error ? error.message : 'Unknown baseline generation failure.');
  }
}

export function defaultRepresentativeBaselineDependencies(): RepresentativeBaselineDependencies {
  return Object.freeze({
    readFile: async (filePath: string) => Uint8Array.from(await readFile(filePath)),
    versions: Object.freeze({ node: process.version, v8: process.versions.v8, uv: process.versions.uv }),
  });
}

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

export async function writeRepresentativeNumericalBaseline(
  artifacts: RepresentativeBaselineArtifacts,
  repositoryRoot = '.',
): Promise<void> {
  const directories = [REPRESENTATIVE_STRESS_SUITE_DIRECTORY, REPRESENTATIVE_REQUEST_CORPUS_DIRECTORY, REPRESENTATIVE_BASELINE_DIRECTORY];
  const staged: Array<{ destination: string; staging: string }> = [];
  try {
    for (const directory of directories) {
      const destination = path.resolve(repositoryRoot, directory);
      if (await exists(destination)) throw new BaselineAbort('destination-exists', directory);
      await mkdir(path.dirname(destination), { recursive: true });
      const staging = `${destination}.staging-${process.pid}-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`;
      if (await exists(staging)) throw new BaselineAbort('staging-exists', directory);
      await mkdir(staging);
      staged.push({ destination, staging });
      for (const [filePath, bytes] of artifacts.files) {
        if (!filePath.startsWith(`${directory}/`)) continue;
        const relative = filePath.slice(directory.length + 1);
        if (relative.includes('/') || relative === '') throw new BaselineAbort('invalid-output-path', filePath);
        await writeFile(path.join(staging, relative), bytes, { flag: 'wx' });
      }
    }
    for (const item of staged) await rename(item.staging, item.destination);
  } catch (error) {
    for (const item of staged) await rm(item.staging, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyRepresentativeNumericalBaseline(
  dependencies: RepresentativeBaselineDependencies,
  repositoryRoot = '.',
): Promise<RepresentativeBaselineResult> {
  const expected = await createRepresentativeNumericalBaseline(dependencies);
  if (!expected.ok) return expected;
  for (const [filePath, expectedBytes] of expected.value.files) {
    let actual: Uint8Array;
    try { actual = Uint8Array.from(await readFile(path.resolve(repositoryRoot, filePath))); }
    catch { return failure('artifact-read-failed', filePath, `Could not read ${filePath}.`); }
    if (!isDeepStrictEqual(actual, expectedBytes)) return failure('artifact-byte-mismatch', filePath, `Artifact bytes differ from exact reconstruction: ${filePath}.`);
  }
  return expected;
}
