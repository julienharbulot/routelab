import type { PathShadowPriceResolvedRoute } from '../../../allocation/path-shadow-price/index.ts';
import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';
import type { ExactInputRouteReplayReceipt } from '../../../replay/exact-input-route/index.ts';
import {
  prepareServiceFastExperimentCell,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentResolvedCandidateSetInput,
} from '../evaluator-kernel.ts';
import {
  canonicalCandidateSetKey,
  canonicalRouteKey,
  sha256 as inputSha256,
  type DirectionalHopInput,
} from '../input/codec.ts';
import {
  serviceFastExperimentReceiptsEqual,
  serviceFastExperimentReceiptHash,
} from '../exact-replay.ts';
import type {
  ExperimentInputCaseSource,
  ExperimentInputOperations,
  ExperimentInputRequestSource,
  ExperimentInputSource,
} from '../input/build.ts';
import {
  type AcceptedInputRecord,
  type AcceptedJson,
  type AcceptedJsonObject,
} from './contract.ts';

const INPUT_FIELDS = Object.freeze([
  'schemaVersion',
  'sourceIndex',
  'caseId',
  'requestId',
  'snapshot',
  'request',
  'priorEligibility',
  'serviceDecisionMember',
  'amplifiedStressMember',
  'timingCohortIndex',
  'entryBaseline',
  'candidateDiscovery',
  'repairTargetSetIndex',
  'actionCeilingProfileId',
]);
const SNAPSHOT_FIELDS = Object.freeze(['snapshotId', 'snapshotChecksum']);
const REQUEST_FIELDS = Object.freeze([
  'assetIn',
  'assetOut',
  'amountBucket',
  'amountIn',
  'topology',
  'maxHops',
  'maxRoutes',
  'greedyParts',
]);
const PRIOR_ELIGIBILITY_FIELDS = Object.freeze([
  'status',
  'reason',
  'search',
  'modelValidCandidateSetCount',
]);
const PRIOR_SEARCH_FIELDS = Object.freeze([
  'pathExpansions',
  'enumeratedPaths',
  'pathTermination',
  'candidateSetExpansions',
  'enumeratedCandidateSets',
  'candidateSetTermination',
]);
const ENTRY_BASELINE_FIELDS = Object.freeze([
  'boundSemanticCellHash',
  'freshReplayMatchesBoundCell',
  'incumbent',
]);
const INCUMBENT_FIELDS = Object.freeze([
  'status',
  'reason',
  'receipt',
  'objective',
  'receiptHash',
]);
const OBJECTIVE_FIELDS = Object.freeze([
  'hasPlan',
  'amountOut',
  'legCount',
  'totalHops',
  'routeKeys',
  'allocations',
]);
const DISCOVERY_FIELDS = Object.freeze(['termination', 'counters', 'candidateSets']);
const DISCOVERY_COUNTER_FIELDS = Object.freeze([
  'pathExpansions',
  'enumeratedPaths',
  'candidateSetExpansions',
  'enumeratedCandidateSets',
]);
const CANDIDATE_SET_FIELDS = Object.freeze([
  'setIndex',
  'candidateSetKey',
  'routes',
  'resolutionStatus',
  'failureCode',
]);
const CANDIDATE_ROUTE_FIELDS = Object.freeze(['routeKey', 'hops', 'resolvedHops']);
const DIRECTIONAL_HOP_FIELDS = Object.freeze(['poolId', 'assetIn', 'assetOut']);
const RESOLVED_HOP_FIELDS = Object.freeze([
  'poolId',
  'assetIn',
  'assetOut',
  'reserveIn',
  'reserveOut',
  'feeChargedNumerator',
  'feeDenominator',
]);
const SPLIT_RECEIPT_FIELDS = Object.freeze([
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'amountOut',
  'legs',
]);
const SPLIT_LEG_FIELDS = Object.freeze(['allocation', 'receipt']);
const ROUTE_RECEIPT_FIELDS = Object.freeze([
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'amountOut',
  'hops',
]);
const RECEIPT_HOP_FIELDS = Object.freeze([
  'poolId',
  'assetIn',
  'assetOut',
  'amountIn',
  'amountOut',
  'reserveInBefore',
  'reserveOutBefore',
  'reserveInAfter',
  'reserveOutAfter',
]);

