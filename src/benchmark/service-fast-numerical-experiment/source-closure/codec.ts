import { createHash } from 'node:crypto';

import {
  requireSourceClosurePath,
  requireSourceClosureRevision,
} from './git-contract.ts';

export const SERVICE_FAST_EXPERIMENT_ID = 'm7c-core12-service-fast-numerical-v1';
export const SERVICE_FAST_CONFIG_PATH =
  'fixtures/m7c/service-fast-numerical/experiment-config.v1.json';
export const SERVICE_FAST_CONFIG_BYTES = 76_816;
export const SERVICE_FAST_CONFIG_SHA256 =
  'sha256:28e20d4d7feedabb8d0c4331345f76891c47dcc39a1147728c3901e757413fac';
export const SERVICE_FAST_SOURCE_CLOSURE_SCHEMA =
  'routelab.service-fast-numerical-source-closure.v1';
export const SERVICE_FAST_MAX_BOUND_SOURCE_BYTES = 64 * 1024 * 1024;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROTECTED_RUNTIME_SOURCE_KEYS = Object.freeze([
  'coarseReference',
  'fineServiceReference',
  'sharedSession',
  'serviceRouter',
  'preparedServiceContext',
  'serviceDiscovery',
  'preparedRoutingContext',
  'boundedSnapshotJson',
  'splitObjective',
  'splitReplay',
  'routeReplay',
  'replayKernel',
  'constantProduct',
]);

export interface SourceClosureDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SourceClosureEntry extends SourceClosureDescriptor {
  readonly roles: readonly string[];
}

export interface ServiceFastSourceClosure {
  readonly schemaVersion: typeof SERVICE_FAST_SOURCE_CLOSURE_SCHEMA;
  readonly experimentId: typeof SERVICE_FAST_EXPERIMENT_ID;
  readonly implementationInputRevision: string;
  readonly observationPerformed: false;
  readonly config: SourceClosureDescriptor;
  readonly artifactSchema: SourceClosureDescriptor;
  readonly inputArtifact: SourceClosureDescriptor;
  readonly sources: readonly SourceClosureEntry[];
  readonly protectedSources: readonly SourceClosureDescriptor[];
}

