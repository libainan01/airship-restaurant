import { describe, expect, it, vi } from "vitest";
import { GameRuntime, createInitialRuntimeState } from "../src";

describe("createInitialRuntimeState", () => {
  it("creates a deterministic boot state", () => {
    expect(createInitialRuntimeState(1_234)).toEqual({
      revision: 0,
      phase: "booting",
      runtimeStartedAtUtcMs: 1_234,
      quietMode: false,
    });
  });
});

describe("GameRuntime", () => {
  it("publishes a ready snapshot once", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const listener = vi.fn();
    runtime.subscribe(listener);

    expect(runtime.markReady()).toMatchObject({
      revision: 1,
      phase: "ready",
      runtimeStartedAtUtcMs: 5_000,
    });
    expect(runtime.markReady().revision).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("applies a typed command and broadcasts the new snapshot", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    const listener = vi.fn();
    runtime.markReady();
    runtime.subscribe(listener);

    const result = runtime.dispatch({
      id: "quiet-on",
      type: "settings.set-quiet-mode",
      payload: { enabled: true },
    });

    expect(result).toMatchObject({
      accepted: true,
      commandId: "quiet-on",
      snapshot: {
        revision: 2,
        settings: { quietMode: true },
      },
    });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rejects duplicate command ids without changing state", () => {
    const runtime = new GameRuntime({ nowUtcMs: () => 5_000 });
    runtime.markReady();

    const command = {
      id: "quiet-on",
      type: "settings.set-quiet-mode",
      payload: { enabled: true },
    } as const;

    runtime.dispatch(command);
    const duplicate = runtime.dispatch(command);

    expect(duplicate).toMatchObject({
      accepted: false,
      commandId: "quiet-on",
      code: "DUPLICATE_COMMAND",
      snapshot: { revision: 2 },
    });
  });
});
