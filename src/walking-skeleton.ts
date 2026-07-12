export const walkingSkeletonStatus = {
  project: 'RouteLab TS',
  stage: 'repository-contract',
  mode: 'offline-deterministic',
  financialQuoting: 'deferred',
} as const;

export function renderWalkingSkeletonStatus(): string {
  return JSON.stringify(walkingSkeletonStatus, undefined, 2);
}
