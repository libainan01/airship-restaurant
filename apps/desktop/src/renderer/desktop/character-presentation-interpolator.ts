import type {
  CharacterPresentationAction,
  CharacterPresentationItem,
  CharacterPresentationReadModel,
} from "@airship-restaurant/contracts";
import type {
  RestaurantNpcAction,
  RestaurantNpcFrame,
  RestaurantNpcPresentation,
} from "./restaurant-npc-presentation";

interface VisualPosition {
  readonly x: number;
  readonly y: number;
  readonly facing: -1 | 1;
}

interface CharacterInterpolationState {
  readonly from: VisualPosition;
  readonly to: VisualPosition;
  readonly startedAtMs: number;
  readonly durationMs: number;
}

const ACTOR_IDS_BY_DEFINITION: Readonly<Record<string, string>> = Object.freeze({
  "character.baiyecheng": "npc.baiyecheng",
  "character.otto": "npc.otto",
});

function resolveNpcAction(action: CharacterPresentationAction): RestaurantNpcAction {
  switch (action) {
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

function sample(
  state: CharacterInterpolationState,
  timeMs: number,
): VisualPosition {
  const progress = state.durationMs <= 0
    ? 1
    : Math.max(0, Math.min(1, (timeMs - state.startedAtMs) / state.durationMs));
  return Object.freeze({
    x: state.from.x + (state.to.x - state.from.x) * progress,
    y: state.from.y + (state.to.y - state.from.y) * progress,
    facing: state.to.facing,
  });
}

export class CharacterPresentationInterpolator {
  readonly #states = new Map<string, CharacterInterpolationState>();
  #model: CharacterPresentationReadModel | null = null;

  apply(model: CharacterPresentationReadModel, receivedAtMs: number): void {
    this.#model = model;
    const activeIds = new Set<string>();
    for (const character of model.characters) {
      if (character.x === null || character.y === null) continue;
      activeIds.add(character.id);
      const previous = this.#states.get(character.id);
      const current = previous === undefined
        ? Object.freeze({ x: character.x, y: character.y, facing: 1 as const })
        : sample(previous, receivedAtMs);
      const deltaX = character.x - current.x;
      const facing: -1 | 1 = Math.abs(deltaX) < 0.0001
        ? current.facing
        : deltaX < 0 ? -1 : 1;
      const distance = Math.hypot(deltaX, character.y - current.y);
      this.#states.set(character.id, Object.freeze({
        from: current,
        to: Object.freeze({ x: character.x, y: character.y, facing }),
        startedAtMs: receivedAtMs,
        durationMs: Math.min(1_000, Math.max(80, distance * 1_200)),
      }));
    }
    for (const characterId of this.#states.keys()) {
      if (!activeIds.has(characterId)) this.#states.delete(characterId);
    }
  }

  project(frame: RestaurantNpcFrame, timeMs: number): RestaurantNpcFrame {
    if (this.#model === null) return frame;
    const charactersByActorId = new Map<string, CharacterPresentationItem>();
    for (const character of this.#model.characters) {
      const actorId = ACTOR_IDS_BY_DEFINITION[character.definitionId];
      if (actorId !== undefined) charactersByActorId.set(actorId, character);
    }
    const actors = frame.actors.map((actor): RestaurantNpcPresentation => {
      const character = charactersByActorId.get(actor.instanceId);
      if (
        character === undefined ||
        character.navigationAreaId !== "area.restaurant.ground"
      ) {
        return actor;
      }
      const state = this.#states.get(character.id);
      if (state === undefined) return actor;
      const position = sample(state, timeMs);
      return Object.freeze({
        ...actor,
        xRatio: position.x,
        yRatio: position.y,
        facing: position.facing,
        action: resolveNpcAction(character.action),
      });
    });
    return Object.freeze({ ...frame, actors: Object.freeze(actors) });
  }
}