function object(value: AcceptedJson | undefined): AcceptedJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Accepted input object is invalid.');
  }
  return value as AcceptedJsonObject;
}

function list(value: AcceptedJson | undefined): readonly AcceptedJson[] {
  if (!Array.isArray(value)) throw new TypeError('Accepted input array is invalid.');
  return value as readonly AcceptedJson[];
}

function string(value: AcceptedJson | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Accepted input string is invalid.');
  }
  return value;
}

function integer(value: AcceptedJson | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Accepted input integer is invalid.');
  }
  return value;
}

function decimal(value: AcceptedJson | undefined): bigint {
  const text = string(value);
  if (!/^(0|[1-9][0-9]*)$/u.test(text)) throw new TypeError('Accepted input decimal is invalid.');
  return BigInt(text);
}

function exactKeys(value: AcceptedJsonObject, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Accepted input field order is invalid.');
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function routeReceipt(value: AcceptedJson): ExactInputRouteReplayReceipt {
  const source = object(value);
  exactKeys(source, ROUTE_RECEIPT_FIELDS);
  const receipt = Object.freeze({
    snapshotId: string(source['snapshotId']),
    snapshotChecksum: string(source['snapshotChecksum']),
    assetIn: string(source['assetIn']),
    assetOut: string(source['assetOut']),
    amountIn: decimal(source['amountIn']),
    amountOut: decimal(source['amountOut']),
    hops: Object.freeze(list(source['hops']).map((raw) => {
      const hop = object(raw);
      exactKeys(hop, RECEIPT_HOP_FIELDS);
      return Object.freeze({
        poolId: string(hop['poolId']),
        assetIn: string(hop['assetIn']),
        assetOut: string(hop['assetOut']),
        amountIn: decimal(hop['amountIn']),
        amountOut: decimal(hop['amountOut']),
        reserveInBefore: decimal(hop['reserveInBefore']),
        reserveOutBefore: decimal(hop['reserveOutBefore']),
        reserveInAfter: decimal(hop['reserveInAfter']),
        reserveOutAfter: decimal(hop['reserveOutAfter']),
      });
    })),
  });
  if (receipt.hops.length === 0 || receipt.hops.length > 2) {
    throw new TypeError('Accepted route receipt hop count is invalid.');
  }
  for (const [index, hop] of receipt.hops.entries()) {
    const prior = receipt.hops[index - 1];
    if (
      (index === 0 && (hop.assetIn !== receipt.assetIn || hop.amountIn !== receipt.amountIn)) ||
      (index === receipt.hops.length - 1 &&
        (hop.assetOut !== receipt.assetOut || hop.amountOut !== receipt.amountOut)) ||
      (prior !== undefined &&
        (hop.assetIn !== prior.assetOut || hop.amountIn !== prior.amountOut)) ||
      hop.reserveInAfter !== hop.reserveInBefore + hop.amountIn ||
      hop.reserveOutAfter !== hop.reserveOutBefore - hop.amountOut
    ) throw new TypeError('Accepted route receipt relation is invalid.');
  }
  return receipt;
}

function splitReceipt(value: AcceptedJson): ExactInputSplitReplayReceipt {
  const source = object(value);
  exactKeys(source, SPLIT_RECEIPT_FIELDS);
  const receipt = Object.freeze({
    snapshotId: string(source['snapshotId']),
    snapshotChecksum: string(source['snapshotChecksum']),
    assetIn: string(source['assetIn']),
    assetOut: string(source['assetOut']),
    amountIn: decimal(source['amountIn']),
    amountOut: decimal(source['amountOut']),
    legs: Object.freeze(list(source['legs']).map((raw) => {
      const leg = object(raw);
      exactKeys(leg, SPLIT_LEG_FIELDS);
      return Object.freeze({
        allocation: decimal(leg['allocation']),
        receipt: routeReceipt(leg['receipt'] as AcceptedJson),
      });
    })),
  });
  if (
    receipt.legs.length === 0 ||
    receipt.legs.some((leg) =>
      leg.allocation <= 0n ||
      leg.allocation !== leg.receipt.amountIn ||
      leg.receipt.snapshotId !== receipt.snapshotId ||
      leg.receipt.snapshotChecksum !== receipt.snapshotChecksum ||
      leg.receipt.assetIn !== receipt.assetIn ||
      leg.receipt.assetOut !== receipt.assetOut) ||
    receipt.legs.reduce((sum, leg) => sum + leg.allocation, 0n) !== receipt.amountIn ||
    receipt.legs.reduce((sum, leg) => sum + leg.receipt.amountOut, 0n) !== receipt.amountOut
  ) throw new TypeError('Accepted split receipt relation is invalid.');
  return receipt;
}

function route(value: AcceptedJson): readonly DirectionalHopInput[] {
  const source = object(value);
  exactKeys(source, CANDIDATE_ROUTE_FIELDS);
  const hops = Object.freeze(list(source['hops']).map((raw) => {
    const hop = object(raw);
    exactKeys(hop, DIRECTIONAL_HOP_FIELDS);
    return Object.freeze({
      poolId: string(hop['poolId']),
      assetIn: string(hop['assetIn']),
      assetOut: string(hop['assetOut']),
    });
  }));
  if (
    hops.length === 0 || hops.length > 2 ||
    hops.some((hop, index) =>
      hops[index - 1] !== undefined && hops[index - 1]?.assetOut !== hop.assetIn) ||
    new Set(hops.map((hop) => hop.poolId)).size !== hops.length ||
    source['routeKey'] !== canonicalRouteKey(hops)
  ) throw new TypeError('Accepted candidate route is invalid.');
  return hops;
}

function resolvedRoute(
  value: AcceptedJson,
  hops: readonly DirectionalHopInput[],
): PathShadowPriceResolvedRoute | null {
  const source = object(value);
  if (source['resolvedHops'] === null) return null;
  const resolved = Object.freeze(list(source['resolvedHops']).map((raw, index) => {
    const hop = object(raw);
    const identity = hops[index];
    exactKeys(hop, RESOLVED_HOP_FIELDS);
    if (
      identity === undefined ||
      hop['poolId'] !== identity.poolId ||
      hop['assetIn'] !== identity.assetIn ||
      hop['assetOut'] !== identity.assetOut
    ) throw new TypeError('Accepted resolved hop identity is invalid.');
    return Object.freeze({
      reserveIn: decimal(hop['reserveIn']),
      reserveOut: decimal(hop['reserveOut']),
      feeChargedNumerator: decimal(hop['feeChargedNumerator']),
      feeDenominator: decimal(hop['feeDenominator']),
    });
  }));
  if (
    resolved.length !== hops.length ||
    resolved.some((hop) =>
      hop.reserveIn <= 0n || hop.reserveOut <= 0n ||
      hop.feeDenominator <= 0n || hop.feeChargedNumerator >= hop.feeDenominator)
  ) throw new TypeError('Accepted resolved route is invalid.');
  return resolved;
}

function candidateSet(value: AcceptedJson): ServiceFastExperimentResolvedCandidateSetInput {
  const source = object(value);
  exactKeys(source, CANDIDATE_SET_FIELDS);
  const rawRoutes = list(source['routes']);
  if (rawRoutes.length !== 2) throw new TypeError('Accepted candidate set must contain two routes.');
  const routes = Object.freeze(rawRoutes.map(route));
  const resolved = rawRoutes.map((raw, index) => resolvedRoute(raw, routes[index] ?? []));
  const routeKeys = routes.map(canonicalRouteKey);
  const allPoolIds = routes.flatMap((entry) => entry.map((hop) => hop.poolId));
  if (
    new Set(routeKeys).size !== routeKeys.length ||
    new Set(allPoolIds).size !== allPoolIds.length ||
    source['candidateSetKey'] !== canonicalCandidateSetKey(routes)
  ) throw new TypeError('Accepted candidate set identity is invalid.');
  if (source['resolutionStatus'] === 'resolved' && resolved.every((entry) => entry !== null)) {
    if (source['failureCode'] !== null) {
      throw new TypeError('Accepted resolved candidate set failure is invalid.');
    }
    return Object.freeze({
      routes,
      modelResolution: Object.freeze({
        ok: true as const,
        resolvedRoutes: Object.freeze(resolved),
      }),
    });
  }
  if (
    source['resolutionStatus'] !== 'failed' ||
    source['failureCode'] !== 'invalid-route-model' ||
    resolved.some((entry) => entry !== null)
  ) {
    throw new TypeError('Accepted candidate model resolution is invalid.');
  }
  return Object.freeze({ routes, modelResolution: Object.freeze({ ok: false as const }) });
}

function priorEligibilityProjection(value: unknown): AcceptedJsonObject {
  const source = object(value as AcceptedJson);
  const status = source['status'];
  const reason = source['reason'];
  const search = object(source['search']);
  if (
    status !== 'eligible' && status !== 'ineligible' ||
    status === 'eligible' && reason !== undefined && reason !== null ||
    status === 'ineligible' &&
      reason !== 'baseline-no-authorized-incumbent' &&
      reason !== 'no-model-valid-candidate-set'
  ) throw new TypeError('Accepted bound eligibility is invalid.');
  const projectedReason = status === 'eligible' ? null : string(reason);
  const pathTermination = search['pathTermination'];
  const candidateSetTermination = search['candidateSetTermination'];
  if (
    pathTermination !== 'complete' && pathTermination !== 'work-limit' ||
    candidateSetTermination !== 'complete' && candidateSetTermination !== 'work-limit'
  ) throw new TypeError('Accepted bound eligibility termination is invalid.');
  return Object.freeze({
    status,
    reason: projectedReason,
    search: Object.freeze({
      pathExpansions: integer(search['pathExpansions']),
      enumeratedPaths: integer(search['enumeratedPaths']),
      pathTermination,
      candidateSetExpansions: integer(search['candidateSetExpansions']),
      enumeratedCandidateSets: integer(search['enumeratedCandidateSets']),
      candidateSetTermination,
    }),
    modelValidCandidateSetCount: integer(source['modelValidCandidateSetCount']),
  });
}

function noPlanObjective(): AcceptedJsonObject {
  return Object.freeze({
    hasPlan: false,
    amountOut: null,
    legCount: null,
    totalHops: null,
    routeKeys: Object.freeze([]),
    allocations: Object.freeze([]),
  });
}

function boundBaselineIncumbent(
  baselineCell: AcceptedJsonObject,
): AcceptedJsonObject {
  const result = object(baselineCell['result']);
  const status = result['status'];
  if (status === 'success') {
    const receiptValue = object(
      object(result['plan'])['receipt'],
    );
    const receipt = splitReceipt(receiptValue);
    return Object.freeze({
      status: 'success',
      reason: null,
      receipt: receiptValue,
      objective: Object.freeze({
        hasPlan: true,
        amountOut: receipt.amountOut.toString(10),
        legCount: receipt.legs.length,
        totalHops: receipt.legs.reduce(
          (total, leg) => total + leg.receipt.hops.length,
          0,
        ),
        routeKeys: Object.freeze(receipt.legs.map((leg) =>
          canonicalRouteKey(leg.receipt.hops))),
        allocations: Object.freeze(receipt.legs.map((leg) =>
          leg.allocation.toString(10))),
      }),
      receiptHash: serviceFastExperimentReceiptHash(receipt),
    });
  }
  if (status !== 'no-route' && status !== 'no-plan') {
    throw new TypeError('Accepted bound baseline status is invalid.');
  }
  return Object.freeze({
    status,
    reason: string(result['reason']),
    receipt: null,
    objective: noPlanObjective(),
    receiptHash: null,
  });
}

function validateEntryBaseline(
  value: AcceptedJson,
  baselineCell: AcceptedJsonObject,
): void {
  const source = object(value);
  exactKeys(source, ENTRY_BASELINE_FIELDS);
  const incumbent = object(source['incumbent']);
  exactKeys(incumbent, INCUMBENT_FIELDS);
  exactKeys(object(incumbent['objective']), OBJECTIVE_FIELDS);
  if (
    source['boundSemanticCellHash'] !== inputSha256(JSON.stringify(baselineCell)) ||
    source['freshReplayMatchesBoundCell'] !== true ||
    !sameJson(incumbent, boundBaselineIncumbent(baselineCell))
  ) throw new TypeError('Accepted entry baseline differs from its bound semantic cell.');
}

function validateCandidateDiscovery(
  value: AcceptedJson,
  request: AcceptedJsonObject,
  repairTargetSetIndex: AcceptedJson | undefined,
): void {
  const source = object(value);
  exactKeys(source, DISCOVERY_FIELDS);
  const counters = object(source['counters']);
  exactKeys(counters, DISCOVERY_COUNTER_FIELDS);
  const pathExpansions = integer(counters['pathExpansions']);
  const enumeratedPaths = integer(counters['enumeratedPaths']);
  const candidateSetExpansions = integer(counters['candidateSetExpansions']);
  const enumeratedCandidateSets = integer(counters['enumeratedCandidateSets']);
  const rawSets = list(source['candidateSets']);
  if (
    source['termination'] !== 'complete' ||
    pathExpansions > 121 || enumeratedPaths > pathExpansions ||
    candidateSetExpansions > 110 ||
    enumeratedCandidateSets > candidateSetExpansions ||
    rawSets.length > 4 || rawSets.length > enumeratedCandidateSets
  ) throw new TypeError('Accepted candidate discovery accounting is invalid.');
  const setKeys = new Set<string>();
  let firstResolved: number | null = null;
  for (const [index, raw] of rawSets.entries()) {
    const rawSet = object(raw);
    if (integer(rawSet['setIndex']) !== index) {
      throw new TypeError('Accepted candidate set index is invalid.');
    }
    const prepared = candidateSet(raw);
    const key = string(rawSet['candidateSetKey']);
    if (setKeys.has(key)) throw new TypeError('Accepted candidate set is duplicated.');
    setKeys.add(key);
    for (const routeValue of prepared.routes) {
      if (
        routeValue[0]?.assetIn !== request['assetIn'] ||
        routeValue.at(-1)?.assetOut !== request['assetOut']
      ) throw new TypeError('Accepted candidate route request identity is invalid.');
    }
    if (prepared.modelResolution.ok && firstResolved === null) firstResolved = index;
  }
  const target = repairTargetSetIndex === null
    ? null
    : integer(repairTargetSetIndex);
  if (target !== firstResolved) {
    throw new TypeError('Accepted repair target differs from the first resolved set.');
  }
}

/** Recheck retained record semantics against already-bound source cells without regeneration. @internal */
export function admitAcceptedRecordBindings(
  value: AcceptedJsonObject,
  suiteCase: ExperimentInputCaseSource,
  request: ExperimentInputRequestSource,
  baselineCell: AcceptedJsonObject,
  eligibilityCell: unknown,
  expectedTimingCohortIndex: number | null,
): void {
  const requestValue = object(value['request']);
  const snapshot = object(value['snapshot']);
  const priorEligibility = object(value['priorEligibility']);
  exactKeys(snapshot, SNAPSHOT_FIELDS);
  exactKeys(requestValue, REQUEST_FIELDS);
  exactKeys(priorEligibility, PRIOR_ELIGIBILITY_FIELDS);
  exactKeys(object(priorEligibility['search']), PRIOR_SEARCH_FIELDS);
  if (
    value['schemaVersion'] !== 'routelab.service-fast-numerical-experiment-input.v1' ||
    value['caseId'] !== suiteCase.caseId ||
    value['requestId'] !== request.requestId ||
    value['serviceDecisionMember'] !== suiteCase.serviceDecision ||
    value['amplifiedStressMember'] !== !suiteCase.serviceDecision ||
    value['timingCohortIndex'] !== expectedTimingCohortIndex ||
    snapshot['snapshotId'] !== suiteCase.snapshotId ||
    snapshot['snapshotChecksum'] !== suiteCase.snapshotChecksum ||
    requestValue['assetIn'] !== request.assetIn ||
    requestValue['assetOut'] !== request.assetOut ||
    requestValue['amountIn'] !== request.amountIn ||
    requestValue['amountBucket'] !== request.amountBucket ||
    requestValue['topology'] !== request.topology ||
    requestValue['maxHops'] !== 2 ||
    requestValue['maxRoutes'] !== 2 ||
    requestValue['greedyParts'] !== 16 ||
    value['actionCeilingProfileId'] !== 'structural-complete' ||
    !sameJson(priorEligibility, priorEligibilityProjection(eligibilityCell))
  ) throw new TypeError('Accepted input source order or identity is invalid.');
  validateEntryBaseline(value['entryBaseline'] as AcceptedJson, baselineCell);
  validateCandidateDiscovery(
    value['candidateDiscovery'] as AcceptedJson,
    requestValue,
    value['repairTargetSetIndex'],
  );
}

function parseCanonicalLine(bytes: Uint8Array): AcceptedJsonObject {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError('Accepted input line is not UTF-8.');
  }
  if (!text.endsWith('\n') || text.length === 1) throw new TypeError('Accepted input line is incomplete.');
  const body = text.slice(0, -1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TypeError('Accepted input line is not JSON.');
  }
  const value = parsed as AcceptedJson;
  const result = object(value);
  if (JSON.stringify(result) !== body) {
    throw new TypeError('Accepted input line is not canonical.');
  }
  exactKeys(result, INPUT_FIELDS);
  return result;
}

