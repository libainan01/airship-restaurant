export type WorkspaceChannel = "desktop" | "management";

export interface WorkspaceBridgeInfo {
  readonly channel: WorkspaceChannel;
  readonly version: string;
}

export const IPC_CHANNELS = {
  runtimeDispatchCommand: "runtime:dispatch-command",
  runtimeGetReadModel: "runtime:get-read-model",
  runtimeSubscribeReadModel: "runtime:subscribe-read-model",
  runtimeUnsubscribeReadModel: "runtime:unsubscribe-read-model",
  runtimeReadModelChanged: "runtime:read-model-changed",
  windowOpenManagement: "window:open-management",
  managementNavigate: "management:navigate",
  desktopSetInteraction: "desktop:set-interaction",
  desktopCursorPosition: "desktop:cursor-position",
  settingsGetSnapshot: "settings:get-snapshot",
  settingsUpdate: "settings:update",
  settingsChanged: "settings:changed",
  settingsListDisplays: "settings:list-displays",
  saveGetDiagnostics: "save:get-diagnostics",
  saveDiagnosticsChanged: "save:diagnostics-changed",
} as const;

export type RuntimeReadModelKey =
  | "layout"
  | "inventory"
  | "characters"
  | "instance-upgrades"
  | "recruitment"
  | "progression"
  | "desktop-world"
  | "operations"
  | "procurement"
  | "finance";

export interface LayoutReadModelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutReadModelBuilding {
  readonly id: string;
  readonly definitionId: string;
  readonly sceneId: string | null;
  readonly x: number;
  readonly y: number;
  readonly orientation: string;
  readonly styleId: string;
  readonly level: number;
  readonly durability: number;
  readonly enabled: boolean;
  readonly stored: boolean;
  readonly renderSortY: number;
  readonly hardFootprints: readonly LayoutReadModelRect[];
  readonly visualBounds: LayoutReadModelRect | null;
  readonly interactionAreas: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly bounds: LayoutReadModelRect;
  }[];
  readonly capabilityValues: Readonly<Record<string, number>>;
  readonly components: readonly {
    readonly slotId: string;
    readonly capabilityId: string;
    readonly componentId: string;
  }[];
}

export interface LayoutReadModel {
  readonly sourceRevision: number;
  readonly scenes: readonly {
    readonly sceneId: string;
    readonly buildings: readonly LayoutReadModelBuilding[];
  }[];
  readonly storedBuildings: readonly LayoutReadModelBuilding[];
}

export interface BuildingInstanceUpgradeReadModel {
  readonly id: string;
  readonly definitionId: string;
  readonly sceneId: string | null;
  readonly x: number;
  readonly y: number;
  readonly orientation: string;
  readonly styleId: string;
  readonly styleIds: readonly string[];
  readonly allowedRegionTags: readonly string[];
  readonly movable: boolean;
  readonly footprintWidth: number;
  readonly footprintHeight: number;
  readonly currentLevel: number;
  readonly maxLevel: number;
  readonly currentCapabilityValues: Readonly<Record<string, number>>;
  readonly nextLevel: {
    readonly level: number;
    readonly costCopper: number;
    readonly capabilityValues: Readonly<Record<string, number>>;
    readonly footprintWidth: number;
    readonly footprintHeight: number;
  } | null;
  readonly activePreview: {
    readonly id: string;
    readonly targetLevel: number;
    readonly costCopper: number;
    readonly requiresLayoutPreview: boolean;
    readonly placementValid: boolean;
    readonly issues: readonly string[];
  } | null;
}

export interface ProcurementCartUpgradeReadModel {
  readonly id: string;
  readonly currentLevel: number;
  readonly maxLevel: number;
  readonly capacity: number;
  readonly speedUnitsPerSecond: number;
  readonly activeBatchId: string | null;
  readonly nextLevel: {
    readonly level: number;
    readonly costCopper: number;
    readonly capacity: number;
    readonly speedUnitsPerSecond: number;
  } | null;
}

export interface ProcurementAirshipUpgradeReadModel {
  readonly id: string;
  readonly name: string;
  readonly currentLevel: number;
  readonly maxLevel: number;
  readonly cargoCapacity: number;
  readonly speedUnitsPerSecond: number;
  readonly durability: number;
  readonly maxDurability: number;
  readonly activeVoyageId: string | null;
  readonly cooldownEndsAtUtcMs: number;
  readonly nextLevel: {
    readonly level: number;
    readonly costCopper: number;
    readonly cargoCapacity: number;
    readonly speedUnitsPerSecond: number;
    readonly maxDurability: number;
    readonly cooldownEfficiency: number;
  } | null;
}
export interface BuildingConstructionCatalogReadModel {
  readonly definitionId: string;
  readonly name: string;
  readonly buildCostCopper: number;
  readonly unlocked: boolean;
  readonly styleIds: readonly string[];
  readonly defaultStyleId: string;
  readonly defaultOrientation: string;
  readonly allowedRegionTags: readonly string[];
  readonly footprintWidth: number;
  readonly footprintHeight: number;
}
export interface BuildingConstructionPreviewReadModel {
  readonly id: string;
  readonly buildingInstanceId: string;
  readonly definitionId: string;
  readonly styleId: string;
  readonly costCopper: number;
  readonly x: number | null;
  readonly y: number | null;
  readonly orientation: string | null;
  readonly placementValid: boolean;
  readonly issues: readonly string[];
}
export interface InstanceUpgradesReadModel {
  readonly sourceRevision: number;
  readonly editMode: {
    readonly active: boolean;
    readonly sceneId: string | null;
  };
  readonly buildingCommandsAvailable: boolean;
  readonly constructionCommandsAvailable: boolean;
  readonly buildingCatalog: readonly BuildingConstructionCatalogReadModel[];
  readonly constructionPreviews: readonly BuildingConstructionPreviewReadModel[];
  readonly procurementCartCommandsAvailable: boolean;
  readonly procurementAirshipCommandsAvailable: boolean;
  readonly buildings: readonly BuildingInstanceUpgradeReadModel[];
  readonly procurementCarts: readonly ProcurementCartUpgradeReadModel[];
  readonly procurementAirships: readonly ProcurementAirshipUpgradeReadModel[];
}

export interface RecruitmentSkillLevelsReadModel {
  readonly cooking: number;
  readonly charm: number;
  readonly movement: number;
  readonly repair: number;
  readonly piloting: number;
}

export interface RecruitmentCandidateReadModel {
  readonly id: string;
  readonly name: string;
  readonly skillLevels: RecruitmentSkillLevelsReadModel;
  readonly talents: readonly { readonly id: string; readonly name: string }[];
  readonly learnedJobIds: readonly string[];
  readonly primaryJobId: string;
  readonly hireCostCopper: number;
  readonly qualityTier: number;
}

