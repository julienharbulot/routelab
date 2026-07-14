import assert from 'node:assert/strict';
import test from 'node:test';

import type { PathShadowPriceResolvedRoute } from '../src/allocation/path-shadow-price/index.ts';
import {
  advanceServicePathShadowPriceReconstructionStep,
  advanceServicePathShadowPriceShareMicrostep,
  appendServicePathShadowPriceModelRoute,
  createServicePathShadowPriceState,
  servicePathShadowPriceFailure,
  servicePathShadowPriceInitialResidualUnits,
  servicePathShadowPriceProgress,
  servicePathShadowPriceReadyWeights,
  servicePathShadowPriceResidualOption,
  servicePathShadowPriceScoreAllocations,
  settleServicePathShadowPriceResidualOption,
  startServicePathShadowPriceProposal,
  type ServicePathShadowPriceState,
} from '../src/allocation/service-path-shadow-price/index.ts';

function route(
  reserveIn: bigint,
  reserveOut: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): PathShadowPriceResolvedRoute {
  return [
    {
      reserveIn,
      reserveOut,
      feeChargedNumerator,
      feeDenominator,
    },
  ];
}

function runShares(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
): {
  readonly state: ServicePathShadowPriceState;
  readonly startedFlags: number;
  readonly completedFlags: number;
} {
  const state = createServicePathShadowPriceState(amountIn, routes.length);
  for (const candidate of routes) {
    const modeled = appendServicePathShadowPriceModelRoute(state, candidate);
    assert.equal(modeled.ok, true);
  }
  assert.deepEqual(servicePathShadowPriceProgress(state), {
    phase: 'proposal-start',
    routeCount: routes.length,
    modelRoutesCompleted: routes.length,
    outerUpdatesStarted: 0,
    outerUpdatesCompleted: 0,
    shareMicrosteps: 0,
    reconstructionSteps: 0,
  });
  assert.equal(startServicePathShadowPriceProposal(state).ok, true);
  let startedFlags = 0;
  let completedFlags = 0;
  let guard = 0;
  while (servicePathShadowPriceProgress(state).phase === 'share-microstep') {
    const advanced = advanceServicePathShadowPriceShareMicrostep(state);
    guard += 1;
    assert.ok(guard < 20_000);
    if (!advanced.ok) break;
    if (advanced.outerUpdateStarted) startedFlags += 1;
    if (advanced.outerUpdateCompleted) completedFlags += 1;
  }
  return { state, startedFlags, completedFlags };
}

void test('reproduces the F5 strict share ledger one microstep at a time', () => {
  const { state, startedFlags, completedFlags } = runShares(5n, [
    route(1n, 3n),
    route(3n, 4n),
  ]);
  assert.deepEqual(servicePathShadowPriceProgress(state), {
    phase: 'reconstruction-step',
    routeCount: 2,
    modelRoutesCompleted: 2,
    outerUpdatesStarted: 64,
    outerUpdatesCompleted: 64,
    shareMicrosteps: 8_515,
    reconstructionSteps: 0,
  });
  assert.equal(startedFlags, 64);
  assert.equal(completedFlags, 64);
  assert.deepEqual(servicePathShadowPriceReadyWeights(state), [
    0.40000000000000013,
    0.6000000000000001,
  ]);
  assert.equal(servicePathShadowPriceFailure(state), undefined);
});

void test('reproduces the F6 endpoint/share ledger and final weights', () => {
  const { state, startedFlags, completedFlags } = runShares(100n, [
    route(100n, 100n),
    route(100n, 100n),
  ]);
  assert.deepEqual(servicePathShadowPriceProgress(state), {
    phase: 'reconstruction-step',
    routeCount: 2,
    modelRoutesCompleted: 2,
    outerUpdatesStarted: 64,
    outerUpdatesCompleted: 64,
    shareMicrosteps: 8_450,
    reconstructionSteps: 0,
  });
  assert.equal(startedFlags, 64);
  assert.equal(completedFlags, 64);
  assert.deepEqual(servicePathShadowPriceReadyWeights(state), [
    0.4999999999999999,
    0.4999999999999999,
  ]);
});

void test('pauses without hidden work and resumes the same opaque state', () => {
  const state = createServicePathShadowPriceState(5n, 2);
  assert.equal(appendServicePathShadowPriceModelRoute(state, route(1n, 3n)).ok, true);
  assert.equal(appendServicePathShadowPriceModelRoute(state, route(3n, 4n)).ok, true);
  assert.equal(startServicePathShadowPriceProposal(state).ok, true);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(advanceServicePathShadowPriceShareMicrostep(state).ok, true);
  }
  const stopped = servicePathShadowPriceProgress(state);
  assert.equal(stopped.shareMicrosteps, 100);
  assert.deepEqual(servicePathShadowPriceProgress(state), stopped);
  assert.equal(advanceServicePathShadowPriceShareMicrostep(state).ok, true);
  assert.equal(servicePathShadowPriceProgress(state).shareMicrosteps, 101);
});

void test('retains strict finite non-convergence as a terminal failure', () => {
  const scale = 2n ** 60n;
  const { state } = runShares(1n, [
    route(10n * scale, 3n * scale),
    route(scale, 8n * scale),
  ]);
  assert.deepEqual(servicePathShadowPriceProgress(state), {
    phase: 'failed',
    routeCount: 2,
    modelRoutesCompleted: 2,
    outerUpdatesStarted: 64,
    outerUpdatesCompleted: 64,
    shareMicrosteps: 130,
    reconstructionSteps: 0,
  });
  assert.deepEqual(servicePathShadowPriceFailure(state), {
    code: 'non-convergence',
    converged: false,
    completedOuterUpdates: 64,
  });
  assert.equal(servicePathShadowPriceReadyWeights(state), undefined);
});

