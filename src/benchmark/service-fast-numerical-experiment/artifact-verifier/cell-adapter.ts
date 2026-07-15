import type { PathShadowPriceResolvedRoute } from '../../../allocation/path-shadow-price/index.ts';
import type { ExactInputSplitReplayReceipt } from '../../../replay/exact-input-split/index.ts';
import type { ExactInputRouteReplayReceipt } from '../../../replay/exact-input-route/index.ts';
import {
  prepareServiceFastExperimentCell,
  type PrepareServiceFastExperimentCellInput,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentResolvedCandidateSetInput,
} from '../evaluator-kernel.ts';
import type {
  ExperimentInputOperations,
  ExperimentInputSource,
} from '../input/build.ts';
import {
  requireJsonArray,
  requireJsonObject,
  requireSafeNonnegativeInteger,
  requireString,
  type DecodedExperimentInput,
  type JsonObject,
  type JsonValue,
} from './types.ts';

function decimal(value: JsonValue | undefined): bigint {
  const text = requireString(value);
  if (!/^(0|[1-9][0-9]*)$/u.test(text)) {
    throw new TypeError('Exact decimal is invalid.');
  }
  return BigInt(text);
}

function routeReceipt(value: JsonValue): ExactInputRouteReplayReceipt {
  const object = requireJsonObject(value);
  return Object.freeze({
    snapshotId: requireString(object['snapshotId']),
    snapshotChecksum: requireString(object['snapshotChecksum']),
    assetIn: requireString(object['assetIn']),
    assetOut: requireString(object['assetOut']),
    amountIn: decimal(object['amountIn']),
    amountOut: decimal(object['amountOut']),
    hops: Object.freeze(requireJsonArray(object['hops']).map((raw) => {
      const hop = requireJsonObject(raw);
      return Object.freeze({
        poolId: requireString(hop['poolId']),
        assetIn: requireString(hop['assetIn']),
        assetOut: requireString(hop['assetOut']),
        amountIn: decimal(hop['amountIn']),
        amountOut: decimal(hop['amountOut']),
        reserveInBefore: decimal(hop['reserveInBefore']),
        reserveOutBefore: decimal(hop['reserveOutBefore']),
        reserveInAfter: decimal(hop['reserveInAfter']),
        reserveOutAfter: decimal(hop['reserveOutAfter']),
      });
    })),
  });
}

export function decodeSplitReceipt(value: JsonValue): ExactInputSplitReplayReceipt {
  const object = requireJsonObject(value);
  return Object.freeze({
    snapshotId: requireString(object['snapshotId']),
    snapshotChecksum: requireString(object['snapshotChecksum']),
    assetIn: requireString(object['assetIn']),
    assetOut: requireString(object['assetOut']),
    amountIn: decimal(object['amountIn']),
    amountOut: decimal(object['amountOut']),
    legs: Object.freeze(requireJsonArray(object['legs']).map((raw) => {
      const leg = requireJsonObject(raw);
      return Object.freeze({
        allocation: decimal(leg['allocation']),
        receipt: routeReceipt(leg['receipt'] as JsonValue),
      });
    })),
  });
}

function directionalRoute(value: JsonValue): readonly Readonly<{
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
}>[] {
  const route = requireJsonObject(value);
  return Object.freeze(requireJsonArray(route['hops']).map((raw) => {
    const hop = requireJsonObject(raw);
    return Object.freeze({
      poolId: requireString(hop['poolId']),
      assetIn: requireString(hop['assetIn']),
      assetOut: requireString(hop['assetOut']),
    });
  }));
}

function resolvedRoute(value: JsonValue): PathShadowPriceResolvedRoute | null {
  const route = requireJsonObject(value);
  if (route['resolvedHops'] === null) return null;
  return Object.freeze(requireJsonArray(route['resolvedHops']).map((raw) => {
    const hop = requireJsonObject(raw);
    return Object.freeze({
      reserveIn: decimal(hop['reserveIn']),
      reserveOut: decimal(hop['reserveOut']),
      feeChargedNumerator: decimal(hop['feeChargedNumerator']),
      feeDenominator: decimal(hop['feeDenominator']),
    });
  }));
}

