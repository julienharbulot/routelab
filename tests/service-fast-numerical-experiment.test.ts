import assert from 'node:assert/strict';
import test from 'node:test';

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
  serviceFastExperimentCallSetSnapshot,
  serviceFastExperimentMaximumCapsForPolicy,
  serviceFastExperimentPolicies,
  serviceFastExperimentPolicyAt,
  validateServiceFastCompleteOutcome,
  validateServiceFastDeadlinePrefix,
  type ServiceFastExperimentActionCaps,
  type ServiceFastExperimentCell,
  type ServiceFastExperimentCompleteOutcome,
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
  assert.equal(raw.counters.methodActions, null);
  assert.equal(raw.diagnostics[0]?.reconstruction, null);
  assert.equal(isFinalizedServiceFastCompleteOutcome(raw), false);
  const validated = validateServiceFastCompleteOutcome(raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected complete parity.');
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
  const validated = validateServiceFastDeadlinePrefix(call, raw, semantic);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('Expected prefix parity.');
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
