import { SERVICE_FAST_ARTIFACT_VERIFIER_HELPER } from './dispatch-contract.ts';

const PROFILE_ID = 'service-fast-artifact-verifier-runtime-v1';
const PROFILE_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/runtime-profile.ts';
const CANONICAL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\\\0]+\.ts$/u;
const NODE_BUILTIN = /^node:[a-z0-9_/-]+$/u;
const DURABLE_BUILTINS = Object.freeze([
  'node:crypto',
  'node:fs',
  'node:fs/promises',
  'node:os',
  'node:path',
  'node:process',
  'node:util',
]);
const HOST_ADMISSION_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/host-admission.ts';
const CAPABILITIES = Object.freeze([
  'fixed-repository-root',
  'hash',
  'read-only-filesystem',
] as const);

export const SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH = PROFILE_SOURCE;

export type ServiceFastDurableRuntimeCapability = typeof CAPABILITIES[number];

export interface ServiceFastDurableRuntimePathCapability {
  readonly path: string;
  readonly builtins: readonly string[];
  readonly capabilities: readonly ServiceFastDurableRuntimeCapability[];
}

export interface ServiceFastDurableRuntimeProfileData {
  readonly profileId: typeof PROFILE_ID;
  readonly entryRoots: readonly string[];
  readonly projectSources: readonly string[];
  readonly nodeBuiltins: readonly string[];
  readonly pathCapabilities: readonly ServiceFastDurableRuntimePathCapability[];
}

