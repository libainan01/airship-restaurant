import type {
  CharacterPresentationItem,
  GameplayRestaurantCustomerSnapshot,
  GameplayRestaurantDiningCustomerSnapshot,
} from "@airship-restaurant/contracts";
import {
  createDefaultRestaurantLayoutRuntime,
  type RestaurantLayoutRuntime,
  type RestaurantPositionSlotInstance,
} from "./restaurant-layout";
import type {
  RestaurantGuestMealStatus,
  RestaurantNpcAction,
  RestaurantNpcConversationPresentation,
  RestaurantNpcFrame,
  RestaurantNpcPresentation,
  RestaurantNpcUpdateInput,
} from "./restaurant-npc-presentation";

export type {
  RestaurantGuestMealStatus,
  RestaurantKitchenNotificationPresentation,
  RestaurantNpcAction,
  RestaurantNpcConversationPresentation,
  RestaurantNpcDeliveryPresentation,
  RestaurantNpcFrame,
  RestaurantNpcKind,
  RestaurantNpcOrderConfirmationPresentation,
  RestaurantNpcPresentation,
  RestaurantNpcUpdateInput,
} from "./restaurant-npc-presentation";

interface GuestFact {
  readonly customerId: string;
  readonly action: RestaurantNpcAction;
  readonly mealStatus: RestaurantGuestMealStatus;
}

const CORE_ACTORS = Object.freeze({
  "character.baiyecheng": Object.freeze({
    instanceId: "npc.baiyecheng",
    kind: "baiyecheng" as const,
    speakerId: "speaker.baiyecheng",
    speakerName: "白夜城",
    xRatio: 0.21,
    yRatio: 0.765,
    facing: 1 as const,
  }),
  "character.otto": Object.freeze({
    instanceId: "npc.otto",
    kind: "otto" as const,
    speakerId: "speaker.otto",
    speakerName: "奥托",
    xRatio: 0.82,
    yRatio: 0.765,
    facing: -1 as const,
  }),
});

function safeActorSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "unknown";
}

function activeGuestFact(customer: GameplayRestaurantCustomerSnapshot): GuestFact {
  switch (customer.phase) {
    case "seated-idle":
      return { customerId: customer.id, action: "browsing-menu", mealStatus: "seated-idle" };
    case "awaiting-order-confirmation":
      return { customerId: customer.id, action: "calling-otto", mealStatus: "calling-otto" };
    case "confirming-order":
      return { customerId: customer.id, action: "ordering", mealStatus: "confirming-order" };
    case "notifying-kitchen":
      return { customerId: customer.id, action: "waiting", mealStatus: "notifying-kitchen" };
    case "waiting-meal":
      return { customerId: customer.id, action: "waiting", mealStatus: "awaiting-service" };
  }
}

function diningGuestFact(customer: GameplayRestaurantDiningCustomerSnapshot): GuestFact {
  return { customerId: customer.id, action: "eating", mealStatus: "served" };
}

function coreAction(character: CharacterPresentationItem | null): RestaurantNpcAction {
  switch (character?.action ?? "idle") {
    case "moving":
    case "boarding-elevator":
    case "alighting-elevator":
      return "walking";
    case "interacting":
      return "serving";
    case "waiting-elevator":
    case "riding-elevator":
    case "blocked":
      return "waiting";
    case "idle":
      return "idle";
  }
}

function createCoreActor(
  definitionId: keyof typeof CORE_ACTORS,
  character: CharacterPresentationItem | null,
): RestaurantNpcPresentation {
  const defaults = CORE_ACTORS[definitionId];
  const onGround = character?.navigationAreaId === "area.restaurant.ground";
  return Object.freeze({
    instanceId: defaults.instanceId,
    kind: defaults.kind,
    xRatio: onGround && character?.x !== null && character?.x !== undefined
      ? character.x
      : defaults.xRatio,
    yRatio: onGround && character?.y !== null && character?.y !== undefined
      ? character.y
      : defaults.yRatio,
    facing: defaults.facing,
    action: coreAction(character),
    visible: character === null || onGround,
    positionSlotId: null,
    speakerId: defaults.speakerId,
    speakerName: defaults.speakerName,
    conversationParticipant: false,
    activeSpeaker: false,
    trayVisible: false,
    customerId: null,
    mealStatus: "ambient",
  });
}

