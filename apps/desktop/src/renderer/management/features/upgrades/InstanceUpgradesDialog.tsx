import type {
  BuildingInstanceUpgradeReadModel,
  FinanceReadModel,
  InstanceUpgradesReadModel,
} from "@airship-restaurant/contracts";
import "../shared/management-dialog.css";
import "./technology-tree.css";
import "./instance-upgrades.css";
import { BuildingConstructionSection } from "./BuildingConstructionSection";

const BUILDING_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "building.airship_exchange_station": "飞艇交换站",
  "building.dish_cabinet": "餐具橱柜",
  "building.waiting_area": "等候区",
  "building.prep_counter": "备菜台",
  "building.fry_station": "煎炒设备",
  "building.steam_station": "蒸煮设备",
  "building.oven_station": "烘烤设备",
  "building.plating_counter": "装盘点",
});

function buildingName(building: BuildingInstanceUpgradeReadModel): string {
  return BUILDING_LABELS[building.definitionId] ?? building.definitionId;
}

function describeCapabilityChanges(building: BuildingInstanceUpgradeReadModel): string {
  if (building.nextLevel === null) return "当前实例已达到最高等级。";
  const keys = new Set([
    ...Object.keys(building.currentCapabilityValues),
    ...Object.keys(building.nextLevel.capabilityValues),
  ]);
  const changes = [...keys].flatMap((key) => {
    const current = building.currentCapabilityValues[key];
    const next = building.nextLevel?.capabilityValues[key];
    return current === next || next === undefined ? [] : [`${key}: ${current ?? 0} → ${next}`];
  });
  return changes.length === 0 ? "本级主要调整耐久、占地或组件配置。" : changes.join(" · ");
}

export interface InstanceUpgradesDialogProps {
  readonly open: boolean;
  readonly upgrades: InstanceUpgradesReadModel | null;
  readonly finance: FinanceReadModel | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onEnterEditMode: (sceneId: string) => Promise<boolean>;
  readonly onExitEditMode: () => Promise<boolean>;
  readonly onPrepareBuilding: (buildingId: string, previewId: string) => Promise<boolean>;
  readonly onConfirmBuilding: (previewId: string) => Promise<boolean>;
  readonly onCancelBuilding: (previewId: string) => Promise<boolean>;
  readonly onUpgradeCart: (cartId: string) => Promise<boolean>;
  readonly onUpgradeAirship: (shipId: string) => Promise<boolean>;
  readonly onStartBuildingConstruction: (definitionId: string, styleId: string, x: number, y: number, orientation: string) => Promise<boolean>;
  readonly onUpdateBuildingConstruction: (previewId: string, x: number, y: number, orientation: string) => Promise<boolean>;
  readonly onConfirmBuildingConstruction: (previewId: string) => Promise<boolean>;
  readonly onCancelBuildingConstruction: (previewId: string) => Promise<boolean>;
  readonly onMoveBuilding: (buildingId: string, sceneId: string, x: number, y: number, orientation: string) => Promise<boolean>;
  readonly onChangeBuildingStyle: (buildingId: string, styleId: string) => Promise<boolean>;
}