export class ServiceFastDurableRuntimeProfileError extends Error {
  readonly code: string;
  readonly artifact = PROFILE_SOURCE;
  readonly toolFailureFamily = 'runtime-import';

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function profileFailure(code: string, message: string): never {
  throw new ServiceFastDurableRuntimeProfileError(code, message);
}

function requireObject(value: unknown, artifact: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return profileFailure('invalid-durable-runtime-profile', `${artifact} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  artifact: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    profileFailure('invalid-durable-runtime-profile', `${artifact} fields are missing, extra, or reordered.`);
  }
}

function compareRawUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireSortedUniqueStrings(
  value: unknown,
  artifact: string,
  pattern: RegExp,
  nonempty: boolean,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    (nonempty && value.length === 0) ||
    value.some((entry) => typeof entry !== 'string' || !pattern.test(entry))
  ) {
    return profileFailure('invalid-durable-runtime-profile', `${artifact} is not a canonical string array.`);
  }
  const entries = value as string[];
  if (entries.some((entry, index) => index > 0 && compareRawUtf16(entries[index - 1] ?? '', entry) >= 0)) {
    return profileFailure('invalid-durable-runtime-profile', `${artifact} is not strictly raw-UTF16 ordered.`);
  }
  return Object.freeze([...entries]);
}

function requireCapabilities(
  value: unknown,
  artifact: string,
): readonly ServiceFastDurableRuntimeCapability[] {
  const capabilities = requireSortedUniqueStrings(
    value,
    artifact,
    /^[a-z-]+$/u,
    false,
  );
  if (capabilities.some((capability) =>
    !CAPABILITIES.includes(capability as ServiceFastDurableRuntimeCapability))) {
    return profileFailure('invalid-durable-runtime-profile', `${artifact} contains an unknown capability.`);
  }
  return capabilities as readonly ServiceFastDurableRuntimeCapability[];
}

function decodeRecord(record: string): ServiceFastDurableRuntimeProfileData {
  let decoded: unknown;
  try {
    decoded = JSON.parse(record);
  } catch {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime profile record is not JSON.');
  }
  if (JSON.stringify(decoded) !== record) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime profile record is not canonical minified JSON.');
  }
  const profile = requireObject(decoded, 'runtime profile');
  requireExactKeys(
    profile,
    ['profileId', 'entryRoots', 'projectSources', 'nodeBuiltins', 'pathCapabilities'],
    'runtime profile',
  );
  if (profile['profileId'] !== PROFILE_ID) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime profile identity is not frozen.');
  }
  const entryRoots = requireSortedUniqueStrings(
    profile['entryRoots'],
    'runtime profile entryRoots',
    CANONICAL_PATH,
    true,
  );
  if (
    entryRoots.length !== 1 ||
    entryRoots[0] !== SERVICE_FAST_ARTIFACT_VERIFIER_HELPER
  ) {
    return profileFailure(
      'invalid-durable-runtime-profile',
      'Durable runtime entry root is not the fixed artifact verifier entry.',
    );
  }
  const projectSources = requireSortedUniqueStrings(
    profile['projectSources'],
    'runtime profile projectSources',
    CANONICAL_PATH,
    true,
  );
  const projectSet = new Set(projectSources);
  if (entryRoots.some((entryRoot) => !projectSet.has(entryRoot))) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime entry root is absent from projectSources.');
  }
  if (!projectSet.has(HOST_ADMISSION_SOURCE)) {
    return profileFailure(
      'invalid-durable-runtime-profile',
      'Durable runtime projectSources omit the fixed host-admission leaf.',
    );
  }
  const nodeBuiltins = requireSortedUniqueStrings(
    profile['nodeBuiltins'],
    'runtime profile nodeBuiltins',
    NODE_BUILTIN,
    false,
  );
  if (nodeBuiltins.some((builtin) => !DURABLE_BUILTINS.includes(builtin))) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime profile contains a non-verifier builtin.');
  }
  const builtinSet = new Set(nodeBuiltins);
  if (!Array.isArray(profile['pathCapabilities'])) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime pathCapabilities must be an array.');
  }
  const pathCapabilities = profile['pathCapabilities'].map((value, index) => {
    const capability = requireObject(value, `runtime profile pathCapabilities[${index}]`);
    requireExactKeys(
      capability,
      ['path', 'builtins', 'capabilities'],
      `runtime profile pathCapabilities[${index}]`,
    );
    const expectedPath = projectSources[index];
    if (expectedPath === undefined || capability['path'] !== expectedPath) {
      return profileFailure('invalid-durable-runtime-profile', 'Durable path capability order does not equal projectSources.');
    }
    const builtins = requireSortedUniqueStrings(
      capability['builtins'],
      `runtime profile pathCapabilities[${index}].builtins`,
      NODE_BUILTIN,
      false,
    );
    if (builtins.some((builtin) => !builtinSet.has(builtin))) {
      return profileFailure('invalid-durable-runtime-profile', 'Durable path capability contains an undeclared builtin.');
    }
    const capabilities = requireCapabilities(
      capability['capabilities'],
      `runtime profile pathCapabilities[${index}].capabilities`,
    );
    const hasCrypto = builtins.includes('node:crypto');
    const hasFilesystem = builtins.includes('node:fs') || builtins.includes('node:fs/promises');
    const hasHostBuiltin =
      builtins.includes('node:os') || builtins.includes('node:process');
    if (
      hasCrypto !== capabilities.includes('hash') ||
      hasFilesystem !== capabilities.includes('read-only-filesystem') ||
      (builtins.includes('node:fs') && expectedPath !==
        'src/benchmark/service-fast-numerical-experiment/artifact-verifier/io/bounded-file.ts') ||
      (capabilities.includes('fixed-repository-root') &&
        (!builtins.includes('node:path') || hasFilesystem)) ||
      (hasHostBuiltin &&
        (expectedPath !== HOST_ADMISSION_SOURCE ||
          builtins.length !== 2 ||
          !builtins.includes('node:os') ||
          !builtins.includes('node:process') ||
          capabilities.length !== 0))
    ) {
      return profileFailure('invalid-durable-runtime-profile', 'Durable path builtins and capabilities are inconsistent.');
    }
    return Object.freeze({
      path: expectedPath,
      builtins,
      capabilities,
    });
  });
  if (pathCapabilities.length !== projectSources.length) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable path capability set is incomplete.');
  }
  const hostCapability = pathCapabilities.find((capability) =>
    capability.path === HOST_ADMISSION_SOURCE);
  if (
    hostCapability === undefined ||
    hostCapability.builtins.length !== 2 ||
    hostCapability.builtins[0] !== 'node:os' ||
    hostCapability.builtins[1] !== 'node:process' ||
    hostCapability.capabilities.length !== 0
  ) {
    return profileFailure(
      'invalid-durable-runtime-profile',
      'Durable host-admission path lacks its exact builtin-only profile.',
    );
  }
  return Object.freeze({
    profileId: PROFILE_ID,
    entryRoots,
    projectSources,
    nodeBuiltins,
    pathCapabilities: Object.freeze(pathCapabilities),
  });
}

export function decodeServiceFastDurableRuntimeProfileSource(
  bytes: Uint8Array,
): ServiceFastDurableRuntimeProfileData {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime profile source is not UTF-8.');
  }
  const match = /^const SERVICE_FAST_ARTIFACT_VERIFIER_RUNTIME_PROFILE_RECORD =\n {2}'([^'\n]+)';\nvoid SERVICE_FAST_ARTIFACT_VERIFIER_RUNTIME_PROFILE_RECORD;\n$/u.exec(source);
  if (match === null || match[1] === undefined) {
    return profileFailure('invalid-durable-runtime-profile', 'Durable runtime profile source is not the exact data-only leaf.');
  }
  return decodeRecord(match[1]);
}
