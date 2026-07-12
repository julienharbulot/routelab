export const walkingSkeletonStatus = {
  project: 'RouteLab TS',
  stage: 'exact-replay-kernel',
  mode: 'offline-deterministic',
  financialQuoting: 'exact-constant-product',
  routeReplay: 'exact-explicit-simple-route',
} as const;

export function renderWalkingSkeletonStatus(): string {
  return JSON.stringify(walkingSkeletonStatus, undefined, 2);
}
