import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedExactSplitRepairFailure,
  boundedExactSplitRepairOption,
  boundedExactSplitRepairProgress,
  boundedExactSplitRepairWinner,
  createBoundedExactSplitRepairState,
  settleBoundedExactSplitRepairOption,
  type BoundedExactSplitRepairOutcome,
  type BoundedExactSplitRepairProgress,
  type BoundedExactSplitRepairStepResult,
} from '../../src/allocation/bounded-exact-split-repair/index.ts';

type Allocation = readonly bigint[];

const INDEPENDENT_RECONSTRUCTION = Symbol('independent-reconstruction');

interface Reconstruction {
  readonly [INDEPENDENT_RECONSTRUCTION]: true;
  readonly baseAllocations: Allocation;
  readonly integerWeights: Allocation;
  readonly residualUnits: bigint;
}

function sum(values: Allocation): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function allocationKey(allocation: Allocation): string {
  return allocation.map((value) => value.toString()).join(',');
}

function freezeAllocation(allocation: Allocation): Allocation {
  return Object.freeze([...allocation]);
}

function independentReconstruction(
  baseAllocations: Allocation,
  integerWeights: Allocation,
  residualUnits: bigint,
): Reconstruction {
  assert.ok(baseAllocations.length >= 2 && baseAllocations.length <= 4);
  assert.equal(integerWeights.length, baseAllocations.length);
  assert.ok(baseAllocations.every((allocation) => allocation >= 0n));
  assert.ok(integerWeights.every((weight) => weight >= 0n));
  assert.ok(residualUnits >= 0n);
  const totalWeight = sum(integerWeights);
  const positiveWeightCount = integerWeights.filter((weight) => weight > 0n).length;
  assert.ok(totalWeight > 0n);
  assert.ok(residualUnits < BigInt(positiveWeightCount));
  const totalInput = sum(baseAllocations) + residualUnits;
  assert.ok(totalInput > 0n);
  for (let routeIndex = 0; routeIndex < integerWeights.length; routeIndex += 1) {
    assert.equal(
      baseAllocations[routeIndex],
      (totalInput * integerWeights[routeIndex]!) / totalWeight,
    );
  }
  return Object.freeze({
    [INDEPENDENT_RECONSTRUCTION]: true as const,
    baseAllocations: freezeAllocation(baseAllocations),
    integerWeights: freezeAllocation(integerWeights),
    residualUnits,
  });
}

function canonicalAnchor(reconstruction: Reconstruction): Allocation {
  // This local-only symbol prevents a production reconstruction result from being
  // fed back into the expected-value path during later black-box parity wiring.
  assert.equal(reconstruction[INDEPENDENT_RECONSTRUCTION], true);
  const { baseAllocations, integerWeights, residualUnits } = reconstruction;
  assert.ok(baseAllocations.length >= 2 && baseAllocations.length <= 4);
  assert.equal(integerWeights.length, baseAllocations.length);
  assert.ok(baseAllocations.every((allocation) => allocation >= 0n));
  assert.ok(integerWeights.every((weight) => weight >= 0n));
  const positiveWeightIndexes = integerWeights
    .map((weight, routeIndex) => ({ routeIndex, weight }))
    .filter(({ weight }) => weight > 0n)
    .map(({ routeIndex }) => routeIndex);
  assert.ok(positiveWeightIndexes.length > 0);
  assert.ok(residualUnits >= 0n);
  assert.ok(residualUnits < BigInt(positiveWeightIndexes.length));

  const anchor = [...baseAllocations];
  for (let index = 0; index < Number(residualUnits); index += 1) {
    const routeIndex = positiveWeightIndexes[index];
    if (routeIndex === undefined || anchor[routeIndex] === undefined) {
      throw new Error('residual route index escaped the validated range');
    }
    anchor[routeIndex] += 1n;
  }
  return freezeAllocation(anchor);
}

function enumerateNeighborhood(reconstruction: Reconstruction): readonly Allocation[] {
  const anchor = canonicalAnchor(reconstruction);
  const routeCount = anchor.length;
  const amountIn = sum(anchor);
  const candidates: Allocation[] = [];
  const seen = new Set<string>();

  const add = (allocation: Allocation): void => {
    assert.equal(allocation.length, routeCount);
    assert.ok(allocation.every((value) => value >= 0n));
    assert.equal(sum(allocation), amountIn);
    const frozen = freezeAllocation(allocation);
    const key = allocationKey(frozen);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(frozen);
  };

  add(anchor);

  for (let routeIndex = 0; routeIndex < routeCount; routeIndex += 1) {
    const endpoint = Array<bigint>(routeCount).fill(0n);
    endpoint[routeIndex] = amountIn;
    add(endpoint);
  }

  for (const radius of [1n, 2n] as const) {
    for (let donorIndex = 0; donorIndex < routeCount; donorIndex += 1) {
      const donorAllocation = anchor[donorIndex];
      if (donorAllocation === undefined) {
        throw new Error('donor route index escaped the validated range');
      }
      if (donorAllocation < radius) continue;
      for (let receiverIndex = 0; receiverIndex < routeCount; receiverIndex += 1) {
        if (receiverIndex === donorIndex) continue;
        const neighbor = [...anchor];
        const receiverAllocation = neighbor[receiverIndex];
        if (receiverAllocation === undefined) {
          throw new Error('receiver route index escaped the validated range');
        }
        neighbor[donorIndex] = donorAllocation - radius;
        neighbor[receiverIndex] = receiverAllocation + radius;
        add(neighbor);
      }
    }
  }

  return Object.freeze(candidates);
}

