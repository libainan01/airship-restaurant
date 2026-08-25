import type {
  AppSettingsSnapshot,
  DisplayOption,
  RuntimeReadModelKey,
  RuntimeReadModelSlice,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import { describe, expect, it, vi } from "vitest";
import { hydrateManagementRuntime } from "../src/renderer/management/runtime/management-runtime-hydration";

const slices = {
  inventory: { key: "inventory", revision: 1, value: {} },
  "instance-upgrades": { key: "instance-upgrades", revision: 2, value: {} },
  recruitment: { key: "recruitment", revision: 3, value: {} },
  progression: { key: "progression", revision: 4, value: {} },
  operations: { key: "operations", revision: 5, value: {} },
  procurement: { key: "procurement", revision: 6, value: {} },
  finance: { key: "finance", revision: 7, value: {} },
} as unknown as Record<
  "inventory" | "instance-upgrades" | "recruitment" | "progression" | "operations" | "procurement" | "finance",
  RuntimeReadModelSlice
>;

describe("hydrateManagementRuntime", () => {
  it("restores all management slices while keeping successful resources when one independent read fails", async () => {
    const settings = { revision: 2 } as AppSettingsSnapshot;
    const diagnostics = { revision: 3 } as SaveDiagnosticsSnapshot;
    const displayError = new Error("display service unavailable");
    const handlers = {
      onSettings: vi.fn(),
      onDisplays: vi.fn(),
      onReadModel: vi.fn(),
      onSaveDiagnostics: vi.fn(),
      onError: vi.fn(),
    };

    await hydrateManagementRuntime({
      getSettings: async () => settings,
      listDisplays: async (): Promise<readonly DisplayOption[]> => {
        throw displayError;
      },
      getReadModel: async (key: RuntimeReadModelKey) => {
        if (key in slices) {
          return slices[key as keyof typeof slices];
        }
        throw new Error("unexpected slice");
      },
      getSaveDiagnostics: async () => diagnostics,
    }, handlers);

    expect(handlers.onSettings).toHaveBeenCalledWith(settings);
    expect(handlers.onReadModel.mock.calls.map(([slice]) => slice)).toEqual([
      slices.inventory,
      slices["instance-upgrades"],
      slices.recruitment,
      slices.progression,
      slices.operations,
      slices.procurement,
      slices.finance,
    ]);
    expect(handlers.onSaveDiagnostics).toHaveBeenCalledWith(diagnostics);
    expect(handlers.onDisplays).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(
      "displays",
      displayError,
    );
  });

  it("reports a failed slice without discarding the other restored slices", async () => {
    const procurementError = new Error("procurement unavailable");
    const handlers = {
      onSettings: vi.fn(),
      onDisplays: vi.fn(),
      onReadModel: vi.fn(),
      onSaveDiagnostics: vi.fn(),
      onError: vi.fn(),
    };

    await hydrateManagementRuntime({
      getSettings: async () => ({ revision: 1 }) as AppSettingsSnapshot,
      listDisplays: async () => [],
      getReadModel: async (key: RuntimeReadModelKey) => {
        if (key === "procurement") throw procurementError;
        if (key in slices) {
          return slices[key as keyof typeof slices];
        }
        throw new Error("unexpected slice");
      },
      getSaveDiagnostics: async () =>
        ({ revision: 1 }) as SaveDiagnosticsSnapshot,
    }, handlers);

    expect(handlers.onReadModel).toHaveBeenCalledTimes(6);
    expect(handlers.onError).toHaveBeenCalledWith(
      "procurement",
      procurementError,
    );
  });
});