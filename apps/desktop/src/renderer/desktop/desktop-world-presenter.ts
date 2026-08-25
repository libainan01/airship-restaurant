import type {
  GameplayCookingSnapshot,
  GameplayProcurementSnapshot,
  GameplayRestaurantSnapshot,
  PresentationMode,
  RuntimePhase,
} from "@airship-restaurant/contracts";
import type { RestaurantKitchenNotificationPresentation } from "./restaurant-npc-presentation";

export type DesktopHoveredZone = "airship" | "restaurant" | null;

export interface ProcurementArrivalObservation {
  readonly revision: number;
  readonly message: string | null;
}

export function resolveRuntimePhaseLabel(
  phase: RuntimePhase,
  snapshotRevision: number,
  gameplayRevision: number | null,
): string {
  return phase === "ready"
    ? "世界在线 · 经营修订 " +
        (gameplayRevision ?? snapshotRevision)
    : "世界正在启动";
}

export function observeProcurementArrival(
  previousRevision: number | null,
  procurement: GameplayProcurementSnapshot | undefined,
): ProcurementArrivalObservation {
  const revision = procurement?.arrivalRevision ?? 0;
  if (
    previousRevision === null ||
    revision <= previousRevision ||
    procurement === undefined
  ) {
    return { revision, message: null };
  }

  const arrival =
    procurement.recentArrivals[procurement.recentArrivals.length - 1];
  if (arrival === undefined) {
    return { revision, message: null };
  }
  const region = procurement.regions.find(
    (candidate) => candidate.id === arrival.regionId,
  );
  const quantity = arrival.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  return {
    revision,
    message:
      (region?.name ?? "港口") +
      "采购到货 · " +
      quantity +
      " 格食材已入库",
  };
}

export function resolvePortStatusLabel(
  procurement: GameplayProcurementSnapshot | undefined,
): string {
  return procurement !== undefined && procurement.orders.length > 0
    ? "港口运输中 · " + procurement.orders.length + " 批"
    : "港口航线待命";
}

export function resolveAirshipStatusLabel(options: {
  readonly hovered: boolean;
  readonly quietMode: boolean;
  readonly cooking: GameplayCookingSnapshot | null;
  readonly kitchenNotification:
    RestaurantKitchenNotificationPresentation | null;
  readonly getRecipeName: (recipeId: string | null) => string;
}): string {
  if (options.hovered) {
    return "云灶号运转中 · 工程台可查看升级";
  }
  const cooking = options.cooking;
  if (cooking === null) {
    return options.quietMode
      ? "安静模式 · 炉火低声运转"
      : "炉火稳定 · 厨房待命";
  }

  const notification = options.kitchenNotification;
  if (notification?.phase === "sending") {
    return "订单信号传输中 · 等待白夜城接收";
  }
  if (notification?.phase === "received") {
    return options.getRecipeName(notification.recipeId) +
      " · 白夜城正在备餐";
  }
  if (cooking.activeJob?.status === "waiting-output") {
    return options.getRecipeName(cooking.activeJob.recipeId) +
      " · 等待缆车取餐";
  }
  if (cooking.activeJob !== null) {
    return options.getRecipeName(cooking.activeJob.recipeId) +
      " · 已完成 " + cooking.completedBatches + " 批";
  }
  if (cooking.blockedReason === "insufficient-ingredients") {
    return "原料不足 · 等待公会补给";
  }
  return "厨房待命";
}

export function resolveRestaurantStatusLabel(options: {
  readonly hovered: boolean;
  readonly quietMode: boolean;
  readonly stockQuantity: number | null;
  readonly restaurant: Pick<
    GameplayRestaurantSnapshot,
    "copperBalance" | "totalSoldQuantity"
  > | null;
}): string {
  if (options.hovered) {
    return "餐厅营业中 · 柜台保存仓库与食谱";
  }
  if (
    options.restaurant !== null &&
    options.stockQuantity !== null
  ) {
    return "库存 " + options.stockQuantity +
      " 份 · 累计售出 " +
      options.restaurant.totalSoldQuantity +
      " 份 · " +
      options.restaurant.copperBalance +
      " 铜币";
  }
  return options.quietMode
    ? "安静营业中 · 动作频率已降低"
    : "晨间准备中 · 等待厨房送来第一批餐点";
}

export function resolveDesktopQuietMode(
  runtimeQuietMode: boolean,
  presentationMode: PresentationMode,
): boolean {
  return runtimeQuietMode || presentationMode === "quiet";
}