function reconstruct(
  amountIn: bigint,
  integerWeights: Allocation,
): Reconstruction {
  assert.ok(amountIn >= 0n);
  assert.ok(integerWeights.length >= 2 && integerWeights.length <= 4);
  assert.ok(integerWeights.every((weight) => weight >= 0n));
  const totalWeight = sum(integerWeights);
  assert.ok(totalWeight > 0n);
  const baseAllocations = integerWeights.map(
    (weight) => (amountIn * weight) / totalWeight,
  );
  const residualUnits = amountIn - sum(baseAllocations);
  const positiveWeightCount = integerWeights.filter((weight) => weight > 0n).length;
  assert.ok(residualUnits < BigInt(positiveWeightCount));
  return independentReconstruction(baseAllocations, integerWeights, residualUnits);
}

function enumerateWeightVectors(
  routeCount: number,
  maximumWeight: bigint,
): readonly Allocation[] {
  const vectors: Allocation[] = [];
  const visit = (prefix: bigint[]): void => {
    if (prefix.length === routeCount) {
      if (prefix.some((weight) => weight > 0n)) vectors.push(freezeAllocation(prefix));
      return;
    }
    for (let weight = 0n; weight <= maximumWeight; weight += 1n) {
      visit([...prefix, weight]);
    }
  };
  visit([]);
  return vectors;
}

function enumerateExactPartitions(
  amountIn: bigint,
  routeCount: number,
): readonly Allocation[] {
  assert.ok(amountIn >= 0n);
  assert.ok(routeCount >= 1);
  const partitions: Allocation[] = [];
  const visit = (prefix: bigint[], remaining: bigint): void => {
    if (prefix.length === routeCount - 1) {
      partitions.push(freezeAllocation([...prefix, remaining]));
      return;
    }
    for (let allocation = 0n; allocation <= remaining; allocation += 1n) {
      visit([...prefix, allocation], remaining - allocation);
    }
  };
  visit([], amountIn);
  return partitions;
}

function allocations(...rows: readonly (readonly number[])[]): readonly Allocation[] {
  return rows.map((row) => freezeAllocation(row.map(BigInt)));
}

interface ActualNeighborhood {
  readonly allocations: readonly Allocation[];
  readonly terminal: BoundedExactSplitRepairStepResult;
  readonly progress: BoundedExactSplitRepairProgress;
  readonly winner: ReturnType<typeof boundedExactSplitRepairWinner>;
  readonly failure: ReturnType<typeof boundedExactSplitRepairFailure>;
}

function createActualRepairState(reconstruction: Reconstruction) {
  assert.equal(reconstruction[INDEPENDENT_RECONSTRUCTION], true);
  return createBoundedExactSplitRepairState({
    integerWeights: [...reconstruction.integerWeights],
    baseAllocations: [...reconstruction.baseAllocations],
    residualUnits: reconstruction.residualUnits,
  });
}

function drainActualNeighborhood(
  reconstruction: Reconstruction,
  outcome: (neighborIndex: number) => BoundedExactSplitRepairOutcome =
    (neighborIndex) => neighborIndex === 0 ? 'valid-best' : 'valid-not-best',
): ActualNeighborhood {
  const state = createActualRepairState(reconstruction);
  const actual: Allocation[] = [];
  let terminal: BoundedExactSplitRepairStepResult | undefined;
  while (boundedExactSplitRepairProgress(state).phase === 'option') {
    const option = boundedExactSplitRepairOption(state);
    assert.equal(option.neighborIndex, actual.length);
    actual.push(freezeAllocation(option.allocations));
    terminal = settleBoundedExactSplitRepairOption(
      state,
      outcome(option.neighborIndex),
    );
  }
  assert.notEqual(terminal, undefined);
  return Object.freeze({
    allocations: Object.freeze(actual),
    terminal: terminal!,
    progress: boundedExactSplitRepairProgress(state),
    winner: boundedExactSplitRepairWinner(state),
    failure: boundedExactSplitRepairFailure(state),
  });
}

