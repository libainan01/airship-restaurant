import { createM2ContentRegistry } from "@airship-restaurant/content";
import type {
  AppSettingsSnapshot,
  AppSettingsUpdate,
  DisplayOption,
  GameCommand,
  GameplaySnapshot,
  GameSnapshot,
  PresentationMode,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import { useEffect, useState } from "react";

const CONTENT = createM2ContentRegistry();
const RECIPE_JOURNALS = CONTENT.listRecipeJournals();

const PRESENTATION_OPTIONS: readonly {
  readonly value: PresentationMode;
  readonly title: string;
  readonly description: string;
}[] = [
  {
    value: "normal",
    title: "正常",
    description: "完整动画与环境气氛。",
  },
  {
    value: "reduced",
    title: "低动态",
    description: "保留陪伴感，降低运动频率。",
  },
  {
    value: "quiet",
    title: "安静",
    description: "环境层休眠，主体仅低频运转。",
  },
];

const RECIPE_NAMES: Readonly<Record<string, string>> = {
  "recipe.hearth_flatbread": "炉火云麦饼",
  "recipe.windroot_soup": "风根浓汤",
  "recipe.homecoming_stew": "贝尔家的炉火炖菜",
};

const ITEM_NAMES: Readonly<Record<string, string>> = {
  "ingredient.cloud_wheat": "云穗麦粉",
  "ingredient.kettle_milk": "铜壶奶",
  "ingredient.wind_root": "风根菜",
  "ingredient.smoked_meat": "烟熏肉",
  "ingredient.moon_herb": "月露香草",
  "dish.hearth_flatbread": "炉火云麦饼",
  "dish.windroot_soup": "风根浓汤",
  "dish.homecoming_stew": "贝尔家的炉火炖菜",
};

function getItemName(itemId: string): string {
  return ITEM_NAMES[itemId] ?? itemId;
}

const RECIPES: readonly {
  readonly id: string;
  readonly name: string;
  readonly duration: string;
  readonly yield: string;
  readonly price: string;
  readonly ingredients: string;
}[] = [
  {
    id: "recipe.hearth_flatbread",
    name: "炉火云麦饼",
    duration: "45 秒",
    yield: "每锅 2 份",
    price: "每份 4 铜币",
    ingredients: "云穗麦粉 ×2 · 铜壶奶 ×1",
  },
  {
    id: "recipe.windroot_soup",
    name: "风根浓汤",
    duration: "90 秒",
    yield: "每锅 3 份",
    price: "每份 7 铜币",
    ingredients: "风根菜 ×2 · 铜壶奶 ×1 · 月露香草 ×1",
  },
  {
    id: "recipe.homecoming_stew",
    name: "贝尔家的炉火炖菜",
    duration: "180 秒",
    yield: "每锅 4 份",
    price: "每份 12 铜币",
    ingredients: "风根菜 ×2 · 烟熏肉 ×1 · 月露香草 ×1",
  },
];

function createCommandId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getRecipeName(recipeId: string | null): string {
  if (recipeId === null) {
    return "未选择食谱";
  }
  return RECIPE_NAMES[recipeId] ?? recipeId;
}

function getCookingStatus(gameplay: GameplaySnapshot): string {
  const { cooking } = gameplay;
  if (cooking.activeJob?.status === "waiting-output") {
    return "出餐台已满，等待缆车取货";
  }
  if (cooking.activeJob !== null) {
    return `正在烹饪 ${getRecipeName(cooking.activeJob.recipeId)}`;
  }
  if (cooking.blockedReason === "insufficient-ingredients") {
    return "原料不足，等待公会补给";
  }
  if (cooking.blockedReason === "output-capacity") {
    return "出餐台已满";
  }
  return "厨房待命";
}

function getLogisticsStatus(gameplay: GameplaySnapshot): string {
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

function getLatestSaleText(
  runtimeSnapshot: GameSnapshot,
): string {
  const latest =
    runtimeSnapshot.gameplay?.restaurant.recentSales.at(-1);
  if (latest === undefined) {
    return "还没有完成第一笔订单";
  }
  return `${getRecipeName(latest.recipeId)} +${latest.copperEarned} 铜币`;
}

function formatOfflineDuration(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return `${Math.max(1, Math.floor(elapsedMs / 1_000))} 秒`;
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes === 0
      ? `${hours} 小时`
      : `${hours} 小时 ${remainingMinutes} 分钟`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0
    ? `${days} 天`
    : `${days} 天 ${remainingHours} 小时`;
}

function getSaveStatusText(
  diagnostics: SaveDiagnosticsSnapshot | null,
): string {
  switch (diagnostics?.status) {
    case "ready":
      return "存档正常";
    case "saving":
      return "正在写入";
    case "error":
      return "存档异常";
    case "loading":
    case undefined:
      return "正在读取";
  }
}

function getSaveSourceText(
  diagnostics: SaveDiagnosticsSnapshot | null,
): string {
  switch (diagnostics?.loadSource) {
    case "new":
      return "本次建立新存档";
    case "primary":
      return "从主存档恢复";
    case "backup":
      return "主存档异常，已从备份恢复";
    case "reset-corrupt":
      return "存档与备份均异常，已建立新进度";
    case "loading":
    case undefined:
      return "正在确认存档来源";
  }
}

function formatSavedAt(utcMs: number | null): string {
  if (utcMs === null) {
    return "尚未完成首次写入";
  }
  return new Date(utcMs).toLocaleString("zh-CN", { hour12: false });
}

function formatUtc(utcMs: number | null): string {
  if (utcMs === null) {
    return "无待处理事件";
  }
  return new Date(utcMs).toISOString();
}

export function App(): React.JSX.Element {
  const workspaceInfo = window.airshipManagement?.getWorkspaceInfo();
  const [settings, setSettings] =
    useState<AppSettingsSnapshot | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<GameSnapshot | null>(null);
  const [displays, setDisplays] =
    useState<readonly DisplayOption[]>([]);
  const [saveDiagnostics, setSaveDiagnostics] =
    useState<SaveDiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      return;
    }

    let mounted = true;
    const unsubscribe = bridge.onSettingsChanged((nextSettings) => {
      if (mounted) {
        setSettings(nextSettings);
      }
    });
    const unsubscribeRuntime = bridge.onSnapshotChanged((snapshot) => {
      if (mounted) {
        setRuntimeSnapshot(snapshot);
      }
    });
    const unsubscribeSaveDiagnostics =
      bridge.onSaveDiagnosticsChanged((diagnostics) => {
        if (mounted) {
          setSaveDiagnostics(diagnostics);
        }
      });

    void Promise.all([
      bridge.getSettings(),
      bridge.listDisplays(),
      bridge.getSnapshot(),
      bridge.getSaveDiagnostics(),
    ])
      .then(([
        nextSettings,
        nextDisplays,
        nextRuntimeSnapshot,
        nextSaveDiagnostics,
      ]) => {
        if (!mounted) {
          return;
        }
        setSettings(nextSettings);
        setDisplays(nextDisplays);
        setRuntimeSnapshot(nextRuntimeSnapshot);
        setSaveDiagnostics(nextSaveDiagnostics);
      })
      .catch((cause: unknown) => {
        console.error("Unable to load management data.", cause);
        if (mounted) {
          setError("无法读取经营数据或设置，请重新打开管理窗口。");
        }
      });

    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeRuntime();
      unsubscribeSaveDiagnostics();
    };
  }, []);

  const updateSettings = async (
    update: AppSettingsUpdate,
  ): Promise<void> => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      setError("浏览器预览模式不能保存原生窗口设置。");
      return;
    }

    setPendingCount((count) => count + 1);
    setError(null);
    try {
      setSettings(await bridge.updateSettings(update));
    } catch (cause: unknown) {
      console.error("Unable to update application settings.", cause);
      setError("设置未能保存；显示器可能已断开，请重试。");
      try {
        setDisplays(await bridge.listDisplays());
        setSettings(await bridge.getSettings());
      } catch {
        // Keep the first, more useful error message.
      }
    } finally {
      setPendingCount((count) => Math.max(0, count - 1));
    }
  };

  const dispatchGameplayCommand = async (
    command: GameCommand,
  ): Promise<void> => {
    const bridge = window.airshipManagement;
    if (bridge === undefined) {
      setError("浏览器预览模式不能更改经营设置。");
      return;
    }

    setPendingCount((count) => count + 1);
    setError(null);
    try {
      const result = await bridge.dispatchCommand(command);
      setRuntimeSnapshot(result.snapshot);
      if (!result.accepted) {
        setError(`操作未能完成：${result.message}`);
      }
    } catch (cause: unknown) {
      console.error("Unable to dispatch runtime command.", cause);
      setError("操作未能完成，请重试。");
      try {
        setRuntimeSnapshot(await bridge.getSnapshot());
      } catch {
        // Preserve the operation error when refresh also fails.
      }
    } finally {
      setPendingCount((count) => Math.max(0, count - 1));
    }
  };

  const finishOnboarding = (): void => {
    void updateSettings({
      onboardingCompleted: true,
      needsDisplayConfirmation: false,
    });
  };

  if (settings === null) {
    return (
      <main className="management-shell management-shell--loading">
        <p>正在连接空艇餐厅主进程…</p>
      </main>
    );
  }

  const requiresConfirmation =
    !settings.onboardingCompleted ||
    settings.needsDisplayConfirmation;

  return (
    <main className="management-shell">
      <header>
        <p className="eyebrow">AIRSHIP RESTAURANT · SETTINGS</p>
        <h1>
          {requiresConfirmation ? "先安置好你的空艇餐厅" : "桌面设置"}
        </h1>
        <p>
          这些选项会立即应用并自动保存。以后点击飞艇或餐厅，
          也可以重新打开这个窗口。
        </p>
      </header>

      {requiresConfirmation ? (
        <section className="notice-card" role="status">
          <strong>
            {settings.needsDisplayConfirmation
              ? "原显示器已不可用"
              : "首次启动引导"}
          </strong>
          <span>
            请选择桌面和显示方式，确认后桌面世界会记住它们。
          </span>
        </section>
      ) : null}

      {runtimeSnapshot?.offlineEarnings === null ||
      runtimeSnapshot === null ? null : (
        <section className="offline-summary" role="status">
          <div>
            <p className="eyebrow">WHILE YOU WERE AWAY</p>
            <h2>离线经营结算</h2>
            <p>
              餐厅独自经营了{" "}
              {formatOfflineDuration(
                runtimeSnapshot.offlineEarnings.elapsedMs,
              )}
              。离线期间只结算经营资源，不会触发故事或剧情。
            </p>
          </div>
          <dl>
            <div>
              <dt>完成烹饪</dt>
              <dd>{runtimeSnapshot.offlineEarnings.cookingBatchesCompleted} 批</dd>
            </div>
            <div>
              <dt>送达 / 售出</dt>
              <dd>
                {runtimeSnapshot.offlineEarnings.deliveredQuantity} /{" "}
                {runtimeSnapshot.offlineEarnings.soldQuantity} 份
              </dd>
            </div>
            <div>
              <dt>经营收入</dt>
              <dd>+{runtimeSnapshot.offlineEarnings.copperEarned} 铜币</dd>
            </div>
            <div>
              <dt>补给 / 离开</dt>
              <dd>
                {runtimeSnapshot.offlineEarnings.supplyBoxesReceived} 箱 /{" "}
                {runtimeSnapshot.offlineEarnings.customersLeft} 位
              </dd>
            </div>
          </dl>
        </section>
      )}

      {runtimeSnapshot?.gameplay === null ||
      runtimeSnapshot === null ? null : (
        <section className="business-card" aria-label="实时经营概览">
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
                {runtimeSnapshot.gameplay.cooking.completedBatches} 批
              </strong>
              <p>{getCookingStatus(runtimeSnapshot.gameplay)}</p>
              <small>
                出餐台{" "}
                {
                  runtimeSnapshot.gameplay.inventory.kitchenOutput
                    .totalQuantity
                }
                /{runtimeSnapshot.gameplay.inventory.kitchenOutput.capacity}
              </small>
            </article>
            <article>
              <span>运输缆车</span>
              <strong>
                {runtimeSnapshot.gameplay.logistics.cargoQuantity}/
                {runtimeSnapshot.gameplay.inventory.cableCargo.capacity}
                {" "}份
              </strong>
              <p>{getLogisticsStatus(runtimeSnapshot.gameplay)}</p>
              <small>
                累计送达{" "}
                {runtimeSnapshot.gameplay.logistics.totalDeliveredQuantity}
                {" "}份
              </small>
            </article>
            <article className="business-card__restaurant">
              <span>风铃餐厅</span>
              <strong>
                {runtimeSnapshot.gameplay.restaurant.totalSoldQuantity}
                {" "}份 ·{" "}
                {runtimeSnapshot.gameplay.restaurant.copperBalance}
                {" "}铜币
              </strong>
              <p>{getLatestSaleText(runtimeSnapshot)}</p>
              <small>
                餐厅库存{" "}
                {
                  runtimeSnapshot.gameplay.inventory.restaurantStorage
                    .totalQuantity
                }
                /{runtimeSnapshot.gameplay.inventory.restaurantStorage.capacity}
                {" · 离开 "}
                {runtimeSnapshot.gameplay.restaurant.totalCustomersLeft}
                {" 位"}
              </small>
            </article>
          </div>
          <p className="supply-summary">
            公会补给箱已送达{" "}
            {runtimeSnapshot.gameplay.supplyBoxesReceived} 次
            {" · 厨房原料 "}
            {
              runtimeSnapshot.gameplay.inventory.kitchenIngredients
                .totalQuantity
            }
            /{runtimeSnapshot.gameplay.inventory.kitchenIngredients.capacity}
          </p>

          <div className="operation-controls">
            <div className="operation-heading">
              <div>
                <h3>今日菜单</h3>
                <p>切换后，正在烹饪的一锅会照常完成，下一锅采用新菜单。</p>
              </div>
              <span>
                当前：{getRecipeName(
                  runtimeSnapshot.gameplay.cooking.selectedRecipeId,
                )}
              </span>
            </div>
            <div className="recipe-grid" role="radiogroup" aria-label="今日菜单">
              {RECIPES.map((recipe) => {
                const selected =
                  runtimeSnapshot.gameplay?.cooking.selectedRecipeId ===
                  recipe.id;
                return (
                  <button
                    aria-checked={selected}
                    className={
                      selected
                        ? "recipe-option recipe-option--selected"
                        : "recipe-option"
                    }
                    disabled={pendingCount > 0}
                    key={recipe.id}
                    role="radio"
                    type="button"
                    onClick={() => {
                      void dispatchGameplayCommand({
                        id: createCommandId("select-recipe"),
                        type: "gameplay.select-recipe",
                        payload: { recipeId: recipe.id },
                      });
                    }}
                  >
                    <strong>{recipe.name}</strong>
                    <span>
                      {recipe.duration} · {recipe.yield} · {recipe.price}
                    </span>
                    <small>{recipe.ingredients}</small>
                  </button>
                );
              })}
            </div>
            <label className="auto-repeat-row">
              <span>
                <strong>自动续单</strong>
                <small>
                  开启后，只要原料与出餐空间足够，厨房会持续制作当前菜单。
                </small>
              </span>
              <input
                checked={runtimeSnapshot.gameplay.cooking.autoRepeat}
                disabled={pendingCount > 0}
                type="checkbox"
                onChange={(event) => {
                  void dispatchGameplayCommand({
                    id: createCommandId("set-auto-repeat"),
                    type: "gameplay.set-auto-repeat",
                    payload: { enabled: event.currentTarget.checked },
                  });
                }}
              />
            </label>

            <details className="diagnostic-details">
              <summary>库存与绝对时间诊断</summary>
              <div className="diagnostic-grid">
                <section>
                  <h4>厨房食材</h4>
                  <ul>
                    {runtimeSnapshot.gameplay.inventory.kitchenIngredients
                      .entries.map((entry) => (
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
                      ...runtimeSnapshot.gameplay.inventory.kitchenOutput
                        .entries.map((entry) => ({
                          ...entry,
                          location: "出餐台",
                        })),
                      ...runtimeSnapshot.gameplay.inventory.cableCargo
                        .entries.map((entry) => ({
                          ...entry,
                          location: "缆车",
                        })),
                      ...runtimeSnapshot.gameplay.inventory.restaurantStorage
                        .entries.map((entry) => ({
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
                    {runtimeSnapshot.gameplay.inventory.kitchenOutput.entries
                      .length +
                      runtimeSnapshot.gameplay.inventory.cableCargo.entries
                        .length +
                      runtimeSnapshot.gameplay.inventory.restaurantStorage
                        .entries.length ===
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
                      <dd>{formatUtc(runtimeSnapshot.gameplay.currentUtcMs)}</dd>
                    </div>
                    <div>
                      <dt>下次补给</dt>
                      <dd>{formatUtc(runtimeSnapshot.gameplay.nextSupplyAtUtcMs)}</dd>
                    </div>
                    <div>
                      <dt>烹饪变化</dt>
                      <dd>
                        {formatUtc(
                          runtimeSnapshot.gameplay.cooking.nextTransitionUtcMs,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>运输变化</dt>
                      <dd>
                        {formatUtc(
                          runtimeSnapshot.gameplay.logistics.nextTransitionUtcMs,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>餐厅变化</dt>
                      <dd>
                        {formatUtc(
                          runtimeSnapshot.gameplay.restaurant.nextTransitionUtcMs,
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

      {runtimeSnapshot?.narrative === null ||
      runtimeSnapshot === null ? null : (
        <details className="narrative-card">
          <summary>
            <span>
              <small>RECIPE STORIES · PLACEHOLDER</small>
              <strong>食谱故事</strong>
            </span>
            <span className="narrative-summary-status">
              {runtimeSnapshot.narrative.unreadEventIds.length > 0
                ? `${runtimeSnapshot.narrative.unreadEventIds.length} 条待阅读`
                : "暂无新故事"}
            </span>
          </summary>
          <p className="narrative-note">
            当前文字只用于验证系统结构，并非正式剧情。故事只会由在线经营行为
            解锁；离线收益不会触发或补发故事。
          </p>
          <div className="narrative-list">
            {runtimeSnapshot.narrative.events.map((event) => {
              const definition = CONTENT.getStoryEvent(event.eventId);
              const journal = RECIPE_JOURNALS.find((candidate) =>
                candidate.storyEventIds.includes(event.eventId),
              );
              const statusText =
                event.status === "locked"
                  ? "尚未解锁"
                  : event.status === "completed"
                    ? "已收录"
                    : event.unread
                      ? "待阅读"
                      : "阅读中";
              const body =
                definition === undefined
                  ? event.eventId
                  : CONTENT.getLocalizedText(
                      definition.localizationKey,
                    ) ?? definition.title;
              return (
                <article
                  className={`narrative-entry narrative-entry--${event.status}`}
                  key={event.eventId}
                >
                  <div className="narrative-entry-heading">
                    <div>
                      <span>
                        {journal === undefined
                          ? "故事记录"
                          : getRecipeName(journal.recipeId)}
                      </span>
                      <h3>{definition?.title ?? event.eventId}</h3>
                    </div>
                    <strong>{statusText}</strong>
                  </div>
                  {event.status === "locked" ? (
                    <ul>
                      {event.conditions.map((condition, index) => (
                        <li key={`${event.eventId}-${index}`}>
                          在线售出{" "}
                          {definition?.conditions[index]?.dishItemId ===
                          undefined
                            ? "指定菜品"
                            : getItemName(
                                definition.conditions[index].dishItemId,
                              )}
                          ：{condition.current}/{condition.required}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{body}</p>
                  )}
                  {event.status !== "available" ? null : (
                    <div className="narrative-actions">
                      {event.unread ? (
                        <button
                          disabled={pendingCount > 0}
                          type="button"
                          onClick={() => {
                            void dispatchGameplayCommand({
                              id: createCommandId("view-story"),
                              type: "narrative.mark-viewed",
                              payload: { eventId: event.eventId },
                            });
                          }}
                        >
                          标记已读
                        </button>
                      ) : null}
                      <button
                        disabled={pendingCount > 0}
                        type="button"
                        onClick={() => {
                          void dispatchGameplayCommand({
                            id: createCommandId("complete-story"),
                            type: "narrative.complete",
                            payload: { eventId: event.eventId },
                          });
                        }}
                      >
                        收录到食谱日志
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </details>
      )}

      <section className="settings-card" aria-label="桌面显示设置">
        <div className="setting-row">
          <div>
            <h2>目标显示器</h2>
            <p>飞艇、餐厅和缆车会共同出现在这一块屏幕。</p>
          </div>
          <select
            aria-label="目标显示器"
            value={settings.targetDisplayId}
            onChange={(event) => {
              void updateSettings({
                targetDisplayId: event.currentTarget.value,
                needsDisplayConfirmation: false,
              });
            }}
          >
            {displays.map((display) => (
              <option key={display.id} value={display.id}>
                {display.label}
                {display.isPrimary ? "（主显示器）" : ""}
                {" · "}
                {display.workArea.width}×{display.workArea.height}
                {" · "}
                {Math.round(display.scaleFactor * 100)}%
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row setting-row--stacked">
          <div>
            <h2>桌面表现</h2>
            <p>安静模式会让独立环境场景休眠，随时可以恢复。</p>
          </div>
          <div className="mode-grid">
            {PRESENTATION_OPTIONS.map((option) => (
              <label
                className={
                  settings.presentationMode === option.value
                    ? "mode-option mode-option--selected"
                    : "mode-option"
                }
                key={option.value}
              >
                <input
                  type="radio"
                  name="presentation-mode"
                  value={option.value}
                  checked={settings.presentationMode === option.value}
                  onChange={() => {
                    void updateSettings({
                      presentationMode: option.value,
                    });
                  }}
                />
                <strong>{option.title}</strong>
                <span>{option.description}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="toggle-row">
          <span>
            <strong>窗口置顶</strong>
            <small>让桌面世界保持在普通应用窗口上方。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(event) => {
              void updateSettings({
                alwaysOnTop: event.currentTarget.checked,
              });
            }}
          />
        </label>

        <label className="setting-row">
          <span>
            <strong>管理界面缩放</strong>
            <small>{Math.round(settings.uiScale * 100)}%</small>
          </span>
          <input
            aria-label="管理界面缩放"
            type="range"
            min="0.75"
            max="1.5"
            step="0.05"
            value={settings.uiScale}
            onChange={(event) => {
              void updateSettings({
                uiScale: Number(event.currentTarget.value),
              });
            }}
          />
        </label>
      </section>

      <section className="save-card" aria-label="存档状态">
        <div className="save-heading">
          <div>
            <p className="eyebrow">LOCAL SAVE</p>
            <h2>本地存档</h2>
          </div>
          <span
            className={`save-badge save-badge--${
              saveDiagnostics?.status ?? "loading"
            }`}
          >
            {getSaveStatusText(saveDiagnostics)}
          </span>
        </div>
        <dl>
          <div>
            <dt>恢复情况</dt>
            <dd>{getSaveSourceText(saveDiagnostics)}</dd>
          </div>
          <div>
            <dt>最近写入</dt>
            <dd>
              {formatSavedAt(saveDiagnostics?.lastSavedAtUtcMs ?? null)}
            </dd>
          </div>
          <div>
            <dt>存档文件</dt>
            <dd>
              {saveDiagnostics?.fileName ?? "save.json"} · 备份{" "}
              {saveDiagnostics?.backupFileName ?? "save.json.bak"}
            </dd>
          </div>
        </dl>
        {saveDiagnostics?.lastError === null ||
        saveDiagnostics?.lastError === undefined ? null : (
          <p className="save-error" role="alert">
            存档诊断：{saveDiagnostics.lastError}
          </p>
        )}
      </section>

      <footer>
        <div>
          <span>
            {pendingCount > 0 || saveDiagnostics?.status === "saving"
              ? "正在保存…"
              : saveDiagnostics?.status === "error"
                ? "存档需要注意"
                : "已自动保存"}
          </span>
          <small>
            preload {workspaceInfo?.channel ?? "browser"} · rev{" "}
            {settings.revision}
          </small>
        </div>
        {requiresConfirmation ? (
          <button type="button" onClick={finishOnboarding}>
            确认并进入桌面
          </button>
        ) : null}
      </footer>

      {error === null ? null : (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
