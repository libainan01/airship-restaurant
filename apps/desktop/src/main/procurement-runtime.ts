import {
  M2_PROCUREMENT_REGIONS,
  M2_REMOTE_PROCUREMENT_ROUTES,
} from "@airship-restaurant/content";
import type {
  GameCommand,
  GameplayProcurementItemSnapshot,
  GameplayProcurementOrderSnapshot,
  ProcurementReadModel,
} from "@airship-restaurant/contracts";
import type {
  AutomaticProcurementModule,
  EmploymentModule,
  FleetModule,
  LocalProcurementModule,
  ProgressionModule,
  RuntimeCommandExtensionPort,
  RuntimeCommandExtensionResult,
} from "@airship-restaurant/core";

export interface ProcurementRuntimeClock {
  nowUtcMs(): number;
}

export class DesktopProcurementRuntime implements RuntimeCommandExtensionPort {
  readonly #procurement: LocalProcurementModule;
  readonly #automatic: AutomaticProcurementModule;
  readonly #fleet: FleetModule;
  readonly #employment: EmploymentModule;
  readonly #progression: ProgressionModule;
  readonly #clock: ProcurementRuntimeClock;
  readonly #onChanged: () => void;

  constructor(options: {
    readonly procurement: LocalProcurementModule;
    readonly automatic: AutomaticProcurementModule;
    readonly fleet: FleetModule;
    readonly employment: EmploymentModule;
    readonly progression: ProgressionModule;
    readonly clock: ProcurementRuntimeClock;
    readonly onChanged?: () => void;
  }) {
    this.#procurement = options.procurement;
    this.#automatic = options.automatic;
    this.#fleet = options.fleet;
    this.#employment = options.employment;
    this.#progression = options.progression;
    this.#clock = options.clock;
    this.#onChanged = options.onChanged ?? (() => undefined);
  }

