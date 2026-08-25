import { describe, expect, it } from "vitest";
import {
  getCommandId,
  isDesktopInteractionRequest,
  isGameCommand,
  isRuntimeReadModelKey,
} from "../src";

describe("isGameCommand", () => {
  it("accepts a valid quiet-mode command", () => {
    expect(
      isGameCommand({
        id: "command-1",
        type: "settings.set-quiet-mode",
        payload: { enabled: true },
      }),
    ).toBe(true);
  });

  it("validates NPC ambient-dialogue opportunity commands", () => {
    expect(
      isGameCommand({
        id: "npc-dialogue-1",
        type: "dialogue.request-ambient",
        payload: {
          opportunityId: "npc-opportunity-1",
          context: "eating",
          availableSpeakerCount: 2,
        },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "npc-dialogue-invalid",
        type: "dialogue.request-ambient",
        payload: {
          opportunityId: "npc-opportunity-invalid",
          context: "unknown",
          availableSpeakerCount: 2,
        },
      }),
    ).toBe(false);
    expect(
      isGameCommand({
        id: "npc-dialogue-empty",
        type: "dialogue.request-ambient",
        payload: {
          opportunityId: "npc-opportunity-empty",
          context: "waiting",
          availableSpeakerCount: 0,
        },
      }),
    ).toBe(false);
  });

  it("accepts validated gameplay operation commands", () => {
    expect(
      isGameCommand({
        id: "select-menu-1",
        type: "gameplay.select-recipe",
        payload: { recipeId: "recipe.windroot_soup" },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "auto-repeat-off",
        type: "gameplay.set-auto-repeat",
        payload: { enabled: false },
      }),
    ).toBe(true);
  });


  it("validates technology node upgrade commands", () => {
    expect(isGameCommand({
      id: "technology-cargo-speed-1",
      type: "technology.upgrade-node",
      payload: { nodeId: "technology.cargo_lift_speed" },
    })).toBe(true);
    expect(isGameCommand({
      id: "technology-invalid",
      type: "technology.upgrade-node",
      payload: { nodeId: "" },
    })).toBe(false);
  });
  it("validates scene edit mode commands", () => {
    expect(isGameCommand({
      id: "scene-edit-enter-1",
      type: "scene-edit.enter",
      payload: { sceneId: "scene.greyfeather" },
    })).toBe(true);
    expect(isGameCommand({
      id: "scene-edit-exit-1",
      type: "scene-edit.exit",
      payload: {},
    })).toBe(true);
    expect(isGameCommand({
      id: "scene-edit-invalid",
      type: "scene-edit.exit",
      payload: { force: true },
    })).toBe(false);
  });
  it("accepts bounded narrative event commands", () => {
    expect(
      isGameCommand({
        id: "view-story-1",
        type: "narrative.mark-viewed",
        payload: { eventId: "story.first_meal" },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "complete-story-1",
        type: "narrative.complete",
        payload: { eventId: "story.first_meal" },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "complete-story-invalid",
        type: "narrative.complete",
        payload: { eventId: "" },
      }),
    ).toBe(false);
  });

  it("rejects malformed gameplay operation commands", () => {
    expect(
      isGameCommand({
        id: "select-menu-1",
        type: "gameplay.select-recipe",
        payload: { recipeId: "" },
      }),
    ).toBe(false);
    expect(
      isGameCommand({
        id: "auto-repeat-off",
        type: "gameplay.set-auto-repeat",
        payload: { enabled: "no" },
      }),
    ).toBe(false);
  });

  it("rejects retired Demo commands at the formal IPC boundary", () => {
    expect(isGameCommand({ id: "demo-procurement-1", type: "demo.submit-recipe-procurement", payload: {} })).toBe(false);
    expect(isGameCommand({ id: "demo-open-1", type: "demo.start-business", payload: {} })).toBe(false);
    expect(isGameCommand({ id: "presentation-demo-1", type: "presentation.start-demo", payload: { scenario: "layout" } })).toBe(false);
  });

  it("rejects malformed IPC payloads", () => {
    expect(
      isGameCommand({
        id: "command-1",
        type: "settings.set-quiet-mode",
        payload: { enabled: "yes" },
      }),
    ).toBe(false);
    expect(isGameCommand(null)).toBe(false);
  });
});

describe("getCommandId", () => {
  it("extracts only bounded non-empty ids", () => {
    expect(getCommandId({ id: "command-1" })).toBe("command-1");
    expect(getCommandId({ id: "" })).toBeNull();
    expect(getCommandId({ id: "x".repeat(129) })).toBeNull();
  });
});