export interface RecruitmentEmployeeReadModel {
  readonly characterId: string;
  readonly name: string;
  readonly coreMember: boolean;
  readonly kind: "core" | "recruited";
  readonly learnedJobIds: readonly string[];
  readonly primaryJobId: string;
  readonly dailyShift: {
    readonly startMinuteInclusive: number;
    readonly endMinuteExclusive: number;
  } | null;
  readonly dismissalPending: boolean;
  readonly onShift: boolean;
  readonly voyageActive: boolean;
  readonly currentTaskId: string | null;
  readonly skillLevels: RecruitmentSkillLevelsReadModel;
}

export interface RecruitmentReadModel {
  readonly sourceRevision: number;
  readonly currentUtcMs: number;
  readonly nextFreeRefreshAtUtcMs: number;
  readonly freeRefreshAvailable: boolean;
  readonly manualRefreshCostCopper: number;
  readonly recruitedEmployeeCount: number;
  readonly employeeLimit: number;
  readonly commandsAvailable: boolean;
  readonly candidates: readonly RecruitmentCandidateReadModel[];
  readonly employees: readonly RecruitmentEmployeeReadModel[];
}

export type ProgressionContentKindReadModel =
  | "region"
  | "route"
  | "recipe"
  | "building"
  | "building-style";

export type ProgressionContentStatusReadModel =
  | "locked"
  | "unlockable"
  | "unlocked";

export interface ProgressionUnavailableReasonReadModel {
  readonly code: string;
  readonly message: string;
}

export interface ProgressionContentReadModel {
  readonly id: string;
  readonly kind: ProgressionContentKindReadModel;
  readonly name: string;
  readonly status: ProgressionContentStatusReadModel;
  readonly currentlyUsable: boolean;
  readonly unavailableReasons: readonly ProgressionUnavailableReasonReadModel[];
  readonly unlockSourceIds: readonly string[];
}

export interface ProgressionReadModel {
  readonly sourceRevision: number;
  readonly revealedCount: number;
  readonly unlockedCount: number;
  readonly contents: readonly ProgressionContentReadModel[];
}

export type InventoryReadModelCategory =
  | "ingredient"
  | "dishware"
  | "intermediate"
  | "meal";

export interface InventoryReadModelItemTotal {
  readonly itemId: string;
  readonly category: InventoryReadModelCategory;
  readonly quantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
  readonly inTransitQuantity: number;
}

export interface InventoryReadModelLocation {
  readonly id: string;
  readonly compartments: readonly {
    readonly id: string;
    readonly capacity: number;
    readonly occupied: number;
    readonly reservedCapacity: number;
    readonly availableCapacity: number;
  }[];
  readonly items: readonly InventoryReadModelItemTotal[];
  readonly instances: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly category: InventoryReadModelCategory;
    readonly reservationId: string | null;
    readonly attributes: Readonly<
      Record<string, string | number | boolean | null>
    >;
  }[];
}

export interface InventoryReadModelDishwareSummary {
  readonly sourceRevision: number;
  readonly totalPlateCount: number;
  readonly clean: number;
  readonly inUse: number;
  readonly dirty: number;
  readonly washing: number;
  readonly activeWashJobs: number;
}

export interface ManualLogisticsDemandReadModel {
  readonly id: string;
  readonly sourceLocationId: string;
  readonly targetLocationId: string;
  readonly itemId: string;
  readonly requestedQuantity: number;
  readonly claimedQuantity: number;
  readonly deliveredQuantity: number;
  readonly remainingQuantity: number;
  readonly status: "in-progress" | "completed" | "stopped";
  readonly blockReason: "NONE" | "WAITING_SOURCE" | "WAITING_CAPACITY";
  readonly manualOrder: number;
}

export interface ManualLogisticsReadModel {
  readonly sourceRevision: number;
  readonly commandsAvailable: boolean;
  readonly stationLocationIds: readonly string[];
  readonly demands: readonly ManualLogisticsDemandReadModel[];
}

export interface InventoryReadModel {
  readonly sourceRevision: number;
  readonly locations: readonly InventoryReadModelLocation[];
  readonly totals: readonly InventoryReadModelItemTotal[];
  readonly reservationCount: number;
  readonly capacityReservationCount: number;
  readonly dishware: InventoryReadModelDishwareSummary | null;
  readonly manualLogistics?: ManualLogisticsReadModel;
}

export type CharacterPresentationAction =
  | "idle"
  | "moving"
  | "interacting"
  | "blocked"
  | "waiting-elevator"
  | "boarding-elevator"
  | "riding-elevator"
  | "alighting-elevator";

export interface CharacterPresentationTarget {
  readonly type: string;
  readonly id: string;
  readonly interactionId: string | null;
}

export interface CharacterPresentationTaskSummary {
  readonly id: string;
  readonly type: string;
  readonly status: "in-progress";
}

export interface CharacterPresentationItem {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly coreMember: boolean;
  readonly navigationAreaId: string | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly action: CharacterPresentationAction;
  readonly target: CharacterPresentationTarget | null;
  readonly task: CharacterPresentationTaskSummary | null;
  readonly tags: readonly string[];
  readonly primaryJobId: string | null;
  readonly elevatorRequestId: string | null;
}

export interface PersonnelElevatorPresentationRequest {
  readonly id: string;
  readonly characterId: string;
  readonly fromStationId: string;
  readonly toStationId: string;
}

export interface PersonnelElevatorPresentation {
  readonly id: string;
  readonly phase:
    | "idle"
    | "moving-empty"
    | "boarding"
    | "moving-passenger"
    | "alighting";
  readonly phaseProgress: number;
  readonly phaseStartedAtUtcMs: number;
  readonly phaseEndsAtUtcMs: number | null;
  readonly cabinStationId: string | null;
  readonly motionFromStationId: string | null;
  readonly motionToStationId: string | null;
  readonly passengerCharacterId: string | null;
  readonly activeRequest: PersonnelElevatorPresentationRequest | null;
  readonly queue: readonly PersonnelElevatorPresentationRequest[];
}

export interface CharacterPresentationReadModel {
  readonly sourceRevision: number;
  readonly characters: readonly CharacterPresentationItem[];
  readonly personnelElevator: PersonnelElevatorPresentation | null;
}

export interface DesktopWorldReadModel {
  readonly sourceRevision: number;
  readonly phase: RuntimePhase;
  readonly gameplayRevision: number | null;
  readonly gameplay: OperationsGameplayReadModel | null;
  readonly quietMode: boolean;
  readonly focusSession?: FocusSessionReadModel | null;
  readonly procurement: GameplayProcurementSnapshot | null;
  readonly seatCapacity: number | null;
  readonly restaurantActivity: GameplayRestaurantActivitySnapshot;
  readonly foregroundDialogue: AmbientDialogueActiveSnapshot | null;
  readonly deliveryRevision: number;
  readonly guestFlowRevision: number;
  readonly showLayoutAnchors: boolean;
}

export type OperationsGameplayReadModel = Omit<
  GameplaySnapshot,
  "inventory" | "procurement"
>;

export interface StoryRosterNodeReadModel {
  readonly id: string;
  readonly status: "locked" | "available" | "completed";
  readonly hint: string | null;
  readonly summary: string | null;
  readonly rewardContentIds: readonly string[];
}

