import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  SERVICE_FAST_EXPERIMENT_ANCHOR_POLICY_ID,
  SERVICE_FAST_EXPERIMENT_MAXIMUM_CAPS,
  SERVICE_FAST_EXPERIMENT_POLICY_COUNT,
  classifyServiceFastExperimentValidationMismatch,
  evaluateServiceFastSemanticPolicy,
  isFinalizedServiceFastCompleteOutcome,
  isFinalizedServiceFastStoppedOutcome,
  prepareServiceFastExperimentCell,
  prepareServiceFastOperationalPolicy,
  projectServiceFastSemanticResult,
  runServiceFastOperationalPolicy,
  serviceFastExperimentCounterVectorsMatch,
  serviceFastExperimentCallSetSnapshot,
  serviceFastExperimentMaximumCapsForPolicy,
  serviceFastExperimentPolicies,
  serviceFastExperimentPolicyAt,
  validateServiceFastCompleteOutcome,
  validateServiceFastDeadlinePrefix,
  type ServiceFastExperimentActionCaps,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentCompleteOutcome,
  type ServiceFastExperimentOutcome,
  type ServiceFastExperimentRawCompleteOutcome,
  type ServiceFastExperimentRawCounters,
  type ServiceFastExperimentRawStoppedOutcome,
  type ServiceFastExperimentResolvedCandidateSetInput,
} from '../src/benchmark/service-fast-numerical-experiment/index.ts';
import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import type { DirectionalRouteHop } from '../src/replay/exact-input-route/index.ts';
import {
  prepareRoutingContext,
  resolvePreparedPathShadowPriceRoutes,
  type PreparedRoutingContext,
} from '../src/runtime/prepared-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';
import {
  SERVICE_FAST_CONFIG_PATH,
  SourceClosureCodecError,
  decodeServiceFastSourceClosure,
  parseFrozenServiceFastConfiguration,
  sha256Bytes,
  type FrozenServiceFastConfiguration,
} from '../src/benchmark/service-fast-numerical-experiment/source-closure/codec.ts';
import {
  generateServiceFastSourceClosure,
  prepareServiceFastSourceClosure,
} from '../src/benchmark/service-fast-numerical-experiment/source-closure/generate.ts';
import {
  ServiceFastSourceClosureError,
  verifyDurableServiceFastSourceClosure,
  verifyExecutableServiceFastSourceClosure,
} from '../src/benchmark/service-fast-numerical-experiment/source-closure/verification.ts';
import {
  SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
  ServiceFastReviewedInputBindingError,
  type ReviewedInputBinding,
} from '../src/benchmark/service-fast-numerical-experiment/source-closure/reviewed-input-binding.ts';
import {
  SourceClosureGitError,
  readGitBlob,
  readGitHeadRevision,
  readGitIgnoredPaths,
  readGitIndexEntries,
  readGitStatusPorcelain,
} from '../src/benchmark/service-fast-numerical-experiment/source-closure/git.ts';
import {
  SERVICE_FAST_SOURCE_CLOSURE_PUBLICATION_ERROR_CODES,
  defaultClosurePublicationDependencies,
  publishCanonicalSourceClosure,
  SourceClosurePublicationError,
} from '../src/benchmark/service-fast-numerical-experiment/source-closure/publication.ts';
import {
  SERVICE_FAST_ARTIFACT_VERIFIER_HELPER,
  SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER,
  ServiceFastVerifierInvocationError,
  dispatchServiceFastVerifierChild,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/dispatcher.ts';
import {
  ServiceFastVerifierDispatchError,
  SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION,
  encodeProjectedServiceFastToolFailure,
  projectServiceFastToolFailure,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/tool-failure.ts';
import {
  SERVICE_FAST_EXPERIMENT_ID,
  ServiceFastReadmeRenderingError,
  renderMaximalServiceFastExperimentReadme,
  renderServiceFastExperimentReadme,
  type ServiceFastReadmeDecision,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/readme-template.ts';
import {
  serviceFastSourceClosureRepositoryRoot,
  serviceFastVerifierRepositoryRoot,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/fixed-repository-root.ts';
import {
  ServiceFastDurableBootstrapError,
  admitServiceFastAttestedRuntimeDescriptorBytes,
  authenticateServiceFastDurableVerifierBeforeDispatch,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/durable-verifier-bootstrap.ts';
import {
  ServiceFastBoundedIdentityReadError,
  readBoundedIdentityFile,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/bounded-identity-reader.ts';
import {
  SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH,
  ServiceFastDurableRuntimeProfileError,
  decodeServiceFastDurableRuntimeProfileSource,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/durable-runtime-profile.ts';
import {
  SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS,
  SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS,
  ServiceFastRuntimeImportAuditError,
  auditServiceFastRuntimeImports,
  generationChildRuntimeAuditProfile,
  noArgumentParentRuntimeAuditProfile,
  type RuntimeImportAuditProfile,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/runtime-import-audit.ts';
import {
  ServiceFastSizeAdmissionError,
  admitPreSourceClosureArtifactSizes,
} from '../src/benchmark/service-fast-numerical-experiment/tooling/size-admission.ts';
import type { ExperimentInputOperations } from '../src/benchmark/service-fast-numerical-experiment/input/build.ts';
import {
  ACCEPTED_EXECUTION_SCHEDULE,
  ACCEPTED_DEADLINES_MS,
  ACCEPTED_HOTSPOT_CASE_IDS,
  ACCEPTED_OPERATIONAL_CASE_IDS,
  ACCEPTED_POLICY_IDS,
  ACCEPTED_RETAINED_DIRECTORY,
  acceptedRetainedFileContracts,
  type AcceptedInputRecord,
  type AcceptedJsonObject,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/contract.ts';
import {
  AcceptedAnalysisAccumulator,
  buildAcceptedAnalysis,
  compareAcceptedPolicyResults,
  decideAcceptedPolicy,
  qualifyAcceptedPolicy,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/analysis.ts';
import {
  ACCEPTED_RUN_INTERNAL_FAILURE_REGISTRY,
  AcceptedRunFailure,
  acceptedRunFailure,
  acceptedRunFailureEnvelope,
  encodeAcceptedRunFailure,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/failure.ts';
import {
  defaultAcceptedPublicationDependencies,
  admitAcceptedPublication,
  abortAcceptedPublication,
  publishAcceptedArtifacts,
  type AcceptedPublicationDependencies,
  type AcceptedPreparedArtifact,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/publication.ts';
import {
  acceptedCallProtocolSchedule,
  acceptedDeadlineProtocolSchedule,
  acceptedSemanticSchedule,
  acceptedTimelineSchedule,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/schedule.ts';
import {
  ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS,
  acceptedAbsoluteDeadline,
  admitAcceptedClockSample,
  measureAcceptedInvocation,
  runAcceptedExperiment,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/run.ts';
import {
  ACCEPTED_RUN_RUNTIME_PATHS,
  acceptedRunRuntimeAuditProfile,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/runtime-profile.ts';
import {
  admitAcceptedEntryIncumbentReplay,
  admitAcceptedRecordBindings,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/input.ts';
import {
  recheckAcceptedBoundBytes,
  type AcceptedPreflightResult,
} from '../src/benchmark/service-fast-numerical-experiment/accepted-run/preflight.ts';

function pool(
  poolId: string,
  reserveIn: bigint,
  reserveOut: bigint,
): ConstantProductPool {
  return Object.freeze({
    poolId,
    asset0: 'A',
    reserve0: reserveIn,
    asset1: 'C',
    reserve1: reserveOut,
    feeChargedNumerator: 3n,
    feeDenominator: 1_000n,
  });
}

function snapshot(
  pools: readonly ConstantProductPool[] = [
    pool('left-ac', 10_000n, 10_000n),
    pool('right-ac', 12_000n, 12_000n),
  ],
): LiquiditySnapshot {
  const source: LiquiditySnapshot = {
    snapshotId: 'service-fast-experiment-test',
    snapshotChecksum: 'pending',
    pools,
  };
  return Object.freeze({
    ...source,
    snapshotChecksum: computeCanonicalSnapshotChecksum(source),
  });
}

function prepareContext(value: LiquiditySnapshot): PreparedRoutingContext {
  const prepared = prepareRoutingContext(value);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error('Expected prepared context.');
  return prepared.value;
}

const ROUTES = Object.freeze([
  Object.freeze([
    Object.freeze({ assetIn: 'A', poolId: 'left-ac', assetOut: 'C' }),
  ]),
  Object.freeze([
    Object.freeze({ assetIn: 'A', poolId: 'right-ac', assetOut: 'C' }),
  ]),
]) satisfies readonly (readonly DirectionalRouteHop[])[];

function resolvedCandidate(
  context: PreparedRoutingContext,
): ServiceFastExperimentResolvedCandidateSetInput {
  const resolved = resolvePreparedPathShadowPriceRoutes(context, ROUTES);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error('Expected route models.');
  return Object.freeze({
    routes: ROUTES,
    modelResolution: Object.freeze({
      ok: true as const,
      resolvedRoutes: resolved.value,
    }),
  });
}

function prepareCell(
  amountIn = 101n,
  candidateSets?: readonly ServiceFastExperimentResolvedCandidateSetInput[],
): ServiceFastExperimentCell {
  const value = snapshot();
  const context = prepareContext(value);
  const sets = candidateSets ?? [resolvedCandidate(context)];
  const repairTargetSetIndex = sets.findIndex(
    (set) => set.modelResolution.ok,
  );
  return prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn,
    candidateSets: sets,
    repairTargetSetIndex: repairTargetSetIndex < 0 ? null : repairTargetSetIndex,
  });
}

function semanticComplete(
  cell: ServiceFastExperimentCell,
  policyIndex: number,
): ServiceFastExperimentCompleteOutcome {
  const outcome = evaluateServiceFastSemanticPolicy(cell, policyIndex);
  assert.equal(outcome.status, 'complete');
  if (outcome.status !== 'complete') {
    throw new Error('Expected classified semantic completion.');
  }
  return outcome;
}

function caps(
  policyIndex: number,
  overrides: Partial<ServiceFastExperimentActionCaps>,
): ServiceFastExperimentActionCaps {
  return Object.freeze({
    ...serviceFastExperimentMaximumCapsForPolicy(policyIndex),
    ...overrides,
  });
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

const COUNTER_KEYS = Object.freeze([
  'methodActions',
  'outerUpdates',
  'shareActions',
  'reconstructionSteps',
  'residualReplays',
  'residualRejections',
  'repairReplays',
  'repairRejections',
  'authorizationReplays',
  'authorizationRejections',
  'proposals',
  'diagnostics',
] as const);

function assertCounterPartition(
  outcome: ServiceFastExperimentOutcome | ServiceFastExperimentCompleteOutcome,
): void {
  const totals = Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])) as {
    -readonly [Key in typeof COUNTER_KEYS[number]]: number | null;
  };
  const methods = outcome.setSnapshots.map(
    (snapshotValue) => snapshotValue.counters.methodActions,
  );
  if (methods.every((value) => value === null)) totals.methodActions = null;
  else {
    assert.ok(methods.every((value) => typeof value === 'number'));
    totals.methodActions = methods.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0,
    );
  }
  for (const key of COUNTER_KEYS) {
    if (key === 'methodActions') continue;
    totals[key] = outcome.setSnapshots.reduce(
      (sum, snapshotValue) => sum + snapshotValue.counters[key],
      0,
    );
  }
  assert.deepEqual(totals, outcome.counters);
  for (const snapshotValue of outcome.setSnapshots) {
    assertDeepFrozen(snapshotValue.counters);
    const diagnostic = outcome.diagnostics.find(
      (candidate) => candidate.setIndex === snapshotValue.setIndex,
    );
    if (snapshotValue.terminalDiagnostic === null) {
      assert.equal(snapshotValue.counters.diagnostics, 0);
      continue;
    }
    assert.equal(snapshotValue.stage, 'terminal');
    assert.notEqual(diagnostic, undefined);
    assert.deepEqual(snapshotValue.counters, diagnostic?.counters);
    assert.notEqual(snapshotValue.counters, diagnostic?.counters);
    assert.deepEqual(snapshotValue.proposalFailure, diagnostic?.proposalFailure);
  }
}

function countersWithFineValuesFrom(
  base: ServiceFastExperimentRawCounters,
  source: ServiceFastExperimentRawCounters,
): ServiceFastExperimentRawCounters {
  return Object.freeze({
    ...base,
    outerUpdates: source.outerUpdates,
    shareActions: source.shareActions,
    reconstructionSteps: source.reconstructionSteps,
  });
}

function counterVector(
  methodActions: number | null,
  outerUpdates: number,
  shareActions: number,
  reconstructionSteps: number,
): ServiceFastExperimentRawCounters {
  return Object.freeze({
    methodActions,
    outerUpdates,
    shareActions,
    reconstructionSteps,
    residualReplays: 0,
    residualRejections: 0,
    repairReplays: 0,
    repairRejections: 0,
    authorizationReplays: 0,
    authorizationRejections: 0,
    proposals: 0,
    diagnostics: 0,
  });
}

function redistributeFirstTwoFineCounterVectors<
  T extends
    | ServiceFastExperimentRawCompleteOutcome
    | ServiceFastExperimentRawStoppedOutcome,
>(outcome: T): T {
  const first = outcome.setSnapshots[0];
  const second = outcome.setSnapshots[1];
  if (first === undefined || second === undefined) {
    throw new Error('Expected two candidate-set snapshots.');
  }
  const firstCounters = countersWithFineValuesFrom(
    first.counters,
    second.counters,
  );
  const secondCounters = countersWithFineValuesFrom(
    second.counters,
    first.counters,
  );
  const countersBySet = new Map<number, ServiceFastExperimentRawCounters>([
    [first.setIndex, firstCounters],
    [second.setIndex, secondCounters],
  ]);
  const diagnostics = Object.freeze(outcome.diagnostics.map((diagnostic) =>
    Object.freeze({
      ...diagnostic,
      counters: countersBySet.get(diagnostic.setIndex) ?? diagnostic.counters,
    })));
  const setSnapshots = Object.freeze(outcome.setSnapshots.map((snapshotValue) => {
    const counters = countersBySet.get(snapshotValue.setIndex) ??
      snapshotValue.counters;
    const terminalDiagnostic = snapshotValue.terminalDiagnostic === null
      ? null
      : diagnostics.find(
        (diagnostic) => diagnostic.setIndex === snapshotValue.setIndex,
      ) ?? null;
    return Object.freeze({
      ...snapshotValue,
      counters,
      terminalDiagnostic,
    });
  }));
  return Object.freeze({
    ...outcome,
    diagnostics,
    setSnapshots,
  }) as unknown as T;
}

void test('freezes the exact 24-policy matrix and per-driver hard caps', () => {
  const policies = serviceFastExperimentPolicies();
  assert.equal(SERVICE_FAST_EXPERIMENT_POLICY_COUNT, 24);
  assert.equal(policies.length, 24);
  assert.equal(policies[0]?.policyId, SERVICE_FAST_EXPERIMENT_ANCHOR_POLICY_ID);
  assert.deepEqual(
    policies.slice(0, 4).map((policy) => policy.policyId),
    [
      'bisection-o64-i64--strict-reject--current',
      'bisection-o64-i64--strict-reject--bounded-exact-neighborhood-v1',
      'bisection-o64-i64--final-finite-replay--current',
      'bisection-o64-i64--final-finite-replay--bounded-exact-neighborhood-v1',
    ],
  );
  assert.deepEqual(
    policies.filter((_, index) => index % 4 === 0).map(
      (policy) => policy.maximumShareActions,
    ),
    [68_640, 27_040, 9_504, 3_808, 2_080, 11_440],
  );
  assert.deepEqual(SERVICE_FAST_EXPERIMENT_MAXIMUM_CAPS, {
    proposals: 4,
    modelRouteSetupSteps: 16,
    shareActions: 68_640,
    reconstructionSteps: 48,
    residualReplays: 48,
    repairReplays: 29,
    authorizationReplays: 4,
    stageAggregate: 68_773,
    conservativeAggregate: 68_789,
  });
  assert.throws(() => serviceFastExperimentPolicyAt(-1), TypeError);
  assert.throws(() => serviceFastExperimentPolicyAt(24), TypeError);
  assertDeepFrozen(policies);
});

void test('classifies every semantic policy with exact replay and stable evidence', () => {
  const cell = prepareCell();
  let plans = 0;
  let typedFailures = 0;
  let upstreamRepairFailures = 0;
  for (let policyIndex = 0; policyIndex < SERVICE_FAST_EXPERIMENT_POLICY_COUNT;
    policyIndex += 1) {
    const first = semanticComplete(cell, policyIndex);
    const second = semanticComplete(cell, policyIndex);
    assertCounterPartition(first);
    const firstProjection = projectServiceFastSemanticResult(first);
    const secondProjection = projectServiceFastSemanticResult(second);
    assert.deepEqual(secondProjection, firstProjection);
    assert.equal(first.counters.diagnostics, first.diagnostics.length);
    assert.equal(first.counters.proposals, 1);
    if (first.finalIncumbent === null) {
      typedFailures += 1;
      assert.equal(first.anyImprovement, false);
      assert.notEqual(first.diagnostics[0]?.failureCode, null);
    } else {
      plans += 1;
      assert.equal(first.finalIncumbent.amountIn, 101n);
      assert.equal(first.anyValidScore, true);
      assert.equal(first.anyImprovement, true);
    }
    if (
      first.policy.reconstruction === 'bounded-exact-neighborhood-v1' &&
      first.diagnostics[0]?.status === 'proposal-failed'
    ) {
      upstreamRepairFailures += 1;
      assert.equal(
        first.diagnostics[0].reconstructionDisposition,
        'repair-incomplete',
      );
      assert.equal(first.diagnostics[0].repair?.complete, false);
      assert.equal(first.diagnostics[0].repair?.attempts.length, 0);
      assert.equal(
        first.diagnostics[0].repair?.failureCode,
        first.diagnostics[0].failureCode,
      );
    }
    assertDeepFrozen(firstProjection);
  }
  assert.ok(plans > 0);
  assert.ok(typedFailures > 0);
  assert.ok(upstreamRepairFailures > 0);
});

void test('keeps protected anchor timing raw until complete outside validation', () => {
  const cell = prepareCell();
  const semantic = semanticComplete(cell, 0);
  const call = prepareServiceFastOperationalPolicy(cell, 0);
  const raw = runServiceFastOperationalPolicy(call);
  assert.equal(raw.status, 'complete');
  if (raw.status !== 'complete') throw new Error('Expected raw completion.');
  assert.equal(raw.adapterMode, 'operational');
  assertCounterPartition(raw);
  assert.equal(raw.counters.methodActions, null);
  assert.equal(raw.diagnostics[0]?.reconstruction, null);
  assert.equal(isFinalizedServiceFastCompleteOutcome(raw), false);
  const validated = validateServiceFastCompleteOutcome(raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected complete parity.');
  assertCounterPartition(validated.value);
  assert.ok(validated.value.setSnapshots.every(
    (snapshotValue) => typeof snapshotValue.counters.methodActions === 'number',
  ));
  assert.equal(typeof validated.value.counters.methodActions, 'number');
  assert.equal(isFinalizedServiceFastCompleteOutcome(validated.value), true);
  const operationalProjection = projectServiceFastSemanticResult(validated.value);
  const semanticProjection = projectServiceFastSemanticResult(semantic);
  assert.deepEqual(operationalProjection, semanticProjection);
  assert.deepEqual(
    validated.value.diagnostics[0]?.reconstruction,
    semantic.diagnostics[0]?.reconstruction,
  );
});

void test('replays and finalizes stopped prefixes without charging the pending action', () => {
  const cell = prepareCell();
  const semantic = semanticComplete(cell, 0);
  const call = prepareServiceFastOperationalPolicy(
    cell,
    0,
    caps(0, { shareActions: 3 }),
  );
  const raw = runServiceFastOperationalPolicy(call);
  assert.equal(raw.status, 'stopped');
  if (raw.status !== 'stopped') throw new Error('Expected stopped prefix.');
  assert.equal(raw.reason, 'action-cap');
  assert.equal(raw.nextAction.actionKind, 'protected-share-microstep');
  assert.equal(raw.counters.proposals, 1);
  assert.equal(raw.counters.shareActions, 3);
  assert.equal(raw.counters.methodActions, null);
  assert.equal(raw.stageAggregate, 4);
  assertCounterPartition(raw);
  assert.ok(raw.setSnapshots.every(
    (snapshotValue) => snapshotValue.counters.methodActions === null,
  ));
  const validated = validateServiceFastDeadlinePrefix(call, raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected prefix parity.');
  assertCounterPartition(validated.value);
  assert.equal(validated.value.reason, 'action-cap');
  assert.equal(isFinalizedServiceFastStoppedOutcome(raw), false);
  assert.equal(isFinalizedServiceFastStoppedOutcome(validated.value), true);
  assert.equal(validated.value.counters.shareActions, 3);
  assert.equal(typeof validated.value.counters.methodActions, 'number');
  assert.equal(validated.value.nextAction.counters.shareActions, 3);
  assert.equal(
    validated.value.nextAction.counters.methodActions,
    validated.value.counters.methodActions,
  );
  assertDeepFrozen(validated.value);
});

void test('runtime-fences semantic evidence from raw and forged completions', () => {
  const cell = prepareCell();
  const policyIndex = 7;
  const semantic = semanticComplete(cell, policyIndex);
  const call = prepareServiceFastOperationalPolicy(cell, policyIndex);
  const raw = runServiceFastOperationalPolicy(call);
  assert.equal(raw.status, 'complete');
  if (raw.status !== 'complete') throw new Error('Expected candidate completion.');
  assert.equal(typeof raw.counters.methodActions, 'number');
  assert.equal(isFinalizedServiceFastCompleteOutcome(raw), false);
  assert.throws(
    () => projectServiceFastSemanticResult(
      raw as unknown as ServiceFastExperimentCompleteOutcome,
    ),
    TypeError,
  );
  assert.throws(
    () => projectServiceFastSemanticResult(
      Object.freeze({ ...semantic }),
    ),
    TypeError,
  );
  const otherSemantic = semanticComplete(prepareCell(), policyIndex);
  assert.deepEqual(validateServiceFastCompleteOutcome(raw, otherSemantic), {
    ok: false,
    code: 'counter-invariant-failure',
  });
  const validated = validateServiceFastCompleteOutcome(raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected candidate validation.');
  assert.equal(isFinalizedServiceFastCompleteOutcome(validated.value), true);
  assert.deepEqual(
    projectServiceFastSemanticResult(validated.value),
    projectServiceFastSemanticResult(semantic),
  );
  assert.deepEqual(validateServiceFastCompleteOutcome(raw, semantic), {
    ok: false,
    code: 'counter-invariant-failure',
  });
});

void test('rejects forged equal-total per-set fine-counter redistribution', () => {
  const context = prepareContext(snapshot());
  const candidate = resolvedCandidate(context);
  const unresolved: ServiceFastExperimentResolvedCandidateSetInput = Object.freeze({
    routes: ROUTES,
    modelResolution: Object.freeze({ ok: false as const }),
  });
  const completeCell = prepareCell(101n, [candidate, unresolved]);
  const completeSemantic = semanticComplete(completeCell, 0);
  const completeCall = prepareServiceFastOperationalPolicy(completeCell, 0);
  const completeRaw = runServiceFastOperationalPolicy(completeCall);
  assert.equal(completeRaw.status, 'complete');
  if (completeRaw.status !== 'complete') throw new Error('Expected completion.');
  const completeForged = redistributeFirstTwoFineCounterVectors(completeRaw);
  assert.deepEqual(validateServiceFastCompleteOutcome(
    completeForged,
    completeSemantic,
  ), {
    ok: false,
    code: 'counter-invariant-failure',
  });
  assert.equal(
    validateServiceFastCompleteOutcome(completeRaw, completeSemantic).ok,
    true,
  );

  const stoppedCell = prepareCell(101n, [candidate, candidate]);
  const stoppedSemantic = semanticComplete(stoppedCell, 0);
  const stoppedCall = prepareServiceFastOperationalPolicy(stoppedCell, 0);
  const stoppedRaw = runServiceFastOperationalPolicy(
    stoppedCall,
    (pending) => pending.setIndex === 1 && pending.actionKind === 'proposal',
  );
  assert.equal(stoppedRaw.status, 'stopped');
  if (stoppedRaw.status !== 'stopped') throw new Error('Expected stopped prefix.');
  const stoppedForged = redistributeFirstTwoFineCounterVectors(stoppedRaw);
  assert.deepEqual(validateServiceFastDeadlinePrefix(
    stoppedCall,
    stoppedForged,
    stoppedSemantic,
  ), {
    ok: false,
    code: 'counter-invariant-failure',
  });
  assert.equal(
    validateServiceFastDeadlinePrefix(stoppedCall, stoppedRaw, stoppedSemantic).ok,
    true,
  );
});

void test('admits protected per-set fine counters only elementwise', () => {
  const raw = Object.freeze([
    counterVector(null, 2, 7, 3),
    counterVector(null, 0, 0, 0),
  ]);
  const matchingShadow = Object.freeze([
    counterVector(6, 2, 7, 3),
    counterVector(0, 0, 0, 0),
  ]);
  const redistributedShadow = Object.freeze([
    counterVector(0, 0, 0, 0),
    counterVector(6, 2, 7, 3),
  ]);
  assert.equal(
    serviceFastExperimentCounterVectorsMatch(
      raw,
      matchingShadow,
      'protected-operational',
    ),
    true,
  );
  assert.equal(
    serviceFastExperimentCounterVectorsMatch(
      raw,
      redistributedShadow,
      'protected-operational',
    ),
    false,
  );
  assert.equal(
    serviceFastExperimentCounterVectorsMatch(
      matchingShadow,
      matchingShadow,
      'configurable-exact',
    ),
    true,
  );
  assert.equal(
    serviceFastExperimentCounterVectorsMatch(
      matchingShadow,
      redistributedShadow,
      'configurable-exact',
    ),
    false,
  );
});

void test('classifies the three validation mismatch taxonomies without runtime seams', () => {
  assert.equal(
    classifyServiceFastExperimentValidationMismatch(0, 'operational-parity'),
    'semantic-anchor-parity-mismatch',
  );
  assert.equal(
    classifyServiceFastExperimentValidationMismatch(1, 'operational-parity'),
    'exact-replay-mismatch',
  );
  assert.equal(
    classifyServiceFastExperimentValidationMismatch(0, 'exact-replay'),
    'exact-replay-mismatch',
  );
  assert.equal(
    classifyServiceFastExperimentValidationMismatch(0, 'counter-invariant'),
    'counter-invariant-failure',
  );
  assert.throws(
    () => classifyServiceFastExperimentValidationMismatch(
      0,
      'forged' as 'operational-parity',
    ),
    TypeError,
  );
});

void test('rejects mismatched, reused, and resumed stopped-prefix provenance', () => {
  const cell = prepareCell();
  const semantic = semanticComplete(cell, 0);
  const firstCall = prepareServiceFastOperationalPolicy(cell, 0);
  const raw = runServiceFastOperationalPolicy(
    firstCall,
    (pending) => pending.actionKind === 'protected-share-microstep',
  );
  assert.equal(raw.status, 'stopped');
  if (raw.status !== 'stopped') throw new Error('Expected provenance stop.');
  const otherCall = prepareServiceFastOperationalPolicy(cell, 0);
  assert.deepEqual(
    validateServiceFastDeadlinePrefix(otherCall, raw, semantic),
    { ok: false, code: 'counter-invariant-failure' },
  );
  const firstValidation = validateServiceFastDeadlinePrefix(firstCall, raw, semantic);
  assert.equal(firstValidation.ok, true);
  assert.deepEqual(
    validateServiceFastDeadlinePrefix(firstCall, raw, semantic),
    { ok: false, code: 'counter-invariant-failure' },
  );

  const resumedCall = prepareServiceFastOperationalPolicy(cell, 0);
  const resumedRaw = runServiceFastOperationalPolicy(
    resumedCall,
    (pending) => pending.actionKind === 'protected-share-microstep',
  );
  assert.equal(resumedRaw.status, 'stopped');
  if (resumedRaw.status !== 'stopped') throw new Error('Expected resumed stop.');
  assert.equal(runServiceFastOperationalPolicy(resumedCall).status, 'complete');
  assert.deepEqual(
    validateServiceFastDeadlinePrefix(resumedCall, resumedRaw, semantic),
    { ok: false, code: 'counter-invariant-failure' },
  );
});

void test('validates every protected-anchor pre-action family at its exact prefix', () => {
  const cell = prepareCell();
  const semantic = semanticComplete(cell, 0);
  const actions = [
    'proposal',
    'protected-share-microstep',
    'reconstruction-step',
    'residual-replay',
    'authorization-replay',
  ] as const;
  for (const action of actions) {
    const call = prepareServiceFastOperationalPolicy(cell, 0);
    const raw = runServiceFastOperationalPolicy(
      call,
      (pending) => pending.actionKind === action,
    );
    assert.equal(raw.status, 'stopped');
    if (raw.status !== 'stopped') throw new Error(`Expected ${action} stop.`);
    assert.equal(raw.reason, 'observer');
    assert.equal(raw.nextAction.actionKind, action);
    assert.equal(raw.counters.methodActions, null);
    const validated = validateServiceFastDeadlinePrefix(call, raw, semantic);
    assert.equal(validated.ok, true);
    if (!validated.ok) throw new Error(`Expected ${action} prefix parity.`);
    assert.equal(typeof validated.value.counters.methodActions, 'number');
    if (action === 'residual-replay' || action === 'authorization-replay') {
      assert.equal(raw.setSnapshots[0]?.reconstruction, null);
      assert.equal(
        raw.setSnapshots[0]?.initialResidualUnits,
        semantic.setSnapshots[0]?.initialResidualUnits,
      );
      assert.deepEqual(
        validated.value.setSnapshots[0]?.reconstruction,
        semantic.setSnapshots[0]?.reconstruction,
      );
    }
  }
});

void test('exposes the configurable final-share and canonical next-set boundaries', () => {
  const cell = prepareCell();
  const finalPolicyIndex = 2;
  const finalSemantic = semanticComplete(cell, finalPolicyIndex);
  const finalCall = prepareServiceFastOperationalPolicy(cell, finalPolicyIndex);
  const finalRaw = runServiceFastOperationalPolicy(
    finalCall,
    (pending) => pending.actionKind === 'bisection-final-share',
  );
  assert.equal(finalRaw.status, 'stopped');
  if (finalRaw.status !== 'stopped') throw new Error('Expected final-share stop.');
  assert.equal(finalRaw.nextAction.actionKind, 'bisection-final-share');
  assert.equal(
    validateServiceFastDeadlinePrefix(finalCall, finalRaw, finalSemantic).ok,
    true,
  );

  const context = prepareContext(snapshot());
  const candidate = resolvedCandidate(context);
  const multiSetCell = prepareCell(101n, [candidate, candidate]);
  const multiSetSemantic = semanticComplete(multiSetCell, 0);
  const multiSetCall = prepareServiceFastOperationalPolicy(multiSetCell, 0);
  const setRaw = runServiceFastOperationalPolicy(
    multiSetCall,
    (pending) => pending.setIndex === 1 && pending.actionKind === 'proposal',
  );
  assert.equal(setRaw.status, 'stopped');
  if (setRaw.status !== 'stopped') throw new Error('Expected next-set stop.');
  assert.equal(setRaw.diagnostics.length, 1);
  assert.equal(setRaw.setSnapshots[0]?.stage, 'terminal');
  assert.equal(setRaw.setSnapshots[1]?.stage, 'proposal');
  assertCounterPartition(setRaw);
  assert.equal(setRaw.setSnapshots[0]?.counters.diagnostics, 1);
  assert.equal(setRaw.setSnapshots[1]?.counters.diagnostics, 0);
  assert.equal(
    validateServiceFastDeadlinePrefix(
      multiSetCall,
      setRaw,
      multiSetSemantic,
    ).ok,
    true,
  );
});

void test('normalizes terminal-only failures without a post-terminal observer call', () => {
  const unresolved: ServiceFastExperimentResolvedCandidateSetInput = Object.freeze({
    routes: ROUTES,
    modelResolution: Object.freeze({ ok: false as const }),
  });
  const cell = prepareCell(101n, [unresolved]);
  const call = prepareServiceFastOperationalPolicy(cell, 7);
  let observerCalls = 0;
  const outcome = runServiceFastOperationalPolicy(call, () => {
    observerCalls += 1;
    return false;
  });
  assert.equal(outcome.status, 'complete');
  assert.equal(observerCalls, 0);
  assert.equal(outcome.diagnostics[0]?.status, 'model-resolution-failed');
  assert.equal(outcome.setSnapshots[0]?.stage, 'terminal');
  assert.equal(outcome.counters.proposals, 0);
});

void test('sets any-valid-score only after a full-input scoring receipt', () => {
  const value = snapshot([
    pool('a-ac', 10_000n, 10_000n),
    pool('b-ac', 10_000n, 10_000n),
    pool('c-ac', 10_000n, 10_000n),
    pool('d-ac', 10_000n, 10_000n),
  ]);
  const context = prepareContext(value);
  const routes = Object.freeze(['a-ac', 'b-ac', 'c-ac', 'd-ac'].map((poolId) =>
    Object.freeze([Object.freeze({ assetIn: 'A', poolId, assetOut: 'C' })])));
  const resolved = resolvePreparedPathShadowPriceRoutes(context, routes);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error('Expected four route models.');
  const cell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 1_003n,
    candidateSets: [{
      routes,
      modelResolution: { ok: true, resolvedRoutes: resolved.value },
    }],
    repairTargetSetIndex: 0,
  });
  const semantic = semanticComplete(cell, 0);
  const call = prepareServiceFastOperationalPolicy(cell, 0);
  const raw = runServiceFastOperationalPolicy(
    call,
    (pending) => pending.actionKind === 'residual-replay' &&
      pending.counters.residualReplays === 1,
  );
  assert.equal(raw.status, 'stopped');
  if (raw.status !== 'stopped') throw new Error('Expected partial residual stop.');
  assert.equal(raw.anyValidScore, false);
  const attempt = raw.setSnapshots[0]?.currentAttempts[0];
  assert.notEqual(attempt?.receipt, null);
  assert.ok((attempt?.receipt?.amountIn ?? 1_003n) < 1_003n);
  const validated = validateServiceFastDeadlinePrefix(call, raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected partial-score prefix parity.');
  assert.ok((validated.value.setSnapshots[0]?.reconstruction?.residualUnits ?? 0n) > 1n);
  assert.equal(validated.value.anyValidScore, false);

  const repairSemantic = semanticComplete(cell, 15);
  const repairDiagnostic = repairSemantic.diagnostics[0];
  assert.notEqual(repairDiagnostic, undefined);
  const partialCurrentAttempts = repairDiagnostic?.currentAttempts.filter((attempt) =>
    attempt.allocations.reduce((sum, allocation) => sum + allocation, 0n) < 1_003n
  ) ?? [];
  assert.ok(partialCurrentAttempts.length > 0);
  for (const attempt of repairDiagnostic?.currentAttempts ?? []) {
    const attemptedAmount = attempt.allocations.reduce(
      (sum, allocation) => sum + allocation,
      0n,
    );
    assert.equal(attempt.receipt?.amountIn, attemptedAmount);
    assert.equal(attempt.failureCode, null);
  }
  for (const attempt of repairDiagnostic?.repair?.attempts ?? []) {
    assert.equal(
      attempt.allocations.reduce((sum, allocation) => sum + allocation, 0n),
      1_003n,
    );
    assert.equal(attempt.receipt?.amountIn, 1_003n);
    assert.equal(attempt.failureCode, null);
  }
  assert.equal(
    repairDiagnostic?.selectedScore?.allocations.reduce(
      (sum, allocation) => sum + allocation,
      0n,
    ),
    1_003n,
  );
  assert.equal(repairDiagnostic?.authorizationReceipt?.amountIn, 1_003n);
});

void test('retains exact proposal and rejected-attempt failure progress', () => {
  const value = snapshot([
    pool('left-ac', 10_000n, 10_000n),
    pool('right-ac', 10_000n, 10_000n),
  ]);
  const context = prepareContext(value);
  const resolved = resolvedCandidate(context);
  if (!resolved.modelResolution.ok) throw new Error('Expected resolved candidate.');
  const missingRoutes = Object.freeze(ROUTES.map((route, index) => {
    const hop = route[0];
    if (hop === undefined) throw new Error('Expected one-hop route.');
    return Object.freeze([Object.freeze({
      assetIn: hop.assetIn,
      poolId: `missing-${index}`,
      assetOut: hop.assetOut,
    })]);
  }));
  const replayFailureCell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 101n,
    candidateSets: [Object.freeze({
      routes: missingRoutes,
      modelResolution: resolved.modelResolution,
    })],
    repairTargetSetIndex: 0,
  });
  const replayFailure = semanticComplete(replayFailureCell, 15);
  assertCounterPartition(replayFailure);
  const replayDiagnostic = replayFailure.diagnostics[0];
  assert.equal(replayDiagnostic?.failureCode, 'residual-options-exhausted');
  assert.ok(replayDiagnostic?.currentAttempts.every((attempt) =>
    attempt.outcome === 'rejected' &&
    attempt.failureCode === 'residual-options-exhausted' &&
    attempt.receipt === null));
  assert.ok(replayDiagnostic?.repair?.attempts.every((attempt) =>
    attempt.outcome === 'rejected' &&
    attempt.failureCode === 'repair-no-valid-neighbor' &&
    attempt.receipt === null));

  const huge = 1n << 20_000n;
  const hostileResolved = Object.freeze([
    Object.freeze([Object.freeze({
      reserveIn: 1n,
      reserveOut: huge,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    })]),
    resolved.modelResolution.resolvedRoutes[1]!,
  ]);
  const proposalFailureCell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 101n,
    candidateSets: [Object.freeze({
      routes: ROUTES,
      modelResolution: Object.freeze({
        ok: true as const,
        resolvedRoutes: hostileResolved,
      }),
    })],
    repairTargetSetIndex: 0,
  });
  const proposalFailure = semanticComplete(proposalFailureCell, 15);
  assertCounterPartition(proposalFailure);
  assert.deepEqual(proposalFailure.diagnostics[0]?.proposalFailure, {
    failureCode: 'non-finite-normalization',
    converged: false,
    completedOuterUpdates: 0,
  });
  assert.deepEqual(
    proposalFailure.setSnapshots[0]?.proposalFailure,
    proposalFailure.diagnostics[0]?.proposalFailure,
  );
  const projection = projectServiceFastSemanticResult(proposalFailure);
  const projectedDiagnostic = projection.diagnostics[0] as {
    readonly proposalFailure: unknown;
    readonly counters: unknown;
  } | undefined;
  assert.deepEqual(
    projectedDiagnostic?.proposalFailure,
    proposalFailure.diagnostics[0]?.proposalFailure,
  );
  assert.deepEqual(
    projectedDiagnostic?.counters,
    COUNTER_KEYS.map((key) => proposalFailure.diagnostics[0]?.counters[key]),
  );
});

void test('retains truthful incomplete repair evidence and never leaks a winner', () => {
  const cell = prepareCell();
  const policyIndex = 1;
  const semantic = semanticComplete(cell, policyIndex);
  const call = prepareServiceFastOperationalPolicy(
    cell,
    policyIndex,
    caps(policyIndex, { repairReplays: 1 }),
  );
  const raw = runServiceFastOperationalPolicy(call);
  assert.equal(raw.status, 'stopped');
  if (raw.status !== 'stopped') throw new Error('Expected repair stop.');
  assert.equal(raw.nextAction.actionKind, 'repair-replay');
  const snapshot = serviceFastExperimentCallSetSnapshot(call, 0);
  assert.equal(snapshot.stage, 'repair');
  assert.equal(snapshot.reconstructionDisposition, 'repair-incomplete');
  assert.equal(snapshot.repair?.complete, false);
  assert.equal(snapshot.repair?.attempts.length, 1);
  assert.equal(snapshot.repair?.winner, null);
  assert.equal(snapshot.repair?.failureCode, 'repair-work-limit');
  assert.equal(snapshot.selectedScore, null);
  assert.equal(raw.finalIncumbent, null);
  const validated = validateServiceFastDeadlinePrefix(call, raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected repair-prefix parity.');
  assert.equal(validated.value.setSnapshots[0]?.repair?.winner, null);
});

void test('repairs only the predesignated first resolved set', () => {
  const context = prepareContext(snapshot());
  const candidate = resolvedCandidate(context);
  const cell = prepareCell(101n, [candidate, candidate]);
  const outcome = semanticComplete(cell, 1);
  assert.equal(outcome.diagnostics.length, 2);
  assert.equal(outcome.diagnostics[0]?.reconstructionDisposition, 'repair-complete');
  assert.equal(outcome.diagnostics[0]?.repair?.target, true);
  assert.equal(outcome.diagnostics[1]?.reconstructionDisposition, 'current-only-nontarget');
  assert.equal(outcome.diagnostics[1]?.repair, null);
  assert.ok(outcome.counters.repairReplays <= 29);
  assert.equal(outcome.counters.authorizationReplays <= 2, true);
});

void test('fresh-replays an entry incumbent and preserves it on an objective tie', () => {
  const value = snapshot();
  const context = prepareContext(value);
  const candidate = resolvedCandidate(context);
  const firstCell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 101n,
    candidateSets: [candidate],
    repairTargetSetIndex: 0,
  });
  const first = semanticComplete(firstCell, 0);
  assert.notEqual(first.finalIncumbent, null);
  if (first.finalIncumbent === null) throw new Error('Expected initial incumbent.');
  const incumbent = first.finalIncumbent;
  const secondCell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 101n,
    entryIncumbent: incumbent,
    candidateSets: [candidate],
    repairTargetSetIndex: 0,
  });
  const second = semanticComplete(secondCell, 0);
  assert.deepEqual(second.entryIncumbent, incumbent);
  assert.deepEqual(second.finalIncumbent, incumbent);
  assert.equal(second.diagnostics[0]?.status, 'not-better');
  assert.equal(second.counters.authorizationReplays, 0);
  assert.equal(second.anyImprovement, false);
  assert.throws(
    () => prepareServiceFastExperimentCell({
      context,
      snapshotId: value.snapshotId,
      snapshotChecksum: value.snapshotChecksum,
      assetIn: 'A',
      assetOut: 'C',
      amountIn: 101n,
      entryIncumbent: Object.freeze({
        ...incumbent,
        amountOut: incumbent.amountOut + 1n,
      }),
      candidateSets: [candidate],
      repairTargetSetIndex: 0,
    }),
    TypeError,
  );
});

void test('fresh-replays each accepted entry incumbent outside candidate accounting', () => {
  const value = snapshot();
  const context = prepareContext(value);
  const cell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 101n,
    candidateSets: [resolvedCandidate(context)],
    repairTargetSetIndex: 0,
  });
  const incumbent = semanticComplete(cell, 0).finalIncumbent;
  assert.notEqual(incumbent, null);
  if (incumbent === null) throw new Error('Expected synthetic incumbent.');
  let replayCalls = 0;
  const operations = {
    replay: (
      replayContext: unknown,
      request: Parameters<ExperimentInputOperations['replay']>[1],
    ) => {
      replayCalls += 1;
      assert.equal(replayContext, context);
      assert.equal(request.amountIn, incumbent.amountIn);
      assert.deepEqual(
        request.legs.map((leg) => leg.allocation),
        incumbent.legs.map((leg) => leg.allocation),
      );
      return Object.freeze({ ok: true as const, value: incumbent });
    },
  } as unknown as ExperimentInputOperations;
  admitAcceptedEntryIncumbentReplay(context, operations, incumbent);
  assert.equal(replayCalls, 1);

  const mismatchedOperations = {
    replay: () => Object.freeze({
      ok: true as const,
      value: Object.freeze({ ...incumbent, amountOut: incumbent.amountOut + 1n }),
    }),
  } as unknown as ExperimentInputOperations;
  assert.throws(
    () => admitAcceptedEntryIncumbentReplay(context, mismatchedOperations, incumbent),
    /fresh replay differs/u,
  );
});

void test('rechecks accepted retained-record bindings without regenerating discovery or baseline', () => {
  const request = Object.freeze({
    requestId: 'synthetic-request',
    assetIn: 'A',
    assetOut: 'C',
    amountBucket: 'small',
    amountIn: '101',
    topology: 'parallel',
  });
  const suiteCase = Object.freeze({
    caseId: 'synthetic-case',
    snapshotId: 'synthetic-snapshot',
    snapshotChecksum: `sha256:${'1'.repeat(64)}`,
    serviceDecision: true,
    operational: true,
    snapshot: Object.freeze({}),
    requests: Object.freeze([request]),
  });
  const baselineCell: AcceptedJsonObject = Object.freeze({
    caseId: suiteCase.caseId,
    requestId: request.requestId,
    result: Object.freeze({
      status: 'no-route',
      reason: 'no-route',
      search: Object.freeze({ termination: 'complete' }),
    }),
  });
  const eligibilityCell = Object.freeze({
    caseId: suiteCase.caseId,
    requestId: request.requestId,
    status: 'eligible',
    reason: null,
    search: Object.freeze({
      pathExpansions: 2,
      enumeratedPaths: 2,
      pathTermination: 'complete',
      candidateSetExpansions: 1,
      enumeratedCandidateSets: 1,
      candidateSetTermination: 'complete',
    }),
    modelValidCandidateSetCount: 1,
  });
  const routes = [
    [{ poolId: 'left-ac', assetIn: 'A', assetOut: 'C' }],
    [{ poolId: 'right-ac', assetIn: 'A', assetOut: 'C' }],
  ];
  const projectedRoutes = routes.map((route, routeIndex) => ({
    routeKey: JSON.stringify(route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])),
    hops: route,
    resolvedHops: route.map((hop) => ({
      ...hop,
      reserveIn: String(10_000 + routeIndex),
      reserveOut: String(12_000 + routeIndex),
      feeChargedNumerator: '3',
      feeDenominator: '1000',
    })),
  }));
  const record: AcceptedJsonObject = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1',
    sourceIndex: 0,
    caseId: suiteCase.caseId,
    requestId: request.requestId,
    snapshot: Object.freeze({
      snapshotId: suiteCase.snapshotId,
      snapshotChecksum: suiteCase.snapshotChecksum,
    }),
    request: Object.freeze({
      assetIn: request.assetIn,
      assetOut: request.assetOut,
      amountBucket: request.amountBucket,
      amountIn: request.amountIn,
      topology: request.topology,
      maxHops: 2,
      maxRoutes: 2,
      greedyParts: 16,
    }),
    priorEligibility: Object.freeze({
      status: 'eligible',
      reason: null,
      search: eligibilityCell.search,
      modelValidCandidateSetCount: 1,
    }),
    serviceDecisionMember: true,
    amplifiedStressMember: false,
    timingCohortIndex: 0,
    entryBaseline: Object.freeze({
      boundSemanticCellHash: sha256Bytes(
        new TextEncoder().encode(JSON.stringify(baselineCell)),
      ),
      freshReplayMatchesBoundCell: true,
      incumbent: Object.freeze({
        status: 'no-route',
        reason: 'no-route',
        receipt: null,
        objective: Object.freeze({
          hasPlan: false,
          amountOut: null,
          legCount: null,
          totalHops: null,
          routeKeys: Object.freeze([]),
          allocations: Object.freeze([]),
        }),
        receiptHash: null,
      }),
    }),
    candidateDiscovery: Object.freeze({
      termination: 'complete',
      counters: Object.freeze({
        pathExpansions: 2,
        enumeratedPaths: 2,
        candidateSetExpansions: 1,
        enumeratedCandidateSets: 1,
      }),
      candidateSets: Object.freeze([Object.freeze({
        setIndex: 0,
        candidateSetKey: JSON.stringify(routes.map((route) =>
          route.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]))),
        routes: projectedRoutes,
        resolutionStatus: 'resolved',
        failureCode: null,
      })]),
    }),
    repairTargetSetIndex: 0,
    actionCeilingProfileId: 'structural-complete',
  });
  admitAcceptedRecordBindings(
    record,
    suiteCase,
    request,
    baselineCell,
    eligibilityCell,
    0,
  );

  type Mutable = Record<string, unknown>;
  const nested = (value: unknown): Mutable => value as Mutable;
  const mutations: readonly ((value: Mutable) => void)[] = [
    (value) => { value['schemaVersion'] = 'hostile'; },
    (value) => { nested(value['request'])['maxHops'] = 3; },
    (value) => { nested(value['priorEligibility'])['status'] = 'ineligible'; },
    (value) => { nested(value['entryBaseline'])['boundSemanticCellHash'] = `sha256:${'2'.repeat(64)}`; },
    (value) => { nested(value['entryBaseline'])['freshReplayMatchesBoundCell'] = false; },
    (value) => {
      nested(nested(value['entryBaseline'])['incumbent'])['reason'] = 'hostile';
    },
    (value) => {
      nested(nested(nested(value['entryBaseline'])['incumbent'])['objective'])['hasPlan'] = true;
    },
    (value) => { nested(value['candidateDiscovery'])['termination'] = 'work-limit'; },
    (value) => {
      nested(nested(value['candidateDiscovery'])['counters'])['pathExpansions'] = 122;
    },
    (value) => {
      const set = (nested(value['candidateDiscovery'])['candidateSets'] as Mutable[])[0];
      if (set !== undefined) set['candidateSetKey'] = 'hostile';
    },
    (value) => {
      const set = (nested(value['candidateDiscovery'])['candidateSets'] as Mutable[])[0];
      const route = (set?.['routes'] as Mutable[] | undefined)?.[0];
      if (route !== undefined) route['routeKey'] = 'hostile';
    },
    (value) => {
      const set = (nested(value['candidateDiscovery'])['candidateSets'] as Mutable[])[0];
      if (set !== undefined) set['failureCode'] = 'invalid-route-model';
    },
    (value) => {
      const set = (nested(value['candidateDiscovery'])['candidateSets'] as Mutable[])[0];
      const route = (set?.['routes'] as Mutable[] | undefined)?.[0];
      const resolved = (route?.['resolvedHops'] as Mutable[] | undefined)?.[0];
      if (resolved !== undefined) resolved['poolId'] = 'hostile';
    },
    (value) => { value['repairTargetSetIndex'] = null; },
    (value) => { value['actionCeilingProfileId'] = 'hostile'; },
  ];
  for (const mutate of mutations) {
    const candidate = JSON.parse(JSON.stringify(record)) as Mutable;
    mutate(candidate);
    assert.throws(
      () => admitAcceptedRecordBindings(
        candidate as AcceptedJsonObject,
        suiteCase,
        request,
        baselineCell,
        eligibilityCell,
        0,
      ),
      TypeError,
    );
  }
});