function assertNeighborhoodParity(
  reconstruction: Reconstruction,
  handExpected: readonly Allocation[],
): void {
  const independentExpected = enumerateNeighborhood(reconstruction);
  assert.deepEqual(independentExpected, handExpected);
  const actual = drainActualNeighborhood(reconstruction);
  assert.deepEqual(actual.allocations, independentExpected);
  assert.deepEqual(actual.terminal, { ok: true, phase: 'complete' });
  assert.equal(actual.progress.phase, 'complete');
  assert.equal(actual.progress.rawCandidatesVisited, actual.progress.rawCandidateLimit);
  assert.equal(actual.progress.attemptedNeighbors, independentExpected.length);
  assert.equal(actual.progress.settledNeighbors, independentExpected.length);
  assert.equal(actual.progress.rejectedNeighbors, 0);
  assert.equal(actual.progress.optionPending, false);
  assert.deepEqual(actual.winner, {
    neighborIndex: 0,
    allocations: independentExpected[0],
  });
  assert.equal(actual.failure, undefined);
}

void test('hand-audited repair neighborhoods freeze canonical order and deduplication', () => {
  assertNeighborhoodParity(
    independentReconstruction([0n, 0n], [1n, 1n], 1n),
    allocations([1, 0], [0, 1]),
  );

  assertNeighborhoodParity(
    independentReconstruction([1n, 1n], [1n, 1n], 1n),
    allocations([2, 1], [3, 0], [0, 3], [1, 2]),
  );

  assertNeighborhoodParity(
    independentReconstruction([2n, 2n, 2n], [1n, 1n, 1n], 2n),
    allocations(
      [3, 3, 2],
      [8, 0, 0],
      [0, 8, 0],
      [0, 0, 8],
      [2, 4, 2],
      [2, 3, 3],
      [4, 2, 2],
      [3, 2, 3],
      [4, 3, 1],
      [3, 4, 1],
      [1, 5, 2],
      [1, 3, 4],
      [5, 1, 2],
      [3, 1, 4],
      [5, 3, 0],
      [3, 5, 0],
    ),
  );

  assertNeighborhoodParity(
    independentReconstruction([3n, 3n, 3n, 3n], [1n, 1n, 1n, 1n], 3n),
    allocations(
      [4, 4, 4, 3],
      [15, 0, 0, 0],
      [0, 15, 0, 0],
      [0, 0, 15, 0],
      [0, 0, 0, 15],
      [3, 5, 4, 3],
      [3, 4, 5, 3],
      [3, 4, 4, 4],
      [5, 3, 4, 3],
      [4, 3, 5, 3],
      [4, 3, 4, 4],
      [5, 4, 3, 3],
      [4, 5, 3, 3],
      [4, 4, 3, 4],
      [5, 4, 4, 2],
      [4, 5, 4, 2],
      [4, 4, 5, 2],
      [2, 6, 4, 3],
      [2, 4, 6, 3],
      [2, 4, 4, 5],
      [6, 2, 4, 3],
      [4, 2, 6, 3],
      [4, 2, 4, 5],
      [6, 4, 2, 3],
      [4, 6, 2, 3],
      [4, 4, 2, 5],
      [6, 4, 4, 1],
      [4, 6, 4, 1],
      [4, 4, 6, 1],
    ),
  );

  assertNeighborhoodParity(
    independentReconstruction([2n, 0n, 3n], [2n, 0n, 3n], 1n),
    allocations(
      [3, 0, 3],
      [6, 0, 0],
      [0, 6, 0],
      [0, 0, 6],
      [2, 1, 3],
      [2, 0, 4],
      [4, 0, 2],
      [3, 1, 2],
      [1, 2, 3],
      [1, 0, 5],
      [5, 0, 1],
      [3, 2, 1],
    ),
  );
});

