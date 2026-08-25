import type {
  CharacterPresentationReadModel,
  InstanceUpgradesReadModel,
  InventoryReadModel,
  LayoutReadModel,
  ManualLogisticsReadModel,
  RecruitmentReadModel,
  ProgressionReadModel,
  RuntimeReadModelKey,
  RuntimeReadModelSlice,
} from "@airship-restaurant/contracts";
import type { DishwareSnapshot, InventorySnapshot, SceneLayoutSnapshot } from "../modules";
import {
  CHARACTER_PRESENTATION_READ_MODEL_KEY,
  EMPTY_CHARACTER_PRESENTATION_READ_MODEL,
} from "./character-presentation-read-model";
import { EMPTY_INSTANCE_UPGRADES_READ_MODEL, INSTANCE_UPGRADES_READ_MODEL_KEY } from "./instance-upgrades-read-model";
import { EMPTY_RECRUITMENT_READ_MODEL, RECRUITMENT_READ_MODEL_KEY } from "./recruitment-read-model";
import { EMPTY_PROGRESSION_READ_MODEL, PROGRESSION_READ_MODEL_KEY } from "./progression-read-model";
import { projectInventoryReadModel, INVENTORY_READ_MODEL_KEY } from "./inventory-read-model";
import { projectLayoutReadModel, LAYOUT_READ_MODEL_KEY } from "./layout-read-model";
import { ReadModelRegistry } from "./read-model-registry";

export interface LayoutReadModelSource {
  getSnapshot(): SceneLayoutSnapshot;
}

export interface InventoryReadModelSource {
  getSnapshot(): InventorySnapshot;
}

export interface DishwareReadModelSource {
  getSnapshot(): DishwareSnapshot;
}

export interface CharacterReadModelSource {
  getSnapshot(): CharacterPresentationReadModel;
}

export interface InstanceUpgradesReadModelSource {
  getSnapshot(): InstanceUpgradesReadModel;
}

export interface RecruitmentReadModelSource {
  getSnapshot(): RecruitmentReadModel;
}
export interface ProgressionReadModelSource {
  getSnapshot(): ProgressionReadModel;
}
export interface ManualLogisticsReadModelSource {
  getSnapshot(): ManualLogisticsReadModel;
}

export interface RuntimeReadModelPort {
  get(key: RuntimeReadModelKey): RuntimeReadModelSlice;
  subscribe(
    key: RuntimeReadModelKey,
    listener: (slice: RuntimeReadModelSlice) => void,
    options?: { readonly emitCurrent?: boolean },
  ): () => void;
}

export class R3ReadModelPublisher implements RuntimeReadModelPort {
  readonly #registry: ReadModelRegistry;
  readonly #layout: LayoutReadModelSource;
  readonly #inventory: InventoryReadModelSource;
  readonly #dishware: DishwareReadModelSource | null;
  readonly #characters: CharacterReadModelSource | null;
  readonly #instanceUpgrades: InstanceUpgradesReadModelSource | null;
  readonly #recruitment: RecruitmentReadModelSource | null;
  readonly #progression: ProgressionReadModelSource | null;
  readonly #manualLogistics: ManualLogisticsReadModelSource | null;
  readonly #unregister: readonly (() => void)[];
  #layoutSourceRevision: number;
  #inventorySourceRevision: number;
  #dishwareSourceRevision: number | null;
  #characterSourceRevision: number | null;
  #instanceUpgradesSourceRevision: number | null;
  #recruitmentSourceRevision: number | null;
  #progressionSourceRevision: number | null;
  #manualLogisticsSourceRevision: number | null;