void test('keeps 255-bit amounts exact through reconstruction, repair, and authorization', () => {
  const reserve = (1n << 255n) - 19n;
  const amountIn = (1n << 255n) - 123n;
  const value = snapshot([
    pool('left-ac', reserve, reserve - 2n),
    pool('right-ac', reserve - 4n, reserve - 6n),
  ]);
  const context = prepareContext(value);
  const candidate = resolvedCandidate(context);
  const cell = prepareServiceFastExperimentCell({
    context,
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn,
    candidateSets: [candidate],
    repairTargetSetIndex: 0,
  });
  const outcome = semanticComplete(cell, 1);
  const selected = outcome.diagnostics[0]?.selectedScore;
  assert.notEqual(selected, null);
  if (selected === null || selected === undefined) {
    throw new Error('Expected a 255-bit selected score.');
  }
  assert.equal(
    selected.allocations.reduce((sum, allocation) => sum + allocation, 0n),
    amountIn,
  );
  assert.equal(selected.receipt.amountIn, amountIn);
  assert.equal(outcome.finalIncumbent?.amountIn, amountIn);
  assert.equal(outcome.diagnostics[0]?.repair?.complete, true);
  assert.ok(outcome.counters.repairReplays <= 29);
  const projection = projectServiceFastSemanticResult(outcome);
  assert.equal(projection.finalIncumbent?.amountOut.includes('e'), false);
});

void test('types unresolved sets without proposing and rejects hostile cell bounds', () => {
  const emptyCell = prepareCell(101n, []);
  for (const policyIndex of [0, 7]) {
    const empty = semanticComplete(emptyCell, policyIndex);
    assert.deepEqual(empty.diagnostics, []);
    assert.deepEqual(empty.setSnapshots, []);
    assert.equal(empty.counters.methodActions, 0);
    assert.equal(
      Object.values(empty.counters).every((value) => value === 0),
      true,
    );
    assert.equal(empty.finalIncumbent, null);
  }
  const unresolved: ServiceFastExperimentResolvedCandidateSetInput = Object.freeze({
    routes: ROUTES,
    modelResolution: Object.freeze({ ok: false as const }),
  });
  const cell = prepareCell(101n, [unresolved]);
  const outcome = semanticComplete(cell, 7);
  assert.equal(outcome.counters.proposals, 0);
  assert.equal(outcome.counters.shareActions, 0);
  assert.equal(outcome.diagnostics[0]?.status, 'model-resolution-failed');
  assert.equal(outcome.diagnostics[0]?.failureCode, 'invalid-route-model');
  assert.equal(outcome.finalIncumbent, null);
  assert.throws(
    () => prepareCell(0n, [unresolved]),
    TypeError,
  );
  assert.throws(
    () => prepareServiceFastOperationalPolicy(
      cell,
      0,
      caps(0, { shareActions: 68_641 }),
    ),
    TypeError,
  );
});

function runSyntheticGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  input?: string,
): string {
  const result = spawnSync('git', [...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    `git ${arguments_.join(' ')} failed: ${result.stderr}`,
  );
  return result.stdout;
}

async function writeSyntheticFile(
  repositoryRoot: string,
  relativePath: string,
  bytes: Uint8Array | string,
): Promise<void> {
  const destination = path.join(repositoryRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

async function syntheticInputBytes(config: FrozenServiceFastConfiguration): Promise<Uint8Array> {
  const requestSource = JSON.parse(
    await readFile(config.boundInputs['requests']!.path, 'utf8'),
  ) as {
    cases: readonly {
      caseId: string;
      requests: readonly {
        requestId: string;
        assetIn: string;
        assetOut: string;
        amountBucket: string;
        topology: string;
      }[];
    }[];
  };
  const eligibilitySource = JSON.parse(
    await readFile(config.boundInputs['baselineEligibility']!.path, 'utf8'),
  ) as {
    cells: readonly {
      caseId: string;
      requestId: string;
      status: 'eligible' | 'ineligible';
      reason?: 'baseline-no-authorized-incumbent' | 'no-model-valid-candidate-set';
      search: Record<string, unknown>;
      modelValidCandidateSetCount: number;
    }[];
  };
  const requests = requestSource.cases.flatMap((suiteCase) =>
    suiteCase.requests.map((request) => ({ caseId: suiteCase.caseId, request })));
  const eligibilityByIdentity = new Map(eligibilitySource.cells.map((cell) => [
    `${cell.caseId}\0${cell.requestId}`,
    cell,
  ]));
  const operationalCases = new Set(
    config.cohorts.cases.filter((suiteCase) => suiteCase.operational).map((suiteCase) => suiteCase.caseId),
  );
  const stratumCounts = new Map<string, number>();
  let timingIndex = 0;
  const lines: string[] = [];
  for (const [sourceIndex, source] of requests.entries()) {
    const suiteCase = config.cohorts.cases.find((candidate) => candidate.caseId === source.caseId)!;
    const eligibility = eligibilityByIdentity.get(`${source.caseId}\0${source.request.requestId}`)!;
    const stratum = `${source.caseId}\0${source.request.topology}\0${source.request.amountBucket}`;
    const priorStratumCount = stratumCounts.get(stratum) ?? 0;
    const retained = operationalCases.has(source.caseId) && priorStratumCount < 12;
    if (operationalCases.has(source.caseId)) stratumCounts.set(stratum, priorStratumCount + 1);
    const timingCohortIndex = retained ? timingIndex++ : null;
    const amountIn = '9'.repeat(83);
    const candidateHops = [0, 1].map((routeIndex) => ({
      poolId: `candidate-pool-${sourceIndex}-${routeIndex}`,
      assetIn: source.request.assetIn,
      assetOut: source.request.assetOut,
    }));
    const candidateRouteKeys = candidateHops.map((candidateHop) => JSON.stringify([
      [candidateHop.assetIn, candidateHop.poolId, candidateHop.assetOut],
    ]));
    const resolvedCandidate = sourceIndex === 1;
    let incumbent: Record<string, unknown> = {
      status: 'no-route',
      reason: 'no-route',
      receipt: null,
      objective: {
        hasPlan: false,
        amountOut: null,
        legCount: null,
        totalHops: null,
        routeKeys: [],
        allocations: [],
      },
      receiptHash: null,
    };
    if (sourceIndex === 0) {
      const poolId = 'receipt-pool-0';
      const reserveInBefore = `1${'0'.repeat(84)}`;
      const reserveInAfter = (BigInt(reserveInBefore) + BigInt(amountIn)).toString(10);
      const routeKey = JSON.stringify([[source.request.assetIn, poolId, source.request.assetOut]]);
      const receipt = {
        snapshotId: suiteCase.snapshotId,
        snapshotChecksum: suiteCase.snapshotChecksum,
        assetIn: source.request.assetIn,
        assetOut: source.request.assetOut,
        amountIn,
        amountOut: '1',
        legs: [{
          allocation: amountIn,
          receipt: {
            snapshotId: suiteCase.snapshotId,
            snapshotChecksum: suiteCase.snapshotChecksum,
            assetIn: source.request.assetIn,
            assetOut: source.request.assetOut,
            amountIn,
            amountOut: '1',
            hops: [{
              poolId,
              assetIn: source.request.assetIn,
              assetOut: source.request.assetOut,
              amountIn,
              amountOut: '1',
              reserveInBefore,
              reserveOutBefore: '100',
              reserveInAfter,
              reserveOutAfter: '99',
            }],
          },
        }],
      };
      incumbent = {
        status: 'success',
        reason: null,
        receipt,
        objective: {
          hasPlan: true,
          amountOut: '1',
          legCount: 1,
          totalHops: 1,
          routeKeys: [routeKey],
          allocations: [amountIn],
        },
        receiptHash: sha256Bytes(new TextEncoder().encode(JSON.stringify(receipt))),
      };
    }
    lines.push(JSON.stringify({
      schemaVersion: 'routelab.service-fast-numerical-experiment-input.v1',
      sourceIndex,
      caseId: source.caseId,
      requestId: source.request.requestId,
      snapshot: {
        snapshotId: suiteCase.snapshotId,
        snapshotChecksum: suiteCase.snapshotChecksum,
      },
      request: {
        assetIn: source.request.assetIn,
        assetOut: source.request.assetOut,
        amountBucket: source.request.amountBucket,
        amountIn,
        topology: source.request.topology,
        maxHops: config.inputConstruction.request.maxHops,
        maxRoutes: config.inputConstruction.request.maxRoutes,
        greedyParts: config.inputConstruction.request.greedyParts,
      },
      priorEligibility: {
        status: eligibility.status,
        reason: eligibility.reason ?? null,
        search: eligibility.search,
        modelValidCandidateSetCount: eligibility.modelValidCandidateSetCount,
      },
      serviceDecisionMember: suiteCase.serviceDecision,
      amplifiedStressMember: !suiteCase.serviceDecision,
      timingCohortIndex,
      entryBaseline: {
        boundSemanticCellHash: `sha256:${'2'.repeat(64)}`,
        freshReplayMatchesBoundCell: true,
        incumbent,
      },
      candidateDiscovery: {
        termination: 'complete',
        counters: {
          pathExpansions: 0,
          enumeratedPaths: 0,
          candidateSetExpansions: 1,
          enumeratedCandidateSets: 1,
        },
        candidateSets: [{
          setIndex: 0,
          candidateSetKey: JSON.stringify(candidateRouteKeys.map((routeKey) =>
            JSON.parse(routeKey) as unknown)),
          routes: candidateHops.map((candidateHop, routeIndex) => ({
            routeKey: candidateRouteKeys[routeIndex],
            hops: [candidateHop],
            resolvedHops: resolvedCandidate
              ? [{
                ...candidateHop,
                reserveIn: '100',
                reserveOut: '100',
                feeChargedNumerator: '3',
                feeDenominator: '1000',
              }]
              : null,
          })),
          resolutionStatus: resolvedCandidate ? 'resolved' : 'failed',
          failureCode: resolvedCandidate ? null : 'invalid-route-model',
        }],
      },
      repairTargetSetIndex: resolvedCandidate ? 0 : null,
      actionCeilingProfileId: config.inputConstruction.workProfile.profileId,
    }));
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

function mutateSyntheticInput(
  bytes: Uint8Array,
  mutate: (record: Record<string, unknown>) => void,
  sourceIndex = 0,
): Uint8Array {
  const lines = new TextDecoder().decode(bytes).slice(0, -1).split('\n');
  const record = JSON.parse(lines[sourceIndex] ?? '') as Record<string, unknown>;
  mutate(record);
  lines[sourceIndex] = JSON.stringify(record);
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

interface SyntheticClosureRepository {
  readonly root: string;
  readonly implementationRevision: string;
  readonly config: FrozenServiceFastConfiguration;
  readonly reviewedInputBinding: ReviewedInputBinding;
}

const SYNTHETIC_DURABLE_ENTRY =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/entry.ts';
const SYNTHETIC_DURABLE_HOST_ADMISSION =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/host-admission.ts';
const SYNTHETIC_DURABLE_OTHER_SOURCE =
  'src/benchmark/service-fast-numerical-experiment/artifact-verifier/other.ts';
const SYNTHETIC_RETAINED_DIRECTORY =
  'datasets/experiments/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1/service-fast-numerical-v1';
const SYNTHETIC_RETAINED_FILES = Object.freeze([
  'inputs.ndjson',
  'semantic-results.ndjson',
  'call-timing-observations.ndjson',
  'incumbent-timeline-observations.ndjson',
  'deadline-observations.ndjson',
  'analysis.json',
  'manifest.json',
  'README.md',
]);

function syntheticDurableRuntimeProfileSource(
  overrides: {
    readonly entryRoots?: readonly string[];
    readonly projectSources?: readonly string[];
  } = {},
): string {
  const projectSources = overrides.projectSources ?? [
    SYNTHETIC_DURABLE_ENTRY,
    SYNTHETIC_DURABLE_HOST_ADMISSION,
  ];
  const record = {
    profileId: 'service-fast-artifact-verifier-runtime-v1',
    entryRoots: overrides.entryRoots ?? [SYNTHETIC_DURABLE_ENTRY],
    projectSources,
    nodeBuiltins: ['node:os', 'node:process'],
    pathCapabilities: projectSources.map((sourcePath) => ({
      path: sourcePath,
      builtins: sourcePath === SYNTHETIC_DURABLE_HOST_ADMISSION
        ? ['node:os', 'node:process']
        : [],
      capabilities: [],
    })),
  };
  return [
    'const SERVICE_FAST_ARTIFACT_VERIFIER_RUNTIME_PROFILE_RECORD =',
    `  '${JSON.stringify(record)}';`,
    'void SERVICE_FAST_ARTIFACT_VERIFIER_RUNTIME_PROFILE_RECORD;',
    '',
  ].join('\n');
}

function syntheticDurableHostAdmissionSource(): string {
  return [
    "import { availableParallelism, cpus, endianness, release, type } from 'node:os';",
    "import { arch, env, execArgv, platform, version, versions } from 'node:process';",
    'const parallelism = availableParallelism();',
    'const processors = cpus();',
    'const byteOrder = endianness();',
    'const osRelease = release();',
    'const osType = type();',
    "const nodeOptions = env['NODE_OPTIONS'];",
    'const runtimeVersions = versions;',
    'void [parallelism, processors, byteOrder, osRelease, osType, arch, execArgv, platform, version, runtimeVersions, nodeOptions];',
    '',
  ].join('\n');
}

async function createSyntheticClosureRepository(
  bindingState: 'reviewed' | 'pending' | 'mismatch' = 'reviewed',
): Promise<SyntheticClosureRepository> {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-source-closure-repo-'));
  runSyntheticGit(root, ['init', '--quiet', '--initial-branch=main']);
  runSyntheticGit(root, ['config', 'user.email', 'source-closure@example.invalid']);
  runSyntheticGit(root, ['config', 'user.name', 'Source Closure Test']);
  const configBytes = Uint8Array.from(await readFile(SERVICE_FAST_CONFIG_PATH));
  const config = parseFrozenServiceFastConfiguration(configBytes);

  const copyPaths = new Set<string>([
    SERVICE_FAST_CONFIG_PATH,
    config.artifactSchema.path,
    ...Object.values(config.authorityBindings).map((descriptor) => descriptor.path),
    ...config.artifacts.sourceClosure.protectedPaths,
    ...SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS,
    ...SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS,
  ]);
  for (const relativePath of copyPaths) {
    await writeSyntheticFile(root, relativePath, Uint8Array.from(await readFile(relativePath)));
  }
  const inputBytes = await syntheticInputBytes(config);
  await writeSyntheticFile(root, config.inputConstruction.inputArtifact.path, inputBytes);
  const reviewedInputBinding: ReviewedInputBinding = Object.freeze({
    status: 'reviewed',
    path: config.inputConstruction.inputArtifact.path,
    bytes: inputBytes.byteLength + (bindingState === 'mismatch' ? 1 : 0),
    sha256: sha256Bytes(inputBytes),
  });
  if (bindingState !== 'pending') {
    const bindingSourcePath = path.join(root, SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH);
    const pendingSource = await readFile(bindingSourcePath, 'utf8');
    const reviewedSource = pendingSource.replace(
      '{"status":"pending"}',
      JSON.stringify(reviewedInputBinding),
    );
    assert.notEqual(reviewedSource, pendingSource);
    await writeFile(bindingSourcePath, reviewedSource);
  }
  for (const requiredFile of config.artifacts.sourceClosure.requiredFiles) {
    if (copyPaths.has(requiredFile) || requiredFile === config.inputConstruction.inputArtifact.path) {
      continue;
    }
    await writeSyntheticFile(root, requiredFile, `export {};\n// ${requiredFile}\n`);
  }
  await writeSyntheticFile(
    root,
    'src/allocation/service-fast-path-shadow-price/synthetic.ts',
    'export const candidate = 1;\n',
  );
  await writeSyntheticFile(
    root,
    'src/allocation/bounded-exact-split-repair/synthetic.ts',
    'export const repair = 1;\n',
  );
  await writeSyntheticFile(
    root,
    SYNTHETIC_DURABLE_ENTRY,
    "import './host-admission.ts';\nexport {};\n",
  );
  await writeSyntheticFile(
    root,
    SYNTHETIC_DURABLE_HOST_ADMISSION,
    syntheticDurableHostAdmissionSource(),
  );
  await writeSyntheticFile(
    root,
    SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH,
    syntheticDurableRuntimeProfileSource(),
  );
  runSyntheticGit(root, ['add', '--all']);
  runSyntheticGit(root, ['commit', '--quiet', '-m', 'RLT-087 Synthetic implementation input']);
  return Object.freeze({
    root,
    implementationRevision: runSyntheticGit(root, ['rev-parse', 'HEAD']).trim(),
    config,
    reviewedInputBinding: bindingState === 'pending'
      ? Object.freeze({ status: 'pending' as const })
      : reviewedInputBinding,
  });
}

void test('decodes only the canonical data-only durable runtime profile', () => {
  const source = syntheticDurableRuntimeProfileSource();
  const decoded = decodeServiceFastDurableRuntimeProfileSource(
    new TextEncoder().encode(source),
  );
  assert.equal(decoded.profileId, 'service-fast-artifact-verifier-runtime-v1');
  assert.deepEqual(decoded.entryRoots, [SYNTHETIC_DURABLE_ENTRY]);
  assert.deepEqual(decoded.projectSources, [
    SYNTHETIC_DURABLE_ENTRY,
    SYNTHETIC_DURABLE_HOST_ADMISSION,
  ]);
  for (const hostile of [
    source.replace('"capabilities":[]', '"capabilities":["fixed-child-dispatch"]'),
    source.replace(
      '"nodeBuiltins":["node:os","node:process"]',
      '"nodeBuiltins":["node:child_process","node:os","node:process"]',
    ),
    syntheticDurableRuntimeProfileSource({
      projectSources: [SYNTHETIC_DURABLE_ENTRY],
    }),
    `${source}export {};\n`,
  ]) {
    assert.throws(
      () => decodeServiceFastDurableRuntimeProfileSource(new TextEncoder().encode(hostile)),
      ServiceFastDurableRuntimeProfileError,
    );
  }
});

void test('rejects substituted or multiple durable entry roots before child dispatch', async () => {
  const projectSources = [
    SYNTHETIC_DURABLE_ENTRY,
    SYNTHETIC_DURABLE_HOST_ADMISSION,
    SYNTHETIC_DURABLE_OTHER_SOURCE,
  ];
  const hostileSources = [
    syntheticDurableRuntimeProfileSource({
      entryRoots: [SYNTHETIC_DURABLE_OTHER_SOURCE],
      projectSources,
    }),
    syntheticDurableRuntimeProfileSource({
      entryRoots: [SYNTHETIC_DURABLE_ENTRY, SYNTHETIC_DURABLE_OTHER_SOURCE],
      projectSources,
    }),
  ];
  let spawnCount = 0;
  for (const hostileSource of hostileSources) {
    const hostileBytes = new TextEncoder().encode(hostileSource);
    assert.throws(
      () => decodeServiceFastDurableRuntimeProfileSource(hostileBytes),
      (error: unknown) =>
        error instanceof ServiceFastDurableRuntimeProfileError &&
        error.code === 'invalid-durable-runtime-profile',
    );
    await assert.rejects(
      dispatchServiceFastVerifierChild([], path.resolve('/tmp/rlt087-fixed-root'), {
        execPath: process.execPath,
        execArgv: Object.freeze([]),
        nodeOptions: undefined,
        authenticateDurableVerifier: () => {
          decodeServiceFastDurableRuntimeProfileSource(hostileBytes);
          return Promise.resolve();
        },
        spawn: () => {
          spawnCount += 1;
          return { status: 0, signal: null };
        },
      }),
      (error: unknown) =>
        error instanceof ServiceFastDurableRuntimeProfileError &&
        error.code === 'invalid-durable-runtime-profile',
    );
    assert.equal(spawnCount, 0, 'invalid durable entry roots reached child dispatch');
  }
});

void test('admits bounded identity and aggregate sizes before runtime file reads', async () => {
  const hash = `sha256:${'a'.repeat(64)}`;
  assert.doesNotThrow(() => admitServiceFastAttestedRuntimeDescriptorBytes([
    { path: 'src/a.ts', bytes: 32 * 1_048_576, sha256: hash },
    { path: 'src/b.ts', bytes: 32 * 1_048_576, sha256: hash },
  ]));
  assert.throws(
    () => admitServiceFastAttestedRuntimeDescriptorBytes([
      { path: 'src/a.ts', bytes: 64 * 1_048_576, sha256: hash },
      { path: 'src/b.ts', bytes: 1, sha256: hash },
    ]),
    (error: unknown) =>
      error instanceof ServiceFastDurableBootstrapError &&
      error.code === 'bootstrap-runtime-byte-cap-exceeded',
  );

  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-bounded-identity-'));
  try {
    const relativePath = 'oversized.ts';
    const absolutePath = path.join(root, relativePath);
    await writeFile(absolutePath, 'x');
    await truncate(absolutePath, 64 * 1_048_576 + 1);
    await assert.rejects(
      readBoundedIdentityFile({
        repositoryRoot: root,
        relativePath,
        maximumBytes: 64 * 1_048_576,
      }),
      (error: unknown) =>
        error instanceof ServiceFastBoundedIdentityReadError &&
        error.code === 'bounded-file-admission-failure',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('authenticates before dispatching only the exact two verifier forms', async () => {
  const calls: {
    executable: string;
    arguments_: readonly string[];
    options: SpawnSyncOptions;
  }[] = [];
  const authenticatedRoots: string[] = [];
  const repositoryRoot = path.resolve('/tmp/rlt087-fixed-root');
  const dependencies = {
    execPath: process.execPath,
    execArgv: Object.freeze([]),
    nodeOptions: undefined,
    authenticateDurableVerifier: (root: string) => {
      authenticatedRoots.push(root);
      return Promise.resolve();
    },
    spawn: (
      executable: string,
      arguments_: readonly string[],
      options: SpawnSyncOptions,
    ) => {
      calls.push({ executable, arguments_, options });
      return { status: 0, signal: null };
    },
  };
  assert.deepEqual(await dispatchServiceFastVerifierChild([], repositoryRoot, dependencies), {
    status: 0,
    signal: null,
  });
  assert.deepEqual(authenticatedRoots, [repositoryRoot]);
  assert.deepEqual(calls[0], {
    executable: process.execPath,
    arguments_: [path.join(repositoryRoot, SERVICE_FAST_ARTIFACT_VERIFIER_HELPER)],
    options: { cwd: repositoryRoot, stdio: 'inherit', shell: false },
  });
  const revision = 'a'.repeat(40);
  assert.deepEqual(
    await dispatchServiceFastVerifierChild(
      ['--generate-source-closure', revision],
      repositoryRoot,
      dependencies,
    ),
    { status: 0, signal: null },
  );
  assert.deepEqual(calls[1]?.arguments_, [
    path.join(repositoryRoot, SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER),
    revision,
  ]);
  assert.equal(Object.hasOwn(calls[1]?.options ?? {}, 'env'), false);
  assert.deepEqual(authenticatedRoots, [repositoryRoot]);

  for (const hostileEnvironment of [
    { execArgv: ['--inspect'], nodeOptions: undefined },
    { execArgv: [] as string[], nodeOptions: '--require=hostile.js' },
    { execArgv: [] as string[], nodeOptions: ' ' },
  ]) {
    const before = calls.length;
    await assert.rejects(
      dispatchServiceFastVerifierChild([], repositoryRoot, {
        ...dependencies,
        ...hostileEnvironment,
      }),
      ServiceFastVerifierInvocationError,
    );
    assert.equal(calls.length, before, 'hostile Node environment launched a helper');
  }

  for (const invalid of [
    ['--generate-source-closure'],
    ['--generate-source-closure', 'A'.repeat(40)],
    ['--generate-source-closure', 'a'.repeat(39)],
    ['--generate-source-closure', revision, 'extra'],
    ['--unknown'],
    [''],
  ]) {
    const before = calls.length;
    await assert.rejects(
      dispatchServiceFastVerifierChild(invalid, repositoryRoot, dependencies),
      ServiceFastVerifierInvocationError,
    );
    assert.equal(calls.length, before, 'invalid invocation launched a helper');
  }
});

void test('derives normalized real CLI roots without a trailing separator', () => {
  const repositoryRoot = process.cwd();
  const verifierUrl = pathToFileURL(path.join(
    repositoryRoot,
    'cli/verify-service-fast-numerical-experiment.ts',
  )).href;
  const generationUrl = pathToFileURL(path.join(
    repositoryRoot,
    SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER,
  )).href;
  assert.equal(serviceFastVerifierRepositoryRoot(verifierUrl), repositoryRoot);
  assert.equal(serviceFastSourceClosureRepositoryRoot(generationUrl), repositoryRoot);
  assert.equal(path.resolve(serviceFastVerifierRepositoryRoot(verifierUrl)), repositoryRoot);
});

void test('returns the fixed child exit or signal disposition without reinterpretation', async () => {
  const repositoryRoot = path.resolve('/tmp/rlt087-fixed-root');
  const authenticateDurableVerifier = async (): Promise<void> => {};
  const exit = await dispatchServiceFastVerifierChild([], repositoryRoot, {
    execPath: process.execPath,
    execArgv: Object.freeze([]),
    nodeOptions: '',
    authenticateDurableVerifier,
    spawn: () => ({ status: 73, signal: null }),
  });
  assert.deepEqual(exit, { status: 73, signal: null });
  const signal = await dispatchServiceFastVerifierChild([], repositoryRoot, {
    execPath: process.execPath,
    execArgv: Object.freeze([]),
    nodeOptions: undefined,
    authenticateDurableVerifier,
    spawn: () => ({ status: null, signal: 'SIGTERM' }),
  });
  assert.deepEqual(signal, { status: null, signal: 'SIGTERM' });
  await assert.rejects(
    dispatchServiceFastVerifierChild([], repositoryRoot, {
      execPath: process.execPath,
      execArgv: Object.freeze([]),
      nodeOptions: undefined,
      authenticateDurableVerifier,
      spawn: () => ({ status: 1, signal: 'SIGTERM' }),
    }),
    /both an exit status and signal/u,
  );
  for (const result of [
    { status: null, signal: null },
    { status: -1, signal: null },
    { status: Number.NaN, signal: null },
  ] as const) {
    await assert.rejects(
      dispatchServiceFastVerifierChild([], repositoryRoot, {
        execPath: process.execPath,
        execArgv: Object.freeze([]),
        nodeOptions: undefined,
        authenticateDurableVerifier,
        spawn: () => result,
      }),
      /no valid exit status/u,
    );
  }
});

void test('projects closed CLI failures without arbitrary exception or OS text', () => {
  const secret = 'raw-os-detail-must-not-escape';
  assert.deepEqual(projectServiceFastToolFailure(new Error(secret), 'preflight'), {
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'preflight',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  });
  const hostileGetter = Object.defineProperty({}, 'code', {
    get: () => { throw new Error(secret); },
  });
  assert.deepEqual(projectServiceFastToolFailure(hostileGetter, 'verification'), {
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'verification',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  });
  const repositorySpoof = {
    code: 'revision-mismatch',
    toolFailureFamily: 'repository',
    committed: true,
    secondaryCleanupCode: 'precommit-owned-temp-cleanup-failure',
  };
  assert.deepEqual(projectServiceFastToolFailure(repositorySpoof, 'verification'), {
    ok: false,
    cause: 'repository-state-mismatch',
    phase: 'preflight',
    detailCode: 'repository-state-mismatch',
    committed: false,
    secondaryCleanup: null,
  });
  const unknownPublicationSpoof = {
    code: 'not-a-frozen-publication-code',
    toolFailureFamily: 'publication',
    committed: true,
    secondaryCleanupCode: 'provisional-destination-cleanup-failure',
  };
  assert.deepEqual(projectServiceFastToolFailure(unknownPublicationSpoof, 'verification'), {
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'publication-precommit',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  });
  const structuralPostcommitSpoof = {
    code: 'postcommit-parent-sync-failure',
    toolFailureFamily: 'publication',
    committed: true,
    secondaryCleanupCode: 'postcommit-owned-temp-cleanup-failure',
  };
  assert.deepEqual(projectServiceFastToolFailure(structuralPostcommitSpoof, 'verification'), {
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'publication-precommit',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  });
  const publicationGetterSpoof = Object.defineProperties({}, {
    code: { value: 'temp-write-failure' },
    toolFailureFamily: { value: 'publication' },
    committed: { get: () => { throw new Error(secret); } },
    secondaryCleanupCode: { get: () => { throw new Error(secret); } },
  });
  assert.deepEqual(projectServiceFastToolFailure(publicationGetterSpoof, 'verification'), {
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'publication-precommit',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  });
  const launch = encodeProjectedServiceFastToolFailure(
    new ServiceFastVerifierDispatchError(secret),
    'verification',
  );
  assert.equal(launch.includes(secret), false);
  assert.deepEqual(JSON.parse(launch), {
    ok: false,
    cause: 'unexpected-tool-exception',
    phase: 'invocation',
    detailCode: 'unexpected-tool-exception',
    committed: false,
    secondaryCleanup: null,
  });

  for (const [entry, arguments_] of [
    ['cli/verify-service-fast-numerical-experiment.ts', ['--unknown']],
    [SERVICE_FAST_SOURCE_CLOSURE_GENERATOR_HELPER, ['BAD-REVISION']],
  ] as const) {
    const result = spawnSync(process.execPath, [entry, ...arguments_], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      shell: false,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      cause: 'invalid-invocation',
      phase: 'invocation',
      detailCode: 'invalid-invocation',
      committed: false,
      secondaryCleanup: null,
    });
  }
});

void test('maps every publication detail code exactly into the closed failure wire', () => {
  assert.deepEqual(
    [...Object.keys(SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION)].sort(),
    [...SERVICE_FAST_SOURCE_CLOSURE_PUBLICATION_ERROR_CODES].sort(),
  );
  const postcommitCodes = new Set([
    'postcommit-file-close-failure',
    'postcommit-parent-sync-failure',
    'postcommit-parent-close-failure',
    'postcommit-owned-temp-cleanup-failure',
    'postcommit-temp-unlink-sync-failure',
    'postcommit-cleanup-parent-close-failure',
    'provisional-destination-cleanup-failure',
  ]);
  for (const detailCode of SERVICE_FAST_SOURCE_CLOSURE_PUBLICATION_ERROR_CODES) {
    const expected = SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION[
      detailCode as keyof typeof SERVICE_FAST_PUBLICATION_FAILURE_PROJECTION
    ];
    assert.ok(expected !== undefined);
    const committed = postcommitCodes.has(detailCode);
    const projected = projectServiceFastToolFailure(
      new SourceClosurePublicationError(detailCode, 'artifact', 'raw detail', !committed),
      'verification',
    );
    assert.deepEqual(Object.keys(projected), [
      'ok',
      'cause',
      'phase',
      'detailCode',
      'committed',
      'secondaryCleanup',
    ]);
    assert.equal(projected.cause, expected[0]);
    assert.equal(projected.phase, expected[1]);
    assert.equal(projected.detailCode, expected[0]);
    assert.equal(projected.committed, committed);
    assert.equal(projected.secondaryCleanup, null);
  }
  const primaryWithCleanup = new SourceClosurePublicationError(
    'temp-write-failure',
    'artifact',
    'raw primary',
    false,
    'precommit-owned-temp-cleanup-failure',
  );
  assert.deepEqual(
    projectServiceFastToolFailure(primaryWithCleanup, 'verification').secondaryCleanup,
    {
      cause: 'owned-staging-cleanup-failure',
      detailCode: 'owned-staging-cleanup-failure',
    },
  );
  for (const hostile of [
    new SourceClosurePublicationError(
      'temp-write-failure',
      'artifact',
      'raw primary',
      true,
      'provisional-destination-cleanup-failure',
    ),
    new SourceClosurePublicationError(
      'postcommit-parent-sync-failure',
      'artifact',
      'raw primary',
      false,
      'precommit-owned-temp-cleanup-failure',
    ),
  ]) {
    assert.equal(
      projectServiceFastToolFailure(hostile, 'verification').secondaryCleanup,
      null,
    );
  }
  const primaryWithProvisionalCleanup = new SourceClosurePublicationError(
    'postlink-identity-mismatch',
    'artifact',
    'raw primary',
    true,
    'provisional-destination-cleanup-failure',
  );
  assert.deepEqual(
    projectServiceFastToolFailure(primaryWithProvisionalCleanup, 'verification'),
    {
      ok: false,
      cause: 'artifact-write-failure',
      phase: 'publication-precommit',
      detailCode: 'artifact-write-failure',
      committed: true,
      secondaryCleanup: {
        cause: 'provisional-destination-cleanup-failure',
        detailCode: 'provisional-destination-cleanup-failure',
      },
    },
  );
});

void test('defaults source-closure generation closed on pending or mismatched reviewed input', async () => {
  for (const bindingState of ['pending', 'mismatch'] as const) {
    const fixture = await createSyntheticClosureRepository(bindingState);
    try {
      await assert.rejects(
        prepareServiceFastSourceClosure(
          fixture.root,
          fixture.implementationRevision,
        ),
        (error: unknown) =>
          error instanceof ServiceFastReviewedInputBindingError &&
          error.code === (bindingState === 'pending'
            ? 'reviewed-input-binding-pending'
            : 'reviewed-input-binding-mismatch') &&
          error.toolFailureFamily === 'repository',
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

void test('derives and publishes one canonical revision-tree source closure after size admission', async () => {
  const fixture = await createSyntheticClosureRepository();
  try {
    const result = await generateServiceFastSourceClosure(
      fixture.root,
      fixture.implementationRevision,
    );
    const closurePath = path.join(
      fixture.root,
      fixture.config.artifacts.sourceClosure.path,
    );
    assert.deepEqual(Uint8Array.from(await readFile(closurePath)), result.bytes);
    assert.equal(
      new TextDecoder().decode(result.bytes),
      `${JSON.stringify(result.closure, null, 2)}\n`,
    );
    assert.ok(result.bytes.byteLength <= fixture.config.artifacts.sourceClosure.maxBytes);
    assert.deepEqual(
      result.closure.protectedSources.map((entry) => entry.path),
      fixture.config.artifacts.sourceClosure.protectedPaths,
    );
    assert.equal(
      new Set(result.closure.sources.map((entry) => entry.path)).size,
      result.closure.sources.length,
    );
    const candidate = result.closure.sources.find((entry) =>
      entry.path === 'src/allocation/service-fast-path-shadow-price/synthetic.ts');
    assert.deepEqual(candidate?.roles, ['candidate']);
    const benchmark = result.closure.sources.find((entry) =>
      entry.path.endsWith('/source-closure/generate.ts'));
    assert.deepEqual(benchmark?.roles, ['evaluator', 'input-builder']);
    const verifierCli = result.closure.sources.find((entry) =>
      entry.path === 'cli/verify-service-fast-numerical-experiment.ts');
    assert.deepEqual(verifierCli?.roles, ['artifact-verifier']);
    for (const descriptor of [
      result.closure.config,
      result.closure.artifactSchema,
      result.closure.inputArtifact,
      ...result.closure.sources,
      ...result.closure.protectedSources,
    ]) {
      const revisionBytes = runSyntheticGit(
        fixture.root,
        ['show', `${fixture.implementationRevision}:${descriptor.path}`],
      );
      const bytes = new TextEncoder().encode(revisionBytes);
      assert.equal(bytes.byteLength, descriptor.bytes);
      assert.equal(sha256Bytes(bytes), descriptor.sha256);
    }
    assert.ok(
      result.sizeAdmission.maximumDirectoryBytes <=
        result.sizeAdmission.directoryCapBytes,
    );
    assert.equal(result.sizeAdmission.artifacts.length, 8);
    assert.ok(result.sizeAdmission.artifacts.every((artifact) =>
      artifact.maximumBytes <= artifact.capBytes));
    const schema = JSON.parse(
      await readFile(fixture.config.artifactSchema.path, 'utf8'),
    ) as { objectSchemas: readonly { schemaId: string; fields: readonly [string, string][] }[] };
    const analysisSchema = schema.objectSchemas.find((value) => value.schemaId === 'Analysis');
    const manifestSchema = schema.objectSchemas.find((value) => value.schemaId === 'Manifest');
    assert.deepEqual(
      Object.keys(result.sizeAdmission.dryAnalysis),
      analysisSchema?.fields.map(([field]) => field),
    );
    assert.deepEqual(
      Object.keys(result.sizeAdmission.dryManifest),
      manifestSchema?.fields.map(([field]) => field),
    );
    const manifestArtifacts = result.sizeAdmission.dryManifest['artifacts'] as readonly {
      name: string;
      contentRole: string;
    }[];
    assert.deepEqual(
      manifestArtifacts.map(({ name, contentRole }) => [name, contentRole]),
      [
        ['inputs.ndjson', 'input'],
        ['semantic-results.ndjson', 'semantic'],
        ['call-timing-observations.ndjson', 'call-timing'],
        ['incumbent-timeline-observations.ndjson', 'incumbent-timeline'],
        ['deadline-observations.ndjson', 'deadline'],
        ['analysis.json', 'analysis'],
        ['README.md', 'readme'],
      ],
    );
    assert.equal(manifestArtifacts.some(({ name }) => name === 'manifest.json'), false);
    const dryDecision = result.sizeAdmission.dryAnalysis['decision'];
    const rankedPolicyIds = fixture.config.policyMatrix.policyIds.slice(1);
    const decisionShapes = [
      {
        status: 'selected-policy',
        policyId: rankedPolicyIds[0],
        fallbackDecisionId: null,
        rankedQualifyingPolicyIds: rankedPolicyIds,
        reason: 'highest-ranked-qualifying-policy',
      },
      {
        status: 'strict-reference-fallback',
        policyId: null,
        fallbackDecisionId: 'strict-reference-fallback',
        rankedQualifyingPolicyIds: [],
        reason: 'trustworthy-complete-no-policy-qualified',
      },
      {
        status: 'rejected-observation',
        policyId: null,
        fallbackDecisionId: null,
        rankedQualifyingPolicyIds: [],
        reason: 'incomplete-or-untrustworthy-observation',
      },
    ];
    assert.ok(decisionShapes.every((decisionShape) =>
      JSON.stringify(dryDecision).length >= JSON.stringify(decisionShape).length));
    assert.equal(
      decodeServiceFastSourceClosure(result.bytes, fixture.config).implementationInputRevision,
      fixture.implementationRevision,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('keeps durable blob verification separate from the exact one-child execution gate', async () => {
  const fixture = await createSyntheticClosureRepository();
  try {
    const generated = await generateServiceFastSourceClosure(
      fixture.root,
      fixture.implementationRevision,
    );
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(fixture.root, generated.bytes),
      /No direct child/u,
    );
    await assert.rejects(
      verifyExecutableServiceFastSourceClosure(fixture.root, generated.bytes),
      /direct child/u,
    );
    runSyntheticGit(fixture.root, ['add', fixture.config.artifacts.sourceClosure.path]);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Add synthetic closure']);
    await assert.doesNotReject(
      authenticateServiceFastDurableVerifierBeforeDispatch(fixture.root),
    );
    assert.equal(
      (await verifyExecutableServiceFastSourceClosure(fixture.root, generated.bytes))
        .closure.implementationInputRevision,
      fixture.implementationRevision,
    );
    for (const retainedFile of SYNTHETIC_RETAINED_FILES) {
      await writeSyntheticFile(
        fixture.root,
        `${SYNTHETIC_RETAINED_DIRECTORY}/${retainedFile}`,
        `${retainedFile}\n`,
      );
    }
    await assert.doesNotReject(
      authenticateServiceFastDurableVerifierBeforeDispatch(fixture.root),
    );
    await assert.rejects(
      verifyExecutableServiceFastSourceClosure(fixture.root, generated.bytes),
      /clean index and worktree/u,
    );
    const ninthRetainedPath = `${SYNTHETIC_RETAINED_DIRECTORY}/ninth-file.txt`;
    await writeSyntheticFile(fixture.root, ninthRetainedPath, 'ninth\n');
    await assert.rejects(
      authenticateServiceFastDurableVerifierBeforeDispatch(fixture.root),
      (error: unknown) =>
        error instanceof ServiceFastDurableBootstrapError &&
        error.code === 'bootstrap-repository-state-mismatch',
    );
    await rm(path.join(fixture.root, ninthRetainedPath));

    await writeSyntheticFile(fixture.root, SYNTHETIC_DURABLE_ENTRY, 'export const changed = true;\n');
    await assert.rejects(
      authenticateServiceFastDurableVerifierBeforeDispatch(fixture.root),
      (error: unknown) =>
        error instanceof ServiceFastDurableBootstrapError &&
        error.code === 'bootstrap-repository-state-mismatch',
    );
    await writeSyntheticFile(fixture.root, SYNTHETIC_DURABLE_ENTRY, 'export {};\n');
    await writeSyntheticFile(fixture.root, SYNTHETIC_DURABLE_ENTRY, 'export const staged = true;\n');
    runSyntheticGit(fixture.root, ['add', SYNTHETIC_DURABLE_ENTRY]);
    await assert.rejects(
      authenticateServiceFastDurableVerifierBeforeDispatch(fixture.root),
      (error: unknown) =>
        error instanceof ServiceFastDurableBootstrapError &&
        error.code === 'bootstrap-index-identity-mismatch',
    );
    await writeSyntheticFile(fixture.root, SYNTHETIC_DURABLE_ENTRY, 'export {};\n');
    runSyntheticGit(fixture.root, ['add', SYNTHETIC_DURABLE_ENTRY]);
    await writeSyntheticFile(fixture.root, 'later.txt', 'later\n');
    runSyntheticGit(fixture.root, ['add', 'later.txt']);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Add later synthetic state']);
    assert.equal(
      verifyDurableServiceFastSourceClosure(fixture.root, generated.bytes)
        .closure.implementationInputRevision,
      fixture.implementationRevision,
    );
    await assert.rejects(
      verifyExecutableServiceFastSourceClosure(fixture.root, generated.bytes),
      /one-child source-closure commit/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('rechecks selected execution bytes and symlinks after Git-only closure admission', async () => {
  const fixture = await createSyntheticClosureRepository();
  const external = await mkdtemp(path.join(tmpdir(), 'rlt087-execution-source-'));
  const sourcePath = 'src/allocation/service-fast-path-shadow-price/synthetic.ts';
  try {
    const generated = await generateServiceFastSourceClosure(
      fixture.root,
      fixture.implementationRevision,
    );
    runSyntheticGit(fixture.root, ['add', fixture.config.artifacts.sourceClosure.path]);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Add synthetic closure']);
    const sourceAbsolute = path.join(fixture.root, sourcePath);
    const original = Uint8Array.from(await readFile(sourceAbsolute));
    runSyntheticGit(fixture.root, ['update-index', '--assume-unchanged', sourcePath]);
    const changed = Uint8Array.from(original);
    changed[0] = changed[0] === 0x65 ? 0x66 : 0x65;
    assert.equal(changed.byteLength, original.byteLength);
    await writeFile(sourceAbsolute, changed);
    assert.equal(
      verifyDurableServiceFastSourceClosure(fixture.root, generated.bytes)
        .closure.implementationInputRevision,
      fixture.implementationRevision,
    );
    await assert.rejects(
      verifyExecutableServiceFastSourceClosure(fixture.root, generated.bytes),
      (error: unknown) =>
        error instanceof ServiceFastSourceClosureError &&
        error.code === 'execution-source-descriptor-mismatch',
    );

    const externalSource = path.join(external, 'source.ts');
    await writeFile(externalSource, original);
    await rm(sourceAbsolute);
    await symlink(externalSource, sourceAbsolute);
    await assert.rejects(
      verifyExecutableServiceFastSourceClosure(fixture.root, generated.bytes),
      (error: unknown) =>
        error instanceof ServiceFastSourceClosureError &&
        error.code === 'symlink-source-forbidden',
    );
    await rm(sourceAbsolute);
    await writeFile(sourceAbsolute, original);
    runSyntheticGit(fixture.root, ['update-index', '--no-assume-unchanged', sourcePath]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

void test('rejects absent, extra-diff, and ambiguous historical closure children', async () => {
  const extraDiff = await createSyntheticClosureRepository();
  try {
    const prepared = await prepareServiceFastSourceClosure(
      extraDiff.root,
      extraDiff.implementationRevision,
    );
    await writeSyntheticFile(
      extraDiff.root,
      extraDiff.config.artifacts.sourceClosure.path,
      prepared.bytes,
    );
    await writeSyntheticFile(extraDiff.root, 'extra.txt', 'extra\n');
    runSyntheticGit(extraDiff.root, ['add', '--all']);
    runSyntheticGit(extraDiff.root, ['commit', '--quiet', '-m', 'RLT-087 Add closure and extra diff']);
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(extraDiff.root, prepared.bytes),
      /only the exact added source-closure file/u,
    );
  } finally {
    await rm(extraDiff.root, { recursive: true, force: true });
  }

  const ambiguous = await createSyntheticClosureRepository();
  try {
    const prepared = await prepareServiceFastSourceClosure(
      ambiguous.root,
      ambiguous.implementationRevision,
    );
    const closurePath = ambiguous.config.artifacts.sourceClosure.path;
    await writeSyntheticFile(ambiguous.root, closurePath, prepared.bytes);
    runSyntheticGit(ambiguous.root, ['add', closurePath]);
    runSyntheticGit(ambiguous.root, ['commit', '--quiet', '-m', 'RLT-087 Add first closure child']);
    const firstChild = runSyntheticGit(ambiguous.root, ['rev-parse', 'HEAD']).trim();
    runSyntheticGit(ambiguous.root, ['switch', '--quiet', '--detach', ambiguous.implementationRevision]);
    await writeSyntheticFile(ambiguous.root, closurePath, prepared.bytes);
    runSyntheticGit(ambiguous.root, ['add', closurePath]);
    runSyntheticGit(ambiguous.root, ['commit', '--quiet', '-m', 'RLT-087 Add second closure child']);
    const secondChild = runSyntheticGit(ambiguous.root, ['rev-parse', 'HEAD']).trim();
    runSyntheticGit(ambiguous.root, ['switch', '--quiet', '--detach', firstChild]);
    runSyntheticGit(ambiguous.root, [
      'merge',
      '--quiet',
      '--no-ff',
      '-m',
      'RLT-087 Merge ambiguous closure children',
      secondChild,
    ]);
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(ambiguous.root, prepared.bytes),
      /multiple direct children/u,
    );
  } finally {
    await rm(ambiguous.root, { recursive: true, force: true });
  }
});

void test('requires the historical closure child to add one regular blob', async () => {
  const modified = await createSyntheticClosureRepository();
  try {
    const closurePath = modified.config.artifacts.sourceClosure.path;
    await writeSyntheticFile(modified.root, closurePath, '{}\n');
    runSyntheticGit(modified.root, ['add', closurePath]);
    runSyntheticGit(modified.root, ['commit', '--quiet', '-m', 'RLT-087 Seed synthetic closure']);
    const revision = runSyntheticGit(modified.root, ['rev-parse', 'HEAD']).trim();
    const prepared = await prepareServiceFastSourceClosure(modified.root, revision);
    await writeSyntheticFile(modified.root, closurePath, prepared.bytes);
    runSyntheticGit(modified.root, ['add', closurePath]);
    runSyntheticGit(modified.root, ['commit', '--quiet', '-m', 'RLT-087 Modify synthetic closure']);
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(modified.root, prepared.bytes),
      /exact added source-closure file/u,
    );
  } finally {
    await rm(modified.root, { recursive: true, force: true });
  }

  const nonregular = await createSyntheticClosureRepository();
  try {
    const closurePath = nonregular.config.artifacts.sourceClosure.path;
    const prepared = await prepareServiceFastSourceClosure(
      nonregular.root,
      nonregular.implementationRevision,
    );
    const blobId = runSyntheticGit(
      nonregular.root,
      ['hash-object', '-w', '--stdin'],
      new TextDecoder().decode(prepared.bytes),
    ).trim();
    runSyntheticGit(nonregular.root, [
      'update-index',
      '--add',
      '--cacheinfo',
      `120000,${blobId},${closurePath}`,
    ]);
    runSyntheticGit(nonregular.root, ['commit', '--quiet', '-m', 'RLT-087 Add nonregular synthetic closure']);
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(nonregular.root, prepared.bytes),
      /one regular source-closure blob/u,
    );
  } finally {
    await rm(nonregular.root, { recursive: true, force: true });
  }
});

void test('rejects source-closure bytes above the frozen cap before JSON parsing', () => {
  const oversized = new Uint8Array(1_048_577).fill('{'.charCodeAt(0));
  assert.throws(
    () => verifyDurableServiceFastSourceClosure('/repository-root-is-not-consulted', oversized),
    /frozen 1 MiB cap/u,
  );
});

void test('hardens Git reads against hostile environment and replacement objects', async () => {
  const fixture = await createSyntheticClosureRepository();
  const redirect = await createSyntheticClosureRepository();
  const sourcePath = 'src/allocation/service-fast-path-shadow-price/synthetic.ts';
  try {
    const original = Uint8Array.from(await readFile(path.join(fixture.root, sourcePath)));
    await writeSyntheticFile(fixture.root, sourcePath, 'export const candidate = 2;\n');
    runSyntheticGit(fixture.root, ['add', sourcePath]);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Create replacement object']);
    const replacement = runSyntheticGit(fixture.root, ['rev-parse', 'HEAD']).trim();
    runSyntheticGit(fixture.root, ['switch', '--quiet', '--detach', fixture.implementationRevision]);
    runSyntheticGit(fixture.root, ['replace', fixture.implementationRevision, replacement]);
    assert.notDeepEqual(
      new TextEncoder().encode(runSyntheticGit(
        fixture.root,
        ['show', `${fixture.implementationRevision}:${sourcePath}`],
      )),
      original,
      'raw Git did not activate the replacement-object probe',
    );
    assert.deepEqual(
      readGitBlob(fixture.root, fixture.implementationRevision, sourcePath, original.byteLength),
      original,
    );
    assert.throws(
      () => readGitBlob(
        fixture.root,
        fixture.implementationRevision,
        sourcePath,
        Number.MAX_SAFE_INTEGER,
      ),
      (error: unknown) =>
        error instanceof SourceClosureGitError &&
        error.code === 'invalid-git-blob-bound' &&
        error.toolFailureFamily === 'repository',
    );
    assert.deepEqual([...readGitIgnoredPaths(fixture.root, [])], []);
    await writeFile(path.join(fixture.root, '.git', 'info', 'exclude'), 'ignored-runtime.ts\n');
    assert.deepEqual(
      [...readGitIgnoredPaths(fixture.root, ['visible-runtime.ts', 'ignored-runtime.ts'])],
      ['ignored-runtime.ts'],
    );
    assert.throws(
      () => readGitIgnoredPaths(fixture.root, ['duplicate.ts', 'duplicate.ts']),
      /unique paths/u,
    );

    const saved = Object.freeze({
      GIT_DIR: process.env['GIT_DIR'],
      GIT_WORK_TREE: process.env['GIT_WORK_TREE'],
      GIT_INDEX_FILE: process.env['GIT_INDEX_FILE'],
      GIT_OBJECT_DIRECTORY: process.env['GIT_OBJECT_DIRECTORY'],
      GIT_ALTERNATE_OBJECT_DIRECTORIES: process.env['GIT_ALTERNATE_OBJECT_DIRECTORIES'],
      GIT_CONFIG_COUNT: process.env['GIT_CONFIG_COUNT'],
    });
    try {
      process.env['GIT_DIR'] = path.join(redirect.root, '.git');
      process.env['GIT_WORK_TREE'] = redirect.root;
      process.env['GIT_INDEX_FILE'] = path.join(redirect.root, '.git', 'index');
      process.env['GIT_OBJECT_DIRECTORY'] = path.join(redirect.root, '.git', 'objects');
      process.env['GIT_ALTERNATE_OBJECT_DIRECTORIES'] = path.join(redirect.root, '.git', 'objects');
      process.env['GIT_CONFIG_COUNT'] = '1';
      assert.equal(readGitHeadRevision(fixture.root), fixture.implementationRevision);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const monitorPath = path.join(fixture.root, 'hostile-fsmonitor.sh');
    const monitorSentinel = path.join(fixture.root, '.hostile-fsmonitor-ran');
    await writeFile(
      monitorPath,
      `#!/bin/sh\n: > ${JSON.stringify(monitorSentinel)}\nprintf 'token\\0'\n`,
    );
    await chmod(monitorPath, 0o700);
    runSyntheticGit(fixture.root, ['config', 'core.fsmonitor', monitorPath]);
    runSyntheticGit(fixture.root, ['config', 'core.untrackedCache', 'true']);
    runSyntheticGit(fixture.root, ['status', '--porcelain=v1']);
    assert.equal((await lstat(monitorSentinel)).isFile(), true);
    await rm(monitorSentinel);
    readGitStatusPorcelain(fixture.root);
    await assert.rejects(lstat(monitorSentinel), { code: 'ENOENT' });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(redirect.root, { recursive: true, force: true });
  }
});

void test('rejects non-UTF-8 Git path metadata', async () => {
  const fixture = await createSyntheticClosureRepository();
  try {
    const invalidPath = Buffer.concat([
      Buffer.from(`${fixture.root}/invalid-`, 'utf8'),
      Buffer.from([0xff]),
    ]);
    await writeFile(invalidPath, 'invalid path bytes\n');
    runSyntheticGit(fixture.root, ['add', '--all']);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Add invalid path bytes']);
    assert.throws(
      () => readGitIndexEntries(fixture.root),
      (error: unknown) =>
        error instanceof SourceClosureGitError &&
        error.toolFailureFamily === 'repository' &&
        error.code === 'invalid-git-utf8',
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('rejects a same-width protected runtime source change at the primary binding gate', async () => {
  const fixture = await createSyntheticClosureRepository();
  try {
    const descriptor = Object.values(fixture.config.protectedRuntimeSources)[0];
    assert.ok(descriptor !== undefined);
    const original = Uint8Array.from(await readFile(path.join(fixture.root, descriptor.path)));
    const changed = Uint8Array.from(original);
    changed[0] = changed[0] === 0x20 ? 0x21 : 0x20;
    assert.equal(changed.byteLength, original.byteLength);
    await writeSyntheticFile(fixture.root, descriptor.path, changed);
    runSyntheticGit(fixture.root, ['add', descriptor.path]);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Change protected runtime bytes']);
    const changedRevision = runSyntheticGit(fixture.root, ['rev-parse', 'HEAD']).trim();
    await assert.rejects(
      prepareServiceFastSourceClosure(fixture.root, changedRevision),
      /Protected runtime source|does not match its descriptor/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('rejects source-closure order, unknown, duplicate, traversal, descriptor, and revision faults', async () => {
  const fixture = await createSyntheticClosureRepository();
  try {
    const prepared = await prepareServiceFastSourceClosure(
      fixture.root,
      fixture.implementationRevision,
    );
    const source = JSON.parse(new TextDecoder().decode(prepared.bytes)) as Record<string, unknown>;
    const canonical = (value: unknown): Uint8Array =>
      new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

    const unknown = structuredClone(source);
    unknown['unknown'] = true;
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(fixture.root, canonical(unknown)),
      /frozen fields/u,
    );

    const reordered = structuredClone(source);
    const reorderedSources = reordered['sources'] as Record<string, unknown>[];
    [reorderedSources[0], reorderedSources[1]] = [reorderedSources[1]!, reorderedSources[0]!];
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(fixture.root, canonical(reordered)),
      /order|revision sources/u,
    );

    const duplicate = structuredClone(source);
    const duplicateSources = duplicate['sources'] as Record<string, unknown>[];
    duplicateSources[1] = structuredClone(duplicateSources[0]!);
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(fixture.root, canonical(duplicate)),
      /duplicate/u,
    );

    const traversal = structuredClone(source);
    const traversalSources = traversal['sources'] as Record<string, unknown>[];
    traversalSources[0]!['path'] = '../escape.ts';
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(fixture.root, canonical(traversal)),
      /path is not canonical/u,
    );

    const invalidRevision = structuredClone(source);
    invalidRevision['implementationInputRevision'] = 'BAD-REVISION';
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(fixture.root, canonical(invalidRevision)),
      (error: unknown) =>
        error instanceof ServiceFastSourceClosureError &&
        error.toolFailureFamily === 'repository' &&
        error.code === 'revision-mismatch',
    );

    const descriptorMismatch = structuredClone(source);
    const mismatchedSources = descriptorMismatch['sources'] as Record<string, unknown>[];
    mismatchedSources[0]!['sha256'] = `sha256:${'0'.repeat(64)}`;
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(
        fixture.root,
        canonical(descriptorMismatch),
      ),
      /does not match its descriptor/u,
    );

    const forgedMaximumSafeDescriptor = structuredClone(source);
    const forgedSources = forgedMaximumSafeDescriptor['sources'] as Record<string, unknown>[];
    forgedSources[0]!['bytes'] = Number.MAX_SAFE_INTEGER;
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(
        fixture.root,
        canonical(forgedMaximumSafeDescriptor),
      ),
      (error: unknown) =>
        error instanceof SourceClosureCodecError &&
        error.code === 'source-byte-cap-exceeded' &&
        error.toolFailureFamily === 'repository',
    );

    const duplicateKey = new TextDecoder().decode(prepared.bytes).replace(
      '  "experimentId":',
      `  "experimentId": "m7c-core12-service-fast-numerical-v1",\n  "experimentId":`,
    );
    assert.throws(
      () => verifyDurableServiceFastSourceClosure(
        fixture.root,
        new TextEncoder().encode(duplicateKey),
      ),
      /canonical/u,
    );
    await assert.rejects(
      prepareServiceFastSourceClosure(fixture.root, '0'.repeat(40)),
      /Expected repository HEAD/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('rejects untracked, symlink-mode, and conflicted generation repositories', async () => {
  const untracked = await createSyntheticClosureRepository();
  try {
    await writeSyntheticFile(
      untracked.root,
      'src/benchmark/service-fast-numerical-experiment/untracked.ts',
      'export {};\n',
    );
    await assert.rejects(
      prepareServiceFastSourceClosure(untracked.root, untracked.implementationRevision),
      /clean index and worktree/u,
    );
  } finally {
    await rm(untracked.root, { recursive: true, force: true });
  }

  const symlinkMode = await createSyntheticClosureRepository();
  try {
    const source = path.join(
      symlinkMode.root,
      'src/allocation/service-fast-path-shadow-price/synthetic.ts',
    );
    await rm(source);
    await symlink('missing-target.ts', source);
    runSyntheticGit(symlinkMode.root, ['add', '--all']);
    runSyntheticGit(symlinkMode.root, ['commit', '--quiet', '-m', 'RLT-087 Add symlink mode']);
    const revision = runSyntheticGit(symlinkMode.root, ['rev-parse', 'HEAD']).trim();
    await assert.rejects(
      prepareServiceFastSourceClosure(symlinkMode.root, revision),
      /not a regular file/u,
    );
  } finally {
    await rm(symlinkMode.root, { recursive: true, force: true });
  }

  const conflicted = await createSyntheticClosureRepository();
  try {
    const conflictPath = 'src/allocation/service-fast-path-shadow-price/synthetic.ts';
    const objectId = runSyntheticGit(conflicted.root, ['rev-parse', `HEAD:${conflictPath}`]).trim();
    runSyntheticGit(conflicted.root, ['update-index', '--force-remove', conflictPath]);
    runSyntheticGit(
      conflicted.root,
      ['update-index', '--index-info'],
      `100644 ${objectId} 1\t${conflictPath}\n100644 ${objectId} 2\t${conflictPath}\n`,
    );
    await assert.rejects(
      prepareServiceFastSourceClosure(conflicted.root, conflicted.implementationRevision),
      /clean index and worktree|stage-zero/u,
    );
  } finally {
    await rm(conflicted.root, { recursive: true, force: true });
  }
});

void test('types missing generator filesystem authorities as repository failures', async () => {
  const fixture = await createSyntheticClosureRepository();
  try {
    runSyntheticGit(fixture.root, ['rm', '--quiet', SERVICE_FAST_CONFIG_PATH]);
    runSyntheticGit(fixture.root, ['commit', '--quiet', '-m', 'RLT-087 Remove synthetic config']);
    const revision = runSyntheticGit(fixture.root, ['rev-parse', 'HEAD']).trim();
    await assert.rejects(
      prepareServiceFastSourceClosure(fixture.root, revision),
      (error: unknown) =>
        error instanceof ServiceFastSourceClosureError &&
        error.toolFailureFamily === 'repository' &&
        error.code === 'filesystem-inspection-failure' &&
        error.artifact === SERVICE_FAST_CONFIG_PATH,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

void test('publishes closure bytes exclusively and preserves every preexisting destination', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-closure-publication-'));
  const destination = path.join(directory, 'source-closure.v1.json');
  const bytes = new TextEncoder().encode('{"canonical":true}\n');
  try {
    const published = await publishCanonicalSourceClosure(destination, bytes, 1024);
    assert.equal(published.bytes, bytes.byteLength);
    assert.deepEqual(Uint8Array.from(await readFile(destination)), bytes);
    assert.deepEqual(await readdir(directory), ['source-closure.v1.json']);

    await assert.rejects(
      publishCanonicalSourceClosure(destination, bytes, 1024),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'initial-destination-conflict',
    );
    assert.deepEqual(Uint8Array.from(await readFile(destination)), bytes);
    await rm(destination);
    await writeFile(path.join(directory, 'target'), 'target\n');
    await symlink('target', destination);
    await assert.rejects(
      publishCanonicalSourceClosure(destination, bytes, 1024),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'initial-destination-conflict',
    );
    assert.equal((await lstat(destination)).isSymbolicLink(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('cleans only its owned closure temp on precommit and final-race failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-closure-cleanup-'));
  const destination = path.join(directory, 'source-closure.v1.json');
  const bytes = new TextEncoder().encode('{"canonical":true}\n');
  const defaults = defaultClosurePublicationDependencies();
  try {
    await assert.rejects(
      publishCanonicalSourceClosure(
        destination,
        bytes,
        1024,
        {
          ...defaults,
          uniqueSuffix: () => 'write-failure',
          openExclusive: async (filePath) => {
            const handle = await defaults.openExclusive(filePath);
            return {
              ...handle,
              write: () => Promise.reject(new Error('forced write failure')),
            };
          },
        },
      ),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'temp-write-failure',
    );
    assert.deepEqual(await readdir(directory), []);

    await assert.rejects(
      publishCanonicalSourceClosure(
        destination,
        bytes,
        1024,
        {
          ...defaults,
          uniqueSuffix: () => 'final-race',
          link: async (sourcePath, destinationPath) => {
            await writeFile(destinationPath, 'racer\n', { flag: 'wx' });
            await defaults.link(sourcePath, destinationPath);
          },
        },
      ),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'final-destination-conflict',
    );
    assert.equal(await readFile(destination, 'utf8'), 'racer\n');
    assert.deepEqual(await readdir(directory), ['source-closure.v1.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('rebinds publication inodes and projects otherwise-silent close failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rlt087-closure-rebind-'));
  const bytes = new TextEncoder().encode('{"canonical":true}\n');
  const defaults = defaultClosurePublicationDependencies();
  try {
    const prelinkHandleDestination = path.join(directory, 'prelink-handle-stat.json');
    await assert.rejects(
      publishCanonicalSourceClosure(prelinkHandleDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'prelink-handle-stat',
        openExclusive: async (filePath) => {
          const handle = await defaults.openExclusive(filePath);
          let statCalls = 0;
          return {
            ...handle,
            stat: async () => {
              statCalls += 1;
              if (statCalls === 2) throw new Error('forced prelink handle stat failure');
              return handle.stat();
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'temp-identity-mismatch' &&
        !error.committed,
    );
    assert.deepEqual(await readdir(directory), []);

    const prelinkPathDestination = path.join(directory, 'prelink-path-stat.json');
    let prelinkTempStats = 0;
    await assert.rejects(
      publishCanonicalSourceClosure(prelinkPathDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'prelink-path-stat',
        lstat: async (filePath) => {
          if (filePath.includes('.prelink-path-stat.json.tmp-')) {
            prelinkTempStats += 1;
            if (prelinkTempStats === 2) {
              throw new Error('forced prelink path stat failure');
            }
          }
          return defaults.lstat(filePath);
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'temp-identity-mismatch' &&
        !error.committed,
    );
    assert.deepEqual(await readdir(directory), []);

    const postlinkStatDestination = path.join(directory, 'postlink-stat.json');
    await assert.rejects(
      publishCanonicalSourceClosure(postlinkStatDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'postlink-stat',
        openExclusive: async (filePath) => {
          const handle = await defaults.openExclusive(filePath);
          let statCalls = 0;
          return {
            ...handle,
            stat: async () => {
              statCalls += 1;
              if (statCalls === 3) throw new Error('forced postlink handle stat failure');
              return handle.stat();
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postlink-identity-mismatch' &&
        !error.committed &&
        error.secondaryCleanupCode === null,
    );
    assert.deepEqual(await readdir(directory), []);

    const closeFailureDestination = path.join(directory, 'precommit-close.json');
    await assert.rejects(
      publishCanonicalSourceClosure(closeFailureDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'precommit-close',
        openExclusive: async (filePath) => {
          const handle = await defaults.openExclusive(filePath);
          return {
            ...handle,
            write: () => Promise.reject(new Error('forced precommit write failure')),
            close: async () => {
              await handle.close();
              throw new Error('forced precommit close failure');
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'temp-write-failure' &&
        !error.committed &&
        error.secondaryCleanupCode === 'precommit-owned-temp-cleanup-failure',
    );
    assert.deepEqual(await readdir(directory), []);

    const identityFailureDestination = path.join(directory, 'identity-establishment.json');
    await assert.rejects(
      publishCanonicalSourceClosure(identityFailureDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'identity-establishment',
        openExclusive: async (filePath) => {
          const handle = await defaults.openExclusive(filePath);
          return { ...handle, stat: () => Promise.reject(new Error('forced initial handle stat failure')) };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'temp-identity-mismatch' &&
        !error.committed &&
        error.secondaryCleanupCode === 'precommit-owned-temp-cleanup-failure',
    );
    const uncertainTemp = (await readdir(directory)).find((name) =>
      name.includes('identity-establishment'));
    assert.ok(uncertainTemp !== undefined);
    await rm(path.join(directory, uncertainTemp));

    const corruptDestination = path.join(directory, 'corrupt-readback.json');
    await assert.rejects(
      publishCanonicalSourceClosure(corruptDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'corrupt-readback',
        openExclusive: async (filePath) => {
          const handle = await defaults.openExclusive(filePath);
          return {
            ...handle,
            write: async (written) => {
              const changed = Uint8Array.from(written);
              changed[0] = changed[0] === 0x7b ? 0x5b : 0x7b;
              await handle.write(changed);
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'temp-readback-mismatch',
    );
    assert.deepEqual(await readdir(directory), []);

    const swappedDestination = path.join(directory, 'swapped.json');
    await assert.rejects(
      publishCanonicalSourceClosure(swappedDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'swapped-source',
        link: async (sourcePath, destinationPath) => {
          await defaults.unlink(sourcePath);
          await writeFile(sourcePath, 'attacker\n', { flag: 'wx' });
          await defaults.link(sourcePath, destinationPath);
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postlink-identity-mismatch' &&
        error.committed &&
        error.secondaryCleanupCode === 'provisional-destination-cleanup-failure',
    );
    assert.equal(await readFile(swappedDestination, 'utf8'), 'attacker\n');
    const swappedTemp = (await readdir(directory)).find((name) => name.includes('swapped-source'));
    assert.ok(swappedTemp !== undefined);
    assert.equal(await readFile(path.join(directory, swappedTemp), 'utf8'), 'attacker\n');
    await rm(path.join(directory, swappedTemp));
    await rm(swappedDestination);

    const replacedDestination = path.join(directory, 'replaced.json');
    let destinationInspections = 0;
    await assert.rejects(
      publishCanonicalSourceClosure(replacedDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'replaced-destination',
        lstat: async (filePath) => {
          if (filePath === replacedDestination) {
            destinationInspections += 1;
            if (destinationInspections === 3) {
              await defaults.unlink(filePath);
              await writeFile(filePath, 'replacement-actor\n', { flag: 'wx' });
            }
          }
          return defaults.lstat(filePath);
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postlink-identity-mismatch' &&
        error.committed &&
        error.secondaryCleanupCode === 'provisional-destination-cleanup-failure',
    );
    assert.equal(await readFile(replacedDestination, 'utf8'), 'replacement-actor\n');
    assert.deepEqual(await readdir(directory), ['replaced.json']);
    await rm(replacedDestination);

    const rolledBackDestination = path.join(directory, 'rolled-back.json');
    let rollbackInspections = 0;
    await assert.rejects(
      publishCanonicalSourceClosure(rolledBackDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'rolled-back',
        lstat: async (filePath) => {
          const stats = await defaults.lstat(filePath);
          if (filePath === rolledBackDestination) {
            rollbackInspections += 1;
            if (rollbackInspections === 1) return { ...stats, size: stats.size + 1n };
          }
          return stats;
        },
      }),
      (error: unknown) => {
        if (!(error instanceof SourceClosurePublicationError)) return false;
        assert.deepEqual(projectServiceFastToolFailure(error, 'verification'), {
          ok: false,
          cause: 'artifact-write-failure',
          phase: 'publication-precommit',
          detailCode: 'artifact-write-failure',
          committed: false,
          secondaryCleanup: null,
        });
        return error.code === 'postlink-identity-mismatch';
      },
    );
    await assert.rejects(lstat(rolledBackDestination), { code: 'ENOENT' });
    assert.deepEqual(await readdir(directory), []);

    const uncertainSyncDestination = path.join(directory, 'uncertain-sync.json');
    let uncertainSyncInspections = 0;
    await assert.rejects(
      publishCanonicalSourceClosure(uncertainSyncDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'uncertain-sync',
        lstat: async (filePath) => {
          const stats = await defaults.lstat(filePath);
          if (filePath === uncertainSyncDestination) {
            uncertainSyncInspections += 1;
            if (uncertainSyncInspections === 1) return { ...stats, size: stats.size + 1n };
          }
          return stats;
        },
        openDirectory: async (directoryPath) => {
          const handle = await defaults.openDirectory(directoryPath);
          return { ...handle, sync: () => Promise.reject(new Error('forced rollback sync failure')) };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postlink-identity-mismatch' &&
        error.committed &&
        error.secondaryCleanupCode === 'provisional-destination-cleanup-failure',
    );
    await assert.rejects(lstat(uncertainSyncDestination), { code: 'ENOENT' });
    assert.deepEqual(await readdir(directory), []);

    const reappearedDestination = path.join(directory, 'reappeared.json');
    let reappearedInspections = 0;
    await assert.rejects(
      publishCanonicalSourceClosure(reappearedDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'reappeared',
        lstat: async (filePath) => {
          if (filePath === reappearedDestination) {
            reappearedInspections += 1;
            if (reappearedInspections === 5) {
              await writeFile(filePath, 'replacement-after-sync\n', { flag: 'wx' });
            }
          }
          const stats = await defaults.lstat(filePath);
          if (filePath === reappearedDestination && reappearedInspections === 3) {
            return { ...stats, size: stats.size + 1n };
          }
          return stats;
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postlink-identity-mismatch' &&
        error.committed &&
        error.secondaryCleanupCode === 'provisional-destination-cleanup-failure',
    );
    assert.equal(await readFile(reappearedDestination, 'utf8'), 'replacement-after-sync\n');
    await rm(reappearedDestination);

    const fileCloseDestination = path.join(directory, 'file-close.json');
    await assert.rejects(
      publishCanonicalSourceClosure(fileCloseDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'file-close',
        openExclusive: async (filePath) => {
          const handle = await defaults.openExclusive(filePath);
          return {
            ...handle,
            close: async () => {
              await handle.close();
              throw new Error('forced file close failure');
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postcommit-file-close-failure' &&
        error.committed,
    );
    assert.deepEqual(Uint8Array.from(await readFile(fileCloseDestination)), bytes);
    await rm(fileCloseDestination);

    const secondParentOpenDestination = path.join(directory, 'second-parent-open.json');
    let parentOpenCalls = 0;
    let firstParentCloseCalls = 0;
    await assert.rejects(
      publishCanonicalSourceClosure(secondParentOpenDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'second-parent-open',
        openDirectory: async (directoryPath) => {
          parentOpenCalls += 1;
          if (parentOpenCalls === 2) {
            throw new Error('forced second parent open failure');
          }
          const handle = await defaults.openDirectory(directoryPath);
          return {
            ...handle,
            close: async () => {
              firstParentCloseCalls += 1;
              await handle.close();
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postcommit-temp-unlink-sync-failure' &&
        error.committed,
    );
    assert.equal(firstParentCloseCalls, 1);
    assert.deepEqual(Uint8Array.from(await readFile(secondParentOpenDestination)), bytes);
    await rm(secondParentOpenDestination);

    const directoryCloseDestination = path.join(directory, 'directory-close.json');
    await assert.rejects(
      publishCanonicalSourceClosure(directoryCloseDestination, bytes, 1024, {
        ...defaults,
        uniqueSuffix: () => 'directory-close',
        openDirectory: async (directoryPath) => {
          const handle = await defaults.openDirectory(directoryPath);
          return {
            ...handle,
            close: async () => {
              await handle.close();
              throw new Error('forced directory close failure');
            },
          };
        },
      }),
      (error: unknown) =>
        error instanceof SourceClosurePublicationError &&
        error.code === 'postcommit-parent-close-failure' &&
        error.committed,
    );
    assert.deepEqual(Uint8Array.from(await readFile(directoryCloseDestination)), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function runtimeAuditProbe(
  source: string | Uint8Array,
  overrides: {
    readonly tracked?: boolean;
    readonly ignored?: boolean;
    readonly builtins?: readonly string[];
    readonly nodeBuiltins?: readonly string[];
    readonly pathBuiltins?: readonly string[];
    readonly entryRoots?: readonly string[];
    readonly duplicatePathCapability?: boolean;
    readonly missingBeforeAudit?: boolean;
    readonly relativePath?: string;
    readonly capabilities?: RuntimeImportAuditProfile['pathCapabilities'][number]['capabilities'];
  } = {},
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-runtime-audit-'));
  try {
    const relativePath = overrides.relativePath ?? 'src/main.ts';
    await writeSyntheticFile(root, relativePath, source);
    const bytes = Uint8Array.from(await readFile(path.join(root, relativePath)));
    const descriptor = Object.freeze({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
    const pathCapability = Object.freeze({
      path: relativePath,
      builtins: Object.freeze([...(overrides.pathBuiltins ?? overrides.builtins ?? [])]),
      capabilities: Object.freeze([...(overrides.capabilities ?? [])]),
    });
    const profile: RuntimeImportAuditProfile = Object.freeze({
      profileId: 'synthetic-runtime-audit-v1',
      entryRoots: Object.freeze([...(overrides.entryRoots ?? [relativePath])]),
      projectSources: Object.freeze([descriptor]),
      nodeBuiltins: Object.freeze([...(overrides.nodeBuiltins ?? overrides.builtins ?? [])]),
      pathCapabilities: Object.freeze(overrides.duplicatePathCapability
        ? [pathCapability, pathCapability]
        : [pathCapability]),
    });
    if (overrides.missingBeforeAudit === true) {
      await rm(path.join(root, relativePath));
    }
    await auditServiceFastRuntimeImports({
      repositoryRoot: root,
      profile,
      trackedPaths: overrides.tracked === false ? new Set() : new Set([relativePath]),
      ignoredPaths: overrides.ignored === true ? new Set([relativePath]) : new Set(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test('audits disjoint exact parent and generation-child runtime closures and rejects hostile capabilities', async () => {
  const runtimePaths = [...new Set([
    ...SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS,
    ...SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS,
  ])];
  const descriptors = [];
  for (const relativePath of runtimePaths) {
    const bytes = Uint8Array.from(await readFile(relativePath));
    descriptors.push(Object.freeze({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    }));
  }
  const tracked = new Set(runtimePaths);
  const parentAudit = await auditServiceFastRuntimeImports({
    repositoryRoot: process.cwd(),
    profile: noArgumentParentRuntimeAuditProfile(descriptors),
    trackedPaths: tracked,
  });
  const childAudit = await auditServiceFastRuntimeImports({
    repositoryRoot: process.cwd(),
    profile: generationChildRuntimeAuditProfile(descriptors),
    trackedPaths: tracked,
  });
  assert.deepEqual(
    parentAudit.projectSources,
    [...SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS].sort(),
  );
  assert.deepEqual(
    childAudit.projectSources,
    [...SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS].sort(),
  );
  assert.equal(
    childAudit.projectSources.some((relativePath) =>
      /service-fast-path-shadow-price|bounded-exact-split-repair|evaluator-kernel|proposal-adapters|accepted-run|analysis|selection|profiler/u.test(relativePath)),
    false,
  );
  assert.equal(
    parentAudit.projectSources.some((relativePath) =>
      /\/generate(?:-entry)?\.ts$|\/publication\.ts$|size-admission|readme-template/u.test(relativePath)),
    false,
  );
  assert.equal(
    childAudit.projectSources.some((relativePath) =>
      relativePath === 'cli/verify-service-fast-numerical-experiment.ts' ||
      /\/dispatcher\.ts$|durable-verifier-bootstrap|durable-runtime-profile|\/verification\.ts$/u.test(relativePath)),
    false,
  );

  const probes: readonly {
    source: string;
    overrides?: Parameters<typeof runtimeAuditProbe>[1];
    code: string;
  }[] = [
    { source: "void import('./other.ts');\n", code: 'dynamic-loader-forbidden' },
    { source: "const value = `${import('./other.ts')}`;\nvoid value;\n", code: 'dynamic-loader-forbidden' },
    { source: "import value from 'bare-package';\n", code: 'bare-import-forbidden' },
    { source: "import value from '/tmp/escape.ts';\n", code: 'absolute-import-forbidden' },
    { source: "import value from './extensionless';\n", code: 'extensionless-import-forbidden' },
    { source: "globalThis['ev' + 'al'];\n", code: 'computed-capability-forbidden' },
    { source: "const clock = process['hr' + 'time'];\nvoid clock;\n", code: 'computed-capability-forbidden' },
    { source: "const p = process;\nvoid p['hr' + 'time'];\n", code: 'process-capability-mismatch' },
    { source: "const root = globalThis;\nconst network = root['fetch'];\nvoid network;\n", code: 'computed-capability-forbidden' },
    {
      source: 'const root = glo\\u0062alThis;\nvoid root;\n',
      code: 'escaped-capability-forbidden',
    },
    {
      source: 'const root = glo\\u{62}alThis;\nvoid root;\n',
      code: 'escaped-capability-forbidden',
    },
    { source: 'void global;\n', code: 'computed-capability-forbidden' },
    { source: 'void Reflect.ownKeys({});\n', code: 'computed-capability-forbidden' },
    {
      source: "const p=Reflect.get(global,['pro','cess'].join('')); const load=Reflect.get(p,['getBuiltin','Module'].join('')); void load.call(p,'node:fs');\n",
      code: 'computed-capability-forbidden',
    },
    { source: 'const compile = eval;\nvoid compile;\n', code: 'codegen-forbidden' },
    { source: "new Function('return 1');\n", code: 'codegen-forbidden' },
    { source: 'void (() => 1).constructor;\n', code: 'codegen-forbidden' },
    { source: "void ([])[\"con\" + \"structor\"];\n", code: 'codegen-forbidden' },
    {
      source: "const k='constructor'; const F=(()=>1)[k]; void F('return 1')();\n",
      code: 'codegen-forbidden',
    },
    {
      source: "const k='constr\\u0075ctor'; const F=(()=>1)[k]; void F('return 1')();\n",
      code: 'codegen-forbidden',
    },
    {
      source: "const k='" + String.fromCodePoint(92) +
        "constructor'; const F=(()=>1)[k]; void F('return 1')();\n",
      code: 'codegen-forbidden',
    },
    {
      source: 'const k="constructor"; const F=(()=>1)[k]; void F;\n',
      code: 'codegen-forbidden',
    },
    {
      source: 'const k=`constructor`; const F=(()=>1)[k]; void F;\n',
      code: 'codegen-forbidden',
    },
    ...['\n', '\r\n', '\u2028', '\u2029'].map((lineBreak) => ({
      source: "const k='con" + String.fromCodePoint(92) + lineBreak +
        "structor'; const F=(()=>1)[k]; void F('return 1')();\n",
      code: 'codegen-forbidden',
    })),
    {
      source: "const k=\"con\" + 'str\\u0075ctor'; const F=(()=>1)[k]; void F;\n",
      code: 'codegen-forbidden',
    },
    {
      source: "Reflect.get(()=>1,['con','structor'].join(''))('return 1')();\n",
      code: 'codegen-forbidden',
    },
    {
      source: "void ([])[['con','structor'].join('')];\n",
      code: 'codegen-forbidden',
    },
    {
      source: "void ([])[['con','str\\u0075ctor'].join('')];\n",
      code: 'codegen-forbidden',
    },
    { source: 'void fetch("https://example.invalid");\n', code: 'network-capability-forbidden' },
    { source: 'void new WebSocket("wss://example.invalid");\n', code: 'network-capability-forbidden' },
    { source: 'void process.binding("fs");\n', code: 'native-loader-forbidden' },
    { source: 'void process.hrtime.bigint();\n', code: 'operational-clock-forbidden' },
    { source: 'void Date.now();\n', code: 'operational-clock-forbidden' },
    { source: 'void performance.now();\n', code: 'operational-clock-forbidden' },
    { source: 'void process.uptime();\n', code: 'operational-clock-forbidden' },
    {
      source: "import { Worker } from 'node:worker_threads';\nvoid Worker;\n",
      overrides: { builtins: ['node:worker_threads'] },
      code: 'worker-forbidden',
    },
    {
      source: "import { spawnSync } from 'node:child_process';\nspawnSync('sh');\n",
      overrides: { builtins: ['node:child_process'] },
      code: 'arbitrary-child-process-forbidden',
    },
    {
      source: "import * as fs from 'node:fs/promises';\nvoid fs['write' + 'File'];\n",
      overrides: {
        builtins: ['node:fs/promises'],
        capabilities: ['read-only-filesystem'],
      },
      code: 'read-only-filesystem-mutation-forbidden',
    },
    {
      source: "import { writeFile } from 'node:fs/promises';\nvoid writeFile;\n",
      overrides: {
        builtins: ['node:fs/promises'],
        capabilities: ['read-only-filesystem'],
      },
      code: 'read-only-filesystem-mutation-forbidden',
    },
    {
      source: 'export unsupported token;\n',
      code: 'unparsed-export',
    },
    { source: 'export {};\n', overrides: { tracked: false }, code: 'untracked-runtime-target' },
    { source: 'export {};\n', overrides: { ignored: true }, code: 'ignored-runtime-target' },
    {
      source: 'export {};\n',
      overrides: { missingBeforeAudit: true },
      code: 'runtime-source-admission-failure',
    },
    {
      source: "import { createHash as digest } from 'node:crypto';\ndigest('sha256');\n",
      overrides: { builtins: ['node:crypto'], capabilities: ['hash'] },
      code: 'crypto-capability-mismatch',
    },
  ];
  for (const probe of probes) {
    await assert.rejects(
      runtimeAuditProbe(probe.source, probe.overrides),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === probe.code,
      `${probe.code}: ${JSON.stringify(probe.source)}`,
    );
  }

  await assert.rejects(
    runtimeAuditProbe(Uint8Array.from([0xff])),
    (error: unknown) =>
      error instanceof ServiceFastRuntimeImportAuditError &&
      error.code === 'invalid-runtime-source-utf8',
  );

  for (const source of [
    "const before = 1; import path from 'node:path'; void before; void path;\n",
    "const before = 1; export { sep } from 'node:path'; void before;\n",
    "import {\n  sep,\n  join,\n} from 'node:path';\nvoid sep; void join;\n",
    "export * as pathNamespace from 'node:path';\n",
  ]) {
    await runtimeAuditProbe(source, { builtins: ['node:path'] });
  }

  const boundedFilePath =
    'src/benchmark/service-fast-numerical-experiment/artifact-verifier/io/bounded-file.ts';
  const boundedFileSource = [
    "import { constants } from 'node:fs';",
    "import { open } from 'node:fs/promises';",
    "const absolutePath = '/tmp/read-only';",
    'const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);',
    'await handle.stat();',
    'await handle.close();',
    '',
  ].join('\n');
  await runtimeAuditProbe(boundedFileSource, {
    relativePath: boundedFilePath,
    builtins: ['node:fs', 'node:fs/promises'],
    capabilities: ['read-only-filesystem'],
  });
  const boundedOpenRegexDecoy = `${boundedFileSource
    .replaceAll(/\bhandle\b/gu, 'otherHandle')
    .replace(
      'const otherHandle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);',
      'const otherHandle = await other(absolutePath);',
    )}void /const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);/;\n`;
  for (const hostileBoundedFile of [
    boundedOpenRegexDecoy,
    boundedFileSource.replace('constants.O_RDONLY', 'constants.O_RDWR'),
    boundedFileSource.replace(' | constants.O_NONBLOCK', ''),
    boundedFileSource.replace('constants.O_NONBLOCK', 'constants.O_SYNC'),
    boundedFileSource.replace(
      'constants.O_NONBLOCK',
      'constants.O_NONBLOCK | constants.O_SYNC',
    ),
    boundedFileSource.replace('await handle.stat();', "void handle['write'];"),
    boundedFileSource.replace('await handle.stat();', 'void [handle];'),
    boundedFileSource.replace('await handle.stat();', 'void { handle };'),
    boundedFileSource.replace('await handle.stat();', 'await handle?.stat();'),
    boundedFileSource.replace('await handle.stat();', 'const alias = handle;\nvoid alias;'),
    boundedFileSource.replace(
      "const absolutePath = '/tmp/read-only';",
      "const absolutePath = '/tmp/read-only';\nconst alias = open;\nvoid alias;",
    ),
  ]) {
    await assert.rejects(
      runtimeAuditProbe(hostileBoundedFile, {
        relativePath: boundedFilePath,
        builtins: ['node:fs', 'node:fs/promises'],
        capabilities: ['read-only-filesystem'],
      }),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === 'read-only-filesystem-mutation-forbidden',
    );
  }

  const dispatcherPath =
    'src/benchmark/service-fast-numerical-experiment/tooling/dispatcher.ts';
  const dispatcherSource = await readFile(dispatcherPath, 'utf8');
  await assert.rejects(
    runtimeAuditProbe(
      dispatcherSource.replace(
        "import path from 'node:path';",
        "import path from 'node:path';\nconst escapedSpawn = spawnSync;\nescapedSpawn('/bin/sh', [], { shell: false });",
      ),
      {
        relativePath: dispatcherPath,
        builtins: ['node:child_process', 'node:path'],
        capabilities: ['fixed-child-dispatch'],
      },
    ),
    (error: unknown) =>
      error instanceof ServiceFastRuntimeImportAuditError &&
      error.code === 'fixed-dispatch-capability-mismatch',
  );
  const gitPath =
    'src/benchmark/service-fast-numerical-experiment/source-closure/git.ts';
  const gitSource = await readFile(gitPath, 'utf8');
  await assert.rejects(
    runtimeAuditProbe(
      gitSource.replace(
        "import path from 'node:path';",
        "import path from 'node:path';\nconst escapedGitSpawn = spawnSync;\nescapedGitSpawn('/bin/sh', [], { shell: false });",
      ),
      {
        relativePath: gitPath,
        builtins: ['node:child_process', 'node:path'],
        capabilities: ['bounded-git-metadata'],
      },
    ),
    (error: unknown) =>
      error instanceof ServiceFastRuntimeImportAuditError &&
      error.code === 'bounded-git-capability-mismatch',
  );
  const commentBaitDispatcher = [
    "import { spawnSync, type SpawnSyncOptions } from 'node:child_process';",
    "import path from 'node:path';",
    'void path; void (undefined as unknown as SpawnSyncOptions);',
    'const bait = `export const SERVICE_FAST_ARTIFACT_VERIFIER_HELPER =',
    `  '${SERVICE_FAST_ARTIFACT_VERIFIER_HELPER}';`,
    'dependencies.spawn(dependencies.execPath, [], { stdio: "inherit", shell: false });`;',
    'void bait;',
    "spawnSync('/bin/sh', [], { shell: false });",
    '/* execPath: process.execPath; dependencies.execPath !== process.execPath; */',
    '',
  ].join('\n');
  await assert.rejects(
    runtimeAuditProbe(commentBaitDispatcher, {
      relativePath: dispatcherPath,
      builtins: ['node:child_process', 'node:path'],
      capabilities: ['fixed-child-dispatch'],
    }),
    (error: unknown) =>
      error instanceof ServiceFastRuntimeImportAuditError &&
      error.code === 'fixed-dispatch-capability-mismatch',
  );

  const durableHostPath = SYNTHETIC_DURABLE_HOST_ADMISSION;
  const durableHostSource = syntheticDurableHostAdmissionSource();
  await runtimeAuditProbe(durableHostSource, {
    relativePath: durableHostPath,
    builtins: ['node:os', 'node:process'],
  });
  for (const functionName of [
    'availableParallelism',
    'cpus',
    'endianness',
    'release',
    'type',
  ]) {
    const bindingOnly = durableHostSource.replace(
      `${functionName}();`,
      functionName,
    );
    assert.notEqual(bindingOnly, durableHostSource);
    await assert.rejects(
      runtimeAuditProbe(bindingOnly, {
        relativePath: durableHostPath,
        builtins: ['node:os', 'node:process'],
      }),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === 'host-admission-capability-mismatch',
      `${functionName} binding without call`,
    );
  }
  const durableHostCapture =
    'void [parallelism, processors, byteOrder, osRelease, osType, arch, execArgv, platform, version, runtimeVersions, nodeOptions];';
  for (const processName of ['arch', 'execArgv', 'platform', 'version']) {
    const bindingOnly = durableHostSource.replace(
      durableHostCapture,
      durableHostCapture.replace(`${processName}, `, ''),
    );
    assert.notEqual(bindingOnly, durableHostSource);
    await assert.rejects(
      runtimeAuditProbe(bindingOnly, {
        relativePath: durableHostPath,
        builtins: ['node:os', 'node:process'],
      }),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === 'host-admission-capability-mismatch',
      `${processName} import without captured value`,
    );
  }
  const uncapturedVersions = durableHostSource.replace(
    'const runtimeVersions = versions;',
    'const runtimeVersions = {};',
  );
  assert.notEqual(uncapturedVersions, durableHostSource);
  await assert.rejects(
    runtimeAuditProbe(uncapturedVersions, {
      relativePath: durableHostPath,
      builtins: ['node:os', 'node:process'],
    }),
    (error: unknown) =>
      error instanceof ServiceFastRuntimeImportAuditError &&
      error.code === 'host-admission-capability-mismatch',
    'versions import without one captured value',
  );

  const acceptedClockPath =
    'src/benchmark/service-fast-numerical-experiment/accepted-run/clock.ts';
  await runtimeAuditProbe(
    'const sample = process.hrtime.bigint();\nvoid sample;\n',
    {
      relativePath: acceptedClockPath,
      capabilities: ['operational-clock'],
    },
  );

  const acceptedEnvironmentPath =
    'src/benchmark/service-fast-numerical-experiment/accepted-run/environment.ts';
  const acceptedEnvironmentSource = [
    "import { availableParallelism, cpus, endianness, release, totalmem, type } from 'node:os';",
    "import { isMainThread } from 'node:worker_threads';",
    'const runtimeVersions = process.versions;',
    'const captured = [',
    '  process.version, runtimeVersions.v8, runtimeVersions.uv,',
    '  process.platform, process.arch, process.execArgv,',
    "  process.env['NODE_OPTIONS'],",
    '  availableParallelism(), cpus(), endianness(), release(), totalmem(), type(),',
    '  isMainThread,',
    '  new Intl.DateTimeFormat().resolvedOptions().timeZone,',
    '];',
    'void captured;',
    '',
  ].join('\n');
  await runtimeAuditProbe(acceptedEnvironmentSource, {
    relativePath: acceptedEnvironmentPath,
    builtins: ['node:os', 'node:worker_threads'],
    capabilities: ['runtime-environment'],
  });
  for (const [hostileEnvironment, code] of [
    [
      `${acceptedEnvironmentSource}const extra = cpus;\nvoid extra();\n`,
      'host-admission-capability-mismatch',
    ],
    [
      `${acceptedEnvironmentSource}const extraIntl = Intl;\nvoid new extraIntl.DateTimeFormat().resolvedOptions().timeZone;\n`,
      'host-admission-capability-mismatch',
    ],
    [
      acceptedEnvironmentSource.replace(
        'import { isMainThread }',
        'import { Worker }',
      ),
      'worker-forbidden',
    ],
    [
      acceptedEnvironmentSource.replace(
        'import { isMainThread }',
        'import { MessagePort }',
      ),
      'worker-forbidden',
    ],
    [
      acceptedEnvironmentSource.replace(
        'import { isMainThread }',
        'import workerThreads',
      ),
      'host-admission-capability-mismatch',
    ],
    [
      acceptedEnvironmentSource.replace(
        'import { isMainThread }',
        'import * as workerThreads',
      ),
      'host-admission-capability-mismatch',
    ],
  ] as const) {
    await assert.rejects(
      runtimeAuditProbe(hostileEnvironment, {
        relativePath: acceptedEnvironmentPath,
        builtins: ['node:os', 'node:worker_threads'],
        capabilities: ['runtime-environment'],
      }),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === code,
    );
  }

  const acceptedPublicationPath =
    'src/benchmark/service-fast-numerical-experiment/accepted-run/publication.ts';
  const acceptedPublicationSource = [
    "import { randomBytes } from 'node:crypto';",
    "import { constants } from 'node:fs';",
    "import { lstat, mkdir, open, readdir, rename, rm, statfs, unlink } from 'node:fs/promises';",
    "import path from 'node:path';",
    'void [constants, lstat, mkdir, open, readdir, rename, rm, statfs, unlink, path];',
    'void randomBytes(12);',
    '',
  ].join('\n');
  await runtimeAuditProbe(acceptedPublicationSource, {
    relativePath: acceptedPublicationPath,
    builtins: ['node:crypto', 'node:fs', 'node:fs/promises', 'node:path'],
    capabilities: ['accepted-publication'],
  });

  const duplicateProfiles: readonly {
    overrides: Parameters<typeof runtimeAuditProbe>[1];
    code: string;
  }[] = [
    {
      overrides: { entryRoots: ['src/main.ts', 'src/main.ts'] },
      code: 'duplicate-entry-root',
    },
    {
      overrides: { nodeBuiltins: ['node:path', 'node:path'] },
      code: 'duplicate-runtime-builtin',
    },
    {
      overrides: { pathBuiltins: ['node:path', 'node:path'] },
      code: 'duplicate-path-builtin',
    },
    {
      overrides: { capabilities: ['hash', 'hash'] },
      code: 'duplicate-path-capability-name',
    },
    {
      overrides: { duplicatePathCapability: true },
      code: 'duplicate-path-capability',
    },
  ];
  for (const duplicate of duplicateProfiles) {
    await assert.rejects(
      runtimeAuditProbe('export {};\n', duplicate.overrides),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === duplicate.code,
      duplicate.code,
    );
  }
});

void test('requires exact builtin reachability independently for every runtime path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rlt087-runtime-path-builtins-'));
  try {
    const sources = Object.freeze({
      'src/main.ts': "import './leaf.ts';\nexport {};\n",
      'src/leaf.ts': "import { createHash } from 'node:crypto';\nvoid createHash('sha256');\n",
    });
    const descriptors = [];
    for (const [relativePath, source] of Object.entries(sources)) {
      await writeSyntheticFile(root, relativePath, source);
      const bytes = new TextEncoder().encode(source);
      descriptors.push(Object.freeze({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }));
    }
    const profile: RuntimeImportAuditProfile = Object.freeze({
      profileId: 'synthetic-path-builtin-audit-v1',
      entryRoots: Object.freeze(['src/main.ts']),
      projectSources: Object.freeze(descriptors),
      nodeBuiltins: Object.freeze(['node:crypto']),
      pathCapabilities: Object.freeze([
        Object.freeze({
          path: 'src/main.ts',
          builtins: Object.freeze(['node:crypto']),
          capabilities: Object.freeze(['hash'] as const),
        }),
        Object.freeze({
          path: 'src/leaf.ts',
          builtins: Object.freeze(['node:crypto']),
          capabilities: Object.freeze(['hash'] as const),
        }),
      ]),
    });
    await assert.rejects(
      auditServiceFastRuntimeImports({
        repositoryRoot: root,
        profile,
        trackedPaths: new Set(Object.keys(sources)),
      }),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === 'crypto-capability-mismatch' &&
        error.artifact === 'src/main.ts',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('dry size admission rejects noncanonical committed input without candidate execution', async () => {
  const config = parseFrozenServiceFastConfiguration(
    Uint8Array.from(await readFile(SERVICE_FAST_CONFIG_PATH)),
  );
  const bytes = await syntheticInputBytes(config);
  const admitted = admitPreSourceClosureArtifactSizes(bytes, config);
  assert.ok(admitted.maximumDirectoryBytes <= admitted.directoryCapBytes);
  assert.equal(admitted.inputWidths.maximumRequestAndAllocationDecimalDigits, 83);
  assert.ok(admitted.inputWidths.maximumReserveOutputAndDeltaDecimalDigits <= 86);
  const firstPolicy = (admitted.dryAnalysis['policyResults'] as readonly Record<string, unknown>[])[0]!;
  const semantic = firstPolicy['semantic'] as Record<string, unknown>;
  assert.equal(semantic['finalObjectivesNeverWorse'], false);
  const firstQualifier = (admitted.dryAnalysis['qualifiers'] as readonly Record<string, unknown>[])[0]!;
  assert.equal(firstQualifier['qualifies'], false);
  assert.equal(
    ((firstQualifier['clauseResults'] as readonly Record<string, unknown>[])[0])?.['passed'],
    false,
  );
  const withoutLineFeed = bytes.slice(0, -1);
  assert.throws(
    () => admitPreSourceClosureArtifactSizes(withoutLineFeed, config),
    /LF-terminated canonical NDJSON/u,
  );
  const unsafe = new TextEncoder().encode(
    new TextDecoder().decode(bytes).replace('"sourceIndex":0', '"sourceIndex":9007199254740992'),
  );
  assert.throws(
    () => admitPreSourceClosureArtifactSizes(unsafe, config),
    /not canonical|minified JSON|wrong source index|safe nonnegative integer/u,
  );
});

void test('strictly decodes nested input fields, relations, cohorts, and exact widths', async () => {
  const config = parseFrozenServiceFastConfiguration(
    Uint8Array.from(await readFile(SERVICE_FAST_CONFIG_PATH)),
  );
  const bytes = await syntheticInputBytes(config);
  const nested = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
  const successReceipt = (record: Record<string, unknown>): Record<string, unknown> =>
    nested(nested(nested(record['entryBaseline'])['incumbent'])['receipt']);
  const transition = (
    poolId: string,
    assetIn: unknown,
    assetOut: unknown,
    amountIn: string,
    amountOut: string,
  ): Record<string, unknown> => {
    const reserveInBefore = `1${'0'.repeat(85)}`;
    const reserveOutBefore = `1${'0'.repeat(85)}`;
    return {
      poolId,
      assetIn,
      assetOut,
      amountIn,
      amountOut,
      reserveInBefore,
      reserveOutBefore,
      reserveInAfter: (BigInt(reserveInBefore) + BigInt(amountIn)).toString(10),
      reserveOutAfter: (BigInt(reserveOutBefore) - BigInt(amountOut)).toString(10),
    };
  };
  const receiptLeg = (
    record: Record<string, unknown>,
    poolId: string,
    allocation: string,
  ): Record<string, unknown> => {
    const request = nested(record['request']);
    const snapshot = nested(record['snapshot']);
    return {
      allocation,
      receipt: {
        snapshotId: snapshot['snapshotId'],
        snapshotChecksum: snapshot['snapshotChecksum'],
        assetIn: request['assetIn'],
        assetOut: request['assetOut'],
        amountIn: allocation,
        amountOut: '1',
        hops: [transition(poolId, request['assetIn'], request['assetOut'], allocation, '1')],
      },
    };
  };
  const mutations: readonly {
    name: string;
    mutate: (record: Record<string, unknown>) => void;
    sourceIndex?: number;
    code?: string;
  }[] = [
    {
      name: 'nested-shape',
      mutate: (record) => { delete nested(record['request'])['topology']; },
    },
    {
      name: 'nested-type',
      mutate: (record) => { nested(record['request'])['maxHops'] = '2'; },
    },
    {
      name: 'enum',
      mutate: (record) => { nested(record['priorEligibility'])['status'] = 'hostile'; },
    },
    {
      name: 'canonical-decimal',
      mutate: (record) => { nested(record['request'])['amountIn'] = '01'; },
    },
    {
      name: 'request-width',
      mutate: (record) => { nested(record['request'])['amountIn'] = '9'.repeat(84); },
    },
    {
      name: 'hash',
      mutate: (record) => { nested(record['snapshot'])['snapshotChecksum'] = `sha256:${'A'.repeat(64)}`; },
    },
    {
      name: 'route-key',
      mutate: (record) => {
        const discovery = nested(record['candidateDiscovery']);
        const candidateSet = nested((discovery['candidateSets'] as unknown[])[0]);
        const route = nested((candidateSet['routes'] as unknown[])[0]);
        route['routeKey'] = `${String(route['routeKey'])} `;
      },
    },
    {
      name: 'singleton-candidate-set',
      code: 'invalid-input-routes',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        const routes = set['routes'] as unknown[];
        set['routes'] = [routes[0]];
        set['candidateSetKey'] = JSON.stringify([
          JSON.parse(String(nested(routes[0])['routeKey'])),
        ]);
      },
    },
    {
      name: 'nested-field-order',
      mutate: (record) => {
        const request = nested(record['request']);
        record['request'] = {
          assetOut: request['assetOut'],
          assetIn: request['assetIn'],
          amountBucket: request['amountBucket'],
          amountIn: request['amountIn'],
          topology: request['topology'],
          maxHops: request['maxHops'],
          maxRoutes: request['maxRoutes'],
          greedyParts: request['greedyParts'],
        };
      },
    },
    {
      name: 'cohort-identity',
      mutate: (record) => { record['requestId'] = `${String(record['requestId'])}-changed`; },
    },
    {
      name: 'timing-index',
      mutate: (record) => { record['timingCohortIndex'] = 1; },
    },
    {
      name: 'resolution-coupling',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        set['resolutionStatus'] = 'resolved';
        set['failureCode'] = null;
      },
    },
    {
      name: 'failed-resolution-nonnull-route',
      code: 'candidate-resolution-coupling-mismatch',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        const route = nested((set['routes'] as unknown[])[0]);
        const hop = nested((route['hops'] as unknown[])[0]);
        route['resolvedHops'] = [{
          ...hop,
          reserveIn: '100',
          reserveOut: '100',
          feeChargedNumerator: '3',
          feeDenominator: '1000',
        }];
      },
    },
    {
      name: 'failed-resolution-wrong-failure',
      code: 'candidate-resolution-coupling-mismatch',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        set['failureCode'] = 'non-finite-proposal';
      },
    },
    {
      name: 'resolved-resolution-null-route',
      sourceIndex: 1,
      code: 'candidate-resolution-coupling-mismatch',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        nested((set['routes'] as unknown[])[0])['resolvedHops'] = null;
      },
    },
    {
      name: 'incomplete-candidate-discovery',
      code: 'candidate-discovery-incomplete',
      mutate: (record) => {
        nested(record['candidateDiscovery'])['termination'] = 'work-limit';
      },
    },
    {
      name: 'candidate-discovery-cap',
      code: 'candidate-discovery-counter-mismatch',
      mutate: (record) => {
        nested(nested(record['candidateDiscovery'])['counters'])['pathExpansions'] = 122;
      },
    },
    {
      name: 'candidate-discovery-counter-relation',
      code: 'candidate-discovery-counter-mismatch',
      mutate: (record) => {
        nested(nested(record['candidateDiscovery'])['counters'])['enumeratedPaths'] = 1;
      },
    },
    {
      name: 'candidate-retained-count',
      code: 'invalid-input-candidate-sets',
      mutate: (record) => {
        nested(nested(record['candidateDiscovery'])['counters'])['enumeratedCandidateSets'] = 0;
      },
    },
    {
      name: 'resolved-hop-identity',
      sourceIndex: 1,
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        const route = nested((set['routes'] as unknown[])[0]);
        nested((route['resolvedHops'] as unknown[])[0])['poolId'] = 'different-pool';
      },
    },
    {
      name: 'resolved-hop-length',
      sourceIndex: 1,
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        nested((set['routes'] as unknown[])[0])['resolvedHops'] = [];
      },
    },
    {
      name: 'receipt-allocation-sum',
      mutate: (record) => {
        const incumbent = nested(nested(record['entryBaseline'])['incumbent']);
        const receipt = nested(incumbent['receipt']);
        nested((receipt['legs'] as unknown[])[0])['allocation'] = '1';
      },
    },
    {
      name: 'zero-transition-output',
      code: 'invalid-input-decimal',
      mutate: (record) => {
        const receipt = successReceipt(record);
        const routeReceipt = nested(nested((receipt['legs'] as unknown[])[0])['receipt']);
        nested((routeReceipt['hops'] as unknown[])[0])['amountOut'] = '0';
      },
    },
    {
      name: 'zero-route-output',
      code: 'invalid-input-decimal',
      mutate: (record) => {
        const receipt = successReceipt(record);
        nested(nested((receipt['legs'] as unknown[])[0])['receipt'])['amountOut'] = '0';
      },
    },
    {
      name: 'zero-split-output',
      code: 'invalid-input-decimal',
      mutate: (record) => {
        successReceipt(record)['amountOut'] = '0';
      },
    },
    {
      name: 'zero-objective-output',
      code: 'invalid-input-decimal',
      mutate: (record) => {
        nested(nested(nested(record['entryBaseline'])['incumbent'])['objective'])['amountOut'] = '0';
      },
    },
    {
      name: 'objective-coupling',
      mutate: (record) => {
        const incumbent = nested(nested(record['entryBaseline'])['incumbent']);
        nested(incumbent['objective'])['amountOut'] = '2';
      },
    },
    {
      name: 'receipt-hash',
      mutate: (record) => {
        nested(nested(record['entryBaseline'])['incumbent'])['receiptHash'] = `sha256:${'0'.repeat(64)}`;
      },
    },
    {
      name: 'reserve-width',
      mutate: (record) => {
        const incumbent = nested(nested(record['entryBaseline'])['incumbent']);
        const receipt = nested(incumbent['receipt']);
        const leg = nested((receipt['legs'] as unknown[])[0]);
        const routeReceipt = nested(leg['receipt']);
        nested((routeReceipt['hops'] as unknown[])[0])['reserveInBefore'] = '9'.repeat(87);
      },
    },
    {
      name: 'repeated-pool-route',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        const route = nested((set['routes'] as unknown[])[0]);
        const first = nested((route['hops'] as unknown[])[0]);
        const middle = 'middle-asset';
        const hops = [
          { poolId: first['poolId'], assetIn: first['assetIn'], assetOut: middle },
          { poolId: first['poolId'], assetIn: middle, assetOut: first['assetOut'] },
        ];
        route['hops'] = hops;
        route['routeKey'] = JSON.stringify(hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut]));
        set['candidateSetKey'] = JSON.stringify([hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])]);
      },
    },
    {
      name: 'candidate-set-pool-overlap',
      mutate: (record) => {
        const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
        const firstRoute = structuredClone(nested((set['routes'] as unknown[])[0]));
        const secondRoute = structuredClone(firstRoute);
        set['routes'] = [firstRoute, secondRoute];
        set['candidateSetKey'] = JSON.stringify([
          JSON.parse(String(firstRoute['routeKey'])),
          JSON.parse(String(secondRoute['routeKey'])),
        ]);
      },
    },
    {
      name: 'candidate-set-duplicate-across-sets',
      code: 'candidate-set-order-mismatch',
      mutate: (record) => {
        const discovery = nested(record['candidateDiscovery']);
        const first = structuredClone(nested((discovery['candidateSets'] as unknown[])[0]));
        const duplicate = structuredClone(first);
        duplicate['setIndex'] = 1;
        discovery['candidateSets'] = [first, duplicate];
        const counters = nested(discovery['counters']);
        counters['candidateSetExpansions'] = 2;
        counters['enumeratedCandidateSets'] = 2;
      },
    },
    {
      name: 'candidate-set-decoded-order-across-sets',
      code: 'candidate-set-order-mismatch',
      mutate: (record) => {
        const discovery = nested(record['candidateDiscovery']);
        const first = structuredClone(nested((discovery['candidateSets'] as unknown[])[0]));
        const second = structuredClone(first);
        second['setIndex'] = 1;
        const route = nested((second['routes'] as unknown[])[0]);
        const hop = nested((route['hops'] as unknown[])[0]);
        hop['poolId'] = '0';
        route['routeKey'] = JSON.stringify([[hop['assetIn'], hop['poolId'], hop['assetOut']]]);
        second['candidateSetKey'] = JSON.stringify(
          (second['routes'] as Record<string, unknown>[]).map((candidateRoute) =>
            JSON.parse(String(candidateRoute['routeKey'])) as unknown),
        );
        discovery['candidateSets'] = [first, second];
        const counters = nested(discovery['counters']);
        counters['candidateSetExpansions'] = 2;
        counters['enumeratedCandidateSets'] = 2;
      },
    },
    {
      name: 'receipt-repeated-pool',
      code: 'non-simple-input-route',
      mutate: (record) => {
        const request = nested(record['request']);
        const receipt = successReceipt(record);
        const routeReceipt = nested(nested((receipt['legs'] as unknown[])[0])['receipt']);
        routeReceipt['hops'] = [
          transition('repeated-receipt-pool', request['assetIn'], 'middle-asset', String(routeReceipt['amountIn']), '1'),
          transition('repeated-receipt-pool', 'middle-asset', request['assetOut'], '1', '1'),
        ];
      },
    },
    {
      name: 'receipt-repeated-asset',
      code: 'non-simple-input-route',
      mutate: (record) => {
        const request = nested(record['request']);
        const receipt = successReceipt(record);
        const routeReceipt = nested(nested((receipt['legs'] as unknown[])[0])['receipt']);
        routeReceipt['hops'] = [
          transition('receipt-pool-a', request['assetIn'], request['assetIn'], String(routeReceipt['amountIn']), '1'),
          transition('receipt-pool-b', request['assetIn'], request['assetOut'], '1', '1'),
        ];
      },
    },
    {
      name: 'receipt-leg-pool-overlap',
      code: 'receipt-pool-overlap',
      mutate: (record) => {
        const receipt = successReceipt(record);
        const firstLeg = structuredClone(nested((receipt['legs'] as unknown[])[0]));
        receipt['legs'] = [firstLeg, structuredClone(firstLeg)];
      },
    },
    {
      name: 'receipt-decoded-leg-order',
      code: 'receipt-route-order-mismatch',
      mutate: (record) => {
        const receipt = successReceipt(record);
        const amountIn = String(receipt['amountIn']);
        receipt['amountOut'] = '2';
        receipt['legs'] = [
          receiptLeg(record, '0', '1'),
          receiptLeg(record, '"', (BigInt(amountIn) - 1n).toString(10)),
        ];
      },
    },
    {
      name: 'receipt-transition-reserve-coupling',
      code: 'transition-reserve-coupling-mismatch',
      mutate: (record) => {
        const receipt = successReceipt(record);
        const routeReceipt = nested(nested((receipt['legs'] as unknown[])[0])['receipt']);
        const hop = nested((routeReceipt['hops'] as unknown[])[0]);
        hop['reserveInAfter'] = hop['reserveInBefore'];
      },
    },
    {
      name: 'receipt-hop-amount-continuity',
      code: 'receipt-hop-amount-mismatch',
      mutate: (record) => {
        const request = nested(record['request']);
        const receipt = successReceipt(record);
        const routeReceipt = nested(nested((receipt['legs'] as unknown[])[0])['receipt']);
        routeReceipt['hops'] = [
          transition('receipt-amount-pool-a', request['assetIn'], 'middle-asset', String(routeReceipt['amountIn']), '2'),
          transition('receipt-amount-pool-b', 'middle-asset', request['assetOut'], '1', String(routeReceipt['amountOut'])),
        ];
      },
    },
    {
      name: 'objective-route-mismatch',
      code: 'objective-receipt-mismatch',
      mutate: (record) => {
        const objective = nested(nested(nested(record['entryBaseline'])['incumbent'])['objective']);
        objective['routeKeys'] = [JSON.stringify([['wrong', 'route', 'key']])];
      },
    },
    {
      name: 'objective-allocation-mismatch',
      code: 'objective-receipt-mismatch',
      mutate: (record) => {
        const objective = nested(nested(nested(record['entryBaseline'])['incumbent'])['objective']);
        objective['allocations'] = ['1'];
      },
    },
    {
      name: 'success-fields-with-no-route-status',
      code: 'no-plan-incumbent-coupling-mismatch',
      mutate: (record) => {
        const incumbent = nested(nested(record['entryBaseline'])['incumbent']);
        incumbent['status'] = 'no-route';
        incumbent['reason'] = 'no-route';
      },
    },
    {
      name: 'success-receipt-with-no-plan-objective',
      code: 'no-plan-objective-mismatch',
      mutate: (record) => {
        const objective = nested(nested(nested(record['entryBaseline'])['incumbent'])['objective']);
        objective['hasPlan'] = false;
        objective['amountOut'] = null;
        objective['legCount'] = null;
        objective['totalHops'] = null;
        objective['routeKeys'] = [];
        objective['allocations'] = [];
      },
    },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => admitPreSourceClosureArtifactSizes(
        mutateSyntheticInput(bytes, mutation.mutate, mutation.sourceIndex ?? 0),
        config,
      ),
      (error: unknown) =>
        error instanceof Error &&
        (mutation.code === undefined ||
          (error instanceof ServiceFastSizeAdmissionError && error.code === mutation.code)),
      mutation.name,
    );
  }

  const decodedOrdering = mutateSyntheticInput(bytes, (record) => {
    const set = nested((nested(record['candidateDiscovery'])['candidateSets'] as unknown[])[0]);
    const request = nested(record['request']);
    const routes = ['"', '0'].map((poolId) => {
      const hops = [{
        poolId,
        assetIn: request['assetIn'],
        assetOut: request['assetOut'],
      }];
      return {
        routeKey: JSON.stringify(hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])),
        hops,
        resolvedHops: null,
      };
    });
    set['routes'] = routes;
    set['candidateSetKey'] = JSON.stringify(routes.map((route) =>
      route.hops.map((hop) => [hop.assetIn, hop.poolId, hop.assetOut])));
  });
  assert.doesNotThrow(() => admitPreSourceClosureArtifactSizes(decodedOrdering, config));
});

void test('renders only the three closure-bound README decisions within the maximal witness', () => {
  const hash = `sha256:${'a'.repeat(64)}`;
  const selectedPolicyId =
    'fixed-newton-sqrt-o64-n8--final-finite-replay--bounded-exact-neighborhood-v1';
  const base = Object.freeze({
    experimentId: SERVICE_FAST_EXPERIMENT_ID,
    implementationRevision: 'b'.repeat(40),
    inputArtifact: Object.freeze({ path: 'inputs.ndjson', bytes: 1, sha256: hash }),
    sourceClosure: Object.freeze({ path: 'source-closure.v1.json', bytes: 1, sha256: hash }),
    environment: Object.freeze({ timezone: 'Pacific/Fiji' }),
  });
  const decisions: readonly ServiceFastReadmeDecision[] = Object.freeze([
    Object.freeze({
      status: 'selected-policy' as const,
      policyId: selectedPolicyId,
      fallbackDecisionId: null,
    }),
    Object.freeze({
      status: 'strict-reference-fallback' as const,
      policyId: null,
      fallbackDecisionId: 'strict-reference-fallback' as const,
    }),
    Object.freeze({
      status: 'rejected-observation' as const,
      policyId: null,
      fallbackDecisionId: null,
    }),
  ]);
  const rendered = decisions.map((decision) =>
    renderServiceFastExperimentReadme(Object.freeze({ ...base, decision })));
  assert.equal(rendered[0], [
    '# Service-fast numerical experiment',
    '',
    `Experiment: \`${SERVICE_FAST_EXPERIMENT_ID}\``,
    `Implementation/input revision: \`${'b'.repeat(40)}\``,
    `Input artifact: \`${hash}\``,
    `Source closure: \`${hash}\``,
    `Decision: \`selected-policy\` / \`${selectedPolicyId}\``,
    'Recorded timezone: `Pacific/Fiji`',
    '',
    'This retained evidence covers only the frozen numerical candidate stage. It does not make the selected policy supported, establish full-service latency, load or concurrency behavior, representative demand, production financial execution, or unrestricted optimality.',
    '',
  ].join('\n'));
  assert.match(rendered[1] ?? '', /Decision: `strict-reference-fallback` \/ `strict-reference-fallback`/u);
  assert.match(rendered[2] ?? '', /Decision: `rejected-observation` \/ `none`/u);
  assert.equal(rendered.some((value) => value.includes('manifest')), false);

  const maximal = renderMaximalServiceFastExperimentReadme();
  assert.deepEqual(
    maximal.witnesses.map(({ decisionStatus, decisionIdentity }) =>
      [decisionStatus, decisionIdentity]),
    [
      ['selected-policy', selectedPolicyId],
      ['strict-reference-fallback', 'strict-reference-fallback'],
      ['rejected-observation', 'none'],
    ],
  );
  const encoder = new TextEncoder();
  assert.equal(maximal.bytes, encoder.encode(maximal.readme).byteLength);
  assert.ok(maximal.bytes <= 1_048_576);
  const maximalTimezone = 'T'.repeat(128);
  assert.equal(encoder.encode(maximalTimezone).byteLength, 128);
  assert.ok(maximal.witnesses.every((witness) =>
    witness.readme.includes(`Recorded timezone: \`${maximalTimezone}\``)));
  assert.ok(rendered.every((value) => encoder.encode(value).byteLength <= maximal.bytes));
  assert.throws(
    () => renderServiceFastExperimentReadme({
      ...base,
      decision: {
        status: 'selected-policy',
        policyId: 'bisection-o64-i64--strict-reject--current',
        fallbackDecisionId: null,
      },
    }),
    (error: unknown) =>
      error instanceof ServiceFastReadmeRenderingError &&
      error.code === 'invalid-readme-decision',
  );
  assert.throws(
    () => renderServiceFastExperimentReadme({
      ...base,
      decision: {
        status: 'selected-policy',
        policyId: 'x'.repeat(1_100_000),
        fallbackDecisionId: null,
      },
    }),
    (error: unknown) =>
      error instanceof ServiceFastReadmeRenderingError &&
      error.code === 'invalid-readme-decision',
  );
  for (const timezone of [
    ' Pacific/Fiji ',
    'not a timezone',
    'line one\n`line two`\t',
    '😀'.repeat(32),
  ]) {
    const unusual = renderServiceFastExperimentReadme({
      ...base,
      environment: { timezone },
      decision: decisions[0]!,
    });
    assert.ok(
      unusual.includes(`Recorded timezone: \`${timezone}\``),
      'README changed the captured timezone string',
    );
  }
  for (const timezone of ['', 'x'.repeat(129), 'é'.repeat(65)]) {
    assert.throws(
      () => renderServiceFastExperimentReadme({
        ...base,
        environment: { timezone },
        decision: decisions[0]!,
      }),
      (error: unknown) =>
        error instanceof ServiceFastReadmeRenderingError &&
        error.code === 'invalid-readme-environment',
    );
  }
});

function syntheticAcceptedScheduleRecords(): readonly AcceptedInputRecord[] {
  const cases = Object.freeze([
    Object.freeze({ caseId: 'historical-anchor', records: 396, timing: 72 }),
    Object.freeze({ caseId: 'synthetic-dual-spanning-tree', records: 396, timing: 108 }),
    Object.freeze({ caseId: 'synthetic-reserve-compressed-1e12', records: 396, timing: 72 }),
    Object.freeze({ caseId: 'synthetic-reserve-amplified-1e60', records: 396, timing: 0 }),
  ]);
  const records: AcceptedInputRecord[] = [];
  let timingCohortIndex = 0;
  for (const suiteCase of cases) {
    for (let requestIndex = 0; requestIndex < suiteCase.records; requestIndex += 1) {
      const service = suiteCase.timing > 0;
      records.push(Object.freeze({
        value: Object.freeze({}),
        sourceIndex: records.length,
        caseId: suiteCase.caseId,
        requestId: `${suiteCase.caseId}-${requestIndex}`,
        timingCohortIndex: requestIndex < suiteCase.timing
          ? timingCohortIndex++
          : null,
        serviceDecisionMember: service,
        amplifiedStressMember: !service,
      }));
    }
  }
  return Object.freeze(records);
}

void test('enumerates the frozen accepted schedule and exact case boundaries lazily', () => {
  const records = syntheticAcceptedScheduleRecords();
  let semanticCount = 0;
  for (const item of acceptedSemanticSchedule(records)) {
    assert.equal(item.observationIndex, semanticCount);
    semanticCount += 1;
  }
  assert.equal(semanticCount, ACCEPTED_EXECUTION_SCHEDULE.semanticCalls);

  let callWarmups = 0;
  let callRetained = 0;
  const callBoundaries = new Map<number, string>();
  for (const item of acceptedCallProtocolSchedule(records)) {
    if (item.phase === 'call-warmup') {
      callWarmups += 1;
    } else {
      assert.equal(item.observationIndex, callRetained);
      if ([0, 8_639, 8_640, 21_599, 21_600, 30_239].includes(callRetained)) {
        callBoundaries.set(callRetained, item.cell.caseId);
      }
      callRetained += 1;
    }
  }
  assert.equal(callWarmups, ACCEPTED_EXECUTION_SCHEDULE.callWarmups);
  assert.equal(callRetained, ACCEPTED_EXECUTION_SCHEDULE.callRetained);
  assert.deepEqual([...callBoundaries], [
    [0, 'historical-anchor'],
    [8_639, 'historical-anchor'],
    [8_640, 'synthetic-dual-spanning-tree'],
    [21_599, 'synthetic-dual-spanning-tree'],
    [21_600, 'synthetic-reserve-compressed-1e12'],
    [30_239, 'synthetic-reserve-compressed-1e12'],
  ]);

  let timelineCount = 0;
  const timelineBoundaries = new Map<number, string>();
  for (const item of acceptedTimelineSchedule(records)) {
    assert.equal(item.observationIndex, timelineCount);
    if ([0, 5_183, 5_184, 12_959, 12_960, 18_143].includes(timelineCount)) {
      timelineBoundaries.set(timelineCount, item.cell.caseId);
    }
    timelineCount += 1;
  }
  assert.equal(timelineCount, ACCEPTED_EXECUTION_SCHEDULE.timelineRetained);
  assert.deepEqual([...timelineBoundaries], [
    [0, 'historical-anchor'],
    [5_183, 'historical-anchor'],
    [5_184, 'synthetic-dual-spanning-tree'],
    [12_959, 'synthetic-dual-spanning-tree'],
    [12_960, 'synthetic-reserve-compressed-1e12'],
    [18_143, 'synthetic-reserve-compressed-1e12'],
  ]);

  let deadlineWarmups = 0;
  let deadlineRetained = 0;
  const deadlineBoundaries = new Map<number, string>();
  let finalDeadlinePolicy: number | null = null;
  for (const item of acceptedDeadlineProtocolSchedule(records)) {
    if (item.phase === 'deadline-warmup') {
      deadlineWarmups += 1;
    } else {
      assert.equal(item.observationIndex, deadlineRetained);
      if ([0, 31_103, 31_104, 77_759, 77_760, 108_863].includes(deadlineRetained)) {
        deadlineBoundaries.set(deadlineRetained, item.cell.caseId);
      }
      finalDeadlinePolicy = item.policyMatrixIndex;
      deadlineRetained += 1;
    }
  }
  assert.equal(deadlineWarmups, ACCEPTED_EXECUTION_SCHEDULE.deadlineWarmups);
  assert.equal(deadlineRetained, ACCEPTED_EXECUTION_SCHEDULE.deadlineRetained);
  assert.equal(finalDeadlinePolicy, 17);
  assert.deepEqual([...deadlineBoundaries], [
    [0, 'historical-anchor'],
    [31_103, 'historical-anchor'],
    [31_104, 'synthetic-dual-spanning-tree'],
    [77_759, 'synthetic-dual-spanning-tree'],
    [77_760, 'synthetic-reserve-compressed-1e12'],
    [108_863, 'synthetic-reserve-compressed-1e12'],
  ]);
  assert.equal(
    semanticCount + callWarmups + callRetained + timelineCount +
      deadlineWarmups + deadlineRetained,
    ACCEPTED_EXECUTION_SCHEDULE.totalPolicyCalls,
  );
});

void test('uses an injected monotonic clock and the explicit trustworthy no-qualifier fallback', () => {
  const samples = [100n, 115n];
  const measured = measureAcceptedInvocation(
    () => samples.shift() ?? assert.fail('unexpected clock sample'),
    (entry) => {
      assert.equal(entry, 100n);
      return 'complete';
    },
  );
  assert.deepEqual(measured, {
    value: 'complete',
    entrySample: 100n,
    returnSample: 115n,
  });
  assert.throws(
    () => measureAcceptedInvocation(
      (() => {
        const reversed = [2n, 1n];
        return () => reversed.shift() ?? 0n;
      })(),
      () => null,
    ),
    (error: unknown) =>
      error instanceof AcceptedRunFailure &&
      error.envelope.phase === 'candidate',
  );
  assert.deepEqual(decideAcceptedPolicy([], []), {
    status: 'strict-reference-fallback',
    policyId: null,
    fallbackDecisionId: 'strict-reference-fallback',
    rankedQualifyingPolicyIds: [],
    reason: 'trustworthy-complete-no-policy-qualified',
  });
});

void test('bounds every accepted clock sample and constructed absolute deadline', () => {
  assert.equal(
    admitAcceptedClockSample(ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS),
    ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS,
  );
  for (const sample of [-1n, ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS + 1n]) {
    assert.throws(
      () => admitAcceptedClockSample(sample),
      (error: unknown) =>
        error instanceof AcceptedRunFailure && error.envelope.phase === 'candidate',
    );
  }
  assert.equal(acceptedAbsoluteDeadline(0n, 1), 1_000_000n);
  assert.throws(
    () => acceptedAbsoluteDeadline(ACCEPTED_MAXIMUM_CLOCK_NANOSECONDS, 1),
    (error: unknown) =>
      error instanceof AcceptedRunFailure && error.envelope.phase === 'candidate',
  );
});

void test('rechecks every closure-bound byte sequence immediately before candidates', async () => {
  const bytes = new TextEncoder().encode('closure-bound');
  const bound = Object.freeze({
    path: 'synthetic/bound.ts',
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
  let calls = 0;
  await recheckAcceptedBoundBytes('/synthetic/repository', [bound], {
    readIdentity: (options) => {
      calls += 1;
      assert.deepEqual(options, {
        repositoryRoot: '/synthetic/repository',
        relativePath: bound.path,
        maximumBytes: bound.bytes,
        expectedBytes: bound.bytes,
      });
      return Promise.resolve(bytes);
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(
    recheckAcceptedBoundBytes('/synthetic/repository', [bound], {
      readIdentity: () => Promise.resolve(new TextEncoder().encode('closure-tampered')),
    }),
    (error: unknown) =>
      error instanceof AcceptedRunFailure &&
      error.envelope.cause === 'repository-state-mismatch' &&
      error.envelope.phase === 'preflight',
  );
});

void test('qualifies all six clauses and applies every deterministic ranking tie-break', () => {
  const rational = (numerator: string, denominator: string): AcceptedJsonObject =>
    Object.freeze({ numerator, denominator });
  const qualifyingResult: AcceptedJsonObject = Object.freeze({
    policyId: 'qualifying-policy',
    semantic: Object.freeze({
      invalidFreshReplayCount: 0,
      forcedFailureIncumbentMismatchCount: 0,
      finalObjectivesNeverWorse: true,
      anchorPlanLostCount: 0,
      unterminatedDiagnosticCount: 0,
      anchorServiceFailures: Object.freeze({
        nonConvergence: 2,
        residualOptionsExhausted: 1,
      }),
      candidateServiceFailures: Object.freeze({
        nonConvergence: 1,
        residualOptionsExhausted: 1,
      }),
      amplifiedFailures: Object.freeze({
        untypedFailures: 0,
        exactSafetyFailures: 0,
      }),
    }),
    callCases: Object.freeze(ACCEPTED_OPERATIONAL_CASE_IDS.map((caseId) => Object.freeze({
      caseId,
      pairedDeltaMedian: rational('0', '1'),
      elapsedRatio: rational(
        ACCEPTED_HOTSPOT_CASE_IDS.includes(
          caseId as typeof ACCEPTED_HOTSPOT_CASE_IDS[number],
        ) ? '9' : '1',
        ACCEPTED_HOTSPOT_CASE_IDS.includes(
          caseId as typeof ACCEPTED_HOTSPOT_CASE_IDS[number],
        ) ? '10' : '1',
      ),
    }))),
    deadlineCases: Object.freeze([Object.freeze({
      caseId: ACCEPTED_HOTSPOT_CASE_IDS[0],
      anchor: Object.freeze({ entryPlan: 1, anchorQuality: 1 }),
      candidate: Object.freeze({ entryPlan: 1, anchorQuality: 2 }),
    })]),
    instrumentedEvents: Object.freeze([Object.freeze({
      anchorAvailabilityCount: 1,
      candidateAvailabilityCount: 1,
      pairedFiniteCount: 1,
      pairedFiniteMedianDelta: rational('-1', '1'),
    })]),
  });
  const qualification = qualifyAcceptedPolicy(qualifyingResult);
  assert.equal(qualification['qualifies'], true);
  const clauses = qualification['clauseResults'];
  assert.ok(Array.isArray(clauses));
  assert.equal(clauses.length, 6);
  assert.equal(clauses.every((entry) =>
    (entry as AcceptedJsonObject)['passed'] === true), true);

  const ranked = (
    ratioNumerator: string,
    quality: number,
    ceiling: number,
    policyMatrixIndex: number,
  ): AcceptedJsonObject => Object.freeze({
    rankingValues: Object.freeze({
      worstHotspotElapsedRatio: rational(ratioNumerator, '10'),
      anchorQualityVector: Object.freeze([quality]),
      mappedShareActionCeiling: ceiling,
      policyMatrixIndex,
    }),
  });
  assert.ok(compareAcceptedPolicyResults(ranked('8', 1, 2, 2), ranked('9', 9, 1, 1)) < 0);
  assert.ok(compareAcceptedPolicyResults(ranked('8', 2, 2, 2), ranked('8', 1, 1, 1)) < 0);
  assert.ok(compareAcceptedPolicyResults(ranked('8', 2, 1, 2), ranked('8', 2, 2, 1)) < 0);
  assert.ok(compareAcceptedPolicyResults(ranked('8', 2, 1, 1), ranked('8', 2, 1, 2)) < 0);
});

void test('keeps analysis medians and ratios as exact unreduced bigint witnesses', () => {
  const accumulator = new AcceptedAnalysisAccumulator();
  for (let policyMatrixIndex = 0;
    policyMatrixIndex < ACCEPTED_POLICY_IDS.length;
    policyMatrixIndex += 1) {
    for (const [caseIndex, caseId] of ACCEPTED_OPERATIONAL_CASE_IDS.entries()) {
      for (let sweepIndex = 0; sweepIndex < 5; sweepIndex += 1) {
        accumulator.acceptCall(Object.freeze({
          policyMatrixIndex,
          caseId,
          timingCohortIndex: caseIndex,
          sweepIndex,
          elapsedNanoseconds: String(policyMatrixIndex + 2),
        }));
      }
      for (const deadlineMilliseconds of ACCEPTED_DEADLINES_MS) {
        for (let sweepIndex = 0; sweepIndex < 3; sweepIndex += 1) {
          accumulator.acceptDeadline(Object.freeze({
            policyMatrixIndex,
            caseId,
            deadlineMilliseconds,
            sweepIndex,
            entryPlan: false,
            anyValidScore: false,
            anyImprovement: false,
            anchorQuality: false,
            completeStage: false,
          }));
        }
      }
    }
    for (const [caseIndex, caseId] of ACCEPTED_HOTSPOT_CASE_IDS.entries()) {
      for (let sweepIndex = 0; sweepIndex < 3; sweepIndex += 1) {
        accumulator.acceptTimeline(Object.freeze({
          policyMatrixIndex,
          caseId,
          timingCohortIndex: caseIndex,
          sweepIndex,
          firstStrictImprovementNanoseconds: null,
          finalBestInstallNanoseconds: null,
        }));
      }
    }
  }
  const driverIds = [...new Set(ACCEPTED_POLICY_IDS.map((policyId) =>
    policyId.split('--')[0] as string))];
  const config: AcceptedJsonObject = Object.freeze({
    acceptedBaseRevision: 'a'.repeat(40),
    policyMatrix: Object.freeze({
      drivers: Object.freeze(driverIds.map((driverId) => Object.freeze({
        driverId,
        maximumShareActions: 1,
      }))),
    }),
  });
  const hash = `sha256:${'b'.repeat(64)}`;
  const descriptor = Object.freeze({ path: 'synthetic', bytes: 1, sha256: hash });
  const analysis = buildAcceptedAnalysis(
    accumulator,
    config,
    Object.freeze({ implementationInputRevision: 'c'.repeat(40) }),
    Object.freeze({
      config: descriptor,
      artifactSchema: descriptor,
      sourceClosure: descriptor,
      inputArtifact: descriptor,
    }),
    Object.freeze({ timezone: 'Pacific/Fiji' }),
  );
  const policyResults = analysis['policyResults'];
  assert.ok(Array.isArray(policyResults));
  const anchor = policyResults[0] as AcceptedJsonObject;
  const callCases = anchor['callCases'];
  assert.ok(Array.isArray(callCases));
  assert.deepEqual((callCases[0] as AcceptedJsonObject)['elapsedRatio'], {
    numerator: '2',
    denominator: '2',
  });
  assert.deepEqual((callCases[0] as AcceptedJsonObject)['pairedDeltaMedian'], {
    numerator: '0',
    denominator: '1',
  });
  assert.deepEqual(analysis['decision'], {
    status: 'strict-reference-fallback',
    policyId: null,
    fallbackDecisionId: 'strict-reference-fallback',
    rankedQualifyingPolicyIds: [],
    reason: 'trustworthy-complete-no-policy-qualified',
  });
});

void test('encodes one closed six-field accepted-run failure line', () => {
  assert.equal(
    encodeAcceptedRunFailure(
      acceptedRunFailure(
        'precommit-artifact-write',
        false,
        'owned-staging-cleanup-failure',
      ),
      'invocation',
    ),
    '{"ok":false,"cause":"artifact-write-failure","phase":"publication-precommit","detailCode":"artifact-write-failure","committed":false,"secondaryCleanup":{"cause":"owned-staging-cleanup-failure","detailCode":"owned-staging-cleanup-failure"}}\n',
  );
});

void test('projects every internal failure through one exact getter-safe registry', () => {
  assert.deepEqual(
    [...new Set(Object.values(ACCEPTED_RUN_INTERNAL_FAILURE_REGISTRY).map(
      (projection) => projection.cause,
    ))].sort(),
    [
      'artifact-sync-failure',
      'artifact-write-failure',
      'environment-admission-failure',
      'filesystem-not-admitted',
      'final-destination-conflict',
      'initial-destination-conflict',
      'invalid-invocation',
      'owned-lock-cleanup-failure',
      'owned-staging-cleanup-failure',
      'postcommit-parent-sync-failure',
      'provisional-destination-cleanup-failure',
      'publication-lock-conflict',
      'publication-rename-failure',
      'repository-state-mismatch',
      'runtime-import-closure-mismatch',
      'unexpected-tool-exception',
    ],
  );
  const original = acceptedRunFailure('precommit-artifact-write');
  const throwingGet = new Proxy(original, {
    get: () => { throw new Error('hostile getter text'); },
  });
  assert.deepEqual(
    acceptedRunFailureEnvelope(throwingGet, 'invocation'),
    {
      ok: false,
      cause: 'unexpected-tool-exception',
      phase: 'invocation',
      detailCode: 'unexpected-tool-exception',
      committed: false,
      secondaryCleanup: null,
    },
  );
  const throwingDescriptor = new Proxy({}, {
    getOwnPropertyDescriptor: () => { throw new Error('hostile proxy text'); },
  });
  assert.deepEqual(
    acceptedRunFailureEnvelope(throwingDescriptor, 'candidate'),
    {
      ok: false,
      cause: 'unexpected-tool-exception',
      phase: 'candidate',
      detailCode: 'unexpected-tool-exception',
      committed: false,
      secondaryCleanup: null,
    },
  );
  const throwingFamily = {};
  Object.defineProperty(throwingFamily, 'toolFailureFamily', {
    get: () => { throw new Error('hostile family getter text'); },
  });
  const encoded = encodeAcceptedRunFailure(throwingFamily, 'invocation');
  assert.equal(encoded.includes('hostile'), false);
  assert.equal(
    encoded,
    '{"ok":false,"cause":"unexpected-tool-exception","phase":"invocation","detailCode":"unexpected-tool-exception","committed":false,"secondaryCleanup":null}\n',
  );
  for (const forgedEnvelope of [
    {
      cause: 'postcommit-parent-sync-failure',
      phase: 'candidate',
      detailCode: 'postcommit-parent-sync-failure',
      committed: true,
      secondaryCleanup: null,
    },
    {
      cause: 'artifact-write-failure',
      phase: 'publication-precommit',
      detailCode: 'artifact-write-failure',
      committed: false,
      secondaryCleanup: {
        cause: 'owned-lock-cleanup-failure',
        detailCode: 'owned-lock-cleanup-failure',
      },
    },
  ]) {
    assert.deepEqual(
      acceptedRunFailureEnvelope({ envelope: forgedEnvelope }, 'verification'),
      {
        ok: false,
        cause: 'unexpected-tool-exception',
        phase: 'verification',
        detailCode: 'unexpected-tool-exception',
        committed: false,
        secondaryCleanup: null,
      },
    );
  }
});

void test('keeps staging unreachable across every final prepublication boundary failure', async () => {
  const boundaries = [
    'last-semantic',
    'last-call',
    'last-timeline',
    'last-deadline-shadow',
    'last-authorization',
    'analysis',
    'serialization',
  ];
  for (const boundary of boundaries) {
    const events: string[] = [];
    const primary = acceptedRunFailure(
      boundary === 'analysis' || boundary === 'serialization'
        ? 'serialization-unexpected'
        : 'candidate-unexpected',
    );
    const preflight = {
      publication: { released: false, committed: false },
    } as unknown as AcceptedPreflightResult;
    await assert.rejects(
      runAcceptedExperiment('/synthetic/repository', {
        preflight: () => {
          events.push('lock-admitted');
          return Promise.resolve(preflight);
        },
        execute: () => {
          events.push(boundary);
          throw primary;
        },
        publish: () => {
          events.push('staging-created');
          return Promise.resolve();
        },
        abort: () => {
          events.push('lock-cleaned');
          return Promise.reject(primary);
        },
      }),
      (error: unknown) => error === primary,
    );
    assert.deepEqual(events, ['lock-admitted', boundary, 'lock-cleaned']);
  }

  const successEvents: string[] = [];
  const successPreflight = {
    publication: { released: false, committed: false },
  } as unknown as AcceptedPreflightResult;
  await runAcceptedExperiment('/synthetic/repository', {
    preflight: () => Promise.resolve(successPreflight),
    execute: () => {
      successEvents.push('sealed-artifacts');
      return Object.freeze([]);
    },
    publish: () => {
      successEvents.push('staging-created');
      return Promise.resolve();
    },
    abort: (_session, error) => Promise.reject(
      error instanceof Error ? error : new Error('Synthetic abort failure.'),
    ),
  });
  assert.deepEqual(successEvents, ['sealed-artifacts', 'staging-created']);
});

function syntheticAcceptedArtifacts(): readonly AcceptedPreparedArtifact[] {
  const encoder = new TextEncoder();
  return Object.freeze(acceptedRetainedFileContracts().map((file) => {
    const bytes = file.recordCount === null
      ? encoder.encode(file.name === 'README.md' ? '# retained\n' : '{}\n')
      : encoder.encode('{}\n'.repeat(file.recordCount));
    return Object.freeze({
      name: file.name,
      bytes,
      sha256: sha256Bytes(bytes),
      recordCount: file.recordCount,
    });
  }));
}

function acceptedPublicationDependencies(
  overrides: Partial<AcceptedPublicationDependencies> = {},
): AcceptedPublicationDependencies {
  const defaults = defaultAcceptedPublicationDependencies(sha256Bytes);
  return Object.freeze({
    ...defaults,
    statfs: (() => Promise.resolve({
      type: 0xef53n,
      bsize: 4_096n,
      blocks: 1n,
      bfree: 1n,
      bavail: 1n,
      files: 1n,
      ffree: 1n,
    })) as unknown as typeof defaults.statfs,
    suffix: () => 'a'.repeat(32),
    ...overrides,
  });
}

function fileHandleProxy(
  handle: FileHandle,
  overrides: Partial<Pick<FileHandle, 'stat' | 'sync'>>,
): FileHandle {
  return new Proxy(handle, {
    get: (target, property): unknown => {
      if (property === 'stat' && overrides.stat !== undefined) return overrides.stat;
      if (property === 'sync' && overrides.sync !== undefined) return overrides.sync;
      return boundObjectProperty(target, property);
    },
  });
}

function boundObjectProperty(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property, target);
  return typeof value === 'function'
    ? (...arguments_: unknown[]): unknown => Reflect.apply(value, target, arguments_)
    : value;
}

async function assertAcceptedPathAbsent(target: string): Promise<void> {
  await assert.rejects(lstat(target), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'ENOENT');
}

void test('admits lock before destination conflicts and atomically publishes only sealed bytes', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-publication-'));
  const dependencies = acceptedPublicationDependencies();
  try {
    const first = await admitAcceptedPublication(temporary, dependencies);
    await mkdir(first.destinationPath);
    await assert.rejects(
      admitAcceptedPublication(temporary, dependencies),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'publication-lock-conflict',
    );
    await rm(first.destinationPath, { recursive: true });
    await assert.rejects(
      abortAcceptedPublication(
        first,
        acceptedRunFailure('candidate-unexpected'),
      ),
      (error: unknown) =>
        error instanceof AcceptedRunFailure && error.envelope.phase === 'candidate',
    );

    await mkdir(first.destinationPath);
    await assert.rejects(
      admitAcceptedPublication(temporary, dependencies),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'initial-destination-conflict' &&
        error.envelope.phase === 'preflight',
    );
    await assert.rejects(lstat(first.lockPath), (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'ENOENT');
    await rm(first.destinationPath, { recursive: true });

    const session = await admitAcceptedPublication(temporary, dependencies);
    assert.deepEqual(await readdir(session.parentPath), [path.basename(session.lockPath)]);
    await publishAcceptedArtifacts(session, syntheticAcceptedArtifacts());
    assert.deepEqual(
      (await readdir(session.destinationPath)).sort(),
      acceptedRetainedFileContracts().map((file) => file.name).sort(),
    );
    await assert.rejects(lstat(session.lockPath), (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'ENOENT');
    const publicationSource = await readFile(
      'src/benchmark/service-fast-numerical-experiment/accepted-run/publication.ts',
      'utf8',
    );
    const postcommit = publicationSource.slice(
      publicationSource.indexOf('session.committed = true;'),
      publicationSource.indexOf('/** Release only the owned lock'),
    );
    assert.equal(postcommit.includes('destinationPath'), false);
    assert.equal(postcommit.includes('dependencies.rm'), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('rejects non-ext publication admission before creating an owned lock', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-nonext-'));
  const dependencies = acceptedPublicationDependencies({
    statfs: (() => Promise.resolve({
      type: 0x0102_1994n,
      bsize: 4_096n,
      blocks: 1n,
      bfree: 1n,
      bavail: 1n,
      files: 1n,
      ffree: 1n,
    })) as unknown as AcceptedPublicationDependencies['statfs'],
  });
  try {
    await assert.rejects(
      admitAcceptedPublication(temporary, dependencies),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'filesystem-not-admitted' &&
        error.envelope.phase === 'preflight',
    );
    const entries = await readdir(path.dirname(path.join(
      temporary,
      ACCEPTED_RETAINED_DIRECTORY,
    )));
    assert.deepEqual(entries, []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('rejects a symlinked publication parent component before lock admission', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-parent-link-'));
  const external = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-parent-target-'));
  try {
    await symlink(external, path.join(temporary, 'datasets'));
    await assert.rejects(
      admitAcceptedPublication(temporary, acceptedPublicationDependencies()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'filesystem-not-admitted' &&
        error.envelope.phase === 'preflight',
    );
    assert.deepEqual(await readdir(external), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

void test('cleans invalid artifacts, final conflicts, and rename failures without touching destinations', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-precommit-'));
  try {
    const invalidSession = await admitAcceptedPublication(
      temporary,
      acceptedPublicationDependencies({ suffix: () => '1'.repeat(32) }),
    );
    const invalidArtifacts = syntheticAcceptedArtifacts().map((artifact, index) =>
      index === 0 ? Object.freeze({ ...artifact, sha256: `sha256:${'0'.repeat(64)}` }) : artifact);
    await assert.rejects(
      publishAcceptedArtifacts(invalidSession, invalidArtifacts),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'artifact-write-failure' &&
        error.envelope.secondaryCleanup === null,
    );
    await assertAcceptedPathAbsent(invalidSession.lockPath);
    await assertAcceptedPathAbsent(path.join(
      invalidSession.parentPath,
      `.${path.basename(invalidSession.destinationPath)}.staging-${'1'.repeat(32)}`,
    ));

    const conflictSession = await admitAcceptedPublication(
      temporary,
      acceptedPublicationDependencies({ suffix: () => '2'.repeat(32) }),
    );
    await mkdir(conflictSession.destinationPath);
    const marker = path.join(conflictSession.destinationPath, 'owner-marker');
    await writeFile(marker, 'preexisting');
    await assert.rejects(
      publishAcceptedArtifacts(conflictSession, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'final-destination-conflict' &&
        error.envelope.phase === 'publication-precommit' &&
        error.envelope.secondaryCleanup === null,
    );
    assert.equal(await readFile(marker, 'utf8'), 'preexisting');
    await assertAcceptedPathAbsent(conflictSession.lockPath);
    await assertAcceptedPathAbsent(path.join(
      conflictSession.parentPath,
      `.${path.basename(conflictSession.destinationPath)}.staging-${'2'.repeat(32)}`,
    ));
    await rm(conflictSession.destinationPath, { recursive: true });

    const renameSession = await admitAcceptedPublication(
      temporary,
      acceptedPublicationDependencies({
        suffix: () => '3'.repeat(32),
        rename: (() => Promise.reject(new Error('forced rename failure'))) as
          unknown as AcceptedPublicationDependencies['rename'],
      }),
    );
    await assert.rejects(
      publishAcceptedArtifacts(renameSession, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'publication-rename-failure' &&
        error.envelope.secondaryCleanup === null,
    );
    await assertAcceptedPathAbsent(renameSession.destinationPath);
    await assertAcceptedPathAbsent(renameSession.lockPath);
    await assertAcceptedPathAbsent(path.join(
      renameSession.parentPath,
      `.${path.basename(renameSession.destinationPath)}.staging-${'3'.repeat(32)}`,
    ));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('rejects symlink and cross-device readback identities before rename', async () => {
  for (const mode of ['symlink', 'cross-device'] as const) {
    const temporary = await mkdtemp(path.join(tmpdir(), `routelab-accepted-${mode}-`));
    const defaults = acceptedPublicationDependencies();
    let tampered = false;
    const dependencies = mode === 'symlink'
      ? acceptedPublicationDependencies({
          readdir: (async (target: string) => {
            const names = await defaults.readdir(target);
            if (!tampered && target.includes('.staging-')) {
              tampered = true;
              const artifact = path.join(target, 'analysis.json');
              await rm(artifact);
              await symlink('manifest.json', artifact);
            }
            return names;
          }) as unknown as typeof defaults.readdir,
          suffix: () => '4'.repeat(32),
        })
      : acceptedPublicationDependencies({
          open: (async (target: string, flags: string | number, modeValue?: number) => {
            const handle = await defaults.open(target, flags, modeValue);
            if (
              target.endsWith('/analysis.json') &&
              flags === (constants.O_RDONLY | constants.O_NOFOLLOW)
            ) {
              return fileHandleProxy(handle, {
                stat: (async (options?: { bigint?: boolean }) => {
                  const admitted = await handle.stat(options as { bigint: true });
                  return new Proxy(admitted, {
                    get: (statTarget, property): unknown =>
                      property === 'dev'
                        ? statTarget.dev + 1n
                        : boundObjectProperty(statTarget, property),
                  });
                }) as FileHandle['stat'],
              });
            }
            return handle;
          }) as unknown as typeof defaults.open,
          suffix: () => '5'.repeat(32),
        });
    try {
      const session = await admitAcceptedPublication(temporary, dependencies);
      await assert.rejects(
        publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
        (error: unknown) =>
          error instanceof AcceptedRunFailure &&
          error.envelope.cause === 'artifact-write-failure' &&
          error.envelope.phase === 'publication-precommit' &&
          error.envelope.secondaryCleanup === null,
      );
      await assertAcceptedPathAbsent(session.destinationPath);
      await assertAcceptedPathAbsent(session.lockPath);
      assert.deepEqual(await readdir(session.parentPath), []);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

void test('rejects mutated bytes and extra staging files during bounded readback', async () => {
  for (const mode of ['byte-mutation', 'extra-file'] as const) {
    const temporary = await mkdtemp(path.join(tmpdir(), `routelab-accepted-${mode}-`));
    const defaults = acceptedPublicationDependencies();
    let tampered = false;
    const dependencies = acceptedPublicationDependencies({
      readdir: (async (target: string) => {
        if (!tampered && target.includes('.staging-')) {
          tampered = true;
          if (mode === 'extra-file') {
            await writeFile(path.join(target, 'unexpected'), 'hostile');
          } else {
            const artifactPath = path.join(target, 'analysis.json');
            const bytes = Uint8Array.from(await readFile(artifactPath));
            bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
            await writeFile(artifactPath, bytes);
          }
        }
        return defaults.readdir(target);
      }) as unknown as typeof defaults.readdir,
      suffix: () => mode === 'byte-mutation' ? 'a'.repeat(32) : 'b'.repeat(32),
    });
    try {
      const session = await admitAcceptedPublication(temporary, dependencies);
      await assert.rejects(
        publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
        (error: unknown) =>
          error instanceof AcceptedRunFailure &&
          error.envelope.cause === 'artifact-write-failure' &&
          error.envelope.phase === 'publication-precommit' &&
          error.envelope.secondaryCleanup === null,
      );
      await assertAcceptedPathAbsent(session.destinationPath);
      await assertAcceptedPathAbsent(session.lockPath);
      assert.deepEqual(await readdir(session.parentPath), []);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

void test('classifies a retained-file sync failure before staging readback', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-file-sync-'));
  const defaults = acceptedPublicationDependencies();
  const dependencies = acceptedPublicationDependencies({
    open: (async (target: string, flags: string | number, modeValue?: number) => {
      const handle = await defaults.open(target, flags, modeValue);
      if (target.endsWith('/analysis.json') && flags === 'wx') {
        return fileHandleProxy(handle, {
          sync: () => Promise.reject(new Error('forced retained-file sync failure')),
        });
      }
      return handle;
    }) as unknown as typeof defaults.open,
    suffix: () => 'c'.repeat(32),
  });
  try {
    const session = await admitAcceptedPublication(temporary, dependencies);
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'artifact-sync-failure' &&
        error.envelope.phase === 'publication-precommit' &&
        error.envelope.secondaryCleanup === null,
    );
    await assertAcceptedPathAbsent(session.destinationPath);
    await assertAcceptedPathAbsent(session.lockPath);
    assert.deepEqual(await readdir(session.parentPath), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('classifies staging sync, final lock rebind, and postcommit parent sync exactly', async () => {
  const stagingRoot = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-sync-'));
  const stagingDefaults = acceptedPublicationDependencies();
  const stagingDependencies = acceptedPublicationDependencies({
    open: (async (target: string, flags: string | number, modeValue?: number) => {
      const handle = await stagingDefaults.open(target, flags, modeValue);
      if (
        target.includes('.staging-') && typeof flags === 'number' &&
        (flags & constants.O_DIRECTORY) !== 0
      ) {
        return fileHandleProxy(handle, {
          sync: () => Promise.reject(new Error('forced staging sync failure')),
        });
      }
      return handle;
    }) as unknown as typeof stagingDefaults.open,
    suffix: () => '6'.repeat(32),
  });
  try {
    const session = await admitAcceptedPublication(stagingRoot, stagingDependencies);
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'artifact-sync-failure' &&
        error.envelope.committed === false &&
        error.envelope.secondaryCleanup === null,
    );
    await assertAcceptedPathAbsent(session.lockPath);
    assert.deepEqual(await readdir(session.parentPath), []);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  const lockRoot = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-lock-rebind-'));
  const lockDefaults = acceptedPublicationDependencies();
  let watchedLock = '';
  let publicationLockStats = 0;
  const lockDependencies = acceptedPublicationDependencies({
    lstat: (async (target: string, options: { bigint: true }) => {
      const admitted = await lockDefaults.lstat(target, options);
      if (target === watchedLock) {
        publicationLockStats += 1;
        if (publicationLockStats === 2) {
          return new Proxy(admitted, {
            get: (statTarget, property): unknown =>
              property === 'ino'
                ? statTarget.ino + 1n
                : boundObjectProperty(statTarget, property),
          });
        }
      }
      return admitted;
    }) as unknown as typeof lockDefaults.lstat,
    suffix: () => '7'.repeat(32),
  });
  try {
    const session = await admitAcceptedPublication(lockRoot, lockDependencies);
    watchedLock = session.lockPath;
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'filesystem-not-admitted' &&
        error.envelope.phase === 'publication-precommit' &&
        error.envelope.secondaryCleanup === null,
    );
    assert.equal(publicationLockStats >= 3, true);
    await assertAcceptedPathAbsent(session.lockPath);
    await assertAcceptedPathAbsent(session.destinationPath);
    assert.deepEqual(await readdir(session.parentPath), []);
  } finally {
    await rm(lockRoot, { recursive: true, force: true });
  }

  const parentRoot = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-parent-sync-'));
  try {
    const session = await admitAcceptedPublication(
      parentRoot,
      acceptedPublicationDependencies({ suffix: () => '8'.repeat(32) }),
    );
    const realSync = session.parentHandle.sync.bind(session.parentHandle);
    let parentSyncCalls = 0;
    session.parentHandle.sync = () => {
      parentSyncCalls += 1;
      return parentSyncCalls === 1
        ? Promise.reject(new Error('forced postcommit parent sync failure'))
        : realSync();
    };
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'postcommit-parent-sync-failure' &&
        error.envelope.phase === 'publication-postcommit' &&
        error.envelope.committed === true &&
        error.envelope.secondaryCleanup === null,
    );
    assert.equal(parentSyncCalls, 2);
    assert.deepEqual(
      (await readdir(session.destinationPath)).sort(),
      acceptedRetainedFileContracts().map((file) => file.name).sort(),
    );
    await assertAcceptedPathAbsent(session.lockPath);
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

void test('preserves lock-sync cleanup precedence before and after commit', async () => {
  const precommitRoot = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-lock-sync-'));
  try {
    const session = await admitAcceptedPublication(
      precommitRoot,
      acceptedPublicationDependencies({ suffix: () => 'd'.repeat(32) }),
    );
    session.parentHandle.sync = () =>
      Promise.reject(new Error('forced precommit lock cleanup sync failure'));
    const invalidArtifacts = syntheticAcceptedArtifacts().map((artifact, index) =>
      index === 0 ? Object.freeze({ ...artifact, sha256: `sha256:${'0'.repeat(64)}` }) : artifact);
    await assert.rejects(
      publishAcceptedArtifacts(session, invalidArtifacts),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'artifact-write-failure' &&
        error.envelope.phase === 'publication-precommit' &&
        error.envelope.committed === false &&
        error.envelope.secondaryCleanup?.cause === 'owned-lock-cleanup-failure',
    );
    await assertAcceptedPathAbsent(session.destinationPath);
    await assertAcceptedPathAbsent(session.lockPath);
    await session.parentHandle.close();
  } finally {
    await rm(precommitRoot, { recursive: true, force: true });
  }

  const cleanupRoot = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-post-lock-sync-'));
  try {
    const session = await admitAcceptedPublication(
      cleanupRoot,
      acceptedPublicationDependencies({ suffix: () => 'e'.repeat(32) }),
    );
    const realSync = session.parentHandle.sync.bind(session.parentHandle);
    let syncCalls = 0;
    session.parentHandle.sync = () => {
      syncCalls += 1;
      return syncCalls === 1
        ? realSync()
        : Promise.reject(new Error('forced committed lock cleanup sync failure'));
    };
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'owned-lock-cleanup-failure' &&
        error.envelope.phase === 'cleanup' &&
        error.envelope.committed === true &&
        error.envelope.secondaryCleanup === null,
    );
    assert.equal(syncCalls, 2);
    await assertAcceptedPathAbsent(session.lockPath);
    assert.equal((await readdir(session.destinationPath)).length, 8);
    await session.parentHandle.close();
  } finally {
    await rm(cleanupRoot, { recursive: true, force: true });
  }

  const secondaryRoot = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-post-secondary-'));
  try {
    const session = await admitAcceptedPublication(
      secondaryRoot,
      acceptedPublicationDependencies({ suffix: () => 'f'.repeat(32) }),
    );
    let syncCalls = 0;
    session.parentHandle.sync = () => {
      syncCalls += 1;
      return Promise.reject(new Error('forced parent and lock cleanup sync failure'));
    };
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'postcommit-parent-sync-failure' &&
        error.envelope.phase === 'publication-postcommit' &&
        error.envelope.committed === true &&
        error.envelope.secondaryCleanup?.cause === 'owned-lock-cleanup-failure',
    );
    assert.equal(syncCalls, 2);
    await assertAcceptedPathAbsent(session.lockPath);
    assert.equal((await readdir(session.destinationPath)).length, 8);
    await session.parentHandle.close();
  } finally {
    await rm(secondaryRoot, { recursive: true, force: true });
  }
});

void test('preserves the primary publication failure when owned staging cleanup fails', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'routelab-accepted-cleanup-'));
  const dependencies = acceptedPublicationDependencies({
    rename: (() => Promise.reject(new Error('forced rename failure'))) as
      unknown as AcceptedPublicationDependencies['rename'],
    rm: (() => Promise.reject(new Error('forced staging cleanup failure'))) as
      unknown as AcceptedPublicationDependencies['rm'],
    suffix: () => '9'.repeat(32),
  });
  try {
    const session = await admitAcceptedPublication(temporary, dependencies);
    await assert.rejects(
      publishAcceptedArtifacts(session, syntheticAcceptedArtifacts()),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'publication-rename-failure' &&
        error.envelope.secondaryCleanup?.cause === 'owned-staging-cleanup-failure',
    );
    await assertAcceptedPathAbsent(session.destinationPath);
    assert.equal((await readdir(session.parentPath)).includes(
      path.basename(session.lockPath),
    ), true);
    await assert.rejects(
      abortAcceptedPublication(
        session,
        acceptedRunFailure('precommit-rename'),
      ),
      (error: unknown) =>
        error instanceof AcceptedRunFailure &&
        error.envelope.cause === 'publication-rename-failure',
    );
    await assertAcceptedPathAbsent(session.lockPath);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('admits only the accepted CLI exact process-access path and counts', async () => {
  const acceptedCliPath = 'cli/run-service-fast-numerical-experiment.ts';
  const exactAccess = [
    'void process.argv.length;',
    "process.stderr.write('');",
    'process.exitCode = 1;',
  ].join('\n');
  await runtimeAuditProbe(exactAccess, { relativePath: acceptedCliPath });
  for (const [relativePath, hostile, expectedCode] of [
    ['cli/wrong-accepted-run.ts', exactAccess, 'process-capability-mismatch'],
    [acceptedCliPath, exactAccess.replace(
      'void process.argv.length;',
      'void process.argv.length; void process.argv.length;',
    ), 'process-capability-mismatch'],
    [acceptedCliPath, exactAccess.replace(
      'process.argv.length',
      "process['argv'].length",
    ), 'computed-capability-forbidden'],
  ] as const) {
    await assert.rejects(
      runtimeAuditProbe(hostile, { relativePath }),
      (error: unknown) =>
        error instanceof ServiceFastRuntimeImportAuditError &&
        error.code === expectedCode,
    );
  }
});

void test('audits the exact accepted runtime graph and excludes durable verifier imports', async () => {
  const descriptors = await Promise.all(ACCEPTED_RUN_RUNTIME_PATHS.map(async (sourcePath) => {
    const bytes = await readFile(sourcePath);
    return Object.freeze({
      path: sourcePath,
      bytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    });
  }));
  const result = await auditServiceFastRuntimeImports({
    repositoryRoot: process.cwd(),
    profile: acceptedRunRuntimeAuditProfile(descriptors),
    trackedPaths: new Set(ACCEPTED_RUN_RUNTIME_PATHS),
    ignoredPaths: new Set(),
  });
  assert.deepEqual(result.projectSources, [...ACCEPTED_RUN_RUNTIME_PATHS].sort());
  assert.deepEqual(result.nodeBuiltins, [
    'node:child_process',
    'node:crypto',
    'node:fs',
    'node:fs/promises',
    'node:os',
    'node:path',
    'node:url',
    'node:util',
    'node:worker_threads',
  ]);
  for (const sourcePath of [
    ...ACCEPTED_RUN_RUNTIME_PATHS.filter((value) => value.includes('/accepted-run/')),
    'cli/run-service-fast-numerical-experiment.ts',
  ]) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      /(?:import|export)[\s\S]*?from\s+['"][^'"]*artifact-verifier\//u.test(source),
      false,
      sourcePath,
    );
  }
});
