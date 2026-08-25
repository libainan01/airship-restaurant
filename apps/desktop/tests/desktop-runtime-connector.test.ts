import type {
  AppSettingsSnapshot,
  DesktopBridge,
  DesktopCursorPoint,
  RuntimeReadModelKey,
  RuntimeReadModelSlice,
} from "@airship-restaurant/contracts";
import { describe, expect, it, vi } from "vitest";
import { DesktopRuntimeConnector } from "../src/renderer/desktop/desktop-runtime-connector";

const SETTINGS = {
  revision: 1,
  presentationMode: "normal",
} as AppSettingsSnapshot;
const READ_MODELS = {
  layout: {
    key: "layout",
    revision: 0,
    value: { sourceRevision: 0, scenes: [], storedBuildings: [] },
  },
  inventory: {
    key: "inventory",
    revision: 0,
    value: {
      sourceRevision: 0,
      locations: [],
      totals: [],
      reservationCount: 0,
      capacityReservationCount: 0,
      dishware: null,
    },
  },
  characters: {
    key: "characters",
    revision: 0,
    value: {
      sourceRevision: 0,
      characters: [],
      personnelElevator: null,
    },
  },
  "desktop-world": {
    key: "desktop-world",
    revision: 1,
    value: {
      sourceRevision: 1,
      phase: "ready",
      gameplayRevision: null,
      gameplay: null,
      quietMode: false,
      procurement: null,
      seatCapacity: 3,
      restaurantActivity: { revision: 0, events: [] },
      foregroundDialogue: null,
      deliveryRevision: 0,
      guestFlowRevision: 0,
      showLayoutAnchors: false,
    },
  },
  operations: {
    key: "operations",
    revision: 1,
    value: {
      sourceRevision: 1,
      gameplay: null,
      restaurantActivity: { revision: 0, events: [] },
      narrative: null,
      dialogue: null,
      story: null,
      offlineEarnings: null,
    },
  },
  procurement: {
    key: "procurement",
    revision: 1,
    value: {
      sourceRevision: 1,
      currentUtcMs: null,
      selectedRecipeId: null,
      procurement: null,
    },
  },
  finance: {
    key: "finance",
    revision: 1,
    value: {
      sourceRevision: 1,
      balanceCopper: 0,
      reservedCopper: 0,
      availableCopper: 0,
      totalCopperSpent: 0,
      recentSales: [],
    },
  },
} as const satisfies Record<RuntimeReadModelKey, RuntimeReadModelSlice>;

