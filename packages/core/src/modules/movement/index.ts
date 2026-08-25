import type { DomainEvent, InstanceId, TransactionParticipantSession, TransactionalParticipant } from "../../kernel";
import { isInstanceId } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type { Point2D, Rect2D } from "../scene-layout";

export const MOVEMENT_MODULE_ID = "module.movement";
export const MOVEMENT_SCHEMA_VERSION = 1;

export type MovementStatus = "idle" | "moving" | "arrived" | "blocked";

export interface MovementTargetReference {
  readonly type: string;
  readonly id: string;
  readonly interactionId?: string;
}

export interface InteractionCandidate {
  readonly id: string;
  readonly navigationAreaId: string;
  readonly bounds: Rect2D;
  readonly capacity: number;
}

export interface ResolvedInteractionTarget {
  readonly revision: number;
  readonly candidates: readonly InteractionCandidate[];
}

export interface InteractionTargetResolver {
  resolve(target: MovementTargetReference): ResolvedInteractionTarget | null;
}

export interface NavigationPlan {
  readonly reachable: boolean;
  readonly distance: number;
  readonly waypoints: readonly Point2D[];
}

export interface NavigationPlanner {
  plan(navigationAreaId: string, from: Point2D, to: Point2D): NavigationPlan;
}

export class Direct2DNavigationPlanner implements NavigationPlanner {
  plan(_navigationAreaId: string, from: Point2D, to: Point2D): NavigationPlan {
    return Object.freeze({
      reachable: true,
      distance: Math.hypot(to.x - from.x, to.y - from.y),
      waypoints: Object.freeze([Object.freeze({ ...to })]),
    });
  }
}

export interface MovementPlanState {
  readonly taskId: string;
  readonly target: MovementTargetReference;
  readonly targetRevision: number;
  readonly interactionCandidateId: string;
  readonly destination: Point2D;
  readonly speedUnitsPerSecond: number;
  readonly startedAtUtcMs: number;
  readonly lastAdvancedAtUtcMs: number;
  readonly reservationExpiresAtUtcMs: number;
  readonly replanAttempts: number;
}

export interface MovementCharacterState {
  readonly characterId: InstanceId;
  readonly navigationAreaId: string;
  readonly position: Point2D;
  readonly status: MovementStatus;
  readonly plan: MovementPlanState | null;
  readonly blockedReason: string | null;
}

export interface MovementState {
  readonly schemaVersion: typeof MOVEMENT_SCHEMA_VERSION;
  readonly revision: number;
  readonly characters: readonly MovementCharacterState[];
  readonly processedOperationIds: readonly string[];
}

export interface BeginMovementRequest {
  readonly characterId: InstanceId;
  readonly taskId: string;
  readonly target: MovementTargetReference;
  readonly speedUnitsPerSecond: number;
  readonly occurredAtUtcMs: number;
}

export interface MovementReadModel {
  readonly revision: number;
  readonly characters: readonly MovementCharacterState[];
}

export type MovementRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "DUPLICATE_CHARACTER"
  | "UNKNOWN_CHARACTER"
  | "CHARACTER_BUSY"
  | "UNKNOWN_TARGET"
  | "NO_INTERACTION_CANDIDATE"
  | "INTERACTION_CAPACITY_FULL"
  | "TARGET_UNREACHABLE"
  | "REGION_CONNECTION_REQUIRED"
  | "TASK_MISMATCH";

export type MovementOperationResult<TValue = undefined> =
  | { readonly accepted: true; readonly changed: true; readonly operationId: string; readonly value: TValue; readonly events: readonly DomainEvent[] }
  | { readonly accepted: false; readonly changed: false; readonly operationId: string; readonly code: MovementRejectionCode; readonly message: string; readonly events: readonly []; readonly details?: Readonly<Record<string, string>> };

export interface MovementModuleOptions {
  readonly targetResolver: InteractionTargetResolver;
  readonly navigationPlanner?: NavigationPlanner;
  readonly reservationTtlMs?: number;
  readonly maximumReplanAttempts?: number;
  readonly initialState?: MovementState;
}

const OPERATION_HISTORY_LIMIT = 2_048;
const validId = (value: string): boolean => value.trim().length > 0 && value.length <= 200;
const finitePoint = (point: Point2D): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

