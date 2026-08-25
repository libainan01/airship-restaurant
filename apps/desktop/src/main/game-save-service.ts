import type {
  SaveDiagnosticsListener,
  SaveDiagnosticsSnapshot,
} from "@airship-restaurant/contracts";
import {
  legacyGameplayRuntimeStateToSaveSlices,
  isGameplayRuntimeSaveSlices,
  isLegacyGameplayRuntimeState,
  isNarrativeSystemState,
  isStorySequenceState,
  isTechnologyState,
  isSceneLayoutState,
  isBuildingUpgradeState,
  isLocalProcurementState,
  isAutomaticProcurementState,
  isCharacterState,
  isEmploymentState,
  isRecruitmentState,
  isFinanceState,
  isPayrollState,
  isProgressionState,
  isFleetState,
  isStoryRosterState,
  isFocusSessionState,
  readRestaurantOperationalInitialStates,
  RESTAURANT_OPERATIONAL_SAVE_MANIFEST,
  TECHNOLOGY_MODULE_ID,
  TECHNOLOGY_SCHEMA_VERSION,
  SCENE_LAYOUT_MODULE_ID,
  SCENE_LAYOUT_SCHEMA_VERSION,
  BUILDING_UPGRADE_MODULE_ID,
  BUILDING_UPGRADE_SCHEMA_VERSION,
  LOCAL_PROCUREMENT_MODULE_ID,
  LOCAL_PROCUREMENT_SCHEMA_VERSION,
  AUTOMATIC_PROCUREMENT_MODULE_ID,
  AUTOMATIC_PROCUREMENT_SCHEMA_VERSION,
  CHARACTER_MODULE_ID,
  CHARACTER_SCHEMA_VERSION,
  EMPLOYMENT_MODULE_ID,
  EMPLOYMENT_SCHEMA_VERSION,
  RECRUITMENT_MODULE_ID,
  RECRUITMENT_SCHEMA_VERSION,
  FINANCE_MODULE_ID,
  FINANCE_SCHEMA_VERSION,
  PAYROLL_MODULE_ID,
  PAYROLL_SCHEMA_VERSION,
  PROGRESSION_MODULE_ID,
  PROGRESSION_SCHEMA_VERSION,
  FLEET_MODULE_ID,
  FLEET_SCHEMA_VERSION,
  STORY_ROSTER_MODULE_ID,
  STORY_ROSTER_SCHEMA_VERSION,
  FOCUS_SESSION_MODULE_ID,
  FOCUS_SESSION_SCHEMA_VERSION,
  type GameplayRuntimeSaveSlices,
  type LegacyGameplayRuntimeState,
  type NarrativeSystemState,
  type StorySequenceState,
  type TechnologyState,
  type SceneLayoutState,
  type BuildingUpgradeState,
  type LocalProcurementState,
  type AutomaticProcurementState,
  type CharacterState,
  type EmploymentState,
  type RecruitmentState,
  type FinanceState,
  type PayrollState,
  type ProgressionState,
  type FleetState,
  type StoryRosterState,
  type FocusSessionState,
  type RestaurantOperationalInitialStates,
} from "@airship-restaurant/core";
import {
  JsonSaveStore,
  createModularSaveDocument,
  getSaveModule,
  isModularSaveDocument,
  mergeSaveModules,
  type JsonSaveLoadResult,
  type ModularSaveDocument,
  type SaveEnvelope,
  type SaveModuleInput,
} from "@airship-restaurant/persistence";
import path from "node:path";

