import type {
  FinanceReadModel,
  InstanceUpgradesReadModel,
} from "@airship-restaurant/contracts";
import { useEffect, useMemo, useState } from "react";
import {
  type PlacementSelection,
  ScenePlacementCanvas,
} from "./ScenePlacementCanvas";
import {
  findOpenPlacement,
  type PlacementRect,
} from "./scene-placement-model";

export interface BuildingConstructionSectionProps {
  readonly upgrades: InstanceUpgradesReadModel;
  readonly finance: FinanceReadModel | null;
  readonly pending: boolean;
  readonly onStart: (
    definitionId: string,
    styleId: string,
    x: number,
    y: number,
    orientation: string,
  ) => Promise<boolean>;
  readonly onUpdate: (
    previewId: string,
    x: number,
    y: number,
    orientation: string,
  ) => Promise<boolean>;
  readonly onConfirm: (previewId: string) => Promise<boolean>;
  readonly onCancel: (previewId: string) => Promise<boolean>;
  readonly onMove: (
    buildingId: string,
    sceneId: string,
    x: number,
    y: number,
    orientation: string,
  ) => Promise<boolean>;
  readonly onChangeStyle: (
    buildingId: string,
    styleId: string,
  ) => Promise<boolean>;
}

export function BuildingConstructionSection({
  upgrades,
  finance,
  pending,
  onStart,
  onUpdate,
  onConfirm,
  onCancel,
  onMove,
  onChangeStyle,
}: BuildingConstructionSectionProps): React.JSX.Element {
  const available = upgrades.buildingCatalog.filter(
    (entry) => entry.unlocked,
  );
  const [definitionId, setDefinitionId] = useState("");
  const [styleId, setStyleId] = useState("");
  const [selection, setSelection] =
    useState<PlacementSelection | null>(null);
  const [awaitingPreviewDefinition, setAwaitingPreviewDefinition] =
    useState<string | null>(null);

  useEffect(() => {
    if (
      !available.some((entry) => entry.definitionId === definitionId)
    ) {
      setDefinitionId(available[0]?.definitionId ?? "");
    }
  }, [available, definitionId]);

  const definition =
    available.find((entry) => entry.definitionId === definitionId) ??
    null;

  useEffect(() => {
    if (
      definition !== null &&
      !definition.styleIds.includes(styleId)
    ) {
      setStyleId(definition.defaultStyleId);
    }
  }, [definition, styleId]);

  useEffect(() => {
    if (awaitingPreviewDefinition === null) return;
    const preview = upgrades.constructionPreviews
      .filter((entry) =>
        entry.definitionId === awaitingPreviewDefinition
      )
      .at(-1);
    if (preview === undefined) return;
    setSelection({ kind: "preview", id: preview.id });
    setAwaitingPreviewDefinition(null);
  }, [awaitingPreviewDefinition, upgrades.constructionPreviews]);

  useEffect(() => {
    if (selection === null) return;
    const exists = selection.kind === "preview"
      ? upgrades.constructionPreviews.some(
          (preview) => preview.id === selection.id,
        )
      : upgrades.buildings.some(
          (building) => building.id === selection.id,
        );
    if (!exists) setSelection(null);
  }, [
    selection,
    upgrades.buildings,
    upgrades.constructionPreviews,
  ]);

  const editActive =
    upgrades.editMode.active && upgrades.editMode.sceneId !== null;
  const affordable =
    definition !== null &&
    (finance?.availableCopper ?? 0) >= definition.buildCostCopper;

  const occupied = useMemo<readonly PlacementRect[]>(() => [
    ...upgrades.buildings
      .filter((building) => building.sceneId !== null)
      .map((building) => ({
        x: building.x,
        y: building.y,
        width: building.footprintWidth,
        height: building.footprintHeight,
      })),
    ...upgrades.constructionPreviews.flatMap((preview) => {
      const catalogEntry = upgrades.buildingCatalog.find(
        (entry) => entry.definitionId === preview.definitionId,
      );
      return catalogEntry === undefined ||
        preview.x === null ||
        preview.y === null
        ? []
        : [{
            x: preview.x,
            y: preview.y,
            width: catalogEntry.footprintWidth,
            height: catalogEntry.footprintHeight,
          }];
    }),
  ], [
    upgrades.buildingCatalog,
    upgrades.buildings,
    upgrades.constructionPreviews,
  ]);

  const selectedPreview =
    selection?.kind === "preview"
      ? upgrades.constructionPreviews.find(
          (preview) => preview.id === selection.id,
        ) ?? null
      : null;
  const selectedBuilding =
    selection?.kind === "building"
      ? upgrades.buildings.find(
          (building) => building.id === selection.id,
        ) ?? null
      : null;

  const startConstruction = async (): Promise<void> => {
    if (definition === null) return;
    const position = findOpenPlacement(
      {
        width: definition.footprintWidth,
        height: definition.footprintHeight,
      },
      definition.allowedRegionTags,
      occupied,
    );
    setAwaitingPreviewDefinition(definition.definitionId);
    const accepted = await onStart(
      definition.definitionId,
      styleId,
      position.x,
      position.y,
      definition.defaultOrientation,
    );
    if (!accepted) setAwaitingPreviewDefinition(null);
  };

  return (
    <section className="instance-upgrade-section building-construction-section">
      <div className="building-construction-heading">
        <div>
          <p className="eyebrow">SCENE PLACEMENT</p>
          <h3>场景布置</h3>
          <p>
            选择设施并放入场景，然后直接拖到想要的位置。
            编辑期间游戏暂停，确认建造前都可以取消。
          </p>
        </div>
        <ol aria-label="建造步骤">
          <li>选择设施</li>
          <li>放入场景</li>
          <li>拖动位置</li>
          <li>确认建造</li>
        </ol>
      </div>

      <div className="building-placement-workspace">
        <aside className="building-palette" aria-label="可建造设施">
          <strong>设施库</strong>
          <div>
            {available.map((entry) => (
              <button
                className={
                  entry.definitionId === definitionId
                    ? "building-palette-item building-palette-item--selected"
                    : "building-palette-item"
                }
                key={entry.definitionId}
                onClick={() => setDefinitionId(entry.definitionId)}
                type="button"
              >
                <span>{entry.name}</span>
                <small>
                  {entry.buildCostCopper} 铜币 · 占地{" "}
                  {entry.footprintWidth}×{entry.footprintHeight}
                </small>
                <em>{regionName(entry.allowedRegionTags)}</em>
              </button>
            ))}
          </div>
          {definition === null ? null : (
            <div className="building-palette-actions">
              <label>
                外观
                <select
                  value={styleId}
                  onChange={(event) =>
                    setStyleId(event.currentTarget.value)
                  }
                >
                  {definition.styleIds.map((id) => (
                    <option key={id} value={id}>{styleName(id)}</option>
                  ))}
                </select>
              </label>
              <button
                className="building-place-action"
                disabled={
                  pending ||
                  !editActive ||
                  !upgrades.constructionCommandsAvailable ||
                  !affordable
                }
                onClick={() => { void startConstruction(); }}
                type="button"
              >
                {!editActive
                  ? "先进入编辑模式"
                  : !affordable
                    ? "资金不足，无法放入"
                    : "放入场景 · 预留 " +
                      definition.buildCostCopper +
                      " 铜币"}
              </button>
              <small>
                点击后会自动寻找空位，并立即预留建造款。
              </small>
            </div>
          )}
        </aside>

        <div className="building-placement-main">
          <ScenePlacementCanvas
            disabled={pending || !editActive}
            onMoveBuilding={onMove}
            onMovePreview={onUpdate}
            onSelect={setSelection}
            selected={selection}
            upgrades={upgrades}
          />

          {selectedPreview === null && selectedBuilding === null ? (
            <div className="building-selection-panel building-selection-panel--empty">
              <strong>尚未选择设施</strong>
              <span>点击画布里的设施可查看、移动或确认建造。</span>
            </div>
          ) : null}

          {selectedPreview === null ? null : (
            <article className="building-selection-panel">
              <div>
                <span className="building-selection-kicker">建造预览</span>
                <strong>
                  {buildingName(upgrades, selectedPreview.definitionId)}
                </strong>
                <small>
                  已预留 {selectedPreview.costCopper} 铜币 ·{" "}
                  {Math.round(selectedPreview.x ?? 0)},{" "}
                  {Math.round(selectedPreview.y ?? 0)}
                </small>
              </div>
              <p className={
                selectedPreview.placementValid
                  ? "is-valid"
                  : "is-invalid"
              }>
                {selectedPreview.placementValid
                  ? "位置合法，可以确认建造。"
                  : selectedPreview.issues.join(" · ") ||
                    "请把设施拖到合法空位。"}
              </p>
              <div className="building-selection-actions">
                <button
                  disabled={pending || !selectedPreview.placementValid}
                  onClick={() => {
                    void onConfirm(selectedPreview.id);
                  }}
                  type="button"
                >
                  确认建造
                </button>
                <button
                  className="instance-upgrade-cancel"
                  disabled={pending}
                  onClick={() => {
                    void onCancel(selectedPreview.id);
                  }}
                  type="button"
                >
                  取消预览并退还
                </button>
              </div>
              <PrecisionPositionForm
                disabled={pending || !editActive}
                orientation={
                  selectedPreview.orientation ?? "front"
                }
                x={selectedPreview.x ?? 0}
                y={selectedPreview.y ?? 0}
                onSubmit={(x, y, orientation) =>
                  onUpdate(selectedPreview.id, x, y, orientation)
                }
              />
            </article>
          )}

          {selectedBuilding === null ? null : (
            <article className="building-selection-panel">
              <div>
                <span className="building-selection-kicker">
                  已有设施
                </span>
                <strong>
                  {buildingName(upgrades, selectedBuilding.definitionId)}
                </strong>
                <small>
                  等级 {selectedBuilding.currentLevel} ·{" "}
                  {Math.round(selectedBuilding.x)},{" "}
                  {Math.round(selectedBuilding.y)}
                </small>
              </div>
              <label className="building-style-control">
                外观
                <select
                  disabled={pending || !editActive}
                  value={selectedBuilding.styleId}
                  onChange={(event) => {
                    void onChangeStyle(
                      selectedBuilding.id,
                      event.currentTarget.value,
                    );
                  }}
                >
                  {selectedBuilding.styleIds.map((id) => (
                    <option key={id} value={id}>{styleName(id)}</option>
                  ))}
                </select>
              </label>
              {selectedBuilding.sceneId === null ? null : (
                <PrecisionPositionForm
                  disabled={
                    pending ||
                    !editActive ||
                    !selectedBuilding.movable
                  }
                  orientation={selectedBuilding.orientation}
                  x={selectedBuilding.x}
                  y={selectedBuilding.y}
                  onSubmit={(x, y, orientation) =>
                    onMove(
                      selectedBuilding.id,
                      selectedBuilding.sceneId!,
                      x,
                      y,
                      orientation,
                    )
                  }
                />
              )}
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

function PrecisionPositionForm({
  x,
  y,
  orientation,
  disabled,
  onSubmit,
}: {
  readonly x: number;
  readonly y: number;
  readonly orientation: string;
  readonly disabled: boolean;
  readonly onSubmit: (
    x: number,
    y: number,
    orientation: string,
  ) => Promise<boolean>;
}): React.JSX.Element {
  return (
    <details className="building-precision-editor">
      <summary>精确坐标微调</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onSubmit(
            Number(data.get("x")),
            Number(data.get("y")),
            orientation,
          );
        }}
      >
        <label>
          X
          <input defaultValue={x} name="x" type="number" />
        </label>
        <label>
          Y
          <input defaultValue={y} name="y" type="number" />
        </label>
        <button disabled={disabled} type="submit">应用坐标</button>
      </form>
    </details>
  );
}

function buildingName(
  upgrades: InstanceUpgradesReadModel,
  definitionId: string,
): string {
  return upgrades.buildingCatalog.find(
    (entry) => entry.definitionId === definitionId,
  )?.name ?? definitionId;
}

function styleName(styleId: string): string {
  return styleId === "default"
    ? "标准"
    : styleId === "brass"
      ? "黄铜"
      : styleId;
}

function regionName(tags: readonly string[]): string {
  if (tags.includes("zone.airship")) return "飞艇厨房";
  if (tags.includes("zone.edge")) return "升降区";
  return "地面餐厅";
}