export interface StoryRosterCharacterReadModel {
  readonly characterId: string;
  readonly identity: string;
  readonly affinity: number;
  readonly relationshipTierId: string;
  readonly completedNodeCount: number;
  readonly totalNodeCount: number;
  readonly nodes: readonly StoryRosterNodeReadModel[];
}

export interface StoryRosterReadModel {
  readonly revision: number;
  readonly characters: readonly StoryRosterCharacterReadModel[];
}

export type FocusSessionPhase = "idle" | "waiting-for-dialogue" | "focusing" | "break";

export interface FocusSessionReadModel {
  readonly revision: number;
  readonly phase: FocusSessionPhase;
  readonly requestedAtUtcMs: number | null;
  readonly phaseStartedAtUtcMs: number | null;
  readonly phaseEndsAtUtcMs: number | null;
  readonly remainingMs: number | null;
  readonly completedFocusCount: number;
  readonly focusDurationMs: number;
  readonly breakDurationMs: number;
  readonly effects: {
    readonly active: boolean;
    readonly customerArrivalIntervalRateBasisPoints: number;
    readonly incomeBonusRateBasisPoints: number;
  };
}

export interface OperationsReadModel {
  readonly sourceRevision: number;
  readonly gameplay: OperationsGameplayReadModel | null;
  readonly restaurantActivity: GameplayRestaurantActivitySnapshot;
  readonly narrative: NarrativeSnapshot | null;
  readonly dialogue: AmbientDialogueSnapshot | null;
  readonly story: StorySequenceSnapshot | null;
  readonly storyRoster: StoryRosterReadModel | null;
  readonly focusSession: FocusSessionReadModel | null;
  readonly technology: TechnologySnapshot | null;
  readonly offlineEarnings: OfflineEarningsSummary | null;
}

export interface ProcurementReadModel {
  readonly authority?: "legacy-m2" | "module.procurement";
  readonly sourceRevision: number;
  readonly currentUtcMs: number | null;
  readonly selectedRecipeId: string | null;
  readonly procurement: GameplayProcurementSnapshot | null;
}

export type FinanceIncomeCategoryReadModel =
  | "dish-sales"
  | "tips"
  | "focus-bonus"
  | "other-income";
export type FinanceExpenseCategoryReadModel =
  | "ingredient-procurement"
  | "employee-wages"
  | "employee-recruitment"
  | "recruitment-refresh"
  | "airship-voyage"
  | "equipment-repair"
  | "technology-upgrade"
  | "building-purchase"
  | "vehicle-upgrade"
  | "other-expense";

export interface FinanceReportDetailReadModel {
  readonly occurredAtUtcMs: number;
  readonly amountCopper: number;
  readonly category: FinanceIncomeCategoryReadModel | FinanceExpenseCategoryReadModel;
  readonly regionId: string;
  readonly sourceName: string;
  readonly note: string | null;
}
export interface FinanceReportGroupReadModel {
  readonly category: FinanceIncomeCategoryReadModel | FinanceExpenseCategoryReadModel;
  readonly totalCopper: number;
  readonly details: readonly FinanceReportDetailReadModel[];
}
export interface FinanceDayReportReadModel {
  readonly gameDay: number;
  readonly closed: boolean;
  readonly openingBalanceCopper: number;
  readonly incomeGroups: readonly FinanceReportGroupReadModel[];
  readonly expenseGroups: readonly FinanceReportGroupReadModel[];
  readonly totalIncomeCopper: number;
  readonly totalExpenseCopper: number;
  readonly netCopper: number;
  readonly closingBalanceCopper: number;
  readonly closedAtUtcMs: number | null;
}
export interface FinanceReadModel {
  readonly sourceRevision: number;
  readonly balanceCopper: number;
  readonly reservedCopper: number;
  readonly availableCopper: number;
  readonly totalCopperSpent: number;
  readonly recentSales: readonly GameplayRestaurantSaleSnapshot[];
  readonly currentDay: FinanceDayReportReadModel;
  readonly historicalDays: readonly FinanceDayReportReadModel[];
}

export type RuntimeReadModelSlice =
  | {
      readonly key: "layout";
      readonly revision: number;
      readonly value: LayoutReadModel;
    }
  | {
      readonly key: "inventory";
      readonly revision: number;
      readonly value: InventoryReadModel;
    }
  | {
      readonly key: "characters";
      readonly revision: number;
      readonly value: CharacterPresentationReadModel;
    }
  | {
      readonly key: "instance-upgrades";
      readonly revision: number;
      readonly value: InstanceUpgradesReadModel;
    }
  | {
      readonly key: "recruitment";
      readonly revision: number;
      readonly value: RecruitmentReadModel;
    }
  | {
      readonly key: "progression";
      readonly revision: number;
      readonly value: ProgressionReadModel;
    }
  | {
      readonly key: "desktop-world";
      readonly revision: number;
      readonly value: DesktopWorldReadModel;
    }
  | {
      readonly key: "operations";
      readonly revision: number;
      readonly value: OperationsReadModel;
    }
  | {
      readonly key: "procurement";
      readonly revision: number;
      readonly value: ProcurementReadModel;
    }
  | {
      readonly key: "finance";
      readonly revision: number;
      readonly value: FinanceReadModel;
    };

export type RuntimeReadModelChangedListener = (
  slice: RuntimeReadModelSlice,
) => void;
export type RuntimePhase = "booting" | "ready";

export interface RuntimeSettingsSnapshot {
  readonly quietMode: boolean;
}

export interface GameplayInventoryEntrySnapshot {
  readonly itemId: string;
  readonly quantity: number;
  readonly reservedQuantity: number;
  readonly availableQuantity: number;
}

export interface GameplayInventoryContainerSnapshot {
  readonly id: string;
  readonly capacity: number;
  readonly totalQuantity: number;
  readonly availableCapacity: number;
  readonly entries: readonly GameplayInventoryEntrySnapshot[];
}

export interface GameplayCookingJobSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly status: "cooking" | "waiting-output";
  readonly startedAtUtcMs: number;
  readonly finishAtUtcMs: number;
}

export interface GameplayCookingSnapshot {
  readonly selectedRecipeId: string | null;
  readonly autoRepeat: boolean;
  readonly activeJob: GameplayCookingJobSnapshot | null;
  readonly blockedReason:
    | "insufficient-ingredients"
    | "output-capacity"
    | null;
  readonly completedBatches: number;
  readonly nextTransitionUtcMs: number | null;
}

export interface GameplayLogisticsSnapshot {
  readonly phase:
    | "idle"
    | "outbound"
    | "waiting-unload"
    | "returning";
  readonly shipmentId: string | null;
  readonly departedAtUtcMs: number | null;
  readonly arriveAtUtcMs: number | null;
  readonly returnStartedAtUtcMs: number | null;
  readonly returnAtUtcMs: number | null;
  readonly kitchenWaitingSinceUtcMs: number | null;
  readonly kitchenWaitingQuantity: number;
  readonly cargoQuantity: number;
  readonly totalDeliveredQuantity: number;
  readonly nextTransitionUtcMs: number | null;
}