const GAME_SAVE_FILE_NAME = "save.json";
const GAME_SAVE_SCHEMA_VERSION = 2;
const MODULE_SCHEMA_VERSION = 1;
const LEGACY_SIMULATION_MODULE_ID = "module.simulation";
const GAMEPLAY_RUNTIME_MODULE_ID = "module.gameplay-runtime";
const GAMEPLAY_INVENTORY_MODULE_ID = "module.gameplay-inventory";
const COOKING_MODULE_ID = "module.cooking";
const LOGISTICS_MODULE_ID = "module.logistics";
const RESTAURANT_MODULE_ID = "module.restaurant";
const PROCUREMENT_HISTORY_MODULE_ID = "module.procurement-history";
const GAMEPLAY_REQUIRED_MODULE_IDS = Object.freeze([
  GAMEPLAY_RUNTIME_MODULE_ID,
  GAMEPLAY_INVENTORY_MODULE_ID,
  COOKING_MODULE_ID,
  LOGISTICS_MODULE_ID,
  RESTAURANT_MODULE_ID,
]);
const NARRATIVE_MODULE_ID = "module.narrative";
const STORY_MODULE_ID = "module.story";
const TECHNOLOGY_SAVE_MODULE_ID = TECHNOLOGY_MODULE_ID;
const SCENE_LAYOUT_SAVE_MODULE_ID = SCENE_LAYOUT_MODULE_ID;
const BUILDING_UPGRADE_SAVE_MODULE_ID = BUILDING_UPGRADE_MODULE_ID;
const LOCAL_PROCUREMENT_SAVE_MODULE_ID = LOCAL_PROCUREMENT_MODULE_ID;
const AUTOMATIC_PROCUREMENT_SAVE_MODULE_ID = AUTOMATIC_PROCUREMENT_MODULE_ID;
const CHARACTER_SAVE_MODULE_ID = CHARACTER_MODULE_ID;
const EMPLOYMENT_SAVE_MODULE_ID = EMPLOYMENT_MODULE_ID;
const RECRUITMENT_SAVE_MODULE_ID = RECRUITMENT_MODULE_ID;
const FINANCE_SAVE_MODULE_ID = FINANCE_MODULE_ID;
const PAYROLL_SAVE_MODULE_ID = PAYROLL_MODULE_ID;
const PROGRESSION_SAVE_MODULE_ID = PROGRESSION_MODULE_ID;
const FLEET_SAVE_MODULE_ID = FLEET_MODULE_ID;
const STORY_ROSTER_SAVE_MODULE_ID = STORY_ROSTER_MODULE_ID;
const FOCUS_SESSION_SAVE_MODULE_ID = FOCUS_SESSION_MODULE_ID;
const KNOWN_MODULE_IDS = Object.freeze([
  LEGACY_SIMULATION_MODULE_ID,
  ...GAMEPLAY_REQUIRED_MODULE_IDS,
  PROCUREMENT_HISTORY_MODULE_ID,
  NARRATIVE_MODULE_ID,
  STORY_MODULE_ID,
  TECHNOLOGY_SAVE_MODULE_ID,
  SCENE_LAYOUT_SAVE_MODULE_ID,
  BUILDING_UPGRADE_SAVE_MODULE_ID,
  LOCAL_PROCUREMENT_SAVE_MODULE_ID,
  AUTOMATIC_PROCUREMENT_SAVE_MODULE_ID,
  CHARACTER_SAVE_MODULE_ID,
  EMPLOYMENT_SAVE_MODULE_ID,
  RECRUITMENT_SAVE_MODULE_ID,
  FINANCE_SAVE_MODULE_ID,
  PAYROLL_SAVE_MODULE_ID,
  PROGRESSION_SAVE_MODULE_ID,
  FLEET_SAVE_MODULE_ID,
  STORY_ROSTER_SAVE_MODULE_ID,
  FOCUS_SESSION_SAVE_MODULE_ID,
  ...RESTAURANT_OPERATIONAL_SAVE_MANIFEST.map((entry) => entry.moduleId),
]);

export interface GameSavePayload extends Partial<GameplayRuntimeSaveSlices> {
  readonly narrative?: NarrativeSystemState;
  readonly story?: StorySequenceState;
  readonly technology?: TechnologyState;
  readonly sceneLayout?: SceneLayoutState;
  readonly buildingUpgrade?: BuildingUpgradeState;
  readonly localProcurement?: LocalProcurementState;
  readonly automaticProcurement?: AutomaticProcurementState;
  readonly characters?: CharacterState;
  readonly employment?: EmploymentState;
  readonly recruitment?: RecruitmentState;
  readonly finance?: FinanceState;
  readonly payroll?: PayrollState;
  readonly progression?: ProgressionState;
  readonly fleet?: FleetState;
  readonly storyRoster?: StoryRosterState;
  readonly focusSession?: FocusSessionState;
  readonly restaurantOperational?: RestaurantOperationalInitialStates;
}

function isRestaurantOperationalInitialStates(value: unknown): value is RestaurantOperationalInitialStates {
  if (!isRecordPayload(value)) return false;
  const modules: Record<string, { schemaVersion: number; payload: unknown }> = {};
  for (const entry of RESTAURANT_OPERATIONAL_SAVE_MANIFEST) {
    if (!(entry.key in value)) return false;
    modules[entry.moduleId] = { schemaVersion: entry.schemaVersion, payload: value[entry.key] };
  }
  return readRestaurantOperationalInitialStates(modules).status === "ready";
}

