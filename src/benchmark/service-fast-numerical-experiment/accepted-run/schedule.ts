import {
  ACCEPTED_DEADLINES_MS,
  ACCEPTED_EXECUTION_SCHEDULE,
  ACCEPTED_OPERATIONAL_CASE_IDS,
  ACCEPTED_POLICY_IDS,
  type AcceptedInputRecord,
} from './contract.ts';

export type AcceptedSchedulePhase =
  | 'semantic'
  | 'call-warmup'
  | 'call-retained'
  | 'timeline-retained'
  | 'deadline-warmup'
  | 'deadline-retained';

export interface AcceptedScheduleItem {
  readonly phase: AcceptedSchedulePhase;
  readonly cell: AcceptedInputRecord;
  readonly policyMatrixIndex: number;
  readonly observationIndex: number | null;
  readonly sweepIndex: number;
  readonly deadlineIndex: number | null;
  readonly deadlineMilliseconds: number | null;
}

function rotatedPolicyOrder(offset: number, reverse: boolean): readonly number[] {
  const count = ACCEPTED_POLICY_IDS.length;
  const values = Array.from({ length: count }, (_, index) => (index + offset) % count);
  return reverse ? values.reverse() : values;
}

function operationalCells(
  records: readonly AcceptedInputRecord[],
  caseId: string,
): readonly AcceptedInputRecord[] {
  const result = records.filter((record) =>
    record.caseId === caseId && record.timingCohortIndex !== null);
  if (result.length === 0) throw new TypeError('Accepted operational case is empty.');
  return result;
}

function traversal<T>(values: readonly T[], reverse: boolean): readonly T[] {
  return reverse ? [...values].reverse() : values;
}

function requestIndex(record: AcceptedInputRecord): number {
  if (record.timingCohortIndex === null) {
    throw new TypeError('Accepted timing cohort index is absent.');
  }
  return record.timingCohortIndex;
}

export function* acceptedSemanticSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  let count = 0;
  for (const cell of records) {
    for (let policyMatrixIndex = 0;
      policyMatrixIndex < ACCEPTED_POLICY_IDS.length;
      policyMatrixIndex += 1) {
      yield Object.freeze({
        phase: 'semantic',
        cell,
        policyMatrixIndex,
        observationIndex: count,
        sweepIndex: 0,
        deadlineIndex: null,
        deadlineMilliseconds: null,
      });
      count += 1;
    }
  }
  if (count !== ACCEPTED_EXECUTION_SCHEDULE.semanticCalls) {
    throw new TypeError('Accepted semantic schedule count is invalid.');
  }
}

function* completePhase(
  records: readonly AcceptedInputRecord[],
  phase: 'call-retained' | 'timeline-retained',
  sweepCount: number,
): Generator<AcceptedScheduleItem> {
  let observationIndex = 0;
  for (const caseId of ACCEPTED_OPERATIONAL_CASE_IDS) {
    const cells = operationalCells(records, caseId);
    for (let sweepIndex = 0; sweepIndex < sweepCount; sweepIndex += 1) {
      const reverse = sweepIndex % 2 === 1;
      for (const cell of traversal(cells, reverse)) {
        for (const policyMatrixIndex of rotatedPolicyOrder(
          (requestIndex(cell) + sweepIndex) % ACCEPTED_POLICY_IDS.length,
          reverse,
        )) {
          yield Object.freeze({
            phase,
            cell,
            policyMatrixIndex,
            observationIndex,
            sweepIndex,
            deadlineIndex: null,
            deadlineMilliseconds: null,
          });
          observationIndex += 1;
        }
      }
    }
  }
  const expected = phase === 'call-retained'
    ? ACCEPTED_EXECUTION_SCHEDULE.callRetained
    : ACCEPTED_EXECUTION_SCHEDULE.timelineRetained;
  if (observationIndex !== expected) {
    throw new TypeError('Accepted retained complete schedule count is invalid.');
  }
}

export function* acceptedCallWarmupSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  let count = 0;
  for (const caseId of ACCEPTED_OPERATIONAL_CASE_IDS) {
    for (const cell of operationalCells(records, caseId)) {
      for (const policyMatrixIndex of rotatedPolicyOrder(
        requestIndex(cell) % ACCEPTED_POLICY_IDS.length,
        false,
      )) {
        yield Object.freeze({
          phase: 'call-warmup',
          cell,
          policyMatrixIndex,
          observationIndex: null,
          sweepIndex: 0,
          deadlineIndex: null,
          deadlineMilliseconds: null,
        });
        count += 1;
      }
    }
  }
  if (count !== ACCEPTED_EXECUTION_SCHEDULE.callWarmups) {
    throw new TypeError('Accepted call warmup schedule count is invalid.');
  }
}

export function acceptedCallSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  return completePhase(records, 'call-retained', 5);
}

