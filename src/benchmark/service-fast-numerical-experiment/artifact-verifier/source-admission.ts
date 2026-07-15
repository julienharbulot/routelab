import {
  SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
  decodeReviewedInputBindingSource,
  requireReviewedInputBinding,
} from '../source-closure/reviewed-input-binding.ts';
import {
  SERVICE_FAST_ARTIFACT_SCHEMA_BYTES,
  SERVICE_FAST_ARTIFACT_SCHEMA_PATH,
  SERVICE_FAST_ARTIFACT_SCHEMA_SHA256,
  SERVICE_FAST_CONFIG_BYTES,
  SERVICE_FAST_CONFIG_PATH,
  SERVICE_FAST_CONFIG_SHA256,
  SERVICE_FAST_EXPERIMENT_ID,
  SERVICE_FAST_INPUT_PATH,
  SERVICE_FAST_SOURCE_CLOSURE_PATH,
  artifactSchemaDescriptor,
  configDescriptor,
} from './contract.ts';
import { integrityFailure } from './failure.ts';
import { sha256Bytes } from './hash-projections.ts';
import {
  readBoundedRegularFile,
  scanBoundedRegularFile,
} from './io/bounded-file.ts';
import { parseCanonicalFixtureJson } from './json/strict-json.ts';
import {
  exactKeys,
  requireBoolean,
  requireJsonArray,
  requireJsonObject,
  requireSafeNonnegativeInteger,
  requireString,
  type ArtifactDescriptor,
  type JsonObject,
  type JsonValue,
} from './types.ts';

const MAX_SOURCE_CLOSURE_BYTES = 1024 * 1024;
const MAX_BOUND_SOURCE_BYTES = 64 * 1024 * 1024;
const REVISION = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface AdmittedSourceClosure {
  readonly value: JsonObject;
  readonly bytes: Uint8Array;
  readonly descriptor: ArtifactDescriptor;
  readonly implementationInputRevision: string;
  readonly inputArtifact: ArtifactDescriptor;
}

export interface ServiceFastSourceAdmission {
  readonly config: JsonObject;
  readonly configBytes: Uint8Array;
  readonly artifactSchema: JsonObject;
  readonly artifactSchemaBytes: Uint8Array;
  readonly closure: AdmittedSourceClosure;
  readonly publicInputDescriptor: ArtifactDescriptor;
}

interface SourceEntryDescriptor extends ArtifactDescriptor {
  readonly roles: readonly string[];
}

function member(object: JsonObject, key: string): JsonValue {
  const value = object[key];
  if (value === undefined) throw new TypeError('Required config member is absent.');
  return value;
}

function descriptor(value: JsonValue): ArtifactDescriptor {
  const object = requireJsonObject(value);
  if (!exactKeys(object, ['path', 'bytes', 'sha256'])) {
    throw new TypeError('Source descriptor fields are invalid.');
  }
  const path = requireString(object['path']);
  const bytes = requireSafeNonnegativeInteger(object['bytes']);
  const sha256 = requireString(object['sha256']);
  if (
    path.length === 0 || path.includes('\\') || path.includes('\0') ||
    path.startsWith('/') || path.split('/').some((segment) =>
      segment.length === 0 || segment === '.' || segment === '..') ||
    bytes <= 0 || bytes > MAX_BOUND_SOURCE_BYTES ||
    !SHA256.test(sha256)
  ) {
    throw new TypeError('Source descriptor is invalid.');
  }
  return Object.freeze({ path, bytes, sha256 });
}

