import type { DomainEvent, InstanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { EmploymentModule } from "../employment";

export const AUTOMATIC_PROCUREMENT_MODULE_ID = "module.automatic-procurement";
export const AUTOMATIC_PROCUREMENT_SCHEMA_VERSION = 1;
export type AutomaticProcurementBlockingReason =
  | "MANAGER_LOCKED" | "MANAGER_UNAVAILABLE" | "SOURCE_UNAVAILABLE" | "FUNDS_PROTECTED" | null;

export interface AutomaticProcurementTargetState {
  readonly itemId: string;
  readonly targetQuantity: number;
  readonly waitingSinceUtcMs: number | null;
  readonly blockingReason: AutomaticProcurementBlockingReason;
}
export interface AutomaticProcurementRegionState {
  readonly regionId: string;
  readonly enabled: boolean;
  readonly targets: readonly AutomaticProcurementTargetState[];
}
export interface AutomaticProcurementState {
  readonly schemaVersion: typeof AUTOMATIC_PROCUREMENT_SCHEMA_VERSION;
  readonly revision: number;
  readonly reserveCopper: number;
  readonly regions: readonly AutomaticProcurementRegionState[];
  readonly lastReconciledAtUtcMs: number;
  readonly processedOperationIds: readonly string[];
}
export interface RestaurantManagerAvailability {
  readonly unlocked: boolean;
  readonly available: boolean;
  readonly characterId: InstanceId | null;
}
export interface RestaurantManagerAvailabilityPort {
  getAvailability(regionId: string, minuteOfDay: number): RestaurantManagerAvailability;
}
export interface AutomaticProcurementStockPort {
  getAvailableQuantity(regionId: string, itemId: string): number;
  getIncomingQuantity(regionId: string, itemId: string): number;
}
export interface AutomaticProcurementOrderRequest {
  readonly regionId: string; readonly itemId: string; readonly quantity: number;
  readonly minuteOfDay: number; readonly occurredAtUtcMs: number;
}
export interface AutomaticProcurementOrderPort {
  getAvailableCopper(): number;
  preview(request: AutomaticProcurementOrderRequest): {
    readonly accepted: boolean; readonly totalPriceCopper?: number; readonly message?: string;
  };
  place(operationId: string, request: AutomaticProcurementOrderRequest): {
    readonly accepted: boolean; readonly orderIds?: readonly string[]; readonly message?: string;
  };
}
export interface AutomaticProcurementReconcileRequest {
  readonly activeRegionId: string; readonly minuteOfDay: number; readonly occurredAtUtcMs: number;
}
export interface AutomaticProcurementCreatedOrder {
  readonly itemId: string; readonly quantity: number; readonly totalPriceCopper: number; readonly orderIds: readonly string[];
}
export type AutomaticProcurementRejectionCode = "INVALID_REQUEST" | "DUPLICATE_OPERATION" | "CLOCK_ROLLBACK";
export type AutomaticProcurementResult<T> =
  | { readonly accepted: true; readonly changed: boolean; readonly value: T; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly code: AutomaticProcurementRejectionCode; readonly message: string; readonly events: readonly [] };

const HISTORY_LIMIT = 2048;
const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const integer = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validMinute = (value: number): boolean => integer(value) && value < 1440;
const validReasons = new Set<AutomaticProcurementBlockingReason>([
  null, "MANAGER_LOCKED", "MANAGER_UNAVAILABLE", "SOURCE_UNAVAILABLE", "FUNDS_PROTECTED",
]);
const cloneTarget = (value: AutomaticProcurementTargetState): AutomaticProcurementTargetState => Object.freeze({ ...value });
const cloneRegion = (value: AutomaticProcurementRegionState): AutomaticProcurementRegionState =>
  Object.freeze({ ...value, targets: Object.freeze(value.targets.map(cloneTarget)) });
const cloneState = (value: AutomaticProcurementState): AutomaticProcurementState => Object.freeze({
  ...value,
  regions: Object.freeze(value.regions.map(cloneRegion)),
  processedOperationIds: Object.freeze([...value.processedOperationIds]),
});

export function isAutomaticProcurementState(value: unknown): value is AutomaticProcurementState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<AutomaticProcurementState>;
  if (state.schemaVersion !== AUTOMATIC_PROCUREMENT_SCHEMA_VERSION ||
    !integer(state.revision as number) || !integer(state.reserveCopper as number) ||
    !integer(state.lastReconciledAtUtcMs as number) || !Array.isArray(state.regions) ||
    !Array.isArray(state.processedOperationIds) ||
    state.processedOperationIds.some((id) => typeof id !== "string" || !validId(id)) ||
    new Set(state.processedOperationIds).size !== state.processedOperationIds.length) return false;
  const regionIds = new Set<string>();
  return state.regions.every((candidate) => {
    if (typeof candidate !== "object" || candidate === null) return false;
    const region = candidate as Partial<AutomaticProcurementRegionState>;
    if (typeof region.regionId !== "string" || !validId(region.regionId) || regionIds.has(region.regionId) ||
      typeof region.enabled !== "boolean" || !Array.isArray(region.targets)) return false;
    regionIds.add(region.regionId);
    const itemIds = new Set<string>();
    return region.targets.every((entry) => {
      if (typeof entry !== "object" || entry === null) return false;
      const target = entry as Partial<AutomaticProcurementTargetState>;
      if (typeof target.itemId !== "string" || !validId(target.itemId) || itemIds.has(target.itemId) ||
        !integer(target.targetQuantity as number) ||
        !(target.waitingSinceUtcMs === null || integer(target.waitingSinceUtcMs as number)) ||
        !validReasons.has(target.blockingReason as AutomaticProcurementBlockingReason)) return false;
      itemIds.add(target.itemId);
      return true;
    });
  });
}

