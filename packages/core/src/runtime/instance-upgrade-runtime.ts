import type { CommandRejectionCode, GameCommand, InstanceUpgradesReadModel } from "@airship-restaurant/contracts";
import type { BuildingConstructionModule, BuildingUpgradeModule, FleetModule, LocalProcurementModule, SceneLayoutModule } from "../modules";
import { projectInstanceUpgradesReadModel } from "../projections";
import type { SceneEditModeController } from "./scene-edit-mode-controller";

export type InstanceUpgradeGameCommand = Extract<GameCommand, { readonly type: `instance-upgrade.${string}` | `scene-edit.${string}` | `building-construction.${string}` }>;
export type RuntimeCommandExtensionResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly accepted: boolean; readonly message: string; readonly rejectionCode?: CommandRejectionCode };
export interface RuntimeCommandExtensionPort { dispatch(command: GameCommand): RuntimeCommandExtensionResult; }
export interface InstanceUpgradeClockPort { nowUtcMs(): number; }
const MAX_COMMAND_HISTORY = 4_096;

type OperationResult = { readonly accepted: true; readonly changed: boolean } | { readonly accepted: false; readonly changed: false; readonly message: string };

export class InstanceUpgradeRuntime implements RuntimeCommandExtensionPort {
  readonly #layout: SceneLayoutModule;
  readonly #editMode: SceneEditModeController | null;
  readonly #buildingUpgrades: BuildingUpgradeModule | null;
  readonly #buildingConstruction: BuildingConstructionModule | null;
  readonly #buildingCatalog: readonly { readonly definitionId: string; readonly name: string; readonly unlocked: boolean }[];
  readonly #procurement: LocalProcurementModule | null;
  readonly #fleet: FleetModule | null;
  readonly #clock: InstanceUpgradeClockPort;
  readonly #onChanged: () => void;
  readonly #processedCommandIds = new Set<string>();
  readonly #commandHistory: string[] = [];

  constructor(options: {
    readonly layout: SceneLayoutModule;
    readonly editMode?: SceneEditModeController;
    readonly buildingUpgrades?: BuildingUpgradeModule;
    readonly buildingConstruction?: BuildingConstructionModule;
    readonly buildingCatalog?: readonly { readonly definitionId: string; readonly name: string; readonly unlocked: boolean }[];
    readonly procurement?: LocalProcurementModule;
    readonly fleet?: FleetModule;
    readonly clock: InstanceUpgradeClockPort;
    readonly onChanged?: () => void;
  }) {
    this.#layout = options.layout;
    this.#editMode = options.editMode ?? null;
    this.#buildingUpgrades = options.buildingUpgrades ?? null;
    this.#buildingConstruction = options.buildingConstruction ?? null;
    this.#buildingCatalog = Object.freeze((options.buildingCatalog ?? []).map((entry) => Object.freeze({ ...entry })));
    this.#procurement = options.procurement ?? null;
    this.#fleet = options.fleet ?? null;
    this.#clock = options.clock;
    this.#onChanged = options.onChanged ?? (() => undefined);
  }

