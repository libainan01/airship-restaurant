import type {
  FinanceDayReportReadModel,
  FinanceReadModel,
  OperationsReadModel,
  ProgressionReadModel,
  InventoryReadModel,
  InventoryReadModelLocation,
} from "@airship-restaurant/contracts";
import { getManagementItemName as getItemName } from "../../management-content";

import {
  formatOfflineDuration,
  formatUtc,
  getCookingStatus,
  getLogisticsStatus,
  getRecipeName,
  getRestaurantStatusText,
  OPERATIONS_RECIPES as RECIPES,
} from "./operations-presenter";

const FINANCE_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "dish-sales": "菜品销售", tips: "小费", "focus-bonus": "专注加成", "other-income": "其他收入",
  "ingredient-procurement": "食材采购", "employee-wages": "员工工资", "employee-recruitment": "员工招募",
  "recruitment-refresh": "招募刷新", "airship-voyage": "飞艇出航", "equipment-repair": "设备维修",
  "technology-upgrade": "科技升级", "building-purchase": "建筑与装饰", "vehicle-upgrade": "载具升级",
  "other-expense": "其他支出",
});

function FinanceDayDetails({ day }: { readonly day: FinanceDayReportReadModel }): React.JSX.Element {
  return (
    <div className="finance-day-details">
      {[...day.incomeGroups, ...day.expenseGroups].map((group) => {
        const income = day.incomeGroups.some((candidate) => candidate.category === group.category);
        return (
          <details key={group.category}>
            <summary><span>{FINANCE_CATEGORY_LABELS[group.category] ?? group.category}</span><strong>{income ? "+" : "-"}{group.totalCopper}</strong></summary>
            <ul>{group.details.map((detail, index) => (
              <li key={`${detail.occurredAtUtcMs}-${detail.sourceName}-${index}`}>
                <span>{detail.sourceName}{detail.note === null ? "" : ` · ${detail.note}`}</span><strong>{detail.amountCopper}</strong>
              </li>
            ))}</ul>
          </details>
        );
      })}
      {day.incomeGroups.length + day.expenseGroups.length === 0 ? <p>本日暂时没有经营流水。</p> : null}
    </div>
  );
}

export interface OperationsPanelProps {
  readonly operations: OperationsReadModel | null;
  readonly finance: FinanceReadModel | null;
  readonly inventory: InventoryReadModel | null;
  readonly progression: ProgressionReadModel | null;
  readonly view?: "all" | "overview" | "finance";

}


function locationQuantity(
  location: InventoryReadModelLocation | undefined,
): number {
  return location?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
}

function locationCapacity(
  location: InventoryReadModelLocation | undefined,
): number {
  return location?.compartments.reduce(
    (sum, compartment) => sum + compartment.capacity,
    0,
  ) ?? 0;
}

