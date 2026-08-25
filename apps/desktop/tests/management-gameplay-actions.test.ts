import type { GameCommand } from "@airship-restaurant/contracts";
import { describe, expect, it, vi } from "vitest";
import { createManagementGameplayActions } from "../src/renderer/management/runtime/management-gameplay-actions";

describe("createManagementGameplayActions", () => {
  it("maps semantic procurement actions to validated commands", async () => {
    const commands: GameCommand[] = [];
    const dispatch = vi.fn(async (command: GameCommand) => {
      commands.push(command);
      return true;
    });
    const actions = createManagementGameplayActions(
      dispatch,
      (prefix) => prefix + "-test",
    );

    await expect(actions.placeProcurementOrder([
      { itemId: "ingredient.cloud_wheat", quantity: 4 },
    ])).resolves.toBe(true);
    await actions.configureProcurementAutomation(30, [{
      itemId: "ingredient.cloud_wheat",
      threshold: 2,
      target: 6,
    }]);

    expect(commands).toEqual([
      {
        id: "procurement-test",
        type: "gameplay.place-procurement-order",
        payload: {
          items: [
            { itemId: "ingredient.cloud_wheat", quantity: 4 },
          ],
        },
      },
      {
        id: "procurement-auto-test",
        type: "gameplay.configure-procurement-automation",
        payload: {
          reserveCopper: 30,
          policies: [{
            itemId: "ingredient.cloud_wheat",
            threshold: 2,
            target: 6,
          }],
        },
      },
    ]);
  });

  it("keeps UI callers independent from command identifiers", async () => {
    const dispatch = vi.fn(async () => false);
    const actions = createManagementGameplayActions(
      dispatch,
      (prefix) => "generated-" + prefix,
    );

    await expect(actions.upgradeTechnology("technology.cargo_lift_speed")).resolves.toBe(false);
    await actions.replayStoryDialogue("story-stage.martha-arrival");

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      id: "generated-technology-upgrade",
      type: "technology.upgrade-node",
      payload: { nodeId: "technology.cargo_lift_speed" },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      id: "generated-replay-story",
      type: "story.replay-dialogue",
      payload: { stageId: "story-stage.martha-arrival" },
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it("maps scene edit mode controls to explicit commands", async () => {
    const dispatch = vi.fn(async () => true);
    const actions = createManagementGameplayActions(
      dispatch,
      (prefix) => prefix + "-test",
    );

    await actions.enterSceneEditMode("scene.greyfeather");
    await actions.exitSceneEditMode();

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      id: "scene-edit-enter-test",
      type: "scene-edit.enter",
      payload: { sceneId: "scene.greyfeather" },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      id: "scene-edit-exit-test",
      type: "scene-edit.exit",
      payload: {},
    });
  });
  it("maps recruitment refresh and hire intents to bounded commands", async () => {
    const dispatch = vi.fn(async () => true);
    const actions = createManagementGameplayActions(
      dispatch,
      (prefix) => prefix + "-test",
    );

    await actions.refreshRecruitment("manual");
    await actions.hireRecruitmentCandidate(
      "candidate.recruitment.1.1",
      480,
      1_020,
    );

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      id: "recruitment-refresh-test",
      type: "recruitment.refresh",
      payload: { kind: "manual" },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      id: "recruitment-hire-test",
      type: "recruitment.hire",
      payload: {
        candidateId: "candidate.recruitment.1.1",
        shiftStartMinuteInclusive: 480,
        shiftEndMinuteExclusive: 1_020,
      },
    });
  });

  it("maps employee job, schedule and dismissal intents to commands", async () => {
    const dispatch = vi.fn(async () => true);
    const actions = createManagementGameplayActions(
      dispatch,
      (prefix) => prefix + "-test",
    );

    await actions.setEmployeePrimaryJob("instance.character.worker", "job.waiter");
    await actions.setEmployeeDailyShift("instance.character.worker", 720, 1_260);
    await actions.requestEmployeeDismissal("instance.character.worker");

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      id: "employment-primary-job-test",
      type: "employment.set-primary-job",
      payload: { characterId: "instance.character.worker", jobId: "job.waiter" },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      id: "employment-daily-shift-test",
      type: "employment.set-daily-shift",
      payload: {
        characterId: "instance.character.worker",
        startMinuteInclusive: 720,
        endMinuteExclusive: 1_260,
      },
    });
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      id: "employment-dismissal-test",
      type: "employment.request-dismissal",
      payload: { characterId: "instance.character.worker" },
    });
  });
  it("maps focus timer controls to explicit session commands", async () => {
    const dispatch = vi.fn(async () => true);
    const actions = createManagementGameplayActions(
      dispatch,
      (prefix) => prefix + "-test",
    );

    await actions.startFocusSession();
    await actions.cancelFocusSession();
    await actions.skipFocusBreak();

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      id: "focus-start-test",
      type: "focus-session.start",
      payload: {},
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      id: "focus-cancel-test",
      type: "focus-session.cancel",
      payload: {},
    });
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      id: "focus-skip-break-test",
      type: "focus-session.skip-break",
      payload: {},
    });
  });
});
