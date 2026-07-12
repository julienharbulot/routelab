import { createHash } from 'node:crypto';

import { parseLiquiditySnapshot, type LiquiditySnapshot } from '../../domain/index.ts';
import {
  resumeExactInputSinglePath,
  routeExactInputSinglePathInterruptible,
  routeExactInputSinglePathResumable,
  type ExactInputSinglePathInterruptibleSearchSummary,
  type ExactInputSinglePathResumableResult,
  type ExactInputSinglePathRouterRequest,
} from '../../router/single-path/index.ts';

export const ANYTIME_SINGLE_PATH_INPUT_SCHEMA_VERSION =
  'routelab.anytime-single-path-input.v1';
export const ANYTIME_SINGLE_PATH_REPORT_SCHEMA_VERSION =
  'routelab.anytime-single-path-measurement.v1';

export const ANYTIME_SINGLE_PATH_MEASUREMENT_LIMITATIONS = Object.freeze([
  'latency samples are operational observations without a threshold or performance conclusion',
  'quality is measured only at fixed deterministic search-expansion work points',
  'routing is bounded exact-replayed single-path only',
  'no live service, transaction submission, custody, or protocol execution',
] as const);

export interface AnytimeSinglePathMeasurementInput {
  readonly schemaVersion: typeof ANYTIME_SINGLE_PATH_INPUT_SCHEMA_VERSION;
  readonly inputId: string;
  readonly snapshot: LiquiditySnapshot;
  readonly request: Omit<ExactInputSinglePathRouterRequest, 'maxExpansions'>;
  readonly workPoints: readonly number[];
  readonly inputChecksum: string;
}

export interface AnytimeSinglePathMeasurementEnvironment {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
}

export interface AnytimeSinglePathMeasurementConfig {
  readonly warmupCount: number;
  readonly sampleCount: number;
}

export interface AnytimeSinglePathMeasurementDependencies {
  readonly nowNanoseconds: () => bigint;
}

export interface AnytimeSinglePathQualityPoint {
  readonly maxExpansions: number;
  readonly status: 'success' | 'no-route' | 'no-plan';
  readonly reason:
    | 'no-candidate'
    | 'all-candidates-rejected'
    | 'work-limit'
    | 'interrupted'
    | null;
  readonly amountOut: string | null;
  readonly route: readonly {
    readonly assetIn: string;
    readonly poolId: string;
    readonly assetOut: string;
  }[];
  readonly establishment: {
    readonly enumeratedCandidates: number;
    readonly replayedCandidates: number;
    readonly rejectedCandidates: number;
  };
  readonly search: {
    readonly expansions: number;
    readonly enumeratedCandidates: number;
    readonly replayedCandidates: number;
    readonly rejectedCandidates: number;
    readonly termination: 'complete' | 'work-limit' | 'interrupted';
  };
}

export type AnytimeSinglePathLatencyAlgorithm =
  | 'interruptible-one-shot'
  | 'resumable-one-shot';

export interface AnytimeSinglePathLatencySample {
  readonly round: number;
  readonly order: number;
  readonly algorithm: AnytimeSinglePathLatencyAlgorithm;
  readonly elapsedNanoseconds: string;
}

export interface AnytimeSinglePathMeasurementReport {
  readonly schemaVersion: typeof ANYTIME_SINGLE_PATH_REPORT_SCHEMA_VERSION;
  readonly input: {
    readonly inputId: string;
    readonly inputChecksum: string;
  };
  readonly quality: {
    readonly workUnit: 'search-expansions';
    readonly oneShot: readonly AnytimeSinglePathQualityPoint[];
    readonly cumulativeResume: readonly AnytimeSinglePathQualityPoint[];
  };
  readonly latency: {
    readonly unit: 'nanoseconds';
    readonly input: {
      readonly inputId: string;
      readonly inputChecksum: string;
    };
    readonly warmupCount: number;
    readonly sampleCount: number;
    readonly alternation: 'reverse-order-each-round';
    readonly algorithms: readonly AnytimeSinglePathLatencyAlgorithm[];
    readonly environment: AnytimeSinglePathMeasurementEnvironment;
    readonly rawSamples: readonly AnytimeSinglePathLatencySample[];
  };
  readonly limitations: typeof ANYTIME_SINGLE_PATH_MEASUREMENT_LIMITATIONS;
}

export interface AnytimeSinglePathMeasurementReportValue {
  readonly report: AnytimeSinglePathMeasurementReport;
  readonly canonicalJson: string;
}

export type AnytimeSinglePathMeasurementInputResult =
  | { readonly ok: true; readonly value: AnytimeSinglePathMeasurementInput }
  | { readonly ok: false; readonly error: { readonly code: 'invalid-input' } };

type InputRecord = Record<string, unknown>;

function isRecord(value: unknown): value is InputRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputFailure(): AnytimeSinglePathMeasurementInputResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code: 'invalid-input' as const }),
  });
}

