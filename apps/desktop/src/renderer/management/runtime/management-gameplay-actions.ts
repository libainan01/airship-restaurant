import type {
  ConfigureGameplayProcurementAutomationCommand,
  GameCommand,
  GameplayProcurementItemSnapshot,
} from "@airship-restaurant/contracts";

type ProcurementPolicy =
  ConfigureGameplayProcurementAutomationCommand["payload"]["policies"][number];

export type ManagementCommandDispatcher = (
  command: GameCommand,
) => Promise<boolean>;

export interface ManagementGameplayActions {
  startFocusSession(): Promise<boolean>;
  cancelFocusSession(): Promise<boolean>;
  skipFocusBreak(): Promise<boolean>;

  upgradeTechnology(nodeId: string): Promise<boolean>;
  enterSceneEditMode(sceneId: string): Promise<boolean>;
  exitSceneEditMode(): Promise<boolean>;
  startBuildingConstruction(definitionId: string, styleId: string, x: number, y: number, orientation: string): Promise<boolean>;
  updateBuildingConstruction(previewId: string, x: number, y: number, orientation: string): Promise<boolean>;
  confirmBuildingConstruction(previewId: string): Promise<boolean>;
  cancelBuildingConstruction(previewId: string): Promise<boolean>;
  moveBuilding(buildingId: string, sceneId: string, x: number, y: number, orientation: string): Promise<boolean>;
  changeBuildingStyle(buildingId: string, styleId: string): Promise<boolean>;
  prepareBuildingUpgrade(buildingId: string, previewId: string): Promise<boolean>;
  confirmBuildingUpgrade(previewId: string): Promise<boolean>;
  cancelBuildingUpgrade(previewId: string): Promise<boolean>;
  upgradeProcurementCart(cartId: string): Promise<boolean>;
  upgradeProcurementAirship(shipId: string): Promise<boolean>;
  refreshRecruitment(kind: "free" | "manual"): Promise<boolean>;
  hireRecruitmentCandidate(
    candidateId: string,
    shiftStartMinuteInclusive: number,
    shiftEndMinuteExclusive: number,
  ): Promise<boolean>;
  setEmployeePrimaryJob(characterId: string, jobId: string): Promise<boolean>;
  setEmployeeDailyShift(
    characterId: string,
    startMinuteInclusive: number,
    endMinuteExclusive: number,
  ): Promise<boolean>;
  requestEmployeeDismissal(characterId: string): Promise<boolean>;
  createManualLogisticsDemand(sourceLocationId: string, targetLocationId: string, itemId: string, quantity: number): Promise<boolean>;
  updateManualLogisticsDemand(groupId: string, remainingQuantity: number): Promise<boolean>;
  stopManualLogisticsDemand(groupId: string): Promise<boolean>;
  placeProcurementOrder(
    items: readonly GameplayProcurementItemSnapshot[],
  ): Promise<boolean>;
  configureProcurementAutomation(
    reserveCopper: number,
    policies: readonly ProcurementPolicy[],
  ): Promise<boolean>;
  configureProcurementAutomation(
    enabled: boolean,
    reserveCopper: number,
    policies: readonly ProcurementPolicy[],
  ): Promise<boolean>;
  replayStoryDialogue(stageId: string): Promise<boolean>;
  markNarrativeViewed(eventId: string): Promise<boolean>;
  completeNarrativeEvent(eventId: string): Promise<boolean>;
}

function defaultCommandId(prefix: string): string {
  return prefix + "-" + crypto.randomUUID();
}

