import type {
  CharacterPresentationReadModel,
  CommandResult,
  DesktopWorldReadModel,
  FinanceReadModel,
  GameCommand,
  GameSnapshot,
  InstanceUpgradesReadModel,
  InventoryReadModel,
  InventoryReadModelCategory,
  InventoryReadModelItemTotal,
  InventoryReadModelLocation,
  LayoutReadModel,
  OperationsReadModel,
  ProcurementReadModel,
  ProgressionReadModel,
  RecruitmentReadModel,
  RuntimeReadModelKey,
  RuntimeReadModelSlice,
  StoryRosterReadModel,
} from "@airship-restaurant/contracts";
import type { RuntimeCommandExtensionPort } from "./instance-upgrade-runtime";
import {
  CHARACTER_PRESENTATION_READ_MODEL_KEY,
  EMPTY_CHARACTER_PRESENTATION_READ_MODEL,
  EMPTY_INSTANCE_UPGRADES_READ_MODEL,
  INSTANCE_UPGRADES_READ_MODEL_KEY,
  EMPTY_RECRUITMENT_READ_MODEL,
  RECRUITMENT_READ_MODEL_KEY,
  EMPTY_PROGRESSION_READ_MODEL,
  PROGRESSION_READ_MODEL_KEY,
  INVENTORY_READ_MODEL_KEY,
  LAYOUT_READ_MODEL_KEY,
  ReadModelRegistry,
  type RuntimeReadModelPort,
} from "../projections";

export const DESKTOP_WORLD_READ_MODEL_KEY = "desktop-world";
export const OPERATIONS_READ_MODEL_KEY = "operations";
export const PROCUREMENT_READ_MODEL_KEY = "procurement";
export const FINANCE_READ_MODEL_KEY = "finance";

export interface RuntimeSnapshotSource {
  getSnapshot(): GameSnapshot;
  dispatch(command: GameCommand): CommandResult;
  subscribe(listener: (snapshot: GameSnapshot) => void): () => void;
}

const EMPTY_LAYOUT_READ_MODEL: LayoutReadModel = Object.freeze({
  sourceRevision: 0,
  scenes: Object.freeze([]),
  storedBuildings: Object.freeze([]),
});

function legacyCategory(itemId: string): InventoryReadModelCategory {
  if (itemId.startsWith("ingredient.")) return "ingredient";
  if (itemId.startsWith("dishware.")) return "dishware";
  if (itemId.startsWith("dish.")) return "meal";
  return "intermediate";
}

function projectLegacyInventory(snapshot: GameSnapshot): InventoryReadModel {
  const gameplay = snapshot.gameplay;
  if (gameplay === null) {
    return Object.freeze({
      sourceRevision: 0,
      locations: Object.freeze([]),
      totals: Object.freeze([]),
      reservationCount: 0,
      capacityReservationCount: 0,
      dishware: null,
    });
  }

  const totals = new Map<string, InventoryReadModelItemTotal>();
  const locations: InventoryReadModelLocation[] = Object.values(
    gameplay.inventory,
  ).map((container) => {
    const items = container.entries.map((entry) => {
      const item: InventoryReadModelItemTotal = Object.freeze({
        itemId: entry.itemId,
        category: legacyCategory(entry.itemId),
        quantity: entry.quantity,
        reservedQuantity: entry.reservedQuantity,
        availableQuantity: entry.availableQuantity,
        inTransitQuantity: container.id === "cable.cargo" ? entry.quantity : 0,
      });
      const current = totals.get(item.itemId);
      totals.set(
        item.itemId,
        current === undefined
          ? item
          : Object.freeze({
              ...current,
              quantity: current.quantity + item.quantity,
              reservedQuantity:
                current.reservedQuantity + item.reservedQuantity,
              availableQuantity:
                current.availableQuantity + item.availableQuantity,
              inTransitQuantity:
                current.inTransitQuantity + item.inTransitQuantity,
            }),
      );
      return item;
    });
    return Object.freeze({
      id: container.id,
      compartments: Object.freeze([
        Object.freeze({
          id: `${container.id}.legacy-capacity`,
          capacity: container.capacity,
          occupied: container.totalQuantity,
          reservedCapacity: 0,
          availableCapacity: container.availableCapacity,
        }),
      ]),
      items: Object.freeze(items),
      instances: Object.freeze([]),
    });
  });

  return Object.freeze({
    sourceRevision: gameplay.revision,
    locations: Object.freeze(
      locations.sort((left, right) => left.id.localeCompare(right.id)),
    ),
    totals: Object.freeze(
      [...totals.values()].sort((left, right) =>
        left.itemId.localeCompare(right.itemId),
      ),
    ),
    reservationCount: [...totals.values()].reduce(
      (sum, item) => sum + item.reservedQuantity,
      0,
    ),
    capacityReservationCount: 0,
    dishware: null,
  });
}