function locationItems(
  location: InventoryReadModelLocation | undefined,
): InventoryReadModelLocation["items"] {
  return location?.items ?? [];
}
export function OperationsPanel({
  operations,
  finance,
  inventory,
  progression,
  view = "all",
}: OperationsPanelProps): React.JSX.Element {
  const unlockedRecipeIds = new Set(
    progression?.contents
      .filter((content) =>
        content.kind === "recipe" && content.status === "unlocked",
      )
      .map((content) => content.id) ?? [],
  );
  const availableRecipes = RECIPES.filter((recipe) =>
    unlockedRecipeIds.has(recipe.id),
  );
  const kitchenIngredients = inventory?.locations.find(
    (location) => location.id === "storage.airship-exchange",
  );
  const kitchenOutput = inventory?.locations.find(
    (location) => location.id === "storage.airship-exchange",
  );
  const cableCargo = inventory?.locations.find(
    (location) => location.id.startsWith("storage.freight."),
  );
  const restaurantStorage = inventory?.locations.find(
    (location) => location.id === "storage.ground-exchange",
  );
  return (
    <>      {view !== "finance" && (operations?.offlineEarnings === null ||
      operations === null ? null : (
        <section className="offline-summary" role="status">
          <div>
            <p className="eyebrow">WHILE YOU WERE AWAY</p>
            <h2>离线经营结算</h2>
            <p>
              餐厅独自经营了{" "}
              {formatOfflineDuration(
                operations.offlineEarnings.elapsedMs,
              )}
              。离线期间只结算经营资源，不会触发故事或剧情。
            </p>
          </div>
          <dl>
            <div>
              <dt>完成烹饪</dt>
              <dd>{operations.offlineEarnings.cookingBatchesCompleted} 批</dd>
            </div>
            <div>
              <dt>送达 / 售出</dt>
              <dd>
                {operations.offlineEarnings.deliveredQuantity} /{" "}
                {operations.offlineEarnings.soldQuantity} 份
              </dd>
            </div>
            <div>
              <dt>经营收入</dt>
              <dd>+{operations.offlineEarnings.copperEarned} 铜币</dd>
            </div>
            <div>
              <dt>补给 / 离开</dt>
              <dd>
                {operations.offlineEarnings.supplyBoxesReceived} 箱 /{" "}
                {operations.offlineEarnings.customersLeft} 位
              </dd>
            </div>
          </dl>
        </section>
      ))}

      {view === "overview" || finance === null ? null : (
        <section className="finance-card" id="management-finance" aria-label="每日盈亏">
          <div className="business-heading">
            <div><p className="eyebrow">DAILY FINANCE</p><h2>今日盈亏 · 第 {finance.currentDay.gameDay} 日</h2></div>
            <span className={finance.currentDay.netCopper >= 0 ? "finance-net finance-net--positive" : "finance-net finance-net--negative"}>
              {finance.currentDay.netCopper >= 0 ? "+" : ""}{finance.currentDay.netCopper} 铜币
            </span>
          </div>
          <dl className="finance-summary-grid">
            <div><dt>期初余额</dt><dd>{finance.currentDay.openingBalanceCopper}</dd></div>
            <div><dt>收入合计</dt><dd>+{finance.currentDay.totalIncomeCopper}</dd></div>
            <div><dt>支出合计</dt><dd>-{finance.currentDay.totalExpenseCopper}</dd></div>
            <div><dt>当前余额</dt><dd>{finance.currentDay.closingBalanceCopper}</dd></div>
          </dl>
          <FinanceDayDetails day={finance.currentDay} />
          {finance.historicalDays.length === 0 ? null : (
            <details className="finance-history">
              <summary>历史日结 · {finance.historicalDays.length} 日</summary>
              <div>{finance.historicalDays.map((day) => (
                <details key={day.gameDay}>
                  <summary>第 {day.gameDay} 日<strong>{day.netCopper >= 0 ? "+" : ""}{day.netCopper} 铜币</strong></summary>
                  <FinanceDayDetails day={day} />
                </details>
              ))}</div>
            </details>
          )}
        </section>
      )}

      {view === "finance" || operations?.gameplay === null ||
      operations === null ? null : (
        <section className="business-card" id="management-overview" aria-label="实时经营概览">
          <div className="business-heading">
            <div>
              <p className="eyebrow">LIVE OPERATIONS</p>
              <h2>实时经营概览</h2>
            </div>
            <span className="live-badge">运行中</span>
          </div>
          <div className="business-grid">
            <article>
              <span>空中厨房</span>
              <strong>
                {operations.gameplay.cooking.completedBatches} 批
              </strong>
              <p>{getCookingStatus(operations.gameplay)}</p>
              <small>
                出餐台{" "}
                {locationQuantity(kitchenOutput)}
                /{locationCapacity(kitchenOutput)}
              </small>
            </article>
            <article>
              <span>运输缆车</span>
              <strong>
                {operations.gameplay.logistics.cargoQuantity}/
                {locationCapacity(cableCargo)}
                {" "}份
              </strong>
              <p>{getLogisticsStatus(operations.gameplay)}</p>
              <small>
                累计送达{" "}
                {operations.gameplay.logistics.totalDeliveredQuantity}
                {" "}份
              </small>
            </article>
            <article className="business-card__restaurant">
              <span>风铃餐厅</span>
              <strong>
                {operations.gameplay.restaurant.totalSoldQuantity}
                {" "}份 ·{" "}
                {finance?.balanceCopper ?? 0}
                {" "}铜币
              </strong>
              <p>{getRestaurantStatusText(operations)}</p>
              <small>
                餐厅库存{" "}
                {locationQuantity(restaurantStorage)}
                /{locationCapacity(restaurantStorage)}
                {" · 离开 "}
                {operations.gameplay.restaurant.totalCustomersLeft}
                {" 位"}
              </small>
            </article>
          </div>
          <p className="supply-summary">
            公会补给箱已送达{" "}
            {operations.gameplay.supplyBoxesReceived} 次
            {" · 厨房原料 "}
            {locationQuantity(kitchenIngredients)}
            /{locationCapacity(kitchenIngredients)}
          </p>

          <div className="operation-controls" id="management-recipes">
            <div className="operation-heading">
              <div>
                <h3>订单驱动制作</h3>
                <p>顾客完成点单后，厨房按食谱步骤图自动发布可并行任务；不会脱离订单自行生产。</p>
              </div>
              <span>
                {operations.gameplay.cooking.activeJob === null
                  ? "当前没有制作中的订单"
                  : `正在制作：${getRecipeName(operations.gameplay.cooking.activeJob.recipeId)}`}
              </span>
            </div>
            <div className="recipe-grid" aria-label="已解锁食谱">
              {availableRecipes.map((recipe) => (
                <article
                  className={[
                    "recipe-option",
                    operations.gameplay?.cooking.activeJob?.recipeId === recipe.id
                      ? "recipe-option--selected"
                      : "",
                    operations.story?.storyOrder.status === "active" &&
                    operations.story.storyOrder.recipeId === recipe.id
                      ? "recipe-option--story-order"
                      : "",
                  ].filter(Boolean).join(" ")}
                  key={recipe.id}
                >
                  <strong>{recipe.name}</strong>
                  {operations.story?.storyOrder.status === "active" &&
                  operations.story.storyOrder.recipeId === recipe.id ? (
                    <em className="story-order-badge">故事订单</em>
                  ) : null}
                  <span>{recipe.duration} · {recipe.yield} · {recipe.price}</span>
                  <small>{recipe.ingredients}</small>
                </article>
              ))}
            </div>

            <details className="diagnostic-details" id="management-inventory">
              <summary>库存与绝对时间诊断</summary>
              <div className="diagnostic-grid">
                <section>
                  <h4>厨房食材</h4>
                  <ul>
                    {locationItems(kitchenIngredients).map((entry) => (
                        <li key={entry.itemId}>
                          <span>{getItemName(entry.itemId)}</span>
                          <strong>
                            {entry.quantity}
                            {entry.reservedQuantity > 0
                              ? `（预留 ${entry.reservedQuantity}）`
                              : ""}
                          </strong>
                        </li>
                      ))}
                  </ul>
                </section>
                <section>
                  <h4>在途与成品</h4>
                  <ul>
                    {[
                      ...locationItems(kitchenOutput).map((entry) => ({
                          ...entry,
                          location: "出餐台",
                        })),
                      ...locationItems(cableCargo).map((entry) => ({
                          ...entry,
                          location: "缆车",
                        })),
                      ...locationItems(restaurantStorage).map((entry) => ({
                          ...entry,
                          location: "餐厅",
                        })),
                    ].map((entry) => (
                      <li key={`${entry.location}-${entry.itemId}`}>
                        <span>
                          {entry.location} · {getItemName(entry.itemId)}
                        </span>
                        <strong>{entry.quantity}</strong>
                      </li>
                    ))}
                    {locationItems(kitchenOutput)
                      .length +
                      locationItems(cableCargo)
                        .length +
                      locationItems(restaurantStorage).length ===
                    0 ? (
                      <li>
                        <span>暂无成品</span>
                        <strong>0</strong>
                      </li>
                    ) : null}
                  </ul>
                </section>
                <section className="diagnostic-times">
                  <h4>UTC 事件时间</h4>
                  <dl>
                    <div>
                      <dt>模拟当前</dt>
                      <dd>{formatUtc(operations.gameplay.currentUtcMs)}</dd>
                    </div>
                    <div>
                      <dt>下次补给</dt>
                      <dd>{formatUtc(operations.gameplay.nextSupplyAtUtcMs)}</dd>
                    </div>
                    <div>
                      <dt>烹饪变化</dt>
                      <dd>
                        {formatUtc(
                          operations.gameplay.cooking.nextTransitionUtcMs,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>运输变化</dt>
                      <dd>
                        {formatUtc(
                          operations.gameplay.logistics.nextTransitionUtcMs,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>餐厅变化</dt>
                      <dd>
                        {formatUtc(
                          operations.gameplay.restaurant.nextTransitionUtcMs,
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            </details>
          </div>
        </section>
      )}

    </>
  );
}
