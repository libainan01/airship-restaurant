import type { GameplayRestaurantEventSnapshot } from "@airship-restaurant/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopRestaurantAudioFeedback,
  type RestaurantAudioPort,
} from "../src/renderer/desktop/restaurant-event-audio";

function event(id: string, type: GameplayRestaurantEventSnapshot["type"]): GameplayRestaurantEventSnapshot {
  if (type === "customer.arrived") {
    return { id, type, customer: { id: "customer.1" } } as GameplayRestaurantEventSnapshot;
  }
  if (type === "order.fulfilled") {
    return { id, type, sale: { id: "sale.1" } } as GameplayRestaurantEventSnapshot;
  }
  return {
    id,
    type: "customer.left",
    customerId: "customer.1",
    recipeId: "recipe.1",
    leftAtUtcMs: 1,
    reason: "wait-timeout",
  };
}

describe("DesktopRestaurantAudioFeedback", () => {
  it("does not replay hydrated events and plays only newly observed cues", () => {
    const port: RestaurantAudioPort = {
      unlock: vi.fn(async () => undefined),
      play: vi.fn(),
      destroy: vi.fn(),
    };
    const feedback = new DesktopRestaurantAudioFeedback(port);
    feedback.observe([event("arrival.1", "customer.arrived")], { quiet: false, procurementArrived: false });
    expect(port.play).not.toHaveBeenCalled();

    feedback.observe([
      event("arrival.1", "customer.arrived"),
      event("sale.1", "order.fulfilled"),
    ], { quiet: false, procurementArrived: true });
    expect(port.play).toHaveBeenNthCalledWith(1, "served");
    expect(port.play).toHaveBeenNthCalledWith(2, "procurement");

    feedback.observe([
      event("arrival.1", "customer.arrived"),
      event("sale.1", "order.fulfilled"),
    ], { quiet: false, procurementArrived: false });
    expect(port.play).toHaveBeenCalledTimes(2);
  });

  it("marks quiet-mode events as seen instead of replaying them later", () => {
    const port: RestaurantAudioPort = {
      unlock: vi.fn(async () => undefined),
      play: vi.fn(),
      destroy: vi.fn(),
    };
    const feedback = new DesktopRestaurantAudioFeedback(port);
    feedback.observe([], { quiet: false, procurementArrived: false });
    feedback.observe([event("arrival.1", "customer.arrived")], { quiet: true, procurementArrived: true });
    feedback.observe([event("arrival.1", "customer.arrived")], { quiet: false, procurementArrived: false });
    expect(port.play).not.toHaveBeenCalled();
  });
});