interface ConfigDescriptor {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface FrozenSourceClosureSection {
  readonly schemaVersion: string;
  readonly path: string;
  readonly recordFieldOrder: readonly string[];
  readonly sourceEntryFieldOrder: readonly string[];
  readonly descriptorFieldOrder: readonly string[];
  readonly sourceRoleAssignments: {
    readonly implementationRoots: Readonly<Record<string, readonly string[]>>;
    readonly requiredFiles: Readonly<Record<string, readonly string[]>>;
  };
  readonly maxBytes: number;
  readonly maxSourceEntries: number;
  readonly maxProtectedSourceEntries: number;
  readonly implementationRoots: readonly string[];
  readonly requiredFiles: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly protectedPaths: readonly string[];
}

interface FrozenFileSection {
  readonly name: string;
  readonly schemaVersion: string | null;
  readonly recordCount: number | null;
  readonly maxBytes: number;
  readonly recordFieldOrder?: readonly string[];
}

export interface FrozenServiceFastConfiguration {
  readonly experimentId: string;
  readonly authorityBindings: Readonly<Record<string, ConfigDescriptor>>;
  readonly boundInputs: Readonly<Record<string, ConfigDescriptor>>;
  readonly protectedRuntimeSources: Readonly<Record<string, ConfigDescriptor>>;
  readonly cohorts: {
    readonly caseOrder: readonly string[];
    readonly cases: readonly {
      readonly caseId: string;
      readonly snapshotId: string;
      readonly snapshotChecksum: string;
      readonly requestCount: number;
      readonly serviceDecision: boolean;
      readonly operational: boolean;
      readonly hotspot: boolean;
      readonly classification: string;
    }[];
    readonly full: { readonly count: number; readonly sha256: string };
    readonly serviceDecision: { readonly count: number; readonly sha256: string };
    readonly amplifiedStress: { readonly count: number; readonly sha256: string };
    readonly priorEligibleBoundOnly: { readonly count: number; readonly sha256: string };
    readonly priorEligibleServiceBoundOnly: { readonly count: number; readonly sha256: string };
    readonly operational: {
      readonly selection: string;
      readonly count: number;
      readonly perCaseCounts: Readonly<Record<string, number>>;
      readonly nonemptyStrataPerCase: Readonly<Record<string, number>>;
      readonly sha256: string;
    };
  };
  readonly artifactSchema: ConfigDescriptor;
  readonly inputConstruction: {
    readonly request: {
      readonly maxHops: number;
      readonly maxRoutes: number;
      readonly greedyParts: number;
    };
    readonly workProfile: {
      readonly profileId: string;
      readonly workCaps: Readonly<Record<string, number>>;
    };
    readonly candidateSets: {
      readonly retainFirst: number;
    };
    readonly inputArtifact: {
      readonly schemaVersion: string;
      readonly path: string;
      readonly recordCount: number;
      readonly maxBytes: number;
      readonly recordFieldOrder: readonly string[];
    };
  };
  readonly artifacts: {
    readonly sourceClosure: FrozenSourceClosureSection;
    readonly files: readonly FrozenFileSection[];
    readonly maximumDirectoryBytes: number;
    readonly sizeAdmission: Readonly<Record<string, unknown>>;
  };
  readonly policyMatrix: {
    readonly policyIds: readonly string[];
    readonly driverOrder: readonly string[];
  };
  readonly operationalProtocol: Readonly<Record<string, unknown>>;
  readonly semanticEvidence: Readonly<Record<string, unknown>>;
  readonly runtime: Readonly<Record<string, unknown>>;
  readonly selection: Readonly<Record<string, unknown>>;
}

export class SourceClosureCodecError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'repository';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function codecFailure(code: string, artifact: string, message: string): never {
  throw new SourceClosureCodecError(code, artifact, message);
}

function requireCodecPath(value: string, artifact: string): string {
  try {
    return requireSourceClosurePath(value);
  } catch {
    return codecFailure('invalid-path', artifact, `${artifact} path is not canonical.`);
  }
}

function requireCodecRevision(value: string, artifact: string): string {
  try {
    return requireSourceClosureRevision(value);
  } catch {
    return codecFailure('invalid-revision', artifact, `${artifact} revision is not canonical.`);
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function requireObject(value: unknown, artifact: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return codecFailure('invalid-object', artifact, `${artifact} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  artifact: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    codecFailure(
      'invalid-field-order',
      artifact,
      `${artifact} must contain exactly the frozen fields in frozen order.`,
    );
  }
}

function requireSafeBytes(value: unknown, artifact: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return codecFailure('invalid-byte-count', artifact, `${artifact} bytes must be a nonnegative safe integer.`);
  }
  return value as number;
}

function requireSha256(value: unknown, artifact: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    return codecFailure('invalid-sha256', artifact, `${artifact} must contain a canonical SHA-256 value.`);
  }
  return value;
}

function requireDescriptor(
  value: unknown,
  keys: readonly string[],
  artifact: string,
): SourceClosureDescriptor {
  const object = requireObject(value, artifact);
  requireKeys(object, keys, artifact);
  if (typeof object['path'] !== 'string') {
    return codecFailure('invalid-path', artifact, `${artifact} path must be a string.`);
  }
  return Object.freeze({
    path: requireCodecPath(object['path'], artifact),
    bytes: requireSafeBytes(object['bytes'], artifact),
    sha256: requireSha256(object['sha256'], artifact),
  });
}

function freezeRecursively<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeRecursively(Reflect.get(value, key), seen);
  }
  return Object.freeze(value);
}

export function parseFrozenServiceFastConfiguration(
  bytes: Uint8Array,
): FrozenServiceFastConfiguration {
  if (bytes.byteLength !== SERVICE_FAST_CONFIG_BYTES || sha256Bytes(bytes) !== SERVICE_FAST_CONFIG_SHA256) {
    return codecFailure(
      'config-hash-mismatch',
      SERVICE_FAST_CONFIG_PATH,
      'The service-fast experiment config does not match its frozen identity.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return codecFailure('invalid-config-json', SERVICE_FAST_CONFIG_PATH, 'The frozen config is not valid UTF-8 JSON.');
  }
  const object = requireObject(parsed, SERVICE_FAST_CONFIG_PATH);
  if (object['experimentId'] !== SERVICE_FAST_EXPERIMENT_ID) {
    return codecFailure('config-identity-mismatch', SERVICE_FAST_CONFIG_PATH, 'The config experiment ID is invalid.');
  }
  const protectedRuntimeSources = requireObject(
    object['protectedRuntimeSources'],
    'protectedRuntimeSources',
  );
  requireKeys(
    protectedRuntimeSources,
    PROTECTED_RUNTIME_SOURCE_KEYS,
    'protectedRuntimeSources',
  );
  const protectedDescriptors = PROTECTED_RUNTIME_SOURCE_KEYS.map((key) =>
    requireDescriptor(
      protectedRuntimeSources[key],
      Object.freeze(['path', 'bytes', 'sha256']),
      `protectedRuntimeSources.${key}`,
    ));
  const artifacts = requireObject(object['artifacts'], 'artifacts');
  const sourceClosure = requireObject(artifacts['sourceClosure'], 'artifacts.sourceClosure');
  const protectedPaths = sourceClosure['protectedPaths'];
  if (
    !Array.isArray(protectedPaths) ||
    protectedPaths.length !== protectedDescriptors.length ||
    protectedDescriptors.some((descriptor, index) => descriptor.path !== protectedPaths[index])
  ) {
    return codecFailure(
      'protected-config-order-mismatch',
      SERVICE_FAST_CONFIG_PATH,
      'Frozen protected runtime descriptors must exactly match the source-closure protected path order.',
    );
  }
  return freezeRecursively(parsed as FrozenServiceFastConfiguration);
}

export function descriptorForBytes(
  relativePath: string,
  bytes: Uint8Array,
): SourceClosureDescriptor {
  return Object.freeze({
    path: requireSourceClosurePath(relativePath),
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
}

export function descriptorsEqual(
  left: SourceClosureDescriptor,
  right: SourceClosureDescriptor,
): boolean {
  return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256;
}

function requireSourceEntry(
  value: unknown,
  config: FrozenServiceFastConfiguration,
  index: number,
): SourceClosureEntry {
  const artifact = `sources[${index}]`;
  const section = config.artifacts.sourceClosure;
  const object = requireObject(value, artifact);
  requireKeys(object, section.sourceEntryFieldOrder, artifact);
  if (!Array.isArray(object['roles']) || object['roles'].length === 0) {
    return codecFailure('invalid-source-roles', artifact, `${artifact} roles must be a nonempty array.`);
  }
  const roles = object['roles'].map((role) => {
    if (typeof role !== 'string' || !section.requiredRoles.includes(role)) {
      return codecFailure('invalid-source-role', artifact, `${artifact} contains an unknown role.`);
    }
    return role;
  });
  if (
    new Set(roles).size !== roles.length ||
    roles.some((role, roleIndex) =>
      roleIndex > 0 &&
      section.requiredRoles.indexOf(roles[roleIndex - 1] ?? '') >=
        section.requiredRoles.indexOf(role)
    )
  ) {
    return codecFailure('invalid-source-role-order', artifact, `${artifact} roles are not in frozen order.`);
  }
  const descriptor = requireDescriptor(
    {
      path: object['path'],
      bytes: object['bytes'],
      sha256: object['sha256'],
    },
    section.descriptorFieldOrder,
    artifact,
  );
  if (descriptor.bytes > SERVICE_FAST_MAX_BOUND_SOURCE_BYTES) {
    return codecFailure('source-byte-cap-exceeded', descriptor.path, `${descriptor.path} exceeds the frozen per-source byte cap.`);
  }
  return Object.freeze({ roles: Object.freeze(roles), ...descriptor });
}

export function validateServiceFastSourceClosure(
  value: unknown,
  config: FrozenServiceFastConfiguration,
): ServiceFastSourceClosure {
  const section = config.artifacts.sourceClosure;
  const object = requireObject(value, 'source closure');
  requireKeys(object, section.recordFieldOrder, 'source closure');
  if (
    object['schemaVersion'] !== SERVICE_FAST_SOURCE_CLOSURE_SCHEMA ||
    object['experimentId'] !== SERVICE_FAST_EXPERIMENT_ID ||
    object['observationPerformed'] !== false ||
    typeof object['implementationInputRevision'] !== 'string'
  ) {
    return codecFailure('source-closure-identity-mismatch', section.path, 'The source closure identity fields are invalid.');
  }
  const implementationInputRevision = requireCodecRevision(
    object['implementationInputRevision'],
    section.path,
  );
  const configDescriptor = requireDescriptor(
    object['config'],
    section.descriptorFieldOrder,
    'source closure config',
  );
  const expectedConfig = Object.freeze({
    path: SERVICE_FAST_CONFIG_PATH,
    bytes: SERVICE_FAST_CONFIG_BYTES,
    sha256: SERVICE_FAST_CONFIG_SHA256,
  });
  if (!descriptorsEqual(configDescriptor, expectedConfig)) {
    return codecFailure('config-descriptor-mismatch', section.path, 'The source closure config descriptor is invalid.');
  }
  const artifactSchema = requireDescriptor(
    object['artifactSchema'],
    section.descriptorFieldOrder,
    'source closure artifact schema',
  );
  if (!descriptorsEqual(artifactSchema, config.artifactSchema)) {
    return codecFailure('schema-descriptor-mismatch', section.path, 'The source closure schema descriptor is invalid.');
  }
  const inputArtifact = requireDescriptor(
    object['inputArtifact'],
    section.descriptorFieldOrder,
    'source closure input artifact',
  );
  if (
    inputArtifact.path !== config.inputConstruction.inputArtifact.path ||
    inputArtifact.bytes === 0 ||
    inputArtifact.bytes > config.inputConstruction.inputArtifact.maxBytes
  ) {
    return codecFailure('input-descriptor-mismatch', section.path, 'The source closure input descriptor is invalid.');
  }
  if (!Array.isArray(object['sources']) || object['sources'].length > section.maxSourceEntries) {
    return codecFailure('source-entry-cap-exceeded', section.path, 'The source closure source array is invalid.');
  }
  if (
    !Array.isArray(object['protectedSources']) ||
    object['protectedSources'].length !== section.maxProtectedSourceEntries
  ) {
    return codecFailure('protected-entry-count-mismatch', section.path, 'The protected source count is invalid.');
  }
  const sources = Object.freeze(object['sources'].map((entry, index) =>
    requireSourceEntry(entry, config, index)));
  const protectedSources = Object.freeze(object['protectedSources'].map((entry, index) => {
    const descriptor = requireDescriptor(
      entry,
      section.descriptorFieldOrder,
      `protectedSources[${index}]`,
    );
    if (descriptor.bytes > SERVICE_FAST_MAX_BOUND_SOURCE_BYTES) {
      return codecFailure('source-byte-cap-exceeded', descriptor.path, `${descriptor.path} exceeds the frozen per-source byte cap.`);
    }
    return descriptor;
  }));
  const expectedProtectedSources = Object.values(config.protectedRuntimeSources);
  if (
    protectedSources.length !== expectedProtectedSources.length ||
    protectedSources.some((descriptor, index) =>
      !descriptorsEqual(descriptor, expectedProtectedSources[index] as ConfigDescriptor))
  ) {
    return codecFailure(
      'protected-descriptor-mismatch',
      section.path,
      'Protected source descriptors do not exactly match the frozen runtime descriptors.',
    );
  }
  const allPaths = [...sources.map((entry) => entry.path), ...protectedSources.map((entry) => entry.path)];
  if (new Set(allPaths).size !== allPaths.length) {
    return codecFailure('duplicate-source-path', section.path, 'The source closure contains a duplicate source path.');
  }
  return freezeRecursively({
    schemaVersion: SERVICE_FAST_SOURCE_CLOSURE_SCHEMA,
    experimentId: SERVICE_FAST_EXPERIMENT_ID,
    implementationInputRevision,
    observationPerformed: false as const,
    config: configDescriptor,
    artifactSchema,
    inputArtifact,
    sources,
    protectedSources,
  });
}

export function encodeServiceFastSourceClosure(
  value: ServiceFastSourceClosure,
  config: FrozenServiceFastConfiguration,
): Uint8Array {
  const validated = validateServiceFastSourceClosure(value, config);
  const bytes = new TextEncoder().encode(`${JSON.stringify(validated, null, 2)}\n`);
  if (bytes.byteLength > config.artifacts.sourceClosure.maxBytes) {
    return codecFailure('source-closure-cap-exceeded', config.artifacts.sourceClosure.path, 'The source closure exceeds its byte cap.');
  }
  return bytes;
}

export function decodeServiceFastSourceClosure(
  bytes: Uint8Array,
  config: FrozenServiceFastConfiguration,
): ServiceFastSourceClosure {
  if (bytes.byteLength === 0 || bytes.byteLength > config.artifacts.sourceClosure.maxBytes) {
    return codecFailure('source-closure-cap-exceeded', config.artifacts.sourceClosure.path, 'The source closure bytes violate the frozen cap.');
  }
  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    return codecFailure('invalid-source-closure-json', config.artifacts.sourceClosure.path, 'The source closure is not valid UTF-8 JSON.');
  }
  const validated = validateServiceFastSourceClosure(parsed, config);
  const canonical = `${JSON.stringify(validated, null, 2)}\n`;
  if (text !== canonical) {
    return codecFailure('noncanonical-source-closure', config.artifacts.sourceClosure.path, 'The source closure bytes are not canonical.');
  }
  return validated;
}
