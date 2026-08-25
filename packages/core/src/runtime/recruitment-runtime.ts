import type {
  GameCommand,
  RecruitmentCandidateReadModel,
  RecruitmentEmployeeReadModel,
  RecruitmentReadModel,
} from "@airship-restaurant/contracts";
import type { InstanceId } from "../kernel";
import type {
  CharacterModule,
  EmploymentModule,
  RecruitmentModule,
  RecruitmentProgressionPort,
} from "../modules";
import type {
  RuntimeCommandExtensionPort,
  RuntimeCommandExtensionResult,
} from "./instance-upgrade-runtime";

export interface RecruitmentClockPort {
  nowUtcMs(): number;
}

export interface StaffActivityPort {
  getCurrentTaskId(characterId: InstanceId): string | null;
  isVoyageActive(characterId: InstanceId): boolean;
}

const IDLE_STAFF_ACTIVITY: StaffActivityPort = Object.freeze({
  getCurrentTaskId: () => null,
  isVoyageActive: () => false,
});

export class RecruitmentRuntime implements RuntimeCommandExtensionPort {
  readonly #recruitment: RecruitmentModule;
  readonly #characters: CharacterModule;
  readonly #employment: EmploymentModule;
  readonly #progression: RecruitmentProgressionPort;
  readonly #clock: RecruitmentClockPort;
  readonly #activity: StaffActivityPort;
  readonly #beforeEmploymentMutation: () => void;
  readonly #onCharacterHired: (characterId: InstanceId) => void;
  readonly #onChanged: () => void;
  #sourceRevision = 0;
  #signature = "";
  #snapshot: RecruitmentReadModel | null = null;

  constructor(options: {
    readonly recruitment: RecruitmentModule;
    readonly characters: CharacterModule;
    readonly employment: EmploymentModule;
    readonly progression: RecruitmentProgressionPort;
    readonly clock: RecruitmentClockPort;
    readonly activity?: StaffActivityPort;
    readonly beforeEmploymentMutation?: () => void;
    readonly onCharacterHired?: (characterId: InstanceId) => void;
    readonly onChanged?: () => void;
  }) {
    this.#recruitment = options.recruitment;
    this.#characters = options.characters;
    this.#employment = options.employment;
    this.#progression = options.progression;
    this.#clock = options.clock;
    this.#activity = options.activity ?? IDLE_STAFF_ACTIVITY;
    this.#beforeEmploymentMutation = options.beforeEmploymentMutation ?? (() => undefined);
    this.#onCharacterHired = options.onCharacterHired ?? (() => undefined);
    this.#onChanged = options.onChanged ?? (() => undefined);
  }