export function InstanceUpgradesDialog({
  open,
  upgrades,
  finance,
  pending,
  onClose,
  onEnterEditMode,
  onExitEditMode,
  onPrepareBuilding,
  onConfirmBuilding,
  onCancelBuilding,
  onUpgradeCart,
  onUpgradeAirship,
  onStartBuildingConstruction,
  onUpdateBuildingConstruction,
  onConfirmBuildingConstruction,
  onCancelBuildingConstruction,
  onMoveBuilding,
  onChangeBuildingStyle,
}: InstanceUpgradesDialogProps): React.JSX.Element | null {
  if (!open) return null;
  const handleClose = (): void => {
    if (upgrades?.editMode.active !== true) {
      onClose();
      return;
    }
    void onExitEditMode().then((accepted) => {
      if (accepted) onClose();
    });
  };
  const balance = finance?.availableCopper ?? 0;
  const defaultEditSceneId = upgrades?.buildings.find((building) =>
    building.activePreview !== null && building.sceneId !== null
  )?.sceneId ?? upgrades?.buildings.find((building) =>
    building.nextLevel !== null && building.sceneId !== null
  )?.sceneId ?? upgrades?.buildings.find((building) => building.sceneId !== null)?.sceneId ?? null;
  return (
    <div className="technology-tree-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) handleClose();
    }}>
      <section aria-label="场景布置与设施升级" aria-modal="true" className="technology-tree-dialog instance-upgrades-dialog" role="dialog">
        <div className="technology-tree-heading">
          <div>
            <p className="eyebrow">SCENE PLACEMENT · INSTANCE UPGRADES</p>
            <h2>场景布置与设施升级</h2>
            <p>从设施库放入建筑，在俯视图中直接拖拽摆放，再确认建造；同一面板也可以调整外观和升级设施、采购小车及飞艇。</p>
          </div>
          <button aria-label="关闭场景布置" className="technology-tree-close" type="button" onClick={handleClose}>关闭</button>
        </div>
        <div className="technology-tree-balance">当前可用 <strong>{balance}</strong> 铜币</div>
        {upgrades === null ? null : (
          <div className={`instance-edit-mode ${upgrades.editMode.active ? "instance-edit-mode--active" : ""}`}>
            <span>{upgrades.editMode.active ? `正在编辑 ${upgrades.editMode.sceneId} · 游戏已暂停` : "编辑模式未开启 · 游戏正常运行"}</span>
            {upgrades.editMode.active ? (
              <button disabled={pending} type="button" onClick={() => { void onExitEditMode(); }}>退出编辑模式</button>
            ) : (
              <button disabled={pending || defaultEditSceneId === null || !upgrades.buildingCommandsAvailable} type="button" onClick={() => {
                if (defaultEditSceneId !== null) void onEnterEditMode(defaultEditSceneId);
              }}>进入编辑模式</button>
            )}
          </div>
        )}
        {upgrades === null ? <p role="status">正在读取实例数据…</p> : (
          <>
            <BuildingConstructionSection
              upgrades={upgrades}
              finance={finance}
              pending={pending}
              onStart={onStartBuildingConstruction}
              onUpdate={onUpdateBuildingConstruction}
              onConfirm={onConfirmBuildingConstruction}
              onCancel={onCancelBuildingConstruction}
              onMove={onMoveBuilding}
              onChangeStyle={onChangeBuildingStyle}
            />
            <section className="instance-upgrade-section">
              <h3>场景设施</h3>
              {upgrades.buildings.length === 0 ? <p className="instance-upgrade-empty">当前场景还没有纳入模块化布局的设施实例。</p> : (
                <div className="upgrade-grid">
                  {upgrades.buildings.map((building) => {
                    const preview = building.activePreview;
                    const next = building.nextLevel;
                    const affordable = next !== null && balance >= next.costCopper;
                    const editModeMatches = building.sceneId !== null &&
                      upgrades.editMode.active && upgrades.editMode.sceneId === building.sceneId;
                    return (
                      <article className="upgrade-option" key={building.id}>
                        <div>
                          <span>等级 {building.currentLevel}/{building.maxLevel}</span>
                          <strong>{buildingName(building)}</strong>
                          <small>{building.id}</small>
                          <p>{describeCapabilityChanges(building)}</p>
                          {next === null ? null : <small>下一级占地 {next.footprintWidth} × {next.footprintHeight}</small>}
                          {preview?.issues.map((issue) => <small className="instance-upgrade-issue" key={issue}>{issue}</small>)}
                        </div>
                        {preview === null ? (
                          <button disabled={pending || !upgrades.buildingCommandsAvailable || !editModeMatches || next === null || !affordable || building.sceneId === null} type="button" onClick={() => {
                            void onPrepareBuilding(building.id, `upgrade-preview-${crypto.randomUUID()}`);
                          }}>
                            {!upgrades.buildingCommandsAvailable ? "升级模块不可用" : next === null ? "已满级" : !editModeMatches ? "请先编辑此场景" : !affordable ? "资金不足" : "预览升级 · " + next.costCopper + " 铜币"}
                          </button>
                        ) : (
                          <div className="instance-upgrade-preview-actions">
                            <button disabled={pending || !preview.placementValid || !editModeMatches} type="button" onClick={() => { void onConfirmBuilding(preview.id); }}>{editModeMatches ? "确认升级" : "请先编辑此场景"}</button>
                            <button className="instance-upgrade-cancel" disabled={pending} type="button" onClick={() => { void onCancelBuilding(preview.id); }}>取消预览</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="instance-upgrade-section">
              <h3>本地采购小车</h3>
              {upgrades.procurementCarts.length === 0 ? <p className="instance-upgrade-empty">当前运行场景尚未挂接本地采购小车。</p> : (
                <div className="upgrade-grid">
                  {upgrades.procurementCarts.map((cart) => {
                    const next = cart.nextLevel;
                    const affordable = next !== null && balance >= next.costCopper;
                    return (
                      <article className="upgrade-option" key={cart.id}>
                        <div>
                          <span>等级 {cart.currentLevel}/{cart.maxLevel}</span>
                          <strong>{cart.id}</strong>
                          <p>携带 {cart.capacity} 件 · 速度 {cart.speedUnitsPerSecond}/秒{next === null ? "" : ` → 携带 ${next.capacity} 件 · 速度 ${next.speedUnitsPerSecond}/秒`}</p>
                          {cart.activeBatchId === null ? null : <small>执行中：{cart.activeBatchId}</small>}
                        </div>
                        <button disabled={pending || !upgrades.procurementCartCommandsAvailable || next === null || !affordable || cart.activeBatchId !== null} type="button" onClick={() => { void onUpgradeCart(cart.id); }}>
                          {!upgrades.procurementCartCommandsAvailable ? "等待正式采购模块" : next === null ? "已满级" : cart.activeBatchId !== null ? "采购途中不可升级" : !affordable ? "资金不足" : "升级 · " + next.costCopper + " 铜币"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            <section className="instance-upgrade-section">
              <h3>远程采购飞艇</h3>
              {upgrades.procurementAirships.length === 0 ? <p className="instance-upgrade-empty">当前船队还没有采购飞艇。</p> : (
                <div className="upgrade-grid">
                  {upgrades.procurementAirships.map((ship) => {
                    const next = ship.nextLevel;
                    const affordable = next !== null && balance >= next.costCopper;
                    const active = ship.activeVoyageId !== null;
                    return (
                      <article className="upgrade-option" key={ship.id}>
                        <div>
                          <span>等级 {ship.currentLevel}/{ship.maxLevel}</span>
                          <strong>{ship.name}</strong>
                          <small>{ship.id}</small>
                          <p>运量 {ship.cargoCapacity} 件 · 速度 {ship.speedUnitsPerSecond}/秒 · 耐久 {ship.durability}/{ship.maxDurability}</p>
                          {next === null ? <small>当前实例已达到最高等级。</small> : <small>下一级：运量 {next.cargoCapacity} 件 · 速度 {next.speedUnitsPerSecond}/秒 · 耐久上限 {next.maxDurability}</small>}
                          {active ? <small>航行中：{ship.activeVoyageId}</small> : ship.cooldownEndsAtUtcMs > Date.now() ? <small>冷却至 {new Date(ship.cooldownEndsAtUtcMs).toLocaleTimeString("zh-CN", { hour12: false })}</small> : <small>当前可用</small>}
                        </div>
                        <button disabled={pending || !upgrades.procurementAirshipCommandsAvailable || next === null || !affordable || active} type="button" onClick={() => { void onUpgradeAirship(ship.id); }}>
                          {!upgrades.procurementAirshipCommandsAvailable ? "等待船队模块" : next === null ? "已满级" : active ? "航行途中不可升级" : !affordable ? "资金不足" : "升级 · " + next.costCopper + " 铜币"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}