function isGameSavePayload(value: unknown): value is GameSavePayload {
  if (!isRecordPayload(value)) return false;
  const legacyKeys = ["gameplayRuntime", "gameplayInventory", "cooking", "logistics", "restaurant", "procurementHistory"];
  const legacyFieldCount = legacyKeys.filter((key) => key in value).length;
  const legacyGameplayValid = isGameplayRuntimeSaveSlices(value);
  const operationalValid = "restaurantOperational" in value &&
    value.restaurantOperational !== undefined &&
    isRestaurantOperationalInitialStates(value.restaurantOperational);
  if ((legacyFieldCount > 0 && !legacyGameplayValid) || (!legacyGameplayValid && !operationalValid) ||
    (!("narrative" in value) || value.narrative === undefined || isNarrativeSystemState(value.narrative)) === false ||
    (!("story" in value) || value.story === undefined || isStorySequenceState(value.story)) === false ||
    (!("technology" in value) || value.technology === undefined || isTechnologyState(value.technology)) === false ||
    (!("sceneLayout" in value) || value.sceneLayout === undefined || isSceneLayoutState(value.sceneLayout)) === false ||
    (!("buildingUpgrade" in value) || value.buildingUpgrade === undefined || isBuildingUpgradeState(value.buildingUpgrade)) === false ||
    (!("localProcurement" in value) || value.localProcurement === undefined || isLocalProcurementState(value.localProcurement)) === false ||
    (!("automaticProcurement" in value) || value.automaticProcurement === undefined || isAutomaticProcurementState(value.automaticProcurement)) === false ||
    (!("characters" in value) || value.characters === undefined || isCharacterState(value.characters)) === false ||
    (!("employment" in value) || value.employment === undefined || isEmploymentState(value.employment)) === false ||
    (!("recruitment" in value) || value.recruitment === undefined || isRecruitmentState(value.recruitment)) === false ||
    (!("finance" in value) || value.finance === undefined || isFinanceState(value.finance)) === false ||
    (!("payroll" in value) || value.payroll === undefined || isPayrollState(value.payroll)) === false ||
    (!("progression" in value) || value.progression === undefined || isProgressionState(value.progression)) === false ||
    (!("fleet" in value) || value.fleet === undefined || isFleetState(value.fleet)) === false ||
    (!("storyRoster" in value) || value.storyRoster === undefined || isStoryRosterState(value.storyRoster)) === false ||
    (!("focusSession" in value) || value.focusSession === undefined || isFocusSessionState(value.focusSession)) === false ||
    (!("restaurantOperational" in value) || value.restaurantOperational === undefined || operationalValid) === false) {
    return false;
  }
  const payload = value as GameSavePayload;
  const hasCharacters = payload.characters !== undefined;
  const hasEmployment = payload.employment !== undefined;
  const hasFinance = payload.finance !== undefined;
  const hasPayroll = payload.payroll !== undefined;
  return hasCharacters === hasEmployment &&
    (payload.recruitment === undefined || hasCharacters) &&
    hasFinance === hasPayroll &&
    (!hasPayroll || hasCharacters) &&
    (!hasPayroll || payload.finance!.currentGameDay === payload.payroll!.currentGameDay);
}

function isRecordPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectGameplaySaveSlices(
  document: ModularSaveDocument,
): GameplayRuntimeSaveSlices | null {
  const presentNewModuleCount = GAMEPLAY_REQUIRED_MODULE_IDS.filter(
    (moduleId) => document.modules[moduleId] !== undefined,
  ).length;
  if (presentNewModuleCount > 0) {
    if (presentNewModuleCount !== GAMEPLAY_REQUIRED_MODULE_IDS.length) return null;
    const gameplayRuntime = getSaveModule(document, GAMEPLAY_RUNTIME_MODULE_ID, MODULE_SCHEMA_VERSION, isRecordPayload);
    const gameplayInventory = getSaveModule(document, GAMEPLAY_INVENTORY_MODULE_ID, MODULE_SCHEMA_VERSION, isRecordPayload);
    const cooking = getSaveModule(document, COOKING_MODULE_ID, MODULE_SCHEMA_VERSION, isRecordPayload);
    const logistics = getSaveModule(document, LOGISTICS_MODULE_ID, MODULE_SCHEMA_VERSION, isRecordPayload);
    const restaurant = getSaveModule(document, RESTAURANT_MODULE_ID, MODULE_SCHEMA_VERSION, isRecordPayload);
    const procurementHistory = document.modules[PROCUREMENT_HISTORY_MODULE_ID] === undefined
      ? null
      : getSaveModule(document, PROCUREMENT_HISTORY_MODULE_ID, MODULE_SCHEMA_VERSION, isRecordPayload);
    if (gameplayRuntime === null || gameplayInventory === null || cooking === null ||
      logistics === null || restaurant === null ||
      (document.modules[PROCUREMENT_HISTORY_MODULE_ID] !== undefined && procurementHistory === null)) {
      return null;
    }
    const slices = {
      gameplayRuntime: gameplayRuntime.payload,
      gameplayInventory: gameplayInventory.payload,
      cooking: cooking.payload,
      logistics: logistics.payload,
      restaurant: restaurant.payload,
      ...(procurementHistory === null ? {} : { procurementHistory: procurementHistory.payload }),
    };
    return isGameplayRuntimeSaveSlices(slices) ? slices : null;
  }
  const legacy = getSaveModule(
    document,
    LEGACY_SIMULATION_MODULE_ID,
    MODULE_SCHEMA_VERSION,
    isLegacyGameplayRuntimeState,
  );
  return legacy === null ? null : legacyGameplayRuntimeStateToSaveSlices(legacy.payload);
}