void test('reconstructs F5 in six charged steps and exposes both residual replays', () => {
  const { state } = runShares(5n, [route(1n, 3n), route(3n, 4n)]);
  for (let step = 1; step <= 6; step += 1) {
    assert.equal(advanceServicePathShadowPriceReconstructionStep(state).ok, true);
    assert.equal(servicePathShadowPriceProgress(state).reconstructionSteps, step);
  }
  assert.equal(servicePathShadowPriceInitialResidualUnits(state), 1n);

  assert.deepEqual(servicePathShadowPriceResidualOption(state), {
    allocations: [3n, 2n],
    routeIndex: 0,
    residualUnitsRemaining: 1n,
  });
  assert.equal(
    settleServicePathShadowPriceResidualOption(state, 'valid-not-best').ok,
    true,
  );
  assert.deepEqual(servicePathShadowPriceResidualOption(state), {
    allocations: [2n, 3n],
    routeIndex: 1,
    residualUnitsRemaining: 1n,
  });
  assert.equal(
    settleServicePathShadowPriceResidualOption(state, 'valid-best').ok,
    true,
  );
  assert.equal(servicePathShadowPriceProgress(state).phase, 'score-ready');
  assert.deepEqual(servicePathShadowPriceScoreAllocations(state), [2n, 3n]);
});

void test('reconstructs F6 and exposes one unchanged zero-residual replay', () => {
  const { state } = runShares(100n, [
    route(100n, 100n),
    route(100n, 100n),
  ]);
  for (let step = 0; step < 6; step += 1) {
    assert.equal(advanceServicePathShadowPriceReconstructionStep(state).ok, true);
  }
  assert.equal(servicePathShadowPriceInitialResidualUnits(state), 0n);
  assert.deepEqual(servicePathShadowPriceResidualOption(state), {
    allocations: [50n, 50n],
    routeIndex: null,
    residualUnitsRemaining: 0n,
  });
  assert.equal(
    settleServicePathShadowPriceResidualOption(state, 'valid-best').ok,
    true,
  );
  assert.deepEqual(servicePathShadowPriceScoreAllocations(state), [50n, 50n]);
  assert.throws(
    () => servicePathShadowPriceResidualOption(state),
    /No new service shadow-price residual option/u,
  );
});

void test('offers residual units to every canonical route including zero allocations', () => {
  const { state } = runShares(1n, [route(1n, 3n), route(3n, 4n)]);
  for (let step = 0; step < 6; step += 1) {
    assert.equal(advanceServicePathShadowPriceReconstructionStep(state).ok, true);
  }
  assert.deepEqual(servicePathShadowPriceResidualOption(state), {
    allocations: [1n, 0n],
    routeIndex: 0,
    residualUnitsRemaining: 1n,
  });
  assert.equal(settleServicePathShadowPriceResidualOption(state, 'rejected').ok, true);
  assert.deepEqual(servicePathShadowPriceResidualOption(state), {
    allocations: [0n, 1n],
    routeIndex: 1,
    residualUnitsRemaining: 1n,
  });
  assert.equal(
    settleServicePathShadowPriceResidualOption(state, 'valid-best').ok,
    true,
  );
  assert.deepEqual(servicePathShadowPriceScoreAllocations(state), [0n, 1n]);
});

void test('fails closed when every residual replay rejects', () => {
  const { state } = runShares(5n, [route(1n, 3n), route(3n, 4n)]);
  for (let step = 0; step < 6; step += 1) {
    assert.equal(advanceServicePathShadowPriceReconstructionStep(state).ok, true);
  }
  for (let option = 0; option < 2; option += 1) {
    servicePathShadowPriceResidualOption(state);
    settleServicePathShadowPriceResidualOption(state, 'rejected');
  }
  assert.deepEqual(servicePathShadowPriceFailure(state), {
    code: 'residual-options-exhausted',
    converged: true,
    completedOuterUpdates: 64,
  });
  assert.equal(servicePathShadowPriceScoreAllocations(state), undefined);
});

void test('fails one invalid model action before proposal start', () => {
  const state = createServicePathShadowPriceState(5n, 2);
  const source = route(1n, 3n) as Array<{
    reserveIn: bigint;
    reserveOut: bigint;
    feeChargedNumerator: bigint;
    feeDenominator: bigint;
  }>;
  source[0]!.feeChargedNumerator = 1n;
  const failed = appendServicePathShadowPriceModelRoute(state, source);
  assert.deepEqual(failed, {
    ok: false,
    error: {
      code: 'invalid-route-model',
      converged: false,
      completedOuterUpdates: 0,
    },
  });
  assert.equal(servicePathShadowPriceProgress(state).phase, 'failed');
  assert.throws(() => startServicePathShadowPriceProposal(state), /not ready/u);
});

void test('captures model input and returns fresh frozen observations', () => {
  const source = [
    {
      reserveIn: 1n,
      reserveOut: 3n,
      feeChargedNumerator: 0n,
      feeDenominator: 1n,
    },
  ];
  const state = createServicePathShadowPriceState(5n, 2);
  assert.equal(appendServicePathShadowPriceModelRoute(state, source).ok, true);
  source[0]!.reserveOut = 0n;
  assert.equal(appendServicePathShadowPriceModelRoute(state, route(3n, 4n)).ok, true);
  assert.equal(Object.isFrozen(state), true);
  const first = servicePathShadowPriceProgress(state);
  const second = servicePathShadowPriceProgress(state);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(
    () => servicePathShadowPriceProgress(Object.freeze({}) as ServicePathShadowPriceState),
    /Unknown/u,
  );
});
