import { describe, expect, it } from "vitest";
import {
  createFixedProcurementBatchPlans,
  projectProcurementOrderProgress,
} from "../src";

describe("shared procurement order rules", () => {
  it("freezes a deterministic multi-item split at order creation", () => {
    expect(createFixedProcurementBatchPlans([
      { itemId: "ingredient.tomato", quantity: 7 },
      { itemId: "ingredient.egg", quantity: 4 },
    ], 5)).toEqual([
      {
        sequence: 1,
        items: [{ itemId: "ingredient.tomato", quantity: 5 }],
        totalQuantity: 5,
        capacitySnapshot: 5,
      },
      {
        sequence: 2,
        items: [
          { itemId: "ingredient.tomato", quantity: 2 },
          { itemId: "ingredient.egg", quantity: 3 },
        ],
        totalQuantity: 5,
        capacitySnapshot: 5,
      },
      {
        sequence: 3,
        items: [{ itemId: "ingredient.egg", quantity: 1 }],
        totalQuantity: 1,
        capacitySnapshot: 5,
      },
    ]);
  });

  it("uses one progress rule for pending, fulfilling, partial and completed orders", () => {
    const batches = [
      { totalQuantity: 4, status: "waiting" as const },
      { totalQuantity: 4, status: "waiting" as const },
    ];
    expect(projectProcurementOrderProgress(8, batches, 100)).toEqual({
      deliveredQuantity: 0,
      status: "pending",
      completedAtUtcMs: null,
    });
    expect(projectProcurementOrderProgress(8, [
      { ...batches[0], status: "in-transit" },
      batches[1],
    ], 101)).toMatchObject({ deliveredQuantity: 0, status: "fulfilling" });
    expect(projectProcurementOrderProgress(8, [
      { ...batches[0], status: "arrived" },
      batches[1],
    ], 102)).toMatchObject({ deliveredQuantity: 4, status: "partial", completedAtUtcMs: null });
    expect(projectProcurementOrderProgress(8, [
      { ...batches[0], status: "arrived" },
      { ...batches[1], status: "arrived" },
    ], 103)).toEqual({ deliveredQuantity: 8, status: "completed", completedAtUtcMs: 103 });
  });

  it("rejects invalid or duplicated item plans before state mutation", () => {
    expect(() => createFixedProcurementBatchPlans([
      { itemId: "ingredient.egg", quantity: 1 },
      { itemId: "ingredient.egg", quantity: 2 },
    ], 3)).toThrow("invalid");
    expect(() => projectProcurementOrderProgress(5, [
      { totalQuantity: 4, status: "arrived" },
    ], 100)).toThrow("invalid");
  });
});