function isGameSaveDocument(value: unknown): value is ModularSaveDocument {
  if (!isModularSaveDocument(value)) return false;
  const gameplay = projectGameplaySaveSlices(value);
  const legacyModuleCount = [
    LEGACY_SIMULATION_MODULE_ID,
    ...GAMEPLAY_REQUIRED_MODULE_IDS,
    PROCUREMENT_HISTORY_MODULE_ID,
  ].filter((moduleId) => value.modules[moduleId] !== undefined).length;
  const operational = readRestaurantOperationalInitialStates(value.modules);
  if ((legacyModuleCount > 0 && gameplay === null) ||
    (gameplay === null && operational.status !== "ready")) return false;
  const narrative = value.modules[NARRATIVE_MODULE_ID];
  if (narrative !== undefined && getSaveModule(value, NARRATIVE_MODULE_ID, MODULE_SCHEMA_VERSION, isNarrativeSystemState) === null) return false;
  const story = value.modules[STORY_MODULE_ID];
  if (story !== undefined && getSaveModule(value, STORY_MODULE_ID, MODULE_SCHEMA_VERSION, isStorySequenceState) === null) return false;
  const technology = value.modules[TECHNOLOGY_SAVE_MODULE_ID];
  if (technology !== undefined && getSaveModule(value, TECHNOLOGY_SAVE_MODULE_ID, TECHNOLOGY_SCHEMA_VERSION, isTechnologyState) === null) return false;
  const sceneLayout = value.modules[SCENE_LAYOUT_SAVE_MODULE_ID];
  if (sceneLayout !== undefined && getSaveModule(value, SCENE_LAYOUT_SAVE_MODULE_ID, SCENE_LAYOUT_SCHEMA_VERSION, isSceneLayoutState) === null) return false;
  const buildingUpgrade = value.modules[BUILDING_UPGRADE_SAVE_MODULE_ID];
  if (buildingUpgrade !== undefined && getSaveModule(value, BUILDING_UPGRADE_SAVE_MODULE_ID, BUILDING_UPGRADE_SCHEMA_VERSION, isBuildingUpgradeState) === null) return false;
  const localProcurement = value.modules[LOCAL_PROCUREMENT_SAVE_MODULE_ID];
  if (localProcurement !== undefined && getSaveModule(value, LOCAL_PROCUREMENT_SAVE_MODULE_ID, LOCAL_PROCUREMENT_SCHEMA_VERSION, isLocalProcurementState) === null) return false;
  const automaticProcurement = value.modules[AUTOMATIC_PROCUREMENT_SAVE_MODULE_ID];
  if (automaticProcurement !== undefined && getSaveModule(value, AUTOMATIC_PROCUREMENT_SAVE_MODULE_ID, AUTOMATIC_PROCUREMENT_SCHEMA_VERSION, isAutomaticProcurementState) === null) return false;
  const characters = value.modules[CHARACTER_SAVE_MODULE_ID];
  if (characters !== undefined && getSaveModule(value, CHARACTER_SAVE_MODULE_ID, CHARACTER_SCHEMA_VERSION, isCharacterState) === null) return false;
  const employment = value.modules[EMPLOYMENT_SAVE_MODULE_ID];
  if (employment !== undefined && getSaveModule(value, EMPLOYMENT_SAVE_MODULE_ID, EMPLOYMENT_SCHEMA_VERSION, isEmploymentState) === null) return false;
  const recruitment = value.modules[RECRUITMENT_SAVE_MODULE_ID];
  if (recruitment !== undefined && getSaveModule(value, RECRUITMENT_SAVE_MODULE_ID, RECRUITMENT_SCHEMA_VERSION, isRecruitmentState) === null) return false;
  const finance = value.modules[FINANCE_SAVE_MODULE_ID];
  if (finance !== undefined && getSaveModule(value, FINANCE_SAVE_MODULE_ID, FINANCE_SCHEMA_VERSION, isFinanceState) === null) return false;
  const payroll = value.modules[PAYROLL_SAVE_MODULE_ID];
  if (payroll !== undefined && getSaveModule(value, PAYROLL_SAVE_MODULE_ID, PAYROLL_SCHEMA_VERSION, isPayrollState) === null) return false;
  const progression = value.modules[PROGRESSION_SAVE_MODULE_ID];
  if (progression !== undefined && getSaveModule(value, PROGRESSION_SAVE_MODULE_ID, PROGRESSION_SCHEMA_VERSION, isProgressionState) === null) return false;
  const fleet = value.modules[FLEET_SAVE_MODULE_ID];
  const storyRoster = value.modules[STORY_ROSTER_SAVE_MODULE_ID];
  const focusSession = value.modules[FOCUS_SESSION_SAVE_MODULE_ID];
  if (fleet !== undefined && getSaveModule(value, FLEET_SAVE_MODULE_ID, FLEET_SCHEMA_VERSION, isFleetState) === null) return false;
  if (storyRoster !== undefined && getSaveModule(value, STORY_ROSTER_SAVE_MODULE_ID, STORY_ROSTER_SCHEMA_VERSION, isStoryRosterState) === null) return false;
  if (focusSession !== undefined && getSaveModule(value, FOCUS_SESSION_SAVE_MODULE_ID, FOCUS_SESSION_SCHEMA_VERSION, isFocusSessionState) === null) return false;
  const hasCharacters = characters !== undefined;
  const hasEmployment = employment !== undefined;
  const hasFinance = finance !== undefined;
  const hasPayroll = payroll !== undefined;
  if (hasCharacters !== hasEmployment || (recruitment !== undefined && !hasCharacters) ||
    hasFinance !== hasPayroll || (hasPayroll && !hasCharacters)) return false;
  if (finance !== undefined && payroll !== undefined) {
    const financeState = getSaveModule(value, FINANCE_SAVE_MODULE_ID, FINANCE_SCHEMA_VERSION, isFinanceState)!;
    const payrollState = getSaveModule(value, PAYROLL_SAVE_MODULE_ID, PAYROLL_SCHEMA_VERSION, isPayrollState)!;
    if (financeState.payload.currentGameDay !== payrollState.payload.currentGameDay) return false;
  }
  return true;
}

