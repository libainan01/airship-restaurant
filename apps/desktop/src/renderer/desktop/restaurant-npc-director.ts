import type { DialogueBubblePresentation } from "./dialogue-bubble-presenter";
import {
  createDefaultRestaurantLayoutRuntime,
  type RestaurantFunctionalPosition,
  type RestaurantLayoutRuntime,
  type RestaurantPositionSlotInstance,
} from "./restaurant-layout";

export type RestaurantNpcKind = "guest" | "otto";
export type RestaurantNpcAction = "walking" | "waiting" | "eating" | "talking" | "idle" | "serving" | "listening";

export interface RestaurantNpcPresentation {
  readonly instanceId: string;
  readonly kind: RestaurantNpcKind;
  readonly xRatio: number;
  readonly yRatio: number;
  readonly facing: -1 | 1;
  readonly action: RestaurantNpcAction;
  readonly visible: boolean;
  readonly positionSlotId: string | null;
  readonly speakerId: string | null;
  readonly speakerName: string | null;
  readonly conversationParticipant: boolean;
  readonly activeSpeaker: boolean;
  readonly trayVisible: boolean;
}

export interface RestaurantNpcConversationPresentation {
  readonly dialogueId: string;
  readonly ready: boolean;
  readonly activeSpeakerActorId: string | null;
  readonly participantActorIds: readonly string[];
}

export interface RestaurantNpcFrame {
  readonly actors: readonly RestaurantNpcPresentation[];
  readonly conversation: RestaurantNpcConversationPresentation | null;
}

export interface RestaurantNpcUpdateInput {
  readonly timeMs: number;
  readonly dialogue: DialogueBubblePresentation | null;
  readonly deliveryRevision: number | null;
}

type GuestState = "walking-to-seat" | "waiting" | "eating" | "walking-to-conversation" | "talking" | "post-conversation" | "leaving" | "offstage";
type OttoState = "idle" | "walking-to-conversation" | "listening" | "walking-to-pickup" | "picking-up" | "delivery-to-table" | "serving" | "delivery-return" | "returning-idle";
type NpcState = GuestState | OttoState;

interface MutableNpcActor {
  readonly instanceId: string;
  readonly kind: RestaurantNpcKind;
  xRatio: number;
  yRatio: number;
  targetXRatio: number | null;
  targetYRatio: number | null;
  facing: -1 | 1;
  state: NpcState;
  stateEndsAtMs: number | null;
  visible: boolean;
  positionSlotId: string | null;
  speakerId: string | null;
  speakerName: string | null;
  conversationParticipant: boolean;
  activeSpeaker: boolean;
  trayVisible: boolean;
  visitIndex: number;
}

const ARRIVAL_EPSILON = 0.002;
const MAX_FRAME_DELTA_MS = 250;
const GUEST_WALK_SPEED_RATIO_PER_SECOND = 0.23;
const OTTO_WALK_SPEED_RATIO_PER_SECOND = 0.27;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isGuest(actor: MutableNpcActor): boolean {
  return actor.kind === "guest";
}

function distanceTo(
  actor: Pick<MutableNpcActor, "xRatio" | "yRatio">,
  position: Pick<RestaurantFunctionalPosition, "xRatio" | "yRatio">,
): number {
  return Math.hypot(position.xRatio - actor.xRatio, position.yRatio - actor.yRatio);
}

function actionFor(actor: MutableNpcActor): RestaurantNpcAction {
  switch (actor.state) {
    case "walking-to-seat":
    case "walking-to-conversation":
    case "leaving":
    case "walking-to-pickup":
    case "delivery-to-table":
    case "delivery-return":
    case "returning-idle":
      return "walking";
    case "waiting": return "waiting";
    case "eating":
    case "post-conversation": return "eating";
    case "talking": return "talking";
    case "serving": return "serving";
    case "listening": return "listening";
    case "idle":
    case "picking-up":
    case "offstage": return "idle";
  }
}

export class RestaurantNpcDirector {
  readonly #layout: RestaurantLayoutRuntime;
  readonly #actors: MutableNpcActor[] = [];
  readonly #participantActorIds = new Map<string, string>();
  #initialized = false;
  #lastUpdateTimeMs = 0;
  #conversationId: string | null = null;
  #currentDialogue: DialogueBubblePresentation | null = null;
  #ottoIncludedInConversation = false;
  #lastDeliveryRevision: number | null = null;
  #deliveryQueued = false;

  constructor(layout: RestaurantLayoutRuntime = createDefaultRestaurantLayoutRuntime()) {
    this.#layout = layout;
  }

