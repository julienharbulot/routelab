import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedExactSplitRepairFailure,
  boundedExactSplitRepairOption,
  boundedExactSplitRepairProgress,
  boundedExactSplitRepairWinner,
  createBoundedExactSplitRepairState,
  settleBoundedExactSplitRepairOption,
  type BoundedExactSplitRepairOption,
  type BoundedExactSplitRepairOutcome,
  type BoundedExactSplitRepairReconstruction,
  type BoundedExactSplitRepairState,
  type BoundedExactSplitRepairStepResult,
} from '../src/allocation/bounded-exact-split-repair/index.ts';

function bigintSum(values: readonly bigint[]): bigint {
  let sum = 0n;
  for (const value of values) sum += value;
  return sum;
}

function reconstruction(
  integerWeights: readonly bigint[],
  totalInput: bigint,
): BoundedExactSplitRepairReconstruction {
  const totalWeight = bigintSum(integerWeights);
  assert.ok(totalWeight > 0n);
  const baseAllocations = integerWeights.map(
    (weight) => (totalInput * weight) / totalWeight,
  );
  const residualUnits = totalInput - bigintSum(baseAllocations);
  return Object.freeze({
    integerWeights: Object.freeze([...integerWeights]),
    baseAllocations: Object.freeze(baseAllocations),
    residualUnits,
  });
}

function collectOptions(
  state: BoundedExactSplitRepairState,
  outcome: (option: BoundedExactSplitRepairOption) => BoundedExactSplitRepairOutcome,
): {
  readonly options: readonly BoundedExactSplitRepairOption[];
  readonly terminal: BoundedExactSplitRepairStepResult;
} {
  const options: BoundedExactSplitRepairOption[] = [];
  let terminal: BoundedExactSplitRepairStepResult | undefined;
  while (boundedExactSplitRepairProgress(state).phase === 'option') {
    const option = boundedExactSplitRepairOption(state);
    assert.equal(option.neighborIndex, options.length);
    assert.equal(Object.isFrozen(option), true);
    assert.equal(Object.isFrozen(option.allocations), true);
    options.push(option);
    terminal = settleBoundedExactSplitRepairOption(state, outcome(option));
  }
  assert.notEqual(terminal, undefined);
  const progress = boundedExactSplitRepairProgress(state);
  assert.equal(progress.attemptedNeighbors, options.length);
  assert.equal(progress.settledNeighbors, options.length);
  assert.equal(progress.optionPending, false);
  return { options: Object.freeze(options), terminal: terminal! };
}

function key(allocations: readonly bigint[]): string {
  return allocations.map((allocation) => allocation.toString(10)).join(',');
}

void test('enumerates the canonical two-route golden and completes on its last replay', () => {
  const state = createBoundedExactSplitRepairState(reconstruction([1n, 1n], 5n));
  const initialProgress = boundedExactSplitRepairProgress(state);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(initialProgress), true);
  assert.notEqual(initialProgress, boundedExactSplitRepairProgress(state));
  const { options, terminal } = collectOptions(
    state,
    (option) => option.neighborIndex === 0 || option.neighborIndex === 3
      ? 'valid-best'
      : 'valid-not-best',
  );
  assert.deepEqual(options.map((option) => option.allocations), [
    [3n, 2n],
    [5n, 0n],
    [0n, 5n],
    [2n, 3n],
    [4n, 1n],
    [1n, 4n],
  ]);
  assert.deepEqual(terminal, { ok: true, phase: 'complete' });
  assert.deepEqual(boundedExactSplitRepairProgress(state), {
    phase: 'complete',
    routeCount: 2,
    rawCandidateLimit: 7,
    rawCandidatesVisited: 7,
    attemptedNeighbors: 6,
    settledNeighbors: 6,
    rejectedNeighbors: 0,
    optionPending: false,
  });
  assert.deepEqual(boundedExactSplitRepairWinner(state), {
    neighborIndex: 3,
    allocations: [2n, 3n],
  });
  assert.throws(
    () => boundedExactSplitRepairOption(state),
    /No new bounded exact split repair option/u,
  );
});

void test('locks the three-route anchor, endpoint, and ordered transfer golden', () => {
  const state = createBoundedExactSplitRepairState(reconstruction([1n, 1n, 1n], 8n));
  const { options, terminal } = collectOptions(
    state,
    (option) => option.neighborIndex === 0 || option.neighborIndex === 15
      ? 'valid-best'
      : 'valid-not-best',
  );
  assert.deepEqual(options.map((option) => option.allocations), [
    [3n, 3n, 2n],
    [8n, 0n, 0n],
    [0n, 8n, 0n],
    [0n, 0n, 8n],
    [2n, 4n, 2n],
    [2n, 3n, 3n],
    [4n, 2n, 2n],
    [3n, 2n, 3n],
    [4n, 3n, 1n],
    [3n, 4n, 1n],
    [1n, 5n, 2n],
    [1n, 3n, 4n],
    [5n, 1n, 2n],
    [3n, 1n, 4n],
    [5n, 3n, 0n],
    [3n, 5n, 0n],
  ]);
  assert.deepEqual(terminal, { ok: true, phase: 'complete' });
  assert.deepEqual(boundedExactSplitRepairWinner(state), {
    neighborIndex: 15,
    allocations: [3n, 5n, 0n],
  });
});