function splitPayload(payload: GameSavePayload): {
  readonly gameplay: GameplayRuntimeSaveSlices | undefined;
  readonly narrative: NarrativeSystemState | undefined;
  readonly story: StorySequenceState | undefined;
  readonly technology: TechnologyState | undefined;
  readonly sceneLayout: SceneLayoutState | undefined;
  readonly buildingUpgrade: BuildingUpgradeState | undefined;
  readonly localProcurement: LocalProcurementState | undefined;
  readonly automaticProcurement: AutomaticProcurementState | undefined;
  readonly characters: CharacterState | undefined;
  readonly employment: EmploymentState | undefined;
  readonly recruitment: RecruitmentState | undefined;
  readonly finance: FinanceState | undefined;
  readonly payroll: PayrollState | undefined;
  readonly progression: ProgressionState | undefined;
  readonly fleet: FleetState | undefined;
  readonly storyRoster: StoryRosterState | undefined;
  readonly focusSession: FocusSessionState | undefined;
  readonly restaurantOperational: RestaurantOperationalInitialStates | undefined;
} {
  const {
    gameplayRuntime, gameplayInventory, cooking, logistics, restaurant, procurementHistory,
    narrative, story, technology, sceneLayout, buildingUpgrade,
    localProcurement, automaticProcurement, characters, employment,
    recruitment, finance, payroll, progression, fleet, storyRoster,
    focusSession, restaurantOperational,
  } = payload;
  const gameplayCandidate = {
    gameplayRuntime, gameplayInventory, cooking, logistics, restaurant,
    ...(procurementHistory === undefined ? {} : { procurementHistory }),
  };
  const gameplay = isGameplayRuntimeSaveSlices(gameplayCandidate)
    ? gameplayCandidate
    : undefined;
  return {
    gameplay, narrative, story, technology, sceneLayout, buildingUpgrade,
    localProcurement, automaticProcurement, characters, employment,
    recruitment, finance, payroll, progression, fleet, storyRoster,
    focusSession, restaurantOperational,
  };
}
function createGameSaveDocument(
  payload: GameSavePayload,
  previous: ModularSaveDocument | null,
): ModularSaveDocument {
  const split = splitPayload(payload);
  const hasCharacters = split.characters !== undefined;
  const hasEmployment = split.employment !== undefined;
  const hasFinance = split.finance !== undefined;
  const hasPayroll = split.payroll !== undefined;
  if (hasCharacters !== hasEmployment || (split.recruitment !== undefined && !hasCharacters) ||
    hasFinance !== hasPayroll || (hasPayroll && !hasCharacters)) {
    throw new Error("Character and employment save modules must be written together; recruitment and payroll require people, and finance/payroll must be paired.");
  }
  if (split.finance !== undefined && split.payroll !== undefined &&
    split.finance.currentGameDay !== split.payroll.currentGameDay) {
    throw new Error("Finance and payroll save modules must reference the same current game day.");
  }
  const replacements: Record<string, { schemaVersion: number; payload: unknown }> = {};
  if (split.gameplay !== undefined) {
    replacements[GAMEPLAY_RUNTIME_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.gameplay.gameplayRuntime };
    replacements[GAMEPLAY_INVENTORY_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.gameplay.gameplayInventory };
    replacements[COOKING_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.gameplay.cooking };
    replacements[LOGISTICS_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.gameplay.logistics };
    replacements[RESTAURANT_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.gameplay.restaurant };
    if (split.gameplay.procurementHistory !== undefined) {
      replacements[PROCUREMENT_HISTORY_MODULE_ID] = {
        schemaVersion: MODULE_SCHEMA_VERSION,
        payload: split.gameplay.procurementHistory,
      };
    }
  }
  if (split.narrative !== undefined) replacements[NARRATIVE_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.narrative };
  if (split.story !== undefined) replacements[STORY_MODULE_ID] = { schemaVersion: MODULE_SCHEMA_VERSION, payload: split.story };
  if (split.technology !== undefined) replacements[TECHNOLOGY_SAVE_MODULE_ID] = { schemaVersion: TECHNOLOGY_SCHEMA_VERSION, payload: split.technology };
  if (split.sceneLayout !== undefined) replacements[SCENE_LAYOUT_SAVE_MODULE_ID] = { schemaVersion: SCENE_LAYOUT_SCHEMA_VERSION, payload: split.sceneLayout };
  if (split.buildingUpgrade !== undefined) replacements[BUILDING_UPGRADE_SAVE_MODULE_ID] = { schemaVersion: BUILDING_UPGRADE_SCHEMA_VERSION, payload: split.buildingUpgrade };
  if (split.localProcurement !== undefined) replacements[LOCAL_PROCUREMENT_SAVE_MODULE_ID] = { schemaVersion: LOCAL_PROCUREMENT_SCHEMA_VERSION, payload: split.localProcurement };
  if (split.automaticProcurement !== undefined) replacements[AUTOMATIC_PROCUREMENT_SAVE_MODULE_ID] = { schemaVersion: AUTOMATIC_PROCUREMENT_SCHEMA_VERSION, payload: split.automaticProcurement };
  if (split.characters !== undefined) replacements[CHARACTER_SAVE_MODULE_ID] = { schemaVersion: CHARACTER_SCHEMA_VERSION, payload: split.characters };
  if (split.employment !== undefined) replacements[EMPLOYMENT_SAVE_MODULE_ID] = { schemaVersion: EMPLOYMENT_SCHEMA_VERSION, payload: split.employment };
  if (split.recruitment !== undefined) replacements[RECRUITMENT_SAVE_MODULE_ID] = { schemaVersion: RECRUITMENT_SCHEMA_VERSION, payload: split.recruitment };
  if (split.finance !== undefined) replacements[FINANCE_SAVE_MODULE_ID] = { schemaVersion: FINANCE_SCHEMA_VERSION, payload: split.finance };
  if (split.payroll !== undefined) replacements[PAYROLL_SAVE_MODULE_ID] = { schemaVersion: PAYROLL_SCHEMA_VERSION, payload: split.payroll };
  if (split.progression !== undefined) replacements[PROGRESSION_SAVE_MODULE_ID] = { schemaVersion: PROGRESSION_SCHEMA_VERSION, payload: split.progression };
  if (split.fleet !== undefined) replacements[FLEET_SAVE_MODULE_ID] = { schemaVersion: FLEET_SCHEMA_VERSION, payload: split.fleet };
  if (split.storyRoster !== undefined) replacements[STORY_ROSTER_SAVE_MODULE_ID] = { schemaVersion: STORY_ROSTER_SCHEMA_VERSION, payload: split.storyRoster };
  if (split.focusSession !== undefined) replacements[FOCUS_SESSION_SAVE_MODULE_ID] = { schemaVersion: FOCUS_SESSION_SCHEMA_VERSION, payload: split.focusSession };
  if (split.restaurantOperational !== undefined) {
    for (const entry of RESTAURANT_OPERATIONAL_SAVE_MANIFEST) {
      replacements[entry.moduleId] = {
        schemaVersion: entry.schemaVersion,
        payload: split.restaurantOperational[entry.key],
      };
    }
  }
  const removed = KNOWN_MODULE_IDS.filter((moduleId) => !(moduleId in replacements));
  return createModularSaveDocument(
    split.restaurantOperational?.applicationRuntime.revision ??
      split.gameplay?.gameplayRuntime.revision ?? 0,
    mergeSaveModules(previous, replacements as SaveModuleInput, removed),
  );
}

