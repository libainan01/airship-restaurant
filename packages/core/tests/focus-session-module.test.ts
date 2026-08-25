import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  FocusSessionModule,
  isFocusSessionState,
} from "../src";

function setup() {
  return new FocusSessionModule({
    focusDurationMs: 100,
    breakDurationMs: 50,
    customerArrivalIntervalRateBasisPoints: 7_500,
    incomeBonusRateBasisPoints: 2_000,
  });
}

describe("FocusSessionModule", () => {
  it("starts immediately and exposes active customer-flow and income effects", () => {
    const module = setup();
    const result = module.requestStart("focus:start", 1_000, false);

    expect(result).toMatchObject({ accepted: true, changed: true });
    expect(result.accepted && result.events.map((event) => event.type)).toEqual([
      "focus-session.requested",
      "focus-session.started",
    ]);
    expect(module.createReadModel(1_025)).toMatchObject({
      phase: "focusing",
      remainingMs: 75,
      effects: {
        active: true,
        customerArrivalIntervalRateBasisPoints: 7_500,
        incomeBonusRateBasisPoints: 2_000,
      },
    });
  });

  it("waits for foreground dialogue and starts a full timer only after dialogue ends", () => {
    const module = setup();
    module.requestStart("focus:request", 1_000, true);
    expect(module.createReadModel(1_050)).toMatchObject({
      phase: "waiting-for-dialogue",
      phaseStartedAtUtcMs: null,
      remainingMs: null,
      effects: { active: false },
    });
    expect(module.advanceTo("focus:blocked", 1_100, true)).toMatchObject({ changed: false });

    const started = module.advanceTo("focus:dialogue-ended", 1_200, false);
    expect(started.accepted && started.events.map((event) => event.type)).toEqual([
      "focus-session.started",
    ]);
    expect(module.createReadModel(1_200)).toMatchObject({
      phase: "focusing",
      phaseStartedAtUtcMs: 1_200,
      phaseEndsAtUtcMs: 1_300,
      remainingMs: 100,
    });
  });

  it("completes focus and break deterministically even across a large time advance", () => {
    const module = setup();
    module.requestStart("focus:start", 1_000, false);
    const advanced = module.advanceTo("focus:advance", 1_200, false);

    expect(advanced.accepted && advanced.events.map((event) => event.type)).toEqual([
      "focus-session.completed",
      "focus-session.break-started",
      "focus-session.break-completed",
    ]);
    expect(module.createReadModel(1_200)).toMatchObject({
      phase: "idle",
      completedFocusCount: 1,
      effects: {
        active: false,
        customerArrivalIntervalRateBasisPoints: 10_000,
        incomeBonusRateBasisPoints: 0,
      },
    });
  });

  it("cancels waiting or active sessions and restores validated state", () => {
    const module = setup();
    module.requestStart("focus:wait", 1_000, true);
    expect(module.cancel("focus:cancel", 1_010)).toMatchObject({ accepted: true, changed: true });
    expect(module.createReadModel(1_010).phase).toBe("idle");

    module.requestStart("focus:again", 1_020, false);
    const state = module.exportState();
    expect(isFocusSessionState(state)).toBe(true);
    const restored = new FocusSessionModule({
      focusDurationMs: 100,
      breakDurationMs: 50,
      customerArrivalIntervalRateBasisPoints: 7_500,
      incomeBonusRateBasisPoints: 2_000,
    }, state);
    expect(restored.createReadModel(1_050)).toMatchObject({ phase: "focusing", remainingMs: 70 });
  });
  it("broadcasts lifecycle events for notification and audio adapters", () => {
    const eventBus = new DomainEventBus();
    const received: string[] = [];
    eventBus.subscribe("*", (event) => received.push(event.type));
    const module = new FocusSessionModule({
      focusDurationMs: 100,
      breakDurationMs: 50,
      customerArrivalIntervalRateBasisPoints: 7_500,
      incomeBonusRateBasisPoints: 2_000,
    }, undefined, eventBus);

    module.requestStart("focus:broadcast:start", 1_000, false);
    module.advanceTo("focus:broadcast:complete", 1_100, false);
    module.skipBreak("focus:broadcast:skip", 1_101);

    expect(received).toEqual([
      "focus-session.requested",
      "focus-session.started",
      "focus-session.completed",
      "focus-session.break-started",
      "focus-session.break-skipped",
    ]);
  });

});