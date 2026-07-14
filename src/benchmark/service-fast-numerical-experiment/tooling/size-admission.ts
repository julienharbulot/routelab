import {
  descriptorForBytes,
  sha256Bytes,
  type FrozenServiceFastConfiguration,
  type SourceClosureDescriptor,
} from '../source-closure/codec.ts';
import { renderMaximalServiceFastExperimentReadme } from './readme-template.ts';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const HASH = `sha256:${'f'.repeat(64)}`;
const REVISION = 'f'.repeat(40);
const MAX_NANOSECONDS = '9'.repeat(20);
const MAX_SIGNED_METRIC = `-${'9'.repeat(23)}`;
const MAX_POSITIVE_METRIC = '9'.repeat(23);
const MAX_COUNTER_VECTOR = Object.freeze(Array.from({ length: 12 }, () => 100_000));
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UNSIGNED_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const MAX_REQUEST_ALLOCATION_DIGITS = 83;
const MAX_RESERVE_OUTPUT_DELTA_DIGITS = 86;
const WORK_TERMINATIONS = Object.freeze(['complete', 'work-limit']);
const ELIGIBILITY_STATUSES = Object.freeze(['eligible', 'ineligible']);
const ELIGIBILITY_REASONS = Object.freeze([
  'baseline-no-authorized-incumbent',
  'no-model-valid-candidate-set',
]);
const EXACT_RESULT_STATUSES = Object.freeze(['success', 'no-route', 'no-plan']);
const MODEL_RESOLUTION_STATUSES = Object.freeze(['resolved', 'failed']);
const CANDIDATE_FAILURE_CODES = Object.freeze([
  'invalid-route-model',
  'non-finite-normalization',
  'non-finite-proposal',
  'non-convergence',
  'zero-total-weight',
  'invalid-reconstruction',
  'residual-options-exhausted',
  'finite-nonconverged-replayed',
  'repair-no-valid-neighbor',
  'repair-work-limit',
  'authorization-rejected',
  'authorization-mismatch',
]);
const LIMITATIONS = Object.freeze([
  'numerical-candidate-stage-only',
  'policy-not-yet-supported',
  'no-service-latency-claim',
  'no-load-or-concurrency-claim',
  'no-representative-demand-claim',
  'no-production-financial-execution-claim',
  'no-unrestricted-optimality-claim',
]);
const CLAUSE_IDS = Object.freeze([
  'fresh-exact-safety',
  'full-semantic-nonregression',
  'service-failure-reduction',
  'service-timing-nonregression',
  'hotspot-speedup',
  'deadline-and-event-quality',
]);

export interface CommittedInputStructuralWidths {
  readonly descriptor: SourceClosureDescriptor;
  readonly recordCount: number;
  readonly maximumRecordBytesIncludingLineFeed: number;
  readonly widestIdentifier: string;
  readonly widestCaseId: string;
  readonly widestRequestId: string;
  readonly widestRouteKey: string;
  readonly maximumCanonicalDecimalDigits: number;
  readonly maximumRequestAndAllocationDecimalDigits: number;
  readonly maximumReserveOutputAndDeltaDecimalDigits: number;
  readonly maximumCandidateSetCount: number;
  readonly maximumRoutesPerCandidateSet: number;
  readonly maximumHopsPerRoute: number;
}

export interface AdmittedArtifactSize {
  readonly name: string;
  readonly maximumBytes: number;
  readonly capBytes: number;
}

export interface PreSourceClosureSizeAdmission {
  readonly inputWidths: CommittedInputStructuralWidths;
  readonly artifacts: readonly AdmittedArtifactSize[];
  readonly maximumDirectoryBytes: number;
  readonly directoryCapBytes: number;
  readonly dryAnalysis: Readonly<Record<string, unknown>>;
  readonly dryManifest: Readonly<Record<string, unknown>>;
  readonly dryReadme: string;
}

export class ServiceFastSizeAdmissionError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'repository';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function admissionFailure(code: string, artifact: string, message: string): never {
  throw new ServiceFastSizeAdmissionError(code, artifact, message);
}

function requireObject(value: unknown, artifact: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return admissionFailure('invalid-input-shape', artifact, `${artifact} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  artifact: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    admissionFailure('invalid-input-field-order', artifact, `${artifact} has unknown, missing, or reordered fields.`);
  }
}

function jsonStringBytes(value: string): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function chooseWider(left: string, right: string): string {
  return jsonStringBytes(right) > jsonStringBytes(left) ? right : left;
}

function requireString(value: unknown, artifact: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return admissionFailure('invalid-input-string', artifact, `${artifact} must be a nonempty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, artifact: string): boolean {
  if (typeof value !== 'boolean') {
    return admissionFailure('invalid-input-boolean', artifact, `${artifact} must be a boolean.`);
  }
  return value;
}

function requireSafeInteger(
  value: unknown,
  artifact: string,
  positive = false,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (positive ? (value as number) <= 0 : (value as number) < 0)
  ) {
    return admissionFailure(
      'invalid-input-integer',
      artifact,
      `${artifact} must be a safe ${positive ? 'positive' : 'nonnegative'} integer.`,
    );
  }
  return value as number;
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  artifact: string,
): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return admissionFailure('invalid-input-enum', artifact, `${artifact} is not a frozen enum member.`);
  }
  return value;
}

function requireHash(value: unknown, artifact: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    return admissionFailure('invalid-input-hash', artifact, `${artifact} must be a canonical SHA-256 value.`);
  }
  return value;
}

interface DecimalWidths {
  maximumCanonical: number;
  maximumRequestAllocation: number;
  maximumReserveOutputDelta: number;
}

function requireDecimal(
  value: unknown,
  artifact: string,
  positive: boolean,
  maximumDigits: number,
  widths: DecimalWidths,
  category: 'request-allocation' | 'reserve-output-delta' | 'other',
): string {
  const expression = positive ? POSITIVE_DECIMAL : UNSIGNED_DECIMAL;
  if (typeof value !== 'string' || !expression.test(value) || value.length > maximumDigits) {
    return admissionFailure(
      'invalid-input-decimal',
      artifact,
      `${artifact} is not a bounded canonical ${positive ? 'positive' : 'unsigned'} decimal.`,
    );
  }
  widths.maximumCanonical = Math.max(widths.maximumCanonical, value.length);
  if (category === 'request-allocation') {
    widths.maximumRequestAllocation = Math.max(widths.maximumRequestAllocation, value.length);
  } else if (category === 'reserve-output-delta') {
    widths.maximumReserveOutputDelta = Math.max(widths.maximumReserveOutputDelta, value.length);
  }
  return value;
}

function recordDeltaWidth(
  left: string,
  right: string,
  artifact: string,
  widths: DecimalWidths,
): void {
  const delta = BigInt(left) - BigInt(right);
  const digits = (delta < 0n ? -delta : delta).toString(10).length;
  if (digits > MAX_RESERVE_OUTPUT_DELTA_DIGITS) {
    admissionFailure('input-delta-width-exceeded', artifact, `${artifact} exceeds the frozen exact-delta width.`);
  }
  widths.maximumCanonical = Math.max(widths.maximumCanonical, digits);
  widths.maximumReserveOutputDelta = Math.max(widths.maximumReserveOutputDelta, digits);
}

function requireNullableString(
  value: unknown,
  artifact: string,
): string | null {
  return value === null ? null : requireString(value, artifact);
}

function requireNullableHash(
  value: unknown,
  artifact: string,
): string | null {
  return value === null ? null : requireHash(value, artifact);
}

function requireArray(value: unknown, artifact: string): unknown[] {
  if (!Array.isArray(value)) {
    return admissionFailure('invalid-input-array', artifact, `${artifact} must be an array.`);
  }
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface DecodedDirectionalHop {
  readonly poolId: string;
  readonly assetIn: string;
  readonly assetOut: string;
}

function compareRawUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDecodedRoutes(
  left: readonly DecodedDirectionalHop[],
  right: readonly DecodedDirectionalHop[],
): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftHop = left[index];
    const rightHop = right[index];
    if (leftHop === undefined || rightHop === undefined) break;
    for (const field of ['assetIn', 'poolId', 'assetOut'] as const) {
      const comparison = compareRawUtf16(leftHop[field], rightHop[field]);
      if (comparison !== 0) return comparison;
    }
  }
  return left.length - right.length;
}

function canonicalRouteKey(hops: readonly DecodedDirectionalHop[]): string {
  return JSON.stringify(hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]));
}

function canonicalCandidateSetKey(
  routes: readonly (readonly DecodedDirectionalHop[])[],
): string {
  return JSON.stringify(routes.map((route) =>
    route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])));
}