function candidateSet(value: JsonValue): ServiceFastExperimentResolvedCandidateSetInput {
  const object = requireJsonObject(value);
  const sourceRoutes = requireJsonArray(object['routes']);
  const routes = Object.freeze(sourceRoutes.map(directionalRoute));
  const resolved = sourceRoutes.map(resolvedRoute);
  const resolutionStatus = requireString(object['resolutionStatus']);
  if (resolutionStatus === 'resolved' && resolved.every((route) => route !== null)) {
    return Object.freeze({
      routes,
      modelResolution: Object.freeze({
        ok: true as const,
        resolvedRoutes: Object.freeze(resolved),
      }),
    });
  }
  if (resolutionStatus !== 'failed' || resolved.some((route) => route !== null)) {
    throw new TypeError('Candidate set resolution is invalid.');
  }
  return Object.freeze({
    routes,
    modelResolution: Object.freeze({ ok: false as const }),
  });
}

function sourceCase(
  source: ExperimentInputSource,
  caseId: string,
): ExperimentInputSource['cases'][number] {
  const result = source.cases.find((candidate) => candidate.caseId === caseId);
  if (result === undefined) throw new TypeError('Input source case is absent.');
  return result;
}

export class ServiceFastCellFactory {
  readonly #source: ExperimentInputSource;
  readonly #operations: ExperimentInputOperations;
  readonly #contexts = new Map<string, unknown>();

  constructor(source: ExperimentInputSource, operations: ExperimentInputOperations) {
    this.#source = source;
    this.#operations = operations;
  }

  #context(caseId: string): PrepareServiceFastExperimentCellInput['context'] {
    const prior = this.#contexts.get(caseId);
    if (prior !== undefined) {
      return prior as PrepareServiceFastExperimentCellInput['context'];
    }
    const prepared = this.#operations.prepare(sourceCase(this.#source, caseId).snapshot);
    if (!prepared.ok) throw new TypeError('Input snapshot preparation failed.');
    this.#contexts.set(caseId, prepared.value);
    return prepared.value as PrepareServiceFastExperimentCellInput['context'];
  }

  prepare(record: DecodedExperimentInput): ServiceFastExperimentCell {
    const value = record.value;
    const snapshot = requireJsonObject(value['snapshot']);
    const request = requireJsonObject(value['request']);
    const entryBaseline = requireJsonObject(value['entryBaseline']);
    const incumbent = requireJsonObject(entryBaseline['incumbent']);
    const discovery = requireJsonObject(value['candidateDiscovery']);
    const candidateSets = requireJsonArray(discovery['candidateSets']).map(
      (raw, index) => {
        const object = requireJsonObject(raw);
        if (requireSafeNonnegativeInteger(object['setIndex']) !== index) {
          throw new TypeError('Candidate set index is invalid.');
        }
        return candidateSet(raw);
      },
    );
    const repairTargetSetIndex = value['repairTargetSetIndex'] === null
      ? null
      : requireSafeNonnegativeInteger(value['repairTargetSetIndex']);
    const receiptValue = incumbent['receipt'];
    const input: PrepareServiceFastExperimentCellInput = Object.freeze({
      context: this.#context(record.caseId),
      snapshotId: requireString(snapshot['snapshotId']),
      snapshotChecksum: requireString(snapshot['snapshotChecksum']),
      assetIn: requireString(request['assetIn']),
      assetOut: requireString(request['assetOut']),
      amountIn: decimal(request['amountIn']),
      ...(receiptValue === null
        ? {}
        : { entryIncumbent: decodeSplitReceipt(receiptValue as JsonValue) }),
      candidateSets: Object.freeze(candidateSets),
      repairTargetSetIndex,
    });
    return prepareServiceFastExperimentCell(input);
  }
}

export function inputEntryIncumbent(record: DecodedExperimentInput): JsonObject {
  const baseline = requireJsonObject(record.value['entryBaseline']);
  return requireJsonObject(baseline['incumbent']);
}
