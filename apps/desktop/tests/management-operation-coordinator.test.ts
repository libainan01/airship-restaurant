import { describe, expect, it } from "vitest";
import {
  ManagementOperationCoordinator,
  resolveManagementPendingState,
} from "../src/renderer/management/runtime/management-operation-coordinator";

describe("ManagementOperationCoordinator", () => {
  it("assigns monotonically increasing operation identifiers", () => {
    const coordinator = new ManagementOperationCoordinator();

    expect(coordinator.latestOperationId).toBe(0);
    expect(coordinator.begin()).toBe(1);
    expect(coordinator.begin()).toBe(2);
    expect(coordinator.latestOperationId).toBe(2);
  });

  it("allows only the latest operation to publish global feedback", () => {
    const coordinator = new ManagementOperationCoordinator();
    const earlier = coordinator.begin();
    const latest = coordinator.begin();

    expect(coordinator.isLatest(earlier)).toBe(false);
    expect(coordinator.isLatest(latest)).toBe(true);
  });

  it("treats initial hydration as current until an operation begins", () => {
    const coordinator = new ManagementOperationCoordinator();

    expect(coordinator.isLatest(0)).toBe(true);
    coordinator.begin();
    expect(coordinator.isLatest(0)).toBe(false);
  });

  it("keeps settings and gameplay pending state independent", () => {
    expect(resolveManagementPendingState(2, 0)).toEqual({
      pending: true,
      settingsPending: true,
      gameplayPending: false,
    });
    expect(resolveManagementPendingState(0, 1)).toEqual({
      pending: true,
      settingsPending: false,
      gameplayPending: true,
    });
    expect(resolveManagementPendingState(0, 0).pending).toBe(false);
  });
});
