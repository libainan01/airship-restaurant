export interface NarrativeDishSalesFact {
  readonly dishItemId: string;
  readonly quantity: number;
}

export interface NarrativeGameplayFacts {
  readonly soldByDish: readonly NarrativeDishSalesFact[];
}

export interface OnlineDishSalesCondition {
  readonly type: "online-dish-sales";
  readonly dishItemId: string;
  readonly quantity: number;
}

export type NarrativeCondition = OnlineDishSalesCondition;

export interface NarrativeEventConfig {
  readonly id: string;
  readonly priority: number;
  readonly prerequisiteEventIds: readonly string[];
  readonly conditions: readonly NarrativeCondition[];
}

export interface NarrativeConditionProgressSnapshot {
  readonly type: NarrativeCondition["type"];
  readonly current: number;
  readonly required: number;
}

export interface NarrativeEventSnapshot {
  readonly eventId: string;
  readonly status: "locked" | "available" | "completed";
  readonly unread: boolean;
  readonly unlockedAtUtcMs: number | null;
  readonly viewedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
  readonly conditions: readonly NarrativeConditionProgressSnapshot[];
}

export interface NarrativeSnapshot {
  readonly revision: number;
  readonly availableEventIds: readonly string[];
  readonly unreadEventIds: readonly string[];
  readonly events: readonly NarrativeEventSnapshot[];
}

export interface NarrativeEventState {
  readonly eventId: string;
  readonly conditionProgress: readonly number[];
  readonly unlockedAtUtcMs: number | null;
  readonly viewedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
}

export interface NarrativeSystemState {
  readonly version: 1;
  readonly revision: number;
  readonly events: readonly NarrativeEventState[];
}

export interface NarrativeAdvanceResult {
  readonly changed: boolean;
  readonly unlockedEventIds: readonly string[];
  readonly snapshot: NarrativeSnapshot;
}

export type NarrativeActionResult =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly snapshot: NarrativeSnapshot;
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly message: string;
      readonly snapshot: NarrativeSnapshot;
    };

interface MutableNarrativeEventState {
  readonly eventId: string;
  readonly conditionProgress: number[];
  unlockedAtUtcMs: number | null;
  viewedAtUtcMs: number | null;
  completedAtUtcMs: number | null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function assertUtcMs(value: number): void {
  if (!isNonNegativeInteger(value)) {
    throw new RangeError(
      "Narrative timestamps must be non-negative safe integers.",
    );
  }
}

function factsToMap(
  facts: NarrativeGameplayFacts,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const sale of facts.soldByDish) {
    if (
      sale.dishItemId.length === 0 ||
      !isNonNegativeInteger(sale.quantity) ||
      result.has(sale.dishItemId)
    ) {
      throw new Error("Narrative gameplay facts are invalid.");
    }
    result.set(sale.dishItemId, sale.quantity);
  }
  return result;
}

function cloneState(
  state: MutableNarrativeEventState,
): NarrativeEventState {
  return Object.freeze({
    eventId: state.eventId,
    conditionProgress: Object.freeze([...state.conditionProgress]),
    unlockedAtUtcMs: state.unlockedAtUtcMs,
    viewedAtUtcMs: state.viewedAtUtcMs,
    completedAtUtcMs: state.completedAtUtcMs,
  });
}

export function isNarrativeSystemState(
  value: unknown,
): value is NarrativeSystemState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("revision" in value) ||
    !isNonNegativeInteger(value.revision) ||
    !("events" in value) ||
    !Array.isArray(value.events)
  ) {
    return false;
  }

  return value.events.every((event) => {
    if (
      typeof event !== "object" ||
      event === null ||
      !("eventId" in event) ||
      typeof event.eventId !== "string" ||
      event.eventId.length === 0 ||
      !("conditionProgress" in event) ||
      !Array.isArray(event.conditionProgress) ||
      !event.conditionProgress.every(isNonNegativeInteger)
    ) {
      return false;
    }
    for (const field of [
      "unlockedAtUtcMs",
      "viewedAtUtcMs",
      "completedAtUtcMs",
    ] as const) {
      if (
        !(field in event) ||
        (event[field] !== null && !isNonNegativeInteger(event[field]))
      ) {
        return false;
      }
    }
    return (
      event.unlockedAtUtcMs !== null ||
      (event.viewedAtUtcMs === null && event.completedAtUtcMs === null)
    );
  });
}

export class NarrativeSystem {
  readonly #events: readonly NarrativeEventConfig[];
  readonly #states = new Map<string, MutableNarrativeEventState>();
  #revision = 0;

