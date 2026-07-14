declare const boundedExactSplitRepairStateBrand: unique symbol;

/** @internal */
export interface BoundedExactSplitRepairReconstruction {
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
}

/** @internal */
export interface BoundedExactSplitRepairState {
  readonly [boundedExactSplitRepairStateBrand]:
    typeof boundedExactSplitRepairStateBrand;
}

/** @internal */
export type BoundedExactSplitRepairPhase = 'option' | 'complete' | 'failed';

/** @internal */
export interface BoundedExactSplitRepairProgress {
  readonly phase: BoundedExactSplitRepairPhase;
  readonly routeCount: number;
  readonly rawCandidateLimit: number;
  readonly rawCandidatesVisited: number;
  readonly attemptedNeighbors: number;
  readonly settledNeighbors: number;
  readonly rejectedNeighbors: number;
  readonly optionPending: boolean;
}

/** @internal */
export interface BoundedExactSplitRepairOption {
  readonly neighborIndex: number;
  readonly allocations: readonly bigint[];
}

/** @internal */
export type BoundedExactSplitRepairOutcome =
  | 'rejected'
  | 'valid-not-best'
  | 'valid-best';

/** @internal */
export interface BoundedExactSplitRepairWinner {
  readonly neighborIndex: number;
  readonly allocations: readonly bigint[];
}

/** @internal */
export interface BoundedExactSplitRepairFailure {
  readonly code: 'repair-no-valid-neighbor';
  readonly attemptedNeighbors: number;
  readonly rejectedNeighbors: number;
}

/** @internal */
export type BoundedExactSplitRepairStepResult =
  | {
      readonly ok: true;
      readonly phase: 'option' | 'complete';
    }
  | {
      readonly ok: false;
      readonly error: BoundedExactSplitRepairFailure;
    };

interface CapturedReconstruction {
  readonly integerWeights: readonly bigint[];
  readonly baseAllocations: readonly bigint[];
  readonly residualUnits: bigint;
  readonly totalInput: bigint;
  readonly anchor: readonly bigint[];
}

interface MutableState {
  readonly reconstruction: CapturedReconstruction;
  readonly routeCount: number;
  readonly rawCandidateLimit: number;
  readonly seen: Set<string>;
  phase: BoundedExactSplitRepairPhase;
  rawCandidateIndex: number;
  rawCandidatesVisited: number;
  attemptedNeighbors: number;
  settledNeighbors: number;
  rejectedNeighbors: number;
  nextAllocations: readonly bigint[] | undefined;
  pendingOption: BoundedExactSplitRepairOption | undefined;
  provisionalWinner: BoundedExactSplitRepairWinner | undefined;
  winner: BoundedExactSplitRepairWinner | undefined;
  failure: BoundedExactSplitRepairFailure | undefined;
}

const states = new WeakMap<BoundedExactSplitRepairState, MutableState>();

function stateOf(handle: BoundedExactSplitRepairState): MutableState {
  const state = states.get(handle);
  if (state === undefined) throw new TypeError('Unknown bounded exact split repair state.');
  return state;
}

function captureBigintVector(value: unknown): readonly bigint[] | undefined {
  const captured: bigint[] = [];
  try {
    if (!Array.isArray(value)) return undefined;
    const source = value as readonly unknown[];
    const length = source.length;
    if (!Number.isSafeInteger(length) || length < 2 || length > 4) return undefined;
    for (let index = 0; index < length; index += 1) {
      const item = source[index];
      if (typeof item !== 'bigint' || item < 0n) return undefined;
      captured.push(item);
    }
  } catch {
    return undefined;
  }
  return Object.freeze(captured);
}

function bigintSum(values: readonly bigint[]): bigint {
  let sum = 0n;
  for (const value of values) sum += value;
  return sum;
}