function decodeDirectionalHop(value: unknown, artifact: string): DecodedDirectionalHop {
  const hop = requireObject(value, artifact);
  requireExactKeys(hop, ['poolId', 'assetIn', 'assetOut'], artifact);
  return Object.freeze({
    poolId: requireString(hop['poolId'], `${artifact}.poolId`),
    assetIn: requireString(hop['assetIn'], `${artifact}.assetIn`),
    assetOut: requireString(hop['assetOut'], `${artifact}.assetOut`),
  });
}

function assertRouteContinuity(
  hops: readonly DecodedDirectionalHop[],
  assetIn: string,
  assetOut: string,
  artifact: string,
): void {
  if (
    hops.length === 0 ||
    hops[0]?.assetIn !== assetIn ||
    hops.at(-1)?.assetOut !== assetOut ||
    hops.some((hop, index) => index > 0 && hops[index - 1]?.assetOut !== hop.assetIn)
  ) {
    admissionFailure('invalid-input-route-continuity', artifact, `${artifact} is not a continuous request route.`);
  }
  const assets = [hops[0]?.assetIn ?? '', ...hops.map((hop) => hop.assetOut)];
  if (
    new Set(assets).size !== assets.length ||
    new Set(hops.map((hop) => hop.poolId)).size !== hops.length
  ) {
    admissionFailure('non-simple-input-route', artifact, `${artifact} repeats an asset or pool.`);
  }
}

function canonicalUnsignedLessThan(left: string, right: string): boolean {
  return left.length !== right.length ? left.length < right.length : left < right;
}

