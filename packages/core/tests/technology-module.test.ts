import { describe, expect, it } from "vitest";
import {
  DomainEventBus,
  FinanceModule,
  TechnologyModule,
  type TechnologyNodeDefinition,
} from "../src";

const DEFINITIONS = Object.freeze([
  {
    id: "technology.cargo_lift_speed", name: "货梯传动效率", prerequisites: [],
    baseEffects: { "freight-elevator.travel-duration-multiplier": 1 },
    levels: [
      { level: 1, costCopper: 20, effects: { "freight-elevator.travel-duration-multiplier": 0.9 } },
      { level: 2, costCopper: 40, effects: { "freight-elevator.travel-duration-multiplier": 0.8 } },
      { level: 3, costCopper: 80, effects: { "freight-elevator.travel-duration-multiplier": 0.7 } },
    ],
  },
  {
    id: "technology.cargo_lift_count", name: "并行货梯槽位",
    prerequisites: [{ nodeId: "technology.cargo_lift_speed", requiredLevel: 1 }],
    baseEffects: { "freight-elevator.available-count": 4 },
    levels: [
      { level: 1, costCopper: 50, effects: { "freight-elevator.available-count": 5 } },
      { level: 2, costCopper: 100, effects: { "freight-elevator.available-count": 6 } },
    ],
  },
  {
    id: "technology.organization_management", name: "组织管理", prerequisites: [],
    baseEffects: { "employment.employee-limit": 3 },
    levels: [{ level: 1, costCopper: 30, effects: { "employment.employee-limit": 4 } }],
  },
  {
    id: "technology.tray_improvement", name: "托盘改良", prerequisites: [],
    baseEffects: { "tray.capacity": 1 },
    levels: [{ level: 1, costCopper: 25, effects: { "tray.capacity": 2 } }],
  },
  {
    id: "technology.recruitment_center", name: "招募网络",
    prerequisites: [{ nodeId: "technology.organization_management", requiredLevel: 1 }],
    baseEffects: { "recruitment.quality-tier": 0 },
    levels: [{ level: 1, costCopper: 60, effects: { "recruitment.quality-tier": 1 } }],
  },
] as const satisfies readonly TechnologyNodeDefinition[]);

function create(initialState?: ConstructorParameters<typeof TechnologyModule>[0]["initialState"]) {
  const eventBus = new DomainEventBus();
  const finance = new FinanceModule(300);
  const technology = new TechnologyModule({ definitions: DEFINITIONS, finance, eventBus, ...(initialState === undefined ? {} : { initialState }) });
  return { eventBus, finance, technology };
}