function projectGameSavePayload(document: ModularSaveDocument): GameSavePayload {
  const gameplay = projectGameplaySaveSlices(document);
  const narrative = getSaveModule(document, NARRATIVE_MODULE_ID, MODULE_SCHEMA_VERSION, isNarrativeSystemState);
  const story = getSaveModule(document, STORY_MODULE_ID, MODULE_SCHEMA_VERSION, isStorySequenceState);
  const technology = getSaveModule(document, TECHNOLOGY_SAVE_MODULE_ID, TECHNOLOGY_SCHEMA_VERSION, isTechnologyState);
  const sceneLayout = getSaveModule(document, SCENE_LAYOUT_SAVE_MODULE_ID, SCENE_LAYOUT_SCHEMA_VERSION, isSceneLayoutState);
  const buildingUpgrade = getSaveModule(document, BUILDING_UPGRADE_SAVE_MODULE_ID, BUILDING_UPGRADE_SCHEMA_VERSION, isBuildingUpgradeState);
  const localProcurement = getSaveModule(document, LOCAL_PROCUREMENT_SAVE_MODULE_ID, LOCAL_PROCUREMENT_SCHEMA_VERSION, isLocalProcurementState);
  const automaticProcurement = getSaveModule(document, AUTOMATIC_PROCUREMENT_SAVE_MODULE_ID, AUTOMATIC_PROCUREMENT_SCHEMA_VERSION, isAutomaticProcurementState);
  const characters = getSaveModule(document, CHARACTER_SAVE_MODULE_ID, CHARACTER_SCHEMA_VERSION, isCharacterState);
  const employment = getSaveModule(document, EMPLOYMENT_SAVE_MODULE_ID, EMPLOYMENT_SCHEMA_VERSION, isEmploymentState);
  const recruitment = getSaveModule(document, RECRUITMENT_SAVE_MODULE_ID, RECRUITMENT_SCHEMA_VERSION, isRecruitmentState);
  const finance = getSaveModule(document, FINANCE_SAVE_MODULE_ID, FINANCE_SCHEMA_VERSION, isFinanceState);
  const payroll = getSaveModule(document, PAYROLL_SAVE_MODULE_ID, PAYROLL_SCHEMA_VERSION, isPayrollState);
  const progression = getSaveModule(document, PROGRESSION_SAVE_MODULE_ID, PROGRESSION_SCHEMA_VERSION, isProgressionState);
  const fleet = getSaveModule(document, FLEET_SAVE_MODULE_ID, FLEET_SCHEMA_VERSION, isFleetState);
  const storyRoster = getSaveModule(document, STORY_ROSTER_SAVE_MODULE_ID, STORY_ROSTER_SCHEMA_VERSION, isStoryRosterState);
  const focusSession = getSaveModule(document, FOCUS_SESSION_SAVE_MODULE_ID, FOCUS_SESSION_SCHEMA_VERSION, isFocusSessionState);
  const restaurantOperational = readRestaurantOperationalInitialStates(document.modules);
  return Object.freeze({
    ...(gameplay === null ? {} : gameplay),
    ...(narrative === null ? {} : { narrative: narrative.payload }),
    ...(story === null ? {} : { story: story.payload }),
    ...(technology === null ? {} : { technology: technology.payload }),
    ...(sceneLayout === null ? {} : { sceneLayout: sceneLayout.payload }),
    ...(buildingUpgrade === null ? {} : { buildingUpgrade: buildingUpgrade.payload }),
    ...(localProcurement === null ? {} : { localProcurement: localProcurement.payload }),
    ...(automaticProcurement === null ? {} : { automaticProcurement: automaticProcurement.payload }),
    ...(characters === null ? {} : { characters: characters.payload }),
    ...(employment === null ? {} : { employment: employment.payload }),
    ...(recruitment === null ? {} : { recruitment: recruitment.payload }),
    ...(finance === null ? {} : { finance: finance.payload }),
    ...(payroll === null ? {} : { payroll: payroll.payload }),
    ...(progression === null ? {} : { progression: progression.payload }),
    ...(fleet === null ? {} : { fleet: fleet.payload }),
    ...(storyRoster === null ? {} : { storyRoster: storyRoster.payload }),
    ...(focusSession === null ? {} : { focusSession: focusSession.payload }),
    ...(restaurantOperational.status === "ready" ? { restaurantOperational: restaurantOperational.initialStates } : {}),
  });
}

