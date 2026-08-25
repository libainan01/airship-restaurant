import type {
  CharacterPresentationReadModel,
  GameplayRestaurantCustomerPhase,
  GameplayRestaurantSnapshot,
} from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import type { DialogueBubblePresentation } from "../src/renderer/desktop/dialogue-bubble-presenter";
import { RestaurantNpcProjector } from "../src/renderer/desktop/restaurant-npc-projector";

function restaurant(
  phase: GameplayRestaurantCustomerPhase | null = "seated-idle",
): GameplayRestaurantSnapshot {
  return {
    selectedRecipeId: "recipe.test",
    activeCustomer: phase === null
      ? null
      : {
          id: "customer.active",
          recipeId: "recipe.test",
          dishItemId: "dish.test",
          arrivedAtUtcMs: 1_000,
          leaveAtUtcMs: 90_000,
          phase,
          phaseEndsAtUtcMs: phase === "waiting-meal" ? null : 8_000,
        },
    diningCustomers: [],
    seatCapacity: 3,
    nextCustomerAtUtcMs: null,
    totalSoldQuantity: 0,
    totalCustomersLeft: 0,
    copperBalance: 0,
    totalCopperSpent: 0,
    soldByDish: [],
    recentSales: [],
    nextTransitionUtcMs: null,
  };
}

function characters(
  ottoTask: "restaurant.confirm-order" | "restaurant.deliver-meal" | null = null,
): CharacterPresentationReadModel {
  return {
    sourceRevision: 1,
    characters: [
      {
        id: "instance.character.baiyecheng_core",
        definitionId: "character.baiyecheng",
        name: "白夜城",
        coreMember: true,
        navigationAreaId: "area.restaurant.ground",
        x: 0.21,
        y: 0.765,
        action: "idle",
        target: null,
        task: null,
        tags: ["employee"],
        primaryJobId: "job.chef",
        elevatorRequestId: null,
      },
      {
        id: "instance.character.otto_core",
        definitionId: "character.otto",
        name: "奥托",
        coreMember: true,
        navigationAreaId: "area.restaurant.ground",
        x: 0.82,
        y: 0.765,
        action: ottoTask === null ? "idle" : "interacting",
        target: ottoTask === null
          ? null
          : { type: "customer", id: "customer.active", interactionId: null },
        task: ottoTask === null
          ? null
          : { id: `task.${ottoTask}`, type: ottoTask, status: "in-progress" },
        tags: ["employee"],
        primaryJobId: "job.waiter",
        elevatorRequestId: null,
      },
    ],
    personnelElevator: null,
  };
}

function dialogue(): DialogueBubblePresentation {
  return {
    dialogueId: "dialogue.test",
    kind: "ambient",
    contexts: ["waiting"],
    lineIndex: 0,
    speakerId: "speaker.guest",
    speakerName: "客人",
    text: "今天吃点什么？",
    participantIndex: 0,
    participants: [{ speakerId: "speaker.guest", speakerName: "客人" }],
  };
}

function update(
  projector: RestaurantNpcProjector,
  options: {
    readonly restaurant?: GameplayRestaurantSnapshot | null;
    readonly characters?: CharacterPresentationReadModel | null;
    readonly dialogue?: DialogueBubblePresentation | null;
    readonly timeMs?: number;
  } = {},
) {
  return projector.project({
    timeMs: options.timeMs ?? 0,
    nowUtcMs: 10_000,
    dialogue: options.dialogue ?? null,
    restaurant: options.restaurant === undefined ? restaurant() : options.restaurant,
    characters: options.characters === undefined ? characters() : options.characters,
  });
}

