export interface LaunchOptions {
  readonly showManagement: boolean;
  readonly smokeTest: boolean;
}

export function parseLaunchOptions(argv: readonly string[]): LaunchOptions {
  const argumentsSet = new Set(argv);

  return {
    showManagement:
      argumentsSet.has("--show-management") ||
      argumentsSet.has("--smoke-test"),
    smokeTest: argumentsSet.has("--smoke-test"),
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