void test('reaches the exact 29-neighbor four-route bound without duplicates', () => {
  const state = createBoundedExactSplitRepairState(
    reconstruction([1n, 1n, 1n, 1n], 13n),
  );
  const { options, terminal } = collectOptions(
    state,
    (option) => option.neighborIndex === 0 ? 'valid-best' : 'valid-not-best',
  );
  assert.equal(options.length, 29);
  assert.equal(new Set(options.map((option) => key(option.allocations))).size, 29);
  assert.deepEqual(options.slice(0, 5).map((option) => option.allocations), [
    [4n, 3n, 3n, 3n],
    [13n, 0n, 0n, 0n],
    [0n, 13n, 0n, 0n],
    [0n, 0n, 13n, 0n],
    [0n, 0n, 0n, 13n],
  ]);
  assert.deepEqual(options[5]?.allocations, [3n, 4n, 3n, 3n]);
  assert.deepEqual(options.at(-1)?.allocations, [4n, 3n, 5n, 1n]);
  assert.deepEqual(terminal, { ok: true, phase: 'complete' });
  assert.deepEqual(boundedExactSplitRepairProgress(state), {
    phase: 'complete',
    routeCount: 4,
    rawCandidateLimit: 29,
    rawCandidatesVisited: 29,
    attemptedNeighbors: 29,
    settledNeighbors: 29,
    rejectedNeighbors: 0,
    optionPending: false,
  });
});

void test('deduplicates zero-allocation neighbors and fails on the last rejected replay', () => {
  const state = createBoundedExactSplitRepairState(reconstruction([9n, 1n], 1n));
  const { options, terminal } = collectOptions(state, () => 'rejected');
  assert.deepEqual(options.map((option) => option.allocations), [
    [1n, 0n],
    [0n, 1n],
  ]);
  assert.deepEqual(terminal, {
    ok: false,
    error: {
      code: 'repair-no-valid-neighbor',
      attemptedNeighbors: 2,
      rejectedNeighbors: 2,
    },
  });
  assert.deepEqual(boundedExactSplitRepairProgress(state), {
    phase: 'failed',
    routeCount: 2,
    rawCandidateLimit: 7,
    rawCandidatesVisited: 7,
    attemptedNeighbors: 2,
    settledNeighbors: 2,
    rejectedNeighbors: 2,
    optionPending: false,
  });
  assert.deepEqual(boundedExactSplitRepairFailure(state), {
    code: 'repair-no-valid-neighbor',
    attemptedNeighbors: 2,
    rejectedNeighbors: 2,
  });
  assert.equal(Object.isFrozen(boundedExactSplitRepairFailure(state)), true);
  assert.equal(boundedExactSplitRepairWinner(state), undefined);
});

void test('does not expose a provisional winner from a stopped cursor', () => {
  const state = createBoundedExactSplitRepairState(reconstruction([1n, 1n, 1n], 8n));
  const option = boundedExactSplitRepairOption(state);
  assert.equal(settleBoundedExactSplitRepairOption(state, 'valid-best').ok, true);
  assert.equal(boundedExactSplitRepairProgress(state).phase, 'option');
  assert.equal(boundedExactSplitRepairProgress(state).attemptedNeighbors, 1);
  assert.equal(boundedExactSplitRepairProgress(state).settledNeighbors, 1);
  assert.equal(boundedExactSplitRepairWinner(state), undefined);
  assert.equal(boundedExactSplitRepairFailure(state), undefined);
  assert.deepEqual(option.allocations, [3n, 3n, 2n]);
});

void test('rejects valid-not-best before a provisional winner without settling the option', () => {
  const state = createBoundedExactSplitRepairState(reconstruction([1n, 1n], 5n));
  boundedExactSplitRepairOption(state);
  const pending = boundedExactSplitRepairProgress(state);
  assert.throws(
    () => settleBoundedExactSplitRepairOption(state, 'valid-not-best'),
    /outcome is invalid/u,
  );
  assert.deepEqual(boundedExactSplitRepairProgress(state), pending);
  assert.deepEqual(
    settleBoundedExactSplitRepairOption(state, 'valid-best'),
    { ok: true, phase: 'option' },
  );
  assert.equal(boundedExactSplitRepairProgress(state).settledNeighbors, 1);
  assert.equal(boundedExactSplitRepairWinner(state), undefined);
  assert.equal(boundedExactSplitRepairFailure(state), undefined);
});