export type GameplayRestaurantCustomerPhase =
  | "seated-idle"
  | "awaiting-order-confirmation"
  | "confirming-order"
  | "notifying-kitchen"
  | "waiting-meal";

export interface GameplayRestaurantCustomerSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly arrivedAtUtcMs: number;
  readonly leaveAtUtcMs: number;
  readonly phase: GameplayRestaurantCustomerPhase;
  readonly phaseEndsAtUtcMs: number | null;
}

export interface GameplayRestaurantDiningCustomerSnapshot {
  readonly id: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly diningStartedAtUtcMs: number;
  readonly departAtUtcMs: number;
}

export interface GameplayRestaurantOrderSnapshot {
  readonly customerId: string;
  readonly recipeId: string;
  readonly dishItemId: string;
}

export interface GameplayRestaurantSaleSnapshot {
  readonly customerId: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly quantity: 1;
  readonly copperEarned: number;
  readonly soldAtUtcMs: number;
}

export type GameplayRestaurantEventSnapshot =
  | {
      readonly id: string;
      readonly type: "customer.arrived";
      readonly customer: GameplayRestaurantCustomerSnapshot;
    }
  | {
      readonly id: string;
      readonly type: "order.requested";
      readonly order: GameplayRestaurantOrderSnapshot;
      readonly requestedAtUtcMs: number;
    }
  | {
      readonly id: string;
      readonly type: "order.confirmation-started";
      readonly order: GameplayRestaurantOrderSnapshot;
      readonly startedAtUtcMs: number;
    }
  | {
      readonly id: string;
      readonly type: "order.confirmed";
      readonly order: GameplayRestaurantOrderSnapshot;
      readonly confirmedAtUtcMs: number;
    }
  | {
      readonly id: string;
      readonly type: "kitchen.notification-sent";
      readonly order: GameplayRestaurantOrderSnapshot;
      readonly channelId: string;
      readonly sentAtUtcMs: number;
      readonly expectedReceiptAtUtcMs: number;
    }
  | {
      readonly id: string;
      readonly type: "kitchen.order-received";
      readonly order: GameplayRestaurantOrderSnapshot;
      readonly channelId: string;
      readonly receivedAtUtcMs: number;
    }
  | {
      readonly id: string;
      readonly type: "order.fulfilled";
      readonly sale: GameplayRestaurantSaleSnapshot;
    }
  | {
      readonly id: string;
      readonly type: "customer.dining-completed";
      readonly customer: GameplayRestaurantDiningCustomerSnapshot;
      readonly completedAtUtcMs: number;
    }
  | {
      readonly id: string;
      readonly type: "customer.left";
      readonly customerId: string;
      readonly recipeId: string;
      readonly leftAtUtcMs: number;
      readonly reason: "out-of-stock" | "wait-timeout";
    };

export interface GameplayRestaurantActivitySnapshot {
  readonly revision: number;
  readonly events: readonly GameplayRestaurantEventSnapshot[];
}

export interface GameplayRestaurantSnapshot {
  readonly selectedRecipeId: string | null;
  readonly activeCustomer: GameplayRestaurantCustomerSnapshot | null;
  readonly diningCustomers: readonly GameplayRestaurantDiningCustomerSnapshot[];
  readonly seatCapacity: number | null;
  readonly nextCustomerAtUtcMs: number | null;
  readonly totalSoldQuantity: number;
  readonly totalCustomersLeft: number;
  readonly copperBalance: number;
  readonly totalCopperSpent: number;
  readonly soldByDish: readonly {
    readonly dishItemId: string;
    readonly quantity: number;
  }[];
  readonly recentSales: readonly GameplayRestaurantSaleSnapshot[];
  readonly nextTransitionUtcMs: number | null;
}

export type GameplayBusinessUpgradeId =
  | "kitchen"
  | "transport"
  | "restaurant"
  | "procurement";
export interface GameplayBusinessUpgradeSnapshot {
  readonly kitchen: number;
  readonly transport: number;
  readonly restaurant: number;
  readonly procurement: number;
  readonly maxLevel: number;
  readonly maxLevels: Readonly<Record<GameplayBusinessUpgradeId, number>>;
  readonly nextCosts: Readonly<Record<GameplayBusinessUpgradeId, number | null>>;
}

export interface TechnologyNodeSnapshot {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly nextCostCopper: number | null;
  readonly prerequisites: readonly { readonly nodeId: string; readonly requiredLevel: number }[];
  readonly prerequisitesMet: boolean;
  readonly effects: Readonly<Record<string, number>>;
}

export interface TechnologySnapshot {
  readonly revision: number;
  readonly nodes: readonly TechnologyNodeSnapshot[];
  readonly effects: Readonly<Record<string, number>>;
}
export interface GameplayProcurementItemSnapshot {
  readonly itemId: string;
  readonly quantity: number;
}
export interface GameplayProcurementRegionSnapshot {
  readonly id: string;
  readonly name: string;
  readonly unlocked: boolean;
  readonly deliveryDurationMs: number;
  readonly freightCostCopper: number;
  readonly cargoCapacity: number;
  readonly minimumTransportLevel: number;
  readonly items: readonly {
    readonly itemId: string;
    readonly unitPriceCopper: number;
  }[];
}
export interface GameplayProcurementOrderSnapshot {
  readonly id: string;
  readonly regionId: string;
  readonly status: "queued" | "in-transit";
  readonly items: readonly GameplayProcurementItemSnapshot[];
  readonly itemCostCopper: number;
  readonly freightCostCopper: number;
  readonly totalCostCopper: number;
  readonly createdAtUtcMs: number;
  readonly departedAtUtcMs: number | null;
  readonly arriveAtUtcMs: number | null;
}
export interface GameplayProcurementSnapshot {
  readonly revision: number;
  readonly arrivalRevision: number;
  readonly nextTransitionUtcMs: number | null;
  readonly regions: readonly GameplayProcurementRegionSnapshot[];
  readonly orders: readonly GameplayProcurementOrderSnapshot[];
  readonly recentArrivals: readonly {
    readonly orderId: string;
    readonly regionId: string;
    readonly items: readonly GameplayProcurementItemSnapshot[];
    readonly arrivedAtUtcMs: number;
  }[];
  readonly incomingItems: readonly GameplayProcurementItemSnapshot[];
  readonly automation: {
    readonly unlocked: boolean;
    readonly enabled?: boolean;
    readonly managerAvailable?: boolean;
    readonly regionId?: string;
    readonly reserveCopper: number;
    readonly policies: readonly {
      readonly itemId: string;
      readonly threshold: number;
      readonly target: number;
      readonly blockingReason?: "MANAGER_LOCKED" | "MANAGER_UNAVAILABLE" | "SOURCE_UNAVAILABLE" | "FUNDS_PROTECTED" | null;
    }[];
  };
}
export interface GameplaySnapshot {
  readonly revision: number;
  readonly currentUtcMs: number;
  readonly nextSupplyAtUtcMs: number;
  readonly supplyBoxesReceived: number;
  readonly inventory: {
    readonly kitchenIngredients: GameplayInventoryContainerSnapshot;
    readonly kitchenOutput: GameplayInventoryContainerSnapshot;
    readonly cableCargo: GameplayInventoryContainerSnapshot;
    readonly restaurantStorage: GameplayInventoryContainerSnapshot;
  };
  readonly cooking: GameplayCookingSnapshot;
  readonly logistics: GameplayLogisticsSnapshot;
  readonly restaurant: GameplayRestaurantSnapshot;
  readonly upgrades: GameplayBusinessUpgradeSnapshot;
  readonly procurement: GameplayProcurementSnapshot;
}

