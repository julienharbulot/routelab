export const walkingSkeletonStatus = {
  project: 'RouteLab TS',
  stage: 'bounded-path-enumeration',
  mode: 'offline-deterministic',
  financialQuoting: 'exact-constant-product',
  routeReplay: 'exact-explicit-simple-route',
  pathEnumeration: 'deterministic-bounded-simple-paths',
} as const;

export function renderWalkingSkeletonStatus(): string {
  return JSON.stringify(walkingSkeletonStatus, undefined, 2);
}
