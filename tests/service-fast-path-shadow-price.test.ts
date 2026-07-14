import assert from 'node:assert/strict';
import test from 'node:test';

import type { PathShadowPriceResolvedRoute } from '../src/allocation/path-shadow-price/index.ts';
import {
  advanceServicePathShadowPriceShareMicrostep,
  appendServicePathShadowPriceModelRoute,
  createServicePathShadowPriceState,
  servicePathShadowPriceFailure,
  servicePathShadowPriceProgress,
  servicePathShadowPriceReadyWeights,
  startServicePathShadowPriceProposal,
} from '../src/allocation/service-path-shadow-price/index.ts';
import {
  advanceServiceFastPathShadowPriceShareAction,
  appendServiceFastPathShadowPriceModelRoute,
  createServiceFastPathShadowPriceState,
  serviceFastPathShadowPriceFailure,
  serviceFastPathShadowPriceProgress,
  serviceFastPathShadowPriceProposalMetadata,
  serviceFastPathShadowPriceReconstruction,
  serviceFastPathShadowPriceScoreAllocations,
  startServiceFastPathShadowPriceProposal,
  type ServiceFastPathShadowPriceDriverId,
  type ServiceFastPathShadowPricePolicy,
  type ServiceFastPathShadowPriceShareActionKind,
  type ServiceFastPathShadowPriceState,
  type ServiceFastPathShadowPriceStepResult,
} from '../src/allocation/service-fast-path-shadow-price/index.ts';

const DRIVER_IDS: readonly ServiceFastPathShadowPriceDriverId[] = Object.freeze([
  'bisection-o64-i64',
  'bisection-o64-i24',
  'bisection-o32-i16',
  'bisection-o16-i12',
  'pinned-sqrt-o64',
  'fixed-newton-sqrt-o64-n8',
]);

function route(
  reserveIn: bigint,
  reserveOut: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): PathShadowPriceResolvedRoute {
  return Object.freeze([
    Object.freeze({
      reserveIn,
      reserveOut,
      feeChargedNumerator,
      feeDenominator,
    }),
  ]);
}

function policy(
  driverId: ServiceFastPathShadowPriceDriverId,
  nonConvergence: ServiceFastPathShadowPricePolicy['nonConvergence'] = 'strict-reject',
): ServiceFastPathShadowPricePolicy {
  return { driverId, nonConvergence };
}

function isMethodCoreAction(
  actionKind: ServiceFastPathShadowPriceShareActionKind,
): boolean {
  return actionKind !== 'bisection-endpoint' &&
    actionKind !== 'pinned-sqrt-endpoint' &&
    actionKind !== 'fixed-newton-sqrt-endpoint';
}

function prepareFastState(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
  driverId: ServiceFastPathShadowPriceDriverId,
  nonConvergence: ServiceFastPathShadowPricePolicy['nonConvergence'] = 'strict-reject',
): ServiceFastPathShadowPriceState {
  const state = createServiceFastPathShadowPriceState(
    amountIn,
    routes.length,
    policy(driverId, nonConvergence),
  );
  for (const candidate of routes) {
    assert.equal(appendServiceFastPathShadowPriceModelRoute(state, candidate).ok, true);
  }
  assert.equal(startServiceFastPathShadowPriceProposal(state).ok, true);
  return state;
}

function runFastShares(
  state: ServiceFastPathShadowPriceState,
): readonly ServiceFastPathShadowPriceStepResult[] {
  const steps: ServiceFastPathShadowPriceStepResult[] = [];
  let guard = 0;
  while (serviceFastPathShadowPriceProgress(state).phase === 'share-action') {
    const before = serviceFastPathShadowPriceProgress(state);
    assert.notEqual(before.nextShareAction, null);
    const step = advanceServiceFastPathShadowPriceShareAction(state);
    steps.push(step);
    assert.equal(step.actionKind, before.nextShareAction);
    guard += 1;
    assert.ok(guard < 50_000);
    if (!step.ok) break;
  }
  const progress = serviceFastPathShadowPriceProgress(state);
  assert.equal(progress.shareActions, steps.length);
  assert.equal(
    progress.methodActions,
    steps.filter((step) => step.actionKind !== null && isMethodCoreAction(step.actionKind))
      .length,
  );
  return Object.freeze(steps);
}

