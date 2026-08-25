import type { DomainEvent } from "./domain-event-bus";
import type { KernelCommand } from "./command-bus";

export interface ProcessManagerStateEnvelope<TState> {
  readonly managerId: string;
  readonly definitionId: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly state: TState;
  readonly processedEventIds: readonly string[];
}

export interface ProcessManagerTransition<TState> {
  readonly state: TState;
  readonly commands?: readonly KernelCommand[];
}

export interface ProcessManagerDefinition<TState> {
  readonly id: string;
  readonly schemaVersion: number;
  readonly createInitialState: () => TState;
  readonly transition: (
    state: TState,
    event: DomainEvent,
  ) => ProcessManagerTransition<TState> | null;
}

export interface ProcessManagerHandleResult<TState> {
  readonly duplicate: boolean;
  readonly changed: boolean;
  readonly commands: readonly KernelCommand[];
  readonly snapshot: ProcessManagerStateEnvelope<TState>;
}

export interface ProcessManagerOptions<TState> {
  readonly processedEventHistoryLimit?: number;
  readonly initialState?: ProcessManagerStateEnvelope<TState>;
}

export class ProcessManager<TState> {
  readonly #managerId: string;
  readonly #definition: ProcessManagerDefinition<TState>;
  readonly #processedEventHistoryLimit: number;
  readonly #processedEventIds = new Set<string>();
  readonly #processedEventHistory: string[] = [];
  #revision = 0;
  #state: TState;

  constructor(
    managerId: string,
    definition: ProcessManagerDefinition<TState>,
    options: ProcessManagerOptions<TState> = {},
  ) {
    if (managerId.length === 0 || definition.id.length === 0) {
      throw new Error("Process manager and definition ids must not be empty.");
    }
    if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion <= 0) {
      throw new RangeError("Process manager schema version must be positive.");
    }
    const historyLimit = options.processedEventHistoryLimit ?? 2_048;
    if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) {
      throw new RangeError("Process event history limit must be positive.");
    }
    this.#managerId = managerId;
    this.#definition = definition;
    this.#processedEventHistoryLimit = historyLimit;
    const restored = options.initialState;
    if (restored === undefined) {
      this.#state = definition.createInitialState();
      return;
    }
    if (
      restored.managerId !== managerId ||
      restored.definitionId !== definition.id ||
      restored.schemaVersion !== definition.schemaVersion
    ) {
      throw new Error("Process manager state does not match its definition.");
    }
    this.#revision = restored.revision;
    this.#state = restored.state;
    for (const eventId of restored.processedEventIds.slice(-historyLimit)) {
      this.#processedEventIds.add(eventId);
      this.#processedEventHistory.push(eventId);
    }
  }

  handle(event: DomainEvent): ProcessManagerHandleResult<TState> {
    if (this.#processedEventIds.has(event.id)) {
      return Object.freeze({
        duplicate: true,
        changed: false,
        commands: Object.freeze([]),
        snapshot: this.exportState(),
      });
    }
    const transition = this.#definition.transition(this.#state, event);
    this.#remember(event.id);
    this.#revision += 1;
    if (transition !== null) this.#state = transition.state;
    return Object.freeze({
      duplicate: false,
      changed: transition !== null,
      commands: Object.freeze([...(transition?.commands ?? [])]),
      snapshot: this.exportState(),
    });
  }

  exportState(): ProcessManagerStateEnvelope<TState> {
    return Object.freeze({
      managerId: this.#managerId,
      definitionId: this.#definition.id,
      schemaVersion: this.#definition.schemaVersion,
      revision: this.#revision,
      state: this.#state,
      processedEventIds: Object.freeze([...this.#processedEventHistory]),
    });
  }

  #remember(eventId: string): void {
    this.#processedEventIds.add(eventId);
    this.#processedEventHistory.push(eventId);
    if (
      this.#processedEventHistory.length <=
      this.#processedEventHistoryLimit
    ) {
      return;
    }
    const oldest = this.#processedEventHistory.shift();
    if (oldest !== undefined) this.#processedEventIds.delete(oldest);
  }
}