export interface OfflineEarningsSummary {
  readonly elapsedMs: number;
  readonly supplyBoxesReceived: number;
  readonly cookingBatchesCompleted: number;
  readonly deliveredQuantity: number;
  readonly soldQuantity: number;
  readonly customersLeft: number;
  readonly copperEarned: number;
}

export interface NarrativeConditionProgressSnapshot {
  readonly type: "online-dish-sales";
  readonly current: number;
  readonly required: number;
}

export interface NarrativeEventSnapshot {
  readonly eventId: string;
  readonly status: "locked" | "available" | "completed";
  readonly unread: boolean;
  readonly unlockedAtUtcMs: number | null;
  readonly viewedAtUtcMs: number | null;
  readonly completedAtUtcMs: number | null;
  readonly conditions: readonly NarrativeConditionProgressSnapshot[];
}

export interface NarrativeSnapshot {
  readonly revision: number;
  readonly availableEventIds: readonly string[];
  readonly unreadEventIds: readonly string[];
  readonly events: readonly NarrativeEventSnapshot[];
}

export interface AmbientDialogueActiveSnapshot {
  readonly dialogueId: string;
  readonly lineIndex: number;
  readonly startedAtUtcMs: number;
  readonly endsAtUtcMs: number;
}

export interface AmbientDialogueSnapshot {
  readonly revision: number;
  readonly active: AmbientDialogueActiveSnapshot | null;
  readonly lastCompletedDialogueId: string | null;
  readonly lastStartedOpportunityId: string | null;
  readonly nextTransitionUtcMs: number | null;
}

export type StorySequenceStageStatus =
  | "locked"
  | "waiting"
  | "active"
  | "completed";

export interface StorySequenceStageSnapshot {
  readonly stageId: string;
  readonly dialogueId: string;
  readonly status: StorySequenceStageStatus;
  readonly completedAtUtcMs: number | null;
}

export interface StoryOrderSnapshot {
  readonly orderId: string;
  readonly recipeId: string;
  readonly dishItemId: string;
  readonly requestedQuantity: number;
  readonly fulfilledQuantity: number;
  readonly status: "locked" | "active" | "fulfilled";
}

export interface StoryRecipeJournalSnapshot {
  readonly journalId: string;
  readonly phase: "locked" | "discovered" | "completed";
}

export interface StorySequenceSnapshot {
  readonly revision: number;
  readonly sequenceId: string;
  readonly currentStageId: string | null;
  readonly active: AmbientDialogueActiveSnapshot | null;
  readonly stages: readonly StorySequenceStageSnapshot[];
  readonly storyOrder: StoryOrderSnapshot;
  readonly recipeJournal: StoryRecipeJournalSnapshot;
  readonly residentSpeakerIds: readonly string[];
  readonly nextTransitionUtcMs: number | null;
}

export interface GameSnapshot {  readonly revision: number;
  readonly phase: RuntimePhase;
  readonly runtimeStartedAtUtcMs: number;
  readonly settings: RuntimeSettingsSnapshot;
  readonly gameplay: GameplaySnapshot | null;
  readonly restaurantActivity: GameplayRestaurantActivitySnapshot;
  readonly narrative: NarrativeSnapshot | null;
  readonly dialogue: AmbientDialogueSnapshot | null;
  readonly story: StorySequenceSnapshot | null;
  readonly focusSession: FocusSessionReadModel | null;
  readonly technology: TechnologySnapshot | null;
  readonly offlineEarnings: OfflineEarningsSummary | null;
}

export interface SetQuietModeCommand {
  readonly id: string;
  readonly type: "settings.set-quiet-mode";
  readonly payload: {
    readonly enabled: boolean;
  };
}

export interface StartFocusSessionCommand {
  readonly id: string;
  readonly type: "focus-session.start";
  readonly payload: Record<string, never>;
}

export interface CancelFocusSessionCommand {
  readonly id: string;
  readonly type: "focus-session.cancel";
  readonly payload: Record<string, never>;
}

export interface SkipFocusBreakCommand {
  readonly id: string;
  readonly type: "focus-session.skip-break";
  readonly payload: Record<string, never>;
}


/** @deprecated Retained only for replaying frozen R0 command fixtures. */
export interface SelectGameplayRecipeCommand {
  readonly id: string;
  readonly type: "gameplay.select-recipe";
  readonly payload: {
    readonly recipeId: string;
  };
}

/** @deprecated Retained only for replaying frozen R0 command fixtures. */
export interface SetGameplayAutoRepeatCommand {
  readonly id: string;
  readonly type: "gameplay.set-auto-repeat";
  readonly payload: {
    readonly enabled: boolean;
  };
}

export interface UpgradeTechnologyCommand {
  readonly id: string;
  readonly type: "technology.upgrade-node";
  readonly payload: {
    readonly nodeId: string;
  };
}
export interface EnterSceneEditModeCommand {
  readonly id: string;
  readonly type: "scene-edit.enter";
  readonly payload: { readonly sceneId: string };
}

export interface ExitSceneEditModeCommand {
  readonly id: string;
  readonly type: "scene-edit.exit";
  readonly payload: Record<string, never>;
}

export interface PrepareBuildingUpgradeCommand {
  readonly id: string;
  readonly type: "instance-upgrade.prepare-building";
  readonly payload: {
    readonly previewId: string;
    readonly buildingId: string;
  };
}

export interface ConfirmBuildingUpgradeCommand {
  readonly id: string;
  readonly type: "instance-upgrade.confirm-building";
  readonly payload: { readonly previewId: string };
}

export interface CancelBuildingUpgradeCommand {
  readonly id: string;
  readonly type: "instance-upgrade.cancel-building";
  readonly payload: { readonly previewId: string };
}

export interface UpgradeProcurementCartCommand {
  readonly id: string;
  readonly type: "instance-upgrade.procurement-cart";
  readonly payload: { readonly cartId: string };
}