function prepareReferenceState(
  amountIn: bigint,
  routes: readonly PathShadowPriceResolvedRoute[],
): ReturnType<typeof createServicePathShadowPriceState> {
  const state = createServicePathShadowPriceState(amountIn, routes.length);
  for (const candidate of routes) {
    assert.equal(appendServicePathShadowPriceModelRoute(state, candidate).ok, true);
  }
  assert.equal(startServicePathShadowPriceProposal(state).ok, true);
  return state;
}

function assertInvalidCapturedRoute(source: unknown): void {
  const state = createServiceFastPathShadowPriceState(
    5n,
    2,
    policy('bisection-o64-i64'),
  );
  assert.deepEqual(
    appendServiceFastPathShadowPriceModelRoute(
      state,
      source as PathShadowPriceResolvedRoute,
    ),
    {
      ok: false,
      error: {
        code: 'invalid-route-model',
        converged: false,
        completedOuterUpdates: 0,
      },
      actionKind: null,
      outerUpdateStarted: false,
      outerUpdateCompleted: false,
    },
  );
  assert.equal(serviceFastPathShadowPriceProgress(state).phase, 'failed');
}

void test('captures only the six frozen driver IDs crossed with both finite modes', () => {
  for (const driverId of DRIVER_IDS) {
    for (const nonConvergence of ['strict-reject', 'final-finite-replay'] as const) {
      const state = createServiceFastPathShadowPriceState(
        5n,
        2,
        policy(driverId, nonConvergence),
      );
      assert.equal(Object.isFrozen(state), true);
      assert.deepEqual(serviceFastPathShadowPriceProgress(state), {
        phase: 'model-route',
        driverId,
        nonConvergence,
        nextShareAction: null,
        routeCount: 2,
        modelRoutesCompleted: 0,
        outerUpdatesStarted: 0,
        outerUpdatesCompleted: 0,
        methodActions: 0,
        shareActions: 0,
        reconstructionSteps: 0,
      });
    }
  }
});

void test('defensively captures policy fields exactly once and returns fresh frozen progress', () => {
  let driverReads = 0;
  let modeReads = 0;
  const source = {
    get driverId(): ServiceFastPathShadowPriceDriverId {
      driverReads += 1;
      return 'bisection-o64-i24';
    },
    get nonConvergence(): ServiceFastPathShadowPricePolicy['nonConvergence'] {
      modeReads += 1;
      return 'final-finite-replay';
    },
  };
  const state = createServiceFastPathShadowPriceState(7n, 2, source);
  assert.equal(driverReads, 1);
  assert.equal(modeReads, 1);
  const first = serviceFastPathShadowPriceProgress(state);
  const second = serviceFastPathShadowPriceProgress(state);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.driverId, 'bisection-o64-i24');
  assert.equal(first.nonConvergence, 'final-finite-replay');
  assert.equal(driverReads, 1);
  assert.equal(modeReads, 1);
});

void test('rejects non-frozen IDs, malformed policy access, and invalid fixed bounds', () => {
  const invalidDriver = {
    driverId: 'bisection-o63-i64',
    nonConvergence: 'strict-reject',
  } as unknown as ServiceFastPathShadowPricePolicy;
  assert.throws(
    () => createServiceFastPathShadowPriceState(5n, 2, invalidDriver),
    /outside frozen bounds/u,
  );
  const throwingPolicy = Object.defineProperty({}, 'driverId', {
    get(): never { throw new Error('untrusted getter'); },
  }) as ServiceFastPathShadowPricePolicy;
  assert.throws(
    () => createServiceFastPathShadowPriceState(5n, 2, throwingPolicy),
    /outside frozen bounds/u,
  );
  assert.throws(
    () => createServiceFastPathShadowPriceState(0n, 2, policy('pinned-sqrt-o64')),
    /outside frozen bounds/u,
  );
  assert.throws(
    () => createServiceFastPathShadowPriceState(5n, 5, policy('pinned-sqrt-o64')),
    /outside frozen bounds/u,
  );
});

