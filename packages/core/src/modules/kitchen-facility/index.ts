import type {
  DomainEvent,
  InstanceId,
  SubresourceId,
  TransactionParticipantSession,
  TransactionalParticipant,
} from "../../kernel";
import { createSubresourceId, DomainEventBus, TransactionScope } from "../../kernel";
import type { DomainModule } from "../domain-module";
import type {
  BuildingInstanceState,
  BuildingLayoutSnapshot,
  BuildingTransitionConstraintPort,
  BuildingTransitionConstraintRequest,
  SceneLayoutModule,
} from "../scene-layout";
import type { MovementModule } from "../movement";

export const KITCHEN_FACILITY_MODULE_ID = "module.kitchen-facility";
export const KITCHEN_FACILITY_SCHEMA_VERSION = 1;

export interface KitchenWorkstationDefinition {
  readonly id: string;
  readonly capabilityIds: readonly string[];
  readonly interactionId: string;
}

export interface KitchenFacilityLevelDefinition {
  readonly buildingDefinitionId: string;
  readonly level: number;
  readonly workstations: readonly KitchenWorkstationDefinition[];
  readonly cacheSlotIds: readonly string[];
  readonly workstationCountValueKey?: string;
  readonly cacheSlotCountValueKey?: string;
}

export interface KitchenWorkstationSnapshot {
  readonly id: SubresourceId;
  readonly localId: string;
  readonly capabilityIds: readonly string[];
  readonly interactionId: string;
}

export interface KitchenCacheSlotSnapshot {
  readonly id: SubresourceId;
  readonly localId: string;
}

export interface KitchenFacilitySnapshot {
  readonly id: InstanceId;
  readonly buildingDefinitionId: string;
  readonly sceneId: string;
  readonly workstations: readonly KitchenWorkstationSnapshot[];
  readonly cacheSlots: readonly KitchenCacheSlotSnapshot[];
}

export interface KitchenFacilityDefinitionPort {
  readonly revision: number;
  listFacilities(): readonly KitchenFacilitySnapshot[];
  getFacility(facilityId: InstanceId): KitchenFacilitySnapshot | null;
}

export type KitchenResourcePhase = "reserved" | "running";
export type KitchenStepAttendance = "required" | "unattended";
export type KitchenCacheClaimStatus = "reserved" | "occupied";

export interface KitchenStepResourceBinding {
  readonly stepInstanceId: string;
  readonly executionId: string;
  readonly taskId: string;
  readonly characterId: InstanceId;
  readonly attendance: KitchenStepAttendance;
  readonly requiredCapabilityIds: readonly string[];
  readonly facilityId: InstanceId;
  readonly workstationId: SubresourceId;
  readonly interactionId: string;
  readonly phase: KitchenResourcePhase;
  readonly reservedAtUtcMs: number;
  readonly reservationExpiresAtUtcMs: number;
  readonly startedAtUtcMs: number | null;
}

export interface KitchenCacheClaimState {
  readonly id: SubresourceId;
  readonly cacheSlotId: SubresourceId;
  readonly facilityId: InstanceId;
  readonly executionId: string;
  readonly sourceStepInstanceId: string;
  readonly allowedConsumerStepInstanceIds: readonly string[];
  readonly status: KitchenCacheClaimStatus;
  readonly reservedAtUtcMs: number;
  readonly occupiedAtUtcMs: number | null;
}

export interface KitchenFacilityModuleState {
  readonly schemaVersion: typeof KITCHEN_FACILITY_SCHEMA_VERSION;
  readonly revision: number;
  readonly bindings: readonly KitchenStepResourceBinding[];
  readonly cacheClaims: readonly KitchenCacheClaimState[];
  readonly processedOperationIds: readonly string[];
}

export interface KitchenOutputCacheRequest {
  readonly allowedConsumerStepInstanceIds: readonly string[];
}

export interface ReserveKitchenStepResourcesRequest {
  readonly stepInstanceId: string;
  readonly executionId: string;
  readonly taskId: string;
  readonly characterId: InstanceId;
  readonly requiredCapabilityIds: readonly string[];
  readonly attendance: KitchenStepAttendance;
  readonly speedUnitsPerSecond: number;
  readonly occurredAtUtcMs: number;
  readonly reservationExpiresAtUtcMs: number;
  readonly outputCache?: KitchenOutputCacheRequest;
}

export interface KitchenFacilityReadModel {
  readonly revision: number;
  readonly facilityRevision: number;
  readonly facilities: readonly KitchenFacilitySnapshot[];
  readonly bindings: readonly KitchenStepResourceBinding[];
  readonly cacheClaims: readonly KitchenCacheClaimState[];
}

export type KitchenFacilityRejectionCode =
  | "INVALID_REQUEST"
  | "DUPLICATE_OPERATION"
  | "STEP_ALREADY_BOUND"
  | "NO_CAPABLE_WORKSTATION"
  | "WORKSTATION_BUSY"
  | "NO_CACHE_SLOT"
  | "MOVEMENT_REJECTED"
  | "UNKNOWN_BINDING"
  | "BINDING_NOT_RESERVED"
  | "BINDING_NOT_RUNNING"
  | "CHARACTER_NOT_ARRIVED"
  | "UNKNOWN_CACHE_CLAIM"
  | "CACHE_NOT_OCCUPIED"
  | "CACHE_CONSUMER_NOT_ALLOWED";

