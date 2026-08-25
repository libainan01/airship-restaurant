import type { FinanceModule, FinanceSettlementLine } from "../modules";
import type {
  RestaurantFinancePort,
  RestaurantSaleSnapshot,
} from "../restaurant-system";

/** Records restaurant revenue directly in the authoritative finance ledger. */
export class FinanceRestaurantRevenuePort implements RestaurantFinancePort {
  readonly #finance: FinanceModule;
  readonly #incomeBonusRateBasisPoints: () => number;

  constructor(
    finance: FinanceModule,
    incomeBonusRateBasisPoints: () => number = () => 0,
  ) {
    this.#finance = finance;
    this.#incomeBonusRateBasisPoints = incomeBonusRateBasisPoints;
  }

  getSnapshot(): {
    readonly balanceCopper: number;
    readonly totalCopperSpent: number;
  } {
    const state = this.#finance.exportState();
    return Object.freeze({
      balanceCopper: state.balanceCopper,
      totalCopperSpent: state.ledger.reduce(
        (sum, entry) => sum + (entry.amountCopper < 0 ? -entry.amountCopper : 0),
        0,
      ),
    });
  }

  recordSale(sale: RestaurantSaleSnapshot): void {
    const operationId = `restaurant-sale:${sale.customerId}`;
    const batchId = `batch:${operationId}`;
    const bonusRate = this.#incomeBonusRateBasisPoints();
    if (!Number.isSafeInteger(bonusRate) || bonusRate < 0 || bonusRate > 10_000) {
      throw new Error("Restaurant focus income bonus rate is invalid.");
    }
    const source = {
      sourceType: "order",
      sourceId: sale.customerId,
      regionId: "region.restaurant",
    } as const;
    const lines: FinanceSettlementLine[] = [{
      ...source,
      entryId: `ledger:${operationId}`,
      amountCopper: sale.copperEarned,
      category: "dish-sales",
      occurredAtUtcMs: sale.soldAtUtcMs,
      note: `Dish sold: ${sale.dishItemId}`,
    }];
    const focusBonusCopper = Math.round(sale.copperEarned * bonusRate / 10_000);
    if (focusBonusCopper > 0) lines.push({
      ...source,
      entryId: `ledger:${operationId}:focus-bonus`,
      amountCopper: focusBonusCopper,
      category: "focus-bonus",
      occurredAtUtcMs: sale.soldAtUtcMs,
      note: `Focus bonus for dish: ${sale.dishItemId}`,
    });
    const result = this.#finance.settleBatch(
      operationId,
      batchId,
      operationId,
      lines,
      sale.soldAtUtcMs,
      source.sourceType,
      source.sourceId,
    );
    if (!result.accepted) {
      throw new Error(`Restaurant sale finance invariant failed: ${result.code}`);
    }
  }
}