void test('builds and normalizes each captured route before exposing proposal start', () => {
  const state = createServiceFastPathShadowPriceState(
    5n,
    2,
    policy('fixed-newton-sqrt-o64-n8'),
  );
  assert.deepEqual(appendServiceFastPathShadowPriceModelRoute(state, route(1n, 3n)), {
    ok: true,
    phase: 'model-route',
    actionKind: null,
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
  assert.deepEqual(appendServiceFastPathShadowPriceModelRoute(state, route(3n, 4n)), {
    ok: true,
    phase: 'proposal-start',
    actionKind: null,
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
  assert.equal(serviceFastPathShadowPriceProgress(state).modelRoutesCompleted, 2);
  assert.deepEqual(startServiceFastPathShadowPriceProposal(state), {
    ok: true,
    phase: 'share-action',
    actionKind: null,
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
  assert.equal(
    serviceFastPathShadowPriceProgress(state).nextShareAction,
    'fixed-newton-sqrt-endpoint',
  );
  assert.equal(serviceFastPathShadowPriceFailure(state), undefined);
  assert.equal(serviceFastPathShadowPriceProposalMetadata(state), undefined);
  assert.equal(serviceFastPathShadowPriceReconstruction(state), undefined);
  assert.equal(serviceFastPathShadowPriceScoreAllocations(state), undefined);
});

void test('leaves pre-action inspection uncharged and attributes every first endpoint', () => {
  const expected = new Map<
    ServiceFastPathShadowPriceDriverId,
    ServiceFastPathShadowPriceShareActionKind
  >([
    ['bisection-o64-i64', 'bisection-endpoint'],
    ['bisection-o64-i24', 'bisection-endpoint'],
    ['bisection-o32-i16', 'bisection-endpoint'],
    ['bisection-o16-i12', 'bisection-endpoint'],
    ['pinned-sqrt-o64', 'pinned-sqrt-endpoint'],
    ['fixed-newton-sqrt-o64-n8', 'fixed-newton-sqrt-endpoint'],
  ]);
  for (const driverId of DRIVER_IDS) {
    const state = createServiceFastPathShadowPriceState(5n, 2, policy(driverId));
    appendServiceFastPathShadowPriceModelRoute(state, route(1n, 3n));
    appendServiceFastPathShadowPriceModelRoute(state, route(3n, 4n));
    startServiceFastPathShadowPriceProposal(state);
    assert.equal(serviceFastPathShadowPriceProgress(state).nextShareAction, expected.get(driverId));
    const before = serviceFastPathShadowPriceProgress(state);
    assert.deepEqual(serviceFastPathShadowPriceProgress(state), before);
    const advanced = advanceServiceFastPathShadowPriceShareAction(state);
    assert.equal(advanced.ok, true);
    assert.equal(advanced.actionKind, expected.get(driverId));
    assert.equal(advanced.outerUpdateStarted, true);
    assert.equal(advanced.outerUpdateCompleted, false);
    assert.equal(serviceFastPathShadowPriceProgress(state).shareActions, 1);
    assert.equal(serviceFastPathShadowPriceProgress(state).methodActions, 0);
  }
});

void test('fails closed on invalid routes and non-finite route normalization', () => {
  const invalid = createServiceFastPathShadowPriceState(
    5n,
    2,
    policy('bisection-o64-i64'),
  );
  const mutable = [{
    reserveIn: 1n,
    reserveOut: 3n,
    feeChargedNumerator: 1n,
    feeDenominator: 1n,
  }];
  assert.deepEqual(appendServiceFastPathShadowPriceModelRoute(invalid, mutable), {
    ok: false,
    error: {
      code: 'invalid-route-model',
      converged: false,
      completedOuterUpdates: 0,
    },
    actionKind: null,
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
  assert.equal(serviceFastPathShadowPriceProgress(invalid).phase, 'failed');

  const underflow = createServiceFastPathShadowPriceState(
    5n,
    2,
    policy('pinned-sqrt-o64'),
  );
  const result = appendServiceFastPathShadowPriceModelRoute(
    underflow,
    route(1n << 2_000n, 1n),
  );
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'non-finite-normalization',
      converged: false,
      completedOuterUpdates: 0,
    },
    actionKind: null,
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
});

void test('fails typed on revoked, throwing, fractional, and drifting route arrays', () => {
  const validHop = Object.freeze({
    reserveIn: 1n,
    reserveOut: 3n,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  });

  const revoked = Proxy.revocable([validHop], {});
  revoked.revoke();
  assertInvalidCapturedRoute(revoked.proxy);

  const throwingLength = new Proxy([validHop], {
    get(target, property, receiver): unknown {
      if (property === 'length') throw new Error('hostile length');
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assertInvalidCapturedRoute(throwingLength);

  const throwingIndex = new Proxy([validHop], {
    get(target, property, receiver): unknown {
      if (property === '0') throw new Error('hostile index');
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assertInvalidCapturedRoute(throwingIndex);

  let fractionalLengthReads = 0;
  const fractionalLength = new Proxy([validHop], {
    get(target, property, receiver): unknown {
      if (property === 'length') {
        fractionalLengthReads += 1;
        return 1.5;
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assertInvalidCapturedRoute(fractionalLength);
  assert.equal(fractionalLengthReads, 1);

  let driftingLengthReads = 0;
  let secondIndexReads = 0;
  const driftingLength = new Proxy([validHop], {
    get(target, property, receiver): unknown {
      if (property === 'length') {
        driftingLengthReads += 1;
        return driftingLengthReads === 1 ? 2 : 1;
      }
      if (property === '1') secondIndexReads += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assertInvalidCapturedRoute(driftingLength);
  assert.equal(driftingLengthReads, 1);
  assert.equal(secondIndexReads, 1);
});

void test('captures route cardinality and every hop field exactly once', () => {
  const fieldReads = {
    reserveIn: 0,
    reserveOut: 0,
    feeChargedNumerator: 0,
    feeDenominator: 0,
  };
  const hop = {
    get reserveIn(): bigint {
      fieldReads.reserveIn += 1;
      return 1n;
    },
    get reserveOut(): bigint {
      fieldReads.reserveOut += 1;
      return 3n;
    },
    get feeChargedNumerator(): bigint {
      fieldReads.feeChargedNumerator += 1;
      return 0n;
    },
    get feeDenominator(): bigint {
      fieldReads.feeDenominator += 1;
      return 1n;
    },
  };
  let lengthReads = 0;
  let indexReads = 0;
  const source = new Proxy([hop], {
    get(target, property, receiver): unknown {
      if (property === 'length') lengthReads += 1;
      if (property === '0') indexReads += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  const state = createServiceFastPathShadowPriceState(
    5n,
    2,
    policy('bisection-o64-i64'),
  );
  assert.equal(
    appendServiceFastPathShadowPriceModelRoute(state, source).ok,
    true,
  );
  assert.equal(lengthReads, 1);
  assert.equal(indexReads, 1);
  assert.deepEqual(fieldReads, {
    reserveIn: 1,
    reserveOut: 1,
    feeChargedNumerator: 1,
    feeDenominator: 1,
  });
});

void test('rejects forged state handles and out-of-phase setup calls', () => {
  const forged = Object.freeze({}) as ServiceFastPathShadowPriceState;
  assert.throws(() => serviceFastPathShadowPriceProgress(forged), /Unknown/u);
  const state = createServiceFastPathShadowPriceState(
    5n,
    2,
    policy('bisection-o16-i12'),
  );
  assert.throws(() => startServiceFastPathShadowPriceProposal(state), /not ready/u);
  appendServiceFastPathShadowPriceModelRoute(state, route(1n, 3n));
  appendServiceFastPathShadowPriceModelRoute(state, route(3n, 4n));
  assert.throws(
    () => appendServiceFastPathShadowPriceModelRoute(state, route(5n, 6n)),
    /No service-fast shadow-price model route/u,
  );
});

void test('matches protected 64x64 strict proposal weights and every share boundary', () => {
  const fixtures = [
    {
      amountIn: 5n,
      routes: [route(1n, 3n), route(3n, 4n)],
    },
    {
      amountIn: 100n,
      routes: [route(100n, 100n), route(100n, 100n)],
    },
  ] as const;

  for (const fixture of fixtures) {
    const fast = prepareFastState(
      fixture.amountIn,
      fixture.routes,
      'bisection-o64-i64',
    );
    const reference = prepareReferenceState(fixture.amountIn, fixture.routes);
    const actionKinds: ServiceFastPathShadowPriceShareActionKind[] = [];
    while (servicePathShadowPriceProgress(reference).phase === 'share-microstep') {
      const before = serviceFastPathShadowPriceProgress(fast);
      assert.equal(before.phase, 'share-action');
      assert.notEqual(before.nextShareAction, null);
      const fastStep = advanceServiceFastPathShadowPriceShareAction(fast);
      const referenceStep = advanceServicePathShadowPriceShareMicrostep(reference);
      assert.equal(fastStep.actionKind, before.nextShareAction);
      assert.equal(fastStep.ok, referenceStep.ok);
      assert.equal(fastStep.outerUpdateStarted, referenceStep.ok
        ? referenceStep.outerUpdateStarted
        : false);
      assert.equal(fastStep.outerUpdateCompleted, referenceStep.ok
        ? referenceStep.outerUpdateCompleted
        : false);
      if (fastStep.actionKind !== null) actionKinds.push(fastStep.actionKind);
      assert.equal(fastStep.ok, true);
      assert.equal(referenceStep.ok, true);
    }

    const fastProgress = serviceFastPathShadowPriceProgress(fast);
    const referenceProgress = servicePathShadowPriceProgress(reference);
    assert.equal(fastProgress.phase, 'reconstruction-step');
    assert.equal(referenceProgress.phase, 'reconstruction-step');
    assert.equal(fastProgress.outerUpdatesStarted, referenceProgress.outerUpdatesStarted);
    assert.equal(
      fastProgress.outerUpdatesCompleted,
      referenceProgress.outerUpdatesCompleted,
    );
    assert.equal(fastProgress.shareActions, referenceProgress.shareMicrosteps);
    assert.equal(fastProgress.shareActions, actionKinds.length);
    assert.equal(
      fastProgress.methodActions,
      actionKinds.filter(isMethodCoreAction).length,
    );
    const metadata = serviceFastPathShadowPriceProposalMetadata(fast);
    assert.deepEqual(metadata, {
      converged: true,
      diagnostic: null,
      completedOuterUpdates: 64,
      weights: servicePathShadowPriceReadyWeights(reference),
    });
    const repeatedMetadata = serviceFastPathShadowPriceProposalMetadata(fast);
    assert.notEqual(repeatedMetadata, metadata);
    assert.notEqual(repeatedMetadata?.weights, metadata?.weights);
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(Object.isFrozen(metadata?.weights), true);
    assert.equal(serviceFastPathShadowPriceFailure(fast), undefined);
    assert.equal(servicePathShadowPriceFailure(reference), undefined);
  }
});

void test('matches protected 64x64 strict non-convergence and charges its final action', () => {
  const scale = 2n ** 60n;
  const routes = [
    route(10n * scale, 3n * scale),
    route(scale, 8n * scale),
  ];
  const fast = prepareFastState(1n, routes, 'bisection-o64-i64');
  const reference = prepareReferenceState(1n, routes);
  const fastSteps = runFastShares(fast);
  while (servicePathShadowPriceProgress(reference).phase === 'share-microstep') {
    advanceServicePathShadowPriceShareMicrostep(reference);
  }
  const referenceProgress = servicePathShadowPriceProgress(reference);
  const progress = serviceFastPathShadowPriceProgress(fast);
  assert.equal(progress.phase, 'failed');
  assert.equal(progress.shareActions, referenceProgress.shareMicrosteps);
  assert.equal(progress.outerUpdatesStarted, referenceProgress.outerUpdatesStarted);
  assert.equal(progress.outerUpdatesCompleted, referenceProgress.outerUpdatesCompleted);
  assert.deepEqual(serviceFastPathShadowPriceFailure(fast), servicePathShadowPriceFailure(reference));
  assert.deepEqual(fastSteps.at(-1), {
    ok: false,
    error: {
      code: 'non-convergence',
      converged: false,
      completedOuterUpdates: 64,
    },
    actionKind: 'bisection-endpoint',
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
  assert.equal(serviceFastPathShadowPriceProposalMetadata(fast), undefined);
});

void test('charges the exact frozen all-interior action map for all six drivers', () => {
  const configurations: ReadonlyArray<{
    readonly driverId: ServiceFastPathShadowPriceDriverId;
    readonly outerUpdates: number;
    readonly actionsPerRouteSample: number;
    readonly methodActionsPerRouteSample: number;
    readonly finalAction: ServiceFastPathShadowPriceShareActionKind;
  }> = [
    {
      driverId: 'bisection-o64-i64',
      outerUpdates: 64,
      actionsPerRouteSample: 66,
      methodActionsPerRouteSample: 65,
      finalAction: 'bisection-final-share',
    },
    {
      driverId: 'bisection-o64-i24',
      outerUpdates: 64,
      actionsPerRouteSample: 26,
      methodActionsPerRouteSample: 25,
      finalAction: 'bisection-final-share',
    },
    {
      driverId: 'bisection-o32-i16',
      outerUpdates: 32,
      actionsPerRouteSample: 18,
      methodActionsPerRouteSample: 17,
      finalAction: 'bisection-final-share',
    },
    {
      driverId: 'bisection-o16-i12',
      outerUpdates: 16,
      actionsPerRouteSample: 14,
      methodActionsPerRouteSample: 13,
      finalAction: 'bisection-final-share',
    },
    {
      driverId: 'pinned-sqrt-o64',
      outerUpdates: 64,
      actionsPerRouteSample: 2,
      methodActionsPerRouteSample: 1,
      finalAction: 'pinned-sqrt-formula',
    },
    {
      driverId: 'fixed-newton-sqrt-o64-n8',
      outerUpdates: 64,
      actionsPerRouteSample: 11,
      methodActionsPerRouteSample: 10,
      finalAction: 'fixed-newton-sqrt-finalization',
    },
  ];
  const routes = [
    route(100n, 100n),
    route(100n, 100n),
    route(100n, 100n),
    route(100n, 100n),
  ];

  for (const configuration of configurations) {
    const state = prepareFastState(
      100n,
      routes,
      configuration.driverId,
      'final-finite-replay',
    );
    const steps = runFastShares(state);
    const routeSamples = (configuration.outerUpdates + 1) * routes.length;
    const progress = serviceFastPathShadowPriceProgress(state);
    assert.equal(progress.phase, 'reconstruction-step');
    assert.equal(progress.outerUpdatesStarted, configuration.outerUpdates);
    assert.equal(progress.outerUpdatesCompleted, configuration.outerUpdates);
    assert.equal(
      steps.filter((step) => step.outerUpdateStarted).length,
      configuration.outerUpdates,
    );
    assert.equal(
      steps.filter((step) => step.outerUpdateCompleted).length,
      configuration.outerUpdates,
    );
    assert.equal(
      progress.shareActions,
      routeSamples * configuration.actionsPerRouteSample,
    );
    assert.equal(
      progress.methodActions,
      routeSamples * configuration.methodActionsPerRouteSample,
    );
    assert.equal(steps.at(-1)?.actionKind, configuration.finalAction);
    assert.equal(steps.at(-1)?.outerUpdateStarted, false);
    assert.equal(steps.at(-1)?.outerUpdateCompleted, false);
    const metadata = serviceFastPathShadowPriceProposalMetadata(state);
    assert.equal(metadata?.completedOuterUpdates, configuration.outerUpdates);
    assert.equal(metadata?.weights.length, routes.length);
    if (metadata?.converged === false) {
      assert.equal(metadata.diagnostic, 'finite-nonconverged-replayed');
    }
  }
});

void test('exposes every per-route method action in the frozen operation order', () => {
  const sequences = new Map<
    ServiceFastPathShadowPriceDriverId,
    readonly ServiceFastPathShadowPriceShareActionKind[]
  >([
    ['bisection-o64-i64', [
      'bisection-endpoint',
      ...Array<ServiceFastPathShadowPriceShareActionKind>(64).fill(
        'bisection-inner-update',
      ),
      'bisection-final-share',
    ]],
    ['bisection-o64-i24', [
      'bisection-endpoint',
      ...Array<ServiceFastPathShadowPriceShareActionKind>(24).fill(
        'bisection-inner-update',
      ),
      'bisection-final-share',
    ]],
    ['bisection-o32-i16', [
      'bisection-endpoint',
      ...Array<ServiceFastPathShadowPriceShareActionKind>(16).fill(
        'bisection-inner-update',
      ),
      'bisection-final-share',
    ]],
    ['bisection-o16-i12', [
      'bisection-endpoint',
      ...Array<ServiceFastPathShadowPriceShareActionKind>(12).fill(
        'bisection-inner-update',
      ),
      'bisection-final-share',
    ]],
    ['pinned-sqrt-o64', [
      'pinned-sqrt-endpoint',
      'pinned-sqrt-formula',
    ]],
    ['fixed-newton-sqrt-o64-n8', [
      'fixed-newton-sqrt-endpoint',
      'fixed-newton-sqrt-normalization',
      ...Array<ServiceFastPathShadowPriceShareActionKind>(8).fill(
        'fixed-newton-sqrt-update',
      ),
      'fixed-newton-sqrt-finalization',
    ]],
  ]);

  for (const driverId of DRIVER_IDS) {
    const state = prepareFastState(
      5n,
      [route(1n, 3n), route(3n, 4n)],
      driverId,
      'final-finite-replay',
    );
    const expected = sequences.get(driverId);
    assert.notEqual(expected, undefined);
    for (const actionKind of expected ?? []) {
      assert.equal(
        serviceFastPathShadowPriceProgress(state).nextShareAction,
        actionKind,
      );
      const step = advanceServiceFastPathShadowPriceShareAction(state);
      assert.equal(step.ok, true);
      assert.equal(step.actionKind, actionKind);
    }
    const progress = serviceFastPathShadowPriceProgress(state);
    assert.equal(progress.nextShareAction, expected?.[0]);
    assert.equal(progress.outerUpdatesStarted, 1);
    assert.equal(progress.outerUpdatesCompleted, 0);
    assert.equal(progress.shareActions, expected?.length);
    assert.equal(progress.methodActions, (expected?.length ?? 0) - 1);
  }
});

void test('preserves the common one-share and zero-share endpoint branches', () => {
  const expectedEndpoint = new Map<
    ServiceFastPathShadowPriceDriverId,
    ServiceFastPathShadowPriceShareActionKind
  >([
    ['bisection-o64-i64', 'bisection-endpoint'],
    ['bisection-o64-i24', 'bisection-endpoint'],
    ['bisection-o32-i16', 'bisection-endpoint'],
    ['bisection-o16-i12', 'bisection-endpoint'],
    ['pinned-sqrt-o64', 'pinned-sqrt-endpoint'],
    ['fixed-newton-sqrt-o64-n8', 'fixed-newton-sqrt-endpoint'],
  ]);
  const routes = [route(100n, 100n), route(100n, 50n)];

  for (const driverId of DRIVER_IDS) {
    const state = prepareFastState(1n, routes, driverId, 'final-finite-replay');
    const endpoint = expectedEndpoint.get(driverId);
    const one = advanceServiceFastPathShadowPriceShareAction(state);
    assert.deepEqual(one, {
      ok: true,
      phase: 'share-action',
      actionKind: endpoint,
      outerUpdateStarted: true,
      outerUpdateCompleted: false,
    });
    assert.equal(serviceFastPathShadowPriceProgress(state).nextShareAction, endpoint);
    const zero = advanceServiceFastPathShadowPriceShareAction(state);
    assert.deepEqual(zero, {
      ok: true,
      phase: 'share-action',
      actionKind: endpoint,
      outerUpdateStarted: false,
      outerUpdateCompleted: true,
    });
    const progress = serviceFastPathShadowPriceProgress(state);
    assert.equal(progress.outerUpdatesStarted, 1);
    assert.equal(progress.outerUpdatesCompleted, 1);
    assert.equal(progress.shareActions, 2);
    assert.equal(progress.methodActions, 0);
  }
});

void test('applies both final-miss policies after each driver fixed outer count', () => {
  const scale = 2n ** 60n;
  const routes = [
    route(10n * scale, 3n * scale),
    route(scale, 8n * scale),
  ];
  const outerUpdates = new Map<ServiceFastPathShadowPriceDriverId, number>([
    ['bisection-o64-i64', 64],
    ['bisection-o64-i24', 64],
    ['bisection-o32-i16', 32],
    ['bisection-o16-i12', 16],
    ['pinned-sqrt-o64', 64],
    ['fixed-newton-sqrt-o64-n8', 64],
  ]);

  for (const driverId of DRIVER_IDS) {
    const configuredOuterUpdates = outerUpdates.get(driverId);
    assert.notEqual(configuredOuterUpdates, undefined);
    const strict = prepareFastState(1n, routes, driverId, 'strict-reject');
    const strictSteps = runFastShares(strict);
    assert.deepEqual(serviceFastPathShadowPriceFailure(strict), {
      code: 'non-convergence',
      converged: false,
      completedOuterUpdates: configuredOuterUpdates,
    });
    assert.equal(serviceFastPathShadowPriceProposalMetadata(strict), undefined);
    assert.equal(strictSteps.at(-1)?.outerUpdateStarted, false);
    assert.equal(strictSteps.at(-1)?.outerUpdateCompleted, false);

    const finite = prepareFastState(1n, routes, driverId, 'final-finite-replay');
    const finiteSteps = runFastShares(finite);
    const progress = serviceFastPathShadowPriceProgress(finite);
    const metadata = serviceFastPathShadowPriceProposalMetadata(finite);
    assert.equal(progress.phase, 'reconstruction-step');
    assert.equal(progress.outerUpdatesStarted, configuredOuterUpdates);
    assert.equal(progress.outerUpdatesCompleted, configuredOuterUpdates);
    assert.equal(progress.shareActions, ((configuredOuterUpdates ?? 0) + 1) * 2);
    assert.equal(progress.methodActions, 0);
    assert.equal(finiteSteps.at(-1)?.outerUpdateStarted, false);
    assert.equal(finiteSteps.at(-1)?.outerUpdateCompleted, false);
    assert.equal(metadata?.converged, false);
    assert.equal(metadata?.diagnostic, 'finite-nonconverged-replayed');
    assert.equal(metadata?.completedOuterUpdates, configuredOuterUpdates);
    assert.equal(metadata?.weights.length, 2);
    for (const weight of metadata?.weights ?? []) {
      assert.equal(Number.isFinite(weight), true);
      assert.equal(Object.is(weight, -0), false);
      assert.ok(weight === 0 || weight >= 2 ** -1022);
      assert.ok(weight >= 0 && weight <= 1);
    }
    assert.equal(serviceFastPathShadowPriceFailure(finite), undefined);
  }
});

void test('precharges a failing endpoint once and leaves later non-actions uncharged', () => {
  const amountIn = 1n << 1_000n;
  const routes = [route(1n, 1n), route(1n, 1n)];
  const expectedEndpoint = new Map<
    ServiceFastPathShadowPriceDriverId,
    ServiceFastPathShadowPriceShareActionKind
  >([
    ['bisection-o64-i64', 'bisection-endpoint'],
    ['bisection-o64-i24', 'bisection-endpoint'],
    ['bisection-o32-i16', 'bisection-endpoint'],
    ['bisection-o16-i12', 'bisection-endpoint'],
    ['pinned-sqrt-o64', 'pinned-sqrt-endpoint'],
    ['fixed-newton-sqrt-o64-n8', 'fixed-newton-sqrt-endpoint'],
  ]);

  for (const driverId of DRIVER_IDS) {
    const state = prepareFastState(
      amountIn,
      routes,
      driverId,
      'final-finite-replay',
    );
    assert.deepEqual(advanceServiceFastPathShadowPriceShareAction(state), {
      ok: false,
      error: {
        code: 'non-finite-proposal',
        converged: false,
        completedOuterUpdates: 0,
      },
      actionKind: expectedEndpoint.get(driverId),
      outerUpdateStarted: true,
      outerUpdateCompleted: false,
    });
    const stopped = serviceFastPathShadowPriceProgress(state);
    assert.equal(stopped.phase, 'failed');
    assert.equal(stopped.nextShareAction, null);
    assert.equal(stopped.outerUpdatesStarted, 1);
    assert.equal(stopped.outerUpdatesCompleted, 0);
    assert.equal(stopped.shareActions, 1);
    assert.equal(stopped.methodActions, 0);
    assert.throws(
      () => advanceServiceFastPathShadowPriceShareAction(state),
      /No service-fast shadow-price share action/u,
    );
    assert.deepEqual(serviceFastPathShadowPriceProgress(state), stopped);
  }
});

void test('precharges and attributes a failing method-core action', () => {
  const state = prepareFastState(
    5n,
    [route(1n, 3n), route(3n, 4n)],
    'pinned-sqrt-o64',
  );
  assert.equal(advanceServiceFastPathShadowPriceShareAction(state).ok, true);
  assert.equal(
    serviceFastPathShadowPriceProgress(state).nextShareAction,
    'pinned-sqrt-formula',
  );
  const originalSquareRoot = Math.sqrt;
  let failed: ServiceFastPathShadowPriceStepResult;
  try {
    Math.sqrt = () => Number.NaN;
    failed = advanceServiceFastPathShadowPriceShareAction(state);
  } finally {
    Math.sqrt = originalSquareRoot;
  }
  assert.deepEqual(failed, {
    ok: false,
    error: {
      code: 'non-finite-proposal',
      converged: false,
      completedOuterUpdates: 0,
    },
    actionKind: 'pinned-sqrt-formula',
    outerUpdateStarted: false,
    outerUpdateCompleted: false,
  });
  const progress = serviceFastPathShadowPriceProgress(state);
  assert.equal(progress.phase, 'failed');
  assert.equal(progress.outerUpdatesStarted, 1);
  assert.equal(progress.outerUpdatesCompleted, 0);
  assert.equal(progress.shareActions, 2);
  assert.equal(progress.methodActions, 1);
});
