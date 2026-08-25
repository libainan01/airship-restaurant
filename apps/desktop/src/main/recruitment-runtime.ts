import {
  M2_RECRUITMENT_DEFINITION,
  type ContentRegistry,
} from "@airship-restaurant/content";
import {
  DomainEventBus,
  RecruitmentModule,
  SeededRandom,
  type CharacterModule,
  type EmploymentModule,
  type RecruitmentState,
  type TechnologyModule,
  type TransactionalFinancePort,
} from "@airship-restaurant/core";

export interface DesktopRecruitmentDependencies {
  readonly content: ContentRegistry;
  readonly finance: TransactionalFinancePort;
  readonly characters: CharacterModule;
  readonly employment: EmploymentModule;
  readonly technology: TechnologyModule;
  readonly nowUtcMs: () => number;
  readonly initialState?: RecruitmentState;
}

export function createDesktopRecruitmentRuntime(
  dependencies: DesktopRecruitmentDependencies,
): RecruitmentModule {
  const sequence = dependencies.initialState?.nextRefreshSequence ?? 1;
  const seededRandom = new SeededRandom(
    (0x5ec7_0021 + Math.imul(sequence, 0x9e37_79b1)) >>> 0,
  );
  const recruitment = new RecruitmentModule({
    definition: M2_RECRUITMENT_DEFINITION,
    talents: dependencies.content.listTalents()
      .filter((talent) => talent.exclusiveCharacterId === null && talent.qualityTier !== undefined)
      .map((talent) => ({ id: talent.id, qualityTier: talent.qualityTier! })),
    finance: dependencies.finance,
    characters: dependencies.characters,
    employment: dependencies.employment,
    progression: dependencies.technology,
    random: { next: () => seededRandom.nextFloat() },
    eventBus: new DomainEventBus(),
    ...(dependencies.initialState === undefined
      ? {}
      : { initialState: dependencies.initialState }),
  });
  if (dependencies.initialState === undefined) {
    const occurredAtUtcMs = dependencies.nowUtcMs();
    const refreshed = recruitment.refresh(
      `bootstrap:recruitment:${occurredAtUtcMs}`,
      "free",
      occurredAtUtcMs,
    );
    if (!refreshed.accepted) throw new Error(refreshed.message);
  }
  return recruitment;
}