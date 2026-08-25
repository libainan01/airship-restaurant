export class ManagementOperationCoordinator {
  #latestOperationId = 0;

  get latestOperationId(): number {
    return this.#latestOperationId;
  }

  begin(): number {
    this.#latestOperationId += 1;
    return this.#latestOperationId;
  }

  isLatest(operationId: number): boolean {
    return operationId === this.#latestOperationId;
  }
}

export interface ManagementPendingState {
  readonly pending: boolean;
  readonly settingsPending: boolean;
  readonly gameplayPending: boolean;
}

export function resolveManagementPendingState(
  settingsPendingCount: number,
  gameplayPendingCount: number,
): ManagementPendingState {
  const settingsPending = settingsPendingCount > 0;
  const gameplayPending = gameplayPendingCount > 0;
  return {
    pending: settingsPending || gameplayPending,
    settingsPending,
    gameplayPending,
  };
}