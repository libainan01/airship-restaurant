import type {
  DesktopWorldReadModel,
  FocusSessionReadModel,
  GameplayRestaurantEventSnapshot,
  OperationsGameplayReadModel,
} from "@airship-restaurant/contracts";
import {
  resolveDialogueBubblePresentation,
  type DialogueBubbleContentLookup,
  type DialogueBubblePresentation,
} from "./dialogue-bubble-presenter";
import {
  observeProcurementArrival,
  resolvePortStatusLabel,
  resolveRuntimePhaseLabel,
} from "./desktop-world-presenter";

export interface DesktopWorldRuntimeUpdate {
  readonly procurementArrivalMessage: string | null;
  readonly portStatusLabel: string;
  readonly runtimePhaseLabel: string;
  readonly seatCapacity: number;
  readonly seatCapacityChanged: boolean;
}

export class DesktopWorldPresentationModel {
  readonly #content: DialogueBubbleContentLookup;
  #gameplay: OperationsGameplayReadModel | null = null;
  #restaurantActivityRevision = 0;
  #restaurantEvents: readonly GameplayRestaurantEventSnapshot[] =
    Object.freeze([]);
  #dialogueBubble: DialogueBubblePresentation | null = null;
  #deliveryRevision: number | null = null;
  #guestFlowRevision = 0;
  #showLayoutAnchors = false;
  #runtimeQuietMode = false;
  #focusSession: FocusSessionReadModel | null = null;
  #lastProcurementArrivalRevision: number | null = null;

  constructor(content: DialogueBubbleContentLookup) {
    this.#content = content;
  }

  get gameplay(): OperationsGameplayReadModel | null {
    return this.#gameplay;
  }

  get restaurantActivityRevision(): number {
    return this.#restaurantActivityRevision;
  }

  get restaurantEvents(): readonly GameplayRestaurantEventSnapshot[] {
    return this.#restaurantEvents;
  }

  get dialogueBubble(): DialogueBubblePresentation | null {
    return this.#dialogueBubble;
  }

  get deliveryRevision(): number | null {
    return this.#deliveryRevision;
  }

  get guestFlowRevision(): number {
    return this.#guestFlowRevision;
  }

  get showLayoutAnchors(): boolean {
    return this.#showLayoutAnchors;
  }

  get runtimeQuietMode(): boolean {
    return this.#runtimeQuietMode;
  }

  get focusSession(): FocusSessionReadModel | null {
    return this.#focusSession;
  }

  applyReadModel(snapshot: DesktopWorldReadModel): DesktopWorldRuntimeUpdate {
    const procurement = snapshot.procurement;
    const arrival = observeProcurementArrival(
      this.#lastProcurementArrivalRevision,
      procurement ?? undefined,
    );
    this.#lastProcurementArrivalRevision = arrival.revision;
    this.#deliveryRevision =
      snapshot.deliveryRevision;
    this.#guestFlowRevision =
      snapshot.guestFlowRevision;
    this.#showLayoutAnchors = snapshot.showLayoutAnchors;
    this.#runtimeQuietMode = snapshot.quietMode;
    this.#focusSession = snapshot.focusSession ?? null;
    const previousSeatCapacity = this.#gameplay?.restaurant.seatCapacity ?? 3;
    const seatCapacity =
      snapshot.seatCapacity ?? previousSeatCapacity;
    this.#gameplay = snapshot.gameplay;
    this.#restaurantActivityRevision = snapshot.restaurantActivity.revision;
    this.#restaurantEvents = snapshot.restaurantActivity.events;
    const foregroundActive = snapshot.foregroundDialogue;
    this.#dialogueBubble = resolveDialogueBubblePresentation(
      foregroundActive === null
        ? null
        : {
            revision: snapshot.sourceRevision,
            active: foregroundActive,
            lastCompletedDialogueId: null,
            lastStartedOpportunityId: null,
            nextTransitionUtcMs: foregroundActive.endsAtUtcMs,
          },
      this.#content,
    );
    return Object.freeze({
      procurementArrivalMessage: arrival.message,
      portStatusLabel: resolvePortStatusLabel(procurement ?? undefined),
      runtimePhaseLabel: resolveRuntimePhaseLabel(
        snapshot.phase,
        snapshot.sourceRevision,
        snapshot.gameplayRevision,
      ),
      seatCapacity,
      seatCapacityChanged: seatCapacity !== previousSeatCapacity,
    });
  }
}