void test('rejects valid-not-best for every option until a winner exists', () => {
  const state = createBoundedExactSplitRepairState(reconstruction([9n, 1n], 1n));
  let terminal: BoundedExactSplitRepairStepResult | undefined;
  while (boundedExactSplitRepairProgress(state).phase === 'option') {
    boundedExactSplitRepairOption(state);
    const pending = boundedExactSplitRepairProgress(state);
    assert.throws(
      () => settleBoundedExactSplitRepairOption(state, 'valid-not-best'),
      /outcome is invalid/u,
    );
    assert.deepEqual(boundedExactSplitRepairProgress(state), pending);
    terminal = settleBoundedExactSplitRepairOption(state, 'rejected');
  }
  assert.deepEqual(terminal, {
    ok: false,
    error: {
      code: 'repair-no-valid-neighbor',
      attemptedNeighbors: 2,
      rejectedNeighbors: 2,
    },
  });
  assert.deepEqual(boundedExactSplitRepairProgress(state), {
    phase: 'failed',
    routeCount: 2,
    rawCandidateLimit: 7,
    rawCandidatesVisited: 7,
    attemptedNeighbors: 2,
    settledNeighbors: 2,
    rejectedNeighbors: 2,
    optionPending: false,
  });
});

void test('preserves exact 255-bit sums and returns fresh frozen winners', () => {
  const totalInput = (1n << 255n) - 1n;
  const state = createBoundedExactSplitRepairState(
    reconstruction([1n, 1n, 1n], totalInput),
  );
  const { options } = collectOptions(
    state,
    (option) => option.neighborIndex === 0 ? 'valid-best' : 'valid-not-best',
  );
  for (const option of options) assert.equal(bigintSum(option.allocations), totalInput);
  const first = boundedExactSplitRepairWinner(state);
  const second = boundedExactSplitRepairWinner(state);
  assert.notEqual(first, second);
  assert.notEqual(first?.allocations, second?.allocations);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first?.allocations), true);
  assert.equal(bigintSum(first?.allocations ?? []), totalInput);
});