function readPositiveExactString(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) return undefined;
  return BigInt(value);
}

function readPositiveSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;
}

export function parseAnytimeSinglePathMeasurementInput(
  source: string,
): AnytimeSinglePathMeasurementInputResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch {
    return inputFailure();
  }
  if (!isRecord(decoded)) return inputFailure();
  if (decoded['schemaVersion'] !== ANYTIME_SINGLE_PATH_INPUT_SCHEMA_VERSION) {
    return inputFailure();
  }
  const inputId = decoded['inputId'];
  const requestValue = decoded['request'];
  const workPointsValue = decoded['workPoints'];
  if (
    typeof inputId !== 'string' ||
    inputId.length === 0 ||
    !isRecord(requestValue) ||
    !Array.isArray(workPointsValue)
  ) {
    return inputFailure();
  }

  const parsedSnapshot = parseLiquiditySnapshot(decoded['snapshot']);
  if (!parsedSnapshot.ok) return inputFailure();
  const amountIn = readPositiveExactString(requestValue['amountIn']);
  const maxHops = readPositiveSafeInteger(requestValue['maxHops']);
  if (
    typeof requestValue['snapshotId'] !== 'string' ||
    typeof requestValue['snapshotChecksum'] !== 'string' ||
    typeof requestValue['assetIn'] !== 'string' ||
    typeof requestValue['assetOut'] !== 'string' ||
    amountIn === undefined ||
    maxHops === undefined
  ) {
    return inputFailure();
  }
  const workPoints = workPointsValue.map((value) =>
    Number.isSafeInteger(value) && (value as number) >= 0
      ? (value as number)
      : undefined,
  );
  if (
    workPoints.length === 0 ||
    workPoints.some((value) => value === undefined) ||
    workPoints.some((value, index) => index > 0 && value! <= workPoints[index - 1]!)
  ) {
    return inputFailure();
  }

  const request = Object.freeze({
    snapshotId: requestValue['snapshotId'],
    snapshotChecksum: requestValue['snapshotChecksum'],
    assetIn: requestValue['assetIn'],
    assetOut: requestValue['assetOut'],
    amountIn,
    maxHops,
  });
  if (
    request.snapshotId !== parsedSnapshot.value.snapshotId ||
    request.snapshotChecksum !== parsedSnapshot.value.snapshotChecksum ||
    request.assetIn.length === 0 ||
    request.assetOut.length === 0 ||
    request.assetIn === request.assetOut
  ) {
    return inputFailure();
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: ANYTIME_SINGLE_PATH_INPUT_SCHEMA_VERSION,
      inputId,
      snapshot: parsedSnapshot.value,
      request,
      workPoints: Object.freeze(workPoints as number[]),
      inputChecksum: `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`,
    }),
  });
}

function searchFromResult(
  result: ExactInputSinglePathResumableResult,
): ExactInputSinglePathInterruptibleSearchSummary {
  if (result.status === 'invalid-request' || result.status === 'invalid-resume') {
    throw new Error('Validated measurement input produced a routing validation error.');
  }
  if (result.status === 'control-error') {
    throw new Error('Non-interrupting measurement control failed.');
  }
  return result.status === 'success' ? result.plan.search : result.search;
}

function projectQuality(
  maxExpansions: number,
  result: ExactInputSinglePathResumableResult,
): AnytimeSinglePathQualityPoint {
  const search = searchFromResult(result);
  const receipt = result.status === 'success' ? result.plan.receipt : undefined;
  const reason =
    result.status === 'no-route' || result.status === 'no-plan' ? result.reason : null;
  return Object.freeze({
    maxExpansions,
    status: result.status as 'success' | 'no-route' | 'no-plan',
    reason,
    amountOut: receipt?.amountOut.toString() ?? null,
    route: Object.freeze(
      receipt?.hops.map(({ assetIn, poolId, assetOut }) =>
        Object.freeze({ assetIn, poolId, assetOut }),
      ) ?? [],
    ),
    establishment: Object.freeze({
      enumeratedCandidates: search.establishment.enumeratedCandidates,
      replayedCandidates: search.establishment.replayedCandidates,
      rejectedCandidates: search.establishment.rejectedCandidates,
    }),
    search: Object.freeze({
      expansions: search.expansions,
      enumeratedCandidates: search.enumeratedCandidates,
      replayedCandidates: search.replayedCandidates,
      rejectedCandidates: search.rejectedCandidates,
      termination: search.termination,
    }),
  });
}

function requestAt(
  input: AnytimeSinglePathMeasurementInput,
  maxExpansions: number,
): ExactInputSinglePathRouterRequest {
  return Object.freeze({ ...input.request, maxExpansions });
}