export interface UpgradeProcurementAirshipCommand {
  readonly id: string;
  readonly type: "instance-upgrade.procurement-airship";
  readonly payload: { readonly shipId: string };
}
export interface StartBuildingConstructionPreviewCommand {
  readonly id: string;
  readonly type: "building-construction.start-preview";
  readonly payload: { readonly previewId: string; readonly definitionId: string; readonly styleId: string; readonly x: number; readonly y: number; readonly orientation: string };
}
export interface UpdateBuildingConstructionPreviewCommand {
  readonly id: string;
  readonly type: "building-construction.update-preview";
  readonly payload: { readonly previewId: string; readonly x: number; readonly y: number; readonly orientation: string };
}
export interface ConfirmBuildingConstructionPreviewCommand {
  readonly id: string;
  readonly type: "building-construction.confirm-preview";
  readonly payload: { readonly previewId: string };
}
export interface CancelBuildingConstructionPreviewCommand {
  readonly id: string;
  readonly type: "building-construction.cancel-preview";
  readonly payload: { readonly previewId: string };
}
export interface MoveBuildingCommand {
  readonly id: string;
  readonly type: "building-construction.move-building";
  readonly payload: { readonly buildingId: string; readonly sceneId: string; readonly x: number; readonly y: number; readonly orientation: string };
}
export interface ChangeBuildingStyleCommand {
  readonly id: string;
  readonly type: "building-construction.change-style";
  readonly payload: { readonly buildingId: string; readonly styleId: string };
}
export interface RefreshRecruitmentCommand {
  readonly id: string;
  readonly type: "recruitment.refresh";
  readonly payload: { readonly kind: "free" | "manual" };
}

export interface HireRecruitmentCandidateCommand {
  readonly id: string;
  readonly type: "recruitment.hire";
  readonly payload: {
    readonly candidateId: string;
    readonly shiftStartMinuteInclusive: number;
    readonly shiftEndMinuteExclusive: number;
  };
}

export interface SetEmployeePrimaryJobCommand {
  readonly id: string;
  readonly type: "employment.set-primary-job";
  readonly payload: {
    readonly characterId: string;
    readonly jobId: string;
  };
}

export interface SetEmployeeDailyShiftCommand {
  readonly id: string;
  readonly type: "employment.set-daily-shift";
  readonly payload: {
    readonly characterId: string;
    readonly startMinuteInclusive: number;
    readonly endMinuteExclusive: number;
  };
}

export interface RequestEmployeeDismissalCommand {
  readonly id: string;
  readonly type: "employment.request-dismissal";
  readonly payload: { readonly characterId: string };
}

export interface PlaceGameplayProcurementOrderCommand {  readonly id: string;
  readonly type: "gameplay.place-procurement-order";
  readonly payload: {
    readonly items: readonly GameplayProcurementItemSnapshot[];
  };
}

export interface ConfigureGameplayProcurementAutomationCommand {
  readonly id: string;
  readonly type: "gameplay.configure-procurement-automation";
  readonly payload: {
    readonly enabled?: boolean;
    readonly reserveCopper: number;
    readonly policies: readonly {
      readonly itemId: string;
      readonly threshold: number;
      readonly target: number;
    }[];
  };
}


export interface CreateManualLogisticsDemandCommand {
  readonly id: string;
  readonly type: "logistics.create-manual";
  readonly payload: {
    readonly groupId: string;
    readonly sourceLocationId: string;
    readonly targetLocationId: string;
    readonly itemId: string;
    readonly quantity: number;
  };
}

export interface UpdateManualLogisticsDemandCommand {
  readonly id: string;
  readonly type: "logistics.update-manual";
  readonly payload: { readonly groupId: string; readonly remainingQuantity: number };
}

export interface StopManualLogisticsDemandCommand {
  readonly id: string;
  readonly type: "logistics.stop-manual";
  readonly payload: { readonly groupId: string };
}

export interface MarkNarrativeViewedCommand {
  readonly id: string;
  readonly type: "narrative.mark-viewed";
  readonly payload: {
    readonly eventId: string;
  };
}

export interface CompleteNarrativeEventCommand {
  readonly id: string;
  readonly type: "narrative.complete";
  readonly payload: {
    readonly eventId: string;
  };
}

export interface ReplayStoryDialogueCommand {
  readonly id: string;
  readonly type: "story.replay-dialogue";
  readonly payload: {
    readonly stageId: string;
  };
}

export interface RequestAmbientDialogueCommand {
  readonly id: string;
  readonly type: "dialogue.request-ambient";
  readonly payload: {
    readonly opportunityId: string;
    readonly context: "arrival" | "waiting" | "eating" | "departing" | "idle";
    readonly availableSpeakerCount: number;
  };
}



export type GameCommand =  | SetQuietModeCommand
  | StartFocusSessionCommand
  | CancelFocusSessionCommand
  | SkipFocusBreakCommand
  | SelectGameplayRecipeCommand
  | SetGameplayAutoRepeatCommand
  | UpgradeTechnologyCommand
  | EnterSceneEditModeCommand
  | ExitSceneEditModeCommand
  | PrepareBuildingUpgradeCommand
  | ConfirmBuildingUpgradeCommand
  | CancelBuildingUpgradeCommand
  | UpgradeProcurementCartCommand
  | UpgradeProcurementAirshipCommand
  | StartBuildingConstructionPreviewCommand
  | UpdateBuildingConstructionPreviewCommand
  | ConfirmBuildingConstructionPreviewCommand
  | CancelBuildingConstructionPreviewCommand
  | MoveBuildingCommand
  | ChangeBuildingStyleCommand
  | RefreshRecruitmentCommand
  | HireRecruitmentCandidateCommand
  | SetEmployeePrimaryJobCommand
  | SetEmployeeDailyShiftCommand
  | RequestEmployeeDismissalCommand
  | PlaceGameplayProcurementOrderCommand
  | ConfigureGameplayProcurementAutomationCommand
  | CreateManualLogisticsDemandCommand
  | UpdateManualLogisticsDemandCommand
  | StopManualLogisticsDemandCommand
  | MarkNarrativeViewedCommand
  | CompleteNarrativeEventCommand
  | ReplayStoryDialogueCommand
  | RequestAmbientDialogueCommand;

export type CommandRejectionCode =
  | "INVALID_COMMAND"
  | "DUPLICATE_COMMAND"
  | "RUNTIME_NOT_READY"
  | "GAMEPLAY_REJECTED"
  | "NARRATIVE_REJECTED"
  | "STORY_REJECTED"
  | "DIALOGUE_REJECTED"
  | "TECHNOLOGY_REJECTED"
  | "FOCUS_REJECTED"
  | "INSTANCE_UPGRADE_REJECTED"
  | "RECRUITMENT_REJECTED"
  | "EMPLOYMENT_REJECTED";

export interface AcceptedCommandResult {
  readonly accepted: true;
  readonly commandId: string;
}

export interface RejectedCommandResult {
  readonly accepted: false;
  readonly commandId: string | null;
  readonly code: CommandRejectionCode;
  readonly message: string;
}

export type CommandResult =
  | AcceptedCommandResult
  | RejectedCommandResult;

export type PresentationMode = "normal" | "quiet" | "reduced";