  getSnapshot(): RecruitmentReadModel {
    const state = this.#recruitment.exportState();
    const characters = this.#characters.createReadModel();
    const nowUtcMs = this.#clock.nowUtcMs();
    const minuteOfDay = Math.floor(nowUtcMs / 60_000) % 1_440;
    const currentTaskIds = new Map<InstanceId, string | null>();
    const activity = new Map(this.#employment.exportState().records.map((record) => {
      const currentTaskId = this.#activity.getCurrentTaskId(record.characterId);
      currentTaskIds.set(record.characterId, currentTaskId);
      return [record.characterId, {
        customerVisitActive: false,
        voyageActive: this.#activity.isVoyageActive(record.characterId),
      }] as const;
    }));
    const employment = this.#employment.createReadModel(minuteOfDay, activity);
    const employeeLimit = Math.max(0, Math.floor(
      this.#progression.getEffect("employment.employee-limit") ?? 0,
    ));
    const freeRefreshAvailable = nowUtcMs >= state.nextFreeRefreshAtUtcMs;
    const signature = [
      state.revision,
      characters.revision,
      employment.revision,
      employeeLimit,
      freeRefreshAvailable ? 1 : 0,
      employment.employees.map((employee) =>
        `${employee.characterId}:${currentTaskIds.get(employee.characterId) ?? ""}:${employee.voyageActive ? 1 : 0}`
      ).join("|"),
    ].join(":");
    if (signature === this.#signature && this.#snapshot !== null) return this.#snapshot;

    const characterById = new Map(characters.characters.map((character) => [character.id, character]));
    const candidates: RecruitmentCandidateReadModel[] = state.candidates.map((candidate) => Object.freeze({
      id: candidate.id,
      name: candidate.name,
      skillLevels: Object.freeze({ ...candidate.skillLevels }),
      talents: Object.freeze(candidate.talentIds.map((talentId) => {
        const talent = this.#characters.talentLibrary.get(talentId);
        return Object.freeze({ id: talentId, name: talent?.name ?? talentId });
      })),
      learnedJobIds: Object.freeze([...candidate.learnedJobIds]),
      primaryJobId: candidate.primaryJobId,
      hireCostCopper: candidate.hireCostCopper,
      qualityTier: candidate.qualityTierSnapshot,
    }));
    const employees: RecruitmentEmployeeReadModel[] = employment.employees.map((employee) => {
      const character = characterById.get(employee.characterId);
      if (character === undefined) throw new Error(`Employment references an unknown character: ${employee.characterId}`);
      return Object.freeze({
        characterId: employee.characterId,
        name: employee.name,
        coreMember: character.coreMember,
        kind: employee.kind,
        learnedJobIds: Object.freeze([...employee.learnedJobIds]),
        primaryJobId: employee.primaryJobId!,
        dailyShift: employee.dailyShift === null ? null : Object.freeze({ ...employee.dailyShift }),
        dismissalPending: employee.dismissalPending,
        onShift: employee.onShift,
        voyageActive: employee.voyageActive,
        currentTaskId: currentTaskIds.get(employee.characterId) ?? null,
        skillLevels: Object.freeze({
          cooking: character.skills.cooking.level,
          charm: character.skills.charm.level,
          movement: character.skills.movement.level,
          repair: character.skills.repair.level,
          piloting: character.skills.piloting.level,
        }),
      });
    });
    this.#signature = signature;
    this.#sourceRevision += 1;
    this.#snapshot = Object.freeze({
      sourceRevision: this.#sourceRevision,
      currentUtcMs: nowUtcMs,
      nextFreeRefreshAtUtcMs: state.nextFreeRefreshAtUtcMs,
      freeRefreshAvailable,
      manualRefreshCostCopper: this.#recruitment.getManualRefreshCostCopper(),
      recruitedEmployeeCount: employment.employees.filter((employee) => employee.kind === "recruited").length,
      employeeLimit,
      commandsAvailable: true,
      candidates: Object.freeze(candidates),
      employees: Object.freeze(employees),
    });
    return this.#snapshot;
  }

  dispatch(command: GameCommand): RuntimeCommandExtensionResult {
    if (command.type !== "recruitment.refresh" &&
      command.type !== "recruitment.hire" &&
      command.type !== "employment.set-primary-job" &&
      command.type !== "employment.set-daily-shift" &&
      command.type !== "employment.request-dismissal") {
      return Object.freeze({ handled: false });
    }
    const occurredAtUtcMs = this.#clock.nowUtcMs();
    if (command.type === "employment.set-primary-job") {
      this.#beforeEmploymentMutation();
      return this.#employmentResult(this.#employment.setPrimaryJob(
        command.id,
        command.payload.characterId as InstanceId,
        command.payload.jobId,
        occurredAtUtcMs,
      ), "Employee primary job changed.");
    }
    if (command.type === "employment.set-daily-shift") {
      this.#beforeEmploymentMutation();
      return this.#employmentResult(this.#employment.setDailyShift(
        command.id,
        command.payload.characterId as InstanceId,
        {
          startMinuteInclusive: command.payload.startMinuteInclusive,
          endMinuteExclusive: command.payload.endMinuteExclusive,
        },
        occurredAtUtcMs,
      ), "Employee daily shift changed.");
    }
    if (command.type === "employment.request-dismissal") {
      this.#beforeEmploymentMutation();
      const characterId = command.payload.characterId as InstanceId;
      if (this.#activity.isVoyageActive(characterId)) {
        return Object.freeze({
          handled: true,
          accepted: false,
          rejectionCode: "EMPLOYMENT_REJECTED" as const,
          message: "An employee on an active voyage cannot be dismissed before returning.",
        });
      }
      return this.#employmentResult(this.#employment.requestDismissal(
        command.id,
        characterId,
        this.#activity.getCurrentTaskId(characterId) !== null,
        occurredAtUtcMs,
      ), "Employee dismissal requested.");
    }
    if (command.type === "recruitment.refresh") {
      const refreshed = this.#recruitment.refresh(
        command.id,
        command.payload.kind,
        occurredAtUtcMs,
      );
      if (!refreshed.accepted) {
        return Object.freeze({
          handled: true,
          accepted: false,
          rejectionCode: "RECRUITMENT_REJECTED" as const,
          message: refreshed.message,
        });
      }
      this.#onChanged();
      return Object.freeze({
        handled: true,
        accepted: true,
        message: "Recruitment candidates refreshed.",
      });
    }

    const hired = this.#recruitment.hire(
      command.id,
      command.payload.candidateId,
      {
        startMinuteInclusive: command.payload.shiftStartMinuteInclusive,
        endMinuteExclusive: command.payload.shiftEndMinuteExclusive,
      },
      occurredAtUtcMs,
    );
    if (!hired.accepted) {
      return Object.freeze({
        handled: true,
        accepted: false,
        rejectionCode: "RECRUITMENT_REJECTED" as const,
        message: hired.message,
      });
    }
    this.#onCharacterHired(hired.value.characterId);
    this.#onChanged();
    return Object.freeze({
      handled: true,
      accepted: true,
      message: "Recruitment candidate hired.",
    });
  }

  reconcilePendingDismissals(): number {
    const occurredAtUtcMs = this.#clock.nowUtcMs();
    let completed = 0;
    for (const record of this.#employment.exportState().records) {
      if (record.dismissalRequestedAtUtcMs === null ||
        this.#activity.getCurrentTaskId(record.characterId) !== null ||
        this.#activity.isVoyageActive(record.characterId)) continue;
      const result = this.#employment.completePendingDismissal(
        `employment-dismissal-complete:${record.characterId}:${occurredAtUtcMs}`,
        record.characterId,
        occurredAtUtcMs,
      );
      if (result.accepted) completed += 1;
    }
    if (completed > 0) this.#onChanged();
    return completed;
  }

  #employmentResult(
    result: { readonly accepted: boolean; readonly message?: string },
    successMessage: string,
  ): RuntimeCommandExtensionResult {
    if (!result.accepted) {
      return Object.freeze({
        handled: true,
        accepted: false,
        rejectionCode: "EMPLOYMENT_REJECTED" as const,
        message: result.message ?? "Employment operation was rejected.",
      });
    }
    this.#onChanged();
    return Object.freeze({
      handled: true,
      accepted: true,
      message: successMessage,
    });
  }
}