import { describe, expect, it } from "vitest";
import {
  AmbientDialogueSystem,
  type AmbientDialogueConfig,
} from "../src";

class SequenceRandom {
  readonly #values: readonly number[];
  #index = 0;

  constructor(values: readonly number[]) {
    this.#values = values;
  }

  nextFloat(): number {
    const value = this.#values[this.#index] ?? 0;
    this.#index += 1;
    return value;
  }
}

function config(
  id: string,
  overrides: Partial<AmbientDialogueConfig> = {},
): AmbientDialogueConfig {
  return {
    id,
    locationId: "location.test",
    contexts: ["arrival"],
    minimumFamiliarity: "new",
    weight: 1,
    cooldownMs: 0,
    maxPlaysPerSession: 1,
    prerequisiteEventIds: [],
    lineDurationsMs: [1_000, 2_000],
    ...overrides,
  };
}

function createSystem(
  dialogues: readonly AmbientDialogueConfig[],
  randomValues: readonly number[] = [0],
  minimumGapMs = 0,
): AmbientDialogueSystem {
  return new AmbientDialogueSystem({
    dialogues,
    random: new SequenceRandom(randomValues),
    locationId: "location.test",
    minimumGapMs,
    quietModeGapMultiplier: 3,
    returningAfterSales: 2,
    regularAfterSales: 4,
  });
}

describe("AmbientDialogueSystem", () => {
  it("plays one group line by line and respects session limits", () => {
    const system = createSystem([config("dialogue.test.first")]);

    expect(
      system.request({
        atUtcMs: 0,
        context: "arrival",
        familiarity: "new",
        completedStoryEventIds: [],
        quietMode: false,
      }),
    ).toMatchObject({
      changed: true,
      startedDialogueId: "dialogue.test.first",
      snapshot: {
        active: {
          dialogueId: "dialogue.test.first",
          lineIndex: 0,
          endsAtUtcMs: 1_000,
        },
      },
    });

    expect(system.advanceTo(1_000)).toMatchObject({
      changed: true,
      snapshot: {
        active: {
          dialogueId: "dialogue.test.first",
          lineIndex: 1,
          startedAtUtcMs: 1_000,
          endsAtUtcMs: 3_000,
        },
      },
    });
    expect(system.advanceTo(3_000)).toMatchObject({
      changed: true,
      snapshot: {
        active: null,
        lastCompletedDialogueId: "dialogue.test.first",
      },
    });
    expect(
      system.request({
        atUtcMs: 3_001,
        context: "arrival",
        familiarity: "regular",
        completedStoryEventIds: [],
        quietMode: false,
      }),
    ).toMatchObject({
      changed: false,
      startedDialogueId: null,
    });
  });

  it("filters by context, familiarity and story prerequisites", () => {
    const system = createSystem([
      config("dialogue.test.regular", {
        contexts: ["eating"],
        minimumFamiliarity: "regular",
        prerequisiteEventIds: ["story.done"],
        lineDurationsMs: [1_000],
      }),
    ]);

    expect(
      system.request({
        atUtcMs: 0,
        context: "waiting",
        familiarity: "regular",
        completedStoryEventIds: ["story.done"],
        quietMode: false,
      }).startedDialogueId,
    ).toBeNull();
    expect(
      system.request({
        atUtcMs: 1,
        context: "eating",
        familiarity: "returning",
        completedStoryEventIds: ["story.done"],
        quietMode: false,
      }).startedDialogueId,
    ).toBeNull();
    expect(
      system.request({
        atUtcMs: 2,
        context: "eating",
        familiarity: "regular",
        completedStoryEventIds: [],
        quietMode: false,
      }).startedDialogueId,
    ).toBeNull();
    expect(
      system.request({
        atUtcMs: 3,
        context: "eating",
        familiarity: "regular",
        completedStoryEventIds: ["story.done"],
        quietMode: false,
      }).startedDialogueId,
    ).toBe("dialogue.test.regular");
  });

  it("uses deterministic weighted selection", () => {
    const system = createSystem(
      [
        config("dialogue.test.light", {
          weight: 1,
          lineDurationsMs: [1_000],
        }),
        config("dialogue.test.heavy", {
          weight: 3,
          lineDurationsMs: [1_000],
        }),
      ],
      [0.5],
    );

    expect(
      system.request({
        atUtcMs: 0,
        context: "arrival",
        familiarity: "new",
        completedStoryEventIds: [],
        quietMode: false,
      }).startedDialogueId,
    ).toBe("dialogue.test.heavy");
  });

  it("derives customer context and applies the quiet-mode gap", () => {
    const system = createSystem(
      [
        config("dialogue.test.arrival", {
          contexts: ["arrival"],
          lineDurationsMs: [100],
        }),
        config("dialogue.test.eating", {
          contexts: ["eating"],
          lineDurationsMs: [100],
        }),
      ],
      [0, 0],
      100,
    );

    expect(
      system.observeOnline(
        {
          activeCustomerId: null,
          totalSoldQuantity: 0,
          totalCustomersLeft: 0,
        },
        {
          activeCustomerId: "customer-1",
          totalSoldQuantity: 0,
          totalCustomersLeft: 0,
        },
        [],
        false,
        0,
      ).startedDialogueId,
    ).toBe("dialogue.test.arrival");

    expect(
      system.observeOnline(
        {
          activeCustomerId: "customer-1",
          totalSoldQuantity: 0,
          totalCustomersLeft: 0,
        },
        {
          activeCustomerId: null,
          totalSoldQuantity: 1,
          totalCustomersLeft: 0,
        },
        [],
        true,
        100,
      ).startedDialogueId,
    ).toBeNull();

    expect(
      system.observeOnline(
        {
          activeCustomerId: null,
          totalSoldQuantity: 1,
          totalCustomersLeft: 0,
        },
        {
          activeCustomerId: null,
          totalSoldQuantity: 2,
          totalCustomersLeft: 0,
        },
        [],
        true,
        400,
      ).startedDialogueId,
    ).toBe("dialogue.test.eating");
  });

  it("rejects invalid configs and backwards time", () => {
    expect(() =>
      createSystem([
        config("dialogue.test.invalid", {
          lineDurationsMs: [],
        }),
      ]),
    ).toThrow(/Invalid ambient dialogue config/);

    const system = createSystem([config("dialogue.test.valid")]);
    system.advanceTo(10);
    expect(() => system.advanceTo(9)).toThrow(/move forward/);
  });
});
