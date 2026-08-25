import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, "packages", "content", "data");
const outputPath = path.join(root, "packages", "content", "src", "generated", "content-data.ts");
const sources = Object.freeze({
  gameplay: "gameplay/catalog.json",
  items: "items/catalog.json",
  characters: "characters/catalog.json",
  buildings: "buildings/catalog.json",
  technology: "technology/catalog.json",
  progression: "progression/catalog.json",
  routes: "routes/catalog.json",
  stories: "stories/catalog.json",
  dialogues: "dialogues/chapters/m3-greyfeather.json",
  dialogueCatalog: "dialogues/catalog.json",
});
const stableIdPattern = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(dataRoot, relativePath), "utf8"));
}

function requireCondition(condition, message, issues) {
  if (!condition) issues.push(message);
}

function registerIds(values, prefix, label, ids, issues) {
  for (const value of values) {
    requireCondition(typeof value.id === "string" && stableIdPattern.test(value.id) && value.id.startsWith(`${prefix}.`), `${label} has invalid stable id "${value.id}".`, issues);
    requireCondition(!ids.has(value.id), `Duplicate content id "${value.id}".`, issues);
    ids.add(value.id);
  }
}

function validateDag(recipe, issues) {
  const stepIds = new Set(recipe.productionSteps.map((step) => step.id));
  requireCondition(stepIds.size === recipe.productionSteps.length && stepIds.size > 0, `Recipe "${recipe.id}" needs unique production steps.`, issues);
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(recipe.productionSteps.map((step) => [step.id, step]));
  function visit(id) {
    if (visiting.has(id)) { issues.push(`Recipe "${recipe.id}" production graph contains a cycle at "${id}".`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id)?.prerequisiteStepIds ?? []) {
      requireCondition(stepIds.has(prerequisite), `Recipe "${recipe.id}" step "${id}" references unknown prerequisite "${prerequisite}".`, issues);
      if (stepIds.has(prerequisite)) visit(prerequisite);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of stepIds) visit(id);
  const detail = recipe.detailedRecipe;
  requireCondition(detail && Number.isSafeInteger(detail.servings) && detail.servings > 0, `Recipe "${recipe.id}" needs detailed servings.`, issues);
  requireCondition(Array.isArray(detail?.ingredients) && detail.ingredients.length > 0, `Recipe "${recipe.id}" needs a real ingredient list.`, issues);
  requireCondition(Array.isArray(detail?.steps) && detail.steps.length > 0, `Recipe "${recipe.id}" needs real cooking steps.`, issues);
  detail?.steps.forEach((step, index) => requireCondition(step.order === index + 1 && typeof step.instruction === "string" && step.instruction.trim().length > 0, `Recipe "${recipe.id}" detailed step ${index + 1} is invalid.`, issues));
}

function validateTechnologyDag(nodes, issues) {
  const ids = new Set(nodes.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const effectOwners = new Map();
  for (const node of nodes) {
    requireCondition(typeof node.name === "string" && node.name.trim().length > 0, `Technology "${node.id}" needs a name.`, issues);
    requireCondition(Array.isArray(node.levels) && node.levels.length > 0, `Technology "${node.id}" needs at least one level.`, issues);
    requireCondition(Array.isArray(node.prerequisites), `Technology "${node.id}" prerequisites must be an array.`, issues);
    const baseEffectKeys = Object.keys(node.baseEffects ?? {}).sort();
    requireCondition(baseEffectKeys.length > 0, `Technology "${node.id}" needs at least one base effect.`, issues);
    for (const [effectKey, value] of Object.entries(node.baseEffects ?? {})) {
      requireCondition(effectKey.trim().length > 0 && Number.isFinite(value), `Technology "${node.id}" has invalid base effect "${effectKey}".`, issues);
      requireCondition(!effectOwners.has(effectKey), `Technology effect "${effectKey}" has multiple owners.`, issues);
      effectOwners.set(effectKey, node.id);
    }
    (node.levels ?? []).forEach((level, index) => {
      requireCondition(level.level === index + 1 && Number.isSafeInteger(level.costCopper) && level.costCopper > 0, `Technology "${node.id}" has invalid level ${index + 1}.`, issues);
      const levelEffectKeys = Object.keys(level.effects ?? {}).sort();
      requireCondition(levelEffectKeys.join("|") === baseEffectKeys.join("|") && Object.values(level.effects ?? {}).every(Number.isFinite), `Technology "${node.id}" level ${index + 1} has incomplete effects.`, issues);
    });
  }
  for (const node of nodes) {
    const seen = new Set();
    for (const prerequisite of node.prerequisites ?? []) {
      const target = byId.get(prerequisite.nodeId);
      requireCondition(!seen.has(prerequisite.nodeId), `Technology "${node.id}" repeats prerequisite "${prerequisite.nodeId}".`, issues);
      seen.add(prerequisite.nodeId);
      requireCondition(target !== undefined && prerequisite.nodeId !== node.id && Number.isSafeInteger(prerequisite.requiredLevel) && prerequisite.requiredLevel > 0 && prerequisite.requiredLevel <= (target?.levels?.length ?? 0), `Technology "${node.id}" has invalid prerequisite "${prerequisite.nodeId}" level ${prerequisite.requiredLevel}.`, issues);
    }
  }
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { issues.push(`Technology graph contains a cycle at "${id}".`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) if (ids.has(prerequisite.nodeId)) visit(prerequisite.nodeId);
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
}

async function loadAndValidate() {
  const data = {};
  for (const [key, source] of Object.entries(sources)) data[key] = await readJson(source);
  const issues = [];
  for (const [key, value] of Object.entries(data)) requireCondition(value.schemaVersion === 1, `${key} catalog schemaVersion must be 1.`, issues);
  const allIds = new Set();
  registerIds(data.items.ingredients, "ingredient", "Ingredient", allIds, issues);
  registerIds(data.gameplay.recipes, "recipe", "Recipe", allIds, issues);
  registerIds(data.gameplay.supplyBundles, "supply", "Supply bundle", allIds, issues);
  registerIds(data.characters.characters, "character", "Character", allIds, issues);
  registerIds(data.characters.talents, "talent", "Talent", allIds, issues);
  registerIds(data.characters.customers, "customer", "Customer", allIds, issues);
  registerIds(data.buildings.buildings, "building", "Building", allIds, issues);
  registerIds(data.technology.nodes, "technology", "Technology", allIds, issues);
  registerIds(data.routes.procurementRegions, "region", "Region", allIds, issues);
  registerIds(data.routes.localSuppliers, "supplier", "Local supplier", allIds, issues);
  registerIds(data.routes.localProcurementCarts, "cart", "Local procurement cart", allIds, issues);
  registerIds(data.routes.remoteProcurementRoutes, "route", "Remote procurement route", allIds, issues);
  registerIds(data.routes.procurementAirships, "airship", "Procurement airship", allIds, issues);
  registerIds(data.stories.storyEvents, "story", "Story event", allIds, issues);
  registerIds(data.stories.recipeJournals, "journal", "Recipe journal", allIds, issues);
  registerIds(data.stories.sequences, "sequence", "Story sequence", allIds, issues);
  registerIds(data.stories.storyRosterNodes, "story_node", "Story roster node", allIds, issues);
  const ingredientIds = new Set(data.items.ingredients.map((item) => item.id));
  const recipeIds = new Set(data.gameplay.recipes.map((item) => item.id));
  const characterIds = new Set(data.characters.characters.map((item) => item.id));
  const speakerIds = new Set(data.dialogueCatalog.speakers.map((item) => item.id));
  const dialogueIds = new Set([...(data.dialogues.ambientDialogues ?? []), ...(data.dialogues.storyDialogues ?? [])].map((item) => item.id));
  const journalIds = new Set(data.stories.recipeJournals.map((item) => item.id));
  const storyIds = new Set(data.stories.storyEvents.map((item) => item.id));
  for (const recipe of data.gameplay.recipes) {
    for (const item of recipe.ingredients) requireCondition(ingredientIds.has(item.itemId), `Recipe "${recipe.id}" references unknown ingredient "${item.itemId}".`, issues);
    validateDag(recipe, issues);
  }
  for (const bundle of data.gameplay.supplyBundles) for (const item of bundle.items) requireCondition(ingredientIds.has(item.itemId), `Supply "${bundle.id}" references unknown ingredient "${item.itemId}".`, issues);
  for (const customer of data.characters.customers) requireCondition(characterIds.has(customer.characterId), `Customer "${customer.id}" references unknown character "${customer.characterId}".`, issues);
  const talentIds = new Set(data.characters.talents.map((talent) => talent.id));
  const skillKeys = ["cooking", "charm", "movement", "repair", "piloting"];
  for (const character of data.characters.characters) {
    requireCondition(character.talentIds.length <= 3 && new Set(character.talentIds).size === character.talentIds.length, `Character "${character.id}" must reference at most three unique talents.`, issues);
    character.talentIds.forEach((id) => requireCondition(talentIds.has(id), `Character "${character.id}" references unknown talent "${id}".`, issues));
    skillKeys.forEach((key) => requireCondition(Number.isSafeInteger(character.baseSkills[key]) && character.baseSkills[key] >= 0, `Character "${character.id}" skill "${key}" must be a non-negative integer.`, issues));
  }
  for (const talent of data.characters.talents) {
    requireCondition(talent.exclusiveCharacterId === null || characterIds.has(talent.exclusiveCharacterId), `Talent "${talent.id}" has an unknown exclusive character.`, issues);
    requireCondition(Number.isSafeInteger(talent.qualityTier) && talent.qualityTier >= 1 && talent.qualityTier <= 3, `Talent "${talent.id}" must have quality tier 1..3.`, issues);
    if (talent.exclusiveCharacterId !== null) requireCondition(data.characters.characters.find((character) => character.id === talent.exclusiveCharacterId)?.talentIds.includes(talent.id) === true, `Exclusive talent "${talent.id}" must belong to its character.`, issues);
  }
  const recruitment = data.characters.recruitment;
  const recruitmentTemplate = data.characters.characters.find((character) => character.id === recruitment.templateCharacterId);
  requireCondition(recruitmentTemplate !== undefined, `Recruitment references unknown template "${recruitment.templateCharacterId}".`, issues);
  requireCondition(recruitmentTemplate?.talentIds.length === 0, "Recruitment template must not define fixed talents.", issues);
  requireCondition(!data.characters.customers.some((customer) => customer.characterId === recruitment.templateCharacterId), "Recruitment template cannot be a customer or story character.", issues);
  requireCondition(recruitment.candidateNames.length > 0 && new Set(recruitment.candidateNames).size === recruitment.candidateNames.length && recruitment.candidateNames.every((name) => typeof name === "string" && name.trim().length > 0), "Recruitment candidate names must be non-empty and unique.", issues);
  requireCondition(Number.isSafeInteger(recruitment.candidateCount) && recruitment.candidateCount > 0 && recruitment.candidateCount <= recruitment.candidateNames.length, "Recruitment candidate count is invalid.", issues);
  for (const key of ["freeRefreshIntervalMs", "manualRefreshBaseCostCopper", "manualRefreshCostStepCopper", "hireBaseCostCopper"]) requireCondition(Number.isSafeInteger(recruitment[key]) && recruitment[key] > 0, `Recruitment value "${key}" must be a positive integer.`, issues);
  const knownJobs = new Set(["job.chef", "job.waiter", "job.local_procurer", "job.repairer", "job.captain"]);
  for (const option of recruitment.jobOptions) {
    requireCondition(option.learnedJobIds.length > 0 && new Set(option.learnedJobIds).size === option.learnedJobIds.length && option.learnedJobIds.every((id) => knownJobs.has(id)), "Recruitment job option contains invalid jobs.", issues);
    requireCondition(option.learnedJobIds.includes(option.primaryJobId), "Recruitment primary job must be learned.", issues);
  }
  recruitment.qualityTiers.forEach((tier, index) => {
    requireCondition(tier.tier === index && tier.minimumSkill >= 1 && tier.maximumSkill >= tier.minimumSkill && tier.maximumSkill <= 100, `Recruitment quality tier ${index} has invalid skill bounds.`, issues);
    requireCondition(Number.isSafeInteger(tier.maximumTalentQuality) && tier.maximumTalentQuality >= 1 && tier.maximumTalentQuality <= 3, `Recruitment quality tier ${index} has invalid talent quality.`, issues);
    requireCondition(tier.talentCountWeights.length === 4 && tier.talentCountWeights.every((weight) => Number.isSafeInteger(weight) && weight >= 0) && tier.talentCountWeights.reduce((sum, weight) => sum + weight, 0) === 100, `Recruitment quality tier ${index} talent weights must contain four non-negative percentages totaling 100.`, issues);
  });
  requireCondition(recruitment.qualityTiers.length === 4, "Recruitment must define technology quality tiers 0..3.", issues);
  requireCondition(data.characters.talents.some((talent) => talent.exclusiveCharacterId === null), "Recruitment needs at least one general talent.", issues);
  const buildingCapabilityKeys = new Set();
  for (const building of data.buildings.buildings) {
    requireCondition(Number.isSafeInteger(building.footprint.width) && building.footprint.width > 0 && Number.isSafeInteger(building.footprint.height) && building.footprint.height > 0, `Building "${building.id}" footprint must be positive integers.`, issues);
    requireCondition(Number.isSafeInteger(building.buildCostCopper) && building.buildCostCopper > 0, `Building "${building.id}" needs a positive build cost.`, issues);
    requireCondition(Array.isArray(building.styleIds) && building.styleIds.length > 0 && new Set(building.styleIds).size === building.styleIds.length && building.styleIds.includes(building.defaultStyleId), `Building "${building.id}" has invalid styles.`, issues);
    requireCondition(["necessary", "movable", "storable", "removable"].every((key) => typeof building[key] === "boolean"), `Building "${building.id}" has invalid lifecycle flags.`, issues);
    const slotIds = new Set(building.componentSlots.map((slot) => slot.slotId));
    requireCondition(slotIds.size === building.componentSlots.length, `Building "${building.id}" component slot ids must be unique.`, issues);
    for (const slot of building.componentSlots) {
      requireCondition(/^slot\.[a-z][a-z0-9_]*$/.test(slot.slotId), `Building "${building.id}" has invalid component slot "${slot.slotId}".`, issues);
      requireCondition(building.capabilityIds.includes(slot.capabilityId), `Building "${building.id}" slot "${slot.slotId}" references an undeclared capability.`, issues);
    }
    requireCondition(Array.isArray(building.levels) && building.levels.length > 0, `Building "${building.id}" needs at least one level.`, issues);
    const capabilityKeys = Object.keys(building.levels?.[0]?.capabilityValues ?? {}).sort();
    capabilityKeys.forEach((key) => buildingCapabilityKeys.add(key));
    (building.levels ?? []).forEach((level, index) => {
      requireCondition(level.level === index + 1 && Number.isSafeInteger(level.upgradeCostCopper) && (index === 0 ? level.upgradeCostCopper === 0 : level.upgradeCostCopper > 0), `Building "${building.id}" has invalid level ${index + 1} cost.`, issues);
      requireCondition(Number.isSafeInteger(level.maxDurability) && level.maxDurability > 0 && Number.isSafeInteger(level.footprint.width) && level.footprint.width > 0 && Number.isSafeInteger(level.footprint.height) && level.footprint.height > 0, `Building "${building.id}" has invalid physical values at level ${index + 1}.`, issues);
      requireCondition(Object.keys(level.capabilityValues ?? {}).sort().join("|") === capabilityKeys.join("|") && Object.values(level.capabilityValues ?? {}).every((value) => Number.isFinite(value) && value >= 0), `Building "${building.id}" level ${index + 1} has incomplete capability values.`, issues);
    });
    requireCondition(building.levels?.[0]?.footprint.width === building.footprint.width && building.levels?.[0]?.footprint.height === building.footprint.height, `Building "${building.id}" base footprint must match level 1.`, issues);
  }
  validateTechnologyDag(data.technology.nodes, issues);
  for (const node of data.technology.nodes) for (const effectKey of Object.keys(node.baseEffects)) {
    requireCondition(!buildingCapabilityKeys.has(effectKey), `Global technology effect "${effectKey}" duplicates a building instance capability.`, issues);
  }
  const progressionKinds = new Set(["region", "route", "recipe", "building", "building-style"]);
  const progressionIds = new Set();
  for (const content of data.progression.contents) {
    requireCondition(typeof content.id === "string" && stableIdPattern.test(content.id) && progressionKinds.has(content.kind) && content.id.startsWith(`${content.kind === "building-style" ? "style" : content.kind}.`), `Progression content has invalid id or kind "${content.id}".`, issues);
    requireCondition(!progressionIds.has(content.id), `Progression repeats content "${content.id}".`, issues);
    progressionIds.add(content.id);
    requireCondition(typeof content.name === "string" && content.name.trim().length > 0 && typeof content.spoilerSensitive === "boolean", `Progression content "${content.id}" has invalid presentation.`, issues);
    requireCondition(typeof content.initiallyRevealed === "boolean" && typeof content.initiallyUnlocked === "boolean" && (!content.initiallyUnlocked || content.initiallyRevealed), `Progression content "${content.id}" has invalid initial state.`, issues);
    requireCondition(Array.isArray(content.revealSources) && Array.isArray(content.unlockSources), `Progression content "${content.id}" needs source arrays.`, issues);
    const sourceIds = new Set();
    for (const source of [...(content.revealSources ?? []), ...(content.unlockSources ?? [])]) {
      requireCondition(typeof source.id === "string" && stableIdPattern.test(source.id) && !sourceIds.has(source.id) && Array.isArray(source.requirements) && source.requirements.length > 0, `Progression content "${content.id}" has invalid source "${source.id}".`, issues);
      sourceIds.add(source.id);
      for (const requirement of source.requirements ?? []) {
        if (requirement.kind === "fact") {
          requireCondition(typeof requirement.factId === "string" && stableIdPattern.test(requirement.factId) && (requirement.minimumValue === undefined || (Number.isFinite(requirement.minimumValue) && requirement.minimumValue >= 0)), `Progression source "${source.id}" has invalid fact.`, issues);
        } else {
          requireCondition(requirement.kind === "content-unlocked" && typeof requirement.contentId === "string" && stableIdPattern.test(requirement.contentId) && requirement.contentId !== content.id, `Progression source "${source.id}" has invalid content prerequisite.`, issues);
        }
      }
    }
    if (content.kind === "region" || content.kind === "recipe" || content.kind === "building") requireCondition(allIds.has(content.id), `Progression references unknown ${content.kind} "${content.id}".`, issues);
  }
  for (const content of data.progression.contents) for (const source of [...content.revealSources, ...content.unlockSources]) for (const requirement of source.requirements) {
    if (requirement.kind === "content-unlocked") requireCondition(progressionIds.has(requirement.contentId), `Progression "${content.id}" references unknown prerequisite "${requirement.contentId}".`, issues);
  }
  const progressionById = new Map(data.progression.contents.map((content) => [content.id, content]));
  const progressionVisiting = new Set(); const progressionVisited = new Set();
  function visitProgression(id) {
    if (progressionVisiting.has(id)) { issues.push(`Progression graph contains a cycle at "${id}".`); return; }
    if (progressionVisited.has(id)) return;
    progressionVisiting.add(id);
    const content = progressionById.get(id);
    for (const source of [...(content?.revealSources ?? []), ...(content?.unlockSources ?? [])]) for (const requirement of source.requirements ?? []) {
      if (requirement.kind === "content-unlocked" && progressionById.has(requirement.contentId)) visitProgression(requirement.contentId);
    }
    progressionVisiting.delete(id); progressionVisited.add(id);
  }
  for (const id of progressionIds) visitProgression(id);
  for (const region of data.routes.procurementRegions) for (const item of region.items) requireCondition(ingredientIds.has(item.itemId), `Region "${region.id}" references unknown ingredient "${item.itemId}".`, issues);
  const regionIds = new Set(data.routes.procurementRegions.map((region) => region.id));
  for (const supplier of data.routes.localSuppliers) {
    requireCondition(regionIds.has(supplier.sourceRegionId), `Local supplier "${supplier.id}" references unknown region "${supplier.sourceRegionId}".`, issues);
    for (const item of supplier.items) requireCondition(ingredientIds.has(item.itemId), `Local supplier "${supplier.id}" references unknown ingredient "${item.itemId}".`, issues);
  }
  for (const cart of data.routes.localProcurementCarts) {
    requireCondition(cart.levels.length > 0, `Local procurement cart "${cart.id}" must define at least one level.`, issues);
    cart.levels.forEach((level, index) => requireCondition(level.level === index + 1, `Local procurement cart "${cart.id}" levels must be contiguous from 1.`, issues));
    const firstLevel = cart.levels[0];
    requireCondition(firstLevel?.upgradeCostCopper === 0 && firstLevel?.capacity === cart.capacity && firstLevel?.speedUnitsPerSecond === cart.speedUnitsPerSecond, `Local procurement cart "${cart.id}" level 1 must match its base capability and cost 0.`, issues);
  }  const remoteRouteIds = new Set(data.routes.remoteProcurementRoutes.map((route) => route.id));
  for (const route of data.routes.remoteProcurementRoutes) {
    requireCondition(regionIds.has(route.originRegionId) && regionIds.has(route.destinationRegionId) && route.originRegionId !== route.destinationRegionId, `Remote route "${route.id}" has invalid endpoints.`, issues);
    requireCondition(Number.isFinite(route.roundTripDistanceUnits) && route.roundTripDistanceUnits > 0, `Remote route "${route.id}" needs a positive round-trip distance.`, issues);
    requireCondition(progressionIds.has(route.id), `Remote route "${route.id}" needs a progression entry.`, issues);
  }
  const airshipDefinitionIds = new Set(data.routes.procurementAirships.map((airship) => airship.id));
  for (const airship of data.routes.procurementAirships) {
    requireCondition(typeof airship.name === "string" && airship.name.trim().length > 0 && Number.isSafeInteger(airship.purchaseCostCopper) && airship.purchaseCostCopper >= 0, `Procurement airship "${airship.id}" has invalid presentation or purchase cost.`, issues);
    requireCondition(Array.isArray(airship.styleIds) && airship.styleIds.length > 0 && new Set(airship.styleIds).size === airship.styleIds.length && airship.styleIds.includes(airship.defaultStyleId), `Procurement airship "${airship.id}" has invalid styles.`, issues);
    requireCondition(Array.isArray(airship.levels) && airship.levels.length > 0, `Procurement airship "${airship.id}" needs at least one level.`, issues);
    airship.levels.forEach((level, index) => requireCondition(level.level === index + 1 && Number.isSafeInteger(level.upgradeCostCopper) && (index === 0 ? level.upgradeCostCopper === 0 : level.upgradeCostCopper > 0) && Number.isSafeInteger(level.cargoCapacity) && level.cargoCapacity > 0 && Number.isFinite(level.speedUnitsPerSecond) && level.speedUnitsPerSecond > 0 && Number.isSafeInteger(level.maxDurability) && level.maxDurability > 0 && Number.isFinite(level.cooldownEfficiency) && level.cooldownEfficiency > 0, `Procurement airship "${airship.id}" has invalid level ${index + 1}.`, issues));
  }
  const initialAirshipIds = new Set();
  for (const ship of data.routes.initialProcurementAirships) {
    const definition = data.routes.procurementAirships.find((airship) => airship.id === ship.definitionId);
    requireCondition(typeof ship.id === "string" && stableIdPattern.test(ship.id) && !initialAirshipIds.has(ship.id), `Initial procurement airship has invalid or duplicate id "${ship.id}".`, issues);
    initialAirshipIds.add(ship.id);
    requireCondition(airshipDefinitionIds.has(ship.definitionId) && Number.isSafeInteger(ship.level) && ship.level > 0 && ship.level <= (definition?.levels.length ?? 0) && definition?.styleIds.includes(ship.styleId) === true, `Initial procurement airship "${ship.id}" has an invalid definition snapshot.`, issues);
  }
  requireCondition(remoteRouteIds.size > 0 && airshipDefinitionIds.size > 0 && initialAirshipIds.size > 0, "Remote procurement content needs routes, airship definitions, and an initial ship.", issues);
  const storyProfileCharacterIds = new Set();
  for (const profile of data.stories.storyCharacters) {
    requireCondition(characterIds.has(profile.characterId) && !storyProfileCharacterIds.has(profile.characterId), `Story profile references unknown or duplicate character "${profile.characterId}".`, issues);
    storyProfileCharacterIds.add(profile.characterId);
    requireCondition(typeof data.stories.localizations[profile.identityLocalizationKey] === "string", `Story profile "${profile.characterId}" has unknown identity localization.`, issues);
    requireCondition(Array.isArray(profile.relationshipTiers) && profile.relationshipTiers.length > 0, `Story profile "${profile.characterId}" needs relationship tiers.`, issues);
    const relationshipIds = new Set();
    (profile.relationshipTiers ?? []).forEach((tier, index) => {
      requireCondition(typeof tier.id === "string" && tier.id.startsWith("relationship.") && stableIdPattern.test(tier.id) && !relationshipIds.has(tier.id) && Number.isSafeInteger(tier.minimumAffinity) && tier.minimumAffinity >= 0 && (index === 0 ? tier.minimumAffinity === 0 : tier.minimumAffinity > profile.relationshipTiers[index - 1].minimumAffinity), `Story profile "${profile.characterId}" has invalid relationship tier "${tier.id}".`, issues);
      relationshipIds.add(tier.id);
    });
  }
  requireCondition(Array.isArray(data.stories.mealAffinityQualityTiers) && data.stories.mealAffinityQualityTiers.length > 0, "Story roster needs meal affinity quality tiers.", issues);
  const qualityTierIds = new Set();
  data.stories.mealAffinityQualityTiers.forEach((tier, index) => {
    requireCondition(Number.isSafeInteger(tier.qualityTier) && tier.qualityTier > 0 && !qualityTierIds.has(tier.qualityTier) && Number.isFinite(tier.minimumQuality) && tier.minimumQuality >= 0 && Number.isSafeInteger(tier.affinityIncrease) && tier.affinityIncrease > 0 && (index === 0 || tier.minimumQuality > data.stories.mealAffinityQualityTiers[index - 1].minimumQuality), `Meal affinity quality tier "${tier.qualityTier}" is invalid.`, issues);
    qualityTierIds.add(tier.qualityTier);
  });
  const storyStageIds = new Set(data.stories.sequences.flatMap((sequence) => sequence.stages.map((stage) => stage.id)));
  const storyNodeById = new Map(data.stories.storyRosterNodes.map((node) => [node.id, node]));
  const storySequencesByCharacter = new Map();
  for (const node of data.stories.storyRosterNodes) {
    requireCondition(storyProfileCharacterIds.has(node.characterId) && Number.isSafeInteger(node.sequence) && node.sequence > 0, `Story roster node "${node.id}" has invalid character or sequence.`, issues);
    requireCondition(typeof data.stories.localizations[node.hintLocalizationKey] === "string" && typeof data.stories.localizations[node.summaryLocalizationKey] === "string", `Story roster node "${node.id}" has unknown localization.`, issues);
    requireCondition(node.availableWhen?.type === "story-stage-completed" && storyStageIds.has(node.availableWhen.stageId) && node.completeWhen?.type === "story-stage-completed" && storyStageIds.has(node.completeWhen.stageId), `Story roster node "${node.id}" has invalid stage conditions.`, issues);
    const sequences = storySequencesByCharacter.get(node.characterId) ?? new Set();
    requireCondition(!sequences.has(node.sequence), `Story character "${node.characterId}" repeats node sequence ${node.sequence}.`, issues);
    sequences.add(node.sequence); storySequencesByCharacter.set(node.characterId, sequences);
    requireCondition(new Set(node.prerequisiteNodeIds).size === node.prerequisiteNodeIds.length && new Set(node.rewardContentIds).size === node.rewardContentIds.length, `Story roster node "${node.id}" repeats prerequisites or rewards.`, issues);
    node.rewardContentIds.forEach((id) => requireCondition(progressionIds.has(id), `Story roster node "${node.id}" references unknown progression reward "${id}".`, issues));
  }
  for (const node of data.stories.storyRosterNodes) for (const prerequisiteId of node.prerequisiteNodeIds) {
    const prerequisite = storyNodeById.get(prerequisiteId);
    requireCondition(prerequisite !== undefined && prerequisite.characterId === node.characterId && prerequisite.sequence < node.sequence, `Story roster node "${node.id}" has invalid prerequisite "${prerequisiteId}".`, issues);
  }
  for (const event of data.stories.storyEvents) {
    requireCondition(event.recipeId === null || recipeIds.has(event.recipeId), `Story "${event.id}" references unknown recipe "${event.recipeId}".`, issues);
    event.characterIds.forEach((id) => requireCondition(characterIds.has(id), `Story "${event.id}" references unknown character "${id}".`, issues));
    requireCondition(!event.dialogueId || dialogueIds.has(event.dialogueId), `Story "${event.id}" references unknown dialogue "${event.dialogueId}".`, issues);
  }
  for (const journal of data.stories.recipeJournals) {
    requireCondition(recipeIds.has(journal.recipeId), `Journal "${journal.id}" references unknown recipe "${journal.recipeId}".`, issues);
    requireCondition(characterIds.has(journal.sourceCharacterId), `Journal "${journal.id}" references unknown character "${journal.sourceCharacterId}".`, issues);
    journal.storyEventIds.forEach((id) => requireCondition(storyIds.has(id), `Journal "${journal.id}" references unknown story "${id}".`, issues));
  }
  const primarySequences = data.stories.sequences.filter((sequence) => sequence.isPrimary === true);
  requireCondition(data.stories.sequences.length === 0 || primarySequences.length === 1, "Story content must define exactly one primary sequence.", issues);
  const storyDialogueIds = new Set((data.dialogues.storyDialogues ?? []).map((dialogue) => dialogue.id));
  for (const sequence of data.stories.sequences) {
    const stageIds = new Set(sequence.stages.map((stage) => stage.id));
    requireCondition(typeof sequence.isPrimary === "boolean", `Sequence "${sequence.id}" must declare whether it is primary.`, issues);
    requireCondition(sequence.stages.length > 0 && stageIds.size === sequence.stages.length, `Sequence "${sequence.id}" needs unique stages.`, issues);
    for (const stage of sequence.stages) {
      requireCondition(storyDialogueIds.has(stage.dialogueId), `Stage "${stage.id}" must reference a story dialogue.`, issues);
      requireCondition(stage.minimumDelayMs === undefined || (Number.isSafeInteger(stage.minimumDelayMs) && stage.minimumDelayMs >= 0), `Stage "${stage.id}" has an invalid minimum delay.`, issues);
      const trigger = stage.trigger ?? {};
      const triggerValid = trigger.type === "session-start" || trigger.type === "after-previous" || trigger.type === "story-order-fulfilled" ||
        (trigger.type === "online-sales" && Number.isSafeInteger(trigger.quantity) && trigger.quantity > 0) ||
        (trigger.type === "recipe-selected" && recipeIds.has(trigger.recipeId));
      requireCondition(triggerValid, `Stage "${stage.id}" has an invalid trigger.`, issues);
    }
    const orderRecipe = data.gameplay.recipes.find((recipe) => recipe.id === sequence.storyOrder.recipeId);
    requireCondition(orderRecipe !== undefined && orderRecipe.outputItemId === sequence.storyOrder.dishItemId && Number.isSafeInteger(sequence.storyOrder.quantity) && sequence.storyOrder.quantity > 0, `Sequence "${sequence.id}" has an invalid story order.`, issues);
    requireCondition(stageIds.has(sequence.storyOrder.activatesAfterStageId), `Sequence "${sequence.id}" has an unknown order activation stage.`, issues);
    requireCondition(journalIds.has(sequence.journalId), `Sequence "${sequence.id}" references unknown journal.`, issues);
    requireCondition(storyIds.has(sequence.narrativeEventId), `Sequence "${sequence.id}" references unknown narrative event.`, issues);
    sequence.residentSpeakerIds.forEach((id) => requireCondition(speakerIds.has(id), `Sequence "${sequence.id}" references unknown speaker "${id}".`, issues));
    for (const key of ["journalDiscoveredAfterStageId", "journalCompletedAfterStageId", "narrativeEventAfterStageId", "residentsArriveAtStageId", "residentsDepartAfterStageId"]) requireCondition(stageIds.has(sequence[key]), `Sequence "${sequence.id}" has unknown stage reference "${sequence[key]}".`, issues);
  }
  if (issues.length > 0) throw new Error(`Content validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  return data;
}

function generatedSource(data) {
  const banner = "// Generated by scripts/content-tool.mjs. Do not edit manually.\n";
  const exportValue = (name, value) => `export const ${name} = ${JSON.stringify(value, null, 2)} as const;\n`;
  return banner + exportValue("ITEM_CONTENT", data.items) + exportValue("GAMEPLAY_CONTENT", data.gameplay) + exportValue("CHARACTER_CONTENT", data.characters) + exportValue("BUILDING_CONTENT", data.buildings) + exportValue("TECHNOLOGY_CONTENT", data.technology) + exportValue("PROGRESSION_CONTENT", data.progression) + exportValue("ROUTE_CONTENT", data.routes) + exportValue("STORY_CONTENT", data.stories);
}

async function main() {
  const mode = process.argv[2] ?? "check";
  const data = await loadAndValidate();
  const expected = generatedSource(data);
  if (mode === "validate") { console.log("Content catalogs are valid."); return; }
  if (mode === "generate") { await fs.mkdir(path.dirname(outputPath), { recursive: true }); await fs.writeFile(outputPath, expected, "utf8"); console.log(`Generated ${path.relative(root, outputPath)}.`); return; }
  if (mode === "check") {
    let actual = null; try { actual = await fs.readFile(outputPath, "utf8"); } catch {}
    if (actual !== expected) throw new Error("Generated content is stale. Run npm run content:generate.");
    console.log("Content catalogs and generated source are up to date."); return;
  }
  throw new Error(`Unknown content tool mode "${mode}".`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
