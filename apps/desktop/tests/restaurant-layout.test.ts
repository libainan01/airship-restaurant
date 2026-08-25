import { describe, expect, it } from "vitest";
import {
  createDefaultRestaurantLayoutRuntime,
  DEFAULT_RESTAURANT_LAYOUT_DEFINITION,
  RestaurantLayoutRuntime,
} from "../src/renderer/desktop/restaurant-layout";

describe("restaurant layout runtime", () => {
  it("exposes stable visual instances and functional positions", () => {
    const layout = createDefaultRestaurantLayoutRuntime();

    expect(layout.getProps("table").map((prop) => prop.id)).toEqual([
      "prop.table.left",
      "prop.table.center",
      "prop.table.right",
    ]);
    expect(layout.requireAnchor("otto-pickup")).toMatchObject({
      id: "anchor.otto.pickup",
      parentPropId: "prop.counter.service",
    });
    expect(layout.getPositionSlots("seat")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "position.seat.center",
          parentPropId: "prop.table.center",
        }),
      ]),
    );
  });

  it("unlocks matching tables and seat slots as capacity increases", () => {
    const layout = createDefaultRestaurantLayoutRuntime();

    expect(layout.getProps("table")).toHaveLength(3);
    expect(layout.getPositionSlots("seat")).toHaveLength(3);

    layout.setSeatCapacity(4);
    expect(layout.getProps("table").map((prop) => prop.id)).toContain(
      "prop.table.expansion-1",
    );
    expect(layout.getPositionSlots("seat").map((slot) => slot.id)).toContain(
      "position.seat.expansion-1",
    );

    layout.setSeatCapacity(6);
    expect(layout.getProps("table")).toHaveLength(6);
    expect(layout.getPositionSlots("seat")).toHaveLength(6);
  });
  it("reserves and releases seat instances by actor id", () => {
    const layout = createDefaultRestaurantLayoutRuntime();
    const first = layout.reserveFirstAvailableSeat("npc.test.1");
    const second = layout.reserveFirstAvailableSeat("npc.test.2");

    expect(first?.slotId).toBe("position.seat.left");
    expect(second?.slotId).toBe("position.seat.center");
    expect(layout.getOccupant("position.seat.left")).toBe("npc.test.1");

    layout.releaseActor("npc.test.1");
    expect(layout.getOccupant("position.seat.left")).toBeNull();
    expect(layout.reserveFirstAvailableSeat("npc.test.3")?.slotId).toBe(
      "position.seat.left",
    );
  });

  it("moves actors atomically from seats into a conversation formation", () => {
    const layout = createDefaultRestaurantLayoutRuntime();
    layout.reservePosition("position.seat.left", "npc.left");
    layout.reservePosition("position.seat.center", "npc.center");

    const reservations = layout.reserveConversation("dialogue.test", [
      "npc.left",
      "npc.center",
    ]);

    expect(reservations.map((reservation) => reservation.slotId)).toEqual([
      "position.conversation.inner-left",
      "position.conversation.inner-right",
    ]);
    expect(layout.getOccupant("position.seat.left")).toBeNull();
    expect(layout.getOccupant("position.seat.center")).toBeNull();
    expect(
      layout.reserveFirstAvailableSeat("npc.waiting")?.slotId,
    ).toBe("position.seat.left");
    expect(layout.reserveFirstAvailableSeat("npc.blocked")?.slotId).toBe(
      "position.seat.right",
    );

    layout.releaseConversation("dialogue.test");
    expect(
      layout.getOccupant("position.conversation.inner-left"),
    ).toBeNull();
  });

  it("rejects functional positions that reference missing visual props", () => {
    expect(
      () =>
        new RestaurantLayoutRuntime({
          ...DEFAULT_RESTAURANT_LAYOUT_DEFINITION,
          layoutId: "restaurant.invalid",
          anchors: DEFAULT_RESTAURANT_LAYOUT_DEFINITION.anchors.map((anchor) =>
            anchor.role === "otto-home"
              ? { ...anchor, parentPropId: "prop.missing" }
              : anchor,
          ),
        }),
    ).toThrow(/references missing prop/);
  });
});