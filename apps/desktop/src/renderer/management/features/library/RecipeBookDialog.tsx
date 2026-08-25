import type { ProgressionReadModel } from "@airship-restaurant/contracts";
import { useEffect, useMemo, useState } from "react";
import { MANAGEMENT_RECIPES, getManagementItemName } from "../../management-content";
import "../shared/management-dialog.css";
import "./resource-library.css";

const STATION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "station.prep": "备菜台", "station.pan_fry": "煎炒设备", "station.steam_boil": "蒸煮设备", "station.oven": "烘烤设备", "station.plating": "装盘点",
});
function seconds(ms: number): string { return ms >= 60_000 ? `${Math.round(ms / 60_000)} 分钟` : `${Math.round(ms / 1000)} 秒`; }
export interface RecipeBookDialogProps { readonly open: boolean; readonly progression: ProgressionReadModel | null; readonly onClose: () => void; }
export function RecipeBookDialog({ open, progression, onClose }: RecipeBookDialogProps): React.JSX.Element | null {
  const unlockedIds = useMemo(() => new Set(progression?.contents.filter((item) => item.kind === "recipe" && item.status === "unlocked").map((item) => item.id) ?? []), [progression]);
  const recipes = MANAGEMENT_RECIPES.filter((recipe) => unlockedIds.has(recipe.id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { if (open && (selectedId === null || !recipes.some((recipe) => recipe.id === selectedId))) setSelectedId(recipes[0]?.id ?? null); }, [open, recipes, selectedId]);
  if (!open) return null;
  const recipe = recipes.find((entry) => entry.id === selectedId) ?? null;
  return (
    <div className="technology-tree-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="食谱" aria-modal="true" className="technology-tree-dialog resource-dialog recipe-book-dialog" role="dialog">
        <div className="technology-tree-heading"><div><p className="eyebrow">RECIPE BOOK</p><h2>白夜城的食谱</h2><p>左侧是游戏中的生产流程，右侧是可以在现实生活中照做的完整食谱；调味品只出现在现实食谱中。</p></div><button aria-label="关闭食谱" className="technology-tree-close" type="button" onClick={onClose}>关闭</button></div>
        {progression === null ? <p role="status">正在读取食谱解锁状态…</p> : recipes.length === 0 ? <p>目前还没有已解锁食谱。</p> : <div className="recipe-book-layout">
          <nav aria-label="已解锁食谱">{recipes.map((entry) => <button className={entry.id === recipe?.id ? "is-selected" : ""} key={entry.id} type="button" onClick={() => setSelectedId(entry.id)}><strong>{entry.name}</strong><small>{entry.detailedRecipe.realWorldName}</small></button>)}</nav>
          {recipe === null ? null : <div className="recipe-book-content">
            <header><div><span>游戏食谱</span><h3>{recipe.name}</h3></div><dl><div><dt>每批</dt><dd>{recipe.outputQuantity} 份</dd></div><div><dt>售价</dt><dd>{recipe.unitPriceCopper} 铜币/份</dd></div><div><dt>流程时长</dt><dd>{seconds(recipe.durationMs)}</dd></div></dl></header>
            <section><h4>简化配料</h4><ul className="recipe-chip-list">{recipe.ingredients.map((ingredient) => <li key={ingredient.itemId}>{getManagementItemName(ingredient.itemId)} ×{ingredient.quantity}</li>)}</ul></section>
            <section><h4>游戏制作步骤</h4><ol className="production-step-list">{recipe.productionSteps.map((step) => <li key={step.id}><strong>{step.name}</strong><span>{seconds(step.durationMs)} · {step.stationTags.map((tag) => STATION_LABELS[tag] ?? tag).join("、")} · {step.attendance === "required" ? "需厨师在场" : "开火后可离开"}</span><small>{step.prerequisiteStepIds.length === 0 ? "可立即并行开始" : `前置：${step.prerequisiteStepIds.map((id) => recipe.productionSteps.find((candidate) => candidate.id === id)?.name ?? id).join("、")}`}</small></li>)}</ol></section>
            <div className="real-recipe-divider"><span>REAL-WORLD RECIPE</span></div>
            <section className="real-recipe-heading"><div><h4>{recipe.detailedRecipe.realWorldName}</h4><p>{recipe.detailedRecipe.servings} 人份</p></div></section>
            <div className="real-recipe-columns"><section><h4>配料表</h4><ul>{recipe.detailedRecipe.ingredients.map((ingredient) => <li key={`${ingredient.name}-${ingredient.amount}`}><span>{ingredient.name}</span><strong>{ingredient.amount}</strong></li>)}</ul></section><section><h4>制作步骤</h4><ol>{recipe.detailedRecipe.steps.map((step) => <li key={step.order}><b>{step.order}</b><span>{step.instruction}</span></li>)}</ol></section></div>
            {recipe.detailedRecipe.notes.length === 0 ? null : <aside><strong>制作提示</strong><ul>{recipe.detailedRecipe.notes.map((note) => <li key={note}>{note}</li>)}</ul></aside>}
          </div>}
        </div>}
      </section>
    </div>
  );
}