  constructor(
    events: readonly NarrativeEventConfig[],
    initialState?: NarrativeSystemState,
  ) {
    const ids = new Set<string>();
    for (const event of events) {
      if (
        event.id.length === 0 ||
        ids.has(event.id) ||
        !Number.isSafeInteger(event.priority) ||
        event.conditions.length === 0
      ) {
        throw new Error(`Invalid narrative event config: ${event.id}`);
      }
      ids.add(event.id);
      for (const condition of event.conditions) {
        if (
          condition.type !== "online-dish-sales" ||
          condition.dishItemId.length === 0 ||
          !Number.isSafeInteger(condition.quantity) ||
          condition.quantity <= 0
        ) {
          throw new Error(
            `Invalid narrative condition in event: ${event.id}`,
          );
        }
      }
    }
    for (const event of events) {
      const prerequisites = new Set<string>();
      for (const prerequisiteId of event.prerequisiteEventIds) {
        if (
          prerequisiteId === event.id ||
          !ids.has(prerequisiteId) ||
          prerequisites.has(prerequisiteId)
        ) {
          throw new Error(
            `Invalid narrative prerequisite in event: ${event.id}`,
          );
        }
        prerequisites.add(prerequisiteId);
      }
    }

    this.#events = Object.freeze(
      [...events]
        .sort(
          (left, right) =>
            left.priority - right.priority ||
            left.id.localeCompare(right.id),
        )
        .map((event) =>
          Object.freeze({
            ...event,
            prerequisiteEventIds: Object.freeze([
              ...event.prerequisiteEventIds,
            ]),
            conditions: Object.freeze(
              event.conditions.map((condition) =>
                Object.freeze({ ...condition }),
              ),
            ),
          }),
        ),
    );