function createGuestActor(
  fact: GuestFact,
  seat: RestaurantPositionSlotInstance,
): RestaurantNpcPresentation {
  return Object.freeze({
    instanceId: `npc.customer.${safeActorSegment(fact.customerId)}`,
    kind: "guest",
    xRatio: seat.xRatio,
    yRatio: seat.yRatio,
    facing: seat.facing,
    action: fact.action,
    visible: true,
    positionSlotId: seat.id,
    speakerId: null,
    speakerName: null,
    conversationParticipant: false,
    activeSpeaker: false,
    trayVisible: false,
    customerId: fact.customerId,
    mealStatus: fact.mealStatus,
  });
}

function createOffstageGuest(index: number): RestaurantNpcPresentation {
  return Object.freeze({
    instanceId: `npc.guest.${index}`,
    kind: "guest",
    xRatio: 0.11,
    yRatio: 0.765,
    facing: 1,
    action: "idle",
    visible: false,
    positionSlotId: null,
    speakerId: null,
    speakerName: null,
    conversationParticipant: false,
    activeSpeaker: false,
    trayVisible: false,
    customerId: null,
    mealStatus: "ambient",
  });
}

function assignConversation(
  actors: readonly RestaurantNpcPresentation[],
  input: RestaurantNpcUpdateInput,
  seats: readonly RestaurantPositionSlotInstance[],
): {
  readonly actors: readonly RestaurantNpcPresentation[];
  readonly conversation: RestaurantNpcConversationPresentation | null;
} {
  const dialogue = input.dialogue;
  if (dialogue === null) {
    return { actors, conversation: null };
  }
  const mutable = actors.map((actor) => ({ ...actor }));
  const assignedActorIds = new Set<string>();
  const participantActorIds: string[] = [];
  const speakerActors = new Map<string, string>();
  const availableGuests = mutable.filter((actor) => actor.kind === "guest" && actor.visible);

  for (const [index, participant] of dialogue.participants.entries()) {
    const persistentId = participant.speakerId === "speaker.baiyecheng"
      ? "npc.baiyecheng"
      : participant.speakerId === "speaker.otto"
        ? "npc.otto"
        : null;
    let actor = persistentId === null
      ? availableGuests.find((candidate) => !assignedActorIds.has(candidate.instanceId))
      : mutable.find((candidate) => candidate.instanceId === persistentId);
    if (actor === undefined) {
      const seat = seats[index % Math.max(1, seats.length)];
      if (seat === undefined) continue;
      actor = {
        ...createGuestActor(
          { customerId: `dialogue-${participant.speakerId}`, action: "talking", mealStatus: "ambient" },
          seat,
        ),
        instanceId: `npc.dialogue.${safeActorSegment(participant.speakerId)}`,
        customerId: null,
      };
      mutable.push(actor);
    }
    assignedActorIds.add(actor.instanceId);
    participantActorIds.push(actor.instanceId);
    speakerActors.set(participant.speakerId, actor.instanceId);
    actor.speakerId = participant.speakerId;
    actor.speakerName = participant.speakerName;
    actor.conversationParticipant = true;
    actor.activeSpeaker = participant.speakerId === dialogue.speakerId;
    actor.action = actor.kind === "otto" ? "listening" : "talking";
  }

  if (dialogue.participants.length === 1 && !assignedActorIds.has("npc.otto")) {
    const otto = mutable.find((actor) => actor.instanceId === "npc.otto");
    if (otto !== undefined && otto.visible) {
      otto.conversationParticipant = true;
      otto.action = "listening";
      assignedActorIds.add(otto.instanceId);
      participantActorIds.push(otto.instanceId);
    }
  }

  return {
    actors: Object.freeze(mutable.map((actor) => Object.freeze(actor))),
    conversation: Object.freeze({
      dialogueId: dialogue.dialogueId,
      ready: true,
      activeSpeakerActorId: speakerActors.get(dialogue.speakerId) ?? null,
      participantActorIds: Object.freeze(participantActorIds),
    }),
  };
}

