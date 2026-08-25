import { describe, expect, it, vi } from "vitest";
import {
  CommandBus,
  DomainEventBus,
  RuntimeReadModelFacade,
  ProcessManager,
  TransactionScope,
  type DomainEvent,
  type TransactionParticipantSession,
  type TransactionalParticipant,
} from "../src";
import { GameRuntime } from "../src";

interface CounterContext {
  value: number;
}

function isAmountPayload(value: unknown): value is { readonly amount: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "amount" in value &&
    typeof value.amount === "number"
  );
}

class TransactionalBalance implements TransactionalParticipant {
  readonly transactionParticipantId: string;
  #committed: number;
  #staged: number | null = null;

  constructor(id: string, initialBalance: number) {
    this.transactionParticipantId = id;
    this.#committed = initialBalance;
  }

  get balance(): number {
    return this.#committed;
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#staged !== null) throw new Error("Transaction already active.");
    const checkpoint = this.#committed;
    this.#staged = this.#committed;
    return {
      validateTransaction: () => {
        if (this.#staged === null || this.#staged < 0) {
          throw new Error("Balance cannot become negative.");
        }
      },
      commitTransaction: () => {
        if (this.#staged === null) throw new Error("No staged balance.");
        this.#committed = this.#staged;
        this.#staged = null;
      },
      rollbackTransaction: () => {
        this.#committed = checkpoint;
        this.#staged = null;
      },
    };
  }

  add(amount: number): void {
    if (this.#staged === null) throw new Error("No active transaction.");
    this.#staged += amount;
  }
}

function event(id: string, type = "test.changed"): DomainEvent {
  return {
    id,
    type,
    occurredAtUtcMs: 1_000,
    payload: { id },
  };
}

describe("CommandBus", () => {
  it("routes validated commands and distinguishes no-change, rejection, duplicate, and unknown", () => {
    const context: CounterContext = { value: 0 };
    const bus = new CommandBus<CounterContext>();
    bus.register("counter.add", {
      validatePayload: isAmountPayload,
      handle: (command, target) => {
        if (command.payload.amount > 5) {
          return { accepted: false, code: "LIMIT", message: "Too large." };
        }
        target.value += command.payload.amount;
        return {
          accepted: true,
          changed: command.payload.amount !== 0,
          value: target.value,
        };
      },
    });

    expect(bus.dispatch(null, context)).toMatchObject({
      accepted: false,
      code: "INVALID_COMMAND",
      commandId: null,
    });
    expect(bus.dispatch({ id: "unknown", type: "missing", payload: {} }, context)).toMatchObject({
      accepted: false,
      code: "UNKNOWN_COMMAND",
    });
    expect(bus.dispatch({ id: "bad", type: "counter.add", payload: {} }, context)).toMatchObject({
      accepted: false,
      code: "INVALID_COMMAND",
    });
    expect(bus.dispatch({ id: "add", type: "counter.add", payload: { amount: 2 } }, context)).toMatchObject({
      accepted: true,
      changed: true,
      value: 2,
    });
    expect(bus.dispatch({ id: "noop", type: "counter.add", payload: { amount: 0 } }, context)).toMatchObject({
      accepted: true,
      changed: false,
      value: 2,
    });
    expect(bus.dispatch({ id: "reject", type: "counter.add", payload: { amount: 6 } }, context)).toMatchObject({
      accepted: false,
      code: "LIMIT",
    });
    expect(bus.dispatch({ id: "add", type: "counter.add", payload: { amount: 2 } }, context)).toMatchObject({
      accepted: false,
      code: "DUPLICATE_COMMAND",
    });
    expect(context.value).toBe(2);
  });
});

describe("TransactionScope and DomainEventBus", () => {
  it("commits all participants before publishing buffered events", () => {
    const publishedBalances: number[] = [];
    const bus = new DomainEventBus();
    const source = new TransactionalBalance("source", 10);
    const target = new TransactionalBalance("target", 0);
    bus.subscribe("money.transferred", () => {
      publishedBalances.push(source.balance, target.balance);
    });
    const transaction = new TransactionScope(bus);

    const result = transaction.run([source, target], ({ emit }) => {
      source.add(-4);
      target.add(4);
      expect(publishedBalances).toEqual([]);
      emit(event("transfer-1", "money.transferred"));
      return "done";
    });

    expect(result).toEqual({ value: "done", committedEventIds: ["transfer-1"] });
    expect([source.balance, target.balance]).toEqual([6, 4]);
    expect(publishedBalances).toEqual([6, 4]);
  });

  it("rolls every participant back and publishes nothing when validation fails", () => {
    const listener = vi.fn();
    const bus = new DomainEventBus();
    bus.subscribe("money.transferred", listener);
    const source = new TransactionalBalance("source", 3);
    const target = new TransactionalBalance("target", 0);
    const transaction = new TransactionScope(bus);

    expect(() => transaction.run([source, target], ({ emit }) => {
      source.add(-4);
      target.add(4);
      emit(event("transfer-invalid", "money.transferred"));
    })).toThrow("Balance cannot become negative");
    expect([source.balance, target.balance]).toEqual([3, 0]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rolls back an earlier commit when a later participant commit fails", () => {
    const bus = new DomainEventBus();
    const source = new TransactionalBalance("source", 5);
    const failingParticipant: TransactionalParticipant = {
      transactionParticipantId: "failing",
      beginTransaction: () => ({
        validateTransaction: () => undefined,
        commitTransaction: () => {
          throw new Error("commit failed");
        },
        rollbackTransaction: () => undefined,
      }),
    };

    expect(() => new TransactionScope(bus).run(
      [source, failingParticipant],
      () => source.add(-2),
    )).toThrow("commit failed");
    expect(source.balance).toBe(5);
  });

  it("validates every buffered event before committing state", () => {
    const balance = new TransactionalBalance("balance", 5);
    expect(() => new TransactionScope(new DomainEventBus()).run(
      [balance],
      ({ emit }) => {
        balance.add(-2);
        emit({ id: "", type: "invalid", occurredAtUtcMs: 1, payload: {} });
      },
    )).toThrow("must not be empty");
    expect(balance.balance).toBe(5);
  });

  it("deduplicates events and isolates subscriber errors", () => {
    const failures: unknown[] = [];
    const received: string[] = [];
    const bus = new DomainEventBus({
      onSubscriberError: (failure) => failures.push(failure.error),
    });
    bus.subscribe("test.changed", () => {
      throw new Error("broken listener");
    });
    bus.subscribe("*", (published) => received.push(published.id));

    expect(bus.publishAll([event("event-1"), event("event-1")])).toEqual({
      publishedEventIds: ["event-1"],
      duplicateEventIds: ["event-1"],
      subscriberErrorCount: 1,
    });
    expect(received).toEqual(["event-1"]);
    expect(failures).toHaveLength(1);
  });
});

describe("ProcessManager", () => {
  it("persists stable progress and ignores a restored duplicate event", () => {
    const definition = {
      id: "delivery-process",
      schemaVersion: 1,
      createInitialState: () => ({ delivered: 0 }),
      transition: (state: { readonly delivered: number }, published: DomainEvent) =>
        published.type === "cargo.arrived"
          ? {
              state: { delivered: state.delivered + 1 },
              commands: [{
                id: `store-${published.id}`,
                type: "inventory.store",
                payload: published.payload,
              }],
            }
          : null,
    };
    const first = new ProcessManager("delivery-1", definition);
    const handled = first.handle(event("cargo-1", "cargo.arrived"));
    expect(handled).toMatchObject({
      duplicate: false,
      changed: true,
      commands: [{ id: "store-cargo-1", type: "inventory.store" }],
      snapshot: { revision: 1, state: { delivered: 1 } },
    });

    const restored = new ProcessManager("delivery-1", definition, {
      initialState: JSON.parse(JSON.stringify(first.exportState())),
    });
    expect(restored.handle(event("cargo-1", "cargo.arrived"))).toMatchObject({
      duplicate: true,
      changed: false,
      commands: [],
      snapshot: { revision: 1, state: { delivered: 1 } },
    });
  });
});

describe("RuntimeReadModelFacade", () => {
  it("routes commands and publishes independent read-model slices without owning state", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const facade = new RuntimeReadModelFacade(runtime);
    const desktopWorldListener = vi.fn();
    facade.subscribe(
      "desktop-world",
      desktopWorldListener,
      { emitCurrent: true },
    );
    runtime.markReady();

    expect(facade.get("desktop-world")).toMatchObject({
      key: "desktop-world",
      revision: 1,
      value: {
        sourceRevision: 1,
        phase: "ready",
        gameplay: null,
      },
    });
    expect(facade.get("operations")).toMatchObject({
      key: "operations",
      value: { sourceRevision: 1, gameplay: null },
    });
    expect(facade.get("procurement")).toMatchObject({
      key: "procurement",
      value: { procurement: null },
    });
    expect(facade.get("finance")).toMatchObject({
      key: "finance",
      value: { balanceCopper: 0, availableCopper: 0 },
    });

    expect(facade.dispatch({
      id: "compat-quiet",
      type: "settings.set-quiet-mode",
      payload: { enabled: true },
    })).toMatchObject({ accepted: true });
    expect(runtime.getSnapshot()).toMatchObject({
      revision: 2,
      settings: { quietMode: true },
    });
    expect(desktopWorldListener).toHaveBeenCalledTimes(3);
    expect(desktopWorldListener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: "desktop-world",
        revision: 2,
        value: expect.objectContaining({ quietMode: true }),
      }),
    );
  });

  it("projects an external story roster only into the operations slice", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const roster = Object.freeze({
      revision: 2,
      characters: Object.freeze([
        Object.freeze({
          characterId: "character.martha_bell",
          identity: "玛莎·贝尔",
          affinity: 4,
          relationshipTierId: "new",
          completedNodeCount: 0,
          totalNodeCount: 1,
          nodes: Object.freeze([
            Object.freeze({
              id: "story_node.martha_bell.first_service",
              status: "available" as const,
              hint: "她似乎还在等一道熟悉的菜。",
              summary: null,
              rewardContentIds: Object.freeze([]),
            }),
          ]),
        }),
      ]),
    });
    const facade = new RuntimeReadModelFacade(
      runtime,
      null,
      null,
      null,
      null,
      { getSnapshot: () => roster },
    );

    expect(facade.get("operations")).toMatchObject({
      key: "operations",
      value: {
        storyRoster: {
          revision: 2,
          characters: [{ identity: "玛莎·贝尔", affinity: 4 }],
        },
      },
    });
    expect(facade.get("desktop-world").value).not.toHaveProperty("storyRoster");
  });
});