function captureReconstruction(value: unknown): CapturedReconstruction | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  let sourceIntegerWeights: unknown;
  let sourceBaseAllocations: unknown;
  let residualUnits: unknown;
  try {
    const source = value as Record<string, unknown>;
    sourceIntegerWeights = source['integerWeights'];
    sourceBaseAllocations = source['baseAllocations'];
    residualUnits = source['residualUnits'];
  } catch {
    return undefined;
  }
  const integerWeights = captureBigintVector(sourceIntegerWeights);
  const baseAllocations = captureBigintVector(sourceBaseAllocations);
  if (
    integerWeights === undefined ||
    baseAllocations === undefined ||
    integerWeights.length !== baseAllocations.length ||
    typeof residualUnits !== 'bigint' ||
    residualUnits < 0n
  ) {
    return undefined;
  }
  let positiveWeightCount = 0;
  for (const weight of integerWeights) {
    if (weight > 0n) positiveWeightCount += 1;
  }
  const totalIntegerWeight = bigintSum(integerWeights);
  if (
    positiveWeightCount === 0 ||
    totalIntegerWeight <= 0n ||
    residualUnits >= BigInt(positiveWeightCount)
  ) {
    return undefined;
  }
  const baseTotal = bigintSum(baseAllocations);
  const totalInput = baseTotal + residualUnits;
  if (totalInput <= 0n) return undefined;
  for (let index = 0; index < integerWeights.length; index += 1) {
    const expected = (totalInput * integerWeights[index]!) / totalIntegerWeight;
    if (baseAllocations[index] !== expected) return undefined;
  }

  const anchor = [...baseAllocations];
  let remaining = residualUnits;
  for (let routeIndex = 0; routeIndex < integerWeights.length; routeIndex += 1) {
    if (remaining === 0n) break;
    if (integerWeights[routeIndex]! > 0n) {
      anchor[routeIndex] = anchor[routeIndex]! + 1n;
      remaining -= 1n;
    }
  }
  if (remaining !== 0n || bigintSum(anchor) !== totalInput) return undefined;
  return Object.freeze({
    integerWeights,
    baseAllocations,
    residualUnits,
    totalInput,
    anchor: Object.freeze(anchor),
  });
}

function candidateKey(allocations: readonly bigint[]): string {
  return allocations.map((allocation) => allocation.toString(10)).join(',');
}

function endpointCandidate(state: MutableState, routeIndex: number): readonly bigint[] {
  const allocations = Array<bigint>(state.routeCount).fill(0n);
  allocations[routeIndex] = state.reconstruction.totalInput;
  return Object.freeze(allocations);
}

function transferCandidate(
  state: MutableState,
  pairIndex: number,
  radius: 1n | 2n,
): readonly bigint[] | undefined {
  const pairsPerDonor = state.routeCount - 1;
  const donorIndex = Math.floor(pairIndex / pairsPerDonor);
  const receiverOrdinal = pairIndex % pairsPerDonor;
  const receiverIndex = receiverOrdinal >= donorIndex
    ? receiverOrdinal + 1
    : receiverOrdinal;
  const donorAllocation = state.reconstruction.anchor[donorIndex];
  const receiverAllocation = state.reconstruction.anchor[receiverIndex];
  if (
    donorAllocation === undefined ||
    receiverAllocation === undefined ||
    donorAllocation < radius
  ) {
    return undefined;
  }
  const allocations = [...state.reconstruction.anchor];
  allocations[donorIndex] = donorAllocation - radius;
  allocations[receiverIndex] = receiverAllocation + radius;
  return Object.freeze(allocations);
}

function rawCandidate(
  state: MutableState,
  rawIndex: number,
): readonly bigint[] | undefined {
  if (rawIndex === 0) return state.reconstruction.anchor;
  if (rawIndex <= state.routeCount) {
    return endpointCandidate(state, rawIndex - 1);
  }
  const pairCount = state.routeCount * (state.routeCount - 1);
  const transferIndex = rawIndex - 1 - state.routeCount;
  return transferIndex < pairCount
    ? transferCandidate(state, transferIndex, 1n)
    : transferCandidate(state, transferIndex - pairCount, 2n);
}

function nextUniqueCandidate(state: MutableState): readonly bigint[] | undefined {
  while (state.rawCandidateIndex < state.rawCandidateLimit) {
    const rawIndex = state.rawCandidateIndex;
    state.rawCandidateIndex += 1;
    state.rawCandidatesVisited += 1;
    const candidate = rawCandidate(state, rawIndex);
    if (candidate === undefined) continue;
    const key = candidateKey(candidate);
    if (state.seen.has(key)) continue;
    state.seen.add(key);
    return candidate;
  }
  return undefined;
}

function finish(state: MutableState): BoundedExactSplitRepairFailure | undefined {
  const winner = state.provisionalWinner;
  state.provisionalWinner = undefined;
  if (winner === undefined) {
    const failure: BoundedExactSplitRepairFailure = Object.freeze({
      code: 'repair-no-valid-neighbor',
      attemptedNeighbors: state.attemptedNeighbors,
      rejectedNeighbors: state.rejectedNeighbors,
    });
    state.failure = failure;
    state.phase = 'failed';
    return failure;
  }
  state.winner = winner;
  state.phase = 'complete';
  return undefined;
}

