import type { SourceClosureDescriptor } from '../source-closure/codec.ts';
import type {
  RuntimeImportAuditProfile,
  RuntimePathCapability,
  RuntimeProjectDescriptor,
} from '../tooling/runtime-import-audit.ts';

/** Exact accepted-run graph. Kept literal so source-closure review can attest it. @internal */
export const ACCEPTED_RUN_RUNTIME_PATHS = Object.freeze([
  'cli/run-service-fast-numerical-experiment.ts',
  'src/allocation/bounded-exact-split-repair/index.ts',
  'src/allocation/path-shadow-price/index.ts',
  'src/allocation/service-fast-path-shadow-price/index.ts',
  'src/allocation/service-path-shadow-price/index.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/analysis.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/clock.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/contract.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/environment.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/failure.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/input.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/preflight.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/projection.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/publication.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/run.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/runtime-profile.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/schedule.ts',
  'src/benchmark/service-fast-numerical-experiment/accepted-run/serialization.ts',
  'src/benchmark/service-fast-numerical-experiment/evaluator-kernel.ts',
  'src/benchmark/service-fast-numerical-experiment/exact-replay.ts',
  'src/benchmark/service-fast-numerical-experiment/input/build.ts',
  'src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts',
  'src/benchmark/service-fast-numerical-experiment/input/codec.ts',
  'src/benchmark/service-fast-numerical-experiment/input/frozen-bindings.ts',
  'src/benchmark/service-fast-numerical-experiment/policy.ts',
  'src/benchmark/service-fast-numerical-experiment/proposal-adapters.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/codec.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/error.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/git-contract.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/git.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/reviewed-input-binding.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/revision-admission.ts',
  'src/benchmark/service-fast-numerical-experiment/source-closure/verification.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/dispatch-contract.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/readme-template.ts',
  'src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts',
  'src/domain/index.ts',
  'src/domain/liquidity-snapshot.ts',
  'src/pools/constant-product/index.ts',
  'src/replay/exact-input-kernel/index.ts',
  'src/replay/exact-input-split/index.ts',
  'src/router/anytime-exact-input-split/index.ts',
  'src/router/exact-input-split-session/index.ts',
  'src/router/numerical-exact-input-split/index.ts',
  'src/router/split-exact-input/objective.ts',
  'src/runtime/prepared-routing-context/index.ts',
  'src/runtime/prepared-service-routing-context/bounded-snapshot-json.ts',
  'src/runtime/prepared-service-routing-context/index.ts',
  'src/search/pool-disjoint-route-sets/index.ts',
  'src/search/service-route-discovery/index.ts',
  'src/search/shared-route-discovery/index.ts',
  'src/search/simple-paths/index.ts',
  'src/search/simple-paths/traversal.ts',
  'src/serialization/canonical-snapshot/index.ts',
] as const);

function descriptorMap(
  descriptors: readonly SourceClosureDescriptor[],
): ReadonlyMap<string, SourceClosureDescriptor> {
  return new Map(descriptors.map((descriptor) => [descriptor.path, descriptor]));
}

function capability(path: string): RuntimePathCapability {
  if (path === 'src/benchmark/service-fast-numerical-experiment/accepted-run/clock.ts') {
    return Object.freeze({ path, builtins: Object.freeze([]), capabilities: Object.freeze(['operational-clock'] as const) });
  }
  if (path === 'src/benchmark/service-fast-numerical-experiment/accepted-run/environment.ts') {
    return Object.freeze({ path, builtins: Object.freeze(['node:os', 'node:worker_threads']), capabilities: Object.freeze(['runtime-environment'] as const) });
  }
  if (path === 'src/benchmark/service-fast-numerical-experiment/accepted-run/publication.ts') {
    return Object.freeze({
      path,
      builtins: Object.freeze(['node:crypto', 'node:fs', 'node:fs/promises', 'node:path']),
      capabilities: Object.freeze(['accepted-publication'] as const),
    });
  }
  if (path === 'src/benchmark/service-fast-numerical-experiment/source-closure/git.ts') {
    return Object.freeze({ path, builtins: Object.freeze(['node:child_process', 'node:path']), capabilities: Object.freeze(['bounded-git-metadata'] as const) });
  }
  if (
    path === 'src/benchmark/service-fast-numerical-experiment/accepted-run/projection.ts' ||
    path === 'src/benchmark/service-fast-numerical-experiment/exact-replay.ts' ||
    path === 'src/benchmark/service-fast-numerical-experiment/input/codec.ts' ||
    path === 'src/benchmark/service-fast-numerical-experiment/source-closure/codec.ts' ||
    path === 'src/router/exact-input-split-session/index.ts' ||
    path === 'src/serialization/canonical-snapshot/index.ts'
  ) {
    return Object.freeze({ path, builtins: Object.freeze(['node:crypto']), capabilities: Object.freeze(['hash'] as const) });
  }
  if (path === 'src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts') {
    return Object.freeze({
      path,
      builtins: Object.freeze(['node:crypto', 'node:path']),
      capabilities: Object.freeze(['hash'] as const),
    });
  }
  if (path === 'src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts') {
    return Object.freeze({ path, builtins: Object.freeze(['node:fs/promises', 'node:path']), capabilities: Object.freeze(['read-only-filesystem'] as const) });
  }
  if (path === 'src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts') {
    return Object.freeze({
      path,
      builtins: Object.freeze(['node:path', 'node:url']),
      capabilities: Object.freeze(['fixed-repository-root'] as const),
    });
  }
  if (
    path === 'src/benchmark/service-fast-numerical-experiment/input/build.ts' ||
    path === 'src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts'
  ) {
    const builtins = path.endsWith('/build.ts')
      ? Object.freeze(['node:crypto', 'node:fs/promises', 'node:path', 'node:util'])
      : Object.freeze(['node:crypto', 'node:fs/promises', 'node:path']);
    return Object.freeze({ path, builtins, capabilities: Object.freeze(['hash', 'read-only-filesystem'] as const) });
  }
  return Object.freeze({ path, builtins: Object.freeze([]), capabilities: Object.freeze([]) });
}

export function acceptedRunRuntimeAuditProfile(
  descriptors: readonly SourceClosureDescriptor[],
): RuntimeImportAuditProfile {
  const byPath = descriptorMap(descriptors);
  const projectSources: RuntimeProjectDescriptor[] = ACCEPTED_RUN_RUNTIME_PATHS.map((sourcePath) => {
    const descriptor = byPath.get(sourcePath);
    if (descriptor === undefined) throw new TypeError('Accepted runtime descriptor is absent.');
    return Object.freeze({ path: descriptor.path, bytes: descriptor.bytes, sha256: descriptor.sha256 });
  });
  const pathCapabilities = Object.freeze(ACCEPTED_RUN_RUNTIME_PATHS.map(capability));
  const nodeBuiltins = Object.freeze([...new Set(pathCapabilities.flatMap((value) => value.builtins))]);
  return Object.freeze({
    profileId: 'service-fast-accepted-run-v1',
    entryRoots: Object.freeze([
      'cli/run-service-fast-numerical-experiment.ts',
    ]),
    projectSources: Object.freeze(projectSources),
    nodeBuiltins,
    pathCapabilities,
  });
}
