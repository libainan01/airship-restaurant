import type { CharacterPresentationReadModel } from "@airship-restaurant/contracts";
import { describe, expect, it } from "vitest";
import { CharacterPresentationInterpolator } from "../src/renderer/desktop/character-presentation-interpolator";
import type { RestaurantNpcFrame } from "../src/renderer/desktop/restaurant-npc-presentation";

const frame: RestaurantNpcFrame = {
  actors: [{
    instanceId: "npc.otto",
    kind: "otto",
    xRatio: 0.1,
    yRatio: 0.2,
    facing: 1,
    action: "idle",
    visible: true,
    positionSlotId: null,
    speakerId: "speaker.otto",
    speakerName: "奥托",
    conversationParticipant: false,
    activeSpeaker: false,
    trayVisible: false,
    customerId: null,
    mealStatus: "ambient",
  }],
  conversation: null,
  dialogueOpportunity: null,
  delivery: null,
  orderConfirmation: null,
  kitchenNotification: null,
};

function model(x: number, action: CharacterPresentationReadModel["characters"][number]["action"]): CharacterPresentationReadModel {
  return {
    sourceRevision: 1,
    characters: [{
      id: "instance.character.otto_core",
      definitionId: "character.otto",
      name: "奥托",
      coreMember: true,
      navigationAreaId: "area.restaurant.ground",
      x,
      y: 0.6,
      action,
      target: null,
      task: null,
      tags: ["employee"],
      primaryJobId: "job.waiter",
      elevatorRequestId: null,
    }],
    personnelElevator: null,
  };
}

describe("CharacterPresentationInterpolator", () => {
  it("interpolates coordinates while taking action only from the read model", () => {
    const presenter = new CharacterPresentationInterpolator();
    presenter.apply(model(0.2, "idle"), 0);
    expect(presenter.project(frame, 0).actors[0]).toMatchObject({
      xRatio: 0.2,
      yRatio: 0.6,
      action: "idle",
    });

    presenter.apply(model(0.8, "moving"), 100);
    const halfway = presenter.project(frame, 460).actors[0]!;
    expect(halfway.xRatio).toBeGreaterThan(0.2);
    expect(halfway.xRatio).toBeLessThan(0.8);
    expect(halfway.action).toBe("walking");
    expect(presenter.project(frame, 1_000).actors[0]?.xRatio).toBe(0.8);
  });
});