/** @internal */
export function createBoundedExactSplitRepairState(
  sourceReconstruction: BoundedExactSplitRepairReconstruction,
): BoundedExactSplitRepairState {
  const reconstruction = captureReconstruction(sourceReconstruction);
  if (reconstruction === undefined) {
    throw new TypeError('Bounded exact split repair reconstruction is invalid.');
  }
  const routeCount = reconstruction.integerWeights.length;
  const rawCandidateLimit = 1 + routeCount + 2 * routeCount * (routeCount - 1);
  const seen = new Set<string>([candidateKey(reconstruction.anchor)]);
  const handle = Object.freeze({}) as BoundedExactSplitRepairState;
  states.set(handle, {
    reconstruction,
    routeCount,
    rawCandidateLimit,
    seen,
    phase: 'option',
    rawCandidateIndex: 1,
    rawCandidatesVisited: 1,
    attemptedNeighbors: 0,
    settledNeighbors: 0,
    rejectedNeighbors: 0,
    nextAllocations: reconstruction.anchor,
    pendingOption: undefined,
    provisionalWinner: undefined,
    winner: undefined,
    failure: undefined,
  });
  return handle;
}

/** @internal */
export function boundedExactSplitRepairProgress(
  handle: BoundedExactSplitRepairState,
): BoundedExactSplitRepairProgress {
  const state = stateOf(handle);
  return Object.freeze({
    phase: state.phase,
    routeCount: state.routeCount,
    rawCandidateLimit: state.rawCandidateLimit,
    rawCandidatesVisited: state.rawCandidatesVisited,
    attemptedNeighbors: state.attemptedNeighbors,
    settledNeighbors: state.settledNeighbors,
    rejectedNeighbors: state.rejectedNeighbors,
    optionPending: state.pendingOption !== undefined,
  });
}

/** @internal */
export function boundedExactSplitRepairOption(
  handle: BoundedExactSplitRepairState,
): BoundedExactSplitRepairOption {
  const state = stateOf(handle);
  if (state.phase !== 'option' || state.pendingOption !== undefined) {
    throw new TypeError('No new bounded exact split repair option is available.');
  }
  const allocations = state.nextAllocations;
  if (allocations === undefined) {
    throw new Error('Bounded exact split repair cursor is incomplete.');
  }
  state.nextAllocations = undefined;
  const option: BoundedExactSplitRepairOption = Object.freeze({
    neighborIndex: state.attemptedNeighbors,
    allocations,
  });
  state.attemptedNeighbors += 1;
  state.pendingOption = option;
  return Object.freeze({
    neighborIndex: option.neighborIndex,
    allocations: Object.freeze([...option.allocations]),
  });
}

/** @internal */
export function settleBoundedExactSplitRepairOption(
  handle: BoundedExactSplitRepairState,
  outcome: BoundedExactSplitRepairOutcome,
): BoundedExactSplitRepairStepResult {
  const state = stateOf(handle);
  if (
    state.phase !== 'option' ||
    state.pendingOption === undefined ||
    (outcome !== 'rejected' &&
      outcome !== 'valid-not-best' &&
      outcome !== 'valid-best') ||
    (outcome === 'valid-not-best' && state.provisionalWinner === undefined)
  ) {
    throw new TypeError('Bounded exact split repair outcome is invalid.');
  }
  const option = state.pendingOption;
  state.pendingOption = undefined;
  state.settledNeighbors += 1;
  if (outcome === 'rejected') {
    state.rejectedNeighbors += 1;
  } else if (outcome === 'valid-best') {
    state.provisionalWinner = Object.freeze({
      neighborIndex: option.neighborIndex,
      allocations: option.allocations,
    });
  }
  const nextAllocations = nextUniqueCandidate(state);
  if (nextAllocations !== undefined) {
    state.nextAllocations = nextAllocations;
    return Object.freeze({ ok: true, phase: 'option' });
  }
  const failure = finish(state);
  return failure === undefined
    ? Object.freeze({ ok: true, phase: 'complete' })
    : Object.freeze({ ok: false, error: failure });
}

/** @internal */
export function boundedExactSplitRepairWinner(
  handle: BoundedExactSplitRepairState,
): BoundedExactSplitRepairWinner | undefined {
  const state = stateOf(handle);
  const winner = state.phase === 'complete' ? state.winner : undefined;
  return winner === undefined
    ? undefined
    : Object.freeze({
        neighborIndex: winner.neighborIndex,
        allocations: Object.freeze([...winner.allocations]),
      });
}

/** @internal */
export function boundedExactSplitRepairFailure(
  handle: BoundedExactSplitRepairState,
): BoundedExactSplitRepairFailure | undefined {
  return stateOf(handle).failure;
}
