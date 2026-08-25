import type {
  DesktopWorldReadModel,
  OperationsReadModel,
  SaveDiagnosticsSnapshot,
  WorkspaceBridgeInfo,
} from "@airship-restaurant/contracts";
import type { WebContents } from "electron";
import type { WindowManager } from "./window-manager";

type RendererKind = "desktop" | "management";

export interface RendererBridgeSmokeResult {
  readonly renderer: RendererKind;
  readonly workspace: WorkspaceBridgeInfo;
  readonly desktopWorld: DesktopWorldReadModel;
  readonly operations: OperationsReadModel;
  readonly saveDiagnostics: SaveDiagnosticsSnapshot | null;
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
        createBridgeProbeScript(bridgeGlobal, renderer),
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

function createBridgeProbeScript(
  bridgeGlobal: string,
  renderer: RendererKind,
): string {
  return `
    (async () => {
      const bridge = globalThis[${JSON.stringify(bridgeGlobal)}];
      if (
        typeof bridge !== "object" ||
        bridge === null ||
        typeof bridge.getWorkspaceInfo !== "function" ||
        typeof bridge.getReadModel !== "function"
      ) {
        return null;
      }

      const saveDiagnostics =
        typeof bridge.getSaveDiagnostics === "function"
          ? await bridge.getSaveDiagnostics()
          : null;

      if (${JSON.stringify(renderer)} === "management") {
        const navigate = async (section) => {
          const button = document.querySelector(
            '[data-management-section="' + section + '"]',
          );
          if (!(button instanceof HTMLButtonElement) || button.disabled) {
            throw new Error("Management " + section + " entry is unavailable.");
          }
          button.click();
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        };

        await navigate("technology");
        const dialog = document.querySelector(
          '.technology-tree-dialog[role="dialog"]',
        );
        if (!(dialog instanceof HTMLElement)) {
          throw new Error("Management technology tree did not open.");
        }
        await navigate("overview");
        await navigate("technology");
        const reopenedDialog = document.querySelector(
          '.technology-tree-dialog[role="dialog"]',
        );
        if (!(reopenedDialog instanceof HTMLElement)) {
          throw new Error("Management technology tree did not reopen.");
        }

        await navigate("procurement");
        const procurementDialog = document.querySelector(
          '.procurement-dialog[role="dialog"]',
        );
        if (!(procurementDialog instanceof HTMLElement)) {
          throw new Error("Management procurement page did not open.");
        }
        const procurementSlice = await bridge.getReadModel("procurement");
        if (procurementSlice?.value?.authority !== "module.procurement") {
          throw new Error("Management procurement still reads the legacy M2 authority.");
        }
        if (!procurementDialog.textContent?.includes("本地小车与采购飞艇") ||
            !procurementDialog.textContent.includes("餐厅管理员")) {
          throw new Error("Management procurement did not render the unified transport and automation rules.");
        }
        const operationsSnapshot = (await bridge.getReadModel("operations"))?.value;
        if (operationsSnapshot === null || operationsSnapshot === undefined) {
          throw new Error("Management Operations read model was unavailable.");
        }
        await navigate("overview");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return {
        workspace: bridge.getWorkspaceInfo(),
        desktopWorld: (await bridge.getReadModel("desktop-world"))?.value,
        operations: (await bridge.getReadModel("operations"))?.value,
        saveDiagnostics,
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
  const desktopWorld = value.desktopWorld;
  const operations = value.operations;
  const saveDiagnostics = value.saveDiagnostics;

  if (
    !isRecord(workspace) ||
    workspace.channel !== renderer ||
    typeof workspace.version !== "string" ||
    !isRecord(desktopWorld) ||
    desktopWorld.phase !== "ready" ||
    typeof desktopWorld.sourceRevision !== "number" ||
    !isRecord(desktopWorld.gameplay) ||
    !isRecord(desktopWorld.gameplay.cooking) ||
    !isRecord(desktopWorld.gameplay.logistics) ||
    !isRecord(desktopWorld.gameplay.restaurant) ||
    !isRecord(operations)
  ) {
    return null;
  }

  if (
    renderer === "management" &&
    (!isRecord(saveDiagnostics) ||
      typeof saveDiagnostics.revision !== "number" ||
      typeof saveDiagnostics.status !== "string" ||
      !isRecord(operations.gameplay) ||
      saveDiagnostics.fileName !== "save.json" ||
      saveDiagnostics.backupFileName !== "save.json.bak")
  ) {
    return null;
  }
  if (renderer === "desktop" && saveDiagnostics !== null) {
    return null;
  }

  return {
    renderer,
    workspace: workspace as unknown as WorkspaceBridgeInfo,
    desktopWorld: desktopWorld as unknown as DesktopWorldReadModel,
    operations: operations as unknown as OperationsReadModel,
    saveDiagnostics:
      saveDiagnostics as SaveDiagnosticsSnapshot | null,
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
