import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  MovementModule,
  TransactionScope,
  instanceId,
  type InteractionTargetResolver,
  type MovementTargetReference,
  type NavigationPlanner,
  type ResolvedInteractionTarget,
} from "../src";

class MutableTargets implements InteractionTargetResolver {
  value: ResolvedInteractionTarget | null = {
    revision: 1,
    candidates: [{
      id: "front",
      navigationAreaId: "area.ground",
      bounds: { x: 10, y: 0, width: 2, height: 2 },
      capacity: 1,
    }],
  };

  resolve(_target: MovementTargetReference): ResolvedInteractionTarget | null {
    return this.value;
  }
}

const target = { type: "building", id: "building.table", interactionId: "front" } as const;

function setup(options: { targets?: MutableTargets; navigationPlanner?: NavigationPlanner; ttl?: number; retries?: number } = {}) {
  const targets = options.targets ?? new MutableTargets();
  const movement = new MovementModule({
    targetResolver: targets,
    ...(options.navigationPlanner === undefined ? {} : { navigationPlanner: options.navigationPlanner }),
    ...(options.ttl === undefined ? {} : { reservationTtlMs: options.ttl }),
    ...(options.retries === undefined ? {} : { maximumReplanAttempts: options.retries }),
  });
  return { movement, targets };
}