export type KitchenFacilityOperationResult<TValue> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly operationId: string;
      readonly value: TValue;
      readonly committedEventIds: readonly string[];
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly operationId: string;
      readonly code: KitchenFacilityRejectionCode;
      readonly message: string;
      readonly committedEventIds: readonly [];
    };

const OPERATION_HISTORY_LIMIT = 4_096;
const LOCAL_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

class KitchenFacilityRejected extends Error {
  constructor(readonly code: KitchenFacilityRejectionCode, message: string) {
    super(message);
  }
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 300;
}

function validLocalId(value: string): boolean {
  return LOCAL_ID_PATTERN.test(value);
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function uniqueValidIds(values: readonly string[]): boolean {
  return values.every(validId) && new Set(values).size === values.length;
}

function workstationId(ownerId: InstanceId, localId: string): SubresourceId {
  return createSubresourceId(ownerId, `kitchen_ws_${localId}`);
}

function cacheSlotId(ownerId: InstanceId, localId: string): SubresourceId {
  return createSubresourceId(ownerId, `kitchen_cache_${localId}`);
}

function cloneWorkstation(value: KitchenWorkstationSnapshot): KitchenWorkstationSnapshot {
  return Object.freeze({ ...value, capabilityIds: Object.freeze([...value.capabilityIds]) });
}

function cloneFacility(value: KitchenFacilitySnapshot): KitchenFacilitySnapshot {
  return Object.freeze({
    ...value,
    workstations: Object.freeze(value.workstations.map(cloneWorkstation)),
    cacheSlots: Object.freeze(value.cacheSlots.map((entry) => Object.freeze({ ...entry }))),
  });
}

function cloneBinding(value: KitchenStepResourceBinding): KitchenStepResourceBinding {
  return Object.freeze({
    ...value,
    requiredCapabilityIds: Object.freeze([...value.requiredCapabilityIds]),
  });
}

function cloneCacheClaim(value: KitchenCacheClaimState): KitchenCacheClaimState {
  return Object.freeze({
    ...value,
    allowedConsumerStepInstanceIds: Object.freeze([...value.allowedConsumerStepInstanceIds]),
  });
}

function cloneState(value: KitchenFacilityModuleState): KitchenFacilityModuleState {
  return Object.freeze({
    ...value,
    bindings: Object.freeze(value.bindings.map(cloneBinding)),
    cacheClaims: Object.freeze(value.cacheClaims.map(cloneCacheClaim)),
    processedOperationIds: Object.freeze([...value.processedOperationIds]),
  });
}

/**
 * Projects stable workstation and cache-slot identities from SceneLayout. World
 * coordinates deliberately remain owned by SceneLayout and Movement.
 */
export class KitchenFacilityAdapter implements
  DomainModule,
  KitchenFacilityDefinitionPort,
  BuildingTransitionConstraintPort {
  readonly moduleId = "module.kitchen-facility-adapter";
  readonly #definitions = new Map<string, KitchenFacilityLevelDefinition>();
  #layout: SceneLayoutModule | null = null;
  #runtime: KitchenFacilityModule | null = null;

  constructor(definitions: readonly KitchenFacilityLevelDefinition[]) {
    if (definitions.length === 0) throw new Error("Kitchen facility definitions are required.");
    for (const definition of definitions) this.#register(definition);
  }

  get revision(): number {
    return this.#layout?.getSnapshot().revision ?? 0;
  }

  attachLayout(layout: SceneLayoutModule): void {
    if (this.#layout !== null && this.#layout !== layout) {
      throw new Error("Kitchen facility adapter already has a SceneLayout owner.");
    }
    for (const definition of this.#definitions.values()) {
      const values = layout.getDefinition(definition.buildingDefinitionId)?.levels
        .find((level) => level.level === definition.level)?.capabilityValues ?? {};
      const workstationCount = definition.workstationCountValueKey === undefined ? definition.workstations.length : (values[definition.workstationCountValueKey] ?? Number.NaN);
      const cacheSlotCount = definition.cacheSlotCountValueKey === undefined ? definition.cacheSlotIds.length : (values[definition.cacheSlotCountValueKey] ?? Number.NaN);
      if (!nonNegativeInteger(workstationCount) || workstationCount > definition.workstations.length) throw new Error(`Missing or invalid kitchen workstation count: ${definition.buildingDefinitionId}/${definition.level}/${definition.workstationCountValueKey}`);
      if (!nonNegativeInteger(cacheSlotCount) || cacheSlotCount > definition.cacheSlotIds.length) throw new Error(`Missing or invalid kitchen cache slot count: ${definition.buildingDefinitionId}/${definition.level}/${definition.cacheSlotCountValueKey}`);
    }
    this.#layout = layout;
  }

  attachRuntime(runtime: KitchenFacilityModule): void {
    if (this.#runtime !== null && this.#runtime !== runtime) {
      throw new Error("Kitchen facility adapter already has a runtime owner.");
    }
    this.#runtime = runtime;
  }

  listFacilities(): readonly KitchenFacilitySnapshot[] {
    if (this.#layout === null) return Object.freeze([]);
    const facilities = this.#layout.getSnapshot().buildings
      .flatMap((building) => {
        const projected = this.#projectActive(building);
        return projected === null ? [] : [projected];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze(facilities.map(cloneFacility));
  }

  getFacility(facilityId: InstanceId): KitchenFacilitySnapshot | null {
    return this.listFacilities().find((entry) => entry.id === facilityId) ?? null;
  }

  validate(request: BuildingTransitionConstraintRequest): readonly string[] {
    const runtime = this.#runtime;
    if (runtime === null) return Object.freeze([]);
    const state = runtime.exportState();
    const bindings = state.bindings.filter((entry) => entry.facilityId === request.current.id);
    const claims = state.cacheClaims.filter((entry) => entry.facilityId === request.current.id);
    if (bindings.length === 0 && claims.length === 0) return Object.freeze([]);
    const target = request.kind === "remove" || request.target === null || request.target.stored ||
      !request.target.enabled
      ? null
      : this.#projectDefinition(request.target);
    const issues: string[] = [];
    for (const binding of bindings) {
      const workstation = target?.workstations.find((entry) => entry.id === binding.workstationId);
      if (workstation === undefined || workstation.interactionId !== binding.interactionId ||
        !binding.requiredCapabilityIds.every((id) => workstation.capabilityIds.includes(id))) {
        issues.push(`Kitchen workstation ${binding.workstationId} is reserved by ${binding.stepInstanceId}.`);
      }
    }
    for (const claim of claims) {
      if (target?.cacheSlots.some((entry) => entry.id === claim.cacheSlotId) !== true) {
        issues.push(`Kitchen cache slot ${claim.cacheSlotId} is used by ${claim.sourceStepInstanceId}.`);
      }
    }
    return Object.freeze(issues);
  }

  #projectActive(building: BuildingLayoutSnapshot): KitchenFacilitySnapshot | null {
    if (building.sceneId === null || building.stored || !building.enabled || building.worldGeometry === null) {
      return null;
    }
    const facility = this.#projectDefinition(building);
    if (facility === null) return null;
    const interactionIds = new Set(building.worldGeometry.interactionAreas.map((entry) => entry.id));
    const workstations = facility.workstations.filter((entry) => interactionIds.has(entry.interactionId));
    if (workstations.length === 0 && facility.cacheSlots.length === 0) return null;
    return cloneFacility({ ...facility, sceneId: building.sceneId, workstations });
  }

  #projectDefinition(building: BuildingInstanceState): KitchenFacilitySnapshot | null {
    const definition = this.#definitions.get(this.#key(building.definitionId, building.level));
    if (definition === undefined) return null;
    const values = this.#layout?.getDefinition(building.definitionId)?.levels
      .find((level) => level.level === building.level)?.capabilityValues ?? {};
    const workstationCount = definition.workstationCountValueKey === undefined
      ? definition.workstations.length
      : values[definition.workstationCountValueKey]!;
    const cacheSlotCount = definition.cacheSlotCountValueKey === undefined
      ? definition.cacheSlotIds.length
      : values[definition.cacheSlotCountValueKey]!;
    return cloneFacility({
      id: building.id,
      buildingDefinitionId: building.definitionId,
      sceneId: building.sceneId ?? "scene.unavailable",
      workstations: definition.workstations.slice(0, workstationCount).map((entry) => Object.freeze({
        id: workstationId(building.id, entry.id),
        localId: entry.id,
        capabilityIds: Object.freeze([...entry.capabilityIds]),
        interactionId: entry.interactionId,
      })),
      cacheSlots: definition.cacheSlotIds.slice(0, cacheSlotCount).map((id) => Object.freeze({
        id: cacheSlotId(building.id, id),
        localId: id,
      })),
    });
  }

  #register(definition: KitchenFacilityLevelDefinition): void {
    const key = this.#key(definition.buildingDefinitionId, definition.level);
    if (!validId(definition.buildingDefinitionId) || !positiveInteger(definition.level) ||
      this.#definitions.has(key) ||
      (definition.workstations.length === 0 && definition.cacheSlotIds.length === 0) ||
      new Set(definition.workstations.map((entry) => entry.id)).size !== definition.workstations.length ||
      new Set(definition.cacheSlotIds).size !== definition.cacheSlotIds.length ||
      definition.cacheSlotIds.some((id) => !validLocalId(id)) ||
      (definition.workstationCountValueKey !== undefined && !validId(definition.workstationCountValueKey)) ||
      (definition.cacheSlotCountValueKey !== undefined && !validId(definition.cacheSlotCountValueKey))) {
      throw new Error(`Invalid or duplicate kitchen facility definition: ${key}`);
    }
    for (const workstation of definition.workstations) {
      if (!validLocalId(workstation.id) || !uniqueValidIds(workstation.capabilityIds) ||
        workstation.capabilityIds.length === 0 || !validId(workstation.interactionId)) {
        throw new Error(`Invalid kitchen workstation definition: ${key}/${workstation.id}`);
      }
    }
    this.#definitions.set(key, Object.freeze({
      ...definition,
      workstations: Object.freeze(definition.workstations.map((entry) => Object.freeze({
        ...entry,
        capabilityIds: Object.freeze([...entry.capabilityIds]),
      }))),
      cacheSlotIds: Object.freeze([...definition.cacheSlotIds]),
    }));
  }

  #key(buildingDefinitionId: string, level: number): string {
    return `${buildingDefinitionId}\u0000${level}`;
  }
}