export function decodeAcceptedInputBytes(bytes: Uint8Array): readonly AcceptedInputRecord[] {
  const records: AcceptedInputRecord[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const value = parseCanonicalLine(bytes.slice(start, index + 1));
    const sourceIndex = integer(value['sourceIndex']);
    if (sourceIndex !== records.length) throw new TypeError('Accepted source index is invalid.');
    const timingValue = value['timingCohortIndex'];
    const serviceDecisionMember = value['serviceDecisionMember'];
    const amplifiedStressMember = value['amplifiedStressMember'];
    if (
      typeof serviceDecisionMember !== 'boolean' ||
      typeof amplifiedStressMember !== 'boolean' ||
      serviceDecisionMember === amplifiedStressMember
    ) throw new TypeError('Accepted cohort membership is invalid.');
    records.push(Object.freeze({
      value,
      sourceIndex,
      caseId: string(value['caseId']),
      requestId: string(value['requestId']),
      timingCohortIndex: timingValue === null ? null : integer(timingValue),
      serviceDecisionMember,
      amplifiedStressMember,
    }));
    start = index + 1;
  }
  if (start !== bytes.byteLength || records.length !== 1_584) {
    throw new TypeError('Accepted input record count is invalid.');
  }
  return Object.freeze(records);
}

function validateSourceOrder(
  records: readonly AcceptedInputRecord[],
  source: ExperimentInputSource,
): void {
  let sourceIndex = 0;
  let timingIndex = 0;
  const stratumCounts = new Map<string, number>();
  for (const suiteCase of source.cases) {
    for (const request of suiteCase.requests) {
      const record = records[sourceIndex];
      if (record === undefined) throw new TypeError('Accepted source record is absent.');
      const baselineCell = object(source.baselineCells[sourceIndex] as AcceptedJson);
      const eligibilityCell = source.eligibilityCells[sourceIndex];
      if (eligibilityCell === undefined) {
        throw new TypeError('Accepted bound eligibility cell is absent.');
      }
      const localStratum = `${request.topology}\u0000${request.amountBucket}`;
      const stratum = `${suiteCase.caseId}\u0000${localStratum}`;
      const priorCount = stratumCounts.get(stratum) ?? 0;
      stratumCounts.set(stratum, priorCount + 1);
      const selected = suiteCase.operational && priorCount < 12;
      if (
        record.value['schemaVersion'] !== source.schemaVersion ||
        record.caseId !== suiteCase.caseId || record.requestId !== request.requestId ||
        record.serviceDecisionMember !== suiteCase.serviceDecision ||
        record.amplifiedStressMember === suiteCase.serviceDecision ||
        record.timingCohortIndex !== (selected ? timingIndex : null)
      ) throw new TypeError('Accepted input source order or identity is invalid.');
      admitAcceptedRecordBindings(
        record.value,
        suiteCase,
        request,
        baselineCell,
        eligibilityCell,
        selected ? timingIndex : null,
      );
      if (selected) timingIndex += 1;
      sourceIndex += 1;
    }
  }
  if (
    sourceIndex !== records.length || timingIndex !== 252 ||
    sourceIndex !== source.baselineCells.length ||
    sourceIndex !== source.eligibilityCells.length
  ) {
    throw new TypeError('Accepted source or timing population is invalid.');
  }
}