describe("TechnologyModule", () => {
  it("exposes five global level-zero effects and gates prerequisite nodes", () => {
    const { technology } = create();
    expect(technology.createReadModel()).toMatchObject({
      revision: 0,
      nodes: [
        { id: "technology.cargo_lift_speed", level: 0, maxLevel: 3, nextCostCopper: 20, prerequisitesMet: true },
        { id: "technology.cargo_lift_count", level: 0, maxLevel: 2, nextCostCopper: 50, prerequisitesMet: false },
        { id: "technology.organization_management", level: 0 },
        { id: "technology.tray_improvement", level: 0 },
        { id: "technology.recruitment_center", level: 0, prerequisitesMet: false },
      ],
      effects: {
        "freight-elevator.travel-duration-multiplier": 1,
        "freight-elevator.available-count": 4,
        "employment.employee-limit": 3,
        "tray.capacity": 1,
        "recruitment.quality-tier": 0,
      },
    });
    expect(technology.upgrade("technology:count:blocked", "technology.cargo_lift_count", 1)).toMatchObject({ accepted: false, code: "PREREQUISITE_NOT_MET" });
  });

  it("pays once, updates effects, and broadcasts finance before the level event", () => {
    const { eventBus, finance, technology } = create();
    const eventTypes: string[] = [];
    eventBus.subscribe("*", (event) => eventTypes.push(event.type));

    expect(technology.upgrade("technology:speed:1", "technology.cargo_lift_speed", 10)).toMatchObject({
      accepted: true,
      value: { level: 1, nextCostCopper: 40, effects: { "freight-elevator.travel-duration-multiplier": 0.9 } },
    });
    expect(finance.getSnapshot()).toMatchObject({ balanceCopper: 280, availableCopper: 280 });
    expect(finance.getSnapshot().ledger).toMatchObject([{ amountCopper: -20, category: "technology-upgrade", sourceId: "technology.cargo_lift_speed" }]);
    expect(eventTypes).toEqual(["finance.ledger-entry-posted", "finance.balance-changed", "technology.level-changed"]);
    expect(technology.upgrade("technology:count:1", "technology.cargo_lift_count", 11)).toMatchObject({ accepted: true, value: { level: 1 } });
    expect(technology.getEffect("freight-elevator.available-count")).toBe(5);
    expect(finance.getSnapshot().balanceCopper).toBe(230);

    const beforeDuplicate = { state: technology.exportState(), finance: finance.exportState() };
    expect(technology.upgrade("technology:count:1", "technology.cargo_lift_count", 12)).toMatchObject({ accepted: false, code: "DUPLICATE_OPERATION" });
    expect(technology.exportState()).toEqual(beforeDuplicate.state);
    expect(finance.exportState()).toEqual(beforeDuplicate.finance);
  });

  it("rejects insufficient funds and restores levels and operation history", () => {
    const eventBus = new DomainEventBus();
    const poorFinance = new FinanceModule(10);
    const poor = new TechnologyModule({ definitions: DEFINITIONS, finance: poorFinance, eventBus });
    expect(poor.upgrade("technology:too-expensive", "technology.cargo_lift_speed", 20)).toMatchObject({ accepted: false, code: "INSUFFICIENT_FUNDS" });
    expect(poor.getLevel("technology.cargo_lift_speed")).toBe(0);
    expect(poorFinance.getSnapshot().balanceCopper).toBe(10);

    const original = create();
    expect(original.technology.upgrade("technology:organization:1", "technology.organization_management", 30)).toMatchObject({ accepted: true });
    const restored = create(original.technology.exportState()).technology;
    expect(restored.createReadModel()).toEqual(original.technology.createReadModel());
    expect(restored.upgrade("technology:organization:1", "technology.organization_management", 31)).toMatchObject({ accepted: false, code: "DUPLICATE_OPERATION" });
  });

  it("rejects cyclic prerequisites and duplicate effect ownership", () => {
    const finance = new FinanceModule(100);
    const eventBus = new DomainEventBus();
    expect(() => new TechnologyModule({
      finance, eventBus,
      definitions: [
        { id: "technology.a", name: "A", prerequisites: [{ nodeId: "technology.b", requiredLevel: 1 }], baseEffects: { "effect.shared": 0 }, levels: [{ level: 1, costCopper: 1, effects: { "effect.shared": 1 } }] },
        { id: "technology.b", name: "B", prerequisites: [{ nodeId: "technology.a", requiredLevel: 1 }], baseEffects: { "effect.other": 0 }, levels: [{ level: 1, costCopper: 1, effects: { "effect.other": 1 } }] },
      ],
    })).toThrow(/cycle/i);
    expect(() => new TechnologyModule({
      finance, eventBus,
      definitions: [
        { id: "technology.a", name: "A", prerequisites: [], baseEffects: { "effect.shared": 0 }, levels: [{ level: 1, costCopper: 1, effects: { "effect.shared": 1 } }] },
        { id: "technology.b", name: "B", prerequisites: [], baseEffects: { "effect.shared": 0 }, levels: [{ level: 1, costCopper: 1, effects: { "effect.shared": 2 } }] },
      ],
    })).toThrow(/duplicate technology effect/i);
  });
});