export interface WindowBoundsDto {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayOption {
  readonly id: string;
  readonly label: string;
  readonly bounds: WindowBoundsDto;
  readonly workArea: WindowBoundsDto;
  readonly scaleFactor: number;
  readonly isPrimary: boolean;
}

export interface AppSettingsSnapshot {
  readonly revision: number;
  readonly onboardingCompleted: boolean;
  readonly targetDisplayId: string;
  readonly alwaysOnTop: boolean;
  readonly presentationMode: PresentationMode;
  readonly uiScale: number;
  readonly managementWindowBounds: WindowBoundsDto | null;
  readonly needsDisplayConfirmation: boolean;
}

export interface AppSettingsUpdate {
  readonly onboardingCompleted?: boolean;
  readonly targetDisplayId?: string;
  readonly alwaysOnTop?: boolean;
  readonly presentationMode?: PresentationMode;
  readonly uiScale?: number;
  readonly managementWindowBounds?: WindowBoundsDto | null;
  readonly needsDisplayConfirmation?: boolean;
}

export type AppSettingsListener = (
  snapshot: AppSettingsSnapshot,
) => void;

export interface SettingsReadBridge {
  getSettings(): Promise<AppSettingsSnapshot>;
  onSettingsChanged(listener: AppSettingsListener): () => void;
}

export interface SettingsWriteBridge extends SettingsReadBridge {
  updateSettings(
    update: AppSettingsUpdate,
  ): Promise<AppSettingsSnapshot>;
  listDisplays(): Promise<readonly DisplayOption[]>;
}

export interface DesktopInteractionRequest {
  readonly interactive: boolean;
  readonly reason: string;
}

export interface DesktopCursorPoint {
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
}

export type DesktopCursorListener = (point: DesktopCursorPoint) => void;

export type ManagementSection =
  | "overview"
  | "inventory"
  | "recipes"
  | "procurement"
  | "finance"
  | "instance-upgrades"
  | "technology"
  | "staff"
  | "roster";

export interface ManagementOpenRequest {
  readonly section: ManagementSection;
}

export type ManagementNavigationListener = (
  section: ManagementSection,
) => void;

export interface RuntimeBridge {
  getWorkspaceInfo(): WorkspaceBridgeInfo;
  getReadModel(key: RuntimeReadModelKey): Promise<RuntimeReadModelSlice>;
  dispatchCommand(command: GameCommand): Promise<CommandResult>;
  onReadModelChanged(
    key: RuntimeReadModelKey,
    listener: RuntimeReadModelChangedListener,
  ): () => void;
}

export interface DesktopBridge extends RuntimeBridge, SettingsReadBridge {
  openManagement(request: ManagementOpenRequest): Promise<void>;
  setInteraction(request: DesktopInteractionRequest): Promise<void>;
  onCursorPosition(listener: DesktopCursorListener): () => void;
}


export type SaveLoadSource =
  | "loading"
  | "new"
  | "primary"
  | "backup"
  | "reset-corrupt";
export type SaveMigrationStatus =
  | "pending"
  | "not-needed"
  | "migrated-primary"
  | "recovered-backup"
  | "recovered-backup-and-migrated"
  | "reset-corrupt";

export interface SaveDiagnosticsSnapshot {
  readonly revision: number;
  readonly status: "loading" | "ready" | "saving" | "error";
  readonly loadSource: SaveLoadSource;
  readonly migrationStatus: SaveMigrationStatus;
  readonly loadDiagnostics: readonly string[];
  readonly lastSavedAtUtcMs: number | null;
  readonly lastError: string | null;
  readonly fileName: "save.json";
  readonly backupFileName: "save.json.bak";
}

export type SaveDiagnosticsListener = (
  snapshot: SaveDiagnosticsSnapshot,
) => void;

export interface SaveDiagnosticsBridge {
  getSaveDiagnostics(): Promise<SaveDiagnosticsSnapshot>;
  onSaveDiagnosticsChanged(
    listener: SaveDiagnosticsListener,
  ): () => void;
}

export interface ManagementBridge
  extends RuntimeBridge,
    SettingsWriteBridge,
    SaveDiagnosticsBridge {
  onNavigationRequested(listener: ManagementNavigationListener): () => void;
}

export function isRuntimeReadModelKey(
  value: unknown,
): value is RuntimeReadModelKey {
  return (
    value === "layout" ||
    value === "inventory" ||
    value === "characters" ||
    value === "instance-upgrades" ||
    value === "recruitment" ||
    value === "progression" ||
    value === "desktop-world" ||
    value === "operations" ||
    value === "procurement" ||
    value === "finance"
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isManagementOpenRequest(
  value: unknown,
): value is ManagementOpenRequest {
  if (!isRecord(value)) return false;
  return (
    value.section === "overview" ||
    value.section === "inventory" ||
    value.section === "recipes" ||
    value.section === "procurement" ||
    value.section === "finance" ||
    value.section === "instance-upgrades" ||
    value.section === "technology" ||
    value.section === "staff" ||
    value.section === "roster"
  );
}

function isCommandId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128
  );
}

export function getCommandId(value: unknown): string | null {
  if (!isRecord(value) || !isCommandId(value.id)) {
    return null;
  }

  return value.id;
}

export function isGameCommand(value: unknown): value is GameCommand {
  if (
    !isRecord(value) ||
    !isCommandId(value.id) ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  switch (value.type) {
    case "settings.set-quiet-mode":
    case "gameplay.set-auto-repeat":
      return typeof value.payload.enabled === "boolean";
    case "focus-session.start":
    case "focus-session.cancel":
    case "focus-session.skip-break":
      return Object.keys(value.payload).length === 0;

    case "technology.upgrade-node":
      return typeof value.payload.nodeId === "string" && isCommandId(value.payload.nodeId);
    case "scene-edit.enter":
      return isCommandId(value.payload.sceneId);
    case "scene-edit.exit":
      return Object.keys(value.payload).length === 0;
    case "instance-upgrade.prepare-building":
      return isCommandId(value.payload.previewId) && isCommandId(value.payload.buildingId);
    case "instance-upgrade.confirm-building":
    case "instance-upgrade.cancel-building":
      return isCommandId(value.payload.previewId);
    case "instance-upgrade.procurement-cart":
      return isCommandId(value.payload.cartId);
    case "instance-upgrade.procurement-airship":
      return isCommandId(value.payload.shipId);
    case "building-construction.start-preview":
      return isCommandId(value.payload.previewId) && isCommandId(value.payload.definitionId) && isCommandId(value.payload.styleId) && isCommandId(value.payload.orientation) &&
        typeof value.payload.x === "number" && Number.isFinite(value.payload.x) && typeof value.payload.y === "number" && Number.isFinite(value.payload.y);
    case "building-construction.update-preview":
      return isCommandId(value.payload.previewId) && isCommandId(value.payload.orientation) && typeof value.payload.x === "number" && Number.isFinite(value.payload.x) && typeof value.payload.y === "number" && Number.isFinite(value.payload.y);
    case "building-construction.confirm-preview":
    case "building-construction.cancel-preview":
      return isCommandId(value.payload.previewId);
    case "building-construction.move-building":
      return isCommandId(value.payload.buildingId) && isCommandId(value.payload.sceneId) && isCommandId(value.payload.orientation) &&
        typeof value.payload.x === "number" && Number.isFinite(value.payload.x) && typeof value.payload.y === "number" && Number.isFinite(value.payload.y);
    case "building-construction.change-style":
      return isCommandId(value.payload.buildingId) && isCommandId(value.payload.styleId);
    case "recruitment.refresh":
      return value.payload.kind === "free" || value.payload.kind === "manual";
    case "recruitment.hire":
      return isCommandId(value.payload.candidateId) &&
        typeof value.payload.shiftStartMinuteInclusive === "number" &&
        Number.isSafeInteger(value.payload.shiftStartMinuteInclusive) &&
        value.payload.shiftStartMinuteInclusive >= 0 && value.payload.shiftStartMinuteInclusive < 1_440 &&
        typeof value.payload.shiftEndMinuteExclusive === "number" &&
        Number.isSafeInteger(value.payload.shiftEndMinuteExclusive) &&
        value.payload.shiftEndMinuteExclusive >= 0 && value.payload.shiftEndMinuteExclusive < 1_440 &&
        value.payload.shiftStartMinuteInclusive !== value.payload.shiftEndMinuteExclusive;
    case "employment.set-primary-job":
      return isCommandId(value.payload.characterId) && isCommandId(value.payload.jobId);
    case "employment.set-daily-shift":
      return isCommandId(value.payload.characterId) &&
        typeof value.payload.startMinuteInclusive === "number" &&
        Number.isSafeInteger(value.payload.startMinuteInclusive) &&
        value.payload.startMinuteInclusive >= 0 && value.payload.startMinuteInclusive < 1_440 &&
        typeof value.payload.endMinuteExclusive === "number" &&
        Number.isSafeInteger(value.payload.endMinuteExclusive) &&
        value.payload.endMinuteExclusive >= 0 && value.payload.endMinuteExclusive < 1_440 &&
        value.payload.startMinuteInclusive !== value.payload.endMinuteExclusive;
    case "employment.request-dismissal":
      return isCommandId(value.payload.characterId);
    case "logistics.create-manual":
      return isCommandId(value.payload.groupId) && isCommandId(value.payload.sourceLocationId) &&
        isCommandId(value.payload.targetLocationId) && value.payload.sourceLocationId !== value.payload.targetLocationId &&
        isCommandId(value.payload.itemId) && typeof value.payload.quantity === "number" &&
        Number.isSafeInteger(value.payload.quantity) && value.payload.quantity > 0;
    case "logistics.update-manual":
      return isCommandId(value.payload.groupId) && typeof value.payload.remainingQuantity === "number" &&
        Number.isSafeInteger(value.payload.remainingQuantity) && value.payload.remainingQuantity >= 0;
    case "logistics.stop-manual":
      return isCommandId(value.payload.groupId);
    case "gameplay.place-procurement-order":
      return (
        Array.isArray(value.payload.items) &&
        value.payload.items.length > 0 &&
        value.payload.items.length <= 32 &&
        value.payload.items.every(
          (item) =>
            isRecord(item) &&
            isCommandId(item.itemId) &&
            typeof item.quantity === "number" &&
            Number.isSafeInteger(item.quantity) &&
            item.quantity > 0 &&
            item.quantity <= 999,
        )
      );
    case "gameplay.configure-procurement-automation":
      return (
        (value.payload.enabled === undefined || typeof value.payload.enabled === "boolean") &&
        typeof value.payload.reserveCopper === "number" &&
        Number.isSafeInteger(value.payload.reserveCopper) &&
        value.payload.reserveCopper >= 0 &&
        Array.isArray(value.payload.policies) &&
        value.payload.policies.length <= 32 &&
        value.payload.policies.every(
          (policy) =>
            isRecord(policy) &&
            isCommandId(policy.itemId) &&
            typeof policy.threshold === "number" &&
            Number.isSafeInteger(policy.threshold) &&
            policy.threshold >= 0 &&
            typeof policy.target === "number" &&
            Number.isSafeInteger(policy.target) &&
            policy.target > policy.threshold &&
            policy.target <= 999,
        )
      );
    case "gameplay.select-recipe":
      return (
        typeof value.payload.recipeId === "string" &&
        value.payload.recipeId.length > 0 &&
        value.payload.recipeId.length <= 128
      );
    case "narrative.mark-viewed":
    case "narrative.complete":
      return isCommandId(value.payload.eventId);
    case "story.replay-dialogue":
      return isCommandId(value.payload.stageId);
    case "dialogue.request-ambient":
      return (
        isCommandId(value.payload.opportunityId) &&
        (value.payload.context === "arrival" ||
          value.payload.context === "waiting" ||
          value.payload.context === "eating" ||
          value.payload.context === "departing" ||
          value.payload.context === "idle") &&
        typeof value.payload.availableSpeakerCount === "number" &&
        Number.isSafeInteger(value.payload.availableSpeakerCount) &&
        value.payload.availableSpeakerCount > 0 &&
        value.payload.availableSpeakerCount <= 5
      );
    default:
      return false;
  }
}

export function isDesktopInteractionRequest(
  value: unknown,
): value is DesktopInteractionRequest {
  return (
    isRecord(value) &&
    typeof value.interactive === "boolean" &&
    typeof value.reason === "string" &&
    value.reason.length > 0 &&
    value.reason.length <= 64
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWindowBounds(value: unknown): value is WindowBoundsDto {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

function isPresentationMode(value: unknown): value is PresentationMode {
  return (
    value === "normal" ||
    value === "quiet" ||
    value === "reduced"
  );
}

export function isAppSettingsSnapshot(
  value: unknown,
): value is AppSettingsSnapshot {
  return (
    isRecord(value) &&
    Number.isInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    typeof value.onboardingCompleted === "boolean" &&
    typeof value.targetDisplayId === "string" &&
    value.targetDisplayId.length <= 64 &&
    typeof value.alwaysOnTop === "boolean" &&
    isPresentationMode(value.presentationMode) &&
    isFiniteNumber(value.uiScale) &&
    value.uiScale >= 0.75 &&
    value.uiScale <= 1.5 &&
    (value.managementWindowBounds === null ||
      isWindowBounds(value.managementWindowBounds)) &&
    typeof value.needsDisplayConfirmation === "boolean"
  );
}

export function isAppSettingsUpdate(
  value: unknown,
): value is AppSettingsUpdate {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    "onboardingCompleted",
    "targetDisplayId",
    "alwaysOnTop",
    "presentationMode",
    "uiScale",
    "managementWindowBounds",
    "needsDisplayConfirmation",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return false;
  }

  return (
    (value.onboardingCompleted === undefined ||
      typeof value.onboardingCompleted === "boolean") &&
    (value.targetDisplayId === undefined ||
      (typeof value.targetDisplayId === "string" &&
        value.targetDisplayId.length > 0 &&
        value.targetDisplayId.length <= 64)) &&
    (value.alwaysOnTop === undefined ||
      typeof value.alwaysOnTop === "boolean") &&
    (value.presentationMode === undefined ||
      isPresentationMode(value.presentationMode)) &&
    (value.uiScale === undefined ||
      (isFiniteNumber(value.uiScale) &&
        value.uiScale >= 0.75 &&
        value.uiScale <= 1.5)) &&
    (value.managementWindowBounds === undefined ||
      value.managementWindowBounds === null ||
      isWindowBounds(value.managementWindowBounds)) &&
    (value.needsDisplayConfirmation === undefined ||
      typeof value.needsDisplayConfirmation === "boolean")
  );
}