function sourceEntry(value: JsonValue): SourceEntryDescriptor {
  const object = requireJsonObject(value);
  if (!exactKeys(object, ['roles', 'path', 'bytes', 'sha256'])) {
    throw new TypeError('Source entry fields are invalid.');
  }
  const roles = requireJsonArray(object['roles']);
  if (
    roles.length === 0 ||
    roles.some((role) => typeof role !== 'string' || role.length === 0) ||
    new Set(roles).size !== roles.length
  ) {
    throw new TypeError('Source entry roles are invalid.');
  }
  const valueDescriptor = descriptor(Object.freeze({
    path: object['path'] as JsonValue,
    bytes: object['bytes'] as JsonValue,
    sha256: object['sha256'] as JsonValue,
  }));
  return Object.freeze({
    roles: Object.freeze(roles.map(requireString)),
    ...valueDescriptor,
  });
}

function sameDescriptor(
  left: ArtifactDescriptor,
  right: ArtifactDescriptor,
): boolean {
  return left.path === right.path && left.bytes === right.bytes &&
    left.sha256 === right.sha256;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sourceClosureContract(config: JsonObject): JsonObject {
  const artifacts = requireJsonObject(member(config, 'artifacts'));
  return requireJsonObject(member(artifacts, 'sourceClosure'));
}

export function admitConfiguredSourceArray(
  config: JsonObject,
  closure: JsonObject,
): void {
  const contract = sourceClosureContract(config);
  const maximumEntries = requireSafeNonnegativeInteger(
    member(contract, 'maxSourceEntries'),
  );
  if (maximumEntries === 0 || maximumEntries > 128) {
    throw new TypeError('Configured source-entry cap is invalid.');
  }
  const requiredRoles = requireJsonArray(member(contract, 'requiredRoles'))
    .map(requireString);
  if (requiredRoles.length === 0 || new Set(requiredRoles).size !== requiredRoles.length) {
    throw new TypeError('Configured source-role order is invalid.');
  }
  const assignments = requireJsonObject(member(contract, 'sourceRoleAssignments'));
  const rootAssignments = requireJsonObject(member(assignments, 'implementationRoots'));
  const fileAssignments = requireJsonObject(member(assignments, 'requiredFiles'));
  const implementationRoots = requireJsonArray(member(contract, 'implementationRoots'))
    .map(requireString);
  const requiredFiles = requireJsonArray(member(contract, 'requiredFiles'))
    .map(requireString);
  const actual = requireJsonArray(member(closure, 'sources')).map(sourceEntry);
  if (actual.length === 0 || actual.length > maximumEntries) {
    throw new TypeError('Source array differs from its configured cap.');
  }
  const actualPaths = actual.map((entry) => entry.path);
  if (new Set(actualPaths).size !== actualPaths.length) {
    throw new TypeError('Source array contains a duplicate path.');
  }
  const expectedPaths: string[] = [];
  const rolesByPath = new Map<string, Set<string>>();
  const accept = (
    path: string,
    roles: readonly string[],
    includeInOrder: boolean,
  ): void => {
    const owned = rolesByPath.get(path) ?? new Set<string>();
    for (const role of roles) {
      if (!requiredRoles.includes(role)) {
        throw new TypeError('Configured source role is not frozen.');
      }
      owned.add(role);
    }
    if (includeInOrder && !expectedPaths.includes(path)) expectedPaths.push(path);
    rolesByPath.set(path, owned);
  };
  for (const root of implementationRoots) {
    const roles = requireJsonArray(member(rootAssignments, root)).map(requireString);
    const paths = actualPaths
      .filter((path) => path.startsWith(`${root}/`))
      .sort();
    for (const path of paths) accept(path, roles, true);
  }
  for (const path of requiredFiles) {
    const roles = requireJsonArray(member(fileAssignments, path)).map(requireString);
    accept(path, roles, true);
  }
  if (
    expectedPaths.length !== actual.length ||
    actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new TypeError('Source array differs from configured enumeration.');
  }
  actual.forEach((entry, index) => {
    const expectedPath = expectedPaths[index];
    if (expectedPath === undefined) {
      throw new TypeError('Configured source path is absent.');
    }
    const owned = rolesByPath.get(expectedPath);
    if (owned === undefined) throw new TypeError('Configured source roles are absent.');
    const expectedRoles = requiredRoles.filter((role) => owned.has(role));
    if (entry.path !== expectedPath || !sameStrings(entry.roles, expectedRoles)) {
      throw new TypeError('Source path or role order differs from config.');
    }
  });
}

export function admitConfiguredProtectedSources(
  config: JsonObject,
  closure: JsonObject,
): void {
  const contract = sourceClosureContract(config);
  const maximumEntries = requireSafeNonnegativeInteger(
    member(contract, 'maxProtectedSourceEntries'),
  );
  const protectedPaths = requireJsonArray(member(contract, 'protectedPaths'))
    .map(requireString);
  const configured = Object.values(requireJsonObject(
    member(config, 'protectedRuntimeSources'),
  )).map(descriptor);
  const actual = requireJsonArray(member(closure, 'protectedSources'))
    .map(descriptor);
  if (
    maximumEntries !== 13 || configured.length !== maximumEntries ||
    protectedPaths.length !== maximumEntries || actual.length !== maximumEntries ||
    configured.some((expected, index) => expected.path !== protectedPaths[index]) ||
    actual.some((entry, index) => {
      const expected = configured[index];
      return expected === undefined || !sameDescriptor(entry, expected);
    })
  ) {
    throw new TypeError('Protected source descriptors differ from config.');
  }
}

export function decodeServiceFastSourceClosureBytes(
  bytes: Uint8Array,
): AdmittedSourceClosure {
  const value = requireJsonObject(parseCanonicalFixtureJson(bytes));
  if (!exactKeys(value, [
    'schemaVersion',
    'experimentId',
    'implementationInputRevision',
    'observationPerformed',
    'config',
    'artifactSchema',
    'inputArtifact',
    'sources',
    'protectedSources',
  ])) {
    throw new TypeError('Source closure fields are invalid.');
  }
  const implementationInputRevision = requireString(
    value['implementationInputRevision'],
  );
  const configValue = value['config'];
  const artifactSchemaValue = value['artifactSchema'];
  const inputArtifactValue = value['inputArtifact'];
  const sourcesValue = value['sources'];
  const protectedSourcesValue = value['protectedSources'];
  if (
    configValue === undefined || artifactSchemaValue === undefined ||
    inputArtifactValue === undefined || sourcesValue === undefined ||
    protectedSourcesValue === undefined
  ) {
    throw new TypeError('Source closure values are missing.');
  }
  if (
    value['schemaVersion'] !==
      'routelab.service-fast-numerical-source-closure.v1' ||
    value['experimentId'] !== SERVICE_FAST_EXPERIMENT_ID ||
    requireBoolean(value['observationPerformed']) !== false ||
    !REVISION.test(implementationInputRevision) ||
    !sameDescriptor(descriptor(configValue), configDescriptor()) ||
    !sameDescriptor(descriptor(artifactSchemaValue), artifactSchemaDescriptor())
  ) {
    throw new TypeError('Source closure identity is invalid.');
  }
  const inputArtifact = descriptor(inputArtifactValue);
  if (inputArtifact.path !== SERVICE_FAST_INPUT_PATH) {
    throw new TypeError('Source closure input descriptor is invalid.');
  }
  const sources = requireJsonArray(sourcesValue);
  const protectedSources = requireJsonArray(protectedSourcesValue);
  if (sources.length === 0 || sources.length > 128 || protectedSources.length !== 13) {
    throw new TypeError('Source closure source count is invalid.');
  }
  const sourceDescriptors = sources.map(sourceEntry);
  const protectedDescriptors = protectedSources.map(descriptor);
  const allPaths = [...sourceDescriptors, ...protectedDescriptors].map((entry) => entry.path);
  if (new Set(allPaths).size !== allPaths.length) {
    throw new TypeError('Source closure contains duplicate paths.');
  }
  return Object.freeze({
    value,
    bytes,
    descriptor: Object.freeze({
      path: SERVICE_FAST_SOURCE_CLOSURE_PATH,
      bytes: bytes.byteLength,
      sha256: '',
    }),
    implementationInputRevision,
    inputArtifact,
  });
}

/**
 * Child-side immutable-data admission only. The reviewed no-argument dispatcher
 * authenticates the historical Git/closure relation and exact parent/child
 * runtime profiles immediately before fixed dispatch. This leaf deliberately
 * cannot import Git or subprocess capabilities and does not claim to recreate
 * that parent trust-root proof; invoking the child entry directly is
 * nonconforming.
 */
export async function admitServiceFastSources(
  repositoryRoot: string,
): Promise<ServiceFastSourceAdmission> {
  let configBytes: Uint8Array;
  let config: JsonObject;
  try {
    configBytes = await readBoundedRegularFile(
      repositoryRoot,
      SERVICE_FAST_CONFIG_PATH,
      SERVICE_FAST_CONFIG_BYTES,
      Object.freeze({
        path: SERVICE_FAST_CONFIG_PATH,
        bytes: SERVICE_FAST_CONFIG_BYTES,
        sha256: SERVICE_FAST_CONFIG_SHA256,
      }),
    );
    config = requireJsonObject(parseCanonicalFixtureJson(configBytes));
  } catch {
    return integrityFailure('config-hash-mismatch');
  }

  let artifactSchemaBytes: Uint8Array;
  let artifactSchema: JsonObject;
  try {
    artifactSchemaBytes = await readBoundedRegularFile(
      repositoryRoot,
      SERVICE_FAST_ARTIFACT_SCHEMA_PATH,
      SERVICE_FAST_ARTIFACT_SCHEMA_BYTES,
      Object.freeze({
        path: SERVICE_FAST_ARTIFACT_SCHEMA_PATH,
        bytes: SERVICE_FAST_ARTIFACT_SCHEMA_BYTES,
        sha256: SERVICE_FAST_ARTIFACT_SCHEMA_SHA256,
      }),
    );
    artifactSchema = requireJsonObject(parseCanonicalFixtureJson(artifactSchemaBytes));
  } catch {
    return integrityFailure('artifact-shape-failure');
  }

  let closure: AdmittedSourceClosure;
  try {
    const bytes = await readBoundedRegularFile(
      repositoryRoot,
      SERVICE_FAST_SOURCE_CLOSURE_PATH,
      MAX_SOURCE_CLOSURE_BYTES,
    );
    const decoded = decodeServiceFastSourceClosureBytes(bytes);
    closure = Object.freeze({
      ...decoded,
      descriptor: Object.freeze({
        path: SERVICE_FAST_SOURCE_CLOSURE_PATH,
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }),
    });
  } catch {
    return integrityFailure('source-closure-mismatch');
  }

  let publicInputDescriptor: ArtifactDescriptor;
  try {
    admitConfiguredSourceArray(config, closure.value);
  } catch {
    return integrityFailure('source-closure-mismatch');
  }
  try {
    admitConfiguredProtectedSources(config, closure.value);
  } catch {
    return integrityFailure('protected-source-mismatch');
  }
  try {
    publicInputDescriptor = await scanBoundedRegularFile(
      repositoryRoot,
      closure.inputArtifact.path,
      64 * 1024 * 1024,
      undefined,
      closure.inputArtifact,
    );
    const bindingBytes = await readBoundedRegularFile(
      repositoryRoot,
      SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
      MAX_BOUND_SOURCE_BYTES,
    );
    requireReviewedInputBinding(
      decodeReviewedInputBindingSource(bindingBytes),
      publicInputDescriptor,
    );
  } catch {
    return integrityFailure('input-hash-mismatch');
  }
  return Object.freeze({
    config,
    configBytes,
    artifactSchema,
    artifactSchemaBytes,
    closure,
    publicInputDescriptor,
  });
}