function migrateLegacyGameSavePayload(value: unknown): GameSavePayload | null {
  if (!isLegacyGameplayRuntimeState(value)) return null;
  const record = value as LegacyGameplayRuntimeState & Record<string, unknown>;
  const {
    version: _version,
    revision: _revision,
    currentUtcMs: _currentUtcMs,
    nextSupplyAtUtcMs: _nextSupplyAtUtcMs,
    supplyBoxesReceived: _supplyBoxesReceived,
    randomState: _randomState,
    kitchenActivated: _kitchenActivated,
    inventory: _inventory,
    cooking: _cooking,
    logistics: _logistics,
    restaurant: _restaurant,
    upgrades: _upgrades,
    procurement: _procurement,
    ...extensions
  } = record;
  const migrated = Object.freeze({
    ...legacyGameplayRuntimeStateToSaveSlices(value),
    ...extensions,
  });
  return isGameSavePayload(migrated) ? migrated : null;
}

function migrateLegacyEnvelope(value: unknown) {
  if (typeof value !== "object" || value === null ||
    !("schemaVersion" in value) || value.schemaVersion !== 1 ||
    !("savedAtUtcMs" in value) || typeof value.savedAtUtcMs !== "number" || !Number.isSafeInteger(value.savedAtUtcMs) || value.savedAtUtcMs < 0 ||
    !("payload" in value)) return null;
  const payload = migrateLegacyGameSavePayload(value.payload);
  if (payload === null) return null;
  return {
    savedAtUtcMs: value.savedAtUtcMs,
    payload: createGameSaveDocument(payload, null),
    diagnostic: "Legacy save schema v1 was migrated to split modular schema v2 in memory.",
  };
}

function projectLoadResult(
  result: JsonSaveLoadResult<ModularSaveDocument>,
): JsonSaveLoadResult<GameSavePayload> {
  if (result.envelope === null) return result;
  const envelope: SaveEnvelope<GameSavePayload> = Object.freeze({
    schemaVersion: result.envelope.schemaVersion,
    savedAtUtcMs: result.envelope.savedAtUtcMs,
    payload: projectGameSavePayload(result.envelope.payload),
    ...(result.envelope.checksumAlgorithm === undefined ? {} : {
      checksumAlgorithm: result.envelope.checksumAlgorithm,
      checksum: result.envelope.checksum,
    }),
  });
  const restaurantOperational = readRestaurantOperationalInitialStates(result.envelope.payload.modules);
  const diagnostics = restaurantOperational.status === "invalid"
    ? Object.freeze([
      ...result.diagnostics,
      ...restaurantOperational.diagnostics,
      "Restaurant operational state was skipped; a safe operational world must be initialized.",
    ])
    : result.diagnostics;
  return Object.freeze({ ...result, diagnostics, envelope });
}

