import { describe, expect, it } from "vitest";
import {
  getCommandId,
  isDesktopInteractionRequest,
  isGameCommand,
} from "../src";

describe("isGameCommand", () => {
  it("accepts a valid quiet-mode command", () => {
    expect(
      isGameCommand({
        id: "command-1",
        type: "settings.set-quiet-mode",
        payload: { enabled: true },
      }),
    ).toBe(true);
  });

  it("accepts validated gameplay operation commands", () => {
    expect(
      isGameCommand({
        id: "select-menu-1",
        type: "gameplay.select-recipe",
        payload: { recipeId: "recipe.windroot_soup" },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "auto-repeat-off",
        type: "gameplay.set-auto-repeat",
        payload: { enabled: false },
      }),
    ).toBe(true);
  });

  it("accepts bounded narrative event commands", () => {
    expect(
      isGameCommand({
        id: "view-story-1",
        type: "narrative.mark-viewed",
        payload: { eventId: "story.first_meal" },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "complete-story-1",
        type: "narrative.complete",
        payload: { eventId: "story.first_meal" },
      }),
    ).toBe(true);
    expect(
      isGameCommand({
        id: "complete-story-invalid",
        type: "narrative.complete",
        payload: { eventId: "" },
      }),
    ).toBe(false);
  });

  it("rejects malformed gameplay operation commands", () => {
    expect(
      isGameCommand({
        id: "select-menu-1",
        type: "gameplay.select-recipe",
        payload: { recipeId: "" },
      }),
    ).toBe(false);
    expect(
      isGameCommand({
        id: "auto-repeat-off",
        type: "gameplay.set-auto-repeat",
        payload: { enabled: "no" },
      }),
    ).toBe(false);
  });

  it("rejects malformed IPC payloads", () => {
    expect(
      isGameCommand({
        id: "command-1",
        type: "settings.set-quiet-mode",
        payload: { enabled: "yes" },
      }),
    ).toBe(false);
    expect(isGameCommand(null)).toBe(false);
  });
});

describe("getCommandId", () => {
  it("extracts only bounded non-empty ids", () => {
    expect(getCommandId({ id: "command-1" })).toBe("command-1");
    expect(getCommandId({ id: "" })).toBeNull();
    expect(getCommandId({ id: "x".repeat(129) })).toBeNull();
  });
});

describe("isDesktopInteractionRequest", () => {
  it("accepts bounded interaction state changes", () => {
    expect(
      isDesktopInteractionRequest({
        interactive: true,
        reason: "airship",
      }),
    ).toBe(true);
    expect(
      isDesktopInteractionRequest({
        interactive: false,
        reason: "desktop",
      }),
    ).toBe(true);
  });

  it("rejects malformed and unbounded requests", () => {
    expect(
      isDesktopInteractionRequest({
        interactive: "yes",
        reason: "airship",
      }),
    ).toBe(false);
    expect(
      isDesktopInteractionRequest({
        interactive: true,
        reason: "",
      }),
    ).toBe(false);
    expect(
      isDesktopInteractionRequest({
        interactive: true,
        reason: "x".repeat(65),
      }),
    ).toBe(false);
  });
});
