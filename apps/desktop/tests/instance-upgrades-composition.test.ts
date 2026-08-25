import { describe, expect, it, vi } from "vitest";
import {
  createM2ContentRegistry,
  M2_INITIAL_PROCUREMENT_AIRSHIPS,
  M2_PROCUREMENT_AIRSHIPS,
} from "@airship-restaurant/content";
import {
  BuildingUpgradeModule,
  DomainEventBus,
  FinanceModule,
  FleetModule,
  InstanceUpgradeRuntime,
  InventoryModule,
  SceneEditModeController,
  StaticInventoryStorageDefinitions,
  instanceId,
} from "@airship-restaurant/core";
import { createDesktopLocalProcurementRuntime } from "../src/main/local-procurement-runtime";
import { createR3SceneLayout } from "../src/main/r3-runtime";
import { createR4CharacterPresentationRuntime } from "../src/main/r4-character-presentation-runtime";
import { SystemClock } from "../src/main/system-clock";

describe("desktop instance-upgrade composition", () => {
  it("shares formal content, one finance balance and one runtime across buildings and procurement carts", () => {
    const content = createM2ContentRegistry();
    const finance = new FinanceModule(1_000);
    const inventory = new InventoryModule(
      content.listIngredients().map((ingredient) => ({
        id: ingredient.id,
        category: "ingredient" as const,
        storageMode: "stack" as const,
      })),
      new StaticInventoryStorageDefinitions([{
        id: "kitchen.ingredients",
        compartments: [{ id: "ingredients", capacity: 9_999, acceptedCategories: ["ingredient"] }],
      }]),
    );
    const clock = new SystemClock(0, () => 0);
    const people = createR4CharacterPresentationRuntime(content, () => clock.nowUtcMs());
    const layout = createR3SceneLayout(content.listBuildings());
    const editMode = new SceneEditModeController(clock);
    const buildingUpgrades = new BuildingUpgradeModule({
      finance,
      layout,
      editMode,
      eventBus: new DomainEventBus(),
    });
    const fleet = new FleetModule({
      definitions: M2_PROCUREMENT_AIRSHIPS,
      initialShips: M2_INITIAL_PROCUREMENT_AIRSHIPS,
      captains: { getCaptainSnapshot: () => null },
      routes: { isRouteUnlocked: () => false },
      policy: {
        calculateVoyageDurationMs: () => 1,
        calculateDurabilityLoss: () => 0,
        calculateCooldownDurationMs: () => 0,
      },
      finance,
    });
    const procurement = createDesktopLocalProcurementRuntime({
      content,
      finance,
      inventory,
      characters: people.characters,
      employment: people.employment,
      tasks: people.tasks,
      fleet,
    });
    const onChanged = vi.fn();
    const runtime = new InstanceUpgradeRuntime({
      layout,
      editMode,
      buildingUpgrades,
      procurement,
      fleet,
      clock,
      onChanged,
    });
    const buildingId = instanceId("instance.building.airship_exchange");

    expect(runtime.dispatch({
      id: "enter-composed-edit",
      type: "scene-edit.enter",
      payload: { sceneId: "scene.desktop" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(runtime.dispatch({
      id: "prepare-composed-building",
      type: "instance-upgrade.prepare-building",
      payload: { buildingId, previewId: "preview.airship-exchange.level-2" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(runtime.dispatch({
      id: "confirm-composed-building",
      type: "instance-upgrade.confirm-building",
      payload: { previewId: "preview.airship-exchange.level-2" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(runtime.dispatch({
      id: "upgrade-composed-cart",
      type: "instance-upgrade.procurement-cart",
      payload: { cartId: "cart.greyfeather_1" },
    })).toMatchObject({ handled: true, accepted: true });
    expect(runtime.dispatch({
      id: "upgrade-composed-airship",
      type: "instance-upgrade.procurement-airship",
      payload: { shipId: "instance.airship.skylark_01" },
    })).toMatchObject({ handled: true, accepted: true });

    expect(layout.getBuilding(buildingId)).toMatchObject({ level: 2 });
    expect(procurement.getCart("cart.greyfeather_1")).toMatchObject({
      level: 2,
      capacity: 5,
      speedUnitsPerSecond: 28,
    });
    expect(fleet.exportState().ships[0]).toMatchObject({ level: 2, durability: 100 });
    expect(finance.getSnapshot().balanceCopper).toBe(660);
    expect(runtime.getSnapshot()).toMatchObject({
      editMode: { active: true, sceneId: "scene.desktop" },
      procurementCarts: [{ id: "cart.greyfeather_1", currentLevel: 2 }],
      procurementAirships: [{ id: "instance.airship.skylark_01", currentLevel: 2 }],
    });
    expect(onChanged).toHaveBeenCalledTimes(5);
  });
});