import type {
  RestaurantLayoutDefinition,
  RestaurantLayoutPropInstance,
  RestaurantPositionSlotInstance,
} from "./restaurant-layout";

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
        ["left", 0.32, 3],
        ["center", 0.5, 3],
        ["right", 0.68, 3],
        ["expansion-1", 0.23, 4],
        ["expansion-2", 0.59, 5],
        ["expansion-3", 0.77, 6],
      ] as const).map(([name, xRatio, unlockSeatCapacity]) =>
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
          unlockSeatCapacity,
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
        ["left", 0.32, "prop.table.left", 3],
        ["center", 0.5, "prop.table.center", 3],
        ["right", 0.68, "prop.table.right", 3],
        ["expansion-1", 0.23, "prop.table.expansion-1", 4],
        ["expansion-2", 0.59, "prop.table.expansion-2", 5],
        ["expansion-3", 0.77, "prop.table.expansion-3", 6],
      ] as const).map(
        ([name, xRatio, parentPropId, unlockSeatCapacity], index) =>
          Object.freeze({
            id: `position.seat.${name}`,
            kind: "seat" as const,
            xRatio,
            yRatio: 0.765,
            facing: index === 2 || index === 5
              ? (-1 as const)
              : (1 as const),
            parentPropId,
            priority: index,
            conflictsWith: Object.freeze(
              name === "center" ? [...CONVERSATION_SLOT_IDS] : [],
            ),
            tags: Object.freeze(["ambient-guest", `seat-${name}`]),
            unlockSeatCapacity,
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
