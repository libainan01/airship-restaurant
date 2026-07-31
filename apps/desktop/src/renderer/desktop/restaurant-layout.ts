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
}

export interface RestaurantFunctionalPosition {
  readonly id: string;
  readonly xRatio: number;
  readonly yRatio: number;
  readonly facing: -1 | 1;
  readonly parentPropId?: string;
  readonly tags: readonly string[];
  readonly enabled?: boolean;
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

const createProp = (
  instance: RestaurantLayoutPropInstance,
): RestaurantLayoutPropInstance =>
  Object.freeze({
    ...instance,
    transform: Object.freeze({ ...instance.transform }),
    dimensions: Object.freeze({ ...instance.dimensions }),
    capabilities: Object.freeze([...instance.capabilities]),
    tags: Object.freeze([...instance.tags]),
  });

const CONVERSATION_SLOT_IDS = Object.freeze([
  "position.conversation.far-left",
  "position.conversation.inner-left",
  "position.conversation.center",
  "position.conversation.inner-right",
  "position.conversation.far-right",
] as const);

const createConversationSlot = (
  id: string,
  xRatio: number,
  facing: -1 | 1,
): RestaurantPositionSlotInstance =>
  Object.freeze({
    id,
    kind: "conversation",
    xRatio,
    yRatio: 0.765,
    facing,
    parentPropId: "prop.table.center",
    priority: 0,
    conflictsWith: Object.freeze(["position.seat.center"]),
    tags: Object.freeze(["dialogue", "table-side"]),
  });

export const DEFAULT_RESTAURANT_LAYOUT_DEFINITION: RestaurantLayoutDefinition =
  Object.freeze({
    schemaVersion: 1,
    layoutId: "restaurant.home-port.default",
    props: Object.freeze([
      ...[0.2, 0.4, 0.6, 0.8].map((xRatio, index) =>
        createProp({
          id: `prop.pillar.${index + 1}`,
          kind: "pillar",
          visualKey: "placeholder.restaurant.pillar",
          renderLayer: "background",
          transform: {
            xRatio,
            yRatio: 0.5,
            offsetYPx: 14,
            originX: 0.5,
            originY: 0.5,
          },
          dimensions: {
            widthPx: 10,
            heightRatio: 1,
            heightOffsetPx: -28,
          },
          capabilities: ["structural"],
          tags: ["wall-support"],
        }),
      ),
      ...[0.3, 0.5, 0.7].map((xRatio, index) =>
        createProp({
          id: `prop.window.${index + 1}`,
          kind: "window",
          visualKey: "placeholder.restaurant.window",
          renderLayer: "background",
          transform: {
            xRatio,
            yRatio: 0.48,
            originX: 0.5,
            originY: 0.5,
          },
          dimensions: { widthPx: 92, heightPx: 56 },
          capabilities: [],
          tags: ["wall-fixture"],
        }),
      ),
      ...([
        ["left", 0.32],
        ["center", 0.5],
        ["right", 0.68],
      ] as const).map(([name, xRatio]) =>
        createProp({
          id: `prop.table.${name}`,
          kind: "table",
          visualKey: "placeholder.restaurant.table",
          renderLayer: "furniture",
          transform: {
            xRatio,
            yRatio: 0.76,
            originX: 0.5,
            originY: 0.5,
          },
          dimensions: { widthPx: 76, heightPx: 13 },
          capabilities: ["seating", "upgradeable"],
          tags: ["guest-table", `table-${name}`],
        }),
      ),
      createProp({
        id: "prop.counter.service",
        kind: "counter",
        visualKey: "placeholder.restaurant.service-counter",
        renderLayer: "furniture",
        transform: {
          xRatio: 1,
          yRatio: 0.63,
          offsetXPx: -128,
          originX: 0.5,
          originY: 0.5,
        },
        dimensions: { widthPx: 154, heightRatio: 0.42 },
        capabilities: ["service", "upgradeable"],
        tags: ["otto-work-area", "food-pickup"],
      }),
      ...[0.25, 0.75].map((xRatio, index) =>
        createProp({
          id: `prop.lamp.${index + 1}`,
          kind: "lamp",
          visualKey: "placeholder.restaurant.hanging-lamp",
          renderLayer: "lighting",
          transform: {
            xRatio,
            yRatio: 0.38,
            originX: 0.5,
            originY: 0.5,
          },
          dimensions: { widthPx: 20, heightPx: 20 },
          capabilities: ["lighting", "upgradeable"],
          tags: ["hanging", "ambient-light"],
        }),
      ),
    ]),
    anchors: Object.freeze([
      Object.freeze({
        id: "anchor.guest.entry",
        role: "guest-entry",
        xRatio: 0.11,
        yRatio: 0.765,
        facing: 1,
        tags: Object.freeze(["guest-flow"]),
      }),
      Object.freeze({
        id: "anchor.guest.exit",
        role: "guest-exit",
        xRatio: 0.88,
        yRatio: 0.765,
        facing: 1,
        tags: Object.freeze(["guest-flow"]),
      }),
      Object.freeze({
        id: "anchor.otto.home",
        role: "otto-home",
        xRatio: 0.82,
        yRatio: 0.765,
        facing: -1,
        parentPropId: "prop.counter.service",
        tags: Object.freeze(["otto", "idle"]),
      }),
      Object.freeze({
        id: "anchor.otto.pickup",
        role: "otto-pickup",
        xRatio: 0.82,
        yRatio: 0.765,
        facing: -1,
        parentPropId: "prop.counter.service",
        tags: Object.freeze(["otto", "service"]),
      }),
      Object.freeze({
        id: "anchor.otto.delivery",
        role: "delivery-table",
        xRatio: 0.715,
        yRatio: 0.765,
        facing: -1,
        parentPropId: "prop.table.right",
        tags: Object.freeze(["otto", "service"]),
      }),
    ]),
    positionSlots: Object.freeze([
      ...([
        ["left", 0.32, "prop.table.left"],
        ["center", 0.5, "prop.table.center"],
        ["right", 0.68, "prop.table.right"],
      ] as const).map(([name, xRatio, parentPropId], index) =>
        Object.freeze({
          id: `position.seat.${name}`,
          kind: "seat" as const,
          xRatio,
          yRatio: 0.765,
          facing: index === 2 ? (-1 as const) : (1 as const),
          parentPropId,
          priority: index,
          conflictsWith: Object.freeze(
            name === "center" ? [...CONVERSATION_SLOT_IDS] : [],
          ),
          tags: Object.freeze(["ambient-guest", `seat-${name}`]),
        }),
      ),
      createConversationSlot(CONVERSATION_SLOT_IDS[0], 0.4, 1),
      createConversationSlot(CONVERSATION_SLOT_IDS[1], 0.45, 1),
      createConversationSlot(CONVERSATION_SLOT_IDS[2], 0.5, 1),
      createConversationSlot(CONVERSATION_SLOT_IDS[3], 0.55, -1),
      createConversationSlot(CONVERSATION_SLOT_IDS[4], 0.6, -1),
    ]),
    conversationFormations: Object.freeze([
      Object.freeze({
        id: "formation.conversation.2",
        participantCount: 2,
        slotIds: Object.freeze([
          "position.conversation.inner-left",
          "position.conversation.inner-right",
        ]),
      }),
      Object.freeze({
        id: "formation.conversation.3",
        participantCount: 3,
        slotIds: Object.freeze([
          "position.conversation.far-left",
          "position.conversation.center",
          "position.conversation.far-right",
        ]),
      }),
      Object.freeze({
        id: "formation.conversation.4",
        participantCount: 4,
        slotIds: Object.freeze([
          "position.conversation.far-left",
          "position.conversation.inner-left",
          "position.conversation.inner-right",
          "position.conversation.far-right",
        ]),
      }),
      Object.freeze({
        id: "formation.conversation.5",
        participantCount: 5,
        slotIds: CONVERSATION_SLOT_IDS,
      }),
    ]),
  });

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
      (prop) => isEnabled(prop) && (kind === undefined || prop.kind === kind),
    );
  }

  getPositionSlots(
    kind?: RestaurantPositionKind,
  ): readonly RestaurantPositionSlotInstance[] {
    return this.#definition.positionSlots
      .filter(
        (slot) =>
          isEnabled(slot) && (kind === undefined || slot.kind === kind),
      )
      .sort((left, right) => left.priority - right.priority);
  }

  requireProp(id: string): RestaurantLayoutPropInstance {
    const prop = this.#propsById.get(id);
    if (prop === undefined || !isEnabled(prop)) {
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
    if (slot === undefined || !isEnabled(slot)) {
      throw new Error(`Restaurant layout is missing enabled position '${id}'.`);
    }
    return slot;
  }

  getOccupant(slotId: string): string | null {
    return this.#slotOccupants.get(slotId) ?? null;
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