function decodeResolvedHop(
  value: unknown,
  directional: DecodedDirectionalHop,
  artifact: string,
  widths: DecimalWidths,
): void {
  const hop = requireObject(value, artifact);
  requireExactKeys(
    hop,
    [
      'poolId',
      'assetIn',
      'assetOut',
      'reserveIn',
      'reserveOut',
      'feeChargedNumerator',
      'feeDenominator',
    ],
    artifact,
  );
  if (
    requireString(hop['poolId'], `${artifact}.poolId`) !== directional.poolId ||
    requireString(hop['assetIn'], `${artifact}.assetIn`) !== directional.assetIn ||
    requireString(hop['assetOut'], `${artifact}.assetOut`) !== directional.assetOut
  ) {
    admissionFailure('resolved-hop-identity-mismatch', artifact, `${artifact} does not match its directional hop.`);
  }
  requireDecimal(
    hop['reserveIn'],
    `${artifact}.reserveIn`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  requireDecimal(
    hop['reserveOut'],
    `${artifact}.reserveOut`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const feeNumerator = requireDecimal(
    hop['feeChargedNumerator'],
    `${artifact}.feeChargedNumerator`,
    false,
    Number.MAX_SAFE_INTEGER,
    widths,
    'other',
  );
  const feeDenominator = requireDecimal(
    hop['feeDenominator'],
    `${artifact}.feeDenominator`,
    true,
    Number.MAX_SAFE_INTEGER,
    widths,
    'other',
  );
  if (!canonicalUnsignedLessThan(feeNumerator, feeDenominator)) {
    admissionFailure('invalid-input-fee', artifact, `${artifact} fee numerator must be below its denominator.`);
  }
}

interface DecodedCandidateSet {
  readonly resolutionStatus: string;
  readonly routes: readonly (readonly DecodedDirectionalHop[])[];
}

function compareDecodedCandidateSets(
  left: readonly (readonly DecodedDirectionalHop[])[],
  right: readonly (readonly DecodedDirectionalHop[])[],
): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const comparison = compareDecodedRoutes(left[index] ?? [], right[index] ?? []);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function decodeCandidateSet(
  value: unknown,
  setIndex: number,
  request: { readonly assetIn: string; readonly assetOut: string; readonly maxHops: number; readonly maxRoutes: number },
  artifact: string,
  widths: DecimalWidths,
): DecodedCandidateSet {
  const candidateSet = requireObject(value, artifact);
  requireExactKeys(
    candidateSet,
    ['setIndex', 'candidateSetKey', 'routes', 'resolutionStatus', 'failureCode'],
    artifact,
  );
  if (requireSafeInteger(candidateSet['setIndex'], `${artifact}.setIndex`) !== setIndex) {
    admissionFailure('candidate-set-index-mismatch', artifact, `${artifact} is not in zero-based set order.`);
  }
  const routeValues = requireArray(candidateSet['routes'], `${artifact}.routes`);
  if (
    routeValues.length !== 2 ||
    routeValues.length > request.maxRoutes ||
    routeValues.length > 4
  ) {
    admissionFailure('invalid-input-routes', artifact, `${artifact} must contain the exact two builder-reachable routes.`);
  }
  const routes: DecodedDirectionalHop[][] = [];
  const candidateSetPools = new Set<string>();
  let unresolvedRouteCount = 0;
  for (const [routeIndex, routeValue] of routeValues.entries()) {
    const routeArtifact = `${artifact}.routes[${routeIndex}]`;
    const route = requireObject(routeValue, routeArtifact);
    requireExactKeys(route, ['routeKey', 'hops', 'resolvedHops'], routeArtifact);
    const hopValues = requireArray(route['hops'], `${routeArtifact}.hops`);
    if (hopValues.length === 0 || hopValues.length > request.maxHops || hopValues.length > 2) {
      admissionFailure('invalid-input-hops', routeArtifact, `${routeArtifact} violates the hop-count bounds.`);
    }
    const hops = hopValues.map((hop, hopIndex) =>
      decodeDirectionalHop(hop, `${routeArtifact}.hops[${hopIndex}]`));
    assertRouteContinuity(hops, request.assetIn, request.assetOut, routeArtifact);
    for (const hop of hops) {
      if (candidateSetPools.has(hop.poolId)) {
        admissionFailure('candidate-set-pool-overlap', artifact, `${artifact} routes are not pool-disjoint.`);
      }
      candidateSetPools.add(hop.poolId);
    }
    if (route['routeKey'] !== canonicalRouteKey(hops)) {
      admissionFailure('route-key-mismatch', routeArtifact, `${routeArtifact} routeKey is not canonical for its hops.`);
    }
    if (route['resolvedHops'] === null) {
      unresolvedRouteCount += 1;
    } else {
      const resolved = requireArray(route['resolvedHops'], `${routeArtifact}.resolvedHops`);
      if (resolved.length !== hops.length) {
        admissionFailure('resolved-hop-length-mismatch', routeArtifact, `${routeArtifact} resolved hops differ in length.`);
      }
      resolved.forEach((hop, hopIndex) => {
        const directional = hops[hopIndex];
        if (directional === undefined) throw new Error('Directional hop disappeared.');
        decodeResolvedHop(hop, directional, `${routeArtifact}.resolvedHops[${hopIndex}]`, widths);
      });
    }
    routes.push(hops);
  }
  if (routes.some((route, index) => index > 0 && compareDecodedRoutes(routes[index - 1] ?? [], route) >= 0)) {
    admissionFailure('candidate-route-order-mismatch', artifact, `${artifact} routes are not in canonical decoded order.`);
  }
  if (candidateSet['candidateSetKey'] !== canonicalCandidateSetKey(routes)) {
    admissionFailure('candidate-set-key-mismatch', artifact, `${artifact} candidateSetKey is not canonical for its routes.`);
  }
  const resolutionStatus = requireEnum(
    candidateSet['resolutionStatus'],
    MODEL_RESOLUTION_STATUSES,
    `${artifact}.resolutionStatus`,
  );
  const failureCode = candidateSet['failureCode'] === null
    ? null
    : requireEnum(candidateSet['failureCode'], CANDIDATE_FAILURE_CODES, `${artifact}.failureCode`);
  if (
    (resolutionStatus === 'resolved' &&
      (unresolvedRouteCount !== 0 || failureCode !== null)) ||
    (resolutionStatus === 'failed' &&
      (unresolvedRouteCount !== routes.length || failureCode !== 'invalid-route-model'))
  ) {
    admissionFailure('candidate-resolution-coupling-mismatch', artifact, `${artifact} resolution fields are inconsistent.`);
  }
  return Object.freeze({ resolutionStatus, routes: Object.freeze(routes) });
}

interface ReceiptProjection {
  readonly amountOut: string;
  readonly legCount: number;
  readonly totalHops: number;
  readonly routeKeys: readonly string[];
  readonly allocations: readonly string[];
}

function decodeTransitionReceipt(
  value: unknown,
  artifact: string,
  widths: DecimalWidths,
): {
  readonly hop: DecodedDirectionalHop;
  readonly amountIn: string;
  readonly amountOut: string;
} {
  const transition = requireObject(value, artifact);
  requireExactKeys(
    transition,
    [
      'poolId',
      'assetIn',
      'assetOut',
      'amountIn',
      'amountOut',
      'reserveInBefore',
      'reserveOutBefore',
      'reserveInAfter',
      'reserveOutAfter',
    ],
    artifact,
  );
  const hop = Object.freeze({
    poolId: requireString(transition['poolId'], `${artifact}.poolId`),
    assetIn: requireString(transition['assetIn'], `${artifact}.assetIn`),
    assetOut: requireString(transition['assetOut'], `${artifact}.assetOut`),
  });
  const amountIn = requireDecimal(
    transition['amountIn'],
    `${artifact}.amountIn`,
    false,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const amountOut = requireDecimal(
    transition['amountOut'],
    `${artifact}.amountOut`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const reserveInBefore = requireDecimal(
    transition['reserveInBefore'],
    `${artifact}.reserveInBefore`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const reserveOutBefore = requireDecimal(
    transition['reserveOutBefore'],
    `${artifact}.reserveOutBefore`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const reserveInAfter = requireDecimal(
    transition['reserveInAfter'],
    `${artifact}.reserveInAfter`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const reserveOutAfter = requireDecimal(
    transition['reserveOutAfter'],
    `${artifact}.reserveOutAfter`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  if (
    BigInt(reserveInBefore) + BigInt(amountIn) !== BigInt(reserveInAfter) ||
    BigInt(reserveOutAfter) + BigInt(amountOut) !== BigInt(reserveOutBefore)
  ) {
    admissionFailure('transition-reserve-coupling-mismatch', artifact, `${artifact} reserve transitions are inconsistent.`);
  }
  recordDeltaWidth(reserveInAfter, reserveInBefore, `${artifact}.reserveInDelta`, widths);
  recordDeltaWidth(reserveOutBefore, reserveOutAfter, `${artifact}.reserveOutDelta`, widths);
  return Object.freeze({ hop, amountIn, amountOut });
}

function decodeRouteReceipt(
  value: unknown,
  expected: {
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly assetIn: string;
    readonly assetOut: string;
    readonly amountIn: string;
  },
  artifact: string,
  widths: DecimalWidths,
): {
  readonly amountOut: string;
  readonly routeKey: string;
  readonly hopCount: number;
  readonly route: readonly DecodedDirectionalHop[];
} {
  const receipt = requireObject(value, artifact);
  requireExactKeys(
    receipt,
    ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut', 'amountIn', 'amountOut', 'hops'],
    artifact,
  );
  if (
    requireString(receipt['snapshotId'], `${artifact}.snapshotId`) !== expected.snapshotId ||
    requireHash(receipt['snapshotChecksum'], `${artifact}.snapshotChecksum`) !== expected.snapshotChecksum ||
    requireString(receipt['assetIn'], `${artifact}.assetIn`) !== expected.assetIn ||
    requireString(receipt['assetOut'], `${artifact}.assetOut`) !== expected.assetOut
  ) {
    admissionFailure('receipt-request-binding-mismatch', artifact, `${artifact} is not bound to its input request.`);
  }
  const amountIn = requireDecimal(
    receipt['amountIn'],
    `${artifact}.amountIn`,
    false,
    MAX_REQUEST_ALLOCATION_DIGITS,
    widths,
    'request-allocation',
  );
  if (amountIn !== expected.amountIn) {
    admissionFailure('receipt-allocation-mismatch', artifact, `${artifact} amountIn differs from its allocation.`);
  }
  const amountOut = requireDecimal(
    receipt['amountOut'],
    `${artifact}.amountOut`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const hopValues = requireArray(receipt['hops'], `${artifact}.hops`);
  if (hopValues.length === 0 || hopValues.length > 2) {
    admissionFailure('invalid-receipt-hops', artifact, `${artifact} must contain one or two receipt hops.`);
  }
  const transitions = hopValues.map((hop, index) =>
    decodeTransitionReceipt(hop, `${artifact}.hops[${index}]`, widths));
  assertRouteContinuity(
    transitions.map((transition) => transition.hop),
    expected.assetIn,
    expected.assetOut,
    artifact,
  );
  if (
    transitions[0]?.amountIn !== amountIn ||
    transitions.at(-1)?.amountOut !== amountOut ||
    transitions.some((transition, index) =>
      index > 0 && transitions[index - 1]?.amountOut !== transition.amountIn)
  ) {
    admissionFailure('receipt-hop-amount-mismatch', artifact, `${artifact} hop amounts do not form one exact route receipt.`);
  }
  return Object.freeze({
    amountOut,
    routeKey: canonicalRouteKey(transitions.map((transition) => transition.hop)),
    hopCount: transitions.length,
    route: Object.freeze(transitions.map((transition) => transition.hop)),
  });
}

function decodeSplitReceipt(
  value: unknown,
  expected: {
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly assetIn: string;
    readonly assetOut: string;
    readonly amountIn: string;
  },
  artifact: string,
  widths: DecimalWidths,
): ReceiptProjection {
  const receipt = requireObject(value, artifact);
  requireExactKeys(
    receipt,
    ['snapshotId', 'snapshotChecksum', 'assetIn', 'assetOut', 'amountIn', 'amountOut', 'legs'],
    artifact,
  );
  if (
    requireString(receipt['snapshotId'], `${artifact}.snapshotId`) !== expected.snapshotId ||
    requireHash(receipt['snapshotChecksum'], `${artifact}.snapshotChecksum`) !== expected.snapshotChecksum ||
    requireString(receipt['assetIn'], `${artifact}.assetIn`) !== expected.assetIn ||
    requireString(receipt['assetOut'], `${artifact}.assetOut`) !== expected.assetOut
  ) {
    admissionFailure('receipt-request-binding-mismatch', artifact, `${artifact} is not bound to its input request.`);
  }
  const amountIn = requireDecimal(
    receipt['amountIn'],
    `${artifact}.amountIn`,
    true,
    MAX_REQUEST_ALLOCATION_DIGITS,
    widths,
    'request-allocation',
  );
  if (amountIn !== expected.amountIn) {
    admissionFailure('receipt-request-amount-mismatch', artifact, `${artifact} amountIn differs from its request.`);
  }
  const amountOut = requireDecimal(
    receipt['amountOut'],
    `${artifact}.amountOut`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const legValues = requireArray(receipt['legs'], `${artifact}.legs`);
  if (legValues.length === 0 || legValues.length > 2) {
    admissionFailure('invalid-receipt-legs', artifact, `${artifact} must contain one or two receipt legs.`);
  }
  const allocations: string[] = [];
  const routeKeys: string[] = [];
  const decodedRoutes: (readonly DecodedDirectionalHop[])[] = [];
  const receiptPools = new Set<string>();
  let outputSum = 0n;
  let totalHops = 0;
  for (const [legIndex, legValue] of legValues.entries()) {
    const legArtifact = `${artifact}.legs[${legIndex}]`;
    const leg = requireObject(legValue, legArtifact);
    requireExactKeys(leg, ['allocation', 'receipt'], legArtifact);
    const allocation = requireDecimal(
      leg['allocation'],
      `${legArtifact}.allocation`,
      true,
      MAX_REQUEST_ALLOCATION_DIGITS,
      widths,
      'request-allocation',
    );
    const projected = decodeRouteReceipt(
      leg['receipt'],
      { ...expected, amountIn: allocation },
      `${legArtifact}.receipt`,
      widths,
    );
    allocations.push(allocation);
    routeKeys.push(projected.routeKey);
    decodedRoutes.push(projected.route);
    for (const hop of projected.route) {
      if (receiptPools.has(hop.poolId)) {
        admissionFailure('receipt-pool-overlap', artifact, `${artifact} receipt legs are not pool-disjoint.`);
      }
      receiptPools.add(hop.poolId);
    }
    outputSum += BigInt(projected.amountOut);
    totalHops += projected.hopCount;
  }
  if (allocations.reduce((sum, allocation) => sum + BigInt(allocation), 0n) !== BigInt(amountIn)) {
    admissionFailure('receipt-allocation-sum-mismatch', artifact, `${artifact} allocations do not sum to exact input.`);
  }
  if (outputSum !== BigInt(amountOut)) {
    admissionFailure('receipt-output-sum-mismatch', artifact, `${artifact} leg outputs do not sum to total output.`);
  }
  if (decodedRoutes.some((route, index) =>
    index > 0 && compareDecodedRoutes(decodedRoutes[index - 1] ?? [], route) >= 0)) {
    admissionFailure('receipt-route-order-mismatch', artifact, `${artifact} legs are not in canonical decoded route order.`);
  }
  return Object.freeze({
    amountOut,
    legCount: legValues.length,
    totalHops,
    routeKeys: Object.freeze(routeKeys),
    allocations: Object.freeze(allocations),
  });
}

function decodeExactObjective(
  value: unknown,
  receipt: ReceiptProjection | null,
  artifact: string,
  widths: DecimalWidths,
): void {
  const objective = requireObject(value, artifact);
  requireExactKeys(
    objective,
    ['hasPlan', 'amountOut', 'legCount', 'totalHops', 'routeKeys', 'allocations'],
    artifact,
  );
  const hasPlan = requireBoolean(objective['hasPlan'], `${artifact}.hasPlan`);
  const routeKeys = requireArray(objective['routeKeys'], `${artifact}.routeKeys`).map((routeKey, index) =>
    requireString(routeKey, `${artifact}.routeKeys[${index}]`));
  const allocations = requireArray(objective['allocations'], `${artifact}.allocations`).map(
    (allocation, index) => requireDecimal(
      allocation,
      `${artifact}.allocations[${index}]`,
      true,
      MAX_REQUEST_ALLOCATION_DIGITS,
      widths,
      'request-allocation',
    ),
  );
  if (!hasPlan) {
    if (
      objective['amountOut'] !== null ||
      objective['legCount'] !== null ||
      objective['totalHops'] !== null ||
      routeKeys.length !== 0 ||
      allocations.length !== 0 ||
      receipt !== null
    ) {
      admissionFailure('no-plan-objective-mismatch', artifact, `${artifact} no-plan fields are inconsistent.`);
    }
    return;
  }
  if (receipt === null) {
    admissionFailure('plan-objective-receipt-missing', artifact, `${artifact} plan has no receipt.`);
  }
  const amountOut = requireDecimal(
    objective['amountOut'],
    `${artifact}.amountOut`,
    true,
    MAX_RESERVE_OUTPUT_DELTA_DIGITS,
    widths,
    'reserve-output-delta',
  );
  const legCount = requireSafeInteger(objective['legCount'], `${artifact}.legCount`, true);
  const totalHops = requireSafeInteger(objective['totalHops'], `${artifact}.totalHops`, true);
  if (
    amountOut !== receipt.amountOut ||
    legCount !== receipt.legCount ||
    totalHops !== receipt.totalHops ||
    !sameStrings(routeKeys, receipt.routeKeys) ||
    !sameStrings(allocations, receipt.allocations)
  ) {
    admissionFailure('objective-receipt-mismatch', artifact, `${artifact} is not derived exactly from its receipt.`);
  }
}

function decodeEntryBaseline(
  value: unknown,
  expected: {
    readonly snapshotId: string;
    readonly snapshotChecksum: string;
    readonly assetIn: string;
    readonly assetOut: string;
    readonly amountIn: string;
  },
  artifact: string,
  widths: DecimalWidths,
): void {
  const baseline = requireObject(value, artifact);
  requireExactKeys(
    baseline,
    ['boundSemanticCellHash', 'freshReplayMatchesBoundCell', 'incumbent'],
    artifact,
  );
  requireHash(baseline['boundSemanticCellHash'], `${artifact}.boundSemanticCellHash`);
  if (requireBoolean(baseline['freshReplayMatchesBoundCell'], `${artifact}.freshReplayMatchesBoundCell`) !== true) {
    admissionFailure('fresh-replay-binding-mismatch', artifact, `${artifact} must preserve accepted fresh replay parity.`);
  }
  const incumbentArtifact = `${artifact}.incumbent`;
  const incumbent = requireObject(baseline['incumbent'], incumbentArtifact);
  requireExactKeys(
    incumbent,
    ['status', 'reason', 'receipt', 'objective', 'receiptHash'],
    incumbentArtifact,
  );
  const status = requireEnum(incumbent['status'], EXACT_RESULT_STATUSES, `${incumbentArtifact}.status`);
  const reason = requireNullableString(incumbent['reason'], `${incumbentArtifact}.reason`);
  const receiptHash = requireNullableHash(incumbent['receiptHash'], `${incumbentArtifact}.receiptHash`);
  const receipt = incumbent['receipt'] === null
    ? null
    : decodeSplitReceipt(incumbent['receipt'], expected, `${incumbentArtifact}.receipt`, widths);
  decodeExactObjective(incumbent['objective'], receipt, `${incumbentArtifact}.objective`, widths);
  if (status === 'success') {
    if (reason !== null || receipt === null || receiptHash === null) {
      admissionFailure('success-incumbent-coupling-mismatch', incumbentArtifact, 'Successful incumbent fields are inconsistent.');
    }
    const encodedReceipt = new TextEncoder().encode(JSON.stringify(incumbent['receipt']));
    if (sha256Bytes(encodedReceipt) !== receiptHash) {
      admissionFailure('receipt-hash-mismatch', incumbentArtifact, 'Successful incumbent receipt hash is invalid.');
    }
  } else if (reason === null || receipt !== null || receiptHash !== null) {
    admissionFailure('no-plan-incumbent-coupling-mismatch', incumbentArtifact, 'No-route/no-plan incumbent fields are inconsistent.');
  }
}

interface DecodedInputSummary {
  readonly caseId: string;
  readonly requestId: string;
  readonly topology: string;
  readonly amountBucket: string;
  readonly serviceDecisionMember: boolean;
  readonly amplifiedStressMember: boolean;
  readonly priorEligible: boolean;
  readonly timingCohortIndex: number | null;
}

function decodeInputRecord(
  record: Record<string, unknown>,
  index: number,
  config: FrozenServiceFastConfiguration,
  widths: DecimalWidths,
): DecodedInputSummary {
  const artifact = `input[${index}]`;
  const input = config.inputConstruction.inputArtifact;
  requireExactKeys(record, input.recordFieldOrder, artifact);
  if (record['schemaVersion'] !== input.schemaVersion) {
    admissionFailure('input-schema-mismatch', artifact, `${artifact} has the wrong schema version.`);
  }
  if (requireSafeInteger(record['sourceIndex'], `${artifact}.sourceIndex`) !== index) {
    admissionFailure('input-source-order-mismatch', artifact, `${artifact} has the wrong source index.`);
  }
  const expectedCase = config.cohorts.cases.find((suiteCase) => {
    const preceding = config.cohorts.cases
      .slice(0, config.cohorts.cases.indexOf(suiteCase))
      .reduce((sum, candidate) => sum + candidate.requestCount, 0);
    return index >= preceding && index < preceding + suiteCase.requestCount;
  });
  if (expectedCase === undefined) {
    admissionFailure('input-case-order-mismatch', artifact, `${artifact} has no frozen case position.`);
  }
  const caseId = requireEnum(record['caseId'], config.cohorts.caseOrder, `${artifact}.caseId`);
  if (caseId !== expectedCase.caseId) {
    admissionFailure('input-case-order-mismatch', artifact, `${artifact} is outside frozen case order.`);
  }
  const requestId = requireString(record['requestId'], `${artifact}.requestId`);

  const snapshot = requireObject(record['snapshot'], `${artifact}.snapshot`);
  requireExactKeys(snapshot, ['snapshotId', 'snapshotChecksum'], `${artifact}.snapshot`);
  const snapshotId = requireString(snapshot['snapshotId'], `${artifact}.snapshot.snapshotId`);
  const snapshotChecksum = requireHash(snapshot['snapshotChecksum'], `${artifact}.snapshot.snapshotChecksum`);
  if (snapshotId !== expectedCase.snapshotId || snapshotChecksum !== expectedCase.snapshotChecksum) {
    admissionFailure('input-snapshot-binding-mismatch', artifact, `${artifact} snapshot differs from its frozen case.`);
  }

  const requestArtifact = `${artifact}.request`;
  const request = requireObject(record['request'], requestArtifact);
  requireExactKeys(
    request,
    ['assetIn', 'assetOut', 'amountBucket', 'amountIn', 'topology', 'maxHops', 'maxRoutes', 'greedyParts'],
    requestArtifact,
  );
  const assetIn = requireString(request['assetIn'], `${requestArtifact}.assetIn`);
  const assetOut = requireString(request['assetOut'], `${requestArtifact}.assetOut`);
  if (assetIn === assetOut) {
    admissionFailure('invalid-input-request-assets', requestArtifact, 'Input and output assets must differ.');
  }
  const amountBucket = requireString(request['amountBucket'], `${requestArtifact}.amountBucket`);
  const amountIn = requireDecimal(
    request['amountIn'],
    `${requestArtifact}.amountIn`,
    true,
    MAX_REQUEST_ALLOCATION_DIGITS,
    widths,
    'request-allocation',
  );
  const topology = requireString(request['topology'], `${requestArtifact}.topology`);
  const maxHops = requireSafeInteger(request['maxHops'], `${requestArtifact}.maxHops`, true);
  const maxRoutes = requireSafeInteger(request['maxRoutes'], `${requestArtifact}.maxRoutes`, true);
  const greedyParts = requireSafeInteger(request['greedyParts'], `${requestArtifact}.greedyParts`, true);
  if (
    maxHops !== config.inputConstruction.request.maxHops ||
    maxRoutes !== config.inputConstruction.request.maxRoutes ||
    greedyParts !== config.inputConstruction.request.greedyParts
  ) {
    admissionFailure('input-request-control-mismatch', requestArtifact, 'Input request controls differ from the frozen construction controls.');
  }

  const eligibilityArtifact = `${artifact}.priorEligibility`;
  const eligibility = requireObject(record['priorEligibility'], eligibilityArtifact);
  requireExactKeys(
    eligibility,
    ['status', 'reason', 'search', 'modelValidCandidateSetCount'],
    eligibilityArtifact,
  );
  const eligibilityStatus = requireEnum(
    eligibility['status'],
    ELIGIBILITY_STATUSES,
    `${eligibilityArtifact}.status`,
  );
  const eligibilityReason = eligibility['reason'] === null
    ? null
    : requireEnum(eligibility['reason'], ELIGIBILITY_REASONS, `${eligibilityArtifact}.reason`);
  if (
    (eligibilityStatus === 'eligible' && eligibilityReason !== null) ||
    (eligibilityStatus === 'ineligible' && eligibilityReason === null)
  ) {
    admissionFailure('eligibility-coupling-mismatch', eligibilityArtifact, 'Eligibility status and reason are inconsistent.');
  }
  const searchArtifact = `${eligibilityArtifact}.search`;
  const search = requireObject(eligibility['search'], searchArtifact);
  requireExactKeys(
    search,
    [
      'pathExpansions',
      'enumeratedPaths',
      'pathTermination',
      'candidateSetExpansions',
      'enumeratedCandidateSets',
      'candidateSetTermination',
    ],
    searchArtifact,
  );
  requireSafeInteger(search['pathExpansions'], `${searchArtifact}.pathExpansions`);
  requireSafeInteger(search['enumeratedPaths'], `${searchArtifact}.enumeratedPaths`);
  requireEnum(search['pathTermination'], WORK_TERMINATIONS, `${searchArtifact}.pathTermination`);
  requireSafeInteger(search['candidateSetExpansions'], `${searchArtifact}.candidateSetExpansions`);
  requireSafeInteger(search['enumeratedCandidateSets'], `${searchArtifact}.enumeratedCandidateSets`);
  requireEnum(search['candidateSetTermination'], WORK_TERMINATIONS, `${searchArtifact}.candidateSetTermination`);
  requireSafeInteger(
    eligibility['modelValidCandidateSetCount'],
    `${eligibilityArtifact}.modelValidCandidateSetCount`,
  );

  const serviceDecisionMember = requireBoolean(
    record['serviceDecisionMember'],
    `${artifact}.serviceDecisionMember`,
  );
  const amplifiedStressMember = requireBoolean(
    record['amplifiedStressMember'],
    `${artifact}.amplifiedStressMember`,
  );
  if (
    serviceDecisionMember !== expectedCase.serviceDecision ||
    amplifiedStressMember !== !expectedCase.serviceDecision
  ) {
    admissionFailure('input-cohort-membership-mismatch', artifact, `${artifact} has incorrect case membership flags.`);
  }
  const timingCohortIndex = record['timingCohortIndex'] === null
    ? null
    : requireSafeInteger(record['timingCohortIndex'], `${artifact}.timingCohortIndex`);

  decodeEntryBaseline(
    record['entryBaseline'],
    { snapshotId, snapshotChecksum, assetIn, assetOut, amountIn },
    `${artifact}.entryBaseline`,
    widths,
  );

  const discoveryArtifact = `${artifact}.candidateDiscovery`;
  const discovery = requireObject(record['candidateDiscovery'], discoveryArtifact);
  requireExactKeys(discovery, ['termination', 'counters', 'candidateSets'], discoveryArtifact);
  if (discovery['termination'] !== 'complete') {
    admissionFailure('candidate-discovery-incomplete', discoveryArtifact, 'Candidate discovery must be complete.');
  }
  const counters = requireObject(discovery['counters'], `${discoveryArtifact}.counters`);
  requireExactKeys(
    counters,
    ['pathExpansions', 'enumeratedPaths', 'candidateSetExpansions', 'enumeratedCandidateSets'],
    `${discoveryArtifact}.counters`,
  );
  const pathExpansions = requireSafeInteger(
    counters['pathExpansions'],
    `${discoveryArtifact}.counters.pathExpansions`,
  );
  const enumeratedPaths = requireSafeInteger(
    counters['enumeratedPaths'],
    `${discoveryArtifact}.counters.enumeratedPaths`,
  );
  const candidateSetExpansions = requireSafeInteger(
    counters['candidateSetExpansions'],
    `${discoveryArtifact}.counters.candidateSetExpansions`,
  );
  const enumeratedCandidateSets = requireSafeInteger(
    counters['enumeratedCandidateSets'],
    `${discoveryArtifact}.counters.enumeratedCandidateSets`,
  );
  const maximumPathExpansions = config.inputConstruction.workProfile.workCaps['maxPathExpansions'];
  const maximumCandidateSetExpansions =
    config.inputConstruction.workProfile.workCaps['maxCandidateSetExpansions'];
  if (
    maximumPathExpansions === undefined ||
    maximumCandidateSetExpansions === undefined ||
    pathExpansions > maximumPathExpansions ||
    candidateSetExpansions > maximumCandidateSetExpansions ||
    enumeratedPaths > pathExpansions ||
    enumeratedCandidateSets > candidateSetExpansions
  ) {
    admissionFailure('candidate-discovery-counter-mismatch', discoveryArtifact, 'Candidate discovery counters violate frozen structural caps or relations.');
  }
  const candidateSetValues = requireArray(discovery['candidateSets'], `${discoveryArtifact}.candidateSets`);
  if (
    candidateSetValues.length !== Math.min(
      enumeratedCandidateSets,
      config.inputConstruction.candidateSets.retainFirst,
    )
  ) {
    admissionFailure('invalid-input-candidate-sets', discoveryArtifact, 'Retained candidate-set count differs from complete enumeration.');
  }
  const candidateSets = candidateSetValues.map((candidateSet, setIndex) =>
    decodeCandidateSet(
      candidateSet,
      setIndex,
      { assetIn, assetOut, maxHops, maxRoutes },
      `${discoveryArtifact}.candidateSets[${setIndex}]`,
      widths,
    ));
  if (candidateSets.some((candidateSet, index) =>
    index > 0 && compareDecodedCandidateSets(
      candidateSets[index - 1]?.routes ?? [],
      candidateSet.routes,
    ) >= 0)) {
    admissionFailure('candidate-set-order-mismatch', discoveryArtifact, 'Candidate sets are duplicated or not in canonical decoded order.');
  }
  const expectedRepairTarget = candidateSets.findIndex((candidateSet) =>
    candidateSet.resolutionStatus === 'resolved');
  const repairTargetSetIndex = record['repairTargetSetIndex'] === null
    ? null
    : requireSafeInteger(record['repairTargetSetIndex'], `${artifact}.repairTargetSetIndex`);
  if (repairTargetSetIndex !== (expectedRepairTarget < 0 ? null : expectedRepairTarget)) {
    admissionFailure('repair-target-index-mismatch', artifact, `${artifact} does not name its first resolved set.`);
  }
  if (record['actionCeilingProfileId'] !== config.inputConstruction.workProfile.profileId) {
    admissionFailure('action-ceiling-profile-mismatch', artifact, `${artifact} has the wrong work profile.`);
  }
  return Object.freeze({
    caseId,
    requestId,
    topology,
    amountBucket,
    serviceDecisionMember,
    amplifiedStressMember,
    priorEligible: eligibilityStatus === 'eligible',
    timingCohortIndex,
  });
}

function identityHash(identities: readonly { readonly caseId: string; readonly requestId: string }[]): string {
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(identities)));
}

function verifyCohort(
  identities: readonly { readonly caseId: string; readonly requestId: string }[],
  expected: { readonly count: number; readonly sha256: string },
  artifact: string,
): void {
  if (identities.length !== expected.count || identityHash(identities) !== expected.sha256) {
    admissionFailure('input-cohort-binding-mismatch', artifact, `${artifact} count or identity hash is invalid.`);
  }
}

function validateInputCohorts(
  records: readonly DecodedInputSummary[],
  config: FrozenServiceFastConfiguration,
): void {
  const identity = (record: DecodedInputSummary) => Object.freeze({
    caseId: record.caseId,
    requestId: record.requestId,
  });
  verifyCohort(records.map(identity), config.cohorts.full, 'cohorts.full');
  verifyCohort(
    records.filter((record) => record.serviceDecisionMember).map(identity),
    config.cohorts.serviceDecision,
    'cohorts.serviceDecision',
  );
  verifyCohort(
    records.filter((record) => record.amplifiedStressMember).map(identity),
    config.cohorts.amplifiedStress,
    'cohorts.amplifiedStress',
  );
  verifyCohort(
    records.filter((record) => record.priorEligible).map(identity),
    config.cohorts.priorEligibleBoundOnly,
    'cohorts.priorEligibleBoundOnly',
  );
  verifyCohort(
    records.filter((record) => record.priorEligible && record.serviceDecisionMember).map(identity),
    config.cohorts.priorEligibleServiceBoundOnly,
    'cohorts.priorEligibleServiceBoundOnly',
  );

  const operationalCases = new Set(
    config.cohorts.cases.filter((suiteCase) => suiteCase.operational).map((suiteCase) => suiteCase.caseId),
  );
  const selected: DecodedInputSummary[] = [];
  const stratumCounts = new Map<string, number>();
  const perCaseCounts = new Map<string, number>();
  const strataByCase = new Map<string, Set<string>>();
  for (const record of records) {
    const stratum = `${record.caseId}\0${record.topology}\0${record.amountBucket}`;
    const seen = stratumCounts.get(stratum) ?? 0;
    const retained = operationalCases.has(record.caseId) && seen < 12;
    if (operationalCases.has(record.caseId)) {
      stratumCounts.set(stratum, seen + 1);
      const caseStrata = strataByCase.get(record.caseId) ?? new Set<string>();
      caseStrata.add(stratum);
      strataByCase.set(record.caseId, caseStrata);
    }
    const expectedIndex = retained ? selected.length : null;
    if (record.timingCohortIndex !== expectedIndex) {
      admissionFailure('timing-cohort-index-mismatch', record.requestId, 'Timing cohort indexes are not the frozen zero-based operational subsequence.');
    }
    if (retained) {
      selected.push(record);
      perCaseCounts.set(record.caseId, (perCaseCounts.get(record.caseId) ?? 0) + 1);
    }
  }
  verifyCohort(selected.map(identity), config.cohorts.operational, 'cohorts.operational');
  for (const [caseId, expected] of Object.entries(config.cohorts.operational.perCaseCounts)) {
    if ((perCaseCounts.get(caseId) ?? 0) !== expected) {
      admissionFailure('operational-case-count-mismatch', caseId, 'Operational per-case count is invalid.');
    }
  }
  for (const [caseId, expected] of Object.entries(config.cohorts.operational.nonemptyStrataPerCase)) {
    if ((strataByCase.get(caseId)?.size ?? 0) !== expected) {
      admissionFailure('operational-stratum-count-mismatch', caseId, 'Operational stratum count is invalid.');
    }
  }
}

function inspectJsonValue(
  value: unknown,
  visitString: (value: string) => void,
  artifact: string,
): void {
  if (typeof value === 'string') {
    visitString(value);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      admissionFailure('unsafe-input-number', artifact, `${artifact} contains an unsafe structural number.`);
    }
    return;
  }
  if (typeof value === 'boolean' || value === null) return;
  if (Array.isArray(value)) {
    for (const member of value) inspectJsonValue(member, visitString, artifact);
    return;
  }
  const object = requireObject(value, artifact);
  for (const member of Object.values(object)) inspectJsonValue(member, visitString, artifact);
}

export function deriveCommittedInputStructuralWidths(
  bytes: Uint8Array,
  config: FrozenServiceFastConfiguration,
): CommittedInputStructuralWidths {
  const input = config.inputConstruction.inputArtifact;
  if (bytes.byteLength === 0 || bytes.byteLength > input.maxBytes) {
    return admissionFailure('input-cap-failure', input.path, 'Committed input bytes violate the frozen cap.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return admissionFailure('invalid-input-utf8', input.path, 'Committed input bytes are not valid UTF-8.');
  }
  if (!text.endsWith('\n') || text.startsWith('\ufeff') || text.includes('\r')) {
    return admissionFailure('noncanonical-input', input.path, 'Committed input must be LF-terminated canonical NDJSON.');
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== input.recordCount || lines.some((line) => line.length === 0)) {
    return admissionFailure('input-record-count-mismatch', input.path, 'Committed input has the wrong record count.');
  }

  let widestIdentifier = '';
  let widestCaseId = '';
  let widestRequestId = '';
  let widestRouteKey = '';
  const decimalWidths: DecimalWidths = {
    maximumCanonical: 1,
    maximumRequestAllocation: 1,
    maximumReserveOutputDelta: 1,
  };
  let maximumRecordBytes = 0;
  let maximumCandidateSetCount = 0;
  let maximumRoutesPerCandidateSet = 0;
  let maximumHopsPerRoute = 0;
  const decodedRecords: DecodedInputSummary[] = [];
  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return admissionFailure('invalid-input-json', input.path, `Input record ${index} is invalid JSON.`);
    }
    if (JSON.stringify(parsed) !== line) {
      return admissionFailure('noncanonical-input-record', input.path, `Input record ${index} is not canonical minified JSON.`);
    }
    const record = requireObject(parsed, `input[${index}]`);
    const decoded = decodeInputRecord(record, index, config, decimalWidths);
    decodedRecords.push(decoded);
    widestCaseId = chooseWider(widestCaseId, decoded.caseId);
    widestRequestId = chooseWider(widestRequestId, decoded.requestId);
    inspectJsonValue(parsed, (stringValue) => {
      widestIdentifier = chooseWider(widestIdentifier, stringValue);
      if (stringValue.startsWith('[[')) widestRouteKey = chooseWider(widestRouteKey, stringValue);
    }, `input[${index}]`);
    const discovery = requireObject(record['candidateDiscovery'], `input[${index}].candidateDiscovery`);
    const candidateSets = discovery['candidateSets'];
    if (!Array.isArray(candidateSets) || candidateSets.length > 4) {
      return admissionFailure('invalid-input-candidate-sets', input.path, `Input record ${index} candidate sets are invalid.`);
    }
    maximumCandidateSetCount = Math.max(maximumCandidateSetCount, candidateSets.length);
    for (const [setIndex, candidateSetValue] of candidateSets.entries()) {
      const candidateSet = requireObject(candidateSetValue, `input[${index}].candidateSets[${setIndex}]`);
      const candidateSetKey = requireString(
        candidateSet['candidateSetKey'],
        `input[${index}].candidateSets[${setIndex}].candidateSetKey`,
      );
      widestRouteKey = chooseWider(widestRouteKey, candidateSetKey);
      const routes = candidateSet['routes'];
      if (!Array.isArray(routes) || routes.length !== 2) {
        return admissionFailure('invalid-input-routes', input.path, `Input record ${index} routes are invalid.`);
      }
      maximumRoutesPerCandidateSet = Math.max(maximumRoutesPerCandidateSet, routes.length);
      for (const routeValue of routes) {
        const route = requireObject(routeValue, `input[${index}].route`);
        if (typeof route['routeKey'] === 'string') {
          widestRouteKey = chooseWider(widestRouteKey, route['routeKey']);
        }
        const hops = route['hops'];
        if (!Array.isArray(hops) || hops.length > 2) {
          return admissionFailure('invalid-input-hops', input.path, `Input record ${index} hops are invalid.`);
        }
        maximumHopsPerRoute = Math.max(maximumHopsPerRoute, hops.length);
      }
    }
    maximumRecordBytes = Math.max(
      maximumRecordBytes,
      new TextEncoder().encode(`${line}\n`).byteLength,
    );
  }
  validateInputCohorts(decodedRecords, config);
  return Object.freeze({
    descriptor: descriptorForBytes(input.path, bytes),
    recordCount: lines.length,
    maximumRecordBytesIncludingLineFeed: maximumRecordBytes,
    widestIdentifier,
    widestCaseId,
    widestRequestId,
    widestRouteKey,
    maximumCanonicalDecimalDigits: decimalWidths.maximumCanonical,
    maximumRequestAndAllocationDecimalDigits: decimalWidths.maximumRequestAllocation,
    maximumReserveOutputAndDeltaDecimalDigits: decimalWidths.maximumReserveOutputDelta,
    maximumCandidateSetCount,
    maximumRoutesPerCandidateSet,
    maximumHopsPerRoute,
  });
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`).byteLength;
}

function longest(values: readonly string[]): string {
  const first = values[0];
  if (first === undefined) throw new TypeError('Expected a nonempty frozen value list.');
  return values.slice(1).reduce(chooseWider, first);
}

function descriptor(path: string, maximumBytes: number): SourceClosureDescriptor {
  return Object.freeze({ path, bytes: maximumBytes, sha256: HASH });
}

function exactRational(): Readonly<Record<string, unknown>> {
  return Object.freeze({ numerator: MAX_SIGNED_METRIC, denominator: MAX_POSITIVE_METRIC });
}

function failureFamilyCounts(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    nonConvergence: MAX_SAFE_INTEGER,
    residualOptionsExhausted: MAX_SAFE_INTEGER,
    untypedFailures: MAX_SAFE_INTEGER,
    exactSafetyFailures: MAX_SAFE_INTEGER,
  });
}

function environment(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    nodeVersion: 'v24.18.0',
    v8Version: '13.6.233.17-node.50',
    uvVersion: '1.52.1',
    platform: 'linux',
    arch: 'x64',
    endianness: 'LE',
    osType: 'Linux',
    osRelease: '6.18.33.2-microsoft-standard-WSL2',
    cpuModel: '13th Gen Intel(R) Core(TM) i9-13900H',
    cpuSpeedMHz: MAX_SAFE_INTEGER,
    logicalCpuCount: MAX_SAFE_INTEGER,
    availableParallelism: MAX_SAFE_INTEGER,
    totalMemoryBytes: String(MAX_SAFE_INTEGER),
    timezone: '\0'.repeat(128),
    execArgv: Object.freeze([]),
    nodeOptionsState: 'unset',
    mainThread: false,
  });
}

function incumbentReference(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    origin: 'candidate-set',
    candidateSetIndex: MAX_SAFE_INTEGER,
    selectedScoreSource: 'current',
    selectedAttemptIndex: MAX_SAFE_INTEGER,
    objectiveHash: HASH,
    receiptHash: HASH,
  });
}

function decisionVariants(
  policyIds: readonly string[],
): readonly Readonly<Record<string, unknown>>[] {
  const selectedPolicyId = longest(policyIds.slice(1));
  const ranked = Object.freeze([
    selectedPolicyId,
    ...policyIds.slice(1).filter((policyId) => policyId !== selectedPolicyId),
  ]);
  return Object.freeze([
    Object.freeze({
      status: 'selected-policy',
      policyId: selectedPolicyId,
      fallbackDecisionId: null,
      rankedQualifyingPolicyIds: ranked,
      reason: 'highest-ranked-qualifying-policy',
    }),
    Object.freeze({
      status: 'strict-reference-fallback',
      policyId: null,
      fallbackDecisionId: 'strict-reference-fallback',
      rankedQualifyingPolicyIds: Object.freeze([]),
      reason: 'trustworthy-complete-no-policy-qualified',
    }),
    Object.freeze({
      status: 'rejected-observation',
      policyId: null,
      fallbackDecisionId: null,
      rankedQualifyingPolicyIds: Object.freeze([]),
      reason: 'incomplete-or-untrustworthy-observation',
    }),
  ]);
}

function widestDecision(policyIds: readonly string[]): Readonly<Record<string, unknown>> {
  return decisionVariants(policyIds).reduce((widest, candidate) =>
    serializedBytes(candidate) > serializedBytes(widest) ? candidate : widest);
}

function buildDryAnalysis(
  config: FrozenServiceFastConfiguration,
  widths: CommittedInputStructuralWidths,
  closureDescriptor: SourceClosureDescriptor,
): Readonly<Record<string, unknown>> {
  const policyIds = config.policyMatrix.policyIds;
  const driverIds = config.policyMatrix.driverOrder;
  const cases = ['historical-anchor', 'synthetic-dual-spanning-tree', 'synthetic-reserve-compressed-1e12'];
  const hotspots = ['historical-anchor', 'synthetic-reserve-compressed-1e12'];
  const events = [
    'first-exact-authorization-strictly-improving-entry-incumbent',
    'final-best-incumbent-first-installed',
  ];
  const deadlines = [1, 5, 10, 25, 50, 100];
  const policyResults = policyIds.map((policyId, policyMatrixIndex) => Object.freeze({
    policyId,
    policyMatrixIndex,
    driverId: driverIds[Math.floor(policyMatrixIndex / 4)] ?? longest(driverIds),
    mappedShareActionCeiling: 68_640,
    semantic: Object.freeze({
      invalidFreshReplayCount: MAX_SAFE_INTEGER,
      forcedFailureIncumbentMismatchCount: MAX_SAFE_INTEGER,
      finalObjectivesNeverWorse: false,
      anchorPlanLostCount: MAX_SAFE_INTEGER,
      unterminatedDiagnosticCount: MAX_SAFE_INTEGER,
      anchorServiceFailures: failureFamilyCounts(),
      candidateServiceFailures: failureFamilyCounts(),
      amplifiedFailures: failureFamilyCounts(),
    }),
    callCases: Object.freeze(cases.map((caseId) => Object.freeze({
      caseId,
      pairedDeltaMedian: exactRational(),
      elapsedRatio: exactRational(),
    }))),
    instrumentedEvents: Object.freeze(hotspots.flatMap((caseId) =>
      events.map((event) => Object.freeze({
        caseId,
        event,
        anchorAvailabilityCount: MAX_SAFE_INTEGER,
        candidateAvailabilityCount: MAX_SAFE_INTEGER,
        pairedFiniteCount: MAX_SAFE_INTEGER,
        pairedFiniteMedianDelta: exactRational(),
      })))),
    deadlineCases: Object.freeze(cases.flatMap((caseId) =>
      deadlines.map((deadlineMilliseconds) => Object.freeze({
        caseId,
        deadlineMilliseconds,
        anchor: Object.freeze({
          entryPlan: MAX_SAFE_INTEGER,
          anyValidScore: MAX_SAFE_INTEGER,
          anyImprovement: MAX_SAFE_INTEGER,
          anchorQuality: MAX_SAFE_INTEGER,
          completeStage: MAX_SAFE_INTEGER,
        }),
        candidate: Object.freeze({
          entryPlan: MAX_SAFE_INTEGER,
          anyValidScore: MAX_SAFE_INTEGER,
          anyImprovement: MAX_SAFE_INTEGER,
          anchorQuality: MAX_SAFE_INTEGER,
          completeStage: MAX_SAFE_INTEGER,
        }),
      })))),
    rankingValues: Object.freeze({
      worstHotspotElapsedRatio: exactRational(),
      anchorQualityVector: Object.freeze(Array.from({ length: 18 }, () => MAX_SAFE_INTEGER)),
      mappedShareActionCeiling: 68_640,
      policyMatrixIndex,
    }),
  }));
  const qualifiers = policyIds.slice(1).map((policyId) => Object.freeze({
    policyId,
    clauseResults: Object.freeze(CLAUSE_IDS.map((clauseId) => Object.freeze({
      clauseId,
      passed: false,
      policyEvidenceHash: HASH,
    }))),
    qualifies: false,
  }));
  const configDescriptor = descriptor(
    'fixtures/m7c/service-fast-numerical/experiment-config.v1.json',
    76_816,
  );
  const schemaDescriptor = config.artifactSchema;
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-analysis.v1',
    experimentId: config.experimentId,
    inputBinding: Object.freeze({
      acceptedBaseRevision: REVISION,
      implementationInputRevision: REVISION,
      config: configDescriptor,
      artifactSchema: schemaDescriptor,
      sourceClosure: closureDescriptor,
      inputArtifact: widths.descriptor,
    }),
    sourceClosure: closureDescriptor,
    environment: environment(),
    populations: Object.freeze({
      fullSemanticCells: MAX_SAFE_INTEGER,
      serviceSemanticCells: MAX_SAFE_INTEGER,
      amplifiedSemanticCells: MAX_SAFE_INTEGER,
      operationalCells: MAX_SAFE_INTEGER,
      policyCount: MAX_SAFE_INTEGER,
      semanticRecordCount: MAX_SAFE_INTEGER,
      callRecordCount: MAX_SAFE_INTEGER,
      timelineRecordCount: MAX_SAFE_INTEGER,
      deadlineRecordCount: MAX_SAFE_INTEGER,
    }),
    integrity: Object.freeze({ status: 'passed', failures: Object.freeze([]) }),
    policyResults: Object.freeze(policyResults),
    qualifiers: Object.freeze(qualifiers),
    decision: widestDecision(policyIds),
    limitations: LIMITATIONS,
  });
}

function buildDryManifest(
  config: FrozenServiceFastConfiguration,
  widths: CommittedInputStructuralWidths,
  closureDescriptor: SourceClosureDescriptor,
  admittedArtifacts: readonly AdmittedArtifactSize[],
): Readonly<Record<string, unknown>> {
  const artifactOrder = Object.freeze([
    Object.freeze({ name: 'inputs.ndjson', contentRole: 'input' }),
    Object.freeze({ name: 'semantic-results.ndjson', contentRole: 'semantic' }),
    Object.freeze({ name: 'call-timing-observations.ndjson', contentRole: 'call-timing' }),
    Object.freeze({ name: 'incumbent-timeline-observations.ndjson', contentRole: 'incumbent-timeline' }),
    Object.freeze({ name: 'deadline-observations.ndjson', contentRole: 'deadline' }),
    Object.freeze({ name: 'analysis.json', contentRole: 'analysis' }),
    Object.freeze({ name: 'README.md', contentRole: 'readme' }),
  ]);
  const admissionByName = new Map(admittedArtifacts.map((artifact) => [artifact.name, artifact]));
  const artifactEntries = artifactOrder.map(({ name, contentRole }) => {
    const file = artifactFile(config, name);
    const admission = admissionByName.get(name);
    if (admission === undefined) {
      return admissionFailure('manifest-size-binding-missing', name, 'Manifest size admission omitted a retained content artifact.');
    }
    return Object.freeze({
      name: file.name,
      contentRole,
      schemaVersion: file.schemaVersion,
      recordCount: file.recordCount,
      bytes: admission.maximumBytes,
      sha256: HASH,
    });
  });
  return Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-manifest.v1',
    experimentId: config.experimentId,
    taskId: 'RLT-087',
    config: descriptor('fixtures/m7c/service-fast-numerical/experiment-config.v1.json', 76_816),
    artifactSchema: config.artifactSchema,
    sourceClosure: closureDescriptor,
    inputArtifact: widths.descriptor,
    implementationRevision: REVISION,
    environment: environment(),
    executionSchedule: Object.freeze({
      totalPolicyCalls: MAX_SAFE_INTEGER,
      semanticCalls: MAX_SAFE_INTEGER,
      callWarmups: MAX_SAFE_INTEGER,
      callRetained: MAX_SAFE_INTEGER,
      timelineRetained: MAX_SAFE_INTEGER,
      deadlineWarmups: MAX_SAFE_INTEGER,
      deadlineRetained: MAX_SAFE_INTEGER,
    }),
    artifacts: Object.freeze(artifactEntries),
    decision: widestDecision(config.policyMatrix.policyIds),
    limitations: LIMITATIONS,
  });
}

function artifactFile(
  config: FrozenServiceFastConfiguration,
  name: string,
): FrozenServiceFastConfiguration['artifacts']['files'][number] {
  const file = config.artifacts.files.find((candidate) => candidate.name === name);
  if (file === undefined) throw new TypeError(`Missing frozen artifact file ${name}.`);
  return file;
}

function admitFile(
  file: FrozenServiceFastConfiguration['artifacts']['files'][number],
  maximumBytes: number,
): AdmittedArtifactSize {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > file.maxBytes) {
    return admissionFailure('artifact-size-admission-failure', file.name, `${file.name} cannot be proved within its frozen cap.`);
  }
  return Object.freeze({ name: file.name, maximumBytes, capBytes: file.maxBytes });
}

export function admitPreSourceClosureArtifactSizes(
  inputBytes: Uint8Array,
  config: FrozenServiceFastConfiguration,
): PreSourceClosureSizeAdmission {
  const widths = deriveCommittedInputStructuralWidths(inputBytes, config);
  const sizeAdmission = config.artifacts.sizeAdmission;
  const uniform = requireObject(sizeAdmission['uniformSemanticEnvelope'], 'uniformSemanticEnvelope');
  if (
    uniform['maximumSemanticRecordBytesIncludingLineFeed'] !== 6_961 ||
    uniform['semanticRecordCount'] !== 38_016 ||
    uniform['semanticFileCapBytes'] !== 268_435_456
  ) {
    return admissionFailure('uniform-semantic-envelope-mismatch', 'semantic-results.ndjson', 'The config verifier semantic envelope is not the frozen authoritative envelope.');
  }
  const semanticMaximum = 6_961 * 38_016;
  const policyId = longest(config.policyMatrix.policyIds);
  const callRecord = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-call-timing-observation.v1',
    observationIndex: MAX_SAFE_INTEGER,
    caseId: widths.widestCaseId,
    requestId: widths.widestRequestId,
    timingCohortIndex: MAX_SAFE_INTEGER,
    sweepIndex: MAX_SAFE_INTEGER,
    policyId,
    policyMatrixIndex: MAX_SAFE_INTEGER,
    elapsedNanoseconds: MAX_NANOSECONDS,
    validatedOutcomeHash: HASH,
  });
  const timelineRecord = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-incumbent-timeline-observation.v1',
    observationIndex: MAX_SAFE_INTEGER,
    caseId: widths.widestCaseId,
    requestId: widths.widestRequestId,
    timingCohortIndex: MAX_SAFE_INTEGER,
    sweepIndex: MAX_SAFE_INTEGER,
    policyId,
    policyMatrixIndex: MAX_SAFE_INTEGER,
    firstValidScoreNanoseconds: MAX_NANOSECONDS,
    firstStrictImprovementNanoseconds: MAX_NANOSECONDS,
    finalBestInstallNanoseconds: MAX_NANOSECONDS,
    validatedOutcomeHash: HASH,
  });
  const deadlineRecord = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-deadline-observation.v1',
    observationIndex: MAX_SAFE_INTEGER,
    caseId: widths.widestCaseId,
    requestId: widths.widestRequestId,
    timingCohortIndex: MAX_SAFE_INTEGER,
    deadlineIndex: MAX_SAFE_INTEGER,
    deadlineMilliseconds: MAX_SAFE_INTEGER,
    sweepIndex: MAX_SAFE_INTEGER,
    policyId,
    policyMatrixIndex: MAX_SAFE_INTEGER,
    elapsedNanoseconds: MAX_NANOSECONDS,
    termination: 'work-limit',
    entryPlan: false,
    anyValidScore: false,
    anyImprovement: false,
    anchorQuality: false,
    completeStage: false,
    incumbent: incumbentReference(),
    diagnosticStateHash: HASH,
    counters: MAX_COUNTER_VECTOR,
    validatedOutcomeHash: HASH,
  });

  const inputFile = artifactFile(config, 'inputs.ndjson');
  const semanticFile = artifactFile(config, 'semantic-results.ndjson');
  const callFile = artifactFile(config, 'call-timing-observations.ndjson');
  const timelineFile = artifactFile(config, 'incumbent-timeline-observations.ndjson');
  const deadlineFile = artifactFile(config, 'deadline-observations.ndjson');
  const analysisFile = artifactFile(config, 'analysis.json');
  const manifestFile = artifactFile(config, 'manifest.json');
  const readmeFile = artifactFile(config, 'README.md');
  const preliminary = Object.freeze([
    admitFile(inputFile, inputBytes.byteLength),
    admitFile(semanticFile, semanticMaximum),
    admitFile(callFile, serializedBytes(callRecord) * (callFile.recordCount ?? 0)),
    admitFile(timelineFile, serializedBytes(timelineRecord) * (timelineFile.recordCount ?? 0)),
    admitFile(deadlineFile, serializedBytes(deadlineRecord) * (deadlineFile.recordCount ?? 0)),
  ]);
  const closureDescriptor = descriptor(
    config.artifacts.sourceClosure.path,
    config.artifacts.sourceClosure.maxBytes,
  );
  const dryAnalysis = buildDryAnalysis(config, widths, closureDescriptor);
  const analysisAdmission = admitFile(analysisFile, serializedBytes(dryAnalysis));
  const dryReadme = renderMaximalServiceFastExperimentReadme().readme;
  const readmeAdmission = admitFile(
    readmeFile,
    new TextEncoder().encode(dryReadme).byteLength,
  );
  const preManifestArtifacts = Object.freeze([
    ...preliminary,
    analysisAdmission,
    readmeAdmission,
  ]);
  const dryManifest = buildDryManifest(config, widths, closureDescriptor, preManifestArtifacts);
  const manifestAdmission = admitFile(manifestFile, serializedBytes(dryManifest));
  const artifacts = Object.freeze([
    ...preliminary,
    analysisAdmission,
    manifestAdmission,
    readmeAdmission,
  ]);
  const directoryMaximum = artifacts.reduce((sum, artifact) => sum + artifact.maximumBytes, 0);
  if (!Number.isSafeInteger(directoryMaximum) || directoryMaximum > config.artifacts.maximumDirectoryBytes) {
    return admissionFailure('directory-size-admission-failure', 'retained directory', 'Dry artifact maxima exceed the frozen directory cap.');
  }
  return Object.freeze({
    inputWidths: widths,
    artifacts,
    maximumDirectoryBytes: directoryMaximum,
    directoryCapBytes: config.artifacts.maximumDirectoryBytes,
    dryAnalysis,
    dryManifest,
    dryReadme,
  });
}
