import { describe, expect, it, vi } from "vitest";
import {
  RestaurantApplicationRuntime,
  isRestaurantApplicationRuntimeState,
  type RestaurantApplicationProcess,
  type RestaurantApplicationProcessContext,
} from "../src/runtime/restaurant-application-runtime";

function process(
  id: string,
  advance: (
    context: RestaurantApplicationProcessContext,
  ) => { readonly changed: boolean; readonly nextTransitionUtcMs: number | null },
): RestaurantApplicationProcess {
  return { id, advance };
}

describe("RestaurantApplicationRuntime", () => {
  it("runs processes in stable id order until the domain graph is quiescent", () => {
    const calls: string[] = [];
    let sourceReady = false;
    let consumerCompleted = false;
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 100,
      processes: [
        process("source", (context) => {
          calls.push(`source:${context.round}`);
          if (sourceReady) {
            return { changed: false, nextTransitionUtcMs: 500 };
          }
          sourceReady = true;
          return { changed: true, nextTransitionUtcMs: 500 };
        }),
        process("consumer", (context) => {
          calls.push(`consumer:${context.round}`);
          if (!sourceReady || consumerCompleted) {
            return { changed: false, nextTransitionUtcMs: null };
          }
          consumerCompleted = true;
          return { changed: true, nextTransitionUtcMs: null };
        }),
      ],
    });

    const result = runtime.advanceTo(200);

    expect(result.changed).toBe(true);
    expect(result.businessChanged).toBe(true);
    expect(result.clockRollbackDetected).toBe(false);
    expect(result.convergenceRounds).toBe(3);
    expect(calls).toEqual([
      "consumer:1",
      "source:1",
      "consumer:2",
      "source:2",
      "consumer:3",
      "source:3",
    ]);
    expect(result.snapshot).toEqual({
      revision: 1,
      currentUtcMs: 200,
      nextTransitionUtcMs: 500,
      processes: [
        { id: "consumer", nextTransitionUtcMs: null },
        { id: "source", nextTransitionUtcMs: 500 },
      ],
    });
  });

  it("uses a new synchronization cycle for repeated work at the same time", () => {
    const operationIds: string[] = [];
    let pendingChanges = 1;
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 100,
      processes: [
        process("orders", (context) => {
          operationIds.push(context.operationId);
          const changed = pendingChanges > 0;
          pendingChanges = 0;
          return { changed, nextTransitionUtcMs: null };
        }),
      ],
    });

    expect(runtime.advanceTo(100).changed).toBe(true);
    pendingChanges = 1;
    expect(runtime.advanceTo(100).changed).toBe(true);

    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(runtime.getSnapshot().revision).toBe(2);
  });

  it("distinguishes pure clock progress from business changes", () => {
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 100,
      processes: [process("idle", () => ({ changed: false, nextTransitionUtcMs: null }))],
    });

    const result = runtime.advanceTo(200);

    expect(result.changed).toBe(true);
    expect(result.businessChanged).toBe(false);
    expect(result.snapshot.currentUtcMs).toBe(200);
  });
  it("ignores clock rollback without invoking domain processes", () => {
    const advance = vi.fn(() => ({
      changed: false,
      nextTransitionUtcMs: null,
    }));
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 100,
      processes: [process("orders", advance)],
    });

    const result = runtime.advanceTo(99);

    expect(result.changed).toBe(false);
    expect(result.businessChanged).toBe(false);
    expect(result.clockRollbackDetected).toBe(true);
    expect(result.convergenceRounds).toBe(0);
    expect(advance).not.toHaveBeenCalled();
    expect(result.snapshot.currentUtcMs).toBe(100);
  });

  it("rejects duplicated process ids and non-converging process graphs", () => {
    const duplicate = process("orders", () => ({
      changed: false,
      nextTransitionUtcMs: null,
    }));
    expect(
      () =>
        new RestaurantApplicationRuntime({
          startUtcMs: 0,
          processes: [duplicate, duplicate],
        }),
    ).toThrow("invalid or duplicated");

    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 0,
      maximumConvergenceRounds: 2,
      processes: [
        process("loop", () => ({
          changed: true,
          nextTransitionUtcMs: null,
        })),
      ],
    });
    expect(() => runtime.advanceTo(1)).toThrow(
      "did not converge within 2 rounds",
    );
  });

  it("rejects invalid process results before publishing runtime state", () => {
    const runtime = new RestaurantApplicationRuntime({
      startUtcMs: 0,
      processes: [
        process("invalid", () => ({
          changed: false,
          nextTransitionUtcMs: -1,
        })),
      ],
    });

    expect(() => runtime.advanceTo(1)).toThrow(
      "returned an invalid result",
    );
    expect(runtime.getSnapshot()).toMatchObject({
      revision: 0,
      currentUtcMs: 0,
    });
  });

  it("round-trips coordination state and preserves operation cycles", () => {
    const originalCycles: number[] = [];
    const restoredCycles: number[] = [];
    const original = new RestaurantApplicationRuntime({
      startUtcMs: 100,
      processes: [
        process("orders", (context) => {
          originalCycles.push(context.cycle);
          return { changed: false, nextTransitionUtcMs: 500 };
        }),
      ],
    });
    original.advanceTo(200);
    const serialized = JSON.parse(JSON.stringify(original.exportState()));
    expect(isRestaurantApplicationRuntimeState(serialized)).toBe(true);

    const restored = new RestaurantApplicationRuntime({
      startUtcMs: 999,
      initialState: serialized,
      processes: [
        process("orders", (context) => {
          restoredCycles.push(context.cycle);
          return { changed: false, nextTransitionUtcMs: 500 };
        }),
      ],
    });

    expect(restored.getSnapshot()).toEqual(original.getSnapshot());
    original.advanceTo(300);
    restored.advanceTo(300);
    expect(restored.exportState()).toEqual(original.exportState());
    expect(originalCycles).toEqual([1, 2]);
    expect(restoredCycles).toEqual([2]);
  });

  it("rejects invalid restore state and a mismatched process manifest", () => {
    const source = new RestaurantApplicationRuntime({
      startUtcMs: 100,
      processes: [process("orders", () => ({ changed: false, nextTransitionUtcMs: 500 }))],
    });
    source.advanceTo(200);
    const state = source.exportState();
    expect(isRestaurantApplicationRuntimeState({
      ...state,
      processes: [{ id: "orders", nextTransitionUtcMs: 199 }],
    })).toBe(false);

    expect(() => new RestaurantApplicationRuntime({
      startUtcMs: 200,
      initialState: state,
      processes: [process("service", () => ({ changed: false, nextTransitionUtcMs: null }))],
    })).toThrow("process manifest does not match");
  });});