function getSafeSaveError(error: unknown): string {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
  switch (code) {
    case "ENOSPC": return "磁盘空间不足，暂时无法写入本地存档。";
    case "EACCES":
    case "EPERM": return "本地存档文件暂时不可写。";
    case null: return "本地存档写入失败。";
    default: return `本地存档写入失败（${code}）。`;
  }
}

export class GameSaveService {
  readonly #nowUtcMs: () => number;
  readonly #listeners = new Set<SaveDiagnosticsListener>();
  readonly #store: JsonSaveStore<ModularSaveDocument>;
  #loadedDocument: ModularSaveDocument | null = null;
  #pendingSaveCount = 0;
  #diagnostics: SaveDiagnosticsSnapshot = Object.freeze({
    revision: 0,
    status: "loading",
    loadSource: "loading",
    migrationStatus: "pending",
    loadDiagnostics: Object.freeze([]),
    lastSavedAtUtcMs: null,
    lastError: null,
    fileName: "save.json",
    backupFileName: "save.json.bak",
  });

  constructor(userDataPath: string, nowUtcMs: () => number = Date.now) {
    this.#nowUtcMs = nowUtcMs;
    this.#store = new JsonSaveStore({
      filePath: path.join(userDataPath, GAME_SAVE_FILE_NAME),
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      validatePayload: isGameSaveDocument,
      migrateEnvelope: migrateLegacyEnvelope,
      nowUtcMs,
    });
  }

  async load(): Promise<JsonSaveLoadResult<GameSavePayload>> {
    const stored = await this.#store.load();
    this.#loadedDocument = stored.envelope?.payload ?? null;
    const result = projectLoadResult(stored);
    const migrated = result.diagnostics.some((message) =>
      message.toLowerCase().includes("migrated"),
    );
    const migrationStatus = result.status === "corrupt"
      ? "reset-corrupt" as const
      : result.status === "recovered-backup"
        ? migrated
          ? "recovered-backup-and-migrated" as const
          : "recovered-backup" as const
        : migrated
          ? "migrated-primary" as const
          : "not-needed" as const;
    this.#setDiagnostics({
      status: "ready",
      loadSource: result.status === "loaded" ? "primary" : result.status === "recovered-backup" ? "backup" : result.status === "corrupt" ? "reset-corrupt" : "new",
      migrationStatus,
      loadDiagnostics: Object.freeze([...result.diagnostics]),
      lastSavedAtUtcMs: result.envelope?.savedAtUtcMs ?? null,
      lastError: result.status === "corrupt" ? "主存档与备份均未通过校验，已建立新进度。" : null,
    });
    return result;
  }

  getDiagnostics(): SaveDiagnosticsSnapshot { return Object.freeze({ ...this.#diagnostics }); }

  subscribe(listener: SaveDiagnosticsListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  requestSave(state: GameSavePayload): void {
    const document = createGameSaveDocument(state, this.#loadedDocument);
    this.#beginSave();
    void this.#store.save(document).then(() => {
      this.#loadedDocument = document;
      this.#finishSave(null);
    }).catch((error: unknown) => {
      this.#finishSave(error);
      console.error("[GameSaveService] Background save failed", error);
    });
  }

  async saveAndFlush(state: GameSavePayload): Promise<void> {
    const document = createGameSaveDocument(state, this.#loadedDocument);
    this.#beginSave();
    try {
      await this.#store.save(document);
      await this.#store.flush();
      this.#loadedDocument = document;
      this.#finishSave(null);
    } catch (error: unknown) {
      this.#finishSave(error);
      throw error;
    }
  }

  #beginSave(): void {
    this.#pendingSaveCount += 1;
    this.#setDiagnostics({ status: "saving", lastError: null });
  }

  #finishSave(error: unknown): void {
    this.#pendingSaveCount = Math.max(0, this.#pendingSaveCount - 1);
    if (error === null) {
      this.#setDiagnostics({
        status: this.#pendingSaveCount > 0 ? "saving" : "ready",
        lastSavedAtUtcMs: this.#nowUtcMs(),
        lastError: null,
      });
      return;
    }
    this.#setDiagnostics({ status: "error", lastError: getSafeSaveError(error) });
  }

  #setDiagnostics(update: Partial<Pick<SaveDiagnosticsSnapshot, "status" | "loadSource" | "migrationStatus" | "loadDiagnostics" | "lastSavedAtUtcMs" | "lastError">>): void {
    const next = Object.freeze({ ...this.#diagnostics, ...update, revision: this.#diagnostics.revision + 1 });
    this.#diagnostics = next;
    for (const listener of this.#listeners) listener(this.getDiagnostics());
  }
}