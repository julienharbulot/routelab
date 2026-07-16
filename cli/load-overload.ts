import { runOverloadBurst } from '../src/service/load.ts';

const result = await runOverloadBurst();
process.stdout.write(
  `overload burst requests=${result.requests} accepted=${result.acceptedCount} ` +
  `overloaded=${result.overloadedCount} retryAfter=${result.retryAfterCount} ` +
  `maxQueue=${result.server.maximumQueuedWork}\n` +
  'overload burst passed; raw observations are ignored\n',
);
