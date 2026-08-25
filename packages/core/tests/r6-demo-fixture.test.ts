import { describe, expect, it } from "vitest";
import {
  R6_DEMO_CURRENT_MINUTE,
  R6_DEMO_ECONOMY,
  R6_DEMO_IDS,
  R6_DEMO_RECIPE,
  R6_DEMO_SUPPLY_TARGETS,
  R6_DEMO_TECHNOLOGY_LEVELS,
  createR6DemoFixture,
} from "../src/demo/r6-demo-fixture";

describe("R6 fixed Demo fixture", () => {
  it("creates the agreed characters, facilities, stock, elevators, economy, and zero-tech baseline", () => {
    const fixture = createR6DemoFixture();
    const characters = fixture.characters.createReadModel().characters;
    expect(characters.map(({ name, coreMember }) => ({ name, coreMember }))).toEqual([
      { name: "白夜城", coreMember: true },
      { name: "奥拓", coreMember: true },
      { name: "普通顾客", coreMember: false },
    ]);

    const employees = fixture.employment.createReadModel(R6_DEMO_CURRENT_MINUTE).employees;
    expect(employees).toHaveLength(2);
    expect(employees.find((employee) => employee.characterId === R6_DEMO_IDS.characters.baiyecheng)).toMatchObject({ primaryJobId: "job.chef", learnedJobIds: ["job.chef"], onShift: true });
    expect(employees.find((employee) => employee.characterId === R6_DEMO_IDS.characters.otto)).toMatchObject({ primaryJobId: "job.waiter", learnedJobIds: ["job.waiter", "job.local_procurer"], onShift: true });
    expect(employees.some((employee) => employee.characterId === R6_DEMO_IDS.characters.customer)).toBe(false);

    const buildings = fixture.layout.getSnapshot().buildings;
    expect(buildings).toHaveLength(9);
    expect(buildings.filter((building) => building.sceneId === R6_DEMO_IDS.scenes.ground)).toHaveLength(5);
    expect(buildings.filter((building) => building.sceneId === R6_DEMO_IDS.scenes.airship)).toHaveLength(4);
    expect(buildings.every((building) => building.level === 1 && building.enabled)).toBe(true);

    for (const locationId of [R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.locations.airshipExchange]) {
      expect(fixture.inventory.getStackQuantity(locationId, R6_DEMO_IDS.items.egg)).toBe(0);
      expect(fixture.inventory.getStackQuantity(locationId, R6_DEMO_IDS.items.tomato)).toBe(0);
    }
    expect(fixture.dishware.getSnapshot()).toMatchObject({ totalPlateCount: 4, counts: { clean: 4, in_use: 0, dirty: 0, washing: 0 } });
    expect(fixture.inventory.getLocationSnapshot(R6_DEMO_IDS.locations.prepCache)?.compartments[0]?.capacity).toBeGreaterThanOrEqual(2);

    expect(fixture.supplyTargets).toEqual(R6_DEMO_SUPPLY_TARGETS);
    expect(fixture.technologyLevels).toEqual(R6_DEMO_TECHNOLOGY_LEVELS);
    expect(Object.values(fixture.technologyLevels).every((level) => level === 0)).toBe(true);
    expect(fixture.finance.getSnapshot().availableCopper).toBe(R6_DEMO_ECONOMY.startingCopper);
    expect(R6_DEMO_ECONOMY.startingCopper).toBeGreaterThanOrEqual(R6_DEMO_ECONOMY.fivePortionIngredientCostCopper);

    const elevators = fixture.freightElevators.getSnapshot().elevators;
    expect(elevators).toHaveLength(4);
    expect(elevators.every((elevator) => elevator.phase === "idle" && elevator.dockedStationId === R6_DEMO_IDS.locations.groundExchange && elevator.cargoInstanceId === null)).toBe(true);
    expect(elevators.map((elevator) => elevator.speedUnitsPerSecond)).toEqual([25, 25, 25, 25]);

    const venue = fixture.customerVenues.listVenues()[0];
    expect(venue?.waitingArea.slotIds).toHaveLength(4);
    expect(venue?.tables[0]?.seatIds).toHaveLength(2);
    expect(fixture.logistics.exportState().groups).toEqual([]);
  });

  it("publishes the six-step parallel recipe DAG and creates isolated repeatable state", () => {
    const first = createR6DemoFixture();
    const second = createR6DemoFixture();
    const recipe = first.recipeCatalog.getRecipe(R6_DEMO_IDS.recipe);
    expect(recipe).toEqual(R6_DEMO_RECIPE);
    expect(recipe?.ingredients).toEqual([
      { itemId: R6_DEMO_IDS.items.egg, quantity: 2 },
      { itemId: R6_DEMO_IDS.items.tomato, quantity: 3 },
    ]);
    expect(recipe?.steps.map((step) => [step.id, step.prerequisiteStepIds])).toEqual([
      ["step.process_tomato", []],
      ["step.whisk_egg", []],
      ["step.fry_tomato", ["step.process_tomato"]],
      ["step.fry_egg", ["step.whisk_egg"]],
      ["step.combine", ["step.fry_tomato", "step.fry_egg"]],
      ["step.plate", ["step.combine"]],
    ]);
    expect(recipe?.steps.every((step) => step.attendance === "required")).toBe(true);

    expect(first.inventory.depositStack("test:seed:first", R6_DEMO_IDS.locations.groundExchange, [{ itemId: R6_DEMO_IDS.items.egg, quantity: 1 }], 1)).toMatchObject({ accepted: true });
    expect(first.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.egg)).toBe(1);
    expect(second.inventory.getStackQuantity(R6_DEMO_IDS.locations.groundExchange, R6_DEMO_IDS.items.egg)).toBe(0);
  });
});