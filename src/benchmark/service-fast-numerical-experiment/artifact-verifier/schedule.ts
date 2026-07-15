import {
  SERVICE_FAST_DEADLINES_MS,
  SERVICE_FAST_OPERATIONAL_CASE_IDS,
  SERVICE_FAST_POLICY_IDS,
} from './contract.ts';
import type { OperationalSemanticCell } from './semantic-regeneration.ts';

export interface CompleteScheduleItem {
  readonly observationIndex: number;
  readonly cell: OperationalSemanticCell;
  readonly sweepIndex: number;
  readonly policyMatrixIndex: number;
}

export interface DeadlineScheduleItem extends CompleteScheduleItem {
  readonly deadlineIndex: number;
  readonly deadlineMilliseconds: number;
}

function caseCells(
  cells: ReadonlyMap<number, OperationalSemanticCell>,
  caseId: string,
): readonly OperationalSemanticCell[] {
  return Object.freeze([...cells.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value)
    .filter((value) => value.input.caseId === caseId));
}

function traversal<T>(values: readonly T[], reverse: boolean): readonly T[] {
  return reverse ? Object.freeze([...values].reverse()) : values;
}

function policyOrder(offset: number, reverse: boolean): readonly number[] {
  const count = SERVICE_FAST_POLICY_IDS.length;
  const rotated = Array.from({ length: count }, (_, index) =>
    (index + offset) % count);
  return Object.freeze(reverse ? rotated.reverse() : rotated);
}

function completeSchedule(
  cells: ReadonlyMap<number, OperationalSemanticCell>,
  sweepCount: number,
): readonly CompleteScheduleItem[] {
  const schedule: CompleteScheduleItem[] = [];
  for (const caseId of SERVICE_FAST_OPERATIONAL_CASE_IDS) {
    const values = caseCells(cells, caseId);
    if (values.length === 0) throw new TypeError('Operational case is empty.');
    for (let sweepIndex = 0; sweepIndex < sweepCount; sweepIndex += 1) {
      const reverse = sweepIndex % 2 === 1;
      for (const cell of traversal(values, reverse)) {
        const requestIndex = cell.input.timingCohortIndex;
        if (requestIndex === null) throw new TypeError('Timing cohort index is absent.');
        for (const policyMatrixIndex of policyOrder(
          (requestIndex + sweepIndex) % SERVICE_FAST_POLICY_IDS.length,
          reverse,
        )) {
          schedule.push(Object.freeze({
            observationIndex: schedule.length,
            cell,
            sweepIndex,
            policyMatrixIndex,
          }));
        }
      }
    }
  }
  return Object.freeze(schedule);
}

export function callOnlySchedule(
  cells: ReadonlyMap<number, OperationalSemanticCell>,
): readonly CompleteScheduleItem[] {
  const result = completeSchedule(cells, 5);
  if (result.length !== 30_240) throw new TypeError('Call schedule count is invalid.');
  return result;
}

export function timelineSchedule(
  cells: ReadonlyMap<number, OperationalSemanticCell>,
): readonly CompleteScheduleItem[] {
  const result = completeSchedule(cells, 3);
  if (result.length !== 18_144) throw new TypeError('Timeline schedule count is invalid.');
  return result;
}

export function deadlineSchedule(
  cells: ReadonlyMap<number, OperationalSemanticCell>,
): readonly DeadlineScheduleItem[] {
  const schedule: DeadlineScheduleItem[] = [];
  for (const caseId of SERVICE_FAST_OPERATIONAL_CASE_IDS) {
    const values = caseCells(cells, caseId);
    if (values.length === 0) throw new TypeError('Deadline case is empty.');
    for (let deadlineIndex = 0;
      deadlineIndex < SERVICE_FAST_DEADLINES_MS.length;
      deadlineIndex += 1) {
      const deadlineMilliseconds = SERVICE_FAST_DEADLINES_MS[deadlineIndex];
      if (deadlineMilliseconds === undefined) {
        throw new TypeError('Deadline is absent.');
      }
      for (let sweepIndex = 0; sweepIndex < 3; sweepIndex += 1) {
        const reverse = sweepIndex % 2 === 1;
        for (const cell of traversal(values, reverse)) {
          const requestIndex = cell.input.timingCohortIndex;
          if (requestIndex === null) throw new TypeError('Timing cohort index is absent.');
          const offset = (requestIndex + deadlineIndex + sweepIndex) %
            SERVICE_FAST_POLICY_IDS.length;
          for (const policyMatrixIndex of policyOrder(offset, reverse)) {
            schedule.push(Object.freeze({
              observationIndex: schedule.length,
              cell,
              sweepIndex,
              policyMatrixIndex,
              deadlineIndex,
              deadlineMilliseconds,
            }));
          }
        }
      }
    }
  }
  if (schedule.length !== 108_864) {
    throw new TypeError('Deadline schedule count is invalid.');
  }
  return Object.freeze(schedule);
}
