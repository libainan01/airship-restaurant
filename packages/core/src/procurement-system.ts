import { InventorySystem, type ItemStack } from "./inventory-system";

export interface ProcurementRegionConfig {
  readonly id: string;
  readonly name: string;
  readonly deliveryDurationMs: number;
  readonly freightCostCopper: number;
  readonly cargoCapacity: number;
  readonly minimumTransportLevel: number;
  readonly items: readonly { readonly itemId: string; readonly unitPriceCopper: number }[];
}
export interface ProcurementAutomationPolicy {
  readonly itemId: string;
  readonly threshold: number;
  readonly target: number;
}
export interface ProcurementOrderSnapshot {
  readonly id: string;
  readonly regionId: string;
  readonly status: "queued" | "in-transit";
  readonly items: readonly ItemStack[];
  readonly itemCostCopper: number;
  readonly freightCostCopper: number;
  readonly totalCostCopper: number;
  readonly createdAtUtcMs: number;
  readonly departedAtUtcMs: number | null;
  readonly arriveAtUtcMs: number | null;
}
export interface ProcurementArrivalSnapshot {
  readonly orderId: string;
  readonly regionId: string;
  readonly items: readonly ItemStack[];
  readonly arrivedAtUtcMs: number;
}
export interface ProcurementSnapshot {
  readonly revision: number;
  readonly arrivalRevision: number;
  readonly nextTransitionUtcMs: number | null;
  readonly regions: readonly (ProcurementRegionConfig & { readonly unlocked: boolean })[];
  readonly orders: readonly ProcurementOrderSnapshot[];
  readonly recentArrivals: readonly ProcurementArrivalSnapshot[];
  readonly incomingItems: readonly ItemStack[];
  readonly automation: {
    readonly unlocked: boolean;
    readonly reserveCopper: number;
    readonly policies: readonly ProcurementAutomationPolicy[];
  };
}
export interface ProcurementSystemState {
  readonly version: 1;
  readonly revision: number;
  readonly arrivalRevision: number;
  readonly nextOrderSequence: number;
  readonly orders: readonly ProcurementOrderSnapshot[];
  readonly automationReserveCopper: number;
  readonly automationPolicies: readonly ProcurementAutomationPolicy[];
}
export type ProcurementActionResult =
  | { readonly accepted: true; readonly changed: true; readonly totalCostCopper: number; readonly createdOrderIds: readonly string[]; readonly snapshot: ProcurementSnapshot }
  | { readonly accepted: false; readonly changed: false; readonly message: string; readonly snapshot: ProcurementSnapshot };

interface MutableOrder {
  id: string;
  regionId: string;
  status: "queued" | "in-transit";
  items: readonly ItemStack[];
  itemCostCopper: number;
  freightCostCopper: number;
  totalCostCopper: number;
  createdAtUtcMs: number;
  departedAtUtcMs: number | null;
  arriveAtUtcMs: number | null;
}
const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const isNonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const cloneStacks = (items: readonly ItemStack[]): readonly ItemStack[] =>
  Object.freeze(items.map((item) => Object.freeze({ ...item })));
