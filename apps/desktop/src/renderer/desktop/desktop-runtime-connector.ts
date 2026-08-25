import type {
  AppSettingsSnapshot,
  DesktopBridge,
  DesktopCursorPoint,
  DesktopInteractionRequest,
  ManagementSection,
  RuntimeReadModelSlice,
} from "@airship-restaurant/contracts";
import { shouldAcceptRevision } from "../shared/latest-revision";

export interface DesktopRuntimeConnectorOptions {
  readonly getBridge: () => DesktopBridge | undefined;
  readonly isActive: () => boolean;

  readonly onSettings: (settings: AppSettingsSnapshot) => void;
  readonly onReadModel: (slice: RuntimeReadModelSlice) => void;
  readonly onCursor: (point: DesktopCursorPoint) => void;
  readonly onConnectionStatus: (
    status: "connected" | "preview" | "runtime-error",
  ) => void;
  readonly reportError: (
    message: string,
    error: unknown,
  ) => void;
}

export class DesktopRuntimeConnector {
  readonly #options: DesktopRuntimeConnectorOptions;
  #bridge: DesktopBridge | null = null;

  #unsubscribeCursor: (() => void) | null = null;
  #unsubscribeSettings: (() => void) | null = null;
  readonly #unsubscribeReadModels: (() => void)[] = [];

  #settingsRevision: number | null = null;
  readonly #readModelRevisions = new Map<RuntimeReadModelSlice["key"], number>();
  #connectionGeneration = 0;

  constructor(options: DesktopRuntimeConnectorOptions) {
    this.#options = options;
  }

  connect(): boolean {
    this.disconnect();
    const bridge = this.#options.getBridge();
    if (bridge === undefined) {
      this.#options.onConnectionStatus("preview");
      return false;
    }

    this.#bridge = bridge;
    const generation = this.#connectionGeneration;
    this.#options.onConnectionStatus("connected");

    this.#unsubscribeCursor = bridge.onCursorPosition((point) => {
      if (this.#isCurrentConnection(bridge, generation)) {
        this.#options.onCursor(point);
      }
    });
    this.#unsubscribeSettings = bridge.onSettingsChanged(
      (settings) => this.#deliverSettings(settings, bridge, generation),
    );
    for (const key of [
      "layout",
      "inventory",
      "characters",
      "desktop-world",
    ] as const) {
      this.#unsubscribeReadModels.push(
        bridge.onReadModelChanged(key, (slice) => {
          this.#deliverReadModel(slice, bridge, generation);
        }),
      );
    }

    void bridge.getSettings()
      .then((settings) => {
        this.#deliverSettings(settings, bridge, generation);
      })
      .catch((error: unknown) => {
        if (!this.#isCurrentConnection(bridge, generation)) return;
        this.#options.reportError(
          "Unable to read desktop settings.",
          error,
        );
      });
    for (const key of [
      "layout",
      "inventory",
      "characters",
      "desktop-world",
    ] as const) {
      void bridge.getReadModel(key)
        .then((slice) => {
          this.#deliverReadModel(slice, bridge, generation);
        })
        .catch((error: unknown) => {
          if (!this.#isCurrentConnection(bridge, generation)) return;
          this.#options.reportError(
            `Unable to read ${key} read model.`,
            error,
          );
        });
    }

    return true;
  }

  disconnect(): void {
    this.#connectionGeneration += 1;

    this.#unsubscribeCursor?.();
    this.#unsubscribeCursor = null;
    this.#unsubscribeSettings?.();
    this.#unsubscribeSettings = null;
    for (const unsubscribe of this.#unsubscribeReadModels.splice(0)) {
      unsubscribe();
    }
    this.#bridge = null;

    this.#settingsRevision = null;
    this.#readModelRevisions.clear();
  }

  setInteraction(request: DesktopInteractionRequest): void {
    if (this.#bridge === null) return;
    void this.#bridge.setInteraction(request).catch((error: unknown) => {
      this.#options.reportError(
        "Unable to update desktop interaction.",
        error,
      );
    });
  }

  async openManagement(section: ManagementSection): Promise<boolean> {
    if (this.#bridge === null) return false;
    try {
      await this.#bridge.openManagement({ section });
      return true;
    } catch (error: unknown) {
      this.#options.reportError(
        "Unable to open management window.",
        error,
      );
      return false;
    }
  }

  #isCurrentConnection(
    bridge: DesktopBridge,
    generation: number,
  ): boolean {
    return this.#bridge === bridge &&
      this.#connectionGeneration === generation &&
      this.#options.isActive();
  }


  #deliverReadModel(
    slice: RuntimeReadModelSlice,
    bridge: DesktopBridge,
    generation: number,
  ): void {
    if (!this.#isCurrentConnection(bridge, generation)) return;
    const currentRevision = this.#readModelRevisions.get(slice.key);
    if (currentRevision !== undefined && slice.revision <= currentRevision) {
      return;
    }
    this.#readModelRevisions.set(slice.key, slice.revision);
    this.#options.onReadModel(slice);
  }
  #deliverSettings(
    settings: AppSettingsSnapshot,
    bridge: DesktopBridge,
    generation: number,
  ): void {
    if (!this.#isCurrentConnection(bridge, generation)) return;
    if (!shouldAcceptRevision(this.#settingsRevision, settings.revision)) {
      return;
    }
    this.#settingsRevision = settings.revision;
    this.#options.onSettings(settings);
  }
}