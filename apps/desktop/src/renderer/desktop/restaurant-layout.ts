import { DEFAULT_RESTAURANT_LAYOUT_DEFINITION } from "./restaurant-layout-definition";

export { DEFAULT_RESTAURANT_LAYOUT_DEFINITION } from "./restaurant-layout-definition";

export type RestaurantPropKind =
  | "pillar"
  | "window"
  | "table"
  | "counter"
  | "lamp";

export type RestaurantPropCapability =
  | "structural"
  | "seating"
  | "service"
  | "lighting"
  | "upgradeable";

export type RestaurantRenderLayer =
  | "background"
  | "furniture"
  | "lighting";

export type RestaurantPositionKind = "seat" | "conversation";

export type RestaurantAnchorRole =
  | "guest-entry"
  | "guest-exit"
  | "otto-home"
  | "otto-pickup"
  | "delivery-table";

export interface RestaurantLayoutTransform {
  readonly xRatio: number;
  readonly yRatio: number;
  readonly offsetXPx?: number;
  readonly offsetYPx?: number;
  readonly originX?: number;
  readonly originY?: number;
}

export interface RestaurantLayoutDimensions {
  readonly widthPx?: number;
  readonly widthRatio?: number;
  readonly heightPx?: number;
  readonly heightRatio?: number;
  readonly widthOffsetPx?: number;
  readonly heightOffsetPx?: number;
}

export interface RestaurantLayoutPropInstance {
  readonly id: string;
  readonly kind: RestaurantPropKind;
  readonly visualKey: string;
  readonly renderLayer: RestaurantRenderLayer;
  readonly transform: RestaurantLayoutTransform;
  readonly dimensions: RestaurantLayoutDimensions;
  readonly capabilities: readonly RestaurantPropCapability[];
  readonly tags: readonly string[];
  readonly enabled?: boolean;
  readonly unlockSeatCapacity?: number;
}

export interface RestaurantFunctionalPosition {
  readonly id: string;
  readonly xRatio: number;
  readonly yRatio: number;
  readonly facing: -1 | 1;
  readonly parentPropId?: string;
  readonly tags: readonly string[];
  readonly enabled?: boolean;
  readonly unlockSeatCapacity?: number;
}

export interface RestaurantAnchorInstance
  extends RestaurantFunctionalPosition {
  readonly role: RestaurantAnchorRole;
}

export interface RestaurantPositionSlotInstance
  extends RestaurantFunctionalPosition {
  readonly kind: RestaurantPositionKind;
  readonly priority: number;
  readonly conflictsWith: readonly string[];
}

export interface RestaurantConversationFormation {
  readonly id: string;
  readonly participantCount: number;
  readonly slotIds: readonly string[];
}

export interface RestaurantLayoutDefinition {
  readonly schemaVersion: 1;
  readonly layoutId: string;
  readonly props: readonly RestaurantLayoutPropInstance[];
  readonly anchors: readonly RestaurantAnchorInstance[];
  readonly positionSlots: readonly RestaurantPositionSlotInstance[];
  readonly conversationFormations: readonly RestaurantConversationFormation[];
}

export interface RestaurantPositionReservation {
  readonly actorId: string;
  readonly slotId: string;
  readonly position: RestaurantPositionSlotInstance;
}

const isEnabled = (instance: { readonly enabled?: boolean }): boolean =>
  instance.enabled !== false;