/** Frozen per-case warmup-then-retained call protocol order. @internal */
export function* acceptedCallProtocolSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  let warmups = 0;
  let observationIndex = 0;
  for (const caseId of ACCEPTED_OPERATIONAL_CASE_IDS) {
    const cells = operationalCells(records, caseId);
    for (const cell of cells) {
      for (const policyMatrixIndex of rotatedPolicyOrder(
        requestIndex(cell) % ACCEPTED_POLICY_IDS.length,
        false,
      )) {
        yield Object.freeze({
          phase: 'call-warmup',
          cell,
          policyMatrixIndex,
          observationIndex: null,
          sweepIndex: 0,
          deadlineIndex: null,
          deadlineMilliseconds: null,
        });
        warmups += 1;
      }
    }
    for (let sweepIndex = 0; sweepIndex < 5; sweepIndex += 1) {
      const reverse = sweepIndex % 2 === 1;
      for (const cell of traversal(cells, reverse)) {
        for (const policyMatrixIndex of rotatedPolicyOrder(
          (requestIndex(cell) + sweepIndex) % ACCEPTED_POLICY_IDS.length,
          reverse,
        )) {
          yield Object.freeze({
            phase: 'call-retained',
            cell,
            policyMatrixIndex,
            observationIndex,
            sweepIndex,
            deadlineIndex: null,
            deadlineMilliseconds: null,
          });
          observationIndex += 1;
        }
      }
    }
  }
  if (
    warmups !== ACCEPTED_EXECUTION_SCHEDULE.callWarmups ||
    observationIndex !== ACCEPTED_EXECUTION_SCHEDULE.callRetained
  ) throw new TypeError('Accepted call protocol schedule count is invalid.');
}

export function acceptedTimelineSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  return completePhase(records, 'timeline-retained', 3);
}

function* deadlinePhase(
  records: readonly AcceptedInputRecord[],
  retained: boolean,
): Generator<AcceptedScheduleItem> {
  let observationIndex = 0;
  let callCount = 0;
  for (const caseId of ACCEPTED_OPERATIONAL_CASE_IDS) {
    const cells = operationalCells(records, caseId);
    for (let deadlineIndex = 0;
      deadlineIndex < ACCEPTED_DEADLINES_MS.length;
      deadlineIndex += 1) {
      const deadlineMilliseconds = ACCEPTED_DEADLINES_MS[deadlineIndex];
      if (deadlineMilliseconds === undefined) throw new TypeError('Accepted deadline is absent.');
      const sweepCount = retained ? 3 : 1;
      for (let sweepIndex = 0; sweepIndex < sweepCount; sweepIndex += 1) {
        const reverse = retained && sweepIndex % 2 === 1;
        for (const cell of traversal(cells, reverse)) {
          for (const policyMatrixIndex of rotatedPolicyOrder(
            (requestIndex(cell) + deadlineIndex + sweepIndex) % ACCEPTED_POLICY_IDS.length,
            reverse,
          )) {
            yield Object.freeze({
              phase: retained ? 'deadline-retained' : 'deadline-warmup',
              cell,
              policyMatrixIndex,
              observationIndex: retained ? observationIndex : null,
              sweepIndex,
              deadlineIndex,
              deadlineMilliseconds,
            });
            callCount += 1;
            if (retained) observationIndex += 1;
          }
        }
      }
    }
  }
  const expected = retained
    ? ACCEPTED_EXECUTION_SCHEDULE.deadlineRetained
    : ACCEPTED_EXECUTION_SCHEDULE.deadlineWarmups;
  if (callCount !== expected) {
    throw new TypeError('Accepted deadline schedule count is invalid.');
  }
}

export function acceptedDeadlineWarmupSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  return deadlinePhase(records, false);
}

export function acceptedDeadlineSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  return deadlinePhase(records, true);
}

/** Frozen per-case/deadline warmup-then-retained deadline protocol order. @internal */
export function* acceptedDeadlineProtocolSchedule(
  records: readonly AcceptedInputRecord[],
): Generator<AcceptedScheduleItem> {
  let warmups = 0;
  let observationIndex = 0;
  for (const caseId of ACCEPTED_OPERATIONAL_CASE_IDS) {
    const cells = operationalCells(records, caseId);
    for (let deadlineIndex = 0;
      deadlineIndex < ACCEPTED_DEADLINES_MS.length;
      deadlineIndex += 1) {
      const deadlineMilliseconds = ACCEPTED_DEADLINES_MS[deadlineIndex];
      if (deadlineMilliseconds === undefined) throw new TypeError('Accepted deadline is absent.');
      for (const cell of cells) {
        for (const policyMatrixIndex of rotatedPolicyOrder(
          (requestIndex(cell) + deadlineIndex) % ACCEPTED_POLICY_IDS.length,
          false,
        )) {
          yield Object.freeze({
            phase: 'deadline-warmup',
            cell,
            policyMatrixIndex,
            observationIndex: null,
            sweepIndex: 0,
            deadlineIndex,
            deadlineMilliseconds,
          });
          warmups += 1;
        }
      }
      for (let sweepIndex = 0; sweepIndex < 3; sweepIndex += 1) {
        const reverse = sweepIndex % 2 === 1;
        for (const cell of traversal(cells, reverse)) {
          for (const policyMatrixIndex of rotatedPolicyOrder(
            (requestIndex(cell) + deadlineIndex + sweepIndex) % ACCEPTED_POLICY_IDS.length,
            reverse,
          )) {
            yield Object.freeze({
              phase: 'deadline-retained',
              cell,
              policyMatrixIndex,
              observationIndex,
              sweepIndex,
              deadlineIndex,
              deadlineMilliseconds,
            });
            observationIndex += 1;
          }
        }
      }
    }
  }
  if (
    warmups !== ACCEPTED_EXECUTION_SCHEDULE.deadlineWarmups ||
    observationIndex !== ACCEPTED_EXECUTION_SCHEDULE.deadlineRetained
  ) throw new TypeError('Accepted deadline protocol schedule count is invalid.');
}
