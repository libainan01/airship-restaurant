export interface ResidentStabilityLaunchOptions {
  readonly durationMs: number;
  readonly sampleIntervalMs: number;
}

export interface LaunchOptions {
  readonly showManagement: boolean;
  readonly smokeTest: boolean;
  readonly residentStability: ResidentStabilityLaunchOptions | null;
}

function readNumericArgument(
  argv: readonly string[],
  name: string,
  defaultValue: number,
): number {
  const prefix = `${name}=`;
  const argument = argv.find((value) => value.startsWith(prefix));
  if (argument === undefined) {
    return defaultValue;
  }
  const parsed = Number(argument.slice(prefix.length));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return parsed;
}

export function parseLaunchOptions(argv: readonly string[]): LaunchOptions {
  const argumentsSet = new Set(argv);
  const smokeTest = argumentsSet.has("--smoke-test");
  const stabilityTest = argumentsSet.has("--stability-test");
  if (smokeTest && stabilityTest) {
    throw new Error(
      "--smoke-test and --stability-test cannot run together.",
    );
  }
  const hasStabilityTuning = argv.some(
    (argument) =>
      argument.startsWith("--stability-duration-minutes=") ||
      argument.startsWith("--stability-sample-seconds="),
  );
  if (!stabilityTest && hasStabilityTuning) {
    throw new Error(
      "Stability duration and sample options require --stability-test.",
    );
  }

  let residentStability: ResidentStabilityLaunchOptions | null = null;
  if (stabilityTest) {
    const durationMinutes = readNumericArgument(
      argv,
      "--stability-duration-minutes",
      120,
    );
    const sampleSeconds = readNumericArgument(
      argv,
      "--stability-sample-seconds",
      60,
    );
    if (durationMinutes < 0.05 || durationMinutes > 1_440) {
      throw new Error(
        "--stability-duration-minutes must be between 0.05 and 1440.",
      );
    }
    if (sampleSeconds < 1 || sampleSeconds > 300) {
      throw new Error(
        "--stability-sample-seconds must be between 1 and 300.",
      );
    }
    residentStability = Object.freeze({
      durationMs: Math.round(durationMinutes * 60_000),
      sampleIntervalMs: Math.round(sampleSeconds * 1_000),
    });
  }

  return {
    showManagement:
      argumentsSet.has("--show-management") ||
      smokeTest ||
      stabilityTest,
    smokeTest,
    residentStability,
  };
}

export function getRendererBaseUrl(
  environment: NodeJS.ProcessEnv,
): string | null {
  const configuredUrl = environment.AIRSHIP_RENDERER_URL?.trim();

  if (configuredUrl === undefined || configuredUrl.length === 0) {
    return null;
  }

  const parsedUrl = new URL(configuredUrl);

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      "AIRSHIP_RENDERER_URL must use the http or https protocol.",
    );
  }

  return parsedUrl.toString();
}