    if (initialState !== undefined) {
      this.#restore(initialState);
      return;
    }
    for (const event of this.#events) {
      this.#states.set(event.id, {
        eventId: event.id,
        conditionProgress: event.conditions.map(() => 0),
        unlockedAtUtcMs: null,
        viewedAtUtcMs: null,
        completedAtUtcMs: null,
      });
    }
  }

  getSnapshot(): NarrativeSnapshot {
    const events = this.#events.map((event) => {
      const state = this.#getState(event.id);
      const status =
        state.completedAtUtcMs !== null
          ? "completed"
          : state.unlockedAtUtcMs !== null
            ? "available"
            : "locked";
      return Object.freeze({
        eventId: event.id,
        status,
        unread:
          state.unlockedAtUtcMs !== null &&
          state.viewedAtUtcMs === null,
        unlockedAtUtcMs: state.unlockedAtUtcMs,
        viewedAtUtcMs: state.viewedAtUtcMs,
        completedAtUtcMs: state.completedAtUtcMs,
        conditions: Object.freeze(
          event.conditions.map((condition, index) =>
            Object.freeze({
              type: condition.type,
              current: state.conditionProgress[index] ?? 0,
              required: condition.quantity,
            }),
          ),
        ),
      } satisfies NarrativeEventSnapshot);
    });
    return Object.freeze({
      revision: this.#revision,
      availableEventIds: Object.freeze(
        events
          .filter((event) => event.status === "available")
          .map((event) => event.eventId),
      ),
      unreadEventIds: Object.freeze(
        events
          .filter((event) => event.unread)
          .map((event) => event.eventId),
      ),
      events: Object.freeze(events),
    });
  }

  exportState(): NarrativeSystemState {
    return Object.freeze({
      version: 1,
      revision: this.#revision,
      events: Object.freeze(
        this.#events.map((event) =>
          cloneState(this.#getState(event.id)),
        ),
      ),
    });
  }

  observeOnline(
    before: NarrativeGameplayFacts,
    after: NarrativeGameplayFacts,
    atUtcMs: number,
  ): NarrativeAdvanceResult {
    assertUtcMs(atUtcMs);
    const beforeSales = factsToMap(before);
    const afterSales = factsToMap(after);
    let changed = false;

    for (const event of this.#events) {
      const state = this.#getState(event.id);
      if (state.completedAtUtcMs !== null) {
        continue;
      }
      event.conditions.forEach((condition, index) => {
        const previous = beforeSales.get(condition.dishItemId) ?? 0;
        const current = afterSales.get(condition.dishItemId) ?? 0;
        if (current < previous) {
          throw new Error(
            `Narrative fact "${condition.dishItemId}" moved backwards.`,
          );
        }
        const delta = current - previous;
        if (delta === 0) {
          return;
        }
        const oldProgress = state.conditionProgress[index] ?? 0;
        const newProgress = Math.min(
          condition.quantity,
          oldProgress + delta,
        );
        if (newProgress !== oldProgress) {
          state.conditionProgress[index] = newProgress;
          changed = true;
        }
      });
    }

    const unlockedEventIds = this.#unlockEligible(atUtcMs);
    if (unlockedEventIds.length > 0) {
      changed = true;
    }
    if (changed) {
      this.#revision += 1;
    }
    return Object.freeze({
      changed,
      unlockedEventIds: Object.freeze(unlockedEventIds),
      snapshot: this.getSnapshot(),
    });
  }

  markViewed(
    eventId: string,
    atUtcMs: number,
  ): NarrativeActionResult {
    assertUtcMs(atUtcMs);
    const state = this.#states.get(eventId);
    if (state === undefined || state.unlockedAtUtcMs === null) {
      return this.#reject(`Narrative event is not available: ${eventId}`);
    }
    if (state.viewedAtUtcMs !== null) {
      return this.#accept(false);
    }
    state.viewedAtUtcMs = atUtcMs;
    this.#revision += 1;
    return this.#accept(true);
  }

  complete(
    eventId: string,
    atUtcMs: number,
  ): NarrativeActionResult {
    assertUtcMs(atUtcMs);
    const state = this.#states.get(eventId);
    if (state === undefined || state.unlockedAtUtcMs === null) {
      return this.#reject(`Narrative event is not available: ${eventId}`);
    }
    if (state.completedAtUtcMs !== null) {
      return this.#accept(false);
    }
    state.viewedAtUtcMs ??= atUtcMs;
    state.completedAtUtcMs = atUtcMs;
    this.#revision += 1;
    const unlocked = this.#unlockEligible(atUtcMs);
    if (unlocked.length > 0) {
      this.#revision += 1;
    }
    return this.#accept(true);
  }

  #unlockEligible(atUtcMs: number): string[] {
    const unlocked: string[] = [];
    for (const event of this.#events) {
      const state = this.#getState(event.id);
      if (
        state.unlockedAtUtcMs !== null ||
        !event.conditions.every(
          (condition, index) =>
            (state.conditionProgress[index] ?? 0) >=
            condition.quantity,
        ) ||
        !event.prerequisiteEventIds.every(
          (prerequisiteId) =>
            this.#getState(prerequisiteId).completedAtUtcMs !== null,
        )
      ) {
        continue;
      }
      state.unlockedAtUtcMs = atUtcMs;
      unlocked.push(event.id);
    }
    return unlocked;
  }

  #restore(initialState: NarrativeSystemState): void {
    if (!isNarrativeSystemState(initialState)) {
      throw new Error("Narrative restore state is invalid.");
    }
    const restoredById = new Map<string, NarrativeEventState>();
    for (const restored of initialState.events) {
      if (restoredById.has(restored.eventId)) {
        throw new Error(
          `Narrative restore state repeats event: ${restored.eventId}`,
        );
      }
      restoredById.set(restored.eventId, restored);
    }
    for (const event of this.#events) {
      const restored = restoredById.get(event.id);
      if (restored === undefined) {
        this.#states.set(event.id, {
          eventId: event.id,
          conditionProgress: event.conditions.map(() => 0),
          unlockedAtUtcMs: null,
          viewedAtUtcMs: null,
          completedAtUtcMs: null,
        });
        continue;
      }
      if (
        restored.conditionProgress.length !== event.conditions.length ||
        restored.conditionProgress.some(
          (progress, index) =>
            progress > (event.conditions[index]?.quantity ?? 0),
        )
      ) {
        throw new Error(
          `Narrative restore state does not match event: ${event.id}`,
        );
      }
      this.#states.set(event.id, {
        eventId: event.id,
        conditionProgress: [...restored.conditionProgress],
        unlockedAtUtcMs: restored.unlockedAtUtcMs,
        viewedAtUtcMs: restored.viewedAtUtcMs,
        completedAtUtcMs: restored.completedAtUtcMs,
      });
    }
    this.#revision = initialState.revision;
  }

  #getState(eventId: string): MutableNarrativeEventState {
    const state = this.#states.get(eventId);
    if (state === undefined) {
      throw new Error(`Unknown narrative event: ${eventId}`);
    }
    return state;
  }

  #accept(changed: boolean): NarrativeActionResult {
    return Object.freeze({
      accepted: true,
      changed,
      snapshot: this.getSnapshot(),
    });
  }

  #reject(message: string): NarrativeActionResult {
    return Object.freeze({
      accepted: false,
      changed: false,
      message,
      snapshot: this.getSnapshot(),
    });
  }
}