function createBridge(options?: {
  readonly getReadModel?: (
    key: RuntimeReadModelKey,
  ) => Promise<RuntimeReadModelSlice>;
  readonly getSettings?: () => Promise<AppSettingsSnapshot>;
}) {
  const readModelListeners = new Map<
    RuntimeReadModelKey,
    (slice: RuntimeReadModelSlice) => void
  >();
  let settingsListener:
    ((settings: AppSettingsSnapshot) => void) | null = null;
  let cursorListener:
    ((point: DesktopCursorPoint) => void) | null = null;
  const unsubscribeSettings = vi.fn();
  const unsubscribeCursor = vi.fn();
  const bridge = {
    getSettings: vi.fn(
      options?.getSettings ?? (async () => SETTINGS),
    ),
    getReadModel: vi.fn(
      options?.getReadModel ??
        (async (key: RuntimeReadModelKey) => READ_MODELS[key]),
    ),
    onReadModelChanged: vi.fn((
      key: RuntimeReadModelKey,
      listener: (slice: RuntimeReadModelSlice) => void,
    ) => {
      readModelListeners.set(key, listener);
      return vi.fn(() => readModelListeners.delete(key));
    }),
    onSettingsChanged: vi.fn((listener) => {
      settingsListener = listener;
      return unsubscribeSettings;
    }),
    onCursorPosition: vi.fn((listener) => {
      cursorListener = listener;
      return unsubscribeCursor;
    }),
    setInteraction: vi.fn(async () => undefined),
    openManagement: vi.fn(async () => undefined),
  } as unknown as DesktopBridge;
  return {
    bridge,
    readModelListeners,
    unsubscribeSettings,
    unsubscribeCursor,
    emitReadModel: (slice: RuntimeReadModelSlice) =>
      readModelListeners.get(slice.key)?.(slice),
    emitSettings: (settings: AppSettingsSnapshot) =>
      settingsListener?.(settings),
    emitCursor: (point: DesktopCursorPoint) =>
      cursorListener?.(point),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("DesktopRuntimeConnector", () => {
  it("restores and subscribes through stable desktop slices without legacy snapshots", async () => {
    const fake = createBridge();
    const onReadModel = vi.fn();
    const onSettings = vi.fn();
    const onCursor = vi.fn();
    const connector = new DesktopRuntimeConnector({
      getBridge: () => fake.bridge,
      isActive: () => true,
      onSettings,
      onReadModel,
      onCursor,
      onConnectionStatus: vi.fn(),
      reportError: vi.fn(),
    });

    expect(connector.connect()).toBe(true);
    await flushPromises();

    expect(fake.bridge.getReadModel).toHaveBeenCalledTimes(4);
    expect(onReadModel).toHaveBeenCalledWith(READ_MODELS["desktop-world"]);
    expect(onSettings).toHaveBeenCalledWith(SETTINGS);

    const cursor = { x: 10, y: 20, inside: true };
    fake.emitCursor(cursor);
    fake.emitSettings({ ...SETTINGS, revision: 2 } as AppSettingsSnapshot);
    expect(onCursor).toHaveBeenCalledWith(cursor);
    expect(onSettings).toHaveBeenCalledTimes(2);

    connector.disconnect();
    expect(fake.readModelListeners.size).toBe(0);
    expect(fake.unsubscribeSettings).toHaveBeenCalledOnce();
    expect(fake.unsubscribeCursor).toHaveBeenCalledOnce();
  });

  it("does not let stale desktop-world hydration overwrite a newer broadcast", async () => {
    const hydration = createDeferred<RuntimeReadModelSlice>();
    const fake = createBridge({
      getReadModel: async (key) =>
        key === "desktop-world" ? hydration.promise : READ_MODELS[key],
    });
    const onReadModel = vi.fn();
    const connector = new DesktopRuntimeConnector({
      getBridge: () => fake.bridge,
      isActive: () => true,
      onSettings: vi.fn(),
      onReadModel,
      onCursor: vi.fn(),
      onConnectionStatus: vi.fn(),
      reportError: vi.fn(),
    });

    connector.connect();
    const newer = {
      ...READ_MODELS["desktop-world"],
      revision: 2,
      value: {
        ...READ_MODELS["desktop-world"].value,
        sourceRevision: 2,
      },
    } as const;
    fake.emitReadModel(newer);
    hydration.resolve(READ_MODELS["desktop-world"]);
    await flushPromises();

    const desktopCalls = onReadModel.mock.calls
      .map(([slice]) => slice as RuntimeReadModelSlice)
      .filter((slice) => slice.key === "desktop-world");
    expect(desktopCalls).toEqual([newer]);
  });

  it("centralizes interaction and management-window errors", async () => {
    const fake = createBridge();
    const reportError = vi.fn();
    const connector = new DesktopRuntimeConnector({
      getBridge: () => fake.bridge,
      isActive: () => true,
      onSettings: vi.fn(),
      onReadModel: vi.fn(),
      onCursor: vi.fn(),
      onConnectionStatus: vi.fn(),
      reportError,
    });
    connector.connect();

    connector.setInteraction({
      interactive: true,
      reason: "airship",
    });
    await expect(connector.openManagement("inventory")).resolves.toBe(true);
    expect(fake.bridge.setInteraction).toHaveBeenCalledWith({
      interactive: true,
      reason: "airship",
    });
    expect(fake.bridge.openManagement).toHaveBeenCalledWith({
      section: "inventory",
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports preview mode and desktop-world recovery failure", async () => {
    const previewStatus = vi.fn();
    const preview = new DesktopRuntimeConnector({
      getBridge: () => undefined,
      isActive: () => true,
      onSettings: vi.fn(),
      onReadModel: vi.fn(),
      onCursor: vi.fn(),
      onConnectionStatus: previewStatus,
      reportError: vi.fn(),
    });
    expect(preview.connect()).toBe(false);
    expect(previewStatus).toHaveBeenCalledWith("preview");

    const failure = new Error("desktop world unavailable");
    const fake = createBridge({
      getReadModel: async (key) => {
        if (key === "desktop-world") throw failure;
        return READ_MODELS[key];
      },
    });
    const reportError = vi.fn();
    const failed = new DesktopRuntimeConnector({
      getBridge: () => fake.bridge,
      isActive: () => true,
      onSettings: vi.fn(),
      onReadModel: vi.fn(),
      onCursor: vi.fn(),
      onConnectionStatus: vi.fn(),
      reportError,
    });
    failed.connect();
    await flushPromises();

    expect(reportError).toHaveBeenCalledWith(
      "Unable to read desktop-world read model.",
      failure,
    );
  });
});