export class KitchenFacilityModule implements DomainModule, TransactionalParticipant {
  readonly moduleId = KITCHEN_FACILITY_MODULE_ID;
  readonly transactionParticipantId = KITCHEN_FACILITY_MODULE_ID;
  readonly #facilities: KitchenFacilityDefinitionPort;
  readonly #movement: MovementModule;
  readonly #transaction: TransactionScope;
  #state: KitchenFacilityModuleState;
  #transactionActive = false;

  constructor(options: {
    readonly facilities: KitchenFacilityDefinitionPort;
    readonly movement: MovementModule;
    readonly eventBus?: DomainEventBus;
    readonly initialState?: KitchenFacilityModuleState;
  }) {
    this.#facilities = options.facilities;
    this.#movement = options.movement;
    this.#transaction = new TransactionScope(options.eventBus ?? new DomainEventBus());
    this.#state = options.initialState === undefined
      ? cloneState({
          schemaVersion: KITCHEN_FACILITY_SCHEMA_VERSION,
          revision: 0,
          bindings: [],
          cacheClaims: [],
          processedOperationIds: [],
        })
      : cloneState(options.initialState);
    this.#validateState();
  }

  exportState(): KitchenFacilityModuleState {
    return cloneState(this.#state);
  }

  createReadModel(): KitchenFacilityReadModel {
    return Object.freeze({
      revision: this.#state.revision,
      facilityRevision: this.#facilities.revision,
      facilities: Object.freeze(this.#facilities.listFacilities().map(cloneFacility)),
      bindings: Object.freeze(this.#state.bindings.map(cloneBinding)),
      cacheClaims: Object.freeze(this.#state.cacheClaims.map(cloneCacheClaim)),
    });
  }

  getBinding(stepInstanceId: string): KitchenStepResourceBinding | null {
    const value = this.#state.bindings.find((entry) => entry.stepInstanceId === stepInstanceId);
    return value === undefined ? null : cloneBinding(value);
  }

  reserveStepResources(
    operationId: string,
    request: ReserveKitchenStepResourcesRequest,
  ): KitchenFacilityOperationResult<KitchenStepResourceBinding> {
    return this.#run(operationId, (emit) => {
      this.#validateReservationRequest(request);
      if (this.#state.bindings.some((entry) => entry.stepInstanceId === request.stepInstanceId)) {
        throw new KitchenFacilityRejected("STEP_ALREADY_BOUND", `Recipe step already owns kitchen resources: ${request.stepInstanceId}`);
      }
      const allWorkstations = this.#facilities.listFacilities().flatMap((facility) =>
        facility.workstations.map((workstation) => ({ facility, workstation })),
      ).filter(({ workstation }) => request.requiredCapabilityIds.every((id) =>
        workstation.capabilityIds.includes(id),
      ));
      if (allWorkstations.length === 0) {
        throw new KitchenFacilityRejected("NO_CAPABLE_WORKSTATION", "No kitchen workstation provides every required capability.");
      }
      const candidates = allWorkstations.filter(({ workstation }) =>
        !this.#state.bindings.some((entry) => entry.workstationId === workstation.id),
      ).sort((left, right) =>
        left.facility.id.localeCompare(right.facility.id) ||
        left.workstation.id.localeCompare(right.workstation.id),
      );
      if (candidates.length === 0) {
        throw new KitchenFacilityRejected("WORKSTATION_BUSY", "All capable kitchen workstations are reserved or running.");
      }
      let selected: (typeof candidates)[number] | undefined;
      let selectedCache: { facility: KitchenFacilitySnapshot; slot: KitchenCacheSlotSnapshot } | undefined;
      for (const candidate of candidates) {
        if (request.outputCache === undefined) {
          selected = candidate;
          break;
        }
        const cache = this.#availableCacheSlot(candidate.facility.sceneId);
        if (cache !== undefined) {
          selected = candidate;
          selectedCache = cache;
          break;
        }
      }
      if (selected === undefined) {
        throw new KitchenFacilityRejected("NO_CACHE_SLOT", "No intermediate cache slot is available in the workstation scene.");
      }
      const binding = cloneBinding({
        stepInstanceId: request.stepInstanceId,
        executionId: request.executionId,
        taskId: request.taskId,
        characterId: request.characterId,
        attendance: request.attendance,
        requiredCapabilityIds: Object.freeze([...request.requiredCapabilityIds]),
        facilityId: selected.facility.id,
        workstationId: selected.workstation.id,
        interactionId: selected.workstation.interactionId,
        phase: "reserved",
        reservedAtUtcMs: request.occurredAtUtcMs,
        reservationExpiresAtUtcMs: request.reservationExpiresAtUtcMs,
        startedAtUtcMs: null,
      });
      const claim = selectedCache === undefined ? null : cloneCacheClaim({
        id: selectedCache.slot.id,
        cacheSlotId: selectedCache.slot.id,
        facilityId: selectedCache.facility.id,
        executionId: request.executionId,
        sourceStepInstanceId: request.stepInstanceId,
        allowedConsumerStepInstanceIds: request.outputCache!.allowedConsumerStepInstanceIds,
        status: "reserved",
        reservedAtUtcMs: request.occurredAtUtcMs,
        occupiedAtUtcMs: null,
      });
      this.#replace({
        bindings: [...this.#state.bindings, binding],
        cacheClaims: claim === null ? this.#state.cacheClaims : [...this.#state.cacheClaims, claim],
      });
      const movement = this.#movement.beginMovement(`${operationId}:movement`, {
        characterId: request.characterId,
        taskId: request.taskId,
        target: Object.freeze({
          type: "building",
          id: selected.facility.id,
          interactionId: selected.workstation.interactionId,
        }),
        speedUnitsPerSecond: request.speedUnitsPerSecond,
        occurredAtUtcMs: request.occurredAtUtcMs,
      });
      if (!movement.accepted) {
        throw new KitchenFacilityRejected("MOVEMENT_REJECTED", `${movement.code}: ${movement.message}`);
      }
      for (const event of movement.events) emit(event);
      emit(this.#event(operationId, "kitchen.workstation-reserved", request.occurredAtUtcMs, binding));
      emit(this.#event(operationId, "kitchen.interaction-reserved", request.occurredAtUtcMs, {
        stepInstanceId: binding.stepInstanceId,
        characterId: binding.characterId,
        facilityId: binding.facilityId,
        interactionId: binding.interactionId,
      }));
      if (claim !== null) emit(this.#event(operationId, "kitchen.cache-slot-reserved", request.occurredAtUtcMs, claim));
      return binding;
    });
  }

  startStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): KitchenFacilityOperationResult<KitchenStepResourceBinding> {
    return this.#run(operationId, (emit) => {
      const binding = this.#requireBinding(stepInstanceId);
      if (binding.phase !== "reserved") {
        throw new KitchenFacilityRejected("BINDING_NOT_RESERVED", "Kitchen step resources have already started running.");
      }
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < binding.reservedAtUtcMs ||
        occurredAtUtcMs > binding.reservationExpiresAtUtcMs) {
        throw new KitchenFacilityRejected("INVALID_REQUEST", "Kitchen step start time is outside its reservation window.");
      }
      const character = this.#movement.getCharacter(binding.characterId);
      const plan = character?.plan;
      if (character?.status !== "arrived" || plan?.taskId !== binding.taskId ||
        plan.target.type !== "building" || plan.target.id !== binding.facilityId ||
        plan.interactionCandidateId !== binding.interactionId) {
        throw new KitchenFacilityRejected("CHARACTER_NOT_ARRIVED", "The assigned chef has not arrived at the reserved interaction point.");
      }
      const running = cloneBinding({ ...binding, phase: "running", startedAtUtcMs: occurredAtUtcMs });
      this.#replaceBinding(running);
      if (running.attendance === "unattended") {
        this.#releaseMovement(`${operationId}:movement-release`, running, occurredAtUtcMs, emit);
        emit(this.#event(operationId, "kitchen.interaction-released", occurredAtUtcMs, {
          stepInstanceId: running.stepInstanceId,
          characterId: running.characterId,
          interactionId: running.interactionId,
          reason: "unattended-step-started",
        }));
      }
      emit(this.#event(operationId, "kitchen.workstation-running", occurredAtUtcMs, running));
      return running;
    });
  }

  completeStep(
    operationId: string,
    stepInstanceId: string,
    occurredAtUtcMs: number,
  ): KitchenFacilityOperationResult<KitchenCacheClaimState | null> {
    return this.#run(operationId, (emit) => {
      const binding = this.#requireBinding(stepInstanceId);
      if (binding.phase !== "running") {
        throw new KitchenFacilityRejected("BINDING_NOT_RUNNING", "Kitchen resources can only complete from the running phase.");
      }
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < binding.startedAtUtcMs!) {
        throw new KitchenFacilityRejected("INVALID_REQUEST", "Kitchen step completion time is invalid.");
      }
      if (binding.attendance === "required") {
        this.#releaseMovement(`${operationId}:movement-release`, binding, occurredAtUtcMs, emit);
        emit(this.#event(operationId, "kitchen.interaction-released", occurredAtUtcMs, {
          stepInstanceId: binding.stepInstanceId,
          characterId: binding.characterId,
          interactionId: binding.interactionId,
          reason: "step-completed",
        }));
      }
      const currentClaim = this.#state.cacheClaims.find((entry) =>
        entry.sourceStepInstanceId === binding.stepInstanceId,
      );
      const occupiedClaim = currentClaim === undefined ? null : cloneCacheClaim({
        ...currentClaim,
        status: "occupied",
        occupiedAtUtcMs: occurredAtUtcMs,
      });
      this.#replace({
        bindings: this.#state.bindings.filter((entry) => entry.stepInstanceId !== binding.stepInstanceId),
        cacheClaims: occupiedClaim === null
          ? this.#state.cacheClaims
          : this.#state.cacheClaims.map((entry) => entry.id === occupiedClaim.id ? occupiedClaim : entry),
      });
      emit(this.#event(operationId, "kitchen.workstation-released", occurredAtUtcMs, {
        stepInstanceId: binding.stepInstanceId,
        facilityId: binding.facilityId,
        workstationId: binding.workstationId,
        reason: "step-completed",
      }));
      if (occupiedClaim !== null) emit(this.#event(operationId, "kitchen.cache-slot-occupied", occurredAtUtcMs, occupiedClaim));
      emit(this.#event(operationId, "kitchen.step-resources-completed", occurredAtUtcMs, {
        stepInstanceId: binding.stepInstanceId,
        cacheClaimId: occupiedClaim?.id ?? null,
      }));
      return occupiedClaim;
    });
  }

  releaseStepReservation(
    operationId: string,
    stepInstanceId: string,
    reason: string,
    occurredAtUtcMs: number,
  ): KitchenFacilityOperationResult<KitchenStepResourceBinding> {
    return this.#run(operationId, (emit) => {
      const binding = this.#requireBinding(stepInstanceId);
      if (binding.phase !== "reserved") {
        throw new KitchenFacilityRejected("BINDING_NOT_RESERVED", "A running kitchen step is non-interruptible.");
      }
      if (!validId(reason) || !nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < binding.reservedAtUtcMs) {
        throw new KitchenFacilityRejected("INVALID_REQUEST", "Kitchen reservation release request is invalid.");
      }
      this.#releaseReservedBinding(binding, reason, occurredAtUtcMs, emit, operationId);
      return binding;
    });
  }

  expireReservations(
    operationId: string,
    nowUtcMs: number,
  ): KitchenFacilityOperationResult<readonly KitchenStepResourceBinding[]> {
    const expired = this.#state.bindings.filter((entry) =>
      entry.phase === "reserved" && entry.reservationExpiresAtUtcMs < nowUtcMs,
    );
    if (expired.length === 0 && nonNegativeInteger(nowUtcMs)) {
      return this.#unchanged(operationId, Object.freeze([]));
    }
    return this.#run(operationId, (emit) => {
      if (!nonNegativeInteger(nowUtcMs)) {
        throw new KitchenFacilityRejected("INVALID_REQUEST", "Kitchen reservation expiry time is invalid.");
      }
      for (const binding of expired) {
        this.#releaseReservedBinding(binding, "reservation-timeout", nowUtcMs, emit, operationId);
      }
      return Object.freeze(expired.map(cloneBinding));
    });
  }

  takeCachedIntermediate(
    operationId: string,
    cacheClaimId: SubresourceId,
    executionId: string,
    consumerStepInstanceId: string,
    occurredAtUtcMs: number,
  ): KitchenFacilityOperationResult<KitchenCacheClaimState> {
    return this.#run(operationId, (emit) => {
      const claim = this.#state.cacheClaims.find((entry) => entry.id === cacheClaimId);
      if (claim === undefined) {
        throw new KitchenFacilityRejected("UNKNOWN_CACHE_CLAIM", `Unknown kitchen cache claim: ${cacheClaimId}`);
      }
      if (claim.status !== "occupied") {
        throw new KitchenFacilityRejected("CACHE_NOT_OCCUPIED", "The intermediate cache slot is not occupied yet.");
      }
      if (claim.executionId !== executionId || !claim.allowedConsumerStepInstanceIds.includes(consumerStepInstanceId)) {
        throw new KitchenFacilityRejected("CACHE_CONSUMER_NOT_ALLOWED", "This recipe step cannot consume the cached intermediate.");
      }
      if (!nonNegativeInteger(occurredAtUtcMs) || occurredAtUtcMs < claim.occupiedAtUtcMs!) {
        throw new KitchenFacilityRejected("INVALID_REQUEST", "Cached intermediate take time is invalid.");
      }
      this.#replace({ cacheClaims: this.#state.cacheClaims.filter((entry) => entry.id !== claim.id) });
      emit(this.#event(operationId, "kitchen.cached-intermediate-taken", occurredAtUtcMs, {
        ...claim,
        consumerStepInstanceId,
      }));
      emit(this.#event(operationId, "kitchen.cache-slot-released", occurredAtUtcMs, {
        cacheClaimId: claim.id,
        cacheSlotId: claim.cacheSlotId,
        consumerStepInstanceId,
      }));
      return claim;
    });
  }

  beginTransaction(): TransactionParticipantSession {
    if (this.#transactionActive) throw new Error("Kitchen facility transaction is already active.");
    this.#transactionActive = true;
    const checkpoint = this.exportState();
    return {
      validateTransaction: () => this.#validateState(),
      commitTransaction: () => { this.#transactionActive = false; },
      rollbackTransaction: () => {
        this.#state = cloneState(checkpoint);
        this.#transactionActive = false;
      },
    };
  }

  #availableCacheSlot(sceneId: string): { facility: KitchenFacilitySnapshot; slot: KitchenCacheSlotSnapshot } | undefined {
    const occupied = new Set(this.#state.cacheClaims.map((entry) => entry.cacheSlotId));
    return this.#facilities.listFacilities()
      .filter((facility) => facility.sceneId === sceneId)
      .flatMap((facility) => facility.cacheSlots.map((slot) => ({ facility, slot })))
      .filter(({ slot }) => !occupied.has(slot.id))
      .sort((left, right) => left.facility.id.localeCompare(right.facility.id) || left.slot.id.localeCompare(right.slot.id))[0];
  }

  #releaseReservedBinding(
    binding: KitchenStepResourceBinding,
    reason: string,
    occurredAtUtcMs: number,
    emit: (event: DomainEvent) => void,
    operationId: string,
  ): void {
    this.#releaseMovement(`${operationId}:movement-release`, binding, occurredAtUtcMs, emit);
    const claim = this.#state.cacheClaims.find((entry) => entry.sourceStepInstanceId === binding.stepInstanceId);
    this.#replace({
      bindings: this.#state.bindings.filter((entry) => entry.stepInstanceId !== binding.stepInstanceId),
      cacheClaims: this.#state.cacheClaims.filter((entry) => entry.sourceStepInstanceId !== binding.stepInstanceId),
    });
    emit(this.#event(operationId, "kitchen.interaction-released", occurredAtUtcMs, {
      stepInstanceId: binding.stepInstanceId,
      characterId: binding.characterId,
      interactionId: binding.interactionId,
      reason,
    }));
    emit(this.#event(operationId, "kitchen.workstation-released", occurredAtUtcMs, {
      stepInstanceId: binding.stepInstanceId,
      facilityId: binding.facilityId,
      workstationId: binding.workstationId,
      reason,
    }));
    if (claim !== undefined) emit(this.#event(operationId, "kitchen.cache-slot-released", occurredAtUtcMs, {
      cacheClaimId: claim.id,
      cacheSlotId: claim.cacheSlotId,
      reason,
    }));
  }

  #releaseMovement(
    operationId: string,
    binding: KitchenStepResourceBinding,
    occurredAtUtcMs: number,
    emit: (event: DomainEvent) => void,
  ): void {
    const character = this.#movement.getCharacter(binding.characterId);
    if (character?.plan?.taskId !== binding.taskId) return;
    const released = this.#movement.releaseTask(operationId, binding.characterId, binding.taskId, occurredAtUtcMs);
    if (!released.accepted) {
      throw new KitchenFacilityRejected("MOVEMENT_REJECTED", `${released.code}: ${released.message}`);
    }
    for (const event of released.events) emit(event);
  }

  #validateReservationRequest(request: ReserveKitchenStepResourcesRequest): void {
    if (!validId(request.stepInstanceId) || !validId(request.executionId) || !validId(request.taskId) ||
      !uniqueValidIds(request.requiredCapabilityIds) || request.requiredCapabilityIds.length === 0 ||
      (request.attendance !== "required" && request.attendance !== "unattended") ||
      !Number.isFinite(request.speedUnitsPerSecond) || request.speedUnitsPerSecond <= 0 ||
      !nonNegativeInteger(request.occurredAtUtcMs) ||
      !nonNegativeInteger(request.reservationExpiresAtUtcMs) ||
      request.reservationExpiresAtUtcMs <= request.occurredAtUtcMs ||
      (request.outputCache !== undefined &&
        (request.outputCache.allowedConsumerStepInstanceIds.length === 0 ||
          !uniqueValidIds(request.outputCache.allowedConsumerStepInstanceIds)))) {
      throw new KitchenFacilityRejected("INVALID_REQUEST", "Kitchen step resource reservation request is invalid.");
    }
  }

  #requireBinding(stepInstanceId: string): KitchenStepResourceBinding {
    if (!validId(stepInstanceId)) {
      throw new KitchenFacilityRejected("INVALID_REQUEST", "Kitchen step id is invalid.");
    }
    const binding = this.#state.bindings.find((entry) => entry.stepInstanceId === stepInstanceId);
    if (binding === undefined) {
      throw new KitchenFacilityRejected("UNKNOWN_BINDING", `Kitchen step has no resource binding: ${stepInstanceId}`);
    }
    return binding;
  }

  #replaceBinding(binding: KitchenStepResourceBinding): void {
    this.#replace({
      bindings: this.#state.bindings.map((entry) =>
        entry.stepInstanceId === binding.stepInstanceId ? binding : entry,
      ),
    });
  }

  #run<TValue>(
    operationId: string,
    work: (emit: (event: DomainEvent) => void) => TValue,
  ): KitchenFacilityOperationResult<TValue> {
    if (!validId(operationId)) return this.#reject(operationId, "INVALID_REQUEST", "Kitchen facility operation id is invalid.");
    if (this.#state.processedOperationIds.includes(operationId)) {
      return this.#reject(operationId, "DUPLICATE_OPERATION", "Kitchen facility operation was already processed.");
    }
    try {
      const result = this.#transaction.run([this, this.#movement], ({ emit }) => {
        this.#replace({
          processedOperationIds: [...this.#state.processedOperationIds, operationId].slice(-OPERATION_HISTORY_LIMIT),
        });
        return work(emit);
      });
      return Object.freeze({
        accepted: true,
        changed: true,
        operationId,
        value: result.value,
        committedEventIds: result.committedEventIds,
      });
    } catch (error: unknown) {
      return error instanceof KitchenFacilityRejected
        ? this.#reject(operationId, error.code, error.message)
        : this.#reject(
            operationId,
            "INVALID_REQUEST",
            error instanceof Error ? error.message : "Kitchen facility operation failed.",
          );
    }
  }

  #unchanged<TValue>(operationId: string, value: TValue): KitchenFacilityOperationResult<TValue> {
    return Object.freeze({
      accepted: true,
      changed: false,
      operationId,
      value,
      committedEventIds: Object.freeze([]),
    });
  }

  #replace(update: Partial<KitchenFacilityModuleState>): void {
    this.#state = cloneState({ ...this.#state, ...update, revision: this.#state.revision + 1 });
  }

  #reject(
    operationId: string,
    code: KitchenFacilityRejectionCode,
    message: string,
  ): KitchenFacilityOperationResult<never> {
    return Object.freeze({
      accepted: false,
      changed: false,
      operationId,
      code,
      message,
      committedEventIds: [] as const,
    });
  }

  #event(operationId: string, type: string, occurredAtUtcMs: number, payload: unknown): DomainEvent {
    return Object.freeze({
      id: `${type}:${operationId}`,
      type,
      occurredAtUtcMs,
      causationId: operationId,
      correlationId: operationId,
      payload,
    });
  }

  #validateState(): void {
    if (this.#state.schemaVersion !== KITCHEN_FACILITY_SCHEMA_VERSION ||
      !nonNegativeInteger(this.#state.revision) ||
      new Set(this.#state.processedOperationIds).size !== this.#state.processedOperationIds.length ||
      this.#state.processedOperationIds.some((id) => !validId(id))) {
      throw new Error("Kitchen facility state header is invalid.");
    }
    const facilities = new Map(this.#facilities.listFacilities().map((entry) => [entry.id, entry]));
    const stepIds = new Set<string>();
    const taskIds = new Set<string>();
    const workstationIds = new Set<SubresourceId>();
    const interactionKeys = new Set<string>();
    for (const binding of this.#state.bindings) {
      const facility = facilities.get(binding.facilityId);
      const workstation = facility?.workstations.find((entry) => entry.id === binding.workstationId);
      const interactionKey = `${binding.facilityId}\u0000${binding.interactionId}`;
      if (!validId(binding.stepInstanceId) || !validId(binding.executionId) || !validId(binding.taskId) ||
        stepIds.has(binding.stepInstanceId) || taskIds.has(binding.taskId) ||
        workstationIds.has(binding.workstationId) || interactionKeys.has(interactionKey) ||
        workstation === undefined || workstation.interactionId !== binding.interactionId ||
        !uniqueValidIds(binding.requiredCapabilityIds) || binding.requiredCapabilityIds.length === 0 ||
        !binding.requiredCapabilityIds.every((id) => workstation.capabilityIds.includes(id)) ||
        (binding.phase !== "reserved" && binding.phase !== "running") ||
        !nonNegativeInteger(binding.reservedAtUtcMs) ||
        !nonNegativeInteger(binding.reservationExpiresAtUtcMs) ||
        binding.reservationExpiresAtUtcMs <= binding.reservedAtUtcMs ||
        (binding.phase === "reserved" ? binding.startedAtUtcMs !== null :
          !nonNegativeInteger(binding.startedAtUtcMs ?? -1))) {
        throw new Error(`Kitchen resource binding invariant failed: ${binding.stepInstanceId}`);
      }
      stepIds.add(binding.stepInstanceId);
      taskIds.add(binding.taskId);
      workstationIds.add(binding.workstationId);
      interactionKeys.add(interactionKey);
    }
    const claimIds = new Set<SubresourceId>();
    const cacheSlotIds = new Set<SubresourceId>();
    const sourceStepIds = new Set<string>();
    for (const claim of this.#state.cacheClaims) {
      const facility = facilities.get(claim.facilityId);
      if (claim.id !== claim.cacheSlotId || claimIds.has(claim.id) || cacheSlotIds.has(claim.cacheSlotId) ||
        sourceStepIds.has(claim.sourceStepInstanceId) ||
        facility?.cacheSlots.some((entry) => entry.id === claim.cacheSlotId) !== true ||
        !validId(claim.executionId) || !validId(claim.sourceStepInstanceId) ||
        !uniqueValidIds(claim.allowedConsumerStepInstanceIds) ||
        claim.allowedConsumerStepInstanceIds.length === 0 ||
        (claim.status !== "reserved" && claim.status !== "occupied") ||
        !nonNegativeInteger(claim.reservedAtUtcMs) ||
        (claim.status === "reserved" ? claim.occupiedAtUtcMs !== null :
          !nonNegativeInteger(claim.occupiedAtUtcMs ?? -1)) ||
        (claim.status === "reserved" && !stepIds.has(claim.sourceStepInstanceId))) {
        throw new Error(`Kitchen cache claim invariant failed: ${claim.id}`);
      }
      claimIds.add(claim.id);
      cacheSlotIds.add(claim.cacheSlotId);
      sourceStepIds.add(claim.sourceStepInstanceId);
    }
  }
}

