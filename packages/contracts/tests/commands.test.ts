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