describe("MovementModule", () => {
  it("uses the current position when a character is already inside a legal interaction area", () => {
    const { movement } = setup();
    const characterId = instanceId("instance.character.already_near");
    movement.registerCharacter("register", characterId, "area.ground", { x: 11, y: 1 });
    const result = movement.beginMovement("begin", {
      characterId,
      taskId: "task.interact",
      target,
      speedUnitsPerSecond: 10,
      occurredAtUtcMs: 1,
    });
    expect(result).toMatchObject({
      accepted: true,
      value: { status: "arrived", position: { x: 11, y: 1 }, plan: { destination: { x: 11, y: 1 } } },
      events: [{ type: "movement.arrived" }],
    });
  });

  it("reserves candidate capacity and releases it with the owning task", () => {
    const { movement } = setup();
    const first = instanceId("instance.character.capacity_first");
    const second = instanceId("instance.character.capacity_second");
    movement.registerCharacter("register-first", first, "area.ground", { x: 0, y: 0 });
    movement.registerCharacter("register-second", second, "area.ground", { x: 1, y: 0 });
    movement.beginMovement("begin-first", { characterId: first, taskId: "task.first", target, speedUnitsPerSecond: 1, occurredAtUtcMs: 1 });
    expect(movement.beginMovement("begin-second", {
      characterId: second,
      taskId: "task.second",
      target,
      speedUnitsPerSecond: 1,
      occurredAtUtcMs: 2,
    })).toMatchObject({ accepted: false, code: "INTERACTION_CAPACITY_FULL" });
    movement.releaseTask("release-first", first, "task.first", 3);
    expect(movement.beginMovement("retry-second", {
      characterId: second,
      taskId: "task.second",
      target,
      speedUnitsPerSecond: 1,
      occurredAtUtcMs: 4,
    })).toMatchObject({ accepted: true });
  });

  it("tries other candidates when the nearest candidate is unreachable", () => {
    const targets = new MutableTargets();
    targets.value = {
      revision: 1,
      candidates: [
        { id: "blocked", navigationAreaId: "area.ground", bounds: { x: 5, y: 0, width: 1, height: 1 }, capacity: 1 },
        { id: "reachable", navigationAreaId: "area.ground", bounds: { x: 10, y: 0, width: 1, height: 1 }, capacity: 1 },
      ],
    };
    const navigationPlanner: NavigationPlanner = {
      plan: (_area, _from, to) => ({ reachable: to.x !== 5, distance: to.x, waypoints: [to] }),
    };
    const { movement } = setup({ targets, navigationPlanner });
    const characterId = instanceId("instance.character.fallback_point");
    movement.registerCharacter("register", characterId, "area.ground", { x: 0, y: 0 });
    expect(movement.beginMovement("begin", {
      characterId,
      taskId: "task.fallback",
      target: { type: "building", id: "building.table" },
      speedUnitsPerSecond: 1,
      occurredAtUtcMs: 1,
    })).toMatchObject({ accepted: true, value: { plan: { interactionCandidateId: "reachable" } } });
  });

  it("re-resolves a moved target and continues toward its new current position", () => {
    const { movement, targets } = setup();
    const characterId = instanceId("instance.character.moving_target");
    movement.registerCharacter("register", characterId, "area.ground", { x: 0, y: 0 });
    movement.beginMovement("begin", { characterId, taskId: "task.moved", target, speedUnitsPerSecond: 2, occurredAtUtcMs: 0 });
    movement.advanceCharacter("advance-one", characterId, 1_000);
    expect(movement.getCharacter(characterId)?.position.x).toBeCloseTo(2);
    targets.value = {
      revision: 2,
      candidates: [{ id: "front", navigationAreaId: "area.ground", bounds: { x: 20, y: 0, width: 2, height: 2 }, capacity: 1 }],
    };
    movement.advanceCharacter("advance-two", characterId, 2_000);
    expect(movement.getCharacter(characterId)).toMatchObject({
      position: { x: 4, y: 0 },
      plan: { targetRevision: 2, destination: { x: 20, y: 0 }, replanAttempts: 0 },
    });
  });

  it("returns a region-connection requirement instead of teleporting across areas", () => {
    const targets = new MutableTargets();
    targets.value = {
      revision: 1,
      candidates: [{ id: "front", navigationAreaId: "area.airship", bounds: { x: 10, y: 0, width: 1, height: 1 }, capacity: 1 }],
    };
    const { movement } = setup({ targets });
    const characterId = instanceId("instance.character.cross_area");
    movement.registerCharacter("register", characterId, "area.ground", { x: 0, y: 0 });
    expect(movement.beginMovement("begin", {
      characterId,
      taskId: "task.cross-area",
      target,
      speedUnitsPerSecond: 1,
      occurredAtUtcMs: 1,
    })).toMatchObject({
      accepted: false,
      code: "REGION_CONNECTION_REQUIRED",
      details: { fromAreaId: "area.ground", toAreaId: "area.airship" },
    });
    expect(movement.getCharacter(characterId)?.position).toEqual({ x: 0, y: 0 });
  });

  it("releases an expired reservation after retry exhaustion", () => {
    const { movement } = setup({ ttl: 100, retries: 0 });
    const first = instanceId("instance.character.expired_first");
    const second = instanceId("instance.character.expired_second");
    movement.registerCharacter("register-first", first, "area.ground", { x: 0, y: 0 });
    movement.registerCharacter("register-second", second, "area.ground", { x: 0, y: 0 });
    movement.beginMovement("begin-first", { characterId: first, taskId: "task.expiring", target, speedUnitsPerSecond: 1, occurredAtUtcMs: 0 });
    expect(movement.advanceCharacter("expire", first, 101)).toMatchObject({ accepted: true, value: { status: "blocked", plan: null } });
    expect(movement.beginMovement("begin-second", { characterId: second, taskId: "task.after-expiry", target, speedUnitsPerSecond: 1, occurredAtUtcMs: 102 })).toMatchObject({ accepted: true });
  });

  it("allows ambient chat only at a natural existing distance without creating movement plans", () => {
    const { movement } = setup();
    const first = instanceId("instance.character.chat_first");
    const second = instanceId("instance.character.chat_second");
    movement.registerCharacter("register-first", first, "area.ground", { x: 5, y: 5 });
    movement.registerCharacter("register-second", second, "area.ground", { x: 7, y: 5 });
    expect(movement.canStartAmbientConversation([first, second], 3)).toBe(true);
    expect(movement.canStartAmbientConversation([first, second], 1)).toBe(false);
    expect(movement.getCharacter(first)?.plan).toBeNull();
    expect(movement.getCharacter(second)?.plan).toBeNull();
  });

  it("restores and rolls movement plans back transactionally", () => {
    const { movement, targets } = setup();
    const characterId = instanceId("instance.character.move_tx");
    movement.registerCharacter("register", characterId, "area.ground", { x: 0, y: 0 });
    movement.beginMovement("begin", { characterId, taskId: "task.tx", target, speedUnitsPerSecond: 2, occurredAtUtcMs: 0 });
    const scope = new TransactionScope(new DomainEventBus());
    expect(() => scope.run([movement], () => {
      movement.advanceCharacter("advance", characterId, 1_000);
      throw new Error("abort");
    })).toThrow("abort");
    expect(movement.getCharacter(characterId)?.position).toEqual({ x: 0, y: 0 });
    const restored = new MovementModule({ targetResolver: targets, initialState: movement.exportState() });
    expect(restored.getCharacter(characterId)).toMatchObject({ status: "moving", plan: { taskId: "task.tx" } });
  });
});