  constructor(options: {
    readonly layout: LayoutReadModelSource;
    readonly inventory: InventoryReadModelSource;
    readonly dishware?: DishwareReadModelSource;
    readonly characters?: CharacterReadModelSource;
    readonly instanceUpgrades?: InstanceUpgradesReadModelSource;
    readonly recruitment?: RecruitmentReadModelSource;
    readonly progression?: ProgressionReadModelSource;
    readonly manualLogistics?: ManualLogisticsReadModelSource;
  }) {
    this.#registry = new ReadModelRegistry();
    this.#layout = options.layout;
    this.#inventory = options.inventory;
    this.#dishware = options.dishware ?? null;
    this.#characters = options.characters ?? null;
    this.#instanceUpgrades = options.instanceUpgrades ?? null;
    this.#recruitment = options.recruitment ?? null;
    this.#progression = options.progression ?? null;
    this.#manualLogistics = options.manualLogistics ?? null;

    const layoutSnapshot = this.#layout.getSnapshot();
    const inventorySnapshot = this.#inventory.getSnapshot();
    const dishwareSnapshot = this.#dishware?.getSnapshot() ?? null;
    const characterSnapshot = this.#characters?.getSnapshot() ??
      EMPTY_CHARACTER_PRESENTATION_READ_MODEL;
    const instanceUpgradesSnapshot = this.#instanceUpgrades?.getSnapshot() ??
      EMPTY_INSTANCE_UPGRADES_READ_MODEL;
    const recruitmentSnapshot = this.#recruitment?.getSnapshot() ??
      EMPTY_RECRUITMENT_READ_MODEL;
    const progressionSnapshot = this.#progression?.getSnapshot() ??
      EMPTY_PROGRESSION_READ_MODEL;
    const manualLogisticsSnapshot = this.#manualLogistics?.getSnapshot();
    this.#layoutSourceRevision = layoutSnapshot.revision;
    this.#inventorySourceRevision = inventorySnapshot.revision;
    this.#dishwareSourceRevision = dishwareSnapshot?.revision ?? null;
    this.#characterSourceRevision = this.#characters === null
      ? null
      : characterSnapshot.sourceRevision;
    this.#instanceUpgradesSourceRevision = this.#instanceUpgrades === null
      ? null
      : instanceUpgradesSnapshot.sourceRevision;
    this.#recruitmentSourceRevision = this.#recruitment === null
      ? null
      : recruitmentSnapshot.sourceRevision;
    this.#progressionSourceRevision = this.#progression === null
      ? null
      : progressionSnapshot.sourceRevision;
    this.#manualLogisticsSourceRevision = manualLogisticsSnapshot?.sourceRevision ?? null;
    this.#unregister = Object.freeze([
      this.#registry.register(
        LAYOUT_READ_MODEL_KEY,
        projectLayoutReadModel(layoutSnapshot),
      ),
      this.#registry.register(
        INVENTORY_READ_MODEL_KEY,
        projectInventoryReadModel(inventorySnapshot, dishwareSnapshot, manualLogisticsSnapshot),
      ),
      this.#registry.register(
        CHARACTER_PRESENTATION_READ_MODEL_KEY,
        characterSnapshot,
      ),
      this.#registry.register(
        INSTANCE_UPGRADES_READ_MODEL_KEY,
        instanceUpgradesSnapshot,
      ),
      this.#registry.register(
        RECRUITMENT_READ_MODEL_KEY,
        recruitmentSnapshot,
      ),
      this.#registry.register(
        PROGRESSION_READ_MODEL_KEY,
        progressionSnapshot,
      ),
    ]);
  }

  get(key: RuntimeReadModelKey): RuntimeReadModelSlice {
    if (key === LAYOUT_READ_MODEL_KEY) {
      return this.#registry.get<LayoutReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === INVENTORY_READ_MODEL_KEY) {
      return this.#registry.get<InventoryReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === INSTANCE_UPGRADES_READ_MODEL_KEY) {
      return this.#registry.get<InstanceUpgradesReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === RECRUITMENT_READ_MODEL_KEY) {
      return this.#registry.get<RecruitmentReadModel>(key) as RuntimeReadModelSlice;
    }
    if (key === PROGRESSION_READ_MODEL_KEY) {
      return this.#registry.get<ProgressionReadModel>(key) as RuntimeReadModelSlice;
    }
    return this.#registry.get<CharacterPresentationReadModel>(key) as RuntimeReadModelSlice;
  }

  subscribe(
    key: RuntimeReadModelKey,
    listener: (slice: RuntimeReadModelSlice) => void,
    options: { readonly emitCurrent?: boolean } = {},
  ): () => void {
    if (key === LAYOUT_READ_MODEL_KEY) {
      return this.#registry.subscribe<LayoutReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === INVENTORY_READ_MODEL_KEY) {
      return this.#registry.subscribe<InventoryReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === INSTANCE_UPGRADES_READ_MODEL_KEY) {
      return this.#registry.subscribe<InstanceUpgradesReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === RECRUITMENT_READ_MODEL_KEY) {
      return this.#registry.subscribe<RecruitmentReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    if (key === PROGRESSION_READ_MODEL_KEY) {
      return this.#registry.subscribe<ProgressionReadModel>(
        key,
        (slice) => listener(slice as RuntimeReadModelSlice),
        options,
      );
    }
    return this.#registry.subscribe<CharacterPresentationReadModel>(
      key,
      (slice) => listener(slice as RuntimeReadModelSlice),
      options,
    );
  }

  refresh(): readonly RuntimeReadModelSlice[] {
    const published: RuntimeReadModelSlice[] = [];
    const layoutSnapshot = this.#layout.getSnapshot();
    if (layoutSnapshot.revision !== this.#layoutSourceRevision) {
      this.#layoutSourceRevision = layoutSnapshot.revision;
      published.push(
        this.#registry.publish(
          LAYOUT_READ_MODEL_KEY,
          projectLayoutReadModel(layoutSnapshot),
        ) as RuntimeReadModelSlice,
      );
    }

    const inventorySnapshot = this.#inventory.getSnapshot();
    const dishwareSnapshot = this.#dishware?.getSnapshot() ?? null;
    const dishwareRevision = dishwareSnapshot?.revision ?? null;
    const manualLogisticsSnapshot = this.#manualLogistics?.getSnapshot();
    const manualLogisticsRevision = manualLogisticsSnapshot?.sourceRevision ?? null;
    if (
      inventorySnapshot.revision !== this.#inventorySourceRevision ||
      dishwareRevision !== this.#dishwareSourceRevision ||
      manualLogisticsRevision !== this.#manualLogisticsSourceRevision
    ) {
      this.#inventorySourceRevision = inventorySnapshot.revision;
      this.#dishwareSourceRevision = dishwareRevision;
      this.#manualLogisticsSourceRevision = manualLogisticsRevision;
      published.push(
        this.#registry.publish(
          INVENTORY_READ_MODEL_KEY,
          projectInventoryReadModel(inventorySnapshot, dishwareSnapshot, manualLogisticsSnapshot),
        ) as RuntimeReadModelSlice,
      );
    }

    const instanceUpgradesSnapshot = this.#instanceUpgrades?.getSnapshot() ?? null;
    if (
      instanceUpgradesSnapshot !== null &&
      instanceUpgradesSnapshot.sourceRevision !== this.#instanceUpgradesSourceRevision
    ) {
      this.#instanceUpgradesSourceRevision = instanceUpgradesSnapshot.sourceRevision;
      published.push(
        this.#registry.publish(
          INSTANCE_UPGRADES_READ_MODEL_KEY,
          instanceUpgradesSnapshot,
        ) as RuntimeReadModelSlice,
      );
    }

    const recruitmentSnapshot = this.#recruitment?.getSnapshot() ?? null;
    if (
      recruitmentSnapshot !== null &&
      recruitmentSnapshot.sourceRevision !== this.#recruitmentSourceRevision
    ) {
      this.#recruitmentSourceRevision = recruitmentSnapshot.sourceRevision;
      published.push(
        this.#registry.publish(
          RECRUITMENT_READ_MODEL_KEY,
          recruitmentSnapshot,
        ) as RuntimeReadModelSlice,
      );
    }

    const progressionSnapshot = this.#progression?.getSnapshot() ?? null;
    if (
      progressionSnapshot !== null &&
      progressionSnapshot.sourceRevision !== this.#progressionSourceRevision
    ) {
      this.#progressionSourceRevision = progressionSnapshot.sourceRevision;
      published.push(
        this.#registry.publish(
          PROGRESSION_READ_MODEL_KEY,
          progressionSnapshot,
        ) as RuntimeReadModelSlice,
      );
    }
    const characterSnapshot = this.#characters?.getSnapshot() ?? null;
    if (
      characterSnapshot !== null &&
      characterSnapshot.sourceRevision !== this.#characterSourceRevision
    ) {
      this.#characterSourceRevision = characterSnapshot.sourceRevision;
      published.push(
        this.#registry.publish(
          CHARACTER_PRESENTATION_READ_MODEL_KEY,
          characterSnapshot,
        ) as RuntimeReadModelSlice,
      );
    }
    return Object.freeze(published);
  }

  dispose(): void {
    for (const unregister of [...this.#unregister].reverse()) unregister();
  }
}