import type {
  GameplayCookingSnapshot,
  GameplayProcurementSnapshot,
} from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import {
  observeProcurementArrival,
  resolveAirshipStatusLabel,
  resolveDesktopQuietMode,
  resolvePortStatusLabel,
  resolveRestaurantStatusLabel,
  resolveRuntimePhaseLabel,
} from "../src/renderer/desktop/desktop-world-presenter";

const IDLE_COOKING: GameplayCookingSnapshot = {
  selectedRecipeId: "recipe.hearth_flatbread",
  autoRepeat: true,
  activeJob: null,
  blockedReason: null,
  completedBatches: 3,
  nextTransitionUtcMs: null,
};

function createProcurement(
  arrivalRevision: number,
): GameplayProcurementSnapshot {
  return {
    revision: arrivalRevision,
    arrivalRevision,
    nextTransitionUtcMs: null,
    regions: [{
      id: "region.local",
      name: "灰羽港",
      unlocked: true,
      deliveryDurationMs: 15_000,
      freightCostCopper: 0,
      cargoCapacity: 12,
      minimumTransportLevel: 0,
      items: [{
        itemId: "ingredient.cloud_wheat",
        unitPriceCopper: 1,
      }],
    }],
    orders: [],
    recentArrivals: arrivalRevision === 0 ? [] : [{
      orderId: "order-1",
      regionId: "region.local",
      items: [
        { itemId: "ingredient.cloud_wheat", quantity: 4 },
        { itemId: "ingredient.kettle_milk", quantity: 2 },
      ],
      arrivedAtUtcMs: 20_000,
    }],
    incomingItems: [],
    automation: {
      unlocked: false,
      reserveCopper: 0,
      policies: [],
    },
  };
}

describe("desktop world procurement presentation", () => {
  it("does not announce restored arrivals during initial hydration", () => {
    expect(
      observeProcurementArrival(null, createProcurement(1)),
    ).toEqual({ revision: 1, message: null });
  });

  it("announces only a newer arrival revision", () => {
    expect(
      observeProcurementArrival(0, createProcurement(1)),
    ).toEqual({
      revision: 1,
      message: "灰羽港采购到货 · 6 格食材已入库",
    });
    expect(
      observeProcurementArrival(1, createProcurement(1)).message,
    ).toBeNull();
  });

  it("summarizes active port orders", () => {
    const procurement = createProcurement(0);
    expect(resolvePortStatusLabel({
      ...procurement,
      orders: [{
        id: "order-1",
        regionId: "region.local",
        status: "queued",
        items: [{ itemId: "ingredient.cloud_wheat", quantity: 1 }],
        itemCostCopper: 1,
        freightCostCopper: 0,
        totalCostCopper: 1,
        createdAtUtcMs: 0,
        departedAtUtcMs: null,
        arriveAtUtcMs: null,
      }],
    })).toBe("港口运输中 · 1 批");
  });
});

describe("desktop world status labels", () => {
  const getRecipeName = (recipeId: string | null): string =>
    recipeId === null ? "未选菜" : "云麦饼";

  it("prioritizes hover and kitchen notifications", () => {
    expect(resolveAirshipStatusLabel({
      hovered: true,
      quietMode: false,
      cooking: IDLE_COOKING,
      kitchenNotification: null,
      getRecipeName,
    })).toBe("云灶号运转中 · 工程台可查看升级");

    expect(resolveAirshipStatusLabel({
      hovered: false,
      quietMode: false,
      cooking: IDLE_COOKING,
      kitchenNotification: {
        customerId: "customer-1",
        recipeId: "recipe.hearth_flatbread",
        channelId: "channel-1",
        phase: "received",
      },
      getRecipeName,
    })).toBe("云麦饼 · 白夜城正在备餐");
  });

  it("describes quiet idle and restaurant business state", () => {
    expect(resolveAirshipStatusLabel({
      hovered: false,
      quietMode: true,
      cooking: null,
      kitchenNotification: null,
      getRecipeName,
    })).toBe("安静模式 · 炉火低声运转");

    expect(resolveRestaurantStatusLabel({
      hovered: false,
      quietMode: false,
      stockQuantity: 5,
      restaurant: {
        totalSoldQuantity: 12,
        copperBalance: 48,
      },
    })).toBe("库存 5 份 · 累计售出 12 份 · 48 铜币");
  });

  it("formats booting and ready runtime phases", () => {
    expect(resolveRuntimePhaseLabel("booting", 2, null))
      .toBe("世界正在启动");
    expect(resolveRuntimePhaseLabel("ready", 3, 9))
      .toBe("世界在线 · 经营修订 9");
  });

  it("derives quiet mode without letting either source overwrite the other", () => {
    expect(resolveDesktopQuietMode(false, "normal")).toBe(false);
    expect(resolveDesktopQuietMode(true, "normal")).toBe(true);
    expect(resolveDesktopQuietMode(false, "quiet")).toBe(true);
    expect(resolveDesktopQuietMode(true, "reduced")).toBe(true);
  });
});
