import type {
  CharacterPresentationReadModel,
  GameplayRestaurantCustomerSnapshot,
  GameplayRestaurantEventSnapshot,
  GameplayRestaurantSnapshot,
} from "@airship-restaurant/contracts";
import type { DialogueBubblePresentation } from "./dialogue-bubble-presenter";

export type RestaurantNpcKind = "guest" | "otto" | "baiyecheng";

export type RestaurantNpcAction =
  | "walking"
  | "browsing-menu"
  | "daydreaming"
  | "calling-otto"
  | "ordering"
  | "waiting"
  | "eating"
  | "talking"
  | "idle"
  | "serving"
  | "listening";

export type RestaurantGuestMealStatus =
  | "ambient"
  | "seated-idle"
  | "calling-otto"
  | "confirming-order"
  | "notifying-kitchen"
  | "awaiting-service"
  | "served";

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
  readonly customerId: string | null;
  readonly mealStatus: RestaurantGuestMealStatus;
}

export interface RestaurantNpcConversationPresentation {
  readonly dialogueId: string;
  readonly ready: boolean;
  readonly activeSpeakerActorId: string | null;
  readonly participantActorIds: readonly string[];
}

export interface RestaurantNpcDeliveryPresentation {
  readonly targetActorId: string;
  readonly customerId: string | null;
}

export interface RestaurantNpcOrderConfirmationPresentation {
  readonly targetActorId: string;
  readonly customerId: string;
  readonly phase: "approaching" | "confirming";
}

export interface RestaurantKitchenNotificationPresentation {
  readonly customerId: string;
  readonly recipeId: string;
  readonly channelId: string;
  readonly phase: "sending" | "received";
}

/** @deprecated Ambient opportunities are now created by Core, not renderer actors. */
export interface RestaurantNpcDialogueOpportunityPresentation {
  readonly id: string;
  readonly context: "arrival" | "waiting" | "eating" | "departing" | "idle";
  readonly availableGuestActorIds: readonly string[];
}

export interface RestaurantNpcFrame {
  readonly actors: readonly RestaurantNpcPresentation[];
  readonly conversation: RestaurantNpcConversationPresentation | null;
  readonly dialogueOpportunity: RestaurantNpcDialogueOpportunityPresentation | null;
  readonly delivery: RestaurantNpcDeliveryPresentation | null;
  readonly orderConfirmation: RestaurantNpcOrderConfirmationPresentation | null;
  readonly kitchenNotification: RestaurantKitchenNotificationPresentation | null;
}

export interface RestaurantNpcUpdateInput {
  readonly timeMs: number;
  readonly nowUtcMs: number;
  readonly dialogue: DialogueBubblePresentation | null;
  readonly restaurant: GameplayRestaurantSnapshot | null;
  readonly characters: CharacterPresentationReadModel | null;
  /** Presentation-only scenario counters; they never create business tasks. */
  readonly deliveryRevision?: number | null;
  readonly guestFlowRevision?: number;
  readonly seatCapacity?: number;
  /** @deprecated Legacy renderer coordinators only; the pure director ignores it. */
  readonly activeCustomer?: GameplayRestaurantCustomerSnapshot | null;
  /** @deprecated Legacy renderer coordinators only; the pure director ignores it. */
  readonly restaurantActivityRevision?: number;
  /** @deprecated Legacy renderer coordinators only; the pure director ignores it. */
  readonly restaurantEvents?: readonly GameplayRestaurantEventSnapshot[];
}