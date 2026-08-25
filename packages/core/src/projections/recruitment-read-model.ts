import type { RecruitmentReadModel } from "@airship-restaurant/contracts";

export const RECRUITMENT_READ_MODEL_KEY = "recruitment";

export const EMPTY_RECRUITMENT_READ_MODEL: RecruitmentReadModel = Object.freeze({
  sourceRevision: 0,
  currentUtcMs: 0,
  nextFreeRefreshAtUtcMs: 0,
  freeRefreshAvailable: false,
  manualRefreshCostCopper: 0,
  recruitedEmployeeCount: 0,
  employeeLimit: 0,
  commandsAvailable: false,
  candidates: Object.freeze([]),
  employees: Object.freeze([]),
});