describe("RestaurantNpcProjector pure presentation", () => {
  it("rebuilds the same actor frame from the same read-only inputs", () => {
    const inputRestaurant = restaurant("waiting-meal");
    const first = update(new RestaurantNpcProjector(), {
      restaurant: inputRestaurant,
      timeMs: 0,
    });
    const later = update(new RestaurantNpcProjector(), {
      restaurant: inputRestaurant,
      timeMs: 50_000,
    });

    expect(later).toEqual(first);
    expect(first.dialogueOpportunity).toBeNull();
  });

  it.each([
    ["seated-idle", "browsing-menu", "seated-idle"],
    ["awaiting-order-confirmation", "calling-otto", "calling-otto"],
    ["confirming-order", "ordering", "confirming-order"],
    ["notifying-kitchen", "waiting", "notifying-kitchen"],
    ["waiting-meal", "waiting", "awaiting-service"],
  ] as const)(
    "projects Core customer phase %s without advancing it",
    (phase, action, mealStatus) => {
      const frame = update(new RestaurantNpcProjector(), {
        restaurant: restaurant(phase),
      });
      expect(frame.actors.find((actor) => actor.customerId === "customer.active"))
        .toMatchObject({ action, mealStatus, visible: true });
    },
  );

  it("does not invent an Otto service assignment from a customer phase", () => {
    const frame = update(new RestaurantNpcProjector(), {
      restaurant: restaurant("confirming-order"),
      characters: characters(null),
    });

    expect(frame.actors.find((actor) => actor.kind === "otto")).toMatchObject({
      action: "idle",
      trayVisible: false,
    });
    expect(frame.orderConfirmation).toBeNull();
    expect(frame.delivery).toBeNull();
  });

  it("shows service cues only when the Core character task summary says so", () => {
    const confirming = update(new RestaurantNpcProjector(), {
      restaurant: restaurant("confirming-order"),
      characters: characters("restaurant.confirm-order"),
    });
    expect(confirming.orderConfirmation).toMatchObject({
      customerId: "customer.active",
      phase: "confirming",
    });

    const dining = {
      ...restaurant(null),
      diningCustomers: [{
        id: "customer.active",
        recipeId: "recipe.test",
        dishItemId: "dish.test",
        diningStartedAtUtcMs: 9_000,
        departAtUtcMs: 20_000,
      }],
    } satisfies GameplayRestaurantSnapshot;
    const delivering = update(new RestaurantNpcProjector(), {
      restaurant: dining,
      characters: characters("restaurant.deliver-meal"),
    });
    expect(delivering.delivery).toMatchObject({ customerId: "customer.active" });
    expect(delivering.actors.find((actor) => actor.kind === "otto")?.trayVisible).toBe(true);
  });

  it("projects dining customers directly onto unlocked seats", () => {
    const input = {
      ...restaurant(null),
      seatCapacity: 4,
      diningCustomers: [
        { id: "customer.b", recipeId: "recipe.test", dishItemId: "dish.test", diningStartedAtUtcMs: 2, departAtUtcMs: 20_000 },
        { id: "customer.a", recipeId: "recipe.test", dishItemId: "dish.test", diningStartedAtUtcMs: 1, departAtUtcMs: 20_000 },
      ],
    } satisfies GameplayRestaurantSnapshot;
    const frame = update(new RestaurantNpcProjector(), { restaurant: input });
    const guests = frame.actors.filter((actor) => actor.kind === "guest");

    expect(guests).toHaveLength(4);
    expect(guests.filter((actor) => actor.visible).map((actor) => actor.customerId))
      .toEqual(["customer.a", "customer.b"]);
    expect(guests.filter((actor) => actor.visible).every((actor) => actor.action === "eating"))
      .toBe(true);
  });

  it("binds dialogue speakers to existing natural positions without a conversation waypoint", () => {
    const frame = update(new RestaurantNpcProjector(), {
      dialogue: dialogue(),
      restaurant: restaurant("waiting-meal"),
    });
    const customer = frame.actors.find((actor) => actor.customerId === "customer.active");

    expect(frame.conversation).toMatchObject({
      ready: true,
      activeSpeakerActorId: customer?.instanceId,
    });
    expect(customer).toMatchObject({
      action: "talking",
      positionSlotId: "position.seat.left",
      conversationParticipant: true,
    });
    expect(frame.actors.find((actor) => actor.kind === "otto")).toMatchObject({
      action: "listening",
      xRatio: 0.82,
    });
  });
});