function projectDesktopWorld(snapshot: GameSnapshot): DesktopWorldReadModel {
  const gameplay = snapshot.gameplay;
  return Object.freeze({
    sourceRevision: snapshot.revision,
    phase: snapshot.phase,
    gameplayRevision: gameplay?.revision ?? null,
    gameplay: gameplay === null
      ? null
      : Object.freeze({
          revision: gameplay.revision,
          currentUtcMs: gameplay.currentUtcMs,
          nextSupplyAtUtcMs: gameplay.nextSupplyAtUtcMs,
          supplyBoxesReceived: gameplay.supplyBoxesReceived,
          cooking: gameplay.cooking,
          logistics: gameplay.logistics,
          restaurant: gameplay.restaurant,
          upgrades: gameplay.upgrades,
        }),
    quietMode: snapshot.settings.quietMode,
    focusSession: snapshot.focusSession,
    procurement: gameplay?.procurement ?? null,
    seatCapacity: gameplay?.restaurant.seatCapacity ?? null,
    restaurantActivity: snapshot.restaurantActivity,
    foregroundDialogue:
      snapshot.story?.active ??
      snapshot.dialogue?.active ??
      null,
    deliveryRevision: 0,
    guestFlowRevision: 0,
    showLayoutAnchors: false,
  });
}

function projectOperations(
  snapshot: GameSnapshot,
  storyRosterSource: StoryRosterReadModelSource | null = null,
): OperationsReadModel {
  const gameplay = snapshot.gameplay;
  const operationsGameplay = gameplay === null
    ? null
    : Object.freeze({
        revision: gameplay.revision,
        currentUtcMs: gameplay.currentUtcMs,
        nextSupplyAtUtcMs: gameplay.nextSupplyAtUtcMs,
        supplyBoxesReceived: gameplay.supplyBoxesReceived,
        cooking: gameplay.cooking,
        logistics: gameplay.logistics,
        restaurant: gameplay.restaurant,
        upgrades: gameplay.upgrades,
      });
  return Object.freeze({
    sourceRevision: snapshot.revision,
    gameplay: operationsGameplay,
    restaurantActivity: snapshot.restaurantActivity,
    narrative: snapshot.narrative,
    dialogue: snapshot.dialogue,
    story: snapshot.story,
    storyRoster: storyRosterSource?.getSnapshot() ?? null,
    focusSession: snapshot.focusSession,
    technology: snapshot.technology,
    offlineEarnings: snapshot.offlineEarnings,
  });
}

function projectProcurement(snapshot: GameSnapshot): ProcurementReadModel {
  return Object.freeze({
    sourceRevision: snapshot.revision,
    currentUtcMs: snapshot.gameplay?.currentUtcMs ?? null,
    selectedRecipeId: snapshot.gameplay?.cooking.selectedRecipeId ?? null,
    procurement: snapshot.gameplay?.procurement ?? null,
  });
}

function projectFinance(snapshot: GameSnapshot): FinanceReadModel {
  const restaurant = snapshot.gameplay?.restaurant;
  const balanceCopper = restaurant?.copperBalance ?? 0;
  return Object.freeze({
    sourceRevision: snapshot.revision,
    balanceCopper,
    reservedCopper: 0,
    availableCopper: balanceCopper,
    totalCopperSpent: restaurant?.totalCopperSpent ?? 0,
    recentSales: restaurant?.recentSales ?? Object.freeze([]),
    currentDay: Object.freeze({
      gameDay: 1,
      closed: false,
      openingBalanceCopper: balanceCopper,
      incomeGroups: Object.freeze([]),
      expenseGroups: Object.freeze([]),
      totalIncomeCopper: 0,
      totalExpenseCopper: 0,
      netCopper: 0,
      closingBalanceCopper: balanceCopper,
      closedAtUtcMs: null,
    }),
    historicalDays: Object.freeze([]),
  });
}