export interface AcceptedPreparedCell {
  readonly input: AcceptedInputRecord;
  readonly cell: ServiceFastExperimentCell;
}

export function admitAcceptedEntryIncumbentReplay(
  context: unknown,
  operations: ExperimentInputOperations,
  receipt: ExactInputSplitReplayReceipt,
): void {
  const replayed = operations.replay(context, Object.freeze({
    snapshotId: receipt.snapshotId,
    snapshotChecksum: receipt.snapshotChecksum,
    assetIn: receipt.assetIn,
    assetOut: receipt.assetOut,
    amountIn: receipt.amountIn,
    legs: Object.freeze(receipt.legs.map((leg) => Object.freeze({
      allocation: leg.allocation,
      route: Object.freeze(leg.receipt.hops.map((hop) => Object.freeze({
        assetIn: hop.assetIn,
        poolId: hop.poolId,
        assetOut: hop.assetOut,
      }))),
    }))),
  }));
  if (!replayed.ok || !serviceFastExperimentReceiptsEqual(replayed.value, receipt)) {
    throw new TypeError('Accepted entry incumbent fresh replay differs.');
  }
}

export function prepareAcceptedCells(
  records: readonly AcceptedInputRecord[],
  source: ExperimentInputSource,
  operations: ExperimentInputOperations,
): readonly AcceptedPreparedCell[] {
  validateSourceOrder(records, source);
  const contexts = new Map<string, unknown>();
  for (const suiteCase of source.cases) {
    const prepared = operations.prepare(suiteCase.snapshot);
    if (!prepared.ok) throw new TypeError('Accepted snapshot preparation failed.');
    contexts.set(suiteCase.caseId, prepared.value);
  }
  return Object.freeze(records.map((input) => {
    const context = contexts.get(input.caseId);
    if (context === undefined) throw new TypeError('Accepted prepared context is absent.');
    const snapshot = object(input.value['snapshot']);
    const request = object(input.value['request']);
    const incumbent = object(object(input.value['entryBaseline'])['incumbent']);
    const rawSets = list(object(input.value['candidateDiscovery'])['candidateSets']);
    const candidateSets = rawSets.map((raw, index) => {
      const sourceSet = object(raw);
      if (integer(sourceSet['setIndex']) !== index) throw new TypeError('Accepted set index is invalid.');
      return candidateSet(raw);
    });
    const receiptValue = incumbent['receipt'];
    const receipt = receiptValue === null ? undefined : splitReceipt(receiptValue as AcceptedJson);
    if (
      receipt !== undefined &&
      incumbent['receiptHash'] !== serviceFastExperimentReceiptHash(receipt)
    ) throw new TypeError('Accepted input receipt hash is invalid.');
    if (receipt !== undefined) {
      admitAcceptedEntryIncumbentReplay(context, operations, receipt);
    }
    const targetValue = input.value['repairTargetSetIndex'];
    const cell = prepareServiceFastExperimentCell(Object.freeze({
      context: context as Parameters<typeof prepareServiceFastExperimentCell>[0]['context'],
      snapshotId: string(snapshot['snapshotId']),
      snapshotChecksum: string(snapshot['snapshotChecksum']),
      assetIn: string(request['assetIn']),
      assetOut: string(request['assetOut']),
      amountIn: decimal(request['amountIn']),
      ...(receipt === undefined ? {} : { entryIncumbent: receipt }),
      candidateSets: Object.freeze(candidateSets),
      repairTargetSetIndex: targetValue === null ? null : integer(targetValue),
    }));
    return Object.freeze({ input, cell });
  }));
}
