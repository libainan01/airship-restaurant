import type {
  InventoryReadModel,
  InventoryReadModelDishwareSummary,
  InventoryReadModelItemTotal,
  InventoryReadModelLocation,
  ManualLogisticsReadModel,
} from "@airship-restaurant/contracts";
import type { DishwareSnapshot } from "../modules";
import type {
  InventoryItemCategory,
  InventoryLocationSnapshot,
  InventorySnapshot,
} from "../modules";

export const INVENTORY_READ_MODEL_KEY = "inventory" as const;

interface MutableItemTotal {
  itemId: string;
  category: InventoryItemCategory;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  inTransitQuantity: number;
}

function addItem(
  totals: Map<string, MutableItemTotal>,
  itemId: string,
  category: InventoryItemCategory,
  values: {
    readonly quantity: number;
    readonly reservedQuantity: number;
    readonly availableQuantity: number;
    readonly inTransitQuantity: number;
  },
): void {
  const total = totals.get(itemId) ?? {
    itemId,
    category,
    quantity: 0,
    reservedQuantity: 0,
    availableQuantity: 0,
    inTransitQuantity: 0,
  };
  total.quantity += values.quantity;
  total.reservedQuantity += values.reservedQuantity;
  total.availableQuantity += values.availableQuantity;
  total.inTransitQuantity += values.inTransitQuantity;
  totals.set(itemId, total);
}

function freezeTotals(
  totals: ReadonlyMap<string, MutableItemTotal>,
): readonly InventoryReadModelItemTotal[] {
  return Object.freeze(
    [...totals.values()]
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
      .map((entry) => Object.freeze({ ...entry })),
  );
}

function projectLocation(
  location: InventoryLocationSnapshot,
  globalTotals: Map<string, MutableItemTotal>,
): InventoryReadModelLocation {
  const totals = new Map<string, MutableItemTotal>();
  for (const stack of location.stacks) {
    addItem(totals, stack.itemId, stack.category, {
      quantity: stack.quantity,
      reservedQuantity: stack.reservedQuantity,
      availableQuantity: stack.availableQuantity,
      inTransitQuantity: 0,
    });
  }
  for (const instance of location.instances) {
    const reservedQuantity = instance.reservationId === null ? 0 : 1;
    addItem(totals, instance.itemId, instance.category, {
      quantity: 1,
      reservedQuantity,
      availableQuantity: reservedQuantity === 0 ? 1 : 0,
      inTransitQuantity: 0,
    });
  }
  for (const cargo of location.stackCargo) {
    addItem(totals, cargo.itemId, cargo.category, {
      quantity: 1,
      reservedQuantity: cargo.reservationId === null ? 0 : 1,
      availableQuantity: 0,
      inTransitQuantity: 1,
    });
  }
  for (const total of totals.values()) {
    addItem(globalTotals, total.itemId, total.category, total);
  }

  return Object.freeze({
    id: location.id,
    compartments: Object.freeze(
      location.compartments.map((compartment) =>
        Object.freeze({ ...compartment }),
      ),
    ),
    items: freezeTotals(totals),
    instances: Object.freeze(
      location.instances
        .map((instance) =>
          Object.freeze({
            id: instance.id,
            itemId: instance.itemId,
            category: instance.category,
            reservationId: instance.reservationId,
            attributes: Object.freeze({ ...instance.attributes }),
          }),
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
    ),
  });
}

function projectDishware(
  snapshot: DishwareSnapshot | null,
): InventoryReadModelDishwareSummary | null {
  if (snapshot === null) return null;
  return Object.freeze({
    sourceRevision: snapshot.revision,
    totalPlateCount: snapshot.totalPlateCount,
    clean: snapshot.counts.clean,
    inUse: snapshot.counts.in_use,
    dirty: snapshot.counts.dirty,
    washing: snapshot.counts.washing,
    activeWashJobs: snapshot.washJobs.length,
  });
}

export function projectInventoryReadModel(
  snapshot: InventorySnapshot,
  dishwareSnapshot: DishwareSnapshot | null = null,
  manualLogistics?: ManualLogisticsReadModel,
): InventoryReadModel {
  const globalTotals = new Map<string, MutableItemTotal>();
  const locations = snapshot.locations
    .map((location) => projectLocation(location, globalTotals))
    .sort((left, right) => left.id.localeCompare(right.id));

  return Object.freeze({
    sourceRevision: snapshot.revision,
    locations: Object.freeze(locations),
    totals: freezeTotals(globalTotals),
    reservationCount: snapshot.reservations.length,
    capacityReservationCount: snapshot.capacityReservations.length,
    dishware: projectDishware(dishwareSnapshot),
    ...(manualLogistics === undefined ? {} : { manualLogistics }),
  });
}