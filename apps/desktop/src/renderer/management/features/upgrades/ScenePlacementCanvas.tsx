import type {
  BuildingConstructionPreviewReadModel,
  BuildingInstanceUpgradeReadModel,
  InstanceUpgradesReadModel,
} from "@airship-restaurant/contracts";
import { useRef, useState } from "react";
import {
  PLACEMENT_REGIONS,
  clampPlacementToRegion,
  clientPointToScene,
  sceneRectStyle,
} from "./scene-placement-model";

export type PlacementSelection =
  | { readonly kind: "building"; readonly id: string }
  | { readonly kind: "preview"; readonly id: string };

interface DragDraft {
  readonly kind: PlacementSelection["kind"];
  readonly id: string;
  readonly pointerId: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly allowedRegionTags: readonly string[];
  readonly orientation: string;
  readonly sceneId: string | null;
  readonly x: number;
  readonly y: number;
}

export interface ScenePlacementCanvasProps {
  readonly upgrades: InstanceUpgradesReadModel;
  readonly selected: PlacementSelection | null;
  readonly disabled: boolean;
  readonly onSelect: (selection: PlacementSelection) => void;
  readonly onMovePreview: (
    previewId: string,
    x: number,
    y: number,
    orientation: string,
  ) => Promise<boolean>;
  readonly onMoveBuilding: (
    buildingId: string,
    sceneId: string,
    x: number,
    y: number,
    orientation: string,
  ) => Promise<boolean>;
}