const assertRatio = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite ratio between 0 and 1.`);
  }
};

export class RestaurantLayoutRuntime {
  readonly #definition: RestaurantLayoutDefinition;
  readonly #propsById = new Map<string, RestaurantLayoutPropInstance>();
  readonly #anchorsByRole = new Map<
    RestaurantAnchorRole,
    RestaurantAnchorInstance
  >();
  readonly #slotsById = new Map<string, RestaurantPositionSlotInstance>();
  readonly #formationsByCount = new Map<
    number,
    RestaurantConversationFormation
  >();
  readonly #slotOccupants = new Map<string, string>();
  readonly #actorSlots = new Map<string, string>();
  readonly #conversationActors = new Map<string, readonly string[]>();
  #seatCapacity = 3;

  constructor(definition: RestaurantLayoutDefinition) {
    this.#definition = definition;
    this.#validateAndIndex();
  }

  get definition(): RestaurantLayoutDefinition {
    return this.#definition;
  }

  getProps(
    kind?: RestaurantPropKind,
  ): readonly RestaurantLayoutPropInstance[] {
    return this.#definition.props.filter(
      (prop) =>
        this.#isUnlocked(prop) &&
        (kind === undefined || prop.kind === kind),
    );
  }

  getPositionSlots(
    kind?: RestaurantPositionKind,
  ): readonly RestaurantPositionSlotInstance[] {
    return this.#definition.positionSlots
      .filter(
        (slot) =>
          this.#isUnlocked(slot) &&
          (kind === undefined || slot.kind === kind),
      )
      .sort((left, right) => left.priority - right.priority);
  }

  requireProp(id: string): RestaurantLayoutPropInstance {
    const prop = this.#propsById.get(id);
    if (prop === undefined || !this.#isUnlocked(prop)) {
      throw new Error(`Restaurant layout is missing enabled prop '${id}'.`);
    }
    return prop;
  }

  requireAnchor(role: RestaurantAnchorRole): RestaurantAnchorInstance {
    const anchor = this.#anchorsByRole.get(role);
    if (anchor === undefined || !isEnabled(anchor)) {
      throw new Error(`Restaurant layout is missing enabled anchor '${role}'.`);
    }
    return anchor;
  }

  requirePositionSlot(id: string): RestaurantPositionSlotInstance {
    const slot = this.#slotsById.get(id);
    if (slot === undefined || !this.#isUnlocked(slot)) {
      throw new Error(`Restaurant layout is missing enabled position '${id}'.`);
    }
    return slot;
  }

  getOccupant(slotId: string): string | null {
    return this.#slotOccupants.get(slotId) ?? null;
  }

  setSeatCapacity(seatCapacity: number): void {
    const availableSeatCount = this.#definition.positionSlots.filter(
      (slot) => isEnabled(slot) && slot.kind === "seat",
    ).length;
    if (
      !Number.isInteger(seatCapacity) ||
      seatCapacity < 1 ||
      seatCapacity > availableSeatCount
    ) {
      throw new RangeError("Restaurant layout seat capacity is invalid.");
    }
    for (const [slotId] of this.#slotOccupants) {
      const slot = this.#slotsById.get(slotId);
      if (
        slot?.kind === "seat" &&
        (slot.unlockSeatCapacity ?? 1) > seatCapacity
      ) {
        throw new Error("Cannot hide an occupied restaurant seat.");
      }
    }
    this.#seatCapacity = seatCapacity;
  }
  reservePosition(
    slotId: string,
    actorId: string,
  ): RestaurantPositionReservation {
    const slot = this.requirePositionSlot(slotId);
    this.#assertSlotAvailable(slot, new Set([actorId]));
    this.releaseActor(actorId);
    this.#occupy(slot, actorId);
    return Object.freeze({ actorId, slotId: slot.id, position: slot });
  }

  reserveFirstAvailableSeat(
    actorId: string,
  ): RestaurantPositionReservation | null {
    const ignoredActors = new Set([actorId]);
    const slot = this.getPositionSlots("seat").find((candidate) =>
      this.#isSlotAvailable(candidate, ignoredActors),
    );
    return slot === undefined ? null : this.reservePosition(slot.id, actorId);
  }

  previewConversationPositions(
    participantCount: number,
  ): readonly RestaurantPositionSlotInstance[] {
    const formation = this.#formationsByCount.get(participantCount);
    if (formation === undefined) {
      throw new Error(
        `Restaurant layout has no conversation formation for ${participantCount} participants.`,
      );
    }
    return Object.freeze(
      formation.slotIds.map((slotId) => this.requirePositionSlot(slotId)),
    );
  }

  reserveConversation(
    conversationId: string,
    actorIds: readonly string[],
  ): readonly RestaurantPositionReservation[] {
    const slots = this.previewConversationPositions(actorIds.length);
    const ignoredActors = new Set(actorIds);
    for (const slot of slots) {
      this.#assertSlotAvailable(slot, ignoredActors);
    }

    this.releaseConversation(conversationId);
    for (const actorId of actorIds) {
      this.releaseActor(actorId);
    }
    const reservations = slots.map((slot, index) => {
      const actorId = actorIds[index];
      if (actorId === undefined) {
        throw new Error("Conversation reservation lost an actor assignment.");
      }
      this.#occupy(slot, actorId);
      return Object.freeze({ actorId, slotId: slot.id, position: slot });
    });
    this.#conversationActors.set(conversationId, Object.freeze([...actorIds]));
    return Object.freeze(reservations);
  }

  releaseActor(actorId: string): void {
    const slotId = this.#actorSlots.get(actorId);
    if (slotId !== undefined) {
      this.#actorSlots.delete(actorId);
      if (this.#slotOccupants.get(slotId) === actorId) {
        this.#slotOccupants.delete(slotId);
      }
    }
    for (const [conversationId, actorIds] of this.#conversationActors) {
      if (!actorIds.includes(actorId)) {
        continue;
      }
      const remainingActorIds = actorIds.filter(
        (candidate) => candidate !== actorId,
      );
      if (remainingActorIds.length === 0) {
        this.#conversationActors.delete(conversationId);
      } else {
        this.#conversationActors.set(
          conversationId,
          Object.freeze(remainingActorIds),
        );
      }
    }
  }

  releaseConversation(conversationId: string): void {
    const actorIds = this.#conversationActors.get(conversationId);
    if (actorIds === undefined) {
      return;
    }
    this.#conversationActors.delete(conversationId);
    for (const actorId of actorIds) {
      this.releaseActor(actorId);
    }
  }

  #isUnlocked(instance: {
    readonly enabled?: boolean;
    readonly unlockSeatCapacity?: number;
  }): boolean {
    return (
      isEnabled(instance) &&
      (instance.unlockSeatCapacity ?? 1) <= this.#seatCapacity
    );
  }

  #occupy(slot: RestaurantPositionSlotInstance, actorId: string): void {
    this.#slotOccupants.set(slot.id, actorId);
    this.#actorSlots.set(actorId, slot.id);
  }

  #isSlotAvailable(
    slot: RestaurantPositionSlotInstance,
    ignoredActors: ReadonlySet<string>,
  ): boolean {
    const occupant = this.#slotOccupants.get(slot.id);
    if (occupant !== undefined && !ignoredActors.has(occupant)) {
      return false;
    }
    return slot.conflictsWith.every((conflictId) => {
      const conflictOccupant = this.#slotOccupants.get(conflictId);
      return conflictOccupant === undefined || ignoredActors.has(conflictOccupant);
    });
  }

  #assertSlotAvailable(
    slot: RestaurantPositionSlotInstance,
    ignoredActors: ReadonlySet<string>,
  ): void {
    if (!this.#isSlotAvailable(slot, ignoredActors)) {
      const directOccupant = this.#slotOccupants.get(slot.id);
      const conflict = slot.conflictsWith
        .map((conflictId) => ({
          conflictId,
          occupant: this.#slotOccupants.get(conflictId),
        }))
        .find(
          ({ occupant }) =>
            occupant !== undefined && !ignoredActors.has(occupant),
        );
      const blocker =
        directOccupant !== undefined
          ? `${slot.id} by ${directOccupant}`
          : `${conflict?.conflictId ?? "unknown"} by ${
              conflict?.occupant ?? "unknown"
            }`;
      throw new Error(
        `Restaurant position '${slot.id}' is blocked by ${blocker}.`,
      );
    }
  }

  #validateAndIndex(): void {
    const allIds = new Set<string>();
    const registerId = (id: string): void => {
      if (id.length === 0 || allIds.has(id)) {
        throw new Error(`Restaurant layout contains duplicate or empty id '${id}'.`);
      }
      allIds.add(id);
    };

    for (const prop of this.#definition.props) {
      registerId(prop.id);
      assertRatio(prop.transform.xRatio, `${prop.id}.transform.xRatio`);
      assertRatio(prop.transform.yRatio, `${prop.id}.transform.yRatio`);
      this.#propsById.set(prop.id, prop);
    }
    for (const anchor of this.#definition.anchors) {
      registerId(anchor.id);
      assertRatio(anchor.xRatio, `${anchor.id}.xRatio`);
      assertRatio(anchor.yRatio, `${anchor.id}.yRatio`);
      if (this.#anchorsByRole.has(anchor.role)) {
        throw new Error(`Restaurant layout has duplicate anchor role '${anchor.role}'.`);
      }
      this.#anchorsByRole.set(anchor.role, anchor);
    }
    for (const slot of this.#definition.positionSlots) {
      registerId(slot.id);
      assertRatio(slot.xRatio, `${slot.id}.xRatio`);
      assertRatio(slot.yRatio, `${slot.id}.yRatio`);
      this.#slotsById.set(slot.id, slot);
    }

    const requireParent = (instance: RestaurantFunctionalPosition): void => {
      if (instance.parentPropId !== undefined && !this.#propsById.has(instance.parentPropId)) {
        throw new Error(
          `Restaurant position '${instance.id}' references missing prop '${instance.parentPropId}'.`,
        );
      }
    };
    for (const anchor of this.#definition.anchors) {
      requireParent(anchor);
    }
    for (const slot of this.#definition.positionSlots) {
      requireParent(slot);
      for (const conflictId of slot.conflictsWith) {
        if (!this.#slotsById.has(conflictId)) {
          throw new Error(
            `Restaurant position '${slot.id}' conflicts with missing position '${conflictId}'.`,
          );
        }
      }
    }

    for (const formation of this.#definition.conversationFormations) {
      if (
        formation.participantCount < 2 ||
        formation.slotIds.length !== formation.participantCount ||
        this.#formationsByCount.has(formation.participantCount)
      ) {
        throw new Error(`Restaurant conversation formation '${formation.id}' is invalid.`);
      }
      if (new Set(formation.slotIds).size !== formation.slotIds.length) {
        throw new Error(`Restaurant conversation formation '${formation.id}' repeats a slot.`);
      }
      for (const slotId of formation.slotIds) {
        const slot = this.#slotsById.get(slotId);
        if (slot === undefined || slot.kind !== "conversation") {
          throw new Error(
            `Restaurant conversation formation '${formation.id}' references invalid slot '${slotId}'.`,
          );
        }
      }
      this.#formationsByCount.set(formation.participantCount, formation);
    }

    for (const role of [
      "guest-entry",
      "guest-exit",
      "otto-home",
      "otto-pickup",
      "delivery-table",
    ] as const) {
      this.requireAnchor(role);
    }
    if (this.getPositionSlots("seat").length === 0) {
      throw new Error("Restaurant layout needs at least one enabled guest seat.");
    }
  }
}

export const createDefaultRestaurantLayoutRuntime =
  (): RestaurantLayoutRuntime =>
    new RestaurantLayoutRuntime(DEFAULT_RESTAURANT_LAYOUT_DEFINITION);