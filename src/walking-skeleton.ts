export const walkingSkeletonStatus = {
  project: 'RouteLab TS',
  stage: 'bounded-single-path-router',
  mode: 'offline-deterministic',
  financialQuoting: 'exact-constant-product',
  routeReplay: 'exact-explicit-simple-route',
  pathEnumeration: 'deterministic-bounded-simple-paths',
  singlePathRouting: 'exact-bounded',
} as const;

export function renderWalkingSkeletonStatus(): string {
  return JSON.stringify(walkingSkeletonStatus, undefined, 2);
}