export function createManagementGameplayActions(
  dispatch: ManagementCommandDispatcher,
  createCommandId: (prefix: string) => string = defaultCommandId,
): ManagementGameplayActions {
  return {
    startFocusSession: () => dispatch({
      id: createCommandId("focus-start"),
      type: "focus-session.start",
      payload: {},
    }),
    cancelFocusSession: () => dispatch({
      id: createCommandId("focus-cancel"),
      type: "focus-session.cancel",
      payload: {},
    }),
    skipFocusBreak: () => dispatch({
      id: createCommandId("focus-skip-break"),
      type: "focus-session.skip-break",
      payload: {},
    }),

    upgradeTechnology: (nodeId) => dispatch({
      id: createCommandId("technology-upgrade"),
      type: "technology.upgrade-node",
      payload: { nodeId },
    }),
    enterSceneEditMode: (sceneId) => dispatch({
      id: createCommandId("scene-edit-enter"),
      type: "scene-edit.enter",
      payload: { sceneId },
    }),
    exitSceneEditMode: () => dispatch({
      id: createCommandId("scene-edit-exit"),
      type: "scene-edit.exit",
      payload: {},
    }),
    startBuildingConstruction: (definitionId, styleId, x, y, orientation) => dispatch({
      id: createCommandId("building-construction-start"),
      type: "building-construction.start-preview",
      payload: { previewId: `construction-preview-${crypto.randomUUID()}`, definitionId, styleId, x, y, orientation },
    }),
    updateBuildingConstruction: (previewId, x, y, orientation) => dispatch({
      id: createCommandId("building-construction-update"),
      type: "building-construction.update-preview",
      payload: { previewId, x, y, orientation },
    }),
    confirmBuildingConstruction: (previewId) => dispatch({
      id: createCommandId("building-construction-confirm"),
      type: "building-construction.confirm-preview",
      payload: { previewId },
    }),
    cancelBuildingConstruction: (previewId) => dispatch({
      id: createCommandId("building-construction-cancel"),
      type: "building-construction.cancel-preview",
      payload: { previewId },
    }),
    moveBuilding: (buildingId, sceneId, x, y, orientation) => dispatch({
      id: createCommandId("building-move"),
      type: "building-construction.move-building",
      payload: { buildingId, sceneId, x, y, orientation },
    }),
    changeBuildingStyle: (buildingId, styleId) => dispatch({
      id: createCommandId("building-style"),
      type: "building-construction.change-style",
      payload: { buildingId, styleId },
    }),    prepareBuildingUpgrade: (buildingId, previewId) => dispatch({
      id: createCommandId("building-upgrade-preview"),
      type: "instance-upgrade.prepare-building",
      payload: { buildingId, previewId },
    }),
    confirmBuildingUpgrade: (previewId) => dispatch({
      id: createCommandId("building-upgrade-confirm"),
      type: "instance-upgrade.confirm-building",
      payload: { previewId },
    }),
    cancelBuildingUpgrade: (previewId) => dispatch({
      id: createCommandId("building-upgrade-cancel"),
      type: "instance-upgrade.cancel-building",
      payload: { previewId },
    }),
    upgradeProcurementCart: (cartId) => dispatch({
      id: createCommandId("procurement-cart-upgrade"),
      type: "instance-upgrade.procurement-cart",
      payload: { cartId },
    }),
    upgradeProcurementAirship: (shipId) => dispatch({
      id: createCommandId("procurement-airship-upgrade"),
      type: "instance-upgrade.procurement-airship",
      payload: { shipId },
    }),
    refreshRecruitment: (kind) => dispatch({
      id: createCommandId("recruitment-refresh"),
      type: "recruitment.refresh",
      payload: { kind },
    }),
    hireRecruitmentCandidate: (
      candidateId,
      shiftStartMinuteInclusive,
      shiftEndMinuteExclusive,
    ) => dispatch({
      id: createCommandId("recruitment-hire"),
      type: "recruitment.hire",
      payload: {
        candidateId,
        shiftStartMinuteInclusive,
        shiftEndMinuteExclusive,
      },
    }),
    setEmployeePrimaryJob: (characterId, jobId) => dispatch({
      id: createCommandId("employment-primary-job"),
      type: "employment.set-primary-job",
      payload: { characterId, jobId },
    }),
    setEmployeeDailyShift: (
      characterId,
      startMinuteInclusive,
      endMinuteExclusive,
    ) => dispatch({
      id: createCommandId("employment-daily-shift"),
      type: "employment.set-daily-shift",
      payload: { characterId, startMinuteInclusive, endMinuteExclusive },
    }),
    requestEmployeeDismissal: (characterId) => dispatch({
      id: createCommandId("employment-dismissal"),
      type: "employment.request-dismissal",
      payload: { characterId },
    }),
    createManualLogisticsDemand: (sourceLocationId, targetLocationId, itemId, quantity) => dispatch({
      id: createCommandId("logistics-create"),
      type: "logistics.create-manual",
      payload: { groupId: `demand.manual.${crypto.randomUUID()}`, sourceLocationId, targetLocationId, itemId, quantity },
    }),
    updateManualLogisticsDemand: (groupId, remainingQuantity) => dispatch({
      id: createCommandId("logistics-update"),
      type: "logistics.update-manual",
      payload: { groupId, remainingQuantity },
    }),
    stopManualLogisticsDemand: (groupId) => dispatch({
      id: createCommandId("logistics-stop"),
      type: "logistics.stop-manual",
      payload: { groupId },
    }),
    placeProcurementOrder: (items) => dispatch({
      id: createCommandId("procurement"),
      type: "gameplay.place-procurement-order",
      payload: { items },
    }),
    configureProcurementAutomation: ((
      enabledOrReserve: boolean | number,
      reserveOrPolicies: number | readonly ProcurementPolicy[],
      explicitPolicies?: readonly ProcurementPolicy[],
    ) => {
      const legacy = typeof enabledOrReserve === "number";
      const reserveCopper = legacy ? enabledOrReserve : reserveOrPolicies as number;
      const policies = legacy ? reserveOrPolicies as readonly ProcurementPolicy[] : explicitPolicies ?? [];
      return dispatch({
        id: createCommandId("procurement-auto"),
        type: "gameplay.configure-procurement-automation",
        payload: { ...(legacy ? {} : { enabled: enabledOrReserve }), reserveCopper, policies },
      });
    }) as ManagementGameplayActions["configureProcurementAutomation"],
    replayStoryDialogue: (stageId) => dispatch({
      id: createCommandId("replay-story"),
      type: "story.replay-dialogue",
      payload: { stageId },
    }),
    markNarrativeViewed: (eventId) => dispatch({
      id: createCommandId("view-story"),
      type: "narrative.mark-viewed",
      payload: { eventId },
    }),
    completeNarrativeEvent: (eventId) => dispatch({
      id: createCommandId("complete-story"),
      type: "narrative.complete",
      payload: { eventId },
    }),
  };
}
