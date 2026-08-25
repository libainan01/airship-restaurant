import type { GameplayLogisticsSnapshot } from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import { resolveCableCarPresentation } from "../src/renderer/desktop/cable-car-renderer";

const IDLE_LOGISTICS: GameplayLogisticsSnapshot = {
  phase: "idle",
  shipmentId: null,
  departedAtUtcMs: null,
  arriveAtUtcMs: null,
  returnStartedAtUtcMs: null,
  returnAtUtcMs: null,
  kitchenWaitingSinceUtcMs: null,
  kitchenWaitingQuantity: 0,
  cargoQuantity: 0,
  totalDeliveredQuantity: 0,
  nextTransitionUtcMs: null,
};

function resolve(
  logistics: GameplayLogisticsSnapshot | undefined,
  nowUtcMs = 1_500,
) {
  return resolveCableCarPresentation({
    logistics,
    animationTimeMs: 0,
    motionScale: 1,
    nowUtcMs,
  });
}

describe("cable car presentation", () => {
  it("provides a deterministic ground-station preview", () => {
    expect(resolve(undefined)).toEqual({
      progress: 1,
      isDescending: false,
      status: "地面站 · 正在卸货",
    });
  });

  it("tracks an outbound shipment", () => {
    expect(resolve({
      ...IDLE_LOGISTICS,
      phase: "outbound",
      shipmentId: "shipment-1",
      departedAtUtcMs: 1_000,
      arriveAtUtcMs: 2_000,
      cargoQuantity: 4,
    })).toEqual({
      progress: 0.5,
      isDescending: true,
      status: "配送中 · 4/6 份",
    });
  });

  it("holds at the restaurant while waiting to unload", () => {
    expect(resolve({
      ...IDLE_LOGISTICS,
      phase: "waiting-unload",
      cargoQuantity: 6,
    })).toEqual({
      progress: 1,
      isDescending: true,
      status: "等待卸货 · 6/6 份",
    });
  });

  it("tracks an empty returning car", () => {
    expect(resolve({
      ...IDLE_LOGISTICS,
      phase: "returning",
      returnStartedAtUtcMs: 1_000,
      returnAtUtcMs: 2_000,
    })).toEqual({
      progress: 0.5,
      isDescending: false,
      status: "空箱返航",
    });
  });

  it("shows kitchen cargo waiting at the airship", () => {
    expect(resolve({
      ...IDLE_LOGISTICS,
      kitchenWaitingQuantity: 3,
    })).toEqual({
      progress: 0,
      isDescending: false,
      status: "空中集货 · 3 份",
    });
  });
});
