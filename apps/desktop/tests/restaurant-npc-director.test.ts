import { describe, expect, it } from "vitest";
import type { DialogueBubblePresentation } from "../src/renderer/desktop/dialogue-bubble-presenter";
import {
  DEFAULT_RESTAURANT_LAYOUT_DEFINITION,
  RestaurantLayoutRuntime,
} from "../src/renderer/desktop/restaurant-layout";
import {
  RestaurantNpcDirector,
  type RestaurantNpcFrame,
} from "../src/renderer/desktop/restaurant-npc-director";

const OTTO_HOME_FOR_TEST = 0.82;

function createDialogue(
  activeSpeakerIndex: number,
  participantCount = 2,
): DialogueBubblePresentation {
  const participants = Array.from(
    { length: participantCount },
    (_, index) => ({
      speakerId: `speaker.${index}`,
      speakerName: `客人${index + 1}`,
    }),
  );
  const active = participants[activeSpeakerIndex];
  if (active === undefined) {
    throw new Error("Test dialogue active speaker is out of range.");
  }
  return {
    dialogueId: "dialogue.test",
    lineIndex: activeSpeakerIndex,
    speakerId: active.speakerId,
    speakerName: active.speakerName,
    text: `台词${activeSpeakerIndex + 1}`,
    participantIndex: activeSpeakerIndex,
    participants,
  };
}

function advance(
  director: RestaurantNpcDirector,
  fromTimeMs: number,
  toTimeMs: number,
  dialogue: DialogueBubblePresentation | null,
  deliveryRevision = 0,
): RestaurantNpcFrame {
  let frame = director.update({
    timeMs: fromTimeMs,
    dialogue,
    deliveryRevision,
  });
  for (
    let timeMs = fromTimeMs + 100;
    timeMs <= toTimeMs;
    timeMs += 100
  ) {
    frame = director.update({
      timeMs,
      dialogue,
      deliveryRevision,
    });
  }
  return frame;
}