function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range.`);
  return result;
}
function aggregate(items: readonly ItemStack[]): readonly ItemStack[] {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.itemId, safeAdd(totals.get(item.itemId) ?? 0, item.quantity, "Item quantity"));
  return Object.freeze([...totals].map(([itemId, quantity]) => Object.freeze({ itemId, quantity })));
}

export class ProcurementSystem {
  readonly #inventory: InventorySystem;
  readonly #containerId: string;
  readonly #capacities: ReadonlyMap<string, number>;
  readonly #regions: readonly ProcurementRegionConfig[];
  readonly #regionsById = new Map<string, ProcurementRegionConfig>();
  readonly #sources = new Map<string, { readonly region: ProcurementRegionConfig; readonly unitPriceCopper: number }>();
  readonly #orders: MutableOrder[] = [];
  readonly #recentArrivals: ProcurementArrivalSnapshot[] = [];
  #revision = 0;
  #arrivalRevision = 0;
  #nextOrderSequence = 1;
  #transportLevel = 0;
  #automationUnlocked = false;
  #automationReserveCopper = 0;
  #automationPolicies: readonly ProcurementAutomationPolicy[] = Object.freeze([]);

  constructor(options: {
    readonly inventory: InventorySystem;
    readonly ingredientContainerId: string;
    readonly ingredientCapacities: ReadonlyMap<string, number>;
    readonly regions: readonly ProcurementRegionConfig[];
    readonly initialState?: ProcurementSystemState;
  }) {
    if (options.regions.length === 0) throw new Error("Procurement requires at least one region.");
    this.#inventory = options.inventory;
    this.#containerId = options.ingredientContainerId;
    this.#capacities = options.ingredientCapacities;
    this.#inventory.getContainerSnapshot(this.#containerId);
    this.#regions = Object.freeze(options.regions.map((region) => {
      if (region.id.length === 0 || !isPositiveInteger(region.deliveryDurationMs) ||
        !isNonNegativeInteger(region.freightCostCopper) || !isPositiveInteger(region.cargoCapacity) ||
        !isNonNegativeInteger(region.minimumTransportLevel) || region.items.length === 0 ||
        this.#regionsById.has(region.id)) throw new Error(`Invalid procurement region: ${region.id}`);
      const cloned = Object.freeze({
        ...region,
        items: Object.freeze(region.items.map((item) => {
          if (!this.#capacities.has(item.itemId) || !isPositiveInteger(item.unitPriceCopper) ||
            this.#sources.has(item.itemId)) throw new Error(`Invalid procurement item: ${item.itemId}`);
          this.#sources.set(item.itemId, { region, unitPriceCopper: item.unitPriceCopper });
          return Object.freeze({ ...item });
        })),
      });
      this.#regionsById.set(cloned.id, cloned);
      return cloned;
    }));
    const state = options.initialState;
    if (state !== undefined) {
      this.#revision = state.revision;
      this.#arrivalRevision = state.arrivalRevision;
      this.#nextOrderSequence = state.nextOrderSequence;
      this.#automationReserveCopper = state.automationReserveCopper;
      this.#automationPolicies = Object.freeze(state.automationPolicies.map((policy) => Object.freeze({ ...policy })));
      this.#orders.push(...state.orders.map((order) => ({ ...order, items: cloneStacks(order.items) })));
    }
  }

  setUnlocks(transportLevel: number, automationUnlocked: boolean): void {
    this.#transportLevel = transportLevel;
    this.#automationUnlocked = automationUnlocked;
  }
  getSnapshot(): ProcurementSnapshot {
    const nextTransitionUtcMs = this.#orders.reduce<number | null>(
      (earliest, order) => order.arriveAtUtcMs !== null && (earliest === null || order.arriveAtUtcMs < earliest) ? order.arriveAtUtcMs : earliest,
      null,
    );
    return Object.freeze({
      revision: this.#revision,
      arrivalRevision: this.#arrivalRevision,
      nextTransitionUtcMs,
      regions: Object.freeze(this.#regions.map((region) => Object.freeze({
        ...region,
        items: Object.freeze(region.items.map((item) => Object.freeze({ ...item }))),
        unlocked: region.minimumTransportLevel <= this.#transportLevel,
      }))),
      orders: Object.freeze(this.#orders.map((order) => Object.freeze({ ...order, items: cloneStacks(order.items) }))),
      recentArrivals: Object.freeze([...this.#recentArrivals]),
      incomingItems: aggregate(this.#orders.flatMap((order) => order.items)),
      automation: Object.freeze({
        unlocked: this.#automationUnlocked,
        reserveCopper: this.#automationReserveCopper,
        policies: Object.freeze(this.#automationPolicies.map((policy) => Object.freeze({ ...policy }))),
      }),
    });
  }
  exportState(): ProcurementSystemState {
    return Object.freeze({
      version: 1,
      revision: this.#revision,
      arrivalRevision: this.#arrivalRevision,
      nextOrderSequence: this.#nextOrderSequence,
      orders: this.getSnapshot().orders,
      automationReserveCopper: this.#automationReserveCopper,
      automationPolicies: Object.freeze(this.#automationPolicies.map((policy) => Object.freeze({ ...policy }))),
    });
  }

  placeOrder(requestedItems: readonly ItemStack[], atUtcMs: number, spendCopper: (amount: number) => boolean): ProcurementActionResult {
    const normalized = this.#normalize(requestedItems);
    if (typeof normalized === "string") return this.#reject(normalized);
    const capacityError = this.#capacityError(normalized);
    if (capacityError !== null) return this.#reject(capacityError);
    const drafts = this.#createDrafts(normalized, atUtcMs);
    const totalCostCopper = drafts.reduce((total, draft) => safeAdd(total, draft.totalCostCopper, "Plan cost"), 0);
    if (!spendCopper(totalCostCopper)) return this.#reject("Not enough copper for this procurement plan.");
    const createdOrderIds: string[] = [];
    for (const draft of drafts) {
      const id = `procurement-${this.#nextOrderSequence}`;
      this.#nextOrderSequence += 1;
      this.#orders.push({ ...draft, id });
      createdOrderIds.push(id);
    }
    for (const region of this.#regions) this.#startNext(region.id, atUtcMs);
    this.#revision += 1;
    return Object.freeze({ accepted: true, changed: true, totalCostCopper, createdOrderIds: Object.freeze(createdOrderIds), snapshot: this.getSnapshot() });
  }

  configureAutomation(reserveCopper: number, policies: readonly ProcurementAutomationPolicy[]): ProcurementActionResult {
    if (!this.#automationUnlocked) return this.#reject("Automatic procurement has not been unlocked.");
    const seen = new Set<string>();
    if (!isNonNegativeInteger(reserveCopper) || policies.some((policy) => {
      const invalid = !this.#sources.has(policy.itemId) || seen.has(policy.itemId) ||
        !isNonNegativeInteger(policy.threshold) || !isPositiveInteger(policy.target) || policy.threshold >= policy.target;
      seen.add(policy.itemId);
      return invalid;
    })) return this.#reject("Automatic procurement policy is invalid.");
    this.#automationReserveCopper = reserveCopper;
    this.#automationPolicies = Object.freeze(policies.map((policy) => Object.freeze({ ...policy })));
    this.#revision += 1;
    return Object.freeze({ accepted: true, changed: true, totalCostCopper: 0, createdOrderIds: Object.freeze([]), snapshot: this.getSnapshot() });
  }

  tryAutomaticOrder(atUtcMs: number, copperBalance: number, spendCopper: (amount: number) => boolean): ProcurementActionResult | null {
    if (!this.#automationUnlocked || this.#automationPolicies.length === 0) return null;
    const pantry = this.#inventory.getContainerSnapshot(this.#containerId);
    const current = new Map(pantry.entries.map((entry) => [entry.itemId, entry.quantity]));
    const incoming = new Map(this.getSnapshot().incomingItems.map((entry) => [entry.itemId, entry.quantity]));
    const requested = this.#automationPolicies.flatMap((policy): ItemStack[] => {
      const total = (current.get(policy.itemId) ?? 0) + (incoming.get(policy.itemId) ?? 0);
      const source = this.#sources.get(policy.itemId);
      return total < policy.threshold && source !== undefined &&
        source.region.minimumTransportLevel <= this.#transportLevel
        ? [{ itemId: policy.itemId, quantity: policy.target - total }] : [];
    });
    if (requested.length === 0) return null;
    const normalized = this.#normalize(requested);
    if (typeof normalized === "string" || this.#capacityError(normalized) !== null) return null;
    const cost = this.#createDrafts(normalized, atUtcMs).reduce((total, draft) => total + draft.totalCostCopper, 0);
    if (cost > copperBalance - this.#automationReserveCopper) return null;
    return this.placeOrder(requested, atUtcMs, spendCopper);
  }

  advanceTo(atUtcMs: number): { readonly changed: boolean; readonly arrivals: readonly ProcurementArrivalSnapshot[] } {
    const due = this.#orders.filter((order) => order.status === "in-transit" && order.arriveAtUtcMs === atUtcMs);
    const arrivals: ProcurementArrivalSnapshot[] = [];
    for (const order of due) {
      const deposit = this.#inventory.deposit(`procurement-arrival:${order.id}`, this.#containerId, order.items);
      if (!deposit.accepted) throw new Error(`Procurement arrival failed: ${deposit.code}`);
      const arrival = Object.freeze({ orderId: order.id, regionId: order.regionId, items: cloneStacks(order.items), arrivedAtUtcMs: atUtcMs });
      arrivals.push(arrival);
      this.#recentArrivals.push(arrival);
      if (this.#recentArrivals.length > 8) this.#recentArrivals.shift();
      this.#arrivalRevision += 1;
      this.#orders.splice(this.#orders.indexOf(order), 1);
      this.#startNext(order.regionId, atUtcMs);
    }
    if (arrivals.length > 0) this.#revision += 1;
    return Object.freeze({ changed: arrivals.length > 0, arrivals: Object.freeze(arrivals) });
  }

  #normalize(items: readonly ItemStack[]): readonly ItemStack[] | string {
    if (items.length === 0) return "Procurement plan is empty.";
    const totals = new Map<string, number>();
    for (const item of items) {
      const source = this.#sources.get(item.itemId);
      if (source === undefined || !isPositiveInteger(item.quantity) ||
        source.region.minimumTransportLevel > this.#transportLevel) return `Ingredient is unavailable: ${item.itemId}`;
      totals.set(item.itemId, safeAdd(totals.get(item.itemId) ?? 0, item.quantity, "Requested quantity"));
    }
    return Object.freeze([...totals].map(([itemId, quantity]) => Object.freeze({ itemId, quantity })));
  }
  #capacityError(requested: readonly ItemStack[]): string | null {
    const pantry = this.#inventory.getContainerSnapshot(this.#containerId);
    const incoming = aggregate(this.#orders.flatMap((order) => order.items));
    const incomingByItem = new Map(incoming.map((item) => [item.itemId, item.quantity]));
    const currentByItem = new Map(pantry.entries.map((entry) => [entry.itemId, entry.quantity]));
    const requestedTotal = requested.reduce((total, item) => total + item.quantity, 0);
    const incomingTotal = incoming.reduce((total, item) => total + item.quantity, 0);
    if (requestedTotal > pantry.availableCapacity - incomingTotal) return "The kitchen pantry does not have enough unreserved space.";
    for (const item of requested) {
      const capacity = this.#capacities.get(item.itemId) ?? 0;
      if (item.quantity + (incomingByItem.get(item.itemId) ?? 0) + (currentByItem.get(item.itemId) ?? 0) > capacity)
        return `Ingredient storage capacity would be exceeded: ${item.itemId}`;
    }
    return null;
  }
  #createDrafts(requested: readonly ItemStack[], atUtcMs: number): readonly Omit<MutableOrder, "id">[] {
    const byRegion = new Map<string, { itemId: string; quantity: number }[]>();
    for (const item of requested) {
      const source = this.#sources.get(item.itemId);
      if (source === undefined) throw new Error("Procurement source disappeared.");
      const regionItems = byRegion.get(source.region.id) ?? [];
      regionItems.push({ ...item });
      byRegion.set(source.region.id, regionItems);
    }
    const drafts: Omit<MutableOrder, "id">[] = [];
    for (const region of this.#regions) {
      const remaining = byRegion.get(region.id) ?? [];
      while (remaining.some((item) => item.quantity > 0)) {
        let available = region.cargoCapacity;
        const shipment: ItemStack[] = [];
        for (const item of remaining) {
          if (available === 0 || item.quantity === 0) continue;
          const quantity = Math.min(item.quantity, available);
          shipment.push({ itemId: item.itemId, quantity });
          item.quantity -= quantity;
          available -= quantity;
        }
        const itemCostCopper = shipment.reduce((total, item) => safeAdd(total, item.quantity * (this.#sources.get(item.itemId)?.unitPriceCopper ?? 0), "Item cost"), 0);
        drafts.push({
          regionId: region.id, status: "queued", items: cloneStacks(shipment),
          itemCostCopper, freightCostCopper: region.freightCostCopper,
          totalCostCopper: itemCostCopper + region.freightCostCopper,
          createdAtUtcMs: atUtcMs, departedAtUtcMs: null, arriveAtUtcMs: null,
        });
      }
    }
    return Object.freeze(drafts);
  }
  #startNext(regionId: string, atUtcMs: number): void {
    if (this.#orders.some((order) => order.regionId === regionId && order.status === "in-transit")) return;
    const order = this.#orders.find((candidate) => candidate.regionId === regionId && candidate.status === "queued");
    if (order === undefined) return;
    const region = this.#regionsById.get(regionId);
    if (region === undefined) throw new Error("Procurement region disappeared.");
    order.status = "in-transit";
    order.departedAtUtcMs = atUtcMs;
    order.arriveAtUtcMs = safeAdd(atUtcMs, region.deliveryDurationMs, "Procurement arrival time");
  }
  #reject(message: string): ProcurementActionResult {
    return Object.freeze({ accepted: false, changed: false, message, snapshot: this.getSnapshot() });
  }
}

