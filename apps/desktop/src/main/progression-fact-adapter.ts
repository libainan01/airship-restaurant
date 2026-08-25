import {
  type NarrativeSystem,
  type ProgressionFactPort,
  type TechnologyModule,
  type StoryRosterModule,
} from "@airship-restaurant/core";

/** Bridges existing read-only business facts into data-driven progression conditions. */
export class DesktopProgressionFactAdapter implements ProgressionFactPort {
  readonly #narrative: NarrativeSystem;
  readonly #technology: TechnologyModule;
  readonly #storyRoster: StoryRosterModule;

  constructor(options: {
    readonly narrative: NarrativeSystem;
    readonly technology: TechnologyModule;
    readonly storyRoster: StoryRosterModule;
  }) {
    this.#narrative = options.narrative;
    this.#technology = options.technology;
    this.#storyRoster = options.storyRoster;
  }

  getFactValue(factId: string): boolean | number | null {
    if (factId.startsWith("story_node.") && factId.endsWith(".completed")) {
      const nodeId = factId.slice(0, -".completed".length);
      return this.#storyRoster.exportState().characters.some((character) =>
        character.completedNodes.some((node) => node.nodeId === nodeId),
      );
    }
    if (factId.startsWith("story.") && factId.endsWith(".completed")) {
      const eventId = factId.slice(0, -".completed".length);
      return this.#narrative.getSnapshot().events.some(
        (event) => event.eventId === eventId && event.status === "completed",
      );
    }
    if (factId.startsWith("technology.") && factId.endsWith(".level")) {
      const nodeId = factId.slice(0, -".level".length);
      return this.#technology.getLevel(nodeId);
    }
    return null;
  }
}