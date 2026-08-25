import type {
  GameplayProcurementItemSnapshot,
  FinanceReadModel,
  ProcurementReadModel,
  ProgressionReadModel,
  InventoryReadModel,
} from "@airship-restaurant/contracts";
import { useEffect, useMemo, useState } from "react";
import "../shared/management-dialog.css";
import "./procurement.css";
import {
  getManagementItemName,
  MANAGEMENT_RECIPES,
} from "../../management-content";
import {
  adjustQuantitySelection,
  buildProcurementPlan,
  subtractQuantitySelection,
  type ProcurementMode,
  type QuantitySelection,
} from "./procurement-plan";

export interface ProcurementDialogProps {
  readonly open: boolean;
  readonly procurement: ProcurementReadModel | null;
  readonly finance: FinanceReadModel | null;
  readonly inventory: InventoryReadModel | null;
  readonly progression: ProgressionReadModel | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onPlaceOrder: (
    items: readonly GameplayProcurementItemSnapshot[],
  ) => Promise<boolean>;
  readonly onConfigureAutomation: (
    enabled: boolean,
    reserveCopper: number,
    policies: readonly {
      readonly itemId: string;
      readonly threshold: number;
      readonly target: number;
    }[],
  ) => Promise<boolean>;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return Math.ceil(durationMs / 1_000) + " 秒";
  }
  return Math.ceil(durationMs / 60_000) + " 分钟";
}

function formatArrival(utcMs: number | null): string {
  return utcMs === null ? "无待处理事件" : new Date(utcMs).toISOString();
}