export interface FinanceReadModelSource {
  getSnapshot(): FinanceReadModel;
}

export interface ProcurementReadModelSource {
  getSnapshot(): ProcurementReadModel;
}

export interface StoryRosterReadModelSource {
  getSnapshot(): StoryRosterReadModel;
}

export class RuntimeReadModelFacade implements RuntimeReadModelPort {
  readonly #runtime: RuntimeSnapshotSource;
  readonly #readModels = new ReadModelRegistry();
  readonly #functionalReadModels: RuntimeReadModelPort | null;
  readonly #functionalCommands: RuntimeCommandExtensionPort | null;
  readonly #financeSource: FinanceReadModelSource | null;
  readonly #procurementSource: ProcurementReadModelSource | null;
  readonly #storyRosterSource: StoryRosterReadModelSource | null;
  #gameplayRevision: number | null;

  constructor(
    runtime: RuntimeSnapshotSource,
    functionalReadModels: RuntimeReadModelPort | null = null,
    functionalCommands: RuntimeCommandExtensionPort | null = null,
    financeSource: FinanceReadModelSource | null = null,
    procurementSource: ProcurementReadModelSource | null = null,
    storyRosterSource: StoryRosterReadModelSource | null = null,
  ) {
    this.#runtime = runtime;
    this.#functionalReadModels = functionalReadModels;
    this.#functionalCommands = functionalCommands;
    this.#financeSource = financeSource;
    this.#procurementSource = procurementSource;
    this.#storyRosterSource = storyRosterSource;
    const initialSnapshot = runtime.getSnapshot();
    this.#gameplayRevision = initialSnapshot.gameplay?.revision ?? null;

    this.#readModels.register(
      DESKTOP_WORLD_READ_MODEL_KEY,
      projectDesktopWorld(initialSnapshot),
    );
    this.#readModels.register(
      OPERATIONS_READ_MODEL_KEY,
      projectOperations(initialSnapshot, this.#storyRosterSource),
    );
    this.#readModels.register(
      PROCUREMENT_READ_MODEL_KEY,
      this.#procurementSource?.getSnapshot() ?? projectProcurement(initialSnapshot),
    );
    this.#readModels.register(
      FINANCE_READ_MODEL_KEY,
      this.#financeSource?.getSnapshot() ?? projectFinance(initialSnapshot),
    );
    if (functionalReadModels === null) {
      this.#readModels.register(LAYOUT_READ_MODEL_KEY, EMPTY_LAYOUT_READ_MODEL);
      this.#readModels.register(
        INVENTORY_READ_MODEL_KEY,
        projectLegacyInventory(initialSnapshot),
      );
      this.#readModels.register(
        CHARACTER_PRESENTATION_READ_MODEL_KEY,
        EMPTY_CHARACTER_PRESENTATION_READ_MODEL,
      );
      this.#readModels.register(
        INSTANCE_UPGRADES_READ_MODEL_KEY,
        EMPTY_INSTANCE_UPGRADES_READ_MODEL,
      );
      this.#readModels.register(
        RECRUITMENT_READ_MODEL_KEY,
        EMPTY_RECRUITMENT_READ_MODEL,
      );
      this.#readModels.register(
        PROGRESSION_READ_MODEL_KEY,
        EMPTY_PROGRESSION_READ_MODEL,
      );
    }
    runtime.subscribe((snapshot) => {
      this.#readModels.publish(
        DESKTOP_WORLD_READ_MODEL_KEY,
        projectDesktopWorld(snapshot),
      );
      this.#readModels.publish(
        OPERATIONS_READ_MODEL_KEY,
        projectOperations(snapshot, this.#storyRosterSource),
      );
      this.#readModels.publish(
        PROCUREMENT_READ_MODEL_KEY,
        this.#procurementSource?.getSnapshot() ?? projectProcurement(snapshot),
      );
      this.#readModels.publish(
        FINANCE_READ_MODEL_KEY,
        this.#financeSource?.getSnapshot() ?? projectFinance(snapshot),
      );
      if (this.#functionalReadModels !== null) return;
      const gameplayRevision = snapshot.gameplay?.revision ?? null;
      if (gameplayRevision === this.#gameplayRevision) return;
      this.#gameplayRevision = gameplayRevision;
      this.#readModels.publish(
        INVENTORY_READ_MODEL_KEY,
        projectLegacyInventory(snapshot),
      );
    });
  }


  get(key: RuntimeReadModelKey): RuntimeReadModelSlice {
    if (key === DESKTOP_WORLD_READ_MODEL_KEY) {
      return this.#readModels.get<DesktopWorldReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === OPERATIONS_READ_MODEL_KEY) {
      return this.#readModels.get<OperationsReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === PROCUREMENT_READ_MODEL_KEY) {
      return this.#readModels.get<ProcurementReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === FINANCE_READ_MODEL_KEY) {
      return this.#readModels.get<FinanceReadModel>(key) as RuntimeReadModelSlice;
    }
    if (this.#functionalReadModels !== null) {
      return this.#functionalReadModels.get(key);
    }
    if (key === LAYOUT_READ_MODEL_KEY) {
      return this.#readModels.get<LayoutReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === INVENTORY_READ_MODEL_KEY) {
      return this.#readModels.get<InventoryReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === INSTANCE_UPGRADES_READ_MODEL_KEY) {
      return this.#readModels.get<InstanceUpgradesReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === RECRUITMENT_READ_MODEL_KEY) {
      return this.#readModels.get<RecruitmentReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === PROGRESSION_READ_MODEL_KEY) {
      return this.#readModels.get<ProgressionReadModel>(key) as RuntimeReadModelSlice;
    }
    return this.#readModels.get<CharacterPresentationReadModel>(key) as RuntimeReadModelSlice;
  }

  dispatch(command: GameCommand): CommandResult {
    const extended = this.#functionalCommands?.dispatch(command);
    if (extended?.handled === true) {
      return extended.accepted
        ? Object.freeze({ accepted: true, commandId: command.id })
        : Object.freeze({
            accepted: false,
            commandId: command.id,
            code: extended.rejectionCode ?? "INSTANCE_UPGRADE_REJECTED",
            message: extended.message,
          });
    }
    return this.#runtime.dispatch(command);
  }


  subscribe(
    key: RuntimeReadModelKey,
    listener: (slice: RuntimeReadModelSlice) => void,
    options: { readonly emitCurrent?: boolean } = {},
  ): () => void {
    if (key === DESKTOP_WORLD_READ_MODEL_KEY) {
      return this.#readModels.subscribe<DesktopWorldReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === OPERATIONS_READ_MODEL_KEY) {
      return this.#readModels.subscribe<OperationsReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === PROCUREMENT_READ_MODEL_KEY) {
      return this.#readModels.subscribe<ProcurementReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === FINANCE_READ_MODEL_KEY) {
      return this.#readModels.subscribe<FinanceReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (this.#functionalReadModels !== null) {
      return this.#functionalReadModels.subscribe(
        key,
        listener,
        options,
      );
    }
    if (key === LAYOUT_READ_MODEL_KEY) {
      return this.#readModels.subscribe<LayoutReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === INVENTORY_READ_MODEL_KEY) {
      return this.#readModels.subscribe<InventoryReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === INSTANCE_UPGRADES_READ_MODEL_KEY) {
      return this.#readModels.subscribe<InstanceUpgradesReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === RECRUITMENT_READ_MODEL_KEY) {
      return this.#readModels.subscribe<RecruitmentReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === PROGRESSION_READ_MODEL_KEY) {
      return this.#readModels.subscribe<ProgressionReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    return this.#readModels.subscribe<CharacterPresentationReadModel>(
      key,
      (slice) => listener(slice as RuntimeReadModelSlice),
      options,
    );
  }
}