void test('defensively captures once and rejects hostile or inconsistent reconstruction', () => {
  const source = reconstruction([1n, 1n], 5n);
  const reads = { integerWeights: 0, baseAllocations: 0, residualUnits: 0 };
  let weightLengthReads = 0;
  let allocationLengthReads = 0;
  let weightIndexReads = 0;
  let allocationIndexReads = 0;
  const integerWeights = new Proxy([...source.integerWeights], {
    get(target, property, receiver): unknown {
      if (property === 'length') weightLengthReads += 1;
      if (property === '0' || property === '1') weightIndexReads += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  const baseAllocations = new Proxy([...source.baseAllocations], {
    get(target, property, receiver): unknown {
      if (property === 'length') allocationLengthReads += 1;
      if (property === '0' || property === '1') allocationIndexReads += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  const capturedSource = {
    get integerWeights(): readonly bigint[] {
      reads.integerWeights += 1;
      return integerWeights;
    },
    get baseAllocations(): readonly bigint[] {
      reads.baseAllocations += 1;
      return baseAllocations;
    },
    get residualUnits(): bigint {
      reads.residualUnits += 1;
      return source.residualUnits;
    },
  };
  const state = createBoundedExactSplitRepairState(capturedSource);
  integerWeights[0] = 0n;
  baseAllocations[0] = 0n;
  assert.deepEqual(boundedExactSplitRepairOption(state).allocations, [3n, 2n]);
  assert.deepEqual(reads, { integerWeights: 1, baseAllocations: 1, residualUnits: 1 });
  assert.equal(weightLengthReads, 1);
  assert.equal(allocationLengthReads, 1);
  assert.equal(weightIndexReads, 2);
  assert.equal(allocationIndexReads, 2);

  const revoked = Proxy.revocable([1n, 1n], {});
  revoked.revoke();
  assert.throws(
    () => createBoundedExactSplitRepairState({
      integerWeights: revoked.proxy,
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    }),
    /reconstruction is invalid/u,
  );
  let driftingLengthReads = 0;
  const drifting = new Proxy([1n, 1n], {
    get(target, property, receiver): unknown {
      if (property === 'length') {
        driftingLengthReads += 1;
        return driftingLengthReads === 1 ? 3 : 2;
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assert.throws(
    () => createBoundedExactSplitRepairState({
      integerWeights: drifting,
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    }),
    /reconstruction is invalid/u,
  );
  assert.equal(driftingLengthReads, 1);
  const fractional = new Proxy([1n, 1n], {
    get(target, property, receiver): unknown {
      if (property === 'length') return 2.5;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assert.throws(
    () => createBoundedExactSplitRepairState({
      integerWeights: fractional,
      baseAllocations: [2n, 2n],
      residualUnits: 1n,
    }),
    /reconstruction is invalid/u,
  );
  const throwing = new Proxy([2n, 2n], {
    get(target, property, receiver): unknown {
      if (property === 'length') throw new Error('hostile length');
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  assert.throws(
    () => createBoundedExactSplitRepairState({
      integerWeights: [1n, 1n],
      baseAllocations: throwing,
      residualUnits: 1n,
    }),
    /reconstruction is invalid/u,
  );
  assert.throws(
    () => createBoundedExactSplitRepairState({
      integerWeights: [1n, 1n],
      baseAllocations: [3n, 1n],
      residualUnits: 1n,
    }),
    /reconstruction is invalid/u,
  );
  assert.throws(
    () => createBoundedExactSplitRepairState({
      integerWeights: [1n, 1n],
      baseAllocations: [0n, 0n],
      residualUnits: 2n,
    }),
    /reconstruction is invalid/u,
  );
});

void test('authenticates cursor state and rejects out-of-phase calls before mutation', () => {
  const forged = Object.freeze({}) as BoundedExactSplitRepairState;
  assert.throws(() => boundedExactSplitRepairProgress(forged), /Unknown/u);
  assert.throws(() => boundedExactSplitRepairWinner(forged), /Unknown/u);
  const state = createBoundedExactSplitRepairState(reconstruction([1n, 1n], 5n));
  assert.throws(
    () => settleBoundedExactSplitRepairOption(state, 'valid-best'),
    /outcome is invalid/u,
  );
  boundedExactSplitRepairOption(state);
  const pending = boundedExactSplitRepairProgress(state);
  assert.throws(
    () => boundedExactSplitRepairOption(state),
    /No new bounded exact split repair option/u,
  );
  assert.throws(
    () => settleBoundedExactSplitRepairOption(
      state,
      'invalid' as BoundedExactSplitRepairOutcome,
    ),
    /outcome is invalid/u,
  );
  assert.deepEqual(boundedExactSplitRepairProgress(state), pending);
});

function compositions(total: number, routeCount: number): readonly bigint[][] {
  if (routeCount === 1) return [[BigInt(total)]];
  const values: bigint[][] = [];
  for (let first = 0; first <= total; first += 1) {
    for (const rest of compositions(total - first, routeCount - 1)) {
      values.push([BigInt(first), ...rest]);
    }
  }
  return values;
}

function isExpectedTinyNeighbor(
  candidate: readonly bigint[],
  anchor: readonly bigint[],
  totalInput: bigint,
): boolean {
  if (key(candidate) === key(anchor)) return true;
  if (candidate.some((allocation) => allocation === totalInput)) return true;
  const differences = candidate.map((allocation, index) => allocation - anchor[index]!);
  const nonzero = differences.filter((difference) => difference !== 0n);
  if (nonzero.length !== 2) return false;
  const negative = nonzero.find((difference) => difference < 0n);
  const positive = nonzero.find((difference) => difference > 0n);
  return negative !== undefined &&
    positive !== undefined &&
    -negative === positive &&
    (positive === 1n || positive === 2n);
}

void test('matches tiny exhaustive neighborhood membership for two, three, and four routes', () => {
  const cases = [
    { routeCount: 2, totalInput: 3 },
    { routeCount: 3, totalInput: 4 },
    { routeCount: 4, totalInput: 5 },
  ];
  for (const tiny of cases) {
    const weights = Array<bigint>(tiny.routeCount).fill(1n);
    const source = reconstruction(weights, BigInt(tiny.totalInput));
    const state = createBoundedExactSplitRepairState(source);
    const { options } = collectOptions(
      state,
      (option) => option.neighborIndex === 0 ? 'valid-best' : 'valid-not-best',
    );
    const anchor = options[0]?.allocations;
    assert.notEqual(anchor, undefined);
    const expected = new Set(
      compositions(tiny.totalInput, tiny.routeCount)
        .filter((candidate) => isExpectedTinyNeighbor(
          candidate,
          anchor ?? [],
          BigInt(tiny.totalInput),
        ))
        .map(key),
    );
    const actual = new Set(options.map((option) => key(option.allocations)));
    assert.deepEqual(actual, expected);
    for (const option of options) {
      assert.equal(bigintSum(option.allocations), BigInt(tiny.totalInput));
      assert.ok(option.allocations.every((allocation) => allocation >= 0n));
    }
  }
});