  dispatch(command: GameCommand): RuntimeCommandExtensionResult {
    if (command.type === "gameplay.configure-procurement-automation") {
      const regionId = "region.greyfeather";
      const minuteOfDay = this.#minuteOfDay(this.#clock.nowUtcMs());
      const managers = this.#employment.createReadModel(minuteOfDay).employees
        .filter((employee) => employee.learnedJobIds.includes("job.restaurant_manager"));
      if (managers.length === 0) {
        return Object.freeze({ handled: true, accepted: false, message: "需要剧情关键角色取得餐厅管理员资格后才能配置自动补货。" });
      }
      const occurredAtUtcMs = this.#clock.nowUtcMs();
      const reserve = this.#automatic.setReserveCopper(command.id + ":reserve", command.payload.reserveCopper, occurredAtUtcMs);
      if (!reserve.accepted) return Object.freeze({ handled: true, accepted: false, message: reserve.message });
      const existing = this.#automatic.getRegion(regionId)?.targets ?? [];
      const desiredEnabled = command.payload.enabled ?? command.payload.policies.length > 0;
      const requested = new Map(command.payload.policies.map((policy) => [policy.itemId, policy.target]));
      for (const target of command.payload.policies.length === 0 ? [] : existing) {
        if (requested.has(target.itemId)) continue;
        const cleared = this.#automatic.setTarget(command.id + ":clear:" + target.itemId, regionId, target.itemId, 0, occurredAtUtcMs);
        if (!cleared.accepted) return Object.freeze({ handled: true, accepted: false, message: cleared.message });
      }
      for (const [itemId, target] of requested) {
        const configured = this.#automatic.setTarget(command.id + ":target:" + itemId, regionId, itemId, target, occurredAtUtcMs);
        if (!configured.accepted) return Object.freeze({ handled: true, accepted: false, message: configured.message });
      }
      const enabled = this.#automatic.setRegionEnabled(command.id + ":enabled", regionId, desiredEnabled, occurredAtUtcMs);
      if (!enabled.accepted) return Object.freeze({ handled: true, accepted: false, message: enabled.message });
      this.#onChanged();
      return Object.freeze({ handled: true, accepted: true, message: desiredEnabled ? "Automatic restocking configured." : "Automatic restocking disabled." });
    }
    if (command.type !== "gameplay.place-procurement-order") return Object.freeze({ handled: false });
    const occurredAtUtcMs = this.#clock.nowUtcMs();
    const result = this.#procurement.placeOrder(command.id, {
      recipeSelections: [],
      freeItems: command.payload.items,
      minuteOfDay: this.#minuteOfDay(occurredAtUtcMs),
      destinationRegionId: "region.greyfeather",
      occurredAtUtcMs,
    });
    if (!result.accepted) return Object.freeze({ handled: true, accepted: false, message: result.message });
    this.#onChanged();
    return Object.freeze({ handled: true, accepted: true, message: "Procurement order placed." });
  }

  getSnapshot(): ProcurementReadModel {
    const state = this.#procurement.exportState();
    const nowUtcMs = this.#clock.nowUtcMs();
    const fleet = this.#fleet.createReadModel(nowUtcMs);
    const localCapacity = Math.max(...state.carts.map((cart) => cart.capacity));
    const remoteCapacity = fleet.ships.length === 0 ? 1 : Math.max(...fleet.ships.map((ship) => ship.cargoCapacity));
    const regions = M2_PROCUREMENT_REGIONS.map((region) => {
      const route = M2_REMOTE_PROCUREMENT_ROUTES.find((entry) =>
        entry.originRegionId === "region.greyfeather" && entry.destinationRegionId === region.id,
      );
      const local = region.id === "region.greyfeather";
      const unlocked = local || (route !== undefined &&
        this.#progression.isContentUnlocked("region", region.id) &&
        this.#progression.isContentUnlocked("route", route.id));
      const fastestShip = fleet.ships.length === 0 ? null : [...fleet.ships].sort((a, b) => b.speedUnitsPerSecond - a.speedUnitsPerSecond)[0]!;
      const travelDurationMs = route === undefined || fastestShip === null
        ? 0
        : Math.ceil(route.roundTripDistanceUnits * 1_000 / fastestShip.speedUnitsPerSecond);
      return Object.freeze({
        id: region.id,
        name: region.name,
        unlocked,
        deliveryDurationMs: region.deliveryDurationMs + travelDurationMs,
        freightCostCopper: 0,
        cargoCapacity: local ? localCapacity : remoteCapacity,
        minimumTransportLevel: region.minimumTransportLevel,
        items: Object.freeze(region.items.map((item) => Object.freeze({ itemId: item.itemId, unitPriceCopper: item.unitPriceCopper }))),
      });
    });
    const activeOrders: GameplayProcurementOrderSnapshot[] = state.orders
      .filter((order) => order.status !== "completed")
      .map((order) => {
        const batches = state.batches.filter((batch) => batch.orderId === order.id);
        const activeArrivalTimes = batches.flatMap((batch) => batch.arrivesAtUtcMs === null || batch.status === "arrived" ? [] : [batch.arrivesAtUtcMs]);
        const departedTimes = batches.flatMap((batch) => batch.departedAtUtcMs === null ? [] : [batch.departedAtUtcMs]);
        return Object.freeze({
          id: order.id,
          regionId: order.sourceRegionId,
          status: order.status === "pending" ? "queued" as const : "in-transit" as const,
          items: Object.freeze(order.lines.map((line) => Object.freeze({ itemId: line.itemId, quantity: line.quantity }))),
          itemCostCopper: order.totalPriceCopper,
          freightCostCopper: 0,
          totalCostCopper: order.totalPriceCopper,
          createdAtUtcMs: order.createdAtUtcMs,
          departedAtUtcMs: departedTimes.length === 0 ? null : Math.min(...departedTimes),
          arriveAtUtcMs: activeArrivalTimes.length === 0 ? null : Math.min(...activeArrivalTimes),
        });
      });
    const incoming = new Map<string, number>();
    for (const batch of state.batches.filter((entry) => entry.status !== "arrived")) {
      for (const item of batch.items) incoming.set(item.itemId, (incoming.get(item.itemId) ?? 0) + item.quantity);
    }
    const milestones = state.batches.flatMap((batch) => {
      if (batch.status === "preparing") return [batch.preparationEndsAtUtcMs];
      if (batch.status === "in-transit" && batch.arrivesAtUtcMs !== null) return [batch.arrivesAtUtcMs];
      return [];
    }).filter((time) => time >= nowUtcMs);
    const completedOrders = state.orders.filter((order) => order.status === "completed" && order.completedAtUtcMs !== null)
      .sort((a, b) => b.completedAtUtcMs! - a.completedAtUtcMs!)
      .slice(0, 8);
    return Object.freeze({
      authority: "module.procurement" as const,
      sourceRevision: state.revision + fleet.revision,
      currentUtcMs: nowUtcMs,
      selectedRecipeId: null,
      procurement: Object.freeze({
        revision: state.revision,
        arrivalRevision: state.batches.filter((batch) => batch.status === "arrived").length,
        nextTransitionUtcMs: milestones.length === 0 ? null : Math.min(...milestones),
        regions: Object.freeze(regions),
        orders: Object.freeze(activeOrders),
        recentArrivals: Object.freeze(completedOrders.map((order) => Object.freeze({
          orderId: order.id,
          regionId: order.sourceRegionId,
          items: Object.freeze(order.lines.map((line): GameplayProcurementItemSnapshot => Object.freeze({ itemId: line.itemId, quantity: line.quantity }))),
          arrivedAtUtcMs: order.completedAtUtcMs!,
        }))),
        incomingItems: Object.freeze([...incoming.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([itemId, quantity]) => Object.freeze({ itemId, quantity }))),
        automation: (() => {
          const employees = this.#employment.createReadModel(this.#minuteOfDay(nowUtcMs)).employees;
          const managers = employees.filter((employee) => employee.learnedJobIds.includes("job.restaurant_manager"));
          const managerAvailable = managers.some((employee) => employee.primaryJobId === "job.restaurant_manager" && employee.onShift && employee.acceptingNewWork && employee.tags.includes("employee"));
          const region = this.#automatic.getRegion("region.greyfeather");
          return Object.freeze({
            unlocked: managers.length > 0,
            enabled: region?.enabled ?? false,
            managerAvailable,
            regionId: "region.greyfeather",
            reserveCopper: this.#automatic.exportState().reserveCopper,
            policies: Object.freeze((region?.targets ?? []).filter((target) => target.targetQuantity > 0)
              .map((target) => Object.freeze({ itemId: target.itemId, threshold: target.targetQuantity, target: target.targetQuantity, blockingReason: target.blockingReason }))),
          });
        })(),
      }),
    });
  }

  #minuteOfDay(utcMs: number): number {
    return Math.floor(utcMs / 60_000) % 1_440;
  }
}