function buildQuality(input: AnytimeSinglePathMeasurementInput) {
  const neverInterrupt = Object.freeze({ shouldInterrupt: () => false });
  const oneShot = Object.freeze(
    input.workPoints.map((maxExpansions) =>
      projectQuality(
        maxExpansions,
        routeExactInputSinglePathResumable(
          input.snapshot,
          requestAt(input, maxExpansions),
          neverInterrupt,
        ),
      ),
    ),
  );

  const cumulativeResume: AnytimeSinglePathQualityPoint[] = [];
  let result = routeExactInputSinglePathResumable(
    input.snapshot,
    requestAt(input, input.workPoints[0]!),
    neverInterrupt,
  );
  cumulativeResume.push(projectQuality(input.workPoints[0]!, result));
  for (const maxExpansions of input.workPoints.slice(1)) {
    const checkpoint =
      'checkpoint' in result ? result.checkpoint : null;
    if (checkpoint !== null) {
      result = resumeExactInputSinglePath(checkpoint, maxExpansions, neverInterrupt);
    }
    cumulativeResume.push(projectQuality(maxExpansions, result));
  }

  return Object.freeze({
    workUnit: 'search-expansions' as const,
    oneShot,
    cumulativeResume: Object.freeze(cumulativeResume),
  });
}

function checkedCount(value: number, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error('Measurement counts must be safe integers in range.');
  }
  return value;
}

function alternatingAlgorithms(round: number): readonly AnytimeSinglePathLatencyAlgorithm[] {
  const algorithms = [
    'interruptible-one-shot',
    'resumable-one-shot',
  ] as const;
  return round % 2 === 0 ? algorithms : [algorithms[1], algorithms[0]];
}

function runLatencyAlgorithm(
  algorithm: AnytimeSinglePathLatencyAlgorithm,
  input: AnytimeSinglePathMeasurementInput,
): void {
  const maxExpansions = input.workPoints[input.workPoints.length - 1]!;
  const control = Object.freeze({ shouldInterrupt: () => false });
  if (algorithm === 'interruptible-one-shot') {
    routeExactInputSinglePathInterruptible(
      input.snapshot,
      requestAt(input, maxExpansions),
      control,
    );
    return;
  }
  routeExactInputSinglePathResumable(
    input.snapshot,
    requestAt(input, maxExpansions),
    control,
  );
}

function buildLatency(
  input: AnytimeSinglePathMeasurementInput,
  config: AnytimeSinglePathMeasurementConfig,
  dependencies: AnytimeSinglePathMeasurementDependencies,
  environment: AnytimeSinglePathMeasurementEnvironment,
) {
  const warmupCount = checkedCount(config.warmupCount, true);
  const sampleCount = checkedCount(config.sampleCount, false);
  for (let round = 0; round < warmupCount; round += 1) {
    for (const algorithm of alternatingAlgorithms(round)) {
      runLatencyAlgorithm(algorithm, input);
    }
  }

  const rawSamples: AnytimeSinglePathLatencySample[] = [];
  for (let round = 0; round < sampleCount; round += 1) {
    const algorithms = alternatingAlgorithms(round);
    for (const [order, algorithm] of algorithms.entries()) {
      const startedAt = dependencies.nowNanoseconds();
      runLatencyAlgorithm(algorithm, input);
      const finishedAt = dependencies.nowNanoseconds();
      if (finishedAt < startedAt) {
        throw new Error('Measurement clock must be monotonic within every sample.');
      }
      rawSamples.push(
        Object.freeze({
          round,
          order,
          algorithm,
          elapsedNanoseconds: (finishedAt - startedAt).toString(),
        }),
      );
    }
  }

  return Object.freeze({
    unit: 'nanoseconds' as const,
    input: Object.freeze({
      inputId: input.inputId,
      inputChecksum: input.inputChecksum,
    }),
    warmupCount,
    sampleCount,
    alternation: 'reverse-order-each-round' as const,
    algorithms: Object.freeze([
      'interruptible-one-shot',
      'resumable-one-shot',
    ] as const),
    environment: Object.freeze({
      nodeVersion: environment.nodeVersion,
      platform: environment.platform,
      arch: environment.arch,
    }),
    rawSamples: Object.freeze(rawSamples),
  });
}

export function createAnytimeSinglePathMeasurementReport(
  input: AnytimeSinglePathMeasurementInput,
  config: AnytimeSinglePathMeasurementConfig,
  dependencies: AnytimeSinglePathMeasurementDependencies,
  environment: AnytimeSinglePathMeasurementEnvironment,
): AnytimeSinglePathMeasurementReportValue {
  const report: AnytimeSinglePathMeasurementReport = Object.freeze({
    schemaVersion: ANYTIME_SINGLE_PATH_REPORT_SCHEMA_VERSION,
    input: Object.freeze({
      inputId: input.inputId,
      inputChecksum: input.inputChecksum,
    }),
    quality: buildQuality(input),
    latency: buildLatency(input, config, dependencies, environment),
    limitations: ANYTIME_SINGLE_PATH_MEASUREMENT_LIMITATIONS,
  });
  return Object.freeze({ report, canonicalJson: JSON.stringify(report) });
}