describe("restaurant NPC director", () => {
  it("keeps stable NPC instances while ambient guests move", () => {
    const director = new RestaurantNpcDirector();
    const first = director.update({
      timeMs: 0,
      dialogue: null,
      deliveryRevision: 0,
    });
    const later = advance(director, 100, 1_000, null);

    expect(first.actors.map((actor) => actor.instanceId)).toEqual(
      later.actors.map((actor) => actor.instanceId),
    );
    const walkingGuestAtStart = first.actors.find(
      (actor) => actor.instanceId === "npc.guest.1",
    );
    const walkingGuestLater = later.actors.find(
      (actor) => actor.instanceId === "npc.guest.1",
    );
    expect(walkingGuestAtStart?.xRatio).toBe(0.11);
    expect(walkingGuestLater?.xRatio).toBeGreaterThan(0.11);
    expect(walkingGuestLater?.xRatio).toBeLessThan(0.5);
  });

  it("walks dialogue participants together before showing dialogue", () => {
    const director = new RestaurantNpcDirector();
    const ambient = director.update({
      timeMs: 0,
      dialogue: null,
      deliveryRevision: 0,
    });
    const dialogue = createDialogue(0);
    const joining = director.update({
      timeMs: 100,
      dialogue,
      deliveryRevision: 0,
    });

    expect(joining.conversation?.ready).toBe(false);
    for (const actorId of joining.conversation?.participantActorIds ?? []) {
      const before = ambient.actors.find(
        (actor) => actor.instanceId === actorId,
      );
      const after = joining.actors.find(
        (actor) => actor.instanceId === actorId,
      );
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(
        Math.abs((after?.xRatio ?? 0) - (before?.xRatio ?? 0)),
      ).toBeLessThanOrEqual(0.024);
      expect(after?.action).toBe("walking");
    }

    const ready = advance(director, 200, 2_000, dialogue);
    expect(ready.conversation?.ready).toBe(true);
    expect(
      ready.conversation?.participantActorIds,
    ).toHaveLength(2);
    expect(
      ready.actors.filter(
        (actor) => actor.conversationParticipant,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "talking" }),
        expect.objectContaining({ action: "talking" }),
      ]),
    );
  });

  it("keeps actor identities and positions stable when speakers change", () => {
    const director = new RestaurantNpcDirector();
    const firstLine = createDialogue(0);
    const ready = advance(director, 0, 2_000, firstLine);
    const beforeIds = ready.conversation?.participantActorIds;
    const beforePositions = new Map(
      ready.actors.map((actor) => [actor.instanceId, actor.xRatio]),
    );

    const secondLine = createDialogue(1);
    const switched = director.update({
      timeMs: 2_100,
      dialogue: secondLine,
      deliveryRevision: 0,
    });
    expect(switched.conversation?.participantActorIds).toEqual(beforeIds);
    expect(switched.conversation?.ready).toBe(true);
    for (const actorId of beforeIds ?? []) {
      const actor = switched.actors.find(
        (candidate) => candidate.instanceId === actorId,
      );
      expect(actor?.xRatio).toBe(beforePositions.get(actorId));
    }
    expect(
      switched.actors.find(
        (actor) => actor.speakerId === "speaker.1",
      )?.activeSpeaker,
    ).toBe(true);

    const ended = director.update({
      timeMs: 2_200,
      dialogue: null,
      deliveryRevision: 0,
    });
    expect(ended.conversation).toBeNull();
    for (const actorId of beforeIds ?? []) {
      const actor = ended.actors.find(
        (candidate) => candidate.instanceId === actorId,
      );
      expect(actor?.xRatio).toBe(beforePositions.get(actorId));
      expect(actor?.action).toBe("eating");
    }
  });

  it("lets Otto walk to a lone speaker and handles deliveries as tasks", () => {
    const director = new RestaurantNpcDirector();
    const initial = director.update({
      timeMs: 0,
      dialogue: null,
      deliveryRevision: 0,
    });
    const ottoAtHome = initial.actors.find(
      (actor) => actor.instanceId === "npc.otto",
    );
    const singleSpeaker = createDialogue(0, 1);
    const joining = director.update({
      timeMs: 100,
      dialogue: singleSpeaker,
      deliveryRevision: 0,
    });
    const movingOtto = joining.actors.find(
      (actor) => actor.instanceId === "npc.otto",
    );
    expect(movingOtto?.xRatio).toBeLessThan(ottoAtHome?.xRatio ?? 0);
    expect(
      (ottoAtHome?.xRatio ?? 0) - (movingOtto?.xRatio ?? 0),
    ).toBeLessThanOrEqual(0.028);
    expect(joining.conversation?.ready).toBe(false);

    const listening = advance(
      director,
      200,
      2_000,
      singleSpeaker,
    );
    expect(listening.conversation?.ready).toBe(true);
    expect(
      listening.actors.find(
        (actor) => actor.instanceId === "npc.otto",
      )?.action,
    ).toBe("listening");

    director.update({
      timeMs: 2_100,
      dialogue: null,
      deliveryRevision: 1,
    });
    const carrying = advance(director, 2_200, 4_000, null, 1);
    const ottoDelivering = carrying.actors.find(
      (actor) => actor.instanceId === "npc.otto",
    );
    expect(ottoDelivering?.xRatio).toBeLessThan(OTTO_HOME_FOR_TEST);
    expect(ottoDelivering?.trayVisible).toBe(true);
  });

  it("finishes an active delivery before joining a conversation", () => {
    const director = new RestaurantNpcDirector();
    director.update({
      timeMs: 0,
      dialogue: null,
      deliveryRevision: 0,
    });
    director.update({
      timeMs: 100,
      dialogue: null,
      deliveryRevision: 1,
    });
    const serving = advance(director, 200, 1_200, null, 1);
    expect(
      serving.actors.find(
        (actor) => actor.instanceId === "npc.otto",
      )?.trayVisible,
    ).toBe(true);

    const singleSpeaker = createDialogue(0, 1);
    const dialogueRequested = director.update({
      timeMs: 1_300,
      dialogue: singleSpeaker,
      deliveryRevision: 1,
    });
    const busyOtto = dialogueRequested.actors.find(
      (actor) => actor.instanceId === "npc.otto",
    );
    expect(busyOtto?.trayVisible).toBe(true);
    expect(dialogueRequested.conversation?.ready).toBe(false);

    const joining = advance(
      director,
      1_400,
      3_500,
      singleSpeaker,
      1,
    );
    expect(joining.conversation?.ready).toBe(false);
    expect(
      joining.actors.find(
        (actor) => actor.instanceId === "npc.otto",
      )?.action,
    ).toBe("walking");

    const ready = advance(
      director,
      3_600,
      4_700,
      singleSpeaker,
      1,
    );
    expect(ready.conversation?.ready).toBe(true);
    expect(
      ready.actors.find(
        (actor) => actor.instanceId === "npc.otto",
      )?.action,
    ).toBe("listening");
  });

  it("follows a customized layout instead of built-in coordinates", () => {
    const layout = new RestaurantLayoutRuntime({
      ...DEFAULT_RESTAURANT_LAYOUT_DEFINITION,
      layoutId: "restaurant.test.shifted",
      anchors: DEFAULT_RESTAURANT_LAYOUT_DEFINITION.anchors.map((anchor) =>
        anchor.role === "guest-entry"
          ? { ...anchor, xRatio: 0.06, yRatio: 0.8 }
          : anchor,
      ),
      positionSlots:
        DEFAULT_RESTAURANT_LAYOUT_DEFINITION.positionSlots.map((slot) =>
          slot.id === "position.seat.center"
            ? { ...slot, xRatio: 0.61, yRatio: 0.8 }
            : slot,
        ),
    });
    const director = new RestaurantNpcDirector(layout);
    const first = director.update({
      timeMs: 0,
      dialogue: null,
      deliveryRevision: 0,
    });
    const walkingGuest = first.actors.find(
      (actor) => actor.instanceId === "npc.guest.1",
    );

    expect(walkingGuest).toMatchObject({ xRatio: 0.06, yRatio: 0.8 });
    expect(walkingGuest?.positionSlotId).toBe("position.seat.center");

    const later = advance(director, 100, 500, null);
    const movedGuest = later.actors.find(
      (actor) => actor.instanceId === "npc.guest.1",
    );
    expect(movedGuest?.xRatio).toBeGreaterThan(0.06);
    expect(movedGuest?.yRatio).toBe(0.8);
  });});
