/** Sole accepted-run operational clock leaf. @internal */
export function sampleAcceptedOperationalClock(): bigint {
  return process.hrtime.bigint();
}