/**
 * Pure renderer-side projection. It never creates tasks, advances customer phases,
 * reserves seats, or decides work for Otto.
 */
export class RestaurantNpcProjector {
  readonly #layout: RestaurantLayoutRuntime;

  constructor(layout: RestaurantLayoutRuntime = createDefaultRestaurantLayoutRuntime()) {
    this.#layout = layout;
  }

  project(input: RestaurantNpcUpdateInput): RestaurantNpcFrame {
    const seatCapacity = input.seatCapacity ?? input.restaurant?.seatCapacity ?? 3;
    this.#layout.setSeatCapacity(seatCapacity);
    const characterByDefinition = new Map(
      (input.characters?.characters ?? []).map((character) => [character.definitionId, character]),
    );
    const actors: RestaurantNpcPresentation[] = [
      createCoreActor("character.baiyecheng", characterByDefinition.get("character.baiyecheng") ?? null),
      createCoreActor("character.otto", characterByDefinition.get("character.otto") ?? null),
    ];
    const seats = this.#layout.getPositionSlots("seat");
    const facts: GuestFact[] = [
      ...(input.restaurant?.activeCustomer === null || input.restaurant === null
        ? []
        : [activeGuestFact(input.restaurant.activeCustomer)]),
      ...(input.restaurant?.diningCustomers.map(diningGuestFact) ?? []),
    ];
    const sortedFacts = [...facts].sort((left, right) => left.customerId.localeCompare(right.customerId));
    for (const [index, fact] of sortedFacts.entries()) {
      const seat = seats[index];
      if (seat !== undefined) actors.push(createGuestActor(fact, seat));
    }
    for (let index = sortedFacts.length; index < seatCapacity; index += 1) {
      actors.push(createOffstageGuest(index));
    }

    const conversationProjection = assignConversation(actors, input, seats);
    const active = input.restaurant?.activeCustomer ?? null;
    const activeActor = active === null
      ? null
      : conversationProjection.actors.find((actor) => actor.customerId === active.id) ?? null;
    const ottoTaskType = characterByDefinition.get("character.otto")?.task?.type ?? null;
    const orderConfirmation =
      activeActor !== null &&
      (ottoTaskType === "restaurant.take-order" || ottoTaskType === "restaurant.confirm-order")
        ? Object.freeze({
            targetActorId: activeActor.instanceId,
            customerId: active!.id,
            phase: active!.phase === "confirming-order" ? "confirming" as const : "approaching" as const,
          })
        : null;
    const ottoCharacter = characterByDefinition.get("character.otto");
    const deliveryCustomerId = ottoCharacter?.task?.type === "restaurant.deliver-meal"
      ? ottoCharacter.target?.id ?? null
      : null;
    const deliveryActor = deliveryCustomerId === null
      ? null
      : conversationProjection.actors.find((actor) => actor.customerId === deliveryCustomerId) ?? null;
    const delivery = deliveryActor === null
      ? null
      : Object.freeze({ targetActorId: deliveryActor.instanceId, customerId: deliveryActor.customerId });
    const projectedActors = delivery === null
      ? conversationProjection.actors
      : Object.freeze(conversationProjection.actors.map((actor) =>
          actor.instanceId === "npc.otto"
            ? Object.freeze({ ...actor, trayVisible: true })
            : actor,
        ));
    const kitchenNotification = active?.phase === "notifying-kitchen"
      ? Object.freeze({
          customerId: active.id,
          recipeId: active.recipeId,
          channelId: "restaurant-order-channel",
          phase: "sending" as const,
        })
      : null;

    return Object.freeze({
      actors: projectedActors,
      conversation: conversationProjection.conversation,
      dialogueOpportunity: null,
      delivery,
      orderConfirmation,
      kitchenNotification,
    });
  }
}