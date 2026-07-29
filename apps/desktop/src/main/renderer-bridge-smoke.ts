import type {
  GameSnapshot,
  WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import type { WebContents } from "electron";
import type { WindowManager } from "./window-manager";

type RendererKind = "desktop" | "management";

export interface RendererBridgeSmokeResult {
  readonly renderer: RendererKind;
  readonly workspace: WorkspaceBridgeInfo;
  readonly snapshot: GameSnapshot;
}

const BRIDGE_GLOBALS: Readonly<Record<RendererKind, string>> = {
  desktop: "airshipDesktop",
  management: "airshipManagement",
};

const BRIDGE_TIMEOUT_MS = 5_000;
const RETRY_INTERVAL_MS = 50;

export async function verifyRendererBridges(
  windowManager: WindowManager,
): Promise<readonly RendererBridgeSmokeResult[]> {
  const renderers = windowManager.getRendererWebContents();

  if (renderers.length !== 2) {
    throw new Error(
      `Expected two renderer windows, received ${renderers.length}.`,
    );
  }

  return Promise.all(
    renderers.map(async (webContents) => {
      const renderer = windowManager.getWindowKindForWebContents(
        webContents.id,
      );

      if (renderer === null) {
        throw new Error(
          `Unable to identify renderer for WebContents ${webContents.id}.`,
        );
      }

      return waitForBridge(webContents, renderer);
    }),
  );
}

async function waitForBridge(
  webContents: WebContents,
  renderer: RendererKind,
): Promise<RendererBridgeSmokeResult> {
  const bridgeGlobal = BRIDGE_GLOBALS[renderer];
  const deadline = Date.now() + BRIDGE_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const result: unknown = await webContents.executeJavaScript(
        createBridgeProbeScript(bridgeGlobal),
        true,
      );
      const smokeResult = parseSmokeResult(result, renderer);

      if (smokeResult !== null) {
        return smokeResult;
      }
    } catch (error: unknown) {
      lastError = error;
    }

    await delay(RETRY_INTERVAL_MS);
  }

  const details =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `${renderer} preload bridge was unavailable after ` +
      `${BRIDGE_TIMEOUT_MS}ms.${details}`,
  );
}

function createBridgeProbeScript(bridgeGlobal: string): string {
  return `
    (async () => {
      const bridge = globalThis[${JSON.stringify(bridgeGlobal)}];
      if (
        typeof bridge !== "object" ||
        bridge === null ||
        typeof bridge.getWorkspaceInfo !== "function" ||
        typeof bridge.getSnapshot !== "function"
      ) {
        return null;
      }

      return {
        workspace: bridge.getWorkspaceInfo(),
        snapshot: await bridge.getSnapshot(),
      };
    })()
  `;
}

function parseSmokeResult(
  value: unknown,
  renderer: RendererKind,
): RendererBridgeSmokeResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const workspace = value.workspace;
  const snapshot = value.snapshot;

  if (
    !isRecord(workspace) ||
    workspace.channel !== renderer ||
    typeof workspace.version !== "string" ||
    !isRecord(snapshot) ||
    snapshot.phase !== "ready" ||
    typeof snapshot.revision !== "number"
  ) {
    return null;
  }

  return {
    renderer,
    workspace: workspace as unknown as WorkspaceBridgeInfo,
    snapshot: snapshot as unknown as GameSnapshot,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
