import {
  type CharacterModule,
  type CustomerModule,
  type EmploymentModule,
  type InstanceId,
  type RestaurantApplicationProcessContext,
  type RestaurantApplicationProcessResult,
} from "@airship-restaurant/core";

const DEFAULT_ARRIVAL_INTERVAL_MS = 45_000;

function nextTransition(...values: readonly (number | null)[]): number | null {
  const concrete = values.filter((value): value is number => value !== null);
  return concrete.length === 0 ? null : Math.min(...concrete);
}

/**
 * Deterministic product customer source. Its durable cadence and last visitor
 * are derived from CustomerModule visits, so it does not introduce a second
 * persisted business state.
 */
export class DesktopCustomerArrivalRuntime {
  readonly #customers: CustomerModule;
  readonly #characters: CharacterModule;
  readonly #employment: EmploymentModule;
  readonly #candidateIds: readonly InstanceId[];
  readonly #sceneId: string;
  readonly #baseIntervalMs: number;
  #intervalRateBasisPoints = 10_000;
  #lastArrivalCycle = -1;

  constructor(options: {
    readonly customers: CustomerModule;
    readonly characters: CharacterModule;
    readonly employment: EmploymentModule;
    readonly candidateIds: readonly InstanceId[];
    readonly sceneId: string;
    readonly baseIntervalMs?: number;
  }) {
    const baseIntervalMs = options.baseIntervalMs ?? DEFAULT_ARRIVAL_INTERVAL_MS;
    if (options.candidateIds.length === 0 || new Set(options.candidateIds).size !== options.candidateIds.length ||
      options.sceneId.trim().length === 0 || !Number.isSafeInteger(baseIntervalMs) || baseIntervalMs <= 0) {
      throw new Error("Desktop customer arrival configuration is invalid.");
    }
    for (const characterId of options.candidateIds) {
      if (options.characters.getCharacter(characterId) === null) {
        throw new Error(`Desktop customer candidate is missing: ${characterId}`);
      }
    }
    this.#customers = options.customers;
    this.#characters = options.characters;
    this.#employment = options.employment;
    this.#candidateIds = Object.freeze([...options.candidateIds]);
    this.#sceneId = options.sceneId;
    this.#baseIntervalMs = baseIntervalMs;
  }

  setIntervalRateBasisPoints(rateBasisPoints: number): boolean {
    if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints <= 0 || rateBasisPoints > 100_000) {
      throw new RangeError("Customer arrival interval rate is invalid.");
    }
    if (this.#intervalRateBasisPoints === rateBasisPoints) return false;
    this.#intervalRateBasisPoints = rateBasisPoints;
    return true;
  }

  #hasAvailableWaiter(minuteOfDay: number): boolean {
    return this.#employment.exportState().records.some((record) => {
      const work = this.#employment.getWorkContext(record.characterId, {
        minuteOfDay,
        customerVisitActive: this.#customers.isCustomerVisitActive(record.characterId),
        voyageActive: false,
      });
      return work.tags.includes("employee") && work.learnedJobIds.includes("job.waiter");
    });
  }

  advance(context: RestaurantApplicationProcessContext): RestaurantApplicationProcessResult {
    const state = this.#customers.exportState();
    const active = state.visits.some((visit) => visit.phase !== "departed");
    if (active || this.#lastArrivalCycle === context.cycle) {
      return Object.freeze({ changed: false, nextTransitionUtcMs: null });
    }
    const intervalMs = Math.max(1, Math.ceil(
      this.#baseIntervalMs * this.#intervalRateBasisPoints / 10_000,
    ));
    const visitsByArrival = [...state.visits].sort((left, right) =>
      left.arrivedAtUtcMs - right.arrivedAtUtcMs || left.id.localeCompare(right.id));
    const latestVisit = visitsByArrival.at(-1);
    const dueAtUtcMs = latestVisit === undefined
      ? context.targetUtcMs
      : latestVisit.arrivedAtUtcMs + intervalMs;
    if (context.targetUtcMs < dueAtUtcMs) {
      return Object.freeze({ changed: false, nextTransitionUtcMs: dueAtUtcMs });
    }
    const minuteOfDay = Math.floor(context.targetUtcMs / 60_000) % 1_440;
    if (!this.#hasAvailableWaiter(minuteOfDay)) {
      return Object.freeze({
        changed: false,
        nextTransitionUtcMs: context.targetUtcMs + Math.min(intervalMs, 60_000),
      });
    }
    const latestCharacterId = latestVisit?.memberCharacterIds[0];
    const latestCandidateIndex = latestCharacterId === undefined
      ? -1
      : this.#candidateIds.indexOf(latestCharacterId);
    const startIndex = (latestCandidateIndex + 1) % this.#candidateIds.length;
    for (let offset = 0; offset < this.#candidateIds.length; offset += 1) {
      const characterId = this.#candidateIds[(startIndex + offset) % this.#candidateIds.length]!;
      if (this.#characters.getCharacter(characterId) === null || this.#customers.isCustomerVisitActive(characterId)) continue;
      const work = this.#employment.getWorkContext(characterId, {
        minuteOfDay,
        customerVisitActive: false,
        voyageActive: false,
      });
      if (work.tags.includes("employee") || work.voyageActive) continue;
      const visitKey = `${context.targetUtcMs}.${characterId.replace(/^instance\.character\./, "")}`;
      const arrived = this.#customers.arriveGroup(
        `${context.operationId}:arrival:${visitKey}`,
        {
          visitId: `visit.desktop.${visitKey}`,
          sceneId: this.#sceneId,
          memberCharacterIds: [characterId],
          minuteOfDay,
          arrivedAtUtcMs: context.targetUtcMs,
        },
      );
      if (!arrived.accepted) continue;
      this.#lastArrivalCycle = context.cycle;
      return Object.freeze({ changed: arrived.changed, nextTransitionUtcMs: null });
    }
    return Object.freeze({
      changed: false,
      nextTransitionUtcMs: nextTransition(dueAtUtcMs + intervalMs),
    });
  }
}