function freezeTarget(target: MovementTargetReference): MovementTargetReference {
  return Object.freeze({ ...target });
}

function freezePlan(plan: MovementPlanState): MovementPlanState {
  return Object.freeze({ ...plan, target: freezeTarget(plan.target), destination: Object.freeze({ ...plan.destination }) });
}

function freezeCharacter(character: MovementCharacterState): MovementCharacterState {
  return Object.freeze({ ...character, position: Object.freeze({ ...character.position }), plan: character.plan === null ? null : freezePlan(character.plan) });
}

function cloneState(state: MovementState): MovementState {
  return Object.freeze({ ...state, characters: Object.freeze(state.characters.map(freezeCharacter)), processedOperationIds: Object.freeze([...state.processedOperationIds]) });
}

function closestPoint(bounds: Rect2D, point: Point2D): Point2D {
  return Object.freeze({
    x: Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width)),
    y: Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height)),
  });
}

function samePoint(left: Point2D, right: Point2D): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

export class MovementModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = MOVEMENT_MODULE_ID;
  readonly transactionParticipantId = MOVEMENT_MODULE_ID;
  readonly #targets: InteractionTargetResolver;
  readonly #navigation: NavigationPlanner;
  readonly #reservationTtlMs: number;
  readonly #maximumReplanAttempts: number;
  #state: MovementState;
  #transactionActive = false;

  constructor(options: MovementModuleOptions) {
    this.#targets = options.targetResolver;
    this.#navigation = options.navigationPlanner ?? new Direct2DNavigationPlanner();
    this.#reservationTtlMs = options.reservationTtlMs ?? 30_000;
    this.#maximumReplanAttempts = options.maximumReplanAttempts ?? 3;
    if (!Number.isSafeInteger(this.#reservationTtlMs) || this.#reservationTtlMs <= 0 ||
      !Number.isSafeInteger(this.#maximumReplanAttempts) || this.#maximumReplanAttempts < 0) {
      throw new RangeError("Movement reservation and retry options are invalid.");
    }
    this.#state = options.initialState === undefined
      ? cloneState({ schemaVersion: MOVEMENT_SCHEMA_VERSION, revision: 0, characters: [], processedOperationIds: [] })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): MovementState { return cloneState(this.#state); }
  createReadModel(): MovementReadModel { return Object.freeze({ revision: this.#state.revision, characters: Object.freeze(this.#state.characters.map(freezeCharacter)) }); }
  getCharacter(characterId: InstanceId): MovementCharacterState | null { return this.#state.characters.find((item) => item.characterId === characterId) ?? null; }

  registerCharacter(operationId: string, characterId: InstanceId, navigationAreaId: string, position: Point2D): MovementOperationResult<MovementCharacterState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    if (!isInstanceId(characterId) || !validId(navigationAreaId) || !finitePoint(position)) return this.#reject(operationId, "INVALID_REQUEST", "Movement character registration is invalid.");
    if (this.getCharacter(characterId) !== null) return this.#reject(operationId, "DUPLICATE_CHARACTER", `Movement character already exists: ${characterId}`);
    const character = freezeCharacter({ characterId, navigationAreaId, position, status: "idle", plan: null, blockedReason: null });
    this.#replace({ characters: [...this.#state.characters, character] });
    return this.#accept(operationId, character, [this.#event(operationId, "movement.character-registered", 0, { characterId, navigationAreaId, position })]);
  }

  beginMovement(operationId: string, request: BeginMovementRequest): MovementOperationResult<MovementCharacterState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locate(request.characterId);
    if (located === null) return this.#reject(operationId, "UNKNOWN_CHARACTER", `Unknown movement character: ${request.characterId}`);
    if (located.character.plan !== null) return this.#reject(operationId, "CHARACTER_BUSY", "Character already has a movement or interaction reservation.");
    if (!validId(request.taskId) || !validId(request.target.type) || !validId(request.target.id) ||
      (request.target.interactionId !== undefined && !validId(request.target.interactionId)) ||
      !Number.isFinite(request.speedUnitsPerSecond) || request.speedUnitsPerSecond <= 0 || !nonNegativeInteger(request.occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Begin-movement request is invalid.");
    }
    const planned = this.#createPlan(located.character, request, 0);
    if (!planned.accepted) return this.#reject(operationId, planned.code, planned.message, planned.details);
    const status: MovementStatus = samePoint(located.character.position, planned.plan.destination) ? "arrived" : "moving";
    const updated = freezeCharacter({ ...located.character, status, plan: planned.plan, blockedReason: null });
    this.#replaceCharacter(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(operationId, status === "arrived" ? "movement.arrived" : "movement.started", request.occurredAtUtcMs,
      { characterId: request.characterId, taskId: request.taskId, target: request.target, destination: planned.plan.destination })]);
  }

  advanceCharacter(operationId: string, characterId: InstanceId, nowUtcMs: number): MovementOperationResult<MovementCharacterState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locate(characterId);
    if (located === null) return this.#reject(operationId, "UNKNOWN_CHARACTER", `Unknown movement character: ${characterId}`);
    const current = located.character;
    if (current.plan === null || !nonNegativeInteger(nowUtcMs) || nowUtcMs < current.plan.lastAdvancedAtUtcMs) {
      return this.#reject(operationId, "INVALID_REQUEST", "Movement advance request is invalid.");
    }
    let plan = current.plan;
    const resolved = this.#targets.resolve(plan.target);
    const chosen = resolved?.candidates.find((candidate) => candidate.id === plan.interactionCandidateId);
    const targetChanged = resolved === null || chosen === undefined || resolved.revision !== plan.targetRevision ||
      chosen.navigationAreaId !== current.navigationAreaId || !samePoint(closestPoint(chosen.bounds, current.position), plan.destination);
    const reservationExpired = nowUtcMs > plan.reservationExpiresAtUtcMs;
    if (targetChanged || reservationExpired) {
      if (reservationExpired && plan.replanAttempts >= this.#maximumReplanAttempts) {
        const blocked = freezeCharacter({ ...current, status: "blocked", blockedReason: "target-unreachable-after-retries", plan: null });
        this.#replaceCharacter(located.index, blocked);
        return this.#accept(operationId, blocked, [this.#event(operationId, "movement.blocked", nowUtcMs,
          { characterId, taskId: plan.taskId, reason: blocked.blockedReason })]);
      }
      const replanned = this.#createPlan(current, {
        characterId,
        taskId: plan.taskId,
        target: plan.target,
        speedUnitsPerSecond: plan.speedUnitsPerSecond,
        occurredAtUtcMs: nowUtcMs,
      }, reservationExpired ? plan.replanAttempts + 1 : 0);
      if (!replanned.accepted) {
        const blocked = freezeCharacter({ ...current, status: "blocked", blockedReason: replanned.code, plan: null });
        this.#replaceCharacter(located.index, blocked);
        return this.#accept(operationId, blocked, [this.#event(operationId, "movement.blocked", nowUtcMs,
          { characterId, taskId: plan.taskId, reason: replanned.code })]);
      }
      plan = freezePlan({ ...replanned.plan, startedAtUtcMs: plan.startedAtUtcMs, lastAdvancedAtUtcMs: plan.lastAdvancedAtUtcMs });
    }
    const elapsedSeconds = (nowUtcMs - plan.lastAdvancedAtUtcMs) / 1_000;
    const dx = plan.destination.x - current.position.x;
    const dy = plan.destination.y - current.position.y;
    const distance = Math.hypot(dx, dy);
    const travel = plan.speedUnitsPerSecond * elapsedSeconds;
    const position = distance <= travel || distance < 0.001
      ? plan.destination
      : Object.freeze({ x: current.position.x + dx / distance * travel, y: current.position.y + dy / distance * travel });
    const arrived = samePoint(position, plan.destination);
    const refreshedPlan = freezePlan({ ...plan, lastAdvancedAtUtcMs: nowUtcMs, reservationExpiresAtUtcMs: nowUtcMs + this.#reservationTtlMs });
    const updated = freezeCharacter({ ...current, position, status: arrived ? "arrived" : "moving", plan: refreshedPlan, blockedReason: null });
    this.#replaceCharacter(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(operationId, arrived ? "movement.arrived" : "movement.progressed", nowUtcMs,
      { characterId, taskId: plan.taskId, position, destination: plan.destination })]);
  }

  releaseTask(operationId: string, characterId: InstanceId, taskId: string, occurredAtUtcMs: number): MovementOperationResult<MovementCharacterState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locate(characterId);
    if (located === null) return this.#reject(operationId, "UNKNOWN_CHARACTER", `Unknown movement character: ${characterId}`);
    if (located.character.plan?.taskId !== taskId) return this.#reject(operationId, "TASK_MISMATCH", "Movement reservation does not belong to this task.");
    if (!nonNegativeInteger(occurredAtUtcMs)) return this.#reject(operationId, "INVALID_REQUEST", "Movement release time is invalid.");
    const updated = freezeCharacter({ ...located.character, status: "idle", plan: null, blockedReason: null });
    this.#replaceCharacter(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(operationId, "movement.reservation-released", occurredAtUtcMs, { characterId, taskId })]);
  }

  completeAreaTransfer(
    operationId: string,
    characterId: InstanceId,
    navigationAreaId: string,
    exitPoint: Point2D,
    occurredAtUtcMs: number,
  ): MovementOperationResult<MovementCharacterState> {
    const prepared = this.#prepare(operationId); if (prepared !== null) return prepared;
    const located = this.#locate(characterId);
    if (located === null) return this.#reject(operationId, "UNKNOWN_CHARACTER", "Unknown movement character: " + characterId);
    if (located.character.plan !== null) return this.#reject(operationId, "CHARACTER_BUSY", "Character still owns a movement reservation during area transfer.");
    if (!validId(navigationAreaId) || !finitePoint(exitPoint) || !nonNegativeInteger(occurredAtUtcMs)) {
      return this.#reject(operationId, "INVALID_REQUEST", "Area-transfer completion is invalid.");
    }
    const updated = freezeCharacter({
      ...located.character,
      navigationAreaId,
      position: exitPoint,
      status: "idle",
      blockedReason: null,
    });
    this.#replaceCharacter(located.index, updated);
    return this.#accept(operationId, updated, [this.#event(
      operationId,
      "movement.area-transfer-completed",
      occurredAtUtcMs,
      { characterId, navigationAreaId, exitPoint },
    )]);
  }
  canStartAmbientConversation(characterIds: readonly InstanceId[], maximumDistance: number): boolean {
    if (characterIds.length < 2 || !Number.isFinite(maximumDistance) || maximumDistance < 0) return false;
    const characters = characterIds.map((id) => this.getCharacter(id));
    if (characters.some((item) => item === null)) return false;
    const first = characters[0]!;
    return characters.every((item) => item!.navigationAreaId === first.navigationAreaId &&
      Math.hypot(item!.position.x - first.position.x, item!.position.y - first.position.y) <= maximumDistance);
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Movement transaction is already active.");
    this.#transactionActive = true; const checkpoint = this.exportState();
    return { validateTransaction: () => this.#validateState(), commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => { this.#state = cloneState(checkpoint); this.#transactionActive = false; } };
  }

  #createPlan(character: MovementCharacterState, request: BeginMovementRequest, replanAttempts: number):
    | { readonly accepted: true; readonly plan: MovementPlanState }
    | { readonly accepted: false; readonly code: MovementRejectionCode; readonly message: string; readonly details?: Readonly<Record<string, string>> } {
    const resolved = this.#targets.resolve(request.target);
    if (resolved === null) return { accepted: false, code: "UNKNOWN_TARGET", message: "Movement target does not exist." };
    const matching = resolved.candidates.filter((candidate) => request.target.interactionId === undefined || candidate.id === request.target.interactionId);
    if (matching.length === 0) return { accepted: false, code: "NO_INTERACTION_CANDIDATE", message: "Target has no matching interaction candidate." };
    const local = matching.filter((candidate) => candidate.navigationAreaId === character.navigationAreaId);
    if (local.length === 0) return { accepted: false, code: "REGION_CONNECTION_REQUIRED", message: "Target is in another navigation area.",
      details: Object.freeze({ fromAreaId: character.navigationAreaId, toAreaId: matching[0]!.navigationAreaId }) };
    let hadCapacity = false;
    const ranked: { candidate: InteractionCandidate; destination: Point2D; navigation: NavigationPlan }[] = [];
    for (const candidate of local) {
      if (this.#reservationCount(request.target, candidate.id, request.occurredAtUtcMs, character.characterId) >= candidate.capacity) continue;
      hadCapacity = true;
      const destination = closestPoint(candidate.bounds, character.position);
      const navigation = this.#navigation.plan(character.navigationAreaId, character.position, destination);
      if (navigation.reachable) ranked.push({ candidate, destination, navigation });
    }
    ranked.sort((left, right) => left.navigation.distance - right.navigation.distance || left.candidate.id.localeCompare(right.candidate.id));
    const selected = ranked[0];
    if (selected === undefined) return hadCapacity
      ? { accepted: false, code: "TARGET_UNREACHABLE", message: "All interaction candidates are unreachable." }
      : { accepted: false, code: "INTERACTION_CAPACITY_FULL", message: "All interaction candidates are reserved." };
    return { accepted: true, plan: freezePlan({ taskId: request.taskId, target: request.target, targetRevision: resolved.revision,
      interactionCandidateId: selected.candidate.id, destination: selected.destination, speedUnitsPerSecond: request.speedUnitsPerSecond,
      startedAtUtcMs: request.occurredAtUtcMs, lastAdvancedAtUtcMs: request.occurredAtUtcMs,
      reservationExpiresAtUtcMs: request.occurredAtUtcMs + this.#reservationTtlMs, replanAttempts }) };
  }

  #reservationCount(target: MovementTargetReference, candidateId: string, nowUtcMs: number, excludedCharacterId: InstanceId): number {
    return this.#state.characters.filter((character) => character.characterId !== excludedCharacterId && character.plan !== null &&
      character.plan.reservationExpiresAtUtcMs >= nowUtcMs && character.plan.target.type === target.type && character.plan.target.id === target.id &&
      character.plan.interactionCandidateId === candidateId).length;
  }
  #locate(characterId: InstanceId): { readonly index: number; readonly character: MovementCharacterState } | null {
    const index = this.#state.characters.findIndex((item) => item.characterId === characterId);
    return index < 0 ? null : { index, character: this.#state.characters[index]! };
  }
  #replaceCharacter(index: number, character: MovementCharacterState): void { const characters = [...this.#state.characters]; characters[index] = character; this.#replace({ characters }); }
  #prepare(operationId: string): MovementOperationResult<never> | null {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Movement operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) return this.#reject(operationId, "DUPLICATE_OPERATION", "Movement operation was already processed.");
    this.#state = cloneState({ ...this.#state, processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT) }); return null;
  }
  #replace(update: Partial<MovementState>): void { this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 }); }
  #accept<TValue>(operationId: string, value: TValue, events: readonly DomainEvent[]): MovementOperationResult<TValue> {
    return Object.freeze({ accepted: true, changed: true, operationId, value, events: Object.freeze([...events]) });
  }
  #reject(operationId: string, code: MovementRejectionCode, message: string, details?: Readonly<Record<string, string>>): MovementOperationResult<never> {
    return Object.freeze({ accepted: false, changed: false, operationId, code, message, events: [] as const, ...(details === undefined ? {} : { details }) });
  }
  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({ id: `${type}:${operationId}`, type, occurredAtUtcMs, causationId: operationId, correlationId: operationId, payload });
  }
  #validateState(): void {
    if (this.#state.schemaVersion !== MOVEMENT_SCHEMA_VERSION || !nonNegativeInteger(this.#state.revision) || new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length) throw new Error("Movement state metadata is invalid.");
    const ids = new Set<InstanceId>();
    for (const character of this.#state.characters) {
      if (!isInstanceId(character.characterId) || ids.has(character.characterId) || !validId(character.navigationAreaId) || !finitePoint(character.position) ||
        ((character.status === "idle" || character.status === "blocked") && character.plan !== null) ||
        ((character.status === "moving" || character.status === "arrived") && character.plan === null)) throw new Error(`Invalid movement character state: ${character.characterId}`);
      ids.add(character.characterId);
    }
  }
}
