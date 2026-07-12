export const walkingSkeletonStatus = {
  project: 'RouteLab TS',
  stage: 'exact-pool-kernel',
  mode: 'offline-deterministic',
  financialQuoting: 'exact-constant-product',
} as const;

export function renderWalkingSkeletonStatus(): string {
  return JSON.stringify(walkingSkeletonStatus, undefined, 2);
}