export class EmploymentRestaurantManagerAvailabilityPort implements RestaurantManagerAvailabilityPort {
  constructor(private readonly employment: EmploymentModule) {}
  getAvailability(_regionId: string, minuteOfDay: number): RestaurantManagerAvailability {
    const managers = this.employment.createReadModel(minuteOfDay).employees
      .filter((entry) => entry.learnedJobIds.includes("job.restaurant_manager"));
    const active = managers.find((entry) =>
      entry.primaryJobId === "job.restaurant_manager" && entry.onShift &&
      entry.acceptingNewWork && entry.tags.includes("employee"));
    return Object.freeze({
      unlocked: managers.length > 0,
      available: active !== undefined,
      characterId: active?.characterId ?? null,
    });
  }
}

export class AutomaticProcurementModule implements DomainModule {
  readonly moduleId = AUTOMATIC_PROCUREMENT_MODULE_ID;
  #state: AutomaticProcurementState;

  constructor(
    private readonly managers: RestaurantManagerAvailabilityPort,
    private readonly stock: AutomaticProcurementStockPort,
    private readonly orders: AutomaticProcurementOrderPort,
    initialState?: AutomaticProcurementState,
  ) {
    this.#state = initialState === undefined
      ? cloneState({ schemaVersion: AUTOMATIC_PROCUREMENT_SCHEMA_VERSION, revision: 0, reserveCopper: 0, regions: [], lastReconciledAtUtcMs: 0, processedOperationIds: [] })
      : cloneState(initialState);
    if (!isAutomaticProcurementState(this.#state)) throw new Error("Automatic procurement state is invalid.");
  }

  exportState(): AutomaticProcurementState { return cloneState(this.#state); }
  getRegion(regionId: string): AutomaticProcurementRegionState | null {
    const value = this.#state.regions.find((entry) => entry.regionId === regionId);
    return value === undefined ? null : cloneRegion(value);
  }

  setReserveCopper(operationId: string, amount: number, time: number): AutomaticProcurementResult<number> {
    const issue = this.#issue(operationId, time);
    if (issue !== null || !integer(amount)) return issue ?? this.#reject("INVALID_REQUEST", "Invalid reserve.");
    if (amount === this.#state.reserveCopper) return this.#accept(amount, false);
    this.#replace({ reserveCopper: amount }, operationId);
    return this.#accept(amount, true, [this.#event(operationId, "automatic-procurement.reserve-changed", time, { reserveCopper: amount })]);
  }

  setRegionEnabled(operationId: string, regionId: string, enabled: boolean, time: number): AutomaticProcurementResult<AutomaticProcurementRegionState> {
    const issue = this.#issue(operationId, time);
    if (issue !== null || !validId(regionId)) return issue ?? this.#reject("INVALID_REQUEST", "Invalid region.");
    const current = this.getRegion(regionId) ?? cloneRegion({ regionId, enabled: false, targets: [] });
    if (current.enabled === enabled) return this.#accept(current, false);
    const value = cloneRegion({ ...current, enabled });
    this.#upsert(value, operationId);
    return this.#accept(value, true, [this.#event(operationId, "automatic-procurement.region-enabled-changed", time, { regionId, enabled })]);
  }

  setTarget(operationId: string, regionId: string, itemId: string, quantity: number, time: number): AutomaticProcurementResult<AutomaticProcurementTargetState> {
    const issue = this.#issue(operationId, time);
    if (issue !== null || !validId(regionId) || !validId(itemId) || !integer(quantity))
      return issue ?? this.#reject("INVALID_REQUEST", "Invalid target.");
    const region = this.getRegion(regionId) ?? cloneRegion({ regionId, enabled: false, targets: [] });
    const current = region.targets.find((entry) => entry.itemId === itemId);
    if (current !== undefined && current.targetQuantity === quantity) return this.#accept(current, false);
    const value = cloneTarget({
      itemId,
      targetQuantity: quantity,
      waitingSinceUtcMs: quantity === 0 ? null : current?.waitingSinceUtcMs ?? null,
      blockingReason: quantity === 0 ? null : current?.blockingReason ?? null,
    });
    this.#upsert(cloneRegion({
      ...region,
      targets: [...region.targets.filter((entry) => entry.itemId !== itemId), value].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    }), operationId);
    return this.#accept(value, true, [this.#event(operationId, "automatic-procurement.target-changed", time, { regionId, itemId, targetQuantity: quantity })]);
  }

  reconcile(operationId: string, request: AutomaticProcurementReconcileRequest): AutomaticProcurementResult<readonly AutomaticProcurementCreatedOrder[]> {
    const issue = this.#issue(operationId, request.occurredAtUtcMs);
    if (issue !== null || !validId(request.activeRegionId) || !validMinute(request.minuteOfDay))
      return issue ?? this.#reject("INVALID_REQUEST", "Invalid reconcile request.");
    if (request.occurredAtUtcMs < this.#state.lastReconciledAtUtcMs)
      return this.#reject("CLOCK_ROLLBACK", "Automatic procurement clock cannot move backwards.");
    const region = this.getRegion(request.activeRegionId);
    if (region === null || !region.enabled) {
      this.#replace({ lastReconciledAtUtcMs: request.occurredAtUtcMs }, operationId);
      return this.#accept(Object.freeze([]), true);
    }

    const manager = this.managers.getAvailability(region.regionId, request.minuteOfDay);
    const managerReason: AutomaticProcurementBlockingReason =
      !manager.unlocked ? "MANAGER_LOCKED" : !manager.available ? "MANAGER_UNAVAILABLE" : null;
    let targets = region.targets.map(cloneTarget);
    const candidates = targets.filter((target) => target.targetQuantity > 0).map((target) => {
      const available = this.#quantity(this.stock.getAvailableQuantity(region.regionId, target.itemId));
      const incoming = this.#quantity(this.stock.getIncomingQuantity(region.regionId, target.itemId));
      return { target, deficit: Math.max(0, target.targetQuantity - available - incoming), coverage: (available + incoming) / target.targetQuantity };
    }).sort((a, b) =>
      a.coverage - b.coverage ||
      (a.target.waitingSinceUtcMs ?? request.occurredAtUtcMs) - (b.target.waitingSinceUtcMs ?? request.occurredAtUtcMs) ||
      a.target.itemId.localeCompare(b.target.itemId));

    const created: AutomaticProcurementCreatedOrder[] = [];
    const events: DomainEvent[] = [];
    for (const candidate of candidates) {
      if (candidate.deficit === 0) {
        targets = this.#update(targets, candidate.target.itemId, null, null);
        continue;
      }
      const waiting = candidate.target.waitingSinceUtcMs ?? request.occurredAtUtcMs;
      if (managerReason !== null) {
        targets = this.#update(targets, candidate.target.itemId, waiting, managerReason);
        continue;
      }

      // Re-read stock and inbound immediately before ordering. Accepted placements must
      // become visible through getIncomingQuantity, which prevents duplicate orders.
      const available = this.#quantity(this.stock.getAvailableQuantity(region.regionId, candidate.target.itemId));
      const incoming = this.#quantity(this.stock.getIncomingQuantity(region.regionId, candidate.target.itemId));
      const deficit = Math.max(0, candidate.target.targetQuantity - available - incoming);
      if (deficit === 0) {
        targets = this.#update(targets, candidate.target.itemId, null, null);
        continue;
      }
      const full: AutomaticProcurementOrderRequest = Object.freeze({
        regionId: region.regionId, itemId: candidate.target.itemId, quantity: deficit,
        minuteOfDay: request.minuteOfDay, occurredAtUtcMs: request.occurredAtUtcMs,
      });
      const fullPreview = this.orders.preview(full);
      if (!fullPreview.accepted || !integer(fullPreview.totalPriceCopper as number) || fullPreview.totalPriceCopper === 0) {
        targets = this.#update(targets, candidate.target.itemId, waiting, "SOURCE_UNAVAILABLE");
        continue;
      }

      const spendable = Math.max(0, this.#quantity(this.orders.getAvailableCopper()) - this.#state.reserveCopper);
      const fullPrice = fullPreview.totalPriceCopper!;
      const estimatedUnitPrice = Math.ceil(fullPrice / deficit);
      let quantity = Math.min(deficit, Math.floor(spendable / estimatedUnitPrice));
      if (quantity === 0) {
        targets = this.#update(targets, candidate.target.itemId, waiting, "FUNDS_PROTECTED");
        continue;
      }
      let selected: AutomaticProcurementOrderRequest = quantity === deficit ? full : Object.freeze({ ...full, quantity });
      let preview = quantity === deficit ? fullPreview : this.orders.preview(selected);
      while (quantity > 0 && (!preview.accepted || !integer(preview.totalPriceCopper as number) || preview.totalPriceCopper! > spendable)) {
        quantity -= 1;
        if (quantity > 0) {
          selected = Object.freeze({ ...full, quantity });
          preview = this.orders.preview(selected);
        }
      }
      if (quantity === 0) {
        targets = this.#update(targets, candidate.target.itemId, waiting, "FUNDS_PROTECTED");
        continue;
      }
      const placed = this.orders.place(operationId + ":" + candidate.target.itemId, selected);
      if (!placed.accepted) {
        targets = this.#update(targets, candidate.target.itemId, waiting, "SOURCE_UNAVAILABLE");
        continue;
      }
      const order = Object.freeze({
        itemId: candidate.target.itemId,
        quantity,
        totalPriceCopper: preview.totalPriceCopper!,
        orderIds: Object.freeze([...(placed.orderIds ?? [])]),
      });
      created.push(order);
      targets = this.#update(targets, candidate.target.itemId, null, null);
      events.push(this.#event(operationId, "automatic-procurement.order-created", request.occurredAtUtcMs, {
        regionId: region.regionId, managerCharacterId: manager.characterId, ...order,
      }, candidate.target.itemId));
    }

    this.#upsert(cloneRegion({ ...region, targets }), operationId, { lastReconciledAtUtcMs: request.occurredAtUtcMs });
    return this.#accept(Object.freeze(created), true, events);
  }

  #quantity(value: number): number {
    if (!integer(value)) throw new Error("Automatic procurement port returned an invalid quantity.");
    return value;
  }
  #update(targets: readonly AutomaticProcurementTargetState[], itemId: string, waiting: number | null, reason: AutomaticProcurementBlockingReason): AutomaticProcurementTargetState[] {
    return targets.map((entry) => entry.itemId === itemId ? cloneTarget({ ...entry, waitingSinceUtcMs: waiting, blockingReason: reason }) : entry);
  }
  #issue(operationId: string, time: number): AutomaticProcurementResult<never> | null {
    if (!validId(operationId) || !integer(time)) return this.#reject("INVALID_REQUEST", "Invalid operation.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject("DUPLICATE_OPERATION", "Operation already processed.");
    return null;
  }
  #upsert(region: AutomaticProcurementRegionState, operationId: string, extra: Partial<AutomaticProcurementState> = {}): void {
    this.#replace({
      ...extra,
      regions: [...this.#state.regions.filter((entry) => entry.regionId !== region.regionId), region]
        .sort((a, b) => a.regionId.localeCompare(b.regionId)),
    }, operationId);
  }
  #replace(update: Partial<AutomaticProcurementState>, operationId: string): void {
    this.#state = cloneState({
      ...this.#state,
      ...update,
      revision: this.#state.revision + 1,
      processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-HISTORY_LIMIT),
    });
  }
  #event(operationId: string, type: string, time: number, payload: unknown, discriminator = "0"): DomainEvent {
    return Object.freeze({ id: type + ":" + operationId + ":" + discriminator, type, occurredAtUtcMs: time, causationId: operationId, correlationId: operationId, payload });
  }
  #accept<T>(value: T, changed: boolean, events: readonly DomainEvent[] = []): AutomaticProcurementResult<T> {
    return Object.freeze({ accepted: true, changed, value, events: Object.freeze([...events]) });
  }
  #reject(code: AutomaticProcurementRejectionCode, message: string): AutomaticProcurementResult<never> {
    return Object.freeze({ accepted: false, changed: false, code, message, events: [] as const });
  }
}
