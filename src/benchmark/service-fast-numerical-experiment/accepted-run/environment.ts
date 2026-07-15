import { availableParallelism, cpus, endianness, release, totalmem, type } from 'node:os';
import { isMainThread } from 'node:worker_threads';

interface AcceptedEnvironmentValue {
  readonly [key: string]: null | boolean | number | string | readonly string[];
}

export class AcceptedEnvironmentAdmissionError extends Error {
  readonly code = 'environment-admission-failure';
  readonly toolFailureFamily = 'environment';
}

function environmentFailure(): never {
  throw new AcceptedEnvironmentAdmissionError('Accepted runtime environment is not admitted.');
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Capture and admit the frozen host exactly once before any candidate call. @internal */
export function captureAcceptedEnvironment(): AcceptedEnvironmentValue {
  const cpuValues = cpus();
  const firstCpu = cpuValues[0];
  const nodeOptions = process.env['NODE_OPTIONS'];
  const runtimeVersions = process.versions;
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const totalMemory = totalmem();
  const cpuSpeed = firstCpu?.speed;
  const environment: AcceptedEnvironmentValue = {
    nodeVersion: process.version,
    v8Version: runtimeVersions.v8,
    uvVersion: runtimeVersions.uv,
    platform: process.platform,
    arch: process.arch,
    'endianness': endianness(),
    osType: type(),
    osRelease: release(),
    cpuModel: firstCpu?.model ?? '',
    cpuSpeedMHz: cpuSpeed ?? -1,
    logicalCpuCount: cpuValues.length,
    'availableParallelism': availableParallelism(),
    totalMemoryBytes: String(totalMemory),
    timezone,
    execArgv: process.execArgv,
    nodeOptionsState: nodeOptions === undefined ? 'unset' : 'empty',
    mainThread: isMainThread,
  };
  if (
    environment['nodeVersion'] !== 'v24.18.0' ||
    environment['v8Version'] !== '13.6.233.17-node.50' ||
    environment['uvVersion'] !== '1.52.1' ||
    environment['platform'] !== 'linux' ||
    environment['arch'] !== 'x64' ||
    environment['endianness'] !== 'LE' ||
    environment['osType'] !== 'Linux' ||
    environment['osRelease'] !== '6.18.33.2-microsoft-standard-WSL2' ||
    environment['cpuModel'] !== '13th Gen Intel(R) Core(TM) i9-13900H' ||
    environment['logicalCpuCount'] !== 20 ||
    environment['availableParallelism'] !== 20 ||
    !Number.isSafeInteger(cpuSpeed) || (cpuSpeed as number) < 0 ||
    !Number.isSafeInteger(totalMemory) || totalMemory <= 0 ||
    String(totalMemory).length > 16 ||
    typeof timezone !== 'string' || timezone.length === 0 || utf8Bytes(timezone) > 128 ||
    !Array.isArray(environment['execArgv']) || environment['execArgv'].length !== 0 ||
    nodeOptions !== undefined && nodeOptions !== '' ||
    environment['mainThread'] !== true
  ) environmentFailure();
  return Object.freeze({ ...environment, execArgv: Object.freeze([]) });
}