export function ScenePlacementCanvas({
  upgrades,
  selected,
  disabled,
  onSelect,
  onMovePreview,
  onMoveBuilding,
}: ScenePlacementCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DragDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const catalog = new Map(
    upgrades.buildingCatalog.map((entry) => [entry.definitionId, entry]),
  );

  const beginBuildingDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    building: BuildingInstanceUpgradeReadModel,
  ): void => {
    onSelect({ kind: "building", id: building.id });
    if (disabled || !building.movable || building.sceneId === null) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    event.preventDefault();
    const point = clientPointToScene(
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    canvas.setPointerCapture(event.pointerId);
    setDraft({
      kind: "building",
      id: building.id,
      pointerId: event.pointerId,
      offsetX: point.x - building.x,
      offsetY: point.y - building.y,
      width: building.footprintWidth,
      height: building.footprintHeight,
      allowedRegionTags: building.allowedRegionTags,
      orientation: building.orientation,
      sceneId: building.sceneId,
      x: building.x,
      y: building.y,
    });
    setNotice(null);
  };

  const beginPreviewDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    preview: BuildingConstructionPreviewReadModel,
  ): void => {
    onSelect({ kind: "preview", id: preview.id });
    const definition = catalog.get(preview.definitionId);
    if (
      disabled ||
      definition === undefined ||
      preview.x === null ||
      preview.y === null
    ) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    event.preventDefault();
    const point = clientPointToScene(
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    canvas.setPointerCapture(event.pointerId);
    setDraft({
      kind: "preview",
      id: preview.id,
      pointerId: event.pointerId,
      offsetX: point.x - preview.x,
      offsetY: point.y - preview.y,
      width: definition.footprintWidth,
      height: definition.footprintHeight,
      allowedRegionTags: definition.allowedRegionTags,
      orientation: preview.orientation ?? definition.defaultOrientation,
      sceneId: upgrades.editMode.sceneId,
      x: preview.x,
      y: preview.y,
    });
    setNotice(null);
  };

  const moveDraft = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (draft === null || event.pointerId !== draft.pointerId) return;
    const point = clientPointToScene(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const next = clampPlacementToRegion(
      {
        x: point.x - draft.offsetX,
        y: point.y - draft.offsetY,
      },
      { width: draft.width, height: draft.height },
      draft.allowedRegionTags,
    );
    setDraft({ ...draft, x: next.x, y: next.y });
  };

  const finishDraft = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (draft === null || event.pointerId !== draft.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const completed = draft;
    void (async () => {
      const accepted = completed.kind === "preview"
        ? await onMovePreview(
            completed.id,
            completed.x,
            completed.y,
            completed.orientation,
          )
        : completed.sceneId === null
          ? false
          : await onMoveBuilding(
              completed.id,
              completed.sceneId,
              completed.x,
              completed.y,
              completed.orientation,
            );
      setDraft(null);
      setNotice(
        accepted
          ? "位置已更新。"
          : "这里无法摆放，设施已回到原位置。",
      );
    })();
  };

  const displayPosition = (
    kind: PlacementSelection["kind"],
    id: string,
    x: number,
    y: number,
  ): { readonly x: number; readonly y: number } =>
    draft?.kind === kind && draft.id === id
      ? { x: draft.x, y: draft.y }
      : { x, y };

  return (
    <div className="scene-placement-editor">
      <div className="scene-placement-toolbar">
        <strong>场景俯视布置图</strong>
        <span>
          {disabled
            ? "进入编辑模式后即可拖动"
            : "按住设施拖动 · 松开后自动保存位置"}
        </span>
      </div>
      <div
        aria-label="设施摆放画布"
        className={
          "scene-placement-canvas" +
          (disabled ? " scene-placement-canvas--disabled" : "")
        }
        onPointerCancel={() => setDraft(null)}
        onPointerMove={moveDraft}
        onPointerUp={finishDraft}
        ref={canvasRef}
      >
        {PLACEMENT_REGIONS.map((region) => (
          <div
            className={
              "scene-placement-region scene-placement-region--" +
              region.tag.slice("zone.".length)
            }
            key={region.tag}
            style={sceneRectStyle(region)}
          >
            <span>{region.label}</span>
          </div>
        ))}
        {upgrades.buildings
          .filter((building) => building.sceneId !== null)
          .map((building) => {
            const position = displayPosition(
              "building",
              building.id,
              building.x,
              building.y,
            );
            const isSelected =
              selected?.kind === "building" &&
              selected.id === building.id;
            return (
              <button
                aria-label={"选择并移动" + buildingLabel(upgrades, building.definitionId)}
                className={
                  "scene-placement-item scene-placement-item--building" +
                  (isSelected ? " scene-placement-item--selected" : "") +
                  (!building.movable ? " scene-placement-item--fixed" : "")
                }
                key={building.id}
                onClick={() =>
                  onSelect({ kind: "building", id: building.id })
                }
                onPointerDown={(event) =>
                  beginBuildingDrag(event, building)
                }
                style={sceneRectStyle({
                  ...position,
                  width: building.footprintWidth,
                  height: building.footprintHeight,
                })}
                type="button"
              >
                <span>{buildingCanvasLabel(upgrades, building.definitionId)}</span>
              </button>
            );
          })}
        {upgrades.constructionPreviews.map((preview) => {
          const definition = catalog.get(preview.definitionId);
          if (definition === undefined) return null;
          const position = displayPosition(
            "preview",
            preview.id,
            preview.x ?? 0,
            preview.y ?? 0,
          );
          const isSelected =
            selected?.kind === "preview" && selected.id === preview.id;
          return (
            <button
              aria-label={"拖动待建造的" + definition.name}
              className={
                "scene-placement-item scene-placement-item--preview" +
                (preview.placementValid
                  ? " scene-placement-item--valid"
                  : " scene-placement-item--invalid") +
                (isSelected ? " scene-placement-item--selected" : "")
              }
              key={preview.id}
              onClick={() =>
                onSelect({ kind: "preview", id: preview.id })
              }
              onPointerDown={(event) =>
                beginPreviewDrag(event, preview)
              }
              style={sceneRectStyle({
                ...position,
                width: definition.footprintWidth,
                height: definition.footprintHeight,
              })}
              type="button"
            >
              <span>{definition.name}</span>
              <small>待确认</small>
            </button>
          );
        })}
      </div>
      <div className="scene-placement-legend" aria-label="摆放图例">
        <span><i className="is-airship" />飞艇厨房</span>
        <span><i className="is-edge" />升降区</span>
        <span><i className="is-ground" />地面餐厅</span>
        <span><i className="is-preview" />建造预览</span>
      </div>
      {notice === null ? null : (
        <p className="scene-placement-notice" role="status">{notice}</p>
      )}
    </div>
  );
}

function buildingLabel(
  upgrades: InstanceUpgradesReadModel,
  definitionId: string,
): string {
  return upgrades.buildingCatalog.find(
    (entry) => entry.definitionId === definitionId,
  )?.name ?? definitionId;
}

const SHORT_BUILDING_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    "building.ground_exchange_station": "地面交换站",
    "building.airship_exchange_station": "飞艇交换站",
    "building.dish_cabinet": "橱柜",
    "building.waiting_area": "等候区",
    "building.prep_station": "备菜台",
    "building.pan_fry_station": "煎炒灶",
    "building.steam_boil_station": "蒸煮灶",
    "building.baking_station": "烤炉",
    "building.plating_station": "装盘点",
    "building.personnel_elevator": "人员梯",
    "building.cargo_lift": "货梯",
  });

function buildingCanvasLabel(
  upgrades: InstanceUpgradesReadModel,
  definitionId: string,
): string {
  return SHORT_BUILDING_LABELS[definitionId] ??
    buildingLabel(upgrades, definitionId);
}