export function ProcurementDialog({
  open,
  procurement,
  finance,
  inventory,
  progression,
  pending,
  onClose,
  onPlaceOrder,
  onConfigureAutomation,
}: ProcurementDialogProps): React.JSX.Element | null {
  const [mode, setMode] = useState<ProcurementMode>("free");
  const [freeSelection, setFreeSelection] =
    useState<QuantitySelection>({});
  const [automationTargets, setAutomationTargets] = useState<QuantitySelection>({});
  const [automationReserve, setAutomationReserve] = useState(0);
  const [recipeSelection, setRecipeSelection] =
    useState<QuantitySelection>({});

  const unlockedRecipeIds = useMemo(
    () => new Set(
      progression?.contents
        .filter((content) =>
          content.kind === "recipe" && content.status === "unlocked",
        )
        .map((content) => content.id) ?? [],
    ),
    [progression],
  );
  const unlockedRecipes = useMemo(
    () => MANAGEMENT_RECIPES.filter((recipe) =>
      unlockedRecipeIds.has(recipe.id),
    ),
    [unlockedRecipeIds],
  );
  const procurementSnapshot = procurement?.procurement ?? null;
  useEffect(() => {
    if (!open || procurementSnapshot === null) return;
    setAutomationReserve(procurementSnapshot.automation.reserveCopper);
    setAutomationTargets(Object.fromEntries(
      procurementSnapshot.automation.policies.map((policy) => [policy.itemId, policy.target]),
    ));
  }, [open, procurementSnapshot]);
  const automationItems = useMemo(() => {
    if (procurementSnapshot === null) return [];
    const ids = new Set(procurementSnapshot.regions.filter((region) => region.unlocked)
      .flatMap((region) => region.items.map((item) => item.itemId)));
    return [...ids].sort();
  }, [procurementSnapshot]);
  const kitchenInventory = inventory?.locations.find(
    (location) => location.id === "storage.ground-exchange",
  );
  const plan = useMemo(
    () => procurementSnapshot === null || kitchenInventory === undefined
      ? null
      : buildProcurementPlan({
          inventory: {
            kitchenIngredients: {
              entries: kitchenInventory.items,
              availableCapacity: kitchenInventory.compartments.reduce(
                (sum, compartment) =>
                  sum + compartment.availableCapacity,
                0,
              ),
            },
          },
          procurement: procurementSnapshot,
        }, {
          mode,
          freeSelection,
          recipeSelection,
          allowedRecipeIds: unlockedRecipeIds,
        }),
    [freeSelection, procurementSnapshot, kitchenInventory, mode, recipeSelection, unlockedRecipeIds],
  );

  if (!open || procurement === null || progression === null ||
      procurementSnapshot === null || plan === null) return null;


  const updateFreeSelection = (itemId: string, delta: number): void => {
    setFreeSelection((current) =>
      adjustQuantitySelection(current, itemId, delta),
    );
  };
  const updateRecipeSelection = (
    recipeId: string,
    delta: number,
  ): void => {
    setRecipeSelection((current) =>
      adjustQuantitySelection(current, recipeId, delta),
    );
  };

  return (
    <div
      className="technology-tree-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label="港口采购"
        aria-modal="true"
        className="technology-tree-dialog procurement-dialog"
        role="dialog"
      >
        <div className="technology-tree-heading">
          <div>
            <p className="eyebrow">PORT PROCUREMENT</p>
            <h2>港口采购</h2>
            <p>系统按供应地区建立订单并固定拆批；本地小车与采购飞艇分别执行。</p>
          </div>
          <button
            aria-label="关闭港口采购"
            className="technology-tree-close"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="procurement-tabs" role="tablist">
          <button
            aria-selected={mode === "free"}
            className={mode === "free" ? "is-active" : ""}
            role="tab"
            type="button"
            onClick={() => setMode("free")}
          >
            自由采购
          </button>
          <button
            aria-selected={mode === "recipe"}
            className={mode === "recipe" ? "is-active" : ""}
            role="tab"
            type="button"
            onClick={() => setMode("recipe")}
          >
            按食谱采购
          </button>
        </div>

        {mode === "free" ? (
          <div className="procurement-market">
            {procurementSnapshot.regions.map((region) => (
              <section
                className={[
                  "procurement-region",
                  region.unlocked ? "" : "is-locked",
                ].filter(Boolean).join(" ")}
                key={region.id}
              >
                <header>
                  <div>
                    <strong>{region.name}</strong>
                    <small>
                      {formatDuration(region.deliveryDurationMs)}
                      {" · 运费 "}
                      {region.freightCostCopper} 铜币
                    </small>
                  </div>
                  <span>
                    {region.unlocked
                      ? "航线可用"
                      : "运输绞盘 Lv." +
                        region.minimumTransportLevel +
                        " 开放"}
                  </span>
                </header>
                {region.items.map((item) => {
                  const inventoryEntry = kitchenInventory?.items.find(
                    (entry) => entry.itemId === item.itemId,
                  );
                  const incoming =
                    procurementSnapshot.incomingItems.find(
                      (entry) => entry.itemId === item.itemId,
                    )?.quantity ?? 0;
                  const quantity = freeSelection[item.itemId] ?? 0;
                  return (
                    <div className="procurement-line" key={item.itemId}>
                      <div>
                        <strong>
                          {getManagementItemName(item.itemId)}
                        </strong>
                        <small>
                          库存 {inventoryEntry?.availableQuantity ?? 0}
                          {" · 在途 "}{incoming}
                          {" · 单价 "}{item.unitPriceCopper}
                        </small>
                      </div>
                      <div className="quantity-stepper">
                        <button
                          disabled={!region.unlocked || quantity === 0}
                          type="button"
                          onClick={() =>
                            updateFreeSelection(item.itemId, -1)}
                        >
                          −
                        </button>
                        <span>{quantity}</span>
                        <button
                          disabled={!region.unlocked}
                          type="button"
                          onClick={() =>
                            updateFreeSelection(item.itemId, 1)}
                        >
                          ＋
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : (
          <div className="procurement-recipes">
            {unlockedRecipes.map((recipe) => {
              const batches = recipeSelection[recipe.id] ?? 0;
              return (
                <article key={recipe.id}>
                  <div>
                    <strong>{recipe.name}</strong>
                    <small>
                      每锅产出 {recipe.outputQuantity} 份{" · "}
                      {recipe.ingredients.map((ingredient) =>
                        getManagementItemName(ingredient.itemId) +
                        " ×" + ingredient.quantity
                      ).join(" · ")}
                    </small>
                  </div>
                  <div className="quantity-stepper">
                    <button
                      disabled={batches === 0}
                      type="button"
                      onClick={() =>
                        updateRecipeSelection(recipe.id, -1)}
                    >
                      −
                    </button>
                    <span>{batches} 锅</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateRecipeSelection(recipe.id, 1)}
                    >
                      ＋
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <section className="procurement-plan">
          <div className="operation-heading">
            <div>
              <h3>采购计划</h3>
              <p>已扣除可用库存与在途货物；确认后一次性校验并付款。</p>
            </div>
            <span>
              {plan.totalQuantity} 格 · {plan.totalCostCopper} 铜币
            </span>
          </div>
          {plan.regions.length === 0 ? (
            <p className="procurement-empty">
              尚未选择需要采购的食材或锅数。
            </p>
          ) : (
            <div className="procurement-plan-regions">
              {plan.regions.map((region) => (
                <article key={region.id}>
                  <strong>
                    {region.name}
                    {!region.unlocked ? " · 航线未开放" : ""}
                  </strong>
                  <span>
                    {region.items.map((item) =>
                      getManagementItemName(item.itemId) +
                      " ×" + item.quantity
                    ).join(" · ")}
                  </span>
                  <small>
                    {region.costCopper} 铜币{" · 约 "}
                    {formatDuration(region.durationMs)}
                  </small>
                </article>
              ))}
            </div>
          )}
          {plan.exceedsCapacity ? (
            <p className="procurement-warning">
              仓库剩余空间不足，无法整体确认。
            </p>
          ) : null}
          {plan.blockedByLockedPort ? (
            <p className="procurement-warning">
              计划中包含尚未开放的港口。
            </p>
          ) : null}
          <button
            className="procurement-confirm"
            disabled={
              pending ||
              plan.items.length === 0 ||
              plan.exceedsCapacity ||
              plan.blockedByLockedPort ||
              plan.totalCostCopper >
                (finance?.availableCopper ?? 0)
            }
            type="button"
            onClick={() => {
              const submittedMode = mode;
              const submittedSelection = submittedMode === "free"
                ? freeSelection
                : recipeSelection;
              void onPlaceOrder(plan.items).then((accepted) => {
                if (!accepted) return;
                if (submittedMode === "free") {
                  setFreeSelection((current) =>
                    subtractQuantitySelection(
                      current,
                      submittedSelection,
                    ));
                } else {
                  setRecipeSelection((current) =>
                    subtractQuantitySelection(
                      current,
                      submittedSelection,
                    ));
                }
              });
            }}
          >
            确认联合采购 · {plan.totalCostCopper} 铜币
          </button>
        </section>

        <section className="procurement-orders">
          <h3>在途与排队</h3>
          {procurementSnapshot.orders.length === 0 ? (
            <p className="procurement-empty">当前没有采购订单。</p>
          ) : procurementSnapshot.orders.map((order) => {
            const region = procurementSnapshot.regions.find(
              (candidate) => candidate.id === order.regionId,
            );
            return (
              <article key={order.id}>
                <div>
                  <strong>{region?.name ?? order.regionId}</strong>
                  <small>
                    {order.items.map((item) =>
                      getManagementItemName(item.itemId) +
                      " ×" + item.quantity
                    ).join(" · ")}
                  </small>
                </div>
                <span>
                  {order.status === "queued"
                    ? "等待执行"
                    : "运输中 · " +
                      formatArrival(order.arriveAtUtcMs)}
                </span>
              </article>
            );
          })}
        </section>

        <section className="procurement-automation">
          <div className="operation-heading">
            <div>
              <h3>自动补货</h3>
              <p>
                {!procurementSnapshot.automation.unlocked
                  ? "后续剧情关键角色担任餐厅管理员后开放。"
                  : procurementSnapshot.automation.managerAvailable === false
                    ? "管理员当前不在岗；已有采购照常完成，暂不生成新订单。"
                    : procurementSnapshot.automation.enabled
                      ? "管理员会按目标库存补足缺口，并计入在途货物。"
                      : "已解锁，设置目标库存后可启用。"}
              </p>
            </div>
            <span>{procurementSnapshot.automation.enabled ? "运行中" : "已停用"}</span>
          </div>
          {procurementSnapshot.automation.unlocked ? (
            <div className="procurement-plan-regions">
              <label className="procurement-automation-reserve">
                <span>最低保留资金</span>
                <input
                  min={0}
                  step={1}
                  type="number"
                  value={automationReserve}
                  onChange={(event) => setAutomationReserve(Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0))}
                />
                <small>自动下单后可用资金不会低于此数值。</small>
              </label>
              {automationItems.map((itemId) => {
                const quantity = automationTargets[itemId] ?? 0;
                const policy = procurementSnapshot.automation.policies.find((entry) => entry.itemId === itemId);
                return (
                  <article key={itemId}>
                    <div>
                      <strong>{getManagementItemName(itemId)}</strong>
                      <small>{policy?.blockingReason === "SOURCE_UNAVAILABLE" ? "缺少可用产地或航线" : policy?.blockingReason === "FUNDS_PROTECTED" ? "受最低保留资金限制" : policy?.blockingReason === "MANAGER_UNAVAILABLE" ? "等待管理员上班" : quantity === 0 ? "不自动补货" : "目标库存 " + quantity}</small>
                    </div>
                    <div className="quantity-stepper">
                      <button disabled={quantity === 0} type="button" onClick={() => setAutomationTargets((current) => adjustQuantitySelection(current, itemId, -1))}>−</button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => setAutomationTargets((current) => adjustQuantitySelection(current, itemId, 1))}>＋</button>
                    </div>
                  </article>
                );
              })}
              <div className="procurement-automation-actions">
                <button
                  disabled={pending || !automationItems.some((itemId) => (automationTargets[itemId] ?? 0) > 0)}
                  type="button"
                  onClick={() => void onConfigureAutomation(true, automationReserve, automationItems.flatMap((itemId) => {
                    const target = automationTargets[itemId] ?? 0;
                    return target === 0 ? [] : [{ itemId, threshold: 0, target }];
                  }))}
                >
                  保存并启用
                </button>
                <button
                  disabled={pending || !procurementSnapshot.automation.enabled}
                  type="button"
                  onClick={() => void onConfigureAutomation(false, automationReserve, automationItems.flatMap((itemId) => {
                    const target = automationTargets[itemId] ?? 0;
                    return target === 0 ? [] : [{ itemId, threshold: 0, target }];
                  }))}
                >
                  停用（保留目标）
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </div>
  );
}
