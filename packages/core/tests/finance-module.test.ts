import { describe, expect, it, vi } from "vitest";
import {
  DomainEventBus,
  FinanceModule,
  TransactionScope,
  type TransactionalParticipant,
} from "../src";

const source = {
  sourceType: "building-preview",
  sourceId: "preview.test",
  regionId: "region.greyfeather",
};

describe("FinanceModule", () => {
  it("reserves available funds, releases them, and converts a reservation into one immutable expense", () => {
    const finance = new FinanceModule(1_000);
    expect(finance.reserveFunds("reserve-a", "reservation.a", 700, source, 10)).toMatchObject({
      accepted: true,
      value: { amountCopper: 700 },
    });
    expect(finance.getSnapshot()).toMatchObject({
      balanceCopper: 1_000,
      reservedCopper: 700,
      availableCopper: 300,
    });
    expect(finance.reserveFunds("reserve-b", "reservation.b", 400, source, 11)).toMatchObject({
      accepted: false,
      code: "INSUFFICIENT_FUNDS",
    });
    expect(finance.releaseReservation("release-a", "reservation.a", 12)).toMatchObject({
      accepted: true,
    });
    expect(finance.reserveFunds("reserve-c", "reservation.c", 800, source, 13)).toMatchObject({
      accepted: true,
    });
    expect(finance.commitReservation(
      "commit-c",
      "reservation.c",
      "ledger.building-c",
      "building-purchase",
      14,
      800,
    )).toMatchObject({ accepted: true });
    expect(finance.getSnapshot()).toMatchObject({
      balanceCopper: 200,
      reservedCopper: 0,
      availableCopper: 200,
      ledger: [{ id: "ledger.building-c", amountCopper: -800 }],
    });
  });

  it("posts active expenses safely but allows mandatory wages to make the balance negative", () => {
    const finance = new FinanceModule(100);
    expect(finance.payExpense("repair", {
      entryId: "ledger.repair",
      amountCopper: 80,
      category: "equipment-repair",
      occurredAtUtcMs: 20,
      ...source,
    })).toMatchObject({ accepted: true });
    expect(finance.payExpense("procurement", {
      entryId: "ledger.procurement",
      amountCopper: 30,
      category: "ingredient-procurement",
      occurredAtUtcMs: 21,
      ...source,
    })).toMatchObject({ accepted: false, code: "INSUFFICIENT_FUNDS" });
    expect(finance.postMandatoryExpense("wages", {
      entryId: "ledger.wages",
      amountCopper: 50,
      category: "employee-wages",
      occurredAtUtcMs: 22,
      ...source,
    })).toMatchObject({ accepted: true });
    expect(finance.getSnapshot().balanceCopper).toBe(-30);
  });

  it("settles a source key once even when retried with a different operation id", () => {
    const finance = new FinanceModule(0);
    const lines = [
      {
        entryId: "ledger.order.sales",
        amountCopper: 120,
        category: "dish-sales" as const,
        occurredAtUtcMs: 30,
        sourceType: "order",
        sourceId: "order.1",
        regionId: "region.greyfeather",
      },
      {
        entryId: "ledger.order.tip",
        amountCopper: 12,
        category: "tips" as const,
        occurredAtUtcMs: 30,
        sourceType: "order",
        sourceId: "order.1",
        regionId: "region.greyfeather",
      },
    ];
    const first = finance.settleBatch(
      "settle-1",
      "batch.order-1",
      "order:order.1",
      lines,
      30,
      "order",
      "order.1",
    );
    expect(first).toMatchObject({ accepted: true, changed: true });
    expect(first.accepted && first.events.map((event) => event.id)).toHaveLength(5);
    expect(new Set(first.accepted ? first.events.map((event) => event.id) : [])).toHaveLength(5);

    expect(finance.settleBatch(
      "settle-retry",
      "batch.order-duplicate",
      "order:order.1",
      lines,
      31,
      "order",
      "order.1",
    )).toMatchObject({ accepted: true, changed: false, value: { id: "batch.order-1" } });
    expect(finance.getSnapshot()).toMatchObject({ balanceCopper: 132 });
    expect(finance.getSnapshot().ledger).toHaveLength(2);
  });

  it("closes a day once, includes mandatory expenses, and derives a historical statement from the ledger", () => {
    const finance = new FinanceModule(100);
    finance.postIncome("income", {
      entryId: "ledger.sale",
      amountCopper: 80,
      category: "dish-sales",
      occurredAtUtcMs: 40,
      sourceType: "order",
      sourceId: "order.2",
      regionId: "region.greyfeather",
    });
    const closed = finance.closeDay("close-day-1", 1, 2, 50, [{
      entryId: "ledger.daily-wage",
      amountCopper: 120,
      category: "employee-wages",
      ...source,
    }]);
    expect(closed).toMatchObject({
      accepted: true,
      value: {
        openingBalanceCopper: 100,
        totalIncomeCopper: 80,
        totalExpenseCopper: 120,
        netCopper: -40,
        closingBalanceCopper: 60,
      },
    });
    expect(finance.closeDay("close-day-again", 1, 2, 51)).toMatchObject({
      accepted: false,
      code: "DAY_MISMATCH",
    });
    expect(new FinanceModule(0, 1, finance.exportState()).getSnapshot()).toMatchObject({
      balanceCopper: 60,
      currentGameDay: 2,
      currentDayOpeningBalanceCopper: 60,
    });
  });

  it("rolls balance, ledger, reservation, and operation id back when a coordinated transaction fails", () => {
    const bus = new DomainEventBus();
    const listener = vi.fn();
    bus.subscribe("*", listener);
    const finance = new FinanceModule(500);
    const failing: TransactionalParticipant = {
      transactionParticipantId: "test.failing",
      beginTransaction: () => ({
        validateTransaction: () => { throw new Error("building validation failed"); },
        commitTransaction: () => undefined,
        rollbackTransaction: () => undefined,
      }),
    };

    expect(() => new TransactionScope(bus).run([finance, failing], ({ emit }) => {
      const result = finance.reserveFunds("reserve-rollback", "reservation.rollback", 200, source, 60);
      if (!result.accepted) throw new Error(result.message);
      result.events.forEach(emit);
    })).toThrow("building validation failed");
    expect(finance.getSnapshot()).toMatchObject({
      balanceCopper: 500,
      reservedCopper: 0,
      revision: 0,
    });
    expect(listener).not.toHaveBeenCalled();
    expect(finance.reserveFunds("reserve-rollback", "reservation.rollback", 200, source, 60)).toMatchObject({
      accepted: true,
    });
  });
});
