export type JsonScalar = string | number | boolean | null;

export type JsonValue = JsonScalar | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ArtifactDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RetainedArtifactDescriptor extends ArtifactDescriptor {
  readonly name: string;
  readonly schemaVersion: string | null;
  readonly recordCount: number | null;
  readonly maxBytes: number;
  readonly contentRole:
    | 'input'
    | 'semantic'
    | 'call-timing'
    | 'incumbent-timeline'
    | 'deadline'
    | 'analysis'
    | 'readme';
}

export interface ExactRationalValue {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface DecodedExperimentInput {
  readonly value: JsonObject;
  readonly sourceIndex: number;
  readonly caseId: string;
  readonly requestId: string;
  readonly timingCohortIndex: number | null;
  readonly serviceDecisionMember: boolean;
  readonly amplifiedStressMember: boolean;
}

export interface EnvironmentValue extends JsonObject {
  readonly nodeVersion: string;
  readonly v8Version: string;
  readonly uvVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly endianness: string;
  readonly osType: string;
  readonly osRelease: string;
  readonly cpuModel: string;
  readonly cpuSpeedMHz: number;
  readonly logicalCpuCount: number;
  readonly availableParallelism: number;
  readonly totalMemoryBytes: string;
  readonly timezone: string;
  readonly execArgv: readonly JsonValue[];
  readonly nodeOptionsState: 'unset' | 'empty';
  readonly mainThread: boolean;
}

export interface VerificationAggregates {
  readonly manifestSha256: string;
  readonly semanticAggregate: string;
  readonly operationalAggregate: string;
  readonly analysisAggregate: string;
  readonly decisionStatus:
    | 'selected-policy'
    | 'strict-reference-fallback'
    | 'rejected-observation';
  readonly decisionIdentity: string;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) throw new TypeError('Expected a JSON object.');
  return value;
}

export function requireJsonArray(value: unknown): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError('Expected a JSON array.');
  return value as readonly JsonValue[];
}

export function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string.');
  return value;
}

export function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected a boolean.');
  return value;
}

export function requireSafeNonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('Expected a safe nonnegative integer.');
  }
  return value as number;
}

export function requireSafePositiveInteger(value: unknown): number {
  const result = requireSafeNonnegativeInteger(value);
  if (result === 0) throw new TypeError('Expected a safe positive integer.');
  return result;
}

export function requireNullableString(value: unknown): string | null {
  return value === null ? null : requireString(value);
}

export function exactKeys(
  value: JsonObject,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