void test('exhaustive 2/3/4-route reconstruction yields canonical exact-sum neighborhoods bounded by 29', () => {
  const largestNeighborhoods: number[] = [];

  for (const routeCount of [2, 3, 4]) {
    const structuralBound = 1 + routeCount + 2 * routeCount * (routeCount - 1);
    let largestNeighborhood = 0;
    for (const integerWeights of enumerateWeightVectors(routeCount, 2n)) {
      for (let amountIn = 1n; amountIn <= 8n; amountIn += 1n) {
        const reconstruction = reconstruct(amountIn, integerWeights);
        const anchor = canonicalAnchor(reconstruction);
        const neighborhood = enumerateNeighborhood(reconstruction);
        const exactPartitions = new Set(
          enumerateExactPartitions(amountIn, routeCount).map(allocationKey),
        );
        const keys = neighborhood.map(allocationKey);
        const actual = drainActualNeighborhood(reconstruction);

        assert.deepEqual(neighborhood[0], anchor);
        assert.equal(new Set(keys).size, keys.length);
        assert.ok(neighborhood.length <= structuralBound);
        for (const candidate of neighborhood) {
          assert.equal(candidate.length, routeCount);
          assert.ok(candidate.every((allocation) => allocation >= 0n));
          assert.equal(sum(candidate), amountIn);
          assert.ok(exactPartitions.has(allocationKey(candidate)));
        }
        assert.deepEqual(actual.allocations, neighborhood);
        assert.deepEqual(actual.terminal, { ok: true, phase: 'complete' });
        assert.deepEqual(actual.progress, {
          phase: 'complete',
          routeCount,
          rawCandidateLimit: structuralBound,
          rawCandidatesVisited: structuralBound,
          attemptedNeighbors: neighborhood.length,
          settledNeighbors: neighborhood.length,
          rejectedNeighbors: 0,
          optionPending: false,
        });
        assert.deepEqual(actual.winner, {
          neighborIndex: 0,
          allocations: neighborhood[0],
        });
        assert.equal(actual.failure, undefined);
        largestNeighborhood = Math.max(largestNeighborhood, neighborhood.length);
      }
    }
    largestNeighborhoods.push(largestNeighborhood);
  }

  assert.deepEqual(largestNeighborhoods, [7, 16, 29]);
});

void test('terminates on the final replay without an option sentinel and counts rejection', () => {
  const reconstruction = reconstruct(1n, [9n, 1n]);
  const independentExpected = enumerateNeighborhood(reconstruction);
  assert.deepEqual(independentExpected, allocations([1, 0], [0, 1]));
  const state = createActualRepairState(reconstruction);

  const first = boundedExactSplitRepairOption(state);
  assert.deepEqual(first.allocations, independentExpected[0]);
  assert.deepEqual(settleBoundedExactSplitRepairOption(state, 'rejected'), {
    ok: true,
    phase: 'option',
  });
  const second = boundedExactSplitRepairOption(state);
  assert.deepEqual(second.allocations, independentExpected[1]);
  assert.deepEqual(settleBoundedExactSplitRepairOption(state, 'rejected'), {
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
  assert.equal(boundedExactSplitRepairWinner(state), undefined);
  assert.throws(
    () => boundedExactSplitRepairOption(state),
    /No new bounded exact split repair option/u,
  );
});

void test('suppresses a stopped provisional winner and preserves invalid settlement state', () => {
  const reconstruction = reconstruct(8n, [1n, 1n, 1n]);
  const stopped = createActualRepairState(reconstruction);
  assert.deepEqual(
    boundedExactSplitRepairOption(stopped).allocations,
    enumerateNeighborhood(reconstruction)[0],
  );
  assert.deepEqual(settleBoundedExactSplitRepairOption(stopped, 'valid-best'), {
    ok: true,
    phase: 'option',
  });
  assert.equal(boundedExactSplitRepairProgress(stopped).phase, 'option');
  assert.equal(boundedExactSplitRepairWinner(stopped), undefined);
  assert.equal(boundedExactSplitRepairFailure(stopped), undefined);

  const invalid = createActualRepairState(reconstruct(5n, [1n, 1n]));
  boundedExactSplitRepairOption(invalid);
  const pending = boundedExactSplitRepairProgress(invalid);
  assert.throws(
    () => settleBoundedExactSplitRepairOption(invalid, 'valid-not-best'),
    /outcome is invalid/u,
  );
  assert.deepEqual(boundedExactSplitRepairProgress(invalid), pending);
  assert.equal(boundedExactSplitRepairWinner(invalid), undefined);
  assert.equal(boundedExactSplitRepairFailure(invalid), undefined);
});

void test('matches an independently reconstructed 255-bit neighborhood exactly', () => {
  const amountIn = (1n << 255n) - 1n;
  const reconstruction = reconstruct(amountIn, [1n, 2n, 3n, 4n]);
  const independentExpected = enumerateNeighborhood(reconstruction);
  const actual = drainActualNeighborhood(reconstruction);
  assert.deepEqual(actual.allocations, independentExpected);
  assert.deepEqual(actual.terminal, { ok: true, phase: 'complete' });
  assert.equal(actual.progress.rawCandidateLimit, 29);
  assert.deepEqual(actual.winner, {
    neighborIndex: 0,
    allocations: independentExpected[0],
  });
  assert.equal(actual.failure, undefined);
  for (const candidate of actual.allocations) {
    assert.equal(sum(candidate), amountIn);
    assert.ok(candidate.every((allocation) => allocation >= 0n));
  }
});