  getSnapshot(): InstanceUpgradesReadModel {
    return projectInstanceUpgradesReadModel({
      layout: this.#layout,
      ...(this.#editMode === null ? {} : { editMode: this.#editMode }),
      ...(this.#buildingUpgrades === null ? {} : { buildingUpgrades: this.#buildingUpgrades }),
      ...(this.#buildingConstruction === null ? {} : { buildingConstruction: this.#buildingConstruction, buildingCatalog: this.#buildingCatalog }),
      ...(this.#procurement === null ? {} : { procurement: this.#procurement }),
      ...(this.#fleet === null ? {} : { fleet: this.#fleet }),
    });
  }

  dispatch(command: GameCommand): RuntimeCommandExtensionResult {
    if (!command.type.startsWith("instance-upgrade.") && !command.type.startsWith("scene-edit.") && !command.type.startsWith("building-construction.")) return Object.freeze({ handled: false });
    if (this.#processedCommandIds.has(command.id)) return Object.freeze({ handled: true, accepted: false, message: "The instance upgrade command id has already been processed." });
    this.#remember(command.id);
    const occurredAtUtcMs = this.#clock.nowUtcMs();
    let result: OperationResult;
    switch (command.type) {
      case "scene-edit.enter": {
        if (this.#editMode === null) return this.#unavailable("Scene edit mode is unavailable.");
        const edit = this.#editMode.enter(command.payload.sceneId);
        if (!edit.accepted) return Object.freeze({ handled: true, accepted: false, message: edit.message });
        if (this.#buildingConstruction === null) { result = edit; break; }
        const construction = this.#buildingConstruction.enterEditMode(`${command.id}:construction`, command.payload.sceneId, occurredAtUtcMs);
        if (!construction.accepted) {
          if (edit.changed) this.#editMode.exit();
          return Object.freeze({ handled: true, accepted: false, message: construction.message });
        }
        result = Object.freeze({ accepted: true, changed: edit.changed || construction.changed });
        break;
      }
      case "scene-edit.exit": {
        if (this.#editMode === null) return this.#unavailable("Scene edit mode is unavailable.");
        if (this.#buildingConstruction !== null && this.#buildingConstruction.getSnapshot().editModeSceneId !== null) {
          const construction = this.#buildingConstruction.exitEditMode(`${command.id}:construction`, occurredAtUtcMs);
          if (!construction.accepted) return Object.freeze({ handled: true, accepted: false, message: construction.message });
        }
        result = this.#editMode.exit();
        break;
      }
      case "building-construction.start-preview": {
        if (this.#buildingConstruction === null) return this.#unavailable("Building construction is unavailable.");
        const started = this.#buildingConstruction.startPreview(command.id, command.payload.previewId, command.payload.definitionId, { styleId: command.payload.styleId, occurredAtUtcMs });
        if (!started.accepted) { result = started; break; }
        result = this.#buildingConstruction.updatePreviewPlacement(`${command.id}:placement`, command.payload.previewId, { x: command.payload.x, y: command.payload.y, orientation: command.payload.orientation }, occurredAtUtcMs);
        break;
      }
      case "building-construction.update-preview":
        if (this.#buildingConstruction === null) return this.#unavailable("Building construction is unavailable.");
        result = this.#buildingConstruction.updatePreviewPlacement(command.id, command.payload.previewId, { x: command.payload.x, y: command.payload.y, orientation: command.payload.orientation }, occurredAtUtcMs);
        break;
      case "building-construction.confirm-preview":
        if (this.#buildingConstruction === null) return this.#unavailable("Building construction is unavailable.");
        result = this.#buildingConstruction.confirmPreview(command.id, command.payload.previewId, occurredAtUtcMs);
        break;
      case "building-construction.cancel-preview":
        if (this.#buildingConstruction === null) return this.#unavailable("Building construction is unavailable.");
        result = this.#buildingConstruction.cancelPreview(command.id, command.payload.previewId, occurredAtUtcMs);
        break;
      case "building-construction.move-building": {
        if (this.#editMode === null || !this.#editMode.isEditModeActive(command.payload.sceneId)) return this.#unavailable("Enter edit mode for this scene before moving a building.");
        result = this.#layout.moveBuilding(command.id, command.payload.buildingId, command.payload.sceneId, { x: command.payload.x, y: command.payload.y, orientation: command.payload.orientation }, occurredAtUtcMs);
        break;
      }
      case "building-construction.change-style": {
        const building = this.#layout.getSnapshot().buildings.find((entry) => entry.id === command.payload.buildingId);
        if (building?.sceneId === null || building === undefined || this.#editMode === null || !this.#editMode.isEditModeActive(building.sceneId)) return this.#unavailable("Enter edit mode for this scene before changing a building style.");
        result = this.#layout.changeStyle(command.id, command.payload.buildingId, command.payload.styleId, occurredAtUtcMs);
        break;
      }
      case "instance-upgrade.prepare-building":
        if (this.#buildingUpgrades === null) return this.#unavailable("Building upgrades are unavailable.");
        result = this.#buildingUpgrades.prepareUpgrade(command.id, command.payload.previewId, command.payload.buildingId, occurredAtUtcMs);
        break;
      case "instance-upgrade.confirm-building":
        if (this.#buildingUpgrades === null) return this.#unavailable("Building upgrades are unavailable.");
        result = this.#buildingUpgrades.confirmUpgrade(command.id, command.payload.previewId, occurredAtUtcMs);
        break;
      case "instance-upgrade.cancel-building":
        if (this.#buildingUpgrades === null) return this.#unavailable("Building upgrades are unavailable.");
        result = this.#buildingUpgrades.cancelUpgrade(command.id, command.payload.previewId, occurredAtUtcMs);
        break;
      case "instance-upgrade.procurement-cart":
        if (this.#procurement === null) return this.#unavailable("Procurement cart upgrades are unavailable.");
        result = this.#procurement.upgradeCart(command.id, command.payload.cartId, occurredAtUtcMs);
        break;
      case "instance-upgrade.procurement-airship":
        if (this.#fleet === null) return this.#unavailable("Procurement airship upgrades are unavailable.");
        result = this.#fleet.upgradeShip(command.id, command.payload.shipId, occurredAtUtcMs);
        break;
      default:
        return Object.freeze({ handled: false });
    }
    if (!result.accepted) return Object.freeze({ handled: true, accepted: false, message: result.message });
    if (result.changed) this.#onChanged();
    return Object.freeze({ handled: true, accepted: true, message: "Instance and construction command completed." });
  }
  #unavailable(message: string): RuntimeCommandExtensionResult { return Object.freeze({ handled: true, accepted: false, message }); }
  #remember(commandId: string): void { this.#processedCommandIds.add(commandId); this.#commandHistory.push(commandId); if (this.#commandHistory.length <= MAX_COMMAND_HISTORY) return; const removed = this.#commandHistory.shift(); if (removed !== undefined) this.#processedCommandIds.delete(removed); }
}