describe("isDesktopInteractionRequest", () => {
  it("accepts bounded interaction state changes", () => {
    expect(
      isDesktopInteractionRequest({
        interactive: true,
        reason: "airship",
      }),
    ).toBe(true);
    expect(
      isDesktopInteractionRequest({
        interactive: false,
        reason: "desktop",
      }),
    ).toBe(true);
  });

  it("rejects malformed and unbounded requests", () => {
    expect(
      isDesktopInteractionRequest({
        interactive: "yes",
        reason: "airship",
      }),
    ).toBe(false);
    expect(
      isDesktopInteractionRequest({
        interactive: true,
        reason: "",
      }),
    ).toBe(false);
    expect(
      isDesktopInteractionRequest({
        interactive: true,
        reason: "x".repeat(65),
      }),
    ).toBe(false);
  });
});

describe("procurement command contracts", () => {
  it("accepts bounded orders and automation policies", () => {
    expect(isGameCommand({
      id: "procurement-order-1",
      type: "gameplay.place-procurement-order",
      payload: {
        items: [
          { itemId: "ingredient.cloud_wheat", quantity: 4 },
          { itemId: "ingredient.kettle_milk", quantity: 2 },
        ],
      },
    })).toBe(true);
    expect(isGameCommand({
      id: "procurement-auto-1",
      type: "gameplay.configure-procurement-automation",
      payload: {
        reserveCopper: 30,
        policies: [
          {
            itemId: "ingredient.cloud_wheat",
            threshold: 2,
            target: 6,
          },
        ],
      },
    })).toBe(true);
  });

  it("rejects empty, negative, and inverted procurement quantities", () => {
    expect(isGameCommand({
      id: "procurement-empty",
      type: "gameplay.place-procurement-order",
      payload: { items: [] },
    })).toBe(false);
    expect(isGameCommand({
      id: "procurement-negative",
      type: "gameplay.place-procurement-order",
      payload: {
        items: [{ itemId: "ingredient.cloud_wheat", quantity: -1 }],
      },
    })).toBe(false);
    expect(isGameCommand({
      id: "procurement-auto-invalid",
      type: "gameplay.configure-procurement-automation",
      payload: {
        reserveCopper: 30,
        policies: [
          {
            itemId: "ingredient.cloud_wheat",
            threshold: 6,
            target: 6,
          },
        ],
      },
    })).toBe(false);
  });
});

describe("recruitment command contracts", () => {
  it("accepts bounded refresh and overnight-shift hire commands", () => {
    expect(isGameCommand({
      id: "recruitment-refresh-1",
      type: "recruitment.refresh",
      payload: { kind: "manual" },
    })).toBe(true);
    expect(isGameCommand({
      id: "recruitment-hire-1",
      type: "recruitment.hire",
      payload: {
        candidateId: "candidate.recruitment.1.1",
        shiftStartMinuteInclusive: 1_080,
        shiftEndMinuteExclusive: 120,
      },
    })).toBe(true);
  });

  it("rejects unknown refresh kinds and invalid shift boundaries", () => {
    expect(isGameCommand({
      id: "recruitment-refresh-invalid",
      type: "recruitment.refresh",
      payload: { kind: "automatic" },
    })).toBe(false);
    expect(isGameCommand({
      id: "recruitment-hire-invalid",
      type: "recruitment.hire",
      payload: {
        candidateId: "candidate.recruitment.1.1",
        shiftStartMinuteInclusive: 480,
        shiftEndMinuteExclusive: 480,
      },
    })).toBe(false);
  });
});

describe("employment command contracts", () => {
  it("accepts primary-job, continuous-shift and dismissal commands", () => {
    expect(isGameCommand({
      id: "employment-job-1",
      type: "employment.set-primary-job",
      payload: { characterId: "instance.character.worker", jobId: "job.waiter" },
    })).toBe(true);
    expect(isGameCommand({
      id: "employment-shift-1",
      type: "employment.set-daily-shift",
      payload: {
        characterId: "instance.character.worker",
        startMinuteInclusive: 1_080,
        endMinuteExclusive: 120,
      },
    })).toBe(true);
    expect(isGameCommand({
      id: "employment-dismiss-1",
      type: "employment.request-dismissal",
      payload: { characterId: "instance.character.worker" },
    })).toBe(true);
  });

  it("rejects empty identifiers and zero-length shifts", () => {
    expect(isGameCommand({
      id: "employment-job-invalid",
      type: "employment.set-primary-job",
      payload: { characterId: "", jobId: "job.waiter" },
    })).toBe(false);
    expect(isGameCommand({
      id: "employment-shift-invalid",
      type: "employment.set-daily-shift",
      payload: {
        characterId: "instance.character.worker",
        startMinuteInclusive: 480,
        endMinuteExclusive: 480,
      },
    })).toBe(false);
  });
});
describe("runtime read-model keys", () => {
  it("recognizes recruitment as a subscribable functional slice", () => {
    expect(isRuntimeReadModelKey("recruitment")).toBe(true);
  });
});