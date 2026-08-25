import type {
  OperationsGameplayReadModel,
  OperationsReadModel,
} from "@airship-restaurant/contracts";
import {
  getManagementItemName,
  getManagementRecipeName,
  MANAGEMENT_RECIPES,
} from "../../management-content";

export const getRecipeName = getManagementRecipeName;

function formatRecipeDuration(durationMs: number): string {
  return durationMs < 60_000
    ? Math.ceil(durationMs / 1_000) + " 秒"
    : Math.ceil(durationMs / 60_000) + " 分钟";
}

export const OPERATIONS_RECIPES = MANAGEMENT_RECIPES.map((recipe) => ({
  id: recipe.id,
  name: recipe.name,
  duration: formatRecipeDuration(recipe.durationMs),
  yield: "每锅 " + recipe.outputQuantity + " 份",
  price: "每份 " + recipe.unitPriceCopper + " 铜币",
  ingredients: recipe.ingredients.map(
    (ingredient) =>
      getManagementItemName(ingredient.itemId) +
      " ×" +
      ingredient.quantity,
  ).join(" · "),
}));

export function getCookingStatus(
  gameplay: OperationsGameplayReadModel,
): string {
  const { cooking } = gameplay;
  if (cooking.activeJob?.status === "waiting-output") {
    return "出餐台已满，等待缆车取货";
  }
  if (cooking.activeJob !== null) {
    return "正在烹饪 " + getRecipeName(cooking.activeJob.recipeId);
  }
  if (cooking.blockedReason === "insufficient-ingredients") {
    return "原料不足，等待公会补给";
  }
  if (cooking.blockedReason === "output-capacity") {
    return "出餐台已满";
  }
  return "厨房待命";
}

export function getLogisticsStatus(
  gameplay: OperationsGameplayReadModel,
): string {
  switch (gameplay.logistics.phase) {
    case "outbound":
      return "载着热餐前往地面交换站";
    case "waiting-unload":
      return "餐厅仓库已满，等待卸货";
    case "returning":
      return "空箱返航中";
    case "idle":
      return gameplay.logistics.kitchenWaitingQuantity > 0
        ? "正在空中装卸站集货"
        : "停靠空中装卸站";
  }
}

export function getRestaurantStatusText(
  operations: OperationsReadModel,
): string {
  const customer = operations.gameplay?.restaurant.activeCustomer;
  if (customer !== null && customer !== undefined) {
    switch (customer.phase) {
      case "seated-idle":
        return "客人已经入座，正在看菜单或休息";
      case "awaiting-order-confirmation":
        return "客人正在招呼奥托确认点单";
      case "confirming-order":
        return "奥托正在与客人确认菜品";
      case "notifying-kitchen":
        return "订单正在发送至空中厨房";
      case "waiting-meal":
        return "正在准备 " + getRecipeName(customer.recipeId);
    }
  }
  const latest = operations.gameplay?.restaurant.recentSales.at(-1);
  if (latest === undefined) {
    return "还没有完成第一笔订单";
  }
  return getRecipeName(latest.recipeId) +
    " +" + latest.copperEarned + " 铜币";
}

export function formatOfflineDuration(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return Math.max(1, Math.floor(elapsedMs / 1_000)) + " 秒";
  }
  if (minutes < 60) {
    return minutes + " 分钟";
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes === 0
      ? hours + " 小时"
      : hours + " 小时 " + remainingMinutes + " 分钟";
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0
    ? days + " 天"
    : days + " 天 " + remainingHours + " 小时";
}

export function formatUtc(utcMs: number | null): string {
  return utcMs === null
    ? "无待处理事件"
    : new Date(utcMs).toISOString();
}
