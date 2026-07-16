export const SERVICE_POLICY = Object.freeze({
  bodyBytes: 32 * 1_024,
  urlLength: 2_048,
  snapshotIdLength: 200,
  assetIdLength: 128,
  amountDigits: 78,
  maxHops: 3,
  maxRoutes: 3,
  maxDeadlineMs: 5_000,
  maxActiveWork: 1,
  maxQueuedWork: 32,
  overloadRetryAfterSeconds: 1,
  workerCount: 4,
});
