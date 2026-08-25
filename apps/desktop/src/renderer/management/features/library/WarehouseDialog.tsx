import type { InventoryReadModel, InventoryReadModelCategory } from "@airship-restaurant/contracts";
import { useEffect, useState } from "react";
import { getManagementItemName } from "../../management-content";
import "../shared/management-dialog.css";
import "./resource-library.css";

const CATEGORY_LABELS: Readonly<Record<InventoryReadModelCategory, string>> = Object.freeze({
  ingredient: "食材",
  dishware: "餐具",
  intermediate: "半成品",
  meal: "餐点",
});
const LOCATION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "storage.ground-exchange": "地面交换站",
  "storage.airship-exchange": "飞艇交换站",
  "storage.dish-cabinet.clean": "橱柜 · 干净餐盘",
  "storage.dish-cabinet.dirty": "橱柜 · 待洗餐盘",
  "storage.dish-cabinet.washing": "橱柜 · 清洗中",
  "storage.table.ground.1.dirty": "餐桌 · 待回收餐盘",
});
const CHARACTER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "baiyecheng_core": "白夜城",
  "otto_core": "奥托",
  "martha_bell_resident": "玛莎·贝尔",
  "edmund_bell_resident": "埃德蒙·贝尔",
});
function locationName(id: string): string {
  if (id.startsWith("storage.freight.")) return "小型货梯货舱";
  if (id.startsWith("carrier.instance.character.")) {
    const characterKey = id.slice("carrier.instance.character.".length);
    return "角色携带 · " + (CHARACTER_LABELS[characterKey] ?? "临时顾客");
  }
  return LOCATION_LABELS[id] ?? id;
}
function locationPriority(id: string): number {
  if (id === "storage.ground-exchange" || id === "storage.airship-exchange") return 0;
  if (id.startsWith("storage.dish-cabinet") || id === "storage.table-dirty") return 1;
  if (id.startsWith("storage.freight.")) return 2;
  if (id.startsWith("carrier.")) return 4;
  return 3;
}
export interface WarehouseDialogProps {
  readonly open: boolean;
  readonly inventory: InventoryReadModel | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onCreateManualDemand: (sourceLocationId: string, targetLocationId: string, itemId: string, quantity: number) => Promise<boolean>;
  readonly onStopManualDemand: (groupId: string) => Promise<boolean>;
}
export function WarehouseDialog({ open, inventory, pending, onClose, onCreateManualDemand, onStopManualDemand }: WarehouseDialogProps): React.JSX.Element | null {
  const stationIds = inventory?.manualLogistics?.stationLocationIds ?? [];
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  useEffect(() => {
    if (!open || stationIds.length < 2) return;
    if (!stationIds.includes(sourceId)) setSourceId(stationIds[0]!);
    if (!stationIds.includes(targetId) || targetId === (stationIds.includes(sourceId) ? sourceId : stationIds[0])) setTargetId(stationIds.find((id) => id !== (stationIds.includes(sourceId) ? sourceId : stationIds[0])) ?? "");
  }, [open, sourceId, targetId, stationIds]);
  const sourceLocation = inventory?.locations.find((location) => location.id === sourceId);
  const availableItems = sourceLocation?.items.filter((item) => item.availableQuantity > 0) ?? [];
  useEffect(() => { if (!availableItems.some((item) => item.itemId === itemId)) setItemId(availableItems[0]?.itemId ?? ""); }, [availableItems, itemId]);
  if (!open) return null;
  const totals = inventory?.totals ?? [];
  const sortedLocations = [...(inventory?.locations ?? [])].sort((left, right) => {
    const priority = locationPriority(left.id) - locationPriority(right.id);
    if (priority !== 0) return priority;
    const leftOccupied = left.compartments.reduce((sum, compartment) => sum + compartment.occupied, 0);
    const rightOccupied = right.compartments.reduce((sum, compartment) => sum + compartment.occupied, 0);
    return rightOccupied - leftOccupied || left.id.localeCompare(right.id);
  });
  const categories = (["ingredient", "dishware", "intermediate", "meal"] as const).map((category) => ({
    category,
    quantity: totals.filter((item) => item.category === category).reduce((sum, item) => sum + item.quantity, 0),
    reserved: totals.filter((item) => item.category === category).reduce((sum, item) => sum + item.reservedQuantity, 0),
    inTransit: totals.filter((item) => item.category === category).reduce((sum, item) => sum + item.inTransitQuantity, 0),
  }));
  return (
    <div className="technology-tree-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="仓库" aria-modal="true" className="technology-tree-dialog resource-dialog warehouse-dialog" role="dialog">
        <div className="technology-tree-heading">
          <div><p className="eyebrow">WAREHOUSE</p><h2>仓库</h2><p>同类物品堆叠显示；预留数量已经锁定给订单，在途数量仍计入总体库存。</p></div>
          <button aria-label="关闭仓库" className="technology-tree-close" type="button" onClick={onClose}>关闭</button>
        </div>
        {inventory === null ? <p role="status">正在读取库存…</p> : <>
          <div className="warehouse-summary-grid">
            {categories.map((entry) => <article key={entry.category}>
              <span>{CATEGORY_LABELS[entry.category]}</span><strong>{entry.quantity}</strong>
              <small>预留 {entry.reserved} · 在途 {entry.inTransit}</small>
            </article>)}
          </div>
          {inventory.dishware === null ? null : <div className="warehouse-dishware-strip">
            <strong>餐盘循环</strong><span>干净 {inventory.dishware.clean}</span><span>使用中 {inventory.dishware.inUse}</span><span>待洗 {inventory.dishware.dirty}</span><span>清洗中 {inventory.dishware.washing}</span>
          </div>}
          <section className="manual-logistics-section" aria-label="手动运送队列">
            <div><h3>手动运送队列</h3><p>创建后由四台小型货梯按优先级逐件运送；每成功送达一件，剩余数量减一。相同订单不会合并。</p></div>
            <form onSubmit={(event) => { event.preventDefault(); if (itemId.length > 0 && sourceId !== targetId) void onCreateManualDemand(sourceId, targetId, itemId, quantity); }}>
              <label>从<select value={sourceId} onChange={(event) => { const next=event.currentTarget.value; setSourceId(next); if(next===targetId) setTargetId(stationIds.find((id)=>id!==next) ?? ""); }}>{stationIds.map((id)=><option key={id} value={id}>{locationName(id)}</option>)}</select></label>
              <label>运到<select value={targetId} onChange={(event)=>setTargetId(event.currentTarget.value)}>{stationIds.filter((id)=>id!==sourceId).map((id)=><option key={id} value={id}>{locationName(id)}</option>)}</select></label>
              <label>物品<select value={itemId} onChange={(event)=>setItemId(event.currentTarget.value)}>{availableItems.map((item)=><option key={item.itemId} value={item.itemId}>{getManagementItemName(item.itemId)}（可用 {item.availableQuantity}）</option>)}</select></label>
              <label>数量<input min={1} step={1} type="number" value={quantity} onChange={(event)=>setQuantity(Math.max(1, Math.floor(Number(event.currentTarget.value)||1)))} /></label>
              <button disabled={pending || inventory.manualLogistics?.commandsAvailable !== true || itemId.length===0 || sourceId===targetId} type="submit">加入队列</button>
            </form>
            <div className="manual-logistics-list">
              {(inventory.manualLogistics?.demands ?? []).map((demand)=><article key={demand.id}><div><strong>{getManagementItemName(demand.itemId)}</strong><small>{locationName(demand.sourceLocationId)} → {locationName(demand.targetLocationId)}</small></div><span>已送 {demand.deliveredQuantity}/{demand.requestedQuantity} · 待运 {demand.remainingQuantity}{demand.claimedQuantity > 0 ? ` · 途中 ${demand.claimedQuantity}` : ""}</span><em>{demand.status === "completed" ? "完成" : demand.status === "stopped" ? "已停止" : demand.blockReason === "WAITING_SOURCE" ? "等待货源" : demand.blockReason === "WAITING_CAPACITY" ? "等待空间" : "排队中"}</em>{demand.status === "in-progress" ? <button disabled={pending} type="button" onClick={()=>{void onStopManualDemand(demand.id);}}>停止</button> : null}</article>)}
              {(inventory.manualLogistics?.demands.length ?? 0) === 0 ? <p>当前没有玩家创建的运送订单。</p> : null}
            </div>
          </section>
          <div className="warehouse-location-list">
            {sortedLocations.map((location) => {
              const occupied = location.compartments.reduce((sum, compartment) => sum + compartment.occupied, 0);
              const capacity = location.compartments.reduce((sum, compartment) => sum + compartment.capacity, 0);
              return <article key={location.id}>
                <header><div><strong>{locationName(location.id)}</strong><small>{location.id}</small></div><span>{occupied}/{capacity}</span></header>
                <div className="warehouse-capacity"><i style={{ width: `${capacity === 0 ? 0 : Math.min(100, occupied / capacity * 100)}%` }} /></div>
                {location.items.length === 0 ? <p>当前为空</p> : <ul>{location.items.map((item) => <li key={item.itemId}>
                  <span><b>{getManagementItemName(item.itemId)}</b><small>{CATEGORY_LABELS[item.category]}</small></span>
                  <strong>{item.quantity}{item.reservedQuantity > 0 ? ` · 预留 ${item.reservedQuantity}` : ""}{item.inTransitQuantity > 0 ? ` · 在途 ${item.inTransitQuantity}` : ""}</strong>
                </li>)}</ul>}
              </article>;
            })}
          </div>
        </>}
      </section>
    </div>
  );
}