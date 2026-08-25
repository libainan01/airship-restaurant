export type ProcurementOrderStatus = "pending" | "fulfilling" | "partial" | "completed";
export type ProcurementBatchStatus = "preparing" | "waiting" | "in-transit" | "arrived";
export type ProcurementOrderOrigin = "manual" | "automatic";

export interface ProcurementItemQuantity {
  readonly itemId: string;
  readonly quantity: number;
}

export interface FixedProcurementBatchPlan {
  readonly sequence: number;
  readonly items: readonly ProcurementItemQuantity[];
  readonly totalQuantity: number;
  readonly capacitySnapshot: number;
}

export interface ProcurementOrderProgressBatch {
  readonly totalQuantity: number;
  readonly status: ProcurementBatchStatus;
}

export interface ProcurementOrderProgress {
  readonly deliveredQuantity: number;
  readonly status: ProcurementOrderStatus;
  readonly completedAtUtcMs: number | null;
}

const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Creates a deterministic, immutable split once when an order is submitted.
 * Later vehicle upgrades never reshape these plans.
 */
export function createFixedProcurementBatchPlans(
  items: readonly ProcurementItemQuantity[],
  capacitySnapshot: number,
): readonly FixedProcurementBatchPlan[] {
  if (!positiveInteger(capacitySnapshot) || items.length === 0 ||
      items.some((item) => !validId(item.itemId) || !positiveInteger(item.quantity)) ||
      new Set(items.map((item) => item.itemId)).size !== items.length) {
    throw new TypeError("Procurement batch planning input is invalid.");
  }
  const remaining = items.map((item) => ({ ...item }));
  const batches: FixedProcurementBatchPlan[] = [];
  while (remaining.some((item) => item.quantity > 0)) {
    let capacity = capacitySnapshot;
    const batchItems: ProcurementItemQuantity[] = [];
    for (const item of remaining) {
      if (capacity === 0 || item.quantity === 0) continue;
      const quantity = Math.min(capacity, item.quantity);
      batchItems.push(Object.freeze({ itemId: item.itemId, quantity }));
      item.quantity -= quantity;
      capacity -= quantity;
    }
    batches.push(Object.freeze({
      sequence: batches.length + 1,
      items: Object.freeze(batchItems),
      totalQuantity: batchItems.reduce((sum, item) => sum + item.quantity, 0),
      capacitySnapshot,
    }));
  }
  return Object.freeze(batches);
}

/** Shared status rule for local carts and remote Fleet batches. */
export function projectProcurementOrderProgress(
  totalQuantity: number,
  batches: readonly ProcurementOrderProgressBatch[],
  occurredAtUtcMs: number,
): ProcurementOrderProgress {
  if (!positiveInteger(totalQuantity) || !Number.isSafeInteger(occurredAtUtcMs) || occurredAtUtcMs < 0 ||
      batches.length === 0 || batches.some((batch) => !positiveInteger(batch.totalQuantity)) ||
      batches.reduce((sum, batch) => sum + batch.totalQuantity, 0) !== totalQuantity) {
    throw new TypeError("Procurement order progress input is invalid.");
  }
  const deliveredQuantity = batches
    .filter((batch) => batch.status === "arrived")
    .reduce((sum, batch) => sum + batch.totalQuantity, 0);
  const status: ProcurementOrderStatus = deliveredQuantity === totalQuantity
    ? "completed"
    : deliveredQuantity > 0
      ? "partial"
      : batches.some((batch) => batch.status === "in-transit")
        ? "fulfilling"
        : "pending";
  return Object.freeze({
    deliveredQuantity,
    status,
    completedAtUtcMs: status === "completed" ? occurredAtUtcMs : null,
  });
}