  update(input: RestaurantNpcUpdateInput): RestaurantNpcFrame {
    this.#ensureInitialized(input.timeMs);
    const deltaMs = clamp(input.timeMs - this.#lastUpdateTimeMs, 0, MAX_FRAME_DELTA_MS);
    this.#lastUpdateTimeMs = input.timeMs;
    this.#syncDeliveryRevision(input.deliveryRevision);
    this.#syncConversation(input.dialogue, input.timeMs);
    this.#advanceTimedStates(input.timeMs);
    this.#advanceMovement(deltaMs, input.timeMs);
    this.#advanceTimedStates(input.timeMs);
    this.#sendOttoToConversationIfAvailable();
    this.#startQueuedDeliveryIfPossible(input.timeMs);
    this.#refreshActiveSpeaker();
    return this.#createFrame();
  }

  #ensureInitialized(timeMs: number): void {
    if (this.#initialized) return;
    const entry = this.#layout.requireAnchor("guest-entry");
    const seats = this.#layout.getPositionSlots("seat");
    for (const [index, seat] of seats.entries()) {
      const instanceId = `npc.guest.${index}`;
      this.#layout.reservePosition(seat.id, instanceId);
      if (index === 1) {
        this.#actors.push(this.#createGuestActor(index, entry, "walking-to-seat", null, seat.id, seat));
      } else {
        this.#actors.push(this.#createGuestActor(index, seat, index === 0 ? "eating" : "waiting", timeMs + (index === 0 ? 7_500 : 2_200), seat.id));
      }
    }
    const home = this.#layout.requireAnchor("otto-home");
    this.#actors.push({
      instanceId: "npc.otto", kind: "otto", xRatio: home.xRatio, yRatio: home.yRatio,
      targetXRatio: null, targetYRatio: null, facing: home.facing, state: "idle",
      stateEndsAtMs: null, visible: true, positionSlotId: null,
      speakerId: "speaker.otto", speakerName: "奥托", conversationParticipant: false,
      activeSpeaker: false, trayVisible: false, visitIndex: 0,
    });
    this.#initialized = true;
    this.#lastUpdateTimeMs = timeMs;
  }

  #createGuestActor(
    index: number,
    position: RestaurantFunctionalPosition = this.#layout.requireAnchor("guest-entry"),
    state: GuestState = "offstage",
    stateEndsAtMs: number | null = null,
    positionSlotId: string | null = null,
    target: RestaurantFunctionalPosition | null = null,
  ): MutableNpcActor {
    return {
      instanceId: `npc.guest.${index}`, kind: "guest",
      xRatio: position.xRatio, yRatio: position.yRatio,
      targetXRatio: target?.xRatio ?? null, targetYRatio: target?.yRatio ?? null,
      facing: position.facing, state, stateEndsAtMs, visible: state !== "offstage",
      positionSlotId, speakerId: null, speakerName: null, conversationParticipant: false,
      activeSpeaker: false, trayVisible: false, visitIndex: 0,
    };
  }

  #otto(): MutableNpcActor {
    const actor = this.#actors.find((candidate) => candidate.kind === "otto");
    if (actor === undefined) throw new Error("Restaurant NPC director is missing Otto.");
    return actor;
  }

  #syncDeliveryRevision(deliveryRevision: number | null): void {
    if (deliveryRevision === null) return;
    const advanced = this.#lastDeliveryRevision === null ? deliveryRevision > 0 : deliveryRevision > this.#lastDeliveryRevision;
    if (advanced) this.#deliveryQueued = true;
    this.#lastDeliveryRevision = deliveryRevision;
  }

  #syncConversation(dialogue: DialogueBubblePresentation | null, timeMs: number): void {
    const nextConversationId = dialogue?.dialogueId ?? null;
    if (nextConversationId !== this.#conversationId) {
      this.#endConversation(timeMs);
      if (dialogue !== null) this.#beginConversation(dialogue, timeMs);
    }
    this.#currentDialogue = dialogue;
  }

  #beginConversation(dialogue: DialogueBubblePresentation, timeMs: number): void {
    const participantCount = dialogue.participants.length;
    const includesOtto = participantCount === 1;
    const positions = this.#layout.previewConversationPositions(participantCount + (includesOtto ? 1 : 0));
    const guests: MutableNpcActor[] = [];
    const selectedActorIds = new Set<string>();
    const blockingActorIds = new Set(
      positions.flatMap((position) =>
        position.conflictsWith
          .map((slotId) => this.#layout.getOccupant(slotId))
          .filter((actorId): actorId is string => actorId !== null),
      ),
    );
    for (const [index] of dialogue.participants.entries()) {
      const position = positions[index];
      if (position === undefined) throw new Error("Restaurant conversation is missing a guest position.");
      const actor = this.#selectGuestForConversation(
        position,
        timeMs,
        selectedActorIds,
        blockingActorIds,
      );
      guests.push(actor);
      selectedActorIds.add(actor.instanceId);
    }
    const actorIds = guests.map((actor) => actor.instanceId);
    if (includesOtto) actorIds.push(this.#otto().instanceId);
    const reservations = this.#layout.reserveConversation(dialogue.dialogueId, actorIds);

    this.#conversationId = dialogue.dialogueId;
    this.#participantActorIds.clear();
    for (const [index, participant] of dialogue.participants.entries()) {
      const actor = guests[index];
      const reservation = reservations[index];
      if (actor === undefined || reservation === undefined) throw new Error("Restaurant conversation actor assignment is incomplete.");
      actor.positionSlotId = reservation.slotId;
      actor.speakerId = participant.speakerId;
      actor.speakerName = participant.speakerName;
      actor.conversationParticipant = true;
      actor.activeSpeaker = participant.speakerId === dialogue.speakerId;
      actor.visible = true;
      this.#setTarget(actor, reservation.position);
      actor.stateEndsAtMs = null;
      actor.state = distanceTo(actor, reservation.position) <= ARRIVAL_EPSILON ? "talking" : "walking-to-conversation";
      actor.facing = reservation.position.facing;
      this.#participantActorIds.set(participant.speakerId, actor.instanceId);
    }

    this.#ottoIncludedInConversation = includesOtto;
    if (includesOtto) {
      const otto = this.#otto();
      const reservation = reservations.at(-1);
      if (reservation === undefined) throw new Error("Restaurant conversation is missing Otto's position.");
      otto.positionSlotId = reservation.slotId;
      otto.conversationParticipant = true;
      otto.activeSpeaker = false;
      this.#sendOttoToConversationIfAvailable();
    }
  }

  #selectGuestForConversation(
    position: RestaurantPositionSlotInstance,
    timeMs: number,
    assignedIds: ReadonlySet<string>,
    preferredActorIds: ReadonlySet<string>,
  ): MutableNpcActor {
    const candidates = this.#actors
      .filter((actor) => isGuest(actor) && !assignedIds.has(actor.instanceId))
      .sort((left, right) => {
        const leftPreferred = preferredActorIds.has(left.instanceId) ? 0 : 1;
        const rightPreferred = preferredActorIds.has(right.instanceId) ? 0 : 1;
        if (leftPreferred !== rightPreferred) {
          return leftPreferred - rightPreferred;
        }
        const leftAvailability = left.visible && left.state !== "leaving" ? 0 : 1;
        const rightAvailability = right.visible && right.state !== "leaving" ? 0 : 1;
        return leftAvailability !== rightAvailability
          ? leftAvailability - rightAvailability
          : distanceTo(left, position) - distanceTo(right, position);
      });
    let actor = candidates[0];
    if (actor === undefined) {
      const guestCount = this.#actors.filter(isGuest).length;
      actor = this.#createGuestActor(guestCount);
      this.#actors.unshift(actor);
    }
    if (!actor.visible) {
      const entry = this.#layout.requireAnchor("guest-entry");
      actor.xRatio = entry.xRatio;
      actor.yRatio = entry.yRatio;
      actor.facing = entry.facing;
      actor.visible = true;
      actor.visitIndex += 1;
    }
    actor.stateEndsAtMs = timeMs;
    return actor;
  }

  #endConversation(timeMs: number): void {
    if (this.#conversationId === null) return;
    this.#layout.releaseConversation(this.#conversationId);
    for (const actor of this.#actors) {
      if (!actor.conversationParticipant) continue;
      actor.positionSlotId = null;
      actor.conversationParticipant = false;
      actor.activeSpeaker = false;
      if (actor.kind === "guest") {
        this.#clearTarget(actor);
        actor.state = "post-conversation";
        actor.stateEndsAtMs = timeMs + 2_600;
      }
    }
    if (this.#ottoIncludedInConversation) {
      const otto = this.#otto();
      if (!this.#isOttoBusyWithDelivery(otto)) {
        otto.stateEndsAtMs = null;
        otto.trayVisible = false;
        if (this.#deliveryQueued) this.#startDelivery(timeMs);
        else {
          otto.state = "returning-idle";
          this.#setTarget(otto, this.#layout.requireAnchor("otto-home"));
        }
      }
    }
    this.#participantActorIds.clear();
    this.#conversationId = null;
    this.#currentDialogue = null;
    this.#ottoIncludedInConversation = false;
  }

  #refreshActiveSpeaker(): void {
    const activeSpeakerId = this.#currentDialogue?.speakerId ?? null;
    for (const actor of this.#actors) actor.activeSpeaker = actor.conversationParticipant && actor.speakerId === activeSpeakerId;
  }

  #advanceMovement(deltaMs: number, timeMs: number): void {
    for (const actor of this.#actors) {
      const targetX = actor.targetXRatio;
      const targetY = actor.targetYRatio;
      if (!actor.visible || targetX === null || targetY === null) continue;
      const deltaX = targetX - actor.xRatio;
      const deltaY = targetY - actor.yRatio;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance <= ARRIVAL_EPSILON) {
        actor.xRatio = targetX; actor.yRatio = targetY; this.#clearTarget(actor); this.#arriveAtTarget(actor, timeMs); continue;
      }
      if (Math.abs(deltaX) > ARRIVAL_EPSILON) actor.facing = deltaX >= 0 ? 1 : -1;
      const speed = actor.kind === "otto" ? OTTO_WALK_SPEED_RATIO_PER_SECOND : GUEST_WALK_SPEED_RATIO_PER_SECOND;
      const step = (speed * deltaMs) / 1_000;
      if (distance <= step) {
        actor.xRatio = targetX; actor.yRatio = targetY; this.#clearTarget(actor); this.#arriveAtTarget(actor, timeMs);
      } else {
        actor.xRatio += (deltaX / distance) * step;
        actor.yRatio += (deltaY / distance) * step;
      }
    }
  }

  #arriveAtTarget(actor: MutableNpcActor, timeMs: number): void {
    switch (actor.state) {
      case "walking-to-seat": actor.state = "waiting"; actor.stateEndsAtMs = timeMs + 2_200; break;
      case "walking-to-conversation": actor.state = actor.kind === "otto" ? "listening" : "talking"; actor.stateEndsAtMs = null; break;
      case "leaving":
        this.#layout.releaseActor(actor.instanceId); actor.positionSlotId = null; actor.state = "offstage";
        actor.stateEndsAtMs = timeMs + 2_800; actor.visible = false; actor.speakerId = null;
        actor.speakerName = null; actor.conversationParticipant = false; actor.activeSpeaker = false; actor.visitIndex += 1; break;
      case "walking-to-pickup": actor.state = "picking-up"; actor.stateEndsAtMs = timeMs + 650; actor.trayVisible = false; break;
      case "delivery-to-table": actor.state = "serving"; actor.stateEndsAtMs = timeMs + 1_400; actor.trayVisible = true; break;
      case "delivery-return":
      case "returning-idle": actor.state = "idle"; actor.stateEndsAtMs = null; actor.trayVisible = false; break;
      default: break;
    }
  }

  #advanceTimedStates(timeMs: number): void {
    for (const actor of this.#actors) {
      if (actor.stateEndsAtMs === null || timeMs < actor.stateEndsAtMs) continue;
      if (actor.kind === "guest") this.#advanceGuestTimedState(actor, timeMs);
      else this.#advanceOttoTimedState(actor);
    }
  }

  #advanceGuestTimedState(actor: MutableNpcActor, timeMs: number): void {
    switch (actor.state) {
      case "waiting": actor.state = "eating"; actor.stateEndsAtMs = timeMs + 6_800 + ((actor.visitIndex * 1_137 + 1_900) % 3_000); break;
      case "eating":
      case "post-conversation": {
        const exit = this.#layout.requireAnchor("guest-exit");
        this.#layout.releaseActor(actor.instanceId); actor.positionSlotId = null;
        actor.state = "leaving"; actor.stateEndsAtMs = null; this.#setTarget(actor, exit); actor.facing = exit.facing; break;
      }
      case "offstage": this.#sendGuestToAvailableSeat(actor, timeMs); break;
      default: actor.stateEndsAtMs = null; break;
    }
  }

  #sendGuestToAvailableSeat(actor: MutableNpcActor, timeMs: number): void {
    const reservation = this.#layout.reserveFirstAvailableSeat(actor.instanceId);
    if (reservation === null) { actor.stateEndsAtMs = timeMs + 1_800; return; }
    const entry = this.#layout.requireAnchor("guest-entry");
    actor.visible = true; actor.xRatio = entry.xRatio; actor.yRatio = entry.yRatio; actor.facing = entry.facing;
    actor.positionSlotId = reservation.slotId; this.#setTarget(actor, reservation.position);
    actor.state = "walking-to-seat"; actor.stateEndsAtMs = null;
  }

  #advanceOttoTimedState(actor: MutableNpcActor): void {
    switch (actor.state) {
      case "picking-up": actor.state = "delivery-to-table"; actor.stateEndsAtMs = null; this.#setTarget(actor, this.#layout.requireAnchor("delivery-table")); actor.trayVisible = true; break;
      case "serving": actor.state = "delivery-return"; actor.stateEndsAtMs = null; this.#setTarget(actor, this.#layout.requireAnchor("otto-home")); actor.trayVisible = false; break;
      default: actor.stateEndsAtMs = null; break;
    }
  }

  #sendOttoToConversationIfAvailable(): void {
    if (!this.#ottoIncludedInConversation || this.#conversationId === null) return;
    const otto = this.#otto();
    otto.conversationParticipant = true;
    if (this.#isOttoBusyWithDelivery(otto) || otto.state === "walking-to-conversation" || otto.state === "listening") return;
    if (otto.positionSlotId === null) throw new Error("Otto is missing a reserved conversation position.");
    const position = this.#layout.requirePositionSlot(otto.positionSlotId);
    otto.trayVisible = false; this.#setTarget(otto, position); otto.stateEndsAtMs = null;
    otto.state = distanceTo(otto, position) <= ARRIVAL_EPSILON ? "listening" : "walking-to-conversation";
    otto.facing = position.facing;
  }

  #startQueuedDeliveryIfPossible(timeMs: number): void {
    if (!this.#deliveryQueued || this.#ottoIncludedInConversation) return;
    const otto = this.#otto();
    if (!this.#isOttoBusyWithDelivery(otto)) this.#startDelivery(timeMs);
  }

  #startDelivery(timeMs: number): void {
    const otto = this.#otto();
    const pickup = this.#layout.requireAnchor("otto-pickup");
    this.#layout.releaseActor(otto.instanceId); otto.positionSlotId = null; this.#deliveryQueued = false;
    otto.conversationParticipant = false; otto.activeSpeaker = false; otto.trayVisible = false; otto.stateEndsAtMs = null;
    if (distanceTo(otto, pickup) <= ARRIVAL_EPSILON) {
      otto.xRatio = pickup.xRatio; otto.yRatio = pickup.yRatio; this.#clearTarget(otto);
      otto.state = "picking-up"; otto.stateEndsAtMs = timeMs + 650;
    } else { this.#setTarget(otto, pickup); otto.state = "walking-to-pickup"; }
  }

  #isOttoBusyWithDelivery(actor: MutableNpcActor): boolean {
    return actor.state === "walking-to-pickup" || actor.state === "picking-up" || actor.state === "delivery-to-table" || actor.state === "serving" || actor.state === "delivery-return";
  }

  #setTarget(actor: MutableNpcActor, position: Pick<RestaurantFunctionalPosition, "xRatio" | "yRatio">): void {
    actor.targetXRatio = position.xRatio; actor.targetYRatio = position.yRatio;
  }

  #clearTarget(actor: MutableNpcActor): void { actor.targetXRatio = null; actor.targetYRatio = null; }

  #createFrame(): RestaurantNpcFrame {
    const actors = this.#actors.map((actor) => Object.freeze({
      instanceId: actor.instanceId, kind: actor.kind, xRatio: actor.xRatio, yRatio: actor.yRatio,
      facing: actor.facing, action: actionFor(actor), visible: actor.visible, positionSlotId: actor.positionSlotId,
      speakerId: actor.speakerId, speakerName: actor.speakerName,
      conversationParticipant: actor.conversationParticipant, activeSpeaker: actor.activeSpeaker,
      trayVisible: actor.trayVisible,
    }));
    return Object.freeze({ actors: Object.freeze(actors), conversation: this.#createConversationFrame() });
  }

  #createConversationFrame(): RestaurantNpcConversationPresentation | null {
    const dialogue = this.#currentDialogue;
    if (dialogue === null || this.#conversationId === null) return null;
    const participantActorIds = dialogue.participants
      .map((participant) => this.#participantActorIds.get(participant.speakerId))
      .filter((actorId): actorId is string => actorId !== undefined);
    if (this.#ottoIncludedInConversation) participantActorIds.push(this.#otto().instanceId);
    const participantActors = participantActorIds
      .map((actorId) => this.#actors.find((actor) => actor.instanceId === actorId))
      .filter((actor): actor is MutableNpcActor => actor !== undefined);
    const ready = participantActors.length === participantActorIds.length && participantActors.every((actor) => actor.state === "talking" || actor.state === "listening");
    return Object.freeze({
      dialogueId: dialogue.dialogueId, ready,
      activeSpeakerActorId: this.#participantActorIds.get(dialogue.speakerId) ?? null,
      participantActorIds: Object.freeze(participantActorIds),
    });
  }
}